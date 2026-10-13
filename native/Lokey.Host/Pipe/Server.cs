using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;

namespace Lokey.Host.Pipe;

// One client, one JSON object per line, UTF-8. Replies and events share one serialised writer.
internal static class Server
{
    sealed record Reply(JsonElement Id, object? Result);
    sealed record ErrBody(string Message);
    sealed record ErrReply(JsonElement Id, ErrBody Error);

    static readonly Channel<string> Out = Channel.CreateUnbounded<string>(new UnboundedChannelOptions { SingleReader = true });
    static readonly Dictionary<string, Task> Lanes = new();
    static readonly HashSet<string> OwnLane = ["apps.searchFiles", "apps.icon", "wallpaper.thumb", "apps.list"];

    public static async Task<int> Run(string pipe)
    {
        if (pipe.StartsWith(@"\\.\pipe\", StringComparison.OrdinalIgnoreCase)) pipe = pipe[9..];
        using var ps = new NamedPipeServerStream(pipe, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
        Dispatcher.Ready = Boot.StartAsync();

        // An orphaned host (Electron died before connecting) must not live forever.
        using (var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30)))
        {
            try { await ps.WaitForConnectionAsync(cts.Token); }
            catch (OperationCanceledException) { Log.Info("no client within 30s, exiting"); return 3; }
        }
        Log.Info("client connected");
        Events.Sink = line => Out.Writer.TryWrite(line);
        var writer = Task.Run(async () =>
        {
            try
            {
                using var w = new StreamWriter(ps, new UTF8Encoding(false), 4096, leaveOpen: true) { AutoFlush = false };
                await foreach (var line in Out.Reader.ReadAllAsync())
                {
                    await w.WriteAsync(line);
                    await w.WriteAsync('\n');
                    await w.FlushAsync();
                }
            }
            catch (Exception e) { Log.Error("pipe write", e); Exit(0); }
        });

        try
        {
            using var r = new StreamReader(ps, new UTF8Encoding(false), false, 4096, leaveOpen: true);
            string? line;
            while ((line = await r.ReadLineAsync()) is not null)
                if (line.Length > 0) OnLine(line);
        }
        catch (Exception e) { Log.Error("pipe read", e); }
        Log.Info("pipe closed, exiting");
        Exit(0);
        return 0;
    }

    public static void Exit(int code)
    {
        try { Boot.Shutdown(); } catch { }
        Environment.Exit(code);
    }

    static void OnLine(string line)
    {
        JsonElement id, p = default;
        string method;
        try
        {
            using var doc = JsonDocument.Parse(line);
            var root = doc.RootElement;
            if (!root.TryGetProperty("id", out var i) || !root.TryGetProperty("method", out var m) || m.ValueKind != JsonValueKind.String) return;
            id = i.Clone();
            method = m.GetString()!;
            if (root.TryGetProperty("params", out var pp)) p = pp.Clone();
        }
        catch (Exception e) { Log.Error("bad request line", e); return; }

        // Same-prefix requests run in order (volume sliders, hotkey register/unregister); different areas never block each other.
        var lane = OwnLane.Contains(method) ? method : method.Split('.')[0];
        lock (Lanes)
        {
            Lanes.TryGetValue(lane, out var prev);
            Lanes[lane] = (prev ?? Task.CompletedTask).ContinueWith(_ => Handle(id, method, p), TaskScheduler.Default).Unwrap();
        }
    }

    static async Task Handle(JsonElement id, string method, JsonElement p)
    {
        string json;
        try
        {
            var result = await Dispatcher.Call(method, p);
            json = JsonSerializer.Serialize(new Reply(id, result ?? Dispatcher.Ok), Json.O);
        }
        catch (Exception ex)
        {
            if (ex is AggregateException { InnerException: { } inner }) ex = inner;
            Log.Error(method, ex);
            json = JsonSerializer.Serialize(new ErrReply(id, new ErrBody(ex.Message)), Json.O);
        }
        Out.Writer.TryWrite(json);
        if (method == "sys.quit") { await Task.Delay(100); Exit(0); }
    }
}
