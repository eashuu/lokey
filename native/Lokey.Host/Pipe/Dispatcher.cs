using System.Text.Json;

namespace Lokey.Host.Pipe;

internal static class Events
{
    /// <summary>Set by the pipe server once a client is connected (or by --selftest). Events before that are dropped.</summary>
    public static volatile Action<string>? Sink;

    sealed record Msg(string Event, object? Data);

    public static void Emit(string name, object? data)
    {
        var s = Sink;
        if (s is null) return;
        try { s(JsonSerializer.Serialize(new Msg(name, data), Json.O)); }
        catch (Exception e) { Log.Error("emit " + name, e); }
    }
}

internal static class Dispatcher
{
    public static readonly Empty Ok = new();
    static readonly Dictionary<string, Func<JsonElement, Task<object?>>> Table = new();

    /// <summary>Completes when the services have finished starting. Requests (other than sys.*) wait on it.</summary>
    public static Task Ready = Task.CompletedTask;

    public static void Add(string name, Func<JsonElement, object?> f) => Table[name] = p => Task.FromResult(f(p));
    public static void AddAsync(string name, Func<JsonElement, Task<object?>> f) => Table[name] = f;
    public static IEnumerable<string> Methods => Table.Keys;

    public static async Task<object?> Call(string method, JsonElement p)
    {
        if (!Table.TryGetValue(method, out var h)) throw new MissingMethodException($"unknown method '{method}'");
        if (!method.StartsWith("sys.")) await Ready.ConfigureAwait(false);
        return await h(p).ConfigureAwait(false);
    }
}
