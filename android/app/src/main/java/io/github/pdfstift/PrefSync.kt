package io.github.pdfstift

import android.content.SharedPreferences
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Einstellungen der App (Werkzeugleiste, Stifte, Farben, Seitenleiste …) auf dem Server sichern.
 * Nach einer Neuinstallation holt die App sie beim ersten Start zurück.
 */
object PrefSync {
    private val KEYS = setOf(
        "tbDock", "tbFx", "tbFy", "tool", "penColor", "hlColor", "txColor", "txKind", "shColor", "shKind", "ttColor", "ttSize",
        "penWi", "hlWi", "shWi", "finger", "fingerB", "favs", "thumbPos", "thumbs", "grid", "libMode", "lowlat", "laserFinger",
        "ttBg", "ttBo", "offlineAll",
    )
    private var job: Job? = null
    private var applying = false
    private val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, key -> if (!applying && key in KEYS) schedule() }

    fun init() { Store.prefs().registerOnSharedPreferenceChangeListener(listener) }

    private fun schedule() {
        job?.cancel()
        job = Store.scope.launch { delay(3000); push() }
    }

    private fun collect(): JSONObject {
        val o = JSONObject()
        for ((k, v) in Store.prefs().all) if (k in KEYS && v != null) {
            // Typ merken, damit er beim Zurückholen stimmt
            o.put(k, when (v) { is Boolean -> "b:$v"; is Int -> "i:$v"; is Long -> "l:$v"; is Float -> "f:$v"; else -> "s:$v" })
        }
        return o
    }

    suspend fun push() {
        try { Api.post("prefs", JSONObject().put("app", collect())); Store.prefs().edit().putBoolean("prefsSynced", true).apply() } catch (e: Exception) { }
    }

    /** beim Start: noch nie abgeglichen (z. B. neu installiert)? Dann vom Server holen, sonst den Stand hochladen. */
    suspend fun startup(): Boolean {
        if (Store.prefs().getBoolean("prefsSynced", false)) return false
        try {
            val app = Api.get("prefs").optJSONObject("app")
            if (app != null && app.length() > 0) {
                applying = true
                val e = Store.prefs().edit()
                for (k in app.keys()) {
                    if (k !in KEYS) continue
                    val v = app.optString(k)
                    val body = v.substringAfter(':')
                    when (v.substringBefore(':')) {
                        "b" -> e.putBoolean(k, body == "true")
                        "i" -> body.toIntOrNull()?.let { e.putInt(k, it) }
                        "l" -> body.toLongOrNull()?.let { e.putLong(k, it) }
                        "f" -> body.toFloatOrNull()?.let { e.putFloat(k, it) }
                        else -> e.putString(k, body)
                    }
                }
                e.putBoolean("prefsSynced", true).commit()
                applying = false
                return true
            } else push()
        } catch (x: Exception) { applying = false }
        return false
    }
}
