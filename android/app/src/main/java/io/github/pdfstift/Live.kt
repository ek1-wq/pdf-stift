package io.github.pdfstift

import android.graphics.Bitmap
import android.graphics.Color
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * Live-Mitschau wie in der Web-App: Studierende öffnen den Link (QR-Code) und sehen Seite, Notizen und Laserpointer live.
 * Gleiche Schnittstelle (livestart / livepush / livestop), die Zuschauerseite ist live.php auf dem Server.
 */
object Live {
    var code: String? = null; private set
    var viewers = 0; private set
    var onChange: () -> Unit = {}
    /** liefert, was gerade gezeigt wird: Pfad, Seite, Notizen der Seite, Laserspuren */
    class Snap(val path: String, val page: Int, val strokes: List<JSONObject>, val laser: List<List<DoubleArray>>)
    var source: (() -> Snap?)? = null

    private var keep: Job? = null
    private var soonJob: Job? = null
    private var busy = false
    private var again = false
    private var last = 0L
    private var sentKey = ""
    private var hadLaser = false

    fun url(c: String) = Api.BASE + "live.php?c=" + c

    suspend fun start(path: String) {
        val r = Api.post("livestart", JSONObject().put("path", path))
        code = r.getString("code"); viewers = 0; sentKey = ""
        keep?.cancel()
        keep = Store.scope.launch { while (code != null) { push(); delay(10000) } }
        onChange()
    }

    fun stop() {
        val c = code ?: return
        code = null; keep?.cancel(); soonJob?.cancel()
        onChange()
        Store.scope.launch { try { Api.post("livestop", JSONObject().put("code", c)) } catch (e: Exception) { } }
    }

    /** bald senden (gebündelt) – fast für den Laser */
    fun soon(fast: Boolean = false) {
        if (code == null || soonJob?.isActive == true) return
        val gap = if (fast) 120L else 300L
        soonJob = Store.scope.launch { delay(maxOf(0L, gap - (System.currentTimeMillis() - last))); push() }
    }

    private suspend fun push() {
        val c = code ?: return
        val s = source?.invoke() ?: return
        if (busy) { again = true; return }
        busy = true; last = System.currentTimeMillis()
        val body = JSONObject().put("code", c).put("path", s.path).put("page", s.page).put("cur", JSONObject.NULL)
        val key = s.path + "|" + s.page + "|" + s.strokes.size + "|" + s.strokes.joinToString(",") { it.optString("id") }
        if (key != sentKey) { body.put("strokes", JSONArray(s.strokes)); sentKey = key }
        if (s.laser.isNotEmpty() || hadLaser) body.put("laser", JSONArray(s.laser.map { tr -> JSONArray(tr.map { JSONArray(listOf(it[0], it[1], it[2].toLong())) }) }))
        hadLaser = s.laser.isNotEmpty()
        try {
            val r = Api.post("livepush", body)
            if (r.optBoolean("ended")) { code = null; keep?.cancel(); onChange() }
            else if (r.optInt("viewers") != viewers) { viewers = r.optInt("viewers"); onChange() }
        } catch (e: Exception) { sentKey = "" }
        busy = false
        if (again) { again = false; soon() }
        // solange der Laser verblasst, weiter senden
        if (hadLaser) soon(true)
    }

    fun qr(text: String, size: Int): Bitmap {
        val m = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, mapOf(EncodeHintType.MARGIN to 1))
        val px = IntArray(size * size) { i -> if (m.get(i % size, i / size)) Color.BLACK else Color.WHITE }
        return Bitmap.createBitmap(px, size, size, Bitmap.Config.ARGB_8888)
    }
}
