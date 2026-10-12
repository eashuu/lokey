using System.Numerics;
using Hitodama.Shell.Services;
using Hitodama.Shell.Tabs;
using Microsoft.UI.Composition;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Hosting;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Microsoft.UI.Xaml.Shapes;
using Windows.Foundation;

namespace Hitodama.Shell;

/// <summary>A page inside the island dashboard. Timers start in OnShown and stop in OnHidden.</summary>
public interface IPage
{
    void OnShown();
    void OnHidden();
}

// The top island: a live pill that morphs into Caelestia's dashboard. Pages sit side by side; switching
// slides them horizontally while the surface resizes to the new page's natural size (Content.qml).
public sealed partial class IslandWindow : Window
{
    public enum State { Collapsed, Hover, Peek, Expanded }

    sealed record TabDef(string Key, string Glyph, string Label, Func<FrameworkElement> Make);

    static readonly TabDef[] AllTabs =
    [
        new("Dashboard", "dashboard", "Dashboard", () => new DashTab()),
        new("Media", "queue_music", "Media", () => new MediaTab()),
        new("Performance", "speed", "Performance", () => new PerformanceTab()),
        new("Clipboard", "content_paste", "Clipboard", () => new ClipboardTab()),
    ];

    readonly EdgeSurface _s;
    readonly TabDef[] _tabs;
    readonly FrameworkElement?[] _pages;
    readonly List<(UIElement on, FrameworkElement measure)> _tabCells = [];
    readonly CompositionRoundedRectangleGeometry _indicator;
    readonly CompositionColorBrush _indicatorBrush;
    readonly double _pad, _headerH, _pillH, _maxL, _maxD, _peekL, _peekD;
    readonly DispatcherQueueTimer _closeTimer, _peekTimer, _hoverTimer, _clock, _pasteTimer;

    State _state = State.Collapsed;
    int _current = -1;
    bool _pointerInside, _openedByHover;
    double _pageL, _pageD;

    public State IslandState => _state;
    public EdgeSurface Surface => _s;
    public IntPtr Hwnd => _s.Hwnd;
    public int TabCount => _tabs.Length;
    public FrameworkElement? CurrentPage => _current >= 0 ? _pages[_current] : null;

    public IslandWindow()
    {
        InitializeComponent();
        var cfg = Store.Data.Island;
        _tabs = cfg.Tabs.Select(k => AllTabs.FirstOrDefault(t => t.Key == k)).OfType<TabDef>().ToArray();
        if (_tabs.Length == 0) _tabs = [AllTabs[0]];
        _pages = new FrameworkElement?[_tabs.Length];

        _pad = Tokens.Lg;
        _headerH = Tokens.Px(84);
        _pillH = Tokens.Px(36);
        _peekL = Tokens.Px(400);
        _peekD = Tokens.Px(72);
        _maxL = Math.Min(Tokens.ScreenW * 0.62, Tokens.Px(1100));
        _maxD = Math.Min(Tokens.ScreenH * 0.62, Tokens.Px(640));
        _s = new EdgeSurface(this, Root, SurfaceHost, Panel, Edge.Top, _maxL, _maxD);

        // ---- static sizes from tokens ----
        Pill.Height = _pillH;
        Dot.Width = Dot.Height = Tokens.Px(9);
        PillArt.Width = PillArt.Height = Tokens.Px(18);
        Peek.Width = _peekL;
        Peek.Height = _peekD;
        Peek.Padding = new Thickness(Tokens.Px(14), Tokens.Px(10), Tokens.Px(22), Tokens.Px(10));
        PeekArt.Width = PeekArt.Height = _peekD - Tokens.Px(20);
        Header.Height = _headerH;
        ElementCompositionPreview.GetElementVisual(Peek).Opacity = 0;
        PageHost.Margin = new Thickness(_pad, Tokens.Md, _pad, _pad);

        // ---- tabs (Tabs.qml): icon over label, uniform width, sliding indicator ----
        for (int i = 0; i < _tabs.Length; i++)
        {
            int index = i;
            TabRow.ColumnDefinitions.Add(new ColumnDefinition());
            // The selected layer swaps the outlined Symbol for the filled Material Icon while it crossfades in
            // (XAML cannot drive the font's FILL axis), like Caelestia's animated `fill`.
            FrameworkElement Layer(Brush fg, bool filled)
            {
                var stack = new StackPanel { Spacing = Tokens.XS, HorizontalAlignment = HorizontalAlignment.Center };
                // fixed-height box: the two icon fonts have different line heights, which would misalign the labels
                var box = new Grid { Height = Tokens.Font(26), Width = Tokens.Font(26), HorizontalAlignment = HorizontalAlignment.Center };
                box.Children.Add(new FontIcon { Glyph = _tabs[index].Glyph, FontFamily = App.Res<FontFamily>(filled ? "IconsFilled" : "Icons"), FontSize = Tokens.Font(22), Foreground = fg, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center });
                stack.Children.Add(box);
                stack.Children.Add(new TextBlock { Text = _tabs[index].Label, FontSize = Tokens.Font(12), FontFamily = App.Res<FontFamily>("Sans"), Foreground = fg, HorizontalAlignment = HorizontalAlignment.Center });
                return stack;
            }
            var off = Layer(App.Res<SolidColorBrush>("OnSurfaceVariant"), false);
            var on = Layer(App.Res<SolidColorBrush>("Primary"), true);
            ElementCompositionPreview.GetElementVisual(on).Opacity = 0; // composition opacity only, so animations own it
            var cell = new Grid();
            cell.Children.Add(off);
            cell.Children.Add(on);
            var b = new RippleButton
            {
                Content = cell, HorizontalAlignment = HorizontalAlignment.Stretch, VerticalAlignment = VerticalAlignment.Stretch,
                Padding = new Thickness(0, Tokens.Sm, 0, Tokens.Sm), Margin = new Thickness(Tokens.XS),
                CornerRadius = App.Res<CornerRadius>("RoundMd"),
            };
            b.Click += (_, _) => Select(index);
            Grid.SetColumn(b, i);
            TabRow.Children.Add(b);
            _tabCells.Add((on, off));
        }
        var comp = _s.Compositor;
        _indicator = comp.CreateRoundedRectangleGeometry();
        _indicator.CornerRadius = new Vector2(1.5f);
        _indicator.Size = new Vector2(0, 3);
        _indicatorBrush = comp.CreateColorBrush(Theme.Get("Primary"));
        var shape = comp.CreateSpriteShape(_indicator);
        shape.FillBrush = _indicatorBrush;
        var sv = comp.CreateShapeVisual();
        sv.Size = new Vector2((float)_maxL, 3);
        sv.Shapes.Add(shape);
        ElementCompositionPreview.SetElementChildVisual(IndicatorHost, sv);
        Theme.Changed += OnTheme;
        Closed += (_, _) => Theme.Changed -= OnTheme;

        // ---- timers ----
        _closeTimer = Timer(cfg.CloseDelayMs, () => { if (!_pointerInside) Collapse(); });
        _hoverTimer = Timer(300, () => { if (_pointerInside && _state == State.Hover) Open(byHover: true); });
        _peekTimer = Timer(1600, () => { if (_state == State.Peek) SetState(_pointerInside ? State.Hover : State.Collapsed); });
        _pasteTimer = Timer(140, Native.SendCtrlV);
        _clock = DispatcherQueue.CreateTimer();
        _clock.IsRepeating = false;
        _clock.Tick += (_, _) => Tick();

        // ---- input ----
        Root.PointerEntered += (_, _) =>
        {
            _pointerInside = true;
            _closeTimer.Stop();
            if (_state == State.Collapsed) SetState(State.Hover);
            if (_state == State.Hover && cfg.HoverOpen) _hoverTimer.Start();
        };
        Root.PointerExited += (_, _) =>
        {
            _pointerInside = false;
            _hoverTimer.Stop();
            if (_state == State.Hover) SetState(State.Collapsed);
            else if (_state == State.Expanded && _openedByHover) _closeTimer.Start();
        };
        Root.Tapped += (_, _) => { if (_state != State.Expanded) Open(byHover: false); };
        Root.PointerWheelChanged += OnWheel;
        Root.AddHandler(UIElement.KeyDownEvent, new KeyEventHandler(OnKey), true);
        Activated += (_, e) =>
        {
            if (e.WindowActivationState == WindowActivationState.Deactivated && _state == State.Expanded && !_pointerInside) Collapse();
        };

        Media.Changed += OnMedia;
        Media.TrackChanged += OnTrack;
        FocusTimer.Finished += OnTimerDone;
        Closed += (_, _) => { Media.Changed -= OnMedia; Media.TrackChanged -= OnTrack; FocusTimer.Finished -= OnTimerDone; };

        Root.Loaded += (_, _) =>
        {
            Tick();
            OnMedia();
            Select(0);
            SetState(State.Collapsed);
        };
    }

    void OnTrack()
    {
        if (Store.Data.Island.PeekOnTrack && Media.Title.Length > 0) ShowPeek("music_note", Media.Title, Media.Artist, null, null, Media.Art, 3000);
    }

    void OnTimerDone() => ShowPeek("timer", "Time's up", "Focus session complete", null, null, null, 4000);

    // ================= public API =================

    public void Open(bool byHover = false)
    {
        _openedByHover = byHover;
        SetState(State.Expanded);
        if (!byHover) _s.Focus();
    }

    public void Open(string tabKey)
    {
        int i = Array.FindIndex(_tabs, t => t.Key.Equals(tabKey, StringComparison.OrdinalIgnoreCase));
        if (i >= 0) Select(i);
        Open();
    }

    public void Collapse()
    {
        if (_state != State.Expanded) return;
        SetState(_pointerInside ? State.Hover : State.Collapsed);
    }

    public void Toggle() { if (_state == State.Expanded) Collapse(); else Open(); }

    public void CollapseAndPaste()
    {
        Collapse();
        _pasteTimer.Start();
    }

    public void ShowPeek(string glyph, string title, string? subtitle, double? level, string? value, BitmapImage? art, int ms = 1600)
    {
        if (_state == State.Expanded || _s.Hidden) return;
        PeekGlyph.Glyph = glyph;
        PeekArtBrush.ImageSource = art;
        PeekTitle.Text = title;
        PeekValue.Text = value ?? "";
        PeekSubtitle.Text = subtitle ?? "";
        PeekSubtitle.Visibility = subtitle is null ? Visibility.Collapsed : Visibility.Visible;
        PeekBar.Visibility = level is null ? Visibility.Collapsed : Visibility.Visible;
        double barW = _peekL - Peek.Padding.Left - Peek.Padding.Right - PeekArt.Width - Peek.ColumnSpacing;
        PeekFill.Width = Math.Clamp(level ?? 0, 0, 1) * barW;
        _peekTimer.Interval = TimeSpan.FromMilliseconds(ms);
        _peekTimer.Stop();
        _peekTimer.Start();
        if (_state != State.Peek) SetState(State.Peek);
    }

    // ================= state machine =================

    void SetState(State s)
    {
        var was = _state;
        _state = s;
        if (s == State.Expanded)
        {
            Panel.Visibility = Visibility.Visible;
            if (_current < 0) Select(0); else Layout(_current);
        }

        double pillW = Math.Max(Tokens.Px(150), MeasurePill() + Tokens.Px(32));
        (double l, double d, double r, double ca) = s switch
        {
            State.Hover => (pillW + Tokens.Px(28), _pillH + Tokens.Px(6), (_pillH + Tokens.Px(6)) / 2, 0.0),
            State.Peek => (_peekL, _peekD, Tokens.Px(26), 0.0),
            State.Expanded => (_pageL, _pageD, Tokens.Px(28), 1.0),
            _ => (pillW, _pillH, _pillH / 2, 0.0),
        };
        _s.Animate(l, d, r, 0, ca, Tokens.Px(18), Motion.Spatial, () =>
        {
            if (_state != State.Expanded) Panel.Visibility = Visibility.Collapsed;
        });

        ElementCompositionPreview.SetIsTranslationEnabled(Pill, true);
        var pill = ElementCompositionPreview.GetElementVisual(Pill);
        Motion.To(pill, "Opacity", s is State.Collapsed or State.Hover ? 1f : 0f, Motion.Effects);
        Motion.To(pill, "Translation", new Vector3(0, (float)((d - _pillH) / 2), 0), Motion.Spatial);
        var peek = ElementCompositionPreview.GetElementVisual(Peek);
        Motion.To(peek, "Opacity", s == State.Peek ? 1f : 0f, s == State.Peek ? Motion.SlowEffects : Motion.Effects);
        Panel.IsHitTestVisible = s == State.Expanded;

        if (s == State.Expanded && was != State.Expanded) (_pages[_current] as IPage)?.OnShown();
        if (was == State.Expanded && s != State.Expanded)
        {
            (_pages[_current] as IPage)?.OnHidden();
            _s.RestoreFocus();
        }
    }

    double MeasurePill()
    {
        Pill.Measure(new Size(double.PositiveInfinity, _pillH));
        return Pill.DesiredSize.Width;
    }

    // ================= tabs & pages =================

    public void Select(int index)
    {
        index = Math.Clamp(index, 0, _tabs.Length - 1);
        if (index == _current) return;
        int from = _current;
        _current = index;
        var page = _pages[index] ??= CreatePage(index);
        page.Visibility = Visibility.Visible;
        double oldL = _pageL;
        Layout(index);

        for (int i = 0; i < _tabCells.Count; i++)
            Motion.To(ElementCompositionPreview.GetElementVisual(_tabCells[i].on), "Opacity", i == index ? 1f : 0f, Motion.Effects);

        if (_state != State.Expanded || from < 0)
        {
            if (from >= 0) _pages[from]!.Visibility = Visibility.Collapsed;
            return;
        }

        // Resize the surface to the new page and slide pages like Caelestia's Flickable contentX.
        _s.Animate(_pageL, _pageD, Tokens.Px(28), 0, 1, Tokens.Px(18), Motion.Spatial);
        var outgoing = _pages[from]!;
        (outgoing as IPage)?.OnHidden();
        (page as IPage)?.OnShown();
        float dir = index > from ? 1 : -1, dist = (float)(Math.Max(oldL, _pageL) / 2 + Tokens.Px(24));
        var inV = ElementCompositionPreview.GetElementVisual(page);
        var outV = ElementCompositionPreview.GetElementVisual(outgoing);
        Motion.Batch(_s.Compositor, () =>
        {
            Motion.FromTo(inV, "Translation", new Vector3(dir * dist, 0, 0), Vector3.Zero, Motion.Spatial);
            Motion.FromTo(inV, "Opacity", 0, 1, Motion.SlowEffects);
            Motion.To(outV, "Translation", new Vector3(-dir * dist, 0, 0), Motion.Spatial);
            Motion.To(outV, "Opacity", 0f, Motion.Effects);
        }, () =>
        {
            if (_current == from) return;
            outgoing.Visibility = Visibility.Collapsed;
            Motion.FromTo(outV, "Opacity", 1, 1, Motion.Effects);
            Motion.FromTo(outV, "Translation", Vector3.Zero, Vector3.Zero, Motion.Effects);
        });
    }

    FrameworkElement CreatePage(int index)
    {
        var page = _tabs[index].Make();
        page.HorizontalAlignment = HorizontalAlignment.Center;
        page.VerticalAlignment = VerticalAlignment.Top;
        ElementCompositionPreview.SetIsTranslationEnabled(page, true);
        PageHost.Children.Add(page);
        return page;
    }

    // Size the surface to the page's natural size (Content.qml nonAnimWidth/Height) and place the indicator.
    void Layout(int index)
    {
        var page = _pages[index]!;
        page.Measure(new Size(_maxL - 2 * _pad, _maxD - _headerH - _pad - Tokens.Md));
        double minL = _tabs.Length * Tokens.Px(112) + 2 * _pad;
        _pageL = Math.Min(_maxL, Math.Max(page.DesiredSize.Width + 2 * _pad, minL));
        _pageD = Math.Min(_maxD, _headerH + Tokens.Md + page.DesiredSize.Height + _pad);
        double headerW = _pageL - 2 * _pad;
        Header.Width = headerW;

        var label = _tabCells[index].measure;
        label.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
        double tabW = headerW / _tabs.Length, indW = Math.Max(Tokens.Px(24), label.DesiredSize.Width);
        var offset = new Vector2((float)(tabW * index + (tabW - indW) / 2), 0);
        var size = new Vector2((float)indW, 3);
        if (_state == State.Expanded) { Motion.To(_indicator, "Offset", offset, Motion.Spatial); Motion.To(_indicator, "Size", size, Motion.Spatial); }
        else { _indicator.Offset = offset; _indicator.Size = size; }
    }

    // ================= input =================

    void OnWheel(object sender, PointerRoutedEventArgs e)
    {
        var p = e.GetCurrentPoint(Root);
        int delta = p.Properties.MouseWheelDelta;
        if (_state != State.Expanded)
        {
            if (delta < 0 && Store.Data.Island.WheelOpen) Open(byHover: _pointerInside);
            return;
        }
        if (p.Properties.IsHorizontalMouseWheel) { Select(_current + (delta > 0 ? 1 : -1)); e.Handled = true; }
        else if (p.Position.Y < _headerH) { Select(_current + (delta < 0 ? 1 : -1)); e.Handled = true; }
    }

    void OnKey(object sender, KeyRoutedEventArgs e)
    {
        if (_state != State.Expanded) return;
        static bool Down(Windows.System.VirtualKey k) =>
            Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(k).HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down);
        if (e.Key == Windows.System.VirtualKey.Escape) { Collapse(); e.Handled = true; }
        else if (e.Key == Windows.System.VirtualKey.Tab && Down(Windows.System.VirtualKey.Control))
        {
            Select(_current + (Down(Windows.System.VirtualKey.Shift) ? -1 : 1));
            e.Handled = true;
        }
    }

    // ================= live pill =================

    void OnMedia()
    {
        bool has = Media.Title.Length > 0;
        PillArtBrush.ImageSource = Media.Art;
        PillArt.Visibility = has && Media.Art is not null ? Visibility.Visible : Visibility.Collapsed;
        PillBars.Visibility = has && Media.Playing && Store.Data.Island.AnimateEqualizer ? Visibility.Visible : Visibility.Collapsed;
        Equalizer(PillBars.Visibility == Visibility.Visible);
        if (_state is State.Collapsed or State.Hover) SetState(_state);
    }

    void Equalizer(bool on)
    {
        if (PillBars.Children.Count == 0)
            for (int i = 0; i < 3; i++)
                PillBars.Children.Add(new Rectangle { Width = 3, Height = Tokens.Px(14), RadiusX = 1.5, RadiusY = 1.5, Fill = App.Res<SolidColorBrush>("Primary") });
        double[] periods = [0.9, 0.7, 1.1];
        for (int i = 0; i < 3; i++)
        {
            var v = ElementCompositionPreview.GetElementVisual(PillBars.Children[i]);
            v.CenterPoint = new Vector3(1.5f, (float)Tokens.Px(7), 0);
            if (!on) { v.StopAnimation("Scale"); continue; }
            var a = v.Compositor.CreateVector3KeyFrameAnimation();
            a.InsertKeyFrame(0, new Vector3(1, 0.3f, 1));
            a.InsertKeyFrame(0.5f, Vector3.One);
            a.InsertKeyFrame(1, new Vector3(1, 0.3f, 1));
            a.Duration = TimeSpan.FromSeconds(periods[i]);
            a.IterationBehavior = AnimationIterationBehavior.Forever;
            v.StartAnimation("Scale", a);
        }
    }

    // Minute-aligned clock; ticks every second only while a focus timer runs.
    void Tick()
    {
        var now = DateTime.Now;
        PillClock.Text = now.ToString(@"h\:mm");
        bool timer = FocusTimer.Running;
        PillTimer.Text = timer ? FocusTimer.Remaining.ToString(@"m\:ss") : "";
        var vis = timer ? Visibility.Visible : Visibility.Collapsed;
        if (PillTimer.Visibility != vis)
        {
            PillTimer.Visibility = vis;
            if (_state is State.Collapsed or State.Hover) SetState(_state);
        }
        _clock.Stop();
        _clock.Interval = timer ? TimeSpan.FromSeconds(1) : TimeSpan.FromSeconds(60 - now.Second + 0.05);
        _clock.Start();
    }

    /// <summary>Called when a focus timer starts so the pill switches to per-second updates.</summary>
    public void Retick() => Tick();

    void OnTheme() => _indicatorBrush.Color = Theme.Get("Primary");

    DispatcherQueueTimer Timer(int ms, Action action)
    {
        var t = DispatcherQueue.CreateTimer();
        t.Interval = TimeSpan.FromMilliseconds(ms);
        t.IsRepeating = false;
        t.Tick += (_, _) => action();
        return t;
    }
}
