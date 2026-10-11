package io.github.pdfstift

import android.graphics.Bitmap
import androidx.appcompat.app.AlertDialog
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

/** Exportieren – alles auf dem Tablet, Notizen werden mit übernommen (wie in der Web-App) */
object Export {
    private val OPTS = listOf(
        "docx" to "Word-Datei (.docx) – Text zum Weiterbearbeiten",
        "docxImg" to "Word-Datei (.docx) – Seiten als Bilder, sieht aus wie die PDF",
        "xlsx" to "Excel-Datei (.xlsx) – Tabellen und Zahlen, eine Tabelle je Seite",
        "pptx" to "PowerPoint (.pptx) – eine Folie je Seite",
        "zip" to "Alle Seiten als Bilder (JPG, als ZIP)",
        "png" to "Diese Seite als Bild (PNG)",
        "txt" to "Nur den Text (.txt)",
    )

    fun show(h: ToolHost) {
        AlertDialog.Builder(h.act).setTitle("Exportieren").setItems(OPTS.map { it.second }.toTypedArray()) { _, i -> run(h, OPTS[i].first) }
            .setNegativeButton("Schließen", null).show()
    }

    private fun run(h: ToolHost, kind: String) {
        val a = h.act
        val stem = h.docPath.substringAfterLast('/').removeSuffix(".pdf")
        val cur = h.doc.currentPage()
        val pr = Ui.Progress(a, "Wird exportiert …")
        Store.scope.launch {
            val dir = File(a.cacheDir, "share").apply { deleteRecursively(); mkdirs() }
            val src = File(dir, "quelle.pdf")
            val res: Pair<File, String>? = if (!Burn.export(h.docPath, src)) null else withContext(Dispatchers.IO) {
                try {
                    val prog = { k: Int, n: Int -> a.runOnUiThread { pr.label.text = "Seite ${k + 1} von $n"; pr.set(k.toLong(), n.toLong()) } }
                    when (kind) {
                        "txt" -> File(dir, "$stem.txt").also { f -> PDDocument.load(src, MemoryUsageSetting.setupTempFileOnly()).use { d -> f.writeText(PDFTextStripper().apply { sortByPosition = true }.getText(d)) } } to "text/plain"
                        "png" -> File(dir, "$stem – Seite ${cur + 1}.png").also { f -> pages(a, src, listOf(cur), 2400, prog) { _, b, _ -> f.outputStream().use { b.compress(Bitmap.CompressFormat.PNG, 100, it) } } } to "image/png"
                        "zip" -> File(dir, "$stem (Bilder).zip").also { f ->
                            ZipOutputStream(f.outputStream()).use { z -> pages(a, src, null, 2000, prog) { i, b, _ -> z.putNextEntry(ZipEntry("$stem – Seite ${"%03d".format(i + 1)}.jpg")); b.compress(Bitmap.CompressFormat.JPEG, 88, z); z.closeEntry() } }
                        } to "application/zip"
                        "docx" -> File(dir, "$stem.docx").also { docxText(src, it, prog) } to "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        "docxImg" -> File(dir, "$stem (Seiten).docx").also { docxImages(a, src, it, prog) } to "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        "xlsx" -> File(dir, "$stem.xlsx").also { xlsx(src, it, prog) } to "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        else -> File(dir, "$stem.pptx").also { pptx(a, src, it, prog) } to "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                    }
                } catch (e: Throwable) { Crash.report("Export $kind", e); null } finally { src.delete() }
            }
            pr.close()
            if (res == null) { Ui.alert(a, "Nicht exportiert", "Das hat leider nicht geklappt."); return@launch }
            Acro.shareFile(a, res.first, res.second, "Exportieren: ${res.first.name}")
        }
    }

    /** Seiten als Bilder (mit allem, was auf der Seite zu sehen ist) */
    private fun pages(a: android.content.Context, f: File, which: List<Int>?, maxPx: Int, prog: (Int, Int) -> Unit, each: (Int, Bitmap, Float) -> Unit) {
        val src = PdfSource(a, f)
        try {
            val list = which ?: (0 until src.pageCount).toList()
            for ((k, i) in list.withIndex()) { prog(k, list.size); val (b, sc) = Acro.render(a, src, i, maxPx); try { each(i, b, sc) } finally { b.recycle() } }
        } finally { src.close() }
    }

    private fun jpgPages(a: android.content.Context, src: File, maxPx: Int, prog: (Int, Int) -> Unit): List<Pair<ByteArray, Pair<Float, Float>>> {
        val imgs = ArrayList<Pair<ByteArray, Pair<Float, Float>>>()
        pages(a, src, null, maxPx, prog) { _, b, sc -> val bo = ByteArrayOutputStream(); b.compress(Bitmap.CompressFormat.JPEG, 85, bo); imgs.add(bo.toByteArray() to (b.width / sc to b.height / sc)) }
        return imgs
    }
    private fun docxImages(a: android.content.Context, src: File, out: File, prog: (Int, Int) -> Unit) = Ooxml.docxImages(jpgPages(a, src, 1700, prog), out)
    private fun pptx(a: android.content.Context, src: File, out: File, prog: (Int, Int) -> Unit) = Ooxml.pptx(jpgPages(a, src, 1900, prog), out)

    // ---------------------------------------------------------------- Word: Text (Zeilen zu Absätzen)
    private fun docxText(src: File, out: File, prog: (Int, Int) -> Unit) {
        val paras = ArrayList<Ooxml.Para>()
        val n = PDDocument.load(src, MemoryUsageSetting.setupTempFileOnly()).use { it.numberOfPages }
        for (p in 0 until n) {
            prog(p, n)
            var brk = p > 0
            val lines = TextEdit.lines(src, p).sortedWith(compareBy({ (it.base / 3).roundToInt() }, { it.x1 }))
            var para = StringBuilder(); var pFs = 0f; var pBold = false; var lastBase = -1e9f
            fun flush() {
                if (para.isNotBlank()) { paras.add(Ooxml.Para(para.toString().trim(), pFs, pBold, brk)); brk = false }
                para = StringBuilder()
            }
            for (l in lines) {
                val gap = l.base - lastBase
                val same = para.isNotEmpty() && abs(l.fs - pFs) < 1.2f && l.bold == pBold && gap > 0 && gap < l.fs * 1.7f
                if (!same) { flush(); pFs = l.fs; pBold = l.bold }
                if (para.isNotEmpty()) { if (para.endsWith("-")) para.setLength(para.length - 1) else para.append(' ') }
                para.append(l.text)
                lastBase = l.base
            }
            flush()
        }
        Ooxml.docx(paras, out)
    }

    private fun xlsx(src: File, out: File, prog: (Int, Int) -> Unit) {
        val n = PDDocument.load(src, MemoryUsageSetting.setupTempFileOnly()).use { it.numberOfPages }
        val tables = ArrayList<List<Map<Int, String>>>()
        for (p in 0 until n) {
            prog(p, n)
            val lines = TextEdit.lines(src, p)
            // Spalten: linke Kanten der Textstücke bündeln
            val xs = lines.map { it.x1 }.sorted()
            val cols = ArrayList<Float>()
            for (xv in xs) if (cols.isEmpty() || xv - cols.last() > 14f) cols.add(xv)
            fun colOf(xv: Float) = cols.indexOfLast { it <= xv + 0.5f }.coerceAtLeast(0)
            // Zeilen: gleiche Grundlinie
            val rows = ArrayList<MutableList<TextEdit.Line>>()
            for (l in lines.sortedWith(compareBy({ it.base }, { it.x1 }))) {
                val r = rows.lastOrNull()
                if (r != null && abs(r[0].base - l.base) < max(2f, r[0].fs * 0.4f)) r.add(l) else rows.add(arrayListOf(l))
            }
            tables.add(rows.map { r -> val cells = HashMap<Int, String>(); for (l in r.sortedBy { it.x1 }) { val c = colOf(l.x1); cells[c] = (cells[c]?.let { "$it " } ?: "") + l.text }; cells })
        }
        Ooxml.xlsx(tables, out)
    }
}
