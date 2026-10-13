using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Media.Control;

namespace Hitodama.Shell.Services;

// MPRIS equivalent: the global media session (Spotify, browsers, anything using SMTC).
public static class Media
{
    static GlobalSystemMediaTransportControlsSessionManager? _manager;
    static GlobalSystemMediaTransportControlsSession? _session;
    static DispatcherQueue _ui = null!;
    static TimeSpan _position;
    static DateTimeOffset _positionAt;

    public static string Title { get; private set; } = "";
    public static string Artist { get; private set; } = "";
    public static string Album { get; private set; } = "";
    public static string App { get; private set; } = "";
    public static BitmapImage? Art { get; private set; }
    public static bool Playing { get; private set; }
    public static TimeSpan Duration { get; private set; }
    public static bool HasSession => _session is not null;

    public static TimeSpan Position
    {
        get
        {
            var p = Playing ? _position + (DateTimeOffset.Now - _positionAt) : _position;
            return p > Duration && Duration > TimeSpan.Zero ? Duration : p;
        }
    }

    /// <summary>Any change. Raised on the UI thread.</summary>
    public static event Action? Changed;
    /// <summary>A new song started. Raised on the UI thread.</summary>
    public static event Action? TrackChanged;

    public static async Task InitAsync(DispatcherQueue ui)
    {
        _ui = ui;
        try
        {
            _manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
            _manager.CurrentSessionChanged += (m, _) => _ui.TryEnqueue(() => Attach(m.GetCurrentSession()));
            Attach(_manager.GetCurrentSession());
        }
        catch { /* media service unavailable */ }
    }

    static void Attach(GlobalSystemMediaTransportControlsSession? s)
    {
        if (_session is not null)
        {
            _session.MediaPropertiesChanged -= OnProps;
            _session.PlaybackInfoChanged -= OnPlayback;
            _session.TimelinePropertiesChanged -= OnTimeline;
        }
        _session = s;
        if (s is null)
        {
            Title = Artist = Album = App = ""; Art = null; Playing = false; Duration = TimeSpan.Zero;
            Changed?.Invoke();
            return;
        }
        s.MediaPropertiesChanged += OnProps;
        s.PlaybackInfoChanged += OnPlayback;
        s.TimelinePropertiesChanged += OnTimeline;
        App = s.SourceAppUserModelId.Split('!')[0].Replace(".exe", "", StringComparison.OrdinalIgnoreCase);
        OnPlayback(s, null);
        OnTimeline(s, null);
        OnProps(s, null);
    }

    static void OnProps(GlobalSystemMediaTransportControlsSession s, object? _) => _ui.TryEnqueue(async () =>
    {
        try
        {
            var p = await s.TryGetMediaPropertiesAsync();
            if (s != _session) return;
            bool newTrack = p.Title != Title;
            Title = p.Title ?? "";
            Artist = string.IsNullOrEmpty(p.Artist) ? p.AlbumArtist ?? "" : p.Artist;
            Album = p.AlbumTitle ?? "";
            Art = null;
            if (p.Thumbnail is not null)
            {
                var img = new BitmapImage();
                using var stream = await p.Thumbnail.OpenReadAsync();
                await img.SetSourceAsync(stream);
                Art = img;
            }
            Changed?.Invoke();
            if (newTrack) TrackChanged?.Invoke();
        }
        catch { }
    });

    static void OnPlayback(GlobalSystemMediaTransportControlsSession s, object? _) => _ui.TryEnqueue(() =>
    {
        var info = s.GetPlaybackInfo();
        var playing = info?.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
        if (playing != Playing) { _position = Position; _positionAt = DateTimeOffset.Now; }
        Playing = playing;
        Changed?.Invoke();
    });

    static void OnTimeline(GlobalSystemMediaTransportControlsSession s, object? _) => _ui.TryEnqueue(() =>
    {
        var t = s.GetTimelineProperties();
        Duration = t.EndTime - t.StartTime;
        _position = t.Position;
        _positionAt = t.LastUpdatedTime == default ? DateTimeOffset.Now : t.LastUpdatedTime;
        Changed?.Invoke();
    });

    /// <summary>Cycle to the next app that exposes a media session (Caelestia's player selector).</summary>
    public static void NextSession()
    {
        if (_manager is null) return;
        var all = _manager.GetSessions();
        if (all.Count < 2) return;
        int i = all.ToList().FindIndex(x => x.SourceAppUserModelId == _session?.SourceAppUserModelId);
        Attach(all[(i + 1) % all.Count]);
    }

    public static void PlayPause() => _ = _session?.TryTogglePlayPauseAsync();
    public static void Next() => _ = _session?.TrySkipNextAsync();
    public static void Previous() => _ = _session?.TrySkipPreviousAsync();

    public static void Seek(TimeSpan to)
    {
        _ = _session?.TryChangePlaybackPositionAsync(to.Ticks);
        _position = to;
        _positionAt = DateTimeOffset.Now;
    }
}
