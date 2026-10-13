/* PDF-Stift – Präsentationen: Folien bauen (Text, Bilder, Formen, Tabellen) und als PDF speichern.
 * Derselbe Bearbeitungskern (anklicken, ziehen, Größe, Drehen, Text formatieren) dient auch für Objekte auf PDF-Seiten.
 * Wird erst bei Bedarf geladen. Braucht window.PDFSTIFT_CORE (aus app.js). */
(() => {
  'use strict';
  const C = window.PDFSTIFT_CORE;
  const W = 960, H = 540; // Folie in Bildpunkten (16:9); als PDF 720 × 405 pt
  const $ = (q, el = document) => el.querySelector(q);
  const esc = C.esc;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const r1 = (v) => Math.round(v * 10) / 10;
  const uid = () => Math.random().toString(36).slice(2, 10);
  // Schriften: drei PDF-Standardschriften, freie Schriften aus vendor/fonts (SIL Open Font License, Liste in fonts.json)
  // und auf Wunsch die Schriften dieses Computers (Windows-App, Chrome/Edge)
  const STD_FONTS = { sans: ['Helvetica / Arial', 'Helvetica, Arial, "Liberation Sans", sans-serif'], serif: ['Times', '"Times New Roman", Times, "Liberation Serif", serif'], mono: ['Courier', '"Courier New", Courier, "Liberation Mono", monospace'] };
  const CAT_FB = { sans: 'sans-serif', serif: 'serif', mono: 'monospace', hand: 'cursive', deco: 'sans-serif' };
  const FONT_CATS = [['sans', 'Ohne Serifen'], ['serif', 'Mit Serifen'], ['mono', 'Schreibmaschine'], ['hand', 'Handschrift'], ['deco', 'Deko']];
  const FM = { list: [], by: {}, local: null, localData: null };
  const cssq = (t) => String(t).replace(/["\\<>;{}]/g, '');
  function fontCss(k) {
    if (STD_FONTS[k]) return STD_FONTS[k][1];
    if (k && k.startsWith('L:')) return `"${cssq(k.slice(2))}", sans-serif`;
    const m = FM.by[k];
    return m ? `"PS ${m.f}", ${CAT_FB[m.c] || 'sans-serif'}` : STD_FONTS.sans[1];
  }
  const fontOk = (k) => !!(STD_FONTS[k] || FM.by[k] || (k && k.startsWith('L:') && k.length < 110));
  const fontName = (k) => (STD_FONTS[k] ? STD_FONTS[k][0] : k && k.startsWith('L:') ? k.slice(2) : FM.by[k] ? FM.by[k].n : k);
  FM.ready = fetch('vendor/fonts/fonts.json?v=' + C.VERSION).then((r) => r.json()).then((list) => {
    FM.list = list;
    for (const m of list) FM.by[m.k] = m;
    const st = document.createElement('style');
    st.id = 'ps-fonts';
    st.textContent = list.map((m) => m.s.map((x) => `@font-face{font-family:"PS ${m.f}";src:url(vendor/fonts/${m.f}-${x}.ttf?v=${C.VERSION}) format("truetype");font-weight:${/Bold/.test(x) ? 700 : 400};font-style:${/Italic/.test(x) ? 'italic' : 'normal'};font-display:swap}`).join('')).join('');
    document.head.appendChild(st);
  }).catch(() => {});
  // Schriften dieses Computers (fragt einmal nach Erlaubnis)
  async function loadLocal() {
    if (FM.local) return true;
    if (!('queryLocalFonts' in window)) { C.toast('Dieser Browser kann die Schriften des Computers nicht anzeigen – bitte die Windows-App, Chrome oder Edge verwenden.', 6000); return false; }
    try {
      const all = await window.queryLocalFonts();
      FM.localData = all;
      FM.local = [...new Set(all.map((f) => f.family))].sort((a, b) => a.localeCompare(b, 'de'));
      if (!FM.local.length) C.toast('Keine Schriften gefunden – vermutlich wurde der Zugriff nicht erlaubt.', 6000);
      return true;
    } catch (e) { C.toast('Zugriff auf die Schriften dieses Computers wurde nicht erlaubt.', 5000); return false; }
  }
  // Schriftart-Auswahl (gruppiert, jede Schrift in ihrem eigenen Aussehen)
  function fontSelect(cur, en) {
    const opt = (k, n) => `<option value="${esc(k)}"${k === cur ? ' selected' : ''} style="font-family:${esc(fontCss(k))}">${esc(n)}</option>`;
    let h = `<select data-f="ff" class="rb-font" title="Schriftart"${en ? '' : ' disabled'}><optgroup label="Standard">${Object.entries(STD_FONTS).map(([k, [n]]) => opt(k, n)).join('')}</optgroup>`;
    for (const [c, lab] of FONT_CATS) { const l = FM.list.filter((m) => m.c === c); if (l.length) h += `<optgroup label="${esc(lab)}">${l.map((m) => opt(m.k, m.n)).join('')}</optgroup>`; }
    if (cur && cur.startsWith('L:') && !(FM.local || []).includes(cur.slice(2))) h += `<optgroup label="Auf einem Computer">${opt(cur, cur.slice(2))}</optgroup>`;
    if (FM.local) h += `<optgroup label="Auf diesem Computer">${FM.local.map((f) => opt('L:' + f, f)).join('')}</optgroup>`;
    else if ('queryLocalFonts' in window) h += `<optgroup label="Auf diesem Computer"><option value="@local">Schriften dieses Computers anzeigen …</option></optgroup>`;
    return h + '</select>';
  }
  // Schriftsammlung (.ttc, z. B. Cambria): die eine Schrift herauslösen
  function ttcPick(b, ps) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (b.length < 12 || dv.getUint32(0) !== 0x74746366) return b;
    const n = dv.getUint32(8), offs = [];
    for (let i = 0; i < n; i++) offs.push(dv.getUint32(12 + 4 * i));
    const psOf = (off) => {
      const nt = dv.getUint16(off + 4);
      for (let i = 0; i < nt; i++) {
        const r = off + 12 + 16 * i;
        if (dv.getUint32(r) !== 0x6E616D65) continue;
        const to = dv.getUint32(r + 8), cnt = dv.getUint16(to + 2), so = to + dv.getUint16(to + 4);
        for (let j = 0; j < cnt; j++) {
          const q = to + 6 + 12 * j;
          if (dv.getUint16(q + 6) !== 6) continue;
          const pid = dv.getUint16(q), len = dv.getUint16(q + 8), o = so + dv.getUint16(q + 10);
          let t = '';
          if (pid === 3 || pid === 0) for (let k = 0; k + 1 < len; k += 2) t += String.fromCharCode(dv.getUint16(o + k));
          else for (let k = 0; k < len; k++) t += String.fromCharCode(dv.getUint8(o + k));
          return t;
        }
      }
      return '';
    };
    let pick = 0;
    for (let i = 0; i < n; i++) if (psOf(offs[i]) === ps) { pick = i; break; }
    const off = offs[pick], nt = dv.getUint16(off + 4), tabs = [];
    for (let i = 0; i < nt; i++) { const r = off + 12 + 16 * i; tabs.push([dv.getUint32(r), dv.getUint32(r + 4), dv.getUint32(r + 8), dv.getUint32(r + 12)]); }
    const pad = (x) => (x + 3) & ~3;
    const out = new Uint8Array(12 + 16 * nt + tabs.reduce((a, t) => a + pad(t[3]), 0));
    const ov = new DataView(out.buffer);
    out.set(b.subarray(off, off + 12), 0);
    let p = 12 + 16 * nt;
    tabs.forEach(([tag, sum, o, l], i) => { const r = 12 + 16 * i; ov.setUint32(r, tag); ov.setUint32(r + 4, sum); ov.setUint32(r + 8, p); ov.setUint32(r + 12, l); out.set(b.subarray(o, o + l), p); p += pad(l); });
    return out;
  }
  // darf die Schrift eingebettet werden? (OS/2 fsType: 2 = nur mit Erlaubnis des Herstellers)
  function embedOk(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const nt = dv.getUint16(4);
    for (let i = 0; i < nt; i++) { const r = 12 + 16 * i; if (dv.getUint32(r) === 0x4F532F32) return (dv.getUint16(dv.getUint32(r + 8) + 8) & 0x000F) !== 0x0002; }
    return true;
  }
  const COLORS = ['#1A1A1A', '#FFFFFF', '#1E2F6E', '#1F4FD6', '#0091FF', '#1B8A3A', '#B8E62E', '#E8590C', '#D6262B', '#D6409F', '#7048E8', '#868E96'];
  const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 60, 72];
  const DEF_TH = { bg: '#FFFFFF', fg: '#1A1A1A', accent: '#1E2F6E', font: 'sans' };
  const D = { path: '', deck: null, rev: 0, cur: 0, undo: [], redo: [], saveT: 0, saving: null, dirty: false, root: null, ed: null, k: 1 };

  // ------------------------------------------------------------------ Grundgerüst einer Folie
  const LAYOUTS = {
    title: { name: 'Titelfolie', els: () => [
      { t: 'text', x: 80, y: 170, w: 800, h: 110, fs: 48, va: 'b', html: '<div style="text-align: center;"><b>Titel</b></div>', ph: 1 },
      { t: 'text', x: 80, y: 300, w: 800, h: 70, fs: 24, html: '<div style="text-align: center;">Untertitel</div>', ph: 1 },
    ] },
    content: { name: 'Titel und Inhalt', els: () => [
      { t: 'text', x: 50, y: 30, w: 860, h: 80, fs: 36, va: 'm', html: '<div><b>Titel</b></div>', ph: 1 },
      { t: 'text', x: 50, y: 125, w: 860, h: 380, fs: 24, html: '<ul><li>Erster Punkt</li><li>Zweiter Punkt</li></ul>', ph: 1 },
    ] },
    two: { name: 'Zwei Spalten', els: () => [
      { t: 'text', x: 50, y: 30, w: 860, h: 80, fs: 36, va: 'm', html: '<div><b>Titel</b></div>', ph: 1 },
      { t: 'text', x: 50, y: 125, w: 415, h: 380, fs: 22, html: '<ul><li>Linke Spalte</li></ul>', ph: 1 },
      { t: 'text', x: 495, y: 125, w: 415, h: 380, fs: 22, html: '<ul><li>Rechte Spalte</li></ul>', ph: 1 },
    ] },
    only: { name: 'Nur Titel', els: () => [{ t: 'text', x: 50, y: 30, w: 860, h: 80, fs: 36, va: 'm', html: '<div><b>Titel</b></div>', ph: 1 }] },
    blank: { name: 'Leer', els: () => [] },
  };
  const PH_TEXT = ['Titel', 'Untertitel', 'Erster Punkt Zweiter Punkt', 'Linke Spalte', 'Rechte Spalte'];
  const plain = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  // unberührter Platzhalter: in der Bearbeitung grau, beim Vortragen und im PDF unsichtbar
  const isPh = (e) => !!(e.ph && e.t === 'text' && PH_TEXT.includes(plain(e.html)));
  const newSlide = (lay) => ({ id: uid(), els: (LAYOUTS[lay] || LAYOUTS.blank).els().map((e) => ({ id: uid(), r: 0, ...e })) });
  const theme = () => D.deck.theme || (D.deck.theme = { ...DEF_TH });
  const slide = () => D.deck && D.deck.slides[D.cur];
  const LINE_K = ['line', 'arrow', 'arrow2'], OPEN_K = ['elbow', 'brackL', 'brackR', 'braceL', 'braceR', 'arc'];
  const isLine = (e) => e.t === 'shape' && LINE_K.includes(e.k);
  const isOpen = (e) => e.t === 'shape' && OPEN_K.includes(e.k);

  // ------------------------------------------------------------------ Text säubern (nur einfache Auszeichnung)
  function clean(html) {
    const t = document.createElement('template');
    t.innerHTML = String(html || '');
    const out = document.createElement('div');
    const walk = (src, dst) => {
      for (const n of [...src.childNodes]) {
        if (n.nodeType === 3) { dst.appendChild(document.createTextNode(n.nodeValue)); continue; }
        if (n.nodeType !== 1) continue;
        const tag = n.tagName.toLowerCase();
        const st = n.style || {};
        let el = null;
        if (['div', 'p', 'li', 'ul', 'ol'].includes(tag)) {
          el = document.createElement(tag === 'p' ? 'div' : tag);
          const al = st.textAlign || n.getAttribute('align');
          if (['center', 'right', 'justify'].includes(al) && tag !== 'ul' && tag !== 'ol') el.style.textAlign = al;
        } else if (tag === 'br') { dst.appendChild(document.createElement('br')); continue; }
        else if (tag === 'b' || tag === 'strong') el = document.createElement('b');
        else if (tag === 'i' || tag === 'em') el = document.createElement('i');
        else if (tag === 'u') el = document.createElement('u');
        else if (tag === 's' || tag === 'strike' || tag === 'del') el = document.createElement('s');
        else if (tag === 'sup' || tag === 'sub') el = document.createElement(tag);
        else if (tag === 'span' || tag === 'font') {
          const c = st.color || n.getAttribute('color');
          const bg = st.backgroundColor && !/transparent|rgba\(0, 0, 0, 0\)/.test(st.backgroundColor) ? st.backgroundColor : '';
          const bold = /bold|[6-9]00/.test(st.fontWeight || ''), it = st.fontStyle === 'italic', un = /underline/.test(st.textDecoration || st.textDecorationLine || ''), lt = /line-through/.test(st.textDecoration || st.textDecorationLine || '');
          const va = st.verticalAlign;
          el = document.createElement('span');
          if (c) el.style.color = c;
          if (bg) el.style.backgroundColor = bg;
          let inner = el;
          if (lt) { const x = document.createElement('s'); inner.appendChild(x); inner = x; }
          if (va === 'super' || va === 'sub') { const x = document.createElement(va === 'super' ? 'sup' : 'sub'); inner.appendChild(x); inner = x; }
          if (bold) { const b = document.createElement('b'); inner.appendChild(b); inner = b; }
          if (it) { const i = document.createElement('i'); inner.appendChild(i); inner = i; }
          if (un) { const u = document.createElement('u'); inner.appendChild(u); inner = u; }
          walk(n, inner);
          dst.appendChild(el);
          continue;
        }
        if (!el) { walk(n, dst); continue; }
        walk(n, el);
        dst.appendChild(el);
      }
    };
    walk(t.content, out);
    return out.innerHTML;
  }

  // ------------------------------------------------------------------ Zeichnen (Bearbeiten, Vorschau, Vortrag)
  const imgUrl = (src) => C.API + '?a=img&src=' + encodeURIComponent(src);
  // Formen als SVG-Pfad im Rechteck w × h (gleiche Geometrie für Bildschirm und PDF)
  const P2 = (pts) => 'M' + pts.map(([x, y]) => `${+x.toFixed(2)} ${+y.toFixed(2)}`).join('L') + 'Z';
  const star = (w, h, n, ri) => P2(Array.from({ length: n * 2 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / n, r = i % 2 ? ri : 1; return [w / 2 + Math.cos(a) * w / 2 * r, h / 2 + Math.sin(a) * h / 2 * r]; }));
  const ngon = (w, h, n) => P2(Array.from({ length: n }, (_, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [w / 2 + Math.cos(a) * w / 2, h / 2 + Math.sin(a) * h / 2]; }));
  function brace(w, h, flip) {
    const X = (x) => (flip ? w - x : x), m = w / 2;
    return `M${X(w)} 0C${X(m)} 0 ${X(m)} 0 ${X(m)} ${h * 0.12}V${h * 0.38}C${X(m)} ${h * 0.5} ${X(0)} ${h * 0.5} ${X(0)} ${h * 0.5}C${X(0)} ${h * 0.5} ${X(m)} ${h * 0.5} ${X(m)} ${h * 0.62}V${h * 0.88}C${X(m)} ${h} ${X(m)} ${h} ${X(w)} ${h}`;
  }
  function shapePath(kind, w, h) {
    const a = Math.min(w * 0.4, h * 0.5), m = Math.min(w, h);
    switch (kind) {
      case 'round': { const r = m * 0.18; return `M${r} 0H${w - r}Q${w} 0 ${w} ${r}V${h - r}Q${w} ${h} ${w - r} ${h}H${r}Q0 ${h} 0 ${h - r}V${r}Q0 0 ${r} 0Z`; }
      case 'ellipse': return `M0 ${h / 2}A${w / 2} ${h / 2} 0 1 0 ${w} ${h / 2}A${w / 2} ${h / 2} 0 1 0 0 ${h / 2}Z`;
      case 'tri': return `M${w / 2} 0L${w} ${h}L0 ${h}Z`;
      case 'rtri': return `M0 0L${w} ${h}H0Z`;
      case 'diamond': return P2([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
      case 'pent': return ngon(w, h, 5);
      case 'hex': return P2([[w * 0.25, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [w * 0.25, h], [0, h / 2]]);
      case 'oct': { const c = m * 0.29; return P2([[c, 0], [w - c, 0], [w, c], [w, h - c], [w - c, h], [c, h], [0, h - c], [0, c]]); }
      case 'para': return P2([[w * 0.25, 0], [w, 0], [w * 0.75, h], [0, h]]);
      case 'trap': return P2([[w * 0.2, 0], [w * 0.8, 0], [w, h], [0, h]]);
      case 'plus': { const t = m * 0.32, cx = w / 2, cy = h / 2; return P2([[cx - t / 2, 0], [cx + t / 2, 0], [cx + t / 2, cy - t / 2], [w, cy - t / 2], [w, cy + t / 2], [cx + t / 2, cy + t / 2], [cx + t / 2, h], [cx - t / 2, h], [cx - t / 2, cy + t / 2], [0, cy + t / 2], [0, cy - t / 2], [cx - t / 2, cy - t / 2]]); }
      case 'star5': return star(w, h, 5, 0.42);
      case 'star8': return star(w, h, 8, 0.7);
      case 'heart': return `M${w / 2} ${h * 0.28}C${w / 2} ${h * 0.05} ${w * 0.1} 0 ${w * 0.03} ${h * 0.28}C${-w * 0.05} ${h * 0.55} ${w * 0.3} ${h * 0.75} ${w / 2} ${h}C${w * 0.7} ${h * 0.75} ${w * 1.05} ${h * 0.55} ${w * 0.97} ${h * 0.28}C${w * 0.9} 0 ${w / 2} ${h * 0.05} ${w / 2} ${h * 0.28}Z`;
      case 'arrowR': return `M0 ${h * 0.3}H${w - a}V0L${w} ${h / 2}L${w - a} ${h}V${h * 0.7}H0Z`;
      case 'arrowL': return `M${w} ${h * 0.3}H${a}V0L0 ${h / 2}L${a} ${h}V${h * 0.7}H${w}Z`;
      case 'arrowU': { const b2 = Math.min(h * 0.4, w * 0.5); return `M${w * 0.3} ${h}V${b2}H0L${w / 2} 0L${w} ${b2}H${w * 0.7}V${h}Z`; }
      case 'arrowD': { const b2 = Math.min(h * 0.4, w * 0.5); return `M${w * 0.3} 0V${h - b2}H0L${w / 2} ${h}L${w} ${h - b2}H${w * 0.7}V0Z`; }
      case 'arrowLR': { const b2 = Math.min(w * 0.25, h * 0.5); return `M0 ${h / 2}L${b2} 0V${h * 0.3}H${w - b2}V0L${w} ${h / 2}L${w - b2} ${h}V${h * 0.7}H${b2}V${h}Z`; }
      case 'chevron': return P2([[0, 0], [w - a, 0], [w, h / 2], [w - a, h], [0, h], [a, h / 2]]);
      case 'home': return P2([[0, 0], [w - a, 0], [w, h / 2], [w - a, h], [0, h]]);
      case 'callout': return `M0 0H${w}V${h * 0.72}H${w * 0.45}L${w * 0.2} ${h}L${w * 0.27} ${h * 0.72}H0Z`;
      case 'calloutR': { const r = Math.min(w, h * 0.72) * 0.2, hb = h * 0.72; return `M${r} 0H${w - r}Q${w} 0 ${w} ${r}V${hb - r}Q${w} ${hb} ${w - r} ${hb}H${w * 0.45}L${w * 0.2} ${h}L${w * 0.27} ${hb}H${r}Q0 ${hb} 0 ${hb - r}V${r}Q0 0 ${r} 0Z`; }
      case 'cloud': return `M${w * 0.25} ${h * 0.85}C${w * 0.05} ${h * 0.85} 0 ${h * 0.6} ${w * 0.12} ${h * 0.5}C${w * 0.02} ${h * 0.3} ${w * 0.2} ${h * 0.12} ${w * 0.35} ${h * 0.22}C${w * 0.4} ${h * 0.02} ${w * 0.65} 0 ${w * 0.7} ${h * 0.2}C${w * 0.85} ${h * 0.1} ${w} ${h * 0.3} ${w * 0.9} ${h * 0.48}C${w} ${h * 0.6} ${w * 0.95} ${h * 0.85} ${w * 0.75} ${h * 0.85}Z`;
      case 'line': case 'arrow': case 'arrow2': return `M0 ${h / 2}H${w}`;
      case 'elbow': return `M0 0H${w / 2}V${h}H${w}`;
      case 'arc': return `M0 ${h}C0 ${h * 0.1} ${w * 0.1} 0 ${w} 0`;
      case 'brackL': return `M${w} 0H0V${h}H${w}`;
      case 'brackR': return `M0 0H${w}V${h}H0`;
      case 'braceL': return brace(w, h, false);
      case 'braceR': return brace(w, h, true);
      default: return `M0 0H${w}V${h}H0Z`;
    }
  }
  // Pfeilspitzen (offen, als Linienzug) für Linien und Winkelverbinder
  function arrowHeads(e, sw) {
    const L = 4 * sw, B = 2.2 * sw, out = [];
    const hp = sw / 2;
    if (e.k === 'arrow' || e.k === 'arrow2') out.push(`M${e.w - L - hp} ${e.h / 2 - B}L${e.w - hp} ${e.h / 2}L${e.w - L - hp} ${e.h / 2 + B}`);
    if (e.k === 'arrow2') out.push(`M${L + hp} ${e.h / 2 - B}L${hp} ${e.h / 2}L${L + hp} ${e.h / 2 + B}`);
    if (e.k === 'elbow' && e.head !== 0) out.push(`M${e.w - L} ${e.h - B}L${e.w} ${e.h}L${e.w - L} ${e.h + B}`);
    return out;
  }
  const pos = (e) => `left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${e.h}px;transform:rotate(${e.r || 0}deg)${e.fx || e.fy ? ` scale(${e.fx ? -1 : 1},${e.fy ? -1 : 1})` : ''}`;
  const look = (e) => `${e.op != null && e.op < 1 ? `opacity:${e.op};` : ''}${e.sh ? 'filter:drop-shadow(3px 3px 2.5px rgba(0,0,0,.35));' : ''}`;
  function elNode(e, th) {
    th = th || DEF_TH;
    const n = document.createElement('div');
    n.className = 'dk-el dk-' + e.t;
    n.dataset.id = e.id;
    n.style.cssText = pos(e) + ';' + look(e);
    if (e.ff && fontOk(e.ff)) n.style.fontFamily = fontCss(e.ff);
    const pad = e.pad != null ? e.pad : 8;
    if (e.t === 'text') {
      const tx = document.createElement('div');
      tx.className = 'dk-tx va-' + (e.va || 't');
      tx.style.fontSize = (e.fs || 24) + 'px';
      tx.style.color = e.c || th.fg;
      tx.style.padding = pad + 'px';
      if (e.lh) tx.style.lineHeight = e.lh;
      tx.innerHTML = clean(e.html);
      if (e.fill) n.style.background = e.fill;
      if (e.line) n.style.boxShadow = `inset 0 0 0 ${e.lw || 2}px ${e.line}`;
      n.appendChild(tx);
    } else if (e.t === 'img') {
      const im = document.createElement('img');
      im.src = imgUrl(e.src); im.alt = ''; im.draggable = false;
      n.appendChild(im);
      if (e.line) n.style.boxShadow = `inset 0 0 0 ${e.lw || 2}px ${e.line}`;
    } else if (e.t === 'shape') {
      const lineK = isLine(e), openK = isOpen(e);
      const sw = lineK || openK ? Math.max(0.5, e.lw || (lineK ? 3 : 2)) : (e.line ? e.lw || 2 : 0);
      const hp = sw / 2;
      const stroke = e.line || (lineK || openK ? th.fg : 'none');
      const heads = arrowHeads(e, sw).map((d) => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
      const pad2 = sw * 3; // Platz für Pfeilspitzen am Rand
      n.innerHTML = `<svg viewBox="${-hp - pad2} ${-hp - pad2} ${e.w + sw + 2 * pad2} ${e.h + sw + 2 * pad2}" width="${e.w + sw + 2 * pad2}" height="${e.h + sw + 2 * pad2}" style="margin:${-hp - pad2}px;width:${e.w + sw + 2 * pad2}px;height:${e.h + sw + 2 * pad2}px;max-width:none;overflow:visible" preserveAspectRatio="none">` +
        `<path d="${shapePath(e.k, lineK && e.k !== 'line' ? e.w - hp : e.w, e.h).replace(/^M0 /, lineK && e.k === 'arrow2' ? `M${hp} ` : 'M0 ')}" fill="${lineK || openK ? 'none' : e.fill || 'none'}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>${heads}</svg>`;
      if (e.html && !lineK && !openK) {
        const tx = document.createElement('div');
        tx.className = 'dk-tx va-' + (e.va || 'm'); tx.style.fontSize = (e.fs || 20) + 'px'; tx.style.color = e.c || (e.fill ? '#FFFFFF' : th.fg); tx.style.padding = pad + 'px';
        if (e.lh) tx.style.lineHeight = e.lh;
        tx.innerHTML = clean(e.html);
        n.appendChild(tx);
      }
    } else if (e.t === 'table') {
      const tb = document.createElement('table');
      tb.style.fontSize = (e.fs || 18) + 'px';
      tb.style.setProperty('--bc', e.line || '#868E96');
      const cw = e.cw || e.rows[0].map(() => 1 / e.rows[0].length);
      const cp = Math.max(1, Math.round((e.fs || 18) / 3));
      tb.innerHTML = '<colgroup>' + cw.map((f) => `<col style="width:${f * 100}%">`).join('') + '</colgroup>' +
        e.rows.map((row, ri) => '<tr>' + row.map((cell, ci) => `<td data-r="${ri}" data-c="${ci}" class="${ri === 0 && e.head ? 'head' : ''}" style="${ri === 0 && e.head ? `background:${th.accent};color:#fff` : `color:${th.fg}`}"><div class="dk-cell" style="padding:${cp}px">${clean(cell)}</div></td>`).join('') + '</tr>').join('');
      n.appendChild(tb);
    }
    return n;
  }
  function slideNode(s, scale, live, th) {
    th = th || DEF_TH;
    const sl = document.createElement('div');
    sl.className = 'dk-slide';
    sl.style.cssText = `width:${W}px;height:${H}px;background:${s.bg || th.bg};font-family:${fontCss(th.font)};transform:scale(${scale});transform-origin:0 0`;
    for (const e of s.els) if (live || !isPh(e)) sl.appendChild(elNode(e, th));
    return sl;
  }
  // Ebene mit Objekten (z. B. über einer PDF-Seite): w × h Einheiten, durchsichtig
  function layerNode(els, w, h, scale, th) {
    th = th || DEF_TH;
    const sl = document.createElement('div');
    sl.className = 'dk-slide dk-layer';
    sl.style.cssText = `width:${w}px;height:${h}px;background:transparent;overflow:visible;font-family:${fontCss(th.font)};transform:scale(${scale});transform-origin:0 0`;
    for (const e of els) sl.appendChild(elNode(e, th));
    return sl;
  }

  const ICON = {
    slide: '<path d="M4 5h16v12H4z"/><path d="M12 9v4M10 11h4"/>', text: '<path d="M5 6h14M12 6v13"/>', img: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.5L20 17"/>',
    shape: '<rect x="3.5" y="4" width="9" height="9" rx="1"/><circle cx="15.5" cy="15.5" r="4.5"/>', table: '<rect x="3.5" y="5" width="17" height="14" rx="1"/><path d="M3.5 10h17M3.5 14.5h17M9.5 5v14M15 5v14"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>', redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
    front: '<rect x="8" y="8" width="12" height="12" rx="1" fill="currentColor"/><rect x="4" y="4" width="12" height="12" rx="1"/>', back: '<rect x="4" y="4" width="12" height="12" rx="1" fill="currentColor"/><rect x="8" y="8" width="12" height="12" rx="1"/>',
    dup: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>', del: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
    design: '<circle cx="12" cy="12" r="8"/><circle cx="9" cy="10" r="1.2" fill="currentColor"/><circle cx="14" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="13" r="1.2" fill="currentColor"/>',
    play: '<path d="M7 5l12 7-12 7z"/>', pdf: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 14h6M13 11v6"/>', align: '<path d="M4 4v16M8 8h10M8 16h6"/>',
    textbox: '<rect x="3.5" y="5" width="17" height="14" rx="1.5" stroke-dasharray="2.5 2"/><path d="M8.5 9h7M12 9v7"/>', bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
    fill: '<path d="M5 11l6-6 7 7-6 6z"/><path d="M19.5 15.5c0 1.2-.8 2-1.7 2s-1.6-.8-1.6-2c0-1 1.6-3 1.6-3s1.7 2 1.7 3z"/>', line: '<path d="M4 18L18 4"/><path d="M14 20h6"/>',
  };
  const SHAPE_GROUPS = [
    ['Linien', [['line', 'Linie'], ['arrow', 'Pfeil'], ['arrow2', 'Doppelpfeil'], ['elbow', 'Winkelverbinder'], ['arc', 'Bogen']]],
    ['Grundformen', [['rect', 'Rechteck'], ['round', 'Abgerundetes Rechteck'], ['ellipse', 'Kreis / Ellipse'], ['tri', 'Dreieck'], ['rtri', 'Rechtwinkliges Dreieck'], ['diamond', 'Raute'], ['pent', 'Fünfeck'], ['hex', 'Sechseck'], ['oct', 'Achteck'], ['para', 'Parallelogramm'], ['trap', 'Trapez'], ['plus', 'Kreuz'], ['heart', 'Herz'], ['cloud', 'Wolke']]],
    ['Blockpfeile', [['arrowR', 'Pfeil nach rechts'], ['arrowL', 'Pfeil nach links'], ['arrowU', 'Pfeil nach oben'], ['arrowD', 'Pfeil nach unten'], ['arrowLR', 'Doppelpfeil (Block)'], ['chevron', 'Winkelpfeil'], ['home', 'Richtungspfeil']]],
    ['Sterne und Sprechblasen', [['star5', 'Stern'], ['star8', 'Stern mit 8 Zacken'], ['callout', 'Sprechblase'], ['calloutR', 'Sprechblase (abgerundet)']]],
    ['Klammern', [['brackL', 'Eckige Klammer links'], ['brackR', 'Eckige Klammer rechts'], ['braceL', 'Geschweifte Klammer links'], ['braceR', 'Geschweifte Klammer rechts']]],
  ];
  const SHAPES = SHAPE_GROUPS.flatMap((g) => g[1]);
  const QUICK_SHAPES = ['rect', 'round', 'ellipse', 'tri', 'line', 'arrow', 'arrowR', 'elbow', 'star5', 'callout', 'braceL', 'diamond'];
  const SHAPE_IC = { rect: '<rect x="4" y="6.5" width="16" height="11"/>', round: '<rect x="4" y="6.5" width="16" height="11" rx="3.5"/>', ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6"/>', tri: '<path d="M12 5l8.5 14h-17z"/>',
    arrowR: '<path d="M3 9.5h10V5.5l8 6.5-8 6.5v-4H3z"/>', line: '<path d="M4 19L20 5"/>', arrow: '<path d="M4 19L20 5"/><path d="M12.5 5H20v7.5"/>',
    arrow2: '<path d="M4 20L20 4"/><path d="M13 4h7v7"/><path d="M4 13v7h7"/>', elbow: '<path d="M3 5h8v14h9"/><path d="M17 16l3 3-3 3"/>', arc: '<path d="M4 20C4 9 9 4 20 4"/>' };
  const shapeIc = (k) => SHAPE_IC[k] || (/^bra/.test(k) ? `<g transform="translate(8.5 4)"><path d="${shapePath(k, 7, 16)}"/></g>` : `<g transform="translate(3.5 5.5)"><path d="${shapePath(k, 17, 13)}"/></g>`);
  const RB = { tab: 'start' };
  const RI = {
    paste: '<rect x="5.5" y="5" width="13" height="16" rx="1.5"/><path d="M9 5V3.5h6V5"/><path d="M9 10.5h6M9 14h6M9 17.5h4"/>',
    cut: '<circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/><path d="M8.3 15.8L18 4M15.7 15.8L6 4"/>',
    dup2: '<rect x="3.5" y="3.5" width="11" height="11" rx="1.5"/><rect x="9.5" y="9.5" width="11" height="11" rx="1.5"/><path d="M15 13v4M13 15h4"/>',
    grow: '<path d="M3 19l5-13 5 13M5 14.5h6"/><path d="M18 10V4M15 7h6"/>', shrink: '<path d="M3 19l5-13 5 13M5 14.5h6"/><path d="M15 7h6"/>',
    clear: '<path d="M4 19l5-13 5 13M6 14.5h6"/><path d="M15.5 14.5l5 5M20.5 14.5l-5 5"/>',
    ul: '<circle cx="5" cy="7" r="1.2" fill="currentColor"/><circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="5" cy="17" r="1.2" fill="currentColor"/><path d="M9 7h11M9 12h11M9 17h11"/>',
    ol: '<path d="M4 4.5h1.5V9M3.8 9h3.2"/><path d="M3.8 14h3.2l-3.2 4.5h3.2"/><path d="M10 7h10M10 16h10"/>',
    outdent: '<path d="M4 5h16M11 10h9M11 14h9M4 19h16"/><path d="M8 9.5L5 12l3 2.5"/>', indent: '<path d="M4 5h16M11 10h9M11 14h9M4 19h16"/><path d="M5 9.5L8 12l-3 2.5"/>',
    al: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>', ac: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>', ar: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>', aj: '<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>',
    vt: '<path d="M4 4h16"/><path d="M8 8.5h8M8 12.5h8"/>', vm: '<path d="M8 9h8M8 15h8"/><path d="M3 12h3M18 12h3"/>', vb: '<path d="M4 20h16"/><path d="M8 11.5h8M8 15.5h8"/>',
    arrange: '<rect x="3.5" y="3.5" width="10" height="10" rx="1.2"/><rect x="10.5" y="10.5" width="10" height="10" rx="1.2" fill="currentColor" fill-opacity=".25"/>',
    selall: '<path d="M4 4h3M10 4h4M17 4h3v3M20 10v4M20 17v3h-3M14 20h-4M7 20H4v-3M4 14v-4"/><path d="M9 8l7 4-3 1-1.5 3z"/>',
    rot: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4v4.5H15"/>',
    rowAdd: '<rect x="3.5" y="4" width="17" height="10" rx="1"/><path d="M3.5 9h17"/><path d="M12 16.5v5M9.5 19h5"/>', rowDel: '<rect x="3.5" y="4" width="17" height="10" rx="1"/><path d="M3.5 9h17"/><path d="M9.5 19h5"/>',
    colAdd: '<rect x="4" y="3.5" width="10" height="17" rx="1"/><path d="M9 3.5v17"/><path d="M16.5 12h5M19 9.5v5"/>', colDel: '<rect x="4" y="3.5" width="10" height="17" rx="1"/><path d="M9 3.5v17"/><path d="M16.5 12h5"/>',
    newslide: '<rect x="3.5" y="5" width="13" height="10" rx="1"/><path d="M19 13v6M16 16h6"/>', layout: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M3.5 9h17M10 9v10.5"/>',
    painter: '<rect x="4" y="3.5" width="14" height="6" rx="1.5"/><path d="M18 6.5h2v5h-8.5v3"/><rect x="10" y="14.5" width="3" height="6.5" rx="1"/>',
    strike: '<path d="M16.5 7.5c-.8-1.6-2.4-2.5-4.5-2.5-2.6 0-4.5 1.4-4.5 3.4 0 1.5 1 2.4 3 3"/><path d="M4 12h16"/><path d="M8 16.5c.6 1.6 2.2 2.5 4.3 2.5 2.7 0 4.7-1.4 4.7-3.5 0-.8-.3-1.5-.9-2"/>',
    sup: '<path d="M4 8l8 11M12 8l-8 11"/><path d="M15.5 5.5c.4-1 1.2-1.5 2.2-1.5 1.2 0 2 .7 2 1.7 0 1.6-2.4 2.3-4.2 4.3h4.4"/>',
    sub: '<path d="M4 5l8 11M12 5l-8 11"/><path d="M15.5 14.5c.4-1 1.2-1.5 2.2-1.5 1.2 0 2 .7 2 1.7 0 1.6-2.4 2.3-4.2 4.3h4.4"/>',
    marker: '<path d="M9 15l-3 3H3l3-3"/><path d="M9 15l9-9 3 3-9 9z"/>', lh: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M5 4v16M3 6l2-2 2 2M3 18l2 2 2-2"/>',
    fx: '<rect x="4" y="4" width="12" height="12" rx="2"/><rect x="8" y="8" width="12" height="12" rx="2" fill="currentColor" fill-opacity=".3" stroke-opacity=".4"/>',
    group: '<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="2.5 2"/><rect x="6" y="6" width="6" height="6"/><circle cx="15" cy="15" r="3"/>',
    replace: '<circle cx="10" cy="10" r="5.5"/><path d="M14 14l5.5 5.5"/><path d="M7.5 10h5M10 7.5v5"/>',
    bg: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5" fill="currentColor" fill-opacity=".2"/>', design: '<circle cx="12" cy="12" r="8"/><circle cx="9" cy="10" r="1.2" fill="currentColor"/><circle cx="14" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="13" r="1.2" fill="currentColor"/>',
  };
  // Menüband „Einfügen“ (Folien und PDF-Seiten)
  function insertGroup() {
    return `<div class="rb-grp rb-ins">` +
      `<button type="button" class="rb-big" data-ins="text" title="Textfeld: auf die Seite klicken oder ein Feld aufziehen"><svg viewBox="0 0 24 24">${ICON.textbox}</svg><span>Textfeld</span></button>` +
      `<div class="rb-shapes" role="group" aria-label="Formen">${SHAPES.map(([k, l]) => `<button type="button" class="rb-sh" data-ins="shape:${k}" title="${esc(l)} – klicken oder aufziehen" aria-label="${esc(l)}"><svg viewBox="0 0 24 24">${SHAPE_IC[k]}</svg></button>`).join('')}</div>` +
      `<button type="button" class="rb-big" data-ins="img" title="Bild einfügen"><svg viewBox="0 0 24 24">${ICON.img}</svg><span>Bild</span></button>` +
      `<button type="button" class="rb-big" data-ins="table" title="Tabelle einfügen"><svg viewBox="0 0 24 24">${ICON.table}</svg><span>Tabelle</span></button>` +
      `<span class="rb-cap">Einfügen</span></div>`;
  }

  // Text in Elementen ersetzen (Textknoten, Formatierung bleibt); gibt die Anzahl zurück
  function replaceInHtml(html, find, repl, cnt) {
    const t = document.createElement('div');
    t.innerHTML = clean(html);
    const w = document.createTreeWalker(t, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) { const parts = n.nodeValue.split(find); if (parts.length > 1) { cnt.n += parts.length - 1; n.nodeValue = parts.join(repl); } }
    return t.innerHTML;
  }
  function replaceInEls(list, find, repl) {
    const cnt = { n: 0 };
    for (const e of list) {
      if (e.html) e.html = replaceInHtml(e.html, find, repl, cnt);
      if (e.rows) e.rows = e.rows.map((r) => r.map((c) => replaceInHtml(c, find, repl, cnt)));
    }
    return cnt.n;
  }

  // ================================================================== Bearbeitungskern (Folie oder PDF-Seite)
  /* host: box() Element mit der Fläche · stage() fängt den Zeiger · fmtBar() Format-Leiste · W(), H(), k() Maße und Maßstab
   *       unit Größenfaktor für neue Objekte · els()/setEls(a) · theme() · snap()/commit(vorher) Rückgängig + Speichern
   *       surface() Fläche zeichnen · typing() beim Tippen · placing(an) Einfügemodus · pickImage() · rendered() */
  function makeEditor(host) {
    const ED = { sel: [], edit: null, insert: null, clip: null, painter: null };
    try { RB.tab = C.ls('rbTab') || RB.tab; } catch (er) { /* */ }
    FM.ready.then(() => { if (host.fmtBar()) renderFmt(); });
    const els = () => host.els() || [];
    const byId = (id) => els().find((e) => e.id === id);
    const u = () => host.unit || 1;
    function change(fn, keepSel) {
      const b = host.snap();
      fn();
      if (!keepSel) ED.sel = ED.sel.filter((id) => byId(id));
      render();
      if (grow()) render();
      host.commit(b);
    }
    // Text passt nicht mehr (größere Schrift, fett …): Feld nach unten verlängern wie in PowerPoint
    function grow() {
      const box = host.box();
      if (!box) return false;
      let any = false;
      for (const e of els()) {
        if (e.t !== 'text' && e.t !== 'table') continue;
        const n = box.querySelector(`.dk-el[data-id="${e.id}"]`);
        const t = n && (e.t === 'table' ? n.querySelector('table') : n.querySelector('.dk-tx'));
        if (t && t.scrollHeight > e.h + 1) { e.h = Math.min(host.H() * 2, t.scrollHeight); any = true; }
      }
      return any;
    }
    function render() { renderStage(); renderFmt(); }
    function renderStage() {
      const box = host.box();
      if (!box) return;
      box.innerHTML = '';
      const sl = host.surface();
      if (!sl) return;
      sl.classList.add('dk-live');
      for (const n of sl.querySelectorAll('.dk-el')) {
        const e = byId(n.dataset.id);
        if (e && isPh(e)) n.classList.add('dk-ph');
        if (ED.sel.includes(n.dataset.id)) n.classList.add('sel');
      }
      box.appendChild(sl);
      if (host.rendered) host.rendered();
      if (ED.sel.length === 1 && !ED.edit) handles(sl);
      if (ED.edit) { const n = sl.querySelector(`.dk-el[data-id="${ED.edit.id}"]`); if (n) reEdit(n); }
    }
    function handles(sl) {
      const e = byId(ED.sel[0]);
      if (!e) return;
      const h = document.createElement('div');
      h.className = 'dk-handles';
      h.style.cssText = pos(e);
      const k = 1 / (host.k() || 1);
      const ps = isLine(e) ? ['w', 'e'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
      h.innerHTML = ps.map((p) => `<i class="dk-h ${p}" data-h="${p}" style="transform:scale(${k})"></i>`).join('') + `<i class="dk-h rot" data-h="rot" style="transform:scale(${k});top:${-28 * k}px" title="Drehen"></i>`;
      sl.appendChild(h);
    }
    // beim Ziehen nur die Lage ändern (schnell, Bilder flackern nicht)
    function place(list) {
      const box = host.box();
      if (!box) return;
      for (const e of list) {
        const n = box.querySelector(`.dk-el[data-id="${e.id}"]`);
        if (n) { n.style.cssText = pos(e) + ';' + look(e); if (e.ff && fontOk(e.ff)) n.style.fontFamily = fontCss(e.ff); }
        if (n && (e.t === 'shape' || e.t === 'table')) { const nn = elNode(e, host.theme()); nn.className = n.className; n.replaceWith(nn); }
      }
      const h = box.querySelector('.dk-handles');
      if (h && list[0]) h.style.cssText = pos(list[0]);
    }

    // ---------------------------------------------------------------- Menüband (immer sichtbar; was nicht passt, ist grau)
    function renderFmt() {
      const bar = host.fmtBar();
      if (!bar) return;
      const list = ED.sel.map(byId).filter(Boolean);
      const e = list[0] || null, has = !!e, multi = list.length > 1;
      const line = !!e && isLine(e), open = !!e && isOpen(e);
      const textish = !!e && (e.t === 'text' || e.t === 'table' || (e.t === 'shape' && !line && !open));
      const shapeish = !!e && (e.t === 'shape' || e.t === 'text' || e.t === 'img');
      const dis = (en) => (en ? '' : ' disabled');
      const svg = (ic) => `<svg viewBox="0 0 24 24">${ic}</svg>`;
      // kleiner Knopf (Symbol, optional Text), großer Knopf, Farbknopf mit ▾, Auswahlmenü mit ▾
      const sb = (f, title, ic, o = {}) => `<button type="button" class="rb-s${o.on ? ' on' : ''}${o.label ? ' lab' : ''}" data-f="${f}"${o.v != null ? ` data-v="${o.v}"` : ''} title="${esc(title)}" aria-label="${esc(title)}"${dis(o.en !== false)}>${svg(ic)}${o.label ? `<span>${esc(o.label)}</span>` : ''}</button>`;
      const big = (attr, label, ic, en = true, dd = false) => `<button type="button" class="rb-big" ${attr} title="${esc(label)}"${dis(en)}>${svg(ic)}<span>${esc(label)}${dd ? ' ▾' : ''}</span></button>`;
      const cb = (f, title, cur, none, ic, en) => `<button type="button" class="dk-cb" data-pal="${f}" data-none="${none ? 1 : ''}" title="${esc(title)}" aria-label="${esc(title)}"${dis(en)}>${ic}<span class="cb-bar${cur ? '' : ' empty'}" style="background:${cur || 'transparent'}"></span><b>▾</b></button>`;
      const mb = (m, title, ic, en = true, label) => `<button type="button" class="rb-s dd${label ? ' lab' : ''}" data-menu="${m}" title="${esc(title)}" aria-label="${esc(title)}"${dis(en)}>${svg(ic)}${label ? `<span>${esc(label)}</span>` : ''}<b>▾</b></button>`;
      const grp = (cap, inner, cls = '') => `<div class="rb-grp ${cls}">${inner}<span class="rb-cap">${esc(cap)}</span></div>`;
      const rows = (...r) => `<div class="rb-col">${r.map((x) => `<div class="rb-row">${x}</div>`).join('')}</div>`;
      const sep = '<span class="rb-sep"></span>';
      const shBtn = (k, l) => `<button type="button" class="rb-sh" data-ins="shape:${k}" title="${esc(l)} – klicken oder aufziehen" aria-label="${esc(l)}">${svg(shapeIc(k))}</button>`;
      const kit = { grp, rows, big, sb, mb, cb, svg, sep, e, has, list };
      const tabs = [['start', 'Start'], ['insert', 'Einfügen'], ...(host.tabs ? host.tabs() : [])];
      if (!tabs.some((t) => t[0] === RB.tab)) RB.tab = 'start';
      let h = '';
      if (RB.tab === 'start') {
        if (host.ribbonPre) h += host.ribbonPre(kit, 'start');
        // Zwischenablage
        const canPaste = !!(ED.clip || (host.clipboard && host.clipboard()));
        h += grp('Zwischenablage', big('data-f="paste"', 'Einfügen', RI.paste, canPaste) + rows(sb('cut', 'Ausschneiden (Strg+X)', RI.cut, { en: has, label: 'Ausschneiden' }), sb('copy', 'Kopieren (Strg+C)', ICON.dup, { en: has, label: 'Kopieren' }),
          sb('painter', 'Format übertragen: erst ein Objekt wählen, dann hier klicken, dann das Ziel anklicken', RI.painter, { en: has, label: 'Format übertragen', on: !!ED.painter })));
        // Schriftart
        const fs0 = e ? Math.round(e.fs || 24) : '';
        const sizes = !e || SIZES.includes(fs0) ? SIZES : [...SIZES, fs0].sort((x, y) => x - y);
        const ff0 = (e && e.ff) || host.theme().font || 'sans';
        h += grp('Schriftart', rows(
          fontSelect(ff0, textish) +
          `<select data-f="fs" class="rb-size" title="Schriftgröße"${dis(textish)}>${e ? '' : '<option></option>'}${sizes.map((x) => `<option value="${x}"${x === fs0 ? ' selected' : ''}>${x}</option>`).join('')}</select>` +
          sb('fs+', 'Schrift vergrößern', RI.grow, { en: textish }) + sb('fs-', 'Schrift verkleinern', RI.shrink, { en: textish }) + sb('clear', 'Formatierung löschen', RI.clear, { en: textish }),
          `<button type="button" class="rb-s rb-t" data-f="bold" title="Fett (Strg+B)"${dis(textish)}><b>F</b></button><button type="button" class="rb-s rb-t" data-f="italic" title="Kursiv (Strg+I)"${dis(textish)}><i>K</i></button><button type="button" class="rb-s rb-t" data-f="underline" title="Unterstrichen (Strg+U)"${dis(textish)}><u>U</u></button>` +
          sb('strike', 'Durchgestrichen', RI.strike, { en: textish }) + sb('sup', 'Hochgestellt (x²)', RI.sup, { en: textish }) + sb('sub', 'Tiefgestellt (x₂)', RI.sub, { en: textish }) + sep +
          cb('hl', 'Texthervorhebung (Marker)', ED.lastHl || '#FFE066', true, svg(RI.marker), textish) + cb('color', 'Schriftfarbe', ED.lastColor || '#D6262B', false, '<span class="cb-a">A</span>', textish)));
        // Absatz
        const va = e && e.t !== 'table' ? (e.va || (e.t === 'shape' ? 'm' : 't')) : '';
        const vaOk = textish && e.t !== 'table';
        h += grp('Absatz', rows(
          sb('ul', 'Aufzählung', RI.ul, { en: textish }) + sb('ol', 'Nummerierung', RI.ol, { en: textish }) + sep + sb('outdent', 'Einzug verkleinern', RI.outdent, { en: textish }) + sb('indent', 'Einzug vergrößern', RI.indent, { en: textish }) + sep + mb('lh', 'Zeilenabstand', RI.lh, textish),
          sb('al', 'Linksbündig', RI.al, { v: 'left', en: textish }) + sb('al', 'Zentriert', RI.ac, { v: 'center', en: textish }) + sb('al', 'Rechtsbündig', RI.ar, { v: 'right', en: textish }) + sb('al', 'Blocksatz', RI.aj, { v: 'justify', en: textish }) + sep +
          sb('va', 'Oben ausrichten', RI.vt, { v: 't', en: vaOk, on: va === 't' }) + sb('va', 'Mittig ausrichten', RI.vm, { v: 'm', en: vaOk, on: va === 'm' }) + sb('va', 'Unten ausrichten', RI.vb, { v: 'b', en: vaOk, on: va === 'b' })));
        // Zeichnen
        const gal = `<div class="rb-gal">${QUICK_SHAPES.map((k) => shBtn(k, (SHAPES.find((x) => x[0] === k) || [k, k])[1])).join('')}</div><button type="button" class="rb-galmore" data-menu="shapes" title="Alle Formen">▾</button>`;
        const lw0 = e ? (e.lw || (line ? 3 : 2)) : 2;
        h += grp('Zeichnen', gal + big('data-menu="arrange"', 'Anordnen', RI.arrange, has, true) + rows(
          cb('fill', 'Fülleffekt', e && e.fill, true, svg(ICON.fill), !!e && ((e.t === 'shape' && !line && !open) || e.t === 'text')) + mb('fx', 'Effekte: Schatten, Transparenz, Spiegeln', RI.fx, has),
          cb('line', 'Formkontur', e && (e.line || (e.t === 'table' ? '#868E96' : line || open ? host.theme().fg : '')), e ? e.t !== 'table' && !line && !open : true, svg(ICON.line), shapeish || (!!e && e.t === 'table')),
          `<select data-f="lw" class="rb-lw" title="Linienstärke"${dis(!!e && (e.t === 'shape' || e.t === 'text' || e.t === 'img'))}>${[0.5, 1, 2, 3, 4, 6, 8, 12].map((v) => `<option value="${v}"${v === lw0 ? ' selected' : ''}>${v} pt</option>`).join('')}</select>`), 'rb-draw');
        // je nach Auswahl: Tabelle, Bild
        if (e && e.t === 'table') {
          h += grp('Tabelle', rows(sb('row+', 'Zeile darunter einfügen', RI.rowAdd, { label: 'Zeile' }) + sb('col+', 'Spalte rechts einfügen', RI.colAdd, { label: 'Spalte' }),
            sb('row-', 'Zeile löschen', RI.rowDel, { label: 'Zeile' }) + sb('col-', 'Spalte löschen', RI.colDel, { label: 'Spalte' })) + big('data-f="head"', 'Kopfzeile', ICON.table, true), 'ctx');
        }
        if (e && e.t === 'img') h += grp('Bild', big('data-f="imgreset"', 'Originalform', ICON.img, true), 'ctx');
        // Bearbeiten
        h += grp('Bearbeiten', rows(sb('replace', 'Suchen und Ersetzen', RI.replace, { label: 'Ersetzen …', en: true }), sb('selall', 'Alles auswählen (Strg+A)', RI.selall, { label: 'Alles auswählen', en: els().length > 0 }), sb('x:del', 'Löschen (Entf)', ICON.del, { label: 'Löschen', en: has })));
      } else if (RB.tab === 'insert') {
        if (host.ribbonPre) h += host.ribbonPre(kit, 'insert');
        h += grp('Tabellen', big('data-ins="table"', 'Tabelle', ICON.table));
        h += grp('Bilder', big('data-ins="img"', 'Bild', ICON.img));
        h += grp('Formen', `<div class="rb-gal rb-gal-all">${SHAPES.map(([k, l]) => shBtn(k, l)).join('')}</div>`);
        h += grp('Text', big('data-ins="text"', 'Textfeld', ICON.textbox));
        if (host.insertExtra) h += host.insertExtra(kit);
      } else if (host.tabContent) h += host.tabContent(RB.tab, kit);
      bar.innerHTML = `<div class="rb-tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" class="rb-tab${k === RB.tab ? ' on' : ''}" data-tab="${k}">${esc(l)}</button>`).join('')}</div><div class="rb-body">${h}</div>`;
      bar.hidden = false;
      if (e && e.t === 'table' && e.head) { const hb = bar.querySelector('[data-f="head"]'); if (hb) hb.classList.add('on'); }
      const insK = ED.insert || (host.insertKind && host.insertKind());
      if (insK) bar.querySelectorAll(`[data-ins="${insK}"]`).forEach((x) => x.classList.add('on'));
      bar.onmousedown = (ev) => { if (!ev.target.closest('select')) ev.preventDefault(); }; // Auswahl im Text bleibt erhalten
      bar.onpointerdown = (ev) => ev.stopPropagation();
      bar.onclick = (ev) => {
        const t = ev.target.closest('button');
        if (!t || t.disabled) return;
        if (t.dataset.tab) { RB.tab = t.dataset.tab; try { C.ls('rbTab', RB.tab); } catch (er) { /* */ } renderFmt(); return; }
        if (t.dataset.ins) { if (host.onIns) host.onIns(t.dataset.ins); else ins(t.dataset.ins); return; }
        if (t.dataset.pal) { palette(t, t.dataset.pal, !!t.dataset.none); return; }
        if (t.dataset.menu) { menu(t.dataset.menu, t); return; }
        if (t.dataset.f) fmt(t.dataset.f, t.dataset.v, t);
      };
      bar.onchange = (ev) => { const sl = ev.target.closest('select[data-f]'); if (sl) fmt(sl.dataset.f, sl.value); };
    }
    // Auswahlmenüs im Menüband
    function menu(m, btn) {
      const r = btn.getBoundingClientRect(), x = r.left, y = r.bottom + 4;
      const n = ED.sel.length;
      if (m === 'arrange') {
        const word = host.alignWord ? 'Seite' : 'Folie';
        popMenu(x, y, [
          ['front', 'In den Vordergrund', () => act('front', btn)], ['back', 'In den Hintergrund', () => act('back', btn)], ['-', ''],
          ...(n > 1 ? [['al', 'Links ausrichten', () => fmt('aln', 'l')], ['ac', 'Horizontal zentrieren', () => fmt('aln', 'c')], ['ar', 'Rechts ausrichten', () => fmt('aln', 'r')],
            ['at', 'Oben ausrichten', () => fmt('aln', 't')], ['am', 'Vertikal zentrieren', () => fmt('aln', 'm')], ['ab', 'Unten ausrichten', () => fmt('aln', 'b')]] : []),
          ...(n > 2 ? [['dh', 'Horizontal verteilen', () => fmt('dist', 'h')], ['dv', 'Vertikal verteilen', () => fmt('dist', 'v')]] : []),
          ['ap', `Ausrichten an der ${word} …`, () => act('align', btn)], ['-', ''],
          ...(n > 1 ? [['g', 'Gruppieren', () => fmt('group')]] : []), ...(ED.sel.some((id) => (byId(id) || {}).g) ? [['ug', 'Gruppierung aufheben', () => fmt('ungroup')]] : []),
          ['r90', 'Um 90° drehen', () => fmt('rot90')], ['r0', 'Drehung zurücksetzen', () => fmt('rot0')],
          ['fh', 'Horizontal spiegeln', () => fmt('flip', 'x')], ['fv', 'Vertikal spiegeln', () => fmt('flip', 'y')], ['-', ''],
          ['dup', 'Duplizieren (Strg+D)', () => act('dup')],
        ]);
        return;
      }
      if (m === 'lh') { popMenu(x, y, [['1', '1,0'], ['1.15', '1,15'], ['1.2', '1,2 (Standard)'], ['1.5', '1,5'], ['2', '2,0'], ['2.5', '2,5']].map(([v, l]) => [v.replace('.', '_'), l, () => fmt('lh', v)])); return; }
      if (m === 'fx') {
        const e = byId(ED.sel[0]) || {};
        popMenu(x, y, [
          ['sh', (e.sh ? '✓ ' : '') + 'Schatten', () => fmt('sh')], ['-', ''],
          ...[[1, 'Deckend (0 %)'], [0.75, 'Transparenz 25 %'], [0.5, 'Transparenz 50 %'], [0.25, 'Transparenz 75 %']].map(([v, l]) => ['o' + v, ((e.op ?? 1) === v ? '✓ ' : '') + l, () => fmt('op', v)]), ['-', ''],
          ['fh', 'Horizontal spiegeln', () => fmt('flip', 'x')], ['fv', 'Vertikal spiegeln', () => fmt('flip', 'y')],
        ]);
        return;
      }
      if (m === 'shapes') { gallery(btn); return; }
      if (host.menu) host.menu(m, btn);
    }
    // alle Formen nach Gruppen (wie die Formen-Auswahl in Office)
    function gallery(btn) {
      document.querySelectorAll('.dk-gal-pop').forEach((g) => g.remove());
      const g = document.createElement('div');
      g.className = 'dk-gal-pop';
      g.innerHTML = SHAPE_GROUPS.map(([cap, l]) => `<div class="gp-cap">${esc(cap)}</div><div class="gp-row">${l.map(([k, n]) => `<button type="button" data-ins="shape:${k}" title="${esc(n)}"><svg viewBox="0 0 24 24">${shapeIc(k)}</svg></button>`).join('')}</div>`).join('');
      document.body.appendChild(g);
      const r = btn.getBoundingClientRect();
      g.style.left = Math.max(4, Math.min(r.left - 200, innerWidth - g.offsetWidth - 8)) + 'px';
      g.style.top = Math.min(r.bottom + 4, innerHeight - g.offsetHeight - 8) + 'px';
      g.onpointerdown = (ev) => ev.stopPropagation();
      g.onclick = (ev) => { const b = ev.target.closest('[data-ins]'); if (!b) return; g.remove(); if (host.onIns) host.onIns(b.dataset.ins); else ins(b.dataset.ins); };
      setTimeout(() => document.addEventListener('pointerdown', function off(ev) { if (!g.contains(ev.target)) { g.remove(); document.removeEventListener('pointerdown', off, true); } }, true), 0);
    }
    // Farbauswahl unter einem Knopf (Text bleibt markiert)
    function palette(btn, f, none) {
      document.querySelectorAll('.dk-pal').forEach((m) => m.remove());
      const m = document.createElement('div');
      m.className = 'dk-pal';
      m.innerHTML = (none ? '<button type="button" class="none" data-v="">Ohne</button>' : '') + COLORS.map((c) => `<button type="button" class="sw" data-v="${c}" style="--c:${c}" title="${c}"></button>`).join('');
      document.body.appendChild(m);
      const r = btn.getBoundingClientRect();
      m.style.left = Math.max(4, Math.min(r.left, innerWidth - m.offsetWidth - 8)) + 'px';
      m.style.top = Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8) + 'px';
      m.onmousedown = (ev) => ev.preventDefault();
      m.onpointerdown = (ev) => ev.stopPropagation();
      m.onclick = (ev) => { const b = ev.target.closest('[data-v]'); if (!b) return; m.remove(); if (f === 'color') ED.lastColor = b.dataset.v; if (f === 'hl' && b.dataset.v) ED.lastHl = b.dataset.v; fmt(f, b.dataset.v); };
      setTimeout(() => document.addEventListener('pointerdown', function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } }, true), 0);
    }
    // Format anwenden: im Bearbeiten auf die Markierung, sonst aufs ganze Element
    function fmt(f, v, btn) {
      const ids = ED.sel.slice();
      const each = (fn) => change(() => ids.forEach((id) => { const e = byId(id); if (e) fn(e); }), true);
      if (f.startsWith('x:')) { act(f.slice(2), btn); return; }
      if (f === 'paste') { if (host.onPaste) host.onPaste(); else pasteEls(); return; }
      if (f === 'copy') { copy(); C.toast('Kopiert – mit „Einfügen“ oder Strg+V einsetzen.', 2500); render(); return; }
      if (f === 'cut') { copy(); act('del'); return; }
      if (f === 'selall') { select(els().map((x) => x.id)); return; }
      if (f === 'rot90') { each((x) => { x.r = ((x.r || 0) + 90) % 360; }); return; }
      if (f === 'rot0') { each((x) => { x.r = 0; }); return; }
      if (f === 'fs+' || f === 'fs-') { each((x) => { const c = x.fs || 24; x.fs = f === 'fs+' ? (SIZES.find((z) => z > c) || c + 8) : ([...SIZES].reverse().find((z) => z < c) || Math.max(4, c - 2)); }); return; }
      if (f === 'lh') { each((x) => { if (+v === 1.2) delete x.lh; else x.lh = +v; }); return; }
      if (f === 'sh') { const on = !(byId(ids[0]) || {}).sh; each((x) => { if (on) x.sh = 1; else delete x.sh; }); return; }
      if (f === 'op') { each((x) => { if (+v >= 1) delete x.op; else x.op = +v; }); return; }
      if (f === 'flip') { const k = v === 'y' ? 'fy' : 'fx'; each((x) => { if (x[k]) delete x[k]; else x[k] = 1; }); return; }
      if (f === 'group') { if (ids.length < 2) return; const g = uid(); each((x) => { x.g = g; }); C.toast('Gruppiert – die Objekte bewegen sich jetzt gemeinsam.', 2500); return; }
      if (f === 'ungroup') { each((x) => { delete x.g; }); return; }
      if (f === 'aln' || f === 'dist') { arrangeSel(f, v); return; }
      if (f === 'painter') {
        if (ED.painter) { ED.painter = null; renderFmt(); return; }
        const src = byId(ids[0]);
        if (!src) return;
        ED.painter = {};
        for (const k of PAINT_KEYS) if (src[k] != null) ED.painter[k] = src[k];
        ED.painter.__keys = PAINT_KEYS.filter((k) => src[k] == null);
        C.toast('Jetzt das Objekt anklicken, das genauso aussehen soll.', 3500);
        renderFmt();
        return;
      }
      if (f === 'replace') { replaceDlg(); return; }
      const inline = ['bold', 'italic', 'underline', 'color', 'ul', 'ol', 'al', 'clear', 'indent', 'outdent', 'strike', 'sup', 'sub', 'hl'];
      if (inline.includes(f)) {
        if (ED.edit) { execFmt(f, v); const n = host.box() && host.box().querySelector('.dk-el.editing'); if (n) syncEdit(n); return; }
        // ganzes Feld: kurz alles markieren, anwenden, fertig
        each((e) => {
          const tmp = document.createElement('div');
          tmp.contentEditable = 'true'; tmp.style.cssText = 'position:fixed;left:-9999px;top:0';
          document.body.appendChild(tmp);
          if (e.t === 'table') {
            e.rows = e.rows.map((row) => row.map((cell) => { tmp.innerHTML = clean(cell) || '&#8203;'; selAll(tmp); execFmt(f, v); return clean(tmp.innerHTML.replace(/​/g, '')); }));
          } else if (e.html !== undefined || e.t === 'shape') {
            tmp.innerHTML = clean(e.html || '') || '&#8203;'; selAll(tmp); execFmt(f, v); e.html = clean(tmp.innerHTML.replace(/​/g, ''));
          }
          tmp.remove();
        });
        return;
      }
      if (f === 'fs') { each((e) => { e.fs = +v; }); return; }
      if (f === 'ff') {
        if (v === '@local') { loadLocal().then(() => renderFmt()); renderFmt(); return; }
        if (!fontOk(v)) return;
        each((e) => { e.ff = v; });
        if (document.fonts) document.fonts.load(`16px ${fontCss(v).split(',')[0]}`).then(() => { if (grow()) render(); }).catch(() => {});
        return;
      }
      if (f === 'va') { each((e) => { e.va = v; }); return; }
      if (f === 'fill') { each((e) => { if (v) e.fill = v; else delete e.fill; }); return; }
      if (f === 'line') { each((e) => { if (v) e.line = v; else delete e.line; }); return; }
      if (f === 'lw') { each((e) => { e.lw = +v; }); return; }
      const e = byId(ids[0]);
      if (!e) return;
      if (f === 'imgreset' && e.t === 'img') { change(() => { const a = (e.iw || e.w) / (e.ih || e.h); e.h = r1(e.w / a); }, true); return; }
      if (e.t === 'table') {
        const cols = e.rows[0].length;
        const cell = ED.edit && ED.edit.cell;
        const ri = cell ? cell[0] : e.rows.length - 1, ci = cell ? cell[1] : cols - 1;
        endEdit();
        change(() => {
          if (f === 'row+') { e.rows.splice(ri + 1, 0, Array(cols).fill('')); e.h = r1(e.h + e.h / (e.rows.length - 1)); }
          if (f === 'row-' && e.rows.length > 1) { e.h = r1(e.h - e.h / e.rows.length); e.rows.splice(ri, 1); }
          if (f === 'col+') { e.rows.forEach((r) => r.splice(ci + 1, 0, '')); e.cw = Array(cols + 1).fill(1 / (cols + 1)); }
          if (f === 'col-' && cols > 1) { e.rows.forEach((r) => r.splice(ci, 1)); e.cw = Array(cols - 1).fill(1 / (cols - 1)); }
          if (f === 'head') e.head = !e.head;
        }, true);
      }
    }
    const PAINT_KEYS = ['ff', 'fs', 'c', 'fill', 'line', 'lw', 'va', 'lh', 'op', 'sh', 'pad'];
    // mehrere Objekte zueinander ausrichten oder gleichmäßig verteilen
    function arrangeSel(f, v) {
      const list = ED.sel.map(byId).filter(Boolean);
      if (list.length < 2) return;
      const L = Math.min(...list.map((e) => e.x)), T = Math.min(...list.map((e) => e.y)), R = Math.max(...list.map((e) => e.x + e.w)), B = Math.max(...list.map((e) => e.y + e.h));
      change(() => {
        if (f === 'aln') list.forEach((e) => {
          if (v === 'l') e.x = r1(L); if (v === 'r') e.x = r1(R - e.w); if (v === 'c') e.x = r1((L + R) / 2 - e.w / 2);
          if (v === 't') e.y = r1(T); if (v === 'b') e.y = r1(B - e.h); if (v === 'm') e.y = r1((T + B) / 2 - e.h / 2);
        });
        if (f === 'dist' && list.length > 2) {
          const hz = v === 'h';
          const so = [...list].sort((a, b) => (hz ? a.x - b.x : a.y - b.y));
          const total = so.reduce((a, e) => a + (hz ? e.w : e.h), 0);
          const gap = ((hz ? R - L : B - T) - total) / (so.length - 1);
          let p = hz ? L : T;
          so.forEach((e) => { if (hz) e.x = r1(p); else e.y = r1(p); p += (hz ? e.w : e.h) + gap; });
        }
      }, true);
    }
    // Text in allen Feldern ersetzen (nur der sichtbare Text, Formatierung bleibt)
    async function replaceDlg() {
      endEdit();
      const find = await C.askText('Suchen und Ersetzen', 'Suchen nach:', '', 'Weiter');
      if (!find) return;
      const repl = await C.askText('Suchen und Ersetzen', `„${find}“ ersetzen durch:`, '', 'Alle ersetzen');
      if (repl == null) return;
      let n = 0;
      if (host.replaceAll) n = host.replaceAll(find, repl);
      else change(() => { n = replaceInEls(els(), find, repl); }, true);
      C.toast(n ? `${n}× ersetzt.` : `„${find}“ wurde nicht gefunden.`, 3500);
    }
    function selAll(n) { const r = document.createRange(); r.selectNodeContents(n); const s = getSelection(); s.removeAllRanges(); s.addRange(r); n.focus(); }
    function execFmt(f, v) {
      document.execCommand('styleWithCSS', false, false);
      if (f === 'bold' || f === 'italic' || f === 'underline') document.execCommand(f);
      else if (f === 'color') { document.execCommand('styleWithCSS', false, true); document.execCommand('foreColor', false, v); }
      else if (f === 'ul') document.execCommand('insertUnorderedList');
      else if (f === 'ol') document.execCommand('insertOrderedList');
      else if (f === 'al') document.execCommand(v === 'center' ? 'justifyCenter' : v === 'right' ? 'justifyRight' : v === 'justify' ? 'justifyFull' : 'justifyLeft');
      else if (f === 'clear') document.execCommand('removeFormat');
      else if (f === 'strike') document.execCommand('strikeThrough');
      else if (f === 'sup') document.execCommand('superscript');
      else if (f === 'sub') document.execCommand('subscript');
      else if (f === 'hl') { document.execCommand('styleWithCSS', false, true); document.execCommand('hiliteColor', false, v || 'transparent'); }
      else if (f === 'indent' || f === 'outdent') document.execCommand(f);
    }

    // ---------------------------------------------------------------- Text bearbeiten (wie in PowerPoint: Feld anklicken, dann tippen)
    function startEdit(id, ev) {
      const e = byId(id);
      if (!e || e.t === 'img' || isLine(e)) return;
      if (ED.edit && ED.edit.id === id) return;
      endEdit();
      ED.sel = [id];
      ED.edit = { id, before: JSON.stringify(e), snap: host.snap(), cell: null };
      if (e.t === 'table' && ev) { const td = ev.target.closest && ev.target.closest('td'); if (td) ED.edit.cell = [+td.dataset.r, +td.dataset.c]; else if (document.elementFromPoint) { const t2 = document.elementsFromPoint(ev.clientX, ev.clientY).find((x) => x.tagName === 'TD'); if (t2) ED.edit.cell = [+t2.dataset.r, +t2.dataset.c]; } }
      if (e.t === 'shape' && !e.html) e.html = '<div style="text-align: center;"></div>';
      render();
      const box = host.box();
      const n = box && box.querySelector(`.dk-el[data-id="${id}"]`);
      if (!n) return;
      const tgt = e.t === 'table' ? n.querySelector(`td[data-r="${ED.edit.cell ? ED.edit.cell[0] : 0}"][data-c="${ED.edit.cell ? ED.edit.cell[1] : 0}"] .dk-cell`) : n.querySelector('.dk-tx');
      if (!tgt) return;
      // Platzhaltertext beim ersten Klick ganz markieren, sonst Schreibmarke an die Klickstelle
      if (n.classList.contains('dk-ph') || !ev) selAll(tgt);
      else if (document.caretRangeFromPoint) {
        const r = document.caretRangeFromPoint(ev.clientX, ev.clientY);
        tgt.focus();
        if (r && tgt.contains(r.startContainer)) { const s = getSelection(); s.removeAllRanges(); s.addRange(r); } else { const r2 = document.createRange(); r2.selectNodeContents(tgt); r2.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r2); }
      } else tgt.focus();
    }
    function reEdit(n) {
      const e = byId(ED.edit.id);
      if (!e) return;
      n.classList.add('editing', 'sel');
      if (e.t === 'table') {
        n.querySelectorAll('.dk-cell').forEach((c) => {
          c.contentEditable = 'true';
          c.addEventListener('focus', () => { const td = c.closest('td'); if (ED.edit) ED.edit.cell = [+td.dataset.r, +td.dataset.c]; });
          c.addEventListener('input', () => syncEdit(n));
          c.addEventListener('keydown', (ev) => { if (ev.key === 'Tab') { ev.preventDefault(); const all = [...n.querySelectorAll('.dk-cell')]; const i = all.indexOf(c); const nx = all[(i + (ev.shiftKey ? -1 : 1) + all.length) % all.length]; selAll(nx); } });
        });
      } else {
        const tx = n.querySelector('.dk-tx');
        if (!tx) return;
        tx.contentEditable = 'true';
        tx.addEventListener('input', () => syncEdit(n));
      }
    }
    function syncEdit(n) {
      const e = byId(ED.edit && ED.edit.id);
      if (!e) return;
      if (e.t === 'table') e.rows = e.rows.map((row, ri) => row.map((cell, ci) => { const c = n.querySelector(`td[data-r="${ri}"][data-c="${ci}"] .dk-cell`); return c ? clean(c.innerHTML) : cell; }));
      else e.html = clean(n.querySelector('.dk-tx').innerHTML);
      // Text wächst nach unten mit (wie in PowerPoint)
      const need = (e.t === 'table' ? n.querySelector('table') : n.querySelector('.dk-tx')).scrollHeight;
      if (need > e.h + 1 && e.t !== 'shape') { e.h = Math.min(host.H() * 2, need); n.style.height = e.h + 'px'; }
      if (host.typing) host.typing();
    }
    function endEdit() {
      if (!ED.edit) return;
      const ed = ED.edit;
      ED.edit = null;
      let e = byId(ed.id);
      let changed = !e;
      if (e) {
        if (e.t === 'text' && !plain(e.html) && !e.fill && !e.line) { // leeres Textfeld verschwindet
          host.setEls(els().filter((x) => x.id !== e.id));
          ED.sel = [];
          e = null; changed = true;
        } else if (e.t === 'shape' && !plain(e.html)) delete e.html;
        if (e && e.ph && JSON.stringify(e) !== ed.before) delete e.ph;
        if (e) changed = JSON.stringify(e) !== ed.before;
      }
      try { getSelection().removeAllRanges(); } catch (er) { /* */ }
      if (changed) host.commit(ed.snap);
      render();
    }

    // ---------------------------------------------------------------- Maus und Stift
    const toLocal = (ev) => { const r = host.box().getBoundingClientRect(); const k = host.k() || 1; return [(ev.clientX - r.left) / k, (ev.clientY - r.top) / k]; };
    // Element unter dem Zeiger (auch gedreht), oberstes zuerst
    function hit(x, y, tol = 3) {
      const list = els();
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        const cx = e.x + e.w / 2, cy = e.y + e.h / 2, a = -(e.r || 0) * Math.PI / 180;
        const lx = (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), ly = (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a);
        const t = isLine(e) ? Math.max(tol, 6) : tol;
        if (Math.abs(lx) <= e.w / 2 + t && Math.abs(ly) <= e.h / 2 + t) return e;
      }
      return null;
    }
    // Zeiger gedrückt; id = getroffenes Element (wenn der Aufrufer es schon kennt). Rückgabe true = erledigt
    function down(ev, id) {
      if (ev.button > 0) return false;
      if (ED.insert) { endEdit(); const kind = ED.insert; ED.insert = null; host.placing(false); ev.preventDefault(); drawInsert(kind, ev); return true; }
      const hEl = ev.target.closest && ev.target.closest('.dk-h');
      const n = id ? { dataset: { id } } : ev.target.closest && ev.target.closest('.dk-el');
      if (ED.edit && n && n.dataset.id === ED.edit.id) return true; // im Text: Schreibmarke setzen, markieren
      if (hEl) { ev.preventDefault(); startDrag(ev, hEl.dataset.h); return true; }
      if (!n) {
        const had = ED.edit || ED.sel.length;
        endEdit();
        if (ED.sel.length) { ED.sel = []; render(); }
        return !!had && !host.passThrough;
      }
      ev.preventDefault();
      const nid = n.dataset.id;
      const wasSel = ED.sel.includes(nid) && ED.sel.length === 1;
      if (ED.edit) endEdit();
      if (ED.painter) {
        // Format übertragen
        const st = ED.painter; ED.painter = null;
        change(() => { const t = byId(nid); if (!t) return; for (const k of PAINT_KEYS) if (st[k] != null) t[k] = st[k]; for (const k of st.__keys || []) delete t[k]; ED.sel = [nid]; }, true);
        return true;
      }
      if (ev.shiftKey || ev.ctrlKey) { ED.sel = ED.sel.includes(nid) ? ED.sel.filter((x) => x !== nid) : [...ED.sel, nid]; render(); return true; }
      const grpOf = (id) => { const g = (byId(id) || {}).g; return g ? els().filter((x) => x.g === g).map((x) => x.id) : [id]; };
      if (!ED.sel.includes(nid)) ED.sel = grpOf(nid);
      render();
      startDrag(ev, 'move', wasSel || (host.editOnFirstClick && host.editOnFirstClick(byId(nid))) ? nid : null);
      return true;
    }
    function startDrag(ev, mode, clickEdit) {
      const list = ED.sel.map(byId).filter(Boolean);
      if (!list.length) return;
      const [sx, sy] = toLocal(ev);
      const before = host.snap();
      const orig = list.map((e) => ({ x: e.x, y: e.y, w: e.w, h: e.h, r: e.r || 0 }));
      let moved = false;
      const pid = ev.pointerId;
      const tgt = host.stage();
      try { tgt.setPointerCapture(pid); } catch (e) { /* */ }
      const Wd = host.W(), Ht = host.H();
      const mv = (m) => {
        if (m.pointerId !== pid) return;
        m.stopPropagation();
        const [x, y] = toLocal(m);
        let dx = x - sx, dy = y - sy;
        if (!moved && Math.hypot(dx, dy) * (host.k() || 1) < 3) return;
        if (!moved && host.dragStart) host.dragStart();
        moved = true;
        if (mode === 'move') {
          // an der Mitte einrasten
          const o0 = orig[0];
          if (!m.altKey) {
            const cx = o0.x + dx + o0.w / 2, cy = o0.y + dy + o0.h / 2, sn = 6 / (host.k() || 1);
            if (Math.abs(cx - Wd / 2) < sn) dx = Wd / 2 - o0.w / 2 - o0.x;
            if (Math.abs(cy - Ht / 2) < sn) dy = Ht / 2 - o0.h / 2 - o0.y;
          }
          list.forEach((e, i) => { e.x = r1(orig[i].x + dx); e.y = r1(orig[i].y + dy); });
        } else if (mode === 'rot') {
          const e = list[0], o = orig[0];
          const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
          let a = Math.atan2(y - cy, x - cx) * 180 / Math.PI + 90;
          if (!m.shiftKey) { const s = Math.round(a / 15) * 15; if (Math.abs(a - s) < 4) a = s; }
          e.r = Math.round(((a % 360) + 360) % 360);
        } else {
          const e = list[0], o = orig[0];
          // im gedrehten Element rechnen
          const rad = (o.r || 0) * Math.PI / 180, cs = Math.cos(rad), sn = Math.sin(rad);
          const lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
          let nw = o.w, nh = o.h;
          if (mode.includes('e')) nw = o.w + lx;
          if (mode.includes('s')) nh = o.h + ly;
          if (mode.includes('w')) nw = o.w - lx;
          if (mode.includes('n')) nh = o.h - ly;
          const keep = (e.t === 'img' && !m.shiftKey) || (e.t !== 'img' && m.shiftKey && mode.length === 2);
          if (keep && mode.length === 2) { const a = o.w / o.h; if (nw / nh > a) nw = nh * a; else nh = nw / a; }
          const mn = 8 * u() * 0.5;
          nw = Math.max(mn, nw); nh = Math.max(isLine(e) ? 4 * u() : mn, nh);
          // feste Gegenecke: Position so verschieben, dass sie stehen bleibt
          const ax = mode.includes('w') ? o.w - nw : 0, ay = mode.includes('n') ? o.h - nh : 0;
          const ddx = ax + nw / 2 - o.w / 2, ddy = ay + nh / 2 - o.h / 2;
          const gx = ddx * cs - ddy * sn, gy = ddx * sn + ddy * cs;
          Object.assign(e, { x: r1(o.x + o.w / 2 + gx - nw / 2), y: r1(o.y + o.h / 2 + gy - nh / 2), w: r1(nw), h: r1(nh) });
        }
        place(list);
      };
      const up = (uev) => {
        if (uev.pointerId !== pid) return;
        uev.stopPropagation();
        tgt.removeEventListener('pointermove', mv, true); tgt.removeEventListener('pointerup', up, true); tgt.removeEventListener('pointercancel', up, true);
        if (moved) { host.commit(before); render(); }
        else if (clickEdit && mode === 'move') startEdit(clickEdit, uev);
      };
      tgt.addEventListener('pointermove', mv, true); tgt.addEventListener('pointerup', up, true); tgt.addEventListener('pointercancel', up, true);
    }

    // ---------------------------------------------------------------- Einfügen
    function insertAt(kind, x, y, rect) {
      const base = { id: uid(), r: 0 };
      const q = u();
      let e;
      if (kind === 'text') e = { ...base, t: 'text', x: x - 10 * q, y: y - 20 * q, w: r1(360 * q), h: r1(50 * q), fs: Math.round(24 * q), html: '' };
      else if (kind.startsWith('shape:')) {
        const k = kind.slice(6);
        const line = LINE_K.includes(k), open = OPEN_K.includes(k), narrow = /^bra/.test(k);
        const w0 = line ? 220 : narrow ? 40 : 180, h0 = line ? 20 : narrow ? 140 : 120;
        e = { ...base, t: 'shape', k, x: x - (line ? 0 : w0 / 2 * q), y: y - h0 / 2 * q, w: r1(w0 * q), h: r1(h0 * q), lw: line ? 3 : 2, fs: Math.round(20 * q) };
        if (line || open) e.line = host.theme().fg; else e.fill = host.theme().accent;
      }
      if (!e) return;
      if (host.pad != null) e.pad = host.pad;
      if (rect) {
        // aufgezogen: Rechteck übernehmen; Linien von Anfang bis Ende (gedreht)
        const [x0, y0, x1, y1] = rect;
        if (isLine(e)) {
          const len = Math.max(10 * q, Math.hypot(x1 - x0, y1 - y0));
          e.w = r1(len); e.x = r1((x0 + x1) / 2 - len / 2); e.y = r1((y0 + y1) / 2 - e.h / 2);
          e.r = Math.round(((Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI) + 360) % 360);
        } else {
          e.x = r1(Math.min(x0, x1)); e.y = r1(Math.min(y0, y1));
          e.w = r1(Math.max(12 * q, Math.abs(x1 - x0)));
          if (e.t !== 'text') e.h = r1(Math.max(12 * q, Math.abs(y1 - y0)));
          else e.h = r1(Math.max(e.h, Math.abs(y1 - y0)));
        }
      } else { e.x = r1(Math.max(0, e.x)); e.y = r1(Math.max(0, e.y)); }
      change(() => { els().push(e); ED.sel = [e.id]; }, true);
      if (e.t === 'text') startEdit(e.id, null);
    }
    // Einfügen per Klick (Standardgröße) oder Aufziehen (wie in PowerPoint)
    function drawInsert(kind, ev) {
      const [sx, sy] = toLocal(ev);
      const pid = ev.pointerId;
      const tgt = host.stage();
      try { tgt.setPointerCapture(pid); } catch (er) { /* */ }
      const surf = host.box() && host.box().querySelector('.dk-slide');
      const g = document.createElement('div');
      g.className = 'dk-ghost';
      let ex = sx, ey = sy, sq = false;
      const mv = (m) => {
        if (m.pointerId !== pid) return;
        m.stopImmediatePropagation();
        [ex, ey] = toLocal(m);
        sq = m.shiftKey;
        if (sq && !kind.endsWith('line') && !kind.endsWith('arrow')) { const d = Math.max(Math.abs(ex - sx), Math.abs(ey - sy)); ex = sx + Math.sign(ex - sx || 1) * d; ey = sy + Math.sign(ey - sy || 1) * d; }
        if (!surf) return;
        if (!g.parentNode) surf.appendChild(g);
        if (kind === 'shape:line' || kind === 'shape:arrow') {
          const len = Math.hypot(ex - sx, ey - sy), a = Math.atan2(ey - sy, ex - sx) * 180 / Math.PI;
          g.style.cssText = `left:${sx}px;top:${sy - 1}px;width:${len}px;height:2px;transform-origin:0 50%;transform:rotate(${a}deg)`;
        } else g.style.cssText = `left:${Math.min(sx, ex)}px;top:${Math.min(sy, ey)}px;width:${Math.abs(ex - sx)}px;height:${Math.abs(ey - sy)}px`;
      };
      const up = (uev) => {
        if (uev.pointerId !== pid) return;
        uev.stopImmediatePropagation();
        tgt.removeEventListener('pointermove', mv, true); tgt.removeEventListener('pointerup', up, true); tgt.removeEventListener('pointercancel', up, true);
        g.remove();
        if (Math.hypot(ex - sx, ey - sy) * (host.k() || 1) > 8) insertAt(kind, sx, sy, [sx, sy, ex, ey]);
        else insertAt(kind, sx, sy);
      };
      tgt.addEventListener('pointermove', mv, true); tgt.addEventListener('pointerup', up, true); tgt.addEventListener('pointercancel', up, true);
    }
    async function addImage(file) {
      try {
        C.toast('Bild wird eingefügt …', 20000);
        const f = await C.prepareImage(file);
        const res = await C.uploadImage(f);
        const iw = res.w || 800, ih = res.h || 600;
        const mw = host.W() * 0.6, mh = host.H() * 0.6;
        let w = Math.min(mw, iw), h = w * ih / iw;
        if (h > mh) { h = mh; w = h * iw / ih; }
        const [cx, cy] = host.center ? host.center() : [host.W() / 2, host.H() / 2];
        const e = { id: uid(), r: 0, t: 'img', src: res.src, iw, ih, x: r1(cx - w / 2), y: r1(cy - h / 2), w: r1(w), h: r1(h) };
        change(() => { els().push(e); ED.sel = [e.id]; }, true);
        C.toast('Bild eingefügt.', 1500);
      } catch (err) { C.toast(err.message); }
    }
    async function addTable() {
      const ask = await C.askText('Tabelle einfügen', 'Zeilen × Spalten, z. B. 3 × 4', '3 × 3', 'Einfügen');
      if (!ask) return;
      const m = ask.match(/(\d+)\D+(\d+)/);
      const q = u();
      const rows = Math.max(1, Math.min(30, m ? +m[1] : 3)), cols = Math.max(1, Math.min(12, m ? +m[2] : 3));
      const w = Math.min(host.W() - 100 * q, cols * 180 * q), h = rows * 44 * q;
      const [cx, cy] = host.center ? host.center() : [host.W() / 2, host.H() / 2];
      const e = { id: uid(), r: 0, t: 'table', x: r1(cx - w / 2), y: r1(Math.max(0, cy - h / 2)), w: r1(w), h: r1(h), fs: Math.round(18 * q), head: true, rows: Array.from({ length: rows }, () => Array(cols).fill('')), cw: Array(cols).fill(1 / cols) };
      change(() => { els().push(e); ED.sel = [e.id]; }, true);
    }
    function pasteEls() {
      if (!ED.clip) return;
      const q = u();
      const neu = ED.clip.map((e) => ({ ...clone(e), id: uid(), x: r1(e.x + 20 * q), y: r1(e.y + 20 * q) }));
      ED.clip = neu.map(clone);
      change(() => { els().push(...neu); ED.sel = neu.map((e) => e.id); }, true);
    }
    function copy() { ED.clip = ED.sel.map(byId).filter(Boolean).map(clone); if (host.copied) host.copied(ED.clip); }

    function alignMenu(x, y) {
      const al = (fn) => () => change(() => ED.sel.map(byId).filter(Boolean).forEach(fn), true);
      const mx = 40 * u(), my = 30 * u(), Wd = host.W(), Ht = host.H();
      popMenu(x, y, [
        ['l', host.alignWord ? 'Links an der Seite' : 'Links an der Folie', al((e) => { e.x = r1(mx); })], ['c', 'Waagerecht mittig', al((e) => { e.x = r1((Wd - e.w) / 2); })], ['r', host.alignWord ? 'Rechts an der Seite' : 'Rechts an der Folie', al((e) => { e.x = r1(Wd - mx - e.w); })],
        ['-', ''],
        ['t', host.alignWord ? 'Oben an der Seite' : 'Oben an der Folie', al((e) => { e.y = r1(my); })], ['m', 'Senkrecht mittig', al((e) => { e.y = r1((Ht - e.h) / 2); })], ['b', host.alignWord ? 'Unten an der Seite' : 'Unten an der Folie', al((e) => { e.y = r1(Ht - my - e.h); })],
      ]);
    }
    function startInsert(kind, msg) {
      endEdit();
      ED.insert = kind;
      host.placing(true, kind);
      if (msg) C.toast(msg, 4000);
    }
    // Knopf im Menüband „Einfügen“
    function ins(kind) {
      if (kind === 'img') { host.pickImage(); return; }
      if (kind === 'table') { addTable(); return; }
      if (ED.insert === kind) { ED.insert = null; host.placing(false); return; }
      startInsert(kind, host.alignWord ? 'Auf die Seite klicken oder mit gedrückter Maustaste aufziehen (Esc = abbrechen).' : 'Auf die Folie klicken oder mit gedrückter Maustaste aufziehen (Esc = abbrechen).');
    }
    function shapeMenu(x, y) {
      const k = [['rect', 'Rechteck'], ['round', 'Abgerundetes Rechteck'], ['ellipse', 'Kreis / Ellipse'], ['tri', 'Dreieck'], ['arrowR', 'Blockpfeil'], ['line', 'Linie'], ['arrow', 'Pfeil']];
      popMenu(x, y, k.map(([id, l]) => [id, l, () => startInsert('shape:' + id, host.alignWord ? 'Auf die Seite klicken, wo die Form hin soll (Esc = abbrechen).' : 'Auf die Folie klicken, wo die Form hin soll (Esc = abbrechen).')]));
    }
    // gemeinsame Knöpfe
    function act(a, b) {
      const r = b ? b.getBoundingClientRect() : { left: 200, bottom: 120 };
      if (a === 'text') { startInsert('text', host.alignWord ? 'Auf die Seite klicken, wo der Text hin soll.' : 'Auf die Folie klicken, wo der Text hin soll.'); return true; }
      if (a === 'img') { host.pickImage(); return true; }
      if (a === 'shape') { shapeMenu(r.left, r.bottom + 4); return true; }
      if (a === 'table') { addTable(); return true; }
      if (!['align', 'del', 'dup', 'front', 'back'].includes(a)) return false;
      if (!ED.sel.length) { C.toast(host.alignWord ? 'Bitte zuerst ein Objekt anklicken.' : 'Bitte zuerst etwas auf der Folie anklicken.'); return true; }
      if (a === 'align') { alignMenu(r.left, r.bottom + 4); return true; }
      endEdit();
      if (a === 'del') change(() => { host.setEls(els().filter((e) => !ED.sel.includes(e.id))); ED.sel = []; });
      if (a === 'dup') { copy(); pasteEls(); }
      if (a === 'front' || a === 'back') change(() => { const pick = els().filter((e) => ED.sel.includes(e.id)); const rest = els().filter((e) => !ED.sel.includes(e.id)); host.setEls(a === 'front' ? [...rest, ...pick] : [...pick, ...rest]); }, true);
      return true;
    }
    // Tasten: true = erledigt, 'edit' = gehört dem Text
    function key(ev) {
      const mod = ev.ctrlKey || ev.metaKey;
      const k = ev.key;
      if (ED.edit) {
        if (k === 'Escape') { ev.preventDefault(); const id = ED.edit.id; endEdit(); ED.sel = [id]; render(); return true; }
        return 'edit';
      }
      if (k === 'Escape') {
        if (!ED.insert && !ED.sel.length) return false;
        ED.insert = null; host.placing(false); ED.sel = []; render(); return true;
      }
      if (!ED.sel.length) return false;
      if (mod && k.toLowerCase() === 'd') { ev.preventDefault(); act('dup'); return true; }
      if (mod && k.toLowerCase() === 'c') { copy(); return true; }
      if (mod && k.toLowerCase() === 'x') { copy(); act('del'); return true; }
      if (mod && k.toLowerCase() === 'a') { ev.preventDefault(); ED.sel = els().map((e) => e.id); render(); return true; }
      if (k === 'Delete' || k === 'Backspace') { ev.preventDefault(); act('del'); return true; }
      if ((k === 'Enter' || k === 'F2') && ED.sel.length === 1) { ev.preventDefault(); startEdit(ED.sel[0], null); return true; }
      if (k.startsWith('Arrow')) {
        ev.preventDefault();
        const s = (ev.shiftKey ? 10 : 1) * (host.k() ? Math.max(0.25, 1 / host.k()) : 1);
        const dx = k === 'ArrowLeft' ? -s : k === 'ArrowRight' ? s : 0, dy = k === 'ArrowUp' ? -s : k === 'ArrowDown' ? s : 0;
        change(() => ED.sel.map(byId).filter(Boolean).forEach((e) => { e.x = r1(e.x + dx); e.y = r1(e.y + dy); }), true);
        return true;
      }
      return false;
    }
    function select(ids) { endEdit(); ED.sel = ids.filter((id) => byId(id)); render(); }
    Object.assign(ED, { change, render, renderStage, renderFmt, startEdit, endEdit, down, hit, act, key, addImage, addTable, pasteEls, copy, select, byId, insertAt, drawInsert, ins, toLocal });
    return ED;
  }

  // ------------------------------------------------------------------ Menüs
  function popMenu(x, y, items) {
    document.querySelectorAll('.dk-menu').forEach((m) => m.remove());
    const m = document.createElement('div');
    m.className = 'menu dk-menu';
    m.style.cssText = `position:fixed;left:${Math.max(4, Math.min(x, innerWidth - 260))}px;top:${Math.max(4, Math.min(y, innerHeight - items.length * 36 - 10))}px;z-index:60`;
    m.innerHTML = items.map(([a, l]) => (a === '-' ? '<span class="menu-sep"></span>' : `<button type="button" data-a="${a}">${l}</button>`)).join('');
    m.onpointerdown = (ev) => ev.stopPropagation();
    m.onclick = (ev) => { const b = ev.target.closest('[data-a]'); if (!b) return; m.remove(); const it = items.find((i) => i[0] === b.dataset.a); if (it && it[2]) it[2](); };
    document.body.appendChild(m);
    setTimeout(() => document.addEventListener('pointerdown', function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } }, true), 0);
  }

  // ================================================================== Präsentationen
  const ib = (id, ic, title, label) => `<button type="button" class="dk-b" data-a="${id}" title="${esc(title)}" aria-label="${esc(title)}"><svg viewBox="0 0 24 24">${ic}</svg>${label ? `<span>${esc(label)}</span>` : ''}</button>`;

  const deckHost = {
    box: () => D.root && $('.dk-box', D.root),
    stage: () => $('.dk-stage', D.root),
    fmtBar: () => D.root && D.deck && $('.dk-fmt', D.root),
    W: () => W, H: () => H, k: () => D.k || 1, unit: 1,
    els: () => (slide() ? slide().els : []),
    setEls: (a) => { if (slide()) slide().els = a; },
    theme: () => (D.deck ? theme() : DEF_TH),
    snap: () => snap(),
    commit(b) { if (b !== snap()) { D.undo.push(b); if (D.undo.length > 150) D.undo.shift(); D.redo = []; } renderList(); save(); },
    typing() { save(); clearTimeout(D.thumbT); D.thumbT = setTimeout(renderList, 500); },
    surface: () => (slide() ? slideNode(slide(), D.k || 1, true, theme()) : null),
    rendered: () => fit(),
    placing: (on, kind) => { if (!D.root) return; D.root.classList.toggle('dk-placing', !!on); D.root.querySelectorAll('[data-ins]').forEach((b) => b.classList.toggle('on', !!on && b.dataset.ins === kind)); },
    pickImage: () => $('.dk-file', D.root).click(),
    replaceAll: (f, r) => { let n = 0; D.ed.change(() => { for (const s0 of D.deck.slides) n += replaceInEls(s0.els, f, r); }, true); return n; },
    ribbonPre: ({ grp, rows, big, mb }) => grp('Folien', big('data-menu="newslide"', 'Neue Folie', RI.newslide, true, true) +
      rows(mb('layout', 'Layout dieser Folie', RI.layout, true, 'Layout'), mb('bg', 'Hintergrund', RI.bg, true, 'Hintergrund'), mb('design', 'Design aller Folien', RI.design, true, 'Design'))),
    menu: (m, btn) => {
      const r = btn.getBoundingClientRect(), x = r.left, y = r.bottom + 4;
      if (m === 'newslide') layoutMenu(x, y);
      if (m === 'layout') popMenu(x, y, Object.entries(LAYOUTS).map(([k, l]) => [k, esc(l.name), () => change(() => {
        // Platzhalter tauschen, eigene Inhalte bleiben
        const keep = slide().els.filter((e) => !e.ph);
        slide().els = [...newSlide(k).els, ...keep];
        D.ed.sel = [];
      })]));
      if (m === 'bg') bgMenu(x, y, false);
      if (m === 'design') designMenu(x, y);
    },
  };

  function build(root) {
    root.innerHTML = `
      <div class="dk-top">
        <input class="dk-title" aria-label="Name der Präsentation" maxlength="200">
        <span class="dk-sep"></span>
        ${ib('undo', ICON.undo, 'Rückgängig (Strg+Z)')}${ib('redo', ICON.redo, 'Wiederholen (Strg+Y)')}
        <span class="dk-grow"></span>
        <span class="dk-state muted small"></span>
        ${ib('play', ICON.play, 'Präsentieren (F5)', 'Präsentieren')}${ib('pdf', ICON.pdf, 'Als PDF speichern', 'PDF')}
      </div>
      <div class="dk-fmt rb-band"></div>
      <div class="dk-main">
        <aside class="dk-list" aria-label="Folien"></aside>
        <div class="dk-stage"><div class="dk-box"></div></div>
      </div>
      <input type="file" class="dk-file" accept="image/*" hidden>`;
    root.querySelector('.dk-top').onclick = (ev) => { const n = ev.target.closest('[data-ins]'); if (n) { if (D.deck) D.ed.ins(n.dataset.ins); return; } const b = ev.target.closest('[data-a]'); if (b) act(b.dataset.a, b); };
    const ti = $('.dk-title', root);
    ti.oninput = () => { D.deck.title = ti.value; save(); C.deckTitle(D.path, ti.value); };
    $('.dk-file', root).onchange = async (ev) => { const f = ev.target.files[0]; ev.target.value = ''; if (f) D.ed.addImage(f); };
    const stage = $('.dk-stage', root);
    new ResizeObserver(() => fit()).observe(stage);
    stage.addEventListener('pointerdown', (ev) => { if (D.deck) D.ed.down(ev); });
    stage.addEventListener('dblclick', (e) => { const n = e.target.closest('.dk-el'); if (n) D.ed.startEdit(n.dataset.id, e); });
  }

  // ------------------------------------------------------------------ Laden, Speichern
  async function open(path, root) {
    close();
    D.root = root; D.path = path; D.undo = []; D.redo = [];
    D.ed = makeEditor(deckHost);
    build(root);
    const r = await C.apiJson('deck', { params: { path } });
    if (D.path !== path) return;
    D.deck = r.deck;
    D.rev = r.deck.rev || 0;
    if (!Array.isArray(D.deck.slides)) D.deck.slides = [];
    if (!D.deck.slides.length) { D.deck.slides.push(newSlide('title')); save(); }
    D.cur = Math.min((C.ls('deckCur') || {})[path] || 0, D.deck.slides.length - 1);
    $('.dk-title', root).value = D.deck.title || '';
    C.deckTitle(path, D.deck.title);
    document.addEventListener('keydown', keys, true);
    document.addEventListener('paste', onPaste, true);
    renderAll();
  }
  function close() {
    if (!D.root) return;
    if (D.deck) D.ed.endEdit();
    flush();
    document.removeEventListener('keydown', keys, true);
    document.removeEventListener('paste', onPaste, true);
    const m = C.ls('deckCur') || {}; m[D.path] = D.cur; C.ls('deckCur', m);
    D.root = null; D.deck = null; D.path = '';
  }
  function state(t) { const s = D.root && $('.dk-state', D.root); if (s) s.textContent = t; }
  function save() {
    D.dirty = true;
    state('…');
    clearTimeout(D.saveT);
    D.saveT = setTimeout(flush, 900);
  }
  async function flush() {
    clearTimeout(D.saveT);
    if (!D.dirty || !D.deck) return;
    if (D.saving) { await D.saving; return flush(); }
    D.dirty = false;
    const path = D.path, deck = clone(D.deck);
    D.saving = (async () => {
      try {
        const r = await fetch(C.API + '?a=deck', { method: 'POST', credentials: 'same-origin', headers: { 'X-PDFStift': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ path, deck, rev: D.rev }) });
        const j = await r.json().catch(() => ({}));
        if (r.status === 409 && j.deck) {
          if (D.path === path) { D.deck = j.deck; D.rev = j.deck.rev; D.cur = Math.min(D.cur, D.deck.slides.length - 1); renderAll(); }
          C.toast('Diese Präsentation wurde inzwischen auf einem anderen Gerät geändert – der neueste Stand ist geladen.', 6000);
        } else if (!r.ok) throw new Error(j.error || 'Fehler ' + r.status);
        else if (D.path === path) { D.rev = j.rev; D.deck.rev = j.rev; state('Gespeichert'); }
      } catch (e) {
        if (D.path === path) { D.dirty = true; state('Nicht gespeichert'); D.saveT = setTimeout(flush, 5000); }
      }
    })();
    await D.saving; D.saving = null;
  }

  // ------------------------------------------------------------------ Änderungen mit Rückgängig
  function snap() { return JSON.stringify({ slides: D.deck.slides, theme: D.deck.theme, cur: D.cur }); }
  const change = (fn) => D.ed.change(fn);
  function restore(json) { const o = JSON.parse(json); D.deck.slides = o.slides; D.deck.theme = o.theme; D.cur = Math.min(o.cur, o.slides.length - 1); D.ed.sel = []; renderAll(); save(); }
  function undo() { D.ed.endEdit(); if (!D.undo.length) return; D.redo.push(snap()); restore(D.undo.pop()); }
  function redo() { D.ed.endEdit(); if (!D.redo.length) return; D.undo.push(snap()); restore(D.redo.pop()); }

  // ------------------------------------------------------------------ Darstellung
  function renderAll() { if (!D.root || !D.deck) return; renderList(); D.ed.render(); }
  function renderList() {
    if (!D.root || !D.deck) return;
    const list = $('.dk-list', D.root);
    list.innerHTML = '';
    const sc = 150 / W;
    D.deck.slides.forEach((s, i) => {
      const it = document.createElement('div');
      it.className = 'dk-thumb' + (i === D.cur ? ' cur' : '');
      it.draggable = true;
      it.innerHTML = `<span class="dk-no num">${i + 1}</span><div class="dk-mini" style="width:${W * sc}px;height:${H * sc}px"></div>`;
      it.querySelector('.dk-mini').appendChild(slideNode(s, sc, false, theme()));
      it.onclick = () => go(i);
      it.oncontextmenu = (ev) => { ev.preventDefault(); go(i); slideMenu(ev.clientX, ev.clientY); };
      it.ondragstart = (ev) => { ev.dataTransfer.setData('text/x-dk-slide', String(i)); ev.dataTransfer.effectAllowed = 'move'; };
      it.ondragover = (ev) => { if (ev.dataTransfer.types.includes('text/x-dk-slide')) { ev.preventDefault(); it.classList.add('drop'); } };
      it.ondragleave = () => it.classList.remove('drop');
      it.ondrop = (ev) => {
        ev.preventDefault(); it.classList.remove('drop');
        const from = +ev.dataTransfer.getData('text/x-dk-slide');
        if (Number.isNaN(from) || from === i) return;
        change(() => { const [s0] = D.deck.slides.splice(from, 1); D.deck.slides.splice(i, 0, s0); D.cur = i; });
      };
      list.appendChild(it);
    });
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'dk-add'; add.textContent = '+ Neue Folie';
    add.onclick = (ev) => layoutMenu(ev.clientX, ev.clientY);
    list.appendChild(add);
    const cur = list.children[D.cur];
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }
  function fit() {
    if (!D.root) return;
    const st = $('.dk-stage', D.root), box = $('.dk-box', D.root);
    const k = Math.max(0.1, Math.min((st.clientWidth - 48) / W, (st.clientHeight - 48) / H));
    const changed = Math.abs(k - (D.k || 0)) > 0.001;
    D.k = k;
    box.style.width = W * k + 'px'; box.style.height = H * k + 'px';
    const sl = $('.dk-slide', box);
    if (sl) sl.style.transform = `scale(${k})`;
    if (changed) box.querySelectorAll('.dk-h').forEach((h) => { h.style.transform = `scale(${1 / k})`; if (h.dataset.h === 'rot') h.style.top = -28 / k + 'px'; });
  }
  function go(i) {
    D.ed.endEdit();
    D.cur = Math.max(0, Math.min(i, D.deck.slides.length - 1));
    D.ed.sel = [];
    renderAll();
  }

  function layoutMenu(x, y) {
    popMenu(x, y, Object.entries(LAYOUTS).map(([k, l]) => [k, esc(l.name), () => change(() => { D.deck.slides.splice(D.cur + 1, 0, newSlide(k)); D.cur++; D.ed.sel = []; })]));
  }
  function slideMenu(x, y) {
    popMenu(x, y, [
      ['new', 'Neue Folie danach …', () => layoutMenu(x, y)],
      ['dup', 'Folie duplizieren', () => change(() => { const s = clone(slide()); s.id = uid(); s.els.forEach((e) => { e.id = uid(); }); D.deck.slides.splice(D.cur + 1, 0, s); D.cur++; })],
      ['bg', 'Hintergrund dieser Folie …', () => bgMenu(x, y, false)],
      ['-', ''],
      ['del', 'Folie löschen', () => { if (D.deck.slides.length < 2) { C.toast('Die letzte Folie bleibt.'); return; } change(() => { D.deck.slides.splice(D.cur, 1); D.cur = Math.min(D.cur, D.deck.slides.length - 1); }); }],
    ]);
  }
  function bgMenu(x, y, all) {
    const cols = ['#FFFFFF', '#F4F6FA', '#FFF8E7', '#1E2F6E', '#1A1A1A', '#0B3D2E'];
    popMenu(x, y, cols.map((c) => [c, `<span class="dk-sw" style="--c:${c};display:inline-block;vertical-align:middle;margin-right:8px"></span>${c}`, () => change(() => {
      if (all) { theme().bg = c; theme().fg = ['#1E2F6E', '#1A1A1A', '#0B3D2E'].includes(c) ? '#FFFFFF' : '#1A1A1A'; D.deck.slides.forEach((s) => delete s.bg); } else slide().bg = c;
    })]));
  }
  function designMenu(x, y) {
    const th = theme();
    popMenu(x, y, [
      ['bg', 'Hintergrund aller Folien …', () => bgMenu(x, y, true)],
      ['ac1', `<span class="dk-sw" style="--c:#1E2F6E;display:inline-block;vertical-align:middle;margin-right:8px"></span>Akzentfarbe Dunkelblau${th.accent === '#1E2F6E' ? ' ✓' : ''}`, () => change(() => { th.accent = '#1E2F6E'; })],
      ['ac2', `<span class="dk-sw" style="--c:#1B8A3A;display:inline-block;vertical-align:middle;margin-right:8px"></span>Akzentfarbe Grün${th.accent === '#1B8A3A' ? ' ✓' : ''}`, () => change(() => { th.accent = '#1B8A3A'; })],
      ['ac3', `<span class="dk-sw" style="--c:#D6262B;display:inline-block;vertical-align:middle;margin-right:8px"></span>Akzentfarbe Rot${th.accent === '#D6262B' ? ' ✓' : ''}`, () => change(() => { th.accent = '#D6262B'; })],
      ['-', ''],
      ['fs', 'Schrift: Helvetica/Arial' + (th.font !== 'serif' ? ' ✓' : ''), () => change(() => { th.font = 'sans'; })],
      ['ff', 'Schrift: Times' + (th.font === 'serif' ? ' ✓' : ''), () => change(() => { th.font = 'serif'; })],
    ]);
  }

  // ------------------------------------------------------------------ Knöpfe und Tasten
  function act(a, b) {
    const r = b ? b.getBoundingClientRect() : { left: 200, bottom: 120 };
    if (a === 'newslide') { layoutMenu(r.left, r.bottom + 4); return; }
    if (a === 'undo') { undo(); return; }
    if (a === 'redo') { redo(); return; }
    if (a === 'design') { designMenu(r.left, r.bottom + 4); return; }
    if (a === 'play') { present(); return; }
    if (a === 'pdf') { popMenu(r.left - 120, r.bottom + 4, [['dl', 'PDF herunterladen', () => exportPdf('download')], ['lib', 'PDF in „Meine PDFs“ ablegen (zum Beschreiben)', () => exportPdf('library')]]); return; }
    D.ed.act(a, b);
  }
  function onPaste(ev) {
    if (!D.root || D.root.hidden || D.ed.edit || ev.target.closest('input, textarea, [contenteditable="true"]')) return;
    const items = [...(ev.clipboardData ? ev.clipboardData.items : [])];
    const img = items.find((i) => i.type.startsWith('image/'));
    if (img) { ev.preventDefault(); D.ed.addImage(img.getAsFile()); return; }
    if (D.ed.clip) { ev.preventDefault(); D.ed.pasteEls(); }
  }
  function keys(ev) {
    if (!D.root || D.root.hidden || !D.deck || document.querySelector('dialog[open]') || D.show) return;
    const inField = ev.target.closest && ev.target.closest('input, textarea, select');
    const mod = ev.ctrlKey || ev.metaKey;
    if (D.ed.edit) {
      if (mod && ev.key.toLowerCase() === 'z') { ev.preventDefault(); undo(); return; }
      D.ed.key(ev);
      return; // sonst gehört die Taste dem Text
    }
    if (inField) return;
    const k = ev.key;
    if (k === 'F5') { ev.preventDefault(); present(); return; }
    if (mod && k.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
    if (mod && k.toLowerCase() === 'y') { ev.preventDefault(); redo(); return; }
    if (mod && k.toLowerCase() === 'a') { ev.preventDefault(); D.ed.select(slide().els.map((e) => e.id)); return; }
    if (D.ed.key(ev)) return;
    if ((k === 'PageDown' || (k === 'ArrowDown' && !D.ed.sel.length)) && D.cur < D.deck.slides.length - 1) { ev.preventDefault(); go(D.cur + 1); return; }
    if ((k === 'PageUp' || (k === 'ArrowUp' && !D.ed.sel.length)) && D.cur > 0) { ev.preventDefault(); go(D.cur - 1); }
  }

  // ------------------------------------------------------------------ Vortragen (einfach; Notizen und Referentenansicht folgen)
  function present() {
    D.ed.endEdit(); flush();
    const ov = document.createElement('div');
    ov.className = 'dk-show';
    document.body.appendChild(ov);
    let i = D.cur;
    D.show = true;
    const draw = () => {
      ov.innerHTML = '';
      const k = Math.min(innerWidth / W, innerHeight / H);
      const wrap = document.createElement('div');
      wrap.style.cssText = `position:absolute;left:${(innerWidth - W * k) / 2}px;top:${(innerHeight - H * k) / 2}px;width:${W * k}px;height:${H * k}px`;
      wrap.appendChild(slideNode(D.deck.slides[i], k, false, theme()));
      ov.appendChild(wrap);
    };
    const end = () => { D.show = false; document.removeEventListener('keydown', kd, true); window.removeEventListener('resize', draw); ov.remove(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); go(i); };
    const kd = (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(ev.key)) { if (i < D.deck.slides.length - 1) { i++; draw(); } else end(); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(ev.key)) { if (i > 0) { i--; draw(); } }
      else if (ev.key === 'Escape') end();
      else if (ev.key === 'Home') { i = 0; draw(); } else if (ev.key === 'End') { i = D.deck.slides.length - 1; draw(); }
    };
    ov.onclick = (ev) => { if (ev.clientX < innerWidth * 0.25) { if (i > 0) { i--; draw(); } } else if (i < D.deck.slides.length - 1) { i++; draw(); } else end(); };
    document.addEventListener('keydown', kd, true);
    window.addEventListener('resize', draw);
    draw();
    if (ov.requestFullscreen) ov.requestFullscreen().catch(() => {});
    document.addEventListener('fullscreenchange', function fc() { if (!document.fullscreenElement && D.show) { document.removeEventListener('fullscreenchange', fc); end(); } });
  }

  // ================================================================== Als PDF: echte Schrift (durchsuchbar), Formen als Vektoren
  const WIN = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.split(''));
  const winOk = (ch) => { const c = ch.charCodeAt(0); return (c >= 32 && c <= 126) || (c >= 160 && c <= 255) || WIN.has(ch); };
  function hexRgb(c) {
    const { rgb } = PDFLib;
    let m = /^#([0-9a-f]{6})$/i.exec(c || '');
    if (m) { const n = parseInt(m[1], 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); }
    m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || '');
    if (m) return rgb(+m[1] / 255, +m[2] / 255, +m[3] / 255);
    return rgb(0.1, 0.1, 0.1);
  }
  // HTML → Absätze mit Läufen [{t, b, i, u, c}]
  function paras(html, base) {
    const t = document.createElement('div');
    t.innerHTML = clean(html);
    const out = [];
    let curP = null;
    const newP = (al, list, lvl, num) => { curP = { runs: [], al: al || '', list, lvl, num }; out.push(curP); };
    const walk = (n, st, blk) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) { if (!curP) newP(blk.al, blk.list, blk.lvl, blk.num); curP.runs.push({ ...st, t: c.nodeValue.replace(/\s+/g, ' ') }); continue; }
        if (c.nodeType !== 1) continue;
        const tag = c.tagName.toLowerCase();
        if (tag === 'br') { newP(blk.al, null, blk.lvl, null); continue; }
        if (tag === 'ul' || tag === 'ol') {
          let k = 0;
          for (const li of c.children) { if (li.tagName.toLowerCase() !== 'li') continue; k++; const b2 = { al: li.style.textAlign || blk.al, list: tag, lvl: (blk.lvl || 0) + 1, num: k }; newP(b2.al, tag, b2.lvl, k); walk(li, st, b2); curP = null; }
          continue;
        }
        if (tag === 'div' || tag === 'li') { const b2 = { ...blk, al: c.style.textAlign || blk.al }; newP(b2.al, blk.list, blk.lvl, blk.num); walk(c, st, b2); curP = null; continue; }
        const s2 = { ...st };
        if (tag === 'b') s2.b = 1; if (tag === 'i') s2.i = 1; if (tag === 'u') s2.u = 1; if (tag === 's') s2.s = 1;
        if (tag === 'sup') { s2.sup = 1; delete s2.sub; } if (tag === 'sub') { s2.sub = 1; delete s2.sup; }
        if (tag === 'span' && c.style.color) s2.c = c.style.color;
        if (tag === 'span' && c.style.backgroundColor) s2.bg = c.style.backgroundColor;
        walk(c, s2, blk);
      }
    };
    walk(t, { c: base }, { al: '', list: null, lvl: 0, num: null });
    return out.filter((p, i) => p.runs.some((r) => r.t.trim()) || i < out.length - 1 || out.length === 1);
  }
  /* Zeichnet Elemente in eine PDF (pdf-lib). Vor drawEl muss der Aufrufer den Ursprung oben links setzen (y nach unten negativ).
   * K = Einheit → pt (Folie 0,75; PDF-Seite 1). */
  async function painter(doc, th, allEls) {
    const { StandardFonts, pushGraphicsState, popGraphicsState, concatTransformationMatrix } = PDFLib;
    th = th || DEF_TH;
    const STD = {
      sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
      serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
      mono: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
    };
    const fams = {};
    let kitOk = false;
    // Schriftfamilie für ein Element (eingebettet, nur benutzte Zeichen)
    await FM.ready;
    const famOf = async (ff) => {
      const base0 = th.font === 'serif' ? 'serif' : 'sans';
      ff = ff && fontOk(ff) ? ff : base0;
      if (fams[ff]) return fams[ff];
      if (STD[ff]) {
        const [r, b, i, bi] = await Promise.all(STD[ff].map((n) => doc.embedFont(n)));
        fams[ff] = { r, b, i, bi, custom: false };
        return fams[ff];
      }
      if (!kitOk) { await C.ensureFontkit(); doc.registerFontkit(window.fontkit); kitOk = true; }
      try {
        let get, has;
        if (ff.startsWith('L:')) {
          // Schrift dieses Computers
          const fam = ff.slice(2);
          if (!FM.localData && 'queryLocalFonts' in window) { try { FM.localData = await window.queryLocalFonts(); } catch (e) { /* */ } }
          const list = (FM.localData || []).filter((f) => f.family === fam);
          if (!list.length) throw new Error(`Die Schrift „${fam}“ gibt es auf diesem Gerät nicht`);
          const st = (re) => list.find((f) => re.test(f.style || ''));
          const pickS = { Regular: st(/^(regular|normal|book|roman|standard)$/i) || list.find((f) => !/bold|italic|oblique|light|black|thin|medium|semi|demi|condensed|narrow/i.test(f.style || '')) || list[0],
            Bold: st(/^(bold|fett)$/i), Italic: st(/^(italic|oblique|kursiv)$/i), BoldItalic: st(/^bold ?(italic|oblique)$/i) };
          has = (x) => !!pickS[x];
          get = async (x) => {
            const fd = pickS[x];
            const bin = ttcPick(new Uint8Array(await (await fd.blob()).arrayBuffer()), fd.postscriptName);
            if (!embedOk(bin)) throw new Error(`Die Schrift „${fam}“ darf laut Hersteller nicht in PDFs eingebettet werden`);
            return doc.embedFont(bin, { subset: true });
          };
        } else {
          const m = FM.by[ff];
          has = (x) => m.s.includes(x);
          get = async (x) => { const r = await fetch('vendor/fonts/' + m.f + '-' + x + '.ttf?v=' + C.VERSION); if (!r.ok) throw new Error('Schrift fehlt'); return doc.embedFont(new Uint8Array(await r.arrayBuffer()), { subset: true }); };
        }
        const r = await get('Regular');
        const b = has('Bold') ? await get('Bold') : r;
        const i = has('Italic') ? await get('Italic') : r;
        const bi = has('BoldItalic') ? await get('BoldItalic') : (has('Bold') ? b : i);
        fams[ff] = { r, b, i, bi, custom: true, set: new Set(r.getCharacterSet()) };
      } catch (err) {
        C.toast(err.message + ' – im PDF steht dort Helvetica.', 7000);
        fams[ff] = await famOf(base0);
      }
      return fams[ff];
    };
    const F = await famOf(th.font === 'serif' ? 'serif' : 'sans');
    let uni = null; // DejaVu für Zeichen außerhalb von WinAnsi (z. B. Pfeile, griechische Buchstaben)
    const needUni = (allEls || []).some((e) => [e.html || '', ...(e.rows || []).flat()].join('').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').split('').some((ch) => !winOk(ch) && ch !== '\n'));
    if (needUni) {
      if (!kitOk) { await C.ensureFontkit(); doc.registerFontkit(window.fontkit); kitOk = true; }
      const get = async (n) => new Uint8Array(await (await fetch('vendor/fonts/' + n + '?v=' + C.VERSION)).arrayBuffer());
      uni = { r: await doc.embedFont(await get('DejaVuSans.ttf'), { subset: true }), b: await doc.embedFont(await get('DejaVuSans-Bold.ttf'), { subset: true }) };
    }
    let FF = F; // Schrift des gerade gezeichneten Elements
    const fontOf = (r) => FF[(r.b ? 'b' : '') + (r.i ? 'i' : '') || 'r'] || FF.r;
    const fontCh = (ch, tok) => {
      const ok = FF.custom ? FF.set.has(ch.codePointAt(0)) : winOk(ch);
      return ok ? fontOf(tok) : (uni ? (tok.b ? uni.b : uni.r) : null);
    };
    const imgCache = new Map();
    const getImg = async (src) => {
      if (imgCache.has(src)) return imgCache.get(src);
      const bin = new Uint8Array(await (await fetch(imgUrl(src), { credentials: 'same-origin' })).arrayBuffer());
      let im;
      if (/\.png$/i.test(src)) im = await doc.embedPng(bin);
      else if (/\.jpe?g$/i.test(src)) im = await doc.embedJpg(bin);
      else { // GIF/WebP → PNG
        const bmp = await createImageBitmap(new Blob([bin]));
        const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height; cv.getContext('2d').drawImage(bmp, 0, 0);
        im = await doc.embedPng(new Uint8Array(await (await new Promise((r) => cv.toBlob(r, 'image/png'))).arrayBuffer()));
      }
      imgCache.set(src, im);
      return im;
    };
    // Schatten-Durchgang: alles in Schwarz, halb durchsichtig, versetzt
    let SH = false, OP = 1;
    const col = (c) => (SH ? PDFLib.rgb(0, 0, 0) : hexRgb(c));
    const opa = () => { const o = SH ? 0.3 * OP : OP; return o < 1 ? { opacity: o, borderOpacity: o } : {}; };
    const tsz = (tk, fs) => (tk.sup || tk.sub ? fs * 0.65 : fs);
    // Text in ein Rechteck setzen (w in Einheiten)
    const layoutText = (ps, fs, w) => {
      const lines = [];
      const width = (tok) => { let s0 = 0; const z = tsz(tok, fs); for (const ch of tok.t) { const f = fontCh(ch, tok) || fontOf(tok); try { s0 += f.widthOfTextAtSize(ch, z); } catch (e) { s0 += z * 0.5; } } return s0; };
      for (const p of ps) {
        const ind = p.list ? fs * 1.2 * p.lvl : 0;
        const maxW = Math.max(fs, w - ind);
        const toks = [];
        for (const r of p.runs) for (const part of r.t.split(/(\s+)/)) if (part) toks.push({ ...r, t: part });
        let line = [], lw = 0, first = true;
        const push = (last) => { lines.push({ toks: line, w: lw, al: p.al, ind, bullet: first ? p : null, last }); first = false; line = []; lw = 0; };
        for (const tk of toks) {
          const tw = width(tk);
          tk.w = tw;
          if (lw + tw > maxW && line.length && tk.t.trim()) { while (line.length && !line[line.length - 1].t.trim()) lw -= line.pop().w; push(false); }
          if (!line.length && !tk.t.trim()) continue;
          line.push(tk); lw += tw;
        }
        push(true);
      }
      return lines;
    };
    const drawRuns = (pg, ln, x0, yTop, fs, color, K, lhm, gap) => {
      let x = x0;
      const base = yTop + fs * (0.92 + (lhm - 1.2) / 2);
      for (const tk of ln.toks) {
        const z = tsz(tk, fs), dy = tk.sup ? -fs * 0.33 : tk.sub ? fs * 0.14 : 0;
        // Markerfarbe hinter dem Wort (auch über die Lücke zum nächsten Wort)
        if (tk.bg && !SH) pg.drawRectangle({ x: x * K, y: -(yTop + fs * lhm) * K, width: (tk.w + (gap || 0)) * K, height: fs * lhm * K, color: hexRgb(tk.bg), ...opa() });
        let seg = '', segF = null;
        const flush2 = () => {
          if (!seg) return;
          pg.drawText(seg, { x: x * K, y: -(base + dy) * K, size: z * K, font: segF, color: col(tk.c || color), ...(opa().opacity != null ? { opacity: opa().opacity } : {}) });
          const w = segF.widthOfTextAtSize(seg, z);
          const lineAt = (yy) => pg.drawLine({ start: { x: x * K, y: -yy * K }, end: { x: (x + w) * K, y: -yy * K }, thickness: Math.max(0.5, fs * 0.06 * K), color: col(tk.c || color), ...(opa().opacity != null ? { opacity: opa().opacity } : {}) });
          if (tk.u) lineAt(base + dy + z * 0.12);
          if (tk.s) lineAt(base + dy - z * 0.3);
          x += w; seg = '';
        };
        for (const ch of tk.t) {
          const f = fontCh(ch, tk);
          if (!f) continue;
          if (f !== segF) { flush2(); segF = f; }
          seg += ch;
        }
        flush2();
      }
    };
    const drawTextBox = (pg, html, x, y, w, h, fs, color, va, pad, K, lhm) => {
      lhm = lhm || 1.2;
      const lines = layoutText(paras(html, color), fs, w - 2 * pad);
      const lh = fs * lhm;
      const total = lines.reduce((a0, l) => a0 + lh + (l.last ? fs * 0.3 : 0), 0) - (lines.length ? fs * 0.3 : 0);
      let yy = y + pad + (va === 'm' ? Math.max(0, (h - 2 * pad - total) / 2) : va === 'b' ? Math.max(0, h - 2 * pad - total) : 0);
      for (const ln of lines) {
        const avail = w - 2 * pad - ln.ind;
        const lx = x + pad + ln.ind + (ln.al === 'center' ? (avail - ln.w) / 2 : ln.al === 'right' ? avail - ln.w : 0);
        if (ln.bullet && ln.bullet.list) {
          const mark = ln.bullet.list === 'ol' ? ln.bullet.num + '.' : '•';
          pg.drawText(mark, { x: (x + pad + ln.ind - fs * (ln.bullet.list === 'ol' ? 1.1 : 0.8)) * K, y: -(yy + fs * (0.92 + (lhm - 1.2) / 2)) * K, size: fs * K, font: FF.custom ? FF.r : F.r, color: col(color) });
        }
        // Blocksatz: Lücken gleichmäßig strecken (nicht in der letzten Zeile eines Absatzes)
        let gap = 0;
        if (ln.al === 'justify' && !ln.last) {
          const spaces = ln.toks.filter((t) => !t.t.trim()).length;
          if (spaces) { const extra = (avail - ln.w) / spaces; ln.toks.forEach((t) => { if (!t.t.trim()) t.w += extra; }); gap = 0; drawJust(pg, ln, lx, yy, fs, color, K, lhm, extra); yy += lh; continue; }
        }
        drawRuns(pg, ln, lx, yy, fs, color, K, lhm, gap);
        yy += lh + (ln.last ? fs * 0.3 : 0);
      }
    };
    // Blocksatz-Zeile: Wort für Wort setzen
    const drawJust = (pg, ln, x0, yTop, fs, color, K, lhm, extra) => {
      let x = x0;
      for (const tk of ln.toks) {
        if (!tk.t.trim()) { x += tk.w; continue; }
        drawRuns(pg, { toks: [tk] }, x, yTop, fs, color, K, lhm, 0);
        x += tk.w;
      }
      void extra;
    };
    async function drawEl(pg, e, K) {
      FF = await famOf(e.ff);
      OP = e.op != null ? Math.max(0, Math.min(1, e.op)) : 1;
      const cx = (e.x + e.w / 2) * K, cy = -(e.y + e.h / 2) * K;
      const a = -(e.r || 0) * Math.PI / 180;
      // zweimal zeichnen, wenn ein Schatten gewünscht ist: erst versetzt in Schwarz, dann normal
      for (const shadow of e.sh ? [true, false] : [false]) {
        SH = shadow;
        const d = shadow ? 3 * K : 0;
        pg.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, 1, d, -d), concatTransformationMatrix(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), cx, cy),
          concatTransformationMatrix(e.fx ? -1 : 1, 0, 0, e.fy ? -1 : 1, 0, 0), concatTransformationMatrix(1, 0, 0, 1, -e.w / 2 * K, e.h / 2 * K));
        try { await body(pg, e, K); } finally { pg.pushOperators(popGraphicsState()); }
      }
      SH = false; OP = 1;
    }
    // Inhalt eines Elements; lokaler Ursprung oben links am Element
    async function body(pg, e, K) {
      const lw = (e.lw || 2) * K;
      const pad = e.pad != null ? e.pad : 8;
      const box = (fill, line) => pg.drawRectangle({ x: 0, y: -e.h * K, width: e.w * K, height: e.h * K, color: fill ? col(fill) : undefined, borderColor: line ? col(line) : undefined, borderWidth: line ? lw : 0, ...opa() });
      if (e.t === 'text') {
        if (e.fill || e.line) box(e.fill, e.line);
        drawTextBox(pg, e.html || '', 0, 0, e.w, e.h, e.fs || 24, e.c || th.fg, e.va || 't', pad, K, e.lh);
      } else if (e.t === 'img') {
        if (SH) box('#000000', null);
        else try { const im = await getImg(e.src); pg.drawImage(im, { x: 0, y: -e.h * K, width: e.w * K, height: e.h * K, ...(OP < 1 ? { opacity: OP } : {}) }); } catch (err) { /* Bild fehlt */ }
        if (e.line) box(null, e.line);
      } else if (e.t === 'shape') {
        const line = isLine(e), open = isOpen(e);
        const sw = line || open ? (e.lw || (line ? 3 : 2)) : (e.line ? e.lw || 2 : 0);
        const stroke = e.line || (line || open ? th.fg : null);
        const opt = { x: 0, y: 0, scale: K, ...opa() };
        if (line) {
          const x0 = e.k === 'arrow2' ? sw / 2 : 0, x1 = e.k === 'line' ? e.w : e.w - sw / 2;
          pg.drawLine({ start: { x: x0 * K, y: -e.h / 2 * K }, end: { x: x1 * K, y: -e.h / 2 * K }, thickness: sw * K, color: col(stroke), lineCap: 1, ...(opa().opacity != null ? { opacity: opa().opacity } : {}) });
        } else if (open) {
          pg.drawSvgPath(shapePath(e.k, e.w, e.h), { ...opt, borderColor: col(stroke), borderWidth: sw * K, borderLineCap: 1 });
        } else {
          pg.drawSvgPath(shapePath(e.k, e.w, e.h), { ...opt, color: e.fill ? col(e.fill) : undefined, borderColor: e.line ? col(e.line) : undefined, borderWidth: e.line ? sw * K : 0 });
          if (e.html) drawTextBox(pg, e.html, 0, 0, e.w, e.h, e.fs || 20, e.c || (e.fill ? '#FFFFFF' : th.fg), e.va || 'm', e.pad != null ? e.pad : 10, K, e.lh);
        }
        for (const hd of arrowHeads(e, sw)) pg.drawSvgPath(hd, { ...opt, borderColor: col(stroke), borderWidth: sw * K, borderLineCap: 1 });
      } else if (e.t === 'table') {
        const rows = e.rows.length, cols = e.rows[0].length;
        const cw = e.cw || Array(cols).fill(1 / cols);
        const rh = e.h / rows;
        const cp = Math.max(1, Math.round((e.fs || 18) / 3));
        let yy = 0;
        for (let ri = 0; ri < rows; ri++) {
          let xx = 0;
          for (let ci = 0; ci < cols; ci++) {
            const w = e.w * cw[ci];
            const head = ri === 0 && e.head;
            pg.drawRectangle({ x: xx * K, y: -(yy + rh) * K, width: w * K, height: rh * K, color: head ? col(th.accent) : (SH ? col('#000000') : undefined), borderColor: col(e.line || '#868E96'), borderWidth: 0.75, ...opa() });
            if (!SH) drawTextBox(pg, (head ? '<b>' : '') + (e.rows[ri][ci] || '') + (head ? '</b>' : ''), xx, yy, w, rh, e.fs || 18, head ? '#FFFFFF' : th.fg, 'm', cp, K, e.lh);
            xx += w;
          }
          yy += rh;
        }
      }
    }
    return { drawEl };
  }
  async function exportPdf(where) {
    D.ed.endEdit(); await flush();
    C.toast('PDF wird erstellt …', 60000);
    try {
      const { PDFDocument, pushGraphicsState, popGraphicsState, concatTransformationMatrix } = PDFLib;
      const doc = await PDFDocument.create();
      doc.setTitle(D.deck.title || 'Präsentation');
      doc.setCreator('PDF-Stift');
      const th = theme();
      const P = await painter(doc, th, D.deck.slides.flatMap((s) => s.els));
      const K = 0.75; // Bildpunkt → pt
      for (const s of D.deck.slides) {
        const pg = doc.addPage([W * K, H * K]);
        // Ursprung oben links, y nach unten negativ
        pg.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, 1, 0, H * K));
        pg.drawRectangle({ x: 0, y: -H * K, width: W * K, height: H * K, color: hexRgb(s.bg || th.bg) });
        for (const e of s.els) if (!isPh(e)) await P.drawEl(pg, e, K);
        pg.pushOperators(popGraphicsState());
      }
      const bytes = await doc.save();
      const name = (D.deck.title || 'Präsentation').replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.pdf';
      const blob = new Blob([bytes], { type: 'application/pdf' });
      if (where === 'library') { await C.uploadPdf(blob, name); C.toast(`„${name}“ liegt jetzt in „Meine PDFs“.`, 5000); }
      else { C.downloadBlob(blob, name); C.toast('PDF gespeichert.', 2500); }
    } catch (err) { C.toast('PDF konnte nicht erstellt werden: ' + err.message, 8000); }
  }

  // kleine Vorschau einer Folie (Bibliothek)
  function preview(s, th, width) {
    const k = width / W;
    const box = document.createElement('div');
    box.style.cssText = `width:${W * k}px;height:${H * k}px;overflow:hidden;position:relative`;
    box.appendChild(slideNode(s || { els: [] }, k, false, th || DEF_TH));
    return box;
  }

  FM.ready.then(() => { if (D.root && D.deck) renderAll(); if (C.fontsReady) C.fontsReady(); });
  window.PDFSTIFT_DECK = { open, close, flush, preview, makeEditor, layerNode, elNode, painter, popMenu, clean, plain, insertGroup, ICON, replaceInEls };
})();
