package io.github.pdfstift

import android.content.Context
import android.view.View
import android.view.ViewGroup
import kotlin.math.max

/**
 * Fließende Anordnung ohne Scrollen: waagrecht = Zeilen, die bei Platzmangel umbrechen;
 * senkrecht = Spalten, die bei Platzmangel in eine weitere Spalte umbrechen.
 * Ein Kind mit tag == BREAK erzwingt eine neue Zeile bzw. Spalte.
 */
class Flow(ctx: Context, var vertical: Boolean) : ViewGroup(ctx) {
    companion object { const val BREAK = "break" }
    private val gap = (2 * resources.displayMetrics.density).toInt()

    override fun onMeasure(wSpec: Int, hSpec: Int) {
        val maxMain = if (vertical) MeasureSpec.getSize(hSpec).let { if (MeasureSpec.getMode(hSpec) == MeasureSpec.UNSPECIFIED) Int.MAX_VALUE else it }
                      else MeasureSpec.getSize(wSpec).let { if (MeasureSpec.getMode(wSpec) == MeasureSpec.UNSPECIFIED) Int.MAX_VALUE else it }
        var main = paddingTop.takeIf { vertical } ?: paddingLeft
        val endPad = if (vertical) paddingBottom else paddingRight
        var cross = if (vertical) paddingLeft else paddingTop
        var lineCross = 0; var usedMain = 0
        for (i in 0 until childCount) {
            val c = getChildAt(i)
            if (c.visibility == View.GONE) continue
            measureChild(c, MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED), MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED))
            val lp = c.layoutParams as? MarginLayoutParams
            val cm = if (vertical) c.measuredHeight + (lp?.topMargin ?: 0) + (lp?.bottomMargin ?: 0) else c.measuredWidth + (lp?.leftMargin ?: 0) + (lp?.rightMargin ?: 0)
            val cc = if (vertical) c.measuredWidth + (lp?.leftMargin ?: 0) + (lp?.rightMargin ?: 0) else c.measuredHeight + (lp?.topMargin ?: 0) + (lp?.bottomMargin ?: 0)
            val start = if (vertical) paddingTop else paddingLeft
            if (c.tag == BREAK || (main > start && main + cm + endPad > maxMain)) {
                cross += lineCross + gap * 2; main = start; lineCross = 0
                if (c.tag == BREAK) continue
            }
            main += cm + gap
            usedMain = max(usedMain, main)
            lineCross = max(lineCross, cc)
        }
        cross += lineCross + if (vertical) paddingRight else paddingBottom
        val w = if (vertical) cross else resolveSize(usedMain + endPad, wSpec)
        val h = if (vertical) resolveSize(usedMain + endPad, hSpec) else cross
        setMeasuredDimension(if (vertical) w else w, if (vertical) h else h)
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        val maxMain = if (vertical) b - t else r - l
        val start = if (vertical) paddingTop else paddingLeft
        val endPad = if (vertical) paddingBottom else paddingRight
        var main = start
        var cross = if (vertical) paddingLeft else paddingTop
        // erst die Zeilen bestimmen, damit Elemente in einer Zeile mittig ausgerichtet werden
        val lines = ArrayList<MutableList<View>>(); var cur = ArrayList<View>(); lines.add(cur)
        for (i in 0 until childCount) {
            val c = getChildAt(i)
            if (c.visibility == View.GONE) continue
            val lp = c.layoutParams as? MarginLayoutParams
            val cm = if (vertical) c.measuredHeight + (lp?.topMargin ?: 0) + (lp?.bottomMargin ?: 0) else c.measuredWidth + (lp?.leftMargin ?: 0) + (lp?.rightMargin ?: 0)
            if (c.tag == BREAK || (main > start && main + cm + endPad > maxMain)) {
                cur = ArrayList(); lines.add(cur); main = start
                if (c.tag == BREAK) continue
            }
            cur.add(c); main += cm + gap
        }
        for (line in lines) {
            if (line.isEmpty()) continue
            val lc = line.maxOf { c -> val lp = c.layoutParams as? MarginLayoutParams; if (vertical) c.measuredWidth + (lp?.leftMargin ?: 0) + (lp?.rightMargin ?: 0) else c.measuredHeight + (lp?.topMargin ?: 0) + (lp?.bottomMargin ?: 0) }
            var m = start
            for (c in line) {
                val lp = c.layoutParams as? MarginLayoutParams
                if (vertical) {
                    val x = cross + (lc - c.measuredWidth) / 2
                    val y = m + (lp?.topMargin ?: 0)
                    c.layout(x, y, x + c.measuredWidth, y + c.measuredHeight)
                    m = y + c.measuredHeight + (lp?.bottomMargin ?: 0) + gap
                } else {
                    val x = m + (lp?.leftMargin ?: 0)
                    val y = cross + (lc - c.measuredHeight) / 2
                    c.layout(x, y, x + c.measuredWidth, y + c.measuredHeight)
                    m = x + c.measuredWidth + (lp?.rightMargin ?: 0) + gap
                }
            }
            cross += lc + gap * 2
        }
    }

    override fun generateLayoutParams(p: LayoutParams?): LayoutParams = MarginLayoutParams(p)
    override fun generateDefaultLayoutParams(): LayoutParams = MarginLayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT)
    override fun checkLayoutParams(p: LayoutParams?) = p is MarginLayoutParams
}
