using System.Management;
using Lokey.Host.Native;
using Lokey.Host.Pipe;
using Windows.Devices.Radios;

namespace Lokey.Host.Services;

// Brightness (laptop panels via WMI), keep-awake, Bluetooth radio, ms-settings: shortcuts.
internal static class SystemControls
{
    // ---- brightness ----
    // ponytail: internal panels only; external monitors need DDC/CI (dxva2 SetVCPFeature).
    public static double? Brightness { get; private set; }
    static ManagementEventWatcher? _watcher;

    public static void InitBrightness()
    {
        Brightness = ReadBrightness();
        if (Brightness is null) return; // no controllable panel: no watcher, nothing to do
        try
        {
            _watcher = new ManagementEventWatcher(new ManagementScope(@"root\WMI"), new WqlEventQuery("SELECT * FROM WmiMonitorBrightnessEvent"));
            _watcher.EventArrived += (_, e) =>
            {
                try { Brightness = Convert.ToInt32(e.NewEvent["Brightness"]) / 100.0; Status.Poke(); } catch { }
            };
            _watcher.Start();
        }
        catch (Exception e) { Log.Error("brightness watcher", e); }
    }

    static double? ReadBrightness()
    {
        try
        {
            using var s = new ManagementObjectSearcher(@"root\WMI", "SELECT CurrentBrightness FROM WmiMonitorBrightness");
            foreach (ManagementObject o in s.Get()) return Convert.ToInt32(o["CurrentBrightness"]) / 100.0;
        }
        catch { }
        return null;
    }

    static void SetBrightness(double level)
    {
        if (Brightness is null) return; // desktop / external monitor: nothing to set
        int pct = (int)Math.Round(Math.Clamp(level, 0, 1) * 100);
        using var s = new ManagementObjectSearcher(@"root\WMI", "SELECT * FROM WmiMonitorBrightnessMethods");
        foreach (ManagementObject o in s.Get()) o.InvokeMethod("WmiSetBrightness", [1u, (byte)pct]);
        Brightness = pct / 100.0;
        Status.Poke();
    }

    // ---- keep awake: the execution-state request lives as long as the thread that made it ----
    static Thread? _awake;
    static ManualResetEventSlim? _awakeStop;
    public static bool KeepAwake { get; private set; }

    static void SetKeepAwake(bool on)
    {
        lock (typeof(SystemControls))
        {
            if (on == KeepAwake) return;
            KeepAwake = on;
            if (on)
            {
                var stop = _awakeStop = new ManualResetEventSlim(false);
                _awake = new Thread(() =>
                {
                    W.SetThreadExecutionState(0x80000000 | 1 | 2); // ES_CONTINUOUS | SYSTEM_REQUIRED | DISPLAY_REQUIRED
                    stop.Wait();
                    W.SetThreadExecutionState(0x80000000);
                }) { IsBackground = true, Name = "keep-awake" };
                _awake.Start();
            }
            else { _awakeStop?.Set(); _awake = null; }
        }
        Status.Poke();
    }

    // ---- bluetooth ----
    public static async Task<Radio?> GetRadioAsync(RadioKind kind)
    {
        try
        {
            if (await Radio.RequestAccessAsync() != RadioAccessStatus.Allowed) return null;
            return (await Radio.GetRadiosAsync()).FirstOrDefault(r => r.Kind == kind);
        }
        catch { return null; }
    }

    static async Task SetBluetoothAsync(bool on)
    {
        var r = await GetRadioAsync(RadioKind.Bluetooth);
        if (r is null) throw new InvalidOperationException("no Bluetooth radio");
        var res = await r.SetStateAsync(on ? RadioState.On : RadioState.Off);
        if (res != RadioAccessStatus.Allowed) throw new InvalidOperationException("Bluetooth change denied: " + res);
    }

    // ---- settings pages ----
    static void OpenSettings(string page)
    {
        var uri = page switch
        {
            "network" => "ms-settings:network",
            "bluetooth" => "ms-settings:bluetooth",
            "sound" => "ms-settings:sound",
            "display" => "ms-settings:display",
            "main" => "ms-settings:",
            _ => throw new ArgumentException($"unknown settings page '{page}'"),
        };
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(uri) { UseShellExecute = true });
    }

    public static void Register()
    {
        Dispatcher.Add("system.setBrightness", p => { SetBrightness(Args.Num(p, "level")); return Dispatcher.Ok; });
        Dispatcher.Add("system.setKeepAwake", p => { SetKeepAwake(Args.Bool(p, "on")); return Dispatcher.Ok; });
        Dispatcher.AddAsync("system.setBluetooth", async p => { await SetBluetoothAsync(Args.Bool(p, "on")); return Dispatcher.Ok; });
        Dispatcher.Add("system.openSettings", p => { OpenSettings(Args.Str(p, "page")); return Dispatcher.Ok; });
    }
}
