package io.github.pdfstift

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.util.Xml
import androidx.core.graphics.PathParser
import org.json.JSONObject
import org.xmlpull.v1.XmlPullParser
import java.io.StringReader

/**
 * Formeln auf PDF-Seiten (aus der Web- und Windows-App): die gespeicherte Vektorgrafik (MathJax-SVG)
 * wird in Android-Pfade übersetzt und in den Rahmen des Objekts gezeichnet. Koordinaten in PDF-Punkten.
 */
object MathInk {
    private class Part(val path: Path, val fill: String?, val stroke: String?, val sw: Float)
    private val cache = object : LinkedHashMap<String, List<Part>>(32, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, List<Part>>?) = size > 60
    }
    private val fillP = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val strokeP = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }

    fun draw(c: Canvas, e: JSONObject) {
        val svg = e.optString("svg", "")
        val vb = e.optJSONArray("vb") ?: return
        if (svg.isEmpty() || vb.length() != 4) return
        val vx = vb.optDouble(0).toFloat(); val vy = vb.optDouble(1).toFloat()
        val vw = vb.optDouble(2).toFloat(); val vh = vb.optDouble(3).toFloat()
        if (vw <= 0f || vh <= 0f) return
        val x = e.optDouble("x").toFloat(); val y = e.optDouble("y").toFloat()
        val w = e.optDouble("w").toFloat(); val h = e.optDouble("h").toFloat()
        val parts = cache.getOrPut(svg) { parse(svg) }
        val col = try { Color.parseColor(e.optString("c", "#1A1A1A")) } catch (er: Exception) { Color.BLACK }
        val k = minOf(w / vw, h / vh)
        c.save()
        val rot = e.optDouble("r", 0.0).toFloat()
        if (rot != 0f) c.rotate(rot, x + w / 2, y + h / 2)
        val op = e.optDouble("op", 1.0)
        c.translate(x + (w - vw * k) / 2 - vx * k, y + (h - vh * k) / 2 - vy * k)
        c.scale(k, k)
        for (p in parts) {
            val fc = colorOf(p.fill, col)
            if (fc != null) { fillP.color = fc; fillP.alpha = (255 * op).toInt(); c.drawPath(p.path, fillP) }
            val sc = if (p.sw > 0f) colorOf(p.stroke, col) else null
            if (sc != null) { strokeP.color = sc; strokeP.alpha = (255 * op).toInt(); strokeP.strokeWidth = p.sw; c.drawPath(p.path, strokeP) }
        }
        c.restore()
    }

    private fun colorOf(v: String?, cur: Int): Int? = when {
        v == null || v == "none" -> null
        v == "currentColor" -> cur
        else -> try { Color.parseColor(v) } catch (er: Exception) { cur }
    }

    /** SVG-Bausteine (g, path, rect, line, polygon, svg) mit ihren Verschiebungen in fertige Pfade übersetzen */
    private fun parse(svg: String): List<Part> {
        val out = ArrayList<Part>()
        try {
            val xp = Xml.newPullParser()
            xp.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
            xp.setInput(StringReader("<svg>$svg</svg>"))
            data class St(val m: Matrix, val fill: String?, val stroke: String?, val sw: Float)
            val stack = ArrayList<St>()
            stack.add(St(Matrix(), "currentColor", "none", 0f))
            var ev = xp.eventType
            while (ev != XmlPullParser.END_DOCUMENT) {
                if (ev == XmlPullParser.START_TAG) {
                    val top = stack.last()
                    val a = { n: String -> xp.getAttributeValue(null, n) }
                    val m = Matrix(top.m)
                    a("transform")?.let { m.preConcat(transform(it)) }
                    if (xp.name == "svg" && stack.size > 1) {
                        val sx = a("x")?.toFloatOrNull() ?: 0f; val sy = a("y")?.toFloatOrNull() ?: 0f
                        m.preTranslate(sx, sy)
                        val v = a("viewBox")?.trim()?.split(Regex("[\\s,]+"))?.mapNotNull { it.toFloatOrNull() }
                        if (v != null && v.size == 4 && v[2] > 0 && v[3] > 0) {
                            val kx = (a("width")?.toFloatOrNull() ?: v[2]) / v[2]; val ky = (a("height")?.toFloatOrNull() ?: v[3]) / v[3]
                            m.preScale(kx, ky); m.preTranslate(-v[0], -v[1])
                        }
                    }
                    val st = St(m, a("fill") ?: top.fill, a("stroke") ?: top.stroke, a("stroke-width")?.toFloatOrNull() ?: top.sw)
                    stack.add(st)
                    val f = { n: String -> a(n)?.toFloatOrNull() ?: 0f }
                    val path: Path? = when (xp.name) {
                        "path" -> a("d")?.let { d -> try { PathParser.createPathFromPathData(d) } catch (er: Exception) { null } }
                        "rect" -> if (f("width") > 0f && f("height") > 0f) Path().apply { addRect(f("x"), f("y"), f("x") + f("width"), f("y") + f("height"), Path.Direction.CW) } else null
                        "line" -> Path().apply { moveTo(f("x1"), f("y1")); lineTo(f("x2"), f("y2")) }
                        "polygon" -> a("points")?.trim()?.split(Regex("[\\s,]+"))?.mapNotNull { it.toFloatOrNull() }?.let { pts ->
                            if (pts.size < 4) null else Path().apply { moveTo(pts[0], pts[1]); var i = 2; while (i + 1 < pts.size) { lineTo(pts[i], pts[i + 1]); i += 2 }; close() }
                        }
                        else -> null
                    }
                    if (path != null) {
                        path.transform(m)
                        out.add(Part(path, if (xp.name == "line") null else st.fill, st.stroke, st.sw))
                    }
                } else if (ev == XmlPullParser.END_TAG) {
                    if (stack.size > 1) stack.removeAt(stack.size - 1)
                }
                ev = xp.next()
            }
        } catch (er: Exception) { /* Formel ohne Grafik */ }
        return out
    }

    /** transform="translate(…) scale(…) matrix(…) rotate(…)" → Matrix */
    private fun transform(t: String): Matrix {
        val m = Matrix()
        for (g in Regex("(matrix|translate|scale|rotate)\\s*\\(([^)]*)\\)").findAll(t)) {
            val v = g.groupValues[2].trim().split(Regex("[\\s,]+")).mapNotNull { it.toFloatOrNull() }
            val x = Matrix()
            when (g.groupValues[1]) {
                "matrix" -> if (v.size == 6) x.setValues(floatArrayOf(v[0], v[2], v[4], v[1], v[3], v[5], 0f, 0f, 1f))
                "translate" -> x.setTranslate(v.getOrElse(0) { 0f }, v.getOrElse(1) { 0f })
                "scale" -> x.setScale(v.getOrElse(0) { 1f }, v.getOrElse(1) { v.getOrElse(0) { 1f } })
                "rotate" -> x.setRotate(v.getOrElse(0) { 0f })
            }
            m.preConcat(x)
        }
        return m
    }
}
