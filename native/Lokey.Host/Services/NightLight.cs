using Lokey.Host.Native;
using Lokey.Host.Pipe;
using Microsoft.Win32;

namespace Lokey.Host.Services;

// Night Light (blue-light filter). No public API: the on/off state is the per-user CloudStore blob below (undocumented, reverse-engineered
// by community scripts, e.g. nathanbabcock/nightlight-cli). Only the exact layout in Parse() is accepted; anything else = "unavailable".
//   OFF (41 bytes): 43 42 01 00 | 0a 02 01 00 | 2a 06 <varint ts, 5 bytes> | 2a 2b 0e 13 | 43 42 01 00 | d0 0a 02 c6 14 <varint ts, 9 bytes> | 00 00 00 00
//   ON  (43 bytes): same, but [18]=0x15 and the pair 10 00 inserted at [23..24] (right after the inner 43 42 01 00).
// The settings blob (...bluelightreduction.settings) is never touched.
internal static class NightLight
{
    const string KeyPath = @"Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\DefaultAccount\Current\default$windows.data.bluelightreduction.bluelightreductionstate\windows.data.bluelightreduction.bluelightreductionstate";
    static bool _watching;

    public static void Register() =>
        Dispatcher.AddAsync("system.setNightLight", p => Task.FromResult<object?>(SetAsync(Args.Bool(p, "on")).Result));

    static byte[]? ReadBlob()
    {
        using var k = Registry.CurrentUser.OpenSubKey(KeyPath); // read-only; null when absent
        return k?.GetValue("Data") as byte[];
    }

    /// <summary>true = on, false = off, null = unavailable / layout not recognised.</summary>
    public static bool? Get()
    {
        try { return Parse(ReadBlob()); } catch { return null; }
    }

    public static int? BlobLength() { try { return ReadBlob()?.Length; } catch { return null; } }

    static bool IsVarint(byte[] d, int at, int n)
    {
        for (int i = 0; i < n - 1; i++) if ((d[at + i] & 0x80) == 0) return false;
        return (d[at + n - 1] & 0x80) == 0;
    }

    static bool Match(byte[] d, int at, params byte[] want) => d.AsSpan(at, want.Length).SequenceEqual(want);

    public static bool? Parse(byte[]? d)
    {
        if (d is null || (d.Length != 41 && d.Length != 43)) return null;
        bool on = d.Length == 43;
        int o = on ? 2 : 0; // offset of everything after the inner header
        if (!Match(d, 0, 0x43, 0x42, 0x01, 0x00, 0x0a, 0x02, 0x01, 0x00, 0x2a, 0x06) || !IsVarint(d, 10, 5)) return null;
        if (!Match(d, 15, 0x2a, 0x2b, 0x0e) || d[18] != (on ? 0x15 : 0x13) || !Match(d, 19, 0x43, 0x42, 0x01, 0x00)) return null;
        if (on && !Match(d, 23, 0x10, 0x00)) return null;
        if (!Match(d, 23 + o, 0xd0, 0x0a, 0x02, 0xc6, 0x14) || !IsVarint(d, 28 + o, 9) || !Match(d, 37 + o, 0, 0, 0, 0)) return null;
        return on;
    }

    /// <summary>Pure: the blob that flips <paramref name="cur"/> to <paramref name="on"/>; null if cur is not recognised or the timestamp would become invalid.</summary>
    public static byte[]? Build(byte[] cur, bool on)
    {
        if (Parse(cur) is not { } now) return null;
        if (now == on) return (byte[])cur.Clone();
        var n = new List<byte>(cur);
        if (on) { n.InsertRange(23, [0x10, 0x00]); n[18] = 0x15; }
        else { n.RemoveRange(23, 2); n[18] = 0x13; }
        for (int i = 10; i < 15; i++) if (n[i] != 0xff) { n[i]++; break; } // how the documented scripts bump the timestamp so Windows sees a newer write
        var r = n.ToArray();
        return Parse(r) == on ? r : null;
    }

    public static Task<OkResult> SetAsync(bool on)
    {
        const string Unsupported = "Night Light is not supported on this Windows build";
        try
        {
            var cur = ReadBlob();
            if (Parse(cur) is null) return Task.FromResult(new OkResult(false, Unsupported));
            var next = Build(cur!, on);
            if (next is null) return Task.FromResult(new OkResult(false, Unsupported));
            if (!next.AsSpan().SequenceEqual(cur)) // already in the requested state: nothing to write
            {
                using var k = Registry.CurrentUser.OpenSubKey(KeyPath, writable: true); // never creates the key
                if (k is null) return Task.FromResult(new OkResult(false, Unsupported));
                k.SetValue("Data", next, RegistryValueKind.Binary);
            }
            if (Get() != on) return Task.FromResult(new OkResult(false, "Windows did not accept the change"));
            Status.Poke();
            return Task.FromResult(new OkResult(true));
        }
        catch (Exception e) { Log.Error("nightlight set", e); return Task.FromResult(new OkResult(false, "Could not change Night Light")); }
    }

    /// <summary>One dedicated thread blocked on RegNotifyChangeKeyValue (no polling). Started once, if the key exists at start-up,
    /// so a layout that only becomes recognisable after the first toggle in Settings is still picked up.</summary>
    public static void Watch()
    {
        if (_watching) return;
        RegistryKey? key;
        try { key = Registry.CurrentUser.OpenSubKey(KeyPath); } catch { return; }
        if (key is null) return;
        _watching = true;
        new Thread(() =>
        {
            using var evt = new AutoResetEvent(false);
            try
            {
                while (true)
                {
                    if (W.RegNotifyChangeKeyValue(key.Handle.DangerousGetHandle(), false, 0x4 /* LAST_SET */, evt.SafeWaitHandle.DangerousGetHandle(), true) != 0) break;
                    evt.WaitOne();
                    Status.Poke();
                }
            }
            catch (Exception e) { Log.Error("nightlight watch", e); }
            key.Dispose();
        }) { IsBackground = true, Name = "nightlight-watch" }.Start();
    }

    // Documented 41-byte OFF layout (synthetic fixture, not read from this machine).
    static readonly byte[] Sample = Convert.FromHexString("43420100 0a020100 2a06 9cce9aa606 2a2b0e13 43420100 d00a02c614 86e29e8d8ae2f0ec01 00000000".Replace(" ", ""));

    /// <summary>Pure toggle check on in-memory copies only (never touches the registry).</summary>
    public static string SelfCheck()
    {
        var cur = ReadBlob();
        bool real = Parse(cur) is not null;
        var src = real ? cur! : Sample;
        bool s0 = Parse(src)!.Value;
        var flipped = Build(src, !s0) ?? throw new Exception("build failed");
        if (Parse(flipped) != !s0 || flipped.Length != (s0 ? 41 : 43)) throw new Exception("state did not flip");
        var back = Build(flipped, s0) ?? throw new Exception("build back failed");
        if (Parse(back) != s0 || back.Length != src.Length) throw new Exception("did not flip back");
        for (int i = 0; i < src.Length; i++) if ((i < 10 || i > 14) && src[i] != back[i]) throw new Exception($"byte {i} differs after round trip");
        if (Parse(src.Take(src.Length - 1).ToArray()) is not null || Parse(null) is not null || Parse(new byte[13]) is not null) throw new Exception("strict validation too lax");
        return $"toggle round-trip ok on {(real ? "current" : "synthetic documented")} blob";
    }
}
