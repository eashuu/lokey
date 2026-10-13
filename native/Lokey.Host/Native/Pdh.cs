using System.Runtime.InteropServices;

namespace Lokey.Host.Native;

// Sum (or max) of every instance of a PDH counter, e.g. GPU utilisation across engines. No WMI, no admin.
internal sealed class PdhCounter : IDisposable
{
    IntPtr _query, _counter;
    public bool Valid { get; }

    public PdhCounter(string path)
    {
        Valid = PdhOpenQuery(null, IntPtr.Zero, out _query) == 0 &&
                PdhAddEnglishCounter(_query, path, IntPtr.Zero, out _counter) == 0 &&
                PdhCollectQueryData(_query) == 0;
    }

    /// <summary>Sum (or max) across instances since the previous call; null if unavailable.</summary>
    public double? Read(bool max = false)
    {
        if (!Valid || PdhCollectQueryData(_query) != 0) return null;
        uint size = 0;
        if (PdhGetFormattedCounterArray(_counter, 0x200 /* DOUBLE */, ref size, out _, IntPtr.Zero) != unchecked((int)0x800007D2) || size == 0) return null;
        var buf = Marshal.AllocHGlobal((int)size);
        try
        {
            if (PdhGetFormattedCounterArray(_counter, 0x200, ref size, out var count, buf) != 0) return null;
            double total = 0;
            int stride = IntPtr.Size + 16; // PDH_FMT_COUNTERVALUE_ITEM_W { name*, { status, pad, double } }
            for (int i = 0; i < count; i++)
            {
                double v = BitConverter.Int64BitsToDouble(Marshal.ReadInt64(buf, i * stride + IntPtr.Size + 8));
                total = max ? Math.Max(total, v) : total + v;
            }
            return count == 0 ? null : total;
        }
        finally { Marshal.FreeHGlobal(buf); }
    }

    public void Dispose() { if (_query != IntPtr.Zero) PdhCloseQuery(_query); _query = IntPtr.Zero; }

    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern int PdhOpenQuery(string? src, IntPtr user, out IntPtr q);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern int PdhAddEnglishCounter(IntPtr q, string path, IntPtr user, out IntPtr c);
    [DllImport("pdh.dll")] static extern int PdhCollectQueryData(IntPtr q);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern int PdhGetFormattedCounterArray(IntPtr c, uint fmt, ref uint size, out uint count, IntPtr buf);
    [DllImport("pdh.dll")] static extern int PdhCloseQuery(IntPtr q);
}
