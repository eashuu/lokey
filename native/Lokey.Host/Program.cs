using Lokey.Host.Pipe;

namespace Lokey.Host;

internal static class Program
{
    static async Task<int> Main(string[] args)
    {
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Log.Info("UNHANDLED: " + (e.ExceptionObject as Exception)?.GetType().Name + ": " + (e.ExceptionObject as Exception)?.Message);
        TaskScheduler.UnobservedTaskException += (_, e) => { Log.Error("unobserved task", e.Exception); e.SetObserved(); };

        // pure mode: compact a recorded UI Automation fixture and print it. Touches no window, no UI Automation, no service.
        int fx = Array.IndexOf(args, "--uia-fixture");
        if (fx >= 0 && fx + 1 < args.Length) { Console.WriteLine(Lokey.Host.Services.Uia.FixtureFile(args[fx + 1])); return 0; }

        bool selftest = args.Contains("--selftest");
        int i = Array.IndexOf(args, "--pipe");
        string? pipe = i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
        if (!selftest && pipe is null)
        {
            Console.Error.WriteLine("usage: Lokey.Host.exe --pipe <name> | --selftest");
            return 2;
        }

        Log.Info(selftest ? "start (selftest)" : "start");
        Boot.RegisterAll();
        if (selftest) return await SelfTest.Run();
        return await Server.Run(pipe!);
    }
}
