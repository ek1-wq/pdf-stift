package io.github.pdfstift

import android.content.Context
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File

/** Abstürze festhalten und beim nächsten Start an den Server schicken (damit Fehler ohne Rückfrage behoben werden können) */
object Crash {
    private lateinit var file: File

    fun init(ctx: Context) {
        file = File(ctx.filesDir, "crash.txt")
        val prev = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            try {
                val txt = "Version ${BuildConfig.VERSION_NAME} · Android ${Build.VERSION.RELEASE} (${Build.MANUFACTURER} ${Build.MODEL}) · Thread ${t.name}\n" + e.stackTraceToString().take(9000)
                file.writeText(txt)
            } catch (x: Throwable) { }
            prev?.uncaughtException(t, e)
        }
    }

    /** kleine Meldung ohne Absturz (z. B. Fehler beim Einbrennen) */
    fun report(what: String, e: Throwable?) {
        Usage.track("err", what, null, e?.let { "${it.javaClass.simpleName}: ${it.message ?: ""}".take(160) })
        val txt = "Version ${BuildConfig.VERSION_NAME} · ${Build.MANUFACTURER} ${Build.MODEL} · Hinweis: $what\n" + (e?.stackTraceToString()?.take(4000) ?: "")
        Store.scope.launch { send(txt) }
    }

    fun hadCrash() = ::file.isInitialized && file.isFile

    suspend fun sendPending() {
        if (!file.isFile) return
        if (send("ABSTURZ\n" + file.readText())) file.delete()
    }

    suspend fun send(txt: String): Boolean = withContext(Dispatchers.IO) {
        try {
            Api.http.newCall(Request.Builder().url(Api.BASE + "api.php?a=applog").header("X-PDFStift", "1")
                .post(txt.toRequestBody("text/plain; charset=utf-8".toMediaType())).build()).execute().use { it.isSuccessful }
        } catch (e: Exception) { false }
    }
}
