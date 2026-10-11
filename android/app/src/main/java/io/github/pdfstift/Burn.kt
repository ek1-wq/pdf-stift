package io.github.pdfstift

import android.content.Context
import com.tom_roush.pdfbox.cos.COSArray
import com.tom_roush.pdfbox.cos.COSDictionary
import com.tom_roush.pdfbox.cos.COSName
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.font.PDFont
import com.tom_roush.pdfbox.pdmodel.font.PDType0Font
import com.tom_roush.pdfbox.pdmodel.graphics.blend.BlendMode
import com.tom_roush.pdfbox.pdmodel.graphics.image.PDImageXObject
import com.tom_roush.pdfbox.pdmodel.graphics.state.PDExtendedGraphicsState
import com.tom_roush.pdfbox.util.Matrix
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Notizen fest in die PDF schreiben – wie die Web-App beim Verlassen einer PDF.
 * Gespeichert wird „angehängt“: die Datei bleibt, die Notizen kommen als Nachtrag hinten dran.
 * Hochgeladen wird dann nur dieser Nachtrag (meist wenige KB).
 */
object Burn {
    private val busy = HashSet<String>()
    fun isBusy(path: String) = path in busy
    lateinit var appCtx: Context

    // Verknüpfungen und Kommentar-Notizzettel bleiben beweglich (Kommentare kommen beim Weitergeben als echte PDF-Kommentare hinein)
    fun burnable(d: NoteDoc) = d.strokes.values.filter { !it.has("ln") && it.optInt("nt") != 1 }
    fun notesOf(d: NoteDoc) = d.strokes.values.filter { it.optString("t") == "txt" && it.optInt("nt") == 1 }

    /** true = eingebrannt; false = nichts zu tun oder später noch einmal */
    suspend fun run(path: String): Boolean {
        if (path in busy) return false
        val d = Store.doc(path)
        if (d.pendAdd.isNotEmpty() || d.pendDel.isNotEmpty()) { try { Store.flush() } catch (e: Exception) { } }
        if (d.pendAdd.isNotEmpty() || d.pendDel.isNotEmpty()) return false
        val strokes = burnable(d)
        if (strokes.isEmpty()) return false
        val base = Store.pdfFile(path)
        if (!base.isFile) return false
        busy.add(path)
        try {
            val out = File(base.path + ".neu")
            val full = withContext(Dispatchers.IO) { write(base, out, strokes) }
            val baseLen = base.length()
            val fp = withContext(Dispatchers.IO) { fingerprint(base) }
            val ids = JSONArray(strokes.map { it.getString("id") }).toString()
            val tail = if (full.second && out.length() > baseLen) File(base.path + ".tail").also { t ->
                withContext(Dispatchers.IO) {
                    RandomAccessFile(out, "r").use { raf -> raf.seek(baseLen); t.outputStream().use { o -> val buf = ByteArray(65536); while (true) { val n = raf.read(buf); if (n < 0) break; o.write(buf, 0, n) } } }
                }
            } else null
            suspend fun send(whole: Boolean): JSONObject {
                val b = MultipartBody.Builder().setType(MultipartBody.FORM)
                    .addFormDataPart("path", path).addFormDataPart("ids", ids).addFormDataPart("baseSize", baseLen.toString())
                if (tail != null && !whole) b.addFormDataPart("baseFp", fp).addFormDataPart("tail", "anhang.bin", tail.asRequestBody("application/octet-stream".toMediaType()))
                else b.addFormDataPart("pdf", "mit-notizen.pdf", out.asRequestBody("application/pdf".toMediaType()))
                return Api.postForm("burn", b.build())
            }
            val res = try { send(false) } catch (e: Api.ApiError) { if (tail != null && e.code == 409) send(true) else throw e }
            tail?.delete()
            // neue Fassung übernehmen
            withContext(Dispatchers.IO) { if (!out.renameTo(base)) { out.copyTo(base, true); out.delete() } }
            Store.markLocal(path, res.optLong("mtime"), res.optLong("size"))
            res.optJSONObject("notes")?.let { Store.applyServerPublic(d, it) }
            return true
        } catch (e: Exception) {
            File(base.path + ".neu").delete(); File(base.path + ".tail").delete()
            if (e !is java.io.IOException || e is Api.ApiError) Crash.report("Einbrennen fehlgeschlagen ($path)", e)
            return false
        } finally {
            busy.remove(path)
        }
    }

    /** Kopie der PDF mit allen Notizen zum Weitergeben (ohne Hochladen, klappt auch offline) */
    suspend fun export(path: String, out: File): Boolean = withContext(Dispatchers.IO) {
        val base = Store.pdfFile(path)
        if (!base.isFile) return@withContext false
        val strokes = burnable(Store.doc(path))
        val notes = notesOf(Store.doc(path))
        out.parentFile?.mkdirs()
        try {
            if (strokes.isEmpty()) base.copyTo(out, true) else write(base, out, strokes)
            if (notes.isNotEmpty()) addComments(out, notes)
            true
        } catch (e: Throwable) { Crash.report("Teilen: PDF mit Notizen fehlgeschlagen", e); false }
    }

    /** Kommentare als echte PDF-Kommentare (andere PDF-Programme zeigen sie in ihrer Kommentarliste) */
    private fun addComments(f: File, notes: List<JSONObject>) {
        val tmp = File(f.path + ".k")
        PDDocument.load(f, MemoryUsageSetting.setupTempFileOnly()).use { doc ->
            for (n in notes) {
                val i = n.optInt("p"); if (i < 0 || i >= doc.numberOfPages) continue
                val page = doc.getPage(i)
                val p = Ink.pts(n); if (p.size < 2) continue
                val m = displayMatrix(page)
                val a = m.transformPoint(p[0], p[1] + 20f); val b = m.transformPoint(p[0] + 20f, p[1])
                val col = try { android.graphics.Color.parseColor(n.optString("c", "#FFD43B")) } catch (e: Exception) { 0xFFFFD43B.toInt() }
                val an = com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotationText()
                an.setRectangle(com.tom_roush.pdfbox.pdmodel.common.PDRectangle(minOf(a.x, b.x), minOf(a.y, b.y), kotlin.math.abs(b.x - a.x), kotlin.math.abs(b.y - a.y)))
                an.setContents(n.optString("text"))
                an.setName(com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotationText.NAME_COMMENT)
                an.setTitlePopup("PDF-Stift"); an.setPrinted(true); an.setOpen(false)
                an.setColor(com.tom_roush.pdfbox.pdmodel.graphics.color.PDColor(floatArrayOf(android.graphics.Color.red(col) / 255f, android.graphics.Color.green(col) / 255f, android.graphics.Color.blue(col) / 255f), com.tom_roush.pdfbox.pdmodel.graphics.color.PDDeviceRGB.INSTANCE))
                try { an.constructAppearances(doc) } catch (e: Throwable) { }
                val list = ArrayList(page.annotations ?: emptyList()); list.add(an); page.setAnnotations(list)
            }
            doc.save(tmp)
        }
        if (!tmp.renameTo(f)) { tmp.copyTo(f, true); tmp.delete() }
    }

    /** schreibt die PDF mit Notizen nach out. Rückgabe: (out, angehängt?) */
    private fun write(base: File, out: File, strokes: List<JSONObject>): Pair<File, Boolean> {
        try {
            PDDocument.load(base, MemoryUsageSetting.setupTempFileOnly()).use { doc ->
                draw(doc, strokes, true)
                out.outputStream().use { doc.saveIncremental(it) }
            }
            if (out.length() > base.length() && check(out, strokes)) return out to true
            Crash.report("Angehängtes Speichern nicht geprüft – ganze Datei", null)
        } catch (e: Throwable) { Crash.report("Angehängtes Speichern fehlgeschlagen", e) }
        // sonst: ganze Datei neu schreiben
        PDDocument.load(base, MemoryUsageSetting.setupTempFileOnly()).use { doc ->
            draw(doc, strokes, false)
            doc.save(out)
        }
        return out to false
    }

    /** Probe: lässt sich die neue Fassung öffnen und hat jede beschriebene Seite den Nachtrag? */
    private fun check(f: File, strokes: List<JSONObject>): Boolean = try {
        PDDocument.load(f, MemoryUsageSetting.setupTempFileOnly()).use { doc ->
            strokes.map { it.optInt("p") }.toSet().all { i ->
                i < doc.numberOfPages && doc.getPage(i).cosObject.getDictionaryObject(COSName.CONTENTS) is COSArray &&
                    (doc.getPage(i).resources?.cosObject?.getDictionaryObject(COSName.EXT_G_STATE) as? COSDictionary)?.containsKey(COSName.getPDFName("PSn")) == true
            }
        }
    } catch (e: Throwable) { false }

    private fun mark(o: Any?) { (o as? com.tom_roush.pdfbox.cos.COSUpdateInfo)?.isNeedToBeUpdated = true }

    private fun draw(doc: PDDocument, strokes: List<JSONObject>, incremental: Boolean) {
        val fonts = HashMap<String, PDFont>()
        fun font(bold: Boolean, ff: String = ""): PDFont = fonts.getOrPut((if (bold) "b" else "") + ff) {
            val base = when (ff) { "serif" -> "DejaVuSerif"; "mono" -> "DejaVuSansMono"; else -> "DejaVuSans" }
            appCtx.assets.open(base + (if (bold) "-Bold" else "") + ".ttf").use { PDType0Font.load(doc, it, false) }
        }
        for ((i, list) in strokes.groupBy { it.optInt("p") }) {
            if (i < 0 || i >= doc.numberOfPages) continue
            val page = doc.getPage(i)
            val sorted = list.sortedBy { Ink.rank(it) }
            PDPageContentStream(doc, page, PDPageContentStream.AppendMode.APPEND, true, true).use { cs ->
                cs.saveGraphicsState()
                cs.transform(displayMatrix(page))
                // Marker: halbdurchsichtig, multipliziert (Text darunter bleibt schwarz)
                val gsHl = PDExtendedGraphicsState().apply { strokingAlphaConstant = 0.4f; nonStrokingAlphaConstant = 0.4f; blendMode = BlendMode.MULTIPLY }
                val gsTx = PDExtendedGraphicsState().apply { strokingAlphaConstant = 0.85f; nonStrokingAlphaConstant = 0.85f; blendMode = BlendMode.MULTIPLY }
                val gsN = PDExtendedGraphicsState().apply { strokingAlphaConstant = 1f; nonStrokingAlphaConstant = 1f }
                // Merkzeichen für die Probe
                page.resources.add(gsN).let { }
                page.resources.put(COSName.getPDFName("PSn"), gsN)
                for (s in sorted) drawStroke(doc, cs, s, gsHl, gsTx, gsN, ::font)
                cs.restoreGraphicsState()
            }
            if (incremental) {
                mark(page.cosObject)
                mark(page.cosObject.getDictionaryObject(COSName.CONTENTS))
                val res = page.resources.cosObject
                mark(res)
                for (k in listOf(COSName.FONT, COSName.EXT_G_STATE, COSName.XOBJECT)) mark(res.getDictionaryObject(k))
                // geerbte Ressourcen: den Seitenbaum mit kennzeichnen
                var parent = page.cosObject.getDictionaryObject(COSName.PARENT) as? COSDictionary
                while (parent != null) { mark(parent); parent = parent.getDictionaryObject(COSName.PARENT) as? COSDictionary }
            }
        }
        if (incremental) mark(doc.documentCatalog.cosObject)
    }

    /** Notiz-Koordinaten (angezeigte Seite, oben links, y nach unten) → PDF-Koordinaten */
    private fun displayMatrix(page: PDPage): Matrix {
        val b = page.cropBox
        val llx = b.lowerLeftX; val lly = b.lowerLeftY; val urx = b.upperRightX; val ury = b.upperRightY
        return when (((page.rotation % 360) + 360) % 360) {
            90 -> Matrix(0f, 1f, 1f, 0f, llx, lly)
            180 -> Matrix(-1f, 0f, 0f, 1f, urx, lly)
            270 -> Matrix(0f, -1f, -1f, 0f, urx, ury)
            else -> Matrix(1f, 0f, 0f, -1f, llx, ury)
        }
    }

    private fun rgb(cs: PDPageContentStream, hex: String, stroke: Boolean) {
        val c = try { android.graphics.Color.parseColor(hex) } catch (e: Exception) { android.graphics.Color.BLACK }
        val r = android.graphics.Color.red(c) / 255f; val g = android.graphics.Color.green(c) / 255f; val b = android.graphics.Color.blue(c) / 255f
        if (stroke) cs.setStrokingColor(r, g, b) else cs.setNonStrokingColor(r, g, b)
    }

    private suspend fun noop() {}

    private fun drawStroke(doc: PDDocument, cs: PDPageContentStream, s: JSONObject, gsHl: PDExtendedGraphicsState, gsTx: PDExtendedGraphicsState, gsN: PDExtendedGraphicsState, font: (Boolean, String) -> PDFont) {
        val t = s.optString("t", "pen")
        val p = Ink.pts(s)
        val col = s.optString("c", "#1A1A1A")
        cs.setLineCapStyle(1); cs.setLineJoinStyle(1)
        when (t) {
            "pen" -> {
                if (p.size < 3) return
                val w = s.optDouble("w", 1.6).toFloat()
                rgb(cs, col, true); rgb(cs, col, false)
                if (p.size <= 3) {
                    val r = w * (0.6f + 0.8f * (if (p[2] > 0) p[2] else 0.5f)) / 2
                    circle(cs, p[0], p[1], r); cs.fill(); return
                }
                var lw = -1f
                var i = 3
                while (i + 1 < p.size) {
                    val pr = ((if (p[i - 1] > 0) p[i - 1] else 0.5f) + (if (i + 2 < p.size && p[i + 2] > 0) p[i + 2] else 0.5f)) / 2
                    val ww = max(0.12f, (w * (0.6f + 0.8f * pr) * 8).roundToInt() / 8f)
                    val x0 = if (i >= 6) (p[i - 6] + p[i - 3]) / 2 else p[i - 3]
                    val y0 = if (i >= 6) (p[i - 5] + p[i - 2]) / 2 else p[i - 2]
                    val mx = (p[i - 3] + p[i]) / 2; val my = (p[i - 2] + p[i + 1]) / 2
                    if (ww != lw) {
                        if (lw >= 0) cs.stroke()
                        lw = ww; cs.setLineWidth(ww); cs.moveTo(x0, y0)
                    }
                    quad(cs, x0, y0, p[i - 3], p[i - 2], mx, my)
                    i += 3
                }
                if (lw >= 0) { cs.lineTo(p[p.size - 3], p[p.size - 2]); cs.stroke() }
            }
            "hl" -> {
                if (p.size < 3) return
                cs.setGraphicsStateParameters(gsHl)
                rgb(cs, col, true); cs.setLineWidth(s.optDouble("w", 13.0).toFloat())
                cs.moveTo(p[0], p[1])
                var i = 3
                while (i + 1 < p.size) { cs.lineTo(p[i], p[i + 1]); i += 3 }
                if (p.size == 3) cs.lineTo(p[0] + 0.01f, p[1])
                cs.stroke()
                cs.setGraphicsStateParameters(gsN)
            }
            "sh" -> {
                if (p.size < 4) return
                val w = s.optDouble("w", 1.5).toFloat()
                rgb(cs, col, true); cs.setLineWidth(max(0.3f, w))
                for (line in Ink.shapeLines(s.optString("k", "line"), p, w)) {
                    line.forEachIndexed { j, q -> if (j == 0) cs.moveTo(q[0], q[1]) else cs.lineTo(q[0], q[1]) }
                    cs.stroke()
                }
            }
            "tx" -> {
                val k = s.optString("k", "hl")
                var i = 0
                while (i + 3 < p.size) {
                    val x = p[i]; val y = p[i + 1]; val w = p[i + 2]; val h = p[i + 3]
                    if (k == "ul" || k == "st") {
                        val yy = if (k == "ul") y + h * 0.94f else y + h * 0.56f
                        rgb(cs, col, true); cs.setLineCapStyle(0); cs.setLineWidth(max(1.2f, h * 0.085f))
                        cs.moveTo(x, yy); cs.lineTo(x + w, yy); cs.stroke(); cs.setLineCapStyle(1)
                    } else {
                        cs.setGraphicsStateParameters(gsTx); rgb(cs, col, false)
                        cs.addRect(x, y, w, h); cs.fill()
                        cs.setGraphicsStateParameters(gsN)
                    }
                    i += 4
                }
            }
            "txt", "img" -> {
                if (p.size < 2) return
                val bw = s.optDouble("bw", 0.0).toFloat(); val bh = s.optDouble("bh", 0.0).toFloat()
                cs.saveGraphicsState()
                val rot = s.optDouble("r", 0.0).toFloat()
                if (kotlin.math.abs(rot) > 0.01f) {
                    val cx = p[0] + bw / 2; val cy = p[1] + bh / 2
                    cs.transform(Matrix.getTranslateInstance(cx, cy))
                    cs.transform(Matrix.getRotateInstance(Math.toRadians(rot.toDouble()), 0f, 0f))
                    cs.transform(Matrix.getTranslateInstance(-cx, -cy))
                }
                if (t == "img") {
                    val bytes = try { Images.file(s.optString("src")).takeIf { it.isFile }?.readBytes() } catch (e: Exception) { null }
                    if (bytes != null) {
                        val img = PDImageXObject.createFromByteArray(doc, bytes, s.optString("src"))
                        // Bild steht in Notiz-Koordinaten auf dem Kopf: wieder umdrehen
                        cs.transform(Matrix(bw, 0f, 0f, -bh, p[0], p[1] + bh))
                        cs.drawImage(img, 0f, 0f, 1f, 1f)
                    }
                } else {
                    val fs = s.optDouble("fs", 14.0).toFloat()
                    val pd = fs * 0.3f
                    s.optString("bg").takeIf { it.startsWith("#") }?.let { rgb(cs, it, false); cs.addRect(p[0] - pd, p[1] - pd, bw + pd * 2, bh + pd * 2); cs.fill() }
                    s.optString("bo").takeIf { it.startsWith("#") }?.let { rgb(cs, it, true); cs.setLineWidth(max(1f, fs * 0.07f)); cs.addRect(p[0] - pd, p[1] - pd, bw + pd * 2, bh + pd * 2); cs.stroke() }
                    val f = font(s.optInt("b") == 1, s.optString("ff"))
                    val al = s.optString("al")
                    rgb(cs, col, false)
                    s.optString("text").split("\n").forEachIndexed { j, line ->
                        val clean = line.filter { ch -> try { f.encode(ch.toString()); true } catch (e: Exception) { false } }
                        if (clean.isEmpty()) return@forEachIndexed
                        cs.beginText()
                        cs.setFont(f, fs)
                        val lw = try { f.getStringWidth(clean) / 1000f * fs } catch (e: Exception) { 0f }
                        val off = when (al) { "c" -> (bw - lw) / 2; "r" -> bw - lw; else -> 0f }
                        cs.setTextMatrix(Matrix(1f, 0f, if (s.optInt("i") == 1) 0.21f else 0f, -1f, p[0] + max(0f, off), p[1] + fs * 0.8f + j * fs * 1.25f))  // kursiv = schräg gestellt
                        cs.showText(clean)
                        cs.endText()
                    }
                }
                cs.restoreGraphicsState()
            }
        }
    }

    private fun quad(cs: PDPageContentStream, x0: Float, y0: Float, qx: Float, qy: Float, x1: Float, y1: Float) {
        cs.curveTo(x0 + 2f / 3f * (qx - x0), y0 + 2f / 3f * (qy - y0), x1 + 2f / 3f * (qx - x1), y1 + 2f / 3f * (qy - y1), x1, y1)
    }

    private fun circle(cs: PDPageContentStream, x: Float, y: Float, r: Float) {
        val k = 0.5523f * r
        cs.moveTo(x + r, y)
        cs.curveTo(x + r, y + k, x + k, y + r, x, y + r)
        cs.curveTo(x - k, y + r, x - r, y + k, x - r, y)
        cs.curveTo(x - r, y - k, x - k, y - r, x, y - r)
        cs.curveTo(x + k, y - r, x + r, y - k, x + r, y)
    }

    /** wie auf dem Server: SHA-256 über die ersten 64 KB und das letzte MB */
    fun fingerprint(f: File): String {
        val n = f.length()
        val md = MessageDigest.getInstance("SHA-256")
        RandomAccessFile(f, "r").use { raf ->
            val a = ByteArray(minOf(65536L, n).toInt()); raf.readFully(a); md.update(a)
            val start = maxOf(0L, n - 1048576L); raf.seek(start)
            val b = ByteArray((n - start).toInt()); raf.readFully(b); md.update(b)
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}
