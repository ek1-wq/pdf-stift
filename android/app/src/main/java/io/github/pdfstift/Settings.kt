package io.github.pdfstift

import android.app.Activity
import android.widget.ArrayAdapter
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.Spinner
import androidx.appcompat.app.AlertDialog
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Einstellungen, die auf allen Geräten gelten (wie in der Windows-App unter Datei → Einstellungen) */
object Settings {
    private val p get() = Store.prefs()
    var autoOcr: Boolean
        get() = p.getBoolean("setAutoOcr", true)
        set(v) { p.edit().putBoolean("setAutoOcr", v).apply() }
    var redactPurge: Boolean
        get() = p.getBoolean("setRedactPurge", true)
        set(v) { p.edit().putBoolean("setRedactPurge", v).apply() }
    var usage: Boolean
        get() = p.getBoolean("setUsage", true)
        set(v) { p.edit().putBoolean("setUsage", v).apply() }
    var keepVersions: Int
        get() = p.getInt("setKeep", 5)
        set(v) { p.edit().putInt("setKeep", v).apply() }

    /** Stand vom Server holen (beim Start) */
    suspend fun load() {
        try {
            val s = Api.get("prefs").optJSONObject("settings") ?: return
            if (s.has("autoOcr")) autoOcr = s.optBoolean("autoOcr", true)
            if (s.has("redactPurge")) redactPurge = s.optBoolean("redactPurge", true)
            if (s.has("usage")) usage = s.optBoolean("usage", true)
            if (s.has("keepVersions")) keepVersions = s.optInt("keepVersions", 5).coerceIn(0, 10)
        } catch (e: Exception) { }
    }

    /** nur an den Server senden (z. B. nach dem Umschalten der Automatik) */
    fun push() {
        Store.scope.launch {
            try { Api.post("prefs", JSONObject().put("settings", JSONObject().put("autoOcr", autoOcr).put("redactPurge", redactPurge).put("keepVersions", keepVersions).put("usage", usage))) } catch (e: Exception) { }
        }
    }

    fun dialog(a: Activity) {
        val d = Ui.dp(a, 1f)
        val ocr = CheckBox(a).apply { text = "Scans automatisch durchsuchbar machen"; isChecked = autoOcr }
        val ocrHint = Ui.text(a, "Erkennt Text in eingescannten PDFs von selbst, sobald sie geöffnet werden.", 13f, Ui.MUTED).apply { setPadding(32 * d, 0, 0, 12 * d) }
        val purge = CheckBox(a).apply { text = "Beim Schwärzen die alten Fassungen löschen"; isChecked = redactPurge }
        val purgeHint = Ui.text(a, "Sonst bleibt die ungeschwärzte Fassung als Sicherung auf dem Server.", 13f, Ui.MUTED).apply { setPadding(32 * d, 0, 0, 12 * d) }
        val use = CheckBox(a).apply { text = "Nutzungsprotokoll führen"; isChecked = usage }
        val useHint = Ui.text(a, "Nur auf Ihrem Server: welche Werkzeuge, Fehler und Wartezeiten – keine Inhalte, keine Dateinamen.", 13f, Ui.MUTED).apply { setPadding(32 * d, 0, 0, 12 * d) }
        val keeps = listOf(0, 1, 3, 5, 10)
        val keepSp = Spinner(a).apply {
            adapter = ArrayAdapter(a, android.R.layout.simple_spinner_dropdown_item, keeps.map { if (it == 0) "keine" else if (it == 5) "5 (empfohlen)" else "$it" })
            setSelection(keeps.indexOf(keepVersions).takeIf { it >= 0 } ?: 3)
        }
        val box = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL; setPadding(20 * d, 8 * d, 20 * d, 0)
            addView(ocr); addView(ocrHint); addView(purge); addView(purgeHint)
            addView(Ui.text(a, "Frühere Fassungen aufheben", 14f)); addView(keepSp)
            addView(use); addView(useHint)
        }
        AlertDialog.Builder(a).setTitle("Einstellungen").setView(box).setNegativeButton("Abbrechen", null)
            .setPositiveButton("Speichern") { _, _ ->
                autoOcr = ocr.isChecked; redactPurge = purge.isChecked; usage = use.isChecked; keepVersions = keeps[keepSp.selectedItemPosition.coerceIn(0, keeps.size - 1)]
                Store.scope.launch {
                    try {
                        Api.post("prefs", JSONObject().put("settings", JSONObject().put("autoOcr", autoOcr).put("redactPurge", redactPurge).put("keepVersions", keepVersions).put("usage", usage)))
                        Ui.toast(a, "Einstellungen gespeichert – gilt auf allen Geräten.")
                    } catch (e: Exception) { Ui.toast(a, "Auf dem Tablet gespeichert. Für alle Geräte bitte mit Internet noch einmal speichern.", true) }
                }
            }.show()
    }
}
