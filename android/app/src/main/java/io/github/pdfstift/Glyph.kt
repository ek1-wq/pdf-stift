package io.github.pdfstift

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.view.View
import kotlin.math.min

/**
 * Gezeichnete Symbole für die Werkzeugleiste – schlicht und zeitlos:
 *  FAV:   Stifte stehen wie in einer Stiftablage, der gewählte hebt sich leicht an (Spitze in seiner Farbe)
 *  TOOL:  feine Linien-Symbole
 *  SWATCH: Farbkreis, gewählt mit weißem Spalt und Ring in derselben Farbe
 *  WIDTH: Strichprobe in der jeweiligen Stärke
 */
@SuppressLint("ViewConstructor")
class Glyph(ctx: Context, val kind: String, var color: Int, val style: Int, var widthPx: Float = 0f) : View(ctx) {
    companion object { const val FAV = 0; const val TOOL = 1; const val SWATCH = 2; const val WIDTH = 3 }
    var on = false; set(v) { field = v; invalidate() }
    private val d = resources.displayMetrics.density
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }
    private val NAVY = Ui.NAVY
    private val INK = 0xFF2A2F3A.toInt()
    private val SOFT = 0xFFE7EBF4.toInt()

    private fun light(c: Int) = (Color.red(c) * 299 + Color.green(c) * 587 + Color.blue(c) * 114) / 1000 > 200

    override fun onDraw(c: Canvas) {
        when (style) {
            SWATCH -> swatch(c)
            WIDTH -> width(c)
            TOOL -> tool(c)
            else -> fav(c)
        }
    }

    private fun swatch(c: Canvas) {
        val cx = width / 2f; val cy = height / 2f
        val r = min(width, height) / 2f - 3 * d
        fill.color = color
        if (on) {
            fill.style = Paint.Style.STROKE; fill.strokeWidth = 2.2f * d
            c.drawCircle(cx, cy, r, fill)
            fill.style = Paint.Style.FILL
            c.drawCircle(cx, cy, r - 4.2f * d, fill)
        } else {
            fill.style = Paint.Style.FILL
            c.drawCircle(cx, cy, r - 2.5f * d, fill)
            if (light(color)) { line.color = 0x22000000; line.strokeWidth = 1f * d; c.drawCircle(cx, cy, r - 2.5f * d, line) }
        }
    }

    private fun width(c: Canvas) {
        if (on) { fill.color = SOFT; c.drawRoundRect(RectF(2 * d, 2 * d, width - 2 * d, height - 2 * d), 10 * d, 10 * d, fill) }
        line.color = if (on) NAVY else INK; line.strokeWidth = widthPx * d
        c.drawLine(width * 0.28f, height / 2f, width * 0.72f, height / 2f, line)
    }

    /** feine Linien-Symbole in einem 24er-Raster */
    private fun tool(c: Canvas) {
        if (on) { fill.color = SOFT; c.drawRoundRect(RectF(2 * d, 2 * d, width - 2 * d, height - 2 * d), 11 * d, 11 * d, fill) }
        val s = min(width, height) / 32f
        c.save(); c.translate((width - 24 * s) / 2, (height - 24 * s) / 2); c.scale(s, s)
        val col = if (on) NAVY else INK
        line.color = col; line.strokeWidth = 1.7f; line.pathEffect = null
        fill.color = col
        when (kind) {
            "pen" -> {
                c.drawPath(Path().apply { moveTo(4f, 20f); lineTo(5f, 16f); lineTo(15.5f, 5.5f); cubicTo(16.3f, 4.7f, 17.7f, 4.7f, 18.5f, 5.5f); cubicTo(19.3f, 6.3f, 19.3f, 7.7f, 18.5f, 8.5f); lineTo(8f, 19f); close() }, line)
                c.drawLine(13.5f, 7.5f, 16.5f, 10.5f, line)
            }
            "hl" -> {
                c.drawPath(Path().apply { moveTo(7f, 14f); lineTo(14.5f, 6.5f); lineTo(18.5f, 10.5f); lineTo(11f, 18f); lineTo(7f, 18f); close() }, line)
                c.drawLine(9f, 12f, 13f, 16f, line)
                line.color = 0xFFE0B400.toInt(); line.strokeWidth = 2.6f; c.drawLine(4f, 21.5f, 13f, 21.5f, line)
            }
            "tx" -> {
                fill.color = 0x66FFD43B; c.drawRoundRect(RectF(3f, 13f, 21f, 20f), 1.5f, 1.5f, fill)
                text.color = col; text.textSize = 15f; text.typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
                c.drawText("A", 12f, 18.5f, text)
            }
            "sh" -> { c.drawCircle(9f, 9.5f, 5f, line); c.drawRoundRect(RectF(11f, 11.5f, 20f, 20.5f), 1.5f, 1.5f, line) }
            "tt" -> {
                text.color = col; text.textSize = 19f; text.typeface = Typeface.create(Typeface.SERIF, Typeface.NORMAL)
                c.drawText("T", 12f, 19f, text)
            }
            "nt" -> {
                c.drawPath(Path().apply { moveTo(4.5f, 5f); lineTo(19.5f, 5f); lineTo(19.5f, 15.5f); lineTo(11f, 15.5f); lineTo(7f, 19.5f); lineTo(7f, 15.5f); lineTo(4.5f, 15.5f); close() }, line)
                c.drawLine(8f, 9f, 16f, 9f, line); c.drawLine(8f, 12f, 14f, 12f, line)
            }
            "la" -> {
                line.pathEffect = DashPathEffect(floatArrayOf(2.4f, 2.2f), 0f)
                c.drawOval(RectF(3.5f, 4f, 20.5f, 15f), line)
                line.pathEffect = null
                c.drawPath(Path().apply { moveTo(8f, 14.5f); cubicTo(6f, 17f, 7f, 20f, 10f, 20.5f) }, line)
            }
            "er" -> {
                c.drawPath(Path().apply { moveTo(7.5f, 19f); lineTo(4f, 15.5f); cubicTo(3.4f, 14.9f, 3.4f, 14f, 4f, 13.4f); lineTo(12.4f, 5f); cubicTo(13f, 4.4f, 13.9f, 4.4f, 14.5f, 5f); lineTo(19.5f, 10f); cubicTo(20.1f, 10.6f, 20.1f, 11.5f, 19.5f, 12.1f); lineTo(12.6f, 19f); close() }, line)
                c.drawLine(9f, 9f, 15f, 15f, line); c.drawLine(12.6f, 19f, 20f, 19f, line)
            }
            "undo", "redo" -> {
                if (kind == "redo") { c.scale(-1f, 1f, 12f, 12f) }
                c.drawPath(Path().apply { moveTo(8.5f, 9f); lineTo(14.5f, 9f); cubicTo(18f, 9f, 20f, 11.2f, 20f, 14f); cubicTo(20f, 16.8f, 18f, 19f, 14.5f, 19f); lineTo(9f, 19f) }, line)
                c.drawPath(Path().apply { moveTo(11.5f, 5.5f); lineTo(8f, 9f); lineTo(11.5f, 12.5f) }, line)
            }
            "cam" -> {
                c.drawRoundRect(RectF(3f, 7f, 21f, 19.5f), 2.5f, 2.5f, line)
                c.drawPath(Path().apply { moveTo(8f, 7f); lineTo(9.5f, 4.5f); lineTo(14.5f, 4.5f); lineTo(16f, 7f) }, line)
                c.drawCircle(12f, 13f, 3.6f, line)
            }
            "+" -> { c.drawLine(12f, 6f, 12f, 18f, line); c.drawLine(6f, 12f, 18f, 12f, line) }
            "grip" -> { fill.color = 0xFFAAB2C5.toInt(); for (x in listOf(9f, 15f)) for (y in listOf(6f, 12f, 18f)) c.drawCircle(x, y, 1.5f, fill) }
        }
        c.restore()
    }

    /** Stiftablage: aufrechte Stifte, der gewählte ist angehoben */
    private fun fav(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        val s = min(w / 28f, h / 44f)
        val lift = if (on) -6f else 0f
        c.save(); c.translate((w - 28 * s) / 2, (h - 44 * s) / 2 + 4 * s); c.scale(s, s)
        when (kind) {
            "pen" -> {
                c.translate(0f, lift)
                body(c, 7.5f, 20.5f)
                fill.color = 0xFFF1E4D3.toInt()
                c.drawPath(Path().apply { moveTo(7.5f, 16f); lineTo(20.5f, 16f); lineTo(16f, 6f); lineTo(12f, 6f); close() }, fill)
                fill.color = color
                c.drawPath(Path().apply { moveTo(12f, 6f); lineTo(16f, 6f); lineTo(14f, 1.5f); close() }, fill)
                c.drawRect(7.5f, 19f, 20.5f, 24f, fill)
            }
            "hl" -> {
                c.translate(0f, lift)
                body(c, 6.5f, 21.5f)
                fill.color = color; fill.alpha = 235
                c.drawPath(Path().apply { moveTo(9f, 16f); lineTo(19f, 16f); lineTo(19f, 6f); lineTo(9f, 10f); close() }, fill)
                fill.alpha = 255
                c.drawRect(6.5f, 19f, 21.5f, 24f, fill)
            }
            "er" -> {
                c.translate(0f, lift)
                body(c, 8f, 20f, 14f)
                fill.color = 0xFFF4A7B9.toInt()
                c.drawRoundRect(RectF(8f, 6f, 20f, 18f), 3f, 3f, fill)
                fill.color = 0xFFB9C1D3.toInt(); c.drawRect(8f, 16f, 20f, 18f, fill)
            }
            "tx", "ul" -> {
                val r = RectF(2f, 6f + lift / 2, 26f, 30f + lift / 2)
                if (kind == "tx") { fill.color = color; c.drawRoundRect(r, 7f, 7f, fill) }
                else { fill.color = 0xFFF3F5F9.toInt(); c.drawRoundRect(r, 7f, 7f, fill) }
                text.color = INK; text.textSize = 16f; text.typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
                c.drawText("A", 14f, r.top + 17.5f, text)
                if (kind == "ul") { fill.color = color; c.drawRoundRect(RectF(7f, r.top + 19.5f, 21f, r.top + 22f), 1f, 1f, fill) }
                if (on) { line.color = NAVY; line.strokeWidth = 2.2f; c.drawRoundRect(RectF(r.left - 1.5f, r.top - 1.5f, r.right + 1.5f, r.bottom + 1.5f), 8.5f, 8.5f, line) }
            }
        }
        c.restore()
        if (on && kind != "tx" && kind != "ul") { fill.color = NAVY; c.drawCircle(w / 2, h - 3 * d, 2.2f * d, fill) }
    }

    /** Stiftkörper (weiß mit feinem Rand), unten abgeschnitten wie in einer Ablage */
    private fun body(c: Canvas, l: Float, r: Float, top: Float = 16f) {
        fill.color = 0xFFFFFFFF.toInt()
        val rr = RectF(l, top, r, 46f)
        c.drawRoundRect(rr, 2.5f, 2.5f, fill)
        line.color = 0xFFD3D9E6.toInt(); line.strokeWidth = 1f; line.pathEffect = null
        c.drawRoundRect(rr, 2.5f, 2.5f, line)
    }
}
