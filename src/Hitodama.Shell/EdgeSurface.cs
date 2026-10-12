using System.Numerics;
using Microsoft.UI.Composition;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Hosting;
using Microsoft.UI.Xaml.Media;
using Windows.Graphics;
using WinUIEx;

namespace Hitodama.Shell;

public enum Edge { Top, Bottom, Right, Left }

// A Caelestia drawer on one screen edge: a transparent, click-through, topmost window whose surface is a
// rounded body joined to the screen edge by two concave fillets. All motion runs on the compositor:
// only the property set `Ps` (L, D, R, O, CA, K) is animated and expressions derive everything else.
//
//   L  = length along the edge      D = depth away from the edge     R = corner radius
//   O  = 0 shown .. 1 hidden past the edge (Caelestia's offsetScale)
//   CA = content alpha               K = content slide distance tied to CA
//
// Coordinates are "edge-local" (x along the edge, y away from it); a transform maps them per edge.
// CX is the centre along the edge (animatable, so a popout can glide between bar entries) and C0 its resting value.
public sealed class EdgeSurface
{
    readonly Window _win;
    readonly FrameworkElement _content;
    readonly double _dpi;
    readonly ContainerVisual _shape;
    readonly CompositionColorBrush _fill, _outline;
    readonly CompositionSpriteShape _bodyShape;
    readonly List<CompositionColorGradientStop> _filletStops = [];
    double _l, _d, _o, _cx; // last targets, for the input region
    readonly double _winAlong;
    bool Vertical => Edge is Edge.Right or Edge.Left;
    int _generation;
    (double l, double d)? _strip;

    public Edge Edge { get; }
    public IntPtr Hwnd { get; }
    public double MaxL { get; }
    public double MaxD { get; }
    public double Fillet { get; }
    public double WinAlong => _winAlong;
    public double WinAway => MaxD + 8;
    public Compositor Compositor { get; }
    public CompositionPropertySet Ps { get; }
    public bool Hidden { get; private set; }

    /// <param name="area">Rectangle (physical px) the edge belongs to; default is the primary work area.</param>
    /// <param name="fillet">Concave corner radius where the body meets the edge; 0 for none (full-length bars).</param>
    /// <param name="alongSize">Window length along the edge (DIP); default fits the body plus fillets.</param>
    public EdgeSurface(Window win, FrameworkElement root, FrameworkElement surfaceHost, FrameworkElement content,
        Edge edge, double maxL, double maxD, RectInt32? area = null, double fillet = -1, double? alongSize = null)
    {
        _win = win;
        _content = content;
        Edge = edge;
        MaxL = maxL;
        MaxD = maxD;
        Fillet = fillet >= 0 ? fillet : Tokens.Px(20);
        _winAlong = alongSize ?? MaxL + 2 * Fillet;
        _cx = _winAlong / 2;
        Hwnd = WinRT.Interop.WindowNative.GetWindowHandle(win);
        _dpi = SurfaceWindow.Setup(win);

        var work = area ?? DisplayArea.Primary.WorkArea;
        double ww = Vertical ? WinAway : WinAlong, wh = Vertical ? WinAlong : WinAway;
        int pw = (int)Math.Ceiling(ww * _dpi), ph = (int)Math.Ceiling(wh * _dpi);
        int x = edge switch
        {
            Edge.Right => work.X + work.Width - pw,
            Edge.Left => work.X,
            _ => work.X + (work.Width - pw) / 2,
        };
        int y = edge switch
        {
            Edge.Top => work.Y,
            Edge.Bottom => work.Y + work.Height - ph,
            _ => work.Y + (work.Height - ph) / 2,
        };
        win.AppWindow.MoveAndResize(new RectInt32(x, y, pw, ph));

        // ---- content host sits against the edge, sized to the max surface ----
        content.Width = Vertical ? MaxD : MaxL;
        content.Height = Vertical ? MaxL : MaxD;
        content.HorizontalAlignment = edge switch { Edge.Right => HorizontalAlignment.Right, Edge.Left => HorizontalAlignment.Left, _ => HorizontalAlignment.Center };
        content.VerticalAlignment = edge switch { Edge.Top => VerticalAlignment.Top, Edge.Bottom => VerticalAlignment.Bottom, _ => VerticalAlignment.Center };

        // ---- composition surface ----
        Compositor = ElementCompositionPreview.GetElementVisual(root).Compositor;
        Ps = Compositor.CreatePropertySet();
        Ps.InsertScalar("L", 0);
        Ps.InsertScalar("D", 0);
        Ps.InsertScalar("R", 0);
        Ps.InsertScalar("O", 1);
        Ps.InsertScalar("CA", 0);
        Ps.InsertScalar("K", 0);
        Ps.InsertScalar("F", (float)Fillet);
        Ps.InsertScalar("CX", (float)(WinAlong / 2));
        Ps.InsertScalar("C0", (float)(WinAlong / 2));

        _fill = Compositor.CreateColorBrush(Theme.Get("Surface"));
        _shape = Compositor.CreateContainerVisual();
        _shape.Size = new Vector2((float)ww, (float)wh);
        _shape.TransformMatrix = edge switch
        {
            Edge.Bottom => Matrix4x4.CreateScale(1, -1, 1) * Matrix4x4.CreateTranslation(0, (float)wh, 0),
            Edge.Right => new Matrix4x4(0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, (float)ww, 0, 0, 1),
            Edge.Left => new Matrix4x4(0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1),
            _ => Matrix4x4.Identity,
        };

        // Body: a rounded rect whose edge-side corners sit past the screen edge, so only the far corners show.
        var body = Compositor.CreateRoundedRectangleGeometry();
        var spriteShape = _bodyShape = Compositor.CreateSpriteShape(body);
        spriteShape.FillBrush = _fill;
        _outline = Compositor.CreateColorBrush(Theme.Get("OutlineVariant"));
        spriteShape.StrokeBrush = _outline;
        var bodyVisual = Compositor.CreateShapeVisual();
        bodyVisual.Size = new Vector2((float)WinAlong, (float)WinAway);
        bodyVisual.Shapes.Add(spriteShape);
        Bind(body, "Size", "Vector2(ps.L, ps.D + Clamp(ps.R, 0, Min(ps.D, ps.L / 2)))");
        Bind(body, "Offset", "Vector2(ps.CX - ps.L / 2, -Clamp(ps.R, 0, Min(ps.D, ps.L / 2)) - ps.O * (ps.D + 8))");
        Bind(body, "CornerRadius", "Vector2(Clamp(ps.R, 0, Min(ps.D, ps.L / 2)), Clamp(ps.R, 0, Min(ps.D, ps.L / 2)))");
        _shape.Children.InsertAtTop(bodyVisual);

        // Fillets: hard-stop radial gradients (clear inside the circle, surface outside), shrinking as the body retreats.
        if (Fillet > 0)
        {
            const string visible = "Clamp((ps.D * (1 - ps.O) - 8 * ps.O) / ps.F, 0, 1)";
            var left = Fillet_(new Vector2((float)Fillet, 0), new Vector2(0, (float)Fillet));
            Bind(left, "Offset", "Vector3(ps.CX - ps.L / 2 - ps.F, 0, 0)");
            Bind(left, "Scale", $"Vector3({visible}, {visible}, 1)");
            var right = Fillet_(Vector2.Zero, new Vector2((float)Fillet, (float)Fillet));
            Bind(right, "Offset", "Vector3(ps.CX + ps.L / 2, 0, 0)");
            Bind(right, "Scale", $"Vector3({visible}, {visible}, 1)");
            _shape.Children.InsertAtTop(left);
            _shape.Children.InsertAtTop(right);
        }
        ElementCompositionPreview.SetElementChildVisual(surfaceHost, _shape);

        // ---- content: clipped to the body, slides with it, fades with CA ----
        var cv = ElementCompositionPreview.GetElementVisual(content);
        ElementCompositionPreview.SetIsTranslationEnabled(content, true);
        var clip = Compositor.CreateInsetClip();
        cv.Clip = clip;
        Ps.InsertScalar("ML", (float)MaxL);
        Ps.InsertScalar("MD", (float)MaxD);
        string side = "(ps.ML - ps.L) / 2", far = "(ps.MD - ps.D)";
        switch (edge)
        {
            case Edge.Top:
                Bind(clip, "LeftInset", side); Bind(clip, "RightInset", side); Bind(clip, "BottomInset", far);
                break;
            case Edge.Bottom:
                Bind(clip, "LeftInset", side); Bind(clip, "RightInset", side); Bind(clip, "TopInset", far);
                break;
            case Edge.Right:
                Bind(clip, "TopInset", side); Bind(clip, "BottomInset", side); Bind(clip, "LeftInset", far);
                break;
            case Edge.Left:
                Bind(clip, "TopInset", side); Bind(clip, "BottomInset", side); Bind(clip, "RightInset", far);
                break;
        }
        const string slide = "(-ps.O * (ps.D + 8) + (ps.CA - 1) * ps.K)";
        const string along = "(ps.CX - ps.C0)"; // the body glides along the edge; the content rides with it
        Bind(cv, "Translation", edge switch
        {
            Edge.Top => $"Vector3({along}, {slide}, 0)",
            Edge.Bottom => $"Vector3({along}, -{slide}, 0)",
            Edge.Left => $"Vector3({slide}, {along}, 0)",
            _ => $"Vector3(-{slide}, {along}, 0)",
        });
        Bind(cv, "Opacity", "ps.CA * (1 - ps.O)");

        Theme.Changed += Recolor;
        win.Closed += (_, _) => Theme.Changed -= Recolor;
        Recolor();
        ApplyRegion(0, 0, 1);
    }

    void Bind(CompositionObject target, string property, string expression)
    {
        var e = Compositor.CreateExpressionAnimation(expression);
        e.SetReferenceParameter("ps", Ps);
        target.StartAnimation(property, e);
    }

    SpriteVisual Fillet_(Vector2 centerPoint, Vector2 circleCenter)
    {
        var g = Compositor.CreateRadialGradientBrush();
        g.MappingMode = CompositionMappingMode.Absolute;
        g.EllipseCenter = circleCenter;
        g.EllipseRadius = new Vector2((float)Fillet, (float)Fillet);
        float edge = (float)(1 - 1.2 / Fillet); // ~1px anti-aliased rim
        g.ColorStops.Add(Compositor.CreateColorGradientStop(0, default));
        g.ColorStops.Add(Compositor.CreateColorGradientStop(edge, default));
        var outside = Compositor.CreateColorGradientStop(1, default);
        g.ColorStops.Add(outside);
        _filletStops.Add(outside);
        _filletStops.Add(g.ColorStops[0]);
        _filletStops.Add(g.ColorStops[1]);
        var v = Compositor.CreateSpriteVisual();
        v.Size = new Vector2((float)Fillet, (float)Fillet);
        v.Brush = g;
        v.CenterPoint = new Vector3(centerPoint, 0);
        return v;
    }

    void Recolor()
    {
        var c = Theme.Get("Surface");
        _fill.Color = c;
        _outline.Color = Theme.Get("OutlineVariant");
        _bodyShape.StrokeThickness = Theme.Outlined ? 1 : 0; // keeps white panels visible on white pages
        var clear = Windows.UI.Color.FromArgb(0, c.R, c.G, c.B);
        for (int i = 0; i < _filletStops.Count; i++) _filletStops[i].Color = i % 3 == 0 ? c : clear;
        if (_win.Content is FrameworkElement fe) fe.RequestedTheme = Theme.IsDark ? ElementTheme.Dark : ElementTheme.Light;
    }

    /// <summary>Put the body's centre along the edge without animating (before showing it somewhere new).</summary>
    public void JumpAlong(double cx)
    {
        _cx = cx;
        Ps.InsertScalar("CX", (float)cx);
    }

    /// <summary>While fully hidden (O = 1), only this thin strip along the edge takes input (edge trigger).</summary>
    public void SetTriggerStrip(double length, double depth) { _strip = (length, depth); if (_o >= 1) ApplyRegion(_l, _d, _o); }

    /// <summary>Animate to a new shape. <paramref name="done"/> runs once it settles (unless superseded).
    /// <paramref name="along"/> moves the body's centre along the edge (window DIP; null keeps it).</summary>
    public void Animate(double l, double d, double r, double o, double ca, double k, Curve curve, Action? done = null, double? along = null)
    {
        int gen = ++_generation;
        double from = _cx, to = along ?? _cx;
        // Input region covers both the old and the new shape while moving, then shrinks to the final one.
        ApplyRegion(Math.Max(_l, l) * 1.06, Math.Max(_d * (1 - _o), d * (1 - o)) * 1.06, 0, from, to);
        _l = l; _d = d; _o = o; _cx = to;
        Ps.InsertScalar("K", (float)k);
        Motion.Batch(Compositor, () =>
        {
            if (along is not null) Motion.To(Ps, "CX", (float)to, curve);
            Motion.To(Ps, "L", (float)l, curve);
            Motion.To(Ps, "D", (float)d, curve);
            Motion.To(Ps, "R", (float)r, curve);
            Motion.To(Ps, "O", (float)o, curve);
            Motion.To(Ps, "CA", (float)ca, o >= 1 || ca == 0 ? Motion.Effects : Motion.SlowEffects);
        }, () =>
        {
            if (gen != _generation) return;
            ApplyRegion(_l, _d, _o);
            done?.Invoke();
        });
    }

    // SetWindowRgn sends WM_WINDOWPOS* synchronously, so it is always queued, never run inside a XAML or
    // compositor callback (re-entrancy there crashed Microsoft.UI.Xaml.dll before).
    void ApplyRegion(double l, double d, double o) => ApplyRegion(l, d, o, _cx, _cx);

    void ApplyRegion(double l, double d, double o, double cx0, double cx1) => _win.DispatcherQueue.TryEnqueue(() =>
    {
        double along0, along1, away;
        if (o >= 1)
        {
            if (_strip is not { } s) { Native.SetRegion(Hwnd, 0, 0, 0, 0); return; }
            along0 = _cx - s.l / 2; along1 = _cx + s.l / 2; away = s.d;
        }
        else
        {
            along0 = Math.Min(cx0, cx1) - l / 2 - Fillet; along1 = Math.Max(cx0, cx1) + l / 2 + Fillet; away = d * (1 - o) + 2;
        }
        along0 = Math.Max(0, along0); along1 = Math.Min(WinAlong, along1); away = Math.Min(WinAway, away);
        var (x0, y0, x1, y1) = Edge switch
        {
            Edge.Top => (along0, 0.0, along1, away),
            Edge.Bottom => (along0, WinAway - away, along1, WinAway),
            Edge.Left => (0.0, along0, away, along1),
            _ => (WinAway - away, along0, WinAway, along1),
        };
        Native.SetRegion(Hwnd, (int)Math.Floor(x0 * _dpi), (int)Math.Floor(y0 * _dpi), (int)Math.Ceiling(x1 * _dpi), (int)Math.Ceiling(y1 * _dpi));
    });

    /// <summary>Hide over fullscreen apps.</summary>
    public void SetHidden(bool hidden)
    {
        if (hidden == Hidden || SelfTest.Running) return; // a self-test must keep every surface on screen
        Hidden = hidden;
        if (hidden) _win.AppWindow.Hide(); else _win.AppWindow.Show(false);
    }

    IntPtr _previous;

    /// <summary>Take keyboard focus (queued: activation sends window messages).</summary>
    public void Focus() => _win.DispatcherQueue.TryEnqueue(() =>
    {
        if (SelfTest.Running) return; // never steal the user's keyboard during a self-test
        var fg = Native.GetForegroundWindow();
        if (fg != Hwnd) _previous = fg;
        _win.Activate();
        Native.SetForegroundWindow(Hwnd);
    });

    /// <summary>Give focus back to whatever had it before <see cref="Focus"/>.</summary>
    public void RestoreFocus() => _win.DispatcherQueue.TryEnqueue(() =>
    {
        if (Native.GetForegroundWindow() == Hwnd && _previous != IntPtr.Zero) Native.SetForegroundWindow(_previous);
    });

    public double DpiScale => _dpi;
}

// Window setup shared by every transparent, topmost, click-through-by-region surface (edge surfaces, the dim layer).
public static class SurfaceWindow
{
    /// <summary>Borderless popup, transparent backdrop, topmost, not in Alt+Tab. Returns the window's DPI scale.</summary>
    public static double Setup(Window win)
    {
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(win);
        win.SystemBackdrop = new TransparentTintBackdrop();
        win.AppWindow.SetPresenter(AppWindowPresenterKind.Overlapped);
        var op = (OverlappedPresenter)win.AppWindow.Presenter;
        op.SetBorderAndTitleBar(false, false);
        op.IsResizable = op.IsMaximizable = op.IsMinimizable = false;
        op.IsAlwaysOnTop = true;
        win.AppWindow.IsShownInSwitchers = false;
        Native.StripDwmFrame(hwnd);
        return Native.GetDpiForWindow(hwnd) / 96.0;
    }
}
