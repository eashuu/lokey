using System.Runtime.InteropServices.WindowsRuntime;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Storage.Streams;

namespace Hitodama.Shell.Services;

// The Windows account picture: the newest *.accountpicture-ms embeds PNG/JPEG renditions, so we lift the largest
// one out; without it, Windows' default user.png.
public static class Avatar
{
    static BitmapImage? _cached;

    public static async Task<BitmapImage?> LoadAsync()
    {
        if (_cached is not null) return _cached;
        byte[]? bytes = null;
        try
        {
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"Microsoft\Windows\AccountPictures");
            var file = Directory.Exists(dir)
                ? new DirectoryInfo(dir).GetFiles("*.accountpicture-ms").OrderByDescending(f => f.LastWriteTimeUtc).FirstOrDefault()
                : null;
            if (file is not null) bytes = Largest(File.ReadAllBytes(file.FullName));
            if (bytes is null)
            {
                var def = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), @"Microsoft\User Account Pictures\user.png");
                if (File.Exists(def)) bytes = File.ReadAllBytes(def);
            }
            if (bytes is null) return null;
            using var ms = new InMemoryRandomAccessStream();
            await ms.WriteAsync(bytes.AsBuffer());
            ms.Seek(0);
            var img = new BitmapImage { DecodePixelWidth = 256 };
            await img.SetSourceAsync(ms);
            return _cached = img;
        }
        catch { return null; }
    }

    // Biggest PNG (signature .. IEND) or JPEG (FFD8FF .. FFD9) blob inside the container.
    static byte[]? Largest(byte[] data)
    {
        byte[] png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], iend = [0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82], jpg = [0xFF, 0xD8, 0xFF], jend = [0xFF, 0xD9];
        (int s, int e) best = (0, 0);
        void Scan(byte[] start, byte[] end)
        {
            for (int i = data.AsSpan().IndexOf(start); i >= 0 && i < data.Length;)
            {
                int rel = data.AsSpan(i).IndexOf(end);
                if (rel < 0) break;
                int e = i + rel + end.Length;
                if (e - i > best.e - best.s) best = (i, e);
                int next = data.AsSpan(e).IndexOf(start);
                i = next < 0 ? -1 : e + next;
            }
        }
        Scan(png, iend);
        Scan(jpg, jend);
        return best.e > best.s ? data[best.s..best.e] : null;
    }
}
