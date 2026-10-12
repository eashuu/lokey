using System.Text.Json;

namespace Hitodama.Shell.Services;

public sealed class TodoItem
{
    public string Text { get; set; } = "";
    public bool Done { get; set; }
}

public sealed class GeneralSettings
{
    public bool Island { get; set; } = true;
    public bool Launcher { get; set; } = true;
    public bool Side { get; set; } = true;
    public bool Bar { get; set; } = true;
    public bool StartWithWindows { get; set; }
}

public sealed class AppearanceSettings
{
    public string Mode { get; set; } = "auto";          // auto | light | dark
    public string Variant { get; set; } = "TonalSpot";
    public string Palette { get; set; } = "neutral";    // neutral | monochrome | tinted
    public string Outline { get; set; } = "auto";       // auto (light only) | on | off
    public double Scale { get; set; } = 1.0;
    public double Transparency { get; set; } = 1.0;     // surface opacity, 0.5..1
    public double AnimSpeed { get; set; } = 1.0;        // 0 = instant
}

public sealed class IslandSettings
{
    public bool HoverOpen { get; set; } = true;
    public bool WheelOpen { get; set; } = true;
    public string Hotkey { get; set; } = "Ctrl+Alt+Space";
    public List<string> Tabs { get; set; } = ["Dashboard", "Media", "Performance", "Clipboard"];
    public bool PeekOnTrack { get; set; } = true;
    public bool AnimateEqualizer { get; set; }
    public int CloseDelayMs { get; set; } = 350;
}

public sealed class LauncherSettings
{
    public bool EdgeTrigger { get; set; } = true;
    public int DwellMs { get; set; } = 250;
    public string Hotkey { get; set; } = "Ctrl+Alt+A";
    public int MaxItems { get; set; } = 7;
    public string? WallpaperFolder { get; set; }
}

public sealed class SideSettings
{
    public bool OsdOnChange { get; set; } = true;
    public bool EdgeTrigger { get; set; } = true;
    public int DwellMs { get; set; } = 250;
    public string SessionHotkey { get; set; } = "Ctrl+Alt+End";
    public bool Dim { get; set; } = true;
}

public sealed class BarEntry
{
    public string Id { get; set; } = "";
    public bool Enabled { get; set; } = true;
}

// Caelestia's bar config (barconfig.hpp). The tray entry is left out: Windows exposes no API to list other apps' tray icons.
public sealed class BarSettings
{
    public string Position { get; set; } = "left";      // left | right
    public string Mode { get; set; } = "reserve";       // reserve (claims screen space like the taskbar) | autohide
    public List<BarEntry> Entries { get; set; } = DefaultEntries();
    public bool ShowSeconds { get; set; }
    public bool Popouts { get; set; } = true;
    public bool ScrollVolume { get; set; } = true;
    public bool ScrollBrightness { get; set; } = true;
    public bool ScrollWorkspaces { get; set; } = true;
    public bool ShowNetwork { get; set; } = true;
    public bool ShowBluetooth { get; set; } = true;
    public bool ShowBattery { get; set; } = true;
    public bool ShowAudio { get; set; } = true;
    public bool ShowMic { get; set; }
    public bool ShowKeyboard { get; set; }

    public static readonly string[] AllEntries = ["logo", "workspaces", "spacer", "activeWindow", "clock", "statusIcons", "power"];

    public static List<BarEntry> DefaultEntries() =>
        new[] { "logo", "workspaces", "spacer", "activeWindow", "spacer", "clock", "statusIcons", "power" }
            .Select(id => new BarEntry { Id = id }).ToList();
}

public sealed class MediaSettings
{
    public bool Visualiser { get; set; } = true;
}

public sealed class PerfSettings
{
    public int IntervalMs { get; set; } = 1000;
}

public sealed class Settings
{
    public GeneralSettings General { get; set; } = new();
    public AppearanceSettings Appearance { get; set; } = new();
    public IslandSettings Island { get; set; } = new();
    public LauncherSettings Launcher { get; set; } = new();
    public SideSettings Side { get; set; } = new();
    public BarSettings Bar { get; set; } = new();
    public MediaSettings Media { get; set; } = new();
    public PerfSettings Perf { get; set; } = new();
    public List<TodoItem> Todos { get; set; } = [];
}

// Everything persisted lives in one JSON file under %LocalAppData%\Hitodama.
public static class Store
{
    public static readonly string Folder =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Hitodama");
    static readonly string File_ = Path.Combine(Folder, "settings.json");

    public static Settings Data { get; } = Load();

    /// <summary>Raised after a save with the name of the section that changed ("General", "Island", …).</summary>
    public static event Action<string>? Changed;

    static Settings Load()
    {
        try { return JsonSerializer.Deserialize<Settings>(File.ReadAllText(File_)) ?? new(); }
        catch { return new(); }
    }

    public static void Save(string section = "")
    {
        Directory.CreateDirectory(Folder);
        var tmp = File_ + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(Data, new JsonSerializerOptions { WriteIndented = true }));
        File.Move(tmp, File_, overwrite: true); // atomic replace: a crash mid-write never eats settings
        if (section.Length > 0) Changed?.Invoke(section);
    }
}
