package io.github.pdfstift

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.RectF
import android.text.InputType
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Spinner
import androidx.appcompat.app.AlertDialog
import com.tom_roush.pdfbox.contentstream.operator.Operator
import com.tom_roush.pdfbox.cos.COSFloat
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.graphics.image.JPEGFactory
import com.tom_roush.pdfbox.pdmodel.graphics.image.LosslessFactory
import com.tom_roush.pdfbox.text.PDFTextStripper
import com.tom_roush.pdfbox.text.TextPosition
import com.tom_roush.pdfbox.util.Matrix
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// ==================================================================== Text bearbeiten
object TextEdit {
    /** eine Textzeile auf der angezeigten Seite: Grundlinie base, von x1 bis x2 */
    class Line(val text: String, val x1: Float, val x2: Float, val base: Float, val fs: Float, val family: String, val bold: Boolean)

    fun lines(file: java.io.File, pg: Int): List<Line> {
        val all = ArrayList<TextPosition>()
        PDDocument.load(file, MemoryUsageSetting.setupTempFileOnly()).use { d ->
            val st = object : PDFTextStripper() {
                override fun writeString(text: String?, pos: MutableList<TextPosition>?) { pos?.let { all.addAll(it) } }
            }
            st.sortByPosition = true; st.startPage = pg + 1; st.endPage = pg + 1
            st.getText(d)
        }
        val sorted = all.filter { (it.unicode ?: "").isNotEmpty() }.sortedWith(compareBy({ (it.yDirAdj / 2).roundToInt() }, { it.xDirAdj }))
        val out = ArrayList<Line>()
        var cur = ArrayList<TextPosition>()
        fun flush() {
            val c = cur.filter { !(it.unicode ?: "").isBlank() }
            if (c.isNotEmpty()) {
                val sb = StringBuilder()
                var lastX2 = -1f
                for (tp in cur) {
                    val u = tp.unicode ?: continue
                    if (u.isBlank()) { if (sb.isNotEmpty() && !sb.endsWith(" ")) sb.append(' '); lastX2 = tp.xDirAdj + tp.widthDirAdj; continue }
                    val fs = max(1f, tp.fontSizeInPt)
                    if (lastX2 >= 0 && tp.xDirAdj - lastX2 > fs * 0.2f && !sb.endsWith(" ")) sb.append(' ')
                    sb.append(u); lastX2 = tp.xDirAdj + tp.widthDirAdj
                }
                val fs = c.map { max(1f, it.fontSizeInPt) }.sorted()[c.size / 2]
                val fn = (c[0].font?.name ?: "").lowercase()
                val fam = when { "courier" in fn || "mono" in fn -> "Courier"; ("times" in fn || "serif" in fn || "georgia" in fn || "garamond" in fn) && "sans" !in fn -> "TimesRoman"; else -> "Helvetica" }
                val bold = listOf("bold", "black", "heavy", "semibold", "demi").any { it in fn }
                out.add(Line(sb.toString().trim(), c.first().xDirAdj, c.maxOf { it.xDirAdj + it.widthDirAdj }, c[0].yDirAdj, fs, fam, bold))
            }
            cur = ArrayList()
        }
        for (tp in sorted) {
            val l = cur.lastOrNull { !(it.unicode ?: "").isBlank() }
            if (l != null) {
                val fs = max(1f, l.fontSizeInPt)
                if (abs(tp.yDirAdj - l.yDirAdj) > fs * 0.4f || tp.xDirAdj - (l.xDirAdj + l.widthDirAdj) > fs * 2.5f) flush()
            }
            cur.add(tp)
        }
        flush()
        return out
    }

    /** Hintergrund- und Schriftfarbe unter der Zeile */
    private fun colors(bmp: Bitmap): Pair<Int, Int> {
        val count = HashMap<Int, Int>()
        val px = IntArray(bmp.width * bmp.height); bmp.getPixels(px, 0, bmp.width, 0, 0, bmp.width, bmp.height)
        for (c in px) { val q = c and 0xF0F0F0; count[q] = (count[q] ?: 0) + 1 }
        val bgQ = count.maxByOrNull { it.value }?.key ?: 0xF0F0F0
        val bgPx = px.filter { (it and 0xF0F0F0) == bgQ }
        val bg = if (bgPx.isEmpty()) Color.WHITE else Color.rgb(bgPx.map { Color.red(it) }.average().toInt(), bgPx.map { Color.green(it) }.average().toInt(), bgPx.map { Color.blue(it) }.average().toInt())
        fun dist(a: Int, b: Int) = abs(Color.red(a) - Color.red(b)) + abs(Color.green(a) - Color.green(b)) + abs(Color.blue(a) - Color.blue(b))
        val fg = px.maxByOrNull { dist(it, bg) } ?: Color.BLACK
        return bg to (if (dist(fg, bg) < 60) Color.BLACK else fg)
    }

    fun start(h: ToolHost) {
        h.doc.pick = "tap"
        h.doc.onPickTap = { pg, x, y -> tap(h, pg, x, y) }
        h.showMode("Text bearbeiten: Zeile antippen.", listOf("Fertig" to { h.endMode() }))
    }

    private fun tap(h: ToolHost, pg: Int, x: Float, y: Float) {
        val a = h.act
        Store.scope.launch {
            val res = withContext(Dispatchers.IO) {
                try {
                    val file = Store.pdfFile(h.docPath)
                    val ls = lines(file, pg)
                    val l = ls.firstOrNull { x >= it.x1 - it.fs * 0.3f && x <= it.x2 + it.fs * 0.3f && y >= it.base - it.fs * 1.0f && y <= it.base + it.fs * 0.35f }
                    if (l == null) Triple(ls.size, null, null) else {
                        val src = PdfSource(a, file)
                        val col = try {
                            val (w, hh) = src.size(pg); val sc = 3f
                            val bw = ((l.x2 - l.x1 + l.fs) * sc).toInt().coerceAtLeast(4); val bh = (l.fs * 1.4f * sc).toInt().coerceAtLeast(4)
                            val b = Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888); b.eraseColor(Color.WHITE)
                            src.render(pg, b, ((l.x1 - l.fs * 0.5f) * sc).toInt(), ((l.base - l.fs * 1.05f) * sc).toInt(), (w * sc).toInt(), (hh * sc).toInt())
                            colors(b).also { b.recycle() }
                        } finally { src.close() }
                        Triple(ls.size, l, col)
                    }
                } catch (e: Throwable) { Crash.report("Text bearbeiten: Zeilen lesen", e); Triple(0, null, null) }
            }
            val l = res.second
            if (l == null) { Ui.toast(a, if (res.first > 0) "Hier ist kein Text. Tippe direkt auf eine Zeile." else "Diese Seite hat keinen bearbeitbaren Text (Scan?). Erst „Scans optimieren“, dann geht es.", true); return@launch }
            dialog(h, pg, l, res.third ?: (Color.WHITE to Color.BLACK))
        }
    }

    private fun hex(c: Int) = String.format("#%06X", c and 0xFFFFFF)

    private fun dialog(h: ToolHost, pg: Int, l: Line, col: Pair<Int, Int>) {
        val a = h.act
        val dp = { v: Float -> Ui.dp(a, v) }
        val e = EditText(a).apply { setText(l.text); isSingleLine = true; selectAll() }
        val fams = listOf("Helvetica" to "Helvetica (ohne Serifen)", "TimesRoman" to "Times (mit Serifen)", "Courier" to "Courier (Schreibmaschine)")
        val sp = Spinner(a).apply { adapter = ArrayAdapter(a, android.R.layout.simple_spinner_dropdown_item, fams.map { it.second }); setSelection(fams.indexOfFirst { it.first == l.family }.coerceAtLeast(0)) }
        val bold = CheckBox(a).apply { text = "Fett"; isChecked = l.bold }
        val size = EditText(a).apply { setText(((l.fs * 2).roundToInt() / 2f).toString().removeSuffix(".0")); inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL; hint = "pt" }
        var color = hex(col.second)
        val colors = (listOf(color) + listOf("#000000", "#1F4FD6", "#D6262B", "#13804A", "#6B7280")).distinct()
        val swatches = Flow(a, false)
        val views = colors.map { c -> Glyph(a, "sw", Color.parseColor(c), Glyph.SWATCH).apply {
            layoutParams = ViewGroup.MarginLayoutParams(dp(34f), dp(34f)).apply { setMargins(dp(2f), dp(3f), dp(2f), dp(3f)) }
        } }
        fun mark() { views.forEachIndexed { i, v -> v.on = colors[i].equals(color, true) } }
        views.forEachIndexed { i, v -> v.setOnClickListener { color = colors[i]; mark() }; swatches.addView(v) }
        mark()
        val box = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(20f), 0, dp(20f), 0)
            addView(e, Ui.lp()); addView(sp, Ui.lp())
            addView(LinearLayout(a).apply { addView(bold); addView(Ui.text(a, "   Größe (pt): ", 14f, Ui.MUTED)); addView(size, LinearLayout.LayoutParams(dp(90f), -2)) })
            addView(swatches, Ui.lp())
        }
        AlertDialog.Builder(a).setTitle("Zeile ändern").setView(box).setNegativeButton("Abbrechen", null).setPositiveButton("Übernehmen") { _, _ ->
            val t = e.text.toString()
            val fam = fams[sp.selectedItemPosition].first
            val fs = size.text.toString().replace(',', '.').toFloatOrNull()?.coerceIn(3f, 144f) ?: l.fs
            replace(h, pg, l, t, fam, bold.isChecked, fs, color, hex(col.first))
        }.show()
        e.requestFocus()
    }

    private fun replace(h: ToolHost, pg: Int, l: Line, text: String, fam: String, bold: Boolean, fs: Float, color: String, bg: String) {
        Acro.apply(h, "Text ändern", "Text wird geändert …", "Text geändert.") { d ->
            val page = d.getPage(pg)
            val scan = Pdfx.Scan(page)
            fun onLine(s: Pdfx.Show) = abs(s.y - l.base) < l.fs * 0.45f && s.x >= l.x1 - l.fs * 0.3f && s.x < l.x2 - 0.5f
            val ids = scan.shows.filter { onLine(it) && it.x2 <= l.x2 + l.fs }.map { it.idx }
            val blocked = scan.shows.any { onLine(it) && it.x2 > l.x2 + l.fs }
            var clean = false
            if (ids.isNotEmpty()) {
                Pdfx.writeContent(d, page, scan.removeOps(ids))
                clean = !blocked && Pdfx.Scan(page).shows.none { abs(it.y - l.base) < l.fs * 0.45f && it.x2 > l.x1 + 1 && it.x < l.x2 - 1 }
            }
            PDPageContentStream(d, page, PDPageContentStream.AppendMode.APPEND, true, true).use { cs ->
                cs.saveGraphicsState(); cs.transform(Pdfx.displayMatrix(page))
                if (!clean) {
                    // alter Text liegt woanders (z. B. in einer Gruppe): abdecken
                    val c = Pdfx.rgb(bg); cs.setNonStrokingColor(c[0], c[1], c[2])
                    val pad = l.fs * 0.08f
                    cs.addRect(l.x1 - pad, l.base - l.fs * 0.85f - pad, l.x2 - l.x1 + pad * 2, l.fs * 1.12f + pad * 2); cs.fill()
                }
                val f = Pdfx.stdFont(fam, bold)
                val t = Pdfx.encodable(f, text)
                if (t.isNotBlank()) Acro.drawText(cs, f, fs, t, l.x1, l.base, Pdfx.rgb(color))
                cs.restoreGraphicsState()
            }
            Pdfx.markPage(d, page)
            true
        }
    }
}

// ==================================================================== Bilder bearbeiten
object ImgEdit {
    private class Sel(val pg: Int, val idx: Int, val box: RectF, val inline: Boolean)
    private var sel: Sel? = null
    private var moved: RectF? = null

    fun start(h: ToolHost) {
        sel = null; moved = null
        h.doc.pick = "tap"
        h.doc.onPickTap = { pg, x, y -> tap(h, pg, x, y) }
        h.doc.onPickSel = { _, r -> moved = r; h.modeText("Verschoben/geändert – „Übernehmen“ speichert es in der PDF.") }
        bar(h)
        scanBoxes(h, h.doc.currentPage())
    }

    private fun bar(h: ToolHost) {
        val s = sel
        if (s == null) h.showMode("Bilder bearbeiten: Bild antippen.", listOf("Fertig" to { h.endMode() }))
        else h.showMode("An den Ecken ziehen = Größe, in der Mitte = verschieben.", listOf(
            "Übernehmen" to { applyMove(h) }, "Ersetzen …" to { replace(h) }, "Löschen" to { delete(h) }, "Fertig" to { h.endMode() }))
    }

    private suspend fun images(h: ToolHost, pg: Int): List<Pdfx.Img> = withContext(Dispatchers.IO) {
        try { PDDocument.load(Store.pdfFile(h.docPath), MemoryUsageSetting.setupTempFileOnly()).use { d -> Pdfx.Scan(d.getPage(pg)).imgs } }
        catch (e: Throwable) { Crash.report("Bilder lesen", e); emptyList() }
    }

    private fun scanBoxes(h: ToolHost, pg: Int) {
        Store.scope.launch {
            val ims = images(h, pg)
            if (h.doc.pick != null) h.doc.pickBoxes = ims.map { pg to it.box }
        }
    }

    private fun tap(h: ToolHost, pg: Int, x: Float, y: Float) {
        Store.scope.launch {
            val ims = images(h, pg)
            if (h.doc.pick == null) return@launch
            h.doc.pickBoxes = ims.map { pg to it.box }
            val hit = ims.lastOrNull { it.box.contains(x, y) && it.box.width() < 5000 }
            if (hit == null) { Ui.toast(h.act, if (ims.isEmpty()) "Auf dieser Seite gibt es keine bearbeitbaren Bilder (Bilder in Gruppen oder Scans gehen nicht)." else "Hier ist kein Bild – die blauen Rahmen zeigen die Bilder."); return@launch }
            sel = Sel(pg, hit.idx, RectF(hit.box), hit.inline); moved = null
            h.doc.pickSel = pg to RectF(hit.box)
            bar(h)
        }
    }

    /** Verschiebung/Größe als Matrix im Raum des Bildes (wird vor „Do“ eingefügt) */
    private fun cmFor(page: com.tom_roush.pdfbox.pdmodel.PDPage, ctm: Matrix, b0: RectF, b1: RectF): Matrix {
        val sx = b1.width() / max(1e-3f, b0.width()); val sy = b1.height() / max(1e-3f, b0.height())
        val pDisp = Matrix(sx, 0f, 0f, sy, b1.left - b0.left * sx, b1.top - b0.top * sy)
        val dm = Pdfx.displayMatrix(page)
        val pUser = Pdfx.inverse(dm).multiply(pDisp).multiply(dm)
        return ctm.multiply(pUser).multiply(Pdfx.inverse(ctm))
    }

    private fun wrap(tokens: MutableList<Any>, idx: Int, inline: Boolean, m: Matrix): MutableList<Any> {
        val start = if (inline) idx else idx - 1   // Name vor „Do“
        val out = ArrayList<Any>(tokens.size + 10)
        out.addAll(tokens.subList(0, start))
        out.add(Operator.getOperator("q"))
        for (v in listOf(m.scaleX, m.shearY, m.shearX, m.scaleY, m.translateX, m.translateY)) out.add(COSFloat(v))
        out.add(Operator.getOperator("cm"))
        out.addAll(tokens.subList(start, idx + 1))
        out.add(Operator.getOperator("Q"))
        out.addAll(tokens.subList(idx + 1, tokens.size))
        return out
    }

    private fun applyMove(h: ToolHost) {
        val s = sel ?: return; val nb = moved ?: run { Ui.toast(h.act, "Noch nichts verändert."); return }
        Acro.apply(h, "Bild ändern", "Bild wird geändert …", "Bild geändert.") { d ->
            val page = d.getPage(s.pg)
            val scan = Pdfx.Scan(page)
            val im = scan.imgs.firstOrNull { it.idx == s.idx } ?: throw IllegalStateException("Bild nicht mehr gefunden.")
            Pdfx.writeContent(d, page, wrap(scan.tokens, im.idx, im.inline, cmFor(page, im.ctm, im.box, nb)))
            Pdfx.markPage(d, page); true
        }
        done(h)
    }

    private fun delete(h: ToolHost) {
        val s = sel ?: return
        Ui.alert(h.act, "Bild löschen?", "Das Bild wird aus der PDF entfernt (rückgängig über ⋯ → Rückgängig).", "Löschen", "Abbrechen") {
            Acro.apply(h, "Bild löschen", "Bild wird entfernt …", "Bild gelöscht.") { d ->
                val page = d.getPage(s.pg)
                val scan = Pdfx.Scan(page)
                Pdfx.writeContent(d, page, scan.removeOps(listOf(s.idx)))
                Pdfx.markPage(d, page); true
            }
            done(h)
        }
    }

    private fun replace(h: ToolHost) {
        val s = sel ?: return
        h.pickImage { bmp ->
            Acro.apply(h, "Bild ersetzen", "Bild wird ersetzt …", "Bild ersetzt.") { d ->
                val page = d.getPage(s.pg)
                val scan = Pdfx.Scan(page)
                val im = scan.imgs.firstOrNull { it.idx == s.idx } ?: throw IllegalStateException("Bild nicht mehr gefunden.")
                val img = if (bmp.hasAlpha()) LosslessFactory.createFromImage(d, bmp) else JPEGFactory.createFromImage(d, bmp, 0.9f)
                val res = page.resources
                val name = res.add(img)
                page.resources = res
                // neues Bild im alten Rahmen einpassen (Seitenverhältnis bleibt)
                val b0 = moved ?: im.box
                val ar = bmp.width.toFloat() / max(1, bmp.height)
                val w = min(b0.width(), b0.height() * ar); val hh = w / ar
                val fit = RectF(b0.centerX() - w / 2, b0.centerY() - hh / 2, b0.centerX() + w / 2, b0.centerY() + hh / 2)
                val toks = scan.tokens.toMutableList()
                if (im.inline) { toks[im.idx] = Operator.getOperator("Do"); toks.add(im.idx, name) } else toks[im.idx - 1] = name
                val at = if (im.inline) im.idx + 1 else im.idx
                Pdfx.writeContent(d, page, wrap(toks, at, false, cmFor(page, im.ctm, im.box, fit)))
                Pdfx.markPage(d, page); true
            }
            done(h)
        }
    }

    private fun done(h: ToolHost) {
        sel = null; moved = null
        h.doc.pickSel = null
        bar(h)
        h.doc.postDelayed({ if (h.doc.pick != null) scanBoxes(h, h.doc.currentPage()) }, 1500)
    }
}
