package io.github.pdfstift

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Schlagwörter und Merkliste – dieselben Daten wie in der Web-App (storage/meta.json auf dem Server) */
object Meta {
    class Mark(val path: String, val page: Int, val title: String)
    private var data = JSONObject().put("docs", JSONObject()).put("marks", JSONArray())
    private val file get() = File(Store.dir(), "meta.json")
    var onChange: () -> Unit = {}

    fun load() { try { data = JSONObject(file.readText()) } catch (e: Exception) { } }
    private fun keep(j: JSONObject) { data = j; try { file.writeText(j.toString()) } catch (e: Exception) { }; onChange() }

    suspend fun refresh() { try { keep(Api.get("meta")) } catch (e: Exception) { } }

    fun tags(path: String): List<String> {
        val a = data.optJSONObject("docs")?.optJSONObject(path)?.optJSONArray("tags") ?: return emptyList()
        return (0 until a.length()).map { a.getString(it) }
    }
    fun allTags(): List<Pair<String, Int>> {
        val m = HashMap<String, Int>()
        val d = data.optJSONObject("docs") ?: return emptyList()
        for (k in d.keys()) { val a = d.getJSONObject(k).optJSONArray("tags") ?: continue; for (i in 0 until a.length()) m[a.getString(i)] = (m[a.getString(i)] ?: 0) + 1 }
        return m.entries.sortedBy { it.key.lowercase() }.map { it.key to it.value }
    }
    fun marks(): List<Mark> {
        val a = data.optJSONArray("marks") ?: return emptyList()
        return (0 until a.length()).map { val o = a.getJSONObject(it); Mark(o.getString("path"), o.optInt("page"), o.optString("title")) }
    }
    fun isMarked(path: String, page: Int) = marks().any { it.path == path && it.page == page }

    /** Rückgabe: Fehlermeldung oder null */
    suspend fun setTags(path: String, tags: List<String>): String? = try {
        keep(Api.post("meta", JSONObject().put("path", path).put("tags", JSONArray(tags)))); null
    } catch (e: Api.ApiError) { e.message } catch (e: Exception) { "Geht nur mit Internetverbindung." }

    suspend fun mark(path: String, page: Int, remove: Boolean, title: String = ""): String? = try {
        keep(Api.post("meta", JSONObject().put("mark", JSONObject().put("path", path).put("page", page).put("remove", if (remove) 1 else 0).put("title", title)))); null
    } catch (e: Api.ApiError) { e.message } catch (e: Exception) { "Geht nur mit Internetverbindung." }
}
