package io.github.pdfstift

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import android.widget.ArrayAdapter
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ListView
import androidx.appcompat.app.AlertDialog
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle
import com.tom_roush.pdfbox.pdmodel.graphics.image.JPEGFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** PDF erstellen (aus Fotos, PDFs, Word/Excel/PowerPoint) und Zusammenfügen */
object Create {
    val TYPES = arrayOf(
        "application/pdf", "image/*",
        "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.oasis.opendocument.text", "application/vnd.oasis.opendocument.spreadsheet", "application/vnd.oasis.opendocument.presentation", "application/rtf",
    )
    private val OFFICE = setOf("doc", "docx", "odt", "rtf", "ppt", "pptx", "pps", "ppsx", "odp", "xls", "xlsx", "ods")

    /** eine Quelle zum Zusammenfügen: fertige PDF-Datei auf dem Tablet */
    class Part(val name: String, val file: File)

    fun fromDevice(h: FileHost) {
        h.pickFiles(TYPES) { uris ->
            if (uris.isEmpty()) return@pickFiles
            Store.scope.launch {
                val parts = prepare(h.act, uris) ?: return@launch
                if (parts.isEmpty()) return@launch
                finish(h, parts, if (parts.size == 1) parts[0].name.substringBeforeLast('.') else "Neue PDF " + SimpleDateFormat("dd.MM.yyyy", Locale.GERMANY).format(Date()))
            }
        }
    }

    private fun nameOf(a: Activity, u: Uri): String = try {
        a.contentResolver.query(u, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
    } catch (e: Exception) { null } ?: (u.lastPathSegment?.substringAfterLast('/') ?: "Datei")

    /** Dateien vom Tablet in PDFs umwandeln: Fotos und PDFs hier, Office über den Server */
    suspend fun prepare(a: Activity, uris: List<Uri>): List<Part>? {
        val dir = File(a.cacheDir, "erstellen").apply { deleteRecursively(); mkdirs() }
        val pr = Ui.Progress(a, "Dateien werden vorbereitet …")
        val out = ArrayList<Part>()
        try {
            for ((k, u) in uris.withIndex()) {
                val name = nameOf(a, u)
                a.runOnUiThread { pr.label.text = "$name (${k + 1} von ${uris.size})" }
                val ext = name.substringAfterLast('.', "").lowercase()
                val mime = a.contentResolver.getType(u) ?: ""
                val raw = File(dir, "q$k.$ext")
                withContext(Dispatchers.IO) { a.contentResolver.openInputStream(u)?.use { i -> raw.outputStream().use { i.copyTo(it) } } }
                val pdf = File(dir, "p$k.pdf")
                when {
                    ext == "pdf" || mime == "application/pdf" -> raw.renameTo(pdf)
                    mime.startsWith("image/") || ext in setOf("jpg", "jpeg", "png", "heic", "webp", "gif", "bmp") -> withContext(Dispatchers.IO) { imageToPdf(raw, pdf) }
                    ext in OFFICE -> try { Api.convert(raw, name, pdf) } catch (e: Exception) {
                        pr.close(); Ui.alert(a, "„$name“ nicht umgewandelt", (if (e is Api.ApiError) e.message ?: "" else "Word, Excel und PowerPoint werden auf dem Server umgewandelt – dafür braucht es Internet.")); return null
                    }
                    else -> { pr.close(); Ui.alert(a, "Nicht unterstützt", "„$name“: Nur PDF, Fotos/Bilder sowie Word, Excel und PowerPoint."); return null }
                }
                raw.delete()
                if (pdf.isFile) out.add(Part(name, pdf))
            }
        } finally { pr.close() }
        return out
    }

    /** Foto als PDF-Seite (Breite A4, Höhe nach Seitenverhältnis), Ausrichtung aus der Kamera berücksichtigt */
    private fun imageToPdf(src: File, out: File) {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(src.path, o)
        var sample = 1; while (maxOf(o.outWidth, o.outHeight) / sample > 3000) sample *= 2
        var b = BitmapFactory.decodeFile(src.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: throw IllegalStateException("Bild nicht lesbar")
        val rot = try { androidx.exifinterface.media.ExifInterface(src.path).rotationDegrees } catch (e: Exception) { 0 }
        if (rot != 0) b = Bitmap.createBitmap(b, 0, 0, b.width, b.height, android.graphics.Matrix().apply { postRotate(rot.toFloat()) }, true)
        PDDocument().use { d ->
            val w = 595f; val h = w * b.height / b.width
            val page = PDPage(PDRectangle(w, h)); d.addPage(page)
            val img = JPEGFactory.createFromImage(d, b, 0.88f)
            PDPageContentStream(d, page).use { it.drawImage(img, 0f, 0f, w, h) }
            d.save(out)
        }
        b.recycle()
    }

    /** Teile zu einer PDF verbinden, Namen erfragen, in die Bibliothek legen und öffnen */
    fun finish(h: FileHost, parts: List<Part>, defName: String) {
        val a = h.act
        val e = EditText(a).apply { setText(defName); isSingleLine = true; selectAll() }
        val box = LinearLayout(a).apply { setPadding(Ui.dp(a, 20f), Ui.dp(a, 8f), Ui.dp(a, 20f), 0); addView(e, Ui.lp()) }
        AlertDialog.Builder(a).setTitle("Name der neuen PDF").setView(box).setNegativeButton("Abbrechen", null).setPositiveButton("Erstellen") { _, _ ->
            val name = e.text.toString().trim().ifBlank { defName }.replace('/', '-') + ".pdf"
            val pr = Ui.Progress(a, "PDF wird erstellt …")
            Store.scope.launch {
                val out = File(a.cacheDir, "neu.pdf")
                val ok = withContext(Dispatchers.IO) {
                    try {
                        val docs = parts.map { PDDocument.load(it.file, MemoryUsageSetting.setupTempFileOnly()) }
                        try { PDDocument().use { d -> for (s in docs) for (p in s.pages) d.importPage(p); d.save(out) } } finally { docs.forEach { it.close() } }
                        true
                    } catch (x: Throwable) { Crash.report("PDF erstellen/zusammenfügen", x); false }
                }
                if (!ok) { pr.close(); Ui.alert(a, "Nicht erstellt", "Eine der Dateien ließ sich nicht lesen (beschädigt oder mit Passwort geschützt?)."); return@launch }
                try {
                    val r = Api.upload(h.folder, name, out)
                    val path = r.optJSONArray("saved")?.optString(0)
                    pr.close()
                    if (path.isNullOrEmpty()) { Ui.alert(a, "Nicht gespeichert", r.optJSONArray("errors")?.optString(0) ?: "Der Server hat die Datei nicht angenommen."); return@launch }
                    withContext(Dispatchers.IO) { Store.pdfFile(path).also { it.parentFile?.mkdirs(); out.copyTo(it, true) } }
                    Store.markLocal(path, System.currentTimeMillis() / 1000, out.length())
                    parts.forEach { it.file.delete() }
                    Ui.toast(a, "„${name.removeSuffix(".pdf")}“ liegt jetzt in der Bibliothek.")
                    h.openPath(path)
                } catch (x: Exception) {
                    pr.close()
                    // ohne Internet: als Datei weitergeben
                    val f = File(File(a.cacheDir, "share").apply { mkdirs() }, name)
                    out.copyTo(f, true)
                    Ui.alert(a, "Nicht hochgeladen", "Ohne Verbindung kann die PDF nicht in die Bibliothek. Du kannst sie aber weitergeben oder speichern.", "Weitergeben", "Schließen") { Acro.shareFile(a, f, "application/pdf", "PDF weitergeben") }
                }
            }
        }.show()
    }

    // ---------------------------------------------------------------- Zusammenfügen: mehrere PDFs aus der Bibliothek (in der gewählten Reihenfolge)
    fun merge(h: FileHost, first: String? = (h as? ToolHost)?.docPath) {
        val a = h.act
        val files = (Store.cachedLibrary()?.let { Store.files(it) } ?: emptyList()).sortedBy { it.name.lowercase() }
        val order = ArrayList<LibFile>()
        files.firstOrNull { it.path == first }?.let { order.add(it) }
        val lv = ListView(a).apply { choiceMode = ListView.CHOICE_MODE_MULTIPLE }
        val info = Ui.text(a, "", 13f, Ui.MUTED)
        fun upd() { info.text = if (order.isEmpty()) "Antippen in der Reihenfolge, in der die PDFs hintereinander kommen sollen." else order.mapIndexed { i, f -> "${i + 1}. ${f.name.removeSuffix(".pdf")}" }.joinToString("\n") }
        lv.adapter = ArrayAdapter(a, android.R.layout.simple_list_item_multiple_choice, files.map { it.name.removeSuffix(".pdf") + "  ·  " + it.folder.ifEmpty { "Bibliothek" } })
        files.forEachIndexed { i, f -> if (order.any { it.path == f.path }) lv.setItemChecked(i, true) }
        lv.setOnItemClickListener { _, _, i, _ -> val f = files[i]; if (lv.isItemChecked(i)) { if (order.none { it.path == f.path }) order.add(f) } else order.removeAll { it.path == f.path }; upd() }
        upd()
        val box = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(Ui.dp(a, 16f), 0, Ui.dp(a, 16f), 0); addView(info); addView(lv, Ui.lp(-1, Ui.dp(a, 380f))) }
        AlertDialog.Builder(a).setTitle("Zusammenfügen").setView(box).setNegativeButton("Abbrechen", null)
            .setNeutralButton("Vom Tablet …") { _, _ -> fromDevice(h) }
            .setPositiveButton("Weiter") { _, _ ->
                if (order.size < 2) { Ui.toast(a, "Bitte mindestens zwei PDFs wählen."); return@setPositiveButton }
                Store.scope.launch {
                    val dir = File(a.cacheDir, "erstellen").apply { deleteRecursively(); mkdirs() }
                    val parts = ArrayList<Part>()
                    for ((k, f) in order.withIndex()) {
                        if (!Tools.ensureLocal(a, f)) return@launch
                        try { Store.pullNotes(f.path) } catch (e: Exception) { }
                        val p = File(dir, "z$k.pdf")
                        // mit Notizen
                        if (!Burn.export(f.path, p)) { Ui.alert(a, "Nicht möglich", "„${f.name}“ ließ sich nicht lesen."); return@launch }
                        parts.add(Part(f.name, p))
                    }
                    finish(h, parts, order.first().name.removeSuffix(".pdf") + " (zusammengefügt)")
                }
            }.show()
    }
}
