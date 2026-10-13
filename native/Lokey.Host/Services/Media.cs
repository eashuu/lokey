using Lokey.Host.Native;
using Lokey.Host.Pipe;
using Windows.Media.Control;

namespace Lokey.Host.Services;

// GlobalSystemMediaTransportControls: every app that exposes a media session (Spotify, browsers, ...). Event driven.
internal static class Media
{
    sealed record Props(string Title, string Artist, string Album, string? Art);

    static GlobalSystemMediaTransportControlsSessionManager? _mgr;
    static readonly SemaphoreSlim Gate = new(1, 1);
    static readonly HashSet<string> Attached = new();
    static readonly Dictionary<string, Props> PropCache = new();
    static readonly HashSet<string> Dirty = new();
    static readonly Debounce Refresh = new(120, () => _ = RefreshAsync());
    static string? _selected;
    static MediaState? _lastEmitted;
    static string _lastKey = "";
    static readonly object EL = new();

    static readonly MediaState Empty = new(false, "", "", "", "", false, 0, 0, 0, null, false, false, [], null);

    public static void Register()
    {
        Dispatcher.AddAsync("media.get", async _ => await BuildAsync());
        Dispatcher.AddAsync("media.control", async p => { await ControlAsync(Args.Str(p, "action"), Args.OptNum(p, "positionMs")); return Dispatcher.Ok; });
        Dispatcher.AddAsync("media.selectSession", async p => { _selected = Args.Str(p, "id"); await RefreshAsync(); return Dispatcher.Ok; });
    }

    public static async Task InitAsync()
    {
        try
        {
            _mgr = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
            _mgr.SessionsChanged += (_, _) => { Resync(); Refresh.Poke(); };
            _mgr.CurrentSessionChanged += (_, _) => Refresh.Poke();
            Resync();
        }
        catch (Exception e) { Log.Error("media init", e); _mgr = null; }
    }

    static void Resync()
    {
        if (_mgr is null) return;
        lock (Attached)
        {
            var now = _mgr.GetSessions();
            var ids = new HashSet<string>(now.Select(s => s.SourceAppUserModelId));
            foreach (var s in now)
                if (Attached.Add(s.SourceAppUserModelId))
                {
                    s.MediaPropertiesChanged += OnProps;
                    s.PlaybackInfoChanged += OnOther;
                    s.TimelinePropertiesChanged += OnOther;
                    Dirty.Add(s.SourceAppUserModelId);
                }
            foreach (var gone in Attached.Where(a => !ids.Contains(a)).ToArray()) { Attached.Remove(gone); lock (PropCache) PropCache.Remove(gone); }
        }
    }

    static void OnProps(GlobalSystemMediaTransportControlsSession s, object? _) { lock (Dirty) Dirty.Add(s.SourceAppUserModelId); Refresh.Poke(); }
    static void OnOther(GlobalSystemMediaTransportControlsSession s, object? _) => Refresh.Poke();

    static GlobalSystemMediaTransportControlsSession? Pick()
    {
        if (_mgr is null) return null;
        var all = _mgr.GetSessions();
        if (_selected is not null && all.FirstOrDefault(s => s.SourceAppUserModelId == _selected) is { } sel) return sel;
        return _mgr.GetCurrentSession() ?? all.FirstOrDefault();
    }

    static async Task<Props> PropsOf(GlobalSystemMediaTransportControlsSession s)
    {
        var id = s.SourceAppUserModelId;
        bool dirty; lock (Dirty) dirty = Dirty.Remove(id);
        lock (PropCache) if (!dirty && PropCache.TryGetValue(id, out var c)) return c;
        Props pr;
        try
        {
            var task = s.TryGetMediaPropertiesAsync().AsTask();
            if (await Task.WhenAny(task, Task.Delay(2500)) != task) return new Props("", "", "", null);
            var p = await task;
            string? art = null;
            if (p.Thumbnail is not null)
            {
                try
                {
                    using var rs = await p.Thumbnail.OpenReadAsync();
                    using var st = rs.AsStreamForRead();
                    using var ms = new MemoryStream();
                    await st.CopyToAsync(ms);
                    art = Imaging.ToDataUrl(ms.ToArray(), 320, png: false);
                }
                catch { /* some apps hand out dead thumbnails */ }
            }
            pr = new Props(p.Title ?? "", string.IsNullOrEmpty(p.Artist) ? p.AlbumArtist ?? "" : p.Artist, p.AlbumTitle ?? "", art);
        }
        catch { return new Props("", "", "", null); }
        lock (PropCache) PropCache[id] = pr;
        return pr;
    }

    public static async Task<MediaState> BuildAsync()
    {
        if (_mgr is null) return Empty;
        await Gate.WaitAsync();
        try
        {
            var all = _mgr.GetSessions();
            var sessions = all.Select(s => new SessionInfo(s.SourceAppUserModelId, AppName(s.SourceAppUserModelId), IsPlaying(s))).ToArray();
            var cur = Pick();
            if (cur is null) return Empty with { Sessions = sessions };
            var info = cur.GetPlaybackInfo();
            var tl = cur.GetTimelineProperties();
            var pr = await PropsOf(cur);
            bool playing = info?.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
            long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            long dur = (long)Math.Max(0, (tl.EndTime - tl.StartTime).TotalMilliseconds);
            long pos = (long)Math.Max(0, (tl.Position - tl.StartTime).TotalMilliseconds);
            if (playing && tl.LastUpdatedTime.Year > 2000)
                pos += Math.Clamp(now - tl.LastUpdatedTime.ToUnixTimeMilliseconds(), 0, 6 * 3600_000);
            if (dur > 0) pos = Math.Min(pos, dur);
            var id = cur.SourceAppUserModelId;
            return new MediaState(true, AppName(id), pr.Title, pr.Artist, pr.Album, playing, pos, dur, now, pr.Art,
                info?.Controls.IsNextEnabled ?? false, info?.Controls.IsPreviousEnabled ?? false, sessions, id);
        }
        catch (Exception e) { Log.Error("media build", e); return Empty; }
        finally { Gate.Release(); }
    }

    static bool IsPlaying(GlobalSystemMediaTransportControlsSession s)
    {
        try { return s.GetPlaybackInfo()?.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing; } catch { return false; }
    }

    // Emit only when something the UI shows changed, or position jumped (seek) beyond what extrapolation predicts.
    static async Task RefreshAsync()
    {
        var s = await BuildAsync();
        var key = $"{s.CurrentSession}|{s.Title}|{s.Artist}|{s.Album}|{s.Playing}|{s.DurationMs}|{s.CanNext}|{s.CanPrev}|{s.Art?.Length}|{string.Join(',', s.Sessions.Select(x => x.Id + x.Playing))}";
        lock (EL)
        {
            bool emit = key != _lastKey;
            if (!emit && _lastEmitted is { } l)
            {
                long expected = l.PositionMs + (l.Playing ? s.SampledAt - l.SampledAt : 0);
                emit = Math.Abs(s.PositionMs - expected) > 1500;
            }
            if (!emit) return;
            _lastKey = key; _lastEmitted = s;
        }
        Events.Emit("media.changed", s);
    }

    static async Task ControlAsync(string action, double? posMs)
    {
        var s = Pick();
        if (s is null) return;
        switch (action)
        {
            case "play": await s.TryPlayAsync(); break;
            case "pause": await s.TryPauseAsync(); break;
            case "toggle": await s.TryTogglePlayPauseAsync(); break;
            case "next": await s.TrySkipNextAsync(); break;
            case "prev": await s.TrySkipPreviousAsync(); break;
            case "seek":
                if (posMs is { } p) await s.TryChangePlaybackPositionAsync((long)(p * 10_000)); // ticks
                break;
            default: throw new ArgumentException($"unknown media action '{action}'");
        }
    }

    // "Spotify.exe" -> "Spotify"; "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" -> the part after '!' or the package name.
    static string AppName(string aumid)
    {
        if (string.IsNullOrEmpty(aumid)) return "";
        if (Apps.FriendlyName(aumid) is { } friendly) return friendly; // exact Start-menu name once the app list is cached
        var name = aumid;
        int bang = name.IndexOf('!');
        if (bang >= 0) name = name[(bang + 1)..] is { Length: > 0 } after && after != "App" ? after : name[..bang];
        int us = name.IndexOf('_'); if (us > 0) name = name[..us];
        int dot = name.LastIndexOf('.');
        if (dot > 0 && !name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) name = name[(dot + 1)..];
        if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) name = name[..^4];
        return name.Length > 0 && char.IsLower(name[0]) ? char.ToUpperInvariant(name[0]) + name[1..] : name;
    }
}
