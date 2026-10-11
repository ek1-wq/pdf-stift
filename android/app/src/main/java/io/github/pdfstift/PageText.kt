package io.github.pdfstift

import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper
import com.tom_roush.pdfbox.text.TextPosition
import java.io.File
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Zeichen einer Seite mit Lage (angezeigte Seite, Punkte, oben links) – für „Text markieren“ */
class CharBox(val x: Float, val y: Float, val w: Float, val h: Float)

class PageText(private val file: File) {
    private var doc: PDDocument? = null
    private class Pg(val chars: List<CharBox>, val text: String, val map: IntArray)
    private val pages = HashMap<Int, Pg>()

    @Synchronized
    private fun page(i: Int): Pg = pages.getOrPut(i) {
        try {
            val d = doc ?: PDDocument.load(file, MemoryUsageSetting.setupTempFileOnly()).also { doc = it }
            val out = ArrayList<CharBox>()
            val sb = StringBuilder()
            val map = ArrayList<Int>()   // je Zeichen im Text: Index in out (oder -1)
            val st = object : PDFTextStripper() {
                override fun writeString(text: String?, positions: MutableList<TextPosition>?) {
                    positions?.forEach { tp ->
                        val u = tp.unicode ?: return@forEach
                        val fs = max(tp.fontSizeInPt, tp.heightDir)
                        val w = tp.widthDirAdj
                        val idx = if (w > 0 && u.isNotBlank()) { out.add(CharBox(tp.xDirAdj, tp.yDirAdj - fs * 0.8f, w, fs * 1.0f)); out.size - 1 } else -1
                        for (ch in u) { sb.append(ch); map.add(idx) }
                    }
                    sb.append(' '); map.add(-1)
                }
            }
            st.sortByPosition = false
            st.startPage = i + 1; st.endPage = i + 1
            st.getText(d)
            Pg(out, sb.toString(), map.toIntArray())
        } catch (e: Throwable) { Pg(emptyList(), "", IntArray(0)) }
    }

    fun chars(i: Int): List<CharBox> = page(i).chars

    /** Fundstellen auf Seite i: je Treffer die Rechtecke (x,y,w,h,…) */
    fun find(i: Int, q: String): List<List<Float>> {
        val pg = page(i)
        if (q.isBlank() || pg.text.isEmpty()) return emptyList()
        val hay = norm(pg.text); val needle = norm(q.trim())
        val res = ArrayList<List<Float>>()
        var from = 0
        while (true) {
            val k = hay.indexOf(needle, from)
            if (k < 0 || res.size > 200) break
            val idx = (k until k + needle.length).mapNotNull { pg.map.getOrNull(it)?.takeIf { x -> x >= 0 } }.distinct()
            if (idx.isNotEmpty()) {
                val boxes = idx.map { pg.chars[it] }
                res.add(merge(boxes))
            }
            from = k + needle.length
        }
        return res
    }

    /** Fundstellen mehrerer Suchmuster (auf kleingeschriebenem Text); null = Seite hat keinen Text */
    fun findRegex(i: Int, pats: List<Pair<Regex, (String) -> Boolean>>): List<List<Float>>? {
        val pg = page(i)
        if (pg.text.isBlank()) return null
        val hay = norm(pg.text)
        val res = ArrayList<List<Float>>()
        for ((re, ok) in pats) for (m in re.findAll(hay)) {
            if (m.value.isEmpty() || !ok(m.value) || res.size > 2000) continue
            val idx = (m.range.first..m.range.last).mapNotNull { pg.map.getOrNull(it)?.takeIf { x -> x >= 0 } }.distinct()
            if (idx.isNotEmpty()) res.add(merge(idx.map { pg.chars[it] }))
        }
        return res
    }

    /** Groß/klein und Mehrfach-Leerzeichen egal */
    private fun norm(s: String): String = s.lowercase().replace('\u00A0', ' ')

    @Synchronized
    fun close() { try { doc?.close() } catch (e: Exception) { }; doc = null; pages.clear() }

    companion object {
        private fun nearest(c: List<CharBox>, x: Float, y: Float): Int {
            var best = -1; var bd = Float.MAX_VALUE
            for ((i, b) in c.withIndex()) {
                val dx = if (x < b.x) b.x - x else if (x > b.x + b.w) x - b.x - b.w else 0f
                val dy = if (y < b.y) b.y - y else if (y > b.y + b.h) y - b.y - b.h else 0f
                val d = hypot(dx, dy * 2)
                if (d < bd) { bd = d; best = i }
            }
            return if (bd < 40) best else -1
        }

        fun merge(c: List<CharBox>): List<Float> {
            val out = ArrayList<FloatArray>()
            for (it in c) {
                val last = out.lastOrNull()
                if (last != null && abs(last[1] - it.y) < it.h * 0.5f && it.x >= last[0] - 1 && it.x - (last[0] + last[2]) < it.h * 2) {
                    val nx2 = max(last[0] + last[2], it.x + it.w); val ny2 = max(last[1] + last[3], it.y + it.h)
                    last[1] = min(last[1], it.y); last[3] = ny2 - last[1]; last[2] = nx2 - last[0]
                } else out.add(floatArrayOf(it.x, it.y, it.w, it.h))
            }
            return out.flatMap { listOf(it[0], it[1], it[2], it[3]) }
        }

        /** Rechtecke (x,y,w,h, …) für den markierten Bereich von Punkt a bis b – zeilenweise zusammengefasst */
        fun rects(c: List<CharBox>, ax: Float, ay: Float, bx: Float, by: Float): List<Float> {
            if (c.isEmpty()) return emptyList()
            var i0 = nearest(c, ax, ay); var i1 = nearest(c, bx, by)
            if (i0 < 0 || i1 < 0) return emptyList()
            if (i0 > i1) { val t = i0; i0 = i1; i1 = t }
            val out = ArrayList<FloatArray>()
            for (i in i0..i1) {
                val it = c[i]
                val last = out.lastOrNull()
                if (last != null && abs(last[1] - it.y) < it.h * 0.5f && it.x >= last[0] - 1 && it.x - (last[0] + last[2]) < it.h * 2) {
                    val nx2 = max(last[0] + last[2], it.x + it.w)
                    val ny2 = max(last[1] + last[3], it.y + it.h)
                    last[1] = min(last[1], it.y); last[3] = ny2 - last[1]; last[2] = nx2 - last[0]
                } else out.add(floatArrayOf(it.x, it.y, it.w, it.h))
            }
            val r2 = { v: Float -> (v * 100).roundToInt() / 100f }
            return out.flatMap { listOf(r2(it[0]), r2(it[1]), r2(it[2]), r2(it[3])) }
        }
    }
}
