package io.github.pdfstift

import android.graphics.BlendMode
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.os.Build
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/** Zeichnet Notizen genauso wie die Web-App. Koordinaten in PDF-Punkten (Seite oben links = 0,0). */
object Ink {
    val PEN_W = floatArrayOf(0.9f, 1.6f, 2.8f)
    val HL_W = floatArrayOf(8f, 13f, 20f)

    private val pen = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val hl = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND
        if (Build.VERSION.SDK_INT >= 29) blendMode = BlendMode.MULTIPLY
    }
    private val txHl = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        if (Build.VERSION.SDK_INT >= 29) blendMode = BlendMode.MULTIPLY
    }
    private val text = Paint(Paint.ANTI_ALIAS_FLAG)
    private val imgPaint = Paint(Paint.FILTER_BITMAP_FLAG)

    fun color(s: JSONObject): Int = try { Color.parseColor(s.optString("c", "#1A1A1A")) } catch (e: Exception) { Color.BLACK }
    fun pts(s: JSONObject): FloatArray {
        val a = s.optJSONArray("pts") ?: return FloatArray(0)
        return FloatArray(a.length()) { a.optDouble(it, 0.0).toFloat() }
    }

    /** Reihenfolge wie im Web: Textmarker unten, Stift oben */
    fun rank(s: JSONObject): Int {
        val t = s.optString("t")
        return when {
            t == "img" -> -1
            t == "tx" && s.optString("k") == "hl" -> 0
            t == "hl" -> 1
            t == "txt" -> 3
            else -> 2
        }
    }

    // Pfade werden je Strich zwischengespeichert
    private class Built(val parts: List<Pair<Path, Float>>)
    private val cache = HashMap<String, Built>()
    fun forget(id: String) { cache.remove(id) }

    fun draw(c: Canvas, s: JSONObject) {
        val t = s.optString("t", "pen")
        if (t == "ob") return // Objekte (Textfeld, Form, Bild, Tabelle) zeigt die App noch nicht an
        val p = pts(s)
        val col = color(s)
        val rot = s.optDouble("r", 0.0).toFloat()
        if ((t == "txt" || t == "img") && abs(rot) > 0.01f && p.size >= 2) {
            val cx = p[0] + s.optDouble("bw", 0.0).toFloat() / 2
            val cy = p[1] + s.optDouble("bh", 0.0).toFloat() / 2
            c.save(); c.rotate(rot, cx, cy)
            drawPlain(c, s, t, p, col)
            c.restore()
            return
        }
        drawPlain(c, s, t, p, col)
    }

    private fun drawPlain(c: Canvas, s: JSONObject, t: String, p: FloatArray, col: Int) {
        when (t) {
            "pen" -> drawPen(c, s, p, col)
            "hl" -> {
                if (p.size < 3) return
                hl.color = col; hl.alpha = 102; hl.strokeWidth = s.optDouble("w", 13.0).toFloat()
                val b = cache.getOrPut(s.optString("id")) {
                    val path = Path(); path.moveTo(p[0], p[1])
                    var i = 3
                    while (i + 1 < p.size) { path.lineTo(p[i], p[i + 1]); i += 3 }
                    if (p.size == 3) path.lineTo(p[0] + 0.01f, p[1])
                    Built(listOf(path to 0f))
                }
                c.drawPath(b.parts[0].first, hl)
            }
            "sh" -> {
                if (p.size < 4) return
                pen.color = col; pen.strokeWidth = max(0.5f, s.optDouble("w", 1.5).toFloat())
                for (line in shapeLines(s.optString("k", "line"), p, s.optDouble("w", 1.5).toFloat())) {
                    val path = Path()
                    line.forEachIndexed { i, q -> if (i == 0) path.moveTo(q[0], q[1]) else path.lineTo(q[0], q[1]) }
                    c.drawPath(path, pen)
                }
            }
            "tx" -> {
                var i = 0
                val k = s.optString("k", "hl")
                while (i + 3 < p.size) {
                    val x = p[i]; val y = p[i + 1]; val w = p[i + 2]; val h = p[i + 3]
                    if (k == "ul" || k == "st") {
                        val yy = if (k == "ul") y + h * 0.94f else y + h * 0.56f
                        pen.color = col; pen.strokeWidth = max(1.2f, h * 0.085f); pen.strokeCap = Paint.Cap.BUTT
                        c.drawLine(x, yy, x + w, yy, pen)
                        pen.strokeCap = Paint.Cap.ROUND
                    } else {
                        txHl.color = col; txHl.alpha = 217
                        c.drawRect(x, y, x + w, y + h, txHl)
                    }
                    i += 4
                }
            }
            "txt" -> {
                if (p.size < 2) return
                if (s.optInt("nt") == 1) { drawNote(c, p[0], p[1], col); return }
                val fs = s.optDouble("fs", 14.0).toFloat()
                val bw = s.optDouble("bw", 0.0).toFloat(); val bh = s.optDouble("bh", 0.0).toFloat()
                val pd = fs * 0.3f
                s.optString("bg").takeIf { it.startsWith("#") }?.let { fill.color = Color.parseColor(it); c.drawRect(p[0] - pd, p[1] - pd, p[0] + bw + pd, p[1] + bh + pd, fill) }
                s.optString("bo").takeIf { it.startsWith("#") }?.let {
                    pen.color = Color.parseColor(it); pen.strokeWidth = max(1f, fs * 0.07f)
                    c.drawRect(p[0] - pd, p[1] - pd, p[0] + bw + pd, p[1] + bh + pd, pen)
                }
                text.color = col; text.textSize = fs
                val st = (if (s.optInt("b") == 1) Typeface.BOLD else 0) or (if (s.optInt("i") == 1) Typeface.ITALIC else 0)
                val fam = when (s.optString("ff")) { "serif" -> Typeface.SERIF; "mono" -> Typeface.MONOSPACE; else -> Typeface.SANS_SERIF }
                text.typeface = Typeface.create(fam, st)
                val al = s.optString("al")
                s.optString("text").split("\n").forEachIndexed { i, line ->
                    val off = when (al) { "c" -> (bw - text.measureText(line)) / 2; "r" -> bw - text.measureText(line); else -> 0f }
                    c.drawText(line, p[0] + max(0f, off), p[1] + fs * 0.8f + i * fs * 1.25f, text)
                }
                if (s.has("ln")) { fill.color = col; c.drawRect(p[0], p[1] + fs * 0.95f, p[0] + bw, p[1] + fs * 0.95f + max(0.5f, fs * 0.06f), fill) }
            }
            "img" -> {
                if (p.size < 2) return
                val r = RectF(p[0], p[1], p[0] + s.optDouble("bw", 100.0).toFloat(), p[1] + s.optDouble("bh", 100.0).toFloat())
                val bmp = Images.get(s.optString("src"))
                if (bmp != null) c.drawBitmap(bmp, null, r, imgPaint) else { fill.color = Color.parseColor("#EEF0F5"); c.drawRect(r, fill) }
            }
        }
    }

    /** Kommentar-Notizzettel (20 × 20 Punkte) */
    private fun drawNote(c: Canvas, x: Float, y: Float, col: Int) {
        val path = Path().apply {
            moveTo(x + 3, y); lineTo(x + 17, y); quadTo(x + 20, y, x + 20, y + 3); lineTo(x + 20, y + 11.4f); quadTo(x + 20, y + 14.4f, x + 17, y + 14.4f)
            lineTo(x + 9, y + 14.4f); lineTo(x + 5, y + 20); lineTo(x + 5.6f, y + 14.4f); lineTo(x + 3, y + 14.4f); quadTo(x, y + 14.4f, x, y + 11.4f); lineTo(x, y + 3); quadTo(x, y, x + 3, y); close()
        }
        fill.color = col; c.drawPath(path, fill)
        pen.color = Color.argb(115, 0, 0, 0); pen.strokeWidth = 0.8f; c.drawPath(path, pen)
        pen.color = Color.argb(140, 0, 0, 0)
        for (f in floatArrayOf(4.4f, 7.6f, 10.8f)) c.drawLine(x + 4, y + f, x + 16, y + f, pen)
    }

    private fun drawPen(c: Canvas, s: JSONObject, p: FloatArray, col: Int) {
        val w = s.optDouble("w", 1.6).toFloat()
        if (p.size < 3) return
        if (p.size <= 3) {
            fill.color = col
            c.drawCircle(p[0], p[1], w * (0.6f + 0.8f * (if (p[2] > 0) p[2] else 0.5f)) / 2, fill)
            return
        }
        val b = cache.getOrPut(s.optString("id")) { buildPen(p, w) }
        pen.color = col
        for ((path, lw) in b.parts) { pen.strokeWidth = lw; c.drawPath(path, pen) }
    }

    /** Kurven durch die Mittelpunkte, Strichbreite je nach Andruck (in 1/4-Stufen zusammengefasst) */
    private fun buildPen(p: FloatArray, w: Float): Built {
        val parts = ArrayList<Pair<Path, Float>>()
        var lw = -1f
        var path = Path()
        var i = 3
        while (i + 1 < p.size) {
            val pr = ((if (p[i - 1] > 0) p[i - 1] else 0.5f) + (if (i + 2 < p.size && p[i + 2] > 0) p[i + 2] else 0.5f)) / 2
            val ww = max(0.12f, (w * (0.6f + 0.8f * pr) * 8).roundToInt() / 8f)
            val x0 = if (i >= 6) (p[i - 6] + p[i - 3]) / 2 else p[i - 3]
            val y0 = if (i >= 6) (p[i - 5] + p[i - 2]) / 2 else p[i - 2]
            val mx = (p[i - 3] + p[i]) / 2; val my = (p[i - 2] + p[i + 1]) / 2
            if (ww != lw) {
                if (lw >= 0) parts.add(path to lw)
                lw = ww; path = Path(); path.moveTo(x0, y0)
            }
            path.quadTo(p[i - 3], p[i - 2], mx, my)
            i += 3
        }
        if (lw >= 0) { path.lineTo(p[p.size - 3], p[p.size - 2]); parts.add(path to lw) }
        return Built(parts)
    }

    fun shapeLines(k: String, p: FloatArray, w: Float): List<List<FloatArray>> {
        val x1 = p[0]; val y1 = p[1]; val x2 = p[2]; val y2 = p[3]
        if (k == "rect") return listOf(listOf(floatArrayOf(x1, y1), floatArrayOf(x2, y1), floatArrayOf(x2, y2), floatArrayOf(x1, y2), floatArrayOf(x1, y1)))
        if (k == "oval") {
            val cx = (x1 + x2) / 2; val cy = (y1 + y2) / 2; val rx = abs(x2 - x1) / 2; val ry = abs(y2 - y1) / 2
            return listOf((0..64).map { val a = it / 64.0 * Math.PI * 2; floatArrayOf(cx + rx * cos(a).toFloat(), cy + ry * sin(a).toFloat()) })
        }
        val lines = mutableListOf(listOf(floatArrayOf(x1, y1), floatArrayOf(x2, y2)))
        if (k == "arrow") {
            val a = atan2((y2 - y1).toDouble(), (x2 - x1).toDouble())
            val L = min(max(w * 5, w * 3).toDouble(), hypot((x2 - x1).toDouble(), (y2 - y1).toDouble()) * 0.6)
            lines.add(listOf(
                floatArrayOf((x2 - L * cos(a - 0.45)).toFloat(), (y2 - L * sin(a - 0.45)).toFloat()),
                floatArrayOf(x2, y2),
                floatArrayOf((x2 - L * cos(a + 0.45)).toFloat(), (y2 - L * sin(a + 0.45)).toFloat())))
        }
        return lines
    }

    /** Umriss eines Strichs (für Radierer und Neuzeichnen) */
    fun bounds(s: JSONObject): RectF {
        val p = pts(s)
        val t = s.optString("t")
        val r = RectF(Float.MAX_VALUE, Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE)
        if (t == "txt" || t == "img") {
            if (p.size >= 2) r.set(p[0], p[1], p[0] + s.optDouble("bw", 0.0).toFloat(), p[1] + s.optDouble("bh", 0.0).toFloat())
            return r
        }
        val step = when (t) { "pen", "hl" -> 3; "tx" -> 4; else -> 2 }
        var l = Float.MAX_VALUE; var tp = Float.MAX_VALUE; var rt = -Float.MAX_VALUE; var bt = -Float.MAX_VALUE
        var i = 0
        while (i + 1 < p.size) {
            val x2 = if (t == "tx" && i + 3 < p.size) p[i] + p[i + 2] else p[i]
            val y2 = if (t == "tx" && i + 3 < p.size) p[i + 1] + p[i + 3] else p[i + 1]
            l = min(l, p[i]); tp = min(tp, p[i + 1]); rt = max(rt, x2); bt = max(bt, y2)
            i += step
        }
        if (l > rt) return RectF()
        r.set(l, tp, rt, bt)
        val w = s.optDouble("w", 1.0).toFloat()
        r.inset(-w, -w)
        return r
    }

    /** Trifft der Radierer (Kreis um x,y mit Radius rad) diesen Strich? */
    fun hits(s: JSONObject, x: Float, y: Float, rad: Float): Boolean {
        val b = bounds(s)
        if (x < b.left - rad || x > b.right + rad || y < b.top - rad || y > b.bottom + rad) return false
        val t = s.optString("t")
        val p = pts(s)
        if (p.size < 2) return false
        if (t == "pen" || t == "hl") {
            val rr = rad + s.optDouble("w", 1.0).toFloat() / 2
            if (p.size <= 3) return hypot(p[0] - x, p[1] - y) <= rr
            var i = 3
            while (i + 1 < p.size) {
                if (segDist(x, y, p[i - 3], p[i - 2], p[i], p[i + 1]) <= rr) return true
                i += 3
            }
            return false
        }
        if (t == "sh") {
            for (line in shapeLines(s.optString("k", "line"), p, s.optDouble("w", 1.5).toFloat()))
                for (j in 1 until line.size) if (segDist(x, y, line[j - 1][0], line[j - 1][1], line[j][0], line[j][1]) <= rad + 2) return true
            return false
        }
        return true // Textmarkierung, Textfeld, Bild: Treffer im Umriss reicht
    }

    private fun segDist(px: Float, py: Float, ax: Float, ay: Float, bx: Float, by: Float): Float {
        val dx = bx - ax; val dy = by - ay
        val l2 = dx * dx + dy * dy
        var t = if (l2 > 0) ((px - ax) * dx + (py - ay) * dy) / l2 else 0f
        t = t.coerceIn(0f, 1f)
        return hypot(px - (ax + t * dx), py - (ay + t * dy))
    }
}
