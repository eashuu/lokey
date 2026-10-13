using System.Runtime.InteropServices;
using Lokey.Host.Native;
using Lokey.Host.Pipe;
using Microsoft.Win32;

namespace Lokey.Host.Services;

// Virtual desktops. The list and the current desktop live in the registry (watched with RegNotifyChangeKeyValue, no polling);
// "occupied" comes from the documented IVirtualDesktopManager and is refreshed on those events and on foreground changes.
internal static class Desktops
{
    const string Base = @"Software\Microsoft\Windows\CurrentVersion\Explorer";
    static readonly object L = new();
    static readonly List<Guid> Ids = new();
    static Guid _current;
    static HashSet<Guid> _used = new();
    static IVirtualDesktopManager? _mgr;
    static string _lastJson = "";
    static readonly List<(RegistryKey key, ManualResetEvent evt, RegisteredWaitHandle wait)> Watches = new();
    static readonly Debounce Notify = new(150, () => _ = RefreshAndEmitAsync());

    public static void Register()
    {
        Dispatcher.AddAsync("desktops.get", async _ => { ReadRegistry(); await RefreshUsedAsync(); return Get(); });
        Dispatcher.AddAsync("desktops.switch", async p => { await SwitchAsync(Args.Int(p, "index")); return Dispatcher.Ok; });
    }

    public static async Task InitAsync()
    {
        try { _mgr = await Sta.Run(() => (IVirtualDesktopManager)new VirtualDesktopManagerCls()); } catch { _mgr = null; }
        ReadRegistry();
        await RefreshUsedAsync();
        lock (L) _lastJson = System.Text.Json.JsonSerializer.Serialize(Get(), Json.O);
        int session = System.Diagnostics.Process.GetCurrentProcess().SessionId;
        foreach (var path in new[] { $@"{Base}\VirtualDesktops", $@"{Base}\SessionInfo\{session}\VirtualDesktops" }) Watch(path);
        Foreground.Changed += _ => Notify.Poke();
    }

    public static void Shutdown()
    {
        foreach (var (key, evt, wait) in Watches) { try { wait.Unregister(null); evt.Dispose(); key.Dispose(); } catch { } }
        Watches.Clear();
    }

    static void Watch(string path)
    {
        var key = Registry.CurrentUser.OpenSubKey(path);
        if (key is null) return;
        var evt = new ManualResetEvent(false);
        void Arm() => W.RegNotifyChangeKeyValue(key.Handle.DangerousGetHandle(), false, 0x4 /* LAST_SET */ | 0x1 /* NAME */, evt.SafeWaitHandle.DangerousGetHandle(), true);
        var wait = ThreadPool.RegisterWaitForSingleObject(evt, (_, _) =>
        {
            evt.Reset();
            try { Arm(); } catch { }
            Notify.Poke();
        }, null, Timeout.Infinite, false);
        Arm();
        Watches.Add((key, evt, wait));
    }

    static void ReadRegistry()
    {
        lock (L)
        {
            Ids.Clear();
            using (var k = Registry.CurrentUser.OpenSubKey($@"{Base}\VirtualDesktops"))
            {
                if (k?.GetValue("VirtualDesktopIDs") is byte[] ids)
                    for (int i = 0; i + 16 <= ids.Length; i += 16) Ids.Add(new Guid(ids.AsSpan(i, 16)));
                if (k?.GetValue("CurrentVirtualDesktop") is byte[] cur && cur.Length >= 16) _current = new Guid(cur.AsSpan(0, 16));
            }
            int session = System.Diagnostics.Process.GetCurrentProcess().SessionId;
            using (var k = Registry.CurrentUser.OpenSubKey($@"{Base}\SessionInfo\{session}\VirtualDesktops"))
                if (k?.GetValue("CurrentVirtualDesktop") is byte[] cur && cur.Length >= 16) _current = new Guid(cur.AsSpan(0, 16));
            if (Ids.Count == 0 && _current != Guid.Empty) Ids.Add(_current);
        }
    }

    // Desktops that hold at least one ordinary top-level window of another app.
    static async Task RefreshUsedAsync()
    {
        var mgr = _mgr;
        if (mgr is null) return;
        var seen = await Sta.Run(() =>
        {
            var s = new HashSet<Guid>();
            W.EnumWindows((h, _) =>
            {
                if (!W.IsWindowVisible(h) || W.GetWindow(h, 4 /* GW_OWNER */) != IntPtr.Zero) return true;
                if ((W.GetWindowLong(h, -20) & 0x80) != 0 || W.GetWindowTextLength(h) == 0) return true; // tool windows, untitled
                W.GetWindowThreadProcessId(h, out var pid);
                if (pid == Environment.ProcessId) return true;
                if (mgr.GetWindowDesktopId(h, out var id) == 0) s.Add(id);
                return true;
            }, IntPtr.Zero);
            return s;
        });
        lock (L) _used = seen;
    }

    static async Task RefreshAndEmitAsync()
    {
        try
        {
            ReadRegistry();
            await RefreshUsedAsync();
            var s = Get();
            var json = System.Text.Json.JsonSerializer.Serialize(s, Json.O);
            lock (L) { if (json == _lastJson) return; _lastJson = json; }
            Events.Emit("desktops.changed", s);
        }
        catch (Exception e) { Log.Error("desktops refresh", e); }
    }

    public static DesktopsState Get()
    {
        lock (L)
        {
            int count = Math.Max(1, Ids.Count);
            int cur = Math.Max(0, Ids.IndexOf(_current));
            var occ = new bool[count];
            for (int i = 0; i < Ids.Count; i++) occ[i] = _used.Contains(Ids[i]);
            return new DesktopsState(count, cur, occ);
        }
    }

    /// <summary>Go to desktop <paramref name="index"/> by sending Ctrl+Win+Left/Right once per step. Only on desktops.switch.</summary>
    static async Task SwitchAsync(int index)
    {
        ReadRegistry();
        var s = Get();
        index = Math.Clamp(index, 0, s.Count - 1);
        int delta = index - s.Current;
        for (int i = 0; i < Math.Abs(delta); i++)
        {
            W.SendChord([0x11 /* Ctrl */, 0x5B /* Win */], delta > 0 ? (ushort)0x27 : (ushort)0x25);
            await Task.Delay(140); // let the switch animation finish before the next step
        }
    }

    [ComImport, Guid("a5cd92ff-29be-454c-8d04-d82879fb3f1b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IVirtualDesktopManager
    {
        [PreserveSig] int IsWindowOnCurrentVirtualDesktop(IntPtr h, [MarshalAs(UnmanagedType.Bool)] out bool on);
        [PreserveSig] int GetWindowDesktopId(IntPtr h, out Guid id);
        [PreserveSig] int MoveWindowToDesktop(IntPtr h, ref Guid id);
    }

    [ComImport, Guid("aa509086-5ca9-4c25-8f95-589d3c07b48a")] class VirtualDesktopManagerCls { }
}
