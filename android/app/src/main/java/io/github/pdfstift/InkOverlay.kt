package io.github.pdfstift

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.BlendMode
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.view.Display
import android.view.View
import android.os.Build
import android.view.MotionEvent
import android.view.SurfaceView
import androidx.annotation.RequiresApi
import androidx.graphics.lowlatency.CanvasFrontBufferedRenderer

/**
 * Stift ohne Verzögerung: die entstehende Linie wird direkt in den Bildschirmspeicher gezeichnet
 * (an Android vorbei, das sonst 2–3 Bilder puffert). Nach dem Absetzen übernimmt die normale Ansicht.
 */
@SuppressLint("ViewConstructor")
class InkOverlay(ctx: Context) : SurfaceView(ctx) {
    class Seg(val x0: Float, val y0: Float, val cx: Float, val cy: Float, val x1: Float, val y1: Float, val w: Float, val color: Int)

    private var r: CanvasFrontBufferedRenderer<Seg>? = null
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
    val ready get() = r != null && !external
    /** Monitor/Beamer angeschlossen (gespiegelt): dann bremst der direkte Weg – normaler Zeichenweg statt Stift-Schnellweg */
    private var external = false
    private val dm get() = context.getSystemService(DisplayManager::class.java)
    private fun hasExternal() = try { dm?.displays?.any { it.displayId != Display.DEFAULT_DISPLAY } == true } catch (e: Throwable) { false }
    private val listener = object : DisplayManager.DisplayListener {
        override fun onDisplayAdded(id: Int) = check()
        override fun onDisplayRemoved(id: Int) = check()
        override fun onDisplayChanged(id: Int) {}
    }
    private fun check() {
        val ext = hasExternal()
        if (ext == external) return
        external = ext
        if (ext) { release(); visibility = View.GONE }
        else { visibility = View.VISIBLE; post { start() } }
    }
    private fun start() {
        if (r != null || external) return
        if (Build.VERSION.SDK_INT >= 29 && Store.prefs().getBoolean("lowlat", true)) {
            try { r = make() } catch (e: Throwable) { r = null; Crash.report("Schneller Stift nicht verfügbar", e) }
        }
    }
    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        try { dm?.registerDisplayListener(listener, handler) } catch (e: Throwable) { }
        check()
    }
    override fun onDetachedFromWindow() {
        try { dm?.unregisterDisplayListener(listener) } catch (e: Throwable) { }
        super.onDetachedFromWindow()
    }

    init {
        setZOrderOnTop(true)
        holder.setFormat(PixelFormat.TRANSLUCENT)
        isClickable = false; isFocusable = false
        external = hasExternal()
        if (external) visibility = View.GONE else start()
    }

    @RequiresApi(29)
    private fun make() = CanvasFrontBufferedRenderer(this, object : CanvasFrontBufferedRenderer.Callback<Seg> {
        override fun onDrawFrontBufferedLayer(canvas: Canvas, bufferWidth: Int, bufferHeight: Int, param: Seg) {
            paint.color = param.color; paint.strokeWidth = param.w
            canvas.drawPath(Path().apply { moveTo(param.x0, param.y0); quadTo(param.cx, param.cy, param.x1, param.y1) }, paint)
        }
        override fun onDrawMultiBufferedLayer(canvas: Canvas, bufferWidth: Int, bufferHeight: Int, params: Collection<Seg>) {
            canvas.drawColor(Color.TRANSPARENT, BlendMode.CLEAR)
        }
    })

    /** ein Stück Linie sofort zeigen (Bildschirmkoordinaten dieser Fläche) */
    fun seg(s: Seg) { try { r?.renderFrontBufferedLayer(s) } catch (e: Throwable) { fail(e) } }
    /** Strich fertig: Vordergrund leeren, die normale Ansicht zeigt ihn jetzt */
    fun done() { try { r?.commit() } catch (e: Throwable) { fail(e) } }
    fun cancel() { try { r?.cancel() } catch (e: Throwable) { fail(e) } }

    private fun fail(e: Throwable) { Crash.report("Schneller Stift abgeschaltet", e); try { r?.release(true) } catch (x: Throwable) { }; r = null }

    fun release() { try { r?.release(true) } catch (e: Throwable) { }; r = null }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent?) = false
}
