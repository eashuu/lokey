using System.Diagnostics;
using Hitodama.Shell.Services;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.Devices.Radios;

namespace Hitodama.Shell;

// Right edge: Caelestia's OSD (vertical volume / mic / brightness pills + quick toggles) and the
// session menu with a screen dim. Opens from a thin edge strip, a volume change, or a hotkey.
public sealed partial class SideWindow : Window
{
    enum Mode { Closed, Osd, Session }

    readonly EdgeSurface _s;
    readonly double _pad;
    readonly FilledSlider _volume, _mic, _brightness;
    readonly List<(Button b, Func<bool?> state)> _toggles = [];
    readonly DispatcherQueueTimer _autoClose, _dwell, _disarm;
    readonly List<(Button b, TextBlock caption, string label)> _session = [];
    Radio? _wifi, _bt;
    DimWindow? _dim;
    Mode _mode = Mode.Closed;
    bool _pointerInside, _keepOpen, _syncing;
    Button? _armed;

    public EdgeSurface Surface => _s;

    public SideWindow()
    {
        InitializeComponent();
        _pad = Tokens.Px(14);
        double maxL = Math.Min(Tokens.ScreenH * 0.7, Tokens.Px(640)), maxD = Tokens.Px(180);
        _s = new EdgeSurface(this, Root, SurfaceHost, Panel, Edge.Right, maxL, maxD);
        Osd.Margin = Session.Margin = new Thickness(_pad);
        Osd.Spacing = Tokens.Px(14);
        Session.Spacing = Tokens.Px(10);

        // ---- OSD sliders ----
        double sw = Tokens.Px(42), sh = Tokens.Px(190);
        _volume = new FilledSlider("volume_up", sw, sh);
        _volume.ValueChanged += v => { if (!_syncing) { Audio.Level = v; Audio.Muted = false; } };
        _mic = new FilledSlider("mic", sw, sh);
        _mic.ValueChanged += v => { if (!_syncing) Audio.MicLevel = v; };
        _brightness = new FilledSlider("brightness_medium", sw, sh) { Visibility = Visibility.Collapsed };
        _brightness.ValueChanged += v => { if (!_syncing) _ = SystemControls.SetBrightnessAsync((int)(v * 100)); };
        var sliders = Ui.Stack(Orientation.Horizontal, 10, _volume, _mic, _brightness);
        sliders.HorizontalAlignment = HorizontalAlignment.Center;
        Osd.Children.Add(sliders);

        // ---- quick toggles (2x2) ----
        var grid = new Grid { RowSpacing = Tokens.Px(8), ColumnSpacing = Tokens.Px(8), HorizontalAlignment = HorizontalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition()); grid.ColumnDefinitions.Add(new ColumnDefinition());
        grid.RowDefinitions.Add(new RowDefinition()); grid.RowDefinitions.Add(new RowDefinition());
        AddToggle(grid, 0, 0, "wifi", "Wi-Fi", () => _wifi is null ? null : _wifi.State == RadioState.On, async () => await Flip(_wifi));
        AddToggle(grid, 0, 1, "bluetooth", "Bluetooth", () => _bt is null ? null : _bt.State == RadioState.On, async () => await Flip(_bt));
        AddToggle(grid, 1, 0, "mic", "Microphone", () => Audio.MicAvailable ? !Audio.MicMuted : null, () => { Audio.MicMuted = !Audio.MicMuted; return Task.CompletedTask; });
        AddToggle(grid, 1, 1, "coffee", "Keep awake", () => SystemControls.KeepAwake, () => { SystemControls.SetKeepAwake(!SystemControls.KeepAwake); return Task.CompletedTask; });
        Osd.Children.Add(grid);

        // ---- session (Caelestia session menu); destructive actions need a second click ----
        AddSession("lock", "Lock", false, () => Native.LockWorkStation());
        AddSession("bedtime", "Sleep", false, () => Native.SetSuspendState(false, false, false));
        AddSession("logout", "Sign out", true, () => Native.ExitWindowsEx(0, 0));
        AddSession("downloading", "Hibernate", true, () => Native.SetSuspendState(true, false, false));
        AddSession("cached", "Restart", true, () => Shutdown("/r"));
        AddSession("power_settings_new", "Shut down", true, () => Shutdown("/s"));

        _autoClose = Timer(1600, () => { if (_mode == Mode.Osd && !_pointerInside && !_keepOpen) Dismiss(); });
        _dwell = Timer(Store.Data.Side.DwellMs, () => { if (_pointerInside && _mode == Mode.Closed) ShowOsd(keepOpen: true); });
        _disarm = Timer(3000, Disarm);

        if (Store.Data.Side.EdgeTrigger) _s.SetTriggerStrip(Tokens.ScreenH * 0.35, 2);
        Root.PointerEntered += (_, _) => { _pointerInside = true; _autoClose.Stop(); if (_mode == Mode.Closed) _dwell.Start(); };
        Root.PointerExited += (_, _) =>
        {
            _pointerInside = false;
            _dwell.Stop();
            if (_mode == Mode.Osd) { _keepOpen = false; _autoClose.Interval = TimeSpan.FromMilliseconds(400); _autoClose.Start(); }
        };
        Root.KeyDown += (_, e) => { if (e.Key == Windows.System.VirtualKey.Escape) Dismiss(); };
        Activated += (_, e) =>
        {
            if (e.WindowActivationState == WindowActivationState.Deactivated && _mode == Mode.Session && _dim is null) Dismiss();
        };
        Audio.Changed += OnAudio;
        Closed += (_, _) => { Audio.Changed -= OnAudio; _dim?.Close(); };
    }

    void OnAudio(double level, bool muted) { if (_mode == Mode.Osd) Sync(); }

    // ================= open / close =================

    public async void ShowOsd(bool keepOpen = false)
    {
        if (_mode == Mode.Session) return;
        bool was = _mode == Mode.Osd;
        _mode = Mode.Osd;
        _keepOpen |= keepOpen;
        Osd.Visibility = Visibility.Visible;
        Session.Visibility = Visibility.Collapsed;
        Panel.Visibility = Visibility.Visible;
        Sync();
        Show(Osd);
        _autoClose.Interval = TimeSpan.FromMilliseconds(1600);
        _autoClose.Stop();
        _autoClose.Start();
        if (was) return;

        _wifi ??= await SystemControls.GetRadioAsync(RadioKind.WiFi);
        _bt ??= await SystemControls.GetRadioAsync(RadioKind.Bluetooth);
        var b = await SystemControls.GetBrightnessAsync();
        _brightness.Visibility = b is null ? Visibility.Collapsed : Visibility.Visible;
        if (b is int v) { _syncing = true; _brightness.Value = v / 100.0; _syncing = false; }
        SyncToggles();
        if (_mode == Mode.Osd) Show(Osd); // brightness may have changed the width
    }

    public void ShowSession()
    {
        _mode = Mode.Session;
        Disarm();
        Osd.Visibility = Visibility.Collapsed;
        Session.Visibility = Visibility.Visible;
        Panel.Visibility = Visibility.Visible;
        if (Store.Data.Side.Dim && _dim is null)
        {
            _dim = new DimWindow();
            _dim.Clicked += Dismiss;
            _dim.Activate();
        }
        Show(Session);
        _s.Focus();
        DispatcherQueue.TryEnqueue(() => Native.BringToTop(_s.Hwnd)); // above the dim
    }

    public void Dismiss()
    {
        if (_mode == Mode.Closed) return;
        _mode = Mode.Closed;
        _keepOpen = false;
        Disarm();
        _dim?.FadeOut();
        _dim = null;
        _s.Animate(Tokens.Px(200), Tokens.Px(60), Tokens.Px(28), 1, 0, 0, Motion.Spatial, () =>
        {
            if (_mode == Mode.Closed) Panel.Visibility = Visibility.Collapsed;
        });
        _s.RestoreFocus();
    }

    void Show(FrameworkElement content)
    {
        content.Measure(new Windows.Foundation.Size(double.PositiveInfinity, double.PositiveInfinity));
        double l = content.DesiredSize.Height, d = content.DesiredSize.Width;
        _s.Animate(Math.Min(l, _s.MaxL), Math.Min(d, _s.MaxD), Tokens.Px(28), 0, 1, Tokens.Px(14), Motion.Spatial);
    }

    // ================= content =================

    void Sync()
    {
        _syncing = true;
        _volume.Value = Audio.Muted ? 0 : Audio.Level;
        _volume.Glyph = Audio.Muted ? "volume_off" : "volume_up";
        _mic.Visibility = Audio.MicAvailable ? Visibility.Visible : Visibility.Collapsed;
        _mic.Value = Audio.MicLevel;
        _syncing = false;
    }

    void AddToggle(Grid grid, int row, int col, string glyph, string tip, Func<bool?> state, Func<Task> flip)
    {
        var b = Ui.IconButton(glyph, 44, () => { });
        b.Click += async (_, _) => { await flip(); SyncToggles(); };
        ToolTipService.SetToolTip(b, tip);
        grid.Children.Add(b.At(row, col));
        _toggles.Add((b, state));
    }

    void SyncToggles()
    {
        foreach (var (b, state) in _toggles)
        {
            var on = state();
            b.IsEnabled = on is not null;
            b.Background = on == true ? Ui.Brush("PrimaryContainer") : Ui.Brush("SurfaceContainerHigh");
            ((FontIcon)b.Content).Foreground = Ui.Brush(on == true ? "OnPrimaryContainer" : "OnSurface");
        }
    }

    static async Task Flip(Radio? r)
    {
        if (r is not null) await r.SetStateAsync(r.State == RadioState.On ? RadioState.Off : RadioState.On);
    }

    void AddSession(string glyph, string label, bool confirm, Action action)
    {
        var b = Ui.IconButton(glyph, 62, () => { });
        b.Background = Ui.Brush("SurfaceContainerHigh");
        b.CornerRadius = new CornerRadius(Tokens.Px(20));
        var caption = Ui.Text(label, 10, "OnSurfaceVariant");
        caption.HorizontalAlignment = HorizontalAlignment.Center;
        b.Click += (_, _) =>
        {
            if (confirm && _armed != b)
            {
                Disarm();
                _armed = b;
                b.Background = Ui.Brush("Error");
                ((FontIcon)b.Content).Foreground = Ui.Brush("OnError");
                caption.Text = "Again?";
                _disarm.Start();
                return;
            }
            Dismiss();
            action();
        };
        Session.Children.Add(Ui.Stack(Orientation.Vertical, 3, b, caption));
        _session.Add((b, caption, label));
    }

    void Disarm()
    {
        _disarm.Stop();
        _armed = null;
        foreach (var (b, caption, label) in _session)
        {
            b.Background = Ui.Brush("SurfaceContainerHigh");
            ((FontIcon)b.Content).Foreground = Ui.Brush("OnSurface");
            caption.Text = label;
        }
    }

    static void Shutdown(string flag) =>
        Process.Start(new ProcessStartInfo("shutdown.exe", $"{flag} /t 0") { CreateNoWindow = true, UseShellExecute = false });

    DispatcherQueueTimer Timer(int ms, Action action)
    {
        var t = DispatcherQueue.CreateTimer();
        t.Interval = TimeSpan.FromMilliseconds(ms);
        t.IsRepeating = false;
        t.Tick += (_, _) => action();
        return t;
    }
}
