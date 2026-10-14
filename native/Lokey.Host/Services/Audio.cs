using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;
using System.Runtime.InteropServices;
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
        Dispatcher.Add("audio.devices", _ => Devices());
        Dispatcher.Add("audio.setDefault", p => { SetDefault(Args.Str(p, "id")); return Dispatcher.Ok; });
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
        MMDevice? oldOut, oldMic;
        lock (L)
        {
            oldOut = _out; oldMic = _mic; _out = _mic = null;
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
        // outside L: unsubscribing waits for an in-flight OnVol callback, which takes L
        try { if (oldOut is not null) { oldOut.AudioEndpointVolume.OnVolumeNotification -= OnVol; oldOut.Dispose(); } } catch { }
        try { if (oldMic is not null) { oldMic.AudioEndpointVolume.OnVolumeNotification -= OnVol; oldMic.Dispose(); } } catch { }
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

    static readonly Debounce ListDeb = new(250, () => Events.Emit("audio.devices.changed", Dispatcher.Ok));

    // Active render + capture endpoints; isDefault = default for the Multimedia role.
    static AudioDevice[] Devices()
    {
        using var e = new MMDeviceEnumerator();
        List<AudioDevice> res = [];
        foreach (var (flow, kind) in new[] { (DataFlow.Render, "output"), (DataFlow.Capture, "input") })
        {
            string? def = null;
            try { using var d = e.GetDefaultAudioEndpoint(flow, Role.Multimedia); def = d.ID; } catch { }
            foreach (var d in e.EnumerateAudioEndPoints(flow, DeviceState.Active))
                using (d) res.Add(new(d.ID, d.FriendlyName, kind, d.ID == def));
        }
        return res.ToArray();
    }

    // ponytail: undocumented IPolicyConfig (what every "switch audio device" tool uses); may break across Windows builds.
    static void SetDefault(string id)
    {
        try
        {
            var pc = (IPolicyConfig)new PolicyConfigClient();
            try { foreach (var role in new[] { Role.Console, Role.Multimedia, Role.Communications }) Marshal.ThrowExceptionForHR(pc.SetDefaultEndpoint(id, role)); }
            finally { Marshal.ReleaseComObject(pc); }
        }
        catch (Exception e) { Log.Error("audio setDefault", e); throw new InvalidOperationException("could not set the default audio device: " + e.Message); }
    }

    [ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")] class PolicyConfigClient { }

    [ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPolicyConfig
    {
        [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string id, out IntPtr format);
        [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, int def, out IntPtr format);
        [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id);
        [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr endpointFormat, IntPtr mixFormat);
        [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, int def, out long defPeriod, out long minPeriod);
        [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr period);
        [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
        [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
        [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, int bFx, IntPtr key, IntPtr value);
        [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, int bFx, IntPtr key, IntPtr value);
        [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, Role role);
        [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string id, int visible);
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
            ListDeb.Poke();
            if (role != Role.Multimedia && role != Role.Communications) return;
            // Must not call back into the enumerator from this callback thread.
            Task.Run(() => { try { Acquire(); Changed(); if (flow == DataFlow.Render) DefaultOutputChanged?.Invoke(); } catch (Exception e) { Log.Error("audio default change", e); } });
        }
        public void OnDeviceStateChanged(string id, DeviceState s) => ListDeb.Poke();
        public void OnDeviceAdded(string id) => ListDeb.Poke();
        public void OnDeviceRemoved(string id) => ListDeb.Poke();
        public void OnPropertyValueChanged(string id, PropertyKey key) { }
    }
}
