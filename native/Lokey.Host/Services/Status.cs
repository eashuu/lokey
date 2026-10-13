using System.Globalization;
using System.Text.Json;
using Lokey.Host.Native;
using Lokey.Host.Pipe;
using Windows.Devices.Power;
using Windows.Devices.Radios;
using Windows.Networking.Connectivity;
using BatteryStatus = Windows.System.Power.BatteryStatus;

namespace Lokey.Host.Services;

// system.get / system.changed: network, bluetooth, battery, keyboard layout, keep-awake, brightness.
// Every source is an OS notification (network status, battery report, radio state, foreground change, WMI brightness event).
internal static class Status
{
    static readonly Debounce Emit = new(200, EmitIfChanged);
    static readonly object L = new();
    static Radio? _bt;
    static string _lastJson = "";
    static NetworkStat _net = new("none", "", null);
    static BatteryStat _bat = new(false, 0, false, null);

    public static void Register() => Dispatcher.Add("system.get", _ => Get());

    public static void Poke() => Emit.Poke();

    public static async Task InitAsync()
    {
        try { NetworkInformation.NetworkStatusChanged += _ => { RefreshNetwork(); Poke(); }; } catch (Exception e) { Log.Error("net events", e); }
        try { Battery.AggregateBattery.ReportUpdated += (_, _) => { RefreshBattery(); Poke(); }; } catch (Exception e) { Log.Error("battery events", e); }
        Foreground.Changed += _ => Poke(); // keyboard layout is per-thread: re-read when the active app changes
        RefreshNetwork();
        RefreshBattery();
        SystemControls.InitBrightness();
        NightLight.Watch();
        await WatchBluetoothAsync();
        lock (L) _lastJson = JsonSerializer.Serialize(Get(), Json.O);
    }

    static void RefreshNetwork()
    {
        NetworkStat n;
        try
        {
            var p = NetworkInformation.GetInternetConnectionProfile();
            bool online = p is not null && p.GetNetworkConnectivityLevel() != NetworkConnectivityLevel.None;
            if (!online) n = new("none", "", null);
            else
            {
                bool wifi = p!.IsWlanConnectionProfile;
                // signal: 0..100 (5 bars -> 20 each); null on wired links
                n = new(wifi ? "wifi" : "ethernet", p.ProfileName ?? "", wifi && p.GetSignalBars() is { } bars ? bars * 20 : null);
            }
        }
        catch { n = new("none", "", null); }
        lock (L) _net = n;
    }

    static void RefreshBattery()
    {
        BatteryStat b;
        try
        {
            var r = Battery.AggregateBattery.GetReport();
            bool present = r.Status != BatteryStatus.NotPresent && r.FullChargeCapacityInMilliwattHours is > 0;
            if (!present) b = new(false, 0, false, null);
            else
            {
                double full = r.FullChargeCapacityInMilliwattHours!.Value, rem = r.RemainingCapacityInMilliwattHours ?? 0;
                bool charging = r.Status == BatteryStatus.Charging;
                double rate = r.ChargeRateInMilliwatts ?? 0; // negative while discharging
                int? mins = r.Status == BatteryStatus.Discharging && rate < 0 ? (int)Math.Round(rem / -rate * 60)
                          : charging && rate > 0 ? (int)Math.Round((full - rem) / rate * 60) : null;
                b = new(true, (int)Math.Round(100 * rem / full), charging, mins);
            }
        }
        catch { b = new(false, 0, false, null); }
        lock (L) _bat = b;
    }

    static async Task WatchBluetoothAsync()
    {
        _bt = await SystemControls.GetRadioAsync(RadioKind.Bluetooth);
        if (_bt is not null) _bt.StateChanged += (_, _) => Poke();
    }

    static string Layout()
    {
        try
        {
            var fg = W.GetForegroundWindow();
            uint thread = W.GetWindowThreadProcessId(fg, out _);
            int lang = (int)(long)W.GetKeyboardLayout(thread) & 0xFFFF;
            return new CultureInfo(lang).ThreeLetterISOLanguageName.ToUpperInvariant();
        }
        catch { return ""; }
    }

    public static SystemStatus Get()
    {
        NetworkStat n; BatteryStat b;
        lock (L) { n = _net; b = _bat; }
        var bt = new BluetoothStat(_bt is not null, _bt?.State == RadioState.On);
        return new SystemStatus(n, bt, b, Layout(), SystemControls.KeepAwake, SystemControls.Brightness, SystemControls.DarkMode, NightLight.Get());
    }

    static void EmitIfChanged()
    {
        var s = Get();
        var json = JsonSerializer.Serialize(s, Json.O);
        lock (L) { if (json == _lastJson) return; _lastJson = json; }
        Events.Emit("system.changed", s);
    }
}
