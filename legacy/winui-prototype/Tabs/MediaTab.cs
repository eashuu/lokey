using System.Numerics;
using Hitodama.Shell.Services;
using Microsoft.UI.Composition;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Hosting;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;

namespace Hitodama.Shell.Tabs;

// Port of Caelestia's Media.qml: round cover inside a radial visualiser, details, controls, seek, player chip.
public sealed class MediaTab : Grid, IPage
{
    const int Bars = 36;
    readonly DispatcherTimer _tick = new() { Interval = TimeSpan.FromMilliseconds(500) };
    readonly DispatcherTimer _frame = new() { Interval = TimeSpan.FromMilliseconds(33) };
    readonly Visualiser _vis = new(Bars / 2); // mirrored left/right like cava
    readonly List<SpriteVisual> _barVisuals = [];
    readonly CompositionColorBrush _barBrush;
    readonly Ellipse _cover = new();
    readonly TextBlock _title = Ui.Text("Nothing playing", 17, "Primary", FontWeights.SemiBold), _artist = Ui.Text("", 13, "Secondary"), _album = Ui.Text("", 11, "Outline");
    readonly TextBlock _pos = Ui.Text("", 11, "OnSurfaceVariant"), _len = Ui.Text("", 11, "OnSurfaceVariant");
    readonly Slider _seek = new() { Minimum = 0, Maximum = 1, StepFrequency = 0.001, IsThumbToolTipEnabled = false };
    readonly Button _play, _player;
    bool _seeking, _shown;

    public MediaTab()
    {
        ColumnSpacing = Tokens.Px(24);
        ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Tokens.Px(230)) });
        ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Tokens.Px(340)) });

        // ---- cover + radial visualiser ----
        double box = Tokens.Px(230), cover = Tokens.Px(150);
        var art = new Grid { Width = box, Height = box };
        var barHost = new Canvas { Width = box, Height = box, IsHitTestVisible = false };
        art.Children.Add(barHost);
        _cover.Width = _cover.Height = cover;
        _cover.Fill = Ui.Brush("SurfaceContainerHighest");
        art.Children.Add(_cover);
        Children.Add(art);

        var comp = ElementCompositionPreview.GetElementVisual(barHost).Compositor;
        _barBrush = comp.CreateColorBrush(Theme.Get("Primary"));
        var container = comp.CreateContainerVisual();
        float c = (float)box / 2, r0 = (float)cover / 2 + (float)Tokens.Px(8), barW = (float)Tokens.Px(4), barMax = (float)Tokens.Px(30);
        for (int i = 0; i < Bars; i++)
        {
            // An "arm" rotated about the cover centre holds one bar that scales outward from its inner end.
            var arm = comp.CreateContainerVisual();
            arm.Size = new Vector2((float)box);
            arm.CenterPoint = new Vector3(c, c, 0);
            arm.RotationAngleInDegrees = 360f * i / Bars;
            var v = comp.CreateSpriteVisual();
            v.Brush = _barBrush;
            v.Size = new Vector2(barW, barMax);
            v.Offset = new Vector3(c - barW / 2, c - r0 - barMax, 0);
            v.CenterPoint = new Vector3(barW / 2, barMax, 0);
            v.Scale = new Vector3(1, 0.08f, 1);
            arm.Children.InsertAtTop(v);
            container.Children.InsertAtTop(arm);
            _barVisuals.Add(v);
        }
        ElementCompositionPreview.SetElementChildVisual(barHost, container);

        // ---- details ----
        _play = Ui.IconButton("play_arrow", 48, Media.PlayPause, filled: true);
        var controls = Ui.Stack(Orientation.Horizontal, 10, Ui.IconButton("skip_previous", 36, Media.Previous), _play, Ui.IconButton("skip_next", 36, Media.Next));
        foreach (UIElement el in controls.Children) ((FrameworkElement)el).VerticalAlignment = VerticalAlignment.Center;
        _seek.AddHandler(PointerPressedEvent, new PointerEventHandler((_, _) => _seeking = true), true);
        _seek.PointerCaptureLost += (_, _) =>
        {
            if (!_seeking) return;
            _seeking = false;
            Media.Seek(Media.Duration * _seek.Value);
        };
        var times = new Grid();
        times.Children.Add(_pos);
        _len.HorizontalAlignment = HorizontalAlignment.Right;
        times.Children.Add(_len);
        _player = new RippleButton { Padding = new Thickness(Tokens.Px(12), Tokens.Px(4), Tokens.Px(12), Tokens.Px(4)), Background = Ui.Brush("SecondaryContainer"), Foreground = Ui.Brush("OnSecondaryContainer"), CornerRadius = new CornerRadius(Tokens.Px(14)), FontSize = Tokens.Font(11) };
        _player.Click += (_, _) => Media.NextSession();
        _title.TextWrapping = TextWrapping.Wrap; _title.MaxLines = 2;
        var details = Ui.Stack(Orientation.Vertical, 6, _title, _artist, _album, controls, _seek, times, _player);
        controls.Margin = new Thickness(0, Tokens.Px(8), 0, 0);
        details.VerticalAlignment = VerticalAlignment.Center;
        Children.Add(details.At(0, 1));

        _tick.Tick += (_, _) => Progress();
        _frame.Tick += (_, _) => Frame();
    }

    public void OnShown()
    {
        _shown = true;
        Media.Changed += OnMedia;
        Theme.Changed += Recolor;
        Recolor();
        OnMedia();
        _tick.Start();
    }

    public void OnHidden()
    {
        _shown = false;
        Media.Changed -= OnMedia;
        Theme.Changed -= Recolor;
        _tick.Stop();
        Visualise(false);
    }

    void Recolor() => _barBrush.Color = Theme.Get("Primary");

    void OnMedia()
    {
        bool has = Media.Title.Length > 0;
        _title.Text = has ? Media.Title : "Nothing playing";
        _artist.Text = Media.Artist;
        _album.Text = Media.Album;
        _cover.Fill = Media.Art is { } a ? new ImageBrush { ImageSource = a, Stretch = Stretch.UniformToFill } : Ui.Brush("SurfaceContainerHighest");
        ((FontIcon)_play.Content).Glyph = Media.Playing ? "pause" : "play_arrow";
        _player.Content = Media.App.Length > 0 ? $"●  {Media.App}" : "No player";
        _seek.IsEnabled = Media.Duration > TimeSpan.Zero;
        Progress();
        Visualise(_shown && Media.Playing && Store.Data.Media.Visualiser);
    }

    void Progress()
    {
        if (_seeking) return;
        var d = Media.Duration;
        _seek.Value = d > TimeSpan.Zero ? Media.Position / d : 0;
        _pos.Text = d > TimeSpan.Zero ? Fmt(Media.Position) : "";
        _len.Text = d > TimeSpan.Zero ? Fmt(d) : "";
    }

    static string Fmt(TimeSpan t) => t.TotalHours >= 1 ? t.ToString(@"h\:mm\:ss") : t.ToString(@"m\:ss");

    void Visualise(bool on)
    {
        if (on) { _vis.Start(); _frame.Start(); return; }
        _frame.Stop();
        _vis.Stop();
        foreach (var v in _barVisuals) Motion.To(v, "Scale", new Vector3(1, 0.08f, 1), Motion.Effects);
    }

    void Frame()
    {
        var levels = _vis.Levels;
        for (int i = 0; i < _barVisuals.Count; i++)
            _barVisuals[i].Scale = new Vector3(1, 0.08f + 0.92f * levels[i < Bars / 2 ? i : Bars - 1 - i], 1);
    }
}
