using Microsoft.UI.Input;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;

namespace Hitodama.Shell;

// Caelestia's vertical OSD slider: a pill whose fill rises from the bottom, icon inside. Drag or wheel.
public sealed class FilledSlider : Grid
{
    readonly Border _fill;
    readonly FontIcon _icon;
    double _value;

    public event Action<double>? ValueChanged;

    public FilledSlider(string glyph, double width, double height)
    {
        Width = width;
        Height = height;
        var radius = new CornerRadius(width / 2);
        Children.Add(new Border { Background = Ui.Brush("SurfaceContainerHighest"), CornerRadius = radius });
        _fill = new Border { Background = Ui.Brush("Primary"), CornerRadius = radius, VerticalAlignment = VerticalAlignment.Bottom };
        Children.Add(_fill);
        _icon = Ui.Icon(glyph, 15, "OnPrimary");
        _icon.VerticalAlignment = VerticalAlignment.Bottom;
        _icon.Margin = new Thickness(0, 0, 0, width * 0.3);
        Children.Add(_icon);
        Background = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.Transparent);

        PointerPressed += (_, e) => { CapturePointer(e.Pointer); FromPointer(e); };
        PointerMoved += (_, e) => { if (e.Pointer.IsInContact) FromPointer(e); };
        PointerReleased += (_, e) => ReleasePointerCapture(e.Pointer);
        PointerWheelChanged += (_, e) =>
        {
            Set(_value + (e.GetCurrentPoint(this).Properties.MouseWheelDelta > 0 ? 0.05 : -0.05), notify: true);
            e.Handled = true;
        };
    }

    public string Glyph { set => _icon.Glyph = value; }

    public double Value
    {
        get => _value;
        set => Set(value, notify: false);
    }

    void FromPointer(PointerRoutedEventArgs e)
    {
        double y = e.GetCurrentPoint(this).Position.Y;
        Set(1 - y / Height, notify: true);
    }

    void Set(double v, bool notify)
    {
        _value = Math.Clamp(v, 0, 1);
        // Never shorter than a circle, so the icon always sits inside the fill.
        _fill.Height = Width + (Height - Width) * _value;
        _icon.Foreground = Ui.Brush(_value > 0.02 || _fill.Height > Width ? "OnPrimary" : "OnSurface");
        if (notify) ValueChanged?.Invoke(_value);
    }
}
