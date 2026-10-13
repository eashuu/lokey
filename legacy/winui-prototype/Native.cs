using System.Runtime.InteropServices;
using System.Text;

namespace Hitodama.Shell;

public static partial class Native
{
    // ---- window ----
    [DllImport("user32.dll")] public static extern int SetWindowRgn(IntPtr hWnd, IntPtr hRgn, bool redraw);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int l, int t, int r, int b);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr h);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    public static void SetRegion(IntPtr hwnd, int l, int t, int r, int b) =>
        SetWindowRgn(hwnd, CreateRectRgn(l, t, r, b), true); // system owns the region afterwards

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr h, int index, IntPtr value);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);

    public static void StripDwmFrame(IntPtr hwnd)
    {
        // Plain WS_POPUP: no caption, no resize border, so no 1px DWM strip along the top edge.
        SetWindowLongPtr(hwnd, -16, unchecked((IntPtr)0x80000000L) | 0x10000000); // GWL_STYLE = WS_POPUP | WS_VISIBLE
        SetWindowPos(hwnd, IntPtr.Zero, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0004 | 0x0010 | 0x0020); // NOSIZE|NOMOVE|NOZORDER|NOACTIVATE|FRAMECHANGED
        int noRound = 1;            // DWMWCP_DONOTROUND
        DwmSetWindowAttribute(hwnd, 33, ref noRound, 4);
        int noBorder = unchecked((int)0xFFFFFFFE); // DWMWA_COLOR_NONE
        DwmSetWindowAttribute(hwnd, 34, ref noBorder, 4);
    }

    [DllImport("user32.dll")] public static extern bool MessageBeep(uint type);

    /// <summary>Raise a topmost window above other topmost windows without activating it.</summary>
    public static void BringToTop(IntPtr hwnd) => SetWindowPos(hwnd, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);

    // ---- input: paste into whatever had focus before the island opened ----
    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public KEYBDINPUT ki; long pad; }
    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
    [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);

    public static void SendCtrlV() => SendChord([0x11], 0x56);

    /// <summary>Press modifiers + key, then release them in reverse (e.g. Ctrl+Win+Right). User-initiated actions only.</summary>
    public static void SendChord(ushort[] mods, ushort key)
    {
        static INPUT K(ushort vk, bool up) => new() { type = 1, ki = new KEYBDINPUT { wVk = vk, dwFlags = up ? 2u : 0u } };
        var inputs = mods.Select(m => K(m, false)).Append(K(key, false)).Append(K(key, true)).Concat(mods.Reverse().Select(m => K(m, true))).ToArray();
        SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
    }

    // ---- wallpaper ----
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern bool SystemParametersInfo(uint action, uint param, StringBuilder? sb, uint winIni);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SystemParametersInfoW")]
    static extern bool SystemParametersInfoStr(uint action, uint param, string value, uint winIni);

    public static string GetWallpaperPath()
    {
        var sb = new StringBuilder(520);
        SystemParametersInfo(0x73, 520, sb, 0); // SPI_GETDESKWALLPAPER
        return sb.ToString();
    }

    public static void SetWallpaper(string path) => SystemParametersInfoStr(0x14, 0, path, 3); // SPI_SETDESKWALLPAPER

    // ---- power ----
    [DllImport("user32.dll")] public static extern bool LockWorkStation();
    [DllImport("powrprof.dll")] public static extern bool SetSuspendState(bool hibernate, bool force, bool disableWake);
    [DllImport("user32.dll")] public static extern bool ExitWindowsEx(uint flags, uint reason);

    // ---- stats ----
    [DllImport("kernel32.dll")] public static extern bool GetSystemTimes(out long idle, out long kernel, out long user);

    [StructLayout(LayoutKind.Sequential)]
    public struct MEMORYSTATUSEX
    {
        public uint dwLength, dwMemoryLoad;
        public ulong ullTotalPhys, ullAvailPhys, ullTotalPageFile, ullAvailPageFile, ullTotalVirtual, ullAvailVirtual, ullAvailExtendedVirtual;
    }
    [DllImport("kernel32.dll")] static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX m);

    public static MEMORYSTATUSEX Memory()
    {
        var m = new MEMORYSTATUSEX { dwLength = (uint)Marshal.SizeOf<MEMORYSTATUSEX>() };
        GlobalMemoryStatusEx(ref m);
        return m;
    }

    // ---- shell icons (works for shell:AppsFolder items, so Store apps get real icons) ----
    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItemImageFactory { [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr hbmp); }
    [StructLayout(LayoutKind.Sequential)] struct SIZE { public int cx, cy; }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
        [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory item);

    [StructLayout(LayoutKind.Sequential)]
    struct BITMAPINFOHEADER { public int biSize, biWidth, biHeight; public short biPlanes, biBitCount; public int biCompression, biSizeImage, biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant; }
    [DllImport("gdi32.dll")] static extern int GetDIBits(IntPtr hdc, IntPtr hbmp, uint start, uint lines, byte[] bits, ref BITMAPINFOHEADER bmi, uint usage);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);

    [StructLayout(LayoutKind.Sequential)]
    struct BITMAP { public int bmType, bmWidth, bmHeight, bmWidthBytes; public ushort bmPlanes, bmBitsPixel; public IntPtr bmBits; }
    [DllImport("gdi32.dll")] static extern int GetObject(IntPtr h, int size, out BITMAP bmp);

    /// <summary>BGRA pixels of the item's icon scaled to exactly size x size, or null.</summary>
    public static byte[]? ShellIcon(string parsingName, int size)
    {
        try
        {
            SHCreateItemFromParsingName(parsingName, IntPtr.Zero, typeof(IShellItemImageFactory).GUID, out var factory);
            // SIIGBF_RESIZETOFIT (0): the bitmap matches the requested size, never larger.
            if (factory.GetImage(new SIZE { cx = size, cy = size }, 0, out var hbmp) != 0) return null;
            try
            {
                // Trust the real bitmap, not the request: GetDIBits writes width * lines pixels.
                GetObject(hbmp, Marshal.SizeOf<BITMAP>(), out var info);
                if (info.bmWidth != size || info.bmHeight != size) return null;
                var bmi = new BITMAPINFOHEADER { biSize = 40, biWidth = size, biHeight = -size, biPlanes = 1, biBitCount = 32 };
                var px = new byte[size * size * 4];
                var dc = GetDC(IntPtr.Zero);
                GetDIBits(dc, hbmp, 0, (uint)size, px, ref bmi, 0);
                ReleaseDC(IntPtr.Zero, dc);
                return px;
            }
            finally { DeleteObject(hbmp); }
        }
        catch { return null; }
    }
}
