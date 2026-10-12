using Hitodama.Shell.Services;
using MaterialColorUtilities.Palettes;
using MaterialColorUtilities.Schemes;
using MaterialColorUtilities.Utils;
using Microsoft.UI.Xaml.Media;
using Windows.Graphics.Imaging;
using Windows.Storage;
using Windows.UI;
using Variant = MaterialColorUtilities.Palettes.Style;

namespace Hitodama.Shell;

// Material You from the wallpaper, light or dark by wallpaper luminance (Caelestia's "auto" mode).
// Palette "neutral" (default): true grey surfaces, only the accents come from the wallpaper;
// "monochrome": grey everywhere; "tinted": the stock wallpaper-tinted Material You surfaces.
// Roles live in App.xaml as SolidColorBrush resources; we mutate their .Color so every surface restyles live.
public static class Theme
{
    static uint _seed = 0xFFFFB0CA;
    static double _luminance = 0;

    public static bool IsDark { get; private set; } = true;

    /// <summary>Whether surfaces draw the 1px OutlineVariant stroke ("auto" = light mode only, so white stays visible on white).</summary>
    public static bool Outlined => Store.Data.Appearance.Outline switch { "on" => true, "off" => false, _ => !IsDark };

    public static Variant Variant =>
        Enum.TryParse<Variant>(Store.Data.Appearance.Variant, out var v) ? v : Variant.TonalSpot;

    /// <summary>Raised on the UI thread after colours change.</summary>
    public static event Action? Changed;

    public static async Task FromCurrentWallpaperAsync()
    {
        var path = Native.GetWallpaperPath();
        if (!string.IsNullOrEmpty(path)) await FromImageAsync(path);
        else Apply();
    }

    /// <summary>Re-theme from an image without touching the wallpaper (used for previews too).</summary>
    public static async Task FromImageAsync(string path)
    {
        try
        {
            var file = await StorageFile.GetFileFromPathAsync(path);
            using var stream = await file.OpenReadAsync();
            var decoder = await BitmapDecoder.CreateAsync(stream);
            var transform = new BitmapTransform { ScaledWidth = 128, ScaledHeight = 128, InterpolationMode = BitmapInterpolationMode.Fant };
            var data = await decoder.GetPixelDataAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Straight, transform,
                ExifOrientationMode.IgnoreExifOrientation, ColorManagementMode.DoNotColorManage);
            var bytes = data.DetachPixelData();
            var argb = new uint[bytes.Length / 4];
            double lum = 0;
            for (int i = 0; i < argb.Length; i++)
            {
                byte b = bytes[i * 4], g = bytes[i * 4 + 1], r = bytes[i * 4 + 2];
                argb[i] = 0xFF000000u | (uint)r << 16 | (uint)g << 8 | b;
                lum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
            }
            _luminance = lum / argb.Length;
            var seeds = await Task.Run(() => ImageUtils.ColorsFromImage(argb));
            if (seeds.Count > 0) _seed = seeds[0];
        }
        catch { /* unreadable wallpaper: keep previous seed */ }
        Apply();
    }

    public static void Apply()
    {
        var mode = Store.Data.Appearance.Mode;
        IsDark = mode == "dark" || mode != "light" && _luminance <= 0.5;

        string pal = Store.Data.Appearance.Palette;
        var palette = new CorePalette();
        palette.Fill(_seed, Variant);
        var grey = TonalPalette.FromHueAndChroma(0, 0);
        if (pal == "monochrome") { palette.Primary = palette.Secondary = palette.Tertiary = grey; }
        Scheme<uint> s = IsDark ? new DarkSchemeMapper().Map(palette) : new LightSchemeMapper().Map(palette);
        // M3 tone mapping on pure grey for the neutral roles (dark, light).
        uint N(uint dark, uint light) => grey[IsDark ? dark : light];
        bool tinted = pal == "tinted";

        double alpha = Math.Clamp(Store.Data.Appearance.Transparency, 0.4, 1);
        Set("Surface", tinted ? s.Surface : N(6, 99), alpha);
        Set("SurfaceContainerLowest", tinted ? s.SurfaceContainerLowest : N(4, 100));
        Set("SurfaceContainerLow", tinted ? s.SurfaceContainerLow : N(10, 97));
        Set("SurfaceContainer", tinted ? s.SurfaceContainer : N(12, 95));
        Set("SurfaceContainerHigh", tinted ? s.SurfaceContainerHigh : N(17, 92));
        Set("SurfaceContainerHighest", tinted ? s.SurfaceContainerHighest : N(22, 90));
        Set("OnSurface", tinted ? s.OnSurface : N(90, 10));
        Set("OnSurfaceVariant", tinted ? s.OnSurfaceVariant : N(70, 35));
        Set("Primary", s.Primary);
        Set("OnPrimary", s.OnPrimary);
        Set("PrimaryContainer", s.PrimaryContainer);
        Set("OnPrimaryContainer", s.OnPrimaryContainer);
        Set("Secondary", s.Secondary);
        Set("SecondaryContainer", s.SecondaryContainer);
        Set("OnSecondaryContainer", s.OnSecondaryContainer);
        Set("Tertiary", s.Tertiary);
        Set("TertiaryContainer", s.TertiaryContainer);
        Set("OnTertiaryContainer", s.OnTertiaryContainer);
        Set("Error", s.Error);
        Set("OnError", s.OnError);
        Set("Outline", tinted ? s.Outline : N(50, 55));
        Set("OutlineVariant", tinted ? s.OutlineVariant : N(25, 85));
        Set("Hover", tinted ? s.OnSurface : N(90, 10), 0.08);
        Changed?.Invoke();
    }

    public static Color ToColor(uint argb, double alpha = 1) =>
        Color.FromArgb((byte)Math.Round(255 * alpha), (byte)(argb >> 16), (byte)(argb >> 8), (byte)argb);

    public static Color Get(string key) => App.Res<SolidColorBrush>(key).Color;

    static void Set(string key, uint argb, double alpha = 1) => App.Res<SolidColorBrush>(key).Color = ToColor(argb, alpha);
}
