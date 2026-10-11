package io.github.pdfstift

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/** Eine PDF lesen und beschriften – Bedienung wie in der Web-App */
class ViewerActivity : AppCompatActivity(), ToolHost {
    // ---- für die Werkzeuge
    override val act: AppCompatActivity get() = this
    override val doc: DocView get() = view
    override val docPath: String get() = path
    override val folder: String get() = path.substringBeforeLast('/', "")
    override fun reload() = reloadDoc()
    override fun showThumbs() { if (thumbWrap.visibility != View.VISIBLE) toggleThumbs() }
    override fun openPath(path: String) { if (Store.hasLocal(path)) switchTo(path) }
    private var filesCb: ((List<android.net.Uri>) -> Unit)? = null
    private val filesPick = registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.OpenMultipleDocuments()) { l -> filesCb?.invoke(l); filesCb = null }
    override fun pickFiles(types: Array<String>, cb: (List<android.net.Uri>) -> Unit) { filesCb = cb; try { filesPick.launch(types) } catch (e: Exception) { Ui.toast(this, "Keine Dateiauswahl verfügbar.") } }
    private var imgCb: ((Bitmap) -> Unit)? = null
    private val imgPick = registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.GetContent()) { u -> val cb = imgCb; imgCb = null; if (u != null && cb != null) loadBitmap(u)?.let(cb) }
    override fun pickImage(cb: (Bitmap) -> Unit) { imgCb = cb; imgPick.launch("image/*") }
    private lateinit var modeBar: LinearLayout
    private lateinit var modeV: TextView
    override fun showMode(text: String, buttons: List<Pair<String, () -> Unit>>) {
        view.clearSel()
        modeBar.removeAllViews()
        modeV = Ui.text(this, text, 14f, Ui.INK).apply { setPadding(dp(6f), 0, dp(10f), 0); maxWidth = dp(420f) }
        modeBar.addView(modeV)
        for ((l, f) in buttons) modeBar.addView(bar.chip(l, false) { f() })
        modeBar.visibility = View.VISIBLE
    }
    override fun modeText(t: String) { if (::modeV.isInitialized) modeV.text = t }
    override fun endMode() { view.pick = null; view.onPickTap = { _, _, _ -> }; view.onPickRect = { _, _ -> }; view.onPickSel = { _, _ -> }; modeBar.visibility = View.GONE }

    private lateinit var view: DocView
    private lateinit var path: String
    private lateinit var tabRow: LinearLayout
    private lateinit var starV: TextView
    private var photoUri: android.net.Uri? = null
    private val takePhoto = registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.TakePicture()) { ok ->
        val u = photoUri ?: return@registerForActivityResult
        if (ok) loadBitmap(u)?.let { Tools.addImage(this, view, it) }
    }
    private val pickImage = registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.GetContent()) { u ->
        if (u != null) loadBitmap(u)?.let { Tools.addImage(this, view, it, false, 0.6f) }
    }
    private lateinit var searchBar: LinearLayout
    private lateinit var searchIn: EditText
    private lateinit var searchInfo: TextView
    private var searchGen = 0
    private lateinit var pageV: TextView
    private lateinit var statusV: TextView
    private lateinit var ocrLed: OcrLed
    private lateinit var undoV: View
    private lateinit var redoV: View
    private lateinit var bar: ToolBar
    private lateinit var selBar: LinearLayout
    private lateinit var thumbs: RecyclerView
    private lateinit var thumbWrap: LinearLayout
    private val tSlotTop by lazy { FrameLayout(this) }
    private val tSlotBottom by lazy { FrameLayout(this) }
    private val tSlotLeft by lazy { FrameLayout(this) }
    private val tSlotRight by lazy { FrameLayout(this) }
    private var thumbPos = "right"
    private val thumbsHoriz get() = thumbPos == "top" || thumbPos == "bottom"
    private val thumbAdapter = ThumbAdapter()

    private val dp = { v: Float -> Ui.dp(this, v) }
    private lateinit var topBar: LinearLayout
    private lateinit var topLine: View
    private lateinit var frame: FrameLayout
    private lateinit var liveV: TextView
    private lateinit var liveP: TextView
    private lateinit var recV: TextView
    private val recTick = object : Runnable { override fun run() { updRec(); if (Rec.active) recV.postDelayed(this, 1000) } }
    private val micPerm = registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) startRec() else Ui.alert(this, "Kein Mikrofon", "Für die Tonaufnahme braucht die App das Mikrofon. Du kannst es in den Android-Einstellungen bei den App-Berechtigungen von PDF-Stift erlauben.")
    }
    private lateinit var presBar: LinearLayout
    private lateinit var laserBtn: TextView
    private var presenting = false
    private var thumbsWere = false
    private val hidePres = Runnable { if (presenting) presBar.animate().alpha(0f).setDuration(400).withEndAction { if (presenting) presBar.visibility = View.GONE }.start() }

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        path = intent.getStringExtra("path") ?: run { finish(); return }
        val p = Store.prefs()

        view = DocView(this)
        bar = ToolBar(this, view, false)

        // ---- Kopfzeile
        val back = Ui.text(this, "‹", 30f, Ui.NAVY, true).apply { setPadding(dp(12f), 0, dp(8f), dp(4f)); setOnClickListener { finish() } }
        tabRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val tabScroll = android.widget.HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(tabRow) }
        val searchBtn = pill("Suchen") { toggleSearch() }
        val toolsBtn = pill("Werkzeuge") { Acro.menu(this) }
        starV = Ui.text(this, "☆", 24f, Ui.NAVY, true).apply { setPadding(dp(10f), 0, dp(6f), 0); setOnClickListener { toggleMark() }; contentDescription = "Seite merken" }
        val moreV = Ui.text(this, "⋯", 24f, Ui.NAVY, true).apply { setPadding(dp(8f), 0, dp(8f), 0) }
        moreV.setOnClickListener { moreMenu(moreV) }
        statusV = Ui.text(this, "", 13f, Ui.MUTED).apply { setPadding(dp(10f), 0, dp(10f), 0) }
        ocrLed = OcrLed(this).apply { setOnClickListener { OcrLed.dialog(this@ViewerActivity, this) } }
        Ocr.onChange = { ocrLed.update() }
        val pagesBtn = pill("Seiten") { toggleThumbs() }
        liveV = Ui.text(this, "", 13f, Color.WHITE, true).apply {
            background = Ui.rounded(0xFFD6262B.toInt(), dp(10f).toFloat()); setPadding(dp(10f), dp(4f), dp(10f), dp(4f)); visibility = View.GONE
            setOnClickListener { liveMenu() }
        }
        recV = Ui.text(this, "", 13f, Color.WHITE, true).apply {
            background = Ui.rounded(0xFF1B1F29.toInt(), dp(10f).toFloat()); setPadding(dp(10f), dp(4f), dp(10f), dp(4f)); visibility = View.GONE
            setOnClickListener { toggleRec() }
        }
        undoV = iconBtn("↶") { view.undo() }
        redoV = iconBtn("↷") { view.redo() }
        topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.WHITE); setPadding(dp(4f), dp(4f), dp(8f), dp(2f))
            addView(back); addView(tabScroll, Ui.lp(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)); addView(ocrLed); addView(statusV); addView(recV); addView(liveV); addView(toolsBtn); addView(searchBtn); addView(pagesBtn); addView(starV); addView(iconBtn("cam") { photo() }); addView(undoV); addView(redoV); addView(moreV)
        }
        // Suchleiste (aufklappbar)
        searchIn = EditText(this).apply {
            hint = "In dieser PDF suchen …"; isSingleLine = true; textSize = 16f
            imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH
            background = Ui.rounded(0xFFF4F6FA.toInt(), dp(10f).toFloat()); setPadding(dp(12f), dp(8f), dp(12f), dp(8f))
            setOnEditorActionListener { _, _, _ -> runSearch(text.toString()); true }
        }
        searchInfo = Ui.text(this, "", 14f, Ui.MUTED).apply { setPadding(dp(10f), 0, dp(6f), 0) }
        searchBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; visibility = View.GONE
            setBackgroundColor(Color.WHITE); setPadding(dp(12f), dp(4f), dp(8f), dp(6f))
            addView(searchIn, Ui.lp(0, -2, 1f)); addView(searchInfo)
            addView(pill("‹") { stepHit(-1) }); addView(pill("›") { stepHit(1) }); addView(pill("✕") { toggleSearch() })
        }

        // ---- Seite, Seitenleiste, Lasso-Leiste
        pageV = Ui.text(this, "", 14f, Color.WHITE, true).apply {
            background = Ui.rounded(0xCC1B1F29.toInt(), dp(10f).toFloat()); setPadding(dp(12f), dp(6f), dp(12f), dp(6f))
            setOnClickListener { askPage() }
        }
        selBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; visibility = View.GONE
            background = Ui.rounded(Color.WHITE, dp(14f).toFloat(), Ui.LINE, dp(1f)); elevation = dp(6f).toFloat()
            setPadding(dp(10f), dp(6f), dp(10f), dp(6f))
        }
        thumbs = RecyclerView(this).also { rv -> rv.post { dragHelper.attachToRecyclerView(rv) } }.apply { layoutManager = LinearLayoutManager(this@ViewerActivity); adapter = thumbAdapter; setBackgroundColor(0xFFF4F6FA.toInt()); setPadding(dp(10f), dp(10f), dp(10f), dp(10f)); clipToPadding = false }
        thumbPos = p.getString("thumbPos", "right") ?: "right"
        val posBtn = Ui.text(this, "Position ▾", 13f, Ui.NAVY, true).apply {
            setPadding(dp(10f), dp(6f), dp(10f), dp(6f)); setOnClickListener { chooseThumbPos() }
        }
        val closeBtn = Ui.text(this, "✕", 15f, Ui.MUTED, true).apply { setPadding(dp(10f), dp(6f), dp(10f), dp(6f)); setOnClickListener { toggleThumbs() } }
        val thumbHead = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setBackgroundColor(0xFFF4F6FA.toInt())
            setPadding(dp(8f), dp(2f), dp(4f), 0)
            addView(Ui.text(this@ViewerActivity, "Seiten", 13f, Ui.MUTED, true), Ui.lp(0, -2, 1f)); addView(posBtn); addView(closeBtn)
        }
        // Seiten: ⋯ = Menü, lange drücken und ziehen = verschieben
        thumbWrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setBackgroundColor(0xFFF4F6FA.toInt())
            addView(thumbHead, Ui.lp(-1, -2)); addView(thumbs, Ui.lp(-1, 0, 1f))
            visibility = if (p.getBoolean("thumbs", false)) View.VISIBLE else View.GONE
        }
        val overlay = InkOverlay(this)
        view.overlay = overlay
        frame = FrameLayout(this).apply {
            addView(view)
            addView(overlay)
            addView(pageV, FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.END).apply { setMargins(0, 0, dp(16f), dp(16f)) })
            addView(selBar, FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { setMargins(0, 0, 0, dp(18f)) })
            modeBar = LinearLayout(this@ViewerActivity).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; visibility = View.GONE
                background = Ui.rounded(Color.WHITE, dp(14f).toFloat(), Ui.LINE, dp(1f)); elevation = dp(6f).toFloat()
                setPadding(dp(10f), dp(6f), dp(10f), dp(6f))
            }
            addView(modeBar, FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { setMargins(dp(12f), 0, dp(12f), dp(18f)) })
        }
        // Präsentieren: kleine Leiste oben rechts (verschwindet nach ein paar Sekunden, Tippen in die Mitte holt sie zurück)
        laserBtn = presChip("") { view.laserFinger = !view.laserFinger; Store.prefs().edit().putBoolean("laserFinger", view.laserFinger).apply(); updLaserBtn(); pokePres() }
        presBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; visibility = View.GONE
            background = Ui.rounded(0xE61B1F29.toInt(), dp(14f).toFloat()); elevation = dp(6f).toFloat()
            setPadding(dp(6f), dp(4f), dp(6f), dp(4f))
            addView(presChip("‹") { view.step(-1); pokePres() }); addView(presChip("›") { view.step(1); pokePres() })
            liveP = presChip("") { liveMenu() }.apply { visibility = View.GONE }
            addView(laserBtn); addView(liveP); addView(presChip("✕  Beenden") { setPresent(false) })
        }
        frame.addView(presBar, FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.END).apply { setMargins(0, dp(12f), dp(12f), 0) })
        val dock = DockHost(this)
        dock.center.addView(frame)
        // Seitenleiste: links, rechts, oben oder unten
        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(tSlotTop, Ui.lp(-1, -2))
            addView(LinearLayout(this@ViewerActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(tSlotLeft, Ui.lp(-2, -1))
                addView(dock.root, Ui.lp(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
                addView(tSlotRight, Ui.lp(-2, -1))
            }, Ui.lp(-1, 0, 1f))
            addView(tSlotBottom, Ui.lp(-1, -2))
        }
        placeThumbs()
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            topLine = View(this@ViewerActivity).apply { setBackgroundColor(Ui.LINE) }
            addView(topBar); addView(searchBar); addView(topLine, Ui.lp(-1, dp(1f)))
            addView(body, Ui.lp(-1, 0, 1f))
        })

        bar.attach(dock)
        view.onLink = { p2, pg -> followLink(p2, pg) }
        Meta.onChange = { runOnUiThread { updStar() } }
        view.onPage = { i, n -> Live.soon(); updStar(); pageV.text = "${i + 1} von $n"; thumbAdapter.current(i) }
        view.onInkChanged = { Live.soon(); updUndo(); thumbAdapter.inkChanged() }
        view.onReady = {
            thumbAdapter.notifyDataSetChanged()
            if (openT > 0) { Usage.track("perf", "PDF öffnen", System.currentTimeMillis() - openT, "${view.pageCount} Seiten, ${"%.1f".format(Store.pdfFile(path).length() / 1048576.0)} MB, Tablet"); openT = 0 }
            if (!path.startsWith("@")) Ocr.auto(this)
        }
        view.onHint = { Ui.toast(this, it, true) }
        view.onPresentTap = { pokePres() }
        view.onLaser = { Live.soon(true) }
        Live.source = { if (view.pageCount == 0) null else view.livePage().let { pg -> Live.Snap(path, pg, view.strokesOn(pg), view.laserForLive()) } }
        Live.onChange = { runOnUiThread { updLive() } }
        Rec.onChange = { runOnUiThread { updRec() } }
        updLive(); updRec()
        view.laserFinger = p.getBoolean("laserFinger", false)
        onBackPressedDispatcher.addCallback(this, object : androidx.activity.OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (presenting) setPresent(false) else if (view.pick != null) endMode() else { isEnabled = false; onBackPressedDispatcher.onBackPressed() } }
        })
        view.onSelChanged = { n -> showSelBar(n) }
        view.onTextRequest = { pg, x, y, ex -> textDialog(pg, x, y, ex) }
        view.onNote = { pg, x, y, ex -> noteDialog(pg, x, y, ex) }
        view.onError = { e -> Ui.alert(this, "PDF lässt sich nicht öffnen", (e.message ?: "") + "\n\nVielleicht ist die Datei beschädigt oder geschützt.") { finish() } }
        Images.onLoaded = { view.invalidate() }

        Tabs.add(path)
        openDoc(path, intent.getIntExtra("page", -1))
        updUndo()
    }

    override fun onResume() {
        super.onResume()
        Store.syncState = { st -> runOnUiThread { statusV.text = when (st) { "saving" -> "Speichert …"; "offline" -> "Offline – wird nachgeholt"; else -> "Gespeichert" } } }
    }

    private fun iconBtn(s: String, click: () -> Unit) = bar.iconBtn(s, click)
    private fun pill(s: String, click: () -> Unit) = Ui.text(this, s, 15f, Ui.INK, true).apply { setPadding(dp(12f), dp(6f), dp(12f), dp(6f)); setOnClickListener { click() } }

    private fun updUndo() { undoV.alpha = if (view.canUndo) 1f else 0.3f; redoV.alpha = if (view.canRedo) 1f else 0.3f }

    // ================================================================== Lasso-Auswahl
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

    // ================================================================== Textfeld
    /** alle Kommentare, Textfelder und Markierungen dieser PDF als Liste */
    private fun commentList() {
        Usage.track("tool", "Kommentarliste")
        val list = Store.doc(path).strokes.values.filter { (it.optString("t") == "txt" || it.optString("t") == "tx") && !it.has("ln") }
            .sortedWith(compareBy({ it.optInt("p") }, { Ink.pts(it).getOrElse(1) { 0f } }))
        if (list.isEmpty()) { Ui.alert(this, "Kommentare", "Noch keine Kommentare, Textfelder oder Markierungen. Neuer Kommentar: Werkzeug „Kommentar“ wählen und auf die Seite tippen."); return }
        val kind = { s: JSONObject -> if (s.optString("t") == "tx") (mapOf("hl" to "Hervorhebung", "ul" to "Unterstreichung", "st" to "Durchstreichung")[s.optString("k", "hl")] ?: "Markierung") else if (s.optInt("nt") == 1) "Kommentar" else "Textfeld" }
        val labels = list.map { s -> "S. ${s.optInt("p") + 1} · ${kind(s)}" + (s.optString("text").takeIf { it.isNotBlank() }?.let { "\n" + it.take(200) } ?: "") }
        AlertDialog.Builder(this).setTitle("Kommentare (${list.size})").setItems(labels.toTypedArray()) { _, i ->
            val s = list[i]; val pg = s.optInt("p"); val p = Ink.pts(s)
            view.goTo(pg, ((p.getOrElse(1) { 0f }) / 1000f).coerceIn(0f, 0.9f))
            if (s.optInt("nt") == 1) noteDialog(pg, 0f, 0f, s)
        }.setNegativeButton("Schließen", null).show()
    }

    /** Kommentar (Notizzettel) lesen, schreiben, löschen */
    private fun noteDialog(page: Int, x: Float, y: Float, ex: JSONObject?) {
        val e = android.widget.EditText(this).apply {
            setText(ex?.optString("text") ?: ""); minLines = 4; gravity = android.view.Gravity.TOP
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE or android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            hint = "Kommentar schreiben …"; setSelection(text.length)
        }
        val box = android.widget.LinearLayout(this).apply { setPadding(Ui.dp(this@ViewerActivity, 20f), Ui.dp(this@ViewerActivity, 8f), Ui.dp(this@ViewerActivity, 20f), 0); addView(e, Ui.lp()) }
        val d = androidx.appcompat.app.AlertDialog.Builder(this).setTitle("Kommentar · Seite ${page + 1}").setView(box)
            .setPositiveButton("Fertig") { _, _ -> view.commitNote(page, x, y, e.text.toString(), ex) }
            .setNegativeButton("Abbrechen", null)
        if (ex != null) d.setNeutralButton("Löschen") { _, _ -> view.commitNote(page, x, y, "", ex) }
        d.show().window?.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
        e.requestFocus()
    }

    private fun textDialog(page: Int, x: Float, y: Float, ex: JSONObject?) {
        TextEditor.show(this, ex, view.ttSize, view.ttColor) { st -> view.commitText(page, x, y, st, ex) }
    }

    // ================================================================== Merkliste, Menü, Verknüpfungen
    private fun updStar() {
        val on = view.pageCount > 0 && Meta.isMarked(path, view.currentPage())
        starV.text = if (on) "★" else "☆"; starV.setTextColor(if (on) 0xFFE0A800.toInt() else Ui.NAVY)
    }
    private fun toggleMark() {
        val i = view.currentPage(); val on = Meta.isMarked(path, i)
        lifecycleScope.launch {
            val err = Meta.mark(path, i, on)
            Ui.toast(this@ViewerActivity, err ?: if (on) "Von der Merkliste entfernt." else "Seite ${i + 1} gemerkt – in der Bibliothek unter „★ Merkliste“.")
            updStar()
        }
    }

    private fun followLink(p2: String, pg: Int) {
        if (p2 == path) { view.goTo(pg); return }
        if (p2.startsWith("@nb/")) { Notebook.openLink(this, p2, pg); return }
        val f = Store.cachedLibrary()?.let { l -> Store.files(l).find { it.path == p2 } }
        if (f == null) { Ui.toast(this, "Diese PDF gibt es nicht mehr (verschoben oder gelöscht?)."); return }
        lifecycleScope.launch {
            if (!Tools.ensureLocal(this@ViewerActivity, f)) return@launch
            savePos(); val old = path; Store.scope.launch { Burn.run(old) }
            Tabs.add(p2); openDoc(p2, pg)
        }
    }

    // ---- Folien ins Notizbuch: Seite(n) mit Notizen als Bild auf eine Notizseite
    private fun toNotebook() {
        val cur = view.currentPage(); val n = view.pageCount
        Tools.ask(this, "Ins Notizbuch übernehmen", "Seiten, z. B. ${cur + 1} oder 3-5, 8", "${cur + 1}", "Weiter") { range ->
            val pages = Notebook.parsePages(range, n)
            if (pages.isNullOrEmpty()) { Ui.toast(this, "Bitte Seiten zwischen 1 und $n angeben."); return@ask }
            if (pages.size > 60) { Ui.toast(this, "Höchstens 60 Seiten auf einmal."); return@ask }
            lifecycleScope.launch {
                val books = Notebook.books(this@ViewerActivity)
                Notebook.pickTarget(this@ViewerActivity, books) { nb, sec, page, newNb ->
                    lifecycleScope.launch {
                        val pr = Ui.Progress(this@ViewerActivity, "Wird ins Notizbuch übernommen …")
                        try {
                            val items = ArrayList<Notebook.Img>()
                            for ((k, i) in pages.withIndex()) {
                                pr.label.text = "Seite ${k + 1} von ${pages.size}"
                                val (src, w, h) = Notebook.upload(Notebook.pageJpeg(this@ViewerActivity, path, i, true))
                                items.add(Notebook.Img(src, w, h, path, i))
                            }
                            val target = page ?: run {
                                if (newNb) Api.post("nbnew", JSONObject().put("kind", "nb").put("name", nb))
                                val title = path.substringAfterLast('/').removeSuffix(".pdf") + " – " + (if (pages.size > 1) "S. ${pages.first() + 1}–${pages.last() + 1}" else "S. ${pages.first() + 1}")
                                Api.post("nbnew", JSONObject().put("kind", "page").put("nb", nb).put("sec", sec).put("title", title)).getString("path")
                            }
                            try { Store.pullNotes(target) } catch (e: Exception) { }
                            val added = Notebook.imageStrokes(Store.doc(target).strokes.values, items)
                            Store.addStrokes(target, added)
                            Notebook.books(this@ViewerActivity)
                            pr.close()
                            val b = Notebook.wbox(added[0])
                            Store.prefs().edit().remove("cam:$target").apply()
                            AlertDialog.Builder(this@ViewerActivity).setTitle("Übernommen").setMessage(if (pages.size > 1) "${pages.size} Seiten sind jetzt im Notizbuch." else "Die Seite ist jetzt im Notizbuch.")
                                .setPositiveButton("Notizseite öffnen") { _, _ ->
                                    Store.prefs().edit().putString("cam:$target", "${b[0] - 30}|${b[1] - 30}|${minOf(1.2, (resources.displayMetrics.widthPixels / resources.displayMetrics.density - 60) / 860.0)}").apply()
                                    Notebook.openLink(this@ViewerActivity, target, 0)
                                }.setNegativeButton("Hier bleiben", null).show()
                        } catch (e: Exception) { pr.close(); Ui.alert(this@ViewerActivity, "Nicht übernommen", "Das geht nur mit Internetverbindung.") }
                    }
                }
            }
        }
    }

    private fun loadBitmap(u: android.net.Uri): android.graphics.Bitmap? = try {
        val o = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
        contentResolver.openInputStream(u)?.use { android.graphics.BitmapFactory.decodeStream(it, null, o) }
        var sample = 1; while (maxOf(o.outWidth, o.outHeight) / sample > 3000) sample *= 2
        val b = contentResolver.openInputStream(u)?.use { android.graphics.BitmapFactory.decodeStream(it, null, android.graphics.BitmapFactory.Options().apply { inSampleSize = sample }) }
        // Ausrichtung aus der Kamera berücksichtigen
        val rot = try { contentResolver.openInputStream(u)?.use { androidx.exifinterface.media.ExifInterface(it).rotationDegrees } ?: 0 } catch (e: Exception) { 0 }
        if (b != null && rot != 0) android.graphics.Bitmap.createBitmap(b, 0, 0, b.width, b.height, android.graphics.Matrix().apply { postRotate(rot.toFloat()) }, true) else b
    } catch (e: Exception) { Ui.toast(this, "Bild konnte nicht gelesen werden."); null }

    private fun photo() = Tools.photoChoice(this, {
        val f = java.io.File(cacheDir, "photos").apply { mkdirs() }.let { java.io.File(it, "foto.jpg") }
        photoUri = androidx.core.content.FileProvider.getUriForFile(this, "io.github.pdfstift.files", f)
        try { takePhoto.launch(photoUri!!) } catch (e: Exception) { Ui.toast(this, "Keine Kamera-App gefunden.") }
    }, { pickImage.launch("image/*") })

    private fun reloadDoc() { val (pg, fr) = view.currentPos(); val z = view.zoom; view.open(Store.pdfFile(path), path, pg, fr, z); thumbAdapter.reset() }

    private fun markerList() {
        val ms = view.markers()
        if (ms.isEmpty()) { Ui.toast(this, "Noch keine Folienmarken."); return }
        val labels = ms.map { "${it.optString("text")}  ·  Seite ${it.optInt("p") + 1}" }.toTypedArray()
        android.app.AlertDialog.Builder(this).setTitle("Folienmarken")
            .setItems(labels) { _, i -> view.goTo(ms[i].optInt("p")) }
            .setNegativeButton("Schließen", null).show()
    }

    private fun moreMenu(anchor: View) {
        val m = android.widget.PopupMenu(this, anchor)
        val items = ArrayList<Pair<String, () -> Unit>>()
        items.add("Werkzeuge …" to { Acro.menu(this) })
        items.add("Präsentieren (Vollbild, Laserpointer)" to { setPresent(true) })
        if (!Edition.FREE) items.add((if (Live.code != null) "Live-Mitschau: QR-Code zeigen / beenden" else "Live-Mitschau starten (Studierende sehen mit)") to { liveMenu() })
        items.add("Teilen mit Notizen …" to { Tools.share(this, path) })
        items.add((if (Rec.active) "Aufnahme beenden" else "Tonaufnahme starten") to { toggleRec() })
        items.add("Aufnahmen anhören …" to { Player.choose(this, path, view, frame) })
        items.add("Foto aufnehmen" to {
            val f = java.io.File(cacheDir, "photos").apply { mkdirs() }.let { java.io.File(it, "foto.jpg") }
            photoUri = androidx.core.content.FileProvider.getUriForFile(this, "io.github.pdfstift.files", f)
            try { takePhoto.launch(photoUri!!) } catch (e: Exception) { Ui.toast(this, "Keine Kamera-App gefunden.") }
        })
        items.add("Bild aus der Galerie …" to { pickImage.launch("image/*") })
        items.add("Unterschrift …" to { Tools.signature(this, view) })
        items.add("Stempel …" to { Tools.stamp(this, view) })
        items.add("Formular ausfüllen …" to { Tools.forms(this, path) { reloadDoc() } })
        items.add("Ins Notizbuch übernehmen …" to { toNotebook() })
        items.add("Verknüpfung einfügen …" to { Tools.insertLink(this, view) })
        items.add("Verweise auf diese PDF" to { Tools.backlinks(this, path) { p2, pg -> followLink(p2, pg) } })
        items.add("Schlagwörter …" to { Tools.editTags(this, path) })
        items.add("Seiten als neue PDF …" to { Tools.extract(this, path, view.pageCount, view.currentPage()) { } })
        items.add("Andere PDF hinten anhängen …" to { Tools.append(this, path) { reloadDoc() } })
        if (PageOps.canUndo(path)) items.add("Rückgängig: ${PageOps.undoLabel(path)} (Seiten)" to { undoPages() })
        items.add("Folienmarke setzen" to { view.markNext = "f"; Ui.toast(this, "Auf die Stelle tippen, an der die Folienmarke stehen soll.") })
        items.add("Videomarke setzen" to { view.markNext = "v"; Ui.toast(this, "Auf die Stelle tippen, an der die Videomarke stehen soll.") })
        if (view.markers().isNotEmpty()) items.add("Folienmarken anspringen …" to { markerList() })
        items.add("Kommentare (Liste) …" to { commentList() })
        items.add((if (view.viewMode == "single") "Zwei Seiten nebeneinander" else "Einzelseiten untereinander") to { view.viewMode = if (view.viewMode == "single") "two" else "single"; Usage.track("tool", if (view.viewMode == "single") "Einzelseiten" else "Zwei Seiten") })
        if (view.viewMode == "two") items.add("Zwei Seiten, Titelseite einzeln" to { view.viewMode = "cover"; Usage.track("tool", "Zwei Seiten (Titelseite einzeln)") })
        items.add("Einstellungen …" to { Settings.dialog(this) })
        items.add("Bericht für Verbesserungen …" to { Usage.report(this) })
        items.add("Kurzanleitung" to { Usage.track("tool", "Kurzanleitung"); try { startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(Api.HELP))) } catch (e: Exception) { Ui.toast(this, "Kein Browser gefunden.") } })
        items.add("Fehler melden …" to { Report.show(this, "PDF $path · Seite ${view.currentPage() + 1}") })
        items.forEachIndexed { k, it -> m.menu.add(0, k, k, it.first) }
        m.setOnMenuItemClickListener { items[it.itemId].second(); true }
        m.show()
    }

    // ================================================================== Live-Mitschau
    private fun updLive() {
        val c = Live.code
        liveV.visibility = if (c != null) View.VISIBLE else View.GONE
        liveP.visibility = liveV.visibility
        liveV.text = "LIVE · ${Live.viewers}"; liveP.text = "LIVE · ${Live.viewers}"
    }
    private fun liveMenu() {
        Usage.track("tool", "Live-Mitschau")
        if (Live.code == null) {
            lifecycleScope.launch {
                try { Live.start(path); Live.soon(); liveDialog() }
                catch (e: Exception) { Ui.alert(this@ViewerActivity, "Live-Mitschau nicht gestartet", if (e is Api.ApiError) (e.message ?: "") else "Keine Verbindung zum Server.") }
            }
        } else liveDialog()
    }
    private fun liveDialog() {
        val c = Live.code ?: return
        val url = Live.url(c)
        val img = ImageView(this).apply { setImageBitmap(Live.qr(url, 600)); adjustViewBounds = true }
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(dp(20f), dp(4f), dp(20f), 0)
            addView(Ui.text(this@ViewerActivity, "Die Studierenden scannen den Code mit der Handy-Kamera und sehen Seite, Notizen und Laserpointer live mit.", 14f, Ui.MUTED))
            addView(img, LinearLayout.LayoutParams(dp(260f), dp(260f)).apply { topMargin = dp(8f) })
            addView(Ui.text(this@ViewerActivity, url.removePrefix("https://"), 15f, Ui.INK, true).apply { setTextIsSelectable(true); gravity = Gravity.CENTER })
            addView(Ui.text(this@ViewerActivity, "Code: $c · ${Live.viewers} ${if (Live.viewers == 1) "Person schaut" else "Personen schauen"} zu", 14f, Ui.MUTED).apply { gravity = Gravity.CENTER; setPadding(0, dp(6f), 0, 0) })
        }
        AlertDialog.Builder(this).setTitle("Live-Mitschau").setView(box)
            .setPositiveButton("Fertig", null)
            .setNeutralButton("Link kopieren") { _, _ ->
                (getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager).setPrimaryClip(android.content.ClipData.newPlainText("Live-Mitschau", url))
                Ui.toast(this, "Link kopiert.")
            }
            .setNegativeButton("Beenden") { _, _ -> Live.stop(); Ui.toast(this, "Live-Mitschau beendet.") }
            .show()
    }

    // ================================================================== Tonaufnahme
    private fun toggleRec() {
        if (!Rec.active) Usage.track("tool", "Tonaufnahme")
        if (Rec.active) {
            Ui.alert(this, "Aufnahme beenden?", "Die Aufnahme (${Player.fmt(Rec.ms())}) wird gespeichert und hochgeladen. Anhören: ⋯ → „Aufnahmen anhören“.", "Beenden", "Weiter aufnehmen") { Rec.stop() }
            return
        }
        if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED) { micPerm.launch(android.Manifest.permission.RECORD_AUDIO); return }
        startRec()
    }
    private fun startRec() {
        Player.close()
        val err = Rec.start(this, path)
        if (err != null) Ui.alert(this, "Keine Aufnahme", err) else Ui.toast(this, "Aufnahme läuft. Alles, was du jetzt schreibst, ist mit dem Ton verknüpft.", true)
    }
    private fun updRec() {
        recV.visibility = if (Rec.active) View.VISIBLE else View.GONE
        recV.text = "● " + Player.fmt(Rec.ms())
        if (Rec.active) { recV.removeCallbacks(recTick); recV.postDelayed(recTick, 1000) }
    }

    // ================================================================== Präsentieren
    private fun presChip(s: String, click: () -> Unit) = Ui.text(this, s, 17f, Color.WHITE, true).apply {
        setPadding(dp(14f), dp(8f), dp(14f), dp(8f)); setOnClickListener { click() }
    }
    private fun updLaserBtn() { laserBtn.text = if (view.laserFinger) "Laser: Finger" else "Laser: Stift" }
    private fun pokePres() {
        if (!presenting) return
        presBar.removeCallbacks(hidePres)
        presBar.animate().cancel(); presBar.alpha = 1f; presBar.visibility = View.VISIBLE
        presBar.postDelayed(hidePres, 3500)
    }
    private fun setPresent(on: Boolean) {
        if (on) Usage.track("tool", "Präsentation")
        if (on == presenting) return
        presenting = on
        val ic = androidx.core.view.WindowCompat.getInsetsController(window, window.decorView)
        if (on) {
            thumbsWere = thumbWrap.visibility == View.VISIBLE
            if (searchBar.visibility == View.VISIBLE) toggleSearch()
            view.clearSel()
            for (v in listOf(topBar, topLine, thumbWrap, bar.view, pageV)) v.visibility = View.GONE
            ic.systemBarsBehavior = androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            ic.hide(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            updLaserBtn()
            view.present = true
            pokePres()
            Ui.toast(this, if (view.laserFinger) "Mit dem Finger zeigen. Weiterblättern: wischen oder an den Rand tippen." else "Mit dem Stift zeigen (Laser). Weiterblättern: wischen oder an den Rand tippen.", true)
        } else {
            presBar.removeCallbacks(hidePres); presBar.visibility = View.GONE
            ic.show(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            for (v in listOf(topBar, topLine, bar.view, pageV)) v.visibility = View.VISIBLE
            if (thumbsWere) thumbWrap.visibility = View.VISIBLE
            view.present = false
        }
    }

    private fun undoPages() {
        val pr = Ui.Progress(this, "Wird zurückgenommen …")
        lifecycleScope.launch {
            val err = PageOps.undo(path)
            pr.close()
            if (err != null) Ui.alert(this@ViewerActivity, "Nicht zurückgenommen", err) else { reloadDoc(); Ui.toast(this@ViewerActivity, "Zurückgenommen.") }
        }
    }

    // ================================================================== Tabs
    private var openT = 0L
    private fun openDoc(p: String, page: Int = -1) {
        path = p
        openT = System.currentTimeMillis()
        val pos = Store.prefs().getString("pos:$p", null)?.split("|")
        val pg = if (page >= 0) page else pos?.getOrNull(0)?.toIntOrNull() ?: 0
        view.hits = emptyList(); searchInfo.text = ""
        view.open(Store.pdfFile(p), p, pg, if (page >= 0) 0f else pos?.getOrNull(1)?.toFloatOrNull() ?: 0f, pos?.getOrNull(2)?.toFloatOrNull() ?: 1f)
        thumbAdapter.reset()
        renderTabs()
        lifecycleScope.launch { try { Store.pullNotes(p); statusV.text = "Gespeichert" } catch (e: Exception) { statusV.text = "Offline" } }
    }

    private fun savePos() {
        if (view.pageCount > 0) {
            val (pg, fr) = view.currentPos()
            Store.prefs().edit().putString("pos:$path", "$pg|$fr|${view.zoom}").apply()
        }
    }

    private fun switchTo(p: String) {
        if (p == path) return
        if (view.pick != null) endMode()
        if (!Store.hasLocal(p)) { Ui.toast(this, "Diese PDF ist nicht auf dem Tablet – bitte aus der Bibliothek öffnen."); return }
        savePos()
        val old = path
        Store.scope.launch { Burn.run(old) }
        Tabs.add(p)
        openDoc(p)
    }

    private fun renderTabs() {
        tabRow.removeAllViews()
        for (p in Tabs.list()) {
            val on = p == path
            val name = Ui.text(this, p.substringAfterLast('/').removeSuffix(".pdf"), 15f, if (on) Ui.INK else Ui.MUTED, on).apply { maxLines = 1; maxWidth = dp(260f) }
            val x = Ui.text(this, "✕", 13f, Ui.MUTED).apply { setPadding(dp(8f), 0, 0, 0) }
            val chip = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(12f), dp(7f), dp(10f), dp(7f))
                background = Ui.rounded(if (on) 0xFFDCE3F5.toInt() else Color.TRANSPARENT, dp(10f).toFloat())
                addView(name); addView(x)
                setOnClickListener { switchTo(p) }
            }
            x.setOnClickListener {
                val rest = Tabs.remove(p)
                if (p == path) { if (rest.isEmpty()) finish() else switchTo(rest.last()) } else renderTabs()
                if (p != path) Store.scope.launch { Burn.run(p) }
            }
            tabRow.addView(chip, LinearLayout.LayoutParams(-2, -2).apply { setMargins(dp(2f), 0, dp(2f), 0) })
        }
    }

    // ================================================================== Suche
    private fun toggleSearch() {
        val on = searchBar.visibility != View.VISIBLE
        searchBar.visibility = if (on) View.VISIBLE else View.GONE
        val im = getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
        if (on) { searchIn.requestFocus(); im.showSoftInput(searchIn, 0) } else { im.hideSoftInputFromWindow(searchIn.windowToken, 0); view.hits = emptyList(); view.hitCur = -1; searchGen++ }
    }

    private fun runSearch(q: String) {
        val g = ++searchGen
        val im = getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
        im.hideSoftInputFromWindow(searchIn.windowToken, 0)
        if (q.isBlank()) { view.hits = emptyList(); searchInfo.text = ""; return }
        val found = ArrayList<DocView.Hit>()
        val n = view.pageCount
        val start = view.currentPage()
        searchInfo.text = "sucht …"
        // ab der aktuellen Seite suchen, Treffer erscheinen nach und nach
        fun page(k: Int) {
            if (g != searchGen) return
            if (k >= n) {
                searchInfo.text = if (found.isEmpty()) "nichts gefunden" else "${(view.hitCur + 1).coerceAtLeast(1)} / ${found.size}"
                if (found.isEmpty()) Ui.toast(this, "„$q“ kommt in dieser PDF nicht vor (gescannte Seiten ohne Text werden nicht durchsucht).")
                return
            }
            val i = (start + k) % n
            view.searchPage(i, q) { res ->
                if (g != searchGen) return@searchPage
                if (res.isNotEmpty()) {
                    res.forEach { found.add(DocView.Hit(i, it)) }
                    found.sortBy { it.page }
                    view.hits = found.toList()
                    if (view.hitCur < 0) { view.showHit(found.indexOfFirst { it.page == i }) }
                    searchInfo.text = "${view.hitCur + 1} / ${found.size}+"
                }
                page(k + 1)
            }
        }
        view.hitCur = -1
        page(0)
    }

    private fun stepHit(d: Int) {
        val n = view.hits.size
        if (n == 0) { runSearch(searchIn.text.toString()); return }
        val k = ((view.hitCur + d) % n + n) % n
        view.showHit(k)
        searchInfo.text = "${k + 1} / $n"
    }

    // ================================================================== Seitenleiste
    private fun placeThumbs() {
        (thumbWrap.parent as? ViewGroup)?.removeView(thumbWrap)
        val horiz = thumbsHoriz
        thumbs.layoutManager = LinearLayoutManager(this, if (horiz) LinearLayoutManager.HORIZONTAL else LinearLayoutManager.VERTICAL, false)
        thumbs.setPadding(dp(10f), dp(if (horiz) 4f else 6f), dp(10f), dp(10f))
        val line = { v: View, lp: FrameLayout.LayoutParams -> v.background = null; lp }
        val border = 0xFFD5D9E2.toInt()
        thumbWrap.background = android.graphics.drawable.LayerDrawable(arrayOf(android.graphics.drawable.ColorDrawable(border), android.graphics.drawable.ColorDrawable(0xFFF4F6FA.toInt()))).apply {
            val b = dp(1f)
            when (thumbPos) { "left" -> setLayerInset(1, 0, 0, b, 0); "top" -> setLayerInset(1, 0, 0, 0, b); "bottom" -> setLayerInset(1, 0, b, 0, 0); else -> setLayerInset(1, b, 0, 0, 0) }
        }
        when (thumbPos) {
            "left" -> tSlotLeft.addView(thumbWrap, FrameLayout.LayoutParams(dp(176f), -1))
            "top" -> tSlotTop.addView(thumbWrap, FrameLayout.LayoutParams(-1, dp(196f)))
            "bottom" -> tSlotBottom.addView(thumbWrap, FrameLayout.LayoutParams(-1, dp(196f)))
            else -> tSlotRight.addView(thumbWrap, FrameLayout.LayoutParams(dp(176f), -1))
        }
        line(thumbWrap, FrameLayout.LayoutParams(0, 0))
        thumbAdapter.notifyDataSetChanged()
        if (view.pageCount > 0) thumbs.scrollToPosition(view.currentPage())
    }

    // ---- Seiten bearbeiten
    private val dragHelper by lazy {
        androidx.recyclerview.widget.ItemTouchHelper(object : androidx.recyclerview.widget.ItemTouchHelper.SimpleCallback(
            androidx.recyclerview.widget.ItemTouchHelper.UP or androidx.recyclerview.widget.ItemTouchHelper.DOWN or androidx.recyclerview.widget.ItemTouchHelper.LEFT or androidx.recyclerview.widget.ItemTouchHelper.RIGHT, 0) {
            var from = -1; var to = -1
            override fun onMove(rv: RecyclerView, a: RecyclerView.ViewHolder, b: RecyclerView.ViewHolder): Boolean {
                if (from < 0) from = a.bindingAdapterPosition
                to = b.bindingAdapterPosition
                thumbAdapter.notifyItemMoved(a.bindingAdapterPosition, b.bindingAdapterPosition)
                return true
            }
            override fun onSwiped(vh: RecyclerView.ViewHolder, dir: Int) {}
            override fun clearView(rv: RecyclerView, vh: RecyclerView.ViewHolder) {
                super.clearView(rv, vh)
                val f = from; val t = to
                from = -1; to = -1
                if (f >= 0 && t >= 0 && f != t) pageOp(PageOps.Op("move", f, t), "Seite ${f + 1} ist jetzt Seite ${t + 1}.")
                else thumbAdapter.notifyDataSetChanged()
            }
        })
    }

    private fun pageMenu(anchor: View, i: Int) {
        if (i < 0) return
        val m = android.widget.PopupMenu(this, anchor)
        val items = listOf("Drehen (90°)", "Leere Seite danach einfügen", "Karierte Seite danach einfügen", "Linierte Seite danach einfügen", "Nach vorn verschieben", "Nach hinten verschieben", "Seite löschen …") +
            (if (PageOps.canUndo(path)) listOf("Rückgängig: ${PageOps.undoLabel(path)}") else emptyList())
        items.forEachIndexed { k, t -> m.menu.add(0, k, k, t) }
        m.setOnMenuItemClickListener {
            when (it.itemId) {
                0 -> pageOp(PageOps.Op("rotate", i), "Seite ${i + 1} gedreht.")
                1 -> pageOp(PageOps.Op("insert", i, style = "plain"), "Leere Seite eingefügt.")
                2 -> pageOp(PageOps.Op("insert", i, style = "grid"), "Karierte Seite eingefügt.")
                3 -> pageOp(PageOps.Op("insert", i, style = "lines"), "Linierte Seite eingefügt.")
                4 -> if (i > 0) pageOp(PageOps.Op("move", i, i - 1), "Seite verschoben.")
                5 -> if (i < view.pageCount - 1) pageOp(PageOps.Op("move", i, i + 1), "Seite verschoben.")
                7 -> undoPages()
                6 -> {
                    if (view.pageCount < 2) { Ui.toast(this, "Die letzte Seite kann nicht gelöscht werden."); return@setOnMenuItemClickListener true }
                    val n = view.strokesOn(i).size
                    Ui.alert(this, "Seite ${i + 1} löschen?", (if (n > 0) "$n Notizen auf dieser Seite werden mit gelöscht. " else "") + "Die vorherige Fassung bleibt auf dem Server gesichert.", "Löschen", "Abbrechen") {
                        pageOp(PageOps.Op("delete", i), "Seite gelöscht.")
                    }
                }
            }
            true
        }
        m.show()
    }

    private fun pageOp(op: PageOps.Op, msg: String) {
        val pr = Ui.Progress(this, "Seiten werden geändert …")
        val (pg, fr) = view.currentPos()
        val z = view.zoom
        lifecycleScope.launch {
            val err = PageOps.run(path, op) { k -> view.pageWidthPt(k) to view.pageWidthPt(k) * view.pageAspect(k) }
            pr.close()
            if (err != null) { Ui.alert(this@ViewerActivity, "Nicht geändert", err); thumbAdapter.notifyDataSetChanged(); return@launch }
            val target = when (op.kind) { "insert" -> op.i + 1; "move" -> op.j; "delete" -> minOf(op.i, view.pageCount - 2); else -> pg }
            view.open(Store.pdfFile(path), path, target, if (target == pg) fr else 0f, z)
            thumbAdapter.reset()
            Ui.toast(this@ViewerActivity, msg)
        }
    }

    private fun chooseThumbPos() {
        val opts = listOf("left" to "Links", "right" to "Rechts", "top" to "Oben", "bottom" to "Unten")
        AlertDialog.Builder(this).setTitle("Seitenleiste")
            .setItems(opts.map { (if (it.first == thumbPos) "✓ " else "") + it.second }.toTypedArray()) { _, i ->
                thumbPos = opts[i].first; Store.prefs().edit().putString("thumbPos", thumbPos).apply(); placeThumbs()
            }.show()
    }

    private fun toggleThumbs() {
        val on = thumbWrap.visibility != View.VISIBLE
        thumbWrap.visibility = if (on) View.VISIBLE else View.GONE
        Store.prefs().edit().putBoolean("thumbs", on).apply()
        if (on) { thumbAdapter.notifyDataSetChanged(); thumbs.scrollToPosition(view.currentPage()) }
    }

    private inner class ThumbAdapter : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
        private var cur = -1
        private val cache = HashMap<Int, Bitmap>()
        fun current(i: Int) {
            if (i == cur) return
            val old = cur; cur = i
            if (old >= 0) notifyItemChanged(old); notifyItemChanged(i)
            if (thumbWrap.visibility == View.VISIBLE) (thumbs.layoutManager as LinearLayoutManager).let { lm ->
                if (i < lm.findFirstCompletelyVisibleItemPosition() || i > lm.findLastCompletelyVisibleItemPosition()) thumbs.scrollToPosition(i)
            }
        }
        fun reset() { cache.clear(); cur = -1; notifyDataSetChanged() }
        fun inkChanged() { cache.clear(); if (thumbWrap.visibility == View.VISIBLE) notifyDataSetChanged() }
        override fun getItemCount() = view.pageCount
        override fun getItemViewType(position: Int) = if (thumbsHoriz) 1 else 0
        override fun onCreateViewHolder(p: ViewGroup, t: Int): RecyclerView.ViewHolder {
            val img = ImageView(this@ViewerActivity).apply { adjustViewBounds = true; scaleType = ImageView.ScaleType.FIT_CENTER; setBackgroundColor(Color.WHITE) }
            val num = Ui.text(this@ViewerActivity, "", 13f, Ui.MUTED).apply { gravity = Gravity.CENTER; setPadding(0, 0, 0, 0) }
            val box = LinearLayout(this@ViewerActivity).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(4f), dp(4f), dp(4f), dp(4f))
                addView(img, Ui.lp(-1, -2))
                addView(LinearLayout(this@ViewerActivity).apply {
                    orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                    addView(num, Ui.lp(0, -2, 1f))
                    addView(Ui.text(this@ViewerActivity, "⋯", 18f, Ui.NAVY, true).apply { tag = "more"; setPadding(dp(10f), 0, dp(6f), 0) })
                }, Ui.lp(-1, -2))
                layoutParams = if (thumbsHoriz) RecyclerView.LayoutParams(-2, -1).apply { rightMargin = dp(8f) } else RecyclerView.LayoutParams(-1, -2).apply { bottomMargin = dp(8f) }
            }
            box.tag = img to num
            return object : RecyclerView.ViewHolder(box) {}
        }
        override fun onBindViewHolder(h: RecyclerView.ViewHolder, pos: Int) {
            @Suppress("UNCHECKED_CAST") val pair = h.itemView.tag as Pair<ImageView, TextView>
            val img = pair.first; val num = pair.second
            num.text = "${pos + 1}"
            h.itemView.background = Ui.rounded(if (pos == cur) 0xFFDCE3F5.toInt() else Color.TRANSPARENT, dp(8f).toFloat(), Ui.NAVY, if (pos == cur) dp(2f) else 0)
            h.itemView.setOnClickListener { view.goTo(pos) }
            h.itemView.findViewWithTag<View>("more")?.setOnClickListener { v -> pageMenu(v, h.bindingAdapterPosition) }
            val asp = view.pageAspect(pos)
            val w = if (thumbsHoriz) (dp(128f) / asp).toInt().coerceAtLeast(dp(40f)) else dp(150f)
            if (thumbsHoriz) img.layoutParams = LinearLayout.LayoutParams(w, dp(128f)) else { img.layoutParams = LinearLayout.LayoutParams(-1, -2); img.minimumHeight = (w * asp).toInt() }
            val c = cache[pos]
            if (c != null) { img.setImageBitmap(c); return }
            img.setImageDrawable(null)
            img.tag = pos
            view.thumb(pos, w) { bmp ->
                if (bmp == null) return@thumb
                // Notizen in die Vorschau
                val cv = android.graphics.Canvas(bmp)
                cv.scale(bmp.width / view.pageWidthPt(pos), bmp.width / view.pageWidthPt(pos))
                view.strokesOn(pos).forEach { Ink.draw(cv, it) }
                cache[pos] = bmp
                if (img.tag == pos) img.setImageBitmap(bmp)
            }
        }
    }

    // ================================================================== Sonstiges
    private fun askPage() {
        val e = EditText(this).apply { inputType = InputType.TYPE_CLASS_NUMBER; hint = "1 – ${view.pageCount}" }
        AlertDialog.Builder(this).setTitle("Gehe zu Seite").setView(e)
            .setPositiveButton("Los") { _, _ -> e.text.toString().toIntOrNull()?.let { view.goTo(it - 1) } }
            .setNegativeButton("Abbrechen", null).show()
    }

    override fun onPause() {
        Usage.flushSoon()
        super.onPause()
        savePos()
        Store.scheduleFlush(0)
    }

    override fun onDestroy() {
        Ocr.onChange = null
        super.onDestroy()
        view.overlay?.release()
        view.close()
        // Notizen fest in die PDF schreiben (läuft im Hintergrund weiter)
        if (isFinishing) {
            val p = path; Store.scope.launch { Burn.run(p) }
            Live.stop(); Live.source = null; Live.onChange = {}
            Rec.stop(); Rec.onChange = {}; Player.close()
        }
    }
}
