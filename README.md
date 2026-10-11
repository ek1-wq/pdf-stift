# PDF-Stift

**Annotate PDFs with pen, mouse and keyboard. Free and open source for Windows.**

PDF-Stift is a PDF app for reading, marking up and organizing documents such as lecture slides, papers and scans. You can write on pages with a stylus, highlight text, add comments and text boxes, and search the full text of your whole library. Notes are saved automatically and written into the PDF, so every other PDF program shows them too.

Everything stays on your PC. PDF-Stift needs no account, no cloud and no server, and it sends no usage data. Your library is an ordinary folder (`Documents\PDF-Stift`) that you can back up and sync like any other folder.

**[⬇ Download for Windows](https://github.com/ek1-wq/pdf-stift/releases/latest)** · [Deutsch](README.de.md)

![Writing and highlighting on lecture slides](docs/screenshots/viewer.png)

## What you can do

- **Write and mark up.** Pen, highlighter, text highlighting, underline and strike-through, shapes, text boxes, sticky-note comments, lasso, eraser and a laser pointer for presenting. Pressure-sensitive pens work on touch screens and pen tablets.
- **Notes become part of the PDF.** They are saved as you write. When you close a PDF, they are written into the file itself, and earlier versions are kept.
- **Full-text search.** Search inside all of your PDFs at once. Scanned pages become searchable through the text recognition built into Windows.
- **Tools.** Organize pages (reorder, rotate, delete, extract, split), combine PDFs, edit text and images, add a header, footer, page numbers or watermark, insert bookmarks, stamp, fill and sign forms, prepare form fields, compare versions, redact, password-protect, export to Word, Excel, PowerPoint or images, and print handouts with 2–9 slides per page.
- **Clean up scans.** Straighten skewed pages, remove blank pages and increase contrast.
- **Fits into Windows.** Open PDFs from Explorer ("Open in PDF-Stift", "Send to"), drag Word, PowerPoint or Excel files in (converted with your installed Microsoft Office), print from any program to the "PDF-Stift" printer, watch a folder, and drag PDFs out into Explorer or an e-mail.
- **Notebook.** Infinite-canvas pages for handwritten notes next to your PDFs.
- **English and German.** Switch under Settings → Language.

| Library | Tools |
|---|---|
| ![Library](docs/screenshots/library.png) | ![Tools](docs/screenshots/tools.png) |

![Full-text search across all PDFs](docs/screenshots/search.png)

## Install

1. Download `PDF-Stift-Setup-….exe` from the [latest release](https://github.com/ek1-wq/pdf-stift/releases/latest).
2. Run it. The installer isn't code-signed yet, so Windows SmartScreen may say "Windows protected your PC". Click **More info → Run anyway**.
3. Start PDF-Stift and add PDFs with **Add PDF**, by dragging them into the window, or by putting them into `Documents\PDF-Stift`.

New versions show up in the app as **Update available**. You can also use Help → Check for updates.

Requirements: Windows 10 or 11 (64-bit). Converting Office files needs Microsoft Office. Everything else works without it.

## How it works

PDF-Stift is an [Electron](https://www.electronjs.org/) app. Its user interface (`app/`, HTML and JavaScript with [PDF.js](https://mozilla.github.io/pdf.js/) and [pdf-lib](https://pdf-lib.js.org/)) talks to a small PHP backend (`app/api.php`). The installer bundles the official PHP build for Windows, and the app starts it as a private server that listens only on `127.0.0.1` and accepts only requests that carry a random key known to the app. No other program and no other computer can reach it.

```
app/          user interface and PHP backend
desktop/      Windows app (Electron): window, menus, printer, Explorer integration, updates
tools/i18n/   English translation (dictionary + generator)
tools/build-windows.sh   builds the installer (bundles PHP, runs a smoke test)
```

### Build it yourself

You need Windows with Git Bash and Node.js 20:

```bash
tools/build-windows.sh 1.0.0      # → desktop/dist/PDF-Stift-Setup-1.0.0.exe
```

To develop, put a PHP 8.1+ build into `desktop/php/` (`php.exe` plus `php.ini` from `desktop/php.ini`), then run `npm install` and `npx electron .` in `desktop/`.

### Translations

The German texts in the source are the originals. `tools/i18n/en.json` maps each one to English, and `node tools/i18n/i18n.js build` generates the English files (`app/app/app.en.js`, `app/index.en.php`, `desktop/main.en.js`). `node tools/i18n/i18n.js extract` lists the texts that have no translation yet.

## Contributing

Bug reports and ideas are welcome as [issues](https://github.com/ek1-wq/pdf-stift/issues). Please include your Windows version and the PDF-Stift version (Help → About). Pull requests are welcome too. By contributing you agree that your contribution is licensed under the GPL-3.0.

## License

PDF-Stift is free software: you can redistribute it and/or modify it under the terms of the **GNU General Public License, version 3** ([LICENSE](LICENSE)). It comes with no warranty.

Bundled third-party components (PDF.js, pdf-lib, Tesseract.js, Electron, PHP and others) keep their own licenses. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

© PDF-Stift contributors
