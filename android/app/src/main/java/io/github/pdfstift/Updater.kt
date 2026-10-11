package io.github.pdfstift

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.appcompat.app.AlertDialog
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.File

/**
 * Updates direkt in der App: neue Fassung von pdf-stift.example.org laden und installieren.
 * Android fragt zur Sicherheit einmal nach („Aktualisieren“); ab Android 12 geht es danach meist ganz ohne Rückfrage.
 */
object Updater {
    var latest: JSONObject? = null
    var onChange: () -> Unit = {}
    val hasUpdate get() = (latest?.optInt("versionCode") ?: 0) > BuildConfig.VERSION_CODE

    /** freie Ausgabe: Versionsnummer „1.2.3“ → 10203 (wie beim Bauen der App) */
    fun codeOf(v: String): Int { val p = v.trim().removePrefix("v").split('.').map { it.filter(Char::isDigit).toIntOrNull() ?: 0 } + listOf(0, 0, 0); return p[0] * 10000 + p[1] * 100 + p[2] }

    suspend fun refresh(): JSONObject? {
        latest = try {
            if (Edition.FREE) {
                // neueste Fassung auf GitHub (Releases), die APK hängt dort an
                val r = Api.fetchJson("https://api.github.com/repos/${Edition.REPO}/releases/latest")
                val assets = r.optJSONArray("assets") ?: org.json.JSONArray()
                val apk = (0 until assets.length()).map { assets.getJSONObject(it) }.firstOrNull { it.optString("name").endsWith(".apk") }
                val v = r.optString("tag_name").removePrefix("v")
                if (apk == null) latest else JSONObject().put("versionCode", codeOf(v)).put("versionName", v).put("apkUrl", apk.optString("browser_download_url")).put("notes", r.optString("name"))
            } else Api.fetchJson(Api.BASE + "android/version.json?t=" + System.currentTimeMillis())
        } catch (e: Exception) { latest }
        onChange()
        return latest
    }

    /** beim Start: still prüfen; bei neuer Fassung kurz fragen */
    /** In der Ausgabe für Google Play aktualisiert der Play Store – dort keine eigene Update-Funktion */
    val enabled get() = !BuildConfig.PLAY

    suspend fun check(a: Activity, silent: Boolean) {
        if (!enabled) return
        val j = refresh()
        if (j == null) { if (!silent) Ui.toast(a, "Keine Verbindung zum Server."); return }
        if (!hasUpdate) { if (!silent) Ui.toast(a, "Die App ist auf dem neuesten Stand (${BuildConfig.VERSION_NAME})."); return }
        AlertDialog.Builder(a).setTitle("Neue Version: ${j.optString("versionName")}")
            .setMessage("${j.optString("notes")}\n\nInstalliert ist ${BuildConfig.VERSION_NAME}. Notizen und Anmeldung bleiben erhalten.")
            .setPositiveButton("Aktualisieren") { _, _ -> start(a) }
            .setNegativeButton("Später", null)
            .show()
    }

    fun start(a: Activity) {
        if (!enabled) return
        val j = latest ?: return
        if (!a.packageManager.canRequestPackageInstalls()) {
            Ui.alert(a, "Einmal erlauben", "Damit sich PDF-Stift selbst aktualisieren kann, fragt Android jetzt einmal nach. Bitte den Schalter einschalten und mit „Zurück“ hierher kommen – das Update startet dann von selbst.", "Weiter") {
                waiting = true
                a.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.packageName)))
            }
            return
        }
        val pr = Ui.Progress(a, "PDF-Stift ${j.optString("versionName")} wird geladen …")
        Store.scope.launch {
            val f = File(a.cacheDir, "update/pdfstift.apk")
            try {
                Api.fetchFile(j.optString("apkUrl").ifEmpty { Api.BASE + j.optString("apk", "android/pdfstift.apk") + "?v=" + j.optInt("versionCode") }, f) { d, t -> a.runOnUiThread { pr.set(d, t) } }
                pr.label.text = "Wird installiert …"
                install(a, f)
                pr.close()
            } catch (e: Exception) {
                pr.close(); Ui.alert(a, "Update fehlgeschlagen", e.message ?: "Keine Verbindung.")
            }
        }
    }

    private var waiting = false
    /** zurück aus den Einstellungen: weitermachen */
    fun resume(a: Activity) {
        if (waiting && a.packageManager.canRequestPackageInstalls()) { waiting = false; start(a) }
    }

    private fun install(ctx: Context, f: File) {
        val pi = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(ctx.packageName)
        if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        val id = pi.createSession(params)
        pi.openSession(id).use { s ->
            s.openWrite("pdfstift.apk", 0, f.length()).use { out -> f.inputStream().use { it.copyTo(out) }; s.fsync(out) }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            val cb = PendingIntent.getBroadcast(ctx, id, Intent(ctx, InstallReceiver::class.java), flags)
            s.commit(cb.intentSender)
        }
    }
}

/** Rückmeldung von Android: Bestätigung anzeigen oder Fehler melden */
class InstallReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) {
        when (i.getIntExtra(PackageInstaller.EXTRA_STATUS, -999)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION") val confirm = i.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
                ctx.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            PackageInstaller.STATUS_SUCCESS -> {}
            else -> {
                val msg = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "unbekannter Fehler"
                android.widget.Toast.makeText(ctx, "Update nicht installiert: $msg", android.widget.Toast.LENGTH_LONG).show()
            }
        }
    }
}
