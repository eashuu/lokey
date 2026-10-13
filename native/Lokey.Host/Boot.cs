using Lokey.Host.Native;
using Lokey.Host.Services;

namespace Lokey.Host;

// Registers every method and starts the services. A service that fails to start is logged and left idle; it never takes the host down.
internal static class Boot
{
    public static void RegisterAll()
    {
        Power.Register();        // sys.*, power.do
        Display.Register();
        User.Register();
        Hotkeys.Register();
        Media.Register();
        Audio.Register();
        Wifi.Register();
        Bluetooth.Register();
        Stats.Register();
        Status.Register();
        SystemControls.Register();
        NightLight.Register();
        Apps.Register();
        Clipboard.Register();
        Wallpaper.Register();
        Desktops.Register();
        Foreground.Register();
    }

    static async Task Step(string name, Func<Task> f)
    {
        try { await f(); } catch (Exception e) { Log.Error("start " + name, e); }
    }
    static Task Step(string name, Action a) => Step(name, () => { a(); return Task.CompletedTask; });

    public static async Task StartAsync()
    {
        await Task.Yield();
        Pump.Start();
        await Step("foreground", Foreground.Start);
        await Task.WhenAll(
            Step("fullscreen", Foreground.AttachAppBarAsync),
            Step("hotkeys", Hotkeys.Init),
            Step("display", Display.Init),
            Step("wallpaper", Wallpaper.Init),
            Step("audio", Audio.Init),
            Step("apps", Apps.Init),
            Step("clipboard", Clipboard.InitAsync),
            Step("desktops", Desktops.InitAsync),
            Step("media", Media.InitAsync),
            Step("status", Status.InitAsync));
        Log.Info("services started");
    }

    public static void Shutdown()
    {
        try { Hotkeys.Shutdown(); } catch { }
        try { Visualiser.Set(false); } catch { }
        try { Foreground.Shutdown(); } catch { }
        try { Desktops.Shutdown(); } catch { }
        try { Clipboard.Shutdown(); } catch { }
    }
}
