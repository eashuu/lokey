using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Lokey.Host.Native;
using Lokey.Host.Pipe;

namespace Lokey.Host.Services;

// Clipboard history with its own store.
//   %LocalAppData%\Lokey\clipboard\index.dat    DPAPI(JSON) of unpinned items
//   %LocalAppData%\Lokey\clipboard\pinned.json  plain JSON of pinned items (per the product's privacy spec)
//   %LocalAppData%\Lokey\clipboard\img\<id>.png / <id>.thumb   DPAPI blobs for unpinned items, plain PNG for pinned ones
// Contents are never logged.
internal static class Clipboard
{
    sealed class Item
    {
        public string Id { get; set; } = "";
        public string Kind { get; set; } = "text";
        public string? Text { get; set; }
        public string Source { get; set; } = "";
        public long At { get; set; }
        public bool Pinned { get; set; }
        public long Size { get; set; }
        public string Hash { get; set; } = "";
    }
    sealed class Settings { public int RetentionDays { get; set; } = 30; public bool AutoPaste { get; set; } }

    const int MaxItems = 500, MaxTextChars = 200_000;
    const uint CF_UNICODETEXT = 13, CF_DIB = 8;
    static readonly object L = new();
    static readonly SemaphoreSlim CaptureGate = new(1, 1);
    static readonly List<Item> Items = new();           // newest first
    static Settings _s = new();
    static readonly string Dir = Paths.Dir("clipboard");
    static readonly string ImgDir = Paths.Dir("clipboard", "img");
    static readonly Debounce Save = new(1500, SaveNow);
    static Timer? _daily;
    static volatile uint _selfSeq;
    static uint _fmtExclude, _fmtHistory, _fmtCloud, _fmtPng;

    static readonly string[] PasswordManagers = ["1password", "bitwarden", "keepass", "dashlane", "lastpass"];

    public static void Register()
    {
        Dispatcher.Add("clipboard.list", p => List(Args.OptStr(p, "query"), Args.OptStr(p, "kind"), Args.OptInt(p, "limit") ?? 100));
        Dispatcher.Add("clipboard.pin", p => { Pin(Args.Str(p, "id"), Args.Bool(p, "on")); return Dispatcher.Ok; });
        Dispatcher.Add("clipboard.delete", p => { Delete(Args.Str(p, "id")); return Dispatcher.Ok; });
        Dispatcher.Add("clipboard.clear", p => { Clear(Args.Bool(p, "keepPinned")); return Dispatcher.Ok; });
        Dispatcher.AddAsync("clipboard.paste", async p => { await PasteAsync(Args.Str(p, "id")); return Dispatcher.Ok; });
        Dispatcher.Add("clipboard.settings", p =>
        {
            lock (L) { _s = new Settings { RetentionDays = Math.Max(0, Args.OptInt(p, "retentionDays") ?? _s.RetentionDays), AutoPaste = Args.OptBool(p, "autoPaste") ?? _s.AutoPaste }; }
            SaveSettings();
            Prune();
            return Dispatcher.Ok;
        });
    }

    public static async Task InitAsync()
    {
        _fmtExclude = W.RegisterClipboardFormat("ExcludeClipboardContentFromMonitorProcessing");
        _fmtHistory = W.RegisterClipboardFormat("CanIncludeInClipboardHistory");
        _fmtCloud = W.RegisterClipboardFormat("CanUploadToCloudClipboard");
        _fmtPng = W.RegisterClipboardFormat("PNG");
        LoadAll();
        Prune();
        _daily = new Timer(_ => Prune(), null, TimeSpan.FromHours(24), TimeSpan.FromHours(24));
        Pump.On(Pump.WM_CLIPBOARDUPDATE, (_, _) => OnUpdate());
        await Pump.Run(() => W.AddClipboardFormatListener(Pump.Hwnd));
    }

    public static void Shutdown() { try { SaveNow(); } catch { } }

    // ============================== capture ==============================
    static void OnUpdate()
    {
        if (_selfSeq != 0 && W.GetClipboardSequenceNumber() <= _selfSeq) return; // our own paste, not a new copy
        var fg = Foreground.Current;                                            // who was active when the copy happened
        _ = Task.Run(() => CaptureAsync(fg));
    }

    static async Task CaptureAsync(FgSnap fg)
    {
        await CaptureGate.WaitAsync();
        try
        {
            if (IsPrivateSource(fg)) return;
            Item? it = null; byte[]? png = null, thumb = null;
            for (int attempt = 0; attempt < 10 && it is null; attempt++)
            {
                if (W.OpenClipboard(IntPtr.Zero))
                {
                    try
                    {
                        if (IsMarkedPrivate()) return;
                        it = Read(fg, out png, out thumb);
                    }
                    finally { W.CloseClipboard(); }
                    break;
                }
                await Task.Delay(30); // another app holds the clipboard open
            }
            if (it is null) return;
            Add(it, png, thumb);
        }
        catch (Exception e) { Log.Error("clipboard capture", e); }
        finally { CaptureGate.Release(); }
    }

    static bool IsPrivateSource(FgSnap fg)
    {
        var exe = fg.Exe.ToLowerInvariant();
        if (PasswordManagers.Any(exe.Contains)) return true;
        var title = fg.Title.ToLowerInvariant();
        return title.Contains("bank") || title.Contains("netbanking");
    }

    static bool IsMarkedPrivate()
    {
        if (_fmtExclude != 0 && W.IsClipboardFormatAvailable(_fmtExclude)) return true;
        return DwordIsZero(_fmtHistory) || DwordIsZero(_fmtCloud);
    }

    static bool DwordIsZero(uint fmt)
    {
        if (fmt == 0 || !W.IsClipboardFormatAvailable(fmt)) return false;
        var h = W.GetClipboardData(fmt);
        if (h == IntPtr.Zero) return false;
        var p = W.GlobalLock(h);
        if (p == IntPtr.Zero) return false;
        try { return (long)(ulong)W.GlobalSize(h) >= 4 && Marshal.ReadInt32(p) == 0; } finally { W.GlobalUnlock(h); }
    }

    // Clipboard must be open. Text wins over an accompanying bitmap (Excel, browsers put both).
    static Item? Read(FgSnap fg, out byte[]? png, out byte[]? thumb)
    {
        png = thumb = null;
        string source = fg.App;
        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        if (W.IsClipboardFormatAvailable(CF_UNICODETEXT))
        {
            var h = W.GetClipboardData(CF_UNICODETEXT);
            var p = h == IntPtr.Zero ? IntPtr.Zero : W.GlobalLock(h);
            if (p != IntPtr.Zero)
            {
                string? text;
                try { text = Marshal.PtrToStringUni(p); } finally { W.GlobalUnlock(h); }
                if (!string.IsNullOrWhiteSpace(text))
                {
                    if (text.Length > MaxTextChars) text = text[..MaxTextChars];
                    bool link = IsLink(text);
                    return new Item { Id = NewId(), Kind = link ? "link" : "text", Text = text, Source = source, At = now, Size = Encoding.UTF8.GetByteCount(text), Hash = Hash(Encoding.UTF8.GetBytes(text)) };
                }
            }
        }

        byte[]? raw = null; bool isPng = false;
        if (_fmtPng != 0 && W.IsClipboardFormatAvailable(_fmtPng)) { raw = CopyHandle(W.GetClipboardData(_fmtPng)); isPng = raw is not null; }
        if (raw is null && W.IsClipboardFormatAvailable(CF_DIB)) raw = DibToBmp(CopyHandle(W.GetClipboardData(CF_DIB)));
        if (raw is null || raw.Length > 60_000_000) return null;
        try
        {
            using var ms = new MemoryStream(raw);
            using var img = new Bitmap(ms);
            png = isPng ? raw : Imaging.EncodePng(img);
            using var th = Imaging.Fit(img, 320);
            thumb = Imaging.EncodePng(th);
        }
        catch { png = thumb = null; return null; }
        return new Item { Id = NewId(), Kind = "image", Source = source, At = now, Size = png.Length, Hash = Hash(png) };
    }

    static byte[]? CopyHandle(IntPtr h)
    {
        if (h == IntPtr.Zero) return null;
        var size = (int)W.GlobalSize(h);
        var p = W.GlobalLock(h);
        if (p == IntPtr.Zero || size <= 0) return null;
        try { var b = new byte[size]; Marshal.Copy(p, b, 0, size); return b; } finally { W.GlobalUnlock(h); }
    }

    // CF_DIB is a BITMAPINFO + pixels; prepend a BITMAPFILEHEADER so GDI+ can read it.
    static byte[]? DibToBmp(byte[]? dib)
    {
        if (dib is null || dib.Length < 40) return null;
        int hdr = BitConverter.ToInt32(dib, 0), bits = BitConverter.ToInt16(dib, 14), comp = BitConverter.ToInt32(dib, 16), used = BitConverter.ToInt32(dib, 32);
        int colors = bits <= 8 ? (used != 0 ? used : 1 << bits) : used;
        int off = 14 + hdr + colors * 4 + (hdr == 40 && comp == 3 ? 12 : 0);
        var bmp = new byte[14 + dib.Length];
        bmp[0] = (byte)'B'; bmp[1] = (byte)'M';
        BitConverter.GetBytes(bmp.Length).CopyTo(bmp, 2);
        BitConverter.GetBytes(off).CopyTo(bmp, 10);
        dib.CopyTo(bmp, 14);
        return bmp;
    }

    static bool IsLink(string t)
    {
        t = t.Trim();
        return t.Length < 2048 && !t.Any(char.IsWhiteSpace) && Uri.TryCreate(t, UriKind.Absolute, out var u) && (u.Scheme == Uri.UriSchemeHttp || u.Scheme == Uri.UriSchemeHttps);
    }

    static string NewId() => Guid.NewGuid().ToString("N");
    static string Hash(byte[] b) => Convert.ToHexString(SHA256.HashData(b))[..32];

    static void Add(Item it, byte[]? png, byte[]? thumb)
    {
        ClipItem? emit;
        lock (L)
        {
            if (Items.Count > 0 && Items[0].Kind == it.Kind && Items[0].Hash == it.Hash)
            {
                Items[0].At = it.At; // consecutive duplicate: just bump
                if (it.Source.Length > 0) Items[0].Source = it.Source;
                emit = ToClip(Items[0]);
            }
            else
            {
                if (png is not null) { WriteBlob(it, ".png", png); WriteBlob(it, ".thumb", thumb!); }
                Items.Insert(0, it);
                emit = ToClip(it);
            }
        }
        Prune();
        Save.Poke();
        Events.Emit("clipboard.changed", new ClipEvent(emit));
    }

    // ============================== queries ==============================
    static ClipItem ToClip(Item i)
    {
        string? image = null;
        if (i.Kind == "image" && ReadBlob(i, ".thumb") is { } b) image = Imaging.DataUrl("image/png", b);
        var preview = i.Kind == "image" ? "" : (i.Text ?? "").Length > 400 ? i.Text![..400] : i.Text ?? "";
        return new ClipItem(i.Id, i.Kind, preview, image, i.Source, i.At, i.Pinned, i.Size);
    }

    static object? List(string? query, string? kind, int limit)
    {
        limit = Math.Clamp(limit, 1, MaxItems);
        List<Item> snap;
        lock (L)
        {
            snap = Items.Where(i => (kind is null || i.Kind == kind)
                && (string.IsNullOrEmpty(query) || (i.Text?.Contains(query, StringComparison.OrdinalIgnoreCase) ?? false) || i.Source.Contains(query, StringComparison.OrdinalIgnoreCase)))
                .OrderByDescending(i => i.At).Take(limit).ToList();
        }
        return snap.Select(ToClip).ToArray();
    }

    static void Pin(string id, bool on)
    {
        lock (L)
        {
            var it = Items.FirstOrDefault(i => i.Id == id) ?? throw new ArgumentException("unknown clipboard item");
            if (it.Pinned == on) return;
            // Re-store the blobs in the right form (plain when pinned, DPAPI otherwise).
            var png = ReadBlob(it, ".png"); var th = ReadBlob(it, ".thumb");
            it.Pinned = on;
            if (png is not null) WriteBlob(it, ".png", png);
            if (th is not null) WriteBlob(it, ".thumb", th);
        }
        Save.Poke();
        Prune();
    }

    static void Delete(string id)
    {
        lock (L) { var it = Items.FirstOrDefault(i => i.Id == id); if (it is not null) { Items.Remove(it); DeleteBlobs(it); } }
        Save.Poke();
    }

    static void Clear(bool keepPinned)
    {
        lock (L)
        {
            foreach (var it in Items.Where(i => !(keepPinned && i.Pinned)).ToList()) { Items.Remove(it); DeleteBlobs(it); }
        }
        Save.Poke();
    }

    static void Prune()
    {
        lock (L)
        {
            long cutoff = _s.RetentionDays <= 0 ? 0 : DateTimeOffset.UtcNow.AddDays(-_s.RetentionDays).ToUnixTimeMilliseconds();
            foreach (var it in Items.Where(i => !i.Pinned && i.At < cutoff).ToList()) { Items.Remove(it); DeleteBlobs(it); }
            while (Items.Count > MaxItems)
            {
                var victim = Items.LastOrDefault(i => !i.Pinned);
                if (victim is null) break;
                Items.Remove(victim); DeleteBlobs(victim);
            }
        }
        Save.Poke();
    }

    // ============================== paste ==============================
    static async Task PasteAsync(string id)
    {
        Item it; bool auto;
        lock (L) { it = Items.FirstOrDefault(i => i.Id == id) ?? throw new ArgumentException("unknown clipboard item"); auto = _s.AutoPaste; }
        var target = Foreground.Current.Hwnd; // the last other app: where the user was before the island took input
        await Task.Run(() => SetClipboard(it));
        if (!auto) return;

        // Send Ctrl+V only into another app: wait (briefly) for focus to leave our own windows, never type into the island.
        for (int i = 0; i < 20 && (W.GetForegroundWindow() is var fg && (fg == IntPtr.Zero || Foreground.IsOwn(fg))); i++)
        {
            if (i == 8 && target != IntPtr.Zero && W.IsWindow(target)) W.SetForegroundWindow(target);
            await Task.Delay(25);
        }
        var now = W.GetForegroundWindow();
        if (now == IntPtr.Zero || Foreground.IsOwn(now)) throw new InvalidOperationException("no target window to paste into");
        await Task.Delay(30);
        W.SendChord([0x11], 0x56);
    }

    static void SetClipboard(Item it)
    {
        byte[]? pngBytes = it.Kind == "image" ? ReadBlob(it, ".png") : null;
        if (it.Kind == "image" && pngBytes is null) throw new InvalidOperationException("image data is gone");
        IntPtr hText = IntPtr.Zero, hDib = IntPtr.Zero, hPng = IntPtr.Zero;
        if (pngBytes is null)
        {
            var bytes = Encoding.Unicode.GetBytes((it.Text ?? "") + "\0");
            hText = Alloc(bytes);
        }
        else
        {
            using var ms = new MemoryStream(pngBytes);
            using var img = new Bitmap(ms);
            using var bmp = new MemoryStream();
            img.Save(bmp, ImageFormat.Bmp);
            hDib = Alloc(bmp.ToArray().AsSpan(14).ToArray()); // CF_DIB = BMP minus its 14-byte file header
            hPng = Alloc(pngBytes);
        }
        bool opened = false;
        for (int i = 0; i < 20 && !opened; i++) { opened = W.OpenClipboard(Pump.Hwnd); if (!opened) Thread.Sleep(20); }
        if (!opened) throw new InvalidOperationException("clipboard is busy");
        try
        {
            W.EmptyClipboard();
            if (hText != IntPtr.Zero && W.SetClipboardData(CF_UNICODETEXT, hText) != IntPtr.Zero) hText = IntPtr.Zero;
            if (hDib != IntPtr.Zero && W.SetClipboardData(CF_DIB, hDib) != IntPtr.Zero) hDib = IntPtr.Zero;
            if (hPng != IntPtr.Zero && W.SetClipboardData(_fmtPng, hPng) != IntPtr.Zero) hPng = IntPtr.Zero;
        }
        finally
        {
            W.CloseClipboard();
            _selfSeq = W.GetClipboardSequenceNumber(); // everything up to here is ours: the listener ignores it
            foreach (var h in new[] { hText, hDib, hPng }) if (h != IntPtr.Zero) W.GlobalFree(h); // not accepted by the clipboard
        }
    }

    static IntPtr Alloc(byte[] data)
    {
        var h = W.GlobalAlloc(0x0002 /* GMEM_MOVEABLE */, (UIntPtr)data.Length);
        var p = W.GlobalLock(h);
        Marshal.Copy(data, 0, p, data.Length);
        W.GlobalUnlock(h);
        return h;
    }

    // ============================== persistence ==============================
    static string BlobPath(Item i, string ext) => Path.Combine(ImgDir, i.Id + ext);

    static void WriteBlob(Item i, string ext, byte[] data)
    {
        try { File.WriteAllBytes(BlobPath(i, ext), i.Pinned ? data : W.Protect(data)); } catch (Exception e) { Log.Error("clip blob write", e); }
    }

    static byte[]? ReadBlob(Item i, string ext)
    {
        try
        {
            var f = BlobPath(i, ext);
            if (!File.Exists(f)) return null;
            var b = File.ReadAllBytes(f);
            return i.Pinned ? b : W.Unprotect(b);
        }
        catch { return null; }
    }

    static void DeleteBlobs(Item i)
    {
        foreach (var ext in new[] { ".png", ".thumb" }) try { File.Delete(BlobPath(i, ext)); } catch { }
    }

    static void SaveNow()
    {
        string unpinned, pinned;
        lock (L)
        {
            unpinned = JsonSerializer.Serialize(Items.Where(i => !i.Pinned).ToList(), Json.O);
            pinned = JsonSerializer.Serialize(Items.Where(i => i.Pinned).ToList(), Json.O);
        }
        try
        {
            WriteAtomic(Path.Combine(Dir, "index.dat"), W.Protect(Encoding.UTF8.GetBytes(unpinned)));
            WriteAtomic(Path.Combine(Dir, "pinned.json"), Encoding.UTF8.GetBytes(pinned));
        }
        catch (Exception e) { Log.Error("clip save", e); }
    }

    static void WriteAtomic(string path, byte[] data)
    {
        var tmp = path + ".tmp";
        File.WriteAllBytes(tmp, data);
        File.Move(tmp, path, true);
    }

    static void SaveSettings()
    {
        try { File.WriteAllText(Path.Combine(Dir, "settings.json"), JsonSerializer.Serialize(_s, Json.O)); } catch { }
    }

    static void LoadAll()
    {
        try { var f = Path.Combine(Dir, "settings.json"); if (File.Exists(f)) _s = JsonSerializer.Deserialize<Settings>(File.ReadAllText(f), Json.O) ?? new(); } catch { }
        var all = new List<Item>();
        try
        {
            var f = Path.Combine(Dir, "index.dat");
            if (File.Exists(f)) all.AddRange(JsonSerializer.Deserialize<List<Item>>(Encoding.UTF8.GetString(W.Unprotect(File.ReadAllBytes(f))), Json.O) ?? []);
        }
        catch (Exception e) { Log.Error("clip load index", e); }
        try
        {
            var f = Path.Combine(Dir, "pinned.json");
            if (File.Exists(f)) all.AddRange(JsonSerializer.Deserialize<List<Item>>(File.ReadAllText(f), Json.O) ?? []);
        }
        catch (Exception e) { Log.Error("clip load pinned", e); }
        lock (L) { Items.Clear(); Items.AddRange(all.OrderByDescending(i => i.At)); }
    }

    // ============================== selftest ==============================
    /// <summary>--selftest with LOKEY_DATA_DIR set: drives the store (not the OS clipboard) with synthetic items: dedupe, filters, pinning,
    /// DPAPI-vs-plain storage, persistence round trip, retention and the 500 cap.</summary>
    public static string SelfCheck()
    {
        void Need(bool c, string what) { if (!c) throw new Exception("clipboard: " + what); }
        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        string marker = "lokey-selfcheck-" + Guid.NewGuid().ToString("N")[..8];
        Item Text(string t, string kind = "text") => new() { Id = NewId(), Kind = kind, Text = t, Source = "selftest", At = now, Size = Encoding.UTF8.GetByteCount(t), Hash = Hash(Encoding.UTF8.GetBytes(t)) };
        Clear(false);
        var t1 = Text(marker + " hello world");
        Add(t1, null, null);
        Add(Text(marker + " hello world"), null, null);
        Need(Items.Count == 1, "consecutive duplicate must be merged");
        Add(Text("https://example.com/page?q=1", "link"), null, null);
        Need(IsLink("https://example.com/a") && !IsLink("see https://example.com") && !IsLink("ftp://x.y"), "link classification");

        byte[] png, thumb;
        using (var bmp = new Bitmap(600, 400)) using (var g = Graphics.FromImage(bmp)) using (var th = new Bitmap(1, 1))
        {
            g.Clear(Color.CornflowerBlue);
            png = Imaging.EncodePng(bmp);
            using var t = Imaging.Fit(bmp, 320);
            Need(t.Width == 320 && t.Height == 213, "thumbnail fit " + t.Width + "x" + t.Height);
            thumb = Imaging.EncodePng(t);
        }
        var img = new Item { Id = NewId(), Kind = "image", Source = "selftest", At = now + 1, Size = png.Length, Hash = Hash(png) };
        Add(img, png, thumb);

        Need(((ClipItem[])List(null, null, 100)!).Length == 3, "3 items");
        Need(((ClipItem[])List(marker.ToUpperInvariant(), null, 100)!).Length == 1, "case-insensitive query");
        var imgs = (ClipItem[])List(null, "image", 100)!;
        Need(imgs.Length == 1 && imgs[0].Image!.StartsWith("data:image/png;base64,") && imgs[0].Preview == "", "image list entry");
        Need(((ClipItem[])List(null, "link", 100)!).Length == 1 && ((ClipItem[])List(null, null, 1)!).Length == 1, "kind filter / limit");

        // encrypted at rest
        SaveNow();
        var idx = File.ReadAllBytes(Path.Combine(Dir, "index.dat"));
        Need(!Encoding.UTF8.GetString(idx).Contains(marker) && !Encoding.UTF8.GetString(idx).Contains("example.com"), "index.dat must be encrypted");
        Need(ReadBlob(img, ".png") is { } rb && rb.AsSpan().SequenceEqual(png), "image blob round trip");
        Need(File.ReadAllBytes(BlobPath(img, ".png")).Take(4).SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47 }) == false, "image blob must be encrypted");

        // pinned = plain text index + plain image
        Pin(t1.Id, true); Pin(img.Id, true);
        SaveNow();
        Need(File.ReadAllText(Path.Combine(Dir, "pinned.json")).Contains(marker), "pinned.json holds pinned text in the clear");
        Need(File.ReadAllBytes(BlobPath(img, ".png")).Take(4).SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47 }), "pinned image stored unencrypted");
        Need(!Encoding.UTF8.GetString(W.Unprotect(File.ReadAllBytes(Path.Combine(Dir, "index.dat")))).Contains(marker), "pinned text left index.dat");

        // persistence round trip
        var before = Items.Select(i => (i.Id, i.Pinned, i.Kind, i.Hash)).ToArray();
        LoadAll();
        Need(Items.Select(i => (i.Id, i.Pinned, i.Kind, i.Hash)).SequenceEqual(before), "reload preserves items");
        Need(ReadBlob(img, ".png") is { } rb2 && rb2.AsSpan().SequenceEqual(png), "pinned image reload");

        // retention: old unpinned goes, old pinned stays
        lock (L) { foreach (var i in Items) i.At = now - 40L * 86_400_000; }
        var oldS = _s; _s = new Settings { RetentionDays = 30 };
        Prune();
        _s = oldS;
        Need(Items.Count == 2 && Items.All(i => i.Pinned), "retention prunes only unpinned");

        // cap
        for (int n = 0; n < 505; n++) Add(Text("bulk " + n), null, null);
        Need(Items.Count == 500 && Items.Count(i => i.Pinned) == 2, "500 cap keeps pinned: " + Items.Count);

        Clear(true);
        Need(Items.Count == 2, "clear keepPinned");
        Delete(t1.Id); Delete(img.Id);
        Clear(false);
        Need(Items.Count == 0 && !File.Exists(BlobPath(img, ".png")), "delete/clear removes blobs");
        return "dedupe, filters, DPAPI vs pinned-plain, reload, retention, 500 cap ok";
    }
}
