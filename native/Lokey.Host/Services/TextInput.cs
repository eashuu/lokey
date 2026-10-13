using System.Runtime.InteropServices;
using Lokey.Host.Native;
using Lokey.Host.Pipe;

namespace Lokey.Host.Services;

// Dictation support.
//   text.focusRect -> where the focused text field is (screen px) so the bubble can sit at its bottom edge, plus whether it
//                     is a password field (we never type into those). UI Automation first (browsers, Electron, UWP), then the
//                     classic caret / focus window, then the bottom of the foreground window.
//   text.insert    -> types the text into whatever has focus with Unicode key events (no clipboard involved). It waits for
//                     Ctrl/Alt/Shift/Win to be physically released (typing "a" with Ctrl held would be Ctrl+A) and refuses when
//                     the foreground window is no longer the one the dictation started in.
internal static class TextInput
{
    static readonly UIntPtr Magic = new(0x4C4B4859); // same marker as Hotkeys: our own injected keys are ignored by the chord hook

    public static void Register()
    {
        Dispatcher.AddAsync("text.focusRect", async _ => await FocusRectAsync());
        Dispatcher.AddAsync("text.insert", async p => await InsertAsync(Args.Str(p, "text"), (long)(Args.OptNum(p, "hwnd") ?? 0)));
    }

    internal sealed record FocusInfo(int X, int Y, int W, int H, string Source, bool Password, long Hwnd);
    internal sealed record InsertResult(bool Ok, [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? Reason = null);

    // ---------------- UI Automation (only what is needed; vtable order from UIAutomationClient.h) ----------------
    [ComImport, Guid("ff48dba4-60ef-4201-aa87-54103eef594e")] class CUIAutomation { }

    [ComImport, Guid("30cbe57d-d9d0-452a-ab13-7ac5ac4825ee"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IUIAutomation
    {
        [PreserveSig] int CompareElements(IntPtr a, IntPtr b, out int same);                              // 3
        [PreserveSig] int CompareRuntimeIds(IntPtr a, IntPtr b, out int same);                            // 4
        [PreserveSig] int GetRootElement(out IUIAutomationElement e);                                      // 5
        [PreserveSig] int ElementFromHandle(IntPtr hwnd, out IUIAutomationElement e);                      // 6
        [PreserveSig] int ElementFromPoint(long pt, out IUIAutomationElement e);                           // 7
        [PreserveSig] int GetFocusedElement(out IUIAutomationElement e);                                   // 8
    }

    [ComImport, Guid("d22108aa-8ac5-49a5-837b-37bbb3d7591e"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IUIAutomationElement
    {
        [PreserveSig] int M3(); [PreserveSig] int M4(); [PreserveSig] int M5(); [PreserveSig] int M6(); [PreserveSig] int M7();
        [PreserveSig] int M8(); [PreserveSig] int M9(); [PreserveSig] int M10(); [PreserveSig] int M11(); [PreserveSig] int M12();
        [PreserveSig] int M13(); [PreserveSig] int M14(); [PreserveSig] int M15(); [PreserveSig] int M16(); [PreserveSig] int M17();
        [PreserveSig] int M18(); [PreserveSig] int M19(); [PreserveSig] int M20();
        [PreserveSig] int get_CurrentControlType(out int type);                                            // 21
        [PreserveSig] int M22(); [PreserveSig] int M23(); [PreserveSig] int M24(); [PreserveSig] int M25(); [PreserveSig] int M26();
        [PreserveSig] int M27(); [PreserveSig] int M28(); [PreserveSig] int M29(); [PreserveSig] int M30(); [PreserveSig] int M31();
        [PreserveSig] int M32(); [PreserveSig] int M33(); [PreserveSig] int M34();
        [PreserveSig] int get_CurrentIsPassword(out int pw);                                               // 35
        [PreserveSig] int M36(); [PreserveSig] int M37(); [PreserveSig] int M38(); [PreserveSig] int M39(); [PreserveSig] int M40();
        [PreserveSig] int M41(); [PreserveSig] int M42();
        [PreserveSig] int get_CurrentBoundingRectangle(out W.RECT r);                                      // 43
    }

    [StructLayout(LayoutKind.Sequential)] struct GUITHREADINFO { public int cbSize; public uint flags; public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret; public W.RECT rcCaret; }
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO info);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out W.RECT r);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] static extern IntPtr GetDesktopWindow();
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int x, y; }

    static (W.RECT rect, bool password, int type)? Uia(Func<IUIAutomation, (int hr, IUIAutomationElement? e)> pick)
    {
        IUIAutomation? ua = null;
        try
        {
            ua = (IUIAutomation)new CUIAutomation();
            var (hr, e) = pick(ua);
            if (hr != 0 || e is null) return null;
            if (e.get_CurrentBoundingRectangle(out var r) != 0) return null;
            e.get_CurrentIsPassword(out var pw);
            e.get_CurrentControlType(out var type);
            return (r, pw != 0, type);
        }
        catch { return null; }
        finally { if (ua is not null) Marshal.ReleaseComObject(ua); }
    }

    static async Task<object?> FocusRectAsync()
    {
        var fg = W.GetForegroundWindow();
        // UIA can block on an unresponsive app: give it 700 ms, then fall back
        var uia = await Task.Run(() => Uia(a => { var hr = a.GetFocusedElement(out var e); return (hr, e); })).WaitAsync(TimeSpan.FromMilliseconds(700)).ContinueWith(t => t.IsCompletedSuccessfully ? t.Result : null);
        var vw = Math.Max(1, GetSystemMetrics(78));
        var vh = Math.Max(1, GetSystemMetrics(79));
        bool Sane(W.RECT r) { int w = r.r - r.l, h = r.b - r.t; return w >= 24 && h >= 12 && (long)w * h < 0.7 * vw * vh; }

        if (uia is { } u && Sane(u.rect))
            return new FocusInfo(u.rect.l, u.rect.t, u.rect.r - u.rect.l, u.rect.b - u.rect.t, "uia", u.password, fg.ToInt64());

        // classic Win32: caret rectangle, else the focused child window
        uint tid = W.GetWindowThreadProcessId(fg, out _);
        var gi = new GUITHREADINFO { cbSize = Marshal.SizeOf<GUITHREADINFO>() };
        if (GetGUIThreadInfo(tid, ref gi))
        {
            if (gi.hwndFocus != IntPtr.Zero && GetWindowRect(gi.hwndFocus, out var fr) && Sane(fr))
                return new FocusInfo(fr.l, fr.t, fr.r - fr.l, fr.b - fr.t, "focus", false, fg.ToInt64());
            if (gi.hwndCaret != IntPtr.Zero)
            {
                var p = new POINT { x = gi.rcCaret.l, y = gi.rcCaret.t };
                if (ClientToScreen(gi.hwndCaret, ref p))
                    return new FocusInfo(p.x - 160, p.y, 320, Math.Max(20, gi.rcCaret.b - gi.rcCaret.t), "caret", false, fg.ToInt64());
            }
        }
        if (fg != IntPtr.Zero && GetWindowRect(fg, out var wr))
            return new FocusInfo(wr.l, Math.Max(wr.t, wr.b - 120), wr.r - wr.l, 80, "window", false, fg.ToInt64());
        return new FocusInfo(0, vh - 120, vw, 80, "screen", false, fg.ToInt64());
    }

    // ---------------- typing ----------------
    const uint KEYEVENTF_KEYUP = 2, KEYEVENTF_UNICODE = 4;

    static async Task<object?> InsertAsync(string text, long hwnd)
    {
        if (string.IsNullOrEmpty(text)) return new InsertResult(true);
        if (text.Length > 4000) text = text[..4000];
        if (hwnd != 0 && W.GetForegroundWindow().ToInt64() != hwnd) return new InsertResult(false, "focus moved");
        // modifiers must be physically up, or the characters become shortcuts
        for (int i = 0; i < 40 && AnyModifierDown(); i++) await Task.Delay(50);
        if (AnyModifierDown()) return new InsertResult(false, "release Ctrl/Alt/Shift/Win first");
        if (hwnd != 0 && W.GetForegroundWindow().ToInt64() != hwnd) return new InsertResult(false, "focus moved");
        var inputs = new List<W.INPUT>(text.Length * 2);
        foreach (var ch in text.Replace("\r\n", "\n"))
        {
            if (ch == '\n') { inputs.Add(W.Key(0x0D, false, Magic)); inputs.Add(W.Key(0x0D, true, Magic)); continue; }
            if (ch == '\t') { inputs.Add(W.Key(0x09, false, Magic)); inputs.Add(W.Key(0x09, true, Magic)); continue; }
            if (char.IsControl(ch)) continue;
            inputs.Add(Unicode(ch, false));
            inputs.Add(Unicode(ch, true));
        }
        // chunks keep a slow app's input queue from overflowing
        for (int i = 0; i < inputs.Count; i += 200)
        {
            var chunk = inputs.GetRange(i, Math.Min(200, inputs.Count - i)).ToArray();
            if (W.SendInput((uint)chunk.Length, chunk, Marshal.SizeOf<W.INPUT>()) != chunk.Length) return new InsertResult(false, "the app blocked input (is it running as administrator?)");
            await Task.Delay(8);
        }
        return new InsertResult(true);
    }

    static W.INPUT Unicode(char ch, bool up) =>
        new() { type = 1, u = new W.INPUTUNION { ki = new W.KEYBDINPUT { wVk = 0, wScan = ch, dwFlags = KEYEVENTF_UNICODE | (up ? KEYEVENTF_KEYUP : 0u), extra = Magic } } };

    static bool AnyModifierDown()
    {
        foreach (var vk in new[] { 0x11, 0x12, 0x10, 0x5B, 0x5C }) if ((W.GetAsyncKeyState(vk) & 0x8000) != 0) return true;
        return false;
    }

    /// <summary>--selftest: UIA vtable positions against a known window (the desktop), plus the focused-element call is safe to make.</summary>
    public static string SelfCheck()
    {
        var desk = GetDesktopWindow();
        GetWindowRect(desk, out var win);
        var r = Task.Run(() => Uia(a => { var hr = a.ElementFromHandle(desk, out var e); return (hr, e); })).GetAwaiter().GetResult();
        if (r is null) throw new Exception("UIA ElementFromHandle(desktop) returned nothing");
        var d = r.Value.rect;
        if (Math.Abs(d.r - win.r) > 4 || Math.Abs(d.b - win.b) > 4 || Math.Abs(d.l - win.l) > 4 || Math.Abs(d.t - win.t) > 4)
            throw new Exception($"UIA rect {d.l},{d.t},{d.r},{d.b} != window {win.l},{win.t},{win.r},{win.b}: vtable offset wrong?");
        var f = Task.Run(() => Uia(a => { var hr = a.GetFocusedElement(out var e); return (hr, e); })).GetAwaiter().GetResult();
        return $"uia desktop rect ok ({d.r - d.l}x{d.b - d.t}); focused element {(f is null ? "none" : $"{f.Value.rect.r - f.Value.rect.l}x{f.Value.rect.b - f.Value.rect.t} type {f.Value.type}")}";
    }
}
