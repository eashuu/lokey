using NAudio.Dsp;
using NAudio.Wave;
using Lokey.Host.Pipe;

namespace Lokey.Host.Services;

// WASAPI loopback of whatever is playing -> FFT -> 32 log-spaced bands (50 Hz .. 12 kHz), emitted ~30 Hz.
// Nothing exists (no capture, no timer) unless audio.visualiser {on:true} is active.
internal static class Visualiser
{
    const int FftSize = 1024, FftLog2 = 10, Bands = 32;
    static readonly object L = new();
    static readonly float[] Bins = new float[Bands];
    static readonly float[] Window = new float[FftSize];
    static readonly Complex[] Fft = new Complex[FftSize];
    static int _filled;
    static volatile bool _gotData, _wasLoud;
    static WasapiLoopbackCapture? _capture;
    static Timer? _timer;
    static bool _on;

    public static void Set(bool on)
    {
        lock (L)
        {
            if (on == _on) return;
            _on = on;
            if (on)
            {
                Audio.DefaultOutputChanged += Restart;
                StartCapture();
                _timer = new Timer(_ => Tick(), null, 33, 33);
            }
            else
            {
                Audio.DefaultOutputChanged -= Restart;
                _timer?.Dispose(); _timer = null;
                StopCapture();
                Array.Clear(Bins);
                _wasLoud = false;
            }
        }
    }

    static void Restart() { lock (L) { if (!_on) return; StopCapture(); StartCapture(); } }

    static void StartCapture()
    {
        try
        {
            _filled = 0;
            _capture = new WasapiLoopbackCapture();
            _capture.DataAvailable += OnData;
            _capture.StartRecording();
        }
        catch (Exception e) { Log.Error("visualiser capture", e); _capture = null; } // no render device: stays silent
    }

    static void StopCapture()
    {
        var c = _capture; _capture = null;
        if (c is null) return;
        c.DataAvailable -= OnData;
        try { c.StopRecording(); } catch { }
        try { c.Dispose(); } catch { }
    }

    static void Tick()
    {
        try
        {
            if (!_gotData) for (int i = 0; i < Bands; i++) Bins[i] *= 0.85f; // loopback delivers nothing in silence: decay by hand
            _gotData = false;
            float max = 0;
            var o = new float[Bands];
            for (int i = 0; i < Bands; i++) { if (Bins[i] < 0.002f) Bins[i] = 0; o[i] = MathF.Round(Bins[i], 3); max = Math.Max(max, o[i]); }
            if (max > 0 || _wasLoud) Events.Emit("audio.bands", new BandsEvent(o));
            _wasLoud = max > 0;
        }
        catch (Exception e) { Log.Error("visualiser tick", e); }
    }

    static void OnData(object? sender, WaveInEventArgs e)
    {
        try
        {
            var fmt = ((WasapiLoopbackCapture)sender!).WaveFormat;
            bool isFloat = fmt.Encoding == WaveFormatEncoding.IeeeFloat || (fmt is WaveFormatExtensible x && x.SubFormat == new Guid("00000003-0000-0010-8000-00aa00389b71"));
            int bytes = fmt.BitsPerSample / 8, channels = fmt.Channels;
            if (!(isFloat && bytes == 4) && !(bytes == 2)) return;
            int frames = e.BytesRecorded / bytes / channels;
            for (int f = 0; f < frames; f++)
            {
                float mono = 0;
                for (int ch = 0; ch < channels; ch++)
                {
                    int o = (f * channels + ch) * bytes;
                    mono += isFloat ? BitConverter.ToSingle(e.Buffer, o) : BitConverter.ToInt16(e.Buffer, o) / 32768f;
                }
                Window[_filled++] = mono / channels;
                if (_filled == FftSize) { Analyse(fmt.SampleRate); _filled = 0; }
            }
        }
        catch (Exception ex) { Log.Error("visualiser data", ex); }
    }

    static void Analyse(int rate)
    {
        for (int i = 0; i < FftSize; i++) { Fft[i].X = (float)(Window[i] * FastFourierTransform.HannWindow(i, FftSize)); Fft[i].Y = 0; }
        FastFourierTransform.FFT(true, FftLog2, Fft);
        double lo = Math.Log(50), hi = Math.Log(12000);
        for (int b = 0; b < Bands; b++)
        {
            int a = (int)(Math.Exp(lo + (hi - lo) * b / Bands) * FftSize / rate);
            int z = Math.Max(a + 1, (int)(Math.Exp(lo + (hi - lo) * (b + 1) / Bands) * FftSize / rate));
            double sum = 0;
            for (int k = a; k < z && k < FftSize / 2; k++) sum += Math.Sqrt(Fft[k].X * Fft[k].X + Fft[k].Y * Fft[k].Y);
            float level = (float)Math.Clamp(Math.Log10(1 + sum / (z - a) * 900) / 2.2, 0, 1);
            Bins[b] = level > Bins[b] ? level : Bins[b] * 0.82f + level * 0.18f; // fast attack, slow decay
        }
        _gotData = true;
    }

    /// <summary>--selftest: push a synthetic 1 kHz sine through the FFT/band mapping (the loopback itself delivers nothing in silence).</summary>
    public static string SelfCheck()
    {
        int arg; float max;
        lock (L)
        {
            Array.Clear(Bins);
            for (int n = 0; n < FftSize; n++) Window[n] = (float)(0.5 * Math.Sin(2 * Math.PI * 1000 * n / 48000.0));
            Analyse(48000);
            arg = Array.IndexOf(Bins, Bins.Max());
            max = Bins[arg];
            Array.Clear(Bins);
            _gotData = false;
        }
        if (arg < 16 || arg > 18 || max < 0.3f) throw new Exception($"visualiser: 1 kHz landed in band {arg} at level {max:0.00}");
        return $"1 kHz sine -> band {arg} of 32, level {max:0.00}";
    }
}
