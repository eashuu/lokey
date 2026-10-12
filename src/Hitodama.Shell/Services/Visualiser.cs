using NAudio.Dsp;
using NAudio.Wave;

namespace Hitodama.Shell.Services;

// Caelestia's cava equivalent: WASAPI loopback of whatever is playing, FFT into log-spaced bins.
// Runs only while the Media page is visible and something plays; Stop() releases the device.
public sealed class Visualiser : IDisposable
{
    const int FftSize = 1024, FftLog2 = 10;
    readonly float[] _bins;
    readonly float[] _window = new float[FftSize];
    readonly Complex[] _fft = new Complex[FftSize];
    int _filled;
    WasapiLoopbackCapture? _capture;

    public Visualiser(int bins) => _bins = new float[bins];

    /// <summary>Latest smoothed levels 0..1 (read from the UI thread; races only cost a stale frame).</summary>
    public float[] Levels => _bins;

    public void Start()
    {
        if (_capture is not null) return;
        try
        {
            _capture = new WasapiLoopbackCapture();
            _capture.DataAvailable += OnData;
            _capture.StartRecording();
        }
        catch { _capture = null; }
    }

    public void Stop()
    {
        var c = _capture;
        _capture = null;
        if (c is null) return;
        c.DataAvailable -= OnData;
        try { c.StopRecording(); } catch { }
        c.Dispose();
        Array.Clear(_bins);
    }

    void OnData(object? sender, WaveInEventArgs e)
    {
        var fmt = ((WasapiLoopbackCapture)sender!).WaveFormat;
        if (fmt.Encoding != WaveFormatEncoding.IeeeFloat) return;
        int channels = fmt.Channels, frames = e.BytesRecorded / 4 / channels;
        for (int f = 0; f < frames; f++)
        {
            float mono = 0;
            for (int ch = 0; ch < channels; ch++) mono += BitConverter.ToSingle(e.Buffer, (f * channels + ch) * 4);
            _window[_filled++] = mono / channels;
            if (_filled == FftSize) { Analyse(fmt.SampleRate); _filled = 0; }
        }
    }

    void Analyse(int rate)
    {
        for (int i = 0; i < FftSize; i++)
        {
            _fft[i].X = (float)(_window[i] * FastFourierTransform.HannWindow(i, FftSize));
            _fft[i].Y = 0;
        }
        FastFourierTransform.FFT(true, FftLog2, _fft);
        // Log-spaced bands 50 Hz .. 12 kHz.
        double lo = Math.Log(50), hi = Math.Log(12000);
        for (int b = 0; b < _bins.Length; b++)
        {
            int a = (int)(Math.Exp(lo + (hi - lo) * b / _bins.Length) * FftSize / rate);
            int z = Math.Max(a + 1, (int)(Math.Exp(lo + (hi - lo) * (b + 1) / _bins.Length) * FftSize / rate));
            double sum = 0;
            for (int k = a; k < z && k < FftSize / 2; k++) sum += Math.Sqrt(_fft[k].X * _fft[k].X + _fft[k].Y * _fft[k].Y);
            float level = (float)Math.Clamp(Math.Log10(1 + sum / (z - a) * 900) / 2.2, 0, 1);
            _bins[b] = level > _bins[b] ? level : _bins[b] * 0.82f + level * 0.18f; // fast attack, slow decay
        }
    }

    public void Dispose() => Stop();
}
