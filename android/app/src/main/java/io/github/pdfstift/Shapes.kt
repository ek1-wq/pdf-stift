package io.github.pdfstift

import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/** Formen beim Halten des Stifts (gemeinsam für PDF und Notizseite): Kreis/Ellipse, Rechteck oder gerade Linie */
object Shapes {
    fun snapLine(x0: Float, y0: Float, x: Float, y: Float): FloatArray {
        val a = Math.abs(Math.toDegrees(Math.atan2((y - y0).toDouble(), (x - x0).toDouble())))
        return when {
            a < 4 || a > 176 -> floatArrayOf(x, y0)
            Math.abs(a - 90) < 4 -> floatArrayOf(x0, y)
            else -> floatArrayOf(x, y)
        }
    }
    fun shapeOf(p: List<Float>): List<Float>? {
        val n = p.size / 3
        var x0 = Float.MAX_VALUE; var y0 = Float.MAX_VALUE; var x1 = -Float.MAX_VALUE; var y1 = -Float.MAX_VALUE; var len = 0f
        var i = 0
        while (i < p.size) {
            x0 = min(x0, p[i]); x1 = max(x1, p[i]); y0 = min(y0, p[i + 1]); y1 = max(y1, p[i + 1])
            if (i > 0) len += hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2])
            i += 3
        }
        val w = x1 - x0; val h = y1 - y0; val big = max(w, h); val small = min(w, h)
        val gap = hypot(p[p.size - 3] - p[0], p[p.size - 2] - p[1])
        if (n < 12 || small < big * 0.18f || gap > big * 0.3f || len < big * 2.2f) return null
        val cx = (x0 + x1) / 2; val cy = (y0 + y1) / 2
        var eE = 0f; var eR = 0f
        i = 0
        while (i < p.size) {
            val dx = (p[i] - cx) / (w / 2); val dy = (p[i + 1] - cy) / (h / 2)
            eE += Math.abs(hypot(dx, dy) - 1f)
            eR += minOf(Math.abs(p[i] - x0), Math.abs(p[i] - x1), minOf(Math.abs(p[i + 1] - y0), Math.abs(p[i + 1] - y1))) / small
            i += 3
        }
        eE /= n; eR /= n
        val out = ArrayList<Float>()
        if (eR < 0.07f && eR < eE * 0.8f) {
            val cs = arrayOf(floatArrayOf(x0, y0), floatArrayOf(x1, y0), floatArrayOf(x1, y1), floatArrayOf(x0, y1), floatArrayOf(x0, y0))
            for (k in 0 until 4) for (t in 0 until 30) { out.add(cs[k][0] + (cs[k + 1][0] - cs[k][0]) * t / 30f); out.add(cs[k][1] + (cs[k + 1][1] - cs[k][1]) * t / 30f); out.add(0.5f) }
            out.add(x0); out.add(y0); out.add(0.5f); out.add(x0 + w * 0.02f); out.add(y0); out.add(0.5f)
            return out
        }
        if (eE < 0.16f) {
            var rx = w / 2; var ry = h / 2
            if (Math.abs(w - h) < big * 0.15f) { rx = (w + h) / 4; ry = rx }
            for (k in 0..72) { val a = k / 72.0 * Math.PI * 2; out.add(cx + rx * Math.cos(a).toFloat()); out.add(cy + ry * Math.sin(a).toFloat()); out.add(0.5f) }
            return out
        }
        return null
    }
}
