package io.github.pdfstift

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.security.SecureRandom

data class LibFile(val path: String, val folder: String, val name: String, val size: Long, val mtime: Long, val thumb: Boolean = false)

/** Ein Notiz-Dokument (gleiches Format wie auf dem Server), mit noch nicht hochgeladenen Änderungen */
class NoteDoc(val path: String) {
    val strokes = LinkedHashMap<String, JSONObject>()
    val pendAdd = LinkedHashMap<String, JSONObject>()
    val pendDel = LinkedHashSet<String>()
    var rev = 0
    val listeners = mutableListOf<() -> Unit>()
    fun changed() = listeners.toList().forEach { it() }
}

/** Alles, was auf dem Tablet liegt: PDFs, Bibliothek, Notizen, Warteschlange zum Hochladen */
object Store {
    private lateinit var dir: File
    private lateinit var prefs: SharedPreferences
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var idx = JSONObject()
    private val docs = HashMap<String, NoteDoc>()
    var syncState: (String) -> Unit = {}
    private var flushJob: Job? = null
    private var flushing = false

    fun init(ctx: Context) {
        // freie Ausgabe offline: eigener Bereich, damit sich nichts mit einem Server vermischt
        val off = Api.offline
        dir = if (off) File(ctx.filesDir, "offline-store").apply { mkdirs() } else ctx.filesDir
        prefs = ctx.getSharedPreferences(if (off) "store-offline" else "store", Context.MODE_PRIVATE)
        docs.clear()
        idx = try { JSONObject(File(dir, "idx.json").readText()) } catch (e: Exception) { JSONObject() }
        // offene Änderungen vom letzten Mal hochladen
        if ((prefs.getStringSet("pending", emptySet()) ?: emptySet()).isNotEmpty()) scheduleFlush(2000)
    }

    fun prefs() = prefs
    fun dir() = dir

    // ---------------------------------------------------------------- Bibliothek
    fun cachedLibrary(): JSONObject? = try { JSONObject(File(dir, "lib.json").readText()) } catch (e: Exception) { null }
    fun saveLibrary(j: JSONObject) { try { File(dir, "lib.json").writeText(j.toString()) } catch (e: Exception) { } }

    fun files(lib: JSONObject): List<LibFile> {
        val arr = lib.optJSONArray("files") ?: return emptyList()
        return (0 until arr.length()).map {
            val o = arr.getJSONObject(it)
            LibFile(o.getString("path"), o.optString("folder"), o.optString("name"), o.optLong("size"), o.optLong("mtime"), o.optBoolean("thumb"))
        }
    }
    fun folders(lib: JSONObject): List<String> {
        val arr = lib.optJSONArray("folders") ?: return emptyList()
        return (0 until arr.length()).map { arr.getString(it) }
    }

    // ---------------------------------------------------------------- PDFs auf dem Gerät
    fun pdfFile(path: String) = File(dir, "pdfs/$path")
    fun hasLocal(path: String) = pdfFile(path).isFile
    fun isCurrent(f: LibFile): Boolean {
        val o = idx.optJSONObject(f.path) ?: return false
        return hasLocal(f.path) && o.optLong("m") == f.mtime && o.optLong("s") == f.size
    }
    /** die Kopie auf dem Tablet ist neuer als die Bibliotheksliste (z. B. gerade eingebrannt) */
    fun isNewerLocal(f: LibFile): Boolean {
        val o = idx.optJSONObject(f.path) ?: return false
        return o.optLong("m") > f.mtime && pdfFile(f.path).length() == o.optLong("s")
    }
    fun markLocal(path: String, mtime: Long, size: Long) {
        idx.put(path, JSONObject().put("m", mtime).put("s", size))
        saveIdx()
    }
    private fun saveIdx() { try { File(dir, "idx.json").writeText(idx.toString()) } catch (e: Exception) { } }
    fun localCount(): Int = idx.length()
    fun localBytes(): Long = idx.keys().asSequence().sumOf { pdfFile(it).length() }
    fun removeAllLocal() { if (Api.offline) return; File(dir, "pdfs").deleteRecursively(); idx = JSONObject(); saveIdx() }
    /** auf dem Server gelöschte oder verschobene PDFs auch vom Gerät nehmen */
    fun prune(lib: JSONObject) {
        val have = files(lib).map { it.path }.toSet()
        val gone = idx.keys().asSequence().filter { it !in have }.toList()
        gone.forEach { pdfFile(it).delete(); idx.remove(it) }
        if (gone.isNotEmpty()) saveIdx()
    }

    // ---------------------------------------------------------------- Notizen
    private fun sha1(s: String) = MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
    private fun notesFile(path: String) = File(dir, "notes/${sha1(path)}.json")

    fun uid(): String {
        val r = SecureRandom(); val a = "0123456789abcdefghijklmnopqrstuvwxyz"
        return (1..14).map { a[r.nextInt(36)] }.joinToString("")
    }

    fun doc(path: String): NoteDoc {
        docs[path]?.let { return it }
        val d = NoteDoc(path)
        try {
            val j = JSONObject(notesFile(path).readText())
            j.optJSONObject("strokes")?.let { o -> o.keys().forEach { d.strokes[it] = o.getJSONObject(it) } }
            j.optJSONObject("add")?.let { o -> o.keys().forEach { d.pendAdd[it] = o.getJSONObject(it) } }
            j.optJSONArray("del")?.let { a -> for (i in 0 until a.length()) d.pendDel.add(a.getString(i)) }
            d.rev = j.optInt("rev")
        } catch (e: Exception) { }
        docs[path] = d
        return d
    }

    private fun saveDoc(d: NoteDoc) {
        val so = JSONObject(); d.strokes.forEach { (k, v) -> so.put(k, v) }
        val ao = JSONObject(); d.pendAdd.forEach { (k, v) -> ao.put(k, v) }
        val j = JSONObject().put("strokes", so).put("add", ao).put("del", JSONArray(d.pendDel.toList())).put("rev", d.rev)
        try { notesFile(d.path).parentFile?.mkdirs(); notesFile(d.path).writeText(j.toString()) } catch (e: Exception) { }
        val set = (prefs.getStringSet("pending", emptySet()) ?: emptySet()).toMutableSet()
        if (d.pendAdd.isEmpty() && d.pendDel.isEmpty()) set.remove(d.path) else set.add(d.path)
        prefs.edit().putStringSet("pending", set).apply()
    }

    /** Stand vom Server holen und mit den eigenen, noch nicht hochgeladenen Änderungen zusammenführen */
    suspend fun pullNotes(path: String) {
        val j = Api.get("notes", mapOf("path" to path))
        val d = doc(path)
        applyServer(d, j)
    }

    fun applyServerPublic(d: NoteDoc, j: JSONObject) = applyServer(d, j)

    private fun applyServer(d: NoteDoc, j: JSONObject) {
        d.strokes.clear()
        j.optJSONObject("strokes")?.let { o -> o.keys().forEach { d.strokes[it] = o.getJSONObject(it) } }
        d.pendAdd.forEach { (k, v) -> d.strokes[k] = v }
        d.pendDel.forEach { d.strokes.remove(it) }
        d.rev = j.optInt("rev")
        saveDoc(d)
        d.changed()
    }

    fun addStrokes(path: String, list: List<JSONObject>) {
        val d = doc(path)
        list.forEach { s -> val id = s.getString("id"); d.strokes[id] = s; d.pendAdd[id] = s }
        saveDoc(d)
        d.changed()
        scheduleFlush()
    }

    fun deleteStrokes(path: String, ids: Collection<String>) {
        val d = doc(path)
        ids.forEach { id -> d.strokes.remove(id); if (d.pendAdd.remove(id) == null) d.pendDel.add(id) else d.pendDel.add(id) }
        saveDoc(d)
        d.changed()
        scheduleFlush()
    }

    fun pendingCount(): Int = (prefs.getStringSet("pending", emptySet()) ?: emptySet()).size

    fun scheduleFlush(ms: Long = 700) {
        flushJob?.cancel()
        flushJob = scope.launch { delay(ms); flush() }
    }

    suspend fun flush() {
        if (flushing) { scheduleFlush(1500); return }
        flushing = true
        try {
            Notebook.createPending() // offline angelegte Notizseiten zuerst beim Server anlegen
            val paths = (prefs.getStringSet("pending", emptySet()) ?: emptySet()).toList()
            if (paths.isEmpty()) { syncState("ok"); return }
            syncState("saving")
            for (p in paths) {
                val d = doc(p)
                val add = d.pendAdd.toMap()
                val del = d.pendDel.toSet()
                if (add.isEmpty() && del.isEmpty()) { saveDoc(d); continue }
                val body = JSONObject().put("path", p).put("add", JSONArray(add.values.toList())).put("del", JSONArray(del.toList()))
                val res = try { Api.post("sync", body) } catch (e: Api.ApiError) {
                    if (e.code == 404) { d.pendAdd.clear(); d.pendDel.clear(); saveDoc(d); continue } // PDF gibt es nicht mehr
                    throw e
                }
                add.keys.forEach { if (d.pendAdd[it] === add[it]) d.pendAdd.remove(it) }
                del.forEach { d.pendDel.remove(it) }
                withContext(Dispatchers.Main) { applyServer(d, res) }
            }
            syncState(if (pendingCount() > 0) "saving" else "ok")
        } catch (e: Exception) {
            syncState("offline")
            scheduleFlush(8000)
        } finally {
            flushing = false
        }
    }
}
