using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading.Channels;
using Lokey.Host.Native;
using Lokey.Host.Pipe;

namespace Lokey.Host.Services;

// hotkey.register     -> RegisterHotKey on the shared message window  -> hotkey.pressed
// hotkey.registerHold -> WH_KEYBOARD_LL on its own thread (only installed while a hold chord exists) -> hotkey.down / hotkey.up
internal static class Hotkeys
{
    const int MOD_ALT = 1, MOD_CONTROL = 2, MOD_SHIFT = 4, MOD_WIN = 8, MOD_NOREPEAT = 0x4000;
    static readonly UIntPtr Magic = new(0x4C4B4859); // "LKHY": marks our own injected keys so the hook ignores them
    static readonly List<int> Registered = new();

    static readonly Dictionary<string, uint> Named = new(StringComparer.OrdinalIgnoreCase)
    {
        ["space"] = 0x20, ["enter"] = 0x0D, ["return"] = 0x0D, ["tab"] = 0x09, ["esc"] = 0x1B, ["escape"] = 0x1B, ["backspace"] = 0x08,
        ["delete"] = 0x2E, ["del"] = 0x2E, ["insert"] = 0x2D, ["ins"] = 0x2D, ["home"] = 0x24, ["end"] = 0x23,
        ["pageup"] = 0x21, ["pgup"] = 0x21, ["pagedown"] = 0x22, ["pgdn"] = 0x22,
        ["up"] = 0x26, ["down"] = 0x28, ["left"] = 0x25, ["right"] = 0x27,
        ["`"] = 0xC0, ["-"] = 0xBD, ["="] = 0xBB, [","] = 0xBC, ["."] = 0xBE, ["/"] = 0xBF, [";"] = 0xBA, ["'"] = 0xDE, ["["] = 0xDB, ["]"] = 0xDD, ["\\"] = 0xDC,
    };

    /// <summary>"Ctrl+Alt+Space" -> (modifier flags, vk). vk is 0 for pure-modifier chords (hold only).</summary>
    public static bool Parse(string combo, out int mods, out uint vk)
    {
        mods = 0; vk = 0;
        foreach (var raw in combo.Split('+', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            switch (raw.ToLowerInvariant())
            {
                case "ctrl" or "control": mods |= MOD_CONTROL; break;
                case "alt": mods |= MOD_ALT; break;
                case "shift": mods |= MOD_SHIFT; break;
                case "win" or "meta" or "super": mods |= MOD_WIN; break;
                default:
                    if (vk != 0) return false;
                    if (raw.Length == 1 && char.IsAsciiLetter(raw[0])) vk = char.ToUpperInvariant(raw[0]);
                    else if (raw.Length == 1 && char.IsAsciiDigit(raw[0])) vk = raw[0];
                    else if (raw.Length is 2 or 3 && (raw[0] is 'f' or 'F') && int.TryParse(raw.AsSpan(1), out var f) && f is >= 1 and <= 24) vk = (uint)(0x70 + f - 1);
                    else if (Named.TryGetValue(raw, out var n)) vk = n;
                    else return false;
                    break;
            }
        }
        return mods != 0 || vk != 0;
    }

    public static void Register()
    {
        Dispatcher.AddAsync("hotkey.register", async p => await RegisterAsync(Args.Int(p, "id"), Args.Str(p, "combo")));
        Dispatcher.AddAsync("hotkey.registerHold", async p => await RegisterHoldAsync(Args.Int(p, "id"), Args.Str(p, "combo")));
        Dispatcher.AddAsync("hotkey.unregisterAll", async _ => { await UnregisterAllAsync(); return Dispatcher.Ok; });
    }

    public static void Init() => Pump.On(Pump.WM_HOTKEY, (w, _) => Events.Emit("hotkey.pressed", new IdEvent((int)w)));

    static async Task<object?> RegisterAsync(int id, string combo)
    {
        if (id is < 0 or > 0xBFFF) return new HotkeyResult(false, "id out of range");
        if (!Parse(combo, out var mods, out var vk) || vk == 0) return new HotkeyResult(false, "cannot parse combo '" + combo + "'");
        var (ok, err) = await Pump.Run(() =>
        {
            bool r = W.RegisterHotKey(Pump.Hwnd, id, (uint)(mods | MOD_NOREPEAT), vk);
            return (r, r ? 0 : Marshal.GetLastWin32Error());
        });
        if (!ok) return new HotkeyResult(false, err == 1409 ? "already registered by another application" : $"RegisterHotKey failed (error {err})");
        lock (Registered) Registered.Add(id);
        return new HotkeyResult(true);
    }

    static async Task UnregisterAllAsync()
    {
        int[] ids;
        lock (Registered) { ids = [.. Registered]; Registered.Clear(); }
        if (ids.Length > 0) await Pump.Run(() => { foreach (var id in ids) W.UnregisterHotKey(Pump.Hwnd, id); return 0; });
        StopHook();
    }

    // ---------------- hold chords (low-level keyboard hook) ----------------
    sealed class Hold { public int Id; public bool Ctrl, Alt, Shift, Win; public uint Vk; public bool Active, MaskWin; }

    static readonly object HL = new();
    static Hold[] _holds = [];
    static Thread? _hookThread;
    static uint _hookTid;
    static IntPtr _hook;
    static readonly W.HookProc HookCb = HookProcImpl; // kept alive
    static readonly HashSet<uint> Down = new();       // raw vks currently held; touched only by the hook thread
    static readonly Channel<(int id, bool down)> Queue = Channel.CreateUnbounded<(int, bool)>(new UnboundedChannelOptions { SingleReader = true });
    static bool _consumer;

    static async Task<object?> RegisterHoldAsync(int id, string combo)
    {
        if (!Parse(combo, out var mods, out var vk)) return new HotkeyResult(false, "cannot parse combo '" + combo + "'");
        var h = new Hold { Id = id, Ctrl = (mods & MOD_CONTROL) != 0, Alt = (mods & MOD_ALT) != 0, Shift = (mods & MOD_SHIFT) != 0, Win = (mods & MOD_WIN) != 0, Vk = vk };
        var err = await EnsureHookAsync();
        if (err is not null) return new HotkeyResult(false, err);
        lock (HL) _holds = [.. _holds.Where(x => x.Id != id), h];
        return new HotkeyResult(true);
    }

    static Task<string?> EnsureHookAsync()
    {
        lock (HL)
        {
            if (_hookThread is not null) return Task.FromResult<string?>(null);
            var tcs = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
            if (!_consumer)
            {
                _consumer = true;
                _ = Task.Run(async () =>
                {
                    await foreach (var (id, down) in Queue.Reader.ReadAllAsync())
                        Events.Emit(down ? "hotkey.down" : "hotkey.up", new IdEvent(id));
                });
            }
            _hookThread = new Thread(() =>
            {
                _hookTid = W.GetCurrentThreadId();
                _hook = W.SetWindowsHookEx(13 /* WH_KEYBOARD_LL */, HookCb, W.GetModuleHandle(null), 0);
                if (_hook == IntPtr.Zero) { tcs.SetResult($"SetWindowsHookEx failed (error {Marshal.GetLastWin32Error()})"); lock (HL) _hookThread = null; return; }
                tcs.SetResult(null);
                while (W.GetMessage(out var m, IntPtr.Zero, 0, 0) > 0) { W.TranslateMessage(ref m); W.DispatchMessage(ref m); }
                W.UnhookWindowsHookEx(_hook);
                _hook = IntPtr.Zero;
                Down.Clear();
            }) { IsBackground = true, Name = "hotkey-hook" };
            _hookThread.Start();
            return tcs.Task;
        }
    }

    static void StopHook()
    {
        Thread? t;
        lock (HL) { _holds = []; t = _hookThread; _hookThread = null; }
        if (t is not null) W.PostThreadMessage(_hookTid, 0x0012 /* WM_QUIT */, IntPtr.Zero, IntPtr.Zero);
    }

    public static void Shutdown() => StopHook();

    static int Group(uint vk) => vk switch
    {
        0xA0 or 0xA1 or 0x10 => 1,  // shift
        0xA2 or 0xA3 or 0x11 => 2,  // ctrl
        0xA4 or 0xA5 or 0x12 => 3,  // alt
        0x5B or 0x5C => 4,          // win
        _ => 0,
    };

    // Kept tiny: bookkeeping only, events go through a channel. The single SendInput is the Start-menu mask.
    static unsafe IntPtr HookProcImpl(int code, IntPtr w, IntPtr l)
    {
        if (code < 0) return W.CallNextHookEx(_hook, code, w, l);
        try
        {
            var k = *(W.KBDLLHOOKSTRUCT*)l;
            if (k.dwExtraInfo == Magic) return W.CallNextHookEx(_hook, code, w, l);
            int msg = (int)w;
            bool down = msg is 0x100 or 0x104, up = msg is 0x101 or 0x105;
            if (!down && !up) return W.CallNextHookEx(_hook, code, w, l);
            uint vk = k.vkCode;
            // A missed key-up (Win+L, Ctrl+Alt+Del) must not leave a key "held" forever.
            if (down && Down.Count > 0)
                foreach (var d in Down.ToArray())
                    if (d != vk && (W.GetAsyncKeyState((int)d) & 0x8000) == 0) Down.Remove(d);
            if (Step(vk, down))
            {
                // Win was held as part of a modifier-only chord: Start would open on its release. Re-send the release behind a dummy key.
                var inputs = new[] { W.Key(0xFF, false, Magic), W.Key(0xFF, true, Magic), W.Key((ushort)vk, true, Magic) };
                W.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<W.INPUT>());
                return (IntPtr)1;
            }
        }
        catch { /* never throw into the hook chain */ }
        return W.CallNextHookEx(_hook, code, w, l);
    }

    /// <summary>The chord state machine (no OS calls). Returns true when this Win release must be swallowed and replayed behind a dummy key.</summary>
    static bool Step(uint vk, bool down)
    {
        if (down) Down.Add(vk); else Down.Remove(vk);
        bool winRelease = !down && Group(vk) == 4, swallow = false;
        foreach (var h in _holds)
        {
            bool ctrl = false, alt = false, shift = false, win = false, main = false, other = false;
            foreach (var d in Down)
                switch (Group(d)) { case 1: shift = true; break; case 2: ctrl = true; break; case 3: alt = true; break; case 4: win = true; break; default: if (d == h.Vk) main = true; else other = true; break; }
            bool exact = ctrl == h.Ctrl && alt == h.Alt && shift == h.Shift && win == h.Win && (h.Vk == 0 || main) && !other;
            if (exact && !h.Active) { h.Active = true; h.MaskWin = h.Win; Queue.Writer.TryWrite((h.Id, true)); }
            else if (!exact && h.Active) { h.Active = false; Queue.Writer.TryWrite((h.Id, false)); }
            if (other && down) h.MaskWin = false; // another key was pressed: Windows will not open Start on its own
            if (winRelease && h.MaskWin) { h.MaskWin = false; swallow = true; }
        }
        return swallow;
    }

    /// <summary>--selftest: combo parsing and the chord state machine with a synthetic key sequence (no hook, no real input).</summary>
    public static string SelfCheck()
    {
        void Need(bool c, string what) { if (!c) throw new Exception("hotkeys: " + what); }
        foreach (var (combo, mods, vk) in new[] { ("Ctrl+Alt+Space", 3, 0x20u), ("Ctrl+Alt+A", 3, 0x41u), ("Ctrl+Alt+End", 3, 0x23u), ("Ctrl+Shift+F12", 6, 0x7Bu), ("Alt+7", 1, 0x37u), ("Win+Shift+S", 12, 0x53u), ("Ctrl+Win", 10, 0u) })
        {
            Need(Parse(combo, out var m, out var v) && m == mods && v == vk, "parse " + combo);
        }
        Need(!Parse("Ctrl+Banana", out _, out _) && !Parse("A+B", out _, out _) && !Parse("", out _, out _), "reject bad combos");

        var saved = _holds;
        Down.Clear();
        while (Queue.Reader.TryRead(out _)) { }
        try
        {
            _holds = [new Hold { Id = 7, Ctrl = true, Win = true }, new Hold { Id = 8, Ctrl = true, Shift = true }];
            (int, bool)[] Drain() { var l = new List<(int, bool)>(); while (Queue.Reader.TryRead(out var e)) l.Add(e); return [.. l]; }
            Need(!Step(0xA2, true) && Drain().Length == 0, "ctrl alone is not a chord");
            Need(!Step(0x5B, true), "win down not swallowed");
            Need(Drain() is [(7, true)], "Ctrl+Win -> down(7)");
            Need(Step(0x5B, false), "Win release after clean Ctrl+Win must be masked");
            Need(Drain() is [(7, false)], "Ctrl+Win release -> up(7)");
            Step(0xA2, false);
            Need(Drain().Length == 0, "ctrl release emits nothing more");
            // Win+Ctrl+E: another key pressed, so no mask and the chord ends
            Step(0x5B, true); Step(0xA2, true); Drain();
            Step(0x45, true);
            Need(Drain() is [(7, false)], "extra key ends the chord");
            Need(!Step(0x5B, false), "no mask once another key was pressed");
            Step(0x45, false); Step(0xA2, false); Drain();
            // Ctrl+Shift
            Step(0xA0, true); Step(0xA2, true);
            Need(Drain() is [(8, true)], "Ctrl+Shift -> down(8)");
            Step(0xA0, false);
            Need(Drain() is [(8, false)], "Shift release -> up(8)");
            Step(0xA2, false);
        }
        finally { _holds = saved; Down.Clear(); while (Queue.Reader.TryRead(out _)) { } }
        return "parse + chord state machine ok";
    }
}
