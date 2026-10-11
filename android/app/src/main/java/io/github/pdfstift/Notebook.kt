package io.github.pdfstift

import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Spinner
import androidx.appcompat.app.AlertDialog
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
import java.text.DateFormat
import java.util.Date
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Notizbuch: Folien übernehmen, Vorlagen, Textbausteine, PDF/Drucken, Verschieben (gleiches Datenformat wie die Web-Version) */
object Notebook {
    private fun r2(v: Double) = (v * 100).roundToInt() / 100.0

    // ---------------------------------------------------------------- Notizbücher
    suspend fun books(ctx: Context): JSONArray {
        val f = File(ctx.filesDir, "boards.json")
        try { createPending() } catch (e: Exception) { }
        return try {
            val b = Api.get("boards").optJSONArray("books") ?: JSONArray()
            f.writeText(b.toString()); b
        } catch (e: Exception) { try { JSONArray(f.readText()) } catch (e2: Exception) { JSONArray() } }
    }
    fun cachedBooks(ctx: Context): JSONArray = try { JSONArray(File(ctx.filesDir, "boards.json").readText()) } catch (e: Exception) { JSONArray() }
    fun pageTitle(ctx: Context, path: String): String {
        val bs = cachedBooks(ctx)
        for (i in 0 until bs.length()) { val secs = bs.getJSONObject(i).optJSONArray("sections") ?: continue
            for (k in 0 until secs.length()) { val pgs = secs.getJSONObject(k).optJSONArray("pages") ?: continue
                for (m in 0 until pgs.length()) { val p = pgs.getJSONObject(m); if (p.optString("path") == path) return p.optString("title") } } }
        return path.substringAfterLast('/')
    }
    /** Bezeichnung eines Verknüpfungsziels */
    fun linkName(ctx: Context, ln: JSONObject): String {
        val p = ln.optString("path")
        return if (p.startsWith("@nb/")) pageTitle(ctx, p) else p.substringAfterLast('/').removeSuffix(".pdf") + ", S. " + (ln.optInt("pg") + 1)
    }

    // ---------------------------------------------------------------- Text messen und Notizen bauen (Welt-Koordinaten)
    private val tp = Paint(Paint.ANTI_ALIAS_FLAG)
    fun measure(text: String, fs: Float, bold: Boolean): Pair<Double, Double> {
        tp.textSize = fs; tp.typeface = Typeface.create(Typeface.SANS_SERIF, if (bold) Typeface.BOLD else Typeface.NORMAL)
        val lines = text.split("\n")
        return max(fs * 0.5, lines.maxOf { tp.measureText(it).toDouble() }) to lines.size * fs * 1.25
    }
    fun txt(text: String, fs: Float, color: String, bold: Boolean, wx: Double, wy: Double, z: Double = 1.0): JSONObject {
        val (bw, bh) = measure(text, fs, bold)
        val s = JSONObject().put("id", Store.uid()).put("p", 0).put("t", "txt").put("c", color).put("fs", fs.toDouble()).put("pts", JSONArray(listOf(0.0, 0.0)))
            .put("text", text).put("bw", r2(bw)).put("bh", r2(bh)).put("o", JSONArray(listOf(wx, wy))).put("z", z)
        if (bold) s.put("b", 1)
        return s
    }
    private fun line(x0: Double, y0: Double, x1: Double, y1: Double, w: Double, c: String) = JSONObject().put("id", Store.uid()).put("p", 0).put("t", "sh").put("k", "line")
        .put("c", c).put("w", w).put("pts", JSONArray(listOf(0.0, 0.0, r2(x1 - x0), r2(y1 - y0)))).put("o", JSONArray(listOf(x0, y0))).put("z", 1.0)

    // ---------------------------------------------------------------- Seitenvorlagen
    val TEMPLATES = listOf(Triple("dots", "Leer (Punkte)", "dots"), Triple("lines", "Liniert", "lines"), Triple("grid", "Kariert", "grid"),
        Triple("cornell", "Cornell-Notizen", "plain"), Triple("meeting", "Besprechung", "plain"), Triple("lecture", "Vorlesung", "plain"))

    fun template(kind: String, x0: Double, y0: Double, title: String): List<JSONObject> {
        val out = ArrayList<JSONObject>(); val W = 800.0; val H = 1130.0; val grey = "#8C95A8"; val ink = "#3D4657"
        fun t(s: String, x: Double, y: Double, fs: Float, b: Boolean, c: String = ink) { out.add(txt(s, fs, c, b, x0 + x, y0 + y)) }
        fun l(xa: Double, ya: Double, xb: Double, yb: Double, w: Double = 1.2, c: String = grey) { out.add(line(x0 + xa, y0 + ya, x0 + xb, y0 + yb, w, c)) }
        fun rule(y: Double, from: Double = 0.0, to: Double = W) = l(from, y, to, y, 0.8, "#C3C9D5")
        fun rules(from: Int, to: Int, x: Double = 0.0) { var y = from.toDouble(); while (y < to) { rule(y, x); y += 36 } }
        val date = DateFormat.getDateInstance(DateFormat.MEDIUM, java.util.Locale.GERMANY).format(Date())
        when (kind) {
            "cornell" -> {
                t(title.ifBlank { "Thema" }, 0.0, 0.0, 26f, true); t(date, W - 130, 8.0, 15f, false, grey); l(0.0, 50.0, W, 50.0, 1.6, ink)
                t("Stichworte / Fragen", 8.0, 64.0, 15f, true, grey); t("Notizen", 258.0, 64.0, 15f, true, grey)
                l(240.0, 50.0, 240.0, 900.0); rules(120, 890, 250.0); l(0.0, 900.0, W, 900.0, 1.6, ink)
                t("Zusammenfassung", 8.0, 912.0, 15f, true, grey); rules(980, H.toInt())
            }
            "meeting" -> {
                t(title.ifBlank { "Besprechung" }, 0.0, 0.0, 26f, true); t(date, W - 130, 8.0, 15f, false, grey); l(0.0, 50.0, W, 50.0, 1.6, ink)
                t("Teilnehmende:", 0.0, 66.0, 15f, true, grey); rule(94.0, 130.0)
                t("Themen", 0.0, 120.0, 18f, true); rules(186, 400)
                t("Beschlüsse", 0.0, 420.0, 18f, true); rules(486, 660)
                t("Aufgaben", 0.0, 680.0, 18f, true)
                t("Was?", 0.0, 718.0, 14f, true, grey); t("Wer?", 470.0, 718.0, 14f, true, grey); t("Bis wann?", 650.0, 718.0, 14f, true, grey)
                l(0.0, 742.0, W, 742.0); l(460.0, 718.0, 460.0, H - 20); l(640.0, 718.0, 640.0, H - 20); rules(778, H.toInt())
            }
            "lecture" -> {
                t(title.ifBlank { "Vorlesung" }, 0.0, 0.0, 26f, true); t(date, W - 130, 8.0, 15f, false, grey); l(0.0, 50.0, W, 50.0, 1.6, ink)
                t("Lernziele", 0.0, 70.0, 18f, true); rules(136, 240)
                t("Notizen", 0.0, 260.0, 18f, true); rules(326, 900)
                t("Offene Fragen", 0.0, 920.0, 18f, true); rules(986, H.toInt())
            }
        }
        return out
    }

    /** Vorlage wählen; cb(Art, Titel) */
    fun templateDialog(a: Activity, forNew: Boolean, cb: (String, String) -> Unit) {
        val list = if (forNew) TEMPLATES else TEMPLATES.drop(3)
        val box = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(Ui.dp(a, 20f), Ui.dp(a, 8f), Ui.dp(a, 20f), 0) }
        val title = EditText(a).apply { hint = "Titel der Seite"; isSingleLine = true }
        var own = false
        var sel = Store.prefs().getString("tplLast", list[0].first)?.takeIf { k -> list.any { it.first == k } } ?: list[0].first
        val auto = { val tt = TEMPLATES.first { it.first == sel }; if (tt.third == "plain") tt.second else "Neue Seite " + DateFormat.getDateInstance(DateFormat.MEDIUM, java.util.Locale.GERMANY).format(Date()) }
        if (forNew) { title.setText(auto()); title.addTextChangedListener(object : android.text.TextWatcher {
            override fun afterTextChanged(s: android.text.Editable?) {}; override fun beforeTextChanged(s: CharSequence?, st: Int, c: Int, af: Int) {}
            override fun onTextChanged(s: CharSequence?, st: Int, b: Int, c: Int) { if (title.hasFocus()) own = true } }); box.addView(title, Ui.lp()) }
        val group = android.widget.RadioGroup(a)
        list.forEachIndexed { i, (k, label, _) -> group.addView(android.widget.RadioButton(a).apply { id = 1000 + i; text = label; textSize = 16f; isChecked = k == sel }) }
        group.setOnCheckedChangeListener { _, id -> sel = list[id - 1000].first; if (forNew && !own) title.setText(auto()) }
        box.addView(group, Ui.lp())
        AlertDialog.Builder(a).setTitle(if (forNew) "Neue Seite" else "Vorlage einfügen").setView(box)
            .setPositiveButton(if (forNew) "Anlegen" else "Einfügen") { _, _ -> Store.prefs().edit().putString("tplLast", sel).apply(); cb(sel, title.text.toString().trim()) }
            .setNegativeButton("Abbrechen", null).show()
    }

    // ---------------------------------------------------------------- Textbausteine (wie im Browser, dort angelegte gelten auch hier)
    private val SNIP0 = listOf(Triple("Wichtig!", "#D6262B", true), Triple("Merken", "#1F4FD6", true), Triple("Beispiel", "#1B8A3A", false),
        Triple("Definition", "#7048E8", true), Triple("Frage", "#E8590C", false), Triple("Nachlesen", "#495057", false))
    suspend fun snippets(): List<Triple<String, String, Boolean>> {
        try {
            val v = Api.get("prefs").optJSONObject("ui")?.opt("snippets")
            val arr = when (v) { is JSONArray -> v; is String -> try { JSONArray(v) } catch (e: Exception) { null }; else -> null }
            if (arr != null && arr.length() > 0) {
                val out = (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }.filter { it.optString("text").isNotBlank() }
                    .map { Triple(it.optString("text"), it.optString("c", "#1A1A1A").ifBlank { "#1A1A1A" }, it.optInt("b") == 1 || it.optBoolean("b")) }
                Store.prefs().edit().putString("snippets", JSONArray(out.map { JSONArray(listOf(it.first, it.second, it.third)) }).toString()).apply()
                return out
            }
        } catch (e: Exception) {
            try { val a = JSONArray(Store.prefs().getString("snippets", "[]")); if (a.length() > 0) return (0 until a.length()).map { a.getJSONArray(it).let { x -> Triple(x.getString(0), x.getString(1), x.getBoolean(2)) } } } catch (e2: Exception) { }
        }
        return SNIP0
    }

    // ---------------------------------------------------------------- Folien übernehmen
    /** Seite i einer PDF mit den Notizen der Notizebene als Bild (JPEG) */
    suspend fun pageJpeg(ctx: Context, path: String, i: Int, withNotes: Boolean): ByteArray {
        val (b, sc) = withContext(Dispatchers.IO) { val src = PdfSource(ctx, Store.pdfFile(path)); try { Acro.render(ctx, src, i, 1800) } finally { src.close() } }
        if (withNotes) {
            // Notizen auf dem Hauptfaden zeichnen (gemeinsame Zeichenwerkzeuge mit der Anzeige)
            val c = Canvas(b); c.scale(sc, sc)
            Store.doc(path).strokes.values.filter { it.optInt("p") == i && !it.has("ln") && it.optInt("nt") != 1 }.sortedBy { Ink.rank(it) }.forEach { Ink.draw(c, it) }
        }
        return withContext(Dispatchers.IO) { val bo = ByteArrayOutputStream(); b.compress(Bitmap.CompressFormat.JPEG, 88, bo); b.recycle(); bo.toByteArray() }
    }
    suspend fun upload(bytes: ByteArray): Triple<String, Double, Double> {
        val form = MultipartBody.Builder().setType(MultipartBody.FORM).addFormDataPart("file", "seite.jpg", bytes.toRequestBody("image/jpeg".toMediaType())).build()
        val r = Api.postForm("imgput", form)
        val src = r.getString("src")
        Images.file(src).writeBytes(bytes)
        return Triple(src, r.optDouble("w", 1.0), r.optDouble("h", 1.0))
    }
    /** Weltrechteck aller Notizen einer Notizseite */
    fun box(strokes: Collection<JSONObject>): DoubleArray? {
        if (strokes.isEmpty()) return null
        val r = doubleArrayOf(Double.MAX_VALUE, Double.MAX_VALUE, -Double.MAX_VALUE, -Double.MAX_VALUE)
        for (s in strokes) { val w = wbox(s); r[0] = min(r[0], w[0]); r[1] = min(r[1], w[1]); r[2] = max(r[2], w[2]); r[3] = max(r[3], w[3]) }
        return r
    }
    fun wbox(s: JSONObject): DoubleArray {
        val o = s.optJSONArray("o"); val ox = o?.optDouble(0) ?: 0.0; val oy = o?.optDouble(1) ?: 0.0; val z = s.optDouble("z", 1.0)
        val b = Ink.bounds(s)
        return doubleArrayOf(ox + b.left / z, oy + b.top / z, ox + b.right / z, oy + b.bottom / z)
    }
    class Img(val src: String, val w: Double, val h: Double, val path: String, val pg: Int)
    /** Bilder untereinander unter den vorhandenen Inhalt legen (Breite 800 wie im Browser) */
    fun imageStrokes(existing: Collection<JSONObject>, items: List<Img>): List<JSONObject> {
        val b = box(existing)
        val x = b?.get(0) ?: 0.0; var y = if (b != null) b[3] + 40 else 0.0
        return items.map { it ->
            val bh = r2(800 * it.h / it.w)
            val s = JSONObject().put("id", Store.uid()).put("p", 0).put("t", "img").put("c", "#000000").put("src", it.src).put("pts", JSONArray(listOf(0.0, 0.0)))
                .put("bw", 800.0).put("bh", bh).put("o", JSONArray(listOf(r2(x), r2(y)))).put("z", 1.0).put("ln", JSONObject().put("path", it.path).put("pg", it.pg))
            y += bh + 30; s
        }
    }
    fun parsePages(t: String, n: Int): List<Int>? {
        val out = sortedSetOf<Int>()
        for (part in t.split(Regex("[,;\\s]+")).filter { it.isNotBlank() }) {
            val m = Regex("^(\\d+)(?:\\s*[-–]\\s*(\\d+))?$").find(part.trim()) ?: return null
            var a = m.groupValues[1].toInt(); var b = m.groupValues[2].toIntOrNull() ?: a
            if (a > b) { val x = a; a = b; b = x }
            for (i in max(1, a)..min(n, b)) out.add(i - 1)
        }
        return out.toList()
    }

    /** Ziel wählen: Notizbuch, Abschnitt, Seite (vorhanden oder neu). cb(nb, sec, pagePath oder null = neue Seite, neues Notizbuch?) */
    fun pickTarget(a: Activity, books: JSONArray, cb: (String, String, String?, Boolean) -> Unit) {
        val p = Store.prefs()
        val box = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(Ui.dp(a, 20f), Ui.dp(a, 8f), Ui.dp(a, 20f), 0) }
        fun label(s: String) = Ui.text(a, s, 13f, Ui.MUTED).apply { setPadding(0, Ui.dp(a, 10f), 0, 0) }
        val nbNames = (0 until books.length()).map { books.getJSONObject(it).getString("name") }
        val spNb = Spinner(a); val nbNew = EditText(a).apply { hint = "Name des Notizbuchs"; isSingleLine = true; visibility = View.GONE }
        val spSec = Spinner(a); val secNew = EditText(a).apply { hint = "Name des Abschnitts"; isSingleLine = true; visibility = View.GONE }
        val spPg = Spinner(a)
        box.addView(label("Notizbuch")); box.addView(spNb, Ui.lp()); box.addView(nbNew, Ui.lp())
        box.addView(label("Abschnitt")); box.addView(spSec, Ui.lp()); box.addView(secNew, Ui.lp())
        box.addView(label("Seite")); box.addView(spPg, Ui.lp())
        fun adapter(items: List<String>) = ArrayAdapter(a, android.R.layout.simple_spinner_dropdown_item, items)
        var secNames = listOf<String>(); var pages = listOf<Pair<String, String>>()
        fun book() = (0 until books.length()).map { books.getJSONObject(it) }.find { it.getString("name") == spNb.selectedItem as? String }
        fun fillPages() {
            val b = book(); val sn = spSec.selectedItem as? String
            val sec = b?.optJSONArray("sections")?.let { ss -> (0 until ss.length()).map { ss.getJSONObject(it) }.find { it.getString("name") == sn } }
            pages = sec?.optJSONArray("pages")?.let { ps -> (0 until ps.length()).map { ps.getJSONObject(it).let { x -> x.getString("path") to x.optString("title") } } } ?: emptyList()
            spPg.adapter = adapter(listOf("＋ Neue Seite") + pages.map { it.second })
            val lp = p.getString("toNbPage", null); val k = pages.indexOfFirst { it.first == lp }
            if (k >= 0) spPg.setSelection(k + 1)
        }
        fun fillSecs() {
            val b = book()
            nbNew.visibility = if (b == null) View.VISIBLE else View.GONE
            secNames = b?.optJSONArray("sections")?.let { ss -> (0 until ss.length()).map { ss.getJSONObject(it).getString("name") } } ?: emptyList()
            spSec.adapter = adapter(secNames + "＋ Neuer Abschnitt …")
            val k = secNames.indexOf(p.getString("toNbSec", null))
            if (k >= 0) spSec.setSelection(k) else if (secNames.isEmpty()) spSec.setSelection(0)
            secNew.visibility = if (secNames.isEmpty()) View.VISIBLE else View.GONE
            fillPages()
        }
        spNb.adapter = adapter(nbNames + "＋ Neues Notizbuch …")
        nbNames.indexOf(p.getString("toNbNb", null)).takeIf { it >= 0 }?.let { spNb.setSelection(it) }
        val listener = { f: () -> Unit -> object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, pos: Int, id: Long) = f()
            override fun onNothingSelected(parent: AdapterView<*>?) {} } }
        spNb.onItemSelectedListener = listener { fillSecs() }
        spSec.onItemSelectedListener = listener { secNew.visibility = if (spSec.selectedItemPosition >= secNames.size) View.VISIBLE else View.GONE; fillPages() }
        fillSecs()
        AlertDialog.Builder(a).setTitle("Ins Notizbuch übernehmen").setView(android.widget.ScrollView(a).apply { addView(box) })
            .setPositiveButton("Übernehmen") { _, _ ->
                val newNb = spNb.selectedItemPosition >= nbNames.size
                val nb = if (newNb) nbNew.text.toString().trim().ifBlank { "Notizbuch" } else nbNames[spNb.selectedItemPosition]
                val newSec = newNb || spSec.selectedItemPosition >= secNames.size
                val sec = if (newSec) secNew.text.toString().trim().ifBlank { "Allgemein" } else secNames[spSec.selectedItemPosition]
                val page = if (newSec || spPg.selectedItemPosition == 0) null else pages.getOrNull(spPg.selectedItemPosition - 1)?.first
                p.edit().putString("toNbNb", nb).putString("toNbSec", sec).putString("toNbPage", page).apply()
                cb(nb, sec, page, newNb)
            }.setNegativeButton("Abbrechen", null).show()
    }

    // ---------------------------------------------------------------- Notizseite als PDF (Text und Striche bleiben scharf)
    /** fmt: "a4p", "a4l" oder "one" (ein langes Blatt) */
    suspend fun boardPdf(ctx: Context, path: String, fmt: String, bg: String, title: String, out: File) {
        val strokes = Store.doc(path).strokes.values.sortedBy { if (it.optString("t") == "img") -1 else Ink.rank(it) }
        for (s in strokes) if (s.optString("t") == "img") try { Images.bytes(s.optString("src")); Images.get(s.optString("src")) } catch (e: Exception) { }
        boardPdfDraw(strokes, fmt, bg, title, out)
    }
    private fun boardPdfDraw(strokes: List<JSONObject>, fmt: String, bg: String, title: String, out: File) {
        val pdf = PdfDocument()
        val M = 36.0
        val b = box(strokes)
        if (b == null) { pdf.finishPage(pdf.startPage(PdfDocument.PageInfo.Builder(595, 842, 1).create())); out.outputStream().use { pdf.writeTo(it) }; pdf.close(); return }
        val boxes = strokes.map { wbox(it) }
        val wc = max(1.0, b[2] - b[0]); val hc = max(1.0, b[3] - b[1])
        val pw: Double; val ph: Double; val f: Double
        if (fmt == "one") { f = min(0.75, min((14000 - 2 * M) / wc, (14000 - 2 * M) / hc)); pw = wc * f + 2 * M; ph = hc * f + 2 * M }
        else { pw = if (fmt == "a4l") 842.0 else 595.0; ph = if (fmt == "a4l") 595.0 else 842.0; f = min(0.75, (pw - 2 * M) / wc) }
        // Umbrüche bevorzugt in Lücken, nicht mitten durch eine Folie
        val slices = ArrayList<Pair<Double, Double>>()
        if (fmt == "one") slices.add(b[1] to b[3]) else {
            val sliceH = (ph - 2 * M - 14) / f
            var y = b[1]
            while (b[3] - y > 1e-6) {
                var end = y + sliceH
                if (end < b[3]) {
                    var yy = end; val step = sliceH / 240
                    while (yy > y + sliceH * 0.55) { if (boxes.none { it[1] < yy && it[3] > yy && it[3] - it[1] < sliceH * 0.95 }) { end = yy; break }; yy -= step }
                } else end = b[3]
                slices.add(y to end); y = end
            }
        }
        val ox = b[0] - (pw - wc * f) / 2 / f
        val linePaint = Paint().apply { strokeWidth = 0.4f; color = if (bg == "lines") Color.argb(64, 31, 79, 214) else Color.argb(64, 30, 47, 110) }
        val foot = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 7.5f; color = Color.rgb(140, 145, 158) }
        slices.forEachIndexed { i, (s0, s1) ->
            val page = pdf.startPage(PdfDocument.PageInfo.Builder(pw.roundToInt(), ph.roundToInt(), i + 1).create())
            val c = page.canvas
            val oy = s0 - M / f
            if (bg == "lines" || bg == "grid") {
                var wy = ceil(s0 / 24) * 24
                while (wy <= s1) { val y = ((wy - oy) * f).toFloat(); c.drawLine(M.toFloat(), y, (pw - M).toFloat(), y, linePaint); wy += 24 }
                if (bg == "grid") { var wx = ceil((ox + M / f) / 24) * 24; while ((wx - ox) * f <= pw - M) { val x = ((wx - ox) * f).toFloat(); c.drawLine(x, M.toFloat(), x, (M + (s1 - s0) * f).toFloat(), linePaint); wx += 24 } }
            }
            if (fmt != "one") c.drawText("$title · ${i + 1}/${slices.size}", M.toFloat(), (ph - M / 2 + 3).toFloat(), foot)
            c.save()
            c.clipRect(0f, (M - 1).toFloat(), pw.toFloat(), (M + (s1 - s0) * f + 1).toFloat())
            strokes.forEachIndexed { j, s ->
                val w = boxes[j]; if (w[3] <= s0 || w[1] >= s1) return@forEachIndexed
                val o = s.optJSONArray("o"); val sx = o?.optDouble(0) ?: 0.0; val sy = o?.optDouble(1) ?: 0.0; val z = s.optDouble("z", 1.0)
                c.save(); c.translate(((sx - ox) * f).toFloat(), ((sy - oy) * f).toFloat()); val k = (f / z).toFloat(); c.scale(k, k); Ink.draw(c, s); c.restore()
            }
            c.restore()
            pdf.finishPage(page)
        }
        out.outputStream().use { pdf.writeTo(it) }
        pdf.close()
    }

    /** Fertige PDF an den Android-Druckdienst geben */
    fun print(a: Activity, file: File, name: String) {
        val pm = a.getSystemService(Context.PRINT_SERVICE) as PrintManager
        pm.print(name, object : PrintDocumentAdapter() {
            override fun onLayout(old: PrintAttributes?, new: PrintAttributes?, cs: CancellationSignal?, cb: LayoutResultCallback, extras: Bundle?) {
                if (cs?.isCanceled == true) { cb.onLayoutCancelled(); return }
                cb.onLayoutFinished(PrintDocumentInfo.Builder("$name.pdf").setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).build(), true)
            }
            override fun onWrite(pages: Array<out PageRange>?, dest: ParcelFileDescriptor, cs: CancellationSignal?, cb: WriteResultCallback) {
                try { file.inputStream().use { i -> ParcelFileDescriptor.AutoCloseOutputStream(dest).use { o -> i.copyTo(o) } }; cb.onWriteFinished(arrayOf(PageRange.ALL_PAGES)) }
                catch (e: Exception) { cb.onWriteFailed(e.message) }
            }
        }, null)
    }

    // ---------------------------------------------------------------- Suche: Text übernommener Folien (aus dem Suchindex des Servers)
    private val slideText = HashMap<String, String>()
    suspend fun slideTexts(strokes: List<JSONObject>) {
        val need = strokes.filter { it.optString("t") == "img" && it.optJSONObject("ln")?.optString("path")?.startsWith("@nb/") == false }
            .map { it.getJSONObject("ln") }.filter { !slideText.containsKey(it.optString("path") + "|" + it.optInt("pg")) }
        if (need.isEmpty()) return
        try {
            val r = Api.post("pgtext", JSONObject().put("refs", JSONArray(need.map { JSONArray(listOf(it.optString("path"), it.optInt("pg"))) })))
            val t = r.optJSONArray("texts") ?: return
            need.forEachIndexed { i, ln -> slideText[ln.optString("path") + "|" + ln.optInt("pg")] = t.optString(i).lowercase() }
        } catch (e: Exception) { }
    }
    fun search(strokes: List<JSONObject>, q: String): List<JSONObject> {
        val words = q.lowercase().trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (words.isEmpty()) return emptyList()
        fun textOf(s: JSONObject): String = when (s.optString("t")) {
            "txt" -> s.optString("text").lowercase()
            "img" -> s.optJSONObject("ln")?.let { slideText[it.optString("path") + "|" + it.optInt("pg")] } ?: ""
            else -> ""
        }.replace(Regex("\\s+"), " ")
        val phrase = words.joinToString(" ")
        val hit = strokes.filter { textOf(it).contains(phrase) }.ifEmpty { strokes.filter { s -> val t = textOf(s); t.isNotEmpty() && words.all { t.contains(it) } } }
        return hit.sortedWith(compareBy({ (wbox(it)[1] / 20).roundToInt() }, { wbox(it)[0] }))
    }

    // ---------------------------------------------------------------- Verknüpfung öffnen (PDF-Seite oder Notizseite)
    fun openLink(a: Activity, path: String, pg: Int, focus: String? = null) {
        if (path.startsWith("@nb/")) {
            a.startActivity(android.content.Intent(a, BoardActivity::class.java).putExtra("path", path).putExtra("title", pageTitle(a, path)).putExtra("focus", focus))
            return
        }
        val f = Store.cachedLibrary()?.let { l -> Store.files(l).find { it.path == path } }
        if (f == null) { Ui.toast(a, "Diese PDF gibt es nicht mehr (verschoben oder gelöscht?)."); return }
        Store.scope.launch {
            if (!Tools.ensureLocal(a, f)) return@launch
            a.startActivity(android.content.Intent(a, ViewerActivity::class.java).putExtra("path", path).putExtra("page", pg))
        }
    }

    // ---------------------------------------------------------------- Notizseiten ohne Internet anlegen
    fun cleanName(s: String): String {
        var t = s.replace(Regex("[/\\\\\\u0000-\\u001F:*?\"<>|]+"), " ").replace(Regex("\\s+"), " ").trim().trimStart('.', '@', ' ')
        if (t.length > 70) t = t.substring(0, 70).trim()
        return t.ifBlank { "Seite" }
    }
    fun addPendingPage(ctx: Context, nb: String, sec: String, title: String, bg: String): String {
        val file = cleanName(title) + " " + Store.uid().take(4)
        val path = "@nb/$nb/$sec/$file"
        val list = try { JSONArray(Store.prefs().getString("pendPages", "[]")) } catch (e: Exception) { JSONArray() }
        list.put(JSONObject().put("path", path).put("nb", nb).put("sec", sec).put("title", title).put("bg", bg).put("file", file))
        Store.prefs().edit().putString("pendPages", list.toString()).apply()
        Store.scheduleFlush(5000)
        // gleich in der Liste zeigen
        try {
            val bs = cachedBooks(ctx)
            for (i in 0 until bs.length()) { val b = bs.getJSONObject(i); if (b.getString("name") != nb) continue
                val ss = b.optJSONArray("sections") ?: continue
                for (k in 0 until ss.length()) { val sc = ss.getJSONObject(k); if (sc.getString("name") != sec) continue
                    (sc.optJSONArray("pages") ?: JSONArray().also { sc.put("pages", it) }).put(JSONObject().put("path", path).put("title", title).put("mtime", System.currentTimeMillis() / 1000)) } }
            File(ctx.filesDir, "boards.json").writeText(bs.toString())
        } catch (e: Exception) { }
        return path
    }
    /** offline angelegte Seiten beim Server anlegen (vor dem Hochladen ihrer Notizen) */
    suspend fun createPending() {
        val list = try { JSONArray(Store.prefs().getString("pendPages", "[]")) } catch (e: Exception) { JSONArray() }
        if (list.length() == 0) return
        val rest = JSONArray()
        for (i in 0 until list.length()) {
            val p = list.getJSONObject(i)
            try {
                Api.post("nbnew", JSONObject().put("kind", "page").put("nb", p.getString("nb")).put("sec", p.getString("sec")).put("title", p.getString("title")).put("bg", p.optString("bg", "dots")).put("file", p.getString("file")))
            } catch (e: Api.ApiError) { /* vom Server abgelehnt: nicht endlos wiederholen */ }
            catch (e: Exception) { rest.put(p) }
        }
        Store.prefs().edit().putString("pendPages", rest.toString()).apply()
        if (rest.length() > 0) throw java.io.IOException("offline")
    }
}
