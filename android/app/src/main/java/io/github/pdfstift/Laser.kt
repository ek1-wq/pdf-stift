package io.github.pdfstift

import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.SystemClock
import android.view.View

/** Laserpointer: roter, leuchtender Strich, der nach dem Absetzen in gut einer Sekunde verblasst. Wird nie gespeichert. */
class Laser(private val v: View) {
    private val dens = v.resources.displayMetrics.density
    private class Trail { val x = ArrayList<Float>(); val y = ArrayList<Float>(); val t = ArrayList<Long>(); var live = true; var end = 0L }
    private val trails = ArrayList<Trail>()
    private val glow = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND
        color = Color.rgb(255, 40, 40); maskFilter = BlurMaskFilter(6 * dens, BlurMaskFilter.Blur.NORMAL)
    }
    private val core = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND; color = Color.rgb(255, 230, 230) }
    private val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(255, 30, 30); maskFilter = BlurMaskFilter(5 * dens, BlurMaskFilter.Blur.NORMAL) }

    fun start(x: Float, y: Float) { trails.add(Trail().also { it.x.add(x); it.y.add(y); it.t.add(now()) }) }
    fun add(x: Float, y: Float) {
        val t = trails.lastOrNull() ?: return
        t.x.add(x); t.y.add(y); t.t.add(now())
        if (t.x.size > 800) { t.x.subList(0, 200).clear(); t.y.subList(0, 200).clear(); t.t.subList(0, 200).clear() }
    }
    fun end() { trails.lastOrNull()?.let { it.live = false; it.end = now() } }
    fun clear() { trails.clear(); v.invalidate() }
    val busy get() = trails.isNotEmpty()
    /** für die Live-Mitschau: Spuren als [x, y, Alter in ms] (Bildschirm-Pixel) */
    fun snapshot(): List<List<FloatArray>> {
        val n = now()
        return trails.map { t -> (maxOf(0, t.x.size - 250) until t.x.size).map { i -> floatArrayOf(t.x[i], t.y[i], (n - t.t[i]).toFloat()) } }
    }
    private fun now() = SystemClock.uptimeMillis()

    fun draw(c: Canvas) {
        if (trails.isEmpty()) return
        val n = now()
        trails.removeAll { !it.live && n - it.end > FADE }
        for (t in trails) {
            val a = if (t.live) 1f else 1f - (n - t.end).toFloat() / FADE
            // Ende des Strichs (ältere Punkte) wird während des Zeichnens dünner – wie ein Komet
            for (i in 1 until t.x.size) {
                val age = (n - t.t[i]).toFloat()
                val f = (1f - age / TAIL).coerceIn(0.15f, 1f) * a
                if (f <= 0.02f) continue
                glow.alpha = (200 * f).toInt(); glow.strokeWidth = 9 * dens * f
                c.drawLine(t.x[i - 1], t.y[i - 1], t.x[i], t.y[i], glow)
                core.alpha = (255 * f).toInt(); core.strokeWidth = 2.6f * dens * f
                c.drawLine(t.x[i - 1], t.y[i - 1], t.x[i], t.y[i], core)
            }
            if (t.live) { dot.alpha = 230; c.drawCircle(t.x.last(), t.y.last(), 7 * dens, dot) }
        }
        if (trails.isNotEmpty()) v.postInvalidateOnAnimation()
    }

    companion object { const val FADE = 1100L; const val TAIL = 1600f }
}
