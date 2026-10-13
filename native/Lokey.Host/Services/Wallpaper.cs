using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Lokey.Host.Native;
using Lokey.Host.Pipe;
using Microsoft.Win32;

namespace Lokey.Host.Services;

internal static class Wallpaper
{
    static readonly string[] Exts = [".jpg", ".jpeg", ".png", ".bmp", ".webp", ".jfif"];
    static readonly Debounce Notify = new(300, () => _ = EmitAsync());

    static async Task EmitAsync() => Events.Emit("wallpaper.changed", new PathResult(await Sta.Run(Current)));

    public static void Register()
    {
        Dispatcher.AddAsync("wallpaper.get", async _ => new PathResult(await Sta.Run(Current)));
        Dispatcher.AddAsync("wallpaper.set", async p => { await SetAsync(Args.Str(p, "path")); return Dispatcher.Ok; });
        Dispatcher.AddAsync("wallpaper.recent", async _ => await RecentAsync());
        Dispatcher.Add("wallpaper.folder", p => Folder(Args.Str(p, "folder"), Args.OptInt(p, "limit") ?? 50));
        Dispatcher.AddAsync("wallpaper.thumb", async p => new ThumbResult(await ThumbAsync(Args.Str(p, "path"), Args.OptInt(p, "size") ?? 320)));
    }

    public static void Init() =>
        Pump.On(Pump.WM_SETTINGCHANGE, (w, _) => { if ((uint)w == 0x14 /* SPI_SETDESKWALLPAPER */) Notify.Poke(); });

    // ---- IDesktopWallpaper (STA) with SystemParametersInfo fallback ----
    [ComImport, Guid("B92B56A9-8B55-4E14-9A89-0199BBB6F93B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDesktopWallpaper
    {
        [PreserveSig] int SetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string? monitorId, [MarshalAs(UnmanagedType.LPWStr)] string wallpaper);
        [PreserveSig] int GetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string? monitorId, [MarshalAs(UnmanagedType.LPWStr)] out string wallpaper);
        [PreserveSig] int GetMonitorDevicePathAt(uint i, [MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetMonitorDevicePathCount(out uint count);
        [PreserveSig] int GetMonitorRECT([MarshalAs(UnmanagedType.LPWStr)] string id, out W.RECT r);
        [PreserveSig] int SetBackgroundColor(uint color);
        [PreserveSig] int GetBackgroundColor(out uint color);
        [PreserveSig] int SetPosition(int pos);
        [PreserveSig] int GetPosition(out int pos);
        [PreserveSig] int SetSlideshow(IntPtr items);
        [PreserveSig] int GetSlideshow(out IntPtr items);
        [PreserveSig] int SetSlideshowOptions(int opts, uint ms);
        [PreserveSig] int GetSlideshowOptions(out int opts, out uint ms);
        [PreserveSig] int AdvanceSlideshow([MarshalAs(UnmanagedType.LPWStr)] string? monitorId, int dir);
        [PreserveSig] int GetStatus(out int state);
        [PreserveSig] int Enable([MarshalAs(UnmanagedType.Bool)] bool enable);
    }

    static IDesktopWallpaper? Com()
    {
        try { return (IDesktopWallpaper?)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("C2CF3110-460E-4fc1-B9D0-8A1C0C9CC4BD"))!); }
        catch { return null; }
    }

    static string? Current()
    {
        string? path = null;
        var c = Com();
        try { if (c is not null && c.GetWallpaper(null, out var w) == 0 && !string.IsNullOrEmpty(w)) path = w; } catch { }
        finally { if (c is not null) Marshal.ReleaseComObject(c); }
        if (string.IsNullOrEmpty(path)) path = W.WallpaperFromSpi();
        return !string.IsNullOrEmpty(path) && File.Exists(path) ? path : null;
    }

    static Task SetAsync(string path) => Sta.Run(() =>
    {
        if (!File.Exists(path) || !Exts.Contains(Path.GetExtension(path).ToLowerInvariant())) throw new FileNotFoundException("not an image file");
        var c = Com();
        try
        {
            if (c is not null && c.SetWallpaper(null, path) == 0) return 0;
        }
        catch { }
        finally { if (c is not null) Marshal.ReleaseComObject(c); }
        if (!W.SystemParametersInfoStr(0x14 /* SPI_SETDESKWALLPAPER */, 0, path, 3)) throw new InvalidOperationException("wallpaper change failed");
        return 0;
    });

    static WallpaperItem Item(string path) => new(path, Path.GetFileNameWithoutExtension(path), null);

    // Windows' own history; thumbnails are fetched lazily with wallpaper.thumb.
    static async Task<object?> RecentAsync()
    {
        var list = new List<string>();
        var cur = await Sta.Run(Current);
        if (cur is not null) list.Add(cur);
        try
        {
            using var k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Wallpapers");
            for (int i = 0; i < 5; i++)
                if (k?.GetValue("BackgroundHistoryPath" + i) is string s && s.Length > 0) list.Add(s);
        }
        catch { }
        return list.Distinct(StringComparer.OrdinalIgnoreCase).Where(File.Exists).Select(Item).ToArray();
    }

    static object? Folder(string folder, int limit)
    {
        // "" and "%PICTURES%" mean the user's Pictures folder; other %VARS% are expanded.
        folder = string.IsNullOrWhiteSpace(folder) || folder.Trim().Equals("%PICTURES%", StringComparison.OrdinalIgnoreCase)
            ? Environment.GetFolderPath(Environment.SpecialFolder.MyPictures)
            : Environment.ExpandEnvironmentVariables(folder.Trim());
        if (!Directory.Exists(folder)) return Array.Empty<WallpaperItem>();
        limit = Math.Clamp(limit, 1, 500);
        return new DirectoryInfo(folder).EnumerateFiles()
            .Where(f => Exts.Contains(f.Extension.ToLowerInvariant()))
            .OrderByDescending(f => f.LastWriteTimeUtc).Take(limit)
            .Select(f => Item(f.FullName)).ToArray();
    }

    // ---- thumbnails: shell thumbnail provider first (handles webp when a codec exists), System.Drawing second; cached on disk ----
    static async Task<string?> ThumbAsync(string path, int size)
    {
        size = Math.Clamp(size, 32, 1024);
        if (!File.Exists(path) || !Exts.Contains(Path.GetExtension(path).ToLowerInvariant())) return null;
        var fi = new FileInfo(path);
        var key = Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes($"{path.ToLowerInvariant()}|{fi.LastWriteTimeUtc.Ticks}|{fi.Length}|{size}")));
        var cache = Paths.Sub("cache", "thumbs", key + ".jpg");
        try { if (File.Exists(cache)) return Imaging.DataUrl("image/jpeg", await File.ReadAllBytesAsync(cache)); } catch { }
        var jpeg = await Sta.Run(() =>
        {
            using var bmp = Imaging.ShellImage(path, size, 0x8 /* THUMBNAILONLY */);
            if (bmp is not null) return Imaging.EncodeJpeg(bmp, 82);
            try
            {
                using var img = System.Drawing.Image.FromFile(path);
                using var fit = Imaging.Fit(img, size);
                return Imaging.EncodeJpeg(fit, 82);
            }
            catch { return null; }
        });
        if (jpeg is null) return null;
        try { await File.WriteAllBytesAsync(cache, jpeg); } catch { }
        return Imaging.DataUrl("image/jpeg", jpeg);
    }
}
