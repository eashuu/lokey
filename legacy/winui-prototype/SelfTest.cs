using System.Diagnostics;
using System.Text;
using Hitodama.Shell.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.Foundation;

namespace Hitodama.Shell;

// `Hitodama.exe --selftest [dir]`: drives every surface through its internal API (no synthetic mouse or
// keyboard), screenshots each state, checks page layouts for overflow and measures idle CPU. Then exits.
public static class SelfTest
{
    static readonly StringBuilder Report = new();
    static int _failures;

    public static bool Running { get; private set; }

    // Dev aid: HITODAMA_ST_ONLY=fonts,bar runs just those sections (default: all).
    static readonly string? Only = Environment.GetEnvironmentVariable("HITODAMA_ST_ONLY");
    static bool On(string section) => Only is null || Only.Split(',').Contains(section);

    public static async Task RunAsync(string dir)
    {
        Running = true;
        Directory.CreateDirectory(dir);
        Log($"Hitodama self-test {DateTime.Now:u}");
        Log($"screen {Tokens.ScreenW:0}x{Tokens.ScreenH:0} DIP, scale S={Tokens.S:0.00}");
        await Task.Delay(1500); // let wallpaper theming settle
        CheckFullscreen();
        CheckBarWork();

        string savedMode = Store.Data.Appearance.Mode;
        foreach (var mode in new[] { "dark", "light" })
        {
            Store.Data.Appearance.Mode = mode;
            Theme.Apply();
            Log($"\n== theme: {mode} ==");
            if (On("fonts")) await FontSheet(dir, mode);

            if (On("island") && App.Island is { } island)
            {
                await Shot(dir, $"island-collapsed-{mode}", island.Surface);
                island.ShowPeek("volume_up", "Volume", null, 0.6, "60", null, 4000);
                await Shot(dir, $"island-peek-{mode}", island.Surface);
                foreach (var tab in Store.Data.Island.Tabs)
                {
                    island.Open(tab);
                    await Task.Delay(1300);
                    await Shot(dir, $"island-{tab.ToLowerInvariant()}-{mode}", island.Surface, settle: 0);
                    if (island.CurrentPage is { } page) CheckLayout($"island/{tab}", page);
                }
                island.Collapse();
                await Task.Delay(700);
            }

            if (On("launcher") && App.Launcher is { } launcher)
            {
                foreach (var (q, name) in new[] { ("", "apps"), (">", "commands"), (">wallpaper ", "wallpaper") })
                {
                    launcher.Open(q);
                    await Shot(dir, $"launcher-{name}-{mode}", launcher.Surface, settle: 1300);
                }
                launcher.Dismiss();
                await Task.Delay(700);
            }

            if (On("bar") && App.Bar is { } bar) await BarShots(dir, mode, bar);

            if (On("side") && App.Side is { } side)
            {
                side.ShowOsd(keepOpen: true);
                await Shot(dir, $"side-osd-{mode}", side.Surface, settle: 1200);
                side.ShowSession();
                await Shot(dir, $"side-session-{mode}", side.Surface, settle: 1200);
                side.Dismiss();
                await Task.Delay(800);
            }
        }

        if (On("settings")) await SettingsShot(dir);
        if (On("barmodes") && App.Bar is not null) await BarModes(dir);

        // The other palettes: the bar and the dashboard in each theme (neutral was covered above).
        if (On("palettes"))
        {
            string savedPalette = Store.Data.Appearance.Palette;
            foreach (var pal in new[] { "monochrome", "tinted" })
                foreach (var mode in new[] { "dark", "light" })
                {
                    Store.Data.Appearance.Mode = mode;
                    Store.Data.Appearance.Palette = pal;
                    Theme.Apply();
                    Log($"\n== palette: {pal} / {mode} ==");
                    if (App.Bar is { } b) await Shot(dir, $"bar-{pal}-{mode}", b.Surface);
                    if (App.Island is { } isl)
                    {
                        isl.Open("Dashboard");
                        await Task.Delay(1300);
                        await Shot(dir, $"island-dashboard-{pal}-{mode}", isl.Surface, settle: 0);
                        isl.Collapse();
                        await Task.Delay(700);
                    }
                }
            Store.Data.Appearance.Palette = savedPalette;
        }
        Store.Data.Appearance.Mode = savedMode;
        await Theme.FromCurrentWallpaperAsync();

        // Idle cost: everything collapsed, nothing should be ticking.
        Log("\n== idle ==");
        if (!On("idle")) { Finish(dir); return; }
        await Task.Delay(3000);
        var p = Process.GetCurrentProcess();
        var cpu0 = p.TotalProcessorTime;
        await Task.Delay(20000);
        p.Refresh();
        double ms = (p.TotalProcessorTime - cpu0).TotalMilliseconds;
        Log($"CPU over 20 s idle: {ms:0} ms {(ms < 60 ? "OK" : "HIGH")}");
        Log($"working set {p.WorkingSet64 / 1048576.0:0} MB, private {p.PrivateMemorySize64 / 1048576.0:0} MB");
        if (ms >= 60) _failures++;
        Finish(dir);
    }

    static void Finish(string dir)
    {
        Log($"\n{_failures} problem(s)");
        File.WriteAllText(Path.Combine(dir, "report.txt"), Report.ToString());
        Environment.ExitCode = _failures == 0 ? 0 : 1;
        App.Quit();
    }

    // Proves the bundled fonts load and the icon ligatures resolve (a missing ligature renders as raw text),
    // and that a ripple draws inside a button.
    static async Task FontSheet(string dir, string mode)
    {
        var panel = new StackPanel { Spacing = 14, Padding = new Thickness(24), Background = Ui.Brush("Surface"), RequestedTheme = Theme.IsDark ? ElementTheme.Dark : ElementTheme.Light };
        string[] names = ["dashboard", "queue_music", "speed", "content_paste", "palette", "wifi", "bluetooth", "battery_full", "volume_up", "power_settings_new", "calendar_month", "logout"];
        foreach (var filled in new[] { false, true })
        {
            var row = Ui.Stack(Orientation.Horizontal, 14);
            foreach (var n in names) row.Children.Add(Ui.Icon(n, 26, filled ? "Primary" : "OnSurface", filled));
            panel.Children.Add(row);
        }
        panel.Children.Add(Ui.Text("Google Sans Flex  Regular / SemiBold: The quick brown fox 0123456789", 16));
        panel.Children.Add(Ui.Text("Google Sans Flex SemiBold: The quick brown fox", 16, weight: Microsoft.UI.Text.FontWeights.SemiBold));
        panel.Children.Add(Ui.Num("Rubik 12:45 28", 28, "Primary"));
        panel.Children.Add(Ui.Num("Rubik 400 12:45 28", 28, "Secondary", Microsoft.UI.Text.FontWeights.Normal));
        var btn = new RippleButton { Content = Ui.Text("Ripple button", 14), Width = 220, Height = 56, CornerRadius = new CornerRadius(16), Background = Ui.Brush("SecondaryContainer") };
        panel.Children.Add(btn);
        var win = new Window { Content = panel };
        double dpi = Native.PrimaryDpi() / 96.0;
        win.AppWindow.MoveAndResize(new Windows.Graphics.RectInt32(40, 40, (int)(760 * dpi), (int)(430 * dpi)));
        win.AppWindow.Show(false); // never activate: no focus theft
        await Task.Delay(900);
        btn.Ripple(new System.Numerics.Vector2(50, 20));
        await Task.Delay(260);
        var p = win.AppWindow.Position; var sz = win.AppWindow.Size;
        await Native.CaptureAsync(p.X, p.Y, sz.Width, sz.Height, Path.Combine(dir, $"fonts-{mode}.png"));
        Log($"captured fonts-{mode}");
        win.Close();
        await Task.Delay(300);
    }

    // The settings window (shown without activating it), top of the page.
    static async Task SettingsShot(string dir)
    {
        var w = new SettingsWindow();
        w.AppWindow.Move(new Windows.Graphics.PointInt32(60, 0));
        w.AppWindow.Show(false);
        await Task.Delay(1500);
        var p = w.AppWindow.Position; var sz = w.AppWindow.Size;
        await Native.CaptureAsync(p.X, p.Y, sz.Width, sz.Height, Path.Combine(dir, "settings.png"));
        Log("captured settings");
        w.Close();
        await Task.Delay(300);
    }

    // Window checks that need no input: the desktop is never "fullscreen", the bar's strip is excluded from the
    // work area, and the other surfaces are centred inside what is left.
    static void CheckFullscreen()
    {
        bool full = Native.IsRealFullscreen(Native.FindWindow("Progman", null));
        Log($"IsRealFullscreen(Progman) = {full} {(full ? "FAIL" : "OK")}");
        if (full) _failures++;
    }

    static void CheckBarWork()
    {
        if (App.Bar is not { } bar) return;
        var work = Microsoft.UI.Windowing.DisplayArea.Primary.WorkArea;
        var mon = Microsoft.UI.Windowing.DisplayArea.Primary.OuterBounds;
        bool left = Store.Data.Bar.Position != "right";
        Log($"bar strip {bar.Rect.X},{bar.Rect.Y} {bar.Rect.Width}x{bar.Rect.Height} px, work area {work.X},{work.Y} {work.Width}x{work.Height}");
        bool ok = !bar.Reserved ? work.X == mon.X && work.Width == mon.Width // autohide reserves nothing
            : left ? work.X - mon.X == bar.Rect.Width : mon.X + mon.Width - (work.X + work.Width) == bar.Rect.Width;
        Log($"work area {(bar.Reserved ? "excludes the bar" : "untouched by the autohide bar")}: {(ok ? "OK" : "FAIL")}");
        if (!ok) _failures++;
        foreach (var (name, w) in new (string, Window?)[] { ("island", App.Island), ("launcher", App.Launcher) })
        {
            if (w is null) continue;
            double centre = w.AppWindow.Position.X + w.AppWindow.Size.Width / 2.0, expect = work.X + work.Width / 2.0;
            bool centred = Math.Abs(centre - expect) <= 2;
            Log($"{name} centred in the work area: {(centred ? "OK" : $"FAIL (centre {centre:0} vs {expect:0})")}");
            if (!centred) _failures++;
        }
    }

    // Right-hand bar and autohide bar, then back to the saved settings (checks the strip is given back).
    static async Task BarModes(string dir)
    {
        var cfg = Store.Data.Bar;
        var (pos, mode) = (cfg.Position, cfg.Mode);
        foreach (var (p, m) in new[] { ("right", "reserve"), ("left", "autohide") })
        {
            cfg.Position = p; cfg.Mode = m;
            App.Rebuild();
            await Task.Delay(1500);
            Log($"\n== bar {p} / {m} ==");
            CheckBarWork();
            if (App.Bar is not { } bar) continue;
            if (m == "autohide") bar.SetShown(true);
            await BarShots(dir, $"{p}-{m}", bar, new[] { "audio", "clock" });
        }
        cfg.Position = pos; cfg.Mode = mode;
        App.Rebuild();
        await Task.Delay(1500);
        Log("\n== bar restored ==");
        CheckBarWork();
    }

    // The bar itself, then each popout opened through its API, with a layout check on every popout page.
    static async Task BarShots(string dir, string tag, BarWindow bar, string[]? popouts = null)
    {
        await Shot(dir, $"bar-{tag}", bar.Surface, settle: 1200);
        CheckLayout("bar/entries", bar.Entries, size: false);
        if (bar.Popouts is not { } pop) return;
        foreach (var name in popouts ?? ["audio", "network", "bluetooth", "battery", "activewindow", "clock"])
        {
            bar.ShowPopout(name);
            await Task.Delay(1300);
            if (pop.CurrentPage is { } page) CheckLayout($"bar/popout/{name}", page, size: false);
            var b = bar.Rect;
            var p = pop.AppWindow.Position; var sz = pop.AppWindow.Size;
            Log($"  popout window {p.X},{p.Y} {sz.Width}x{sz.Height} visible={pop.AppWindow.IsVisible} page={pop.Active} centre={pop.LastCenter:0}");
            int x0 = Math.Min(b.X, p.X), x1 = Math.Max(b.X + b.Width, p.X + sz.Width);
            await Native.CaptureAsync(x0, b.Y, x1 - x0, b.Height, Path.Combine(dir, $"bar-popout-{name}-{tag}.png"));
            Log($"captured bar-popout-{name}-{tag}");
        }
        pop.Hide();
        await Task.Delay(700);
    }

    static async Task Shot(string dir, string name, EdgeSurface s, int settle = 900)
    {
        await Task.Delay(settle);
        var w = App.Island?.Surface == s ? (Window)App.Island! : App.Launcher?.Surface == s ? App.Launcher! : App.Bar?.Surface == s ? App.Bar! : (Window)App.Side!;
        var pos = w.AppWindow.Position;
        var size = w.AppWindow.Size;
        await Native.CaptureAsync(pos.X, pos.Y, size.Width, size.Height, Path.Combine(dir, name + ".png"));
        Log($"captured {name}");
    }

    // Every visible element must sit inside its page (scrollable content excluded); trimmed text is reported.
    static void CheckLayout(string name, FrameworkElement page, bool size = true)
    {
        int overflow = 0, trimmed = 0;
        void Walk(DependencyObject node)
        {
            for (int i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++)
            {
                var child = VisualTreeHelper.GetChild(node, i);
                if (child is FrameworkElement fe && fe.Visibility == Visibility.Visible && fe.ActualWidth > 0)
                {
                    var r = fe.TransformToVisual(page).TransformBounds(new Rect(0, 0, fe.ActualWidth, fe.ActualHeight));
                    if (r.Left < -1 || r.Top < -1 || r.Right > page.ActualWidth + 1 || r.Bottom > page.ActualHeight + 1)
                    {
                        overflow++;
                        if (overflow <= 5) Log($"  overflow: {fe.GetType().Name} {(fe as TextBlock)?.Text} {r}");
                    }
                    if (fe is TextBlock { IsTextTrimmed: true } tb) { trimmed++; if (trimmed <= 5) Log($"  trimmed: \"{tb.Text}\""); }
                }
                if (child is not ScrollViewer) Walk(child);
            }
        }
        Walk(page);
        double fracW = page.ActualWidth / Tokens.ScreenW, fracH = page.ActualHeight / Tokens.ScreenH;
        Log($"{name}: {page.ActualWidth:0}x{page.ActualHeight:0} DIP ({fracW:P0} x {fracH:P0} of screen), overflow {overflow}, trimmed {trimmed}");
        if (overflow > 0) _failures++;
        if (size && (fracW > 0.62 || fracH > 0.62)) { _failures++; Log("  too big"); }
    }

    static void Log(string line) => Report.AppendLine(line);
}
