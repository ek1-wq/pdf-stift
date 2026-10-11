package io.github.pdfstift

import org.json.JSONArray

/** offene PDFs (Tabs) und zuletzt geöffnete – bleiben über Neustarts erhalten */
object Tabs {
    private fun load(key: String): MutableList<String> = try {
        val a = JSONArray(Store.prefs().getString(key, "[]")); (0 until a.length()).map { a.getString(it) }.toMutableList()
    } catch (e: Exception) { mutableListOf() }
    private fun save(key: String, l: List<String>) = Store.prefs().edit().putString(key, JSONArray(l).toString()).apply()

    fun list(): List<String> = load("tabs")
    fun add(p: String) {
        val t = load("tabs"); if (p !in t) { t.add(p); if (t.size > 8) t.removeAt(0); save("tabs", t) }
        val r = load("recent"); r.remove(p); r.add(0, p); save("recent", r.take(12))
    }
    fun remove(p: String): List<String> { val t = load("tabs"); t.remove(p); save("tabs", t); return t }
    fun recent(): List<String> = load("recent")
}
