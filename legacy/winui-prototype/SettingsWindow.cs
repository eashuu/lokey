using Hitodama.Shell.Services;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.Graphics;
using Windows.Storage.Pickers;
using Variant = MaterialColorUtilities.Palettes.Style;

namespace Hitodama.Shell;

// Every option in one scrolling page. Rows are generated from small helpers; each change saves
// (debounced) and raises Store.Changed for its section, which rebuilds only what it affects.
public sealed class SettingsWindow : Window
{
    readonly StackPanel _body = new() { Spacing = 6, Padding = new Thickness(28, 20, 28, 28), MaxWidth = 760 };
    readonly DispatcherQueueTimer _save;
    readonly HashSet<string> _dirty = [];

    public SettingsWindow()
    {
        Title = "Hitodama settings";
        SystemBackdrop = new MicaBackdrop();
        ExtendsContentIntoTitleBar = false;
        AppWindow.Resize(new SizeInt32((int)(760 * Native.PrimaryDpi() / 96.0), (int)(820 * Native.PrimaryDpi() / 96.0)));
        Content = new ScrollViewer { Content = _body, FontFamily = App.Res<FontFamily>("Sans") };
        ((FrameworkElement)Content).RequestedTheme = Theme.IsDark ? ElementTheme.Dark : ElementTheme.Light;

        _save = DispatcherQueue.CreateTimer();
        _save.Interval = TimeSpan.FromMilliseconds(400);
        _save.IsRepeating = false;
        _save.Tick += (_, _) =>
        {
            var sections = _dirty.ToArray();
            _dirty.Clear();
            Store.Save();
            foreach (var s in sections) Store.Save(s);
        };

        var d = Store.Data;
        Title_("Hitodama", "Caelestia-style shell for Windows. Changes apply immediately.");

        Section("Surfaces");
        Toggle("Top island (dashboard)", d.General.Island, v => d.General.Island = v, "General");
        Toggle("Bottom launcher drawer", d.General.Launcher, v => d.General.Launcher = v, "General");
        Toggle("Right drawer (OSD, toggles, session)", d.General.Side, v => d.General.Side = v, "General");
        Toggle("Edge bar (workspaces, clock, status, power)", d.General.Bar, v => d.General.Bar = v, "General");
        Toggle("Start with Windows", d.General.StartWithWindows, v => d.General.StartWithWindows = v, "General");

        Section("Appearance");
        Combo("Colour scheme", ["auto", "light", "dark"], d.Appearance.Mode, v => d.Appearance.Mode = v, "Appearance");
        Combo("Palette (neutral = grey surfaces, accent from wallpaper)", ["neutral", "monochrome", "tinted"], d.Appearance.Palette, v => d.Appearance.Palette = v, "Appearance");
        Combo("Surface outline", ["auto", "on", "off"], d.Appearance.Outline, v => d.Appearance.Outline = v, "Appearance");
        Combo("Material You variant", Enum.GetNames<Variant>(), d.Appearance.Variant, v => d.Appearance.Variant = v, "Appearance");
        Slider("Surface opacity", 0.4, 1, 0.05, d.Appearance.Transparency, v => d.Appearance.Transparency = v, "Appearance");
        Slider("Animation speed (0 = off)", 0, 2, 0.1, d.Appearance.AnimSpeed, v => d.Appearance.AnimSpeed = v, "Appearance");
        Slider("UI scale (restarts)", 0.6, 2, 0.05, d.Appearance.Scale, v => d.Appearance.Scale = v, "Scale");

        Section("Island");
        Toggle("Open on hover", d.Island.HoverOpen, v => d.Island.HoverOpen = v, "Island");
        Toggle("Open with scroll down", d.Island.WheelOpen, v => d.Island.WheelOpen = v, "Island");
        Hotkey("Toggle hotkey", d.Island.Hotkey, v => d.Island.Hotkey = v, "Island");
        TabList(d.Island.Tabs);
        Toggle("Show track changes", d.Island.PeekOnTrack, v => d.Island.PeekOnTrack = v, "Island");
        Toggle("Animated equalizer in the pill", d.Island.AnimateEqualizer, v => d.Island.AnimateEqualizer = v, "Island");
        Slider("Close delay after the pointer leaves (ms)", 0, 1500, 50, d.Island.CloseDelayMs, v => d.Island.CloseDelayMs = (int)v, "Island");

        Section("Launcher");
        Toggle("Open from the bottom edge", d.Launcher.EdgeTrigger, v => d.Launcher.EdgeTrigger = v, "Launcher");
        Slider("Edge hover delay (ms)", 0, 1000, 25, d.Launcher.DwellMs, v => d.Launcher.DwellMs = (int)v, "Launcher");
        Hotkey("Toggle hotkey", d.Launcher.Hotkey, v => d.Launcher.Hotkey = v, "Launcher");
        Slider("Visible results", 3, 12, 1, d.Launcher.MaxItems, v => d.Launcher.MaxItems = (int)v, "Launcher");
        Folder("Wallpaper folder", d.Launcher.WallpaperFolder, v => d.Launcher.WallpaperFolder = v, "Launcher");

        Section("Right drawer");
        Toggle("Show OSD when volume changes", d.Side.OsdOnChange, v => d.Side.OsdOnChange = v, "Side");
        Toggle("Open from the right edge", d.Side.EdgeTrigger, v => d.Side.EdgeTrigger = v, "Side");
        Slider("Edge hover delay (ms)", 0, 1000, 25, d.Side.DwellMs, v => d.Side.DwellMs = (int)v, "Side");
        Hotkey("Session menu hotkey", d.Side.SessionHotkey, v => d.Side.SessionHotkey = v, "Side");
        Toggle("Dim the screen behind the session menu", d.Side.Dim, v => d.Side.Dim = v, "Side");

        Section("Bar");
        Combo("Position", ["left", "right"], d.Bar.Position, v => d.Bar.Position = v, "Bar");
        Combo("Mode (reserve claims screen space like the taskbar)", ["reserve", "autohide"], d.Bar.Mode, v => d.Bar.Mode = v, "Bar");
        EntryList(d.Bar.Entries);
        Toggle("Show seconds in the clock", d.Bar.ShowSeconds, v => d.Bar.ShowSeconds = v, "Bar");
        Toggle("Hover popouts", d.Bar.Popouts, v => d.Bar.Popouts = v, "Bar");
        Toggle("Scroll the top half for volume", d.Bar.ScrollVolume, v => d.Bar.ScrollVolume = v, "Bar");
        Toggle("Scroll the bottom half for brightness", d.Bar.ScrollBrightness, v => d.Bar.ScrollBrightness = v, "Bar");
        Toggle("Scroll over workspaces to switch desktop", d.Bar.ScrollWorkspaces, v => d.Bar.ScrollWorkspaces = v, "Bar");
        Toggle("Status icon: network", d.Bar.ShowNetwork, v => d.Bar.ShowNetwork = v, "Bar");
        Toggle("Status icon: Bluetooth", d.Bar.ShowBluetooth, v => d.Bar.ShowBluetooth = v, "Bar");
        Toggle("Status icon: battery", d.Bar.ShowBattery, v => d.Bar.ShowBattery = v, "Bar");
        Toggle("Status icon: audio", d.Bar.ShowAudio, v => d.Bar.ShowAudio = v, "Bar");
        Toggle("Status icon: microphone", d.Bar.ShowMic, v => d.Bar.ShowMic = v, "Bar");
        Toggle("Status icon: keyboard layout", d.Bar.ShowKeyboard, v => d.Bar.ShowKeyboard = v, "Bar");

        Section("Pages");
        Toggle("Media visualiser", d.Media.Visualiser, v => d.Media.Visualiser = v, "Media");
        Slider("Performance refresh (ms)", 250, 5000, 250, d.Perf.IntervalMs, v => d.Perf.IntervalMs = (int)v, "Perf");

        Section("About");
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        var quit = new RippleButton { Content = "Quit Hitodama", Background = Ui.Brush("SurfaceContainerHigh") };
        quit.Click += (_, _) => App.Quit();
        var folder = new RippleButton { Content = "Open data folder", Background = Ui.Brush("SurfaceContainerHigh") };
        folder.Click += (_, _) => System.Diagnostics.Process.Start("explorer.exe", Store.Folder);
        row.Children.Add(folder);
        row.Children.Add(quit);
        _body.Children.Add(row);
    }

    void Changed(string section)
    {
        _dirty.Add(section);
        _save.Stop();
        _save.Start();
    }

    // ---------------- row helpers ----------------

    void Title_(string title, string sub)
    {
        _body.Children.Add(new TextBlock { Text = title, FontSize = 28, FontWeight = FontWeights.SemiBold });
        _body.Children.Add(new TextBlock { Text = sub, Opacity = 0.7, Margin = new Thickness(0, 0, 0, 8) });
    }

    void Section(string name) => _body.Children.Add(new TextBlock
    {
        Text = name.ToUpperInvariant(), FontSize = 12, FontWeight = FontWeights.SemiBold, CharacterSpacing = 80,
        Foreground = Ui.Brush("Primary"), Margin = new Thickness(0, 18, 0, 4),
    });

    Grid Row(string label, FrameworkElement control)
    {
        var g = new Grid { Padding = new Thickness(16, 10, 16, 10), CornerRadius = new CornerRadius(12), Background = Ui.Brush("SurfaceContainerLow") };
        g.ColumnDefinitions.Add(new ColumnDefinition());
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        g.Children.Add(new TextBlock { Text = label, VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.Wrap });
        control.VerticalAlignment = VerticalAlignment.Center;
        g.Children.Add(control.At(0, 1));
        _body.Children.Add(g);
        return g;
    }

    void Toggle(string label, bool value, Action<bool> set, string section)
    {
        var t = new ToggleSwitch { IsOn = value, OnContent = "", OffContent = "", MinWidth = 0 };
        t.Toggled += (_, _) => { set(t.IsOn); Changed(section); };
        Row(label, t);
    }

    void Combo(string label, string[] options, string value, Action<string> set, string section)
    {
        var c = new ComboBox { ItemsSource = options, SelectedItem = value, MinWidth = 160 };
        c.SelectionChanged += (_, _) => { if (c.SelectedItem is string s) { set(s); Changed(section); } };
        Row(label, c);
    }

    void Slider(string label, double min, double max, double step, double value, Action<double> set, string section)
    {
        var s = new Slider { Minimum = min, Maximum = max, StepFrequency = step, Value = value, Width = 220 };
        s.ValueChanged += (_, e) => { set(e.NewValue); Changed(section); };
        Row(label, s);
    }

    void Hotkey(string label, string value, Action<string> set, string section)
    {
        var box = new TextBox { Text = value, Width = 200, IsReadOnly = true, PlaceholderText = "Press keys…" };
        box.PreviewKeyDown += (_, e) =>
        {
            e.Handled = true;
            if (e.Key is Windows.System.VirtualKey.Control or Windows.System.VirtualKey.Menu or Windows.System.VirtualKey.Shift
                or Windows.System.VirtualKey.LeftWindows or Windows.System.VirtualKey.RightWindows) return;
            static bool Down(Windows.System.VirtualKey k) =>
                Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(k).HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down);
            var parts = new List<string>();
            if (Down(Windows.System.VirtualKey.Control)) parts.Add("Ctrl");
            if (Down(Windows.System.VirtualKey.Menu)) parts.Add("Alt");
            if (Down(Windows.System.VirtualKey.Shift)) parts.Add("Shift");
            if (Down(Windows.System.VirtualKey.LeftWindows) || Down(Windows.System.VirtualKey.RightWindows)) parts.Add("Win");
            if (parts.Count == 0) return; // global hotkeys need a modifier
            parts.Add(e.Key.ToString());
            box.Text = string.Join("+", parts);
            set(box.Text);
            Changed(section);
        };
        Row(label, box);
    }

    void Folder(string label, string? value, Action<string?> set, string section)
    {
        var b = new RippleButton { Content = value ?? "Pictures\\Wallpapers (default)", MaxWidth = 280 };
        b.Click += async (_, _) =>
        {
            var picker = new FolderPicker { SuggestedStartLocation = PickerLocationId.PicturesLibrary };
            picker.FileTypeFilter.Add("*");
            WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this));
            if (await picker.PickSingleFolderAsync() is { } f) { set(f.Path); b.Content = f.Path; Changed(section); }
        };
        Row(label, b);
    }

    // Ordered, checkable bar entries (a spacer is an entry too: it pushes what follows to the far end).
    void EntryList(List<BarEntry> entries)
    {
        foreach (var id in BarSettings.AllEntries.Where(id => entries.All(e => e.Id != id))) entries.Add(new BarEntry { Id = id, Enabled = false });
        var list = new StackPanel { Spacing = 4 };
        void Render()
        {
            list.Children.Clear();
            for (int i = 0; i < entries.Count; i++)
            {
                int index = i;
                var entry = entries[i];
                var row = new Grid { ColumnSpacing = 6 };
                row.ColumnDefinitions.Add(new ColumnDefinition());
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                var cb = new CheckBox { Content = entry.Id, IsChecked = entry.Enabled };
                cb.Click += (_, _) => { entry.Enabled = cb.IsChecked == true; Changed("Bar"); };
                row.Children.Add(cb);
                var up = new RippleButton { Content = "↑", IsEnabled = i > 0 };
                up.Click += (_, _) => { entries.RemoveAt(index); entries.Insert(index - 1, entry); Changed("Bar"); Render(); };
                var down = new RippleButton { Content = "↓", IsEnabled = i < entries.Count - 1 };
                down.Click += (_, _) => { entries.RemoveAt(index); entries.Insert(index + 1, entry); Changed("Bar"); Render(); };
                row.Children.Add(up.At(0, 1));
                row.Children.Add(down.At(0, 2));
                list.Children.Add(row);
            }
        }
        Render();
        var g = new Grid { Padding = new Thickness(16, 10, 16, 10), CornerRadius = new CornerRadius(12), Background = Ui.Brush("SurfaceContainerLow"), RowSpacing = 6 };
        g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        g.Children.Add(new TextBlock { Text = "Bar entries (order and visibility)" });
        g.Children.Add(list.At(1, 0));
        _body.Children.Add(g);
    }

    // Ordered, checkable tab list: what the island dashboard shows and in which order.
    void TabList(List<string> tabs)
    {
        string[] all = ["Dashboard", "Media", "Performance", "Clipboard"];
        var list = new StackPanel { Spacing = 4 };
        void Render()
        {
            list.Children.Clear();
            var order = tabs.Concat(all.Except(tabs)).ToList();
            foreach (var name in order)
            {
                var row = new Grid { ColumnSpacing = 6 };
                row.ColumnDefinitions.Add(new ColumnDefinition());
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                var cb = new CheckBox { Content = name, IsChecked = tabs.Contains(name) };
                cb.Click += (_, _) =>
                {
                    if (cb.IsChecked == true) tabs.Add(name);
                    else if (tabs.Count > 1) tabs.Remove(name);
                    Changed("Island");
                    Render();
                };
                row.Children.Add(cb);
                int i = tabs.IndexOf(name);
                var up = new RippleButton { Content = "↑", IsEnabled = i > 0 };
                up.Click += (_, _) => { tabs.RemoveAt(i); tabs.Insert(i - 1, name); Changed("Island"); Render(); };
                var down = new RippleButton { Content = "↓", IsEnabled = i >= 0 && i < tabs.Count - 1 };
                down.Click += (_, _) => { tabs.RemoveAt(i); tabs.Insert(i + 1, name); Changed("Island"); Render(); };
                row.Children.Add(up.At(0, 1));
                row.Children.Add(down.At(0, 2));
                list.Children.Add(row);
            }
        }
        Render();
        var g = new Grid { Padding = new Thickness(16, 10, 16, 10), CornerRadius = new CornerRadius(12), Background = Ui.Brush("SurfaceContainerLow"), RowSpacing = 6 };
        g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        g.Children.Add(new TextBlock { Text = "Dashboard tabs (order and visibility)" });
        g.Children.Add(list.At(1, 0));
        _body.Children.Add(g);
    }
}
