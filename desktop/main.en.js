/* Automatisch erzeugt aus main.js (tools/i18n) – nicht von Hand ändern. */
// PDF-Stift für Windows: eigenes Programmfenster für pdf-stift.example.org – mit Stift, offline-fähig (wie im Browser),
// „Öffnen mit PDF-Stift“ für PDFs aus dem Explorer und automatischen Updates.
const { app, BrowserWindow, shell, dialog, session, Menu, ipcMain, nativeImage, nativeTheme, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');

const G = global.PDFSTIFT || { edition: 'server', lang: 'de' };
const LOCAL = G.edition === 'local'; // freie Ausgabe: alles auf diesem PC, ohne pdf-stift.example.org
const LANG = G.lang === 'en' ? 'en' : 'de';
const local = LOCAL ? require('./local') : null;
let BASE = LOCAL ? 'http://127.0.0.1/' : 'https://pdf-stift.example.org/';
const PART = 'persist:pdfstift';
const DROP0 = LANG === 'en' ? 'Documents' : 'Dokumente';
// Anfragen an PDF-Stift aus dem Programm selbst (in der freien Ausgabe mit dem Schlüssel des internen Servers)
const sfetch = (url, opt = {}) => fetch(url, LOCAL ? { ...opt, headers: { ...(opt.headers || {}), 'X-PDFStift-Local': local.KEY } } : opt);
let win = null;
let ready = false;
const waiting = [];

const pdfArgs = (argv) => argv.slice(1).filter((a) => (/\.pdf$/i.test(a) || OFFICE.test(a)) && fs.existsSync(a));
// aus der Sprungliste (Rechtsklick auf das Symbol in der Taskleiste): --pdfstift-open=<Pfad in der Bibliothek>
const libArg = (argv) => { const a = argv.find((x) => x.startsWith('--pdfstift-open=')); return a ? a.slice(16).replace(/^"|"$/g, '') : ''; };

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    pdfArgs(argv).forEach(openFile);
    const lp = libArg(argv);
    if (lp && win) win.loadURL(BASE + '?open=' + encodeURIComponent(lp));
  });
  app.whenReady().then(start);
  app.on('window-all-closed', () => app.quit());
}

// ---------------------------------------------------------------- Fensterposition merken
const stateFile = () => path.join(app.getPath('userData'), 'fenster.json');
function loadState() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) { return { width: 1300, height: 900, max: true }; } }
function saveState() {
  if (!win) return;
  const b = win.getNormalBounds();
  try { fs.writeFileSync(stateFile(), JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, max: win.isMaximized() })); } catch (e) { /* egal */ }
}

async function start() {
  if (LOCAL) {
    try { BASE = await local.start(LANG, (m) => console.log(m)); } catch (e) {
      dialog.showErrorBox('PDF-Stift', "PDF-Stift could not start: " + String(e.message || e));
      app.quit();
      return;
    }
    local.attach(session.fromPartition(PART));
  }
  const st = loadState();
  win = new BrowserWindow({
    x: st.x, y: st.y, width: st.width || 1300, height: st.height || 900, minWidth: 640, minHeight: 480,
    title: 'PDF-Stift', icon: path.join(__dirname, 'icon.png'), backgroundColor: '#E9ECF2', autoHideMenuBar: false, show: false,
    webPreferences: { partition: PART, spellcheck: true, preload: path.join(__dirname, 'preload.js') },
  });
  if (st.max) win.maximize();
  win.once('ready-to-show', () => { if (process.argv.includes('--minimiert')) win.showInactive(), win.minimize(); else win.show(); });
  win.on('close', saveState);
  const wc = win.webContents;
  wc.setUserAgent(wc.getUserAgent() + ' PDFStiftWindows/' + app.getVersion());
  session.fromPartition(PART).setSpellCheckerLanguages(['de-DE', 'en-US']);
  // Links nach außen (Hilfe, Live-Mitschau-Link …) im normalen Browser öffnen
  wc.setWindowOpenHandler(({ url }) => {
    // Präsentationsfenster: auf dem zweiten Bildschirm (Beamer) im Vollbild, sonst als normales Fenster (z. B. für Teams)
    if (url.startsWith(BASE) && /[?&]show=1/.test(url)) {
      const prim = screen.getPrimaryDisplay();
      const ext = screen.getAllDisplays().find((d) => d.id !== prim.id);
      const o = { title: "Presentation – PDF-Stift", autoHideMenuBar: true, backgroundColor: '#0D0F14', icon: path.join(__dirname, 'icon.png') };
      if (ext) Object.assign(o, { x: ext.bounds.x, y: ext.bounds.y, width: ext.bounds.width, height: ext.bounds.height, fullscreen: true });
      else Object.assign(o, { width: 1280, height: 760 });
      return { action: 'allow', overrideBrowserWindowOptions: o };
    }
    if (url.startsWith(BASE) && !/live\.php/.test(url)) return { action: 'allow' };
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => { if (!url.startsWith(BASE) && !url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });
  wc.on('did-fail-load', (_e, code, _desc, url, isMain) => { if (isMain && code !== -3 && url.startsWith(BASE)) win.loadFile(path.join(__dirname, 'offline.html')); });
  wc.on('did-finish-load', () => { if (!ready) { ready = true; waiting.splice(0).forEach(openFile); } });
  // Rechtsklick in Eingabefeldern: Ausschneiden, Kopieren, Einfügen, Rechtschreibvorschläge (auf den PDF-Seiten hat PDF-Stift ein eigenes Menü)
  wc.on('context-menu', (_e, p) => {
    const t = [];
    if (p.misspelledWord) {
      for (const s of (p.dictionarySuggestions || []).slice(0, 5)) t.push({ label: s, click: () => wc.replaceMisspelling(s) });
      if (t.length) t.push({ type: 'separator' });
    }
    if (p.isEditable) {
      t.push({ label: "Cut", role: 'cut', enabled: p.editFlags.canCut }, { label: "Copy", role: 'copy', enabled: p.editFlags.canCopy },
        { label: "Paste", role: 'paste', enabled: p.editFlags.canPaste }, { type: 'separator' }, { label: "Select All", role: 'selectAll' });
    } else if (p.selectionText) t.push({ label: "Copy", role: 'copy' });
    if (t.length) Menu.buildFromTemplate(t).popup({ window: win });
  });
  menu();
  pdfArgs(process.argv).forEach((f) => waiting.push(f));
  sendTo();
  printWatch();
  const lp0 = libArg(process.argv);
  win.loadURL(lp0 ? BASE + '?open=' + encodeURIComponent(lp0) : BASE);
  regMenu();
  hotStart();
  // erste Prüfung kurz nach dem Start, dann alle 6 Stunden
  setTimeout(() => updates(false), 8000);
  setInterval(() => updates(false), 6 * 3600 * 1000);
}

// ---------------------------------------------------------------- Hilfe: Kurzanleitung und „Über“ mit allen Versionsnummern
// die Kurzanleitung ist eine PDF in der Bibliothek (Ordner „Hilfe“) – die Seite legt sie dort ab und öffnet sie
function openHelp() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  win.webContents.send('cmd', 'help');
}
async function about() {
  if (LOCAL) {
    const r = await dialog.showMessageBox(win, {
      type: 'info', title: "About PDF-Stift", message: `PDF-Stift ${app.getVersion()}`,
      detail: `Free software under the GNU General Public License, version 3 (GPL-3.0).

Library: ${local.libraryDir()}

Source code, updates and help: github.com/${G.repo || 'ek1-wq/pdf-stift'}`,
      buttons: ['OK', "Quick guide", "Open project page"], defaultId: 0,
    });
    if (r.response === 1) openHelp();
    if (r.response === 2) shell.openExternal('https://github.com/' + (G.repo || 'ek1-wq/pdf-stift'));
    return;
  }
  let srv = '–', tab = '–';
  // über die geöffnete Seite fragen (sie ist angemeldet)
  const q = (u) => (win && !win.isDestroyed() ? win.webContents.executeJavaScript(`fetch(${JSON.stringify(BASE + u)}, { credentials: 'same-origin', cache: 'no-store', headers: { 'X-PDFStift': '1' } }).then((r) => r.json()).catch(() => null)`).catch(() => null) : Promise.resolve(null));
  const [me, su, av] = await Promise.all([q('api.php?a=me'), q('api.php?a=srvupdate'), q('android/version.json')]);
  if (me && me.version) srv = me.version + (su && su.available ? ` (update to ${su.latest} ready)` : '');
  if (av && av.versionName) tab = av.versionName;
  dialog.showMessageBox(win, {
    type: 'info', title: "About PDF-Stift", message: `PDF-Stift ${srv}`,
    detail: `PDF-Stift itself (from the server ${BASE.replace(/^https?:\/\/|\/$/g, '')}): ${srv}
Windows program window: ${app.getVersion()} (rarely changes)
Current tablet app: ${tab}`,
    buttons: ['OK', "Quick guide"], defaultId: 0,
  }).then((r) => { if (r.response === 1) openHelp(); });
}

// ---------------------------------------------------------------- Menüleiste wie bei Windows-Programmen
const cmd = (c) => () => { if (win && !win.isDestroyed()) win.webContents.send('cmd', c); };
function menu() {
  // Einzelbuchstaben nur anzeigen – die Seite selbst reagiert darauf (sonst ginge Tippen in Textfeldern nicht)
  const tool = (id, label, accelerator) => ({ label, accelerator, registerAccelerator: false, click: cmd('tool:' + id) });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "&File", id: 'm-datei', submenu: [
      { label: "Open PDF …", accelerator: 'Ctrl+O', click: pickPdf },
      { label: LOCAL ? "Add to Library …" : "Upload to Library …", click: cmd('upload') },
      { label: "Library", accelerator: 'Ctrl+Shift+B', click: cmd('library') },
      { label: "New presentation …", click: cmd('newdeck') },
      { label: "Presentations", click: cmd('decks') },
      { label: "Open PowerPoint files as presentations …", click: cmd('pptximport') },
      { label: "Import folder of PowerPoint files …", click: cmd('pptxfolder') },
      { type: 'separator' },
      { label: "Save (with notes) …", accelerator: 'Ctrl+S', click: cmd('save') },
      { label: "Download original …", click: cmd('original') },
      { label: "Print …", accelerator: 'Ctrl+P', click: cmd('print') },
      { type: 'separator' },
      { label: "Document properties …", accelerator: 'Ctrl+D', click: cmd('props') },
      { label: "Settings …", accelerator: 'Ctrl+,', registerAccelerator: false, click: cmd('settings') },
      { label: "Set up as printer (“PDF-Stift” in Word, Chrome …) …", click: () => printerSetup() },
      { type: 'separator' },
      { label: "Close", accelerator: 'Ctrl+W', click: cmd('close') },
      { label: "Exit", accelerator: 'Alt+F4', role: 'quit' },
    ] },
    { label: "&Edit", id: 'm-bearbeiten', submenu: [
      { label: "Undo", accelerator: 'Ctrl+Z', click: cmd('undo') },
      { label: "Redo", accelerator: 'Ctrl+Y', click: cmd('redo') },
      { type: 'separator' },
      { label: "Cut", role: 'cut' },
      { label: "Copy", role: 'copy' },
      { label: "Paste", role: 'paste' },
      { label: "Select All", role: 'selectAll' },
      { type: 'separator' },
      { label: "Search …", accelerator: 'Ctrl+F', click: cmd('find') },
      { label: "Find next", accelerator: 'F3', click: cmd('findNext') },
      { label: "Previous match", accelerator: 'Shift+F3', click: cmd('findPrev') },
    ] },
    { label: "&View", id: 'm-ansicht', submenu: [
      { label: "Fit width", accelerator: 'Ctrl+2', click: cmd('fitw') },
      { label: "Fit page", accelerator: 'Ctrl+0', click: cmd('fitp') },
      { label: "Actual size (100 %)", accelerator: 'Ctrl+1', click: cmd('actual') },
      { label: "Zoom in", accelerator: 'Ctrl+Plus', click: cmd('zin') },
      { label: "Zoom out", accelerator: 'Ctrl+-', click: cmd('zout') },
      { type: 'separator' },
      { label: "First page", accelerator: 'Home', registerAccelerator: false, click: cmd('first') },
      { label: "Previous page", accelerator: 'PageUp', registerAccelerator: false, click: cmd('prev') },
      { label: "Next page", accelerator: 'PageDown', registerAccelerator: false, click: cmd('next') },
      { label: "Last page", accelerator: 'End', registerAccelerator: false, click: cmd('last') },
      { type: 'separator' },
      { label: "Single pages", click: cmd('single') },
      { label: "Two pages side by side", click: cmd('two') },
      { label: "Two pages, cover page separate", click: cmd('cover') },
      { label: "Two documents side by side", accelerator: 'Ctrl+Shift+D', click: cmd('split') },
      { label: "Rotate view clockwise", accelerator: 'Ctrl+Shift+R', click: cmd('rotR') },
      { label: "Rotate view counterclockwise", accelerator: 'Ctrl+Shift+L', click: cmd('rotL') },
      { type: 'separator' },
      { label: "Sidebar (page thumbnails)", click: cmd('thumbs') },
      { label: "Comments (list)", click: cmd('comments') },
      { label: "Next tab", accelerator: 'Ctrl+Tab', click: cmd('nextTab') },
      { label: "Previous tab", accelerator: 'Ctrl+Shift+Tab', click: cmd('prevTab') },
      { type: 'separator' },
      { label: "Customize toolbar …", click: cmd('vbcfg') },
      { label: "Hide toolbars", accelerator: 'Ctrl+H', click: cmd('focus') },
      { label: "Presentation", accelerator: 'Ctrl+L', click: cmd('present') },
      { label: "Presentation with presenter view", accelerator: 'Ctrl+Shift+P', click: cmd('presenter') },
      { label: "Full screen", accelerator: 'F11', role: 'togglefullscreen' },
      { type: 'separator' },
      { label: "Collapse/expand ribbon", accelerator: 'Ctrl+F1', registerAccelerator: false, click: cmd('rb:rb:collapse') },
      { label: "Compact: ribbon only (hide tools row)", click: cmd('rb:rb:compact') },
      { label: "Grid", click: cmd('rb:v:grid') },
      { label: "Snap to objects", click: cmd('rb:v:snap') },
      { label: "Slide sorter (presentation)", click: cmd('rb:v:sorter') },
      { label: "Notes below the slide (presentation)", click: cmd('rb:v:notes') },
      { type: 'separator' },
      { label: "Reload", accelerator: 'Ctrl+Shift+F5', click: () => win && win.webContents.reload() },
    ] },
    { label: "&Insert", id: 'm-einfuegen', submenu: [
      { label: "Text box", click: cmd('rb:ins:text') },
      { label: "Image …", click: cmd('rb:ins:img') },
      { label: "Table …", click: cmd('rb:ins:table') },
      { label: "Chart …", click: cmd('rb:ins:chart') },
      { label: "Clip from a PDF …", click: cmd('rb:ins:crop') },
      { label: "Shape", submenu: [
        { label: "Rectangle", click: cmd('rb:ins:shape:rect') }, { label: "Rounded rectangle", click: cmd('rb:ins:shape:round') }, { label: "Circle / ellipse", click: cmd('rb:ins:shape:ellipse') },
        { label: "Triangle", click: cmd('rb:ins:shape:tri') }, { label: "Line", click: cmd('rb:ins:shape:line') }, { label: "Arrow", click: cmd('rb:ins:shape:arrow') },
        { label: "Block arrow", click: cmd('rb:ins:shape:arrowR') }, { label: "Elbow connector", click: cmd('rb:ins:shape:elbow') }, { label: "Speech bubble", click: cmd('rb:ins:shape:callout') },
        { label: "Star", click: cmd('rb:ins:shape:star5') }, { label: "Curly brace", click: cmd('rb:ins:shape:braceL') },
        { type: 'separator' }, { label: "All shapes …", click: cmd('rb:btn:start:[data-menu="shapes"]') },
      ] },
      { type: 'separator' },
      { label: "Special characters …", click: cmd('rb:btn:insert:[data-menu="sym"]') },
      { label: "Date", click: cmd('rb:f:date') },
      { label: 'Link …', accelerator: 'Ctrl+K', registerAccelerator: false, click: cmd('rb:f:link') },
      { type: 'separator' },
      { label: "New slide …", accelerator: 'Ctrl+M', registerAccelerator: false, click: cmd('rb:btn:start:[data-menu="newslide"]') },
      { label: "Slides from PDF …", click: cmd('rb:btn:insert:[data-menu="pdfslides"]') },
      { label: "Header and footer, slide number …", click: cmd('rb:f:x:hf') },
    ] },
    { label: 'F&ormat', id: 'm-format', submenu: [
      { label: "Bold", accelerator: 'Ctrl+B', registerAccelerator: false, click: cmd('rb:f:bold') },
      { label: "Italic", accelerator: 'Ctrl+I', registerAccelerator: false, click: cmd('rb:f:italic') },
      { label: "Underline", accelerator: 'Ctrl+U', registerAccelerator: false, click: cmd('rb:f:underline') },
      { label: "Strikethrough", click: cmd('rb:f:strike') },
      { label: "Superscript", click: cmd('rb:f:sup') },
      { label: "Subscript", click: cmd('rb:f:sub') },
      { label: "Increase font size", accelerator: 'Ctrl+]', registerAccelerator: false, click: cmd('rb:f:fs+') },
      { label: "Decrease font size", accelerator: 'Ctrl+[', registerAccelerator: false, click: cmd('rb:f:fs-') },
      { label: "Clear formatting", click: cmd('rb:f:clear') },
      { label: "Format painter", click: cmd('rb:f:painter') },
      { type: 'separator' },
      { label: "Bullets", click: cmd('rb:f:ul') },
      { label: "Numbering", click: cmd('rb:f:ol') },
      { label: "Align text", submenu: [
        { label: "Align left", click: cmd('rb:f:al:left') }, { label: "Center", click: cmd('rb:f:al:center') },
        { label: "Align right", click: cmd('rb:f:al:right') }, { label: "Justify", click: cmd('rb:f:al:justify') },
      ] },
      { label: "Line spacing", submenu: ['1', '1.15', '1.5', '2'].map((v) => ({ label: v.replace('.', ','), click: cmd('rb:f:lh:' + v) })) },
      { type: 'separator' },
      { label: "Group", accelerator: 'Ctrl+G', registerAccelerator: false, click: cmd('rb:f:group') },
      { label: "Ungroup", accelerator: 'Ctrl+Shift+G', registerAccelerator: false, click: cmd('rb:f:ungroup') },
      { label: "Bring to front", click: cmd('rb:f:x:front') },
      { label: "Send to back", click: cmd('rb:f:x:back') },
      { label: "Rotate 90°", click: cmd('rb:f:rot90') },
      { label: "Flip horizontally", click: cmd('rb:f:flip:x') },
      { label: "Flip vertically", click: cmd('rb:f:flip:y') },
      { label: "Shadow on/off", click: cmd('rb:f:sh') },
      { type: 'separator' },
      { label: "Find and replace …", click: cmd('rb:f:replace') },
    ] },
    { label: "Slide &Show", id: 'm-show', submenu: [
      { label: "From beginning", accelerator: 'F5', registerAccelerator: false, click: cmd('rb:show:begin') },
      { label: "From current slide/page", accelerator: 'Shift+F5', registerAccelerator: false, click: cmd('rb:show:cur') },
      { label: "Presenter view", click: cmd('rb:show:presenter') },
      { type: 'separator' },
      { label: "Hide/show slide", click: cmd('rb:show:hide') },
      { label: "Apply this transition to all slides", click: cmd('rb:show:trall') },
    ] },
    { label: "&Tools", id: 'm-werkzeuge', submenu: [
      tool('sel', "Select text", 'V'),
      tool('hand', 'Hand', 'H'),
      { type: 'separator' },
      tool('pen', "Pen", 'P'),
      tool('hl', "Highlighter (freehand)", 'M'),
      tool('tx', "Highlight text", 'U'),
      tool('sh', "Shapes"),
      tool('tt', "Text box", 'T'),
      tool('nt', "Comment (sticky note)"),
      tool('la', 'Lasso'),
      tool('er', "Eraser", 'E'),
      tool('lp', "Laser pointer"),
      { type: 'separator' },
      { label: "Rotate this page", click: cmd('rotate') },
      { label: "Clean up scans …", click: cmd('scanfix') },
      { label: "Create handouts …", click: cmd('handout') },
      { label: "Add slide marker", accelerator: 'Ctrl+M', click: cmd('mkf') },
      { label: "Add video marker", click: cmd('mkv') },
      { label: "Study sheet from highlights …", click: cmd('study') },
      { label: "Copy to notebook …", click: cmd('tonb') },
      { label: "Take over notes from an older version …", click: cmd('carry') },
      { label: "Add text snippet …", click: cmd('snippets') },
      { label: "Find and redact …", click: cmd('findredact') },
      { label: "All tools …", click: cmd('allTools') },
      ...(LOCAL ? [] : [{ label: "Live view for students …", click: cmd('live') }]),
    ] },
    { label: "&Notebook", id: 'm-notizbuch', submenu: [
      { label: "Insert PDF pages …", click: cmd('nbpdf') },
      { label: "Insert template (Cornell, meeting, lecture) …", click: cmd('nbtpl') },
      { label: "Insert link …", click: cmd('nblink') },
      { label: "What links here? …", click: cmd('nbback') },
      { label: "Search on notebook page", click: cmd('nbsearch') },
      { label: "Earlier versions …", click: cmd('nbhist') },
      { type: 'separator' },
      { label: "Save notebook page as PDF …", click: cmd('save') },
      { label: "Print notebook page …", click: cmd('print') },
    ] },
    { label: "&Help", id: 'm-hilfe', submenu: [
      { label: "Quick guide", accelerator: 'F1', click: () => openHelp() },
      { type: 'separator' },
      { label: "Check for updates", click: () => updates(true) },
      ...(LOCAL ? [] : [{ label: "Improvement report …", click: cmd('report') }]),
      ...(LOCAL ? [
        { label: "Open library folder", click: () => shell.openPath(local.libraryDir()) },
        { label: "Change library folder …", click: () => pickLibrary() },
        { label: "Project page on GitHub", click: () => shell.openExternal('https://github.com/' + (G.repo || 'ek1-wq/pdf-stift')) },
      ] : [{ label: "Open PDF-Stift in browser", click: () => shell.openExternal(BASE) }]),
      { type: 'separator' },
      { label: "Developer tools", accelerator: 'Ctrl+Shift+I', role: 'toggleDevTools' },
      { label: "About PDF-Stift", click: () => about() },
    ] },
  ]));
}

async function pickPdf() {
  const r = await dialog.showOpenDialog(win, { title: "Import PDF into PDF-Stift", properties: ['openFile', 'multiSelections'], filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (!r.canceled) r.filePaths.forEach(openFile);
}

// ---------------------------------------------------------------- PDF aus dem Explorer, „Senden an“ und Drucker: in den eingestellten Ordner (Standard „Dokumente“) laden und öffnen
// Nutzungsprotokoll (wie in der Web-App): nur Werkzeug, Dauer, Fehler – keine Dateinamen
function usage(k, n, ms, x) {
  if (LOCAL) return; // freie Ausgabe: kein Nutzungsprotokoll
  try {
    const e = { t: Math.floor(Date.now() / 1000), k, n };
    if (ms != null) e.ms = Math.round(ms);
    if (x) e.x = String(x).slice(0, 200);
    sfetch(BASE + 'api.php?a=usage', { method: 'POST', headers: { 'X-PDFStift': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ ev: [e], dev: 'Windows', v: app.getVersion() }) }).catch(() => {});
  } catch (e) { /* */ }
}
const folderFile = () => path.join(app.getPath('userData'), 'ordner.json');
function inFolder() { try { return String(JSON.parse(fs.readFileSync(folderFile(), 'utf8')).folder || DROP0); } catch (e) { return DROP0; } }
ipcMain.handle('set-folder', (_e, f) => { try { fs.writeFileSync(folderFile(), JSON.stringify({ folder: String(f || DROP0).slice(0, 200) })); } catch (e) { /* */ } });
// Helles/dunkles Design auch für Titelleiste und Menüs
ipcMain.handle('set-theme', (_e, t) => { nativeTheme.themeSource = t === 'light' || t === 'dark' ? t : 'system'; });
// Sprache der Oberfläche: Menüs und Fenster wechseln mit einem Neustart
ipcMain.handle('set-lang', (_e, l) => {
  if (l !== 'de' && l !== 'en') return;
  try { fs.writeFileSync(path.join(app.getPath('userData'), 'sprache.json'), JSON.stringify({ lang: l })); } catch (e) { /* */ }
  if (l !== LANG) setTimeout(() => { app.relaunch(); app.exit(0); }, 400);
});
// freie Ausgabe: Ordner der Bibliothek wählen (danach Neustart)
async function pickLibrary() {
  const r = await dialog.showOpenDialog(win, { title: "Choose a folder for the library", defaultPath: local.libraryDir(), properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return;
  local.setLibraryDir(r.filePaths[0]);
  await dialog.showMessageBox(win, { type: 'info', title: 'PDF-Stift', message: "PDF-Stift will now restart and show the PDFs from this folder.", detail: r.filePaths[0] });
  app.relaunch(); app.exit(0);
}
ipcMain.handle('lib-dir', () => (LOCAL ? local.libraryDir() : ''));
ipcMain.handle('lib-open', () => { if (LOCAL) shell.openPath(local.libraryDir()); });
ipcMain.handle('lib-pick', () => (LOCAL ? pickLibrary() : null));
async function openFile(file, opt = {}) {
  if (!ready) { if (!opt.print) waiting.push(file); return false; }
  let tmpDir = '';
  // PowerPoint: als bearbeitbare Präsentation oder als PDF zum Beschreiben?
  if (!opt.print && /\.(pptx|pptm|ppsx|potx)$/i.test(file)) {
    const can = await win.webContents.executeJavaScript('window.__pdfstiftPptx === true').catch(() => false);
    if (can) {
      const { response } = await dialog.showMessageBox(win, { type: 'question', title: 'PDF-Stift', message: `How would you like to open “${path.basename(file)}”?`, buttons: ["As an editable presentation", "As a PDF to write on", "Cancel"], defaultId: 0, cancelId: 2, noLink: true });
      if (response === 2) return false;
      if (response === 0) {
        if (win.isMinimized()) win.restore();
        win.show(); win.focus();
        win.webContents.send('pptx-open', { name: path.basename(file), bytes: new Uint8Array(fs.readFileSync(file)) });
        try { app.addRecentDocument(file); } catch (e) { /* */ }
        return true;
      }
    }
  }
  if (OFFICE.test(file)) {
    const t0 = Date.now(), ext = path.extname(file).slice(1).toLowerCase();
    try { const r = await officeToPdf(file); tmpDir = r.dir; file = r.out; usage('tool', 'Office → PDF (Windows)'); usage('perf', 'Office → PDF (Windows)', Date.now() - t0, ext); } catch (e) {
      usage('err', 'Office → PDF (Windows) fehlgeschlagen', null, ext + ': ' + String(e.message || e));
      dialog.showMessageBox(win, { type: 'warning', title: 'PDF-Stift', message: "Microsoft Office could not convert the file to PDF – now trying on the server.", detail: String(e.message || e) });
    }
  }
  try {
    if (!opt.print) try { app.addRecentDocument(file); } catch (e) { /* */ }
    // Formular von Hand zusammensetzen (unabhängig davon, was fetch an FormData versteht)
    const b = '----PDFStift' + Date.now().toString(16);
    const name = path.basename(file).replace(/"/g, '');
    const body = Buffer.concat([
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="folder"\r\n\r\n${inFolder()}\r\n`, 'utf8'),
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="files[]"; filename="${name}"\r\nContent-Type: application/pdf\r\n\r\n`, 'utf8'),
      fs.readFileSync(file),
      Buffer.from(`\r\n--${b}--\r\n`),
    ]);
    const r = await sfetch(BASE + 'api.php?a=upload', { method: 'POST', body, headers: { 'X-PDFStift': '1', 'Content-Type': 'multipart/form-data; boundary=' + b } });
    if (r.status === 401) {
      if (!opt.print || !opt.quiet) dialog.showMessageBox(win, { type: 'info', title: 'PDF-Stift', message: opt.print ? "Please sign in to PDF-Stift – the printout will then be imported automatically." : "Please sign in to PDF-Stift first, then open the file again." });
      return false;
    }
    const j = await r.json();
    const saved = j.saved && j.saved[0];
    if (!saved) { dialog.showMessageBox(win, { type: 'warning', title: 'PDF-Stift', message: "The file was not imported.", detail: (j.errors && j.errors[0]) || j.error || '' }); return !!opt.print; }
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
    win.loadURL(BASE + '?open=' + encodeURIComponent(saved));
    usage('tool', opt.print ? 'Drucker PDF-Stift' : 'Senden an / Öffnen mit');
    if (tmpDir) try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* */ }
    return true;
  } catch (e) {
    if (!opt.quiet) dialog.showMessageBox(win, { type: 'warning', title: 'PDF-Stift', message: opt.print ? "The printout can’t be imported without internet – this will happen automatically once you’re back online." : "The file can’t be imported without internet.", detail: String(e.message || e) });
    return false;
  }
}

// ---------------------------------------------------------------- Drucker „PDF-Stift“: in Word, Chrome … einfach auf „PDF-Stift“ drucken
// Windows' eigener Treiber „Microsoft Print to PDF“ schreibt in eine feste Datei; PDF-Stift holt sie dort ab, lädt sie hoch und öffnet sie.
const PRN = 'PDF-Stift';
const prnDir = () => path.join(app.getPath('home'), 'AppData', 'Local', 'PDF-Stift', 'Drucker');
const prnFile = () => path.join(prnDir(), 'druck.pdf');
const prnQueue = () => path.join(prnDir(), 'warteschlange');
const pad2 = (n) => String(n).padStart(2, '0');
// Name des Druckauftrags (z. B. „Vorlesung 3.docx“): der Drucker hebt erledigte Aufträge auf, wir lesen den letzten und räumen auf
async function jobName() {
  const r = await psRun(`$j = Get-PrintJob -PrinterName '${PRN}' -ErrorAction SilentlyContinue | Sort-Object SubmittedTime | Select-Object -Last 1
if ($j) { $j.DocumentName | Out-File -Encoding utf8 '__RES__' } else { '' | Out-File -Encoding utf8 '__RES__' }
Get-PrintJob -PrinterName '${PRN}' -ErrorAction SilentlyContinue | Remove-PrintJob -ErrorAction SilentlyContinue`, false);
  let n = (r || '').replace(/^\ufeff/, '').trim();
  if (!n || n === 'abgebrochen') return '';
  return cleanTitle(n);
}
// „Vorlesung 3.docx - Word“, „Microsoft Word - Brief.docx“, „Notizen.txt - Editor“ → „Vorlesung 3“, „Brief“, „Notizen“
function cleanTitle(n) {
  n = String(n || '').replace(/^Microsoft (Word|PowerPoint|Excel|Outlook) - /i, '');
  const m = /^(.*?\.[a-z0-9]{2,5}) - [^-]{2,40}$/i.exec(n);
  if (m) n = m[1];
  n = n.replace(/\.(docx?|docm|pptx?|pptm|xlsx?|xlsm|pdf|txt|rtf|odt|odp|ods|html?|png|jpe?g)$/i, '');
  return n.replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 90);
}
function printName(buf, job) {
  // Titel aus der PDF, sonst Datum und Uhrzeit
  const m = /\/Title\s*\(((?:[^()\\]|\\.){1,120})\)/.exec(buf.toString('latin1', 0, Math.min(buf.length, 200000)));
  const t = m && m[1].replace(/\\(.)/g, '$1').replace(/[\x00-\x1f]/g, '').trim();
  const d = new Date();
  const when = `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}.${pad2(d.getMinutes())}`;
  if (job) return `${job}.pdf`;
  const base = t && !/^(untitled|unbenannt)/i.test(t) && !/[^\x20-\x7e\xa0-\xff]/.test(t) ? cleanTitle(t) || "Printout" : "Printout";
  return `${base} (${when}).pdf`;
}
let prnBusy = false, prnLast = -1, prnWarned = false;
async function printPoll() {
  if (prnBusy || process.platform !== 'win32') return;
  prnBusy = true;
  try {
    const f = prnFile();
    if (fs.existsSync(f)) {
      const st = fs.statSync(f);
      // erst abholen, wenn der Drucker fertig geschrieben hat (Größe unverändert, Ende der PDF da)
      if (st.size > 0 && st.size === prnLast) {
        const buf = fs.readFileSync(f);
        if (buf.toString('latin1', Math.max(0, buf.length - 1024)).includes('%%EOF')) {
          fs.mkdirSync(prnQueue(), { recursive: true });
          // zuerst wegnehmen (klappt erst, wenn der Drucker die Datei losgelassen hat), dann benennen
          const tmp = path.join(prnDir(), `abholen-${Date.now()}.tmp`);
          let moved = false;
          try { fs.renameSync(f, tmp); moved = true; prnLast = -1; } catch (e) { /* noch gesperrt: nächster Durchgang */ }
          if (moved) {
            let dst = path.join(prnQueue(), printName(buf, await jobName().catch(() => '')));
            for (let k = 2; fs.existsSync(dst) && k < 100; k++) dst = dst.replace(/( \(\d+\))?\.pdf$/i, ` (${k}).pdf`);
            fs.renameSync(tmp, dst);
          }
        }
      } else prnLast = st.size;
    }
    if (ready && fs.existsSync(prnQueue())) {
      for (const n of fs.readdirSync(prnQueue()).filter((x) => /\.pdf$/i.test(x))) {
        const p = path.join(prnQueue(), n);
        const ok = await openFile(p, { print: true, quiet: prnWarned });
        if (ok) fs.rmSync(p, { force: true }); else { prnWarned = true; break; }
      }
    }
  } catch (e) { /* nächster Durchgang */ }
  prnBusy = false;
}
function printWatch() {
  if (process.platform !== 'win32') return;
  try { fs.mkdirSync(prnDir(), { recursive: true }); fs.watch(prnDir(), () => setTimeout(printPoll, 400)); } catch (e) { /* */ }
  setInterval(printPoll, 1500);
}
function psRun(script, admin) {
  return new Promise((resolve) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfstift-'));
    const ps1 = path.join(dir, 'drucker.ps1'), res = path.join(dir, 'ergebnis.txt');
    fs.writeFileSync(ps1, '\ufeff' + script.replace(/__RES__/g, res.replace(/'/g, "''")), 'utf8');
    const args = admin
      ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','"${ps1.replace(/'/g, "''")}"'`]
      : ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1];
    execFile('powershell.exe', args, { windowsHide: true, timeout: 300000 }, () => {
      let out = ''; try { out = fs.readFileSync(res, 'utf8').trim(); } catch (e) { out = 'abgebrochen'; }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ }
      resolve(out);
    });
  });
}
async function printerInstalled() {
  const r = await psRun(`try { if (Get-Printer -Name '${PRN}' -ErrorAction Stop) { 'ja' | Out-File -Encoding ascii '__RES__' } } catch { 'nein' | Out-File -Encoding ascii '__RES__' }`, false);
  return r === 'ja';
}
async function printerSetup() {
  const on = await printerInstalled();
  if (on) {
    const c = await dialog.showMessageBox(win, { type: 'question', title: "Printer “PDF-Stift”", message: "The “PDF-Stift” printer is set up.", detail: "In Word, Chrome, Outlook … just choose “Print” and select “PDF-Stift” as the printer – the PDF appears here in the Library (folder “" + inFolder() + "”) and is opened.", buttons: ['OK', "Remove printer …"], defaultId: 0, cancelId: 0 });
    if (c.response !== 1) return;
    const r = await psRun(`try { Remove-Printer -Name '${PRN}' -ErrorAction Stop; Remove-PrinterPort -Name '${prnFile().replace(/'/g, "''")}' -ErrorAction SilentlyContinue; 'ok' | Out-File -Encoding utf8 '__RES__' } catch { $_.Exception.Message | Out-File -Encoding utf8 '__RES__' }`, true);
    dialog.showMessageBox(win, { type: r === 'ok' ? 'info' : 'warning', title: 'PDF-Stift', message: r === 'ok' ? "The “PDF-Stift” printer has been removed." : "The printer could not be removed.", detail: r === 'ok' ? '' : r });
    return;
  }
  const c = await dialog.showMessageBox(win, { type: 'question', title: "Set up as printer", message: "Set up PDF-Stift as a printer?", detail: "You can then print from any program (Word, PowerPoint, Chrome, Outlook …) to the “PDF-Stift” printer. The PDF then appears here in the Library (folder “" + inFolder() + "”) and is opened.\n\nWindows will ask once for your permission (administrator) because a printer is being set up. PDF-Stift will also start with Windows from now on (minimized) so printouts arrive right away.", buttons: ["Set up", "Cancel"], defaultId: 0, cancelId: 1 });
  if (c.response !== 0) return;
  fs.mkdirSync(prnDir(), { recursive: true });
  const port = prnFile().replace(/'/g, "''");
  const r = await psRun(`$ErrorActionPreference = 'Stop'
try {
  if (-not (Get-PrinterDriver -Name 'Microsoft Print To PDF' -ErrorAction SilentlyContinue)) {
    Enable-WindowsOptionalFeature -Online -FeatureName 'Printing-PrintToPDFServices-Features' -All -NoRestart | Out-Null
  }
  if (-not (Get-PrinterPort -Name '${port}' -ErrorAction SilentlyContinue)) {
    try { Add-PrinterPort -Name '${port}' } catch { Restart-Service Spooler -Force; Start-Sleep -Seconds 2; Add-PrinterPort -Name '${port}' }
  }
  if (Get-Printer -Name '${PRN}' -ErrorAction SilentlyContinue) { Remove-Printer -Name '${PRN}' }
  try { Add-Printer -Name '${PRN}' -DriverName 'Microsoft Print To PDF' -PortName '${port}' }
  catch { Restart-Service Spooler -Force; Start-Sleep -Seconds 3; Add-Printer -Name '${PRN}' -DriverName 'Microsoft Print To PDF' -PortName '${port}' }
  try { Set-Printer -Name '${PRN}' -KeepPrintedJobs $true } catch { }
  'ok' | Out-File -Encoding utf8 '__RES__'
} catch { $_.Exception.Message | Out-File -Encoding utf8 '__RES__' }`, true);
  if (r.replace(/^\ufeff/, '') === 'ok') {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--minimiert'] });
    dialog.showMessageBox(win, { type: 'info', title: 'PDF-Stift', message: "Done – the “PDF-Stift” printer is set up.", detail: "Try it out: in Word or Chrome, “Print” → printer “PDF-Stift” → Print." });
  } else {
    dialog.showMessageBox(win, { type: 'warning', title: 'PDF-Stift', message: "The printer could not be set up.", detail: r === 'abgebrochen' ? "Windows permission was not granted." : r });
  }
}

/** Datei hochladen, ohne sie zu öffnen (für den überwachten Ordner): {saved} | {auth} | {error} */
async function uploadFile(file) {
  try {
    const b = '----PDFStift' + Date.now().toString(16);
    const name = path.basename(file).replace(/"/g, '');
    const body = Buffer.concat([
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="folder"\r\n\r\n${inFolder()}\r\n`, 'utf8'),
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="files[]"; filename="${name}"\r\nContent-Type: application/pdf\r\n\r\n`, 'utf8'),
      fs.readFileSync(file),
      Buffer.from(`\r\n--${b}--\r\n`),
    ]);
    const r = await sfetch(BASE + 'api.php?a=upload', { method: 'POST', body, headers: { 'X-PDFStift': '1', 'Content-Type': 'multipart/form-data; boundary=' + b } });
    if (r.status === 401) return { auth: true };
    const j = await r.json();
    return j.saved && j.saved[0] ? { saved: j.saved[0] } : { error: (j.errors && j.errors[0]) || j.error || "not imported" };
  } catch (e) { return { error: String(e.message || e) }; }
}

// ---------------------------------------------------------------- Office-Dateien → PDF, direkt hier mit dem installierten Microsoft Office
const OFFICE = /\.(docx?|docm|dotx?|rtf|odt|pptx?|pptm|ppsx?|potx?|odp|xlsx?|xlsm|xlsb|ods)$/i;
const PS = {
  word: `$w = New-Object -ComObject Word.Application; $w.Visible = $false; $w.DisplayAlerts = 0
try { $d = $w.Documents.Open($env:PS_SRC, $false, $true, $false); $d.ExportAsFixedFormat($env:PS_OUT, 17); $d.Close(0) }
finally { if ($w.Documents.Count -eq 0) { $w.Quit() } }`,
  ppt: `$p = New-Object -ComObject PowerPoint.Application
try { $x = $p.Presentations.Open($env:PS_SRC, -1, 0, 0); $x.SaveAs($env:PS_OUT, 32); $x.Close() }
finally { if ($p.Presentations.Count -eq 0) { $p.Quit() } }`,
  excel: `$e = New-Object -ComObject Excel.Application; $e.Visible = $false; $e.DisplayAlerts = $false
try { $b = $e.Workbooks.Open($env:PS_SRC, 0, $true); $b.ExportAsFixedFormat(0, $env:PS_OUT); $b.Close($false) }
finally { if ($e.Workbooks.Count -eq 0) { $e.Quit() } }`,
};
const kindOf = (f) => (/\.(pptx?|pptm|ppsx?|potx?|odp)$/i.test(f) ? 'ppt' : /\.(xlsx?|xlsm|xlsb|ods)$/i.test(f) ? 'excel' : 'word');
function officeToPdf(src) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfstift-'));
    const out = path.join(dir, path.basename(src).replace(/\.[^.]+$/, '') + '.pdf');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS[kindOf(src)]],
      { env: { ...process.env, PS_SRC: path.resolve(src), PS_OUT: out }, timeout: 180000, windowsHide: true },
      (err, _so, se) => {
        if (fs.existsSync(out) && fs.statSync(out).size > 100) return resolve({ out, dir });
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ }
        reject(new Error(String((se || (err && err.message) || "Conversion failed")).split('\n')[0].slice(0, 300)));
      });
  });
}
// Rechtsklick im Explorer → „Senden an“ → PDF-Stift (PDFs und Office-Dateien)
function sendTo() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  try {
    const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'SendTo', 'PDF-Stift.lnk');
    shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? 'update' : 'create', { target: process.execPath, description: "Open in PDF-Stift (Word, Excel, PowerPoint become PDF)", icon: process.execPath, iconIndex: 0 });
  } catch (e) { /* nicht schlimm */ }
}
// freie Nummer, falls neben dem Original schon eine PDF gleichen Namens liegt
function freeName(p) {
  if (!fs.existsSync(p)) return p;
  for (let k = 2; k < 100; k++) { const q = p.replace(/\.pdf$/i, ` (${k}).pdf`); if (!fs.existsSync(q)) return q; }
  return p;
}
ipcMain.handle('office-pdf', async (_e, src, opt = {}) => {
  try {
    if (!src || !OFFICE.test(src) || !fs.existsSync(src)) return { ok: false, error: "Not an Office file." };
    const { out, dir } = await officeToPdf(src);
    const data = fs.readFileSync(out);
    let copy = '';
    if (opt.nextTo) { try { copy = freeName(src.replace(/\.[^.\\/]+$/, '') + '.pdf'); fs.copyFileSync(out, copy); } catch (e) { copy = ''; } }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ }
    return { ok: true, name: path.basename(out), data, copy };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

// ---------------------------------------------------------------- Texterkennung mit der in Windows eingebauten Erkennung (viel schneller als im Browser)
const OCR = { proc: null, info: null, buf: '', wait: [], n: 0 };
function ocrStart() {
  if (OCR.info) return OCR.info;
  OCR.info = new Promise((resolve) => {
    try {
      const ps1 = path.join(app.getPath('userData'), 'ocr.ps1');
      fs.writeFileSync(ps1, '\ufeff' + fs.readFileSync(path.join(__dirname, 'ocr.ps1'), 'utf8').replace(/^\ufeff/, ''));
      const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1], { windowsHide: true });
      OCR.proc = p;
      let first = true;
      p.stdout.setEncoding('utf8');
      p.stdout.on('data', (d) => {
        OCR.buf += d;
        let i;
        while ((i = OCR.buf.indexOf('\n')) >= 0) {
          const line = OCR.buf.slice(0, i).replace(/^\ufeff/, '').trim();
          OCR.buf = OCR.buf.slice(i + 1);
          if (!line) continue;
          let j = null;
          try { j = JSON.parse(line); } catch (e) { j = { error: line.slice(0, 200) }; }
          if (first) { first = false; resolve(j.ready ? { ok: true, lang: j.lang, langs: j.langs } : { ok: false, error: j.error || "Start failed" }); continue; }
          const w = OCR.wait.shift();
          if (w) { clearTimeout(w.t); w.done(j); }
        }
      });
      p.on('exit', () => {
        if (first) resolve({ ok: false, error: "Windows text recognition could not be started" });
        OCR.wait.splice(0).forEach((w) => { clearTimeout(w.t); w.done({ error: "Text recognition stopped" }); });
        OCR.proc = null; OCR.info = null;
      });
      p.on('error', () => { if (first) { first = false; resolve({ ok: false, error: "PowerShell not found" }); } });
    } catch (e) { resolve({ ok: false, error: String(e.message || e) }); }
  });
  return OCR.info;
}
ipcMain.handle('ocr-info', () => (process.platform === 'win32' ? ocrStart() : { ok: false, error: "Windows only" }));
ipcMain.handle('ocr-img', async (_e, data) => {
  const info = await ocrStart();
  if (!info.ok || !OCR.proc) return { error: info.error || "not ready" };
  const f = path.join(os.tmpdir(), `pdfstift-ocr-${process.pid}-${++OCR.n}.jpg`);
  fs.writeFileSync(f, Buffer.from(data));
  const r = await new Promise((done) => {
    const t = setTimeout(() => { const k = OCR.wait.findIndex((x) => x.t === t); if (k >= 0) OCR.wait.splice(k, 1); done({ error: "Timed out" }); try { OCR.proc && OCR.proc.kill(); } catch (e) { /* */ } }, 90000);
    OCR.wait.push({ done, t });
    OCR.proc.stdin.write(f + '\n', 'utf8');
  });
  try { fs.unlinkSync(f); } catch (e) { /* */ }
  return r;
});
app.on('will-quit', () => { try { if (OCR.proc) { OCR.proc.stdin.write('\n'); OCR.proc.kill(); } } catch (e) { /* */ } });

// ---------------------------------------------------------------- Herausziehen: PDF (mit Notizen) aus PDF-Stift in den Explorer, auf den Desktop oder in Outlook ziehen
const dragDir = () => path.join(os.tmpdir(), 'PDF-Stift-Ziehen');
const safeName = (n) => String(n || 'PDF').replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'PDF';
ipcMain.handle('drag-prep', (_e, name, bytes) => {
  const d = dragDir();
  fs.mkdirSync(d, { recursive: true });
  // alte Zieh-Dateien aufräumen (älter als 1 Tag)
  try { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (Date.now() - fs.statSync(p).mtimeMs > 86400000) fs.rmSync(p, { force: true, recursive: true }); } } catch (e) { /* */ }
  const sub = path.join(d, String(Date.now()));
  fs.mkdirSync(sub);
  const f = path.join(sub, safeName(name).replace(/\.pdf$/i, '') + '.pdf');
  fs.writeFileSync(f, Buffer.from(bytes));
  return f;
});
let dragIcon = null;
ipcMain.on('drag-start', (e, file) => {
  if (!file || !fs.existsSync(file) || !file.startsWith(dragDir())) return;
  if (!dragIcon) dragIcon = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 48, height: 48 });
  try { e.sender.startDrag({ file, icon: dragIcon }); } catch (er) { /* */ }
});

// ---------------------------------------------------------------- „Speichern unter …“ mit dem Windows-Dialog
let lastSaveDir = '';
ipcMain.handle('save-as', async (_e, name, bytes) => {
  const ext = (path.extname(name || '').slice(1) || 'pdf').toLowerCase();
  const names = { pdf: "PDF document", docx: "Word document", xlsx: "Excel workbook", pptx: "PowerPoint presentation", zip: "ZIP archive", png: "PNG image", jpg: "JPEG image", txt: 'Text', json: "Data (JSON)" };
  const r = await dialog.showSaveDialog(win, {
    title: "Save as",
    defaultPath: path.join(lastSaveDir || app.getPath('documents'), safeName(name)),
    filters: [{ name: names[ext] || ext.toUpperCase(), extensions: [ext] }, { name: "All files", extensions: ['*'] }],
  });
  if (r.canceled || !r.filePath) return { canceled: true };
  try {
    fs.writeFileSync(r.filePath, Buffer.from(bytes));
    lastSaveDir = path.dirname(r.filePath);
    return { ok: true, path: r.filePath };
  } catch (er) { return { error: String(er.message || er) }; }
});
ipcMain.handle('show-file', (_e, p) => { if (p && fs.existsSync(p)) shell.showItemInFolder(p); });

// ---------------------------------------------------------------- Rechtsklick im Explorer: „In PDF-Stift öffnen“ (nur für diesen Benutzer, ohne Administrator)
const MENU_EXT = ['.pdf', '.doc', '.docx', '.rtf', '.odt', '.ppt', '.pptx', '.pps', '.ppsx', '.odp', '.xls', '.xlsx', '.ods'];
function regMenu() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const mark = path.join(app.getPath('userData'), 'kontextmenue.json');
  try { const m = JSON.parse(fs.readFileSync(mark, 'utf8')); if (m.exe === process.execPath && m.n === MENU_EXT.length) return; } catch (e) { /* neu einrichten */ }
  const exe = process.execPath.replace(/'/g, "''");
  psRun(`$ErrorActionPreference = 'Stop'
try {
  foreach ($e in @(${MENU_EXT.map((x) => `'${x}'`).join(', ')})) {
    $k = "HKCU:\\Software\\Classes\\SystemFileAssociations\\$e\\shell\\PDFStift"
    New-Item -Path "$k\\command" -Force | Out-Null
    Set-ItemProperty -LiteralPath $k -Name '(default)' -Value 'Open in PDF-Stift'
    Set-ItemProperty -LiteralPath $k -Name 'Icon' -Value '"${exe}",0'
    Set-ItemProperty -LiteralPath "$k\\command" -Name '(default)' -Value '"${exe}" "%1"'
  }
  'ok' | Out-File -Encoding ascii '__RES__'
} catch { $_.Exception.Message | Out-File -Encoding utf8 '__RES__' }`, false).then((r) => {
    if (r === 'ok') try { fs.writeFileSync(mark, JSON.stringify({ exe: process.execPath, n: MENU_EXT.length })); } catch (e) { /* */ }
  });
}

// ---------------------------------------------------------------- Überwachter Ordner: was dort hineinkommt, landet automatisch in der Bibliothek
const hotFile = () => path.join(app.getPath('userData'), 'ordner-ueberwachen.json');
function hotCfg() { try { return { on: false, dir: path.join(app.getPath('documents'), 'PDF-Stift'), ...JSON.parse(fs.readFileSync(hotFile(), 'utf8')) }; } catch (e) { return { on: false, dir: path.join(app.getPath('documents'), 'PDF-Stift') }; } }
const HOT = { t: null, seen: new Map(), busy: false, failed: new Map() };
function notice(text, refresh) { if (win && !win.isDestroyed()) win.webContents.send('notice', { text, refresh: !!refresh }); }
function moveTo(file, sub) {
  const d = path.join(path.dirname(file), sub);
  fs.mkdirSync(d, { recursive: true });
  let dst = path.join(d, path.basename(file));
  for (let k = 2; fs.existsSync(dst) && k < 1000; k++) dst = path.join(d, path.basename(file).replace(/(\.[^.]+)$/, ` (${k})$1`));
  fs.renameSync(file, dst);
}
async function hotPoll() {
  const c = hotCfg();
  if (!c.on || HOT.busy || !ready) return;
  HOT.busy = true;
  try {
    fs.mkdirSync(c.dir, { recursive: true });
    const list = fs.readdirSync(c.dir).filter((n) => !n.startsWith('~$') && !n.startsWith('.') && (/\.pdf$/i.test(n) || OFFICE.test(n)));
    for (const n of list) {
      const f = path.join(c.dir, n);
      let st;
      try { st = fs.statSync(f); } catch (e) { continue; }
      if (!st.isFile()) continue;
      // erst übernehmen, wenn die Datei fertig geschrieben ist (Größe zweimal gleich)
      const key = st.size + '|' + st.mtimeMs;
      if (HOT.seen.get(f) !== key) { HOT.seen.set(f, key); continue; }
      if ((HOT.failed.get(f) || 0) > Date.now()) continue;
      let up = f, tmpDir = '';
      if (OFFICE.test(n)) {
        try { const r = await officeToPdf(f); up = r.out; tmpDir = r.dir; } catch (e) {
          moveTo(f, 'Fehler'); notice(`“${n}” could not be converted to PDF – it is now in the subfolder “Fehler”.`); continue;
        }
      }
      const r = await uploadFile(up);
      if (tmpDir) try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* */ }
      if (r.saved) {
        moveTo(f, 'übernommen');
        HOT.seen.delete(f);
        usage('tool', 'Überwachter Ordner');
        notice(`“${n.replace(/\.[^.]+$/, '')}” from the watched folder is now in “${inFolder()}”.`, true);
      } else {
        HOT.failed.set(f, Date.now() + 60000); // in einer Minute noch einmal
        if (r.auth) break;
      }
    }
  } catch (e) { /* nächster Durchgang */ }
  HOT.busy = false;
}
function hotStart() {
  if (process.platform !== 'win32') return;
  clearInterval(HOT.t);
  HOT.t = setInterval(hotPoll, 3000);
}
ipcMain.handle('hot-get', () => hotCfg());
ipcMain.handle('hot-set', (_e, v) => { const c = { ...hotCfg(), ...v }; try { fs.writeFileSync(hotFile(), JSON.stringify(c)); if (c.on) fs.mkdirSync(c.dir, { recursive: true }); } catch (e) { /* */ } return hotCfg(); });
ipcMain.handle('hot-pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: "Choose folder to watch", defaultPath: hotCfg().dir, properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('hot-open', () => { const d = hotCfg().dir; fs.mkdirSync(d, { recursive: true }); shell.openPath(d); });

// ---------------------------------------------------------------- Sprungliste: zuletzt geöffnete PDFs beim Rechtsklick auf das Taskleisten-Symbol
ipcMain.on('recent', (_e, list) => {
  if (process.platform !== 'win32' || !Array.isArray(list)) return;
  try {
    app.setJumpList([{
      type: 'custom', name: "Recently opened",
      items: list.slice(0, 10).map((x) => ({ type: 'task', title: String(x.title || '').slice(0, 100), description: String(x.path || '').slice(0, 250), program: process.execPath, args: `--pdfstift-open="${String(x.path || '').replace(/"/g, '')}"`, iconPath: process.execPath, iconIndex: 0 })),
    }, { type: 'recent' }]);
  } catch (e) { /* */ }
});

// ---------------------------------------------------------------- Updates (von pdf-stift.example.org/android/win)
// Anzeige oben rechts in PDF-Stift: „Update verfügbar“ → Installieren / Überspringen / Nicht jetzt
let upd = null;
let pending = null;      // zuletzt gemeldeter Stand für das Fenster
let manual = false;
let later = false;
const skipFile = () => path.join(app.getPath('userData'), 'update.json');
const readSkip = () => { try { return JSON.parse(fs.readFileSync(skipFile(), 'utf8')).skip || ''; } catch (e) { return ''; } };
const send = (d) => { pending = d; if (win && !win.isDestroyed()) win.webContents.send('upd', d); };
function notesOf(info) {
  const n = info && info.releaseNotes;
  if (!n) return '';
  if (Array.isArray(n)) return n.map((x) => x.note || '').join('\n');
  return String(n).replace(/<[^>]+>/g, '');
}
function updater() {
  if (upd) return upd;
  upd = require('electron-updater').autoUpdater;
  upd.autoDownload = false;
  upd.autoInstallOnAppQuit = false;
  upd.on('update-available', (info) => {
    const show = manual || (!later && readSkip() !== info.version);
    manual = false;
    if (show) send({ state: 'available', version: info.version, notes: notesOf(info), current: app.getVersion() });
  });
  upd.on('update-not-available', () => { if (manual) send({ state: 'none', current: app.getVersion() }); manual = false; });
  upd.on('download-progress', (p) => send({ state: 'progress', percent: Math.round(p.percent || 0) }));
  upd.on('update-downloaded', () => { send({ state: 'ready' }); setTimeout(() => upd.quitAndInstall(true, true), 1200); });
  upd.on('error', (e) => { if (manual || (pending && pending.state === 'progress')) send({ state: 'error', message: String((e && e.message) || e) }); manual = false; });
  return upd;
}
// automatische Suche lässt sich unter Datei → Einstellungen abschalten
const autoFile = () => path.join(app.getPath('userData'), 'autoupdate.json');
function autoOn() { try { return JSON.parse(fs.readFileSync(autoFile(), 'utf8')).on !== false; } catch (e) { return true; } }
function updates(byUser) {
  if (process.env.SNAP) { if (byUser) send({ state: 'none', current: app.getVersion() }); return; } // Snap Store aktualisiert selbst
  if (!byUser && !autoOn()) return;
  try {
    if (byUser) { manual = true; later = false; }
    const p = updater().checkForUpdates();
    if (p && p.catch) p.catch((e) => { if (byUser) send({ state: 'error', message: String(e.message || e) }); });
  } catch (e) { /* ohne Updater weiter */ }
}
// Windows-Grafiken (EMF, WMF, TIFF) aus PowerPoint-Dateien in PNG umwandeln (der Browser kann sie nicht anzeigen)
ipcMain.handle('img-conv', async (_e, bytes, ext) => {
  if (process.platform !== 'win32') return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfstift-img-'));
  const inp = path.join(dir, 'bild.' + String(ext || 'emf').replace(/[^a-z]/gi, '').slice(0, 5)), out = path.join(dir, 'bild.png');
  try {
    fs.writeFileSync(inp, Buffer.from(bytes));
    const q = (p) => "'" + p.replace(/'/g, "''") + "'";
    const ps = `Add-Type -AssemblyName System.Drawing; $i=[System.Drawing.Image]::FromFile(${q(inp)}); $s=[Math]::Min(4,[Math]::Max(1,2000/[Math]::Max($i.Width,$i.Height))); $w=[int]($i.Width*$s); $h=[int]($i.Height*$s); $b=New-Object System.Drawing.Bitmap $w,$h; $g=[System.Drawing.Graphics]::FromImage($b); $g.SmoothingMode='HighQuality'; $g.InterpolationMode='HighQualityBicubic'; $g.Clear([System.Drawing.Color]::Transparent); $g.DrawImage($i,0,0,$w,$h); $b.Save(${q(out)},[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $b.Dispose(); $i.Dispose()`;
    await new Promise((res) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true, timeout: 60000 }, () => res()));
    return fs.existsSync(out) ? new Uint8Array(fs.readFileSync(out)) : null;
  } catch (e) { return null; } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* */ } }
});
ipcMain.handle('version', () => app.getVersion());
// Menüband als Hauptmenü: die Menüleiste ausblenden (Alt zeigt sie weiterhin) und einzelne Menüs unter einem Reiter aufklappen
ipcMain.handle('menu-bar', (_e, on) => { if (!win || win.isDestroyed()) return; win.setAutoHideMenuBar(!on); win.setMenuBarVisibility(!!on); });
ipcMain.handle('menu-pop', (_e, id, x, y) => {
  const m = Menu.getApplicationMenu(); const it = m && m.getMenuItemById(String(id || ''));
  if (!it || !it.submenu || !win) return;
  const z = win.webContents.getZoomFactor() || 1;
  it.submenu.popup({ window: win, x: Math.round((+x || 0) * z), y: Math.round((+y || 0) * z) });
});
ipcMain.handle('upd-state', () => (pending && (pending.state === 'available' || pending.state === 'progress') ? pending : null));
ipcMain.handle('upd-install', () => { send({ state: 'progress', percent: 0 }); return updater().downloadUpdate().catch((e) => send({ state: 'error', message: String(e.message || e) })); });
ipcMain.handle('upd-skip', (_e, v) => { try { fs.writeFileSync(skipFile(), JSON.stringify({ skip: String(v || '') })); } catch (e) { /* */ } pending = null; });
ipcMain.handle('upd-later', () => { later = true; pending = null; });
ipcMain.handle('upd-check', () => updates(true));
ipcMain.handle('upd-auto', (_e, on) => { try { fs.writeFileSync(autoFile(), JSON.stringify({ on: !!on })); } catch (e) { /* */ } });
