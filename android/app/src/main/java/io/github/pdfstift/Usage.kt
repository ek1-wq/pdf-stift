package io.github.pdfstift

import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/** Nutzungsprotokoll (nur auf dem eigenen Server): welche Werkzeuge, Fehler, Dauer – ohne Inhalte und Dateinamen */
object Usage {
    private val q = ArrayList<JSONObject>()
    private var job: Job? = null
    private var loaded = false

    private fun anon(t: String) = t.replace(Regex("„[^“]*“"), "„…“").replace(Regex("[^\\s/]+\\.(pdf|docx?|pptx?|xlsx?)", RegexOption.IGNORE_CASE), "[Datei]")
        .replace(Regex("/[^\\s]*/"), "…/").take(200)

    fun track(k: String, n: String, ms: Long? = null, x: String? = null) {
        try { add(k, n, ms, x) } catch (e: Throwable) { }
    }

    private fun add(k: String, n: String, ms: Long?, x: String?) {
        if (!Settings.usage) return
        val e = JSONObject().put("t", System.currentTimeMillis() / 1000).put("k", k).put("n", anon(n))
        if (ms != null) e.put("ms", ms)
        if (!x.isNullOrEmpty()) e.put("x", anon(x))
        synchronized(q) {
            load()
            q.add(e); while (q.size > 400) q.removeAt(0)
            save()
        }
        job?.cancel()
        job = Store.scope.launch { delay(15000); flush() }
    }

    private fun load() {
        if (loaded) return
        loaded = true
        try { val a = JSONArray(Store.prefs().getString("usageQ", "[]")); for (i in 0 until a.length()) q.add(a.getJSONObject(i)) } catch (e: Exception) { }
    }
    private fun save() { Store.prefs().edit().putString("usageQ", JSONArray(q).toString()).apply() }

    suspend fun flush() {
        val batch = synchronized(q) { load(); val b = q.take(300); q.subList(0, b.size).clear(); save(); b }
        if (batch.isEmpty()) return
        try {
            Api.post("usage", JSONObject().put("ev", JSONArray(batch)).put("dev", "Android").put("v", BuildConfig.VERSION_NAME))
        } catch (e: Exception) {
            if (e is Api.ApiError && e.code != 401) return
            synchronized(q) { q.addAll(0, batch); save() }
        }
    }

    fun flushSoon() { Store.scope.launch { flush() } }

    /** Bericht der letzten 30 Tage holen und anzeigen: kopieren oder weitergeben */
    fun report(a: android.app.Activity) {
        val pr = Ui.Progress(a, "Bericht wird erstellt …")
        Store.scope.launch {
            flush()
            val txt = try { Api.text("usagereport", mapOf("days" to "30")) } catch (e: Exception) { null }
            pr.close()
            if (txt == null) { Ui.alert(a, "Kein Bericht", "Der Bericht ließ sich nicht laden – ist Internet da?"); return@launch }
            val tv = android.widget.TextView(a).apply { text = txt; setTextIsSelectable(true); textSize = 12f; typeface = android.graphics.Typeface.MONOSPACE; setPadding(Ui.dp(a, 16f), Ui.dp(a, 8f), Ui.dp(a, 16f), 0) }
            androidx.appcompat.app.AlertDialog.Builder(a).setTitle("Bericht für Verbesserungen").setView(android.widget.ScrollView(a).apply { addView(tv) })
                .setPositiveButton("Kopieren") { _, _ ->
                    (a.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager).setPrimaryClip(android.content.ClipData.newPlainText("PDF-Stift Bericht", txt))
                    Ui.toast(a, "Bericht kopiert – jetzt im Chat einfügen.")
                }
                .setNeutralButton("Weitergeben") { _, _ ->
                    a.startActivity(android.content.Intent.createChooser(android.content.Intent(android.content.Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(android.content.Intent.EXTRA_TEXT, txt) }, "Bericht weitergeben"))
                }
                .setNegativeButton("Schließen", null).show()
        }
    }
}
