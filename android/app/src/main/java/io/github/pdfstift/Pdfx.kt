package io.github.pdfstift

import android.graphics.RectF
import com.tom_roush.pdfbox.contentstream.operator.Operator
import com.tom_roush.pdfbox.cos.COSArray
import com.tom_roush.pdfbox.cos.COSBase
import com.tom_roush.pdfbox.cos.COSDictionary
import com.tom_roush.pdfbox.cos.COSName
import com.tom_roush.pdfbox.cos.COSNumber
import com.tom_roush.pdfbox.cos.COSString
import com.tom_roush.pdfbox.cos.COSUpdateInfo
import com.tom_roush.pdfbox.pdfparser.PDFStreamParser
import com.tom_roush.pdfbox.pdfwriter.ContentStreamWriter
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.common.PDStream
import com.tom_roush.pdfbox.pdmodel.font.PDFont
import com.tom_roush.pdfbox.pdmodel.font.PDType1Font
import com.tom_roush.pdfbox.pdmodel.graphics.form.PDFormXObject
import com.tom_roush.pdfbox.pdmodel.graphics.image.PDImageXObject
import com.tom_roush.pdfbox.util.Matrix
import java.io.ByteArrayInputStream
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/** Gemeinsame Hilfen für die PDF-Werkzeuge (Koordinaten der angezeigten Seite: oben links = 0,0, y nach unten). */
object Pdfx {
    /** angezeigte Seite → PDF-Koordinaten */
    fun displayMatrix(page: PDPage): Matrix {
        val b = page.cropBox
        val llx = b.lowerLeftX; val lly = b.lowerLeftY; val urx = b.upperRightX; val ury = b.upperRightY
        return when (((page.rotation % 360) + 360) % 360) {
            90 -> Matrix(0f, 1f, 1f, 0f, llx, lly)
            180 -> Matrix(-1f, 0f, 0f, 1f, urx, lly)
            270 -> Matrix(0f, -1f, -1f, 0f, urx, ury)
            else -> Matrix(1f, 0f, 0f, -1f, llx, ury)
        }
    }

    /** Punkt mit Matrix abbilden (Zeilenvektor wie in PDF: p' = p × M) */
    fun tx(m: Matrix, x: Float, y: Float): FloatArray =
        floatArrayOf(m.scaleX * x + m.shearX * y + m.translateX, m.shearY * x + m.scaleY * y + m.translateY)

    fun inverse(m: Matrix): Matrix {
        val a = m.scaleX; val b = m.shearY; val c = m.shearX; val d = m.scaleY; val e = m.translateX; val f = m.translateY
        val det = a * d - b * c
        if (abs(det) < 1e-12f) return Matrix()
        return Matrix(d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det)
    }

    /** PDF-Koordinaten → angezeigte Seite */
    fun toDisplay(page: PDPage, x: Float, y: Float): FloatArray = tx(inverse(displayMatrix(page)), x, y)

    /** Rechteck der angezeigten Seite in PDF-Koordinaten (x, y, b, h) */
    fun toUserRect(page: PDPage, r: RectF): FloatArray {
        val m = displayMatrix(page)
        val p1 = tx(m, r.left, r.top); val p2 = tx(m, r.right, r.bottom)
        return floatArrayOf(min(p1[0], p2[0]), min(p1[1], p2[1]), abs(p2[0] - p1[0]), abs(p2[1] - p1[1]))
    }

    fun mark(o: Any?) { (o as? COSUpdateInfo)?.isNeedToBeUpdated = true }

    /** Seite für angehängtes Speichern kennzeichnen */
    fun markPage(doc: PDDocument, page: PDPage) {
        mark(page.cosObject)
        mark(page.cosObject.getDictionaryObject(COSName.CONTENTS))
        val res = page.resources?.cosObject
        mark(res)
        if (res != null) for (k in listOf(COSName.FONT, COSName.EXT_G_STATE, COSName.XOBJECT)) mark(res.getDictionaryObject(k))
        var parent = page.cosObject.getDictionaryObject(COSName.PARENT) as? COSDictionary
        while (parent != null) { mark(parent); parent = parent.getDictionaryObject(COSName.PARENT) as? COSDictionary }
        mark(doc.documentCatalog.cosObject)
    }

    fun stdFont(family: String, bold: Boolean, italic: Boolean = false): PDType1Font = when (family) {
        "TimesRoman" -> if (bold && italic) PDType1Font.TIMES_BOLD_ITALIC else if (bold) PDType1Font.TIMES_BOLD else if (italic) PDType1Font.TIMES_ITALIC else PDType1Font.TIMES_ROMAN
        "Courier" -> if (bold && italic) PDType1Font.COURIER_BOLD_OBLIQUE else if (bold) PDType1Font.COURIER_BOLD else if (italic) PDType1Font.COURIER_OBLIQUE else PDType1Font.COURIER
        else -> if (bold && italic) PDType1Font.HELVETICA_BOLD_OBLIQUE else if (bold) PDType1Font.HELVETICA_BOLD else if (italic) PDType1Font.HELVETICA_OBLIQUE else PDType1Font.HELVETICA
    }

    /** nur Zeichen behalten, die die Schrift kann (sonst bricht showText ab) */
    fun encodable(f: PDFont, s: String): String = buildString {
        for (ch in s) {
            val c = when (ch) { '‘', '’' -> '\''; '“', '”', '„' -> '"'; '–', '—' -> '-'; ' ' -> ' '; else -> ch }
            try { f.encode(c.toString()); append(c) } catch (e: Exception) { append('?') }
        }
    }

    fun rgb(hex: String): FloatArray {
        val c = try { android.graphics.Color.parseColor(hex) } catch (e: Exception) { android.graphics.Color.BLACK }
        return floatArrayOf(android.graphics.Color.red(c) / 255f, android.graphics.Color.green(c) / 255f, android.graphics.Color.blue(c) / 255f)
    }

    /** neuen Inhalt der Seite schreiben (ersetzt alle bisherigen Inhaltsströme) */
    fun writeContent(doc: PDDocument, page: PDPage, tokens: List<Any>) {
        val s = PDStream(doc)
        s.createOutputStream(COSName.FLATE_DECODE).use { ContentStreamWriter(it).writeTokens(tokens) }
        page.setContents(s)
    }

    // ================================================================ Inhalt der Seite lesen
    /** Textstück (ein Tj/TJ/'/"): Anfang und Ende auf der angezeigten Seite, Schriftgröße */
    class Show(val idx: Int, val x: Float, val y: Float, val x2: Float, val y2: Float, val fs: Float)
    /** Bild (Do mit Bild-XObject oder eingebettetes Bild BI): Lage auf der angezeigten Seite */
    class Img(val idx: Int, val ctm: Matrix, val name: COSName?, val box: RectF, val inline: Boolean)

    class Scan(val page: PDPage) {
        val tokens: MutableList<Any> = PDFStreamParser(page).let { it.parse(); it.tokens.toMutableList() }
        val shows = ArrayList<Show>()
        val imgs = ArrayList<Img>()
        private val inv = inverse(displayMatrix(page))

        private class St(var ctm: Matrix, var font: PDFont?, var fs: Float, var tc: Float, var tw: Float, var th: Float, var tl: Float, var rise: Float) {
            fun copy() = St(ctm.clone(), font, fs, tc, tw, th, tl, rise)
        }

        init { run() }

        private fun num(o: Any?): Float = (o as? COSNumber)?.floatValue() ?: 0f

        private fun disp(m: Matrix, x: Float, y: Float): FloatArray { val p = tx(m, x, y); return tx(inv, p[0], p[1]) }

        private fun run() {
            val res = page.resources
            var st = St(Matrix(), null, 12f, 0f, 0f, 1f, 0f, 0f)
            val stack = ArrayList<St>()
            var tm = Matrix(); var tlm = Matrix()
            val ops = ArrayList<Any>()
            fun td(x: Float, y: Float) { tlm = Matrix.getTranslateInstance(x, y).multiply(tlm); tm = tlm.clone() }
            fun show(idx: Int, bytes: ByteArray) {
                val start = disp(tm.multiply(st.ctm), 0f, st.rise)
                val f = st.font
                if (f != null) {
                    try {
                        val inp = ByteArrayInputStream(bytes)
                        while (inp.available() > 0) {
                            val before = inp.available()
                            val code = f.readCode(inp)
                            val single = before - inp.available() == 1
                            val w = f.getWidth(code) / 1000f
                            val adv = (w * st.fs + st.tc + (if (single && code == 32) st.tw else 0f)) * st.th
                            tm = Matrix.getTranslateInstance(adv, 0f).multiply(tm)
                        }
                    } catch (e: Exception) { }
                }
                val end = disp(tm.multiply(st.ctm), 0f, st.rise)
                // Schriftgröße auf der angezeigten Seite
                val m = tm.multiply(st.ctm)
                val sc = hypot(m.shearX, m.scaleY) * st.fs
                shows.add(Show(idx, start[0], start[1], end[0], end[1], max(1f, sc)))
            }
            for ((idx, t) in tokens.withIndex()) {
                if (t !is Operator) { ops.add(t); continue }
                val o = ops.toList(); ops.clear()
                when (t.name) {
                    "q" -> stack.add(st.copy())
                    "Q" -> if (stack.isNotEmpty()) st = stack.removeAt(stack.size - 1)
                    "cm" -> if (o.size >= 6) st.ctm = Matrix(num(o[0]), num(o[1]), num(o[2]), num(o[3]), num(o[4]), num(o[5])).multiply(st.ctm)
                    "BT" -> { tm = Matrix(); tlm = Matrix() }
                    "Tf" -> if (o.size >= 2) { st.fs = num(o[1]); st.font = try { (o[0] as? COSName)?.let { res?.getFont(it) } } catch (e: Exception) { null } }
                    "Tc" -> st.tc = num(o.getOrNull(0))
                    "Tw" -> st.tw = num(o.getOrNull(0))
                    "Tz" -> st.th = num(o.getOrNull(0)) / 100f
                    "TL" -> st.tl = num(o.getOrNull(0))
                    "Ts" -> st.rise = num(o.getOrNull(0))
                    "Td" -> if (o.size >= 2) td(num(o[0]), num(o[1]))
                    "TD" -> if (o.size >= 2) { st.tl = -num(o[1]); td(num(o[0]), num(o[1])) }
                    "Tm" -> if (o.size >= 6) { tlm = Matrix(num(o[0]), num(o[1]), num(o[2]), num(o[3]), num(o[4]), num(o[5])); tm = tlm.clone() }
                    "T*" -> td(0f, -st.tl)
                    "Tj" -> (o.lastOrNull() as? COSString)?.let { show(idx, it.bytes) }
                    "'" -> { td(0f, -st.tl); (o.lastOrNull() as? COSString)?.let { show(idx, it.bytes) } }
                    "\"" -> { if (o.size >= 3) { st.tw = num(o[0]); st.tc = num(o[1]) }; td(0f, -st.tl); (o.lastOrNull() as? COSString)?.let { show(idx, it.bytes) } }
                    "TJ" -> {
                        val arr = o.lastOrNull() as? COSArray ?: continue
                        val start = disp(tm.multiply(st.ctm), 0f, st.rise)
                        val n0 = shows.size
                        for (k in 0 until arr.size()) {
                            when (val e = arr.getObject(k)) {
                                is COSString -> show(idx, e.bytes)
                                is COSNumber -> tm = Matrix.getTranslateInstance(-e.floatValue() / 1000f * st.fs * st.th, 0f).multiply(tm)
                            }
                        }
                        // ein Eintrag je TJ: von Anfang bis Ende
                        if (shows.size > n0) {
                            val last = shows.last(); val fs = shows.subList(n0, shows.size).maxOf { it.fs }
                            while (shows.size > n0) shows.removeAt(shows.size - 1)
                            shows.add(Show(idx, start[0], start[1], last.x2, last.y2, fs))
                        }
                    }
                    "Do" -> {
                        val name = o.lastOrNull() as? COSName ?: continue
                        val x = try { res?.getXObject(name) } catch (e: Exception) { null }
                        if (x is PDImageXObject) imgs.add(Img(idx, st.ctm.clone(), name, unitBox(st.ctm), false))
                        else if (x is PDFormXObject) { /* Inhalte in Formularen werden nicht einzeln bearbeitet */ }
                    }
                    "BI" -> imgs.add(Img(idx, st.ctm.clone(), null, unitBox(st.ctm), true))
                }
            }
        }

        private fun unitBox(m: Matrix): RectF {
            val pts = listOf(disp(m, 0f, 0f), disp(m, 1f, 0f), disp(m, 0f, 1f), disp(m, 1f, 1f))
            return RectF(pts.minOf { it[0] }, pts.minOf { it[1] }, pts.maxOf { it[0] }, pts.maxOf { it[1] })
        }

        /** Operator an Stelle idx samt seinen Operanden entfernen */
        fun removeOps(idxs: Collection<Int>): MutableList<Any> {
            val drop = HashSet<Int>()
            for (i in idxs) {
                drop.add(i)
                var k = i - 1
                while (k >= 0 && tokens[k] !is Operator) { drop.add(k); k-- }
            }
            return tokens.filterIndexed { i, _ -> i !in drop }.toMutableList()
        }
    }

    fun cosNumbers(vararg v: Float): List<COSBase> = v.map { com.tom_roush.pdfbox.cos.COSFloat(it) }
}
