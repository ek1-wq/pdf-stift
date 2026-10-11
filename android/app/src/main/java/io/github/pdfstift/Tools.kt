package io.github.pdfstift

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.ArrayAdapter
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import com.tom_roush.pdfbox.cos.COSName
import com.tom_roush.pdfbox.cos.COSUpdateInfo
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDCheckBox
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDChoice
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDRadioButton
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDTerminalField
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDTextField
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt

/** Werkzeuge wie in der Web-App: Schlagwörter, Merkliste, Verknüpfungen, Bilder, Unterschrift, Stempel, Formulare, Seiten herausziehen, Anhängen */
object Tools {
    private fun dp(c: Context, v: Float) = Ui.dp(c, v)

    // ---------------------------------------------------------------- PDF auswählen
    fun pickPdf(a: Activity, title: String, cb: (LibFile) -> Unit) {
        val files = Store.cachedLibrary()?.let { Store.files(it) } ?: emptyList()
        val search = EditText(a).apply { hint = "Suchen …"; isSingleLine = true }
        val lv = ListView(a)
        var shown = files
        fun upd(q: String) {
            shown = if (q.isBlank()) files else files.filter { it.path.lowercase().contains(q.lowercase()) }
            lv.adapter = ArrayAdapter(a, android.R.layout.simple_list_item_2, android.R.id.text1, shown.map { it.name.removeSuffix(".pdf") }).also { }
        }
        upd("")
        search.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, x: Int, y: Int, z: Int) {}
            override fun onTextChanged(s: CharSequence?, x: Int, y: Int, z: Int) {}
            override fun afterTextChanged(s: Editable?) { upd(s.toString()) }
        })
        val box = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(a, 16f), dp(a, 4f), dp(a, 16f), 0); addView(search); addView(lv, Ui.lp(-1, dp(a, 420f))) }
        val d = AlertDialog.Builder(a).setTitle(title).setView(box).setNegativeButton("Abbrechen", null).create()
        lv.setOnItemClickListener { _, _, pos, _ -> d.dismiss(); cb(shown[pos]) }
        d.show()
    }

    /** PDF bereitstellen (bei Bedarf laden) */
    suspend fun ensureLocal(a: Activity, f: LibFile): Boolean {
        if (Store.hasLocal(f.path)) return true
        val pr = Ui.Progress(a, "„${f.name.removeSuffix(".pdf")}“ wird geladen …")
        return try { Api.download(f.path, Store.pdfFile(f.path)) { d, t -> a.runOnUiThread { pr.set(d, t) } }; Store.markLocal(f.path, f.mtime, f.size); true }
        catch (e: Exception) { Ui.toast(a, "Laden fehlgeschlagen – Internet nötig."); false }
        finally { pr.close() }
    }

    fun ask(a: Activity, title: String, hint: String, value: String, ok: String, number: Boolean = false, cb: (String) -> Unit) {
        val e = EditText(a).apply { this.hint = hint; setText(value); isSingleLine = true; if (number) inputType = InputType.TYPE_CLASS_NUMBER; selectAll() }
        val box = LinearLayout(a).apply { setPadding(dp(a, 20f), dp(a, 8f), dp(a, 20f), 0); addView(e, Ui.lp()) }
        AlertDialog.Builder(a).setTitle(title).setView(box).setPositiveButton(ok) { _, _ -> cb(e.text.toString()) }.setNegativeButton("Abbrechen", null).show()
        e.requestFocus()
    }

    // ---------------------------------------------------------------- Schlagwörter
    fun editTags(a: Activity, path: String, done: () -> Unit = {}) {
        val all = Meta.allTags().map { it.first }
        ask(a, "Schlagwörter", "durch Komma getrennt" + if (all.isNotEmpty()) " – bisher: " + all.take(12).joinToString(", ") else "", Meta.tags(path).joinToString(", "), "Speichern") { v ->
            Store.scope.launch {
                val err = Meta.setTags(path, v.split(',', ';').map { it.trim() }.filter { it.isNotEmpty() })
                Ui.toast(a, err ?: "Schlagwörter gespeichert."); done()
            }
        }
    }

    // ---------------------------------------------------------------- Verknüpfungen
    fun insertLink(a: Activity, view: DocView) {
        pickPdf(a, "Verknüpfung zu …") { f ->
            ask(a, "Seite", "Seitenzahl in „${f.name.removeSuffix(".pdf")}“", "1", "Weiter", true) { pg ->
                val n = (pg.toIntOrNull() ?: 1).coerceAtLeast(1)
                ask(a, "Beschriftung", "so erscheint die Verknüpfung", "→ ${f.name.removeSuffix(".pdf")}, S. $n", "Einfügen") { label ->
                    if (label.isBlank()) return@ask
                    val (p, x, y) = view.viewCenter()
                    val fs = 14f
                    val pnt = Paint().apply { textSize = fs }
                    val bw = pnt.measureText(label)
                    val s = JSONObject().put("id", Store.uid()).put("p", p).put("t", "txt").put("c", "#1E4FB8").put("fs", fs.toDouble())
                        .put("pts", JSONArray(listOf(r2(x - bw / 2), r2(y)))).put("text", label).put("bw", r2(bw)).put("bh", r2(fs * 1.1f))
                        .put("ln", JSONObject().put("path", f.path).put("pg", n - 1))
                    view.addNew(s)
                    Ui.toast(a, "Verknüpfung eingefügt – mit dem Finger antippen springt zum Ziel, mit dem Lasso verschieben.", true)
                }
            }
        }
    }

    fun backlinks(a: Activity, path: String, open: (String, Int) -> Unit) {
        Store.scope.launch {
            val links = try { Api.get("backlinks", mapOf("path" to path)).optJSONArray("links") ?: JSONArray() } catch (e: Exception) { Ui.toast(a, "Geht nur mit Internetverbindung."); return@launch }
            if (links.length() == 0) { Ui.alert(a, "Verweise auf diese PDF", "Bisher verweist keine andere Seite hierher."); return@launch }
            val items = (0 until links.length()).map { links.getJSONObject(it) }
            AlertDialog.Builder(a).setTitle("Verweise auf diese PDF")
                .setItems(items.map { it.optString("from").substringAfterLast('/').removeSuffix(".pdf") + " – Seite " + (it.optInt("page") + 1) + "\n" + it.optString("text").take(60) }.toTypedArray()) { _, i ->
                    open(items[i].optString("from"), items[i].optInt("page"))
                }.setNegativeButton("Schließen", null).show()
        }
    }

    private fun r2(v: Float) = (v * 100).roundToInt() / 100.0

    // ---------------------------------------------------------------- Bilder (Foto, Galerie, Unterschrift)
    /** Bild verkleinern und hochladen; place(src, breite, höhe) setzt es dann auf Seite oder Tafel */
    fun addImage(a: Activity, bmp0: Bitmap, png: Boolean = false, place: (String, Float, Float) -> Unit) {
        val pr = Ui.Progress(a, "Bild wird eingefügt …")
        Store.scope.launch {
            try {
                val bytes = withContext(Dispatchers.Default) {
                    val m = 2000f / maxOf(bmp0.width, bmp0.height)
                    val bmp = if (m < 1f) Bitmap.createScaledBitmap(bmp0, (bmp0.width * m).roundToInt(), (bmp0.height * m).roundToInt(), true) else bmp0
                    ByteArrayOutputStream().also { bmp.compress(if (png) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG, 85, it) }.toByteArray()
                }
                val form = MultipartBody.Builder().setType(MultipartBody.FORM)
                    .addFormDataPart("file", if (png) "bild.png" else "bild.jpg", bytes.toRequestBody((if (png) "image/png" else "image/jpeg").toMediaType())).build()
                val r = Api.postForm("imgput", form)
                val src = r.getString("src")
                Images.file(src).writeBytes(bytes)
                place(src, r.optDouble("w", 1.0).toFloat(), r.optDouble("h", 1.0).toFloat())
                Ui.toast(a, "Eingefügt – mit dem Lasso verschieben.")
            } catch (e: Api.ApiError) { Ui.alert(a, "Nicht eingefügt", e.message ?: "") }
            catch (e: Exception) { Ui.alert(a, "Nicht eingefügt", "Bilder einfügen geht nur mit Internetverbindung.") }
            finally { pr.close() }
        }
    }

    /** Bild in die Mitte der sichtbaren PDF-Seite */
    fun addImage(a: Activity, view: DocView, bmp0: Bitmap, png: Boolean = false, widthFrac: Float = 0.5f) = addImage(a, bmp0, png) { src, iw, ih ->
        val (p, cx, cy) = view.viewCenter()
        val w = view.pageWidthPt(p) * widthFrac
        val h = w * ih / iw
        view.addNew(JSONObject().put("id", Store.uid()).put("p", p).put("t", "img").put("c", "#000000").put("src", src)
            .put("pts", JSONArray(listOf(r2(cx - w / 2), r2(cy - h / 2)))).put("bw", r2(w)).put("bh", r2(h)))
    }

    /** Kamera oder Galerie wählen */
    fun photoChoice(a: Activity, camera: () -> Unit, gallery: () -> Unit) {
        AlertDialog.Builder(a).setTitle("Bild einfügen").setItems(arrayOf("📷  Foto aufnehmen", "🖼  Bild aus der Galerie")) { _, i -> if (i == 0) camera() else gallery() }.show()
    }

    /** Unterschrift: einmal zeichnen, wird gemerkt */
    fun signature(a: Activity, view: DocView) {
        val f = File(a.filesDir, "unterschrift.png")
        if (f.isFile) {
            AlertDialog.Builder(a).setTitle("Unterschrift").setMessage("Gespeicherte Unterschrift einfügen?")
                .setPositiveButton("Einfügen") { _, _ -> BitmapFactory.decodeFile(f.path)?.let { addImage(a, view, it, true, 0.28f) } }
                .setNeutralButton("Neu zeichnen") { _, _ -> drawSignature(a, view, f) }
                .setNegativeButton("Abbrechen", null).show()
        } else drawSignature(a, view, f)
    }

    private fun drawSignature(a: Activity, view: DocView, f: File) {
        val pad = SigPad(a)
        val box = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(a, 16f), dp(a, 8f), dp(a, 16f), 0)
            addView(Ui.text(a, "Mit dem Stift unterschreiben:", 14f, Ui.MUTED))
            addView(pad, Ui.lp(-1, dp(a, 220f)))
        }
        AlertDialog.Builder(a).setTitle("Unterschrift").setView(box)
            .setPositiveButton("Übernehmen") { _, _ ->
                val b = pad.export() ?: return@setPositiveButton
                f.outputStream().use { b.compress(Bitmap.CompressFormat.PNG, 100, it) }
                addImage(a, view, b, true, 0.28f)
            }
            .setNeutralButton("Löschen") { _, _ -> }
            .setNegativeButton("Abbrechen", null).show()
    }

    @SuppressLint("ViewConstructor")
    class SigPad(ctx: Context) : View(ctx) {
        private val path = Path()
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 3.2f * ctx.resources.displayMetrics.density; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND; color = Color.parseColor("#14257A") }
        private var minX = Float.MAX_VALUE; private var minY = Float.MAX_VALUE; private var maxX = 0f; private var maxY = 0f
        init { setBackgroundColor(0xFFF4F6FA.toInt()) }
        override fun onDraw(c: Canvas) { c.drawPath(path, paint) }
        @SuppressLint("ClickableViewAccessibility")
        override fun onTouchEvent(e: MotionEvent): Boolean {
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> path.moveTo(e.x, e.y)
                MotionEvent.ACTION_MOVE -> { for (h in 0 until e.historySize) path.lineTo(e.getHistoricalX(h), e.getHistoricalY(h)); path.lineTo(e.x, e.y) }
            }
            minX = minOf(minX, e.x); minY = minOf(minY, e.y); maxX = maxOf(maxX, e.x); maxY = maxOf(maxY, e.y)
            parent?.requestDisallowInterceptTouchEvent(true)
            invalidate(); return true
        }
        fun export(): Bitmap? {
            if (maxX <= minX) return null
            val pad = paint.strokeWidth * 2
            val l = (minX - pad).coerceAtLeast(0f); val t = (minY - pad).coerceAtLeast(0f)
            val w = ((maxX + pad).coerceAtMost(width.toFloat()) - l).roundToInt().coerceAtLeast(1); val h = ((maxY + pad).coerceAtMost(height.toFloat()) - t).roundToInt().coerceAtLeast(1)
            val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val c = Canvas(b); c.translate(-l, -t); c.drawPath(path, paint)
            return b
        }
    }

    // ---------------------------------------------------------------- Stempel
    fun stamp(a: Activity, view: DocView) {
        val today = SimpleDateFormat("dd.MM.yyyy", Locale.GERMANY).format(Date())
        val opts = listOf("ERLEDIGT" to "#13804A", "WICHTIG" to "#D6262B", "PRÜFEN" to "#E07B00", "ENTWURF" to "#6B7280", "GENEHMIGT" to "#13804A", "KLAUSURRELEVANT" to "#D6262B", "Datum: $today" to "#1E2F6E", "Eigener Text …" to "#1E2F6E")
        AlertDialog.Builder(a).setTitle("Stempel").setItems(opts.map { it.first }.toTypedArray()) { _, i ->
            val (label, col) = opts[i]
            if (i == opts.size - 1) ask(a, "Eigener Stempel", "Text", "", "Einfügen") { t -> if (t.isNotBlank()) putStamp(view, t.uppercase(Locale.GERMANY), col, today) }
            else putStamp(view, label, col, if (label.startsWith("Datum")) null else today)
        }.show()
    }

    private fun putStamp(view: DocView, text: String, col: String, date: String?) {
        val fs = 16f
        val full = if (date != null) "$text · $date" else text
        val pnt = Paint().apply { textSize = fs; typeface = android.graphics.Typeface.create(android.graphics.Typeface.SANS_SERIF, android.graphics.Typeface.BOLD) }
        val bw = pnt.measureText(full)
        val (p, x, y) = view.viewCenter()
        view.addNew(JSONObject().put("id", Store.uid()).put("p", p).put("t", "txt").put("c", col).put("fs", fs.toDouble()).put("b", 1)
            .put("pts", JSONArray(listOf(r2(x - bw / 2), r2(y)))).put("text", full).put("bw", r2(bw)).put("bh", r2(fs * 1.1f))
            .put("bo", col).put("bg", "#FFFFFF"))
    }

    // ---------------------------------------------------------------- Formulare
    fun forms(a: Activity, path: String, reload: () -> Unit) {
        val pr = Ui.Progress(a, "Formularfelder werden gelesen …")
        Store.scope.launch {
            val fields = withContext(Dispatchers.IO) {
                try {
                    PDDocument.load(Store.pdfFile(path), MemoryUsageSetting.setupTempFileOnly()).use { d ->
                        d.documentCatalog.acroForm?.fieldTree?.filterIsInstance<PDTerminalField>()?.filter { it !is com.tom_roush.pdfbox.pdmodel.interactive.form.PDSignatureField && it !is com.tom_roush.pdfbox.pdmodel.interactive.form.PDPushButton }
                            ?.map { f ->
                                val kind = when (f) { is PDCheckBox -> "cb"; is PDRadioButton -> "rb"; is PDChoice -> "ch"; else -> "tx" }
                                val opts = when (f) { is PDChoice -> f.optionsDisplayValues; is PDRadioButton -> f.onValues.toList(); else -> emptyList() }
                                arrayOf(f.fullyQualifiedName, kind, if (f is PDCheckBox) (if (f.isChecked) "1" else "") else f.valueAsString ?: "", opts.joinToString("\u0001"), f.alternateFieldName ?: "")
                            } ?: emptyList()
                    }
                } catch (e: Exception) { Crash.report("Formular lesen", e); emptyList() }
            }
            pr.close()
            if (fields.isEmpty()) { Ui.alert(a, "Formular", "Diese PDF hat keine ausfüllbaren Felder."); return@launch }
            val col = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(a, 20f), dp(a, 8f), dp(a, 20f), dp(a, 8f)) }
            val editors = ArrayList<Pair<Array<String>, View>>()
            for (f in fields) {
                col.addView(Ui.text(a, f[4].ifBlank { f[0] }, 13f, Ui.MUTED).apply { setPadding(0, dp(a, 10f), 0, 0) })
                val ed: View = when (f[1]) {
                    "cb" -> CheckBox(a).apply { isChecked = f[2].isNotEmpty(); text = "angekreuzt" }
                    "rb", "ch" -> Spinner(a).apply {
                        val o = listOf("") + f[3].split("\u0001").filter { it.isNotEmpty() }
                        adapter = ArrayAdapter(a, android.R.layout.simple_spinner_dropdown_item, o); setSelection(o.indexOf(f[2]).coerceAtLeast(0))
                    }
                    else -> EditText(a).apply { setText(f[2]); textSize = 16f }
                }
                col.addView(ed, Ui.lp())
                editors.add(f to ed)
            }
            AlertDialog.Builder(a).setTitle("Formular ausfüllen").setView(ScrollView(a).apply { addView(col) })
                .setPositiveButton("Speichern") { _, _ ->
                    val values = editors.associate { (f, v) -> f[0] to when (v) { is CheckBox -> if (v.isChecked) "1" else ""; is Spinner -> (v.selectedItem as? String) ?: ""; is EditText -> v.text.toString(); else -> "" } }
                    val pr2 = Ui.Progress(a, "Formular wird gespeichert …")
                    Store.scope.launch {
                        val err = PageOps.custom(path, "Formular") { d ->
                            val form = d.documentCatalog.acroForm
                            for (fld in form.fieldTree.filterIsInstance<PDTerminalField>()) {
                                val v = values[fld.fullyQualifiedName] ?: continue
                                when (fld) {
                                    is PDCheckBox -> if (v.isNotEmpty()) fld.check() else fld.unCheck()
                                    is PDRadioButton -> if (v.isNotEmpty()) fld.value = v
                                    is PDChoice -> if (v.isNotEmpty()) fld.setValue(v)
                                    is PDTextField -> fld.value = v
                                    else -> {}
                                }
                                mark(fld.cosObject); fld.widgets.forEach { w -> mark(w.cosObject); mark(w.cosObject.getDictionaryObject(COSName.AP)); w.appearance?.cosObject?.let { mark(it) } }
                            }
                            mark(form.cosObject); mark(d.documentCatalog.cosObject)
                            true
                        }
                        pr2.close()
                        if (err != null) Ui.alert(a, "Nicht gespeichert", err) else { Ui.toast(a, "Formular gespeichert."); reload() }
                    }
                }.setNegativeButton("Abbrechen", null).show()
        }
    }

    private fun mark(o: Any?) { (o as? COSUpdateInfo)?.isNeedToBeUpdated = true }

    // ---------------------------------------------------------------- Seiten herausziehen / PDF anhängen
    fun extract(a: Activity, path: String, pageCount: Int, current: Int, done: () -> Unit) {
        ask(a, "Seiten als neue PDF", "z. B. 3-7 oder 1,4,9 (insgesamt $pageCount Seiten)", "${current + 1}", "Weiter") { spec ->
            val pages = parsePages(spec, pageCount)
            if (pages.isEmpty()) { Ui.toast(a, "Keine gültigen Seitenzahlen."); return@ask }
            val stem = path.substringAfterLast('/').removeSuffix(".pdf")
            ask(a, "Name der neuen PDF", "Dateiname", "$stem (S. ${spec.trim()})", "Erstellen") { name ->
                val pr = Ui.Progress(a, "Neue PDF wird erstellt …")
                Store.scope.launch {
                    try {
                        val tmp = File(a.cacheDir, "auszug.pdf")
                        withContext(Dispatchers.IO) {
                            PDDocument.load(Store.pdfFile(path), MemoryUsageSetting.setupTempFileOnly()).use { src ->
                                PDDocument().use { out -> for (i in pages) out.importPage(src.getPage(i)); out.save(tmp) }
                            }
                        }
                        val folder = if (path.contains('/')) path.substringBeforeLast('/') else ""
                        Api.upload(folder, name.trim().ifBlank { stem } + ".pdf", tmp)
                        tmp.delete()
                        Ui.toast(a, "Neue PDF liegt im selben Ordner.")
                        done()
                    } catch (e: Exception) { Crash.report("Seiten herausziehen", e); Ui.alert(a, "Nicht erstellt", e.message ?: "Internet nötig.") }
                    finally { pr.close() }
                }
            }
        }
    }

    fun parsePages(spec: String, n: Int): List<Int> {
        val out = LinkedHashSet<Int>()
        for (part in spec.split(',', ';', ' ').map { it.trim() }.filter { it.isNotEmpty() }) {
            val r = part.split('-', '–')
            val a = r[0].toIntOrNull() ?: continue
            val b = if (r.size > 1) r[1].toIntOrNull() ?: n else a
            for (k in minOf(a, b)..maxOf(a, b)) if (k in 1..n) out.add(k - 1)
        }
        return out.toList()
    }

    fun append(a: Activity, path: String, reload: () -> Unit) {
        pickPdf(a, "Welche PDF hinten anhängen?") { f ->
            if (f.path == path) { Ui.toast(a, "Bitte eine andere PDF wählen."); return@pickPdf }
            Store.scope.launch {
                if (!ensureLocal(a, f)) return@launch
                val pr = Ui.Progress(a, "Wird angehängt …")
                val err = PageOps.custom(path, "Anhängen") { d ->
                    val other = PDDocument.load(Store.pdfFile(f.path), MemoryUsageSetting.setupTempFileOnly())
                    for (pg in other.pages) d.importPage(pg)
                    false // ganze Datei neu schreiben (die andere PDF bleibt bis dahin offen)
                }
                pr.close()
                if (err != null) Ui.alert(a, "Nicht angehängt", err) else { Ui.toast(a, "„${f.name.removeSuffix(".pdf")}“ wurde hinten angehängt."); reload() }
            }
        }
    }

    /** PDF mit allen Notizen an eine andere App geben (Mail, Teams, WhatsApp, Drucken …) */
    fun share(a: Activity, path: String) {
        val name = path.substringAfterLast('/').let { if (it.lowercase().endsWith(".pdf")) it else "$it.pdf" }
        val pr = Ui.Progress(a, "PDF mit Notizen wird vorbereitet …")
        Store.scope.launch {
            try { Store.flush() } catch (e: Exception) { }
            while (Burn.isBusy(path)) kotlinx.coroutines.delay(300)
            val dir = File(a.cacheDir, "share").apply { deleteRecursively(); mkdirs() }
            val out = File(dir, name)
            val ok = Burn.export(path, out)
            pr.close()
            if (!ok || !out.isFile) { Ui.alert(a, "Nicht geteilt", "Die PDF mit Notizen konnte nicht erstellt werden."); return@launch }
            val uri = androidx.core.content.FileProvider.getUriForFile(a, "io.github.pdfstift.files", out)
            val send = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                type = "application/pdf"
                putExtra(android.content.Intent.EXTRA_STREAM, uri)
                putExtra(android.content.Intent.EXTRA_SUBJECT, name.removeSuffix(".pdf"))
                addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            try { a.startActivity(android.content.Intent.createChooser(send, "PDF mit Notizen teilen")) } catch (e: Exception) { Ui.toast(a, "Keine App zum Teilen gefunden.") }
        }
    }
}
