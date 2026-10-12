using System.Numerics;
using Microsoft.UI.Composition;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Hosting;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;

namespace Hitodama.Shell;

// Caelestia's StateLayer.qml: the template already tints on hover/press; this adds the ripple. A circle in the
// foreground colour (10%) grows from the press point to 1.3x the farthest corner, clipped to the button's
// rounded rect, then fades. Everything runs on the compositor.
public class RippleButton : Button
{
    ContainerVisual? _layer;
    CompositionRoundedRectangleGeometry? _clip;
    FrameworkElement? _root;

    // Implicit styles do not match derived types, so take the app-wide button style explicitly (callers may override Style).
    public RippleButton() => Style = App.Res<Style>("StateButton");

    protected override void OnApplyTemplate()
    {
        base.OnApplyTemplate();
        if (_root is not null || GetTemplateChild("Root") is not FrameworkElement root) return;
        _root = root;
        var comp = ElementCompositionPreview.GetElementVisual(root).Compositor;
        _layer = comp.CreateContainerVisual();
        _clip = comp.CreateRoundedRectangleGeometry();
        _layer.Clip = comp.CreateGeometricClip(_clip);
        ElementCompositionPreview.SetElementChildVisual(root, _layer);
        root.SizeChanged += (_, e) => _layer.Size = _clip.Size = new Vector2((float)e.NewSize.Width, (float)e.NewSize.Height);
        AddHandler(PointerPressedEvent, new PointerEventHandler((_, e) =>
        {
            var p = e.GetCurrentPoint(root).Position;
            Ripple(new Vector2((float)p.X, (float)p.Y));
        }), true); // Button marks the press handled
    }

    /// <summary>Start a ripple at a point in button coordinates (also used by the self-test).</summary>
    public void Ripple(Vector2 at)
    {
        if (_layer is null || _clip is null || _root is null || !IsEnabled || _layer.Size.X <= 0) return;
        var comp = _layer.Compositor;
        float r = (float)CornerRadius.TopLeft;
        _clip.CornerRadius = new Vector2(r);
        var size = _layer.Size;
        float far = MathF.Max(MathF.Max(Vector2.Distance(at, Vector2.Zero), Vector2.Distance(at, new Vector2(size.X, 0))),
                              MathF.Max(Vector2.Distance(at, new Vector2(0, size.Y)), Vector2.Distance(at, size)));

        var c = (Foreground as SolidColorBrush)?.Color ?? Windows.UI.Color.FromArgb(255, 255, 255, 255);
        var circle = comp.CreateEllipseGeometry();
        circle.Center = at;
        var shape = comp.CreateSpriteShape(circle);
        shape.FillBrush = comp.CreateColorBrush(Windows.UI.Color.FromArgb(26, c.R, c.G, c.B));
        var v = comp.CreateShapeVisual();
        v.Size = size;
        v.Shapes.Add(shape);
        _layer.Children.InsertAtTop(v);
        var layer = _layer;
        Motion.Batch(comp,
            () => Motion.FromTo(circle, "Radius", Vector2.Zero, new Vector2(far * 1.3f), Motion.Standard),
            () => Motion.Batch(comp, () => Motion.To(v, "Opacity", 0f, Motion.SlowEffects), () => layer.Children.Remove(v)));
    }
}
