package io.github.pdfstift

import org.json.JSONObject
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.RectF
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.tom_roush.pdfbox.cos.COSDictionary
import com.tom_roush.pdfbox.cos.COSName
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.PDResources
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle
import com.tom_roush.pdfbox.pdmodel.encryption.AccessPermission
import com.tom_roush.pdfbox.pdmodel.encryption.StandardProtectionPolicy
import com.tom_roush.pdfbox.pdmodel.font.PDType1Font
import com.tom_roush.pdfbox.pdmodel.graphics.color.PDColor
import com.tom_roush.pdfbox.pdmodel.graphics.color.PDDeviceRGB
import com.tom_roush.pdfbox.pdmodel.graphics.image.JPEGFactory
import com.tom_roush.pdfbox.pdmodel.graphics.state.PDExtendedGraphicsState
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotation
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotationWidget
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAppearanceCharacteristicsDictionary
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAppearanceDictionary
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAppearanceStream
import com.tom_roush.pdfbox.pdmodel.interactive.documentnavigation.outline.PDDocumentOutline
import com.tom_roush.pdfbox.pdmodel.interactive.documentnavigation.outline.PDOutlineItem
import com.tom_roush.pdfbox.pdmodel.interactive.documentnavigation.outline.PDOutlineNode
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDAcroForm
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDCheckBox
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDField
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDTextField
import com.tom_roush.pdfbox.text.PDFTextStripper
import com.tom_roush.pdfbox.text.TextPosition
import com.tom_roush.pdfbox.util.Matrix
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/** Dateien wählen und neue PDFs öffnen (Bibliothek und PDF-Ansicht) */
interface FileHost {
    val act: AppCompatActivity
    /** Ordner, in dem neue PDFs landen */
    val folder: String
    fun pickFiles(types: Array<String>, cb: (List<android.net.Uri>) -> Unit)
    fun openPath(path: String)
}

/** Was die Werkzeuge von der geöffneten PDF brauchen (ViewerActivity) */
interface ToolHost : FileHost {
    val doc: DocView
    val docPath: String
    fun reload()
    fun showMode(text: String, buttons: List<Pair<String, () -> Unit>>)
    fun modeText(t: String)
    fun endMode()
    fun showThumbs()
    fun pickImage(cb: (Bitmap) -> Unit)
}

/** „Werkzeuge“ wie in der Web-App – alles direkt auf dem Tablet, wo es geht auch ohne Internet */
object Acro {
    private class T(val id: String, val label: String, val color: String, val sub: String)
    private val GROUPS = listOf(
        "Erstellen & Bearbeiten" to listOf(
            T("create", "PDF erstellen", "#E5484D", "Word, Excel, PowerPoint, Fotos"),
            T("merge", "Zusammenfügen", "#6E56CF", "mehrere Dateien zu einer PDF"),
            T("organize", "Seiten organisieren", "#30A46C", "umsortieren, drehen, löschen, herausziehen"),
            T("edittext", "Text bearbeiten", "#D6409F", "Zeilen ändern, Schrift und Farbe"),
            T("editimg", "Bilder bearbeiten", "#D6409F", "verschieben, Größe, ersetzen, löschen"),
            T("export", "Exportieren", "#12A594", "Word, Excel, PowerPoint, Bilder"),
            T("ocr", "Scans optimieren", "#30A46C", "Text erkennen, durchsuchbar machen"),
            T("scanfix", "Scans aufbereiten", "#30A46C", "gerade richten, leere Seiten weg, Kontrast"),
            T("handout", "Handzettel", "#0091FF", "2–9 Folien pro Seite, mit Notizlinien"),
            T("stamp", "Kopf-/Fußzeile & Wasserzeichen", "#0091FF", "Seitenzahlen, Datum, Entwurf"),
            T("outline", "Lesezeichen", "#F76B15", "Inhaltsverzeichnis anlegen"),
        ),
        "Prüfen & Kommentieren" to listOf(
            T("comment", "Kommentieren", "#E5A000", "markieren, schreiben, Formen"),
            T("stamps", "Stempel", "#8E4EC6", "Genehmigt, Eingegangen am …"),
            T("compare", "Vergleichen", "#E5484D", "mit früherer Fassung oder anderer PDF"),
        ),
        "Formulare & Unterschrift" to listOf(
            T("fillsign", "Ausfüllen & Unterschreiben", "#8E4EC6", "Formularfelder, Unterschrift"),
            T("prepform", "Formular vorbereiten", "#D6409F", "Felder anlegen"),
        ),
        "Schützen" to listOf(
            T("protect", "Mit Passwort schützen", "#0091FF", "geschützte Kopie weitergeben"),
            T("redact", "Schwärzen", "#1B1F29", "Inhalte endgültig entfernen"),
            T("findredact", "Suchen & Schwärzen", "#1B1F29", "Namen, Nummern, E-Mails automatisch finden"),
        ),
    )

    fun menu(h: ToolHost) {
        val a = h.act
        val dp = { v: Float -> Ui.dp(a, v) }
        lateinit var dlg: AlertDialog
        val box = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(14f), dp(4f), dp(14f), dp(8f)) }
        for ((g, items) in GROUPS) {
            box.addView(Ui.text(a, g, 13f, Ui.MUTED, true).apply { setPadding(dp(4f), dp(12f), 0, dp(4f)) })
            val flow = Flow(a, false)
            for (t in items) {
                val tile = LinearLayout(a).apply {
                    orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                    background = Ui.rounded(Color.WHITE, dp(12f).toFloat(), Ui.LINE, dp(1f))
                    setPadding(dp(10f), dp(10f), dp(10f), dp(10f))
                    addView(TextView(a).apply { background = Ui.rounded(Color.parseColor(t.color), dp(6f).toFloat()) }, LinearLayout.LayoutParams(dp(10f), dp(30f)).apply { rightMargin = dp(10f) })
                    addView(LinearLayout(a).apply {
                        orientation = LinearLayout.VERTICAL
                        addView(Ui.text(a, t.label, 15f, Ui.INK, true))
                        addView(Ui.text(a, t.sub, 12f, Ui.MUTED))
                    })
                    layoutParams = ViewGroup.MarginLayoutParams(dp(232f), -2).apply { setMargins(dp(3f), dp(3f), dp(3f), dp(3f)) }
                    setOnClickListener { dlg.dismiss(); run(h, t.id) }
                }
                flow.addView(tile)
            }
            box.addView(flow, Ui.lp())
        }
        dlg = AlertDialog.Builder(a).setTitle("Werkzeuge").setView(ScrollView(a).apply { addView(box) }).setNegativeButton("Schließen", null).create()
        dlg.show()
    }

    fun run(h: ToolHost, id: String) {
        val a = h.act
        GROUPS.flatMap { it.second }.firstOrNull { it.id == id }?.let { Usage.track("tool", it.label) }
        when (id) {
            "create" -> Create.fromDevice(h)
            "merge" -> Create.merge(h)
            "organize" -> h.showThumbs()
            "edittext" -> TextEdit.start(h)
            "editimg" -> ImgEdit.start(h)
            "export" -> Export.show(h)
            "ocr" -> Ocr.ask(h)
            "stamp" -> headFoot(h)
            "outline" -> Outline.show(h)
            "comment" -> Ui.toast(a, "Zum Kommentieren die Werkzeugleiste nutzen: Stift, Marker, Text markieren, Formen, Textfeld.", true)
            "stamps" -> Tools.stamp(a, h.doc)
            "compare" -> Compare.start(h)
            "fillsign" -> AlertDialog.Builder(a).setTitle("Ausfüllen & Unterschreiben").setItems(arrayOf("Formularfelder ausfüllen …", "Unterschrift einfügen …")) { _, i ->
                if (i == 0) Tools.forms(a, h.docPath) { h.reload() } else Tools.signature(a, h.doc)
            }.show()
            "prepform" -> FormPrep.start(h)
            "protect" -> protect(h)
            "redact" -> Redact.start(h)
            "findredact" -> FindRedact.start(h)
            "handout" -> Handout.start(h)
            "scanfix" -> ScanFix.start(h)
        }
    }

    /** PDF-Änderung ausführen (mit Fortschritt), danach neu anzeigen */
    fun apply(h: ToolHost, label: String, busy: String, done: String, contentOnly: Boolean = true, after: (suspend () -> Unit)? = null, quiet: Boolean = false, work: (PDDocument) -> Boolean) {
        val pr = if (quiet) null else Ui.Progress(h.act, busy)
        Store.scope.launch {
            val err = PageOps.custom(h.docPath, label, contentOnly, work = work)
            if (err == null) after?.invoke()
            pr?.close()
            if (err != null) Ui.alert(h.act, "$label hat nicht geklappt", err)
            else { h.reload(); Ui.toast(h.act, done + if (PageOps.hasDirty()) " (wird hochgeladen, sobald Internet da ist)" else "") }
        }
    }

    fun dispSize(p: PDPage): Pair<Float, Float> {
        val b = p.cropBox
        return if (((p.rotation % 360) + 360) % 360 % 180 == 90) b.height to b.width else b.width to b.height
    }

    /** Text auf der angezeigten Seite schreiben (Grundlinie bei x, y; Winkel gegen den Uhrzeigersinn) */
    fun drawText(cs: PDPageContentStream, font: PDType1Font, size: Float, text: String, x: Float, y: Float, rgb: FloatArray, ang: Float = 0f) {
        val c = cos(ang); val s = sin(ang)
        cs.beginText()
        cs.setFont(font, size)
        cs.setNonStrokingColor(rgb[0], rgb[1], rgb[2])
        cs.setTextMatrix(Matrix(c, -s, -s, -c, x, y))
        cs.showText(text)
        cs.endText()
    }

    private fun field(a: Context, label: String, value: String, hint: String = "", number: Boolean = false): Pair<LinearLayout, EditText> {
        val e = EditText(a).apply { setText(value); this.hint = hint; isSingleLine = true; if (number) inputType = InputType.TYPE_CLASS_NUMBER }
        val l = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; addView(Ui.text(a, label, 13f, Ui.MUTED, true).apply { setPadding(0, Ui.dp(a, 8f), 0, 0) }); addView(e) }
        return l to e
    }

    // ================================================================ Kopf-/Fußzeile, Seitenzahlen, Wasserzeichen
    private fun headFoot(h: ToolHost) {
        val a = h.act; val p = Store.prefs()
        val (l1, head) = field(a, "Kopfzeile (oben in der Mitte)", p.getString("hfHead", "") ?: "", "z. B. {datei}")
        val (l2, foot) = field(a, "Fußzeile (unten links)", p.getString("hfFoot", "") ?: "", "z. B. INU · {datum}")
        val nums = listOf("" to "keine", "{n}" to "1", "Seite {n} von {N}" to "Seite 1 von 9", "{n} / {N}" to "1 / 9")
        val numSp = Spinner(a).apply { adapter = ArrayAdapter(a, android.R.layout.simple_spinner_dropdown_item, nums.map { it.second }); setSelection(nums.indexOfFirst { it.first == p.getString("hfNum", "") }.coerceAtLeast(0)) }
        val poss = listOf("br" to "unten rechts", "bc" to "unten in der Mitte", "tr" to "oben rechts")
        val posSp = Spinner(a).apply { adapter = ArrayAdapter(a, android.R.layout.simple_spinner_dropdown_item, poss.map { it.second }); setSelection(poss.indexOfFirst { it.first == p.getString("hfPos", "br") }.coerceAtLeast(0)) }
        val (l3, wm) = field(a, "Wasserzeichen (schräg über der Seite)", p.getString("hfWm", "") ?: "", "z. B. ENTWURF")
        val (l4, size) = field(a, "Schriftgröße", p.getInt("hfSize", 9).toString(), number = true)
        val (l5, from) = field(a, "ab Seite", "1", number = true)
        val box = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL; setPadding(Ui.dp(a, 20f), 0, Ui.dp(a, 20f), 0)
            addView(Ui.text(a, "Platzhalter: {n} Seite, {N} Seitenzahl gesamt, {datum}, {datei}. Wird fest in die PDF geschrieben.", 13f, Ui.MUTED))
            addView(l1); addView(l2)
            addView(Ui.text(a, "Seitenzahlen", 13f, Ui.MUTED, true).apply { setPadding(0, Ui.dp(a, 8f), 0, 0) }); addView(numSp)
            addView(Ui.text(a, "Position der Seitenzahl", 13f, Ui.MUTED, true).apply { setPadding(0, Ui.dp(a, 8f), 0, 0) }); addView(posSp)
            addView(l3); addView(l4); addView(l5)
        }
        AlertDialog.Builder(a).setTitle("Kopf-/Fußzeile, Seitenzahlen, Wasserzeichen").setView(ScrollView(a).apply { addView(box) })
            .setNegativeButton("Abbrechen", null)
            .setPositiveButton("Einfügen") { _, _ ->
                val hd = head.text.toString().trim(); val ft = foot.text.toString().trim(); val wmT = wm.text.toString().trim()
                val num = nums[numSp.selectedItemPosition].first; val pos = poss[posSp.selectedItemPosition].first
                val sz = (size.text.toString().toIntOrNull() ?: 9).coerceIn(6, 24).toFloat()
                val fr = (from.text.toString().toIntOrNull() ?: 1).coerceAtLeast(1)
                p.edit().putString("hfHead", hd).putString("hfFoot", ft).putString("hfNum", num).putString("hfPos", pos).putString("hfWm", wmT).putInt("hfSize", sz.toInt()).apply()
                if (hd.isEmpty() && ft.isEmpty() && num.isEmpty() && wmT.isEmpty()) { Ui.toast(a, "Es wurde nichts eingetragen."); return@setPositiveButton }
                val stem = h.docPath.substringAfterLast('/').removeSuffix(".pdf")
                val date = SimpleDateFormat("dd.MM.yyyy", Locale.GERMANY).format(Date())
                apply(h, "Kopf-/Fußzeile", "Wird eingefügt …", "Eingefügt.") { d ->
                    val n = d.numberOfPages
                    val font = PDType1Font.HELVETICA; val bold = PDType1Font.HELVETICA_BOLD
                    val grey = floatArrayOf(0.25f, 0.27f, 0.33f)
                    fun fill(t: String, i: Int) = t.replace("{n}", "${i + 1}").replace("{N}", "$n").replace("{datum}", date, true).replace("{datei}", stem, true)
                    for (i in 0 until n) {
                        if (i + 1 < fr) continue
                        val page = d.getPage(i)
                        val (W, H) = dispSize(page)
                        val m = max(18f, min(W, H) * 0.045f)
                        PDPageContentStream(d, page, PDPageContentStream.AppendMode.APPEND, true, true).use { cs ->
                            cs.saveGraphicsState(); cs.transform(Pdfx.displayMatrix(page))
                            fun put(t0: String, x: Float, y: Float, align: Char) {
                                val t = Pdfx.encodable(font, t0)
                                val w = font.getStringWidth(t) / 1000f * sz
                                drawText(cs, font, sz, t, when (align) { 'c' -> x - w / 2; 'r' -> x - w; else -> x }, y, grey)
                            }
                            if (hd.isNotEmpty()) put(fill(hd, i), W / 2, m, 'c')
                            if (ft.isNotEmpty()) put(fill(ft, i), m, H - m * 0.7f, 'l')
                            if (num.isNotEmpty()) when (pos) {
                                "bc" -> put(fill(num, i), W / 2, H - m * 0.7f, 'c')
                                "tr" -> put(fill(num, i), W - m, m, 'r')
                                else -> put(fill(num, i), W - m, H - m * 0.7f, 'r')
                            }
                            if (wmT.isNotEmpty()) {
                                val t = Pdfx.encodable(bold, fill(wmT, i))
                                val ang = atan2(H, W)
                                var s = min(W, H) / 5
                                val w0 = bold.getStringWidth(t) / 1000f * s
                                s = min(s, s * (hypot(W, H) * 0.75f) / max(1f, w0))
                                val w = bold.getStringWidth(t) / 1000f * s
                                val x = W / 2 - cos(ang) * w / 2 + sin(ang) * s * 0.35f
                                val y = H / 2 + sin(ang) * w / 2 + cos(ang) * s * 0.35f
                                cs.saveGraphicsState()
                                cs.setGraphicsStateParameters(PDExtendedGraphicsState().apply { nonStrokingAlphaConstant = 0.16f })
                                drawText(cs, bold, s, t, x, y, floatArrayOf(0.85f, 0.15f, 0.15f), ang)
                                cs.restoreGraphicsState()
                            }
                            cs.restoreGraphicsState()
                        }
                        Pdfx.markPage(d, page)
                    }
                    true
                }
            }.show()
    }

    // ================================================================ Mit Passwort schützen
    private fun protect(h: ToolHost) {
        val a = h.act
        val p1 = EditText(a).apply { hint = "Passwort"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
        val p2 = EditText(a).apply { hint = "Passwort wiederholen"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD }
        val print = CheckBox(a).apply { text = "Drucken erlauben"; isChecked = true }
        val copy = CheckBox(a).apply { text = "Text kopieren erlauben"; isChecked = false }
        val box = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL; setPadding(Ui.dp(a, 20f), 0, Ui.dp(a, 20f), 0)
            addView(Ui.text(a, "Es entsteht eine geschützte Kopie (mit deinen Notizen) zum Weitergeben. Deine PDF hier bleibt ungeschützt.", 13f, Ui.MUTED))
            addView(p1); addView(p2); addView(print); addView(copy)
        }
        val dlg = AlertDialog.Builder(a).setTitle("Mit Passwort schützen").setView(box).setNegativeButton("Abbrechen", null).setPositiveButton("Weiter", null).create()
        dlg.setOnShowListener {
            dlg.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val pw = p1.text.toString()
                if (pw.length < 4) { p1.error = "Mindestens 4 Zeichen."; return@setOnClickListener }
                if (pw != p2.text.toString()) { p2.error = "Stimmt nicht überein."; return@setOnClickListener }
                dlg.dismiss()
                val pr = Ui.Progress(a, "Geschützte Kopie wird erstellt …")
                Store.scope.launch {
                    val name = h.docPath.substringAfterLast('/').removeSuffix(".pdf") + " (geschützt).pdf"
                    val dir = File(a.cacheDir, "share").apply { deleteRecursively(); mkdirs() }
                    val tmp = File(dir, "tmp.pdf"); val out = File(dir, name)
                    val ok = Burn.export(h.docPath, tmp) && withContext(Dispatchers.IO) {
                        try {
                            PDDocument.load(tmp, MemoryUsageSetting.setupTempFileOnly()).use { d ->
                                val ap = AccessPermission().apply { setCanPrint(print.isChecked); setCanExtractContent(copy.isChecked); setCanModify(false) }
                                val pol = StandardProtectionPolicy(java.util.UUID.randomUUID().toString(), pw, ap).apply { encryptionKeyLength = 256 }
                                d.protect(pol); d.save(out)
                            }
                            true
                        } catch (e: Throwable) { Crash.report("Passwortschutz", e); false } finally { tmp.delete() }
                    }
                    pr.close()
                    if (!ok) { Ui.alert(a, "Nicht geschützt", "Die geschützte Kopie konnte nicht erstellt werden."); return@launch }
                    shareFile(a, out, "application/pdf", "Geschützte PDF weitergeben")
                }
            }
        }
        dlg.show()
    }

    fun shareFile(a: android.app.Activity, f: File, mime: String, title: String) {
        val uri = androidx.core.content.FileProvider.getUriForFile(a, "io.github.pdfstift.files", f)
        val send = Intent(Intent.ACTION_SEND).apply { type = mime; putExtra(Intent.EXTRA_STREAM, uri); putExtra(Intent.EXTRA_SUBJECT, f.nameWithoutExtension); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        try { a.startActivity(Intent.createChooser(send, title)) } catch (e: Exception) { Ui.toast(a, "Keine App zum Teilen gefunden.") }
    }

    /** Seite i der Datei als Bild (für Schwärzen, Texterkennung, Export) – eigener Zeichner, unabhängig von der Anzeige */
    fun render(ctx: Context, src: PdfSource, i: Int, maxPx: Int): Pair<Bitmap, Float> {
        val (w, hh) = src.size(i)
        val sc = min(maxPx / max(w, hh), 300f / 72f)
        val bw = (w * sc).toInt().coerceAtLeast(1); val bh = (hh * sc).toInt().coerceAtLeast(1)
        val b = Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888); b.eraseColor(Color.WHITE)
        src.render(i, b, 0, 0, bw, bh)
        return b to sc
    }
}

// ==================================================================== Lesezeichen
object Outline {
    class Item(var title: String, var page: Int, var level: Int)

    fun show(h: ToolHost) {
        Store.scope.launch {
            val items = withContext(Dispatchers.IO) {
                val out = ArrayList<Item>()
                try {
                    PDDocument.load(Store.pdfFile(h.docPath), MemoryUsageSetting.setupTempFileOnly()).use { d ->
                        fun walk(n: PDOutlineNode, lvl: Int) {
                            for (it in n.children()) {
                                val pg = try { it.findDestinationPage(d)?.let { p -> d.pages.indexOf(p) } ?: -1 } catch (e: Exception) { -1 }
                                out.add(Item(it.title ?: "", pg, lvl))
                                walk(it, lvl + 1)
                            }
                        }
                        d.documentCatalog.documentOutline?.let { walk(it, 0) }
                    }
                } catch (e: Exception) { }
                out
            }
            dialog(h, items, false)
        }
    }

    private fun dialog(h: ToolHost, items: MutableList<Item>, dirty: Boolean) {
        val a = h.act
        val lv = ListView(a)
        lv.adapter = ArrayAdapter(a, android.R.layout.simple_list_item_1, items.map { "    ".repeat(it.level) + it.title + if (it.page >= 0) "  ·  S. ${it.page + 1}" else "" })
        val box = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL; setPadding(Ui.dp(a, 16f), 0, Ui.dp(a, 16f), 0)
            addView(Ui.text(a, if (items.isEmpty()) "Noch keine Lesezeichen. Antippen springt zur Seite, lange drücken = ändern." else "Antippen springt zur Seite, lange drücken = umbenennen, einrücken, löschen.", 13f, Ui.MUTED))
            addView(lv, Ui.lp(-1, Ui.dp(a, 360f)))
        }
        val b = AlertDialog.Builder(a).setTitle("Lesezeichen").setView(box)
            .setNeutralButton("+ Diese Seite") { _, _ ->
                val pg = h.doc.currentPage()
                Tools.ask(a, "Lesezeichen für Seite ${pg + 1}", "Titel", "Seite ${pg + 1}", "Hinzufügen") { t ->
                    val at = items.indexOfFirst { it.page > pg }.let { if (it < 0) items.size else it }
                    items.add(at, Item(t.ifBlank { "Seite ${pg + 1}" }, pg, if (at > 0) items[at - 1].level else 0))
                    dialog(h, items, true)
                }
            }
        if (dirty) b.setPositiveButton("In die PDF speichern") { _, _ -> save(h, items) }.setNegativeButton("Verwerfen", null)
        else b.setPositiveButton("Schließen", null)
        val dlg = b.create()
        lv.setOnItemClickListener { _, _, i, _ -> if (items[i].page >= 0) { h.doc.goTo(items[i].page); if (!dirty) dlg.dismiss() } }
        lv.setOnItemLongClickListener { _, _, i, _ ->
            val it = items[i]
            AlertDialog.Builder(a).setTitle(it.title).setItems(arrayOf("Umbenennen …", "Auf aktuelle Seite (${h.doc.currentPage() + 1}) setzen", "Einrücken →", "← Ausrücken", "Löschen")) { _, k ->
                dlg.dismiss()
                when (k) {
                    0 -> { Tools.ask(a, "Umbenennen", "Titel", it.title, "OK") { t -> it.title = t.ifBlank { it.title }; dialog(h, items, true) }; return@setItems }
                    1 -> it.page = h.doc.currentPage()
                    2 -> if (i > 0) it.level = minOf(it.level + 1, items[i - 1].level + 1)
                    3 -> it.level = maxOf(0, it.level - 1)
                    4 -> items.removeAt(i)
                }
                dialog(h, items, true)
            }.show()
            true
        }
        dlg.show()
    }

    private fun save(h: ToolHost, items: List<Item>) {
        Acro.apply(h, "Lesezeichen", "Lesezeichen werden gespeichert …", "Lesezeichen gespeichert.") { d ->
            val root = PDDocumentOutline()
            val stack = ArrayList<PDOutlineNode>().apply { add(root) }
            for (it in items) {
                val o = PDOutlineItem(); o.title = it.title
                if (it.page in 0 until d.numberOfPages) o.setDestination(d.getPage(it.page))
                while (stack.size - 1 > it.level) stack.removeAt(stack.size - 1)
                stack.last().addLast(o)
                stack.add(o)
            }
            d.documentCatalog.documentOutline = if (items.isEmpty()) null else root
            false
        }
    }
}

// ==================================================================== Formular vorbereiten
object FormPrep {
    fun start(h: ToolHost) {
        h.doc.pick = "rect"
        h.doc.onPickRect = { pg, r -> ask(h, pg, r) }
        h.doc.onPickTap = { _, _, _ -> }
        h.showMode("Formular vorbereiten: Feld mit dem Stift als Rechteck aufziehen.", listOf("Fertig" to { h.endMode() }))
        showFields(h)
    }

    private fun showFields(h: ToolHost) {
        Store.scope.launch {
            val boxes = withContext(Dispatchers.IO) {
                val out = ArrayList<Pair<Int, RectF>>()
                try {
                    PDDocument.load(Store.pdfFile(h.docPath), MemoryUsageSetting.setupTempFileOnly()).use { d ->
                        for ((i, p) in d.pages.withIndex()) for (an in p.annotations) if (an is PDAnnotationWidget) {
                            val r = an.rectangle ?: continue
                            val a1 = Pdfx.toDisplay(p, r.lowerLeftX, r.lowerLeftY); val a2 = Pdfx.toDisplay(p, r.upperRightX, r.upperRightY)
                            out.add(i to RectF(min(a1[0], a2[0]), min(a1[1], a2[1]), max(a1[0], a2[0]), max(a1[1], a2[1])))
                        }
                    }
                } catch (e: Exception) { }
                out
            }
            if (h.doc.pick != null) h.doc.pickBoxes = boxes
        }
    }

    private fun ask(h: ToolHost, pg: Int, r: RectF) {
        val a = h.act
        val types = listOf("Textfeld (eine Zeile)", "Textfeld (mehrere Zeilen)", "Ankreuzfeld")
        val sp = Spinner(a).apply { adapter = ArrayAdapter(a, android.R.layout.simple_spinner_dropdown_item, types); setSelection(if (r.height() > 40) 1 else if (r.width() < 30 && r.height() < 30) 2 else 0) }
        val n = Store.prefs().getInt("fieldNo", 1)
        val name = EditText(a).apply { setText("Feld $n"); isSingleLine = true; selectAll() }
        val box = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(Ui.dp(a, 20f), 0, Ui.dp(a, 20f), 0); addView(sp); addView(Ui.text(a, "Name", 13f, Ui.MUTED, true)); addView(name) }
        AlertDialog.Builder(a).setTitle("Neues Formularfeld").setView(box).setNegativeButton("Abbrechen", null).setPositiveButton("Anlegen") { _, _ ->
            Store.prefs().edit().putInt("fieldNo", n + 1).apply()
            val kind = sp.selectedItemPosition
            val nm = name.text.toString().trim().ifBlank { "Feld $n" }.replace('.', ' ')
            Acro.apply(h, "Formularfeld", "Feld wird angelegt …", "Feld angelegt – zum Ausfüllen: Werkzeuge → Ausfüllen & Unterschreiben.") { d -> add(d, pg, r, kind, nm); false }
            h.doc.postDelayed({ if (h.doc.pick != null) showFields(h) }, 1500)
        }.show()
    }

    private fun add(d: PDDocument, pg: Int, r: RectF, kind: Int, name0: String) {
        val cat = d.documentCatalog
        val acro = cat.acroForm ?: PDAcroForm(d).also { cat.acroForm = it }
        if (acro.defaultResources == null) acro.defaultResources = PDResources().apply { put(COSName.getPDFName("Helv"), PDType1Font.HELVETICA); put(COSName.getPDFName("ZaDb"), PDType1Font.ZAPF_DINGBATS) }
        if (acro.defaultAppearance.isNullOrEmpty()) acro.defaultAppearance = "/Helv 0 Tf 0 g"
        acro.setNeedAppearances(true)
        val names = HashSet<String>(); for (f in acro.fieldTree) names.add(f.fullyQualifiedName ?: "")
        var name = name0; var k = 2; while (name in names) { name = "$name0 $k"; k++ }
        val page = d.getPage(pg)
        val u = Pdfx.toUserRect(page, r)
        val rect = PDRectangle(u[0], u[1], u[2], u[3])
        val field: PDField
        val w: PDAnnotationWidget
        if (kind == 2) {
            val cb = PDCheckBox(acro); cb.partialName = name
            w = cb.widgets[0]
            val ap = PDAppearanceDictionary()
            val n = COSDictionary()
            fun stream(on: Boolean) = PDAppearanceStream(d).also { s ->
                s.bBox = PDRectangle(0f, 0f, u[2], u[3]); s.resources = PDResources()
                PDPageContentStream(d, s).use { cs ->
                    cs.setStrokingColor(0.3f, 0.3f, 0.3f); cs.setLineWidth(1f); cs.addRect(0.5f, 0.5f, u[2] - 1, u[3] - 1); cs.stroke()
                    if (on) { cs.beginText(); cs.setFont(PDType1Font.ZAPF_DINGBATS, min(u[2], u[3]) * 0.8f); cs.newLineAtOffset(u[2] * 0.15f, u[3] * 0.2f); cs.showText("4"); cs.endText() }
                }
            }
            n.setItem(COSName.getPDFName("Yes"), stream(true)); n.setItem(COSName.Off, stream(false))
            ap.cosObject.setItem(COSName.N, n)
            w.appearance = ap
            w.cosObject.setName(COSName.AS, "Off")
            field = cb
        } else {
            val tf = PDTextField(acro); tf.partialName = name; tf.defaultAppearance = "/Helv 0 Tf 0 g"
            if (kind == 1) tf.isMultiline = true
            w = tf.widgets[0]
            field = tf
        }
        w.rectangle = rect; w.page = page; w.isPrinted = true
        w.appearanceCharacteristics = PDAppearanceCharacteristicsDictionary(COSDictionary()).apply { borderColour = PDColor(floatArrayOf(0.45f, 0.5f, 0.6f), PDDeviceRGB.INSTANCE) }
        page.annotations = ArrayList<PDAnnotation>(page.annotations).apply { add(w) }
        acro.fields = ArrayList(acro.fields).apply { add(field) }
    }
}

// ==================================================================== Schwärzen
object Redact {
    fun start(h: ToolHost) {
        val d = h.doc
        d.pick = "rect"
        d.onPickRect = { pg, r -> d.pickRects.getOrPut(pg) { ArrayList() }.add(r); d.invalidate(); upd(h) }
        d.onPickTap = { pg, x, y -> d.pickRects[pg]?.let { l -> l.lastOrNull { it.contains(x, y) }?.let { l.remove(it); d.invalidate(); upd(h) } } }
        h.showMode("", listOf("Anwenden" to { confirm(h) }, "Abbrechen" to { h.endMode() }))
        upd(h)
    }

    fun upd(h: ToolHost) {
        val n = h.doc.pickRects.values.sumOf { it.size }
        h.modeText(if (n == 0) "Schwärzen: Bereiche mit dem Stift aufziehen (antippen entfernt einen Bereich)." else "$n ${if (n == 1) "Bereich" else "Bereiche"} markiert – „Anwenden“ entfernt alles darunter endgültig.")
    }

    private fun confirm(h: ToolHost) {
        val rects = h.doc.pickRects.filterValues { it.isNotEmpty() }.mapValues { e -> e.value.map { RectF(it) } }
        if (rects.isEmpty()) { Ui.toast(h.act, "Zuerst Bereiche aufziehen."); return }
        Ui.alert(h.act, "Endgültig schwärzen?", "Auf ${rects.size} ${if (rects.size == 1) "Seite" else "Seiten"} wird alles unter den schwarzen Flächen entfernt – Text, Bilder, Anmerkungen. Diese Seiten werden dazu als Bild gespeichert; der übrige Text wird neu erkannt, damit die Seite durchsuchbar bleibt.", "Schwärzen", "Abbrechen") {
            run(h, rects)
        }
    }

    private fun run(h: ToolHost, rects: Map<Int, List<RectF>>) {
        val a = h.act
        val pr = Ui.Progress(a, "Wird geschwärzt …")
        Store.scope.launch {
            // 1. Seiten als Bild mit schwarzen Flächen, Text neu erkennen
            val pages = withContext(Dispatchers.IO) {
                val out = HashMap<Int, Triple<Bitmap, Float, List<Ocr.Word>>>()
                val src = PdfSource(a, Store.pdfFile(h.docPath))
                try {
                    for ((i, list) in rects) {
                        val (bmp, sc) = Acro.render(a, src, i, 3400)
                        val c = android.graphics.Canvas(bmp); val pnt = android.graphics.Paint().apply { color = Color.BLACK }
                        for (r in list) c.drawRect(r.left * sc, r.top * sc, r.right * sc, r.bottom * sc, pnt)
                        val words = try { Ocr.recognize(bmp, sc) } catch (e: Throwable) { emptyList() }
                        out[i] = Triple(bmp, sc, words)
                    }
                } finally { src.close() }
                out
            }
            pr.close()
            val path = h.docPath
            Acro.apply(h, "Schwärzen", "Wird gespeichert …", "Geschwärzt.", after = { purge(h, path) }) { d ->
                for ((i, t) in pages) {
                    val page = d.getPage(i)
                    val (W, H) = Acro.dispSize(page)
                    val img = JPEGFactory.createFromImage(d, t.first, 0.88f)
                    page.rotation = 0
                    val box = PDRectangle(0f, 0f, W, H)
                    page.mediaBox = box; page.cropBox = box
                    page.cosObject.removeItem(COSName.getPDFName("TrimBox")); page.cosObject.removeItem(COSName.getPDFName("BleedBox")); page.cosObject.removeItem(COSName.getPDFName("ArtBox"))
                    page.annotations = ArrayList()
                    page.resources = PDResources()
                    PDPageContentStream(d, page, PDPageContentStream.AppendMode.OVERWRITE, true).use { cs ->
                        cs.drawImage(img, 0f, 0f, W, H)
                        cs.saveGraphicsState(); cs.transform(Pdfx.displayMatrix(page))
                        Ocr.writeLayer(cs, t.third)
                        cs.restoreGraphicsState()
                    }
                }
                false // ganz neu schreiben, damit vom alten Inhalt nichts in der Datei bleibt
            }
            pages.values.forEach { it.first.recycle() }
            h.endMode()
        }
    }
}

/** Schwärzen: ungeschwärzte Fassungen auf dem Server und auf dem Tablet löschen (Einstellungen) */
private suspend fun purge(h: ToolHost, path: String) {
    if (!Settings.redactPurge) return
    PageOps.dropUndo(path)
    if (PageOps.hasDirty()) return // noch nicht hochgeladen – Sicherungen gibt es dann erst später
    try {
        val n = Api.post("purgebackup", JSONObject().put("path", path)).optInt("deleted")
        if (n > 0) Ui.toast(h.act, "Die ungeschwärzten Fassungen ($n) wurden gelöscht.")
    } catch (e: Exception) { }
}

// ==================================================================== Vergleichen
object Compare {
    private class Word(val t: String, val page: Int, val r: RectF?)

    fun start(h: ToolHost) {
        val a = h.act
        AlertDialog.Builder(a).setTitle("Vergleichen").setItems(arrayOf("Mit einer früheren Fassung dieser PDF …", "Mit einer anderen PDF …")) { _, i ->
            if (i == 1) Tools.pickPdf(a, "Womit vergleichen?") { f -> Store.scope.launch { if (Tools.ensureLocal(a, f)) run(h, Store.pdfFile(f.path), f.name.removeSuffix(".pdf")) } }
            else versions(h)
        }.show()
    }

    private fun versions(h: ToolHost) {
        val a = h.act
        Store.scope.launch {
            val list = try { Api.get("versions", mapOf("path" to h.docPath)).optJSONArray("versions") } catch (e: Exception) { null }
            if (list == null || list.length() == 0) { Ui.alert(a, "Keine frühere Fassung", "Zu dieser PDF gibt es auf dem Server keine gesicherte frühere Fassung (oder keine Verbindung)."); return@launch }
            val df = SimpleDateFormat("dd.MM.yyyy, HH:mm", Locale.GERMANY)
            val items = (0 until list.length()).map { list.getJSONObject(it) }
            AlertDialog.Builder(a).setTitle("Frühere Fassung").setItems(items.map { df.format(Date(it.optLong("time") * 1000)) + (it.optString("kind").takeIf { k -> k.isNotEmpty() }?.let { k -> " ($k)" } ?: "") }.toTypedArray()) { _, i ->
                Store.scope.launch {
                    val f = File(a.cacheDir, "vergleich.pdf")
                    val pr = Ui.Progress(a, "Frühere Fassung wird geladen …")
                    try {
                        Api.fetchFile(Api.BASE + "api.php?a=version&path=" + java.net.URLEncoder.encode(h.docPath, "UTF-8") + "&id=" + java.net.URLEncoder.encode(items[i].optString("id"), "UTF-8"), f) { _, _ -> }
                        pr.close(); run(h, f, "frühere Fassung")
                    } catch (e: Exception) { pr.close(); Ui.alert(a, "Nicht geladen", e.message ?: "") }
                }
            }.show()
        }
    }

    private fun words(f: File, withBoxes: Boolean): List<Word> {
        val out = ArrayList<Word>()
        PDDocument.load(f, MemoryUsageSetting.setupTempFileOnly()).use { d ->
            for (i in 0 until d.numberOfPages) {
                val st = object : PDFTextStripper() {
                    override fun writeString(text: String?, pos: MutableList<TextPosition>?) {
                        val ps = pos ?: return
                        var cur = StringBuilder(); var box: RectF? = null
                        fun flush() { if (cur.isNotBlank()) out.add(Word(cur.toString().lowercase(), i, box)); cur = StringBuilder(); box = null }
                        for (tp in ps) {
                            val u = tp.unicode ?: continue
                            if (u.isBlank()) { flush(); continue }
                            cur.append(u)
                            if (withBoxes) {
                                val fs = max(tp.fontSizeInPt, tp.heightDir)
                                val r = RectF(tp.xDirAdj, tp.yDirAdj - fs * 0.8f, tp.xDirAdj + tp.widthDirAdj, tp.yDirAdj + fs * 0.2f)
                                box = box?.apply { union(r) } ?: r
                            }
                        }
                        flush()
                    }
                }
                st.sortByPosition = true; st.startPage = i + 1; st.endPage = i + 1
                try { st.getText(d) } catch (e: Exception) { }
            }
        }
        return out
    }

    private fun run(h: ToolHost, other: File, otherName: String) {
        val a = h.act
        val pr = Ui.Progress(a, "Wird verglichen …")
        Store.scope.launch {
            val res = withContext(Dispatchers.IO) {
                try {
                    val mine = words(Store.pdfFile(h.docPath), true)
                    val theirs = words(other, false)
                    val pages = maxOf(mine.maxOfOrNull { it.page } ?: -1, theirs.maxOfOrNull { it.page } ?: -1) + 1
                    val added = ArrayList<Word>(); val removed = HashMap<Int, MutableList<String>>()
                    for (p in 0 until pages) {
                        val x = mine.filter { it.page == p }; val y = theirs.filter { it.page == p }
                        // längste gemeinsame Folge der Wörter
                        val n = x.size; val m = y.size
                        if (n.toLong() * m > 6_000_000L) { if (x.map { it.t } != y.map { it.t }) { added.addAll(x) }; continue }
                        val L = Array(n + 1) { IntArray(m + 1) }
                        for (i in n - 1 downTo 0) for (j in m - 1 downTo 0) L[i][j] = if (x[i].t == y[j].t) L[i + 1][j + 1] + 1 else maxOf(L[i + 1][j], L[i][j + 1])
                        var i = 0; var j = 0
                        while (i < n && j < m) {
                            if (x[i].t == y[j].t) { i++; j++ }
                            else if (L[i + 1][j] >= L[i][j + 1]) { added.add(x[i]); i++ }
                            else { removed.getOrPut(p) { ArrayList() }.add(y[j].t); j++ }
                        }
                        while (i < n) added.add(x[i++])
                        while (j < m) removed.getOrPut(p) { ArrayList() }.add(y[j++].t)
                    }
                    added to removed
                } catch (e: Throwable) { Crash.report("Vergleichen", e); null }
            }
            pr.close()
            if (res == null) { Ui.alert(a, "Vergleich nicht möglich", "Eine der Dateien ließ sich nicht lesen."); return@launch }
            val (added, removed) = res
            if (added.isEmpty() && removed.isEmpty()) { Ui.alert(a, "Keine Unterschiede", "Der Text ist gleich wie in „$otherName“. (Bilder und Layout werden nicht verglichen.)"); return@launch }
            // neue/geänderte Wörter in der PDF markieren (wie Suchtreffer)
            val hits = added.filter { it.r != null }.groupBy { it.page }.flatMap { (p, ws) -> ws.map { DocView.Hit(p, listOf(it.r!!.left, it.r.top, it.r.width(), it.r.height())) } }
            h.doc.hits = hits
            val pages = (added.map { it.page } + removed.keys).toSortedSet()
            val lines = pages.map { p ->
                val ad = added.count { it.page == p }; val rm = removed[p]?.size ?: 0
                "S. ${p + 1}: " + listOfNotNull(if (ad > 0) "$ad neu/geändert (orange)" else null, if (rm > 0) "$rm entfernt: „" + removed[p]!!.take(8).joinToString(" ") + (if (rm > 8) " …" else "") + "“" else null).joinToString(" · ")
            }
            AlertDialog.Builder(a).setTitle("Unterschiede zu „$otherName“").setItems(lines.toTypedArray()) { _, k -> h.doc.goTo(pages.elementAt(k)) }
                .setPositiveButton("OK", null).setNegativeButton("Markierungen weg") { _, _ -> h.doc.hits = emptyList() }.show()
        }
    }
}
