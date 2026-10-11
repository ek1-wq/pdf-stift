package io.github.pdfstift

import android.app.Activity
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import org.json.JSONObject

class LoginActivity : AppCompatActivity() {
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        if (Edition.FREE && (!Api.configured || intent.getBooleanExtra("choose", false))) { chooseMode(); return }
        loginForm()
    }

    /** freie Ausgabe: Offline (alles auf dem Tablet) oder Online (eigener Server) */
    private fun chooseMode() {
        val dp = { v: Float -> Ui.dp(this, v) }
        val title = Ui.text(this, "PDF-Stift einrichten", 26f, Ui.INK, true)
        val info = Ui.text(this, "Wie möchten Sie PDF-Stift nutzen? Sie können das später im Menü ändern.", 15f, Ui.MUTED)
        val off = Ui.button(this, "Offline – alles bleibt auf diesem Tablet", true) {
            Api.setMode("offline"); Store.init(applicationContext)
            setResult(Activity.RESULT_OK); finish()
        }
        val offInfo = Ui.text(this, "Keine Anmeldung, kein Server. PDFs, Notizen und Notizbücher liegen nur hier.", 13f, Ui.MUTED)
        val server = EditText(this).apply { hint = "Adresse, z. B. pdf.meine-domain.de"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI; textSize = 18f
            setText(if (Api.mode == "online") Api.BASE.removePrefix("https://").trimEnd('/') else "") }
        val err = Ui.text(this, "", 15f, 0xFFC62828.toInt())
        lateinit var on: View
        on = Ui.button(this, "Online – mit eigenem Server", false) {
            val adr = server.text.toString().trim()
            if (adr.isEmpty()) { err.text = "Bitte die Adresse Ihres PDF-Stift-Servers eintragen."; server.requestFocus(); return@button }
            on.isEnabled = false; err.text = ""
            lifecycleScope.launch {
                val old = Api.mode
                Api.setMode("online", adr)
                try {
                    val me = Api.get("me")
                    if (me.optBoolean("setup")) { err.text = "Der Server ist noch nicht eingerichtet: Adresse im Browser öffnen und ein Passwort festlegen."; Api.setMode(old) }
                    else { Store.init(applicationContext); recreate0() }
                } catch (e: Exception) { err.text = "Unter dieser Adresse antwortet kein PDF-Stift-Server."; Api.setMode(old) }
                on.isEnabled = true
            }
        }
        val how = Ui.text(this, "Eigenen Server einrichten (Subdomain + FTP, ca. 10 Minuten) – Anleitung", 14f, Ui.NAVY, true).apply {
            setOnClickListener { try { startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse("https://github.com/${Edition.REPO}/blob/main/docs/SERVER.md"))) } catch (e: Exception) { } }
        }
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = Ui.rounded(0xFFFFFFFF.toInt(), dp(20f).toFloat())
            setPadding(dp(28f), dp(28f), dp(28f), dp(28f))
            listOf(title, info, off, offInfo, Ui.text(this@LoginActivity, "oder", 14f, Ui.MUTED), server, on, how, err).forEach { addView(it, Ui.lp().apply { topMargin = dp(12f) }) }
        }
        val wrap = LinearLayout(this).apply {
            gravity = Gravity.CENTER; setPadding(dp(24f), dp(48f), dp(24f), dp(24f))
            addView(card, LinearLayout.LayoutParams(dp(500f), LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        setContentView(ScrollView(this).apply { setBackgroundColor(Ui.BG); addView(wrap) })
    }
    private fun recreate0() { intent.removeExtra("choose"); loginForm() }

    private fun loginForm() {
        val dp = { v: Float -> Ui.dp(this, v) }
        val title = Ui.text(this, "Anmelden", 26f, Ui.INK, true)
        val info = Ui.text(this, if (Edition.FREE) "PDF-Stift auf ${Api.BASE.removePrefix("https://").trimEnd('/')} – mit Ihrem PDF-Stift-Passwort. Danach bleiben Sie angemeldet." else "PDF-Stift auf pdf-stift.example.org – mit deinem PDF-Stift-Passwort. Danach bleibst du angemeldet.", 15f, Ui.MUTED)
        val pw = EditText(this).apply { hint = "Passwort"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD; textSize = 18f }
        val code = EditText(this).apply { hint = "Code aus der Authenticator-App"; inputType = InputType.TYPE_CLASS_TEXT; textSize = 18f; visibility = View.GONE }
        val err = Ui.text(this, "", 15f, 0xFFC62828.toInt())
        lateinit var go: View
        go = Ui.button(this, "Anmelden", true) {
            go.isEnabled = false; err.text = ""
            lifecycleScope.launch {
                try {
                    val body = JSONObject().put("password", pw.text.toString())
                    if (code.visibility == View.VISIBLE) body.put("code", code.text.toString().trim())
                    val r = Api.post("login", body)
                    if (r.optBoolean("need2fa")) {
                        code.visibility = View.VISIBLE; code.requestFocus()
                        info.text = "Passwort stimmt. Jetzt noch den Code aus der Authenticator-App eingeben."
                    } else {
                        setResult(Activity.RESULT_OK); finish()
                    }
                } catch (e: Api.ApiError) { err.text = e.message } catch (e: Exception) { err.text = "Keine Verbindung zum Server." }
                go.isEnabled = true
            }
        }
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = Ui.rounded(0xFFFFFFFF.toInt(), dp(20f).toFloat())
            setPadding(dp(28f), dp(28f), dp(28f), dp(28f))
            listOf(title, info, pw, code, go, err).forEach { addView(it, Ui.lp().apply { topMargin = dp(10f) }) }
            if (Edition.FREE) addView(Ui.text(this@LoginActivity, "Andere Adresse oder offline nutzen …", 14f, Ui.NAVY, true).apply { setOnClickListener { chooseMode() } }, Ui.lp().apply { topMargin = dp(10f) })
        }
        val wrap = LinearLayout(this).apply {
            gravity = Gravity.CENTER; setPadding(dp(24f), dp(48f), dp(24f), dp(24f))
            addView(card, LinearLayout.LayoutParams(dp(460f), LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        setContentView(ScrollView(this).apply { setBackgroundColor(Ui.BG); addView(wrap) })
    }
}
