package io.github.pdfstift

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.RectF
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Rahmen der Lasso-Auswahl mit Anfassern: Ecken = größer/kleiner (Seitenverhältnis bleibt), Knopf oben = drehen (rastet bei 15° ein).
 * Alle Werte in den Koordinaten des Aufrufers; u = ein dp in diesen Koordinaten.
 */
object SelUi {
    private val box = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = Ui.NAVY }
    private val knobFill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; color = Color.WHITE }
    private val knobLine = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = Ui.NAVY }
    private val rotFill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; color = Ui.NAVY }

    const val ROT_DP = 30f
    const val KNOB_DP = 7f

    /** Verschieben, Größe oder Drehung, die gerade gezogen wird */
    class Xf(val kind: String, val dx: Float = 0f, val dy: Float = 0f, val f: Float = 1f, val ax: Float = 0f, val ay: Float = 0f, val deg: Float = 0f) {
        fun apply(c: Canvas) {
            when (kind) {
                "move" -> c.translate(dx, dy)
                "scale" -> c.scale(f, f, ax, ay)
                "rot" -> c.rotate(deg, ax, ay)
            }
        }
        fun box(b: RectF): RectF = when (kind) {
            "move" -> RectF(b).apply { offset(dx, dy) }
            "scale" -> RectF(ax + (b.left - ax) * f, ay + (b.top - ay) * f, ax + (b.right - ax) * f, ay + (b.bottom - ay) * f).apply { sort() }
            else -> RectF(b)
        }
        val none get() = (kind == "move" && dx == 0f && dy == 0f) || (kind == "scale" && f == 1f) || (kind == "rot" && deg == 0f)
    }

    fun draw(c: Canvas, b: RectF, u: Float, xf: Xf?) {
        c.save()
        if (xf != null && xf.kind == "rot") xf.apply(c)
        val r = if (xf != null) xf.box(b) else b
        box.strokeWidth = 1.5f * u
        box.pathEffect = DashPathEffect(floatArrayOf(6 * u, 4 * u), 0f)
        c.drawRect(r, box)
        knobLine.strokeWidth = 1.5f * u
        val kr = KNOB_DP * u
        for ((x, y) in listOf(r.left to r.top, r.right to r.top, r.left to r.bottom, r.right to r.bottom)) {
            c.drawCircle(x, y, kr, knobFill); c.drawCircle(x, y, kr, knobLine)
        }
        val ry = r.top - ROT_DP * u
        c.drawLine(r.centerX(), r.top, r.centerX(), ry + kr, knobLine)
        c.drawCircle(r.centerX(), ry, kr * 1.15f, rotFill)
        knobFill.style = Paint.Style.STROKE; knobFill.strokeWidth = 1.4f * u
        c.drawArc(r.centerX() - kr * 0.6f, ry - kr * 0.6f, r.centerX() + kr * 0.6f, ry + kr * 0.6f, -60f, 270f, false, knobFill)
        knobFill.style = Paint.Style.FILL
        c.restore()
    }

    /** "nw" | "ne" | "sw" | "se" | "rot" | "move" | null */
    fun hit(b: RectF, x: Float, y: Float, u: Float): String? {
        val tol = 18 * u
        if (hypot(x - b.centerX(), y - (b.top - ROT_DP * u)) <= tol) return "rot"
        val corners = listOf("nw" to (b.left to b.top), "ne" to (b.right to b.top), "sw" to (b.left to b.bottom), "se" to (b.right to b.bottom))
        corners.minByOrNull { (_, p) -> hypot(x - p.first, y - p.second) }?.let { (k, p) -> if (hypot(x - p.first, y - p.second) <= tol) return k }
        if (RectF(b).apply { inset(-8 * u, -8 * u) }.contains(x, y)) return "move"
        return null
    }

    /** aktuelle Änderung aus Start- und jetzigem Punkt */
    fun xf(mode: String, b: RectF, x0: Float, y0: Float, x: Float, y: Float, u: Float): Xf {
        val dx = x - x0; val dy = y - y0
        when (mode) {
            "move" -> return Xf("move", dx = dx, dy = dy)
            "rot" -> {
                val mx = b.centerX(); val my = b.centerY()
                var deg = Math.toDegrees((atan2(y - my, x - mx) - atan2(y0 - my, x0 - mx)).toDouble()).toFloat()
                val snap = (deg / 15f).roundToInt() * 15f
                if (abs(deg - snap) < 4) deg = snap
                return Xf("rot", ax = mx, ay = my, deg = deg.roundToInt().toFloat())
            }
        }
        val ax = if ('w' in mode) b.right else b.left; val ay = if ('n' in mode) b.bottom else b.top
        val cx = if ('w' in mode) b.left else b.right; val cy = if ('n' in mode) b.top else b.bottom
        val fx = abs(cx + dx - ax) / max(1e-3f, abs(cx - ax)); val fy = abs(cy + dy - ay) / max(1e-3f, abs(cy - ay))
        val raw = when { b.height() < 6 * u -> fx; b.width() < 6 * u -> fy; else -> max(fx, fy) }
        val f = raw.coerceIn(24 * u / max(1e-3f, max(b.width(), b.height())), 20f)
        return Xf("scale", f = f, ax = ax, ay = ay)
    }
}
