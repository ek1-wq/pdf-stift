package io.github.pdfstift

import android.app.Activity
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import org.json.JSONObject
import kotlin.math.roundToInt

/** Aussehen eines Textfelds – gleiche Felder wie in der Web-App */
class TextStyle(val text: String, val fs: Float, val c: String, val b: Boolean, val i: Boolean, val bg: String, val bo: String) {
    fun typeface(): Typeface = Typeface.create(Typeface.SANS_SERIF, (if (b) Typeface.BOLD else 0) or (if (i) Typeface.ITALIC else 0))

    /** Breite und Höhe des Felds in den Einheiten von fs */
    fun measure(): Pair<Float, Float> {
        val p = Paint().apply { textSize = fs; typeface = typeface() }
        val lines = text.split("\n")
        val bw = lines.maxOf { p.measureText(it) }
        val bh = fs * 0.8f + (lines.size - 1) * fs * 1.25f + fs * 0.3f
        return bw to bh
    }

    /** in eine Notiz schreiben (Position und Drehung bleiben, wie sie sind) */
    fun applyTo(s: JSONObject): JSONObject {
        val (bw, bh) = measure()
        val r = { v: Float -> (v * 100).roundToInt() / 100.0 }
        s.put("t", "txt").put("text", text).put("fs", r(fs)).put("c", c).put("bw", r(bw)).put("bh", r(bh))
        if (b) s.put("b", 1) else s.remove("b")
        if (i) s.put("i", 1) else s.remove("i")
        if (bg.isNotEmpty()) s.put("bg", bg) else s.remove("bg")
        if (bo.isNotEmpty()) s.put("bo", bo) else s.remove("bo")
        return s
    }
}

object TextEditor {
    val BG = listOf("", "#FFF59D", "#FFE0B2", "#C8E6C9", "#BBDEFB", "#F8BBD0", "#FFFFFF", "#E0E0E0")
    private val COLORS = listOf("#1A1A1A", "#1F4FD6", "#D6262B", "#13804A", "#FF4A1C", "#A855F7", "#6B7280", "#FFFFFF")

    /**
     * Textfeld anlegen oder ändern: Text, Farbe, Größe, fett, kursiv, Hintergrund, Rahmen.
     * done(null) = löschen; Abbrechen ruft nichts auf.
     */
    fun show(a: Activity, ex: JSONObject?, defFs: Float, defColor: String, done: (TextStyle?) -> Unit) {
        val dp = { v: Float -> Ui.dp(a, v) }
        val pr = Store.prefs()
        var fs = ex?.optDouble("fs", defFs.toDouble())?.toFloat() ?: defFs
        var col = ex?.optString("c", defColor) ?: defColor
        var bold = ex?.optInt("b") == 1
        var ital = ex?.optInt("i") == 1
        var bg = ex?.optString("bg", "") ?: (pr.getString("ttBg", "") ?: "")
        var bo = ex?.optString("bo", "") ?: (pr.getString("ttBo", "") ?: "")
        // Darstellung im Dialog: Größe angenähert, damit man den Unterschied sieht
        val fs0 = fs

        val e = EditText(a).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            minLines = 3; gravity = Gravity.TOP; setText(ex?.optString("text") ?: "")
            setPadding(dp(12f), dp(10f), dp(12f), dp(10f))
        }
        val sizeV = Ui.text(a, "", 14f, Ui.MUTED).apply { setPadding(dp(8f), 0, dp(8f), 0) }
        lateinit var paint: () -> Unit
        fun chip(label: String, onClick: () -> Unit) = TextView(a).apply {
            text = label; textSize = 15f; gravity = Gravity.CENTER; setTextColor(Ui.NAVY)
            minWidth = dp(44f); setPadding(dp(10f), dp(6f), dp(10f), dp(6f))
            layoutParams = ViewGroup.MarginLayoutParams(-2, dp(38f)).apply { setMargins(dp(2f), dp(3f), dp(2f), dp(3f)) }
            setOnClickListener { onClick(); paint() }
        }
        val bBtn = chip("B") { bold = !bold }.apply { typeface = Typeface.DEFAULT_BOLD }
        val iBtn = chip("I") { ital = !ital }.apply { setTypeface(Typeface.SERIF, Typeface.ITALIC) }
        val boBtn = chip("▭ Rahmen") { bo = if (bo.isEmpty()) "#1A1A1A" else ""; if (ex == null) pr.edit().putString("ttBo", bo).apply() }
        val row1 = Flow(a, false).apply {
            addView(chip("A−") { fs = maxOf(6f, (fs / 1.15f).roundToInt().toFloat()) }); addView(sizeV); addView(chip("A+") { fs = minOf(120f, (fs * 1.15f).roundToInt().toFloat()) })
            addView(bBtn); addView(iBtn); addView(boBtn)
        }
        val colViews = COLORS.map { c ->
            Glyph(a, "sw", Color.parseColor(c), Glyph.SWATCH).apply {
                layoutParams = ViewGroup.MarginLayoutParams(dp(34f), dp(34f)).apply { setMargins(dp(1.5f), dp(3f), dp(1.5f), dp(3f)) }
                setOnClickListener { col = c; paint() }
            }
        }
        val bgViews = BG.map { c ->
            (if (c.isEmpty()) chip("∅") { bg = "" } else Glyph(a, "sw", Color.parseColor(c), Glyph.SWATCH).apply {
                layoutParams = ViewGroup.MarginLayoutParams(dp(34f), dp(34f)).apply { setMargins(dp(1.5f), dp(3f), dp(1.5f), dp(3f)) }
                setOnClickListener { bg = c; paint() }
            }).also { v -> if (c.isEmpty()) v.setOnClickListener { bg = ""; if (ex == null) pr.edit().putString("ttBg", "").apply(); paint() } else v.setOnClickListener { bg = c; if (ex == null) pr.edit().putString("ttBg", c).apply(); paint() } }
        }
        val row2 = Flow(a, false).apply { colViews.forEach { addView(it) } }
        val row3 = Flow(a, false).apply { bgViews.forEach { addView(it) } }
        paint = {
            sizeV.text = "${fs.roundToInt()} pt"
            e.setTextColor(try { Color.parseColor(col) } catch (x: Exception) { Color.BLACK })
            e.setTextSize(TypedValue.COMPLEX_UNIT_SP, (16f * fs / fs0.coerceAtLeast(1f)).coerceIn(10f, 40f))
            e.setTypeface(Typeface.SANS_SERIF, (if (bold) Typeface.BOLD else 0) or (if (ital) Typeface.ITALIC else 0))
            e.background = Ui.rounded(if (bg.isEmpty()) 0xFFF4F6FA.toInt() else Color.parseColor(bg), dp(8f).toFloat(), if (bo.isEmpty()) Ui.LINE else Color.parseColor(bo), dp(if (bo.isEmpty()) 1f else 2f))
            fun mark(v: View, on: Boolean) { if (v is Glyph) v.on = on else v.background = if (on) Ui.rounded(0xFFE3E8F5.toInt(), dp(10f).toFloat()) else null }
            mark(bBtn, bold); mark(iBtn, ital); mark(boBtn, bo.isNotEmpty())
            COLORS.forEachIndexed { k, c -> mark(colViews[k], c.equals(col, true)) }
            BG.forEachIndexed { k, c -> mark(bgViews[k], c.equals(bg, true)) }
        }
        paint()
        fun label(s: String) = Ui.text(a, s, 13f, Ui.MUTED, true).apply { setPadding(0, dp(10f), 0, dp(2f)) }
        val box = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(20f), dp(8f), dp(20f), 0)
            addView(e, Ui.lp()); addView(row1, Ui.lp())
            addView(label("Schriftfarbe")); addView(row2, Ui.lp())
            addView(label("Hintergrund")); addView(row3, Ui.lp())
        }
        val d = AlertDialog.Builder(a).setTitle(if (ex == null) "Neues Textfeld" else "Textfeld ändern").setView(ScrollView(a).apply { addView(box) })
            .setPositiveButton("Fertig") { _, _ ->
                val t = e.text.toString().trimEnd()
                if (t.isBlank()) { if (ex != null) done(null) } else done(TextStyle(t, fs, col, bold, ital, bg, bo))
            }
            .setNegativeButton("Abbrechen", null)
        if (ex != null) d.setNeutralButton("Löschen") { _, _ -> done(null) }
        val dlg = d.create()
        dlg.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
        dlg.show(); e.requestFocus()
    }
}
