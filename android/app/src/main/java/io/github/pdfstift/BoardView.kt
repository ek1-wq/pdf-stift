package io.github.pdfstift

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.os.Build
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.widget.OverScroller
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Notizbuch-Seite: unendliche Tafel wie Endless Paper – beliebig weit verschieben und zoomen.
 * Gleiches Datenformat wie die Web-App: jeder Strich hat einen Ursprung o (Welt) und den Zoom z beim Zeichnen;
 * seine Punkte sind Bildschirm-Pixel (CSS-Pixel) relativ zu o. So bleibt auch bei extremem Zoom jede Feinheit erhalten.
 */
@SuppressLint("ViewConstructor")
class BoardView(ctx: Context) : View(ctx), InkTools {
    var path = ""
    private val dens = resources.displayMetrics.density
    // Kamera: Welt-Punkt oben links und Maßstab (CSS-Pixel je Welteinheit)
    var camX = -40.0; var camY = -40.0; var camS = 1.0
    var bg = "dots"
    var doc: NoteDoc? = null; private set
    private val docListener: () -> Unit = { sorted = null; invalidate(); onInkChanged() }
    private var sorted: List<JSONObject>? = null

    override var tool = "pen"
    override var penColor = "#1A1A1A"; override var hlColor = "#FFE14D"; override var txColor = "#FFE14D"; override var txKind = "hl"
    override var shColor = "#D6262B"; override var shKind = "line"; override var ttColor = "#1A1A1A"; override var ttSize = 14f
    override var penWi = 1; override var hlWi = 1; override var shWi = 1; override var fingerDraw = false
    var onInkChanged: () -> Unit = {}
    var onTextRequest: (wx: Double, wy: Double, existing: JSONObject?) -> Unit = { _, _, _ -> }
    var onSelChanged: (Int) -> Unit = {}
    var overlay: InkOverlay? = null
    /** Nächster Antipp setzt diese Notiz (Textbaustein oder Folienmarke) an die Stelle */
    var placeNext: JSONObject? = null
    var onPlaced: (JSONObject) -> Unit = {}
    /** Antippen einer Verknüpfung (übernommene Folie, ↗-Notiz) */
    var onLink: (JSONObject) -> Unit = {}
    private val chips = ArrayList<Pair<RectF, JSONObject>>()
    private val chipBg = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(215, 30, 79, 184) }
    private val chipTx = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; typeface = android.graphics.Typeface.DEFAULT_BOLD }
    private val frame = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = Color.rgb(201, 206, 216); strokeWidth = 1f }
    private val hitFill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(51, 255, 214, 0) }
    private val hitLine = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = Color.rgb(240, 140, 0) }
    /** Suchtreffer auf der Notizseite */
    var hits: List<JSONObject> = emptyList(); var hitIdx = -1
    var linkName: (JSONObject) -> String = { "" }

    private val BOARD_PEN = floatArrayOf(1.4f, 2.4f, 4.2f)
    private val BOARD_HL = floatArrayOf(14f, 22f, 34f)

    private class Act(val added: List<JSONObject>, val removed: List<JSONObject>)
    private val undoStack = ArrayList<Act>()
    private val redoStack = ArrayList<Act>()
    val canUndo get() = undoStack.isNotEmpty()
    val canRedo get() = redoStack.isNotEmpty()

    private class Cur(val mode: String, val sx0: Float, val sy0: Float, val st: JSONObject?) {
        var fast = false
        var hold: Runnable? = null; var hx = 0f; var hy = 0f; var straight = false; var fixed = false
        val pts = ArrayList<Float>()
        val live = Path()
        val removed = ArrayList<JSONObject>()
        var ex = 0f; var ey = 0f
        val lasso = ArrayList<Float>()
        var hmode = "move"
        var box: RectF? = null
    }
    private var cur: Cur? = null
    private var penDown = false
    private var lastPenUp = 0L
    private val ids = HashSet<String>()
    private var selIds: MutableSet<String>? = null
    private val scroller = OverScroller(ctx)

    fun open(p: String) {
        doc?.listeners?.remove(docListener)
        path = p
        doc = Store.doc(p).also { it.listeners.add(docListener) }
        sorted = null
        val cam = Store.prefs().getString("cam:$p", null)?.split("|")
        if (cam != null && cam.size == 3) { camX = cam[0].toDouble(); camY = cam[1].toDouble(); camS = cam[2].toDouble() } else post { fit() }
        invalidate()
    }
    fun saveCam() { Store.prefs().edit().putString("cam:$path", "$camX|$camY|$camS").apply() }
    fun close() { doc?.listeners?.remove(docListener); doc = null }

    // ---------------------------------------------------------------- Umrechnung
    private fun css(px: Float) = px / dens
    fun toWorldX(sx: Float) = camX + css(sx) / camS
    fun toWorldY(sy: Float) = camY + css(sy) / camS
    private fun so(s: JSONObject): DoubleArray {
        val o = s.optJSONArray("o")
        return if (o != null && o.length() == 2) doubleArrayOf(o.optDouble(0), o.optDouble(1), s.optDouble("z", 1.0)) else doubleArrayOf(0.0, 0.0, 1.0)
    }
    private fun worldBox(s: JSONObject): DoubleArray {
        val (ox, oy, z) = so(s).let { Triple(it[0], it[1], it[2]) }
        val b = Ink.bounds(s)
        return doubleArrayOf(ox + b.left / z, oy + b.top / z, ox + b.right / z, oy + b.bottom / z)
    }

    private fun sx(wx: Double) = ((wx - camX) * camS).toFloat() * dens
    private fun sy(wy: Double) = ((wy - camY) * camS).toFloat() * dens

    private fun strokes(): List<JSONObject> = sorted ?: (doc?.strokes?.values?.sortedBy { if (it.optString("t") == "img") -1 else Ink.rank(it) } ?: emptyList()).also { sorted = it }

    fun fit() {
        val list = strokes()
        if (list.isEmpty() || width == 0) { camX = -40.0; camY = -40.0; camS = 1.0; invalidate(); return }
        var x0 = Double.MAX_VALUE; var y0 = Double.MAX_VALUE; var x1 = -Double.MAX_VALUE; var y1 = -Double.MAX_VALUE
        for (s in list) { val b = worldBox(s); x0 = min(x0, b[0]); y0 = min(y0, b[1]); x1 = max(x1, b[2]); y1 = max(y1, b[3]) }
        val w = css(width.toFloat()).toDouble(); val h = css(height.toFloat()).toDouble()
        camS = min(min((w - 60) / max(1e-9, x1 - x0), (h - 60) / max(1e-9, y1 - y0)), 4.0).coerceIn(1e-4, 1e5)
        camX = (x0 + x1) / 2 - w / 2 / camS; camY = (y0 + y1) / 2 - h / 2 / camS
        invalidate()
    }

    // ---------------------------------------------------------------- Zeichnen
    private val dotPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val linePaint = Paint().apply { strokeWidth = 1f }
    private val livePen = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
    private val selPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = Ui.NAVY; strokeWidth = 1.5f * dens; pathEffect = DashPathEffect(floatArrayOf(6 * dens, 4 * dens), 0f) }

    override fun onDraw(c: Canvas) {
        c.drawColor(Color.WHITE)
        drawBg(c)
        val vw = css(width.toFloat()) / camS; val vh = css(height.toFloat()) / camS
        val sel = selIds
        val dc = cur?.takeIf { it.mode == "drag" }
        val xf = if (dc != null) curXf(dc) else null
        for (s in strokes()) {
            val wb = worldBox(s)
            if (wb[2] < camX || wb[0] > camX + vw || wb[3] < camY || wb[1] > camY + vh) continue
            if ((wb[2] - wb[0]) * camS < 0.35 && (wb[3] - wb[1]) * camS < 0.35) continue
            val o = so(s)
            val k = (camS / o[2]).toFloat() * dens
            c.save()
            if (xf != null && sel != null && s.optString("id") in sel) xf.apply(c)
            c.translate(((o[0] - camX) * camS).toFloat() * dens, ((o[1] - camY) * camS).toFloat() * dens)
            c.scale(k, k)
            Ink.draw(c, s)
            if (s.has("ln") && s.optString("t") == "img") { frame.strokeWidth = 1f / k; Ink.bounds(s).let { b -> c.drawRect(b, frame) } }
            c.restore()
        }
        // Suchtreffer
        hits.forEachIndexed { i, s ->
            val b = worldBox(s); val r = RectF(sx(b[0]) - 4 * dens, sy(b[1]) - 4 * dens, sx(b[2]) + 4 * dens, sy(b[3]) + 4 * dens)
            hitLine.strokeWidth = (if (i == hitIdx) 2.5f else 1.2f) * dens
            if (s.optString("t") != "img") c.drawRect(r, hitFill)
            c.drawRect(r, hitLine)
        }
        // antippbare Verknüpfungen
        chips.clear()
        for (s in strokes()) {
            val ln = s.optJSONObject("ln") ?: continue
            val b = worldBox(s)
            if (b[2] < camX || b[0] > camX + vw || b[3] < camY || b[1] > camY + vh) continue
            val img = s.optString("t") == "img"
            val label = if (img) "↗ " + linkName(ln) else "↗"
            chipTx.textSize = 12f * dens
            val w = chipTx.measureText(label) + 16 * dens; val h = 24 * dens
            val r = if (img) RectF(sx(b[2]) - 6 * dens - w, sy(b[1]) + 6 * dens, sx(b[2]) - 6 * dens, sy(b[1]) + 6 * dens + h)
                    else RectF(sx(b[2]) + 3 * dens, sy(b[1]) - 4 * dens, sx(b[2]) + 3 * dens + w, sy(b[1]) - 4 * dens + h)
            if (img && r.width() > (sx(b[2]) - sx(b[0])) * 0.9f) continue
            c.drawRoundRect(r, 6 * dens, 6 * dens, chipBg)
            c.drawText(label, r.left + 8 * dens, r.centerY() + chipTx.textSize * 0.36f, chipTx)
            chips.add(r to ln)
        }
        val cu = cur
        if (cu != null) {
            when (cu.mode) {
                "ink" -> if (!cu.fast) {
                    val st = cu.st!!
                    livePen.color = Color.parseColor(st.optString("c")); livePen.strokeWidth = st.optDouble("w").toFloat() * dens
                    livePen.alpha = if (st.optString("t") == "hl") 102 else 255
                    c.save(); c.translate(cu.sx0, cu.sy0); c.scale(dens, dens); c.drawPath(cu.live, livePen.apply { strokeWidth = st.optDouble("w").toFloat() }); c.restore()
                }
                "sh" -> {
                    val st = cu.st!!
                    livePen.color = Color.parseColor(st.optString("c")); livePen.alpha = 255
                    val w = st.optDouble("w").toFloat()
                    c.save(); c.translate(cu.sx0, cu.sy0); c.scale(dens, dens)
                    livePen.strokeWidth = w
                    for (line in Ink.shapeLines(st.optString("k"), floatArrayOf(0f, 0f, css(cu.ex - cu.sx0), css(cu.ey - cu.sy0)), w)) {
                        val pth = Path(); line.forEachIndexed { j, q -> if (j == 0) pth.moveTo(q[0], q[1]) else pth.lineTo(q[0], q[1]) }
                        c.drawPath(pth, livePen)
                    }
                    c.restore()
                }
                "lasso" -> if (cu.lasso.size >= 4) {
                    val pth = Path(); pth.moveTo(cu.lasso[0], cu.lasso[1])
                    var j = 2; while (j + 1 < cu.lasso.size) { pth.lineTo(cu.lasso[j], cu.lasso[j + 1]); j += 2 }
                    c.drawPath(pth, selPaint)
                }
            }
        }
        if (sel != null) (dc?.box ?: selScreenRect())?.let { r -> SelUi.draw(c, r, dens, xf) }
    }

    private fun drawBg(c: Canvas) {
        if (bg == "plain") return
        var sp = 24.0
        while (sp * camS < 14) sp *= 4
        while (sp * camS > 56) sp /= 4
        val w = css(width.toFloat()); val h = css(height.toFloat())
        val x0 = floor(camX / sp).toLong(); val y0 = floor(camY / sp).toLong()
        val x1 = Math.ceil((camX + w / camS) / sp).toLong(); val y1 = Math.ceil((camY + h / camS) / sp).toLong()
        if ((x1 - x0) * (y1 - y0) > 40000) return
        val fade = min(1.0, (sp * camS - 14) / 20)
        if (bg == "dots") {
            for (ix in x0..x1) for (iy in y0..y1) {
                val major = Math.floorMod(ix, 4L) == 0L && Math.floorMod(iy, 4L) == 0L
                dotPaint.color = if (major) Color.argb(87, 30, 47, 110) else Color.argb((51 * fade).toInt().coerceIn(0, 255), 30, 47, 110)
                val sx = ((ix * sp - camX) * camS).toFloat() * dens; val sy = ((iy * sp - camY) * camS).toFloat() * dens
                val r = (if (major) 1.6f else 1.1f) * dens / 2
                c.drawRect(sx - r, sy - r, sx + r, sy + r, dotPaint)
            }
            return
        }
        for (iy in y0..y1) {
            val major = Math.floorMod(iy, 4L) == 0L
            linePaint.color = if (bg == "lines") Color.argb(56, 31, 79, 214) else if (major) Color.argb(56, 30, 47, 110) else Color.argb((26 * fade).toInt().coerceIn(0, 255), 30, 47, 110)
            val sy = ((iy * sp - camY) * camS).toFloat() * dens
            c.drawLine(0f, sy, width.toFloat(), sy, linePaint)
        }
        if (bg == "grid") for (ix in x0..x1) {
            val major = Math.floorMod(ix, 4L) == 0L
            linePaint.color = if (major) Color.argb(56, 30, 47, 110) else Color.argb((26 * fade).toInt().coerceIn(0, 255), 30, 47, 110)
            val sx = ((ix * sp - camX) * camS).toFloat() * dens
            c.drawLine(sx, 0f, sx, height.toFloat(), linePaint)
        }
    }

    // ---------------------------------------------------------------- Gesten (Finger: verschieben/zoomen)
    private val scaleDet = ScaleGestureDetector(ctx, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(d: ScaleGestureDetector): Boolean { zoomAt(camS * d.scaleFactor, d.focusX, d.focusY); return true }
    }).apply { isQuickScaleEnabled = false }
    private val gestDet = GestureDetector(ctx, object : GestureDetector.SimpleOnGestureListener() {
        override fun onDown(e: MotionEvent): Boolean { scroller.forceFinished(true); return true }
        override fun onScroll(e1: MotionEvent?, e2: MotionEvent, dx: Float, dy: Float): Boolean {
            camX += css(dx) / camS; camY += css(dy) / camS; invalidate(); return true
        }
        override fun onFling(e1: MotionEvent?, e2: MotionEvent, vx: Float, vy: Float): Boolean {
            scroller.fling(0, 0, -vx.roundToInt(), -vy.roundToInt(), Int.MIN_VALUE / 2, Int.MAX_VALUE / 2, Int.MIN_VALUE / 2, Int.MAX_VALUE / 2)
            lastFx = 0; lastFy = 0; postInvalidateOnAnimation(); return true
        }
        override fun onDoubleTap(e: MotionEvent): Boolean { fit(); return true }
    })
    private var lastFx = 0; private var lastFy = 0
    override fun computeScroll() {
        if (scroller.computeScrollOffset()) {
            val dx = scroller.currX - lastFx; val dy = scroller.currY - lastFy
            lastFx = scroller.currX; lastFy = scroller.currY
            camX += css(dx.toFloat()) / camS; camY += css(dy.toFloat()) / camS
            postInvalidateOnAnimation()
        }
    }
    fun zoomAt(ns: Double, fx: Float, fy: Float) {
        val s = ns.coerceIn(1e-4, 1e5)
        val wx = toWorldX(fx); val wy = toWorldY(fy)
        camS = s
        camX = wx - css(fx) / s; camY = wy - css(fy) / s
        invalidate()
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(ev: MotionEvent): Boolean {
        val tt = ev.getToolType(ev.actionIndex)
        val isPen = tt == MotionEvent.TOOL_TYPE_STYLUS || tt == MotionEvent.TOOL_TYPE_ERASER
        val isMouse = tt == MotionEvent.TOOL_TYPE_MOUSE
        if (ev.actionMasked == MotionEvent.ACTION_DOWN) {
            chips.firstOrNull { it.first.contains(ev.x, ev.y) }?.let { onLink(it.second); swallow = true; return true }
            placeNext?.let { tpl -> place(tpl, ev.x, ev.y); swallow = true; return true }
            swallow = false
        }
        if (swallow) { if (ev.actionMasked == MotionEvent.ACTION_UP || ev.actionMasked == MotionEvent.ACTION_CANCEL) swallow = false; return true }
        when (ev.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                val draws = isPen || (isMouse && (ev.buttonState and MotionEvent.BUTTON_PRIMARY) != 0) || (fingerDraw && tt == MotionEvent.TOOL_TYPE_FINGER) ||
                    (tool == "la" && selHit(ev.x, ev.y) != null)
                if (!isPen && !isMouse && (penDown || System.currentTimeMillis() - lastPenUp < 250)) return true
                if (draws) {
                    if (isPen && Build.VERSION.SDK_INT >= 30) requestUnbufferedDispatch(ev)
                    if (isPen) penDown = true
                    start(ev, tt); return true
                }
            }
            MotionEvent.ACTION_POINTER_DOWN -> { if (penDown) return true; if (cur != null && !isPen) { cur = null; invalidate() } }
        }
        if (cur != null) {
            when (ev.actionMasked) {
                MotionEvent.ACTION_MOVE -> move(ev)
                MotionEvent.ACTION_UP -> { end(); if (isPen) { penDown = false; lastPenUp = System.currentTimeMillis() } }
                MotionEvent.ACTION_CANCEL -> { cur = null; penDown = false; invalidate() }
            }
            return true
        }
        if (penDown) { if (ev.actionMasked == MotionEvent.ACTION_UP || ev.actionMasked == MotionEvent.ACTION_CANCEL) { penDown = false; lastPenUp = System.currentTimeMillis() }; return true }
        if (isPen) return true
        scaleDet.onTouchEvent(ev)
        if (!scaleDet.isInProgress) gestDet.onTouchEvent(ev)
        return true
    }

    private fun r2(v: Float) = (v * 100).roundToInt() / 100.0
    private var swallow = false

    /** Textbaustein / Folienmarke an der Stelle setzen (Größe wie auf dem Bildschirm) */
    private fun place(tpl: JSONObject, x: Float, y: Float) {
        placeNext = null
        val s = JSONObject(tpl.toString()).put("id", Store.uid()).put("p", 0).put("pts", JSONArray(listOf(0.0, 0.0)))
        val bw = s.optDouble("bw"); val bh = s.optDouble("bh")
        val center = s.has("mk")
        s.put("o", JSONArray(listOf(toWorldX(x) - (if (center) bw / 2 / camS else 0.0), toWorldY(y) - bh / 2 / camS))).put("z", camS)
        Store.addStrokes(path, listOf(s)); push(Act(listOf(s), emptyList())); invalidate()
        onPlaced(s)
    }

    /** Mehrere fertige Notizen hinzufügen (Vorlage, eingefügte Folien) – ein Schritt zum Rückgängigmachen */
    fun addAll(list: List<JSONObject>) { if (list.isEmpty()) return; Store.addStrokes(path, list); push(Act(list, emptyList())); invalidate() }

    /** Rechteck aller Inhalte (Welt) oder null */
    fun contentBox(): DoubleArray? {
        val list = strokes(); if (list.isEmpty()) return null
        val r = doubleArrayOf(Double.MAX_VALUE, Double.MAX_VALUE, -Double.MAX_VALUE, -Double.MAX_VALUE)
        for (s in list) { val b = worldBox(s); r[0] = min(r[0], b[0]); r[1] = min(r[1], b[1]); r[2] = max(r[2], b[2]); r[3] = max(r[3], b[3]) }
        return r
    }
    fun worldBoxOf(s: JSONObject) = worldBox(s)

    /** Ansicht auf einen Bereich richten (Welt), Breite höchstens 80 % */
    fun focusBox(b: DoubleArray, maxS: Double = 1.2) {
        val w = css(width.toFloat()).toDouble(); val h = css(height.toFloat()).toDouble()
        val fit = min((w * 0.8) / max(1.0, b[2] - b[0]), (h * 0.8) / max(1.0, b[3] - b[1]))
        if (camS > fit || camS < fit * 0.25) camS = min(maxS, fit).coerceIn(1e-4, 1e5)
        camX = (b[0] + b[2]) / 2 - w / 2 / camS; camY = (b[1] + b[3]) / 2 - h / 2 / camS
        invalidate()
    }
    fun showTop(x: Double, y: Double, worldW: Double) {
        val w = css(width.toFloat()).toDouble()
        camS = min(1.2, (w - 60) / worldW).coerceIn(1e-4, 1e5); camX = x - 30 / camS; camY = y - 30 / camS; invalidate()
    }
    fun allStrokes(): List<JSONObject> = strokes()

    private fun start(ev: MotionEvent, tt: Int) {
        val btn = (ev.buttonState and (MotionEvent.BUTTON_STYLUS_PRIMARY or MotionEvent.BUTTON_SECONDARY)) != 0
        val erase = tool == "er" || tt == MotionEvent.TOOL_TYPE_ERASER || btn
        val x = ev.x; val y = ev.y
        val wx = toWorldX(x); val wy = toWorldY(y)
        val c: Cur = when {
            erase -> Cur("erase", x, y, null)
            tool == "tt" -> Cur("tap", x, y, null)
            tool == "la" -> {
                val h = selHit(x, y)
                if (h != null) Cur("drag", x, y, null).also { it.hmode = h; it.box = selScreenRect() }
                else { clearSel(); Cur("lasso", x, y, null).also { it.lasso.add(x); it.lasso.add(y) } }
            }
            tool == "sh" -> Cur("sh", x, y, JSONObject().put("id", Store.uid()).put("p", 0).put("t", "sh").put("k", shKind).put("c", shColor).put("w", BOARD_PEN[shWi].toDouble()))
            else -> {
                val hl = tool == "hl" || tool == "tx"
                Cur("ink", x, y, JSONObject().put("id", Store.uid()).put("p", 0).put("t", if (hl) "hl" else "pen").put("c", if (hl) hlColor else penColor)
                    .put("w", (if (hl) BOARD_HL[hlWi] else BOARD_PEN[penWi]).toDouble()))
            }
        }
        c.st?.put("o", JSONArray(listOf(wx, wy)))?.put("z", camS)
        c.ex = x; c.ey = y; c.hx = x; c.hy = y
        cur = c
        if (c.mode == "ink") {
            c.pts.addAll(listOf(0f, 0f, pr(ev.pressure, tt))); c.live.moveTo(0f, 0f)
            c.fast = c.st?.optString("t") == "pen" && tt == MotionEvent.TOOL_TYPE_STYLUS && overlay?.ready == true
        }
        if (c.mode == "erase") eraseAt(x, y, c)
        invalidate()
    }

    private fun pr(p: Float, tt: Int) = if (tt == MotionEvent.TOOL_TYPE_STYLUS) (p.coerceIn(0.05f, 1f) * 100).roundToInt() / 100f else 0.5f

    private fun move(ev: MotionEvent) {
        val c = cur ?: return
        val tt = ev.getToolType(0)
        if (c.mode == "ink") {
            if (c.fixed) return
            if (c.straight) {
                val sn = Shapes.snapLine(0f, 0f, css(ev.x - c.sx0), css(ev.y - c.sy0))
                c.pts.clear(); c.pts.addAll(listOf(0f, 0f, 0.5f, sn[0], sn[1], 0.5f)); liveFrom(c); invalidate(); return
            }
            if (hypot(ev.x - c.hx, ev.y - c.hy) > 4 * dens) {
                c.hx = ev.x; c.hy = ev.y
                c.hold?.let { removeCallbacks(it) }
                val r = Runnable { straighten(c) }
                c.hold = r; postDelayed(r, 450)
            }
        }
        val n = ev.historySize
        for (h in 0..n) {
            val x = if (h < n) ev.getHistoricalX(h) else ev.x
            val y = if (h < n) ev.getHistoricalY(h) else ev.y
            val p = if (h < n) ev.getHistoricalPressure(h) else ev.pressure
            when (c.mode) {
                "ink" -> {
                    val px = (css(x - c.sx0) * 100).roundToInt() / 100f; val py = (css(y - c.sy0) * 100).roundToInt() / 100f
                    val m = c.pts.size
                    if ((px - c.pts[m - 3]) * (px - c.pts[m - 3]) + (py - c.pts[m - 2]) * (py - c.pts[m - 2]) < 0.04f) continue
                    val ax = c.pts[m - 3]; val ay = c.pts[m - 2]
                    c.pts.add(px); c.pts.add(py); c.pts.add(pr(p, tt))
                    c.live.quadTo(ax, ay, (ax + px) / 2, (ay + py) / 2)
                    if (c.fast) {
                        val k = c.pts.size
                        val bx = if (k >= 9) (c.pts[k - 9] + ax) / 2 else ax; val by = if (k >= 9) (c.pts[k - 8] + ay) / 2 else ay
                        val prr = (c.pts[k - 4] + c.pts[k - 1]) / 2
                        val st = c.st!!
                        val wpx = maxOf(0.5f, st.optDouble("w").toFloat() * (0.6f + 0.8f * prr)) * dens
                        val col = try { Color.parseColor(st.optString("c")) } catch (e: Exception) { Color.BLACK }
                        overlay?.seg(InkOverlay.Seg(c.sx0 + bx * dens, c.sy0 + by * dens, c.sx0 + ax * dens, c.sy0 + ay * dens, c.sx0 + (ax + px) / 2 * dens, c.sy0 + (ay + py) / 2 * dens, wpx, col))
                    }
                }
                "erase" -> eraseAt(x, y, c)
                "lasso" -> { c.lasso.add(x); c.lasso.add(y) }
            }
            c.ex = x; c.ey = y
        }
        invalidate()
    }

    // Stift am Ende kurz ruhig halten: Kreis/Rechteck oder gerade Linie (wie in PDFs)
    private fun straighten(c: Cur) {
        if (cur !== c || c.mode != "ink" || c.straight || c.fixed || c.pts.size < 9) return
        val form = Shapes.shapeOf(c.pts)
        val n = c.pts.size
        if (form != null) { c.fixed = true; c.pts.clear(); c.pts.addAll(form) }
        else {
            if (hypot(c.pts[n - 3] - c.pts[0], c.pts[n - 2] - c.pts[1]) * dens < 16 * dens) return
            c.straight = true
            val sn = Shapes.snapLine(0f, 0f, c.pts[n - 3], c.pts[n - 2])
            c.pts.clear(); c.pts.addAll(listOf(0f, 0f, 0.5f, sn[0], sn[1], 0.5f))
        }
        if (c.fast) { overlay?.cancel(); c.fast = false }
        liveFrom(c)
        performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY)
        invalidate()
    }
    private fun liveFrom(c: Cur) {
        c.live.reset()
        val p = c.pts
        if (p.size < 3) return
        c.live.moveTo(p[0], p[1])
        if (p.size == 6) { c.live.lineTo(p[3], p[4]); return }
        var i = 3
        while (i < p.size) { val ax = p[i - 3]; val ay = p[i - 2]; c.live.quadTo(ax, ay, (ax + p[i]) / 2, (ay + p[i + 1]) / 2); i += 3 }
        c.live.lineTo(p[p.size - 3], p[p.size - 2])
    }

    private fun eraseAt(x: Float, y: Float, c: Cur) {
        val d = doc ?: return
        val wx = toWorldX(x); val wy = toWorldY(y)
        val hit = ArrayList<JSONObject>()
        for (s in d.strokes.values) {
            val o = so(s)
            val lx = ((wx - o[0]) * o[2]).toFloat(); val ly = ((wy - o[1]) * o[2]).toFloat()
            val rad = (12.0 * o[2] / camS).toFloat()
            if (Ink.hits(s, lx, ly, rad)) hit.add(s)
        }
        if (hit.isEmpty()) return
        c.removed.addAll(hit)
        Store.deleteStrokes(path, hit.map { it.getString("id") })
    }

    private fun end() {
        val c = cur ?: return
        cur = null
        c.hold?.let { removeCallbacks(it) }
        if (c.fast) post { overlay?.done() }
        when (c.mode) {
            "ink" -> {
                val st = c.st!!
                if (c.pts.size == 3) { c.pts.add(0.01f); c.pts.add(0f); c.pts.add(c.pts[2]) }
                st.put("pts", JSONArray(c.pts.map { it.toDouble() }))
                Store.addStrokes(path, listOf(st)); push(Act(listOf(st), emptyList()))
            }
            "sh" -> {
                val st = c.st!!
                val dx = css(c.ex - c.sx0); val dy = css(c.ey - c.sy0)
                if (hypot(dx, dy) >= 6) { st.put("pts", JSONArray(listOf(0.0, 0.0, r2(dx), r2(dy)))); Store.addStrokes(path, listOf(st)); push(Act(listOf(st), emptyList())) }
            }
            "erase" -> if (c.removed.isNotEmpty()) push(Act(emptyList(), c.removed.toList()))
            "tap" -> if (hypot(c.ex - c.sx0, c.ey - c.sy0) < 12 * dens) {
                val wx = toWorldX(c.sx0); val wy = toWorldY(c.sy0)
                val hit = strokes().lastOrNull { it.optString("t") == "txt" && worldBox(it).let { b -> wx >= b[0] - 4 / camS && wx <= b[2] + 4 / camS && wy >= b[1] - 4 / camS && wy <= b[3] + 4 / camS } }
                onTextRequest(wx, wy, hit)
            }
            "lasso" -> {
                val poly = c.lasso
                val found = HashSet<String>()
                var x0 = Float.MAX_VALUE; var x1 = -Float.MAX_VALUE; var y0 = Float.MAX_VALUE; var y1 = -Float.MAX_VALUE
                var q = 0; while (q + 1 < poly.size) { x0 = min(x0, poly[q]); x1 = max(x1, poly[q]); y0 = min(y0, poly[q + 1]); y1 = max(y1, poly[q + 1]); q += 2 }
                if (x1 - x0 + y1 - y0 < 14 * dens) {
                    // kurz getippt: Bild oder Textfeld darunter auswählen
                    val wx = toWorldX(c.sx0); val wy = toWorldY(c.sy0)
                    strokes().lastOrNull { (it.optString("t") == "img" || it.optString("t") == "txt") && worldBox(it).let { b -> wx >= b[0] && wx <= b[2] && wy >= b[1] && wy <= b[3] } }?.let { found.add(it.getString("id")) }
                } else if (poly.size >= 6) for (s in strokes()) {
                    val b = worldBox(s)
                    val sx = (((b[0] + b[2]) / 2 - camX) * camS).toFloat() * dens; val sy = (((b[1] + b[3]) / 2 - camY) * camS).toFloat() * dens
                    if (inPoly(sx, sy, poly)) found.add(s.getString("id"))
                }
                selIds = if (found.isEmpty()) null else found
                onSelChanged(found.size)
            }
            "drag" -> {
                val sel = selIds; val d = doc
                val xf = curXf(c)
                if (sel != null && d != null && xf != null && !xf.none && !(xf.kind == "move" && hypot(xf.dx, xf.dy) < 2)) {
                    val olds = sel.mapNotNull { d.strokes[it] }
                    val wx = toWorldX(xf.ax); val wy = toWorldY(xf.ay)
                    val moved = olds.map { s ->
                        val o = so(s)
                        when (xf.kind) {
                            "scale" -> JSONObject(s.toString()).put("id", Store.uid())
                                .put("o", JSONArray(listOf(wx + (o[0] - wx) * xf.f, wy + (o[1] - wy) * xf.f))).put("z", o[2] / xf.f)
                            "rot" -> Xform.rotate(s, xf.deg, ((wx - o[0]) * o[2]).toFloat(), ((wy - o[1]) * o[2]).toFloat())
                            else -> JSONObject(s.toString()).put("id", Store.uid())
                                .put("o", JSONArray(listOf(o[0] + css(xf.dx) / camS, o[1] + css(xf.dy) / camS)))
                        }
                    }
                    Store.deleteStrokes(path, olds.map { it.getString("id") }); Store.addStrokes(path, moved)
                    push(Act(moved, olds))
                    selIds = moved.map { it.getString("id") }.toMutableSet()
                }
            }
        }
        invalidate()
    }

    private fun selHit(x: Float, y: Float): String? { if (selIds == null) return null; val r = selScreenRect() ?: return null; return SelUi.hit(r, x, y, dens) }
    private fun curXf(c: Cur): SelUi.Xf? { val b = c.box ?: return null; return SelUi.xf(c.hmode, b, c.sx0, c.sy0, c.ex, c.ey, dens) }

    private fun selScreenRect(): RectF? {
        val sel = selIds ?: return null
        val d = doc ?: return null
        var x0 = Double.MAX_VALUE; var y0 = Double.MAX_VALUE; var x1 = -Double.MAX_VALUE; var y1 = -Double.MAX_VALUE
        for (id in sel) { val s = d.strokes[id] ?: continue; val b = worldBox(s); x0 = min(x0, b[0]); y0 = min(y0, b[1]); x1 = max(x1, b[2]); y1 = max(y1, b[3]) }
        if (x0 > x1) return null
        return RectF(((x0 - camX) * camS).toFloat() * dens, ((y0 - camY) * camS).toFloat() * dens, ((x1 - camX) * camS).toFloat() * dens, ((y1 - camY) * camS).toFloat() * dens)
    }

    private fun inPoly(x: Float, y: Float, p: List<Float>): Boolean {
        var inside = false; val n = p.size / 2; var j = n - 1
        for (i in 0 until n) {
            val xi = p[i * 2]; val yi = p[i * 2 + 1]; val xj = p[j * 2]; val yj = p[j * 2 + 1]
            if ((yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / ((yj - yi).takeIf { it != 0f } ?: 1e-6f) + xi) inside = !inside
            j = i
        }
        return inside
    }

    override fun clearSel() { if (selIds != null) { selIds = null; onSelChanged(0); invalidate() } }
    fun deleteSelection() {
        val sel = selIds ?: return; val d = doc ?: return
        val olds = sel.mapNotNull { d.strokes[it] }
        Store.deleteStrokes(path, olds.map { it.getString("id") }); push(Act(emptyList(), olds)); clearSel()
    }
    fun recolorSelection(color: String) {
        val sel = selIds ?: return; val d = doc ?: return
        val olds = sel.mapNotNull { d.strokes[it] }.filter { it.optString("t") != "img" }
        val news = olds.map { JSONObject(it.toString()).put("id", Store.uid()).put("c", color) }
        Store.deleteStrokes(path, olds.map { it.getString("id") }); Store.addStrokes(path, news); push(Act(news, olds))
        selIds = news.map { it.getString("id") }.toMutableSet(); invalidate()
    }

    /** Bild in die Mitte des Bildschirms (Größe: halbe Bildschirmbreite) */
    fun addImage(src: String, iw: Float, ih: Float) {
        val wCss = css(width.toFloat()) * 0.5f
        val hCss = wCss * ih / iw
        val wx = toWorldX(width / 2f) - wCss / 2 / camS; val wy = toWorldY(height / 2f) - hCss / 2 / camS
        val s = JSONObject().put("id", Store.uid()).put("p", 0).put("t", "img").put("c", "#000000").put("src", src)
            .put("o", JSONArray(listOf(wx, wy))).put("z", camS).put("pts", JSONArray(listOf(0.0, 0.0))).put("bw", r2(wCss)).put("bh", r2(hCss))
        Store.addStrokes(path, listOf(s)); push(Act(listOf(s), emptyList())); invalidate()
    }

    /** Textfeld auf der Tafel (Schriftgröße in CSS-Pixeln beim aktuellen Zoom); null = löschen */
    fun commitText(wx: Double, wy: Double, st: TextStyle?, existing: JSONObject?) {
        val olds = listOfNotNull(existing)
        if (st == null) { if (existing != null) { Store.deleteStrokes(path, listOf(existing.getString("id"))); push(Act(emptyList(), olds)) }; return }
        val s = st.applyTo(if (existing != null) JSONObject(existing.toString()) else JSONObject()
            .put("o", JSONArray(listOf(wx, wy - st.fs * 0.6 / camS))).put("z", camS).put("pts", JSONArray(listOf(0.0, 0.0))))
            .put("id", Store.uid()).put("p", 0)
        if (existing != null) Store.deleteStrokes(path, listOf(existing.getString("id")))
        Store.addStrokes(path, listOf(s)); push(Act(listOf(s), olds))
    }
    val defaultTextSize get() = (ttSize * 1.3f).roundToInt().toFloat()

    fun selectedText(): JSONObject? {
        val sel = selIds ?: return null
        if (sel.size != 1) return null
        return doc?.strokes?.get(sel.first())?.takeIf { it.optString("t") == "txt" }
    }
    fun editSelectedText() {
        val s = selectedText() ?: return
        val o = so(s)
        clearSel()
        onTextRequest(o[0], o[1], s)
    }

    private fun push(a: Act) { undoStack.add(a); redoStack.clear(); onInkChanged() }
    private fun apply(a: Act): Act {
        if (a.added.isNotEmpty()) Store.deleteStrokes(path, a.added.map { it.getString("id") })
        val back = a.removed.map { JSONObject(it.toString()).put("id", Store.uid()) }
        if (back.isNotEmpty()) Store.addStrokes(path, back)
        return Act(back, a.added)
    }
    fun undo() { if (undoStack.isEmpty()) return; redoStack.add(apply(undoStack.removeAt(undoStack.size - 1))); onInkChanged() }
    fun redo() { if (redoStack.isEmpty()) return; undoStack.add(apply(redoStack.removeAt(redoStack.size - 1))); onInkChanged() }
}
