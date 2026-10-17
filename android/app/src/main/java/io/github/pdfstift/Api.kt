package io.github.pdfstift

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Verbindung zu pdf-stift.example.org – dieselbe Schnittstelle wie die Web-App (freie Ausgabe: eigener Server oder offline) */
object Api {
    private const val OWN = "https://pdf-stift.example.org/"
    /** Adresse des Servers (eigene Ausgabe: fest; freie Ausgabe: in der App eingetragen) */
    val BASE: String get() = if (Edition.FREE) (prefs.getString("server", "") ?: "").ifBlank { "https://offline.invalid/" } else OWN
    private val API: String get() = BASE + "api.php"
    /** freie Ausgabe ohne Server: alles bleibt auf dem Tablet */
    val offline: Boolean get() = Edition.FREE && prefs.getString("mode", "") == "offline"
    /** freie Ausgabe: schon „Online“ oder „Offline“ gewählt? */
    val configured: Boolean get() = !Edition.FREE || prefs.getString("mode", "") in listOf("offline", "online")
    fun setMode(mode: String, server: String = "") {
        val s = server.trim().let { if (it.isEmpty()) it else (if (it.startsWith("http")) it else "https://$it").trimEnd('/') + "/" }
        prefs.edit().putString("mode", mode).putString("server", s).remove("cookies").apply()
    }
    val mode: String get() = prefs.getString("mode", "") ?: ""
    /** Kurzanleitung: auf dem Server, offline auf GitHub */
    val HELP: String get() = if (Edition.FREE && offline) "https://github.com/${Edition.REPO}#readme" else BASE + "hilfe.html"
    lateinit var http: OkHttpClient
    private lateinit var prefs: SharedPreferences

    class ApiError(message: String, val code: Int) : IOException(message)

    fun init(ctx: Context) {
        prefs = ctx.getSharedPreferences("api", Context.MODE_PRIVATE)
        LocalApi.init(ctx)
        http = OkHttpClient.Builder()
            .cookieJar(object : CookieJar {
                override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
                    val all = load(url).associateBy { it.name }.toMutableMap()
                    cookies.forEach { all[it.name] = it }
                    prefs.edit().putString("cookies", JSONArray(all.values.map { it.toString() }).toString()).apply()
                }
                override fun loadForRequest(url: HttpUrl): List<Cookie> = load(url)
                private fun load(url: HttpUrl): List<Cookie> {
                    val raw = prefs.getString("cookies", null) ?: return emptyList()
                    val arr = JSONArray(raw)
                    return (0 until arr.length()).mapNotNull { Cookie.parse(url, arr.getString(it)) }
                }
            })
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .writeTimeout(600, TimeUnit.SECONDS)
            .build()
    }

    fun clearCookies() = prefs.edit().remove("cookies").apply()
    /** Anmeldung für die eingebettete Web-Ansicht (Präsentationen): dieselben Cookies wie die App */
    fun cookieStrings(): List<String> = try { val arr = JSONArray(prefs.getString("cookies", null) ?: "[]"); (0 until arr.length()).map { arr.getString(it) } } catch (e: Exception) { emptyList() }

    private fun url(action: String, params: Map<String, String> = emptyMap()): HttpUrl {
        val b = API.toHttpUrl().newBuilder().addQueryParameter("a", action)
        params.forEach { (k, v) -> b.addQueryParameter(k, v) }
        return b.build()
    }

    private fun exec(req: Request): JSONObject {
        http.newCall(req).execute().use { r ->
            val txt = r.body?.string() ?: ""
            val j = try { JSONObject(txt) } catch (e: Exception) { JSONObject() }
            if (!r.isSuccessful) throw ApiError(j.optString("error", "Fehler ${r.code}"), r.code)
            return j
        }
    }

    suspend fun get(action: String, params: Map<String, String> = emptyMap()): JSONObject = withContext(Dispatchers.IO) {
        if (offline) return@withContext LocalApi.get(action, params)
        exec(Request.Builder().url(url(action, params)).build())
    }

    /** Antwort als Text (z. B. der Nutzungsbericht) */
    suspend fun text(action: String, params: Map<String, String> = emptyMap()): String = withContext(Dispatchers.IO) {
        if (offline) return@withContext LocalApi.text(action)
        http.newCall(Request.Builder().url(url(action, params)).header("X-PDFStift", "1").build()).execute().use { r ->
            val t = r.body?.string() ?: ""
            if (!r.isSuccessful) throw ApiError("Fehler ${r.code}", r.code)
            t
        }
    }

    suspend fun post(action: String, body: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        if (offline) return@withContext LocalApi.post(action, body)
        exec(Request.Builder().url(url(action)).header("X-PDFStift", "1")
            .post(body.toString().toRequestBody("application/json".toMediaType())).build())
    }

    suspend fun postForm(action: String, form: RequestBody): JSONObject = withContext(Dispatchers.IO) {
        if (offline) return@withContext LocalApi.postForm(action, form)
        exec(Request.Builder().url(url(action)).header("X-PDFStift", "1").post(form).build())
    }

    /** PDF herunterladen (in eine .part-Datei, dann umbenennen) */
    suspend fun download(path: String, dest: File, progress: (Long, Long) -> Unit) = withContext(Dispatchers.IO) {
        if (offline) { LocalApi.download(path, dest, progress); return@withContext }
        val req = Request.Builder().url(url("pdf", mapOf("path" to path))).build()
        http.newCall(req).execute().use { r ->
            if (!r.isSuccessful) throw ApiError(if (r.code == 401) "Bitte anmelden." else "Download fehlgeschlagen (${r.code})", r.code)
            val body = r.body ?: throw IOException("Leere Antwort")
            val total = body.contentLength()
            dest.parentFile?.mkdirs()
            val part = File(dest.path + ".part")
            body.byteStream().use { inp ->
                part.outputStream().use { out ->
                    val buf = ByteArray(256 * 1024)
                    var done = 0L
                    var last = 0L
                    while (true) {
                        val n = inp.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        done += n
                        if (done - last > 512 * 1024) { last = done; progress(done, total) }
                    }
                    progress(done, total)
                }
            }
            if (!part.renameTo(dest)) { dest.delete(); part.renameTo(dest) }
        }
    }

    /** beliebige Datei holen (Update) */
    suspend fun fetchFile(fullUrl: String, dest: File, progress: (Long, Long) -> Unit) = withContext(Dispatchers.IO) {
        if (offline && fullUrl.startsWith(BASE)) { if (LocalApi.fetch(fullUrl, dest)) return@withContext; throw ApiError("Auf diesem Tablet nicht vorhanden.", 404) }
        http.newCall(Request.Builder().url(fullUrl).build()).execute().use { r ->
            if (!r.isSuccessful) throw ApiError("Download fehlgeschlagen (${r.code})", r.code)
            val body = r.body ?: throw IOException("Leere Antwort")
            val total = body.contentLength()
            dest.parentFile?.mkdirs()
            body.byteStream().use { inp -> dest.outputStream().use { out ->
                val buf = ByteArray(256 * 1024); var done = 0L
                while (true) { val n = inp.read(buf); if (n < 0) break; out.write(buf, 0, n); done += n; progress(done, total) }
            } }
        }
    }

    suspend fun fetchJson(fullUrl: String): JSONObject = withContext(Dispatchers.IO) {
        exec(Request.Builder().url(fullUrl).header("Cache-Control", "no-cache").build())
    }

    /** Word/Excel/PowerPoint auf dem Server in PDF umwandeln (braucht Internet) */
    suspend fun convert(src: File, name: String, dest: File) = withContext(Dispatchers.IO) {
        if (offline) throw ApiError("Word, Excel und PowerPoint umwandeln geht nur mit eigenem Server (Online).", 501)
        val form = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", name, src.asRequestBody("application/octet-stream".toMediaType())).build()
        http.newCall(Request.Builder().url(url("convert")).header("X-PDFStift", "1").post(form).build()).execute().use { r ->
            if (!r.isSuccessful) {
                val j = try { JSONObject(r.body?.string() ?: "") } catch (e: Exception) { JSONObject() }
                throw ApiError(j.optString("error", "Umwandeln fehlgeschlagen (${r.code})"), r.code)
            }
            r.body?.byteStream()?.use { inp -> dest.outputStream().use { inp.copyTo(it) } } ?: throw IOException("Leere Antwort")
        }
    }

    suspend fun upload(folder: String, name: String, file: File): JSONObject {
        val form = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("folder", folder)
            .addFormDataPart("files[]", name, file.asRequestBody("application/pdf".toMediaType()))
            .build()
        return postForm("upload", form)
    }
}
