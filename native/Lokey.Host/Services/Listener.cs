using System.Speech.Recognition;
using System.Text.Json;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using Lokey.Host.Pipe;

namespace Lokey.Host.Services;

// Wake-up listening: Lokey wakes without a key. Two detectors, both entirely on this PC (the audio is analysed in memory, never
// stored, never sent anywhere):
//   * a double clap, found with a small energy-onset detector on the default microphone (ClapDetector below);
//   * spoken phrases ("hey lokey", "wake up buddy", "daddy's home"), recognised by the speech recogniser that ships with Windows
//     (System.Speech / SAPI) against a grammar of ONLY those phrases: no model download, no cloud, light on the CPU.
// `wake.set` turns each on or off; `wake.detected` events go to the app, which decides what to do. While the assistant is talking
// the app pauses detection so Lokey never wakes itself up.
internal static class Listener
{
    internal sealed record WakeEvent(string Kind, string? Phrase, double Confidence);

    static readonly object L = new();
    static SpeechRecognitionEngine? _sr;
    static WasapiCapture? _cap;
    static ClapDetector? _clap;
    static string[] _phrases = [];
    static double _conf = 0.82, _clapSens = 1;
    static bool _paused, _wantClaps;
    static string? _error, _recogniser;
    static long _lastPhraseAt;
    static readonly System.Diagnostics.Stopwatch Clock = System.Diagnostics.Stopwatch.StartNew();

    public static void Register()
    {
        Dispatcher.Add("wake.set", p => Set(p));
        Dispatcher.Add("wake.status", _ => Status());
    }

    public static void Shutdown() { lock (L) { StopSpeech(); StopClaps(); } }

    static object Status()
    {
        lock (L) return new { listening = _sr is not null || _cap is not null, speech = _sr is not null, claps = _cap is not null, recogniser = _recogniser, error = _error, available = InstalledEnglish() is not null };
    }

    static RecognizerInfo? InstalledEnglish()
    {
        try
        {
            var all = SpeechRecognitionEngine.InstalledRecognizers();
            return all.FirstOrDefault(r => r.Culture.Name.Equals("en-US", StringComparison.OrdinalIgnoreCase)) ?? all.FirstOrDefault(r => r.Culture.TwoLetterISOLanguageName == "en") ?? all.FirstOrDefault();
        }
        catch { return null; }
    }

    static object Set(JsonElement p)
    {
        lock (L)
        {
            _paused = Args.OptBool(p, "paused") ?? false;
            _conf = Math.Clamp(Args.OptNum(p, "confidence") ?? 0.82, 0.4, 0.98);
            _clapSens = Math.Clamp(Args.OptNum(p, "clapSensitivity") ?? 1, 0.4, 2.5);
            var phrases = new List<string>();
            if (p.TryGetProperty("phrases", out var arr) && arr.ValueKind == JsonValueKind.Array)
                foreach (var e in arr.EnumerateArray()) if (e.ValueKind == JsonValueKind.String && e.GetString() is { Length: > 1 and < 60 } s) phrases.Add(s.Trim());
            var claps = Args.OptBool(p, "claps") ?? false;
            if (_clap is not null) _clap.Sensitivity = _clapSens;
            if (!phrases.OrderBy(x => x).SequenceEqual(_phrases.OrderBy(x => x))) { _phrases = [.. phrases]; StopSpeech(); if (_phrases.Length > 0) StartSpeech(); }
            else if (_phrases.Length > 0 && _sr is null && _error is null) StartSpeech();
            if (claps && _cap is null) StartClaps();
            else if (!claps && _cap is not null) StopClaps();
            _wantClaps = claps;
        }
        return Status();
    }

    // ---------------- phrases ----------------
    static string Norm(string s) => new string(s.ToLowerInvariant().Replace('’', '\'').Where(c => char.IsLetterOrDigit(c) || c == ' ' || c == '\'').ToArray()).Trim();

    /// <summary>The spoken forms to listen for: a made-up word like "lokey" is also heard as "low key" or "loki".</summary>
    static IEnumerable<string> Variants(string phrase)
    {
        var n = Norm(phrase);
        yield return n;
        if (n.Contains("lokey")) { yield return n.Replace("lokey", "low key"); yield return n.Replace("lokey", "loki"); yield return n.Replace("lokey", "lockey"); }
        if (n.Contains("daddy's")) yield return n.Replace("daddy's", "daddy is");
    }

    static void StartSpeech()
    {
        try
        {
            var info = InstalledEnglish();
            if (info is null) { _error = "No English speech recogniser is installed (Windows Settings > Time & language > Speech)."; return; }
            var sr = new SpeechRecognitionEngine(info);
            var choices = new Choices();
            foreach (var ph in _phrases) foreach (var v in Variants(ph)) if (v.Length > 1) choices.Add(v);
            sr.LoadGrammar(new Grammar(new GrammarBuilder(choices) { Culture = info.Culture }) { Name = "wake" });
            sr.SpeechRecognized += OnSpeech;
            sr.SetInputToDefaultAudioDevice();
            sr.RecognizeAsync(RecognizeMode.Multiple);
            _sr = sr; _recogniser = info.Culture.Name; _error = null;
        }
        catch (Exception e) { _error = "Could not start phrase listening: " + e.Message; Log.Error("wake speech", e); StopSpeech(); }
    }

    static void StopSpeech()
    {
        var sr = _sr; _sr = null;
        if (sr is null) return;
        try { sr.SpeechRecognized -= OnSpeech; sr.RecognizeAsyncCancel(); sr.Dispose(); } catch { }
    }

    static void OnSpeech(object? s, SpeechRecognizedEventArgs e)
    {
        try
        {
            if (_paused || e.Result.Confidence < _conf) return;
            long now = Clock.ElapsedMilliseconds;
            if (now - _lastPhraseAt < 3500) return;
            var heard = Norm(e.Result.Text);
            var match = _phrases.FirstOrDefault(ph => Variants(ph).Contains(heard));
            if (match is null) return;
            _lastPhraseAt = now;
            Events.Emit("wake.detected", new WakeEvent("phrase", match, Math.Round(e.Result.Confidence, 2)));
        }
        catch (Exception ex) { Log.Error("wake phrase", ex); }
    }

    // ---------------- claps ----------------
    static void StartClaps()
    {
        try
        {
            var dev = new MMDeviceEnumerator().GetDefaultAudioEndpoint(DataFlow.Capture, Role.Console);
            var cap = new WasapiCapture(dev, true, 20);
            _clap = new ClapDetector { Sensitivity = _clapSens };
            cap.DataAvailable += OnAudio;
            cap.StartRecording();
            _cap = cap;
        }
        catch (Exception e) { _error = "Could not listen for claps: " + e.Message; Log.Error("wake claps", e); StopClaps(); }
    }

    static void StopClaps()
    {
        var c = _cap; _cap = null; _clap = null;
        if (c is null) return;
        c.DataAvailable -= OnAudio;
        try { c.StopRecording(); } catch { }
        try { c.Dispose(); } catch { }
    }

    static void OnAudio(object? sender, WaveInEventArgs e)
    {
        try
        {
            var fmt = ((WasapiCapture)sender!).WaveFormat;
            bool isFloat = fmt.Encoding == WaveFormatEncoding.IeeeFloat || (fmt is WaveFormatExtensible x && x.SubFormat == new Guid("00000003-0000-0010-8000-00aa00389b71"));
            int bytes = fmt.BitsPerSample / 8, channels = fmt.Channels;
            if (!(isFloat && bytes == 4) && bytes != 2) return;
            int frames = e.BytesRecorded / bytes / channels;
            if (frames == 0) return;
            double sum = 0, peak = 0;
            for (int f = 0; f < frames; f++)
            {
                double mono = 0;
                for (int ch = 0; ch < channels; ch++)
                {
                    int o = (f * channels + ch) * bytes;
                    mono += isFloat ? BitConverter.ToSingle(e.Buffer, o) : BitConverter.ToInt16(e.Buffer, o) / 32768.0;
                }
                mono /= channels;
                sum += mono * mono; peak = Math.Max(peak, Math.Abs(mono));
            }
            var det = _clap;
            if (det is null || _paused) return;
            if (det.Feed(Math.Sqrt(sum / frames), peak, Clock.ElapsedMilliseconds)) Events.Emit("wake.detected", new WakeEvent("clap", null, 1));
        }
        catch (Exception ex) { Log.Error("wake audio", ex); }
    }

    /// <summary>
    /// Two sharp claps 0.15 to 0.7 s apart. A clap is a sudden jump in loudness (each 20 ms frame is several times louder than the
    /// one before and clearly above the room's noise floor) that is gone again the very next frame; speech rises more slowly and a
    /// steady loud sound (music, a fan) never "ends", so neither counts.
    /// </summary>
    internal sealed class ClapDetector
    {
        public double Sensitivity = 1;
        double _floor = 0.01, _prevRms;
        long _lastOnset = -10_000, _firstClap = -1;
        double _pendingRms; long _pendingAt = -1;

        /// <summary>One frame of audio (about 20 ms): its RMS and peak (0..1) and the time in ms. True when the second clap is confirmed.</summary>
        public bool Feed(double rms, double peak, long t)
        {
            bool done = false;
            // confirm a candidate onset: the very next frame must be much quieter (a clap decays, a sustained sound does not)
            if (_pendingAt >= 0)
            {
                bool decayed = rms < _pendingRms * 0.55;
                long at = _pendingAt; _pendingAt = -1;
                if (decayed)
                {
                    if (_firstClap >= 0 && at - _firstClap >= 140 && at - _firstClap <= 700) { _firstClap = -1; done = true; }
                    else _firstClap = at;
                }
            }
            if (rms < _floor * 2.5) _floor += (rms - _floor) * 0.02;
            _floor = Math.Max(_floor, 0.002);
            double threshold = Math.Max(0.07, _floor * 10) / Math.Max(0.4, Sensitivity);
            if (peak > threshold && rms > _prevRms * 2.5 && t - _lastOnset > 90 && _pendingAt < 0 && !done) { _lastOnset = t; _pendingAt = t; _pendingRms = rms; }
            _prevRms = rms;
            if (_firstClap >= 0 && t - _firstClap > 700) _firstClap = -1;
            return done;
        }
    }

    /// <summary>--selftest: the clap detector on synthetic loudness (no microphone); the speech engine is only probed for being installed.</summary>
    public static string SelfCheck()
    {
        static void Need(bool c, string what) { if (!c) throw new Exception("wake: " + what); }
        // frames are 20 ms: 'quiet' = room noise, 'clap' = a loud frame followed by silence
        static int Run(Action<List<(double rms, double peak)>> build)
        {
            var f = new List<(double, double)>(); build(f);
            var d = new ClapDetector(); int n = 0; long t = 0;
            foreach (var (rms, peak) in f) { if (d.Feed(rms, peak, t)) n++; t += 20; }
            return n;
        }
        void Quiet(List<(double, double)> f, int frames) { for (int i = 0; i < frames; i++) f.Add((0.01 + 0.002 * (i % 3), 0.03)); }
        void Clap(List<(double, double)> f) { f.Add((0.35, 0.8)); f.Add((0.04, 0.1)); }
        Need(Run(f => { Quiet(f, 60); Clap(f); Quiet(f, 14); Clap(f); Quiet(f, 30); }) == 1, "two claps 0.3 s apart are one double clap");
        Need(Run(f => { Quiet(f, 60); Clap(f); Quiet(f, 60); }) == 0, "one clap is not enough");
        Need(Run(f => { Quiet(f, 60); Clap(f); Quiet(f, 60); Clap(f); Quiet(f, 30); }) == 0, "two claps seconds apart are not a double clap");
        Need(Run(f => { Quiet(f, 60); for (int i = 0; i < 25; i++) f.Add((0.3, 0.6)); Quiet(f, 30); }) == 0, "a steady loud sound is not a clap");
        Need(Run(f => { Quiet(f, 60); for (int i = 0; i < 12; i++) f.Add((0.02 + i * 0.03, 0.05 + i * 0.06)); Quiet(f, 40); for (int i = 0; i < 12; i++) f.Add((0.02 + i * 0.03, 0.05 + i * 0.06)); Quiet(f, 30); }) == 0, "speech-like slow rises are not claps");
        Need(Run(f => { Quiet(f, 60); Clap(f); Quiet(f, 14); Clap(f); Quiet(f, 14); Clap(f); Quiet(f, 30); }) == 1, "three claps in a row give one wake-up, not two");
        var rec = InstalledEnglish();
        return $"clap detector ok; speech recogniser: {(rec is null ? "none installed" : rec.Culture.Name)}";
    }
}
