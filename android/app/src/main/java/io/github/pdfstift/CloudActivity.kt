package io.github.pdfstift

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Nextcloud oder OneDrive live durchblättern (über den Server) und eine Datei öffnen – wie in der Web-App */
class CloudActivity : AppCompatActivity() {
    private lateinit var pv: String          // nc | od
    private val name get() = if (pv == "od") "OneDrive" else "Nextcloud"
    private var path = ""
    private var token = 0
    private lateinit var titleV: TextView
    private lateinit var crumbV: TextView
    private lateinit var infoV: TextView
    private lateinit var swipe: SwipeRefreshLayout
    private val adapter = Adapter()
    private val dp = { v: Float -> Ui.dp(this, v) }

    private class Entry(val dir: Boolean, val j: JSONObject)
    private var entries = listOf<Entry>()

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        pv = intent.getStringExtra("pv") ?: "nc"
        path = Store.prefs().getString("cloudPath:$pv", "") ?: ""
        val back = Ui.text(this, "‹", 30f, Ui.NAVY, true).apply { setPadding(dp(12f), 0, dp(8f), dp(4f)); setOnClickListener { up() } }
        titleV = Ui.text(this, name, 19f, Ui.INK, true)
        crumbV = Ui.text(this, "", 13f, Ui.MUTED).apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.START }
        val head = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.WHITE); setPadding(dp(4f), dp(8f), dp(12f), dp(8f))
            addView(back)
            addView(LinearLayout(this@CloudActivity).apply { orientation = LinearLayout.VERTICAL; addView(titleV); addView(crumbV) }, Ui.lp(0, -2, 1f))
        }
        infoV = Ui.text(this, "", 15f, Ui.MUTED).apply { setPadding(dp(24f), dp(24f), dp(24f), dp(24f)); visibility = View.GONE }
        val list = RecyclerView(this).apply { layoutManager = LinearLayoutManager(this@CloudActivity); adapter = this@CloudActivity.adapter; setPadding(0, dp(6f), 0, dp(24f)); clipToPadding = false }
        swipe = SwipeRefreshLayout(this).apply { addView(list); setOnRefreshListener { load(path) } }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setBackgroundColor(Ui.BG)
            addView(head); addView(View(this@CloudActivity).apply { setBackgroundColor(Ui.LINE) }, Ui.lp(-1, dp(1f)))
            addView(infoV, Ui.lp()); addView(swipe, Ui.lp(-1, 0, 1f))
        })
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) { override fun handleOnBackPressed() { up() } })
        checkThenLoad()
    }

    private fun up() {
        if (path.isEmpty()) { finish(); return }
        load(if ('/' in path) path.substringBeforeLast('/') else "")
    }

    private fun checkThenLoad() {
        swipe.isRefreshing = true
        lifecycleScope.launch {
            val lib = try { Api.get("list") } catch (e: Exception) { Store.cachedLibrary() }
            val ok = when (pv) { "od" -> lib?.optJSONObject("od")?.optBoolean("connected") == true; else -> lib?.optJSONObject("nc")?.optBoolean("configured") == true }
            if (lib != null && !ok) {
                swipe.isRefreshing = false
                info("$name ist noch nicht verbunden.\n\nEinmalig in der Web-App einrichten: pdf-stift.example.org öffnen, in der Bibliothek oben auf „$name“ tippen und dort verbinden. Danach erscheinen die Ordner auch hier.")
                return@launch
            }
            load(path)
        }
    }

    private fun info(t: String) { infoV.text = t; infoV.visibility = if (t.isEmpty()) View.GONE else View.VISIBLE }

    private fun load(p: String) {
        val tk = ++token
        swipe.isRefreshing = true
        lifecycleScope.launch {
            try {
                val j = Api.get(pv + "ls", mapOf("path" to p))
                if (tk != token) return@launch
                path = j.optString("path", p)
                Store.prefs().edit().putString("cloudPath:$pv", path).apply()
                val out = ArrayList<Entry>()
                j.optJSONArray("folders")?.let { a -> for (i in 0 until a.length()) out.add(Entry(true, a.getJSONObject(i))) }
                j.optJSONArray("files")?.let { a -> for (i in 0 until a.length()) out.add(Entry(false, a.getJSONObject(i))) }
                entries = out
                val root = j.optString("root").ifEmpty { name }
                crumbV.text = if (path.isEmpty()) root else "$root / ${path.replace("/", " / ")}"
                info(if (out.isEmpty()) "Dieser Ordner ist leer (oder enthält keine PDFs)." else "")
            } catch (e: Api.ApiError) {
                if (tk != token) return@launch
                if (e.code == 502 && p.isNotEmpty()) { load(""); return@launch }
                entries = emptyList(); info(if (e.code == 401) "Bitte zuerst in der App anmelden." else "$name: ${e.message}")
            } catch (e: Exception) {
                if (tk != token) return@launch
                entries = emptyList(); info("Keine Verbindung. $name ist nur mit Internet erreichbar – PDFs, die du schon einmal geöffnet hast, findest du unter „Meine PDFs“.")
            }
            adapter.notifyDataSetChanged()
            swipe.isRefreshing = false
        }
    }

    private fun openFile(f: JSONObject) {
        val local = f.optString("local").ifEmpty { f.optString("path") }
        val state = f.optString("state")
        if (state == "ok") { done(local); return }
        val office = f.optString("ext").let { it.isNotEmpty() && it != "pdf" }
        val pr = Ui.Progress(this, when { office -> "Wird geladen und in PDF umgewandelt …"; state == "update" -> "Neue Fassung wird aus $name geladen …"; else -> "Wird aus $name geladen …" })
        lifecycleScope.launch {
            try {
                val r = Api.post(pv + "fetch", JSONObject().put("path", f.optString("path")))
                pr.close()
                done(r.optString("path").ifEmpty { local })
            } catch (e: Exception) {
                pr.close()
                Ui.alert(this@CloudActivity, "Nicht geladen", if (e is Api.ApiError) (e.message ?: "") else "Keine Verbindung zum Server.")
            }
        }
    }

    private fun done(local: String) {
        setResult(Activity.RESULT_OK, Intent().putExtra("open", local))
        finish()
    }

    private val df = SimpleDateFormat("dd.MM.yyyy", Locale.GERMANY)

    private inner class Adapter : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
        override fun getItemCount() = entries.size
        override fun onCreateViewHolder(parent: ViewGroup, type: Int): RecyclerView.ViewHolder {
            val ic = Ui.text(this@CloudActivity, "", 22f, Ui.NAVY).apply { gravity = Gravity.CENTER; minWidth = dp(40f) }
            val t = Ui.text(this@CloudActivity, "", 16f, Ui.INK, true).apply { maxLines = 2 }
            val sub = Ui.text(this@CloudActivity, "", 13f, Ui.MUTED)
            val badge = Ui.text(this@CloudActivity, "", 13f, Ui.NAVY, true).apply { setPadding(dp(8f), dp(3f), dp(8f), dp(3f)) }
            val row = LinearLayout(this@CloudActivity).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                background = Ui.rounded(Color.WHITE, dp(12f).toFloat())
                setPadding(dp(10f), dp(12f), dp(12f), dp(12f))
                addView(ic)
                addView(LinearLayout(this@CloudActivity).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(8f), 0, dp(8f), 0); addView(t); addView(sub) }, Ui.lp(0, -2, 1f))
                addView(badge)
                layoutParams = RecyclerView.LayoutParams(-1, -2).apply { setMargins(dp(12f), dp(4f), dp(12f), dp(4f)) }
            }
            row.tag = arrayOf(ic, t, sub, badge)
            return object : RecyclerView.ViewHolder(row) {}
        }
        override fun onBindViewHolder(h: RecyclerView.ViewHolder, pos: Int) {
            val e = entries[pos]
            @Suppress("UNCHECKED_CAST") val v = h.itemView.tag as Array<TextView>
            val j = e.j
            v[1].text = j.optString("name")
            if (e.dir) {
                v[0].text = "📁"
                val n = j.optInt("count", -1)
                v[2].text = if (n >= 0) "$n Einträge" else "Ordner"; v[3].text = "›"; v[3].background = null
                h.itemView.setOnClickListener { load(j.optString("path")) }
            } else {
                val ext = j.optString("ext", "pdf")
                v[0].text = if (ext == "pdf" || ext.isEmpty()) "📄" else "📝"
                v[2].text = listOfNotNull(Ui.mb(j.optLong("size")), j.optLong("mtime").takeIf { it > 0 }?.let { df.format(Date(it * 1000)) },
                    if (ext.isNotEmpty() && ext != "pdf") "wird als PDF geöffnet" else null).joinToString(" · ")
                val st = j.optString("state")
                v[3].text = when (st) { "ok" -> "✓ in der Bibliothek"; "update" -> "neue Fassung"; else -> "☁" }
                v[3].background = if (st == "ok" || st == "update") Ui.rounded(0xFFE3E8F5.toInt(), dp(8f).toFloat()) else null
                h.itemView.setOnClickListener { openFile(j) }
            }
        }
    }
}
