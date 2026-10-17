package io.github.pdfstift

import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import java.io.File
import java.net.URLEncoder

/** Präsentationen (Folieneditor mit Skizze → Folie) – derselbe Editor wie am PC, aus dem eigenen Server geladen */
class DeckActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private var fileCb: ValueCallback<Array<Uri>>? = null
    private val pick = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        fileCb?.onReceiveValue(if (uri != null) arrayOf(uri) else arrayOf()); fileCb = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        val path = intent.getStringExtra("path") ?: run { finish(); return }
        val base = Api.BASE
        val cm = CookieManager.getInstance()
        cm.setAcceptCookie(true)
        for (c in Api.cookieStrings()) cm.setCookie(base, c)
        cm.flush()
        web = WebView(this)
        cm.setAcceptThirdPartyCookies(web, false)
        web.settings.apply {
            javaScriptEnabled = true; domStorageEnabled = true; databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false; allowFileAccess = false; builtInZoomControls = false
            setSupportZoom(false); textZoom = 100
        }
        web.addJavascriptInterface(Bridge(), "PdfstiftAndroid")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                val u = r.url.toString()
                if (u.startsWith(base)) return false
                try { startActivity(Intent(Intent.ACTION_VIEW, r.url)) } catch (e: Exception) { }
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(v: WebView, cb: ValueCallback<Array<Uri>>, p: FileChooserParams): Boolean {
                fileCb?.onReceiveValue(null); fileCb = cb
                val t = p.acceptTypes.firstOrNull { it.isNotBlank() }?.split(',')?.firstOrNull()?.trim().orEmpty()
                val type = when { t.startsWith("image") -> "image/*"; t.contains("pdf") -> "application/pdf"; t.startsWith(".") || t.isEmpty() -> "*/*"; else -> t }
                try { pick.launch(type) } catch (e: Exception) { fileCb = null; return false }
                return true
            }
        }
        setContentView(web, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        if (b != null) web.restoreState(b) else web.loadUrl(base + "?android=1&open=" + URLEncoder.encode(path, "UTF-8"))
    }

    override fun onSaveInstanceState(o: Bundle) { super.onSaveInstanceState(o); web.saveState(o) }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // erst den Editor speichern lassen, dann schließen
        web.evaluateJavascript("(window.PDFSTIFT_DECK&&window.PDFSTIFT_DECK.flush)?window.PDFSTIFT_DECK.flush():0") { @Suppress("DEPRECATION") super.onBackPressed() }
    }

    override fun onDestroy() { web.destroy(); super.onDestroy() }

    /** Dateien aus dem Editor (PowerPoint, PDF) im Ordner „Download“ ablegen */
    inner class Bridge {
        @JavascriptInterface
        fun save(name: String, mime: String, b64: String) {
            try {
                val bytes = Base64.decode(b64, Base64.DEFAULT)
                val safe = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").ifBlank { "PDF-Stift" }
                if (Build.VERSION.SDK_INT >= 29) {
                    val cv = ContentValues().apply {
                        put(MediaStore.Downloads.DISPLAY_NAME, safe); put(MediaStore.Downloads.MIME_TYPE, mime.ifBlank { "application/octet-stream" })
                        put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                    }
                    val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv) ?: throw Exception("kein Speicherplatz")
                    contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                } else {
                    val dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: filesDir
                    File(dir, safe).writeBytes(bytes)
                }
                runOnUiThread { Ui.toast(this@DeckActivity, "Gespeichert in „Download“: $safe", true) }
            } catch (e: Exception) {
                runOnUiThread { Ui.toast(this@DeckActivity, "Speichern nicht möglich: " + (e.message ?: ""), true) }
            }
        }
    }
}
