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
    static readonly UIntPtr Magic = W.Magic;
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
    sealed class Hold { public int Id; public bool Ctrl, Alt, Shift, Win; public uint Vk; public bool Active, MaskWin, Blocked, MainSwallowed; public long Since = -1; }
    const int HoldMs = 200; // a chord fires only after being held this long with no other key

    static readonly object HL = new();
    static Hold[] _holds = [];
    static Thread? _hookThread;
    static volatile int _hookGen;       // bumped by StopHook: the hook thread exits when it no longer matches
    static long _alive;                 // last time the hook saw a (probe) key
    static long? _fakeNow;              // selftest clock
    static long Now => _fakeNow ?? Environment.TickCount64;
    static IntPtr _hook;
    static readonly W.HookProc HookCb = HookProcImpl; // kept alive
    static readonly HashSet<uint> Down = new();       // raw vks currently held; touched only by the hook thread
    static readonly Channel<(int id, bool down, bool cancelled)> Queue = Channel.CreateUnbounded<(int, bool, bool)>(new UnboundedChannelOptions { SingleReader = true });
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
                    await foreach (var (id, down, cancelled) in Queue.Reader.ReadAllAsync())
                    {
                        if (down) Events.Emit("hotkey.down", new IdEvent(id));
                        else Events.Emit("hotkey.up", new UpEvent(id, cancelled));
                    }
                });
            }
            int gen = ++_hookGen;
            _hookThread = new Thread(() =>
            {
                var hook = W.SetWindowsHookEx(13 /* WH_KEYBOARD_LL */, HookCb, W.GetModuleHandle(null), 0); // local: a stop/start race must never unhook the NEW hook
                _hook = hook;
                if (hook == IntPtr.Zero) { tcs.SetResult($"SetWindowsHookEx failed (error {Marshal.GetLastWin32Error()})"); lock (HL) _hookThread = null; return; }
                tcs.SetResult(null);
                _alive = Now;
                long probe = 0, probeAt = Now;
                // a key-up can be lost (an elevated window or the secure desktop has the keyboard): compare with the real key state; also fires pending hold chords
                W.SetTimer(IntPtr.Zero, 1, 40, IntPtr.Zero);
                while (_hookGen == gen && W.GetMessage(out var m, IntPtr.Zero, 0, 0) > 0)
                {
                    if (m.message == 0x0113 /* WM_TIMER */)
                    {
                        try { Reconcile(); } catch { }
                        // watchdog: Windows silently drops a low-level hook whose callback timed out. Every 10 s inject a tagged no-op key; if it never reaches us, reinstall.
                        long now = Now;
                        if (probe != 0 && _alive < probe && now - probe > 1000)
                        {
                            W.UnhookWindowsHookEx(hook);
                            hook = W.SetWindowsHookEx(13, HookCb, W.GetModuleHandle(null), 0);
                            _hook = hook; Down.Clear(); _alive = now; probe = 0; probeAt = now;
                            if (hook == IntPtr.Zero) break;
                        }
                        else if (probe == 0 && now - probeAt > 10000) { probe = now; probeAt = now; W.SendInput(2, [W.Key(0xFF, false, Magic), W.Key(0xFF, true, Magic)], Marshal.SizeOf<W.INPUT>()); }
                        else if (probe != 0 && _alive >= probe) probe = 0;
                        continue;
                    }
                    W.TranslateMessage(ref m); W.DispatchMessage(ref m);
                }
                if (hook != IntPtr.Zero) W.UnhookWindowsHookEx(hook);
                if (_hook == hook) _hook = IntPtr.Zero;
                Down.Clear();
            }) { IsBackground = true, Name = "hotkey-hook" };
            _hookThread.Start();
            return tcs.Task;
        }
    }

    static void StopHook()
    {
        lock (HL) { _holds = []; _hookThread = null; _hookGen++; } // the hook thread sees the new generation on its next 40 ms tick and exits
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
            if (k.dwExtraInfo == Magic) { _alive = Now; return W.CallNextHookEx(_hook, code, w, l); }
            int msg = (int)w;
            bool down = msg is 0x100 or 0x104, up = msg is 0x101 or 0x105;
            if (!down && !up) return W.CallNextHookEx(_hook, code, w, l);
            uint vk = k.vkCode;
            // A missed key-up (Win+L, Ctrl+Alt+Del) must not leave a key "held" forever.
            if (down && Down.Count > 0)
                foreach (var d in Down.ToArray())
                    if (d != vk && (W.GetAsyncKeyState((int)d) & 0x8000) == 0) Down.Remove(d);
            int sw = Step(vk, down);
            if (sw == 2) return (IntPtr)1; // main key of a matched chord: the app must not see it
            if (sw == 1)
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

    /// <summary>The chord state machine (no OS calls). Returns 1 when this Win release must be swallowed and replayed behind a dummy key, 2 when this is the main key of a matched chord (swallow only), else 0.</summary>
    static int Step(uint vk, bool down)
    {
        if (down) Down.Add(vk); else Down.Remove(vk);
        return Eval(down, !down && Group(vk) == 4, vk);
    }

    /// <summary>Drops keys that are no longer physically down (a lost key-up) and ends the chords that depended on them.</summary>
    static void Reconcile()
    {
        if (Down.Count == 0) return;
        bool changed = false;
        foreach (var d in Down.ToArray())
            if ((W.GetAsyncKeyState((int)d) & 0x8000) == 0) { Down.Remove(d); changed = true; }
        Eval(false, false, 0); // also fires hold chords whose delay has elapsed
    }

    static int Eval(bool down, bool winRelease, uint vk)
    {
        int swallow = 0;
        // AltGr arrives as a fake LCtrl + RAlt: it is a character key, never Ctrl+Alt
        bool altGr = Down.Contains(0xA5) && Down.Contains(0xA2) && !Down.Contains(0xA3);
        foreach (var h in _holds)
        {
            bool ctrl = false, alt = false, shift = false, win = false, main = false, other = false;
            foreach (var d in Down)
            {
                if (altGr && d is 0xA2 or 0xA5) { other = true; continue; }
                switch (Group(d)) { case 1: shift = true; break; case 2: ctrl = true; break; case 3: alt = true; break; case 4: win = true; break; default: if (d == h.Vk) main = true; else other = true; break; }
            }
            if (h.Blocked && !ctrl && !alt && !shift && !win && !other) h.Blocked = false; // everything let go: the chord may fire again
            if (other && !h.Active) h.Blocked = true;                                       // extra key before the delay elapsed: cancel, re-arm only after everything is released
            bool match = ctrl == h.Ctrl && alt == h.Alt && shift == h.Shift && win == h.Win && (h.Vk == 0 || main) && !other && !h.Blocked;
            if (!match) h.Since = -1; else if (h.Since < 0) h.Since = Now;
            bool exact = match && Now - h.Since >= HoldMs;
            if (exact && !h.Active) { h.Active = true; h.MaskWin = h.Win; Queue.Writer.TryWrite((h.Id, true, false)); }
            else if (!exact && h.Active)
            {
                h.Active = false;
                // another key ended the chord (typing, Esc): report it as cancelled and do not re-arm while the modifiers are still held
                if (other) h.Blocked = true;
                Queue.Writer.TryWrite((h.Id, false, other));
            }
            if (other && down) h.MaskWin = false; // another key was pressed: Windows will not open Start on its own
            if (winRelease && h.MaskWin) { h.MaskWin = false; if (swallow == 0) swallow = 1; }
            if (h.Vk != 0 && vk == h.Vk)
            {
                if (down && match) { h.MainSwallowed = true; swallow = 2; }
                else if (!down && h.MainSwallowed) { h.MainSwallowed = false; swallow = 2; }
            }
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
        long t = 1000; _fakeNow = t;
        void At(long ms) { _fakeNow = t + ms; Eval(false, false, 0); } // the 40 ms timer tick
        (int, bool, bool)[] Drain() { var l = new List<(int, bool, bool)>(); while (Queue.Reader.TryRead(out var e)) l.Add(e); return [.. l]; }
        try
        {
            _holds = [new Hold { Id = 7, Ctrl = true, Win = true }, new Hold { Id = 8, Ctrl = true, Shift = true }];
            Need(Step(0xA2, true) == 0 && Drain().Length == 0, "ctrl alone is not a chord");
            Need(Step(0x5B, true) == 0, "win down not swallowed");
            Need(Drain().Length == 0, "chord must not fire before the hold delay");
            At(HoldMs - 10); Need(Drain().Length == 0, "still pending at 190 ms");
            At(HoldMs + 10); Need(Drain() is [(7, true, false)], "Ctrl+Win -> down(7) after the delay");
            Need(Step(0x5B, false) == 1, "Win release after clean Ctrl+Win must be masked");
            Need(Drain() is [(7, false, false)], "Ctrl+Win release -> up(7)");
            Step(0xA2, false);
            Need(Drain().Length == 0, "ctrl release emits nothing more");
            // an extra key BEFORE the delay: never fires at all
            _fakeNow = t = 5000;
            Step(0x5B, true); Step(0xA2, true); Step(0x45, true);
            At(500); Need(Drain().Length == 0, "extra key before the delay cancels the chord");
            Step(0x45, false); At(900); Need(Drain().Length == 0, "no re-arm while modifiers stay held");
            Step(0x5B, false); Step(0xA2, false); Drain();
            // Win+Ctrl held to fire, then E: cancelled, no Win mask
            _fakeNow = t = 9000;
            Step(0x5B, true); Step(0xA2, true); At(300); Drain();
            Step(0x45, true);
            Need(Drain() is [(7, false, true)], "extra key ends the chord (cancelled)");
            Need(Step(0x5B, false) == 0, "no mask once another key was pressed");
            Step(0x45, false); Step(0xA2, false); Drain();
            // Ctrl+Shift
            _fakeNow = t = 20000;
            Step(0xA0, true); Step(0xA2, true); At(250);
            Need(Drain() is [(8, true, false)], "Ctrl+Shift -> down(8)");
            Step(0xA0, false);
            Need(Drain() is [(8, false, false)], "Shift release -> up(8)");
            Step(0xA2, false);
            // Ctrl+Shift, then Esc: cancelled, and releasing Esc while Ctrl+Shift are still held must NOT start the chord again
            _fakeNow = t = 30000;
            Step(0xA0, true); Step(0xA2, true); At(250); Drain();
            Step(0x1B, true);
            Need(Drain() is [(8, false, true)], "Esc cancels Ctrl+Shift");
            Step(0x1B, false); At(600);
            Need(Drain().Length == 0, "no re-arm while the modifiers stay held");
            Step(0xA0, false); Step(0xA2, false); Drain();
            _fakeNow = t = 40000;
            Step(0xA0, true); Step(0xA2, true); At(250);
            Need(Drain() is [(8, true, false)], "chord works again after everything was released");
            Step(0xA0, false); Step(0xA2, false); Drain();
            // AltGr = fake LCtrl + RAlt must not count as Ctrl+Alt
            _holds = [new Hold { Id = 9, Ctrl = true, Alt = true, Vk = 0x41 }];
            _fakeNow = t = 50000;
            Step(0xA2, true); Step(0xA5, true); Step(0x41, true); At(300);
            Need(Drain().Length == 0, "AltGr+A is not Ctrl+Alt+A");
            Step(0x41, false); Step(0xA5, false); Step(0xA2, false); Drain();
            // main key of an exact chord is swallowed (down and up); real Ctrl+Alt+A fires after the delay
            _fakeNow = t = 60000;
            Step(0xA2, true); Step(0xA4, true);
            Need(Step(0x41, true) == 2, "main key of a matched chord is swallowed");
            At(250); Need(Drain() is [(9, true, false)], "Ctrl+Alt+A -> down(9)");
            Need(Step(0x41, false) == 2, "main key release swallowed too");
            Need(Drain() is [(9, false, false)], "main key up ends the chord");
            Step(0xA4, false); Step(0xA2, false); Drain();
            Need(Step(0x41, true) == 0, "plain A is not swallowed");
            Step(0x41, false);
            // our own injected keys carry the Magic tag (the hook ignores them before Step is ever called)
            Need(W.Key(0x41, false, Magic).u.ki.extra == Magic, "Magic tag on injected keys");
        }
        finally { _holds = saved; _fakeNow = null; Down.Clear(); while (Queue.Reader.TryRead(out _)) { } }
        return "parse + chord state machine ok";
    }
}
