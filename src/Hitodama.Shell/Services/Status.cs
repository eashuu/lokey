using System.Globalization;
using System.Runtime.InteropServices;
using Microsoft.UI.Dispatching;
using Windows.Devices.Power;
using Windows.Devices.Radios;
using Windows.Networking.Connectivity;
using BatteryStatus = Windows.System.Power.BatteryStatus;

namespace Hitodama.Shell.Services;

// What the bar's status icons show: network, Bluetooth, battery, keyboard layout. Every source raises an
// event (network status, battery report, radio state, foreground change), so nothing polls.
public static class Status
{
    static DispatcherQueue _ui = null!;
    static Radio? _bt;
    static bool _started;

    public static event Action? Changed;

    public static string NetName { get; private set; } = "Not connected";
    public static bool Wifi { get; private set; }
    public static bool Online { get; private set; }

    public static bool HasBattery { get; private set; }
    public static int Percent { get; private set; }
    public static bool Charging { get; private set; }
    public static TimeSpan? TimeLeft { get; private set; }

    public static bool? Bluetooth { get; private set; }
    public static string Layout { get; private set; } = "";

    public static void Init(DispatcherQueue ui)
    {
        if (_started) return;
        _started = true;
        _ui = ui;
        try { NetworkInformation.NetworkStatusChanged += _ => ui.TryEnqueue(RefreshNetwork); } catch { }
        try
        {
            Battery.AggregateBattery.ReportUpdated += (_, _) => ui.TryEnqueue(RefreshBattery);
        }
        catch { }
        Foreground.Changed += RefreshLayout;
        RefreshNetwork();
        RefreshBattery();
        RefreshLayout();
        _ = WatchBluetoothAsync();
    }

    static void Raise() => Changed?.Invoke();

    static void RefreshNetwork()
    {
        try
        {
            var p = NetworkInformation.GetInternetConnectionProfile();
            Online = p is not null && p.GetNetworkConnectivityLevel() != NetworkConnectivityLevel.None;
            Wifi = p?.IsWlanConnectionProfile == true;
            NetName = p is null ? "Not connected" : p.ProfileName;
        }
        catch { Online = false; NetName = "Not connected"; }
        Raise();
    }

    static void RefreshBattery()
    {
        try
        {
            var r = Battery.AggregateBattery.GetReport();
            HasBattery = r.Status != BatteryStatus.NotPresent && r.FullChargeCapacityInMilliwattHours is > 0;
            if (HasBattery)
            {
                double full = r.FullChargeCapacityInMilliwattHours!.Value, rem = r.RemainingCapacityInMilliwattHours ?? 0;
                Percent = (int)Math.Round(100 * rem / full);
                Charging = r.Status == BatteryStatus.Charging;
                double rate = r.ChargeRateInMilliwatts ?? 0; // negative while discharging
                TimeLeft = r.Status == BatteryStatus.Discharging && rate < 0 ? TimeSpan.FromHours(rem / -rate)
                         : Charging && rate > 0 ? TimeSpan.FromHours((full - rem) / rate) : null;
            }
        }
        catch { HasBattery = false; }
        Raise();
    }

    static async Task WatchBluetoothAsync()
    {
        _bt = await SystemControls.GetRadioAsync(RadioKind.Bluetooth);
        if (_bt is null) return;
        _bt.StateChanged += (r, _) => _ui.TryEnqueue(() => { Bluetooth = r.State == RadioState.On; Raise(); });
        _ui.TryEnqueue(() => { Bluetooth = _bt.State == RadioState.On; Raise(); });
    }

    [DllImport("user32.dll")] static extern IntPtr GetKeyboardLayout(uint thread);

    static void RefreshLayout()
    {
        var fg = Native.GetForegroundWindow();
        uint thread = Native.GetWindowThreadProcessId(fg, out _);
        int lang = (int)GetKeyboardLayout(thread) & 0xFFFF;
        string code;
        try { code = new CultureInfo(lang).TwoLetterISOLanguageName.ToUpperInvariant(); } catch { code = ""; }
        if (code == Layout) return;
        Layout = code;
        Raise();
    }
}
