using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;
using Lokey.Host.Pipe;

namespace Lokey.Host.Services;

// Core Audio: default render endpoint (volume/mute/name) and default capture endpoint (mic mute). Event driven.
internal static class Audio
{
    static readonly object L = new();
    static MMDeviceEnumerator? _enum;
    static MMDevice? _out, _mic;
    static string _outName = "No output device";
    static string _last = "";
    static NotifClient? _client;

    /// <summary>Default render device was replaced (the visualiser re-opens its loopback capture).</summary>
    public static event Action? DefaultOutputChanged;

    public static void Register()
    {
        Dispatcher.Add("audio.get", _ => Get());
        Dispatcher.Add("audio.setVolume", p => { Set(d => d.AudioEndpointVolume.MasterVolumeLevelScalar = (float)Math.Clamp(Args.Num(p, "level"), 0, 1), render: true); return Dispatcher.Ok; });
        Dispatcher.Add("audio.setMuted", p => { Set(d => d.AudioEndpointVolume.Mute = Args.Bool(p, "muted"), render: true); return Dispatcher.Ok; });
        Dispatcher.Add("audio.setMicMuted", p => { Set(d => d.AudioEndpointVolume.Mute = Args.Bool(p, "muted"), render: false); return Dispatcher.Ok; });
        Dispatcher.Add("audio.visualiser", p => { Visualiser.Set(Args.Bool(p, "on")); return Dispatcher.Ok; });
    }

    public static void Init()
    {
        _enum = new MMDeviceEnumerator();
        Acquire();
        _client = new NotifClient();
        _enum.RegisterEndpointNotificationCallback(_client);
    }

    static void Acquire()
    {
        lock (L)
        {
            Release();
            try
            {
                _out = _enum!.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
                _outName = _out.FriendlyName;
                _out.AudioEndpointVolume.OnVolumeNotification += OnVol;
            }
            catch { _out = null; _outName = "No output device"; }
            try
            {
                _mic = _enum!.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications);
                _mic.AudioEndpointVolume.OnVolumeNotification += OnVol;
            }
            catch { _mic = null; }
        }
    }

    static void Release()
    {
        try { if (_out is not null) { _out.AudioEndpointVolume.OnVolumeNotification -= OnVol; _out.Dispose(); } } catch { }
        try { if (_mic is not null) { _mic.AudioEndpointVolume.OnVolumeNotification -= OnVol; _mic.Dispose(); } } catch { }
        _out = _mic = null;
    }

    public static AudioState Get()
    {
        lock (L)
        {
            double vol = 0; bool muted = false, micMuted = false;
            try { if (_out is not null) { vol = Math.Round(_out.AudioEndpointVolume.MasterVolumeLevelScalar, 3); muted = _out.AudioEndpointVolume.Mute; } } catch { }
            try { if (_mic is not null) micMuted = _mic.AudioEndpointVolume.Mute; } catch { }
            return new AudioState(vol, muted, _outName, micMuted);
        }
    }

    static void Set(Action<MMDevice> a, bool render)
    {
        lock (L)
        {
            var d = render ? _out : _mic;
            if (d is null) return; // nothing to control on this machine
            a(d);
        }
    }

    static void OnVol(AudioVolumeNotificationData _) => Changed();

    static void Changed()
    {
        var s = Get();
        var key = $"{s.Volume}|{s.Muted}|{s.Device}|{s.MicMuted}";
        lock (L) { if (key == _last) return; _last = key; }
        Events.Emit("audio.changed", s);
    }

    sealed class NotifClient : IMMNotificationClient
    {
        public void OnDefaultDeviceChanged(DataFlow flow, Role role, string id)
        {
            if (role != Role.Multimedia && role != Role.Communications) return;
            // Must not call back into the enumerator from this callback thread.
            Task.Run(() => { try { Acquire(); Changed(); if (flow == DataFlow.Render) DefaultOutputChanged?.Invoke(); } catch (Exception e) { Log.Error("audio default change", e); } });
        }
        public void OnDeviceStateChanged(string id, DeviceState s) { }
        public void OnDeviceAdded(string id) { }
        public void OnDeviceRemoved(string id) { }
        public void OnPropertyValueChanged(string id, PropertyKey key) { }
    }
}
