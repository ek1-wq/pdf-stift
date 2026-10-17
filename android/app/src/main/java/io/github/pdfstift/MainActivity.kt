package io.github.pdfstift

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Bibliothek: Ordner und PDFs vom Server, offline aus dem Speicher des Tablets */
class MainActivity : AppCompatActivity(), FileHost {
    override val act: AppCompatActivity get() = this
    private var filesCb: ((List<Uri>) -> Unit)? = null
    private val filesPick = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { l -> filesCb?.invoke(l); filesCb = null }
    override fun pickFiles(types: Array<String>, cb: (List<Uri>) -> Unit) { filesCb = cb; try { filesPick.launch(types) } catch (e: Exception) { Ui.toast(this, "Keine Dateiauswahl verfügbar.") } }
    override fun openPath(path: String) { refresh(); startViewer(path) }

    private var lib: JSONObject? = null
    private var books: org.json.JSONArray? = null
    private var mode = "pdf"
    private lateinit var tabPdf: TextView
    private lateinit var tabNb: TextView
    private var tabDk: TextView? = null
    private var decks: org.json.JSONArray? = null
    override var folder = ""
    private var query = ""
    private lateinit var list: RecyclerView
    private lateinit var swipe: SwipeRefreshLayout
    private lateinit var titleV: TextView
    private lateinit var backV: TextView
    private lateinit var statusV: TextView
    private lateinit var updV: TextView
    private var grid = true
    private var tag = ""
    private lateinit var tagRow: LinearLayout
    private lateinit var tagScroll: android.widget.HorizontalScrollView
    private val adapter = Adapter()
    private var pendingShare: Uri? = null

    /** aus Nextcloud/OneDrive übernommene PDF gleich öffnen */
    private val cloudLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val p = r.data?.getStringExtra("open") ?: return@registerForActivityResult
        lifecycleScope.launch {
            try { val j = Api.get("list"); lib = j; Store.saveLibrary(j) } catch (e: Exception) { }
            render()
            val f = lib?.let { l -> Store.files(l).find { it.path == p } }
            if (f != null) open(f) else Ui.toast(this@MainActivity, "Die Datei ist übernommen, aber noch nicht in der Liste – bitte nach unten ziehen zum Aktualisieren.", true)
        }
    }
    private val login = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        if (r.resultCode == Activity.RESULT_OK) { refresh(); pendingShare?.let { pendingShare = null; importShared(it) } } else finish()
    }

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        val dp = { v: Float -> Ui.dp(this, v) }
        folder = Store.prefs().getString("folder", "") ?: ""
        mode = Store.prefs().getString("libMode", "pdf") ?: "pdf"
        books = try { org.json.JSONArray(java.io.File(filesDir, "boards.json").readText()) } catch (e: Exception) { null }
        backV = Ui.text(this, "‹", 30f, Ui.NAVY, true).apply { setPadding(dp(14f), 0, dp(10f), dp(4f)); setOnClickListener { goUp() } }
        titleV = Ui.text(this, "Meine PDFs", 22f, Ui.INK, true)
        statusV = Ui.text(this, "", 13f, Ui.MUTED).apply { setPadding(dp(12f), 0, dp(12f), 0) }
        updV = Ui.text(this, "Aktualisieren", 15f, 0xFFFFFFFF.toInt(), true).apply {
            background = Ui.rounded(Ui.NAVY, dp(10f).toFloat()); setPadding(dp(14f), dp(8f), dp(14f), dp(8f))
            visibility = View.GONE; setOnClickListener { Updater.start(this@MainActivity) }
        }
        Updater.onChange = { runOnUiThread { updV.visibility = if (Updater.hasUpdate) View.VISIBLE else View.GONE; updV.text = "Update: " + (Updater.latest?.optString("versionName") ?: "") } }
        val viewV = Ui.text(this, if (grid) "☰" else "▦", 22f, Ui.NAVY, true).apply {
            setPadding(dp(12f), 0, dp(8f), 0); contentDescription = "Raster oder Liste"
        }
        viewV.setOnClickListener { grid = !grid; Store.prefs().edit().putBoolean("grid", grid).apply(); viewV.text = if (grid) "☰" else "▦"; adapter.notifyDataSetChanged() }
        val menuV = Ui.text(this, "⋮", 26f, Ui.NAVY, true).apply { setPadding(dp(14f), 0, dp(14f), 0); setOnClickListener { showMenu(it) } }
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(0xFFFFFFFF.toInt()); setPadding(dp(8f), dp(10f), dp(8f), dp(10f))
            addView(backV); addView(titleV, Ui.lp(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)); addView(statusV); addView(updV); addView(viewV); addView(menuV)
        }
        val search = EditText(this).apply {
            hint = "Suchen …"; textSize = 16f; isSingleLine = true
            background = Ui.rounded(0xFFFFFFFF.toInt(), dp(12f).toFloat(), Ui.LINE, dp(1f))
            setPadding(dp(14f), dp(10f), dp(14f), dp(10f))
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun afterTextChanged(s: Editable?) { query = s.toString().trim(); textHits = emptyList(); render(); searchText() }
            })
        }
        tabPdf = tab("Meine PDFs") { setMode("pdf") }
        tabNb = tab("Notizbuch") { setMode("nb") }
        val tabs = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; setPadding(dp(4f), dp(4f), dp(4f), dp(4f))
            background = Ui.rounded(0xFFDDE2EC.toInt(), dp(12f).toFloat())
            addView(tabPdf); addView(tabNb)
            if (!Api.offline) { tabDk = tab("Präsentationen") { setMode("dk") }; addView(tabDk) }
            if (!Edition.FREE) addView(tab("Nextcloud") { cloudLauncher.launch(Intent(this@MainActivity, CloudActivity::class.java).putExtra("pv", "nc")) })
            if (!Edition.FREE) addView(tab("OneDrive") { cloudLauncher.launch(Intent(this@MainActivity, CloudActivity::class.java).putExtra("pv", "od")) })
        }
        grid = Store.prefs().getBoolean("grid", true)
        val glm = androidx.recyclerview.widget.GridLayoutManager(this, 4)
        glm.spanSizeLookup = object : androidx.recyclerview.widget.GridLayoutManager.SpanSizeLookup() {
            override fun getSpanSize(pos: Int) = if (adapter.getItemViewType(pos) == 1) 1 else glm.spanCount
        }
        list = RecyclerView(this).apply { layoutManager = glm; adapter = this@MainActivity.adapter; setPadding(Ui.dp(this@MainActivity, 10f), 0, Ui.dp(this@MainActivity, 10f), Ui.dp(this@MainActivity, 20f)); clipToPadding = false }
        list.addOnLayoutChangeListener { v, _, _, _, _, _, _, _, _ ->
            val n = (v.width / Ui.dp(this@MainActivity, 190f)).coerceAtLeast(2)
            if (glm.spanCount != n) { glm.spanCount = n; v.post { adapter.notifyDataSetChanged() } }
        }
        swipe = SwipeRefreshLayout(this).apply { addView(list); setOnRefreshListener { refresh() } }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setBackgroundColor(Ui.BG)
            addView(top)
            addView(tabs, Ui.lp(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(dp(16f), dp(12f), dp(16f), 0) })
            addView(search, Ui.lp().apply { setMargins(dp(16f), dp(10f), dp(16f), dp(6f)) })
            tagRow = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(12f), 0, dp(12f), dp(4f)) }
            tagScroll = android.widget.HorizontalScrollView(this@MainActivity).apply { isHorizontalScrollBarEnabled = false; addView(tagRow) }
            addView(tagScroll)
            addView(swipe, Ui.lp(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        }
        setContentView(root)
        lib = Store.cachedLibrary()
        render()
        handleIntent(intent)
        if (Crash.hadCrash()) Ui.toast(this, "Die App wurde beim letzten Mal unerwartet beendet – ein Fehlerbericht geht an den Server, damit es behoben werden kann.", true)
        lifecycleScope.launch { Crash.sendPending() }
        start()
    }

    override fun onNewIntent(i: Intent) { super.onNewIntent(i); handleIntent(i) }

    private fun start() {
        lifecycleScope.launch {
            try {
                if (!Api.configured) { login.launch(Intent(this@MainActivity, LoginActivity::class.java)); return@launch }
                val me = Api.get("me")
                if (!me.optBoolean("loggedIn")) { login.launch(Intent(this@MainActivity, LoginActivity::class.java)); return@launch }
                refresh()
                Updater.check(this@MainActivity, silent = true)
            } catch (e: Exception) {
                statusV.text = "Offline"
            }
        }
    }

    private fun refresh() {
        swipe.isRefreshing = true
        lifecycleScope.launch {
            try {
                if (PageOps.hasDirty()) PageOps.flushDirty()
                val j = Api.get("list")
                lib = j; Store.saveLibrary(j); Store.prune(j); Offline.start(this@MainActivity)
                Meta.refresh()
                if (Rec.pending().length() > 0) Store.scope.launch { Rec.uploadPending(Rec.dir(this@MainActivity)) }
                Store.scope.launch { Settings.load() }
                if (PrefSync.startup()) { Ui.toast(this@MainActivity, "Deine Einstellungen sind wieder da."); recreate(); return@launch }
                books = Notebook.books(this@MainActivity)
                if (!Api.offline) decks = try { Api.get("decks").optJSONArray("decks") } catch (e: Exception) { decks }
                statusV.text = ""
            } catch (e: Api.ApiError) {
                if (e.code == 401) login.launch(Intent(this@MainActivity, LoginActivity::class.java)) else Ui.toast(this@MainActivity, e.message ?: "Fehler")
            } catch (e: Exception) { statusV.text = "Offline" }
            swipe.isRefreshing = false
            render()
        }
    }

    // ---------------------------------------------------------------- Liste
    private sealed class Item {
        class Folder(val path: String) : Item(); class File(val f: LibFile) : Item()
        class Head(val text: String, val color: String, val level: Int, val add: (() -> Unit)?, val addLabel: String, val path: String = "") : Item()
        class Page(val path: String, val title: String, val level: Int, val date: Long) : Item()
        class Hit(val path: String, val page: Int, val snip: String) : Item()
        class Deck(val path: String, val title: String, val slides: Int, val date: Long) : Item()
        object NewDeck : Item()
    }
    private var items = listOf<Item>()
    private var textHits = listOf<Item.Hit>()
    private var searchJob: kotlinx.coroutines.Job? = null
    /** Volltextsuche auf dem Server (findet Wörter in allen PDFs und Notizen) */
    private fun searchText() {
        searchJob?.cancel()
        val q = query
        if (q.length < 3 || mode != "pdf") return
        searchJob = lifecycleScope.launch {
            kotlinx.coroutines.delay(450)
            try {
                val r = Api.get("search", mapOf("q" to q))
                val out = ArrayList<Item.Hit>()
                val docs = r.optJSONArray("docs")
                if (docs != null) for (i in 0 until docs.length()) {
                    val d = docs.getJSONObject(i); val hs = d.optJSONArray("hits") ?: continue
                    for (k in 0 until hs.length()) { val h = hs.getJSONObject(k); out.add(Item.Hit(d.getString("path"), h.optInt("page"), h.optString("snip"))) }
                }
                val ns = r.optJSONArray("notes")
                if (ns != null) for (i in 0 until ns.length()) { val h = ns.getJSONObject(i); out.add(Item.Hit(h.getString("path"), h.optInt("page"), "✎ " + h.optString("snip"))) }
                if (q == query) { textHits = out.take(60); render() }
            } catch (e: Exception) { }
        }
    }

    private fun renderTagBar() {
        tagRow.removeAllViews()
        if (mode != "pdf") { tagScroll.visibility = View.GONE; return }
        val tags = Meta.allTags(); val n = Meta.marks().size
        tagScroll.visibility = if (tags.isEmpty() && n == 0) View.GONE else View.VISIBLE
        fun chip(label: String, key: String) = Ui.text(this, label, 14f, if (tag == key) 0xFFFFFFFF.toInt() else Ui.INK, tag == key).apply {
            setPadding(Ui.dp(this@MainActivity, 12f), Ui.dp(this@MainActivity, 6f), Ui.dp(this@MainActivity, 12f), Ui.dp(this@MainActivity, 6f))
            background = Ui.rounded(if (tag == key) Ui.NAVY else 0xFFFFFFFF.toInt(), Ui.dp(this@MainActivity, 16f).toFloat())
            setOnClickListener { tag = if (tag == key) "" else key; render(); list.scrollToPosition(0) }
        }
        tagRow.addView(chip("★ Merkliste $n", "★"), LinearLayout.LayoutParams(-2, -2).apply { setMargins(Ui.dp(this@MainActivity, 4f), 0, Ui.dp(this@MainActivity, 4f), 0) })
        for ((t, c) in tags) tagRow.addView(chip("# $t $c", t), LinearLayout.LayoutParams(-2, -2).apply { setMargins(Ui.dp(this@MainActivity, 4f), 0, Ui.dp(this@MainActivity, 4f), 0) })
    }

    private fun tab(s: String, click: () -> Unit) = Ui.text(this, s, 15f, Ui.INK, true).apply {
        setPadding(Ui.dp(this@MainActivity, 16f), Ui.dp(this@MainActivity, 7f), Ui.dp(this@MainActivity, 16f), Ui.dp(this@MainActivity, 7f)); setOnClickListener { click() }
    }

    private fun setMode(m: String) { mode = m; Store.prefs().edit().putString("libMode", m).apply(); render(); list.scrollToPosition(0) }

    private fun renderBooks() {
        titleV.text = "Notizbuch"; backV.visibility = View.GONE
        val out = ArrayList<Item>()
        val q = query.lowercase()
        out.add(Item.Head("", "#000000", -1, { newBook() }, "+ Neues Notizbuch"))
        val bs = books
        if (bs != null) for (i in 0 until bs.length()) {
            val b = bs.getJSONObject(i); val bn = b.getString("name")
            out.add(Item.Head(bn, b.optString("color", "#1E2F6E"), 0, { newSection(bn) }, "+ Abschnitt", "@nb/$bn"))
            val secs = b.optJSONArray("sections") ?: continue
            for (k in 0 until secs.length()) {
                val sc = secs.getJSONObject(k); val sn = sc.getString("name")
                out.add(Item.Head(sn, sc.optString("color", "#1E2F6E"), 1, { newPage(bn, sn) }, "+ Seite", "@nb/$bn/$sn"))
                val pages = sc.optJSONArray("pages") ?: continue
                for (m in 0 until pages.length()) {
                    val pg = pages.getJSONObject(m)
                    val t = pg.optString("title").ifBlank { "Ohne Titel" }
                    if (q.isNotEmpty() && !t.lowercase().contains(q) && !sn.lowercase().contains(q) && !bn.lowercase().contains(q)) continue
                    out.add(Item.Page(pg.getString("path"), t, pg.optInt("level"), pg.optLong("mtime")))
                }
            }
        }
        items = out
        adapter.notifyDataSetChanged()
    }

    // Präsentationen (vom eigenen Server; bearbeitet im selben Folieneditor wie am PC, samt Skizze → Folie)
    private fun renderDecks() {
        titleV.text = "Präsentationen"; backV.visibility = View.GONE
        val out = ArrayList<Item>()
        out.add(Item.NewDeck)
        val q = query.lowercase()
        val ds = decks
        if (ds != null) for (i in 0 until ds.length()) {
            val d = ds.getJSONObject(i)
            val t = d.optString("title").ifBlank { "Präsentation" }
            if (d.optBoolean("tpl")) continue
            if (q.isNotEmpty() && !t.lowercase().contains(q)) continue
            out.add(Item.Deck(d.getString("path"), t, d.optInt("slides"), d.optLong("mtime")))
        }
        if (ds == null) out.add(Item.Head("Präsentationen werden geladen – nach unten ziehen zum Aktualisieren.", "#1E2F6E", 0, null, ""))
        items = out
        adapter.notifyDataSetChanged()
    }
    private fun startDeck(path: String) = startActivity(Intent(this, DeckActivity::class.java).putExtra("path", path))
    private fun newDeck() = ask("Neue Präsentation", "Titel, z. B. Mikroökonomie – Woche 3") { n ->
        lifecycleScope.launch {
            try {
                val r = Api.post("decknew", JSONObject().put("title", n.ifBlank { "Neue Präsentation" }))
                startDeck(r.getString("path"))
            } catch (e: Exception) { Ui.toast(this@MainActivity, e.message ?: "Fehler") }
        }
    }

    private fun ask(title: String, hint: String, done: (String) -> Unit) {
        val e = EditText(this).apply { this.hint = hint; isSingleLine = true }
        val box = LinearLayout(this).apply { setPadding(Ui.dp(this@MainActivity, 20f), Ui.dp(this@MainActivity, 8f), Ui.dp(this@MainActivity, 20f), 0); addView(e, Ui.lp()) }
        androidx.appcompat.app.AlertDialog.Builder(this).setTitle(title).setView(box)
            .setPositiveButton("Anlegen") { _, _ -> done(e.text.toString().trim()) }.setNegativeButton("Abbrechen", null).show()
        e.requestFocus()
    }
    private fun newBook() = ask("Neues Notizbuch", "Name, z. B. Vorlesungen") { n -> nbCall(JSONObject().put("kind", "nb").put("name", n.ifBlank { "Notizbuch" }), false) }
    private fun newSection(nb: String) = ask("Neuer Abschnitt in „$nb“", "Name, z. B. Mikroökonomie") { n -> nbCall(JSONObject().put("kind", "sec").put("nb", nb).put("name", n.ifBlank { "Neuer Abschnitt" }), false) }
    private fun newPage(nb: String, sec: String) = Notebook.templateDialog(this, true) { kind, title ->
        val tp = Notebook.TEMPLATES.first { it.first == kind }
        lifecycleScope.launch {
            try {
                val t = title.ifBlank { tp.second }
                val r = Api.post("nbnew", JSONObject().put("kind", "page").put("nb", nb).put("sec", sec).put("title", t).put("bg", tp.third))
                val path = r.getString("path")
                val strokes = Notebook.template(kind, 0.0, 0.0, t)
                if (strokes.isNotEmpty()) {
                    Store.addStrokes(path, strokes)
                    val w = resources.displayMetrics.widthPixels / resources.displayMetrics.density
                    val sc = minOf(1.2, (w - 60) / 860.0)
                    Store.prefs().edit().putString("cam:$path", "${-30 / sc}|${-30 / sc}|$sc").apply()
                }
                books = Notebook.books(this@MainActivity)
                render()
                startBoard(path, t)
            } catch (e: Api.ApiError) { Ui.toast(this@MainActivity, e.message ?: "Nicht angelegt.") }
            catch (e: Exception) {
                // ohne Internet: Seite auf dem Tablet anlegen, der Server bekommt sie, sobald wieder Verbindung da ist
                val t = title.ifBlank { tp.second }
                val path = Notebook.addPendingPage(this@MainActivity, nb, sec, t, tp.third)
                val strokes = Notebook.template(kind, 0.0, 0.0, t)
                if (strokes.isNotEmpty()) {
                    Store.addStrokes(path, strokes)
                    val w = resources.displayMetrics.widthPixels / resources.displayMetrics.density
                    val sc = minOf(1.2, (w - 60) / 860.0)
                    Store.prefs().edit().putString("cam:$path", "${-30 / sc}|${-30 / sc}|$sc").apply()
                }
                Store.prefs().edit().putString("bg:$path", tp.third).apply()
                books = Notebook.cachedBooks(this@MainActivity); render()
                Ui.toast(this@MainActivity, "Offline angelegt – wird übertragen, sobald wieder Internet da ist.", true)
                startBoard(path, t)
            }
        }
    }
    // Notizbuch oder Abschnitt lange drücken: nach oben / unten
    private fun orderMenu(path: String, title: String) {
        val bs = books ?: return
        val inner = path.removePrefix("@nb/")
        val list: MutableList<String> = if (!inner.contains('/')) (0 until bs.length()).map { "@nb/" + bs.getJSONObject(it).getString("name") }.toMutableList()
            else (0 until bs.length()).map { bs.getJSONObject(it) }.find { it.getString("name") == inner.substringBefore('/') }?.optJSONArray("sections")
                ?.let { ss -> (0 until ss.length()).map { "@nb/" + inner.substringBefore('/') + "/" + ss.getJSONObject(it).getString("name") } }?.toMutableList() ?: return
        androidx.appcompat.app.AlertDialog.Builder(this).setTitle(title).setItems(arrayOf("Nach oben", "Nach unten")) { _, w ->
            val i = list.indexOf(path); val j = if (w == 0) i - 1 else i + 1
            if (i < 0 || j < 0 || j >= list.size) return@setItems
            list[i] = list[j]; list[j] = path
            lifecycleScope.launch {
                try { Api.post("nborder", JSONObject().put("paths", org.json.JSONArray(list))); books = Notebook.books(this@MainActivity); render() }
                catch (e: Exception) { Ui.toast(this@MainActivity, "Geht nur mit Internetverbindung.") }
            }
        }.setNegativeButton("Abbrechen", null).show()
    }
    // Seite lange drücken: ordnen und verschieben
    private fun pageMenu(path: String, title: String) {
        val secPath = path.substringBeforeLast('/')
        val opts = arrayOf("Nach oben", "Nach unten", "In anderen Abschnitt verschieben …")
        androidx.appcompat.app.AlertDialog.Builder(this).setTitle(title).setItems(opts) { _, w ->
            if (w < 2) {
                val bs = books ?: return@setItems
                var list: MutableList<String>? = null
                for (i in 0 until bs.length()) { val ss = bs.getJSONObject(i).optJSONArray("sections") ?: continue
                    for (k in 0 until ss.length()) { val ps = ss.getJSONObject(k).optJSONArray("pages") ?: continue
                        val l = (0 until ps.length()).map { ps.getJSONObject(it).getString("path") }
                        if (path in l) list = l.toMutableList() } }
                val l = list ?: return@setItems
                val i = l.indexOf(path); val j = if (w == 0) i - 1 else i + 1
                if (j < 0 || j >= l.size) return@setItems
                l[i] = l[j]; l[j] = path
                lifecycleScope.launch {
                    try { Api.post("nborder", JSONObject().put("paths", org.json.JSONArray(l))); books = Notebook.books(this@MainActivity); render() }
                    catch (e: Exception) { Ui.toast(this@MainActivity, "Geht nur mit Internetverbindung.") }
                }
            } else {
                val bs = books ?: return@setItems
                val secs = ArrayList<Pair<String, String>>()
                for (i in 0 until bs.length()) { val b = bs.getJSONObject(i); val ss = b.optJSONArray("sections") ?: continue
                    for (k in 0 until ss.length()) { val sp = "@nb/" + b.getString("name") + "/" + ss.getJSONObject(k).getString("name"); if (sp != secPath) secs.add(sp to sp.substring(4).replace("/", " › ")) } }
                if (secs.isEmpty()) { Ui.toast(this, "Es gibt keinen anderen Abschnitt."); return@setItems }
                androidx.appcompat.app.AlertDialog.Builder(this).setTitle("Verschieben nach …").setItems(secs.map { it.second }.toTypedArray()) { _, k ->
                    lifecycleScope.launch {
                        try {
                            Store.flush()
                            val r = Api.post("nbmove", JSONObject().put("path", path).put("to", secs[k].first))
                            val np = r.getString("path")
                            Store.prefs().getString("cam:$path", null)?.let { Store.prefs().edit().putString("cam:$np", it).remove("cam:$path").apply() }
                            books = Notebook.books(this@MainActivity); render()
                            Ui.toast(this@MainActivity, "Verschoben nach „${secs[k].second}“.")
                        } catch (e: Exception) { Ui.toast(this@MainActivity, "Geht nur mit Internetverbindung.") }
                    }
                }.setNegativeButton("Abbrechen", null).show()
            }
        }.setNegativeButton("Abbrechen", null).show()
    }
    private fun nbCall(body: JSONObject, open: Boolean) {
        lifecycleScope.launch {
            try {
                val r = Api.post("nbnew", body)
                val bj = Api.get("boards"); books = bj.optJSONArray("books"); java.io.File(filesDir, "boards.json").writeText(books.toString())
                render()
                if (open) startBoard(r.getString("path"), "Neue Seite")
            } catch (e: Exception) { Ui.toast(this@MainActivity, "Geht nur mit Internetverbindung.") }
        }
    }
    private fun startBoard(path: String, title: String) = startActivity(Intent(this, BoardActivity::class.java).putExtra("path", path).putExtra("title", title))

    private fun render() {
        val on = 0xFFFFFFFF.toInt()
        tabPdf.background = Ui.rounded(if (mode == "pdf") on else 0, Ui.dp(this, 9f).toFloat()); tabNb.background = Ui.rounded(if (mode == "nb") on else 0, Ui.dp(this, 9f).toFloat())
        renderTagBar()
        tabDk?.background = Ui.rounded(if (mode == "dk") on else 0, Ui.dp(this, 9f).toFloat())
        if (mode == "nb") { renderBooks(); return }
        if (mode == "dk") { if (Api.offline) { mode = "pdf" } else { renderDecks(); return } }
        val l = lib
        titleV.text = if (query.isNotEmpty()) "Suche" else if (folder.isEmpty()) "Meine PDFs" else folder.substringAfterLast('/')
        backV.visibility = if (folder.isNotEmpty() && query.isEmpty()) View.VISIBLE else View.GONE
        if (l == null) { items = listOf(); adapter.notifyDataSetChanged(); return }
        val files = Store.files(l)
        items = if (tag == "★") {
            titleV.text = "Merkliste"; backV.visibility = View.GONE
            val ms = Meta.marks()
            if (ms.isEmpty()) listOf(Item.Head("Noch nichts gemerkt – in einer PDF oben auf ☆ tippen.", "#1E2F6E", 0, null, "")) else
            ms.map { Item.Hit(it.path, it.page, it.title.ifBlank { "Seite ${it.page + 1}" }) }
        } else if (tag.isNotEmpty()) {
            titleV.text = "# $tag"; backV.visibility = View.GONE
            files.filter { tag in Meta.tags(it.path) }.map { Item.File(it) }
        } else if (query.isNotEmpty()) {
            val q = query.lowercase()
            val byName = files.filter { it.path.lowercase().contains(q) }.map { Item.File(it) }
            val hits = textHits.filter { h -> files.any { it.path == h.path } }
            byName + (if (hits.isNotEmpty()) listOf<Item>(Item.Head("Im Text gefunden", "#1E2F6E", 0, null, "")) + hits else emptyList())
        } else if (folder.isEmpty()) {
            val rec = Tabs.recent().mapNotNull { r -> files.find { it.path == r } }.take(5)
            val subs = Store.folders(l).filter { !it.contains('/') }
            (if (rec.isNotEmpty()) listOf<Item>(Item.Head("Zuletzt geöffnet", "#1E2F6E", 0, null, "")) + rec.map { Item.File(it) } + listOf<Item>(Item.Head("Alle PDFs", "#1E2F6E", 0, null, "")) else emptyList()) +
                subs.map { Item.Folder(it) } + files.filter { it.folder == folder }.map { Item.File(it) }
        } else {
            val subs = Store.folders(l).filter { (if (it.contains('/')) it.substringBeforeLast('/') else "") == folder }
            subs.map { Item.Folder(it) } + files.filter { it.folder == folder }.map { Item.File(it) }
        }
        adapter.notifyDataSetChanged()
    }

    private fun goUp() {
        folder = if (folder.contains('/')) folder.substringBeforeLast('/') else ""
        Store.prefs().edit().putString("folder", folder).apply(); render()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (mode == "pdf" && folder.isNotEmpty() && query.isEmpty()) goUp() else @Suppress("DEPRECATION") super.onBackPressed()
    }

    private inner class Adapter : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
        override fun getItemCount() = items.size
        override fun getItemViewType(pos: Int) = if (grid && mode == "pdf" && (items[pos] is Item.File || items[pos] is Item.Folder)) 1 else 0
        override fun onCreateViewHolder(p: ViewGroup, t: Int): RecyclerView.ViewHolder {
            val dp = { v: Float -> Ui.dp(this@MainActivity, v) }
            if (t == 1) {
                val img = android.widget.ImageView(this@MainActivity).apply { scaleType = android.widget.ImageView.ScaleType.FIT_CENTER }
                val ph = Ui.text(this@MainActivity, "", 40f).apply { gravity = Gravity.CENTER }
                val badge = Ui.text(this@MainActivity, "✓", 12f, 0xFFFFFFFF.toInt(), true).apply {
                    gravity = Gravity.CENTER; background = android.graphics.drawable.GradientDrawable().apply { shape = android.graphics.drawable.GradientDrawable.OVAL; setColor(0xFF13804A.toInt()) }
                }
                val box = android.widget.FrameLayout(this@MainActivity).apply {
                    background = Ui.rounded(0xFFF4F6FA.toInt(), dp(10f).toFloat())
                    addView(img, android.widget.FrameLayout.LayoutParams(-1, -1).apply { setMargins(dp(10f), dp(10f), dp(10f), dp(10f)) })
                    addView(ph, android.widget.FrameLayout.LayoutParams(-1, -1))
                    addView(badge, android.widget.FrameLayout.LayoutParams(dp(20f), dp(20f), Gravity.TOP or Gravity.END).apply { setMargins(0, dp(6f), dp(6f), 0) })
                }
                val name = Ui.text(this@MainActivity, "", 14f, Ui.INK, true).apply { maxLines = 2; ellipsize = android.text.TextUtils.TruncateAt.END }
                val sub = Ui.text(this@MainActivity, "", 12f, Ui.MUTED).apply { maxLines = 1 }
                val card = LinearLayout(this@MainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    background = Ui.rounded(0xFFFFFFFF.toInt(), dp(14f).toFloat())
                    setPadding(dp(8f), dp(8f), dp(8f), dp(10f))
                    addView(box, Ui.lp(-1, dp(190f)))
                    addView(name, Ui.lp(-1, -2).apply { topMargin = dp(8f) }); addView(sub)
                    layoutParams = RecyclerView.LayoutParams(-1, -2).apply { setMargins(dp(6f), dp(6f), dp(6f), dp(6f)) }
                }
                card.tag = arrayOf<View>(img, ph, badge, name, sub)
                return object : RecyclerView.ViewHolder(card) {}
            }
            val icon = Ui.text(this@MainActivity, "", 26f).apply { setPadding(0, 0, dp(14f), 0) }
            val name = Ui.text(this@MainActivity, "", 17f, Ui.INK, true)
            val sub = Ui.text(this@MainActivity, "", 13f, Ui.MUTED)
            val col = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL; addView(name); addView(sub) }
            val row = LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                background = Ui.rounded(0xFFFFFFFF.toInt(), dp(12f).toFloat())
                setPadding(dp(16f), dp(12f), dp(16f), dp(12f))
                addView(icon); addView(col, Ui.lp(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                layoutParams = RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(dp(16f), dp(4f), dp(16f), dp(4f)) }
            }
            row.tag = arrayOf(icon, name, sub)
            return object : RecyclerView.ViewHolder(row) {}
        }
        override fun onBindViewHolder(h: RecyclerView.ViewHolder, pos: Int) {
            if (getItemViewType(pos) == 1) { bindCard(h, items[pos]); return }
            @Suppress("UNCHECKED_CAST") val v = h.itemView.tag as Array<TextView>
            h.itemView.background = Ui.rounded(0xFFFFFFFF.toInt(), Ui.dp(this@MainActivity, 12f).toFloat())
            v[1].setTextColor(Ui.INK); v[1].textSize = 17f
            when (val it = items[pos]) {
                is Item.Folder -> {
                    v[0].setTextColor(Ui.INK); (h.itemView.layoutParams as RecyclerView.LayoutParams).leftMargin = Ui.dp(this@MainActivity, 16f)
                    v[0].text = "📁"; v[1].text = it.path.substringAfterLast('/'); v[2].text = "Ordner"
                    h.itemView.setOnClickListener { _ -> folder = it.path; Store.prefs().edit().putString("folder", folder).apply(); render(); list.scrollToPosition(0) }
                }
                is Item.Head -> {
                    if (it.path.isEmpty()) h.itemView.setOnLongClickListener(null)
                    if (it.add == null) {
                        v[0].text = ""; v[1].text = it.text; v[2].text = ""; v[1].setTextColor(Ui.MUTED); v[1].textSize = 14f
                        h.itemView.setOnClickListener(null)
                        h.itemView.background = null
                        (h.itemView.layoutParams as RecyclerView.LayoutParams).leftMargin = Ui.dp(this@MainActivity, 8f)
                    } else if (it.level < 0) {
                        v[0].text = "＋"; v[1].text = it.addLabel; v[2].text = "Notizbücher wie in OneNote: Notizbuch › Abschnitt › Seiten"
                        h.itemView.setOnClickListener { _ -> it.add?.invoke() }
                    } else {
                        v[0].text = if (it.level == 0) "📒" else "▍"
                        try { v[0].setTextColor(android.graphics.Color.parseColor(it.color)) } catch (e: Exception) { }
                        v[1].text = it.text; v[2].text = "${it.addLabel} – hier antippen" + if (it.path.isNotEmpty()) " · lange drücken: ordnen" else ""
                        h.itemView.setOnClickListener { _ -> it.add?.invoke() }
                        h.itemView.setOnLongClickListener(if (it.path.isEmpty()) null else View.OnLongClickListener { _ -> orderMenu(it.path, it.text); true })
                    }
                    (h.itemView.layoutParams as RecyclerView.LayoutParams).leftMargin = Ui.dp(this@MainActivity, 16f + 20f * kotlin.math.max(0, it.level))
                }
                is Item.Hit -> {
                    h.itemView.setOnLongClickListener(null)
                    v[0].text = if (tag == "★") "★" else "🔎"; v[0].setTextColor(if (tag == "★") 0xFFE0A800.toInt() else Ui.INK)
                    v[1].text = it.path.substringAfterLast('/').removeSuffix(".pdf") + " · S. " + (it.page + 1)
                    val sp = android.text.SpannableStringBuilder()
                    var bold = false; var startB = 0
                    for (ch in it.snip) {
                        when (ch) {
                            '\u0001' -> { bold = true; startB = sp.length }
                            '\u0002' -> { if (bold) sp.setSpan(android.text.style.StyleSpan(android.graphics.Typeface.BOLD), startB, sp.length, 0); bold = false }
                            else -> sp.append(ch)
                        }
                    }
                    v[2].text = sp
                    (h.itemView.layoutParams as RecyclerView.LayoutParams).leftMargin = Ui.dp(this@MainActivity, 16f)
                    h.itemView.setOnClickListener { _ ->
                        if (it.path.startsWith("@nb/")) startBoard(it.path, it.path.substringAfterLast('/'))
                        else lib?.let { l -> Store.files(l).find { f -> f.path == it.path } }?.let { f -> open(f, it.page) } ?: Ui.toast(this@MainActivity, "Diese PDF gibt es nicht mehr.")
                    }
                }
                is Item.NewDeck -> {
                    h.itemView.setOnLongClickListener(null)
                    v[0].text = "＋"; v[0].setTextColor(Ui.INK); v[1].text = "Neue Präsentation"
                    v[2].text = "Folien gestalten – auch mit dem Stift skizzieren: „Skizze → Folie“"
                    (h.itemView.layoutParams as RecyclerView.LayoutParams).leftMargin = Ui.dp(this@MainActivity, 16f)
                    h.itemView.setOnClickListener { _ -> newDeck() }
                }
                is Item.Deck -> {
                    h.itemView.setOnLongClickListener(null)
                    v[0].text = "🖥"; v[0].setTextColor(Ui.INK); v[1].text = it.title
                    v[2].text = (if (it.slides == 1) "1 Folie" else "${it.slides} Folien") + " · " + SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.GERMANY).format(Date(it.date * 1000))
                    (h.itemView.layoutParams as RecyclerView.LayoutParams).leftMargin = Ui.dp(this@MainActivity, 16f)
                    h.itemView.setOnClickListener { _ -> startDeck(it.path) }
                }
                is Item.Page -> {
                    v[0].text = "🗒"; v[0].setTextColor(Ui.INK); v[1].text = it.title
                    v[2].text = SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.GERMANY).format(Date(it.date * 1000))
                    (h.itemView.layoutParams as RecyclerView.LayoutParams).leftMargin = Ui.dp(this@MainActivity, 56f + 16f * it.level)
                    h.itemView.setOnClickListener { _ -> startBoard(it.path, it.title) }
                    h.itemView.setOnLongClickListener { _ -> pageMenu(it.path, it.title); true }
                }
                is Item.File -> {
                    val f = it.f
                    v[0].setTextColor(Ui.INK); (h.itemView.layoutParams as RecyclerView.LayoutParams).leftMargin = Ui.dp(this@MainActivity, 16f)
                    v[0].text = "📄"; v[1].text = f.name.removeSuffix(".pdf").removeSuffix(".PDF")
                    val date = SimpleDateFormat("dd.MM.yyyy", Locale.GERMANY).format(Date(f.mtime * 1000))
                    val where = if (Store.isCurrent(f)) " · auf dem Tablet ✓" else if (Store.hasLocal(f.path)) " · auf dem Tablet (ältere Fassung)" else ""
                    val tg = Meta.tags(f.path)
                    v[2].text = (if (query.isNotEmpty() && f.folder.isNotEmpty()) f.folder + " · " else "") + Ui.mb(f.size) + " · " + date + where + (if (tg.isNotEmpty()) " · " + tg.joinToString(" ") { "#$it" } else "")
                    h.itemView.setOnClickListener { _ -> open(f) }
                    h.itemView.setOnLongClickListener { _ -> Tools.editTags(this@MainActivity, f.path) { runOnUiThread { render() } }; true }
                }
            }
        }
    }

    private fun bindCard(h: RecyclerView.ViewHolder, it: Item) {
        @Suppress("UNCHECKED_CAST") val v = h.itemView.tag as Array<View>
        val img = v[0] as android.widget.ImageView; val ph = v[1] as TextView; val badge = v[2]; val name = v[3] as TextView; val sub = v[4] as TextView
        img.setImageDrawable(null); img.tag = null
        when (it) {
            is Item.Folder -> {
                ph.text = "📁"; ph.visibility = View.VISIBLE; badge.visibility = View.GONE
                name.text = it.path.substringAfterLast('/'); sub.text = "Ordner"
                h.itemView.setOnClickListener { _ -> folder = it.path; Store.prefs().edit().putString("folder", folder).apply(); render(); list.scrollToPosition(0) }
            }
            is Item.File -> {
                val f = it.f
                name.text = f.name.removeSuffix(".pdf").removeSuffix(".PDF")
                sub.text = SimpleDateFormat("dd.MM.yyyy", Locale.GERMANY).format(Date(f.mtime * 1000)) + " · " + Ui.mb(f.size)
                badge.visibility = if (Store.isCurrent(f)) View.VISIBLE else View.GONE
                ph.text = "📄"; ph.visibility = View.VISIBLE
                img.tag = f.path
                val b = Thumbs.get(f) { bmp -> if (img.tag == f.path) { img.setImageBitmap(bmp); ph.visibility = View.GONE } }
                if (b != null) { img.setImageBitmap(b); ph.visibility = View.GONE }
                h.itemView.setOnClickListener { _ -> open(f) }
                h.itemView.setOnLongClickListener { _ -> Tools.editTags(this, f.path) { runOnUiThread { render() } }; true }
            }
            else -> {}
        }
    }

    // ---------------------------------------------------------------- Öffnen
    private var openPage = -1
    private fun open(f: LibFile, page: Int = -1) {
        openPage = page
        if (Burn.isBusy(f.path)) {
            val pr = Ui.Progress(this, "Notizen werden in die PDF geschrieben …")
            lifecycleScope.launch {
                while (Burn.isBusy(f.path)) kotlinx.coroutines.delay(300)
                pr.close()
                val now = lib?.let { l -> Store.files(l).find { it.path == f.path } }
                if (Store.hasLocal(f.path)) startViewer(f.path, openPage) else open(now ?: f)
            }
            return
        }
        if (Store.isCurrent(f) || (Store.hasLocal(f.path) && Store.isNewerLocal(f))) { startViewer(f.path, openPage); return }
        val pr = Ui.Progress(this, "„${f.name.removeSuffix(".pdf")}“ wird geladen …")
        lifecycleScope.launch {
            try {
                Api.download(f.path, Store.pdfFile(f.path)) { d, t -> runOnUiThread { pr.set(d, if (t > 0) t else f.size) } }
                Store.markLocal(f.path, f.mtime, f.size)
                pr.close()
                adapter.notifyDataSetChanged()
                startViewer(f.path, openPage)
            } catch (e: Exception) {
                pr.close()
                if (Store.hasLocal(f.path)) { Ui.toast(this@MainActivity, "Offline – die gespeicherte Fassung wird geöffnet."); startViewer(f.path, openPage) }
                else Ui.alert(this@MainActivity, "Laden fehlgeschlagen", e.message ?: "Keine Verbindung.")
            }
        }
    }

    private fun startViewer(path: String, page: Int = -1) = startActivity(Intent(this, ViewerActivity::class.java).putExtra("path", path).putExtra("page", page))

    // ---------------------------------------------------------------- PDF aus anderer App („Öffnen mit“ / „Teilen“)
    private fun handleIntent(i: Intent?) {
        val uri: Uri? = when (i?.action) {
            Intent.ACTION_VIEW -> i.data
            Intent.ACTION_SEND -> @Suppress("DEPRECATION") (i.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri)
            else -> null
        }
        if (uri != null) { i?.action = null; importShared(uri) }
    }

    private fun importShared(uri: Uri) {
        var name = "Dokument.pdf"
        try { contentResolver.query(uri, null, null, null, null)?.use { c -> val n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME); if (n >= 0 && c.moveToFirst()) name = c.getString(n) } } catch (e: Exception) { }
        if (!name.lowercase().endsWith(".pdf")) name += ".pdf"
        val pr = Ui.Progress(this, "„$name“ kommt in den Ordner „Dokumente“ …")
        lifecycleScope.launch {
            try {
                val tmp = File(cacheDir, "eingang.pdf")
                withContext(Dispatchers.IO) { contentResolver.openInputStream(uri)!!.use { inp -> tmp.outputStream().use { inp.copyTo(it) } } }
                val r = Api.upload("Dokumente", name, tmp)
                val saved = r.optJSONArray("saved")?.optString(0) ?: throw Exception("Hochladen fehlgeschlagen")
                val target = Store.pdfFile(saved)
                target.parentFile?.mkdirs(); tmp.copyTo(target, overwrite = true); tmp.delete()
                val j = Api.get("list"); lib = j; Store.saveLibrary(j)
                Store.files(j).find { it.path == saved }?.let { Store.markLocal(saved, it.mtime, it.size) }
                pr.close(); render()
                startViewer(saved)
            } catch (e: Api.ApiError) {
                pr.close()
                if (e.code == 401) { pendingShare = uri; login.launch(Intent(this@MainActivity, LoginActivity::class.java)) }
                else Ui.alert(this@MainActivity, "Nicht übernommen", e.message ?: "")
            } catch (e: Exception) {
                pr.close(); Ui.alert(this@MainActivity, "Nicht übernommen", "Keine Verbindung zum Server. Bitte später noch einmal teilen.")
            }
        }
    }

    // ---------------------------------------------------------------- Menü
    private fun showMenu(anchor: View) {
        val m = PopupMenu(this, anchor)
        m.menu.add(0, 1, 0, "Aktualisieren")
        if (!Api.offline) m.menu.add(0, 2, 1, "Speicher auf dem Tablet")
        if (Updater.enabled) m.menu.add(0, 3, 2, if (Updater.hasUpdate) "App aktualisieren auf ${Updater.latest?.optString("versionName")}" else "App aktualisieren (installiert: ${BuildConfig.VERSION_NAME})")
        if (!Api.offline) m.menu.add(0, 5, 3, (if (Offline.on) "✓ " else "") + "Alle PDFs auf dem Tablet halten")
        m.menu.add(0, 8, 4, "PDF erstellen (Fotos, Word, Excel …) …")
        m.menu.add(0, 9, 4, "PDFs zusammenfügen …")
        m.menu.add(0, 10, 5, "Einstellungen …")
        m.menu.add(0, 11, 5, "Bericht für Verbesserungen …")
        m.menu.add(0, 12, 5, "Kurzanleitung")
        m.menu.add(0, 7, 5, "Fehler melden …")
        if (Edition.FREE) m.menu.add(0, 13, 6, if (Api.offline) "Offline · zu eigenem Server wechseln …" else "Online · Server/Offline wechseln …")
        if (!Api.offline) m.menu.add(0, 4, 6, "Abmelden")
        m.setOnMenuItemClickListener {
            when (it.itemId) {
                1 -> refresh()
                7 -> Report.show(this, "Bibliothek")
                10 -> Settings.dialog(this)
                11 -> Usage.report(this)
                12 -> try { startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(Api.HELP))) } catch (e: Exception) { Ui.toast(this, "Kein Browser gefunden.") }
                8 -> Create.fromDevice(this)
                13 -> Ui.alert(this, "Online oder offline", if (Api.offline) "Ihre PDFs und Notizen auf diesem Tablet bleiben hier liegen. Mit eigenem Server sehen Sie dort zunächst nur, was auf dem Server liegt – PDFs vom Tablet können Sie danach hochladen." else "Beim Wechsel bleiben Ihre Daten auf dem Server. Offline beginnt mit einer leeren Bibliothek auf diesem Tablet.", "Wechseln", "Abbrechen") {
                    lifecycleScope.launch { try { Store.flush() } catch (e: Exception) { }; login.launch(Intent(this@MainActivity, LoginActivity::class.java).putExtra("choose", true)) }
                }
                9 -> Create.merge(this)
                5 -> {
                    Offline.on = !Offline.on
                    if (Offline.on) { Ui.toast(this, "Alle PDFs werden nach und nach im WLAN aufs Tablet geladen (neueste zuerst).", true); Offline.start(this) } else Offline.stop()
                }
                2 -> androidx.appcompat.app.AlertDialog.Builder(this).setTitle("Speicher auf dem Tablet")
                    .setMessage("${Store.localCount()} PDFs liegen auf dem Tablet (${Ui.mb(Store.localBytes())}). Jede PDF wird beim ersten Öffnen geladen und bleibt dann hier; ändert sie sich auf dem Server, holt die App beim nächsten Öffnen die neue Fassung.")
                    .setPositiveButton("OK", null)
                    .setNegativeButton("Alle Kopien entfernen") { _, _ -> Store.removeAllLocal(); render() }
                    .show()
                3 -> lifecycleScope.launch { if (Updater.hasUpdate) Updater.start(this@MainActivity) else Updater.check(this@MainActivity, silent = false) }
                4 -> Ui.alert(this, "Abmelden?", "Notizen, die noch nicht gespeichert sind, werden vorher hochgeladen.", "Abmelden", "Abbrechen") {
                    lifecycleScope.launch {
                        try { Store.flush(); Api.post("logout", JSONObject()) } catch (e: Exception) { }
                        Api.clearCookies()
                        login.launch(Intent(this@MainActivity, LoginActivity::class.java))
                    }
                }
            }
            true
        }
        m.show()
    }

    override fun onResume() {
        super.onResume()
        Store.syncState = { st -> runOnUiThread { statusV.text = when (st) { "saving" -> "Speichert …"; "offline" -> "Offline – wird nachgeholt"; else -> "" } } }
        Meta.onChange = { runOnUiThread { render() } }
        Offline.onProgress = { t -> runOnUiThread { statusV.text = t; if (t.isEmpty()) adapter.notifyDataSetChanged() } }
        Offline.start(this)
        adapter.notifyDataSetChanged(); Updater.resume(this)
        // zurück aus einer Präsentation: Liste (Folienzahl, Reihenfolge) auffrischen
        if (mode == "dk" && !Api.offline) lifecycleScope.launch { try { decks = Api.get("decks").optJSONArray("decks"); render() } catch (e: Exception) { } }
    }
}
