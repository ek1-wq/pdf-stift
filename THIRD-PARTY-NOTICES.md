# Third-party components

PDF-Stift itself is licensed under the GNU General Public License, version 3 (see `LICENSE`).
It includes or bundles the following components, each under its own license. All of them are
compatible with distribution alongside GPL-3.0 software.

| Component | Used for | License |
|---|---|---|
| [PDF.js](https://github.com/mozilla/pdf.js) (Mozilla) | Displaying PDFs | Apache-2.0 |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | Writing notes into PDFs, page tools | MIT |
| [fontkit](https://github.com/foliojs/fontkit) | Embedding fonts | MIT |
| [fflate](https://github.com/101arrowz/fflate) | ZIP / compression | MIT |
| [PptxGenJS](https://github.com/gitbrent/PptxGenJS) | Export to PowerPoint | MIT |
| [QR Code Generator](https://github.com/kazuhikoarase/qrcode-generator) (Kazuhiko Arase) | QR codes | MIT |
| [Tesseract.js](https://github.com/naptha/tesseract.js) and language data (`eng`, `deu`) | Text recognition (OCR) in the browser part | Apache-2.0 |
| [DejaVu fonts](https://dejavu-fonts.github.io/) | Fonts for text you add to PDFs | Bitstream Vera / DejaVu license (free), see `app/vendor/fonts/LICENSE-DejaVu.txt` |
| [Electron](https://www.electronjs.org/) | Windows and Linux application shell (includes Chromium) | MIT (Chromium: BSD-style, see `LICENSES.chromium.html` in the install folder) |
| [electron-updater](https://github.com/electron-userland/electron-builder) | App updates from GitHub Releases | MIT |
| [PHP](https://www.php.net/) for Windows (official build, bundled unmodified in `resources/php`) | Built-in local server that runs the app's backend on 127.0.0.1 only | PHP License v3.01 (see `resources/php/license.txt`) |
| [PHP](https://www.php.net/) for Linux ([static build](https://static-php.dev/) with its extensions, bundled unmodified in `resources/php`) | Same, in the Linux packages | PHP License v3.01; built-in libraries under their own permissive licenses (OpenSSL Apache-2.0, libcurl curl license, SQLite public domain, zlib, libzip BSD, Oniguruma BSD) |
| [AndroidX](https://developer.android.com/jetpack/androidx), [Kotlin coroutines](https://github.com/Kotlin/kotlinx.coroutines) | Android app | Apache-2.0 |
| [OkHttp](https://square.github.io/okhttp/) | Android app: connection to your own server | Apache-2.0 |
| [PdfBox-Android](https://github.com/TomRoush/PdfBox-Android) | Android app: writing notes into PDFs | Apache-2.0 |
| [PdfiumAndroid](https://github.com/johngray1965/PdfiumAndroidKt) (with [PDFium](https://pdfium.googlesource.com/pdfium/)) | Android app: displaying PDFs | Apache-2.0 (PDFium: BSD-3-Clause) |
| [ZXing](https://github.com/zxing/zxing) | Android app: QR codes | Apache-2.0 |

The PHP runtime is shipped as a separate, unmodified program that executes PDF-Stift's own PHP files;
it is not linked into PDF-Stift.

The text recognition of the Windows app uses the OCR engine built into Windows (`Windows.Media.Ocr`),
which is part of the operating system and not distributed with PDF-Stift.
