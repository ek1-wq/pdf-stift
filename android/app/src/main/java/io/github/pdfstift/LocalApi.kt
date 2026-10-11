package io.github.pdfstift

import android.content.Context
import android.graphics.BitmapFactory
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okio.buffer
import okio.sink
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * Offline-Betrieb der freien Ausgabe: dieselbe Schnittstelle wie der Server (api.php), aber alles liegt auf dem Tablet.
 * Die Bibliothek ist der PDF-Ordner der App; Notizen, Notizbücher, Bilder und Einstellungen liegen unter files/offline/.
 */
object LocalApi {
    private lateinit var root: File
    private val lock = Any()

    fun init(ctx: Context) { root = File(ctx.filesDir, "offline").apply { mkdirs() } }

    private fun lib(): File = Store.pdfFile("").apply { mkdirs() }
    private fun dir(name: String) = File(root, name).apply { mkdirs() }
    private fun sha1(s: String) = MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
    private fun sha1(b: ByteArray) = MessageDigest.getInstance("SHA-1").digest(b).joinToString("") { "%02x".format(it) }
    private fun err(msg: String, code: Int = 400): Nothing = throw Api.ApiError(msg, code)
    private fun now() = System.currentTimeMillis() / 1000

    private fun safeRel(p: String): String {
        val r = p.replace('\\', '/').trim().trim('/')
        if (r.isEmpty() || r.split('/').any { it.isEmpty() || it == "." || it == ".." || it.startsWith(".") }) err("Ungültiger Pfad.")
        return r
    }
    private fun readJson(f: File): JSONObject = try { JSONObject(f.readText()) } catch (e: Exception) { JSONObject() }
    private fun writeJson(f: File, j: JSONObject) { f.parentFile?.mkdirs(); val t = File(f.path + ".tmp"); t.writeText(j.toString()); if (!t.renameTo(f)) { f.delete(); t.renameTo(f) } }

    // ---------------------------------------------------------------- Aufrufe
    fun get(action: String, params: Map<String, String>): JSONObject = synchronized(lock) {
        when (action) {
            "me" -> JSONObject().put("setup", false).put("loggedIn", true).put("version", BuildConfig.VERSION_NAME).put("edition", "offline")
            "list" -> list()
            "notes" -> notesDoc(safeRel(params["path"] ?: ""))
            "boards" -> JSONObject().put("books", books())
            "nbmeta" -> boardMeta(safeRel(params["path"] ?: ""))
            "nbhist" -> JSONObject().put("list", JSONArray())
            "backlinks" -> backlinks(params["path"] ?: "")
            "meta" -> readJson(File(root, "meta.json")).let { if (!it.has("docs")) it.put("docs", JSONObject()); if (!it.has("marks")) it.put("marks", JSONArray()); it }
            "prefs" -> readJson(File(root, "prefs.json"))
            "search" -> search(params["q"] ?: "")
            "versions" -> JSONObject().put("versions", JSONArray())
            "audiols" -> audioList(params["path"] ?: "")
            else -> err("Offline nicht verfügbar.", 501)
        }
    }

    fun text(action: String): String = when (action) {
        "usagereport" -> "Nutzungsbericht: im Offline-Betrieb wird nichts aufgezeichnet."
        else -> ""
    }

    fun post(action: String, b: JSONObject): JSONObject = synchronized(lock) {
        when (action) {
            "login", "logout", "usage", "appreport", "purgebackup", "audiodel" -> JSONObject().put("ok", true)
            "sync" -> sync(safeRel(b.optString("path")), b.optJSONArray("add") ?: JSONArray(), b.optJSONArray("del") ?: JSONArray())
            "mkdir" -> { File(lib(), safeRel(b.optString("path"))).mkdirs(); JSONObject().put("ok", true) }
            "nbnew" -> nbNew(b)
            "nbset" -> { val f = boardFile(safeRel(b.optString("path"))); val m = readJson(f); if (b.optString("bg") in listOf("dots", "grid", "lines", "plain")) m.put("bg", b.optString("bg")); writeJson(f, m); JSONObject().put("ok", true).put("meta", m) }
            "nbmove" -> nbMove(b)
            "nborder" -> { nbOrder(b.optJSONArray("paths") ?: JSONArray()); JSONObject().put("ok", true) }
            "nbhist" -> err("Frühere Stände gibt es nur mit eigenem Server.", 501)
            "pgtext" -> JSONObject().put("texts", JSONArray((0 until (b.optJSONArray("refs")?.length() ?: 0)).map { "" }))
            "meta" -> meta(b)
            "prefs" -> { val f = File(root, "prefs.json"); val p = readJson(f); b.keys().forEach { k -> p.put(k, b.get(k)) }; writeJson(f, p); p }
            "livestart", "livepush", "livestop" -> err("Die Live-Mitschau braucht einen eigenen Server.", 501)
            else -> err("Offline nicht verfügbar.", 501)
        }
    }

    fun postForm(action: String, form: RequestBody): JSONObject = synchronized(lock) {
        val parts = Parts(form)
        try {
            when (action) {
                "upload" -> upload(parts)
                "imgput" -> imgPut(parts)
                "burn", "pageop" -> replacePdf(action, parts)
                "audioput" -> { val id = parts.text("id").filter { it.isLetterOrDigit() }; parts.file("file")?.copyTo(File(dir("audio"), "$id.m4a"), true)
                    val l = readJson(File(root, "audio.json")); l.put(id, JSONObject().put("id", id).put("path", parts.text("path")).put("t", parts.text("t").toLongOrNull() ?: now()).put("dur", parts.text("dur").toLongOrNull() ?: 0)); writeJson(File(root, "audio.json"), l); JSONObject().put("ok", true) }
                "appreport" -> JSONObject().put("ok", true)
                else -> err("Offline nicht verfügbar.", 501)
            }
        } finally { parts.close() }
    }

    /** PDF „herunterladen“: liegt schon auf dem Tablet */
    fun download(path: String, dest: File, progress: (Long, Long) -> Unit) {
        val src = File(lib(), safeRel(path))
        if (!src.isFile) err("Datei nicht gefunden.", 404)
        if (src.canonicalPath != dest.canonicalPath) src.copyTo(dest, true)
        progress(src.length(), src.length())
    }

    /** Dateien aus der „Server“-Adresse (Tonaufnahmen, Bilder) */
    fun fetch(url: String, dest: File): Boolean {
        val id = Regex("[?&]id=([A-Za-z0-9]+)").find(url)?.groupValues?.get(1)
        if (url.contains("a=audio") && id != null) { val f = File(dir("audio"), "$id.m4a"); if (f.isFile) { f.copyTo(dest, true); return true } }
        val src = Regex("[?&]src=([a-f0-9]{40}\\.[a-z]+)").find(url)?.groupValues?.get(1)
        if (src != null) { val f = Images.file(src); if (f.isFile) { if (f.canonicalPath != dest.canonicalPath) f.copyTo(dest, true); return true } }
        return false
    }

    // ---------------------------------------------------------------- Bibliothek
    private fun list(): JSONObject {
        val base = lib(); val files = JSONArray(); val folders = ArrayList<String>(); val fl = ArrayList<JSONObject>()
        base.walkTopDown().maxDepth(7).forEach { f ->
            if (f == base) return@forEach
            val rel = f.relativeTo(base).invariantSeparatorsPath
            if (rel.split('/').any { it.startsWith(".") } || rel.endsWith(".part") || rel.endsWith(".tmp")) return@forEach
            if (f.isDirectory) { folders.add(rel); return@forEach }
            if (!rel.endsWith(".pdf", true)) return@forEach
            fl.add(JSONObject().put("path", rel).put("folder", if (rel.contains('/')) rel.substringBeforeLast('/') else "").put("name", f.name)
                .put("size", f.length()).put("mtime", f.lastModified() / 1000).put("notesMtime", File(dir("notes"), sha1(rel) + ".json").let { if (it.isFile) it.lastModified() / 1000 else 0 }).put("thumb", false))
        }
        fl.sortedBy { it.getString("path").lowercase() }.forEach { files.put(it) }
        return JSONObject().put("folders", JSONArray(folders.sortedBy { it.lowercase() })).put("files", files).put("offline", true)
    }

    private fun upload(p: Parts): JSONObject {
        val folder = p.text("folder").let { if (it.isBlank()) "" else safeRel(it) }
        val saved = JSONArray()
        for ((name, file) in p.files("files[]")) {
            var n = (p.text("filename").ifBlank { name }).replace(Regex("[/\\\\\\u0000-\\u001F]"), "_").trimStart('.')
            if (!n.endsWith(".pdf", true)) n += ".pdf"
            val d = File(lib(), folder).apply { mkdirs() }
            var t = File(d, n); var k = 2
            while (t.exists()) { t = File(d, n.removeSuffix(".pdf").removeSuffix(".PDF") + " ($k).pdf"); k++ }
            file.copyTo(t)
            saved.put(t.relativeTo(lib()).invariantSeparatorsPath)
        }
        return JSONObject().put("saved", saved).put("errors", JSONArray())
    }

    /** neue Fassung einer PDF (Notizen eingebrannt oder Seiten geändert); Anhänge/Kürzen: ganze Datei verlangen */
    private fun replacePdf(action: String, p: Parts): JSONObject {
        val rel = safeRel(p.text("path"))
        val target = File(lib(), rel)
        val pdf = p.file("pdf") ?: err("Bitte die ganze Datei schicken.", 409)
        if (pdf.canonicalPath != target.canonicalPath) { val tmp = File(target.path + ".tmp"); pdf.copyTo(tmp, true); if (!tmp.renameTo(target)) { target.delete(); tmp.renameTo(target) } }
        val out = JSONObject().put("ok", true).put("mtime", target.lastModified() / 1000).put("size", target.length())
        if (action == "burn") {
            val ids = try { JSONArray(p.text("ids").ifBlank { "[]" }) } catch (e: Exception) { JSONArray() }
            out.put("notes", sync(rel, JSONArray(), ids))
        } else remap(rel, p.text("map"), p.text("rot"))
        return out
    }

    // ---------------------------------------------------------------- Notizen (wie merge_notes auf dem Server)
    private fun notesFile(rel: String) = File(dir("notes"), sha1(rel) + ".json")
    private fun notesDoc(rel: String): JSONObject {
        val d = readJson(notesFile(rel))
        if (!d.has("strokes")) d.put("strokes", JSONObject())
        if (!d.has("deleted")) d.put("deleted", JSONObject())
        return d.put("path", rel).put("v", 1).put("rev", d.optInt("rev"))
    }
    private fun sync(rel: String, add: JSONArray, del: JSONArray): JSONObject {
        val d = notesDoc(rel); val st = d.getJSONObject("strokes"); val dl = d.getJSONObject("deleted"); val t = now()
        for (i in 0 until del.length()) { val id = del.optString(i); if (id.isEmpty()) continue; st.remove(id); dl.put(id, t) }
        for (i in 0 until add.length()) { val s = add.optJSONObject(i) ?: continue; val id = s.optString("id"); if (id.length in 6..40 && !dl.has(id)) st.put(id, s) }
        d.put("rev", d.optInt("rev") + 1)
        writeJson(notesFile(rel), d)
        return d
    }
    private fun remap(rel: String, mapTxt: String, rotTxt: String) {
        val f = notesFile(rel); if (!f.isFile) return
        val map = HashMap<Int, Int>()
        try { val a = JSONArray(mapTxt.ifBlank { "[]" }); for (i in 0 until a.length()) map[i] = a.optInt(i, i) } catch (e: Exception) {
            try { val o = JSONObject(mapTxt); o.keys().forEach { k -> map[k.toInt()] = o.optInt(k) } } catch (e2: Exception) { }
        }
        val rot = try { JSONObject(rotTxt.ifBlank { "{}" }) } catch (e: Exception) { JSONObject() }
        val d = notesDoc(rel); val st = d.getJSONObject("strokes"); val dl = d.getJSONObject("deleted"); val out = JSONObject()
        for (id in st.keys().asSequence().toList()) {
            val s = st.getJSONObject(id); val old = s.optInt("p"); val nw = map[old] ?: old
            if (nw < 0) { dl.put(id, now()); continue }
            s.put("p", nw)
            rot.optJSONObject(nw.toString())?.let { r -> rotateStroke(s, r.optDouble("h")) }
            out.put(id, s)
        }
        d.put("strokes", out).put("rev", d.optInt("rev") + 1)
        writeJson(f, d)
    }
    /** um 90° im Uhrzeigersinn (h = alte Seitenhöhe), wie rotate_stroke auf dem Server */
    private fun rotateStroke(s: JSONObject, h: Double) {
        val p = s.getJSONArray("pts"); val q = (0 until p.length()).map { p.getDouble(it) }.toMutableList()
        fun r2(v: Double) = Math.round(v * 100) / 100.0
        when (s.optString("t")) {
            "tx" -> { var i = 0; while (i + 3 < q.size) { val x = q[i]; val y = q[i + 1]; val w = q[i + 2]; val hh = q[i + 3]; q[i] = r2(h - y - hh); q[i + 1] = r2(x); q[i + 2] = hh; q[i + 3] = w; i += 4 } }
            "txt" -> { val x = q[0]; q[0] = r2(h - q[1] - s.optDouble("bh", 0.0)); q[1] = r2(x) }
            "sh" -> { for (i in listOf(0, 2)) { val x = q[i]; q[i] = r2(h - q[i + 1]); q[i + 1] = r2(x) } }
            else -> { var i = 0; while (i + 1 < q.size) { val x = q[i]; q[i] = r2(h - q[i + 1]); q[i + 1] = r2(x); i += 3 } }
        }
        s.put("pts", JSONArray(q))
    }

    // ---------------------------------------------------------------- Bilder
    private fun imgPut(p: Parts): JSONObject {
        val f = p.file("file") ?: err("Kein Bild empfangen.")
        val bytes = f.readBytes()
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
        val ext = when (o.outMimeType) { "image/jpeg" -> "jpg"; "image/png" -> "png"; "image/gif" -> "gif"; "image/webp" -> "webp"; else -> err("Das ist kein Bild (JPEG, PNG, GIF oder WebP).") }
        val src = sha1(bytes) + "." + ext
        val dest = Images.file(src); if (!dest.isFile) dest.writeBytes(bytes)
        return JSONObject().put("src", src).put("w", o.outWidth).put("h", o.outHeight)
    }

    // ---------------------------------------------------------------- Notizbücher (Ordner Notizbuch/Abschnitt/Seite.board)
    private const val NB = "@nb/"
    private fun nbRoot() = dir("boards")
    private fun clean(s: String, fb: String): String {
        var t = s.replace(Regex("[/\\\\\\u0000-\\u001F:*?\"<>|]+"), " ").replace(Regex("\\s+"), " ").trim().trimStart('.', '@', ' ')
        if (t.length > 80) t = t.substring(0, 80)
        return t.ifBlank { fb }
    }
    private fun boardFile(rel: String): File { if (!rel.startsWith(NB)) err("Ungültiger Pfad."); return File(nbRoot(), rel.removePrefix(NB) + ".board") }
    private fun boardMeta(rel: String): JSONObject { val f = boardFile(rel); if (!f.isFile) err("Nicht gefunden.", 404); return readJson(f).put("mtime", f.lastModified() / 1000) }
    private fun dirMeta(d: File) = readJson(File(d, ".meta.json"))
    private val COLORS = listOf("#1E4FB8", "#1B8A3A", "#E8590C", "#7048E8", "#D6262B", "#0B7285", "#C2255C", "#5C940D")
    private fun ensure(nb: String, sec: String): Pair<String, String> {
        val n = clean(nb, "Notizbuch"); val d = File(nbRoot(), n)
        if (!d.isDirectory) { d.mkdirs(); writeJson(File(d, ".meta.json"), JSONObject().put("color", COLORS[(nbRoot().listFiles()?.size ?: 0) % COLORS.size]).put("order", now())) }
        val s = clean(sec, "Allgemein"); val sd = File(d, s)
        if (!sd.isDirectory) { sd.mkdirs(); writeJson(File(sd, ".meta.json"), JSONObject().put("color", COLORS[(d.listFiles()?.size ?: 0) % COLORS.size]).put("order", System.currentTimeMillis() / 1000.0)) }
        return n to s
    }
    private fun nbNew(b: JSONObject): JSONObject {
        when (b.optString("kind", "page")) {
            "nb" -> { val n = clean(b.optString("name"), "Notizbuch"); val d = File(nbRoot(), n); if (!d.isDirectory) { d.mkdirs(); writeJson(File(d, ".meta.json"), JSONObject().put("color", COLORS[(nbRoot().listFiles()?.size ?: 0) % COLORS.size]).put("order", now())) }; return JSONObject().put("path", NB + n) }
            "sec" -> { val (n, s) = ensure(b.optString("nb"), b.optString("name")); return JSONObject().put("path", "$NB$n/$s") }
        }
        val (n, s) = ensure(b.optString("nb", "Notizbuch"), b.optString("sec", "Allgemein"))
        val title = b.optString("title").trim().ifBlank { "Unbenannte Seite" }.take(200)
        val d = File(nbRoot(), "$n/$s")
        val want = b.optString("file")
        var name = if (want.isNotEmpty() && clean(want, "") == want) want else clean(title, "Seite")
        if (want.isEmpty() || clean(want, "") != want) { var k = 2; val base = name; while (File(d, "$name.board").exists()) { name = "$base ($k)"; k++ } }
        val f = File(d, "$name.board")
        if (!f.isFile) writeJson(f, JSONObject().put("title", title).put("created", now()).put("order", System.currentTimeMillis() / 1000.0).put("bg", b.optString("bg").takeIf { it in listOf("dots", "grid", "lines", "plain") } ?: "dots"))
        return JSONObject().put("path", "$NB$n/$s/$name")
    }
    private fun books(): JSONArray {
        val out = ArrayList<JSONObject>()
        for (nbd in nbRoot().listFiles()?.filter { it.isDirectory && !it.name.startsWith(".") } ?: emptyList()) {
            val bm = dirMeta(nbd); val secs = ArrayList<JSONObject>()
            for (sd in nbd.listFiles()?.filter { it.isDirectory && !it.name.startsWith(".") } ?: emptyList()) {
                val sm = dirMeta(sd); val pages = ArrayList<JSONObject>()
                for (f in sd.listFiles()?.filter { it.isFile && it.name.endsWith(".board") } ?: emptyList()) {
                    val m = readJson(f); val rel = "$NB${nbd.name}/${sd.name}/${f.name.removeSuffix(".board")}"
                    val nf = notesFile(rel)
                    pages.add(JSONObject().put("path", rel).put("title", m.optString("title", f.name.removeSuffix(".board"))).put("order", m.optDouble("order", m.optDouble("created", 0.0)))
                        .put("created", m.optLong("created")).put("mtime", f.lastModified() / 1000).put("notesMtime", if (nf.isFile) nf.lastModified() / 1000 else 0).put("bg", m.optString("bg", "dots")))
                }
                secs.add(JSONObject().put("name", sd.name).put("color", sm.optString("color", "#1E4FB8")).put("order", sm.optDouble("order", 0.0))
                    .put("pages", JSONArray(pages.sortedWith(compareBy({ it.optDouble("order") }, { it.optLong("created") })))))
            }
            out.add(JSONObject().put("name", nbd.name).put("color", bm.optString("color", "#1E4FB8")).put("order", bm.optDouble("order", 0.0))
                .put("sections", JSONArray(secs.sortedWith(compareBy({ it.optDouble("order") }, { it.optString("name") })))))
        }
        return JSONArray(out.sortedWith(compareBy({ it.optDouble("order") }, { it.optString("name") })))
    }
    private fun nbOrder(paths: JSONArray) {
        for (i in 0 until paths.length()) {
            val p = paths.optString(i); if (!p.startsWith(NB)) continue
            val inner = p.removePrefix(NB)
            if (inner.count { it == '/' } == 2) { val f = boardFile(p); if (f.isFile) writeJson(f, readJson(f).put("order", i + 1)) }
            else { val d = File(nbRoot(), inner); if (d.isDirectory) writeJson(File(d, ".meta.json"), dirMeta(d).put("order", i + 1)) }
        }
    }
    private fun nbMove(b: JSONObject): JSONObject {
        val path = b.optString("path"); val to = b.optString("to")
        if (!path.startsWith(NB) || !to.startsWith(NB) || path.count { it == '/' } != 3 || to.count { it == '/' } != 2) err("Ungültiger Pfad.")
        val src = boardFile(path); val d = File(nbRoot(), to.removePrefix(NB))
        if (!src.isFile || !d.isDirectory) err("Nicht gefunden.", 404)
        var np = path
        if (src.parentFile?.canonicalPath != d.canonicalPath) {
            var name = src.name.removeSuffix(".board"); val base = name; var k = 2
            while (File(d, "$name.board").exists()) { name = "$base ($k)"; k++ }
            src.renameTo(File(d, "$name.board"))
            np = "$to/$name"
            val nf = notesFile(path); if (nf.isFile) { val doc = readJson(nf).put("path", np); writeJson(notesFile(np), doc); nf.delete() }
            relink(path, np)
        }
        b.optJSONArray("order")?.let { o -> nbOrder(JSONArray((0 until o.length()).map { if (o.optString(it) == path) np else o.optString(it) })) }
        return JSONObject().put("path", np)
    }
    /** Verknüpfungen auf eine verschobene Seite nachziehen */
    private fun relink(from: String, to: String) {
        for (f in dir("notes").listFiles() ?: emptyArray()) {
            val txt = try { f.readText() } catch (e: Exception) { continue }
            if (!txt.contains("\"ln\"")) continue
            val d = readJson(f); val st = d.optJSONObject("strokes") ?: continue; var ch = false
            st.keys().forEach { id -> st.optJSONObject(id)?.optJSONObject("ln")?.let { ln -> if (ln.optString("path") == from) { ln.put("path", to); ch = true } } }
            if (ch) writeJson(f, d.put("rev", d.optInt("rev") + 1))
        }
    }
    private fun backlinks(path: String): JSONObject {
        val out = JSONArray()
        for (f in dir("notes").listFiles() ?: emptyArray()) {
            val txt = try { f.readText() } catch (e: Exception) { continue }
            if (!txt.contains("\"ln\"") || !txt.contains(path)) continue
            val d = readJson(f); val st = d.optJSONObject("strokes") ?: continue
            st.keys().forEach { id -> val s = st.getJSONObject(id); val ln = s.optJSONObject("ln"); if (ln != null && ln.optString("path") == path)
                out.put(JSONObject().put("from", d.optString("path")).put("page", s.optInt("p")).put("text", s.optString("text")).put("pg", ln.optInt("pg")).put("img", s.optString("t") == "img").put("id", id)) }
        }
        return JSONObject().put("links", out)
    }

    // ---------------------------------------------------------------- Schlagwörter, Merkliste, Suche, Ton
    private fun meta(b: JSONObject): JSONObject {
        val f = File(root, "meta.json"); val m = readJson(f)
        val docs = m.optJSONObject("docs") ?: JSONObject().also { m.put("docs", it) }
        val marks = m.optJSONArray("marks") ?: JSONArray().also { m.put("marks", it) }
        if (b.has("tags")) { val p = b.optString("path"); (docs.optJSONObject(p) ?: JSONObject().also { docs.put(p, it) }).put("tags", b.getJSONArray("tags")) }
        b.optJSONObject("mark")?.let { mk ->
            val keep = JSONArray(); var found = false
            for (i in 0 until marks.length()) { val o = marks.getJSONObject(i)
                if (o.optString("path") == mk.optString("path") && o.optInt("page") == mk.optInt("page")) { found = true; if (mk.optInt("remove") == 1) continue; if (mk.has("title")) o.put("title", mk.optString("title")) }
                keep.put(o) }
            if (!found && mk.optInt("remove") != 1) keep.put(JSONObject().put("path", mk.optString("path")).put("page", mk.optInt("page")).put("title", mk.optString("title")))
            m.put("marks", keep)
        }
        writeJson(f, m); return m
    }
    private fun search(q0: String): JSONObject {
        val q = q0.trim().lowercase(); val docs = JSONArray(); val notes = JSONArray()
        if (q.length < 2) return JSONObject().put("docs", docs).put("notes", notes)
        for (o in list().getJSONArray("files").let { a -> (0 until a.length()).map { a.getJSONObject(it) } })
            if (o.getString("path").lowercase().contains(q)) docs.put(JSONObject().put("path", o.getString("path")).put("hits", JSONArray().put(JSONObject().put("page", 0).put("snip", "\u0001" + o.getString("name") + "\u0002"))))
        for (f in dir("notes").listFiles() ?: emptyArray()) {
            val d = readJson(f); val st = d.optJSONObject("strokes") ?: continue
            st.keys().forEach { id -> val s = st.getJSONObject(id); val t = s.optString("text"); val i = t.lowercase().indexOf(q)
                if (s.optString("t") == "txt" && i >= 0 && notes.length() < 60) notes.put(JSONObject().put("path", d.optString("path")).put("page", s.optInt("p")).put("snip", t.substring(maxOf(0, i - 30), minOf(t.length, i + q.length + 40)))) }
        }
        return JSONObject().put("docs", docs).put("notes", notes)
    }
    private fun audioList(path: String): JSONObject {
        val l = readJson(File(root, "audio.json")); val out = JSONArray()
        l.keys().forEach { k -> val o = l.getJSONObject(k); if (o.optString("path") == path && File(dir("audio"), "$k.m4a").isFile) out.put(JSONObject(o.toString()).put("size", File(dir("audio"), "$k.m4a").length())) }
        return JSONObject().put("recs", out)
    }

    // ---------------------------------------------------------------- Formular-Teile lesen (Dateien landen in einem Zwischenordner)
    private class Parts(form: RequestBody) {
        val texts = HashMap<String, String>()
        val files = ArrayList<Triple<String, String, File>>()   // Feld, Dateiname, Datei
        private val tmp = File(root, "tmp/" + System.nanoTime()).apply { mkdirs() }
        init {
            val mp = form as? MultipartBody
            mp?.parts?.forEachIndexed { k, part ->
                val cd = part.headers?.get("Content-Disposition") ?: ""
                val name = Regex("name=\"([^\"]*)\"").find(cd)?.groupValues?.get(1) ?: ""
                val fn = Regex("filename=\"([^\"]*)\"").find(cd)?.groupValues?.get(1)
                if (fn == null) { val buf = okio.Buffer(); part.body.writeTo(buf); texts[name] = buf.readUtf8() }
                else { val f = File(tmp, "$k.bin"); f.sink().buffer().use { part.body.writeTo(it) }; files.add(Triple(name, fn, f)) }
            }
        }
        fun text(n: String) = texts[n] ?: ""
        fun file(n: String): File? = files.firstOrNull { it.first == n }?.third
        fun files(n: String) = files.filter { it.first == n }.map { it.second to it.third }
        fun close() { tmp.deleteRecursively() }
    }
}
