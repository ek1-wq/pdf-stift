/* PDF-Stift – PowerPoint-Dateien (.pptx): als Präsentation öffnen und Präsentationen als .pptx speichern.
 * Wird erst bei Bedarf geladen. Braucht window.PDFSTIFT_CORE (app.js), window.PDFSTIFT_DECK (deck.js) und fflate.
 * Maßstab: eine Folie ist 960 Bildpunkte breit; in PowerPoint 13,333 Zoll = 960 pt – 1 Bildpunkt entspricht also 1 pt. */
(() => {
  'use strict';
  const C = window.PDFSTIFT_CORE;
  const X = () => window.PDFSTIFT_DECK.PX;
  // Aufzählungszeichen aus PowerPoint: Zeichen der Symbolschriften (Wingdings, Symbol) in Unicode übersetzen
  // je Schrift: Zeichencode (unteres Byte, Symbolschriften liegen oft bei U+F0xx) → Unicode
  const SYM_BU = {
    wingdings: { 0x6c: '●', 0x6e: '■', 0x71: '❑', 0x75: '◆', 0x76: '❖', 0xa7: '▪', 0xa8: '◻', 0xd8: '➢', 0xe0: '➔', 0xe8: '➔', 0xf0: '⇨', 0xfa: '✗', 0xfb: '✗', 0xfc: '✔', 0xfe: '☑' },
    'wingdings 2': { 0x96: '▪', 0x97: '●', 0x98: '◆', 0x9b: '■', 0xa0: '■', 0xa1: '◻', 0xd2: '✔', 0xd0: '✗' },
    'wingdings 3': { 0x7d: '▸', 0x7c: '◂', 0xad: '➤', 0x75: '▶', 0x71: '▶' },
    symbol: { 0x2d: '–', 0xb7: '•', 0xae: '→', 0xd8: '¬' },
    starsymbol: { 0x6c: '●', 0x2d: '–', 0xb7: '•', 0x6e: '■' },
  };
  function bulletChar(ch, font) {
    if (!ch) return '';
    const f = (font || '').toLowerCase().trim();
    const code = ch.codePointAt(0);
    const map = SYM_BU[f] || (/^wingdings/.test(f) ? SYM_BU.wingdings : null);
    if (map) return map[code & 0xff] || (code >= 0x2000 && code < 0xf000 ? ch : '▪');
    if (code >= 0xf000 && code <= 0xf0ff) return SYM_BU.wingdings[code & 0xff] || '•';
    return ch === '•' ? '' : ch; // normaler Punkt: Standard-Aufzählung
  }
  const EMU = 12700; // EMU je pt
  const r1 = (v) => Math.round(v * 10) / 10;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ------------------------------------------------------------------ XML-Helfer (nach lokalem Namen, Präfixe egal)
  const kids = (el, n) => (el ? [...el.children].filter((x) => x.localName === n) : []);
  const kid = (el, n) => (el ? [...el.children].find((x) => x.localName === n) || null : null);
  const path = (el, ...ns) => ns.reduce((e, n) => kid(e, n), el);
  const all = (el, n) => (el ? [...el.getElementsByTagNameNS('*', n)] : []);
  const at = (el, n) => (el ? el.getAttribute(n) : null);
  const rid = (el, n) => (el ? el.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', n) || el.getAttribute('r:' + n) : null);
  const num = (v, d = 0) => (v == null || v === '' || isNaN(+v) ? d : +v);

  // ------------------------------------------------------------------ Farben
  const PRST = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080', darkGray: 'A9A9A9', lightGray: 'D3D3D3', orange: 'FFA500', navy: '000080' };
  const lum = (c) => { const h = String(c || '#000000').replace('#', ''); const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255 || 0); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  }
  function hsl2rgb(h, s, l) {
    if (!s) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }

  // LibreOffice legt eine umgewandelte Grafik auf eine ganze Seite: auf den Inhalt zuschneiden
  async function svgCrop(text) {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:-99999px;top:0;width:10px;height:10px;overflow:hidden';
    box.innerHTML = String(text).replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '');
    document.body.appendChild(box);
    try {
      const svg = box.querySelector('svg');
      if (!svg) return null;
      // LibreOffice legt die Grafik auf eine A4-Seite und vermerkt ihren Rahmen (BoundingBox) – genau diesen Ausschnitt nehmen,
      // sonst gingen weiße Ränder der Grafik verloren und sie wäre verschoben
      const gr = svg.querySelectorAll('g.Graphic');
      const bbr = gr.length === 1 && gr[0].querySelector('rect.BoundingBox');
      const bb = bbr ? { x: +bbr.getAttribute('x'), y: +bbr.getAttribute('y'), width: +bbr.getAttribute('width'), height: +bbr.getAttribute('height') } : svg.getBBox();
      if (!bb.width || !bb.height) return null;
      const vb = svg.viewBox && svg.viewBox.baseVal;
      const wAttr = svg.getAttribute('width') || '';
      const per = vb && vb.width && /mm$/.test(wAttr) ? parseFloat(wAttr) / vb.width : 25.4 / 96;
      svg.setAttribute('viewBox', `${bb.x} ${bb.y} ${bb.width} ${bb.height}`);
      svg.setAttribute('width', (bb.width * per).toFixed(2) + 'mm');
      svg.setAttribute('height', (bb.height * per).toFixed(2) + 'mm');
      return new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
    } catch (e) { return null; } finally { box.remove(); }
  }

  // ------------------------------------------------------------------ PowerPoint-Formen (ECMA-376 Formdefinitionen) → SVG-Pfad in 0…1000
  let PRESETS = null;
  const presetsLoad = async () => { if (!PRESETS) PRESETS = await fetch('vendor/pptx-presets.json?v=' + C.VERSION).then((r) => (r.ok ? r.json() : {})).catch(() => ({})); return PRESETS; };
  const DEG = Math.PI / 180 / 60000;
  function geomPath(def, w, h, adj) {
    w = w || 1; h = h || 1;
    const V = {};
    const BI = { l: 0, t: 0, r: w, b: h, w, h, hc: w / 2, vc: h / 2, ss: Math.min(w, h), ls: Math.max(w, h), cd2: 10800000, cd4: 5400000, cd8: 2700000, '3cd4': 16200000, '3cd8': 8100000, '5cd8': 13500000, '7cd8': 18900000 };
    const get = (n) => {
      if (n in V) return V[n];
      if (n in BI) return BI[n];
      if (/^-?\d+(\.\d+)?$/.test(n)) return +n;
      const m = /^(w|h|ss)d(\d+)$/.exec(n);
      if (m) return BI[m[1]] / +m[2];
      throw new Error('Formgröße ' + n);
    };
    const ev = (f) => {
      const [op, ...a] = String(f).trim().split(/\s+/);
      const x = a.map(get);
      switch (op) {
        case 'val': return x[0];
        case '*/': return x[2] ? (x[0] * x[1]) / x[2] : 0;
        case '+-': return x[0] + x[1] - x[2];
        case '+/': return x[2] ? (x[0] + x[1]) / x[2] : 0;
        case '?:': return x[0] > 0 ? x[1] : x[2];
        case 'abs': return Math.abs(x[0]);
        case 'at2': return Math.atan2(x[1], x[0]) / DEG;
        case 'cat2': return x[0] * Math.cos(Math.atan2(x[2], x[1]));
        case 'sat2': return x[0] * Math.sin(Math.atan2(x[2], x[1]));
        case 'cos': return x[0] * Math.cos(x[1] * DEG);
        case 'sin': return x[0] * Math.sin(x[1] * DEG);
        case 'tan': return x[0] * Math.tan(x[1] * DEG);
        case 'max': return Math.max(x[0], x[1]);
        case 'min': return Math.min(x[0], x[1]);
        case 'mod': return Math.sqrt(x[0] * x[0] + x[1] * x[1] + (x[2] || 0) * (x[2] || 0));
        case 'pin': return x[1] < x[0] ? x[0] : x[1] > x[2] ? x[2] : x[1];
        case 'sqrt': return Math.sqrt(Math.max(0, x[0]));
        default: throw new Error('Formel ' + op);
      }
    };
    try {
      for (const [n, f] of def.av || []) V[n] = ev(adj && adj[n] != null ? adj[n] : f);
      for (const [n, f] of def.gd || []) V[n] = ev(f);
      let d = '', ds = '', hasFill = false, hasStroke = false;
      for (const p of def.p || []) {
        const pw = +p.w || w, ph = +p.h || h;
        const X = (v) => Math.round(((get(v) * 1000) / pw) * 10) / 10, Y = (v) => Math.round(((get(v) * 1000) / ph) * 10) / 10;
        const R = (v) => Math.round(v * 10) / 10;
        let cx = 0, cy = 0, s0 = '';
        for (const c of p.c) {
          const t = c[0];
          if (t === 'm' || t === 'l') { cx = get(c[1]); cy = get(c[2]); s0 += `${t === 'm' ? 'M' : 'L'}${X(c[1])} ${Y(c[2])}`; }
          else if (t === 'c') { s0 += `C${X(c[1])} ${Y(c[2])} ${X(c[3])} ${Y(c[4])} ${X(c[5])} ${Y(c[6])}`; cx = get(c[5]); cy = get(c[6]); }
          else if (t === 'q') { s0 += `Q${X(c[1])} ${Y(c[2])} ${X(c[3])} ${Y(c[4])}`; cx = get(c[3]); cy = get(c[4]); }
          else if (t === 'a') {
            const wR = get(c[1]), hR = get(c[2]), st = get(c[3]) * DEG, sw = get(c[4]) * DEG;
            // Winkel sind „sichtbare“ Winkel auf der Ellipse → Parameterwinkel
            const par = (a) => Math.atan2(wR * Math.sin(a), hR * Math.cos(a));
            const t1 = par(st);
            let dt;
            if (Math.abs(sw) >= 2 * Math.PI - 1e-6) dt = Math.sign(sw) * 2 * Math.PI;
            else { dt = par(st + sw) - t1; if (sw > 0 && dt <= 0) dt += 2 * Math.PI; if (sw < 0 && dt >= 0) dt -= 2 * Math.PI; }
            const ox = cx - wR * Math.cos(t1), oy = cy - hR * Math.sin(t1);
            const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2))), da = dt / n, k = (4 / 3) * Math.tan(da / 4);
            let a = t1;
            for (let i = 0; i < n; i++) {
              const a2 = a + da;
              const x1 = ox + wR * (Math.cos(a) - k * Math.sin(a)), y1 = oy + hR * (Math.sin(a) + k * Math.cos(a));
              const x2 = ox + wR * (Math.cos(a2) + k * Math.sin(a2)), y2 = oy + hR * (Math.sin(a2) - k * Math.cos(a2));
              cx = ox + wR * Math.cos(a2); cy = oy + hR * Math.sin(a2);
              s0 += `C${R((x1 * 1000) / pw)} ${R((y1 * 1000) / ph)} ${R((x2 * 1000) / pw)} ${R((y2 * 1000) / ph)} ${R((cx * 1000) / pw)} ${R((cy * 1000) / ph)}`;
              a = a2;
            }
          } else if (t === 'z') s0 += 'Z';
        }
        if (!s0) continue;
        if (p.stroke !== 'false' && p.stroke !== '0') hasStroke = true;
        if (p.fill === 'none') ds += s0; else { d += s0; hasFill = true; }
      }
      if ((!d && !ds) || /NaN|Infinity/.test(d + ds) || d.length + ds.length > 60000) return null;
      return { d, ds, fill: hasFill, stroke: hasStroke };
    } catch (e) { return null; }
  }

  // alle Textstücke um den Faktor k größer/kleiner (relativ, als em)
  function scaleHtml(html, k) {
    const t = document.createElement('template');
    t.innerHTML = html;
    const walk = (n) => { for (const c of [...n.childNodes]) { if (c.nodeType === 3 && c.nodeValue.trim()) { const sp = document.createElement('span'); sp.style.fontSize = Math.round(k * 1000) / 1000 + 'em'; c.replaceWith(sp); sp.appendChild(c); } else if (c.nodeType === 1 && !(c.tagName === 'SPAN' && c.style.fontSize)) walk(c); else if (c.nodeType === 1) c.style.fontSize = Math.round(parseFloat(c.style.fontSize) * k * 1000) / 1000 + 'em'; } };
    walk(t.content);
    return t.innerHTML;
  }

  // Bildeffekte aus PowerPoint: Graustufen, Schwarzweiß, Helligkeit/Kontrast, Duoton, Farbe durchsichtig
  function applyFx(ctx, w, h, fx) {
    const id = ctx.getImageData(0, 0, w, h), d = id.data;
    const hx = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const A = fx.duo && hx(fx.duo[0]), B = fx.duo && hx(fx.duo[1]), KEY = fx.key && hx(fx.key);
    const br = (fx.bright || 0) * 255, ct = 1 + (fx.contrast || 0);
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2];
      if (KEY && Math.abs(r - KEY[0]) + Math.abs(g - KEY[1]) + Math.abs(b - KEY[2]) < 24) { d[i + 3] = 0; continue; }
      if (fx.bright || fx.contrast) { r = (r - 128) * ct + 128 + br; g = (g - 128) * ct + 128 + br; b = (b - 128) * ct + 128 + br; }
      const y = 0.3 * r + 0.59 * g + 0.11 * b;
      if (fx.gray) r = g = b = y;
      if (fx.bi != null) r = g = b = y >= fx.bi * 255 ? 255 : 0;
      if (A) { const t = y / 255; r = A[0] + (B[0] - A[0]) * t; g = A[1] + (B[1] - A[1]) * t; b = A[2] + (B[2] - A[2]) * t; }
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
    ctx.putImageData(id, 0, 0);
  }

  // ================================================================== Einlesen
  const NUM_T = /^(arabic|alphaLc|alphaUc|romanLc|romanUc)(Period|ParenR|ParenBoth|Plain)$/;
  async function importPptx(file, progress, opt = {}) {
    const u8 = new Uint8Array(await file.arrayBuffer());
    let z;
    try { z = window.fflate.unzipSync(u8); } catch (e) { throw new Error('Das ist keine gültige PowerPoint-Datei (.pptx). Ältere .ppt-Dateien bitte zuerst in PowerPoint als .pptx speichern.'); }
    const parser = new DOMParser();
    const xcache = {};
    const xml = (p) => {
      if (p in xcache) return xcache[p];
      const b = z[p];
      return (xcache[p] = b ? parser.parseFromString(window.fflate.strFromU8(b), 'application/xml') : null);
    };
    const norm = (p) => { const out = []; for (const s of p.split('/')) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); } return out.join('/'); };
    const relsCache = {};
    const relsOf = (p) => {
      if (relsCache[p]) return relsCache[p];
      const dir = p.replace(/[^/]+$/, '');
      const d = xml(dir + '_rels/' + p.slice(dir.length) + '.rels');
      const m = {};
      if (d) for (const r of all(d, 'Relationship')) {
        const ext = at(r, 'TargetMode') === 'External', t = at(r, 'Target') || '';
        m[at(r, 'Id')] = { type: (at(r, 'Type') || '').split('/').pop(), target: ext ? t : norm(t.startsWith('/') ? t.slice(1) : dir + t), ext };
      }
      return (relsCache[p] = m);
    };
    const relOfType = (p, type) => Object.values(relsOf(p)).find((r) => r.type === type);

    // Tabellenformatvorlagen der Datei (PowerPoint speichert die benutzten in ppt/tableStyles.xml)
    const tsDoc = xml('ppt/tableStyles.xml');
    const tstyles = {};
    if (tsDoc) for (const st of all(tsDoc, 'tblStyle')) tstyles[at(st, 'styleId')] = st;
    const tstyleDef = tsDoc ? at(tsDoc.documentElement, 'def') : '';
    const mixW = (hex, t) => '#' + [1, 3, 5].map((i) => hex2(parseInt(hex.slice(i, i + 2), 16) * t + 255 * (1 - t))).join('').toUpperCase();
    function tableStyleParts(id, T) {
      const st = tstyles[id];
      if (!st) {
        if (!id) return null;
        // eingebaute Vorlagen „Keine Formatvorlage“: ohne Füllung; „Tabellenraster“ mit dünnen Linien in Textfarbe
        const nid = String(id).toUpperCase();
        if (nid === '{2D5ABB26-0587-4C30-8999-92F81FD0307C}') return { wholeTbl: {}, none: 1 };
        if (nid === '{5940675A-B579-460E-94D1-54222C63F5DA}') return { wholeTbl: {}, none: 1, _line: '#' + (T.scheme.dk1 || '000000') };
        // eingebaute Standardvorlage „Mittleres Format 2 – Akzent 1“
        const a = '#' + (T.scheme.accent1 || '4472C4'), lt = '#' + (T.scheme.lt1 || 'FFFFFF'), dk = '#' + (T.scheme.dk1 || '000000');
        return { wholeTbl: { f: mixW(a, 0.2), c: dk }, band1H: { f: mixW(a, 0.4) }, band1V: { f: mixW(a, 0.4) }, firstRow: { f: a, c: lt, b: 1 }, lastRow: { f: a, c: lt, b: 1 }, firstCol: { f: a, c: lt, b: 1 }, lastCol: { f: a, c: lt, b: 1 }, _line: lt };
      }
      const out = {};
      // Hintergrund der ganzen Tabelle (tblBg): scheint durch Zellen ohne eigene Füllung
      const tb = kid(st, 'tblBg');
      const bgc = tb ? color(kid(tb, 'solidFill') || kid(tb, 'fillRef'), T) : null;
      const base = bgc ? bgc.c : '#FFFFFF';
      // halb durchsichtige Füllung (alpha) mit dem Hintergrund mischen
      const blend = (c) => (c.a < 0.99 ? '#' + [1, 3, 5].map((i) => hex2(parseInt(c.c.slice(i, i + 2), 16) * c.a + parseInt(base.slice(i, i + 2), 16) * (1 - c.a))).join('').toUpperCase() : c.c);
      for (const pn of ['wholeTbl', 'band1H', 'band2H', 'band1V', 'band2V', 'firstRow', 'lastRow', 'firstCol', 'lastCol']) {
        const pe = kid(st, pn);
        if (!pe) { if (pn === 'wholeTbl' && bgc) out.wholeTbl = { f: bgc.c }; continue; }
        const o = {};
        const tcs = kid(pe, 'tcStyle'), fe = tcs && kid(tcs, 'fill');
        if (fe) { if (kid(fe, 'noFill')) o.f = bgc ? bgc.c : 'none'; else { const c = color(kid(fe, 'solidFill'), T); if (c) o.f = blend(c); } }
        if (tcs && kid(tcs, 'fillRef')) { const c = color(kid(tcs, 'fillRef'), T); if (c) o.f = blend(c); }
        if (pn === 'wholeTbl' && !o.f && bgc) o.f = bgc.c;
        const tx = kid(pe, 'tcTxStyle');
        if (tx) { if (at(tx, 'b') === 'on') o.b = 1; const c = color(tx, T) || color(kid(tx, 'fontRef'), T); if (c) o.c = c.c; }
        if (pn === 'wholeTbl' && tcs) { const ln = all(kid(tcs, 'tcBdr'), 'ln')[0]; const c = ln && color(kid(ln, 'solidFill'), T); if (c) out._line = c.c; }
        out[pn] = o;
      }
      return out;
    }
    const pres = xml('ppt/presentation.xml');
    if (!pres) throw new Error('Das ist keine PowerPoint-Präsentation (.pptx).');
    await X().fontsReady();
    await presetsLoad();
    const sz = all(pres, 'sldSz')[0];
    const cx = num(at(sz, 'cx'), 12192000) / EMU, cy = num(at(sz, 'cy'), 6858000) / EMU; // in pt
    const W = X().W;
    const size = Math.abs(cy / cx - 0.75) < Math.abs(cy / cx - 0.5625) ? '43' : '169';
    const H = size === '43' ? 720 : 540;
    const K = Math.min(W / cx, H / cy), OX = (W - cx * K) / 2, OY = (H - cy * K) / 2;
    const px = (emu) => (num(emu) / EMU) * K; // Längen
    const warn = { emf: 0, other: 0 };

    // ---- Design (Farben, Schriften) des ersten Masters
    const slideIds = all(path(pres.documentElement, 'sldIdLst'), 'sldId').map((s) => relsOf('ppt/presentation.xml')[rid(s, 'id')]).filter(Boolean).map((r) => r.target);
    const themeCache = {};
    function themeOf(masterPath) {
      if (themeCache[masterPath]) return themeCache[masterPath];
      const m = xml(masterPath);
      const tr = relOfType(masterPath, 'theme');
      const td = tr && xml(tr.target);
      const scheme = {};
      const cs = td && all(td, 'clrScheme')[0];
      if (cs) for (const c of cs.children) { const v = c.children[0]; if (v) scheme[c.localName] = (at(v, 'val') && v.localName === 'srgbClr' ? at(v, 'val') : at(v, 'lastClr') || at(v, 'val') || '000000').toUpperCase(); }
      const fs = td && all(td, 'fontScheme')[0];
      const fontOf = (n) => at(path(fs, n, 'latin'), 'typeface') || '';
      const map = {};
      const cm = m && all(m, 'clrMap')[0];
      if (cm) for (const a of cm.attributes) map[a.name] = a.value;
      const fmt = td && all(td, 'fmtScheme')[0];
      const t = { scheme, map, major: fs ? fontOf('majorFont') : '', minor: fs ? fontOf('minorFont') : '', fmt, master: m, masterPath, themePath: tr ? tr.target : '' };
      return (themeCache[masterPath] = t);
    }
    // Farbe aus einem Element, das einen Farbknoten enthält (solidFill, fillRef …)
    function color(holder, T, ph) {
      if (!holder) return null;
      const n = [...holder.children].find((x) => /^(srgbClr|schemeClr|sysClr|prstClr|scrgbClr|hslClr)$/.test(x.localName));
      if (!n) return null;
      let hex = '000000';
      if (n.localName === 'srgbClr') hex = at(n, 'val') || hex;
      else if (n.localName === 'sysClr') hex = at(n, 'lastClr') || (at(n, 'val') === 'window' ? 'FFFFFF' : '000000');
      else if (n.localName === 'prstClr') hex = PRST[at(n, 'val')] || '000000';
      else if (n.localName === 'scrgbClr') hex = [at(n, 'r'), at(n, 'g'), at(n, 'b')].map((v) => hex2(Math.pow(num(v) / 100000, 1 / 2.2) * 255)).join('');
      else if (n.localName === 'hslClr') hex = hsl2rgb(num(at(n, 'hue')) / 21600000, num(at(n, 'sat')) / 100000, num(at(n, 'lum')) / 100000).map(hex2).join('');
      else {
        let v = at(n, 'val');
        if (v === 'phClr') hex = (ph || '#000000').slice(1);
        else { v = T.map[v] || v; hex = T.scheme[v] || T.scheme[{ tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' }[v]] || '000000'; }
      }
      let [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);
      let alpha = 1;
      const gam = [...n.children].some((m) => m.localName === 'gamma');
      for (const m of n.children) {
        const v = num(at(m, 'val')) / 100000;
        if (m.localName === 'alpha') alpha = v;
        else if (m.localName === 'lumMod' || m.localName === 'lumOff') {
          const [h, s, l] = rgb2hsl(r, g, b);
          [r, g, b] = hsl2rgb(h, s, Math.max(0, Math.min(1, m.localName === 'lumMod' ? l * v : l + v)));
        } else if (/^(satMod|satOff|hueMod|hueOff)$/.test(m.localName)) {
          let [hh, ss, ll] = rgb2hsl(r, g, b);
          if (m.localName === 'satMod') ss = Math.min(1, ss * v); else if (m.localName === 'satOff') ss = Math.max(0, Math.min(1, ss + v));
          else if (m.localName === 'hueMod') hh = (hh * v) % 1; else hh = (hh + num(at(m, 'val')) / 21600000 + 1) % 1;
          [r, g, b] = hsl2rgb(hh, ss, ll);
        } else if (m.localName === 'gray') { const y = 0.3 * r + 0.59 * g + 0.11 * b; r = g = b = y; }
        else if (m.localName === 'inv') { r = 255 - r; g = 255 - g; b = 255 - b; }
        else if (m.localName === 'tint' || m.localName === 'shade') {
          // Aufhellen/Abdunkeln wie in PowerPoint: im linearen Farbraum (nicht in sRGB)
          const lin = (x) => { x /= 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
          const srgb = (x) => 255 * (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
          const f = m.localName === 'tint' ? (x) => x * v + (1 - v) : (x) => x * v;
          // ältere Dateien klammern mit <gamma/> … <invGamma/>: dann wie bisher direkt in sRGB rechnen
          if (gam) [r, g, b] = [r, g, b].map((x) => 255 * Math.max(0, Math.min(1, f(x / 255))));
          else [r, g, b] = [r, g, b].map((x) => srgb(Math.max(0, Math.min(1, f(lin(x))))));
        }
      }
      return { c: '#' + (hex2(r) + hex2(g) + hex2(b)).toUpperCase(), a: alpha };
    }
    // Füllung: solidFill, Verlauf (erste Farbe), Muster; sonst Stil-Referenz
    function fillOf(spPr, style, T, grpF) {
      if (spPr) {
        if (kid(spPr, 'noFill')) return null;
        const sf = kid(spPr, 'solidFill'); if (sf) return color(sf, T);
        const gf = kid(spPr, 'gradFill');
        if (gf) {
          const st = all(gf, 'gs').map((g) => ({ p: num(at(g, 'pos')) / 100000, c: color(g, T) })).filter((x) => x.c).sort((x, y) => x.p - y.p);
          if (st.length === 1) return st[0].c;
          if (st.length) {
          // mittlere Farbe als Ersatz, dazu der Verlauf selbst
          const mid = st.reduce((best, x) => (Math.abs(x.p - 0.5) < Math.abs(best.p - 0.5) ? x : best), st[0]).c;
          return { c: mid.c, a: mid.a, grad: { s: st.map((x) => [Math.round(x.p * 1000) / 1000, x.c.c, Math.round(x.c.a * 100) / 100]), ang: Math.round(num(at(kid(gf, 'lin'), 'ang')) / 60000), rad: kid(gf, 'path') ? 1 : 0 } };
          } // Verlauf ohne Farben: Stil der Form nehmen
        }
        const pf = kid(spPr, 'pattFill'); if (pf) return color(kid(pf, 'fgClr'), T);
        if (kid(spPr, 'grpFill')) return grpF || null;
      }
      const fr = style && kid(style, 'fillRef');
      if (fr && num(at(fr, 'idx')) > 0) {
        // Formstil des Designs (z. B. Verlauf in der Grundfarbe): Füllung aus der Stilliste mit der Stilfarbe
        const ph0 = color(fr, T);
        const lst = T.fmt && all(T.fmt, 'fillStyleLst')[0];
        const fsx = lst && lst.children[num(at(fr, 'idx')) - 1];
        if (fsx && ph0) {
          if (fsx.localName === 'solidFill') return color(fsx, T, ph0.c) || ph0;
          if (fsx.localName === 'gradFill') {
            const st = all(fsx, 'gs').map((g) => ({ p: num(at(g, 'pos')) / 100000, c: color(g, T, ph0.c) })).filter((x) => x.c).sort((x, y) => x.p - y.p);
            if (st.length > 1) return { c: ph0.c, a: 1, grad: { s: st.map((x) => [Math.round(x.p * 1000) / 1000, x.c.c, Math.round(x.c.a * 100) / 100]), ang: Math.round(num(at(kid(fsx, 'lin'), 'ang')) / 60000), rad: kid(fsx, 'path') ? 1 : 0 } };
          }
        }
        return ph0;
      }
      return null;
    }
    function lineOf(spPr, style, T) {
      const ln = spPr && kid(spPr, 'ln');
      if (ln && kid(ln, 'noFill')) return null;
      let c = ln && (color(kid(ln, 'solidFill'), T) || (kid(ln, 'gradFill') && color(all(kid(ln, 'gradFill'), 'gs')[0], T)));
      const lr = style && kid(style, 'lnRef');
      if (!c && lr && num(at(lr, 'idx')) > 0) c = color(lr, T);
      if (!c) return null;
      let w = ln && at(ln, 'w') ? px(at(ln, 'w')) : 0;
      if (!w && lr) { const lst = T.fmt && all(T.fmt, 'lnStyleLst')[0]; const l = lst && kids(lst, 'ln')[num(at(lr, 'idx')) - 1]; w = l ? px(at(l, 'w') || 9525) : 1; }
      const head = ln && kid(ln, 'headEnd'), tail = ln && kid(ln, 'tailEnd');
      return { c: c.c, a: c.a, w: Math.max(0.5, r1(w || 1)), head: !!(head && at(head, 'type') && at(head, 'type') !== 'none'), tail: !!(tail && at(tail, 'type') && at(tail, 'type') !== 'none') };
    }

    // ---- Bilder hochladen (gleiche Datei nur einmal)
    const upCache = {};
    // Video/Ton aus dem Paket auf den Server legen → Dateiname (sha1.ext) oder null
    async function uploadMedia(mediaPath) {
      const key = 'm:' + mediaPath;
      if (key in upCache) return upCache[key];
      return (upCache[key] = (async () => {
        const b = z[mediaPath];
        if (!b) return null;
        try {
          const fd = new FormData();
          fd.append('file', new Blob([b]), mediaPath.split('/').pop());
          const r = await fetch(C.API + '?a=mediaput', { method: 'POST', credentials: 'same-origin', headers: { 'X-PDFStift': '1' }, body: fd });
          if (!r.ok) return null;
          return (await r.json()).vid || null;
        } catch (e) { return null; }
      })());
    }
    // Bildfüllung einer Form als PNG: auf die Form zugeschnitten, gekachelt, mit Deckkraft
    async function shapePic(mediaPath, w, h, pathD, tile, alpha) {
      const ext = (mediaPath.split('.').pop() || '').toLowerCase(), cv0 = conv[mediaPath];
      const blob = cv0 && cv0.png ? new Blob([cv0.png], { type: 'image/png' }) : /^(png|jpe?g|gif|webp|bmp)$/.test(ext) && z[mediaPath] ? new Blob([z[mediaPath]], { type: 'image/' + (ext === 'jpg' ? 'jpeg' : ext) }) : null;
      if (!blob) return upload(mediaPath);
      const url = URL.createObjectURL(blob);
      try {
        const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
        const f = Math.min(3, 1800 / Math.max(w, h, 1)), cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(w * f)); cv.height = Math.max(1, Math.round(h * f));
        const g = cv.getContext('2d');
        g.scale(f, f);
        if (pathD) { try { g.clip(new Path2D(pathD)); } catch (e) { /* ohne Zuschnitt */ } }
        g.globalAlpha = Math.max(0, Math.min(1, alpha));
        if (tile) {
          const k = K * 0.75; // Bildpunkt (96 dpi) → pt → Folieneinheit
          const tw = Math.max(1, (im.naturalWidth || 64) * k * (num(at(tile, 'sx'), 100000) / 100000)), th = Math.max(1, (im.naturalHeight || 64) * k * (num(at(tile, 'sy'), 100000) / 100000));
          const tc = document.createElement('canvas'); tc.width = Math.max(1, Math.round(tw * f)); tc.height = Math.max(1, Math.round(th * f));
          tc.getContext('2d').drawImage(im, 0, 0, tc.width, tc.height);
          g.save(); g.scale(1 / f, 1 / f); g.translate((num(at(tile, 'tx')) / EMU) * K * f, (num(at(tile, 'ty')) / EMU) * K * f);
          g.fillStyle = g.createPattern(tc, 'repeat'); g.fillRect(-tc.width, -tc.height, cv.width + 2 * tc.width, cv.height + 2 * tc.height); g.restore();
        } else g.drawImage(im, 0, 0, w, h);
        const out = await new Promise((res) => cv.toBlob(res, 'image/png'));
        return out ? await C.uploadImage(new File([out], 'form.png', { type: 'image/png' })) : null;
      } catch (e) { return upload(mediaPath); } finally { URL.revokeObjectURL(url); }
    }
    async function upload(mediaPath, crop, fx) {
      const key = mediaPath + (crop ? JSON.stringify(crop) : '') + (fx ? JSON.stringify(fx) : '');
      if (key in upCache) return upCache[key];
      return (upCache[key] = (async () => {
        const b = z[mediaPath];
        if (!b) return null;
        const ext = (mediaPath.split('.').pop() || '').toLowerCase();
        let type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' }[ext];
        let blob = null;
        if (/^(emf|wmf|tif|tiff)$/.test(ext)) {
          const cv = conv[mediaPath];
          if (cv && cv.png) { type = 'image/png'; blob = new Blob([cv.png], { type }); }
          else if (cv && cv.svg) { blob = await svgCrop(cv.svg); type = 'image/svg+xml'; }
          if (!blob) { warn.emf++; return null; }
        }
        if (!type) { warn.other++; return null; }
        blob = blob || new Blob([b], { type });
        // SVG ohne Breite/Höhe (nur viewBox): Größe ergänzen, sonst zeichnet der Browser es nicht richtig
        if (type === 'image/svg+xml') {
          let txt = await blob.text();
          const root = (txt.match(/<svg\b[^>]*>/i) || [''])[0];
          const vb = root.match(/viewBox\s*=\s*["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
          if (root && vb && !/\swidth\s*=/.test(root)) {
            const f = 1000 / Math.max(+vb[3], +vb[4]);
            txt = txt.replace(root, root.replace(/<svg\b/i, `<svg width="${Math.round(+vb[3] * f)}" height="${Math.round(+vb[4] * f)}"`));
            blob = new Blob([txt], { type });
          }
        }
        const needCanvas = crop || fx || type === 'image/svg+xml' || type === 'image/bmp' || blob.size > 1.8e6; // große Bilder verkleinern (Grenze für das Hochladen)
        if (needCanvas) {
          const url = URL.createObjectURL(blob);
          try {
            const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Bild')); i.src = url; });
            let iw = im.naturalWidth || 800, ih = im.naturalHeight || 600;
            const c0 = crop || { l: 0, t: 0, r: 0, b: 0 };
            const sx = iw * c0.l, sy = ih * c0.t, sw = Math.max(1, iw * (1 - c0.l - c0.r)), sh = Math.max(1, ih * (1 - c0.t - c0.b));
            const f = Math.min(type === 'image/svg+xml' ? 4 : 1, 2400 / Math.max(sw, sh));
            const cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round(sw * f)); cv.height = Math.max(1, Math.round(sh * f));
            const ctx = cv.getContext('2d');
            const jpg = type === 'image/jpeg';
            if (jpg) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); }
            ctx.drawImage(im, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
            if (fx) applyFx(ctx, cv.width, cv.height, fx);
            blob = await new Promise((res) => cv.toBlob(res, jpg && !(fx && fx.key) ? 'image/jpeg' : 'image/png', 0.88));
            // große Ergebnisse (z. B. Fotos aus umgewandelten Grafiken) als JPEG – sonst scheitert das Hochladen
            if (!jpg && blob && blob.size > 1.5e6) { const c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = cv.height; const x2 = c2.getContext('2d'); x2.fillStyle = '#fff'; x2.fillRect(0, 0, c2.width, c2.height); x2.drawImage(cv, 0, 0); blob = await new Promise((res) => c2.toBlob(res, 'image/jpeg', 0.88)); }
          } catch (e) { warn.other++; return null; } finally { URL.revokeObjectURL(url); }
        }
        try {
          const r = await C.uploadImage(new File([blob], 'pptx.' + (blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1] || 'png'), { type: blob.type }));
          return r;
        } catch (e) { warn.other++; return null; }
      })());
    }

    // ---- Windows-Grafiken (EMF, WMF, TIFF) vorab umwandeln: auf dem Server mit LibreOffice, sonst in der Windows-App
    const conv = {};
    const vec = Object.keys(z).filter((k) => /^ppt\/media\/[^/]+\.(emf|wmf|tiff?)$/i.test(k)).slice(0, 80);
    if (vec.length) {
      progress && progress(`${vec.length} Grafik(en) werden umgewandelt …`);
      try {
        const fd = new FormData();
        vec.forEach((k) => fd.append('files[]', new Blob([z[k]]), k.split('/').pop()));
        const r = await fetch(C.API + '?a=imgconv', { method: 'POST', credentials: 'same-origin', headers: { 'X-PDFStift': '1' }, body: fd });
        if (r.ok) { const j = await r.json(); vec.forEach((k, i) => { const t = j.svgs && j.svgs[i]; if (t) conv[k] = { svg: t }; }); }
      } catch (e) { /* kein LibreOffice */ }
      const WN = window.pdfstiftWin;
      if (WN && WN.imgConv) for (const k of vec) if (!conv[k]) { try { const png = await WN.imgConv(z[k], k.split('.').pop()); if (png && png.length) conv[k] = { png }; } catch (e) { /* */ } }
    }
    function blipFx(blip, T) {
      if (!blip) return null;
      const fx = {};
      if (kid(blip, 'grayscl')) fx.gray = 1;
      const bl = kid(blip, 'biLevel'); if (bl) fx.bi = num(at(bl, 'thresh'), 50000) / 100000;
      const lu = kid(blip, 'lum'); if (lu) { fx.bright = num(at(lu, 'bright')) / 100000; fx.contrast = num(at(lu, 'contrast')) / 100000; }
      const du = kid(blip, 'duotone'); if (du) { const cs = [...du.children].map((c) => color({ children: [c] }, T)).filter(Boolean); if (cs.length === 2) fx.duo = [cs[0].c, cs[1].c]; }
      const cc = kid(blip, 'clrChange'); if (cc) { const to = color(kid(cc, 'clrTo'), T), fr = color(kid(cc, 'clrFrom'), T); if (fr && to && to.a < 0.05) fx.key = fr.c; }
      return Object.keys(fx).length ? fx : null;
    }
    // ---- Platzhalter: Lage und Textstile aus Layout und Master
    const phOf = (sp) => path(sp, sp.localName === 'pic' ? 'nvPicPr' : sp.localName === 'graphicFrame' ? 'nvGraphicFramePr' : 'nvSpPr', 'nvPr', 'ph');
    const phType = (ph) => at(ph, 'type') || (ph ? 'body' : '');
    const masterType = (t) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' || t === 'obj' || t === '' ? 'body' : t);
    function findPh(doc, ph) {
      if (!doc || !ph) return null;
      const list = all(doc, 'sp').concat(all(doc, 'pic')).filter((x) => phOf(x));
      const idx = at(ph, 'idx'), t = phType(ph);
      const master = doc.documentElement && doc.documentElement.localName === 'sldMaster'; // im Master zählt nur die Art (idx gehört dort oft zu Datum/Fußzeile)
      if (!master && idx === '4294967295') return null; // „verwaister“ Platzhalter (aus einer anderen Folie kopiert): erbt nur vom Master
      return (idx != null && !master && list.find((x) => at(phOf(x), 'idx') === idx)) || list.find((x) => phType(phOf(x)) === t) || list.find((x) => masterType(phType(phOf(x))) === masterType(t)) || null;
    }

    // Lage eines Objekts (EMU) und Abbildung in Folienkoordinaten (Gruppen verschachtelt)
    const xfrmOf = (sp) => {
      const sp2 = kid(sp, 'spPr') || kid(sp, 'grpSpPr');
      return (sp2 && kid(sp2, 'xfrm')) || kid(sp, 'xfrm');
    };
    const box = (xf) => {
      const off = kid(xf, 'off'), ext = kid(xf, 'ext');
      return { x: num(at(off, 'x')), y: num(at(off, 'y')), w: num(at(ext, 'cx')), h: num(at(ext, 'cy')), r: num(at(xf, 'rot')) / 60000, fx: at(xf, 'flipH') === '1', fy: at(xf, 'flipV') === '1' };
    };
    const ID = { f: (x, y) => [x, y], s: 1 };

    // ---- Textstile: Kette von Listenstilen (lvlNpPr) vom Objekt bis zum Master
    function styleChain(sp, ctx) {
      const out = [];
      const own = path(sp, 'txBody', 'lstStyle');
      if (own) out.push(own);
      out.own = out.length;
      const ph = phOf(sp);
      if (ph) {
        const lp = findPh(ctx.layout, ph), mp = findPh(ctx.T.master, ph);
        if (lp) { const l = path(lp, 'txBody', 'lstStyle'); if (l) out.push(l); }
        if (mp) { const l = path(mp, 'txBody', 'lstStyle'); if (l) out.push(l); }
        const tx = ctx.T.master && all(ctx.T.master, 'txStyles')[0];
        const t = masterType(phType(ph));
        const st = tx && kid(tx, t === 'title' ? 'titleStyle' : t === 'body' ? 'bodyStyle' : 'otherStyle');
        if (st) out.push(st);
      } else {
        const tx = ctx.T.master && all(ctx.T.master, 'txStyles')[0];
        const def = all(pres, 'defaultTextStyle')[0];
        if (def) out.push(def);
        if (tx && kid(tx, 'otherStyle')) out.push(kid(tx, 'otherStyle'));
      }
      out.own = out.own || 0;
      return out;
    }
    function bodyPrChain(sp, ctx) {
      const out = [path(sp, 'txBody', 'bodyPr')];
      const ph = phOf(sp);
      if (ph) { const lp = findPh(ctx.layout, ph), mp = findPh(ctx.T.master, ph); out.push(path(lp, 'txBody', 'bodyPr'), path(mp, 'txBody', 'bodyPr')); }
      return out.filter(Boolean);
    }
    const firstAttr = (list, n) => { for (const e of list) { const v = at(e, n); if (v != null) return v; } return null; };

    // Absätze → HTML (Listen, Ausrichtung, Fett/Kursiv …, Farben, Links) und Grundgröße/-farbe
    function textOf(txBody, chain, ctx, base) {
      if (!txBody) return null;
      const T = ctx.T;
      const scale = (() => { const na = path(txBody, 'bodyPr', 'normAutofit'); return na && at(na, 'fontScale') ? num(at(na, 'fontScale')) / 100000 : 1; })();
      // „Text bei Überlauf verkleinern“: PowerPoint verringert auch Zeilen- und Absatzabstände
      const lnRed = (() => { const na = path(txBody, 'bodyPr', 'normAutofit'); return na && at(na, 'lnSpcReduction') ? num(at(na, 'lnSpcReduction')) / 100000 : 0; })();
      const paras = [];
      const stats = { sz: new Map(), c: new Map(), ff: new Map() };
      const bump = (m, k, n) => m.set(k, (m.get(k) || 0) + n);
      for (const p of kids(txBody, 'p')) {
        const pPr = kid(p, 'pPr');
        const lvl = num(at(pPr, 'lvl'));
        const lv = chain.map((s) => kid(s, `lvl${lvl + 1}pPr`)).filter(Boolean);
        const pl = [pPr, ...lv].filter(Boolean);
        let algn = firstAttr(pl, 'algn') || 'l';
        let list = null, bu = '', buC = '', numT = '', numS = 0;
        for (const e of pl) {
          if (kid(e, 'buNone')) { list = null; break; }
          const an = kid(e, 'buAutoNum');
          if (an) { list = 'ol'; numT = at(an, 'type') || ''; numS = num(at(an, 'startAt')) || 0; break; }
          if (kid(e, 'buChar') || kid(e, 'buBlip')) {
            list = 'ul';
            const bc = kid(e, 'buChar');
            if (bc) {
              let fnt = ''; for (const e2 of pl) { const f = kid(e2, 'buFont'); if (f) { fnt = at(f, 'typeface') || ''; break; } }
              bu = bulletChar(at(bc, 'char') || '', fnt);
            }
            break;
          }
        }
        let buS = 0; if (list === 'ul') for (const e of pl) { const bs = kid(e, 'buSzPct'); if (bs) { buS = num(at(bs, 'val')) / 100000; break; } if (kid(e, 'buSzTx')) break; }
        if (list === 'ul') { for (const e of pl) { const bcl = kid(e, 'buClr'); if (bcl) { const cc = color(bcl, T); if (cc) buC = cc.c; break; } if (kid(e, 'buClrTx')) break; } }
        // Abstand vor/nach dem Absatz: in Punkt (spcPts) oder in Prozent der Zeile (spcPct); Autofit verkleinert nur Schrift und Zeilenabstand, nicht diese Abstände
        const spc = (n) => { for (const e of pl) { const sp = kid(e, n); if (!sp) continue; const pts = kid(sp, 'spcPts'), pct = kid(sp, 'spcPct'); if (pts) return { pt: num(at(pts, 'val')) / 100 }; if (pct) return { pct: num(at(pct, 'val')) / 100000 }; } return null; };
        const sB = spc('spcBef'), sA = spc('spcAft');
        const defR = pl.map((e) => kid(e, 'defRPr')).filter(Boolean);
        const ownDef = [pPr, ...chain.slice(0, chain.own || 0).map((st) => kid(st, `lvl${lvl + 1}pPr`))].filter(Boolean).map((e) => kid(e, 'defRPr')).filter(Boolean); // eigene Stile vor dem Formstil (fontRef)
        const runs = [];
        for (const r of p.children) {
          if (r.localName === 'br') { runs.push({ br: 1 }); continue; }
          // Formel mitten im Text (Office-Formel): als Formel im Fließtext übernehmen
          if (r.localName === 'm' && /drawing\/2010\/main/.test(r.namespaceURI || '')) {
            for (const c of r.children) {
              if (c.localName !== 'oMathPara' && c.localName !== 'oMath') continue;
              const tx = X().ommlTex(c);
              if (!tx) continue;
              // Formel als eigener Absatz (oMathPara): groß gesetzt (Brüche in voller Höhe) und – wie in PowerPoint – mittig
              const disp = c.localName === 'oMathPara';
              const szA = all(c, 'rPr').map((x) => at(x, 'sz')).find(Boolean);
              const jc = disp ? at(path(c, 'oMathParaPr', 'jc'), 'val') || 'centerGroup' : '';
              runs.push({ t: '', m: disp ? '\\displaystyle ' + tx.replace(/\\frac(?![a-zA-Z])/g, '\\dfrac') : tx, ...(szA ? { sz: (num(szA) / 100) * scale * K } : {}), disp: disp ? jc : '' });
            }
            continue;
          }
          if (r.localName !== 'r' && r.localName !== 'fld') continue;
          let t = (kid(r, 't') || {}).textContent || '';
          if (!t) continue;
          const rPr = kid(r, 'rPr');
          const rl = [rPr, ...defR].filter(Boolean);
          if (/^(all|small)$/.test(firstAttr(rl, 'cap') || '')) t = t.split('ß').map((x) => x.toLocaleUpperCase('de-DE')).join('ß');
          const szv = firstAttr(rl, 'sz');
          const size = (szv ? num(szv) / 100 : base.sz || 18) * scale * K;
          let col = null;
          const ownL = [rPr, ...ownDef].filter(Boolean);
          const pick = (list) => { for (const e of list) { const f = kid(e, 'solidFill'); if (f) return color(f, T); } return null; };
          col = pick(ownL) || base.fontRef || pick(rl);
          const hl0 = rPr && kid(rPr, 'hlinkClick');
          if (hl0 && !pick([rPr].filter(Boolean)) && T.scheme.hlink) col = { c: '#' + T.scheme.hlink, a: 1 };
          let face = null;
          // in Tabellen gilt die Schrift der Tabellenformatvorlage (Designschrift), nicht die Standardschrift der Präsentation
          for (const e of ctx.tbl ? [rPr, ...ownDef].filter(Boolean) : rl) { const l = kid(e, 'latin'); if (l && at(l, 'typeface')) { face = at(l, 'typeface'); break; } }
          if (face === '+mj-lt') face = T.major; else if (face === '+mn-lt') face = T.minor;
          if (!face) face = base.major ? T.major : T.minor;
          // Zeichen aus Symbolschriften (Wingdings …, im privaten Bereich U+F0xx) in Unicode übersetzen
          if (/[\uf020-\uf0ff]/.test(t)) {
            let sf = face; for (const e of rl) { const sy = kid(e, 'sym'); if (sy && at(sy, 'typeface')) { sf = at(sy, 'typeface'); break; } }
            t = t.replace(/[\uf020-\uf0ff]/g, (ch) => bulletChar(ch, sf) || '•');
          }
          const hl = rPr && kid(rPr, 'hlinkClick');
          const link = hl && ctx.rels[rid(hl, 'id')];
          const hi = rPr && kid(rPr, 'highlight');
          const bl = num(firstAttr(rl, 'baseline'));
          runs.push({
            t, sz: size, c: col ? col.c : null, face,
            b: firstAttr(rl, 'b') === '1', i: firstAttr(rl, 'i') === '1',
            u: (firstAttr(rl, 'u') || 'none') !== 'none', s: (firstAttr(rl, 'strike') || 'noStrike') !== 'noStrike',
            sup: bl > 0, sub: bl < 0, href: link && link.ext && /^(https?:|mailto:)/i.test(link.target) ? link.target : '',
            hi: hi ? (color(hi, T) || {}).c : '',
          });
          const n = t.length;
          bump(stats.sz, Math.round(size), n); if (col) bump(stats.c, col.c, n); bump(stats.ff, face, n);
        }
        // leere Absätze: Höhe nach der Schriftgröße am Absatzende; Zeilenabstand des Absatzes
        const eSz = num(at(kid(p, 'endParaRPr'), 'sz')) || num(firstAttr(defR, 'sz')) || (base.sz || 18) * 100;
        let lnPct = null;
        for (const e of pl) {
          const ls = kid(e, 'lnSpc'); if (!ls) continue;
          const pc = kid(ls, 'spcPct'), pt = kid(ls, 'spcPts');
          if (pc) lnPct = num(at(pc, 'val')) / 100000;
          else if (pt) { const rs = (runs.find((r) => r.sz) || {}).sz || (eSz / 100) * scale * K; lnPct = Math.max(0.6, Math.min(3, (num(at(pt, 'val')) / 100) * K / (rs * 1.2))); } // feste Zeilenhöhe in Punkt
          break;
        }
        if (lnRed) lnPct = Math.max(0.75, (lnPct || 1) * (1 - lnRed)); // nicht enger als ¾ Zeile, sonst überlappen die Zeilen
        // Einzug ohne Aufzählungszeichen: marL (links) und indent (erste Zeile, negativ = hängend), in Punkt
        const mAt = (n) => { for (const e of pl) { const v = at(e, n); if (v != null) return num(v) / 12700; } return 0; };
        const mlPt = mAt('marL'), tiPt = mAt('indent'); // bei Aufzählungen: Text bei marL, Zeichen bei marL + indent
        // Absatz nur aus einer Formel (oMathPara) ohne eigene Ausrichtung: mittig wie in PowerPoint
        const onlyM = runs.length && runs.every((r) => r.m || (!r.br && !(r.t || '').trim()));
        const dm = runs.find((r) => r.disp);
        if (onlyM && dm && !at(pPr, 'algn')) algn = /^(left)$/.test(dm.disp) ? 'l' : /^right$/.test(dm.disp) ? 'r' : 'ctr';
        paras.push({ algn, list, lvl, runs, bu, buC, buS, numT, numS, sB, sA, eSz: (eSz / 100) * scale * K, lnPct, mlPt, tiPt });
      }
      const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0];
      const fs = top(stats.sz) ? top(stats.sz)[0] : Math.round((base.sz || 18) * K);
      const c = top(stats.c) ? top(stats.c)[0] : base.c || '';
      const ff = top(stats.ff) ? top(stats.ff)[0] : base.major ? T.major : T.minor;
      // HTML bauen
      const runHtml = (r) => {
        if (r.m) { const h0 = `<span class="dk-im" data-tex="${esc(c ? r.m.split(`\\color{${c.toUpperCase()}}`).join('') : r.m)}"></span>`; return r.sz && Math.abs(r.sz - fs) / fs > 0.03 ? `<span style="font-size:${Math.round((r.sz / fs) * 1000) / 1000}em;">${h0}</span>` : h0; }
        let h = esc(r.t).replace(/\t/g, ' ').replace(/ {2}/g, ' &nbsp;');
        if (r.sup) h = `<sup>${h}</sup>`; if (r.sub) h = `<sub>${h}</sub>`;
        if (r.u) h = `<u>${h}</u>`; if (r.s) h = `<s>${h}</s>`; if (r.i) h = `<i>${h}</i>`; if (r.b) h = `<b>${h}</b>`;
        const st = (r.c && (r.c !== c || r.href) ? `color:${r.c};` : '') + (r.hi ? `background-color:${r.hi};` : '') + (Math.abs(r.sz - fs) / fs > 0.03 ? `font-size:${Math.round((r.sz / fs) * 1000) / 1000}em;` : '');
        if (st) h = `<span style="${st}">${h}</span>`;
        if (r.href) h = `<a href="${esc(r.href)}">${h}</a>`;
        return h;
      };
      const AL = { ctr: 'center', r: 'right', just: 'justify', dist: 'justify' };
      let html = '';
      const stack = []; // offene Listen [{tag, lvl}]
      const closeTo = (depth) => { while (stack.length > depth) html += `</li></${stack.pop().tag}>`; };
      const anySp = paras.some((p) => p.sB || p.sA);
      // Zeilenabstand: der häufigste unter den Absätzen mit Text
      const lnC = new Map(); for (const p of paras) if (p.runs.some((r) => r.t && r.t.trim())) { const v = p.lnPct || 1; lnC.set(v, (lnC.get(v) || 0) + p.runs.reduce((n, r) => n + (r.t || '').length, 0)); } // nach Textmenge
      const lnPct = [...lnC.entries()].sort((a, b) => b[1] - a[1])[0];
      // leere Absätze werden zu Abstand vor dem nächsten Absatz (sonst wären sie so hoch wie die Schrift des Felds)
      const blank = (p) => !p.runs.length || p.runs.every((r) => !r.br && !r.m && !(r.t || '').trim());
      paras.forEach((p, i) => {
        if (!anySp || !blank(p) || i === paras.length - 1) return;
        const lh = (p.lnPct || (lnPct ? lnPct[0] : 1)) * 1.2;
        const esz = (p.runs.find((r) => r.sz) || {}).sz || p.eSz; // Absatz nur aus Leer-/Tabzeichen: dessen Schriftgröße
        const hpx = esz * lh + (i && p.sB ? (p.sB.pt != null ? p.sB.pt * K : p.sB.pct * esz * 1.2) : 0); // Abstand vor dem ersten Absatz zählt nicht
        p.skip = 1;
        const nx = paras[i + 1]; // mehrere leere Absätze hintereinander summieren sich
        nx.extraPx = (nx.extraPx || 0) + (p.extraPx || 0) + hpx;
      });
      let firstOut = true;
      const lastOut = [...paras].reverse().find((p) => !p.skip && !blank(p)); // Abstand nach dem letzten Absatz zählt nicht (PowerPoint)
      if (lastOut) lastOut.sA = null;
      for (const p of paras) {
        if (p.skip) continue;
        if (firstOut) { if (p === paras[0]) p.sB = null; firstOut = false; } // PowerPoint: kein Abstand vor dem ersten Absatz
        // hängender Einzug mit Tab am Anfang: der Tab springt zum linken Einzug
        if (!p.list && p.tiPt < 0 && p.runs[0] && /^\t/.test(p.runs[0].t || '')) { p.runs[0] = { ...p.runs[0], t: p.runs[0].t.slice(1) }; p.tiPt = 0; }
        // Zeilenumbruch am Absatzende: PowerPoint zeigt eine leere Zeile danach (HTML braucht dafür ein zweites <br>)
        const inner = (p.runs.map((r) => (r.br ? '<br>' : runHtml(r))).join('') + (p.runs.length && p.runs[p.runs.length - 1].br ? '<br>' : '')) || '<br>';
        // Abstände in Schrifthöhen des Felds (Prozentangaben beziehen sich auf die Zeilenhöhe der Absatzschrift)
        const pfs = (p.runs.find((r) => r.sz) || {}).sz || fs;
        const toEm = (v) => (!v ? 0 : v.pt != null ? (v.pt * K) / fs : (v.pct * pfs * 1.2) / fs);
        const sb = Math.round((toEm(p.sB) + (p.extraPx || 0) / fs) * 1000) / 1000, sa = Math.round(toEm(p.sA) * 1000) / 1000;
        // PowerPoint: ohne Angabe kein Abstand zwischen Absätzen
        let spSt = `margin: 0;${sb ? ` padding-top: ${Math.min(6, sb)}em;` : ''}${sa ? ` padding-bottom: ${Math.min(6, sa)}em;` : ''}`;
        { const own = p.lnPct || 1, maj = lnPct ? lnPct[0] : 1; if (Math.abs(own - maj) > 0.05) spSt += `${spSt ? ' ' : ''}line-height: ${Math.round(own * 120) / 100};`; } // eigener Zeilenabstand
        if (!p.list && p.mlPt + Math.min(0, p.tiPt) >= -0.5 && (p.mlPt > 1 || Math.abs(p.tiPt) > 1)) {
          const r3 = (v) => Math.round(Math.max(-20, Math.min(20, v)) * 1000) / 1000;
          const ml = Math.max(0, r3((p.mlPt * K) / fs)), ti = r3((p.tiPt * K) / fs);
          if (ml) spSt += ` padding-left: ${ml}em;`; if (ti && ml + ti >= 0) spSt += ` text-indent: ${ti}em;`;
        }
        const al = AL[p.algn] || spSt ? ` style="${AL[p.algn] ? `text-align: ${AL[p.algn]};` : ''}${spSt}"` : '';
        if (p.list && p.runs.length) {
          const depth = p.lvl + 1;
          // Nummerierung: Art (a), a., i. …) und Startwert wie in PowerPoint; andere Art = neue Liste
          const nk = p.list === 'ol' ? `${p.numT}|${p.numS}` : '';
          if (stack.length > depth) closeTo(depth);
          if (stack.length === depth && (stack[depth - 1].tag !== p.list || stack[depth - 1].nk !== nk)) closeTo(depth - 1);
          if (stack.length === depth) html += '</li>';
          while (stack.length < depth) {
            const last = stack.length === depth - 1;
            const oa = p.list === 'ol' && last ? `${p.numT && p.numT !== 'arabicPeriod' && NUM_T.test(p.numT) ? ` data-n="${p.numT}"` : ''}${p.numS > 1 ? ` start="${Math.min(9999, p.numS)}"` : ''}` : '';
            html += `<${p.list}${oa}>`; stack.push({ tag: p.list, nk: last ? nk : '' }); if (stack.length < depth) html += '<li>';
          }
          let buA = p.list === 'ul' ? `${p.bu ? ` data-bu="${esc(p.bu)}"` : ''}${p.buC && p.buC !== c ? ` data-bc="${p.buC}"` : ''}` : '';
          // Einzug wie in PowerPoint: Text beginnt bei marL, das Zeichen bei marL + indent (indent meist negativ)
          let liSt = spSt;
          if (p.list === 'ul' && Math.abs(p.tiPt) <= 1 && p.mlPt * K / fs <= 20) {
            // ohne hängenden Einzug: Zeichen direkt vor dem Text (bei marL), Folgezeilen beginnen bei marL
            liSt += `${liSt ? ' ' : ''}margin-left: ${Math.round(((p.mlPt * K) / fs - 1.2 * depth) * 1000) / 1000}em;`; buA += ' data-bi="0"';
            if (AL[p.algn]) { liSt = `text-align: ${AL[p.algn]}; ` + liSt; p.alOnLi = 1; } // Zeichen und Text gemeinsam ausrichten
          } else if ((p.list === 'ul' || p.list === 'ol') && p.mlPt > 1) {
            const r3 = (v) => Math.round(v * 1000) / 1000;
            const m = (p.mlPt * K) / fs, bi = Math.max(-m, (p.tiPt * K) / fs);
            if (bi <= -0.4 && m <= 20) {
              liSt += `${liSt ? ' ' : ''}margin-left: ${r3(m - 1.2 * depth)}em;`; buA += ` data-bi="${r3(bi)}"`;
              if (p.list === 'ul' && p.buS && Math.abs(p.buS - 1) > 0.05) buA += ` data-bs="${Math.round(Math.max(0.25, Math.min(4, p.buS)) * 100) / 100}"`; // Größe des Zeichens relativ zum Text
            }
          }
          html += `<li${buA}${liSt ? ` style="${liSt}"` : ''}>${AL[p.algn] && !p.alOnLi ? `<div style="text-align: ${AL[p.algn]};">${inner}</div>` : inner}`;
        } else {
          closeTo(0);
          html += `<div${al}>${inner}</div>`;
        }
      }
      closeTo(0);
      const hasText = paras.some((p) => p.runs.some((r) => r.m || (r.t && r.t.trim())));
      return { html, fs: Math.max(4, fs), c, ff, hasText, lnPct: lnPct ? lnPct[0] : null };
    }

    // freie Form: DrawingML-Pfade → SVG-Pfad in 0…1000 (Bögen werden zu Bézierkurven)
    // freie Form (custGeom) wie eingebaute Form: Vorgaben, Hilfsgrößen und Pfade aus dem XML lesen
    function defFromXml(geom) {
      const gl = (el) => kids(el, 'gd').map((g) => [at(g, 'name'), at(g, 'fmla')]);
      const p = kids(path(geom, 'pathLst'), 'path').map((pe) => {
        const o = { c: [] };
        for (const k of ['w', 'h', 'fill', 'stroke']) if (at(pe, k) != null) o[k] = at(pe, k);
        for (const c of pe.children) {
          const pts = kids(c, 'pt').flatMap((q) => [at(q, 'x'), at(q, 'y')]);
          if (c.localName === 'moveTo') o.c.push(['m', ...pts]); else if (c.localName === 'lnTo') o.c.push(['l', ...pts]);
          else if (c.localName === 'cubicBezTo') o.c.push(['c', ...pts]); else if (c.localName === 'quadBezTo') o.c.push(['q', ...pts]);
          else if (c.localName === 'arcTo') o.c.push(['a', at(c, 'wR'), at(c, 'hR'), at(c, 'stAng'), at(c, 'swAng')]);
          else if (c.localName === 'close') o.c.push(['z']);
        }
        return o;
      });
      return { av: gl(kid(geom, 'avLst')), gd: gl(kid(geom, 'gdLst')), p };
    }
    function custPath(geom, bw, bh) { return geomPath(defFromXml(geom), bw, bh, {}); }

    // ---- ein Objekt umwandeln
    const PRST_K = {
      rect: 'rect', roundRect: 'round', snipRoundRect: 'round', round1Rect: 'round', round2SameRect: 'round', round2DiagRect: 'round', ellipse: 'ellipse', triangle: 'tri', rtTriangle: 'rtri',
      diamond: 'diamond', pentagon: 'pent', hexagon: 'hex', octagon: 'oct', parallelogram: 'para', trapezoid: 'trap', plus: 'plus', mathPlus: 'plus', heart: 'heart', cloud: 'cloud',
      rightArrow: 'arrowR', leftArrow: 'arrowL', upArrow: 'arrowU', downArrow: 'arrowD', leftRightArrow: 'arrowLR', chevron: 'chevron', homePlate: 'home', star5: 'star5', star4: 'star5', star6: 'star8', star7: 'star8', star8: 'star8',
      star10: 'star8', star12: 'star8', star16: 'star8', star24: 'star8', star32: 'star8', wedgeRectCallout: 'callout', wedgeRoundRectCallout: 'calloutR', wedgeEllipseCallout: 'calloutR', cloudCallout: 'calloutR',
      leftBracket: 'brackL', rightBracket: 'brackR', leftBrace: 'braceL', rightBrace: 'braceR', arc: 'arc',
      flowChartProcess: 'rect', flowChartAlternateProcess: 'round', flowChartDecision: 'diamond', flowChartTerminator: 'round', flowChartConnector: 'ellipse', flowChartInputOutput: 'para',
      flowChartPreparation: 'hex', flowChartManualOperation: 'trap', frame: 'rect', snip1Rect: 'rect', snip2SameRect: 'rect', plaque: 'round', can: 'round', cube: 'rect', bevel: 'rect', donut: 'ellipse', pie: 'ellipse', chord: 'ellipse', teardrop: 'ellipse',
    };
    const LINE_PRST = /^(line|straightConnector1)$/;
    async function convert(sp, ctx, M, out, gid) {
      const T = ctx.T;
      const ln = sp.localName;
      if (ln === 'grpSp') {
        const xf = xfrmOf(sp);
        const g = xf ? box(xf) : null;
        const chOff = xf && kid(xf, 'chOff'), chExt = xf && kid(xf, 'chExt');
        let M2 = M;
        if (g && chExt && num(at(chExt, 'cx')) && num(at(chExt, 'cy'))) {
          const sx = g.w / num(at(chExt, 'cx')), sy = g.h / num(at(chExt, 'cy')), ox = num(at(chOff, 'x')), oy = num(at(chOff, 'y'));
          // gedrehte oder gespiegelte Gruppe: Punkte um die Gruppenmitte drehen/spiegeln, Drehung an die Objekte weitergeben
          const gr = g.r || 0, gfx = !!g.fx, gfy = !!g.fy;
          const gcx = g.x + g.w / 2, gcy = g.y + g.h / 2, a = (gr * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
          const tr = gr || gfx || gfy;
          M2 = {
            f: (x, y) => {
              let px = g.x + (x - ox) * sx, py = g.y + (y - oy) * sy;
              if (tr) { if (gfx) px = 2 * gcx - px; if (gfy) py = 2 * gcy - py; const dx = px - gcx, dy = py - gcy; px = gcx + dx * ca - dy * sa; py = gcy + dx * sa + dy * ca; }
              return M.f(px, py);
            },
            s: M.s * Math.sqrt(sx * sy), sx: (M.sx || 1) * sx, sy: (M.sy || 1) * sy,
            rot: ((M.rot || 0) + ((M.flx ? 1 : 0) ^ (M.fly ? 1 : 0) ? -gr : gr) + 360) % 360, flx: !!M.flx !== gfx, fly: !!M.fly !== gfy,
          };
          if (!M2.rot && !M2.flx && !M2.fly) { delete M2.rot; delete M2.flx; delete M2.fly; }
        }
        const id = X().uid();
        const before = out.length;
        const gcid = at(path(sp, 'nvGrpSpPr', 'cNvPr'), 'id');
        const gsp = kid(sp, 'grpSpPr');
        const gfill = gsp && (kid(gsp, 'solidFill') || kid(gsp, 'gradFill') || kid(gsp, 'noFill') || kid(gsp, 'grpFill')) ? fillOf(gsp, null, ctx.T, ctx.grpFill) : ctx.grpFill;
        const ctx2 = { ...ctx, grpFill: gfill, ...(ctx.anim ? { grpIds: [...(ctx.grpIds || []), gcid] } : {}) };
        for (const c of sp.children) await convert(c, ctx2, M2, out, gid || id);
        if (out.length - before < 2 && !gid) for (let i = before; i < out.length; i++) delete out[i].g;
        return;
      }
      // neuere Inhalte (z. B. Formeln) mit Ersatzdarstellung: die Ersatzdarstellung nehmen (meist ein Bild)
      if (ln === 'AlternateContent') {
        // eigene Formel aus PDF-Stift (LaTeX steht im Alternativtext): wieder als änderbare Formel übernehmen,
        // solange sie in PowerPoint nicht verändert wurde (sonst das Ersatzbild)
        const fb = kid(sp, 'Fallback'), ch = kid(sp, 'Choice');
        const fpic = fb && [...fb.children].find((c) => c.localName === 'pic');
        const dsc = (fpic && at(path(fpic, 'nvPicPr', 'cNvPr'), 'descr')) || '';
        if (ch && fpic && dsc.startsWith('LaTeX: ')) {
          try {
            const P = X(), tex = dsc.slice(7);
            const mt = (root) => [...root.getElementsByTagNameNS('*', 't')].filter((n) => /math/.test(n.namespaceURI || '')).map((n) => n.textContent).join('');
            const om = await P.texOmml(tex);
            if (mt(new DOMParser().parseFromString(om, 'application/xml')) === mt(ch)) {
              const n0 = out.length;
              await convert(fpic, ctx, M, out, gid);
              const im = out[n0];
              if (im && out.length === n0 + 1) {
                const r = P.texSvg(tex);
                const clr = [...ch.getElementsByTagNameNS('*', 'srgbClr')][0];
                const e = { id: im.id, t: 'math', tex, svg: r.svg, vb: r.vb, x: im.x, y: im.y, w: im.w, h: im.h, r: im.r || 0 };
                if (im.g) e.g = im.g;
                if (clr && /^[0-9A-F]{6}$/i.test(at(clr, 'val') || '')) e.c = '#' + at(clr, 'val').toUpperCase();
                for (const k of ['_spid', '_grp']) if (im[k] != null) e[k] = im[k];
                out[n0] = e;
              }
              return;
            }
          } catch (er) { /* dann das Ersatzbild */ }
        }
        // Freihand (Zeichnen-Reiter in PowerPoint): die Striche statt des Ersatzbilds
        const cpart = ch && kids(ch, 'contentPart')[0];
        if (cpart && ctx.ink) { try { if (await inkFromPart(cpart, ctx, M)) return; } catch (er) { /* dann das Ersatzbild */ } }
        // Formel aus PowerPoint (Office-Formel im Textfeld): als änderbare Formel übernehmen
        const csp = ch && kids(ch, 'sp')[0];
        if (csp && all(csp, 'oMath').length) {
          try {
            const n0 = out.length;
            if (await mathFromSp(csp, ctx, M, out, gid)) {
              if (ctx.anim) { const cid = at(path(csp, 'nvSpPr', 'cNvPr'), 'id'); for (let i = n0; i < out.length; i++) { out[i]._spid = cid; out[i]._grp = ctx.grpIds || []; } }
              return;
            }
            // Text mit Formeln dazwischen: die Form selbst übernehmen (die Formeln stehen dann im Fließtext)
            await X().mathLib();
            await convert(csp, ctx, M, out, gid);
            if (out.length > n0) return;
          } catch (er) { /* dann das Ersatzbild */ }
        }
        const alt = kid(sp, 'Fallback') || kid(sp, 'Choice');
        if (alt) for (const c of alt.children) await convert(c, ctx, M, out, gid);
        return;
      }
      // Freihand aus PowerPoint (Stift-Zeichnungen): als Freihand der Folie übernehmen
      if (ln === 'contentPart' && ctx.ink) { try { await inkFromPart(sp, ctx, M); } catch (er) { /* */ } return; }
      if (!/^(sp|pic|cxnSp|graphicFrame)$/.test(ln)) return;
      const outBefore = out.length;
      // eigene Freihand-Striche aus PDF-Stift (als freie Linien gespeichert) wieder als Freihand
      if (ln === 'sp' && ctx.ink && /^ink(-hl)?$/.test(at(path(sp, 'nvSpPr', 'cNvPr'), 'name') || '')) {
        const n0 = out.length;
        await convertOne(sp, ctx, M, out, gid);
        const e = out[n0];
        if (e && out.length === n0 + 1 && e.t === 'shape' && (e.d || e.ds)) {
          const v = (String(e.d || e.ds).match(/-?\d*\.?\d+/g) || []).map(Number), p = [];
          for (let i = 0; i + 1 < v.length; i += 2) p.push(r1(e.x + (v[i] * e.w) / 1000), r1(e.y + (v[i + 1] * e.h) / 1000));
          out.splice(n0, 1);
          const st = { c: e.line || '#1A1A1A', w: e.lw || 2, p };
          if (/-hl$/.test(at(path(sp, 'nvSpPr', 'cNvPr'), 'name'))) st.hl = 1;
          ctx.ink.push(st);
        }
        return;
      }
      try { await convertOne(sp, ctx, M, out, gid); } finally {
        if (ctx.anim) { const cid = at(path(sp, ...[{ sp: 'nvSpPr', pic: 'nvPicPr', cxnSp: 'nvCxnSpPr', graphicFrame: 'nvGraphicFramePr' }[ln], 'cNvPr']), 'id'); for (let i = outBefore; i < out.length; i++) { out[i]._spid = cid; out[i]._grp = ctx.grpIds || []; } }
      }
    }
    // PowerPoint-Freihand (InkML): Striche mit Farbe und Breite; Koordinaten in 1/1000 cm, eingepasst in den Rahmen des Objekts
    async function inkFromPart(cp, ctx, M) {
      const r = ctx.rels[rid(cp, 'id')];
      if (!r || r.ext) return false;
      const doc = xml(r.target);
      if (!doc) return false;
      const xf = all(cp, 'xfrm')[0];
      if (!xf) return false;
      const b = box(xf);
      const brushes = {};
      for (const br of all(doc, 'brush')) {
        const id = br.getAttribute('xml:id') || br.getAttribute('id') || '';
        const o = {};
        for (const pp of all(br, 'brushProperty')) {
          const n = pp.getAttribute('name'), v = pp.getAttribute('value') || '', u = pp.getAttribute('units') || '';
          if (n === 'color') o.c = v;
          if (n === 'width') o.w = u === 'cm' ? +v * 360000 : u === 'mm' ? +v * 36000 : (+v || 0.05) * 360000; // EMU
          if (n === 'transparency') o.tr = +v;
          if (n === 'rasterOp' && /mask/i.test(v)) o.hl = 1;
          if (n === 'tip' && /rectangle/i.test(v)) o.hl = o.hl || 0;
        }
        brushes[id] = o;
      }
      // Kanalreihenfolge (X, Y, …) aus dem Spurformat
      const fmt = all(doc, 'traceFormat')[0];
      const chans = fmt ? all(fmt, 'channel').map((c) => c.getAttribute('name')) : ['X', 'Y'];
      const ix = Math.max(0, chans.indexOf('X')), iy = chans.indexOf('Y') >= 0 ? chans.indexOf('Y') : 1;
      const res = (() => { for (const cp2 of all(doc, 'channelProperty')) if (cp2.getAttribute('channel') === 'X' && cp2.getAttribute('name') === 'resolution') { const v = +cp2.getAttribute('value'), u = cp2.getAttribute('units') || ''; if (v > 0) return /1\/cm/.test(u) ? 360000 / v : /1\/in/.test(u) ? 914400 / v : 360000 / v; } return 360; })(); // EMU je Einheit
      const traces = [];
      for (const tr of all(doc, 'trace')) {
        const nC = chans.length || 2, val = Array(nC).fill(0), vel = Array(nC).fill(0), mode = Array(nC).fill('!');
        const pts = [];
        for (const ptS of (tr.textContent || '').split(',')) {
          const toks = [...ptS.matchAll(/([!'"]?)\s*(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g)];
          if (!toks.length) continue;
          toks.slice(0, nC).forEach((m, c) => {
            if (m[1]) mode[c] = m[1];
            const x = +m[2];
            if (mode[c] === '!') { vel[c] = x - val[c]; val[c] = x; }
            else if (mode[c] === "'") { vel[c] = x; val[c] += x; }
            else { vel[c] += x; val[c] += vel[c]; }
          });
          pts.push([val[ix], val[iy]]);
        }
        if (pts.length) traces.push({ pts, br: brushes[(tr.getAttribute('brushRef') || '').replace('#', '')] || Object.values(brushes)[0] || {} });
      }
      if (!traces.length) return false;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const t of traces) for (const [x, y] of t.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      // Mitte der Striche auf die Mitte des Rahmens; Maßstab aus der Auflösung (sonst in den Rahmen eingepasst)
      let sx = res, sy = res;
      if (!(sx > 0) || (x1 - x0) * sx > b.w * 3 || (y1 - y0) * sy > b.h * 3) { sx = b.w / Math.max(1, x1 - x0); sy = b.h / Math.max(1, y1 - y0); }
      const cxE = b.x + b.w / 2, cyE = b.y + b.h / 2, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      for (const t of traces) {
        const p = [];
        let lx = null, ly = null;
        for (const [x, y] of t.pts) {
          const [ex, ey] = M.f(cxE + (x - mx) * sx, cyE + (y - my) * sy);
          const px2 = r1(OX + (ex / EMU) * K), py2 = r1(OY + (ey / EMU) * K);
          if (lx != null && Math.hypot(px2 - lx, py2 - ly) < 0.6) continue;
          p.push(px2, py2); lx = px2; ly = py2;
        }
        const br = t.br;
        const st = { c: /^#[0-9a-f]{6}$/i.test(br.c || '') ? br.c.toUpperCase() : '#1A1A1A', w: r1(Math.max(0.5, ((br.w || 0.053 * 360000) / EMU) * K * (M.s || 1))), p };
        if (br.hl || (br.tr && br.tr > 0.3)) st.hl = 1;
        ctx.ink.push(st);
      }
      return true;
    }
    // Textfeld, das nur aus Formeln besteht → Formel-Objekt (Lage wie in PowerPoint: Ausrichtung und Innenabstand des Felds)
    async function mathFromSp(sp, ctx, M, out, gid) {
      const body = kid(sp, 'txBody');
      if (!body) return false;
      const P = X();
      const texs = [];
      for (const p of kids(body, 'p')) {
        if (kids(p, 'r').some((r) => ((kid(r, 't') || {}).textContent || '').trim())) return false; // Text und Formel gemischt: Ersatzbild
        const parts = [];
        for (const m of all(p, 'm')) {
          if (!/drawing\/2010\/main/.test(m.namespaceURI || '')) continue;
          for (const c of m.children) if (c.localName === 'oMathPara' || c.localName === 'oMath') parts.push(P.ommlTex(c));
        }
        if (parts.length) texs.push(parts.join(' '));
      }
      if (!texs.length) return false;
      // Formel als eigenes Feld: wie in PowerPoint auch verschachtelte Brüche in voller Größe
      const tex = (texs.length > 1 ? `\\begin{gathered}${texs.join('\\\\[0.6em]')}\\end{gathered}` : texs[0]).replace(/\\frac(?![a-zA-Z])/g, '\\dfrac');
      const xf = xfrmOf(sp);
      if (!xf) return false;
      const b = box(xf);
      const [x0, y0] = M.f(b.x, b.y), [x1, y1] = M.f(b.x + b.w, b.y + b.h);
      const gx = OX + (x0 / EMU) * K, gy = OY + (y0 / EMU) * K, gw = ((x1 - x0) / EMU) * K, gh = ((y1 - y0) / EMU) * K;
      // Schriftgröße: aus der Formel, sonst wie der Platzhalter (Layout/Master), sonst 18 pt
      let szN = all(body, 'rPr').map((r) => at(r, 'sz')).find(Boolean) || at(all(body, 'endParaRPr')[0], 'sz');
      if (!szN) { for (const st of styleChain(sp, ctx)) { const dr = path(st, 'lvl1pPr', 'defRPr'); if (dr && at(dr, 'sz')) { szN = at(dr, 'sz'); break; } } }
      const fsc = (() => { const na = path(body, 'bodyPr', 'normAutofit'); return na && at(na, 'fontScale') ? num(at(na, 'fontScale')) / 100000 : 1; })();
      const fs = ((szN ? num(szN) / 100 : 18) * fsc * K * (M.s || 1));
      let c = null;
      for (const r of all(body, 'rPr')) { const f = kid(r, 'solidFill'); if (f) { c = color(f, ctx.T); break; } }
      await P.mathLib();
      const r = P.texSvg(tex);
      if (r.err) return false; // Formel nicht lesbar: Ersatzbild aus PowerPoint
      const w = (r.vb[2] / 1000) * fs, h = (r.vb[3] / 1000) * fs;
      const bp = kid(body, 'bodyPr');
      const ins = (k, d) => (at(bp, k) != null ? (num(at(bp, k)) / EMU) * K : d * K);
      const lI = ins('lIns', 7.2), rI = ins('rIns', 7.2), tI = ins('tIns', 3.6), bI = ins('bIns', 3.6);
      const algn = at(path(kids(body, 'p')[0], 'pPr'), 'algn') || 'l';
      const anc = at(bp, 'anchor') || 't';
      const x = algn === 'ctr' ? gx + (gw - w) / 2 : algn === 'r' ? gx + gw - rI - w : gx + lI;
      const y = anc === 'ctr' ? gy + (gh - h) / 2 : anc === 'b' ? gy + gh - bI - h : gy + tI;
      const e = { id: P.uid(), t: 'math', tex, svg: r.svg, vb: r.vb, x: r1(x), y: r1(y), w: r1(w), h: r1(h), r: r1(b.r || 0), fs: r1(fs) };
      if (c && c.c) { e.c = c.c; e.tex = e.tex.split(`\\color{${c.c.toUpperCase()}}`).join(''); if (e.tex !== tex) { const r2 = P.texSvg(e.tex); e.svg = r2.svg; e.vb = r2.vb; } }
      if (gid) e.g = gid;
      out.push(e);
      return true;
    }
    async function convertOne(sp, ctx, M, out, gid) {
      const T = ctx.T;
      const ln = sp.localName;
      const spPr = kid(sp, 'spPr');
      const style = kid(sp, 'style');
      const ph = phOf(sp);
      // Lage (bei Platzhaltern ohne eigene Lage: aus Layout oder Master)
      let xf = ln === 'graphicFrame' ? kid(sp, 'xfrm') : xfrmOf(sp);
      if ((!xf || !kid(xf, 'ext')) && ph) { const lp = findPh(ctx.layout, ph) || findPh(T.master, ph); xf = lp && xfrmOf(lp); if (!xf) { const mp = findPh(T.master, ph); xf = mp && xfrmOf(mp); } }
      if (!xf) return;
      const b = box(xf);
      let [x0, y0] = M.f(b.x, b.y), [x1, y1] = M.f(b.x + b.w, b.y + b.h);
      if (M.rot || M.flx || M.fly) {
        // in einer gedrehten/gespiegelten Gruppe: Mittelpunkt abbilden, Größe behalten, Drehung und Spiegelung zusammenrechnen
        const [cx, cy] = M.f(b.x + b.w / 2, b.y + b.h / 2), w2 = (b.w * (M.sx || 1)) / 2, h2 = (b.h * (M.sy || 1)) / 2;
        x0 = cx - w2; x1 = cx + w2; y0 = cy - h2; y1 = cy + h2;
        b.r = (((M.flx ? 1 : 0) ^ (M.fly ? 1 : 0) ? -b.r : b.r) + (M.rot || 0) + 720) % 360;
        if (M.flx) b.fx = !b.fx; if (M.fly) b.fy = !b.fy;
      }
      const geo = { x: r1(OX + (x0 / EMU) * K), y: r1(OY + (y0 / EMU) * K), w: r1(Math.max(1, ((x1 - x0) / EMU) * K)), h: r1(Math.max(1, ((y1 - y0) / EMU) * K)), r: r1(b.r) };
      const base = { id: X().uid(), ...geo };
      if (gid) base.g = gid;
      const shadow = spPr && path(spPr, 'effectLst', 'outerShdw');
      if (shadow) base.sh = 1;

      if (ln === 'pic') {
        const blip = path(sp, 'blipFill', 'blip');
        let target = blip && ctx.rels[rid(blip, 'embed')];
        const svgB = blip && all(blip, 'svgBlip')[0];
        if ((!target || /\.(emf|wmf)$/i.test(target.target)) && svgB) target = ctx.rels[rid(svgB, 'embed')] || target;
        if (!target || target.ext) return;
        const sr = path(sp, 'blipFill', 'srcRect');
        const crop = sr && ['l', 't', 'r', 'b'].some((k) => num(at(sr, k))) ? { l: num(at(sr, 'l')) / 100000, t: num(at(sr, 't')) / 100000, r: num(at(sr, 'r')) / 100000, b: num(at(sr, 'b')) / 100000 } : null;
        const res = await upload(target.target, crop, blipFx(blip, T));
        if (!res) return;
        const e = { ...base, t: 'img', src: res.src, iw: res.w, ih: res.h };
        if (b.fx) e.fx = 1; if (b.fy) e.fy = 1;
        // eingebettetes Video oder eingebetteter Ton: Datei mit übernehmen, das Bild dient als Vorschau
        const nvPr = path(sp, 'nvPicPr', 'nvPr');
        const mEl = nvPr && (all(nvPr, 'media')[0] || kid(nvPr, 'videoFile') || kid(nvPr, 'audioFile'));
        const mRel = mEl && (ctx.rels[rid(mEl, 'embed')] || ctx.rels[rid(mEl, 'link')]);
        if (mRel && !mRel.ext) { const vid = await uploadMedia(mRel.target); if (vid) e.vid = vid; else warn.other++; }
        const am = blip && kid(blip, 'alphaModFix');
        if (am && num(at(am, 'amt'), 100000) < 100000) e.op = r1(num(at(am, 'amt')) / 100000);
        const l = lineOf(spPr, null, T);
        if (l) { e.line = l.c; e.lw = l.w; }
        out.push(e);
        return;
      }
      if (ln === 'graphicFrame') {
        const gd = path(sp, 'graphic', 'graphicData');
        const uri = at(gd, 'uri') || '';
        if (/table$/.test(uri)) {
          const tbl = kid(gd, 'tbl');
          const grid = all(path(tbl, 'tblGrid'), 'gridCol').map((g) => num(at(g, 'w')));
          const tot = grid.reduce((a, v) => a + v, 0) || 1;
          const chain = [];
          const def = all(pres, 'defaultTextStyle')[0]; if (def) chain.push(def);
          const tx = T.master && all(T.master, 'txStyles')[0]; if (tx && kid(tx, 'otherStyle')) chain.push(kid(tx, 'otherStyle'));
          let fs = null, lineC = null, headFill = 0;
          const fsCount = new Map(), ffCount = new Map();
          const mg = [];
          const rows = [];
          for (const tr of kids(tbl, 'tr')) {
            const row = [];
            for (const tc of kids(tr, 'tc')) {
              const gs = num(at(tc, 'gridSpan'), 1), rsp = num(at(tc, 'rowSpan'), 1);
              if (gs > 1 || rsp > 1) mg.push([rows.length, row.length, Math.max(1, rsp), Math.max(1, gs)]);
              if (at(tc, 'hMerge') === '1' || at(tc, 'vMerge') === '1') { row.push(''); continue; }
              if (!rows.length && path(tc, 'tcPr', 'solidFill')) headFill++;
              const t = textOf(kid(tc, 'txBody'), chain, { ...ctx, tbl: 1 }, { sz: 18 });
              if (t && t.hasText) { fsCount.set(t.fs, (fsCount.get(t.fs) || 0) + 1); if (t.ff) ffCount.set(t.ff, (ffCount.get(t.ff) || 0) + 1); }
              row.push(t ? t : '');
              if (!lineC) { const lb = path(tc, 'tcPr', 'lnB') || path(tc, 'tcPr', 'lnL'); const c = lb && !kid(lb, 'noFill') && color(kid(lb, 'solidFill'), T); if (c) lineC = c.c; }
            }
            while (row.length < grid.length) row.push('');
            rows.push(row.slice(0, Math.max(1, grid.length)));
          }
          if (!rows.length) return;
          // Schriftgröße der Tabelle: die häufigste; abweichende Zellen behalten ihre Größe (relativ)
          fs = [...fsCount.entries()].sort((a, b2) => b2[1] - a[1])[0];
          fs = fs ? fs[0] : 18;
          for (const row of rows) for (let i = 0; i < row.length; i++) {
            const t = row[i];
            if (!t || typeof t === 'string') { row[i] = t || ''; continue; }
            row[i] = t.hasText && Math.abs(t.fs - fs) / fs > 0.04 ? scaleHtml(t.html, t.fs / fs) : t.html;
          }
          const e = { ...base, t: 'table', rows, cw: grid.map((g) => Math.round((g / tot) * 1000) / 1000), fs: Math.round(fs || 18) };
          // Schrift der Tabelle: die häufigste in den Zellen (sonst gälte die Schrift der Präsentation)
          const ff0 = [...ffCount.entries()].sort((a, b2) => b2[1] - a[1])[0];
          const fk = ff0 && X().fontKey(ff0[0]);
          if (fk && fk !== ctx.deckFont) e.ff = fk;
          // Zeilenhöhen wie in PowerPoint (Mindesthöhen je Zeile) und Zellränder (Standard 0,1″ links/rechts, 0,05″ oben/unten)
          const trH = kids(tbl, 'tr').slice(0, rows.length).map((tr) => num(at(tr, 'h')));
          const sumH = trH.reduce((a, v) => a + v, 0);
          if (sumH > 0 && trH.every((v) => v > 0)) {
            const hPx = r1(px(sumH) * (M.s || 1));
            if (hPx > e.h) e.h = hPx;
            e.rh = trH.map((v) => Math.round(((px(v) * (M.s || 1)) / e.h) * 10000) / 10000);
          }
          const tc0 = all(tbl, 'tcPr')[0];
          const mar = (n, d) => { const v = at(tc0, n); return px(v == null ? d : num(v)) * (M.s || 1); };
          e.cm = [r1((mar('marT', 45720) + mar('marB', 45720)) / 2), r1((mar('marL', 91440) + mar('marR', 91440)) / 2)];
          // Zellformate: Tabellenformatvorlage (Kopfzeile, gebänderte Zeilen …) und eigene Zellfarben
          const tp = kid(tbl, 'tblPr');
          const flag = (n) => at(tp, n) === '1' || at(tp, n) === 'true';
          const sid = (((tp && kid(tp, 'tableStyleId')) || {}).textContent || '').trim();
          const parts = tableStyleParts(sid, T);
          const cs = {};
          const trs = kids(tbl, 'tr'), nR = rows.length, nC = rows[0].length;
          trs.forEach((tr, r) => kids(tr, 'tc').forEach((tc, c) => {
            if (c >= nC) return;
            const f = {};
            const add = (pn) => { const p0 = parts && parts[pn]; if (p0) Object.assign(f, p0); };
            if (parts) {
              add('wholeTbl');
              const hr = flag('firstRow') ? 1 : 0;
              if (flag('bandRow') && !(flag('firstRow') && r === 0) && !(flag('lastRow') && r === nR - 1)) add((r - hr) % 2 === 0 ? 'band1H' : 'band2H');
              if (flag('bandCol') && !(flag('firstCol') && c === 0) && !(flag('lastCol') && c === nC - 1)) add((c - (flag('firstCol') ? 1 : 0)) % 2 === 0 ? 'band1V' : 'band2V');
              if (flag('firstCol') && c === 0) add('firstCol');
              if (flag('lastCol') && c === nC - 1) add('lastCol');
              if (flag('lastRow') && r === nR - 1) add('lastRow');
              if (flag('firstRow') && r === 0) add('firstRow');
            }
            const tcp = kid(tc, 'tcPr');
            const anc = at(tcp, 'anchor') || 't';
            if (anc !== 't') f.v = anc === 'ctr' ? 'm' : anc === 'b' ? 'b' : 't';
            const vt = at(tcp, 'vert'); if (vt === 'vert' || vt === 'eaVert') f.vt = 'd'; else if (vt === 'vert270') f.vt = 'u'; // senkrechter Text
            if (tcp) { if (kid(tcp, 'noFill')) f.f = 'none'; else { const fc = kid(tcp, 'solidFill') && color(kid(tcp, 'solidFill'), T); if (fc) f.f = fc.c; } }
            const o = {};
            if (f.f && f.f !== 'none') o.f = f.f;
            if (f.c) o.c = f.c;
            if (f.b) o.b = 1;
            if (f.v) o.v = f.v;
            if (f.vt) o.vt = f.vt;
            if (Object.keys(o).length) cs[r + ',' + c] = o;
          }));
          e.va = 't'; // PowerPoint: Zellen oben ausgerichtet, sofern nicht anders angegeben
          if (Object.keys(cs).length) e.cs = cs;
          else if (!(parts && parts.none) && flag('firstRow') || (headFill && headFill >= rows[0].length && rows.length > 1)) e.head = 1;
          if (parts && parts._line && !lineC) e.line = parts._line;
          if (lineC) e.line = lineC;
          if (mg.length) e.mg = mg;
          delete e.r;
          e.r = 0;
          out.push(e);
          return;
        }
        if (/chart$/.test(uri)) {
          const cr = ctx.rels[rid(kid(gd, 'chart'), 'id')];
          const cd = cr && xml(cr.target);
          if (!cd) return;
          const pa = all(cd, 'plotArea')[0];
          const CH_RE = /(bar|bar3D|line|line3D|pie|pie3D|doughnut|area|area3D|scatter)Chart$/;
          const chs = pa ? [...pa.children].filter((n) => CH_RE.test(n.localName)) : [];
          // Hauptart: Säulen/Balken, sonst die erste; weitere Arten (z. B. Linie über Säulen) werden als eigene Reihen dazugezeichnet
          const ch = chs.find((n) => /^bar/.test(n.localName)) || chs.find((n) => !/^scatter/.test(n.localName)) || chs[0];
          if (!ch) return;
          const kind = ch.localName.replace(/3D/, '');
          const ct = kind === 'barChart' ? (at(kid(ch, 'barDir'), 'val') === 'bar' ? 'bar' : 'col') : kind === 'pieChart' || kind === 'doughnutChart' ? 'pie' : 'line';
          const pts = (el) => { const ml = el && all(el, 'multiLvlStrCache')[0]; const cache = el && (all(el, 'strCache')[0] || all(el, 'numCache')[0] || (ml && kids(ml, 'lvl')[0])); const o = []; if (cache) for (const p of kids(cache, 'pt')) o[num(at(p, 'idx'))] = (kid(p, 'v') || {}).textContent || ''; return o; };
          const sers = [ch, ...chs.filter((n) => n !== ch)].flatMap((c) => kids(c, 'ser').map((x) => { x._ct = c; return x; }));
          let labels = [];
          const series = sers.map((s) => {
            const cat = pts(kid(s, 'cat')); if (cat.length > labels.length) labels = cat;
            const nm = pts(kid(s, 'tx'))[0] || (path(s, 'tx', 'v') || {}).textContent || '';
            // eigene Farbe der Reihe (Füllung bei Balken, Linie bei Linien)
            const sp = kid(s, 'spPr');
            const fc = sp && (ct === 'line' ? color(path(sp, 'ln', 'solidFill'), T) || color(kid(sp, 'solidFill'), T) : color(kid(sp, 'solidFill'), T) || color(path(sp, 'ln', 'solidFill'), T));
            const o = { n: nm, v: pts(kid(s, 'val') || kid(s, 'yVal')).map((v) => num(v)), c: fc && fc.c, mk: at(path(s, 'marker', 'symbol'), 'val') };
            // Reihe einer anderen Art als die Hauptart (Linie/Punkte über Säulen)
            if (s._ct !== ch && ct !== 'pie' && /^(line|scatter)/.test(s._ct.localName) && /^bar/.test(ch.localName)) {
              o.t = 'line';
              if (sp && kid(sp, 'ln') && kid(kid(sp, 'ln'), 'noFill')) o.nl = 1; // nur Punkte, keine Linie
              const mc = color(path(s, 'marker', 'spPr', 'solidFill'), T); if (mc) o.c = mc.c;
              if (o.mk === 'none') o.nm = 1;
            }
            if (kid(s, 'dLbls') && all(kid(s, 'dLbls'), 'showVal').some((x) => at(x, 'val') === '1')) o.dl = 1;
            return o;
          }).filter((s) => s.v.length);
          if (!series.length) return;
          let pieC = null;
          // Reihen ohne eigene Farbe: Farben der Diagrammformatvorlage (c:style 1–48: Spalte 1 grau, 2 bunt, 3–8 Abstufungen einer Akzentfarbe)
          {
            const sty = num(at(all(cd, 'style').find((n) => n.parentNode === cd.documentElement || n.parentNode.localName === 'Fallback'), 'val'), 2);
            const colN = ((Math.max(1, Math.min(48, sty)) - 1) % 8) + 1;
            const acc = (k) => '#' + (T.scheme['accent' + k] || '4472C4');
            const mixC = (hex, f) => '#' + [1, 3, 5].map((i) => { const v = parseInt(hex.slice(i, i + 2), 16); return hex2(f < 0 ? v * (1 + f) : v + (255 - v) * f); }).join('').toUpperCase();
            const n = series.length;
            series.forEach((sr, i) => {
              if (ct === 'pie' && i === 0) {
                // Kreis: Farbe je Stück (eigene Farben der Datenpunkte, sonst die Akzentfarben)
                const dp = {}; for (const d of kids(sers[0], 'dPt')) { const c = color(path(d, 'spPr', 'solidFill'), T); if (c) dp[num(at(kid(d, 'idx'), 'val'))] = c.c; }
                const vary = at(kid(ch, 'varyColors'), 'val') !== '0';
                pieC = sr.v.map((_, k) => dp[k] || (vary ? (colN === 2 || colN === 1 ? acc((k % 6) + 1) : mixC(acc(colN - 2), sr.v.length > 1 ? -0.5 + k / (sr.v.length - 1) : 0)) : sr.c || acc(1)));
              }
              if (sr.c || ct === 'pie') return;
              const f = n > 1 ? -0.5 + i / (n - 1) : 0; // von dunkel nach hell
              sr.c = colN === 1 ? mixC('#808080', f * 0.9) : colN === 2 ? acc((i % 6) + 1) : mixC(acc(colN - 2), f);
            });
          }
          labels = labels.map((l) => (l == null ? '' : String(l)));
          while (labels.length < series[0].v.length) labels.push(String(labels.length + 1));
          const title = all(path(cd.documentElement, 'chart', 'title'), 't').map((t) => t.textContent).join('') || '';
          const valAx = kid(pa, 'valAx'), catAx = kid(pa, 'catAx') || kid(pa, 'dateAx');
          const axR = (ax) => ax && all(kid(ax, 'txPr'), 'defRPr')[0];
          const rp = axR(catAx) || axR(valAx) || all(kid(cd.documentElement, 'txPr'), 'defRPr')[0];
          const csz = num(at(rp, 'sz')) || num(at(all(kid(cd.documentElement, 'txPr'), 'defRPr')[0], 'sz')) || 1000;
          const e = { ...base, t: 'chart', ct, labels: labels.slice(0, 60), series: series.slice(0, 10).map((s) => ({ n: s.n, v: s.v.slice(0, 60), ...(s.c ? { c: s.c } : {}), ...(s.t ? { t: s.t } : {}), ...(s.nl ? { nl: 1 } : {}), ...(s.nm ? { nm: 1 } : {}), ...(s.dl ? { dl: 1 } : {}) })), fs: Math.max(6, Math.round((csz / 100) * K)), legend: path(cd.documentElement, 'chart', 'legend') ? 1 : 0 };
          if (pieC && pieC.length) e.pc = pieC.slice(0, 60);
          if (title && path(cd.documentElement, 'chart', 'autoTitleDeleted') && at(path(cd.documentElement, 'chart', 'autoTitleDeleted'), 'val') === '1') { /* kein Titel */ } else if (title) e.title = title;
          else if (path(cd.documentElement, 'chart', 'title') && at(path(cd.documentElement, 'chart', 'autoTitleDeleted'), 'val') !== '1') {
            // Titel ohne eigenen Text: PowerPoint zeigt den Namen der einzigen Reihe, sonst „Diagrammtitel“
            e.title = series.length === 1 && series[0].n ? series[0].n : 'Diagrammtitel';
          }
          if (/3DChart$/.test(ch.localName)) e.d3 = 1; // räumlich: Säulen mit Seitenflächen, Kreis schräg von oben
          // Aussehen: Hintergrund, Schriftfarbe, Achsenbereich, Zahlenformat, Werte an den Balken, Punkte
          const csp = kid(cd.documentElement, 'spPr');
          const bgc = csp && color(kid(csp, 'solidFill'), T);
          if (bgc && bgc.a > 0.5) e.bg = bgc.c;
          const tcol = rp && color(kid(rp, 'solidFill'), T);
          if (tcol) e.tc = tcol.c;
          const sc = valAx && kid(valAx, 'scaling');
          if (sc && kid(sc, 'min')) e.vmin = num(at(kid(sc, 'min'), 'val'));
          if (sc && kid(sc, 'max')) e.vmax = num(at(kid(sc, 'max'), 'val'));
          let fmt = at(valAx && kid(valAx, 'numFmt'), 'formatCode') || '';
          if (!fmt || fmt === 'General' || at(valAx && kid(valAx, 'numFmt'), 'sourceLinked') === '1') fmt = (all(ch, 'formatCode')[0] || {}).textContent || fmt;
          const dlN = all(ch, 'dLbls').flatMap((d) => [...all(d, 'numFmt')])[0];
          if (/%/.test(fmt) || /%/.test(at(dlN, 'formatCode') || '')) e.pct = 1;
          const dec = /0[.,](0+)/.exec(at(dlN, 'formatCode') || fmt);
          if (dec) e.dp = dec[1].length;
          if (all(ch, 'showVal').some((x) => at(x, 'val') === '1')) e.dl = 1;
          if (ct === 'line' && series.every((s) => s.mk === 'none')) e.mk = 0;
          // gestapelt bzw. gestapelt auf 100 %
          const grp = at(kid(ch, 'grouping'), 'val');
          if (grp === 'stacked') e.st = 's'; else if (grp === 'percentStacked') e.st = 'p';
          const gw = kid(ch, 'gapWidth'); if (gw) e.gw = Math.max(0, Math.min(500, num(at(gw, 'val'), 150)));
          // Lage von Zeichenfläche und Legende (von Hand gesetzt), Legende rechts/oben/links
          const ml = (n) => { const m = n && all(n, 'manualLayout')[0]; if (!m || !kid(m, 'x')) return null; const g = (k) => Math.round(num(at(kid(m, k), 'val')) * 1000) / 1000; return [g('x'), g('y'), g('w'), g('h')]; };
          const plm = ml(kid(pa, 'layout')); if (plm && plm[2] > 0.05 && plm[3] > 0.05) e.pl = plm;
          const lgd = path(cd.documentElement, 'chart', 'legend');
          if (lgd) { const lp = at(kid(lgd, 'legendPos'), 'val') || 'r'; if (/^(r|t|l)$/.test(lp)) e.lp = lp; const lgm = ml(kid(lgd, 'layout')); if (lgm && lgm[2] > 0.02) e.lg = lgm; }
          // Beschriftung der Rubrikenachse gedreht; ausgeblendete Achsen; Gitternetz
          const lr = at(all(kid(catAx, 'txPr'), 'bodyPr')[0], 'rot');
          if (lr != null && Math.abs(num(lr)) >= 60000 && Math.abs(num(lr)) <= 5400000) e.lr = Math.round(num(lr) / 60000); // −60000000 = „automatisch“
          if (catAx && at(kid(catAx, 'delete'), 'val') === '1') e.nc = 1;
          if (ct === 'bar' && valAx && at(kid(valAx, 'axPos'), 'val') === 't') e.vt = 1; // Werte-Achse oben
          if (valAx && at(kid(valAx, 'delete'), 'val') === '1') e.nv = 1;
          if (valAx && !kid(valAx, 'majorGridlines')) e.ng = 1;
          // Bild als Diagrammhintergrund (gestreckt oder gekachelt) und Rahmen des Diagramms
          const cbf = csp && kid(csp, 'blipFill');
          if (cbf) {
            const crel = relsOf(cr.target)[rid(kid(cbf, 'blip'), 'embed')];
            const res = crel && !crel.ext ? await upload(crel.target) : null;
            if (res) { out.push({ ...base, id: X().uid(), t: 'img', src: res.src, iw: res.w, ih: res.h }); delete e.bg; }
          }
          const cln = csp && kid(csp, 'ln');
          const clc = cln && !kid(cln, 'noFill') && color(kid(cln, 'solidFill'), T);
          const frame = clc ? { ...base, id: X().uid(), t: 'shape', k: 'rect', line: clc.c, lw: Math.max(0.5, r1(px(num(at(cln, 'w')) || 9525))) } : null;
          // waagrechte Balken: PowerPoint zeichnet die erste Kategorie unten, außer die Achse ist umgekehrt
          if (ct === 'bar' && at(path(catAx, 'scaling', 'orientation'), 'val') !== 'maxMin') { e.labels.reverse(); e.series.forEach((s) => s.v.reverse()); }
          out.push(e);
          if (frame) out.push(frame);
          return;
        }
        // eingebettete Objekte (OLE, z. B. Excel-Tabellen): das mitgespeicherte Vorschaubild zeigen
        if (/ole$/.test(uri)) {
          const ole = all(gd, 'oleObj')[0];
          let target = null;
          const pic = ole && all(ole, 'pic')[0];
          const blip = pic && all(pic, 'blip')[0];
          if (blip) target = ctx.rels[rid(blip, 'embed')];
          if (!target && ole && at(ole, 'spid')) {
            const vr = Object.values(ctx.rels).find((r) => r.type === 'vmlDrawing' && z[r.target]);
            if (vr) {
              const vml = window.fflate.strFromU8(z[vr.target]);
              const i0 = vml.indexOf(`id="${at(ole, 'spid')}"`);
              const seg = i0 >= 0 ? vml.slice(i0, vml.indexOf('</v:shape>', i0) + 1 || undefined) : '';
              const m = /<v:imagedata[^>]*o:relid="([^"]+)"/.exec(seg);
              if (m) target = relsOf(vr.target)[m[1]];
            }
          }
          const res = target && !target.ext ? await upload(target.target) : null;
          if (res) out.push({ ...base, t: 'img', src: res.src, iw: res.w, ih: res.h });
          return;
        }
        // SmartArt: die mitgespeicherte Zeichnung übernehmen
        if (/diagram$/.test(uri)) {
          // die zu genau diesem Diagramm gehörende Zeichnung (Datenteil → dataModelExt relId), sonst die erste
          let rel = null;
          const ri = all(gd, 'relIds')[0], dmRel = ri && ctx.rels[at(ri, 'r:dm')];
          const dmX = dmRel && xml(dmRel.target);
          const ext = dmX && all(dmX, 'dataModelExt')[0];
          if (ext && ctx.rels[at(ext, 'relId')] && xml(ctx.rels[at(ext, 'relId')].target)) rel = ctx.rels[at(ext, 'relId')];
          if (!rel) rel = Object.values(ctx.rels).find((r) => r.type === 'diagramDrawing' && xml(r.target));
          // Hintergrund der SmartArt-Grafik (Bild oder Farbe) hinter die Formen legen
          const dbg = dmX && kid(dmX.documentElement, 'bg');
          if (dbg) {
            const dbf = kid(dbg, 'blipFill');
            if (dbf) {
              const brel = relsOf(dmRel.target)[rid(kid(dbf, 'blip'), 'embed')];
              const res = brel && !brel.ext ? await upload(brel.target) : null;
              if (res) out.push({ ...base, id: X().uid(), t: 'img', src: res.src, iw: res.w, ih: res.h });
            } else {
              const sc = kid(dbg, 'solidFill') && color(kid(dbg, 'solidFill'), T);
              if (sc && sc.a > 0.02) out.push({ ...base, id: X().uid(), t: 'shape', k: 'rect', fill: sc.c, ...(sc.a < 1 ? { fo: r1(sc.a) } : {}) });
            }
          }
          if (!rel) return;
          const dd = xml(rel.target);
          const tree = all(dd, 'spTree')[0];
          if (!tree) return;
          const sub = { ...ctx, rels: relsOf(rel.target) };
          const M2 = { f: (x, y) => M.f(b.x + x, b.y + y), s: M.s };
          const id = X().uid();
          for (const c of tree.children) await convert(c, sub, M2, out, gid || id);
        }
        return;
      }
      // Form, Textfeld oder Linie
      const geom = spPr && kid(spPr, 'prstGeom');
      const prst = geom ? at(geom, 'prst') : spPr && kid(spPr, 'custGeom') ? 'custom' : 'rect';
      // eingebaute Formen genau nach ihrer Definition (nur ganz einfache bleiben eigene, bearbeitbare Formen)
      const NATIVE = new Set(['rect', 'ellipse', 'triangle', 'rtTriangle', 'diamond', 'roundRect']);
      const adj = {};
      if (geom) for (const g of kids(kid(geom, 'avLst'), 'gd')) adj[at(g, 'name')] = at(g, 'fmla');
      let cg = null;
      if (prst === 'custom') cg = custPath(kid(spPr, 'custGeom'), b.w, b.h);
      else if (PRESETS && PRESETS[prst] && !LINE_PRST.test(prst) && !(NATIVE.has(prst) && !Object.keys(adj).length)) cg = geomPath(PRESETS[prst], b.w, b.h, adj);
      const bfill = spPr && kid(spPr, 'blipFill');
      if (bfill && !(kid(sp, 'txBody') && all(kid(sp, 'txBody'), 't').some((t) => t.textContent.trim()))) {
        const blip = kid(bfill, 'blip');
        const svgB = blip && all(blip, 'svgBlip')[0];
        let target = blip && ctx.rels[rid(blip, 'embed')];
        if ((!target || /\.(emf|wmf)$/i.test(target.target)) && svgB) target = ctx.rels[rid(svgB, 'embed')] || target;
        // Form mit Bildfüllung: nicht rechteckig, gekachelt oder halb durchsichtig → in Form der Fläche vorzeichnen
        const tile = kid(bfill, 'tile'), amf = blip && kid(blip, 'alphaModFix');
        const pd = prst && prst !== 'rect' ? (cg && cg.d) || (prst !== 'custom' && PRESETS && PRESETS[prst] ? (geomPath(PRESETS[prst], b.w, b.h, adj) || {}).d : null) : null;
        const res = target && !target.ext ? (pd || tile || amf ? await shapePic(target.target, b.w, b.h, pd, tile, amf ? num(at(amf, 'amt'), 100000) / 100000 : 1) : await upload(target.target)) : null;
        if (res) { const e = { ...base, t: 'img', src: res.src, iw: res.w, ih: res.h }; if (b.fx) e.fx = 1; if (b.fy) e.fy = 1; out.push(e); return; }
      }
      let fill = fillOf(spPr, style, T, ctx.grpFill);
      let line = lineOf(spPr, style, T);
      const fontRefEl = style && kid(style, 'fontRef');
      const fontRef = fontRefEl ? color(fontRefEl, T) : null;
      const isLineShape = (ln === 'cxnSp' || LINE_PRST.test(prst)) && !(cg && (cg.d || cg.ds));
      if (isLineShape) {
        if (!line) return;
        // Endpunkte (Spiegelungen beachten), daraus eine waagrechte Linie mit Drehung
        const sx = geo.x, sy = geo.y, ex = geo.x + geo.w, ey = geo.y + geo.h;
        let p0 = [b.fx ? ex : sx, b.fy ? ey : sy], p1 = [b.fx ? sx : ex, b.fy ? sy : ey];
        if (b.w === 0 || geo.w <= 1) { p0[0] = p1[0] = geo.x; }
        if (b.h === 0 || geo.h <= 1) { p0[1] = p1[1] = geo.y; }
        const cxm = (geo.x + geo.w / 2), cym = (geo.y + geo.h / 2);
        // Drehung des Rahmens um seinen Mittelpunkt
        if (b.r) { const a = (b.r * Math.PI) / 180; const rot = (p) => [cxm + (p[0] - cxm) * Math.cos(a) - (p[1] - cym) * Math.sin(a), cym + (p[0] - cxm) * Math.sin(a) + (p[1] - cym) * Math.cos(a)]; p0 = rot(p0); p1 = rot(p1); }
        let k = line.head && line.tail ? 'arrow2' : line.tail || line.head ? 'arrow' : 'line';
        if (line.head && !line.tail) [p0, p1] = [p1, p0];
        if (/^bentConnector[345]$/.test(prst)) {
          const e = { ...base, t: 'shape', k: 'elbow', line: line.c, lw: line.w };
          if (b.fx) e.fx = 1; if (b.fy) e.fy = 1;
          if (!line.tail && !line.head) e.head = 0;
          out.push(e);
          return;
        }
        const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        if (L < 1) return;
        const ang = (Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180) / Math.PI;
        const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2, hh = 20;
        const e = { id: base.id, t: 'shape', k, x: r1(mx - L / 2), y: r1(my - hh / 2), w: r1(L), h: hh, r: r1(ang), line: line.c, lw: line.w };
        if (base.g) e.g = base.g;
        if (line.a < 1) e.op = r1(line.a);
        out.push(e);
        return;
      }
      const chain = styleChain(sp, ctx);
      const tb = kid(sp, 'txBody');
      const t = tb ? textOf(tb, chain, ctx, { sz: 18, fontRef, major: !!ph && masterType(phType(ph)) === 'title' }) : null;
      // Verlauf: Form als Pfad (auch Rechteck/Ellipse), damit der Verlauf überall gezeichnet werden kann
      if (fill && fill.grad && !cg && PRESETS) cg = geomPath(PRESETS[prst] || PRESETS.rect, b.w, b.h, adj) || geomPath(PRESETS.rect, b.w, b.h, {});
      const k = cg ? 'path' : PRST_K[prst] || 'rect';
      if (cg && !cg.fill) fill = null;
      const bodies = bodyPrChain(sp, ctx);
      const anchor = firstAttr(bodies, 'anchor');
      const va = anchor === 'ctr' ? 'm' : anchor === 'b' ? 'b' : 't';
      const ins = ['lIns', 'tIns', 'rIns', 'bIns'].map((n) => { const v = firstAttr(bodies, n); return v == null ? (n[0] === 'l' || n[0] === 'r' ? 91440 : 45720) : num(v); });
      const pad = r1(Math.max(0, Math.min(40, px((ins[0] + ins[1] + ins[2] + ins[3]) / 4))));
      if (cg && !cg.stroke) line = null; // Pfad ohne Kontur
      const plainBox = k === 'rect' && !fill && !line;
      if (plainBox && !(t && t.hasText)) return; // leerer Rahmen
      const e = { ...base };
      if (fill && fill.a < 1) { if (fill.a <= 0.02) fill = null; else e.fo = Math.round(fill.a * 100) / 100; }
      if (plainBox || (k === 'rect' && t && t.hasText && !line && fill)) {
        e.t = 'text';
        if (fill) e.fill = fill.c;
      } else {
        e.t = 'shape'; e.k = k;
        if (fill && fill.grad && e.k === 'path') e.gr = fill.grad;
        // ohne Füllung zählt nur der Umriss (z. B. Bogen: die Füllfläche wäre ein Tortenstück mit Linien zur Mitte)
        if (cg && !fill && cg.ds) { cg = { ...cg, d: cg.ds, ds: '' }; }
        if (cg) { if (cg.d) e.d = cg.d; if (cg.ds) e.ds = cg.ds; if (line && (line.head || line.tail)) e.ah = line.head && line.tail ? 'b' : line.tail ? 'e' : 's'; }
        e.fill = fill ? fill.c : undefined;
        if (!fill) delete e.fill;
        if (b.fx) e.fx = 1; if (b.fy) e.fy = 1;
      }
      if (line) { e.line = line.c; e.lw = line.w; }
      if (t && t.hasText) {
        e.html = t.html; e.fs = r1(t.fs); e.va = va; e.pad = pad;
        // PowerPoint hat den Text hier selbst verkleinert („Automatisch anpassen“ am Feld): beim Einlesen auf Feldgröße bringen
        if (kid(path(sp, 'txBody', 'bodyPr'), 'normAutofit')) e._af = 1;
        e.c = t.c || (e.t === 'shape' && fill ? '#FFFFFF' : T.scheme.dk1 ? '#' + T.scheme.dk1 : '#1A1A1A');
        // Text in derselben Farbe wie die Füllung (kommt bei SmartArt vor): lesbare Farbe nehmen
        if (fill && (!e.fo || e.fo > 0.6) && Math.abs(lum(e.c) - lum(fill.c)) < 0.18) {
          const dk = T.scheme.dk1 ? '#' + T.scheme.dk1 : '#1A1A1A', lt = T.scheme.lt1 ? '#' + T.scheme.lt1 : '#FFFFFF';
          e.c = Math.abs(lum(dk) - lum(fill.c)) > Math.abs(lum(lt) - lum(fill.c)) ? dk : lt;
          e.html = e.html.replace(/color:\s*#[0-9A-F]{6};?/gi, (m) => (m.toUpperCase().includes(fill.c.slice(1).toUpperCase()) ? '' : m));
        }
        const key = X().fontKey(t.ff);
        if (key && key !== ctx.deckFont) e.ff = key;
        const lnSp = t.lnPct != null ? t.lnPct * 100000 : firstAttr(chain.map((s) => kid(s, 'lvl1pPr')).filter(Boolean).map((x) => path(x, 'lnSpc', 'spcPct')).filter(Boolean), 'val');
        if (lnSp && Math.abs(num(lnSp) / 100000 - 1) > 0.05) e.lh = Math.round(num(lnSp) / 1000 * 1.2) / 100;
      } else if (e.t === 'text') return;
      // Senkrechter Text (vert, vert270, eaVert): als um 90° gedrehtes Textfeld – sieht überall gleich aus (Bildschirm, PDF, PowerPoint)
      const vert = firstAttr(bodies, 'vert');
      if (e.html && /^(vert|eaVert|vert270|wordArtVertRtl)$/.test(vert || '')) {
        const turn = vert === 'vert270' ? -90 : 90;
        const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
        const rot = (o) => { const w = o.h, h = o.w; Object.assign(o, { x: r1(cx - w / 2), y: r1(cy - h / 2), w: r1(w), h: r1(h), r: ((o.r || 0) + turn + 360) % 360 }); };
        if (e.t === 'text') rot(e);
        else {
          // Form bleibt stehen, der Text kommt als eigenes gedrehtes Feld darüber
          const te = { id: X().uid(), t: 'text', x: e.x, y: e.y, w: e.w, h: e.h, r: e.r || 0, html: e.html, fs: e.fs, va: e.va, pad: e.pad, c: e.c };
          if (e.ff) te.ff = e.ff; if (e.lh) te.lh = e.lh; if (e.g) te.g = e.g;
          delete e.html; delete e.fs; delete e.va; delete e.c; delete e.ff; delete e.lh; delete e.pad;
          rot(te);
          out.push(e, te);
          return;
        }
      }
      // Text auf einem Bogen (WordArt „Bogen nach oben/unten“)
      const warp = bodies.map((bp) => bp && kid(bp, 'prstTxWarp')).find(Boolean);
      const wk = warp && at(warp, 'prst');
      if (e.html && e.t === 'text' && (wk === 'textArchUp' || wk === 'textArchDown')) {
        const gd = all(warp, 'gd').find((g) => at(g, 'name') === 'adj');
        const v = gd && /val\s+(-?\d+)/.exec(at(gd, 'fmla') || '');
        e.warp = { k: wk === 'textArchUp' ? 'up' : 'down', a: v ? r1(num(v[1]) / 60000) : wk === 'textArchUp' ? 180 : 0 };
        out.push(e);
        return;
      }
      // Text ohne Zeilenumbruch (wrap="none"): Feld so breit machen wie die längste Zeile
      const plainLines = e.html ? e.html.replace(/<br>/g, '\n').replace(/<\/(div|li)>/g, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').split('\n') : [];
      const longWord = Math.max(0, ...plainLines.flatMap((l) => l.split(/\s+/)).map((w) => w.length)) * (e.fs || 18) * 0.6 + 2 * (e.pad || 0) + 4;
      if (e.html && e.t === 'text' && longWord > e.w && longWord < e.w * 1.6) { const al = /text-align: center/.test(e.html) ? 0.5 : /text-align: right/.test(e.html) ? 1 : 0; e.x = r1(e.x - (longWord - e.w) * al); e.w = r1(longWord); }
      if (e.html && firstAttr(bodies, 'wrap') === 'none') {
        const lines = e.html.replace(/<br>/g, '\n').replace(/<\/(div|li)>/g, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').split('\n');
        const need = Math.max(...lines.map((l) => l.length)) * e.fs * 0.56 + 2 * (e.pad || 0) + 4;
        if (need > e.w) { const al = /text-align: center/.test(e.html) ? 0.5 : /text-align: right/.test(e.html) ? 1 : 0; e.x = r1(e.x - (need - e.w) * al); e.w = r1(need); }
      }
      // SmartArt: eigener Textrahmen (txXfrm) – Text als eigenes Feld an die richtige Stelle
      const txf = kid(sp, 'txXfrm');
      if (txf && e.t === 'shape' && e.html && kid(txf, 'ext')) {
        const tb = box(txf);
        const [tx0, ty0] = M.f(tb.x, tb.y), [tx1, ty1] = M.f(tb.x + tb.w, tb.y + tb.h);
        const g2 = { x: r1(OX + (tx0 / EMU) * K), y: r1(OY + (ty0 / EMU) * K), w: r1(Math.max(1, ((tx1 - tx0) / EMU) * K)), h: r1(Math.max(1, ((ty1 - ty0) / EMU) * K)) };
        if (Math.abs(g2.x - e.x) + Math.abs(g2.y - e.y) + Math.abs(g2.w - e.w) + Math.abs(g2.h - e.h) > 6) {
          const te = { id: X().uid(), t: 'text', ...g2, r: e.r || 0, html: e.html, fs: e.fs, va: e.va, pad: 0, c: e.c };
          if (e.ff) te.ff = e.ff; if (e.lh) te.lh = e.lh; if (e.g) te.g = e.g;
          delete e.html; delete e.fs; delete e.va; delete e.c; delete e.ff; delete e.lh; delete e.pad;
          out.push(e, te);
          return;
        }
      }
      out.push(e);
    }

    // Eingangsanimationen einer Folie: Form-ID → { an, ao (Klick), ap (absatzweise) }
    function animOf(d) {
      const map = {};
      const timing = all(d, 'timing')[0];
      if (!timing) return map;
      const seq = all(timing, 'seq').find((sq) => at(kid(sq, 'cTn'), 'nodeType') === 'mainSeq');
      if (!seq) return map;
      const PRESET = { 1: 'appear', 21: 'appear', 10: 'fade', 9: 'fade', 2: 'fly', 3: 'fly', 12: 'fly', 47: 'fly', 23: 'zoom', 53: 'zoom', 31: 'zoom' };
      kids(path(seq, 'cTn', 'childTnLst'), 'par').forEach((par, ci) => {
        for (const ctn of all(par, 'cTn')) {
          if (at(ctn, 'presetClass') !== 'entr') continue;
          const id = at(all(ctn, 'spTgt')[0], 'spid');
          if (!id || map[id]) continue;
          map[id] = { an: PRESET[num(at(ctn, 'presetID'))] || 'fade', ao: ci + 1 };
        }
      });
      for (const b of all(timing, 'bldP')) { const id = at(b, 'spid'); if (map[id] && at(b, 'build') === 'p') map[id].ap = 1; }
      return map;
    }

    // Hintergrund einer Folie, eines Layouts oder des Masters
    // Füllung (Verlauf, Bild, Kachel, Einfärbung) als Hintergrundbild zeichnen und hochladen
    const fillImgCache = {};
    async function fillImage(f, T, rels, ph, key) {
      if (fillImgCache[key]) return fillImgCache[key];
      return (fillImgCache[key] = (async () => {
        const CW = 1920, CH = Math.round((1920 * H) / W), cv = document.createElement('canvas');
        cv.width = CW; cv.height = CH;
        const g2 = cv.getContext('2d');
        g2.fillStyle = '#FFFFFF'; g2.fillRect(0, 0, CW, CH);
        if (f.localName === 'gradFill') {
          const gs = all(f, 'gs').map((g) => ({ p: num(at(g, 'pos')) / 100000, c: color(g, T, ph) })).filter((x) => x.c).sort((x, y) => x.p - y.p);
          if (!gs.length) return null;
          let gr;
          const pth = kid(f, 'path');
          if (pth) {
            const fr = kid(pth, 'fillToRect');
            const l = num(at(fr, 'l')) / 100000, t = num(at(fr, 't')) / 100000, r = num(at(fr, 'r')) / 100000, bb = num(at(fr, 'b')) / 100000;
            const fx = ((l + (1 - r)) / 2) * CW, fy = ((t + (1 - bb)) / 2) * CH;
            const R = Math.hypot(CW, CH) / 2; // Radius: halbe Diagonale, auch wenn der Mittelpunkt verschoben ist
            gr = g2.createRadialGradient(fx, fy, 0, fx, fy, R);
          } else {
            const ang = ((num(at(kid(f, 'lin'), 'ang')) / 60000) * Math.PI) / 180;
            const dx = Math.cos(ang), dy = Math.sin(ang), L = Math.abs(CW * dx) + Math.abs(CH * dy);
            gr = g2.createLinearGradient(CW / 2 - (dx * L) / 2, CH / 2 - (dy * L) / 2, CW / 2 + (dx * L) / 2, CH / 2 + (dy * L) / 2);
          }
          for (const g of gs) { const h = g.c.c; gr.addColorStop(Math.max(0, Math.min(1, g.p)), `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${g.c.a})`); }
          g2.fillStyle = gr; g2.fillRect(0, 0, CW, CH);
        } else if (f.localName === 'blipFill') {
          const blip = kid(f, 'blip');
          const r = blip && rels[rid(blip, 'embed')];
          if (!r || r.ext || !z[r.target]) return null;
          const ext = r.target.split('.').pop().toLowerCase();
          const cv0 = conv[r.target];
          const blob = cv0 && cv0.png ? new Blob([cv0.png], { type: 'image/png' }) : cv0 && cv0.svg ? await svgCrop(cv0.svg) : new Blob([z[r.target]], { type: ext === 'svg' ? 'image/svg+xml' : 'image/' + (ext === 'jpg' ? 'jpeg' : ext) });
          if (!blob) return null;
          const url = URL.createObjectURL(blob);
          try {
            const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
            const tile = kid(f, 'tile');
            if (tile) {
              const k = (CW / W) * K * 0.75; // Bildpunkt (96 dpi) → pt → Leinwand
              const sx = (num(at(tile, 'sx'), 100000) / 100000) * k, sy = (num(at(tile, 'sy'), 100000) / 100000) * k;
              const tw = Math.max(1, (im.naturalWidth || 64) * sx), th = Math.max(1, (im.naturalHeight || 64) * sy);
              const tc = document.createElement('canvas'); tc.width = Math.round(tw); tc.height = Math.round(th);
              tc.getContext('2d').drawImage(im, 0, 0, tc.width, tc.height);
              g2.save(); g2.translate((num(at(tile, 'tx')) / EMU) * K * (CW / W), (num(at(tile, 'ty')) / EMU) * K * (CW / W));
              g2.fillStyle = g2.createPattern(tc, 'repeat'); g2.fillRect(-tw, -th, CW + 2 * tw, CH + 2 * th); g2.restore();
            } else g2.drawImage(im, 0, 0, CW, CH);
          } catch (e) { return null; } finally { URL.revokeObjectURL(url); }
          // Einfärbung (Duoton): helle und dunkle Stellen auf zwei Farben abbilden
          const duo = kid(blip, 'duotone');
          if (duo) {
            const cs = [...duo.children].map((c) => color({ children: [c] }, T, ph)).filter(Boolean);
            if (cs.length === 2) {
              const A2 = [1, 3, 5].map((i) => parseInt(cs[0].c.slice(i, i + 2), 16)), B2 = [1, 3, 5].map((i) => parseInt(cs[1].c.slice(i, i + 2), 16));
              const id = g2.getImageData(0, 0, CW, CH), dd = id.data;
              for (let i = 0; i < dd.length; i += 4) { const y = (0.3 * dd[i] + 0.59 * dd[i + 1] + 0.11 * dd[i + 2]) / 255; dd[i] = A2[0] + (B2[0] - A2[0]) * y; dd[i + 1] = A2[1] + (B2[1] - A2[1]) * y; dd[i + 2] = A2[2] + (B2[2] - A2[2]) * y; }
              g2.putImageData(id, 0, 0);
            }
          }
        } else return null;
        const out = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.86));
        try { const up = await C.uploadImage(new File([out], 'hintergrund.jpg', { type: 'image/jpeg' })); return up ? { bgImg: up.src } : null; } catch (e) { return null; }
      })());
    }
    // einfacher Verlauf (zwei Farben, waagrecht/senkrecht/schräg) bleibt bearbeitbar, alles andere wird ein Bild
    const simpleGrad = (gf, T, ph) => {
      const gs = all(gf, 'gs');
      if (gs.length !== 2 || kid(gf, 'path')) return null;
      const a = color(gs[0], T, ph), z2 = color(gs[1], T, ph);
      if (!a || !z2 || a.a < 1 || z2.a < 1) return null;
      const ang = num(at(kid(gf, 'lin'), 'ang')) / 60000;
      const dir = Math.abs(ang - 90) < 3 ? 'v' : ang < 3 || ang > 357 ? 'h' : Math.abs(ang - 45) < 3 ? 'd' : '';
      if (!dir) return null;
      const [p, q] = num(at(gs[0], 'pos')) <= num(at(gs[1], 'pos')) ? [a, z2] : [z2, a];
      return { bg: p.c, bgGrad: { a: p.c, b: q.c, dir } };
    };
    async function bgOfDoc(doc, rels, T, key) {
      const bg = doc && path(doc.documentElement, 'cSld', 'bg');
      if (!bg) return null;
      key = (key || '') + ':' + JSON.stringify(T.map);
      const pr = kid(bg, 'bgPr');
      if (pr) {
        const sf = kid(pr, 'solidFill'); if (sf) { const c = color(sf, T); if (!c) return null; return { bg: c.a < 1 ? mixW(c.c, c.a) : c.c }; } // durchsichtig: Weiß scheint durch (wie in PowerPoint)
        const gf = kid(pr, 'gradFill');
        if (gf) return simpleGrad(gf, T) || (await fillImage(gf, T, rels, null, key + ':pr'));
        const bf = kid(pr, 'blipFill');
        if (bf) return await fillImage(bf, T, rels, null, key + ':pr');
        const pf = kid(pr, 'pattFill');
        if (pf) { const c = color(kid(pf, 'bgClr'), T); if (c) return { bg: c.c }; }
        if (kid(pr, 'noFill')) return { bg: '#FFFFFF' };
      }
      const ref = kid(bg, 'bgRef');
      if (ref) {
        const idx = num(at(ref, 'idx'));
        const c = color(ref, T);
        const ph = c && c.c;
        if (idx >= 1001 && T.fmt) {
          const lst = all(T.fmt, 'bgFillStyleLst')[0];
          const f = lst && lst.children[idx - 1001];
          const trels = T.themePath ? relsOf(T.themePath) : {};
          if (f && f.localName === 'solidFill') { const c2 = color(f, T, ph); if (c2) return { bg: c2.c }; }
          if (f && f.localName === 'gradFill') return simpleGrad(f, T, ph) || (await fillImage(f, T, trels, ph, `${T.themePath}:${idx}:${ph}`));
          if (f && f.localName === 'blipFill') { const r = await fillImage(f, T, trels, ph, `${T.themePath}:${idx}:${ph}`); if (r) return r; }
        }
        if (c) return { bg: c.c };
      }
      return null;
    }

    // ---- Folien durchgehen
    const firstMaster = (() => { const sl = slideIds[0]; const lay = sl && relOfType(sl, 'slideLayout'); return lay && relOfType(lay.target, 'slideMaster'); })();
    const T0 = firstMaster ? themeOf(firstMaster.target) : { scheme: {}, map: {}, major: '', minor: '', master: null };
    const deckFont = X().fontKey(T0.minor || 'Calibri') || 'sans';
    const masterBg = T0.master ? await bgOfDoc(T0.master, relsOf(firstMaster.target), T0) : null;
    const theme = { bg: (masterBg && masterBg.bg) || '#FFFFFF', fg: T0.scheme.dk1 ? '#' + T0.scheme.dk1 : '#1A1A1A', accent: T0.scheme.accent1 ? '#' + T0.scheme.accent1 : '#1E2F6E', font: deckFont };
    if (size === '43') theme.size = '43';
    const decoCache = {};
    // Gestaltungselemente von Master und Layout (Logos, Linien …), keine Platzhalter
    async function deco(docPath, ctx) {
      const ck = docPath + JSON.stringify(ctx.T.map);
      if (decoCache[ck]) return decoCache[ck];
      const d = xml(docPath);
      const tree = d && all(d, 'spTree')[0];
      const out = [];
      if (tree) for (const c of tree.children) { if (/^(sp|pic|cxnSp|grpSp|graphicFrame)$/.test(c.localName) && !phOf(c)) await convert(c, { ...ctx, rels: relsOf(docPath) }, ID, out); }
      return (decoCache[ck] = out);
    }
    // ---- Folienmaster: alle Layouts des ersten Masters (Hintergrund, feste Gestaltung, Platzhalter, Fußzeilenfelder)
    // Platzhaltertext: eigener Hinweistext der Vorlage bleibt, sonst kurz „Titel“, „Untertitel“, „Text“
    function promptHtml(html, txt) {
      const t = document.createElement('template');
      t.innerHTML = html;
      const root = t.content;
      // nur den ersten Absatz (bzw. ersten Listenpunkt) behalten
      const blocks = [...root.children];
      blocks.slice(1).forEach((n) => n.remove());
      const b0 = root.firstElementChild;
      if (b0 && /^(UL|OL)$/.test(b0.tagName)) [...b0.children].slice(1).forEach((n) => n.remove());
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = []; while (tw.nextNode()) nodes.push(tw.currentNode);
      if (!nodes.length) return `<div>${txt}</div>`;
      nodes.forEach((n, i) => { n.nodeValue = i ? '' : txt; });
      root.querySelectorAll('br').forEach((n) => n.remove());
      // leere Absätze und Listenpunkte (tiefere Ebenen der Vorlage) entfernen
      [...root.querySelectorAll('li, ul, ol, div, p')].reverse().forEach((n) => { if (!n.textContent.trim()) n.remove(); });
      const d = document.createElement('div'); d.appendChild(root.cloneNode(true));
      return d.innerHTML;
    }
    const plainOf = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    async function buildMaster(theme) {
      if (!firstMaster) return null;
      const mPath = firstMaster.target, T0m = themeOf(mPath);
      const mDoc = T0m.master;
      if (!mDoc) return null;
      const mrels = relsOf(mPath);
      const lays = all(path(mDoc.documentElement, 'sldLayoutIdLst'), 'sldLayoutId').map((n) => mrels[rid(n, 'id')]).filter((r) => r && !r.ext).map((r) => r.target);
      const layouts = [];
      for (const [li, lp] of lays.entries()) {
        const ld = xml(lp);
        if (!ld) continue;
        const map = { ...T0m.map };
        const o = all(ld, 'overrideClrMapping')[0]; if (o) for (const a of o.attributes) map[a.name] = a.value;
        const T = { ...T0m, map };
        const ctx = { T, layout: ld, rels: relsOf(lp), deckFont };
        const L = { id: 'L' + (li + 1), name: (at(all(ld, 'cSld')[0], 'name') || 'Layout ' + (li + 1)).slice(0, 80), deco: [], ph: [], hf: {} };
        if (at(ld.documentElement, 'showMasterSp') !== '0') for (const e of await deco(mPath, { T, layout: null, deckFont })) L.deco.push(JSON.parse(JSON.stringify(e)));
        for (const e of await deco(lp, ctx)) L.deco.push(JSON.parse(JSON.stringify(e)));
        const gmap = {};
        L.deco.forEach((e, i) => { e.id = 'm' + (li + 1) + '_' + i; delete e._spid; delete e._grp; delete e.an; delete e.ao; if (e.g) e.g = gmap[e.g] || (gmap[e.g] = 'mg' + (li + 1) + '_' + i); });
        const tree = all(ld, 'spTree')[0];
        if (tree) for (const c of tree.children) {
          const p = phOf(c);
          if (!p) continue;
          const t = phType(p);
          if (/^(pic|chart|tbl|dgm|media|clipArt|sldImg)$/.test(t)) continue;
          const out = [];
          try { await convert(c, ctx, ID, out); } catch (er) { continue; }
          const e = out.find((x) => x.html);
          if (!e) continue;
          delete e._spid; delete e._grp; delete e.an; delete e.ao; delete e.g;
          if (t === 'sldNum' || t === 'ftr' || t === 'dt') { L.hf[{ sldNum: 'num', ftr: 'foot', dt: 'date' }[t]] = { ...e, id: 'hf' + t, txt: plainOf(e.html) }; continue; }
          const raw = all(c, 't').map((x) => x.textContent).join(' ').replace(/\s+/g, ' ').trim();
          const mt = masterType(t);
          // Großbuchstaben aus der Vorlage (cap="all"): auch eigener Text wird groß geschrieben
          const capAttr = (() => { for (const r of all(c, 'rPr')) { const v = at(r, 'cap'); if (v) return v; } for (const st of styleChain(c, ctx)) { const dr = path(st, 'lvl1pPr', 'defRPr'); const v = dr && at(dr, 'cap'); if (v) return v; } return ''; })();
          const cap = /^(all|small)$/.test(capAttr) || (/[a-zäöü]/.test(raw) && plainOf(e.html) === raw.split('ß').map((x) => x.toLocaleUpperCase('de-DE')).join('ß'));
          if (cap) e.cap = 1;
          const generic = at(p, 'hasCustomPrompt') !== '1' || /master\w*format|click to edit|zum bearbeiten|textformat bearbeiten/i.test(raw);
          if (!generic) { const t0 = document.createElement('template'); t0.innerHTML = e.html; [...t0.content.querySelectorAll('li, ul, ol, div, p')].reverse().forEach((n) => { if (!n.textContent.trim()) n.remove(); }); const d0 = document.createElement('div'); d0.appendChild(t0.content.cloneNode(true)); e.html = d0.innerHTML; }
          if (generic) { const pr = t === 'ctrTitle' || mt === 'title' ? 'Titel' : t === 'subTitle' ? 'Untertitel' : 'Text'; e.html = promptHtml(e.html, cap ? pr.toLocaleUpperCase('de-DE') : pr); }
          e.ph = 1; e.pt = plainOf(e.html); e.pk = mt === 'title' ? 'title' : t === 'subTitle' ? 'sub' : 'body';
          L.ph.push(e);
        }
        const bg = await bgOfDoc(ld, relsOf(lp), T, lp);
        if (bg && !(bg.bg && !bg.bgGrad && !bg.bgImg && bg.bg === theme.bg)) Object.assign(L, bg);
        // Textfarbe dieses Layouts (z. B. weiß auf dunklem Hintergrund) für Folien ohne eigene Farbe
        const tph = L.ph.find((x) => x.pk === 'title') || L.ph[0];
        if (tph && tph.c && tph.c !== theme.fg) L.fg = tph.c;
        layouts.push(L);
      }
      if (!layouts.length) return null;
      // Inhaltslayout: größter Textplatzhalter neben dem Titel; daraus „Zwei Inhalte“ und „Leer“, falls die Vorlage sie nicht hat
      const area = (L) => Math.max(0, ...L.ph.filter((x) => x.pk === 'body').map((x) => x.w * x.h));
      const content = layouts.slice(1).reduce((a, b) => (area(b) > area(a) ? b : a), layouts[layouts.length > 1 ? 1 : 0]);
      const hasTwo = layouts.some((L) => L.ph.filter((x) => x.pk === 'body' && x.w * x.h > area(content) * 0.25).length >= 2);
      const body = content.ph.filter((x) => x.pk === 'body').sort((a, b) => b.w * b.h - a.w * a.h)[0];
      if (!hasTwo && body && body.w > 300) {
        const gap = 24, w2 = Math.round((body.w - gap) / 2);
        const two = { ...JSON.parse(JSON.stringify(content)), id: 'L2col', name: 'Zwei Inhalte', derived: 1 };
        two.ph = two.ph.filter((x) => x !== body && !(x.pk === 'body' && x.x === body.x && x.y === body.y)).concat([{ ...JSON.parse(JSON.stringify(body)), w: w2 }, { ...JSON.parse(JSON.stringify(body)), x: body.x + w2 + gap, w: w2 }]);
        layouts.push(two);
      }
      if (!layouts.some((L) => !L.ph.length)) layouts.push({ ...JSON.parse(JSON.stringify(content)), id: 'Lblank', name: 'Leer', ph: [], derived: 1 });
      const hf = {};
      for (const L of layouts) { if (L.hf.foot && !hf.foot) hf.foot = L.hf.foot.txt; if (L.hf.date && !hf.dateText) hf.dateText = L.hf.date.txt; }
      const stem = String(file.name || 'Vorlage').replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/\bf r\b/g, 'für').trim();
      const name = stem.replace(/\b(PowerPoint|Vorlage|Template|Master)\b/gi, ' ').replace(/\s+/g, ' ').trim() || stem || 'Vorlage';
      return { name: name.slice(0, 120), layouts, title: layouts[0].id, content: content.id, hf };
    }
    const TR = { fade: 'fade', dissolve: 'fade', push: 'push', wipe: 'wipe', split: 'wipe', zoom: 'zoom', cover: 'cover', pull: 'cover', randomBar: 'wipe', morph: 'fade' };
    // Original-Datei auf dem Server ablegen (nebenher), damit Folien später als Bild übernommen werden können
    const srcUp = (async () => {
      if (!file || !file.size || file.size > 150 * 1024 * 1024) return null;
      try {
        const fd = new FormData(); fd.append('file', file, 'praesentation.pptx');
        const r = await fetch(C.API + '?a=pptxput', { method: 'POST', credentials: 'same-origin', headers: { 'X-PDFStift': '1' }, body: fd });
        return r.ok ? (await r.json()).src || null : null;
      } catch (e) { return null; }
    })();
    const slides = [];
    for (let i = 0; i < slideIds.length; i++) {
      progress && progress(`Folie ${i + 1} von ${slideIds.length} wird übernommen …`);
      const sp = slideIds[i];
      const d = xml(sp);
      if (!d) continue;
      const rels = relsOf(sp);
      const layR = relOfType(sp, 'slideLayout');
      const layout = layR ? xml(layR.target) : null;
      const mR = layR && relOfType(layR.target, 'slideMaster');
      const T0m = mR ? themeOf(mR.target) : T0;
      // Farbzuordnung (hell/dunkel) kann ein Layout oder die Folie selbst umdrehen
      const map = { ...T0m.map };
      for (const dd of [layout, d]) { const o = dd && all(dd, 'overrideClrMapping')[0]; if (o) for (const a of o.attributes) map[a.name] = a.value; }
      const T = { ...T0m, map };
      const inkAcc = []; // Freihand dieser Folie (aus PowerPoint-Freihand oder eigenen Strichen)
      const ctx = { T, layout, rels, deckFont, ink: inkAcc };
      const els = [];
      const showMaster = at(d.documentElement, 'showMasterSp') !== '0' && (!layout || at(layout.documentElement, 'showMasterSp') !== '0');
      if (mR && showMaster) for (const e of await deco(mR.target, { T, layout: null, deckFont })) els.push({ ...JSON.parse(JSON.stringify(e)), id: X().uid(), md: 1 });
      if (layR && at(d.documentElement, 'showMasterSp') !== '0') for (const e of await deco(layR.target, { T, layout, deckFont })) els.push({ ...JSON.parse(JSON.stringify(e)), id: X().uid(), md: 1 });
      const tree = all(d, 'spTree')[0];
      const nDeco = els.length;
      if (tree) for (const c of tree.children) await convert(c, { ...ctx, anim: true }, ID, els);
      // Animationen (Eingang): Reihenfolge der Klicks, Art, absatzweise
      const am = animOf(d);
      for (let k = nDeco; k < els.length; k++) {
        const e = els[k];
        const a = am[e._spid] || (e._grp || []).map((g) => am[g]).find(Boolean);
        if (a) { e.an = a.an; e.ao = a.ao; if (a.ap && e.html) e.ap = 1; }
        delete e._spid; delete e._grp;
      }
      // „Automatisch anpassen“: Text, der nicht ins Feld passt, kleiner setzen (wie PowerPoint)
      if (els.some((e) => e._af)) await X().fitReady(deckFont);
      for (const e of els) if (e._af) { if (e.ff) await X().fitReady(e.ff); X().fitBox(e, deckFont); delete e._af; }
      for (const e of els) delete e._af;
      const ranks = [...new Set(els.filter((e) => e.an).map((e) => e.ao))].sort((a, b) => a - b);
      for (const e of els) if (e.an) e.ao = ranks.indexOf(e.ao) + 1;
      // Gruppen-IDs je Folie neu vergeben (Gestaltungselemente werden mehrfach verwendet)
      const gmap = {};
      for (const e of els) if (e.g) e.g = gmap[e.g] || (gmap[e.g] = X().uid());
      const s = { id: X().uid(), els };
      if (inkAcc.length) s.ink = inkAcc;
      const bg = (await bgOfDoc(d, rels, T, sp)) || (layout && (await bgOfDoc(layout, relsOf(layR.target), T, layR.target))) || (T.master && (await bgOfDoc(T.master, relsOf(mR.target), T, mR.target)));
      if (bg && !(bg.bg && !bg.bgGrad && !bg.bgImg && bg.bg === theme.bg)) Object.assign(s, bg);
      else if (!bg && mR && firstMaster && mR.target !== firstMaster.target) { const mb = await bgOfDoc(T.master, relsOf(mR.target), T); if (mb) Object.assign(s, mb); }
      if (at(d.documentElement, 'show') === '0') s.hidden = true;
      const tr = all(d, 'transition')[0];
      if (tr) { const k = [...tr.children].map((n) => TR[n.localName]).find(Boolean); if (k) s.tr = k; }
      const nr = relOfType(sp, 'notesSlide');
      const nd = nr && xml(nr.target);
      if (nd) {
        const body = all(nd, 'sp').find((x) => phType(phOf(x)) === 'body');
        const txt = body ? kids(kid(body, 'txBody'), 'p').map((p) => [...p.children].map((r) => (r.localName === 'br' ? '\n' : r.localName === 'r' || r.localName === 'fld' ? (kid(r, 't') || {}).textContent || '' : '')).join('')).join('\n').trim() : '';
        if (txt) s.notes = txt.slice(0, 20000);
      }
      s.sn = i; // Nummer in der PowerPoint-Datei (für „Folie als Bild übernehmen“)
      slides.push(s);
    }
    let master = null;
    try { progress && progress('Folienmaster wird übernommen …'); master = await buildMaster(theme); } catch (er) { /* ohne Master */ }
    // Vorlagendatei (.potx) ohne Folien: eine Titelfolie aus dem Master
    if (!slides.length && master) { const L0 = master.layouts[0]; slides.push({ id: X().uid(), lay: L0.id, els: L0.ph.map((e) => ({ ...JSON.parse(JSON.stringify(e)), id: X().uid() })) }); }
    if (!slides.length) throw new Error('In dieser PowerPoint-Datei wurden keine Folien gefunden.');
    let title = '';
    const core = xml('docProps/core.xml');
    if (core) title = (all(core, 'title')[0] || {}).textContent || '';
    // Name: der Dateiname (eindeutiger als der oft gleiche Titel aus der Vorlage), sonst der eingetragene Titel
    const stem0 = String(file.name || '').replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
    title = (stem0 && stem0 !== 'x' ? stem0 : title || 'Präsentation').trim().slice(0, 200);
    const deck = { v: 1, w: W, h: H, title, theme, slides };
    // Layouts der Vorlage für „Neue Folie“ (und als eigene Vorlage)
    if (master) deck.master = master;
    // auf das Hochladen der Original-Datei nicht lange warten (große Dateien, langsame Leitung): sonst wird es nachgetragen
    const src = await Promise.race([srcUp, new Promise((r) => setTimeout(() => r(undefined), 1500))]);
    if (src) deck.src = src;
    return { deck, warn, srcUp: src === undefined ? srcUp : null };
  }

  // ================================================================== Speichern als .pptx
  let libP = null;
  function lib() {
    if (window.PptxGenJS) return Promise.resolve(window.PptxGenJS);
    libP = libP || new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'vendor/pptxgen.bundle.js?v=' + C.VERSION; sc.onload = () => res(window.PptxGenJS); sc.onerror = () => { libP = null; rej(new Error('PowerPoint-Baustein konnte nicht geladen werden.')); }; document.head.appendChild(sc); });
    return libP;
  }
  const noHash = (c) => String(c || '#000000').replace('#', '').toUpperCase();
  const toHex = (c) => {
    c = String(c || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(c)) return c.slice(1).toUpperCase();
    if (/^#[0-9a-f]{3}$/i.test(c)) return c.slice(1).split('').map((x) => x + x).join('').toUpperCase();
    const m = c.match(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/);
    if (m) return [m[1], m[2], m[3]].map((v) => hex2(+v)).join('').toUpperCase();
    return '000000';
  };
  const blobToData = (b) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(b); });
  async function svgToPng(svg, w, h, scale = 2) {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const c = document.createElement('canvas'); c.width = Math.round(w * scale); c.height = Math.round(h * scale);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    } finally { URL.revokeObjectURL(url); }
  }
  // HTML eines Textfelds → Textstücke für PowerPoint (Absätze, Listen, Ausrichtung, Formatierung)
  function runsOf(html, o) {
    const t = document.createElement('template');
    t.innerHTML = X().clean(html || '');
    const paras = [];
    let cur = null;
    let U = 0; // Einheiten für „absatzweise“ (wie in PDF-Stift: oberste Absätze und Aufzählungspunkte)
    const maths = []; // Formeln im Fließtext: Platzhalter „⁣n⁣“, später durch echte Formeln ersetzt
    const np = (blk) => { cur = { al: blk.al || '', list: blk.list || null, lvl: blk.lvl || 0, numT: blk.numT || '', numS: blk.numS || 0, runs: [], unit: blk.unit || ++U }; paras.push(cur); return cur; };
    const walk = (n, st, blk) => {
      for (const k of [...n.childNodes]) {
        if (k.nodeType === 3) {
          const tx = k.nodeValue.replace(/ /g, ' ').replace(/[\r\n\t]+/g, ' ');
          if (!tx) continue;
          if (!cur) np(blk);
          cur.runs.push({ t: tx, st });
          continue;
        }
        if (k.nodeType !== 1) continue;
        const tag = k.tagName.toLowerCase();
        if (tag === 'ul' || tag === 'ol') { cur = null; walk(k, st, { ...blk, list: tag, lvl: blk.list ? blk.lvl + 1 : 0, ...(tag === 'ol' ? { numT: NUM_T.test(k.getAttribute('data-n') || '') ? k.getAttribute('data-n') : '', numS: +k.getAttribute('start') || 0 } : {}) }); cur = null; continue; }
        if (tag === 'li' || tag === 'div' || tag === 'p') {
          const al = (k.style && k.style.textAlign) || blk.al || '';
          const unit = blk.unit || ++U;
          const spOf = (q) => {
            if (k.style && (k.style.paddingTop || k.style.paddingBottom)) { q.sb = parseFloat(k.style.paddingTop) || 0; q.sa = parseFloat(k.style.paddingBottom) || 0; }
            if (k.getAttribute && k.getAttribute('data-bi') != null && k.getAttribute('data-bi') !== '') { q.bi = parseFloat(k.getAttribute('data-bi')) || 0; q.ml = parseFloat(k.style.marginLeft) || 0; }
            if (tag !== 'li' && k.style && (k.style.paddingLeft || k.style.textIndent)) { q.pl = parseFloat(k.style.paddingLeft) || 0; q.ti = parseFloat(k.style.textIndent) || 0; }
            if (k.style && /^[\d.]+$/.test(k.style.lineHeight || '')) q.lh = parseFloat(k.style.lineHeight);
            return q;
          };
          if (tag === 'li') { const q = spOf(np({ ...blk, al, unit })); if (k.getAttribute('data-bu')) q.bu = k.getAttribute('data-bu'); q.bc = k.getAttribute('data-bc') || ''; walk(k, st, { ...blk, al, inLi: 1, unit }); cur = null; continue; }
          if (blk.inLi && cur && !cur.runs.length) { cur.al = al; walk(k, st, { ...blk, al }); continue; }
          spOf(np({ ...blk, al, unit })); walk(k, st, { ...blk, al, unit }); cur = null; continue;
        }
        if (tag === 'br') { if (!cur) np(blk); else if (cur.runs.length) np(blk); else cur.br = 1; continue; }
        if (tag === 'span' && k.classList.contains('dk-im')) {
          if (!cur) np(blk);
          const tx = k.getAttribute('data-tex') || '';
          if (o && o.im) { cur.runs.push({ t: '\u2063' + maths.length + '\u2063', st }); maths.push(tx); } else cur.runs.push({ t: texLinear(tx), st });
          continue;
        }
        const s2 = { ...st };
        if (tag === 'b') s2.b = 1; else if (tag === 'i') s2.i = 1; else if (tag === 'u') s2.u = 1; else if (tag === 's') s2.s = 1;
        else if (tag === 'sup') s2.sup = 1; else if (tag === 'sub') s2.sub = 1;
        else if (tag === 'a') s2.href = k.getAttribute('href');
        else if (tag === 'span') { if (k.style.color) s2.c = toHex(k.style.color); if (k.style.backgroundColor) s2.hi = toHex(k.style.backgroundColor); if (/em$/.test(k.style.fontSize || '')) s2.z = (st.z || 1) * (parseFloat(k.style.fontSize) || 1); }
        walk(k, s2, blk);
      }
    };
    walk(t.content, {}, {});
    if (!paras.length) return Object.assign([{ text: '', options: {} }], { units: [] });
    // Absatzbereiche je Einheit (nur Einheiten mit Text, wie beim Vortrag in PDF-Stift)
    const unitR = new Map();
    paras.forEach((p, i) => { const r = unitR.get(p.unit) || { st: i, en: i, txt: false }; r.en = i; if (p.runs.some((x) => x.t.trim())) r.txt = true; unitR.set(p.unit, r); });
    const AL = { center: 'center', right: 'right', justify: 'justify' };
    const out = [], fixes = [];
    paras.forEach((p, pi) => {
      const po = { align: AL[p.al] || 'left' };
      if (p.list) { po.bullet = p.list === 'ol' ? { type: 'number', ...(p.numT ? { style: p.numT } : {}), ...(p.numS > 1 ? { startAt: p.numS } : {}) } : p.bu ? { characterCode: p.bu.codePointAt(0).toString(16).toUpperCase().padStart(4, '0') } : true; if (p.lvl) po.indentLevel = p.lvl; }
      const pfs = (o && o.fs) || 18;
      if (p.lh) po.lineSpacingMultiple = Math.round((p.lh / 1.2) * 100) / 100;
      // was der PowerPoint-Baustein nicht kann, wird danach in die Folien-XML geschrieben: Einzüge (pt) und Farbe des Zeichens
      const fx = {};
      if (p.bi != null && (p.list === 'ul' || p.list === 'ol')) { const m = (p.ml || 0) + 1.2 * ((p.lvl || 0) + 1); fx.marL = m * pfs; fx.ind = (p.bi || 0) * pfs; }
      else if (!p.list && (p.pl || p.ti)) { fx.marL = (p.pl || 0) * pfs; fx.ind = (p.ti || 0) * pfs; }
      if (p.list === 'ul' && p.bc) fx.bc = toHex(p.bc);
      fixes[pi] = Object.keys(fx).length ? fx : null;
      if (p.sb) po.paraSpaceBefore = Math.round(p.sb * pfs * 10) / 10;
      if (p.sa) po.paraSpaceAfter = Math.round(p.sa * pfs * 10) / 10;
      const runs = p.runs.length ? p.runs : [{ t: '', st: {} }];
      runs.forEach((r, ri) => {
        const op = { ...po };
        if (r.st.b) op.bold = true; if (r.st.i) op.italic = true; if (r.st.u) op.underline = { style: 'sng' }; if (r.st.s) op.strike = 'sngStrike';
        if (r.st.sup) op.superscript = true; if (r.st.sub) op.subscript = true;
        if (r.st.c) op.color = r.st.c; else if (o && o.color) op.color = o.color;
        if (r.st.hi) op.highlight = r.st.hi;
        if (r.st.z && o && o.fs) op.fontSize = Math.round(o.fs * r.st.z * 10) / 10;
        if (r.st.href) { op.hyperlink = { url: r.st.href }; if (!r.st.c) op.color = '1F4FD6'; op.underline = { style: 'sng' }; }
        if (ri === runs.length - 1 && pi < paras.length - 1) op.breakLine = true;
        out.push({ text: r.t, options: op });
      });
    });
    out.units = [...unitR.values()].filter((r) => r.txt || paras[r.st].list).map((r) => [r.st, r.en]);
    out.fix = fixes.some(Boolean) ? fixes : null;
    out.maths = maths.length ? maths : null;
    return out;
  }
  // Absätze im Text einer Form nachbessern: Einzüge (marL/indent) und Farbe des Aufzählungszeichens
  function fixParas(xml, fixes) {
    if (!fixes) return xml;
    let j = -1;
    return xml.replace(/<a:p>(<a:pPr\b[^>]*?(\/?)>)?/g, (m, pPr, selfClose) => {
      j++;
      const f = fixes[j];
      if (!f) return m;
      let tag = pPr || '<a:pPr>';
      if (f.marL != null) {
        const set = (t, n, v) => (new RegExp(`\\s${n}="[^"]*"`).test(t) ? t.replace(new RegExp(`\\s${n}="[^"]*"`), ` ${n}="${v}"`) : t.replace(/^<a:pPr/, `<a:pPr ${n}="${v}"`));
        tag = set(tag, 'marL', Math.round(Math.max(0, f.marL) * 12700));
        tag = set(tag, 'indent', Math.round(f.ind * 12700));
      }
      if (selfClose) tag = tag.replace(/\s*\/>$/, '></a:pPr>');
      else if (!pPr) tag += '</a:pPr>';
      return '<a:p>' + tag + (f.bc ? `<!--BC:${f.bc}-->` : '');
    }).replace(/(<a:pPr\b[^>]*>)<!--BC:([0-9A-F]{6})-->((?:(?!<\/a:pPr>).)*?)<\/a:pPr>/g, (m, open, bc, inner) => {
      // Farbe vor die übrigen Angaben zum Zeichen (Reihenfolge laut Schema)
      const i = inner.search(/<a:bu(Sz|Font|Char|AutoNum|None|Blip)/);
      return i < 0 ? open + inner + '</a:pPr>' : open + inner.slice(0, i) + `<a:buClr><a:srgbClr val="${bc}"/></a:buClr>` + inner.slice(i) + '</a:pPr>';
    }).replace(/<!--BC:[0-9A-F]{6}-->/g, '');
  }
  const SHAPE_P = {
    rect: 'rect', round: 'roundRect', ellipse: 'ellipse', tri: 'triangle', rtri: 'rtTriangle', diamond: 'diamond', pent: 'pentagon', hex: 'hexagon', oct: 'octagon', para: 'parallelogram', trap: 'trapezoid',
    plus: 'plus', heart: 'heart', cloud: 'cloud', arrowR: 'rightArrow', arrowL: 'leftArrow', arrowU: 'upArrow', arrowD: 'downArrow', arrowLR: 'leftRightArrow', chevron: 'chevron', home: 'homePlate',
    star5: 'star5', star8: 'star8', callout: 'wedgeRectCallout', calloutR: 'wedgeRoundRectCallout', brackL: 'leftBracket', brackR: 'rightBracket', braceL: 'leftBrace', braceR: 'rightBrace', arc: 'arc', elbow: 'bentConnector3',
  };
  async function exportPptx(deck, opt = {}) {
    const P = X();
    const Pptx = await lib();
    const th = { ...P.DEF_TH, ...(deck.theme || {}) };
    const H = P.slideH(th), W = P.W, IN = 72;
    const pres = new Pptx();
    pres.defineLayout({ name: 'PDFSTIFT', width: W / IN, height: H / IN });
    pres.layout = 'PDFSTIFT';
    pres.title = deck.title || 'Präsentation';
    pres.company = '';
    const baseFont = P.fontOffice(th.font);
    pres.theme = { headFontFace: baseFont, bodyFontFace: baseFont };
    const imgCache = {};
    const imgData = (src) => (imgCache[src] = imgCache[src] || fetch(P.imgUrl(src), { credentials: 'same-origin' }).then((r) => { if (!r.ok) throw new Error('Bild'); return r.blob(); }).then(blobToData));
    const inch = (v) => Math.round((v / IN) * 10000) / 10000;
    const VA = { t: 'top', m: 'middle', b: 'bottom' };
    const LINE_K = ['line', 'arrow', 'arrow2'], OPEN_K = ['elbow', 'brackL', 'brackR', 'braceL', 'braceR', 'arc'];
    let skipped = 0;
    // Animationen: Objekte bekommen einen Namen, über den sie danach in der Folien-XML gefunden werden
    const AN = deck.slides.map(() => []);
    let curAn = null;
    const FX = deck.slides.map(() => []); // nachträgliche Korrekturen je Folie: { id, fix } bzw. { id, cells }
    let curFx = null;
    const nm = (e) => (e.an || e.gr || (e._fx && e._fx.length) ? { objectName: 'ps-' + e.id } : {});
    const GR = deck.slides.map((s0) => s0.els.filter((e) => e.gr && e.k === 'path' && e.fill));
    const mark = (e, units) => { if (e.an && curAn) curAn.push({ e, units: units || null }); };
    for (let si = 0; si < deck.slides.length; si++) {
      const s = deck.slides[si];
      curAn = AN[si]; curFx = FX[si];
      opt.progress && opt.progress(`Folie ${si + 1} von ${deck.slides.length} …`);
      const sl = pres.addSlide();
      if (s.hidden) sl.hidden = true;
      const bg = P.bgOf(s, th);
      try {
        if (bg.img) sl.background = { data: await imgData(bg.img) };
        else if (bg.grad) {
          const dir = { v: [0, 0, 0, H], h: [0, 0, W, 0], d: [0, 0, W, H] }[bg.grad.dir] || [0, 0, 0, H];
          sl.background = { data: await svgToPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="${dir[0]}" y1="${dir[1]}" x2="${dir[2]}" y2="${dir[3]}"><stop offset="0" stop-color="${esc(bg.grad.a)}"/><stop offset="1" stop-color="${esc(bg.grad.b)}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`, W, H, 1) };
        } else sl.background = { color: toHex(bg.color) };
      } catch (e) { sl.background = { color: toHex(bg.color || '#FFFFFF') }; }
      const els = [...(opt.under ? opt.under(si) : []), ...(opt.els ? opt.els(s) : s.els).filter((e) => !P.isPh(e)), ...(opt.hf ? opt.hf(si) : [])];
      for (let e of els) {
        try {
          const boxO = { x: inch(e.x), y: inch(e.y), w: inch(e.w), h: inch(e.h) };
          if (e.r) boxO.rotate = e.r;
          const shadow = e.sh ? { type: 'outer', blur: 3, offset: 3, angle: 45, color: '000000', opacity: 0.35 } : undefined;
          const tr = e.op != null && e.op < 1 ? Math.round((1 - e.op) * 100) : 0;
          const face = e.ff ? P.fontOffice(e.ff) : baseFont;
          if (e.t === 'text') {
            const o = { ...boxO, fontFace: face, fontSize: e.fs || 24, color: noHash(e.c || th.fg), valign: VA[e.va || 't'], margin: e.pad != null ? e.pad : 8, fit: 'none', shadow };
            if (e.fill) o.fill = { color: noHash(e.fill), transparency: (e.fo != null ? Math.round((1 - e.fo) * 100) : tr) || undefined };
            if (e.line) o.line = { color: noHash(e.line), width: e.lw || 2 };
            if (e.lh) o.lineSpacingMultiple = Math.round((e.lh / 1.2) * 100) / 100;
            const rr = runsOf(e.html, { color: noHash(e.c || th.fg), fs: e.fs || 24, im: 1 }); mark(e, rr.units);
            if (rr.fix) { e = { ...e, _fx: [1] }; curFx.push({ id: e.id, fix: rr.fix }); }
            if (rr.maths) { e = { ...e, _fx: [1] }; curFx.push({ id: e.id, inline: await Promise.all(rr.maths.map((t) => P.texOmml(t).catch(() => null))), tex: rr.maths }); }
            if (e.warp) { e = { ...e, _fx: [1] }; curFx.push({ id: e.id, warp: e.warp }); } // Text auf einem Bogen
            sl.addText(rr, { ...o, ...nm(e) });
          } else if (e.t === 'shape') {
            const lineK = LINE_K.includes(e.k), openK = OPEN_K.includes(e.k);
            if (lineK) {
              mark(e); sl.addShape('line', { ...nm(e), x: inch(e.x), y: inch(e.y + e.h / 2), w: inch(e.w), h: 0, rotate: e.r || 0, shadow, line: { color: noHash(e.line || th.fg), width: e.lw || 3, transparency: tr || undefined, endArrowType: e.k !== 'line' ? 'triangle' : undefined, beginArrowType: e.k === 'arrow2' ? 'triangle' : undefined } });
              continue;
            }
            const o = { ...boxO, shape: SHAPE_P[e.k] || 'rect', shadow, flipH: !!e.fx, flipV: !!e.fy };
            if (e.k === 'path' && (e.d || e.ds)) {
              // freie Form zurück als PowerPoint-Pfad (Punkte in Zoll, bezogen auf das Objekt)
              const sx = e.w / 1000 / IN, sy = e.h / 1000 / IN, pts = [];
              for (const m of (String(e.d || '') + (e.fill ? '' : String(e.ds || ''))).matchAll(/([MLCQZ])([^MLCQZ]*)/g)) {
                const v = (m[2].match(/-?\d*\.?\d+/g) || []).map(Number), P = (i) => [v[i] * sx, v[i + 1] * sy];
                if (m[1] === 'M') { const [x, y] = P(0); pts.push({ x, y, moveTo: true }); }
                else if (m[1] === 'L') { for (let i = 0; i + 1 < v.length; i += 2) { const [x, y] = P(i); pts.push({ x, y }); } }
                else if (m[1] === 'C') { for (let i = 0; i + 5 < v.length; i += 6) { const [x1, y1] = P(i), [x2, y2] = P(i + 2), [x, y] = P(i + 4); pts.push({ x, y, curve: { type: 'cubic', x1, y1, x2, y2 } }); } }
                else if (m[1] === 'Q') { for (let i = 0; i + 3 < v.length; i += 4) { const [x1, y1] = P(i), [x, y] = P(i + 2); pts.push({ x, y, curve: { type: 'quadratic', x1, y1 } }); } }
                else if (m[1] === 'Z') pts.push({ close: true });
              }
              o.shape = 'custGeom'; o.points = pts;
            }
            if (openK) { o.fill = { type: 'none' }; o.line = { color: noHash(e.line || th.fg), width: e.lw || 2 }; if (e.k === 'elbow' && e.head !== 0) o.line.endArrowType = 'triangle'; }
            else {
              const ftr = e.fo != null ? Math.round((1 - e.fo * (e.op != null ? e.op : 1)) * 100) : tr;
              o.fill = e.fill ? { color: noHash(e.fill), transparency: ftr || undefined } : { type: 'none' };
              o.line = e.line ? { color: noHash(e.line), width: e.lw || 2 } : { type: 'none' };
              if (e.line && e.ah) { if (/[eb]/.test(e.ah)) o.line.endArrowType = 'triangle'; if (/[sb]/.test(e.ah)) o.line.beginArrowType = 'triangle'; }
            }
            if (e.html && !openK) {
              Object.assign(o, { fontFace: face, fontSize: e.fs || 20, color: noHash(e.c || (e.fill ? '#FFFFFF' : th.fg)), valign: VA[e.va || 'm'], margin: e.pad != null ? e.pad : 8, align: 'center' });
              const rr = runsOf(e.html, { color: o.color, fs: e.fs || 20, im: 1 }); mark(e, rr.units);
              if (rr.fix) { e = { ...e, _fx: [1] }; curFx.push({ id: e.id, fix: rr.fix }); }
              if (rr.maths) { e = { ...e, _fx: [1] }; curFx.push({ id: e.id, inline: await Promise.all(rr.maths.map((t) => P.texOmml(t).catch(() => null))), tex: rr.maths }); }
              sl.addText(rr, { ...o, ...nm(e) });
            } else { mark(e); sl.addText('', { ...o, ...nm(e) }); }
          } else if (e.t === 'img') {
            const o = { ...boxO, data: await imgData(e.src), flipH: !!e.fx, flipV: !!e.fy, shadow };
            if (tr) o.transparency = tr;
            let vidData = null;
            if (e.vid) { try { const r = await fetch(P.mediaUrl(e.vid), { credentials: 'same-origin' }); if (r.ok) vidData = await blobToData(await r.blob()); } catch (er) { /* nur Vorschaubild */ } }
            if (vidData) {
              const ext = e.vid.split('.').pop();
              sl.addMedia({ ...boxO, type: /^(mp3|m4a|wav)$/.test(ext) ? 'audio' : 'video', data: vidData, extn: ext, cover: o.data });
            } else { mark(e); sl.addImage({ ...o, ...nm(e) }); }
          } else if (e.t === 'table') {
            const n = e.rows[0] ? e.rows[0].length : 1;
            const cw = e.cw || e.rows[0].map(() => 1 / n);
            const MG = P.mergeMap(e), cellFx = {};
            const rows = e.rows.map((row, ri) => row.map((cell, ci) => {
              if (MG.hid.has(ri + ',' + ci)) return null;
              const sp = MG.span[ri + ',' + ci];
              const head = ri === 0 && e.head, cs = (e.cs && e.cs[ri + ',' + ci]) || {};
              const color = cs.c ? noHash(cs.c) : head ? 'FFFFFF' : noHash(th.fg);
              const fillC = cs.f || (head ? th.accent : null);
              const options = { color, fill: fillC ? { color: noHash(fillC) } : undefined, bold: head || cs.b ? true : undefined };
              if (sp) { if (sp[0] > 1) options.rowspan = sp[0]; if (sp[1] > 1) options.colspan = sp[1]; }
              const vv = cs.v || e.va; if (vv) options.valign = { t: 'top', m: 'middle', b: 'bottom' }[vv];
              const rr = runsOf(cell, { color, fs: e.fs || 18 });
              if (rr.fix || cs.vt) cellFx[ri + ',' + ci] = { fix: rr.fix, vt: cs.vt };
              return { text: rr, options };
            }).filter(Boolean));
            if (Object.keys(cellFx).length) { e = { ...e, _fx: [1] }; curFx.push({ id: e.id, cells: cellFx, cols: n }); }
            mark(e); sl.addTable(rows, { ...nm(e), x: inch(e.x), y: inch(e.y), w: inch(e.w), colW: cw.map((f) => inch(f * e.w)), rowH: P.tblRows(e, true).map((f) => inch(f * e.h)), fontFace: face, fontSize: e.fs || 18, valign: 'middle', border: { type: 'solid', pt: 1, color: noHash(e.line || '#868E96') }, margin: e.cm ? [e.cm[0], e.cm[1], e.cm[0], e.cm[1]] : Math.max(1, Math.round((e.fs || 18) / 3)) });
          } else if (e.t === 'math') {
            // Formel: in PowerPoint als echte Formel (änderbar), für ältere Programme ein Bild als Ersatz
            const png = await svgToPng(P.mathSvgDoc(e, th), Math.max(1, e.w), Math.max(1, e.h), 4);
            let om = null;
            try { om = e.tex ? await P.texOmml(e.tex) : null; } catch (er) { om = null; }
            if (om) { e = { ...e, _fx: [1] }; curFx.push({ id: e.id, math: om, fs: P.mathFs(e), c: e.c || th.fg }); }
            mark(e); sl.addImage({ ...boxO, data: png, altText: 'LaTeX: ' + (e.tex || ''), ...(tr ? { transparency: tr } : {}), ...nm(e) });
          } else if (e.t === 'chart') {
            const T = { col: 'bar', bar: 'bar', line: 'line', pie: 'pie' }[e.ct] || 'bar';
            const ser = (e.series || []).filter((x) => x && Array.isArray(x.v));
            const data = (e.ct === 'pie' ? ser.slice(0, 1) : ser).map((x) => ({ name: x.n || '', labels: (e.labels || []).map(String), values: x.v.map((v) => +v || 0) }));
            if (!data.length) continue;
            const fs = e.fs || 14;
            const o = { ...boxO, chartColors: P.chartColors(th).map(noHash), showLegend: e.legend !== 0 && (e.ct === 'pie' || data.length > 1), legendPos: 'b', legendFontSize: fs, catAxisLabelFontSize: fs, valAxisLabelFontSize: fs, showTitle: !!e.title, title: e.title || '', titleFontSize: Math.round(fs * 1.25) };
            if (T === 'bar') o.barDir = e.ct === 'bar' ? 'bar' : 'col';
            if (e.ct === 'bar') o.catAxisOrientation = 'maxMin'; // erste Kategorie oben, wie in der Vorschau
            if (T === 'bar' && e.st) { o.barGrouping = e.st === 'p' ? 'percentStacked' : 'stacked'; o.barGapWidthPct = e.gw != null ? e.gw : 150; }
            if (e.lp) o.legendPos = e.lp;
            if (e.lr) o.catAxisLabelRotate = e.lr;
            if (e.ct !== 'pie') o.chartColors = o.chartColors.map((c, i) => (ser[i] && ser[i].c ? noHash(ser[i].c) : c));
            else if (Array.isArray(e.pc) && e.pc.length) o.chartColors = e.pc.map(noHash);
            if (e.vmin != null) o.valAxisMinVal = e.vmin;
            if (e.vmax != null) o.valAxisMaxVal = e.vmax;
            const nf = e.pct ? '0' + (e.dp ? '.' + '0'.repeat(e.dp) : '') + '%' : e.dp != null ? '#,##0' + (e.dp ? '.' + '0'.repeat(e.dp) : '') : null;
            if (e.pct || e.st === 'p') o.valAxisLabelFormatCode = '0%';
            if (e.dl || ser.some((x) => x.dl)) { o.showValue = true; o.dataLabelFontSize = Math.round(fs * 0.85); if (nf) o.dataLabelFormatCode = nf; if ((e.ct === 'bar' || e.ct === 'col') && !e.st) o.dataLabelPosition = 'outEnd'; }
            if (e.mk === 0) o.lineDataSymbol = 'none';
            if (e.tc) { o.catAxisLabelColor = noHash(e.tc); o.valAxisLabelColor = noHash(e.tc); o.legendColor = noHash(e.tc); }
            if (e.bg) o.fill = noHash(e.bg);
            delete o.rotate;
            const li = T === 'bar' ? ser.map((x, k) => (x.t === 'line' ? k : -1)).filter((k) => k >= 0) : [];
            if (li.length && li.length < ser.length) {
              // Säulen mit Linien/Punkten darüber: ein Diagramm aus zwei Arten
              const bi = ser.map((_, k) => k).filter((k) => !li.includes(k));
              const cc = o.chartColors;
              const lineOpts = { chartColors: li.map((k) => cc[k % cc.length]), lineDataSymbol: 'circle', lineDataSymbolSize: 7 };
              if (li.every((k) => ser[k].nl)) lineOpts.lineSize = 0;
              mark(e); sl.addChart([{ type: 'bar', data: bi.map((k) => data[k]), options: { barDir: o.barDir, barGrouping: o.barGrouping, chartColors: bi.map((k) => cc[k % cc.length]) } }, { type: 'line', data: li.map((k) => data[k]), options: lineOpts }], { ...o, ...nm(e) });
            } else { mark(e); sl.addChart(T, data, { ...o, ...nm(e) }); }
          }
        } catch (err) { skipped++; }
      }
      // Freihand: jeder Strich als freie Linie (in PowerPoint einzeln verschieb- und löschbar), Textmarker halb durchsichtig
      for (const k of s.ink || []) {
        try {
          const p = k.p || [];
          if (p.length < 2) continue;
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (let i = 0; i + 1 < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
          const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
          const pts = [];
          for (let i = 0; i + 1 < p.length; i += 2) pts.push({ x: (p[i] - x0) / IN, y: (p[i + 1] - y0) / IN, ...(i ? {} : { moveTo: true }) });
          if (pts.length === 1) pts.push({ x: pts[0].x + 0.001, y: pts[0].y });
          sl.addText('', { objectName: k.hl ? 'ink-hl' : 'ink', x: x0 / IN, y: y0 / IN, w: bw / IN, h: bh / IN, shape: 'custGeom', points: pts, fill: { type: 'none' }, line: { color: noHash(k.c || '#1A1A1A'), width: Math.max(0.25, k.pr && k.pr.length ? (k.w || 2) * (0.6 + 0.8 * k.pr.reduce((a, b) => a + b, 0) / k.pr.length) : k.w || 2), ...(k.hl ? { transparency: 62 } : {}) }, lineCap: 'round' });
        } catch (err) { skipped++; }
      }
      if (s.notes) sl.addNotes(s.notes);
    }
    let bin = new Uint8Array(await pres.write({ outputType: 'arraybuffer' }));
    // Übergänge und Animationen nachtragen (der PowerPoint-Baustein kann beides nicht selbst)
    if (deck.slides.some((s) => s.tr) || AN.some((a) => a.length) || GR.some((a) => a.length) || FX.some((a) => a.length)) {
      const z = window.fflate.unzipSync(bin);
      deck.slides.forEach((s, i) => {
        const pth = `ppt/slides/slide${i + 1}.xml`;
        if (!z[pth]) return;
        let x = window.fflate.strFromU8(z[pth]);
        // Farbverläufe: die einfarbige Füllung der Form durch den Verlauf ersetzen
        for (const e of GR[i]) {
          const at0 = x.indexOf(`name="ps-${e.id}"`);
          if (at0 < 0) continue;
          const sp0 = x.indexOf('<p:spPr', at0), sp1 = x.indexOf('</p:spPr>', sp0);
          if (sp0 < 0 || sp1 < 0) continue;
          const seg = x.slice(sp0, sp1);
          const f0 = seg.indexOf('<a:solidFill>'), f1 = seg.indexOf('</a:solidFill>', f0);
          if (f0 < 0 || f1 < 0) continue;
          const gs = e.gr.s.map(([p0, c0, a0]) => `<a:gs pos="${Math.round(p0 * 100000)}"><a:srgbClr val="${String(c0).replace('#', '').toUpperCase()}">${a0 != null && a0 < 1 ? `<a:alpha val="${Math.round(a0 * 100000)}"/>` : ''}</a:srgbClr></a:gs>`).join('');
          const gx = `<a:gradFill rotWithShape="1"><a:gsLst>${gs}</a:gsLst>${e.gr.rad ? '<a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>' : `<a:lin ang="${Math.round((e.gr.ang || 0) * 60000)}" scaled="0"/>`}</a:gradFill>`;
          x = x.slice(0, sp0) + seg.slice(0, f0) + gx + seg.slice(f1 + '</a:solidFill>'.length) + x.slice(sp1);
        }
        // Absätze (Einzüge, Zeichenfarbe) und senkrechter Text in Tabellenzellen
        for (const f of FX[i]) {
          const at0 = x.indexOf(`name="ps-${f.id}"`);
          if (at0 < 0) continue;
          if (f.math) { x = mathXml(x, at0, f); continue; }
          if (f.inline) { x = inlineXml(x, at0, f); continue; }
          if (f.warp) {
            // WordArt-Bogen in die Textfeld-Eigenschaften (erstes Kind von bodyPr)
            const b0 = x.indexOf('<a:bodyPr', at0), spEnd = x.indexOf('</p:sp>', at0);
            if (b0 < 0 || (spEnd >= 0 && b0 > spEnd)) continue;
            const b1 = x.indexOf('>', b0);
            const wx = `<a:prstTxWarp prst="${f.warp.k === 'down' ? 'textArchDown' : 'textArchUp'}"><a:avLst><a:gd name="adj" fmla="val ${Math.round((((+f.warp.a || 0) % 360) + 360) % 360 * 60000)}"/></a:avLst></a:prstTxWarp>`;
            x = x[b1 - 1] === '/' ? x.slice(0, b1 - 1) + '>' + wx + '</a:bodyPr>' + x.slice(b1 + 1) : x.slice(0, b1 + 1) + wx + x.slice(b1 + 1);
            continue;
          }
          const endTag = f.cells ? '</p:graphicFrame>' : '</p:sp>';
          const end = x.indexOf(endTag, at0);
          if (end < 0) continue;
          let seg = x.slice(at0, end);
          if (f.fix) seg = fixParas(seg, f.fix);
          else {
            // Zellen in Rasterreihenfolge (auch die verbundenen Platzhalterzellen stehen im XML)
            let k = -1;
            seg = seg.replace(/<a:tc\b[^>]*>[\s\S]*?<\/a:tc>/g, (tc) => {
              k++;
              const c = f.cells[Math.floor(k / f.cols) + ',' + (k % f.cols)];
              if (!c) return tc;
              let t = c.fix ? fixParas(tc, c.fix) : tc;
              if (c.vt) t = /<a:tcPr\b/.test(t) ? t.replace(/<a:tcPr\b/, `<a:tcPr vert="${c.vt === 'u' ? 'vert270' : 'vert'}"`) : t.replace('</a:tc>', `<a:tcPr vert="${c.vt === 'u' ? 'vert270' : 'vert'}"/></a:tc>`);
              return t;
            });
          }
          x = x.slice(0, at0) + seg + x.slice(end);
        }
        const add = transXml(s.tr) + timingXml(x, s, AN[i]);
        z[pth] = window.fflate.strToU8(!add ? x : x.includes('</p:clrMapOvr>') ? x.replace('</p:clrMapOvr>', '</p:clrMapOvr>' + add) : x.replace('</p:sld>', add + '</p:sld>'));
      });
      bin = window.fflate.zipSync(z, { level: 6 });
    }
    const blob = new Blob([bin], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    return { blob, skipped };
  }

  // ---- Formel-Läufe im Aussehen des Texts: Schriftgröße (pt), Farbe, Cambria Math; Buchstaben kursiv, Zahlen und Namen gerade
  function omStyle(om, szPt, clr) {
    const sz = Math.max(100, Math.round(szPt) * 100);
    const rpr = `<a:rPr lang="de-DE" sz="${sz}" b="0" i="0"><a:solidFill><a:srgbClr val="${clr}"/></a:solidFill><a:latin typeface="Cambria Math" panose="02040503050406030204" pitchFamily="18" charset="0"/></a:rPr>`;
    return om.replace(/<m:r>(<m:rPr>[\s\S]*?<\/m:rPr>)?(<m:t\b[^>]*>)([^<]*)/g, (all, rp, tt, tx) => '<m:r>' + (rp || '') + (!/m:sty m:val="[pb]"/.test(rp || '') && /^[A-Za-zα-ω]+$/.test(tx) ? rpr.replace(' i="0"', ' i="1"') : rpr) + tt + tx)
      .replace(/<m:ctrlPr\/>/g, `<m:ctrlPr>${rpr.replace(' b="0" i="0"', ' i="1"')}</m:ctrlPr>`);
  }
  // LaTeX grob als lesbarer Text (Ersatz für Programme ohne Formeln)
  function texLinear(t) {
    let s = String(t || '');
    for (let i = 0; i < 4; i++) s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)').replace(/\\sqrt\{([^{}]*)\}/g, '√($1)');
    const SY = { cdot: '·', times: '×', div: '÷', pm: '±', le: '≤', ge: '≥', ne: '≠', approx: '≈', to: '→', infty: '∞', sum: '∑', prod: '∏', int: '∫', partial: '∂', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', varepsilon: 'ε', epsilon: 'ε', lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', varphi: 'φ', phi: 'φ', omega: 'ω', Delta: 'Δ', Sigma: 'Σ', Omega: 'Ω', euro: '€' };
    s = s.replace(/\\([A-Za-z]+) ?/g, (m, n) => SY[n] || (/^(left|right|mathrm|text|mathbf|operatorname|begin|end|aligned|gathered)$/.test(n) ? '' : n));
    return s.replace(/\^\{([^{}]*)\}/g, '^$1').replace(/_\{([^{}]*)\}/g, '_$1').replace(/[{}&]/g, '').replace(/\\\\/g, '; ').replace(/\\[,;:!]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  // ---- Formeln im Fließtext: Form mit echten Formeln (PowerPoint), daneben dieselbe Form mit lesbarem Text (andere Programme)
  function inlineXml(x, at0, f) {
    const p0 = x.lastIndexOf('<p:sp>', at0), p1 = x.indexOf('</p:sp>', at0);
    if (p0 < 0 || p1 < 0) return x;
    const sp = x.slice(p0, p1 + 7);
    const RE = /<a:r>((?:(?!<\/a:r>)[\s\S])*?)<a:t>\u2063(\d+)\u2063<\/a:t><\/a:r>/g;
    const rprOf = (pre) => { const sz = /\bsz="(\d+)"/.exec(pre), c = /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(pre); return [sz ? +sz[1] / 100 : 18, c ? c[1].toUpperCase() : '000000']; };
    const choice = sp.replace(RE, (m, pre, i) => { const om = f.inline[+i]; if (!om) return `<a:r>${pre}<a:t>${xmlEsc(texLinear(f.tex[+i]))}</a:t></a:r>`; const [sz, c] = rprOf(pre); return `<a14:m>${omStyle(om, sz, c)}</a14:m>`; });
    const fb = sp.replace(RE, (m, pre, i) => `<a:r>${pre}<a:t>${xmlEsc(texLinear(f.tex[+i]))}</a:t></a:r>`);
    const alt = `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" Requires="a14">${choice}</mc:Choice><mc:Fallback>${fb}</mc:Fallback></mc:AlternateContent>`;
    return x.slice(0, p0) + alt + x.slice(p1 + 7);
  }
  const xmlEsc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // ---- Formel: das Ersatzbild in eine Wahlmöglichkeit einpacken (PowerPoint nimmt die echte Formel, andere das Bild)
  function mathXml(x, at0, f) {
    const p0 = x.lastIndexOf('<p:pic>', at0), p1 = x.indexOf('</p:pic>', at0);
    if (p0 < 0 || p1 < 0) return x;
    const pic = x.slice(p0, p1 + 8);
    const id = (/<p:cNvPr id="(\d+)"/.exec(pic) || [])[1] || '1000';
    const nmx = (/<p:cNvPr [^>]*?name="([^"]*)"/.exec(pic) || [])[1] || 'Formel';
    const descr = (/<p:cNvPr [^>]*?descr="([^"]*)"/.exec(pic) || [])[1];
    const xf = (/<a:xfrm[\s\S]*?<\/a:xfrm>/.exec(pic) || [''])[0];
    const sz = Math.max(100, Math.round(f.fs) * 100);
    const om = omStyle(f.math, f.fs, String(f.c || '#000000').replace('#', '').toUpperCase());
    const sp = `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${nmx}"${descr ? ` descr="${descr}"` : ''}/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xf}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
      `<p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="ctr"/><a14:m><m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:oMathParaPr><m:jc m:val="centerGroup"/></m:oMathParaPr>${om}</m:oMathPara></a14:m><a:endParaRPr lang="de-DE" sz="${sz}" dirty="0"/></a:p></p:txBody></p:sp>`;
    const alt = `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" Requires="a14">${sp}</mc:Choice><mc:Fallback>${pic}</mc:Fallback></mc:AlternateContent>`;
    return x.slice(0, p0) + alt + x.slice(p1 + 8);
  }

  // ---- Übergang und Animationen einer Folie als PowerPoint-XML
  const TRX = { fade: '<p:fade/>', push: '<p:push dir="u"/>', wipe: '<p:wipe/>', zoom: '<p:zoom/>', cover: '<p:cover/>' };
  const transXml = (tr) => (TRX[tr] ? `<p:transition spd="med">${TRX[tr]}</p:transition>` : '');
  function timingXml(xml, s, list) {
    if (!list || !list.length) return '';
    const idOf = (e) => { const m = xml.match(new RegExp(`<p:cNvPr id="(\\d+)" name="ps-${e.id}"`)); return m ? m[1] : null; };
    const ord = X().animOrder(s);
    const items = list.map((x) => ({ ...x, spid: idOf(x.e) })).filter((x) => x.spid).sort((a, b) => ord.indexOf(a.e) - ord.indexOf(b.e));
    if (!items.length) return '';
    let cid = 3;
    const nid = () => cid++;
    const tgt = (spid, rg) => `<p:tgtEl><p:spTgt spid="${spid}">${rg ? `<p:txEl><p:pRg st="${rg[0]}" end="${rg[1]}"/></p:txEl>` : ''}</p:spTgt></p:tgtEl>`;
    const setVis = (T) => `<p:set><p:cBhvr><p:cTn id="${nid()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>${T}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>`;
    const anim = (T, attr, from, to) => `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="${nid()}" dur="500" fill="hold"/>${T}<p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="${from}"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="${to}"/></p:val></p:tav></p:tavLst></p:anim>`;
    const fade = (T) => `<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="${nid()}" dur="500"/>${T}</p:cBhvr></p:animEffect>`;
    const effect = (k, spid, rg, node) => {
      const [pid, sub] = { appear: [1, 0], fade: [10, 0], fly: [2, 4], zoom: [53, 16] }[k] || [10, 0];
      const me = nid(), T = tgt(spid, rg);
      const inner = k === 'appear' ? setVis(T) : k === 'fly' ? setVis(T) + anim(T, 'ppt_x', '#ppt_x', '#ppt_x') + anim(T, 'ppt_y', '1+#ppt_h/2', '#ppt_y')
        : k === 'zoom' ? setVis(T) + anim(T, 'ppt_w', '0', '#ppt_w') + anim(T, 'ppt_h', '0', '#ppt_h') + fade(T) : setVis(T) + fade(T);
      return `<p:par><p:cTn id="${me}" presetID="${pid}" presetClass="entr" presetSubtype="${sub}" grpId="0" fill="hold" nodeType="${node}"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${inner}</p:childTnLst></p:cTn></p:par>`;
    };
    // Klicks wie beim Vortrag in PDF-Stift: gleiche Nummer = gemeinsam, absatzweise = je Absatz ein Klick
    const clicks = [];
    let prev = null;
    for (const it of items) {
      const e = it.e;
      if (prev && !e.ap && !prev.e.ap && e.ao != null && e.ao === prev.e.ao) clicks[clicks.length - 1].push([e.an, it.spid, null]);
      else if (e.ap && it.units && it.units.length) for (const rg of it.units) clicks.push([[e.an, it.spid, rg]]);
      else clicks.push([[e.an, it.spid, null]]);
      prev = it;
    }
    const body = clicks.map((c) => {
      const a = nid(), b = nid();
      const fx = c.map(([k, spid, rg], i) => effect(k, spid, rg, i ? 'withEffect' : 'clickEffect')).join('');
      return `<p:par><p:cTn id="${a}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="${b}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${fx}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`;
    }).join('');
    const bld = items.filter((it) => it.units).map((it) => (it.e.ap ? `<p:bldP spid="${it.spid}" grpId="0" build="p"/>` : `<p:bldP spid="${it.spid}" grpId="0" animBg="1"/>`)).join('');
    return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${body}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>${bld ? `<p:bldLst>${bld}</p:bldLst>` : ''}</p:timing>`;
  }

  window.PDFSTIFT_PPTX = { importPptx, exportPptx };
})();
