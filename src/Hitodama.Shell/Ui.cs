using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.UI.Text;

namespace Hitodama.Shell;

// Small builders so code-built pages read like the QML they port. Sizes are base (1920x1080) values
// and get scaled by Tokens here, so pages never hard-code pixels.
public static class Ui
{
    public static SolidColorBrush Brush(string key) => App.Res<SolidColorBrush>(key);

    public static Border Card(UIElement child, double radius = 28, double pad = 16, string bg = "SurfaceContainer") => new()
    {
        Child = child,
        Background = Brush(bg),
        CornerRadius = new CornerRadius(Tokens.Px(radius)),
        Padding = new Thickness(Tokens.Px(pad)),
    };

    public static TextBlock Text(string text = "", double size = 13, string fg = "OnSurface", FontWeight? weight = null) => new()
    {
        Text = text,
        FontSize = Tokens.Font(size),
        FontFamily = App.Res<FontFamily>("Sans"),
        FontWeight = weight ?? FontWeights.Normal,
        Foreground = Brush(fg),
        TextTrimming = TextTrimming.CharacterEllipsis,
        TextWrapping = TextWrapping.NoWrap,
    };

    /// <summary>Big numbers (clock, temperatures, ring values): Rubik, like Caelestia.</summary>
    public static TextBlock Num(string text = "", double size = 28, string fg = "OnSurface", FontWeight? weight = null)
    {
        var t = Text(text, size, fg, weight ?? FontWeights.SemiBold);
        t.FontFamily = App.Res<FontFamily>("Rubik");
        return t;
    }

    /// <summary>Material icon by ligature name (Caelestia's `MaterialIcon text:`). filled = the Material Icons face.</summary>
    public static FontIcon Icon(string name, double size = 16, string fg = "OnSurface", bool filled = false) => new()
    {
        Glyph = name,
        FontSize = Tokens.Font(size),
        FontFamily = App.Res<FontFamily>(filled ? "IconsFilled" : "Icons"),
        Foreground = Brush(fg),
    };

    /// <summary>Round icon button with the state-layer template. Filled = primary container style.</summary>
    public static Button IconButton(string glyph, double size, Action onClick, bool filled = false)
    {
        var b = new RippleButton
        {
            Content = Icon(glyph, size * 0.42, filled ? "OnPrimary" : "OnSurface"),
            Width = Tokens.Px(size),
            Height = Tokens.Px(size),
            Padding = new Thickness(0),
            CornerRadius = new CornerRadius(Tokens.Px(size) / 2),
            Background = filled ? Brush("Primary") : new SolidColorBrush(Microsoft.UI.Colors.Transparent),
            Foreground = Brush(filled ? "OnPrimary" : "OnSurface"),
        };
        b.Click += (_, _) => onClick();
        return b;
    }

    public static Grid Grid(double colSpacing = 12, double rowSpacing = 12) =>
        new() { ColumnSpacing = Tokens.Px(colSpacing), RowSpacing = Tokens.Px(rowSpacing) };

    public static T At<T>(this T el, int row, int col, int rowSpan = 1, int colSpan = 1) where T : FrameworkElement
    {
        Microsoft.UI.Xaml.Controls.Grid.SetRow(el, row);
        Microsoft.UI.Xaml.Controls.Grid.SetColumn(el, col);
        Microsoft.UI.Xaml.Controls.Grid.SetRowSpan(el, rowSpan);
        Microsoft.UI.Xaml.Controls.Grid.SetColumnSpan(el, colSpan);
        return el;
    }

    public static StackPanel Stack(Orientation o = Orientation.Vertical, double spacing = 4, params UIElement[] children)
    {
        var s = new StackPanel { Orientation = o, Spacing = Tokens.Px(spacing) };
        foreach (var c in children) s.Children.Add(c);
        return s;
    }

    /// <summary>Fills a 7-column month grid (header row + 6 weeks, Monday first) like Caelestia's calendar:
    /// weekends tertiary, today a primary pill. The grid needs 7 columns and 7 rows.</summary>
    public static void FillMonth(Grid days, DateTime month, double todaySize = 26)
    {
        days.Children.Clear();
        string[] names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        for (int i = 0; i < 7; i++)
        {
            var h = Text(names[i], 10, i >= 5 ? "Tertiary" : "OnSurfaceVariant", FontWeights.SemiBold);
            h.HorizontalAlignment = HorizontalAlignment.Center; h.VerticalAlignment = VerticalAlignment.Center;
            days.Children.Add(h.At(0, i));
        }
        var first = new DateTime(month.Year, month.Month, 1);
        var start = first.AddDays(-(((int)first.DayOfWeek + 6) % 7));
        for (int i = 0; i < 42; i++)
        {
            var d = start.AddDays(i);
            bool today = d == DateTime.Today, inMonth = d.Month == month.Month;
            var t = Text(d.Day.ToString(), 11, today ? "OnPrimary" : !inMonth ? "Outline" : i % 7 >= 5 ? "Tertiary" : "OnSurface", today ? FontWeights.SemiBold : FontWeights.Normal);
            t.HorizontalAlignment = HorizontalAlignment.Center; t.VerticalAlignment = VerticalAlignment.Center;
            var cell = new Grid();
            if (today) cell.Children.Add(new Microsoft.UI.Xaml.Shapes.Ellipse { Width = Tokens.Px(todaySize), Height = Tokens.Px(todaySize), Fill = Brush("Primary") });
            cell.Children.Add(t);
            days.Children.Add(cell.At(1 + i / 7, i % 7));
        }
    }

    public static string Uptime(TimeSpan t) =>
        t.Days > 0 ? $"{t.Days}d {t.Hours}h {t.Minutes}m" : t.Hours > 0 ? $"{t.Hours}h {t.Minutes}m" : $"{t.Minutes}m";
}
