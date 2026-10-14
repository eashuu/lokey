package app.lokey.link

import org.junit.Assert.assertEquals
import org.junit.Test

/** Mirrors Listener.SelfCheck in Lokey.Host: frames are 20 ms; 'quiet' = room noise, 'clap' = a loud frame then a quiet one. */
class ClapDetectorTest {
    private fun run(build: MutableList<Pair<Double, Double>>.() -> Unit): Int {
        val f = mutableListOf<Pair<Double, Double>>().apply(build)
        val d = ClapDetector(); var n = 0; var t = 0L
        for ((rms, peak) in f) { if (d.feed(rms, peak, t)) n++; t += 20 }
        return n
    }
    private fun MutableList<Pair<Double, Double>>.quiet(n: Int) { for (i in 0 until n) add((0.01 + 0.002 * (i % 3)) to 0.03) }
    private fun MutableList<Pair<Double, Double>>.clap() { add(0.35 to 0.8); add(0.04 to 0.1) }
    private fun MutableList<Pair<Double, Double>>.rise() { for (i in 0 until 12) add((0.02 + i * 0.03) to (0.05 + i * 0.06)) }

    @Test fun doubleClap() = assertEquals(1, run { quiet(60); clap(); quiet(14); clap(); quiet(30) })
    @Test fun singleClap() = assertEquals(0, run { quiet(60); clap(); quiet(60) })
    @Test fun farApart() = assertEquals(0, run { quiet(60); clap(); quiet(60); clap(); quiet(30) })
    @Test fun steadyLoud() = assertEquals(0, run { quiet(60); for (i in 0 until 25) add(0.3 to 0.6); quiet(30) })
    @Test fun speechRises() = assertEquals(0, run { quiet(60); rise(); quiet(40); rise(); quiet(30) })
    @Test fun threeClaps() = assertEquals(1, run { quiet(60); clap(); quiet(14); clap(); quiet(14); clap(); quiet(30) })
}
