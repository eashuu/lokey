using System.Data.OleDb;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Lokey.Host.Native;
using Lokey.Host.Pipe;

namespace Lokey.Host.Services;

// Installed apps = the shell:AppsFolder (what Start's "All apps" shows): classic shortcuts and Store apps, id = AppUserModelID.
internal static class Apps
{
    sealed record Raw(string Id, string Name, string Kind);
    sealed class Persist { public HashSet<string> Stars { get; set; } = new(); public Dictionary<string, long> LastUsed { get; set; } = new(); }

    static Task<Dictionary<string, Raw>>? _cache;
    static readonly object L = new();
    static Persist _p = new();
    static readonly string StateFile = Path.Combine(Paths.Root, "apps.json"); // the folder is created on first write, not at startup
    static readonly List<FileSystemWatcher> Watchers = new();
    static readonly Debounce Changed = new(1500, () => { lock (L) _cache = null; Events.Emit("apps.changed", Dispatcher.Ok); });

    static readonly string[] Launchers =
    [
        "steam", "epic games launcher", "xbox", "gog galaxy", "battle.net", "ubisoft connect", "ea app", "ea desktop", "origin",
        "riot client", "rockstar games launcher", "minecraft launcher", "itch", "playnite", "heroic games launcher", "amazon games",
    ];

    public static void Register()
    {
        Dispatcher.AddAsync("apps.list", async _ => await ListAsync());
        Dispatcher.AddAsync("apps.icon", async p => new IconResult(await IconAsync(Args.Str(p, "id"))));
        Dispatcher.AddAsync("apps.launch", async p => { await LaunchAsync(Args.Str(p, "id")); return Dispatcher.Ok; });
        Dispatcher.Add("apps.star", p => { Star(Args.Str(p, "id"), Args.Bool(p, "on")); return Dispatcher.Ok; });
        Dispatcher.AddAsync("apps.searchFiles", async p => await SearchFilesAsync(Args.Str(p, "query"), Args.OptInt(p, "limit") ?? 10));
        Dispatcher.Add("apps.openPath", p => { OpenPath(Args.Str(p, "path")); return Dispatcher.Ok; });
    }

    public static void Init()
    {
        try { if (File.Exists(StateFile)) _p = JsonSerializer.Deserialize<Persist>(File.ReadAllText(StateFile), Json.O) ?? new(); } catch { _p = new(); }
        foreach (var dir in new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), @"Microsoft\Windows\Start Menu\Programs"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"Microsoft\Windows\Start Menu\Programs"),
        })
        {
            if (!Directory.Exists(dir)) continue;
            try
            {
                var w = new FileSystemWatcher(dir) { IncludeSubdirectories = true, NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName };
                w.Created += (_, _) => Changed.Poke(); w.Deleted += (_, _) => Changed.Poke(); w.Renamed += (_, _) => Changed.Poke();
                w.EnableRaisingEvents = true;
                Watchers.Add(w);
            }
            catch (Exception e) { Log.Error("start menu watch", e); }
        }
    }

    public static string? FriendlyName(string aumid)
    {
        Task<Dictionary<string, Raw>>? c; lock (L) c = _cache;
        return c is { IsCompletedSuccessfully: true } && c.Result.TryGetValue(aumid, out var r) ? r.Name : null;
    }

    // ---- enumeration ----
    static Task<Dictionary<string, Raw>> Cache()
    {
        lock (L) { if (_cache is { IsFaulted: true } or { IsCanceled: true }) _cache = null; return _cache ??= Sta.Run(Enumerate); } // never cache a failure
    }

    static Dictionary<string, Raw> Enumerate()
    {
        var result = new Dictionary<string, Raw>(StringComparer.OrdinalIgnoreCase);
        var gameShortcuts = GameShortcutNames();
        var bhid = new Guid("94f60519-2850-4924-aa5a-d15e84868039"); // BHID_EnumItems
        var iidEnum = typeof(W.IEnumShellItems).GUID;
        W.SHCreateItemFromParsingName("shell:AppsFolder", IntPtr.Zero, typeof(W.IShellItem).GUID, out var folder);
        if (folder.BindToHandler(IntPtr.Zero, ref bhid, ref iidEnum, out var en) != 0) return result;
        while (en.Next(1, out var item, out var fetched) == 0 && fetched == 1)
        {
            try
            {
                if (item.GetDisplayName(0x80018001 /* SIGDN_PARENTRELATIVEPARSING */, out var id) != 0 || string.IsNullOrWhiteSpace(id)) continue;
                if (item.GetDisplayName(0 /* SIGDN_NORMALDISPLAY */, out var name) != 0 || string.IsNullOrWhiteSpace(name)) continue;
                if (name.StartsWith("Uninstall ", StringComparison.OrdinalIgnoreCase) || name.EndsWith(" Uninstall", StringComparison.OrdinalIgnoreCase)) continue;
                result.TryAdd(id, new Raw(id, name.Trim(), KindOf(id, name, gameShortcuts)));
            }
            finally { System.Runtime.InteropServices.Marshal.ReleaseComObject(item); }
        }
        return result;
    }

    // Start-menu .url shortcuts that point at a game launcher protocol (steam://, com.epicgames.launcher://, ...) -> by shortcut name.
    static HashSet<string> GameShortcutNames()
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var root in new[] { Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData) })
        {
            var dir = Path.Combine(root, @"Microsoft\Windows\Start Menu\Programs");
            if (!Directory.Exists(dir)) continue;
            try
            {
                foreach (var f in Directory.EnumerateFiles(dir, "*.url", SearchOption.AllDirectories))
                {
                    var url = File.ReadLines(f).FirstOrDefault(l => l.StartsWith("URL=", StringComparison.OrdinalIgnoreCase)) ?? "";
                    if (url.Contains("steam://", StringComparison.OrdinalIgnoreCase) || url.Contains("epicgames", StringComparison.OrdinalIgnoreCase) || url.Contains("steamapps", StringComparison.OrdinalIgnoreCase)
                        || Path.GetDirectoryName(f)!.Contains("steam", StringComparison.OrdinalIgnoreCase))
                        set.Add(Path.GetFileNameWithoutExtension(f));
                }
            }
            catch { }
        }
        return set;
    }

    static string KindOf(string id, string name, HashSet<string> gameShortcuts)
    {
        if (Launchers.Any(g => name.Equals(g, StringComparison.OrdinalIgnoreCase) || name.StartsWith(g + " ", StringComparison.OrdinalIgnoreCase))) return "game";
        if (gameShortcuts.Contains(name) || id.Contains("steamapps", StringComparison.OrdinalIgnoreCase) || id.Contains("steam://", StringComparison.OrdinalIgnoreCase)
            || id.EndsWith(".url", StringComparison.OrdinalIgnoreCase) || id.Contains("GamingApp", StringComparison.OrdinalIgnoreCase)) return "game";
        return id.Contains('!') ? "store" : "app";
    }

    static async Task<object?> ListAsync()
    {
        var all = await Cache();
        Persist p; lock (L) p = _p;
        return all.Values.OrderBy(a => a.Name, StringComparer.CurrentCultureIgnoreCase)
            .Select(a => new AppEntry(a.Id, a.Name, a.Kind, p.Stars.Contains(a.Id), p.LastUsed.TryGetValue(a.Id, out var t) ? t : null)).ToArray();
    }

    // ---- icons ----
    static async Task<string?> IconAsync(string id)
    {
        var all = await Cache();
        if (!all.ContainsKey(id)) return null;
        var file = Paths.Sub("cache", "icons", Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(id.ToLowerInvariant()))) + ".png");
        try { if (File.Exists(file)) return Imaging.DataUrl("image/png", await File.ReadAllBytesAsync(file)); } catch { }
        var png = await Sta.Run(() =>
        {
            using var bmp = Imaging.ShellImage(@"shell:AppsFolder\" + id, 64, 0x4 /* SIIGBF_ICONONLY */);
            return bmp is null ? null : Imaging.EncodePng(bmp);
        });
        if (png is null) return null;
        try { await File.WriteAllBytesAsync(file, png); } catch { }
        return Imaging.DataUrl("image/png", png);
    }

    // ---- launch / star ----
    static async Task LaunchAsync(string id)
    {
        var all = await Cache();
        if (!all.ContainsKey(id)) throw new ArgumentException("unknown app id");
        Process.Start(new ProcessStartInfo("explorer.exe", @"shell:AppsFolder\" + id) { UseShellExecute = false, CreateNoWindow = true });
        lock (L) { _p.LastUsed[id] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); Save(); }
    }

    static void Star(string id, bool on)
    {
        lock (L) { if (on) _p.Stars.Add(id); else _p.Stars.Remove(id); Save(); }
    }

    static void Save()
    {
        try { Directory.CreateDirectory(Paths.Root); File.WriteAllText(StateFile, JsonSerializer.Serialize(_p, Json.O)); } catch (Exception e) { Log.Error("apps.json", e); }
    }

    // ---- Windows Search ----
    static async Task<object?> SearchFilesAsync(string query, int limit)
    {
        limit = Math.Clamp(limit, 1, 50);
        // Strip LIKE wildcards/brackets and quotes: the provider has no parameter support, so nothing risky may reach the SQL text.
        var q = new string(query.Where(c => !char.IsControl(c) && c is not ('%' or '_' or '[' or ']' or '\'' or '"' or '\\')).ToArray()).Trim();
        if (q.Length < 2) return Array.Empty<FileHit>();
        var work = Task.Run(() =>
        {
            try
            {
                using var con = new OleDbConnection("Provider=Search.CollatorDSO;Extended Properties='Application=Windows'");
                con.Open();
                using var cmd = con.CreateCommand();
                cmd.CommandText = $"SELECT TOP {limit} System.ItemNameDisplay, System.ItemPathDisplay FROM SystemIndex " +
                                  $"WHERE System.ItemNameDisplay LIKE '%{q}%' AND System.ItemUrl LIKE 'file:%' ORDER BY System.DateModified DESC";
                var hits = new List<FileHit>();
                using var r = cmd.ExecuteReader();
                while (r.Read() && hits.Count < limit)
                    if (r[0] is string n && r[1] is string path) hits.Add(new FileHit(n, path));
                return (object?)hits.ToArray();
            }
            catch (Exception e) { Log.Error("search", e); return Array.Empty<FileHit>(); }
        });
        // Windows Search can stall while indexing: answer empty rather than hang the UI.
        return await Task.WhenAny(work, Task.Delay(4000)) == work ? await work : Array.Empty<FileHit>();
    }

    static void OpenPath(string path)
    {
        bool url = path.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || path.StartsWith("https://", StringComparison.OrdinalIgnoreCase);
        if (!url && !File.Exists(path) && !Directory.Exists(path)) throw new FileNotFoundException("path does not exist");
        Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
    }
}
