package io.github.pdfstift

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.view.View
import android.widget.CheckBox
import android.widget.LinearLayout
import androidx.appcompat.app.AlertDialog
import kotlin.random.Random

/** kleine Leuchtdiode für die Texterkennung (wie die Festplatten-Lampe am PC): aus, flackert beim Erkennen, leerer Kreis = Automatik aus */
@SuppressLint("ViewConstructor")
class OcrLed(ctx: Context) : View(ctx) {
    private val d = resources.displayMetrics.density
    private val dot = Paint(Paint.ANTI_ALIAS_FLAG)
    private val txt = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 11f * d; color = Ui.MUTED; isFakeBoldText = true; letterSpacing = 0.06f }
    private var bright = true
    private val flicker = object : Runnable {
        override fun run() { if (!Ocr.running) return; bright = !bright || Random.nextFloat() < 0.4f; invalidate(); postDelayed(this, (60 + Random.nextInt(260)).toLong()) }
    }

    init { contentDescription = "Texterkennung" }

    fun update() {
        removeCallbacks(flicker)
        if (Ocr.running) post(flicker)
        requestLayout(); invalidate()
    }

    private fun label() = if (Ocr.running && Ocr.total > 0) "OCR ${Ocr.pg}/${Ocr.total}" else "OCR"

    override fun onMeasure(w: Int, h: Int) {
        setMeasuredDimension((txt.measureText(label()) + 22 * d).toInt(), (32 * d).toInt())
    }

    override fun onDraw(c: Canvas) {
        val cy = height / 2f; val cx = 9 * d; val r = 3.5f * d
        when {
            Ocr.running -> { dot.style = Paint.Style.FILL; dot.color = Color.parseColor("#C98A3A"); dot.alpha = if (bright) 190 else 100; c.drawCircle(cx, cy, r, dot) }
            Settings.autoOcr -> { dot.style = Paint.Style.FILL; dot.color = Color.parseColor("#9AA0AA"); dot.alpha = 140; c.drawCircle(cx, cy, r, dot) }
            else -> { dot.style = Paint.Style.STROKE; dot.strokeWidth = 1.3f * d; dot.color = Color.parseColor("#9AA0AA"); dot.alpha = 180; c.drawCircle(cx, cy, r, dot) }
        }
        txt.alpha = if (!Ocr.running && !Settings.autoOcr) 110 else 200
        txt.isStrikeThruText = !Ocr.running && !Settings.autoOcr
        c.drawText(label(), cx + r + 6 * d, cy + txt.textSize * 0.36f, txt)
    }

    override fun onDetachedFromWindow() { removeCallbacks(flicker); super.onDetachedFromWindow() }

    companion object {
        /** Fenster beim Antippen: Fortschritt, Automatik an/aus, Anhalten, diese PDF jetzt erkennen */
        fun dialog(h: ToolHost, led: OcrLed) {
            val a = h.act
            val dp = { v: Float -> Ui.dp(a, v) }
            val status = Ui.text(a, if (Ocr.running) "Läuft: Seite ${Ocr.pg} von ${Ocr.total}" else "Gerade läuft keine Texterkennung.", 15f)
            val auto = CheckBox(a).apply { text = "Scans automatisch erkennen"; isChecked = Settings.autoOcr }
            val box = LinearLayout(a).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(20f), dp(8f), dp(20f), 0)
                addView(Ui.text(a, "Macht Scans durchsuchbar und markierbar – im Hintergrund, Sie können währenddessen weiterarbeiten.", 13f, Ui.MUTED))
                addView(status); addView(auto)
            }
            val b = AlertDialog.Builder(a).setTitle("Texterkennung").setView(box).setNegativeButton("Schließen", null)
            if (Ocr.running) b.setPositiveButton("Anhalten") { _, _ -> Ocr.stopReq = true; Ui.toast(a, "Wird nach dieser Seite angehalten.") }
            else b.setPositiveButton("Diese PDF jetzt erkennen") { _, _ -> Ocr.autoForce(h); led.update() }
            val dlg = b.show()
            auto.setOnCheckedChangeListener { _, on ->
                Settings.autoOcr = on
                if (!on && Ocr.running) Ocr.stopReq = true
                Settings.push()
                led.update()
                if (on) { Ocr.autoForce(h); dlg.dismiss() }
            }
        }
    }
}
