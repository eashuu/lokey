using System.Runtime.InteropServices;
using Lokey.Host.Pipe;
using Windows.Devices.Bluetooth;
using Windows.Devices.Enumeration;
using Windows.Devices.Radios;

namespace Lokey.Host.Services;

// Bluetooth radio state, paired/nearby devices, pair/forget (WinRT) and connect/disconnect (bthprops.cpl service state).
// The paired-device watcher and radio subscription start on the first bt.get/bt.devices and are event driven only.
internal static class Bluetooth
{
    const string BatteryKey = "{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2"; // System.Devices.BatteryLifePercent
    const string ConnKey = "System.Devices.Aep.IsConnected";
    const string CodMajorKey = "System.Devices.Aep.Bluetooth.Cod.Major";
    static readonly string[] Props = [BatteryKey, ConnKey, CodMajorKey];

    static readonly Debounce Deb = new(400, () => Events.Emit("bt.changed", Dispatcher.Ok));
    static readonly object WL = new();
    static bool _watching;
    static Radio? _radio;
    static DeviceWatcher? _w1, _w2;

    public static void Register()
    {
        Dispatcher.AddAsync("bt.get", async _ => await GetAsync());
        Dispatcher.AddAsync("bt.devices", async _ => { StartWatching(await SystemControls.GetRadioAsync(RadioKind.Bluetooth)); return await DevicesAsync(); });
        Dispatcher.AddAsync("bt.discover", async p => await DiscoverAsync(Math.Clamp(Args.OptInt(p, "seconds") ?? 8, 1, 15)));
        Dispatcher.AddAsync("bt.pair", async p => await PairAsync(Args.Str(p, "id")));
        Dispatcher.AddAsync("bt.forget", async p => await ForgetAsync(Args.Str(p, "id")));
        Dispatcher.AddAsync("bt.connect", async p => await SetConnectedAsync(Args.Str(p, "id"), true));
        Dispatcher.AddAsync("bt.disconnect", async p => await SetConnectedAsync(Args.Str(p, "id"), false));
    }

    static async Task<BtState> GetAsync()
    {
        var r = await SystemControls.GetRadioAsync(RadioKind.Bluetooth);
        if (r is not null) StartWatching(r);
        return new(r is not null, r?.State == RadioState.On);
    }

    // ---- change watching ----
    static void StartWatching(Radio? radio)
    {
        lock (WL)
        {
            if (_watching) return;
            _watching = true;
            if (radio is not null) { _radio = radio; radio.StateChanged += (_, _) => Deb.Poke(); }
            try
            {
                _w1 = Watch(BluetoothDevice.GetDeviceSelectorFromPairingState(true));
                _w2 = Watch(BluetoothLEDevice.GetDeviceSelectorFromPairingState(true));
            }
            catch (Exception e) { Log.Error("bt watcher", e); }
        }
    }

    static DeviceWatcher Watch(string selector)
    {
        var w = DeviceInformation.CreateWatcher(selector);
        bool ready = false; // Added fires once per existing device during the initial enumeration: ignore those
        w.EnumerationCompleted += (_, _) => ready = true;
        w.Added += (_, _) => { if (ready) Deb.Poke(); };
        w.Removed += (_, _) => { if (ready) Deb.Poke(); };
        w.Updated += (_, _) => { if (ready) Deb.Poke(); };
        w.Start();
        return w;
    }

    // ---- paired devices ----
    static string KindOf(BluetoothMajorClass c) => c switch
    {
        BluetoothMajorClass.AudioVideo => "audio",
        BluetoothMajorClass.Peripheral => "input",
        BluetoothMajorClass.Phone => "phone",
        BluetoothMajorClass.Computer => "computer",
        _ => "other",
    };

    static int? Battery(DeviceInformation i) => i.Properties.TryGetValue(BatteryKey, out var v) && v is byte b ? b : null;

    static async Task<BtDevice[]> DevicesAsync()
    {
        List<BtDevice> res = [];
        HashSet<ulong> seen = [];
        try
        {
            foreach (var i in await DeviceInformation.FindAllAsync(BluetoothDevice.GetDeviceSelectorFromPairingState(true), Props))
            {
                if (string.IsNullOrWhiteSpace(i.Name)) continue;
                using var d = await BluetoothDevice.FromIdAsync(i.Id);
                if (d is null) continue;
                seen.Add(d.BluetoothAddress);
                res.Add(new(i.Id, i.Name, KindOf(d.ClassOfDevice.MajorClass), true, d.ConnectionStatus == BluetoothConnectionStatus.Connected, Battery(i)));
            }
        }
        catch (Exception e) { Log.Error("bt devices", e); }
        try
        {
            foreach (var i in await DeviceInformation.FindAllAsync(BluetoothLEDevice.GetDeviceSelectorFromPairingState(true), Props))
            {
                if (string.IsNullOrWhiteSpace(i.Name)) continue;
                using var d = await BluetoothLEDevice.FromIdAsync(i.Id);
                if (d is null || !seen.Add(d.BluetoothAddress)) continue; // dual-mode devices already listed as classic
                var cat = d.Appearance.Category;
                var kind = cat == BluetoothLEAppearanceCategories.HumanInterfaceDevice ? "input"
                    : cat == BluetoothLEAppearanceCategories.Phone ? "phone"
                    : cat == BluetoothLEAppearanceCategories.Computer ? "computer" : "other";
                res.Add(new(i.Id, i.Name, kind, true, d.ConnectionStatus == BluetoothConnectionStatus.Connected, Battery(i)));
            }
        }
        catch (Exception e) { Log.Error("bt le devices", e); }
        return res.OrderByDescending(d => d.Connected).ThenBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase).ToArray();
    }

    // ---- discovery ----
    static async Task<BtDevice[]> DiscoverAsync(int seconds)
    {
        var found = new Dictionary<string, DeviceInformation>();
        var watchers = new List<DeviceWatcher>();
        try
        {
            foreach (var sel in new[] { BluetoothDevice.GetDeviceSelectorFromPairingState(false), BluetoothLEDevice.GetDeviceSelectorFromPairingState(false) })
            {
                var w = DeviceInformation.CreateWatcher(sel, new[] { CodMajorKey, BatteryKey, ConnKey });
                w.Added += (_, i) => { lock (found) found[i.Id] = i; };
                w.Updated += (_, u) => { lock (found) if (found.TryGetValue(u.Id, out var i)) i.Update(u); };
                w.Start();
                watchers.Add(w);
            }
            await Task.Delay(seconds * 1000);
        }
        catch (Exception e) { Log.Error("bt discover", e); }
        finally
        {
            foreach (var w in watchers) { try { if (w.Status is DeviceWatcherStatus.Started or DeviceWatcherStatus.EnumerationCompleted) w.Stop(); } catch { } }
        }
        lock (found)
            return found.Values.Where(i => !string.IsNullOrWhiteSpace(i.Name) && !i.Pairing.IsPaired)
                .Select(i => new BtDevice(i.Id, i.Name,
                    i.Properties.TryGetValue(CodMajorKey, out var m) && m is uint u ? KindOf((BluetoothMajorClass)u) : "other",
                    false, false, null))
                .OrderBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase).ToArray();
    }

    // ---- pair / forget ----
    static async Task<OkResult> PairAsync(string id)
    {
        try
        {
            var info = await DeviceInformation.CreateFromIdAsync(id);
            if (info.Pairing.IsPaired) return new(true);
            if (!info.Pairing.CanPair) return new(false, "this device cannot be paired");
            var custom = info.Pairing.Custom;
            const DevicePairingKinds Kinds = DevicePairingKinds.ConfirmOnly | DevicePairingKinds.ConfirmPinMatch;
            void OnReq(DeviceInformationCustomPairing _, DevicePairingRequestedEventArgs a) { if ((a.PairingKind & Kinds) != 0) a.Accept(); }
            custom.PairingRequested += OnReq;
            try
            {
                var r = await custom.PairAsync(Kinds, DevicePairingProtectionLevel.Default);
                return r.Status switch
                {
                    DevicePairingResultStatus.Paired or DevicePairingResultStatus.AlreadyPaired => new(true),
                    DevicePairingResultStatus.RequiredHandlerNotRegistered or DevicePairingResultStatus.RejectedByHandler
                        => new(false, "needs a PIN, pair it once in Windows settings"),
                    var s => new(false, s.ToString()),
                };
            }
            finally { custom.PairingRequested -= OnReq; }
        }
        catch (Exception e) { Log.Error("bt pair", e); return new(false, e.Message); }
    }

    static async Task<Empty> ForgetAsync(string id)
    {
        var info = await DeviceInformation.CreateFromIdAsync(id);
        var r = await info.Pairing.UnpairAsync();
        if (r.Status is not (DeviceUnpairingResultStatus.Unpaired or DeviceUnpairingResultStatus.AlreadyUnpaired))
            throw new InvalidOperationException("could not forget device: " + r.Status);
        return Dispatcher.Ok;
    }

    // ---- connect / disconnect: toggle the device's service state through bthprops.cpl ----
    static readonly Guid[] Services =
    [
        new("0000110b-0000-1000-8000-00805f9b34fb"), // A2DP sink
        new("00001108-0000-1000-8000-00805f9b34fb"), // headset
        new("0000111e-0000-1000-8000-00805f9b34fb"), // handsfree
        new("00001124-0000-1000-8000-00805f9b34fb"), // HID
    ];

    static async Task<OkResult> SetConnectedAsync(string id, bool connect)
    {
        try
        {
            using var dev = id.StartsWith("BluetoothLE", StringComparison.OrdinalIgnoreCase) ? null : await BluetoothDevice.FromIdAsync(id);
            if (dev is null) return new(false, "not supported for this device type");
            ulong addr = dev.BluetoothAddress;
            string? err = await Task.Run(async () => await ToggleServicesAsync(addr, connect));
            if (err is not null) return new(false, err);
            var want = connect ? BluetoothConnectionStatus.Connected : BluetoothConnectionStatus.Disconnected;
            for (int i = 0; i < 20; i++) // up to 6 s, only while the user asked for this
            {
                if (dev.ConnectionStatus == want) { Deb.Poke(); return new(true); }
                await Task.Delay(300);
            }
            return new(false, connect ? "device did not connect (is it on and in range?)" : "device is still connected");
        }
        catch (Exception e) { Log.Error("bt connect", e); return new(false, e.Message); }
    }

    // Returns an error text, or null when at least one service accepted the change.
    static async Task<string?> ToggleServicesAsync(ulong addr, bool connect)
    {
        var find = new FindRadioParams { Size = (uint)Marshal.SizeOf<FindRadioParams>() };
        IntPtr hFind = BluetoothFindFirstRadio(ref find, out var hRadio);
        if (hFind == IntPtr.Zero) return "no Bluetooth radio";
        try
        {
            var info = new DeviceInfo { Size = (uint)Marshal.SizeOf<DeviceInfo>(), Address = addr };
            if (BluetoothGetDeviceInfo(hRadio, ref info) != 0) return "device not found";
            bool any = false;
            foreach (var g in Services)
            {
                var guid = g;
                if (connect)
                {
                    BluetoothSetServiceState(hRadio, ref info, ref guid, 0);
                    await Task.Delay(300);
                }
                if (BluetoothSetServiceState(hRadio, ref info, ref guid, connect ? 1u : 0u) == 0) any = true;
            }
            return any ? null : "device has no supported service";
        }
        finally { CloseHandle(hRadio); BluetoothFindRadioClose(hFind); }
    }

    [StructLayout(LayoutKind.Sequential)] struct FindRadioParams { public uint Size; }
    [StructLayout(LayoutKind.Sequential)] struct SysTime { public ushort Y, M, DoW, D, H, Min, S, Ms; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct DeviceInfo
    {
        public uint Size;
        public ulong Address;
        public uint ClassOfDevice;
        public int Connected, Remembered, Authenticated;
        public SysTime LastSeen, LastUsed;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 248)] public string Name;
    }

    [DllImport("bthprops.cpl")] static extern IntPtr BluetoothFindFirstRadio(ref FindRadioParams p, out IntPtr radio);
    [DllImport("bthprops.cpl")] static extern bool BluetoothFindRadioClose(IntPtr h);
    [DllImport("bthprops.cpl")] static extern uint BluetoothGetDeviceInfo(IntPtr radio, ref DeviceInfo info);
    [DllImport("bthprops.cpl")] static extern uint BluetoothSetServiceState(IntPtr radio, ref DeviceInfo info, ref Guid service, uint flags);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
}
