package io.github.pdfstift

import android.graphics.Color
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Notizbuch-Seite (unendliche Tafel) */
class BoardActivity : AppCompatActivity() {
    private lateinit var view: BoardView
    private lateinit var bar: ToolBar
    private lateinit var statusV: TextView
    private lateinit var undoV: View
    private lateinit var redoV: View
    private lateinit var selBar: LinearLayout
    private val dp = { v: Float -> Ui.dp(this, v) }
    private var photoUri: android.net.Uri? = null
    private val takePhoto = registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.TakePicture()) { ok ->
        val u = photoUri ?: return@registerForActivityResult
        if (ok) loadBitmap(u)?.let { b -> Tools.addImage(this, b) { src, w, h -> view.addImage(src, w, h) } }
    }
    private val pickImage = registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.GetContent()) { u ->
        if (u != null) loadBitmap(u)?.let { b -> Tools.addImage(this, b) { src, w, h -> view.addImage(src, w, h) } }
    }
    private fun loadBitmap(u: android.net.Uri): android.graphics.Bitmap? = try {
        val o = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
        contentResolver.openInputStream(u)?.use { android.graphics.BitmapFactory.decodeStream(it, null, o) }
        var sample = 1; while (maxOf(o.outWidth, o.outHeight) / sample > 3000) sample *= 2
        val b = contentResolver.openInputStream(u)?.use { android.graphics.BitmapFactory.decodeStream(it, null, android.graphics.BitmapFactory.Options().apply { inSampleSize = sample }) }
        val rot = try { contentResolver.openInputStream(u)?.use { androidx.exifinterface.media.ExifInterface(it).rotationDegrees } ?: 0 } catch (e: Exception) { 0 }
        if (b != null && rot != 0) android.graphics.Bitmap.createBitmap(b, 0, 0, b.width, b.height, android.graphics.Matrix().apply { postRotate(rot.toFloat()) }, true) else b
    } catch (e: Exception) { Ui.toast(this, "Bild konnte nicht gelesen werden."); null }
    private fun photo() = Tools.photoChoice(this, {
        val f = java.io.File(cacheDir, "photos").apply { mkdirs() }.let { java.io.File(it, "foto.jpg") }
        photoUri = androidx.core.content.FileProvider.getUriForFile(this, "io.github.pdfstift.files", f)
        try { takePhoto.launch(photoUri!!) } catch (e: Exception) { Ui.toast(this, "Keine Kamera-App gefunden.") }
    }, { pickImage.launch("image/*") })

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val path = intent.getStringExtra("path") ?: run { finish(); return }
        view = BoardView(this)
        bar = ToolBar(this, view, true)
        val back = Ui.text(this, "‹", 30f, Ui.NAVY, true).apply { setPadding(dp(12f), 0, dp(8f), dp(4f)); setOnClickListener { finish() } }
        val title = Ui.text(this, intent.getStringExtra("title") ?: path.substringAfterLast('/'), 17f, Ui.INK, true).apply { maxLines = 1 }
        statusV = Ui.text(this, "", 13f, Ui.MUTED).apply { setPadding(dp(10f), 0, dp(10f), 0) }
        val bgBtn = Ui.text(this, "Hintergrund", 15f, Ui.INK, true).apply { setPadding(dp(12f), dp(6f), dp(12f), dp(6f)); setOnClickListener { chooseBg() } }
        val fitBtn = Ui.text(this, "Alles zeigen", 15f, Ui.INK, true).apply { setPadding(dp(12f), dp(6f), dp(12f), dp(6f)); setOnClickListener { view.fit() } }
        undoV = bar.iconBtn("↶") { view.undo() }
        redoV = bar.iconBtn("↷") { view.redo() }
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.WHITE); setPadding(dp(4f), dp(4f), dp(8f), dp(2f))
            addView(back); addView(title, Ui.lp(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)); addView(statusV); addView(fitBtn); addView(bgBtn); addView(bar.iconBtn("cam") { photo() }); addView(undoV); addView(redoV)
            addView(Ui.text(this@BoardActivity, "⋯", 24f, Ui.NAVY, true).apply {
                setPadding(dp(8f), 0, dp(8f), 0)
                setOnClickListener { v ->
                    val m = android.widget.PopupMenu(this@BoardActivity, v)
                    val items = ArrayList<Pair<String, () -> Unit>>()
                    items.add("PDF-Seiten einfügen …" to { insertPdf() })
                    items.add("Vorlage einfügen (Cornell, Besprechung, Vorlesung) …" to { insertTemplate() })
                    items.add("Textbaustein …" to { snippet() })
                    items.add("Folienmarke setzen" to { marker("f") })
                    items.add("Videomarke setzen" to { marker("v") })
                    if (markers().isNotEmpty()) items.add("Folienmarken anspringen …" to { markerList() })
                    items.add("Suchen …" to { search() })
                    items.add("Verknüpfung einfügen …" to { insertLink() })
                    items.add("Wer verweist hierher?" to { Tools.backlinks(this@BoardActivity, view.path) { p2, pg -> Notebook.openLink(this@BoardActivity, p2, pg) } })
                    items.add("Frühere Stände …" to { history() })
                    items.add("Als PDF speichern …" to { pdf(false) })
                    items.add("Drucken …" to { pdf(true) })
                    items.add("Fehler melden …" to { Report.show(this@BoardActivity, "Notizbuch ${view.path}") })
                    items.forEachIndexed { k, it -> m.menu.add(0, k, k, it.first) }
                    m.setOnMenuItemClickListener { items[it.itemId].second(); true }
                    m.show()
                }
            })
        }
        selBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; visibility = View.GONE
            background = Ui.rounded(Color.WHITE, dp(14f).toFloat(), Ui.LINE, dp(1f)); elevation = dp(6f).toFloat()
            setPadding(dp(10f), dp(6f), dp(10f), dp(6f))
        }
        searchBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; visibility = View.GONE
            background = Ui.rounded(Color.WHITE, dp(14f).toFloat(), Ui.LINE, dp(1f)); elevation = dp(6f).toFloat()
            setPadding(dp(10f), dp(4f), dp(6f), dp(4f))
        }
        val overlay = InkOverlay(this)
        view.overlay = overlay
        val frame = FrameLayout(this).apply {
            addView(view)
            addView(overlay)
            addView(selBar, FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { setMargins(0, 0, 0, dp(18f)) })
            addView(searchBar, FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply { setMargins(0, dp(10f), 0, 0) })
        }
        val dock = DockHost(this)
        dock.center.addView(frame)
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(top); addView(View(this@BoardActivity).apply { setBackgroundColor(Ui.LINE) }, Ui.lp(-1, dp(1f)))
            addView(dock.root, Ui.lp(-1, 0, 1f))
        })
        bar.attach(dock)
        view.onInkChanged = { undoV.alpha = if (view.canUndo) 1f else 0.3f; redoV.alpha = if (view.canRedo) 1f else 0.3f }
        view.onSelChanged = { n -> showSelBar(n) }
        view.onTextRequest = { wx, wy, ex -> textDialog(wx, wy, ex) }
        Images.onLoaded = { view.invalidate() }
        view.linkName = { ln -> Notebook.linkName(this, ln) }
        view.onLink = { ln -> Notebook.openLink(this, ln.optString("path"), ln.optInt("pg")) }
        view.onPlaced = { s -> if (s.has("mk")) Ui.toast(this, s.optString("text") + " gesetzt.") }
        view.bg = Store.prefs().getString("bg:$path", "dots") ?: "dots"
        view.open(path)
        view.onInkChanged()
        lifecycleScope.launch {
            try { val m = Api.get("nbmeta", mapOf("path" to path)); view.bg = m.optString("bg", "dots"); Store.prefs().edit().putString("bg:$path", view.bg).apply(); view.invalidate() } catch (e: Exception) { }
            try { Store.pullNotes(path); statusV.text = "Gespeichert" } catch (e: Exception) { statusV.text = "Offline" }
            // aus „Wer verweist hierher?“: gleich zur Stelle
            intent.getStringExtra("focus")?.let { id -> view.doc?.strokes?.get(id)?.let { view.post { view.focusBox(view.worldBoxOf(it)) } } }
        }
    }

    override fun onResume() {
        super.onResume()
        Store.syncState = { st -> runOnUiThread { statusV.text = when (st) { "saving" -> "Speichert …"; "offline" -> "Offline – wird nachgeholt"; else -> "Gespeichert" } } }
    }

    private fun chooseBg() {
        val opts = listOf("dots" to "Punkte", "grid" to "Karos", "lines" to "Linien", "plain" to "Leer")
        AlertDialog.Builder(this).setTitle("Hintergrund").setItems(opts.map { it.second }.toTypedArray()) { _, i ->
            view.bg = opts[i].first; view.invalidate()
            Store.prefs().edit().putString("bg:${view.path}", view.bg).apply()
            lifecycleScope.launch { try { Api.post("nbset", JSONObject().put("path", view.path).put("bg", view.bg)) } catch (e: Exception) { } }
        }.show()
    }

    private fun showSelBar(n: Int) {
        selBar.removeAllViews()
        if (n == 0) { selBar.visibility = View.GONE; return }
        selBar.addView(Ui.text(this, "$n ausgewählt", 14f, Ui.MUTED).apply { setPadding(dp(6f), 0, dp(10f), 0) })
        selBar.addView(bar.chip("Löschen", false) { view.deleteSelection() })
        if (view.selectedText() != null) selBar.addView(bar.chip("Bearbeiten", false) { view.editSelectedText() })
        for (c in bar.PALETTE.take(5)) selBar.addView(bar.swatch(c, false) { view.recolorSelection(c) })
        selBar.addView(bar.chip("✕", false) { view.clearSel() })
        selBar.visibility = View.VISIBLE
    }

    // ================================================================== Notizbuch-Werkzeuge
    private lateinit var searchBar: LinearLayout
    private fun markers() = view.allStrokes().filter { it.optString("t") == "txt" && it.has("mk") }
        .sortedWith(compareBy({ (Notebook.wbox(it)[1] / 20).toInt() }, { Notebook.wbox(it)[0] }))

    private fun insertTemplate() = Notebook.templateDialog(this, false) { kind, _ ->
        val b = view.contentBox()
        val x = b?.get(0) ?: 0.0; val y = if (b != null) b[3] + 60 else 0.0
        view.addAll(Notebook.template(kind, x, y, ""))
        view.post { view.showTop(x, y, 860.0) }
    }

    private fun snippet() {
        lifecycleScope.launch {
            val list = Notebook.snippets()
            AlertDialog.Builder(this@BoardActivity).setTitle("Textbaustein – danach auf die Stelle tippen")
                .setItems(list.map { it.first }.toTypedArray()) { _, i ->
                    val (t, c, b) = list[i]
                    view.placeNext = Notebook.txt(t, view.defaultTextSize, c, b, 0.0, 0.0)
                    Ui.toast(this@BoardActivity, "„$t“: auf die gewünschte Stelle tippen.")
                }.setNegativeButton("Abbrechen", null).show()
        }
    }

    private fun marker(kind: String) {
        val word = if (kind == "v") "Video" else "Folie"
        val n = (markers().filter { (it.optString("mk") == "v") == (kind == "v") }.maxOfOrNull { it.optString("text").filter { ch -> ch.isDigit() }.toIntOrNull() ?: 0 } ?: 0) + 1
        view.placeNext = Notebook.txt("$word $n", 16f, "#5F3DC4", true, 0.0, 0.0).put("bg", "#EDE7FF").put("bo", "#7048E8").put("mk", kind)
        Ui.toast(this, "Auf die Stelle tippen, an der „$word $n“ stehen soll.")
    }
    private fun markerList() {
        val ms = markers()
        AlertDialog.Builder(this).setTitle("Folienmarken").setItems(ms.map { it.optString("text") }.toTypedArray()) { _, i -> view.focusBox(Notebook.wbox(ms[i])) }
            .setNegativeButton("Schließen", null).show()
    }

    private fun search() {
        Tools.ask(this, "Auf dieser Notizseite suchen", "Wort oder Satz (getippter Text und übernommene Folien)", "", "Suchen") { q ->
            lifecycleScope.launch {
                Notebook.slideTexts(view.allStrokes())
                val hits = Notebook.search(view.allStrokes(), q)
                view.hits = hits; view.hitIdx = if (hits.isEmpty()) -1 else 0
                showHits(q)
                if (hits.isEmpty()) Ui.toast(this@BoardActivity, "Keine Treffer.") else view.focusBox(Notebook.wbox(hits[0]))
                view.invalidate()
            }
        }
    }
    private fun showHits(q: String) {
        searchBar.removeAllViews()
        if (view.hits.isEmpty()) { searchBar.visibility = View.GONE; return }
        val info = Ui.text(this, "„$q“: ${view.hitIdx + 1} von ${view.hits.size}", 14f, Ui.INK).apply { setPadding(dp(6f), 0, dp(8f), 0) }
        fun go(d: Int) { view.hitIdx = (view.hitIdx + d + view.hits.size) % view.hits.size; info.text = "„$q“: ${view.hitIdx + 1} von ${view.hits.size}"; view.focusBox(Notebook.wbox(view.hits[view.hitIdx])) }
        searchBar.addView(info)
        searchBar.addView(bar.chip("‹", false) { go(-1) }); searchBar.addView(bar.chip("›", false) { go(1) })
        searchBar.addView(bar.chip("✕", false) { view.hits = emptyList(); view.hitIdx = -1; searchBar.visibility = View.GONE; view.invalidate() })
        searchBar.visibility = View.VISIBLE
    }

    private fun insertLink() {
        AlertDialog.Builder(this).setTitle("Verknüpfung zu …").setItems(arrayOf("einer Seite einer PDF", "einer anderen Notizseite")) { _, w ->
            if (w == 0) Tools.pickPdf(this, "Verknüpfung zu …") { f ->
                Tools.ask(this, "Seite", "Seitenzahl in „${f.name.removeSuffix(".pdf")}“", "1", "Einfügen", true) { pg ->
                    val n = (pg.toIntOrNull() ?: 1).coerceAtLeast(1)
                    placeLink("→ ${f.name.removeSuffix(".pdf")}, S. $n", f.path, n - 1)
                }
            } else {
                val bs = Notebook.cachedBooks(this); val pages = ArrayList<Pair<String, String>>()
                for (i in 0 until bs.length()) { val b = bs.getJSONObject(i); val ss = b.optJSONArray("sections") ?: continue
                    for (k in 0 until ss.length()) { val sc = ss.getJSONObject(k); val ps = sc.optJSONArray("pages") ?: continue
                        for (m in 0 until ps.length()) { val pg = ps.getJSONObject(m); if (pg.optString("path") != view.path) pages.add(pg.optString("path") to "${b.optString("name")} › ${sc.optString("name")} › ${pg.optString("title")}") } } }
                AlertDialog.Builder(this).setTitle("Notizseite").setItems(pages.map { it.second }.toTypedArray()) { _, i ->
                    placeLink("→ " + Notebook.pageTitle(this, pages[i].first), pages[i].first, 0)
                }.setNegativeButton("Abbrechen", null).show()
            }
        }.setNegativeButton("Abbrechen", null).show()
    }
    private fun placeLink(label: String, target: String, pg: Int) {
        view.placeNext = Notebook.txt(label, view.defaultTextSize, "#1E4FB8", false, 0.0, 0.0).put("ln", JSONObject().put("path", target).put("pg", pg))
        Ui.toast(this, "Auf die Stelle tippen, an der die Verknüpfung stehen soll.")
    }

    private fun insertPdf() {
        Tools.pickPdf(this, "PDF-Seiten einfügen") { f ->
            Tools.ask(this, "Seiten", "z. B. 1 oder 3-5, 8", "1", "Einfügen") { range ->
                lifecycleScope.launch {
                    if (!Tools.ensureLocal(this@BoardActivity, f)) return@launch
                    val n = try { PdfSource(this@BoardActivity, Store.pdfFile(f.path)).let { s -> val c = s.pageCount; s.close(); c } } catch (e: Exception) { 0 }
                    val pages = Notebook.parsePages(range, n)
                    if (pages.isNullOrEmpty()) { Ui.toast(this@BoardActivity, "Bitte Seiten zwischen 1 und $n angeben."); return@launch }
                    if (pages.size > 60) { Ui.toast(this@BoardActivity, "Höchstens 60 Seiten auf einmal."); return@launch }
                    val pr = Ui.Progress(this@BoardActivity, "Seiten werden eingefügt …")
                    try {
                        try { Store.pullNotes(f.path) } catch (e: Exception) { }
                        val items = ArrayList<Notebook.Img>()
                        for ((k, i) in pages.withIndex()) {
                            pr.label.text = "Seite ${k + 1} von ${pages.size}"
                            val (src, w, h) = Notebook.upload(Notebook.pageJpeg(this@BoardActivity, f.path, i, true))
                            items.add(Notebook.Img(src, w, h, f.path, i))
                        }
                        val added = Notebook.imageStrokes(view.allStrokes(), items)
                        view.addAll(added)
                        val b = Notebook.wbox(added[0]); view.post { view.showTop(b[0], b[1], 860.0) }
                    } catch (e: Exception) { Ui.alert(this@BoardActivity, "Nicht eingefügt", "Das geht nur mit Internetverbindung.") }
                    finally { pr.close() }
                }
            }
        }
    }

    // Frühere Stände (der Server hebt etwa alle 10 Minuten einen Stand auf)
    private fun history() {
        lifecycleScope.launch {
            try { Store.flush() } catch (e: Exception) { }
            val list = try { Api.get("nbhist", mapOf("path" to view.path)).optJSONArray("list") ?: org.json.JSONArray() } catch (e: Exception) { Ui.toast(this@BoardActivity, "Geht nur mit Internetverbindung."); return@launch }
            if (list.length() == 0) { Ui.alert(this@BoardActivity, "Frühere Stände", "Noch keine – sie entstehen, sobald auf dieser Seite geschrieben wird."); return@launch }
            val fmt = java.text.SimpleDateFormat("EE dd.MM., HH:mm", java.util.Locale.GERMANY)
            val rows = (0 until list.length()).map { list.getJSONObject(it) }
            AlertDialog.Builder(this@BoardActivity).setTitle("Frühere Stände")
                .setItems(rows.map { "${fmt.format(java.util.Date(it.optLong("t") * 1000))} · ${it.optInt("n")} Notizen" }.toTypedArray()) { _, i ->
                    val t = rows[i].optLong("t")
                    Ui.alert(this@BoardActivity, "Diesen Stand wiederherstellen?", "Die Notizseite sieht danach wieder aus wie am ${fmt.format(java.util.Date(t * 1000))}. Der jetzige Stand bleibt als früherer Stand erhalten.", "Wiederherstellen", "Abbrechen") {
                        lifecycleScope.launch {
                            try {
                                val doc = Api.post("nbhist", JSONObject().put("path", view.path).put("t", t))
                                Store.applyServerPublic(Store.doc(view.path), doc)
                                view.clearSel(); view.invalidate()
                                Ui.toast(this@BoardActivity, "Früherer Stand wiederhergestellt.")
                            } catch (e: Exception) { Ui.toast(this@BoardActivity, "Geht nur mit Internetverbindung.") }
                        }
                    }
                }.setNegativeButton("Schließen", null).show()
        }
    }

    private fun pdf(printIt: Boolean) {
        val opts = arrayOf("A4 hoch – auf mehrere Blätter verteilt", "A4 quer – auf mehrere Blätter verteilt", "Ein langes Blatt (ganze Notizseite)")
        val fmts = arrayOf("a4p", "a4l", "one")
        val n = if (printIt) 2 else 3
        AlertDialog.Builder(this).setTitle(if (printIt) "Notizseite drucken" else "Notizseite als PDF").setItems(opts.take(n).toTypedArray()) { _, i ->
            lifecycleScope.launch {
                val title = intent.getStringExtra("title") ?: view.path.substringAfterLast('/')
                val name = title.replace(Regex("[\\\\/:*?\"<>|]+"), " ").trim().ifBlank { "Notizseite" }
                val out = java.io.File(java.io.File(cacheDir, "export").apply { mkdirs() }, "$name.pdf")
                val pr = Ui.Progress(this@BoardActivity, "PDF wird erstellt …")
                try { Notebook.boardPdf(this@BoardActivity, view.path, fmts[i], if (view.bg == "lines" || view.bg == "grid") view.bg else "plain", title, out) }
                catch (e: Exception) { pr.close(); Ui.alert(this@BoardActivity, "Nicht erstellt", e.message ?: ""); return@launch }
                pr.close()
                if (printIt) Notebook.print(this@BoardActivity, out, name) else Acro.shareFile(this@BoardActivity, out, "application/pdf", "Notizseite als PDF")
            }
        }.setNegativeButton("Abbrechen", null).show()
    }

    private fun textDialog(wx: Double, wy: Double, ex: JSONObject?) {
        TextEditor.show(this, ex, view.defaultTextSize, view.ttColor) { st -> view.commitText(wx, wy, st, ex) }
    }

    override fun onPause() { super.onPause(); view.saveCam(); Store.scheduleFlush(0) }
    override fun onDestroy() { super.onDestroy(); view.overlay?.release(); view.close() }
}
