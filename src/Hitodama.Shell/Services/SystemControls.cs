using System.Management;
using System.Runtime.InteropServices;
using Windows.Devices.Radios;

namespace Hitodama.Shell.Services;

// Brightness (laptop panels via WMI), radios (Wi-Fi/Bluetooth) and keep-awake (Caelestia's idle inhibitor).
public static class SystemControls
{
    // ---- brightness ----
    // ponytail: internal panels only; external monitors need DDC/CI (dxva2 SetVCPFeature).
    public static async Task<int?> GetBrightnessAsync() => await Task.Run<int?>(() =>
    {
        try
        {
            using var s = new ManagementObjectSearcher(@"root\WMI", "SELECT CurrentBrightness FROM WmiMonitorBrightness");
            foreach (ManagementObject o in s.Get()) return Convert.ToInt32(o["CurrentBrightness"]);
        }
        catch { }
        return null;
    });

    public static Task SetBrightnessAsync(int percent) => Task.Run(() =>
    {
        try
        {
            using var s = new ManagementObjectSearcher(@"root\WMI", "SELECT * FROM WmiMonitorBrightnessMethods");
            foreach (ManagementObject o in s.Get()) o.InvokeMethod("WmiSetBrightness", [1u, (byte)Math.Clamp(percent, 0, 100)]);
        }
        catch { }
    });

    // ---- radios ----
    public static async Task<Radio?> GetRadioAsync(RadioKind kind)
    {
        try
        {
            if (await Radio.RequestAccessAsync() != RadioAccessStatus.Allowed) return null;
            return (await Radio.GetRadiosAsync()).FirstOrDefault(r => r.Kind == kind);
        }
        catch { return null; }
    }

    // ---- keep awake ----
    [DllImport("kernel32.dll")] static extern uint SetThreadExecutionState(uint flags);
    const uint ES_CONTINUOUS = 0x80000000, ES_SYSTEM_REQUIRED = 1, ES_DISPLAY_REQUIRED = 2;

    public static bool KeepAwake { get; private set; }

    // Must be called from the UI thread: the request lives as long as that thread.
    public static void SetKeepAwake(bool on)
    {
        KeepAwake = on;
        SetThreadExecutionState(on ? ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED : ES_CONTINUOUS);
    }
}
