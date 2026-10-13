using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Lokey.Host.Pipe;
using Windows.Devices.Radios;
using Windows.Devices.WiFi;
using Windows.Networking.Connectivity;
using Windows.Security.Credentials;

namespace Lokey.Host.Services;

// Wi-Fi via WinRT WiFiAdapter (first adapter). No adapter => every method answers "unavailable"/empty, never throws.
// Event driven (NetworkStatusChanged + radio StateChanged), attached on first use; no polling.
internal static class Wifi
{
    const long FreshMs = 20_000;

    // Objects from the last scan; ConnectAsync needs the very network objects the adapter reported.
    static WiFiAdapter? _scanAdapter;
    static WiFiAvailableNetwork[] _nets = [];
    static long _scanAt = -FreshMs;

    static bool _watching;
    static Radio? _radio; // kept referenced so its StateChanged subscription stays alive
    static string _last = "";
    static readonly Debounce Deb = new(400, () => _ = PushAsync());

    public static void Register()
    {
        Dispatcher.AddAsync("wifi.get", async _ => await GetAsync());
        Dispatcher.AddAsync("wifi.scan", async _ => (await ScanAsync()).Networks);
        Dispatcher.AddAsync("wifi.setOn", async p => { await SetOnAsync(Args.Bool(p, "on")); return Dispatcher.Ok; });
        Dispatcher.AddAsync("wifi.connect", async p => await ConnectAsync(Args.Str(p, "ssid"), Args.OptStr(p, "password")));
        Dispatcher.AddAsync("wifi.disconnect", async _ => { var (a, _) = await OpenAsync(); a?.Disconnect(); return Dispatcher.Ok; });
    }

    // ---- adapter / state ----
    static async Task<(WiFiAdapter? Adapter, bool Denied)> OpenAsync()
    {
        try
        {
            var list = await Windows.Devices.Enumeration.DeviceInformation.FindAllAsync(WiFiAdapter.GetDeviceSelector());
            if (list.Count == 0) return (null, false);
            var access = await WiFiAdapter.RequestAccessAsync();
            return (await WiFiAdapter.FromIdAsync(list[0].Id), access != WiFiAccessStatus.Allowed);
        }
        catch (Exception e) { Log.Error("wifi open", e); return (null, false); }
    }

    static async Task<WifiConnected?> ConnectedAsync(WiFiAdapter? a)
    {
        try
        {
            if (a is null) return null;
            var p = await a.NetworkAdapter.GetConnectedProfileAsync();
            if (p is null || !p.IsWlanConnectionProfile) return null;
            var ssid = p.WlanConnectionProfileDetails.GetConnectedSsid();
            return string.IsNullOrEmpty(ssid) ? null : new WifiConnected(ssid, (p.GetSignalBars() ?? 0) * 20);
        }
        catch { return null; }
    }

    static async Task<WifiState> GetAsync()
    {
        var (a, denied) = await OpenAsync();
        var radio = await SystemControls.GetRadioAsync(RadioKind.WiFi);
        if (a is null && radio is null) return new(false, false, null, false);
        Watch(radio);
        bool on = radio is null || radio.State == RadioState.On;
        var conn = on ? await ConnectedAsync(a) : null;
        if (denied && on) denied = (await NetshNetworksAsync()) is null;
        return new(true, on, conn, denied && on);
    }

    static void Watch(Radio? radio)
    {
        lock (Deb)
        {
            if (_watching) return;
            _watching = true;
            Windows.Networking.Connectivity.NetworkInformation.NetworkStatusChanged += _ => Deb.Poke();
            if (radio is not null) { _radio = radio; radio.StateChanged += (_, _) => Deb.Poke(); }
        }
    }

    static async Task PushAsync()
    {
        try
        {
            var s = await GetAsync();
            var key = JsonSerializer.Serialize(s, Json.O);
            lock (Deb) { if (key == _last) return; _last = key; }
            Events.Emit("wifi.changed", s);
        }
        catch (Exception e) { Log.Error("wifi push", e); }
    }

    static async Task SetOnAsync(bool on)
    {
        var r = await SystemControls.GetRadioAsync(RadioKind.WiFi) ?? throw new InvalidOperationException("no Wi-Fi radio");
        var res = await r.SetStateAsync(on ? RadioState.On : RadioState.Off);
        if (res != RadioAccessStatus.Allowed) throw new InvalidOperationException("Wi-Fi change denied: " + res);
    }

    // ---- scan ----
    static async Task<(WifiNetwork[] Networks, bool Denied)> ScanAsync()
    {
        var (a, denied) = await OpenAsync();
        if (a is null) return ([], false);
        var conn = await ConnectedAsync(a);
        var known = await KnownProfilesAsync();
        List<(string Ssid, int Signal, bool Secured)> raw = [];
        bool failed = denied;
        if (!denied)
        {
            try
            {
                var scan = a.ScanAsync().AsTask();
                if (await Task.WhenAny(scan, Task.Delay(8000)) != scan) throw new TimeoutException("wifi scan");
                await scan;
                var nets = a.NetworkReport.AvailableNetworks.ToArray();
                _scanAdapter = a; _nets = nets; _scanAt = Environment.TickCount64;
                foreach (var n in nets)
                    raw.Add((n.Ssid, Math.Clamp((int)Math.Round(2 * (n.NetworkRssiInDecibelMilliwatts + 100)), 0, 100),
                        n.SecuritySettings.NetworkAuthenticationType != NetworkAuthenticationType.Open80211));
            }
            catch (Exception e) { Log.Error("wifi scan", e); failed = true; }
        }
        if (failed && await NetshNetworksAsync() is { } fb) { raw = fb; denied = false; }

        var list = raw.Where(r => !string.IsNullOrWhiteSpace(r.Ssid))
            .GroupBy(r => r.Ssid)
            .Select(g => g.OrderByDescending(r => r.Signal).First())
            .Select(r => new WifiNetwork(r.Ssid, r.Signal, r.Secured, r.Ssid == conn?.Ssid, known.Contains(r.Ssid)))
            .OrderByDescending(n => n.Connected).ThenByDescending(n => n.Signal)
            .ToArray();
        return (list, denied);
    }

    // ---- connect ----
    static async Task<OkResult> ConnectAsync(string ssid, string? password)
    {
        try
        {
            WiFiAdapter? a; WiFiAvailableNetwork[] nets;
            if (_scanAdapter is not null && Environment.TickCount64 - _scanAt < FreshMs) { a = _scanAdapter; nets = _nets; }
            else
            {
                var (res, denied) = await ScanAsync();
                if (denied) return new(false, "Windows blocked Wi-Fi access (turn on Location services)");
                a = _scanAdapter; nets = _nets;
                if (res.Length == 0 && a is null) return new(false, "no Wi-Fi adapter");
            }
            var net = nets.Where(n => n.Ssid == ssid).OrderByDescending(n => n.NetworkRssiInDecibelMilliwatts).FirstOrDefault();
            if (a is null || net is null) return new(false, "network not found");
            var r = string.IsNullOrEmpty(password)
                ? await a.ConnectAsync(net, WiFiReconnectionKind.Automatic)
                : await a.ConnectAsync(net, WiFiReconnectionKind.Automatic, new PasswordCredential { Password = password });
            Deb.Poke();
            return r.ConnectionStatus switch
            {
                WiFiConnectionStatus.Success => new(true),
                WiFiConnectionStatus.InvalidCredential => new(false, "wrong password"),
                WiFiConnectionStatus.NetworkNotAvailable => new(false, "network not available"),
                WiFiConnectionStatus.Timeout => new(false, "timed out"),
                WiFiConnectionStatus.AccessRevoked => new(false, "access denied"),
                WiFiConnectionStatus.UnsupportedAuthenticationProtocol => new(false, "unsupported security type"),
                var s => new(false, s.ToString()),
            };
        }
        catch (Exception e) { Log.Error("wifi connect", e); return new(false, "connection failed"); } // never echoes the password
    }

    // ---- netsh (no admin needed) ----
    static async Task<string?> NetshAsync(string args)
    {
        try
        {
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance); // OEM code pages (netsh output)
            var psi = new ProcessStartInfo("netsh", args)
            {
                RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true,
                StandardOutputEncoding = Encoding.GetEncoding(System.Globalization.CultureInfo.CurrentCulture.TextInfo.OEMCodePage),
            };
            using var p = Process.Start(psi);
            if (p is null) return null;
            var read = p.StandardOutput.ReadToEndAsync();
            if (!p.WaitForExit(6000)) { try { p.Kill(); } catch { } return null; }
            return p.ExitCode == 0 ? await read : null;
        }
        catch { return null; }
    }

    // Saved profile names, e.g. "    All User Profile     : MyWifi". Section headers have no leading space; "<None>" has no colon.
    static readonly Regex ProfileRx = new(@"^\s+[^:\r\n]+:\s*(.+?)\s*$", RegexOptions.Multiline | RegexOptions.Compiled);

    static async Task<HashSet<string>> KnownProfilesAsync()
    {
        var o = await NetshAsync("wlan show profiles");
        return o is null ? [] : ProfileRx.Matches(o).Select(m => m.Groups[1].Value).ToHashSet();
    }

    // Fallback scan: null when netsh failed or reported nothing. English output only (ponytail: localized netsh keys are not parsed).
    static async Task<List<(string, int, bool)>?> NetshNetworksAsync()
    {
        var o = await NetshAsync("wlan show networks mode=bssid");
        if (o is null) return null;
        List<(string, int, bool)> res = [];
        string? ssid = null; int sig = 0; bool sec = false;
        void Flush() { if (ssid is not null) res.Add((ssid, sig, sec)); ssid = null; sig = 0; sec = false; }
        foreach (var raw in o.Split('\n'))
        {
            var line = raw.TrimEnd('\r');
            var m = Regex.Match(line, @"^SSID \d+ : (.*)$");
            if (m.Success) { Flush(); ssid = m.Groups[1].Value.Trim(); continue; }
            if ((m = Regex.Match(line, @"^\s+Authentication\s*:\s*(.+)$")).Success) sec = !m.Groups[1].Value.Trim().Equals("Open", StringComparison.OrdinalIgnoreCase);
            else if ((m = Regex.Match(line, @"^\s+Signal\s*:\s*(\d+)%")).Success) sig = Math.Max(sig, int.Parse(m.Groups[1].Value));
        }
        Flush();
        return res.Count > 0 ? res : null;
    }
}
