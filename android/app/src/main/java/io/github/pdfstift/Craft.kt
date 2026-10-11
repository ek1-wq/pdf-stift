package io.github.pdfstift

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.text.InputType
import android.widget.ArrayAdapter
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Spinner
import androidx.appcompat.app.AlertDialog
import com.tom_roush.pdfbox.cos.COSName
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.multipdf.LayerUtility
import com.tom_roush.pdfbox.pdfparser.PDFStreamParser
import com.tom_roush.pdfbox.contentstream.operator.Operator
import com.tom_roush.pdfbox.cos.COSNumber
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.PDResources
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle
import com.tom_roush.pdfbox.pdmodel.font.PDType1Font
import com.tom_roush.pdfbox.pdmodel.graphics.image.JPEGFactory
import com.tom_roush.pdfbox.text.PDFTextStripper
import com.tom_roush.pdfbox.util.Matrix
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

// Ideen aus PDFCraft, selbst gebaut: Suchen & Schwärzen, Handzettel, Scans aufbereiten (wie in der Web-/Windows-App)

private fun check(a: android.content.Context, label: String, on: Boolean, hint: String? = null): Pair<LinearLayout, CheckBox> {
    val cb = CheckBox(a).apply { text = label; isChecked = on }
    val l = LinearLayout(a).apply {
        orientation = LinearLayout.VERTICAL; addView(cb)
        if (hint != null) addView(Ui.text(a, hint, 13f, Ui.MUTED).apply { setPadding(Ui.dp(a, 32f), 0, 0, Ui.dp(a, 6f)) })
    }
    return l to cb
}

// ==================================================================== Suchen & Schwärzen
object FindRedact {
    private class Pre(val key: String, val label: String, val re: Regex, val ok: (String) -> Boolean = { true })
    private val PRESETS = listOf(
        Pre("mail", "E-Mail-Adressen", Regex("[a-z0-9._%+-]+@[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.[a-z]{2,}")),
        Pre("tel", "Telefonnummern", Regex("(?:\\+\\d|\\b0)[\\d /()\\-]{5,}\\d")) { m -> m.count { it.isDigit() } in 7..15 },
        Pre("iban", "IBAN (Kontonummern)", Regex("\\b[a-z]{2}\\d{2}(?: ?[a-z0-9]{4}){3,7}(?: ?[a-z0-9]{1,3})?\\b")),
        Pre("matr", "Matrikelnummern (6- bis 8-stellige Zahlen)", Regex("(?<![\\d.,])\\d{6,8}(?!\\d|[.,]\\d)")),
        Pre("date", "Datumsangaben (z. B. 12.03.2001)", Regex("\\b\\d{1,2}\\.\\s?\\d{1,2}\\.\\s?(?:\\d{4}|\\d{2})\\b")),
    )

    fun start(h: ToolHost) {
        val a = h.act; val p = Store.prefs()
        val dp = { v: Float -> Ui.dp(a, v) }
        val terms = EditText(a).apply {
            setText(p.getString("frTerms", "")); hint = "Wörter oder Namen, ein Begriff pro Zeile"; minLines = 3
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
        }
        val sel = p.getStringSet("frPre", emptySet()) ?: emptySet()
        val boxes = PRESETS.map { pr -> pr to CheckBox(a).apply { text = pr.label; isChecked = pr.key in sel } }
        val (wl, word) = check(a, "Nur ganze Wörter (bei den eigenen Begriffen)", p.getBoolean("frWord", true))
        val box = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(20f), dp(8f), dp(20f), 0)
            addView(Ui.text(a, "Alle passenden Stellen werden schwarz vorgemerkt. Danach prüfen, einzelne antippen zum Entfernen – erst „Anwenden“ schwärzt endgültig.", 13f, Ui.MUTED))
            addView(terms, Ui.lp())
            addView(Ui.text(a, "Außerdem automatisch finden", 13f, Ui.MUTED, true).apply { setPadding(0, dp(10f), 0, 0) })
            boxes.forEach { addView(it.second) }
            addView(wl)
        }
        AlertDialog.Builder(a).setTitle("Suchen und schwärzen").setView(android.widget.ScrollView(a).apply { addView(box) })
            .setNegativeButton("Abbrechen", null)
            .setPositiveButton("Suchen") { _, _ ->
                val list = terms.text.toString().split('\n').map { it.trim() }.filter { it.isNotEmpty() }
                val pre = boxes.filter { it.second.isChecked }.map { it.first }
                p.edit().putString("frTerms", list.joinToString("\n")).putStringSet("frPre", pre.map { it.key }.toSet()).putBoolean("frWord", word.isChecked).apply()
                if (list.isEmpty() && pre.isEmpty()) { Ui.toast(a, "Bitte einen Begriff eingeben oder etwas zum automatischen Finden auswählen."); return@setPositiveButton }
                search(h, list, pre, word.isChecked)
            }.show()
    }

    private fun search(h: ToolHost, terms: List<String>, pre: List<Pre>, whole: Boolean) {
        val a = h.act
        val pats = terms.map { t ->
            val e = Regex.escape(t.lowercase()).replace(Regex("\\s+"), "\\\\E\\\\s*\\\\Q")
            Regex(if (whole) "(?<![\\p{L}\\d])$e(?![\\p{L}\\d])" else e) to { _: String -> true }
        } + pre.map { it.re to it.ok }
        val pr = Ui.Progress(a, "Wird durchsucht …")
        val path = h.docPath
        Store.scope.launch {
            var noText = 0; var n = 0
            val found = withContext(Dispatchers.IO) {
                val out = HashMap<Int, ArrayList<RectF>>()
                val pt = PageText(Store.pdfFile(path))
                try {
                    val count = h.doc.pageCount
                    for (i in 0 until count) {
                        a.runOnUiThread { pr.label.text = "Seite ${i + 1} von $count"; pr.set(i.toLong(), count.toLong()) }
                        val hits = pt.findRegex(i, pats)
                        if (hits == null) { noText++; continue }
                        for (rects in hits) {
                            n++
                            var k = 0
                            while (k + 3 < rects.size) {
                                val hh = rects[k + 3]; val pad = hh * 0.12f; val padX = hh * 0.2f
                                out.getOrPut(i) { ArrayList() }.add(RectF(rects[k] - padX, rects[k + 1] - pad, rects[k] + rects[k + 2] + padX, rects[k + 1] + hh + pad))
                                k += 4
                            }
                        }
                    }
                } finally { pt.close() }
                out
            }
            pr.close()
            if (h.docPath != path) return@launch
            val scanHint = if (noText > 0) " $noText ${if (noText == 1) "Seite hat" else "Seiten haben"} keinen erkannten Text (Scan) – dort bitte zuerst „Scans optimieren“." else ""
            if (found.isEmpty()) { Ui.alert(a, "Nichts gefunden", "Keine passende Stelle gefunden.$scanHint"); return@launch }
            Redact.start(h)
            for ((i, l) in found) h.doc.pickRects.getOrPut(i) { ArrayList() }.addAll(l)
            h.doc.invalidate()
            Redact.upd(h)
            h.doc.goTo(found.keys.minOrNull() ?: 0)
            Ui.toast(a, "$n ${if (n == 1) "Stelle" else "Stellen"} auf ${found.size} ${if (found.size == 1) "Seite" else "Seiten"} gefunden – bitte prüfen, dann „Anwenden“.$scanHint", true)
        }
    }
}

// ==================================================================== Handzettel
object Handout {
    private val OPTS = listOf("1l" to "1 Folie mit Linien darunter", "2" to "2 Folien pro Seite", "3l" to "3 Folien mit Linien für Notizen", "4" to "4 Folien pro Seite", "6" to "6 Folien pro Seite", "9" to "9 Folien pro Seite")

    fun start(h: ToolHost) {
        val a = h.act; val p = Store.prefs()
        val dp = { v: Float -> Ui.dp(a, v) }
        val sp = Spinner(a).apply {
            adapter = ArrayAdapter(a, android.R.layout.simple_spinner_dropdown_item, OPTS.map { it.second })
            setSelection(OPTS.indexOfFirst { it.first == p.getString("hoN", "3l") }.coerceAtLeast(0))
        }
        val pages = EditText(a).apply { hint = "Seiten: alle (oder z. B. 1-20)"; isSingleLine = true }
        val (l1, frame) = check(a, "Rahmen um jede Folie", p.getBoolean("hoFrame", true))
        val (l2, num) = check(a, "Foliennummer anzeigen", p.getBoolean("hoNum", true))
        val (l3, head) = check(a, "Kopfzeile mit Dateiname und Seitenzahl", p.getBoolean("hoHead", true))
        val (l4, notes) = check(a, "Mit meinen Notizen und Markierungen", p.getBoolean("hoNotes", true))
        val box = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(20f), dp(8f), dp(20f), 0)
            addView(Ui.text(a, "Mehrere Seiten (z. B. Folien) verkleinert auf ein A4-Blatt – zum Ausdrucken und Mitschreiben. Es entsteht eine neue PDF im selben Ordner.", 13f, Ui.MUTED))
            addView(sp); addView(pages, Ui.lp()); addView(l1); addView(l2); addView(l3); addView(l4)
        }
        AlertDialog.Builder(a).setTitle("Handzettel").setView(android.widget.ScrollView(a).apply { addView(box) }).setNegativeButton("Abbrechen", null)
            .setPositiveButton("Erstellen") { _, _ ->
                val n = OPTS[sp.selectedItemPosition.coerceIn(0, OPTS.size - 1)].first
                p.edit().putString("hoN", n).putBoolean("hoFrame", frame.isChecked).putBoolean("hoNum", num.isChecked).putBoolean("hoHead", head.isChecked).putBoolean("hoNotes", notes.isChecked).apply()
                val total = h.doc.pageCount
                val idx = if (pages.text.isBlank()) (0 until total).toList() else Tools.parsePages(pages.text.toString(), total)
                if (idx.isEmpty()) { Ui.toast(a, "Keine gültigen Seitenzahlen erkannt."); return@setPositiveButton }
                build(h, idx, n, frame.isChecked, num.isChecked, head.isChecked, notes.isChecked)
            }.show()
    }

    private fun build(h: ToolHost, idx: List<Int>, n: String, frame: Boolean, num: Boolean, head: Boolean, withNotes: Boolean) {
        val a = h.act
        val path = h.docPath
        val stem = path.substringAfterLast('/').removeSuffix(".pdf")
        val pr = Ui.Progress(a, "Handzettel wird erstellt …")
        Store.scope.launch {
            val dir = File(a.cacheDir, "handzettel").apply { deleteRecursively(); mkdirs() }
            val src = File(dir, "quelle.pdf")
            val out = File(dir, "$stem (Handzettel).pdf")
            val ok = (if (withNotes) Burn.export(path, src) else withContext(Dispatchers.IO) { Store.pdfFile(path).copyTo(src, true); true }) &&
                withContext(Dispatchers.IO) { try { make(src, out, idx, n, frame, num, head, stem); true } catch (e: Throwable) { Crash.report("Handzettel", e); false } }
            if (!ok) { pr.close(); Ui.alert(a, "Nicht erstellt", "Der Handzettel ließ sich nicht erstellen."); return@launch }
            try {
                val r = Api.upload(h.folder, out.name, out)
                val saved = r.optJSONArray("saved")?.optString(0)
                pr.close()
                if (saved.isNullOrEmpty()) { Ui.alert(a, "Nicht gespeichert", r.optJSONArray("errors")?.optString(0) ?: "Der Server hat die Datei nicht angenommen."); return@launch }
                withContext(Dispatchers.IO) { Store.pdfFile(saved).also { it.parentFile?.mkdirs(); out.copyTo(it, true) } }
                Store.markLocal(saved, System.currentTimeMillis() / 1000, out.length())
                Ui.alert(a, "Handzettel erstellt", "„${saved.substringAfterLast('/').removeSuffix(".pdf")}“ liegt im selben Ordner.", "Öffnen", "Schließen") { h.openPath(saved) }
            } catch (e: Exception) {
                pr.close()
                val f = File(File(a.cacheDir, "share").apply { mkdirs() }, out.name)
                out.copyTo(f, true)
                Ui.alert(a, "Nicht hochgeladen", "Ohne Verbindung kann der Handzettel nicht in die Bibliothek. Du kannst ihn aber weitergeben oder drucken.", "Weitergeben", "Schließen") { Acro.shareFile(a, f, "application/pdf", "Handzettel weitergeben") }
            }
        }
    }

    /** Anzeige-Matrix: Inhalt der Seite (mit Drehung) → Fläche W × H, unten links bei 0,0 */
    private fun dispM(page: PDPage): Matrix {
        val b = page.cropBox
        val llx = b.lowerLeftX; val lly = b.lowerLeftY; val urx = b.upperRightX; val ury = b.upperRightY
        return when (((page.rotation % 360) + 360) % 360) {
            90 -> Matrix(0f, -1f, 1f, 0f, -lly, urx)
            180 -> Matrix(-1f, 0f, 0f, -1f, urx, ury)
            270 -> Matrix(0f, 1f, -1f, 0f, ury, -llx)
            else -> Matrix(1f, 0f, 0f, 1f, -llx, -lly)
        }
    }

    private fun make(srcF: File, outF: File, idx: List<Int>, n: String, frame: Boolean, num: Boolean, head: Boolean, title: String) {
        PDDocument.load(srcF, MemoryUsageSetting.setupTempFileOnly()).use { src ->
            PDDocument().use { out ->
                val lu = LayerUtility(out)
                val font = PDType1Font.HELVETICA
                val pages = idx.map { src.getPage(it) }
                val dims = pages.map { p -> val (w, hh) = Acro.dispSize(p); w to hh }
                val portraitSrc = dims.count { it.second > it.first } > dims.size / 2
                val (cols, rows) = when (n) { "1l" -> 1 to 1; "2" -> if (portraitSrc) 2 to 1 else 1 to 2; "3l" -> 1 to 3; "4" -> 2 to 2; "6" -> 2 to 3; "9" -> 3 to 3; else -> 2 to 2 }
                val land = n == "2" && portraitSrc
                val pw = if (land) 841.89f else 595.28f; val ph = if (land) 595.28f else 841.89f
                val m = 36f; val headH = if (head) 18f else 0f; val gap = 14f; val numH = if (num) 11f else 0f
                val per = cols * rows
                val sheets = (pages.size + per - 1) / per
                for (s in 0 until sheets) {
                    val pg = PDPage(PDRectangle(pw, ph)); out.addPage(pg)
                    PDPageContentStream(out, pg).use { cs ->
                        fun text(t: String, x: Float, y: Float, size: Float) {
                            cs.beginText(); cs.setFont(font, size); cs.setNonStrokingColor(0.55f, 0.55f, 0.58f)
                            cs.newLineAtOffset(x, y); cs.showText(Pdfx.encodable(font, t)); cs.endText()
                        }
                        if (head) {
                            text(title.take(90), m, ph - m + 4f, 9f)
                            val r = "Seite ${s + 1} von $sheets"
                            text(r, pw - m - font.getStringWidth(r) / 1000f * 9f, ph - m + 4f, 9f)
                        }
                        val areaW = pw - 2 * m; val areaH = ph - 2 * m - headH
                        val cw = (areaW - (cols - 1) * gap) / cols; val ch = (areaH - (rows - 1) * gap) / rows
                        for (k in 0 until per) {
                            val e = s * per + k
                            if (e >= pages.size) break
                            val c = k % cols; val r = k / cols
                            val cx = m + c * (cw + gap); val cyTop = ph - m - headH - r * (ch + gap)
                            val sw = if (n == "3l") cw * 0.55f else cw
                            val sh = (if (n == "1l") ch * 0.55f else ch) - numH
                            val (w, hh) = dims[e]
                            val sc = min(sw / w, sh / hh)
                            val bw = w * sc; val bh = hh * sc
                            val bx = when (n) { "3l" -> cx; "1l" -> cx + (cw - bw) / 2; else -> cx + (sw - bw) / 2 }
                            val by = if (n == "1l") cyTop - numH - bh else cyTop - numH - (sh - bh) / 2 - bh
                            val form = lu.importPageAsForm(src, pages[e])
                            form.setMatrix(com.tom_roush.harmony.awt.geom.AffineTransform())
                            val d = dispM(pages[e])
                            cs.saveGraphicsState()
                            cs.addRect(bx, by, bw, bh); cs.clip()
                            cs.transform(Matrix(sc * d.scaleX, sc * d.shearY, sc * d.shearX, sc * d.scaleY, bx + sc * d.translateX, by + sc * d.translateY))
                            cs.drawForm(form)
                            cs.restoreGraphicsState()
                            if (frame) { cs.setStrokingColor(0.55f, 0.55f, 0.58f); cs.setLineWidth(0.6f); cs.addRect(bx, by, bw, bh); cs.stroke() }
                            if (num) text("${idx[e] + 1}", bx, by + bh + 3f, 8f)
                            if (n.endsWith("l")) {
                                val lx0 = if (n == "3l") bx + bw + 16f else cx; val lx1 = cx + cw
                                var y = if (n == "3l") cyTop - 10f else by - 26f
                                val ly1 = cyTop - ch + 6f
                                cs.setStrokingColor(0.78f, 0.78f, 0.8f); cs.setLineWidth(0.5f)
                                while (y >= ly1) { cs.moveTo(lx0, y); cs.lineTo(lx1, y); cs.stroke(); y -= 20f }
                            }
                        }
                    }
                }
                out.documentInformation.title = "$title (Handzettel)"
                out.save(outF)
            }
        }
    }
}

// ==================================================================== Scans aufbereiten
object ScanFix {
    fun start(h: ToolHost) {
        val a = h.act; val p = Store.prefs()
        val dp = { v: Float -> Ui.dp(a, v) }
        val (l1, deskew) = check(a, "Schiefe Seiten gerade richten", p.getBoolean("sfDeskew", true))
        val (l2, blank) = check(a, "Leere Seiten entfernen", p.getBoolean("sfBlank", true), "auch leere Rückseiten; Seiten mit Notizen bleiben immer drin")
        val (l3, contrast) = check(a, "Kontrast verstärken", p.getBoolean("sfContrast", true), "grauer Hintergrund wird weiß, blasse Schrift und Bleistift werden dunkler")
        val (l4, gray) = check(a, "In Graustufen speichern", p.getBoolean("sfGray", false), "kleinere Datei; Farben gehen verloren")
        val box = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(20f), dp(8f), dp(20f), 0)
            addView(Ui.text(a, "Für eingescannte Seiten, z. B. Klausuren. Seiten mit echtem Text bleiben unverändert. Die vorige Fassung bleibt gesichert.", 13f, Ui.MUTED))
            addView(l1); addView(l2); addView(l3); addView(l4)
        }
        AlertDialog.Builder(a).setTitle("Scans aufbereiten").setView(android.widget.ScrollView(a).apply { addView(box) }).setNegativeButton("Abbrechen", null)
            .setPositiveButton("Aufbereiten") { _, _ ->
                p.edit().putBoolean("sfDeskew", deskew.isChecked).putBoolean("sfBlank", blank.isChecked).putBoolean("sfContrast", contrast.isChecked).putBoolean("sfGray", gray.isChecked).apply()
                if (deskew.isChecked || blank.isChecked || contrast.isChecked || gray.isChecked) run(h, deskew.isChecked, blank.isChecked, contrast.isChecked, gray.isChecked)
            }.show()
    }

    private class Gray(val g: IntArray, val w: Int, val h: Int)
    private class Stats(val paper: Int, val dark: Int, val thr: Int)
    private class Done(val bmp: Bitmap, val angle: Float)

    private fun gray(b: Bitmap, width: Int): Gray {
        val s = Bitmap.createScaledBitmap(b, width, max(1, (b.height.toLong() * width / b.width).toInt()), true)
        val px = IntArray(s.width * s.height); s.getPixels(px, 0, s.width, 0, 0, s.width, s.height)
        val g = IntArray(px.size) { val c = px[it]; ((c shr 16 and 255) * 77 + (c shr 8 and 255) * 150 + (c and 255) * 29) shr 8 }
        val r = Gray(g, s.width, s.height); if (s !== b) s.recycle(); return r
    }
    private fun stats(im: Gray): Stats {
        val hist = IntArray(256); for (v in im.g) hist[v]++
        fun pct(p: Double): Int { var acc = 0L; val lim = im.g.size * p; for (v in 0..255) { acc += hist[v]; if (acc >= lim) return v }; return 255 }
        val paper = pct(0.6); val dark = pct(0.005)
        return Stats(paper, dark, max(40, (paper - max(50.0, (paper - dark) * 0.45)).toInt()))
    }
    private fun blank(im: Gray, st: Stats): Boolean {
        val mx = (im.w * 0.06).toInt(); val my = (im.h * 0.05).toInt()
        var ink = 0; var n = 0
        var y = my
        while (y < im.h - my) { var x = mx; while (x < im.w - mx) { n++; if (im.g[y * im.w + x] < st.thr) ink++; x += 2 }; y += 2 }
        return st.paper - st.dark < 40 || n == 0 || ink.toDouble() / n < 0.0015
    }
    private fun skew(im: Gray, st: Stats): Float {
        val step = max(1, sqrt(im.w.toDouble() * im.h / 400000).roundToInt())
        val xs = ArrayList<Int>(); val ys = ArrayList<Int>()
        var y = 0
        while (y < im.h) { var x = 0; while (x < im.w) { if (im.g[y * im.w + x] < st.thr) { xs.add(x); ys.add(y) }; x += step }; y += step }
        if (xs.size < 300) return 0f
        val l = hypot(im.w.toDouble(), im.h.toDouble()).toInt() + 2
        val acc = IntArray(l * 2)
        fun score(deg: Double): Double {
            val a = Math.toRadians(deg); val ca = cos(a); val sa = sin(a)
            acc.fill(0)
            for (k in xs.indices) { val r = ((ys[k] * ca - xs[k] * sa) / step).roundToInt() + l; if (r in acc.indices) acc[r]++ }
            var s = 0.0; for (v in acc) s += v.toDouble() * v; return s
        }
        val s0 = score(0.0); var best = 0.0; var bs = s0
        var d = -6.0; while (d <= 6.001) { val s = score(d); if (s > bs) { bs = s; best = d }; d += 0.5 }
        val c = best
        d = c - 0.45; while (d <= c + 0.451) { val s = score(d); if (s > bs) { bs = s; best = d }; d += 0.05 }
        return if (abs(best) >= 0.2 && bs > s0 * 1.03) best.toFloat() else 0f
    }
    /** Text- oder Scan-Seite? Scan = Bild und (kaum Text oder nur unsichtbarer Text aus der Texterkennung) */
    private fun kind(d: PDDocument, i: Int): String {
        val page = d.getPage(i)
        val chars = try { PDFTextStripper().apply { startPage = i + 1; endPage = i + 1 }.getText(d).count { !it.isWhitespace() } } catch (e: Exception) { 0 }
        var img = false; var invisible = false
        try {
            val res = page.resources
            val toks = PDFStreamParser(page).let { it.parse(); it.tokens }
            var last: Any? = null
            for (t in toks) {
                if (t is Operator) {
                    when (t.name) {
                        "Do" -> { val nm = last as? COSName; if (nm != null && res != null && res.isImageXObject(nm)) img = true }
                        "BI" -> img = true
                        "Tr" -> if ((last as? COSNumber)?.intValue() == 3) invisible = true
                    }
                }
                last = t
            }
        } catch (e: Exception) { }
        return when {
            img && (chars < 25 || invisible) -> "scan"
            chars < 5 -> if (img) "scan" else "empty"
            else -> "text"
        }
    }

    private fun run(h: ToolHost, deskew: Boolean, blank: Boolean, contrast: Boolean, gray: Boolean) {
        val a = h.act
        val path = h.docPath
        val withNotes = Store.doc(path).strokes.values.map { it.optInt("p") }.toSet()
        val pr = Ui.Progress(a, "Scans werden aufbereitet …")
        Store.scope.launch {
            val blanks = ArrayList<Int>()
            val done = HashMap<Int, Done>()
            var straight = 0; var cleaned = 0
            val file = Store.pdfFile(path)
            val ok = withContext(Dispatchers.IO) {
                try {
                    val kinds = PDDocument.load(file, MemoryUsageSetting.setupTempFileOnly()).use { d -> (0 until d.numberOfPages).map { kind(d, it) } }
                    val src = PdfSource(a, file)
                    try {
                        for (i in kinds.indices) {
                            a.runOnUiThread { pr.label.text = "Seite ${i + 1} von ${kinds.size}"; pr.set(i.toLong(), kinds.size.toLong()) }
                            if (kinds[i] == "text") continue
                            val (bmp, _) = Acro.render(a, src, i, 2340)
                            val im = gray(bmp, 1000); val st = stats(im)
                            if (blank && i !in withNotes && blank(im, st)) { blanks.add(i); bmp.recycle(); continue }
                            if (kinds[i] != "scan" || !(deskew || contrast || gray)) { bmp.recycle(); continue }
                            val ang = if (deskew) skew(im, st) else 0f
                            if (ang == 0f && !contrast && !gray) { bmp.recycle(); continue }
                            val outB = Bitmap.createBitmap(bmp.width, bmp.height, Bitmap.Config.ARGB_8888)
                            Canvas(outB).apply {
                                drawColor(Color.WHITE)
                                if (ang != 0f) rotate(-ang, bmp.width / 2f, bmp.height / 2f)
                                drawBitmap(bmp, 0f, 0f, Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG))
                            }
                            bmp.recycle()
                            if (contrast || gray) {
                                val lo = if (contrast) min(st.dark, 90) else 0
                                val hi = if (contrast) max(lo + 60, st.paper - 10) else 255
                                val lut = IntArray(256) { v -> val t = ((v - lo).toDouble() / (hi - lo)).coerceIn(0.0, 1.0); (255 * (if (contrast) t.pow(1.5) else t)).roundToInt() }
                                val row = IntArray(outB.width)
                                for (yy in 0 until outB.height) {
                                    outB.getPixels(row, 0, outB.width, 0, yy, outB.width, 1)
                                    for (x in row.indices) {
                                        val c = row[x]; val r = c shr 16 and 255; val g = c shr 8 and 255; val b = c and 255
                                        row[x] = if (gray) { val v = lut[(r * 77 + g * 150 + b * 29) shr 8]; Color.rgb(v, v, v) } else Color.rgb(lut[r], lut[g], lut[b])
                                    }
                                    outB.setPixels(row, 0, outB.width, 0, yy, outB.width, 1)
                                }
                            }
                            done[i] = Done(outB, ang)
                            if (ang != 0f) straight++
                            if (contrast || gray) cleaned++
                        }
                    } finally { src.close() }
                    true
                } catch (e: Throwable) { Crash.report("Scans aufbereiten", e); false }
            }
            pr.close()
            if (!ok) { done.values.forEach { it.bmp.recycle() }; Ui.alert(a, "Nicht aufbereitet", "Das hat leider nicht geklappt."); return@launch }
            val total = h.doc.pageCount
            if (blanks.size >= total) { done.values.forEach { it.bmp.recycle() }; Ui.alert(a, "Nichts geändert", "Alle Seiten sehen leer aus – es wurde nichts geändert."); return@launch }
            if (blanks.isEmpty() && done.isEmpty()) { Ui.alert(a, "Alles in Ordnung", "Keine schiefen, leeren oder blassen Scan-Seiten gefunden."); return@launch }
            val map = (0 until total).let { all -> var j = 0; all.map { if (it in blanks) -1 else j++ } }
            val parts = ArrayList<String>()
            if (straight > 0) parts.add("$straight ${if (straight == 1) "Seite" else "Seiten"} gerade gerichtet")
            if (blanks.isNotEmpty()) parts.add("${blanks.size} leere ${if (blanks.size == 1) "Seite" else "Seiten"} entfernt")
            if (cleaned > 0) parts.add("$cleaned ${if (cleaned == 1) "Seite" else "Seiten"} ${if (contrast) "kontrastreicher" else "in Graustufen"}")
            val pr2 = Ui.Progress(a, "Wird gespeichert …")
            val err = PageOps.custom(path, "Scans aufbereiten", false, map) { d ->
                for ((i, dn) in done) {
                    val page = d.getPage(i)
                    val (w, hh) = Acro.dispSize(page)
                    val img = JPEGFactory.createFromImage(d, dn.bmp, 0.82f)
                    page.rotation = 0
                    val box = PDRectangle(0f, 0f, w, hh)
                    page.mediaBox = box; page.cropBox = box
                    page.cosObject.removeItem(COSName.getPDFName("TrimBox")); page.cosObject.removeItem(COSName.getPDFName("BleedBox")); page.cosObject.removeItem(COSName.getPDFName("ArtBox"))
                    page.annotations = ArrayList()
                    page.resources = PDResources()
                    PDPageContentStream(d, page, PDPageContentStream.AppendMode.OVERWRITE, true).use { cs -> cs.drawImage(img, 0f, 0f, w, hh) }
                }
                for (i in blanks.sortedDescending()) d.removePage(i)
                false
            }
            done.values.forEach { it.bmp.recycle() }
            pr2.close()
            if (err != null) { Ui.alert(a, "Nicht gespeichert", err); return@launch }
            h.reload()
            Ui.toast(a, parts.joinToString(", ") + "." + if (done.isNotEmpty()) " Der Text wird jetzt neu erkannt …" else "", true)
            if (done.isNotEmpty()) Ocr.autoForce(h)
        }
    }
}
