package io.github.pdfstift

import android.graphics.Bitmap
import android.graphics.RectF
import androidx.appcompat.app.AlertDialog
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.font.PDType1Font
import com.tom_roush.pdfbox.pdmodel.graphics.state.RenderingMode
import com.tom_roush.pdfbox.text.PDFTextStripper
import com.tom_roush.pdfbox.util.Matrix
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.max

/** Texterkennung auf dem Tablet (ohne Internet): unsichtbare Textschicht, damit Scans durchsuchbar und markierbar werden */
object Ocr {
    class Word(val text: String, val r: RectF)   // r: angezeigte Seite, Punkte

    /** Wörter auf einem Seitenbild (sc = Pixel je Punkt). Nicht auf dem Haupt-Thread aufrufen. */
    fun recognize(bmp: Bitmap, sc: Float): List<Word> = OcrEngine.recognize(bmp, sc)

    /** unsichtbaren Text schreiben (cs ist schon auf die angezeigte Seite umgerechnet) */
    fun writeLayer(cs: PDPageContentStream, words: List<Word>) {
        if (words.isEmpty()) return
        val f = PDType1Font.HELVETICA
        cs.beginText()
        cs.setRenderingMode(RenderingMode.NEITHER)
        for (w in words) {
            val t = Pdfx.encodable(f, w.text)
            val h = w.r.height()
            if (h < 1 || t.isBlank()) continue
            val size = h * 0.9f
            val tw = f.getStringWidth(t) / 1000f * size
            if (tw <= 0) continue
            cs.setFont(f, size)
            cs.setHorizontalScaling(max(1f, w.r.width() / tw * 100f))
            cs.setTextMatrix(Matrix(1f, 0f, 0f, -1f, w.r.left, w.r.bottom - h * 0.18f))
            cs.showText("$t ")
        }
        cs.endText()
    }

    // ---- automatisch beim Öffnen eines Scans (Einstellungen), im Hintergrund
    private val tried = HashSet<String>()
    var running = false; private set
    /** Fortschritt für die Anzeige oben (Diode): Seite k von n; Name ohne Pfad */
    var pg = 0; private set
    var total = 0; private set
    var stopReq = false
    var onChange: (() -> Unit)? = null
    private fun changed() { val f = onChange ?: return; android.os.Handler(android.os.Looper.getMainLooper()).post { f() } }
    private fun textChars(d: PDDocument, i: Int): Int = try {
        PDFTextStripper().apply { startPage = i + 1; endPage = i + 1 }.getText(d).count { !it.isWhitespace() }
    } catch (e: Exception) { 0 }

    /** nach „Scans aufbereiten“: Text auf jeden Fall neu erkennen */
    fun autoForce(h: ToolHost) { tried.remove(h.docPath); auto(h, true) }

    fun auto(h: ToolHost, force: Boolean = false) {
        if (!OcrEngine.AVAILABLE) { if (force) Ui.toast(h.act, "Texterkennung gibt es in dieser Ausgabe nur am PC (Windows/Linux).", true); return }
        if ((!Settings.autoOcr && !force) || running) return
        val path = h.docPath
        if (path.isEmpty() || !tried.add(path)) return
        val a = h.act
        Store.scope.launch {
            val file = Store.pdfFile(path)
            val todo = withContext(Dispatchers.IO) {
                try {
                    PDDocument.load(file, MemoryUsageSetting.setupTempFileOnly()).use { d ->
                        val n = d.numberOfPages
                        val first = (0 until minOf(3, n)).sumOf { textChars(d, it) }
                        if (n == 0 || first >= 25 * minOf(3, n)) emptyList() else (0 until n).filter { textChars(d, it) < 15 }
                    }
                } catch (e: Throwable) { emptyList() }
            }
            if (todo.isEmpty() || h.docPath != path) return@launch
            running = true; stopReq = false; pg = 0; total = todo.size; changed()
            Usage.track("tool", "Texterkennung automatisch")
            val tOcr = System.currentTimeMillis()
            Ui.toast(a, "Scan erkannt – der Text wird im Hintergrund erkannt (Diode oben), damit du suchen und markieren kannst.")
            val words = HashMap<Int, List<Word>>()
            withContext(Dispatchers.IO) {
                val src = PdfSource(a, file)
                try {
                    for ((k, i) in todo.withIndex()) {
                        if (h.docPath != path || a.isFinishing || stopReq) break
                        pg = k + 1; changed()
                        val (bmp, sc) = Acro.render(a, src, i, 2800)
                        try { words[i] = recognize(bmp, sc) } catch (e: Throwable) { Crash.report("Texterkennung (automatisch) Seite ${i + 1}", e) }
                        bmp.recycle()
                    }
                } catch (e: Throwable) { Crash.report("Texterkennung (automatisch)", e) } finally { src.close() }
            }
            running = false; pg = 0; total = 0; changed()
            if (stopReq) { stopReq = false; return@launch }
            if (words.isNotEmpty()) Usage.track("perf", "Texterkennung je Seite", (System.currentTimeMillis() - tOcr) / words.size, "${words.size} Seiten, Tablet")
            if (h.docPath != path || a.isFinishing || words.size < todo.size) { tried.remove(path); return@launch }
            // nicht mitten in einem Strich austauschen
            var w = 0
            while (h.doc.isBusy() && w++ < 120) kotlinx.coroutines.delay(500)
            if (h.docPath == path) save(h, words, true)
        }
    }

    fun ask(h: ToolHost) {
        if (!OcrEngine.AVAILABLE) { Ui.toast(h.act, "Texterkennung gibt es in dieser Ausgabe nur am PC (Windows/Linux).", true); return }
        AlertDialog.Builder(h.act).setTitle("Scans optimieren (Text erkennen)")
            .setItems(arrayOf("Alle Seiten ohne Text (Scans)", "Nur diese Seite", "Alle Seiten")) { _, k -> run(h, k) }
            .setNegativeButton("Abbrechen", null).show()
    }

    private fun run(h: ToolHost, mode: Int) {
        val a = h.act
        Usage.track("tool", "Texterkennung (von Hand)")
        val pr = Ui.Progress(a, "Text wird erkannt …")
        val curPage = h.doc.currentPage()
        Store.scope.launch {
            val result = withContext(Dispatchers.IO) {
                val file = Store.pdfFile(h.docPath)
                val todo = ArrayList<Int>()
                PDDocument.load(file, MemoryUsageSetting.setupTempFileOnly()).use { d ->
                    for (i in 0 until d.numberOfPages) {
                        when (mode) {
                            1 -> if (i == curPage) todo.add(i)
                            2 -> todo.add(i)
                            else -> {
                                val st = PDFTextStripper().apply { startPage = i + 1; endPage = i + 1 }
                                val txt = try { st.getText(d) } catch (e: Exception) { "" }
                                if (txt.count { !it.isWhitespace() } < 15) todo.add(i)
                            }
                        }
                    }
                }
                val words = HashMap<Int, List<Word>>()
                val src = PdfSource(a, file)
                try {
                    for ((k, i) in todo.withIndex()) {
                        a.runOnUiThread { pr.label.text = "Seite ${i + 1} (${k + 1} von ${todo.size})"; pr.set(k.toLong(), todo.size.toLong()) }
                        val (bmp, sc) = Acro.render(a, src, i, 2800)
                        try { words[i] = recognize(bmp, sc) } catch (e: Throwable) { Crash.report("Texterkennung Seite ${i + 1}", e) }
                        bmp.recycle()
                    }
                } finally { src.close() }
                words
            }
            pr.close()
            save(h, result, false)
        }
    }

    private fun save(h: ToolHost, result: Map<Int, List<Word>>, quiet: Boolean) {
        val a = h.act
        val found = result.filterValues { it.isNotEmpty() }
        if (found.isEmpty()) { if (!quiet) Ui.alert(a, "Kein Text gefunden", if (result.isEmpty()) "Alle Seiten haben schon Text – nichts zu tun." else "Auf den Seiten wurde kein Text erkannt."); return }
        Acro.apply(h, "Texterkennung", "Textschicht wird gespeichert …", "Text erkannt auf ${found.size} ${if (found.size == 1) "Seite" else "Seiten"} – jetzt durchsuchbar und markierbar.", quiet = quiet) { d ->
            for ((i, ws) in found) {
                val page = d.getPage(i)
                PDPageContentStream(d, page, PDPageContentStream.AppendMode.APPEND, true, true).use { cs ->
                    cs.saveGraphicsState(); cs.transform(Pdfx.displayMatrix(page)); writeLayer(cs, ws); cs.restoreGraphicsState()
                }
                Pdfx.markPage(d, page)
            }
            true
        }
    }
}
