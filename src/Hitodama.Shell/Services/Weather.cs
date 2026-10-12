using System.Net.Http;
using System.Text.Json;

namespace Hitodama.Shell.Services;

// Same sources as Caelestia's Weather.qml: Open-Meteo, located by IP (no location permission prompt).
public static class Weather
{
    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(8) };
    static DateTime _fetched = DateTime.MinValue;

    public static string City { get; private set; } = "";
    public static double Temp { get; private set; }
    public static double Feels { get; private set; }
    public static double High { get; private set; }
    public static double Low { get; private set; }
    public static int Code { get; private set; } = -1;
    public static bool Ready => Code >= 0;

    public static async Task RefreshAsync()
    {
        if (DateTime.Now - _fetched < TimeSpan.FromMinutes(20)) return;
        try
        {
            using var geo = JsonDocument.Parse(await Http.GetStringAsync("https://get.geojs.io/v1/ip/geo.json"));
            var g = geo.RootElement;
            string lat = g.GetProperty("latitude").GetString()!, lon = g.GetProperty("longitude").GetString()!;
            City = g.TryGetProperty("city", out var c) ? c.GetString() ?? "" : "";

            var url = $"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}" +
                      "&current=temperature_2m,apparent_temperature,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1";
            using var wx = JsonDocument.Parse(await Http.GetStringAsync(url));
            var cur = wx.RootElement.GetProperty("current");
            var day = wx.RootElement.GetProperty("daily");
            Temp = cur.GetProperty("temperature_2m").GetDouble();
            Feels = cur.GetProperty("apparent_temperature").GetDouble();
            Code = cur.GetProperty("weather_code").GetInt32();
            High = day.GetProperty("temperature_2m_max")[0].GetDouble();
            Low = day.GetProperty("temperature_2m_min")[0].GetDouble();
            _fetched = DateTime.Now;
        }
        catch { /* offline: keep last values */ }
    }

    // WMO weather codes -> (Material Symbols name, description)
    public static (string Glyph, string Text) Describe(int code) => code switch
    {
        0 => ("sunny", "Clear"),
        1 => ("sunny", "Mostly clear"),
        2 => ("partly_cloudy_day", "Partly cloudy"),
        3 => ("cloud", "Overcast"),
        45 or 48 => ("foggy", "Fog"),
        >= 51 and <= 57 => ("rainy", "Drizzle"),
        >= 61 and <= 67 or >= 80 and <= 82 => ("rainy", "Rain"),
        >= 71 and <= 77 or 85 or 86 => ("weather_snowy", "Snow"),
        >= 95 => ("thunderstorm", "Thunderstorm"),
        _ => ("cloud", "—"),
    };
}
