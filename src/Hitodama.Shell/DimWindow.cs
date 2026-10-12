using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Hosting;
using Microsoft.UI.Xaml.Media;
using Windows.Graphics;
using WinUIEx;

namespace Hitodama.Shell;

// Screen dim behind the session menu. Created on demand and destroyed after fading out.
public sealed class DimWindow : Window
{
    readonly Grid _root = new() { Background = new SolidColorBrush(Microsoft.UI.Colors.Black) };

    public event Action? Clicked;

    public DimWindow()
    {
        Content = _root;
        ElementCompositionPreview.GetElementVisual(_root).Opacity = 0; // no black flash before the fade-in
        SurfaceWindow.Setup(this);
        var b = DisplayArea.Primary.OuterBounds;
        AppWindow.MoveAndResize(new RectInt32(b.X, b.Y, b.Width, b.Height));
        _root.PointerPressed += (_, _) => Clicked?.Invoke();
        _root.Loaded += (_, _) => Motion.FromTo(ElementCompositionPreview.GetElementVisual(_root), "Opacity", 0f, 0.4f, Motion.SlowEffects);
    }

    public void FadeOut()
    {
        var v = ElementCompositionPreview.GetElementVisual(_root);
        Motion.Batch(v.Compositor, () => Motion.To(v, "Opacity", 0f, Motion.Effects), Close);
    }
}
