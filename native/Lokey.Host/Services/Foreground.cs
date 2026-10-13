using System.Diagnostics;
using System.Runtime.InteropServices;
using Lokey.Host.Native;
using Lokey.Host.Pipe;

namespace Lokey.Host.Services;

internal sealed record FgSnap(IntPtr Hwnd, string Title, string Exe, string Path, int Pid, string App);

// Foreground tracking through a WinEvent hook on its own thread (no polling) and the real-fullscreen transition detector.
// "Current" is the last window of ANOTHER app: the host's own and its parent's (Electron) windows never replace it,
// so it doubles as "the window that was active before the island took input".
internal static class Foreground
{
    const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
    static readonly W.WinEventProc Proc = OnEvent; // kept alive: the OS holds a raw pointer
    static readonly Dictionary<string, string> AppNames = new();
    static readonly object FL = new();
    static bool _full;
    static IntPtr _hook;

    public static int ParentPid { get; private set; }
    public static FgSnap Current { get; private set; } = new(IntPtr.Zero, "", "", "", 0, "");
    /// <summary>Raised on the hook thread whenever another app becomes foreground.</summary>
    public static event Action<FgSnap>? Changed;

    public static bool IsOwnPid(uint pid) => pid == (uint)Environment.ProcessId || (ParentPid != 0 && pid == (uint)ParentPid);
    public static bool IsOwn(IntPtr hwnd) { W.GetWindowThreadProcessId(hwnd, out var pid); return IsOwnPid(pid); }

    public static void Register()
    {
        Dispatcher.Add("foreground.get", _ =>
        {
            var c = Current;
            return new ForegroundInfo(c.Hwnd != IntPtr.Zero && W.IsWindow(c.Hwnd) ? W.TitleOf(c.Hwnd) : c.Title, c.Exe, c.Pid);
        });
    }

    public static void Start()
    {
        ParentPid = W.ParentPid();
        var ready = new ManualResetEventSlim(false);
        new Thread(() =>
        {
            _hook = W.SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, Proc, 0, 0, 0 /* OUTOFCONTEXT */);
            Capture(W.GetForegroundWindow());
            ready.Set();
            while (W.GetMessage(out var m, IntPtr.Zero, 0, 0) > 0) { W.TranslateMessage(ref m); W.DispatchMessage(ref m); }
        }) { IsBackground = true, Name = "foreground" }.Start();
        ready.Wait(3000);
    }

    /// <summary>ABN_FULLSCREENAPP arrives through a registered appbar (it never reserves space); it only triggers a re-check.</summary>
    public static async Task AttachAppBarAsync()
    {
        Pump.On(Pump.WM_APPBAR, (w, _) => { if ((uint)w == 2) CheckFullscreen(); });
        await Pump.Run(() =>
        {
            var abd = new W.APPBARDATA { cbSize = Marshal.SizeOf<W.APPBARDATA>(), hWnd = Pump.Hwnd, uCallbackMessage = Pump.WM_APPBAR };
            W.SHAppBarMessage(0 /* ABM_NEW */, ref abd);
            return 0;
        });
    }

    public static void Shutdown() { if (_hook != IntPtr.Zero) W.UnhookWinEvent(_hook); _hook = IntPtr.Zero; }

    static void OnEvent(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time)
    {
        try { Capture(hwnd == IntPtr.Zero ? W.GetForegroundWindow() : hwnd); }
        catch (Exception e) { Log.Error("fg hook", e); }
    }

    static void Capture(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) { CheckFullscreen(); return; }
        W.GetWindowThreadProcessId(hwnd, out var pid);
        if (!IsOwnPid(pid))
        {
            var path = W.ExePath(pid);
            var snap = new FgSnap(hwnd, W.TitleOf(hwnd), path.Length == 0 ? "" : System.IO.Path.GetFileName(path), path, (int)pid, DisplayName(path));
            Current = snap;
            Events.Emit("foreground.changed", new ForegroundInfo(snap.Title, snap.Exe, snap.Pid));
            Changed?.Invoke(snap);
        }
        CheckFullscreen(hwnd);
    }

    static string DisplayName(string path)
    {
        if (path.Length == 0) return "";
        if (AppNames.TryGetValue(path, out var n)) return n;
        try { n = FileVersionInfo.GetVersionInfo(path).FileDescription; } catch { }
        return AppNames[path] = string.IsNullOrWhiteSpace(n) ? System.IO.Path.GetFileNameWithoutExtension(path) : n.Trim();
    }

    // ---- fullscreen: emit only on transitions ----
    public static void CheckFullscreen() => CheckFullscreen(W.GetForegroundWindow());

    static void CheckFullscreen(IntPtr hwnd)
    {
        bool now = IsRealFullscreen(hwnd);
        lock (FL)
        {
            if (now == _full) return;
            _full = now;
        }
        Events.Emit("fullscreen.changed", new FullEvent(now));
    }

    /// <summary>True only when a normal app window covers its whole monitor. Never for the desktop, the taskbar, or our own/Electron windows.</summary>
    public static bool IsRealFullscreen(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero || !W.IsWindowVisible(hwnd)) return false;
        if (IsOwn(hwnd)) return false;
        if (W.ClassOf(hwnd) is "Progman" or "WorkerW" or "Shell_TrayWnd" or "Shell_SecondaryTrayWnd") return false;
        if (W.DwmGetWindowAttribute(hwnd, 9 /* DWMWA_EXTENDED_FRAME_BOUNDS */, out var r, Marshal.SizeOf<W.RECT>()) != 0) return false;
        var mi = new W.MONITORINFO { cbSize = Marshal.SizeOf<W.MONITORINFO>() };
        if (!W.GetMonitorInfo(W.MonitorFromWindow(hwnd, 2 /* NEAREST */), ref mi)) return false;
        return r.l <= mi.monitor.l && r.t <= mi.monitor.t && r.r >= mi.monitor.r && r.b >= mi.monitor.b;
    }
}
