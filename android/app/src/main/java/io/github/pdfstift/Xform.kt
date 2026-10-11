package io.github.pdfstift

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

/** Notizen verschieben, vergrößern und drehen – genau wie in der Web-App (Koordinaten der Notiz selbst). Ergebnis bekommt eine neue id. */
object Xform {
    private fun r(v: Float) = (v * 100).roundToInt() / 100.0
    private fun step(t: String) = when (t) { "pen", "hl" -> 3; "tx" -> 4; "sh" -> 2; else -> 0 }

    private fun out(s: JSONObject, p: FloatArray): JSONObject =
        JSONObject(s.toString()).put("id", Store.uid()).put("pts", JSONArray(p.map { r(it) }))

    fun translate(s: JSONObject, dx: Float, dy: Float): JSONObject {
        val p = Ink.pts(s).copyOf()
        val st = step(s.optString("t"))
        if (st == 0) { if (p.size >= 2) { p[0] += dx; p[1] += dy } }
        else { var i = 0; while (i + 1 < p.size) { p[i] += dx; p[i + 1] += dy; i += st } }
        return out(s, p)
    }

    fun scale(s: JSONObject, f: Float, cx: Float, cy: Float): JSONObject {
        val t = s.optString("t")
        val p = Ink.pts(s).copyOf()
        val X = { x: Float -> cx + (x - cx) * f }; val Y = { y: Float -> cy + (y - cy) * f }
        val o = JSONObject(s.toString())
        when (t) {
            "tx" -> { var i = 0; while (i + 3 < p.size) { p[i] = X(p[i]); p[i + 1] = Y(p[i + 1]); p[i + 2] *= f; p[i + 3] *= f; i += 4 } }
            "sh" -> if (p.size >= 4) { p[0] = X(p[0]); p[1] = Y(p[1]); p[2] = X(p[2]); p[3] = Y(p[3]) }
            "txt", "img" -> if (p.size >= 2) {
                p[0] = X(p[0]); p[1] = Y(p[1])
                o.put("bw", r(s.optDouble("bw", 0.0).toFloat() * f)); o.put("bh", r(s.optDouble("bh", 0.0).toFloat() * f))
                if (t == "txt") o.put("fs", r((s.optDouble("fs", 14.0).toFloat() * f).coerceIn(4f, 120f)))
            }
            else -> { var i = 0; while (i + 1 < p.size) { p[i] = X(p[i]); p[i + 1] = Y(p[i + 1]); i += 3 } }
        }
        if (s.has("w")) o.put("w", ((s.optDouble("w").toFloat() * f).coerceIn(0.01f, 60f) * 1000).roundToInt() / 1000.0)
        return out(o, p)
    }

    /** Bilder, Stempel, Textfelder bekommen eine eigene Drehung (r), Striche werden mitgedreht; Textmarkierungen bleiben. */
    fun rotate(s: JSONObject, deg: Float, cx: Float, cy: Float): JSONObject {
        val t = s.optString("t")
        if (deg == 0f || t == "tx") return JSONObject(s.toString()).put("id", Store.uid())
        val a = Math.toRadians(deg.toDouble()); val co = cos(a).toFloat(); val si = sin(a).toFloat()
        val rx = { x: Float, y: Float -> cx + (x - cx) * co - (y - cy) * si }
        val ry = { x: Float, y: Float -> cy + (x - cx) * si + (y - cy) * co }
        val p = Ink.pts(s).copyOf()
        val o = JSONObject(s.toString())
        when (t) {
            "txt", "img" -> if (p.size >= 2) {
                val w = s.optDouble("bw", 0.0).toFloat(); val h = s.optDouble("bh", 0.0).toFloat()
                val mx = p[0] + w / 2; val my = p[1] + h / 2
                p[0] = rx(mx, my) - w / 2; p[1] = ry(mx, my) - h / 2
                var nr = ((s.optDouble("r", 0.0).toFloat() + deg) % 360 + 360) % 360
                nr = (nr * 100).roundToInt() / 100f
                if (abs(nr) < 0.01f || abs(nr - 360) < 0.01f) o.remove("r") else o.put("r", nr.toDouble())
            }
            "sh" -> if (p.size >= 4) {
                val a0 = rx(p[0], p[1]); val b0 = ry(p[0], p[1]); val a1 = rx(p[2], p[3]); val b1 = ry(p[2], p[3])
                p[0] = a0; p[1] = b0; p[2] = a1; p[3] = b1
            }
            else -> { var i = 0; while (i + 1 < p.size) { val x = p[i]; val y = p[i + 1]; p[i] = rx(x, y); p[i + 1] = ry(x, y); i += 3 } }
        }
        return out(o, p)
    }
}
