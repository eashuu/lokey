using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.ApplicationModel.DataTransfer;
using WinClipboard = Windows.ApplicationModel.DataTransfer.Clipboard;

namespace Hitodama.Shell.Tabs;

// Windows' own clipboard history (Win+V) with search, filters and click-to-paste.
public sealed partial class ClipboardTab : UserControl, IPage
{
    enum Kind { Text, Link, Image }
    sealed record Entry(ClipboardHistoryItem Item, Kind Kind, string Text, BitmapImage? Image);

    static readonly string[] FilterNames = ["All", "Text", "Links", "Images"];
    readonly List<Entry> _entries = [];
    string _filter = "All";
    bool _visible;

    public ClipboardTab()
    {
        InitializeComponent();
        Width = Tokens.Px(480);
        Height = Tokens.Px(380);
        Search.Height = Tokens.Px(40);
        Search.Padding = new Thickness(Tokens.Px(14), Tokens.Px(8), Tokens.Px(10), 0);
        Search.FontSize = Tokens.Font(13);
        foreach (var name in FilterNames)
        {
            var chip = new ToggleButton { Content = name, Style = App.Res<Style>("Chip"), IsChecked = name == _filter };
            chip.Click += (_, _) =>
            {
                _filter = name;
                foreach (ToggleButton c in Filters.Children) c.IsChecked = (string)c.Content == name;
                Render();
            };
            Filters.Children.Add(chip);
        }
        WinClipboard.HistoryChanged += (_, _) => DispatcherQueue.TryEnqueue(async () => { if (_visible) await LoadAsync(); });
    }

    public async void OnShown()
    {
        _visible = true;
        Search.Text = "";
        await LoadAsync();
        Search.Focus(FocusState.Programmatic);
    }

    public void OnHidden() => _visible = false;

    async Task LoadAsync()
    {
        bool enabled = WinClipboard.IsHistoryEnabled();
        Disabled.Visibility = enabled ? Visibility.Collapsed : Visibility.Visible;
        if (!enabled) { List.Children.Clear(); return; }

        var result = await WinClipboard.GetHistoryItemsAsync();
        if (result.Status != ClipboardHistoryItemsResultStatus.Success) return;
        _entries.Clear();
        foreach (var item in result.Items)
        {
            var c = item.Content;
            if (c.Contains(StandardDataFormats.Bitmap))
            {
                var img = new BitmapImage { DecodePixelHeight = 120 };
                using var s = await (await c.GetBitmapAsync()).OpenReadAsync();
                await img.SetSourceAsync(s);
                _entries.Add(new Entry(item, Kind.Image, "Image", img));
            }
            else if (c.Contains(StandardDataFormats.Text))
            {
                var text = await c.GetTextAsync();
                bool link = Uri.TryCreate(text.Trim(), UriKind.Absolute, out var u) && u.Scheme.StartsWith("http");
                _entries.Add(new Entry(item, link ? Kind.Link : Kind.Text, text, null));
            }
        }
        Render();
    }

    IEnumerable<Entry> Visible()
    {
        var q = Search.Text.Trim();
        return _entries.Where(e =>
            (_filter == "All" || _filter == "Text" && e.Kind == Kind.Text || _filter == "Links" && e.Kind == Kind.Link || _filter == "Images" && e.Kind == Kind.Image)
            && (q.Length == 0 || e.Text.Contains(q, StringComparison.OrdinalIgnoreCase)));
    }

    void Render()
    {
        List.Children.Clear();
        foreach (var e in Visible()) List.Children.Add(Card(e));
    }

    UIElement Card(Entry e)
    {
        var grid = new Grid { ColumnSpacing = Tokens.Px(12) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition());
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        grid.Children.Add(e.Image is not null
            ? new Border { Height = Tokens.Px(64), MaxWidth = Tokens.Px(160), CornerRadius = new CornerRadius(Tokens.Px(10)), Child = new Image { Source = e.Image, Stretch = Stretch.UniformToFill } }
            : new Border
            {
                Width = Tokens.Px(34), Height = Tokens.Px(34), CornerRadius = new CornerRadius(Tokens.Px(12)), VerticalAlignment = VerticalAlignment.Top,
                Background = App.Res<SolidColorBrush>(e.Kind == Kind.Link ? "TertiaryContainer" : "SecondaryContainer"),
                Child = new FontIcon { Glyph = e.Kind == Kind.Link ? "link" : "notes", FontSize = Tokens.Font(13), FontFamily = App.Res<FontFamily>("Icons"),
                    Foreground = App.Res<SolidColorBrush>(e.Kind == Kind.Link ? "OnTertiaryContainer" : "OnSecondaryContainer") },
            });

        var text = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Spacing = 2 };
        if (e.Image is null)
            text.Children.Add(new TextBlock { Text = e.Text.Trim().ReplaceLineEndings(" "), Style = App.Res<Style>("Body"), TextWrapping = TextWrapping.Wrap, MaxLines = 2 });
        text.Children.Add(new TextBlock { Text = Ago(e.Item.Timestamp), Style = App.Res<Style>("Body"), FontSize = Tokens.Font(11), Foreground = App.Res<SolidColorBrush>("OnSurfaceVariant") });
        Grid.SetColumn(text, 1);
        grid.Children.Add(text);

        var del = new RippleButton { Content = "close", Style = App.Res<Style>("IconButton"), Width = Tokens.Px(30), Height = Tokens.Px(30), FontSize = Tokens.Font(11), Opacity = 0 };
        del.Click += (_, _) => { WinClipboard.DeleteItemFromHistory(e.Item); _entries.Remove(e); Render(); };
        Grid.SetColumn(del, 2);
        grid.Children.Add(del);

        var card = new RippleButton
        {
            Content = grid, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Padding = new Thickness(Tokens.Px(12), Tokens.Px(10), Tokens.Px(8), Tokens.Px(10)), BorderThickness = new Thickness(0),
            CornerRadius = App.Res<CornerRadius>("RoundMd"), Background = App.Res<SolidColorBrush>("SurfaceContainer"),
        };
        card.PointerEntered += (_, _) => del.Opacity = 1;
        card.PointerExited += (_, _) => del.Opacity = 0;
        card.Click += (_, _) => Paste(e);
        return card;
    }

    static void Paste(Entry e)
    {
        if (WinClipboard.SetHistoryItemAsContent(e.Item) == SetHistoryItemAsContentStatus.Success)
            App.Island?.CollapseAndPaste();
    }

    static string Ago(DateTimeOffset t)
    {
        var d = DateTimeOffset.Now - t;
        return d.TotalMinutes < 1 ? "now" : d.TotalHours < 1 ? $"{d.Minutes}m ago" : d.TotalDays < 1 ? $"{d.Hours}h ago" : $"{(int)d.TotalDays}d ago";
    }

    void Search_TextChanged(object s, TextChangedEventArgs e) => Render();

    void Search_KeyDown(object s, KeyRoutedEventArgs e)
    {
        if (e.Key == Windows.System.VirtualKey.Enter && Visible().FirstOrDefault() is { } first) Paste(first);
    }

    void Clear_Click(object s, RoutedEventArgs e) { WinClipboard.ClearHistory(); _entries.Clear(); Render(); }

    async void OpenSettings_Click(object s, RoutedEventArgs e) =>
        await Windows.System.Launcher.LaunchUriAsync(new Uri("ms-settings:clipboard"));
}
