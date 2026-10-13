using System.Runtime.InteropServices;
using Lokey.Host.Native;
using Lokey.Host.Pipe;

namespace Lokey.Host.Services;

// display.get/changed, user.get, power.do, sys.*: the small machine-level services.
internal static class Display
{
    static readonly Debounce Notify = new(250, Check);
    static string _last = "";

    public static void Register() => Dispatcher.Add("display.get", _ => Get());

    public static void Init()
    {
        Pump.On(Pump.WM_DISPLAYCHANGE, (_, _) => Notify.Poke());
        Pump.On(Pump.WM_SETTINGCHANGE, (w, _) => { if ((uint)w == 0x2F /* SPI_SETWORKAREA */) Notify.Poke(); });
        _last = System.Text.Json.JsonSerializer.Serialize(Get(), Json.O);
    }

    public static DisplayInfo Get()
    {
        var mon = W.MonitorFromPoint(0, 1 /* MONITOR_DEFAULTTOPRIMARY */);
        var mi = new W.MONITORINFO { cbSize = Marshal.SizeOf<W.MONITORINFO>() };
        W.GetMonitorInfo(mon, ref mi);
        uint dpi = W.GetDpiForMonitor(mon, 0, out var x, out _) == 0 ? x : 96;
        static Rect R(W.RECT r) => new(r.l, r.t, r.r - r.l, r.b - r.t);
        return new DisplayInfo(R(mi.monitor), R(mi.work), (int)dpi);
    }

    static void Check()
    {
        var d = Get();
        var json = System.Text.Json.JsonSerializer.Serialize(d, Json.O);
        lock (Notify) { if (json == _last) return; _last = json; }
        Events.Emit("display.changed", d);
    }
}

internal static class User
{
    static UserInfo? _cached;

    public static void Register() => Dispatcher.Add("user.get", _ => _cached ??= new UserInfo(Name(), Avatar(), Environment.MachineName));

    static string Name()
    {
        var dn = W.DisplayName();
        return string.IsNullOrWhiteSpace(dn) ? Environment.UserName : dn;
    }

    // The newest *.accountpicture-ms embeds PNG/JPEG renditions: lift the largest one out; fall back to Windows' default user.png.
    static string? Avatar()
    {
        try
        {
            byte[]? bytes = null;
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"Microsoft\Windows\AccountPictures");
            var file = Directory.Exists(dir) ? new DirectoryInfo(dir).GetFiles("*.accountpicture-ms").OrderByDescending(f => f.LastWriteTimeUtc).FirstOrDefault() : null;
            if (file is not null) bytes = Largest(File.ReadAllBytes(file.FullName));
            if (bytes is null)
            {
                var def = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), @"Microsoft\User Account Pictures\user.png");
                if (File.Exists(def)) bytes = File.ReadAllBytes(def);
            }
            return bytes is null ? null : Imaging.ToDataUrl(bytes, 96, png: true);
        }
        catch { return null; }
    }

    static byte[]? Largest(byte[] data)
    {
        byte[] png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], iend = [0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82], jpg = [0xFF, 0xD8, 0xFF], jend = [0xFF, 0xD9];
        (int s, int e) best = (0, 0);
        void Scan(byte[] start, byte[] end)
        {
            for (int i = data.AsSpan().IndexOf(start); i >= 0 && i < data.Length;)
            {
                int rel = data.AsSpan(i).IndexOf(end);
                if (rel < 0) break;
                int e = i + rel + end.Length;
                if (e - i > best.e - best.s) best = (i, e);
                int next = data.AsSpan(e).IndexOf(start);
                i = next < 0 ? -1 : e + next;
            }
        }
        Scan(png, iend);
        Scan(jpg, jend);
        return best.e > best.s ? data[best.s..best.e] : null;
    }
}

internal static class Power
{
    public static void Register()
    {
        Dispatcher.Add("sys.hello", _ => new HelloResult(1, "Lokey.Host " + typeof(Power).Assembly.GetName().Version));
        Dispatcher.Add("sys.quit", _ => Dispatcher.Ok); // the server exits right after the reply is flushed
        Dispatcher.Add("power.do", p => { Do(Args.Str(p, "action")); return Dispatcher.Ok; });
    }

    // No confirmation here: the UI confirms.
    static void Do(string action)
    {
        bool ok;
        switch (action)
        {
            case "lock": ok = W.LockWorkStation(); break;
            case "sleep": ok = W.SetSuspendState(false, false, false); break;
            case "hibernate": ok = W.SetSuspendState(true, false, false); break;
            case "signout": ok = W.ExitWindowsEx(0 /* EWX_LOGOFF */, 0); break;
            case "restart": W.EnableShutdownPrivilege(); ok = W.ExitWindowsEx(0x02 /* EWX_REBOOT */, 0x80000000); break;
            case "shutdown": W.EnableShutdownPrivilege(); ok = W.ExitWindowsEx(0x01 /* EWX_SHUTDOWN */ | 0x08 /* EWX_POWEROFF */, 0x80000000); break;
            default: throw new ArgumentException($"unknown power action '{action}'");
        }
        if (!ok) throw new InvalidOperationException($"{action} failed (error {Marshal.GetLastWin32Error()})");
    }
}
