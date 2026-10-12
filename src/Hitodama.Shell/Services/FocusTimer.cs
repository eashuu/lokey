using Microsoft.UI.Dispatching;

namespace Hitodama.Shell.Services;

public static class FocusTimer
{
    static DateTime _end;
    static TimeSpan _left = TimeSpan.FromMinutes(5);
    static DispatcherQueueTimer? _done;

    public static TimeSpan Length { get; private set; } = TimeSpan.FromMinutes(5);
    public static bool Running { get; private set; }
    public static TimeSpan Remaining => Running ? Clamp(_end - DateTime.Now) : _left;

    /// <summary>Raised on the UI thread.</summary>
    public static event Action? Finished;

    public static void SetLength(TimeSpan t) { Reset(); Length = _left = t; }

    public static void Start()
    {
        if (Running || _left <= TimeSpan.Zero) return;
        Running = true;
        _end = DateTime.Now + _left;
        _done ??= CreateTimer();
        _done.Interval = _left;
        _done.Start();
    }

    public static void Pause()
    {
        if (!Running) return;
        _left = Remaining;
        Running = false;
        _done?.Stop();
    }

    public static void Reset()
    {
        _done?.Stop();
        Running = false;
        _left = Length;
    }

    static DispatcherQueueTimer CreateTimer()
    {
        var t = DispatcherQueue.GetForCurrentThread().CreateTimer();
        t.IsRepeating = false;
        t.Tick += (_, _) =>
        {
            Running = false;
            _left = TimeSpan.Zero;
            Native.MessageBeep(0x40);
            Finished?.Invoke();
        };
        return t;
    }

    static TimeSpan Clamp(TimeSpan t) => t < TimeSpan.Zero ? TimeSpan.Zero : t;
}
