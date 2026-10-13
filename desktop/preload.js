// Verbindung zwischen Programmfenster und PDF-Stift (nur das Nötigste für Updates)
const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('pdfstiftWin', {
  version: () => ipcRenderer.invoke('version'),
  menuBar: (on) => ipcRenderer.invoke('menu-bar', !!on),
  menuPop: (id, x, y) => ipcRenderer.invoke('menu-pop', id, x, y),
  imgConv: (bytes, ext) => ipcRenderer.invoke('img-conv', bytes, ext),
  onPptxOpen: (cb) => ipcRenderer.on('pptx-open', (_e, d) => cb(d)),
  state: () => ipcRenderer.invoke('upd-state'),
  onUpdate: (cb) => ipcRenderer.on('upd', (_e, d) => cb(d)),
  install: () => ipcRenderer.invoke('upd-install'),
  skip: (v) => ipcRenderer.invoke('upd-skip', v),
  later: () => ipcRenderer.invoke('upd-later'),
  check: () => ipcRenderer.invoke('upd-check'),
  setAutoUpdate: (on) => ipcRenderer.invoke('upd-auto', on),
  // Office-Datei aus dem Explorer → PDF (mit dem installierten Microsoft Office)
  pathFor: (f) => { try { return webUtils.getPathForFile(f); } catch (e) { return ''; } },
  officeToPdf: (p, opt) => ipcRenderer.invoke('office-pdf', p, opt || {}),
  setFolder: (f) => ipcRenderer.invoke('set-folder', f),
  // Herausziehen, Speichern unter, überwachter Ordner, Sprungliste
  dragPrep: (name, bytes) => ipcRenderer.invoke('drag-prep', name, bytes),
  startDrag: (file) => ipcRenderer.send('drag-start', file),
  saveAs: (name, bytes) => ipcRenderer.invoke('save-as', name, bytes),
  showFile: (p) => ipcRenderer.invoke('show-file', p),
  hotGet: () => ipcRenderer.invoke('hot-get'),
  hotSet: (v) => ipcRenderer.invoke('hot-set', v),
  hotPick: () => ipcRenderer.invoke('hot-pick'),
  hotOpen: () => ipcRenderer.invoke('hot-open'),
  onNotice: (cb) => ipcRenderer.on('notice', (_e, d) => cb(d)),
  recent: (list) => ipcRenderer.send('recent', list),
  // Texterkennung mit Windows' eigener Erkennung
  ocrInfo: () => ipcRenderer.invoke('ocr-info'),
  ocrImage: (bytes) => ipcRenderer.invoke('ocr-img', bytes),
  onCommand: (cb) => ipcRenderer.on('cmd', (_e, c) => cb(c)),
  // Sprache und (freie Ausgabe) Ordner der Bibliothek
  setLang: (l) => ipcRenderer.invoke('set-lang', l),
  setTheme: (t) => ipcRenderer.invoke('set-theme', t),
  libDir: () => ipcRenderer.invoke('lib-dir'),
  libOpen: () => ipcRenderer.invoke('lib-open'),
  libPick: () => ipcRenderer.invoke('lib-pick'),
});
