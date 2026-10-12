using Hitodama.Shell.Services;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;

namespace Hitodama.Shell;

// Caelestia's token scale (tokens.hpp) sized for the current screen. Caelestia is tuned for 1920x1080;
// S shrinks everything proportionally on smaller screens so surfaces stay compact.
public static class Tokens
{
    public static double S { get; private set; } = 1;   // layout scale
    public static double Fs { get; private set; } = 1;  // font scale (never below 0.9 so text stays legible)
    public static double ScreenW { get; private set; }  // primary screen in DIP
    public static double ScreenH { get; private set; }

    public static double Px(double v) => Math.Round(v * S * 2) / 2;
    public static double Font(double v) => Math.Round(v * Fs * 2) / 2;

    // spacing / padding / rounding: extraSmall .. extraExtraLarge
    public static double XS => Px(4);
    public static double Sm => Px(8);
    public static double Md => Px(12);
    public static double Lg => Px(16);
    public static double Xl => Px(20);
    public static double Xxl => Px(28);

    public static void Init()
    {
        var area = DisplayArea.Primary;
        double dpi = Native.PrimaryDpi() / 96.0;
        ScreenW = area.OuterBounds.Width / dpi;
        ScreenH = area.OuterBounds.Height / dpi;
        double user = Math.Clamp(Store.Data.Appearance.Scale, 0.6, 2);
        S = Math.Clamp(Math.Min(ScreenW / 1920, ScreenH / 1080), 0.75, 1.5) * user;
        Fs = Math.Max(S, 0.9);

        var r = Application.Current.Resources;
        foreach (var (name, v) in new[] { ("XS", 4.0), ("Sm", 8.0), ("Md", 12.0), ("Lg", 16.0), ("Xl", 20.0), ("Xxl", 28.0) })
        {
            r["Sp" + name] = Px(v);
            r["Pad" + name] = new Thickness(Px(v));
        }
        foreach (var (name, v) in new[] { ("XS", 4.0), ("Sm", 12.0), ("Md", 16.0), ("Lg", 20.0), ("Xl", 28.0) })
            r["Round" + name] = new CornerRadius(Px(v));
        foreach (var (name, v) in new[] { ("XS", 11.0), ("Sm", 12.0), ("Md", 13.0), ("Lg", 15.0), ("Xl", 18.0), ("Xxl", 28.0) })
            r["Font" + name] = Font(v);
        r["IconSize"] = Font(16);

        // XAML styles are sealed once App.xaml loads, so scaled versions are new styles based on them.
        // Every window is created after this, so their {StaticResource} lookups get the scaled ones.
        Derive(r, "Card", (Microsoft.UI.Xaml.Controls.Border.PaddingProperty, new Thickness(Px(14))),
                          (Microsoft.UI.Xaml.Controls.Border.CornerRadiusProperty, new CornerRadius(Px(20))));
        Derive(r, "Label", (Microsoft.UI.Xaml.Controls.TextBlock.FontSizeProperty, Font(11)));
        Derive(r, "Body", (Microsoft.UI.Xaml.Controls.TextBlock.FontSizeProperty, Font(13)));
        Derive(r, "Glyph", (Microsoft.UI.Xaml.Controls.FontIcon.FontSizeProperty, Font(16)));
        Derive(r, "IconButton", (FrameworkElement.WidthProperty, Px(36)), (FrameworkElement.HeightProperty, Px(36)),
                                (Microsoft.UI.Xaml.Controls.Control.FontSizeProperty, Font(15)));
        Derive(r, "Chip", (Microsoft.UI.Xaml.Controls.Control.PaddingProperty, new Thickness(Px(12), Px(4), Px(12), Px(5))),
                          (Microsoft.UI.Xaml.Controls.Control.FontSizeProperty, Font(12)));
    }

    static void Derive(ResourceDictionary r, string key, params (DependencyProperty p, object v)[] setters)
    {
        var old = (Style)r[key];
        var style = new Style(old.TargetType) { BasedOn = old };
        foreach (var (p, v) in setters) style.Setters.Add(new Setter(p, v));
        r[key] = style;
    }
}
