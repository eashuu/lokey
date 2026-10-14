package app.lokey.link

/**
 * Hook for vivo's own Atomic Island ("Origin Island" / 原子岛). vivo's third-party integration is a push-based partner programme on the
 * vivo developer platform: it is not self-serve, so there is NO implementation here and Lokey does not pretend to be a whitelisted app
 * (no spoofed package names). On OriginOS the only route we have is the standard Android 16 Live Update (see LiveUpdates) plus our own overlay.
 * If vivo ever grants access, implement this and assign it to Island.atomic.
 */
interface AtomicIslandAdapter {
    fun available(): Boolean
    /** called with the page's current activity list whenever it changes */
    fun publish(faces: List<Face>)
}

