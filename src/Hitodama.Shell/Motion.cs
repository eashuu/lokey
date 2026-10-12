using System.Numerics;
using Hitodama.Shell.Services;
using Microsoft.UI.Composition;

namespace Hitodama.Shell;

public sealed record Curve(float X1, float Y1, float X2, float Y2, double Ms);

// Caelestia's motion tokens (Anim.qml / appearanceconfig). Every animation runs on the compositor thread
// and starts from the property's current value, so retargeting mid-flight behaves like a QML Behavior.
public static class Motion
{
    public static readonly Curve Spatial = new(0.38f, 1.21f, 0.22f, 1f, 500);
    public static readonly Curve FastSpatial = new(0.42f, 1.67f, 0.21f, 0.9f, 350);
    public static readonly Curve Effects = new(0.34f, 0.8f, 0.34f, 1f, 200);
    public static readonly Curve SlowEffects = new(0.34f, 0.88f, 0.34f, 1f, 300);
    public static readonly Curve Standard = new(0.2f, 0f, 0f, 1f, 400);
    public static readonly Curve Emphasized = new(0.05f, 0.7f, 0.1f, 1f, 450);

    static double Speed => Store.Data.Appearance.AnimSpeed;

    // AnimSpeed 0 means "no animation": 1ms keeps the batch/Completed plumbing identical.
    static TimeSpan Dur(Curve c) => TimeSpan.FromMilliseconds(Speed <= 0 ? 1 : Math.Max(1, c.Ms / Speed));

    static CompositionEasingFunction Ease(Compositor comp, Curve c) =>
        comp.CreateCubicBezierEasingFunction(new Vector2(c.X1, c.Y1), new Vector2(c.X2, c.Y2));

    public static void To(CompositionObject o, string prop, float value, Curve c)
    {
        var a = o.Compositor.CreateScalarKeyFrameAnimation();
        a.InsertExpressionKeyFrame(0, "this.StartingValue");
        a.InsertKeyFrame(1, value, Ease(o.Compositor, c));
        a.Duration = Dur(c);
        o.StartAnimation(prop, a);
    }

    public static void To(CompositionObject o, string prop, Vector2 value, Curve c)
    {
        var a = o.Compositor.CreateVector2KeyFrameAnimation();
        a.InsertExpressionKeyFrame(0, "this.StartingValue");
        a.InsertKeyFrame(1, value, Ease(o.Compositor, c));
        a.Duration = Dur(c);
        o.StartAnimation(prop, a);
    }

    public static void To(CompositionObject o, string prop, Vector3 value, Curve c)
    {
        var a = o.Compositor.CreateVector3KeyFrameAnimation();
        a.InsertExpressionKeyFrame(0, "this.StartingValue");
        a.InsertKeyFrame(1, value, Ease(o.Compositor, c));
        a.Duration = Dur(c);
        o.StartAnimation(prop, a);
    }

    /// <summary>From an explicit start value (for enter transitions).</summary>
    public static void FromTo(CompositionObject o, string prop, Vector3 from, Vector3 to, Curve c)
    {
        var a = o.Compositor.CreateVector3KeyFrameAnimation();
        a.InsertKeyFrame(0, from);
        a.InsertKeyFrame(1, to, Ease(o.Compositor, c));
        a.Duration = Dur(c);
        o.StartAnimation(prop, a);
    }

    public static void FromTo(CompositionObject o, string prop, Vector2 from, Vector2 to, Curve c)
    {
        var a = o.Compositor.CreateVector2KeyFrameAnimation();
        a.InsertKeyFrame(0, from);
        a.InsertKeyFrame(1, to, Ease(o.Compositor, c));
        a.Duration = Dur(c);
        o.StartAnimation(prop, a);
    }

    public static void FromTo(CompositionObject o, string prop, float from, float to, Curve c)
    {
        var a = o.Compositor.CreateScalarKeyFrameAnimation();
        a.InsertKeyFrame(0, from);
        a.InsertKeyFrame(1, to, Ease(o.Compositor, c));
        a.Duration = Dur(c);
        o.StartAnimation(prop, a);
    }

    /// <summary>Groups the animations started inside <paramref name="start"/>; <paramref name="done"/> runs when all finish.</summary>
    public static void Batch(Compositor comp, Action start, Action done)
    {
        var b = comp.CreateScopedBatch(CompositionBatchTypes.Animation);
        start();
        b.End();
        b.Completed += (_, _) => done();
    }
}
