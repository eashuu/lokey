using System.Runtime.InteropServices;
using Microsoft.UI.Dispatching;
using Microsoft.Win32;

namespace Hitodama.Shell.Services;

// Windows virtual desktops as Caelestia's "workspaces". The desktop list and the current desktop live in the
// registry (watched with RegNotifyChangeKeyValue, so nothing polls); which desktops hold windows comes from the
// documented IVirtualDesktopManager and is refreshed on those events and on foreground changes.
public static class Desktops
{
    const string Base = @"Software\Microsoft\Windows\CurrentVersion\Explorer";
    static DispatcherQueue _ui = null!;
    static readonly List<Guid> Ids = [];
    static Guid _current;
    static readonly HashSet<Guid> Used = [];
    static IVirtualDesktopManager? _mgr;
    static readonly List<(RegistryKey key, ManualResetEvent evt, RegisteredWaitHandle wait)> Watches = [];

    public static event Action? Changed;

    public static int Count => Math.Max(1, Ids.Count);
    public static int Current => Math.Max(0, Ids.IndexOf(_current));
    public static bool IsOccupied(int index) => index >= 0 && index < Ids.Count && Used.Contains(Ids[index]);

    static bool _started;

    public static void Init(DispatcherQueue ui)
    {
        if (_started) return;
        _started = true;
        _ui = ui;
        try { _mgr = (IVirtualDesktopManager)new VirtualDesktopManagerCls(); } catch { _mgr = null; }
        Refresh();
        int session = System.Diagnostics.Process.GetCurrentProcess().SessionId;
        foreach (var path in new[] { $@"{Base}\VirtualDesktops", $@"{Base}\SessionInfo\{session}\VirtualDesktops" }) Watch(path);
        Foreground.Changed += () => { if (RefreshUsed()) Changed?.Invoke(); };
    }

    public static void Shutdown()
    {
        foreach (var (key, evt, wait) in Watches) { wait.Unregister(null); evt.Dispose(); key.Dispose(); }
        Watches.Clear();
    }

    static void Watch(string path)
    {
        var key = Registry.CurrentUser.OpenSubKey(path);
        if (key is null) return;
        var evt = new ManualResetEvent(false);
        void Arm() => RegNotifyChangeKeyValue(key.Handle.DangerousGetHandle(), false, 0x4 /* LAST_SET */ | 0x1 /* NAME */, evt.SafeWaitHandle.DangerousGetHandle(), true);
        // The wait runs on a pool thread; all it does is queue a refresh and re-arm.
        var wait = ThreadPool.RegisterWaitForSingleObject(evt, (_, _) =>
        {
            evt.Reset();
            try { Arm(); } catch { }
            _ui.TryEnqueue(() => { Refresh(); Changed?.Invoke(); });
        }, null, Timeout.Infinite, false);
        Arm();
        Watches.Add((key, evt, wait));
    }

    static void Refresh()
    {
        using (var k = Registry.CurrentUser.OpenSubKey($@"{Base}\VirtualDesktops"))
        {
            Ids.Clear();
            if (k?.GetValue("VirtualDesktopIDs") is byte[] ids)
                for (int i = 0; i + 16 <= ids.Length; i += 16) Ids.Add(new Guid(ids.AsSpan(i, 16)));
            if (k?.GetValue("CurrentVirtualDesktop") is byte[] cur && cur.Length >= 16) _current = new Guid(cur.AsSpan(0, 16));
        }
        int session = System.Diagnostics.Process.GetCurrentProcess().SessionId;
        using (var k = Registry.CurrentUser.OpenSubKey($@"{Base}\SessionInfo\{session}\VirtualDesktops"))
            if (k?.GetValue("CurrentVirtualDesktop") is byte[] cur && cur.Length >= 16) _current = new Guid(cur.AsSpan(0, 16));
        if (Ids.Count == 0) { Ids.Add(_current); }
        RefreshUsed();
    }

    // Desktops that hold at least one ordinary top-level window.
    static bool RefreshUsed()
    {
        if (_mgr is null) return false;
        var seen = new HashSet<Guid>();
        EnumWindows((h, _) =>
        {
            if (!IsWindowVisible(h) || GetWindow(h, 4 /* GW_OWNER */) != IntPtr.Zero) return true;
            if ((GetWindowLong(h, -20) & 0x80) != 0 || GetWindowTextLength(h) == 0) return true; // tool windows, untitled
            Native.GetWindowThreadProcessId(h, out var pid);
            if (pid == Environment.ProcessId) return true;
            if (_mgr.GetWindowDesktopId(h, out var id) == 0) seen.Add(id);
            return true;
        }, IntPtr.Zero);
        if (seen.SetEquals(Used)) return false;
        Used.Clear();
        Used.UnionWith(seen);
        return true;
    }

    /// <summary>Go to desktop <paramref name="index"/> by sending Ctrl+Win+Left/Right, once per step. User-initiated only.</summary>
    public static async void Switch(int index)
    {
        index = Math.Clamp(index, 0, Count - 1);
        int delta = index - Current;
        for (int i = 0; i < Math.Abs(delta); i++)
        {
            Native.SendChord([0x11 /* Ctrl */, 0x5B /* Win */], delta > 0 ? (ushort)0x27 : (ushort)0x25);
            await Task.Delay(140); // let the switch animation finish before the next step
        }
    }

    public static void Step(int dir) => Switch(Current + dir);

    [ComImport, Guid("a5cd92ff-29be-454c-8d04-d82879fb3f1b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IVirtualDesktopManager
    {
        [PreserveSig] int IsWindowOnCurrentVirtualDesktop(IntPtr h, [MarshalAs(UnmanagedType.Bool)] out bool on);
        [PreserveSig] int GetWindowDesktopId(IntPtr h, out Guid id);
        [PreserveSig] int MoveWindowToDesktop(IntPtr h, ref Guid id);
    }

    [ComImport, Guid("aa509086-5ca9-4c25-8f95-589d3c07b48a")] class VirtualDesktopManagerCls { }

    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] static extern int GetWindowLong(IntPtr h, int index);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextLength(IntPtr h);
    [DllImport("advapi32.dll")] static extern int RegNotifyChangeKeyValue(IntPtr key, bool subtree, uint filter, IntPtr evt, bool async);
}
