using System.Diagnostics;
using System.Numerics;
using System.Runtime.InteropServices.WindowsRuntime;
using Hitodama.Shell.Services;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Hosting;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Storage;
using Windows.Storage.FileProperties;
using Variant = MaterialColorUtilities.Palettes.Style;

namespace Hitodama.Shell;

// Caelestia's launcher, rising from the bottom edge: apps from shell:AppsFolder, ">" commands, and a
// wallpaper carousel that previews the colour scheme live. The surface resizes to the result count.
public sealed partial class LauncherWindow : Window
{
    sealed class Item(string name, string desc, string glyph, Action run)
    {
        public string Name { get; } = name;
        public string Desc { get; } = desc;
        public string Glyph { get; } = glyph;
        public Action Run { get; } = run;
        public string? AppId;
        public ImageSource? Icon;
        public bool IconRequested;
    }

    sealed record Command(string Name, string Desc, string Glyph, Action<string> Run, bool TakesArg = false);

    readonly EdgeSurface _s;
    readonly double _rowH, _listL, _wallL, _cardW, _cardH, _gap, _pad;
    readonly DispatcherQueueTimer _dwell, _leave, _preview;
    readonly List<Command> _commands;
    List<Item>? _apps;
    List<Item> _results = [];
    List<string> _walls = [];
    static readonly SolidColorBrush Clear = new(Microsoft.UI.Colors.Transparent);
    readonly Dictionary<string, (StackPanel Col, Border Card)> _wallCards = [];
    int _sel, _scroll;
    bool _open, _byHover, _pointerInside, _wallMode, _applied;

    public EdgeSurface Surface => _s;
    public bool IsOpen => _open;

    public LauncherWindow()
    {
        InitializeComponent();
        _pad = Tokens.Px(14);
        _rowH = Tokens.Px(56);
        _listL = Tokens.Px(620);
        _cardW = Tokens.Px(220);
        _cardH = Tokens.Px(140);
        _gap = Tokens.Px(14);
        _wallL = Math.Min(Tokens.ScreenW * 0.62, Tokens.Px(1000));
        double maxD = Math.Min(Tokens.ScreenH * 0.6, Tokens.Px(640));
        _s = new EdgeSurface(this, Root, SurfaceHost, Panel, Edge.Bottom, Math.Max(_listL, _wallL), maxD);
        _s.Ps.InsertScalar("O", 1);

        Inner.Margin = new Thickness(_pad);
        SearchBox.Height = Tokens.Px(44);
        SearchIcon.Margin = new Thickness(Tokens.Px(16), 0, Tokens.Px(4), 0);
        Search.FontSize = Tokens.Font(13);
        foreach (var k in new[] { "TextControlBackground", "TextControlBackgroundPointerOver", "TextControlBackgroundFocused" })
            Search.Resources[k] = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        Search.Resources["TextControlBorderBrushFocused"] = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        Strip.Spacing = _gap;
        Carousel.Height = _cardH + Tokens.Px(28);

        _commands =
        [
            new("wallpaper", "Change the wallpaper", "wallpaper", a => Open(">wallpaper ")),
            new("variant", "Change the colour scheme variant", "palette", a => Open(">variant ")),
            new("light", "Light colour scheme", "light_mode", _ => SetMode("light")),
            new("dark", "Dark colour scheme", "dark_mode", _ => SetMode("dark")),
            new("auto", "Scheme follows the wallpaper", "brightness_auto", _ => SetMode("auto")),
            new("palette", "Surface palette: neutral, monochrome or tinted", "palette", a => SetPalette(a), true),
            new("transparency", "Surface opacity, e.g. >transparency 0.85", "opacity", a => SetNumber(a, v => Store.Data.Appearance.Transparency = Math.Clamp(v, 0.4, 1), "Appearance"), true),
            new("scale", "UI scale, e.g. >scale 1.1 (restarts)", "zoom_in", a => SetNumber(a, v => Store.Data.Appearance.Scale = Math.Clamp(v, 0.6, 2), "Scale"), true),
            new("timer", "Focus timer in minutes, e.g. >timer 25", "timer", a => { if (double.TryParse(a, out var m) && m > 0) { FocusTimer.SetLength(TimeSpan.FromMinutes(m)); FocusTimer.Start(); App.Island?.Retick(); } }, true),
            new("session", "Power menu", "power_settings_new", _ => App.ShowSession()),
            new("lock", "Lock the computer", "lock", _ => Native.LockWorkStation()),
            new("sleep", "Suspend", "bedtime", _ => Native.SetSuspendState(false, false, false)),
            new("settings", "Hitodama settings", "settings", _ => App.OpenSettings()),
            new("quit", "Quit Hitodama", "close", _ => App.Quit()),
        ];

        _dwell = Timer(Store.Data.Launcher.DwellMs, () => { if (_pointerInside && !_open) Open("", byHover: true); });
        _leave = Timer(400, () => { if (!_pointerInside && _byHover && Search.Text.Length == 0) Dismiss(); });
        _preview = Timer(160, async () => { if (_wallMode && _sel < _walls.Count) await Theme.FromImageAsync(_walls[_sel]); });

        if (Store.Data.Launcher.EdgeTrigger) _s.SetTriggerStrip(Tokens.ScreenW * 0.3, 3);
        Root.PointerEntered += (_, _) => { _pointerInside = true; _leave.Stop(); if (!_open) _dwell.Start(); };
        Root.PointerExited += (_, _) => { _pointerInside = false; _dwell.Stop(); if (_open && _byHover) _leave.Start(); };
        Root.PointerWheelChanged += (_, e) =>
        {
            if (!_open) return;
            Move(e.GetCurrentPoint(Root).Properties.MouseWheelDelta < 0 ? 1 : -1);
            e.Handled = true;
        };
        Activated += (_, e) =>
        {
            if (e.WindowActivationState == WindowActivationState.Deactivated && _open && !_pointerInside) Dismiss();
        };
        Search.TextChanged += (_, _) => Refresh();
        Search.PreviewKeyDown += OnKey;
    }

    // ================= open / close =================

    public void Toggle() { if (_open) Dismiss(); else Open(""); }

    public void Open(string query, bool byHover = false)
    {
        bool was = _open;
        _open = true;
        _byHover = byHover && !was;
        _applied = false;
        Panel.Visibility = Visibility.Visible;
        if (Search.Text != query) { Search.Text = query; Search.SelectionStart = query.Length; }
        else Refresh();
        if (!byHover || was) _s.Focus();
        Search.Focus(FocusState.Programmatic);
    }

    public void Dismiss()
    {
        if (!_open) return;
        _open = false;
        _preview.Stop();
        if (_wallMode && !_applied) _ = Theme.FromCurrentWallpaperAsync(); // undo live preview
        _s.Animate(_listL, Tokens.Px(120), Tokens.Px(28), 1, 0, 0, Motion.Spatial, () =>
        {
            if (!_open) { Panel.Visibility = Visibility.Collapsed; Search.Text = ""; }
        });
        _s.RestoreFocus();
    }

    void Resize()
    {
        double contentH = _wallMode ? Carousel.Height : Math.Max(1, Math.Min(_results.Count, Store.Data.Launcher.MaxItems)) * (_rowH + Tokens.XS);
        if (!_wallMode && _results.Count == 0) contentH = _rowH;
        double l = _wallMode ? _wallL : _listL;
        double d = _pad + contentH + Tokens.Md + SearchBox.Height + _pad;
        Inner.Width = l - 2 * _pad;
        Results.Height = contentH;
        if (_open) _s.Animate(l, d, Tokens.Px(28), 0, 1, 0, Motion.Spatial);
    }

    // ================= results =================

    void Refresh()
    {
        string q = Search.Text;
        bool wall = q.StartsWith(">wallpaper", StringComparison.OrdinalIgnoreCase);
        if (wall != _wallMode)
        {
            _wallMode = wall;
            List.Visibility = wall ? Visibility.Collapsed : Visibility.Visible;
            Carousel.Visibility = wall ? Visibility.Visible : Visibility.Collapsed;
        }
        _sel = 0;
        _scroll = 0;
        if (wall) LoadWallpapers(q[10..].Trim());
        else
        {
            _results = q.StartsWith('>') ? Commands(q[1..]) : Apps(q.Trim());
            RenderList();
        }
        Empty.Visibility = !wall && _results.Count == 0 || wall && _walls.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        Empty.Text = wall ? "No pictures in the wallpaper folder" : "No results";
        Resize();
    }

    List<Item> Commands(string q)
    {
        var parts = q.Split(' ', 2);
        string name = parts[0].Trim().ToLowerInvariant(), arg = parts.Length > 1 ? parts[1].Trim() : "";
        if (name == "variant")
            return Enum.GetValues<Variant>()
                .Where(v => arg.Length == 0 || v.ToString().Contains(arg, StringComparison.OrdinalIgnoreCase))
                .Select(v => new Item(v.ToString(), v.ToString() == Store.Data.Appearance.Variant ? "Current variant" : "Material You variant", "palette",
                    () => { Store.Data.Appearance.Variant = v.ToString(); Store.Save("Appearance"); Dismiss(); }))
                .ToList();
        return _commands
            .Where(c => c.Name.StartsWith(name, StringComparison.OrdinalIgnoreCase) || name.Length == 0)
            .Select(c => new Item(">" + c.Name + (c.TakesArg && arg.Length > 0 ? " " + arg : ""), c.Desc, c.Glyph, () =>
            {
                bool stays = c.Name is "wallpaper" or "variant";
                c.Run(arg);
                if (!stays) Dismiss();
            }))
            .ToList();
    }

    List<Item> Apps(string q)
    {
        _apps ??= LoadApps();
        if (q.Length == 0) return _apps;
        return _apps.Select(a => (a, s: Score(a.Name, q))).Where(x => x.s > 0).OrderByDescending(x => x.s).Select(x => x.a).ToList();
    }

    List<Item> LoadApps()
    {
        var list = new List<Item>();
        try
        {
            dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application")!)!;
            foreach (dynamic it in shell.NameSpace("shell:AppsFolder").Items())
            {
                string name = it.Name, id = it.Path;
                if (string.IsNullOrWhiteSpace(name) || name.Contains("uninstall", StringComparison.OrdinalIgnoreCase)) continue;
                string desc = id.Contains('!') ? "Microsoft Store app" : File.Exists(id) ? Path.GetFileNameWithoutExtension(id) : "Desktop app";
                list.Add(new Item(name, desc, "apps", () =>
                {
                    Process.Start(new ProcessStartInfo("explorer.exe", "shell:AppsFolder\\" + id) { UseShellExecute = true });
                    Dismiss();
                }) { AppId = id });
            }
        }
        catch { }
        return list.DistinctBy(a => a.Name).OrderBy(a => a.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
    }

    // prefix > word-start > substring > in-order letters
    static int Score(string name, string q)
    {
        if (name.StartsWith(q, StringComparison.OrdinalIgnoreCase)) return 4;
        if (name.Split(' ').Any(w => w.StartsWith(q, StringComparison.OrdinalIgnoreCase))) return 3;
        if (name.Contains(q, StringComparison.OrdinalIgnoreCase)) return 2;
        int i = 0;
        foreach (var c in name) if (i < q.Length && char.ToLowerInvariant(c) == char.ToLowerInvariant(q[i])) i++;
        return i == q.Length ? 1 : 0;
    }

    // Only MaxItems rows exist; scrolling moves a window over the results (no virtualization needed).
    void RenderList()
    {
        int max = Store.Data.Launcher.MaxItems;
        while (List.Children.Count < max) List.Children.Add(NewRow());
        for (int i = 0; i < max; i++)
        {
            var row = (Button)List.Children[i];
            int index = _scroll + i;
            if (index >= _results.Count) { row.Visibility = Visibility.Collapsed; continue; }
            row.Visibility = Visibility.Visible;
            var item = _results[index];
            row.Tag = item;
            var g = (Grid)row.Content;
            var iconBox = (Grid)g.Children[0];
            ((FontIcon)iconBox.Children[0]).Glyph = item.Glyph;
            ((Image)iconBox.Children[1]).Source = item.Icon;
            iconBox.Children[0].Visibility = item.AppId is null || item.Icon is null ? Visibility.Visible : Visibility.Collapsed;
            var text = (StackPanel)g.Children[1];
            ((TextBlock)text.Children[0]).Text = item.Name;
            ((TextBlock)text.Children[1]).Text = item.Desc;
            row.Background = index == _sel ? Ui.Brush("SurfaceContainerHigh") : Clear;
            if (item.AppId is not null) RequestIcon(item, row);
        }
    }

    Button NewRow()
    {
        var iconBox = new Grid { Width = Tokens.Px(34), Height = Tokens.Px(34), VerticalAlignment = VerticalAlignment.Center };
        iconBox.Children.Add(Ui.Icon("apps", 16, "Primary"));
        iconBox.Children.Add(new Image());
        var name = Ui.Text("", 13, weight: FontWeights.SemiBold);
        var desc = Ui.Text("", 11, "OnSurfaceVariant");
        var text = Ui.Stack(Orientation.Vertical, 1, name, desc);
        text.VerticalAlignment = VerticalAlignment.Center;
        var g = new Grid { ColumnSpacing = Tokens.Px(14) };
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        g.ColumnDefinitions.Add(new ColumnDefinition());
        g.Children.Add(iconBox);
        g.Children.Add(text.At(0, 1));
        var b = new RippleButton
        {
            Content = g, Height = _rowH, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Padding = new Thickness(Tokens.Px(12), 0, Tokens.Px(12), 0), CornerRadius = App.Res<CornerRadius>("RoundLg"),
        };
        b.Click += (_, _) => (b.Tag as Item)?.Run();
        return b;
    }

    void RequestIcon(Item item, Button row)
    {
        if (item.IconRequested) return;
        item.IconRequested = true;
        DispatcherQueue.TryEnqueue(DispatcherQueuePriority.Low, () =>
        {
            var px = Native.ShellIcon("shell:AppsFolder\\" + item.AppId, 64);
            if (px is null) return;
            var bmp = new WriteableBitmap(64, 64);
            using (var s = bmp.PixelBuffer.AsStream()) s.Write(px);
            bmp.Invalidate();
            item.Icon = bmp;
            if (row.Tag == item) RenderList();
        });
    }

    // ================= wallpaper carousel =================

    static string WallpaperFolder
    {
        get
        {
            if (Store.Data.Launcher.WallpaperFolder is { } f && Directory.Exists(f)) return f;
            var pics = Environment.GetFolderPath(Environment.SpecialFolder.MyPictures);
            var walls = Path.Combine(pics, "Wallpapers");
            return Directory.Exists(walls) ? walls : pics;
        }
    }

    void LoadWallpapers(string filter)
    {
        string[] ext = [".jpg", ".jpeg", ".png", ".bmp", ".webp"];
        bool IsImage(string f) => ext.Contains(Path.GetExtension(f).ToLowerInvariant());
        var files = Directory.EnumerateFiles(WallpaperFolder).Where(IsImage).ToList();
        // Nothing of the user's yet: offer the wallpapers that ship with Windows.
        var builtIn = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Web", "Wallpaper");
        if (files.Count == 0 && Directory.Exists(builtIn)) files = Directory.EnumerateFiles(builtIn, "*", SearchOption.AllDirectories).Where(IsImage).ToList();
        _walls = files
            .Where(f => filter.Length == 0 || Path.GetFileNameWithoutExtension(f).Contains(filter, StringComparison.OrdinalIgnoreCase))
            .OrderBy(f => Path.GetFileName(f), StringComparer.CurrentCultureIgnoreCase)
            .Take(120).ToList();
        Strip.Children.Clear();
        foreach (var path in _walls)
        {
            if (!_wallCards.TryGetValue(path, out var entry))
            {
                var name = Ui.Text(Path.GetFileNameWithoutExtension(path), 11, "OnSurfaceVariant");
                name.HorizontalAlignment = HorizontalAlignment.Center;
                name.MaxWidth = _cardW;
                var card = new Border { Width = _cardW, Height = _cardH, CornerRadius = new CornerRadius(Tokens.Px(16)), Background = Ui.Brush("SurfaceContainerHigh") };
                card.Tapped += (_, _) => { _sel = _walls.IndexOf(path); Apply(); };
                entry = (Ui.Stack(Orientation.Vertical, 6, card, name), card);
                _wallCards[path] = entry;
            }
            Strip.Children.Add(entry.Col);
        }
        int current = _walls.FindIndex(p => string.Equals(p, Native.GetWallpaperPath(), StringComparison.OrdinalIgnoreCase));
        _sel = Math.Max(0, current);
        Center(animate: false);
    }

    void Center(bool animate = true)
    {
        if (_walls.Count == 0) return;
        float x = (float)((_wallL - 2 * _pad) / 2 - _sel * (_cardW + _gap) - _cardW / 2);
        ElementCompositionPreview.SetIsTranslationEnabled(Strip, true);
        var sv = ElementCompositionPreview.GetElementVisual(Strip);
        if (animate) Motion.To(sv, "Translation", new Vector3(x, 0, 0), Motion.Spatial);
        else Motion.FromTo(sv, "Translation", new Vector3(x, 0, 0), new Vector3(x, 0, 0), Motion.Effects);

        for (int i = 0; i < _walls.Count; i++)
        {
            var col = (FrameworkElement)Strip.Children[i];
            bool near = Math.Abs(i - _sel) <= 4;
            if (near) LoadThumb(_walls[i]);
            var v = ElementCompositionPreview.GetElementVisual(col);
            v.CenterPoint = new Vector3((float)_cardW / 2, (float)_cardH / 2, 0);
            float scale = i == _sel ? 1f : 0.82f;
            Motion.To(v, "Scale", new Vector3(scale, scale, 1), Motion.Spatial);
            Motion.To(v, "Opacity", i == _sel ? 1f : 0.6f, Motion.Effects);
        }
        _preview.Stop();
        _preview.Start();
    }

    async void LoadThumb(string path)
    {
        var card = _wallCards[path].Card;
        if (card.Child is not null) return;
        var img = new BitmapImage { DecodePixelWidth = (int)(_cardW * _s.DpiScale) };
        card.Child = new Border { CornerRadius = card.CornerRadius, Background = new ImageBrush { ImageSource = img, Stretch = Stretch.UniformToFill } };
        try
        {
            var file = await StorageFile.GetFileFromPathAsync(path);
            using var thumb = await file.GetThumbnailAsync(ThumbnailMode.SingleItem, (uint)(_cardW * _s.DpiScale));
            await img.SetSourceAsync(thumb);
        }
        catch { }
    }

    void Apply()
    {
        if (_sel >= _walls.Count) return;
        _applied = true;
        Native.SetWallpaper(_walls[_sel]); // WM_SETTINGCHANGE re-themes from the new wallpaper
        Dismiss();
    }

    // ================= keyboard =================

    void Move(int delta)
    {
        if (_wallMode)
        {
            _sel = Math.Clamp(_sel + delta, 0, Math.Max(0, _walls.Count - 1));
            Center();
            return;
        }
        if (_results.Count == 0) return;
        _sel = Math.Clamp(_sel + delta, 0, _results.Count - 1);
        int max = Store.Data.Launcher.MaxItems;
        if (_sel < _scroll) _scroll = _sel;
        if (_sel >= _scroll + max) _scroll = _sel - max + 1;
        RenderList();
    }

    void OnKey(object sender, KeyRoutedEventArgs e)
    {
        switch (e.Key)
        {
            case Windows.System.VirtualKey.Escape: Dismiss(); break;
            case Windows.System.VirtualKey.Down: Move(1); break;
            case Windows.System.VirtualKey.Up: Move(-1); break;
            case Windows.System.VirtualKey.Right when _wallMode: Move(1); break;
            case Windows.System.VirtualKey.Left when _wallMode: Move(-1); break;
            case Windows.System.VirtualKey.Enter:
                if (_wallMode) Apply();
                else if (_sel < _results.Count) _results[_sel].Run();
                break;
            default: return;
        }
        e.Handled = true;
    }

    // ================= helpers =================

    static void SetMode(string mode)
    {
        Store.Data.Appearance.Mode = mode;
        Store.Save("Appearance");
    }

    static void SetPalette(string arg)
    {
        arg = arg.ToLowerInvariant();
        if (arg is not ("neutral" or "monochrome" or "tinted")) return;
        Store.Data.Appearance.Palette = arg;
        Store.Save("Appearance");
    }

    static void SetNumber(string arg, Action<double> set, string section)
    {
        if (!double.TryParse(arg, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var v)) return;
        set(v);
        Store.Save(section);
    }

    DispatcherQueueTimer Timer(int ms, Action action)
    {
        var t = DispatcherQueue.CreateTimer();
        t.Interval = TimeSpan.FromMilliseconds(ms);
        t.IsRepeating = false;
        t.Tick += (_, _) => action();
        return t;
    }
}
