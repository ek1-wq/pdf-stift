package io.github.pdfstift

import android.app.Activity
import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.PixelCopy
import android.widget.CheckBox
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import androidx.appcompat.app.AlertDialog
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.ByteArrayOutputStream

/** „Fehler melden“: kurze Beschreibung und Bildschirmfoto an den Server (landet bei den Absturzberichten). */
object Report {
    /** context = was gerade offen ist (z. B. PDF-Pfad, Seite) */
    fun show(a: Activity, context: String = "") {
        shot(a) { bmp -> dialog(a, bmp, context) }
    }

    /** Bildschirmfoto des Fensters, genau wie man es sieht (auch die Schreibfläche) */
    private fun shot(a: Activity, done: (Bitmap?) -> Unit) {
        val v = a.window.decorView
        if (v.width == 0 || v.height == 0) { done(null); return }
        val bmp = try { Bitmap.createBitmap(v.width, v.height, Bitmap.Config.ARGB_8888) } catch (e: Throwable) { done(null); return }
        try {
            PixelCopy.request(a.window, bmp, { r -> done(if (r == PixelCopy.SUCCESS) bmp else null) }, Handler(Looper.getMainLooper()))
        } catch (e: Throwable) { done(null) }
    }

    private fun dialog(a: Activity, bmp: Bitmap?, context: String) {
        val dp = { v: Float -> Ui.dp(a, v) }
        val e = EditText(a).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            minLines = 3; gravity = Gravity.TOP; hint = "Was ist passiert? Was hätte passieren sollen?"
        }
        val cb = CheckBox(a).apply { text = "Bildschirmfoto mitschicken"; isChecked = bmp != null; isEnabled = bmp != null }
        val box = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(20f), dp(8f), dp(20f), 0)
            addView(e, Ui.lp()); addView(cb, Ui.lp())
            if (bmp != null) addView(ImageView(a).apply {
                setImageBitmap(bmp); adjustViewBounds = true; scaleType = ImageView.ScaleType.FIT_START
                background = Ui.rounded(0xFFF4F6FA.toInt(), dp(6f).toFloat(), Ui.LINE, dp(1f)); setPadding(dp(2f), dp(2f), dp(2f), dp(2f))
            }, LinearLayout.LayoutParams(-1, dp(170f)).apply { topMargin = dp(4f) })
        }
        val dlg = AlertDialog.Builder(a).setTitle("Fehler melden").setView(box)
            .setPositiveButton("Senden", null).setNegativeButton("Abbrechen", null).create()
        dlg.setOnShowListener {
            dlg.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val txt = e.text.toString().trim()
                if (txt.isEmpty()) { e.error = "Bitte kurz beschreiben."; return@setOnClickListener }
                dlg.dismiss()
                send(a, txt, context, if (cb.isChecked) bmp else null)
            }
        }
        dlg.show()
    }

    private fun send(a: Activity, txt: String, context: String, bmp: Bitmap?) {
        val info = "Version ${BuildConfig.VERSION_NAME} · Android ${Build.VERSION.RELEASE} (${Build.MANUFACTURER} ${Build.MODEL}) · ${a.javaClass.simpleName}" +
            (if (context.isNotEmpty()) " · $context" else "")
        val owner = a as? LifecycleOwner ?: return
        owner.lifecycleScope.launch {
            val jpg = if (bmp == null) null else withContext(Dispatchers.Default) {
                val sc = minOf(1f, 1600f / maxOf(bmp.width, bmp.height))
                val b2 = if (sc < 1f) Bitmap.createScaledBitmap(bmp, (bmp.width * sc).toInt(), (bmp.height * sc).toInt(), true) else bmp
                ByteArrayOutputStream().also { b2.compress(Bitmap.CompressFormat.JPEG, 80, it) }.toByteArray()
            }
            val ok = try {
                val f = MultipartBody.Builder().setType(MultipartBody.FORM).addFormDataPart("text", txt).addFormDataPart("info", info)
                if (jpg != null) f.addFormDataPart("shot", "shot.jpg", jpg.toRequestBody("image/jpeg".toMediaType()))
                Api.postForm("appreport", f.build()); true
            } catch (x: Exception) {
                // ältere Server-Version: wenigstens den Text schicken
                Crash.send("FEHLERMELDUNG\n$info\n$txt" + (if (jpg != null) "\n(Bildschirmfoto konnte nicht gesendet werden: ${x.message})" else ""))
            }
            Ui.toast(a, if (ok) "Danke! Die Meldung ist angekommen." else "Senden hat nicht geklappt – bitte später noch einmal (Internet?).", true)
        }
    }
}
