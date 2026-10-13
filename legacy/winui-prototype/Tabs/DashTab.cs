using System.Numerics;
using Hitodama.Shell.Services;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Hosting;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;

namespace Hitodama.Shell.Tabs;

// Port of Caelestia's Dash.qml grid, with the colour roles of dash/*.qml:
//   row 0: weather (cols 0-1) | user (cols 2-4)        | media (col 5, both rows)
//   row 1: date (col 0) | calendar (cols 1-3) | resources (col 4)
// weather icon secondary + temperature primary, avatar primary container, info pills secondary container,
// uptime badge tertiary container, date secondary, calendar weekends tertiary, resources primary/tertiary/secondary,
// media arc + title primary, artist secondary, album outline.
public sealed class DashTab : Grid, IPage
{
    readonly DispatcherTimer _tick = new() { Interval = TimeSpan.FromSeconds(1) };
    readonly FontIcon _wxGlyph = Ui.Icon("cloud", 44, "Secondary");
    readonly TextBlock _wxTemp = Ui.Num("--°", 30, "Primary"), _wxDesc = Ui.Text("Weather", 12, "OnSurfaceVariant");
    readonly TextBlock _uptime = Ui.Text("", 12, "OnTertiaryContainer");
    readonly TextBlock _hh = Ui.Num("", 28, "Secondary"), _mm = Ui.Num("", 28, "Secondary"), _day = Ui.Text("", 12, "OnSurfaceVariant");
    readonly TextBlock _month = Ui.Text("", 12, "OnSurfaceVariant", FontWeights.SemiBold);
    readonly Ellipse _photo = new();
    readonly Grid _days = new();
    readonly List<(Border fill, double h)> _bars = [];
    readonly Ring _progress;
    readonly Ellipse _cover = new();
    readonly TextBlock _title = Ui.Text("Nothing playing", 13, "Primary", FontWeights.SemiBold), _artist = Ui.Text("", 11, "Secondary"), _album = Ui.Text("", 10, "Outline");
    readonly Button _play;
    DateTime _shownMonth = DateTime.Today;

    public DashTab()
    {
        ColumnSpacing = RowSpacing = Tokens.Md;
        double[] cols = [100, 155, 108, 108, 108, 200];
        foreach (var w in cols) ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Tokens.Px(w)) });
        RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        // ---- weather ----
        var wx = Ui.Stack(Orientation.Horizontal, 14, _wxGlyph, Ui.Stack(Orientation.Vertical, 0, _wxTemp, _wxDesc));
        wx.VerticalAlignment = VerticalAlignment.Center;
        _wxGlyph.VerticalAlignment = VerticalAlignment.Center;
        Children.Add(Ui.Card(wx, 42, 18).At(0, 0, colSpan: 2));

        // ---- user: account picture in a primary-container ring, info pills, power ----
        var avatar = new Grid { Width = Tokens.Px(72), Height = Tokens.Px(72), VerticalAlignment = VerticalAlignment.Center };
        avatar.Children.Add(new Ellipse { Fill = Ui.Brush("PrimaryContainer") });
        var initial = Ui.Text(Environment.UserName[..1].ToUpperInvariant(), 26, "OnPrimaryContainer", FontWeights.SemiBold);
        initial.HorizontalAlignment = HorizontalAlignment.Center; initial.VerticalAlignment = VerticalAlignment.Center;
        avatar.Children.Add(initial);
        _photo.Width = _photo.Height = Tokens.Px(62);
        avatar.Children.Add(_photo);
        var info = Ui.Stack(Orientation.Vertical, 5,
            Pill("window", Environment.OSVersion.Version.Build >= 22000 ? "Windows 11" : "Windows 10", "SecondaryContainer", "OnSecondaryContainer"),
            Pill("computer", Environment.MachineName, "SecondaryContainer", "OnSecondaryContainer"),
            Pill("timer", "", "TertiaryContainer", "OnTertiaryContainer", _uptime));
        info.VerticalAlignment = VerticalAlignment.Center;
        var user = Ui.Grid(14, 0);
        user.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        user.ColumnDefinitions.Add(new ColumnDefinition());
        user.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        user.Children.Add(avatar);
        user.Children.Add(info.At(0, 1));
        var power = Ui.IconButton("power_settings_new", 34, () => App.ShowSession());
        power.VerticalAlignment = VerticalAlignment.Top;
        user.Children.Add(power.At(0, 2));
        Children.Add(Ui.Card(user, 28, 14).At(0, 2, colSpan: 3));

        // ---- date / time column ----
        var dots = Ui.Text("• • •", 10, "Primary");
        foreach (var t in new[] { _hh, dots, _mm, _day }) t.HorizontalAlignment = HorizontalAlignment.Center;
        var date = Ui.Stack(Orientation.Vertical, 2, _hh, dots, _mm, _day);
        date.VerticalAlignment = VerticalAlignment.Center;
        Children.Add(Ui.Card(date, 16, 10).At(1, 0));

        // ---- calendar ----
        for (int i = 0; i < 7; i++) _days.ColumnDefinitions.Add(new ColumnDefinition());
        for (int i = 0; i < 7; i++) _days.RowDefinitions.Add(new RowDefinition { Height = new GridLength(Tokens.Px(28)) });
        var cal = Ui.Stack(Orientation.Vertical, 6, _month, _days);
        var calCard = Ui.Card(cal, 28, 14).At(1, 1, colSpan: 3);
        calCard.PointerWheelChanged += (_, e) =>
        {
            _shownMonth = _shownMonth.AddMonths(e.GetCurrentPoint(calCard).Properties.MouseWheelDelta < 0 ? 1 : -1);
            BuildCalendar();
            e.Handled = true;
        };
        Children.Add(calCard);

        // ---- resources: vertical bars (Resources.qml): cpu primary, memory tertiary, storage secondary ----
        var res = new Grid { ColumnSpacing = Tokens.Px(2) };
        string[] resIcons = ["memory", "memory_alt", "hard_disk"], resRoles = ["Primary", "Tertiary", "Secondary"];
        for (int r = 0; r < 3; r++)
        {
            res.ColumnDefinitions.Add(new ColumnDefinition());
            var col = new Grid { RowSpacing = Tokens.Px(6) };
            col.RowDefinitions.Add(new RowDefinition());
            col.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var track = new Grid { Width = Tokens.Px(10), HorizontalAlignment = HorizontalAlignment.Center };
            track.Children.Add(new Border { Background = Ui.Brush("SurfaceContainerHighest"), CornerRadius = new CornerRadius(Tokens.Px(5)) });
            var fill = new Border { Background = Ui.Brush(resRoles[r]), CornerRadius = new CornerRadius(Tokens.Px(5)) };
            track.Children.Add(fill);
            fill.SizeChanged += (_, e) => ElementCompositionPreview.GetElementVisual(fill).CenterPoint = new Vector3(0, (float)e.NewSize.Height, 0);
            _bars.Add((fill, 0));
            col.Children.Add(track);
            var l = Ui.Icon(resIcons[r], 14, resRoles[r]);
            l.HorizontalAlignment = HorizontalAlignment.Center;
            col.Children.Add(l.At(1, 0));
            res.Children.Add(col.At(0, res.ColumnDefinitions.Count - 1));
        }
        Children.Add(Ui.Card(res, 16, 8).At(1, 4));

        // ---- media card (dash/Media.qml) ----
        double coverSize = 112;
        var coverHost = new Grid { Width = Tokens.Px(coverSize + 18), Height = Tokens.Px(coverSize + 18), HorizontalAlignment = HorizontalAlignment.Center };
        _progress = new Ring(Tokens.Px(coverSize + 18), Tokens.Px(4), 180); // Caelestia: a 180 degree arc over the cover
        _cover.Width = _cover.Height = Tokens.Px(coverSize);
        _cover.Fill = Ui.Brush("SurfaceContainerHighest");
        coverHost.Children.Add(_progress);
        coverHost.Children.Add(_cover);
        _title.HorizontalAlignment = _artist.HorizontalAlignment = _album.HorizontalAlignment = HorizontalAlignment.Center;
        _title.TextAlignment = TextAlignment.Center;
        _title.MaxWidth = _artist.MaxWidth = _album.MaxWidth = Tokens.Px(170);
        _play = Ui.IconButton("play_arrow", 40, Media.PlayPause, filled: true);
        var controls = Ui.Stack(Orientation.Horizontal, 6, Ui.IconButton("skip_previous", 32, Media.Previous), _play, Ui.IconButton("skip_next", 32, Media.Next));
        controls.HorizontalAlignment = HorizontalAlignment.Center;
        foreach (UIElement c in controls.Children) ((FrameworkElement)c).VerticalAlignment = VerticalAlignment.Center;
        var media = Ui.Stack(Orientation.Vertical, 8, coverHost, Ui.Stack(Orientation.Vertical, 1, _title, _artist, _album), controls);
        media.VerticalAlignment = VerticalAlignment.Center;
        Children.Add(Ui.Card(media, 56, 14).At(0, 5, rowSpan: 2));

        _tick.Tick += (_, _) => Tick();
        BuildCalendar();
        Tick();
    }

    // Info pill (User.qml): a rounded chip in a container role with matching icon and text.
    static Border Pill(string glyph, string text, string bg, string fg, TextBlock? target = null)
    {
        var t = target ?? Ui.Text(text, 12, fg);
        if (target is null) t.Text = text;
        var icon = Ui.Icon(glyph, 13, fg);
        icon.VerticalAlignment = VerticalAlignment.Center;
        return new Border
        {
            Background = Ui.Brush(bg), CornerRadius = new CornerRadius(Tokens.Px(14)), HorizontalAlignment = HorizontalAlignment.Left,
            Padding = new Thickness(Tokens.Px(10), Tokens.Px(4), Tokens.Px(12), Tokens.Px(4)),
            Child = Ui.Stack(Orientation.Horizontal, 8, icon, t),
        };
    }

    public async void OnShown()
    {
        Media.Changed += OnMedia;
        OnMedia();
        Stats.Cpu();
        Tick();
        _tick.Start();
        if (_photo.Fill is null && await Avatar.LoadAsync() is { } pic) _photo.Fill = new ImageBrush { ImageSource = pic, Stretch = Stretch.UniformToFill };
        if (_shownMonth.Month != DateTime.Today.Month) { _shownMonth = DateTime.Today; BuildCalendar(); }
        await Weather.RefreshAsync();
        if (!Weather.Ready) { _wxDesc.Text = "Weather unavailable"; return; }
        var (glyph, text) = Weather.Describe(Weather.Code);
        _wxGlyph.Glyph = glyph;
        _wxTemp.Text = $"{Weather.Temp:0}°C";
        _wxDesc.Text = Weather.City.Length > 0 ? $"{text} · {Weather.City}" : text;
    }

    public void OnHidden()
    {
        _tick.Stop();
        Media.Changed -= OnMedia;
    }

    void Tick()
    {
        var now = DateTime.Now;
        _hh.Text = now.ToString("HH");
        _mm.Text = now.ToString("mm");
        _day.Text = now.ToString("ddd, d");
        _uptime.Text = "up " + Ui.Uptime(Stats.Uptime);

        if (!_tick.IsEnabled) return;
        var (mu, mt) = Stats.MemoryGb();
        var (du, dt) = Stats.DiskGb();
        double[] v = [Stats.Cpu(), mu / mt, dt > 0 ? du / dt : 0];
        for (int i = 0; i < _bars.Count; i++)
            Motion.To(ElementCompositionPreview.GetElementVisual(_bars[i].fill), "Scale", new Vector3(1, (float)Math.Clamp(v[i], 0.02, 1), 1), Motion.Spatial);
        if (Media.Duration > TimeSpan.Zero) _progress.SetValue(Media.Position / Media.Duration);
    }

    void OnMedia()
    {
        bool has = Media.Title.Length > 0;
        _title.Text = has ? Media.Title : "Nothing playing";
        _artist.Text = Media.Artist;
        _album.Text = Media.Album;
        _cover.Fill = Media.Art is { } art ? new ImageBrush { ImageSource = art, Stretch = Stretch.UniformToFill } : Ui.Brush("SurfaceContainerHighest");
        ((FontIcon)_play.Content).Glyph = Media.Playing ? "pause" : "play_arrow";
        if (Media.Duration == TimeSpan.Zero) _progress.SetValue(0);
    }

    void BuildCalendar()
    {
        _month.Text = _shownMonth.ToString("MMMM yyyy");
        Ui.FillMonth(_days, _shownMonth);
    }
}
