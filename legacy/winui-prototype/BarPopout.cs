using Hitodama.Shell.Services;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Hosting;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Devices.Radios;
using Windows.Foundation;
using Windows.Graphics;

namespace Hitodama.Shell;

// Caelestia's bar popouts (popouts/): one transparent window hosting an EdgeSurface that sits against the bar at
// the hovered entry. Pages are built once. Showing another page glides the surface along the bar, resizes it with
// the spatial curve and crossfades the content.
public sealed class BarPopout : Window
{
    readonly EdgeSurface _s;
    readonly Grid _root = new() { Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent) }, _panel = new();
    readonly Dictionary<string, FrameworkElement> _pages = [];
    readonly DispatcherQueueTimer _closeTimer;
    readonly double _maxL, _maxD, _yOffset, _screenH, _pad;
    readonly HorizontalAlignment _side;
    string? _current;
    bool _inside, _barHover, _syncing;
    double _curL, _curD;
    Radio? _wifiRadio, _btRadio;

    // page widgets that refresh while the popout is open
    readonly Slider _volume = new() { Minimum = 0, Maximum = 100, StepFrequency = 1, IsThumbToolTipEnabled = false };
    FontIcon _muteIcon = null!;
    readonly TextBlock _volumeValue = Ui.Num("", 18, "Primary"), _device = Ui.Text("", 12, "OnSurfaceVariant");
    readonly TextBlock _netName = Ui.Text("", 14, weight: FontWeights.SemiBold), _netState = Ui.Text("", 12, "OnSurfaceVariant");
    readonly FontIcon _netIcon = Ui.Icon("wifi", 26, "Secondary");
    readonly ToggleSwitch _wifi = new() { OnContent = "", OffContent = "", MinWidth = 0, IsEnabled = false };
    readonly TextBlock _btState = Ui.Text("", 12, "OnSurfaceVariant");
    readonly ToggleSwitch _bt = new() { OnContent = "", OffContent = "", MinWidth = 0, IsEnabled = false };
    readonly TextBlock _batPercent = Ui.Num("", 34, "Primary"), _batState = Ui.Text("", 13, weight: FontWeights.SemiBold), _batLeft = Ui.Text("", 12, "OnSurfaceVariant");
    readonly Border _batFill = new() { HorizontalAlignment = HorizontalAlignment.Left };
    readonly double _batW;
    readonly Image _winIcon = new();
    readonly TextBlock _winApp = Ui.Text("", 14, "Primary", FontWeights.SemiBold), _winTitle = Ui.Text("", 12, "OnSurfaceVariant");
    readonly TextBlock _calMonth = Ui.Text("", 14, "Primary", FontWeights.SemiBold), _calDay = Ui.Text("", 12, "OnSurfaceVariant");
    readonly Grid _days = new();

    public EdgeSurface Surface => _s;
    public IntPtr Hwnd => _s.Hwnd;
    public string? Active => _current;
    public FrameworkElement? CurrentPage => _current is null ? null : _pages[_current];
    public bool IsOpen => _current is not null;
    public double LastCenter { get; private set; }

    /// <param name="area">Physical-px rectangle next to the bar (full monitor height) the popouts live in.</param>
    /// <param name="yOffset">DIP from the monitor top to the bar window top, to turn bar y into popout y.</param>
    public BarPopout(Edge edge, RectInt32 area, double yOffset)
    {
        Content = _root;
        _pad = Tokens.Px(16);
        _maxL = Tokens.Px(320);
        _maxD = Tokens.Px(300);
        _yOffset = yOffset;
        _screenH = area.Height / (Native.PrimaryDpi() / 96.0);
        _side = edge == Edge.Left ? HorizontalAlignment.Left : HorizontalAlignment.Right;
        _batW = Tokens.Px(190);
        _root.Children.Add(new Canvas());
        _root.Children.Add(_panel);
        _s = new EdgeSurface(this, _root, (Canvas)_root.Children[0], _panel, edge, _maxL, _maxD, area, alongSize: _screenH);
        _s.Ps.InsertScalar("O", 1);

        BuildPages();
        _panel.Visibility = Visibility.Collapsed;

        _closeTimer = DispatcherQueue.CreateTimer();
        _closeTimer.Interval = TimeSpan.FromMilliseconds(260);
        _closeTimer.IsRepeating = false;
        _closeTimer.Tick += (_, _) => { if (!_inside && !_barHover) Hide(); };
        _root.PointerEntered += (_, _) => { _inside = true; _closeTimer.Stop(); };
        _root.PointerExited += (_, _) => { _inside = false; Leave(); };

        Audio.Changed += OnAudio;
        Status.Changed += OnStatus;
        Foreground.ActiveChanged += OnActive;
        Closed += (_, _) => { Audio.Changed -= OnAudio; Status.Changed -= OnStatus; Foreground.ActiveChanged -= OnActive; };
    }

    // ================= pages =================

    FrameworkElement Page(string name, UIElement content, double width)
    {
        var g = new Grid
        {
            Width = Tokens.Px(width), Padding = new Thickness(_pad), HorizontalAlignment = _side,
            VerticalAlignment = VerticalAlignment.Center, Visibility = Visibility.Collapsed,
        };
        g.Children.Add(content);
        ElementCompositionPreview.SetIsTranslationEnabled(g, true);
        _panel.Children.Add(g);
        return _pages[name] = g;
    }

    static TextBlock Caption(string text) => new()
    {
        Text = text.ToUpperInvariant(), Style = App.Res<Style>("Label"),
    };

    void BuildPages()
    {
        // ---- audio: volume slider, mute, output device ----
        var mute = Ui.IconButton("volume_up", 36, () => { Audio.Muted = !Audio.Muted; });
        _muteIcon = (FontIcon)mute.Content;
        _volume.ValueChanged += (_, e) => { if (!_syncing) { Audio.Level = e.NewValue / 100; Audio.Muted = false; } };
        _volume.VerticalAlignment = VerticalAlignment.Center;
        var head = new Grid();
        head.Children.Add(Caption("Volume"));
        _volumeValue.HorizontalAlignment = HorizontalAlignment.Right;
        head.Children.Add(_volumeValue);
        var row = Ui.Grid(8, 0);
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition());
        row.Children.Add(mute);
        row.Children.Add(_volume.At(0, 1));
        var dev = Ui.Stack(Orientation.Horizontal, 8, Ui.Icon("speaker", 14, "Secondary"), _device);
        _device.MaxWidth = Tokens.Px(220);
        Page("audio", Ui.Stack(Orientation.Vertical, 10, head, row, dev), 280);

        // ---- network ----
        var netRow = Ui.Stack(Orientation.Horizontal, 12, _netIcon, Ui.Stack(Orientation.Vertical, 0, _netName, _netState));
        _netName.MaxWidth = Tokens.Px(200);
        var wifiRow = new Grid();
        wifiRow.Children.Add(Ui.Text("Wi-Fi", 13));
        _wifi.HorizontalAlignment = HorizontalAlignment.Right;
        wifiRow.Children.Add(_wifi);
        _wifi.Toggled += async (_, _) =>
        {
            if (_syncing || _wifiRadio is null) return;
            await _wifiRadio.SetStateAsync(_wifi.IsOn ? RadioState.On : RadioState.Off);
        };
        Page("network", Ui.Stack(Orientation.Vertical, 10, Caption("Network"), netRow, wifiRow), 270);

        // ---- bluetooth ----
        var btRow = new Grid();
        btRow.Children.Add(Ui.Stack(Orientation.Horizontal, 10, Ui.Icon("bluetooth", 22, "Secondary"), Ui.Stack(Orientation.Vertical, 0, Ui.Text("Bluetooth", 14, weight: FontWeights.SemiBold), _btState)));
        _bt.HorizontalAlignment = HorizontalAlignment.Right;
        btRow.Children.Add(_bt);
        _bt.Toggled += async (_, _) =>
        {
            if (_syncing || _btRadio is null) return;
            await _btRadio.SetStateAsync(_bt.IsOn ? RadioState.On : RadioState.Off);
        };
        Page("bluetooth", Ui.Stack(Orientation.Vertical, 10, Caption("Bluetooth"), btRow), 270);

        // ---- battery ----
        var track = new Grid { Height = Tokens.Px(8), Width = _batW, HorizontalAlignment = HorizontalAlignment.Left };
        track.Children.Add(new Border { Background = Ui.Brush("SurfaceContainerHighest"), CornerRadius = new CornerRadius(Tokens.Px(4)) });
        _batFill.CornerRadius = new CornerRadius(Tokens.Px(4));
        _batFill.Background = Ui.Brush("Primary");
        track.Children.Add(_batFill);
        Page("battery", Ui.Stack(Orientation.Vertical, 6, Caption("Battery"), _batPercent, _batState, _batLeft, track), 230);

        // ---- active window ----
        _winIcon.Width = _winIcon.Height = Tokens.Px(28);
        _winTitle.TextWrapping = TextWrapping.Wrap;
        _winTitle.MaxLines = 3;
        var winHead = Ui.Stack(Orientation.Horizontal, 12, _winIcon, _winApp);
        _winApp.VerticalAlignment = VerticalAlignment.Center;
        _winApp.MaxWidth = Tokens.Px(200);
        Page("activewindow", Ui.Stack(Orientation.Vertical, 8, Caption("Active window"), winHead, _winTitle), 280);

        // ---- clock: small calendar ----
        for (int i = 0; i < 7; i++) _days.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Tokens.Px(30)) });
        for (int i = 0; i < 7; i++) _days.RowDefinitions.Add(new RowDefinition { Height = new GridLength(Tokens.Px(26)) });
        var calHead = new Grid();
        calHead.Children.Add(_calMonth);
        _calDay.HorizontalAlignment = HorizontalAlignment.Right;
        calHead.Children.Add(_calDay);
        Page("clock", Ui.Stack(Orientation.Vertical, 8, calHead, _days), 7 * 30 + 32);
    }

    // ================= refresh =================

    void Refresh(string name)
    {
        switch (name)
        {
            case "audio":
                _syncing = true;
                double level = Audio.Muted ? 0 : Audio.Level;
                _volume.Value = level * 100;
                _volumeValue.Text = Audio.Muted ? "Muted" : $"{Math.Round(level * 100)}";
                _muteIcon.Glyph = Audio.Muted || level <= 0 ? "volume_off" : "volume_up";
                _device.Text = Audio.DeviceName;
                _syncing = false;
                break;
            case "network":
                _netIcon.Glyph = !Status.Online ? "signal_wifi_off" : Status.Wifi ? "wifi" : "lan";
                _netName.Text = Status.NetName;
                _netState.Text = Status.Online ? (Status.Wifi ? "Wi-Fi connected" : "Connected") : "No internet";
                _ = LoadRadioAsync(RadioKind.WiFi);
                break;
            case "bluetooth":
                _ = LoadRadioAsync(RadioKind.Bluetooth);
                break;
            case "battery":
                _batPercent.Text = $"{Status.Percent}%";
                _batState.Text = !Status.HasBattery ? "No battery" : Status.Charging ? "Charging" : Status.Percent >= 99 ? "Fully charged" : "On battery";
                _batLeft.Text = Status.TimeLeft is { } t ? $"{(int)t.TotalHours} h {t.Minutes} min {(Status.Charging ? "until full" : "left")}" : "";
                _batLeft.Visibility = _batLeft.Text.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
                _batFill.Width = _batW * Math.Clamp(Status.Percent / 100.0, 0.02, 1);
                _batFill.Background = Ui.Brush(Status.Percent <= 15 && !Status.Charging ? "Error" : "Primary");
                break;
            case "activewindow":
                _winApp.Text = Foreground.App.Length > 0 ? Foreground.App : "No active window";
                _winTitle.Text = Foreground.Title;
                _winIcon.Source = Foreground.Icon(Foreground.Exe, (int)Math.Round(Tokens.Px(28) * _s.DpiScale));
                _winIcon.Visibility = _winIcon.Source is null ? Visibility.Collapsed : Visibility.Visible;
                break;
            case "clock":
                var now = DateTime.Now;
                _calMonth.Text = now.ToString("MMMM yyyy");
                _calDay.Text = now.ToString("dddd, d");
                Ui.FillMonth(_days, now, 22);
                break;
        }
    }

    async Task LoadRadioAsync(RadioKind kind)
    {
        var radio = kind == RadioKind.WiFi ? _wifiRadio ??= await SystemControls.GetRadioAsync(kind) : _btRadio ??= await SystemControls.GetRadioAsync(kind);
        var toggle = kind == RadioKind.WiFi ? _wifi : _bt;
        _syncing = true;
        toggle.IsEnabled = radio is not null;
        toggle.IsOn = radio?.State == RadioState.On;
        if (kind == RadioKind.Bluetooth) _btState.Text = radio is null ? "No adapter" : toggle.IsOn ? "On" : "Off";
        _syncing = false;
    }

    void OnAudio(double level, bool muted) { if (_current == "audio") Refresh("audio"); }
    void OnStatus() { if (_current is "network" or "battery" or "bluetooth") Refresh(_current); }
    void OnActive() { if (_current == "activewindow") Refresh("activewindow"); }

    // ================= show / hide =================

    /// <summary>Open (or move to) a page, centred on <paramref name="barCenter"/> (DIP in the bar window).</summary>
    public void Show(string name, double barCenter)
    {
        if (!_pages.TryGetValue(name, out var page)) { Leave(); return; }
        _closeTimer.Stop();
        Refresh(name);
        page.Visibility = Visibility.Visible; // a collapsed element measures to nothing
        page.Measure(new Size(_maxD, _maxL));
        double w = Math.Min(page.DesiredSize.Width, _maxD), h = Math.Min(page.DesiredSize.Height, _maxL);
        double m = Tokens.Px(8), cx = Math.Clamp(barCenter + _yOffset, h / 2 + m, Math.Max(h / 2 + m, _screenH - h / 2 - m));

        bool first = _current is null;
        var old = first || _current == name ? null : _pages[_current!];
        string? oldName = _current;
        _current = name;
        _panel.Visibility = Visibility.Visible;
        var pv = ElementCompositionPreview.GetElementVisual(page);
        if (first)
        {
            pv.StopAnimation("Opacity");
            pv.Opacity = 1;
            _s.JumpAlong(cx);
            foreach (var p in _pages.Values) if (p != page) p.Visibility = Visibility.Collapsed;
        }
        else if (old is not null)
        {
            Motion.FromTo(pv, "Opacity", 0f, 1f, Motion.SlowEffects);
            var ov = ElementCompositionPreview.GetElementVisual(old);
            Motion.Batch(_s.Compositor, () => Motion.To(ov, "Opacity", 0f, Motion.Effects), () =>
            {
                if (_current != oldName) old.Visibility = Visibility.Collapsed;
            });
        }
        _curL = h; _curD = w; LastCenter = cx;
        _s.Animate(h, w, Tokens.Px(22), 0, 1, Tokens.Px(12), Motion.Spatial, null, cx);
        DispatcherQueue.TryEnqueue(() => Native.BringToTop(_s.Hwnd)); // above the bar window
    }

    /// <summary>The bar pointer left every hover target (or the bar): close shortly unless the popout is hovered.</summary>
    public void Leave() => _closeTimer.Start();

    public void SetBarHover(bool hover)
    {
        _barHover = hover;
        if (hover) _closeTimer.Stop(); else Leave();
    }

    public void Hide()
    {
        if (_current is null) return;
        _current = null;
        _s.Animate(_curL, _curD, Tokens.Px(22), 1, 0, 0, Motion.Spatial, () =>
        {
            if (_current is null) _panel.Visibility = Visibility.Collapsed;
        });
    }
}
