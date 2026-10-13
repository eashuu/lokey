using Hitodama.Shell.Services;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.Foundation;

namespace Hitodama.Shell.Tabs;

// Port of Caelestia's Performance.qml: three ring gauges, then storage and network rows.
public sealed class PerformanceTab : Grid, IPage
{
    const int History = 48;
    readonly DispatcherTimer _tick = new();
    readonly (Ring ring, TextBlock value, TextBlock sub)[] _gauges;
    readonly Border _diskFill = new() { HorizontalAlignment = HorizontalAlignment.Left };
    readonly TextBlock _disk = Ui.Text("", 12, "OnSurfaceVariant"), _net = Ui.Text("", 12, "OnSurfaceVariant");
    readonly Polyline _down = new() { StrokeThickness = 2, StrokeLineJoin = PenLineJoin.Round };
    readonly Polyline _up = new() { StrokeThickness = 1.5, StrokeLineJoin = PenLineJoin.Round, Opacity = 0.8 };
    readonly Queue<double> _downHist = new(Enumerable.Repeat(0.0, History)), _upHist = new(Enumerable.Repeat(0.0, History));
    readonly double _width, _sparkH;

    public PerformanceTab()
    {
        _width = Tokens.Px(640);
        _sparkH = Tokens.Px(44);
        Width = _width;
        RowSpacing = Tokens.Px(14);
        RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        // ---- gauges ----
        var gauges = new Grid { ColumnSpacing = Tokens.Px(12) };
        string[] labels = ["CPU", "GPU", "MEMORY"];
        string[] colours = ["Primary", "Tertiary", "Secondary"];
        _gauges = new (Ring, TextBlock, TextBlock)[3];
        for (int i = 0; i < 3; i++)
        {
            gauges.ColumnDefinitions.Add(new ColumnDefinition());
            var ring = new Ring(Tokens.Px(132), Tokens.Px(9), 300, colours[i]);
            var value = Ui.Num("0%", 24, "OnSurface");
            var label = Ui.Text(labels[i], 11, colours[i], FontWeights.SemiBold);
            label.CharacterSpacing = 60;
            var center = Ui.Stack(Orientation.Vertical, 0, value, label);
            value.HorizontalAlignment = label.HorizontalAlignment = center.HorizontalAlignment = HorizontalAlignment.Center;
            center.VerticalAlignment = VerticalAlignment.Center;
            ring.Children.Add(center);
            var sub = Ui.Text("", 11, "OnSurfaceVariant");
            sub.HorizontalAlignment = HorizontalAlignment.Center;
            var col = Ui.Stack(Orientation.Vertical, 6, ring, sub);
            col.HorizontalAlignment = HorizontalAlignment.Center;
            var card = Ui.Card(col, 28, 14);
            gauges.Children.Add(card.At(0, i));
            _gauges[i] = (ring, value, sub);
        }
        Children.Add(gauges);

        // ---- storage ----
        var track = new Grid { Height = Tokens.Px(8) };
        track.Children.Add(new Border { Background = Ui.Brush("SurfaceContainerHighest"), CornerRadius = new CornerRadius(Tokens.Px(4)) });
        _diskFill.Background = Ui.Brush("Primary");
        _diskFill.CornerRadius = new CornerRadius(Tokens.Px(4));
        track.Children.Add(_diskFill);
        var diskHead = new Grid();
        diskHead.Children.Add(Ui.Text("STORAGE  C:", 11, "Primary", FontWeights.SemiBold));
        _disk.HorizontalAlignment = HorizontalAlignment.Right;
        diskHead.Children.Add(_disk);
        Children.Add(Ui.Card(Ui.Stack(Orientation.Vertical, 8, diskHead, track), 20, 14).At(1, 0));

        // ---- network sparkline ----
        _down.Stroke = Ui.Brush("Primary");
        _up.Stroke = Ui.Brush("Tertiary");
        var spark = new Grid { Height = _sparkH };
        spark.Children.Add(_down);
        spark.Children.Add(_up);
        var netHead = new Grid();
        netHead.Children.Add(Ui.Text("NETWORK", 11, "Primary", FontWeights.SemiBold));
        _net.HorizontalAlignment = HorizontalAlignment.Right;
        netHead.Children.Add(_net);
        Children.Add(Ui.Card(Ui.Stack(Orientation.Vertical, 8, netHead, spark), 20, 14).At(2, 0));

        _tick.Tick += (_, _) => Sample();
    }

    public void OnShown()
    {
        _tick.Interval = TimeSpan.FromMilliseconds(Math.Max(250, Store.Data.Perf.IntervalMs));
        Stats.Cpu(); Stats.Network(); Stats.Gpu();
        Sample();
        _tick.Start();
    }

    public void OnHidden() => _tick.Stop();

    void Sample()
    {
        double cpu = Stats.Cpu();
        var temp = Stats.CpuTemp();
        Gauge(0, cpu, temp is { } t ? $"{t:0}°C" : $"{Environment.ProcessorCount} threads");

        var gpu = Stats.Gpu();
        Gauge(1, gpu ?? 0, gpu is null ? "unavailable" : "3D engine");

        var (mu, mt) = Stats.MemoryGb();
        Gauge(2, mu / mt, $"{mu:0.0} / {mt:0} GB");

        var (du, dt) = Stats.DiskGb();
        if (dt > 0)
        {
            _disk.Text = $"{du:0} / {dt:0} GB";
            _diskFill.Width = (_width - 2 * Tokens.Px(14)) * du / dt;
        }

        var (down, up) = Stats.Network();
        _net.Text = $"↓ {Stats.Bytes(down)}/s   ↑ {Stats.Bytes(up)}/s";
        Push(_downHist, down); Push(_upHist, up);
        double peak = Math.Max(64 * 1024, Math.Max(_downHist.Max(), _upHist.Max()));
        Spark(_down, _downHist, peak);
        Spark(_up, _upHist, peak);
    }

    void Gauge(int i, double v, string sub)
    {
        _gauges[i].ring.SetValue(v);
        _gauges[i].value.Text = $"{v * 100:0}%";
        _gauges[i].sub.Text = sub;
    }

    static void Push(Queue<double> q, double v) { q.Enqueue(v); q.Dequeue(); }

    void Spark(Polyline line, Queue<double> values, double max)
    {
        double w = _width - 2 * Tokens.Px(14), h = _sparkH - 2;
        var pts = new PointCollection();
        int i = 0;
        foreach (var v in values) pts.Add(new Point(w * i++ / (History - 1), 1 + h - h * Math.Clamp(v / max, 0, 1)));
        line.Points = pts;
    }
}
