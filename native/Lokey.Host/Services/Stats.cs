using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using Lokey.Host.Native;
using Lokey.Host.Pipe;
using Microsoft.Win32;

namespace Lokey.Host.Services;

// stats.subscribe starts one ticker; stats.unsubscribe stops it and drops the PDH queries. Nothing runs otherwise.
internal static class Stats
{
    static readonly object L = new();
    static CancellationTokenSource? _cts;
    static int _intervalMs = 1000;

    // sampling state (guarded by L)
    static long _idle, _total, _rx, _tx;
    static DateTime _netAt, _procAt;
    static readonly Dictionary<int, long> PrevCpu = new();
    static PdhCounter? _gpuEng, _gpuMem, _thermal;
    static string? _cpuName, _gpuName;
    static long _vramTotal;
    static bool _gpuProbed;

    public static void Register()
    {
        Dispatcher.AddAsync("stats.subscribe", async p => await SubscribeAsync(Args.OptInt(p, "intervalMs") ?? 1000));
        Dispatcher.Add("stats.unsubscribe", _ => { Unsubscribe(); return Dispatcher.Ok; });
    }

    static async Task<object?> SubscribeAsync(int intervalMs)
    {
        bool start;
        lock (L)
        {
            _intervalMs = Math.Max(500, intervalMs);
            start = _cts is null;
            if (start) _cts = new CancellationTokenSource();
        }
        if (start)
        {
            await Task.Run(() => Sample());     // prime the delta counters
            await Task.Delay(250);              // so the first tick has real rates
            var ct = _cts!.Token;
            _ = Task.Run(() => LoopAsync(ct));
        }
        return await Task.Run(() => Sample());
    }

    static async Task LoopAsync(CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                int ms; lock (L) ms = _intervalMs;
                await Task.Delay(ms, ct);
                var t = Sample();
                if (!ct.IsCancellationRequested) Events.Emit("stats.tick", t);
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception e) { Log.Error("stats loop", e); }
    }

    static void Unsubscribe()
    {
        lock (L)
        {
            _cts?.Cancel(); _cts = null;
            _gpuEng?.Dispose(); _gpuMem?.Dispose(); _thermal?.Dispose();
            _gpuEng = _gpuMem = _thermal = null;
            _idle = _total = 0; _netAt = default; _procAt = default; PrevCpu.Clear();
        }
    }

    public static StatsTick Sample()
    {
        lock (L)
        {
            // ---- cpu ----
            W.GetSystemTimes(out var idle, out var kernel, out var user);
            long total = kernel + user; // kernel time includes idle
            double busy = _total == 0 || total == _total ? 0 : 1 - (double)(idle - _idle) / (total - _total);
            _idle = idle; _total = total;

            // ---- ram / disk / uptime ----
            var m = W.Memory();
            var sysRoot = Path.GetPathRoot(Environment.SystemDirectory) ?? "C:\\";
            long dUsed = 0, dTotal = 0;
            try { var d = new DriveInfo(sysRoot); dTotal = d.TotalSize; dUsed = d.TotalSize - d.AvailableFreeSpace; } catch { }

            // ---- net ----
            long rx = 0, tx = 0;
            try
            {
                foreach (var n in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (n.OperationalStatus != OperationalStatus.Up || n.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                    var s = n.GetIPv4Statistics();
                    rx += s.BytesReceived; tx += s.BytesSent;
                }
            }
            catch { }
            var now = DateTime.UtcNow;
            double secs = (now - _netAt).TotalSeconds;
            long down = _netAt == default || secs <= 0 ? 0 : (long)((rx - _rx) / secs), up = _netAt == default || secs <= 0 ? 0 : (long)((tx - _tx) / secs);
            _rx = rx; _tx = tx; _netAt = now;

            // ---- processes: top 5 by RAM (grouped by name), with cpu share ----
            var (top, count) = Processes(now);

            return new StatsTick(
                new CpuStat(Math.Round(Math.Clamp(busy, 0, 1) * 100, 1), CpuName(), CpuGhz(), count, CpuTemp()),
                Gpu(),
                new RamStat((long)(m.ullTotalPhys - m.ullAvailPhys), (long)m.ullTotalPhys),
                new DiskStat(sysRoot.Substring(0, 1), dUsed, dTotal),
                new NetStat(Math.Max(0, down), Math.Max(0, up)),
                Environment.TickCount64 / 1000,
                top);
        }
    }

    static (TopProc[] top, int count) Processes(DateTime now)
    {
        double elapsed100ns = (now - _procAt).TotalSeconds * 1e7;
        bool haveBase = _procAt != default && elapsed100ns > 0;
        _procAt = now;
        var procs = Process.GetProcesses();
        var next = new Dictionary<int, long>(procs.Length);
        var byName = new Dictionary<string, (long ram, double cpu)>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in procs)
        {
            try
            {
                int pid = p.Id;
                if (pid == 0) continue; // System Idle
                double cpu = 0;
                var h = W.OpenProcess(0x1000, false, (uint)pid);
                if (h != IntPtr.Zero)
                {
                    if (W.GetProcessTimes(h, out _, out _, out var k, out var u))
                    {
                        long t = k + u;
                        next[pid] = t;
                        if (haveBase && PrevCpu.TryGetValue(pid, out var prev)) cpu = (t - prev) / elapsed100ns / Environment.ProcessorCount * 100;
                    }
                    W.CloseHandle(h);
                }
                var name = p.ProcessName;
                byName.TryGetValue(name, out var cur);
                byName[name] = (cur.ram + p.WorkingSet64, cur.cpu + Math.Max(0, cpu));
            }
            catch { /* process exited mid-enumeration */ }
            finally { p.Dispose(); }
        }
        PrevCpu.Clear();
        foreach (var kv in next) PrevCpu[kv.Key] = kv.Value;
        var top = byName.OrderByDescending(k => k.Value.ram).Take(5)
            .Select(k => new TopProc(k.Key, k.Value.ram, Math.Round(Math.Min(100, k.Value.cpu), 1))).ToArray();
        return (top, procs.Length);
    }

    // ---- cached identity ----
    static string CpuName() => _cpuName ??= (Registry.GetValue(@"HKEY_LOCAL_MACHINE\HARDWARE\DESCRIPTION\System\CentralProcessor\0", "ProcessorNameString", "CPU") as string ?? "CPU").Trim();

    [StructLayout(LayoutKind.Sequential)] struct ProcPower { public uint Number, MaxMhz, CurrentMhz, MhzLimit, MaxIdleState, CurrentIdleState; }

    static double CpuGhz()
    {
        int n = Environment.ProcessorCount, sz = Marshal.SizeOf<ProcPower>();
        var buf = Marshal.AllocHGlobal(n * sz);
        try
        {
            if (W.CallNtPowerInformation(11 /* ProcessorInformation */, IntPtr.Zero, 0, buf, n * sz) != 0) return 0;
            uint max = 0;
            for (int i = 0; i < n; i++) max = Math.Max(max, Marshal.PtrToStructure<ProcPower>(buf + i * sz).CurrentMhz);
            return Math.Round(max / 1000.0, 2);
        }
        catch { return 0; }
        finally { Marshal.FreeHGlobal(buf); }
    }

    static double? CpuTemp()
    {
        _thermal ??= new PdhCounter(@"\Thermal Zone Information(*)\Temperature");
        return _thermal.Read(max: true) is { } k and > 0 ? Math.Round(k - 273.15, 1) : null; // ACPI thermal zones report Kelvin
    }

    static GpuStat? Gpu()
    {
        if (!_gpuProbed) { _gpuProbed = true; ProbeGpu(); }
        _gpuEng ??= new PdhCounter(@"\GPU Engine(*engtype_3D)\Utilization Percentage");
        _gpuMem ??= new PdhCounter(@"\GPU Adapter Memory(*)\Dedicated Usage");
        if (!_gpuEng.Valid && _gpuName is null) return null;
        var pct = _gpuEng.Read();
        if (pct is null && _gpuName is null) return null;
        long used = (long)(_gpuMem.Read() ?? 0);
        return new GpuStat(Math.Round(Math.Clamp(pct ?? 0, 0, 100), 1), _gpuName ?? "GPU", used, Math.Max(_vramTotal, used));
    }

    // GPU name + dedicated memory from the display adapter class key (read-only); WMI only as a fallback for the name.
    static void ProbeGpu()
    {
        try
        {
            using var cls = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}");
            long best = -1;
            foreach (var sub in cls?.GetSubKeyNames() ?? [])
            {
                if (!int.TryParse(sub, out _)) continue;
                using var k = cls!.OpenSubKey(sub);
                var desc = k?.GetValue("DriverDesc") as string;
                if (string.IsNullOrEmpty(desc) || desc.Contains("Basic Display", StringComparison.OrdinalIgnoreCase) || desc.Contains("Remote", StringComparison.OrdinalIgnoreCase)) continue;
                long mem = k!.GetValue("HardwareInformation.qwMemorySize") switch { long q => q, byte[] { Length: >= 8 } b => BitConverter.ToInt64(b, 0), byte[] { Length: 4 } b4 => BitConverter.ToUInt32(b4, 0), _ => 0 };
                if (mem > best) { best = mem; _gpuName = desc; _vramTotal = Math.Max(0, mem); }
            }
        }
        catch { }
        if (_gpuName is not null) return;
        try
        {
            using var s = new System.Management.ManagementObjectSearcher("SELECT Name FROM Win32_VideoController");
            foreach (System.Management.ManagementObject o in s.Get()) { _gpuName = o["Name"] as string; if (_gpuName is not null) break; }
        }
        catch { }
    }
}
