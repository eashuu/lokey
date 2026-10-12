using Microsoft.UI.Dispatching;
using NAudio.CoreAudioApi;

namespace Hitodama.Shell.Services;

// Pipewire equivalent: Core Audio default render endpoint.
public static class Audio
{
    static MMDevice? _device, _mic;
    static DispatcherQueue _ui = null!;

    /// <summary>(level 0..1, muted), raised on the UI thread for any volume change system-wide.</summary>
    public static event Action<double, bool>? Changed;

    public static void Init(DispatcherQueue ui)
    {
        _ui = ui;
        try
        {
            // ponytail: default device captured once; add IMMNotificationClient if output switching matters.
            _device = new MMDeviceEnumerator().GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
            _device.AudioEndpointVolume.OnVolumeNotification += d => _ui.TryEnqueue(() => Changed?.Invoke(d.MasterVolume, d.Muted));
        }
        catch { _device = null; }
        try { _mic = new MMDeviceEnumerator().GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications); }
        catch { _mic = null; }
    }

    public static bool MicAvailable => _mic is not null;

    public static double MicLevel
    {
        get => _mic?.AudioEndpointVolume.MasterVolumeLevelScalar ?? 0;
        set { if (_mic is not null) _mic.AudioEndpointVolume.MasterVolumeLevelScalar = (float)Math.Clamp(value, 0, 1); }
    }

    public static bool MicMuted
    {
        get => _mic?.AudioEndpointVolume.Mute ?? true;
        set { if (_mic is not null) _mic.AudioEndpointVolume.Mute = value; }
    }

    public static bool Available => _device is not null;

    public static string DeviceName => _device?.FriendlyName ?? "No output device";

    public static double Level
    {
        get => _device?.AudioEndpointVolume.MasterVolumeLevelScalar ?? 0;
        set { if (_device is not null) _device.AudioEndpointVolume.MasterVolumeLevelScalar = (float)Math.Clamp(value, 0, 1); }
    }

    public static bool Muted
    {
        get => _device?.AudioEndpointVolume.Mute ?? false;
        set { if (_device is not null) _device.AudioEndpointVolume.Mute = value; }
    }
}
