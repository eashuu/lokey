package app.lokey.link;

import android.os.ParcelFileDescriptor;

// The Shizuku user service (BgService.kt): runs in a process with shell privileges (uid 2000), started by Shizuku.
// One JSON-in / JSON-out call keeps the interface stable; a frame is streamed over a pipe (never through a Binder transaction, which is limited to 1 MB).
interface IBgService {
    // Reserved by Shizuku: stops the service. Transaction code 16777114 is what Shizuku's unbindUserService(remove = true) calls.
    void destroy() = 16777114;

    // method names are listed in BgService.call; returns {"ok":true,...} or {"ok":false,"reason":"..."}
    String call(String method, String json) = 1;

    // JPEG of the virtual display on a pipe: int width, int height, int ageMs, byte flags (1 = black, 2 = stale), then the JPEG bytes to end of stream. null = no frame.
    ParcelFileDescriptor frame(int quality, int maxWidth) = 2;
}
