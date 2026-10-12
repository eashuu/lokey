using System.Numerics;
using Hitodama.Shell.Services;
using Microsoft.UI.Composition;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Hosting;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.Foundation;
using Windows.Graphics;

namespace Hitodama.Shell;

// Caelestia's left bar (modules/bar): a full-height strip on a screen edge holding logo, workspaces (Windows virtual
// desktops), active window, clock, status icons and power. In "reserve" mode it claims screen space like the
// taskbar (an appbar on the hidden message window), otherwise it autohides behind a thin edge strip. Hovering an
// entry opens a BarPopout; the wheel changes volume (top half), brightness (bottom half) or desktop (workspaces).
public sealed partial class BarWindow : Window
{
    sealed record Hover(FrameworkElement El, string Popout);
    sealed record StatusIcon(string Id, Border Cell, FontIcon? Icon, TextBlock? Text);

    readonly EdgeSurface _s;
    readonly BarPopout? _popouts;
    readonly BarSettings _cfg = Store.Data.Bar;
    readonly bool _left, _autohide;
    readonly double _w, _h, _inner, _cell, _pitch, _radius;
    readonly (int l, int t, int r, int b) _rect, _monitor;
    readonly Grid _list = new();
    readonly List<Hover> _hovers = [];
    readonly List<StatusIcon> _status = [];
    readonly DispatcherQueueTimer _clock, _hide;

    // workspaces
    readonly StackPanel _wsStack = new();
    readonly Canvas _wsHost = new();
    readonly CompositionPropertySet _ind;
    readonly CompositionColorBrush _indBrush;
    readonly List<(RippleButton btn, Ellipse dot)> _wsCells = [];
    FrameworkElement? _workspaces;
    int _indTarget = -1;

    // other entries
    TextBlock? _hh, _mm, _ss, _title;
    Canvas? _titleBox;
    Image? _appIcon;
    string? _hoverName;
    bool _shown;
    int? _brightness;

    public EdgeSurface Surface => _s;
    public BarPopout? Popouts => _popouts;
    public IntPtr Hwnd => _s.Hwnd;
    public FrameworkElement Entries => _list;
    /// <summary>The strip the bar occupies, in physical px (what it reserved).</summary>
    public RectInt32 Rect => new(_rect.l, _rect.t, _rect.r - _rect.l, _rect.b - _rect.t);
    public double WidthPx => _rect.r - _rect.l;
    public bool Reserved => !_autohide;

    public BarWindow()
    {
        InitializeComponent();
        _left = _cfg.Position != "right";
        _autohide = _cfg.Mode == "autohide";
        _w = Tokens.Px(60);
        _inner = Tokens.Px(40);
        _cell = Tokens.Px(32);
        _pitch = _cell + Tokens.Px(4);
        _radius = Tokens.Px(25);

        double dpi = Native.PrimaryDpi() / 96.0;
        var mon = DisplayArea.Primary.OuterBounds;
        _monitor = (mon.X, mon.Y, mon.X + mon.Width, mon.Y + mon.Height);
        int wpx = (int)Math.Ceiling(_w * dpi);
        _rect = _autohide
            ? (_left ? _monitor.l : _monitor.r - wpx, _monitor.t, _left ? _monitor.l + wpx : _monitor.r, _monitor.b)
            : App.Messages.ReserveEdge(_left ? 0u : 2u, wpx, _monitor); // the system keeps clear of the taskbar
        _h = (_rect.b - _rect.t) / dpi;

        var area = new RectInt32(_rect.l, _rect.t, _rect.r - _rect.l, _rect.b - _rect.t);
        _s = new EdgeSurface(this, Root, SurfaceHost, Panel, _left ? Edge.Left : Edge.Right, _h, _w, area, fillet: 0, alongSize: _h);
        _s.Ps.InsertScalar("L", (float)_h);
        _s.Ps.InsertScalar("D", (float)_w);
        _s.Ps.InsertScalar("R", (float)_radius);
        _s.Ps.InsertScalar("O", 1);
        if (_autohide) _s.SetTriggerStrip(_h, 3);

        // ---- shared state the entries read ----
        Desktops.Init(DispatcherQueue);
        Status.Init(DispatcherQueue);
        Foreground.TrackTitles(_cfg.Entries.Any(e => e.Enabled && e.Id == "activeWindow"));

        // ---- sliding workspace indicator (Primary pill; leading edge fast, trailing edge slow) ----
        var comp = _s.Compositor;
        _ind = comp.CreatePropertySet();
        _ind.InsertScalar("T", 0);
        _ind.InsertScalar("B", (float)_cell);
        _indBrush = comp.CreateColorBrush(Theme.Get("Primary"));

        BuildEntries();
        if (_popouts is null && _cfg.Popouts)
        {
            var popArea = _left
                ? new RectInt32(_rect.r, _monitor.t, _monitor.r - _rect.r, _monitor.b - _monitor.t)
                : new RectInt32(_monitor.l, _monitor.t, _rect.l - _monitor.l, _monitor.b - _monitor.t);
            _popouts = new BarPopout(_left ? Edge.Left : Edge.Right, popArea, (_rect.t - _monitor.t) / dpi);
            _popouts.AppWindow.Show(false);
        }

        _clock = DispatcherQueue.CreateTimer();
        _clock.IsRepeating = false;
        _clock.Tick += (_, _) => TickClock();
        _hide = DispatcherQueue.CreateTimer();
        _hide.Interval = TimeSpan.FromMilliseconds(600);
        _hide.IsRepeating = false;
        _hide.Tick += (_, _) => { if (_autohide && _shown && _popouts?.IsOpen != true) SetShown(false); };

        Root.PointerMoved += (_, e) => CheckPopout(e.GetCurrentPoint(Root).Position.Y);
        Root.PointerEntered += (_, _) =>
        {
            _hide.Stop();
            _popouts?.SetBarHover(true);
            if (_autohide && !_shown) SetShown(true);
        };
        Root.PointerExited += (_, _) =>
        {
            _hoverName = null;
            _popouts?.SetBarHover(false);
            if (_autohide) _hide.Start();
        };
        Root.PointerWheelChanged += OnWheel;

        Audio.Changed += OnAudio;
        Status.Changed += UpdateStatus;
        Desktops.Changed += UpdateWorkspaces;
        Foreground.ActiveChanged += UpdateActive;
        Theme.Changed += Recolor;
        Closed += (_, _) =>
        {
            Audio.Changed -= OnAudio; Status.Changed -= UpdateStatus; Desktops.Changed -= UpdateWorkspaces;
            Foreground.ActiveChanged -= UpdateActive; Theme.Changed -= Recolor;
            _clock.Stop(); _hide.Stop();
            _popouts?.Close();
        };

        Root.Loaded += (_, _) =>
        {
            TickClock();
            UpdateAll();
            if (!_autohide) SetShown(true);
        };
    }

    /// <summary>Give back the screen space (and stop title tracking). Call before <see cref="Window.Close"/>.</summary>
    public void Release()
    {
        if (!_autohide) App.Messages.ReserveEdge(_left ? 0u : 2u, 0, _monitor);
        Foreground.TrackTitles(false);
    }

    public void SetHidden(bool hidden)
    {
        _s.SetHidden(hidden);
        _popouts?.Surface.SetHidden(hidden);
    }

    public void SetShown(bool shown)
    {
        _shown = shown;
        _s.Animate(_h, _w, _radius, shown ? 0 : 1, shown ? 1 : 0, 0, shown ? Motion.Spatial : Motion.Emphasized);
    }

    /// <summary>Open a popout as if its entry was hovered (used by the self-test).</summary>
    public void ShowPopout(string name)
    {
        var h = _hovers.FirstOrDefault(x => x.Popout == name && x.El.Visibility == Visibility.Visible);
        double center = h is null ? _h / 2 : BoundsOf(h.El).Top + BoundsOf(h.El).Height / 2;
        _popouts?.Show(name, center);
    }

    // ================= entries =================

    void BuildEntries()
    {
        _list.Margin = new Thickness((_w - _inner) / 2, Tokens.Px(12), (_w - _inner) / 2, Tokens.Px(12));
        _list.RowSpacing = Tokens.Px(12);
        int row = 0;
        foreach (var e in _cfg.Entries.Where(e => e.Enabled))
        {
            FrameworkElement? el = e.Id switch
            {
                "logo" => Logo(),
                "workspaces" => Workspaces(),
                "activeWindow" => ActiveWindow(),
                "clock" => Clock(),
                "statusIcons" => StatusIcons(),
                "power" => Power(),
                _ => null,
            };
            if (el is null && e.Id != "spacer") continue;
            _list.RowDefinitions.Add(new RowDefinition { Height = el is null ? new GridLength(1, GridUnitType.Star) : GridLength.Auto });
            if (el is not null) { Grid.SetRow(el, row); _list.Children.Add(el); }
            row++;
        }
        Panel.Children.Add(_list);
        FitTitle();
    }

    FrameworkElement Logo()
    {
        // The Windows mark: four rounded squares in Tertiary.
        double q = Tokens.Px(8), gap = Tokens.Px(2);
        var logo = new Grid { RowSpacing = gap, ColumnSpacing = gap, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        for (int i = 0; i < 2; i++) { logo.RowDefinitions.Add(new RowDefinition()); logo.ColumnDefinitions.Add(new ColumnDefinition()); }
        for (int i = 0; i < 4; i++)
            logo.Children.Add(new Rectangle { Width = q, Height = q, RadiusX = 1.5, RadiusY = 1.5, Fill = Ui.Brush("Tertiary") }.At(i / 2, i % 2));
        var b = new RippleButton { Content = logo, Width = _inner, Height = _inner, Padding = new Thickness(0), CornerRadius = new CornerRadius(_inner / 2) };
        b.Click += (_, _) => App.Launcher?.Toggle();
        ToolTipService.SetToolTip(b, "Launcher");
        return b;
    }

    FrameworkElement Workspaces()
    {
        var pill = new Grid { Background = Ui.Brush("SurfaceContainer"), CornerRadius = new CornerRadius(_inner / 2), Padding = new Thickness(Tokens.Px(4)) };
        _wsStack.Spacing = _pitch - _cell;
        _wsHost.Width = _cell;
        _wsHost.HorizontalAlignment = HorizontalAlignment.Center;
        _wsHost.VerticalAlignment = VerticalAlignment.Top;
        _wsStack.HorizontalAlignment = HorizontalAlignment.Center;
        pill.Children.Add(_wsHost);
        pill.Children.Add(_wsStack);
        pill.Width = _inner;

        // indicator: one rounded rect whose top and bottom edges are animated separately
        var comp = _s.Compositor;
        var geo = comp.CreateRoundedRectangleGeometry();
        geo.CornerRadius = new Vector2((float)_cell / 2);
        void Bind(string prop, string expr)
        {
            var a = comp.CreateExpressionAnimation(expr);
            a.SetReferenceParameter("ps", _ind);
            geo.StartAnimation(prop, a);
        }
        Bind("Offset", "Vector2(0, ps.T)");
        Bind("Size", $"Vector2({(float)_cell}, Max(ps.B - ps.T, 0))");
        var shape = comp.CreateSpriteShape(geo);
        shape.FillBrush = _indBrush;
        var sv = comp.CreateShapeVisual();
        sv.Size = new Vector2((float)_cell, (float)(_pitch * 24));
        sv.Shapes.Add(shape);
        ElementCompositionPreview.SetElementChildVisual(_wsHost, sv);

        pill.PointerWheelChanged += (_, e) =>
        {
            if (!_cfg.ScrollWorkspaces) return;
            Desktops.Step(e.GetCurrentPoint(pill).Properties.MouseWheelDelta < 0 ? 1 : -1);
            e.Handled = true;
        };
        _workspaces = pill;
        BuildWorkspaceCells();
        return pill;
    }

    void BuildWorkspaceCells()
    {
        _wsStack.Children.Clear();
        _wsCells.Clear();
        for (int i = 0; i < Desktops.Count; i++)
        {
            int index = i;
            var dot = new Ellipse { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            var b = new RippleButton
            {
                Content = dot, Width = _cell, Height = _cell, Padding = new Thickness(0), CornerRadius = new CornerRadius(_cell / 2),
                Foreground = Ui.Brush("OnSurface"),
            };
            b.Click += (_, _) => Desktops.Switch(index);
            ToolTipService.SetToolTip(b, $"Desktop {i + 1}");
            _wsStack.Children.Add(b);
            _wsCells.Add((b, dot));
        }
        _indTarget = -1;
        UpdateWorkspaces();
    }

    void UpdateWorkspaces()
    {
        if (_workspaces is null) return;
        if (_wsCells.Count != Desktops.Count) { BuildWorkspaceCells(); return; }
        int cur = Math.Clamp(Desktops.Current, 0, _wsCells.Count - 1);
        for (int i = 0; i < _wsCells.Count; i++)
        {
            var dot = _wsCells[i].dot;
            bool active = i == cur, used = Desktops.IsOccupied(i);
            dot.Width = dot.Height = Tokens.Px(active || used ? 8 : 5); // occupied desktops get the bigger dot
            dot.Fill = Ui.Brush(active ? "OnPrimary" : used ? "OnSurface" : "Outline");
        }
        float t = (float)(cur * _pitch), b = t + (float)_cell;
        if (_indTarget < 0) { _ind.InsertScalar("T", t); _ind.InsertScalar("B", b); }
        else if (cur != _indTarget)
        {
            bool down = cur > _indTarget; // the edge moving ahead is fast, the one trailing behind is slow: the pill stretches
            Motion.To(_ind, "T", t, down ? Motion.Spatial : Motion.FastSpatial);
            Motion.To(_ind, "B", b, down ? Motion.FastSpatial : Motion.Spatial);
        }
        _indTarget = cur;
    }

    FrameworkElement ActiveWindow()
    {
        _appIcon = new Image { Width = Tokens.Px(22), Height = Tokens.Px(22), HorizontalAlignment = HorizontalAlignment.Center };
        _title = Ui.Text("", 13, "Primary", Microsoft.UI.Text.FontWeights.SemiBold);
        _title.Width = Tokens.Px(200);
        // The title reads top to bottom: rotate it 90 degrees inside a box of the rotated size.
        double line = Tokens.Font(13) * 1.5;
        _title.Height = line;
        _title.HorizontalAlignment = HorizontalAlignment.Left;
        _title.VerticalAlignment = VerticalAlignment.Top;
        _title.RenderTransformOrigin = new Point(0, 0);
        _title.RenderTransform = new CompositeTransform { Rotation = 90, TranslateX = line };
        var box = _titleBox = new Canvas { Width = line, Height = Tokens.Px(200), HorizontalAlignment = HorizontalAlignment.Center }; // a Canvas, so the long text is not clipped to the narrow cell
        box.Children.Add(_title);
        var col = Ui.Stack(Orientation.Vertical, 6, _appIcon, box);
        col.Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        col.HorizontalAlignment = HorizontalAlignment.Center;
        _hovers.Add(new Hover(col, "activewindow"));
        return col;
    }

    // The title box shrinks when the other entries leave too little height.
    void FitTitle()
    {
        if (_title is null) return;
        double full = Tokens.Px(200), spacerless = 0;
        _list.Measure(new Size(_inner, double.PositiveInfinity));
        spacerless = _list.DesiredSize.Height;
        double over = spacerless - (_h - 2 * Tokens.Px(12));
        double len = Math.Clamp(full - Math.Max(0, over), Tokens.Px(48), full);
        _title.Width = len;
        if (_titleBox is not null) _titleBox.Height = len;
    }

    FrameworkElement Clock()
    {
        _hh = Ui.Num("", 15, "Tertiary"); _mm = Ui.Num("", 15, "Tertiary");
        foreach (var t in new[] { _hh, _mm }) t.HorizontalAlignment = HorizontalAlignment.Center;
        var icon = Ui.Icon("calendar_month", 18, "Tertiary");
        icon.HorizontalAlignment = HorizontalAlignment.Center;
        var col = Ui.Stack(Orientation.Vertical, 2, icon, _hh, _mm);
        if (_cfg.ShowSeconds)
        {
            _ss = Ui.Num("", 11, "Tertiary", Microsoft.UI.Text.FontWeights.Normal);
            _ss.HorizontalAlignment = HorizontalAlignment.Center;
            _ss.Opacity = 0.7;
            col.Children.Add(_ss);
        }
        col.Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        col.HorizontalAlignment = HorizontalAlignment.Center;
        col.Padding = new Thickness(0, Tokens.Px(2), 0, Tokens.Px(2));
        _hovers.Add(new Hover(col, "clock"));
        return col;
    }

    FrameworkElement? StatusIcons()
    {
        var stack = new StackPanel { Spacing = 0, HorizontalAlignment = HorizontalAlignment.Center };
        void Add(string id, string popout, bool wanted, bool filled = false)
        {
            if (!wanted) return;
            var cell = new Border { Height = Tokens.Px(28), Width = _inner, Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent) };
            FontIcon? icon = null; TextBlock? text = null;
            if (id == "kb") { text = Ui.Num("", 12, "Secondary"); text.HorizontalAlignment = HorizontalAlignment.Center; text.VerticalAlignment = VerticalAlignment.Center; cell.Child = text; }
            else { icon = Ui.Icon("circle", 18, "Secondary", filled); icon.HorizontalAlignment = HorizontalAlignment.Center; icon.VerticalAlignment = VerticalAlignment.Center; cell.Child = icon; }
            stack.Children.Add(cell);
            _status.Add(new StatusIcon(id, cell, icon, text));
            if (popout.Length > 0) _hovers.Add(new Hover(cell, popout));
        }
        Add("audio", "audio", _cfg.ShowAudio, filled: true);
        Add("mic", "audio", _cfg.ShowMic);
        Add("kb", "", _cfg.ShowKeyboard);
        Add("net", "network", _cfg.ShowNetwork);
        Add("bt", "bluetooth", _cfg.ShowBluetooth);
        Add("bat", "battery", _cfg.ShowBattery);
        if (_status.Count == 0) return null;
        return new Border
        {
            Background = Ui.Brush("SurfaceContainer"), CornerRadius = new CornerRadius(_inner / 2), Child = stack, Width = _inner,
            Padding = new Thickness(0, Tokens.Px(6), 0, Tokens.Px(6)),
        };
    }

    FrameworkElement Power()
    {
        var b = new RippleButton
        {
            Content = Ui.Icon("power_settings_new", 19, "Error"), Width = _inner, Height = _inner, Padding = new Thickness(0),
            CornerRadius = new CornerRadius(_inner / 2), Foreground = Ui.Brush("Error"),
        };
        b.Click += (_, _) => App.ShowSession();
        ToolTipService.SetToolTip(b, "Session");
        return b;
    }

    // ================= live updates =================

    void UpdateAll()
    {
        UpdateStatus();
        UpdateActive();
        UpdateWorkspaces();
    }

    void OnAudio(double level, bool muted) => UpdateStatus();

    void UpdateStatus()
    {
        foreach (var (id, cell, icon, text) in _status)
        {
            switch (id)
            {
                case "audio":
                    double v = Audio.Muted ? 0 : Audio.Level;
                    icon!.Glyph = v <= 0 ? "volume_off" : v < 0.34 ? "volume_mute" : v < 0.67 ? "volume_down" : "volume_up";
                    break;
                case "mic":
                    icon!.Glyph = Audio.MicAvailable && !Audio.MicMuted ? "mic" : "mic_off";
                    cell.Visibility = Audio.MicAvailable ? Visibility.Visible : Visibility.Collapsed;
                    break;
                case "kb":
                    text!.Text = Status.Layout;
                    cell.Visibility = Status.Layout.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
                    break;
                case "net":
                    icon!.Glyph = !Status.Online ? "signal_wifi_off" : Status.Wifi ? "wifi" : "lan";
                    break;
                case "bt":
                    icon!.Glyph = Status.Bluetooth == false ? "bluetooth_disabled" : "bluetooth";
                    cell.Visibility = Status.Bluetooth is null ? Visibility.Collapsed : Visibility.Visible;
                    break;
                case "bat":
                    cell.Visibility = Status.HasBattery ? Visibility.Visible : Visibility.Collapsed;
                    icon!.Glyph = Status.Charging ? "battery_charging_full" : BatteryGlyph(Status.Percent);
                    icon.Foreground = Ui.Brush(Status.Percent <= 15 && !Status.Charging ? "Error" : "Secondary");
                    break;
            }
        }
    }

    static string BatteryGlyph(int p) => p switch
    {
        >= 90 => "battery_full", >= 75 => "battery_6_bar", >= 60 => "battery_5_bar", >= 45 => "battery_4_bar",
        >= 30 => "battery_3_bar", >= 20 => "battery_2_bar", >= 10 => "battery_1_bar", _ => "battery_0_bar",
    };

    void UpdateActive()
    {
        if (_title is null) return;
        _title.Text = Foreground.Title.Length > 0 ? Foreground.Title : "Desktop";
        var icon = Foreground.Icon(Foreground.Exe, (int)Math.Round(Tokens.Px(22) * _s.DpiScale));
        _appIcon!.Source = icon;
        _appIcon.Visibility = icon is null ? Visibility.Collapsed : Visibility.Visible;
    }

    // Minute-aligned; per second only when seconds are shown.
    void TickClock()
    {
        var now = DateTime.Now;
        if (_hh is null || _mm is null) return;
        _hh.Text = now.ToString("HH");
        _mm.Text = now.ToString("mm");
        if (_ss is not null) _ss.Text = now.ToString("ss");
        _clock.Interval = _ss is not null ? TimeSpan.FromMilliseconds(1050 - now.Millisecond) : TimeSpan.FromSeconds(60 - now.Second + 0.05);
        _clock.Start();
    }

    void Recolor() => _indBrush.Color = Theme.Get("Primary");

    // ================= hover & wheel =================

    Rect BoundsOf(FrameworkElement el) => el.TransformToVisual(Root).TransformBounds(new Rect(0, 0, el.ActualWidth, el.ActualHeight));

    void CheckPopout(double y)
    {
        if (_popouts is null) return;
        double gap = Tokens.Px(6);
        foreach (var h in _hovers)
        {
            if (h.El.Visibility != Visibility.Visible || h.El.ActualHeight <= 0) continue;
            var r = BoundsOf(h.El);
            if (y < r.Top - gap / 2 || y > r.Bottom + gap / 2) continue;
            string key = h.Popout + (h.Popout == "audio" ? ":" + r.Top : "");
            if (key != _hoverName || _popouts.Active != h.Popout)
            {
                _hoverName = key;
                _popouts.Show(h.Popout, r.Top + r.Height / 2);
            }
            return;
        }
        _hoverName = null;
        _popouts.Leave();
    }

    void OnWheel(object sender, PointerRoutedEventArgs e)
    {
        var p = e.GetCurrentPoint(Root);
        int delta = p.Properties.MouseWheelDelta;
        if (delta == 0) return;
        e.Handled = true;
        double y = p.Position.Y;
        if (_workspaces is not null && _cfg.ScrollWorkspaces && y >= BoundsOf(_workspaces).Top && y <= BoundsOf(_workspaces).Bottom) return; // the pill handles it
        if (y < _h / 2)
        {
            if (!_cfg.ScrollVolume) return;
            Audio.Level = Math.Clamp(Audio.Level + (delta > 0 ? 0.05 : -0.05), 0, 1);
            Audio.Muted = false;
        }
        else if (_cfg.ScrollBrightness) _ = ChangeBrightnessAsync(delta > 0 ? 10 : -10);
    }

    async Task ChangeBrightnessAsync(int step)
    {
        _brightness ??= await SystemControls.GetBrightnessAsync();
        if (_brightness is not int b) return; // no internal panel
        _brightness = Math.Clamp(b + step, 0, 100);
        await SystemControls.SetBrightnessAsync(_brightness.Value);
    }
}
