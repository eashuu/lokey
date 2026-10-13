using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Lokey.Host;

internal static class Json
{
    // camelCase; null stays on the wire as null (the TS types say `| null`).
    public static readonly JsonSerializerOptions O = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
        WriteIndented = false,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };
}

internal static class Paths
{
    // LOKEY_DATA_DIR redirects all state (tests use it so they never touch the real store).
    public static readonly string Root = Environment.GetEnvironmentVariable("LOKEY_DATA_DIR") is { Length: > 0 } d ? d : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Lokey");
    public static string Sub(params string[] parts)
    {
        var p = Path.Combine([Root, .. parts]);
        Directory.CreateDirectory(Path.GetDirectoryName(p) ?? Root);
        return p;
    }
    public static string Dir(params string[] parts)
    {
        var p = Path.Combine([Root, .. parts]);
        Directory.CreateDirectory(p);
        return p;
    }
}

// Rolling log (1 MB cap). Never receives clipboard contents or user-document paths.
internal static class Log
{
    static readonly object L = new();
    static readonly Regex PathRx = new(@"[A-Za-z]:\\[^\s'""<>|]*", RegexOptions.Compiled);

    public static void Info(string m) => Write("I", m);
    public static void Error(string ctx, Exception ex) => Write("E", $"{ctx}: {ex.GetType().Name}: {PathRx.Replace(ex.Message, "<path>")}");

    static void Write(string lvl, string m)
    {
        try
        {
            lock (L)
            {
                var f = Paths.Sub("host.log");
                var fi = new FileInfo(f);
                if (fi.Exists && fi.Length > 1_000_000) File.Move(f, f + ".1", true);
                File.AppendAllText(f, $"{DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff", System.Globalization.CultureInfo.InvariantCulture)} {lvl} {m}{Environment.NewLine}");
            }
        }
        catch { /* logging must never throw */ }
    }
}

internal sealed class Debounce
{
    readonly Timer _t;
    readonly int _ms;
    public Debounce(int ms, Action a)
    {
        _ms = ms;
        _t = new Timer(_ => { try { a(); } catch (Exception e) { Log.Error("debounce", e); } }, null, Timeout.Infinite, Timeout.Infinite);
    }
    public void Poke() => _t.Change(_ms, Timeout.Infinite);
}

// Typed access to request params.
internal static class Args
{
    static bool Has(JsonElement p, string n, out JsonElement v)
    {
        v = default;
        return p.ValueKind == JsonValueKind.Object && p.TryGetProperty(n, out v) && v.ValueKind != JsonValueKind.Null;
    }
    public static string? OptStr(JsonElement p, string n) => Has(p, n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    public static string Str(JsonElement p, string n) => OptStr(p, n) ?? throw new ArgumentException($"missing string param '{n}'");
    public static double? OptNum(JsonElement p, string n) => Has(p, n, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : null;
    public static double Num(JsonElement p, string n) => OptNum(p, n) ?? throw new ArgumentException($"missing number param '{n}'");
    public static int Int(JsonElement p, string n) => (int)Num(p, n);
    public static int? OptInt(JsonElement p, string n) => OptNum(p, n) is { } d ? (int)d : null;
    public static bool? OptBool(JsonElement p, string n) => Has(p, n, out var v) && v.ValueKind is JsonValueKind.True or JsonValueKind.False ? v.GetBoolean() : null;
    public static bool Bool(JsonElement p, string n) => OptBool(p, n) ?? throw new ArgumentException($"missing bool param '{n}'");
}

internal sealed record Empty();
