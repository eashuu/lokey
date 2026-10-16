using System.Runtime.InteropServices;
using System.Text.Json;
using Lokey.Host.Native;
using Lokey.Host.Pipe;

namespace Lokey.Host.Services;

// UI Automation for computer use (round-9 plan 3.9): the model is given the NUMBERED interactive elements of the window in front, not
// just a picture, and acts on an element by its number.
//   ui.tree  -> { snapshot, app, title, hwnd, nodes: [{ id, role, name, automationId, x, y, w, h, enabled, password, canInvoke, canType }] }
//               at most 200 interactive, visible elements, in reading order. `snapshot` names this numbering.
//   ui.act   -> { snapshot, id, action: "invoke" | "focus" | "setValue", value? }: Invoke / SetFocus / ValuePattern.SetValue through
//               UI Automation patterns, so no cursor is moved. Refuses a stale snapshot, a window that is no longer in front, and
//               never types into a password field.
// Both accept { fixture: [...] } instead of touching the screen: the raw nodes are taken from the given JSON and only the compacting
// and numbering run (used by the self-tests and by `Lokey.Host.exe --uia-fixture <file>`, which touches no UI at all).
internal static class Uia
{
    public static void Register()
    {
        Dispatcher.AddAsync("ui.tree", async p => await Task.Run(() => Tree(p)));
        Dispatcher.AddAsync("ui.act", async p => await Task.Run(() => Act(p)));
    }

    internal sealed record Raw(int Type, string Name, string AutoId, int X, int Y, int W, int H, bool Enabled, bool Offscreen, bool Password, bool Invoke, bool Value);
    internal sealed record Node(int Id, string Role, string Name, string AutomationId, int X, int Y, int W, int H, bool Enabled, bool Password, bool CanInvoke, bool CanType);
    internal sealed record TreeResult(string Snapshot, string App, string Title, long Hwnd, int Count, bool Truncated, List<Node> Nodes);
    internal sealed record ActResult(bool Ok, [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? Reason = null);

    // UIA control type ids that are worth showing to a model, and the word for each
    static readonly Dictionary<int, string> Roles = new()
    {
        [50000] = "button", [50002] = "checkbox", [50003] = "combobox", [50004] = "edit", [50005] = "link", [50007] = "listitem",
        [50011] = "menuitem", [50013] = "radio", [50015] = "slider", [50019] = "tab", [50024] = "treeitem", [50029] = "dataitem", [50031] = "splitbutton",
    };
    internal const int MaxNodes = 200;

    /// <summary>Pure: keep the visible interactive elements, drop duplicates, order them top-to-bottom then left-to-right, number them from 1.</summary>
    internal static TreeResult Compact(IEnumerable<Raw> raw, string app, string title, long hwnd, string snapshot) => CompactIx(raw.ToList(), app, title, hwnd, snapshot).res;

    /// <summary>Same, and also says which input row each numbered node came from (so the live element can be remembered under its number).</summary>
    internal static (TreeResult res, List<int> src) CompactIx(List<Raw> raw, string app, string title, long hwnd, string snapshot)
    {
        var seen = new HashSet<string>();
        var keep = new List<(Raw r, int ix)>();
        for (int ix = 0; ix < raw.Count; ix++)
        {
            var r = raw[ix];
            if (!Roles.ContainsKey(r.Type) || r.Offscreen || r.W <= 1 || r.H <= 1) continue;
            if (string.IsNullOrWhiteSpace(r.Name) && string.IsNullOrWhiteSpace(r.AutoId) && r.Type != 50004) continue;   // nothing a model could tell apart
            if (!seen.Add($"{r.Type}|{r.Name}|{r.X}|{r.Y}|{r.W}|{r.H}")) continue;
            keep.Add((r, ix));
        }
        keep.Sort((a, b) => Math.Abs(a.r.Y - b.r.Y) > 12 ? a.r.Y.CompareTo(b.r.Y) : a.r.X.CompareTo(b.r.X));
        bool truncated = keep.Count > MaxNodes;
        var top = keep.Take(MaxNodes).ToList();
        var nodes = top.Select((k, i) => new Node(i + 1, Roles[k.r.Type], Clip(k.r.Name, 80), Clip(k.r.AutoId, 60), k.r.X, k.r.Y, k.r.W, k.r.H, k.r.Enabled, k.r.Password, k.r.Invoke, k.r.Value && !k.r.Password)).ToList();
        return (new TreeResult(snapshot, app, Clip(title, 120), hwnd, nodes.Count, truncated, nodes), top.Select(k => k.ix).ToList());
    }
    static string Clip(string s, int n) => (s ?? "").Replace('\n', ' ').Replace('\r', ' ').Trim() is { } t && t.Length > n ? t[..n] : (s ?? "").Replace('\n', ' ').Replace('\r', ' ').Trim();

    /// <summary>Reads a fixture file (a JSON array of raw nodes, camelCase) and returns the compacted result as JSON. Touches no UI.</summary>
    internal static string FixtureFile(string path)
    {
        var raw = JsonSerializer.Deserialize<List<Raw>>(File.ReadAllText(path), Json.O) ?? new();
        return JsonSerializer.Serialize(Compact(raw, "fixture.exe", "fixture", 0, "fixture"), Json.O);
    }

    // ---------------- live UI Automation (vtable order from UIAutomationClient.h; the same numbering TextInput relies on) ----------------
    [ComImport, Guid("ff48dba4-60ef-4201-aa87-54103eef594e")] class CUIAutomation { }

    [ComImport, Guid("30cbe57d-d9d0-452a-ab13-7ac5ac4825ee"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IUia
    {
        [PreserveSig] int M3(); [PreserveSig] int M4();
        [PreserveSig] int GetRootElement(out IElem e);                                  // 5
        [PreserveSig] int ElementFromHandle(IntPtr hwnd, out IElem e);                  // 6
        [PreserveSig] int M7(); [PreserveSig] int M8(); [PreserveSig] int M9(); [PreserveSig] int M10(); [PreserveSig] int M11(); [PreserveSig] int M12();
        [PreserveSig] int M13(); [PreserveSig] int M14(); [PreserveSig] int M15(); [PreserveSig] int M16(); [PreserveSig] int M17();
        [PreserveSig] int get_ControlViewCondition(out IntPtr cond);                    // 18
    }

    [ComImport, Guid("d22108aa-8ac5-49a5-837b-37bbb3d7591e"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IElem
    {
        [PreserveSig] int SetFocus();                                                   // 3
        [PreserveSig] int M4(); [PreserveSig] int M5();
        [PreserveSig] int FindAll(int scope, IntPtr condition, out IElemArray found);   // 6
        [PreserveSig] int M7(); [PreserveSig] int M8(); [PreserveSig] int M9(); [PreserveSig] int M10(); [PreserveSig] int M11();
        [PreserveSig] int M12(); [PreserveSig] int M13(); [PreserveSig] int M14(); [PreserveSig] int M15();
        [PreserveSig] int GetCurrentPattern(int patternId, out IntPtr pattern);         // 16
        [PreserveSig] int M17(); [PreserveSig] int M18(); [PreserveSig] int M19(); [PreserveSig] int M20();
        [PreserveSig] int get_CurrentControlType(out int type);                         // 21
        [PreserveSig] int M22();
        [PreserveSig] int get_CurrentName([MarshalAs(UnmanagedType.BStr)] out string name);   // 23
        [PreserveSig] int M24(); [PreserveSig] int M25(); [PreserveSig] int M26(); [PreserveSig] int M27();
        [PreserveSig] int get_CurrentIsEnabled(out int enabled);                        // 28
        [PreserveSig] int get_CurrentAutomationId([MarshalAs(UnmanagedType.BStr)] out string id);   // 29
        [PreserveSig] int M30(); [PreserveSig] int M31(); [PreserveSig] int M32(); [PreserveSig] int M33(); [PreserveSig] int M34();
        [PreserveSig] int get_CurrentIsPassword(out int pw);                            // 35
        [PreserveSig] int M36(); [PreserveSig] int M37();
        [PreserveSig] int get_CurrentIsOffscreen(out int off);                          // 38
        [PreserveSig] int M39(); [PreserveSig] int M40(); [PreserveSig] int M41(); [PreserveSig] int M42();
        [PreserveSig] int get_CurrentBoundingRectangle(out W.RECT r);                   // 43
    }

    [ComImport, Guid("14314595-b4bc-4055-95f2-58f2e42c9855"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IElemArray
    {
        [PreserveSig] int get_Length(out int n);                                        // 3
        [PreserveSig] int GetElement(int index, out IElem e);                           // 4
    }

    [ComImport, Guid("fb377fbe-8ea6-46d5-9c73-6499642d3059"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IInvoke { [PreserveSig] int Invoke(); }                                   // 3

    [ComImport, Guid("a94cd8b1-0844-4cd6-9d2d-640537ab39e9"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IValue
    {
        [PreserveSig] int SetValue([MarshalAs(UnmanagedType.BStr)] string value);       // 3
    }

    const int PatternInvoke = 10000, PatternValue = 10002, ScopeDescendants = 4, MaxScanned = 1500;

    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);

    static readonly object Gate = new();
    static string _snapshot = "";
    static long _hwnd;
    static DateTime _at;
    static readonly Dictionary<int, IElem> Elements = new();
    static int _counter;

    static object? Tree(JsonElement p)
    {
        if (p.ValueKind == JsonValueKind.Object && p.TryGetProperty("fixture", out var fx) && fx.ValueKind == JsonValueKind.Array)
            return Compact(JsonSerializer.Deserialize<List<Raw>>(fx.GetRawText(), Json.O) ?? new(), "fixture.exe", "fixture", 0, "fixture");   // nothing live
        var fg = GetForegroundWindow();
        if (fg == IntPtr.Zero) throw new InvalidOperationException("no window in front");
        GetWindowThreadProcessId(fg, out var pid);
        string app = ""; try { app = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName + ".exe"; } catch { }
        var sb = new System.Text.StringBuilder(256); GetWindowText(fg, sb, 256);
        var ua = (IUia)new CUIAutomation();
        if (ua.ElementFromHandle(fg, out var root) != 0 || root is null) throw new InvalidOperationException("this window does not expose UI Automation");
        if (ua.get_ControlViewCondition(out var cond) != 0) throw new InvalidOperationException("no condition");
        IElemArray? arr = null;
        try
        {
            if (root.FindAll(ScopeDescendants, cond, out arr) != 0 || arr is null) throw new InvalidOperationException("could not list the elements");
            arr.get_Length(out var len);
            var raw = new List<Raw>(); var refs = new List<IElem>();
            for (int i = 0; i < Math.Min(len, MaxScanned); i++)
            {
                if (arr.GetElement(i, out var e) != 0 || e is null) continue;
                try
                {
                    e.get_CurrentControlType(out var type);
                    if (!Roles.ContainsKey(type)) continue;
                    e.get_CurrentName(out var name); e.get_CurrentAutomationId(out var aid);
                    e.get_CurrentIsEnabled(out var en); e.get_CurrentIsOffscreen(out var off); e.get_CurrentIsPassword(out var pw);
                    if (e.get_CurrentBoundingRectangle(out var r) != 0) continue;
                    bool inv = false, val = false;
                    if (e.GetCurrentPattern(PatternInvoke, out var pi) == 0 && pi != IntPtr.Zero) { inv = true; Marshal.Release(pi); }
                    if (e.GetCurrentPattern(PatternValue, out var pv) == 0 && pv != IntPtr.Zero) { val = true; Marshal.Release(pv); }
                    raw.Add(new Raw(type, name ?? "", aid ?? "", r.l, r.t, r.r - r.l, r.b - r.t, en != 0, off != 0, pw != 0, inv, val));
                    refs.Add(e);
                }
                catch { }
            }
            // number the elements, and remember which live element each number is
            var snapshot = $"s{Interlocked.Increment(ref _counter)}";
            var res = Compact(raw, app, sb.ToString(), (long)fg, snapshot);
            lock (Gate)
            {
                Elements.Clear();
                foreach (var n in res.Nodes)
                {
                    int ix = raw.FindIndex(r => r.Type != 0 && Roles.TryGetValue(r.Type, out var rn) && rn == n.Role && r.Name.Trim().StartsWith(n.Name.Length > 0 && n.Name.Length <= 80 ? n.Name : "\0", StringComparison.Ordinal) && r.X == n.X && r.Y == n.Y && r.W == n.W && r.H == n.H);
                    if (ix >= 0) Elements[n.Id] = refs[ix];
                }
                _snapshot = snapshot; _hwnd = (long)fg; _at = DateTime.UtcNow;
            }
            return res;
        }
        finally { if (cond != IntPtr.Zero) Marshal.Release(cond); }
    }

    static object? Act(JsonElement p)
    {
        string snap = Args.Str(p, "snapshot"), action = Args.Str(p, "action");
        int id = Args.Int(p, "id");
        IElem? e; long hwnd;
        lock (Gate)
        {
            if (snap != _snapshot || (DateTime.UtcNow - _at).TotalSeconds > 90) return new ActResult(false, "stale: read the elements again first");
            if (!Elements.TryGetValue(id, out e)) return new ActResult(false, "no such element");
            hwnd = _hwnd;
        }
        if ((long)GetForegroundWindow() != hwnd) return new ActResult(false, "the window changed; read the elements again");
        try
        {
            switch (action)
            {
                case "focus": return new ActResult(e.SetFocus() == 0, "could not focus");
                case "invoke":
                    if (e.GetCurrentPattern(PatternInvoke, out var pi) != 0 || pi == IntPtr.Zero) return new ActResult(false, "this element cannot be invoked; click it by position");
                    var inv = (IInvoke)Marshal.GetObjectForIUnknown(pi); Marshal.Release(pi);
                    return new ActResult(inv.Invoke() == 0, "invoke failed");
                case "setValue":
                    e.get_CurrentIsPassword(out var pw);
                    if (pw != 0) return new ActResult(false, "that is a password field; I do not type there");
                    if (e.GetCurrentPattern(PatternValue, out var pv) != 0 || pv == IntPtr.Zero) return new ActResult(false, "this element takes no text; use the keyboard");
                    var val = (IValue)Marshal.GetObjectForIUnknown(pv); Marshal.Release(pv);
                    var text = Args.Str(p, "value");
                    if (text.Length > 4000) return new ActResult(false, "too long");
                    return new ActResult(val.SetValue(text) == 0, "set value failed");
                default: return new ActResult(false, "unknown action");
            }
        }
        catch (Exception ex) { return new ActResult(false, ex.Message); }
    }
}
