using System.Numerics;
using Microsoft.UI.Composition;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Hosting;

namespace Hitodama.Shell;

// Arc gauge drawn by the compositor (Caelestia's performance rings / media progress arc).
// The value animates via the ellipse's TrimEnd, so updates cost a property set, not a redraw in C#.
public sealed class Ring : Grid
{
    readonly CompositionEllipseGeometry _value;
    readonly CompositionSpriteShape _valueShape;
    readonly CompositionColorBrush _track, _fill;
    readonly float _sweep;
    readonly string _trackKey, _fillKey;

    public Ring(double size, double thickness, double sweepDegrees = 300, string fill = "Primary", string track = "SurfaceContainerHighest")
    {
        Width = Height = size;
        _sweep = (float)(sweepDegrees / 360);
        _fillKey = fill;
        _trackKey = track;
        var host = new Canvas { Width = size, Height = size, IsHitTestVisible = false };
        Children.Add(host);

        var c = ElementCompositionPreview.GetElementVisual(host).Compositor;
        _track = c.CreateColorBrush(Theme.Get(track));
        _fill = c.CreateColorBrush(Theme.Get(fill));
        float r = (float)((size - thickness) / 2);
        var center = new Vector2((float)size / 2);
        var visual = c.CreateShapeVisual();
        visual.Size = new Vector2((float)size);
        // Path starts at 3 o'clock going clockwise; rotate so the gap (if any) is centred at the bottom.
        float start = sweepDegrees >= 360 ? -90 : (float)(90 + (360 - sweepDegrees) / 2);

        CompositionSpriteShape Arc(CompositionColorBrush brush, float trimEnd, out CompositionEllipseGeometry g)
        {
            g = c.CreateEllipseGeometry();
            g.Center = center;
            g.Radius = new Vector2(r);
            g.TrimEnd = trimEnd;
            var s = c.CreateSpriteShape(g);
            s.StrokeBrush = brush;
            s.StrokeThickness = (float)thickness;
            s.StrokeStartCap = s.StrokeEndCap = CompositionStrokeCap.Round;
            s.CenterPoint = center;
            s.RotationAngleInDegrees = start;
            return s;
        }
        visual.Shapes.Add(Arc(_track, _sweep, out _));
        _valueShape = Arc(_fill, 0.001f, out _value);
        _valueShape.StrokeBrush = null; // nothing drawn until there is a value (round caps would leave a dot)
        visual.Shapes.Add(_valueShape);
        ElementCompositionPreview.SetElementChildVisual(host, visual);

        Theme.Changed += Recolor;
        Unloaded += (_, _) => Theme.Changed -= Recolor;
        Loaded += (_, _) => { Theme.Changed -= Recolor; Theme.Changed += Recolor; Recolor(); };
    }

    /// <summary>0..1, animated with Caelestia's spatial curve.</summary>
    public void SetValue(double v)
    {
        _valueShape.StrokeBrush = v > 0.003 ? _fill : null;
        Motion.To(_value, "TrimEnd", (float)Math.Clamp(v, 0.001, 1) * _sweep, Motion.Spatial);
    }

    void Recolor()
    {
        _track.Color = Theme.Get(_trackKey);
        _fill.Color = Theme.Get(_fillKey);
    }
}
