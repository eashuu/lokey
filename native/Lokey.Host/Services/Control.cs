using System.Diagnostics;
using System.Runtime.InteropServices;
using Lokey.Host.Native;
using Lokey.Host.Pipe;

namespace Lokey.Host.Services;

// What the voice assistant uses to drive the desktop: list and focus windows, and press a fixed set of well-known
// shortcuts by NAME (never arbitrary keys). Which of these needs the user's OK is decided in the app, not here.
internal static class Control
{
    static readonly UIntPtr Magic = new(0x4C4B4859);

    internal sealed record WinInfo(long Hwnd, string Title, string Exe, string App, bool Minimized, bool Active);

    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(uint pid);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);

    const ushort Ctrl = 0x11, Alt = 0x12, Shift = 0x10, Win = 0x5B;
    static readonly Dictionary<string, (ushort[] mods, ushort key)> Chords = new()
    {
        ["new_tab"] = ([Ctrl], 0x54), ["close_tab"] = ([Ctrl], 0x57), ["next_tab"] = ([Ctrl], 0x09), ["prev_tab"] = ([Ctrl, Shift], 0x09),
        ["reopen_tab"] = ([Ctrl, Shift], 0x54), ["reload"] = ([], 0x74), ["back"] = ([Alt], 0x25), ["forward"] = ([Alt], 0x27),
        ["address_bar"] = ([Ctrl], 0x4C), ["find"] = ([Ctrl], 0x46), ["new_window"] = ([Ctrl], 0x4E), ["save"] = ([Ctrl], 0x53),
        ["copy"] = ([Ctrl], 0x43), ["cut"] = ([Ctrl], 0x58), ["paste"] = ([Ctrl], 0x56), ["undo"] = ([Ctrl], 0x5A), ["redo"] = ([Ctrl], 0x59),
        ["select_all"] = ([Ctrl], 0x41), ["close_window"] = ([Alt], 0x73), ["minimize"] = ([Win], 0x28), ["maximize"] = ([Win], 0x26),
        ["snap_left"] = ([Win], 0x25), ["snap_right"] = ([Win], 0x27), ["show_desktop"] = ([Win], 0x44), ["task_view"] = ([Win], 0x09),
        ["screenshot"] = ([Win, Shift], 0x53), ["enter"] = ([], 0x0D), ["escape"] = ([], 0x1B),
    };

    public static void Register()
    {
        Dispatcher.Add("windows.list", _ => List());
        Dispatcher.AddAsync("windows.focus", async p => await FocusAsync(Args.Num(p, "hwnd"), false));
        // the app's own overlay: Windows refuses SetForegroundWindow from a process that has had no input (the hotkey went to us, not to Electron)
        Dispatcher.AddAsync("windows.forceForeground", async p => await FocusAsync(Args.Num(p, "hwnd"), true));
        Dispatcher.AddAsync("input.chord", async p => await ChordAsync(Args.Str(p, "name")));
        // the computer-use set: any key combination, the mouse, and processes (every call is permission-checked in the app first)
        Dispatcher.AddAsync("input.keys", async p => await KeysAsync(Args.Str(p, "combo")));
        Dispatcher.AddAsync("input.mouse", async p => await MouseAsync(Args.Str(p, "action"), Args.OptNum(p, "x"), Args.OptNum(p, "y"), Args.OptNum(p, "toX"), Args.OptNum(p, "toY"), Args.OptNum(p, "amount")));
        Dispatcher.Add("process.list", _ => Processes());
        Dispatcher.Add("process.close", p => EndProcess((int)Args.Num(p, "pid"), false));
        Dispatcher.Add("process.kill", p => EndProcess((int)Args.Num(p, "pid"), true));
    }

    static List<WinInfo> List()
    {
        var res = new List<WinInfo>();
        var fg = W.GetForegroundWindow();
        W.EnumWindows((h, _) =>
        {
            try
            {
                if (!W.IsWindowVisible(h) || W.GetWindowTextLength(h) == 0 || Foreground.IsOwn(h)) return true;
                int ex = W.GetWindowLong(h, -20);
                if ((ex & 0x80) != 0 && (ex & 0x40000) == 0) return true; // tool window without WS_EX_APPWINDOW
                if (DwmGetWindowAttribute(h, 14 /* CLOAKED */, out var cloaked, 4) == 0 && cloaked != 0) return true;
                var title = W.TitleOf(h);
                var cls = W.ClassOf(h);
                if (cls is "Progman" or "WorkerW" or "Shell_TrayWnd") return true;
                W.GetWindowThreadProcessId(h, out var pid);
                var path = W.ExePath(pid);
                var exe = path.Length == 0 ? "" : System.IO.Path.GetFileName(path);
                var app = path.Length == 0 ? "" : System.IO.Path.GetFileNameWithoutExtension(path);
                res.Add(new WinInfo(h.ToInt64(), title, exe, app, IsIconic(h), h == fg));
            }
            catch { }
            return res.Count < 60;
        }, IntPtr.Zero);
        return res;
    }

    static async Task<object?> FocusAsync(double hwnd, bool allowOwn)
    {
        var h = new IntPtr((long)hwnd);
        if (!W.IsWindow(h) || !W.IsWindowVisible(h) || (!allowOwn && Foreground.IsOwn(h))) return new TextInput.InsertResult(false, "no such window");
        if (IsIconic(h)) ShowWindow(h, 9 /* SW_RESTORE */);
        if (W.GetForegroundWindow() == h) return new TextInput.InsertResult(true);
        // 0) ask Windows to let this window's process take the foreground (no key injected)
        W.GetWindowThreadProcessId(h, out var targetPid);
        AllowSetForegroundWindow(targetPid);
        if (W.SetForegroundWindow(h)) { await Task.Delay(30); if (W.GetForegroundWindow() == h) return new TextInput.InsertResult(true); }
        // 1) share the foreground window's input queue for a moment: no key is injected, so the app in front sees nothing
        var fg = W.GetForegroundWindow();
        uint fgThread = fg == IntPtr.Zero ? 0 : W.GetWindowThreadProcessId(fg, out _);
        uint me = GetCurrentThreadId();
        bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
        try { BringWindowToTop(h); W.SetForegroundWindow(h); }
        finally { if (attached) AttachThreadInput(me, fgThread, false); }
        await Task.Delay(40);
        // 2) last resort: tap Alt (tagged as ours) so Windows grants the switch
        if (W.GetForegroundWindow() != h)
        {
            W.SendInput(2, [W.Key(Alt, false, Magic), W.Key(Alt, true, Magic)], Marshal.SizeOf<W.INPUT>());
            await Task.Delay(30);
            W.SetForegroundWindow(h);
            await Task.Delay(60);
        }
        var ok = W.GetForegroundWindow() == h;
        return new TextInput.InsertResult(ok, ok ? null : "Windows did not allow the switch");
    }

    internal sealed record ProcInfo(int Pid, string Name, string Title, int MemMb);

    static readonly HashSet<string> NeverEnd = new(StringComparer.OrdinalIgnoreCase) { "system", "idle", "csrss", "wininit", "winlogon", "services", "lsass", "smss", "dwm", "explorer", "svchost", "fontdrvhost", "registry", "memory compression", "lokey", "lokey.host" };

    static List<ProcInfo> Processes()
    {
        var res = new List<ProcInfo>();
        foreach (var p in Process.GetProcesses())
        {
            try
            {
                if (Foreground.IsOwnPid((uint)p.Id)) continue;
                var title = p.MainWindowTitle ?? "";
                if (title.Length == 0 && p.WorkingSet64 < 150L * 1024 * 1024) continue; // background noise
                res.Add(new ProcInfo(p.Id, p.ProcessName, title, (int)(p.WorkingSet64 / 1048576)));
            }
            catch { }
            finally { p.Dispose(); }
        }
        return res.OrderByDescending(r => r.Title.Length > 0).ThenByDescending(r => r.MemMb).Take(60).ToList();
    }

    static object EndProcess(int pid, bool kill)
    {
        try
        {
            if (Foreground.IsOwnPid((uint)pid)) return new TextInput.InsertResult(false, "that is Lokey itself");
            using var p = Process.GetProcessById(pid);
            if (NeverEnd.Contains(p.ProcessName)) return new TextInput.InsertResult(false, $"{p.ProcessName} is a system process");
            if (kill) { p.Kill(true); return new TextInput.InsertResult(true); }
            return new TextInput.InsertResult(p.CloseMainWindow(), p.MainWindowHandle == IntPtr.Zero ? "it has no window to close" : null);
        }
        catch (ArgumentException) { return new TextInput.InsertResult(false, "no such process"); }
        catch (Exception e) { return new TextInput.InsertResult(false, e.Message); }
    }

    static async Task<object?> KeysAsync(string combo)
    {
        if (!Hotkeys.Parse(combo, out var mods, out var vk) || vk == 0) return new TextInput.InsertResult(false, "give a combination ending in a key, like ctrl+shift+t");
        for (int i = 0; i < 30 && TextInput.AnyModifierDown(); i++) await Task.Delay(50);
        if (TextInput.AnyModifierDown()) return new TextInput.InsertResult(false, "release Ctrl/Alt/Shift/Win first");
        var m = new List<ushort>();
        if ((mods & 2) != 0) m.Add(Ctrl);
        if ((mods & 1) != 0) m.Add(Alt);
        if ((mods & 4) != 0) m.Add(Shift);
        if ((mods & 8) != 0) m.Add(Win);
        W.SendChord(m.ToArray(), (ushort)vk);
        return new TextInput.InsertResult(true);
    }

    static void MouseEvent(uint flags, int data = 0)
    {
        var inp = new W.INPUT { type = 0, u = new W.INPUTUNION { mi = new W.MOUSEINPUT { flags = flags, data = unchecked((uint)data), extra = Magic } } };
        W.SendInput(1, [inp], Marshal.SizeOf<W.INPUT>());
    }

    static async Task<object?> MouseAsync(string action, double? x, double? y, double? toX, double? toY, double? amount)
    {
        int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
        bool Inside(double? px, double? py) => px is not null && py is not null && px >= vx && px < vx + vw && py >= vy && py < vy + vh;
        if (action != "scroll" || x is not null)
        {
            if (!Inside(x, y)) return new TextInput.InsertResult(false, "that point is off the screen");
            SetCursorPos((int)x!.Value, (int)y!.Value);
            await Task.Delay(25);
        }
        switch (action)
        {
            case "move": break;
            case "click": MouseEvent(0x2); MouseEvent(0x4); break;
            case "double": MouseEvent(0x2); MouseEvent(0x4); await Task.Delay(60); MouseEvent(0x2); MouseEvent(0x4); break;
            case "right": MouseEvent(0x8); MouseEvent(0x10); break;
            case "middle": MouseEvent(0x20); MouseEvent(0x40); break;
            case "scroll": MouseEvent(0x800, -(int)Math.Max(-20, Math.Min(20, amount ?? 3)) * 120); break; // positive amount scrolls down
            case "drag":
                if (!Inside(toX, toY)) return new TextInput.InsertResult(false, "the drop point is off the screen");
                MouseEvent(0x2); await Task.Delay(80);
                for (int i = 1; i <= 12; i++) { SetCursorPos((int)(x!.Value + (toX!.Value - x.Value) * i / 12), (int)(y!.Value + (toY!.Value - y.Value) * i / 12)); await Task.Delay(16); }
                MouseEvent(0x4);
                break;
            default: return new TextInput.InsertResult(false, "unknown mouse action");
        }
        return new TextInput.InsertResult(true);
    }

    static async Task<object?> ChordAsync(string name)
    {
        if (!Chords.TryGetValue(name, out var c)) return new TextInput.InsertResult(false, "unknown shortcut");
        // physical modifiers still held (the push-to-talk chord) would change the shortcut: wait for them to go up
        for (int i = 0; i < 30 && TextInput.AnyModifierDown(); i++) await Task.Delay(50);
        if (TextInput.AnyModifierDown()) return new TextInput.InsertResult(false, "release Ctrl/Alt/Shift/Win first");
        W.SendChord(c.mods, c.key);
        return new TextInput.InsertResult(true);
    }

    public static string SelfCheck()
    {
        var l = List();
        if (Chords.Count < 25) throw new Exception("chord table shrank");
        return $"windows.list {l.Count} windows, {Chords.Count} named shortcuts";
    }
}
