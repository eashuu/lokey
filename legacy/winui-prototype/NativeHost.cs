using System.Runtime.InteropServices;
using System.Text;
using Windows.Graphics.Imaging;
using Windows.Storage;

namespace Hitodama.Shell;

// One hidden window that receives everything system-wide: hotkeys, wallpaper/display changes,
// fullscreen-app notifications (appbar), foreground changes (Foreground.cs) and "open settings" from a second instance.
// Event-driven, so the app never polls.
public sealed class MessageWindow : IDisposable
{
    public const string ClassName = "HitodamaMessageWindow";
    public const uint WM_SHOW_SETTINGS = 0x8002; // WM_APP + 2
    const uint WM_APPBAR = 0x8001, WM_HOTKEY = 0x0312, WM_SETTINGCHANGE = 0x001A, WM_DISPLAYCHANGE = 0x007E;

    delegate IntPtr WndProcFn(IntPtr h, uint msg, IntPtr w, IntPtr l);
    readonly WndProcFn _proc; // kept alive: the OS holds a raw pointer to it
    readonly List<int> _hotkeys = [];

    public IntPtr Handle { get; }
    public event Action<int>? Hotkey;
    public event Action? WallpaperChanged, DisplayChanged, ShowSettings;
    public event Action? AppBarChanged; // ABN_POSCHANGED: the taskbar or another appbar moved
    public event Action? FullscreenNotice; // ABN_FULLSCREENAPP; its flag is ignored (the desktop also raises it), callers re-check

    public MessageWindow()
    {
        _proc = Proc;
        var wc = new WNDCLASSEX
        {
            cbSize = Marshal.SizeOf<WNDCLASSEX>(),
            lpfnWndProc = Marshal.GetFunctionPointerForDelegate(_proc),
            hInstance = GetModuleHandle(null),
            lpszClassName = ClassName,
        };
        RegisterClassEx(ref wc);
        Handle = CreateWindowEx(0x80 /* WS_EX_TOOLWINDOW */, ClassName, "", 0x80000000 /* WS_POPUP */, 0, 0, 0, 0,
            IntPtr.Zero, IntPtr.Zero, wc.hInstance, IntPtr.Zero);

        // Registered as an appbar (but never claims screen space) only to receive ABN_FULLSCREENAPP.
        var abd = new APPBARDATA { cbSize = Marshal.SizeOf<APPBARDATA>(), hWnd = Handle, uCallbackMessage = WM_APPBAR };
        SHAppBarMessage(0 /* ABM_NEW */, ref abd);
    }

    IntPtr Proc(IntPtr h, uint msg, IntPtr w, IntPtr l)
    {
        switch (msg)
        {
            case WM_HOTKEY: Hotkey?.Invoke((int)w); return IntPtr.Zero;
            case WM_SETTINGCHANGE when (uint)w == 0x14: WallpaperChanged?.Invoke(); break; // SPI_SETDESKWALLPAPER
            case WM_DISPLAYCHANGE: DisplayChanged?.Invoke(); break;
            case WM_APPBAR when (uint)w == 1: AppBarChanged?.Invoke(); return IntPtr.Zero; // ABN_POSCHANGED
            case WM_APPBAR when (uint)w == 2: FullscreenNotice?.Invoke(); return IntPtr.Zero; // ABN_FULLSCREENAPP
            case WM_SHOW_SETTINGS: ShowSettings?.Invoke(); return IntPtr.Zero;
        }
        return DefWindowProc(h, msg, w, l);
    }

    /// <summary>Registers a hotkey like "Ctrl+Alt+Space". Returns false if the text is invalid or the combo is taken.</summary>
    public bool Register(int id, string combo)
    {
        if (!ParseHotkey(combo, out var mods, out var vk)) return false;
        if (!RegisterHotKey(Handle, id, mods | 0x4000 /* MOD_NOREPEAT */, vk)) return false;
        _hotkeys.Add(id);
        return true;
    }

    public void UnregisterAll()
    {
        foreach (var id in _hotkeys) UnregisterHotKey(Handle, id);
        _hotkeys.Clear();
    }

    public static bool ParseHotkey(string combo, out uint mods, out uint vk)
    {
        mods = 0; vk = 0;
        foreach (var raw in combo.Split('+', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            switch (raw.ToLowerInvariant())
            {
                case "ctrl" or "control": mods |= 2; break;
                case "alt": mods |= 1; break;
                case "shift": mods |= 4; break;
                case "win": mods |= 8; break;
                default:
                    var key = raw.Length == 1 && char.IsDigit(raw[0]) ? "Number" + raw : raw;
                    if (!Enum.TryParse<Windows.System.VirtualKey>(key, true, out var v)) return false;
                    vk = (uint)v;
                    break;
            }
        }
        return vk != 0;
    }

    /// <summary>Reserves a strip of thickness <paramref name="px"/> on a monitor edge (0 left, 1 top, 2 right, 3 bottom) like the
    /// taskbar does, so maximised windows and the work area exclude it. Returns the strip the system granted
    /// (it avoids the taskbar), in physical px. Pass 0 to release the space again.</summary>
    public (int l, int t, int r, int b) ReserveEdge(uint edge, int px, (int l, int t, int r, int b) monitor)
    {
        var (l, t, r, b) = monitor;
        var abd = new APPBARDATA { cbSize = Marshal.SizeOf<APPBARDATA>(), hWnd = Handle, uEdge = edge };
        abd.rc = new RECT { l = l, t = t, r = r, b = b };
        if (px <= 0)
        {
            abd.rc = new RECT { l = edge == 2 ? r : l, t = t, r = edge == 0 ? l : r, b = b };
            SHAppBarMessage(3 /* ABM_SETPOS */, ref abd);
            return (l, t, l, b);
        }
        SHAppBarMessage(2 /* ABM_QUERYPOS */, ref abd); // the system trims the rect around the taskbar
        if (edge == 0) abd.rc.r = abd.rc.l + px; else abd.rc.l = abd.rc.r - px;
        SHAppBarMessage(3 /* ABM_SETPOS */, ref abd);
        return (abd.rc.l, abd.rc.t, abd.rc.r, abd.rc.b);
    }

    public void Dispose()
    {
        UnregisterAll();
        var abd = new APPBARDATA { cbSize = Marshal.SizeOf<APPBARDATA>(), hWnd = Handle };
        SHAppBarMessage(1 /* ABM_REMOVE */, ref abd);
        DestroyWindow(Handle);
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct WNDCLASSEX
    {
        public int cbSize; public uint style; public IntPtr lpfnWndProc; public int cbClsExtra, cbWndExtra;
        public IntPtr hInstance, hIcon, hCursor, hbrBackground; public string? lpszMenuName; public string lpszClassName; public IntPtr hIconSm;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct APPBARDATA { public int cbSize; public IntPtr hWnd; public uint uCallbackMessage, uEdge; public RECT rc; public IntPtr lParam; }
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int l, t, r, b; }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern ushort RegisterClassEx(ref WNDCLASSEX wc);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr CreateWindowEx(uint ex, string cls, string name, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr param);
    [DllImport("user32.dll")] static extern IntPtr DefWindowProc(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string? name);
    [DllImport("shell32.dll")] static extern uint SHAppBarMessage(uint msg, ref APPBARDATA data);
}

// Sum of all instances of a PDH counter, e.g. GPU utilisation across engines. No WMI, no admin.
public sealed class PdhCounter : IDisposable
{
    IntPtr _query, _counter;
    public bool Valid { get; }

    public PdhCounter(string path)
    {
        Valid = PdhOpenQuery(null, IntPtr.Zero, out _query) == 0 &&
                PdhAddEnglishCounter(_query, path, IntPtr.Zero, out _counter) == 0 &&
                PdhCollectQueryData(_query) == 0;
    }

    /// <summary>Sum (or max) across instances since the previous call; null if unavailable.</summary>
    public double? Read(bool max = false)
    {
        if (!Valid || PdhCollectQueryData(_query) != 0) return null;
        uint size = 0;
        if (PdhGetFormattedCounterArray(_counter, 0x200, ref size, out _, IntPtr.Zero) != unchecked((int)0x800007D2) || size == 0) return null;
        var buf = Marshal.AllocHGlobal((int)size);
        try
        {
            if (PdhGetFormattedCounterArray(_counter, 0x200, ref size, out var count, buf) != 0) return null;
            double total = 0;
            int stride = IntPtr.Size + 16; // PDH_FMT_COUNTERVALUE_ITEM_W { name*, { status, pad, double } }
            for (int i = 0; i < count; i++)
            {
                double v = BitConverter.Int64BitsToDouble(Marshal.ReadInt64(buf, i * stride + IntPtr.Size + 8));
                total = max ? Math.Max(total, v) : total + v;
            }
            return count == 0 ? null : total;
        }
        finally { Marshal.FreeHGlobal(buf); }
    }

    public void Dispose() { if (_query != IntPtr.Zero) PdhCloseQuery(_query); _query = IntPtr.Zero; }

    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern int PdhOpenQuery(string? src, IntPtr user, out IntPtr q);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern int PdhAddEnglishCounter(IntPtr q, string path, IntPtr user, out IntPtr c);
    [DllImport("pdh.dll")] static extern int PdhCollectQueryData(IntPtr q);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern int PdhGetFormattedCounterArray(IntPtr c, uint fmt, ref uint size, out uint count, IntPtr buf);
    [DllImport("pdh.dll")] static extern int PdhCloseQuery(IntPtr q);
}

public static partial class Native
{
    [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(long pt, uint flags);
    [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr mon, int type, out uint x, out uint y);

    public static uint PrimaryDpi()
    {
        var mon = MonitorFromPoint(0, 1 /* MONITOR_DEFAULTTOPRIMARY */);
        return GetDpiForMonitor(mon, 0, out var x, out _) == 0 ? x : 96;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string? name);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);

    // ---- real fullscreen detection ----
    [StructLayout(LayoutKind.Sequential)] struct WRECT { public int l, t, r, b; }
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public WRECT monitor, work; public uint flags; }
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr mon, ref MONITORINFO mi);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out WRECT value, int size);

    public static string ClassOf(IntPtr h) { var sb = new StringBuilder(64); GetClassName(h, sb, 64); return sb.ToString(); }
    public static string TitleOf(IntPtr h) { var sb = new StringBuilder(256); GetWindowText(h, sb, 256); return sb.ToString(); }

    /// <summary>True only when a normal app window covers its whole monitor. The desktop, the taskbar and our own
    /// windows also cover the screen but are never "fullscreen"; ABN_FULLSCREENAPP reports them as such.</summary>
    public static bool IsRealFullscreen() => IsRealFullscreen(GetForegroundWindow());

    public static bool IsRealFullscreen(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero || !IsWindowVisible(hwnd)) return false;
        GetWindowThreadProcessId(hwnd, out var pid);
        if (pid == Environment.ProcessId) return false;
        if (ClassOf(hwnd) is "Progman" or "WorkerW" or "Shell_TrayWnd" or "Shell_SecondaryTrayWnd") return false;
        if (DwmGetWindowAttribute(hwnd, 9 /* DWMWA_EXTENDED_FRAME_BOUNDS */, out var r, Marshal.SizeOf<WRECT>()) != 0) return false;
        var mi = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
        if (!GetMonitorInfo(MonitorFromWindow(hwnd, 2 /* NEAREST */), ref mi)) return false;
        return r.l <= mi.monitor.l && r.t <= mi.monitor.t && r.r >= mi.monitor.r && r.b >= mi.monitor.b;
    }

    // ---- screen capture for --selftest ----
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleBitmap(IntPtr dc, int w, int h);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr o);
    [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, uint rop);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
    [StructLayout(LayoutKind.Sequential)]
    struct BMIH { public int biSize, biWidth, biHeight; public short biPlanes, biBitCount; public int biCompression, biSizeImage, biX, biY, biClrUsed, biClrImportant; }
    [DllImport("gdi32.dll")] static extern int GetDIBits(IntPtr dc, IntPtr bmp, uint start, uint lines, byte[] bits, ref BMIH bmi, uint usage);

    /// <summary>Saves the given physical-pixel screen rectangle as a PNG.</summary>
    public static async Task CaptureAsync(int x, int y, int w, int h, string path)
    {
        var screen = GetDC(IntPtr.Zero);
        var mem = CreateCompatibleDC(screen);
        var bmp = CreateCompatibleBitmap(screen, w, h);
        var old = SelectObject(mem, bmp);
        BitBlt(mem, 0, 0, w, h, screen, x, y, 0x00CC0020 /* SRCCOPY */);
        SelectObject(mem, old);
        var bmi = new BMIH { biSize = 40, biWidth = w, biHeight = -h, biPlanes = 1, biBitCount = 32 };
        var px = new byte[w * h * 4];
        GetDIBits(mem, bmp, 0, (uint)h, px, ref bmi, 0);
        DeleteObject(bmp); DeleteDC(mem); ReleaseDC(IntPtr.Zero, screen);

        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var folder = await StorageFolder.GetFolderFromPathAsync(Path.GetDirectoryName(path));
        var file = await folder.CreateFileAsync(Path.GetFileName(path), CreationCollisionOption.ReplaceExisting);
        using var stream = await file.OpenAsync(FileAccessMode.ReadWrite);
        var enc = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, stream);
        enc.SetPixelData(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Ignore, (uint)w, (uint)h, 96, 96, px);
        await enc.FlushAsync();
    }
}
