using System.Text.Json.Serialization;

namespace Lokey.Host;

// Mirrors app/src/shared/protocol.ts. Property names are camelCased by Json.O.
internal sealed record Rect(int X, int Y, int W, int H);
internal sealed record DisplayInfo(Rect Bounds, Rect Work, int Dpi);

internal sealed record SessionInfo(string Id, string App, bool Playing);
internal sealed record MediaState(
    bool HasSession, string App, string Title, string Artist, string Album, bool Playing,
    long PositionMs, long DurationMs, long SampledAt, string? Art, bool CanNext, bool CanPrev,
    SessionInfo[] Sessions, string? CurrentSession);

internal sealed record AudioState(double Volume, bool Muted, string Device, bool MicMuted);
internal sealed record AudioDevice(string Id, string Name, string Kind, bool IsDefault);
internal sealed record BandsEvent(float[] Bands);

internal sealed record CpuStat(double Pct, string Name, double Ghz, int Processes, double? TempC);
internal sealed record GpuStat(double Pct, string Name, long VramUsed, long VramTotal);
internal sealed record RamStat(long Used, long Total);
internal sealed record DiskStat(string Letter, long Used, long Total);
internal sealed record NetStat(long Down, long Up);
internal sealed record TopProc(string Name, long RamBytes, double CpuPct);
internal sealed record StatsTick(CpuStat Cpu, GpuStat? Gpu, RamStat Ram, DiskStat Disk, NetStat Net, long UptimeSec, TopProc[] Top);

internal sealed record NetworkStat(string Kind, string Name, int? Signal);
internal sealed record BluetoothStat(bool Available, bool On);
internal sealed record BatteryStat(bool Present, int Pct, bool Charging, int? MinutesLeft);
internal sealed record SystemStatus(NetworkStat Network, BluetoothStat Bluetooth, BatteryStat Battery, string Keyboard, bool KeepAwake, double? Brightness, bool DarkMode, bool? NightLight);

internal sealed record UserInfo(string Name, string? Avatar, string Machine);
internal sealed record AppEntry(string Id, string Name, string Kind, bool Starred, long? LastUsed);
internal sealed record ClipFull(string Id, string? Text, string? Image);
internal sealed record ClipItem(string Id, string Kind, string Preview, string? Image, string Source, long At, bool Pinned, long Size);
internal sealed record WallpaperItem(string Path, string Name, string? Thumb);
internal sealed record DesktopsState(int Count, int Current, bool[] Occupied);
internal sealed record ForegroundInfo(string Title, string Exe, int Pid);

internal sealed record HelloResult(int Version, string Host);
internal sealed record HotkeyResult(bool Ok, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Reason = null);
internal sealed record IdEvent(int Id);
/// <summary>hotkey.up: `Cancelled` = another key ended the chord (Esc, typing) rather than the user letting go.</summary>
internal sealed record UpEvent(int Id, bool Cancelled);
internal sealed record FullEvent(bool Full);
internal sealed record PathResult(string? Path);
internal sealed record ThumbResult(string? Thumb);
internal sealed record IconResult(string? Icon);
internal sealed record FileHit(string Name, string Path);
internal sealed record ClipEvent(ClipItem Item);

internal sealed record WifiNetwork(string Ssid, int Signal, bool Secured, bool Connected, bool Known);
internal sealed record WifiConnected(string Ssid, int Signal);
internal sealed record WifiState(bool Available, bool On, WifiConnected? Connected, bool AccessDenied);
internal sealed record BtDevice(string Id, string Name, string Kind, bool Paired, bool Connected, int? Battery);
internal sealed record BtState(bool Available, bool On);
internal sealed record OkResult(bool Ok, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Reason = null);
