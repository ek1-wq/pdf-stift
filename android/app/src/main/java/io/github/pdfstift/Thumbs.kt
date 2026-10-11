package io.github.pdfstift

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.util.LruCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.Request
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors

/** Vorschaubilder der ersten Seite für die Bibliothek: vom Server oder aus der PDF auf dem Tablet, dann gespeichert */
object Thumbs {
    private lateinit var dir: File
    private lateinit var app: Context
    private val mem = object : LruCache<String, Bitmap>(24 * 1024 * 1024) { override fun sizeOf(k: String, v: Bitmap) = v.byteCount }
    private val busy = HashSet<String>()
    private val render = Executors.newSingleThreadExecutor().asCoroutineDispatcher()

    fun init(ctx: Context) { app = ctx.applicationContext; dir = File(ctx.filesDir, "thumbs").apply { mkdirs() } }

    private fun key(f: LibFile) = MessageDigest.getInstance("SHA-1").digest(f.path.toByteArray()).joinToString("") { "%02x".format(it) } + "-" + f.mtime

    /** sofort aus dem Speicher, sonst null und später cb */
    fun get(f: LibFile, cb: (Bitmap) -> Unit): Bitmap? {
        val k = key(f)
        mem.get(k)?.let { return it }
        if (!busy.add(k)) return null
        Store.scope.launch {
            val b = try { load(f, k) } catch (e: Throwable) { null }
            busy.remove(k)
            if (b != null) { mem.put(k, b); cb(b) }
        }
        return null
    }

    private suspend fun load(f: LibFile, k: String): Bitmap? {
        val file = File(dir, "$k.jpg")
        if (file.isFile) return withContext(Dispatchers.IO) { BitmapFactory.decodeFile(file.path) }
        // 1. vom Server (dort meist schon vorhanden)
        if (f.thumb) {
            val bytes = withContext(Dispatchers.IO) {
                try {
                    Api.http.newCall(Request.Builder().url(Api.BASE + "api.php?a=thumb&path=" + java.net.URLEncoder.encode(f.path, "UTF-8")).build()).execute().use { r ->
                        if (r.isSuccessful) r.body?.bytes() else null
                    }
                } catch (e: Exception) { null }
            }
            if (bytes != null) { withContext(Dispatchers.IO) { file.writeBytes(bytes) }; return BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }
        }
        // 2. selbst aus der PDF auf dem Tablet zeichnen
        val pdf = Store.pdfFile(f.path)
        if (!pdf.isFile) return null
        return withContext(render) {
            val src = PdfSource(app, pdf)
            try {
                val (w, h) = src.size(0)
                val bw = 360; val bh = (bw * h / w).toInt().coerceIn(100, 800)
                val b = Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888); b.eraseColor(Color.WHITE)
                src.render(0, b, 0, 0, bw, bh)
                file.outputStream().use { b.compress(Bitmap.CompressFormat.JPEG, 82, it) }
                b
            } finally { src.close() }
        }
    }
}
