package io.github.pdfstift

import com.tom_roush.pdfbox.cos.COSArray
import com.tom_roush.pdfbox.cos.COSDictionary
import com.tom_roush.pdfbox.cos.COSName
import com.tom_roush.pdfbox.cos.COSUpdateInfo
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile

/**
 * Seiten bearbeiten (drehen, löschen, einfügen, verschieben) – wie in der Web-App.
 * Gespeichert wird angehängt; hochgeladen wird nur die Änderung. Die Notizen zieht der Server mit.
 */
object PageOps {
    class Op(val kind: String, val i: Int, val j: Int = 0, val style: String = "plain")

    /** letzte Seitenänderung je PDF – für „Rückgängig“: alte Datei und Notizen */
    private class Undo(val prev: File, val notes: List<JSONObject>, val label: String)
    private val undos = HashMap<String, Undo>()
    fun canUndo(path: String) = undos.containsKey(path)
    fun undoLabel(path: String) = undos[path]?.label ?: ""
    /** Rückgängig-Kopie verwerfen (nach dem Schwärzen soll nichts Ungeschwärztes auf dem Tablet bleiben) */
    fun dropUndo(path: String) { undos.remove(path)?.prev?.delete() }

    private suspend fun ready(path: String): String? {
        val d = Store.doc(path)
        try { Store.flush() } catch (e: Exception) { }
        return if (d.pendAdd.isNotEmpty() || d.pendDel.isNotEmpty()) "Die Notizen werden noch gespeichert – bitte gleich noch einmal versuchen (Internet nötig)." else null
    }

    private suspend fun snapshot(path: String, label: String) {
        val base = Store.pdfFile(path)
        val f = File(base.parentFile, "." + base.name + ".vorher")
        withContext(Dispatchers.IO) { base.copyTo(f, true) }
        undos[path] = Undo(f, Store.doc(path).strokes.values.map { JSONObject(it.toString()) }, label)
    }

    /** neue Fassung (out) hochladen – nur den Anhang, wenn möglich – und übernehmen */
    suspend fun upload(path: String, out: File, incremental: Boolean, map: List<Int>, rot: JSONObject, cut: Long = -1L): JSONObject {
        val base = Store.pdfFile(path)
        val baseLen = base.length()
        val fp = withContext(Dispatchers.IO) { Burn.fingerprint(base) }
        val tail = if (incremental && cut < 0 && out.length() > baseLen) File(base.path + ".tail").also { t ->
            withContext(Dispatchers.IO) { RandomAccessFile(out, "r").use { raf -> raf.seek(baseLen); t.outputStream().use { o -> val buf = ByteArray(65536); while (true) { val n = raf.read(buf); if (n < 0) break; o.write(buf, 0, n) } } } }
        } else null
        suspend fun send(whole: Boolean): JSONObject {
            val b = MultipartBody.Builder().setType(MultipartBody.FORM)
                .addFormDataPart("path", path).addFormDataPart("map", JSONArray(map).toString()).addFormDataPart("rot", rot.toString())
            when {
                !whole && cut >= 0 -> b.addFormDataPart("baseLen", baseLen.toString()).addFormDataPart("baseFp", fp).addFormDataPart("cut", cut.toString())
                !whole && tail != null -> b.addFormDataPart("baseLen", baseLen.toString()).addFormDataPart("baseFp", fp).addFormDataPart("tail", "anhang.bin", tail.asRequestBody("application/octet-stream".toMediaType()))
                else -> b.addFormDataPart("pdf", "seiten.pdf", out.asRequestBody("application/pdf".toMediaType()))
            }
            return Api.postForm("pageop", b.build())
        }
        try {
            val res = try { send(false) } catch (e: Api.ApiError) { if ((tail != null || cut >= 0) && e.code == 409) send(true) else throw e }
            withContext(Dispatchers.IO) { if (!out.renameTo(base)) { out.copyTo(base, true); out.delete() } }
            Store.markLocal(path, res.optLong("mtime"), res.optLong("size"))
            return res
        } finally { tail?.delete() }
    }

    /** führt die Änderung aus; Rückgabe: Fehlermeldung oder null */
    suspend fun run(path: String, op: Op, sizes: (Int) -> Pair<Float, Float>): String? {
        ready(path)?.let { return it }
        val base = Store.pdfFile(path)
        val out = File(base.path + ".seiten")
        return try {
            snapshot(path, mapOf("rotate" to "Drehen", "delete" to "Löschen", "insert" to "Einfügen", "move" to "Verschieben")[op.kind] ?: "Seiten")
            val r = withContext(Dispatchers.IO) { edit(base, out, op, sizes) }
            upload(path, out, r.incremental, r.map, r.rot)
            try { Store.pullNotes(path) } catch (e: Exception) { }
            null
        } catch (e: Api.ApiError) {
            out.delete(); undos.remove(path); e.message ?: "Fehler"
        } catch (e: Exception) {
            out.delete(); undos.remove(path)
            Crash.report("Seiten bearbeiten fehlgeschlagen", e)
            "Keine Verbindung zum Server – Seiten bearbeiten geht nur online."
        }
    }

    /** beliebige Änderung mit PDFBox (Formular, Anhängen …); edit gibt zurück, ob angehängt gespeichert werden darf */
    /**
     * Änderung mit PDFBox. contentOnly = Seiten bleiben, wie sie sind (Text, Bilder, Kopfzeile, Formular, Lesezeichen …):
     * das geht auch ohne Internet – die neue Fassung wird dann später hochgeladen.
     */
    suspend fun custom(path: String, label: String, contentOnly: Boolean = false, map: List<Int> = emptyList(), work: (PDDocument) -> Boolean): String? {
        if (!contentOnly) ready(path)?.let { return it }
        val base = Store.pdfFile(path)
        val out = File(base.path + ".neu2")
        var built = false
        return try {
            while (Burn.isBusy(path)) kotlinx.coroutines.delay(300)
            snapshot(path, label)
            val inc = withContext(Dispatchers.IO) {
                var incOk = false
                PDDocument.load(base, MemoryUsageSetting.setupTempFileOnly()).use { doc ->
                    val canInc = work(doc)
                    if (canInc) try { out.outputStream().use { doc.saveIncremental(it) }; incOk = out.length() > base.length() && verify(out, doc.numberOfPages) } catch (e: Throwable) { incOk = false }
                    if (!incOk) doc.save(out)
                }
                incOk
            }
            built = true
            try { upload(path, out, inc, map, JSONObject()); if (map.isNotEmpty()) try { Store.pullNotes(path) } catch (e: Exception) { } }
            catch (e: java.io.IOException) {
                if (!contentOnly || e is Api.ApiError) throw e
                // offline: hier übernehmen, später hochladen
                withContext(Dispatchers.IO) { if (!out.renameTo(base)) { out.copyTo(base, true); out.delete() } }
                Store.markLocal(path, System.currentTimeMillis() / 1000 + 1, base.length())
                dirty(path, true)
            }
            null
        } catch (e: Api.ApiError) { out.delete(); undos.remove(path); e.message ?: "Fehler" }
        catch (e: Exception) { out.delete(); undos.remove(path); if (!built) Crash.report("$label fehlgeschlagen", e); e.message ?: "Fehler" }
    }

    /** Probe nach angehängtem Speichern: lässt sich alles lesen? */
    private fun verify(f: File, pages: Int): Boolean = try {
        PDDocument.load(f, MemoryUsageSetting.setupTempFileOnly()).use { d ->
            d.numberOfPages == pages && d.pages.all { p -> p.contents?.use { it.readBytes() }; true }
        }
    } catch (e: Throwable) { false }

    // ---------------------------------------------------------------- offline geänderte PDFs später hochladen
    private fun dirtySet(): MutableSet<String> = (Store.prefs().getStringSet("pdfDirty", emptySet()) ?: emptySet()).toMutableSet()
    private fun dirty(path: String, on: Boolean) { val s = dirtySet(); if (on) s.add(path) else s.remove(path); Store.prefs().edit().putStringSet("pdfDirty", s).apply() }
    fun hasDirty() = dirtySet().isNotEmpty()

    suspend fun flushDirty() {
        for (p in dirtySet()) {
            val f = Store.pdfFile(p)
            if (!f.isFile) { dirty(p, false); continue }
            try {
                val res = Api.postForm("pageop", MultipartBody.Builder().setType(MultipartBody.FORM)
                    .addFormDataPart("path", p).addFormDataPart("map", "[]").addFormDataPart("rot", "{}")
                    .addFormDataPart("pdf", "neu.pdf", f.asRequestBody("application/pdf".toMediaType())).build())
                Store.markLocal(p, res.optLong("mtime"), res.optLong("size"))
                dirty(p, false)
            } catch (e: Api.ApiError) { if (e.code == 404) dirty(p, false) } catch (e: Exception) { return }
        }
    }

    /** letzte Seitenänderung zurücknehmen: alte Datei wiederherstellen (bei angehängtem Speichern nur abschneiden), Notizen zurück */
    suspend fun undo(path: String): String? {
        val u = undos[path] ?: return "Nichts zum Rückgängigmachen."
        ready(path)?.let { return it }
        val base = Store.pdfFile(path)
        return try {
            val prefix = withContext(Dispatchers.IO) { isPrefix(u.prev, base) }
            val out = File(base.path + ".zurueck")
            withContext(Dispatchers.IO) { u.prev.copyTo(out, true) }
            upload(path, out, false, emptyList(), JSONObject(), if (prefix) u.prev.length() else -1L)
            // Notizen: aktuellen Stand durch den gesicherten ersetzen (neue Kennungen, der Server merkt sich gelöschte)
            val d = Store.doc(path)
            Store.deleteStrokes(path, d.strokes.keys.toList())
            Store.addStrokes(path, u.notes.map { JSONObject(it.toString()).put("id", Store.uid()) })
            u.prev.delete(); undos.remove(path)
            null
        } catch (e: Api.ApiError) { e.message ?: "Fehler" }
        catch (e: Exception) { Crash.report("Rückgängig (Seiten) fehlgeschlagen", e); "Keine Verbindung zum Server." }
    }

    private fun isPrefix(a: File, b: File): Boolean {
        if (a.length() >= b.length()) return false
        a.inputStream().buffered(1 shl 20).use { x -> b.inputStream().buffered(1 shl 20).use { y ->
            val ba = ByteArray(1 shl 16); val bb = ByteArray(1 shl 16)
            var left = a.length()
            while (left > 0) {
                val n = x.read(ba, 0, minOf(ba.size.toLong(), left).toInt()); if (n <= 0) return false
                var got = 0; while (got < n) { val m = y.read(bb, got, n - got); if (m <= 0) return false; got += m }
                for (k in 0 until n) if (ba[k] != bb[k]) return false
                left -= n
            }
        } }
        return true
    }

    private class Res(val map: List<Int>, val rot: JSONObject, val incremental: Boolean)

    private fun mark(o: Any?) { (o as? COSUpdateInfo)?.isNeedToBeUpdated = true }

    private fun edit(base: File, out: File, op: Op, sizes: (Int) -> Pair<Float, Float>): Res {
        for (inc in listOf(true, false)) {
            try {
                PDDocument.load(base, MemoryUsageSetting.setupTempFileOnly()).use { doc ->
                    val n = doc.numberOfPages
                    val before = (0 until n).map { doc.getPage(it).cosObject }
                    val r = apply(doc, op, n, sizes)
                    if (inc) {
                        // alle Knoten des Seitenbaums und die geänderten Seiten kennzeichnen
                        mark(doc.documentCatalog.cosObject)
                        for (k in 0 until doc.numberOfPages) {
                            val pg = doc.getPage(k).cosObject
                            mark(pg)
                            var p = pg.getDictionaryObject(COSName.PARENT) as? COSDictionary
                            while (p != null) { mark(p); mark(p.getDictionaryObject(COSName.KIDS)); p = p.getDictionaryObject(COSName.PARENT) as? COSDictionary }
                        }
                        out.outputStream().use { doc.saveIncremental(it) }
                    } else doc.save(out)
                    // Probe: Reihenfolge der Seiten wie erwartet?
                    val expect = r.map.withIndex().filter { it.value >= 0 }.sortedBy { it.value }.map { before[it.index] }
                    PDDocument.load(out, MemoryUsageSetting.setupTempFileOnly()).use { chk ->
                        val ok = chk.numberOfPages == n + (if (op.kind == "insert") 1 else if (op.kind == "delete") -1 else 0) &&
                            (!inc || expect.all { e -> (0 until chk.numberOfPages).any { k -> sameObj(chk.getPage(k).cosObject, e) } })
                        if (!ok) throw IllegalStateException("Probe fehlgeschlagen")
                    }
                    return Res(r.map, r.rot, inc)
                }
            } catch (e: Throwable) {
                out.delete()
                if (!inc) throw e
                Crash.report("Seiten: angehängtes Speichern nicht möglich, ganze Datei", e)
            }
        }
        throw IllegalStateException("unerreichbar")
    }

    private fun sameObj(a: COSDictionary, b: COSDictionary): Boolean = a.getDictionaryObject(COSName.CONTENTS)?.toString() == b.getDictionaryObject(COSName.CONTENTS)?.toString()

    private class R(val map: List<Int>, val rot: JSONObject)

    private fun apply(doc: PDDocument, op: Op, n: Int, sizes: (Int) -> Pair<Float, Float>): R {
        val i = op.i
        val rot = JSONObject()
        return when (op.kind) {
            "rotate" -> {
                val pg = doc.getPage(i)
                pg.rotation = (pg.rotation + 90) % 360
                val (w, h) = sizes(i)
                rot.put(i.toString(), JSONObject().put("w", w.toDouble()).put("h", h.toDouble()))
                R((0 until n).toList(), rot)
            }
            "delete" -> {
                doc.removePage(i)
                R((0 until n).map { if (it == i) -1 else if (it > i) it - 1 else it }, rot)
            }
            "insert" -> {
                val (w, h) = sizes(i)
                val np = PDPage(PDRectangle(w, h))
                if (op.style != "plain") PDPageContentStream(doc, np).use { cs ->
                    if (op.style == "grid") {
                        val st = 14.173f; cs.setStrokingColor(0.8f, 0.84f, 0.9f); cs.setLineWidth(0.4f)
                        var x = st; while (x < w) { cs.moveTo(x, 0f); cs.lineTo(x, h); x += st }
                        var y = st; while (y < h) { cs.moveTo(0f, y); cs.lineTo(w, y); y += st }
                        cs.stroke()
                    } else if (op.style == "lines") {
                        val st = 22.68f; cs.setStrokingColor(0.74f, 0.79f, 0.88f); cs.setLineWidth(0.5f)
                        var y = h - 70; while (y > 40) { cs.moveTo(40f, y); cs.lineTo(w - 40, y); y -= st }
                        cs.stroke()
                    }
                }
                doc.pages.insertAfter(np, doc.getPage(i))
                R((0 until n).map { if (it <= i) it else it + 1 }, rot)
            }
            "move" -> {
                val j = op.j.coerceIn(0, n - 1)
                val pg = doc.getPage(i)
                doc.pages.remove(pg)
                if (j >= n - 1) doc.pages.insertAfter(pg, doc.getPage(n - 2)) else doc.pages.insertBefore(pg, doc.getPage(j))
                val order = (0 until n).toMutableList(); order.removeAt(i); order.add(j, i)
                R((0 until n).map { order.indexOf(it) }, rot)
            }
            else -> throw IllegalArgumentException(op.kind)
        }
    }
}
