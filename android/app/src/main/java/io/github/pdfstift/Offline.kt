package io.github.pdfstift

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.StatFs
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** „Alle PDFs auf dem Tablet halten“: lädt im WLAN nach und nach alles herunter (neueste zuerst), solange Platz ist */
object Offline {
    var on: Boolean
        get() = Store.prefs().getBoolean("offlineAll", false)
        set(v) { Store.prefs().edit().putBoolean("offlineAll", v).apply() }
    var onProgress: (String) -> Unit = {}
    private var job: Job? = null

    private fun wifi(ctx: Context): Boolean {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val c = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return c.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }

    fun start(ctx: Context) {
        if (!on || job?.isActive == true) return
        job = Store.scope.launch {
            val lib = Store.cachedLibrary() ?: return@launch
            val todo = Store.files(lib).filter { !Store.isCurrent(it) && !(Store.hasLocal(it.path) && Store.isNewerLocal(it)) }.sortedByDescending { it.mtime }
            var done = 0
            for (f in todo) {
                if (!on) break
                if (!wifi(ctx)) { onProgress("Alle PDFs halten: wartet auf WLAN"); break }
                val st = StatFs(ctx.filesDir.path)
                if (st.availableBytes < f.size * 2 + 500L * 1024 * 1024) { onProgress("Alle PDFs halten: Speicher fast voll – angehalten"); break }
                if (Burn.isBusy(f.path)) continue
                onProgress("Lädt aufs Tablet: ${done + 1} von ${todo.size}")
                try { Api.download(f.path, Store.pdfFile(f.path)) { _, _ -> }; Store.markLocal(f.path, f.mtime, f.size); done++ } catch (e: Exception) { delay(3000) }
            }
            if (done == todo.size) onProgress("")
        }
    }

    fun stop() { job?.cancel(); job = null; onProgress("") }
}
