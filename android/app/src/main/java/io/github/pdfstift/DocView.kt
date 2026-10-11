package io.github.pdfstift

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.view.HapticFeedbackConstants
import android.graphics.pdf.PdfRenderer
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.widget.OverScroller
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * PDF-Anzeige mit Stift: Seiten untereinander, mit Fingern scrollen und zoomen, mit dem Stift schreiben.
 * Notiz-Koordinaten sind PDF-Punkte der Seite (oben links = 0,0) – genau wie in der Web-App.
 */
@SuppressLint("ViewConstructor")
class DocView(ctx: Context) : View(ctx), InkTools {
    // ---- Dokument
    var path = ""
    private var renderer: PdfSource? = null
    private val exec = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private var gen = 0
    var pageCount = 0; private set
    private var pw = FloatArray(0)
    private var ph = FloatArray(0)

    // ---- Anordnung bei Zoom 1 (Pixel)
    private val dens = resources.displayMetrics.density
    private val gap = 12 * dens
    private var bs = 1f
    private var pTop = FloatArray(0)
    private var pLeft = FloatArray(0)
    private var contentH = 0f
    var zoom = 1f; private set
    private var sx = 0f
    private var sy = 0f
    private var pendingPos: Pair<Int, Float>? = null
    private var pendingZoom = 1f

    // ---- Bilder der Seiten
    private val cacheBudget = (Runtime.getRuntime().maxMemory() / 3).coerceAtMost(600L * 1024 * 1024)
    private val baseCache = object : LinkedHashMap<String, Bitmap>(16, 0.75f, true) {}
    private var baseBytes = 0L
    private val baseWanted = HashSet<String>()
    private class Detail(val page: Int, val bmp: Bitmap, val rect: RectF, val zoom: Float)
    private var details = listOf<Detail>()
    private val detailRun = Runnable { renderDetails() }

    // ---- Notizen
    var doc: NoteDoc? = null; private set
    private val pageInk = HashMap<Int, List<JSONObject>>()
    private val docListener: () -> Unit = { pageInk.clear(); invalidate(); onInkChanged() }
    override var tool = "pen"          // pen | hl | tx | sh | tt | la | er
    override var txKind = "hl"
    override var txColor = "#FFE14D"
    override var shKind = "line"
    override var shColor = "#D6262B"
    override var shWi = 1
    override var ttSize = 14f
    override var ttColor = "#1A1A1A"
    var onTextRequest: (page: Int, x: Float, y: Float, existing: JSONObject?) -> Unit = { _, _, _, _ -> }
    var onSelChanged: (Int) -> Unit = {}
    private var pageText: PageText? = null
    private val textExec = Executors.newSingleThreadExecutor()
    private val textLoaded = HashSet<Int>()
    private class Sel(val page: Int, val ids: MutableSet<String>)
    private var sel: Sel? = null
    override var penColor = "#1A1A1A"
    override var hlColor = "#FFE14D"
    override var penWi = 1
    override var hlWi = 1
    override var fingerDraw = false
    var onPage: (Int, Int) -> Unit = { _, _ -> }
    var onInkChanged: () -> Unit = {}
    var onReady: () -> Unit = {}

    private class Act(val added: List<JSONObject>, val removed: List<JSONObject>)
    private val undoStack = ArrayList<Act>()
    private val redoStack = ArrayList<Act>()
    val canUndo get() = undoStack.isNotEmpty()
    val canRedo get() = redoStack.isNotEmpty()

    // ---- Eingabe
    private val scroller = OverScroller(ctx)
    private var penDown = false
    private var lastPenUp = 0L
    private var gesture = false
    private var cur: Cur? = null
    private class Cur(val page: Int, val k: Float, val ox: Float, val oy: Float, val erase: Boolean, val t: String, val c: String, val w: Float) {
        var mode = "ink"          // ink | erase | tx | sh | lasso | drag | tap
        val pts = ArrayList<Float>()
        val live = Path()
        var fast = false
        val removed = ArrayList<JSONObject>()
        var ax = 0f; var ay = 0f; var bx = 0f; var by = 0f
        var sx0 = 0f; var sy0 = 0f
        var rects: List<Float> = emptyList()
        val lasso = ArrayList<Float>()
        var hmode = "move"       // beim Ziehen der Auswahl: move | nw | ne | sw | se | rot
        // Stift am Ende kurz ruhig halten: gerade Linie oder erkannte Form
        var hx = 0f; var hy = 0f
        var straight = false; var fixed = false
        var hold: Runnable? = null
    }

    private val paperPaint = Paint().apply { color = Color.WHITE }
    private val shadowPaint = Paint().apply { color = Color.parseColor("#22000000") }
    private val bmpPaint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val livePen = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
    private val eraserPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 1.5f * dens; color = Color.parseColor("#88000000") }
    private var eraserAt: FloatArray? = null

    init {
        setBackgroundColor(Color.parseColor("#E9ECF2"))
        isFocusable = true
    }

    // ================================================================== Öffnen
    fun open(file: File, docPath: String, startPage: Int, startFrac: Float, startZoom: Float) {
        close()
        path = docPath
        val g = ++gen
        pendingPos = startPage to startFrac
        pendingZoom = startZoom
        exec.execute {
            try {
                val r = PdfSource(context, file)
                val n = r.pageCount
                val w = FloatArray(n); val h = FloatArray(n)
                // große PDFs: erst die ersten Seiten ausmessen und gleich zeigen, den Rest danach (bis dahin wie die letzte bekannte Seite)
                val first = if (n > 60) 24 else n
                for (i in 0 until first) { val (a, b) = r.size(i); w[i] = a; h[i] = b }
                for (i in first until n) { w[i] = w[first - 1]; h[i] = h[first - 1] }
                main.post {
                    if (g != gen) { exec.execute { r.close() }; return@post }
                    renderer = r; pageCount = n; pw = w; ph = h
                    pageText = PageText(file)
                    doc = Store.doc(docPath).also { it.listeners.add(docListener) }
                    relayout()
                    onReady()
                }
                if (first < n) {
                    val w2 = w.copyOf(); val h2 = h.copyOf()
                    var diff = false
                    for (i in first until n) { if (g != gen) return@execute; val (a, b) = r.size(i); if (a != w2[i] || b != h2[i]) diff = true; w2[i] = a; h2[i] = b }
                    if (diff) main.post {
                        if (g != gen) return@post
                        val (pg, fr) = currentPos()
                        pw = w2; ph = h2; pendingPos = pg to fr; pendingZoom = zoom; relayout()
                    }
                }
            } catch (e: Exception) {
                main.post { if (g == gen) onError(e) }
            }
        }
    }
    var onError: (Exception) -> Unit = {}

    fun close() {
        gen++
        doc?.listeners?.remove(docListener)
        doc = null
        val r = renderer
        renderer = null
        exec.execute { try { r?.close() } catch (e: Exception) { } }
        baseCache.values.forEach { it.recycle() }; baseCache.clear(); baseBytes = 0; baseWanted.clear()
        details.forEach { it.bmp.recycle() }; details = listOf()
        pageInk.clear(); undoStack.clear(); redoStack.clear()
        val pt = pageText; pageText = null; textLoaded.clear()
        if (pt != null) textExec.execute { pt.close() }
        sel = null
        pageCount = 0
    }

    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
        val keep = if (pageCount > 0 && ow > 0) currentPos() else null
        relayout()
        if (present) { post { showPage(presentPage) }; return }
        keep?.let { goTo(it.first, it.second) }
    }

    // ================================================================== Präsentieren
    var present = false
        set(v) {
            if (field == v) return
            field = v
            if (v) { savedZoom = zoom; clearSel(); val p = currentPage(); if (viewMode != "single") relayout(); showPage(p) }
            else { zoom = savedZoom; if (viewMode != "single") relayout(); goTo(presentPage); laser.clear() }
        }
    var laserFinger = false
    private var savedZoom = 1f
    var presentPage = 0; private set
    private var laserActive = false
    private val laser = Laser(this)
    private fun laserOwns(ev: MotionEvent) = ev.actionMasked == MotionEvent.ACTION_DOWN || laserActive

    var onLaser: () -> Unit = {}
    /** Laser für die Live-Mitschau: Punkte in PDF-Koordinaten der gezeigten Seite */
    fun laserForLive(): List<List<DoubleArray>> {
        if (pageCount == 0) return emptyList()
        val i = if (present) presentPage else currentPage()
        val r = pageRect(i, RectF()); val k = bs * zoom
        return laser.snapshot().map { tr -> tr.map { doubleArrayOf(((it[0] - r.left) / k * 10).roundToInt() / 10.0, ((it[1] - r.top) / k * 10).roundToInt() / 10.0, it[2].toDouble()) } }
    }
    fun livePage() = if (present) presentPage else currentPage()

    /** eine Seite ganz zeigen, mittig */
    fun showPage(i0: Int) {
        if (pageCount == 0 || width == 0) return
        val i = i0.coerceIn(0, pageCount - 1)
        presentPage = i
        zoom = min(1f, (height - gap) / (ph[i] * bs)).coerceAtLeast(0.1f)
        sy = (pTop[i] + ph[i] * bs / 2) * zoom - height / 2f
        sx = (width * zoom - width) / 2f
        invalidate(); reportPage(); scheduleDetail()
    }
    fun step(d: Int) { if (present) showPage(presentPage + d) else goTo(currentPage() + d) }

    /** Seitenanzeige: single = untereinander, two = zwei nebeneinander, cover = zwei nebeneinander, Titelseite einzeln */
    var viewMode: String = Store.prefs().getString("viewMode", "single") ?: "single"
        set(v) {
            field = v; Store.prefs().edit().putString("viewMode", v).apply()
            if (pageCount > 0) { val (pg, fr) = currentPos(); pendingPos = pg to fr; pendingZoom = zoom; relayout() }
        }

    private fun relayout() {
        if (width == 0 || pageCount == 0) return
        val avail = width - 2 * gap
        val maxW = pw.maxOrNull() ?: 1f
        val two = viewMode != "single" && !present
        val colW = if (two) (avail - gap) / 2 else avail
        bs = colW / maxW
        pTop = FloatArray(pageCount); pLeft = FloatArray(pageCount)
        var y = gap
        if (!two) {
            for (i in 0 until pageCount) {
                pLeft[i] = gap + (avail - pw[i] * bs) / 2
                pTop[i] = y
                y += ph[i] * bs + gap
            }
        } else {
            // Zeilen mit zwei Seiten (bei „cover“ steht die erste Seite allein rechts)
            var i = 0
            while (i < pageCount) {
                val row = if (viewMode == "cover" && i == 0) listOf(0) else listOf(i, i + 1).filter { it < pageCount }
                var rh = 0f
                for (j in row) {
                    val col = if (viewMode == "cover" && i == 0) 1 else j - i
                    pLeft[j] = gap + col * (colW + gap) + (colW - pw[j] * bs) / 2
                    pTop[j] = y
                    rh = max(rh, ph[j] * bs)
                }
                y += rh + gap
                i += row.size
            }
        }
        contentH = y
        // gemerkte Stelle
        pendingPos?.let { (pg, fr) -> pendingPos = null; zoom = pendingZoom.coerceIn(0.5f, 20f); goTo(pg, fr); return }
        clamp(); invalidate(); reportPage()
    }

    // ================================================================== Position
    fun currentPos(): Pair<Int, Float> {
        if (pageCount == 0) return 0 to 0f
        val cy = (sy + height * 0.2f) / zoom
        var i = 0
        while (i < pageCount - 1 && pTop[i + 1] <= cy) i++
        val fr = ((cy - pTop[i]) / (ph[i] * bs)).coerceIn(0f, 1f)
        return i to fr
    }
    fun currentPage(): Int {
        if (pageCount == 0) return 0
        val cy = (sy + height / 2f) / zoom
        var i = 0
        while (i < pageCount - 1 && pTop[i + 1] <= cy) i++
        return i
    }
    fun goTo(page: Int, frac: Float = 0f) {
        if (pageCount == 0) return
        val i = page.coerceIn(0, pageCount - 1)
        sy = (pTop[i] + ph[i] * bs * frac) * zoom - height * 0.2f * (if (frac > 0) 1f else 0f) - (if (frac == 0f) gap * zoom * 0.5f else 0f)
        clamp(); invalidate(); reportPage(); scheduleDetail()
    }

    private fun clamp() {
        val cw = width * zoom
        sx = if (cw <= width) (cw - width) / 2f else sx.coerceIn(0f, cw - width)
        val ch = contentH * zoom
        sy = if (ch <= height) 0f else sy.coerceIn(0f, ch - height)
    }

    private var lastReported = -1
    private fun reportPage() {
        val p = currentPage()
        if (p != lastReported) { lastReported = p; onPage(p, pageCount) }
    }

    private fun pageRect(i: Int, out: RectF): RectF {
        out.set(pLeft[i] * zoom - sx, pTop[i] * zoom - sy, (pLeft[i] + pw[i] * bs) * zoom - sx, (pTop[i] + ph[i] * bs) * zoom - sy)
        return out
    }
    private val tmpR = RectF()
    private fun pageAt(x: Float, y: Float): Int {
        for (i in 0 until pageCount) if (pageRect(i, tmpR).contains(x, y)) return i
        return -1
    }

    // ================================================================== Zeichnen
    override fun onDraw(c: Canvas) {
        if (pageCount == 0) return
        val r = RectF()
        val zb = if (zoom > 1.3f) 2 else 1
        for (i in 0 until pageCount) {
            if (present && i != presentPage) continue
            pageRect(i, r)
            if (r.bottom < 0 || r.top > height) continue
            c.drawRect(r.left + 2 * dens, r.top + 2 * dens, r.right + 2 * dens, r.bottom + 2 * dens, shadowPaint)
            c.drawRect(r, paperPaint)
            val bmp = baseCache["$i:$zb"] ?: baseCache["$i:${3 - zb}"]
            if (bmp != null && !bmp.isRecycled) c.drawBitmap(bmp, null, r, bmpPaint)
            if (baseCache["$i:$zb"] == null) requestBase(i, zb)
            for (d in details) if (d.page == i && d.zoom == zoom && !d.bmp.isRecycled) {
                val dst = RectF(d.rect.left * zoom - sx, d.rect.top * zoom - sy, d.rect.right * zoom - sx, d.rect.bottom * zoom - sy)
                c.drawBitmap(d.bmp, null, dst, bmpPaint)
            }
            // Notizen
            val k = bs * zoom
            c.save()
            c.clipRect(r)
            c.translate(r.left, r.top)
            c.scale(k, k)
            val cu = cur
            val dragging = cu != null && cu.mode == "drag" && cu.page == i
            val sl = sel
            val xf = if (dragging && sl != null && cu != null) curXf(cu, sl) else null
            var later: ArrayList<JSONObject>? = null
            for (s in inkOf(i)) {
                if (xf != null && sl != null && s.optString("id") in sl.ids) continue
                // beim Anhören: was erst später geschrieben wurde, blass zeigen
                val au = if (playRec != null) s.optJSONArray("au") else null
                if (au != null && au.optString(0) == playRec && au.optLong(1) > playMs) { (later ?: ArrayList<JSONObject>().also { later = it }).add(s); continue }
                Ink.draw(c, s)
            }
            later?.let { l -> c.saveLayerAlpha(null, 60); for (s in l) Ink.draw(c, s); c.restore() }
            if (xf != null && sl != null) {
                c.save(); xf.apply(c)
                for (s in inkOf(i)) if (s.optString("id") in sl.ids) Ink.draw(c, s)
                c.restore()
            }
            if (cu != null && cu.page == i) drawPreview(c, cu, k)
            if (hits.isNotEmpty()) for ((hk, h) in hits.withIndex()) if (h.page == i) {
                var q = 0
                while (q + 3 < h.rects.size) { c.drawRect(h.rects[q] - 1, h.rects[q + 1] - 1, h.rects[q] + h.rects[q + 2] + 1, h.rects[q + 1] + h.rects[q + 3] + 1, if (hk == hitCur) hitCurPaint else hitPaint); q += 4 }
            }
            c.restore()
            if (pick != null) {
                c.save(); c.translate(r.left, r.top); c.scale(k, k)
                pickRects[i]?.forEach { c.drawRect(it, pickFill) }
                pickLine.strokeWidth = 2f / k
                for ((pg, b) in pickBoxes) if (pg == i) c.drawRect(b, pickLine)
                if (cu != null && cu.page == i && cu.mode == "pick" && cu.hmode == "new") {
                    selPaint.strokeWidth = 1.5f / k; selPaint.pathEffect = android.graphics.DashPathEffect(floatArrayOf(6f / k, 4f / k), 0f)
                    c.drawRect(min(cu.ax, cu.bx), min(cu.ay, cu.by), max(cu.ax, cu.bx), max(cu.ay, cu.by), selPaint)
                }
                pickSel?.let { (pg, b) -> if (pg == i) {
                    val xf = if (cu != null && cu.mode == "pick" && cu.hmode != "new") SelUi.xf(cu.hmode, b, cu.ax, cu.ay, cu.bx, cu.by, dens / k) else null
                    SelUi.draw(c, b, dens / k, xf)
                } }
                c.restore()
            }
            // Auswahlrahmen mit Anfassern (darf über den Seitenrand ragen)
            if (sl != null && sl.page == i) {
                c.save(); c.translate(r.left, r.top); c.scale(k, k)
                SelUi.draw(c, selBounds(sl, 0f, 0f), dens / k, if (dragging && cu != null) curXf(cu, sl) else null)
                c.restore()
            }
        }
        laser.draw(c)
        eraserAt?.let { c.drawCircle(it[0], it[1], ERASE_PX * dens, eraserPaint) }
    }

    private val selPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = Color.parseColor("#1E2F6E") }
    private val prevFill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }

    private fun drawPreview(c: Canvas, cu: Cur, k: Float) {
        when (cu.mode) {
            "ink" -> {
                if (cu.fast) return
                livePen.color = Color.parseColor(cu.c)
                livePen.strokeWidth = cu.w
                livePen.alpha = if (cu.t == "hl") 102 else 255
                livePen.pathEffect = null
                if (cu.pts.size == 3) c.drawPoint(cu.pts[0], cu.pts[1], livePen) else c.drawPath(cu.live, livePen)
            }
            "tx" -> if (cu.rects.isNotEmpty()) {
                val tmp = JSONObject().put("id", "_live").put("t", "tx").put("k", txKind).put("c", txColor).put("pts", JSONArray(cu.rects.map { it.toDouble() }))
                Ink.draw(c, tmp)
            }
            "sh" -> {
                livePen.color = Color.parseColor(shColor); livePen.alpha = 255; livePen.pathEffect = null
                val w = cu.w
                livePen.strokeWidth = max(0.5f, w)
                for (line in Ink.shapeLines(shKind, floatArrayOf(cu.ax, cu.ay, cu.bx, cu.by), w)) {
                    val path = Path()
                    line.forEachIndexed { j, q -> if (j == 0) path.moveTo(q[0], q[1]) else path.lineTo(q[0], q[1]) }
                    c.drawPath(path, livePen)
                }
            }
            "lasso" -> if (cu.lasso.size >= 4) {
                val path = Path(); path.moveTo(cu.lasso[0], cu.lasso[1])
                var j = 2; while (j + 1 < cu.lasso.size) { path.lineTo(cu.lasso[j], cu.lasso[j + 1]); j += 2 }
                selPaint.strokeWidth = 1.5f / k
                selPaint.pathEffect = android.graphics.DashPathEffect(floatArrayOf(6f / k, 4f / k), 0f)
                c.drawPath(path, selPaint)
            }
        }
    }

    private fun inkOf(i: Int): List<JSONObject> = pageInk.getOrPut(i) {
        val d = doc ?: return@getOrPut emptyList()
        d.strokes.values.filter { it.optInt("p") == i }.sortedBy { Ink.rank(it) }
    }

    private fun requestBase(i: Int, zb: Int) {
        val key = "$i:$zb"
        if (!baseWanted.add(key)) return
        val g = gen
        val w = min(pw[i] * bs * zb, 3200f).roundToInt().coerceAtLeast(1)
        val h = (w * ph[i] / pw[i]).roundToInt().coerceAtLeast(1)
        exec.execute {
            if (g != gen) return@execute
            val r = renderer ?: return@execute
            val bmp = try {
                val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                b.eraseColor(Color.WHITE)
                r.render(i, b, 0, 0, w, h)
                b
            } catch (e: Throwable) { null }
            main.post {
                if (g != gen || bmp == null) { bmp?.recycle(); baseWanted.remove(key); return@post }
                baseCache[key]?.let { baseBytes -= it.byteCount; it.recycle() }
                baseCache[key] = bmp
                baseBytes += bmp.byteCount
                trimCache()
                invalidate()
            }
        }
    }

    private fun trimCache() {
        val it = baseCache.entries.iterator()
        val visible = visiblePages()
        while (baseBytes > cacheBudget && it.hasNext()) {
            val e = it.next()
            val pg = e.key.substringBefore(':').toInt()
            if (pg in visible) continue
            baseBytes -= e.value.byteCount
            e.value.recycle()
            baseWanted.remove(e.key)
            it.remove()
        }
    }

    private fun visiblePages(): Set<Int> {
        val s = HashSet<Int>()
        val r = RectF()
        for (i in 0 until pageCount) { pageRect(i, r); if (r.bottom >= 0 && r.top <= height) s.add(i) }
        return s
    }

    private fun scheduleDetail() {
        removeCallbacks(detailRun)
        if (zoom > 1.25f) postDelayed(detailRun, 140)
    }

    /** gestochen scharfer Ausschnitt in Bildschirmauflösung für die sichtbaren Seiten */
    private fun renderDetails() {
        if (pageCount == 0 || zoom <= 1.25f || !scroller.isFinished) return
        val g = gen
        val z = zoom
        val jobs = ArrayList<Triple<Int, RectF, IntArray>>()
        val r = RectF()
        for (i in visiblePages()) {
            pageRect(i, r)
            val vis = RectF(max(r.left, 0f), max(r.top, 0f), min(r.right, width.toFloat()), min(r.bottom, height.toFloat()))
            if (vis.width() < 2 || vis.height() < 2) continue
            val m = intArrayOf((vis.left - r.left).roundToInt(), (vis.top - r.top).roundToInt(), r.width().roundToInt(), r.height().roundToInt())
            val content = RectF((vis.left + sx) / zoom, (vis.top + sy) / zoom, (vis.right + sx) / zoom, (vis.bottom + sy) / zoom)
            jobs.add(Triple(i, content, m))
        }
        val sizes = jobs.map { (_, content, _) -> Pair(((content.width()) * z).roundToInt().coerceIn(1, 4096), ((content.height()) * z).roundToInt().coerceIn(1, 4096)) }
        exec.execute {
            val out = ArrayList<Detail>()
            for ((n, job) in jobs.withIndex()) {
                if (g != gen) break
                val rd = renderer ?: break
                val (i, content, m) = job
                val (w, h) = sizes[n]
                try {
                    val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                    b.eraseColor(Color.WHITE)
                    rd.render(i, b, m[0], m[1], m[2], m[3])
                    out.add(Detail(i, b, content, z))
                } catch (e: Throwable) { }
            }
            main.post {
                if (g != gen || z != zoom) { out.forEach { it.bmp.recycle() }; return@post }
                val old = details
                details = out
                old.forEach { it.bmp.recycle() }
                invalidate()
            }
        }
    }

    // ================================================================== Gesten
    private val scaleDet = ScaleGestureDetector(ctx, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(d: ScaleGestureDetector): Boolean {
            zoomAt(zoom * d.scaleFactor, d.focusX, d.focusY)
            return true
        }
    }).apply { isQuickScaleEnabled = false }

    private val gestDet = GestureDetector(ctx, object : GestureDetector.SimpleOnGestureListener() {
        override fun onDown(e: MotionEvent): Boolean { scroller.forceFinished(true); return true }
        override fun onScroll(e1: MotionEvent?, e2: MotionEvent, dx: Float, dy: Float): Boolean {
            if (present) return true
            sx += dx; sy += dy; clamp(); invalidate(); reportPage(); scheduleDetail(); return true
        }
        override fun onFling(e1: MotionEvent?, e2: MotionEvent, vx: Float, vy: Float): Boolean {
            if (present) { val v = if (kotlin.math.abs(vx) > kotlin.math.abs(vy)) vx else vy; step(if (v < 0) 1 else -1); return true }
            val cw = width * zoom; val ch = contentH * zoom
            scroller.fling(sx.roundToInt(), sy.roundToInt(), -vx.roundToInt(), -vy.roundToInt(),
                min(0f, (cw - width) / 2).roundToInt(), max(0f, cw - width).roundToInt(), 0, max(0f, ch - height).roundToInt())
            postInvalidateOnAnimation()
            return true
        }
        override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
            if (present) { if (e.x < width * 0.3f) step(-1) else if (e.x > width * 0.7f) step(1) else onPresentTap(); return true }
            val i = pageAt(e.x, e.y); if (i < 0) return false
            val r = pageRect(i, RectF()); val k = bs * zoom
            val x = (e.x - r.left) / k; val y = (e.y - r.top) / k
            if (pick != null) { onPickTap(i, x, y); return true }
            playRec?.let { rec ->
                val hit = inkOf(i).lastOrNull { s -> s.optJSONArray("au")?.optString(0) == rec && Ink.hits(s, x, y, 14 * dens / k) }
                if (hit != null) { onAudioSeek(hit.getJSONArray("au").optLong(1)); return true }
            }
            noteAt(i, x, y)?.let { onNote(i, 0f, 0f, it); return true }
            val s = inkOf(i).lastOrNull { it.optString("t") == "txt" && it.has("ln") && Ink.bounds(it).apply { inset(-6f, -6f) }.contains(x, y) } ?: return false
            val ln = s.getJSONObject("ln")
            onLink(ln.optString("path"), ln.optInt("pg"))
            return true
        }
        override fun onDoubleTap(e: MotionEvent): Boolean {
            if (present) return true
            zoomAt(if (zoom < 1.5f) 2.5f else 1f, e.x, e.y)
            return true
        }
    })

    fun zoomAt(nz: Float, fx: Float, fy: Float) {
        val z = nz.coerceIn(0.5f, 20f)
        val cx = (fx + sx) / zoom; val cy = (fy + sy) / zoom
        zoom = z
        sx = cx * z - fx; sy = cy * z - fy
        clamp(); invalidate(); reportPage(); scheduleDetail()
    }

    override fun computeScroll() {
        if (scroller.computeScrollOffset()) {
            sx = scroller.currX.toFloat(); sy = scroller.currY.toFloat()
            clamp(); reportPage()
            postInvalidateOnAnimation()
            if (scroller.isFinished) scheduleDetail()
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(ev: MotionEvent): Boolean {
        if (pageCount == 0) return false
        val tt = ev.getToolType(ev.actionIndex)
        val isPen = tt == MotionEvent.TOOL_TYPE_STYLUS || tt == MotionEvent.TOOL_TYPE_ERASER
        val isMouse = tt == MotionEvent.TOOL_TYPE_MOUSE
        // Präsentieren: Stift (oder auf Wunsch der Finger) ist ein Laserpointer, nichts wird gespeichert
        if (present && (isPen || isMouse || (laserFinger && ev.pointerCount == 1 && laserOwns(ev)))) {
            when (ev.actionMasked) {
                MotionEvent.ACTION_DOWN -> { laserActive = true; laser.start(ev.x, ev.y) }
                MotionEvent.ACTION_MOVE -> { if (laserActive) { for (h in 0 until ev.historySize) laser.add(ev.getHistoricalX(h), ev.getHistoricalY(h)); laser.add(ev.x, ev.y) } }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> { laserActive = false; laser.end() }
            }
            onLaser()
            invalidate(); return true
        }
        if (laserActive) { laserActive = false; laser.end() }
        when (ev.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                gesture = false
                if (markNext != null && placeMarker(ev)) return true
                val draws = isPen || (isMouse && (ev.buttonState and MotionEvent.BUTTON_PRIMARY) != 0) || (fingerDraw && tt == MotionEvent.TOOL_TYPE_FINGER) ||
                    (tool == "la" && !present && pick == null && selHitAt(ev.x, ev.y) != null) || (pick != null && pickSelHit(ev.x, ev.y) != null)
                // Handballen ignorieren, solange/kurz nachdem der Stift schreibt
                if (!isPen && (penDown || System.currentTimeMillis() - lastPenUp < 250) && !isMouse) return true
                if (draws) {
                    if (isPen && Build.VERSION.SDK_INT >= 30) requestUnbufferedDispatch(ev)
                    if (isPen) penDown = true
                    startStroke(ev, tt)
                    return true
                }
            }
            MotionEvent.ACTION_POINTER_DOWN -> {
                if (penDown) return true
                if (cur != null && !isPen) { cancelStroke() }
            }
        }
        val c = cur
        if (c != null) {
            when (ev.actionMasked) {
                MotionEvent.ACTION_MOVE -> { moveStroke(ev); return true }
                MotionEvent.ACTION_UP -> { endStroke(); if (isPen) { penDown = false; lastPenUp = System.currentTimeMillis() }; return true }
                MotionEvent.ACTION_CANCEL -> { cancelStroke(); penDown = false; return true }
            }
            return true
        }
        if (penDown) {
            if (ev.actionMasked == MotionEvent.ACTION_UP || ev.actionMasked == MotionEvent.ACTION_CANCEL) { penDown = false; lastPenUp = System.currentTimeMillis() }
            return true
        }
        if (isPen) return true
        if (!present) scaleDet.onTouchEvent(ev)
        if (!scaleDet.isInProgress) gestDet.onTouchEvent(ev)
        if (ev.actionMasked == MotionEvent.ACTION_UP || ev.actionMasked == MotionEvent.ACTION_CANCEL) scheduleDetail()
        return true
    }

    /** Liegt (x, y) auf der Auswahl oder einem ihrer Anfasser? */
    private fun selHitAt(x: Float, y: Float): String? {
        val sl = sel ?: return null
        if (sl.page >= pageCount) return null
        val r = pageRect(sl.page, RectF()); val k = bs * zoom
        return SelUi.hit(selBounds(sl, 0f, 0f), (x - r.left) / k, (y - r.top) / k, dens / k)
    }
    private fun curXf(cu: Cur, sl: Sel): SelUi.Xf = SelUi.xf(cu.hmode, selBounds(sl, 0f, 0f), cu.ax, cu.ay, cu.bx, cu.by, dens / cu.k)

    private fun startStroke(ev: MotionEvent, tt: Int) {
        if (pick != null) {
            val ps = pickSel; val h = pickSelHit(ev.x, ev.y)
            val pg = if (ps != null && h != null) ps.first else pageAt(ev.x, ev.y)
            if (pg < 0) return
            val r = pageRect(pg, RectF()); val k = bs * zoom
            val c = Cur(pg, k, r.left, r.top, false, "pen", penColor, 1f)
            c.ax = (ev.x - r.left) / k; c.ay = (ev.y - r.top) / k; c.bx = c.ax; c.by = c.ay; c.sx0 = ev.x; c.sy0 = ev.y
            c.mode = "pick"; c.hmode = h ?: "new"
            cur = c; invalidate(); return
        }
        if (tool == "la") {
            val sl = sel; val h = selHitAt(ev.x, ev.y)
            if (sl != null && h != null) {
                val r = pageRect(sl.page, RectF()); val k = bs * zoom
                val c = Cur(sl.page, k, r.left, r.top, false, "pen", penColor, 1f)
                c.ax = (ev.x - r.left) / k; c.ay = (ev.y - r.top) / k; c.bx = c.ax; c.by = c.ay; c.sx0 = ev.x; c.sy0 = ev.y
                c.mode = "drag"; c.hmode = h
                cur = c; invalidate(); return
            }
        }
        val i = pageAt(ev.x, ev.y)
        if (i < 0) { if (tool == "la") clearSel(); return }
        val r = pageRect(i, RectF())
        val k = bs * zoom
        val btn = (ev.buttonState and (MotionEvent.BUTTON_STYLUS_PRIMARY or MotionEvent.BUTTON_SECONDARY)) != 0
        val erase = tool == "er" || tt == MotionEvent.TOOL_TYPE_ERASER || btn
        val zf = max(1f, zoom)
        val t = if (tool == "hl") "hl" else "pen"
        val w = when (tool) { "hl" -> Ink.HL_W[hlWi] / zf; "sh" -> Ink.PEN_W[shWi] / zf; else -> Ink.PEN_W[penWi] / zf }
        val c = Cur(i, k, r.left, r.top, erase, t, if (t == "hl") hlColor else penColor, (w * 1000).roundToInt() / 1000f)
        val px = (ev.x - r.left) / k; val py = (ev.y - r.top) / k
        c.ax = px; c.ay = py; c.bx = px; c.by = py; c.sx0 = ev.x; c.sy0 = ev.y
        c.mode = when {
            erase -> "erase"
            tool == "tx" -> "tx"
            tool == "sh" -> "sh"
            tool == "tt" || tool == "nt" -> "tap"
            tool == "la" -> "lasso"
            else -> "ink"
        }
        if (c.mode == "lasso") { clearSel(); c.lasso.add(px); c.lasso.add(py) }
        if (c.mode == "tx") ensureText(i)
        cur = c
        if (c.mode == "ink" || c.mode == "erase") {
            c.fast = c.mode == "ink" && c.t == "pen" && tt == MotionEvent.TOOL_TYPE_STYLUS && overlay?.ready == true
            addPoint(c, ev.x, ev.y, ev.pressure, tt)
            if (c.mode == "ink") c.live.moveTo(c.pts[0], c.pts[1])
        }
        invalidate()
    }

    private fun ensureText(i: Int) {
        val pt = pageText ?: return
        if (i in textLoaded) return
        textLoaded.add(i)
        textExec.execute { pt.chars(i); main.post { cur?.let { if (it.mode == "tx") updateTx(it) }; invalidate() } }
    }

    private fun updateTx(c: Cur) {
        val pt = pageText ?: return
        c.rects = PageText.rects(pt.chars(c.page), c.ax, c.ay, c.bx, c.by)
    }

    private fun addPoint(c: Cur, x: Float, y: Float, pressure: Float, tt: Int) {
        val px = ((x - c.ox) / c.k * 100).roundToInt() / 100f
        val py = ((y - c.oy) / c.k * 100).roundToInt() / 100f
        if (c.erase) {
            eraserAt = floatArrayOf(x, y)
            eraseAt(c, px, py, ERASE_PX * dens / c.k)
            return
        }
        val n = c.pts.size
        if (n >= 3 && hypot(c.pts[n - 3] - px, c.pts[n - 2] - py) * c.k < 0.8f) return
        val pr = if (tt == MotionEvent.TOOL_TYPE_STYLUS) pressure.coerceIn(0.05f, 1f) else 0.5f
        c.pts.add(px); c.pts.add(py); c.pts.add((pr * 100).roundToInt() / 100f)
        val m = c.pts.size
        if (m >= 6) {
            val ax = c.pts[m - 6]; val ay = c.pts[m - 5]
            c.live.quadTo(ax, ay, (ax + px) / 2, (ay + py) / 2)
            if (c.fast) {
                // Anfang des Stücks: Mitte des vorherigen Abschnitts (wie beim fertigen Strich)
                val bx = if (m >= 9) (c.pts[m - 9] + ax) / 2 else ax; val by = if (m >= 9) (c.pts[m - 8] + ay) / 2 else ay
                val prr = (c.pts[m - 4] + c.pts[m - 1]) / 2
                val wpx = maxOf(0.5f, c.w * (0.6f + 0.8f * prr)) * c.k
                val col = try { Color.parseColor(c.c) } catch (e: Exception) { Color.BLACK }
                overlay?.seg(InkOverlay.Seg(c.ox + bx * c.k, c.oy + by * c.k, c.ox + ax * c.k, c.oy + ay * c.k, c.ox + (ax + px) / 2 * c.k, c.oy + (ay + py) / 2 * c.k, wpx, col))
            }
        }
    }

    private fun moveStroke(ev: MotionEvent) {
        val c = cur ?: return
        val tt = ev.getToolType(0)
        if (c.mode != "ink" && c.mode != "erase") {
            c.bx = (ev.x - c.ox) / c.k; c.by = (ev.y - c.oy) / c.k
            when (c.mode) {
                "tx" -> if (c.page in textLoaded) updateTxAsync(c)
                "lasso" -> { c.lasso.add(c.bx); c.lasso.add(c.by) }
            }
            invalidate()
            return
        }
        if (c.mode == "ink" && c.fixed) return
        if (c.mode == "ink" && c.straight) {
            val px = (ev.x - c.ox) / c.k; val py = (ev.y - c.oy) / c.k
            val sn = snapLine(c.pts[0], c.pts[1], px, py)
            c.pts[3] = sn[0]; c.pts[4] = sn[1]
            liveFromPts(c); invalidate(); return
        }
        if (c.mode == "ink" && hypot(ev.x - c.hx, ev.y - c.hy) > 4 * dens) {
            c.hx = ev.x; c.hy = ev.y
            c.hold?.let { main.removeCallbacks(it) }
            val r = Runnable { straighten(c) }
            c.hold = r
            main.postDelayed(r, 450)
        }
        for (h in 0 until ev.historySize) addPoint(c, ev.getHistoricalX(h), ev.getHistoricalY(h), ev.getHistoricalPressure(h), tt)
        addPoint(c, ev.x, ev.y, ev.pressure, tt)
        invalidate()
    }

    // ---- Formen beim Halten (wie in der Web-Version): Kreis/Ellipse, Rechteck oder gerade Linie
    private fun snapLine(x0: Float, y0: Float, x: Float, y: Float): FloatArray {
        val a = Math.abs(Math.toDegrees(Math.atan2((y - y0).toDouble(), (x - x0).toDouble())))
        return when {
            a < 4 || a > 176 -> floatArrayOf(x, y0)
            Math.abs(a - 90) < 4 -> floatArrayOf(x0, y)
            else -> floatArrayOf(x, y)
        }
    }
    private fun shapeOf(p: List<Float>): List<Float>? {
        val n = p.size / 3
        var x0 = Float.MAX_VALUE; var y0 = Float.MAX_VALUE; var x1 = -Float.MAX_VALUE; var y1 = -Float.MAX_VALUE; var len = 0f
        var i = 0
        while (i < p.size) {
            x0 = min(x0, p[i]); x1 = max(x1, p[i]); y0 = min(y0, p[i + 1]); y1 = max(y1, p[i + 1])
            if (i > 0) len += hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2])
            i += 3
        }
        val w = x1 - x0; val h = y1 - y0; val big = max(w, h); val small = min(w, h)
        val gap = hypot(p[p.size - 3] - p[0], p[p.size - 2] - p[1])
        if (n < 12 || small < big * 0.18f || gap > big * 0.3f || len < big * 2.2f) return null
        val cx = (x0 + x1) / 2; val cy = (y0 + y1) / 2
        var eE = 0f; var eR = 0f
        i = 0
        while (i < p.size) {
            val dx = (p[i] - cx) / (w / 2); val dy = (p[i + 1] - cy) / (h / 2)
            eE += Math.abs(hypot(dx, dy) - 1f)
            eR += minOf(Math.abs(p[i] - x0), Math.abs(p[i] - x1), minOf(Math.abs(p[i + 1] - y0), Math.abs(p[i + 1] - y1))) / small
            i += 3
        }
        eE /= n; eR /= n
        val out = ArrayList<Float>()
        if (eR < 0.07f && eR < eE * 0.8f) {
            val cs = arrayOf(floatArrayOf(x0, y0), floatArrayOf(x1, y0), floatArrayOf(x1, y1), floatArrayOf(x0, y1), floatArrayOf(x0, y0))
            for (k in 0 until 4) for (t in 0 until 30) { out.add(cs[k][0] + (cs[k + 1][0] - cs[k][0]) * t / 30f); out.add(cs[k][1] + (cs[k + 1][1] - cs[k][1]) * t / 30f); out.add(0.5f) }
            out.add(x0); out.add(y0); out.add(0.5f); out.add(x0 + w * 0.02f); out.add(y0); out.add(0.5f)
            return out
        }
        if (eE < 0.16f) {
            var rx = w / 2; var ry = h / 2
            if (Math.abs(w - h) < big * 0.15f) { rx = (w + h) / 4; ry = rx }
            for (k in 0..72) { val a = k / 72.0 * Math.PI * 2; out.add(cx + rx * Math.cos(a).toFloat()); out.add(cy + ry * Math.sin(a).toFloat()); out.add(0.5f) }
            return out
        }
        return null
    }
    private fun liveFromPts(c: Cur) {
        c.live.reset()
        val p = c.pts
        if (p.size < 3) return
        c.live.moveTo(p[0], p[1])
        if (p.size == 6) { c.live.lineTo(p[3], p[4]); return }
        var i = 3
        while (i < p.size) { val ax = p[i - 3]; val ay = p[i - 2]; c.live.quadTo(ax, ay, (ax + p[i]) / 2, (ay + p[i + 1]) / 2); i += 3 }
        c.live.lineTo(p[p.size - 3], p[p.size - 2])
    }
    private fun straighten(c: Cur) {
        if (cur !== c || c.mode != "ink" || c.straight || c.fixed || c.pts.size < 9) return
        val form = shapeOf(c.pts)
        val n = c.pts.size
        if (form != null) {
            c.fixed = true
            c.pts.clear(); c.pts.addAll(form)
        } else {
            if (hypot(c.pts[n - 3] - c.pts[0], c.pts[n - 2] - c.pts[1]) * c.k < 16 * dens) return
            c.straight = true
            val sn = snapLine(c.pts[0], c.pts[1], c.pts[n - 3], c.pts[n - 2])
            val x0 = c.pts[0]; val y0 = c.pts[1]
            c.pts.clear(); c.pts.addAll(listOf(x0, y0, 0.5f, sn[0], sn[1], 0.5f))
        }
        // schnelle Stiftanzeige verwerfen, die Form wird normal gezeichnet
        if (c.fast) { overlay?.cancel(); c.fast = false }
        liveFromPts(c)
        performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
        invalidate()
    }

    // ---- Folien- und Videomarken: Menü wählen, dann auf die Stelle tippen
    var markNext: String? = null
    fun markers(): List<JSONObject> = (doc?.strokes?.values ?: emptyList<JSONObject>()).filter { it.optString("t") == "txt" && it.has("mk") }
        .sortedWith(compareBy({ it.optInt("p") }, { it.optJSONArray("pts")?.optDouble(1) ?: 0.0 }))
    private fun placeMarker(ev: MotionEvent): Boolean {
        val kind = markNext ?: return false
        val i = pageAt(ev.x, ev.y)
        if (i < 0) return true
        val r = pageRect(i, RectF()); val k = bs * zoom
        val x = (ev.x - r.left) / k; val y = (ev.y - r.top) / k
        val word = if (kind == "v") "Video" else "Folie"
        val n = (markers().filter { (it.optString("mk") == "v") == (kind == "v") }.maxOfOrNull { it.optString("text").filter { ch -> ch.isDigit() }.toIntOrNull() ?: 0 } ?: 0) + 1
        val text = "$word $n"
        val fs = 12f
        val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = fs; typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD) }
        val bw = max(fs * 0.5f, tp.measureText(text)); val bh = fs * 1.25f
        val r2 = { v: Float -> (v * 100).roundToInt() / 100.0 }
        val s = JSONObject().put("id", Store.uid()).put("p", i).put("t", "txt").put("c", "#5F3DC4").put("fs", 12).put("b", 1)
            .put("bg", "#EDE7FF").put("bo", "#7048E8").put("mk", if (kind == "v") "v" else "f")
            .put("pts", JSONArray(listOf(r2(x - bw / 2), r2(y - bh / 2)))).put("text", text).put("bw", r2(bw)).put("bh", r2(bh))
        Store.addStrokes(path, listOf(Rec.tag(s, path)))
        pushUndo(Act(listOf(s), emptyList()))
        markNext = null
        onHint("$text gesetzt.")
        invalidate()
        return true
    }

    private var txBusy = false
    private fun updateTxAsync(c: Cur) {
        if (txBusy) return
        val pt = pageText ?: return
        txBusy = true
        val ax = c.ax; val ay = c.ay; val bx = c.bx; val by = c.by
        textExec.execute {
            val r = PageText.rects(pt.chars(c.page), ax, ay, bx, by)
            main.post { txBusy = false; if (cur === c) { c.rects = r; if (c.bx != bx || c.by != by) updateTxAsync(c); invalidate() } }
        }
    }

    private fun eraseAt(c: Cur, x: Float, y: Float, rad: Float) {
        val d = doc ?: return
        val hit = d.strokes.values.filter { it.optInt("p") == c.page && Ink.hits(it, x, y, rad) }
        if (hit.isEmpty()) return
        c.removed.addAll(hit)
        Store.deleteStrokes(path, hit.map { it.getString("id") })
    }

    private fun endStroke() {
        val c = cur ?: return
        c.hold?.let { main.removeCallbacks(it) }
        cur = null
        eraserAt = null
        when (c.mode) {
            "tx" -> {
                val pt = pageText
                val rects = if (pt != null && c.page in textLoaded) PageText.rects(pt.chars(c.page), c.ax, c.ay, c.bx, c.by) else c.rects
                if (rects.isNotEmpty()) {
                    val s = JSONObject().put("id", Store.uid()).put("p", c.page).put("t", "tx").put("k", txKind).put("c", txColor)
                        .put("pts", JSONArray(rects.map { it.toDouble() }))
                    Store.addStrokes(path, listOf(Rec.tag(s, path))); pushUndo(Act(listOf(s), emptyList()))
                } else if (pt != null && pt.chars(c.page).isEmpty()) onHint("Auf dieser Seite gibt es keinen erkennbaren Text (z. B. ein Scan). Zum Markieren den freien Marker nehmen.")
                invalidate(); return
            }
            "sh" -> {
                if (hypot(c.bx - c.ax, c.by - c.ay) * c.k > 4) {
                    val r2 = { v: Float -> ((v * 100).roundToInt() / 100.0) }
                    val s = JSONObject().put("id", Store.uid()).put("p", c.page).put("t", "sh").put("k", shKind).put("c", shColor).put("w", c.w.toDouble())
                        .put("pts", JSONArray(listOf(r2(c.ax), r2(c.ay), r2(c.bx), r2(c.by))))
                    Store.addStrokes(path, listOf(Rec.tag(s, path))); pushUndo(Act(listOf(s), emptyList()))
                }
                invalidate(); return
            }
            "pick" -> {
                val moved = hypot(c.bx - c.ax, c.by - c.ay) * c.k
                val ps = pickSel
                if (c.hmode != "new" && ps != null) {
                    val xf = SelUi.xf(c.hmode, ps.second, c.ax, c.ay, c.bx, c.by, dens / c.k)
                    if (moved > 2) { val nb = xf.box(ps.second); pickSel = ps.first to nb; onPickSel(ps.first, nb) }
                } else if (moved < 10 * dens) onPickTap(c.page, c.ax, c.ay)
                else if (pick == "rect") {
                    val rr = RectF(min(c.ax, c.bx), min(c.ay, c.by), max(c.ax, c.bx), max(c.ay, c.by))
                    if (rr.width() * c.k > 6 && rr.height() * c.k > 6) onPickRect(c.page, rr)
                }
                invalidate(); return
            }
            "tap" -> {
                if (hypot(c.bx - c.ax, c.by - c.ay) * c.k < 12) {
                    val note = noteAt(c.page, c.ax, c.ay)
                    if (note != null || tool == "nt") onNote(c.page, c.ax - 4, c.ay - 4, note)
                    else {
                        val hit = inkOf(c.page).lastOrNull { it.optString("t") == "txt" && Ink.bounds(it).apply { inset(-4f, -4f) }.contains(c.ax, c.ay) }
                        onTextRequest(c.page, c.ax, c.ay, hit)
                    }
                }
                invalidate(); return
            }
            "lasso" -> {
                val poly = c.lasso
                val ids = HashSet<String>()
                var x0 = Float.MAX_VALUE; var x1 = -Float.MAX_VALUE; var y0 = Float.MAX_VALUE; var y1 = -Float.MAX_VALUE
                var q = 0; while (q + 1 < poly.size) { x0 = min(x0, poly[q]); x1 = max(x1, poly[q]); y0 = min(y0, poly[q + 1]); y1 = max(y1, poly[q + 1]); q += 2 }
                if ((x1 - x0 + y1 - y0) * c.k < 14 * dens) {
                    // kurz getippt: Bild, Stempel oder Textfeld darunter auswählen
                    inkOf(c.page).lastOrNull { (it.optString("t") == "img" || it.optString("t") == "txt") && Ink.bounds(it).contains(c.ax, c.ay) }?.let { ids.add(it.getString("id")) }
                } else if (poly.size >= 6) for (s in inkOf(c.page)) if (strokeInPoly(s, poly)) ids.add(s.getString("id"))
                sel = if (ids.isNotEmpty()) Sel(c.page, ids) else null
                onSelChanged(ids.size)
                invalidate(); return
            }
            "drag" -> {
                val sl = sel
                val xf = if (sl != null) curXf(c, sl) else null
                if (sl != null && xf != null && !xf.none && !(xf.kind == "move" && hypot(xf.dx, xf.dy) * c.k < 2)) {
                    val d = doc
                    val olds = sl.ids.mapNotNull { d?.strokes?.get(it) }
                    val moved = olds.map {
                        when (xf.kind) { "scale" -> Xform.scale(it, xf.f, xf.ax, xf.ay); "rot" -> Xform.rotate(it, xf.deg, xf.ax, xf.ay); else -> Xform.translate(it, xf.dx, xf.dy) }
                    }
                    Store.deleteStrokes(path, olds.map { it.getString("id") })
                    Store.addStrokes(path, moved)
                    pushUndo(Act(moved, olds))
                    sel = Sel(sl.page, moved.map { it.getString("id") }.toMutableSet())
                }
                invalidate(); return
            }
        }
        if (c.erase) {
            if (c.removed.isNotEmpty()) pushUndo(Act(emptyList(), c.removed.toList()))
            invalidate(); return
        }
        if (c.fast) post { overlay?.done() }
        if (c.pts.size < 3) { invalidate(); return }
        val s = JSONObject()
            .put("id", Store.uid()).put("p", c.page).put("t", c.t).put("c", c.c).put("w", c.w.toDouble())
            .put("pts", JSONArray(c.pts.map { it.toDouble() }))
        Store.addStrokes(path, listOf(Rec.tag(s, path)))
        pushUndo(Act(listOf(s), emptyList()))
        invalidate()
    }

    private fun cancelStroke() { if (cur?.fast == true) overlay?.cancel(); cur = null; eraserAt = null; invalidate() }

    var onHint: (String) -> Unit = {}

    // ---- Werkzeug-Modus (Schwärzen, Formularfeld, Text/Bild antippen): Bereiche aufziehen oder antippen
    var pick: String? = null; set(v) { field = v; if (v == null) { pickRects.clear(); pickBoxes = emptyList(); pickSel = null }; invalidate() }
    val pickRects = HashMap<Int, MutableList<RectF>>()          // z. B. Bereiche zum Schwärzen
    var pickBoxes: List<Pair<Int, RectF>> = emptyList(); set(v) { field = v; invalidate() }   // Hinweis-Rahmen (z. B. gefundene Bilder)
    var pickSel: Pair<Int, RectF>? = null; set(v) { field = v; invalidate() }                 // Bild mit Anfassern (verschieben, Größe)
    var onPickRect: (Int, RectF) -> Unit = { _, _ -> }
    var onPickTap: (Int, Float, Float) -> Unit = { _, _, _ -> }
    var onPickSel: (Int, RectF) -> Unit = { _, _ -> }
    private val pickFill = Paint().apply { color = Color.argb(150, 20, 20, 20) }
    private val pickLine = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = Color.parseColor("#1F4FD6") }
    private fun pickSelHit(x: Float, y: Float): String? {
        val ps = pickSel ?: return null
        if (ps.first >= pageCount) return null
        val r = pageRect(ps.first, RectF()); val k = bs * zoom
        return SelUi.hit(ps.second, (x - r.left) / k, (y - r.top) / k, dens / k)?.takeIf { it != "rot" }
    }
    // Anhören einer Tonaufnahme
    var playRec: String? = null
    var playMs = 0L
    var onAudioSeek: (Long) -> Unit = {}
    var onPresentTap: () -> Unit = {}
    var onLink: (path: String, page: Int) -> Unit = { _, _ -> }
    var onNote: (page: Int, x: Float, y: Float, existing: JSONObject?) -> Unit = { _, _, _, _ -> }
    /** gerade wird gezeichnet / ausgewählt – dann die Seite nicht austauschen */
    fun isBusy() = cur != null || sel != null

    /** Kommentar-Notizzettel unter dem Punkt (PDF-Punkte) */
    fun noteAt(page: Int, x: Float, y: Float): JSONObject? = inkOf(page).lastOrNull { it.optString("t") == "txt" && it.optInt("nt") == 1 && Ink.bounds(it).apply { inset(-5f, -5f) }.contains(x, y) }
    /** Kommentar anlegen, ändern (text) oder löschen (text leer) – mit Rückgängig */
    fun commitNote(page: Int, x: Float, y: Float, text: String, existing: JSONObject?) {
        val olds = listOfNotNull(existing)
        val t = text.trimEnd()
        if (existing != null && existing.optString("text") == t) return
        if (existing != null) Store.deleteStrokes(path, listOf(existing.getString("id")))
        if (t.isEmpty()) { if (existing != null) { pushUndo(Act(emptyList(), olds)); invalidate() }; return }
        if (existing == null) Usage.track("tool", "Kommentar angelegt")
        val pts = existing?.optJSONArray("pts") ?: JSONArray(listOf((x * 100).roundToInt() / 100.0, (y * 100).roundToInt() / 100.0))
        val s = JSONObject().put("id", Store.uid()).put("p", page).put("t", "txt").put("nt", 1).put("c", existing?.optString("c")?.takeIf { it.startsWith("#") } ?: "#FFD43B")
            .put("fs", 12).put("pts", pts).put("text", t).put("bw", 20).put("bh", 20)
        Store.addStrokes(path, listOf(Rec.tag(s, path)))
        pushUndo(Act(listOf(s), olds))
        invalidate()
    }

    /** neue Notiz (Bild, Stempel, Verknüpfung …) mit Rückgängig */
    fun addNew(s: JSONObject) { Store.addStrokes(path, listOf(Rec.tag(s, path))); pushUndo(Act(listOf(s), emptyList())); invalidate() }

    /** Mitte des sichtbaren Bereichs: Seite und Punkt (PDF-Punkte) */
    fun viewCenter(): Triple<Int, Float, Float> {
        val i = currentPage().coerceIn(0, maxOf(0, pageCount - 1))
        if (pageCount == 0) return Triple(0, 0f, 0f)
        val r = pageRect(i, RectF())
        val k = bs * zoom
        val x = ((width / 2f - r.left) / k).coerceIn(0f, pw[i]); val y = ((height / 2f - r.top) / k).coerceIn(0f, ph[i])
        return Triple(i, x, y)
    }

    // ---- Suche in der PDF
    class Hit(val page: Int, val rects: List<Float>)
    var hits: List<Hit> = emptyList(); set(v) { field = v; invalidate() }
    var hitCur = -1; set(v) { field = v; invalidate() }
    private val hitPaint = Paint().apply { color = Color.argb(90, 255, 140, 0) }
    private val hitCurPaint = Paint().apply { color = Color.argb(150, 255, 110, 0) }

    /** Seite i nach q durchsuchen (im Hintergrund), Ergebnis auf dem Haupt-Thread */
    fun searchPage(i: Int, q: String, cb: (List<List<Float>>) -> Unit) {
        val pt = pageText ?: run { cb(emptyList()); return }
        val g = gen
        textExec.execute { val r = pt.find(i, q); main.post { if (g == gen) cb(r) } }
    }

    fun showHit(k: Int) {
        val h = hits.getOrNull(k) ?: return
        hitCur = k
        val r = h.rects
        if (r.size < 4 || h.page >= pageCount) { goTo(h.page); return }
        if (zoom < 1f) zoom = 1f
        val cy = (pTop[h.page] + (r[1] + r[3] / 2) * bs) * zoom
        val cx = (pLeft[h.page] + (r[0] + r[2] / 2) * bs) * zoom
        sy = cy - height * 0.4f; sx = cx - width / 2f
        clamp(); invalidate(); reportPage(); scheduleDetail()
    }
    /** Fläche für verzögerungsfreies Schreiben (liegt genau über dieser Ansicht) */
    var overlay: InkOverlay? = null

    private fun strokeInPoly(s: JSONObject, poly: List<Float>): Boolean {
        val b = Ink.bounds(s)
        if (inPoly(b.centerX(), b.centerY(), poly)) return true
        val p = Ink.pts(s)
        val step = when (s.optString("t")) { "pen", "hl" -> 3; "tx" -> 4; "sh" -> 2; else -> 0 }
        if (step == 0) return false
        var hit = 0; var n = 0; var i = 0
        while (i + 1 < p.size) { n++; if (inPoly(p[i], p[i + 1], poly)) hit++; i += step }
        return n > 0 && hit * 2 >= n
    }

    private fun inPoly(x: Float, y: Float, p: List<Float>): Boolean {
        var inside = false
        val n = p.size / 2
        var j = n - 1
        for (i in 0 until n) {
            val xi = p[i * 2]; val yi = p[i * 2 + 1]; val xj = p[j * 2]; val yj = p[j * 2 + 1]
            if ((yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / ((yj - yi).takeIf { it != 0f } ?: 1e-6f) + xi) inside = !inside
            j = i
        }
        return inside
    }

    private fun selBounds(sl: Sel, dx: Float, dy: Float): RectF {
        val r = RectF(); var first = true
        val d = doc ?: return r
        for (id in sl.ids) { val s = d.strokes[id] ?: continue; val b = Ink.bounds(s); if (first) { r.set(b); first = false } else r.union(b) }
        r.offset(dx, dy)
        return r
    }

    override fun clearSel() { if (sel != null) { sel = null; onSelChanged(0); invalidate() } }

    fun deleteSelection() {
        val sl = sel ?: return
        val d = doc ?: return
        val olds = sl.ids.mapNotNull { d.strokes[it] }
        Store.deleteStrokes(path, olds.map { it.getString("id") })
        pushUndo(Act(emptyList(), olds))
        clearSel()
    }

    fun recolorSelection(color: String) {
        val sl = sel ?: return
        val d = doc ?: return
        val olds = sl.ids.mapNotNull { d.strokes[it] }.filter { it.optString("t") != "img" }
        if (olds.isEmpty()) return
        val news = olds.map { JSONObject(it.toString()).put("id", Store.uid()).put("c", color) }
        Store.deleteStrokes(path, olds.map { it.getString("id") }); Store.addStrokes(path, news)
        pushUndo(Act(news, olds))
        sel = Sel(sl.page, news.map { it.getString("id") }.toMutableSet()); invalidate()
    }

    /** Textfeld anlegen oder ändern (null = löschen) */
    fun commitText(page: Int, x: Float, y: Float, st: TextStyle?, existing: JSONObject?) {
        val olds = listOfNotNull(existing)
        if (st == null) {
            if (existing != null) { Store.deleteStrokes(path, listOf(existing.getString("id"))); pushUndo(Act(emptyList(), olds)) }
            return
        }
        val s = st.applyTo(if (existing != null) JSONObject(existing.toString()) else JSONObject().put("pts", JSONArray(listOf(((x * 100).roundToInt() / 100.0), ((y * 100).roundToInt() / 100.0)))))
            .put("id", Store.uid()).put("p", page)
        if (existing != null) Store.deleteStrokes(path, listOf(existing.getString("id")))
        Store.addStrokes(path, listOf(Rec.tag(s, path)))
        pushUndo(Act(listOf(s), olds))
    }

    /** einzelnes ausgewähltes Textfeld (zum Bearbeiten aus der Lasso-Leiste) */
    fun selectedText(): JSONObject? {
        val sl = sel ?: return null
        if (sl.ids.size != 1) return null
        return doc?.strokes?.get(sl.ids.first())?.takeIf { it.optString("t") == "txt" }
    }
    fun editSelectedText() {
        val s = selectedText() ?: return
        val p = Ink.pts(s)
        clearSel()
        if (s.optInt("nt") == 1) { onNote(s.optInt("p"), 0f, 0f, s); return }
        onTextRequest(s.optInt("p"), p.getOrElse(0) { 0f }, p.getOrElse(1) { 0f }, s)
    }

    /** kleine Vorschau einer Seite (für die Seitenleiste) */
    fun thumb(i: Int, w: Int, cb: (Bitmap?) -> Unit) {
        val g = gen
        if (i >= pageCount) { cb(null); return }
        val h = (w * ph[i] / pw[i]).roundToInt().coerceAtLeast(1)
        exec.execute {
            val r = renderer
            val bmp = if (g != gen || r == null) null else try {
                val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888); b.eraseColor(Color.WHITE)
                r.render(i, b, 0, 0, w, h)
                b
            } catch (e: Throwable) { null }
            main.post { if (g == gen) cb(bmp) else bmp?.recycle() }
        }
    }
    fun strokesOn(i: Int) = inkOf(i)
    fun pageWidthPt(i: Int) = if (i < pageCount) pw[i] else 1f
    fun pageAspect(i: Int) = if (i < pageCount) ph[i] / pw[i] else 1.4f

    // ================================================================== Rückgängig
    private fun pushUndo(a: Act) { undoStack.add(a); redoStack.clear(); onInkChanged() }
    private fun apply(a: Act): Act {
        if (a.added.isNotEmpty()) Store.deleteStrokes(path, a.added.map { it.getString("id") })
        val back = a.removed.map { JSONObject(it.toString()).put("id", Store.uid()) }
        if (back.isNotEmpty()) Store.addStrokes(path, back)
        return Act(back, a.added)
    }
    fun undo() { if (undoStack.isEmpty()) return; redoStack.add(apply(undoStack.removeAt(undoStack.size - 1))); onInkChanged() }
    fun redo() { if (redoStack.isEmpty()) return; undoStack.add(apply(redoStack.removeAt(redoStack.size - 1))); onInkChanged() }

    companion object { const val ERASE_PX = 12f }
}
