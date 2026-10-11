package io.github.pdfstift

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import org.json.JSONArray
import org.json.JSONObject

/** gemeinsame Einstellungen der Stifte – für PDF und Notizbuch */
interface InkTools {
    var tool: String
    var penColor: String; var hlColor: String; var txColor: String; var txKind: String
    var shColor: String; var shKind: String; var ttColor: String; var ttSize: Float
    var penWi: Int; var hlWi: Int; var shWi: Int; var fingerDraw: Boolean
    fun clearSel()
}

/** Werkzeugleiste wie in der Web-App: Favoriten, Werkzeuge, Farben, Stärken, Arten */
class ToolBar(private val a: Activity, private val t: InkTools, private val board: Boolean) {
    val PALETTE = listOf("#1A1A1A", "#1F4FD6", "#D6262B", "#13804A", "#FF4A1C", "#FFE14D", "#7BE36B", "#FF7AC0", "#7CC7FF", "#A855F7")
    private val DEFAULT_FAVS = """[{"t":"tx","k":"hl","c":"#FF4A1C"},{"t":"tx","k":"hl","c":"#FFE14D"},{"t":"tx","k":"hl","c":"#7CC7FF"},{"t":"tx","k":"ul","c":"#D6262B"},
        {"t":"pen","c":"#1A1A1A","wi":1},{"t":"pen","c":"#1F4FD6","wi":1},{"t":"pen","c":"#D6262B","wi":1},{"t":"hl","c":"#FFE14D","wi":1},{"t":"hl","c":"#7BE36B","wi":1},{"t":"er"}]"""
    private val dp = { v: Float -> Ui.dp(a, v) }
    private val favRow = LinearLayout(a).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    private val toolRow = LinearLayout(a).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    private val ctxRow = LinearLayout(a).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(8f), 0, dp(8f), dp(4f)) }
    private val tools get() = listOf("pen" to "Stift", "hl" to "Marker", "tx" to "Text markieren", "sh" to "Formen", "tt" to "Textfeld", "nt" to "Kommentar", "la" to "Lasso", "er" to "Radierer")
        .filter { !board || (it.first != "tx" && it.first != "nt") }

    /** Lage der Leiste: top | bottom | left | right | float */
    var dock = Store.prefs().getString("tbDock", "top") ?: "top"
    private val vertical get() = dock == "left" || dock == "right"
    private val grip = Glyph(a, "grip", 0, Glyph.TOOL).apply {
        layoutParams = LinearLayout.LayoutParams(dp(30f), dp(40f))
        contentDescription = "Leiste verschieben"
    }
    var view: View = View(a); private set
    private var host: DockHost? = null

    init { load(); setupGrip(); build(); render() }

    private lateinit var flow: Flow

    /** Leiste neu zusammensetzen: alle Elemente fließen in Zeilen bzw. Spalten – nie scrollen */
    private fun build() {
        listOf(grip).forEach { (it.parent as? android.view.ViewGroup)?.removeView(it) }
        // alte Leiste sofort entfernen, sonst bleibt sie an der alten Stelle stehen
        (view.parent as? android.view.ViewGroup)?.removeView(view)
        if (::flow.isInitialized) flow.removeAllViews()
        // alte Leiste vollständig entfernen, sonst bleibt sie an der alten Stelle stehen
        (view.parent as? android.view.ViewGroup)?.removeView(view)
        if (::flow.isInitialized) flow.removeAllViews()
        flow = Flow(a, vertical).apply {
            if (vertical) setPadding(dp(4f), dp(6f), dp(4f), dp(6f)) else setPadding(dp(6f), dp(3f), dp(6f), dp(3f))
        }
        view = flow.apply {
            if (dock == "float") { background = Ui.rounded(Color.WHITE, dp(16f).toFloat(), Ui.LINE, dp(1f)); elevation = dp(10f).toFloat() } else setBackgroundColor(Color.WHITE)
        }
        host?.place(this)
    }

    /** Zeilen-/Spaltenumbruch */
    private fun brk() = View(a).apply { tag = Flow.BREAK; layoutParams = android.view.ViewGroup.MarginLayoutParams(0, 0) }

    /** alle Elemente in die fließende Leiste übernehmen */
    private fun fill() {
        flow.removeAllViews()
        flow.addView(grip)
        for (r in listOf(favRow, toolRow)) moveKids(r)
        flow.addView(brk())
        moveKids(ctxRow)
    }
    private fun moveKids(from: LinearLayout) {
        val kids = (0 until from.childCount).map { from.getChildAt(it) }
        from.removeAllViews()
        for (k in kids) { if (k.tag == "sep") { flow.addView(sep()); continue }; flow.addView(k) }
        if (from === favRow) flow.addView(sep())
    }

    fun attach(h: DockHost) { host = h; h.place(this) }

    private fun changeDock(d: String) {
        dock = d; Store.prefs().edit().putString("tbDock", d).apply()
        build(); render()
    }

    private var dragX = 0f; private var dragY = 0f; private var moved = false
    @android.annotation.SuppressLint("ClickableViewAccessibility")
    private fun setupGrip() {
        grip.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                android.view.MotionEvent.ACTION_DOWN -> { dragX = e.rawX; dragY = e.rawY; moved = false; true }
                android.view.MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - dragX; val dy = e.rawY - dragY
                    if (dock == "float" && (moved || kotlin.math.hypot(dx, dy) > dp(6f))) {
                        moved = true; dragX = e.rawX; dragY = e.rawY
                        host?.moveFloat(view, dx, dy)
                    }
                    true
                }
                android.view.MotionEvent.ACTION_UP -> {
                    if (!moved) chooseDock() else host?.saveFloat(view)
                    true
                }
                else -> true
            }
        }
    }

    private fun chooseDock() {
        val opts = listOf("top" to "Oben", "bottom" to "Unten", "left" to "Links", "right" to "Rechts", "float" to "Als Fenster (frei verschiebbar)")
        AlertDialog.Builder(a).setTitle("Werkzeugleiste")
            .setItems(opts.map { (if (it.first == dock) "✓ " else "") + it.second }.toTypedArray()) { _, i -> changeDock(opts[i].first) }
            .show()
    }

    private fun load() {
        val p = Store.prefs()
        t.tool = p.getString("tool", "pen") ?: "pen"
        if (board && t.tool == "tx") t.tool = "hl"
        t.penColor = p.getString("penColor", "#1A1A1A")!!; t.hlColor = p.getString("hlColor", "#FFE14D")!!
        t.txColor = p.getString("txColor", "#FFE14D")!!; t.txKind = p.getString("txKind", "hl")!!
        t.shColor = p.getString("shColor", "#D6262B")!!; t.shKind = p.getString("shKind", "line")!!
        t.ttColor = p.getString("ttColor", "#1A1A1A")!!; t.ttSize = p.getFloat("ttSize", 14f)
        t.penWi = p.getInt("penWi", 1); t.hlWi = p.getInt("hlWi", 1); t.shWi = p.getInt("shWi", 1)
        t.fingerDraw = p.getBoolean(if (board) "fingerB" else "finger", false)
    }

    private fun save() {
        Store.prefs().edit().putString("tool", t.tool).putString("penColor", t.penColor).putString("hlColor", t.hlColor)
            .putString("txColor", t.txColor).putString("txKind", t.txKind).putString("shColor", t.shColor).putString("shKind", t.shKind)
            .putString("ttColor", t.ttColor).putFloat("ttSize", t.ttSize)
            .putInt("penWi", t.penWi).putInt("hlWi", t.hlWi).putInt("shWi", t.shWi).putBoolean(if (board) "fingerB" else "finger", t.fingerDraw).apply()
    }

    private fun favs(): JSONArray = try { JSONArray(Store.prefs().getString("favs", null) ?: DEFAULT_FAVS) } catch (e: Exception) { JSONArray(DEFAULT_FAVS) }

    private fun favActive(f: JSONObject): Boolean = when (f.optString("t")) {
        "tx" -> if (board) t.tool == "hl" && t.hlColor.equals(f.optString("c"), true) else t.tool == "tx" && t.txKind == f.optString("k") && t.txColor.equals(f.optString("c"), true)
        "pen" -> t.tool == "pen" && t.penColor.equals(f.optString("c"), true) && t.penWi == f.optInt("wi", 1)
        "hl" -> t.tool == "hl" && t.hlColor.equals(f.optString("c"), true) && t.hlWi == f.optInt("wi", 1)
        "er" -> t.tool == "er"
        else -> false
    }

    private fun applyFav(f: JSONObject) {
        when (f.optString("t")) {
            "tx" -> if (board) { t.tool = "hl"; t.hlColor = f.optString("c") } else { t.tool = "tx"; t.txKind = f.optString("k", "hl"); t.txColor = f.optString("c") }
            "pen" -> { t.tool = "pen"; t.penColor = f.optString("c"); t.penWi = f.optInt("wi", 1) }
            "hl" -> { t.tool = "hl"; t.hlColor = f.optString("c"); t.hlWi = f.optInt("wi", 1) }
            "er" -> t.tool = "er"
        }
        save(); render()
    }

    private fun currentFav(): JSONObject? = when (t.tool) {
        "tx" -> JSONObject().put("t", "tx").put("k", t.txKind).put("c", t.txColor)
        "pen" -> JSONObject().put("t", "pen").put("c", t.penColor).put("wi", t.penWi)
        "hl" -> JSONObject().put("t", "hl").put("c", t.hlColor).put("wi", t.hlWi)
        "er" -> JSONObject().put("t", "er")
        else -> null
    }

    fun render() {
        if (t.tool != "la") t.clearSel()
        favRow.removeAllViews()
        val fs = favs()
        for (i in 0 until fs.length()) {
            val f = fs.getJSONObject(i)
            if (board && f.optString("t") == "tx" && f.optString("k") != "hl") continue
            val v = favView(f, favActive(f))
            v.setOnClickListener { applyFav(f) }
            v.setOnLongClickListener {
                AlertDialog.Builder(a).setMessage("Diesen Favoriten entfernen?").setPositiveButton("Entfernen") { _, _ ->
                    val n = JSONArray(); for (j in 0 until fs.length()) if (j != i) n.put(fs.get(j))
                    Store.prefs().edit().putString("favs", n.toString()).apply(); render()
                }.setNegativeButton("Abbrechen", null).show(); true
            }
            favRow.addView(v)
        }
        favRow.addView(iconBtn("+") {
            val c = currentFav() ?: run { Ui.toast(a, "Erst einen Stift, Marker oder Textmarker wählen."); return@iconBtn }
            fs.put(c); Store.prefs().edit().putString("favs", fs.toString()).apply(); render()
        })
        toolRow.removeAllViews()
        for ((k, label) in tools) toolRow.addView(toolBtn(k, label))
        toolRow.addView(sep())
        toolRow.addView(chip("✋ Finger schreibt", t.fingerDraw) { t.fingerDraw = !t.fingerDraw; save(); render() })
        ctxRow.removeAllViews()
        val tool = t.tool
        if (tool == "tx") {
            for ((k, l) in listOf("hl" to "Hervorheben", "ul" to "Unterstreichen", "st" to "Durchstreichen")) ctxRow.addView(chip(l, t.txKind == k) { t.txKind = k; save(); render() })
            ctxRow.addView(sep())
        }
        if (tool == "sh") {
            for ((k, l) in listOf("line" to "Linie", "arrow" to "Pfeil", "rect" to "Rechteck", "oval" to "Kreis")) ctxRow.addView(chip(l, t.shKind == k) { t.shKind = k; save(); render() })
            ctxRow.addView(sep())
        }
        if (tool == "tt") {
            for (sz in listOf(10f, 14f, 20f, 28f)) ctxRow.addView(chip("${sz.toInt()} pt", t.ttSize == sz) { t.ttSize = sz; save(); render() })
            ctxRow.addView(sep())
            ctxRow.addView(hint("Antippen = neues Textfeld, auf Textfeld tippen = ändern")); ctxRow.addView(sep())
        }
        if (tool == "nt") ctxRow.addView(hint("Antippen = neuer Kommentar (Notizzettel), auf einen Zettel tippen = lesen und ändern"))
        if (tool == "la") ctxRow.addView(hint("Einkreisen zum Auswählen, dann ziehen zum Verschieben"))
        if (tool == "er") ctxRow.addView(hint("Über Notizen fahren. Tipp: die Taste am Stift gedrückt halten radiert auch."))
        if (tool in listOf("pen", "hl", "tx", "sh", "tt")) {
            val cur = colorOf(tool)
            for (c in PALETTE) ctxRow.addView(swatch(c, cur.equals(c, true)) { setColor(tool, c); save(); render() })
        }
        if (tool in listOf("pen", "hl", "sh")) {
            ctxRow.addView(sep())
            val wi = when (tool) { "hl" -> t.hlWi; "sh" -> t.shWi; else -> t.penWi }
            for ((i, px) in listOf(6f, 10f, 15f).withIndex()) ctxRow.addView(widthBtn(px, i == wi) {
                when (tool) { "hl" -> t.hlWi = i; "sh" -> t.shWi = i; else -> t.penWi = i }
                save(); render()
            })
        }
        fill()
    }

    private fun colorOf(k: String) = when (k) { "hl" -> t.hlColor; "tx" -> t.txColor; "sh" -> t.shColor; "tt" -> t.ttColor; else -> t.penColor }
    private fun setColor(k: String, c: String) { when (k) { "hl" -> t.hlColor = c; "tx" -> t.txColor = c; "sh" -> t.shColor = c; "tt" -> t.ttColor = c; else -> t.penColor = c } }

    private fun hint(s: String) = Ui.text(a, s, 13f, Ui.MUTED).apply { setPadding(dp(8f), dp(8f), dp(8f), dp(8f)); if (vertical) visibility = View.GONE }

    private fun favView(f: JSONObject, on: Boolean): View {
        val c = try { Color.parseColor(f.optString("c", "#1A1A1A")) } catch (e: Exception) { Color.BLACK }
        val kind = when (f.optString("t")) { "tx" -> if (f.optString("k") == "hl") "tx" else "ul"; "hl" -> "hl"; "er" -> "er"; else -> "pen" }
        return Glyph(a, kind, c, Glyph.FAV).apply {
            this.on = on
            layoutParams = LinearLayout.LayoutParams(dp(30f), dp(46f)).apply { setMargins(dp(1.5f), 0, dp(1.5f), 0) }
        }
    }

    private fun toolBtn(k: String, label: String): View = Glyph(a, k, 0, Glyph.TOOL).apply {
        on = t.tool == k
        contentDescription = label
        layoutParams = LinearLayout.LayoutParams(dp(42f), dp(42f)).apply { setMargins(dp(1f), 0, dp(1f), 0) }
        setOnClickListener { t.tool = k; save(); render(); Ui.toast(a, label) }
    }

    fun chip(s: String, on: Boolean, click: () -> Unit) = Ui.text(a, s, if (vertical) 12f else 14f, if (on) Ui.NAVY else Ui.INK, on).apply {
        setPadding(dp(if (vertical) 6f else 12f), dp(8f), dp(if (vertical) 6f else 12f), dp(8f))
        if (vertical) { maxWidth = dp(84f); gravity = Gravity.CENTER }
        layoutParams = LinearLayout.LayoutParams(-2, -2).apply { setMargins(dp(2f), dp(2f), dp(2f), dp(2f)) }
        background = Ui.rounded(if (on) 0xFFDCE3F5.toInt() else Color.TRANSPARENT, dp(10f).toFloat())
        setOnClickListener { click() }
    }

    fun iconBtn(s: String, click: () -> Unit): View = if (s == "+" || s == "↶" || s == "↷" || s == "cam") Glyph(a, mapOf("+" to "+", "↶" to "undo", "↷" to "redo", "cam" to "cam")[s]!!, 0, Glyph.TOOL).apply {
        layoutParams = LinearLayout.LayoutParams(dp(if (s == "+") 36f else 44f), dp(42f)); if (s == "+") alpha = 0.55f; setOnClickListener { click() }
    } else Ui.text(a, s, 24f, Ui.NAVY, true).apply {
        gravity = Gravity.CENTER
        layoutParams = LinearLayout.LayoutParams(dp(42f), dp(40f))
        setOnClickListener { click() }
    }

    fun swatch(color: String, on: Boolean, click: () -> Unit): View = Glyph(a, "sw", Color.parseColor(color), Glyph.SWATCH).apply {
        this.on = on
        layoutParams = LinearLayout.LayoutParams(dp(34f), dp(34f)).apply { setMargins(dp(1.5f), dp(3f), dp(1.5f), dp(3f)) }
        setOnClickListener { click() }
    }

    private fun widthBtn(px: Float, on: Boolean, click: () -> Unit): View = Glyph(a, "w", 0, Glyph.WIDTH, px / 3.5f).apply {
        this.on = on
        layoutParams = LinearLayout.LayoutParams(dp(40f), dp(36f)).apply { setMargins(dp(1f), 0, dp(1f), 0) }
        setOnClickListener { click() }
    }

    fun sep() = View(a).apply {
        tag = "sep"
        layoutParams = if (vertical) LinearLayout.LayoutParams(dp(30f), dp(1f)).apply { setMargins(0, dp(6f), 0, dp(6f)) }
            else LinearLayout.LayoutParams(dp(1f), dp(26f)).apply { setMargins(dp(8f), 0, dp(8f), 0) }
        setBackgroundColor(Ui.LINE)
    }
}


/**
 * Rahmen um die Seite: Werkzeugleiste oben, unten, links, rechts oder als freies Fenster darüber.
 * center nimmt die PDF- bzw. Tafel-Ansicht auf.
 */
class DockHost(private val a: Activity) {
    private val dp = { v: Float -> Ui.dp(a, v) }
    private val slotTop = FrameLayout(a)
    private val slotBottom = FrameLayout(a)
    private val slotLeft = FrameLayout(a)
    private val slotRight = FrameLayout(a)
    val center = FrameLayout(a)
    private val lineTop = View(a).apply { setBackgroundColor(Ui.LINE) }
    private val lineBottom = View(a).apply { setBackgroundColor(Ui.LINE) }
    private val lineLeft = View(a).apply { setBackgroundColor(Ui.LINE) }
    private val lineRight = View(a).apply { setBackgroundColor(Ui.LINE) }
    val root: LinearLayout = LinearLayout(a).apply {
        orientation = LinearLayout.VERTICAL
        addView(slotTop, Ui.lp(-1, -2)); addView(lineTop, Ui.lp(-1, dp(1f)))
        addView(LinearLayout(a).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(slotLeft, Ui.lp(-2, -1)); addView(lineLeft, Ui.lp(dp(1f), -1))
            addView(center, Ui.lp(0, -1, 1f))
            addView(lineRight, Ui.lp(dp(1f), -1)); addView(slotRight, Ui.lp(-2, -1))
        }, Ui.lp(-1, 0, 1f))
        addView(lineBottom, Ui.lp(-1, dp(1f))); addView(slotBottom, Ui.lp(-1, -2))
    }

    fun place(t: ToolBar) {
        (t.view.parent as? android.view.ViewGroup)?.removeView(t.view)
        val d = t.dock
        lineTop.visibility = if (d == "top") View.VISIBLE else View.GONE
        lineBottom.visibility = if (d == "bottom") View.VISIBLE else View.GONE
        lineLeft.visibility = if (d == "left") View.VISIBLE else View.GONE
        lineRight.visibility = if (d == "right") View.VISIBLE else View.GONE
        when (d) {
            "bottom" -> slotBottom.addView(t.view, FrameLayout.LayoutParams(-1, -2))
            "left" -> slotLeft.addView(t.view, FrameLayout.LayoutParams(-2, -1))
            "right" -> slotRight.addView(t.view, FrameLayout.LayoutParams(-2, -1))
            "float" -> {
                center.addView(t.view, FrameLayout.LayoutParams(-2, -2).apply { setMargins(dp(8f), dp(8f), dp(8f), dp(8f)) })
                t.view.translationX = Store.prefs().getFloat("tbFx", 0f)
                t.view.translationY = Store.prefs().getFloat("tbFy", 0f)
                t.view.post { clampFloat(t.view) }
            }
            else -> slotTop.addView(t.view, FrameLayout.LayoutParams(-1, -2))
        }
    }

    fun moveFloat(v: View, dx: Float, dy: Float) { v.translationX += dx; v.translationY += dy; clampFloat(v) }
    private fun clampFloat(v: View) {
        val maxX = (center.width - v.width - dp(16f)).toFloat().coerceAtLeast(0f)
        val maxY = (center.height - v.height - dp(16f)).toFloat().coerceAtLeast(0f)
        v.translationX = v.translationX.coerceIn(0f, maxX); v.translationY = v.translationY.coerceIn(0f, maxY)
    }
    fun saveFloat(v: View) { Store.prefs().edit().putFloat("tbFx", v.translationX).putFloat("tbFy", v.translationY).apply() }
}
