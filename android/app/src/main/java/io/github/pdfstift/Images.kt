package io.github.pdfstift

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import kotlinx.coroutines.launch
import okhttp3.Request
import java.io.File

/** Bilder in Notizen (Fotos, Stempel, Unterschrift): einmal vom Server holen, dann auf dem Tablet behalten */
object Images {
    private lateinit var dir: File
    private val mem = HashMap<String, Bitmap>()
    private val loading = HashSet<String>()
    var onLoaded: () -> Unit = {}

    fun init(ctx: Context) { dir = File(ctx.filesDir, "images").apply { mkdirs() } }

    fun file(src: String) = File(dir, src)

    fun get(src: String): Bitmap? {
        mem[src]?.let { return it }
        val f = file(src)
        if (f.isFile) {
            BitmapFactory.decodeFile(f.path)?.let { mem[src] = it; return it }
        }
        if (loading.add(src)) Store.scope.launch {
            try { bytes(src) } catch (e: Exception) { }
            loading.remove(src)
            if (file(src).isFile) onLoaded()
        }
        return null
    }

    /** Bilddaten (für das Einbrennen in die PDF) */
    suspend fun bytes(src: String): ByteArray {
        val f = file(src)
        if (f.isFile) return f.readBytes()
        val b = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            Api.http.newCall(Request.Builder().url(Api.BASE + "api.php?a=img&src=" + src).build()).execute().use { r ->
                if (!r.isSuccessful) throw Api.ApiError("Bild fehlt", r.code)
                r.body!!.bytes()
            }
        }
        f.writeBytes(b)
        return b
    }
}
