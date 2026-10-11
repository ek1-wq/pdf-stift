package io.github.pdfstift

import android.app.Activity
import android.graphics.Color
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Aufnahmen anhören: Leiste unten; Notizen, die später geschrieben wurden, sind blass; Tippen auf eine Notiz springt dorthin. */
object Player {
    private var mp: MediaPlayer? = null
    private var bar: View? = null
    private var view: DocView? = null
    private val h = Handler(Looper.getMainLooper())
    private var playBtn: TextView? = null
    private var timeV: TextView? = null
    private var seek: SeekBar? = null
    private var dragging = false
    private val df = SimpleDateFormat("dd.MM.yyyy, HH:mm", Locale.GERMANY)

    fun fmt(ms: Long): String { val s = ms / 1000; return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%d:%02d".format(s / 60, s % 60) }

    /** Liste der Aufnahmen dieser PDF (Server + noch nicht hochgeladene) */
    fun choose(a: Activity, path: String, v: DocView, frame: FrameLayout) {
        Store.scope.launch {
            val recs = ArrayList<JSONObject>()
            try { Api.get("audiols", mapOf("path" to path)).optJSONArray("recs")?.let { for (i in 0 until it.length()) recs.add(it.getJSONObject(i)) } } catch (e: Exception) { }
            val pend = Rec.pending()
            for (i in 0 until pend.length()) { val j = pend.getJSONObject(i); if (j.optString("path") == path && recs.none { it.optString("id") == j.optString("id") }) recs.add(JSONObject(j.toString()).put("t", j.optLong("t") / 1000)) }
            // auch Aufnahmen, die nur in den Notizen vorkommen und hier auf dem Tablet liegen
            if (recs.isEmpty()) { Ui.alert(a, "Keine Aufnahmen", "Zu dieser PDF gibt es noch keine Tonaufnahme. Starten: ⋯ → „Tonaufnahme starten“."); return@launch }
            recs.sortByDescending { it.optLong("t") }
            val labels = recs.map { r -> (if (r.optLong("t") > 0) df.format(Date(r.optLong("t") * 1000)) else "Aufnahme") + " · " + fmt(r.optLong("dur")) }
            AlertDialog.Builder(a).setTitle("Aufnahmen anhören").setItems(labels.toTypedArray()) { _, i -> open(a, path, recs[i], v, frame) }.setNegativeButton("Schließen", null).show()
        }
    }

    private fun open(a: Activity, path: String, r: JSONObject, v: DocView, frame: FrameLayout) {
        val id = r.optString("id")
        val f = File(Rec.dir(a), "$id.m4a")
        Store.scope.launch {
            if (!f.isFile) {
                val pr = Ui.Progress(a, "Aufnahme wird geladen …")
                try {
                    val tmp = File(f.path + ".part")
                    Api.fetchFile(Api.BASE + "api.php?a=audio&id=$id", tmp) { d, t -> a.runOnUiThread { pr.set(d, if (t > 0) t else r.optLong("size")) } }
                    tmp.renameTo(f)
                } catch (e: Exception) { pr.close(); Ui.alert(a, "Nicht geladen", e.message ?: "Keine Verbindung."); return@launch }
                pr.close()
            }
            close()
            val m = try { MediaPlayer().apply { setDataSource(f.path); prepare() } } catch (e: Exception) { Ui.alert(a, "Abspielen nicht möglich", e.message ?: ""); return@launch }
            mp = m; view = v
            m.setOnCompletionListener { upd() }
            v.playRec = id; v.playMs = 0
            v.onAudioSeek = { ms -> seekTo(ms - 1500); if (mp?.isPlaying != true) mp?.start(); upd() }
            buildBar(a, path, id, frame)
            m.start(); tick()
            Ui.toast(a, "Tipp auf eine Notiz: Du hörst, was du beim Schreiben gesagt hast.", true)
        }
    }

    private fun buildBar(a: Activity, path: String, id: String, frame: FrameLayout) {
        val dp = { x: Float -> Ui.dp(a, x) }
        fun btn(s: String, click: () -> Unit) = Ui.text(a, s, 18f, Color.WHITE, true).apply { setPadding(dp(12f), dp(6f), dp(12f), dp(6f)); setOnClickListener { click() } }
        playBtn = btn("❚❚") { val m = mp ?: return@btn; if (m.isPlaying) m.pause() else m.start(); upd() }
        timeV = Ui.text(a, "", 14f, Color.WHITE).apply { setPadding(dp(6f), 0, dp(6f), 0) }
        seek = SeekBar(a).apply {
            max = mp?.duration ?: 0
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(s: SeekBar?, p: Int, user: Boolean) { if (user) { view?.playMs = p.toLong(); view?.invalidate(); timeV?.text = fmt(p.toLong()) + " / " + fmt((mp?.duration ?: 0).toLong()) } }
                override fun onStartTrackingTouch(s: SeekBar?) { dragging = true }
                override fun onStopTrackingTouch(s: SeekBar?) { dragging = false; seekTo(s?.progress?.toLong() ?: 0) }
            })
        }
        val b = LinearLayout(a).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            background = Ui.rounded(0xE61B1F29.toInt(), dp(14f).toFloat()); elevation = dp(6f).toFloat()
            setPadding(dp(6f), dp(4f), dp(6f), dp(4f))
            addView(btn("−15") { seekTo((mp?.currentPosition ?: 0) - 15000L) })
            addView(playBtn); addView(btn("+15") { seekTo((mp?.currentPosition ?: 0) + 15000L) })
            addView(seek, Ui.lp(0, -2, 1f)); addView(timeV)
            addView(btn("🗑") {
                Ui.alert(a, "Aufnahme löschen?", "Die Tonaufnahme wird auf dem Server und auf dem Tablet gelöscht. Die Notizen bleiben.", "Löschen", "Abbrechen") {
                    close(); File(Rec.dir(a), "$id.m4a").delete()
                    Store.scope.launch { try { Api.post("audiodel", JSONObject().put("path", path).put("id", id)) } catch (e: Exception) { } }
                }
            })
            addView(btn("✕") { close() })
        }
        frame.addView(b, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM).apply { setMargins(dp(12f), 0, dp(12f), dp(12f)) })
        bar = b
        upd()
    }

    private fun seekTo(ms: Long) {
        val m = mp ?: return
        val t = ms.coerceIn(0L, m.duration.toLong())
        m.seekTo(t.toInt()); view?.playMs = t; view?.invalidate(); upd()
    }

    private val tickR = Runnable { tick() }
    private fun tick() {
        h.removeCallbacks(tickR)
        val m = mp ?: return
        if (!dragging) { val p = m.currentPosition.toLong(); seek?.progress = p.toInt(); view?.let { if (it.playMs / 500 != p / 500) { it.playMs = p; it.invalidate() } } }
        upd()
        h.postDelayed(tickR, 250)
    }

    private fun upd() {
        val m = mp ?: return
        playBtn?.text = if (m.isPlaying) "❚❚" else "▶"
        if (!dragging) timeV?.text = fmt(m.currentPosition.toLong()) + " / " + fmt(m.duration.toLong())
    }

    fun close() {
        h.removeCallbacks(tickR)
        try { mp?.release() } catch (e: Exception) { }
        mp = null
        (bar?.parent as? FrameLayout)?.removeView(bar); bar = null
        view?.let { it.playRec = null; it.onAudioSeek = {}; it.invalidate() }
        view = null
    }
}
