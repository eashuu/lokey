using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using Lokey.Host.Native;

namespace Lokey.Host.Native;

// System.Drawing helpers plus the shell thumbnail/icon bridge (IShellItemImageFactory must run on an STA thread).
internal static class Imaging
{
    public static string DataUrl(string mime, byte[] bytes) => $"data:{mime};base64,{Convert.ToBase64String(bytes)}";

    public static byte[] EncodePng(Image img) { using var ms = new MemoryStream(); img.Save(ms, ImageFormat.Png); return ms.ToArray(); }

    public static byte[] EncodeJpeg(Image img, long quality = 85)
    {
        // JPEG has no alpha: flatten onto black first.
        using var flat = new Bitmap(img.Width, img.Height, PixelFormat.Format24bppRgb);
        using (var g = Graphics.FromImage(flat)) { g.Clear(Color.Black); g.DrawImage(img, 0, 0, img.Width, img.Height); }
        var codec = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
        using var ps = new EncoderParameters(1);
        ps.Param[0] = new EncoderParameter(Encoder.Quality, quality);
        using var ms = new MemoryStream();
        flat.Save(ms, codec, ps);
        return ms.ToArray();
    }

    /// <summary>Scale so the long side is at most <paramref name="maxSide"/> (never upscales).</summary>
    public static Bitmap Fit(Image src, int maxSide)
    {
        double s = Math.Min(1.0, (double)maxSide / Math.Max(src.Width, src.Height));
        int w = Math.Max(1, (int)Math.Round(src.Width * s)), h = Math.Max(1, (int)Math.Round(src.Height * s));
        var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using var g = Graphics.FromImage(bmp);
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.SmoothingMode = SmoothingMode.HighQuality;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.DrawImage(src, 0, 0, w, h);
        return bmp;
    }

    /// <summary>Decode arbitrary image bytes and return a ≤maxSide data URL (JPEG or PNG).</summary>
    public static string? ToDataUrl(byte[] src, int maxSide, bool png)
    {
        try
        {
            using var ms = new MemoryStream(src);
            using var img = Image.FromStream(ms);
            using var fit = Fit(img, maxSide);
            return png ? DataUrl("image/png", EncodePng(fit)) : DataUrl("image/jpeg", EncodeJpeg(fit));
        }
        catch { return null; }
    }

    static readonly Guid IidFactory = new("bcc18b79-ba16-442f-80c4-8a59c30c463b");

    /// <summary>Shell image (icon or thumbnail) for a parsing name, or null. Call on the STA thread.</summary>
    public static Bitmap? ShellImage(string parsingName, int size, int flags = 0)
    {
        IntPtr hbmp = IntPtr.Zero;
        try
        {
            W.SHCreateImageFactory(parsingName, IntPtr.Zero, IidFactory, out var factory);
            if (factory.GetImage(new W.SIZE { cx = size, cy = size }, flags, out hbmp) != 0 || hbmp == IntPtr.Zero) return null;
            W.GetObject(hbmp, Marshal.SizeOf<W.BITMAP>(), out var info);
            int w = info.bmWidth, h = Math.Abs(info.bmHeight);
            if (w <= 0 || h <= 0) return null;
            var bmi = new W.BITMAPINFOHEADER { biSize = 40, biWidth = w, biHeight = -h, biPlanes = 1, biBitCount = 32 };
            var px = new byte[w * h * 4];
            var dc = W.GetDC(IntPtr.Zero);
            W.GetDIBits(dc, hbmp, 0, (uint)h, px, ref bmi, 0);
            W.ReleaseDC(IntPtr.Zero, dc);
            // Some icons come back with an all-zero alpha channel: treat them as opaque.
            bool anyAlpha = false;
            for (int i = 3; i < px.Length; i += 4) if (px[i] != 0) { anyAlpha = true; break; }
            if (!anyAlpha) for (int i = 3; i < px.Length; i += 4) px[i] = 255;
            var bmp = new Bitmap(w, h, PixelFormat.Format32bppPArgb);
            var bd = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppPArgb);
            Marshal.Copy(px, 0, bd.Scan0, px.Length);
            bmp.UnlockBits(bd);
            return bmp;
        }
        catch { return null; }
        finally { if (hbmp != IntPtr.Zero) W.DeleteObject(hbmp); }
    }
}

// One dedicated STA thread for shell/COM calls (IShellItem, IDesktopWallpaper, IVirtualDesktopManager). Blocked on a queue when idle.
internal static class Sta
{
    static readonly System.Collections.Concurrent.BlockingCollection<Action> Q = new();
    static Thread? _t;
    static readonly object L = new();

    public static Task<T> Run<T>(Func<T> f)
    {
        lock (L)
        {
            if (_t is null)
            {
                _t = new Thread(() => { foreach (var a in Q.GetConsumingEnumerable()) a(); }) { IsBackground = true, Name = "sta" };
                _t.SetApartmentState(ApartmentState.STA);
                _t.Start();
            }
        }
        var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        Q.Add(() => { try { tcs.SetResult(f()); } catch (Exception e) { tcs.SetException(e); } });
        return tcs.Task;
    }
}
