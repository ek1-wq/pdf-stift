package io.github.pdfstift

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Tonaufnahme zur Vorlesung: jeder Strich, der während der Aufnahme entsteht, merkt sich die Stelle (au = [Aufnahme, ms]).
 * Beim Anhören tippt man auf eine Notiz und hört, was in diesem Moment gesagt wurde.
 */
object Rec {
    var active = false; private set
    var id = ""; private set
    var path = ""; private set
    private var t0 = 0L
    private var epoch = 0L
    private var file: File? = null
    private var mr: MediaRecorder? = null
    var onChange: () -> Unit = {}

    fun dir(ctx: Context) = File(ctx.filesDir, "audio").apply { mkdirs() }
    fun newId() = (1..16).map { "abcdefghijklmnopqrstuvwxyz0123456789"[(Math.random() * 36).toInt()] }.joinToString("")
    fun ms() = if (active) SystemClock.elapsedRealtime() - t0 else 0L

    /** null = läuft; sonst Fehlermeldung */
    fun start(ctx: Context, docPath: String): String? {
        if (active) return null
        val nid = newId()
        val f = File(dir(ctx), "$nid.m4a")
        val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(ctx) else @Suppress("DEPRECATION") MediaRecorder()
        return try {
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioChannels(1); r.setAudioSamplingRate(32000); r.setAudioEncodingBitRate(48000)
            r.setOutputFile(f.path)
            r.prepare(); r.start()
            mr = r; file = f; id = nid; path = docPath
            t0 = SystemClock.elapsedRealtime(); epoch = System.currentTimeMillis()
            active = true; onChange(); null
        } catch (e: Exception) {
            try { r.release() } catch (x: Exception) { }
            f.delete(); "Die Aufnahme konnte nicht starten (${e.message ?: "Mikrofon belegt?"})."
        }
    }

    /** Strich der Aufnahme zuordnen (nur wenn gerade für diese PDF aufgenommen wird) */
    fun tag(s: JSONObject, docPath: String): JSONObject {
        if (active && docPath == path && !s.has("au")) s.put("au", JSONArray(listOf(id, ms())))
        return s
    }

    fun stop() {
        if (!active) return
        val dur = ms()
        try { mr?.stop() } catch (e: Exception) { }
        try { mr?.release() } catch (e: Exception) { }
        mr = null; active = false
        val f = file
        if (f != null && f.isFile && f.length() > 0) {
            val pend = pending()
            pend.put(JSONObject().put("id", id).put("path", path).put("t", epoch).put("dur", dur))
            Store.prefs().edit().putString("audioPending", pend.toString()).apply()
            Store.scope.launch { uploadPending(f.parentFile!!) }
        }
        onChange()
    }

    fun pending(): JSONArray = try { JSONArray(Store.prefs().getString("audioPending", "[]")) } catch (e: Exception) { JSONArray() }

    /** noch nicht hochgeladene Aufnahmen schicken (auch beim nächsten Start) */
    suspend fun uploadPending(dir: File) {
        val pend = pending()
        val left = JSONArray()
        for (i in 0 until pend.length()) {
            val j = pend.getJSONObject(i)
            val f = File(dir, j.optString("id") + ".m4a")
            if (!f.isFile) continue
            val ok = try {
                val b = MultipartBody.Builder().setType(MultipartBody.FORM)
                    .addFormDataPart("path", j.optString("path")).addFormDataPart("id", j.optString("id"))
                    .addFormDataPart("t", (j.optLong("t") / 1000).toString()).addFormDataPart("dur", j.optLong("dur").toString())
                    .addFormDataPart("file", f.name, f.asRequestBody("audio/mp4".toMediaType())).build()
                Api.postForm("audioput", b); true
            } catch (e: Exception) { false }
            if (!ok) left.put(j)
        }
        Store.prefs().edit().putString("audioPending", left.toString()).apply()
    }
}
