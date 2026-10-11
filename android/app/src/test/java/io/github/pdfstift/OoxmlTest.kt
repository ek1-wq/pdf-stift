package io.github.pdfstift

import org.junit.Test
import java.io.File

/** schreibt Beispieldateien nach build/ooxml-test – werden anschließend außerhalb geprüft */
class OoxmlTest {
    private val dir = File("build/ooxml-test").apply { mkdirs() }
    // kleinstes gültiges JPEG (1×1 Pixel, grau)
    private val jpg = java.util.Base64.getDecoder().decode(
        "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=")

    @Test fun docx() = Ooxml.docx(listOf(
        Ooxml.Para("Überschrift & <Test>", 18f, true, false),
        Ooxml.Para("Ein normaler Absatz mit Umlauten äöü ß und \"Zitat\".", 11f, false, false),
        Ooxml.Para("Zweite Seite", 12f, false, true)), File(dir, "text.docx"))

    @Test fun docxImages() = Ooxml.docxImages(listOf(jpg to (595f to 842f), jpg to (842f to 595f)), File(dir, "bilder.docx"))

    @Test fun xlsx() = Ooxml.xlsx(listOf(
        listOf(mapOf(0 to "Posten", 1 to "Betrag"), mapOf(0 to "Miete", 1 to "1.234,50 €"), mapOf(0 to "Quote", 1 to "12,5 %")),
        listOf(mapOf(2 to "nur Spalte C"))), File(dir, "tabelle.xlsx"))

    @Test fun pptx() = Ooxml.pptx(listOf(jpg to (842f to 595f), jpg to (595f to 842f)), File(dir, "folien.pptx"))
}
