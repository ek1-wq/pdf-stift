package io.github.pdfstift

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog

/** kleine Bausteine für die Oberfläche (ohne XML-Layouts) */
object Ui {
    const val NAVY = 0xFF1E2F6E.toInt()
    const val INK = 0xFF1B1F29.toInt()
    const val MUTED = 0xFF6B7280.toInt()
    const val BG = 0xFFE9ECF2.toInt()
    const val LINE = 0xFFD5D9E2.toInt()

    fun dp(c: Context, v: Float) = (v * c.resources.displayMetrics.density).toInt()

    fun text(c: Context, s: String = "", size: Float = 16f, color: Int = INK, bold: Boolean = false) = TextView(c).apply {
        text = s; textSize = size; setTextColor(color)
        if (bold) typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    }

    fun rounded(fill: Int, radius: Float, stroke: Int = 0, strokeW: Int = 0) = GradientDrawable().apply {
        setColor(fill); cornerRadius = radius
        if (strokeW > 0) setStroke(strokeW, stroke)
    }

    fun button(c: Context, s: String, primary: Boolean = false, onClick: () -> Unit) = Button(c).apply {
        text = s; isAllCaps = false; textSize = 16f
        setTextColor(if (primary) Color.WHITE else NAVY)
        background = rounded(if (primary) NAVY else Color.WHITE, dp(c, 12f).toFloat(), LINE, if (primary) 0 else dp(c, 1f))
        setPadding(dp(c, 18f), dp(c, 10f), dp(c, 18f), dp(c, 10f))
        setOnClickListener { onClick() }
    }

    fun lp(w: Int = ViewGroup.LayoutParams.MATCH_PARENT, h: Int = ViewGroup.LayoutParams.WRAP_CONTENT, weight: Float = 0f) =
        LinearLayout.LayoutParams(w, h, weight)

    fun toast(c: Context, s: String, long: Boolean = false) = Toast.makeText(c, s, if (long) Toast.LENGTH_LONG else Toast.LENGTH_SHORT).show()

    fun alert(a: Activity, title: String, msg: String, ok: String = "OK", cancel: String? = null, onOk: () -> Unit = {}) {
        val b = AlertDialog.Builder(a).setTitle(title).setMessage(msg).setPositiveButton(ok) { _, _ -> onOk() }
        if (cancel != null) b.setNegativeButton(cancel, null)
        b.show()
    }

    class Progress(a: Activity, title: String) {
        val bar = ProgressBar(a, null, android.R.attr.progressBarStyleHorizontal).apply { max = 1000; isIndeterminate = true }
        val label = text(a, "", 14f, MUTED)
        val dlg: AlertDialog
        init {
            val box = LinearLayout(a).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(a, 24f), dp(a, 8f), dp(a, 24f), dp(a, 4f))
                addView(bar, lp()); addView(label, lp())
            }
            dlg = AlertDialog.Builder(a).setTitle(title).setView(box).setCancelable(false).create()
            dlg.show()
        }
        fun set(done: Long, total: Long) {
            if (total > 0) { bar.isIndeterminate = false; bar.progress = (done * 1000 / total).toInt() }
            label.text = if (total > 0) "${mb(done)} von ${mb(total)}" else mb(done)
        }
        fun close() = dlg.dismiss()
    }

    fun mb(b: Long): String = if (b < 1024 * 1024) "${(b / 1024).coerceAtLeast(1)} KB" else String.format("%.1f MB", b / 1048576.0).replace('.', ',')

    fun row(c: Context, vararg views: View) = LinearLayout(c).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        views.forEach { addView(it) }
    }
}
