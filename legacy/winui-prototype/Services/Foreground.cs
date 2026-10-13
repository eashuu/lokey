using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.UI.Dispatching;

namespace Hitodama.Shell.Services;

// Foreground window tracking through WinEvent hooks (no polling): drives the fullscreen re-check and the
// bar's "active window" entry. The hook callbacks only queue work; nothing happens inside them.
public static class Foreground
{
    delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);
    const uint EVENT_SYSTEM_FOREGROUND = 0x0003, EVENT_OBJECT_NAMECHANGE = 0x800C;

    static readonly WinEventProc Proc = OnEvent; // kept alive: the OS holds a raw pointer to it
    static IntPtr _fgHook, _nameHook;
    static DispatcherQueue _ui = null!;
    static readonly Dictionary<string, string> AppNames = [];

    /// <summary>Any foreground change (including our own windows). Raised on the UI thread.</summary>
    public static event Action? Changed;
    /// <summary>The active *other* app or its title changed. Raised on the UI thread.</summary>
    public static event Action? ActiveChanged;

    public static IntPtr Window { get; private set; }
    public static string Title { get; private set; } = "";
    public static string Exe { get; private set; } = "";
    public static string App { get; private set; } = "";

    public static void Init(DispatcherQueue ui)
    {
        _ui = ui;
        _fgHook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, Proc, 0, 0, 0 /* OUTOFCONTEXT */);
        Capture(Native.GetForegroundWindow());
    }

    /// <summary>Title changes are chatty system-wide, so the hook only exists while something shows the title.</summary>
    public static void TrackTitles(bool on)
    {
        if (on && _nameHook == IntPtr.Zero)
            _nameHook = SetWinEventHook(EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_NAMECHANGE, IntPtr.Zero, Proc, 0, 0, 2 /* OUTOFCONTEXT | SKIPOWNPROCESS */);
        else if (!on && _nameHook != IntPtr.Zero) { UnhookWinEvent(_nameHook); _nameHook = IntPtr.Zero; }
    }

    public static void Shutdown()
    {
        TrackTitles(false);
        if (_fgHook != IntPtr.Zero) UnhookWinEvent(_fgHook);
        _fgHook = IntPtr.Zero;
    }

    static void OnEvent(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time)
    {
        if (ev == EVENT_SYSTEM_FOREGROUND) _ui.TryEnqueue(() => { Capture(hwnd); Changed?.Invoke(); });
        else if (idObject == 0 && hwnd == Window) _ui.TryEnqueue(() => Capture(hwnd));
    }

    static void Capture(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return;
        Native.GetWindowThreadProcessId(hwnd, out var pid);
        if (pid == Environment.ProcessId) return; // hovering our own bar must not replace the active app
        string title = Native.TitleOf(hwnd), exe = hwnd == Window ? Exe : ExePath(pid);
        if (hwnd == Window && title == Title) return;
        Window = hwnd;
        Title = title;
        if (exe != Exe || App.Length == 0) { Exe = exe; App = DisplayName(exe); }
        ActiveChanged?.Invoke();
    }

    static readonly Dictionary<(string, int), Microsoft.UI.Xaml.Media.Imaging.WriteableBitmap?> Icons = [];

    /// <summary>The executable's shell icon at an exact pixel size (cached), or null.</summary>
    public static Microsoft.UI.Xaml.Media.Imaging.WriteableBitmap? Icon(string exe, int px)
    {
        if (exe.Length == 0) return null;
        if (Icons.TryGetValue((exe, px), out var cached)) return cached;
        var pixels = Native.ShellIcon(exe, px);
        Microsoft.UI.Xaml.Media.Imaging.WriteableBitmap? bmp = null;
        if (pixels is not null)
        {
            bmp = new Microsoft.UI.Xaml.Media.Imaging.WriteableBitmap(px, px);
            using (var s = System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions.AsStream(bmp.PixelBuffer)) s.Write(pixels);
            bmp.Invalidate();
        }
        return Icons[(exe, px)] = bmp;
    }

    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder sb, ref int size);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr mod, WinEventProc proc, uint pid, uint thread, uint flags);
    [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);

    static string ExePath(uint pid)
    {
        var h = OpenProcess(0x1000 /* QUERY_LIMITED_INFORMATION */, false, pid);
        if (h == IntPtr.Zero) return "";
        try
        {
            var sb = new StringBuilder(520);
            int size = sb.Capacity;
            return QueryFullProcessImageName(h, 0, sb, ref size) ? sb.ToString() : "";
        }
        finally { CloseHandle(h); }
    }

    static string DisplayName(string exe)
    {
        if (exe.Length == 0) return "";
        if (AppNames.TryGetValue(exe, out var n)) return n;
        try { n = FileVersionInfo.GetVersionInfo(exe).FileDescription; } catch { }
        return AppNames[exe] = string.IsNullOrWhiteSpace(n) ? Path.GetFileNameWithoutExtension(exe) : n.Trim();
    }
}
