using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using Lokey.Host.Pipe;

namespace Lokey.Host;

// --selftest: start every service, call each read-only method once, print one JSON report, exit 0 only if all passed.
// Nothing here registers hotkeys, launches apps, sets wallpaper/volume, pastes, or calls power.do.
internal static class SelfTest
{
    sealed record Res(string Name, bool Ok, long Ms, string Summary, string? Error);
    sealed record Report(bool Ok, string Host, string Os, int ElapsedMs, Dictionary<string, int> Events, List<Res> Results);

    static readonly Regex DataUrl = new("\"data:[^\"]*\"", RegexOptions.Compiled);
    static readonly Dictionary<string, int> EventCounts = new();

    public static async Task<int> Run()
    {
        var total = Stopwatch.StartNew();
        Events.Sink = line =>
        {
            try { using var d = JsonDocument.Parse(line); var n = d.RootElement.GetProperty("event").GetString() ?? "?"; lock (EventCounts) EventCounts[n] = EventCounts.GetValueOrDefault(n) + 1; } catch { }
        };
        var results = new List<Res>();
        var sw = Stopwatch.StartNew();
        try { await Boot.StartAsync(); results.Add(new("boot", true, sw.ElapsedMilliseconds, "services started (failures, if any, are in host.log)", null)); }
        catch (Exception e) { results.Add(new("boot", false, sw.ElapsedMilliseconds, "", e.Message)); }

        async Task<object?> T(string method, string args = "{}", Func<Task>? between = null)
        {
            sw.Restart();
            try
            {
                using var doc = JsonDocument.Parse(args);
                var r = await Dispatcher.Call(method, doc.RootElement.Clone());
                long ms = sw.ElapsedMilliseconds; // the optional wait below is not part of the call time
                if (between is not null) await between();
                results.Add(new(method, true, ms, Summarize(r), null));
                return r;
            }
            catch (Exception e)
            {
                results.Add(new(method, false, sw.ElapsedMilliseconds, "", (e is AggregateException { InnerException: { } i } ? i : e).Message));
                return null;
            }
        }

        await T("sys.hello", """{"version":1}""");
        await T("display.get");
        await T("user.get");
        await T("media.get");
        await T("audio.get");
        await T("system.get");
        // read-only radio/device queries (no connect/pair/setDefault/toggle here)
        await T("wifi.get");
        await T("wifi.scan");
        await T("bt.get");
        await T("bt.devices");
        await T("bt.discover", """{"seconds":2}""");
        await T("audio.devices");
        await T("foreground.get");
        await T("desktops.get");
        await T("hotkey.unregisterAll");
        await T("clipboard.list", """{"limit":20}""");

        // stats: subscribe, let one tick arrive, unsubscribe
        await T("stats.subscribe", """{"intervalMs":500}""", () => Task.Delay(900));
        await T("stats.unsubscribe");
        // visualiser: capture on/off (listens to the loopback only; plays nothing)
        await T("audio.visualiser", """{"on":true}""", () => Task.Delay(400));
        await T("audio.visualiser", """{"on":false}""");

        var apps = await T("apps.list") as AppEntry[];
        if (apps is { Length: > 0 }) await T("apps.icon", JsonSerializer.Serialize(new { id = apps[0].Id }));
        else results.Add(new("apps.icon", true, 0, "skipped: no apps on this machine", null));
        await T("apps.searchFiles", """{"query":"doc","limit":3}""");

        var wp = await T("wallpaper.get") as PathResult;
        var recent = await T("wallpaper.recent") as WallpaperItem[];
        var path = wp?.Path ?? recent?.FirstOrDefault()?.Path;
        var folder = path is not null ? Path.GetDirectoryName(path)! : Environment.GetFolderPath(Environment.SpecialFolder.MyPictures);
        await T("wallpaper.folder", JsonSerializer.Serialize(new { folder, limit = 5 }));
        await T("wallpaper.folder", """{"folder":"%PICTURES%","limit":3}""");
        await T("wallpaper.folder", """{"folder":"","limit":3}""");
        if (path is not null) await T("wallpaper.thumb", JsonSerializer.Serialize(new { path, size = 320 }));
        else results.Add(new("wallpaper.thumb", true, 0, "skipped: no wallpaper image on this machine", null));

        // synthetic checks of the parts that cannot be driven safely from outside (no real input, no real clipboard)
        async Task Check(string name, Func<string> f)
        {
            sw.Restart();
            try { var s = f(); results.Add(new(name, true, sw.ElapsedMilliseconds, s, null)); }
            catch (Exception e) { results.Add(new(name, false, sw.ElapsedMilliseconds, "", e.Message)); }
            await Task.CompletedTask;
        }
        await Check("hotkeys.selfcheck", Services.Hotkeys.SelfCheck);
        await Check("visualiser.selfcheck", Services.Visualiser.SelfCheck);
        if (Environment.GetEnvironmentVariable("LOKEY_DATA_DIR") is { Length: > 0 }) await Check("clipboard.store.selfcheck", Services.Clipboard.SelfCheck);

        Boot.Shutdown();
        bool ok = results.All(r => r.Ok);
        Dictionary<string, int> ev; lock (EventCounts) ev = new(EventCounts);
        Console.Out.WriteLine(JsonSerializer.Serialize(new Report(ok, "Lokey.Host", Environment.OSVersion.VersionString, (int)total.ElapsedMilliseconds, ev, results), Json.O));
        Console.Out.Flush();
        return ok ? 0 : 1;
    }

    // Short, and never any clipboard text or user paths beyond what the method itself is about.
    static string Summarize(object? r) => r switch
    {
        null => "null",
        AppEntry[] a => $"{a.Length} apps ({a.Count(x => x.Kind == "game")} game, {a.Count(x => x.Kind == "store")} store, {a.Count(x => x.Starred)} starred)",
        ClipItem[] c => $"{c.Length} items",
        WallpaperItem[] w => $"{w.Length} images",
        FileHit[] f => $"{f.Length} hits",
        IconResult i => i.Icon is null ? "icon: null" : $"icon: data url {i.Icon.Length} chars",
        ThumbResult t => t.Thumb is null ? "thumb: null" : $"thumb: data url {t.Thumb.Length} chars",
        WifiNetwork[] w => $"{w.Length} networks",
        BtDevice[] b => $"{b.Length} devices ({b.Count(x => x.Connected)} connected)",
        AudioDevice[] ad => $"{ad.Count(x => x.Kind == "output")} outputs, {ad.Count(x => x.Kind == "input")} inputs",
        MediaState m => $"hasSession={m.HasSession} playing={m.Playing} sessions={m.Sessions.Length} app='{m.App}'",
        _ => Trim(DataUrl.Replace(JsonSerializer.Serialize(r, Json.O), m => $"\"<data url {m.Length} chars>\"")),
    };

    static string Trim(string s) => s.Length <= 200 ? s : s[..200] + "...";
}
