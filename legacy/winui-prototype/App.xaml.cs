using System.Diagnostics;
using Hitodama.Shell.Services;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;

namespace Hitodama.Shell;

// Coordinator: owns the enabled surfaces, the hidden message window (hotkeys, wallpaper, fullscreen),
// and rebuilds whatever a settings change affects. Disabled surfaces are never created.
public partial class App : Application
{
    const int HotkeyIsland = 1, HotkeyLauncher = 2, HotkeySession = 3;

    public static IslandWindow? Island { get; private set; }
    public static LauncherWindow? Launcher { get; private set; }
    public static SideWindow? Side { get; private set; }
    public static BarWindow? Bar { get; private set; }
    public static MessageWindow Messages => _messages;
    static SettingsWindow? _settings;
    static MessageWindow _messages = null!;
    static DispatcherQueue _ui = null!;
    static Mutex? _instance;
    static DispatcherQueueTimer _appBarTimer = null!;
    static Windows.Graphics.RectInt32 _lastWork;

    public App()
    {
        InitializeComponent();
        DispatcherShutdownMode = DispatcherShutdownMode.OnExplicitShutdown;
        UnhandledException += (_, e) =>
        {
            try
            {
                Directory.CreateDirectory(Store.Folder);
                File.AppendAllText(Path.Combine(Store.Folder, "crash.log"), $"{DateTime.Now:u} {e.Exception}\n\n");
            }
            catch { }
        };
    }

    public static T Res<T>(string key) => (T)Current.Resources[key];

    protected override void OnLaunched(LaunchActivatedEventArgs launch)
    {
        // Single instance: launching again opens Settings in the running copy.
        _instance = new Mutex(true, "Hitodama.Shell.Instance", out bool first);
        if (!first)
        {
            var other = Native.FindWindow(MessageWindow.ClassName, null);
            if (other != IntPtr.Zero) Native.PostMessage(other, MessageWindow.WM_SHOW_SETTINGS, 0, 0);
            Exit();
            return;
        }

        _ui = DispatcherQueue.GetForCurrentThread();
        Tokens.Init();
        Theme.Apply();

        _messages = new MessageWindow();
        _messages.Hotkey += id => _ui.TryEnqueue(() => OnHotkey(id));
        _messages.WallpaperChanged += () => _ui.TryEnqueue(async () => await Theme.FromCurrentWallpaperAsync());
        _messages.DisplayChanged += () => _ui.TryEnqueue(Restart);
        _messages.FullscreenNotice += () => _ui.TryEnqueue(CheckFullscreen);
        _messages.AppBarChanged += () => _ui.TryEnqueue(() => { _appBarTimer.Stop(); _appBarTimer.Start(); });
        _appBarTimer = _ui.CreateTimer();
        _appBarTimer.Interval = TimeSpan.FromMilliseconds(500);
        _appBarTimer.IsRepeating = false;
        _appBarTimer.Tick += (_, _) => { if (DisplayArea.Primary.WorkArea.Equals(_lastWork) is false) BuildSurfaces(); }; // taskbar moved or resized
        Foreground.Init(_ui);
        Foreground.Changed += CheckFullscreen; // also catches leaving fullscreen, which sends no notice
        _messages.ShowSettings += () => _ui.TryEnqueue(OpenSettings);

        _ = Media.InitAsync(_ui);
        Audio.Init(_ui);
        Audio.Changed += OnVolume;
        Store.Changed += section => _ui.TryEnqueue(() => OnSettingsChanged(section));

        BuildSurfaces();
        RegisterHotkeys();
        _ = Theme.FromCurrentWallpaperAsync();
        HandleArgs(Environment.GetCommandLineArgs());
    }

    static void BuildSurfaces(string? only = null)
    {
        var g = Store.Data.General;
        // The bar goes first: reserving its strip shrinks the work area, which the other surfaces position against.
        if (only is null or "Bar")
        {
            Bar?.Release();
            Bar?.Close();
            Bar = g.Bar ? new BarWindow() : null;
            Bar?.AppWindow.Show(false);
        }
        if (only is null or "Island") { Island?.Close(); Island = g.Island ? new IslandWindow() : null; Island?.Activate(); }
        if (only is null or "Launcher") { Launcher?.Close(); Launcher = g.Launcher ? new LauncherWindow() : null; Launcher?.Activate(); }
        if (only is null or "Side") { Side?.Close(); Side = g.Side ? new SideWindow() : null; Side?.Activate(); }
        _lastWork = DisplayArea.Primary.WorkArea;
    }

    // The appbar notice cannot tell the desktop from a fullscreen app, so every trigger re-asks the window itself.
    static void CheckFullscreen()
    {
        bool full = Native.IsRealFullscreen();
        Island?.Surface.SetHidden(full);
        Launcher?.Surface.SetHidden(full);
        Side?.Surface.SetHidden(full);
        Bar?.SetHidden(full);
    }

    /// <summary>Rebuild every surface from the current settings (the self-test switches bar modes this way).</summary>
    public static void Rebuild()
    {
        BuildSurfaces();
        RegisterHotkeys();
    }

    static void RegisterHotkeys()
    {
        _messages.UnregisterAll();
        if (Island is not null) _messages.Register(HotkeyIsland, Store.Data.Island.Hotkey);
        if (Launcher is not null) _messages.Register(HotkeyLauncher, Store.Data.Launcher.Hotkey);
        _messages.Register(HotkeySession, Store.Data.Side.SessionHotkey);
    }

    static void OnHotkey(int id)
    {
        switch (id)
        {
            case HotkeyIsland: Island?.Toggle(); break;
            case HotkeyLauncher: Launcher?.Toggle(); break;
            case HotkeySession: ShowSession(); break;
        }
    }

    static void OnVolume(double level, bool muted)
    {
        string glyph = muted ? "volume_off" : "volume_up", value = muted ? "Muted" : $"{Math.Round(level * 100)}";
        if (Side is not null && Store.Data.Side.OsdOnChange) Side.ShowOsd();
        else Island?.ShowPeek(glyph, "Volume", null, muted ? 0 : level, value, null);
    }

    static void OnSettingsChanged(string section)
    {
        switch (section)
        {
            case "General":
                BuildSurfaces();
                RegisterHotkeys();
                StartWithWindows(Store.Data.General.StartWithWindows);
                break;
            case "Appearance":
                Theme.Apply();
                break;
            case "Scale":
                Restart(); // token-sized styles are sealed once used, so a new scale needs a fresh process
                break;
            case "Bar":
                BuildSurfaces(); // the strip it reserves moves every other surface
                RegisterHotkeys();
                break;
            case "Island" or "Launcher" or "Side":
                BuildSurfaces(section);
                RegisterHotkeys();
                break;
        }
    }

    public static void ShowSession()
    {
        if (Side is not null) Side.ShowSession();
        else Launcher?.Open(">");
    }

    public static void OpenSettings()
    {
        if (_settings is null)
        {
            _settings = new SettingsWindow();
            _settings.Closed += (_, _) => _settings = null;
        }
        _settings.Activate();
    }

    static void HandleArgs(string[] args)
    {
        for (int i = 1; i < args.Length; i++)
        {
            string next = i + 1 < args.Length ? args[i + 1] : "";
            switch (args[i])
            {
                case "--settings": OpenSettings(); break;
                case "--open":
                    var parts = next.Split(':');
                    _ui.TryEnqueue(DispatcherQueuePriority.Low, () =>
                    {
                        switch (parts[0])
                        {
                            case "island": if (parts.Length > 1) Island?.Open(parts[1]); else Island?.Open(); break;
                            case "launcher": Launcher?.Open(parts.Length > 1 ? parts[1] : ""); break;
                            case "side": Side?.ShowOsd(keepOpen: true); break;
                            case "session": ShowSession(); break;
                        }
                    });
                    i++;
                    break;
                case "--selftest":
                    var dir = next.Length > 0 && !next.StartsWith("--") ? next : Path.Combine(Store.Folder, "selftest");
                    _ui.TryEnqueue(DispatcherQueuePriority.Low, async () => await SelfTest.RunAsync(dir));
                    i++;
                    break;
            }
        }
    }

    static void StartWithWindows(bool on)
    {
        using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true);
        if (key is null) return;
        if (on) key.SetValue("Hitodama", $"\"{Environment.ProcessPath}\"");
        else key.DeleteValue("Hitodama", false);
    }

    public static void Restart()
    {
        Release(); // let the new instance win the single-instance mutex
        Process.Start(new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = true });
        Current.Exit();
    }

    public static void Quit()
    {
        Release();
        Current.Exit();
    }

    static void Release()
    {
        Bar?.Release();
        Desktops.Shutdown();
        Foreground.Shutdown();
        _messages.Dispose();
        _instance?.ReleaseMutex();
        _instance?.Dispose();
        _instance = null;
    }
}
