using System.Collections.Concurrent;
using System.Runtime.InteropServices;

namespace Lokey.Host.Native;

// The one shared message-pump thread: a hidden top-level window (not message-only: message-only windows never receive
// the WM_SETTINGCHANGE / WM_DISPLAYCHANGE broadcasts) used for hotkeys, the clipboard listener and system notifications.
internal static class Pump
{
    public const uint WM_HOTKEY = 0x0312, WM_SETTINGCHANGE = 0x001A, WM_DISPLAYCHANGE = 0x007E, WM_CLIPBOARDUPDATE = 0x031D, WM_APPBAR = 0x8001;
    const uint WM_RUN = 0x8010;

    static readonly W.WndProc Proc = WndProc; // kept alive: the OS holds a raw pointer
    static readonly ConcurrentQueue<Action> Work = new();
    static readonly Dictionary<uint, List<Action<IntPtr, IntPtr>>> Handlers = new();
    static readonly ManualResetEventSlim Ready = new(false);
    static Thread? _t;

    public static IntPtr Hwnd { get; private set; }

    /// <summary>Subscribe to a window message. Handlers run on the pump thread and must be quick.</summary>
    public static void On(uint msg, Action<IntPtr, IntPtr> h)
    {
        lock (Handlers) { if (!Handlers.TryGetValue(msg, out var l)) Handlers[msg] = l = []; l.Add(h); }
    }

    public static void Start()
    {
        if (_t is not null) return;
        _t = new Thread(Loop) { IsBackground = true, Name = "pump" };
        _t.SetApartmentState(ApartmentState.STA);
        _t.Start();
        if (!Ready.Wait(5000) || Hwnd == IntPtr.Zero) throw new InvalidOperationException("message window failed to start");
    }

    static void Loop()
    {
        var wc = new W.WNDCLASSEX
        {
            cbSize = Marshal.SizeOf<W.WNDCLASSEX>(),
            lpfnWndProc = Marshal.GetFunctionPointerForDelegate(Proc),
            hInstance = W.GetModuleHandle(null),
            lpszClassName = "Lokey.Host.Pump",
        };
        W.RegisterClassEx(ref wc);
        // WS_POPUP, never shown; WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE.
        Hwnd = W.CreateWindowEx(0x80 | 0x08000000, wc.lpszClassName, "", 0x80000000, 0, 0, 0, 0, IntPtr.Zero, IntPtr.Zero, wc.hInstance, IntPtr.Zero);
        Ready.Set();
        while (W.GetMessage(out var m, IntPtr.Zero, 0, 0) > 0) { W.TranslateMessage(ref m); W.DispatchMessage(ref m); }
    }

    static IntPtr WndProc(IntPtr h, uint msg, IntPtr w, IntPtr l)
    {
        if (msg == WM_RUN)
        {
            while (Work.TryDequeue(out var a)) { try { a(); } catch (Exception e) { Log.Error("pump work", e); } }
            return IntPtr.Zero;
        }
        Action<IntPtr, IntPtr>[]? hs = null;
        lock (Handlers) if (Handlers.TryGetValue(msg, out var list)) hs = [.. list];
        if (hs is not null)
            foreach (var x in hs) { try { x(w, l); } catch (Exception e) { Log.Error("pump msg", e); } }
        return W.DefWindowProc(h, msg, w, l);
    }

    /// <summary>Run on the pump thread and await the result (needed for RegisterHotKey, clipboard listener, appbar).</summary>
    public static Task<T> Run<T>(Func<T> f)
    {
        var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        Work.Enqueue(() => { try { tcs.SetResult(f()); } catch (Exception e) { tcs.SetException(e); } });
        W.PostMessage(Hwnd, WM_RUN, IntPtr.Zero, IntPtr.Zero);
        return tcs.Task;
    }
}
