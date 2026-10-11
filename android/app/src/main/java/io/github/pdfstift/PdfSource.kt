package io.github.pdfstift

import android.content.Context
import android.graphics.Bitmap
import android.os.ParcelFileDescriptor
import io.legere.pdfiumandroid.PdfDocument
import io.legere.pdfiumandroid.PdfiumCore
import java.io.File

/**
 * PDF-Seiten zeichnen – mit PDFium (wie Chrome), einschließlich Anmerkungen aus anderen Programmen
 * (z. B. Notizen aus PDF Expert). Nur von einem einzigen Hintergrund-Thread aus benutzen.
 */
class PdfSource(ctx: Context, file: File) {
    private val fd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    private val core = PdfiumCore(ctx)
    private val doc: PdfDocument = core.newDocument(fd)
    val pageCount: Int = doc.getPageCount()

    /** Seitengröße in Punkten (so wie angezeigt, also mit Drehung) */
    fun size(i: Int): Pair<Float, Float> = doc.openPage(i).use { p ->
        p.getPageWidthPoint().toFloat() to p.getPageHeightPoint().toFloat()
    }

    /**
     * Seite i so zeichnen, als wäre sie drawW × drawH Pixel groß und um (-offX, -offY) verschoben –
     * so lässt sich auch nur ein Ausschnitt in voller Schärfe berechnen.
     */
    fun render(i: Int, bmp: Bitmap, offX: Int, offY: Int, drawW: Int, drawH: Int) {
        doc.openPage(i).use { p -> p.renderPageBitmap(bmp, -offX, -offY, drawW, drawH, true) }
    }

    fun close() {
        try { doc.close() } catch (e: Exception) { }
        try { fd.close() } catch (e: Exception) { }
    }
}
