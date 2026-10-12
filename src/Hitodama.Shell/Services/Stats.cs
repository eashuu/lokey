using System.Net.NetworkInformation;
using Microsoft.Win32;

namespace Hitodama.Shell.Services;

// Caelestia's SystemUsage service, with /proc swapped for Win32 counters.
public static class Stats
{
    static long _idle, _total;
    static long _rx, _tx;
    static DateTime _netAt;

    public static string CpuName { get; } =
        (Registry.GetValue(@"HKEY_LOCAL_MACHINE\HARDWARE\DESCRIPTION\System\CentralProcessor\0", "ProcessorNameString", "CPU") as string ?? "CPU").Trim();

    /// <summary>CPU busy fraction since the previous call.</summary>
    public static double Cpu()
    {
        Native.GetSystemTimes(out var idle, out var kernel, out var user);
        long total = kernel + user; // kernel time includes idle
        double busy = _total == 0 || total == _total ? 0 : 1 - (double)(idle - _idle) / (total - _total);
        _idle = idle; _total = total;
        return Math.Clamp(busy, 0, 1);
    }

    public static (double Used, double Total) MemoryGb()
    {
        var m = Native.Memory();
        return ((m.ullTotalPhys - m.ullAvailPhys) / 1073741824.0, m.ullTotalPhys / 1073741824.0);
    }

    public static (double Used, double Total) DiskGb(string drive = "C")
    {
        try
        {
            var d = new DriveInfo(drive);
            return ((d.TotalSize - d.AvailableFreeSpace) / 1073741824.0, d.TotalSize / 1073741824.0);
        }
        catch { return (0, 0); }
    }

    /// <summary>Bytes per second down/up across active non-loopback adapters.</summary>
    public static (double Down, double Up) Network()
    {
        long rx = 0, tx = 0;
        foreach (var n in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (n.OperationalStatus != OperationalStatus.Up || n.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
            var s = n.GetIPv4Statistics();
            rx += s.BytesReceived; tx += s.BytesSent;
        }
        var now = DateTime.Now;
        double secs = (now - _netAt).TotalSeconds;
        var result = _netAt == default || secs <= 0 ? (0, 0) : ((rx - _rx) / secs, (tx - _tx) / secs);
        _rx = rx; _tx = tx; _netAt = now;
        return result;
    }

    static PdhCounter? _gpu, _thermal;

    /// <summary>GPU 3D engine utilisation 0..1 (all adapters), or null when the counter is unavailable.</summary>
    public static double? Gpu()
    {
        _gpu ??= new PdhCounter(@"\GPU Engine(*engtype_3D)\Utilization Percentage");
        return _gpu.Read() is { } v ? Math.Clamp(v / 100, 0, 1) : null;
    }

    /// <summary>Hottest ACPI thermal zone in °C, or null (many desktops don't expose one).</summary>
    public static double? CpuTemp()
    {
        _thermal ??= new PdhCounter(@"\Thermal Zone Information(*)\Temperature");
        return _thermal.Read(max: true) is { } k and > 0 ? k - 273.15 : null;
    }

    public static TimeSpan Uptime => TimeSpan.FromMilliseconds(Environment.TickCount64);

    public static string Bytes(double b) => b switch
    {
        >= 1073741824 => $"{b / 1073741824:0.0} GB",
        >= 1048576 => $"{b / 1048576:0.0} MB",
        >= 1024 => $"{b / 1024:0} KB",
        _ => $"{b:0} B",
    };
}
