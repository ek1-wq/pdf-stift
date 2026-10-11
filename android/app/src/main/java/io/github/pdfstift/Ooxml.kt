package io.github.pdfstift

import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlin.math.roundToInt

/** Word-, Excel- und PowerPoint-Dateien schreiben (ohne fremde Bibliotheken, rein in Kotlin – auch auf dem PC testbar) */
object Ooxml {
    fun esc(s: String) = buildString {
        for (ch in s) {
            when {
                ch == '&' -> append("&amp;")
                ch == '<' -> append("&lt;")
                ch == '>' -> append("&gt;")
                ch == '"' -> append("&quot;")
                ch.code < 0x20 && ch != '\t' && ch != '\n' -> {}
                else -> append(ch)
            }
        }
    }

    private fun zip(out: File, files: List<Pair<String, ByteArray>>) {
        ZipOutputStream(out.outputStream()).use { z -> for ((n, b) in files) { z.putNextEntry(ZipEntry(n)); z.write(b); z.closeEntry() } }
    }
    private fun x(s: String) = s.toByteArray(Charsets.UTF_8)
    private const val HEAD = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
    private const val RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
    private const val R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

    // ---------------------------------------------------------------- Word: Text
    class Para(val text: String, val fs: Float, val bold: Boolean, val pageBreak: Boolean)

    fun docx(paras: List<Para>, out: File) {
        val body = StringBuilder()
        for (p in paras) {
            if (p.pageBreak) body.append("<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>")
            val rpr = (if (p.bold) "<w:b/>" else "") + "<w:sz w:val=\"${(p.fs * 2).roundToInt().coerceIn(8, 144)}\"/>"
            body.append("<w:p><w:r><w:rPr>$rpr</w:rPr><w:t xml:space=\"preserve\">${esc(p.text)}</w:t></w:r></w:p>")
        }
        val doc = HEAD + "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:r=\"$R_NS\"><w:body>$body" +
            "<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1134\" w:right=\"1134\" w:bottom=\"1134\" w:left=\"1134\" w:header=\"709\" w:footer=\"709\" w:gutter=\"0\"/></w:sectPr></w:body></w:document>"
        zip(out, listOf(
            "[Content_Types].xml" to x(HEAD + "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>"),
            "_rels/.rels" to x(HEAD + "<Relationships xmlns=\"$RELS_NS\"><Relationship Id=\"rId1\" Type=\"$R_NS/officeDocument\" Target=\"word/document.xml\"/></Relationships>"),
            "word/document.xml" to x(doc),
        ))
    }

    // ---------------------------------------------------------------- Word: Seiten als Bilder
    /** Bilder (JPEG) mit Seitengröße in Punkten */
    fun docxImages(imgs: List<Pair<ByteArray, Pair<Float, Float>>>, out: File) {
        val first = imgs.firstOrNull()?.second ?: (595f to 842f)
        val body = StringBuilder()
        val rels = StringBuilder()
        for ((k, im) in imgs.withIndex()) {
            val (w, h) = im.second
            // auf die erste Seitengröße einpassen
            val s = minOf(first.first / w, first.second / h)
            val cx = (w * s * 12700).toLong(); val cy = (h * s * 12700).toLong()
            val id = k + 1
            rels.append("<Relationship Id=\"rIdImg$id\" Type=\"$R_NS/image\" Target=\"media/seite$id.jpeg\"/>")
            body.append("<w:p><w:pPr><w:spacing w:before=\"0\" w:after=\"0\"/></w:pPr><w:r><w:drawing><wp:inline distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\"><wp:extent cx=\"$cx\" cy=\"$cy\"/><wp:docPr id=\"$id\" name=\"Seite $id\"/>" +
                "<a:graphic xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\"><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"><pic:pic xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\">" +
                "<pic:nvPicPr><pic:cNvPr id=\"$id\" name=\"seite$id.jpeg\"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed=\"rIdImg$id\"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>" +
                "<pic:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"$cx\" cy=\"$cy\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>")
        }
        val pw = (first.first * 20).roundToInt(); val ph = (first.second * 20).roundToInt()
        val doc = HEAD + "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:r=\"$R_NS\" xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\"><w:body>$body" +
            "<w:sectPr><w:pgSz w:w=\"$pw\" w:h=\"$ph\"${if (pw > ph) " w:orient=\"landscape\"" else ""}/><w:pgMar w:top=\"0\" w:right=\"0\" w:bottom=\"0\" w:left=\"0\" w:header=\"0\" w:footer=\"0\" w:gutter=\"0\"/></w:sectPr></w:body></w:document>"
        val files = arrayListOf(
            "[Content_Types].xml" to x(HEAD + "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Default Extension=\"jpeg\" ContentType=\"image/jpeg\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>"),
            "_rels/.rels" to x(HEAD + "<Relationships xmlns=\"$RELS_NS\"><Relationship Id=\"rId1\" Type=\"$R_NS/officeDocument\" Target=\"word/document.xml\"/></Relationships>"),
            "word/_rels/document.xml.rels" to x(HEAD + "<Relationships xmlns=\"$RELS_NS\">$rels</Relationships>"),
            "word/document.xml" to x(doc),
        )
        imgs.forEachIndexed { k, im -> files.add("word/media/seite${k + 1}.jpeg" to im.first) }
        zip(out, files)
    }

    // ---------------------------------------------------------------- Excel: eine Tabelle je Seite
    fun col(i: Int): String { var n = i + 1; val sb = StringBuilder(); while (n > 0) { val r = (n - 1) % 26; sb.insert(0, ('A' + r)); n = (n - 1) / 26 }; return sb.toString() }
    private val NUM = Regex("^[-+]?(\\d{1,3}(\\.\\d{3})+|\\d+)(,\\d+)?\\s*(%|€|EUR)?$")
    fun number(s: String): Double? {
        val t = s.trim().replace(" ", " ")
        if (!NUM.matches(t)) return null
        val core = t.replace("%", "").replace("€", "").replace("EUR", "").trim().replace(".", "").replace(',', '.')
        return core.toDoubleOrNull()?.let { if (t.endsWith("%")) it / 100 else it }
    }

    /** je Tabelle: Zeilen, je Zeile Spalte → Inhalt */
    fun xlsx(tables: List<List<Map<Int, String>>>, out: File) {
        val sheets = ArrayList<String>()
        for (rows in tables) {
            val sd = StringBuilder()
            for ((ri, cells) in rows.withIndex()) {
                sd.append("<row r=\"${ri + 1}\">")
                for (c in cells.keys.sorted()) {
                    val ref = col(c) + (ri + 1); val v = cells[c]!!
                    val num = number(v)
                    if (num != null) sd.append("<c r=\"$ref\"><v>$num</v></c>")
                    else sd.append("<c r=\"$ref\" t=\"inlineStr\"><is><t xml:space=\"preserve\">${esc(v)}</t></is></c>")
                }
                sd.append("</row>")
            }
            sheets.add(HEAD + "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>$sd</sheetData></worksheet>")
        }
        if (sheets.isEmpty()) sheets.add(HEAD + "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData/></worksheet>")
        val ct = StringBuilder(); val wb = StringBuilder(); val wr = StringBuilder()
        sheets.indices.forEach { i ->
            ct.append("<Override PartName=\"/xl/worksheets/sheet${i + 1}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>")
            wb.append("<sheet name=\"Seite ${i + 1}\" sheetId=\"${i + 1}\" r:id=\"rId${i + 1}\"/>")
            wr.append("<Relationship Id=\"rId${i + 1}\" Type=\"$R_NS/worksheet\" Target=\"worksheets/sheet${i + 1}.xml\"/>")
        }
        val files = arrayListOf(
            "[Content_Types].xml" to x(HEAD + "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>$ct</Types>"),
            "_rels/.rels" to x(HEAD + "<Relationships xmlns=\"$RELS_NS\"><Relationship Id=\"rId1\" Type=\"$R_NS/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>"),
            "xl/workbook.xml" to x(HEAD + "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"$R_NS\"><sheets>$wb</sheets></workbook>"),
            "xl/_rels/workbook.xml.rels" to x(HEAD + "<Relationships xmlns=\"$RELS_NS\">$wr<Relationship Id=\"rIdSt\" Type=\"$R_NS/styles\" Target=\"styles.xml\"/></Relationships>"),
            "xl/styles.xml" to x(HEAD + "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><fonts count=\"1\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font></fonts>" +
                "<fills count=\"2\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill></fills><borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders>" +
                "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs><cellXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/></cellXfs>" +
                "<cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles></styleSheet>"),
        )
        sheets.forEachIndexed { i, s -> files.add("xl/worksheets/sheet${i + 1}.xml" to x(s)) }
        zip(out, files)
    }

    // ---------------------------------------------------------------- PowerPoint: eine Folie je Seite
    fun pptx(imgs: List<Pair<ByteArray, Pair<Float, Float>>>, out: File) {
        val first = imgs.firstOrNull()?.second ?: (842f to 595f)
        // Foliengröße nach der ersten Seite (Breite 10 Zoll)
        val sx = 9144000L; val sy = (sx * first.second / first.first).toLong().coerceIn(914400L, 51206400L)
        val P = "xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"$R_NS\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\""
        val emptyTree = "<p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>"
        val files = ArrayList<Pair<String, ByteArray>>()
        val ct = StringBuilder(); val sl = StringBuilder(); val pr = StringBuilder()
        for ((k, im) in imgs.withIndex()) {
            val n = k + 1
            val (w, h) = im.second
            val s = minOf(sx.toDouble() / w, sy.toDouble() / h)
            val cx = (w * s).toLong(); val cy = (h * s).toLong()
            val ox = (sx - cx) / 2; val oy = (sy - cy) / 2
            files.add("ppt/slides/slide$n.xml" to x(HEAD + "<p:sld $P><p:cSld><p:spTree>$emptyTree" +
                "<p:pic><p:nvPicPr><p:cNvPr id=\"2\" name=\"Seite $n\"/><p:cNvPicPr><a:picLocks noChangeAspect=\"1\"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>" +
                "<p:blipFill><a:blip r:embed=\"rId2\"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>" +
                "<p:spPr><a:xfrm><a:off x=\"$ox\" y=\"$oy\"/><a:ext cx=\"$cx\" cy=\"$cy\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></p:spPr></p:pic>" +
                "</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"))
            files.add("ppt/slides/_rels/slide$n.xml.rels" to x(HEAD + "<Relationships xmlns=\"$RELS_NS\"><Relationship Id=\"rId1\" Type=\"$R_NS/slideLayout\" Target=\"../slideLayouts/slideLayout1.xml\"/><Relationship Id=\"rId2\" Type=\"$R_NS/image\" Target=\"../media/seite$n.jpeg\"/></Relationships>"))
            files.add("ppt/media/seite$n.jpeg" to im.first)
            ct.append("<Override PartName=\"/ppt/slides/slide$n.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slide+xml\"/>")
            sl.append("<p:sldId id=\"${255 + n}\" r:id=\"rId${n + 2}\"/>")
            pr.append("<Relationship Id=\"rId${n + 2}\" Type=\"$R_NS/slide\" Target=\"slides/slide$n.xml\"/>")
        }
        files.add("[Content_Types].xml" to x(HEAD + "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Default Extension=\"jpeg\" ContentType=\"image/jpeg\"/>" +
            "<Override PartName=\"/ppt/presentation.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml\"/>" +
            "<Override PartName=\"/ppt/slideMasters/slideMaster1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml\"/>" +
            "<Override PartName=\"/ppt/slideLayouts/slideLayout1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml\"/>" +
            "<Override PartName=\"/ppt/theme/theme1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.theme+xml\"/>$ct</Types>"))
        files.add("_rels/.rels" to x(HEAD + "<Relationships xmlns=\"$RELS_NS\"><Relationship Id=\"rId1\" Type=\"$R_NS/officeDocument\" Target=\"ppt/presentation.xml\"/></Relationships>"))
        files.add("ppt/presentation.xml" to x(HEAD + "<p:presentation $P saveSubsetFonts=\"1\"><p:sldMasterIdLst><p:sldMasterId id=\"2147483648\" r:id=\"rId1\"/></p:sldMasterIdLst><p:sldIdLst>$sl</p:sldIdLst><p:sldSz cx=\"$sx\" cy=\"$sy\"/><p:notesSz cx=\"6858000\" cy=\"9144000\"/></p:presentation>"))
        files.add("ppt/_rels/presentation.xml.rels" to x(HEAD + "<Relationships xmlns=\"$RELS_NS\"><Relationship Id=\"rId1\" Type=\"$R_NS/slideMaster\" Target=\"slideMasters/slideMaster1.xml\"/><Relationship Id=\"rId2\" Type=\"$R_NS/theme\" Target=\"theme/theme1.xml\"/>$pr</Relationships>"))
        files.add("ppt/slideMasters/slideMaster1.xml" to x(HEAD + "<p:sldMaster $P><p:cSld><p:spTree>$emptyTree</p:spTree></p:cSld>" +
            "<p:clrMap bg1=\"lt1\" tx1=\"dk1\" bg2=\"lt2\" tx2=\"dk2\" accent1=\"accent1\" accent2=\"accent2\" accent3=\"accent3\" accent4=\"accent4\" accent5=\"accent5\" accent6=\"accent6\" hlink=\"hlink\" folHlink=\"folHlink\"/>" +
            "<p:sldLayoutIdLst><p:sldLayoutId id=\"2147483649\" r:id=\"rId1\"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>"))
        files.add("ppt/slideMasters/_rels/slideMaster1.xml.rels" to x(HEAD + "<Relationships xmlns=\"$RELS_NS\"><Relationship Id=\"rId1\" Type=\"$R_NS/slideLayout\" Target=\"../slideLayouts/slideLayout1.xml\"/><Relationship Id=\"rId2\" Type=\"$R_NS/theme\" Target=\"../theme/theme1.xml\"/></Relationships>"))
        files.add("ppt/slideLayouts/slideLayout1.xml" to x(HEAD + "<p:sldLayout $P type=\"blank\" preserve=\"1\"><p:cSld name=\"Leer\"><p:spTree>$emptyTree</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>"))
        files.add("ppt/slideLayouts/_rels/slideLayout1.xml.rels" to x(HEAD + "<Relationships xmlns=\"$RELS_NS\"><Relationship Id=\"rId1\" Type=\"$R_NS/slideMaster\" Target=\"../slideMasters/slideMaster1.xml\"/></Relationships>"))
        files.add("ppt/theme/theme1.xml" to x(HEAD + THEME))
        zip(out, files)
    }

    private val THEME = "<a:theme xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" name=\"Office\"><a:themeElements>" +
        "<a:clrScheme name=\"Office\"><a:dk1><a:sysClr val=\"windowText\" lastClr=\"000000\"/></a:dk1><a:lt1><a:sysClr val=\"window\" lastClr=\"FFFFFF\"/></a:lt1>" +
        "<a:dk2><a:srgbClr val=\"1F2F6E\"/></a:dk2><a:lt2><a:srgbClr val=\"E9ECF2\"/></a:lt2><a:accent1><a:srgbClr val=\"1F4FD6\"/></a:accent1><a:accent2><a:srgbClr val=\"D6262B\"/></a:accent2>" +
        "<a:accent3><a:srgbClr val=\"13804A\"/></a:accent3><a:accent4><a:srgbClr val=\"FF4A1C\"/></a:accent4><a:accent5><a:srgbClr val=\"A855F7\"/></a:accent5><a:accent6><a:srgbClr val=\"FFE14D\"/></a:accent6>" +
        "<a:hlink><a:srgbClr val=\"0563C1\"/></a:hlink><a:folHlink><a:srgbClr val=\"954F72\"/></a:folHlink></a:clrScheme>" +
        "<a:fontScheme name=\"Office\"><a:majorFont><a:latin typeface=\"Calibri\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:majorFont><a:minorFont><a:latin typeface=\"Calibri\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:minorFont></a:fontScheme>" +
        "<a:fmtScheme name=\"Office\"><a:fillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:fillStyleLst>" +
        "<a:lnStyleLst><a:ln w=\"6350\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:ln><a:ln w=\"12700\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:ln><a:ln w=\"19050\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:ln></a:lnStyleLst>" +
        "<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>" +
        "<a:bgFillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>" +
        "</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>"
}
