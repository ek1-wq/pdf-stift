package io.github.pdfstift

import android.graphics.Bitmap

/** Die freie Ausgabe enthält keine Google-Texterkennung: Scans am PC (Windows/Linux) durchsuchbar machen. */
object OcrEngine {
    const val AVAILABLE = false
    fun recognize(bmp: Bitmap, sc: Float): List<Ocr.Word> = emptyList()
}
