/* PDF-Stift – PDFs mit dem Stift beschriften, automatisch speichern, offline weiterarbeiten. */
'use strict';
(() => {
  const VERSION = '1.77.0';
  const API = 'api.php';
  const LOC = document.documentElement.lang === 'en' ? 'en-GB' : 'de-DE'; // Datums- und Zahlenformat der Sprache
  const DEC = LOC === 'de-DE' ? ',' : '.';
  const LANG = LOC === 'en-GB' ? 'en' : 'de';
  const LOCAL = document.body.dataset.ed === 'local';
  // rechte Hälfte der geteilten Ansicht: eigene, schlanke Instanz ohne Tabs und ohne Hintergrundaufgaben
  const EMBED = /[?&]pane=1\b/.test(location.search) && window.parent !== window;
  if (EMBED) document.body.classList.add('embed');
  const SPLIT = { frame: null, path: null, act: 'l', undo: null }; // geteilte Ansicht (rechte Hälfte)
  // Präsentationsfenster (Beamer / Teams): zeigt nur die Folie, gesteuert vom Hauptfenster
  const SHOW = /[?&]show=1\b/.test(location.search);
  if (SHOW) document.body.classList.add('show-win', 'present');
  const DROP0 = LANG === 'en' ? 'Documents' : 'Dokumente'; // Standardordner für hineingezogene Dateien // freie Ausgabe: alles auf dem eigenen PC, ohne Server-Dienste
  // Meldungen vom Server in der eingestellten Sprache (Wörterbuch kommt mit der englischen Fassung)
  // Der „Server“ läuft in der freien Ausgabe auf dem eigenen PC – er ist also immer erreichbar, auch ohne Internet
  if (LOCAL) { try { Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true }); } catch (e) { /* */ } }
  const L10N = window.PDFSTIFT_L10N || null;
  const tr = (m) => (L10N && typeof m === 'string' && L10N[m]) || m;
  function setLang(l) {
    try { document.cookie = 'pdfstift_lang=' + l + '; path=/; max-age=' + 5 * 365 * 86400 + '; samesite=lax'; } catch (e) { /* */ }
    if (window.pdfstiftWin && window.pdfstiftWin.setLang) window.pdfstiftWin.setLang(l);
    // die gespeicherte Seite (Service Worker) hat noch die alte Sprache – erst wegwerfen, dann neu laden
    const clear = 'caches' in window ? caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('pdfstift-')).map((k) => caches.open(k).then((c) => c.delete('./'))))).catch(() => {}) : Promise.resolve();
    clear.then(() => setTimeout(() => location.reload(), 150));
  }
  const PROMPTER = false; // das frühere Teleprompter-Fenster gibt es nicht mehr
  const BC = 'BroadcastChannel' in window ? new BroadcastChannel('pdfstift') : null;
  const isMirror = () => document.body.classList.contains('mirror');
  const $ = (s, el = document) => el.querySelector(s);
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js?v=' + VERSION;

  // ---- Nutzungsprotokoll (nur auf dem eigenen Server): Werkzeuge, Fehler, Dauer – ohne Inhalte und ohne Dateinamen
  const UG = { q: [], on: true, t: 0, dev: window.pdfstiftWin ? 'Windows' : /Android/i.test(navigator.userAgent) ? 'Android-Browser' : /iPad|iPhone|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document ? 'iPad' : 'Browser' };
  try { UG.q = JSON.parse(localStorage.getItem('pdfstift.ugq') || '[]').slice(-300); } catch (e) { UG.q = []; }
  const anon = (t) => String(t || '').replace(/„[^“]*“/g, '„…“').replace(/"[^"]*"/g, '"…"').replace(/[^\s\/]+\.(pdf|docx?|pptx?|xlsx?)\b/gi, '[Datei]').slice(0, 200);
  function track(k, n, ms, x) {
    if (!UG.on) return;
    const e = { t: Math.floor(Date.now() / 1000), k, n: anon(n) };
    if (ms !== undefined && ms !== null) e.ms = Math.round(ms);
    if (x) e.x = anon(x);
    UG.q.push(e);
    if (UG.q.length > 400) UG.q.splice(0, UG.q.length - 400);
    clearTimeout(UG.t);
    UG.t = setTimeout(usageFlush, 15000);
  }
  async function usageFlush() {
    if (!UG.q.length || navigator.onLine === false) return;
    const ev = UG.q.splice(0, 300);
    try {
      const r = await fetch(API + '?a=usage', { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'X-PDFStift': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ ev, dev: UG.dev, v: VERSION }) });
      if (!r.ok && r.status !== 401) throw new Error(r.status);
    } catch (e) { UG.q.unshift(...ev); }
  }
  // beim Verlassen: senden (keepalive) und nur den Rest für später merken
  window.addEventListener('pagehide', () => { usageFlush(); try { localStorage.setItem('pdfstift.ugq', JSON.stringify(UG.q)); } catch (e) { /* */ } });
  try { localStorage.removeItem('pdfstift.ugq'); } catch (e) { /* */ }
  document.addEventListener('visibilitychange', () => { if (document.hidden) usageFlush(); });
  window.addEventListener('error', (e) => track('err', 'Programmfehler: ' + (e.message || '?'), null, (e.filename || '').split('/').pop() + ':' + e.lineno));
  window.addEventListener('unhandledrejection', (e) => { const r = e.reason; track('err', 'Programmfehler: ' + ((r && r.message) || String(r)).slice(0, 150), null, r && r.stack ? String(r.stack).split('\n')[1] : ''); });

  const PALETTE = [
    ['#1A1A1A', 'Schwarz'], ['#1F4FD6', 'Blau'], ['#D6262B', 'Rot'], ['#13804A', 'Grün'], ['#FF4A1C', 'Orange-Rot'],
    ['#FFE14D', 'Gelb'], ['#7BE36B', 'Hellgrün'], ['#FF7AC0', 'Pink'], ['#7CC7FF', 'Hellblau'], ['#A855F7', 'Lila'],
  ];
  const PEN_W = [0.9, 1.6, 2.8];
  const HL_W = [8, 13, 20];
  const DEFAULT_FAVS = [
    { t: 'tx', k: 'hl', c: '#FF4A1C' }, { t: 'tx', k: 'hl', c: '#FFE14D' }, { t: 'tx', k: 'hl', c: '#7CC7FF' },
    { t: 'tx', k: 'ul', c: '#D6262B' }, { t: 'pen', c: '#1A1A1A', wi: 1 }, { t: 'pen', c: '#1F4FD6', wi: 1 },
    { t: 'pen', c: '#D6262B', wi: 1 }, { t: 'hl', c: '#FFE14D', wi: 1 }, { t: 'hl', c: '#7BE36B', wi: 1 }, { t: 'er' },
  ];
  const ZOOM_MIN = 0.5, ZOOM_LIMIT = 50; // bis 5000 %
  // Browser vertragen Seiten bis ca. 33 Mio. Pixel Höhe – bei sehr langen PDFs wird der Höchstzoom daher begrenzt
  const maxZoom = () => {
    const h1 = V.pages.reduce((a, P) => a + P.cssH, 0) / (V.zoom || 1);
    return Math.max(1, Math.min(ZOOM_LIMIT, 3e7 / Math.max(h1, 1)));
  };

  // ------------------------------------------------------------------ Helfer
  function uid() {
    const a = new Uint8Array(14);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => '0123456789abcdefghijklmnopqrstuvwxyz'[b % 36]).join('');
  }
  const LOWLAT = /Android/i.test(navigator.userAgent) && (() => { try { return localStorage.getItem('pdfstift.noLowLat') !== 'true'; } catch (e) { return true; } })();
  function ls(key, val) {
    try {
      if (val === undefined) return JSON.parse(localStorage.getItem('pdfstift.' + key));
      localStorage.setItem('pdfstift.' + key, JSON.stringify(val));
      if (UI_KEYS.has(key)) uiChanged(key, val);
    } catch (e) { return null; }
    return null;
  }
  // Einstellungen der Oberfläche, die auf allen Geräten gleich sein sollen (über den Server abgeglichen)
  const UI_KEYS = new Set(['favs', 'color', 'wi', 'txKind', 'shKind', 'ttSize', 'ttStyle', 'ttBg', 'ttBo', 'stampColor', 'stampName', 'meanings', 'tpPins', 'tpRecent',
    'dockLay', 'vbPos', 'vbHide', 'tpW', 'tpSide', 'toolPanel', 'thSide', 'thW', 'thumbs', 'showTools', 'theme', 'libView', 'snippets']);
  const UIS = { timer: 0, dirty: new Set(), last: {}, pulling: false };
  const uiTimes = () => { try { return JSON.parse(localStorage.getItem('pdfstift.uiT')) || {}; } catch (e) { return {}; } };
  function uiChanged(key, val) {
    if (UIS.pulling || document.body.dataset.demo) return; // Demo: jeder Besucher behält seine eigenen Einstellungen
    const j = JSON.stringify(val);
    if (UIS.last[key] === j) return;
    UIS.last[key] = j;
    const t = uiTimes(); t[key] = Date.now();
    try { localStorage.setItem('pdfstift.uiT', JSON.stringify(t)); } catch (e) { /* */ }
    UIS.dirty.add(key);
    clearTimeout(UIS.timer);
    UIS.timer = setTimeout(uiPush, 1500);
  }
  async function uiPush(keys) {
    if (document.body.dataset.ed === 'local') return;
    const ks = keys || [...UIS.dirty];
    UIS.dirty.clear();
    if (!ks.length) return;
    const t = uiTimes(), ui = {}, uiT = {};
    for (const k of ks) { try { ui[k] = JSON.parse(localStorage.getItem('pdfstift.' + k)); } catch (e) { ui[k] = null; } uiT[k] = t[k] || Date.now(); }
    try { await apiJson('prefs', { method: 'POST', body: { ui, uiT } }); } catch (e) { ks.forEach((k) => UIS.dirty.add(k)); }
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // Rechteck (PDF-Koordinaten) → Anzeige; pdf.js 6 hat convertToViewportRectangle nicht mehr
  const vpRect = (vp, r) => { const a = vp.convertToViewportPoint(r[0], r[1]), b = vp.convertToViewportPoint(r[2], r[3]); return [a[0], a[1], b[0], b[1]]; };
  const basename = (p) => p.split('/').pop();
  // Formularfelder und Anmerkungen der PDF mitzeichnen (sonst blieben ausgefüllte Felder leer)
  const AM = pdfjsLib.AnnotationMode ? pdfjsLib.AnnotationMode.ENABLE : 1;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function fmtSize(n) {
    if (n > 1048576) return (n / 1048576).toFixed(1).replace('.', DEC) + ' MB';
    return Math.max(1, Math.round(n / 1024)) + ' KB';
  }
  function fmtDate(ts) {
    const d = new Date(ts * 1000), now = new Date();
    const hm = d.toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return 'heute ' + hm;
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'gestern ' + hm;
    return d.toLocaleDateString(LOC);
  }
  let toastT;
  function toast(msg, ms = 3200) {
    if (/fehlgeschlagen|nicht möglich|nicht geklappt|konnte nicht|ließ sich nicht|Fehler|nicht gespeichert|nicht erstellt|Keine Verbindung/i.test(msg)) track('err', msg);
    const t = $('#toast');
    t.textContent = tr(msg);
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.hidden = true; }, ms);
  }
  function downloadBlob(blob, name) {
    // Windows-App: „Speichern unter“ mit dem normalen Windows-Fenster (Ordner und Name selbst wählen)
    if (window.pdfstiftWin && window.pdfstiftWin.saveAs) {
      blob.arrayBuffer().then((b) => window.pdfstiftWin.saveAs(name, new Uint8Array(b))).then((r) => {
        if (r && r.ok) { setTimeout(() => toast(`Gespeichert: ${r.path}`, 5000), 50); track('tool', 'Speichern unter (Windows)'); }
        else if (r && r.error) toast('Speichern nicht möglich: ' + r.error, 7000);
      });
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  function confirmDlg(title, text, yes = 'Löschen') {
    return new Promise((res) => {
      const d = $('#confirmDlg');
      $('#confirmTitle').textContent = title;
      $('#confirmText').textContent = text;
      $('#confirmYes').textContent = yes;
      d.returnValue = '';
      d.addEventListener('close', () => res(d.returnValue === 'yes'), { once: true });
      d.showModal();
    });
  }

  // ------------------------------------------------------------------ Server
  async function api(a, { method = 'GET', params = {}, body } = {}) {
    let url = API + '?a=' + a;
    for (const [k, v] of Object.entries(params)) url += '&' + k + '=' + encodeURIComponent(v);
    const opt = { method, credentials: 'same-origin', headers: {}, cache: 'no-store' };
    if (method === 'POST') {
      opt.headers['X-PDFStift'] = '1';
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body || {});
    }
    let r;
    try { r = await fetch(url, opt); } catch (e) {
      const err = new Error('Keine Verbindung'); err.offline = true; throw err;
    }
    if (r.status === 401 && a !== 'login') {
      showAuth(false);
      const err = new Error('Bitte anmelden'); err.auth = true; throw err;
    }
    if (!r.ok) {
      let m = 'Fehler ' + r.status;
      try { m = tr((await r.json()).error) || m; } catch (e) { /* kein JSON */ }
      const err = new Error(m); err.status = r.status; throw err;
    }
    return r;
  }
  const apiJson = async (a, o) => (await api(a, o)).json();

  // ------------------------------------------------------------------ IndexedDB (Offline-Ablage)
  const DB = {
    p: null,
    open() {
      if (!this.p) {
        this.p = new Promise((res, rej) => {
          const r = indexedDB.open('pdfstift', 1);
          r.onupgradeneeded = () => {
            const d = r.result;
            ['pdfs', 'notes', 'queue', 'kv'].forEach((s) => d.objectStoreNames.contains(s) || d.createObjectStore(s));
          };
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
      }
      return this.p;
    },
    async run(store, mode, fn) {
      const d = await this.open();
      return new Promise((res, rej) => {
        const t = d.transaction(store, mode);
        const rq = fn(t.objectStore(store));
        let out;
        if (rq) rq.onsuccess = () => { out = rq.result; };
        t.oncomplete = () => res(out);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      });
    },
    get(s, k) { return this.run(s, 'readonly', (st) => st.get(k)).catch(() => undefined); },
    put(s, k, v) {
      if (LOCAL && s === 'pdfs') return Promise.resolve(); // PDFs liegen ohnehin auf diesem PC – keine zweite Kopie
      return this.run(s, 'readwrite', (st) => st.put(v, k)).then((r) => { if (s === 'pdfs') pdfIdx(k, v); return r; });
    },
    del(s, k) { if (s === 'pdfs') pdfIdx(k, null); return this.run(s, 'readwrite', (st) => st.delete(k)).catch(() => {}); },
    keys(s) { return this.run(s, 'readonly', (st) => st.getAllKeys()).catch(() => []); },
  };

  // Verzeichnis der PDFs auf dem Gerät (Stand und Größe), damit veraltete Kopien ohne Laden erkannt werden
  function pdfIdx(path, v) {
    const idx = ls('pdfIdx') || {};
    if (v) idx[path] = { m: v.mtime || 0, s: v.size || 0 }; else delete idx[path];
    ls('pdfIdx', idx);
  }

  // ------------------------------------------------------------------ Zustand
  const S = {
    started: false,
    library: null,
    libraryOffline: false,
    folder: ls('folder') || '',
    search: '',
    tabs: EMBED || SHOW ? [] : (ls('tabs') || []).filter((t) => t && t.path),
    active: EMBED || SHOW ? null : ls('active') || null,
    tool: ['sel', 'hand', 'pen', 'hl', 'tx', 'sh', 'tt', 'nt', 'la', 'lp', 'er'].includes(ls('tool')) ? ls('tool') : (/PDFStiftWindows/.test(navigator.userAgent) ? 'sel' : 'tx'),
    color: Object.assign({ pen: '#1A1A1A', hl: '#FFE14D', tx: '#FF4A1C', sh: '#D6262B', tt: '#1A1A1A', nt: '#FFD43B' }, ls('color') || {}),
    wi: Object.assign({ pen: 1, hl: 1, sh: 1 }, ls('wi') || {}),
    txKind: ls('txKind') || 'hl',
    shKind: ls('shKind') || 'arrow',
    ttSize: ls('ttSize') || 14,
    favs: Array.isArray(ls('favs')) ? ls('favs') : DEFAULT_FAVS.map((f) => ({ ...f })),
    showTools: ls('showTools') ?? true,
    libView: ls('libView') === 'list' ? 'list' : 'grid',
    src: ['nc', 'od', 'nb', 'dk'].includes(ls('src')) ? ls('src') : 'local',
    nbPath: ls('nbPath') || '',
    boards: null,
    ncPath: ls('ncPath') || '',
    odPath: ls('odPath') || '',
    finger: !!ls('finger'),
    offline: LOCAL ? Object.assign(new Set(), { add() { return this; } }) : new Set(), // freie Ausgabe: alles liegt auf dem PC
  };
  const saveTabs = () => { if (EMBED || SHOW) return; ls('tabs', S.tabs); ls('active', S.active); };

  // ------------------------------------------------------------------ Notizen: lokal + Abgleich
  const Notes = { docs: new Map(), pending: new Map(), sending: false, saveT: {} };
  let flushT = null, retryDelay = 2000, syncState = 'ok';

  async function localDoc(path) {
    if (Notes.docs.has(path)) return Notes.docs.get(path);
    const rec = await DB.get('notes', path);
    const doc = { strokes: new Map(Object.entries((rec && rec.strokes) || {})) };
    Notes.docs.set(path, doc);
    const p = Notes.pending.get(path);
    if (p) applyPending(doc.strokes, p);
    return doc;
  }
  function saveLocal(path) {
    clearTimeout(Notes.saveT[path]);
    Notes.saveT[path] = setTimeout(() => {
      const d = Notes.docs.get(path);
      if (d) DB.put('notes', path, { strokes: Object.fromEntries(d.strokes) }).catch(() => {});
    }, 300);
  }
  function pend(path) {
    let p = Notes.pending.get(path);
    if (!p) { p = { add: new Map(), del: new Set() }; Notes.pending.set(path, p); }
    return p;
  }
  function pendingCount() {
    let n = 0;
    for (const p of Notes.pending.values()) n += p.add.size + p.del.size;
    return n;
  }
  function persistQueue(path) {
    const p = Notes.pending.get(path);
    if (!p || (!p.add.size && !p.del.size)) return DB.del('queue', path);
    return DB.put('queue', path, { add: [...p.add.values()], del: [...p.del] }).catch(() => {});
  }
  async function loadQueue() {
    for (const path of await DB.keys('queue')) {
      const rec = await DB.get('queue', path);
      if (!rec) continue;
      const p = pend(path);
      (rec.add || []).forEach((s) => p.add.set(s.id, s));
      (rec.del || []).forEach((id) => p.del.add(id));
    }
  }
  function applyPending(map, p) {
    for (const [id, s] of p.add) map.set(id, s);
    for (const id of p.del) map.delete(id);
  }

  // ---- Teleprompter-Fenster: Stand an das zweite Fenster übertragen
  let bcT = 0;
  function bcStrokes() {
    liveSoon();
    if (!BC || PROMPTER || EMBED || SHOW || !V.doc) return;
    clearTimeout(bcT);
    bcT = setTimeout(() => BC.postMessage({ t: 'strokes', path: V.path, strokes: [...V.doc.strokes.values()] }), 120);
  }
  function bcPos() {
    if (!BC || PROMPTER || EMBED || SHOW || !V.pages.length) return;
    const top = viewer.scrollTop;
    let i = 0;
    while (i < V.pages.length - 1 && V.pages[i + 1].el.offsetTop <= top) i++;
    const P = V.pages[i];
    BC.postMessage({ t: 'pos', path: V.path, i, ci: currentPageIndex(), f: (top - P.el.offsetTop) / P.cssH });
  }
  function bcDoc() {
    if (!BC || PROMPTER || EMBED || SHOW || !V.path) return;
    BC.postMessage({ t: 'doc', path: V.path });
    bcStrokes();
    setTimeout(bcPos, 50);
  }
  function opAdd(path, strokes) {
    const d = Notes.docs.get(path);
    const p = pend(path);
    for (const s of strokes) { d.strokes.set(s.id, s); p.add.set(s.id, s); }
    saveLocal(path); persistQueue(path); scheduleFlush();
    if (path === V.path) { bcStrokes(); V.dirty = true; if (document.body.classList.contains('prs-on')) prsUpdate(); }
  }
  function opDel(path, ids) {
    const d = Notes.docs.get(path);
    const p = pend(path);
    for (const id of ids) { d.strokes.delete(id); p.add.delete(id); p.del.add(id); }
    saveLocal(path); persistQueue(path); scheduleFlush();
    if (path === V.path) { bcStrokes(); V.dirty = true; }
  }

  function applyServer(path, server) {
    const d = Notes.docs.get(path);
    if (!d) return;
    const next = new Map(Object.entries(server.strokes || {}));
    const p = Notes.pending.get(path);
    if (p) applyPending(next, p);
    let changed = next.size !== d.strokes.size;
    if (!changed) for (const id of next.keys()) if (!d.strokes.has(id)) { changed = true; break; }
    d.strokes = next;
    saveLocal(path);
    if (changed && V.path === path) { redrawAllInk(); bcStrokes(); }
  }

  function scheduleFlush(ms = 900) {
    clearTimeout(flushT);
    flushT = setTimeout(flush, ms);
    if (pendingCount()) setSync(navigator.onLine === false ? 'offline' : 'saving');
  }
  async function flush() {
    if (Notes.sending) return;
    // Notizen einer PDF, deren neue Fassung noch hochgeladen wird, erst danach senden (der Server zieht sonst ihre Seiten falsch um)
    const paths = [...Notes.pending.keys()].filter((k) => { const q = Notes.pending.get(k); return (q.add.size || q.del.size) && !upPending(k); });
    if (!paths.length) { if (![...Notes.pending.keys()].some(upPending)) setSync('ok'); return; }
    Notes.sending = true;
    setSync('saving');
    try {
      for (const path of paths) {
        const batch = Notes.pending.get(path);
        Notes.pending.set(path, { add: new Map(), del: new Set() });
        try {
          const doc = await apiJson('sync', { method: 'POST', body: { path, add: [...batch.add.values()], del: [...batch.del] } });
          applyServer(path, doc);
          persistQueue(path);
        } catch (e) {
          if (e.status === 404) { persistQueue(path); continue; } // PDF gibt es auf dem Server nicht mehr
          const now = Notes.pending.get(path);
          for (const [id, s] of now.add) batch.add.set(id, s);
          for (const id of now.del) { batch.add.delete(id); batch.del.add(id); }
          Notes.pending.set(path, batch);
          persistQueue(path);
          throw e;
        }
      }
      Notes.sending = false;
      retryDelay = 2000;
      if (pendingCount()) scheduleFlush(300); else setSync('ok');
    } catch (e) {
      Notes.sending = false;
      setSync(e.auth ? 'error' : 'offline');
      if (!e.auth) {
        clearTimeout(flushT);
        flushT = setTimeout(flush, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 60000);
      }
    }
  }
  async function pull(path) {
    if (upPending(path)) return; // eigene Änderung wird gerade hochgeladen – Server noch auf altem Stand
    try {
      const doc = await apiJson('notes', { params: { path } });
      applyServer(path, doc);
      const en = pdfCache.get(path);
      if (doc.file && en && en.bytes && en.bytes.byteLength !== doc.file.size && V.path === path && !cur && !BURN.has(path)) {
        const meta = fileMeta(path);
        if (meta) { meta.mtime = doc.file.mtime; meta.size = doc.file.size; }
        await DB.del('pdfs', path);
        reloadDoc(path);
      }
      if (syncState === 'offline' && !pendingCount()) setSync('ok');
    } catch (e) {
      if (e.offline) setSync('offline');
    }
  }
  function setSync(state) {
    syncState = state;
    const el = $('#sync');
    const n = pendingCount();
    el.dataset.state = state;
    const text = {
      ok: 'Gespeichert',
      saving: 'Speichert …',
      burning: 'Schreibt in die PDF …',
      upload: `Lädt hoch${UP.pct ? ' ' + UP.pct + ' %' : ' …'}`,
      offline: n ? `Offline · ${n} ${n === 1 ? 'Änderung wartet' : 'Änderungen warten'}` : 'Offline',
      error: 'Bitte anmelden',
    }[state];
    $('#syncText').textContent = text;
    el.title = state === 'offline' ? 'Deine Notizen sind auf diesem Gerät gesichert und werden abgeglichen, sobald wieder Internet da ist.' : text;
  }

  // ------------------------------------------------------------------ PDF-Dateien (online/offline)
  function fileMeta(path) { return S.library && S.library.files.find((f) => f.path === path); }

  async function getPdfBytes(path) {
    const meta = fileMeta(path);
    const rec = await DB.get('pdfs', path);
    // Solange die Bibliothek nur der gespeicherte Stand ist, gilt die Kopie auf dem Gerät (pull() lädt neu, falls sich die Datei geändert hat)
    const fresh = rec && meta && ((rec.mtime === meta.mtime && rec.size === meta.size) || !S.libConfirmed);
    if (rec && (fresh || !meta || navigator.onLine === false)) return rec.bytes;
    try {
      const r = await api('pdf', { params: { path } });
      const buf = await r.arrayBuffer();
      try {
        await DB.put('pdfs', path, { bytes: buf, mtime: meta ? meta.mtime : 0, size: meta ? meta.size : buf.byteLength, savedAt: Date.now() });
        S.offline.add(path);
      } catch (e) { /* Speicher voll – trotzdem öffnen */ }
      return buf;
    } catch (e) {
      if (rec) return rec.bytes;
      throw e;
    }
  }

  const pdfCache = new Map(); // path -> { pdf, bytes | bytesP, size, used }
  // Inhalt einer geöffneten PDF: sofort, wenn schon auf dem Gerät – sonst sobald fertig geladen
  const pdfBytes = (e) => { if (!e.bytes && e.fetchAll) e.fetchAll(); return e.bytes || e.bytesP; };
  const STREAM_MIN = 1.5 * 1048576;
  async function loadPdf(path) {
    let entry = pdfCache.get(path);
    if (!entry) entry = await openPdfEntry(path);
    entry.used = Date.now();
    const old = [...pdfCache.entries()].filter(([p]) => p !== path).sort((a, b) => a[1].used - b[1].used);
    while (old.length > 3) {
      const [p, e] = old.shift();
      pdfCache.delete(p);
      e.pdf.destroy();
    }
    return entry;
  }

  // ---- Große PDFs stückweise laden. pdf.js liest beim Öffnen jede Seite einzeln (bei Scans quer über die ganze Datei verteilt,
  // eine Anfrage nach der anderen). Wir lesen vorher das Inhaltsverzeichnis der Datei und holen diese Stellen gleichzeitig.
  function rangeLoader(url, size, CH) {
    const cache = new Map();
    // Vordergrund (sichtbare Seiten, Vorschau) hat Vorrang: der Hintergrund-Download wartet, solange gerade etwas gebraucht wird
    const fg = { n: 0, last: 0 };
    const fetchSpan = async (a, b) => {
      const s0 = a * CH, e0 = Math.min(size, (b + 1) * CH) - 1;
      for (let k = 0; ; k++) {
        try {
          const r = await fetch(url, { headers: { Range: `bytes=${s0}-${e0}` }, credentials: 'same-origin', cache: 'no-store' });
          if (r.status !== 206) throw new Error('Bereich ' + r.status);
          const u = new Uint8Array(await r.arrayBuffer());
          if (u.length !== e0 - s0 + 1) throw new Error('Bereich unvollständig');
          return u;
        } catch (e) { if (k >= 2) throw e; await new Promise((res) => setTimeout(res, 800 * (k + 1))); }
      }
    };
    function ensure(a, b) {
      const ps = [];
      for (let i = a; i <= b;) {
        if (cache.has(i)) { ps.push(cache.get(i)); i++; continue; }
        let j = i;
        while (j < b && !cache.has(j + 1)) j++;
        const i0 = i, span = fetchSpan(i0, j);
        for (let k = i0; k <= j; k++) {
          const pk = span.then((u) => u.subarray((k - i0) * CH, Math.min(u.length, (k - i0 + 1) * CH)));
          pk.catch(() => cache.delete(k));
          cache.set(k, pk); ps.push(pk);
        }
        i = j + 1;
      }
      return Promise.all(ps);
    }
    async function read(s0, e0, bg) {
      const a = Math.floor(s0 / CH), b = Math.floor((Math.min(e0, size) - 1) / CH);
      if (!bg) { fg.n++; fg.last = Date.now(); }
      let parts;
      try { parts = await ensure(a, b); } finally { if (!bg) { fg.n--; fg.last = Date.now(); } }
      const out = new Uint8Array(Math.min(e0, size) - s0);
      let o = 0;
      parts.forEach((u, k) => {
        const base = (a + k) * CH, from = Math.max(0, s0 - base), to = Math.min(u.length, Math.min(e0, size) - base);
        if (to > from) { out.set(u.subarray(from, to), o); o += to - from; }
      });
      return out;
    }
    const pool = async (list, n) => { let k = 0; await Promise.all(Array.from({ length: n }, async () => { while (k < list.length) { const [a, b] = list[k++]; await ensure(a, b).catch(() => {}); } })); };
    // ganze Datei im Hintergrund: in Portionen zu 1 MB, Pause sobald die Anzeige etwas braucht
    async function fetchAllBg() {
      const last = Math.floor((size - 1) / CH), SPAN = Math.max(1, Math.round(1048576 / CH));
      for (let a = 0; a <= last; a += SPAN) {
        while (fg.n > 0 || Date.now() - fg.last < 600) await new Promise((r) => setTimeout(r, 150));
        let b = Math.min(last, a + SPAN - 1);
        await ensure(a, b);
      }
      return read(0, size, true);
    }
    return { read, ensure, pool, fetchAllBg, CH, size };
  }
  // Inhaltsverzeichnis (xref) lesen und die Seitenobjekte vorab holen – klappt bei klassischen Tabellen; sonst lädt pdf.js wie gewohnt
  async function prefetchPageObjs(L) {
    const dec = new TextDecoder('latin1');
    const txt = async (s0, n) => dec.decode(await L.read(Math.max(0, s0), Math.min(L.size, s0 + n)));
    const tail = await txt(L.size - 4096, 4096);
    const sx = /startxref\s+(\d+)/.exec(tail.slice(tail.lastIndexOf('startxref')));
    if (!sx) return;
    const off = new Map();
    let root = null, at = +sx[1], guard = 0;
    while (at > 0 && at < L.size && guard++ < 20) {
      const head = await txt(at, 64);
      if (!/^\s*xref/.test(head)) return; // Querverweis-Stream: pdf.js kommt damit gut zurecht
      let t = await txt(at, 65536);
      let m = /trailer/.exec(t);
      for (let more = 1; !m && more < 40 && at + 65536 * more < L.size; more++) { t = await txt(at, 65536 * (more + 1)); m = /trailer/.exec(t); }
      if (!m) return;
      const tab = t.slice(0, m.index), trailer = t.slice(m.index, m.index + 2000);
      const re = /(\d+)\s+(\d+)\s*[\r\n]+((?:\d{10}\s\d{5}\s[nf]\s*[\r\n]*)+)/g;
      let sec;
      while ((sec = re.exec(tab))) {
        const first = +sec[1], rows = sec[3].match(/\d{10}\s\d{5}\s[nf]/g) || [];
        rows.forEach((row, k) => { if (row.endsWith('n') && !off.has(first + k)) off.set(first + k, +row.slice(0, 10)); });
      }
      if (!root) { const r = /\/Root\s+(\d+)\s+\d+\s+R/.exec(trailer); if (r) root = +r[1]; }
      const prev = /\/Prev\s+(\d+)/.exec(trailer);
      at = prev ? +prev[1] : 0;
    }
    if (!root || !off.has(root)) return;
    const cat = await txt(off.get(root), 4096);
    const pr = /\/Pages\s+(\d+)\s+\d+\s+R/.exec(cat);
    if (!pr || !off.has(+pr[1])) return;
    let node = await txt(off.get(+pr[1]), 65536);
    let km = /\/Kids\s*\[([^\]]*)\]/.exec(node);
    if (!km) { node = await txt(off.get(+pr[1]), 1048576); km = /\/Kids\s*\[([^\]]*)\]/.exec(node); }
    if (!km) return;
    const kids = [...km[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((x) => off.get(+x[1])).filter((x) => x !== undefined);
    const spans = [...new Set(kids.map((o) => Math.floor(o / L.CH)))].sort((a, b) => a - b).map((c) => [c, c]);
    await L.pool(spans, 10);
  }
  async function openRanged(url, size) {
    const CH = 16384;
    const L = rangeLoader(url, size, CH);
    class RT extends pdfjsLib.PDFDataRangeTransport {
      requestDataRange(begin, end) { L.read(begin, end).then((u) => this.onDataRange(begin, u), (e) => console.warn('PDF-Teil nicht geladen', e)); }
    }
    // erst das Inhaltsverzeichnis (höchstens 6 s), dann pdf.js öffnen – die Seiten liegen dann schon bereit
    await Promise.race([prefetchPageObjs(L).catch(() => {}), new Promise((r) => setTimeout(r, 6000))]);
    const first = await L.read(0, Math.min(size, CH));
    const pdf = await pdfjsLib.getDocument({ range: new RT(size, first), rangeChunkSize: CH, disableStream: true, disableAutoFetch: true, isEvalSupported: false }).promise;
    return { pdf, L };
  }

  async function openPdfEntry(path) {
    const meta = fileMeta(path);
    const rec = await DB.get('pdfs', path);
    const fresh = rec && meta && ((rec.mtime === meta.mtime && rec.size === meta.size) || !S.libConfirmed);
    const online = navigator.onLine !== false && !S.libraryOffline;
    let entry;
    if (!(rec && (fresh || !meta || !online)) && online && meta && meta.size >= STREAM_MIN) {
      // Große PDF, noch nicht (oder veraltet) auf dem Gerät: erste Seiten sofort zeigen, Rest lädt im Hintergrund
      try {
        // nur die Teile holen, die für die sichtbaren Seiten gebraucht werden; den Rest erst danach
        const url = `${API}?a=pdf&path=${encodeURIComponent(path)}&m=${meta.mtime}`;
        const { pdf, L } = await openRanged(url, meta.size);
        entry = { pdf, bytes: null, size: meta.size };
        let go;
        const started = new Promise((r) => { go = r; });
        entry.fetchAll = go;
        setTimeout(go, 4000);
        entry.bytesP = started.then(() => L.fetchAllBg()).then((u8) => {
          const buf = u8.buffer.byteLength === u8.byteLength ? u8.buffer : u8.slice().buffer;
          entry.bytes = buf; entry.size = buf.byteLength;
          DB.put('pdfs', path, { bytes: buf, mtime: meta.mtime, size: buf.byteLength, savedAt: Date.now() })
            .then(() => { S.offline.add(path); if (!V.path) renderLibrary(); }).catch(() => {});
          return buf;
        });
        entry.bytesP.catch(() => {});
      } catch (e) {
        if (!rec) throw Object.assign(e, { offline: e.offline || navigator.onLine === false });
      }
    }
    if (!entry) {
      const bytes = await getPdfBytes(path);
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)), isEvalSupported: false }).promise;
      entry = { pdf, bytes, size: bytes.byteLength };
    }
    pdfCache.set(path, entry);
    return entry;
  }

  // Im Hintergrund vorladen, damit das Öffnen sofort geht: auf dem Gerät liegende PDFs, die sich auf dem Server geändert haben
  // (z. B. nachts verkleinert oder auf dem anderen Tablet beschriftet), und neue PDFs der letzten 14 Tage.
  const PF = { running: false, budget: 1024 * 1048576 };
  const devMode = () => (ls('devMode') === 'all' ? 'all' : 'need');
  async function prefetch() {
    if (LOCAL || PF.running || !S.library || S.libraryOffline || navigator.onLine === false) return;
    const c = navigator.connection;
    if (c && (c.saveData || c.type === 'cellular' || /2g/.test(c.effectiveType || ''))) return;
    PF.running = true;
    const idx = ls('pdfIdx') || {};
    const now = Date.now() / 1000;
    const all = devMode() === 'all';
    // „Bei Bedarf“: nur Kopien auf dem Gerät aktuell halten. „Alles“: zusätzlich alles Fehlende holen.
    const want = S.library.files.filter((f) => {
      const i = idx[f.path];
      if (i) return i.m !== f.mtime || i.s !== f.size;
      if (S.offline.has(f.path)) return false;
      return all;
    }).sort((a, b) => (idx[b.path] ? 1 : 0) - (idx[a.path] ? 1 : 0) || b.mtime - a.mtime);
    let used = 0, n = 0;
    const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate().catch(() => null) : null;
    for (const f of want) {
      if (devMode() !== 'all' && used + f.size > PF.budget) continue;
      if (est && est.quota && est.usage + used + f.size > est.quota * 0.8) break; // Platz für Notizen und App lassen
      while (V.loading || cur || document.hidden) await new Promise((r) => setTimeout(r, 3000));
      if (navigator.onLine === false || S.libraryOffline) break;
      if (pdfCache.has(f.path) || !fileMeta(f.path) || upPending(f.path)) continue;
      try { await getPdfBytes(f.path); used += f.size; n++; } catch (e) { if (e.offline || e.auth) break; }
    }
    PF.running = false;
    if (n && !V.path) renderLibrary();
    if (n && $('#bkDlg').open) devUi();
  }

  // Kopien von PDFs, die es auf dem Server nicht mehr gibt (gelöscht, verschoben), vom Gerät nehmen
  async function devCleanup() {
    if (!S.library || !S.libConfirmed || S.libraryOffline) return 0;
    const have = new Set(S.library.files.map((f) => f.path));
    let n = 0;
    for (const k of await DB.keys('pdfs')) {
      if (have.has(k) || isBoard(k) || S.tabs.some((t) => t.path === k)) continue;
      await DB.del('pdfs', k); S.offline.delete(k); n++;
    }
    return n;
  }
  // Ältere Kopien ohne Eintrag im Verzeichnis einmalig erfassen (sonst würden sie nie abgeglichen)
  async function devMigrate() {
    if (ls('pdfIdxDone')) return;
    const idx = ls('pdfIdx') || {};
    for (const k of await DB.keys('pdfs')) {
      if (idx[k]) continue;
      const rec = await DB.get('pdfs', k);
      if (rec) pdfIdx(k, rec);
      await new Promise((r) => setTimeout(r, 50));
    }
    ls('pdfIdxDone', true);
  }

  // ---- Gerät & Speicher
  let installEv = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEv = e; if ($('#bkDlg').open) devUi(); });
  window.addEventListener('appinstalled', () => { installEv = null; toast('PDF-Stift ist jetzt als App installiert.'); if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); });
  const fmtMB = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(1).replace('.', DEC) + ' GB' : b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' KB' : Math.round(b / 1048576) + ' MB');
  async function devUi() {
    const idx = ls('pdfIdx') || {};
    const keys = await DB.keys('pdfs');
    const bytes = keys.reduce((a, k) => a + ((idx[k] && idx[k].s) || 0), 0);
    const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate().catch(() => null) : null;
    const pers = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted().catch(() => false) : false;
    const total = S.library ? S.library.files.length : 0;
    const stale = S.library ? S.library.files.filter((f) => idx[f.path] && (idx[f.path].m !== f.mtime || idx[f.path].s !== f.size)).length : 0;
    $('#devInfo').innerHTML = `<b>${keys.length} von ${total} PDFs</b> liegen auf diesem Gerät (${fmtMB(bytes)})` +
      (est && est.quota ? ` · frei für PDF-Stift: ${fmtMB(Math.max(0, est.quota - est.usage))}` : '') +
      (stale ? ` · ${stale} ${stale === 1 ? 'wird' : 'werden'} gerade aktualisiert` : '') +
      `<br>${pers ? '✓ Dauerhaft gespeichert – das System löscht die Kopien nicht von selbst.' : '⚠ Noch nicht dauerhaft gespeichert: Bei knappem Platz könnte das System Kopien löschen (Notizen auf dem Server bleiben immer erhalten). Als App installieren hilft.'}`;
    document.querySelectorAll('input[name=devMode]').forEach((r) => { r.checked = r.value === devMode(); });
    $('#devInstall').hidden = !installEv;
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const ua = navigator.userAgent;
    $('#devApk').hidden = !/Android/.test(ua);
    $('#devWin').hidden = !/Windows/.test(ua) || /PDFStiftWindows/.test(ua);
    $('#devApp').innerHTML = standalone ? '✓ PDF-Stift läuft als installierte App.'
      : installEv ? '<b>Als App installieren:</b> Knopf unten antippen.'
      : /iPad|iPhone|Macintosh/.test(ua) && 'ontouchend' in document ? '<b>Als App installieren:</b> in Safari auf das Teilen-Symbol (□↑) tippen → „Zum Home-Bildschirm“.'
      : /Android/.test(ua) ? '<b>Richtige Android-App:</b> Knopf unten antippen. Die Datei „PDF-Stift.apk“ wird geladen; danach in der Download-Meldung auf „Öffnen“ und „Installieren“ tippen. Beim ersten Mal fragt Android, ob der Browser Apps installieren darf – einmal erlauben.'
      : '<b>Als App installieren:</b> in Chrome bzw. Edge auf das Installieren-Symbol rechts in der Adressleiste klicken oder Menü ⋮ → „Streamen, speichern und teilen“ → „Seite als App installieren“.';
    $('#devPersist').hidden = pers || !(navigator.storage && navigator.storage.persist);
  }
  document.querySelectorAll('input[name=devMode]').forEach((r) => r.addEventListener('change', () => {
    ls('devMode', r.value);
    toast(r.value === 'all' ? 'Alle PDFs werden jetzt nach und nach (im WLAN) auf das Gerät geladen.' : 'PDFs werden ab jetzt nur bei Bedarf geladen und dann behalten.');
    if (r.value === 'all') { clearTimeout(PF.t); prefetch(); }
  }));
  $('#devInstall').onclick = async () => { if (!installEv) return; installEv.prompt(); try { await installEv.userChoice; } catch (e) { /* */ } installEv = null; devUi(); };
  $('#devPersist').onclick = async () => {
    const ok = await navigator.storage.persist().catch(() => false);
    toast(ok ? 'Speicher ist jetzt dauerhaft gesichert.' : 'Das System erlaubt es noch nicht – installiere PDF-Stift als App, dann klappt es.', 6000);
    devUi();
  };
  $('#devClear').onclick = async () => {
    if (!(await confirmDlg('Alle PDF-Kopien von diesem Gerät entfernen?', 'Die PDFs und Notizen auf dem Server bleiben unverändert. Beim nächsten Öffnen wird die PDF wieder geladen.', 'Entfernen'))) return;
    for (const k of await DB.keys('pdfs')) { if (!pdfCache.has(k)) { await DB.del('pdfs', k); S.offline.delete(k); } }
    if (devMode() === 'all') { ls('devMode', 'need'); }
    toast('Kopien entfernt.');
    devUi(); renderLibrary();
  };
  const prefetchSoon = () => { clearTimeout(PF.t); PF.t = setTimeout(prefetch, 6000); };

  // ------------------------------------------------------------------ Anmeldung
  let authSetup = false;
  function showAuth(setup) {
    authSetup = setup;
    ls('signedIn', false);
    $('#auth').hidden = false;
    $('#shell').hidden = true;
    $('#authTitle').textContent = setup ? 'PDF-Stift einrichten' : 'Anmelden';
    $('#authText').textContent = setup
      ? 'Lege ein Passwort fest (mindestens 8 Zeichen). Damit meldest du dich auf iPad und Android an.'
      : 'Gib dein Passwort ein. Du bleibst danach auf diesem Gerät angemeldet.';
    $('#pw').autocomplete = setup ? 'new-password' : 'current-password';
    $('#authBtn').textContent = setup ? 'Einrichten' : 'Anmelden';
    $('#authErr').textContent = '';
    $('#codeRow').hidden = true; $('#code2').value = ''; $('#pw').readOnly = false;
    setTimeout(() => $('#pw').focus(), 50);
  }
  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#authErr').textContent = '';
    $('#authBtn').disabled = true;
    try {
      const body = { password: $('#pw').value };
      if (!$('#codeRow').hidden) body.code = $('#code2').value.trim();
      const r = await apiJson(authSetup ? 'setup' : 'login', { method: 'POST', body });
      if (r && r.need2fa) {
        $('#codeRow').hidden = false;
        $('#pw').readOnly = true;
        $('#authText').textContent = 'Passwort stimmt. Jetzt noch den Code aus deiner Authenticator-App eingeben.';
        setTimeout(() => $('#code2').focus(), 50);
        return;
      }
      $('#pw').value = ''; $('#code2').value = ''; $('#codeRow').hidden = true; $('#pw').readOnly = false;
      $('#auth').hidden = true;
      $('#shell').hidden = false;
      if (S.started) { flush(); loadLibrary(); if (V.path) pull(V.path); } else startApp();
    } catch (err) {
      $('#authErr').textContent = err.offline ? 'Keine Verbindung zum Server.' : err.message;
    } finally {
      $('#authBtn').disabled = false;
    }
  });

  // ------------------------------------------------------------------ Bibliothek
  async function loadLibrary() {
    try {
      S.library = await apiJson('list');
      S.libraryOffline = false;
      S.libConfirmed = true;
      metaLoad();
      DB.put('kv', 'library', S.library).catch(() => {});
    } catch (e) {
      if (e.auth) return;
      S.library = S.library || (await DB.get('kv', 'library')) || { folders: [], files: [] };
      S.libraryOffline = true;
    }
    renderLibrary();
    renderTabs();
    if (!S.libraryOffline) { prefetchSoon(); devCleanup().then((n) => { if (n && !V.path) renderLibrary(); }); setTimeout(devMigrate, 15000); }
    const nc = S.library && S.library.nc;
    if (nc && nc.configured && !S.libraryOffline && Date.now() / 1000 - nc.last > 120) ncSync(false);
  }

  // ---- Große PDFs verkleinern: normalerweise per Cronjob (jede Nacht), hier auch sofort von Hand
  const SH = { running: false, saved: 0, n: 0, retryT: 0 };
  async function shrinkRun(manual) {
    if (SH.running) return;
    SH.running = true;
    SH.saved = 0; SH.n = 0;
    clearTimeout(SH.retryT);
    for (;;) {
      if (navigator.onLine === false) break;
      if (document.hidden && !manual) { await new Promise((r) => setTimeout(r, 5000)); continue; }
      let r;
      try { r = await apiJson('shrinknext', { method: 'POST' }); } catch (e) { break; }
      if (r.busy) { toast('Der Cronjob verkleinert gerade – bitte später noch einmal.'); break; }
      if (r.info && S.library) S.library.shrink = r.info;
      if (r.done) { if (S.library) S.library.shrink = Object.assign(S.library.shrink || {}, r); break; }
      if (r.status === 'smaller') {
        SH.saved += r.before - r.after; SH.n++;
        const f = fileMeta(r.path);
        if (f) f.size = r.after; // die kleinere Fassung wird beim nächsten Öffnen geladen
      }
      updateShrinkUi(r.path);
      await new Promise((res) => setTimeout(res, 800));
    }
    SH.running = false;
    updateShrinkUi();
    if (SH.n) {
      toast(`${SH.n} ${SH.n === 1 ? 'PDF' : 'PDFs'} verkleinert – ${fmtSize(SH.saved)} weniger, gleiche Darstellung.`, 5000);
      try { S.library = await apiJson('list'); DB.put('kv', 'library', S.library).catch(() => {}); if (!V.path) renderLibrary(); } catch (e) { /* */ }
    } else if (manual) toast('Alles geprüft – keine PDF ließ sich noch sinnvoll verkleinern.');
  }
  function updateShrinkUi(working) {
    const el = $('#shInfo');
    if (!el) return;
    const s = (S.library && S.library.shrink) || {};
    $('#shAuto').checked = !!s.auto;
    $('#shNc').checked = !!s.ncBack;
    $('#shNcRow').hidden = !s.ncOn;
    $('#shAuto').disabled = !s.ok;
    $('#shNow').disabled = !s.ok || SH.running || !s.pending;
    if (!s.ok) {
      el.textContent = 'Auf deinem Server fehlen dafür Ghostscript und qpdf. Frag deinen Hoster, ob er „ghostscript“ (oder wenigstens „qpdf“) installieren kann – dann geht es automatisch.';
      return;
    }
    el.textContent = (s.lastRun ? `Letzter Lauf ${fmtDate(s.lastRun)}: ${s.lastInfo}. ` : 'Der Cronjob ist noch nie gelaufen. ') +
      (s.count ? `Insgesamt ${s.count} ${s.count === 1 ? 'PDF' : 'PDFs'} verkleinert, ${fmtSize(s.saved)} gespart. ` : '') +
      (SH.running ? `Arbeitet gerade${working ? ' an „' + basename(working) + '“' : ''} … ` : '') +
      (s.pending ? `${s.pending} ${s.pending === 1 ? 'PDF' : 'PDFs'} ab ${s.minMB} MB ${s.pending === 1 ? 'wartet' : 'warten'} (${fmtSize(s.pendingBytes)}).` : `Alle PDFs ab ${s.minMB} MB sind geprüft.`) +
      (s.gs ? '' : ' (Nur verlustfreie Optimierung: Ghostscript fehlt auf dem Server.)');
    $('#shCli').value = `0 3 * * *  ${s.cronCli} >/dev/null 2>&1`;
    $('#shUrl').value = s.cronUrl || '';
  }

  // ---- Nextcloud
  let ncBusy = false;
  async function ncSync(manual) {
    if (ncBusy) return;
    ncBusy = true;
    if (manual) toast('Gleiche mit Nextcloud ab …', 60000);
    try {
      const r = await apiJson('ncsync', { method: 'POST' });
      if (S.library) S.library.nc = r.nc;
      const n = (r.imported || []).length;
      if (n) toast(`${n} ${n === 1 ? 'neue PDF' : 'neue PDFs'} aus Nextcloud.`);
      else if (manual) toast(r.error ? r.error : 'Nextcloud ist abgeglichen – nichts Neues.', r.error ? 6000 : 3200);
      if (S.src === 'nc') ncLoad(S.ncPath);
      if (n || r.pending) {
        const lib = await apiJson('list');
        S.library = lib;
        DB.put('kv', 'library', lib).catch(() => {});
        renderLibrary();
      } else renderLibrary();
      if (r.pending) { ncBusy = false; ncSync(false); return; }
    } catch (e) {
      if (manual) toast(e.message);
    }
    ncBusy = false;
  }
  $('#btnNc').onclick = async () => {
    let nc = (S.library && S.library.nc) || {};
    try { nc = await apiJson('ncget'); } catch (e) { /* offline */ }
    $('#ncUrl').value = nc.url || '';
    $('#ncUser').value = nc.user || '';
    $('#ncPass').value = '';
    $('#ncPass').placeholder = nc.configured ? 'gespeichert – nur zum Ändern ausfüllen' : 'in Nextcloud: Einstellungen → Sicherheit → App-Passwort';
    $('#ncFolder').value = nc.folder || 'PDF-Stift';
    $('#ncExport').checked = !!nc.export;
    $('#ncRemove').hidden = !nc.configured;
    $('#ncMsg').textContent = nc.configured
      ? `Verbunden. ${nc.count} PDFs übernommen, zuletzt abgeglichen ${nc.last ? fmtDate(nc.last) : '–'}.` + (nc.lastError ? ' Letzter Fehler: ' + nc.lastError : '')
      : '';
    $('#ncDlg').showModal();
  };
  $('#ncSave').onclick = async () => {
    $('#ncMsg').textContent = 'Prüfe die Verbindung …';
    try {
      const nc = await apiJson('ncset', { method: 'POST', body: { url: $('#ncUrl').value, user: $('#ncUser').value, pass: $('#ncPass').value, folder: $('#ncFolder').value, export: $('#ncExport').checked } });
      if (S.library) S.library.nc = nc;
      $('#ncDlg').close();
      S.src = 'nc'; ls('src', 'nc');
      goCloud('nc', '');
      ncSync(true);
    } catch (e) {
      $('#ncMsg').textContent = e.offline ? 'Keine Verbindung zum Server.' : e.message;
    }
  };
  $('#ncRemove').onclick = async () => {
    try { await apiJson('ncdel', { method: 'POST' }); } catch (e) { /* */ }
    if (S.library) S.library.nc = { configured: false };
    S.src = 'local'; ls('src', 'local');
    $('#ncDlg').close();
    toast('Nextcloud getrennt. Die übernommenen PDFs bleiben erhalten.');
    renderLibrary();
  };

  // ---- Ordner: echte Unterordner mit Pfadleiste, Kachel- oder Listenansicht
  const parentOf = (d) => (d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '');
  const inFolder = (f, folder) => !folder || f.folder === folder || f.folder.startsWith(folder + '/');
  function folderFiles(folder) { return S.library ? S.library.files.filter((f) => inFolder(f, folder)) : []; }
  function childFolders(folder) { return S.library ? S.library.folders.filter((d) => parentOf(d) === folder) : []; }
  function visibleFiles() {
    if (!S.library) return [];
    const q = S.search.trim().toLowerCase();
    if (S.tag && S.tag !== '★') return S.library.files.filter((f) => tagsOf(f.path).includes(S.tag) && (!q || f.path.toLowerCase().includes(q)));
    if (q) return S.library.files.filter((f) => inFolder(f, S.folder) && (f.path.toLowerCase().includes(q) || tagsOf(f.path).some((t) => t.toLowerCase().includes(q))));
    return S.library.files.filter((f) => f.folder === S.folder);
  }
  function goFolder(d) { S.tag = ''; S.folder = d; ls('folder', d); S.search = ''; $('#search').value = ''; renderLibrary(); $('#library').scrollTop = 0; }
  const FOLDER_SVG = '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  const MORE_SVG = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>';

  function renderLibrary() {
    setSrcUi();
    if (CLOUD[S.src] && S.library && !S.libraryOffline && !CLOUD[S.src].ok()) { S.src = 'local'; ls('src', 'local'); }
    if (S.src === 'nb') { renderNotebook(); renderTextHits(); return; }
    if (S.src === 'dk') { renderDecks(); return; }
    if (CLOUD[S.src]) { renderCloud(S.src); renderTextHits(); return; }
    const lib = S.library || { folders: [], files: [] };
    if (S.folder && !lib.folders.includes(S.folder)) S.folder = '';
    const list = S.libView === 'list';

    // Pfadleiste
    const bar = $('#folders');
    bar.innerHTML = '';
    const crumbs = document.createElement('nav');
    crumbs.className = 'crumbs';
    crumbs.setAttribute('aria-label', 'Ordner');
    const parts = S.folder ? S.folder.split('/') : [];
    const mkCrumb = (label, val, last) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'crumb' + (last ? ' cur' : '');
      b.textContent = label;
      if (last) b.setAttribute('aria-current', 'page');
      b.onclick = () => goFolder(val);
      crumbs.appendChild(b);
    };
    mkCrumb('Alle PDFs', '', !parts.length);
    parts.forEach((seg, i) => {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '›';
      crumbs.appendChild(sep);
      mkCrumb(seg, parts.slice(0, i + 1).join('/'), i === parts.length - 1);
    });
    bar.appendChild(crumbs);
    const tools = document.createElement('div');
    tools.className = 'lib-tools';
    tools.innerHTML = `<button type="button" class="text-btn" data-a="mkdir">${FOLDER_SVG}<span>Neuer Ordner</span></button>
      <div class="seg2 view-toggle" role="group" aria-label="Ansicht">
        <button type="button" data-v="grid" class="${list ? '' : 'active'}" aria-pressed="${!list}" aria-label="Kacheln" title="Kacheln"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg></button>
        <button type="button" data-v="list" class="${list ? 'active' : ''}" aria-pressed="${list}" aria-label="Liste" title="Liste"><svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg></button>
      </div>`;
    tools.querySelector('[data-a=mkdir]').onclick = newFolder;
    tools.querySelectorAll('[data-v]').forEach((b) => { b.onclick = () => { S.libView = b.dataset.v; ls('libView', S.libView); renderLibrary(); }; });
    bar.appendChild(tools);

    const searching = !!S.search.trim();
    const recent = !searching && !S.folder ? (ls('recent') || []).map((r) => lib.files.find((f) => f.path === r.path)).filter(Boolean).slice(0, 10) : [];
    $('#recentBox').hidden = recent.length < 1;
    const rrow = $('#recent');
    rrow.innerHTML = '';
    for (const f of recent) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'recent-item';
      b.innerHTML = `<span class="thumb" data-path="${esc(f.path)}"><svg class="ph" viewBox="0 0 24 24" style="width:28px;height:28px"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/></svg></span><span class="n" title="${esc(f.path)}">${esc(f.name)}</span>`;
      b.onclick = () => openDoc(f.path);
      rrow.appendChild(b);
      const th = b.querySelector('.thumb');
      if (thumbMem.has(f.path + '|' + f.mtime)) thumb(f, th); else thumbIO.observe(th);
    }
    renderTagBar();
    const folders = searching || S.tag ? [] : childFolders(S.folder);
    const files = S.tag === '★' ? [] : visibleFiles();
    const all = folderFiles(S.folder);
    const missing = all.filter((f) => !S.offline.has(f.path)).length;
    $('#folderBar').hidden = !all.length && !folders.length;
    $('#folderInfo').textContent =
      (folders.length ? `${folders.length} ${folders.length === 1 ? 'Ordner' : 'Ordner'} · ` : '') +
      `${files.length} ${files.length === 1 ? 'PDF' : 'PDFs'}` + (searching ? ' gefunden' : '') +
      (S.libraryOffline ? ' · offline, zuletzt bekannter Stand' : '') +
      (!LOCAL && all.length && !missing ? ' · alles offline verfügbar' : '') +
      (lib.nc && lib.nc.configured ? ` · Nextcloud ${lib.nc.last ? 'abgeglichen ' + fmtDate(lib.nc.last) : 'verbunden'}` : '');
    $('#btnFolderOffline').hidden = !missing || S.libraryOffline || searching;
    $('#btnFolderOffline').onclick = folderOffline;
    $('#btnFolderOffline').textContent = S.folder ? 'Diesen Ordner offline verfügbar machen' : 'Alles offline verfügbar machen';

    const wrap = $('#files');
    wrap.innerHTML = '';
    wrap.classList.toggle('list', list && S.tag !== '★');
    if (S.tag === '★') { renderMarks(wrap); return; }
    if (S.folder && !searching && !S.tag) {
      const up = document.createElement('div');
      up.className = 'card folder up';
      up.innerHTML = `<button type="button" class="thumb" aria-label="Zurück zu ${esc(parentOf(S.folder) || 'Alle PDFs')}"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
        <div class="meta"><div class="txt"><div class="n">Zurück</div><div class="d">${esc(parentOf(S.folder) || 'Alle PDFs')}</div></div></div>`;
      up.querySelector('.thumb').onclick = () => goFolder(parentOf(S.folder));
      up.querySelector('.txt').onclick = () => goFolder(parentOf(S.folder));
      wrap.appendChild(up);
    }
    for (const d of folders) {
      const n = folderFiles(d).length;
      const sub = childFolders(d).length;
      const card = document.createElement('div');
      card.className = 'card folder';
      card.innerHTML = `<button type="button" class="thumb" aria-label="Ordner ${esc(d.split('/').pop())} öffnen">${FOLDER_SVG}</button>
        <div class="meta"><div class="txt"><div class="n">${esc(d.split('/').pop())}</div>
        <div class="d">${sub ? sub + ' Ordner · ' : ''}${n} ${n === 1 ? 'PDF' : 'PDFs'}</div></div></div>`;
      card.querySelector('.thumb').onclick = () => goFolder(d);
      card.querySelector('.txt').onclick = () => goFolder(d);
      wrap.appendChild(card);
    }
    for (const f of files) {
      const card = document.createElement('div');
      card.className = 'card';
      const hasNotes = f.notesMtime > 0 || (Notes.pending.get(f.path) && Notes.pending.get(f.path).add.size);
      const badges = (S.offline.has(f.path) ? '<span class="badge offline">Offline</span>' : '') + (hasNotes ? '<span class="badge notes">Notizen</span>' : '');
      card.innerHTML = `
        <button type="button" class="thumb" aria-label="${esc(f.name)} öffnen">
          <svg class="ph" viewBox="0 0 24 24" style="width:40px;height:40px"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/></svg>
          <span class="badges">${badges}</span>
        </button>
        <div class="meta">
          <div class="txt"><div class="n" title="${esc(f.path)}">${esc(f.name)}</div>
          <div class="d">${(searching || list || S.tag) && f.folder ? esc(f.folder) + ' · ' : ''}${fmtSize(f.size)} · ${fmtDate(Math.max(f.mtime, f.notesMtime))}</div>${tagsOf(f.path).length ? `<div class="tg">${tagsOf(f.path).map((t) => `<span>#${esc(t)}</span>`).join('')}</div>` : ''}</div>
          <span class="lbadges">${badges}</span>
          <div class="menu-wrap"><button type="button" class="icon-btn more" aria-label="Mehr zu ${esc(f.name)}">${MORE_SVG}</button></div>
        </div>`;
      card.querySelector('.thumb').onclick = () => openDoc(f.path);
      if (list) card.querySelector('.txt').onclick = () => openDoc(f.path);
      card.querySelector('.more').onclick = (ev) => {
        ev.stopPropagation();
        cardMenu(card.querySelector('.menu-wrap'), f);
      };
      wrap.appendChild(card);
      const th = card.querySelector('.thumb');
      th.dataset.path = f.path;
      if (window.pdfstiftWin && window.pdfstiftWin.dragPrep) { card.draggable = true; th.draggable = true; }
      const tk = f.path + '|' + f.mtime;
      if (thumbMem.has(tk)) thumb(f, th); else thumbIO.observe(th);
    }
    const empty = $('#libEmpty');
    empty.hidden = files.length > 0 || folders.length > 0;
    empty.textContent = !lib.files.length && !lib.folders.length
      ? (LOCAL ? 'Noch keine PDFs. Füge welche über „PDF hinzufügen“ hinzu, ziehe sie aus dem Explorer hierher oder lege sie einfach in deinen Bibliotheksordner.' : 'Noch keine PDFs. Lade welche über „PDF hochladen“ hoch, verbinde Nextcloud oder kopiere sie per FTP in den Ordner storage/pdfs.')
      : searching ? 'Keine PDF passt zu deiner Suche.' : 'Dieser Ordner ist leer. Lade PDFs hoch oder lege einen Unterordner an.';
    $('#folderList').innerHTML = lib.folders.map((f) => `<option value="${esc(f)}"></option>`).join('');
    if (searching && !files.length && FT.q) empty.hidden = true;
    renderTextHits();
  }

  // ---- Cloud direkt (Nextcloud, OneDrive): live durch den Ordner blättern und Dateien von dort öffnen
  const CLOUD_SVG = '<svg viewBox="0 0 24 24"><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5z"/></svg>';
  const OD_SVG = '<svg viewBox="0 0 24 24"><path d="M9.5 9.2A5 5 0 0 1 18.6 11a3.6 3.6 0 0 1-.6 7.2H7a4 4 0 0 1-.9-7.9A5 5 0 0 1 9.5 9.2z"/></svg>';
  const CLOUD = {
    nc: {
      name: 'Nextcloud', a: 'nc', svg: CLOUD_SVG,
      cfg: () => (S.library && S.library.nc) || {},
      ok: () => !!(S.library && S.library.nc && S.library.nc.configured),
      root: (c) => c.folder || 'Nextcloud',
      settings: () => $('#btnNc').click(),
      sync: () => ncSync(true),
    },
    od: {
      name: 'OneDrive', a: 'od', svg: OD_SVG,
      cfg: () => (S.library && S.library.od) || {},
      ok: () => !!(S.library && S.library.od && S.library.od.connected),
      root: (c) => c.folder || 'OneDrive',
      settings: () => openOdDlg(),
      sync: null,
    },
  };
  const CL = { nc: { data: null, err: '', token: 0 }, od: { data: null, err: '', token: 0 } };
  const cloudPath = (pv) => S[pv + 'Path'] || '';
  const localOf = (f) => f.local || f.path;
  const isOffice = (f) => f.ext && f.ext !== 'pdf';
  function setSrcUi() {
    document.querySelectorAll('#srcSwitch [data-src]').forEach((b) => {
      const on = b.dataset.src === S.src;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('#libTitle').textContent = S.src === 'dk' ? 'Präsentationen' : S.src === 'nb' ? 'Notizbuch' : CLOUD[S.src] ? CLOUD[S.src].name : 'Meine PDFs';
    $('#btnUpload').hidden = S.src === 'nb' || S.src === 'dk';
    $('#search').placeholder = CLOUD[S.src] ? 'In diesem Ordner suchen …' : 'Suchen …';
    $('#btnUpload .up-lbl').textContent = S.src === 'od' ? 'Hochladen' : LOCAL ? 'PDF hinzufügen' : 'PDF hochladen';
  }
  document.querySelectorAll('#srcSwitch [data-src]').forEach((b) => {
    b.onclick = () => {
      const want = b.dataset.src;
      if (CLOUD[want] && !CLOUD[want].ok()) { CLOUD[want].settings(); return; }
      if (want === S.src) return;
      S.src = want; ls('src', want);
      S.search = ''; $('#search').value = '';
      renderLibrary();
      if (CLOUD[want]) cloudLoad(want, cloudPath(want));
      if (want === 'nb') loadBoards();
      if (want === 'dk') loadDecks();
      $('#library').scrollTop = 0;
    };
  });
  async function cloudLoad(pv, path) {
    const st = CL[pv];
    const token = ++st.token;
    st.err = '';
    if (S.src === pv && !V.path && !(st.data && st.data.path === path)) renderLibrary();
    try {
      const d = await apiJson(pv + 'ls', { params: { path } });
      if (token !== st.token) return;
      st.data = d;
    } catch (e) {
      if (token !== st.token) return;
      if (e.status === 502 && path) { goCloud(pv, ''); return; } // Ordner gibt es nicht mehr
      st.data = null;
      st.err = e.offline ? `${CLOUD[pv].name} ist offline nicht erreichbar. PDFs, die du schon einmal geöffnet hast, findest du unter „Meine PDFs“.` : e.message;
    }
    if (S.src === pv) renderLibrary();
  }
  const ncLoad = (path) => cloudLoad('nc', path);
  function goCloud(pv, p) {
    S[pv + 'Path'] = p; ls(pv + 'Path', p);
    S.search = ''; $('#search').value = '';
    CL[pv].data = null;
    renderLibrary();
    cloudLoad(pv, p);
    $('#library').scrollTop = 0;
  }
  async function cloudFetch(pv, f) {
    const r = await apiJson(pv + 'fetch', { method: 'POST', body: { path: f.path } });
    const loc = r.path || localOf(f);
    f.local = loc;
    const e = pdfCache.get(loc);
    if (e) { e.pdf.destroy(); pdfCache.delete(loc); }
    f.state = 'ok';
  }
  async function openCloud(pv, f) {
    const loc = localOf(f);
    if (f.state !== 'ok' || !fileMeta(loc)) {
      if (navigator.onLine === false) { toast(`Ohne Internet kann die Datei nicht aus ${CLOUD[pv].name} geladen werden.`); return; }
      toast(isOffice(f) ? 'Wird geladen und in PDF umgewandelt …' : f.state === 'update' ? `Neue Fassung wird aus ${CLOUD[pv].name} geladen …` : `Wird aus ${CLOUD[pv].name} geladen …`, 180000);
      try { await cloudFetch(pv, f); } catch (e) { toast(e.message, 7000); return; }
      await loadLibrary();
      $('#toast').hidden = true;
    }
    openDoc(localOf(f));
  }
  async function cloudTakeAll(pv, files) {
    let n = 0;
    for (const f of files) {
      toast(`Übernehme aus ${CLOUD[pv].name} … ${n + 1} von ${files.length}`, 180000);
      try { await cloudFetch(pv, f); n++; } catch (e) { toast(f.name + ': ' + e.message, 7000); }
    }
    await loadLibrary();
    for (const f of files) { if (f.state === 'ok') { try { await getPdfBytes(localOf(f)); } catch (e) { /* */ } } }
    toast(`${n} ${n === 1 ? 'Datei' : 'Dateien'} übernommen – auch offline verfügbar.`);
    cloudLoad(pv, cloudPath(pv));
  }
  async function cloudNewFolder(pv) {
    const cur = cloudPath(pv);
    const name = await askText(`Neuer Ordner in ${CLOUD[pv].name}`, cur ? `Unterordner in „${cur}“` : `Ordner in ${CLOUD[pv].name}`, '', 'Anlegen');
    if (!name) return;
    const path = (cur ? cur + '/' : '') + name.replace(/^\/+|\/+$/g, '');
    try { await apiJson(pv + 'mkdir', { method: 'POST', body: { path } }); goCloud(pv, path); } catch (e) { toast(e.message, 6000); }
  }

  function renderCloud(pv) {
    const P = CLOUD[pv], st = CL[pv], cur = cloudPath(pv);
    const list = S.libView === 'list';
    $('#recentBox').hidden = true;
    const c = P.cfg();
    // Pfadleiste
    const bar = $('#folders');
    bar.innerHTML = '';
    const crumbs = document.createElement('nav');
    crumbs.className = 'crumbs';
    crumbs.setAttribute('aria-label', P.name + '-Ordner');
    const parts = cur ? cur.split('/') : [];
    const mkCrumb = (label, val, last) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'crumb' + (last ? ' cur' : '');
      b.innerHTML = label;
      if (last) b.setAttribute('aria-current', 'page');
      b.onclick = () => goCloud(pv, val);
      crumbs.appendChild(b);
    };
    mkCrumb(`${P.svg}<span>${esc(P.root(c))}</span>`, '', !parts.length);
    parts.forEach((seg, i) => {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '›';
      crumbs.appendChild(sep);
      mkCrumb(esc(seg), parts.slice(0, i + 1).join('/'), i === parts.length - 1);
    });
    bar.appendChild(crumbs);
    const tools = document.createElement('div');
    tools.className = 'lib-tools';
    tools.innerHTML = (P.sync ? `<button type="button" class="text-btn" data-a="sync" title="Ganzen Ordner abgleichen"><svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9"/><path d="M18.5 3v4.5H14M5.5 21v-4.5H10"/></svg><span>Abgleichen</span></button>` : '') +
      `<button type="button" class="text-btn" data-a="mkdir">${FOLDER_SVG}<span>Neuer Ordner</span></button>
      <button type="button" class="icon-btn" data-a="cfg" aria-label="${P.name}-Einstellungen" title="${P.name}-Einstellungen"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></button>
      <div class="seg2 view-toggle" role="group" aria-label="Ansicht">
        <button type="button" data-v="grid" class="${list ? '' : 'active'}" aria-pressed="${!list}" aria-label="Kacheln" title="Kacheln"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg></button>
        <button type="button" data-v="list" class="${list ? 'active' : ''}" aria-pressed="${list}" aria-label="Liste" title="Liste"><svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg></button>
      </div>`;
    if (P.sync) tools.querySelector('[data-a=sync]').onclick = P.sync;
    tools.querySelector('[data-a=mkdir]').onclick = () => cloudNewFolder(pv);
    tools.querySelector('[data-a=cfg]').onclick = P.settings;
    tools.querySelectorAll('[data-v]').forEach((b) => { b.onclick = () => { S.libView = b.dataset.v; ls('libView', S.libView); renderLibrary(); }; });
    bar.appendChild(tools);

    const wrap = $('#files');
    wrap.innerHTML = '';
    wrap.classList.toggle('list', list);
    const empty = $('#libEmpty');
    const d = st.data && st.data.path === cur ? st.data : null;
    if (!d) {
      $('#folderBar').hidden = true;
      empty.hidden = false;
      empty.textContent = st.err || `${P.name} wird geladen …`;
      return;
    }
    const q = S.search.trim().toLowerCase();
    const folders = d.folders.filter((x) => !q || x.name.toLowerCase().includes(q));
    const files = d.files.filter((x) => !q || x.name.toLowerCase().includes(q));
    const cloudOnly = d.files.filter((x) => x.state !== 'ok');
    const word = (n) => (pv === 'od' ? (n === 1 ? 'Datei' : 'Dateien') : n === 1 ? 'PDF' : 'PDFs');
    $('#folderBar').hidden = false;
    $('#folderInfo').textContent = (folders.length ? `${folders.length} Ordner · ` : '') + `${files.length} ${word(files.length)}` +
      (cloudOnly.length ? ` · ${cloudOnly.length} noch nicht in PDF-Stift` : '') +
      (pv === 'nc' && c.last ? ` · abgeglichen ${fmtDate(c.last)}` : '') +
      (pv === 'od' && c.user ? ` · ${c.user}` : '');
    const ob = $('#btnFolderOffline');
    ob.hidden = !cloudOnly.length;
    ob.textContent = `Alle ${cloudOnly.length} übernehmen (auch offline)`;
    ob.onclick = () => cloudTakeAll(pv, cloudOnly);

    if (cur && !q) {
      const up = document.createElement('div');
      up.className = 'card folder up';
      const parent = parentOf(cur);
      up.innerHTML = `<button type="button" class="thumb" aria-label="Zurück"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
        <div class="meta"><div class="txt"><div class="n">Zurück</div><div class="d">${esc(parent || P.root(c))}</div></div></div>`;
      up.querySelector('.thumb').onclick = () => goCloud(pv, parent);
      up.querySelector('.txt').onclick = () => goCloud(pv, parent);
      wrap.appendChild(up);
    }
    for (const fo of folders) {
      const card = document.createElement('div');
      card.className = 'card folder';
      card.innerHTML = `<button type="button" class="thumb" aria-label="Ordner ${esc(fo.name)} öffnen">${FOLDER_SVG}</button>
        <div class="meta"><div class="txt"><div class="n">${esc(fo.name)}</div><div class="d">Ordner in ${P.name}</div></div></div>`;
      card.querySelector('.thumb').onclick = () => goCloud(pv, fo.path);
      card.querySelector('.txt').onclick = () => goCloud(pv, fo.path);
      wrap.appendChild(card);
    }
    for (const f of files) {
      const loc = localOf(f);
      const meta = f.state === 'ok' ? fileMeta(loc) : null;
      const card = document.createElement('div');
      card.className = 'card';
      const hasNotes = meta && (meta.notesMtime > 0);
      const badges = (isOffice(f) ? `<span class="badge office">${esc(f.ext.toUpperCase())} → PDF</span>` : '') +
        (f.state === 'cloud' ? `<span class="badge cloud">Nur in ${P.name}</span>` : '') +
        (f.state === 'update' ? '<span class="badge cloud">Neue Fassung</span>' : '') +
        (S.offline.has(loc) && f.state === 'ok' ? '<span class="badge offline">Offline</span>' : '') +
        (hasNotes ? '<span class="badge notes">Notizen</span>' : '');
      card.innerHTML = `
        <button type="button" class="thumb" aria-label="${esc(f.name)} öffnen">
          ${meta ? '<svg class="ph" viewBox="0 0 24 24" style="width:40px;height:40px"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/></svg>' : `<span class="ph cloud-ph">${P.svg}</span>`}
          <span class="badges">${badges}</span>
        </button>
        <div class="meta">
          <div class="txt"><div class="n" title="${esc(f.path)}">${esc(f.name)}</div>
          <div class="d">${fmtSize(f.size)} · ${fmtDate(f.mtime)}</div></div>
          <span class="lbadges">${badges}</span>
        </div>`;
      card.querySelector('.thumb').onclick = () => openCloud(pv, f);
      card.querySelector('.txt').onclick = () => openCloud(pv, f);
      wrap.appendChild(card);
      if (meta) {
        const th = card.querySelector('.thumb');
        th.dataset.path = loc;
        if (thumbMem.has(loc + '|' + meta.mtime)) thumb(meta, th); else thumbIO.observe(th);
      }
    }
    empty.hidden = files.length > 0 || folders.length > 0;
    empty.textContent = q ? 'Nichts gefunden.' : pv === 'od'
      ? 'In diesem OneDrive-Ordner liegen keine PDFs, Word- oder PowerPoint-Dateien.'
      : 'Dieser Nextcloud-Ordner ist leer. Lade PDFs hoch – sie landen direkt in Nextcloud.';
  }

  // ---- OneDrive verbinden (Microsoft-Anmeldung über Gerätecode – kein Passwort in PDF-Stift)
  const OD = { poll: 0 };
  async function openOdDlg() {
    let od = (S.library && S.library.od) || {};
    try { od = await apiJson('odget'); if (S.library) S.library.od = od; } catch (e) { /* offline */ }
    $('#odClient').value = od.clientId || '';
    $('#odTenant').value = od.tenant && od.tenant !== 'common' ? od.tenant : '';
    $('#odFolder').value = od.folder || '';
    $('#odCode').hidden = true;
    $('#odRemove').hidden = !od.connected;
    $('#odMsg').textContent = od.connected ? `Verbunden als ${od.user || 'Microsoft-Konto'}.` : '';
    $('#odLogin').textContent = od.connected ? 'Speichern' : 'Bei Microsoft anmelden';
    $('#odDlg').showModal();
  }
  function stopOdPoll() { clearTimeout(OD.poll); OD.poll = 0; }
  $('#odDlg').addEventListener('close', stopOdPoll);
  $('#odLogin').onclick = async () => {
    stopOdPoll();
    $('#odMsg').textContent = 'Speichere …';
    try {
      const od = await apiJson('odset', { method: 'POST', body: { clientId: $('#odClient').value.trim(), tenant: $('#odTenant').value.trim() || 'common', folder: $('#odFolder').value.trim() } });
      if (S.library) S.library.od = od;
      if (od.connected) { $('#odDlg').close(); S.src = 'od'; ls('src', 'od'); goCloud('od', ''); return; }
      const r = await apiJson('odlogin', { method: 'POST' });
      $('#odUserCode').textContent = r.userCode;
      $('#odLink').href = r.url;
      $('#odCode').hidden = false;
      $('#odMsg').textContent = 'Warte auf deine Anmeldung bei Microsoft …';
      const tick = async () => {
        try {
          const p = await apiJson('odpoll', { method: 'POST' });
          if (p.status === 'ok') {
            stopOdPoll();
            $('#odDlg').close();
            await loadLibrary();
            toast(`OneDrive verbunden${p.user ? ' – ' + p.user : ''}.`);
            S.src = 'od'; ls('src', 'od');
            goCloud('od', '');
            return;
          }
          if (p.status === 'error') { stopOdPoll(); $('#odCode').hidden = true; $('#odMsg').textContent = p.error || 'Die Anmeldung hat nicht geklappt.'; return; }
        } catch (e) { /* kurz offline: weiter versuchen */ }
        OD.poll = setTimeout(tick, Math.max(2, r.interval || 5) * 1000);
      };
      OD.poll = setTimeout(tick, Math.max(2, r.interval || 5) * 1000);
    } catch (e) {
      $('#odMsg').textContent = e.offline ? 'Keine Verbindung zum Server.' : e.message;
    }
  };
  $('#odCopy').onclick = () => { navigator.clipboard && navigator.clipboard.writeText($('#odUserCode').textContent).then(() => toast('Code kopiert.')).catch(() => {}); };
  $('#odRemove').onclick = async () => {
    stopOdPoll();
    try { const od = await apiJson('oddel', { method: 'POST' }); if (S.library) S.library.od = od; } catch (e) { /* */ }
    if (S.src === 'od') { S.src = 'local'; ls('src', 'local'); }
    $('#odDlg').close();
    toast('OneDrive abgemeldet. Bereits übernommene Dateien bleiben in PDF-Stift.');
    renderLibrary();
  };

  // Neuer Ordner / Verschieben
  function askText(title, text, value, yes) {
    return new Promise((res) => {
      const d = $('#askDlg');
      $('#askTitle').textContent = title;
      $('#askText').textContent = text;
      $('#askInput').value = value;
      $('#askYes').textContent = yes;
      $('#askMsg').textContent = '';
      d.returnValue = '';
      d.addEventListener('close', () => res(d.returnValue === 'yes' ? $('#askInput').value.trim() : null), { once: true });
      d.showModal();
      setTimeout(() => { const i = $('#askInput'); i.focus(); i.select(); }, 30);
    });
  }
  async function newFolder() {
    if (navigator.onLine === false || S.libraryOffline) { toast('Ordner anlegen geht nur mit Internetverbindung.'); return; }
    const name = await askText('Neuer Ordner', S.folder ? `Unterordner in „${S.folder}“` : 'Ordner auf oberster Ebene', '', 'Anlegen');
    if (!name) return;
    const path = (S.folder ? S.folder + '/' : '') + name.replace(/^\/+|\/+$/g, '');
    try {
      await apiJson('mkdir', { method: 'POST', body: { path } });
      await loadLibrary();
      goFolder(path);
    } catch (e) { toast(e.message); }
  }
  async function moveFile(f) {
    if (navigator.onLine === false || S.libraryOffline) { toast('Verschieben geht nur mit Internetverbindung.'); return; }
    if (Notes.pending.get(f.path) && (Notes.pending.get(f.path).add.size || Notes.pending.get(f.path).del.size)) { toast('Bitte warten, bis die Notizen dieser PDF gespeichert sind.'); return; }
    const to = await askText('Verschieben oder umbenennen', 'Ordner/Dateiname – z. B. „Mikro/2026/VL05.pdf“. Unterordner werden bei Bedarf angelegt.', f.path, 'Verschieben');
    if (!to || to === f.path) return;
    try {
      const r = await apiJson('move', { method: 'POST', body: { from: f.path, to } });
      // Kopie auf dem Gerät mitnehmen (kein neues Herunterladen), alte Adresse verwerfen
      const rec = await DB.get('pdfs', f.path);
      if (rec && r.mtime !== undefined) { try { await DB.put('pdfs', r.path, { ...rec, mtime: r.mtime, size: r.size ?? rec.size }); S.offline.add(r.path); } catch (e) { /* */ } }
      await Promise.all([DB.del('pdfs', f.path), DB.del('notes', f.path), DB.del('queue', f.path)]);
      S.offline.delete(f.path);
      Notes.docs.delete(f.path);
      Notes.pending.delete(f.path);
      const e = pdfCache.get(f.path);
      if (e) { e.pdf.destroy(); pdfCache.delete(f.path); }
      S.tabs.forEach((t) => { if (t.path === f.path) t.path = r.path; });
      if (S.active === f.path) S.active = r.path;
      saveTabs();
      await loadLibrary();
      goFolder(r.path.includes('/') ? r.path.slice(0, r.path.lastIndexOf('/')) : '');
      toast('Verschoben nach „' + r.path + '“.');
    } catch (err) { toast(err.message, 6000); }
  }

  let openMenu = null;
  function closeMenus() { if (openMenu) { openMenu.remove(); openMenu = null; } $('#menu').hidden = true; $('#menuBtn').setAttribute('aria-expanded', 'false'); }
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.menu') && !e.target.closest('.more') && !e.target.closest('#menuBtn')) closeMenus();
  });
  function cardMenu(wrap, f) {
    closeMenus();
    const m = document.createElement('div');
    m.className = 'menu';
    const off = S.offline.has(f.path);
    m.innerHTML = `<button type="button" data-a="open">Öffnen</button>
      <button type="button" data-a="dl">Original herunterladen</button>
      <button type="button" data-a="mv">Verschieben / umbenennen …</button>
      <button type="button" data-a="tags">Schlagwörter …</button>
      ${LOCAL ? '' : `<button type="button" data-a="off">${off ? 'Offline-Kopie entfernen' : 'Offline verfügbar machen'}</button>`}
      <button type="button" data-a="ocr">Text erkennen (Scan durchsuchbar machen)</button>`;
    m.onclick = async (e) => {
      const a = e.target.dataset.a;
      if (!a) return;
      closeMenus();
      if (a === 'open') openDoc(f.path);
      if (a === 'dl') downloadOriginal(f.path);
      if (a === 'mv') moveFile(f);
      if (a === 'tags') editTags(f.path);
      if (a === 'ocr') ocrQueue([f.path]);
      if (a === 'off') {
        if (off) {
          await DB.del('pdfs', f.path);
          S.offline.delete(f.path);
          toast('Offline-Kopie entfernt.');
        } else {
          try { await getPdfBytes(f.path); toast('Jetzt offline verfügbar.'); } catch (err) { toast(err.message); }
        }
        renderLibrary();
      }
    };
    wrap.appendChild(m);
    openMenu = m;
  }

  // ---- Vorschaubilder: einmal erzeugt, dann auf dem Server und auf dem Gerät zwischengespeichert
  const thumbMem = new Map();
  let thumbChain = Promise.resolve();
  const thumbIO = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      thumbIO.unobserve(en.target);
      const f = S.library && S.library.files.find((x) => x.path === en.target.dataset.path);
      if (f) thumb(f, en.target);
    }
  }, { rootMargin: '300px' });
  async function renderThumbFromPdf(pdf) {
    const page = await pdf.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 360 / vp1.width });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ annotationMode: AM, canvasContext: ctx, viewport: vp }).promise;
    return c.toDataURL('image/jpeg', 0.72);
  }
  function blobToDataUrl(blob) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  }
  function storeThumb(f, url, upload) {
    const key = f.path + '|' + f.mtime;
    thumbMem.set(key, url);
    DB.put('kv', 'thumb:' + key, url).catch(() => {});
    if (upload && navigator.onLine !== false) {
      api('thumb', { method: 'POST', body: { path: f.path, data: url } }).then(() => { f.thumb = true; }).catch(() => {});
    }
  }
  function thumb(f, el) {
    const key = f.path + '|' + f.mtime;
    const put = (url) => {
      if (!el.isConnected) return;
      const ph = el.querySelector('.ph');
      if (ph) ph.remove();
      if (el.querySelector('img')) return;
      const img = document.createElement('img');
      img.src = url; img.alt = '';
      img.style.cssText = 'max-width:100%;max-height:100%;display:block';
      el.prepend(img);
    };
    if (thumbMem.has(key)) { put(thumbMem.get(key)); return; }
    thumbChain = thumbChain.then(async () => {
      if (!el.isConnected || $('#library').hidden) return; // während eine PDF offen ist, nicht um die Leitung konkurrieren
      try {
        let url = await DB.get('kv', 'thumb:' + key);
        if (url) { thumbMem.set(key, url); put(url); return; }
        const online = navigator.onLine !== false && !S.libraryOffline;
        if (f.thumb && online) {
          // fertiges Vorschaubild vom Server (vom Browser zwischengespeichert)
          const r = await fetch(`${API}?a=thumb&path=${encodeURIComponent(f.path)}&m=${f.mtime}`, { credentials: 'same-origin' });
          if (r.ok) { url = await blobToDataUrl(await r.blob()); storeThumb(f, url, false); put(url); return; }
        }
        const rec = await DB.get('pdfs', f.path);
        let pdf;
        if (rec) {
          pdf = await pdfjsLib.getDocument({ data: new Uint8Array(rec.bytes.slice(0)), isEvalSupported: false }).promise;
        } else if (online && f.size < 8 * 1048576 && !V.loading && !V.path && !/[?&]open=/.test(location.search)) {
          // nur den Anfang der PDF laden (Teilabruf), nicht die ganze Datei – bei großen Dateien nicht: die Leitung bleibt frei
          pdf = await pdfjsLib.getDocument({
            url: `${API}?a=pdf&path=${encodeURIComponent(f.path)}`, disableAutoFetch: true, disableStream: true,
            rangeChunkSize: 65536, isEvalSupported: false,
          }).promise;
        } else return;
        url = await renderThumbFromPdf(pdf);
        pdf.destroy();
        storeThumb(f, url, true);
        put(url);
      } catch (e) { /* Vorschau ist nur Komfort */ }
    });
  }

  $('#search').addEventListener('input', (e) => { S.search = e.target.value; renderLibrary(); ftSchedule(); });
  const folderOffline = async () => {
    const files = folderFiles(S.folder).filter((f) => !S.offline.has(f.path));
    let n = 0;
    for (const f of files) {
      try { await getPdfBytes(f.path); n++; toast(`${n} von ${files.length} offline gespeichert …`, 60000); } catch (e) { toast('Abgebrochen: ' + e.message); break; }
    }
    if (n === files.length) toast(`${n} ${n === 1 ? 'PDF ist' : 'PDFs sind'} jetzt offline verfügbar.`);
    renderLibrary();
  };
  $('#btnLogout').onclick = async () => {
    if (pendingCount()) { toast('Bitte warten, bis alle Notizen abgeglichen sind.'); return; }
    try { await api('logout', { method: 'POST' }); } catch (e) { /* egal */ }
    showAuth(false);
  };

  // Hochladen
  const OFFICE_ACCEPT = '.doc,.docx,.odt,.rtf,.ppt,.pptx,.pps,.ppsx,.odp,.xls,.xlsx,.ods';
  $('#btnUpload').onclick = () => {
    if (navigator.onLine === false) { toast('Hochladen geht nur mit Internetverbindung.'); return; }
    S.upTo = CLOUD[S.src] ? S.src : 'local';
    const caps = (S.library && S.library.caps) || {};
    // Word/PowerPoint: in OneDrive immer (Microsoft wandelt um), sonst nur, wenn der Server umwandeln kann
    const office = S.upTo === 'od' || (S.upTo === 'local' && (caps.office || !!(window.pdfstiftWin && window.pdfstiftWin.officeToPdf)));
    if (LOCAL) $('#upGo').textContent = 'Hinzufügen';
    $('#upTitle').textContent = S.upTo === 'local' ? (LOCAL ? 'Dateien hinzufügen' : 'Dateien hochladen') : `In ${CLOUD[S.upTo].name} hochladen`;
    $('#upFolder').value = S.upTo === 'local' ? S.folder : cloudPath(S.upTo);
    $('#upFiles').accept = 'application/pdf,.pdf' + (S.upTo === 'local' ? ',image/*' : '') + (office ? ',' + OFFICE_ACCEPT : '');
    $('#upImgRow').hidden = true;
    $('#upFiles').value = '';
    $('#upHint').textContent = S.upTo === 'od'
      ? 'PDF, Word oder PowerPoint. Office-Dateien bleiben in OneDrive unverändert; beim Öffnen macht Microsoft eine PDF daraus.'
      : S.upTo === 'nc' ? 'Nur PDF-Dateien.'
        : office ? `PDF, Word oder PowerPoint – Word und PowerPoint werden automatisch in PDF umgewandelt (${caps.soffice ? 'mit LibreOffice auf dem Server' : 'über OneDrive'}).`
          : 'Nur PDF-Dateien. Für Word und PowerPoint: OneDrive verbinden (dann wandelt Microsoft um) oder LibreOffice auf dem Server installieren.';
    $('#upMsg').textContent = '';
    $('#uploadDlg').showModal();
  };
  const isImg = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|heic|webp|gif)$/i.test(f.name);
  $('#upFiles').addEventListener('change', () => { $('#upImgRow').hidden = ![...$('#upFiles').files].filter(isImg).length || $('#upFiles').files.length < 2; });
  // Hochladen (Dialog und Hineinziehen): Bilder → PDF hier, Word/Excel/PowerPoint in der Windows-App mit Microsoft Office, sonst auf dem Server
  const OFF_RE = /\.(docx?|docm|dotx?|rtf|odt|pptx?|pptm|ppsx?|potx?|odp|xlsx?|xlsm|xlsb|ods)$/i;
  async function uploadCore(files, folder, to, say, oneImg) {
    files = [...files];
    const fd = new FormData();
    fd.append('folder', folder);
    const notes = [], localErrs = [];
    const imgs = files.filter(isImg);
    if (imgs.length && to === 'local') {
      say('Bilder werden zu PDF …');
      const groups = oneImg ? [imgs] : imgs.map((f) => [f]);
      for (const g of groups) fd.append('files[]', new Blob([await imagesToPdf(g)], { type: 'application/pdf' }), g[0].name.replace(/\.[^.]+$/, '') + '.pdf');
    }
    const local = new Set();
    const offs = files.filter((f) => OFF_RE.test(f.name));
    if (offs.length && window.pdfstiftWin && window.pdfstiftWin.officeToPdf && to === 'local') {
      const copies = [];
      for (const [k, f] of offs.entries()) {
        say(`„${f.name}“ wird mit Microsoft Office in PDF umgewandelt …${offs.length > 1 ? ` (${k + 1} von ${offs.length})` : ''}`);
        const p = window.pdfstiftWin.pathFor(f);
        const tOff = performance.now();
        const r = p ? await window.pdfstiftWin.officeToPdf(p, { nextTo: !!SET.pdfNextTo }) : { ok: false, error: 'Speicherort der Datei unbekannt' };
        const ext = (f.name.split('.').pop() || '').toLowerCase();
        if (r && r.ok) { track('tool', 'Office → PDF (Windows)'); track('perf', 'Office → PDF (Windows)', performance.now() - tOff, `${ext}, ${(f.size / 1048576).toFixed(1)} MB`); }
        else track('err', 'Office → PDF (Windows) fehlgeschlagen', null, `${ext}: ${(r && r.error) || '?'}`);
        if (r && r.ok) { fd.append('files[]', new Blob([r.data], { type: 'application/pdf' }), r.name); local.add(f); if (r.copy) copies.push(r.copy); }
        else localErrs.push(`${f.name}: Microsoft Office konnte nicht umwandeln (${(r && r.error) || 'unbekannt'})`);
      }
      if (copies.length) notes.push(`Die PDF liegt auch neben dem Original (${copies.length === 1 ? copies[0] : copies.length + ' Dateien'}).`);
    }
    for (const f of files) if (!local.has(f) && (!imgs.includes(f) || to !== 'local')) fd.append('files[]', f, f.name);
    const hasOffice = files.some((f) => !/\.pdf$/i.test(f.name) && !local.has(f) && !imgs.includes(f));
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', API + '?a=' + (to === 'local' ? 'upload' : to + 'upload'));
      xhr.setRequestHeader('X-PDFStift', '1');
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const pc = Math.round(e.loaded / e.total * 100);
        say(pc < 100 ? `Lädt hoch … ${pc} %` : hasOffice && to === 'local' ? 'Wandelt in PDF um … (kann bei großen Präsentationen eine Minute dauern)' : 'Wird gespeichert …');
      };
      xhr.onload = () => {
        track('perf', 'Hochladen', performance.now() - tUp, `${files.length} Datei(en), ${(files.reduce((a, f) => a + f.size, 0) / 1048576).toFixed(1)} MB`);
        let res = {};
        try { res = JSON.parse(xhr.responseText); } catch (e) { /* */ }
        // Fehler aus Office zuerst nennen – die Server-Meldung ist dann nur die zweite Wahl
        const errs = (res.errors || []).map((e) => { const le = localErrs.find((l) => e.startsWith(l.split(':')[0])); return le || e; });
        resolve({ ok: xhr.status === 200, status: xhr.status, saved: res.saved || [], errs, error: res.error, notes });
      };
      xhr.onerror = () => resolve({ ok: false, status: 0, saved: [], errs: [], error: 'Keine Verbindung zum Server.', notes });
      say('Lädt hoch …');
      const tUp = performance.now();
      xhr.send(fd);
    });
  }
  $('#upGo').onclick = async () => {
    const files = $('#upFiles').files;
    if (!files.length) { $('#upMsg').textContent = 'Bitte mindestens eine Datei auswählen.'; return; }
    const to = S.upTo || 'local';
    track('tool', 'Hochladen');
    $('#upGo').disabled = true;
    let r;
    try { r = await uploadCore(files, $('#upFolder').value.trim(), to, (t) => { $('#upMsg').textContent = t; }, $('#upImgOne').checked); }
    catch (err) { $('#upGo').disabled = false; $('#upMsg').textContent = 'Eine Datei ließ sich nicht lesen: ' + err.message; return; }
    $('#upGo').disabled = false;
    if (!r.ok) { $('#upMsg').textContent = r.error || 'Hochladen fehlgeschlagen (' + r.status + '). Ist die Datei zu groß für den Server?'; return; }
    const n = r.saved.length;
    if (!n && r.errs.length) { $('#upMsg').textContent = r.errs.join(' · '); return; }
    $('#uploadDlg').close();
    const where = to === 'local' ? '' : ' – in ' + CLOUD[to].name;
    toast(n ? `${n} ${n === 1 ? 'Datei' : 'Dateien'} hochgeladen${where}.` + (r.notes.length ? ' ' + r.notes.join(' ') : '') + (r.errs.length ? ' Probleme: ' + r.errs.join('; ') : '')
      : 'Es wurde nichts gespeichert.', r.errs.length || r.notes.length ? 8000 : 3200);
    const one = S.openAfterUpload && to === 'local' && n === 1 ? r.saved[0] : null;
    S.openAfterUpload = false;
    loadLibrary().then(() => { if (one && fileMeta(one)) openDoc(one); });
    if (to !== 'local') cloudLoad(to, cloudPath(to));
  };
  // Hineingezogene Dateien: ohne Rückfrage in den eingestellten Ordner (Standard „Dokumente“), eine einzelne gleich öffnen
  async function dropUpload(files) {
    if (navigator.onLine === false) { toast('Hochladen geht nur mit Internetverbindung.'); return; }
    track('tool', 'Hineingezogen');
    const folder = (SET.dropFolder || DROP0).trim().replace(/^\/+|\/+$/g, '');
    let r;
    try { r = await uploadCore(files, folder, 'local', (t) => toast(t, 120000), false); }
    catch (err) { toast('Eine Datei ließ sich nicht lesen: ' + err.message, 7000); return; }
    if (!r.ok) { toast(r.error || 'Hochladen fehlgeschlagen (' + r.status + ').', 8000); return; }
    const n = r.saved.length;
    if (!n) { toast(r.errs.length ? r.errs.join(' · ') : 'Es wurde nichts gespeichert.', 12000); return; }
    toast(`${n === 1 ? `„${basename(r.saved[0]).replace(/\.pdf$/i, '')}“ liegt` : `${n} Dateien liegen`} jetzt im Ordner „${folder || 'Bibliothek'}“.` + (r.notes.length ? ' ' + r.notes.join(' ') : '') + (r.errs.length ? ' Probleme: ' + r.errs.join('; ') : ''), r.errs.length ? 12000 : 4500);
    await loadLibrary();
    if (n === 1 && fileMeta(r.saved[0])) openDoc(r.saved[0]);
    else if (!V.path) goFolder(folder);
  }

  // ------------------------------------------------------------------ Tabs
  function renderTabs() {
    const nav = $('#tabs');
    nav.innerHTML = '';
    // zwei Dokumente: der Reiter der aktiven Hälfte ist hervorgehoben, der der anderen Hälfte leicht
    const rightAct = !EMBED && SPLIT.frame && SPLIT.act === 'r' && SPLIT.path;
    const actPath = rightAct ? SPLIT.path : S.active;
    const sidePath = SPLIT.frame ? (rightAct ? S.active : SPLIT.path) : null;
    for (const t of S.tabs) {
      const div = document.createElement('div');
      div.className = 'tab' + (t.path === actPath ? ' active' : t.path === sidePath ? ' side' : '');
      div.dataset.path = t.path;
      if (window.pdfstiftWin && window.pdfstiftWin.dragPrep && !isBoard(t.path)) { div.draggable = true; div.title = 'Herausziehen: in den Explorer, auf den Desktop oder in eine Mail (mit Notizen)'; }
      div.setAttribute('role', 'tab');
      div.setAttribute('aria-selected', t.path === S.active ? 'true' : 'false');
      div.innerHTML = `<button type="button" class="name" title="${esc(isBoard(t.path) ? t.path.slice(4) : isDeck(t.path) ? docTitle(t.path) : t.path)}">${isBoard(t.path) ? NB_TAB : isDeck(t.path) ? DK_TAB : ''}${esc(docTitle(t.path))}</button>
        <button type="button" class="close" aria-label="${esc(docTitle(t.path))} schließen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
      div.querySelector('.name').onclick = () => tabClick(t.path);
      div.querySelector('.close').onclick = () => closeTab(t.path);
      if (!EMBED) div.addEventListener('contextmenu', (e) => { e.preventDefault(); closeMenus(); const m = document.createElement('div'); m.className = 'menu tab-menu'; m.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px`; m.innerHTML = `<button type="button" data-a="split">Rechts daneben öffnen</button><button type="button" data-a="close">Schließen</button>`; m.onclick = (ev) => { const b = ev.target.closest('[data-a]'); if (!b) return; closeMenus(); if (b.dataset.a === 'close') closeTab(t.path); else if (t.path === S.active) { const o = S.tabs.find((x) => x.path !== t.path); if (o) { openDoc(o.path); setTimeout(() => splitOpen(t.path), 250); } else toast('Bitte erst ein zweites Dokument öffnen.'); } else splitOpen(t.path); }; document.body.appendChild(m); openMenu = m; });
      nav.appendChild(div);
      if (t.path === S.active) requestAnimationFrame(() => div.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    }
    $('#btnLib').classList.toggle('active', !S.active);
  }
  // Reiter angeklickt: bei zwei Dokumenten kommt es in die gerade aktive Hälfte
  function tabClick(path) {
    if (!EMBED && SPLIT.frame && SPLIT.act === 'r') {
      closeMenus();
      if (path === SPLIT.path) return;
      if (path === S.active) { splitSwap(); return; }
      splitLoad(path);
      renderTabs();
      return;
    }
    openDoc(path);
  }
  function openDoc(path) {
    closeMenus();
    if (EMBED) { try { window.parent.PDFSTIFT_MAIN.paneDoc(path); } catch (e) { /* */ } }
    else if (SPLIT.path === path && SPLIT.frame) { const pn = splitPane(); if (pn) pn.lib(); SPLIT.path = null; ls('splitPath', '#'); setTimeout(splitHead, 0); toast('Diese PDF war rechts offen – sie ist jetzt hier.'); }
    const rec = (ls('recent') || []).filter((r) => r.path !== path);
    rec.unshift({ path, t: Date.now() });
    ls('recent', rec.slice(0, 12));
    if (!S.tabs.find((t) => t.path === path)) S.tabs.push({ path, zoom: 1, scroll: 0 });
    S.active = path;
    saveTabs();
    renderTabs();
    showDoc(path);
    if (SPLIT.frame) splitHead();
  }
  function closeTab(path) {
    const i = S.tabs.findIndex((t) => t.path === path);
    if (i < 0) return;
    if (S.active === path) saveViewState();
    S.tabs.splice(i, 1);
    const e = pdfCache.get(path);
    if (e && S.active !== path) { e.pdf.destroy(); pdfCache.delete(path); }
    if (S.active === path) {
      const next = S.tabs[i] || S.tabs[i - 1];
      if (next) { openDoc(next.path); return; }
      showLibrary();
    }
    saveTabs();
    renderTabs();
  }
  function showLibrary() {
    document.title = 'PDF-Stift';
    setTimeout(() => thPlace(), 0);
    if (V.board) leaveBoard();
    if (V.deck) leaveDeck();
    if (S.src === 'dk') loadDecks();
    setFocusMode(false);
    $('#fsBtn').hidden = true;
    if (CLOUD[S.src]) cloudLoad(S.src, cloudPath(S.src));
    if (S.src === 'nb') loadBoards();
    if (editor) commitEditor(false);
    clearSel();
    autoBurn(V.path);
    saveViewState();
    if (V.path) snapSave(V.path);
    S.active = null;
    saveTabs();
    unloadViewer();
    setPresent(false);
    closeSearch();
    $('#presentBtn').hidden = true;
    $('#viewer').hidden = true;
    $('#toolbar').hidden = true;
    $('#pageBadge').hidden = true;
    $('#library').hidden = false;
    renderTabs();
    loadLibrary();
  }
  $('#btnLib').onclick = showLibrary;

  // ------------------------------------------------------------------ Ansicht
  const viewer = $('#viewer');
  const pagesEl = $('#pages');
  const V = { path: null, token: 0, pages: [], zoom: 1, io: null, visible: new Set(), doc: null };
  const history = new Map(); // path -> { undo: [], redo: [] }
  const hist = () => { let h = history.get(V.path); if (!h) { h = { undo: [], redo: [] }; history.set(V.path, h); } return h; };

  function saveViewState() {
    if (!V.path || PROMPTER) return;
    const t = S.tabs.find((x) => x.path === V.path);
    if (t) {
      t.zoom = V.zoom;
      t.scroll = viewer.scrollHeight ? viewer.scrollTop / viewer.scrollHeight : 0;
      saveTabs();
    }
  }
  // ---- Schneller Reiterwechsel: beim Verlassen ein Bild der sichtbaren Ansicht auf der Festplatte ablegen (Cache-Speicher des
  // Browsers, nicht im Arbeitsspeicher). Beim Zurückkehren erscheint es sofort; die PDF wird dahinter scharf aufgebaut.
  const SNAP = { ov: null, url: '', path: '', t: 0 };
  const snapKey = (path) => location.pathname.replace(/[^/]*$/, '') + '__snap/' + encodeURIComponent(path);
  function snapSave(path) {
    try {
      if (!('caches' in window) || !V.pages.length || V.viewRot || isMirror()) return;
      const vr = viewer.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = Math.round(vr.width * dpr), H = Math.round(vr.height * dpr);
      if (W < 80 || H < 80) return;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d');
      x.fillStyle = getComputedStyle(viewer).backgroundColor || '#e9ecf2'; x.fillRect(0, 0, W, H);
      let n = 0;
      for (const P of V.visible) {
        const pr = P.el.getBoundingClientRect();
        if (pr.bottom < vr.top || pr.top > vr.bottom || pr.right < vr.left || pr.left > vr.right) continue;
        const pc = P.el.querySelector('canvas.pdf');
        if (!pc) continue; // noch nicht gezeichnet: diese Stelle bleibt im Bild leer
        const dx = (pr.left - vr.left) * dpr, dy = (pr.top - vr.top) * dpr, dw = pr.width * dpr, dh = pr.height * dpr;
        x.drawImage(pc, dx, dy, dw, dh);
        if (P.ink && !P.ink.hidden) x.drawImage(P.ink, dx, dy, dw, dh);
        n++;
      }
      if (!n) return;
      const w0 = Math.round(vr.width), h0 = Math.round(vr.height);
      c.toBlob((blob) => {
        if (!blob) return;
        caches.open('pdfstift-snap').then((ca) => ca.put(snapKey(path), new Response(blob, { headers: { 'Content-Type': blob.type, 'X-W': String(w0), 'X-H': String(h0) } }))).catch(() => {});
      }, 'image/webp', 0.82);
    } catch (e) { /* ohne Bild weiter */ }
  }
  async function snapShow(path) {
    snapHide();
    try {
      if (!('caches' in window) || V.viewRot || isMirror()) return;
      const r = await (await caches.open('pdfstift-snap')).match(snapKey(path));
      if (!r || V.path !== path || !V.loading && V.pages.some((P) => P.el.querySelector('canvas.pdf'))) return;
      const vr = viewer.getBoundingClientRect();
      if (Math.abs(+r.headers.get('X-W') - Math.round(vr.width)) > 2 || Math.abs(+r.headers.get('X-H') - Math.round(vr.height)) > 2) return; // Fenster anders groß
      const url = URL.createObjectURL(await r.blob());
      if (V.path !== path) { URL.revokeObjectURL(url); return; }
      const img = document.createElement('img');
      img.className = 'snap-ov'; img.alt = ''; img.src = url;
      img.style.cssText = `position:fixed;left:${vr.left}px;top:${vr.top}px;width:${vr.width}px;height:${vr.height}px`;
      document.body.appendChild(img);
      Object.assign(SNAP, { ov: img, url, path });
      SNAP.t = setTimeout(snapHide, 8000);
      snapCheck();
    } catch (e) { /* ohne Bild weiter */ }
  }
  function snapHide() {
    clearTimeout(SNAP.t);
    if (SNAP.ov) { const o = SNAP.ov, u = SNAP.url; o.classList.add('out'); setTimeout(() => { o.remove(); URL.revokeObjectURL(u); }, 160); }
    SNAP.ov = null;
  }
  // sobald die sichtbaren Seiten echt gezeichnet sind, verschwindet das Bild
  function snapCheck() {
    if (!SNAP.ov) return;
    if (V.path !== SNAP.path) { snapHide(); return; }
    if (V.loading || !V.pages.length) return;
    const vr = viewer.getBoundingClientRect();
    const inView = V.pages.filter((P) => { const pr = P.el.getBoundingClientRect(); return pr.bottom > vr.top && pr.top < vr.bottom && pr.right > vr.left && pr.left < vr.right; });
    if (inView.length && inView.every((P) => P.el.querySelector('canvas.pdf'))) snapHide();
  }
  for (const ev of ['wheel', 'pointerdown', 'keydown']) viewer.addEventListener(ev, () => { if (SNAP.ov) snapHide(); }, { passive: true });

  function unloadViewer() {
    obDeactivate(); obPlacing(null);
    snapHide();
    if (V.io) V.io.disconnect();
    for (const P of V.pages) if (P.task) P.task.cancel();
    V.pages = [];
    V.visible.clear();
    RQ.list.clear();
    V.path = null;
    V.doc = null;
    pagesEl.innerHTML = '';
  }

  async function showDoc(path, reloading) {
    document.title = docTitle(path) + ' – PDF-Stift';
    if (path !== V.path) V.viewRot = 0;
    if (typeof closeNote === 'function') closeNote(true);
    if (isBoard(path)) return showBoard(path);
    if (isDeck(path)) return showDeck(path);
    if (V.board) leaveBoard();
    if (V.deck) leaveDeck();
    if (editor) commitEditor(false);
    clearSel();
    if (V.path && V.path !== path) {
      // Notizen einbrennen erst, wenn die neue PDF steht – sonst rechnen beide gleichzeitig und der Wechsel dauert
      const left = V.path;
      setTimeout(() => { if (V.path !== left) autoBurn(left); }, 4000);
      saveViewState();
      snapSave(left);
    }
    const token = ++V.token;
    const tOpen = performance.now();
    unloadViewer();
    V.path = path;
    $('#library').hidden = true;
    $('#viewer').hidden = false;
    $('#toolbar').hidden = false;
    pagesEl.innerHTML = '<p class="empty">PDF wird geladen …</p>';
    let entry, doc;
    V.loading = true;
    snapShow(path);
    try {
      entry = await loadPdf(path);
      doc = await localDoc(path);
      V.loading = false;
    } catch (e) {
      V.loading = false;
      if (token !== V.token) return;
      snapHide();
      pagesEl.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = e.offline
        ? 'Diese PDF ist noch nicht offline verfügbar. Öffne sie einmal mit Internetverbindung, dann geht es auch offline.'
        : 'Die PDF konnte nicht geöffnet werden: ' + e.message;
      pagesEl.appendChild(p);
      return;
    }
    if (token !== V.token) return;
    V.doc = doc;
    const pdf = entry.pdf;
    const meta = fileMeta(path);
    if (meta && !meta.thumb && !thumbMem.has(meta.path + '|' + meta.mtime)) {
      renderThumbFromPdf(pdf).then((url) => storeThumb(meta, url, true)).catch(() => {});
    }
    closeSearch();
    $('#presentBtn').hidden = false;
    $('#fsBtn').hidden = false;
    // Große PDFs: nur die ersten Seiten sofort lesen, die übrigen im Hintergrund (Seitengröße bis dahin wie die vorige Seite)
    const tab = S.tabs.find((t) => t.path === path);
    const nAll = pdf.numPages, lazy = nAll > 40 && !entry.bytes;
    const guess = lazy ? Math.min(nAll, Math.max(12, Math.round(((tab && tab.scroll) || 0) * nAll) + 8)) : nAll;
    const pgs = await Promise.all(Array.from({ length: guess }, (_, i) => pdf.getPage(i + 1)));
    if (token !== V.token) return;
    pagesEl.innerHTML = '';
    V.pdf = pdf;
    let last = null;
    V.pages = Array.from({ length: nAll }, (_, i) => {
      const pg = pgs[i] || null;
      const vp = pg ? pg.getViewport({ scale: 1 }) : null;
      const el = document.createElement('div');
      el.className = 'page';
      el.dataset.i = i;
      el.innerHTML = `<span class="pno num">${i + 1}</span>`;
      pagesEl.appendChild(el);
      if (vp) last = vp;
      return { i, pg, vp, w: (vp || last).width, h: (vp || last).height, el, rendered: '', task: null, ink: null, live: null, k: 1, cssW: 0, cssH: 0, top: 0 };
    });
    V.allPages = guess < nAll ? loadRestPages(token) : Promise.resolve();
    V.zoom = (tab && tab.zoom) || 1;
    layout();
    viewer.scrollTop = tab ? tab.scroll * viewer.scrollHeight : 0;
    viewer.scrollLeft = Math.max(0, (viewer.scrollWidth - viewer.clientWidth) / 2);
    V.io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const P = V.pages[+en.target.dataset.i];
        if (!P) continue;
        if (en.isIntersecting) { V.visible.add(P); queueRender(P); } else { V.visible.delete(P); dropPage(P); }
      }
    }, { root: viewer, rootMargin: '100% 50%' });
    V.pages.forEach((P) => V.io.observe(P.el));
    updatePageBadge();
    updateUndo();
    pull(path);
    bcDoc();
    afterDocShown(path);
    thRender();
    recentPush(path);
    track('perf', 'PDF öffnen', performance.now() - tOpen, `${nAll} Seiten, ${((entry.size || 0) / 1048576).toFixed(1)} MB, ${entry.bytes ? 'vom Gerät' : 'aus dem Netz'}`);
    // Notizen aus früheren Sitzungen (oder von einem anderen Gerät) sind endgültig – gleich in die PDF schreiben
    if (!reloading && !path.startsWith('@nb/')) {
      V.dirty = false;
      // nur, wenn seit dem Öffnen nichts geschrieben wurde – sonst beim Verlassen (Rückgängig bleibt so möglich)
      setTimeout(() => { if (V.path === path && !cur && !V.dirty && burnable(path)) autoBurn(path); }, 1500);
    }
  }

  function layout() {
    const mode = viewMode();
    const cols = mode === 'single' ? 1 : 2;
    const rot = V.viewRot || 0, side = rot % 180 !== 0;
    pagesEl.classList.toggle('two', cols === 2);
    pagesEl.classList.toggle('cover', mode === 'cover');
    // bei gedrehter Ansicht zählt die Höhe als Breite
    const maxW = Math.max(...V.pages.map((P) => (side ? P.h : P.w)), 1);
    const fit = Math.min((viewer.clientWidth - 32 - (cols - 1) * 18) / cols, 1500);
    for (const P of V.pages) {
      P.cssW = Math.round(fit * V.zoom * ((side ? P.h : P.w) / maxW) * (side ? P.w / P.h : 1));
      P.cssH = Math.round(P.cssW * P.h / P.w);
      P.el.style.width = P.cssW + 'px';
      P.el.style.height = P.cssH + 'px';
      if (rot) {
        // gedreht anzeigen (nur Ansicht): Platz im Fluss wie die gedrehte Seite
        const dx = side ? (P.cssH - P.cssW) / 2 : 0, dy = side ? (P.cssW - P.cssH) / 2 : 0;
        P.el.style.transform = `rotate(${rot}deg)`;
        P.el.style.margin = `${dy}px ${dx}px`;
      } else { P.el.style.transform = ''; P.el.style.margin = ''; }
    }
    // Zeilen (eine oder zwei Seiten nebeneinander)
    let top = 18;
    const rows = [];
    if (cols === 1) V.pages.forEach((P) => rows.push([P]));
    else {
      let i = 0;
      if (mode === 'cover' && V.pages.length) { rows.push([V.pages[0]]); i = 1; }
      for (; i < V.pages.length; i += 2) rows.push(V.pages.slice(i, i + 2));
    }
    for (const row of rows) {
      for (const P of row) P.top = top;
      top += Math.max(...row.map((P) => (side ? P.cssW : P.cssH))) + 18;
    }
    $('#zoomFit').textContent = Math.round(V.zoom / actualZoom() * 100) + ' %';
    V.pages.forEach(dropDetail);
    clearTimeout(V.layoutT);
    V.layoutT = setTimeout(() => V.visible.forEach(queueRender), 120);
  }

  const wantDpr = () => Math.min(window.devicePixelRatio || 1, 2);
  function pixelRatio(P) {
    let dpr = wantDpr();
    const max = 4e6; // ganze Seite höchstens so viele Pixel; bei starkem Zoom übernimmt die Detail-Ebene

    if (P.cssW * P.cssH * dpr * dpr > max) dpr = Math.sqrt(max / (P.cssW * P.cssH));
    return dpr;
  }

  // Höchstens zwei Seiten gleichzeitig rendern, die Seite in Bildschirmmitte zuerst – hält das Scrollen flüssig
  const RQ = { running: 0, list: new Set() };
  function queueRender(P) { RQ.list.add(P); pumpRender(); }
  function pumpRender() {
    while (RQ.running < 2 && RQ.list.size) {
      const mid = viewer.scrollTop + viewer.clientHeight / 2;
      let best = null, bd = Infinity;
      for (const P of RQ.list) { const d = Math.abs(P.top + P.cssH / 2 - mid); if (d < bd) { bd = d; best = P; } }
      RQ.list.delete(best);
      if (!V.visible.has(best) || !best.el.isConnected) continue;
      RQ.running++;
      renderPage(best).finally(() => { RQ.running--; pumpRender(); });
    }
  }

  // ---- Seiten einer großen PDF nach und nach lesen
  function pgOf(P) {
    if (P.pg) return Promise.resolve(P.pg);
    if (!P.pgP) {
      const pdf = V.pdf;
      P.pgP = pdf.getPage(P.i + 1).then((pg) => { setPg(P, pg); return pg; });
      P.pgP.catch(() => { P.pgP = null; });
    }
    return P.pgP;
  }
  function setPg(P, pg) {
    if (P.pg) return;
    P.pg = pg;
    P.vp = pg.getViewport({ scale: 1 });
    if (Math.abs(P.vp.width - P.w) > 0.5 || Math.abs(P.vp.height - P.h) > 0.5) {
      P.w = P.vp.width; P.h = P.vp.height;
      clearTimeout(V.relayT);
      V.relayT = setTimeout(() => {
        // Seitengröße weicht ab: neu anordnen, aktuelle Stelle bleibt
        const i = currentPageIndex(), Q = V.pages[i], off = Q ? viewer.scrollTop - Q.top : 0;
        layout();
        if (Q) viewer.scrollTop = Q.top + off;
      }, 200);
    }
  }
  async function loadRestPages(token) {
    // zuerst rund um die aktuelle Stelle, dann der Rest – vier gleichzeitig
    await new Promise((r) => setTimeout(r, 300));
    const order = () => { const c = currentPageIndex(); return V.pages.filter((P) => !P.pg).sort((a, b) => Math.abs(a.i - c) - Math.abs(b.i - c)); };
    const worker = async () => {
      for (;;) {
        if (token !== V.token) return;
        const P = order()[0];
        if (!P) return;
        try { await pgOf(P); } catch (e) { return; }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  function renderPage(P) {
    if (!P.cssW) return Promise.resolve();
    if (!P.pg) return pgOf(P).then(() => (V.pages[P.i] === P ? renderPage(P) : null), () => {});
    const dpr = pixelRatio(P);
    const key = P.cssW + '@' + dpr.toFixed(3);
    if (P.rendered === key) return Promise.resolve();
    P.rendered = key;
    if (P.task) P.task.cancel();
    const vp = P.pg.getViewport({ scale: (P.cssW / P.w) * dpr });
    const c = document.createElement('canvas');
    c.className = 'pdf';
    c.width = Math.floor(vp.width);
    c.height = Math.floor(vp.height);
    const task = P.pg.render({ annotationMode: AM, canvasContext: c.getContext('2d', { alpha: false }), viewport: vp });
    P.task = task;
    const done = task.promise.then(() => {
      if (P.task !== task) return;
      const old = P.el.querySelector('canvas.pdf');
      if (old) old.replaceWith(c); else P.el.prepend(c);
      renderDetail(P);
      if (SNAP.ov) snapCheck();
    }).catch(() => {});
    // Tinte (unsichtbar, solange die Seite keine Notizen hat – spart Rechenzeit beim Scrollen)
    if (!P.ink) {
      P.ink = document.createElement('canvas'); P.ink.className = 'ink'; P.ink.hidden = true;
      P.live = document.createElement('canvas'); P.live.className = 'live'; P.live.hidden = true;
      lowLat(P.live);
      P.el.append(P.ink, P.live);
    }
    const w = Math.round(P.cssW * dpr), h = Math.round(P.cssH * dpr);
    for (const c2 of [P.ink, P.live]) { c2.width = w; c2.height = h; }
    P.k = w / P.w;
    drawInk(P);
    loadText(P);
    ensureTextLayer(P);
    return done;
  }
  // ---- Detail-Ebene: bei starkem Zoom wird nur der sichtbare Ausschnitt in voller Schärfe gerendert
  function visibleRegion(P) {
    const vr = viewer.getBoundingClientRect();
    const pr = P.el.getBoundingClientRect();
    if (!pr.width) return null;
    const f = P.cssW / pr.width; // falls gerade per Pinch skaliert
    const mx = vr.width * 0.12, my = vr.height * 0.12;
    const x1 = Math.max(pr.left, vr.left - mx) - pr.left, y1 = Math.max(pr.top, vr.top - my) - pr.top;
    const x2 = Math.min(pr.right, vr.right + mx) - pr.left, y2 = Math.min(pr.bottom, vr.bottom + my) - pr.top;
    if (x2 <= x1 || y2 <= y1) return null;
    const reg = { x: Math.floor(x1 * f), y: Math.floor(y1 * f), w: Math.ceil((x2 - x1) * f), h: Math.ceil((y2 - y1) * f) };
    if (isMirror()) reg.x = Math.max(0, P.cssW - reg.x - reg.w);
    return reg;
  }
  function dropDetail(P) {
    if (P.dtask) { P.dtask.cancel(); P.dtask = null; }
    if (P.det) {
      for (const c of [P.det.pdf, P.det.ink, P.det.live]) { c.width = 0; c.height = 0; c.remove(); }
      P.det = null;
    }
    P.detailKey = '';
  }
  function renderDetail(P) {
    if (!P.cssW || !P.ink || pinch.active || !P.pg) return;
    const want = wantDpr();
    if (pixelRatio(P) >= want * 0.98) { dropDetail(P); return; }
    const r = visibleRegion(P);
    if (!r) { dropDetail(P); return; }
    if (P.det && r.x >= P.det.r.x && r.y >= P.det.r.y && r.x + r.w <= P.det.r.x + P.det.r.w && r.y + r.h <= P.det.r.y + P.det.r.h && P.det.cssW === P.cssW) return;
    const key = [P.cssW, r.x, r.y, r.w, r.h].join(',');
    if (P.detailKey === key) return;
    P.detailKey = key;
    if (P.dtask) P.dtask.cancel();
    const mk = (cls) => {
      const c = document.createElement('canvas');
      c.className = cls;
      c.width = Math.round(r.w * want);
      c.height = Math.round(r.h * want);
      c.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
      return c;
    };
    const pdfC = mk('pdf-d');
    const vp = P.pg.getViewport({ scale: (P.cssW / P.w) * want });
    const task = P.pg.render({ annotationMode: AM, canvasContext: pdfC.getContext('2d', { alpha: false }), viewport: vp, transform: [1, 0, 0, 1, -r.x * want, -r.y * want] });
    P.dtask = task;
    task.promise.then(() => {
      if (P.dtask !== task || !P.live) return;
      const old = P.det;
      P.det = { r, dpr: want, cssW: P.cssW, pdf: pdfC, ink: mk('ink-d'), live: lowLat(mk('live-d')) };
      P.det.live.hidden = !(cur && cur.P === P && cur.st);
      if (!P.det.live.hidden) P.det.live.classList.toggle('blend', P.live.classList.contains('blend'));
      P.el.insertBefore(P.det.pdf, P.live);
      P.el.insertBefore(P.det.ink, P.live);
      P.el.insertBefore(P.det.live, P.live);
      if (old) for (const c of [old.pdf, old.ink, old.live]) { c.width = 0; c.height = 0; c.remove(); }
      drawDetailInk(P);
      if (cur && cur.P === P) drawLive();
    }).catch(() => {});
  }
  function detailCtx(P, which) {
    const d = P.det;
    const ctx = d[which].getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, d[which].width, d[which].height);
    ctx.setTransform(1, 0, 0, 1, -d.r.x * d.dpr, -d.r.y * d.dpr);
    return ctx;
  }
  function drawDetailInk(P) {
    if (!P.det) return;
    const list = pageStrokes(P.i);
    P.det.ink.hidden = !list.length;
    P.det.ink.classList.toggle('blend', list.some((x) => rank(x) < 2));
    const ctx = detailCtx(P, 'ink');
    const k = (P.cssW / P.w) * P.det.dpr;
    list.forEach((x) => strokePath(ctx, x, k));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  let detailT;
  function scheduleDetail(ms = 140) {
    clearTimeout(detailT);
    detailT = setTimeout(() => V.visible.forEach((P) => P.ink && renderDetail(P)), ms);
  }
  function clearLive(P) {
    if (P.live) P.live.getContext('2d').clearRect(0, 0, P.live.width, P.live.height);
    if (P.det) { detailCtx(P, 'live'); P.det.live.getContext('2d').setTransform(1, 0, 0, 1, 0, 0); }
  }

  function dropPage(P) {
    dropDetail(P);
    dropTextLayer(P);
    if (P.task) { P.task.cancel(); P.task = null; }
    P.el.querySelectorAll('canvas').forEach((c) => { c.width = 0; c.height = 0; c.remove(); });
    P.ink = P.live = null;
    P.rendered = '';
  }

  // Formen als Linienzüge (in PDF-Punkten) – gleiche Geometrie für Bildschirm, Radierer und Export
  function shapeLines(s) {
    const [x1, y1, x2, y2] = s.pts;
    if (s.k === 'rect') return [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]];
    if (s.k === 'oval') {
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
      const pts = [];
      for (let i = 0; i <= 64; i++) { const a = (i / 64) * Math.PI * 2; pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); }
      return [pts];
    }
    const lines = [[[x1, y1], [x2, y2]]];
    if (s.k === 'arrow') {
      const a = Math.atan2(y2 - y1, x2 - x1);
      const L = Math.min(Math.max(s.w * 5, 6 / Math.max(1, V.zoom || 1), s.w * 3), Math.hypot(x2 - x1, y2 - y1) * 0.6);
      lines.push([[x2 - L * Math.cos(a - 0.45), y2 - L * Math.sin(a - 0.45)], [x2, y2], [x2 - L * Math.cos(a + 0.45), y2 - L * Math.sin(a + 0.45)]]);
    }
    return lines;
  }
  const TXT_FONT = 'Helvetica, Arial, sans-serif';
  // Textfelder: Schriftart (ff: '' = serifenlos, 'serif', 'mono'), fett (b), kursiv (i), Ausrichtung (al: '', 'c', 'r')
  const TXT_FAM = { serif: '"Times New Roman", Times, serif', mono: '"Courier New", Courier, monospace' };
  const txtFam = (s) => (s && TXT_FAM[s.ff]) || TXT_FONT;
  const txtCss = (s, px) => `${s && s.i ? 'italic ' : ''}${s && s.b ? '700 ' : ''}${px}px ${txtFam(s)}`;
  const txtLines = (s) => String(s.text || '').split('\n');

  const LIVE = new WeakSet(); // Striche, die gerade geschrieben werden

  // Zeichnen der Striche
  function strokePath(ctx, s, k) {
    const p = s.pts;
    if (s.t === 'ob') return; // Objekte (Text, Formen, Bilder, Tabellen) liegen als eigene Ebene über der Seite
    if (s.t === 'sh') {
      ctx.strokeStyle = s.c;
      ctx.lineWidth = Math.max(0.5, s.w * k);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const line of shapeLines(s)) {
        ctx.beginPath();
        line.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k)));
        ctx.stroke();
      }
      return;
    }
    if ((s.t === 'img' || s.t === 'txt') && s.r) {
      // gedreht: um die Mitte drehen, dann normal zeichnen
      const cx = (p[0] + (s.bw || 0) / 2) * k, cy = (p[1] + (s.bh || 0) / 2) * k;
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(s.r * Math.PI / 180); ctx.translate(-cx, -cy);
      strokePath(ctx, { ...s, r: 0 }, k);
      ctx.restore();
      return;
    }
    if (s.t === 'img') {
      const im = imgGet(s.src);
      if (im.complete && im.naturalWidth) ctx.drawImage(im, p[0] * k, p[1] * k, s.bw * k, s.bh * k);
      else { ctx.fillStyle = '#EEF0F5'; ctx.fillRect(p[0] * k, p[1] * k, s.bw * k, s.bh * k); }
      // übernommene PDF-Seite auf der Notizseite: feiner Rahmen, damit der Seitenrand sichtbar ist
      if (s.ln && s.o) { ctx.strokeStyle = '#C9CED8'; ctx.lineWidth = 1; ctx.strokeRect(p[0] * k, p[1] * k, s.bw * k, s.bh * k); }
      return;
    }
    if (s.t === 'txt' && s.nt) { drawNoteIcon(ctx, s, k); return; }
    if (s.t === 'txt') {
      if (s.id && s.id === editingId) return;
      if (s.bg || s.bo) {
        const pd = s.fs * 0.3;
        const rx = (p[0] - pd) * k, ry = (p[1] - pd) * k, rw = ((s.bw || 0) + pd * 2) * k, rh = ((s.bh || 0) + pd * 2) * k;
        if (s.bg) { ctx.fillStyle = s.bg; ctx.fillRect(rx, ry, rw, rh); }
        if (s.bo) { ctx.strokeStyle = s.bo; ctx.lineWidth = Math.max(1, s.fs * 0.07 * k); ctx.strokeRect(rx, ry, rw, rh); }
      }
      ctx.fillStyle = s.c;
      ctx.font = txtCss(s, s.fs * k);
      ctx.textBaseline = 'alphabetic';
      txtLines(s).forEach((line, i) => {
        const off = s.al ? ((s.bw || 0) * k - ctx.measureText(line).width) * (s.al === 'c' ? 0.5 : 1) : 0;
        ctx.fillText(line, p[0] * k + Math.max(0, off), (p[1] + s.fs * 0.8 + i * s.fs * 1.25) * k);
      });
      if (s.ln) { ctx.fillRect(p[0] * k, (p[1] + s.fs * 0.95) * k, (s.bw || 0) * k, Math.max(1, s.fs * 0.06 * k)); }
      return;
    }
    if (s.t === 'tx') {
      ctx.fillStyle = s.c;
      ctx.strokeStyle = s.c;
      for (let i = 0; i + 3 < p.length; i += 4) {
        const x = p[i] * k, y = p[i + 1] * k, w = p[i + 2] * k, h = p[i + 3] * k;
        if (s.k === 'ul' || s.k === 'st') {
          const yy = s.k === 'ul' ? y + h * 0.94 : y + h * 0.56;
          ctx.lineWidth = Math.max(1.2 * k, h * 0.085);
          ctx.lineCap = 'butt';
          ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke();
        } else {
          ctx.globalAlpha = 0.85;
          ctx.globalCompositeOperation = 'multiply';
          ctx.fillRect(x, y, w, h);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        }
      }
      return;
    }
    ctx.strokeStyle = s.c;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (s.t === 'hl') {
      ctx.globalAlpha = 0.4;
      ctx.globalCompositeOperation = 'multiply';
      ctx.lineWidth = s.w * k;
      ctx.beginPath();
      ctx.moveTo(p[0] * k, p[1] * k);
      for (let i = 3; i < p.length; i += 3) ctx.lineTo(p[i] * k, p[i + 1] * k);
      if (p.length === 3) ctx.lineTo(p[0] * k + 0.01, p[1] * k);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      return;
    }
    if (p.length === 3) {
      ctx.fillStyle = s.c;
      ctx.beginPath();
      ctx.arc(p[0] * k, p[1] * k, (s.w * (0.6 + 0.8 * (p[2] || 0.5)) * k) / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    penSegments(ctx, s, k, 3);
  }
  // Zeichnet die Stift-Segmente ab Punkt-Index `from`; gleiche Strichbreite wird zu einem Pfad zusammengefasst
  // Live-Darstellung des Stifts: einfache Linienstücke (schnell); Einzelpunkt als Kreis
  function penLive(ctx, s, k) {
    const p = s.pts;
    if (p.length <= 3) {
      ctx.fillStyle = s.c;
      ctx.beginPath();
      ctx.arc(p[0] * k, p[1] * k, (s.w * (0.6 + 0.8 * (p[2] || 0.5)) * k) / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    penSegments(ctx, s, k, 3);
  }
  function penSegments(ctx, s, k, from) {
    // Kurven durch die Mittelpunkte benachbarter Messpunkte: wirkt weich, ohne der Stiftspitze hinterherzuhinken
    const p = s.pts;
    ctx.strokeStyle = s.c;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    let lw = -1;
    const start = Math.max(3, from);
    for (let i = start; i < p.length; i += 3) {
      const pr = ((p[i - 1] || 0.5) + (p[i + 2] || 0.5)) / 2;
      const w = Math.max(0.5, Math.round(s.w * (0.6 + 0.8 * pr) * k * 4) / 4);
      const x0 = i >= 6 ? (p[i - 6] + p[i - 3]) / 2 : p[i - 3], y0 = i >= 6 ? (p[i - 5] + p[i - 2]) / 2 : p[i - 2];
      const mx = (p[i - 3] + p[i]) / 2, my = (p[i - 2] + p[i + 1]) / 2;
      if (w !== lw) {
        if (lw >= 0) ctx.stroke();
        lw = w;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(x0 * k, y0 * k);
      }
      ctx.quadraticCurveTo(p[i - 3] * k, p[i - 2] * k, mx * k, my * k);
    }
    if (lw >= 0) {
      ctx.lineTo(p[p.length - 3] * k, p[p.length - 2] * k);
      ctx.stroke();
    }
  }

  function drawInk(P) {
    if (!P.ink || !V.doc) return;
    const ctx = P.ink.getContext('2d');
    ctx.clearRect(0, 0, P.ink.width, P.ink.height);
    const list = pageStrokes(P.i);
    P.ink.hidden = !list.length;
    // Multiplizieren (Text bleibt unter Markierungen schwarz) nur, wenn die Seite Markierungen hat
    P.ink.classList.toggle('blend', list.some((x) => rank(x) < 2));
    list.forEach((x) => strokePath(ctx, x, P.k));
    drawDetailInk(P);
    obRender(P);
  }
  // Reihenfolge: Text-Hervorhebung, freier Marker, dann Stift und Linien obenauf
  const rank = (s) => (s.t === 'ob' ? -2 : s.t === 'img' ? -1 : s.t === 'tx' && s.k === 'hl' ? 0 : s.t === 'hl' ? 1 : s.t === 'txt' ? 3 : 2);
  let editingId = null;
  let SEL = null, hiddenIds = null; // Lasso-Auswahl
  function pageStrokes(i) {
    const list = [];
    if (V.doc) for (const s of V.doc.strokes.values()) if (s.p === i && !(hiddenIds && hiddenIds.has(s.id))) list.push(s);
    return list.sort((a, b) => rank(a) - rank(b));
  }
  function redrawAllInk() { if (V.board) boardRender(); V.pages.forEach((P) => P.ink && drawInk(P)); updateUndo(); }
  function redrawPages(strokes) {
    if (V.board) { boardRender(); return; }
    const set = new Set(strokes.map((s) => s.p));
    set.forEach((i) => V.pages[i] && drawInk(V.pages[i]));
  }

  // ------------------------------------------------------------------ Eingabe: Stift zeichnet, Finger scrollt
  let cur = null;
  let penDown = false;
  const touches = new Set();
  let liveRaf = 0;

  function ptFrom(P, e) {
    const r = (cur && cur.P === P && cur.rect) || P.el.getBoundingClientRect();
    const s = P.w / r.width;
    const pr = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
    const x = isMirror() ? r.right - e.clientX : e.clientX - r.left;
    return [Math.round(x * s * 100) / 100, Math.round((e.clientY - r.top) * s * 100) / 100, Math.round(pr * 100) / 100];
  }
  function currentStyle() {
    if (S.tool === 'tx') return { t: 'tx', k: S.txKind, c: S.color.tx };
    // Über 100 % bleibt die Strichstärke auf dem Bildschirm gleich – so kann man hineinzoomen und klein schreiben
    const z = Math.max(1, V.zoom);
    const w = (base) => Math.max(0.01, Math.round((base / z) * 1000) / 1000);
    if (S.tool === 'hl') return { t: 'hl', c: S.color.hl, w: w(HL_W[S.wi.hl]) };
    if (S.tool === 'sh') return { t: 'sh', k: S.shKind, c: S.color.sh, w: w(PEN_W[S.wi.sh]) };
    return { t: 'pen', c: S.color.pen, w: w(PEN_W[S.wi.pen]) };
  }
  function liveStart(P, st) {
    const blend = st.t === 'hl' || (st.t === 'tx' && st.k === 'hl');
    for (const c of [P.live, P.det && P.det.live]) {
      if (!c) continue;
      c.hidden = false;
      c.classList.toggle('blend', blend);
    }
  }
  function liveEnd(P) {
    if (BC && !PROMPTER && PR.prompter) BC.postMessage({ t: 'live', path: V.path, st: null });
    clearLive(P);
    for (const c of [P.live, P.det && P.det.live]) if (c) c.hidden = true;
  }
  function drawLive() {
    liveRaf = 0;
    if (!cur || !cur.st || !cur.P.live) return;
    const P = cur.P, s = cur.st;
    const c = P.det ? P.det.live : P.live;
    const ctx = c.getContext('2d');
    const k = P.det ? (P.cssW / P.w) * P.det.dpr : P.k;
    if (s.t === 'pen' && cur.drawnOn === c && cur.drawn > 3 && s.pts.length > cur.drawn) {
      // Stift: nur die neuen Stücke dazuzeichnen – die Linie folgt der Spitze ohne Verzögerung; geglättet wird beim Absetzen
      if (P.det) ctx.setTransform(1, 0, 0, 1, -P.det.r.x * P.det.dpr, -P.det.r.y * P.det.dpr);
      penSegments(ctx, s, k, cur.drawn);
    } else {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      if (P.det) ctx.setTransform(1, 0, 0, 1, -P.det.r.x * P.det.dpr, -P.det.r.y * P.det.dpr);
      if (s.t === 'pen') penLive(ctx, s, k); else strokePath(ctx, s, k);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    cur.drawn = s.pts.length;
    cur.drawnOn = c;
    if (BC && !PROMPTER && PR.prompter) BC.postMessage({ t: 'live', path: V.path, st: s });
    liveSoon();
  }

  // ---- Text einer Seite (für Markierungen, die am Text einrasten)
  function loadText(P) {
    if (P.textP) return P.textP;
    P.textP = pgOf(P).then((pg) => pg.getTextContent()).then((tc) => {
      const items = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const tr = it.transform;
        const h = Math.hypot(tr[2], tr[3]) || Math.abs(it.height) || 10;
        const w = it.width || h * it.str.length * 0.5;
        const r = vpRect(P.vp, [tr[4], tr[5] - h * 0.24, tr[4] + w, tr[5] + h * 0.9]);
        items.push({
          x: Math.min(r[0], r[2]), y: Math.min(r[1], r[3]),
          w: Math.abs(r[2] - r[0]), h: Math.abs(r[3] - r[1]), n: it.str.length,
        });
      }
      P.text = items;
      return items;
    }).catch(() => { P.text = []; return []; });
    return P.textP;
  }
  function nearestItem(items, x, y) {
    let best = -1, bd = Infinity;
    items.forEach((it, i) => {
      const dx = x < it.x ? it.x - x : x > it.x + it.w ? x - it.x - it.w : 0;
      const dy = y < it.y ? it.y - y : y > it.y + it.h ? y - it.y - it.h : 0;
      const d = dx * dx + dy * dy * 6;
      if (d < bd) { bd = d; best = i; }
    });
    return bd < 1600 ? best : -1;
  }
  function textRects(P, a, b) {
    const items = P.text || [];
    if (!items.length) return [];
    let i0 = nearestItem(items, a[0], a[1]), i1 = nearestItem(items, b[0], b[1]);
    if (i0 < 0 || i1 < 0) return [];
    let s = a, e = b;
    if (i0 > i1 || (i0 === i1 && a[0] > b[0])) { [i0, i1] = [i1, i0]; [s, e] = [e, s]; }
    const out = [];
    for (let i = i0; i <= i1; i++) {
      const it = items[i];
      const cw = it.w / Math.max(1, it.n);
      let x1 = it.x, x2 = it.x + it.w;
      if (i === i0) x1 = it.x + Math.floor((clamp(s[0], it.x, x2) - it.x) / cw) * cw;
      if (i === i1) x2 = it.x + Math.ceil((clamp(e[0], it.x, it.x + it.w) - it.x) / cw) * cw;
      if (x2 - x1 < 0.5) continue;
      const last = out[out.length - 1];
      if (last && Math.abs(last.y - it.y) < it.h * 0.5 && x1 >= last.x - 1 && x1 - (last.x + last.w) < it.h * 2) {
        const nx2 = Math.max(last.x + last.w, x2);
        const ny2 = Math.max(last.y + last.h, it.y + it.h);
        last.y = Math.min(last.y, it.y); last.h = ny2 - last.y; last.w = nx2 - last.x;
      } else {
        out.push({ x: x1, y: it.y, w: x2 - x1, h: it.h });
      }
    }
    const r2 = (n) => Math.round(n * 100) / 100;
    return out.flatMap((r) => [r2(r.x), r2(r.y), r2(r.w), r2(r.h)]);
  }

  const bboxCache = new WeakMap();
  function bbox(s) {
    let b = bboxCache.get(s);
    if (!b) {
      b = [Infinity, Infinity, -Infinity, -Infinity];
      const p = s.pts;
      if (s.t === 'tx') {
        for (let i = 0; i + 3 < p.length; i += 4) {
          b[0] = Math.min(b[0], p[i]); b[1] = Math.min(b[1], p[i + 1]);
          b[2] = Math.max(b[2], p[i] + p[i + 2]); b[3] = Math.max(b[3], p[i + 1] + p[i + 3]);
        }
      } else if (s.t === 'ob' && s.e) {
        const e = s.e, a = (e.r || 0) * Math.PI / 180, cx = e.x + e.w / 2, cy = e.y + e.h / 2;
        const ex = (Math.abs(Math.cos(a)) * e.w + Math.abs(Math.sin(a)) * e.h) / 2, ey = (Math.abs(Math.sin(a)) * e.w + Math.abs(Math.cos(a)) * e.h) / 2;
        b = [cx - ex, cy - ey, cx + ex, cy + ey];
      } else if (s.t === 'sh') {
        for (const line of shapeLines(s)) for (const [x, y] of line) {
          b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
        }
      } else if (s.t === 'txt' || s.t === 'img') {
        const pd0 = s.t === 'txt' && (s.bg || s.bo) ? s.fs * 0.3 : 0;
        const w = (s.bw || 10) + pd0 * 2, h = (s.bh || (s.fs || 10) * 1.25) + pd0 * 2;
        b = [p[0] - pd0, p[1] - pd0, p[0] - pd0 + w, p[1] - pd0 + h];
        if (s.r) {
          const a = s.r * Math.PI / 180, cx = p[0] - pd0 + w / 2, cy = p[1] - pd0 + h / 2;
          const ex = (Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * h) / 2, ey = (Math.abs(Math.sin(a)) * w + Math.abs(Math.cos(a)) * h) / 2;
          b = [cx - ex, cy - ey, cx + ex, cy + ey];
        }
      } else {
        for (let i = 0; i < p.length; i += 3) {
          b[0] = Math.min(b[0], p[i]); b[1] = Math.min(b[1], p[i + 1]);
          b[2] = Math.max(b[2], p[i]); b[3] = Math.max(b[3], p[i + 1]);
        }
      }
      bboxCache.set(s, b);
    }
    return b;
  }
  function segDist2(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l = dx * dx + dy * dy;
    let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
    t = clamp(t, 0, 1);
    const x = ax + t * dx - px, y = ay + t * dy - py;
    return x * x + y * y;
  }
  function eraseAt(P, x, y) {
    const hit = [];
    const base = 7 / Math.max(1, V.zoom); // Radiergröße bleibt auf dem Bildschirm gleich
    for (const s of V.doc.strokes.values()) {
      if (s.p !== P.i || s.t === 'ob') continue; // Objekte: anklicken und Entf
      const r = base + (s.w || 0) / 2;
      const b = bbox(s);
      if (x < b[0] - r || x > b[2] + r || y < b[1] - r || y > b[3] + r) continue;
      const p = s.pts;
      let found = false;
      if (s.t === 'tx') {
        for (let i = 0; !found && i + 3 < p.length; i += 4) {
          found = x >= p[i] - r && x <= p[i] + p[i + 2] + r && y >= p[i + 1] - r && y <= p[i + 1] + p[i + 3] + r;
        }
      } else if (s.t === 'sh') {
        for (const line of shapeLines(s)) {
          for (let i = 1; !found && i < line.length; i++) found = segDist2(x, y, line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]) < r * r;
        }
      } else if (s.t === 'txt' || s.t === 'img') {
        found = true; // Rahmen-Test oben genügt
      } else {
        found = p.length === 3 && ((p[0] - x) ** 2 + (p[1] - y) ** 2 < r * r);
        for (let i = 3; !found && i < p.length; i += 3) found = segDist2(x, y, p[i - 3], p[i - 2], p[i], p[i + 1]) < r * r;
      }
      if (found) hit.push(s);
    }
    if (!hit.length) return;
    opDel(V.path, hit.map((s) => s.id));
    cur.removed.push(...hit);
    drawInk(P);
  }

  let ttDown = null;
  // Textfeld-Werkzeug: vorhandenes Textfeld anfassen und ziehen = verschieben
  pagesEl.addEventListener('pointermove', (e) => {
    const t = ttDown;
    if (!t || !t.hit || t.id !== e.pointerId) return;
    if (!t.moving) {
      if (Math.hypot(e.clientX - t.x, e.clientY - t.y) < 6) return;
      t.moving = true;
      clearSel();
      SEL = { P: t.P, ids: [t.hit.id] };
      renderSel();
      SEL.drag = { id: e.pointerId, x0: t.x, y0: t.y, mode: 'move', b: SEL.b.slice(), fn: null, moved: 0 };
      hiddenIds = new Set(SEL.ids);
      drawInk(t.P);
      liveStart(t.P, { t: 'pen' });
      if (SEL.bar) SEL.bar.hidden = true;
    }
    selMove(e);
  });
  pagesEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.sel-bar, .fm-field, .im-box, .fb-box, .pe-edit')) return;
    if (e.pointerType === 'touch') touches.add(e.pointerId);
    if (e.pointerType === 'pen') penDown = true;
    if (obDown(e)) { e.stopImmediatePropagation(); return; }
    if (S.tool === 'tt') {
      // Textfeld: wird beim Loslassen geöffnet, wenn nicht gewischt wurde
      if (!e.target.closest('.txt-editor')) {
        ttDown = { id: e.pointerId, x: e.clientX, y: e.clientY, el: e.target.closest('.page') };
        // auf ein vorhandenes Textfeld gedrückt: Ziehen verschiebt es
        const P = ttDown.el && V.pages[+ttDown.el.dataset.i];
        if (P && !editor) {
          const r = P.el.getBoundingClientRect(), sc = P.cssW / P.w;
          const hit = textAt(P, (e.clientX - r.left) / sc, (e.clientY - r.top) / sc);
          if (hit) { ttDown.hit = hit; ttDown.P = P; try { pagesEl.setPointerCapture(e.pointerId); } catch (er) { /* */ } }
        }
      }
      return;
    }
    // Textbaustein mit jedem Werkzeug (auch Pfeil und Hand; außer Radierer und Lasso): antippen = ändern, ziehen = verschieben
    if (S.tool !== 'er' && S.tool !== 'la' && !editor && !cur && !pinch.active && V.doc && !(e.pointerType === 'touch' && touches.size > 1)) {
      const pe0 = e.target.closest('.page');
      const P0 = pe0 && V.pages[+pe0.dataset.i];
      if (P0) {
        const r0 = P0.el.getBoundingClientRect(), sc0 = P0.cssW / P0.w;
        const hx = (isMirror() ? r0.right - e.clientX : e.clientX - r0.left) / sc0, hy = (e.clientY - r0.top) / sc0;
        const hit = textAt(P0, hx, hy);
        // Textbausteine immer; andere Textfelder per Maus bzw. mit Pfeil/Hand (mit dem Stift darf man darüber schreiben)
        if (hit && (hit.sn || e.pointerType === 'mouse' || S.tool === 'sel' || S.tool === 'hand')) {
          e.preventDefault();
          ttDown = { id: e.pointerId, x: e.clientX, y: e.clientY, el: pe0, hit, P: P0 };
          try { pagesEl.setPointerCapture(e.pointerId); } catch (er) { /* */ }
          return;
        }
      }
    }
    if (S.tool === 'sel' || S.tool === 'hand') return; // Text auswählen bzw. Hand: nicht zeichnen
    const draws = e.pointerType === 'pen' || (e.pointerType === 'mouse' && e.button === 0) ||
      (e.pointerType === 'touch' && S.finger && touches.size === 1);
    if (!draws || pinch.active || cur) return;
    const pageEl = e.target.closest('.page');
    if (!pageEl) return;
    const P = V.pages[+pageEl.dataset.i];
    if (!P || !P.ink) return;
    e.preventDefault();
    try { pagesEl.setPointerCapture(e.pointerId); } catch (err) { /* */ }
    closeMenus();
    const rect = P.el.getBoundingClientRect();
    if (S.tool === 'lp') {
      const [x, y] = ptFrom(P, e);
      const tr = { p: P.i, pts: [[x, y, Date.now()]], live: true };
      LZ.trails.push(tr);
      if (LZ.trails.length > 12) LZ.trails.shift();
      cur = { P, pid: e.pointerId, rect, laser: tr };
      laserAdd(tr);
      return;
    }
    if (S.tool === 'la') {
      const [x, y] = ptFrom(P, e);
      if (SEL && SEL.P === P && e.target.closest('.sel-box')) {
        cur = { P, pid: e.pointerId, rect, drag: true, x0: x, y0: y, dx: 0, dy: 0 };
        hiddenIds = new Set(SEL.ids);
        drawInk(P);
        liveStart(P, { t: 'pen' });
        drawDrag(cur);
        return;
      }
      clearSel();
      cur = { P, pid: e.pointerId, rect, lasso: [x, y] };
      liveStart(P, { t: 'pen' });
      return;
    }
    if (S.tool === 'er') {
      cur = { P, pid: e.pointerId, removed: [], rect };
      const [x, y] = ptFrom(P, e);
      eraseAt(P, x, y);
      return;
    }
    if (S.tool === 'tx') {
      loadText(P);
      const a = ptFrom(P, e);
      cur = { P, pid: e.pointerId, a, rect, st: { id: uid(), p: P.i, ...currentStyle(), pts: [] } };
      cur.st.pts = textRects(P, a, a);
      liveStart(P, cur.st);
      if (!liveRaf) liveRaf = requestAnimationFrame(drawLive);
      return;
    }
    if (S.tool === 'sh') {
      const [x, y] = ptFrom(P, e);
      cur = { P, pid: e.pointerId, rect, shape: true, st: { id: uid(), p: P.i, ...currentStyle(), pts: [x, y, x, y] } };
      liveStart(P, cur.st);
      return;
    }
    cur = { P, pid: e.pointerId, rect, hx: e.clientX, hy: e.clientY, st: { id: uid(), p: P.i, ...currentStyle(), pts: [] } };
    cur.st.pts = ptFrom(P, e);
    LIVE.add(cur.st);
    liveStart(P, cur.st);
    if (!liveRaf) liveRaf = requestAnimationFrame(drawLive);
  });
  pagesEl.addEventListener('pointermove', (e) => {
    if (!cur || e.pointerId !== cur.pid) return;
    e.preventDefault();
    if (cur.laser) {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      const p = cur.laser.pts;
      const md = 0.6 / Math.max(1, V.zoom);
      for (const ev of (evs.length ? evs : [e])) {
        const [x, y] = ptFrom(cur.P, ev);
        const l = p[p.length - 1];
        if (l && (x - l[0]) ** 2 + (y - l[1]) ** 2 < md * md) { l[2] = Date.now(); continue; }
        p.push([x, y, Date.now()]);
      }
      if (p.length > 600) p.splice(0, p.length - 600);
      laserAdd(cur.laser);
      return;
    }
    if (cur.lasso) {
      const [x, y] = ptFrom(cur.P, e);
      cur.lasso.push(x, y);
      drawLasso(cur);
      return;
    }
    if (cur.drag) {
      const [x, y] = ptFrom(cur.P, e);
      cur.dx = x - cur.x0; cur.dy = y - cur.y0;
      drawDrag(cur);
      return;
    }
    if (cur.a) {
      cur.st.pts = textRects(cur.P, cur.a, ptFrom(cur.P, e));
      if (!liveRaf) liveRaf = requestAnimationFrame(drawLive);
      return;
    }
    if (cur.fixed) return; // Form erkannt: bleibt so bis zum Absetzen
    if (cur.shape || cur.straight) {
      const [x, y] = ptFrom(cur.P, e);
      const p = cur.st.pts;
      if (cur.shape) { p[2] = x; p[3] = y; } else { const [sx, sy] = snapLine(p[0], p[1], x, y); cur.st.pts = [p[0], p[1], 0.5, sx, sy, 0.5]; }
      cur.drawn = 0;
      if (!liveRaf) liveRaf = requestAnimationFrame(drawLive);
      return;
    }
    // Stift kurz ruhig halten → Strich wird zur geraden Linie
    if (cur.st && Math.hypot(e.clientX - cur.hx, e.clientY - cur.hy) > 4) {
      cur.hx = e.clientX; cur.hy = e.clientY;
      clearTimeout(cur.holdT);
      const c = cur;
      cur.holdT = setTimeout(() => straighten(c), 450);
    }
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const pt = ptFrom(cur.P, ev);
      if (!cur.st) { eraseAt(cur.P, pt[0], pt[1]); continue; }
      const p = cur.st.pts;
      const dx = pt[0] - p[p.length - 3], dy = pt[1] - p[p.length - 2];
      const md = 0.2 / Math.max(1, V.zoom);
      if (dx * dx + dy * dy < md * md) continue;
      p.push(...pt);
    }
    if (cur.st && !liveRaf) liveRaf = requestAnimationFrame(drawLive);
  });
  // Stift am Ende kurz ruhig halten: geschlossene Form → Kreis/Ellipse oder Rechteck, offener Strich → gerade Linie
  function shapeOf(p) {
    const n = p.length / 3;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, len = 0;
    for (let i = 0; i < p.length; i += 3) {
      x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]);
      if (i) len += Math.hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2]);
    }
    const w = x1 - x0, h = y1 - y0, big = Math.max(w, h), small = Math.min(w, h);
    const gap = Math.hypot(p[p.length - 3] - p[0], p[p.length - 2] - p[1]);
    if (n < 12 || small < big * 0.18 || gap > big * 0.3 || len < big * 2.2) return null;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    let eE = 0, eR = 0;
    for (let i = 0; i < p.length; i += 3) {
      const dx = (p[i] - cx) / (w / 2), dy = (p[i + 1] - cy) / (h / 2);
      eE += Math.abs(Math.hypot(dx, dy) - 1);
      eR += Math.min(Math.abs(p[i] - x0), Math.abs(p[i] - x1), Math.abs(p[i + 1] - y0), Math.abs(p[i + 1] - y1)) / small;
    }
    eE /= n; eR /= n;
    if (eR < 0.07 && eR < eE * 0.8) {
      // viele Punkte je Kante, damit die Glättung des Stifts die Ecken nicht abrundet
      const c4 = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], out = [];
      for (let k = 0; k < 4; k++) for (let t = 0; t < 30; t++) out.push(c4[k][0] + (c4[k + 1][0] - c4[k][0]) * t / 30, c4[k][1] + (c4[k + 1][1] - c4[k][1]) * t / 30, 0.5);
      out.push(x0, y0, 0.5, x0 + (x1 - x0) * 0.02, y0, 0.5);
      return out;
    }
    if (eE < 0.16) {
      let rx = w / 2, ry = h / 2;
      if (Math.abs(w - h) < big * 0.15) rx = ry = (w + h) / 4; // fast rund → Kreis
      const out = [];
      for (let k = 0; k <= 72; k++) { const a = (k / 72) * Math.PI * 2; out.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a), 0.5); }
      return out;
    }
    return null;
  }
  function straighten(c) {
    if (cur !== c || !c.st || c.straight || c.fixed) return;
    const p = c.st.pts;
    if (p.length < 9) return;
    const sc = c.P.cssW / c.P.w;
    const n = p.length;
    const form = shapeOf(p);
    if (form) {
      c.fixed = true;
      c.st.pts = form;
    } else {
      if (Math.hypot(p[n - 3] - p[0], p[n - 2] - p[1]) * sc < 16) return; // zu kurz
      c.straight = true;
      const [sx, sy] = snapLine(p[0], p[1], p[n - 3], p[n - 2]);
      c.st.pts = [p[0], p[1], 0.5, sx, sy, 0.5];
    }
    c.pred = null;
    c.drawn = 0;
    if (navigator.vibrate) navigator.vibrate(8);
    drawLive();
  }
  // fast waagerecht/senkrecht → einrasten (z. B. zum Unterstreichen)
  function snapLine(x0, y0, x, y) {
    const a = Math.abs(Math.atan2(y - y0, x - x0) * 180 / Math.PI);
    if (a < 4 || a > 176) return [x, y0];
    if (Math.abs(a - 90) < 4) return [x0, y];
    return [x, y];
  }
  function endStroke(e, cancel) {
    if (e.pointerType === 'touch') touches.delete(e.pointerId);
    if (e.pointerType === 'pen') penDown = false;
    if (ttDown && ttDown.id === e.pointerId) {
      const t = ttDown;
      ttDown = null;
      if (t.moving) { selUp(e); return; }
      if (!cancel && t.el && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 10) openTextEditor(V.pages[+t.el.dataset.i], e);
      return;
    }
    if (!cur || e.pointerId !== cur.pid) return;
    const c = cur;
    cur = null;
    clearTimeout(c.holdT);
    if (c.st) LIVE.delete(c.st);
    if (c.laser) { c.laser.live = false; laserAdd(c.laser); return; }
    if (c.lasso) { liveEnd(c.P); finishLasso(c); return; }
    if (c.drag) { liveEnd(c.P); hiddenIds = null; finishDrag(c); return; }
    if (!c.st) {
      if (c.removed.length) pushHistory({ t: 'del', strokes: c.removed });
      return;
    }
    liveEnd(c.P);
    if (c.st.t === 'tx' && !c.st.pts.length) {
      if (c.P.text && !c.P.text.length) toast('Auf dieser Seite ist kein Text erkennbar (z. B. ein Scan). Nimm hier den freien Marker.', 5000);
      return;
    }
    if (c.st.t === 'sh') {
      const [x1, y1, x2, y2] = c.st.pts;
      if (Math.hypot(x2 - x1, y2 - y1) * (c.P.cssW / c.P.w) < 6) return;
      c.st.pts = c.st.pts.map((v) => Math.round(v * 100) / 100);
    } else if (cancel && c.st.t !== 'tx' && c.st.pts.length < 9) return;
    opAdd(V.path, [c.st]);
    pushHistory({ t: 'add', strokes: [c.st] });
    if (c.st.t !== 'pen') drawInk(c.P);
    else if (c.P.ink) {
      c.P.ink.hidden = false;
      if (c.P.det) c.P.det.ink.hidden = false;
      strokePath(c.P.ink.getContext('2d'), c.st, c.P.k);
      if (c.P.det) {
        const ctx = c.P.det.ink.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, -c.P.det.r.x * c.P.det.dpr, -c.P.det.r.y * c.P.det.dpr);
        strokePath(ctx, c.st, (c.P.cssW / c.P.w) * c.P.det.dpr);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
  }
  pagesEl.addEventListener('pointerup', (e) => endStroke(e, false));
  pagesEl.addEventListener('pointercancel', (e) => endStroke(e, true));

  // Scrollen verhindern, solange der Stift aufliegt (iOS & Android)
  const isStylus = (e) => penDown || [...e.touches].some((t) => t.touchType === 'stylus');

  // Zwei Finger: zoomen und verschieben
  const pinch = { active: false };
  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  viewer.addEventListener('touchstart', (e) => {
    if (e.target.closest && e.target.closest('.sel-bar, .txt-editor')) return; // Knöpfe müssen antippbar bleiben
    if (isStylus(e)) { e.preventDefault(); return; }
    if (e.touches.length === 2) {
      if (cur && cur.st) { // Finger-Modus: angefangenen Strich verwerfen
        liveEnd(cur.P);
        cur = null;
      }
      const [a, b] = e.touches;
      const vr = viewer.getBoundingClientRect();
      const cxm = (a.clientX + b.clientX) / 2;
      const mx = isMirror() ? vr.right - cxm : cxm - vr.left, my = (a.clientY + b.clientY) / 2 - vr.top;
      if (!V.pages.length) return;
      Object.assign(pinch, { active: true, vr, d0: dist(a, b), z0: V.zoom, s: 1, cx: viewer.scrollLeft + mx, cy: viewer.scrollTop + my, mx, my, anchor: anchorAt(mx, my) });
      pagesEl.style.willChange = 'transform';
      e.preventDefault();
    }
  }, { passive: false });
  // Während des Zoomens darf der Browser nicht selbst mitscrollen, sonst verrutscht die Stelle
  let pinchRaf = 0;
  viewer.addEventListener('touchmove', (e) => {
    if (isStylus(e)) { e.preventDefault(); return; }
    if (!pinch.active || e.touches.length < 2) return;
    e.preventDefault();
    const [a, b] = e.touches;
    const vr = pinch.vr;
    pinch.mx = isMirror() ? vr.right - (a.clientX + b.clientX) / 2 : (a.clientX + b.clientX) / 2 - vr.left;
    pinch.my = (a.clientY + b.clientY) / 2 - vr.top;
    pinch.s = clamp(dist(a, b) / pinch.d0, ZOOM_MIN / pinch.z0, maxZoom() / pinch.z0);
    if (pinchRaf) return;
    pinchRaf = requestAnimationFrame(() => {
      pinchRaf = 0;
      if (!pinch.active) return;
      // Inhaltspunkt unter dem Startmittelpunkt bleibt unter dem aktuellen Mittelpunkt (auch wenn der Browser mitscrollt)
      const tx = pinch.mx + viewer.scrollLeft - pinch.cx * pinch.s;
      const ty = pinch.my + viewer.scrollTop - pinch.cy * pinch.s;
      pagesEl.style.transform = `translate(${tx}px, ${ty}px) scale(${pinch.s})`;
    });
  }, { passive: false });
  const endPinch = (e) => {
    if (!pinch.active || e.touches.length >= 2) return;
    pinch.active = false;
    pagesEl.style.transform = '';
    pagesEl.style.willChange = '';
    if (Math.abs(pinch.s - 1) < 0.04) pinch.s = 1; // Tipp mit zwei Fingern o. Ä.: Zoom bleibt
    V.zoom = clamp(pinch.z0 * pinch.s, ZOOM_MIN, maxZoom());
    layout();
    // genau der Punkt, der zu Beginn zwischen den Fingern lag, landet wieder zwischen den Fingern
    restoreAnchor(pinch.anchor, pinch.mx, pinch.my);
    saveViewState();
  };
  viewer.addEventListener('touchend', endPinch);
  viewer.addEventListener('touchcancel', endPinch);
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('gesturechange', (e) => e.preventDefault());

  // Merkt sich, welcher Punkt der PDF-Seite unter (ax, ay) liegt – in Seitenkoordinaten, damit er nach dem Zoomen exakt wiedergefunden wird
  function anchorAt(ax, ay) {
    const x = viewer.scrollLeft + ax, y = viewer.scrollTop + ay;
    let P = V.pages[0];
    for (const Q of V.pages) { if (Q.el.offsetTop <= y) P = Q; else break; }
    const sc = P.cssW / P.w;
    return { P, u: (x - P.el.offsetLeft) / sc, v: (y - P.el.offsetTop) / sc };
  }
  function restoreAnchor(a, ax, ay) {
    const sc = a.P.cssW / a.P.w;
    viewer.scrollLeft = a.P.el.offsetLeft + a.u * sc - ax;
    viewer.scrollTop = a.P.el.offsetTop + a.v * sc - ay;
  }
  function setZoom(z, ax, ay) {
    if (V.board) { zoomAt(z / B.cam.s, ax ?? B.w / 2, ay ?? B.h / 2); return; }
    z = clamp(z, ZOOM_MIN, maxZoom());
    if (Math.abs(z / V.zoom - 1) < 1e-3 || !V.pages.length) return;
    ax = ax ?? viewer.clientWidth / 2;
    ay = ay ?? viewer.clientHeight / 2;
    const a = anchorAt(ax, ay);
    V.zoom = z;
    layout();
    restoreAnchor(a, ax, ay);
    saveViewState();
  }
  const zstep = (z, up) => (V.board ? 1.6 : 0) || (up ? (z >= 10 ? 2 : z >= 2 ? 1.5 : 1.25) : (z > 10 ? 2 : z > 2 ? 1.5 : 1.25));
  $('#zoomIn').onclick = () => setZoom(V.zoom * zstep(V.zoom, true));
  $('#zoomOut').onclick = () => setZoom(V.zoom / zstep(V.zoom, false));
  $('#zoomFit').onclick = () => (V.board ? boardFit() : zoomMenu($('#zoomFit')));
  viewer.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const vr = viewer.getBoundingClientRect();
    setZoom(V.zoom * Math.exp(-e.deltaY / 300), e.clientX - vr.left, e.clientY - vr.top);
  }, { passive: false });

  let scrollT, badgeRaf = 0;
  viewer.addEventListener('scroll', () => {
    if (!badgeRaf) badgeRaf = requestAnimationFrame(() => { badgeRaf = 0; updatePageBadge(); });
    clearTimeout(scrollT);
    scheduleDetail();
    bcPos();
    if (document.body.classList.contains('prs-on')) prsUpdate();
    if (LV.code && currentPageIndex() !== LV.pg) { LV.pg = currentPageIndex(); liveSoon(); }
    scrollT = setTimeout(saveViewState, 400);
  });
  function currentPageIndex() {
    const mid = viewer.scrollTop + viewer.clientHeight / 2;
    let i = 0;
    while (i < V.pages.length - 1 && V.pages[i + 1].top <= mid) i++;
    return i;
  }
  function updatePageBadge() {
    const b = $('#pageBadge');
    if (!V.pages.length) { b.hidden = true; return; }
    b.textContent = `${currentPageIndex() + 1} von ${V.pages.length}`;
    b.hidden = false;
    $('#ppPage').textContent = `${currentPageIndex() + 1} / ${V.pages.length}`;
  }
  function goToPage(i) {
    const P = V.pages[i];
    if (P) viewer.scrollTop = P.top - 10;
  }

  // ---- Seitenübersicht
  const OV = { filter: 'all', io: null };
  function openOverview() {
    track('tool', 'Seiten organisieren');
    if (!V.pages.length) return;
    closeMenus();
    $('#overview').hidden = false;
    renderOverview();
  }
  function closeOverview() {
    $('#overview').hidden = true;
    if (OV.io) OV.io.disconnect();
    $('#ovGrid').innerHTML = '';
  }
  function renderOverview() {
    const grid = $('#ovGrid');
    grid.innerHTML = '';
    if (OV.io) OV.io.disconnect();
    document.querySelectorAll('#overview .seg2 button').forEach((b) => b.classList.toggle('active', b.dataset.f === OV.filter));
    const withNotes = new Set([...V.doc.strokes.values()].map((s) => s.p));
    const curI = currentPageIndex();
    const list = V.pages.filter((P) => OV.filter === 'all' || withNotes.has(P.i));
    $('#ovEmpty').hidden = list.length > 0;
    OV.io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        OV.io.unobserve(en.target);
        ovThumb(en.target, V.pages[+en.target.dataset.i]);
      }
    }, { root: grid, rootMargin: '400px 0px' });
    let curEl = null;
    for (const P of list) {
      const b = document.createElement('div');
      b.className = 'ov-item' + (P.i === curI ? ' current' : '');
      b.dataset.i = P.i;
      b.innerHTML = `<button type="button" class="ov-open" aria-label="Seite ${P.i + 1}"><div class="pg" style="aspect-ratio:${P.w} / ${P.h}">${withNotes.has(P.i) ? '<span class="dot"></span>' : ''}</div><span class="n">${P.i + 1}</span></button>
        <button type="button" class="ov-more more" aria-label="Seite ${P.i + 1} bearbeiten">${MORE_SVG}</button>`;
      b.querySelector('.ov-open').onclick = () => { closeOverview(); goToPage(P.i); };
      b.querySelector('.ov-more').onclick = (ev) => { ev.stopPropagation(); pageMenu(ev.currentTarget, P.i); };
      grid.appendChild(b);
      OV.io.observe(b);
      if (P.i === curI) curEl = b;
    }
    if (curEl) requestAnimationFrame(() => curEl.scrollIntoView({ block: 'center' }));
  }
  async function ovThumb(btn, P) {
    const box = btn.querySelector('.pg');
    const W = Math.min(Math.max(box.clientWidth, 150) * Math.min(window.devicePixelRatio || 1, 2), 520);
    try { await pgOf(P); } catch (e) { return; }
    const vp = P.pg.getViewport({ scale: W / P.w });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    try { await P.pg.render({ annotationMode: AM, canvasContext: c.getContext('2d'), viewport: vp }).promise; } catch (e) { return; }
    const ctx = c.getContext('2d');
    pageStrokes(P.i).forEach((s) => strokePath(ctx, s, c.width / P.w));
    if (btn.isConnected) box.prepend(c);
  }
  $('#overviewBtn').onclick = openOverview;
  $('#ovClose').onclick = closeOverview;
  document.querySelectorAll('#overview .seg2 button').forEach((b) => { b.onclick = () => { OV.filter = b.dataset.f; renderOverview(); }; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#overview').hidden) closeOverview(); });

  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { if (V.pages.length) { const f = viewer.scrollTop / (viewer.scrollHeight || 1); layout(); viewer.scrollTop = f * viewer.scrollHeight; } }, 150);
  });

  // ------------------------------------------------------------------ Textfelder
  let editor = null;
  const r2 = (n) => Math.round(n * 100) / 100;
  function textAt(P, x, y) {
    let hit = null;
    for (const t of V.doc.strokes.values()) {
      if (t.p !== P.i || t.t !== 'txt') continue;
      const b = bbox(t);
      if (x >= b[0] - 4 && x <= b[2] + 4 && y >= b[1] - 4 && y <= b[3] + 4) hit = t;
    }
    return hit;
  }
  function measureTxt(text, fs, st) {
    const c = measureTxt.c || (measureTxt.c = document.createElement('canvas').getContext('2d'));
    c.font = txtCss(st, fs);
    const lines = String(text).split('\n');
    return { bw: Math.max(fs * 0.5, ...lines.map((l) => c.measureText(l).width)), bh: lines.length * fs * 1.25 };
  }
  // Zeilen auf eine feste Breite umbrechen (Breite und Ausgangstext bleiben im Textfeld gespeichert)
  function wrapTxt(text, fs, st, w) {
    const c = measureTxt.c || (measureTxt.c = document.createElement('canvas').getContext('2d'));
    c.font = txtCss(st, fs);
    const out = [];
    for (const par of String(text).split('\n')) {
      let line = '';
      for (const word of par.split(/(\s+)/)) {
        const t = line + word;
        if (line && c.measureText(t.replace(/\s+$/, '')).width > w && word.trim()) { out.push(line.replace(/\s+$/, '')); line = word.replace(/^\s+/, ''); }
        else line = t;
        // ein Wort länger als die Zeile: hart trennen
        while (c.measureText(line).width > w && line.length > 1) {
          let n = line.length - 1;
          while (n > 1 && c.measureText(line.slice(0, n)).width > w) n--;
          out.push(line.slice(0, n)); line = line.slice(n);
        }
      }
      out.push(line.replace(/\s+$/, ''));
    }
    return out;
  }
  const TXT_BG = ['', '#FFF59D', '#FFE0B2', '#C8E6C9', '#BBDEFB', '#F8BBD0', '#FFFFFF', '#E0E0E0'];
  const TXT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];
  const AL_SVG = { '': '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>', c: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>', r: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>' };
  function openTextEditor(P, e) {
    if (!P || !V.doc) return;
    setTimeout(() => { if (document.body.classList.contains('tp-on')) tpRender(); }, 0);
    if (editor) { commitEditor(); return; }
    const r = P.el.getBoundingClientRect();
    const sc = P.cssW / P.w;
    const x = (isMirror() ? r.right - e.clientX : e.clientX - r.left) / sc, y = (e.clientY - r.top) / sc;
    const old = textAt(P, x, y);
    const last = ls('ttStyle') || {};
    const ed = {
      P, old, sc,
      fs: old ? old.fs : S.ttSize, color: old ? old.c : S.color.tt,
      bg: old ? old.bg || '' : ls('ttBg') || '', bo: old ? old.bo || '' : ls('ttBo') || '',
      ff: old ? old.ff || '' : last.ff || '', b: old ? !!old.b : !!last.b, i: old ? !!old.i : !!last.i, al: old ? old.al || '' : last.al || '',
      w: old ? old.w || 0 : 0,
    };
    ed.px = old ? old.pts[0] : x;
    ed.py = old ? old.pts[1] : y - ed.fs * 0.6;
    editingId = old ? old.id : null;
    if (old) drawInk(P);
    const box = document.createElement('div');
    box.className = 'txt-editor';
    box.innerHTML = `<div class="te-tools" role="toolbar" aria-label="Text formatieren">
        <select class="te-ff" aria-label="Schriftart"><option value="">Helvetica</option><option value="serif">Times</option><option value="mono">Courier</option></select>
        <select class="te-fs" aria-label="Schriftgröße">${TXT_SIZES.map((n) => `<option value="${n}">${n} pt</option>`).join('')}</select>
        <button type="button" class="te-t" data-a="b" aria-label="Fett" title="Fett (Strg+B)"><b>B</b></button><button type="button" class="te-t" data-a="i" aria-label="Kursiv" title="Kursiv (Strg+I)"><i>I</i></button>
        <span class="te-sep"></span>
        ${['', 'c', 'r'].map((a) => `<button type="button" class="te-t te-al" data-al="${a}" aria-label="${{ '': 'Linksbündig', c: 'Zentriert', r: 'Rechtsbündig' }[a]}"><svg viewBox="0 0 24 24">${AL_SVG[a]}</svg></button>`).join('')}
        <span class="te-sep"></span>
        ${PALETTE.map(([hex, label]) => `<button type="button" class="te-c" data-c="${hex}" style="--c:${hex}" aria-label="${label}"></button>`).join('')}
        <span class="te-sep"></span>
        <button type="button" class="te-t" data-a="more" aria-label="Hintergrund und Rahmen" title="Hintergrund und Rahmen"><svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 15l5-5 4 4 3-3 4 4"/></svg></button>
        <button type="button" class="te-t" data-a="del" aria-label="${old ? 'Löschen' : 'Verwerfen'}" title="${old ? 'Löschen' : 'Verwerfen'}"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg></button>
        <button type="button" class="te-ok" data-a="ok">Fertig</button>
        <div class="te-more" hidden><span class="te-l">Hintergrund</span>${TXT_BG.map((c) => `<button type="button" class="te-bg" data-bg="${c}" style="--c:${c || 'transparent'}" aria-label="${c ? 'Hintergrund ' + c : 'kein Hintergrund'}">${c ? '' : '∅'}</button>`).join('')}<label class="te-bo"><input type="checkbox"> Rahmen</label></div>
      </div>
      <div class="te-frame"><textarea rows="1" spellcheck="true" aria-label="Text"></textarea><i class="te-h nw" data-h="move"></i><i class="te-h sw" data-h="move"></i><i class="te-h ne" data-h="w"></i><i class="te-h se" data-h="w"></i></div>`;
    const ta = box.querySelector('textarea');
    ta.value = old ? (old.src || old.text) : '';
    P.el.appendChild(box);
    ed.box = box; ed.ta = ta;
    const tools = box.querySelector('.te-tools');
    const place = () => {
      box.style.left = ed.px * ed.sc + 'px';
      box.style.top = ed.py * ed.sc + 'px';
      // Leiste über dem Textfeld – oder darunter, wenn oben kein Platz ist
      const top = P.el.getBoundingClientRect().top + ed.py * ed.sc;
      box.classList.toggle('below', top < 140);
    };
    const fit = () => {
      Object.assign(ta.style, { color: ed.color, fontSize: ed.fs * ed.sc + 'px', fontFamily: txtFam(ed), fontWeight: ed.b ? '700' : '400', fontStyle: ed.i ? 'italic' : 'normal',
        textAlign: { c: 'center', r: 'right' }[ed.al] || 'left', background: ed.bg || '', whiteSpace: ed.w ? 'pre-wrap' : 'pre' });
      ta.style.outline = ed.bo ? `${Math.max(1, ed.fs * 0.07 * ed.sc)}px solid ${ed.bo}` : '';
      ta.style.height = 'auto';
      if (ed.w) ta.style.width = ed.w * ed.sc + 'px';
      else { ta.style.width = 'auto'; ta.style.width = Math.max(60, ta.scrollWidth + 8) + 'px'; }
      ta.style.height = ta.scrollHeight + 'px';
      box.querySelector('.te-ff').value = ed.ff;
      const fsSel = box.querySelector('.te-fs');
      if (!TXT_SIZES.includes(ed.fs) && !fsSel.querySelector(`option[value="${ed.fs}"]`)) fsSel.insertAdjacentHTML('afterbegin', `<option value="${ed.fs}">${ed.fs} pt</option>`);
      fsSel.value = String(ed.fs);
      box.querySelector('[data-a=b]').classList.toggle('on', ed.b);
      box.querySelector('[data-a=i]').classList.toggle('on', ed.i);
      box.querySelectorAll('.te-al').forEach((b) => b.classList.toggle('on', b.dataset.al === ed.al));
      box.querySelectorAll('.te-c').forEach((b) => b.classList.toggle('on', b.dataset.c.toLowerCase() === String(ed.color).toLowerCase()));
      box.querySelectorAll('.te-bg').forEach((b) => b.classList.toggle('on', (b.dataset.bg || '') === (ed.bg || '')));
      place();
    };
    const remember = () => { if (!old) ls('ttStyle', { ff: ed.ff, b: ed.b, i: ed.i, al: ed.al }); };
    const refocus = () => setTimeout(() => ta.focus(), 0);
    ta.addEventListener('input', fit);
    ta.addEventListener('keydown', (ev) => {
      const ctrl = ev.ctrlKey || ev.metaKey;
      if (ctrl && (ev.key === 'b' || ev.key === 'B')) { ev.preventDefault(); ed.b = !ed.b; remember(); fit(); }
      else if (ctrl && (ev.key === 'i' || ev.key === 'I')) { ev.preventDefault(); ed.i = !ed.i; remember(); fit(); }
      else if ((ctrl && ev.key === 'Enter') || ev.key === 'Escape') { ev.preventDefault(); commitEditor(false); }
      ev.stopPropagation();
    });
    box.querySelector('.te-ff').onchange = (ev) => { ed.ff = ev.target.value; remember(); fit(); refocus(); };
    box.querySelector('.te-fs').onchange = (ev) => { ed.fs = +ev.target.value; S.ttSize = ed.fs; persistTools(); fit(); refocus(); };
    box.querySelector('[data-a=b]').onclick = () => { ed.b = !ed.b; remember(); fit(); refocus(); };
    box.querySelector('[data-a=i]').onclick = () => { ed.i = !ed.i; remember(); fit(); refocus(); };
    box.querySelectorAll('.te-al').forEach((b) => { b.onclick = () => { ed.al = b.dataset.al; remember(); fit(); refocus(); }; });
    box.querySelectorAll('.te-c').forEach((b) => { b.onclick = () => { ed.color = b.dataset.c; if (!old) { S.color.tt = ed.color; persistTools(); } fit(); refocus(); }; });
    box.querySelector('[data-a=more]').onclick = () => { const m = box.querySelector('.te-more'); m.hidden = !m.hidden; box.querySelector('[data-a=more]').classList.toggle('on', !m.hidden); refocus(); };
    box.querySelectorAll('.te-bg').forEach((b) => { b.onclick = () => { ed.bg = b.dataset.bg || ''; if (!old) ls('ttBg', ed.bg); fit(); refocus(); }; });
    box.querySelector('.te-bo input').checked = !!ed.bo;
    box.querySelector('.te-bo input').addEventListener('change', (ev) => { ed.bo = ev.target.checked ? '#1a1a1a' : ''; if (!old) ls('ttBo', ed.bo); fit(); refocus(); });
    box.querySelector('[data-a=ok]').onclick = () => commitEditor(false);
    box.querySelector('[data-a=del]').onclick = () => commitEditor(true);
    // Anfasser: links = verschieben, rechts = Breite (Text bricht dann um)
    box.querySelectorAll('.te-h').forEach((h) => {
      h.addEventListener('pointerdown', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        try { h.setPointerCapture(ev.pointerId); } catch (er) { /* */ }
        const x0 = ev.clientX, y0 = ev.clientY, px0 = ed.px, py0 = ed.py, w0 = ed.w || ta.offsetWidth / ed.sc;
        const mv = (m) => {
          const dx = (m.clientX - x0) / ed.sc, dy = (m.clientY - y0) / ed.sc;
          if (h.dataset.h === 'move') { ed.px = px0 + dx; ed.py = py0 + dy; place(); } else { ed.w = Math.max(ed.fs * 2, w0 + dx); fit(); }
        };
        const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); refocus(); };
        h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
      });
    });
    tools.addEventListener('pointerdown', (ev) => { if (!ev.target.closest('select')) ev.preventDefault(); }); // Fokus bleibt im Text
    editor = ed;
    fit();
    refocus();
  }
  function commitEditor(remove) {
    const ed = editor;
    if (!ed) return;
    editor = null;
    editingId = null;
    ed.box.remove();
    const raw = remove ? '' : ed.ta.value.replace(/\s+$/, '');
    const fmt = { ff: ed.ff, b: ed.b, i: ed.i, al: ed.al };
    const lines = ed.w ? wrapTxt(raw, ed.fs, fmt, ed.w) : raw.split('\n');
    const text = lines.join('\n');
    const o = ed.old || {};
    const acts = [];
    const styled = ed.old && (ed.fs !== o.fs || ed.color !== o.c || (ed.bg || '') !== (o.bg || '') || (ed.bo || '') !== (o.bo || '') ||
      (ed.ff || '') !== (o.ff || '') || ed.b !== !!o.b || ed.i !== !!o.i || (ed.al || '') !== (o.al || '') || (ed.w || 0) !== (o.w || 0) ||
      ed.px !== o.pts[0] || ed.py !== o.pts[1]);
    const same = ed.old && raw === (o.src || o.text);
    if (ed.old && (remove || !same || styled)) {
      opDel(V.path, [ed.old.id]);
      acts.push({ t: 'del', strokes: [ed.old] });
    }
    if (text && (!ed.old || !same || styled)) {
      const m = measureTxt(text, ed.fs, fmt);
      const st = { id: uid(), p: ed.P.i, t: 'txt', c: ed.color, fs: ed.fs, pts: [r2(ed.px), r2(ed.py)], text, bw: r2(ed.w ? Math.max(ed.w, m.bw) : m.bw), bh: r2(m.bh) };
      if (ed.bg) st.bg = ed.bg;
      if (ed.bo) st.bo = ed.bo;
      if (ed.ff) st.ff = ed.ff;
      if (ed.b) st.b = 1;
      if (ed.i) st.i = 1;
      if (ed.al) st.al = ed.al;
      if (ed.w) { st.w = r2(ed.w); if (raw !== text) st.src = raw; }
      if (o.r) st.r = o.r;
      if (o.sn) st.sn = 1;
      opAdd(V.path, [st]);
      acts.push({ t: 'add', strokes: [st] });
    }
    if (acts.length) pushHistory(acts.length === 1 ? acts[0] : { t: 'multi', acts });
    drawInk(ed.P);
    if (document.body.classList.contains('tp-on')) setTimeout(tpRender, 0);
  }
  document.addEventListener('pointerdown', (e) => {
    if (editor && !e.target.closest('.txt-editor')) { commitEditor(false); ttDown = null; }
  });

  // ------------------------------------------------------------------ Suche
  const SR = { hits: [], i: -1, token: 0, q: '' };
  async function pageTextIndex(P) {
    if (P.sidx) return P.sidx;
    const tc = await (await pgOf(P)).getTextContent();
    let str = '';
    const items = [];
    for (const it of tc.items) {
      if (it.str) {
        const tr = it.transform;
        const h = Math.hypot(tr[2], tr[3]) || 10;
        const w = it.width || h * it.str.length * 0.5;
        const r = vpRect(P.vp, [tr[4], tr[5] - h * 0.24, tr[4] + w, tr[5] + h * 0.9]);
        items.push({ s: it.str, start: str.length, n: it.str.length, x: Math.min(r[0], r[2]), y: Math.min(r[1], r[3]), w: Math.abs(r[2] - r[0]), h: Math.abs(r[3] - r[1]) });
        str += it.str;
      }
      if (it.hasEOL) str += ' ';
    }
    P.sidx = { str: str.toLowerCase(), items };
    return P.sidx;
  }
  function matchRects(idx, s0, e0) {
    const out = [];
    for (const it of idx.items) {
      const a = Math.max(s0, it.start), b = Math.min(e0, it.start + it.n);
      if (a >= b) continue;
      const cw = it.w / Math.max(1, it.n);
      out.push({ x: it.x + (a - it.start) * cw, y: it.y, w: (b - a) * cw, h: it.h });
    }
    return out;
  }
  function clearHits() { pagesEl.querySelectorAll('.hits').forEach((d) => d.remove()); }
  function drawHits(P) {
    const old = P.el.querySelector('.hits');
    if (old) old.remove();
    const mine = SR.hits.filter((h) => h.P === P);
    if (!mine.length) return;
    const box = document.createElement('div');
    box.className = 'hits';
    for (const h of mine) {
      h.els = h.rects.map((r) => {
        const d = document.createElement('div');
        d.className = 'hit';
        d.style.cssText = `left:${(r.x / P.w) * 100}%;top:${(r.y / P.h) * 100}%;width:${(r.w / P.w) * 100}%;height:${(r.h / P.h) * 100}%`;
        box.appendChild(d);
        return d;
      });
    }
    P.el.appendChild(box);
  }
  function showHit(i) {
    if (V.board) { boardShowHit(i); return; }
    if (!SR.hits.length) return;
    SR.i = (i + SR.hits.length) % SR.hits.length;
    pagesEl.querySelectorAll('.hit.cur').forEach((d) => d.classList.remove('cur'));
    const h = SR.hits[SR.i];
    (h.els || []).forEach((d) => d.classList.add('cur'));
    const sc = h.P.cssW / h.P.w;
    const r = h.rects[0];
    viewer.scrollTop = h.P.el.offsetTop + r.y * sc - viewer.clientHeight * 0.35;
    if (h.P.cssW > viewer.clientWidth) viewer.scrollLeft = h.P.el.offsetLeft + r.x * sc - viewer.clientWidth * 0.3;
    $('#qInfo').textContent = `${SR.i + 1} von ${SR.hits.length}`;
  }
  // ---- Suche auf der Notizseite: getippter Text und Text übernommener Folien (Handschrift wird nicht erkannt)
  const BS = { texts: new Map() };
  async function boardSearch(q) {
    const token = ++SR.token;
    SR.q = q.trim().toLowerCase();
    SR.hits = []; SR.i = -1;
    boardRender();
    if (SR.q.length < 2 || !V.doc) { $('#qInfo').textContent = ''; return; }
    const words = SR.q.split(/\s+/).filter(Boolean);
    const slides = [...V.doc.strokes.values()].filter((s) => s.t === 'img' && s.ln && !isBoard(s.ln.path));
    const need = slides.filter((s) => !BS.texts.has(s.ln.path + '|' + s.ln.pg));
    if (need.length && navigator.onLine !== false) {
      try {
        const r = await apiJson('pgtext', { method: 'POST', body: { refs: need.map((s) => [s.ln.path, s.ln.pg]) } });
        need.forEach((s, k) => BS.texts.set(s.ln.path + '|' + s.ln.pg, String(r.texts[k] || '').toLowerCase()));
      } catch (e) { /* ohne Folientext */ }
      if (token !== SR.token) return;
    }
    // erst die genaue Wortfolge, sonst alle Wörter irgendwo im selben Text
    for (const all of [false, true]) {
      for (const s of V.doc.strokes.values()) {
        const t = (s.t === 'txt' ? String(s.text || '').toLowerCase() : s.t === 'img' && s.ln ? BS.texts.get(s.ln.path + '|' + s.ln.pg) || '' : '').replace(/\s+/g, ' ');
        if (t && (all ? words.every((w) => t.includes(w)) : t.includes(words.join(' ')))) SR.hits.push({ s, w: worldBox(s) });
      }
      if (SR.hits.length) break;
    }
    SR.hits.sort((a, b) => (Math.abs(a.w[1] - b.w[1]) > 20 ? a.w[1] - b.w[1] : a.w[0] - b.w[0]));
    if (!SR.hits.length) { $('#qInfo').textContent = 'Keine Treffer'; boardRender(); return; }
    boardShowHit(0);
  }
  function boardShowHit(i) {
    if (!SR.hits.length) return;
    SR.i = (i + SR.hits.length) % SR.hits.length;
    const w = SR.hits[SR.i].w;
    const fit = Math.min((B.w * 0.8) / Math.max(1, w[2] - w[0]), (B.h * 0.8) / Math.max(1, w[3] - w[1]));
    if (B.cam.s > fit || B.cam.s < fit * 0.25) B.cam.s = clamp(Math.min(1.2, fit), ZMIN, ZMAX);
    B.cam.x = (w[0] + w[2]) / 2 - B.w / 2 / B.cam.s; B.cam.y = (w[1] + w[3]) / 2 - B.h / 2 / B.cam.s;
    $('#qInfo').textContent = `${SR.i + 1} von ${SR.hits.length}`;
    boardRender();
  }
  // Treffer markieren (aktueller kräftiger)
  function drawBoardHits(ctx) {
    if (!SR.hits.length || !V.board) return;
    const d = B.dpr;
    SR.hits.forEach((h, k) => {
      const [x0, y0] = toScreen(h.w[0], h.w[1]), [x1, y1] = toScreen(h.w[2], h.w[3]);
      ctx.fillStyle = k === SR.i ? 'rgba(255,170,0,.28)' : 'rgba(255,214,0,.2)';
      ctx.strokeStyle = k === SR.i ? '#F08C00' : 'rgba(240,140,0,.55)';
      ctx.lineWidth = (k === SR.i ? 2.5 : 1.2) * d;
      const pad = 4 * d;
      if (h.s.t === 'img') ctx.strokeRect(x0 * d - pad, y0 * d - pad, (x1 - x0) * d + 2 * pad, (y1 - y0) * d + 2 * pad);
      else { ctx.fillRect(x0 * d - pad, y0 * d - pad, (x1 - x0) * d + 2 * pad, (y1 - y0) * d + 2 * pad); ctx.strokeRect(x0 * d - pad, y0 * d - pad, (x1 - x0) * d + 2 * pad, (y1 - y0) * d + 2 * pad); }
    });
  }
  async function runSearch(q) {
    if (V.board) { boardSearch(q); return; }
    clearHits();
    const token = ++SR.token;
    SR.q = q.trim().toLowerCase();
    SR.hits = [];
    SR.i = -1;
    if (SR.q.length < 2) { $('#qInfo').textContent = ''; return; }
    $('#qInfo').textContent = 'Suche …';
    const start = currentPageIndex();
    for (const P of V.pages) {
      const idx = await pageTextIndex(P).catch(() => null);
      if (token !== SR.token) return;
      if (!idx) continue;
      for (let k = idx.str.indexOf(SR.q); k >= 0; k = idx.str.indexOf(SR.q, k + SR.q.length)) {
        const rects = matchRects(idx, k, k + SR.q.length);
        if (rects.length) SR.hits.push({ P, rects });
      }
      drawHits(P);
      if (SR.hits.length) $('#qInfo').textContent = `${SR.hits.length} Treffer …`;
    }
    if (!SR.hits.length) { $('#qInfo').textContent = 'Keine Treffer'; return; }
    const first = SR.hits.findIndex((h) => h.P.i >= start);
    showHit(first < 0 ? 0 : first);
  }
  function openSearch() {
    track('tool', V.board ? 'Suche auf der Notizseite' : 'Suche in der PDF');
    if (!V.path) return;
    $('#searchRow').hidden = false;
    $('#searchBtn').setAttribute('aria-expanded', 'true');
    setTimeout(() => $('#q').focus(), 0);
  }
  function closeSearch() {
    SR.token++;
    SR.hits = [];
    clearHits();
    if (V.board) boardRender();
    $('#searchRow').hidden = true;
    $('#searchBtn').setAttribute('aria-expanded', 'false');
    $('#q').value = '';
    $('#qInfo').textContent = '';
  }
  let qT;
  $('#searchBtn').onclick = () => ($('#searchRow').hidden ? openSearch() : closeSearch());
  $('#q').addEventListener('input', (e) => { clearTimeout(qT); qT = setTimeout(() => runSearch(e.target.value), 350); });
  $('#q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (SR.hits.length && SR.q === e.target.value.trim().toLowerCase()) showHit(SR.i + (e.shiftKey ? -1 : 1)); else runSearch(e.target.value); }
    if (e.key === 'Escape') closeSearch();
  });
  $('#qNext').onclick = () => showHit(SR.i + 1);
  $('#qPrev').onclick = () => showHit(SR.i - 1);
  $('#qClose').onclick = closeSearch;

  // ------------------------------------------------------------------ Vollbild: Leisten weg, nur die Seite (Knopf unten rechts)
  const FS = { on: false, native: false };
  function setFocusMode(on) {
    if (on === FS.on) return;
    FS.on = on;
    document.body.classList.toggle('focus', on);
    $('#fsBtn').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('#fsBtn').title = on ? 'Vollbild beenden' : 'Vollbild: Leisten ausblenden';
    $('#fsBtn').setAttribute('aria-label', on ? 'Vollbild beenden' : 'Vollbild');
    const el = document.documentElement;
    const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
    try {
      if (on && !fsEl()) {
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (req) { const r = req.call(el); FS.native = true; if (r && r.catch) r.catch(() => { FS.native = false; }); }
      } else if (!on && FS.native && fsEl()) {
        const ex = document.exitFullscreen || document.webkitExitFullscreen;
        if (ex) { const r = ex.call(document); if (r && r.catch) r.catch(() => {}); }
      }
    } catch (e) { FS.native = false; }
    if (!on) FS.native = false;
    // Seitenbreite neu berechnen (die Leisten sind weg bzw. wieder da)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (V.board) { boardResize(); boardRender(); return; }
      if (V.pages.length) { const a = anchorAt(viewer.clientWidth / 2, viewer.clientHeight / 2); layout(); restoreAnchor(a, viewer.clientWidth / 2, viewer.clientHeight / 2); }
    }));
  }
  $('#fsBtn').onclick = () => setFocusMode(!FS.on);
  const onFsExit = () => { if (FS.on && FS.native && !(document.fullscreenElement || document.webkitFullscreenElement)) { FS.native = false; setFocusMode(false); } };
  document.addEventListener('fullscreenchange', onFsExit);
  document.addEventListener('webkitfullscreenchange', onFsExit);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && FS.on && !PR.on) setFocusMode(false); });

  // ------------------------------------------------------------------ Präsentation (Beamer, Bildschirmspiegelung)
  const PR = { on: false, zoom: 1, fs: false, idleT: 0, prompter: false };
  function setMirror(on) {
    document.body.classList.toggle('mirror', on);
    const b = $('#ppMirror');
    if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false');
    V.pages.forEach(dropDetail);
    scheduleDetail(50);
  }
  if (BC && !PROMPTER) {
    if (!SHOW && !EMBED) BC.onmessage = (ev) => {
      if (!ev.data) return;
      if (ev.data.t === 'hello') { PR.prompter = true; if (!document.body.classList.contains('prs-on') && V.path) prsStart(true); bcDoc(); prsUpdate(); }
      if (ev.data.t === 'showbye') prsStop(true);
    };
  }

  // ---- Präsentationsfenster (nur die Folie; für Beamer und Teams-Freigabe)
  const SW = { live: null, i: -1 };
  function showWinStart() {
    document.title = 'Präsentation – PDF-Stift';
    // Beamer-Fenster einer Präsentation (Referentenansicht der Folien)
    if (/[?&]dk=1\b/.test(location.search)) { ensureDeck().then((DK) => DK.audience()).catch(() => {}); return; }
    PR.on = true; // Einzelseiten, ganze Folie
    if (!BC) return;
    const fit = (i) => { if (!V.pages.length) return; SW.i = clamp(i, 0, V.pages.length - 1); fitPageHeight(SW.i); };
    BC.onmessage = async (ev) => {
      const m = ev.data || {};
      if (m.t === 'doc' && m.path && m.path !== V.path) {
        if (!fileMeta(m.path)) { try { await loadLibrary(); } catch (e) { /* */ } }
        await showDoc(m.path);
        document.title = 'Präsentation – PDF-Stift';
        setTimeout(() => fit(SW.i < 0 ? 0 : SW.i), 300);
      }
      if (m.path && m.path !== V.path) return;
      if (m.t === 'strokes' && V.doc) {
        V.doc.strokes = new Map((m.strokes || []).filter((x) => !x.nt).map((x) => [x.id, x]));
        redrawAllInk();
      }
      if (m.t === 'pos') { const pi = typeof m.ci === 'number' ? m.ci : m.i; if (typeof pi === 'number' && pi !== SW.i) fit(pi); }
      if (m.t === 'live' && V.doc) {
        const old = SW.live;
        if (m.st && !m.st.nt) { SW.live = m.st; V.doc.strokes.set('_live', { ...m.st, id: '_live' }); } else { SW.live = null; V.doc.strokes.delete('_live'); }
        const pg = (m.st && m.st.p) ?? (old && old.p);
        if (V.pages[pg]) drawInk(V.pages[pg]);
      }
      if (m.t === 'laser') { LZ.trails = (m.trails || []).map((x) => ({ p: x.p, pts: x.pts, live: false })); laserKick(); }
      if (m.t === 'close') window.close();
      if (m.t === 'ping') BC.postMessage({ t: 'hello' });
    };
    window.addEventListener('resize', () => { if (SW.i >= 0) setTimeout(() => fit(SW.i), 60); });
    window.addEventListener('pagehide', () => { try { BC.postMessage({ t: 'showbye' }); } catch (e) { /* */ } });
    // Doppelklick: Vollbild an/aus (z. B. wenn das Fenster auf den Beamer gezogen wurde)
    document.addEventListener('dblclick', () => { const el = document.documentElement; if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else if (el.requestFullscreen) el.requestFullscreen().catch(() => {}); });
    BC.postMessage({ t: 'hello' });
  }

  // ---- Referentenansicht im Hauptfenster: nächste Folie, Stoppuhr, Uhrzeit, eigene Notizen (Notizzettel der Seite)
  const PRS = { win: null, t0: 0, paused: 0, pauseAt: 0, timer: 0, poll: 0, nextI: -1 };
  function prsStart(reuse) {
    if (!V.path || V.board) { toast('Bitte zuerst eine PDF öffnen.'); return; }
    if (PR.on) setPresent(false);
    if (!reuse) {
      track('tool', 'Referentenansicht');
      const base = location.pathname.replace(/[^/]*$/, '') + (LANG === 'en' ? 'index.en.php' : 'index.php');
      if (!PRS.win || PRS.win.closed) PRS.win = window.open(base + '?show=1', 'pdfstift-show', 'popup=yes,width=1280,height=720');
      if (!PRS.win) { toast('Das Präsentationsfenster wurde blockiert – bitte Pop-ups für diese Seite erlauben.', 7000); return; }
    }
    let box = $('#prsPanel');
    if (!box) {
      box = document.createElement('aside');
      box.id = 'prsPanel'; box.className = 'prs-panel';
      box.innerHTML = `<div class="prs-head"><b>Referentenansicht</b><button type="button" class="icon-btn" id="prsClose" title="Präsentation beenden" aria-label="Präsentation beenden"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
        <div class="prs-time"><div><span id="prsClock" class="num"></span><small>Uhrzeit</small></div><div><span id="prsTimer" class="num">0:00</span><small>vergangen</small></div>
          <span class="prs-tbtn"><button type="button" class="icon-btn" id="prsPause" title="Stoppuhr anhalten / weiter" aria-label="Stoppuhr anhalten"><svg viewBox="0 0 24 24"><path d="M9 6v12M15 6v12"/></svg></button><button type="button" class="icon-btn" id="prsReset" title="Stoppuhr auf null" aria-label="Stoppuhr zurücksetzen"><svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4"/></svg></button></span></div>
        <div class="prs-nav"><button type="button" class="btn" id="prsPrev">‹ Zurück</button><span id="prsPage" class="num"></span><button type="button" class="btn primary" id="prsNext">Weiter ›</button></div>
        <h4>Nächste Folie</h4><div class="prs-next"><canvas id="prsNextC"></canvas><span id="prsNextNone" class="muted small" hidden>Das war die letzte Seite.</span></div>
        <h4>Ihre Notizen zu dieser Folie</h4><div id="prsNotes" class="prs-notes"></div>
        <p class="muted small prs-hint">Notizzettel (Kommentare) erscheinen nur hier, nicht auf dem Beamer. Stift, Marker und Laserpointer sehen alle.</p>`;
      document.body.appendChild(box);
      box.querySelector('#prsClose').onclick = () => prsStop();
      box.querySelector('#prsPrev').onclick = () => goToPage(Math.max(0, currentPageIndex() - 1));
      box.querySelector('#prsNext').onclick = () => goToPage(Math.min(V.pages.length - 1, currentPageIndex() + 1));
      box.querySelector('#prsPause').onclick = () => { if (PRS.pauseAt) { PRS.paused += Date.now() - PRS.pauseAt; PRS.pauseAt = 0; } else PRS.pauseAt = Date.now(); prsTick(); };
      box.querySelector('#prsReset').onclick = () => { PRS.t0 = Date.now(); PRS.paused = 0; PRS.pauseAt = 0; prsTick(); };
    }
    box.hidden = false;
    document.body.classList.add('prs-on');
    PRS.t0 = Date.now(); PRS.paused = 0; PRS.pauseAt = 0; PRS.nextI = -1;
    clearInterval(PRS.timer); PRS.timer = setInterval(prsTick, 1000); prsTick();
    clearInterval(PRS.poll); PRS.poll = setInterval(() => { if (PRS.win && PRS.win.closed) prsStop(true); }, 1000);
    if (!reuse) toast('Präsentationsfenster geöffnet. Bei Teams: dieses Fenster „Präsentation – PDF-Stift“ freigeben. Doppelklick darin = Vollbild.', 7000);
    $('#presentBtn').setAttribute('aria-pressed', 'true');
    window.dispatchEvent(new Event('resize'));
    setTimeout(() => { PR.prompter = true; bcDoc(); prsUpdate(); }, 600);
  }
  function prsStop(closed) {
    if (!document.body.classList.contains('prs-on')) return;
    if (!closed && BC) BC.postMessage({ t: 'close' });
    try { if (!closed && PRS.win && !PRS.win.closed) PRS.win.close(); } catch (e) { /* */ }
    PRS.win = null; PR.prompter = false;
    clearInterval(PRS.timer); clearInterval(PRS.poll);
    document.body.classList.remove('prs-on');
    const box = $('#prsPanel'); if (box) box.hidden = true;
    $('#presentBtn').setAttribute('aria-pressed', 'false');
    window.dispatchEvent(new Event('resize'));
  }
  function prsTick() {
    const c = $('#prsClock'); if (!c) return;
    c.textContent = new Date().toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' });
    const ms = (PRS.pauseAt || Date.now()) - PRS.t0 - PRS.paused, sec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s2 = sec % 60;
    $('#prsTimer').textContent = (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s2).padStart(2, '0');
    $('#prsTimer').classList.toggle('paused', !!PRS.pauseAt);
  }
  let prsT = 0;
  function prsUpdate() {
    if (!document.body.classList.contains('prs-on') || !V.pages.length) return;
    clearTimeout(prsT);
    prsT = setTimeout(async () => {
      const i = currentPageIndex(), n = V.pages.length;
      $('#prsPage').textContent = `Seite ${i + 1} von ${n}`;
      const notes = V.doc ? [...V.doc.strokes.values()].filter((s) => s.p === i && s.nt && s.text) : [];
      $('#prsNotes').innerHTML = notes.length ? notes.map((s) => `<p>${esc(s.text)}</p>`).join('') : '<p class="muted small">Keine Notizen auf dieser Seite.</p>';
      const ni = i + 1;
      $('#prsNextNone').hidden = ni < n;
      const cv = $('#prsNextC');
      cv.hidden = ni >= n;
      if (ni < n && ni !== PRS.nextI) {
        PRS.nextI = ni;
        try {
          const pg = await pgOf(V.pages[ni]);
          const w = cv.parentElement.clientWidth || 280, vp0 = pg.getViewport({ scale: 1 });
          const dpr = Math.min(window.devicePixelRatio || 1, 2), sc = (w / vp0.width) * dpr;
          const vp = pg.getViewport({ scale: sc });
          cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
          cv.style.width = w + 'px'; cv.style.height = Math.round(vp.height / dpr) + 'px';
          await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
        } catch (e) { PRS.nextI = -1; }
      }
    }, 120);
  }
  // Präsentation-Knopf: Auswahl zwischen Vollbild hier und Referentenansicht
  function presentMenu(btn) {
    if (document.body.classList.contains('prs-on')) { prsStop(); return; }
    if (PR.on) { setPresent(false); return; }
    closeMenus();
    const m = document.createElement('div');
    m.className = 'menu present-menu';
    const r = btn.getBoundingClientRect();
    m.style.cssText = `position:fixed;top:${Math.round(r.bottom + 4)}px;left:${Math.round(Math.min(r.left, window.innerWidth - 330))}px`;
    m.innerHTML = `<button type="button" data-p="prs"><b>Mit Referentenansicht</b><br><span class="muted small">Folie im eigenen Fenster für Beamer oder Teams – hier: nächste Folie, Uhr, Notizen</span></button>
      <button type="button" data-p="full"><b>Vollbild auf diesem Bildschirm</b><br><span class="muted small">Folie bildschirmfüllend, mit Laserpointer</span></button>`;
    m.onclick = (e) => { const b = e.target.closest('[data-p]'); if (!b) return; closeMenus(); if (b.dataset.p === 'prs') prsStart(); else setPresent(true); };
    document.body.appendChild(m);
    openMenu = m;
  }

  function presentScrollTo(i) {
    const P = V.pages[clamp(i, 0, V.pages.length - 1)];
    if (!P) return;
    viewer.scrollTop = P.el.offsetTop - Math.max(8, (viewer.clientHeight - P.cssH) / 2);
  }
  function fitPageHeight(i) {
    const P = V.pages[i];
    if (!P) return;
    layout();
    const h1 = P.cssH / V.zoom;
    V.zoom = clamp(Math.min(1, (viewer.clientHeight - 16) / h1), ZOOM_MIN, maxZoom());
    layout();
    presentScrollTo(i);
  }
  function wakePanel() {
    const p = $('#presentPanel');
    p.classList.remove('idle');
    clearTimeout(PR.idleT);
    PR.idleT = setTimeout(() => p.classList.add('idle'), 3000);
  }
  function setPresent(on) {
    if (on === PR.on) return;
    if (on && !V.path) { toast('Öffne zuerst eine PDF.'); return; }
    if (on) { setFocusMode(false); track('tool', 'Präsentation'); }
    const i = currentPageIndex();
    PR.on = on;
    document.body.classList.toggle('present', on);
    $('#presentBtn').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('#presentPanel').hidden = !on;
    if (editor) commitEditor(false);
    if (on) {
      closeMenus();
      $('#presentFavs').appendChild($('#favs'));
      PR.zoom = V.zoom;
      const el = document.documentElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req && !(document.fullscreenElement || document.webkitFullscreenElement)) {
        try {
          const r = req.call(el);
          PR.fs = true;
          if (r && r.catch) r.catch(() => { PR.fs = false; });
        } catch (e) { PR.fs = false; }
      }
      wakePanel();
      requestAnimationFrame(() => requestAnimationFrame(() => fitPageHeight(i)));
    } else {
      document.querySelector('.toolbar .tb-row').prepend($('#favs'));
      setMirror(false);
      $('#presentFavs').hidden = true;
      $('#ppPen').setAttribute('aria-expanded', 'false');
      const ex = document.exitFullscreen || document.webkitExitFullscreen;
      if (PR.fs && (document.fullscreenElement || document.webkitFullscreenElement) && ex) {
        try { const r = ex.call(document); if (r && r.catch) r.catch(() => {}); } catch (e) { /* */ }
      }
      PR.fs = false;
      if (V.pages.length) {
        requestAnimationFrame(() => requestAnimationFrame(() => { V.zoom = PR.zoom; layout(); goToPage(i); }));
      }
    }
  }
  const onFsChange = () => {
    if (PR.on && PR.fs && !(document.fullscreenElement || document.webkitFullscreenElement)) { PR.fs = false; setPresent(false); }
  };
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  $('#presentBtn').onclick = (e) => { e.stopPropagation(); presentMenu($('#presentBtn')); };
  $('#ppExit').onclick = () => setPresent(false);
  $('#ppMirror').onclick = () => { setMirror(!isMirror()); wakePanel(); };
  $('#ppPrev').onclick = () => { presentScrollTo(currentPageIndex() - 1); wakePanel(); };
  $('#ppNext').onclick = () => { presentScrollTo(currentPageIndex() + 1); wakePanel(); };
  $('#ppUndo').onclick = () => { undo(); wakePanel(); };
  $('#ppPen').onclick = () => {
    const f = $('#presentFavs');
    f.hidden = !f.hidden;
    $('#ppPen').setAttribute('aria-expanded', f.hidden ? 'false' : 'true');
    wakePanel();
  };
  $('#presentPanel').addEventListener('pointerdown', wakePanel);
  document.addEventListener('keydown', (e) => {
    if (!PR.on || e.target.matches('input, textarea')) return;
    if (e.key === 'Escape') setPresent(false);
    // Präsentations-Fernbedienungen senden „Bild ab/auf“
    if (['PageDown', 'ArrowRight', 'ArrowDown', ' '].includes(e.key)) { e.preventDefault(); presentScrollTo(currentPageIndex() + 1); }
    if (['PageUp', 'ArrowLeft', 'ArrowUp'].includes(e.key)) { e.preventDefault(); presentScrollTo(currentPageIndex() - 1); }
  });

  // ------------------------------------------------------------------ Laserpointer: zeigen und einkreisen, verblasst nach 2 Sekunden
  const LASER_HOLD = 1300, LASER_FADE = 2000;
  const LZ = { trails: [], raf: 0, canvas: null, bcT: 0, prev: null };
  function laserCanvas() {
    if (!LZ.canvas) {
      const c = document.createElement('canvas');
      c.className = 'laser-layer';
      c.setAttribute('aria-hidden', 'true');
      document.body.appendChild(c);
      LZ.canvas = c;
    }
    const c = LZ.canvas, dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(window.innerWidth * dpr), h = Math.round(window.innerHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return c;
  }
  function laserTick() {
    LZ.raf = 0;
    const now = Date.now();
    LZ.trails = LZ.trails.filter((t) => t.live || (t.pts.length && now - t.pts[t.pts.length - 1][2] < LASER_FADE));
    for (const t of LZ.trails) while (t.pts.length > 2 && now - t.pts[0][2] > LASER_FADE) t.pts.shift();
    const c = laserCanvas();
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (!LZ.trails.length) return;
    const dpr = c.width / window.innerWidth;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const alpha = (t) => { const age = now - t; return age < LASER_HOLD ? 1 : Math.max(0, 1 - (age - LASER_HOLD) / (LASER_FADE - LASER_HOLD)); };
    for (const t of LZ.trails) {
      let X, Y;
      if (t.board) {
        if (!V.board) continue;
        const r = boardEl.getBoundingClientRect();
        X = (x) => r.left + (x - B.cam.x) * B.cam.s; Y = (y) => r.top + (y - B.cam.y) * B.cam.s;
      } else {
        const P = V.pages[t.p];
        if (!P || !P.el || V.board) continue;
        const r = P.el.getBoundingClientRect();
        const s = r.width / P.w;
        X = (x) => (isMirror() ? r.right - x * s : r.left + x * s); Y = (y) => r.top + y * s;
      }
      const p = t.pts;
      // Leuchtspur: breiter roter Schein, darüber ein heller Kern
      for (const [lw, col, blur] of [[9, 'rgba(255,40,40,', 14], [3.2, 'rgba(255,215,215,', 0]]) {
        ctx.lineWidth = lw;
        ctx.shadowColor = 'rgba(255,0,0,0.9)';
        ctx.shadowBlur = blur;
        for (let i = 1; i < p.length; i++) {
          const a = alpha(p[i][2]);
          if (a <= 0) continue;
          ctx.strokeStyle = col + (a * (lw > 5 ? 0.55 : 0.95)).toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(X(p[i - 1][0]), Y(p[i - 1][1]));
          ctx.lineTo(X(p[i][0]), Y(p[i][1]));
          ctx.stroke();
        }
      }
      // Punkt an der Stiftspitze
      const h = p[p.length - 1];
      const a = alpha(h[2]);
      if (a > 0) {
        ctx.shadowBlur = 18;
        ctx.fillStyle = `rgba(255,30,30,${a})`;
        ctx.beginPath(); ctx.arc(X(h[0]), Y(h[1]), 6.5, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = `rgba(255,235,235,${a})`;
        ctx.beginPath(); ctx.arc(X(h[0]), Y(h[1]), 2.4, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.shadowBlur = 0;
    LZ.raf = requestAnimationFrame(laserTick);
  }
  function laserKick() { if (!LZ.raf) LZ.raf = requestAnimationFrame(laserTick); }
  function laserAdd(t) {
    laserKick();
    // an Teleprompter-Fenster und Live-Mitschau weitergeben (gebündelt)
    if (BC && !PROMPTER && PR.prompter && !LZ.bcT) {
      LZ.bcT = setTimeout(() => { LZ.bcT = 0; BC.postMessage({ t: 'laser', path: V.path, trails: LZ.trails.map((x) => ({ p: x.p, pts: x.pts })) }); }, 40);
    }
    if (t) liveSoon(true);
  }
  function setLaser(on) {
    if (on === (S.tool === 'lp')) return;
    if (on) { LZ.prev = S.tool; S.tool = 'lp'; } else { S.tool = LZ.prev && LZ.prev !== 'lp' ? LZ.prev : 'pen'; }
    persistTools(); renderToolbar();
  }
  window.addEventListener('resize', () => { if (LZ.trails.length) laserKick(); });
  viewer.addEventListener('scroll', () => { if (LZ.trails.length) laserKick(); }, { passive: true });

  // ------------------------------------------------------------------ Live-Mitschau: Studierende sehen die aktuelle Seite live (ohne Anmeldung)
  const LV = { code: null, viewers: 0, t: 0, last: 0, keep: 0, sentStrokes: '', busy: false, again: false, panel: false };
  const liveUrl = (code) => new URL('live.php?c=' + code, location.href).href;
  async function sessStart() {
    track('tool', 'Live-Mitschau');
    if (!V.path || V.board) { toast('Öffne zuerst die PDF, die du zeigen willst (für Notizseiten gibt es die Live-Mitschau noch nicht).'); return; }
    if (navigator.onLine === false) { toast('Die Live-Mitschau braucht eine Internetverbindung.'); return; }
    if (LV.code) { showLivePanel(true); return; }
    try {
      const r = await apiJson('livestart', { method: 'POST', body: { path: V.path } });
      LV.code = r.code;
      LV.sentStrokes = '';
      LV.viewers = 0;
      ls('liveCode', { code: r.code, t: Date.now() });
      LV.keep = setInterval(() => livePush(), 10000);
      livePush();
      showLivePanel(true);
      updateLiveUi();
    } catch (e) { toast(e.offline ? 'Keine Verbindung zum Server.' : e.message, 6000); }
  }
  async function sessStop() {
    const code = LV.code;
    if (!code) return;
    LV.code = null;
    clearInterval(LV.keep);
    clearTimeout(LV.t);
    ls('liveCode', null);
    showLivePanel(false);
    updateLiveUi();
    try { await apiJson('livestop', { method: 'POST', body: { code } }); } catch (e) { /* läuft nach 8 Stunden ohnehin ab */ }
    toast('Live-Mitschau beendet.');
  }
  function liveSoon(fast) {
    if (!LV.code || PROMPTER) return;
    if (LV.t) return;
    const gap = fast ? 150 : 300;
    LV.t = setTimeout(() => { LV.t = 0; livePush(); }, Math.max(0, gap - (Date.now() - LV.last)));
  }
  async function livePush() {
    if (!LV.code || !V.path || !V.doc || V.board) return;
    if (LV.busy) { LV.again = true; return; }
    LV.busy = true;
    LV.last = Date.now();
    const i = currentPageIndex();
    const now = Date.now();
    const strokes = [];
    for (const s of V.doc.strokes.values()) if (s.p === i) strokes.push(s);
    const key = V.path + '|' + i + '|' + strokes.length + '|' + strokes.map((s) => s.id).join(',');
    const body = { code: LV.code, path: V.path, page: i };
    if (key !== LV.sentStrokes) { body.strokes = strokes; LV.sentStrokes = key; }
    body.cur = cur && cur.st && cur.P && cur.P.i === i && cur.st.pts.length >= 3 ? cur.st : null;
    const tr = LZ.trails.filter((t) => t.p === i && t.pts.length);
    if (tr.length || LV.hadLaser) body.laser = tr.map((t) => t.pts.slice(-250).map(([x, y, tt]) => [x, y, now - tt]));
    LV.hadLaser = tr.length > 0;
    try {
      const r = await apiJson('livepush', { method: 'POST', body });
      if (r.ended) { LV.code = null; clearInterval(LV.keep); ls('liveCode', null); updateLiveUi(); showLivePanel(false); toast('Die Live-Mitschau ist abgelaufen.'); }
      else if (r.viewers !== LV.viewers) { LV.viewers = r.viewers; updateLiveUi(); }
    } catch (e) {
      LV.sentStrokes = ''; // beim nächsten Mal alles neu schicken
    }
    LV.busy = false;
    if (LV.again) { LV.again = false; liveSoon(); }
  }
  function updateLiveUi() {
    const on = !!LV.code;
    const label = on ? `LIVE · ${LV.viewers}` : '';
    for (const b of [$('#liveBadge'), $('#ppLiveBadge')]) {
      if (!b) continue;
      b.hidden = !on;
      b.querySelector('span').textContent = label;
      b.title = on ? `${LV.viewers} ${LV.viewers === 1 ? 'Person schaut' : 'Personen schauen'} zu – antippen für den QR-Code` : '';
    }
    $('#ppLive').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('#lvCount').textContent = `${LV.viewers} ${LV.viewers === 1 ? 'Person schaut' : 'Personen schauen'} gerade zu`;
  }
  function showLivePanel(on) {
    const p = $('#livePanel');
    if (on && LV.code) {
      const url = liveUrl(LV.code);
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      $('#lvQr').innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
      $('#lvUrl').textContent = url.replace(/^https?:\/\//, '');
      $('#lvCode').textContent = LV.code;
      updateLiveUi();
    }
    p.hidden = !on;
  }
  $('#lvHide').onclick = () => showLivePanel(false);
  $('#lvStop').onclick = sessStop;
  $('#lvCopy').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(liveUrl(LV.code)).then(() => toast('Link kopiert.')).catch(() => {}); };
  $('#liveBadge').onclick = () => showLivePanel($('#livePanel').hidden);
  $('#ppLiveBadge').onclick = () => { showLivePanel($('#livePanel').hidden); wakePanel(); };
  $('#ppLive').onclick = () => { if (LV.code) showLivePanel($('#livePanel').hidden); else sessStart(); wakePanel(); };
  $('#ppLaser').onclick = () => { setLaser(S.tool !== 'lp'); wakePanel(); };
  window.addEventListener('pagehide', () => { if (LV.code) livePush(); });
  // Nach dem Neuladen eine laufende Sitzung fortsetzen (z. B. wenn Safari die Seite neu lädt)
  function liveResume() {
    const r = ls('liveCode');
    if (!r || !r.code || Date.now() - r.t > 8 * 3600e3) return;
    LV.code = r.code;
    LV.keep = setInterval(() => livePush(), 10000);
    updateLiveUi();
  }

  // ------------------------------------------------------------------ Volltextsuche über die ganze Bibliothek
  const FT = { t: 0, token: 0, q: '', res: null, busy: false };
  const textOf = (tc) => {
    let s = '';
    for (const it of tc.items) { if (it.str) s += it.str; if (it.hasEOL) s += '\n'; else if (it.str) s += ' '; }
    return s;
  };
  function ftSchedule() {
    clearTimeout(FT.t);
    const q = S.search.trim();
    if (CLOUD[S.src] || q.length < 3) { FT.q = ''; FT.res = null; renderTextHits(); return; }
    FT.t = setTimeout(() => ftRun(q), 450);
  }
  async function ftRun(q) {
    const token = ++FT.token;
    FT.q = q; FT.busy = true;
    renderTextHits();
    let r = null, err = '';
    try { r = await apiJson('search', { params: { q } }); } catch (e) { err = e.offline ? 'Die Volltextsuche braucht eine Internetverbindung – gesucht wurde nur in den Dateinamen.' : e.message; }
    if (token !== FT.token) return;
    FT.busy = false;
    FT.res = r || { err };
    renderTextHits();
  }
  const snipHtml = (s) => esc(String(s || '')).replace(/\u0001/g, '<mark>').replace(/\u0002/g, '</mark>');
  function renderTextHits() {
    const box = $('#textHits');
    if (!box) return;
    if (!FT.q || CLOUD[S.src] || V.path) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    const r = FT.res;
    if (FT.busy && !r) { box.innerHTML = '<p class="muted">Durchsuche alle PDFs …</p>'; return; }
    if (!r) { box.innerHTML = ''; return; }
    if (r.err) { box.innerHTML = `<p class="muted">${esc(r.err)}</p>`; return; }
    const st = r.status || {};
    let h = '';
    if (r.notes && r.notes.length) {
      h += `<h2 class="sec-h">In deinen Textfeldern <span class="muted">${r.notes.length}</span></h2><div class="th-list">`;
      for (const n of r.notes) h += `<button type="button" class="th-hit" data-p="${esc(n.path)}" data-pg="${n.page}"><span class="th-doc">${esc(basename(n.path).replace(/\.pdf$/i, ''))} · S. ${n.page + 1}</span><span class="th-snip">${snipHtml(n.snip)}</span></button>`;
      h += '</div>';
    }
    const docs = r.docs || [];
    h += `<h2 class="sec-h">Im Text der PDFs <span class="muted">${docs.length ? `${r.total}${r.more ? '+' : ''} Treffer in ${docs.length} ${docs.length === 1 ? 'PDF' : 'PDFs'}` : 'keine Treffer'}</span></h2>`;
    for (const d of docs) {
      const f = fileMeta(d.path);
      const nbp = isBoard(d.path);
      h += `<div class="th-doc-box"><div class="th-head"><b>${nbp ? NB_TAB : ''}${esc(docTitle(d.path))}</b><span class="muted">${esc(nbp ? d.path.slice(4).split('/').slice(0, 2).join(' › ') : f ? f.folder : '')}${d.n > d.hits.length ? ` · ${d.n} Seiten` : ''}</span></div>`;
      for (const x of d.hits) h += `<button type="button" class="th-hit" data-p="${esc(d.path)}" data-pg="${x.page}"><span class="th-pg num">${nbp ? 'Notiz' : 'S. ' + (x.page + 1)}</span><span class="th-snip">${snipHtml(x.snip)}</span></button>`;
      h += '</div>';
    }
    // Stand des Index
    const scans = st.scans || [];
    h += '<p class="th-status muted">';
    if (!st.ok) h += 'Auf dem Server fehlt SQLite – die Volltextsuche ist dort nicht möglich.';
    else {
      h += `Durchsuchbar: ${st.indexed} von ${st.total} PDFs.`;
      if (st.pending) h += ` ${st.pending} noch nicht erfasst${LOCAL ? '' : ' (kommt im nächtlichen Lauf)'} <button type="button" class="text-btn" data-a="idx">Jetzt erfassen</button>`;
      if (scans.length) h += ` ${scans.length} ${scans.length === 1 ? 'Scan hat' : 'Scans haben'} noch keinen Text <button type="button" class="text-btn" data-a="ocr">Text erkennen</button>`;
    }
    h += '</p>';
    box.innerHTML = h;
    box.querySelectorAll('.th-hit').forEach((b) => { b.onclick = () => openHit(b.dataset.p, +b.dataset.pg, FT.q); });
    const bi = box.querySelector('[data-a=idx]');
    if (bi) bi.onclick = () => indexNow();
    const bo = box.querySelector('[data-a=ocr]');
    if (bo) bo.onclick = () => ocrQueue(scans.map((x) => x.path));
  }
  // Treffer öffnen: PDF auf, Seite anspringen, Begriff markieren
  function openHit(path, page, q) {
    FT.open = { path, page, q };
    openDoc(path);
  }
  async function afterDocShown(path) {
    setTimeout(() => { if (V.path === path) { autoOcrCheck(path); renderComments(); } }, 2500);
    const h = FT.open;
    if (h && h.path === path) {
      FT.open = null;
      goToPage(h.page);
      openSearch();
      $('#q').value = h.q;
      await runSearch(h.q);
      if (!SR.hits.length) {
        const w = h.q.split(/\s+/).sort((a, b) => b.length - a.length)[0];
        if (w && w !== h.q) { $('#q').value = w; await runSearch(w); }
      }
      if (!SR.hits.length) goToPage(h.page);
    }
    indexEnsure(path);
  }
  async function indexNow() {
    if (LOCAL) { await localIndex(true); return; }
    toast('Erfasse den Text deiner PDFs …', 120000);
    for (let i = 0; i < 30; i++) {
      let r;
      try { r = await apiJson('indexrun', { method: 'POST' }); } catch (e) { toast(e.message); return; }
      if (FT.res) { FT.res.status = r.status; renderTextHits(); }
      if (r.busy) { toast('Der Server erfasst gerade schon – das geht von selbst weiter.'); return; }
      if (!r.status.pending || !r.done) break;
      toast(`Erfasse den Text … noch ${r.status.pending} PDFs`, 120000);
    }
    toast('Fertig erfasst.');
    if (FT.q) ftRun(FT.q);
  }
  // Geöffnete PDF, die noch nicht im Index ist: Text gleich hier lesen und schicken (der nächtliche Lauf macht den Rest)
  async function indexEnsure(path) {
    if (navigator.onLine === false || PROMPTER) return;
    let c;
    try { c = await apiJson('indexcheck', { params: { path } }); } catch (e) { return; }
    if (!c.ok || V.path !== path) return;
    if (c.fresh) { scanHint(path, c); return; }
    const texts = [];
    for (const P of V.pages) {
      if (V.path !== path) return;
      try { texts.push(textOf(await (await pgOf(P)).getTextContent())); } catch (e) { texts.push(''); }
      if (P.i % 10 === 9) await new Promise((r) => setTimeout(r, 30));
    }
    try {
      const r = await apiJson('indexput', { method: 'POST', body: { path, mtime: c.mtime, size: c.size, pages: texts, src: 'pdfjs' } });
      if (!r.stale) scanHint(path, r);
    } catch (e) { /* nicht schlimm */ }
  }
  function scanHint(path, c) {
    if (!c.pages || c.textpages >= c.pages * 0.5 || OC.running) return;
    const seen = ls('scanHint') || {};
    if (seen[path]) return;
    seen[path] = 1;
    ls('scanHint', seen);
    toast('Diese PDF ist ein Scan ohne Text. Über „…“ → „Text erkennen“ wird sie durchsuchbar und Text lässt sich markieren.', 7000);
  }

  // ------------------------------------------------------------------ Texterkennung (OCR) für Scans – läuft auf diesem Gerät
  const OC = { running: false, stop: false, worker: null, lock: null };
  const OCR_BASE = () => new URL('vendor/ocr/', location.href).href;
  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[data-src="${src}"]`)) { res(); return; }
      const s = document.createElement('script');
      s.src = src; s.dataset.src = src;
      s.onload = res; s.onerror = () => rej(new Error('Texterkennung konnte nicht geladen werden.'));
      document.head.appendChild(s);
    });
  }
  // Vorbereitung für die Texterkennung: Papierhelligkeit schätzen und herausrechnen (Schatten am Falz, Handyfotos,
  // vergilbtes Papier), danach Kontrast strecken. Gemessen: Buchfoto mit Schatten 34 % → 0,2 % Fehler, saubere Scans unverändert.
  function ocrPrep(cv) {
    const W = cv.width, H = cv.height;
    if (W < 64 || H < 64) return;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    const img = cx.getImageData(0, 0, W, H), d = img.data;
    // Graustufen
    const g = new Float32Array(W * H);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    // Hintergrund auf 1/8 verkleinert: Maximum (7×7) entfernt die Schrift, dann weichzeichnen
    const f = 8, w = Math.max(1, Math.round(W / f)), h = Math.max(1, Math.round(H / f));
    const sm = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let sum = 0, n = 0;
      for (let yy = y * f; yy < Math.min(H, (y + 1) * f); yy++) for (let xx = x * f; xx < Math.min(W, (x + 1) * f); xx++) { sum += g[yy * W + xx]; n++; }
      sm[y * w + x] = n ? sum / n : 255;
    }
    const mx = new Float32Array(w * h), R = 3;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let m = 0;
      for (let yy = Math.max(0, y - R); yy <= Math.min(h - 1, y + R); yy++) for (let xx = Math.max(0, x - R); xx <= Math.min(w - 1, x + R); xx++) if (sm[yy * w + xx] > m) m = sm[yy * w + xx];
      mx[y * w + x] = m;
    }
    // Weichzeichnen (drei Kastenfilter ≈ Gauß)
    let a = mx, b = new Float32Array(w * h);
    const box = (src, dst, r, horiz) => {
      for (let o = 0; o < (horiz ? h : w); o++) {
        const len = horiz ? w : h;
        let acc = 0;
        const at = (k) => src[horiz ? o * w + k : k * w + o];
        for (let k = -r; k <= r; k++) acc += at(Math.min(len - 1, Math.max(0, k)));
        for (let k = 0; k < len; k++) {
          dst[horiz ? o * w + k : k * w + o] = acc / (2 * r + 1);
          acc += at(Math.min(len - 1, k + r + 1)) - at(Math.max(0, k - r));
        }
      }
    };
    for (let it = 0; it < 3; it++) { box(a, b, 3, true); box(b, a, 3, false); }
    // durch den Hintergrund teilen (bilinear hochgerechnet), Werte sammeln für die Kontraststreckung
    const out = new Float32Array(W * H), hist = new Uint32Array(256);
    for (let y = 0; y < H; y++) {
      const fy = Math.min(h - 1.001, Math.max(0, (y + 0.5) / f - 0.5)), y0 = Math.floor(fy), ty = fy - y0, y1 = Math.min(h - 1, y0 + 1);
      for (let x = 0; x < W; x++) {
        const fx = Math.min(w - 1.001, Math.max(0, (x + 0.5) / f - 0.5)), x0 = Math.floor(fx), tx = fx - x0, x1 = Math.min(w - 1, x0 + 1);
        const bg = (a[y0 * w + x0] * (1 - tx) + a[y0 * w + x1] * tx) * (1 - ty) + (a[y1 * w + x0] * (1 - tx) + a[y1 * w + x1] * tx) * ty;
        const v = Math.min(255, (g[y * W + x] / Math.max(bg, 1)) * 255);
        out[y * W + x] = v; hist[v | 0]++;
      }
    }
    const pct = (p) => { let c = 0; const lim = p * out.length; for (let k = 0; k < 256; k++) { c += hist[k]; if (c >= lim) return k; } return 255; };
    const lo = pct(0.01), hi = Math.max(lo + 1, pct(0.995));
    for (let i = 0, j = 0; j < out.length; i += 4, j++) {
      const v = Math.max(0, Math.min(255, ((out[j] - lo) / (hi - lo)) * 255));
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
  }
  async function ocrWorker(onProgress) {
    if (OC.worker) return OC.worker;
    await loadScript('vendor/ocr/tesseract.min.js?v=' + VERSION);
    const base = OCR_BASE();
    OC.worker = await Tesseract.createWorker(['deu', 'eng'], 1, {
      workerPath: base + 'worker.min.js', corePath: base, langPath: base.replace(/\/$/, ''), gzip: false,
      logger: (m) => { if (onProgress && m && m.status === 'recognizing text') onProgress(m.progress); },
    });
    return OC.worker;
  }
  // Fortschritt der Texterkennung: kleines Symbol oben rechts (dreht sich), Einzelheiten beim Antippen
  const OCS = { file: '', k: 0, files: 0, pg: 0, n: 0, pr: 0 };
  function ocrUi(text) { if (!text) Object.assign(OCS, { file: '', pg: 0, n: 0, pr: 0 }); ocrInd(); }
  function ocrInd() {
    const b = $('#ocrInd');
    if (!b) return;
    const run = OC.running && !!OCS.n;
    const auto = SET.autoOcr;
    b.dataset.state = OC.running ? 'run' : auto ? 'idle' : 'off';
    $('#ocrCount').textContent = run ? `${OCS.pg}/${OCS.n}` : '';
    b.title = OC.running ? `Texterkennung läuft: „${OCS.file}“, Seite ${OCS.pg} von ${OCS.n} – antippen für Einzelheiten` : auto ? 'Texterkennung: automatisch an – antippen zum Ändern' : 'Texterkennung: automatisch aus – antippen zum Ändern';
    const pop = $('#ocrPop');
    if (pop.hidden) return;
    const done = run ? ((OCS.pg - 1 + (OCS.pr || 0)) / OCS.n) : 0;
    $('#opStatus').textContent = OC.stop && OC.running ? 'Wird nach dieser Seite angehalten …'
      : OC.running ? (OCS.n ? `„${OCS.file}“${OCS.files > 1 ? ` (Datei ${OCS.k} von ${OCS.files})` : ''} · Seite ${OCS.pg} von ${OCS.n}` : 'Wird vorbereitet …')
      : 'Gerade läuft keine Texterkennung.';
    pop.querySelector('.op-prog').hidden = !run;
    $('#opBar').style.width = Math.round(done * 100) + '%';
    $('#opAuto').checked = auto;
    $('#opStop').hidden = !OC.running;
    $('#opNow').hidden = OC.running || !V.path || !!V.board;
  }
  function ocrPop(on) {
    const pop = $('#ocrPop');
    pop.hidden = on === undefined ? !pop.hidden : !on;
    $('#ocrInd').setAttribute('aria-expanded', pop.hidden ? 'false' : 'true');
    ocrInd();
  }
  $('#ocrInd').onclick = (e) => { e.stopPropagation(); ocrPop(); };
  document.addEventListener('pointerdown', (e) => { if (!$('#ocrPop').hidden && !e.target.closest('.ocr-wrap')) ocrPop(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#ocrPop').hidden) ocrPop(false); });
  $('#opStop').onclick = () => { OC.stop = true; AO.stopped = true; ocrInd(); };
  $('#opNow').onclick = () => { ocrPop(false); if (V.path && !V.board) ocrQueue([V.path]); };
  $('#opAuto').onchange = async () => {
    SET.autoOcr = $('#opAuto').checked;
    saveSet();
    if (!SET.autoOcr) { if (OC.running) OC.stop = true; AO.stopped = true; }
    else { AO.stopped = false; if (V.path) { AO.tried.delete(V.path); autoOcrCheck(V.path); } setTimeout(autoOcrLibrary, 3000); }
    ocrInd();
    try { await apiJson('prefs', { method: 'POST', body: { settings: { autoOcr: SET.autoOcr } } }); } catch (e) { /* gilt auf diesem Gerät */ }
    toast(SET.autoOcr ? 'Scans werden wieder automatisch erkannt.' : 'Automatische Texterkennung ist aus. Einzelne PDFs kannst du hier jederzeit erkennen lassen.', 4000);
  };
  async function ocrQueue(paths, auto = false) {
    if (OC.running) { toast('Die Texterkennung läuft bereits.'); return; }
    track('tool', auto ? 'Texterkennung automatisch' : 'Texterkennung (von Hand)');
    if (navigator.onLine === false) { toast('Die Texterkennung braucht eine Internetverbindung (zum Speichern).'); return; }
    paths = [...new Set(paths)].filter(Boolean);
    if (!paths.length) return;
    OC.running = true; OC.stop = false;
    ocrInd();
    try { OC.lock = navigator.wakeLock ? await navigator.wakeLock.request('screen') : null; } catch (e) { OC.lock = null; }
    let done = 0, pagesDone = 0;
    try {
      for (let k = 0; k < paths.length && !OC.stop; k++) {
        const tOcr = performance.now();
        const r = await ocrDoc(paths[k], (pg, n, pr) => { Object.assign(OCS, { file: basename(paths[k]).replace(/\.pdf$/i, ''), k: k + 1, files: paths.length, pg, n, pr: pr || 0 }); ocrInd(); });
        if (r) { done++; pagesDone += r; track('perf', 'Texterkennung je Seite', (performance.now() - tOcr) / r, `${r} Seiten, ${UG.dev}${OC.winInfo && OC.winInfo.ok && /^de/i.test(OC.winInfo.lang || '') ? ', Windows-Erkennung' : ''}`); }
      }
    } catch (e) {
      toast('Texterkennung: ' + e.message, 7000);
    } finally {
      if (OC.worker) { try { await OC.worker.terminate(); } catch (e) { /* */ } OC.worker = null; }
      if (OC.lock) { try { await OC.lock.release(); } catch (e) { /* */ } OC.lock = null; }
      OC.running = false;
      ocrUi('');
    }
    if (done) {
      toast(`${done} ${done === 1 ? 'PDF ist' : 'PDFs sind'} jetzt durchsuchbar (${pagesDone} Seiten erkannt).`, 5000);
      loadLibrary();
      if (FT.q) ftRun(FT.q);
    } else if (!OC.stop) toast('Es gab nichts zu erkennen – die Seiten haben schon Text.');
  }
  // Erkennt eine PDF Seite für Seite, legt unsichtbaren Text über die Scans und speichert sie. Rückgabe: Zahl der erkannten Seiten.
  async function ocrDoc(path, progress) {
    const meta = fileMeta(path);
    const before = meta ? meta.mtime + '|' + meta.size : '';
    const bytes = pdfCache.get(path) ? await pdfBytes(pdfCache.get(path)) : await getPdfBytes(path);
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)), isEvalSupported: false }).promise;
    const { PDFDocument, StandardFonts, pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize, setTextRenderingMode, TextRenderingMode, setCharacterSqueeze, rotateAndSkewTextDegreesAndTranslate, showText } = PDFLib;
    const out = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const font = await out.embedFont(StandardFonts.Helvetica);
    const okChar = new Map();
    const clean = (s) => Array.from(s, (ch) => {
      if (!okChar.has(ch)) { try { font.encodeText(ch); okChar.set(ch, true); } catch (e) { okChar.set(ch, false); } }
      return okChar.get(ch) ? ch : '?';
    }).join('');
    const texts = [];
    let recognized = 0;
    const n = pdf.numPages;
    // Windows-App: die eingebaute Erkennung von Windows ist viel schneller – wenn sie Deutsch kann
    let winOcr = false;
    if (window.pdfstiftWin && window.pdfstiftWin.ocrInfo) {
      if (!OC.winInfo) OC.winInfo = await window.pdfstiftWin.ocrInfo().catch((e) => ({ ok: false, error: e.message }));
      winOcr = !!(OC.winInfo.ok && /^de/i.test(OC.winInfo.lang || ''));
      if (!OC.winInfo.ok || !winOcr) track('err', 'Windows-Texterkennung nicht nutzbar', null, OC.winInfo.ok ? 'Sprachen: ' + OC.winInfo.langs : OC.winInfo.error);
    }
    for (let i = 1; i <= n; i++) {
      if (OC.stop) { pdf.destroy(); return 0; }
      progress(i, n, 0);
      const pg = await pdf.getPage(i);
      const existing = textOf(await pg.getTextContent());
      if (existing.replace(/\s+/g, '').length >= 25) { texts.push(existing); continue; }
      // Seite scharf genug für die Erkennung rendern (lange Seite ≈ 3000 Pixel)
      const vp1 = pg.getViewport({ scale: 1 });
      const scale = Math.min(4, 3000 / Math.max(vp1.width, vp1.height));
      const vp = pg.getViewport({ scale });
      const cv = document.createElement('canvas');
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      const cx = cv.getContext('2d');
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
      await pg.render({ annotationMode: AM, canvasContext: cx, viewport: vp }).promise;
      try { ocrPrep(cv); } catch (e) { /* ohne Vorbereitung weiter */ }
      let data = null;
      if (winOcr) {
        const blob = await new Promise((res2) => cv.toBlob(res2, 'image/jpeg', 0.95));
        const wr = await window.pdfstiftWin.ocrImage(new Uint8Array(await blob.arrayBuffer())).catch((e) => ({ error: e.message }));
        if (wr && wr.ok) {
          const words = (wr.words || []).map((w) => ({ text: w.t, confidence: 90, bbox: { x0: w.x, y0: w.y, x1: w.x + w.w, y1: w.y + w.h } }));
          // Fließtext für die Volltextsuche: Wörter zeilenweise
          let text = '', lastY = null;
          for (const w of words) { if (lastY !== null && Math.abs(w.bbox.y0 - lastY) > (w.bbox.y1 - w.bbox.y0) * 0.6) text += '\n'; else if (text) text += ' '; text += w.text; lastY = w.bbox.y0; }
          data = { words, text };
        } else { winOcr = false; track('err', 'Windows-Texterkennung fehlgeschlagen', null, (wr && wr.error) || '?'); }
      }
      if (!data) {
        const worker = await ocrWorker((p) => progress(i, n, p));
        data = (await worker.recognize(cv)).data;
      }
      cv.width = cv.height = 1;
      const page = out.getPage(i - 1);
      const fontKey = page.node.newFontDictionary('OcrHelv', font.ref);
      const ops = [];
      for (const w of data.words || []) {
        const txt = clean(String(w.text || '').trim());
        if (!txt || (w.confidence ?? 100) < 35) continue;
        const b = w.bbox;
        const hpx = Math.max(1, b.y1 - b.y0);
        const base = b.y1 - hpx * 0.2; // Grundlinie etwas über der Unterkante (Unterlängen)
        const [ax, ay] = vp.convertToPdfPoint(b.x0, base);
        const [bx, by] = vp.convertToPdfPoint(b.x1, base);
        const widthPt = Math.hypot(bx - ax, by - ay);
        const size = Math.max(1, hpx / scale);
        const tw = font.widthOfTextAtSize(txt, size);
        if (!tw || !widthPt) continue;
        const angle = Math.atan2(by - ay, bx - ax) * 180 / Math.PI;
        ops.push(pushGraphicsState(), beginText(), setFontAndSize(fontKey, size), setTextRenderingMode(TextRenderingMode.Invisible),
          setCharacterSqueeze(Math.max(5, Math.min(1000, (widthPt / tw) * 100))), rotateAndSkewTextDegreesAndTranslate(angle, 0, 0, ax, ay),
          showText(font.encodeText(txt)), endText(), popGraphicsState());
      }
      if (ops.length) page.pushOperators(...ops);
      texts.push(data.text || '');
      recognized++;
    }
    pdf.destroy();
    if (!recognized) return 0;
    // speichern wie beim Bearbeiten von Seiten (alte Fassung bleibt auf dem Server gesichert, Notizen bleiben)
    const saved = await out.save({ useObjectStreams: true });
    const fd = new FormData();
    fd.append('path', path);
    fd.append('map', JSON.stringify([...Array(n).keys()]));
    fd.append('rot', '{}');
    fd.append('pdf', new Blob([saved], { type: 'application/pdf' }), 'ocr.pdf');
    while (upPending(path)) await new Promise((res2) => setTimeout(res2, 500)); // erst eigene Änderungen hochladen
    // wurde die PDF inzwischen anders geändert (Seiten gedreht, Text bearbeitet …)? Dann dieses Ergebnis verwerfen, später neu erkennen
    const now = fileMeta(path);
    if (now && before && now.mtime + '|' + now.size !== before) { AO.tried.delete(path); return 0; }
    const r = await fetch(API + '?a=pageop', { method: 'POST', credentials: 'same-origin', headers: { 'X-PDFStift': '1' }, body: fd });
    const res = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(res.error || 'Speichern fehlgeschlagen (' + r.status + ')');
    try { await apiJson('indexput', { method: 'POST', body: { path, mtime: res.mtime, size: res.size, pages: texts, src: 'ocr' } }); } catch (e) { /* der nächtliche Lauf holt es nach */ }
    // neue Fassung gleich auf dem Gerät ablegen – kein erneutes Herunterladen
    const buf = saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength);
    const e = pdfCache.get(path);
    if (e && V.path !== path) { e.pdf.destroy(); pdfCache.delete(path); }
    if (meta) { meta.mtime = res.mtime; meta.size = res.size; meta.thumb = false; }
    try { await DB.put('pdfs', path, { bytes: buf, mtime: res.mtime, size: buf.byteLength, savedAt: Date.now() }); S.offline.add(path); }
    catch (er) { await DB.del('pdfs', path); S.offline.delete(path); }
    if (V.path === path) {
      // nicht mitten in einem Strich oder Textfeld austauschen
      for (let k = 0; k < 120 && (cur || editor || PE.mode || notePop); k++) await new Promise((r2) => setTimeout(r2, 500));
      if (V.path === path) {
        const at = currentPageIndex(), P = V.pages[at], off = P ? viewer.scrollTop - P.top : 0;
        const n2 = pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false });
        const pdf2 = await n2.promise;
        const old = pdfCache.get(path);
        pdfCache.set(path, { pdf: pdf2, bytes: buf, size: buf.byteLength, used: Date.now() });
        if (old && old.pdf !== pdf2) setTimeout(() => old.pdf.destroy(), 3000);
        V.path = null;
        await showDoc(path, true);
        const Q = V.pages[at];
        if (Q) viewer.scrollTop = Q.top + off;
      }
    }
    return recognized;
  }

  // ------------------------------------------------------------------ Notizbuch: unendliche Tafel (wie Endless Paper)
  // Koordinaten: Welt (unendlich). Ein Strich speichert seinen Ursprung o (Welt) und den Zoom z beim Zeichnen;
  // seine Punkte sind Bildschirm-Pixel relativ zu o. So bleibt auch bei extremem Zoom jede Feinheit erhalten.
  const boardEl = $('#board');
  const bdCanvas = $('#bdCanvas');
  const bdLive = $('#bdLive');
  lowLat(bdLive);
  const B = { cam: { x: 0, y: 0, s: 1 }, meta: {}, raf: 0, cur: null, touches: new Map(), pinch: null, pan: null, sel: null, ed: null, dpr: 1, w: 0, h: 0, rect: null, hide: null, camT: 0 };
  const isBoard = (p) => typeof p === 'string' && p.startsWith('@nb/');
  const isDeck = (p) => typeof p === 'string' && p.startsWith('@dk/');
  const BOARD_PEN = [1.4, 2.4, 4.2], BOARD_HL = [14, 22, 34];
  const ZMIN = 1e-4, ZMAX = 1e5;
  const so = (s) => (s.o ? [s.o[0], s.o[1], s.z || 1] : [0, 0, 1]);
  const toWorld = (sx, sy) => [sx / B.cam.s + B.cam.x, sy / B.cam.s + B.cam.y];
  const toScreen = (wx, wy) => [(wx - B.cam.x) * B.cam.s, (wy - B.cam.y) * B.cam.s];
  const fmtZoom = (s) => (s >= 10 ? Math.round(s * 100).toLocaleString(LOC) : s >= 0.1 ? Math.round(s * 100) : (s * 100).toLocaleString(LOC, { maximumSignificantDigits: 2 })) + ' %';

  // Bilder (Tafel & OneNote-Import): einmal laden, auf dem Gerät zwischenspeichern (auch offline)
  const IMG = new Map();
  function imgGet(src) {
    let im = IMG.get(src);
    if (im) return im;
    im = new Image();
    im.decoding = 'async';
    IMG.set(src, im);
    const url = API + '?a=img&src=' + encodeURIComponent(src);
    (async () => {
      let blob = null;
      try { const c = await caches.open('pdfstift-img'); const hit = await c.match(url); if (hit) blob = await hit.blob(); } catch (e) { /* kein Cache */ }
      if (!blob) {
        try {
          const r = await fetch(url, { credentials: 'same-origin' });
          if (r.ok) { blob = await r.clone().blob(); try { (await caches.open('pdfstift-img')).put(url, r); } catch (e) { /* */ } }
        } catch (e) { /* offline */ }
      }
      if (blob) { im.onload = () => { if (V.board) boardRender(); else V.pages.forEach((P) => { if (P.ink && pageStrokes(P.i).some((s) => s.src === src)) drawInk(P); }); }; im.src = URL.createObjectURL(blob); }
    })();
    return im;
  }

  const wbCache = new WeakMap();
  function worldBox(s) {
    let w = wbCache.get(s);
    if (!w) {
      const b = bbox(s);
      const [ox, oy, z] = so(s);
      const pad = ((s.w || 0) / 2 + 1) / z;
      w = [ox + b[0] / z - pad, oy + b[1] / z - pad, ox + b[2] / z + pad, oy + b[3] / z + pad];
      wbCache.set(s, w);
    }
    return w;
  }
  const p2d = new WeakMap();
  function penPaths(s) {
    let c = p2d.get(s);
    if (c) return c;
    c = [];
    const p = s.pts;
    let g = null;
    for (let i = 3; i < p.length; i += 3) {
      const pr = ((p[i - 1] || 0.5) + (p[i + 2] || 0.5)) / 2;
      const w = Math.max(0.3, Math.round(s.w * (0.6 + 0.8 * pr) * 4) / 4);
      const x0 = i >= 6 ? (p[i - 6] + p[i - 3]) / 2 : p[i - 3], y0 = i >= 6 ? (p[i - 5] + p[i - 2]) / 2 : p[i - 2];
      if (!g || g.w !== w) { g = { w, path: new Path2D() }; g.path.moveTo(x0, y0); c.push(g); }
      g.path.quadraticCurveTo(p[i - 3], p[i - 2], (p[i - 3] + p[i]) / 2, (p[i - 2] + p[i + 1]) / 2);
    }
    if (g) g.path.lineTo(p[p.length - 3], p[p.length - 2]);
    p2d.set(s, c);
    return c;
  }

  function boardStroke(ctx, s) {
    if (s.t === 'pen' && s.pts.length > 3) {
      ctx.strokeStyle = s.c; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const g of penPaths(s)) { ctx.lineWidth = g.w; ctx.stroke(g.path); }
      return;
    }
    strokePath(ctx, s, 1);
  }
  const boardRank = (s) => (s.t === 'img' ? -1 : rank(s));
  function boardStrokes() {
    const list = [];
    if (V.doc) for (const s of V.doc.strokes.values()) if (!(B.hide && B.hide.has(s.id))) list.push(s);
    return list.sort((a, b) => boardRank(a) - boardRank(b));
  }

  function boardResize() {
    const r = boardEl.getBoundingClientRect();
    B.rect = r;
    B.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    B.w = r.width; B.h = r.height;
    for (const c of [bdCanvas, bdLive]) {
      const W = Math.max(1, Math.round(r.width * B.dpr)), H = Math.max(1, Math.round(r.height * B.dpr));
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    }
  }
  function boardRender() { if (!B.raf) B.raf = requestAnimationFrame(boardDraw); }
  function drawBg(ctx) {
    const bg = B.meta.bg || 'dots';
    if (bg === 'plain') return;
    const cam = B.cam, d = B.dpr;
    let sp = 24;
    while (sp * cam.s < 14) sp *= 4;
    while (sp * cam.s > 56) sp /= 4;
    const x0 = Math.floor(cam.x / sp), y0 = Math.floor(cam.y / sp);
    const x1 = Math.ceil((cam.x + B.w / cam.s) / sp), y1 = Math.ceil((cam.y + B.h / cam.s) / sp);
    if ((x1 - x0) * (y1 - y0) > 40000) return;
    const fade = Math.min(1, (sp * cam.s - 14) / 20); // feine Stufe blendet weich ein
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (bg === 'dots') {
      for (let ix = x0; ix <= x1; ix++) {
        for (let iy = y0; iy <= y1; iy++) {
          const major = ix % 4 === 0 && iy % 4 === 0;
          const sx = ((ix * sp - cam.x) * cam.s) * d, sy = ((iy * sp - cam.y) * cam.s) * d;
          ctx.fillStyle = major ? 'rgba(30,47,110,.34)' : `rgba(30,47,110,${(0.2 * fade).toFixed(3)})`;
          const r = (major ? 1.6 : 1.1) * d;
          ctx.fillRect(sx - r / 2, sy - r / 2, r, r);
        }
      }
      return;
    }
    ctx.lineWidth = 1;
    for (let iy = y0; iy <= y1; iy++) {
      const major = iy % 4 === 0;
      ctx.strokeStyle = bg === 'lines' ? 'rgba(31,79,214,.22)' : major ? 'rgba(30,47,110,.22)' : `rgba(30,47,110,${(0.1 * fade).toFixed(3)})`;
      const sy = Math.round(((iy * sp - cam.y) * cam.s) * d) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(B.w * d, sy); ctx.stroke();
    }
    if (bg === 'grid') {
      for (let ix = x0; ix <= x1; ix++) {
        const major = ix % 4 === 0;
        ctx.strokeStyle = major ? 'rgba(30,47,110,.22)' : `rgba(30,47,110,${(0.1 * fade).toFixed(3)})`;
        const sx = Math.round(((ix * sp - cam.x) * cam.s) * d) + 0.5;
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, B.h * d); ctx.stroke();
      }
    }
  }
  function boardDraw() {
    B.raf = 0;
    if (!V.board) return;
    const ctx = bdCanvas.getContext('2d');
    const d = B.dpr, cam = B.cam;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, bdCanvas.width, bdCanvas.height);
    drawBg(ctx);
    const vx0 = cam.x, vy0 = cam.y, vx1 = cam.x + B.w / cam.s, vy1 = cam.y + B.h / cam.s;
    for (const s of boardStrokes()) {
      const wb = worldBox(s);
      if (wb[2] < vx0 || wb[0] > vx1 || wb[3] < vy0 || wb[1] > vy1) continue;
      if ((wb[2] - wb[0]) * cam.s < 0.35 && (wb[3] - wb[1]) * cam.s < 0.35) continue; // winzig: weglassen
      const [ox, oy, z] = so(s);
      const k = cam.s / z;
      ctx.setTransform(d * k, 0, 0, d * k, d * (ox - cam.x) * cam.s, d * (oy - cam.y) * cam.s);
      boardStroke(ctx, s);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawBoardHits(ctx);
    $('#zoomFit').textContent = fmtZoom(cam.s);
    V.zoom = cam.s;
    boardLinkBtns(vx0, vy0, vx1, vy1);
    placeBoardSel();
    if (LZ.trails.length) laserKick();
    clearTimeout(B.camT);
    B.camT = setTimeout(saveCam, 400);
  }
  // antippbare Verknüpfungen auf der Notizseite: übernommene Folien und Verknüpfungs-Notizen
  const bdLinks = document.createElement('div');
  bdLinks.className = 'bd-links';
  boardEl.appendChild(bdLinks);
  function boardLinkBtns(vx0, vy0, vx1, vy1) {
    const list = [];
    if (V.doc) for (const s of V.doc.strokes.values()) {
      if (!s.ln || (B.hide && B.hide.has(s.id))) continue;
      const wb = worldBox(s);
      if (wb[2] < vx0 || wb[0] > vx1 || wb[3] < vy0 || wb[1] > vy1) continue;
      list.push([s, wb]);
    }
    const have = new Map([...bdLinks.children].map((el) => [el.dataset.id, el]));
    for (const [s, wb] of list) {
      let el = have.get(s.id);
      have.delete(s.id);
      if (!el) {
        el = document.createElement('button');
        el.type = 'button'; el.className = 'ln-btn' + (s.t === 'img' ? ' ln-img' : ''); el.dataset.id = s.id;
        const where = isBoard(s.ln.path) ? docTitle(s.ln.path) : `${stem(s.ln.path)}, S. ${s.ln.pg + 1}`;
        el.title = 'Öffnen: ' + where;
        el.textContent = s.t === 'img' ? '↗ ' + where : '↗';
        el.addEventListener('pointerdown', (e) => e.stopPropagation());
        el.onclick = (e) => { e.stopPropagation(); followLink(s.ln); };
        bdLinks.appendChild(el);
      }
      const [sx0, sy0] = toScreen(wb[0], wb[1]), [sx1] = toScreen(wb[2], wb[3]);
      if (s.t === 'img') { el.style.left = ''; el.style.right = (B.w - sx1 + 6) + 'px'; el.style.top = (sy0 + 6) + 'px'; }
      else { el.style.right = ''; el.style.left = (sx1 + 2) + 'px'; el.style.top = (sy0 - 4) + 'px'; }
    }
    for (const el of have.values()) el.remove();
  }
  function saveCam() {
    if (!V.board || !V.path) return;
    const all = ls('cams') || {};
    all[V.path] = { x: B.cam.x, y: B.cam.y, s: B.cam.s };
    const keys = Object.keys(all);
    if (keys.length > 300) delete all[keys[0]];
    ls('cams', all);
  }
  function zoomAt(f, sx, sy) {
    const s = clamp(B.cam.s * f, ZMIN, ZMAX);
    const [wx, wy] = toWorld(sx, sy);
    B.cam.s = s;
    B.cam.x = wx - sx / s;
    B.cam.y = wy - sy / s;
    boardRender();
  }
  function boardFit() {
    const list = boardStrokes();
    if (!list.length) { B.cam = { x: -40, y: -40, s: 1 }; boardRender(); return; }
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const s of list) { const w = worldBox(s); b[0] = Math.min(b[0], w[0]); b[1] = Math.min(b[1], w[1]); b[2] = Math.max(b[2], w[2]); b[3] = Math.max(b[3], w[3]); }
    const s = clamp(Math.min((B.w - 60) / Math.max(1e-9, b[2] - b[0]), (B.h - 60) / Math.max(1e-9, b[3] - b[1]), 4), ZMIN, ZMAX);
    B.cam = { s, x: (b[0] + b[2]) / 2 - B.w / 2 / s, y: (b[1] + b[3]) / 2 - B.h / 2 / s };
    boardRender();
  }

  // ---- Öffnen / Verlassen
  function boardInfo(path) {
    for (const nb of S.boards || []) for (const sec of nb.sections) for (const p of sec.pages) if (p.path === path) return p;
    return null;
  }
  const docTitle = (path) => isDeck(path) ? (((S.decks || []).find((d) => d.path === path) || {}).title || 'Präsentation') : (isBoard(path) ? ((boardInfo(path) || {}).title || path.split('/').pop()) : basename(path).replace(/\.pdf$/i, ''));
  const DK_TAB = '<svg class="tab-nb" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="12" rx="1.5"/><path d="M12 16.5V20"/></svg>';
  async function showBoard(path) {
    setTimeout(() => thPlace(), 50);
    if (editor) commitEditor(false);
    clearSel();
    if (V.path && V.path !== path && !V.board) { autoBurn(V.path); saveViewState(); }
    if (V.board) leaveBoard();
    if (V.deck) leaveDeck();
    const token = ++V.token;
    unloadViewer();
    V.path = path;
    V.board = true;
    closeSearch();
    $('#library').hidden = true;
    $('#viewer').hidden = true;
    $('#pageBadge').hidden = true;
    $('#presentBtn').hidden = true;
    $('#toolbar').hidden = false;
    boardEl.hidden = false;
    $('#fsBtn').hidden = false;
    document.body.classList.add('on-board');
    const info = boardInfo(path) || {};
    B.meta = { bg: info.bg || 'dots' };
    B.cam = Object.assign({ x: -40, y: -40, s: 1 }, (ls('cams') || {})[path] || {});
    const doc = await localDoc(path);
    if (token !== V.token) return;
    V.doc = doc;
    boardResize();
    if (!(ls('cams') || {})[path] && doc.strokes.size) boardFit();
    if (B.focus) boardFocus();
    if (FT.open && FT.open.path === path) {
      const words = FT.open.q.toLowerCase().split(/\s+/).filter(Boolean);
      FT.open = null;
      const hit = [...doc.strokes.values()].find((s) => s.t === 'txt' && words.every((w) => s.text.toLowerCase().includes(w))) ||
        [...doc.strokes.values()].find((s) => s.t === 'txt' && words.some((w) => s.text.toLowerCase().includes(w)));
      if (hit) {
        const w = worldBox(hit);
        B.cam.s = clamp(Math.min(1.5, (B.w * 0.6) / Math.max(1, w[2] - w[0])), ZMIN, ZMAX);
        B.cam.x = (w[0] + w[2]) / 2 - B.w / 2 / B.cam.s;
        B.cam.y = (w[1] + w[3]) / 2 - B.h / 3 / B.cam.s;
        B.flash = hit.id;
      } else {
        // Treffer im Text einer übernommenen Folie: Suche auf der Notizseite zeigt ihn
        const q0 = words.join(' ');
        setTimeout(() => { if (V.path !== path) return; openSearch(); $('#q').value = q0; boardSearch(q0); }, 50);
      }
    }
    boardRender();
    updateUndo();
    renderToolbar();
    pull(path).then(() => { if (V.path === path && !(ls('cams') || {})[path]) boardFit(); });
    apiJson('nbmeta', { params: { path } }).then((m) => { if (V.path === path) { B.meta.bg = m.bg || 'dots'; boardRender(); } }).catch(() => {});
  }
  // auf eine bestimmte Notiz der Notizseite springen (Verweise)
  function boardFocus() {
    const st = B.focus && V.doc && V.doc.strokes.get(B.focus);
    B.focus = null;
    if (!st) return;
    const w = worldBox(st);
    B.cam.s = clamp(Math.min(1.2, (B.w * 0.8) / Math.max(1, w[2] - w[0]), (B.h * 0.8) / Math.max(1, w[3] - w[1])), ZMIN, ZMAX);
    B.cam.x = (w[0] + w[2]) / 2 - B.w / 2 / B.cam.s; B.cam.y = (w[1] + w[3]) / 2 - B.h / 2 / B.cam.s;
    boardRender();
  }
  // ---- Präsentationen (eigener Baustein deck.js, wird erst bei Bedarf geladen)
  // ================================================================== Objekte auf PDF-Seiten (wie in PowerPoint)
  // Textfelder, Formen, Bilder und Tabellen liegen als eigene Ebene über der Seite. Sie werden nie eingebrannt (sn: 1),
  // bleiben also jederzeit änderbar; „PDF mit Notizen speichern“ schreibt sie in die heruntergeladene Kopie.
  const OB_TH = { bg: 'transparent', fg: '#1A1A1A', accent: '#1E2F6E', font: 'sans' };
  const OB = { P: null, ed: null, els: [], sid: new Map(), insert: null, clip: null, bar: null, file: null };
  let deckP = null;
  function ensureDeck() {
    if (window.PDFSTIFT_DECK) return Promise.resolve(window.PDFSTIFT_DECK);
    deckP = deckP || deckCore().then(() => new Promise((res, rej) => {
      let n = 0;
      const t = () => (window.PDFSTIFT_DECK ? res(window.PDFSTIFT_DECK) : ++n > 100 ? rej(new Error('Objekte konnten nicht geladen werden.')) : setTimeout(t, 30));
      t();
    }));
    deckP.catch(() => { deckP = null; });
    return deckP;
  }
  const obClone = (o) => JSON.parse(JSON.stringify(o));
  function obStrokes(i) {
    const out = [];
    if (V.doc) for (const s of V.doc.strokes.values()) if (s.t === 'ob' && s.p === i && s.e) out.push(s);
    return out.sort((a, b) => (a.zi || 0) - (b.zi || 0));
  }
  function obLayer(P, make) {
    let l = P.el.querySelector(':scope > .ob-layer');
    if (!l && make) {
      l = document.createElement('div');
      l.className = 'ob-layer';
      if (P.ink && P.ink.parentNode === P.el) P.el.insertBefore(l, P.ink); else P.el.appendChild(l);
    }
    return l;
  }
  // Ebene einer Seite zeichnen (ohne Bearbeitung); die gerade bearbeitete Seite zeichnet der Editor
  function obRender(P) {
    if (!P || !V.doc || V.board) return;
    if (OBV.grid && P.i === 0) obGridSync();
    const list = obStrokes(P.i);
    P.obEls = list.map((s) => s.e);
    if (OB.ed && OB.P === P) { obSync(); return; }
    const l = obLayer(P, list.length > 0);
    if (!l) return;
    const sig = list.map((s) => s.id).join(',') + '|' + P.cssW;
    if (l.dataset.sig === sig) return;
    if (!list.length) { l.innerHTML = ''; l.dataset.sig = sig; return; }
    if (!window.PDFSTIFT_DECK) { ensureDeck().then(() => { if (V.pages[P.i] === P) obRender(P); }).catch(() => {}); return; }
    l.dataset.sig = sig;
    l.innerHTML = '';
    l.appendChild(window.PDFSTIFT_DECK.layerNode(P.obEls, P.w, P.h, P.cssW / P.w, OB_TH));
  }
  // Notizen haben sich von außen geändert (Rückgängig, anderes Gerät): Editor nachziehen
  function obSync() {
    const P = OB.P;
    const list = obStrokes(P.i);
    const ids = list.map((s) => s.id).sort().join(',');
    if (ids === [...OB.sid.values()].sort().join(',')) { if (OB.ed && !OB.ed.edit) OB.ed.renderStage(); return; }
    OB.els = list.map((s) => obClone(s.e));
    OB.sid = new Map(list.map((s) => [s.e.id, s.id]));
    OB.ed.edit = null;
    OB.ed.sel = OB.ed.sel.filter((id) => OB.sid.has(id));
    OB.ed.render();
  }
  function obHost(P) {
    const k = () => (P.cssW || 1) / P.w;
    return {
      box: () => obLayer(P, true),
      stage: () => pagesEl,
      fmtBar: () => (OB.P === P ? $('#obRibbon .rb-fmt') : null),
      W: () => P.w, H: () => P.h, k,
      unit: Math.max(0.45, Math.min(1.2, P.w / 960)), pad: 5,
      els: () => OB.els, setEls: (a) => { OB.els = a; },
      theme: () => OB_TH,
      snap: () => JSON.stringify(OB.els),
      commit: (before) => obCommit(P, before),
      surface: () => window.PDFSTIFT_DECK.layerNode(OB.els, P.w, P.h, k(), OB_TH),
      rendered: () => { const l = obLayer(P, true); l.dataset.sig = ''; l.classList.toggle('ob-on', !!(OB.ed && (OB.ed.sel.length || OB.ed.edit))); },
      placing: (on, kind) => obPlacing(on ? kind : null),
      pickImage: () => obPickImage(),
      center: () => obCenter(P),
      alignWord: true, passThrough: true,
      editOnFirstClick: (e) => !!e && e.t === 'text',
      copied: (list) => { OB.clip = list; },
      onIns: (k) => obIns(k), onPaste: () => obPaste(), clipboard: () => OB.clip, insertKind: () => OB.insert,
      ...OB_RIB,
      replaceAll: (f, r) => obReplaceAll(f, r),
      onInsertHtml: (html) => { const P = (OB.ed && OB.P) || obPage(); const ed = P && obActivate(P); if (ed) ed.insertHtmlAt(html); },
    };
  }
  function obActivate(P) {
    if (OB.P === P && OB.ed) return OB.ed;
    obDeactivate();
    const DK = window.PDFSTIFT_DECK;
    if (!DK || !P) return null;
    const list = obStrokes(P.i);
    OB.P = P;
    OB.els = list.map((s) => obClone(s.e));
    OB.sid = new Map(list.map((s) => [s.e.id, s.id]));
    OB.ed = DK.makeEditor(obHost(P));
    OB.ed.clip = OB.clip;
    return OB.ed;
  }
  function obDeactivate() {
    if (!OB.ed) return;
    const P = OB.P, ed = OB.ed;
    ed.endEdit();
    ed.insert = null;
    OB.ed = null; OB.P = null;
    const idle = obIdle(); if (idle) idle.renderFmt();
    if (P && V.pages[P.i] === P) {
      const l = obLayer(P, false);
      if (l) { l.classList.remove('ob-on'); l.dataset.sig = ''; }
      obRender(P);
    }
  }
  // Änderungen als Notizen speichern: geänderte Objekte ersetzen (neue ID), gelöschte entfernen – mit Rückgängig
  function obCommit(P, before) {
    if (!V.doc || !V.path) return;
    let old = [];
    try { old = JSON.parse(before); } catch (e) { /* */ }
    const oldMap = new Map(old.map((e) => [e.id, e]));
    const del = [], add = [];
    const now = new Set(OB.els.map((e) => e.id));
    OB.els.forEach((e, i) => {
      const sid = OB.sid.get(e.id);
      const s0 = sid && V.doc.strokes.get(sid);
      const prev = oldMap.get(e.id);
      if (s0 && prev && JSON.stringify(prev) === JSON.stringify(e) && (s0.zi || 0) === i) return;
      if (s0) del.push(s0);
      const st = { id: uid(), p: P.i, t: 'ob', sn: 1, zi: i, c: '#1A1A1A', pts: [r2(e.x), r2(e.y)], e: obClone(e) };
      add.push(st);
      OB.sid.set(e.id, st.id);
    });
    for (const id of oldMap.keys()) {
      if (now.has(id)) continue;
      const s0 = V.doc.strokes.get(OB.sid.get(id));
      if (s0) del.push(s0);
      OB.sid.delete(id);
    }
    const acts = [];
    if (del.length) { opDel(V.path, del.map((s) => s.id)); acts.push({ t: 'del', strokes: del }); }
    if (add.length) { opAdd(V.path, add); acts.push({ t: 'add', strokes: add }); }
    if (acts.length) pushHistory(acts.length === 1 ? acts[0] : { t: 'multi', acts });
    P.obEls = OB.els;
  }
  // Menüband über der PDF (nur in der PDF-Ansicht)
  function obRibbonSync() {
    const rb = $('#obRibbon');
    if (!rb) return;
    const show = !$('#toolbar').hidden && !!V.path && !V.board && !V.deck && !EMBED && !SHOW && !PROMPTER;
    if (rb.hidden === !show) return;
    rb.hidden = !show;
    obCompactSync();
    if (show && !rb.dataset.ready) ensureDeck().then(() => {
      if (rb.dataset.ready) return;
      rb.dataset.ready = '1';
      if (OB.ed) OB.ed.renderFmt(); else obIdle().renderFmt();
    }).catch(() => {});
  }
  // Reiter des Menübands in der PDF-Ansicht (zusätzlich zu Start und Einfügen)
  const OBV = { grid: false, snap: true, compact: false };
  try { Object.assign(OBV, ls('obView') || {}); } catch (e) { /* */ }
  const ICP = {
    save: '<path d="M5 3.5h11l3.5 3.5v13.5h-14.5z"/><path d="M8 3.5v5h7v-5M8 20.5v-6h8v6"/>', print: '<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="8" rx="1.5"/><path d="M7 14h10v6.5H7z"/>',
    find: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/>', hint: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.1"/>',
    sel: '<path d="M5 3.5l13 7.2-5.6 1.4L9.8 18z"/>', hand: '<path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10.5V5a1.5 1.5 0 0 1 3 0v5.5"/><path d="M14 10.5V6.5a1.5 1.5 0 0 1 3 0v6.5c0 4-2.5 7-6.2 7-2.6 0-4-1.2-5.4-3.2L3.7 13a1.4 1.4 0 0 1 2.2-1.7L8 13.5"/>',
    pen: '<path d="M16.5 3.5l4 4L8 20H4v-4z"/><path d="M14 6l4 4"/>', hl: '<path d="M9 15l-3 3H3l3-3"/><path d="M9 15l9-9 3 3-9 9z"/><path d="M3 21h9"/>', tx: '<path d="M8 15l4-9 4 9M9.6 12h4.8"/><path d="M4 20h16"/>',
    sh: '<path d="M4 20L13 11"/><path d="M8.5 11H13v4.5"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/>', tt: '<path d="M5 6V4.5h14V6"/><path d="M12 4.5v15"/><path d="M9 19.5h6"/>',
    la: '<path d="M12 4c5 0 8.5 2.3 8.5 5.2S17 14.5 12 14.5 3.5 12.2 3.5 9.2 7 4 12 4z" stroke-dasharray="3 2.4"/><path d="M6.5 13.5c-1 1.5-.4 3.4 1.6 3.6 1.8.2 2.1 2 .9 3.4"/>', lp: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
    er: '<path d="M7 20h13"/><path d="M4.5 15.5l9-9a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L13 19H8.5z"/>', nt: '<path d="M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-8l-4.5 3.5V16.5H5A1.5 1.5 0 0 1 3.5 15V6A1.5 1.5 0 0 1 5 4.5z"/>',
    rot: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>', ins: '<path d="M6 3h8l4 4v14H6z"/><path d="M12 10v6M9 13h6"/>', del: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
    org: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    ov: '<rect x="3.5" y="3.5" width="7" height="9" rx="1"/><rect x="13.5" y="3.5" width="7" height="9" rx="1"/><path d="M4 16h16M4 20h10"/>', vrot: '<rect x="6" y="3.5" width="12" height="17" rx="1.5"/><path d="M21 9a6 6 0 0 0-3-5"/><path d="M21 4v5h-5" transform="translate(0 0)"/>',
    begin: '<path d="M5 4v16"/><path d="M9 5l11 7-11 7z"/>', cur: '<rect x="3.5" y="5" width="11" height="9" rx="1"/><path d="M14 12l7 4.5-7 4.5z"/>', presenter: '<rect x="2.5" y="4" width="12" height="9" rx="1"/><rect x="16" y="4" width="5.5" height="4" rx=".8"/><path d="M16 11h5.5M16 13.5h4M5 17h7M8.5 13v4"/>',
    fitw: '<path d="M3 12h18M6 9l-3 3 3 3M18 9l3 3-3 3"/>', fitp: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', single: '<rect x="7" y="3.5" width="10" height="17" rx="1.5"/>', two: '<rect x="2.5" y="4" width="9" height="16" rx="1.5"/><rect x="12.5" y="4" width="9" height="16" rx="1.5"/>',
    zin: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20M8 10.5h5M10.5 8v5"/>', zout: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20M8 10.5h5"/>',
    compact: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M3 13h18M3 17h12" stroke-opacity=".4" stroke-dasharray="2 2"/>', rbcol: '<rect x="3" y="4" width="18" height="6" rx="1"/><path d="M8 16l4-3 4 3"/>',
    grid: '<rect x="3.5" y="3.5" width="17" height="17" rx="1"/><path d="M9 3.5v17M15 3.5v17M3.5 9h17M3.5 15h17" stroke-opacity=".55"/>', magnet: '<path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4z"/><path d="M6 8h4M14 8h4"/>',
  };
  // Kompakt: Werkzeugzeile weg, solange das Menüband zu sehen ist (alles steht im Reiter „Zeichnen“)
  function obCompactSync() {
    const rb = $('#obRibbon');
    const hide = !!OBV.compact && rb && !rb.hidden;
    $('#toolbar2').hidden = $('#toolbar').hidden || hide;
    document.body.classList.toggle('rb-compact', !!hide);
    lineSync(); tbMeasure();
  }
  function obGridSync() {
    const P0 = V.pages[0];
    pagesEl.classList.toggle('ob-grid', !!OBV.grid);
    if (P0) pagesEl.style.setProperty('--obg', (20 * (P0.cssW || 1) / P0.w) + 'px');
  }
  const OB_RIB = {
    tabs: () => [['draw', 'Zeichnen'], ['pages', 'Seiten'], ['show', 'Bildschirmpräsentation'], ['view', 'Ansicht']],
    // Start ohne ausgewähltes Objekt: statt grauer Schrift-Knöpfe das, was man beim Lesen und Markieren braucht
    startIdle: ({ grp, rows, big, sb }, canPaste) => {
      const DK = window.PDFSTIFT_DECK, RI = (DK && DK.RI) || {}, IC = (DK && DK.ICON) || {};
      const tool = (k, l) => big(`data-f="pt:${k}"`, l, ICP[k]).replace('class="rb-big"', `class="rb-big${S.tool === k ? ' on' : ''}"`);
      return grp('Zwischenablage', big('data-f="paste"', 'Einfügen', RI.paste, canPaste)) +
        grp('Dokument', big('data-f="pc:save"', 'Speichern', ICP.save) + big('data-f="pc:print"', 'Drucken', ICP.print) +
          rows(sb('pc:undo', 'Rückgängig (Strg+Z)', IC.undo, { label: 'Rückgängig' }), sb('pc:redo', 'Wiederholen (Strg+Y)', IC.redo, { label: 'Wiederholen' }))) +
        grp('Suchen', rows(sb('pc:find', 'In der PDF suchen (Strg+F)', ICP.find, { label: 'Suchen' }), sb('replace', 'In Textfeldern, Formen und Tabellen suchen und ersetzen', RI.replace, { label: 'Ersetzen …' }))) +
        grp('Einfügen', big('data-ins="text"', 'Textfeld', IC.textbox) + big('data-menu="shapes"', 'Formen', IC.shape, true, true) + big('data-ins="img"', 'Bild', IC.img) + big('data-ins="table"', 'Tabelle', IC.table)) +
        grp('Stifte', tool('pen', 'Stift') + tool('hl', 'Marker') + tool('tx', 'Text markieren') + tool('er', 'Radierer')) +
        grp('Formatieren', `<div class="rb-hint">${'<svg viewBox="0 0 24 24">' + ICP.hint + '</svg>'}<span>Ein Textfeld, eine Form oder ein Bild anklicken – dann stehen hier Schrift, Absatz und Anordnen.</span></div>`);
    },
    tabContent: (tab, { grp, rows, big, sb }) => {
      const tool = (k, l) => big(`data-f="pt:${k}"`, l, ICP[k]).replace('class="rb-big"', `class="rb-big${S.tool === k ? ' on' : ''}"`);
      // Farben, Stärken und Arten der bisherigen Werkzeugleiste: Kopien, die die Originale anklicken
      const proxy = (sel, cap) => { const el = $(sel); if (!el || el.hidden || !el.children.length) return ''; return grp(cap, `<div class="rb-proxy" data-proxy="${sel}">${el.innerHTML.replace(/ id="[^"]*"/g, '')}</div>`); };
      if (tab === 'draw') return grp('Auswahl', tool('sel', 'Text auswählen') + tool('hand', 'Hand') + tool('la', 'Lasso')) +
        grp('Stifte', tool('pen', 'Stift') + tool('hl', 'Marker') + tool('tx', 'Text markieren') + tool('sh', 'Linien und Formen')) +
        grp('Weitere', tool('tt', 'Schnelltext') + tool('nt', 'Kommentar') + tool('lp', 'Laserpointer') + tool('er', 'Radierer')) +
        proxy('#txKinds', 'Art') + proxy('#shKinds', 'Form') + proxy('#ttSizes', 'Größe') + proxy('#colors', 'Farbe') + proxy('#widths', 'Stärke');
      if (tab === 'pages') return grp('Seite', big('data-f="pp:rotate"', 'Seite drehen', ICP.rot) + big('data-f="pp:ins"', 'Leere Seite', ICP.ins) + big('data-f="pp:del"', 'Seite löschen', ICP.del)) +
        grp('Alle Seiten', big('data-f="pp:org"', 'Seiten organisieren', ICP.org) + big('data-f="pp:ov"', 'Seitenübersicht', ICP.ov) + big('data-f="pp:vrot"', 'Ansicht drehen', ICP.rot));
      if (tab === 'show') return grp('Starten', big('data-f="ps:begin"', 'Von Beginn an', ICP.begin) + big('data-f="ps:cur"', 'Ab aktueller Seite', ICP.cur) + big('data-f="ps:presenter"', 'Referentenansicht', ICP.presenter)) +
        grp('Zeigen', tool('lp', 'Laserpointer') + tool('pen', 'Stift'));
      if (tab === 'view') {
        const mode = viewMode();
        return grp('Seitenansicht', big('data-f="pv:fitw"', 'Seitenbreite', ICP.fitw) + big('data-f="pv:fitp"', 'Ganze Seite', ICP.fitp) + big('data-f="pv:single"', 'Einzelseiten', ICP.single).replace('class="rb-big"', `class="rb-big${mode === 'single' ? ' on' : ''}"`) + big('data-f="pv:two"', 'Zwei Seiten', ICP.two).replace('class="rb-big"', `class="rb-big${mode !== 'single' ? ' on' : ''}"`)) +
          grp('Zoom', big('data-f="pv:zin"', 'Vergrößern', ICP.zin) + big('data-f="pv:zout"', 'Verkleinern', ICP.zout) + `<span class="rb-zoom num">${Math.round((V.zoom || 1) * 100)} %</span>`) +
          grp('Objekte', rows(sb('pv:grid', 'Gitternetz anzeigen und daran einrasten', ICP.grid, { label: 'Gitternetz', on: OBV.grid }), sb('pv:snap', 'An anderen Objekten und der Seitenmitte einrasten', ICP.magnet, { label: 'Einrasten', on: OBV.snap }))) +
          grp('Leisten', rows(sb('pv:compact', 'Kompakt: die Werkzeugzeile ausblenden – Werkzeuge, Farben und Stärken stehen im Reiter „Zeichnen“', ICP.compact, { label: 'Kompakt (nur Menüband)', on: OBV.compact }), sb('pv:rbcol', 'Menüband einklappen (Strg+F1)', ICP.rbcol, { label: 'Menüband einklappen' })) + rows(sb('pv:laydef', 'Alle Leisten wieder an ihren Standardplatz setzen', ICP.compact, { label: 'Standardanordnung' })));
      }
      return '';
    },
    onBtn: (t) => {
      const px = t.closest('[data-proxy]');
      if (!px) return false;
      const i = [...px.querySelectorAll('button')].indexOf(t), orig = $(px.dataset.proxy);
      const ob = orig && orig.querySelectorAll('button')[i];
      if (ob) ob.click();
      setTimeout(() => { const e2 = OB.ed || obIdle(); if (e2) e2.renderFmt(); }, 0);
      return true;
    },
    fmtExt: (f) => {
      const [g, a] = f.split(':');
      if (!['pt', 'pp', 'ps', 'pv', 'pc'].includes(g) || !a) return false;
      if (g === 'pc') { winCmd(a); return true; }
      const re = () => setTimeout(() => { const e2 = OB.ed || obIdle(); if (e2) e2.renderFmt(); }, 0);
      if (g === 'pt') { S.tool = a; persistTools(); renderToolbar(); re(); return true; }
      if (g === 'pp') {
        if (a === 'rotate') menuAction('rotate'); if (a === 'ins') menuAction('ins-blank'); if (a === 'del') menuAction('delpage');
        if (a === 'org') runTool('organize'); if (a === 'ov') openOverview(); if (a === 'vrot') rotateView(90);
        return true;
      }
      if (g === 'ps') { if (a === 'begin') { goToPage(0); setTimeout(() => setPresent(true), 50); } if (a === 'cur') setPresent(true); if (a === 'presenter') prsStart(); return true; }
      if (a === 'fitw') setZoom(1); if (a === 'fitp') fitWholePage(); if (a === 'single') setViewMode('single'); if (a === 'two') setViewMode('two');
      if (a === 'zin') setZoom((V.zoom || 1) * 1.2); if (a === 'zout') setZoom((V.zoom || 1) / 1.2);
      if (a === 'grid' || a === 'snap' || a === 'compact') { OBV[a] = !OBV[a]; ls('obView', OBV); obGridSync(); if (a === 'compact') obCompactSync(); }
      if (a === 'laydef') { layReset(); re(); return true; }
      if (a === 'rbcol' && window.PDFSTIFT_DECK) { window.PDFSTIFT_DECK.rbCollapse(true); return true; }
      setTimeout(obGridSync, 300);
      re();
      return true;
    },
    snapOn: () => OBV.snap,
    gridSize: () => (OBV.grid ? 20 : 0),
  };
  // Menüband ohne ausgewähltes Objekt (alles zum Formatieren grau)
  function obIdle() {
    const DK = window.PDFSTIFT_DECK;
    if (!DK) return null;
    OB.idle = OB.idle || DK.makeEditor({
      box: () => null, stage: () => pagesEl, fmtBar: () => (OB.ed ? null : $('#obRibbon .rb-fmt')), W: () => 1, H: () => 1, k: () => 1,
      els: () => [], setEls() {}, theme: () => OB_TH, snap: () => '[]', commit() {}, surface: () => null,
      placing: (on, kind) => obPlacing(on ? kind : null), pickImage: () => obPickImage(), alignWord: true,
      onIns: (k) => obIns(k), onPaste: () => obPaste(), clipboard: () => OB.clip, insertKind: () => OB.insert,
      ...OB_RIB,
      replaceAll: (f, r) => obReplaceAll(f, r),
      onInsertHtml: (html) => { const P = (OB.ed && OB.P) || obPage(); const ed = P && obActivate(P); if (ed) ed.insertHtmlAt(html); },
    });
    return OB.idle;
  }
  // Suchen und Ersetzen in allen Objekten dieser PDF
  function obReplaceAll(find, repl) {
    const DK = window.PDFSTIFT_DECK;
    if (!DK || !V.doc) return 0;
    if (OB.ed) OB.ed.endEdit();
    let n = 0;
    const del = [], add = [];
    for (const st of [...V.doc.strokes.values()]) {
      if (st.t !== 'ob' || !st.e) continue;
      const e = obClone(st.e);
      const c = DK.replaceInEls([e], find, repl);
      if (!c) continue;
      n += c;
      del.push(st);
      add.push({ ...st, id: uid(), e, pts: [r2(e.x), r2(e.y)] });
    }
    if (!n) return 0;
    opDel(V.path, del.map((x) => x.id));
    opAdd(V.path, add);
    pushHistory({ t: 'multi', acts: [{ t: 'del', strokes: del }, { t: 'add', strokes: add }] });
    new Set(add.map((x) => x.p)).forEach((i) => { if (V.pages[i]) obRender(V.pages[i]); });
    return n;
  }
  function obPaste() {
    if (!OB.clip) return;
    const P = (OB.ed && OB.P) || obPage();
    const ed = P && obActivate(P);
    if (ed) { ed.clip = OB.clip; ed.pasteEls(); }
  }
  function obIns(kind) {
    if (!V.doc || V.board) return;
    if (kind === 'img') { obPickImage(); return; }
    if (kind === 'table' || kind === 'chart' || kind === 'crop') {
      const P = (OB.ed && OB.P) || obPage(); const ed = P && obActivate(P);
      if (ed) (kind === 'table' ? ed.addTable() : kind === 'chart' ? ed.addChart() : ed.addCrop());
      return;
    }
    if (OB.insert === kind) { obPlacing(null); return; }
    if (OB.ed) OB.ed.endEdit();
    obPlacing(kind);
    toast('Auf die Seite klicken oder mit gedrückter Maustaste aufziehen (Esc = abbrechen).', 3500);
  }
  function obCenter(P) {
    const r = P.el.getBoundingClientRect(), vr = viewer.getBoundingClientRect(), k = (P.cssW || 1) / P.w;
    const cx = (Math.max(r.left, vr.left) + Math.min(r.right, vr.right)) / 2, cy = (Math.max(r.top, vr.top) + Math.min(r.bottom, vr.bottom)) / 2;
    return [clamp((cx - r.left) / k, 0, P.w), clamp((cy - r.top) / k, 0, P.h)];
  }
  function obPage() { return V.pages[currentPageIndex()] || V.pages[0]; }
  function obPickImage() {
    if (!OB.file) {
      OB.file = document.createElement('input');
      OB.file.type = 'file'; OB.file.accept = 'image/*'; OB.file.hidden = true;
      OB.file.onchange = () => { const f = OB.file.files[0]; OB.file.value = ''; if (f) obAddImage(f); };
      document.body.appendChild(OB.file);
    }
    OB.file.click();
  }
  async function obAddImage(f) {
    const P = (OB.ed && OB.P) || obPage();
    if (!P) return;
    await ensureDeck();
    const ed = obActivate(P);
    if (ed) ed.addImage(f);
  }
  function obPlacing(kind) {
    OB.insert = kind || null;
    if (OB.ed) OB.ed.insert = null;
    document.body.classList.toggle('ob-placing', !!kind);
    document.querySelectorAll('#obRibbon [data-ins], .dk-fmt [data-ins]').forEach((b) => b.classList.toggle('on', !!kind && b.dataset.ins === kind));
  }
  // Treffer auf einer Seite (oberstes Objekt zuerst, auch gedreht)
  function obHit(P, x, y) {
    const list = OB.ed && OB.P === P ? OB.els : P.obEls || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      const cx = e.x + e.w / 2, cy = e.y + e.h / 2, a = -(e.r || 0) * Math.PI / 180;
      const lx = (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), ly = (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a);
      const t = (e.t === 'shape' && (e.k === 'line' || e.k === 'arrow') ? 6 : 2) / ((P.cssW || 1) / P.w);
      if (Math.abs(lx) <= e.w / 2 + t && Math.abs(ly) <= e.h / 2 + t) return e;
    }
    return null;
  }
  function obLocal(P, e) {
    const r = P.el.getBoundingClientRect(), k = (P.cssW || 1) / P.w;
    return [(e.clientX - r.left) / k, (e.clientY - r.top) / k];
  }
  // Zeiger auf einer Seite: true = vom Objekt-Editor übernommen
  function obDown(e) {
    if (!V.doc || V.board || V.deck || editor || cur || pinch.active || (e.pointerType === 'touch' && touches.size > 1)) return false;
    const pe = e.target.closest('.page');
    const P = pe && V.pages[+pe.dataset.i];
    if (OB.insert) {
      if (!P || e.button > 0) return false;
      e.preventDefault();
      const kind = OB.insert;
      obPlacing(null);
      const ed = obActivate(P);
      if (!ed) return true;
      ed.drawInsert(kind, e);
      return true;
    }
    if (!P) return false;
    // Griffe und Text des ausgewählten Objekts
    if (OB.ed && OB.P === P && e.target.closest('.ob-layer')) return OB.ed.down(e) !== false;
    const tool = S.tool;
    const allowed = tool !== 'er' && tool !== 'la' && tool !== 'lp' && (e.pointerType === 'mouse' || tool === 'sel' || tool === 'hand');
    const h = allowed && e.button === 0 && window.PDFSTIFT_DECK ? obHit(P, ...obLocal(P, e)) : null;
    if (!h) {
      if (OB.ed && (OB.ed.sel.length || OB.ed.edit)) { obDeactivate(); return e.pointerType === 'mouse' && tool !== 'hand' && tool !== 'sel'; }
      if (OB.ed) obDeactivate();
      return false;
    }
    const ed = obActivate(P);
    return !!ed && ed.down(e, h.id) !== false;
  }
  // Mauszeiger über einem Objekt: Verschieben-Zeiger
  pagesEl.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || e.buttons || !V.doc || V.board) return;
    const pe = e.target.closest('.page');
    const P = pe && V.pages[+pe.dataset.i];
    const on = !!(P && (P.obEls || []).length && !['er', 'la', 'lp'].includes(S.tool) && obHit(P, ...obLocal(P, e)));
    pagesEl.classList.toggle('ob-hover', on);
  });
  pagesEl.addEventListener('dblclick', (e) => {
    if (!OB.ed || !OB.P) return;
    const pe = e.target.closest('.page');
    if (!pe || V.pages[+pe.dataset.i] !== OB.P) return;
    const h = obHit(OB.P, ...obLocal(OB.P, e));
    if (h) { e.preventDefault(); e.stopPropagation(); OB.ed.startEdit(h.id, e); }
  }, true);
  document.addEventListener('keydown', (e) => {
    if (!OB.ed && !OB.insert) return;
    if (document.querySelector('dialog[open]')) return;
    if (OB.insert && e.key === 'Escape') { obPlacing(null); e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (!OB.ed || (e.target.closest && e.target.closest('input, textarea, select'))) return;
    if (OB.ed.key(e) === true) e.stopImmediatePropagation();
  }, true);
  document.addEventListener('paste', (e) => {
    if (!OB.ed || OB.ed.edit || !OB.clip || (e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]'))) return;
    const items = [...(e.clipboardData ? e.clipboardData.items : [])];
    if (items.some((i) => i.type.startsWith('image/'))) return;
    e.preventDefault(); e.stopImmediatePropagation();
    OB.ed.clip = OB.clip;
    OB.ed.pasteEls();
  }, true);

  function deckCore() {
    window.PDFSTIFT_CORE = window.PDFSTIFT_CORE || {
      API, VERSION, LANG, esc, ls, apiJson, toast, confirmDlg, askText, prepareImage, uploadImage, downloadBlob,
      pptx: () => pptxMod(),
      ensureFontkit: () => (window.fontkit ? Promise.resolve() : loadScript('vendor/fontkit.min.js?v=' + VERSION)),
      uploadPdf: async (blob, name) => {
        const fd = new FormData();
        fd.append('folder', S.folder || '');
        fd.append('files[]', new File([blob], name, { type: 'application/pdf' }));
        const r = await fetch(API + '?a=upload', { method: 'POST', credentials: 'same-origin', headers: { 'X-PDFStift': '1' }, body: fd });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Fehler ' + r.status);
        loadLibrary();
        return j;
      },
      // eine PDF wählen (Bibliothek oder Datei vom Gerät) und ihre Bytes liefern
      pickPdf: async (title) => {
        const r = await pickPdfs({ title, text: 'Eine PDF antippen (oder unten eine Datei vom Gerät wählen).', go: 'Weiter' });
        if (!r || !r.files.length) return null;
        const it = r.files[0];
        if (typeof it === 'string') return { name: stem(it), bytes: await getPdfBytes(it) };
        return { name: it.file.name.replace(/\.[^.]+$/, ''), bytes: new Uint8Array(await it.file.arrayBuffer()) };
      },
      // Schriftliste geladen: Objekte auf den Seiten neu zeichnen (richtige Schrift)
      fontsReady: () => { for (const P of V.pages || []) { const l = P.el && P.el.querySelector(':scope > .ob-layer'); if (l) { l.dataset.sig = ''; obRender(P); } } },
      deckTitle: (path, title) => {
        S.decks = S.decks || [];
        const d = S.decks.find((x) => x.path === path);
        if (d) d.title = title; else S.decks.push({ path, title, slides: 0, mtime: Date.now() / 1000 });
        if (V.path === path) document.title = (title || 'Präsentation') + ' – PDF-Stift';
        renderTabs();
      },
    };
    return loadScript('app/' + (LANG === 'en' ? 'deck.en.js' : 'deck.js') + '?v=' + VERSION);
  }
  async function showDeck(path) {
    if (editor) commitEditor(false);
    clearSel();
    if (V.path && V.path !== path && !V.board && !V.deck) { const left = V.path; setTimeout(() => { if (V.path !== left) autoBurn(left); }, 4000); saveViewState(); snapSave(left); }
    if (V.board) leaveBoard();
    if (V.deck) leaveDeck();
    ++V.token;
    unloadViewer();
    V.path = path;
    V.deck = true;
    closeSearch();
    for (const q of ['#library', '#viewer', '#pageBadge', '#presentBtn']) $(q).hidden = true;
    boardEl.hidden = true;
    const el = $('#deckView');
    el.hidden = false;
    document.body.classList.add('on-deck');
    document.title = docTitle(path) + ' – PDF-Stift';
    renderToolbar();
    try {
      await ensureDeck();
      if (V.path !== path) return;
      await window.PDFSTIFT_DECK.open(path, el);
    } catch (e) {
      if (V.path === path) el.innerHTML = `<p class="empty">Die Präsentation konnte nicht geöffnet werden: ${esc(e.message)}</p>`;
    }
  }
  function leaveDeck() {
    if (!V.deck) return;
    try { if (window.PDFSTIFT_DECK) window.PDFSTIFT_DECK.close(); } catch (e) { /* */ }
    V.deck = false;
    const el = $('#deckView');
    el.hidden = true;
    el.innerHTML = '';
    document.body.classList.remove('on-deck');
  }
  async function loadDecks() {
    try { S.decks = (await apiJson('decks')).decks || []; } catch (e) { S.decks = S.decks || []; }
    if (S.src === 'dk' && !V.path) renderLibrary();
    renderTabs();
  }
  // ---- PowerPoint-Dateien (.pptx) als bearbeitbare Präsentation öffnen
  async function pptxMod() {
    await ensureDeck();
    if (!window.PDFSTIFT_PPTX) await loadScript('app/' + (LANG === 'en' ? 'pptx.en.js' : 'pptx.js') + '?v=' + VERSION);
    return window.PDFSTIFT_PPTX;
  }
  function pptxPick() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.pptx,.potx,.ppsx,application/vnd.openxmlformats-officedocument.presentationml.presentation';
    inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) pptxImport(f); };
    inp.click();
  }
  async function pptxImport(file) {
    if (!/\.(pptx|potx|ppsx|pptm)$/i.test(file.name || '')) { toast('Bitte eine PowerPoint-Datei (.pptx) wählen. Ältere .ppt-Dateien zuerst in PowerPoint als .pptx speichern.', 7000); return; }
    toast('PowerPoint-Datei wird gelesen …', 120000);
    try {
      const M = await pptxMod();
      const { deck, warn } = await M.importPptx(file, (t) => toast(t, 120000));
      const r = await apiJson('decknew', { method: 'POST', body: { title: deck.title } });
      await apiJson('deck', { method: 'POST', body: { path: r.path, deck, rev: r.rev } });
      S.decks = [{ path: r.path, title: deck.title, slides: deck.slides.length, mtime: Date.now() / 1000 }, ...(S.decks || [])];
      const miss = warn.emf + warn.other;
      toast(`„${deck.title}“ übernommen: ${deck.slides.length} ${deck.slides.length === 1 ? 'Folie' : 'Folien'}.` + (miss ? ` ${miss} Bild(er) in einem Format, das der Browser nicht anzeigen kann (z. B. EMF), wurden ausgelassen.` : ''), miss ? 9000 : 5000);
      track('tool', 'PowerPoint öffnen');
      openDoc(r.path);
    } catch (e) { toast(e.message || String(e), 8000); }
  }
  async function newDeck() {
    const title = await askText('Neue Präsentation', 'Name der Präsentation', '', 'Anlegen');
    if (title === null || title === undefined) return;
    try {
      const r = await apiJson('decknew', { method: 'POST', body: { title: title || 'Neue Präsentation' } });
      S.decks = [{ path: r.path, title: r.title, slides: 1, mtime: Date.now() / 1000 }, ...(S.decks || [])];
      openDoc(r.path);
    } catch (e) { toast(e.message); }
  }
  function renderDecks() {
    $('#recentBox').hidden = true; $('#folderBar').hidden = true; $('#tagBar').hidden = true;
    $('#folders').innerHTML = '';
    const wrap = $('#files');
    wrap.innerHTML = '';
    wrap.classList.toggle('list', S.libView === 'list');
    const empty = $('#libEmpty');
    const q = S.search.trim().toLowerCase();
    const card = (cls, thumb, title, sub, onOpen, menu) => {
      const c = document.createElement('div');
      c.className = 'card ' + cls;
      c.innerHTML = `<button type="button" class="thumb">${thumb}</button><div class="meta"><div class="txt"><div class="n">${esc(title)}</div><div class="d">${sub}</div></div>${menu ? `<div class="menu-wrap"><button type="button" class="icon-btn more" aria-label="Mehr zu ${esc(title)}">${MORE_SVG}</button></div>` : ''}</div>`;
      c.querySelector('.thumb').onclick = onOpen;
      c.querySelector('.txt').onclick = onOpen;
      if (menu) c.querySelector('.more').onclick = (ev) => { ev.stopPropagation(); nbMenu(c.querySelector('.menu-wrap'), menu); };
      wrap.appendChild(c);
      return c;
    };
    if (!q) card('dk-new', '+', 'Neue Präsentation', 'Folien bauen, vortragen, als PDF speichern', newDeck, null);
    if (!q) card('dk-new dk-imp', '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="12" rx="1.5"/><path d="M8 20h8M12 17v3"/><path d="M12 8v6M9.5 11.5L12 14l2.5-2.5"/></svg>', 'PowerPoint öffnen', 'Eine .pptx-Datei als bearbeitbare Präsentation übernehmen', pptxPick, null);
    const list = (S.decks || []).filter((d) => !q || d.title.toLowerCase().includes(q));
    for (const d of list) {
      const c = card('dk-card', '<span class="ph nb-ph">' + DK_TAB + '</span>', d.title, `${d.slides} ${d.slides === 1 ? 'Folie' : 'Folien'} · ${fmtDate(d.mtime)}`, () => openDoc(d.path), [
        ['rn', 'Umbenennen …', async () => {
          const t = await askText('Umbenennen', '', d.title, 'Umbenennen');
          if (!t) return;
          try { const r = await apiJson('deck', { params: { path: d.path } }); r.deck.title = t; await apiJson('deck', { method: 'POST', body: { path: d.path, deck: r.deck, rev: r.deck.rev } }); d.title = t; renderDecks(); renderTabs(); } catch (e) { toast(e.message); }
        }],
        ['cp', 'Duplizieren', async () => { try { await apiJson('decknew', { method: 'POST', body: { title: d.title + ' (Kopie)', copy: d.path } }); loadDecks(); } catch (e) { toast(e.message); } }],
        ['del', 'Löschen …', async () => {
          if (!(await confirmDlg('Präsentation löschen', `„${d.title}“ wirklich löschen?`))) return;
          try { await apiJson('deckdel', { method: 'POST', body: { path: d.path } }); if (S.tabs.some((t) => t.path === d.path)) closeTab(d.path); loadDecks(); } catch (e) { toast(e.message); }
        }],
      ]);
      if (d.first) {
        deckCore().then(() => { const th = c.querySelector('.thumb'); th.innerHTML = ''; th.appendChild(window.PDFSTIFT_DECK.preview(d.first, d.theme, th.clientWidth || 200)); }).catch(() => {});
      }
    }
    empty.hidden = !!(list.length || !q);
    empty.textContent = q ? 'Keine Präsentation passt.' : '';
  }
  function leaveBoard() {
    if (!V.board) return;
    boardCommitText(false);
    boardClearSel();
    saveCam();
    if (V.path) boardThumbSave(V.path);
    V.board = false;
    boardEl.hidden = true;
    document.body.classList.remove('on-board');
    renderToolbar();
  }
  window.addEventListener('resize', () => { if (V.board) { boardResize(); boardRender(); } });

  // ---- Eingabe: Stift schreibt, ein Finger verschiebt, zwei Finger zoomen
  const bdPt = (e) => [e.clientX - B.rect.left, e.clientY - B.rect.top];
  function boardStyle() {
    if (S.tool === 'hl' || S.tool === 'tx') return { t: 'hl', c: S.color.hl, w: BOARD_HL[S.wi.hl] };
    if (S.tool === 'sh') return { t: 'sh', k: S.shKind, c: S.color.sh, w: BOARD_PEN[S.wi.sh] };
    return { t: 'pen', c: S.color.pen, w: BOARD_PEN[S.wi.pen] };
  }
  function liveCtxB() {
    const ctx = bdLive.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, bdLive.width, bdLive.height);
    return ctx;
  }
  function drawBoardLive() {
    B.liveRaf = 0;
    const c = B.cur;
    if (!c || !c.st) return;
    const st = c.st;
    const k = B.cam.s / st.z;
    const [sx, sy] = toScreen(st.o[0], st.o[1]);
    // Stift: nur neue Stücke dazuzeichnen (schnell, ohne Verzögerung)
    if (st.t === 'pen' && !c.straight && c.drawn > 3 && st.pts.length > c.drawn) {
      const ctx = bdLive.getContext('2d');
      ctx.setTransform(B.dpr * k, 0, 0, B.dpr * k, B.dpr * sx, B.dpr * sy);
      penSegments(ctx, st, 1, c.drawn);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      c.drawn = st.pts.length;
      return;
    }
    const ctx = liveCtxB();
    ctx.setTransform(B.dpr * k, 0, 0, B.dpr * k, B.dpr * sx, B.dpr * sy);
    ctx.globalCompositeOperation = 'source-over';
    if (st.t === 'pen') penLive(ctx, st, 1); else strokePath(ctx, st, 1);
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    c.drawn = st.pts.length;
  }
  const liveB = () => { if (!B.liveRaf) B.liveRaf = requestAnimationFrame(drawBoardLive); };
  function startPinch() {
    const [a, b] = [...B.touches.values()];
    B.pinch = { a0: a, b0: b, cam: { ...B.cam }, d0: Math.max(10, Math.hypot(a[0] - b[0], a[1] - b[1])), m0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
    B.pan = null;
    if (B.cur) { B.cur = null; liveCtxB(); }
  }
  boardEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.bd-sel-bar, .txt-editor')) return;
    B.rect = boardEl.getBoundingClientRect();
    const pt = bdPt(e);
    if (B.ed && !e.target.closest('.txt-editor')) { boardCommitText(false); if (S.tool === 'tt') return; }
    try { boardEl.setPointerCapture(e.pointerId); } catch (err) { /* */ }
    if (e.pointerType === 'touch') {
      B.touches.set(e.pointerId, pt);
      if (B.touches.size >= 2) { startPinch(); return; }
      if (!S.finger) { B.pan = { id: e.pointerId, last: pt }; return; }
    }
    if (e.pointerType === 'mouse' && e.button === 1) { B.pan = { id: e.pointerId, last: pt }; e.preventDefault(); return; }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    boardToolDown(e, pt);
  });
  boardEl.addEventListener('pointermove', (e) => {
    if (!B.rect) return;
    const pt = bdPt(e);
    if (e.pointerType === 'touch' && B.touches.has(e.pointerId)) B.touches.set(e.pointerId, pt);
    if (B.pinch && B.touches.size >= 2) {
      const [a, b] = [...B.touches.values()];
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const P = B.pinch;
      const s = clamp(P.cam.s * Math.hypot(a[0] - b[0], a[1] - b[1]) / P.d0, ZMIN, ZMAX);
      const wx = P.m0[0] / P.cam.s + P.cam.x, wy = P.m0[1] / P.cam.s + P.cam.y;
      B.cam = { s, x: wx - m[0] / s, y: wy - m[1] / s };
      boardRender();
      return;
    }
    if (B.pan && B.pan.id === e.pointerId) {
      B.cam.x -= (pt[0] - B.pan.last[0]) / B.cam.s;
      B.cam.y -= (pt[1] - B.pan.last[1]) / B.cam.s;
      B.pan.last = pt;
      boardRender();
      return;
    }
    if (B.cur && B.cur.pid === e.pointerId) { e.preventDefault(); boardToolMove(e); }
  });
  const boardUp = (e, cancel) => {
    B.touches.delete(e.pointerId);
    if (B.pinch && B.touches.size < 2) {
      B.pinch = null;
      if (B.touches.size === 1 && !S.finger) { const [id, pt] = [...B.touches.entries()][0]; B.pan = { id, last: pt }; }
      return;
    }
    if (B.pan && B.pan.id === e.pointerId) { B.pan = null; return; }
    if (B.cur && B.cur.pid === e.pointerId) boardToolUp(e, cancel);
  };
  boardEl.addEventListener('pointerup', (e) => boardUp(e, false));
  boardEl.addEventListener('pointercancel', (e) => boardUp(e, true));
  boardEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    B.rect = boardEl.getBoundingClientRect();
    const [sx, sy] = bdPt(e);
    if (e.ctrlKey || e.metaKey) { zoomAt(Math.exp(-e.deltaY / 300), sx, sy); return; }
    const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX, dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
    B.cam.x += dx / B.cam.s;
    B.cam.y += dy / B.cam.s;
    boardRender();
  }, { passive: false });
  // Safari-Gesten (Trackpad) abfangen
  boardEl.addEventListener('gesturestart', (e) => e.preventDefault());

  function boardToolDown(e, pt) {
    const [wx, wy] = toWorld(pt[0], pt[1]);
    const pr = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
    if (S.tool === 'lp') {
      const tr = { board: true, pts: [[wx, wy, Date.now()]], live: true };
      LZ.trails.push(tr);
      if (LZ.trails.length > 12) LZ.trails.shift();
      B.cur = { pid: e.pointerId, laser: tr };
      laserAdd(tr);
      return;
    }
    if (S.tool === 'er') { B.cur = { pid: e.pointerId, removed: [] }; boardEraseAt(pt); return; }
    if (S.tool === 'tt') { B.cur = { pid: e.pointerId, tt: pt }; return; }
    if (S.tool === 'la') {
      if (B.sel && inSelBox(wx, wy)) { B.cur = { pid: e.pointerId, drag: true, w0: [wx, wy], dw: [0, 0] }; B.hide = new Set(B.sel.ids); boardRender(); return; }
      boardClearSel();
      B.cur = { pid: e.pointerId, lasso: [pt] };
      return;
    }
    const st = { id: uid(), p: 0, ...boardStyle(), o: [wx, wy], z: B.cam.s, pts: S.tool === 'sh' ? [0, 0, 0, 0] : [0, 0, Math.round(pr * 100) / 100] };
    B.cur = { pid: e.pointerId, st, sx0: pt[0], sy0: pt[1], shape: S.tool === 'sh', hx: pt[0], hy: pt[1] };
    LIVE.add(st);
    liveB();
  }
  function boardToolMove(e) {
    const c = B.cur;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const list = evs.length ? evs : [e];
    if (c.laser) {
      for (const ev of list) { const [sx, sy] = bdPt(ev); const [wx, wy] = toWorld(sx, sy); c.laser.pts.push([wx, wy, Date.now()]); }
      if (c.laser.pts.length > 600) c.laser.pts.splice(0, c.laser.pts.length - 600);
      laserAdd(c.laser);
      return;
    }
    if (c.removed) { for (const ev of list) boardEraseAt(bdPt(ev)); return; }
    if (c.tt) return;
    if (c.lasso) { for (const ev of list) c.lasso.push(bdPt(ev)); drawLassoB(c); return; }
    if (c.drag) {
      const [wx, wy] = toWorld(...bdPt(e));
      c.dw = [wx - c.w0[0], wy - c.w0[1]];
      drawDragB(c);
      return;
    }
    const st = c.st;
    if (c.shape || c.straight) {
      const [sx, sy] = bdPt(e);
      const dx = r2(sx - c.sx0), dy = r2(sy - c.sy0);
      if (c.shape) { st.pts[2] = dx; st.pts[3] = dy; } else { st.pts = [0, 0, 0.5, ...snapLine(0, 0, dx, dy), 0.5]; }
      liveB();
      return;
    }
    if (c.fixed) return;
    const [hx, hy] = bdPt(e);
    if (Math.hypot(hx - c.hx, hy - c.hy) > 4) {
      c.hx = hx; c.hy = hy;
      clearTimeout(c.holdT);
      c.holdT = setTimeout(() => boardStraighten(c), 450);
    }
    for (const ev of list) {
      const [sx, sy] = bdPt(ev);
      const pr = ev.pointerType === 'pen' ? (ev.pressure || 0.5) : 0.5;
      const x = r2(sx - c.sx0), y = r2(sy - c.sy0);
      const p = st.pts;
      if ((x - p[p.length - 3]) ** 2 + (y - p[p.length - 2]) ** 2 < 0.04) continue;
      p.push(x, y, Math.round(pr * 100) / 100);
    }
    liveB();
  }
  function boardStraighten(c) {
    if (B.cur !== c || !c.st || c.straight || c.fixed) return;
    const p = c.st.pts;
    if (p.length < 9) return;
    const n = p.length;
    // wie in PDFs: geschlossene Form → Kreis/Ellipse oder Rechteck, offener Strich → gerade Linie
    const form = shapeOf(p);
    if (form) { c.fixed = true; c.st.pts = form; c.drawn = 0; p2d.delete(c.st); if (navigator.vibrate) navigator.vibrate(8); liveB(); return; }
    if (Math.hypot(p[n - 3] - p[0], p[n - 2] - p[1]) < 16) return;
    c.straight = true;
    c.st.pts = [0, 0, 0.5, ...snapLine(0, 0, p[n - 3], p[n - 2]), 0.5];
    c.drawn = 0;
    if (navigator.vibrate) navigator.vibrate(8);
    liveB();
  }
  function boardToolUp(e, cancel) {
    const c = B.cur;
    B.cur = null;
    clearTimeout(c.holdT);
    if (c.st) LIVE.delete(c.st);
    if (c.laser) { c.laser.live = false; laserAdd(c.laser); return; }
    if (c.removed) { if (c.removed.length) pushHistory({ t: 'del', strokes: c.removed }); return; }
    if (c.tt) {
      const [sx, sy] = bdPt(e);
      if (!cancel && Math.hypot(sx - c.tt[0], sy - c.tt[1]) < 10) boardOpenText(sx, sy);
      return;
    }
    if (c.lasso) { liveCtxB(); boardFinishLasso(c); return; }
    if (c.drag) { liveCtxB(); B.hide = null; boardFinishDrag(c); return; }
    liveCtxB();
    const st = c.st;
    if (st.t === 'sh' && Math.hypot(st.pts[2], st.pts[3]) < 6) return;
    if (cancel && st.pts.length < 9) return;
    if (st.t !== 'sh' && st.pts.length === 3) st.pts.push(st.pts[0] + 0.01, st.pts[1], st.pts[2]);
    opAdd(V.path, [st]);
    pushHistory({ t: 'add', strokes: [st] });
    boardRender();
  }

  // ---- Radierer
  function hitLocal(s, x, y, r) {
    const b = bbox(s);
    if (x < b[0] - r || x > b[2] + r || y < b[1] - r || y > b[3] + r) return false;
    const p = s.pts;
    if (s.t === 'txt' || s.t === 'img' || s.t === 'tx') return true;
    if (s.t === 'sh') {
      for (const line of shapeLines(s)) for (let i = 1; i < line.length; i++) if (segDist2(x, y, line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]) < r * r) return true;
      return false;
    }
    if (p.length === 3) return (p[0] - x) ** 2 + (p[1] - y) ** 2 < r * r;
    for (let i = 3; i < p.length; i += 3) if (segDist2(x, y, p[i - 3], p[i - 2], p[i], p[i + 1]) < r * r) return true;
    return false;
  }
  function boardEraseAt(pt) {
    const [wx, wy] = toWorld(pt[0], pt[1]);
    const rw = 9 / B.cam.s;
    const hit = [];
    for (const s of V.doc.strokes.values()) {
      const wb = worldBox(s);
      if (wx < wb[0] - rw || wx > wb[2] + rw || wy < wb[1] - rw || wy > wb[3] + rw) continue;
      const [ox, oy, z] = so(s);
      if (hitLocal(s, (wx - ox) * z, (wy - oy) * z, rw * z + (s.w || 0) / 2)) hit.push(s);
    }
    if (!hit.length) return;
    opDel(V.path, hit.map((s) => s.id));
    B.cur.removed.push(...hit);
    boardRender();
  }

  // ---- Lasso: einkreisen, verschieben, umfärben, löschen
  function drawLassoB(c) {
    const ctx = liveCtxB();
    ctx.setTransform(B.dpr, 0, 0, B.dpr, 0, 0);
    ctx.strokeStyle = '#1E2F6E'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]);
    ctx.beginPath();
    c.lasso.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  function boardFinishLasso(c) {
    const xs = c.lasso.map((q) => q[0]), ys = c.lasso.map((q) => q[1]);
    if (c.lasso.length < 4 || Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys) < 12) {
      // Antippen eines Fotos wählt es aus
      const [wx, wy] = toWorld(c.lasso[0][0], c.lasso[0][1]);
      const im = boardStrokes().filter((s) => s.t === 'img').reverse().find((s) => { const w = worldBox(s); return wx >= w[0] && wx <= w[2] && wy >= w[1] && wy <= w[3]; });
      if (im) { B.sel = { ids: new Set([im.id]) }; selBoxUpdate(); showSelBar(); }
      return;
    }
    const poly = c.lasso.flatMap(([x, y]) => toWorld(x, y));
    const ids = [];
    for (const s of V.doc.strokes.values()) {
      const wb = worldBox(s);
      const [ox, oy, z] = so(s);
      let inside = 0, total = 0;
      if (s.t === 'pen' || s.t === 'hl') {
        const step = Math.max(3, Math.floor(s.pts.length / 60 / 3) * 3);
        for (let i = 0; i < s.pts.length; i += step) { total++; if (pip(ox + s.pts[i] / z, oy + s.pts[i + 1] / z, poly)) inside++; }
      } else { total = 1; inside = pip((wb[0] + wb[2]) / 2, (wb[1] + wb[3]) / 2, poly) ? 1 : 0; }
      if (total && inside / total >= 0.5) ids.push(s.id);
    }
    if (!ids.length) return;
    B.sel = { ids: new Set(ids) };
    selBoxUpdate();
    showSelBar();
  }
  function selBoxUpdate() {
    if (!B.sel) return;
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const id of B.sel.ids) { const s = V.doc.strokes.get(id); if (!s) continue; const w = worldBox(s); b[0] = Math.min(b[0], w[0]); b[1] = Math.min(b[1], w[1]); b[2] = Math.max(b[2], w[2]); b[3] = Math.max(b[3], w[3]); }
    B.sel.box = b;
  }
  const inSelBox = (wx, wy) => B.sel && B.sel.box && wx >= B.sel.box[0] && wx <= B.sel.box[2] && wy >= B.sel.box[1] && wy <= B.sel.box[3];
  function showSelBar() {
    let el = boardEl.querySelector('.bd-sel');
    if (!el) {
      el = document.createElement('div');
      el.className = 'bd-sel';
      el.insertAdjacentHTML('beforeend', '<i class="sel-h" data-c="nw"></i><i class="sel-h" data-c="ne"></i><i class="sel-h" data-c="sw"></i><i class="sel-h" data-c="se"></i>');
      el.addEventListener('pointerdown', bdSelDown);
      el.addEventListener('pointermove', bdSelMove);
      el.addEventListener('pointerup', bdSelUp);
      el.addEventListener('pointercancel', bdSelUp);
      el.insertAdjacentHTML('beforeend', `<div class="bd-sel-bar"><span class="bd-sel-colors"></span><button type="button" data-a="smaller" class="text-btn" aria-label="Kleiner">−</button><button type="button" data-a="bigger" class="text-btn" aria-label="Größer">+</button><button type="button" data-a="del" class="text-btn">Löschen</button><button type="button" data-a="ok" class="text-btn">Fertig</button></div>`);
      boardEl.appendChild(el);
      const cols = el.querySelector('.bd-sel-colors');
      PALETTE.slice(0, 6).forEach(([hex, label]) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'swatch'; b.setAttribute('aria-label', label);
        b.innerHTML = `<span style="background:${hex}"></span>`;
        b.onclick = () => boardReplaceSel((s) => (s.t === 'img' ? s : { ...s, c: hex }));
        cols.appendChild(b);
      });
      el.querySelector('[data-a=del]').onclick = () => {
        const old = [...B.sel.ids].map((id) => V.doc.strokes.get(id)).filter(Boolean);
        opDel(V.path, old.map((s) => s.id));
        pushHistory({ t: 'del', strokes: old });
        boardClearSel(); boardRender();
      };
      el.querySelector('[data-a=ok]').onclick = () => { boardClearSel(); boardRender(); };
      for (const [a, f] of [['bigger', 1.25], ['smaller', 0.8]]) {
        el.querySelector(`[data-a=${a}]`).onclick = () => {
          const bx = B.sel.box, cx = (bx[0] + bx[2]) / 2, cy = (bx[1] + bx[3]) / 2;
          boardReplaceSel((s) => { const [ox, oy, z] = so(s); return { ...s, o: [cx + (ox - cx) * f, cy + (oy - cy) * f], z: z / f }; });
        };
      }
    }
    placeBoardSel();
  }
  function placeBoardSel() {
    const el = boardEl.querySelector('.bd-sel');
    if (!el) return;
    if (!B.sel || !B.sel.box) { el.remove(); return; }
    const [x0, y0] = toScreen(B.sel.box[0], B.sel.box[1]);
    const [x1, y1] = toScreen(B.sel.box[2], B.sel.box[3]);
    Object.assign(el.style, { left: x0 + 'px', top: y0 + 'px', width: Math.max(8, x1 - x0) + 'px', height: Math.max(8, y1 - y0) + 'px' });
    el.classList.toggle('bar-top', y1 + 70 > B.h);
  }
  function bdSelDown(e) {
    if (!B.sel || e.target.closest('.bd-sel-bar')) return;
    e.preventDefault();
    e.stopPropagation();
    B.rect = boardEl.getBoundingClientRect();
    const h = e.target.closest('.sel-h');
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* */ }
    B.sel.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, mode: h ? h.dataset.c : 'move', b: B.sel.box.slice(), fn: null, moved: 0 };
    B.hide = new Set(B.sel.ids);
    boardRender();
  }
  function bdSelMove(e) {
    const d = B.sel && B.sel.drag;
    if (!d || d.id !== e.pointerId) return;
    e.preventDefault();
    const dx = (e.clientX - d.x0) / B.cam.s, dy = (e.clientY - d.y0) / B.cam.s;
    d.moved = Math.max(d.moved, Math.hypot(e.clientX - d.x0, e.clientY - d.y0));
    const b = d.b;
    let box;
    if (d.mode === 'move') {
      d.fn = (s) => { const [ox, oy, z] = so(s); return { ...s, o: [ox + dx, oy + dy], z }; };
      box = [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy];
    } else {
      const ax = d.mode.includes('w') ? b[2] : b[0], ay = d.mode.includes('n') ? b[3] : b[1];
      const cx = d.mode.includes('w') ? b[0] : b[2], cy = d.mode.includes('n') ? b[1] : b[3];
      const f = clamp(Math.max(Math.abs(cx + dx - ax) / Math.max(1e-9, Math.abs(cx - ax)), Math.abs(cy + dy - ay) / Math.max(1e-9, Math.abs(cy - ay))), 0.02, 50);
      d.fn = (s) => { const [ox, oy, z] = so(s); return { ...s, o: [ax + (ox - ax) * f, ay + (oy - ay) * f], z: z / f }; };
      box = [ax + (b[0] - ax) * f, ay + (b[1] - ay) * f, ax + (b[2] - ax) * f, ay + (b[3] - ay) * f];
    }
    const ctx = liveCtxB();
    for (const id of B.sel.ids) {
      const s0 = V.doc.strokes.get(id);
      if (!s0) continue;
      const s = d.fn(s0);
      const [ox, oy, z] = so(s);
      const k = B.cam.s / z;
      ctx.setTransform(B.dpr * k, 0, 0, B.dpr * k, B.dpr * (ox - B.cam.x) * B.cam.s, B.dpr * (oy - B.cam.y) * B.cam.s);
      boardStroke(ctx, s);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const el = boardEl.querySelector('.bd-sel');
    const [x0, y0] = toScreen(Math.min(box[0], box[2]), Math.min(box[1], box[3]));
    const [x1, y1] = toScreen(Math.max(box[0], box[2]), Math.max(box[1], box[3]));
    Object.assign(el.style, { left: x0 + 'px', top: y0 + 'px', width: Math.max(8, x1 - x0) + 'px', height: Math.max(8, y1 - y0) + 'px' });
  }
  function bdSelUp(e) {
    const d = B.sel && B.sel.drag;
    if (!d || d.id !== e.pointerId) return;
    B.sel.drag = null;
    B.hide = null;
    liveCtxB();
    if (!d.fn || d.moved < 3) { boardRender(); return; }
    boardReplaceSel(d.fn);
  }
  function boardClearSel() { B.sel = null; const el = boardEl.querySelector('.bd-sel'); if (el) el.remove(); }
  function boardReplaceSel(fn) {
    if (!B.sel) return;
    const old = [...B.sel.ids].map((id) => V.doc.strokes.get(id)).filter(Boolean);
    const neu = old.map((s) => ({ ...fn(s), id: uid() }));
    opDel(V.path, old.map((s) => s.id));
    opAdd(V.path, neu);
    pushHistory({ t: 'multi', acts: [{ t: 'del', strokes: old }, { t: 'add', strokes: neu }] });
    B.sel.ids = new Set(neu.map((s) => s.id));
    selBoxUpdate();
    boardRender();
  }
  function drawDragB(c) {
    const ctx = liveCtxB();
    for (const id of B.sel.ids) {
      const s = V.doc.strokes.get(id);
      if (!s) continue;
      const [ox, oy, z] = so(s);
      const k = B.cam.s / z;
      ctx.setTransform(B.dpr * k, 0, 0, B.dpr * k, B.dpr * (ox + c.dw[0] - B.cam.x) * B.cam.s, B.dpr * (oy + c.dw[1] - B.cam.y) * B.cam.s);
      boardStroke(ctx, s);
    }
    const el = boardEl.querySelector('.bd-sel');
    if (el) el.style.transform = `translate(${c.dw[0] * B.cam.s}px, ${c.dw[1] * B.cam.s}px)`;
  }
  function boardFinishDrag(c) {
    const el = boardEl.querySelector('.bd-sel');
    if (el) el.style.transform = '';
    if (Math.abs(c.dw[0]) * B.cam.s < 1 && Math.abs(c.dw[1]) * B.cam.s < 1) { boardRender(); return; }
    boardReplaceSel((s) => { const [ox, oy, z] = so(s); return { ...s, o: [ox + c.dw[0], oy + c.dw[1]], z }; });
  }

  // ---- Text auf der Tafel
  function boardTextAt(wx, wy) {
    let best = null;
    for (const s of V.doc.strokes.values()) {
      if (s.t !== 'txt') continue;
      const w = worldBox(s);
      if (wx >= w[0] && wx <= w[2] && wy >= w[1] && wy <= w[3]) best = s;
    }
    return best;
  }
  function boardOpenText(sx, sy) {
    const [wx, wy] = toWorld(sx, sy);
    const old = boardTextAt(wx, wy);
    const z = old ? so(old)[2] : B.cam.s;
    const fs = old ? old.fs : Math.round(S.ttSize * 1.3);
    const scr = B.cam.s / z; // Bildschirm-Pixel pro lokaler Einheit
    const o = old ? so(old).slice(0, 2) : [wx, wy - (fs * 0.6) / B.cam.s];
    const [bx, by] = toScreen(o[0] + (old ? old.pts[0] / z : 0), o[1] + (old ? old.pts[1] / z : 0));
    const color = old ? old.c : S.color.tt;
    B.hide = old ? new Set([old.id]) : null;
    boardRender();
    const box = document.createElement('div');
    box.className = 'txt-editor';
    box.style.left = bx + 'px';
    box.style.top = by + 'px';
    box.innerHTML = `<textarea rows="1" spellcheck="true" aria-label="Text"></textarea>
      <div class="te-bar"><button type="button" data-a="del">${old ? 'Löschen' : 'Verwerfen'}</button><button type="button" data-a="ok" class="ok">Fertig</button></div>`;
    const ta = box.querySelector('textarea');
    ta.value = old ? old.text : '';
    Object.assign(ta.style, { color, fontSize: fs * scr + 'px', fontFamily: TXT_FONT, fontWeight: old && old.b ? '700' : '400', fontStyle: old && old.i ? 'italic' : 'normal' });
    const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; ta.style.width = 'auto'; ta.style.width = Math.max(140, ta.scrollWidth + 12) + 'px'; };
    ta.addEventListener('input', fit);
    boardEl.appendChild(box);
    fit();
    setTimeout(() => ta.focus(), 0);
    B.ed = { box, ta, old, o, z, fs, color };
    box.querySelector('[data-a=ok]').onclick = () => boardCommitText(false);
    box.querySelector('[data-a=del]').onclick = () => boardCommitText(true);
  }
  function boardCommitText(remove) {
    const ed = B.ed;
    if (!ed) return;
    B.ed = null;
    B.hide = null;
    ed.box.remove();
    const text = remove ? '' : ed.ta.value.replace(/\s+$/, '');
    const acts = [];
    if (ed.old && (remove || text !== ed.old.text)) { opDel(V.path, [ed.old.id]); acts.push({ t: 'del', strokes: [ed.old] }); }
    if (text && (!ed.old || text !== ed.old.text)) {
      const m = measureTxt(text, ed.fs);
      const st = { id: uid(), p: 0, t: 'txt', c: ed.color, fs: ed.fs, pts: ed.old ? ed.old.pts : [0, 0], text, bw: r2(m.bw), bh: r2(m.bh), o: ed.o, z: ed.z };
      if (ed.old && ed.old.b) st.b = 1;
      if (ed.old && ed.old.i) st.i = 1;
      opAdd(V.path, [st]);
      acts.push({ t: 'add', strokes: [st] });
    }
    if (acts.length) pushHistory(acts.length === 1 ? acts[0] : { t: 'multi', acts });
    boardRender();
  }

  // ---- Bilder einfügen (Knopf, Einfügen aus der Zwischenablage)
  async function boardAddImage(file) {
    if (!V.board || !file) return;
    if (navigator.onLine === false) { toast('Bilder einfügen geht nur mit Internetverbindung.'); return; }
    toast('Bild wird eingefügt …', 30000);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name || 'bild.png');
      const r = await fetch(API + '?a=imgput', { method: 'POST', credentials: 'same-origin', headers: { 'X-PDFStift': '1' }, body: fd });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(res.error || 'Fehler ' + r.status);
      const f = Math.min(1, (B.w * 0.6) / res.w, (B.h * 0.6) / res.h);
      const bw = r2(res.w * f), bh = r2(res.h * f);
      const [wx, wy] = toWorld(B.w / 2 - bw / 2, B.h / 2 - bh / 2);
      const st = { id: uid(), p: 0, t: 'img', c: '#000000', src: res.src, pts: [0, 0], bw, bh, o: [wx, wy], z: B.cam.s };
      opAdd(V.path, [st]);
      pushHistory({ t: 'add', strokes: [st] });
      boardRender();
      $('#toast').hidden = true;
    } catch (e) { toast('Bild: ' + e.message, 6000); }
  }
  // Menü (für iPad ohne Tastatur): Zwischenablage auslesen
  $('#menu').addEventListener('click', async (e) => {
    if (!e.target.closest('[data-act=paste]') || !V.path) return;
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        for (const item of await navigator.clipboard.read()) {
          const type = item.types.find((t) => /^image\//.test(t));
          if (type) { const f = new File([await item.getType(type)], 'eingefuegt.png', { type }); if (V.board) boardAddImage(f); else { IMGDO.mode = 'place'; insertPhoto(f); } return; }
          if (item.types.includes('text/plain')) { const t = await (await item.getType('text/plain')).text(); if (t.trim()) { pasteText(t); return; } }
        }
      } else if (navigator.clipboard && navigator.clipboard.readText) {
        const t = await navigator.clipboard.readText();
        if (t.trim()) { pasteText(t); return; }
      }
      toast('Die Zwischenablage ist leer.');
    } catch (err) { toast('Kein Zugriff auf die Zwischenablage – am PC einfach Strg+V drücken.', 5000); }
  });
  document.addEventListener('paste', (e) => {
    if (!V.board || B.ed) return;
    const it = [...(e.clipboardData ? e.clipboardData.items : [])].find((x) => x.type.startsWith('image/'));
    if (it) { e.preventDefault(); boardAddImage(it.getAsFile()); }
  });

  // ---- Vorschaubild einer Notizseite (für die Notizbuch-Ansicht)
  const nbThumbs = new Map();
  function renderBoardThumb(strokes, W = 320, H = 220) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    const list = [...strokes].sort((a, b) => boardRank(a) - boardRank(b));
    if (!list.length) return c.toDataURL('image/png');
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const s of list) { const w = worldBox(s); b[0] = Math.min(b[0], w[0]); b[1] = Math.min(b[1], w[1]); b[2] = Math.max(b[2], w[2]); b[3] = Math.max(b[3], w[3]); }
    const s = Math.min((W - 16) / Math.max(1e-9, b[2] - b[0]), (H - 16) / Math.max(1e-9, b[3] - b[1]), 2);
    const cx = b[0] - 8 / s, cy = b[1] - 8 / s;
    for (const st of list) {
      const [ox, oy, z] = so(st);
      const k = s / z;
      ctx.setTransform(k, 0, 0, k, (ox - cx) * s, (oy - cy) * s);
      boardStroke(ctx, st);
    }
    return c.toDataURL('image/jpeg', 0.8);
  }
  function boardThumbSave(path) {
    const d = Notes.docs.get(path);
    if (!d) return;
    const info = boardInfo(path);
    nbThumbs.set(path + '|' + (d.strokes.size), renderBoardThumb(d.strokes.values()));
    if (info) info.notesMtime = Date.now() / 1000;
  }
  // ------------------------------------------------------------------ Notizbuch-Ansicht: Notizbücher → Abschnitte → Seiten
  const NB_TAB = '<svg class="tab-nb" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6z"/><path d="M6 3v18"/></svg>';
  const NB_SVG = '<svg viewBox="0 0 24 24"><path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6z"/><path d="M6 3v18M3.5 7H6M3.5 12H6M3.5 17H6"/><path d="M10 8h5M10 11.5h5"/></svg>';
  const SEC_SVG = '<svg viewBox="0 0 24 24"><path d="M4 6h12l4 6-4 6H4z"/></svg>';
  async function loadBoards() {
    try {
      S.boards = (await apiJson('boards')).books;
      DB.put('kv', 'boards', S.boards).catch(() => {});
    } catch (e) {
      if (!S.boards) S.boards = (await DB.get('kv', 'boards')) || [];
    }
    if (S.src === 'nb' && !V.path) renderLibrary();
    renderTabs();
  }
  const nbParts = () => (S.nbPath ? S.nbPath.split('/') : []);
  function goNb(p) { S.nbPath = p; ls('nbPath', p); S.search = ''; $('#search').value = ''; renderLibrary(); $('#library').scrollTop = 0; }
  function nbFind() {
    const [nb, sec] = nbParts();
    const book = nb ? (S.boards || []).find((b) => b.name === nb) : null;
    const section = book && sec ? book.sections.find((s) => s.name === sec) : null;
    return { book, section };
  }
  // ---- Seitenvorlagen: Cornell, Besprechung, Vorlesung (vorgezeichnete Linien und Überschriften, frei änderbar)
  const NB_TPL = [
    ['dots', 'Leer (Punkte)', 'dots'], ['lines', 'Liniert', 'lines'], ['grid', 'Kariert', 'grid'],
    ['cornell', 'Cornell-Notizen', 'plain'], ['meeting', 'Besprechung', 'plain'], ['lecture', 'Vorlesung', 'plain'],
  ];
  function tplStrokes(kind, x0, y0, title) {
    const out = [], W = 800, H = 1130, grey = '#8C95A8', ink = '#3D4657';
    const line = (x1, y1, x2, y2, w = 1.2, c = grey) => out.push({ id: uid(), p: 0, t: 'sh', k: 'line', c, w, pts: [0, 0, r2(x2 - x1), r2(y2 - y1)], o: [x0 + x1, y0 + y1], z: 1 });
    const text = (t, x, y, fs, b, c = ink) => { const m = measureTxt(t, fs, { b }); const st = { id: uid(), p: 0, t: 'txt', c, fs, pts: [0, 0], text: t, bw: r2(m.bw), bh: r2(m.bh), o: [x0 + x, y0 + y], z: 1 }; if (b) st.b = 1; out.push(st); };
    const rule = (y, from = 0, to = W) => line(from, y, to, y, 0.8, '#C3C9D5');
    const date = new Date().toLocaleDateString(LOC);
    if (kind === 'cornell') {
      text(title || 'Thema', 0, 0, 26, 1); text(date, W - 130, 8, 15, 0, grey);
      line(0, 50, W, 50, 1.6, ink);
      text('Stichworte / Fragen', 8, 64, 15, 1, grey); text('Notizen', 258, 64, 15, 1, grey);
      line(240, 50, 240, 900);
      for (let y = 120; y < 890; y += 36) rule(y, 250);
      line(0, 900, W, 900, 1.6, ink);
      text('Zusammenfassung', 8, 912, 15, 1, grey);
      for (let y = 980; y < H; y += 36) rule(y);
    } else if (kind === 'meeting') {
      text(title || 'Besprechung', 0, 0, 26, 1); text(date, W - 130, 8, 15, 0, grey);
      line(0, 50, W, 50, 1.6, ink);
      text('Teilnehmende:', 0, 66, 15, 1, grey); rule(94, 130);
      text('Themen', 0, 120, 18, 1); for (let y = 186; y < 400; y += 36) rule(y);
      text('Beschlüsse', 0, 420, 18, 1); for (let y = 486; y < 660; y += 36) rule(y);
      text('Aufgaben', 0, 680, 18, 1);
      text('Was?', 0, 718, 14, 1, grey); text('Wer?', 470, 718, 14, 1, grey); text('Bis wann?', 650, 718, 14, 1, grey);
      line(0, 742, W, 742, 1.2); line(460, 718, 460, H - 20); line(640, 718, 640, H - 20);
      for (let y = 778; y < H; y += 36) rule(y);
    } else if (kind === 'lecture') {
      text(title || 'Vorlesung', 0, 0, 26, 1); text(date, W - 130, 8, 15, 0, grey);
      line(0, 50, W, 50, 1.6, ink);
      text('Lernziele', 0, 70, 18, 1); for (let y = 136; y < 240; y += 36) rule(y);
      text('Notizen', 0, 260, 18, 1); for (let y = 326; y < 900; y += 36) rule(y);
      text('Offene Fragen', 0, 920, 18, 1); for (let y = 986; y < H; y += 36) rule(y);
    }
    return out;
  }
  // Vorlage wählen (neue Seite oder auf der offenen Notizseite einfügen)
  function tplDialog(forNew) {
    return new Promise((res) => {
      const d = document.createElement('dialog');
      d.className = 'dlg set-dlg tpl-dlg';
      const list = forNew ? NB_TPL : NB_TPL.slice(3);
      d.innerHTML = `<form method="dialog"><h2>${forNew ? 'Neue Seite' : 'Vorlage einfügen'}</h2>
        ${forNew ? '<div class="set-row"><span>Titel</span><input id="tpT" type="text"></div>' : ''}
        <div class="tpl-list">${list.map(([k, l], i) => `<label class="tpl-c"><input type="radio" name="tpk" value="${k}" ${i === 0 ? 'checked' : ''}><span class="tpl-ph tpl-${k}"></span><span>${esc(l)}</span></label>`).join('')}</div>
        <div class="dlg-actions"><button type="submit" value="" class="btn">Abbrechen</button><button type="submit" value="ok" class="btn primary">${forNew ? 'Anlegen' : 'Einfügen'}</button></div></form>`;
      document.body.appendChild(d);
      const last = ls('tplLast');
      const inp = d.querySelector(`input[name=tpk][value="${last}"]`);
      if (inp) inp.checked = true;
      if (forNew) {
        // Titel folgt der Vorlage, solange er nicht selbst geändert wurde
        const tt = d.querySelector('#tpT');
        const auto = () => { const k = d.querySelector('input[name=tpk]:checked').value, tp = NB_TPL.find((x) => x[0] === k); return tp[2] === 'plain' ? tp[1] : 'Neue Seite ' + new Date().toLocaleDateString(LOC); };
        tt.value = auto();
        tt.oninput = () => { tt.dataset.own = '1'; };
        d.querySelectorAll('input[name=tpk]').forEach((r) => r.addEventListener('change', () => { if (!tt.dataset.own) tt.value = auto(); }));
      }
      d.querySelectorAll('.tpl-c').forEach((c) => c.addEventListener('dblclick', () => { d.returnValue = 'ok'; d.close('ok'); }));
      d.addEventListener('close', () => {
        const k = d.querySelector('input[name=tpk]:checked').value, t = forNew ? d.querySelector('#tpT').value.trim() : '';
        d.remove();
        if (d.returnValue !== 'ok') { res(null); return; }
        ls('tplLast', k);
        res({ kind: k, title: t });
      }, { once: true });
      d.showModal();
    });
  }
  async function boardInsertTpl() {
    if (!V.board) return;
    const r = await tplDialog(false);
    if (!r) return;
    let x = 0, y = 0;
    if (V.doc.strokes.size) { const b = [Infinity, Infinity, -Infinity, -Infinity]; for (const s of V.doc.strokes.values()) { const w = worldBox(s); b[0] = Math.min(b[0], w[0]); b[3] = Math.max(b[3], w[3]); } x = b[0]; y = b[3] + 60; }
    const strokes = tplStrokes(r.kind, x, y, '');
    opAdd(V.path, strokes);
    pushHistory({ t: 'add', strokes });
    B.cam.s = clamp(Math.min(1.2, (B.w - 80) / 800), ZMIN, ZMAX); B.cam.x = x - 40 / B.cam.s; B.cam.y = y - 40 / B.cam.s;
    boardRender();
  }
  async function nbNew(kind) {
    const [nb, sec] = nbParts();
    if (navigator.onLine === false) { toast('Neue Notizbücher, Abschnitte und Seiten gehen nur mit Internetverbindung.'); return; }
    try {
      if (kind === 'page') {
        const t = await tplDialog(true);
        if (!t) return;
        const tp = NB_TPL.find((x) => x[0] === t.kind) || NB_TPL[0];
        const title = t.title || (tp[2] === 'plain' ? tp[1] : 'Neue Seite ' + new Date().toLocaleDateString(LOC));
        const r = await apiJson('nbnew', { method: 'POST', body: { kind: 'page', nb, sec, title, bg: tp[2] } });
        const strokes = tplStrokes(t.kind, 0, 0, title);
        if (strokes.length) {
          await localDoc(r.path);
          opAdd(r.path, strokes);
          const sc = clamp(Math.min(1.2, (innerWidth - 120) / 880), ZMIN, ZMAX);
          const cams = ls('cams') || {}; cams[r.path] = { x: -40 / sc, y: -30 / sc, s: sc }; ls('cams', cams);
        }
        await loadBoards();
        openDoc(r.path);
        return;
      }
      const name = await askText(kind === 'nb' ? 'Neues Notizbuch' : 'Neuer Abschnitt', kind === 'nb' ? 'Name des Notizbuchs, z. B. „Makroökonomie“' : `Abschnitt in „${nb}“`, '', 'Anlegen');
      if (!name) return;
      const r = await apiJson('nbnew', { method: 'POST', body: kind === 'nb' ? { kind: 'nb', name } : { kind: 'sec', nb, name } });
      await loadBoards();
      goNb(r.path.slice(4));
    } catch (e) { toast(e.message, 6000); }
  }
  async function nbRename(path, current) {
    const name = await askText('Umbenennen', '', current, 'Umbenennen');
    if (!name || name === current) return;
    try {
      const r = await apiJson('nbrename', { method: 'POST', body: { path, name } });
      // offene Tabs mitziehen
      if (r.path !== path) {
        S.tabs.forEach((t) => { if (t.path.startsWith(path + '/')) t.path = r.path + t.path.slice(path.length); });
        if (S.active && S.active.startsWith(path + '/')) S.active = r.path + S.active.slice(path.length);
        saveTabs();
        if (S.nbPath === path.slice(4) || S.nbPath.startsWith(path.slice(4) + '/')) S.nbPath = r.path.slice(4) + S.nbPath.slice(path.length - 4);
      }
      await loadBoards();
    } catch (e) { toast(e.message, 6000); }
  }
  async function nbDelete(path, label) {
    if (!(await confirmDlg(`„${label}“ löschen?`, 'Es kommt in den Papierkorb auf dem Server (storage/papierkorb) und lässt sich von dort zurückholen.', 'Löschen'))) return;
    try {
      await apiJson('nbdel', { method: 'POST', body: { path } });
      S.tabs.filter((t) => t.path === path || t.path.startsWith(path + '/')).forEach((t) => closeTab(t.path));
      await loadBoards();
      toast('In den Papierkorb gelegt.');
    } catch (e) { toast(e.message, 6000); }
  }
  function nbMenu(wrap, items) {
    closeMenus();
    const m = document.createElement('div');
    m.className = 'menu';
    m.innerHTML = items.map(([a, label]) => `<button type="button" data-a="${a}">${esc(label)}</button>`).join('');
    m.onclick = (e) => { const a = e.target.dataset.a; if (!a) return; closeMenus(); items.find((x) => x[0] === a)[2](); };
    wrap.appendChild(m);
    openMenu = m;
  }
  const nbThumbIO = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      nbThumbIO.unobserve(en.target);
      nbThumb(en.target);
    }
  }, { rootMargin: '300px' });
  let nbThumbChain = Promise.resolve();
  function nbThumb(el) {
    const path = el.dataset.path;
    nbThumbChain = nbThumbChain.then(async () => {
      let strokes = Notes.docs.get(path) ? Notes.docs.get(path).strokes : null;
      if (!strokes) { const rec = await DB.get('notes', path); if (rec) strokes = new Map(Object.entries(rec.strokes || {})); }
      if (!strokes && navigator.onLine !== false) { try { strokes = new Map(Object.entries((await apiJson('notes', { params: { path } })).strokes || {})); } catch (e) { /* */ } }
      if (!strokes || !strokes.size) return;
      const key = path + '|' + strokes.size;
      let url = nbThumbs.get(key);
      if (!url) { url = renderBoardThumb(strokes.values()); nbThumbs.set(key, url); }
      el.innerHTML = `<img alt="" src="${url}">`;
    }).catch(() => {});
  }
  // ---- Ordnen per Ziehen: Seiten, Abschnitte und Notizbücher; Seiten auch in einen anderen Abschnitt
  function nbPathMoved(from, to) {
    S.tabs.forEach((t) => { if (t.path === from) t.path = to; });
    if (S.active === from) S.active = to;
    saveTabs();
    const d = Notes.docs.get(from);
    if (d) { Notes.docs.delete(from); Notes.docs.set(to, d); }
    const pq = Notes.pending.get(from);
    if (pq) { Notes.pending.delete(from); Notes.pending.set(to, pq); persistQueue(to); DB.del('queue', from).catch(() => {}); }
    DB.get('notes', from).then((rec) => { if (rec) { DB.put('notes', to, rec).catch(() => {}); DB.del('notes', from).catch(() => {}); } }).catch(() => {});
    const cams = ls('cams') || {};
    if (cams[from]) { cams[to] = cams[from]; delete cams[from]; ls('cams', cams); }
    if (V.path === from) V.path = to;
  }
  async function nbMovePage(path, to, order) {
    if (navigator.onLine === false) { toast('Verschieben geht nur mit Internetverbindung.'); return; }
    try {
      try { await flush(); } catch (e) { /* */ }
      const r = await apiJson('nbmove', { method: 'POST', body: { path, to, order } });
      if (r.path !== path) nbPathMoved(path, r.path);
      await loadBoards();
      toast(`Seite verschoben nach „${to.slice(4).replace(/\//g, ' › ')}“.`);
    } catch (e) { toast(e.message, 6000); }
  }
  async function nbMoveDialog(pg) {
    const books = S.boards || [];
    const cur = pg.path.split('/').slice(0, 3).join('/');
    const opts = [];
    for (const b of books) for (const s of b.sections) opts.push([`@nb/${b.name}/${s.name}`, `${b.name} › ${s.name}`]);
    const d = document.createElement('dialog');
    d.className = 'dlg set-dlg tonb-dlg';
    d.innerHTML = `<form method="dialog"><h2>Seite verschieben</h2><p class="muted small">„${esc(pg.title)}“ kommt in diesen Abschnitt (ans Ende):</p>
      <div class="set-row"><span>Abschnitt</span><select id="mvTo">${opts.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="dlg-actions"><button type="submit" value="" class="btn">Abbrechen</button><button type="submit" value="ok" class="btn primary">Verschieben</button></div></form>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => { const to = d.querySelector('#mvTo').value; d.remove(); if (d.returnValue === 'ok' && to && to !== cur) nbMovePage(pg.path, to); }, { once: true });
    d.showModal();
  }
  // Liste neu ordnen: gleich in S.boards nachziehen (sofort sichtbar), dann dem Server melden
  function nbApplyOrder(kind, paths) {
    const pos = new Map(paths.map((p, i) => [p, i]));
    const by = (key) => (a, b) => (pos.get(key(a)) ?? 1e9) - (pos.get(key(b)) ?? 1e9);
    if (kind === 'nb') S.boards.sort(by((b) => '@nb/' + b.name));
    for (const b of S.boards) {
      if (kind === 'sec') b.sections.sort(by((s) => `@nb/${b.name}/${s.name}`));
      if (kind === 'page') for (const s of b.sections) s.pages.sort(by((p) => p.path));
    }
    renderLibrary();
    apiJson('nborder', { method: 'POST', body: { paths } }).catch((e) => toast(e.message, 6000));
  }
  let nbDragging = false;
  document.addEventListener('touchmove', (e) => { if (nbDragging) e.preventDefault(); }, { passive: false });
  function nbDragInit(wrap, kind) {
    wrap.querySelectorAll('.card[data-dpath]').forEach((c) => {
      c.addEventListener('click', (e) => { if (c.dataset.dragged) { e.stopPropagation(); e.preventDefault(); delete c.dataset.dragged; } }, true);
      c.addEventListener('contextmenu', (e) => { if (nbDragging) e.preventDefault(); });
      c.addEventListener('dragstart', (e) => e.preventDefault()); // Vorschaubild nicht als Bild ziehen
      c.addEventListener('pointerdown', (e) => {
        if (e.button > 0 || e.target.closest('.more, .menu')) return;
        const touch = e.pointerType !== 'mouse';
        const st = { x: e.clientX, y: e.clientY, id: e.pointerId, on: false, ghost: null, tgt: null, after: false, chip: null };
        let hold = touch ? setTimeout(() => begin(), 380) : 0;
        const clearMarks = () => { wrap.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after')); document.querySelectorAll('.nb-chip.drop').forEach((x) => x.classList.remove('drop')); };
        const begin = () => {
          st.on = true; nbDragging = true;
          const r = c.getBoundingClientRect();
          st.dx = st.x - r.left; st.dy = st.y - r.top;
          st.ghost = c.cloneNode(true);
          st.ghost.className += ' nb-ghost';
          Object.assign(st.ghost.style, { width: r.width + 'px', left: r.left + 'px', top: r.top + 'px' });
          document.body.appendChild(st.ghost);
          c.classList.add('nb-dragging');
          if (navigator.vibrate) navigator.vibrate(10);
        };
        const move = (ev) => {
          if (ev.pointerId !== st.id) return;
          if (!st.on) {
            const dist = Math.hypot(ev.clientX - st.x, ev.clientY - st.y);
            if (touch) { if (dist > 10) end(null, true); return; }
            if (dist < 8) return;
            begin();
          }
          ev.preventDefault();
          st.ghost.style.left = ev.clientX - st.dx + 'px'; st.ghost.style.top = ev.clientY - st.dy + 'px';
          clearMarks();
          st.tgt = null; st.chip = null;
          const el = document.elementFromPoint(ev.clientX, ev.clientY);
          const chip = el && kind === 'page' && el.closest('.nb-chip[data-sec]');
          if (chip && !chip.classList.contains('cur')) { st.chip = chip; chip.classList.add('drop'); return; }
          const t = el && el.closest('.card[data-dpath]');
          if (t && t !== c && t.parentElement === wrap) {
            const r = t.getBoundingClientRect();
            st.tgt = t;
            st.after = wrap.classList.contains('list') ? ev.clientY > r.top + r.height / 2 : ev.clientX > r.left + r.width / 2;
            t.classList.add(st.after ? 'drop-after' : 'drop-before');
          }
        };
        const end = (ev, cancel) => {
          if (ev && ev.pointerId !== st.id) return;
          clearTimeout(hold);
          window.removeEventListener('pointermove', move, true);
          window.removeEventListener('pointerup', end, true);
          window.removeEventListener('pointercancel', cancelEv, true);
          if (!st.on) return;
          nbDragging = false;
          st.ghost.remove();
          c.classList.remove('nb-dragging');
          clearMarks();
          c.dataset.dragged = '1';
          setTimeout(() => { delete c.dataset.dragged; }, 400);
          if (cancel) return;
          if (st.chip) { nbMovePage(c.dataset.dpath, st.chip.dataset.sec); return; }
          if (!st.tgt) return;
          const paths = [...wrap.querySelectorAll('.card[data-dpath]')].map((x) => x.dataset.dpath).filter((p) => p !== c.dataset.dpath);
          paths.splice(paths.indexOf(st.tgt.dataset.dpath) + (st.after ? 1 : 0), 0, c.dataset.dpath);
          nbApplyOrder(kind, paths);
        };
        const cancelEv = (ev) => end(ev, true);
        window.addEventListener('pointermove', move, true);
        window.addEventListener('pointerup', end, true);
        window.addEventListener('pointercancel', cancelEv, true);
      });
    });
  }
  function renderNotebook() {
    const books = S.boards || [];
    let { book, section } = nbFind();
    if (S.nbPath && !book) { S.nbPath = ''; book = null; }
    if (book && nbParts()[1] && !section) { S.nbPath = book.name; }
    ({ book, section } = nbFind());
    const list = S.libView === 'list';
    $('#recentBox').hidden = true;
    $('#folderBar').hidden = true;
    const bar = $('#folders');
    bar.innerHTML = '';
    const crumbs = document.createElement('nav');
    crumbs.className = 'crumbs';
    const mk = (label, val, last) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'crumb' + (last ? ' cur' : ''); b.innerHTML = label;
      b.onclick = () => goNb(val);
      crumbs.appendChild(b);
    };
    const parts = nbParts();
    mk(`${NB_SVG}<span>Notizbücher</span>`, '', !parts.length);
    parts.forEach((seg, i) => {
      const sep = document.createElement('span'); sep.className = 'crumb-sep'; sep.textContent = '›'; crumbs.appendChild(sep);
      mk(esc(seg), parts.slice(0, i + 1).join('/'), i === parts.length - 1);
    });
    bar.appendChild(crumbs);
    const tools = document.createElement('div');
    tools.className = 'lib-tools';
    tools.innerHTML = (!book ? `<button type="button" class="text-btn" data-a="on">${CLOUD_SVG}<span>Aus OneNote übernehmen</span></button><button type="button" class="text-btn" data-a="nb">${NB_SVG}<span>Neues Notizbuch</span></button>`
      : !section ? `<button type="button" class="text-btn" data-a="sec">${SEC_SVG}<span>Neuer Abschnitt</span></button>`
        : '<button type="button" class="btn primary" data-a="page"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Neue Seite</button>') +
      `<div class="seg2 view-toggle" role="group" aria-label="Ansicht">
        <button type="button" data-v="grid" class="${list ? '' : 'active'}" aria-pressed="${!list}" aria-label="Kacheln"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg></button>
        <button type="button" data-v="list" class="${list ? 'active' : ''}" aria-pressed="${list}" aria-label="Liste"><svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg></button></div>`;
    tools.querySelectorAll('[data-a]').forEach((b) => {
      b.onclick = () => ({ on: onImportOpen, nb: () => nbNew('nb'), sec: () => nbNew('sec'), page: () => nbNew('page') })[b.dataset.a]();
    });
    tools.querySelectorAll('[data-v]').forEach((b) => { b.onclick = () => { S.libView = b.dataset.v; ls('libView', S.libView); renderLibrary(); }; });
    bar.appendChild(tools);

    const wrap = $('#files');
    wrap.innerHTML = '';
    wrap.classList.toggle('list', list);
    const empty = $('#libEmpty');
    const q = S.search.trim().toLowerCase();
    const card = (cls, thumb, title, sub, onOpen, menu, dpath) => {
      const c = document.createElement('div');
      c.className = 'card ' + cls;
      if (dpath) c.dataset.dpath = dpath;
      c.innerHTML = `<button type="button" class="thumb">${thumb}</button><div class="meta"><div class="txt"><div class="n">${esc(title)}</div><div class="d">${sub}</div></div>${menu ? `<div class="menu-wrap"><button type="button" class="icon-btn more" aria-label="Mehr zu ${esc(title)}">${MORE_SVG}</button></div>` : ''}</div>`;
      c.querySelector('.thumb').onclick = onOpen;
      c.querySelector('.txt').onclick = onOpen;
      if (menu) c.querySelector('.more').onclick = (ev) => { ev.stopPropagation(); nbMenu(c.querySelector('.menu-wrap'), menu); };
      wrap.appendChild(c);
      return c;
    };
    const pageCard = (pg, where) => {
      const c = card('nb-page' + (pg.level ? ' sub' : ''), '<span class="ph nb-ph">' + NB_SVG + '</span>', pg.title, (where ? esc(where) + ' · ' : '') + fmtDate(Math.max(pg.mtime, pg.notesMtime || 0)) + (pg.onenote ? ' · aus OneNote' : ''),
        () => openDoc(pg.path), [['rn', 'Umbenennen …', () => nbRename(pg.path, pg.title)], ['mv', 'Verschieben nach …', () => nbMoveDialog(pg)], ['del', 'Löschen …', () => nbDelete(pg.path, pg.title)]], where ? null : pg.path);
      const th = c.querySelector('.thumb');
      th.dataset.path = pg.path;
      nbThumbIO.observe(th);
    };
    if (q) {
      // Suche: Seitentitel in allen Notizbüchern
      let n = 0;
      for (const b of books) for (const s of b.sections) for (const pg of s.pages) if (pg.title.toLowerCase().includes(q)) { pageCard(pg, b.name + ' › ' + s.name); n++; }
      empty.hidden = n > 0;
      empty.textContent = 'Kein Seitentitel passt – unten stehen Treffer im Text.';
      return;
    }
    if (!book) {
      for (const b of books) {
        const pages = b.sections.reduce((a, s) => a + s.pages.length, 0);
        const c = card('nb-book', `<span class="nb-cover" style="--c:${b.color}">${NB_SVG}</span>`, b.name, `${b.sections.length} ${b.sections.length === 1 ? 'Abschnitt' : 'Abschnitte'} · ${pages} ${pages === 1 ? 'Seite' : 'Seiten'}`,
          () => goNb(b.name), [['rn', 'Umbenennen …', () => nbRename('@nb/' + b.name, b.name)], ['del', 'Löschen …', () => nbDelete('@nb/' + b.name, b.name)]], '@nb/' + b.name);
        c.style.setProperty('--c', b.color);
      }
      nbDragInit(wrap, 'nb');
      empty.hidden = books.length > 0;
      empty.textContent = 'Noch keine Notizbücher. Lege eines an – oder übernimm deine Notizbücher aus OneNote.';
      return;
    }
    if (!section) {
      wrap.appendChild(Object.assign(document.createElement('div'), { className: 'card folder up', innerHTML: `<button type="button" class="thumb" aria-label="Zurück"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button><div class="meta"><div class="txt"><div class="n">Zurück</div><div class="d">Notizbücher</div></div></div>` }));
      wrap.lastChild.querySelector('.thumb').onclick = () => goNb('');
      for (const s of book.sections) {
        card('nb-sec', `<span class="nb-cover sec" style="--c:${s.color}">${SEC_SVG}</span>`, s.name, `${s.pages.length} ${s.pages.length === 1 ? 'Seite' : 'Seiten'}`,
          () => goNb(book.name + '/' + s.name), [['rn', 'Umbenennen …', () => nbRename('@nb/' + book.name + '/' + s.name, s.name)], ['del', 'Löschen …', () => nbDelete('@nb/' + book.name + '/' + s.name, s.name)]], `@nb/${book.name}/${s.name}`);
      }
      nbDragInit(wrap, 'sec');
      empty.hidden = book.sections.length > 0;
      empty.textContent = 'Dieses Notizbuch hat noch keine Abschnitte.';
      return;
    }
    // Abschnitte als Reiter: antippen wechselt, eine Seite darauf ziehen verschiebt sie dorthin
    if (book.sections.length > 1) {
      const chips = document.createElement('div');
      chips.className = 'nb-chips';
      chips.innerHTML = book.sections.map((s) => `<button type="button" class="nb-chip${s === section ? ' cur' : ''}" data-sec="${esc('@nb/' + book.name + '/' + s.name)}" style="--c:${s.color}"><span>${esc(s.name)}</span><span class="muted small">${s.pages.length}</span></button>`).join('');
      chips.querySelectorAll('.nb-chip').forEach((b) => { b.onclick = () => goNb(b.dataset.sec.slice(4)); });
      bar.appendChild(chips);
    }
    for (const pg of section.pages) pageCard(pg, '');
    nbDragInit(wrap, 'page');
    empty.hidden = section.pages.length > 0;
    empty.textContent = 'Noch keine Seiten. „Neue Seite“ legt eine unendliche Tafel an.';
  }

  // ------------------------------------------------------------------ OneNote übernehmen
  const ON = { running: false, stop: false, frame: null };
  async function onImportOpen() {
    let od = (S.library && S.library.od) || {};
    try { od = await apiJson('odget'); if (S.library) S.library.od = od; } catch (e) { /* */ }
    if (!od.connected || !od.onenote) {
      const ok = await confirmDlg('Microsoft-Anmeldung für OneNote',
        od.connected
          ? 'Für OneNote braucht PDF-Stift eine zusätzliche Berechtigung. In der App-Registrierung unter „API-Berechtigungen“ → Microsoft Graph → Delegiert „Notes.Read“ hinzufügen, dann hier einmal neu anmelden (gleiche Anwendungs-ID).'
          : 'OneNote läuft über deine Microsoft-Anmeldung (wie OneDrive). In der App-Registrierung braucht es zusätzlich die Berechtigung „Notes.Read“.', 'Anmelden');
      if (ok) openOdDlg();
      return;
    }
    const d = $('#onDlg');
    $('#onList').innerHTML = '<p class="muted">Lade deine Notizbücher aus OneNote …</p>';
    $('#onGo').disabled = true;
    $('#onMsg').textContent = '';
    d.showModal();
    try {
      const r = await apiJson('onls');
      ON.books = r.books;
      $('#onList').innerHTML = r.books.length ? r.books.map((b, i) => `<label class="check on-book"><input type="checkbox" data-i="${i}" checked> <b>${esc(b.name)}</b> <span class="muted">${b.sections.length} ${b.sections.length === 1 ? 'Abschnitt' : 'Abschnitte'}</span></label>`).join('') : '<p class="muted">In diesem Microsoft-Konto gibt es keine OneNote-Notizbücher.</p>';
      $('#onGo').disabled = !r.books.length;
    } catch (e) {
      $('#onList').innerHTML = '';
      $('#onMsg').textContent = e.message;
    }
  }
  $('#onGo').onclick = () => {
    const sel = [...document.querySelectorAll('#onList input[data-i]:checked')].map((x) => ON.books[+x.dataset.i]);
    const updates = $('#onUpd').checked;
    $('#onDlg').close();
    if (sel.length) onImport(sel, updates);
  };
  function importUi(text) { const bar = $('#importBar'); bar.hidden = !text; if (text) $('#importText').textContent = text; }
  $('#importStop').onclick = () => { ON.stop = true; $('#importText').textContent = 'Wird nach dieser Seite angehalten …'; };
  async function onImport(books, updates) {
    if (ON.running) return;
    ON.running = true; ON.stop = false;
    let lock = null;
    try { lock = navigator.wakeLock ? await navigator.wakeLock.request('screen') : null; } catch (e) { /* */ }
    let done = 0, skipped = 0, failed = 0, total = 0;
    const errors = [];
    try {
      for (const b of books) {
        for (const sec of b.sections) {
          if (ON.stop) break;
          importUi(`OneNote: „${b.name} › ${sec.name}“ wird gelesen …`);
          let pages;
          try { pages = (await apiJson('onpages', { params: { section: sec.id } })).pages; } catch (e) { errors.push(sec.name + ': ' + e.message); failed++; continue; }
          total += pages.length;
          if (!pages.length) { try { await apiJson('nbnew', { method: 'POST', body: { kind: 'sec', nb: b.name, name: sec.name } }); } catch (e) { /* */ } }
          for (const pg of pages) {
            if (ON.stop) break;
            if (pg.state === 'done' || (pg.state === 'changed' && !updates)) { skipped++; continue; }
            importUi(`OneNote: ${done + 1}. Seite · „${b.name} › ${sec.name} › ${pg.title || 'Unbenannt'}“`);
            try {
              const c = await apiJson('onpage', { params: { id: pg.id } });
              const strokes = await onConvert(c.html, c.inkml, pg.title);
              await apiJson('onsave', { method: 'POST', body: { id: pg.id, nb: b.name, sec: sec.name, title: pg.title, created: pg.created, modified: pg.modified, order: pg.order, level: pg.level, strokes } });
              done++;
            } catch (e) { failed++; errors.push((pg.title || 'Seite') + ': ' + e.message); if (e.status === 401 || /Berechtigung/.test(e.message)) { ON.stop = true; } }
          }
        }
      }
    } finally {
      if (lock) { try { await lock.release(); } catch (e) { /* */ } }
      ON.running = false;
      importUi('');
    }
    await loadBoards();
    toast(`OneNote: ${done} ${done === 1 ? 'Seite' : 'Seiten'} übernommen` + (skipped ? `, ${skipped} schon vorhanden` : '') + (failed ? `, ${failed} Fehler (${errors.slice(0, 2).join('; ')})` : '') + '.', failed ? 10000 : 5000);
    S.src = 'nb'; ls('src', 'nb');
    if (!V.path) renderLibrary();
  }

  // OneNote-Seite (HTML + InkML) → Tafel-Striche. Der Browser setzt das HTML in einem unsichtbaren Rahmen, wir messen jede Zeile.
  function onFrame() {
    if (!ON.frame) {
      const f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-same-origin');
      f.setAttribute('aria-hidden', 'true');
      f.tabIndex = -1;
      Object.assign(f.style, { position: 'fixed', left: '-40000px', top: '0', width: '1600px', height: '1200px', visibility: 'hidden', border: '0' });
      document.body.appendChild(f);
      ON.frame = f;
    }
    return ON.frame;
  }
  const rgbHex = (c) => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || '');
    return m ? '#' + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('').toUpperCase() : '#1A1A1A';
  };
  async function onConvert(html, inkml, title) {
    const f = onFrame();
    const style = `<base href="${esc(new URL('.', location.href).href)}"><style>html,body{margin:0;background:#fff}*{font-family:${TXT_FONT} !important}body{font-size:14.67px;line-height:1.25;width:1600px}img{max-width:none}</style>`;
    const doc = /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1>${style}`) : style + html;
    await new Promise((res) => { f.onload = res; f.srcdoc = doc; setTimeout(res, 8000); });
    const d = f.contentDocument;
    if (!d || !d.body) throw new Error('Seite konnte nicht gelesen werden.');
    await Promise.all([...d.images].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; setTimeout(r, 6000); }))));
    const out = [];
    const add = (s) => out.push({ id: uid(), p: 0, z: 1, ...s });
    const R2 = (n) => Math.round(n * 100) / 100;
    if (title) add({ t: 'txt', c: '#1A1A1A', fs: 26, b: 1, text: title, pts: [0, 0], o: [48, 24], bw: measureTxt(title, 26).bw, bh: 34 });
    // Tabellen: Zellränder
    for (const td of d.querySelectorAll('td, th')) {
      const r = td.getBoundingClientRect();
      if (r.width > 2 && r.height > 2) add({ t: 'sh', k: 'rect', c: '#9AA0B0', w: 1, pts: [0, 0, R2(r.width), R2(r.height)], o: [R2(r.left), R2(r.top)] });
    }
    // Bilder
    for (const im of d.querySelectorAll('img[data-pdfstift-src]')) {
      const r = im.getBoundingClientRect();
      if (r.width > 1 && r.height > 1) add({ t: 'img', c: '#000000', src: im.dataset.pdfstiftSrc, pts: [0, 0], bw: R2(r.width), bh: R2(r.height), o: [R2(r.left), R2(r.top)] });
    }
    // Text: Zeile für Zeile, so wie der Browser umbricht
    const walker = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT);
    const range = d.createRange();
    const firstText = new WeakMap();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue.trim()) continue;
      const el = n.parentElement;
      if (!el || el.closest('style, script, title, head')) continue;
      const cs = d.defaultView.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const fs = Math.max(4, Math.min(120, parseFloat(cs.fontSize) || 14.67));
      const color = rgbHex(cs.color);
      const bold = (parseInt(cs.fontWeight, 10) || 400) >= 600;
      const ital = cs.fontStyle === 'italic';
      // Aufzählungszeichen vor dem ersten Text eines Listenpunkts
      const li = el.closest('li');
      if (li && !firstText.has(li)) {
        firstText.set(li, true);
        range.selectNodeContents(li);
        const lr = range.getClientRects()[0];
        if (lr) {
          const ol = li.parentElement && li.parentElement.tagName === 'OL';
          const mark = ol ? ([...li.parentElement.children].indexOf(li) + 1) + '.' : '•';
          add({ t: 'txt', c: color, fs, text: mark, pts: [0, 0], o: [R2(lr.left - fs * (ol ? 1.4 : 1.0)), R2(lr.top)], bw: fs, bh: fs * 1.25 });
        }
      }
      const txt = n.nodeValue;
      const re = /\S+/g;
      let m, line = null;
      const flush = () => { if (line) add({ t: 'txt', c: color, fs, text: line.words.join(' '), pts: [0, 0], o: [R2(line.x), R2(line.y)], bw: R2(line.r - line.x), bh: R2(Math.max(line.h, fs * 1.25)), ...(bold ? { b: 1 } : {}), ...(ital ? { i: 1 } : {}) }); line = null; };
      while ((m = re.exec(txt))) {
        range.setStart(n, m.index);
        range.setEnd(n, m.index + m[0].length);
        const rs = range.getClientRects();
        const r = rs[0];
        if (!r || (!r.width && !r.height)) continue;
        if (line && Math.abs(r.top - line.y) < r.height * 0.5 && r.left >= line.r - 2) {
          line.words.push(m[0]); line.r = r.right; line.h = Math.max(line.h, r.height);
        } else {
          flush();
          line = { x: r.left, y: r.top, r: r.right, h: r.height, words: [m[0]] };
        }
      }
      flush();
    }
    // Handschrift
    for (const s of parseInkML(inkml)) add(s);
    f.srcdoc = '';
    return out;
  }
  // InkML (Handschrift aus OneNote) → Stift- und Marker-Striche in Pixeln
  function parseInkML(xml) {
    if (!xml || !xml.includes('trace')) return [];
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) return [];
    const NS = 'http://www.w3.org/2003/InkML';
    const all = (el, name) => [...el.getElementsByTagNameNS(NS, name)];
    const xid = (el) => el.getAttribute('xml:id') || el.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id') || el.getAttribute('id') || '';
    const toPx = (v, units) => {
      const u = (units || 'himetric').toLowerCase();
      return v * ({ himetric: 96 / 2540, cm: 96 / 2.54, mm: 96 / 25.4, in: 96, pt: 96 / 72, px: 1, dev: 96 / 2540 }[u] ?? 96 / 2540);
    };
    const ctxs = {};
    for (const c of all(doc, 'context')) {
      const chans = all(c, 'channel').map((ch) => ({ name: ch.getAttribute('name'), units: ch.getAttribute('units') || '', max: +ch.getAttribute('max') || 0 }));
      ctxs[xid(c)] = chans.length ? chans : null;
    }
    const brushes = {};
    for (const b of all(doc, 'brush')) {
      const prop = {};
      for (const p of all(b, 'brushProperty')) prop[p.getAttribute('name')] = { v: p.getAttribute('value'), u: p.getAttribute('units') };
      const w = prop.width ? toPx(parseFloat(prop.width.v), prop.width.u) : 1.5;
      const h = prop.height ? toPx(parseFloat(prop.height.v), prop.height.u) : w;
      const hl = (prop.transparency && +prop.transparency.v > 0) || (prop.rasterOp && /mask/i.test(prop.rasterOp.v)) || (prop.tip && /rect/i.test(prop.tip.v) && h > w * 1.5);
      brushes[xid(b)] = { w: Math.max(w, h), c: /^#[0-9a-f]{6}$/i.test((prop.color || {}).v || '') ? prop.color.v.toUpperCase() : '#1A1A1A', hl, noPr: prop.ignorePressure && prop.ignorePressure.v === 'true' };
    }
    const defCh = [{ name: 'X', units: 'himetric' }, { name: 'Y', units: 'himetric' }];
    const out = [];
    for (const tr of all(doc, 'trace')) {
      const ch = ctxs[(tr.getAttribute('contextRef') || '').replace(/^#/, '')] || Object.values(ctxs).find(Boolean) || defCh;
      const br = brushes[(tr.getAttribute('brushRef') || '').replace(/^#/, '')] || Object.values(brushes)[0] || { w: 1.5, c: '#1A1A1A', hl: false };
      const ix = Math.max(0, ch.findIndex((c) => c.name === 'X')), iy = Math.max(1, ch.findIndex((c) => c.name === 'Y')), iF = ch.findIndex((c) => c.name === 'F');
      const pts = decodeTrace(tr.textContent, ch.length);
      if (!pts.length) continue;
      const flat = [];
      for (const v of pts) {
        const pr = br.noPr || iF < 0 || !ch[iF].max ? 0.5 : Math.max(0.05, Math.min(1, (v[iF] || 0) / ch[iF].max));
        flat.push(Math.round(toPx(v[ix], ch[ix].units) * 100) / 100, Math.round(toPx(v[iy], ch[iy].units) * 100) / 100, Math.round(pr * 100) / 100);
      }
      if (flat.length === 3) flat.push(flat[0] + 0.01, flat[1], flat[2]);
      out.push({ t: br.hl ? 'hl' : 'pen', c: br.c, w: Math.max(0.3, Math.min(60, Math.round(br.w * 100) / 100)), pts: flat, o: [0, 0] });
    }
    return out;
  }
  // InkML-Spuren: Werte explizit (!), als 1. Differenz (') oder 2. Differenz (") – die Angabe gilt je Kanal weiter
  function decodeTrace(text, nch) {
    const pts = [];
    const mode = Array(nch).fill('!'), last = Array(nch).fill(0), vel = Array(nch).fill(0);
    for (const raw of String(text).split(',')) {
      if (!raw.trim()) continue;
      const re = /([!'"])?\s*(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
      let m, c = 0;
      const vals = [];
      while ((m = re.exec(raw)) && c < nch) {
        if (m[1]) mode[c] = m[1];
        const v = parseFloat(m[2]);
        if (mode[c] === '!') { vel[c] = v - last[c]; last[c] = v; } else if (mode[c] === "'") { vel[c] = v; last[c] += v; } else { vel[c] += v; last[c] += vel[c]; }
        vals.push(last[c]);
        c++;
      }
      if (vals.length >= 2) pts.push(vals);
    }
    return pts;
  }

  // ---- Stiftspitze schwebend anzeigen (Apple Pencil mit Hover, Maus): zeigt, wo und wie dick der Strich wird
  const hoverDot = document.createElement('div');
  hoverDot.className = 'pen-hover';
  hoverDot.hidden = true;
  document.body.appendChild(hoverDot);
  function hoverAt(e, onBoard) {
    if (e.buttons || cur || B.cur || !['pen', 'mouse'].includes(e.pointerType) || PR.on) { hoverDot.hidden = true; return; }
    const tool = S.tool;
    let d, color;
    if (tool === 'er') { d = 18; color = 'transparent'; }
    else if (tool === 'pen' || tool === 'hl' || tool === 'sh') {
      const base = onBoard ? (tool === 'hl' ? BOARD_HL[S.wi.hl] : BOARD_PEN[S.wi[tool]]) : (tool === 'hl' ? HL_W[S.wi.hl] : PEN_W[S.wi[tool]]) * ((V.pages[0] && V.pages[0].cssW / V.pages[0].w) || 1) * Math.min(1, V.zoom || 1);
      d = Math.max(4, base * (tool === 'hl' ? 1 : 1.1));
      color = S.color[tool];
    } else { hoverDot.hidden = true; return; }
    hoverDot.hidden = false;
    hoverDot.classList.toggle('er', tool === 'er');
    hoverDot.classList.toggle('hl', tool === 'hl');
    Object.assign(hoverDot.style, { width: d + 'px', height: d + 'px', left: e.clientX - d / 2 + 'px', top: e.clientY - d / 2 + 'px', background: color });
  }
  pagesEl.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') hoverAt(e, false); });
  pagesEl.addEventListener('pointerleave', () => { hoverDot.hidden = true; });
  pagesEl.addEventListener('pointerdown', () => { hoverDot.hidden = true; });

  // ---- Gesten wie in GoodNotes/Notability: Tipp mit zwei Fingern = Rückgängig, mit drei Fingern = Wiederholen
  const TAP = { n: 0, t: 0, pts: null, moved: false };
  function tapStart(touches) {
    if (touches.length > TAP.n) { TAP.n = touches.length; TAP.t = TAP.t || Date.now(); TAP.pts = [...touches].map((x) => [x.clientX, x.clientY]); TAP.moved = false; }
  }
  function tapMove(touches) {
    if (!TAP.pts) return;
    for (const x of touches) {
      if (TAP.pts.every(([px, py]) => Math.hypot(x.clientX - px, x.clientY - py) > 14)) TAP.moved = true;
    }
  }
  function tapEnd(remaining) {
    if (remaining > 0) return;
    const ok = TAP.n >= 2 && TAP.n <= 3 && !TAP.moved && Date.now() - TAP.t < 320;
    const n = TAP.n;
    TAP.n = 0; TAP.t = 0; TAP.pts = null;
    if (!ok || !V.path || cur || B.cur) return false;
    if (n === 2) { if (!$('#undo').disabled) { undo(); toast('Rückgängig', 900); } }
    else if (!$('#redo').disabled) { redo(); toast('Wiederholt', 900); }
    return true;
  }
  viewer.addEventListener('touchstart', (e) => tapStart(e.touches), { passive: true });
  viewer.addEventListener('touchmove', (e) => tapMove(e.touches), { passive: true });
  viewer.addEventListener('touchend', (e) => tapEnd(e.touches.length), { passive: true });
  boardEl.addEventListener('touchstart', (e) => tapStart(e.touches), { passive: true });
  boardEl.addEventListener('touchmove', (e) => tapMove(e.touches), { passive: true });
  boardEl.addEventListener('touchend', (e) => {
    const cam = { ...B.cam };
    if (tapEnd(e.touches.length) && B.camTap) { B.cam = B.camTap; boardRender(); }
    B.camTap = null;
    void cam;
  }, { passive: true });
  boardEl.addEventListener('touchstart', (e) => { if (e.touches.length === 2 && !B.camTap) B.camTap = { ...B.cam }; }, { passive: true });
  boardEl.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') hoverAt(e, true); });
  boardEl.addEventListener('pointerleave', () => { hoverDot.hidden = true; });

  // ------------------------------------------------------------------ Fotos und Bilder einfügen (Kamera oder Fotomediathek)
  // Großes Foto vorher handlich machen (max. 2400 Pixel, JPEG) – lädt schneller und bläht die PDF nicht auf
  async function prepareImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Das Bild konnte nicht gelesen werden.')); i.src = url; });
      const max = 2400;
      const f = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
      const keepPng = file.type === 'image/png' && file.size < 1.5e6 && f === 1;
      if (keepPng || (file.type === 'image/jpeg' && f === 1 && file.size < 2.5e6)) return file;
      const c = document.createElement('canvas');
      c.width = Math.round(im.naturalWidth * f); c.height = Math.round(im.naturalHeight * f);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(im, 0, 0, c.width, c.height);
      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.86));
      return new File([blob], 'foto.jpg', { type: 'image/jpeg' });
    } finally { URL.revokeObjectURL(url); }
  }
  async function uploadImage(file) {
    const fd = new FormData();
    fd.append('file', file, file.name || 'bild.jpg');
    const r = await fetch(API + '?a=imgput', { method: 'POST', credentials: 'same-origin', headers: { 'X-PDFStift': '1' }, body: fd });
    const res = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(res.error || 'Fehler ' + r.status);
    return res;
  }
  const IMGDO = { mode: 'place' };
  async function insertPhoto(file) {
    if (!file || !V.path) return;
    if (navigator.onLine === false) { toast('Fotos einfügen geht nur mit Internetverbindung.'); return; }
    toast(IMGDO.mode === 'page' ? 'Foto wird als neue Seite eingefügt …' : 'Foto wird eingefügt …', 60000);
    try {
      const small = await prepareImage(file);
      if (V.board) { await boardAddImage(small); return; }
      if (IMGDO.mode === 'page') { await photoPage(small); return; }
      const res = await uploadImage(small);
      const P = V.pages[currentPageIndex()];
      if (!P) return;
      // sichtbaren Teil der Seite ermitteln und das Bild dort mittig platzieren
      const sc = P.cssW / P.w;
      const vr = viewer.getBoundingClientRect(), pr = P.el.getBoundingClientRect();
      const vx0 = Math.max(pr.left, vr.left), vx1 = Math.min(pr.right, vr.right), vy0 = Math.max(pr.top, vr.top), vy1 = Math.min(pr.bottom, vr.bottom);
      const cx = ((vx0 + vx1) / 2 - pr.left) / sc, cy = ((vy0 + vy1) / 2 - pr.top) / sc;
      const maxW = Math.min(P.w * 0.7, ((vx1 - vx0) / sc) * 0.8), maxH = Math.min(P.h * 0.7, ((vy1 - vy0) / sc) * 0.8);
      const f = Math.min(maxW / res.w, maxH / res.h);
      const bw = Math.round(res.w * f * 100) / 100, bh = Math.round(res.h * f * 100) / 100;
      const st = { id: uid(), p: P.i, t: 'img', c: '#000000', src: res.src, pts: [Math.round((cx - bw / 2) * 100) / 100, Math.round((cy - bh / 2) * 100) / 100], bw, bh };
      opAdd(V.path, [st]);
      pushHistory({ t: 'add', strokes: [st] });
      drawInk(P);
      // gleich auswählen, damit man es verschieben und in der Größe ändern kann
      S.tool = 'la'; persistTools(); renderToolbar();
      SEL = { P, ids: [st.id] };
      renderSel();
      toast('Foto eingefügt – mit dem Finger oder Stift verschieben, an den Ecken größer/kleiner ziehen. Später wieder auswählen: Lasso → aufs Foto tippen.', 6000);
    } catch (e) { toast('Foto: ' + e.message, 6000); }
  }
  // Foto als eigene, neue Seite nach der aktuellen (z. B. Tafelbild, Handout abfotografiert)
  async function photoPage(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await pageOp({ kind: 'insert', i: currentPageIndex(), style: 'photo', image: bytes, mime: file.type });
  }
  $('#camIn').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; insertPhoto(f); });
  $('#imgIn').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; insertPhoto(f); });
  function photoMenu(btn) {
    closeMenus();
    const m = document.createElement('div');
    m.className = 'menu photo-menu';
    m.innerHTML = '<button type="button" data-a="cam">📷 Foto aufnehmen</button><button type="button" data-a="lib">🖼️ Bild aus Fotos / Dateien</button>' +
      (V.board ? '' : '<span class="menu-sep"></span><button type="button" data-a="pcam">📷 Foto als neue Seite aufnehmen</button><button type="button" data-a="plib">🖼️ Bild als neue Seite</button>');
    m.onclick = (e) => {
      const a = e.target.closest('[data-a]') && e.target.closest('[data-a]').dataset.a;
      if (!a) return;
      closeMenus();
      IMGDO.mode = a.startsWith('p') ? 'page' : 'place';
      (a.endsWith('cam') ? $('#camIn') : $('#imgIn')).click();
    };
    btn.parentElement.appendChild(m);
    openMenu = m;
  }
  $('#bdImgBtn').onclick = (e) => { e.stopPropagation(); photoMenu($('#bdImgBtn')); };

  // ------------------------------------------------------------------ Werkzeugleiste oben, unten, links oder rechts (am Griff ziehen oder antippen)
  const TB_POS = ['top', 'bottom', 'left', 'right'];
  const DOCK = { top: 'dockT', bottom: 'dockB', left: 'dockL', right: 'dockR' };
  const EDGE_OF = { dockT: 'top', dockB: 'bottom', dockL: 'left', dockR: 'right' };
  const BAR_EL = { vb: '#viewBar', tb: '#toolbar', tb2: '#toolbar2', rb: '#obRibbon' };
  // Anordnung der Leisten: je Rand eine Liste von Zeilen (oben/unten) bzw. Spalten (links/rechts),
  // jede Zeile enthält eine oder mehrere Leisten nebeneinander – wie bei Office-Symbolleisten.
  // vb = Symbolleiste (nur wenn sie nicht in der Kopfzeile sitzt), tb = Stifte-Leiste, tb2 = Werkzeug-Leiste
  function layGet() {
    let L = ls('dockLay');
    // Windows-App: einmalig die Standardanordnung (Menüband oben, darunter Stifte, darunter Werkzeuge + Symbolleiste)
    if (window.pdfstiftWin && window.pdfstiftWin.menuPop && !ls('lay2')) { ls('lay2', 1); L = layDefault(); ls('dockLay', L); }
    if ((!L || typeof L !== 'object') && ls('vbPos') == null && ls('tbPos') == null && ls('tb2Pos') == null) L = layDefault();
    if (!L || typeof L !== 'object') {
      // Übernahme der bisherigen Einstellungen
      L = { top: [], bottom: [], left: [], right: [] };
      const vp = ls('vbPos');
      const map = { b: 'bottom', l: 'left', r: 'right' };
      if (map[vp]) { L[map[vp]].push(['vb']); ls('vbPos', 'd'); }
      const p1 = TB_POS.includes(ls('tbPos')) ? ls('tbPos') : 'top';
      const p2 = TB_POS.includes(ls('tb2Pos')) ? ls('tb2Pos') : p1;
      L[p1].push(['tb']); L[p2].push(['tb2']);
    }
    for (const k of TB_POS) L[k] = (Array.isArray(L[k]) ? L[k] : []).map((ln) => (Array.isArray(ln) ? ln.filter((id) => BAR_EL[id]) : [])).filter((ln) => ln.length);
    const seen = new Set();
    for (const k of TB_POS) L[k] = L[k].map((ln) => ln.filter((id) => (seen.has(id) ? false : (seen.add(id), true)))).filter((ln) => ln.length);
    const vbIn = typeof vbPos === 'function' ? vbPos() === 'd' : ls('vbPos') === 'd';
    if (!vbIn) for (const k of TB_POS) L[k] = L[k].map((ln) => ln.filter((id) => id !== 'vb')).filter((ln) => ln.length);
    else if (!seen.has('vb')) L.top.unshift(['vb']);
    if (!seen.has('tb')) L.top.push(['tb']);
    if (!seen.has('tb2')) L.top.push(['tb2']);
    if (!seen.has('rb')) L.top.push(['rb']); // Menüband (Objekte wie in PowerPoint)
    return L;
  }
  // Standardanordnung: Menüband – Stifte – Werkzeuge mit der Symbolleiste daneben
  function layDefault() { ls('vbPos', 'd'); return { top: [['rb'], ['tb'], ['tb2', 'vb']], bottom: [], left: [], right: [] }; }
  function layReset() { ls('dockLay', layDefault()); dockApply(); if (typeof vbSync === 'function') vbSync(); }
  function laySet(L) { ls('dockLay', L); dockApply(); }
  function layRemove(L, id) { for (const k of TB_POS) L[k] = L[k].map((ln) => ln.filter((x) => x !== id)).filter((ln) => ln.length); }
  const edgeOfBar = (id) => { const L = layGet(); return TB_POS.find((k) => L[k].some((ln) => ln.includes(id))) || 'top'; };
  // eine Leiste an einen Rand setzen: neue Zeile (innen oder ganz außen) oder in eine bestehende Zeile an Stelle i
  function barMove(id, edge, line, index) {
    const L = layGet();
    if (id === 'vb') ls('vbPos', 'd');
    layRemove(L, id);
    if (id === 'vb' && !L[edge]) return;
    const lines = L[edge];
    if (line === 'new0') lines.unshift([id]);
    else if (line === 'new' || line == null || !lines[line]) lines.push([id]);
    else lines[line].splice(Math.max(0, Math.min(index ?? lines[line].length, lines[line].length)), 0, id);
    laySet(L);
  }
  const barVisible = (el) => !!el && !el.hidden && !(el.id === 'toolbar2' && $('#toolsRow').hidden);
  function lineSync() { document.querySelectorAll('.dock-line').forEach((ln) => { ln.hidden = ![...ln.children].some(barVisible); }); }
  function dockApply() {
    const L = layGet();
    const vb = $('#viewBar');
    if (!(typeof vbPos === 'function' && vbPos() === 'd')) { const row = $('#viewRow'); if (vb.parentElement !== row) row.insertBefore(vb, row.firstChild); }
    const els = {}; for (const id in BAR_EL) els[id] = $(BAR_EL[id]);
    for (const k of TB_POS) {
      const d = $('#' + DOCK[k]);
      const keep = [];
      L[k].forEach((ln) => {
        const el = document.createElement('div');
        el.className = 'dock-line';
        ln.forEach((id) => el.appendChild(els[id]));
        keep.push(el);
      });
      d.querySelectorAll(':scope > .dock-line').forEach((x) => x.remove());
      keep.forEach((el) => d.appendChild(el));
    }
    const p1 = edgeOfBar('tb');
    S.tbPos = p1;
    TB_POS.forEach((x) => document.body.classList.toggle('tb-' + x, x === p1 && x !== 'top'));
    lineSync();
    tbMeasure();
    requestAnimationFrame(() => { tbMeasure(); window.dispatchEvent(new Event('resize')); });
  }
  function setTbPos(pos) { if (ls('dockLay')) dockApply(); else { ls('tbPos', TB_POS.includes(pos) ? pos : 'top'); dockApply(); } }
  // Maße für den Platz neben/über/unter den Leisten
  function tbMeasure() {
    const top = document.querySelector('.topbar'), dT = $('#dockT');
    const r = document.documentElement.style;
    const y = dT && dT.offsetHeight ? dT.getBoundingClientRect().bottom : (top ? top.getBoundingClientRect().bottom : 56);
    r.setProperty('--top-h', Math.round(y) + 'px');
    r.setProperty('--bot-h', ($('#dockB') ? $('#dockB').offsetHeight : 0) + 'px');
    r.setProperty('--dl', ($('#dockL') ? $('#dockL').offsetWidth : 0) + 'px');
    r.setProperty('--dr', ($('#dockR') ? $('#dockR').offsetWidth : 0) + 'px');
  }
  if ('ResizeObserver' in window) {
    let tbT = 0;
    const ro = new ResizeObserver(() => { tbMeasure(); clearTimeout(tbT); tbT = setTimeout(() => window.dispatchEvent(new Event('resize')), 50); });
    ['#dockT', '#dockB', '#dockL', '#dockR'].forEach((q) => ro.observe($(q)));
    ro.observe(document.querySelector('.topbar'));
  }
  // Werkzeug-Leiste erscheint und verschwindet zusammen mit der Stifte-Leiste; leere Zeilen ausblenden
  new MutationObserver(() => { $('#toolbar2').hidden = $('#toolbar').hidden; lineSync(); obRibbonSync(); obCompactSync(); }).observe($('#toolbar'), { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(() => lineSync()).observe($('#toolsRow'), { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(() => lineSync()).observe($('#viewBar'), { attributes: true, attributeFilter: ['hidden'] });
  const drop = $('#tbDrop');
  function edgeAt(x, y) {
    const W = window.innerWidth, H = window.innerHeight;
    const d = { left: x, right: W - x, top: y, bottom: H - y };
    return Object.entries(d).sort((a, b) => a[1] - b[1])[0][0];
  }
  // Wohin fällt eine gezogene Leiste? In eine bestehende Zeile (zwischen zwei Leisten) oder als neue Zeile an einen Rand
  function dropTarget(x, y, id) {
    const me = $(BAR_EL[id]);
    for (const ln of document.querySelectorAll('.dock-line')) {
      if (ln.hidden || !ln.offsetWidth) continue;
      const r = ln.getBoundingClientRect();
      if (x < r.left - 4 || x > r.right + 4 || y < r.top - 4 || y > r.bottom + 4) continue;
      const dock = ln.parentElement.id, edge = EDGE_OF[dock], vert = edge === 'left' || edge === 'right';
      const bars = [...ln.children].filter((b) => b !== me && barVisible(b));
      let index = 0;
      for (const b of bars) { const br = b.getBoundingClientRect(); if ((vert ? y > br.top + br.height / 2 : x > br.left + br.width / 2)) index++; }
      const line = [...ln.parentElement.children].indexOf(ln);
      // Lage des Einfügestrichs
      let pos;
      if (!bars.length) pos = vert ? r.top + 4 : r.left + 4;
      else if (index < bars.length) { const br = bars[index].getBoundingClientRect(); pos = vert ? br.top - 2 : br.left - 2; }
      else { const br = bars[bars.length - 1].getBoundingClientRect(); pos = vert ? br.bottom + 1 : br.right + 1; }
      // Index in der gespeicherten Zeile (versteckte Leisten mitzählen)
      const L = layGet(); const ids = (L[edge][line] || []).filter((q) => q !== id);
      const visIds = bars.map((b) => Object.keys(BAR_EL).find((k) => $(BAR_EL[k]) === b));
      const at = index < visIds.length ? ids.indexOf(visIds[index]) : ids.length;
      return { edge, line, index: at, ins: vert ? { left: r.left, top: pos, width: r.width, height: 3 } : { left: pos, top: r.top, width: 3, height: r.height } };
    }
    const edge = edgeAt(x, y);
    const d = $('#' + DOCK[edge]).getBoundingClientRect();
    const inner = { top: y > d.bottom, bottom: y < d.top, left: x > d.right, right: x < d.left }[edge];
    return { edge, line: inner || !$('#' + DOCK[edge]).offsetWidth ? 'new' : 'new0' };
  }
  // Griff einer Leiste: ziehen (in eine Zeile neben andere Leisten oder als neue Zeile) oder antippen (Auswahl)
  function dockGrip(grip, o) {
    let g = null;
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { grip.setPointerCapture(e.pointerId); } catch (err) { /* */ }
      g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, t: null };
    });
    grip.addEventListener('pointermove', (e) => {
      if (!g || g.id !== e.pointerId) return;
      if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < 12) return;
      g.moved = true;
      const t = g.t = o.target ? o.target(e.clientX, e.clientY) : dropTarget(e.clientX, e.clientY, o.bar);
      drop.hidden = false;
      if (t.ins) {
        drop.className = 'tb-drop ins';
        drop.textContent = '';
        Object.assign(drop.style, { left: t.ins.left + 'px', top: t.ins.top + 'px', width: t.ins.width + 'px', height: t.ins.height + 'px', right: 'auto', bottom: 'auto' });
      } else {
        drop.style.cssText = '';
        drop.className = 'tb-drop ' + t.edge;
        drop.textContent = o.label(t.edge, t);
      }
      document.body.classList.add('tb-dragging');
    });
    const end = (e) => {
      if (!g || g.id !== e.pointerId) return;
      const d = g; g = null;
      drop.hidden = true; drop.style.cssText = '';
      document.body.classList.remove('tb-dragging');
      if (d.moved && d.t) { o.drop(d.t); return; }
      if (d.moved) return;
      closeMenus();
      const m = document.createElement('div');
      m.className = 'menu tb-pos-menu';
      const cur = o.get();
      m.innerHTML = TB_POS.map((p) => `<button type="button" data-p="${p}"${p === cur ? ' class="on"' : ''}>${o.label(p)}</button>`).join('') + (o.extra || []).map(([k, l]) => `<button type="button" data-p="${k}"${k === cur ? ' class="on"' : ''}>${l}</button>`).join('');
      m.onclick = (ev) => { const b = ev.target.closest('[data-p]'); if (!b) return; closeMenus(); o.set(b.dataset.p); };
      grip.parentElement.appendChild(m);
      openMenu = m;
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', (e) => { if (g) g.moved = false; end(e); });
  }
  const TB1_LABEL = { top: 'Stifte-Leiste oben', bottom: 'Stifte-Leiste unten', left: 'Stifte-Leiste links', right: 'Stifte-Leiste rechts' };
  const TB2_LABEL = { top: 'Werkzeug-Leiste oben', bottom: 'Werkzeug-Leiste unten', left: 'Werkzeug-Leiste links', right: 'Werkzeug-Leiste rechts' };
  const VB_LABEL = { top: 'Symbolleiste oben', bottom: 'Symbolleiste unten', left: 'Symbolleiste links', right: 'Symbolleiste rechts' };
  const barGrip = (id, grip, labels) => dockGrip(grip, {
    bar: id,
    get: () => edgeOfBar(id),
    set: (p) => barMove(id, p, 'new'),
    drop: (t) => barMove(id, t.edge, t.line, t.index),
    label: (p) => labels[p],
  });
  barGrip('tb', $('#tbGrip'), TB1_LABEL);
  barGrip('tb2', $('#tb2Grip'), TB2_LABEL);
  barGrip('rb', $('#rbGrip'), { top: 'Menüband oben', bottom: 'Menüband unten', left: 'Menüband links', right: 'Menüband rechts' });
  dockGrip($('#vbGrip'), {
    bar: 'vb',
    get: () => (vbPos() === 'd' ? edgeOfBar('vb') : vbPos() === '2' ? 'top2' : vbPos()),
    set: (p) => { if (p === 'cfg') { vbConfig(); return; } if (TB_POS.includes(p)) { barMove('vb', p, 'new'); vbSync(); return; } ls('vbPos', p === 'top2' ? '2' : p); dockApply(); vbSync(); },
    // oben am Rand (nicht auf einer Zeile): eigene Zeile unter den Tabs
    drop: (t) => { if (t.edge === 'top' && !t.ins) { ls('vbPos', '2'); dockApply(); } else barMove('vb', t.edge, t.line, t.index); vbSync(); },
    label: (p) => (p === 'top' ? 'Symbolleiste oben (unter den Tabs)' : VB_LABEL[p]),
    extra: [['top2', 'Eigene Zeile unter den Tabs'], ['1', 'In der Tab-Zeile'], ['0', 'Ausblenden'], ['cfg', 'Knöpfe auswählen …']],
  });
  // ------------------------------------------------------------------ Lasso
  function liveCtx(P) {
    const c = P.det ? P.det.live : P.live;
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (P.det) ctx.setTransform(1, 0, 0, 1, -P.det.r.x * P.det.dpr, -P.det.r.y * P.det.dpr);
    return { ctx, k: P.det ? (P.cssW / P.w) * P.det.dpr : P.k };
  }
  function drawLasso(c) {
    const { ctx, k } = liveCtx(c.P);
    const p = c.lasso;
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5 * Math.min(window.devicePixelRatio || 1, 2);
    ctx.strokeStyle = '#1E2F6E';
    ctx.fillStyle = 'rgba(30,47,110,.06)';
    ctx.beginPath();
    for (let i = 0; i < p.length; i += 2) (i ? ctx.lineTo(p[i] * k, p[i + 1] * k) : ctx.moveTo(p[i] * k, p[i + 1] * k));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  // Notiz um (cx, cy) vergrößern/verkleinern
  // Notiz um (cx, cy) drehen: Bilder, Stempel, Textfelder bekommen eine eigene Drehung, Freihandstriche werden mitgedreht
  function rotateStroke(s, deg, cx, cy) {
    if (!deg || s.t === 'tx') return s;
    const a = deg * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
    const R = (x, y) => [Math.round((cx + (x - cx) * co - (y - cy) * si) * 100) / 100, Math.round((cy + (x - cx) * si + (y - cy) * co) * 100) / 100];
    const p = s.pts.slice();
    const o = { ...s };
    if (s.t === 'txt' || s.t === 'img') {
      const w = s.bw || 0, h = s.bh || 0;
      const [nx, ny] = R(p[0] + w / 2, p[1] + h / 2);
      p[0] = Math.round((nx - w / 2) * 100) / 100; p[1] = Math.round((ny - h / 2) * 100) / 100;
      o.r = ((((s.r || 0) + deg) % 360) + 360) % 360;
      if (Math.abs(o.r) < 0.01 || Math.abs(o.r - 360) < 0.01) delete o.r;
    } else if (s.t === 'sh') { [p[0], p[1]] = R(p[0], p[1]); [p[2], p[3]] = R(p[2], p[3]); }
    else { for (let i = 0; i + 1 < p.length; i += 3) [p[i], p[i + 1]] = R(p[i], p[i + 1]); }
    o.pts = p;
    return o;
  }
  function scaleStroke(s, f, cx, cy) {
    const r = (v) => Math.round(v * 100) / 100;
    const X = (x) => r(cx + (x - cx) * f), Y = (y) => r(cy + (y - cy) * f);
    const p = s.pts.slice();
    const o = { ...s };
    if (s.t === 'tx') { for (let i = 0; i + 3 < p.length; i += 4) { p[i] = X(p[i]); p[i + 1] = Y(p[i + 1]); p[i + 2] = r(p[i + 2] * f); p[i + 3] = r(p[i + 3] * f); } }
    else if (s.t === 'sh') { p[0] = X(p[0]); p[1] = Y(p[1]); p[2] = X(p[2]); p[3] = Y(p[3]); }
    else if (s.t === 'txt' || s.t === 'img') { p[0] = X(p[0]); p[1] = Y(p[1]); o.bw = r(s.bw * f); o.bh = r(s.bh * f); if (s.t === 'txt') o.fs = Math.max(4, Math.min(120, r(s.fs * f))); }
    else { for (let i = 0; i + 1 < p.length; i += 3) { p[i] = X(p[i]); p[i + 1] = Y(p[i + 1]); } }
    if (s.w) o.w = Math.max(0.01, Math.min(60, Math.round(s.w * f * 1000) / 1000));
    o.pts = p;
    return o;
  }
  function translateStroke(s, dx, dy) {
    const p = s.pts.slice();
    const r = (v) => Math.round(v * 100) / 100;
    if (s.t === 'tx') { for (let i = 0; i + 3 < p.length; i += 4) { p[i] = r(p[i] + dx); p[i + 1] = r(p[i + 1] + dy); } }
    else if (s.t === 'sh') { p[0] = r(p[0] + dx); p[1] = r(p[1] + dy); p[2] = r(p[2] + dx); p[3] = r(p[3] + dy); }
    else if (s.t === 'txt') { p[0] = r(p[0] + dx); p[1] = r(p[1] + dy); }
    else { for (let i = 0; i + 1 < p.length; i += 3) { p[i] = r(p[i] + dx); p[i + 1] = r(p[i + 1] + dy); } }
    return { ...s, pts: p };
  }
  function drawDrag(c) {
    const { ctx, k } = liveCtx(c.P);
    SEL.ids.forEach((id) => { const s = V.doc.strokes.get(id); if (s) strokePath(ctx, translateStroke(s, c.dx, c.dy), k); });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (SEL.box) { const sc = c.P.cssW / c.P.w; SEL.box.style.transform = `translate(${c.dx * sc}px, ${c.dy * sc}px)`; }
    if (SEL.bar) SEL.bar.hidden = true;
  }
  function pip(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
      const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function finishLasso(c) {
    const poly = c.lasso;
    const xs = poly.filter((_, i) => i % 2 === 0), ys = poly.filter((_, i) => i % 2 === 1);
    const span = (Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys)) * (c.P.cssW / c.P.w);
    if (poly.length < 8 || span < 12) {
      const im = imageAt(c.P, poly[0], poly[1]);
      if (im) { SEL = { P: c.P, ids: [im.id] }; renderSel(); }
      return;
    }
    const ids = [];
    for (const s of V.doc.strokes.values()) {
      if (s.p !== c.P.i || s.t === 'ob') continue;
      if (s.t === 'pen' || s.t === 'hl') {
        let n = 0, inn = 0;
        for (let i = 0; i + 1 < s.pts.length; i += 3) { n++; if (pip(s.pts[i], s.pts[i + 1], poly)) inn++; }
        if (n && inn / n >= 0.5) ids.push(s.id);
      } else {
        const b = bbox(s);
        if (pip((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, poly)) ids.push(s.id);
      }
    }
    if (!ids.length) { toast('Nichts ausgewählt – kreise Notizen ganz ein.'); return; }
    SEL = { P: c.P, ids };
    renderSel();
  }
  // Ziehen im Rahmen = verschieben, an einer Ecke = größer/kleiner (Seitenverhältnis bleibt) – mit Finger, Stift oder Maus
  function selDown(e) {
    if (!SEL) return;
    e.preventDefault();
    e.stopPropagation();
    const h = e.target.closest('.sel-h, .sel-rot');
    try { SEL.box.setPointerCapture(e.pointerId); } catch (err) { /* */ }
    SEL.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, mode: h ? h.dataset.c : 'move', b: SEL.b.slice(), fn: null, moved: 0 };
    hiddenIds = new Set(SEL.ids);
    drawInk(SEL.P);
    liveStart(SEL.P, { t: 'pen' });
    if (SEL.bar) SEL.bar.hidden = true;
  }
  function selFn(d, e) {
    const P = SEL.P, sc = P.cssW / P.w;
    const dx = (e.clientX - d.x0) / sc, dy = (e.clientY - d.y0) / sc;
    d.moved = Math.max(d.moved, Math.hypot(e.clientX - d.x0, e.clientY - d.y0));
    const b = d.b;
    if (d.mode === 'move') return { fn: (s) => translateStroke(s, dx, dy), box: [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy] };
    if (d.mode === 'rot') {
      // Drehen um die Mitte der Auswahl; rastet bei 0/15/30 … Grad ein
      const pr = P.el.getBoundingClientRect();
      const mx = (b[0] + b[2]) / 2, my = (b[1] + b[3]) / 2;
      const a0 = Math.atan2(d.y0 - pr.top - my * sc, d.x0 - pr.left - mx * sc), a1 = Math.atan2(e.clientY - pr.top - my * sc, e.clientX - pr.left - mx * sc);
      let deg = (a1 - a0) * 180 / Math.PI;
      const snap = Math.round(deg / 15) * 15;
      if (Math.abs(deg - snap) < 4) deg = snap;
      deg = Math.round(deg);
      d.deg = deg;
      return { fn: (s) => rotateStroke(s, deg, mx, my), box: b };
    }
    const ax = d.mode.includes('w') ? b[2] : b[0], ay = d.mode.includes('n') ? b[3] : b[1];
    const cx = d.mode.includes('w') ? b[0] : b[2], cy = d.mode.includes('n') ? b[1] : b[3];
    const fx = Math.abs(cx + dx - ax) / Math.max(1, Math.abs(cx - ax)), fy = Math.abs(cy + dy - ay) / Math.max(1, Math.abs(cy - ay));
    const f = clamp(Math.max(fx, fy), 12 / Math.max(b[2] - b[0], b[3] - b[1], 1), 20);
    return { fn: (s) => scaleStroke(s, f, ax, ay), box: [ax + (b[0] - ax) * f, ay + (b[1] - ay) * f, ax + (b[2] - ax) * f, ay + (b[3] - ay) * f] };
  }
  function selMove(e) {
    const d = SEL && SEL.drag;
    if (!d || d.id !== e.pointerId) return;
    e.preventDefault();
    const r = selFn(d, e);
    d.fn = r.fn;
    const P = SEL.P;
    const { ctx, k } = liveCtx(P);
    SEL.ids.forEach((id) => { const s = V.doc.strokes.get(id); if (s) strokePath(ctx, r.fn(s), k); });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const bx = [Math.min(r.box[0], r.box[2]), Math.min(r.box[1], r.box[3]), Math.max(r.box[0], r.box[2]), Math.max(r.box[1], r.box[3])];
    const pct = (v, dd) => (v / dd) * 100 + '%';
    Object.assign(SEL.box.style, { left: pct(bx[0], P.w), top: pct(bx[1], P.h), width: pct(bx[2] - bx[0], P.w), height: pct(bx[3] - bx[1], P.h) });
  }
  function selUp(e) {
    const d = SEL && SEL.drag;
    if (!d || d.id !== e.pointerId) return;
    SEL.drag = null;
    const P = SEL.P;
    liveEnd(P);
    hiddenIds = null;
    if (!d.fn || d.moved < 3) { drawInk(P); renderSel(); return; }
    replaceSel(d.fn);
  }
  // Lasso: kurzes Antippen eines Fotos wählt es aus
  function imageAt(P, x, y) {
    const list = pageStrokes(P.i).filter((s) => s.t === 'img' || s.t === 'txt');
    for (let i = list.length - 1; i >= 0; i--) { const b = bbox(list[i]); if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) return list[i]; }
    return null;
  }
  function clearSel() {
    if (SEL) { if (SEL.box) SEL.box.remove(); if (SEL.bar) SEL.bar.remove(); }
    SEL = null;
    hiddenIds = null;
  }
  function renderSel() {
    if (!SEL) return;
    if (SEL.box) SEL.box.remove();
    if (SEL.bar) SEL.bar.remove();
    const P = SEL.P;
    SEL.ids = SEL.ids.filter((id) => V.doc.strokes.has(id));
    if (!SEL.ids.length) { clearSel(); return; }
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const id of SEL.ids) {
      const s = V.doc.strokes.get(id);
      const bb = bbox(s);
      const pad = (s.w || 0) / 2 + 4;
      b = [Math.min(b[0], bb[0] - pad), Math.min(b[1], bb[1] - pad), Math.max(b[2], bb[2] + pad), Math.max(b[3], bb[3] + pad)];
    }
    const pct = (v, d) => (v / d) * 100 + '%';
    const box = document.createElement('div');
    box.className = 'sel-box';
    box.style.cssText = `left:${pct(b[0], P.w)};top:${pct(b[1], P.h)};width:${pct(b[2] - b[0], P.w)};height:${pct(b[3] - b[1], P.h)}`;
    box.innerHTML = '<i class="sel-h" data-c="nw"></i><i class="sel-h" data-c="ne"></i><i class="sel-h" data-c="sw"></i><i class="sel-h" data-c="se"></i><i class="sel-rot" data-c="rot" title="Drehen"></i>';
    SEL.b = b;
    box.addEventListener('pointerdown', selDown);
    box.addEventListener('pointermove', selMove);
    box.addEventListener('pointerup', selUp);
    box.addEventListener('pointercancel', selUp);
    const bar = document.createElement('div');
    bar.className = 'sel-bar';
    const below = b[3] / P.h < 0.85;
    bar.style.cssText = `left:${pct(Math.max(0, b[0]), P.w)};${below ? 'top:calc(' + pct(b[3], P.h) + ' + 8px)' : 'bottom:calc(' + pct(P.h - b[1], P.h) + ' + 8px)'}`;
    bar.innerHTML = PALETTE.slice(0, 8).map(([hex, label]) => `<button type="button" class="sw" data-c="${hex}" aria-label="${label}"><span style="background:${hex}"></span></button>`).join('') +
      '<button type="button" class="text-btn" data-a="smaller" aria-label="Kleiner">−</button><button type="button" class="text-btn" data-a="bigger" aria-label="Größer">+</button>' +
      '<button type="button" class="text-btn" data-a="rotl" aria-label="Nach links drehen" title="15° nach links">⟲</button><button type="button" class="text-btn" data-a="rotr" aria-label="Nach rechts drehen" title="15° nach rechts">⟳</button>' +
      (SEL.ids.some((id) => (V.doc.strokes.get(id) || {}).t === 'txt')
        ? '<span class="sb-sep"></span>' + TXT_BG.map((c) => `<button type="button" class="sw te-bg" data-bg="${c}" style="--c:${c || 'transparent'}" title="Hintergrund">${c ? '' : '∅'}</button>`).join('') + '<button type="button" class="text-btn" data-a="bo" title="Rahmen an/aus">▭</button><span class="sb-sep"></span>'
        : '') +
      '<button type="button" class="text-btn" data-a="del">Löschen</button><button type="button" class="text-btn" data-a="done">Fertig</button>';
    bar.onclick = (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.a === 'bigger' || btn.dataset.a === 'smaller') {
        const f = btn.dataset.a === 'bigger' ? 1.25 : 0.8;
        const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
        replaceSel((s) => scaleStroke(s, f, cx, cy));
        return;
      }
      if (btn.dataset.bg !== undefined) {
        const v = btn.dataset.bg;
        replaceSel((s2) => { if (s2.t !== 'txt') return s2; const o = { ...s2 }; if (v) o.bg = v; else delete o.bg; return o; });
        return;
      }
      if (btn.dataset.a === 'bo') {
        const on = !SEL.ids.some((id) => (V.doc.strokes.get(id) || {}).bo);
        replaceSel((s2) => { if (s2.t !== 'txt') return s2; const o = { ...s2 }; if (on) o.bo = s2.c && /^#[0-9a-f]{6}$/i.test(s2.c) ? s2.c : '#1a1a1a'; else delete o.bo; return o; });
        return;
      }
      if (btn.dataset.a === 'rotl' || btn.dataset.a === 'rotr') {
        replaceSel((s) => rotateStroke(s, btn.dataset.a === 'rotr' ? 15 : -15, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2));
        return;
      }
      if (btn.dataset.c) recolorSel(btn.dataset.c);
      if (btn.dataset.a === 'del') deleteSel();
      if (btn.dataset.a === 'done') clearSel();
    };
    P.el.append(box, bar);
    SEL.box = box;
    SEL.bar = bar;
  }
  function replaceSel(fn) {
    const olds = SEL.ids.map((id) => V.doc.strokes.get(id)).filter(Boolean);
    const news = olds.map((s) => ({ ...fn(s), id: uid() }));
    opDel(V.path, olds.map((s) => s.id));
    opAdd(V.path, news);
    pushHistory({ t: 'multi', acts: [{ t: 'del', strokes: olds }, { t: 'add', strokes: news }] });
    const P = SEL.P;
    SEL.ids = news.map((s) => s.id);
    drawInk(P);
    renderSel();
  }
  function finishDrag(c) {
    drawInk(c.P);
    if (Math.hypot(c.dx, c.dy) * (c.P.cssW / c.P.w) < 2) { renderSel(); return; }
    replaceSel((s) => translateStroke(s, c.dx, c.dy));
  }
  function recolorSel(color) { if (SEL) replaceSel((s) => ({ ...s, c: color })); }
  function deleteSel() {
    if (!SEL) return;
    const olds = SEL.ids.map((id) => V.doc.strokes.get(id)).filter(Boolean);
    const P = SEL.P;
    clearSel();
    opDel(V.path, olds.map((s) => s.id));
    pushHistory({ t: 'del', strokes: olds });
    drawInk(P);
  }

  // ------------------------------------------------------------------ Seiten bearbeiten
  function pageMenu(btn, i) {
    closeMenus();
    const m = document.createElement('div');
    m.className = 'menu ov-menu';
    m.innerHTML = `<button type="button" data-k="blank">Leere Seite danach einfügen</button>
      <button type="button" data-k="grid">Karierte Seite danach einfügen</button>
      <button type="button" data-k="lines">Linierte Seite danach einfügen</button>
      <button type="button" data-k="rotate">Drehen</button>
      <button type="button" data-k="up" ${i === 0 ? 'disabled' : ''}>Nach vorne</button>
      <button type="button" data-k="down" ${i === V.pages.length - 1 ? 'disabled' : ''}>Nach hinten</button>
      <button type="button" data-k="del">Löschen …</button>`;
    const r = btn.getBoundingClientRect();
    m.style.left = Math.min(r.left, window.innerWidth - 300) + 'px';
    m.style.top = Math.min(r.bottom + 6, window.innerHeight - 380) + 'px';
    m.style.zIndex = 60;
    m.onclick = (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      closeMenus();
      closeOverview();
      if (['blank', 'grid', 'lines'].includes(k)) pageOp({ kind: 'insert', i, style: k });
      if (k === 'rotate') pageOp({ kind: 'rotate', i });
      if (k === 'up' || k === 'down') pageOp({ kind: 'move', i, dir: k === 'up' ? -1 : 1 });
      if (k === 'del') pageOp({ kind: 'delete', i });
    };
    document.body.appendChild(m);
    openMenu = m;
  }
  // ---- Schnelles Speichern großer PDFs: nur die Änderung anhängen („inkrementelles Speichern“)
  // Beim Laden mit pdf-lib merken wir uns jeden Baustein der PDF. Beim Speichern werden nur geänderte und neue Bausteine
  // hinten an die unveränderte Datei angehängt. Hochgeladen wird dann nur dieser Anhang – oft wenige KB statt vieler MB.
  const INC = { snap: new WeakMap(), out: new WeakMap() };
  const u8 = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));
  const pdfSer = (o) => { const b = new Uint8Array(o.sizeInBytes()); o.copyBytesInto(b, 0); return b; };
  const sameBytes = (a, b) => { if (a.length !== b.length) return false; for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false; return true; };
  function incKey(o) {
    if (o instanceof PDFLib.PDFStream) return { o, d: pdfSer(o.dict), c: o.contents };
    return { o, d: pdfSer(o) };
  }
  function incChanged(k, o) {
    if (!k || k.o !== o) return true;
    if (o instanceof PDFLib.PDFStream) return o.contents !== k.c || !sameBytes(pdfSer(o.dict), k.d);
    return !sameBytes(pdfSer(o), k.d);
  }
  {
    const load0 = PDFLib.PDFDocument.load.bind(PDFLib.PDFDocument);
    PDFLib.PDFDocument.load = async function (bytes, opts) {
      const doc = await load0(bytes, { ...(opts || {}), updateMetadata: false });
      try {
        const m = new Map();
        for (const [ref, o] of doc.context.enumerateIndirectObjects()) m.set(ref.tag, incKey(o));
        // Objektströme und Querverweis-Ströme zählt pdf-lib nicht mit: neue Bausteine dürfen deren Nummern nicht bekommen
        const u = u8(bytes), dec = new TextDecoder('latin1');
        const endTxt = dec.decode(u.subarray(Math.max(0, u.length - 4096)));
        const sx = endTxt.lastIndexOf('startxref');
        let size = 0;
        const sizes = (t) => { for (const mm of t.matchAll(/\/Size\s+(\d+)/g)) size = Math.max(size, +mm[1]); };
        sizes(endTxt);
        if (sx >= 0) { const at = parseInt(endTxt.slice(sx + 9).trim(), 10); if (at > 0 && at < u.length) sizes(dec.decode(u.subarray(at, at + 4096))); }
        if (size - 1 > doc.context.largestObjectNumber) doc.context.largestObjectNumber = size - 1;
        INC.snap.set(doc, { base: bytes, m });
      } catch (e) { /* dann eben vollständig speichern */ }
      return doc;
    };
  }
  // Fingerabdruck einer Fassung (Anfang + Ende), damit der Server prüfen kann, ob der Anhang auf seine Datei passt
  async function pdfFp(buf) {
    if (!(window.crypto && crypto.subtle)) return '';
    const u = u8(buf), n = u.length;
    const a = u.subarray(0, Math.min(65536, n)), b = u.subarray(Math.max(0, n - 1048576));
    const all = new Uint8Array(a.length + b.length); all.set(a); all.set(b, a.length);
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', all))].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  async function incSave(doc, sn) {
    const { PDFName, PDFNumber, PDFStream } = PDFLib;
    const ctx = doc.context, tr = ctx.trailerInfo;
    const no = (why) => { console.debug('Anhängen nicht möglich:', why); return null; };
    if (tr.Encrypt || !tr.Root || doc.getPageCount() === 0) return no('verschlüsselt/leer');
    const base = u8(sn.base);
    // vorbereiten wie pdf-lib beim normalen Speichern
    const form = doc.formCache && doc.formCache.getValue && doc.formCache.getValue();
    if (form) form.updateFieldAppearances();
    await doc.flush();
    // wo steht die bisherige Querverweistabelle?
    const tailTxt = new TextDecoder('latin1').decode(base.subarray(Math.max(0, base.length - 4096)));
    const sx = tailTxt.lastIndexOf('startxref');
    if (sx < 0) return no('kein startxref');
    const prev = parseInt(tailTxt.slice(sx + 9).trim(), 10);
    if (!(prev > 0 && prev < base.length)) return no('startxref ' + prev);
    const head = new TextDecoder('latin1').decode(base.subarray(prev, prev + 32)).trimStart();
    const asStream = !head.startsWith('xref');
    if (asStream && !/^\d+\s+\d+\s+obj/.test(head)) return no('xref? ' + head);
    // geänderte und neue Bausteine sammeln
    const changed = [];
    for (const [ref, o] of ctx.enumerateIndirectObjects()) if (incChanged(sn.m.get(ref.tag), o)) changed.push([ref, o]);
    changed.sort((a, b) => a[0].objectNumber - b[0].objectNumber);
    const enc = new TextEncoder();
    const parts = [];
    let off = base.length;
    const push = (b) => { parts.push(b); off += b.length; };
    if (base[base.length - 1] !== 10 && base[base.length - 1] !== 13) push(enc.encode('\n'));
    const entries = [];
    for (const [ref, o] of changed) {
      entries.push({ n: ref.objectNumber, g: ref.generationNumber, off });
      push(enc.encode(`${ref.objectNumber} ${ref.generationNumber} obj\n`));
      push(pdfSer(o));
      push(enc.encode('\nendobj\n'));
    }
    let size = Math.max(ctx.largestObjectNumber + 1, ...entries.map((e) => e.n + 1));
    const tdict = ctx.obj({});
    tdict.set(PDFName.of('Root'), tr.Root);
    if (tr.Info) tdict.set(PDFName.of('Info'), tr.Info);
    if (tr.ID) tdict.set(PDFName.of('ID'), tr.ID);
    tdict.set(PDFName.of('Prev'), PDFNumber.of(prev));
    const runs = (list) => { const r = []; for (const e of list) { const l = r[r.length - 1]; if (l && l.start + l.items.length === e.n) l.items.push(e); else r.push({ start: e.n, items: [e] }); } return r; };
    const xoff = off;
    if (!asStream) {
      let x = 'xref\n';
      for (const r of runs(entries)) { x += `${r.start} ${r.items.length}\n`; for (const e of r.items) x += `${String(e.off).padStart(10, '0')} ${String(e.g).padStart(5, '0')} n\r\n`; }
      tdict.set(PDFName.of('Size'), PDFNumber.of(size));
      push(enc.encode(x + 'trailer\n'));
      push(pdfSer(tdict));
      push(enc.encode(`\nstartxref\n${xoff}\n%%EOF\n`));
    } else {
      const xn = size++;
      const all = [...entries, { n: xn, g: 0, off: xoff }];
      const data = new Uint8Array(all.length * 7);
      all.forEach((e, k) => { const p = k * 7; data[p] = 1; data[p + 1] = (e.off >>> 24) & 255; data[p + 2] = (e.off >>> 16) & 255; data[p + 3] = (e.off >>> 8) & 255; data[p + 4] = e.off & 255; data[p + 5] = (e.g >> 8) & 255; data[p + 6] = e.g & 255; });
      tdict.set(PDFName.of('Type'), PDFName.of('XRef'));
      tdict.set(PDFName.of('Size'), PDFNumber.of(size));
      tdict.set(PDFName.of('W'), ctx.obj([1, 4, 2]));
      tdict.set(PDFName.of('Index'), ctx.obj(runs(all).flatMap((r) => [r.start, r.items.length])));
      tdict.set(PDFName.of('Length'), PDFNumber.of(data.length));
      push(enc.encode(`${xn} 0 obj\n`));
      push(pdfSer(tdict));
      push(enc.encode('\nstream\n'));
      push(data);
      push(enc.encode(`\nendstream\nendobj\nstartxref\n${xoff}\n%%EOF\n`));
    }
    const full = new Uint8Array(off);
    full.set(base, 0);
    let p = base.length;
    for (const b of parts) { full.set(b, p); p += b.length; }
    // Probe: liest pdf.js die neue Fassung mit derselben Seitenzahl?
    try {
      const t = await pdfjsLib.getDocument({ data: full.slice(), isEvalSupported: false }).promise;
      const ok = t.numPages === doc.getPageCount() && !!(await t.getPage(t.numPages));
      t.destroy();
      if (!ok) return no('Seitenzahl');
    } catch (e) { return no('pdf.js: ' + e.message); }
    INC.out.set(full, { baseLen: base.length, objs: changed.length });
    return full;
  }
  // statt doc.save(): angehängt speichern, wenn möglich – sonst wie bisher die ganze Datei
  async function pdfSave(doc, opts) {
    const sn = INC.snap.get(doc);
    if (sn && !ls('noIncr')) {
      try { const r = await incSave(doc, sn); if (r) return r; } catch (e) { console.warn('Anhängen nicht möglich, speichere vollständig:', e); }
    }
    return doc.save(opts);
  }
  // Infos für das Hochladen: nur den Anhang schicken, wenn er auf die Fassung des Servers passt
  // nicht mehr erreichbare Bausteine aus der PDF entfernen (z. B. nach dem Schwärzen)
  function pdfGc(doc) {
    const { PDFRef, PDFDict, PDFArray, PDFStream } = PDFLib;
    const ctx = doc.context, seen = new Set(), todo = [];
    const visit = (o) => {
      if (!o) return;
      if (o instanceof PDFRef) { if (!seen.has(o.tag)) { seen.add(o.tag); todo.push(ctx.lookup(o)); } return; }
      if (o instanceof PDFStream) { visit(o.dict); return; }
      if (o instanceof PDFDict) { for (const [, v] of o.entries()) visit(v); return; }
      if (o instanceof PDFArray) { for (let k = 0; k < o.size(); k++) visit(o.get(k)); }
    };
    const tr = ctx.trailerInfo;
    [tr.Root, tr.Info, tr.ID].forEach(visit);
    while (todo.length) visit(todo.pop());
    for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.tag)) ctx.delete(ref);
  }
  // ist a der Anfang von b (und kürzer)?
  function isPrefix(a, b) {
    const x = u8(a), y = u8(b);
    if (!x.length || x.length >= y.length) return false;
    for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return false;
    return true;
  }
  async function incInfo(bytes, baseBuf) {
    const inc = INC.out.get(bytes);
    if (!inc || !baseBuf || u8(baseBuf).length !== inc.baseLen) return null;
    const fp = await pdfFp(baseBuf);
    return fp ? { len: inc.baseLen, fp } : null;
  }

  async function pageOp(op) {
    if (!V.path || !V.pages.length) return;
    if (navigator.onLine === false) { toast('Seiten bearbeiten geht nur mit Internetverbindung.'); return; }
    const path = V.path;
    const n = V.pages.length;
    const i = op.i;
    if (op.kind === 'delete') {
      if (n < 2) { toast('Die letzte Seite kann nicht gelöscht werden.'); return; }
      const cnt = pageStrokes(i).length;
      if (!(await confirmDlg(`Seite ${i + 1} löschen?`, (cnt ? `${cnt} Notizen auf dieser Seite werden mit gelöscht. ` : '') + 'Die vorherige Fassung der PDF bleibt auf dem Server gesichert.', 'Löschen'))) return;
    }
    if (op.kind === 'move') { op.j = i + op.dir; if (op.j < 0 || op.j >= n) return; }
    if (editor) commitEditor(false);
    clearSel();
    await flush();
    const pnd = Notes.pending.get(path);
    if (pnd && (pnd.add.size || pnd.del.size)) { toast('Die Notizen werden noch gespeichert – bitte gleich noch einmal versuchen.'); return; }
    toast(pdfCache.get(path) && !pdfCache.get(path).bytes ? 'PDF wird vollständig geladen …' : 'Seiten werden geändert …', 120000);
    try {
      const { PDFDocument, degrees, rgb } = PDFLib;
      const entry = pdfCache.get(path);
      const doc = await PDFDocument.load(await pdfBytes(entry), { ignoreEncryption: true });
      let map = [...Array(n).keys()];
      const rot = {};
      let out = doc;
      let target = i;
      if (op.kind === 'insert') {
        const src = doc.getPage(i);
        const { width, height } = src.getSize();
        const ra = (((src.getRotation().angle || 0) % 360) + 360) % 360;
        let [W, H] = ra % 180 ? [height, width] : [width, height];
        let photo = null;
        if (op.style === 'photo') {
          photo = /png/.test(op.mime || '') ? await doc.embedPng(op.image) : await doc.embedJpg(op.image);
          H = Math.round(W * (photo.height / photo.width)); // Seite so hoch wie das Foto (bei gleicher Breite)
        }
        const pg = doc.insertPage(i + 1, [W, H]);
        if (photo) pg.drawImage(photo, { x: 0, y: 0, width: W, height: H });
        const line = (x1, y1, x2, y2, c, t) => pg.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: t, color: c });
        if (op.style === 'grid') {
          const st = 14.173, c = rgb(0.8, 0.84, 0.9); // 5-mm-Karos
          for (let x = st; x < W; x += st) line(x, 0, x, H, c, 0.4);
          for (let y = st; y < H; y += st) line(0, y, W, y, c, 0.4);
        }
        if (op.style === 'lines') {
          const st = 22.68, c = rgb(0.74, 0.79, 0.88); // 8-mm-Linien
          for (let y = H - 70; y > 40; y -= st) line(40, y, W - 40, y, c, 0.5);
        }
        map = map.map((k) => (k <= i ? k : k + 1));
        target = i + 1;
      } else if (op.kind === 'rotate') {
        const pg = doc.getPage(i);
        pg.setRotation(degrees(((pg.getRotation().angle || 0) + 90) % 360));
        rot[i] = { w: V.pages[i].w, h: V.pages[i].h };
      } else if (op.kind === 'delete') {
        doc.removePage(i);
        map = map.map((k) => (k === i ? -1 : k > i ? k - 1 : k));
        target = Math.min(i, n - 2);
      } else if (op.kind === 'order') {
        // beliebige neue Reihenfolge (fehlende Seiten = gelöscht), op.turn: Seiten um 90° drehen
        // in derselben Datei umhängen statt kopieren: schnell, Lesezeichen, Links und Formulare bleiben erhalten
        const all = doc.getPages();
        for (let k = n - 1; k >= 0; k--) doc.removePage(k);
        op.order.forEach((k, j) => doc.insertPage(j, all[k]));
        for (const k of op.turn || []) {
          const ni = op.order.indexOf(k);
          if (ni < 0) continue;
          const pg = out.getPage(ni);
          pg.setRotation(degrees(((pg.getRotation().angle || 0) + 90) % 360));
          rot[ni] = { w: V.pages[k].w, h: V.pages[k].h };
        }
        map = map.map((k) => op.order.indexOf(k));
        target = op.target ?? 0;
      } else if (op.kind === 'move') {
        const order = map.slice();
        order.splice(op.j, 0, order.splice(i, 1)[0]);
        const all = doc.getPages();
        for (let k = n - 1; k >= 0; k--) doc.removePage(k);
        order.forEach((k, j) => doc.insertPage(j, all[k]));
        map = map.map((k) => order.indexOf(k));
        target = op.j;
      }
      const bytes = await pdfSave(out);
      await commitPdf(path, bytes, map, rot, target);
      toast(op.msg || { insert: op.style === 'photo' ? 'Foto als neue Seite eingefügt.' : 'Seite eingefügt.', rotate: 'Seite gedreht.', delete: 'Seite gelöscht.', move: 'Seite verschoben.' }[op.kind]);
    } catch (err) {
      toast('Seiten ändern fehlgeschlagen: ' + err.message, 6000);
    }
  }
  // Geänderte PDF auf dem Server speichern (alte Fassung wird dort gesichert), Notizen ziehen mit, dann neu anzeigen
  // ---- Geänderte PDF übernehmen: sofort auf dem Gerät, Hochladen zum Server im Hintergrund
  // UPQ: path -> [{ map, rot, bytes? }] – höchstens ein laufender und ein wartender Eintrag je PDF
  const UPQ = new Map();
  const UP = { busy: false, pct: 0, retryT: 0, delay: 3000 };
  const upPending = (path) => UPQ.has(path) && UPQ.get(path).length > 0;
  function upPersist() {
    const o = {};
    for (const [p, l] of UPQ) if (l.length) o[p] = l.map((e) => ({ map: e.map, rot: e.rot, base: e.full ? null : e.base || null, cut: e.full ? null : e.cut ?? null }));
    DB.put('kv', 'upq', o).catch(() => {});
  }
  async function upRestore() {
    const o = (await DB.get('kv', 'upq')) || {};
    for (const [p, l] of Object.entries(o)) {
      if (!l || !l.length) continue;
      // nach einem Neustart: alles zu einem Eintrag zusammengefasst, die Datei liegt auf dem Gerät
      let m = l[0].map, r = l[0].rot || {};
      for (const e of l.slice(1)) { m = m.map((k) => (k < 0 ? -1 : e.map[k] ?? -1)); r = Object.keys(e.rot || {}).length ? null : r; }
      UPQ.set(p, [{ map: m, rot: r || l[l.length - 1].rot || {}, base: l.length === 1 || l.every((e) => e.base && e.cut == null) ? l[0].base : null, cut: l.length === 1 ? l[0].cut ?? null : null }]);
    }
    if (UPQ.size) upRun();
  }
  // Seitennummern (und bei Drehung die Koordinaten) der Notizen auf dem Gerät nachziehen – wie remap_notes auf dem Server
  function remapLocal(path, map, rot) {
    const d = Notes.docs.get(path);
    if (!d) return;
    const rp = (x, y, h) => [Math.round((h - y) * 100) / 100, Math.round(x * 100) / 100];
    for (const [id, st] of [...d.strokes]) {
      const np = map[st.p] ?? st.p;
      if (np < 0) { d.strokes.delete(id); continue; }
      const s2 = { ...st, p: np };
      const R = rot && rot[np];
      if (R) {
        const p = s2.pts.slice(), h = R.h;
        if (s2.t === 'tx') { for (let k = 0; k + 3 < p.length; k += 4) { const [x, y, w, hh] = [p[k], p[k + 1], p[k + 2], p[k + 3]]; [p[k], p[k + 1], p[k + 2], p[k + 3]] = [Math.round((h - y - hh) * 100) / 100, x, hh, w]; } } else if (s2.t === 'ob' && s2.e) { const e = { ...s2.e }; const ncx = h - (e.y + e.h / 2), ncy = e.x + e.w / 2; e.x = Math.round((ncx - e.w / 2) * 10) / 10; e.y = Math.round((ncy - e.h / 2) * 10) / 10; e.r = ((e.r || 0) + 90) % 360; s2.e = e; p[0] = e.x; p[1] = e.y; } else if (s2.t === 'txt' || s2.t === 'img') { [p[0], p[1]] = [Math.round((h - p[1] - (s2.bh || 0)) * 100) / 100, p[0]]; } else if (s2.t === 'sh') { [p[0], p[1]] = rp(p[0], p[1], h); [p[2], p[3]] = rp(p[2], p[3], h); } else { for (let k = 0; k + 1 < p.length; k += 3) [p[k], p[k + 1]] = rp(p[k], p[k + 1], h); }
        s2.pts = p;
      }
      d.strokes.set(id, s2);
      const pq = Notes.pending.get(path);
      if (pq && pq.add.has(id)) pq.add.set(id, s2);
    }
    const pq = Notes.pending.get(path);
    if (pq) for (const [id, st] of [...pq.add]) if (!d.strokes.has(id)) { pq.add.delete(id); if ((map[st.p] ?? 0) < 0) pq.del.delete(id); }
    saveLocal(path);
    persistQueue(path);
  }
  async function commitPdf(path, bytes, map, rot, target, opts = {}) {
    rot = rot || {};
    const prevEn = pdfCache.get(path);
    const prevBuf = opts.noHist || !prevEn ? null : prevEn.bytes || (await pdfBytes(prevEn));
    const notesBefore = opts.noHist ? null : new Map((Notes.docs.get(path) || { strokes: new Map() }).strokes);
    const q = UPQ.get(path) || [];
    // Drehungen lassen sich nicht mit einer wartenden Änderung zusammenfassen: dann erst die laufende abwarten
    if (q.length && (Object.keys(rot).length || q.some((e) => Object.keys(e.rot || {}).length))) {
      toast('Vorherige Änderung wird noch hochgeladen …', 60000);
      while (upPending(path)) await new Promise((r) => setTimeout(r, 400));
    }
    // nur angehängt? Dann reicht später das Hochladen des Anhangs
    let incBase = null, cut = null;
    if (prevEn) {
      const pb = prevBuf || prevEn.bytes || (await pdfBytes(prevEn));
      if (INC.out.has(bytes)) incBase = await incInfo(bytes, pb);
      else if (pb && isPrefix(bytes, pb)) {
        // z. B. „Rückgängig“ nach angehängtem Speichern: der Server muss nur den Anhang wieder abschneiden
        const fp = await pdfFp(pb);
        if (fp) { incBase = { len: u8(pb).length, fp }; cut = u8(bytes).length; }
      }
    }
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    // 1. sofort auf dem Gerät: neue Fassung anzeigen und ablegen
    const old = pdfCache.get(path);
    if (old) { old.pdf.destroy(); pdfCache.delete(path); }
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false }).promise;
    pdfCache.set(path, { pdf, bytes: buf, size: buf.byteLength, used: Date.now() });
    remapLocal(path, map, rot);
    if (!opts.noHist && prevBuf) {
      // für „Rückgängig“: vollständiger Stand vorher und nachher (PDF und Notizen)
      const h = history.get(path) || { undo: [], redo: [] };
      history.set(path, h);
      h.undo.push({ t: 'pdf', before: prevBuf, after: buf, bn: notesBefore, an: new Map(Notes.docs.get(path).strokes), target });
      h.redo.length = 0;
      // Speicher begrenzen: höchstens ~250 MB an PDF-Fassungen im Verlauf
      let total = 0;
      for (let k = h.undo.length - 1; k >= 0; k--) {
        if (h.undo[k].t !== 'pdf') continue;
        total += h.undo[k].before.byteLength;
        if (total > 250 * 1048576) { h.undo.splice(0, k + 1); break; }
      }
    }
    const meta = fileMeta(path);
    // Datensatz auf dem Gerät gilt bis zum Hochladen als „aktuell“ (gleicher Stand wie die Bibliothek)
    try { await DB.put('pdfs', path, { bytes: buf, mtime: meta ? meta.mtime : 0, size: meta ? meta.size : buf.byteLength, savedAt: Date.now(), local: true }); S.offline.add(path); } catch (er) { /* Speicher voll – Hochladen klappt trotzdem */ }
    // 2. Hochladen einreihen (wartende Änderung mit der neuen zusammenfassen)
    const l = UPQ.get(path) || [];
    const last = l[l.length - 1];
    if (last && !last.inflight) { last.map = last.map.map((k) => (k < 0 ? -1 : map[k] ?? -1)); last.rot = rot; if (!incBase || cut != null || last.cut != null) { last.base = null; last.cut = null; } }
    else l.push({ map, rot, base: incBase, cut });
    UPQ.set(path, l);
    upPersist();
    upRun();
    if (V.path === path) {
      const z = V.zoom;
      V.path = null;
      await showDoc(path, true);
      if (V.zoom !== z) { V.zoom = z; layout(); }
      if (target != null) goToPage(target);
      V.dirty = true;
    }
    return { local: true };
  }
  async function upRun() {
    if (UP.busy) return;
    UP.busy = true;
    try {
      for (;;) {
        const path = [...UPQ.keys()].find((p) => upPending(p));
        if (!path) break;
        if (navigator.onLine === false) break;
        const e = UPQ.get(path)[0];
        e.inflight = true;
        // die neueste Fassung auf dem Gerät hochladen, solange nichts weiteres wartet – sonst die zum Eintrag gehörende
        const en = pdfCache.get(path);
        const rec = UPQ.get(path).length === 1 ? (en && en.bytes ? { bytes: en.bytes } : await DB.get('pdfs', path)) : null;
        const bytes = e.bytes || (rec && rec.bytes);
        if (!bytes) { UPQ.get(path).shift(); upPersist(); continue; }
        if (UPQ.get(path).length > 1) e.bytes = bytes;
        const fd = new FormData();
        fd.append('path', path);
        fd.append('map', JSON.stringify(e.map));
        fd.append('rot', JSON.stringify(e.rot || {}));
        const tail = e.base && !e.full && (e.cut != null ? u8(bytes).length === e.cut : u8(bytes).length >= e.base.len);
        if (tail && e.cut != null) {
          fd.append('baseLen', String(e.base.len));
          fd.append('baseFp', e.base.fp);
          fd.append('cut', String(e.cut));
        } else if (tail) {
          fd.append('baseLen', String(e.base.len));
          fd.append('baseFp', e.base.fp);
          fd.append('tail', new Blob([u8(bytes).subarray(e.base.len)], { type: 'application/octet-stream' }), 'anhang.bin');
        } else fd.append('pdf', new Blob([bytes], { type: 'application/pdf' }), 'seiten.pdf');
        setSync('upload');
        let res;
        try {
          res = await new Promise((resolve, reject) => {
            const x = new XMLHttpRequest();
            x.open('POST', API + '?a=pageop');
            x.setRequestHeader('X-PDFStift', '1');
            x.upload.onprogress = (ev) => { if (ev.lengthComputable) { UP.pct = Math.round(ev.loaded / ev.total * 100); setSync('upload'); } };
            x.onload = () => {
              let j = {};
              try { j = JSON.parse(x.responseText); } catch (er) { /* */ }
              if (x.status === 200) resolve(j); else { const er = new Error(j.error || 'Fehler ' + x.status); er.status = x.status; reject(er); }
            };
            x.onerror = () => { const er = new Error('Keine Verbindung'); er.offline = true; reject(er); };
            x.send(fd);
          });
        } catch (err) {
          e.inflight = false;
          if (tail && err.status === 409) { e.full = true; continue; } // Server hat eine andere Fassung: ganze Datei schicken
          if (err.status === 413 || err.status === 404) {
            // geht so nie durch – nicht endlos wiederholen
            UPQ.get(path).shift(); upPersist();
            toast('Änderung konnte nicht auf dem Server gespeichert werden: ' + err.message, 9000);
            continue;
          }
          clearTimeout(UP.retryT);
          UP.retryT = setTimeout(upRun, UP.delay);
          UP.delay = Math.min(UP.delay * 2, 60000);
          setSync(navigator.onLine === false ? 'offline' : 'upload');
          break;
        }
        UP.delay = 3000;
        UPQ.get(path).shift();
        if (!UPQ.get(path).length) {
          UPQ.delete(path);
          // jetzt gilt der Stand des Servers
          const meta = fileMeta(path);
          if (meta) { meta.mtime = res.mtime; meta.size = res.size; meta.thumb = false; DB.put('kv', 'library', S.library).catch(() => {}); }
          const r2b = await DB.get('pdfs', path);
          if (r2b && r2b.bytes && r2b.bytes.byteLength === res.size) { try { await DB.put('pdfs', path, { ...r2b, mtime: res.mtime, size: res.size, local: false }); } catch (er) { /* */ } }
        }
        upPersist();
      }
    } finally {
      UP.busy = false;
      UP.pct = 0;
      scheduleFlush();
      if (![...UPQ.keys()].some(upPending)) setSync(pendingCount() ? 'saving' : navigator.onLine === false ? 'offline' : 'ok');
    }
  }
  window.addEventListener('online', () => { if (UPQ.size) upRun(); });

  // ================================================================== Werkzeug-Funktionen
  // ---- Hilfen
  const rotOf = (pg) => ((((pg.getRotation().angle || 0) % 360) + 360) % 360);
  // Punkt in der angezeigten Seite (Ursprung unten links, so wie man die Seite sieht) → PDF-Koordinaten + Textdrehung
  function dispToUser(pg, X, Y) {
    const mb = pg.getMediaBox();
    const r = rotOf(pg);
    if (r === 90) return { x: mb.x + mb.width - Y, y: mb.y + X, rot: 90 };
    if (r === 180) return { x: mb.x + mb.width - X, y: mb.y + mb.height - Y, rot: 180 };
    if (r === 270) return { x: mb.x + Y, y: mb.y + mb.height - X, rot: 270 };
    return { x: mb.x + X, y: mb.y + Y, rot: 0 };
  }
  function dispSize(pg) {
    const mb = pg.getMediaBox();
    return rotOf(pg) % 180 ? { W: mb.height, H: mb.width } : { W: mb.width, H: mb.height };
  }
  // Zeichen, die die Standardschriften nicht kennen, ersetzen (sonst bricht pdf-lib ab)
  function winAnsi(font, t) {
    let out = '';
    for (const ch of String(t)) {
      const c = ch.replace(/[‘’‚]/, "'").replace(/[“”„]/, '"').replace(/[–—]/, '-').replace(/ /, ' ');
      let ok = '?';
      for (const x of [ch, c]) { try { font.encodeText(x); ok = x; break; } catch (e) { /* nächste Möglichkeit */ } }
      out += ok;
    }
    return out;
  }
  const todayDe = () => new Date().toLocaleDateString(LOC);
  // Schrift für einen Text: Standardschrift, wenn sie alle Zeichen kennt – sonst DejaVu eingebettet (Griechisch, Formelzeichen …)
  const FONT_FILES = { Helvetica: 'DejaVuSans', HelveticaBold: 'DejaVuSans-Bold', HelveticaOblique: 'DejaVuSans', HelveticaBoldOblique: 'DejaVuSans-Bold', TimesRoman: 'DejaVuSerif', TimesRomanBold: 'DejaVuSerif-Bold', TimesRomanItalic: 'DejaVuSerif', TimesRomanBoldItalic: 'DejaVuSerif-Bold', Courier: 'DejaVuSansMono', CourierBold: 'DejaVuSansMono-Bold', CourierOblique: 'DejaVuSansMono', CourierBoldOblique: 'DejaVuSansMono-Bold' };
  const fontFiles = new Map();
  let fontkitP = null;
  async function pdfFont(doc, std, texts) {
    const { StandardFonts } = PDFLib;
    const f = await doc.embedFont(StandardFonts[std] || StandardFonts.Helvetica);
    let ok = true;
    for (const ch of new Set([...texts.join('')])) {
      if (ch === '\n' || ch === '\r') continue;
      try { f.encodeText(ch); } catch (e) { if (!/[\u2018\u2019\u201A\u201C\u201D\u201E\u2013\u2014\u00A0]/.test(ch)) { ok = false; break; } }
    }
    if (ok) return f;
    if (!window.fontkit) {
      fontkitP = fontkitP || new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'vendor/fontkit.min.js?v=' + VERSION; sc.onload = res; sc.onerror = () => rej(new Error('Schrift-Baustein fehlt')); document.head.appendChild(sc); });
      await fontkitP;
    }
    doc.registerFontkit(window.fontkit);
    const file = FONT_FILES[std] || 'DejaVuSans';
    if (!fontFiles.has(file)) fontFiles.set(file, fetch('vendor/fonts/' + file + '.ttf').then((r) => { if (!r.ok) throw new Error('Schrift ' + file + ' fehlt'); return r.arrayBuffer(); }));
    try { return await doc.embedFont(await fontFiles.get(file), { subset: true }); } catch (e) { fontFiles.delete(file); return f; }
  }
  // PDF mit allen Notizen (eingezeichnet) für eine beliebige Datei der Bibliothek
  async function annotatedBytesFor(path) {
    if (V.path === path && pdfCache.get(path)) {
      const snap = annotatedSnapshot();
      return snap.strokes.length ? buildAnnotated(snap) : new Uint8Array(await snap.bytes);
    }
    const bytes = await getPdfBytes(path);
    const doc = await localDoc(path);
    if (!doc.strokes.size) return new Uint8Array(bytes);
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)), isEvalSupported: false }).promise;
    const vps = [];
    for (let i = 1; i <= pdf.numPages; i++) vps.push({ vp: (await pdf.getPage(i)).getViewport({ scale: 1 }) });
    pdf.destroy();
    return buildAnnotated({ path, bytes, vps, strokes: [...doc.strokes.values()] });
  }
  // Neue PDF in die Bibliothek legen
  async function saveNewPdf(folder, name, bytes) {
    const fd = new FormData();
    fd.append('folder', folder);
    fd.append('filename', name);
    fd.append('files[]', new Blob([bytes], { type: 'application/pdf' }), name);
    const r = await fetch(API + '?a=upload', { method: 'POST', credentials: 'same-origin', headers: { 'X-PDFStift': '1' }, body: fd });
    const res = await r.json().catch(() => ({}));
    if (!r.ok || !(res.saved || []).length) throw new Error(res.error || (res.errors || []).join(' ') || 'Fehler ' + r.status);
    return res.saved[0];
  }
  const folderOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const stem = (p) => basename(p).replace(/\.pdf$/i, '');
  const needOnline = (what) => { if (navigator.onLine === false || S.libraryOffline) { toast(what + ' geht nur mit Internetverbindung.'); return false; } return true; };
  async function readyToEdit() {
    if (editor) commitEditor(false);
    clearSel();
    await flush();
    return true; // noch nicht gesendete Notizen werden beim Umsortieren mitgezogen (remapLocal)
  }
  // Seitenangaben wie „2-5, 9, 12-“ → Indizes
  function parsePages(str, n) {
    const out = [];
    for (const part of String(str).split(/[,;]+/)) {
      const m = /^\s*(\d+)?\s*(-)?\s*(\d+)?\s*$/.exec(part);
      if (!m || (!m[1] && !m[3])) continue;
      const a = m[1] ? +m[1] : 1, b = m[2] ? (m[3] ? +m[3] : n) : a;
      for (let k = Math.max(1, Math.min(a, b)); k <= Math.min(n, Math.max(a, b)); k++) if (!out.includes(k - 1)) out.push(k - 1);
    }
    return out;
  }

  // ---- Lesezeichen lesen/schreiben
  async function readOutline(pdf) {
    const ol = await pdf.getOutline();
    if (!ol) return [];
    const conv = async (items) => {
      const out = [];
      for (const it of items || []) {
        let page = -1;
        try {
          let d = it.dest;
          if (typeof d === 'string') d = await pdf.getDestination(d);
          if (Array.isArray(d) && d[0]) page = typeof d[0] === 'number' ? d[0] : await pdf.getPageIndex(d[0]);
        } catch (e) { /* kaputter Verweis */ }
        const children = await conv(it.items);
        if (page >= 0) out.push({ title: it.title || '', page, children });
        else out.push(...children);
      }
      return out;
    };
    return conv(ol);
  }
  function writeOutline(doc, items) {
    const { PDFName, PDFHexString, PDFNumber, PDFNull } = PDFLib;
    const ctx = doc.context;
    const pages = doc.getPages();
    if (!items.length) { doc.catalog.delete(PDFName.of('Outlines')); return; }
    const rootRef = ctx.nextRef();
    const build = (list, parentRef) => {
      const refs = list.map(() => ctx.nextRef());
      let count = 0;
      list.forEach((it, k) => {
        const pgRef = pages[Math.max(0, Math.min(pages.length - 1, it.page))].ref;
        const d = ctx.obj({});
        d.set(PDFName.of('Title'), PDFHexString.fromText(it.title || 'Ohne Titel'));
        d.set(PDFName.of('Parent'), parentRef);
        d.set(PDFName.of('Dest'), ctx.obj([pgRef, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull]));
        if (k > 0) d.set(PDFName.of('Prev'), refs[k - 1]);
        if (k < list.length - 1) d.set(PDFName.of('Next'), refs[k + 1]);
        count++;
        if (it.children && it.children.length) {
          const c = build(it.children, refs[k]);
          d.set(PDFName.of('First'), c.first); d.set(PDFName.of('Last'), c.last); d.set(PDFName.of('Count'), PDFNumber.of(c.count));
          count += c.count;
        }
        ctx.assign(refs[k], d);
      });
      return { first: refs[0], last: refs[refs.length - 1], count };
    };
    const c = build(items, rootRef);
    const root = ctx.obj({});
    root.set(PDFName.of('Type'), PDFName.of('Outlines'));
    root.set(PDFName.of('First'), c.first); root.set(PDFName.of('Last'), c.last); root.set(PDFName.of('Count'), PDFNumber.of(c.count));
    ctx.assign(rootRef, root);
    doc.catalog.set(PDFName.of('Outlines'), rootRef);
  }

  // ---- Seitenübersicht: auswählen und per Ziehen umsortieren
  OV.sel = new Set();
  OV.selMode = false;
  function ovUpdateSel() {
    $('#ovSelBtn').textContent = OV.selMode ? 'Fertig' : 'Auswählen';
    $('#ovSelActs').hidden = !OV.selMode;
    $('#ovSelN').textContent = OV.sel.size ? `${OV.sel.size} ausgewählt` : 'Seiten antippen';
    document.querySelectorAll('#ovGrid .ov-item').forEach((el) => el.classList.toggle('picked', OV.sel.has(+el.dataset.i)));
    $('#overview').classList.toggle('selecting', OV.selMode);
  }
  $('#ovSelBtn').onclick = () => { OV.selMode = !OV.selMode; OV.sel.clear(); ovUpdateSel(); };
  document.querySelectorAll('[data-ov]').forEach((b) => {
    b.onclick = async () => {
      const k = b.dataset.ov;
      const n = V.pages.length;
      if (k === 'all') { if (OV.sel.size === n) OV.sel.clear(); else V.pages.forEach((P) => OV.sel.add(P.i)); ovUpdateSel(); return; }
      if (!OV.sel.size) { toast('Bitte zuerst Seiten antippen.'); return; }
      const sel = [...OV.sel].sort((a, c) => a - c);
      if (k === 'ext') { closeOverview(); extractPages(sel); return; }
      if (!needOnline('Seiten bearbeiten')) return;
      if (k === 'del') {
        if (sel.length >= n) { toast('Mindestens eine Seite muss bleiben.'); return; }
        if (!(await confirmDlg(`${sel.length} ${sel.length === 1 ? 'Seite' : 'Seiten'} löschen?`, 'Notizen auf diesen Seiten werden mit gelöscht. Die vorherige Fassung der PDF bleibt auf dem Server gesichert.', 'Löschen'))) return;
      }
      const order = [...Array(n).keys()].filter((i) => k !== 'del' || !OV.sel.has(i));
      closeOverview();
      if (!(await readyToEdit())) return;
      await pageOp({ kind: 'order', order, turn: k === 'rot' ? sel : [], target: k === 'rot' ? sel[0] : Math.min(sel[0], order.length - 1), msg: k === 'rot' ? `${sel.length} ${sel.length === 1 ? 'Seite' : 'Seiten'} gedreht.` : `${sel.length} ${sel.length === 1 ? 'Seite' : 'Seiten'} gelöscht.` });
      OV.sel.clear(); OV.selMode = false;
    };
  });
  // Ziehen: Stift/Maus sofort, Finger nach kurzem Halten
  const OVD = { down: null, drag: null, timer: 0 };
  $('#ovGrid').addEventListener('pointerdown', (e) => {
    const item = e.target.closest('.ov-item');
    if (!item || e.target.closest('.ov-more') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    OVD.down = { id: e.pointerId, x: e.clientX, y: e.clientY, item, type: e.pointerType, armed: e.pointerType !== 'touch' };
    clearTimeout(OVD.timer);
    if (e.pointerType === 'touch') OVD.timer = setTimeout(() => { if (OVD.down) { OVD.down.armed = true; item.classList.add('lift'); if (navigator.vibrate) navigator.vibrate(15); } }, 380);
  });
  function ovDragStart(e) {
    const item = OVD.down.item;
    const r = item.getBoundingClientRect();
    const ghost = item.cloneNode(true);
    ghost.className = 'ov-item ov-ghost';
    ghost.style.width = r.width + 'px';
    document.body.appendChild(ghost);
    OVD.drag = { from: +item.dataset.i, ghost, dx: e.clientX - r.left, dy: e.clientY - r.top, to: null };
    item.classList.add('dragging');
    try { $('#ovGrid').setPointerCapture(e.pointerId); } catch (er) { /* */ }
  }
  $('#ovGrid').addEventListener('pointermove', (e) => {
    if (!OVD.down || e.pointerId !== OVD.down.id) return;
    const moved = Math.hypot(e.clientX - OVD.down.x, e.clientY - OVD.down.y);
    if (!OVD.drag) {
      if (!OVD.down.armed) { if (moved > 10) { clearTimeout(OVD.timer); OVD.down = null; } return; } // Finger wischt: scrollen
      if (moved < 8) return;
      if (OV.filter !== 'all') { toast('Zum Umsortieren „Alle Seiten“ wählen.'); OVD.down = null; return; }
      ovDragStart(e);
    }
    e.preventDefault();
    const g = OVD.drag;
    g.ghost.style.left = e.clientX - g.dx + 'px';
    g.ghost.style.top = e.clientY - g.dy + 'px';
    // Ziel: nächstes Vorschaubild, davor oder dahinter
    let best = null, bd = Infinity;
    document.querySelectorAll('#ovGrid .ov-item:not(.dragging)').forEach((el) => {
      const r = el.getBoundingClientRect();
      const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      if (d < bd) { bd = d; best = { el, after: e.clientX > r.left + r.width / 2 }; }
    });
    document.querySelectorAll('#ovGrid .drop-before, #ovGrid .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
    if (best) { best.el.classList.add(best.after ? 'drop-after' : 'drop-before'); g.to = +best.el.dataset.i + (best.after ? 1 : 0); }
    // am Rand automatisch scrollen
    const gr = $('#ovGrid').getBoundingClientRect();
    if (e.clientY < gr.top + 60) $('#ovGrid').scrollTop -= 14; else if (e.clientY > gr.bottom - 60) $('#ovGrid').scrollTop += 14;
  }, { passive: false });
  // Finger: nach dem Halten nicht mehr scrollen
  $('#ovGrid').addEventListener('touchmove', (e) => { if (OVD.down && OVD.down.armed) e.preventDefault(); }, { passive: false });
  const ovEnd = async (e) => {
    clearTimeout(OVD.timer);
    if (!OVD.down || (e && e.pointerId !== OVD.down.id)) return;
    const d = OVD.drag;
    OVD.down.item.classList.remove('lift');
    OVD.down = null;
    if (!d) return;
    OVD.drag = null;
    d.ghost.remove();
    document.querySelectorAll('#ovGrid .dragging, #ovGrid .drop-before, #ovGrid .drop-after').forEach((el) => el.classList.remove('dragging', 'drop-before', 'drop-after'));
    OV.justDragged = Date.now();
    if (d.to == null || d.to === d.from || d.to === d.from + 1) return;
    if (!needOnline('Seiten umsortieren')) return;
    const order = [...Array(V.pages.length).keys()];
    order.splice(d.from, 1);
    const at = d.to > d.from ? d.to - 1 : d.to;
    order.splice(at, 0, d.from);
    // sofort sichtbar umsortieren, gespeichert wird im Hintergrund
    const grid = $('#ovGrid');
    const items = [...grid.querySelectorAll('.ov-item')];
    const mv = items.find((el) => +el.dataset.i === d.from);
    const ref = items.find((el) => +el.dataset.i === d.to);
    if (mv) { grid.insertBefore(mv, ref || null); mv.classList.add('saving'); }
    grid.querySelectorAll('.ov-item .n').forEach((el, k) => { el.textContent = k + 1; });
    if (!(await readyToEdit())) return;
    const keep = $('#ovGrid').scrollTop;
    await pageOp({ kind: 'order', order, target: at, msg: `Seite ${d.from + 1} ist jetzt Seite ${at + 1}.` });
    openOverview(); $('#ovGrid').scrollTop = keep;
  };
  $('#ovGrid').addEventListener('pointerup', ovEnd);
  $('#ovGrid').addEventListener('pointercancel', ovEnd);
  // Antippen im Auswahlmodus wählt aus statt zu springen
  $('#ovGrid').addEventListener('click', (e) => {
    const item = e.target.closest('.ov-item');
    if (!item || e.target.closest('.ov-more')) return;
    if (OV.justDragged && Date.now() - OV.justDragged < 400) { e.stopPropagation(); e.preventDefault(); return; }
    if (!OV.selMode) return;
    e.stopPropagation(); e.preventDefault();
    const i = +item.dataset.i;
    if (OV.sel.has(i)) OV.sel.delete(i); else OV.sel.add(i);
    ovUpdateSel();
  }, true);
  const ovOpen0 = openOverview;
  openOverview = function () { ovOpen0(); ovUpdateSel(); };
  $('#overviewBtn').onclick = openOverview;

  // ---- Seiten herausziehen / aufteilen
  async function extractPages(preset) {
    track('tool', 'Seiten herausziehen/aufteilen');
    if (!V.path || !needOnline('Seiten herausziehen')) return;
    const n = V.pages.length;
    const path = V.path;
    let groups;
    if (preset && preset.length) groups = [preset];
    else {
      const ans = await askText('Seiten herausziehen oder aufteilen', `Welche Seiten (1–${n})? z. B. „2-5, 9“ für eine neue PDF – oder „alle 10“ zum Aufteilen in Teile zu je 10 Seiten – oder „3, 8 |“ zum Teilen nach Seite 3 und 8.`, '', 'Weiter');
      if (!ans) return;
      const every = /^\s*(?:alle|every)\s+(\d+)\s*$/i.exec(ans);
      if (every) {
        const k = Math.max(1, +every[1]);
        groups = [];
        for (let a = 0; a < n; a += k) groups.push([...Array(Math.min(k, n - a)).keys()].map((j) => a + j));
      } else if (/\|\s*$/.test(ans)) {
        const cuts = parsePages(ans.replace(/\|/g, ''), n).sort((a, c) => a - c);
        groups = [];
        let a = 0;
        for (const c of cuts) { if (c + 1 > a && c + 1 < n) { groups.push([...Array(c + 1 - a).keys()].map((j) => a + j)); a = c + 1; } }
        groups.push([...Array(n - a).keys()].map((j) => a + j));
      } else groups = [parsePages(ans, n)];
      groups = groups.filter((g) => g.length);
      if (!groups.length) { toast('Keine gültigen Seitenzahlen erkannt.'); return; }
    }
    const one = groups.length === 1;
    const base = stem(path);
    const label = (g) => (g.length === 1 ? `S. ${g[0] + 1}` : `S. ${g[0] + 1}-${g[g.length - 1] + 1}`);
    let name = one ? `${base} (${label(groups[0])})` : base;
    name = await askText(one ? 'Name der neuen PDF' : `${groups.length} neue PDFs`, one ? 'Sie kommt in denselben Ordner. Die Original-PDF bleibt unverändert.' : 'Die Teile heißen „Name (Teil 1)“, „Name (Teil 2)“ … und kommen in denselben Ordner. Die Original-PDF bleibt unverändert.', name, 'Erstellen');
    if (!name) return;
    if (!(await readyToEdit())) return;
    toast('Neue PDF wird erstellt …', 60000);
    try {
      const { PDFDocument } = PDFLib;
      const src = await PDFDocument.load(await annotatedBytesFor(path), { ignoreEncryption: true });
      let last = '';
      for (let k = 0; k < groups.length; k++) {
        const out = await PDFDocument.create();
        (await out.copyPages(src, groups[k])).forEach((pg) => out.addPage(pg));
        last = await saveNewPdf(folderOf(path), (one ? name : `${name} (Teil ${k + 1})`) + '.pdf', await out.save());
      }
      await loadLibrary();
      toast(one ? `„${basename(last)}“ erstellt.` : `${groups.length} PDFs erstellt.`, 4000);
      if (one && (await confirmDlg('Neue PDF öffnen?', basename(last), 'Öffnen'))) openDoc(last);
    } catch (err) { toast('Erstellen fehlgeschlagen: ' + err.message, 6000); }
  }

  // Auswahl-Eintrag → PDF-Bytes: Datei der Bibliothek, oder vom Gerät (PDF, Bild, Office über den Server)
  async function entryBytes(e) {
    if (typeof e === 'string') return annotatedBytesFor(e);
    const f = e.file;
    if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) return new Uint8Array(await f.arrayBuffer());
    if (/^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|heic)$/i.test(f.name)) return imagesToPdf([f]);
    const fd = new FormData();
    fd.append('file', f, f.name);
    const r = await fetch(API + '?a=convert', { method: 'POST', credentials: 'same-origin', headers: { 'X-PDFStift': '1' }, body: fd });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(f.name + ': ' + (j.error || 'Umwandeln fehlgeschlagen')); }
    return new Uint8Array(await r.arrayBuffer());
  }
  // ---- PDFs auswählen (Zusammenfügen, Einfügen)
  function pickPdfs({ title, text, go, withName, exclude }) {
    return new Promise((res) => {
      const d = $('#pickDlg');
      const sel = [];
      $('#pickTitle').textContent = title;
      $('#pickText').textContent = text;
      $('#pickGo').textContent = go;
      $('#pickNameRow').hidden = !withName;
      $('#pickName').value = '';
      $('#pickSearch').value = '';
      $('#pickMsg').textContent = '';
      const files = (S.library ? S.library.files : []).filter((f) => f.path !== exclude);
      const draw = () => {
        const q = $('#pickSearch').value.trim().toLowerCase();
        const list = $('#pickList');
        list.innerHTML = '';
        files.filter((f) => !q || f.path.toLowerCase().includes(q)).slice(0, 300).forEach((f) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'pick-item' + (sel.includes(f.path) ? ' on' : '');
          b.innerHTML = `<span class="pn"></span><span class="pf muted small"></span>`;
          b.querySelector('.pn').textContent = stem(f.path);
          b.querySelector('.pf').textContent = (f.folder || 'Meine PDFs') + ' · ' + fmtSize(f.size);
          b.onclick = () => { const j = sel.indexOf(f.path); if (j >= 0) sel.splice(j, 1); else sel.push(f.path); draw(); };
          list.appendChild(b);
        });
        const ol = $('#pickSel');
        ol.innerHTML = sel.length ? '' : '<li class="muted">Noch nichts ausgewählt.</li>';
        sel.forEach((p, k) => {
          const li = document.createElement('li');
          li.innerHTML = `<span class="pn"></span><button type="button" class="icon-btn" data-m="-1" aria-label="nach oben">↑</button><button type="button" class="icon-btn" data-m="1" aria-label="nach unten">↓</button><button type="button" class="icon-btn" data-m="x" aria-label="entfernen">✕</button>`;
          li.querySelector('.pn').textContent = `${k + 1}. ${typeof p === 'string' ? stem(p) : '📎 ' + p.file.name}`;
          li.onclick = (e) => {
            const m = e.target.dataset.m;
            if (!m) return;
            if (m === 'x') sel.splice(k, 1);
            else { const j = k + +m; if (j >= 0 && j < sel.length) [sel[k], sel[j]] = [sel[j], sel[k]]; }
            draw();
          };
          ol.appendChild(li);
        });
        if (withName && !$('#pickName').dataset.touched) $('#pickName').value = sel.length ? (typeof sel[0] === 'string' ? stem(sel[0]) : sel[0].file.name.replace(/\.[^.]+$/, '')) + ' (zusammengefügt)' : '';
      };
      $('#pickName').oninput = () => { $('#pickName').dataset.touched = '1'; };
      delete $('#pickName').dataset.touched;
      $('#pickSearch').oninput = draw;
      $('#pickFiles').value = '';
      $('#pickFiles').onchange = () => { for (const f of $('#pickFiles').files) sel.push({ file: f }); $('#pickFiles').value = ''; draw(); };
      draw();
      d.returnValue = '';
      d.addEventListener('close', () => res(d.returnValue === 'yes' && sel.length ? { files: sel.slice(), name: $('#pickName').value.trim() } : null), { once: true });
      d.showModal();
    });
  }
  async function mergePdfs() {
    track('tool', 'Zusammenfügen');
    if (!needOnline('Zusammenfügen')) return;
    const r = await pickPdfs({ title: 'PDFs zusammenfügen', text: 'Tippe die PDFs in der gewünschten Reihenfolge an. Die Originale bleiben unverändert; Notizen werden mit übernommen.', go: 'Zusammenfügen', withName: true });
    if (!r) return;
    if (r.files.length < 2) { toast('Bitte mindestens zwei PDFs auswählen.'); return; }
    toast('PDFs werden zusammengefügt …', 120000);
    try {
      const { PDFDocument } = PDFLib;
      const out = await PDFDocument.create();
      const ol = [];
      for (const p of r.files) {
        const src = await PDFDocument.load(await entryBytes(p), { ignoreEncryption: true });
        ol.push({ title: typeof p === 'string' ? stem(p) : p.file.name.replace(/\.[^.]+$/, ''), page: out.getPageCount(), children: [] });
        (await out.copyPages(src, src.getPageIndices())).forEach((pg) => out.addPage(pg));
      }
      writeOutline(out, ol); // ein Lesezeichen je Ausgangs-PDF
      const name = (r.name || stem(r.files[0]) + ' (zusammengefügt)').replace(/\.pdf$/i, '') + '.pdf';
      const saved = await saveNewPdf(S.folder || (typeof r.files[0] === 'string' ? folderOf(r.files[0]) : ''), name, await out.save());
      await loadLibrary();
      toast(`„${basename(saved)}“ erstellt (${out.getPageCount()} Seiten).`, 4000);
      openDoc(saved);
    } catch (err) { toast('Zusammenfügen fehlgeschlagen: ' + err.message, 6000); }
  }
  $('#btnMerge').onclick = mergePdfs;
  $('#ovIns').onclick = () => { closeOverview(); insertPdfHere(); };
  $('#ovSplit').onclick = () => { closeOverview(); extractPages(); };
  async function insertPdfHere() {
    if (!V.path || !needOnline('PDF einfügen')) return;
    const at = currentPageIndex();
    const r = await pickPdfs({ title: 'PDF einfügen', text: `Die gewählten PDFs kommen nach Seite ${at + 1} in diese PDF.`, go: 'Einfügen', withName: false, exclude: V.path });
    if (!r) return;
    if (!(await readyToEdit())) return;
    const path = V.path;
    toast('Wird eingefügt …', 120000);
    try {
      const { PDFDocument } = PDFLib;
      const doc = await PDFDocument.load(await pdfBytes(pdfCache.get(path)), { ignoreEncryption: true });
      const n = doc.getPageCount();
      let pos = at + 1, added = 0;
      for (const p of r.files) {
        const src = await PDFDocument.load(await entryBytes(p), { ignoreEncryption: true });
        for (const pg of await doc.copyPages(src, src.getPageIndices())) { doc.insertPage(pos++, pg); added++; }
      }
      const map = [...Array(n).keys()].map((k) => (k <= at ? k : k + added));
      await commitPdf(path, await pdfSave(doc), map, {}, at + 1);
      toast(`${added} ${added === 1 ? 'Seite' : 'Seiten'} eingefügt.`);
    } catch (err) { toast('Einfügen fehlgeschlagen: ' + err.message, 6000); }
  }

  // ---- Kopf-/Fußzeile, Seitenzahlen, Wasserzeichen
  async function stampDialog() {
    track('tool', 'Kopf-/Fußzeile & Wasserzeichen');
    if (!V.path || !needOnline('Kopf- und Fußzeilen')) return;
    $('#stMsg').textContent = '';
    $('#stFrom').max = V.pages.length;
    const d = $('#stampDlg');
    d.returnValue = '';
    d.showModal();
    const ok = await new Promise((r) => d.addEventListener('close', () => r(d.returnValue === 'yes'), { once: true }));
    if (!ok) return;
    const cfg = { head: $('#stHead').value.trim(), foot: $('#stFoot').value.trim(), num: $('#stNum').value, pos: $('#stNumPos').value, wm: $('#stWm').value.trim(), size: Math.max(6, Math.min(24, +$('#stSize').value || 9)), from: Math.max(1, +$('#stFrom').value || 1) };
    if (!cfg.head && !cfg.foot && !cfg.num && !cfg.wm) { toast('Es wurde nichts eingetragen.'); return; }
    if (!(await readyToEdit())) return;
    const path = V.path;
    toast('Wird eingefügt …', 60000);
    try {
      const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib;
      const doc = await PDFDocument.load(await pdfBytes(pdfCache.get(path)), { ignoreEncryption: true });
      const font = await pdfFont(doc, 'Helvetica', [cfg.head, cfg.foot, cfg.num, stem(path), todayDe()]);
      const bold = await pdfFont(doc, 'HelveticaBold', [cfg.wm, stem(path), todayDe()]);
      const N = doc.getPageCount();
      const fill = (t, n) => t.replace(/\{n\}/g, n).replace(/\{N\}/g, N).replace(/\{datum\}/gi, todayDe()).replace(/\{datei\}/gi, stem(path));
      doc.getPages().forEach((pg, i) => {
        if (i + 1 < cfg.from) return;
        const { W, H } = dispSize(pg);
        const m = Math.max(18, Math.min(W, H) * 0.045);
        const put = (text, X, Y, opt = {}) => {
          const f = opt.font || font, size = opt.size || cfg.size;
          const t = winAnsi(f, text);
          const w = f.widthOfTextAtSize(t, size);
          const x0 = opt.align === 'c' ? X - w / 2 : opt.align === 'r' ? X - w : X;
          const p = dispToUser(pg, x0, Y);
          pg.drawText(t, { x: p.x, y: p.y, size, font: f, color: opt.color || rgb(0.25, 0.27, 0.33), rotate: degrees(p.rot), opacity: opt.opacity ?? 1 });
        };
        if (cfg.head) put(fill(cfg.head, i + 1), W / 2, H - m, { align: 'c' });
        if (cfg.foot) put(fill(cfg.foot, i + 1), m, m * 0.7);
        if (cfg.num) {
          const t = fill(cfg.num, i + 1);
          if (cfg.pos === 'bc') put(t, W / 2, m * 0.7, { align: 'c' });
          else if (cfg.pos === 'tr') put(t, W - m, H - m, { align: 'r' });
          else put(t, W - m, m * 0.7, { align: 'r' });
        }
        if (cfg.wm) {
          const t = winAnsi(bold, fill(cfg.wm, i + 1));
          const ang = Math.atan2(H, W);
          let size = Math.min(W, H) / 5;
          const w0 = bold.widthOfTextAtSize(t, size);
          size = Math.min(size, size * (Math.hypot(W, H) * 0.75) / Math.max(1, w0));
          const w = bold.widthOfTextAtSize(t, size);
          const X = W / 2 - Math.cos(ang) * w / 2 + Math.sin(ang) * size * 0.35;
          const Y = H / 2 - Math.sin(ang) * w / 2 - Math.cos(ang) * size * 0.35;
          const p = dispToUser(pg, X, Y);
          pg.drawText(t, { x: p.x, y: p.y, size, font: bold, color: rgb(0.85, 0.15, 0.15), opacity: 0.16, rotate: degrees(p.rot + ang * 180 / Math.PI) });
        }
      });
      const n = doc.getPageCount();
      await commitPdf(path, await pdfSave(doc), [...Array(n).keys()], {}, currentPageIndex());
      toast('Eingefügt.');
    } catch (err) { toast('Einfügen fehlgeschlagen: ' + err.message, 6000); }
  }

  // ---- Lesezeichen-Fenster
  const OL = { items: [], dirty: false };
  async function outlineDialog() {
    track('tool', 'Lesezeichen');
    if (!V.path || !pdfCache.get(V.path)) return;
    OL.items = await readOutline(pdfCache.get(V.path).pdf).catch(() => []);
    OL.dirty = false;
    olDraw();
    $('#olDlg').showModal();
  }
  function olDraw() {
    const box = $('#olList');
    box.innerHTML = '';
    $('#olSave').hidden = !OL.dirty;
    $('#olMsg').textContent = OL.items.length ? '' : 'Diese PDF hat noch keine Lesezeichen.';
    const walk = (list, depth) => list.forEach((it, k) => {
      const row = document.createElement('div');
      row.className = 'ol-row';
      row.style.paddingLeft = 8 + depth * 18 + 'px';
      row.innerHTML = `<button type="button" class="ol-go"><span class="ol-t"></span><span class="ol-p muted small">S. ${it.page + 1}</span></button>
        <button type="button" class="icon-btn" data-o="ren" aria-label="Umbenennen">✎</button><button type="button" class="icon-btn" data-o="del" aria-label="Löschen">✕</button>`;
      row.querySelector('.ol-t').textContent = it.title;
      row.querySelector('.ol-go').onclick = () => { $('#olDlg').close(); goToPage(it.page); };
      row.querySelector('[data-o=ren]').onclick = async () => {
        $('#olDlg').close();
        const t = await askText('Lesezeichen umbenennen', '', it.title, 'Übernehmen');
        if (t) { it.title = t; OL.dirty = true; }
        olDraw(); $('#olDlg').showModal();
      };
      row.querySelector('[data-o=del]').onclick = () => { list.splice(k, 1, ...(it.children || [])); OL.dirty = true; olDraw(); };
      box.appendChild(row);
      walk(it.children || [], depth + 1);
    });
    walk(OL.items, 0);
  }
  $('#olAdd').onclick = async () => {
    const i = currentPageIndex();
    $('#olDlg').close();
    const t = await askText(`Lesezeichen für Seite ${i + 1}`, 'Name des Lesezeichens', `Seite ${i + 1}`, 'Hinzufügen');
    if (t) {
      let k = OL.items.findIndex((it) => it.page > i);
      if (k < 0) k = OL.items.length;
      OL.items.splice(k, 0, { title: t, page: i, children: [] });
      OL.dirty = true;
    }
    olDraw(); $('#olDlg').showModal();
  };
  $('#olSave').onclick = async () => {
    if (!needOnline('Lesezeichen speichern')) return;
    $('#olDlg').close();
    if (!(await readyToEdit())) return;
    const path = V.path;
    try {
      const { PDFDocument } = PDFLib;
      const doc = await PDFDocument.load(await pdfBytes(pdfCache.get(path)), { ignoreEncryption: true });
      writeOutline(doc, OL.items);
      const n = doc.getPageCount();
      await commitPdf(path, await pdfSave(doc), [...Array(n).keys()], {}, currentPageIndex());
      toast('Lesezeichen gespeichert.');
    } catch (err) { toast('Speichern fehlgeschlagen: ' + err.message, 6000); }
  };

  // ---- Bearbeiten direkt auf der Seite: Text ändern, Schwärzen
  const PE = { mode: null, rects: new Map(), lines: new Map(), box: null };
  function peStart(mode) {
    if (!V.path || V.board) return;
    track('tool', { text: 'Text bearbeiten', redact: 'Schwärzen', fbuild: 'Formular vorbereiten' }[mode] || mode);
    if (!needOnline(mode === 'text' ? 'Text bearbeiten' : 'Schwärzen')) return;
    peStop();
    PE.mode = mode;
    document.body.classList.add('pe-on', 'pe-' + mode);
    $('#peBar').hidden = false;
    $('#peApply').hidden = mode !== 'redact';
    peBarText();
    if (mode === 'redact') V.pages.forEach(peDrawRects);
  }
  function peBarText() {
    const n = [...PE.rects.values()].reduce((a, l) => a + l.length, 0);
    $('#peText').textContent = PE.mode === 'text'
      ? 'Text bearbeiten: Zeile antippen, ändern, mit ✓ übernehmen.'
      : n ? `${n} ${n === 1 ? 'Bereich' : 'Bereiche'} markiert – „Schwärzen anwenden“ entfernt alles darunter endgültig.` : 'Schwärzen: Bereiche mit Stift, Maus oder Finger aufziehen.';
    $('#peApply').disabled = !n;
  }
  function peStop() {
    if (PE.box) { PE.box.remove(); PE.box = null; }
    document.querySelectorAll('.pe-rect, .pe-edit').forEach((el) => el.remove());
    document.body.classList.remove('pe-on', 'pe-text', 'pe-redact');
    $('#peBar').hidden = true;
    PE.mode = null;
    PE.rects.clear();
    PE.lines.clear();
  }
  $('#peDone').onclick = peStop;
  // Zeilen einer Seite aus dem Textinhalt (nur waagerechte Schrift)
  async function peLines(P) {
    if (PE.lines.has(P.i)) return PE.lines.get(P.i);
    const tc = await (await pgOf(P)).getTextContent();
    const items = tc.items.filter((it) => it.str && it.str.trim() && Math.abs(it.transform[1]) < 0.01 && Math.abs(it.transform[2]) < 0.01 && it.transform[0] > 0);
    items.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
    const lines = [];
    for (const it of items) {
      const fs = Math.hypot(it.transform[0], it.transform[1]);
      const x = it.transform[4], y = it.transform[5], w = it.width;
      const L = lines.find((l) => Math.abs(l.y - y) < fs * 0.35 && Math.abs(l.fs - fs) < fs * 0.25 && x >= l.x2 - fs * 0.6 && x - l.x2 < fs * 1.6);
      const style = tc.styles[it.fontName] || {};
      if (L) { L.str += (x - L.x2 > fs * 0.15 && !/\s$/.test(L.str) && !/^\s/.test(it.str) ? ' ' : '') + it.str; L.x2 = Math.max(L.x2, x + w); L.items.push(it); }
      else lines.push({ x1: x, x2: x + w, y, fs, str: it.str, fontName: it.fontName, family: style.fontFamily || '', asc: style.ascent || 0.8, desc: style.descent || -0.2, items: [it] });
    }
    PE.lines.set(P.i, lines);
    return lines;
  }
  // Alten Text einer Zeile wirklich aus dem Seiteninhalt entfernen (nicht nur überdecken).
  // Liest den Inhaltsstrom, verfolgt Text- und Grafikmatrix und leert die Textbefehle, die in dieser Zeile beginnen.
  function stripLineText(doc, pageIndex, L, wholeY) {
    const { PDFName, PDFArray, PDFRawStream, decodePDFRawStream } = PDFLib;
    const pg = doc.getPage(pageIndex);
    const ctx = doc.context;
    const raw = pg.node.get(PDFName.of('Contents'));
    const refs = [];
    const look = ctx.lookup(raw);
    if (look instanceof PDFArray) for (let k = 0; k < look.size(); k++) refs.push(look.get(k)); else refs.push(raw);
    const parts = [];
    for (const r of refs) {
      const st = ctx.lookup(r);
      if (!st) continue;
      parts.push(st instanceof PDFRawStream ? decodePDFRawStream(st).decode() : st.getContents ? st.getContents() : new Uint8Array(0));
    }
    let total = parts.reduce((a, b) => a + b.length + 1, 0);
    const src = new Uint8Array(total);
    let o = 0;
    for (const b of parts) { src.set(b, o); o += b.length; src[o++] = 10; }
    const n = src.length;
    const isWs = (c) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
    const isDel = (c) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
    const mul = (A, B) => [A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3], A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3], A[4] * B[0] + A[5] * B[2] + B[4], A[4] * B[1] + A[5] * B[3] + B[5]];
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    let tm = [1, 0, 0, 1, 0, 0], tlm = tm, TL = 0, xKnown = true, lastHit = false;
    const ops = [];      // Ersetzungen [start, ende, text]
    let operands = [];
    const arrStack = [];
    let i = 0;
    const num = (t) => parseFloat(t.v);
    const hitAt = () => {
      const M = mul(tm, ctm);
      const x = M[4], y = M[5];
      if (Math.abs(M[1]) > 0.01 || Math.abs(M[2]) > 0.01) return false;
      const yOk = Math.abs(y - L.y) < L.fs * 0.4;
      if (!yOk) return false;
      if (xKnown) return x >= L.x1 - L.fs * 0.5 && x <= L.x2 - L.fs * 0.1;
      return wholeY || lastHit; // Position nach vorheriger Ausgabe unbekannt
    };
    const show = (strTok) => {
      const hit = hitAt();
      if (hit && strTok) ops.push([strTok.s, strTok.e, strTok.t === 'arr' ? '[]' : '()']);
      lastHit = hit;
      xKnown = false;
    };
    const td = (tx, ty) => { tlm = mul([1, 0, 0, 1, tx, ty], tlm); tm = tlm; xKnown = true; lastHit = false; };
    while (i < n) {
      const c = src[i];
      if (isWs(c)) { i++; continue; }
      if (c === 37) { while (i < n && src[i] !== 10 && src[i] !== 13) i++; continue; }
      let tok;
      const s0 = i;
      if (c === 40) { // (Zeichenkette)
        let depth = 0;
        for (; i < n; i++) {
          const d = src[i];
          if (d === 92) { i++; continue; }
          if (d === 40) depth++;
          else if (d === 41) { depth--; if (depth === 0) { i++; break; } }
        }
        tok = { t: 'str', s: s0, e: i };
      } else if (c === 60 && src[i + 1] === 60) { i += 2; tok = { t: 'dict<' }; }
      else if (c === 62 && src[i + 1] === 62) { i += 2; tok = { t: 'dict>' }; }
      else if (c === 60) { while (i < n && src[i] !== 62) i++; i++; tok = { t: 'str', s: s0, e: i }; }
      else if (c === 91) { i++; arrStack.push({ t: 'arr', s: s0, prev: operands }); operands = []; continue; }
      else if (c === 93) { i++; const a = arrStack.pop(); if (a) { a.e = i; a.items = operands; operands = a.prev; operands.push(a); } continue; }
      else if (c === 47) { i++; while (i < n && !isWs(src[i]) && !isDel(src[i])) i++; tok = { t: 'name' }; }
      else {
        while (i < n && !isWs(src[i]) && !isDel(src[i])) i++;
        if (i === s0) { i++; continue; }
        const v = String.fromCharCode(...src.subarray(s0, i));
        tok = /^[+\-.\d]/.test(v) ? { t: 'num', v } : { t: 'op', v };
      }
      if (tok.t !== 'op') { if (tok.t !== 'dict<' && tok.t !== 'dict>') operands.push(tok); continue; }
      if (arrStack.length) continue;
      const op = tok.v, A = operands;
      operands = [];
      if (op === 'BI') { // eingebettetes Bild überspringen
        while (i < n - 2 && !(isWs(src[i]) && src[i + 1] === 69 && src[i + 2] === 73 && (i + 3 >= n || isWs(src[i + 3]) || isDel(src[i + 3])))) i++;
        i += 3; continue;
      }
      if (op === 'q') stack.push(ctm);
      else if (op === 'Q') ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (op === 'cm' && A.length >= 6) ctm = mul(A.slice(-6).map(num), ctm);
      else if (op === 'BT') { tm = tlm = [1, 0, 0, 1, 0, 0]; xKnown = true; lastHit = false; }
      else if (op === 'Tm' && A.length >= 6) { tm = tlm = A.slice(-6).map(num); xKnown = true; lastHit = false; }
      else if (op === 'Td' && A.length >= 2) td(num(A[A.length - 2]), num(A[A.length - 1]));
      else if (op === 'TD' && A.length >= 2) { TL = -num(A[A.length - 1]); td(num(A[A.length - 2]), num(A[A.length - 1])); }
      else if (op === 'TL' && A.length) TL = num(A[A.length - 1]);
      else if (op === 'T*') td(0, -TL);
      else if (op === 'Tj') show(A[A.length - 1]);
      else if (op === 'TJ') show(A[A.length - 1]);
      else if (op === "'") { td(0, -TL); show(A[A.length - 1]); }
      else if (op === '"') { td(0, -TL); show(A[A.length - 1]); }
    }
    if (!ops.length) return 0;
    // Ersetzungen von hinten nach vorn einsetzen
    const chunks = [];
    let last = n;
    ops.sort((a, b) => b[0] - a[0]);
    for (const [a, b, t] of ops) { chunks.unshift(src.subarray(b, last)); chunks.unshift(new TextEncoder().encode(t)); last = a; }
    chunks.unshift(src.subarray(0, last));
    const outLen = chunks.reduce((x, c2) => x + c2.length, 0);
    const out = new Uint8Array(outLen);
    let p2 = 0;
    for (const c2 of chunks) { out.set(c2, p2); p2 += c2.length; }
    pg.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(out)));
    return ops.length;
  }
  // CSS-Pixel auf der Seite ↔ PDF-Koordinaten
  const peToUser = (P, cx, cy) => P.vp.convertToPdfPoint(cx * P.vp.width / P.cssW, cy * P.vp.height / P.cssH);
  function peToCss(P, rect) {
    const r = vpRect(P.vp, rect);
    const k = P.cssW / P.vp.width;
    return { l: Math.min(r[0], r[2]) * k, t: Math.min(r[1], r[3]) * k, w: Math.abs(r[2] - r[0]) * k, h: Math.abs(r[3] - r[1]) * k };
  }
  // Farbe der Schrift und des Hintergrunds aus der gerenderten Seite ablesen
  function peColors(P, box) {
    const c = P.el.querySelector('canvas.pdf');
    const res = { fg: [0, 0, 0], bg: [1, 1, 1] };
    if (!c) return res;
    try {
      const sx = c.width / P.cssW;
      const x = Math.max(0, Math.floor(box.l * sx)), y = Math.max(0, Math.floor(box.t * sx));
      const w = Math.max(1, Math.min(c.width - x, Math.ceil(box.w * sx))), h = Math.max(1, Math.min(c.height - y, Math.ceil(box.h * sx)));
      const d = c.getContext('2d').getImageData(x, y, w, h).data;
      let dark = 765, fg = [0, 0, 0];
      const edge = [];
      for (let j = 0; j < h; j++) for (let i2 = 0; i2 < w; i2++) {
        const o = (j * w + i2) * 4, s = d[o] + d[o + 1] + d[o + 2];
        if (s < dark) { dark = s; fg = [d[o], d[o + 1], d[o + 2]]; }
        if (j === 0 || j === h - 1 || i2 === 0 || i2 === w - 1) edge.push([d[o], d[o + 1], d[o + 2], s]);
      }
      edge.sort((a, b) => b[3] - a[3]);
      const bg = edge[Math.floor(edge.length * 0.25)] || [255, 255, 255];
      res.fg = fg.map((v) => v / 255);
      res.bg = bg.slice(0, 3).map((v) => v / 255);
    } catch (e) { /* Canvas nicht lesbar */ }
    return res;
  }
  async function peTextAt(P, cx, cy) {
    if (P.el.querySelector('.pe-edit') || PE.busy) return;
    PE.busy = true;
    let lines;
    try { lines = await peLines(P); } finally { PE.busy = false; }
    const [ux, uy] = peToUser(P, cx, cy);
    const L = lines.find((l) => ux >= l.x1 - l.fs * 0.3 && ux <= l.x2 + l.fs * 0.3 && uy >= l.y + l.desc * l.fs - 2 && uy <= l.y + l.asc * l.fs + 2);
    if (!L) { toast(lines.length ? 'Hier ist kein Text. Tippe direkt auf eine Zeile.' : 'Diese Seite hat keinen bearbeitbaren Text (Scan?). Erst „Text erkennen“, dann geht es.', 4000); return; }
    const box = peToCss(P, [L.x1, L.y + L.desc * L.fs, L.x2, L.y + L.asc * L.fs]);
    const col = peColors(P, box);
    const ed = document.createElement('div');
    ed.className = 'pe-edit';
    ed.style.cssText = `left:${box.l - 4}px;top:${box.t - 4}px;min-width:${box.w + 8}px`;
    const serif = /serif/i.test(L.family) && !/sans/i.test(L.family);
    let bold0 = false;
    try { const fo = P.pg.commonObjs.get(L.fontName); bold0 = /bold|black|heavy|semibold/i.test((fo && (fo.name || fo.loadedName)) || ''); } catch (e) { /* */ }
    const fam0 = /mono/i.test(L.family) ? 'Courier' : serif ? 'TimesRoman' : 'Helvetica';
    const hex0 = '#' + col.fg.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
    ed.innerHTML = `<input type="text" class="pe-in" spellcheck="true" autocapitalize="off"><button type="button" class="ok" aria-label="Übernehmen">✓</button><button type="button" class="no" aria-label="Abbrechen">✕</button>
      <div class="pe-opts"><select class="pe-fam" aria-label="Schriftart"><option value="Helvetica">Helvetica</option><option value="TimesRoman">Times</option><option value="Courier">Courier</option></select>
      <label class="pe-b"><input type="checkbox" class="pe-bold"> <b>F</b></label>
      <input type="number" class="pe-size" min="4" max="144" step="0.5" aria-label="Schriftgröße"> pt
      <input type="color" class="pe-col" aria-label="Farbe"></div>`;
    const inp = ed.querySelector('.pe-in');
    ed.querySelector('.pe-fam').value = fam0;
    ed.querySelector('.pe-bold').checked = bold0;
    ed.querySelector('.pe-size').value = Math.round(L.fs * 2) / 2;
    ed.querySelector('.pe-col').value = hex0;
    const opts = () => ({ fam: ed.querySelector('.pe-fam').value, bold: ed.querySelector('.pe-bold').checked, size: +ed.querySelector('.pe-size').value || L.fs, hex: ed.querySelector('.pe-col').value });
    const o0 = JSON.stringify(opts());
    ed.querySelectorAll('.pe-opts select, .pe-opts input').forEach((c) => c.addEventListener('input', () => {
      const o = opts();
      inp.style.fontFamily = o.fam === 'Courier' ? 'Courier New, monospace' : o.fam === 'TimesRoman' ? 'Times New Roman, serif' : 'Helvetica, Arial, sans-serif';
      inp.style.fontWeight = o.bold ? '700' : '400';
      inp.style.color = o.hex;
      inp.style.fontSize = Math.max(10, box.h * 0.82 * o.size / L.fs) + 'px';
    }));
    inp.value = L.str;
    inp.style.fontSize = Math.max(10, box.h * 0.82) + 'px';
    inp.style.fontFamily = /mono/i.test(L.family) ? 'Courier New, monospace' : serif ? 'Times New Roman, serif' : 'Helvetica, Arial, sans-serif';
    inp.style.width = box.w + 24 + 'px';
    P.el.appendChild(ed);
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
    ed.querySelector('.no').onclick = () => ed.remove();
    const commit = async () => {
      const t = inp.value;
      const o = opts();
      ed.remove();
      if (t === L.str && JSON.stringify(o) === o0) return;
      await peReplaceLine(P, L, t, col, serif, o);
    };
    ed.querySelector('.ok').onclick = commit;
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') ed.remove(); });
    ed.addEventListener('pointerdown', (e) => e.stopPropagation());
    const grow = () => { inp.style.width = '10px'; inp.style.width = Math.min(P.cssW - 20, Math.max(box.w + 24, inp.scrollWidth + 12)) + 'px'; };
    inp.addEventListener('input', grow);
    ed.querySelectorAll('.pe-opts select, .pe-opts input').forEach((c) => c.addEventListener('input', grow));
  }
  async function peReplaceLine(P, L, text, col, serif, o) {
    if (!(await readyToEdit())) return;
    const path = V.path;
    toast('Text wird geändert …', 30000);
    try {
      const { PDFDocument, StandardFonts, rgb } = PDFLib;
      const doc = await PDFDocument.load(await pdfBytes(pdfCache.get(path)), { ignoreEncryption: true });
      let fontName = /mono/i.test(L.family) ? 'Courier' : serif ? 'TimesRoman' : 'Helvetica';
      let isBold = false;
      try { const fo = P.pg.commonObjs.get(L.fontName); isBold = /bold|black|heavy|semibold/i.test((fo && (fo.name || fo.loadedName)) || ''); } catch (e) { /* */ }
      if (o) { fontName = o.fam; isBold = o.bold; }
      if (isBold) fontName += 'Bold';
      if (o) col = { ...col, fg: [1, 3, 5].map((k) => parseInt(o.hex.slice(k, k + 2), 16) / 255) };
      const font = await pdfFont(doc, fontName, [text]);
      const t = winAnsi(font, text);
      let size = o ? o.size : L.fs;
      const w = font.widthOfTextAtSize(t, size);
      const room = L.x2 - L.x1;
      if (!o && w > room * 1.6 && room > 0) size = Math.max(L.fs * 0.6, size * room * 1.6 / w); // nicht endlos über den Rand laufen
      const sameY = (PE.lines.get(P.i) || []).filter((l) => Math.abs(l.y - L.y) < L.fs * 0.4).length === 1;
      // 1. alten Text aus dem Inhalt entfernen, 2. prüfen, ob noch etwas davon übrig ist – dann zusätzlich abdecken
      const build = async (cover) => {
        const d2 = cover ? await PDFDocument.load(await pdfBytes(pdfCache.get(path)), { ignoreEncryption: true }) : doc;
        const f2 = cover ? await pdfFont(d2, fontName, [text]) : font;
        let removed = 0;
        try { removed = stripLineText(d2, P.i, L, sameY); } catch (e) { removed = 0; }
        const pg = d2.getPage(P.i);
        if (cover || !removed) {
          const pad = L.fs * 0.06;
          pg.drawRectangle({ x: L.x1 - pad, y: L.y + L.desc * L.fs - pad, width: L.x2 - L.x1 + pad * 2, height: (L.asc - L.desc) * L.fs + pad * 2, color: rgb(...col.bg) });
        }
        if (t.trim()) pg.drawText(t, { x: L.x1, y: L.y, size, font: f2, color: rgb(...col.fg) });
        return { bytes: await pdfSave(d2), removed };
      };
      let res = await build(false);
      if (res.removed) {
        const chk = await pdfjsLib.getDocument({ data: res.bytes.slice(0), isEvalSupported: false }).promise;
        const tc = await (await chk.getPage(P.i + 1)).getTextContent();
        chk.destroy();
        const left = tc.items.filter((it) => it.str.trim() && Math.abs(it.transform[5] - L.y) < L.fs * 0.4 && it.transform[4] >= L.x1 - 1 && it.transform[4] < L.x2 && !t.includes(it.str.trim()));
        if (left.length) res = await build(true);
      }
      await commitPdf(path, res.bytes, [...Array(doc.getPageCount()).keys()], {}, null);
      PE.lines.clear();
      toast('Text geändert.');
    } catch (err) { toast('Ändern fehlgeschlagen: ' + err.message, 6000); }
  }
  function peDrawRects(P) {
    P.el.querySelectorAll('.pe-rect').forEach((el) => el.remove());
    (PE.rects.get(P.i) || []).forEach((r, k) => {
      const el = document.createElement('div');
      el.className = 'pe-rect';
      el.style.cssText = `left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%`;
      el.innerHTML = '<button type="button" aria-label="Bereich entfernen">✕</button>';
      el.querySelector('button').onclick = (e) => { e.stopPropagation(); PE.rects.get(P.i).splice(k, 1); peDrawRects(P); peBarText(); };
      P.el.appendChild(el);
    });
  }
  // Eingaben auf der Seite abfangen, solange bearbeitet wird
  viewer.addEventListener('pointerdown', (e) => {
    if (!PE.mode) return;
    const pageEl = e.target.closest('.page');
    if (!pageEl) return;
    if (e.target.closest('.pe-edit, .pe-rect button')) { e.stopPropagation(); return; } // eigene Knöpfe: nicht zeichnen
    const fingerScroll = e.pointerType === 'touch' && !S.finger && PE.mode === 'text';
    if (fingerScroll) return; // Finger: Antippen kommt als „click“, Wischen scrollt
    if (e.pointerType === 'touch' && !S.finger && PE.mode !== 'text') return;
    e.stopPropagation();
    e.preventDefault();
    const P = V.pages[+pageEl.dataset.i];
    const r0 = pageEl.getBoundingClientRect();
    const start = { x: e.clientX - r0.left, y: e.clientY - r0.top };
    if (PE.mode === 'text') { PE.down = { P, ...start, t: Date.now() }; return; }
    const box = document.createElement('div');
    box.className = 'pe-rect drawing';
    pageEl.appendChild(box);
    PE.box = box;
    PE.drag = { P, start, id: e.pointerId };
    try { pageEl.setPointerCapture(e.pointerId); } catch (er) { /* */ }
  }, true);
  viewer.addEventListener('pointermove', (e) => {
    if (!PE.mode || !PE.drag || e.pointerId !== PE.drag.id) return;
    e.stopPropagation();
    const { P, start } = PE.drag;
    const r0 = P.el.getBoundingClientRect();
    const x = Math.max(0, Math.min(P.cssW, e.clientX - r0.left)), y = Math.max(0, Math.min(P.cssH, e.clientY - r0.top));
    Object.assign(PE.box.style, { left: Math.min(x, start.x) + 'px', top: Math.min(y, start.y) + 'px', width: Math.abs(x - start.x) + 'px', height: Math.abs(y - start.y) + 'px' });
  }, true);
  viewer.addEventListener('pointerup', (e) => {
    if (!PE.mode) return;
    if (PE.mode === 'text' && PE.down) {
      const d = PE.down; PE.down = null;
      PE.upAt = Date.now();
      const r0 = d.P.el.getBoundingClientRect();
      if (Math.hypot(e.clientX - r0.left - d.x, e.clientY - r0.top - d.y) < 8) peTextAt(d.P, d.x, d.y);
      e.stopPropagation();
      return;
    }
    if (!PE.drag || e.pointerId !== PE.drag.id) return;
    e.stopPropagation();
    const { P } = PE.drag;
    const b = PE.box;
    const r = { x: b.offsetLeft / P.cssW, y: b.offsetTop / P.cssH, w: b.offsetWidth / P.cssW, h: b.offsetHeight / P.cssH };
    b.remove(); PE.box = null; PE.drag = null;
    if (r.w * P.cssW < 6 || r.h * P.cssH < 4) return;
    if (PE.mode === 'fbuild') { fbAdd(P, r); return; }
    if (!PE.rects.has(P.i)) PE.rects.set(P.i, []);
    PE.rects.get(P.i).push(r);
    peDrawRects(P);
    peBarText();
  }, true);
  viewer.addEventListener('click', (e) => {
    if (PE.mode !== 'text' || e.target.closest('.pe-edit') || Date.now() - (PE.upAt || 0) < 600) return;
    const pageEl = e.target.closest('.page');
    if (!pageEl) return;
    const P = V.pages[+pageEl.dataset.i];
    const r0 = pageEl.getBoundingClientRect();
    peTextAt(P, e.clientX - r0.left, e.clientY - r0.top);
  });
  // Schwärzen: betroffene Seiten werden als Bild neu aufgebaut – der Inhalt darunter ist danach wirklich weg
  $('#peApply').onclick = async () => {
    const pages = [...PE.rects.entries()].filter(([, l]) => l.length);
    if (!pages.length) return;
    if (!(await confirmDlg('Schwärzen anwenden?', `Auf ${pages.length} ${pages.length === 1 ? 'Seite' : 'Seiten'} wird alles unter den schwarzen Balken endgültig entfernt (auch der Text). Diese Seiten werden dabei als Bild (300 dpi) gespeichert; der übrige Text wird danach automatisch wieder durchsuchbar gemacht. Die vorherige Fassung bleibt auf dem Server gesichert.`, 'Schwärzen'))) return;
    if (!(await readyToEdit())) return;
    const path = V.path;
    toast('Wird geschwärzt …', 120000);
    const tRed = performance.now();
    try {
      const { PDFDocument } = PDFLib;
      const entry = pdfCache.get(path);
      const doc = await PDFDocument.load(await pdfBytes(entry), { ignoreEncryption: true });
      for (const [i, rects] of pages) {
        const pjs = await entry.pdf.getPage(i + 1);
        const vp0 = pjs.getViewport({ scale: 1 });
        const sc = Math.min(300 / 72, Math.sqrt(24e6 / (vp0.width * vp0.height)));
        const vp = pjs.getViewport({ scale: sc });
        const c = document.createElement('canvas');
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await pjs.render({ annotationMode: AM, canvasContext: ctx, viewport: vp }).promise;
        ctx.fillStyle = '#000';
        rects.forEach((r) => ctx.fillRect(r.x * c.width, r.y * c.height, r.w * c.width, r.h * c.height));
        const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
        const img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
        c.width = c.height = 0;
        const np = doc.insertPage(i, [vp0.width, vp0.height]);
        np.drawImage(img, { x: 0, y: 0, width: vp0.width, height: vp0.height });
        doc.removePage(i + 1);
      }
      peStop();
      // hier bewusst die ganze Datei neu schreiben und nicht mehr benutzte Teile entfernen – sonst stünde der geschwärzte Inhalt noch in der Datei
      await doc.flush();
      pdfGc(doc);
      await commitPdf(path, await doc.save(), [...Array(doc.getPageCount()).keys()], {}, pages[0][0]);
      toast('Geschwärzt. Der übrige Text wird wieder durchsuchbar gemacht …', 5000);
      track('perf', 'Schwärzen', performance.now() - tRed, `${pages.length} Seiten`);
      purgeAfterRedact(path);
      ocrQueue([path]);
    } catch (err) { toast('Schwärzen fehlgeschlagen: ' + err.message, 6000); }
  };

  // ---- Umwandeln
  const xmlEsc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  async function renderPageCanvas(pdf, i, dpi, strokesFor) {
    const pg = await pdf.getPage(i + 1);
    const vp0 = pg.getViewport({ scale: 1 });
    const sc = Math.min(dpi / 72, Math.sqrt(20e6 / (vp0.width * vp0.height)));
    const vp = pg.getViewport({ scale: sc });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ annotationMode: AM, canvasContext: ctx, viewport: vp }).promise;
    return { c, vp0, pg };
  }
  const canvasBytes = async (c, type, q) => new Uint8Array(await (await new Promise((res) => c.toBlob(res, type, q))).arrayBuffer());
  // Textzeilen und Absätze einer Seite
  async function pageParas(pg) {
    const vp = pg.getViewport({ scale: 1 });
    const tc = await pg.getTextContent();
    const items = tc.items.filter((it) => it.str !== undefined && (it.str.trim() || it.hasEOL));
    const lines = [];
    for (const it of items) {
      if (!it.str.trim()) continue;
      const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      const fs = Math.hypot(it.transform[2], it.transform[3]) || Math.hypot(it.transform[0], it.transform[1]);
      const L = lines.find((l) => Math.abs(l.y - y) < fs * 0.5);
      if (L) { L.parts.push({ x, s: it.str, w: it.width }); L.fs = Math.max(L.fs, fs); } else lines.push({ y, fs, parts: [{ x, s: it.str, w: it.width }] });
    }
    lines.sort((a, b) => a.y - b.y);
    lines.forEach((l) => {
      l.parts.sort((a, b) => a.x - b.x);
      let t = '', end = -1e9;
      for (const p of l.parts) { t += (t && p.x - end > l.fs * 0.2 && !/\s$/.test(t) && !/^\s/.test(p.s) ? ' ' : '') + p.s; end = p.x + p.w; }
      l.text = t.replace(/\s+/g, ' ').trim();
      l.x = l.parts[0].x;
    });
    const fss = lines.map((l) => l.fs).sort((a, b) => a - b);
    const body = fss[Math.floor(fss.length / 2)] || 11;
    const paras = [];
    let curP = null, prev = null;
    for (const l of lines) {
      const head = l.fs > body * 1.25;
      const gap = prev ? l.y - prev.y : 0;
      const bullet = /^([•\-–▪◦●■]|\d+[.)])\s/.test(l.text);
      if (!curP || head !== curP.head || Math.abs(l.fs - curP.fs) > body * 0.2 || gap > prev.fs * 1.75 || bullet) {
        curP = { head, fs: l.fs, text: l.text, bullet };
        paras.push(curP);
      } else curP.text = curP.text.replace(/-$/, '') + (/-$/.test(curP.text) ? '' : ' ') + l.text;
      prev = l;
    }
    return { paras, chars: lines.reduce((a, l) => a + l.text.length, 0), body };
  }
  async function toDocx(asImages) {
    const path = V.path;
    const { zipSync, strToU8 } = fflate;
    const bytes = await annotatedBytesFor(path);
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
    const files = {};
    const rels = [];
    let body = '';
    const emu = (pt) => Math.round(pt * 12700);
    for (let i = 0; i < pdf.numPages; i++) {
      $('#cvMsg').textContent = `Seite ${i + 1} von ${pdf.numPages} …`;
      const pg = await pdf.getPage(i + 1);
      const vp = pg.getViewport({ scale: 1 });
      const { paras, chars } = asImages ? { paras: [], chars: 0 } : await pageParas(pg);
      if (asImages || chars < 25) {
        // Scan oder Bildseite: als Bild übernehmen
        const { c } = await renderPageCanvas(pdf, i, asImages ? 170 : 150);
        const id = 'rImg' + i;
        files[`word/media/p${i + 1}.jpg`] = await canvasBytes(c, 'image/jpeg', 0.85);
        c.width = c.height = 0;
        rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/p${i + 1}.jpg"/>`);
        const maxW = 6.3 * 72, maxH = 9.2 * 72;
        const f = Math.min(maxW / vp.width, maxH / vp.height);
        const w = emu(vp.width * f), h = emu(vp.height * f);
        body += `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline><wp:extent cx="${w}" cy="${h}"/><wp:docPr id="${i + 1}" name="Seite ${i + 1}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${i + 1}" name="p${i + 1}.jpg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
      }
      for (const p of paras) {
        const sz = Math.round(Math.max(8, Math.min(40, p.fs)) * 2);
        const style = p.head ? '<w:pStyle w:val="Heading2"/>' : '';
        body += `<w:p><w:pPr>${style}${p.bullet ? '<w:ind w:left="360" w:hanging="360"/>' : ''}</w:pPr><w:r><w:rPr>${p.head ? '<w:b/>' : ''}<w:sz w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${xmlEsc(p.text)}</w:t></w:r></w:p>`;
      }
      if (i < pdf.numPages - 1) body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    }
    pdf.destroy();
    files['[Content_Types].xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
    files['_rels/.rels'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    files['word/_rels/document.xml.rels'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rSt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' + rels.join('') + '</Relationships>');
    files['word/styles.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="de-DE"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="1E2F6E"/></w:rPr></w:style></w:styles>');
    files['word/document.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>' + body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>');
    const zip = zipSync(files, { level: 6 });
    downloadBlob(new Blob([zip], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), stem(path) + '.docx');
  }
  async function toImages(onlyCurrent) {
    const path = V.path;
    const bytes = await annotatedBytesFor(path);
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
    try {
      if (onlyCurrent) {
        const i = currentPageIndex();
        const { c } = await renderPageCanvas(pdf, i, 200);
        downloadBlob(await new Promise((res) => c.toBlob(res, 'image/png')), `${stem(path)} – Seite ${i + 1}.png`);
        return;
      }
      const files = {};
      const w = String(pdf.numPages).length;
      for (let i = 0; i < pdf.numPages; i++) {
        $('#cvMsg').textContent = `Seite ${i + 1} von ${pdf.numPages} …`;
        const { c } = await renderPageCanvas(pdf, i, 200);
        files[`${stem(path)} – Seite ${String(i + 1).padStart(w, '0')}.jpg`] = await canvasBytes(c, 'image/jpeg', 0.9);
        c.width = c.height = 0;
      }
      downloadBlob(new Blob([fflate.zipSync(files, { level: 0 })], { type: 'application/zip' }), stem(path) + ' (Bilder).zip');
    } finally { pdf.destroy(); }
  }
  async function toText() {
    const path = V.path;
    const pdf = pdfCache.get(path).pdf;
    let out = '';
    for (let i = 0; i < pdf.numPages; i++) {
      const { paras } = await pageParas(await pdf.getPage(i + 1));
      out += (i ? '\n\n' : '') + `--- Seite ${i + 1} ---\n\n` + paras.map((p) => p.text).join('\n\n');
    }
    downloadBlob(new Blob([out], { type: 'text/plain;charset=utf-8' }), stem(path) + '.txt');
  }
  const cvRun = (fn) => async () => {
    const btns = $('#convDlg').querySelectorAll('.dlg-actions.col button');
    btns.forEach((b) => { b.disabled = true; });
    $('#cvMsg').textContent = 'Wird umgewandelt …';
    try { await fn(); $('#cvMsg').textContent = 'Fertig – die Datei wird heruntergeladen.'; } catch (err) { $('#cvMsg').textContent = 'Umwandeln fehlgeschlagen: ' + err.message; }
    btns.forEach((b) => { b.disabled = false; });
  };
  $('#cvDocx').onclick = cvRun(() => toDocx(false));
  $('#cvDocxImg').onclick = cvRun(() => toDocx(true));
  $('#cvJpg').onclick = cvRun(() => toImages(false));
  $('#cvPng').onclick = cvRun(() => toImages(true));
  $('#cvTxt').onclick = cvRun(toText);

  // ---- Mit Passwort schützen (Verschlüsselung macht der Server)
  async function askPassword(title, text) {
    const inp = $('#askInput');
    inp.type = 'password';
    inp.removeAttribute('list');
    try { return await askText(title, text, '', 'Weiter'); } finally { inp.type = 'text'; inp.setAttribute('list', 'folderList'); }
  }
  async function protectPdf() {
    track('tool', 'Mit Passwort schützen');
    if (!V.path || !needOnline('Verschlüsseln')) return;
    const p1 = await askPassword('Passwort zum Öffnen', 'Mit diesem Passwort lässt sich die heruntergeladene Kopie öffnen. Die PDF in PDF-Stift bleibt ungeschützt.');
    if (!p1) return;
    if (p1.length < 4) { toast('Bitte mindestens 4 Zeichen.'); return; }
    const p2 = await askPassword('Passwort wiederholen', '');
    if (p2 !== p1) { toast('Die Passwörter stimmen nicht überein.'); return; }
    toast('Wird verschlüsselt …', 60000);
    try {
      const fd = new FormData();
      fd.append('pw', p1);
      fd.append('pdf', new Blob([await annotatedBytesFor(V.path)], { type: 'application/pdf' }), 'in.pdf');
      const r = await fetch(API + '?a=protect', { method: 'POST', credentials: 'same-origin', headers: { 'X-PDFStift': '1' }, body: fd });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Fehler ' + r.status); }
      const how = r.headers.get('X-PDFStift-Crypt') || '';
      downloadBlob(await r.blob(), stem(V.path) + ' (geschützt).pdf');
      toast('Geschützte Kopie heruntergeladen' + (how ? ` (${how})` : '') + '.', 5000);
    } catch (err) { toast('Verschlüsseln fehlgeschlagen: ' + err.message, 6000); }
  }

  // ---- Bilder hochladen → PDF
  async function imagesToPdf(files) {
    const { PDFDocument } = PDFLib;
    const out = await PDFDocument.create();
    for (const f of files) {
      const prepared = await prepareImage(f);
      const buf = new Uint8Array(await prepared.arrayBuffer());
      const img = prepared.type === 'image/png' ? await out.embedPng(buf) : await out.embedJpg(buf);
      // A4, Hoch- oder Querformat wie das Bild, Bild eingepasst mit Rand
      const land = img.width > img.height;
      const W = land ? 841.89 : 595.28, H = land ? 595.28 : 841.89, m = 24;
      const k = Math.min((W - 2 * m) / img.width, (H - 2 * m) / img.height);
      const pg = out.addPage([W, H]);
      pg.drawImage(img, { x: (W - img.width * k) / 2, y: (H - img.height * k) / 2, width: img.width * k, height: img.height * k });
    }
    return out.save();
  }

  // ---- Menü
  const peMenu = { edittext: () => peStart('text'), redact: () => peStart('redact'), stamp: stampDialog, outline: outlineDialog, insertpdf: insertPdfHere, extract: () => extractPages(), protect: protectPdf,
    organize: () => { OV.selMode = false; OV.sel.clear(); OV.filter = 'all'; openOverview(); },
    convert: () => { $('#cvMsg').textContent = ''; $('#convDlg').showModal(); } };
  $('#menu').addEventListener('click', (e) => {
    const a = e.target.dataset.act;
    if (a && peMenu[a]) { if (!V.path || V.board) { toast('Bitte zuerst eine PDF öffnen.'); return; } peMenu[a](); }
  });

  // ================================================================== Werkzeuge 2 (1.19): Werkzeuge, Formulare, Unterschrift, Bilder, Export, Vergleich
  // ---- Inhaltsstrom einer Seite lesen/schreiben und zerlegen
  function pageContent(doc, i) {
    const { PDFName, PDFArray, PDFRawStream, decodePDFRawStream } = PDFLib;
    const pg = doc.getPage(i);
    const ctx = doc.context;
    const raw = pg.node.get(PDFName.of('Contents'));
    const look = ctx.lookup(raw);
    const refs = look instanceof PDFArray ? [...Array(look.size()).keys()].map((k) => look.get(k)) : [raw];
    const parts = refs.map((r) => ctx.lookup(r)).filter(Boolean).map((st) => (st instanceof PDFRawStream ? decodePDFRawStream(st).decode() : st.getContents ? st.getContents() : new Uint8Array(0)));
    const src = new Uint8Array(parts.reduce((a, b) => a + b.length + 1, 0));
    let o = 0;
    for (const b of parts) { src.set(b, o); o += b.length; src[o++] = 10; }
    return src;
  }
  function setPageContent(doc, i, bytes) {
    const { PDFName } = PDFLib;
    doc.getPage(i).node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(bytes)));
  }
  function spliceBytes(src, edits) { // edits: [start, ende, ersatz]
    const chunks = [];
    let last = src.length;
    edits.sort((a, b) => b[0] - a[0]);
    for (const [a, b, t] of edits) { chunks.unshift(src.subarray(b, last)); chunks.unshift(new TextEncoder().encode(t)); last = a; }
    chunks.unshift(src.subarray(0, last));
    const out = new Uint8Array(chunks.reduce((x, c) => x + c.length, 0));
    let p = 0;
    for (const c of chunks) { out.set(c, p); p += c.length; }
    return out;
  }
  // Zerlegt den Inhaltsstrom in Befehle mit Operanden (inkl. Byte-Positionen), verfolgt die Grafikmatrix
  function contentOps(src, cb) {
    const n = src.length;
    const isWs = (c) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
    const isDel = (c) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
    const mul = (A, B) => [A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3], A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3], A[4] * B[0] + A[5] * B[2] + B[4], A[4] * B[1] + A[5] * B[3] + B[5]];
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    let operands = [], opStart = -1;
    const arrStack = [];
    let i = 0;
    while (i < n) {
      const c = src[i];
      if (isWs(c)) { i++; continue; }
      if (c === 37) { while (i < n && src[i] !== 10 && src[i] !== 13) i++; continue; }
      const s0 = i;
      if (opStart < 0) opStart = s0;
      let tok;
      if (c === 40) {
        let depth = 0;
        for (; i < n; i++) { const d = src[i]; if (d === 92) { i++; continue; } if (d === 40) depth++; else if (d === 41) { depth--; if (depth === 0) { i++; break; } } }
        tok = { t: 'str', s: s0, e: i };
      } else if (c === 60 && src[i + 1] === 60) { i += 2; continue; } else if (c === 62 && src[i + 1] === 62) { i += 2; continue; } else if (c === 60) { while (i < n && src[i] !== 62) i++; i++; tok = { t: 'str', s: s0, e: i }; } else if (c === 91) { i++; arrStack.push({ t: 'arr', s: s0, prev: operands }); operands = []; continue; } else if (c === 93) { i++; const a = arrStack.pop(); if (a) { a.e = i; a.items = operands; operands = a.prev; operands.push(a); } continue; } else if (c === 47) { i++; while (i < n && !isWs(src[i]) && !isDel(src[i])) i++; tok = { t: 'name', v: String.fromCharCode(...src.subarray(s0 + 1, i)), s: s0, e: i }; } else {
        while (i < n && !isWs(src[i]) && !isDel(src[i])) i++;
        if (i === s0) { i++; continue; }
        const v = String.fromCharCode(...src.subarray(s0, i));
        tok = /^[+\-.\d]/.test(v) ? { t: 'num', v, s: s0, e: i } : { t: 'op', v, s: s0, e: i };
      }
      if (tok.t !== 'op') { operands.push(tok); continue; }
      if (arrStack.length) continue;
      const op = tok.v, A = operands, st = opStart;
      operands = []; opStart = -1;
      if (op === 'BI') { while (i < n - 2 && !(isWs(src[i]) && src[i + 1] === 69 && src[i + 2] === 73 && (i + 3 >= n || isWs(src[i + 3]) || isDel(src[i + 3])))) i++; i += 3; continue; }
      if (op === 'q') stack.push(ctm);
      else if (op === 'Q') ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (op === 'cm' && A.length >= 6) ctm = mul(A.slice(-6).map((t) => parseFloat(t.v)), ctm);
      cb(op, A, { start: st, end: tok.e, ctm });
    }
  }
  // Bilder einer Seite (nur direkt auf der Seite gezeichnete)
  function pageImages(doc, i) {
    const { PDFName, PDFDict } = PDFLib;
    const pg = doc.getPage(i);
    let xo = null;
    try { let res = pg.node.Resources(); if (!res) { pg.node.normalize(); res = pg.node.Resources(); } xo = res && res.lookup(PDFName.of('XObject'), PDFDict); } catch (e) { xo = null; }
    if (!xo) return [];
    const out = [];
    contentOps(pageContent(doc, i), (op, A, info) => {
      if (op !== 'Do' || !A.length || A[A.length - 1].t !== 'name') return;
      const name = A[A.length - 1].v;
      let obj;
      try { obj = xo.lookup(PDFName.of(name)); } catch (e) { obj = null; }
      if (!obj || !obj.dict || String(obj.dict.get(PDFName.of('Subtype'))) !== '/Image') return;
      const M = info.ctm;
      const xs = [M[4], M[0] + M[4], M[2] + M[4], M[0] + M[2] + M[4]], ys = [M[5], M[1] + M[5], M[3] + M[5], M[1] + M[3] + M[5]];
      const r = { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
      if (r.x2 - r.x1 < 4 || r.y2 - r.y1 < 4) return;
      out.push({ name, ...r, start: A[A.length - 1].s, end: info.end, straight: Math.abs(M[1]) < 1e-6 && Math.abs(M[2]) < 1e-6 && M[0] > 0 && M[3] > 0 });
    });
    return out;
  }

  // ---- Werkzeuge-Seite
  const TOOL_ICON = {
    scanfix: '<path d="M5 4h10l4 4v12H5z"/><path d="M8 15l3-6 2 4 1.5-2L16 15"/><path d="M3 9l2-2M3 15l2 2"/>',
    handout: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><rect x="6.5" y="5.5" width="6" height="4"/><rect x="6.5" y="11.5" width="6" height="4"/><path d="M14.5 7h3M14.5 13h3M14.5 18h3M6.5 18h6"/>',
    findredact: '<circle cx="10" cy="10" r="5.5"/><path d="M14 14l6 6"/><rect x="7" y="8.5" width="6" height="3" fill="currentColor"/>',
    create: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M12 12v6M9 15h6"/>',
    merge: '<rect x="3.5" y="4" width="8" height="11" rx="1"/><rect x="12.5" y="9" width="8" height="11" rx="1"/><path d="M9 18h3"/>',
    organize: '<rect x="3.5" y="4" width="6" height="8" rx="1"/><rect x="14.5" y="4" width="6" height="8" rx="1"/><rect x="9" y="13" width="6" height="8" rx="1"/><path d="M10.5 8h3"/>',
    edittext: '<path d="M4 6h10M9 6v12"/><path d="M14.5 19l5.5-5.5-2-2L12.5 17l-.5 2.5z"/>',
    editimg: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.5L20 17"/>',
    export: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 15h7M14 12l3 3-3 3"/>',
    ocr: '<path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3"/><path d="M8 10h8M8 14h5"/>',
    stamp: '<path d="M7 3h10v18H7z"/><path d="M7 7h10M7 17h10"/><path d="M10 12h4"/>',
    outline: '<path d="M7 4h10v17l-5-4-5 4z"/>',
    comment: '<path d="M4 5h16v11H9l-4 4v-4H4z"/><path d="M8 9h8M8 12h5"/>',
    stamps: '<path d="M9 4h6v5l3 3H6l3-3z"/><path d="M5 15h14v3H5z"/><path d="M5 21h14"/>',
    compare: '<rect x="3.5" y="4" width="7.5" height="16" rx="1"/><rect x="13" y="4" width="7.5" height="16" rx="1"/><path d="M6 9h2.5M15.5 9h2.5M6 13h2.5M15.5 13h2.5"/>',
    fillsign: '<path d="M4 18c3-6 5 2 7-2s3-4 5 0"/><path d="M14 4l5 5-8 8H6v-5z"/>',
    prepform: '<rect x="4" y="3.5" width="16" height="17" rx="1.5"/><rect x="7" y="7" width="10" height="3" rx=".5"/><rect x="7" y="13" width="3" height="3" rx=".5"/><path d="M12 14.5h5"/>',
    protect: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><rect x="9" y="11" width="6" height="5" rx="1"/><path d="M10.5 11V9.5a1.5 1.5 0 0 1 3 0V11"/>',
    redact: '<rect x="3.5" y="5" width="17" height="14" rx="1"/><rect x="6.5" y="9" width="11" height="3" fill="currentColor"/><path d="M6.5 15h7"/>',
  };
  const TOOLS = [
    { g: 'Erstellen & Bearbeiten', items: [
      ['create', 'PDF erstellen', '#E5484D', 'Word, Excel, PowerPoint, Fotos', false],
      ['merge', 'Zusammenfügen', '#6E56CF', 'mehrere Dateien zu einer PDF', false],
      ['organize', 'Seiten organisieren', '#30A46C', 'umsortieren, drehen, löschen, herausziehen', true],
      ['edittext', 'Text bearbeiten', '#D6409F', 'Zeilen ändern, Schrift und Farbe', true],
      ['editimg', 'Bilder bearbeiten', '#D6409F', 'verschieben, Größe, ersetzen, löschen', true],
      ['export', 'Exportieren', '#12A594', 'Word, Excel, PowerPoint, Bilder', true],
      ['ocr', 'Scans optimieren', '#30A46C', 'Text erkennen, durchsuchbar machen', true],
      ['scanfix', 'Scans aufbereiten', '#30A46C', 'gerade richten, leere Seiten weg, Kontrast', true],
      ['handout', 'Handzettel', '#0091FF', '2–9 Folien pro Seite, mit Notizlinien', true],
      ['stamp', 'Kopf-/Fußzeile & Wasserzeichen', '#0091FF', 'Seitenzahlen, Datum, Entwurf', true],
      ['outline', 'Lesezeichen', '#F76B15', 'Inhaltsverzeichnis anlegen', true],
    ] },
    { g: 'Prüfen & Kommentieren', items: [
      ['comment', 'Kommentieren', '#E5A000', 'markieren, schreiben, Formen', true],
      ['stamps', 'Stempel', '#8E4EC6', 'Genehmigt, Eingegangen am …', true],
      ['compare', 'Vergleichen', '#E5484D', 'mit früherer Fassung oder anderer PDF', true],
    ] },
    { g: 'Formulare & Unterschrift', items: [
      ['fillsign', 'Ausfüllen & Unterschreiben', '#8E4EC6', 'Formularfelder, Unterschrift', true],
      ['prepform', 'Formular vorbereiten', '#D6409F', 'Felder anlegen', true],
    ] },
    { g: 'Schützen', items: [
      ['protect', 'Mit Passwort schützen', '#0091FF', 'geschützte Kopie herunterladen', true],
      ['redact', 'Schwärzen', '#1B1F29', 'Inhalte endgültig entfernen', true],
      ['findredact', 'Suchen & Schwärzen', '#1B1F29', 'Namen, Nummern, E-Mails automatisch finden', true],
    ] },
  ];
  function toolsOpen() {
    closeMenus();
    const body = $('#tvBody');
    body.innerHTML = '';
    const doc = V.path && !V.board ? V.path : '';
    $('#tvDoc').textContent = doc ? '· ' + stem(doc) : '· wähle danach eine PDF';
    for (const grp of TOOLS) {
      const h = document.createElement('h3');
      h.className = 'tv-group';
      h.textContent = grp.g;
      body.appendChild(h);
      const row = document.createElement('div');
      row.className = 'tv-grid';
      for (const [id, label, color, sub] of grp.items) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tv-tile';
        b.dataset.tool = id;
        b.innerHTML = `<svg viewBox="0 0 24 24" style="color:${color}">${TOOL_ICON[id]}</svg><span class="tv-l"></span><span class="tv-s muted small"></span>`;
        b.querySelector('.tv-l').textContent = label;
        b.querySelector('.tv-s').textContent = sub;
        b.onclick = () => runTool(id);
        row.appendChild(b);
      }
      body.appendChild(row);
    }
    $('#toolsView').hidden = false;
  }
  const toolsClose = () => { $('#toolsView').hidden = true; };
  $('#tvClose').onclick = toolsClose;
  // Knopf „Werkzeuge“: bei geöffneter PDF die Leiste links ein-/ausblenden, sonst die große Übersicht
  $('#toolsBtn').onclick = () => {
    if (!$('#toolsView').hidden) { toolsClose(); return; }
    if (V.path && (V.board || !$('#viewer').hidden)) { ls('toolPanel', !ls('toolPanel')); tpRender(); return; }
    toolsOpen();
  };
  // ---- Folienmarken: „Folie 7“ / „Video 3“ als Marke an den Rand tippen, Liste zum Springen
  const MK = { next: null };
  const MK_STYLE = { c: '#5F3DC4', bg: '#EDE7FF', bo: '#7048E8' };
  const mkWord = (kind) => (kind === 'v' ? 'Video' : LANG === 'en' ? 'Slide' : 'Folie');
  function markers(path = V.path) {
    const d = path && Notes.docs.get(path);
    if (!d) return [];
    const wy = (s) => (s.o ? s.o[1] + s.pts[1] / (s.z || 1) : s.pts[1]);
    const wx = (s) => (s.o ? s.o[0] + s.pts[0] / (s.z || 1) : s.pts[0]);
    return [...d.strokes.values()].filter((s) => s.t === 'txt' && s.mk).sort((a, b) => a.p - b.p || (Math.abs(wy(a) - wy(b)) > 20 ? wy(a) - wy(b) : wx(a) - wx(b)));
  }
  function markerStart(kind) {
    if (!V.path) { toast('Bitte zuerst eine PDF oder Notizseite öffnen.'); return; }
    const nums = markers().filter((m) => (m.mk === 'v') === (kind === 'v')).map((m) => parseInt(String(m.text).replace(/\D+/g, ''), 10) || 0);
    MK.next = { kind, n: (nums.length ? Math.max(...nums) : 0) + 1 };
    document.body.classList.add('mk-mode');
    toast(`${mkWord(kind)} ${MK.next.n}: an die gewünschte Stelle tippen (Esc = abbrechen).`, 6000);
  }
  function markerStop() { MK.next = null; document.body.classList.remove('mk-mode'); }
  // ---- Textbausteine: häufige Randnotizen mit einem Klick (Baustein wählen, dann auf die Seite tippen)
  const SNIP0 = [
    { text: 'Wichtig!', c: '#D6262B', b: 1 }, { text: 'Merken', c: '#1F4FD6', b: 1 }, { text: 'Beispiel', c: '#1B8A3A' },
    { text: 'Definition', c: '#7048E8', b: 1 }, { text: 'Frage', c: '#E8590C' }, { text: 'Nachlesen', c: '#495057' },
  ];
  const snippets = () => { const v = ls('snippets'); return Array.isArray(v) ? v.filter((x) => x && x.text) : SNIP0.map((x) => ({ ...x })); };
  const SNIP = { next: null };
  function snipStart(i) {
    if (!V.path) { toast('Bitte zuerst eine PDF oder Notizseite öffnen.'); return; }
    const sn = snippets()[i];
    if (!sn) return;
    markerStop();
    SNIP.next = sn;
    document.body.classList.add('mk-mode');
    toast(`„${sn.text}“: an die gewünschte Stelle tippen (Esc = abbrechen).`, 6000);
  }
  function snipStop() { SNIP.next = null; if (!MK.next) document.body.classList.remove('mk-mode'); }
  // Notizseite: Textbaustein an der getippten Stelle
  boardEl.addEventListener('pointerdown', (e) => {
    if (!SNIP.next || !V.board || e.target.closest('.txt-editor')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const [sx, sy] = bdPt(e);
    const [wx, wy] = toWorld(sx, sy);
    const sn = SNIP.next;
    const fs = Math.round((S.ttSize || 14) * 1.3);
    const m = measureTxt(sn.text, fs, { b: sn.b });
    const st = { id: uid(), p: 0, t: 'txt', c: sn.c || '#1A1A1A', fs, pts: [0, 0], text: sn.text, bw: r2(m.bw), bh: r2(m.bh), o: [wx, wy - (m.bh / 2) / B.cam.s], z: B.cam.s };
    if (sn.b) st.b = 1;
    st.sn = 1; // Textbaustein: bleibt als Notiz (verschieben, ändern, löschen), wird nicht eingebrannt
    opAdd(V.path, [st]);
    pushHistory({ t: 'add', strokes: [st] });
    boardRender();
    $('#toast').hidden = true;
    track('tool', 'Textbaustein');
    if (!e.shiftKey) {
      snipStop();
      boardClearSel(); B.sel = { ids: new Set([st.id]) }; selBoxUpdate(); showSelBar();
      toast('Baustein gesetzt – zum Verschieben ziehen, „Löschen“ entfernt ihn.', 3500);
    }
  }, true);
  pagesEl.addEventListener('pointerdown', (e) => {
    if (!SNIP.next) return;
    const pageEl = e.target.closest('.page');
    if (!pageEl) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const P = V.pages[+pageEl.dataset.i];
    const [x, y] = ptFrom(P, e);
    const sn = SNIP.next, sty = ls('ttStyle') || {};
    const fs = S.ttSize || 14, fmt = { b: sn.b, ff: sty.ff };
    const m = measureTxt(sn.text, fs, fmt);
    const st = { id: uid(), p: P.i, t: 'txt', c: sn.c || '#1A1A1A', fs, pts: [r2(x), r2(y - m.bh / 2)], text: sn.text, bw: r2(m.bw), bh: r2(m.bh) };
    if (sn.b) st.b = 1;
    st.sn = 1; // Textbaustein: bleibt als Notiz (verschieben, ändern, löschen), wird nicht eingebrannt
    if (sty.ff) st.ff = sty.ff;
    opAdd(V.path, [st]);
    pushHistory({ t: 'add', strokes: [st] });
    drawInk(P);
    $('#toast').hidden = true;
    track('tool', 'Textbaustein');
    // mit gedrückter Umschalttaste: weitere Male setzen
    if (!e.shiftKey) {
      snipStop();
      // gleich ausgewählt: ziehen = verschieben, „Löschen“ in der Leiste darunter
      clearSel(); SEL = { P, ids: [st.id] }; renderSel();
      toast('Baustein gesetzt – zum Verschieben ziehen, „Löschen“ entfernt ihn.', 3500);
    }
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && SNIP.next) { snipStop(); toast('Abgebrochen.'); } });
  function snipEdit(i) {
    const list = snippets();
    const cur = i != null ? list[i] : { text: '', c: '#D6262B', b: 1 };
    let d = $('#snipDlg'); if (d) d.remove();
    d = document.createElement('dialog'); d.id = 'snipDlg'; d.className = 'dlg snip-dlg';
    d.innerHTML = `<form method="dialog"><h3>${i != null ? 'Textbaustein ändern' : 'Neuer Textbaustein'}</h3>
      <div class="set-row"><span>Text</span><input id="snT" maxlength="80" value="${esc(cur.text)}" placeholder="z. B. Siehe Kapitel 3"></div>
      <div class="set-row"><span>Farbe</span><span class="snip-cols">${PALETTE.map(([hex, label]) => `<button type="button" class="te-c${hex.toLowerCase() === String(cur.c).toLowerCase() ? ' on' : ''}" data-c="${hex}" style="--c:${hex}" aria-label="${label}"></button>`).join('')}</span></div>
      <label class="set-row"><span>Fett</span><input type="checkbox" id="snB"${cur.b ? ' checked' : ''}></label>
      <div class="dlg-actions">${i != null ? '<button type="button" class="btn danger" id="snDel">Löschen</button>' : ''}<button type="submit" value="" class="btn">Abbrechen</button><button type="submit" value="ok" class="btn primary">Speichern</button></div></form>`;
    document.body.appendChild(d);
    let col = cur.c;
    d.querySelectorAll('.te-c').forEach((b) => { b.onclick = () => { col = b.dataset.c; d.querySelectorAll('.te-c').forEach((x) => x.classList.toggle('on', x === b)); }; });
    if (d.querySelector('#snDel')) d.querySelector('#snDel').onclick = () => { list.splice(i, 1); ls('snippets', list); d.close(); tpRender(); };
    d.addEventListener('close', () => {
      if (d.returnValue === 'ok') {
        const text = d.querySelector('#snT').value.trim();
        if (text) { const sn = { text, c: col }; if (d.querySelector('#snB').checked) sn.b = 1; if (i != null) list[i] = sn; else list.push(sn); ls('snippets', list); tpRender(); }
      }
      d.remove();
    }, { once: true });
    d.showModal();
    d.querySelector('#snT').focus();
  }
  boardEl.addEventListener('pointerdown', (e) => {
    if (!MK.next || !V.board || e.target.closest('.txt-editor')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const [wx, wy] = toWorld(...bdPt(e));
    const text = `${mkWord(MK.next.kind)} ${MK.next.n}`;
    const fs = 16, m = measureTxt(text, fs, { b: 1 });
    const st = { id: uid(), p: 0, t: 'txt', c: MK_STYLE.c, fs, b: 1, bg: MK_STYLE.bg, bo: MK_STYLE.bo, mk: MK.next.kind === 'v' ? 'v' : 'f', pts: [0, 0], text, bw: r2(m.bw), bh: r2(m.bh), o: [wx - m.bw / 2 / B.cam.s, wy - m.bh / 2 / B.cam.s], z: B.cam.s };
    opAdd(V.path, [st]);
    pushHistory({ t: 'add', strokes: [st] });
    boardRender();
    $('#toast').hidden = true;
    track('tool', MK.next.kind === 'v' ? 'Videomarke' : 'Folienmarke');
    markerStop();
    if (document.body.classList.contains('tp-on')) tpRender();
  }, true);
  pagesEl.addEventListener('pointerdown', (e) => {
    if (!MK.next) return;
    const pageEl = e.target.closest('.page');
    if (!pageEl) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const P = V.pages[+pageEl.dataset.i];
    const [x, y] = ptFrom(P, e);
    const text = `${mkWord(MK.next.kind)} ${MK.next.n}`;
    const fs = 12, m = measureTxt(text, fs, { b: 1 });
    const st = { id: uid(), p: P.i, t: 'txt', c: MK_STYLE.c, fs, b: 1, bg: MK_STYLE.bg, bo: MK_STYLE.bo, mk: MK.next.kind === 'v' ? 'v' : 'f', pts: [r2(x - m.bw / 2), r2(y - m.bh / 2)], text, bw: r2(m.bw), bh: r2(m.bh) };
    opAdd(V.path, [st]);
    pushHistory({ t: 'add', strokes: [st] });
    drawInk(P);
    $('#toast').hidden = true;
    track('tool', MK.next.kind === 'v' ? 'Videomarke' : 'Folienmarke');
    markerStop();
    if (document.body.classList.contains('tp-on')) tpRender();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && MK.next) { markerStop(); toast('Abgebrochen.'); } });
  function markerJump(id) {
    const m = markers().find((x) => x.id === id);
    if (!m) return;
    if (V.board) {
      const w = worldBox(m);
      B.cam.x = (w[0] + w[2]) / 2 - B.w / 2 / B.cam.s; B.cam.y = w[1] - 80 / B.cam.s;
      B.flash = m.id; boardRender(); saveCam();
      return;
    }
    const P = V.pages[m.p];
    goToPage(m.p);
    setTimeout(() => { if (P) viewer.scrollTop = Math.max(0, P.top + m.pts[1] * (P.cssH / P.h) - 120); }, 60);
  }

  // ---- Lernzettel: alle Markierungen einer PDF nach Farbe gesammelt – jede Farbe mit eigener Bedeutung
  const MEANING0 = LANG === 'en'
    ? { '#FFE14D': 'Important', '#7CC7FF': 'Definition', '#7BE36B': 'Example', '#FF7AC0': 'Exam', '#FF4A1C': 'Key term', '#A855F7': 'Question' }
    : { '#FFE14D': 'Wichtig', '#7CC7FF': 'Definition', '#7BE36B': 'Beispiel', '#FF7AC0': 'Prüfung', '#FF4A1C': 'Fachbegriff', '#A855F7': 'Frage' };
  const meanings = () => Object.assign({}, MEANING0, ls('meanings') || {});
  async function marksText(path) {
    const d = Notes.docs.get(path);
    if (!d) return [];
    const out = [];
    for (const s of d.strokes.values()) {
      if (!((s.t === 'tx' && s.k === 'hl') || s.t === 'hl')) continue;
      const P = V.pages[s.p];
      if (!P) continue;
      let idx; try { idx = await pageTextIndex(P); } catch (e) { continue; }
      // Bereiche der Markierung: Textmarker = Rechtecke, Freihand-Marker = Band um den Strich
      const rects = [];
      if (s.t === 'tx') for (let i = 0; i + 3 < s.pts.length; i += 4) rects.push([s.pts[i], s.pts[i + 1], s.pts[i + 2], s.pts[i + 3]]);
      else { const b = bbox(s); rects.push([b[0], b[1], b[2] - b[0], b[3] - b[1]]); }
      let text = '';
      for (const it of idx.items) {
        const cw = it.w / Math.max(1, it.n);
        let piece = '';
        for (let k = 0; k < it.n; k++) {
          const cx = it.x + (k + 0.5) * cw, cy = it.y + it.h / 2;
          if (rects.some(([x, y, w, h]) => cx >= x && cx <= x + w && cy >= y - 2 && cy <= y + h + 2)) piece += it.s[k];
        }
        if (piece) text += (text && !/\s$/.test(text) ? ' ' : '') + piece;
      }
      text = text.replace(/\s+/g, ' ').trim();
      if (text) out.push({ id: s.id, p: s.p, y: (s.t === 'tx' ? s.pts[1] : bbox(s)[1]), c: String(s.c).toUpperCase(), text });
    }
    return out.sort((a, b) => a.p - b.p || a.y - b.y);
  }
  async function studySheet() {
    if (!V.path || V.board) { toast('Bitte zuerst eine PDF öffnen.'); return; }
    track('tool', 'Lernzettel');
    toast('Markierungen werden gesammelt …', 20000);
    const marks = await marksText(V.path);
    const mks = markers();
    $('#toast').hidden = true;
    const M = meanings();
    const groups = new Map();
    for (const m of marks) { if (!groups.has(m.c)) groups.set(m.c, []); groups.get(m.c).push(m); }
    const title = stem(V.path);
    const asText = () => [title, ''].concat(...[...groups].map(([c, l]) => [`== ${M[c] || colorName(c)} ==`, ...l.map((m) => `- ${m.text} (S. ${m.p + 1})`), ''])).join('\n');
    const d = document.createElement('dialog');
    d.className = 'dlg set-dlg study-dlg';
    d.innerHTML = `<form method="dialog"><h2>Lernzettel</h2><p class="muted small">Alle Markierungen aus „${esc(title)}“, nach Farbe sortiert. Die Bedeutung einer Farbe können Sie direkt im Feld ändern – sie gilt dann für alle PDFs.</p>
      <div class="st-body">${groups.size ? [...groups].map(([c, l]) => `<section class="st-grp"><div class="st-h"><i style="background:${c}"></i><input class="st-mean" data-c="${c}" value="${esc(M[c] || colorName(c))}" aria-label="Bedeutung dieser Farbe"><span class="muted small">${l.length}</span></div>
        ${l.map((m) => `<button type="button" class="st-it" data-p="${m.p}" data-id="${m.id}"><span>${esc(m.text)}</span><span class="muted small">S. ${m.p + 1}</span></button>`).join('')}</section>`).join('') : '<p class="muted">Noch keine Markierungen mit erkennbarem Text. Bei Scans zuerst „Text erkennen“.</p>'}
      ${mks.length ? `<section class="st-grp"><div class="st-h"><i style="background:${MK_STYLE.bg};outline:1px solid ${MK_STYLE.bo}"></i><b>Folien- und Videomarken</b></div>${mks.map((m) => `<button type="button" class="st-it" data-p="${m.p}" data-mk="${m.id}"><span>${esc(m.text)}</span><span class="muted small">S. ${m.p + 1}</span></button>`).join('')}</section>` : ''}</div>
      <div class="dlg-actions"><button type="button" class="btn" data-a="cp">Kopieren</button><button type="button" class="btn" data-a="dl">Als Datei speichern</button><button type="submit" value="" class="btn primary" autofocus>Schließen</button></div></form>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => d.remove(), { once: true });
    d.querySelectorAll('.st-mean').forEach((inp) => inp.addEventListener('change', () => { const o = ls('meanings') || {}; o[inp.dataset.c] = inp.value.trim(); ls('meanings', o); }));
    d.querySelectorAll('.st-it').forEach((b) => { b.onclick = () => { d.close(); if (b.dataset.mk) markerJump(b.dataset.mk); else goToPage(+b.dataset.p); }; });
    d.querySelector('[data-a=cp]').onclick = async () => { try { await navigator.clipboard.writeText(asText()); toast('Lernzettel kopiert.'); } catch (e) { toast('Kopieren nicht möglich.'); } };
    d.querySelector('[data-a=dl]').onclick = () => downloadBlob(new Blob([asText()], { type: 'text/plain;charset=utf-8' }), `${title} – Lernzettel.txt`);
    d.showModal();
  }

  // ---- Werkzeug-Leiste links (wie in PDF-Programmen): Text formatieren, Seite ändern, Inhalt hinzufügen, alle Werkzeuge
  const TP_PAGE = [
    ['rotate', 'Seite drehen', '#6E56CF', '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>', () => menuAction('rotate')],
    ['ins', 'Leere Seite einfügen', '#30A46C', '<path d="M6 3h8l4 4v14H6z"/><path d="M12 10v6M9 13h6"/>', () => menuAction('ins-blank')],
    ['delpage', 'Seite löschen', '#E5484D', '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>', () => menuAction('delpage')],
    ['extract', 'Seiten extrahieren', '#F76B15', '<path d="M6 3h8l4 4v14H6z"/><path d="M9 14h6M13 11l3 3-3 3"/>', () => runTool('organize')],
    ['organize', 'Seiten organisieren', '#30A46C', '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>', () => runTool('organize')],
  ];
  const TP_MARK = [
    ['mkf', 'Folienmarke setzen', '#7048E8', '<rect x="3.5" y="6" width="17" height="12" rx="3"/><path d="M8 12h8"/>', () => markerStart('f')],
    ['mkv', 'Videomarke setzen', '#7048E8', '<rect x="3.5" y="6" width="12" height="12" rx="3"/><path d="M15.5 10l5-3v10l-5-3"/>', () => markerStart('v')],
    ['study', 'Lernzettel aus Markierungen', '#E5A000', '<path d="M6 3h9l3 3v15H6z"/><path d="M9 9h6M9 13h6M9 17h4"/>', () => studySheet()],
    ['tonb', 'Ins Notizbuch übernehmen', '#0B7285', '<path d="M7 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7z"/><path d="M7 3v18"/><path d="M2 12h9M8 9l3 3-3 3"/>', () => toNotebook()],
    ['carry', 'Notizen aus älterer Fassung übernehmen', '#0B7285', '<path d="M5 4h8l3 3v6"/><path d="M5 4v14h6"/><path d="M14 14h7M18 11l3 3-3 3"/>', () => carryDialog()],
  ];
  const TP_BOARD = [
    ['bd-pdf', 'PDF-Seiten einfügen', '#0B7285', '<path d="M6 3h8l4 4v14H6z"/><path d="M12 10v6M9 13h6"/>', () => nbInsertPdf()],
    ['bd-tpl', 'Vorlage einfügen', '#7048E8', '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M5 7h14M10 7v14M10 17h9"/>', () => boardInsertTpl()],
    ['bd-img', 'Bild einfügen', '#D6409F', '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4 4 3 3-2 4 3"/>', () => menuAction('bd-img')],
    ['bd-fit', 'Ganze Seite zeigen', '#6E56CF', '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', () => boardFit()],
    ['bd-hist', 'Frühere Stände', '#6E56CF', '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/><path d="M4 4v4h4"/>', () => boardHistory()],
    ['bd-save', 'Als PDF speichern', '#30A46C', '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 19h14"/>', () => boardPdfDialog('save')],
    ['bd-print', 'Drucken', '#30A46C', '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="7" rx="1.5"/><path d="M7 14h10v6H7z"/>', () => boardPdfDialog('print')],
  ];
  const TP_ADD = [
    ['tt', 'Text', '#D6409F', '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>', () => { S.tool = 'tt'; persistTools(); renderToolbar(); tpRender(); toast('Auf die Seite klicken und schreiben.'); }],
    ['img', 'Bild einfügen', '#D6409F', '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4 4 3 3-2 4 3"/>', () => { IMGDO.mode = 'place'; $('#imgIn').click(); }],
    ['edittext', 'Text bearbeiten', '#D6409F', null, () => runTool('edittext')],
    ['editimg', 'Bilder bearbeiten', '#D6409F', null, () => runTool('editimg')],
    ['stamp', 'Kopf-/Fußzeile & Wasserzeichen', '#0091FF', null, () => runTool('stamp')],
    ['link', 'Link zu einer Seite', '#0091FF', '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>', () => menuAction('link')],
    ['outline', 'Lesezeichen', '#F76B15', null, () => runTool('outline')],
    ['stamps', 'Stempel', '#8E4EC6', null, () => runTool('stamps')],
  ];
  function tpRender() {
    const el = $('#toolPanel');
    const on = !EMBED && !!ls('toolPanel') && !!V.path && (V.board || !$('#viewer').hidden);
    document.body.classList.toggle('tp-on', on);
    el.hidden = !on;
    $('#toolsBtn').setAttribute('aria-pressed', on ? 'true' : 'false');
    document.documentElement.style.setProperty('--tpw', tpW() + 'px');
    const mode = tpMode();
    ['l', 'r', 'f'].forEach((m) => document.body.classList.toggle('tp-' + m, m === mode));
    if (on) {
      tpPlace();
      const q = ($('#tpQ') && $('#tpQ').value || '').trim().toLowerCase();
      const used = new Set([...TP_PAGE, ...TP_ADD, ...TP_MARK].map((x) => x[0]));
      const pins = (ls('tpPins') || []), pinSet = new Set(pins);
      const item = ([id, label, color, svg]) => (!q || label.toLowerCase().includes(q)) ? `<button type="button" class="tp-it${S.tool === 'tt' && id === 'tt' ? ' on' : ''}${pinSet.has(id) ? ' pinned' : ''}" data-id="${id}"><svg viewBox="0 0 24 24" style="color:${color}">${svg || TOOL_ICON[id] || ''}</svg><span>${esc(label)}</span><i class="tp-pin" data-pin="${id}" role="button" tabindex="-1" title="${pinSet.has(id) ? 'Nicht mehr anheften' : 'Oben anheften'}" aria-label="${pinSet.has(id) ? 'Nicht mehr anheften' : 'Oben anheften'}"><svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/></svg></i></button>` : '';
      const sec = (title, list) => { const h = list.map(item).join(''); return h ? `<h4>${title}</h4>${h}` : ''; };
      const rest = TOOLS.map((g) => sec(g.g, g.items.filter((t) => !used.has(t[0])).map(([id, label, color]) => [id, label, color, null]))).join('');
      const tt = S.tool === 'tt' || editor;
      const fmt = editor || { ...(ls('ttStyle') || {}), fs: S.ttSize, color: S.color.tt };
      const fmtHtml = tt && !q ? `<h4>Text formatieren</h4><div class="tp-fmt">
          <div class="tp-row"><select id="tpFf" aria-label="Schriftart"><option value="">Helvetica</option><option value="serif">Times</option><option value="mono">Courier</option></select>
          <select id="tpFs" aria-label="Schriftgröße">${TXT_SIZES.map((n) => `<option value="${n}">${n} pt</option>`).join('')}</select></div>
          <div class="tp-row"><button type="button" class="te-t${fmt.b ? ' on' : ''}" data-f="b" aria-label="Fett"><b>B</b></button><button type="button" class="te-t${fmt.i ? ' on' : ''}" data-f="i" aria-label="Kursiv"><i>I</i></button><span class="te-sep"></span>
          ${['', 'c', 'r'].map((a) => `<button type="button" class="te-t${(fmt.al || '') === a ? ' on' : ''}" data-al="${a}" aria-label="${{ '': 'Linksbündig', c: 'Zentriert', r: 'Rechtsbündig' }[a]}"><svg viewBox="0 0 24 24">${AL_SVG[a]}</svg></button>`).join('')}</div>
          <div class="tp-cols">${PALETTE.map(([hex, label]) => `<button type="button" class="te-c${String(fmt.color).toLowerCase() === hex.toLowerCase() ? ' on' : ''}" data-c="${hex}" style="--c:${hex}" aria-label="${label}"></button>`).join('')}</div></div>` : '';
      const mks = markers();
      const mkHtml = sec('Folien & Lernen', TP_MARK) + (mks.length && !q ? `<div class="tp-mks">${mks.map((m) => `<button type="button" class="tp-mk" data-mk="${m.id}"><span>${esc(m.text)}</span><span class="muted small">S. ${m.p + 1}</span></button>`).join('')}</div>` : '');
      // Angeheftet und zuletzt benutzt ganz oben
      const ALL = new Map();
      [...TP_MARK, ...TP_PAGE, ...TP_ADD].forEach((x) => ALL.set(x[0], x));
      TOOLS.forEach((g) => g.items.forEach(([id, label, color]) => { if (!ALL.has(id)) ALL.set(id, [id, label, color, null]); }));
      const pinList = pins.map((id) => ALL.get(id)).filter(Boolean);
      const recList = (ls('tpRecent') || []).filter((id) => !pinSet.has(id)).map((id) => ALL.get(id)).filter(Boolean).slice(0, 5);
      const snHtml = `<h4>Textbausteine</h4><div class="tp-snips">${snippets().map((sn, k) => (!q || sn.text.toLowerCase().includes(q)) ? `<button type="button" class="tp-snip" data-sn="${k}" style="--c:${esc(sn.c || '#1A1A1A')}${sn.b ? ';font-weight:700' : ''}" title="Antippen, dann auf die Seite tippen · Rechtsklick: ändern">${esc(sn.text)}</button>` : '').join('')}${q ? '' : '<button type="button" class="tp-snip add" data-sn="+" title="Eigenen Baustein anlegen">+</button>'}</div>`;
      const topHtml = q ? snHtml : sec('Angeheftet', pinList) + sec('Zuletzt benutzt', recList) + snHtml;
      if (V.board) {
        // Notizseite: nur, was dort Sinn ergibt
        const bdMk = sec('Folien & Lernen', TP_MARK.filter((x) => x[0] === 'mkf' || x[0] === 'mkv')) + (mks.length && !q ? `<div class="tp-mks">${mks.map((m) => `<button type="button" class="tp-mk" data-mk="${m.id}"><span>${esc(m.text)}</span></button>`).join('')}</div>` : '');
        $('#tpBody').innerHTML = snHtml + bdMk + sec('Notizseite', TP_BOARD);
      } else $('#tpBody').innerHTML = fmtHtml + topHtml + mkHtml + sec('Seite ändern', TP_PAGE) + sec('Inhalt hinzufügen', TP_ADD) + rest;
      $('#tpBody').querySelectorAll('.tp-snip').forEach((b) => {
        b.onclick = () => (b.dataset.sn === '+' ? snipEdit(null) : snipStart(+b.dataset.sn));
        b.oncontextmenu = (e) => { if (b.dataset.sn === '+') return; e.preventDefault(); snipEdit(+b.dataset.sn); };
      });
      $('#tpBody').querySelectorAll('.tp-pin').forEach((pn) => {
        pn.onclick = (e) => {
          e.stopPropagation(); e.preventDefault();
          const id = pn.dataset.pin, cur = ls('tpPins') || [];
          ls('tpPins', cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
          tpRender();
        };
      });
      $('#tpBody').querySelectorAll('.tp-mk').forEach((b) => { b.onclick = () => markerJump(b.dataset.mk); });
      if (fmtHtml) {
        $('#tpFf').value = fmt.ff || ''; $('#tpFs').value = String(fmt.fs || 14);
        const apply = (k, v) => {
          if (editor) { const b = editor.box; if (k === 'ff') { b.querySelector('.te-ff').value = v; b.querySelector('.te-ff').onchange({ target: { value: v } }); } else if (k === 'fs') { b.querySelector('.te-fs').value = v; b.querySelector('.te-fs').onchange({ target: { value: v } }); } else if (k === 'b' || k === 'i') b.querySelector(`[data-a=${k}]`).click(); else if (k === 'al') b.querySelector(`.te-al[data-al="${v}"]`).click(); else if (k === 'c') b.querySelector(`.te-c[data-c="${v}"]`).click(); }
          else {
            const st = ls('ttStyle') || {};
            if (k === 'ff') st.ff = v; if (k === 'b') st.b = !st.b; if (k === 'i') st.i = !st.i; if (k === 'al') st.al = v;
            ls('ttStyle', st);
            if (k === 'fs') S.ttSize = +v; if (k === 'c') S.color.tt = v;
            persistTools(); renderToolbar();
          }
          tpRender();
        };
        $('#tpFf').onchange = (e) => apply('ff', e.target.value);
        $('#tpFs').onchange = (e) => apply('fs', +e.target.value);
        $('#tpBody').querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => apply(b.dataset.f); });
        $('#tpBody').querySelectorAll('.tp-fmt [data-al]').forEach((b) => { b.onclick = () => apply('al', b.dataset.al); });
        $('#tpBody').querySelectorAll('.tp-fmt .te-c').forEach((b) => { b.onclick = () => apply('c', b.dataset.c); });
        $('#tpBody').querySelectorAll('.tp-fmt button, .tp-fmt select').forEach((b) => b.addEventListener('pointerdown', (e) => { if (editor && e.target.tagName !== 'SELECT') e.preventDefault(); }));
      }
      const all = [...TP_PAGE, ...TP_ADD, ...TP_MARK, ...TP_BOARD];
      $('#tpBody').querySelectorAll('.tp-it').forEach((b) => { b.onclick = () => { tpUsed(b.dataset.id); track('tool', 'Werkzeugleiste: ' + b.querySelector('span').textContent.trim()); const x = all.find((t) => t[0] === b.dataset.id); if (x) x[4](); else runTool(b.dataset.id); }; });
    }
    if (on !== tpRender.was) { tpRender.was = on; window.dispatchEvent(new Event('resize')); }
  }
  function tpW() { return Math.max(220, Math.min(520, ls('tpW') || 300)); }
  function tpMode() { const m = ls('tpSide'); return m === 'r' || m === 'f' ? m : 'l'; }
  // Lage der Leiste: an der Seite (Höhe wie die Dokumentansicht) oder lose als Fenster
  function tpPlace() {
    const el = $('#toolPanel');
    if (!document.body.classList.contains('tp-on')) return;
    const r = (V.board ? boardEl : $('#viewer')).getBoundingClientRect();
    if (tpMode() === 'f') {
      const f = ls('tpF') || {};
      const w = tpW(), h = Math.max(260, Math.min(window.innerHeight - 20, f.h || Math.round(window.innerHeight * 0.7)));
      const x = Math.max(4, Math.min(window.innerWidth - w - 4, f.x ?? (window.innerWidth - w - 90)));
      const y = Math.max(4, Math.min(window.innerHeight - 60, f.y ?? (r.top + 20)));
      Object.assign(el.style, { left: x + 'px', right: 'auto', top: y + 'px', height: Math.min(h, window.innerHeight - y - 6) + 'px' });
    } else Object.assign(el.style, { left: '', right: '', top: r.top + 'px', height: r.height + 'px' });
  }
  function tpSetMode(m) {
    ls('tpSide', m);
    tpRender(); thPlace(); window.dispatchEvent(new Event('resize'));
  }
  $('#tpSide').onclick = () => tpSetMode(tpMode() === 'l' ? 'r' : 'l');
  // Kopfzeile ziehen: an den linken oder rechten Rand andocken oder irgendwo als Fenster ablegen
  $('#toolPanel .tp-head').addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const el = $('#toolPanel'), head = e.currentTarget;
    const b0 = el.getBoundingClientRect();
    const dx = e.clientX - b0.left, dy = e.clientY - b0.top;
    let moved = false, zone = null, hint = null;
    head.setPointerCapture(e.pointerId);
    const vr = () => $('#viewer').getBoundingClientRect();
    const mv = (ev) => {
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 6) return;
      if (!moved) {
        moved = true;
        document.body.classList.add('tp-drag');
        Object.assign(el.style, { right: 'auto', height: Math.min(b0.height, window.innerHeight * 0.7) + 'px' });
        hint = document.createElement('div'); hint.className = 'tp-drop'; hint.hidden = true; document.body.appendChild(hint);
      }
      const x = Math.max(0, Math.min(window.innerWidth - 60, ev.clientX - dx)), y = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy));
      Object.assign(el.style, { left: x + 'px', top: y + 'px' });
      const v = vr();
      zone = ev.clientX < 110 ? 'l' : ev.clientX > window.innerWidth - 110 ? 'r' : 'f';
      hint.hidden = zone === 'f';
      if (zone !== 'f') Object.assign(hint.style, { top: v.top + 'px', height: v.height + 'px', width: tpW() + 'px', left: zone === 'l' ? '0px' : (window.innerWidth - tpW()) + 'px' });
    };
    const up = (ev) => {
      head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up);
      document.body.classList.remove('tp-drag');
      if (hint) hint.remove();
      if (!moved) return;
      if (zone === 'f') { const b = el.getBoundingClientRect(); ls('tpF', { x: Math.round(b.left), y: Math.round(b.top), h: Math.round(b.height) }); }
      tpSetMode(zone || tpMode());
    };
    head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
  });
  // Doppelklick auf die Kopfzeile: losgelöste Leiste wieder links andocken
  $('#toolPanel .tp-head').addEventListener('dblclick', (e) => { if (!e.target.closest('button') && tpMode() === 'f') tpSetMode('l'); });
  // Breite mit der Maus ziehen (rechter Rand der Leiste)
  $('#tpResize').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    el.classList.add('drag');
    const x0 = e.clientX, w0 = tpW(), dir = tpMode() === 'r' ? -1 : 1;
    const mv = (ev) => { ls('tpW', Math.max(220, Math.min(520, w0 + dir * (ev.clientX - x0)))); if (tpMode() === 'f') tpPlace(); document.documentElement.style.setProperty('--tpw', tpW() + 'px'); thPlace(); };
    const up = () => { el.classList.remove('drag'); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); window.dispatchEvent(new Event('resize')); };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
  });
  $('#tpResize').addEventListener('dblclick', () => { ls('tpW', 300); tpRender(); thPlace(); window.dispatchEvent(new Event('resize')); });
  $('#tpClose').onclick = () => { ls('toolPanel', false); tpRender(); };
  $('#tpAll').onclick = () => toolsOpen();
  $('#tpQ').addEventListener('input', () => tpRender());
  $('#tpQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const b = $('#tpBody .tp-it'); if (b) b.click(); } e.stopPropagation(); });
  window.addEventListener('resize', () => tpPlace());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#toolsView').hidden) toolsClose(); });
  async function waitDoc(path) {
    for (let k = 0; k < 300; k++) {
      if (V.path === path && V.pages.length && pdfCache.get(path)) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }
  // zuletzt benutzte Werkzeuge merken (für die Werkzeug-Leiste)
  function tpUsed(id) { if (!id) return; ls('tpRecent', [id, ...(ls('tpRecent') || []).filter((x) => x !== id)].slice(0, 8)); }
  async function runTool(id) {
    tpUsed(id);
    const needs = TOOLS.some((g) => g.items.some((t) => t[0] === id && t[4]));
    toolsClose();
    if (id === 'create' || id === 'export' || id === 'comment') track('tool', { create: 'PDF erstellen', export: 'Exportieren', comment: 'Kommentieren' }[id]);
    if (id === 'create') { showLibrary(); $('#btnUpload').click(); return; }
    if (id === 'merge') { mergePdfs(); return; }
    if (needs && !(V.path && !V.board)) {
      const r = await pickPdfs({ title: 'PDF wählen', text: 'Auf welche PDF soll das Werkzeug angewendet werden? (eine antippen)', go: 'Öffnen', withName: false });
      if (!r || !r.files.length || typeof r.files[0] !== 'string') return;
      openDoc(r.files[0]);
      if (!(await waitDoc(r.files[0]))) return;
    }
    const run = {
      organize: () => { OV.selMode = false; OV.sel.clear(); OV.filter = 'all'; openOverview(); },
      edittext: () => peStart('text'),
      editimg: () => imStart(),
      export: () => { $('#cvMsg').textContent = ''; $('#convDlg').showModal(); },
      ocr: () => ocrQueue([V.path]),
      stamp: stampDialog,
      outline: outlineDialog,
      comment: () => { S.tool = 'tx'; persistTools(); renderToolbar(); toast('Markieren, schreiben und zeichnen mit den Werkzeugen oben.'); },
      stamps: stampsOpen,
      compare: compareOpen,
      fillsign: fmStart,
      prepform: () => peStart('fbuild'),
      protect: protectPdf,
      redact: () => peStart('redact'),
      findredact: findRedact,
      handout: handoutDialog,
      scanfix: scanFixDialog,
    }[id];
    if (run) run();
  }
  $('#menu').addEventListener('click', (e) => { if (e.target.closest('[data-act=tools]')) toolsOpen(); });

  // ---- Formulare ausfüllen
  const FM = { on: false, vals: new Map(), fields: [] };
  async function fmStart() {
    track('tool', 'Ausfüllen & Unterschreiben');
    if (!V.path || V.board) return;
    if (!needOnline('Formulare ausfüllen')) return;
    peStop();
    FM.on = true;
    FM.vals.clear();
    FM.fields = [];
    document.body.classList.add('fm-on');
    $('#peBar').hidden = false;
    $('#peApply').hidden = false;
    $('#peApply').disabled = false;
    $('#peApply').textContent = 'Speichern';
    $('#peExtra').innerHTML = `<button type="button" class="btn" data-x="sig">Unterschrift</button><button type="button" class="btn" data-x="stamp">Stempel</button><button type="button" class="btn" data-x="signew" title="Gespeicherte Unterschrift ersetzen">Neu unterschreiben</button><label class="check fm-flat"><input type="checkbox" id="fmFlat"> <span>fest einbrennen</span></label>`;
    $('#peText').textContent = 'Formular wird gelesen …';
    let n = 0;
    for (const P of V.pages) {
      const anns = await pgOf(P).then((pg) => pg.getAnnotations({ intent: 'display' })).catch(() => []);
      for (const a of anns) {
        if (a.annotationType !== 20 || !a.fieldName || a.hidden) continue;
        if (a.fieldType === 'Btn' && a.pushButton) continue;
        FM.fields.push({ P, a });
        n++;
      }
    }
    fmRender();
    $('#peText').textContent = n ? `${new Set(FM.fields.map((f) => f.a.fieldName)).size} Felder zum Ausfüllen. Mit „Speichern“ in die PDF schreiben.` : 'Keine Formularfelder: Schreibe mit dem Textfeld-Werkzeug (T) oder lege unter „Formular vorbereiten“ Felder an.';
    $('#peApply').hidden = !n;
  }
  function fmRender() {
    document.querySelectorAll('.fm-field').forEach((el) => el.remove());
    for (const { P, a } of FM.fields) {
      const box = peToCss(P, a.rect);
      const pct = (v, t) => (v / t * 100).toFixed(3) + '%';
      let el;
      const v = FM.vals.has(a.fieldName) ? FM.vals.get(a.fieldName) : a.fieldValue;
      if (a.fieldType === 'Tx') {
        el = document.createElement(a.multiLine ? 'textarea' : 'input');
        el.value = v == null ? '' : String(v);
        if (a.maxLen) el.maxLength = a.maxLen;
        el.oninput = () => { FM.vals.set(a.fieldName, el.value); document.querySelectorAll('.fm-field').forEach((o) => { if (o !== el && o.dataset.name === a.fieldName && 'value' in o && o.tagName !== 'SELECT') o.value = el.value; }); };
      } else if (a.fieldType === 'Btn' && a.checkBox) {
        el = document.createElement('input');
        el.type = 'checkbox';
        el.checked = v && v !== 'Off';
        el.onchange = () => FM.vals.set(a.fieldName, el.checked);
      } else if (a.fieldType === 'Btn' && a.radioButton) {
        el = document.createElement('input');
        el.type = 'radio';
        el.name = 'fm-' + a.fieldName;
        el.checked = v != null && v === a.buttonValue;
        const idx = FM.fields.filter((f2) => f2.a.fieldName === a.fieldName).findIndex((f2) => f2.a === a);
        el.onchange = () => { if (el.checked) FM.vals.set(a.fieldName, { radio: a.buttonValue, idx }); };
      } else if (a.fieldType === 'Ch') {
        el = document.createElement('select');
        for (const o of a.options || []) { const op = document.createElement('option'); op.value = o.exportValue; op.textContent = o.displayValue; el.appendChild(op); }
        const cur = Array.isArray(v) ? v[0] : v;
        if (cur != null) el.value = cur;
        el.onchange = () => FM.vals.set(a.fieldName, el.value);
      } else continue;
      el.className = 'fm-field';
      el.dataset.name = a.fieldName;
      el.disabled = !!a.readOnly;
      el.title = a.alternativeText || a.fieldName;
      el.style.cssText = `left:${pct(box.l, P.cssW)};top:${pct(box.t, P.cssH)};width:${pct(box.w, P.cssW)};height:${pct(box.h, P.cssH)};--fh:${(box.h / P.cssH * 100).toFixed(3)}`;
      P.el.appendChild(el);
    }
  }
  function fmStop() {
    FM.on = false;
    document.querySelectorAll('.fm-field').forEach((el) => el.remove());
    document.body.classList.remove('fm-on');
  }
  async function fmSave() {
    if (!FM.vals.size) { toast('Es wurde nichts geändert.'); return; }
    if (!(await readyToEdit())) return;
    const path = V.path;
    toast('Formular wird gespeichert …', 30000);
    try {
      const { PDFDocument, StandardFonts, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList } = PDFLib;
      const doc = await PDFDocument.load(await pdfBytes(pdfCache.get(path)), { ignoreEncryption: true });
      const form = doc.getForm();
      const helv = await pdfFont(doc, 'Helvetica', [...FM.vals.values()].filter((v) => typeof v === 'string'));
      let n = 0;
      for (const [name, v] of FM.vals) {
        let f;
        try { f = form.getField(name); } catch (e) { continue; }
        try {
          if (f instanceof PDFTextField) f.setText(winAnsi(helv, String(v)));
          else if (f instanceof PDFCheckBox) { if (v) f.check(); else f.uncheck(); }
          else if (f instanceof PDFRadioGroup) {
            // pdf-lib wählt nach Exportwert (/Opt); pdf.js liefert den Namen des Ein-Zustands – über die Reihenfolge zuordnen
            const opts = f.getOptions();
            const nW = f.acroField.getWidgets().length;
            f.select(opts.length === nW && opts[v.idx] !== undefined ? opts[v.idx] : opts.includes(v.radio) ? v.radio : opts[v.idx] ?? v.radio);
          }
          else if (f instanceof PDFDropdown || f instanceof PDFOptionList) f.select(String(v));
          n++;
        } catch (e) { /* Feld lässt sich nicht setzen */ }
      }
      try { form.updateFieldAppearances(helv); } catch (e) { /* */ }
      if ($('#fmFlat') && $('#fmFlat').checked) form.flatten();
      fmStop();
      peStop();
      await commitPdf(path, await pdfSave(doc), [...Array(doc.getPageCount()).keys()], {}, null);
      toast(`${n} ${n === 1 ? 'Feld' : 'Felder'} gespeichert.`);
    } catch (err) { toast('Speichern fehlgeschlagen: ' + err.message, 6000); }
  }

  // ---- Formular vorbereiten: Felder aufziehen (nutzt das Aufziehen vom Schwärzen)
  const FB = { list: [] };
  function fbAdd(P, r) {
    const d = $('#fbDlg');
    $('#fbName').value = 'Feld ' + (FB.list.length + 1);
    $('#fbOpts').value = '';
    $('#fbType').value = r.h * P.h < 22 && r.w * P.w < 22 ? 'check' : r.h * P.h > 40 ? 'multi' : 'text';
    $('#fbOptRow').hidden = $('#fbType').value !== 'choice';
    $('#fbType').onchange = () => { $('#fbOptRow').hidden = $('#fbType').value !== 'choice'; };
    d.returnValue = '';
    d.addEventListener('close', () => {
      if (d.returnValue !== 'yes') return;
      FB.list.push({ P, r, type: $('#fbType').value, name: $('#fbName').value.trim() || 'Feld ' + (FB.list.length + 1), opts: $('#fbOpts').value.split(',').map((x) => x.trim()).filter(Boolean) });
      fbDraw();
    }, { once: true });
    d.showModal();
  }
  function fbDraw() {
    document.querySelectorAll('.fb-box').forEach((el) => el.remove());
    FB.list.forEach((f, k) => {
      const el = document.createElement('div');
      el.className = 'fb-box';
      el.style.cssText = `left:${f.r.x * 100}%;top:${f.r.y * 100}%;width:${f.r.w * 100}%;height:${f.r.h * 100}%`;
      el.innerHTML = `<span></span><button type="button" aria-label="Feld entfernen">✕</button>`;
      el.querySelector('span').textContent = { text: 'Text', multi: 'Text ¶', check: '☐', choice: 'Auswahl' }[f.type] + ' · ' + f.name;
      el.querySelector('button').onclick = (e) => { e.stopPropagation(); FB.list.splice(k, 1); fbDraw(); };
      f.P.el.appendChild(el);
    });
    $('#peText').textContent = FB.list.length ? `${FB.list.length} ${FB.list.length === 1 ? 'Feld' : 'Felder'} angelegt – weitere aufziehen oder speichern.` : 'Formular vorbereiten: Rechteck für ein Feld aufziehen.';
    $('#peApply').disabled = !FB.list.length;
  }
  async function fbSave() {
    if (!FB.list.length) return;
    if (!(await readyToEdit())) return;
    const path = V.path;
    toast('Formularfelder werden angelegt …', 30000);
    try {
      const { PDFDocument, StandardFonts, rgb } = PDFLib;
      const doc = await PDFDocument.load(await pdfBytes(pdfCache.get(path)), { ignoreEncryption: true });
      const form = doc.getForm();
      const helv = await pdfFont(doc, 'Helvetica', FB.list.flatMap((f) => f.opts));
      const used = new Set(form.getFields().map((f) => f.getName()));
      for (const f of FB.list) {
        let name = f.name.replace(/[.]/g, '_'), k = 2;
        while (used.has(name)) name = f.name + ' ' + k++;
        used.add(name);
        const P = f.P;
        const [ax, ay] = peToUser(P, f.r.x * P.cssW, f.r.y * P.cssH);
        const [bx, by] = peToUser(P, (f.r.x + f.r.w) * P.cssW, (f.r.y + f.r.h) * P.cssH);
        const box = { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay), borderColor: rgb(0.55, 0.6, 0.72), borderWidth: 0.8, backgroundColor: rgb(0.95, 0.97, 1) };
        const page = doc.getPage(P.i);
        if (f.type === 'check') form.createCheckBox(name).addToPage(page, box);
        else if (f.type === 'choice') { const d2 = form.createDropdown(name); d2.addOptions(f.opts.length ? f.opts.map((o) => winAnsi(helv, o)) : ['ja', 'nein']); d2.addToPage(page, { ...box, font: helv }); }
        else { const t = form.createTextField(name); if (f.type === 'multi') t.enableMultiline(); t.addToPage(page, { ...box, font: helv }); }
      }
      FB.list = [];
      peStop();
      await commitPdf(path, await pdfSave(doc), [...Array(doc.getPageCount()).keys()], {}, null);
      toast('Formular gespeichert – zum Ausfüllen: Werkzeuge → Ausfüllen & Unterschreiben.', 5000);
    } catch (err) { toast('Anlegen fehlgeschlagen: ' + err.message, 6000); }
  }

  // ---- Unterschrift
  const SIG = { pts: [], drawing: false };
  async function sigPrefs() { try { return await apiJson('prefs'); } catch (e) { return ls('prefs') || {}; } }
  function sigPadInit() {
    const c = $('#sigPad');
    const ctx = c.getContext('2d');
    const clear = () => { ctx.clearRect(0, 0, c.width, c.height); SIG.pts = []; ctx.strokeStyle = '#ccd'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(40, c.height - 70); ctx.lineTo(c.width - 40, c.height - 70); ctx.stroke(); };
    clear();
    $('#sigClear').onclick = clear;
    const pos = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height, e.pressure || 0.5]; };
    let last = null;
    c.onpointerdown = (e) => { e.preventDefault(); c.setPointerCapture(e.pointerId); last = pos(e); SIG.pts.push([last]); };
    c.onpointermove = (e) => {
      if (!last) return;
      const p = pos(e);
      ctx.strokeStyle = '#14213d'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = 3 + (e.pointerType === 'pen' ? p[2] * 4 : 2);
      ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
      SIG.pts[SIG.pts.length - 1].push(p);
      last = p;
    };
    c.onpointerup = c.onpointercancel = () => { last = null; };
  }
  // Unterschrift als PNG mit durchsichtigem Hintergrund, auf das Gezeichnete zugeschnitten
  async function sigToPng() {
    const all = SIG.pts.flat();
    if (all.length < 4) return null;
    const pad = 14;
    const x0 = Math.min(...all.map((p) => p[0])) - pad, y0 = Math.min(...all.map((p) => p[1])) - pad;
    const x1 = Math.max(...all.map((p) => p[0])) + pad, y1 = Math.max(...all.map((p) => p[1])) + pad;
    const out = document.createElement('canvas');
    out.width = Math.round(x1 - x0); out.height = Math.round(y1 - y0);
    const ctx = out.getContext('2d');
    ctx.strokeStyle = '#14213d'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const line of SIG.pts) {
      for (let k = 1; k < line.length; k++) {
        ctx.lineWidth = 3 + line[k][2] * 3;
        ctx.beginPath(); ctx.moveTo(line[k - 1][0] - x0, line[k - 1][1] - y0); ctx.lineTo(line[k][0] - x0, line[k][1] - y0); ctx.stroke();
      }
    }
    return new File([await new Promise((r) => out.toBlob(r, 'image/png'))], 'unterschrift.png', { type: 'image/png' });
  }
  // Bild-Notiz auf der aktuellen Seite einsetzen (verschiebbar, wird beim Verlassen eingebrannt)
  function placeImg(res, frac) {
    const P = V.pages[currentPageIndex()];
    if (!P) return;
    const sc = P.cssW / P.w;
    const vr = viewer.getBoundingClientRect(), pr = P.el.getBoundingClientRect();
    const cy = ((Math.max(pr.top, vr.top) + Math.min(pr.bottom, vr.bottom)) / 2 - pr.top) / sc;
    const bw = Math.round(P.w * frac * 100) / 100, bh = Math.round(bw * res.h / res.w * 100) / 100;
    const st = { id: uid(), p: P.i, t: 'img', c: '#000000', src: res.src, pts: [Math.round((P.w * 0.62 - bw / 2) * 100) / 100, Math.round((cy - bh / 2) * 100) / 100], bw, bh };
    opAdd(V.path, [st]);
    pushHistory({ t: 'add', strokes: [st] });
    drawInk(P);
    S.tool = 'la'; persistTools(); renderToolbar();
    SEL = { P, ids: [st.id] };
    renderSel();
    V.dirty = true;
  }
  async function sigPlace() {
    if (!V.path) return;
    let pr = await sigPrefs();
    if (!pr.signature) {
      sigPadInit();
      const d = $('#sigDlg');
      d.returnValue = '';
      d.showModal();
      const ok = await new Promise((r) => d.addEventListener('close', () => r(d.returnValue === 'yes'), { once: true }));
      if (!ok) return;
      const f = await sigToPng();
      if (!f) { toast('Bitte zuerst unterschreiben.'); return; }
      try {
        const res = await uploadImage(f);
        pr = await apiJson('prefs', { method: 'POST', body: { signature: res } });
        ls('prefs', pr);
      } catch (err) { toast('Unterschrift konnte nicht gespeichert werden: ' + err.message); return; }
    }
    placeImg(pr.signature, 0.28);
    toast('Unterschrift eingesetzt – an die richtige Stelle ziehen, an den Ecken die Größe ändern.', 5000);
  }
  async function sigReset() {
    try { await apiJson('prefs', { method: 'POST', body: { signature: null } }); ls('prefs', {}); toast('Gespeicherte Unterschrift gelöscht.'); } catch (e) { toast(e.message); }
  }

  // ---- Stempel
  const STAMPS = [
    ['GENEHMIGT', '#1F8A4C'], ['GEPRÜFT', '#1F8A4C'], ['ERLEDIGT', '#1F8A4C'], ['EINGEGANGEN\n{datum}', '#1E4FB8'], ['GEBUCHT\n{datum}', '#1E4FB8'], ['KOPIE', '#1E4FB8'],
    ['ENTWURF', '#C2410C'], ['VERTRAULICH', '#C81E1E'], ['ABGELEHNT', '#C81E1E'],
  ];
  function stampCanvas(text, color) {
    const lines = text.replace(/\{datum\}/gi, todayDe()).split('\n');
    // Zusatzfelder aus dem Stempel-Fenster (Name, Bemerkung, Datum/Uhrzeit)
    const ex = [];
    const nm = ($('#stName') && $('#stName').value.trim()) || '';
    const bm = ($('#stNote') && $('#stNote').value.trim()) || '';
    if ($('#stWhen') && $('#stWhen').checked && !/\{datum\}/i.test(text)) ex.push(new Date().toLocaleString(LOC, { dateStyle: 'medium', timeStyle: 'short' }));
    if (nm) ex.push(nm);
    if (bm) ex.push(...bm.split('\n'));
    lines.push(...ex);
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    const fs = 64, lh = fs * 1.15;
    ctx.font = `800 ${fs}px Helvetica, Arial, sans-serif`;
    const w = Math.max(...lines.map((l, k) => { ctx.font = `${k ? 600 : 800} ${k ? fs * 0.6 : fs}px Helvetica, Arial, sans-serif`; return ctx.measureText(l).width; })) + 70;
    const h = lh + (lines.length - 1) * lh * 0.7 + 40;
    c.width = Math.ceil(w); c.height = Math.ceil(h);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 8;
    ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.roundRect(6, 6, c.width - 12, c.height - 12, 18); ctx.stroke();
    ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(18, 18, c.width - 36, c.height - 36, 10); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach((l, k) => { ctx.font = `${k ? 600 : 800} ${k ? fs * 0.6 : fs}px Helvetica, Arial, sans-serif`; ctx.fillText(l, c.width / 2, 20 + lh / 2 + (k ? lh * 0.35 + (k - 1) * lh * 0.7 + lh * 0.3 : 0)); });
    return c;
  }
  function stampsOpen() {
    track('tool', 'Stempel');
    if (!V.path) return;
    const box = $('#stList');
    box.innerHTML = '';
    const colOf = (def) => (ls('stampColor') && ls('stampColor') !== 'auto' ? ls('stampColor') : def);
    const draw = () => {
      box.innerHTML = '';
      for (const [t, col] of STAMPS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'stamp-btn';
        const c = stampCanvas(t, colOf(col));
        c.className = 'stamp-prev';
        b.appendChild(c);
        b.onclick = () => stampPlace(t, colOf(col));
        box.appendChild(b);
      }
      $('#stColors').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.c === (ls('stampColor') || 'auto')));
    };
    $('#stColors').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; ls('stampColor', b.dataset.c); draw(); };
    ['#stName', '#stNote', '#stWhen'].forEach((q) => { $(q).oninput = draw; $(q).onchange = draw; });
    $('#stName').value = ls('stampName') || '';
    $('#stName').addEventListener('change', () => ls('stampName', $('#stName').value.trim()));
    draw();
    $('#stOwnGo').onclick = () => { const t = $('#stOwn').value.trim(); if (t) stampPlace(t.replace(/\s*\|\s*/g, '\n'), colOf('#1E4FB8')); };
    $('#stDlg').showModal();
  }
  async function stampPlace(text, color) {
    $('#stDlg').close();
    if (!needOnline('Stempel')) return;
    try {
      const c = stampCanvas(text, color);
      const res = await uploadImage(new File([await new Promise((r) => c.toBlob(r, 'image/png'))], 'stempel.png', { type: 'image/png' }));
      placeImg(res, 0.26);
      toast('Stempel eingesetzt – verschieben oder an den Ecken die Größe ändern.');
    } catch (err) { toast('Stempel: ' + err.message); }
  }
  $('#peExtra').addEventListener('click', (e) => {
    const x = e.target.closest('[data-x]');
    if (!x) return;
    if (x.dataset.x === 'sig') sigPlace();
    if (x.dataset.x === 'stamp') stampsOpen();
    if (x.dataset.x === 'signew') sigReset().then(sigPlace);
  });

  // ---- Bilder in der PDF bearbeiten
  const IM = { on: false, list: [] };
  async function imStart() {
    track('tool', 'Bilder bearbeiten');
    if (!V.path || V.board || !needOnline('Bilder bearbeiten')) return;
    peStop();
    IM.on = true;
    IM.list = [];
    document.body.classList.add('im-on');
    $('#peBar').hidden = false;
    $('#peApply').hidden = false;
    $('#peApply').textContent = 'Übernehmen';
    $('#peExtra').innerHTML = '';
    try {
      const { PDFDocument } = PDFLib;
      const doc = await PDFDocument.load(await pdfBytes(pdfCache.get(V.path)), { ignoreEncryption: true });
      for (const P of V.pages) {
        const rot = rotOf(doc.getPage(P.i));
        for (const im of pageImages(doc, P.i)) IM.list.push({ P, im, rot, box: null, del: false, file: null, changed: false });
      }
    } catch (err) { toast('Bilder konnten nicht gelesen werden: ' + err.message); }
    imDraw();
  }
  function imBarText() {
    const n = IM.list.filter((x) => x.changed || x.del || x.file).length;
    $('#peText').textContent = IM.list.length ? (n ? `${n} ${n === 1 ? 'Bild' : 'Bilder'} geändert – „Übernehmen“ schreibt es in die PDF.` : 'Bild antippen: verschieben, an der Ecke Größe ändern, ersetzen oder löschen.') : 'In dieser PDF gibt es keine bearbeitbaren Bilder.';
    $('#peApply').disabled = !n;
  }
  function imDraw() {
    document.querySelectorAll('.im-box').forEach((el) => el.remove());
    IM.list.forEach((x) => {
      if (x.del) return;
      const P = x.P;
      if (!x.box) { const b = peToCss(P, [x.im.x1, x.im.y1, x.im.x2, x.im.y2]); x.box = { x: b.l / P.cssW, y: b.t / P.cssH, w: b.w / P.cssW, h: b.h / P.cssH }; }
      const el = document.createElement('div');
      el.className = 'im-box' + (x.changed || x.file ? ' changed' : '');
      el.style.cssText = `left:${x.box.x * 100}%;top:${x.box.y * 100}%;width:${x.box.w * 100}%;height:${x.box.h * 100}%`;
      el.innerHTML = `<div class="im-acts"><button type="button" data-i="rep">Ersetzen …</button><button type="button" data-i="del">Löschen</button></div><span class="im-h"></span>`;
      const fixed = x.rot !== 0 || !x.im.straight;
      el.querySelector('[data-i=del]').onclick = (e) => { e.stopPropagation(); x.del = true; imDraw(); imBarText(); };
      el.querySelector('[data-i=rep]').onclick = (e) => {
        e.stopPropagation();
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*';
        inp.onchange = async () => { if (inp.files[0]) { x.file = await prepareImage(inp.files[0]); imDraw(); imBarText(); } };
        inp.click();
      };
      if (!fixed) imDrag(el, x);
      else el.title = 'Auf gedrehten Seiten kann das Bild nur ersetzt oder gelöscht werden.';
      P.el.appendChild(el);
    });
    imBarText();
  }
  function imDrag(el, x) {
    let st = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.im-acts')) return;
      e.stopPropagation(); e.preventDefault();
      el.setPointerCapture(e.pointerId);
      st = { mx: e.clientX, my: e.clientY, b: { ...x.box }, res: !!e.target.closest('.im-h') };
    });
    el.addEventListener('pointermove', (e) => {
      if (!st) return;
      const P = x.P;
      const dx = (e.clientX - st.mx) / P.cssW, dy = (e.clientY - st.my) / P.cssH;
      if (st.res) { const k = Math.max(0.1, (st.b.w + dx) / st.b.w); x.box.w = st.b.w * k; x.box.h = st.b.h * k; } else { x.box.x = st.b.x + dx; x.box.y = st.b.y + dy; }
      Object.assign(el.style, { left: x.box.x * 100 + '%', top: x.box.y * 100 + '%', width: x.box.w * 100 + '%', height: x.box.h * 100 + '%' });
      x.changed = true;
    });
    const end = () => { if (st) { st = null; el.classList.toggle('changed', x.changed); imBarText(); } };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
  function imStop() { IM.on = false; IM.list = []; document.querySelectorAll('.im-box').forEach((el) => el.remove()); document.body.classList.remove('im-on'); }
  async function imApply() {
    const todo = IM.list.filter((x) => x.changed || x.del || x.file);
    if (!todo.length) return;
    if (!(await readyToEdit())) return;
    const path = V.path;
    toast('Bilder werden geändert …', 30000);
    try {
      const { PDFDocument, PDFName, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } = PDFLib;
      const doc = await PDFDocument.load(await pdfBytes(pdfCache.get(path)), { ignoreEncryption: true });
      const byPage = new Map();
      todo.forEach((x) => { if (!byPage.has(x.P.i)) byPage.set(x.P.i, []); byPage.get(x.P.i).push(x); });
      for (const [i, list] of byPage) {
        // Zeichenbefehle der geänderten Bilder entfernen …
        const src = pageContent(doc, i);
        setPageContent(doc, i, spliceBytes(src, list.map((x) => [x.im.start, x.im.end, ''])));
        const pg = doc.getPage(i);
        // … und an neuer Stelle / neu wieder zeichnen
        for (const x of list) {
          if (x.del) continue;
          const P = x.P;
          let r;
          if (x.changed) {
            const [ax, ay] = peToUser(P, x.box.x * P.cssW, x.box.y * P.cssH);
            const [bx, by] = peToUser(P, (x.box.x + x.box.w) * P.cssW, (x.box.y + x.box.h) * P.cssH);
            r = { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
          } else r = { x: x.im.x1, y: x.im.y1, w: x.im.x2 - x.im.x1, h: x.im.y2 - x.im.y1 };
          if (x.file) {
            const buf = new Uint8Array(await x.file.arrayBuffer());
            const img = x.file.type === 'image/png' ? await doc.embedPng(buf) : await doc.embedJpg(buf);
            const k = Math.min(r.w / img.width, r.h / img.height);
            pg.drawImage(img, { x: r.x + (r.w - img.width * k) / 2, y: r.y + (r.h - img.height * k) / 2, width: img.width * k, height: img.height * k });
          } else {
            pg.pushOperators(pushGraphicsState(), concatTransformationMatrix(r.w, 0, 0, r.h, r.x, r.y), drawObject(PDFName.of(x.im.name)), popGraphicsState());
          }
        }
      }
      imStop();
      peStop();
      await commitPdf(path, await pdfSave(doc), [...Array(doc.getPageCount()).keys()], {}, null);
      toast('Bilder geändert.');
    } catch (err) { toast('Ändern fehlgeschlagen: ' + err.message, 6000); }
  }

  // ---- Einfügen aus der Zwischenablage (Strg+V / Cmd+V): Text wird Textnotiz, Bild wird Bild
  function wrapText(text, fs, maxW) {
    const c = measureTxt.c || (measureTxt.c = document.createElement('canvas').getContext('2d'));
    c.font = `${fs}px ${TXT_FONT}`;
    const out = [];
    for (const para of String(text).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')) {
      let line = '';
      for (const w of para.split(/(\s+)/)) {
        const t = line + w;
        if (line && c.measureText(t.trimEnd()).width > maxW && w.trim()) { out.push(line.trimEnd()); line = w.trimStart(); } else line = t;
      }
      out.push(line.trimEnd());
    }
    while (out.length && !out[out.length - 1]) out.pop();
    return out.join('\n');
  }
  async function pasteText(raw) {
    const fs = S.ttSize || 14;
    if (V.board) {
      const W = boardEl.clientWidth, H = boardEl.clientHeight;
      const text = wrapText(raw, fs, W * 0.55);
      if (text.length > 20000) { toast('Der Text ist zu lang (höchstens 20.000 Zeichen).'); return; }
      const m = measureTxt(text, fs);
      const [wx, wy] = toWorld(Math.max(20, W / 2 - m.bw / 2), Math.max(20, H / 2 - m.bh / 2));
      const st = { id: uid(), p: 0, t: 'txt', c: S.color.tt, fs, pts: [0, 0], text, bw: r2(m.bw), bh: r2(m.bh), o: [wx, wy], z: B.cam.s };
      opAdd(V.path, [st]);
      pushHistory({ t: 'add', strokes: [st] });
      boardRender();
      toast('Text eingefügt – mit dem Lasso verschieben, doppelt tippen zum Ändern.');
      return;
    }
    const P = V.pages[currentPageIndex()];
    if (!P) return;
    const text = wrapText(raw, fs, P.w * 0.62);
    if (text.length > 20000) { toast('Der Text ist zu lang (höchstens 20.000 Zeichen).'); return; }
    const m = measureTxt(text, fs);
    const sc = P.cssW / P.w;
    const vr = viewer.getBoundingClientRect(), pr = P.el.getBoundingClientRect();
    const cy = ((Math.max(pr.top, vr.top) + Math.min(pr.bottom, vr.bottom)) / 2 - pr.top) / sc;
    const x = Math.max(8, (P.w - m.bw) / 2), y = Math.max(8, Math.min(P.h - m.bh - 8, cy - m.bh / 2));
    const st = { id: uid(), p: P.i, t: 'txt', c: S.color.tt, fs, pts: [r2(x), r2(y)], text, bw: r2(m.bw), bh: r2(m.bh) };
    opAdd(V.path, [st]);
    pushHistory({ t: 'add', strokes: [st] });
    drawInk(P);
    S.tool = 'la'; persistTools(); renderToolbar();
    SEL = { P, ids: [st.id] };
    renderSel();
    V.dirty = true;
    toast('Text eingefügt – an die richtige Stelle ziehen. Ändern: Textfeld-Werkzeug (T) und antippen.', 5000);
  }
  document.addEventListener('paste', (e) => {
    if (!V.path || !S.started) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable=true]')) return;
    if (editor || B.ed || document.querySelector('dialog[open]') || !$('#toolsView').hidden || !$('#overview').hidden) return;
    const dt = e.clipboardData;
    if (!dt) return;
    const img = [...dt.items].find((it) => it.kind === 'file' && /^image\//.test(it.type));
    if (img) {
      e.preventDefault();
      const f = img.getAsFile();
      if (V.board) boardAddImage(f); else { IMGDO.mode = 'place'; insertPhoto(f); }
      return;
    }
    const text = dt.getData('text/plain');
    if (!text || !text.trim()) return;
    e.preventDefault();
    pasteText(text);
  });

  // ---- Seitenvorschau als Leiste neben der PDF: ein-/ausblendbar, links/rechts, breiter/schmaler, Seiten ziehen
  const TH = { io: null, cur: -1, upd: new Map(), drag: null };
  // öffentliche Demo: Seitenleiste von Anfang an zeigen (bis der Besucher sie selbst schließt)
  if (document.body.dataset.demo && ls('thumbs') === null) ls('thumbs', true);
  const thOn = () => !!ls('thumbs') && !!V.path && !V.board && !$('#viewer').hidden;
  function thPlace() {
    if (typeof tpRender === 'function') setTimeout(tpRender, 0);
    const bar = $('#thumbBar');
    const on = thOn();
    const side = ls('thSide') === 'left' ? 'l' : 'r';
    const w = Math.max(110, Math.min(380, ls('thW') || 170));
    document.documentElement.style.setProperty('--thw', w + 'px');
    const was = document.body.classList.contains('th-on') && document.body.classList.contains('th-' + side);
    document.body.classList.toggle('th-on', on);
    document.body.classList.toggle('th-l', side === 'l');
    document.body.classList.toggle('th-r', side === 'r');
    bar.hidden = !on;
    $('#thBtn').hidden = !V.path || !!V.board;
    vbSync();
    $('#cmBtn').hidden = !V.path || !!V.board;
    if ($('#cmPanel') && (!V.path || V.board)) $('#cmPanel').hidden = true;
    $('#thBtn').setAttribute('aria-pressed', on ? 'true' : 'false');
    if (!on) { if (was) window.dispatchEvent(new Event('resize')); return; }
    const r = $('#viewer').getBoundingClientRect();
    Object.assign(bar.style, { top: r.top + 'px', height: r.height + 'px', width: w + 'px', left: (side === 'r' ? r.right : r.left - w) + 'px' });
    if (!was) window.dispatchEvent(new Event('resize'));
  }
  function thRender() {
    thPlace();
    const list = $('#thList');
    if (TH.io) TH.io.disconnect();
    list.innerHTML = '';
    TH.cur = -1;
    if (!thOn()) return;
    TH.io = new IntersectionObserver((ens) => {
      for (const en of ens) { if (!en.isIntersecting) continue; TH.io.unobserve(en.target); thDraw(+en.target.dataset.i); }
    }, { root: list, rootMargin: '300px 0px' });
    for (const P of V.pages) {
      const it = document.createElement('div');
      it.className = 'th-item';
      it.dataset.i = P.i;
      it.innerHTML = `<div class="pg" style="aspect-ratio:${P.w} / ${P.h}"></div><span class="n">${P.i + 1}</span>`;
      list.appendChild(it);
      TH.io.observe(it);
    }
    thCurrent();
  }
  async function thDraw(i) {
    const P = V.pages[i];
    const it = $('#thList').querySelector(`.th-item[data-i="${i}"]`);
    if (!P || !it) return;
    const box = it.querySelector('.pg');
    const W = Math.min(Math.max(box.clientWidth, 100) * Math.min(window.devicePixelRatio || 1, 2), 520);
    try { await pgOf(P); } catch (e) { return; }
    const vp = P.pg.getViewport({ scale: W / P.w });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    try { await P.pg.render({ annotationMode: AM, canvasContext: c.getContext('2d'), viewport: vp }).promise; } catch (e) { return; }
    pageStrokes(P.i).forEach((s2) => strokePath(c.getContext('2d'), s2, c.width / P.w));
    if (!it.isConnected) return;
    box.querySelectorAll('canvas').forEach((o) => o.remove());
    box.prepend(c);
  }
  function thCurrent() {
    if (!thOn()) return;
    const i = currentPageIndex();
    if (i === TH.cur) return;
    TH.cur = i;
    const list = $('#thList');
    list.querySelectorAll('.th-item.current').forEach((el) => el.classList.remove('current'));
    const it = list.querySelector(`.th-item[data-i="${i}"]`);
    if (!it) return;
    it.classList.add('current');
    const lr = list.getBoundingClientRect(), ir = it.getBoundingClientRect();
    if (ir.top < lr.top + 30 || ir.bottom > lr.bottom - 30) list.scrollTop += ir.top - lr.top - lr.height / 2 + ir.height / 2;
  }
  // Notizen geändert → Vorschau dieser Seite etwas später neu zeichnen
  function thInk(i) {
    if (!thOn()) return;
    clearTimeout(TH.upd.get(i));
    TH.upd.set(i, setTimeout(() => { TH.upd.delete(i); if (!cur) thDraw(i); }, 1200));
  }
  $('#thBtn').onclick = () => { ls('thumbs', !ls('thumbs')); thRender(); };
  $('#thClose').onclick = () => { ls('thumbs', false); thRender(); };
  $('#thSide').onclick = () => { ls('thSide', ls('thSide') === 'left' ? 'right' : 'left'); document.body.classList.remove('th-on'); thPlace(); };
  // Breite ziehen
  $('#thResize').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX, w0 = ls('thW') || 170, left = ls('thSide') === 'left';
    const mv = (ev) => { ls('thW', Math.max(110, Math.min(380, w0 + (left ? 1 : -1) * (ev.clientX - x0)))); thPlace(); };
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); window.dispatchEvent(new Event('resize')); thRender(); };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
  });
  // Antippen: zur Seite; Ziehen (Stift/Maus sofort, Finger nach kurzem Halten): Seite verschieben
  const thl = $('#thList');
  thl.addEventListener('pointerdown', (e) => {
    const it = e.target.closest('.th-item');
    if (!it || (e.pointerType === 'mouse' && e.button !== 0)) return;
    TH.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, it, armed: e.pointerType !== 'touch', on: false, to: null };
    clearTimeout(TH.lt);
    if (e.pointerType === 'touch') TH.lt = setTimeout(() => { if (TH.drag) { TH.drag.armed = true; it.classList.add('lift'); if (navigator.vibrate) navigator.vibrate(15); } }, 380);
  });
  thl.addEventListener('pointermove', (e) => {
    const d = TH.drag;
    if (!d || e.pointerId !== d.id) return;
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    if (!d.on) {
      if (!d.armed) { if (moved > 10) { clearTimeout(TH.lt); TH.drag = null; } return; }
      if (moved < 7) return;
      d.on = true;
      const r = d.it.getBoundingClientRect();
      d.ghost = d.it.cloneNode(true);
      d.ghost.className = 'th-item th-ghost';
      d.ghost.style.width = r.width + 'px';
      d.dy = e.clientY - r.top; d.dx = e.clientX - r.left;
      document.body.appendChild(d.ghost);
      d.it.classList.add('dragging');
      try { thl.setPointerCapture(e.pointerId); } catch (er) { /* */ }
    }
    e.preventDefault();
    d.ghost.style.left = e.clientX - d.dx + 'px';
    d.ghost.style.top = e.clientY - d.dy + 'px';
    thl.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
    // über der rechten Notizseite: Folie dorthin übernehmen statt umsortieren
    const sp = $('#splitPane');
    const fr = SPLIT.frame && SPLIT.path && isBoard(SPLIT.path) && sp ? SPLIT.frame.getBoundingClientRect() : null;
    d.pane = !!fr && e.clientX >= fr.left && e.clientX <= fr.right && e.clientY >= fr.top && e.clientY <= fr.bottom;
    if (sp) sp.classList.toggle('sp-drop', d.pane);
    if (d.pane) { d.to = null; d.px = e.clientX - fr.left; d.py = e.clientY - fr.top; return; }
    let best = null, bd = Infinity;
    thl.querySelectorAll('.th-item:not(.dragging)').forEach((el) => { const r = el.getBoundingClientRect(); const dd = Math.abs(e.clientY - (r.top + r.height / 2)); if (dd < bd) { bd = dd; best = { el, after: e.clientY > r.top + r.height / 2 }; } });
    if (best) { best.el.classList.add(best.after ? 'drop-after' : 'drop-before'); d.to = +best.el.dataset.i + (best.after ? 1 : 0); }
    const lr = thl.getBoundingClientRect();
    if (e.clientY < lr.top + 50) thl.scrollTop -= 12; else if (e.clientY > lr.bottom - 50) thl.scrollTop += 12;
  }, { passive: false });
  thl.addEventListener('touchmove', (e) => { if (TH.drag && TH.drag.armed) e.preventDefault(); }, { passive: false });
  const thEnd = async (e) => {
    clearTimeout(TH.lt);
    const d = TH.drag;
    if (!d || (e && e.pointerId !== d.id)) return;
    TH.drag = null;
    d.it.classList.remove('lift');
    if (!d.on) { if (e && e.type === 'pointerup' && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10) goToPage(+d.it.dataset.i); return; }
    d.ghost.remove();
    thl.querySelectorAll('.dragging, .drop-before, .drop-after').forEach((el) => el.classList.remove('dragging', 'drop-before', 'drop-after'));
    const from = +d.it.dataset.i;
    if ($('#splitPane')) $('#splitPane').classList.remove('sp-drop');
    if (d.pane) { slideToPane(from, d.px, d.py); return; }
    if (d.to == null || d.to === from || d.to === from + 1) return;
    if (!needOnline('Seiten umsortieren')) return;
    const order = [...Array(V.pages.length).keys()];
    order.splice(from, 1);
    const at = d.to > from ? d.to - 1 : d.to;
    order.splice(at, 0, from);
    // sofort zeigen
    const ref = thl.querySelector(`.th-item[data-i="${d.to}"]`);
    thl.insertBefore(d.it, ref || null);
    thl.querySelectorAll('.th-item .n').forEach((el, k) => { el.textContent = k + 1; });
    d.it.classList.add('saving');
    if (!(await readyToEdit())) { thRender(); return; }
    const keep = thl.scrollTop;
    await pageOp({ kind: 'order', order, target: at, msg: `Seite ${from + 1} ist jetzt Seite ${at + 1}.` });
    thl.scrollTop = keep;
  };
  thl.addEventListener('pointerup', thEnd);
  thl.addEventListener('pointercancel', thEnd);
  window.addEventListener('resize', () => requestAnimationFrame(thPlace));
  if ('ResizeObserver' in window) new ResizeObserver(() => thPlace()).observe($('#viewer'));
  // in die bestehenden Abläufe einhängen
  const updatePageBadge0 = updatePageBadge;
  updatePageBadge = function () { updatePageBadge0(); thCurrent(); };
  const drawInk0 = drawInk;
  drawInk = function (P) { drawInk0(P); if (P) thInk(P.i); };

  // ---- Wissensbasis: Schlagwörter, Merkliste, Verknüpfungen zwischen Seiten
  S.meta = { docs: {}, marks: [] };
  S.tag = '';
  async function metaLoad() {
    try { S.meta = await apiJson('meta'); DB.put('kv', 'meta', S.meta).catch(() => {}); } catch (e) { S.meta = (await DB.get('kv', 'meta')) || S.meta; }
    if (!V.path) renderLibrary();
    markUi();
  }
  const tagsOf = (path) => ((S.meta.docs[path] || {}).tags || []);
  async function metaPost(body) {
    if (!needOnline('Speichern')) return false;
    try { S.meta = await apiJson('meta', { method: 'POST', body }); DB.put('kv', 'meta', S.meta).catch(() => {}); return true; } catch (e) { toast(e.message); return false; }
  }
  async function editTags(path) {
    const all = [...new Set(Object.values(S.meta.docs).flatMap((d) => d.tags || []))].sort((a, b) => a.localeCompare(b, 'de'));
    const v = await askText('Schlagwörter', `Durch Komma getrennt, z. B. „Klausur, Elastizität, WiSe 2026“.${all.length ? ' Bisher verwendet: ' + all.slice(0, 25).join(', ') : ''}`, tagsOf(path).join(', '), 'Speichern');
    if (v === null) return;
    if (await metaPost({ path, tags: v.split(/[,;]/).map((t) => t.trim()).filter(Boolean) })) { toast('Schlagwörter gespeichert.'); if (!V.path) renderLibrary(); }
  }
  // Leiste über der Bibliothek: Merkliste + alle Schlagwörter
  function renderTagBar() {
    const bar = $('#tagBar');
    const counts = new Map();
    const have = new Set((S.library ? S.library.files : []).map((f) => f.path));
    for (const [p, d] of Object.entries(S.meta.docs)) if (have.has(p) || isBoard(p)) for (const t of d.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
    const marks = S.meta.marks.length;
    bar.hidden = S.src !== 'local' || (!counts.size && !marks);
    if (bar.hidden) return;
    const tags = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'de'));
    bar.innerHTML = `<button type="button" class="tag-chip mark${S.tag === '★' ? ' on' : ''}" data-t="★">★ Merkliste <span>${marks}</span></button>` +
      tags.map(([t, n]) => `<button type="button" class="tag-chip${S.tag === t ? ' on' : ''}" data-t="${esc(t)}"># ${esc(t)} <span>${n}</span></button>`).join('');
    bar.onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b) return; S.tag = S.tag === b.dataset.t ? '' : b.dataset.t; renderLibrary(); };
  }
  // Merkliste als Karten
  function renderMarks(wrap) {
    wrap.innerHTML = '';
    if (!S.meta.marks.length) { wrap.innerHTML = '<p class="empty">Noch nichts gemerkt. In einer PDF unten rechts auf ☆ tippen, um die Seite zu merken.</p>'; return; }
    for (const k of S.meta.marks) {
      const f = S.library && S.library.files.find((x) => x.path === k.path);
      const card = document.createElement('div');
      card.className = 'mark-row';
      card.innerHTML = `<button type="button" class="mk-open"><span class="mk-star">★</span><span class="mk-t"></span><span class="mk-d muted small"></span></button>
        <button type="button" class="icon-btn" data-m="ren" aria-label="Umbenennen">✎</button><button type="button" class="icon-btn" data-m="del" aria-label="Entfernen">✕</button>`;
      card.querySelector('.mk-t').textContent = k.title || `${stem(k.path)} – Seite ${k.page + 1}`;
      card.querySelector('.mk-d').textContent = `${k.path.startsWith('@nb/') ? 'Notizbuch · ' + k.path.slice(4).replace(/\//g, ' › ') : (f ? f.path : k.path + ' (nicht mehr vorhanden)')} · Seite ${k.page + 1}`;
      card.querySelector('.mk-open').onclick = () => followLink({ path: k.path, pg: k.page });
      card.querySelector('[data-m=ren]').onclick = async () => { const t = await askText('Merkliste', 'Bezeichnung', k.title || '', 'Speichern'); if (t !== null && await metaPost({ mark: { path: k.path, page: k.page, title: t } })) renderLibrary(); };
      card.querySelector('[data-m=del]').onclick = async () => { if (await metaPost({ mark: { path: k.path, page: k.page, remove: 1 } })) renderLibrary(); };
      wrap.appendChild(card);
    }
  }
  // zu einer Seite springen (auch in eine andere PDF)
  async function followLink(ln) {
    const path = ln.path;
    if (!isBoard(path) && S.library && !S.library.files.some((f) => f.path === path)) { toast('Diese PDF gibt es nicht mehr (verschoben oder gelöscht?).'); return; }
    if (isBoard(path) && ln.id) B.focus = ln.id;
    if (V.path !== path) { openDoc(path); if (isBoard(path)) return; if (!(await waitDoc(path))) return; }
    if (isBoard(path)) { boardFocus(); return; }
    goToPage(Math.max(0, Math.min(V.pages.length - 1, ln.pg || 0)));
  }
  // Stern unten rechts: Seite merken
  function markUi() {
    const b = $('#markBtn');
    const on = !!V.path && !V.board && !$('#viewer').hidden && !document.body.classList.contains('focus') && !document.body.classList.contains('present');
    b.hidden = !on;
    if (!on) return;
    const i = currentPageIndex();
    const marked = S.meta.marks.some((k) => k.path === V.path && k.page === i);
    b.classList.toggle('on', marked);
    b.setAttribute('aria-pressed', marked ? 'true' : 'false');
    b.title = marked ? 'Seite ist auf der Merkliste – antippen zum Entfernen' : 'Diese Seite auf die Merkliste setzen';
    const fs = $('#fsBtn').getBoundingClientRect();
    if (fs.width) Object.assign(b.style, { left: fs.left + (fs.width - 44) / 2 + 'px', top: fs.top - 54 + 'px' });
  }
  $('#markBtn').onclick = async () => {
    const i = currentPageIndex();
    const marked = S.meta.marks.some((k) => k.path === V.path && k.page === i);
    if (await metaPost({ mark: { path: V.path, page: i, remove: marked ? 1 : 0, title: '' } })) { toast(marked ? 'Von der Merkliste entfernt.' : `Seite ${i + 1} gemerkt – zu finden in der Bibliothek unter „★ Merkliste“.`); markUi(); }
  };
  const updatePageBadge1 = updatePageBadge;
  updatePageBadge = function () { updatePageBadge1(); markUi(); };
  window.addEventListener('resize', () => requestAnimationFrame(markUi));
  // Ziel einer Verknüpfung wählen: Seite einer PDF oder eine Notizseite
  async function pickLinkTarget() {
    if (!S.boards) await loadBoards();
    const files = ((S.library && S.library.files) || []).map((f) => f.path).filter((p) => /\.pdf$/i.test(p) && p !== V.path).sort((a, b) => a.localeCompare(b));
    const pages = [];
    for (const nb of S.boards || []) for (const sec of nb.sections) for (const pg of sec.pages) if (pg.path !== V.path) pages.push([pg.path, `${nb.name} › ${sec.name} › ${pg.title}`]);
    const last = ls('lnLast');
    return new Promise((res) => {
      const d = document.createElement('dialog');
      d.className = 'dlg set-dlg tonb-dlg';
      d.innerHTML = `<form method="dialog"><h2>Verknüpfung einfügen</h2>
        <p class="muted small">Die Verknüpfung erscheint als blaue Notiz mit ↗ – antippen öffnet das Ziel.</p>
        <div class="set-row"><span>Ziel</span><select id="lkT">${files.length ? `<optgroup label="PDFs">${files.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}</optgroup>` : ''}${pages.length ? `<optgroup label="Notizbücher">${pages.map(([p, l]) => `<option value="${esc(p)}">${esc(l)}</option>`).join('')}</optgroup>` : ''}</select></div>
        <div class="set-row" id="lkPgRow"><span>Seite</span><input id="lkPg" type="number" min="1" value="1"></div>
        <div class="set-row"><span>Beschriftung</span><input id="lkL" type="text"></div>
        <div class="dlg-actions"><button type="submit" value="" class="btn">Abbrechen</button><button type="submit" value="ok" class="btn primary">Einfügen</button></div></form>`;
      document.body.appendChild(d);
      const q = (x) => d.querySelector(x);
      if (last && [...q('#lkT').options].some((o) => o.value === last)) q('#lkT').value = last;
      const sync = () => { const t = q('#lkT').value, b = isBoard(t); q('#lkPgRow').hidden = b; q('#lkL').value = b ? '→ ' + docTitle(t) : `→ ${stem(t)}, S. ${Math.max(1, +q('#lkPg').value || 1)}`; };
      q('#lkT').onchange = sync; q('#lkPg').oninput = sync; sync();
      d.addEventListener('close', () => {
        const t = q('#lkT').value, label = q('#lkL').value.trim();
        d.remove();
        if (d.returnValue !== 'ok' || !t || !label) { res(null); return; }
        ls('lnLast', t);
        res({ path: t, pg: isBoard(t) ? 0 : Math.max(0, (+q('#lkPg').value || 1) - 1), label });
      }, { once: true });
      d.showModal();
    });
  }
  // Notizseite: Verknüpfung in die Mitte der Ansicht setzen
  async function boardInsertLink() {
    if (!V.board) return;
    const t = await pickLinkTarget();
    if (!t) return;
    const fs = Math.round((S.ttSize || 14) * 1.3), m = measureTxt(t.label, fs);
    const [wx, wy] = toWorld(B.w / 2 - m.bw / 2, B.h / 2 - m.bh / 2);
    const st = { id: uid(), p: 0, t: 'txt', c: '#1E4FB8', fs, pts: [0, 0], text: t.label, bw: r2(m.bw), bh: r2(m.bh), o: [wx, wy], z: B.cam.s, ln: { path: t.path, pg: t.pg } };
    opAdd(V.path, [st]);
    pushHistory({ t: 'add', strokes: [st] });
    boardRender();
    toast('Verknüpfung eingefügt. Mit dem Lasso lässt sie sich verschieben, ↗ öffnet das Ziel.', 6000);
  }
  // Verknüpfung einfügen: Textnotiz mit Ziel, antippbar
  async function insertLink() {
    if (!V.path) return;
    if (V.board) { boardInsertLink(); return; }
    const t = await pickLinkTarget();
    if (!t) return;
    const target = t.path, n = t.pg + 1, label = t.label;
    const P = V.pages[currentPageIndex()];
    const fs = S.ttSize || 14;
    const m = measureTxt(label, fs);
    const sc = P.cssW / P.w;
    const vr = viewer.getBoundingClientRect(), pr = P.el.getBoundingClientRect();
    const cy = ((Math.max(pr.top, vr.top) + Math.min(pr.bottom, vr.bottom)) / 2 - pr.top) / sc;
    const st = { id: uid(), p: P.i, t: 'txt', c: '#1E4FB8', fs, pts: [r2(Math.max(8, (P.w - m.bw) / 2)), r2(cy)], text: label, bw: r2(m.bw), bh: r2(m.bh), ln: { path: target, pg: n - 1 } };
    opAdd(V.path, [st]);
    pushHistory({ t: 'add', strokes: [st] });
    drawInk(P);
    S.tool = 'la'; persistTools(); renderToolbar();
    SEL = { P, ids: [st.id] };
    renderSel();
    toast('Verknüpfung eingefügt – an die gewünschte Stelle ziehen. Antippen von ↗ springt zum Ziel.', 6000);
  }
  // antippbare ↗-Knöpfe an Verknüpfungen
  function linkButtons(P) {
    if (!P || !P.el) return;
    P.el.querySelectorAll('.ln-btn').forEach((el) => el.remove());
    for (const s2 of pageStrokes(P.i)) {
      if (s2.t !== 'txt' || !s2.ln) continue;
      const b = bbox(s2);
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'ln-btn';
      el.title = 'Zu „' + stem(s2.ln.path) + '“, Seite ' + (s2.ln.pg + 1);
      el.textContent = '↗';
      el.style.cssText = `left:calc(${(b[2] / P.w) * 100}% + 4px);top:calc(${(b[1] / P.h) * 100}% - 4px)`;
      el.onclick = (e) => { e.stopPropagation(); followLink(s2.ln); };
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      P.el.appendChild(el);
    }
  }
  const drawInk1 = drawInk;
  drawInk = function (P) { drawInk1(P); linkButtons(P); };
  async function showBacklinks() {
    if (!V.path) return;
    let links = [];
    try { links = (await apiJson('backlinks', { params: { path: V.path } })).links; } catch (e) { toast(e.message); return; }
    const box = $('#olList');
    $('#olDlg').querySelector('h2').textContent = V.board ? 'Verweise auf diese Notizseite' : 'Verweise auf diese PDF';
    $('#olAdd').hidden = true; $('#olSave').hidden = true;
    $('#olMsg').textContent = links.length ? '' : 'Bisher verweist keine andere Seite hierher. (Verknüpfungen legst du über „…“ → „Verknüpfung … einfügen“ an.)';
    box.innerHTML = '';
    for (const l of links) {
      const row = document.createElement('div');
      row.className = 'ol-row';
      row.innerHTML = '<button type="button" class="ol-go"><span class="ol-t"></span><span class="ol-p muted small"></span></button>';
      row.querySelector('.ol-t').textContent = l.from.startsWith('@nb/') ? 'Notizbuch: ' + l.from.slice(4).replace(/\//g, ' › ') : stem(l.from) + ' – Seite ' + (l.page + 1);
      row.querySelector('.ol-p').textContent = (l.text ? l.text.slice(0, 60) : l.img ? 'übernommene Folie' : '') + (V.board ? '' : ' → S. ' + (l.pg + 1));
      row.querySelector('.ol-go').onclick = () => { $('#olDlg').close(); followLink({ path: l.from, pg: l.page, id: l.id }); };
      box.appendChild(row);
    }
    $('#olDlg').addEventListener('close', () => { $('#olDlg').querySelector('h2').textContent = 'Lesezeichen'; $('#olAdd').hidden = false; }, { once: true });
    $('#olDlg').showModal();
  }
  $('#menu').addEventListener('click', (e) => {
    const a = e.target.dataset && e.target.dataset.act;
    if (!a || !V.path) return;
    if (a === 'tags') editTags(V.path);
    if (a === 'link') insertLink();
    if (a === 'backlinks') showBacklinks();
  });

  // ---- Modi am Balken unten zusammenführen
  const redactApply = $('#peApply').onclick;
  $('#peApply').onclick = () => (FM.on ? fmSave() : IM.on ? imApply() : PE.mode === 'fbuild' ? fbSave() : redactApply());
  const peStop0 = peStop;
  peStop = function () { peStop0(); if (FM.on) fmStop(); if (IM.on) imStop(); FB.list = []; document.querySelectorAll('.fb-box').forEach((el) => el.remove()); $('#peExtra').innerHTML = ''; $('#peApply').textContent = 'Schwärzen anwenden'; };
  $('#peDone').onclick = () => peStop();
  const peStart0 = peStart;
  peStart = function (mode) {
    if (FM.on) fmStop();
    if (IM.on) imStop();
    peStart0(mode === 'fbuild' ? 'redact' : mode);
    if (mode === 'fbuild' && PE.mode) {
      PE.mode = 'fbuild';
      document.body.classList.remove('pe-redact');
      document.body.classList.add('pe-fbuild');
      $('#peApply').hidden = false;
      $('#peApply').textContent = 'Formular speichern';
      FB.list = [];
      document.querySelectorAll('.pe-rect').forEach((el) => el.remove());
      fbDraw();
    }
  };

  // ---- Export: Excel und PowerPoint
  async function toXlsx() {
    const path = V.path;
    const { zipSync, strToU8 } = fflate;
    const pdf = pdfCache.get(path).pdf;
    const sheets = [];
    const colName = (k) => { let s2 = ''; k++; while (k) { const m = (k - 1) % 26; s2 = String.fromCharCode(65 + m) + s2; k = Math.floor((k - 1) / 26); } return s2; };
    const numVal = (t) => { const x = t.replace(/\s/g, ''); if (/^-?\d{1,3}(\.\d{3})*(,\d+)?%?$|^-?\d+(,\d+)?%?$/.test(x)) { const v = parseFloat(x.replace(/\./g, '').replace(',', '.').replace('%', '')); return x.endsWith('%') ? v / 100 : v; } if (/^-?\d+\.\d+$/.test(x)) return parseFloat(x); return null; };
    for (let i = 0; i < pdf.numPages; i++) {
      $('#cvMsg').textContent = `Seite ${i + 1} von ${pdf.numPages} …`;
      const pg = await pdf.getPage(i + 1);
      const vp = pg.getViewport({ scale: 1 });
      const tc = await pg.getTextContent();
      // Zellen: zusammenhängende Textstücke einer Zeile; Spalten: Anfangspositionen über die ganze Seite gebündelt
      const rows = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
        const fs = Math.hypot(it.transform[2], it.transform[3]) || 10;
        let R = rows.find((r) => Math.abs(r.y - y) < fs * 0.5);
        if (!R) { R = { y, cells: [] }; rows.push(R); }
        const last = R.cells[R.cells.length - 1];
        R.cells.sort((a, b) => a.x - b.x);
        const near = R.cells.find((c) => x >= c.x && x - c.x2 < fs * 1.2 && x >= c.x2 - fs * 0.3);
        if (near) { near.t += (x - near.x2 > fs * 0.15 ? ' ' : '') + it.str; near.x2 = x + it.width; } else R.cells.push({ x, x2: x + it.width, t: it.str });
        void last;
      }
      rows.sort((a, b) => a.y - b.y);
      // Spalten = überlappende Bereiche der Zellen aus mehrspaltigen Zeilen (klappt auch bei rechtsbündigen Zahlen)
      const iv = rows.filter((r) => r.cells.length > 1).flatMap((r) => r.cells.map((c) => [c.x, c.x2])).sort((a, b) => a[0] - b[0]);
      const anchors = [];
      for (const [x1, x2] of iv) { const l = anchors[anchors.length - 1]; if (l && x1 <= l.x2 + 2) l.x2 = Math.max(l.x2, x2); else anchors.push({ x: x1, x2 }); }
      if (!anchors.length) anchors.push({ x: 0, x2: 1e6 });
      const colOf = (c) => { let best = 0, bo = -Infinity; anchors.forEach((a, k) => { const o = Math.min(a.x2, c.x2) - Math.max(a.x, c.x); if (o > bo) { bo = o; best = k; } }); return best; };
      let xml = '';
      rows.forEach((r, ri) => {
        const used = new Map();
        r.cells.forEach((c) => { let k = colOf(c); while (used.has(k)) k++; used.set(k, c.t.trim()); });
        let cells = '';
        [...used.entries()].sort((a, b) => a[0] - b[0]).forEach(([k, t]) => {
          const ref = colName(k) + (ri + 1);
          const v = numVal(t);
          cells += v != null ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(t)}</t></is></c>`;
        });
        xml += `<row r="${ri + 1}">${cells}</row>`;
      });
      sheets.push(xml);
    }
    const files = {
      '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + sheets.map((_, k) => `<Override PartName="/xl/worksheets/sheet${k + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>'),
      '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
      'xl/workbook.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map((_, k) => `<sheet name="Seite ${k + 1}" sheetId="${k + 1}" r:id="rS${k + 1}"/>`).join('') + '</sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((_, k) => `<Relationship Id="rS${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${k + 1}.xml"/>`).join('') + '</Relationships>'),
    };
    sheets.forEach((x, k) => { files[`xl/worksheets/sheet${k + 1}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${x}</sheetData></worksheet>`); });
    downloadBlob(new Blob([zipSync(files, { level: 6 })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), stem(path) + '.xlsx');
  }
  let pptxLib = null;
  async function loadPptx() {
    if (window.PptxGenJS) return window.PptxGenJS;
    if (!pptxLib) pptxLib = new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'vendor/pptxgen.bundle.js?v=' + VERSION; sc.onload = () => res(window.PptxGenJS); sc.onerror = () => rej(new Error('PowerPoint-Baustein konnte nicht geladen werden.')); document.head.appendChild(sc); });
    return pptxLib;
  }
  async function toPptx() {
    const path = V.path;
    const Pptx = await loadPptx();
    const bytes = await annotatedBytesFor(path);
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
    try {
      const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
      const W = 13.333, H = Math.round(W * first.height / first.width * 1000) / 1000;
      const pres = new Pptx();
      pres.defineLayout({ name: 'PDF', width: W, height: H });
      pres.layout = 'PDF';
      for (let i = 0; i < pdf.numPages; i++) {
        $('#cvMsg').textContent = `Folie ${i + 1} von ${pdf.numPages} …`;
        const { c, pg } = await renderPageCanvas(pdf, i, 170);
        const vp = pg.getViewport({ scale: 1 });
        const data = c.toDataURL('image/jpeg', 0.88);
        c.width = c.height = 0;
        const k = Math.min(W / vp.width, H / vp.height);
        const sl = pres.addSlide();
        sl.addImage({ data, x: (W - vp.width * k) / 2, y: (H - vp.height * k) / 2, w: vp.width * k, h: vp.height * k });
        const { paras } = await pageParas(pg);
        if (paras.length) sl.addNotes(paras.map((p2) => p2.text).join('\n'));
      }
      const blob = await pres.write({ outputType: 'blob' });
      downloadBlob(blob, stem(path) + '.pptx');
    } finally { pdf.destroy(); }
  }

  // ---- Vergleichen
  async function compareOpen() {
    track('tool', 'Vergleichen');
    if (!V.path) return;
    const box = $('#cmpVers');
    box.innerHTML = '<p class="muted small">Frühere Fassungen werden gesucht …</p>';
    $('#cmpDlg').showModal();
    let vers = [];
    try { vers = (await apiJson('versions', { params: { path: V.path } })).versions; } catch (e) { /* offline */ }
    box.innerHTML = vers.length ? '' : '<p class="muted small">Von dieser PDF gibt es noch keine früheren Fassungen (sie entstehen bei jeder Änderung).</p>';
    vers.forEach((v) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick-item';
      b.innerHTML = '<span class="pn"></span><span class="pf muted small"></span>';
      b.querySelector('.pn').textContent = 'Fassung vom ' + new Date(v.time * 1000).toLocaleString(LOC, { dateStyle: 'medium', timeStyle: 'short' });
      b.querySelector('.pf').textContent = (v.kind ? v.kind + ' · ' : '') + fmtSize(v.size);
      b.onclick = async () => {
        $('#cmpDlg').close();
        try {
          const r = await api('version', { params: { path: V.path, id: v.id } });
          compareRun(new Uint8Array(await r.arrayBuffer()), b.querySelector('.pn').textContent, v);
        } catch (err) { toast(err.message); }
      };
      box.appendChild(b);
    });
    $('#cmpOther').onclick = async () => {
      $('#cmpDlg').close();
      const r = await pickPdfs({ title: 'Vergleichen mit …', text: 'Eine PDF antippen.', go: 'Vergleichen', withName: false, exclude: V.path });
      if (!r || !r.files.length) return;
      try { compareRun(await entryBytes(r.files[0]), typeof r.files[0] === 'string' ? stem(r.files[0]) : r.files[0].file.name, null); } catch (err) { toast(err.message); }
    };
  }
  // Wortweiser Vergleich (kürzeste Bearbeitungsfolge)
  function wordDiff(a, b) {
    const n = a.length, m = b.length;
    if (n * m > 4e6) return [{ t: '-', w: a.join(' ') }, { t: '+', w: b.join(' ') }];
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = [];
    let i = 0, j = 0;
    const push = (t, w) => { const l = out[out.length - 1]; if (l && l.t === t) l.w += ' ' + w; else out.push({ t, w }); };
    while (i < n && j < m) { if (a[i] === b[j]) { push('=', a[i]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) push('-', a[i++]); else push('+', b[j++]); }
    while (i < n) push('-', a[i++]);
    while (j < m) push('+', b[j++]);
    return out;
  }
  async function compareRun(otherBytes, label, ver) {
    const path = V.path;
    const view = $('#cmpView');
    const body = $('#cmpBody');
    body.innerHTML = '<p class="empty">Wird verglichen …</p>';
    $('#cmpSum').textContent = '';
    view.hidden = false;
    $('#cmpRestore').hidden = !ver;
    $('#cmpRestore').onclick = async () => {
      if (!(await confirmDlg('Frühere Fassung wiederherstellen?', 'Die jetzige Fassung wird vorher gesichert – du kannst also jederzeit zurück.', 'Wiederherstellen'))) return;
      try {
        await flush();
        const res = await apiJson('verrestore', { method: 'POST', body: { path, id: ver.id } });
        view.hidden = true;
        const e = pdfCache.get(path);
        if (e) { e.pdf.destroy(); pdfCache.delete(path); }
        await DB.del('pdfs', path);
        const meta = fileMeta(path);
        if (meta) { meta.mtime = res.mtime; meta.size = res.size; meta.thumb = false; }
        V.path = null;
        await showDoc(path, true);
        toast('Frühere Fassung wiederhergestellt.');
      } catch (err) { toast(err.message, 6000); }
    };
    $('#cmpClose').onclick = () => { view.hidden = true; body.innerHTML = ''; };
    const A = await pdfjsLib.getDocument({ data: otherBytes.slice(0), isEvalSupported: false }).promise;
    const B = pdfCache.get(path).pdf;
    body.innerHTML = '';
    const n = Math.max(A.numPages, B.numPages);
    let changedPages = 0, changes = 0;
    const words = async (pdf, i) => (i < pdf.numPages ? (await pageParas(await pdf.getPage(i + 1))).paras.map((p) => p.text).join(' ').split(/\s+/).filter(Boolean) : []);
    for (let i = 0; i < n; i++) {
      if (view.hidden) break;
      $('#cmpSum').textContent = `Seite ${i + 1} von ${n} …`;
      const row = document.createElement('section');
      row.className = 'cmp-row';
      const d = wordDiff(await words(A, i), await words(B, i));
      const textChanged = d.some((x) => x.t !== '=');
      // Bilder beider Seiten im gleichen Maßstab, Unterschiede rot markieren
      const cv = [];
      for (const pdf of [A, B]) {
        if (i >= pdf.numPages) { cv.push(null); continue; }
        const pg = await pdf.getPage(i + 1);
        const vp0 = pg.getViewport({ scale: 1 });
        const vp = pg.getViewport({ scale: 520 / vp0.width });
        const c = document.createElement('canvas');
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await pg.render({ annotationMode: AM, canvasContext: ctx, viewport: vp }).promise;
        cv.push(c);
      }
      let pixChanged = false;
      if (cv[0] && cv[1]) {
        const w = Math.min(cv[0].width, cv[1].width), h = Math.min(cv[0].height, cv[1].height);
        const da = cv[0].getContext('2d').getImageData(0, 0, w, h).data, db = cv[1].getContext('2d').getImageData(0, 0, w, h).data;
        const G = 8, marks = [];
        for (let y = 0; y < h; y += G) for (let x = 0; x < w; x += G) {
          let diff = 0;
          for (let yy = y; yy < Math.min(h, y + G); yy += 2) for (let xx = x; xx < Math.min(w, x + G); xx += 2) { const o = (yy * w + xx) * 4; diff += Math.abs(da[o] - db[o]) + Math.abs(da[o + 1] - db[o + 1]) + Math.abs(da[o + 2] - db[o + 2]); }
          if (diff > 600) marks.push([x, y]);
        }
        pixChanged = marks.length > 0;
        for (const c of cv) { const ctx = c.getContext('2d'); ctx.fillStyle = 'rgba(229,72,77,.28)'; marks.forEach(([x, y]) => ctx.fillRect(x, y, G, G)); }
      }
      const changed = textChanged || pixChanged || !cv[0] || !cv[1];
      if (changed) changedPages++;
      changes += d.filter((x) => x.t !== '=').length;
      row.innerHTML = `<h3 class="cmp-h">Seite ${i + 1} <span class="muted small">${!cv[0] ? 'nur in der jetzigen Fassung' : !cv[1] ? 'nur in der anderen Fassung' : changed ? 'geändert' : 'gleich'}</span></h3><div class="cmp-pair"><figure><figcaption class="muted small"></figcaption></figure><figure><figcaption class="muted small">Jetzt: ${xmlEsc(stem(path))}</figcaption></figure></div><div class="cmp-text"></div>`;
      row.querySelector('figcaption').textContent = label;
      const figs = row.querySelectorAll('figure');
      cv.forEach((c, k) => { if (c) figs[k].prepend(c); });
      if (textChanged) {
        const t = row.querySelector('.cmp-text');
        d.forEach((x) => {
          const sp = document.createElement('span');
          if (x.t === '=') { const w = x.w.split(' '); sp.textContent = (w.length > 16 ? w.slice(0, 6).join(' ') + ' … ' + w.slice(-6).join(' ') : x.w) + ' '; sp.className = 'muted'; } else { sp.textContent = x.w + ' '; sp.className = x.t === '+' ? 'cmp-add' : 'cmp-del'; }
          t.appendChild(sp);
        });
      }
      if (!changed) row.classList.add('same');
      body.appendChild(row);
    }
    A.destroy();
    $('#cmpSum').textContent = changedPages ? `${changedPages} von ${n} Seiten unterscheiden sich (${changes} Textstellen). Rot markiert: Unterschiede im Bild; grün = neu, durchgestrichen = entfernt.` : 'Keine Unterschiede gefunden.';
  }

  // Export-Knöpfe ergänzen
  $('#cvXlsx').onclick = cvRun(toXlsx);
  $('#cvPptx').onclick = cvRun(toPptx);
  $('#sigReset').onclick = () => { $('#sigDlg').close(); sigReset(); };

  // ------------------------------------------------------------------ Kurzbefehl, Sicherung
  $('#btnShortcut').onclick = async () => {
    $('#scUrl').textContent = location.origin + location.pathname.replace(/[^/]*$/, '') + 'api.php?a=upload';
    $('#scToken').value = '…';
    $('#scDlg').showModal();
    try { $('#scToken').value = (await apiJson('token')).token; } catch (e) { $('#scToken').value = e.offline ? 'Keine Verbindung' : e.message; }
  };
  $('#scRenew').onclick = async () => {
    if (!(await confirmDlg('Neuen Schlüssel erzeugen?', 'Der bisherige Kurzbefehl funktioniert danach erst wieder, wenn du dort den neuen Schlüssel einträgst.', 'Erzeugen'))) return;
    try { $('#scToken').value = (await apiJson('token', { method: 'POST' })).token; toast('Neuer Schlüssel erzeugt.'); } catch (e) { toast(e.message); }
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    const inp = document.getElementById(b.dataset.copy);
    const done = () => toast('Kopiert.');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(inp.value).then(done, () => { inp.select(); });
    else { inp.select(); document.execCommand('copy'); done(); }
  });
  $('#btnBackup').onclick = () => { $('#bkMsg').textContent = ''; updateShrinkUi(); devUi(); nbUi(); afUi(); $('#bkDlg').showModal(); };
  // ---- Sicherung in Nextcloud
  const NB = { running: false };
  function nbShow(r) {
    $('#nbAuto').checked = !!r.auto;
    $('#nbAuto').disabled = !r.ncOn;
    $('#nbNow').disabled = !r.ncOn || NB.running;
    $('#nbCheck').disabled = $('#nbRestore').disabled = !r.ncOn;
    $('#nbInfo').textContent = !r.ncOn ? 'Zuerst Nextcloud verbinden (unten in der Bibliothek „Nextcloud“).'
      : (r.last ? 'Letzte Sicherung: ' + new Date(r.last * 1000).toLocaleString(LOC, { dateStyle: 'medium', timeStyle: 'short' }) + ' – ' + r.lastInfo : 'Noch keine Sicherung.') + (r.lastError ? ' · Problem: ' + r.lastError : '');
  }
  // ---- Warnung oben, wenn die nächtliche Sicherung nach Nextcloud hängt oder Fehler hat
  async function backupWatch() {
    if (LOCAL || !S.started || navigator.onLine === false) return;
    try {
      const r = await apiJson('ncbackup');
      const b = $('#bkWarn');
      if (!r.ncOn || !r.auto) { b.hidden = true; return; }
      const days = r.last ? (Date.now() / 1000 - r.last) / 86400 : 99;
      const bad = !!r.lastError || days > 3;
      b.hidden = !bad;
      if (bad) {
        $('#bkWarnText').textContent = r.lastError ? 'Sicherung: Problem' : `Sicherung: ${r.last ? Math.floor(days) + ' Tage alt' : 'noch nie'}`;
        b.title = (r.lastError ? 'Letzte Sicherung meldete: ' + r.lastError : r.last ? `Die letzte Sicherung nach Nextcloud ist ${Math.floor(days)} Tage her – läuft der nächtliche Auftrag (cron.php)?` : 'Es gab noch keine Sicherung nach Nextcloud.') + ' Antippen für Einzelheiten.';
        track('err', r.lastError ? 'Sicherung meldet Fehler' : 'Sicherung veraltet', null, r.lastError || `${Math.floor(days)} Tage`);
      }
    } catch (e) { /* offline */ }
  }
  $('#bkWarn').onclick = () => { showLibrary(); $('#btnBackup').click(); setTimeout(() => { const el = $('#nbInfo'); if (el) el.scrollIntoView({ block: 'center' }); }, 200); };

  // ---- Server-Update per Knopfdruck (Paket kommt automatisch von GitHub)
  async function srvUpdCheck() {
    if (LOCAL || !S.started || navigator.onLine === false) return;
    try {
      const r = await apiJson('srvupdate');
      const b = $('#srvUpd');
      b.hidden = !r.available;
      if (r.available) { $('#srvUpdText').textContent = `Server-Update ${r.latest}`; S.srvUpd = r; }
    } catch (e) { /* älterer Server */ }
  }
  $('#srvUpd').onclick = async () => {
    const r = S.srvUpd || {};
    if (!(await confirmDlg(`Server auf Version ${r.latest} bringen?`, `Jetzt: ${r.current}. Neu: ${r.latest}${r.notes ? ' – ' + r.notes : ''}\n\nDie jetzige Fassung wird vorher gesichert. Ihre PDFs, Notizen und Einstellungen bleiben unberührt. Danach lädt die Seite neu.`, 'Jetzt einspielen'))) return;
    const b = $('#srvUpd');
    b.disabled = true; $('#srvUpdText').textContent = 'Wird eingespielt …';
    try {
      const res = await apiJson('srvupdate', { method: 'POST', body: {} });
      track('tool', 'Server-Update eingespielt');
      toast(`Server ist jetzt auf Version ${res.version}. Die Seite lädt neu …`, 6000);
      setTimeout(() => location.reload(), 1500);
    } catch (e) {
      b.disabled = false; $('#srvUpdText').textContent = `Server-Update ${r.latest}`;
      toast('Server-Update nicht möglich: ' + e.message, 9000);
    }
  };
  setInterval(() => { srvUpdCheck(); backupWatch(); }, 6 * 3600 * 1000);

  // Sicherung prüfen: liegt jede Datei vom Server vollständig in Nextcloud?
  $('#nbCheck').onclick = async () => {
    const info = $('#nbCheckInfo');
    info.hidden = false; info.textContent = 'Die Sicherung in Nextcloud wird geprüft …';
    $('#nbCheck').disabled = true;
    try {
      const r = await apiJson('ncbverify');
      if (r.error) { info.textContent = 'Prüfen nicht möglich: ' + r.error; return; }
      const bad = r.missing + r.differ;
      info.innerHTML = (bad === 0 ? '✅ <b>Die Sicherung ist vollständig.</b> ' : `⚠️ <b>${bad} von ${r.total} Dateien sind noch nicht (oder nicht aktuell) gesichert.</b> `)
        + esc(`Geprüft: ${r.what}. In Nextcloud liegen ${r.remote} Dateien.`)
        + (bad ? esc(` Beispiele: ${r.sample.join(', ')}. „Jetzt sichern“ holt das nach.`) : '')
        + (r.partial ? esc(' Hinweis: ' + r.partial) : '');
      track('tool', 'Sicherung prüfen');
    } catch (e) { info.textContent = 'Prüfen nicht möglich: ' + e.message; } finally { $('#nbCheck').disabled = false; }
  };
  // Wiederherstellen: holt nur fehlende Dateien aus der Sicherung, überschreibt nichts
  $('#nbRestore').onclick = async () => {
    if (!(await confirmDlg('Aus der Sicherung wiederherstellen?', 'Es werden nur Dateien aus Nextcloud geholt, die hier auf dem Server FEHLEN – z. B. nach einem Serverumzug oder versehentlichem Löschen. Vorhandene PDFs und Notizen werden nicht überschrieben.', 'Wiederherstellen'))) return;
    const info = $('#nbCheckInfo');
    info.hidden = false;
    $('#nbRestore').disabled = true;
    let total = 0;
    try {
      for (let k = 0; k < 200; k++) {
        info.textContent = `Wird wiederhergestellt … ${total} Dateien geholt`;
        const r = await apiJson('ncbrestore', { method: 'POST', body: {} });
        if (r.busy) { await new Promise((res) => setTimeout(res, 3000)); continue; }
        if (r.error && !r.done) { info.textContent = 'Wiederherstellen nicht möglich: ' + r.error; break; }
        total += r.done || 0;
        if (!r.left || !r.done) { info.textContent = total ? `Fertig: ${total} Dateien aus der Sicherung wiederhergestellt.` + (r.left ? ` ${r.left} ließen sich nicht holen (${r.error}).` : '') : 'Es fehlt nichts – alles, was in der Sicherung liegt, ist auch hier vorhanden.'; break; }
      }
      track('tool', 'Sicherung wiederherstellen');
      if (total) loadLibrary();
    } catch (e) { info.textContent = 'Wiederherstellen nicht möglich: ' + e.message; } finally { $('#nbRestore').disabled = false; }
  };
  // ---- zweiter Faktor (TOTP)
  async function afUi() {
    $('#afSetup').hidden = true; $('#afCodes').hidden = true;
    try {
      const r = await apiJson('auth_status');
      $('#afInfo').innerHTML = r.on ? `<b>Zweiter Faktor ist eingeschaltet.</b> Noch ${r.recoveryLeft} unbenutzte Notfall-Codes.` : 'Zweiter Faktor ist aus – Anmeldung nur mit Passwort.';
      $('#afOn').hidden = r.on; $('#afOff').hidden = !r.on;
    } catch (e) { $('#afInfo').textContent = e.offline ? 'Offline.' : e.message; }
  }
  $('#afOn').onclick = async () => {
    try {
      const r = await apiJson('totp_setup', { method: 'POST', body: {} });
      const qr = qrcode(0, 'M'); qr.addData(r.url); qr.make();
      $('#afQr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
      $('#afSecret').textContent = r.secret.replace(/(.{4})/g, '$1 ').trim();
      $('#afSetup').hidden = false; $('#afOn').hidden = true; $('#afCode').value = '';
      setTimeout(() => $('#afCode').focus(), 50);
    } catch (e) { toast(e.message); }
  };
  $('#afConfirm').onclick = async () => {
    try {
      const r = await apiJson('totp_enable', { method: 'POST', body: { code: $('#afCode').value } });
      $('#afSetup').hidden = true;
      $('#afList').textContent = r.recovery.join('\n');
      $('#afCodes').hidden = false;
      $('#afInfo').innerHTML = '<b>Zweiter Faktor ist eingeschaltet.</b>';
      $('#afOff').hidden = false;
      toast('Zweiter Faktor eingeschaltet.');
    } catch (e) { toast(e.message); }
  };
  $('#afCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#afConfirm').click(); } });
  $('#afCopy').onclick = () => { navigator.clipboard.writeText('PDF-Stift Notfall-Codes\n' + $('#afList').textContent).then(() => toast('Kopiert.'), () => toast('Kopieren ging nicht – bitte abschreiben.')); };
  $('#afOff').onclick = async () => {
    const c = await askText('Zweiten Faktor ausschalten', 'Zur Bestätigung den aktuellen Code aus der App (oder einen Notfall-Code) eingeben:', '', 'Ausschalten');
    if (!c) return;
    try { await apiJson('totp_disable', { method: 'POST', body: { code: c } }); toast('Zweiter Faktor ist aus.'); afUi(); } catch (e) { toast(e.message); }
  };
  async function nbUi() { try { nbShow(await apiJson('ncbackup')); } catch (e) { $('#nbInfo').textContent = e.offline ? 'Offline.' : e.message; } }
  $('#nbAuto').onchange = async () => { try { nbShow(await apiJson('ncbackup', { method: 'POST', body: { auto: $('#nbAuto').checked } })); } catch (e) { toast(e.message); } };
  $('#nbNow').onclick = async () => {
    if (NB.running) return;
    NB.running = true;
    $('#nbNow').disabled = true;
    let total = 0;
    try {
      for (let k = 0; k < 500; k++) {
        $('#nbInfo').textContent = `Wird gesichert … ${total} Dateien übertragen`;
        const r = await apiJson('ncbackup', { method: 'POST', body: { run: 1 } });
        if (r.busy) { $('#nbInfo').textContent = 'Die nächtliche Sicherung läuft gerade – bitte später noch einmal.'; break; }
        total += r.done || 0;
        if (r.error && !r.done) { nbShow(r); break; }
        if (!r.pending) { nbShow(r); toast('Sicherung in Nextcloud ist auf dem neuesten Stand.'); break; }
      }
    } catch (e) { $('#nbInfo').textContent = e.message; }
    NB.running = false;
    $('#nbNow').disabled = false;
  };
  $('#shAuto').onchange = async (e) => {
    try {
      const r = await apiJson('shrinkset', { method: 'POST', body: { auto: e.target.checked } });
      if (S.library) S.library.shrink = r;
      updateShrinkUi();
    } catch (err) { toast(err.message); }
  };
  $('#shNc').onchange = async (e) => {
    try { const r = await apiJson('shrinkset', { method: 'POST', body: { ncBack: e.target.checked } }); if (S.library) S.library.shrink = r; updateShrinkUi(); } catch (err) { toast(err.message); }
  };
  $('#shNow').onclick = () => { shrinkRun(true); updateShrinkUi(); };
  // früher verkleinerte PDFs wieder durch ihr Original ersetzen (Fotos wieder in voller Auflösung)
  $('#shUndo').onclick = async () => {
    if (!(await confirmDlg('Verkleinerung rückgängig', 'Alle verkleinerten PDFs, deren Original noch aufbewahrt ist und die seitdem nicht verändert wurden, werden wieder durch das Original ersetzt (Fotos wieder in voller Auflösung).', 'Rückgängig machen'))) return;
    const b = $('#shUndo'); b.disabled = true;
    let done = 0; const changed = [], missing = [];
    try {
      for (let k = 0; k < 200; k++) {
        $('#shInfo').textContent = `Originale werden zurückgeholt … ${done}`;
        const r = await apiJson('shrinkundo', { method: 'POST' });
        done += r.done; changed.push(...r.changed); missing.push(...r.missing);
        if (!r.left) break;
      }
      const name = (p) => p.split('/').pop();
      let msg = `${done} ${done === 1 ? 'PDF' : 'PDFs'} wieder im Original.`;
      if (changed.length) msg += `\n\nSeit dem Verkleinern verändert (z. B. Notizen eingeschrieben) – hier bitte über „Frühere Fassungen“ der PDF entscheiden:\n• ` + changed.map(name).join('\n• ');
      if (missing.length) msg += `\n\nOriginal nicht mehr auf dem Server (älter als 7 Tage)` + (S.library && S.library.nc && S.library.nc.configured ? ' – in Nextcloud unter „Versionen“ der Datei zu finden' : '') + `:\n• ` + missing.map(name).join('\n• ');
      await confirmDlg('Verkleinerung rückgängig', msg, 'OK');
      loadLibrary();
    } catch (e) { toast(e.message); }
    b.disabled = false;
    updateShrinkUi();
  };
  $('#bkDown').onclick = async () => {
    try {
      const r = await api('backup');
      downloadBlob(await r.blob(), `pdf-stift-notizen-${new Date().toISOString().slice(0, 10)}.json`);
      $('#bkMsg').textContent = 'Sicherung wird heruntergeladen.';
    } catch (e) { $('#bkMsg').textContent = e.offline ? 'Keine Verbindung zum Server.' : e.message; }
  };
  $('#bkFile').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const r = await apiJson('restore', { method: 'POST', body: data });
      $('#bkMsg').textContent = `${r.strokes} Notizen eingespielt.` + (r.missing ? ` ${r.missing} PDFs aus der Sicherung gibt es hier nicht (mehr).` : '');
      Notes.docs.clear();
      loadLibrary();
    } catch (err) { $('#bkMsg').textContent = err instanceof SyntaxError ? 'Diese Datei ist keine gültige Sicherung.' : err.message; }
  };

  // ------------------------------------------------------------------ Rückgängig
  function pushHistory(a) {
    const h = hist();
    h.undo.push(a);
    if (h.undo.length > 300) h.undo.shift();
    h.redo.length = 0;
    updateUndo();
  }
  function updateUndo() {
    const h = V.path ? hist() : { undo: [], redo: [] };
    $('#undo').disabled = !h.undo.length;
    $('#redo').disabled = !h.redo.length;
    $('#vbUndo').disabled = !h.undo.length;
    $('#vbRedo').disabled = !h.redo.length;
    if (EMBED) { try { window.parent.PDFSTIFT_MAIN.paneUndo(!!h.undo.length, !!h.redo.length); } catch (e) { /* */ } }
    else if (SPLIT.frame && SPLIT.act === 'r' && SPLIT.undo) { for (const q of ['#undo', '#vbUndo']) $(q).disabled = !SPLIT.undo[0]; for (const q of ['#redo', '#vbRedo']) $(q).disabled = !SPLIT.undo[1]; }
  }
  // Notizen einer PDF auf einen gespeicherten Stand bringen (nur die Unterschiede senden)
  function setNotes(path, target) {
    const d = Notes.docs.get(path);
    if (!d) return;
    const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    const del = [], add = [];
    for (const [id, st] of d.strokes) { const t2 = target.get(id); if (!t2) del.push(id); else if (!same(st, t2)) add.push(t2); }
    for (const [id, t2] of target) if (!d.strokes.has(id)) add.push({ ...t2, id: uid() }); // gelöschte IDs sind auf dem Server gesperrt
    if (del.length) opDel(path, del);
    if (add.length) opAdd(path, add);
  }
  async function replayPdf(a, forward) {
    const path = V.path;
    toast(forward ? 'Wird wiederholt …' : 'Wird rückgängig gemacht …', 20000);
    const buf = forward ? a.after : a.before;
    const n = (await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false }).promise.then((d) => { const k = d.numPages; d.destroy(); return k; }));
    await commitPdf(path, new Uint8Array(buf), [...Array(Math.max(n, V.pages.length)).keys()].map((k) => (k < n ? k : -1)), {}, a.target, { noHist: true });
    setNotes(path, new Map(forward ? a.an : a.bn));
    V.pages.forEach((P) => drawInk(P));
    toast(forward ? 'Wiederholt.' : 'Rückgängig gemacht.');
  }
  function replay(a, forward) {
    // forward=true: Aktion erneut ausführen; false: rückgängig machen
    if (a.t === 'pdf') { replayPdf(a, forward); return; }
    if (a.t === 'multi') { (forward ? a.acts : [...a.acts].reverse()).forEach((x) => replay(x, forward)); return; }
    const removeNow = (a.t === 'add') !== forward;
    if (removeNow) {
      opDel(V.path, a.strokes.map((s) => s.id));
    } else {
      a.strokes = a.strokes.map((s) => ({ ...s, id: uid() })); // gelöschte IDs bleiben auf dem Server gesperrt
      opAdd(V.path, a.strokes);
    }
    redrawPages(a.strokes);
  }
  function undo() { clearSel(); const h = hist(); const a = h.undo.pop(); if (!a) return; replay(a, false); h.redo.push(a); updateUndo(); }
  function redo() { clearSel(); const h = hist(); const a = h.redo.pop(); if (!a) return; replay(a, true); h.undo.push(a); updateUndo(); }
  $('#undo').onclick = undo;
  $('#redo').onclick = redo;
  document.addEventListener('keydown', (e) => {
    if (!V.path || (e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]'))) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  });

  // ------------------------------------------------------------------ Werkzeugleiste
  const ICON = {
    pen: '<path d="M16.5 3.5l4 4L8 20H4v-4z"/><path d="M14 6l4 4"/>',
    hl: '<path d="M9 15l-3 3H3l3-3"/><path d="M9 15l9-9 3 3-9 9z"/><path d="M3 21h9"/>',
    er: '<path d="M7 20h13"/><path d="M4.5 15.5l9-9a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L13 19H8.5z"/><path d="M9.5 10.5l5 5"/>',
  };
  const KIND_LABEL = { hl: 'Text hervorheben', ul: 'Text unterstreichen', st: 'Text durchstreichen' };
  const SHAPE_LABEL = { line: 'Linie', arrow: 'Pfeil', rect: 'Rechteck', oval: 'Kreis' };
  const SHAPE_ICON = {
    line: '<path d="M5 19L19 5"/>',
    arrow: '<path d="M5 19L19 5"/><path d="M10 5h9v9"/>',
    rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
    oval: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
  };
  const colorName = (c) => (PALETTE.find((p) => p[0] === c) || [c, c])[1];
  const LASER_ICON = '<circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>';
  function favLabel(f) {
    if (f.t === 'er') return 'Radierer';
    if (f.t === 'la') return 'Lasso';
    if (f.t === 'lp') return 'Laserpointer';
    if (f.t === 'tx') return KIND_LABEL[f.k] + ', ' + colorName(f.c);
    if (f.t === 'sh') return SHAPE_LABEL[f.k] + ', ' + colorName(f.c);
    if (f.t === 'tt') return 'Textfeld, ' + colorName(f.c) + ', ' + f.fs + ' pt';
    return (f.t === 'pen' ? 'Stift' : 'Marker') + ', ' + colorName(f.c) + ', ' + ['dünn', 'mittel', 'dick'][f.wi ?? 1];
  }
  function favIcon(f) {
    if (f.t === 'tx') {
      return f.k === 'hl'
        ? `<span class="txa" style="background:${f.c}">A</span>`
        : `<span class="txa ${f.k}" style="text-decoration-color:${f.c}">A</span>`;
    }
    if (f.t === 'er') return `<svg viewBox="0 0 24 24">${ICON.er}</svg>`;
    if (f.t === 'la') return '<svg viewBox="0 0 24 24"><path d="M12 4c5 0 8.5 2.3 8.5 5.2S17 14.5 12 14.5 3.5 12.2 3.5 9.2 7 4 12 4z" stroke-dasharray="3 2.4"/><path d="M6.5 13.5c-1 1.5-.4 3.4 1.6 3.6 1.8.2 2.1 2 .9 3.4"/></svg>';
    if (f.t === 'lp') return `<svg viewBox="0 0 24 24" class="laser-ic">${LASER_ICON}</svg>`;
    if (f.t === 'sh') return `<svg viewBox="0 0 24 24" style="color:${f.c}">${SHAPE_ICON[f.k]}</svg>`;
    if (f.t === 'tt') return `<span class="txa tt" style="color:${f.c}">T</span>`;
    return `<svg viewBox="0 0 24 24" style="color:${f.c};stroke-width:${f.t === 'hl' ? 2.4 : 1.6 + (f.wi ?? 1) * 0.5}">${ICON[f.t]}</svg>`;
  }
  function favMatches(f) {
    if (f.t !== S.tool) return false;
    if (f.t === 'er' || f.t === 'la' || f.t === 'lp') return true;
    if (f.c !== S.color[f.t]) return false;
    if (f.t === 'tx') return f.k === S.txKind;
    if (f.t === 'tt') return f.fs === S.ttSize;
    if (f.t === 'sh') return f.k === S.shKind && (f.wi ?? 1) === S.wi.sh;
    return (f.wi ?? 1) === S.wi[f.t];
  }
  function currentFav() {
    if (S.tool === 'er') return { t: 'er' };
    if (S.tool === 'la') return { t: 'la' };
    if (S.tool === 'lp') return { t: 'lp' };
    if (S.tool === 'tx') return { t: 'tx', k: S.txKind, c: S.color.tx };
    if (S.tool === 'tt') return { t: 'tt', c: S.color.tt, fs: S.ttSize };
    if (S.tool === 'sh') return { t: 'sh', k: S.shKind, c: S.color.sh, wi: S.wi.sh };
    return { t: S.tool, c: S.color[S.tool], wi: S.wi[S.tool] };
  }
  function applyFav(f) {
    S.tool = f.t;
    if (f.t !== 'er' && f.t !== 'la' && f.t !== 'lp') S.color[f.t] = f.c;
    if (f.t === 'tx') S.txKind = f.k;
    if (f.t === 'sh') { S.shKind = f.k; S.wi.sh = f.wi ?? 1; }
    if (f.t === 'tt') S.ttSize = f.fs || 14;
    if (f.t === 'pen' || f.t === 'hl') S.wi[f.t] = f.wi ?? 1;
    persistTools(); renderToolbar();
  }

  function renderToolbar() {
    if (ls('toolPanel')) setTimeout(tpRender, 0);
    obRibbonSync();
    if (window.PDFSTIFT_DECK && window.PDFSTIFT_DECK.RB.tab === 'draw') setTimeout(() => { const e2 = OB.ed || (typeof obIdle === 'function' && obIdle()); if (e2) e2.renderFmt(); }, 0);
    document.querySelectorAll('.tool').forEach((b) => {
      const on = b.dataset.tool === S.tool;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    document.querySelectorAll('#txKinds .kind').forEach((b) => b.classList.toggle('active', b.dataset.k === S.txKind));
    document.querySelectorAll('#shKinds .kind').forEach((b) => b.classList.toggle('active', b.dataset.k === S.shKind));
    document.querySelectorAll('#ttSizes .kind').forEach((b) => b.classList.toggle('active', +b.dataset.fs === S.ttSize));
    $('#txKinds').hidden = S.tool !== 'tx';
    $('#shKinds').hidden = S.tool !== 'sh';
    $('#ttSizes').hidden = S.tool !== 'tt';
    $('#colors').hidden = ['er', 'la', 'lp', 'sel', 'hand'].includes(S.tool);
    viewer.classList.toggle('sel-mode', S.tool === 'sel');
    viewer.classList.toggle('hand-mode', S.tool === 'hand');
    if (typeof syncTextLayers === 'function') syncTextLayers();
    $('#ppLaser').setAttribute('aria-pressed', S.tool === 'lp' ? 'true' : 'false');
    viewer.classList.toggle('laser', S.tool === 'lp');
    if (S.tool !== 'la') clearSel();
    $('#widths').hidden = !['pen', 'hl', 'sh'].includes(S.tool);
    const seps = document.querySelectorAll('#toolsRow > .sep');
    if (seps[0]) seps[0].hidden = $('#colors').hidden;
    if (seps[1]) seps[1].hidden = $('#widths').hidden;

    const cw = $('#colors');
    cw.innerHTML = '';
    if (!['er', 'la', 'lp', 'sel', 'hand'].includes(S.tool)) {
      PALETTE.forEach(([hex, label]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch' + (S.color[S.tool] === hex ? ' active' : '');
        b.setAttribute('aria-label', label);
        b.innerHTML = `<span style="background:${hex}"></span>`;
        b.onclick = () => { S.color[S.tool] = hex; persistTools(); renderToolbar(); };
        cw.appendChild(b);
      });
    }
    const ww = $('#widths');
    ww.innerHTML = '';
    if (['pen', 'hl', 'sh'].includes(S.tool)) {
      [6, 10, 15].forEach((px, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'width' + (i === S.wi[S.tool] ? ' active' : '');
        b.setAttribute('aria-label', ['Dünn', 'Mittel', 'Dick'][i]);
        b.innerHTML = `<span style="width:${px}px;height:${px}px"></span>`;
        b.onclick = () => { S.wi[S.tool] = i; persistTools(); renderToolbar(); };
        ww.appendChild(b);
      });
    }

    const fw = $('#favs');
    fw.innerHTML = '';
    S.favs.forEach((f, idx) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fav' + (favMatches(f) ? ' active' : '');
      b.setAttribute('aria-label', favLabel(f));
      b.title = favLabel(f) + ' – lange drücken zum Entfernen';
      b.innerHTML = favIcon(f);
      let timer = 0, long = false;
      b.addEventListener('pointerdown', () => {
        long = false;
        timer = setTimeout(async () => {
          long = true;
          if (await confirmDlg('Favorit entfernen?', favLabel(f) + ' wird aus der Favoriten-Leiste entfernt.', 'Entfernen')) {
            S.favs.splice(idx, 1); persistTools(); renderToolbar();
          }
        }, 650);
      });
      const stop = () => clearTimeout(timer);
      b.addEventListener('pointerup', stop);
      b.addEventListener('pointerleave', stop);
      b.addEventListener('pointercancel', stop);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      b.onclick = () => { if (!long) applyFav(f); };
      fw.appendChild(b);
    });
    const exists = S.favs.some(favMatches);
    $('#favAdd').disabled = exists;

    $('#toolsRow').hidden = !S.showTools;
    $('#toolsToggle').setAttribute('aria-expanded', S.showTools ? 'true' : 'false');
    $('#finger').setAttribute('aria-pressed', S.finger ? 'true' : 'false');
    viewer.classList.toggle('finger', S.finger);
  }
  function persistTools() {
    ls('tool', S.tool); ls('color', S.color); ls('wi', S.wi); ls('txKind', S.txKind); ls('shKind', S.shKind); ls('ttSize', S.ttSize);
    ls('favs', S.favs); ls('showTools', S.showTools); ls('finger', S.finger);
    toolsShare();
  }
  // geteilte Ansicht: Stift, Farbe, Stärke … gelten in beiden Hälften
  const toolsSnap = () => ({ tool: S.tool, color: { ...S.color }, wi: { ...S.wi }, txKind: S.txKind, shKind: S.shKind, ttSize: S.ttSize, favs: S.favs, finger: S.finger });
  let toolsIn = false;
  function toolsShare() {
    if (toolsIn) return;
    try {
      if (EMBED) window.parent.PDFSTIFT_MAIN.paneTools(toolsSnap());
      else if (SPLIT.frame && splitPane()) splitPane().tools(toolsSnap());
    } catch (e) { /* */ }
  }
  function toolsTake(t) {
    if (!t) return;
    toolsIn = true;
    try { Object.assign(S, { tool: t.tool, color: { ...S.color, ...t.color }, wi: { ...S.wi, ...t.wi }, txKind: t.txKind, shKind: t.shKind, ttSize: t.ttSize, favs: t.favs || S.favs, finger: !!t.finger }); renderToolbar(); } finally { toolsIn = false; }
  }
  document.querySelectorAll('.tool[data-tool]').forEach((b) => { b.onclick = () => { S.tool = b.dataset.tool; persistTools(); renderToolbar(); }; });
  document.querySelectorAll('#txKinds .kind').forEach((b) => { b.onclick = () => { S.txKind = b.dataset.k; persistTools(); renderToolbar(); }; });
  document.querySelectorAll('#shKinds .kind').forEach((b) => { b.onclick = () => { S.shKind = b.dataset.k; persistTools(); renderToolbar(); }; });
  document.querySelectorAll('#ttSizes .kind').forEach((b) => { b.onclick = () => { S.ttSize = +b.dataset.fs; persistTools(); renderToolbar(); }; });
  $('#favAdd').onclick = () => {
    if (S.favs.some(favMatches)) return;
    S.favs.push(currentFav());
    persistTools(); renderToolbar();
    toast('Als Favorit gespeichert. Zum Entfernen lange darauf drücken.');
  };
  $('#toolsToggle').onclick = () => { S.showTools = !S.showTools; persistTools(); renderToolbar(); setTimeout(() => window.dispatchEvent(new Event('resize')), 0); };
  $('#finger').onclick = () => {
    S.finger = !S.finger;
    persistTools(); renderToolbar();
    toast(S.finger ? 'Finger zeichnet. Mit zwei Fingern verschieben und zoomen.' : 'Nur der Stift zeichnet, der Finger scrollt.');
  };
  $('#menuBtn').onclick = () => {
    document.querySelectorAll('.nc-only').forEach((b) => { b.hidden = !ncOn() || !!V.board; });
    document.querySelectorAll('#menu > :not(.bd-only)').forEach((b) => { if (!b.classList.contains('nc-only')) b.hidden = !!V.board; });
    const m = $('#menu');
    const open = m.hidden;
    closeMenus();
    m.hidden = !open;
    $('#menuBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  $('#menu').onclick = (e) => { const a = e.target.dataset.act; if (a) { closeMenus(); menuAction(a); } };
  async function menuAction(a) {
    if (a === 'export') exportPdf();
    if (a === 'ncput') ncPut(annotatedSnapshot(), false);
    if (a === 'ins-blank' || a === 'ins-grid' || a === 'ins-lines') pageOp({ kind: 'insert', i: currentPageIndex(), style: a.slice(4) });
    if (a === 'rotate') pageOp({ kind: 'rotate', i: currentPageIndex() });
    if (a === 'delpage') pageOp({ kind: 'delete', i: currentPageIndex() });
    if (a === 'live') sessStart();
    if (a === 'ocr') ocrQueue([V.path]);
    if (a === 'bd-fit') boardFit();
    if (a === 'bd-img') { IMGDO.mode = 'place'; $('#imgIn').click(); }
    if (a === 'bd-pdf') nbInsertPdf();
    if (a === 'bd-tpl') boardInsertTpl();
    if (a === 'bd-hist') boardHistory();
    if (a === 'bd-save') boardPdfDialog('save');
    if (a === 'bd-print') boardPdfDialog('print');
    if (a.startsWith('bg-') && V.board) {
      B.meta.bg = a.slice(3);
      boardRender();
      const info = boardInfo(V.path);
      if (info) info.bg = B.meta.bg;
      apiJson('nbset', { method: 'POST', body: { path: V.path, bg: B.meta.bg } }).catch(() => {});
    }
    if (a === 'resetfavs') { S.favs = DEFAULT_FAVS.map((f) => ({ ...f })); persistTools(); renderToolbar(); toast('Favoriten zurückgesetzt.'); }
    if (a === 'original') downloadOriginal(V.path);
    if (a === 'two') setViewMode(viewMode() === 'single' ? 'two' : 'single');
    if (a === 'vbcfg') vbConfig();
    if (a === 'viewrot') rotateView(90);
    if (a === 'settings') settingsDialog();
    if (a === 'props') docProps();
    if (a === 'mkf') markerStart('f');
    if (a === 'mkv') markerStart('v');
    if (a === 'study') studySheet();
    if (a === 'carry') carryDialog();
    if (a === 'tonb') toNotebook();
    if (a === 'report') usageReport();
    if (a === 'help') openHelp();
    if (a === 'about') aboutDlg();
    if (a === 'scanfix') scanFixDialog();
    if (a === 'handout') handoutDialog();
    if (a === 'findredact') findRedact();
  };

  // ------------------------------------------------------------------ Herunterladen
  async function downloadOriginal(path) {
    try {
      const bytes = pdfCache.get(path) ? await pdfBytes(pdfCache.get(path)) : await getPdfBytes(path);
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), basename(path));
    } catch (e) { toast(e.offline ? 'Diese PDF ist offline nicht verfügbar.' : e.message); }
  }

  // Erzeugt die PDF mit eingezeichneten Notizen. Alles wird vorab übergeben, damit es auch nach einem Dokumentwechsel stimmt.
  function annotatedSnapshot() {
    const entry = pdfCache.get(V.path);
    if (!entry || !V.doc) return null;
    return { path: V.path, bytes: pdfBytes(entry), vps: V.pages.map((P) => ({ vp: P.vp, P })), strokes: [...V.doc.strokes.values()] };
  }
  async function buildAnnotated(snap) {
    const { PDFDocument, rgb, LineCapStyle, BlendMode, StandardFonts, degrees } = PDFLib;
    let font = null, obPaint = null;
    const txtFonts = {};
    const out = await PDFDocument.load(await snap.bytes, { ignoreEncryption: true });
    const pages = out.getPages();
    const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
    const strokes = [...snap.strokes].sort((a, b) => rank(a) - rank(b) || (a.zi || 0) - (b.zi || 0));
    // Seiten, die bei großen PDFs noch nicht gelesen sind
    for (const p of new Set(strokes.map((s) => s.p))) {
      const v = snap.vps[p];
      if (v && !v.vp && v.P) { try { await pgOf(v.P); v.vp = v.P.vp; } catch (e) { /* */ } }
    }
    {
      const clipped = new Set();
      for (const s of strokes) {
        const P = snap.vps[s.p];
        const pg = pages[s.p];
        if (!P || !pg) continue;
        // Notizseite auf mehrere Blätter: alles außerhalb des Blattausschnitts abschneiden
        if (snap.clips && snap.clips[s.p] && !clipped.has(s.p)) {
          clipped.add(s.p);
          const [cx, cy, cw, ch] = snap.clips[s.p];
          pg.pushOperators(PDFLib.pushGraphicsState(), PDFLib.rectangle(cx, cy, cw, ch), PDFLib.clip(), PDFLib.endPath());
        }
        if (s.t === 'ob') {
          // Objekt wie auf der Folie zeichnen: Ursprung oben links der Seitenansicht, y nach unten
          if (!s.e) continue;
          try {
            const DK = await ensureDeck();
            obPaint = obPaint || await DK.painter(out, OB_TH, strokes.filter((x) => x.t === 'ob' && x.e).map((x) => x.e));
            const [a, b, c, d, e, f] = P.vp.transform, det = a * d - b * c;
            const ia = d / det, ib = -b / det, ic = -c / det, id = a / det, ie = (c * f - d * e) / det, iff = (b * e - a * f) / det;
            pg.pushOperators(PDFLib.pushGraphicsState(), PDFLib.concatTransformationMatrix(ia, ib, -ic, -id, ie, iff));
            await obPaint.drawEl(pg, s.e, 1, [ia, ib, -ic, -id, ie, iff]);
            pg.pushOperators(PDFLib.popGraphicsState());
          } catch (e) { console.warn('Objekt', e); }
          continue;
        }
        if (s.t === 'sh') {
          for (const line of shapeLines(s)) {
            const pts = line.map(([x, y]) => P.vp.convertToPdfPoint(x, y));
            pg.drawSvgPath('M ' + pts.map(([x, y]) => `${x.toFixed(2)} ${(-y).toFixed(2)}`).join(' L '), {
              x: 0, y: 0, borderColor: hex(s.c), borderWidth: s.w, borderLineCap: LineCapStyle.Round,
            });
          }
          continue;
        }
        if (s.t === 'img') {
          try {
            let bin = new Uint8Array(await (await fetch(API + '?a=img&src=' + encodeURIComponent(s.src), { credentials: 'same-origin' })).arrayBuffer());
            if (/\.(gif|webp)$/.test(s.src)) { // pdf-lib kann nur JPEG/PNG – vorher umwandeln
              const im = imgGet(s.src);
              const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
              c.getContext('2d').drawImage(im, 0, 0);
              bin = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/png'))).arrayBuffer());
            }
            const img = /\.jpg$/.test(s.src) ? await out.embedJpg(bin) : await out.embedPng(bin);
            const [x, y] = s.pts;
            // eigene Drehung um die Mitte: gedrehte Ecken in Seitenkoordinaten
            const ra = (s.r || 0) * Math.PI / 180, mx = x + s.bw / 2, my = y + s.bh / 2;
            const rp = (dx, dy) => [mx + dx * Math.cos(ra) - dy * Math.sin(ra), my + dx * Math.sin(ra) + dy * Math.cos(ra)];
            const p0 = P.vp.convertToPdfPoint(...rp(-s.bw / 2, s.bh / 2)), px = P.vp.convertToPdfPoint(...rp(s.bw / 2, s.bh / 2)), py = P.vp.convertToPdfPoint(...rp(-s.bw / 2, -s.bh / 2));
            const ang = (Math.atan2(px[1] - p0[1], px[0] - p0[0]) * 180) / Math.PI;
            pg.drawImage(img, { x: p0[0], y: p0[1], width: Math.hypot(px[0] - p0[0], px[1] - p0[1]), height: Math.hypot(py[0] - p0[0], py[1] - p0[1]), rotate: degrees(ang) });
          } catch (e) { /* Bild nicht erreichbar – Rest trotzdem speichern */ }
          continue;
        }
        if (s.t === 'txt' && s.nt) {
          // Kommentar als echte PDF-Notiz – andere PDF-Programme zeigen sie als Notizzettel
          const [x1, y1] = P.vp.convertToPdfPoint(s.pts[0], s.pts[1] + 20);
          const [x2, y2] = P.vp.convertToPdfPoint(s.pts[0] + 20, s.pts[1]);
          const c = [1, 3, 5].map((q) => parseInt((s.c || '#FFD43B').slice(q, q + 2), 16) / 255);
          const an = out.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)],
            Contents: PDFLib.PDFHexString.fromText(s.text || ''), Name: 'Comment', C: c, F: 4, Open: false, T: PDFLib.PDFHexString.fromText('PDF-Stift') });
          pg.node.addAnnot(out.context.register(an));
          continue;
        }
        if (s.t === 'txt') {
          const fam = s.ff === 'serif' ? 'TimesRoman' : s.ff === 'mono' ? 'Courier' : 'Helvetica';
          const std = fam + (s.b ? 'Bold' : '') + (s.i ? (fam === 'TimesRoman' ? 'Italic' : 'Oblique') : '');
          const std0 = fam === 'TimesRoman' && !s.b && !s.i ? 'TimesRoman' : std;
          font = (txtFonts[std0] = txtFonts[std0] || await pdfFont(out, std0, snap.strokes.filter((x) => x.t === 'txt').map((x) => x.text || '')));
          const [ax, ay] = P.vp.convertToPdfPoint(0, 0);
          const [bx, by] = P.vp.convertToPdfPoint(1, 0);
          const ang = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
          if (s.bg || s.bo) {
            const pd = s.fs * 0.3, ra = (s.r || 0) * Math.PI / 180, mx = s.pts[0] + (s.bw || 0) / 2, my = s.pts[1] + (s.bh || 0) / 2;
            const dx = -(s.bw || 0) / 2 - pd, dy = (s.bh || 0) / 2 + pd; // untere linke Ecke (Bildschirm)
            const ll = P.vp.convertToPdfPoint(mx + dx * Math.cos(ra) - dy * Math.sin(ra), my + dx * Math.sin(ra) + dy * Math.cos(ra));
            pg.drawRectangle({ x: ll[0], y: ll[1], width: (s.bw || 0) + pd * 2, height: (s.bh || 0) + pd * 2, rotate: degrees(ang - (s.r || 0)),
              ...(s.bg ? { color: hex(s.bg) } : {}), ...(s.bo ? { borderColor: hex(s.bo), borderWidth: Math.max(0.5, s.fs * 0.07) } : {}) });
          }
          txtLines(s).forEach((line, i) => {
            const clean = [...line].map((ch) => { try { font.encodeText(ch); return ch; } catch (err) { return '?'; } }).join('');
            let lx = s.pts[0], ly = s.pts[1] + s.fs * 0.8 + i * s.fs * 1.25;
            if (s.al && clean) { let lw = 0; try { lw = font.widthOfTextAtSize(clean, s.fs); } catch (er) { /* */ } lx += Math.max(0, ((s.bw || 0) - lw) * (s.al === 'c' ? 0.5 : 1)); }
            if (s.r) { // um die Mitte des Textfelds drehen
              const ra = s.r * Math.PI / 180, mx = s.pts[0] + (s.bw || 0) / 2, my = s.pts[1] + (s.bh || 0) / 2, dx = lx - mx, dy = ly - my;
              lx = mx + dx * Math.cos(ra) - dy * Math.sin(ra); ly = my + dx * Math.sin(ra) + dy * Math.cos(ra);
            }
            const [x, y] = P.vp.convertToPdfPoint(lx, ly);
            if (clean) pg.drawText(clean, { x, y, size: s.fs, font, color: hex(s.c), rotate: degrees(ang - (s.r || 0)) });
          });
          continue;
        }
        if (s.t === 'tx') {
          const r = s.pts;
          for (let i = 0; i + 3 < r.length; i += 4) {
            const [x, y, w, h] = [r[i], r[i + 1], r[i + 2], r[i + 3]];
            if (s.k === 'ul' || s.k === 'st') {
              const yy = s.k === 'ul' ? y + h * 0.94 : y + h * 0.56;
              const [ax, ay] = P.vp.convertToPdfPoint(x, yy);
              const [bx, by] = P.vp.convertToPdfPoint(x + w, yy);
              pg.drawLine({ start: { x: ax, y: ay }, end: { x: bx, y: by }, thickness: Math.max(1.2, h * 0.085), color: hex(s.c) });
            } else {
              const [ax, ay] = P.vp.convertToPdfPoint(x, y);
              const [bx, by] = P.vp.convertToPdfPoint(x + w, y + h);
              pg.drawRectangle({
                x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay),
                color: hex(s.c), opacity: 0.85, blendMode: BlendMode.Multiply,
              });
            }
          }
          continue;
        }
        const pts = [];
        for (let i = 0; i < s.pts.length; i += 3) {
          const [x, y] = P.vp.convertToPdfPoint(s.pts[i], s.pts[i + 1]);
          pts.push([x, y, s.pts[i + 2] || 0.5]);
        }
        if (pts.length === 1) pts.push([pts[0][0] + 0.01, pts[0][1], pts[0][2]]);
        const path = (arr) => 'M ' + arr.map(([x, y]) => `${x.toFixed(2)} ${(-y).toFixed(2)}`).join(' L ');
        const base = { x: 0, y: 0, borderColor: hex(s.c), borderLineCap: LineCapStyle.Round };
        if (s.t === 'hl') {
          pg.drawSvgPath(path(pts), { ...base, borderWidth: s.w, borderOpacity: 0.4, blendMode: BlendMode.Multiply });
        } else {
          for (let i = 0; i < pts.length - 1; i += 3) {
            const chunk = pts.slice(i, i + 4);
            const pr = chunk.reduce((a, c) => a + c[2], 0) / chunk.length;
            pg.drawSvgPath(path(chunk), { ...base, borderWidth: s.w * (0.6 + 0.8 * pr) });
          }
        }
      }
    }
    return pdfSave(out);
  }
  async function exportPdf() {
    const snap = annotatedSnapshot();
    if (!snap) return;
    track('tool', 'PDF mit Notizen speichern');
    toast('PDF mit Notizen wird erstellt …', 30000);
    try {
      const bytes = await buildAnnotated(snap);
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), basename(snap.path).replace(/\.pdf$/i, '') + ' (mit Notizen).pdf');
      toast('Fertig – die PDF mit deinen Notizen wird heruntergeladen.');
    } catch (e) {
      toast('Export fehlgeschlagen: ' + e.message, 6000);
    }
  }
  // ---- Notizen fest in die PDF schreiben („einbrennen“): beim Verlassen einer PDF und beim Öffnen übrig gebliebener Notizen
  const BURN = new Map(); // path -> Promise
  function burnable(path) {
    // Verknüpfungen bleiben als antippbare Notiz erhalten und werden nicht eingebrannt
    return path && !path.startsWith('@nb/') && Notes.docs.get(path) && [...Notes.docs.get(path).strokes.values()].some((s) => !s.ln && !s.nt && !s.sn);
  }
  function autoBurn(path = V.path) {
    if (!burnable(path) || BURN.has(path) || navigator.onLine === false) return null;
    const pr = burnDoc(path).finally(() => BURN.delete(path));
    BURN.set(path, pr);
    return pr;
  }
  const BURN_TOLD = new Set();
  async function burnDoc(path) {
    if (upPending(path)) return false; // erst die Seitenänderung hochladen
    await flush();
    const pnd = Notes.pending.get(path);
    if (pnd && (pnd.add.size || pnd.del.size)) return false; // noch nicht abgeglichen (offline) – beim nächsten Mal
    const d = Notes.docs.get(path);
    if (!d || !d.strokes.size) return false;
    const entry = pdfCache.get(path) || (await loadPdf(path).catch(() => null));
    if (!entry) return false;
    // Seitenmaße wie in der Anzeige (inkl. Drehung)
    const vps = [];
    for (let i = 1; i <= entry.pdf.numPages; i++) vps.push({ vp: (await entry.pdf.getPage(i)).getViewport({ scale: 1 }) });
    const strokes = [...d.strokes.values()].filter((s) => !s.ln && !s.nt && !s.sn);
    if (!strokes.length) return false;
    setSync('burning');
    try {
      const base = await pdfBytes(entry);
      const bytes = await buildAnnotated({ path, bytes: base, vps, strokes });
      const ib = await incInfo(bytes, base);
      const send = async (whole) => {
        const fd = new FormData();
        fd.append('path', path);
        fd.append('ids', JSON.stringify(strokes.map((s) => s.id)));
        fd.append('baseSize', String(base.byteLength));
        if (ib && !whole) { fd.append('baseFp', ib.fp); fd.append('tail', new Blob([bytes.subarray(ib.len)], { type: 'application/octet-stream' }), 'anhang.bin'); } else fd.append('pdf', new Blob([bytes], { type: 'application/pdf' }), 'mit-notizen.pdf');
        return fetch(API + '?a=burn', { method: 'POST', credentials: 'same-origin', headers: { 'X-PDFStift': '1' }, body: fd });
      };
      let r = await send(false);
      if (ib && r.status === 409) r = await send(true);
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(res.error || 'Fehler ' + r.status);
      // neue PDF übernehmen, eingebrannte Striche aus der Notizebene nehmen
      const nb = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      try { await DB.put('pdfs', path, { bytes: nb, mtime: res.mtime, size: res.size, savedAt: Date.now() }); S.offline.add(path); } catch (e) { /* Speicher voll */ }
      const meta = fileMeta(path);
      if (meta) { meta.mtime = res.mtime; meta.size = res.size; meta.thumb = false; meta.notesMtime = 0; DB.put('kv', 'library', S.library).catch(() => {}); }
      const old = pdfCache.get(path);
      if (old) { pdfCache.delete(path); if (V.path !== path) old.pdf.destroy(); else old.stale = true; }
      for (const s of strokes) d.strokes.delete(s.id);
      history.delete(path);
      saveLocal(path);
      if (V.path === path && !cur) reloadDoc(path);
      setSync('ok');
      return true;
    } catch (e) {
      setSync(navigator.onLine === false ? 'offline' : 'ok');
      if (/größer, als der Server/.test(e.message)) { if (!BURN_TOLD.has(path)) toast(e.message, 9000); BURN_TOLD.add(path); } else
      if (!/409/.test(e.message) && !/geändert|changed in the meantime/.test(e.message)) toast('Notizen konnten nicht in die PDF geschrieben werden: ' + e.message + ' – sie bleiben gespeichert, nächster Versuch beim Verlassen.', 7000);
      return false;
    }
  }
  async function reloadDoc(path) {
    const at = currentPageIndex();
    const z = V.zoom, sl = viewer.scrollLeft;
    const old = pdfCache.get(path);
    if (old) { pdfCache.delete(path); old.pdf.destroy(); }
    V.path = null;
    await showDoc(path, true);
    if (V.zoom !== z) { V.zoom = z; layout(); }
    goToPage(at);
    viewer.scrollLeft = sl;
  }
  // ---- Beschriftete PDF in Nextcloud ablegen
  const ncOn = () => !!(S.library && S.library.nc && S.library.nc.configured);
  async function ncPut(snap, silent) {
    if (!snap || !ncOn() || navigator.onLine === false) return;
    if (!silent) toast('Speichere in Nextcloud …', 30000);
    try {
      const bytes = await buildAnnotated(snap);
      const r = await fetch(`${API}?a=ncput&path=${encodeURIComponent(snap.path)}`, {
        method: 'POST', credentials: 'same-origin', headers: { 'X-PDFStift': '1', 'Content-Type': 'application/pdf' }, body: bytes,
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Fehler ' + r.status);
      if (!silent) toast('In Nextcloud gespeichert: „Mit Notizen/' + snap.path + '“.', 5000);
    } catch (e) {
      if (!silent) toast('Nextcloud: ' + e.message, 6000);
    }
  }
  // automatisch, wenn eine geänderte PDF verlassen wird
  function autoNcExport() {
    if (!V.dirty || !ncOn() || !S.library.nc.export) return;
    V.dirty = false;
    ncPut(annotatedSnapshot(), true);
  }

  // ------------------------------------------------------------------ Start
  window.addEventListener('online', () => { flush(); if (!S.active) loadLibrary(); else pull(S.active); });
  window.addEventListener('offline', () => setSync('offline'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.started) {
      flush();
      if (V.path) pull(V.path); else loadLibrary();
    } else if (document.visibilityState === 'hidden') {
      saveViewState();
      if (V.path && !cur) autoBurn(V.path);
    }
  });
  setInterval(() => { if (S.started && V.path && !cur && document.visibilityState === 'visible' && navigator.onLine !== false) pull(V.path); }, 30000);

  // ---- Android-Tablet: Stift-Taste radiert, schnellere Stiftanzeige, App-Verknüpfungen
  // Live-Ebene ohne Umweg über den Compositor zeichnen: die Linie klebt sichtbar näher an der Stiftspitze (Chrome auf Android)
  function lowLat(c) {
    if (LOWLAT) { try { c.getContext('2d', { desynchronized: true }); } catch (e) { /* älterer Browser */ } }
    return c;
  }
  // Seitentaste des Stifts (S Pen) gedrückt halten oder Radier-Ende benutzen = Radierer für diesen Strich
  const PBTN = { pid: null, prev: null };
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'pen' || !((e.buttons & 32) || (e.buttons & 2) || e.button === 5 || e.button === 2)) return;
    if (!e.target.closest('#pages, #board') || S.tool === 'er' || ls('noPenBtn')) return;
    PBTN.pid = e.pointerId; PBTN.prev = S.tool; S.tool = 'er';
    document.body.classList.add('pen-erasing');
  }, true);
  const pbEnd = (e) => {
    if (PBTN.pid == null || e.pointerId !== PBTN.pid) return;
    const prev = PBTN.prev;
    PBTN.pid = null;
    setTimeout(() => { if (S.tool === 'er') S.tool = prev; document.body.classList.remove('pen-erasing'); }, 0);
  };
  window.addEventListener('pointerup', pbEnd, true);
  window.addEventListener('pointercancel', pbEnd, true);
  // Stift-Taste löst sonst das Kontextmenü aus
  document.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('#pages, #board') && (penDown || PBTN.pid != null || (e.pointerType || '') === 'pen')) e.preventDefault(); }, true);
  // ================================================================== Am PC: Auswählen, Hand, Kontextmenü, Tastenkürzel, Drucken, Ziehen & Ablegen
  // ---- Textebene (nur im Werkzeug „Auswählen“): Text mit der Maus markieren und kopieren
  function textLayerOn() { return S.tool === 'sel' && !isMirror() && !V.board; }
  async function ensureTextLayer(P) {
    if (!textLayerOn() || !P.cssW || !P.el.isConnected) return;
    if (P.tl && P.tlKey === P.cssW) return;
    if (P.tl) P.tl.remove();
    const div = document.createElement('div');
    div.className = 'textLayer';
    const scale = P.cssW / P.w;
    div.style.setProperty('--scale-factor', scale);
    div.style.setProperty('--total-scale-factor', scale);
    div.style.setProperty('--scale-round-x', '1px'); div.style.setProperty('--scale-round-y', '1px');
    P.tl = div; P.tlKey = P.cssW;
    P.el.appendChild(div);
    try {
      const tc = await (await pgOf(P)).getTextContent();
      if (P.tl !== div) return;
      await new pdfjsLib.TextLayer({ textContentSource: tc, container: div, viewport: P.pg.getViewport({ scale }) }).render();
    } catch (e) { /* Seite ohne Text */ }
  }
  function dropTextLayer(P) { if (P.tl) { P.tl.remove(); P.tl = null; P.tlKey = 0; } }
  function syncTextLayers() { V.pages.forEach((P) => (textLayerOn() && V.visible.has(P) ? ensureTextLayer(P) : dropTextLayer(P))); }

  // ---- Hand: Seite mit der Maus ziehen (auch mittlere Maustaste oder Leertaste gedrückt halten)
  let panState = null, spaceHand = false;
  function startPan(e) {
    e.preventDefault();
    panState = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try { viewer.setPointerCapture(e.pointerId); } catch (er) { /* */ }
    viewer.classList.add('panning');
  }
  viewer.addEventListener('pointerdown', (e) => {
    if (V.board || e.pointerType === 'touch') return;
    const hand = (S.tool === 'hand' && e.button === 0) || e.button === 1 || (spaceHand && e.button === 0);
    if (hand && e.target.closest('.page, #pages') && !(e.button === 0 && (noteUnder(e) || snipUnder(e) || obUnder(e)))) { e.stopPropagation(); startPan(e); }
  }, true);
  // Textbaustein unter dem Zeiger (dann nicht verschieben, sondern den Baustein anfassen)
  // Objekt (oder Griff des ausgewählten Objekts) unter dem Zeiger: die Hand verschiebt dann das Objekt statt der Seite
  function obUnder(e) {
    if (OB.insert || (e.target.closest && e.target.closest('.ob-layer'))) return true;
    const pageEl = e.target.closest && e.target.closest('.page');
    const P = pageEl && V.pages[+pageEl.dataset.i];
    if (!P || !V.doc || !window.PDFSTIFT_DECK) return false;
    return !!obHit(P, ...obLocal(P, e));
  }
  function snipUnder(e) {
    const pageEl = e.target.closest && e.target.closest('.page');
    const P = pageEl && V.pages[+pageEl.dataset.i];
    if (!P || !V.doc) return null;
    const r = P.el.getBoundingClientRect(), sc = P.cssW / P.w;
    const t = textAt(P, (isMirror() ? r.right - e.clientX : e.clientX - r.left) / sc, (e.clientY - r.top) / sc);
    return t || null;
  }
  function noteUnder(e) {
    const pageEl = e.target.closest && e.target.closest('.page');
    const P = pageEl && V.pages[+pageEl.dataset.i];
    if (!P || (V.viewRot || 0) !== 0) return null;
    const r = P.el.getBoundingClientRect(), sc = r.width / P.w;
    return noteAt(P, (e.clientX - r.left) / sc, (e.clientY - r.top) / sc);
  }
  viewer.addEventListener('pointermove', (e) => {
    if (!panState || e.pointerId !== panState.id) return;
    viewer.scrollLeft -= e.clientX - panState.x; viewer.scrollTop -= e.clientY - panState.y;
    panState.x = e.clientX; panState.y = e.clientY;
  });
  const endPan = (e) => { if (panState && e.pointerId === panState.id) { panState = null; viewer.classList.remove('panning'); } };
  viewer.addEventListener('pointerup', endPan);
  viewer.addEventListener('pointercancel', endPan);

  // ---- Markierter Text → Hervorheben / Unterstreichen / Durchstreichen
  function selectedText() {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return '';
    const n = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement);
    return n && n.closest && n.closest('.textLayer') ? s.toString() : '';
  }
  function markSelection(kind, color) {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !V.path) return;
    const byPage = new Map();
    for (let k = 0; k < s.rangeCount; k++) {
      for (const rc of s.getRangeAt(k).getClientRects()) {
        if (rc.width < 1 || rc.height < 2) continue;
        const cy = rc.top + rc.height / 2;
        const P = V.pages.find((Q) => { const b = Q.el.getBoundingClientRect(); return cy >= b.top && cy <= b.bottom && rc.left < b.right && rc.right > b.left; });
        if (!P) continue;
        const b = P.el.getBoundingClientRect(), sc = b.width / P.w;
        if (!byPage.has(P)) byPage.set(P, []);
        byPage.get(P).push({ x: (rc.left - b.left) / sc, y: (rc.top - b.top) / sc, w: rc.width / sc, h: rc.height / sc });
      }
    }
    const strokes = [];
    for (const [P, list] of byPage) {
      list.sort((a, b) => a.y - b.y || a.x - b.x);
      const out = [];
      for (const r of list) {
        const L = out.find((o) => Math.abs((o.y + o.h / 2) - (r.y + r.h / 2)) < Math.max(o.h, r.h) * 0.5 && r.x <= o.x + o.w + r.h && r.x + r.w >= o.x - r.h);
        if (L) { const x2 = Math.max(L.x + L.w, r.x + r.w), y2 = Math.max(L.y + L.h, r.y + r.h); L.x = Math.min(L.x, r.x); L.y = Math.min(L.y, r.y); L.w = x2 - L.x; L.h = y2 - L.y; } else out.push({ ...r });
      }
      const pts = out.flatMap((r) => [r2(r.x), r2(r.y), r2(r.w), r2(r.h)]);
      if (pts.length) strokes.push({ id: uid(), p: P.i, t: 'tx', k: kind, c: color || (kind === 'hl' ? S.color.tx : '#D6262B'), pts });
    }
    if (!strokes.length) return;
    opAdd(V.path, strokes);
    pushHistory({ t: 'add', strokes });
    byPage.forEach((_, P) => drawInk(P));
    s.removeAllRanges();
  }
  async function copySelection() {
    const t = selectedText() || (window.getSelection() ? window.getSelection().toString() : '');
    if (!t) return;
    try { await navigator.clipboard.writeText(t); toast('Kopiert.'); } catch (e) { document.execCommand('copy'); }
  }

  // ---- Rechtsklick auf der Seite
  function ctxMenu(e, P) {
    closeMenus();
    const m = document.createElement('div');
    m.className = 'menu ctx-menu';
    const hasSel = !!selectedText();
    const items = [];
    if (hasSel) {
      items.push(['copy', 'Kopieren', 'Strg+C'], ['hl', 'Hervorheben'], ['ul', 'Unterstreichen'], ['st', 'Durchstreichen'], ['find', 'In der PDF suchen'], ['-']);
    }
    const oxy = obLocal(P, e);
    const oh = window.PDFSTIFT_DECK && !V.board ? obHit(P, ...oxy) : null;
    if (oh) items.push(['obedit', oh.t === 'img' ? 'Objekt auswählen' : 'Text im Objekt bearbeiten'], ['obdup', 'Objekt duplizieren', 'Strg+D'], ['obfront', 'Nach vorne'], ['obback', 'Nach hinten'], ['obdel', 'Objekt löschen', 'Entf'], ['-']);
    items.push(['tt', 'Textfeld hier einfügen'], ['obtext', 'Formatiertes Textfeld hier (wie PowerPoint)'], ['obshape', 'Form hier einfügen …'], ['obimg', 'Bild einfügen …'], ['obtab', 'Tabelle einfügen …'], ['-'],
      ['sel', 'Werkzeug: Text auswählen'], ['hand', 'Werkzeug: Hand'], ['pen', 'Werkzeug: Stift'], ['-'],
      ['fitw', 'Seitenbreite', 'Strg+2'], ['fitp', 'Ganze Seite', 'Strg+0'], ['two', viewMode() === 'single' ? 'Zwei Seiten nebeneinander' : 'Einzelseiten'], ['vrot', 'Ansicht drehen', 'Strg+Umschalt++'], ['-'],
      ['rot', 'Diese Seite drehen'], ['tonb', 'Ins Notizbuch übernehmen …'], ...(SPLIT.frame && SPLIT.path && isBoard(SPLIT.path) ? [['tonbr', 'Rechts auf die Notizseite legen']] : []), ['print', 'Drucken …', 'Strg+P'], ['save', 'PDF mit Notizen speichern …', 'Strg+S']);
    m.innerHTML = items.map(([a, l, k]) => a === '-' ? '<span class="menu-sep"></span>' : `<button type="button" data-a="${a}"><span>${esc(l)}</span>${k ? `<kbd>${k}</kbd>` : ''}</button>`).join('');
    document.body.appendChild(m);
    const w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.min(e.clientX, innerWidth - w - 8) + 'px';
    m.style.top = Math.min(e.clientY, innerHeight - h - 8) + 'px';
    openMenu = m;
    const sel = selectedText();
    m.onclick = (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      const a = b.dataset.a;
      closeMenus();
      if (a === 'copy') copySelection();
      if (a === 'hl' || a === 'ul' || a === 'st') markSelection(a);
      if (a === 'find') { openSearch(); $('#q').value = sel.trim().slice(0, 80); runSearch($('#q').value); }
      if (a === 'tt') { S.tool = 'tt'; persistTools(); renderToolbar(); openTextEditor(P, e); }
      if (a === 'sel' || a === 'hand' || a === 'pen') { S.tool = a; persistTools(); renderToolbar(); }
      if (a === 'fitw') setZoom(1);
      if (a === 'fitp') fitWholePage();
      if (a === 'two') setViewMode(viewMode() === 'single' ? 'two' : 'single');
      if (a === 'vrot') rotateView(90);
      if (a === 'rot') pageOp({ kind: 'rotate', i: P.i });
      if (a === 'tonb') toNotebook(P.i);
      if (a === 'tonbr') slideToPane(P.i);
      if (a === 'print') printDialog();
      if (a === 'save') exportPdf();
      if (a.startsWith('ob')) obCtx(a, P, oxy, oh, ev);
    };
  }
  async function obCtx(a, P, [x, y], oh, ev) {
    let DK;
    try { DK = await ensureDeck(); } catch (er) { toast(er.message); return; }
    const ed = obActivate(P);
    if (!ed) return;
    if (oh && ['obedit', 'obdup', 'obfront', 'obback', 'obdel'].includes(a)) {
      ed.select([oh.id]);
      if (a === 'obedit') { if (oh.t !== 'img') ed.startEdit(oh.id, null); return; }
      ed.act({ obdup: 'dup', obfront: 'front', obback: 'back', obdel: 'del' }[a]);
      return;
    }
    if (a === 'obtext') ed.insertAt('text', x, y);
    if (a === 'obshape') {
      const shapes = [['rect', 'Rechteck'], ['round', 'Abgerundetes Rechteck'], ['ellipse', 'Kreis / Ellipse'], ['tri', 'Dreieck'], ['arrowR', 'Blockpfeil'], ['line', 'Linie'], ['arrow', 'Pfeil']];
      DK.popMenu(ev.clientX, ev.clientY, shapes.map(([id, l]) => [id, l, () => { const e2 = obActivate(P); if (e2) e2.insertAt('shape:' + id, x, y); }]));
    }
    if (a === 'obimg') obPickImage();
    if (a === 'obtab') ed.addTable();
  }
  pagesEl.addEventListener('contextmenu', (e) => {
    if (V.board || (e.pointerType || '') === 'pen' || penDown) return;
    const pageEl = e.target.closest('.page');
    if (!pageEl) return;
    e.preventDefault();
    ctxMenu(e, V.pages[+pageEl.dataset.i]);
  });

  // ---- Zoom
  function fitWholePage() {
    const P = V.pages[currentPageIndex()];
    if (!P) return;
    const side = (V.viewRot || 0) % 180 !== 0, cols = viewMode() === 'single' ? 1 : 2;
    const h = side ? P.cssW : P.cssH, w = side ? P.cssH : P.cssW;
    setZoom(V.zoom * Math.min((viewer.clientHeight - 36) / h, (viewer.clientWidth - 32 - (cols - 1) * 18) / (w * cols)));
    requestAnimationFrame(() => goToPage(P.i));
  }
  // echte Größe: 100 % = Seite so groß wie gedruckt
  function actualZoom() {
    const maxW = Math.max(...V.pages.map((P) => P.w), 1);
    const fit = Math.min(viewer.clientWidth - 32, 1500);
    return (maxW * 96 / 72) / fit;
  }
  function zoomMenu(btn) {
    closeMenus();
    const m = document.createElement('div');
    m.className = 'menu ctx-menu';
    const opts = [['w', 'Seitenbreite'], ['p', 'Ganze Seite'], ['-'], ['50', '50 %'], ['75', '75 %'], ['100', '100 % (Originalgröße)'], ['125', '125 %'], ['150', '150 %'], ['200', '200 %'], ['400', '400 %']];
    m.innerHTML = opts.map(([a, l]) => a === '-' ? '<span class="menu-sep"></span>' : `<button type="button" data-a="${a}">${l}</button>`).join('');
    document.body.appendChild(m);
    const r = btn.getBoundingClientRect();
    m.style.left = Math.min(r.left, innerWidth - m.offsetWidth - 8) + 'px';
    m.style.top = (r.bottom + 6 + m.offsetHeight > innerHeight ? r.top - m.offsetHeight - 6 : r.bottom + 6) + 'px';
    openMenu = m;
    m.onclick = (ev) => {
      const a = ev.target.closest('button') && ev.target.closest('button').dataset.a;
      if (!a) return;
      closeMenus();
      if (a === 'w') setZoom(1); else if (a === 'p') fitWholePage(); else setZoom(actualZoom() * (+a) / 100);
    };
  }

  // ---- Drucken: Seiten mit Notizen als Bilder in einen Druckbereich, dann der Druckdialog von Windows
  function printDialog() {
    track('tool', 'Drucken');
    if (!V.path || V.board) { toast('Bitte zuerst eine PDF öffnen.'); return; }
    let d = $('#printDlg');
    if (!d) {
      d = document.createElement('dialog');
      d.id = 'printDlg';
      d.className = 'dlg';
      d.innerHTML = `<form method="dialog"><h2>Drucken</h2>
        <label class="check"><input type="radio" name="prR" value="all" checked> <span>Alle Seiten</span></label>
        <label class="check"><input type="radio" name="prR" value="cur"> <span>Aktuelle Seite</span></label>
        <label class="check"><input type="radio" name="prR" value="rng"> <span>Seiten: <input id="prRange" type="text" placeholder="z. B. 1-3, 7" style="width:9em"></span></label>
        <label class="check"><input id="prNotes" type="checkbox" checked> <span>Mit meinen Notizen</span></label>
        <p id="prMsg" class="muted small"></p>
        <div class="dlg-actions"><button type="submit" value="" class="btn">Abbrechen</button><button type="submit" value="yes" class="btn primary">Drucken …</button></div></form>`;
      document.body.appendChild(d);
      d.querySelector('#prRange').addEventListener('focus', () => { d.querySelector('input[value=rng]').checked = true; });
    }
    d.returnValue = '';
    d.showModal();
    d.addEventListener('close', () => { if (d.returnValue === 'yes') runPrint(d); }, { once: true });
  }
  function parseRange(t, n) {
    const out = new Set();
    for (const part of t.split(/[,;\s]+/).filter(Boolean)) {
      const m = /^(\d+)(?:\s*[-–]\s*(\d*))?$/.exec(part);
      if (!m) continue;
      const a = +m[1], b = m[2] === undefined ? a : (m[2] === '' ? n : +m[2]);
      for (let k = Math.min(a, b); k <= Math.max(a, b); k++) if (k >= 1 && k <= n) out.add(k - 1);
    }
    return [...out].sort((x, y) => x - y);
  }
  async function runPrint(d) {
    const n = V.pages.length;
    const mode = d.querySelector('input[name=prR]:checked').value;
    const pages = mode === 'cur' ? [currentPageIndex()] : mode === 'rng' ? parseRange(d.querySelector('#prRange').value, n) : [...Array(n).keys()];
    if (!pages.length) { toast('Keine gültigen Seitenzahlen.'); return; }
    const snap = annotatedSnapshot();
    if (!snap) return;
    track('perf', 'Drucken vorbereiten', 0, `${pages.length} Seiten`);
    toast(`Druck wird vorbereitet … (${pages.length} ${pages.length === 1 ? 'Seite' : 'Seiten'})`, 120000);
    let bytes;
    try { bytes = d.querySelector('#prNotes').checked ? await buildAnnotated(snap) : await snap.bytes; } catch (err) { toast('Drucken nicht möglich: ' + err.message, 6000); return; }
    await printBytes(bytes, pages);
  }
  // Druckt die angegebenen Seiten einer PDF (als Bilder, damit alle Browser gleich drucken)
  async function printBytes(bytes, pages) {
    let area = $('#printArea');
    if (area) area.remove();
    area = document.createElement('div');
    area.id = 'printArea';
    try {
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice ? bytes.slice(0) : bytes), isEvalSupported: false }).promise;
      if (!pages) pages = [...Array(pdf.numPages).keys()];
      for (const [k, i] of pages.entries()) {
        if (k % 5 === 0) toast(`Druck wird vorbereitet … Seite ${k + 1} von ${pages.length}`, 120000);
        const { c } = await renderPageCanvas(pdf, i, pages.length > 60 ? Math.min(SET.printDpi, 150) : SET.printDpi);
        const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
        c.width = 0; c.height = 0;
        const div = document.createElement('div');
        div.className = 'pp';
        const img = new Image();
        img.src = URL.createObjectURL(blob);
        div.appendChild(img);
        area.appendChild(div);
      }
      pdf.destroy();
      document.body.appendChild(area);
      await Promise.all([...area.querySelectorAll('img')].map((im) => im.decode().catch(() => {})));
      $('#toast').hidden = true;
      document.body.classList.add('printing');
      const done = () => { document.body.classList.remove('printing'); area.querySelectorAll('img').forEach((im) => URL.revokeObjectURL(im.src)); area.remove(); };
      window.addEventListener('afterprint', done, { once: true });
      window.print();
    } catch (err) { area.remove(); toast('Drucken nicht möglich: ' + err.message, 6000); }
  }

  // ---- Dateien ins Fenster ziehen: hochladen (eine einzelne PDF danach gleich öffnen)
  let dragN = 0;
  const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  document.addEventListener('dragenter', (e) => { if (!hasFiles(e) || !S.started) return; dragN++; document.body.classList.add('dropping'); });
  document.addEventListener('dragleave', () => { if (dragN > 0 && --dragN === 0) document.body.classList.remove('dropping'); });
  document.addEventListener('dragover', (e) => { if (hasFiles(e) && S.started) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e) || !S.started) return;
    e.preventDefault();
    dragN = 0; document.body.classList.remove('dropping');
    const files = e.dataTransfer.files;
    if (!files || !files.length) return;
    dropUpload([...files]);
  });

  // ---- Windows-App: PDF mit Notizen aus PDF-Stift herausziehen (Explorer, Desktop, Outlook)
  const DRG = { ready: new Map(), prep: new Map() };
  function dragPrepare(path) {
    if (!window.pdfstiftWin || !window.pdfstiftWin.dragPrep || !path || path.startsWith('@nb/')) return null;
    const r = DRG.ready.get(path);
    if (r && Date.now() - r.t < 20000) return Promise.resolve(r.file);
    if (DRG.prep.has(path)) return DRG.prep.get(path);
    const pr = (async () => {
      const bytes = await annotatedBytesFor(path);
      const file = await window.pdfstiftWin.dragPrep(basename(path), bytes);
      DRG.ready.set(path, { file, t: Date.now() });
      return file;
    })().catch(() => null).finally(() => DRG.prep.delete(path));
    DRG.prep.set(path, pr);
    return pr;
  }
  if (window.pdfstiftWin && window.pdfstiftWin.dragPrep) {
    const pathOf = (el) => { const c = el.closest && el.closest('.card:not(.folder), .tab'); if (!c) return ''; const th = c.querySelector('[data-path]'); return c.classList.contains('tab') ? c.dataset.path || '' : th ? th.dataset.path : ''; };
    // schon beim Drücken (und beim Darüberfahren über die geöffnete PDF) vorbereiten, damit das Ziehen sofort klappt
    document.addEventListener('pointerdown', (e) => { if (e.button === 0) { const p = pathOf(e.target); if (p) dragPrepare(p); } }, true);
    let hoverT = 0;
    document.addEventListener('pointerover', (e) => {
      const p = pathOf(e.target);
      clearTimeout(hoverT);
      if (p && (S.offline.has(p) || pdfCache.get(p))) hoverT = setTimeout(() => dragPrepare(p), 400);
    });
    document.addEventListener('dragstart', (e) => {
      const p = pathOf(e.target);
      if (!p) return;
      e.preventDefault();
      const r = DRG.ready.get(p);
      if (r) { window.pdfstiftWin.startDrag(r.file); track('tool', 'Herausgezogen (Windows)'); }
      else { toast('Die PDF wird vorbereitet – bitte gleich noch einmal ziehen.', 3000); dragPrepare(p); }
    }, true);
  }
  // Meldungen aus der Windows-App (z. B. überwachter Ordner)
  if (window.pdfstiftWin && window.pdfstiftWin.onNotice) window.pdfstiftWin.onNotice((d) => { if (d && d.text) toast(d.text, 6000); if (d && d.refresh) loadLibrary(); });
  // Sprungliste der Taskleiste: zuletzt geöffnete PDFs
  function recentPush(path) {
    if (!window.pdfstiftWin || !window.pdfstiftWin.recent || !path || path.startsWith('@nb/')) return;
    const list = (ls('recentDocs') || []).filter((p) => p !== path);
    list.unshift(path);
    ls('recentDocs', list.slice(0, 10));
    window.pdfstiftWin.recent(list.slice(0, 10).map((p) => ({ path: p, title: docTitle(p) })));
  }

  // ---- Tastenkürzel
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea, [contenteditable], dialog')) return;
    const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (e.key === ' ' && !ctrl && V.path && !V.board && !spaceHand && S.tool !== 'tt') { spaceHand = true; viewer.classList.add('hand-temp'); }
    if (!ctrl) {
      if (e.key === 'F3' && V.path) { e.preventDefault(); if (SR.hits.length) showHit(SR.i + (e.shiftKey ? -1 : 1)); else openSearch(); }
      if (e.key === 'Escape' && openMenu) closeMenus();
      return;
    }
    if (k === 'o') { e.preventDefault(); showLibrary(); $('#btnUpload').click(); return; }
    if (k === ',') { e.preventDefault(); settingsDialog(); return; }
    if (k === 'd' && V.path && !V.board) { e.preventDefault(); docProps(); return; }
    if (k === 'm' && V.path && !V.board && !window.pdfstiftWin) { e.preventDefault(); markerStart('f'); return; }
    if (e.shiftKey && (k === '+' || k === '=' || e.code === 'NumpadAdd' || e.code === 'BracketRight')) { e.preventDefault(); rotateView(90); return; }
    if (e.shiftKey && (k === '-' || k === '_' || e.code === 'NumpadSubtract')) { e.preventDefault(); rotateView(-90); return; }
    if (V.board && !e.shiftKey && k === 'f') { e.preventDefault(); openSearch(); return; }
    if (V.board && !e.shiftKey && (k === 'p' || k === 's')) { e.preventDefault(); boardPdfDialog(k === 'p' ? 'print' : 'save'); return; }
    if (!V.path || V.board) return;
    if (k === 'f') { e.preventDefault(); openSearch(); const t = selectedText(); if (t) { $('#q').value = t.trim().slice(0, 80); runSearch($('#q').value); } }
    else if (k === 'p') { e.preventDefault(); printDialog(); }
    else if (k === 's') { e.preventDefault(); exportPdf(); }
    else if (k === 'c' && selectedText()) { /* Standard: kopieren */ }
    else if (k === '+' || k === '=' || e.code === 'NumpadAdd') { e.preventDefault(); setZoom(V.zoom * zstep(V.zoom, true)); }
    else if (k === '-' || e.code === 'NumpadSubtract') { e.preventDefault(); setZoom(V.zoom / zstep(V.zoom, false)); }
    else if (k === '0') { e.preventDefault(); fitWholePage(); }
    else if (k === '1') { e.preventDefault(); setZoom(actualZoom()); }
    else if (k === '2') { e.preventDefault(); setZoom(1); }
    else if (k === 'w') { e.preventDefault(); closeTab(S.active); }
    else if (e.key === 'Tab' && S.tabs.length > 1) {
      e.preventDefault();
      const i = S.tabs.findIndex((t) => t.path === S.active);
      openDoc(S.tabs[(i + (e.shiftKey ? -1 : 1) + S.tabs.length) % S.tabs.length].path);
    }
    else if (e.key === 'Home') { e.preventDefault(); goToPage(0); }
    else if (e.key === 'End') { e.preventDefault(); goToPage(V.pages.length - 1); }
  });
  document.addEventListener('keyup', (e) => { if (e.key === ' ' && spaceHand) { spaceHand = false; viewer.classList.remove('hand-temp'); } });
  // Bild ab / Bild auf: ganze Seiten weiter, wenn nichts anderes den Fokus hat
  document.addEventListener('keydown', (e) => {
    if (!V.path || V.board || PR.on || e.ctrlKey || e.altKey || (e.target.closest && e.target.closest('input, textarea, [contenteditable], dialog'))) return;
    if (e.key === 'PageDown' || e.key === 'PageUp') { e.preventDefault(); goToPage(clamp(currentPageIndex() + (e.key === 'PageDown' ? 1 : -1), 0, V.pages.length - 1)); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); viewer.scrollTop += e.key === 'ArrowDown' ? 60 : -60; }
    if (e.key === ' ') e.preventDefault();
  });


  // ================================================================== Windows-App: Update-Hinweis oben rechts
  const WIN = window.pdfstiftWin || null;
  // Menüleiste nur zeigen, solange das Menüband (mit Datei, Bearbeiten … in der Reiterzeile) nicht zu sehen ist – und nie beim Präsentieren oder im Vollbild
  if (WIN && WIN.menuBar && WIN.menuPop) {
    let mbLast = null;
    setInterval(() => { const t = document.querySelector('.rb-wm'); const vis = !!(t && t.offsetParent) || !!(PR && PR.on) || !!(FS && FS.on) || !!document.fullscreenElement; if (vis !== mbLast) { mbLast = vis; WIN.menuBar(!vis); } }, 400);
  }
  const UPD = { d: null };
  function updDialog() {
    const d0 = UPD.d;
    if (!d0 || d0.state !== 'available') return;
    let dl = $('#updDlg');
    if (!dl) {
      dl = document.createElement('dialog');
      dl.id = 'updDlg';
      dl.className = 'dlg';
      document.body.appendChild(dl);
    }
    dl.innerHTML = `<form method="dialog"><h2>Update verfügbar</h2>
      <p>PDF-Stift <b>${esc(d0.version)}</b> ist da. Installiert ist ${esc(d0.current || '')}.</p>
      ${d0.notes ? `<p class="muted">Neu: ${esc(d0.notes)}</p>` : ''}
      <p class="muted small">Beim Installieren startet PDF-Stift kurz neu. Deine Notizen sind schon gespeichert.</p>
      <div class="dlg-actions"><button type="submit" value="later" class="btn">Nicht jetzt</button><button type="submit" value="skip" class="btn">Überspringen</button><button type="submit" value="install" class="btn primary">Installieren</button></div></form>`;
    dl.returnValue = '';
    dl.showModal();
    dl.addEventListener('close', () => {
      const v = dl.returnValue;
      if (v === 'install') { if (pendingCount()) flush(); WIN.install(); }
      else if (v === 'skip') { WIN.skip(d0.version); updShow(null); toast(`Version ${d0.version} wird übersprungen. „Nach Updates suchen“ zeigt sie wieder an.`, 5000); }
      else if (v === 'later') { WIN.later(); updShow(null); }
    }, { once: true });
  }
  function updShow(d) {
    UPD.d = d;
    const b = $('#winUpd');
    if (!d || d.state === 'none') { b.hidden = true; }
    else if (d.state === 'available') { b.hidden = false; b.disabled = false; $('#winUpdText').textContent = 'Update verfügbar'; b.title = `Version ${d.version} installieren`; }
    else if (d.state === 'progress') { b.hidden = false; b.disabled = true; $('#winUpdText').textContent = `Update wird geladen … ${d.percent || 0} %`; }
    else if (d.state === 'ready') { b.hidden = false; b.disabled = true; $('#winUpdText').textContent = 'Startet neu …'; }
    else if (d.state === 'error') { b.hidden = true; toast('Update nicht möglich: ' + (d.message || 'keine Verbindung'), 6000); }
    if (d && d.state === 'none') toast(`PDF-Stift ist auf dem neuesten Stand (${d.current}).`);
  }
  if (WIN) {
    $('#winUpd').onclick = updDialog;
    WIN.onUpdate((d) => { const was = UPD.d; updShow(d); if (d.state === 'available' && (!was || was.version !== d.version) && document.visibilityState === 'visible') { /* nur anzeigen, Dialog erst auf Klick */ } });
    WIN.state().then((d) => { if (d) updShow(d); }).catch(() => {});
    WIN.version().then((v) => {
      const p = $('#devWinApp');
      if (!p) return;
      p.hidden = false;
      p.innerHTML = `Windows-App, Version ${esc(v)} · <button type="button" class="text-btn" id="devWinCheck">Nach Updates suchen</button>`;
      $('#devWinCheck').onclick = () => { toast('Suche nach Updates …'); WIN.check(); };
    }).catch(() => {});
  }

  // ================================================================== Windows-App: Befehle aus der Menüleiste (Datei, Bearbeiten, Ansicht, Werkzeuge)
  // Befehle der Menüleiste für das Menüband (PDF-Objekte und Präsentationen): ins:…, f:…, show:…, v:…, btn:Reiter:Knopf, rb:…
  async function rbCmd(c) {
    let DK;
    try { DK = await ensureDeck(); } catch (e) { return; }
    const deck = !!V.deck;
    if (!deck && (!V.doc || V.board)) { toast('Bitte zuerst eine PDF oder Präsentation öffnen.'); return; }
    const ed = deck ? DK.deckEditor() : (OB.ed || obIdle());
    if (!ed) return;
    const [k, a, ...rest] = c.split(':');
    const b = rest.join(':');
    if (k === 'ins') { const kind = a + (b ? ':' + b : ''); if (deck) ed.ins(kind); else obIns(kind); return; }
    if (k === 'f') { ed.fmt(a, b || undefined); return; }
    if (k === 'show') { ed.fmt((deck ? 'pr:' : 'ps:') + a); return; }
    if (k === 'v') { ed.fmt((deck ? 'vw:' : 'pv:') + a); return; }
    if (k === 'rb') { if (a === 'collapse') DK.rbCollapse(); if (a === 'compact' && !deck) ed.fmt('pv:compact'); return; }
    if (k === 'btn') {
      // Knopf im Menüband auslösen (z. B. Sonderzeichen, alle Formen, Anordnen)
      const bar = deck ? document.querySelector('#deckView .dk-fmt') : $('#obRibbon .rb-fmt');
      if (!bar) return;
      if (DK.RB.collapsed) { DK.RB.peek = true; }
      const tb = bar.querySelector(`[data-tab="${a}"]`);
      if (tb && !tb.classList.contains('on')) { DK.RB.tab = a; ed.renderFmt(); }
      const btn = bar.querySelector(b);
      if (btn && !btn.disabled) btn.click(); else toast('Das geht hier gerade nicht – bitte zuerst ein passendes Objekt auswählen.');
    }
  }
  // Windows-App: F5 startet die Präsentation (wie in PowerPoint), Umschalt+F5 ab der aktuellen Seite
  if (WIN) document.addEventListener('keydown', (e) => {
    if (e.key !== 'F5' || e.ctrlKey || e.altKey || !V.path || V.deck || V.board || PR.on) return;
    e.preventDefault();
    rbCmd(e.shiftKey ? 'show:cur' : 'show:begin');
  });
  function winCmd(c) {
    if (c.startsWith('rb:')) { rbCmd(c.slice(3)); return; }
    if (c === 'split') { splitToggle(); return; }
    if (SPLIT.frame && (SPLIT.act === 'r' || document.activeElement === SPLIT.frame) && splitPane() && !['split', 'presenter', 'library', 'settings', 'nextTab', 'prevTab', 'close'].includes(c)) { splitPane().cmd(c); return; }
    const ae = document.activeElement;
    const typing = ae && ae.matches && ae.matches('input, textarea, [contenteditable]');
    const needDoc = () => { if (!V.path) { toast('Bitte zuerst eine PDF öffnen.'); return false; } return true; };
    switch (c) {
      case 'upload': showLibrary(); $('#btnUpload').click(); break;
      case 'library': showLibrary(); break;
      case 'save': if (V.board) boardPdfDialog('save'); else if (needDoc()) exportPdf(); break;
      case 'original': if (needDoc()) downloadOriginal(V.path); break;
      case 'print': if (V.board) boardPdfDialog('print'); else if (needDoc()) printDialog(); break;
      case 'close': if (S.active) closeTab(S.active); break;
      case 'undo': if (typing) document.execCommand('undo'); else undo(); break;
      case 'redo': if (typing) document.execCommand('redo'); else redo(); break;
      case 'find': if (needDoc()) { openSearch(); const t = selectedText(); if (t) { $('#q').value = t.trim().slice(0, 80); runSearch($('#q').value); } } break;
      case 'findNext': if (SR.hits.length) showHit(SR.i + 1); else if (V.path) openSearch(); break;
      case 'findPrev': if (SR.hits.length) showHit(SR.i - 1); break;
      case 'fitw': if (needDoc()) setZoom(1); break;
      case 'fitp': if (needDoc()) fitWholePage(); break;
      case 'actual': if (needDoc()) setZoom(actualZoom()); break;
      case 'zin': if (needDoc()) setZoom(V.zoom * zstep(V.zoom, true)); break;
      case 'zout': if (needDoc()) setZoom(V.zoom / zstep(V.zoom, false)); break;
      case 'thumbs': if (needDoc()) $('#thBtn').click(); break;
      case 'focus': if (needDoc()) setFocusMode(!FS.on); break;
      case 'present': if (needDoc()) setPresent(!PR.on); break;
      case 'first': if (needDoc()) goToPage(0); break;
      case 'last': if (needDoc()) goToPage(V.pages.length - 1); break;
      case 'next': if (needDoc()) goToPage(Math.min(currentPageIndex() + 1, V.pages.length - 1)); break;
      case 'prev': if (needDoc()) goToPage(Math.max(currentPageIndex() - 1, 0)); break;
      case 'rotate': if (needDoc()) pageOp({ kind: 'rotate', i: currentPageIndex() }); break;
      case 'allTools': toolsOpen(); break;
      case 'settings': settingsDialog(); break;
      case 'props': docProps(); break;
      case 'mkf': markerStart('f'); break;
      case 'mkv': markerStart('v'); break;
      case 'study': studySheet(); break;
      case 'carry': carryDialog(); break;
      case 'tonb': if (needDoc()) toNotebook(); break;
      case 'newdeck': newDeck(); break;
      case 'pptximport': pptxPick(); break;
      case 'decks': S.src = 'dk'; ls('src', 'dk'); showLibrary(); renderLibrary(); break;
      case 'nbpdf': case 'nbtpl': case 'nbsearch': case 'nbhist':
        if (!V.board) { toast('Bitte zuerst eine Notizseite öffnen.'); break; }
        if (c === 'nbpdf') nbInsertPdf(); else if (c === 'nbtpl') boardInsertTpl(); else if (c === 'nbhist') boardHistory(); else openSearch();
        break;
      case 'nblink': if (needDoc()) insertLink(); break;
      case 'nbback': if (needDoc()) showBacklinks(); break;
      case 'snippets': if (!ls('toolPanel')) { ls('toolPanel', true); } tpRender(); snipEdit(null); break;
      case 'report': usageReport(); break;
      case 'findredact': if (needDoc()) findRedact(); break;
      case 'handout': if (needDoc()) handoutDialog(); break;
      case 'scanfix': if (needDoc()) scanFixDialog(); break;
      case 'comments': if (needDoc()) toggleComments(); break;
      case 'vbcfg': vbConfig(); break;
      case 'presenter': if (document.body.classList.contains('prs-on')) prsStop(); else prsStart(); break;
      case 'two': if (needDoc()) setViewMode(viewMode() === 'single' ? 'two' : 'single'); break;
      case 'cover': if (needDoc()) setViewMode('cover'); break;
      case 'single': if (needDoc()) setViewMode('single'); break;
      case 'rotR': if (needDoc()) rotateView(90); break;
      case 'rotL': if (needDoc()) rotateView(-90); break;
      case 'live': if (needDoc()) sessStart(); break;
      case 'nextTab': case 'prevTab': if (S.tabs.length > 1) { const i = S.tabs.findIndex((t) => t.path === S.active); openDoc(S.tabs[(i + (c === 'nextTab' ? 1 : -1) + S.tabs.length) % S.tabs.length].path); } break;
      default:
        if (c.startsWith('tool:')) { S.tool = c.slice(5); persistTools(); renderToolbar(); }
    }
  }
  if (window.pdfstiftWin && window.pdfstiftWin.onCommand) window.pdfstiftWin.onCommand(winCmd);
  if (EMBED) {
    window.PDFSTIFT_PANE = {
      open: (p) => openDoc(p), lib: () => { if (V.path) { S.tabs = []; showLibrary(); renderTabs(); } }, cmd: (c) => winCmd(c), path: () => V.path,
      tools: (t) => toolsTake(t),
      click: (sel) => { const el = document.querySelector(sel); if (el) el.click(); },
      menu: (a) => { const el = $('#menu').querySelector(`[data-act="${a}"]`); if (el) el.click(); },
      tool: (id) => { const x = [...TP_PAGE, ...TP_ADD, ...TP_MARK].find((t) => t[0] === id); if (x) x[4](); else runTool(id); },
      snip: (i) => snipStart(i),
      addSlide: async (it, sx, sy) => {
        if (!V.board) return;
        if (sx == null) { await nbAppendImages(V.path, [it]); boardRender(); return; }
        const r = boardEl.getBoundingClientRect();
        const ww = Math.min(800, (B.w * 0.6) / B.cam.s), bh = r2(ww * it.h / it.w);
        const [wx, wy] = toWorld(sx - r.left - (ww * B.cam.s) / 2, sy - r.top - 20);
        const st = { id: uid(), p: 0, t: 'img', c: '#000000', src: it.src, pts: [0, 0], bw: r2(ww), bh, o: [r2(wx), r2(wy)], z: 1, ln: it.ln };
        opAdd(V.path, [st]); pushHistory({ t: 'add', strokes: [st] }); boardRender();
      },
      active: (on) => { document.body.classList.toggle('pane-act', !!on); if (on) updateUndo(); },
    };
    // Klick in die rechte Hälfte macht sie zur aktiven
    document.addEventListener('pointerdown', () => { try { window.parent.PDFSTIFT_MAIN.paneActive(); } catch (e) { /* */ } }, true);
  }

  // ---- Zwei Dokumente nebeneinander: rechts eine zweite, vollständige Ansicht (eigenes Blättern, Schreiben, Zoom)
  // welche Hälfte ist aktiv? Die Leisten wirken auf sie; leicht hellerer Hintergrund zeigt es
  function splitAct(side) {
    if (!SPLIT.frame) side = 'l';
    if (SPLIT.act === side && document.body.classList.contains('sp-act-' + side)) return;
    SPLIT.act = side;
    document.body.classList.toggle('sp-act-l', !!SPLIT.frame && side === 'l');
    document.body.classList.toggle('sp-act-r', !!SPLIT.frame && side === 'r');
    try { const pn = splitPane(); if (pn) pn.active(side === 'r'); } catch (e) { /* */ }
    updateUndo();
    if (!EMBED) renderTabs();
  }
  $('#viewer').addEventListener('pointerdown', () => { if (SPLIT.frame) splitAct('l'); }, true);
  // Bedienelemente der Leisten an die rechte Hälfte weiterreichen, wenn sie aktiv ist
  document.addEventListener('click', (e) => {
    if (!SPLIT.frame || SPLIT.act !== 'r' || EMBED) return;
    const pn = splitPane(); if (!pn) return;
    const t = e.target.closest('#undo, #redo, #zoomIn, #zoomOut, #zoomFit, #searchBtn, #overviewBtn, #bdImgBtn, #thBtn, #cmBtn, .vb-b[data-vb], #menu [data-act], #tpBody .tp-it, #tpBody .tp-snip');
    if (!t || t.closest('.tp-pin') || e.target.closest('.tp-pin')) return;
    const vb = t.dataset.vb;
    if (vb === 'split' || t.id === 'vrCfg' || (t.classList.contains('tp-snip') && t.dataset.sn === '+')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    closeMenus();
    if (t.id === 'zoomFit') pn.cmd('fitw');
    else if (t.id) pn.click('#' + t.id);
    else if (vb) pn.click(`.vb-b[data-vb="${vb}"]`);
    else if (t.dataset.act) pn.menu(t.dataset.act);
    else if (t.classList.contains('tp-it')) { tpUsed(t.dataset.id); pn.tool(t.dataset.id); }
    else if (t.classList.contains('tp-snip')) pn.snip(+t.dataset.sn);
  }, true);
  const splitPane = () => { try { return SPLIT.frame && SPLIT.frame.contentWindow && SPLIT.frame.contentWindow.PDFSTIFT_PANE; } catch (e) { return null; } };
  const spW = () => Math.max(320, Math.min(window.innerWidth - 420, ls('spW') || Math.round(window.innerWidth * 0.45)));
  function splitHead() {
    const sel = $('#spDoc');
    if (!sel) return;
    const others = S.tabs.map((t) => t.path).filter((p) => p !== S.active);
    const cur = SPLIT.path;
    const opts = [...new Set([...(cur ? [cur] : []), ...others])];
    sel.innerHTML = (cur ? '' : '<option value="">– Dokument wählen –</option>') + opts.map((p) => `<option value="${esc(p)}"${p === cur ? ' selected' : ''}>${isBoard(p) ? '🗒 ' : ''}${esc(docTitle(p))}</option>`).join('') + '<option value="#lib">PDF aus der Bibliothek …</option><option value="#nb">Notizseite …</option>';
  }
  function splitOpen(path) {
    if (EMBED || !V.path) { if (!V.path) toast('Bitte zuerst links eine PDF öffnen.'); return; }
    if (path === S.active) path = null;
    if (!path) path = S.tabs.map((t) => t.path).find((p) => p !== S.active && !isBoard(p)) || null;
    let box = $('#splitPane');
    if (!box) {
      box = document.createElement('aside');
      box.id = 'splitPane'; box.className = 'split-pane';
      box.innerHTML = `<div class="sp-resize" title="Breite ändern"></div>
        <div class="sp-head"><select id="spDoc" aria-label="Dokument rechts"></select>
          <button type="button" class="icon-btn" id="spSwap" title="Links und rechts tauschen" aria-label="Links und rechts tauschen"><svg viewBox="0 0 24 24"><path d="M7 8h12l-3-3M17 16H5l3 3"/></svg></button>
          <button type="button" class="icon-btn" id="spClose" title="Rechte Hälfte schließen" aria-label="Rechte Hälfte schließen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
        <iframe id="spFrame" title="Zweites Dokument"></iframe>`;
      document.body.appendChild(box);
      SPLIT.frame = box.querySelector('iframe');
      SPLIT.frame.addEventListener('load', () => setTimeout(() => { toolsShare(); const pn = splitPane(); if (pn) pn.active(SPLIT.act === 'r'); }, 300));
      box.querySelector('#spClose').onclick = () => splitClose();
      box.querySelector('#spSwap').onclick = () => splitSwap();
      box.querySelector('#spDoc').onchange = (e) => {
        const v = e.target.value;
        if (v === '#lib') { const pn = splitPane(); if (pn) pn.lib(); SPLIT.path = null; splitHead(); return; }
        if (v === '#nb') { splitHead(); splitPickNb(); return; }
        if (v) splitLoad(v);
      };
      const rs = box.querySelector('.sp-resize');
      rs.addEventListener('pointerdown', (e) => {
        e.preventDefault(); rs.setPointerCapture(e.pointerId); document.body.classList.add('sp-drag');
        const x0 = e.clientX, w0 = spW();
        const mv = (ev) => { ls('spW', Math.max(320, Math.min(window.innerWidth - 420, w0 - (ev.clientX - x0)))); splitPlace(); };
        const up = () => { rs.removeEventListener('pointermove', mv); rs.removeEventListener('pointerup', up); document.body.classList.remove('sp-drag'); window.dispatchEvent(new Event('resize')); };
        rs.addEventListener('pointermove', mv); rs.addEventListener('pointerup', up);
      });
      rs.addEventListener('dblclick', () => { ls('spW', null); splitPlace(); window.dispatchEvent(new Event('resize')); });
    }
    track('tool', 'Zwei Dokumente nebeneinander');
    document.body.classList.add('split-on');
    SPLIT.act = '';
    splitAct('l');
    splitPlace();
    splitLoad(path);
    $('#viewBar') && $('#viewBar').querySelector('[data-vb=split]') && $('#viewBar').querySelector('[data-vb=split]').classList.add('on');
    window.dispatchEvent(new Event('resize'));
  }
  function splitLoad(path) {
    SPLIT.path = path || null;
    ls('splitPath', SPLIT.path || '#');
    const pn = splitPane();
    if (pn && path) pn.open(path);
    else {
      const base = location.pathname.replace(/[^/]*$/, '') + (LANG === 'en' ? 'index.en.php' : 'index.php');
      SPLIT.frame.src = base + '?pane=1' + (path ? '&open=' + encodeURIComponent(path) : '');
    }
    splitHead();
    if (!EMBED) renderTabs();
  }
  function splitClose() {
    const box = $('#splitPane');
    if (!box) return;
    // erst leeren, damit die rechte Hälfte ihre Notizen sauber sichert
    try { SPLIT.frame.src = 'about:blank'; } catch (e) { /* */ }
    setTimeout(() => box.remove(), 400);
    box.hidden = true;
    SPLIT.frame = null; SPLIT.path = null; SPLIT.undo = null;
    ls('splitPath', null);
    splitAct('l');
    document.body.classList.remove('split-on');
    const b = $('#viewBar') && $('#viewBar').querySelector('[data-vb=split]'); if (b) b.classList.remove('on');
    window.dispatchEvent(new Event('resize'));
  }
  function splitToggle() { if (SPLIT.frame) splitClose(); else splitOpen(ls('splitPath') && ls('splitPath') !== '#' ? ls('splitPath') : null); }
  // Notizseite für die rechte Hälfte wählen – vorhandene oder neue (z. B. „Mitschrift zu den Folien“)
  async function splitPickNb() {
    if (!S.boards) await loadBoards();
    const pages = [], secs = [];
    for (const nb of S.boards || []) for (const sec of nb.sections) { secs.push([`${nb.name}/${sec.name}`, `${nb.name} › ${sec.name}`]); for (const pg of sec.pages) pages.push([pg.path, `${nb.name} › ${sec.name} › ${pg.title}`]); }
    const last = ls('toNb') || {};
    const d = document.createElement('dialog');
    d.className = 'dlg set-dlg tonb-dlg';
    d.innerHTML = `<form method="dialog"><h2>Notizseite rechts daneben</h2>
      <div class="set-row"><span></span><div class="tn-pages"><label><input type="radio" name="spn" value="new" checked> Neue Notizseite</label><label><input type="radio" name="spn" value="old"${pages.length ? '' : ' disabled'}> Vorhandene Notizseite</label></div></div>
      <div class="set-row" id="spnNewA"><span>Abschnitt</span><select id="spnSec">${secs.map(([v, l]) => `<option value="${esc(v)}"${last.nb && v === `${last.nb}/${last.sec}` ? ' selected' : ''}>${esc(l)}</option>`).join('')}<option value="+">＋ Neues Notizbuch „Mitschriften“</option></select></div>
      <div class="set-row" id="spnNewB"><span>Titel</span><input id="spnT" type="text" value="${esc((V.path && !isBoard(V.path) ? stem(V.path) : 'Mitschrift') + ' – Notizen')}"></div>
      <div class="set-row" id="spnOld" hidden><span>Seite</span><select id="spnPg">${pages.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select></div>
      <p class="muted small">Tipp: Folien aus der Seitenleiste links einfach nach rechts auf die Notizseite ziehen.</p>
      <div class="dlg-actions"><button type="submit" value="" class="btn">Abbrechen</button><button type="submit" value="ok" class="btn primary">Öffnen</button></div></form>`;
    document.body.appendChild(d);
    const q = (x) => d.querySelector(x);
    d.querySelectorAll('input[name=spn]').forEach((r) => { r.onchange = () => { const n = q('input[name=spn]:checked').value === 'new'; q('#spnNewA').hidden = !n; q('#spnNewB').hidden = !n; q('#spnOld').hidden = n; }; });
    d.addEventListener('close', async () => {
      const ok = d.returnValue === 'ok', isNew = q('input[name=spn]:checked').value === 'new', sec = q('#spnSec').value, title = q('#spnT').value.trim(), pg = q('#spnPg').value;
      d.remove();
      if (!ok) return;
      let path = pg;
      if (isNew) {
        if (navigator.onLine === false) { toast('Neue Notizseiten gehen nur mit Internetverbindung.'); return; }
        const [nb, sc] = sec === '+' ? ['Mitschriften', 'Allgemein'] : [sec.split('/')[0], sec.split('/').slice(1).join('/')];
        try { path = (await apiJson('nbnew', { method: 'POST', body: { kind: 'page', nb, sec: sc, title: title || 'Mitschrift', bg: 'lines' } })).path; await loadBoards(); }
        catch (e) { toast(e.message, 6000); return; }
      }
      if (path) { if (!SPLIT.frame) splitOpen(path); else splitLoad(path); }
    }, { once: true });
    d.showModal();
  }
  // Folie (mit Notizen) links → Notizseite rechts; sx/sy: Ablegestelle im rechten Fenster, sonst unter den Inhalt
  async function slideToPane(i, sx, sy) {
    const pn = splitPane();
    if (!pn || !SPLIT.path || !isBoard(SPLIT.path) || !V.pdf) return;
    if (navigator.onLine === false) { toast('Folien übernehmen geht nur mit Internetverbindung.'); return; }
    toast('Folie wird übernommen …', 20000);
    try {
      const res = await nbUploadImg(await pageToJpeg(i, true), 'seite-' + (i + 1) + '.jpg');
      await pn.addSlide({ src: res.src, w: res.w, h: res.h, ln: { path: V.path, pg: i } }, sx, sy);
      $('#toast').hidden = true;
      track('tool', 'Folie nach rechts ins Notizbuch');
    } catch (e) { toast('Übernehmen fehlgeschlagen: ' + e.message, 6000); }
  }
  function splitSwap() {
    const right = SPLIT.path, left = S.active;
    if (!right || !left) { toast('Zum Tauschen muss rechts ein Dokument offen sein.'); return; }
    SPLIT.path = left;
    const pn = splitPane(); if (pn) pn.lib();
    openDoc(right);
    setTimeout(() => splitLoad(left), 300);
  }
  function splitPlace() {
    const box = $('#splitPane');
    if (!box) return;
    document.documentElement.style.setProperty('--spw', spW() + 'px');
  }
  window.PDFSTIFT_MAIN = {
    paneActive: () => splitAct('r'),
    paneTools: (t) => toolsTake(t),
    paneUndo: (u, r) => { SPLIT.undo = [u, r]; if (SPLIT.act === 'r') updateUndo(); },
    paneDoc: (p) => {
      if (p === S.active) { setTimeout(() => { const pn = splitPane(); if (pn) pn.lib(); }, 0); toast('Diese PDF ist schon links offen – bitte rechts eine andere wählen.', 4000); SPLIT.path = null; splitHead(); return; }
      SPLIT.path = p; ls('splitPath', p);
      if (!S.tabs.find((t) => t.path === p)) { S.tabs.push({ path: p, zoom: 1, scroll: 0 }); saveTabs(); renderTabs(); }
      splitHead();
    },
  };
  window.addEventListener('resize', () => splitPlace());
  // Werkzeug-Kürzel: V = Auswählen, H = Hand, P = Stift, M = Marker, U = Text markieren, T = Textfeld, E = Radierer
  document.addEventListener('keydown', (e) => {
    if (!V.path || V.board || e.ctrlKey || e.metaKey || e.altKey || (e.target.closest && e.target.closest('input, textarea, [contenteditable], dialog'))) return;
    const t = { v: 'sel', h: 'hand', p: 'pen', m: 'hl', u: 'tx', t: 'tt', e: 'er' }[e.key.toLowerCase()];
    if (t && !e.repeat) { S.tool = t; persistTools(); renderToolbar(); }
  });
  // ================================================================== Einstellungen (Datei → Einstellungen)
  // auf allen Geräten gleich (Server): redactPurge, autoOcr, keepVersions · nur auf diesem Gerät: Ansicht, Startwerkzeug, Start, Druck
  const SET = Object.assign({ viewMode: 'single', startTool: 'last', startView: 'last', printDpi: 160, redactPurge: true, autoOcr: true, keepVersions: 5, autoUpdate: true, pdfNextTo: false, dropFolder: DROP0, usage: true }, ls('settings') || {});
  function saveSet() { ls('settings', SET); UG.on = !LOCAL && SET.usage !== false; }
  UG.on = !LOCAL && SET.usage !== false; // freie Ausgabe: kein Nutzungsprotokoll
  if (window.pdfstiftWin && window.pdfstiftWin.setFolder) window.pdfstiftWin.setFolder(SET.dropFolder || DROP0);
  async function loadServerSettings() {
    try {
      const p = await apiJson('prefs');
      if (p && p.settings) { Object.assign(SET, p.settings); saveSet(); }
      if (p) uiPull(p);
    } catch (e) { /* offline: letzter Stand */ }
  }
  // Oberflächen-Einstellungen vom Server übernehmen (neuerer Stand gewinnt) – und eigene neuere hochladen
  function uiPull(p) {
    if (LOCAL || document.body.dataset.demo) return;
    const sv = p.ui || {}, st = p.uiT || {}, lt = uiTimes();
    const got = [], send = [];
    UIS.pulling = true;
    try {
      for (const k of UI_KEYS) {
        const tS = +st[k] || 0, tL = +lt[k] || 0;
        if (tS > tL && k in sv) { localStorage.setItem('pdfstift.' + k, JSON.stringify(sv[k])); lt[k] = tS; UIS.last[k] = JSON.stringify(sv[k]); got.push(k); }
        else if (tL > tS || (!tS && localStorage.getItem('pdfstift.' + k) != null)) { if (!tL) lt[k] = Date.now(); send.push(k); }
      }
      localStorage.setItem('pdfstift.uiT', JSON.stringify(lt));
    } catch (e) { /* */ }
    UIS.pulling = false;
    if (send.length) uiPush(send);
    if (!got.length) return;
    const has = (...ks) => ks.some((k) => got.includes(k));
    if (has('favs', 'color', 'wi', 'txKind', 'shKind', 'ttSize', 'showTools')) {
      if (Array.isArray(ls('favs'))) S.favs = ls('favs');
      if (ls('color')) S.color = Object.assign(S.color, ls('color'));
      if (ls('wi')) S.wi = Object.assign(S.wi, ls('wi'));
      if (ls('txKind')) S.txKind = ls('txKind');
      if (ls('shKind')) S.shKind = ls('shKind');
      if (ls('ttSize')) S.ttSize = ls('ttSize');
      if (ls('showTools') != null) S.showTools = !!ls('showTools');
      renderToolbar();
    }
    if (has('theme')) setTheme(ls('theme'));
    if (has('dockLay', 'vbPos', 'vbHide')) { dockApply(); vbSync(); }
    if (has('tpPins', 'tpRecent', 'tpW', 'tpSide', 'toolPanel')) tpRender();
    if (has('thSide', 'thW', 'thumbs') && V.path) thRender();
  }
  // beim Zurückkehren in die App (anderes Gerät hat evtl. etwas geändert)
  let uiPullT = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || LOCAL || EMBED || Date.now() - uiPullT < 20000) return;
    uiPullT = Date.now();
    apiJson('prefs').then(uiPull).catch(() => {});
  });
  // Symbolleiste oben: Ansicht & Bearbeiten – eigene Zeile unter den Tabs ('2'), in der Tab-Zeile ('1') oder aus ('0')
  const vbPos = () => (['0', '1', '2', 'd'].includes(ls('vbPos')) ? ls('vbPos') : (['b', 'l', 'r'].includes(ls('vbPos')) ? 'd' : '2'));
  function vbSync() {
    const bar = $('#viewBar');
    const doc = !!V.path && !V.board && !$('#viewer').hidden;
    const pos = vbPos();
    bar.hidden = !doc || pos === '0';
    if (bar.parentElement.classList.contains('dock-line') !== (pos === 'd')) dockApply();
    document.body.classList.toggle('vr-2', doc && pos === '2');
    document.body.classList.toggle('vr-1', !(doc && pos === '2'));
    const m = viewMode();
    bar.querySelectorAll('.vb-seg .vb-b').forEach((b) => b.classList.toggle('on', b.dataset.vb === m));
    const off = new Set(ls('vbHide') || []);
    bar.querySelectorAll('[data-vb]').forEach((b) => { b.hidden = off.has(b.dataset.vb); });
    const seg = bar.querySelector('.vb-seg'); seg.hidden = [...seg.children].every((b) => b.hidden);
    // Trennlinien nur zwischen sichtbaren Gruppen
    let prevSep = true, last = null;
    [...bar.children].forEach((el) => {
      if (el.classList.contains('vb-sep')) { el.hidden = prevSep; if (!el.hidden) { prevSep = true; last = el; } }
      else if (!el.hidden) { prevSep = false; last = el; }
    });
    if (last && last.classList.contains('vb-sep')) last.hidden = true;
  }
  function vbConfig() {
    let d = $('#vbcDlg'); if (d) d.remove();
    d = document.createElement('dialog'); d.id = 'vbcDlg'; d.className = 'dlg';
    const off = new Set(ls('vbHide') || []);
    const items = [...$('#viewBar').querySelectorAll('.vb-b[data-vb]')].map((b) => `<label><input type="checkbox" data-k="${b.dataset.vb}"${off.has(b.dataset.vb) ? '' : ' checked'}><svg viewBox="0 0 24 24">${b.querySelector('svg').innerHTML}</svg><span>${esc(b.getAttribute('aria-label'))}</span></label>`).join('');
    d.innerHTML = `<form method="dialog"><h3>Symbolleiste anpassen</h3>
      <div class="set-row"><span>Wo</span><select id="vbcPos"><option value="2">eigene Zeile unter den Tabs</option><option value="1">in der Tab-Zeile</option><option value="top">oben bei den anderen Leisten</option><option value="bottom">unten</option><option value="left">links</option><option value="right">rechts</option><option value="0">ausblenden</option></select></div>
      <p class="muted small">Welche Knöpfe zeigen?</p><div class="vbc-list">${items}</div>
      <div class="dlg-actions"><button type="button" class="btn" id="vbcAll">Alle zeigen</button><button type="submit" value="ok" class="btn primary">Fertig</button></div></form>`;
    document.body.appendChild(d);
    d.querySelector('#vbcPos').value = vbPos() === 'd' ? edgeOfBar('vb') : vbPos();
    const apply = () => {
      const pv = d.querySelector('#vbcPos').value;
      if (TB_POS.includes(pv)) { if (vbPos() !== 'd' || edgeOfBar('vb') !== pv) barMove('vb', pv, 'new'); } else { ls('vbPos', pv); dockApply(); }
      ls('vbHide', [...d.querySelectorAll('[data-k]')].filter((c) => !c.checked).map((c) => c.dataset.k));
      vbSync();
    };
    d.querySelector('#vbcPos').onchange = apply;
    d.querySelectorAll('[data-k]').forEach((c) => { c.onchange = apply; });
    d.querySelector('#vbcAll').onclick = () => { d.querySelectorAll('[data-k]').forEach((c) => { c.checked = true; }); apply(); };
    d.addEventListener('close', () => d.remove(), { once: true });
    d.showModal();
  }
  $('#vrCfg').onclick = () => vbConfig();
  $('#viewRow').addEventListener('contextmenu', (e) => { if (e.target.closest('#viewBar, .vr-sp, .vr-cfg') || e.target === e.currentTarget) { e.preventDefault(); vbConfig(); } });
  $('#viewBar').addEventListener('click', (e) => {
    const b = e.target.closest('.vb-b');
    if (!b || b.disabled) return;
    const a = b.dataset.vb;
    track('tool', 'Symbolleiste: ' + (b.getAttribute('aria-label') || a));
    if (a === 'single' || a === 'two' || a === 'cover') { if (V.pages.length) setViewMode(a); }
    else winCmd(a);
    vbSync();
  });
  function viewMode() { return PR && PR.on ? 'single' : (['single', 'two', 'cover'].includes(SET.viewMode) ? SET.viewMode : 'single'); }
  function setViewMode(m) { track('tool', m === 'single' ? 'Einzelseiten' : m === 'cover' ? 'Zwei Seiten (Titelseite einzeln)' : 'Zwei Seiten'); SET.viewMode = m; saveSet(); vbSync(); if (V.pages.length) { const i = currentPageIndex(); layout(); goToPage(i); } }
  function rotateView(d) {
    if (!V.pages.length || V.board) return;
    const i = currentPageIndex();
    V.viewRot = (((V.viewRot || 0) + d) % 360 + 360) % 360;
    track('tool', 'Ansicht drehen');
    layout(); goToPage(i);
    if (V.viewRot) toast('Ansicht gedreht (die PDF bleibt unverändert). Zum Schreiben bitte zurückdrehen.', 3500);
  }
  if (SET.startTool && SET.startTool !== 'last') S.tool = SET.startTool;

  async function settingsDialog() {
    track('tool', 'Einstellungen');
    const hot = window.pdfstiftWin && window.pdfstiftWin.hotGet ? await window.pdfstiftWin.hotGet().catch(() => null) : null;
    let d = $('#setDlg');
    if (d) d.remove();
    d = document.createElement('dialog');
    d.id = 'setDlg';
    d.className = 'dlg set-dlg';
    const sel = (id, opts, v) => `<select id="${id}">${opts.map(([k, l]) => `<option value="${k}"${String(k) === String(v) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    const chk = (id, label, v, hint) => `<label class="check"><input id="${id}" type="checkbox"${v ? ' checked' : ''}> <span>${label}${hint ? `<br><span class="muted small">${hint}</span>` : ''}</span></label>`;
    d.innerHTML = `<form method="dialog"><h2>Einstellungen</h2>
      <div class="set-row"><span>Sprache / Language</span>${sel('stLang', [['de', 'Deutsch'], ['en', 'English']], LANG)}</div>
      <div class="set-row"><span>Design</span>${sel('stTheme', [['', 'wie das System'], ['light', 'Hell'], ['dark', 'Dunkel']], curTheme())}</div>
      <h3 class="dlg-sub">Ansicht (auf diesem Gerät)</h3>
      <div class="set-row"><span>Seitenanzeige</span>${sel('stView', [['single', 'Einzelseiten untereinander'], ['two', 'Zwei Seiten nebeneinander'], ['cover', 'Zwei Seiten, Titelseite einzeln']], SET.viewMode)}</div>
      <div class="set-row"><span>Werkzeug beim Start</span>${sel('stTool', [['last', 'zuletzt benutztes'], ['sel', 'Text auswählen'], ['hand', 'Hand'], ['pen', 'Stift'], ['tx', 'Text markieren']], SET.startTool)}</div>
      <div class="set-row"><span>Beim Start öffnen</span>${sel('stStart', [['last', 'zuletzt geöffnete PDFs'], ['library', 'Bibliothek']], SET.startView)}</div>
      <div class="set-row"><span>Hineingezogene Dateien ablegen in</span><input id="stDrop" class="ho-pages" list="folderList" value="${esc(SET.dropFolder || DROP0)}" placeholder="${DROP0}"></div>
      <div class="set-row"><span>Druckqualität</span>${sel('stDpi', [[160, 'Normal (schnell)'], [300, 'Hoch (300 dpi, langsamer)']], SET.printDpi)}</div>
      <h3 class="dlg-sub">${LOCAL ? 'Texterkennung und Sicherheit' : 'Texterkennung und Sicherheit (alle Geräte)'}</h3>
      ${chk('stOcr', 'Scans automatisch durchsuchbar machen', SET.autoOcr, 'Erkennt Text in eingescannten PDFs von selbst, sobald sie geöffnet werden – im Hintergrund, jederzeit anhaltbar.')}
      ${chk('stPurge', 'Beim Schwärzen die alten Fassungen löschen', SET.redactPurge, LOCAL ? 'Sonst bleibt die ungeschwärzte Fassung als frühere Fassung erhalten.' : 'Sonst bleibt die ungeschwärzte Fassung als Sicherung auf dem Server.')}
      ${LOCAL ? '' : `${chk('stUsage', 'Nutzungsprotokoll führen', SET.usage !== false, 'Nur auf Ihrem Server: welche Werkzeuge, Fehler und Wartezeiten – keine Inhalte, keine Dateinamen. Hilft, die App gezielt zu verbessern.')}
      <div class="set-row"><span>Bericht für Verbesserungen</span><button type="button" class="btn" id="stReport">Bericht erstellen …</button></div>`}
      <div class="set-row"><span>Frühere Fassungen aufheben</span>${sel('stKeep', [[0, 'keine'], [1, '1'], [3, '3'], [5, '5 (empfohlen)'], [10, '10']], SET.keepVersions)}</div>
      ${LOCAL && window.pdfstiftWin && window.pdfstiftWin.libDir ? `<h3 class="dlg-sub">Bibliothek</h3>
      <div class="set-row"><span class="hot-dir" id="stLibDir"></span><span><button type="button" class="btn" id="stLibPick">Ordner wählen …</button> <button type="button" class="btn" id="stLibOpen">Öffnen</button></span></div>` : ''}
      ${window.pdfstiftWin ? `<h3 class="dlg-sub">Windows-App</h3>${chk('stUpd', 'Automatisch nach Updates suchen', SET.autoUpdate, '')}${chk('stNext', 'Word/PowerPoint/Excel: PDF-Kopie zusätzlich neben die Originaldatei legen', SET.pdfNextTo, 'Beim Hineinziehen wird immer eine PDF in der Bibliothek angelegt; das Original bleibt unverändert.')}` : ''}
      ${hot ? `${chk('stHot', 'Ordner auf dem PC überwachen', hot.on, 'Alles, was dort hineinkommt (PDF, Word, PowerPoint, Excel), übernimmt PDF-Stift automatisch in die Bibliothek; das Original wandert danach in den Unterordner „übernommen“.')}
      <div class="set-row"><span class="hot-dir" id="stHotDir">${esc(hot.dir)}</span><span><button type="button" class="btn" id="stHotPick">Ordner wählen …</button> <button type="button" class="btn" id="stHotOpen">Öffnen</button></span></div>` : ''}
      <div class="dlg-actions"><button type="submit" value="" class="btn">Abbrechen</button><button type="submit" value="ok" class="btn primary">Speichern</button></div></form>`;
    document.body.appendChild(d);
    d.showModal();
    if (d.querySelector('#stReport')) d.querySelector('#stReport').onclick = () => usageReport();
    if (d.querySelector('#stLibPick')) {
      window.pdfstiftWin.libDir().then((x) => { d.querySelector('#stLibDir').textContent = x; });
      d.querySelector('#stLibPick').onclick = () => window.pdfstiftWin.libPick();
      d.querySelector('#stLibOpen').onclick = () => window.pdfstiftWin.libOpen();
    }
    if (hot) {
      d.querySelector('#stHotPick').onclick = async () => { const dir = await window.pdfstiftWin.hotPick(); if (dir) { hot.dir = dir; d.querySelector('#stHotDir').textContent = dir; } };
      d.querySelector('#stHotOpen').onclick = () => window.pdfstiftWin.hotOpen();
    }
    d.addEventListener('close', async () => {
      if (d.returnValue !== 'ok') return;
      const newLang = $('#stLang').value;
      setTheme($('#stTheme').value);
      const vm = $('#stView').value, changedView = vm !== SET.viewMode;
      Object.assign(SET, { viewMode: vm, startTool: $('#stTool').value, startView: $('#stStart').value, printDpi: +$('#stDpi').value,
        autoOcr: $('#stOcr').checked, redactPurge: $('#stPurge').checked, keepVersions: +$('#stKeep').value, usage: $('#stUsage') ? $('#stUsage').checked : SET.usage });
      if ($('#stNext')) SET.pdfNextTo = $('#stNext').checked;
      if (hot && $('#stHot')) { await window.pdfstiftWin.hotSet({ on: $('#stHot').checked, dir: hot.dir }); if ($('#stHot').checked && !hot.on) toast('Der Ordner wird jetzt überwacht: ' + hot.dir, 5000); }
      SET.dropFolder = ($('#stDrop').value || DROP0).trim().replace(/^\/+|\/+$/g, '') || DROP0;
      if (window.pdfstiftWin && window.pdfstiftWin.setFolder) window.pdfstiftWin.setFolder(SET.dropFolder);
      if ($('#stUpd')) { SET.autoUpdate = $('#stUpd').checked; if (window.pdfstiftWin.setAutoUpdate) window.pdfstiftWin.setAutoUpdate(SET.autoUpdate); }
      saveSet();
      if (newLang !== LANG) { setLang(newLang); return; }
      ocrInd();
      if (changedView && V.pages.length) setViewMode(vm);
      try { await apiJson('prefs', { method: 'POST', body: { settings: { autoOcr: SET.autoOcr, redactPurge: SET.redactPurge, keepVersions: SET.keepVersions, usage: SET.usage } } }); toast('Einstellungen gespeichert.'); }
      catch (e) { toast('Gespeichert auf diesem Gerät – für alle Geräte gilt es, sobald Internet da ist.', 5000); }
    }, { once: true });
  }

  // ---- Dokumenteigenschaften: Titel, Verfasser, Thema, Stichwörter (änderbar), Anfangsansicht, Sicherheit, Schriften, Technisches

  // ---- Notizen aus einer älteren Fassung übernehmen: Seiten über den Text zuordnen, eingebrannte Notizen und die Notizebene übertragen
  const carryWords = (t) => { const m = new Map(); for (const w of String(t).toLowerCase().normalize('NFC').match(/[\p{L}\p{N}]{3,}/gu) || []) m.set(w, (m.get(w) || 0) + 1); return m; };
  function carrySim(a, b) {
    if (!a.size || !b.size) return 0;
    let both = 0, na = 0, nb = 0;
    for (const v of a.values()) na += v;
    for (const v of b.values()) nb += v;
    for (const [w, v] of a) both += Math.min(v, b.get(w) || 0);
    return (2 * both) / (na + nb);
  }
  // eingebrannte Notizen einer Seite: Abschnitte, die PDF-Stift hinter den Originalinhalt gehängt hat (q … Original … Q Notizen)
  function carryStreams(doc, page) {
    const { PDFArray, PDFRawStream, decodePDFRawStream } = PDFLib;
    const c = page.node.Contents();
    if (!(c instanceof PDFArray)) return [];
    const txt = c.asArray().map((ref) => {
      const st = doc.context.lookup(ref);
      try { const u8 = st instanceof PDFRawStream ? decodePDFRawStream(st).decode() : st.getContents(); let s2 = ''; for (let i = 0; i < u8.length; i += 8192) s2 += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return s2; } catch (e) { return null; }
    });
    let n = 0;
    while (n < txt.length && txt[n] != null && txt[n].trim() === 'q') n++;
    if (!n) return [];
    const q1 = txt.findIndex((t, i) => i >= n && t != null && t.trim() === 'Q');
    if (q1 < 0) return [];
    return txt.slice(q1 + 1).filter((t) => t != null && !/^\s*[qQ]?\s*$/.test(t));
  }
  // eingebrannte Notizen von Seite si (alt) auf Seite di (neu) kopieren – samt Schriften, Transparenz und Bildern
  function carryCopy(src, si, dst, di, ctx) {
    const { PDFName, PDFDict, PDFObjectCopier } = PDFLib;
    const sp = src.getPages()[si], dp = dst.getPages()[di];
    const streams = carryStreams(src, sp);
    if (!streams.length) return 0;
    if ((sp.getRotation().angle - dp.getRotation().angle) % 360) return -1;
    const copier = ctx.copier || (ctx.copier = PDFObjectCopier.for(src.context, dst.context));
    const sRes = sp.node.normalizedEntries().Resources;
    dp.pushOperators(); // Originalinhalt der neuen Seite in q … Q fassen
    const dRes = dp.node.normalizedEntries().Resources;
    const cats = ['ExtGState', 'Font', 'XObject', 'ColorSpace', 'Pattern', 'Shading'];
    const ren = new Map();
    const sm = sp.getMediaBox(), dm = dp.getMediaBox();
    const sx = dm.width / sm.width, sy = dm.height / sm.height;
    const pre = `q\n${sx.toFixed(6)} 0 0 ${sy.toFixed(6)} ${(dm.x - sm.x * sx).toFixed(3)} ${(dm.y - sm.y * sy).toFixed(3)} cm\n`;
    for (const t of streams) {
      const out = t.replace(/\/([A-Za-z0-9_.+\-#]+)/g, (all, name) => {
        if (ren.has(name)) return '/' + ren.get(name);
        for (const cat of cats) {
          const sd = sRes && sRes.lookupMaybe(PDFName.of(cat), PDFDict);
          const obj = sd && sd.get(PDFName.of(name));
          if (!obj) continue;
          let dd = dRes.lookupMaybe(PDFName.of(cat), PDFDict);
          if (!dd) { dd = dst.context.obj({}); dRes.set(PDFName.of(cat), dd); }
          const nn = 'PSc' + (++ctx.n) + '_' + name.slice(0, 20);
          dd.set(PDFName.of(nn), copier.copy(obj));
          ren.set(name, nn);
          return '/' + nn;
        }
        return all;
      });
      const ref = dst.context.register(dst.context.flateStream(pre + out + '\nQ\n'));
      dp.node.addContentStream(ref);
    }
    return streams.length;
  }
  // ---- Folien ins Notizbuch übernehmen: Seiten (mit Notizen) als Bild auf eine Notizseite legen
  function parsePages(txt, n) {
    const out = new Set();
    for (const part of String(txt).split(/[,;\s]+/).filter(Boolean)) {
      const m = part.match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
      if (!m) return null;
      let a = +m[1], b = m[2] ? +m[2] : a;
      if (a > b) [a, b] = [b, a];
      for (let i = Math.max(1, a); i <= Math.min(n, b); i++) out.add(i - 1);
    }
    return [...out].sort((x, y) => x - y);
  }
  async function pageToJpeg(i, withNotes, pdf = V.pdf, all = null) {
    const { c, vp0 } = await renderPageCanvas(pdf, i, 150);
    if (withNotes && (all || V.doc)) {
      const list = (all ? all.filter((s) => s.p === i).sort((a, b) => rank(a) - rank(b)) : pageStrokes(i)).filter((s) => !s.ln);
      // eingefügte Bilder erst laden
      await Promise.all(list.filter((s) => s.t === 'img').map((s) => { const im = imgGet(s.src); return im.complete && im.naturalWidth ? null : new Promise((res) => { const t = setTimeout(res, 4000); im.addEventListener('load', () => { clearTimeout(t); res(); }, { once: true }); }); }));
      const ctx = c.getContext('2d');
      const k = c.width / vp0.width;
      for (const s of list) {
        ctx.globalCompositeOperation = rank(s) < 2 ? 'multiply' : 'source-over';
        strokePath(ctx, s, k);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.88));
    c.width = c.height = 0;
    return blob;
  }
  async function nbUploadImg(blob, name) {
    const fd = new FormData();
    fd.append('file', blob, name);
    const r = await fetch(API + '?a=imgput', { method: 'POST', credentials: 'same-origin', headers: { 'X-PDFStift': '1' }, body: fd });
    const res = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(res.error || 'Fehler ' + r.status);
    // gleich in den Bildspeicher legen, damit die Notizseite es ohne neuen Download zeigt
    try { const url = API + '?a=img&src=' + encodeURIComponent(res.src); (await caches.open('pdfstift-img')).put(url, new Response(blob, { headers: { 'Content-Type': 'image/jpeg' } })); } catch (e) { /* */ }
    return res;
  }
  // Legt Bilder untereinander unter den vorhandenen Inhalt einer Notizseite
  async function nbAppendImages(path, items) {
    await localDoc(path);
    try { await pull(path); } catch (e) { /* offline: lokaler Stand */ }
    const doc = Notes.docs.get(path);
    let x = 0, y = 0;
    if (doc.strokes.size) {
      const b = [Infinity, Infinity, -Infinity, -Infinity];
      for (const s of doc.strokes.values()) { const w = worldBox(s); b[0] = Math.min(b[0], w[0]); b[1] = Math.min(b[1], w[1]); b[2] = Math.max(b[2], w[2]); b[3] = Math.max(b[3], w[3]); }
      x = b[0]; y = b[3] + 40;
    }
    const strokes = [];
    for (const it of items) {
      const bw = 800, bh = r2(800 * it.h / it.w);
      const st = { id: uid(), p: 0, t: 'img', c: '#000000', src: it.src, pts: [0, 0], bw, bh, o: [r2(x), r2(y)], z: 1 };
      if (it.ln) st.ln = it.ln;
      strokes.push(st);
      y += bh + 30;
    }
    opAdd(path, strokes);
    if (V.path === path && V.board) { pushHistory({ t: 'add', strokes }); boardRender(); }
    else { const info = boardInfo(path); if (info) info.notesMtime = Date.now() / 1000; }
    return strokes;
  }
  // ---- Notizseiten als PDF (Speichern, Drucken): auf A4-Blätter verteilt, Text und Striche bleiben scharf (Vektor)
  function boardToPage(s, ox, oy, f, p) {
    const [sx, sy, z] = so(s);
    const k = f / z, tx = (sx - ox) * f, ty = (sy - oy) * f;
    const r = (v) => Math.round(v * 1000) / 1000;
    const o = { ...s, p };
    delete o.o; delete o.z;
    const q = s.pts.slice();
    if (s.t === 'sh') { for (let i = 0; i < 4; i++) q[i] = r(q[i] * k + (i % 2 ? ty : tx)); }
    else if (s.t === 'txt' || s.t === 'img') { q[0] = r(q[0] * k + tx); q[1] = r(q[1] * k + ty); o.bw = r((s.bw || 0) * k); o.bh = r((s.bh || 0) * k); if (s.t === 'txt') o.fs = r(s.fs * k); }
    else { for (let i = 0; i + 1 < q.length; i += 3) { q[i] = r(q[i] * k + tx); q[i + 1] = r(q[i + 1] * k + ty); } }
    if (s.w) o.w = r(s.w * k);
    o.pts = q;
    return o;
  }
  // Bricht bevorzugt in einer Lücke zwischen Inhalten um, nicht mitten durch eine Folie oder Zeile
  function boardSlices(boxes, top, bottom, sliceH) {
    const out = [];
    let y = top;
    while (bottom - y > 1e-6) {
      let end = y + sliceH;
      if (end < bottom) {
        const step = sliceH / 240;
        const cut = (yy) => boxes.some((w) => w[1] < yy && w[3] > yy && w[3] - w[1] < sliceH * 0.95);
        for (let yy = end; yy > y + sliceH * 0.55; yy -= step) if (!cut(yy)) { end = yy; break; }
      } else end = bottom;
      out.push([y, end]);
      y = end;
    }
    return out;
  }
  async function boardPdfBytes(path, o) {
    const { PDFDocument, rgb } = PDFLib;
    const doc = await localDoc(path);
    if (navigator.onLine !== false) { try { await pull(path); } catch (e) { /* */ } }
    const strokes = [...(Notes.docs.get(path) || doc).strokes.values()];
    const info = boardInfo(path) || {};
    const title = info.title || docTitle(path);
    const out = await PDFDocument.create();
    out.setTitle(title);
    const bg = o.bg ? (info.bg || (V.path === path && B.meta && B.meta.bg) || 'dots') : 'plain';
    const M = 36;
    if (!strokes.length) { out.addPage([595.28, 841.89]); return { bytes: await out.save(), n: 1 }; }
    const boxes = strokes.map(worldBox);
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const w of boxes) { b[0] = Math.min(b[0], w[0]); b[1] = Math.min(b[1], w[1]); b[2] = Math.max(b[2], w[2]); b[3] = Math.max(b[3], w[3]); }
    const Wc = Math.max(1, b[2] - b[0]), Hc = Math.max(1, b[3] - b[1]);
    let PW, PH, f;
    if (o.fmt === 'one') {
      f = Math.min(0.75, (14000 - 2 * M) / Wc, (14000 - 2 * M) / Hc);
      PW = Wc * f + 2 * M; PH = Hc * f + 2 * M;
    } else {
      [PW, PH] = o.fmt === 'a4l' ? [841.89, 595.28] : [595.28, 841.89];
      f = Math.min(0.75, (PW - 2 * M) / Wc);
    }
    const slices = o.fmt === 'one' ? [[b[1], b[3]]] : boardSlices(boxes, b[1], b[3], (PH - 2 * M - 14) / f);
    const font = await pdfFont(out, 'Helvetica', [title]);
    const ox = b[0] - (PW - Wc * f) / 2 / f; // waagerecht mittig
    const pageStrokes = [], clips = [], vps = [];
    slices.forEach(([s0, s1], i) => {
      const pg = out.addPage([PW, PH]);
      const oy = s0 - M / f;
      // Linien oder Karos wie auf dem Bildschirm (Abstand 24)
      if (bg === 'lines' || bg === 'grid') {
        const col = bg === 'lines' ? rgb(0.12, 0.31, 0.84) : rgb(0.12, 0.18, 0.43);
        for (let wy = Math.ceil(s0 / 24) * 24; wy <= s1; wy += 24) { const y = PH - (wy - oy) * f; pg.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 0.4, color: col, opacity: 0.25 }); }
        if (bg === 'grid') for (let wx = Math.ceil((ox + M / f) / 24) * 24; (wx - ox) * f <= PW - M; wx += 24) { const x = (wx - ox) * f; pg.drawLine({ start: { x, y: PH - M }, end: { x, y: PH - M - (s1 - s0) * f }, thickness: 0.4, color: col, opacity: 0.25 }); }
      }
      if (o.fmt !== 'one') {
        const foot = `${title} · ${i + 1}/${slices.length}`;
        const clean = [...foot].map((ch) => { try { font.encodeText(ch); return ch; } catch (e) { return '?'; } }).join('');
        pg.drawText(clean, { x: M, y: M / 2 - 3, size: 7.5, font, color: rgb(0.55, 0.57, 0.62) });
      }
      vps.push({ vp: { width: PW, height: PH, convertToPdfPoint: (x, y) => [x, PH - y] } });
      clips.push([0, PH - M - (s1 - s0) * f - 1, PW, (s1 - s0) * f + 2]);
      strokes.forEach((s, j) => { const w = boxes[j]; if (w[3] > s0 && w[1] < s1) pageStrokes.push(boardToPage(s, ox, oy, f, i)); });
    });
    const base = await out.save();
    const bytes = await buildAnnotated({ path, bytes: base, vps, strokes: pageStrokes, clips: o.fmt === 'one' ? null : clips });
    return { bytes, n: slices.length };
  }
  async function boardPdfDialog(act) {
    if (!V.board || !V.path) return;
    const path = V.path;
    boardCommitText(false);
    const info = boardInfo(path) || {};
    const secPages = (() => { for (const nb of S.boards || []) for (const sec of nb.sections) if (sec.pages.some((p) => p.path === path)) return { name: sec.name, pages: sec.pages }; return null; })();
    const last = ls('bdPdf') || {};
    const bgNow = B.meta.bg || 'dots';
    let d = $('#bdPdfDlg'); if (d) d.remove();
    d = document.createElement('dialog'); d.id = 'bdPdfDlg'; d.className = 'dlg set-dlg tonb-dlg';
    d.innerHTML = `<form method="dialog"><h2>${act === 'print' ? 'Notizseite drucken' : 'Notizseite als PDF speichern'}</h2>
      <div class="set-row"><span>Umfang</span><div class="tn-pages"><label><input type="radio" name="bpw" value="page" checked> Diese Seite</label>${secPages && secPages.pages.length > 1 ? `<label><input type="radio" name="bpw" value="sec"> Ganzer Abschnitt „${esc(secPages.name)}“ (${secPages.pages.length} Seiten)</label>` : ''}</div></div>
      <div class="set-row"><span>Format</span><select id="bpFmt"><option value="a4p">A4 hoch – auf mehrere Blätter verteilt</option><option value="a4l">A4 quer – auf mehrere Blätter verteilt</option><option value="one">Ein langes Blatt (ganze Notizseite)</option></select></div>
      <div class="set-row"><span></span><label><input type="checkbox" id="bpBg" ${(last.bg != null ? last.bg : bgNow === 'lines' || bgNow === 'grid') ? 'checked' : ''}> Linien bzw. Karos mitdrucken</label></div>
      <p id="bpMsg" class="muted small" aria-live="polite"></p>
      <div class="dlg-actions"><button type="submit" value="" class="btn">Abbrechen</button><button type="button" id="bpGo" class="btn primary">${act === 'print' ? 'Drucken' : 'Speichern'}</button></div></form>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => d.remove(), { once: true });
    const q = (x) => d.querySelector(x);
    if (last.fmt && (act !== 'print' || last.fmt !== 'one')) q('#bpFmt').value = last.fmt;
    if (act === 'print') q('#bpFmt option[value=one]').remove();
    d.showModal();
    q('#bpGo').onclick = async () => {
      const o = { fmt: q('#bpFmt').value, bg: q('#bpBg').checked };
      const all = q('input[name=bpw]:checked').value === 'sec' ? secPages.pages.map((p) => p.path) : [path];
      ls('bdPdf', o);
      q('#bpGo').disabled = true;
      try {
        let bytes;
        if (all.length === 1) bytes = (await boardPdfBytes(path, o)).bytes;
        else {
          const merged = await PDFLib.PDFDocument.create();
          merged.setTitle(secPages.name);
          for (const [k, p] of all.entries()) {
            q('#bpMsg').textContent = `Seite ${k + 1} von ${all.length} …`;
            const src = await PDFLib.PDFDocument.load((await boardPdfBytes(p, o)).bytes);
            (await merged.copyPages(src, src.getPageIndices())).forEach((pg) => merged.addPage(pg));
          }
          bytes = await merged.save();
        }
        const name = (all.length > 1 ? secPages.name : info.title || docTitle(path)).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Notizseite';
        d.close();
        track('tool', act === 'print' ? 'Notizseite drucken' : 'Notizseite als PDF', null, `${all.length} Seiten`);
        if (act === 'print') await printBytes(bytes, null);
        else downloadBlob(new Blob([bytes], { type: 'application/pdf' }), name + '.pdf');
      } catch (e) { q('#bpMsg').textContent = 'Das hat nicht geklappt: ' + e.message; q('#bpGo').disabled = false; }
    };
  }
  // ---- Frühere Stände einer Notizseite (der Server hebt alle 10 Minuten einen Stand auf)
  async function boardHistory() {
    if (!V.board) return;
    if (navigator.onLine === false) { toast('Frühere Stände gibt es nur mit Internetverbindung.'); return; }
    const path = V.path;
    try { await flush(); } catch (e) { /* */ }
    let list = [];
    try { list = (await apiJson('nbhist', { params: { path } })).list; } catch (e) { toast(e.message, 6000); return; }
    const d = document.createElement('dialog');
    d.className = 'dlg set-dlg hist-dlg';
    const when = (t) => new Date(t * 1000).toLocaleString(LOC, { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    d.innerHTML = `<form method="dialog"><h2>Frühere Stände</h2>
      <p class="muted small">PDF-Stift hebt beim Schreiben etwa alle 10 Minuten einen Stand dieser Notizseite auf (die letzten 60). Wiederherstellen lässt sich rückgängig machen – der jetzige Stand wird vorher selbst aufgehoben.</p>
      <div class="hist-list">${list.length ? list.map((h) => `<div class="hist-row" data-t="${h.t}"><span class="hist-th"></span><div class="hist-tx"><b>${esc(when(h.t))}</b><span class="muted small">${h.n} ${h.n === 1 ? 'Notiz' : 'Notizen'}${h.txt ? ` · ${h.txt} Text${h.txt === 1 ? '' : 'e'}` : ''}${h.img ? ` · ${h.img} ${h.img === 1 ? 'Bild' : 'Bilder'}` : ''}</span></div><button type="button" class="btn">Wiederherstellen</button></div>`).join('') : '<p class="muted">Noch keine früheren Stände – sie entstehen, sobald auf dieser Seite geschrieben wird.</p>'}</div>
      <div class="dlg-actions"><button type="submit" value="" class="btn">Schließen</button></div></form>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => d.remove(), { once: true });
    d.showModal();
    // Vorschaubilder nacheinander laden
    (async () => {
      for (const row of d.querySelectorAll('.hist-row')) {
        if (!d.isConnected) return;
        try {
          const st = (await apiJson('nbhist', { params: { path, t: row.dataset.t } })).strokes || {};
          row.querySelector('.hist-th').innerHTML = `<img alt="" src="${renderBoardThumb(Object.values(st), 160, 110)}">`;
        } catch (e) { /* ohne Vorschau */ }
      }
    })();
    d.querySelectorAll('.hist-row .btn').forEach((b) => {
      b.onclick = async () => {
        const t = +b.closest('.hist-row').dataset.t;
        if (!(await confirmDlg('Diesen Stand wiederherstellen?', `Die Notizseite sieht danach wieder aus wie am ${when(t)}. Der jetzige Stand bleibt als früherer Stand erhalten.`, 'Wiederherstellen'))) return;
        try {
          try { await flush(); } catch (e) { /* */ }
          const doc = await apiJson('nbhist', { method: 'POST', body: { path, t } });
          applyServer(path, doc);
          if (V.path === path) { boardClearSel(); boardRender(); }
          d.close();
          track('tool', 'Notizseite wiederhergestellt');
          toast('Früherer Stand wiederhergestellt.');
        } catch (e) { toast(e.message, 6000); }
      };
    });
  }
  // Auf der Notizseite: Seiten einer PDF aus der Bibliothek einfügen
  async function nbInsertPdf() {
    if (!V.board) return;
    if (navigator.onLine === false) { toast('PDF-Seiten einfügen geht nur mit Internetverbindung.'); return; }
    const target = V.path;
    const rec = (ls('recent') || []).map((r) => r.path).filter((p) => !isBoard(p));
    const files = ((S.library && S.library.files) || []).map((f) => f.path).filter((p) => /\.pdf$/i.test(p)).sort((a, b) => (rec.indexOf(a) + 1 || 1e9) - (rec.indexOf(b) + 1 || 1e9) || a.localeCompare(b));
    if (!files.length) { toast('In der Bibliothek ist noch keine PDF.'); return; }
    let d = $('#nbPdfDlg'); if (d) d.remove();
    d = document.createElement('dialog'); d.id = 'nbPdfDlg'; d.className = 'dlg set-dlg tonb-dlg';
    d.innerHTML = `<form method="dialog"><h2>PDF-Seiten einfügen</h2>
      <p class="muted small">Die Seiten kommen als Bild unter den vorhandenen Inhalt dieser Notizseite.</p>
      <div class="set-row"><span>PDF</span><select id="npFile">${files.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}</select></div>
      <div class="set-row"><span>Seiten</span><input id="npRange" type="text" value="1" placeholder="z. B. 3-5, 8"></div>
      <div class="set-row"><span></span><label><input type="checkbox" id="npNotes" checked> Mit meinen Notizen und Markierungen</label></div>
      <p id="npMsg" class="muted small" aria-live="polite"></p>
      <div class="dlg-actions"><button type="submit" value="" class="btn">Abbrechen</button><button type="button" id="npGo" class="btn primary">Einfügen</button></div></form>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => d.remove(), { once: true });
    d.showModal();
    const q = (x) => d.querySelector(x);
    q('#npGo').onclick = async () => {
      const msg = q('#npMsg'), path = q('#npFile').value;
      q('#npGo').disabled = true;
      let pdf = null;
      try {
        msg.textContent = 'Lade die PDF …';
        const bytes = await getPdfBytes(path);
        pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)), isEvalSupported: false }).promise;
        const pages = parsePages(q('#npRange').value, pdf.numPages);
        if (!pages || !pages.length) { msg.textContent = `Bitte Seiten zwischen 1 und ${pdf.numPages} angeben, z. B. „3-5, 8“.`; q('#npGo').disabled = false; return; }
        if (pages.length > 60) { msg.textContent = 'Höchstens 60 Seiten auf einmal.'; q('#npGo').disabled = false; return; }
        let all = null;
        if (q('#npNotes').checked) {
          const doc = await localDoc(path);
          try { await pull(path); } catch (e) { /* */ }
          all = [...(Notes.docs.get(path) || doc).strokes.values()];
        }
        const items = [];
        for (const [j, i] of pages.entries()) {
          msg.textContent = pages.length > 1 ? `Seite ${j + 1} von ${pages.length} …` : 'Wird eingefügt …';
          const res = await nbUploadImg(await pageToJpeg(i, !!all, pdf, all || []), 'seite-' + (i + 1) + '.jpg');
          items.push({ src: res.src, w: res.w, h: res.h, ln: { path, pg: i } });
        }
        if (V.path !== target) throw new Error('Die Notizseite wurde gewechselt.');
        const added = await nbAppendImages(target, items);
        d.close();
        const w = worldBox(added[0]);
        B.cam.s = clamp(Math.min(1.2, (B.w - 80) / Math.max(1, w[2] - w[0])), ZMIN, ZMAX);
        B.cam.x = w[0] - 40 / B.cam.s; B.cam.y = w[1] - 40 / B.cam.s;
        boardRender(); saveCam();
        track('tool', 'PDF-Seiten ins Notizbuch', null, `${pages.length} Seiten`);
      } catch (e) { msg.textContent = 'Einfügen fehlgeschlagen: ' + e.message; q('#npGo').disabled = false; }
      finally { if (pdf) pdf.destroy(); }
    };
  }
  async function toNotebook(pre) {
    if (!V.path || V.board || !V.pdf) { toast('Bitte zuerst eine PDF öffnen.'); return; }
    if (navigator.onLine === false) { toast('Ins Notizbuch übernehmen geht nur mit Internetverbindung.'); return; }
    const path = V.path, n = V.pages.length, cur = pre != null ? pre : currentPageIndex();
    if (!S.boards) await loadBoards();
    const books = S.boards || [];
    const last = ls('toNb') || {};
    let d = $('#toNbDlg'); if (d) d.remove();
    d = document.createElement('dialog'); d.id = 'toNbDlg'; d.className = 'dlg set-dlg tonb-dlg';
    d.innerHTML = `<form method="dialog"><h2>Ins Notizbuch übernehmen</h2>
      <p class="muted small">Die Seite kommt als Bild auf eine Notizseite – dort können Sie daneben und darauf weiterschreiben.</p>
      <div class="set-row"><span>Seiten</span><div class="tn-pages"><label><input type="radio" name="tnw" value="cur" checked> Diese Seite (${cur + 1})</label><label><input type="radio" name="tnw" value="sel"> Seiten: <input id="tnRange" type="text" placeholder="z. B. 3-5, 8" size="12"></label></div></div>
      <div class="set-row"><span></span><label><input type="checkbox" id="tnNotes" ${last.notes === false ? '' : 'checked'}> Mit meinen Notizen und Markierungen</label></div>
      <div class="set-row"><span>Notizbuch</span><select id="tnNb">${books.map((b) => `<option value="${esc(b.name)}">${esc(b.name)}</option>`).join('')}<option value="+">＋ Neues Notizbuch …</option></select></div>
      <div class="set-row" id="tnNbNewRow" hidden><span></span><input id="tnNbNew" type="text" placeholder="Name des Notizbuchs"></div>
      <div class="set-row"><span>Abschnitt</span><select id="tnSec"></select></div>
      <div class="set-row" id="tnSecNewRow" hidden><span></span><input id="tnSecNew" type="text" placeholder="Name des Abschnitts"></div>
      <div class="set-row"><span>Seite</span><select id="tnPage"></select></div>
      <div class="set-row" id="tnTitleRow"><span>Titel</span><input id="tnTitle" type="text"></div>
      <div class="set-row"><span></span><label><input type="checkbox" id="tnOpen" ${last.open === false ? '' : 'checked'}> Notizseite danach öffnen</label></div>
      <p id="tnMsg" class="muted small" aria-live="polite"></p>
      <div class="dlg-actions"><button type="submit" value="" class="btn">Abbrechen</button><button type="button" id="tnGo" class="btn primary">Übernehmen</button></div></form>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => d.remove(), { once: true });
    const q = (s) => d.querySelector(s);
    const book = () => books.find((b) => b.name === q('#tnNb').value);
    const sec = () => { const b = book(); return b && b.sections.find((s) => s.name === q('#tnSec').value); };
    const range = () => q('input[name=tnw]:checked').value === 'cur' ? [cur] : parsePages(q('#tnRange').value, n);
    const fillTitle = () => { const r = range() || [cur]; q('#tnTitle').value = stem(path) + ' – ' + (r.length > 1 ? `S. ${r[0] + 1}–${r[r.length - 1] + 1}` : `S. ${r[0] + 1}`); };
    const fillPages = () => {
      const s = sec();
      q('#tnPage').innerHTML = '<option value="+">＋ Neue Seite</option>' + (s ? s.pages.map((p) => `<option value="${esc(p.path)}">${esc(p.title)}</option>`).join('') : '');
      if (last.page && s && s.pages.some((p) => p.path === last.page)) q('#tnPage').value = last.page;
      q('#tnTitleRow').hidden = q('#tnPage').value !== '+';
    };
    const fillSecs = () => {
      const b = book();
      q('#tnNbNewRow').hidden = q('#tnNb').value !== '+';
      q('#tnSec').innerHTML = (b ? b.sections.map((s) => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('') : '') + '<option value="+">＋ Neuer Abschnitt …</option>';
      if (b && last.sec && b.sections.some((s) => s.name === last.sec)) q('#tnSec').value = last.sec;
      else if (!b || !b.sections.length) q('#tnSec').value = '+';
      q('#tnSecNewRow').hidden = q('#tnSec').value !== '+';
      if (q('#tnSec').value === '+' && !q('#tnSecNew').value) q('#tnSecNew').value = stem(path).slice(0, 60);
      fillPages();
    };
    if (last.nb && books.some((b) => b.name === last.nb)) q('#tnNb').value = last.nb;
    else if (!books.length) q('#tnNb').value = '+';
    fillSecs(); fillTitle();
    q('#tnNb').onchange = fillSecs;
    q('#tnSec').onchange = () => { q('#tnSecNewRow').hidden = q('#tnSec').value !== '+'; fillPages(); };
    q('#tnPage').onchange = () => { q('#tnTitleRow').hidden = q('#tnPage').value !== '+'; };
    q('#tnRange').onfocus = () => { q('input[name=tnw][value=sel]').checked = true; };
    q('#tnRange').oninput = fillTitle;
    d.querySelectorAll('input[name=tnw]').forEach((r) => { r.onchange = fillTitle; });
    d.showModal();
    q('#tnGo').onclick = async () => {
      const msg = q('#tnMsg');
      const pages = range();
      if (!pages || !pages.length) { msg.textContent = 'Bitte Seiten wie „3-5, 8“ angeben.'; return; }
      if (pages.length > 60) { msg.textContent = 'Höchstens 60 Seiten auf einmal.'; return; }
      let nb = q('#tnNb').value, sc = q('#tnSec').value, target = q('#tnPage').value;
      if (nb === '+') { nb = q('#tnNbNew').value.trim(); if (!nb) { msg.textContent = 'Bitte einen Namen für das Notizbuch eingeben.'; return; } }
      if (sc === '+') { sc = q('#tnSecNew').value.trim(); if (!sc) { msg.textContent = 'Bitte einen Namen für den Abschnitt eingeben.'; return; } }
      const withNotes = q('#tnNotes').checked, open = q('#tnOpen').checked;
      q('#tnGo').disabled = true;
      try {
        const items = [];
        for (const [j, i] of pages.entries()) {
          msg.textContent = pages.length > 1 ? `Seite ${j + 1} von ${pages.length} …` : 'Wird übernommen …';
          const blob = await pageToJpeg(i, withNotes);
          const res = await nbUploadImg(blob, 'seite-' + (i + 1) + '.jpg');
          items.push({ src: res.src, w: res.w, h: res.h, ln: { path, pg: i } });
        }
        if (target === '+') {
          if (q('#tnNb').value === '+') await apiJson('nbnew', { method: 'POST', body: { kind: 'nb', name: nb } });
          const r = await apiJson('nbnew', { method: 'POST', body: { kind: 'page', nb, sec: sc, title: q('#tnTitle').value.trim() || stem(path) } });
          target = r.path;
        }
        await loadBoards();
        const added = await nbAppendImages(target, items);
        const parts = target.slice(4).split('/');
        ls('toNb', { nb: parts[0], sec: parts[1], page: target, notes: withNotes, open });
        track('tool', 'Ins Notizbuch übernehmen', null, `${pages.length} Seiten`);
        d.close();
        if (open) {
          // Ansicht auf die neu eingefügten Seiten richten
          const st = added[0], sc2 = clamp(Math.min(1.2, (innerWidth - 120) / 860), ZMIN, ZMAX);
          const cams = ls('cams') || {}; cams[target] = { x: st.o[0] - 40 / sc2, y: st.o[1] - 40 / sc2, s: sc2 }; ls('cams', cams);
          openDoc(target);
        }
        else toast(pages.length > 1 ? `${pages.length} Seiten ins Notizbuch übernommen.` : 'Seite ins Notizbuch übernommen.');
      } catch (e) { msg.textContent = 'Übernehmen fehlgeschlagen: ' + e.message; q('#tnGo').disabled = false; }
    };
  }
  async function carryDialog() {
    if (!V.path || V.board) { toast('Bitte zuerst die neue Fassung öffnen.'); return; }
    const path = V.path;
    track('tool', 'Notizen übernehmen');
    const base = basename(path).replace(/\.pdf$/i, '').toLowerCase();
    const near = (p) => { const b = basename(p).replace(/\.pdf$/i, '').toLowerCase(); let k = 0; while (k < b.length && b[k] === base[k]) k++; return k; };
    const files = ((S.library && S.library.files) || []).map((f) => f.path).filter((p) => p !== path && /\.pdf$/i.test(p)).sort((a, b) => near(b) - near(a) || a.localeCompare(b));
    let d = $('#carryDlg'); if (d) d.remove();
    d = document.createElement('dialog'); d.id = 'carryDlg'; d.className = 'dlg carry-dlg';
    d.innerHTML = `<form method="dialog"><h3>Notizen aus älterer Fassung übernehmen</h3>
      <p class="muted small">Ihre Notizen, Markierungen und Textfelder aus der alten Fassung kommen auf die passenden Seiten dieser PDF (${esc(docTitle(path))}). Die Seiten werden über ihren Text zugeordnet – auch wenn Folien dazugekommen oder weggefallen sind.</p>
      <div class="set-row"><span>Alte Fassung</span><select id="caSrc">${files.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}</select></div>
      <div class="set-row"><span></span><label class="btn" style="cursor:pointer">Datei vom PC wählen …<input type="file" id="caFile" accept="application/pdf,.pdf" hidden></label></div>
      <div id="caOut" class="ca-out"></div>
      <div class="dlg-actions"><button type="submit" value="" class="btn">Abbrechen</button><button type="button" id="caGo" class="btn">Seiten zuordnen</button><button type="button" id="caApply" class="btn primary" hidden>Übernehmen</button></div></form>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => d.remove(), { once: true });
    d.showModal();
    let srcBytes = null, srcName = '', srcPath = null, plan = null;
    d.querySelector('#caFile').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; srcBytes = await f.arrayBuffer(); srcName = f.name; srcPath = null; analyse(); };
    d.querySelector('#caGo').onclick = async () => {
      srcPath = d.querySelector('#caSrc').value; srcName = srcPath;
      if (!srcPath) return;
      d.querySelector('#caOut').innerHTML = '<p class="muted">Lade die alte Fassung …</p>';
      try { srcBytes = await getPdfBytes(srcPath); } catch (e) { d.querySelector('#caOut').textContent = 'Die Datei ließ sich nicht laden: ' + e.message; return; }
      analyse();
    };
    async function analyse() {
      const out = d.querySelector('#caOut');
      out.innerHTML = '<p class="muted">Vergleiche die Seiten …</p>';
      try {
        const old = await pdfjsLib.getDocument({ data: new Uint8Array(srcBytes.slice(0)), isEvalSupported: false }).promise;
        const lib = await PDFLib.PDFDocument.load(srcBytes, { ignoreEncryption: true, updateMetadata: false });
        const oldPages = lib.getPages();
        let layer = new Map();
        if (srcPath) {
          try { layer = new Map(Object.entries((await apiJson('notes', { params: { path: srcPath } })).strokes || {})); } catch (e) { /* ohne Notizebene */ }
          try { for (const [id, st] of (await localDoc(srcPath)).strokes) layer.set(id, st); } catch (e) { /* */ }
        }
        const layerBy = new Map();
        for (const st of layer.values()) { if (st.ln || st.mk) continue; if (!layerBy.has(st.p)) layerBy.set(st.p, []); layerBy.get(st.p).push(st); }
        const oldW = [], newW = [];
        for (let i = 1; i <= old.numPages; i++) { try { oldW.push(carryWords(textOf(await (await old.getPage(i)).getTextContent()))); } catch (e) { oldW.push(new Map()); } }
        for (const P of V.pages) { try { newW.push(carryWords(textOf(await (await pgOf(P)).getTextContent()))); } catch (e) { newW.push(new Map()); } }
        plan = [];
        for (let i = 0; i < old.numPages; i++) {
          const burned = carryStreams(lib, oldPages[i]).length;
          const strokes = layerBy.get(i) || [];
          if (!burned && !strokes.length) continue;
          let best = -1, sc = 0;
          newW.forEach((w, j) => { const v = carrySim(oldW[i], w); if (v > sc) { sc = v; best = j; } });
          let how = Math.round(sc * 100) + ' % gleicher Text';
          if (!oldW[i].size && old.numPages === V.pages.length) { best = i; sc = 0.6; how = 'gleiche Seitenzahl (kein Text)'; }
          plan.push({ i, to: sc >= 0.45 ? best : -1, burned, strokes, how, sc });
        }
        if (!plan.length) { out.innerHTML = '<p>In der alten Fassung wurden keine Notizen gefunden.</p>'; return; }
        out.innerHTML = `<p class="small">${plan.length} ${plan.length === 1 ? 'Seite' : 'Seiten'} mit Notizen in „${esc(srcName)}“:</p><div class="ca-list">${plan.map((r, k) => `<label class="ca-row"><input type="checkbox" data-k="${k}"${r.to >= 0 ? ' checked' : ''}>
          <span>Alte Seite ${r.i + 1} → neue Seite <input type="number" class="ca-to" data-k="${k}" min="1" max="${V.pages.length}" value="${r.to >= 0 ? r.to + 1 : ''}"></span>
          <span class="muted small">${r.to >= 0 ? esc(r.how) : 'keine passende Seite gefunden – bitte Seitenzahl eintragen'}${r.burned ? ' · eingebrannte Notizen' : ''}${r.strokes.length ? ` · ${r.strokes.length} offene Notiz${r.strokes.length === 1 ? '' : 'en'}` : ''}</span></label>`).join('')}</div>
          <p class="muted small">Tipp: Mit „Rückgängig“ lässt sich die Übernahme wieder zurücknehmen.</p>`;
        out.querySelectorAll('.ca-to').forEach((inp) => { inp.oninput = () => { const cb = out.querySelector(`input[type=checkbox][data-k="${inp.dataset.k}"]`); cb.checked = +inp.value >= 1 && +inp.value <= V.pages.length; }; });
        d.querySelector('#caApply').hidden = false;
        d.querySelector('#caApply').onclick = () => apply(lib);
      } catch (e) { out.textContent = 'Die alte Fassung ließ sich nicht lesen: ' + e.message; }
    }
    async function apply(lib) {
      const rows = plan.map((r, k) => ({ ...r, to: +d.querySelector(`.ca-to[data-k="${k}"]`).value - 1, on: d.querySelector(`input[type=checkbox][data-k="${k}"]`).checked })).filter((r) => r.on && r.to >= 0 && r.to < V.pages.length);
      if (!rows.length) { toast('Keine Seite ausgewählt.'); return; }
      d.querySelector('#caApply').disabled = true;
      let pagesDone = 0, skipped = 0, nStrokes = 0;
      try {
        if (rows.some((r) => r.burned)) {
          const entry = pdfCache.get(path);
          const doc = await PDFLib.PDFDocument.load(await pdfBytes(entry), { ignoreEncryption: true, updateMetadata: false });
          const ctx = { n: 0 };
          for (const r of rows) { if (!r.burned) continue; const k = carryCopy(lib, r.i, doc, r.to, ctx); if (k > 0) pagesDone++; else if (k < 0) skipped++; }
          if (pagesDone) await commitPdf(path, await pdfSave(doc), [...Array(V.pages.length).keys()], {}, rows[0].to);
        }
        // Notizen, die noch nicht eingebrannt waren (Notizebene)
        const add = [];
        for (const r of rows) {
          if (!r.strokes.length) continue;
          for (const st of r.strokes) add.push({ ...JSON.parse(JSON.stringify(st)), id: uid(), p: r.to });
          if (!r.burned) pagesDone++;
        }
        if (add.length) { await localDoc(path); opAdd(path, add); redrawPages(add); nStrokes = add.length; }
        d.close();
        toast(`Notizen übernommen: ${pagesDone} ${pagesDone === 1 ? 'Seite' : 'Seiten'}` + (skipped ? ` (${skipped} wegen gedrehter Seite übersprungen)` : '') + '.', 5000);
        if (rows[0]) setTimeout(() => goToPage(rows[0].to), 400);
      } catch (e) { d.querySelector('#caApply').disabled = false; toast('Übernehmen fehlgeschlagen: ' + e.message, 7000); }
    }
  }

  async function docProps() {
    if (!V.path || V.board) { toast('Bitte zuerst eine PDF öffnen.'); return; }
    const path = V.path, entry = pdfCache.get(path);
    if (!entry) return;
    track('tool', 'Dokumenteigenschaften');
    const { PDFDocument, PDFName, PDFDict } = PDFLib;
    let doc, bytes;
    try { bytes = await pdfBytes(entry); doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); } catch (e) { toast('Die PDF ließ sich nicht lesen: ' + e.message, 6000); return; }
    const head = new TextDecoder('latin1').decode(new Uint8Array(bytes).slice(0, 12));
    const ver = (/%PDF-(\d\.\d)/.exec(head) || [])[1] || '?';
    const fmtD = (d) => (d ? d.toLocaleString(LOC, { dateStyle: 'medium', timeStyle: 'short' }) : '–');
    const safe = (f) => { try { return f() || ''; } catch (e) { return ''; } };
    const info = { title: safe(() => doc.getTitle()), author: safe(() => doc.getAuthor()), subject: safe(() => doc.getSubject()), keywords: safe(() => doc.getKeywords()),
      creator: safe(() => doc.getCreator()), producer: safe(() => doc.getProducer()), created: safe(() => doc.getCreationDate()), modified: safe(() => doc.getModificationDate()) };
    const cat = doc.catalog;
    const nameOf = (k) => { const v = cat.get(PDFName.of(k)); return v ? String(v).replace(/^\//, '') : ''; };
    const layout0 = nameOf('PageLayout'), mode0 = nameOf('PageMode');
    // Schriften: alle Font-Einträge der Datei
    const fonts = new Map();
    try {
      for (const [, obj] of doc.context.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFDict)) continue;
        if (String(obj.get(PDFName.of('Type')) || '') !== '/Font') continue;
        const bf = String(obj.get(PDFName.of('BaseFont')) || '').replace(/^\//, '');
        const sub = String(obj.get(PDFName.of('Subtype')) || '').replace(/^\//, '');
        if (!bf || sub === 'CIDFontType0' || sub === 'CIDFontType2') continue;
        const fd = obj.get(PDFName.of('FontDescriptor'));
        const emb = /^[A-Z]{6}\+/.test(bf) || !!(fd && doc.context.lookup(fd) && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => doc.context.lookup(fd).get(PDFName.of(k))));
        const name = bf.replace(/^[A-Z]{6}\+/, '');
        if (!fonts.has(name)) fonts.set(name, { sub, emb });
      }
    } catch (e) { /* Schriftliste ist nur eine Auskunft */ }
    const pg0 = doc.getPage(0).getSize(), mm = (pt) => Math.round(pt / 72 * 25.4);
    const fmeta = fileMeta(path) || {};
    const enc = doc.isEncrypted;
    const d = document.createElement('dialog');
    d.className = 'dlg set-dlg props-dlg';
    const row = (l, v) => `<div class="pr-row"><span>${l}</span><span>${v}</span></div>`;
    const inp = (id, l, v) => `<div class="pr-row"><label for="${id}">${l}</label><input id="${id}" value="${esc(v)}" autocomplete="off"></div>`;
    const opt = (id, cur, list) => `<select id="${id}">${list.map(([k, l]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    d.innerHTML = `<form method="dialog"><h2>Dokumenteigenschaften</h2>
      <div class="pr-tabs" role="tablist">${['Beschreibung', 'Anfangsansicht', 'Sicherheit', 'Schriften', 'Erweitert'].map((t, i) => `<button type="button" role="tab" data-t="${i}"${i ? '' : ' class="on"'}>${t}</button>`).join('')}</div>
      <div class="pr-pane" data-p="0">
        ${row('Dateiname', esc(basename(path)))}
        ${inp('prTitle', 'Titel', info.title)}${inp('prAuthor', 'Verfasser', info.author)}${inp('prSubject', 'Thema', info.subject)}${inp('prKeys', 'Stichwörter', info.keywords)}
        ${row('Erstellt', esc(fmtD(info.created)))}${row('Geändert', esc(fmtD(info.modified)))}
        ${row('Erstellt mit', esc(info.creator || '–'))}${row('PDF-Erzeuger', esc(info.producer || '–'))}
      </div>
      <div class="pr-pane" data-p="1" hidden>
        <div class="pr-row"><label for="prLayout">Seitenlayout</label>${opt('prLayout', layout0, [['', 'Standard'], ['SinglePage', 'Einzelseite'], ['OneColumn', 'Fortlaufend'], ['TwoColumnLeft', 'Zwei Seiten fortlaufend'], ['TwoColumnRight', 'Zwei Seiten, Titelseite einzeln'], ['TwoPageLeft', 'Zwei Seiten'], ['TwoPageRight', 'Zwei Seiten, Titelseite einzeln (seitenweise)']])}</div>
        <div class="pr-row"><label for="prMode">Beim Öffnen zeigen</label>${opt('prMode', mode0, [['', 'Nur die Seite'], ['UseOutlines', 'Lesezeichen'], ['UseThumbs', 'Seitenvorschau'], ['FullScreen', 'Vollbild']])}</div>
        <p class="muted small">So öffnen andere PDF-Programme die Datei. PDF-Stift selbst merkt sich die Ansicht pro Gerät.</p>
      </div>
      <div class="pr-pane" data-p="2" hidden>
        ${row('Verschlüsselt', enc ? 'Ja' : 'Nein')}
        ${row('Kennwort zum Öffnen', enc ? 'Ja' : 'Nein')}
        <p class="muted small">${enc ? 'Diese PDF ist geschützt. Beim Speichern mit Notizen schreibt PDF-Stift eine ungeschützte Fassung.' : 'Eine geschützte Kopie (mit Kennwort zum Öffnen) erstellen Sie über Werkzeuge → Mit Passwort schützen.'}</p>
        ${enc ? '' : '<div class="dlg-actions" style="justify-content:flex-start"><button type="button" class="btn" id="prProtect">Mit Passwort schützen …</button></div>'}
      </div>
      <div class="pr-pane" data-p="3" hidden>
        ${fonts.size ? `<ul class="pr-fonts">${[...fonts].sort((a, b) => a[0].localeCompare(b[0])).map(([n, f]) => `<li><b>${esc(n)}</b><span class="muted small">${esc(f.sub || '')} · ${f.emb ? 'Schrift eingebettet' : 'nicht eingebettet'}</span></li>`).join('')}</ul>` : '<p class="muted">Keine Schriften gefunden (z. B. ein reiner Scan).</p>'}
      </div>
      <div class="pr-pane" data-p="4" hidden>
        ${row('Ordner', esc(folderOf(path) || 'Bibliothek'))}${row('Dateigröße', fmeta.size ? fmtSize(fmeta.size) : '–')}${row('Seiten', String(doc.getPageCount()))}
        ${row('Seitengröße', `${mm(pg0.width)} × ${mm(pg0.height)} mm`)}${row('PDF-Version', ver)}
        ${row('Notizen', String(V.doc ? [...V.doc.strokes.values()].length : 0))}
      </div>
      <div class="dlg-actions"><button type="submit" value="" class="btn">Abbrechen</button><button type="submit" value="ok" class="btn primary">Speichern</button></div></form>`;
    document.body.appendChild(d);
    d.querySelectorAll('.pr-tabs button').forEach((b) => { b.onclick = () => {
      d.querySelectorAll('.pr-tabs button').forEach((x) => x.classList.toggle('on', x === b));
      d.querySelectorAll('.pr-pane').forEach((p) => { p.hidden = p.dataset.p !== b.dataset.t; });
    }; });
    const pb = d.querySelector('#prProtect'); if (pb) pb.onclick = () => { d.close(); runTool('protect'); };
    d.addEventListener('close', async () => {
      d.remove();
      if (d.returnValue !== 'ok') return;
      const nv = { title: $('#prTitle', d).value.trim(), author: $('#prAuthor', d).value.trim(), subject: $('#prSubject', d).value.trim(), keywords: $('#prKeys', d).value.trim() };
      const layout = $('#prLayout', d).value, mode = $('#prMode', d).value;
      const changed = Object.keys(nv).some((k) => nv[k] !== String(info[k] || '').trim()) || layout !== layout0 || mode !== mode0;
      if (!changed) return;
      try {
        await flush();
        const doc2 = await PDFDocument.load(await pdfBytes(pdfCache.get(path)), { ignoreEncryption: true, updateMetadata: false });
        doc2.setTitle(nv.title, { showInWindowTitleBar: !!nv.title }); doc2.setAuthor(nv.author); doc2.setSubject(nv.subject);
        doc2.setKeywords(nv.keywords ? nv.keywords.split(/\s*[,;]\s*/).filter(Boolean) : []);
        doc2.setModificationDate(new Date());
        const c2 = doc2.catalog;
        if (layout) c2.set(PDFName.of('PageLayout'), PDFName.of(layout)); else c2.delete(PDFName.of('PageLayout'));
        if (mode) c2.set(PDFName.of('PageMode'), PDFName.of(mode)); else c2.delete(PDFName.of('PageMode'));
        const n = V.pages.length;
        await commitPdf(path, await pdfSave(doc2), [...Array(n).keys()], {}, currentPageIndex());
        toast('Dokumenteigenschaften gespeichert.');
      } catch (e) { toast('Speichern nicht möglich: ' + e.message, 6000); }
    }, { once: true });
    d.showModal();
  }

  // ---- Hilfe: Kurzanleitung und Versionsnummern
  function openHelp() { track('tool', 'Kurzanleitung'); window.open((LANG === 'en' ? 'hilfe.en.html' : 'hilfe.html') + (LOCAL ? '?ed=local' : ''), '_blank'); }
  async function aboutDlg() {
    if (LOCAL) {
      let win = '';
      try { if (window.pdfstiftWin) win = await window.pdfstiftWin.version(); } catch (e) { /* */ }
      if (await confirmDlg('Über PDF-Stift', `PDF-Stift ${win || VERSION} (Oberfläche ${VERSION})\nFreie Software unter der GNU General Public License, Version 3.\n\ngithub.com/ek1-wq/pdf-stift`, 'Kurzanleitung')) openHelp();
      return;
    }
    let win = '', tab = '–';
    try { if (window.pdfstiftWin) win = await window.pdfstiftWin.version(); } catch (e) { /* */ }
    try { const r = await fetch('android/version.json', { cache: 'no-store' }); const j = await r.json(); if (j.versionName) tab = j.versionName; } catch (e) { /* */ }
    const lines = [`Server (${location.host}): ${VERSION}`];
    if (win) lines.unshift(`Windows-App: ${win}`);
    lines.push(`Aktuelle Tablet-App: ${tab}`);
    if (await confirmDlg('Über PDF-Stift', lines.join('\n') + '\n\n' + location.host, 'Kurzanleitung')) openHelp();
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'F1' && !window.pdfstiftWin) { e.preventDefault(); openHelp(); } });

  // ---- Bericht für Verbesserungen: Zusammenfassung des Nutzungsprotokolls zum Hineinkopieren in den Chat
  async function usageReport() {
    await usageFlush();
    let txt = '';
    try { const r = await fetch(API + '?a=usagereport&days=30', { credentials: 'same-origin', headers: { 'X-PDFStift': '1' }, cache: 'no-store' }); if (!r.ok) throw new Error(r.status); txt = await r.text(); }
    catch (e) { toast('Der Bericht ließ sich nicht laden – ist der Server erreichbar?', 5000); return; }
    const d = document.createElement('dialog');
    d.className = 'dlg set-dlg rep-dlg';
    d.innerHTML = `<form method="dialog"><h2>Bericht für Verbesserungen</h2><p class="muted small">Enthält nur, welche Werkzeuge benutzt wurden, Fehler und Wartezeiten der letzten 30 Tage – keine Inhalte und keine Dateinamen. Zum Weitergeben einfach kopieren und in den Chat einfügen.</p>
      <textarea class="rep-txt" readonly></textarea>
      <div class="dlg-actions"><button type="button" class="btn" data-a="dl">Als Datei speichern</button><button type="button" class="btn" data-a="cp">Kopieren</button><button type="submit" value="" class="btn primary">Schließen</button></div></form>`;
    d.querySelector('textarea').value = txt;
    document.body.appendChild(d);
    d.addEventListener('close', () => d.remove(), { once: true });
    d.querySelector('[data-a=cp]').onclick = async () => { try { await navigator.clipboard.writeText(txt); } catch (e) { const ta = d.querySelector('textarea'); ta.select(); document.execCommand('copy'); } toast('Bericht kopiert – jetzt im Chat einfügen (Strg+V).', 4000); };
    d.querySelector('[data-a=dl]').onclick = () => downloadBlob(new Blob([txt], { type: 'text/plain;charset=utf-8' }), `PDF-Stift Bericht ${new Date().toISOString().slice(0, 10)}.txt`);
    d.showModal();
  }

  // ---- Schwärzen: alte Fassungen auf dem Server löschen (wenn eingestellt)
  async function purgeAfterRedact(path) {
    if (!SET.redactPurge) return;
    for (let k = 0; k < 600 && upPending(path); k++) await new Promise((r) => setTimeout(r, 500));
    try { const r = await apiJson('purgebackup', { method: 'POST', body: { path } }); if (r.deleted) toast(`Die ungeschwärzten Fassungen (${r.deleted}) wurden gelöscht.`, 4000); } catch (e) { /* später nicht möglich */ }
  }

  // ---- Scans automatisch durchsuchbar machen
  const AO = { stopped: false, tried: new Set() };
  async function autoOcrCheck(path) {
    if (!SET.autoOcr || AO.stopped || OC.running || AO.tried.has(path) || navigator.onLine === false || path.startsWith('@nb/')) return;
    const pages = V.pages.slice(0, 3);
    if (!pages.length) return;
    let chars = 0;
    for (const P of pages) { try { chars += textOf(await (await pgOf(P)).getTextContent()).replace(/\s+/g, '').length; } catch (e) { /* */ } }
    if (V.path !== path || chars >= 25 * pages.length) return;
    AO.tried.add(path);
    toast('Scan erkannt – der Text wird im Hintergrund erkannt (Symbol oben rechts), damit du suchen und markieren kannst.', 5000);
    ocrQueue([path], true);
  }
  async function autoOcrLibrary() {
    if (!SET.autoOcr || AO.stopped || OC.running || navigator.onLine === false) return;
    try {
      const st = await apiJson('indexstatus');
      const todo = (st.scans || []).map((x) => x.path).filter((p) => !AO.tried.has(p)).slice(0, 5);
      if (!todo.length) return;
      todo.forEach((p) => AO.tried.add(p));
      ocrQueue(todo, true);
    } catch (e) { /* älterer Server */ }
  }
  ocrInd();

  // ================================================================== Kommentare (Notizzettel)
  function drawNoteIcon(ctx, s, k) {
    const x = s.pts[0] * k, y = s.pts[1] * k, w = 20 * k, h = 20 * k, r = 3 * k;
    ctx.save();
    ctx.fillStyle = s.c || '#FFD43B';
    ctx.strokeStyle = 'rgba(0,0,0,.45)';
    ctx.lineWidth = Math.max(1, 0.8 * k);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h * 0.72 - r); ctx.quadraticCurveTo(x + w, y + h * 0.72, x + w - r, y + h * 0.72);
    ctx.lineTo(x + w * 0.45, y + h * 0.72); ctx.lineTo(x + w * 0.25, y + h); ctx.lineTo(x + w * 0.28, y + h * 0.72);
    ctx.lineTo(x + r, y + h * 0.72); ctx.quadraticCurveTo(x, y + h * 0.72, x, y + h * 0.72 - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    for (const f of [0.22, 0.38, 0.54]) { ctx.beginPath(); ctx.moveTo(x + w * 0.2, y + h * f); ctx.lineTo(x + w * 0.8, y + h * f); ctx.stroke(); }
    ctx.restore();
  }
  function noteAt(P, x, y) {
    let hit = null;
    if (V.doc) for (const t of V.doc.strokes.values()) if (t.p === P.i && t.t === 'txt' && t.nt && x >= t.pts[0] - 3 && x <= t.pts[0] + 23 && y >= t.pts[1] - 3 && y <= t.pts[1] + 23) hit = t;
    return hit;
  }
  let notePop = null;
  function closeNote(save = true) {
    const np = notePop;
    if (!np) return;
    notePop = null;
    const text = np.ta.value.replace(/\s+$/, '');
    np.el.remove();
    if (!save || !V.path) return;
    const old = np.old;
    if (old && text === old.text) return;
    const acts = [];
    if (old) { opDel(V.path, [old.id]); acts.push({ t: 'del', strokes: [old] }); }
    if (text) {
      if (!old) track('tool', 'Kommentar angelegt');
      const st = { id: uid(), p: np.P.i, t: 'txt', nt: 1, c: old ? old.c : S.color.nt || '#FFD43B', fs: 12, pts: old ? old.pts.slice() : [r2(np.x), r2(np.y)], text, bw: 20, bh: 20 };
      opAdd(V.path, [st]); acts.push({ t: 'add', strokes: [st] });
    }
    if (acts.length) pushHistory(acts.length === 1 ? acts[0] : { t: 'multi', acts });
    drawInk(np.P);
    renderComments();
  }
  function openNote(P, x, y, old) {
    closeNote();
    const sc = P.cssW / P.w;
    const el = document.createElement('div');
    el.className = 'note-pop';
    const px = old ? old.pts[0] : x, py = old ? old.pts[1] : y;
    el.style.left = Math.min(px * sc + 26, P.cssW - 260) + 'px';
    el.style.top = py * sc + 'px';
    el.innerHTML = `<div class="np-head">Kommentar · Seite ${P.i + 1}</div><textarea rows="5" placeholder="Kommentar schreiben …"></textarea>
      <div class="np-bar"><button type="button" data-a="del" class="text-btn">${old ? 'Löschen' : 'Verwerfen'}</button><button type="button" data-a="ok" class="btn primary">Fertig</button></div>`;
    P.el.appendChild(el);
    const ta = el.querySelector('textarea');
    ta.value = old ? old.text : '';
    notePop = { P, x: px, y: py, old, el, ta };
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.querySelector('[data-a=ok]').onclick = () => closeNote(true);
    el.querySelector('[data-a=del]').onclick = () => { ta.value = ''; closeNote(true); };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNote(true); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) closeNote(true); });
    ta.focus();
    setTimeout(() => { if (document.activeElement !== ta) ta.focus(); }, 0);
  }
  // Notizzettel antippen öffnet ihn (mit jedem Werkzeug); Werkzeug „Kommentar“ legt einen neuen an
  pagesEl.addEventListener('pointerdown', (e) => {
    if (V.board) return;
    if (e.target.closest('.note-pop')) return;
    if (notePop) closeNote(true);
    const pageEl = e.target.closest('.page');
    if (!pageEl) return;
    const P = V.pages[+pageEl.dataset.i];
    if (!P) return;
    const r = P.el.getBoundingClientRect(), sc = r.width / P.w;
    if ((V.viewRot || 0) !== 0) {
      if (!['sel', 'hand'].includes(S.tool) && e.pointerType !== 'touch') { e.stopPropagation(); e.preventDefault(); toast('Die Ansicht ist gedreht. Zum Schreiben bitte zurückdrehen (Rechtsklick → Ansicht drehen).', 3500); }
      return;
    }
    const hit = noteAt(P, (e.clientX - r.left) / sc, (e.clientY - r.top) / sc);
    if (hit) { e.stopPropagation(); e.preventDefault(); openNote(P, 0, 0, hit); return; }
    if (S.tool === 'nt' && e.button === 0 && (e.pointerType !== 'touch' || S.finger)) { e.stopPropagation(); e.preventDefault(); openNote(P, (e.clientX - r.left) / sc - 4, (e.clientY - r.top) / sc - 4, null); }
  }, true);
  pagesEl.addEventListener('click', (e) => {
    if (S.tool !== 'nt' || V.board || notePop || e.target.closest('.note-pop')) return;
    if (e.pointerType && e.pointerType !== 'touch') return;
    const pageEl = e.target.closest('.page'); if (!pageEl) return;
    const P = V.pages[+pageEl.dataset.i]; const r = P.el.getBoundingClientRect(), sc = r.width / P.w;
    openNote(P, (e.clientX - r.left) / sc - 4, (e.clientY - r.top) / sc - 4, null);
  });

  // ---- Kommentarliste (rechts)
  function renderComments() {
    const pn = $('#cmPanel');
    if (!pn || pn.hidden) return;
    const list = V.doc ? [...V.doc.strokes.values()].filter((s) => (s.t === 'txt' || s.t === 'tx') && !s.ln).sort((a, b) => a.p - b.p || a.pts[1] - b.pts[1]) : [];
    const kindL = (s) => (s.t === 'tx' ? ({ hl: 'Hervorhebung', ul: 'Unterstreichung', st: 'Durchstreichung' }[s.k] || 'Markierung') : s.nt ? 'Kommentar' : 'Textfeld');
    pn.querySelector('.cm-list').innerHTML = list.length ? list.map((s) => `<button type="button" class="cm-item" data-id="${esc(s.id)}"><span class="cm-k"><i style="background:${esc(s.c || '#FFD43B')}"></i>${kindL(s)} · S. ${s.p + 1}</span>${s.text ? `<span class="cm-t">${esc(s.text.slice(0, 300))}</span>` : ''}</button>`).join('')
      : '<p class="muted small">Noch keine Kommentare, Textfelder oder Markierungen. Neuer Kommentar: Werkzeug „Kommentar“ wählen und auf die Seite klicken.</p>';
    pn.querySelectorAll('.cm-item').forEach((b) => {
      b.onclick = () => {
        const s = V.doc.strokes.get(b.dataset.id); if (!s) return;
        const P = V.pages[s.p]; if (!P) return;
        viewer.scrollTop = P.top + (s.pts[1] / P.h) * P.cssH - viewer.clientHeight / 3;
        if (s.nt) setTimeout(() => openNote(P, 0, 0, s), 250);
      };
    });
  }
  $('#cmBtn').onclick = () => toggleComments();
  $('#btnSettings').onclick = () => settingsDialog();
  function toggleComments(on) {
    let pn = $('#cmPanel');
    if (!pn) {
      pn = document.createElement('aside');
      pn.id = 'cmPanel';
      pn.className = 'cm-panel';
      pn.hidden = true;
      pn.innerHTML = '<div class="cm-head"><b>Kommentare</b><button type="button" class="icon-btn" aria-label="Schließen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><div class="cm-list"></div>';
      document.body.appendChild(pn);
      pn.querySelector('.cm-head button').onclick = () => toggleComments(false);
    }
    pn.hidden = on === undefined ? !pn.hidden : !on;
    if (!pn.hidden) track('tool', 'Kommentarliste');
    $('#cmBtn').setAttribute('aria-pressed', pn.hidden ? 'false' : 'true');
    const was = document.body.classList.contains('cm-on');
    document.body.classList.toggle('cm-on', !pn.hidden);
    if (was !== !pn.hidden) window.dispatchEvent(new Event('resize'));
    if (!pn.hidden) { const r = $('#viewer').getBoundingClientRect(); pn.style.top = r.top + 'px'; pn.style.height = r.height + 'px'; }
    renderComments();
  }

  // ================================================================== Suchen & Schwärzen · Handzettel · Scans aufbereiten
  function formDlg(title, html, ok) {
    return new Promise((res) => {
      const d = document.createElement('dialog');
      d.className = 'dlg set-dlg';
      d.innerHTML = `<form method="dialog"><h2></h2>${html}<div class="dlg-actions"><button type="submit" value="" class="btn">Abbrechen</button><button type="submit" value="ok" class="btn primary"></button></div></form>`;
      d.querySelector('h2').textContent = title;
      d.querySelector('[value=ok]').textContent = ok;
      document.body.appendChild(d);
      d.addEventListener('close', () => { res(d.returnValue === 'ok' ? d : null); setTimeout(() => d.remove(), 0); }, { once: true });
      d.showModal();
    });
  }
  const fChk = (id, label, on, hint) => `<label class="check"><input id="${id}" type="checkbox"${on ? ' checked' : ''}> <span>${label}${hint ? `<br><span class="muted small">${hint}</span>` : ''}</span></label>`;

  // ---- Suchen & Schwärzen: alle Treffer werden als Schwärzungs-Bereiche vorgemerkt, man prüft sie und wendet dann an
  const FR_PRESETS = [
    ['mail', 'E-Mail-Adressen', /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/g],
    ['tel', 'Telefonnummern', /(?:\+\d|\b0)[\d \/()\-]{5,}\d/g, (m) => { const k = m.replace(/\D/g, '').length; return k >= 7 && k <= 15; }],
    ['iban', 'IBAN (Kontonummern)', /\b[a-z]{2}\d{2}(?: ?[a-z0-9]{4}){3,7}(?: ?[a-z0-9]{1,3})?\b/g],
    ['matr', 'Matrikelnummern (6- bis 8-stellige Zahlen)', /(?<![\d.,])\d{6,8}(?![\d]|[.,]\d)/g],
    ['date', 'Datumsangaben (z. B. 12.03.2001)', /\b\d{1,2}\.\s?\d{1,2}\.\s?(?:\d{4}|\d{2})\b/g],
  ];
  // wie matchRects, aber Zeichenbreiten nach einer Proportionalschrift gemessen (genauer bei langen Zeilen)
  const MEAS = document.createElement('canvas').getContext('2d');
  function exactRects(idx, s0, e0) {
    const out = [];
    MEAS.font = '100px Helvetica, Arial, sans-serif';
    for (const it of idx.items) {
      const a = Math.max(s0, it.start), b = Math.min(e0, it.start + it.n);
      if (a >= b) continue;
      const full = MEAS.measureText(it.s).width || 1;
      const x0 = (MEAS.measureText(it.s.slice(0, a - it.start)).width / full) * it.w;
      const x1 = (MEAS.measureText(it.s.slice(0, b - it.start)).width / full) * it.w;
      out.push({ x: it.x + x0, y: it.y, w: x1 - x0, h: it.h });
    }
    return out;
  }
  async function findRedact() {
    track('tool', 'Suchen & Schwärzen');
    if (!V.path || V.board || !needOnline('Schwärzen')) return;
    const last = ls('frLast') || { terms: '', pre: [], word: true };
    const d = await formDlg('Suchen und schwärzen', `<p class="muted small">Alle passenden Stellen werden schwarz vorgemerkt. Danach kannst du sie prüfen, einzelne mit ✕ wieder entfernen oder weitere Bereiche aufziehen. Erst „Schwärzen anwenden“ entfernt sie endgültig.</p>
      <label for="frTerms">Wörter oder Namen (ein Begriff pro Zeile)</label>
      <textarea id="frTerms" rows="4" class="fr-terms" placeholder="z. B.&#10;Max Mustermann&#10;Musterstraße 12">${esc(last.terms || '')}</textarea>
      <h3 class="dlg-sub">Außerdem automatisch finden</h3>
      ${FR_PRESETS.map(([k, l]) => `<label class="check"><input type="checkbox" data-k="${k}"${(last.pre || []).includes(k) ? ' checked' : ''}> <span>${l}</span></label>`).join('')}
      ${fChk('frWord', 'Nur ganze Wörter (bei den eigenen Begriffen)', last.word !== false)}`, 'Suchen');
    if (!d) return;
    const terms = d.querySelector('#frTerms').value.split(/\n+/).map((t) => t.trim()).filter(Boolean);
    const pre = [...d.querySelectorAll('[data-k]:checked')].map((x) => x.dataset.k);
    const word = d.querySelector('#frWord').checked;
    ls('frLast', { terms: terms.join('\n'), pre, word });
    if (!terms.length && !pre.length) { toast('Bitte einen Begriff eingeben oder etwas zum automatischen Finden auswählen.'); return; }
    const pats = terms.map((t) => {
      const e = t.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
      return { re: new RegExp(word ? `(?<![\\p{L}\\d])${e}(?![\\p{L}\\d])` : e, 'gu') };
    }).concat(FR_PRESETS.filter((p) => pre.includes(p[0])).map((p) => ({ re: new RegExp(p[2].source, 'g'), ok: p[3] })));
    const path = V.path;
    peStart('redact');
    if (PE.mode !== 'redact') return;
    toast('Wird durchsucht …', 120000);
    const tFr = performance.now();
    let n = 0, noText = 0;
    const hitPages = new Set();
    for (const P of V.pages) {
      if (V.path !== path || PE.mode !== 'redact') return;
      const idx = await pageTextIndex(P).catch(() => null);
      if (!idx || !idx.str.trim()) { noText++; continue; }
      for (const pt of pats) {
        pt.re.lastIndex = 0;
        let m;
        while ((m = pt.re.exec(idx.str))) {
          if (!m[0].length) { pt.re.lastIndex++; continue; }
          if (pt.ok && !pt.ok(m[0])) continue;
          const rs = exactRects(idx, m.index, m.index + m[0].length);
          if (!rs.length) continue;
          if (!PE.rects.has(P.i)) PE.rects.set(P.i, []);
          for (const r of rs) {
            // Zeichenbreiten sind nur geschätzt: seitlich großzügig, damit nichts herausschaut
            const pad = r.h * 0.12, padX = r.h * 0.2;
            const x = Math.max(0, r.x - padX), y = Math.max(0, r.y - pad);
            PE.rects.get(P.i).push({ x: x / P.w, y: y / P.h, w: Math.min(P.w - x, r.w + 2 * padX) / P.w, h: Math.min(P.h - y, r.h + 2 * pad) / P.h });
          }
          n++; hitPages.add(P.i);
        }
      }
      if (P.i % 10 === 9) await new Promise((r) => setTimeout(r, 0));
    }
    V.pages.forEach((P) => { if (PE.rects.has(P.i)) peDrawRects(P); });
    peBarText();
    track('perf', 'Suchen & Schwärzen: Suche', performance.now() - tFr, `${V.pages.length} Seiten, ${n} Treffer`);
    const scanHint = noText ? ` ${noText} ${noText === 1 ? 'Seite hat' : 'Seiten haben'} keinen erkannten Text (Scan) – dort bitte zuerst „Scans optimieren“.` : '';
    toast(n ? `${n} ${n === 1 ? 'Stelle' : 'Stellen'} auf ${hitPages.size} ${hitPages.size === 1 ? 'Seite' : 'Seiten'} gefunden – bitte prüfen, dann „Schwärzen anwenden“.${scanHint}` : 'Nichts gefunden.' + scanHint, 8000);
    if (hitPages.size) goToPage(Math.min(...hitPages));
  }

  // ---- Handzettel: mehrere Seiten (Folien) verkleinert auf A4, auf Wunsch mit Linien für Notizen
  const latin = (s) => String(s).replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
  async function handoutDialog() {
    track('tool', 'Handzettel');
    if (!V.path || V.board || !needOnline('Handzettel')) return;
    const last = ls('hoLast') || { n: '3l', frame: true, num: true, notes: true, head: true };
    const opts = [['1l', '1 Folie mit Linien darunter'], ['2', '2 Folien pro Seite'], ['3l', '3 Folien mit Linien für Notizen'], ['4', '4 Folien pro Seite'], ['6', '6 Folien pro Seite'], ['9', '9 Folien pro Seite']];
    const d = await formDlg('Handzettel', `<p class="muted small">Mehrere Seiten, z. B. Vorlesungsfolien, verkleinert auf ein A4-Blatt – zum Ausdrucken und Mitschreiben. Es entsteht eine neue PDF im selben Ordner; das Original bleibt unverändert.</p>
      <div class="set-row"><span>Aufteilung</span><select id="hoN">${opts.map(([k, l]) => `<option value="${k}"${k === last.n ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="set-row"><span>Welche Seiten</span><input id="hoPages" type="text" placeholder="alle (oder z. B. 1-20)" class="ho-pages"></div>
      ${fChk('hoFrame', 'Rahmen um jede Folie', last.frame)}
      ${fChk('hoNum', 'Foliennummer anzeigen', last.num)}
      ${fChk('hoHead', 'Kopfzeile mit Dateiname und Seitenzahl', last.head)}
      ${fChk('hoNotes', 'Mit meinen Notizen und Markierungen', last.notes)}`, 'Erstellen');
    if (!d) return;
    const o = { n: d.querySelector('#hoN').value, frame: d.querySelector('#hoFrame').checked, num: d.querySelector('#hoNum').checked, head: d.querySelector('#hoHead').checked, notes: d.querySelector('#hoNotes').checked };
    const pagesStr = d.querySelector('#hoPages').value.trim();
    ls('hoLast', o);
    const path = V.path, total = V.pages.length;
    const idxs = pagesStr ? parsePages(pagesStr, total) : [...Array(total).keys()];
    if (!idxs.length) { toast('Keine gültigen Seitenzahlen erkannt.'); return; }
    if (!(await readyToEdit())) return;
    toast('Handzettel wird erstellt …', 120000);
    const tHo = performance.now();
    try {
      const bytes = await buildHandout(o.notes ? await annotatedBytesFor(path) : await pdfBytes(pdfCache.get(path)), idxs, o, stem(path));
      const saved = await saveNewPdf(folderOf(path), `${stem(path)} (Handzettel).pdf`, bytes);
      track('perf', 'Handzettel erstellen', performance.now() - tHo, `${idxs.length} Folien, ${o.n} je Seite`);
      await loadLibrary();
      toast(`„${basename(saved)}“ erstellt.`, 4000);
      if (await confirmDlg('Handzettel öffnen?', basename(saved), 'Öffnen')) openDoc(saved);
    } catch (err) { toast('Handzettel nicht erstellt: ' + err.message, 6000); }
  }
  async function buildHandout(srcBytes, idxs, o, title) {
    const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib;
    const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
    const out = await PDFDocument.create();
    const font = await out.embedFont(StandardFonts.Helvetica);
    const pages = idxs.map((i) => src.getPage(i));
    const boxes = pages.map((p) => { const b = p.getCropBox(); return { left: b.x, bottom: b.y, right: b.x + b.width, top: b.y + b.height }; });
    const emb = await out.embedPages(pages, boxes);
    const rots = pages.map((p) => ((p.getRotation().angle % 360) + 360) % 360);
    const dims = emb.map((e, k) => (rots[k] % 180 ? [e.height, e.width] : [e.width, e.height]));
    const portraitSrc = dims.filter(([w, h]) => h > w).length > dims.length / 2;
    const layout = { '1l': [1, 1], 2: portraitSrc ? [2, 1] : [1, 2], '3l': [1, 3], 4: [2, 2], 6: [2, 3], 9: [3, 3] }[o.n] || [2, 2];
    const lines = o.n.endsWith('l');
    const land = o.n === '2' && portraitSrc;
    const PW = land ? 841.89 : 595.28, PH = land ? 595.28 : 841.89;
    const M = 36, head = o.head ? 18 : 0, gap = 14, numH = o.num ? 11 : 0;
    const [cols, rows] = layout, per = cols * rows;
    const sheets = Math.ceil(emb.length / per);
    const gray = rgb(0.55, 0.55, 0.58), lineC = rgb(0.78, 0.78, 0.8);
    for (let s = 0; s < sheets; s++) {
      const pg = out.addPage([PW, PH]);
      if (o.head) {
        const t = latin(title).slice(0, 90);
        pg.drawText(t, { x: M, y: PH - M + 4, size: 9, font, color: gray });
        const r = `Seite ${s + 1} von ${sheets}`;
        pg.drawText(r, { x: PW - M - font.widthOfTextAtSize(r, 9), y: PH - M + 4, size: 9, font, color: gray });
      }
      const areaW = PW - 2 * M, areaH = PH - 2 * M - head;
      const cw = (areaW - (cols - 1) * gap) / cols, ch = (areaH - (rows - 1) * gap) / rows;
      for (let k = 0; k < per; k++) {
        const e = s * per + k;
        if (e >= emb.length) break;
        const c = k % cols, r = Math.floor(k / cols);
        const cx = M + c * (cw + gap), cyTop = PH - M - head - r * (ch + gap);
        // Platz für die Folie: bei „mit Linien“ links (3) bzw. oben (1), sonst die ganze Zelle
        const sw = o.n === '3l' ? cw * 0.55 : cw, sh = (o.n === '1l' ? ch * 0.55 : ch) - numH;
        const [W, H] = dims[e];
        const sc = Math.min(sw / W, sh / H);
        const bw = W * sc, bh = H * sc;
        const bx = o.n === '3l' || o.n === '1l' ? cx + (o.n === '1l' ? (cw - bw) / 2 : 0) : cx + (sw - bw) / 2;
        const by = o.n === '1l' ? cyTop - numH - bh : cyTop - numH - (sh - bh) / 2 - bh;
        const ep = emb[e], rot = rots[e];
        const w0 = ep.width * sc, h0 = ep.height * sc;
        if (rot === 90) pg.drawPage(ep, { x: bx, y: by + w0, xScale: sc, yScale: sc, rotate: degrees(-90) });
        else if (rot === 180) pg.drawPage(ep, { x: bx + w0, y: by + h0, xScale: sc, yScale: sc, rotate: degrees(180) });
        else if (rot === 270) pg.drawPage(ep, { x: bx + h0, y: by, xScale: sc, yScale: sc, rotate: degrees(90) });
        else pg.drawPage(ep, { x: bx, y: by, xScale: sc, yScale: sc });
        if (o.frame) pg.drawRectangle({ x: bx, y: by, width: bw, height: bh, borderColor: gray, borderWidth: 0.6 });
        if (o.num) pg.drawText(`${idxs[e] + 1}`, { x: bx, y: by + bh + 3, size: 8, font, color: gray });
        if (lines) {
          // Linien für Notizen
          const lx0 = o.n === '3l' ? bx + bw + 16 : cx, lx1 = cx + cw;
          const ly0 = o.n === '3l' ? cyTop - 10 : by - 26, ly1 = cyTop - ch + 6;
          for (let y = ly0; y >= ly1; y -= 20) pg.drawLine({ start: { x: lx0, y }, end: { x: lx1, y }, thickness: 0.5, color: lineC });
        }
      }
    }
    out.setTitle(latin(title) + ' (Handzettel)');
    return out.save();
  }

  // ---- Scans aufbereiten: gerade richten, leere Seiten entfernen, Kontrast verstärken (nur eingescannte Seiten)
  async function pageKind(pg) {
    const OPS = pdfjsLib.OPS;
    let chars = 0;
    try { chars = (await pg.getTextContent()).items.reduce((a, it) => a + (it.str || '').replace(/\s+/g, '').length, 0); } catch (e) { /* */ }
    let img = false, invisible = false;
    try {
      const ol = await pg.getOperatorList();
      for (let k = 0; k < ol.fnArray.length; k++) {
        const f = ol.fnArray[k];
        if (f === OPS.paintImageXObject || f === OPS.paintInlineImageXObject || f === OPS.paintJpegXObject || f === OPS.paintImageXObjectRepeat || f === OPS.paintImageMaskXObject) img = true;
        else if (f === OPS.setTextRenderingMode && ol.argsArray[k] && ol.argsArray[k][0] === 3) invisible = true;
      }
    } catch (e) { /* */ }
    if (img && (chars < 25 || invisible)) return 'scan';
    if (chars < 5) return img ? 'scan' : 'empty';
    return 'text';
  }
  async function renderGray(pg, width) {
    const vp0 = pg.getViewport({ scale: 1 });
    const vp = pg.getViewport({ scale: width / vp0.width });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: ctx, viewport: vp, annotationMode: AM }).promise;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const g = new Uint8Array(c.width * c.height);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    const out = { g, w: c.width, h: c.height };
    c.width = c.height = 0;
    return out;
  }
  // Papierhelligkeit und dunkle Stellen
  function scanStats(im) {
    const hist = new Uint32Array(256);
    for (let k = 0; k < im.g.length; k++) hist[im.g[k]]++;
    const pct = (p) => { let a = 0; const lim = im.g.length * p; for (let v = 0; v < 256; v++) { a += hist[v]; if (a >= lim) return v; } return 255; };
    const paper = pct(0.6), dark = pct(0.005);
    return { paper, dark, thr: Math.max(40, paper - Math.max(50, (paper - dark) * 0.45)) };
  }
  function isBlankPage(im, st) {
    // Rand (Scannerkanten, Lochungen) nicht mitzählen
    const mx = Math.round(im.w * 0.06), my = Math.round(im.h * 0.05);
    let ink = 0, n = 0;
    for (let y = my; y < im.h - my; y += 2) for (let x = mx; x < im.w - mx; x += 2) { n++; if (im.g[y * im.w + x] < st.thr) ink++; }
    return st.paper - st.dark < 40 || ink / n < 0.0015;
  }
  function skewAngle(im, st) {
    const xs = [], ys = [];
    const step = Math.max(1, Math.round(Math.sqrt((im.w * im.h) / 400000)));
    for (let y = 0; y < im.h; y += step) for (let x = 0; x < im.w; x += step) if (im.g[y * im.w + x] < st.thr) { xs.push(x); ys.push(y); }
    if (xs.length < 300) return 0;
    const L = Math.ceil(Math.hypot(im.w, im.h)) + 2, acc = new Int32Array(L * 2);
    const score = (deg) => {
      const a = (deg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
      acc.fill(0);
      // Zeilen so breit wie der Abtastschritt – sonst bevorzugt das Raster den Winkel 0
      for (let k = 0; k < xs.length; k++) acc[Math.round((ys[k] * ca - xs[k] * sa) / step) + L]++;
      let s = 0;
      for (let k = 0; k < acc.length; k++) s += acc[k] * acc[k];
      return s;
    };
    let best = 0, bs = score(0);
    const s0 = bs;
    for (let d = -6; d <= 6.001; d += 0.5) { const s = score(d); if (s > bs) { bs = s; best = d; } }
    const c = best;
    for (let d = c - 0.45; d <= c + 0.451; d += 0.05) { const s = score(d); if (s > bs) { bs = s; best = d; } }
    return Math.abs(best) >= 0.2 && bs > s0 * 1.03 ? best : 0;
  }
  async function scanFixDialog() {
    track('tool', 'Scans aufbereiten');
    if (!V.path || V.board || !needOnline('Scans aufbereiten')) return;
    const last = ls('sfLast') || { deskew: true, blank: true, contrast: true, gray: false };
    const d = await formDlg('Scans aufbereiten', `<p class="muted small">Für eingescannte Seiten, z. B. Klausuren oder Kopien. Seiten mit echtem Text (z. B. aus Word) bleiben unverändert. Die vorige Fassung bleibt gesichert – „Rückgängig“ geht auch.</p>
      ${fChk('sfDeskew', 'Schiefe Seiten gerade richten', last.deskew)}
      ${fChk('sfBlank', 'Leere Seiten entfernen', last.blank, 'auch leere Rückseiten; Seiten mit deinen Notizen bleiben immer drin')}
      ${fChk('sfContrast', 'Kontrast verstärken', last.contrast, 'grauer Hintergrund wird weiß, blasse Schrift und Bleistift werden dunkler')}
      ${fChk('sfGray', 'In Graustufen speichern', last.gray, 'kleinere Datei; Farben gehen verloren')}`, 'Aufbereiten');
    if (!d) return;
    const o = { deskew: d.querySelector('#sfDeskew').checked, blank: d.querySelector('#sfBlank').checked, contrast: d.querySelector('#sfContrast').checked, gray: d.querySelector('#sfGray').checked };
    ls('sfLast', o);
    if (!o.deskew && !o.blank && !o.contrast && !o.gray) return;
    if (!(await readyToEdit())) return;
    const path = V.path;
    // eine laufende Texterkennung zuerst anhalten – sie wird danach neu gestartet
    if (OC.running) { OC.stop = true; toast('Die Texterkennung wird kurz angehalten …', 30000); while (OC.running) await new Promise((r) => setTimeout(r, 300)); }
    if (V.path !== path) return;
    const entry = pdfCache.get(path);
    const tSf = performance.now();
    try {
      const { PDFDocument } = PDFLib;
      const doc = await PDFDocument.load(await pdfBytes(entry), { ignoreEncryption: true });
      const n = entry.pdf.numPages;
      const withNotes = new Set(V.doc ? [...V.doc.strokes.values()].map((s) => s.p) : []);
      const blanks = [];
      let straight = 0, cleaned = 0, scans = 0;
      for (let i = 0; i < n; i++) {
        if (V.path !== path) { toast('Abgebrochen (andere PDF geöffnet).'); return; }
        toast(`Seite ${i + 1} von ${n} wird aufbereitet …`, 120000);
        const pg = await entry.pdf.getPage(i + 1);
        const kind = await pageKind(pg);
        if (kind === 'text') continue;
        const small = await renderGray(pg, 1000);
        const st = scanStats(small);
        if (o.blank && !withNotes.has(i) && isBlankPage(small, st)) { blanks.push(i); continue; }
        if (kind !== 'scan' || !(o.deskew || o.contrast || o.gray)) continue;
        scans++;
        const ang = o.deskew ? skewAngle(small, st) : 0;
        if (!ang && !o.contrast && !o.gray) continue;
        // in voller Auflösung neu aufbauen (200 dpi)
        const vp0 = pg.getViewport({ scale: 1 });
        const sc = Math.min(200 / 72, Math.sqrt(16e6 / (vp0.width * vp0.height)));
        const vp = pg.getViewport({ scale: sc });
        const src = document.createElement('canvas');
        src.width = Math.round(vp.width); src.height = Math.round(vp.height);
        const sctx = src.getContext('2d');
        sctx.fillStyle = '#fff'; sctx.fillRect(0, 0, src.width, src.height);
        await pg.render({ canvasContext: sctx, viewport: vp, annotationMode: AM }).promise;
        const c = document.createElement('canvas');
        c.width = src.width; c.height = src.height;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.save();
        if (ang) { ctx.translate(c.width / 2, c.height / 2); ctx.rotate((-ang * Math.PI) / 180); ctx.translate(-c.width / 2, -c.height / 2); }
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(src, 0, 0);
        ctx.restore();
        src.width = src.height = 0;
        if (o.contrast || o.gray) {
          const id = ctx.getImageData(0, 0, c.width, c.height), px = id.data;
          const lut = new Uint8ClampedArray(256);
          const lo = o.contrast ? Math.min(st.dark, 90) : 0, hi = o.contrast ? Math.max(lo + 60, st.paper - 10) : 255;
          for (let v = 0; v < 256; v++) { const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo))); lut[v] = Math.round(255 * (o.contrast ? Math.pow(t, 1.5) : t)); }
          for (let k = 0; k < px.length; k += 4) {
            if (o.gray) { const v = lut[(px[k] * 77 + px[k + 1] * 150 + px[k + 2] * 29) >> 8]; px[k] = px[k + 1] = px[k + 2] = v; }
            else { px[k] = lut[px[k]]; px[k + 1] = lut[px[k + 1]]; px[k + 2] = lut[px[k + 2]]; }
          }
          ctx.putImageData(id, 0, 0);
        }
        const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
        c.width = c.height = 0;
        const img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
        const np = doc.insertPage(i, [vp0.width, vp0.height]);
        np.drawImage(img, { x: 0, y: 0, width: vp0.width, height: vp0.height });
        doc.removePage(i + 1);
        if (ang) straight++;
        if (o.contrast || o.gray) cleaned++;
      }
      if (blanks.length === n) { toast('Alle Seiten sehen leer aus – es wurde nichts geändert.', 5000); return; }
      if (!blanks.length && !straight && !cleaned) { toast(scans ? 'Alles in Ordnung – nichts zu ändern.' : 'Keine eingescannten Seiten gefunden – nichts zu ändern.', 5000); return; }
      for (let k = blanks.length - 1; k >= 0; k--) doc.removePage(blanks[k]);
      const map = [];
      for (let i = 0, j = 0; i < n; i++) map.push(blanks.includes(i) ? -1 : j++);
      pdfGc(doc);
      await commitPdf(path, await doc.save(), map, {}, null);
      track('perf', 'Scans aufbereiten', performance.now() - tSf, `${n} Seiten, ${straight} gerade gerichtet, ${blanks.length} leer`);
      const parts = [];
      if (straight) parts.push(`${straight} ${straight === 1 ? 'Seite' : 'Seiten'} gerade gerichtet`);
      if (blanks.length) parts.push(`${blanks.length} leere ${blanks.length === 1 ? 'Seite' : 'Seiten'} entfernt`);
      if (cleaned) parts.push(`${cleaned} ${cleaned === 1 ? 'Seite' : 'Seiten'} ${o.contrast ? 'kontrastreicher' : 'in Graustufen'}`);
      toast(parts.join(', ') + '.' + (straight || cleaned ? ' Der Text wird jetzt neu erkannt …' : ''), 7000);
      if (straight || cleaned) ocrQueue([path]);
    } catch (err) { toast('Aufbereiten fehlgeschlagen: ' + err.message, 6000); }
  }

  // App-Verknüpfungen (langes Drücken auf das App-Symbol): ?go=nb | marks | last
  function goShortcut() {
    const m = /[?&]go=(\w+)/.exec(location.search);
    if (!m) return;
    window.history.replaceState(null, '', location.pathname);
    if (m[1] === 'nb') { showLibrary(); const b = document.querySelector('#srcSwitch [data-src=nb]'); if (b) b.click(); }
    if (m[1] === 'marks') { showLibrary(); const b = document.querySelector('#srcSwitch [data-src=local]'); if (b && S.src !== 'local') b.click(); S.tag = '★'; renderLibrary(); }
    if (m[1] === 'last' && S.tabs.length) showDoc((S.tabs.find((t) => t.path === S.active) || S.tabs[S.tabs.length - 1]).path);
  }
  // Windows-App: „Öffnen mit PDF-Stift“ lädt die Datei hoch und öffnet sie dann über ?open=Pfad
  async function openParam() {
    const m = /[?&]open=([^&]+)/.exec(location.search);
    if (!m) return;
    window.history.replaceState(null, '', location.pathname);
    const p = decodeURIComponent(m[1]);
    if (!fileMeta(p) && !isBoard(p)) { try { await loadLibrary(); } catch (e) { /* */ } }
    if (isBoard(p)) { if (!S.boards) await loadBoards(); openDoc(p); return; }
    if (fileMeta(p)) openDoc(p); else toast('Die Datei liegt im Ordner „Eingang“.');
  }
  // ---- Helles / dunkles Design: Knopf oben rechts schaltet um, Einstellungen können wieder „wie das System“ wählen
  const sysDark = () => window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  function setTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    ls('theme', t || null);
    if (window.pdfstiftWin && window.pdfstiftWin.setTheme) window.pdfstiftWin.setTheme(t || 'system');
  }
  const curTheme = () => document.documentElement.dataset.theme || '';
  $('#themeBtn').onclick = () => { const dark = curTheme() ? curTheme() === 'dark' : sysDark(); setTheme(dark ? 'light' : 'dark'); track('tool', 'Design umgeschaltet'); };
  if (window.pdfstiftWin && window.pdfstiftWin.setTheme) window.pdfstiftWin.setTheme(curTheme() || 'system');
  // freie Ausgabe: kein nächtlicher Lauf auf einem Server – die Volltextsuche wird hier im Hintergrund nachgezogen
  // (Text mit pdf.js lesen, eine PDF nach der anderen; Scans ohne Text erledigt die Texterkennung)
  let LIX = null;
  function localIndex(loud) {
    if (LIX) return LIX;
    LIX = (async () => {
      let n = 0;
      for (const f of ((S.library && S.library.files) || []).slice()) {
        let c;
        try { c = await apiJson('indexcheck', { params: { path: f.path } }); } catch (e) { continue; }
        if (!c.ok) break;
        if (c.fresh) continue;
        if (loud) toast(`Erfasse den Text … ${basename(f.path)}`, 60000);
        let doc = null;
        try {
          doc = await pdfjsLib.getDocument({ data: await (await api('pdf', { params: { path: f.path } })).arrayBuffer() }).promise;
          const texts = [];
          for (let k = 1; k <= doc.numPages; k++) {
            try { texts.push(textOf(await (await doc.getPage(k)).getTextContent())); } catch (e) { texts.push(''); }
            if (k % 10 === 0) await new Promise((r) => setTimeout(r, 20));
          }
          await apiJson('indexput', { method: 'POST', body: { path: f.path, mtime: c.mtime, size: c.size, pages: texts, src: 'pdfjs' } });
          n++;
        } catch (e) { /* nächstes Mal */ } finally { if (doc) doc.destroy(); }
        await new Promise((r) => setTimeout(r, 150));
      }
      if (loud) toast('Fertig erfasst.');
      if (n && FT.q) ftRun(FT.q);
    })().finally(() => { LIX = null; });
    return LIX;
  }
  if (LOCAL && !EMBED && !SHOW) setTimeout(() => localIndex(false), 6000);
  // freie Ausgabe: Ordner der Bibliothek unten anzeigen, Klick öffnet ihn im Explorer
  if (LOCAL && window.pdfstiftWin && window.pdfstiftWin.libDir) {
    window.pdfstiftWin.libDir().then((x) => { const el = $('#libDir'); if (el && x) { el.textContent = x; el.style.cursor = 'pointer'; el.title = 'Im Explorer öffnen'; el.onclick = () => window.pdfstiftWin.libOpen(); } });
  }
  async function startApp() {
    S.started = true;
    if (!EMBED && !SHOW) setTimeout(() => { srvUpdCheck(); backupWatch(); }, 4000);
    if (/Android/.test(navigator.userAgent)) $('#apkBtn').hidden = false;
    if (/Windows/.test(navigator.userAgent) && !/PDFStiftWindows/.test(navigator.userAgent)) $('#winBtn').hidden = false;
    setTbPos(ls('tbPos') || 'top');
    $('#auth').hidden = true;
    $('#shell').hidden = false;
    await loadQueue();
    upRestore();
    (await DB.keys('pdfs')).forEach((k) => S.offline.add(k));
    renderToolbar();
    loadDecks();
    renderTabs();
    S.boards = (await DB.get('kv', 'boards')) || null;
    ls('signedIn', true);
    // Sofort mit dem Stand auf dem Gerät loslegen, der Server-Abgleich läuft dahinter
    const cached = await DB.get('kv', 'library');
    if (cached && cached.files) {
      S.library = cached;
      renderLibrary();
      loadLibrary().then(loadBoards);
    } else {
      await loadLibrary();
      loadBoards();
    }
    if (S.active && S.tabs.find((t) => t.path === S.active) && SET.startView !== 'library') showDoc(S.active);
    else showLibrary();
    if (pendingCount()) flush(); else setSync(navigator.onLine === false ? 'offline' : 'ok');
    if (EMBED) { openParam(); return; }
    if (BC && !SHOW) setTimeout(() => { if (V.path) BC.postMessage({ t: 'ping' }); }, 2500);
    if (SHOW) { showWinStart(); return; }
    liveResume();
    goShortcut();
    openParam();
    loadServerSettings();
    setTimeout(autoOcrLibrary, 45000);
    if (ls('splitPath')) setTimeout(() => { if (V.path && !SPLIT.frame) splitOpen(ls('splitPath')); }, 1200);
  }

  function sharedNotice() {
    const m = /[?&]shared=(\d+)/.exec(location.search);
    if (!m) return;
    window.history.replaceState(null, '', location.pathname);
    const n = +m[1];
    S.folder = n ? 'Eingang' : S.folder;
    setTimeout(() => toast(n ? `${n} ${n === 1 ? 'PDF' : 'PDFs'} empfangen – im Ordner „Eingang“.` : 'Es kam keine PDF an.'), 600);
  }

  async function boot() {
    sharedNotice();
    if ('serviceWorker' in navigator && !LOCAL) navigator.serviceWorker.register('sw.js').catch(() => {});
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    // Auf diesem Gerät schon angemeldet: ohne Warten auf den Server starten (läuft die Anmeldung ab, kommt die Abfrage von selbst)
    if (ls('signedIn')) { startApp(); return; }
    let me = null;
    try { me = await apiJson('me'); } catch (e) { me = null; }
    if (me && me.setup) showAuth(true);
    else if (me && !me.loggedIn) showAuth(false);
    else startApp(); // angemeldet – oder offline: dann mit den Daten auf dem Gerät arbeiten
  }
  // Neue Server-Version eingespielt, hier läuft aber noch die gespeicherte alte Oberfläche: einmal neu laden
  async function verCheck() {
    if (LOCAL || EMBED || !('serviceWorker' in navigator)) return;
    let me = null;
    try { me = await apiJson('me'); } catch (e) { return; }
    if (!me || !me.version || me.version === VERSION) return;
    try { if (sessionStorage.getItem('pdfstiftVerReload') === me.version) return; sessionStorage.setItem('pdfstiftVerReload', me.version); } catch (e) { return; }
    try { const r = await navigator.serviceWorker.getRegistration(); if (r) await r.update(); } catch (e) { /* */ }
    // nicht mitten in der Arbeit: warten, bis gerade nichts geschrieben oder abgeglichen wird
    const go = () => { if (cur || editor || pendingCount()) { setTimeout(go, 1500); return; } if (V.path) saveViewState(); location.reload(); };
    setTimeout(go, 1200);
  }
  setTimeout(verCheck, 2500);
  boot();
})();
