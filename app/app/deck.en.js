/* Automatisch erzeugt aus deck.js (tools/i18n) – nicht von Hand ändern. */
/* PDF-Stift – Präsentationen: Folien bauen (Text, Bilder, Formen, Tabellen) und als PDF speichern.
 * Derselbe Bearbeitungskern (anklicken, ziehen, Größe, Drehen, Text formatieren) dient auch für Objekte auf PDF-Seiten.
 * Wird erst bei Bedarf geladen. Braucht window.PDFSTIFT_CORE (aus app.js). */
(() => {
  'use strict';
  const C = window.PDFSTIFT_CORE;
  const W = 960; // Folie in Bildpunkten: 960 × 540 (16:9) oder 960 × 720 (4:3); als PDF 0,75 pt je Bildpunkt
  let H = 540;
  const slideH = (th) => (th && th.size === '43' ? 720 : 540);
  const $ = (q, el = document) => el.querySelector(q);
  const esc = C.esc;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const r1 = (v) => Math.round(v * 10) / 10;
  const uid = () => Math.random().toString(36).slice(2, 10);
  // Schriften: drei PDF-Standardschriften, freie Schriften aus vendor/fonts (SIL Open Font License, Liste in fonts.json)
  // und auf Wunsch die Schriften dieses Computers (Windows-App, Chrome/Edge)
  const STD_FONTS = { sans: ['Helvetica / Arial', 'Helvetica, Arial, "Liberation Sans", sans-serif'], serif: ['Times', '"Times New Roman", Times, "Liberation Serif", serif'], mono: ['Courier', '"Courier New", Courier, "Liberation Mono", monospace'] };
  const CAT_FB = { sans: 'sans-serif', serif: 'serif', mono: 'monospace', hand: 'cursive', deco: 'sans-serif' };
  const FONT_CATS = [['sans', "Sans serif"], ['serif', "Serif"], ['mono', "Monospace"], ['hand', "Handwriting"], ['deco', "Display"]];
  const FM = { list: [], by: {}, local: null, localData: null };
  const cssq = (t) => String(t).replace(/["\\<>;{}]/g, '');
  function fontCss(k) {
    if (STD_FONTS[k]) return STD_FONTS[k][1];
    if (k && k.startsWith('L:')) {
      // fehlt die Schrift auf diesem Gerät: eine freie Schrift mit ähnlicher Laufweite statt der (oft breiteren) Systemschrift
      const nm = k.slice(2), serif = /serif(?!.*sans)|times|garamond|georgia|minion|book|roman|palatino|cambria|baskerville|caslon|bodoni|didot/i.test(nm) && !/sans/i.test(nm);
      const mono = /mono|courier|consol|\bcode\b/i.test(nm);
      return `"${cssq(nm)}", ${mono ? '"PS Cousine", monospace' : serif ? '"PS Tinos", serif' : '"PS Arimo", sans-serif'}`;
    }
    const m = FM.by[k];
    if (k === 'winetahoma') return '"Tahoma", "PS WineTahoma", sans-serif'; // echtes Tahoma, wo vorhanden (gleiche Laufweite)
    return m ? `"PS ${m.f}", ${CAT_FB[m.c] || 'sans-serif'}` : STD_FONTS.sans[1];
  }
  const fontOk = (k) => !!(STD_FONTS[k] || FM.by[k] || (k && k.startsWith('L:') && k.length < 110));
  // PowerPoint: Schriftname ↔ Schlüssel (metrisch gleiche freie Schriften für Calibri, Cambria …)
  const FONT_ALIAS = { tahoma: 'winetahoma', calibri: 'carlito', cambria: 'caladea', georgia: 'gelasio', 'comic sans ms': 'comicneue', arial: 'sans', helvetica: 'sans', 'times new roman': 'serif', times: 'serif', 'courier new': 'mono', courier: 'mono' };
  const FONT_OFFICE = { winetahoma: 'Tahoma', carlito: 'Calibri', caladea: 'Cambria', gelasio: 'Georgia', comicneue: 'Comic Sans MS', arimo: 'Arial', tinos: 'Times New Roman', cousine: 'Courier New', sans: 'Arial', serif: 'Times New Roman', mono: 'Courier New' };
  function fontKey(name) {
    const n = String(name || '').trim().replace(/\s+(regular|normal|standard)$/i, ''), l = n.toLowerCase().replace(/\s+(light|semilight)$/, '');
    if (!n) return '';
    if (FONT_ALIAS[l]) return FONT_ALIAS[l];
    const m = FM.list.find((x) => x.f.toLowerCase() === l.replace(/\s+/g, '') || x.n.replace(/\s*\(.*\)$/, '').toLowerCase() === l);
    return m ? m.k : 'L:' + n.slice(0, 100);
  }
  const fontOffice = (k) => FONT_OFFICE[k] || (k && k.startsWith('L:') ? k.slice(2) : FM.by[k] ? FM.by[k].n.replace(/\s*\(.*\)$/, '') : 'Arial');
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
    if (!('queryLocalFonts' in window)) { C.toast("This browser cannot show the computer's fonts – please use the Windows app, Chrome or Edge.", 6000); return false; }
    try {
      const all = await window.queryLocalFonts();
      FM.localData = all;
      FM.local = [...new Set(all.map((f) => f.family))].sort((a, b) => a.localeCompare(b, 'de'));
      if (!FM.local.length) C.toast("No fonts found – access was probably not allowed.", 6000);
      return true;
    } catch (e) { C.toast("Access to this computer's fonts was not allowed.", 5000); return false; }
  }
  // Schriftart-Auswahl (gruppiert, jede Schrift in ihrem eigenen Aussehen)
  function fontSelect(cur, en) {
    const opt = (k, n) => `<option value="${esc(k)}"${k === cur ? ' selected' : ''} style="font-family:${esc(fontCss(k))}">${esc(n)}</option>`;
    let h = `<select data-f="ff" class="rb-font" title="Font"${en ? '' : ' disabled'}><optgroup label="Standard">${Object.entries(STD_FONTS).map(([k, [n]]) => opt(k, n)).join('')}</optgroup>`;
    for (const [c, lab] of FONT_CATS) { const l = FM.list.filter((m) => m.c === c); if (l.length) h += `<optgroup label="${esc(lab)}">${l.map((m) => opt(m.k, m.n)).join('')}</optgroup>`; }
    if (cur && cur.startsWith('L:') && !(FM.local || []).includes(cur.slice(2))) h += `<optgroup label="Auf einem Computer">${opt(cur, cur.slice(2))}</optgroup>`;
    if (FM.local) h += `<optgroup label="Auf diesem Computer">${FM.local.map((f) => opt('L:' + f, f)).join('')}</optgroup>`;
    else if ('queryLocalFonts' in window) h += `<optgroup label="On this computer"><option value="@local">Show this computer's fonts …</option></optgroup>`;
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
    title: { name: "Title slide", els: () => [
      { t: 'text', x: 80, y: 170, w: 800, h: 110, fs: 48, va: 'b', html: "<div style=\"text-align: center;\"><b>Title</b></div>", ph: 1 },
      { t: 'text', x: 80, y: 300, w: 800, h: 70, fs: 24, html: "<div style=\"text-align: center;\">Subtitle</div>", ph: 1 },
    ] },
    content: { name: "Title and content", els: () => [
      { t: 'text', x: 50, y: 30, w: 860, h: 80, fs: 36, va: 'm', html: '<div><b>Titel</b></div>', ph: 1 },
      { t: 'text', x: 50, y: 125, w: 860, h: 380, fs: 24, html: "<ul><li>First point</li><li>Second point</li></ul>", ph: 1 },
    ] },
    two: { name: "Two columns", els: () => [
      { t: 'text', x: 50, y: 30, w: 860, h: 80, fs: 36, va: 'm', html: '<div><b>Titel</b></div>', ph: 1 },
      { t: 'text', x: 50, y: 125, w: 415, h: 380, fs: 22, html: "<ul><li>Left column</li></ul>", ph: 1 },
      { t: 'text', x: 495, y: 125, w: 415, h: 380, fs: 22, html: "<ul><li>Right column</li></ul>", ph: 1 },
    ] },
    only: { name: "Title only", els: () => [{ t: 'text', x: 50, y: 30, w: 860, h: 80, fs: 36, va: 'm', html: '<div><b>Titel</b></div>', ph: 1 }] },
    blank: { name: "Blank", els: () => [] },
  };
  const PH_TEXT = ["Title", "Subtitle", "First point Second point", "Left column", "Right column"];
  const plain = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  // unberührter Platzhalter: in der Bearbeitung grau, beim Vortragen und im PDF unsichtbar
  const isPh = (e) => !!(e.ph && e.t === 'text' && PH_TEXT.includes(plain(e.html)));
  const newSlide = (lay) => ({ id: uid(), els: (LAYOUTS[lay] || LAYOUTS.blank).els().map((e) => ({ id: uid(), r: 0, ...e, y: Math.round(e.y * H / 540), h: Math.round(e.h * H / 540) })) });
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
          // Absatzabstand wie in PowerPoint (vor/nach, in Schrifthöhen) – nur Abstände in em
          if (tag !== 'ul' && tag !== 'ol') {
            const em = (v) => { const m = /^(\d*\.?\d+)em$/.exec(v || ''); return m && +m[1] <= 6 ? Math.round(+m[1] * 1000) / 1000 : null; };
            const pt = em(st.paddingTop), pb = em(st.paddingBottom);
            if (pt != null || pb != null || st.margin === '0px' || (st.marginTop === '0px' && st.marginBottom === '0px')) { el.style.margin = '0'; if (pt) el.style.paddingTop = pt + 'em'; if (pb) el.style.paddingBottom = pb + 'em'; }
          }
          // eigener Zeilenabstand eines Absatzes (ohne Einheit, wie das Feld)
          if (tag !== 'ul' && tag !== 'ol' && /^\d*\.?\d+$/.test(st.lineHeight || '') && +st.lineHeight >= 0.5 && +st.lineHeight <= 4) el.style.lineHeight = String(Math.round(+st.lineHeight * 100) / 100);
          // Einzug eines Absatzes (links und hängend/erste Zeile, wie in PowerPoint) – nur in em
          if (tag === 'div' || tag === 'p') {
            const em2 = (v, lo) => { const m = /^(-?\d*\.?\d+)em$/.exec(v || ''); return m && +m[1] >= lo && +m[1] <= 20 ? Math.round(+m[1] * 1000) / 1000 : null; };
            const pl = em2(st.paddingLeft, 0), ti = em2(st.textIndent, -20);
            if (pl) el.style.paddingLeft = pl + 'em';
            if (ti && (pl || 0) + ti >= 0) el.style.textIndent = ti + 'em';
          }
          // eigenes Aufzählungszeichen (z. B. ▸ oder ✔) und seine Farbe
          if (tag === 'li') {
            const bu = n.getAttribute('data-bu');
            if (bu && [...bu].length <= 2 && !/[<>&"]/.test(bu)) el.setAttribute('data-bu', bu);
            const bc = n.getAttribute('data-bc');
            if (/^#[0-9a-f]{6}$/i.test(bc || '')) el.setAttribute('data-bc', bc);
            // Einzug wie in PowerPoint: Text um margin-left verschoben, Zeichen bei data-bi (em, links vom Text)
            const bi = /^(-\d*\.?\d+|0)$/.exec(n.getAttribute('data-bi') || ''), ml = /^(-?\d*\.?\d+)em$/.exec(st.marginLeft || '');
            if (bi && +bi[0] >= -20 && ml && Math.abs(+ml[1]) <= 20) { el.setAttribute('data-bi', String(Math.round(+bi[0] * 1000) / 1000)); el.style.marginLeft = Math.round(+ml[1] * 1000) / 1000 + 'em'; const bs = +n.getAttribute('data-bs'); if (bs >= 0.25 && bs <= 4) el.setAttribute('data-bs', String(bs)); }
          }
        } else if (tag === 'br') { dst.appendChild(document.createElement('br')); continue; }
        else if (tag === 'b' || tag === 'strong') el = document.createElement('b');
        else if (tag === 'i' || tag === 'em') el = document.createElement('i');
        else if (tag === 'u') el = document.createElement('u');
        else if (tag === 's' || tag === 'strike' || tag === 'del') el = document.createElement('s');
        else if (tag === 'sup' || tag === 'sub') el = document.createElement(tag);
        else if (tag === 'a') {
          const href = (n.getAttribute('href') || '').trim();
          if (/^(https?:\/\/|mailto:)/i.test(href)) { el = document.createElement('a'); el.setAttribute('href', href); el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener'); }
        }
        else if (tag === 'span' || tag === 'font') {
          const c = st.color || n.getAttribute('color');
          const bg = st.backgroundColor && !/transparent|rgba\(0, 0, 0, 0\)/.test(st.backgroundColor) ? st.backgroundColor : '';
          const bold = /bold|[6-9]00/.test(st.fontWeight || ''), it = st.fontStyle === 'italic', un = /underline/.test(st.textDecoration || st.textDecorationLine || ''), lt = /line-through/.test(st.textDecoration || st.textDecorationLine || '');
          const va = st.verticalAlign;
          el = document.createElement('span');
          if (c) el.style.color = c;
          const fz = /^(\d*\.?\d+)em$/.exec(st.fontSize || '');
          if (fz && +fz[1] >= 0.2 && +fz[1] <= 5 && Math.abs(+fz[1] - 1) > 0.005) el.style.fontSize = (Math.round(+fz[1] * 1000) / 1000) + 'em';
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
  const mediaUrl = (src) => C.API + '?a=media&src=' + encodeURIComponent(src);
  // Abspielknopf auf Videos (Bearbeiten, Vorführen): Video an die Stelle des Vorschaubilds setzen
  document.addEventListener('pointerdown', (ev) => {
    const b = ev.target.closest && ev.target.closest('.dk-play');
    if (!b) return;
    const n = b.closest('.dk-el');
    if (!n || !n.dataset.vid || n.closest('.dk-thumb, .dk-sorter, .pr-next')) return;
    ev.preventDefault(); ev.stopPropagation();
    const audio = /\.(mp3|m4a|wav)$/.test(n.dataset.vid);
    const v = document.createElement(audio ? 'audio' : 'video');
    v.className = 'dk-video'; v.src = mediaUrl(n.dataset.vid); v.controls = true; v.autoplay = true; v.playsInline = true;
    const im = n.querySelector('img');
    if (!audio && im) v.poster = im.src;
    if (!audio && im) im.replaceWith(v); else n.appendChild(v);
    b.remove();
  }, true);
  // Formen als SVG-Pfad im Rechteck w × h (gleiche Geometrie für Bildschirm und PDF)
  const P2 = (pts) => 'M' + pts.map(([x, y]) => `${+x.toFixed(2)} ${+y.toFixed(2)}`).join('L') + 'Z';
  const star = (w, h, n, ri) => P2(Array.from({ length: n * 2 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / n, r = i % 2 ? ri : 1; return [w / 2 + Math.cos(a) * w / 2 * r, h / 2 + Math.sin(a) * h / 2 * r]; }));
  const ngon = (w, h, n) => P2(Array.from({ length: n }, (_, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [w / 2 + Math.cos(a) * w / 2, h / 2 + Math.sin(a) * h / 2]; }));
  function brace(w, h, flip) {
    const X = (x) => (flip ? w - x : x), m = w / 2;
    return `M${X(w)} 0C${X(m)} 0 ${X(m)} 0 ${X(m)} ${h * 0.12}V${h * 0.38}C${X(m)} ${h * 0.5} ${X(0)} ${h * 0.5} ${X(0)} ${h * 0.5}C${X(0)} ${h * 0.5} ${X(m)} ${h * 0.5} ${X(m)} ${h * 0.62}V${h * 0.88}C${X(m)} ${h} ${X(m)} ${h} ${X(w)} ${h}`;
  }
  // freie Form (aus PowerPoint): Pfad in 0…1000 × 0…1000, nur M L C Q Z – auf w × h strecken
  function scalePath(d, w, h) {
    let i = 0;
    return String(d || '').replace(/-?\d*\.?\d+(e-?\d+)?/gi, (n) => { const v = +n * (i++ % 2 ? h : w) / 1000; return String(Math.round(v * 100) / 100); });
  }
  function pathEnds(d) {
    const pts = []; const re = /-?\d*\.?\d+/g; let m; const nums = [];
    while ((m = re.exec(d))) nums.push(+m[0]);
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    return pts;
  }
  function shapePath(kind, w, h, e) {
    if (kind === 'path') return scalePath(e && e.d, w, h);
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
    if (e.k === 'path' && e.ah) {
      const P = pathEnds(scalePath(e.d, e.w, e.h));
      const head = (tip, from) => { const dx = tip[0] - from[0], dy = tip[1] - from[1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l; return `M${tip[0] - ux * L - uy * B} ${tip[1] - uy * L + ux * B}L${tip[0]} ${tip[1]}L${tip[0] - ux * L + uy * B} ${tip[1] - uy * L - ux * B}`; };
      if (P.length > 1 && /[eb]/.test(e.ah)) out.push(head(P[P.length - 1], P[P.length - 2]));
      if (P.length > 1 && /[sb]/.test(e.ah)) out.push(head(P[0], P[1]));
    }
    if (e.k === 'elbow' && e.head !== 0) out.push(`M${e.w - L} ${e.h - B}L${e.w} ${e.h}L${e.w - L} ${e.h + B}`);
    return out;
  }
  const pos = (e) => `left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${e.h}px;transform:rotate(${e.r || 0}deg)${e.fx || e.fy ? ` scale(${e.fx ? -1 : 1},${e.fy ? -1 : 1})` : ''}`;
  const look = (e) => `${e.op != null && e.op < 1 ? `opacity:${e.op};` : ''}${e.sh ? 'filter:drop-shadow(3px 3px 2.5px rgba(0,0,0,.35));' : ''}`;
  // ------------------------------------------------------------------ Animationen (Objekte oder Absätze nacheinander einblenden)
  const AN_LIST = [['', "None"], ['appear', "Appear"], ['fade', "Fade"], ['fly', "Fly in"], ['zoom', "Zoom"]];
  const AN_IC = {
    '': '<circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/>', appear: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 12h6"/>',
    fade: '<rect x="5" y="5" width="14" height="14" rx="2" stroke-dasharray="2.5 2"/><path d="M9 9h6M9 12h6M9 15h4"/>', fly: '<rect x="7" y="4" width="11" height="10" rx="1.5"/><path d="M12 21v-4M9.5 19.5L12 17l2.5 2.5"/>',
    zoom: '<rect x="8" y="8" width="8" height="8" rx="1"/><path d="M4 4l3 3M20 4l-3 3M4 20l3-3M20 20l-3-3"/>',
  };
  const animOrder = (s) => s.els.map((e, i) => ({ e, i })).filter((x) => x.e.an).sort((a, b) => (a.e.ao ?? a.i) - (b.e.ao ?? b.i) || a.i - b.i).map((x) => x.e);
  function animUnits(n, e) {
    if (!e.ap) return [n];
    const tx = n.querySelector('.dk-tx');
    if (!tx) return [n];
    const out = [];
    for (const c of tx.children) { if (/^(UL|OL)$/.test(c.tagName)) out.push(...[...c.children].filter((x) => x.tagName === 'LI')); else if (c.textContent.trim()) out.push(c); }
    return out.length ? out : [n];
  }
  // n Schritte sichtbar; der letzte wird bei animate eingeblendet. Liefert die Zahl aller Schritte.
  function applySteps(wrap, s, n, animate) {
    if (!wrap || !s) return 0;
    const steps = [];
    let prev = null;
    for (const e of animOrder(s)) {
      const node = wrap.querySelector(`.dk-el[data-id="${e.id}"]`);
      if (!node) continue;
      // gleiche Nummer (z. B. eine Gruppe aus PowerPoint): ein gemeinsamer Schritt
      if (prev && !e.ap && !prev.ap && e.ao != null && e.ao === prev.ao) steps[steps.length - 1].push({ u: node, k: e.an });
      else for (const u of animUnits(node, e)) steps.push([{ u, k: e.an }]);
      prev = e;
    }
    steps.forEach((st, i) => st.forEach((x) => { x.u.classList.toggle('an-hid', i >= n); x.u.classList.remove('an-in', 'an-appear', 'an-fade', 'an-fly', 'an-zoom'); }));
    const last = steps[n - 1];
    if (animate && last) last.forEach((x) => { void x.u.offsetWidth; x.u.classList.add('an-in', 'an-' + x.k); });
    return steps.length;
  }
  // verbundene Tabellenzellen: e.mg = [[Zeile, Spalte, Zeilen, Spalten], …]
  function mergeMap(e) {
    const R = e.rows.length, Cn = e.rows[0] ? e.rows[0].length : 0, span = {}, hid = new Set();
    for (const m of e.mg || []) {
      if (!Array.isArray(m)) continue;
      const [r, c] = m;
      if (!(r >= 0 && c >= 0 && r < R && c < Cn) || hid.has(r + ',' + c) || span[r + ',' + c]) continue;
      const rs = Math.max(1, Math.min(m[2] || 1, R - r)), cs = Math.max(1, Math.min(m[3] || 1, Cn - c));
      let clash = false;
      for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) if ((i || j) && (hid.has((r + i) + ',' + (c + j)) || span[(r + i) + ',' + (c + j)])) clash = true;
      if (clash || rs * cs < 2) continue;
      span[r + ',' + c] = [rs, cs];
      for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) if (i || j) hid.add((r + i) + ',' + (c + j));
    }
    return { span, hid };
  }
  // nach dem Einfügen/Löschen von Zeilen oder Spalten die Verbindungen mitschieben
  function mergeShift(e, axis, idx, d) {
    if (!e.mg) return;
    const a = axis === 'r' ? 0 : 1, n = axis === 'r' ? 2 : 3;
    e.mg = e.mg.map((m) => {
      m = m.slice();
      if (d > 0) { if (m[a] >= idx) m[a] += 1; else if (m[a] + m[n] > idx) m[n] += 1; }
      else if (m[a] > idx) m[a] -= 1; else if (m[a] + m[n] > idx) m[n] -= 1;
      return m;
    }).filter((m) => m[2] * m[3] >= 2 && m[2] >= 1 && m[3] >= 1);
    if (!e.mg.length) delete e.mg;
  }
  // Farbverlauf einer Form (aus PowerPoint): e.gr = { s: [[pos, farbe, deckkraft]], ang, rad }
  function gradDefs(e) {
    if (!e.gr || e.k !== 'path' || !Array.isArray(e.gr.s)) return '';
    const stops = e.gr.s.map(([p, c, a]) => `<stop offset="${p}" stop-color="${c}"${a != null && a < 1 ? ` stop-opacity="${a}"` : ''}/>`).join('');
    if (e.gr.rad) return `<defs><radialGradient id="gr-${e.id}" cx="0.5" cy="0.5" r="0.71">${stops}</radialGradient></defs>`;
    const a = ((e.gr.ang || 0) * Math.PI) / 180, c = Math.cos(a) / 2, s0 = Math.sin(a) / 2;
    return `<defs><linearGradient id="gr-${e.id}" x1="${0.5 - c}" y1="${0.5 - s0}" x2="${0.5 + c}" y2="${0.5 + s0}">${stops}</linearGradient></defs>`;
  }
  // Zeilenhöhen einer Tabelle als Anteile (aus PowerPoint übernommen oder gleich hoch)
  // raw: Mindesthöhen wie in PowerPoint (Anteile an der Feldhöhe, Summe ≤ 1) – sonst auf die Feldhöhe verteilt
  function tblRows(e, raw) {
    const n = e.rows.length;
    if (Array.isArray(e.rh) && e.rh.length === n) {
      const sum = e.rh.reduce((a, b) => a + (+b || 0), 0) || 1;
      return e.rh.map((v) => (+v || 0) / (raw && sum <= 1.001 ? 1 : sum));
    }
    return Array(n).fill(1 / n);
  }
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
      if (e.fill) n.style.background = e.fo != null ? `color-mix(in srgb, ${e.fill} ${Math.round(e.fo * 100)}%, transparent)` : e.fill;
      if (e.line) n.style.boxShadow = `inset 0 0 0 ${e.lw || 2}px ${e.line}`;
      n.appendChild(tx);
    } else if (e.t === 'img') {
      const im = document.createElement('img');
      im.src = imgUrl(e.src); im.alt = ''; im.draggable = false;
      n.appendChild(im);
      if (e.vid) {
        // Video oder Ton aus PowerPoint: Vorschaubild mit Abspielknopf; ein Klick spielt es an Ort und Stelle ab
        n.dataset.vid = e.vid;
        n.insertAdjacentHTML('beforeend', `<button type="button" class="dk-play" title="Play" aria-label="Play"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11"/><path d="M10 8l6 4-6 4z"/></svg></button>`);
      }
      if (e.line) n.style.boxShadow = `inset 0 0 0 ${e.lw || 2}px ${e.line}`;
    } else if (e.t === 'shape') {
      const lineK = isLine(e), openK = isOpen(e);
      const sw = lineK || openK ? Math.max(0.5, e.lw || (lineK ? 3 : 2)) : (e.line ? e.lw || 2 : 0);
      const hp = sw / 2;
      const stroke = e.line || (lineK || openK ? th.fg : 'none');
      const heads = arrowHeads(e, sw).map((d) => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
      const pad2 = sw * 3; // Platz für Pfeilspitzen am Rand
      n.innerHTML = `<svg viewBox="${-hp - pad2} ${-hp - pad2} ${e.w + sw + 2 * pad2} ${e.h + sw + 2 * pad2}" width="${e.w + sw + 2 * pad2}" height="${e.h + sw + 2 * pad2}" style="margin:${-hp - pad2}px;width:${e.w + sw + 2 * pad2}px;height:${e.h + sw + 2 * pad2}px;max-width:none;overflow:visible" preserveAspectRatio="none">${gradDefs(e)}` +
        `<path d="${shapePath(e.k, lineK && e.k !== 'line' ? e.w - hp : e.w, e.h, e).replace(/^M0 /, lineK && e.k === 'arrow2' ? `M${hp} ` : 'M0 ')}" fill="${lineK || openK ? 'none' : e.gr && e.k === 'path' ? `url(#gr-${e.id})` : e.fill || 'none'}"${e.fo != null && e.fill && !e.gr ? ` fill-opacity="${e.fo}"` : ''} stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>${e.k === 'path' && e.ds ? `<path d="${scalePath(e.ds, e.w, e.h)}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>` : ''}${heads}</svg>`;
      if (e.html && !lineK && !openK) {
        const tx = document.createElement('div');
        tx.className = 'dk-tx va-' + (e.va || 'm'); tx.style.fontSize = (e.fs || 20) + 'px'; tx.style.color = e.c || (e.fill ? '#FFFFFF' : th.fg); tx.style.padding = pad + 'px';
        if (e.lh) tx.style.lineHeight = e.lh;
        tx.innerHTML = clean(e.html);
        n.appendChild(tx);
      }
    } else if (e.t === 'chart') {
      n.innerHTML = chartSvg(e, th);
      if (e.fill) n.style.background = e.fill;
    } else if (e.t === 'table') {
      const tb = document.createElement('table');
      tb.style.fontSize = (e.fs || 18) + 'px';
      tb.style.setProperty('--bc', e.line || '#868E96');
      const cw = e.cw || e.rows[0].map(() => 1 / e.rows[0].length);
      const cp = Math.max(1, Math.round((e.fs || 18) / 3));
      // Zellränder: aus PowerPoint übernommen (cm = [oben/unten, links/rechts]) oder nach der Schriftgröße
      const cpad = e.cm ? `${e.cm[0]}px ${e.cm[1]}px` : `${Math.max(1, Math.round((e.fs || 18) * 0.2))}px ${cp}px`;
      const rh = tblRows(e, true);
      if (e.rh) tb.style.height = 'auto'; // Zeilen wachsen mit dem Text, wie in PowerPoint
      if (e.cm) tb.classList.add('pp0'); // Tabellen aus PowerPoint: kein zusätzlicher Absatzabstand in den Zellen
      const MG = mergeMap(e);
      tb.innerHTML = '<colgroup>' + cw.map((f) => `<col style="width:${f * 100}%">`).join('') + '</colgroup>' +
        e.rows.map((row, ri) => `<tr style="height:${r1(rh[ri] * e.h)}px">` + row.map((cell, ci) => { const k = ri + ',' + ci; if (MG.hid.has(k)) return ''; const sp = MG.span[k]; const cs = (e.cs && e.cs[k]) || {}; return `<td data-r="${ri}" data-c="${ci}"${sp ? ` rowspan="${sp[0]}" colspan="${sp[1]}"` : ''} class="${ri === 0 && e.head ? 'head' : ''}" style="${ri === 0 && e.head ? `background:${th.accent};color:#fff` : `color:${cs.c || th.fg}`}${cs.f ? `;background:${cs.f}` : ''}${cs.b ? ';font-weight:700' : ''};vertical-align:${{ t: 'top', b: 'bottom' }[cs.v || e.va] || 'middle'}"><div class="dk-cell" style="padding:${cpad}">${clean(cell)}</div></td>`; }).join('') + '</tr>').join('');
      n.appendChild(tb);
    }
    // Farbe eigener Aufzählungszeichen
    n.querySelectorAll('li[data-bc]').forEach((li) => li.style.setProperty('--bc', li.getAttribute('data-bc')));
    n.querySelectorAll('li[data-bi]').forEach((li) => { li.style.setProperty('--bi', li.getAttribute('data-bi') + 'em'); if (li.getAttribute('data-bs')) li.style.setProperty('--bs', li.getAttribute('data-bs')); });
    return n;
  }
  // Hintergrund: Folie vor Design; Bild vor Verlauf vor Farbe
  function bgOf(s, th) {
    const o = s && (s.bgImg || s.bgGrad || s.bg) ? s : th || DEF_TH;
    return { img: o.bgImg || '', grad: o.bgGrad || null, color: o.bg || (th && th.bg) || '#FFFFFF' };
  }
  const GRAD_DIR = { v: '180deg', h: '90deg', d: '135deg' };
  function bgCss(s, th) {
    const b = bgOf(s, th);
    if (b.img) return `${b.color} url("${imgUrl(b.img)}") center/cover no-repeat`;
    if (b.grad) return `linear-gradient(${GRAD_DIR[b.grad.dir] || '180deg'}, ${b.grad.a}, ${b.grad.b})`;
    return b.color;
  }
  function slideNode(s, scale, live, th) {
    th = th || DEF_TH;
    const sl = document.createElement('div');
    sl.className = 'dk-slide';
    sl.style.cssText = `width:${W}px;height:${H}px;font-family:${fontCss(th.font)};transform:scale(${scale});transform-origin:0 0`;
    sl.style.background = bgCss(s, th);
    for (const e of s.els) if (live || !isPh(e)) sl.appendChild(elNode(e, th));
    for (const e of hfEls(D.deck ? D.deck.slides.indexOf(s) : -1)) { const n = elNode(e, th); n.classList.add('dk-hf'); sl.appendChild(n); }
    if (!live || (s.ink && s.ink.length)) sl.insertAdjacentHTML('beforeend', inkSvg(s));
    return sl;
  }
  // Kopf- und Fußzeile (Datum, Text, Foliennummer) als feste Textfelder
  function hfEls(i) {
    const hf = D.deck && D.deck.hf;
    if (!hf || i < 0 || (hf.notFirst && i === 0)) return [];
    const out = [];
    const mk = (x, w, txt, al) => out.push({ id: 'hf' + x, t: 'text', x, y: H - 42, w, h: 32, fs: 14, c: '#868E96', pad: 4, va: 'm', html: `<div${al ? ` style="text-align: ${al};"` : ''}>${esc(txt)}</div>` });
    if (hf.date) mk(40, 260, hf.dateText || new Date().toLocaleDateString(NUM_LOC, { day: '2-digit', month: '2-digit', year: 'numeric' }), '');
    if (hf.foot) mk(300, 360, hf.foot, 'center');
    if (hf.num) mk(660, 260, String(i + 1), 'right');
    return out;
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
    ["Lines", [['line', "Line"], ['arrow', "Arrow"], ['arrow2', "Double arrow"], ['elbow', "Elbow connector"], ['arc', "Arc"]]],
    ["Basic shapes", [['rect', "Rectangle"], ['round', "Rounded rectangle"], ['ellipse', "Circle / ellipse"], ['tri', "Triangle"], ['rtri', "Right triangle"], ['diamond', "Diamond"], ['pent', "Pentagon"], ['hex', "Hexagon"], ['oct', "Octagon"], ['para', "Parallelogram"], ['trap', "Trapezoid"], ['plus', "Cross"], ['heart', "Heart"], ['cloud', "Cloud"]]],
    ["Block arrows", [['arrowR', "Right arrow"], ['arrowL', "Left arrow"], ['arrowU', "Up arrow"], ['arrowD', "Down arrow"], ['arrowLR', "Left-right arrow"], ['chevron', "Chevron"], ['home', "Pentagon arrow"]]],
    ["Stars and callouts", [['star5', "Star"], ['star8', "8-point star"], ['callout', "Speech bubble"], ['calloutR', "Speech bubble (rounded)"]]],
    ["Brackets", [['brackL', "Left bracket"], ['brackR', "Right bracket"], ['braceL', "Left brace"], ['braceR', "Right brace"]]],
  ];
  const SHAPES = SHAPE_GROUPS.flatMap((g) => g[1]);
  const QUICK_SHAPES = ['rect', 'round', 'ellipse', 'tri', 'line', 'arrow', 'arrowR', 'elbow', 'star5', 'callout', 'braceL', 'diamond'];
  const SHAPE_IC = { rect: '<rect x="4" y="6.5" width="16" height="11"/>', round: '<rect x="4" y="6.5" width="16" height="11" rx="3.5"/>', ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6"/>', tri: '<path d="M12 5l8.5 14h-17z"/>',
    arrowR: '<path d="M3 9.5h10V5.5l8 6.5-8 6.5v-4H3z"/>', line: '<path d="M4 19L20 5"/>', arrow: '<path d="M4 19L20 5"/><path d="M12.5 5H20v7.5"/>',
    arrow2: '<path d="M4 20L20 4"/><path d="M13 4h7v7"/><path d="M4 13v7h7"/>', elbow: '<path d="M3 5h8v14h9"/><path d="M17 16l3 3-3 3"/>', arc: '<path d="M4 20C4 9 9 4 20 4"/>' };
  const shapeIc = (k) => SHAPE_IC[k] || (/^bra/.test(k) ? `<g transform="translate(8.5 4)"><path d="${shapePath(k, 7, 16)}"/></g>` : `<g transform="translate(3.5 5.5)"><path d="${shapePath(k, 17, 13)}"/></g>`);
  const RB = { tab: 'start', collapsed: false, peek: false };
  try { RB.collapsed = localStorage.getItem('pdfstift.rbCollapsed') === '1'; } catch (er) { /* */ }
  const RB_EDS = new Set(); // alle Editoren mit Menüband (zum Neuzeichnen beim Ein-/Ausklappen)
  function rbCollapse(on) {
    RB.collapsed = on == null ? !RB.collapsed : !!on; RB.peek = false;
    try { localStorage.setItem('pdfstift.rbCollapsed', RB.collapsed ? '1' : '0'); } catch (er) { /* */ }
    RB_EDS.forEach((ed) => ed.renderFmt());
    window.dispatchEvent(new Event('resize'));
  }
  // eingeklappt und kurz aufgeklappt: bei Klick außerhalb wieder zu
  document.addEventListener('pointerdown', (ev) => {
    if (!RB.peek || (ev.target.closest && ev.target.closest('.rb-band, .dk-menu, .dk-pal, .dk-gal-pop, dialog'))) return;
    RB.peek = false; RB_EDS.forEach((ed) => ed.renderFmt());
  }, true);
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
    mergeR: '<rect x="3.5" y="6" width="17" height="12" rx="1"/><path d="M12 6v3M12 15v3M8 12h8M14 10l2 2-2 2"/>', mergeD: '<rect x="6" y="3.5" width="12" height="17" rx="1"/><path d="M6 12h3M15 12h3M12 8v8M10 14l2 2 2-2"/>',
    unmerge: '<rect x="3.5" y="6" width="17" height="12" rx="1"/><path d="M12 6v12" stroke-dasharray="2 2"/>',
    rowAdd: '<rect x="3.5" y="4" width="17" height="10" rx="1"/><path d="M3.5 9h17"/><path d="M12 16.5v5M9.5 19h5"/>', rowDel: '<rect x="3.5" y="4" width="17" height="10" rx="1"/><path d="M3.5 9h17"/><path d="M9.5 19h5"/>',
    colAdd: '<rect x="4" y="3.5" width="10" height="17" rx="1"/><path d="M9 3.5v17"/><path d="M16.5 12h5M19 9.5v5"/>', colDel: '<rect x="4" y="3.5" width="10" height="17" rx="1"/><path d="M9 3.5v17"/><path d="M16.5 12h5"/>',
    newslide: '<rect x="3.5" y="5" width="13" height="10" rx="1"/><path d="M19 13v6M16 16h6"/>', layout: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M3.5 9h17M10 9v10.5"/>',
    chart: '<path d="M4 20h16"/><rect x="5.5" y="11" width="3" height="7"/><rect x="10.5" y="6" width="3" height="12"/><rect x="15.5" y="9" width="3" height="9"/>',
    omega: '<path d="M5 19h4.5v-2.2A6.5 6.5 0 1 1 14.5 16.8V19H19"/>', crop: '<path d="M7 3v14h14"/><path d="M3 7h14v14"/>', link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    date: '<rect x="3.5" y="5" width="17" height="15" rx="1.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2"/>', hf: '<rect x="4" y="3.5" width="16" height="17" rx="1.5"/><path d="M7 16.5h10M7 7h10" stroke-dasharray="2 1.5"/>',
    num: '<rect x="4" y="3.5" width="16" height="17" rx="1.5"/><path d="M14 17h3M15.5 14v3"/>', legend: '<rect x="4" y="5" width="4" height="4"/><path d="M11 7h9"/><rect x="4" y="11" width="4" height="4"/><path d="M11 13h9"/>',
    slidesPdf: '<path d="M7 3h7l4 4v6"/><path d="M14 3v4h4"/><rect x="3.5" y="13" width="13" height="8" rx="1"/><path d="M19 15v6M16 18h6"/>',
    grid: '<rect x="3.5" y="3.5" width="17" height="17" rx="1"/><path d="M9 3.5v17M15 3.5v17M3.5 9h17M3.5 15h17" stroke-opacity=".55"/>', guides: '<rect x="3.5" y="3.5" width="17" height="17" rx="1"/><path d="M12 3.5v17M3.5 12h17" stroke-dasharray="2 1.5"/>',
    magnet: '<path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4z"/><path d="M6 8h4M14 8h4"/>', zoom: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20M8 10.5h5M10.5 8v5"/>', fitwin: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
    play1: '<path d="M5 4v16"/><path d="M9 5l11 7-11 7z"/>', playCur: '<rect x="3.5" y="5" width="11" height="9" rx="1"/><path d="M14 12l7 4.5-7 4.5z"/>', presenter: '<rect x="2.5" y="4" width="12" height="9" rx="1"/><rect x="16" y="4" width="5.5" height="4" rx=".8"/><path d="M16 11h5.5M16 13.5h4M5 17h7M8.5 13v4"/>',
    hide: '<rect x="4" y="5" width="16" height="11" rx="1"/><path d="M3 20L21 2"/>', trans: '<rect x="3" y="6" width="9" height="12" rx="1"/><rect x="12" y="6" width="9" height="12" rx="1" fill="currentColor" fill-opacity=".25"/><path d="M8 3l4 3-4 3"/>',
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
      `<button type="button" class="rb-big" data-ins="text" title="Text box: click on the page or drag a box"><svg viewBox="0 0 24 24">${ICON.textbox}</svg><span>Textfeld</span></button>` +
      `<div class="rb-shapes" role="group" aria-label="Shapes">${SHAPES.map(([k, l]) => `<button type="button" class="rb-sh" data-ins="shape:${k}" title="${esc(l)} – click or drag" aria-label="${esc(l)}"><svg viewBox="0 0 24 24">${SHAPE_IC[k]}</svg></button>`).join('')}</div>` +
      `<button type="button" class="rb-big" data-ins="img" title="Insert image"><svg viewBox="0 0 24 24">${ICON.img}</svg><span>Bild</span></button>` +
      `<button type="button" class="rb-big" data-ins="table" title="Insert table"><svg viewBox="0 0 24 24">${ICON.table}</svg><span>Tabelle</span></button>` +
      `<span class="rb-cap">Insert</span></div>`;
  }

  // ================================================================== Diagramme (Säulen, Balken, Linien, Kreis)
  const CHART_TYPES = [['col', "Columns"], ['bar', "Bars"], ['line', "Lines"], ['pie', "Circle"]];
  const chartColors = (th) => [th.accent, '#E8590C', '#1B8A3A', '#D6409F', '#0091FF', '#B8E62E', '#7048E8', '#868E96', '#D6262B', '#1F4FD6'];
  const NUM_LOC = (document.documentElement.lang || 'de').slice(0, 2) === 'en' ? 'en-US' : 'de-DE';
  const fmtNum = (v) => (Math.abs(v) >= 1000 || Number.isInteger(v) ? Math.round(v).toLocaleString(NUM_LOC) : (+v.toFixed(2)).toLocaleString(NUM_LOC));
  function niceTicks(min, max) {
    if (min === max) { max = min + 1; }
    const span = max - min, raw = span / 5, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, out = [];
    for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(10));
    return out;
  }
  // Diagramm als einfache Zeichenbefehle (gleich für Bildschirm und PDF)
  function chartPrims(e, th) {
    const P = [], fs = e.fs || 14, w = e.w, h = e.h, col0 = chartColors(th), fg = e.tc || th.fg, grid = '#D5D9E0';
    const labels = e.labels || [], ser = (e.series || []).filter((s0) => s0 && Array.isArray(s0.v));
    // Farbe je Reihe (eigene aus PowerPoint, sonst die des Designs); beim Kreis je Stück
    const col = e.ct === 'pie' ? col0 : col0.map((c, i) => (ser[i] && ser[i].c) || c);
    while (e.ct !== 'pie' && col.length < ser.length) col.push((ser[col.length] && ser[col.length].c) || col0[col.length % col0.length]);
    const fmtV = (v, axis) => (e.pct ? (+(v * 100).toFixed(axis ? 1 : e.dp != null ? Math.max(0, e.dp) : 1)).toLocaleString(NUM_LOC) + (NUM_LOC === 'en-US' ? '%' : ' %') : !axis && e.dp != null ? (+v).toLocaleString(NUM_LOC, { minimumFractionDigits: e.dp, maximumFractionDigits: e.dp }) : fmtNum(v));
    if (e.bg) P.push({ k: 'rect', x: 0, y: 0, w, h, fill: e.bg });
    const tw = (t, z = fs) => String(t).length * z * 0.55;
    let top = fs * 0.6, bottom = h - fs * 0.5;
    if (e.title) { P.push({ k: 'text', x: w / 2, y: fs * 1.45, s: e.title, fs: fs * 1.25, a: 'middle', c: fg, b: 1 }); top = fs * 2.4; }
    const legendItems = e.ct === 'pie' ? labels : ser.map((s0) => s0.n || '');
    if (e.legend !== 0 && legendItems.length && (e.ct === 'pie' || ser.length > 1)) {
      const items = legendItems.map((t, i) => ({ t: String(t), c: col[i % col.length], wd: fs * 1.6 + tw(t) }));
      const total = items.reduce((a, it) => a + it.wd, 0);
      let x = Math.max(fs * 0.5, (w - total) / 2);
      const y = h - fs * 0.9;
      for (const it of items) { P.push({ k: 'rect', x, y: y - fs * 0.75, w: fs * 0.8, h: fs * 0.8, fill: it.c }); P.push({ k: 'text', x: x + fs * 1.1, y, s: it.t, fs, a: 'start', c: fg }); x += it.wd; }
      bottom = h - fs * 2.2;
    }
    if (e.ct === 'pie') {
      const vals = (ser[0] ? ser[0].v : []).map((v) => Math.max(0, +v || 0));
      const sum = vals.reduce((a, b) => a + b, 0) || 1;
      const cx = w / 2, cy = (top + bottom) / 2, r = Math.max(4, Math.min(w * 0.45, (bottom - top) / 2));
      let a0 = -Math.PI / 2;
      vals.forEach((v, i) => {
        const a1 = a0 + (v / sum) * Math.PI * 2;
        if (v > 0) {
          const big = a1 - a0 > Math.PI ? 1 : 0;
          const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
          const d = v >= sum ? `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z` : `M${cx} ${cy}L${x0} ${y0}A${r} ${r} 0 ${big} 1 ${x1} ${y1}Z`;
          P.push({ k: 'path', d, fill: col[i % col.length], stroke: '#FFFFFF', sw: 1.5 });
          const am = (a0 + a1) / 2, pct = Math.round((v / sum) * 100);
          if (pct >= 4) P.push({ k: 'text', x: cx + r * 0.62 * Math.cos(am), y: cy + r * 0.62 * Math.sin(am) + fs * 0.35, s: pct + ' %', fs, a: 'middle', c: '#FFFFFF', b: 1 });
        }
        a0 = a1;
      });
      return P;
    }
    const all = ser.flatMap((s0) => s0.v.map((v) => +v || 0));
    let ticks = niceTicks(e.vmin != null ? e.vmin : Math.min(0, ...all), e.vmax != null ? e.vmax : Math.max(0, ...all));
    if (e.vmin != null) ticks = ticks.filter((t) => t >= e.vmin - 1e-9);
    if (e.vmax != null) ticks = ticks.filter((t) => t <= e.vmax + 1e-9);
    if (ticks.length < 2) ticks = niceTicks(Math.min(0, ...all), Math.max(1, ...all));
    const lo = e.vmin != null ? Math.min(e.vmin, ticks[0]) : ticks[0], hi = e.vmax != null ? Math.max(e.vmax, ticks[ticks.length - 1]) : ticks[ticks.length - 1];
    const horiz = e.ct === 'bar';
    const valW = Math.max(...ticks.map((t) => tw(fmtV(t, 1)))) + fs * 0.6;
    const catW = Math.max(0, ...labels.map((t) => tw(t))) + fs * 0.6;
    const L = horiz ? Math.min(w * 0.35, catW) : valW, B = bottom - (horiz ? fs * 1.5 : fs * 1.6), R = w - fs * 0.6, T = top;
    const pw = Math.max(10, R - L), ph = Math.max(10, B - T);
    const vpos = (v0) => { const v = Math.max(lo, Math.min(hi, v0)); return horiz ? L + ((v - lo) / (hi - lo)) * pw : B - ((v - lo) / (hi - lo)) * ph; };
    // Gitter und Werte-Achse
    for (const t of ticks) {
      if (horiz) { const x = vpos(t); P.push({ k: 'line', x1: x, y1: T, x2: x, y2: B, c: grid, sw: 0.8 }); P.push({ k: 'text', x, y: B + fs * 1.2, s: fmtV(t, 1), fs: fs * 0.9, a: 'middle', c: fg }); }
      else { const y = vpos(t); P.push({ k: 'line', x1: L, y1: y, x2: R, y2: y, c: grid, sw: 0.8 }); P.push({ k: 'text', x: L - fs * 0.4, y: y + fs * 0.32, s: fmtV(t, 1), fs: fs * 0.9, a: 'end', c: fg }); }
    }
    const n = Math.max(1, labels.length), slot = (horiz ? ph : pw) / n;
    // zu viele Beschriftungen: nur jede k-te zeigen, damit nichts übereinanderliegt
    const every = horiz ? Math.max(1, Math.ceil((fs * 1.05) / slot)) : Math.max(1, Math.ceil((Math.max(0, ...labels.map((t) => tw(t))) * 0.85 + fs * 0.2) / slot));
    labels.forEach((t, i) => {
      if (i % every) return;
      if (horiz) P.push({ k: 'text', x: L - fs * 0.4, y: T + slot * (i + 0.5) + fs * 0.35, s: t, fs, a: 'end', c: fg });
      else P.push({ k: 'text', x: L + slot * (i + 0.5), y: B + fs * 1.25, s: t, fs, a: 'middle', c: fg });
    });
    const zero = vpos(Math.max(lo, Math.min(hi, 0)));
    if (e.ct === 'line') {
      ser.forEach((s0, si) => {
        const pts = s0.v.slice(0, n).map((v, i) => [L + slot * (i + 0.5), vpos(+v || 0)]);
        if (pts.length > 1) P.push({ k: 'path', d: 'M' + pts.map((q) => q.map((z) => +z.toFixed(2)).join(' ')).join('L'), stroke: col[si % col.length], sw: Math.max(1.5, fs * 0.16) });
        if (e.mk !== 0) for (const [x, y] of pts) P.push({ k: 'circle', cx: x, cy: y, r: Math.max(2, fs * 0.22), fill: col[si % col.length] });
        if (e.dl) s0.v.slice(0, n).forEach((v, i) => { if (i % every === 0 || n <= 12) P.push({ k: 'text', x: pts[i][0], y: pts[i][1] - fs * 0.5, s: fmtV(+v || 0), fs: fs * 0.8, a: 'middle', c: fg }); });
      });
    } else {
      const m = Math.max(1, ser.length), gap = slot * 0.2, bw = (slot - 2 * gap) / m;
      ser.forEach((s0, si) => s0.v.slice(0, n).forEach((v, i) => {
        const p0 = vpos(+v || 0), off = slot * i + gap + bw * si;
        if (horiz) P.push({ k: 'rect', x: Math.min(zero, p0), y: T + off, w: Math.abs(p0 - zero), h: bw * 0.92, fill: col[si % col.length] });
        else P.push({ k: 'rect', x: L + off, y: Math.min(zero, p0), w: bw * 0.92, h: Math.abs(p0 - zero), fill: col[si % col.length] });
        if (e.dl) {
          const neg = (+v || 0) < 0, s1 = fmtV(+v || 0);
          if (horiz) P.push({ k: 'text', x: p0 + (neg ? -fs * 0.3 : fs * 0.3), y: T + off + bw * 0.46 + fs * 0.3, s: s1, fs: fs * 0.85, a: neg ? 'end' : 'start', c: fg });
          else P.push({ k: 'text', x: L + off + bw * 0.46, y: neg ? p0 + fs : p0 - fs * 0.3, s: s1, fs: fs * 0.85, a: 'middle', c: fg });
        }
      }));
    }
    P.push(horiz ? { k: 'line', x1: zero, y1: T, x2: zero, y2: B, c: '#868E96', sw: 1 } : { k: 'line', x1: L, y1: zero, x2: R, y2: zero, c: '#868E96', sw: 1 });
    return P;
  }
  function chartSvg(e, th) {
    const q = (t) => esc(String(t));
    const body = chartPrims(e, th).map((p) => {
      if (p.k === 'rect') return `<rect x="${p.x}" y="${p.y}" width="${Math.max(0, p.w)}" height="${Math.max(0, p.h)}" fill="${p.fill}"/>`;
      if (p.k === 'line') return `<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" stroke="${p.c}" stroke-width="${p.sw}"/>`;
      if (p.k === 'path') return `<path d="${p.d}" fill="${p.fill || 'none'}" stroke="${p.stroke || 'none'}" stroke-width="${p.sw || 0}" stroke-linejoin="round" stroke-linecap="round"/>`;
      if (p.k === 'circle') return `<circle cx="${p.cx}" cy="${p.cy}" r="${p.r}" fill="${p.fill}"/>`;
      return `<text x="${p.x}" y="${p.y}" font-size="${p.fs}" text-anchor="${p.a}" fill="${p.c}"${p.b ? ' font-weight="700"' : ''}>${q(p.s)}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${e.w} ${e.h}" width="${e.w}" height="${e.h}" style="width:${e.w}px;height:${e.h}px;max-width:none;overflow:visible;stroke:none;stroke-width:0">${body}</svg>`;
  }
  // kleines Fenster (eigene Dialoge der Präsentationen)
  function modal(title, html, okLabel) {
    return new Promise((res) => {
      const d = document.createElement('dialog');
      d.className = 'dk-dlg';
      d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3><div class="dk-dlg-body">${html}</div><div class="dk-dlg-btns"><button type="button" class="btn" value="no">Cancel</button><button type="submit" class="btn primary" value="yes">${esc(okLabel || 'OK')}</button></div></form>`;
      document.body.appendChild(d);
      d.querySelector('[value=no]').onclick = () => d.close('no');
      d.addEventListener('close', () => { setTimeout(() => d.remove(), 0); res(d.returnValue === 'yes' ? d : null); }, { once: true });
      d.addEventListener('cancel', () => d.close('no'));
      d.querySelector('form').onsubmit = (ev) => { ev.preventDefault(); d.close('yes'); };
      d.showModal();
      res.d = d;
    });
  }
  function modalEl(title, html, okLabel, init) {
    const pr = modal(title, html, okLabel);
    const d = document.body.lastElementChild;
    if (init) init(d);
    return pr;
  }
  // Daten eines Diagramms bearbeiten (wie eine kleine Tabelle; aus Excel einfügen geht auch)
  async function chartDialog(e) {
    let labels = (e.labels || []).slice(), ser = (e.series || []).map((s0) => ({ ...s0, v: s0.v.slice() }));
    let html = '';
    const grid = () => `<div class="ch-grid"><table><tr><th></th>${ser.map((s0, j) => `<th><input data-s="${j}" value="${esc(s0.n || '')}" placeholder="Series ${j + 1}"></th>`).join('')}<th><button type="button" class="btn small" data-a="addS">+ Series</button></th></tr>` +
      labels.map((l, i) => `<tr><th><input data-l="${i}" value="${esc(l)}"></th>${ser.map((s0, j) => `<td><input data-v="${i},${j}" inputmode="decimal" value="${s0.v[i] != null ? String(s0.v[i]).replace('.', ',') : ''}"></td>`).join('')}<td><button type="button" class="icon-btn" data-a="delL" data-i="${i}" title="Delete row">✕</button></td></tr>`).join('') +
      `<tr><th><button type="button" class="btn small" data-a="addL">+ Category</button></th>${ser.map((s0, j) => `<td>${ser.length > 1 ? `<button type="button" class="icon-btn" data-a="delS" data-j="${j}" title="Delete series">✕</button>` : ''}</td>`).join('')}</tr></table></div>`;
    html = `<div class="ch-top"><label>Type <select name="ct">${CHART_TYPES.map(([k, l]) => `<option value="${k}"${k === e.ct ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label>Title <input name="title" value="${esc(e.title || '')}"></label><label class="chk"><input type="checkbox" name="legend"${e.legend !== 0 ? ' checked' : ''}> Legend</label></div>
      <p class="muted small">Tip: copy numbers from Excel and paste them into a field – the table fills from there.</p><div class="ch-wrap">${grid()}</div>`;
    const read = (d) => {
      d.querySelectorAll('[data-l]').forEach((i) => { labels[+i.dataset.l] = i.value; });
      d.querySelectorAll('[data-s]').forEach((i) => { ser[+i.dataset.s].n = i.value; });
      d.querySelectorAll('[data-v]').forEach((i) => { const [r, c] = i.dataset.v.split(',').map(Number); const t = i.value.trim().replace(/\./g, '').replace(',', '.'); ser[c].v[r] = t === '' ? 0 : +t || 0; });
    };
    const d0 = await modalEl("Chart data", html, "Apply", (d) => {
      const wrap = d.querySelector('.ch-wrap');
      const redraw = () => { wrap.innerHTML = grid(); };
      wrap.onclick = (ev) => {
        const b = ev.target.closest('[data-a]'); if (!b) return;
        read(d);
        if (b.dataset.a === 'addL') { labels.push("Clear"); ser.forEach((s0) => s0.v.push(0)); }
        if (b.dataset.a === 'addS') { ser.push({ n: "Series " + (ser.length + 1), v: labels.map(() => 0) }); }
        if (b.dataset.a === 'delL') { const i = +b.dataset.i; labels.splice(i, 1); ser.forEach((s0) => s0.v.splice(i, 1)); }
        if (b.dataset.a === 'delS') { ser.splice(+b.dataset.j, 1); }
        redraw();
      };
      // aus Excel/Calc einfügen: Tabulatoren und Zeilen
      wrap.addEventListener('paste', (ev) => {
        const t = (ev.clipboardData && ev.clipboardData.getData('text/plain')) || '';
        if (!/[\t\n]/.test(t)) return;
        ev.preventDefault();
        read(d);
        const rowsT = t.replace(/\r/g, '').split('\n').filter((r) => r.length).map((r) => r.split('\t'));
        const inp = ev.target;
        let r0 = 0, c0 = 0;
        if (inp.dataset.v) [r0, c0] = inp.dataset.v.split(',').map(Number);
        if (inp.dataset.l) { r0 = +inp.dataset.l; c0 = -1; }
        if (inp.dataset.s) { r0 = -1; c0 = +inp.dataset.s; }
        rowsT.forEach((row, ri) => row.forEach((cell, ci) => {
          const r = r0 + ri, c = c0 + ci;
          if (r < 0 && c >= 0) { while (ser.length <= c) ser.push({ n: '', v: labels.map(() => 0) }); ser[c].n = cell; return; }
          while (labels.length <= r) { labels.push(''); ser.forEach((s0) => s0.v.push(0)); }
          if (c < 0) { labels[r] = cell; return; }
          while (ser.length <= c) ser.push({ n: "Series " + (ser.length + 1), v: labels.map(() => 0) });
          const num = cell.trim().replace(/\./g, '').replace(',', '.');
          ser[c].v[r] = +num || 0;
        }));
        redraw();
      });
    });
    if (!d0) return null;
    read(d0);
    return { labels, series: ser, ct: d0.querySelector('[name=ct]').value, title: d0.querySelector('[name=title]').value.trim(), legend: d0.querySelector('[name=legend]').checked ? 1 : 0 };
  }
  // ================================================================== Sonderzeichen
  const SYMBOLS = [
    ["Greek", 'α β γ δ ε ζ η θ ι κ λ μ ν ξ π ρ σ τ υ φ χ ψ ω Γ Δ Θ Λ Ξ Π Σ Φ Ψ Ω'],
    ["Math", '± × ÷ ≈ ≠ ≡ ≤ ≥ < > ∞ √ ∑ ∏ ∫ ∂ ∇ ∈ ∉ ⊂ ⊆ ∪ ∩ ∅ ∀ ∃ ¬ ∧ ∨ ° ′ ″ ‰ ½ ⅓ ¼ ¾ ² ³ ¹ ⁿ ₀ ₁ ₂ ₃ ₙ'],
    ["Arrows", '→ ← ↑ ↓ ↔ ↕ ⇒ ⇐ ⇔ ↗ ↘ ↖ ↙ ⟶ ↻'],
    ["Business", '€ $ £ ¥ ¢ % § © ® ™ № Ø'],
    ["Characters", "“ ” ” ‚ ‘ ’ « » – — … • · ✓ ✗ ★ ☆ ☐ ☑ ☒ ● ○ ■ □ ▲ ▼ ◆ ♦"],
  ];
  function symbolPicker(btn, pick) {
    document.querySelectorAll('.dk-gal-pop').forEach((g) => g.remove());
    const g = document.createElement('div');
    g.className = 'dk-gal-pop dk-sym';
    g.innerHTML = SYMBOLS.map(([cap, chars]) => `<div class="gp-cap">${esc(cap)}</div><div class="gp-row">${chars.split(' ').map((c) => `<button type="button" data-c="${esc(c)}" title="${esc(c)}">${esc(c)}</button>`).join('')}</div>`).join('');
    document.body.appendChild(g);
    const r = btn.getBoundingClientRect();
    g.style.left = Math.max(4, Math.min(r.left, innerWidth - g.offsetWidth - 8)) + 'px';
    g.style.top = Math.min(r.bottom + 4, innerHeight - g.offsetHeight - 8) + 'px';
    g.onmousedown = (ev) => ev.preventDefault();
    g.onpointerdown = (ev) => ev.stopPropagation();
    g.onclick = (ev) => { const b = ev.target.closest('[data-c]'); if (b) pick(b.dataset.c); };
    setTimeout(() => document.addEventListener('pointerdown', function off(ev) { if (!g.contains(ev.target)) { g.remove(); document.removeEventListener('pointerdown', off, true); } }, true), 0);
  }
  // ================================================================== aus einer PDF: Ausschnitt als Bild, Seiten als Folien
  async function openPdf(title) {
    const r = await C.pickPdf(title);
    if (!r) return null;
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(r.bytes).slice(), isEvalSupported: false }).promise;
    return { name: r.name, pdf };
  }
  async function renderPage(pdf, n, width) {
    const pg = await pdf.getPage(n);
    const vp0 = pg.getViewport({ scale: 1 });
    const vp = pg.getViewport({ scale: width / vp0.width });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    return c;
  }
  const canvasFile = (c, type, name) => new Promise((res) => c.toBlob((b) => res(new File([b], name, { type })), type, 0.9));
  // Ausschnitt aufziehen und als Bild hochladen → { src, w, h }
  async function pdfCrop() {
    const doc = await openPdf("Clip from a PDF");
    if (!doc) return null;
    let page = 1, cv = null, sel = null, ratio = 1;
    const W0 = Math.min(900, innerWidth - 120);
    const d0 = await modalEl("Choose a clip", `<div class="crop-nav"><button type="button" class="btn small" data-a="prev">◀</button> <span class="crop-pg"></span> <button type="button" class="btn small" data-a="next">▶</button> <span class="muted small">Drag a frame around the area you want.</span></div><div class="crop-box"><div class="crop-sel" hidden></div></div>`, "Insert", (d) => {
      const box = d.querySelector('.crop-box'), sr = d.querySelector('.crop-sel');
      const show = async () => {
        d.querySelector('.crop-pg').textContent = `Page ${page} of ${doc.pdf.numPages}`;
        cv = await renderPage(doc.pdf, page, W0);
        box.querySelectorAll('canvas').forEach((c) => c.remove());
        box.prepend(cv);
        sel = null; sr.hidden = true;
      };
      d.querySelector('.crop-nav').onclick = (ev) => { const b = ev.target.closest('[data-a]'); if (!b) return; page = Math.max(1, Math.min(doc.pdf.numPages, page + (b.dataset.a === 'next' ? 1 : -1))); show(); };
      box.onpointerdown = (ev) => {
        const r = box.getBoundingClientRect(), x0 = ev.clientX - r.left, y0 = ev.clientY - r.top;
        ratio = cv ? cv.width / r.width : 1;
        box.setPointerCapture(ev.pointerId);
        const mv = (m) => { const x1 = Math.max(0, Math.min(r.width, m.clientX - r.left)), y1 = Math.max(0, Math.min(r.height, m.clientY - r.top)); sel = [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)]; Object.assign(sr.style, { left: sel[0] + 'px', top: sel[1] + 'px', width: sel[2] + 'px', height: sel[3] + 'px' }); sr.hidden = false; };
        const up = () => { box.removeEventListener('pointermove', mv); box.removeEventListener('pointerup', up); };
        box.addEventListener('pointermove', mv); box.addEventListener('pointerup', up);
      };
      show();
    });
    if (!d0 || !cv) return null;
    C.toast("Inserting clip …", 20000);
    // scharf neu zeichnen (3-fache Auflösung)
    const big = await renderPage(doc.pdf, page, W0 * 3);
    const [sx, sy, sw, sh] = sel && sel[2] > 8 && sel[3] > 8 ? sel.map((v) => v * ratio * 3) : [0, 0, big.width, big.height];
    const out = document.createElement('canvas');
    out.width = Math.round(sw); out.height = Math.round(sh);
    out.getContext('2d').drawImage(big, sx, sy, sw, sh, 0, 0, sw, sh);
    const res = await C.uploadImage(await canvasFile(out, 'image/png', 'ausschnitt.png'));
    return { src: res.src, w: res.w || out.width, h: res.h || out.height };
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
      h.innerHTML = ps.map((p) => `<i class="dk-h ${p}" data-h="${p}" style="transform:scale(${k})"></i>`).join('') + `<i class="dk-h rot" data-h="rot" style="transform:scale(${k});top:${-28 * k}px" title="Rotate"></i>`;
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
      const fontish = textish || (!!e && e.t === 'chart');
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
      const shBtn = (k, l) => `<button type="button" class="rb-sh" data-ins="shape:${k}" title="${esc(l)} – click or drag" aria-label="${esc(l)}">${svg(shapeIc(k))}</button>`;
      const kit = { grp, rows, big, sb, mb, cb, svg, sep, e, has, list };
      const tabs = [['start', 'Start'], ['insert', "Insert"], ...(host.tabs ? host.tabs() : [])];
      // Browser und Tablet: eigener Reiter „Hilfe“ (in der Windows-App steht dafür das Menü Hilfe in der Reiterzeile)
      if (!(window.pdfstiftWin && window.pdfstiftWin.menuPop) && document.querySelector('[data-act="help"]')) tabs.push(['help', "Help"]);
      if (!tabs.some((t) => t[0] === RB.tab)) RB.tab = 'start';
      let h = '';
      if (RB.tab === 'start' && !has && !ED.edit && !ED.painter && host.startIdle) h += host.startIdle(kit, !!(ED.clip || (host.clipboard && host.clipboard())));
      else if (RB.tab === 'start') {
        if (host.ribbonPre) h += host.ribbonPre(kit, 'start');
        // Zwischenablage
        const canPaste = !!(ED.clip || (host.clipboard && host.clipboard()));
        h += grp("Clipboard", big('data-f="paste"', "Insert", RI.paste, canPaste) + rows(sb('cut', "Cut (Ctrl+X)", RI.cut, { en: has, label: "Cut" }), sb('copy', "Copy (Ctrl+C)", ICON.dup, { en: has, label: "Copy" }),
          sb('painter', "Format painter: select an object, click here, then click the target", RI.painter, { en: has, label: "Format painter", on: !!ED.painter })));
        // Schriftart
        const fs0 = e ? Math.round(e.fs || 24) : '';
        const sizes = !e || SIZES.includes(fs0) ? SIZES : [...SIZES, fs0].sort((x, y) => x - y);
        const ff0 = (e && e.ff) || host.theme().font || 'sans';
        h += grp("Font", rows(
          fontSelect(ff0, fontish) +
          `<select data-f="fs" class="rb-size" title="Font size"${dis(fontish)}>${e ? '' : '<option></option>'}${sizes.map((x) => `<option value="${x}"${x === fs0 ? ' selected' : ''}>${x}</option>`).join('')}</select>` +
          sb('fs+', "Increase font size", RI.grow, { en: fontish }) + sb('fs-', "Decrease font size", RI.shrink, { en: fontish }) + sb('clear', "Clear formatting", RI.clear, { en: textish }),
          `<button type="button" class="rb-s rb-t" data-f="bold" title="Bold (Ctrl+B)"${dis(textish)}><b>B</b></button><button type="button" class="rb-s rb-t" data-f="italic" title="Italic (Ctrl+I)"${dis(textish)}><i>I</i></button><button type="button" class="rb-s rb-t" data-f="underline" title="Underline (Ctrl+U)"${dis(textish)}><u>U</u></button>` +
          sb('strike', "Strikethrough", RI.strike, { en: textish }) + sb('sup', "Superscript (x²)", RI.sup, { en: textish }) + sb('sub', "Subscript (x₂)", RI.sub, { en: textish }) + sep +
          cb('hl', "Text highlight", ED.lastHl || '#FFE066', true, svg(RI.marker), textish) + cb('color', "Font color", ED.lastColor || '#D6262B', false, '<span class="cb-a">A</span>', textish)));
        // Absatz
        const va = e && e.t !== 'table' ? (e.va || (e.t === 'shape' ? 'm' : 't')) : '';
        const vaOk = textish && e.t !== 'table';
        h += grp("Paragraph", rows(
          sb('ul', "Bullets", RI.ul, { en: textish }) + sb('ol', "Numbering", RI.ol, { en: textish }) + sep + sb('outdent', "Decrease indent", RI.outdent, { en: textish }) + sb('indent', "Increase indent", RI.indent, { en: textish }) + sep + mb('lh', "Line spacing", RI.lh, textish),
          sb('al', "Align left", RI.al, { v: 'left', en: textish }) + sb('al', "Center", RI.ac, { v: 'center', en: textish }) + sb('al', "Align right", RI.ar, { v: 'right', en: textish }) + sb('al', "Justify", RI.aj, { v: 'justify', en: textish }) + sep +
          sb('va', "Align top", RI.vt, { v: 't', en: vaOk, on: va === 't' }) + sb('va', "Align middle", RI.vm, { v: 'm', en: vaOk, on: va === 'm' }) + sb('va', "Align bottom", RI.vb, { v: 'b', en: vaOk, on: va === 'b' })));
        // Zeichnen
        const gal = `<div class="rb-gal">${QUICK_SHAPES.map((k) => shBtn(k, (SHAPES.find((x) => x[0] === k) || [k, k])[1])).join('')}</div><button type="button" class="rb-galmore" data-menu="shapes" title="All shapes">▾</button>`;
        const lw0 = e ? (e.lw || (line ? 3 : 2)) : 2;
        h += grp("Drawing", gal + big('data-menu="arrange"', "Arrange", RI.arrange, has, true) + rows(
          cb('fill', "Fill", e && e.fill, true, svg(ICON.fill), !!e && ((e.t === 'shape' && !line && !open) || e.t === 'text')) + mb('fx', "Effects: shadow, transparency, flip", RI.fx, has),
          cb('line', "Outline", e && (e.line || (e.t === 'table' ? '#868E96' : line || open ? host.theme().fg : '')), e ? e.t !== 'table' && !line && !open : true, svg(ICON.line), shapeish || (!!e && e.t === 'table')),
          `<select data-f="lw" class="rb-lw" title="Line width"${dis(!!e && (e.t === 'shape' || e.t === 'text' || e.t === 'img'))}>${[0.5, 1, 2, 3, 4, 6, 8, 12].map((v) => `<option value="${v}"${v === lw0 ? ' selected' : ''}>${v} pt</option>`).join('')}</select>`), 'rb-draw');
        // je nach Auswahl: Tabelle, Bild
        if (e && e.t === 'table') {
          h += grp("Table", rows(sb('row+', "Insert row below", RI.rowAdd, { label: "Row" }) + sb('col+', "Insert column right", RI.colAdd, { label: "Column" }),
            sb('row-', "Delete row", RI.rowDel, { label: "Row" }) + sb('col-', "Delete column", RI.colDel, { label: "Column" })) + big('data-f="head"', "Header row", ICON.table, true) +
            rows(sb('mergeR', "Merge cell with the cell to the right (click into a cell first)", RI.mergeR, { label: "Merge right", en: !!(ED.edit && ED.edit.cell) }), sb('mergeD', "Merge cell with the cell below (click into a cell first)", RI.mergeD, { label: "Merge down", en: !!(ED.edit && ED.edit.cell) }), sb('unmerge', "Split merged cell", RI.unmerge, { label: "Split", en: !!(e.mg && e.mg.length) })), 'ctx');
        }
        if (e && e.t === 'img') h += grp("image", big('data-f="imgreset"', "Original shape", ICON.img, true), 'ctx');
        if (e && e.t === 'chart') h += grp("Chart", big('data-f="chartdata"', "Edit data", RI.chart) + rows(mb('ctype', "Chart type", RI.chart, true, (CHART_TYPES.find((c) => c[0] === e.ct) || CHART_TYPES[0])[1]), sb('legend', "Legend on/off", RI.legend, { label: "Legend", on: e.legend !== 0 })), 'ctx');
        // Bearbeiten
        h += grp("Editing", rows(sb('replace', "Find and replace", RI.replace, { label: "Replace …", en: true }), sb('selall', "Select all (Ctrl+A)", RI.selall, { label: "Select All", en: els().length > 0 }), sb('x:del', "Delete (Del)", ICON.del, { label: "Delete", en: has })));
      } else if (RB.tab === 'insert') {
        if (host.ribbonPre) h += host.ribbonPre(kit, 'insert');
        h += grp("Tables", big('data-ins="table"', "Table", ICON.table));
        h += grp("images", big('data-ins="img"', "image", ICON.img) + big('data-ins="crop"', "PDF clip", RI.crop));
        h += grp("Illustrations", big('data-ins="chart"', "Chart", RI.chart));
        h += grp("Shapes", `<div class="rb-gal rb-gal-all">${SHAPES.map(([k, l]) => shBtn(k, l)).join('')}</div>`);
        h += grp('Text', big('data-ins="text"', "Text box", ICON.textbox) + rows(sb('date', "Insert today's date", RI.date, { label: "Date" }), sb('link', "Link: select text in a text box first", RI.link, { label: 'Link', en: !!ED.edit }), ...(host.insertText ? [host.insertText(kit)] : [])));
        h += grp("Symbols", big('data-menu="sym"', "Special characters", RI.omega, true, true));
        if (host.insertExtra) h += host.insertExtra(kit);
      } else if (host.tabContent) h += host.tabContent(RB.tab, kit);
      if (RB.tab === 'help') {
        const hb = (act, label, ic, title) => `<button type="button" class="rb-big" data-hact="${act}" title="${esc(title || label)}">${svg(ic)}<span>${esc(label)}</span></button>`;
        const IC_HELP = '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.8"/><circle cx="12" cy="17.2" r=".6"/>';
        const IC_INFO = '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.8" r=".6"/>';
        const IC_SET = '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>';
        const IC_REP = '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>';
        h += grp("Help", hb('help', "Quick guide", IC_HELP, "Open the quick guide as PDF (F1)") + hb('about', "About PDF-Stift", IC_INFO, "Version numbers"));
        h += grp("Settings", hb('settings', "Settings", IC_SET));
        if (document.body.dataset.ed !== 'local' && document.querySelector('[data-act="report"]')) h += grp("Feedback", hb('report', "Improvement report", IC_REP));
      }
      if (RB.tab === 'view' && window.pdfstiftWin && window.pdfstiftWin.menuPop) h += grp("More", big('data-wm="m-ansicht"', "All view commands", '<circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/>', true, true));
      const colTitle = RB.collapsed ? "Pin ribbon (Ctrl+F1)" : "Collapse ribbon (Ctrl+F1)";
      // Windows-App: die Menüs der Menüleiste stehen mit in der Reiterzeile (die Menüleiste selbst wird dann ausgeblendet)
      const WM = window.pdfstiftWin && window.pdfstiftWin.menuPop;
      const wm = (id, l, c = '') => `<button type="button" class="rb-tab rb-wm${c}" data-wm="${id}" aria-haspopup="menu" title="${esc(l)} ▾">${esc(l)}</button>`;
      // Reihenfolge wie in Office: Datei – Start … Ansicht – Hilfe. Bearbeiten, Werkzeuge und Notizbuch stecken in den Reitern
      // und Seitenleisten (und bleiben über die Alt-Taste in der klassischen Menüleiste erreichbar).
      const wmPre = WM ? wm('m-datei', "file", ' rb-file') : '';
      const wmPost = WM ? wm('m-hilfe', "Help") : '';
      bar.innerHTML = `<div class="rb-tabs" role="tablist">${wmPre}${tabs.map(([k, l]) => `<button type="button" role="tab" class="rb-tab${k === RB.tab && (!RB.collapsed || RB.peek) ? ' on' : ''}" data-tab="${k}" title="Double-click: collapse/expand ribbon">${esc(l)}</button>`).join('')}${wmPost}<span class="rb-tgrow"></span><button type="button" class="rb-tab rb-colbtn" data-a="rbcol" title="${esc(colTitle)}" aria-label="${esc(colTitle)}">${RB.collapsed ? '▾' : '▴'}</button></div><div class="rb-body">${h}</div>`;
      bar.classList.toggle('rb-collapsed', RB.collapsed && !RB.peek);
      bar.classList.toggle('rb-peek', RB.collapsed && RB.peek);
      RB_EDS.add(ED);
      bar.hidden = false;
      if (e && e.t === 'table' && e.head) { const hb = bar.querySelector('[data-f="head"]'); if (hb) hb.classList.add('on'); }
      const insK = ED.insert || (host.insertKind && host.insertKind());
      if (insK) bar.querySelectorAll(`[data-ins="${insK}"]`).forEach((x) => x.classList.add('on'));
      bar.onmousedown = (ev) => { if (!ev.target.closest('select')) ev.preventDefault(); }; // Auswahl im Text bleibt erhalten
      bar.onpointerdown = (ev) => ev.stopPropagation();
      bar.ondblclick = (ev) => { if (ev.target.closest('[data-tab]')) ev.preventDefault(); }; // Doppelklick wird in onclick erkannt (die Reiter werden beim ersten Klick neu gezeichnet)
      bar.onclick = (ev) => {
        const t = ev.target.closest('button');
        if (!t || t.disabled) return;
        if (t.dataset.hact) { const mb2 = document.querySelector(`[data-act="${t.dataset.hact}"]`); if (mb2) mb2.click(); return; }
        if (host.onBtn && host.onBtn(t)) return;
        if (t.dataset.wm) { const r = t.getBoundingClientRect(); if (window.pdfstiftWin && window.pdfstiftWin.menuPop) window.pdfstiftWin.menuPop(t.dataset.wm, r.left, r.bottom); return; }
        if (t.dataset.a === 'rbcol') { rbCollapse(); return; }
        if (t.dataset.tab) { const now = Date.now(); const dbl = RB.lastTab === t.dataset.tab && now - (RB.lastAt || 0) < 450; RB.lastTab = t.dataset.tab; RB.lastAt = dbl ? 0 : now; if (dbl) { rbCollapse(); return; } }
        if (t.dataset.tab && RB.collapsed) { RB.tab = t.dataset.tab; RB.peek = !(RB.peek && t.classList.contains('on')); renderFmt(); return; }
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
        const word = host.alignWord ? "page" : 'Folie';
        popMenu(x, y, [
          ['front', "Bring to front", () => act('front', btn)], ['back', "Send to back", () => act('back', btn)], ['-', ''],
          ...(n > 1 ? [['al', "Align left", () => fmt('aln', 'l')], ['ac', "Center horizontally", () => fmt('aln', 'c')], ['ar', "Align right", () => fmt('aln', 'r')],
            ['at', "Align top", () => fmt('aln', 't')], ['am', "Center vertically", () => fmt('aln', 'm')], ['ab', "Align bottom", () => fmt('aln', 'b')]] : []),
          ...(n > 2 ? [['dh', "Distribute horizontally", () => fmt('dist', 'h')], ['dv', "Distribute vertically", () => fmt('dist', 'v')]] : []),
          ['ap', `Align to the ${word} …`, () => act('align', btn)], ['-', ''],
          ...(n > 1 ? [['g', "Group", () => fmt('group')]] : []), ...(ED.sel.some((id) => (byId(id) || {}).g) ? [['ug', "Ungroup", () => fmt('ungroup')]] : []),
          ['r90', "Rotate 90°", () => fmt('rot90')], ['r0', "Reset rotation", () => fmt('rot0')],
          ['fh', "Flip horizontally", () => fmt('flip', 'x')], ['fv', "Flip vertically", () => fmt('flip', 'y')], ['-', ''],
          ['dup', "Duplicate (Ctrl+D)", () => act('dup')],
        ]);
        return;
      }
      if (m === 'lh') { popMenu(x, y, [['1', '1,0'], ['1.15', '1,15'], ['1.2', "1.2 (default)"], ['1.5', '1,5'], ['2', '2,0'], ['2.5', '2,5']].map(([v, l]) => [v.replace('.', '_'), l, () => fmt('lh', v)])); return; }
      if (m === 'fx') {
        const e = byId(ED.sel[0]) || {};
        popMenu(x, y, [
          ['sh', (e.sh ? '✓ ' : '') + "Shadow", () => fmt('sh')], ['-', ''],
          ...[[1, "Opaque (0 %)"], [0.75, "Transparency 25 %"], [0.5, "Transparency 50 %"], [0.25, "Transparency 75 %"]].map(([v, l]) => ['o' + v, ((e.op ?? 1) === v ? '✓ ' : '') + l, () => fmt('op', v)]), ['-', ''],
          ['fh', "Flip horizontally", () => fmt('flip', 'x')], ['fv', "Flip vertically", () => fmt('flip', 'y')],
        ]);
        return;
      }
      if (m === 'shapes') { gallery(btn); return; }
      if (m === 'sym') { symbolPicker(btn, (c) => insertChars(c)); return; }
      if (m === 'ctype') { popMenu(x, y, CHART_TYPES.map(([k, l]) => [k, esc(l), () => fmt('ct', k)])); return; }
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
      m.innerHTML = (none ? "<button type=\"button\" class=\"none\" data-v=\"\">None</button>" : '') + COLORS.map((c) => `<button type="button" class="sw" data-v="${c}" style="--c:${c}" title="${c}"></button>`).join('');
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
      if (host.fmtExt && host.fmtExt(f, v, btn)) return;
      const ids = ED.sel.slice();
      const each = (fn) => change(() => ids.forEach((id) => { const e = byId(id); if (e) fn(e); }), true);
      if (f.startsWith('x:')) { act(f.slice(2), btn); return; }
      if (f === 'paste') { if (host.onPaste) host.onPaste(); else pasteEls(); return; }
      if (f === 'copy') { copy(); C.toast("Copied – insert with “Paste” or Ctrl+V.", 2500); render(); return; }
      if (f === 'cut') { copy(); act('del'); return; }
      if (f === 'selall') { select(els().map((x) => x.id)); return; }
      if (f === 'rot90') { each((x) => { x.r = ((x.r || 0) + 90) % 360; }); return; }
      if (f === 'rot0') { each((x) => { x.r = 0; }); return; }
      if ((f === 'fs' || f === 'fs+' || f === 'fs-') && ED.edit && sizeSelection(f, v)) return;
      if (f === 'fs+' || f === 'fs-') { each((x) => { const c = x.fs || 24; x.fs = f === 'fs+' ? (SIZES.find((z) => z > c) || c + 8) : ([...SIZES].reverse().find((z) => z < c) || Math.max(4, c - 2)); }); return; }
      if (f === 'lh') { each((x) => { if (+v === 1.2) delete x.lh; else x.lh = +v; }); return; }
      if (f === 'sh') { const on = !(byId(ids[0]) || {}).sh; each((x) => { if (on) x.sh = 1; else delete x.sh; }); return; }
      if (f === 'op') { each((x) => { if (+v >= 1) delete x.op; else x.op = +v; }); return; }
      if (f === 'flip') { const k = v === 'y' ? 'fy' : 'fx'; each((x) => { if (x[k]) delete x[k]; else x[k] = 1; }); return; }
      if (f === 'group') { if (ids.length < 2) return; const g = uid(); each((x) => { x.g = g; }); C.toast("Grouped – the objects now move together.", 2500); return; }
      if (f === 'ungroup') { each((x) => { delete x.g; }); return; }
      if (f === 'aln' || f === 'dist') { arrangeSel(f, v); return; }
      if (f === 'painter') {
        if (ED.painter) { ED.painter = null; renderFmt(); return; }
        const src = byId(ids[0]);
        if (!src) return;
        ED.painter = {};
        for (const k of PAINT_KEYS) if (src[k] != null) ED.painter[k] = src[k];
        ED.painter.__keys = PAINT_KEYS.filter((k) => src[k] == null);
        C.toast("Now click the object that should look the same.", 3500);
        renderFmt();
        return;
      }
      if (f === 'replace') { replaceDlg(); return; }
      if (f === 'date') { insertChars(new Date().toLocaleDateString(NUM_LOC, { day: '2-digit', month: '2-digit', year: 'numeric' })); return; }
      if (f === 'link') { linkDlg(); return; }
      if (f === 'chartdata') { if (ids[0]) openChart(ids[0]); return; }
      if (f === 'legend') { each((x) => { x.legend = x.legend === 0 ? 1 : 0; }); return; }
      if (f === 'ct') { each((x) => { if (x.t === 'chart') x.ct = v; }); return; }
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
          if (f === 'row+') { const fr = tblRows(e); const add = fr[ri] || 1 / e.rows.length; e.rows.splice(ri + 1, 0, Array(cols).fill('')); if (e.rh) { fr.splice(ri + 1, 0, add); e.rh = fr.map((x) => Math.round(x * 10000) / 10000); } e.h = r1(e.h * (1 + add)); mergeShift(e, 'r', ri + 1, 1); }
          if (f === 'row-' && e.rows.length > 1) { const fr = tblRows(e); const sub = fr[ri]; e.h = r1(e.h * (1 - sub)); e.rows.splice(ri, 1); if (e.rh) { fr.splice(ri, 1); e.rh = fr.map((x) => Math.round(x * 10000) / 10000); } mergeShift(e, 'r', ri, -1); }
          if (f === 'col+') { e.rows.forEach((r) => r.splice(ci + 1, 0, '')); e.cw = Array(cols + 1).fill(1 / (cols + 1)); mergeShift(e, 'c', ci + 1, 1); }
          if (f === 'col-' && cols > 1) { e.rows.forEach((r) => r.splice(ci, 1)); e.cw = Array(cols - 1).fill(1 / (cols - 1)); mergeShift(e, 'c', ci, -1); }
          if (f === 'mergeR' || f === 'mergeD' || f === 'unmerge') {
            const MG = mergeMap(e);
            // Anker der Zelle, in der die Schreibmarke steht
            let ar = ri, ac = ci;
            for (const k in MG.span) { const [r0, c0] = k.split(',').map(Number), [rs, cs] = MG.span[k]; if (ri >= r0 && ri < r0 + rs && ci >= c0 && ci < c0 + cs) { ar = r0; ac = c0; } }
            const [rs, cs] = MG.span[ar + ',' + ac] || [1, 1];
            e.mg = (e.mg || []).filter((m) => !(m[0] === ar && m[1] === ac));
            if (f === 'unmerge') { if (!e.mg.length) delete e.mg; return; }
            let nrs = rs, ncs = cs;
            if (f === 'mergeR' && ac + cs < cols) ncs++;
            if (f === 'mergeD' && ar + rs < e.rows.length) nrs++;
            // Inhalt der neu hinzukommenden Zellen an den Anker hängen; berührte andere Verbindungen lösen
            for (let i = 0; i < nrs; i++) for (let j = 0; j < ncs; j++) {
              if (i < rs && j < cs) continue;
              const r = ar + i, c = ac + j, t = e.rows[r][c];
              if (t && plain(t)) e.rows[ar][ac] = (e.rows[ar][ac] || '') + ' ' + t;
              e.rows[r][c] = '';
              e.mg = e.mg.filter((m) => !(r >= m[0] && r < m[0] + m[2] && c >= m[1] && c < m[1] + m[3]));
            }
            if (nrs * ncs >= 2) e.mg.push([ar, ac, nrs, ncs]);
            if (!e.mg.length) delete e.mg;
          }
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
    // Zeichen an der Schreibmarke einfügen – oder als neues Textfeld
    function insertChars(t) {
      if (ED.edit) { document.execCommand('insertText', false, t); const n = host.box() && host.box().querySelector('.dk-el.editing'); if (n) syncEdit(n); return; }
      if (host.onInsertHtml) { host.onInsertHtml(esc(t)); return; }
      insertHtmlAt(esc(t));
    }
    function insertHtmlAt(html) {
      const q = u(), [cx, cy] = host.center ? host.center() : [host.W() / 2, host.H() / 2];
      const e = { id: uid(), r: 0, t: 'text', x: r1(cx - 120 * q), y: r1(cy - 25 * q), w: r1(240 * q), h: r1(50 * q), fs: Math.round(24 * q), html: `<div>${html}</div>` };
      if (host.pad != null) e.pad = host.pad;
      change(() => { els().push(e); ED.sel = [e.id]; }, true);
    }
    async function linkDlg() {
      if (!ED.edit) { C.toast("Please first select the word in a text box that should become a link.", 4000); return; }
      const sel0 = getSelection();
      const rng = sel0.rangeCount ? sel0.getRangeAt(0).cloneRange() : null;
      if (!rng || rng.collapsed) { C.toast("Please first select the word that should become a link.", 4000); return; }
      const url = await C.askText("Insert link", "Web address (https://…) or e-mail (mailto:…):", 'https://', "Insert");
      if (!url) return;
      const href = /^(https?:\/\/|mailto:)/i.test(url.trim()) ? url.trim() : 'https://' + url.trim().replace(/^\/+/, '');
      const n = host.box() && host.box().querySelector('.dk-el.editing');
      const tx = n && (n.querySelector('.dk-tx') || n.querySelector('.dk-cell'));
      if (!tx) return;
      tx.focus();
      const s2 = getSelection(); s2.removeAllRanges(); s2.addRange(rng);
      document.execCommand('createLink', false, href);
      syncEdit(n);
    }
    async function openChart(id) {
      const e = byId(id);
      if (!e) return;
      const r = await chartDialog(e);
      if (r) change(() => { const t = byId(id); if (t) Object.assign(t, r); }, true);
    }
    async function addChart() {
      const q = u(), [cx, cy] = host.center ? host.center() : [host.W() / 2, host.H() / 2];
      const w = Math.min(host.W() * 0.8, 560 * q), h = Math.min(host.H() * 0.7, 340 * q);
      const e = { id: uid(), r: 0, t: 'chart', ct: 'col', x: r1(cx - w / 2), y: r1(cy - h / 2), w: r1(w), h: r1(h), fs: Math.max(8, Math.round(14 * q)), labels: ['2023', '2024', '2025'], series: [{ n: "Revenue", v: [120, 150, 180] }, { n: "Costs", v: [90, 100, 115] }], legend: 1 };
      change(() => { els().push(e); ED.sel = [e.id]; }, true);
      openChart(e.id);
    }
    async function addCrop() {
      try {
        const r = await pdfCrop();
        if (!r) return;
        const [cx, cy] = host.center ? host.center() : [host.W() / 2, host.H() / 2];
        let w = Math.min(host.W() * 0.6, r.w), h = w * r.h / r.w;
        if (h > host.H() * 0.6) { h = host.H() * 0.6; w = h * r.w / r.h; }
        const e = { id: uid(), r: 0, t: 'img', src: r.src, iw: r.w, ih: r.h, x: r1(cx - w / 2), y: r1(cy - h / 2), w: r1(w), h: r1(h) };
        change(() => { els().push(e); ED.sel = [e.id]; }, true);
        C.toast("Clip inserted.", 1500);
      } catch (err) { C.toast("Clip not possible: " + err.message, 6000); }
    }
    // Text in allen Feldern ersetzen (nur der sichtbare Text, Formatierung bleibt)
    async function replaceDlg() {
      endEdit();
      const find = await C.askText("Find and replace", "Find:", '', "Next");
      if (!find) return;
      const repl = await C.askText("Find and replace", `“${find}” replace with:`, '', "Replace all");
      if (repl == null) return;
      let n = 0;
      if (host.replaceAll) n = host.replaceAll(find, repl);
      else change(() => { n = replaceInEls(els(), find, repl); }, true);
      C.toast(n ? `${n}× replaced.` : `“${find}” was not found.`, 3500);
    }
    function selAll(n) { const r = document.createRange(); r.selectNodeContents(n); const s = getSelection(); s.removeAllRanges(); s.addRange(r); n.focus(); }
    // Schriftgröße nur für die markierten Wörter (relativ zur Größe des Felds, damit „größer/kleiner“ fürs ganze Feld mitwächst)
    function sizeSelection(f, v) {
      const n = host.box() && host.box().querySelector('.dk-el.editing');
      if (!n) return false;
      const sel = window.getSelection();
      let rg = sel && sel.rangeCount && !sel.isCollapsed && n.contains(sel.anchorNode) ? sel.getRangeAt(0) : null;
      if (!rg && ED.lastRange && n.contains(ED.lastRange.startContainer)) rg = ED.lastRange;
      if (!rg || rg.collapsed) return false;
      const ed = (rg.startContainer.nodeType === 3 ? rg.startContainer.parentElement : rg.startContainer).closest('[contenteditable="true"]');
      if (!ed) return false;
      ed.focus({ preventScroll: true });
      sel.removeAllRanges(); sel.addRange(rg);
      const at0 = rg.startContainer.nodeType === 3 ? rg.startContainer.parentElement : rg.startContainer;
      const cur = parseFloat(getComputedStyle(at0).fontSize) || 24;
      const target = f === 'fs' ? +v : f === 'fs+' ? (SIZES.find((z) => z > cur + 0.1) || cur + 8) : ([...SIZES].reverse().find((z) => z < cur - 0.1) || Math.max(4, cur - 2));
      if (!target) return true;
      document.execCommand('styleWithCSS', false, false);
      document.execCommand('fontSize', false, '7');
      const made = [];
      ed.querySelectorAll('font[size="7"]').forEach((fo) => {
        const sp = document.createElement('span');
        while (fo.firstChild) sp.appendChild(fo.firstChild);
        fo.replaceWith(sp);
        sp.querySelectorAll('span').forEach((x) => { x.style.fontSize = ''; });
        made.push(sp);
      });
      for (const sp of made) { const pz = parseFloat(getComputedStyle(sp.parentElement).fontSize) || cur; sp.style.fontSize = (Math.round((target / pz) * 1000) / 1000) + 'em'; }
      if (made.length) { const r2 = document.createRange(); r2.setStartBefore(made[0]); r2.setEndAfter(made[made.length - 1]); sel.removeAllRanges(); sel.addRange(r2); ED.lastRange = r2.cloneRange(); }
      syncEdit(n);
      renderFmt();
      return true;
    }
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
    document.addEventListener('selectionchange', () => {
      if (!ED.edit) return;
      const sel = window.getSelection();
      const n = host.box() && host.box().querySelector('.dk-el.editing');
      if (n && sel && sel.rangeCount && !sel.isCollapsed && n.contains(sel.anchorNode)) ED.lastRange = sel.getRangeAt(0).cloneRange();
    });
    function startEdit(id, ev) {
      const e = byId(id);
      if (e && e.t === 'chart') { openChart(id); return; }
      if (!e || e.t === 'img' || isLine(e) || isOpen(e)) return;
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
      // Tabellen: ein Klick in eine Zelle setzt gleich die Schreibmarke dorthin (wie in PowerPoint) – Verschieben am Rahmen
      const tblCell = (byId(nid) || {}).t === 'table' && ev.target.closest && ev.target.closest('td');
      startDrag(ev, 'move', wasSel || tblCell || (host.editOnFirstClick && host.editOnFirstClick(byId(nid))) ? nid : null);
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
          // einrasten: an Rändern und Mitten anderer Objekte und der Fläche (Alt = frei), sonst am Raster
          const gx = [], gy = [];
          if (!m.altKey) {
            const L0 = Math.min(...orig.map((o) => o.x)), T0 = Math.min(...orig.map((o) => o.y));
            const bw = Math.max(...orig.map((o) => o.x + o.w)) - L0, bh = Math.max(...orig.map((o) => o.y + o.h)) - T0;
            const sn = 7 / (host.k() || 1);
            if (host.snapOn ? host.snapOn() : true) {
              const others = els().filter((x) => !ED.sel.includes(x.id));
              const tx = [0, Wd / 2, Wd, ...others.flatMap((x) => [x.x, x.x + x.w / 2, x.x + x.w])];
              const ty = [0, Ht / 2, Ht, ...others.flatMap((x) => [x.y, x.y + x.h / 2, x.y + x.h])];
              const best = (pts, ts) => { let b = null; for (const p0 of pts) for (const t of ts) { const d0 = t - p0; if (Math.abs(d0) < sn && (!b || Math.abs(d0) < Math.abs(b.d))) b = { d: d0, t }; } return b; };
              const bx = best([L0 + dx, L0 + dx + bw / 2, L0 + dx + bw], tx), by = best([T0 + dy, T0 + dy + bh / 2, T0 + dy + bh], ty);
              if (bx) { dx += bx.d; gx.push(bx.t); }
              if (by) { dy += by.d; gy.push(by.t); }
            }
            const gs = host.gridSize ? host.gridSize() : 0;
            if (gs && !gx.length) dx = Math.round((L0 + dx) / gs) * gs - L0;
            if (gs && !gy.length) dy = Math.round((T0 + dy) / gs) * gs - T0;
          }
          list.forEach((e, i) => { e.x = r1(orig[i].x + dx); e.y = r1(orig[i].y + dy); });
          snapLines(gx, gy);
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
        snapLines([], []);
        if (moved) { host.commit(before); render(); }
        else if (clickEdit && mode === 'move') startEdit(clickEdit, uev);
      };
      tgt.addEventListener('pointermove', mv, true); tgt.addEventListener('pointerup', up, true); tgt.addEventListener('pointercancel', up, true);
    }

    // Hilfslinien beim Einrasten
    function snapLines(gx, gy) {
      const sl = host.box() && host.box().querySelector('.dk-slide');
      if (!sl) return;
      sl.querySelectorAll('.dk-snapline').forEach((x) => x.remove());
      const k = 1 / (host.k() || 1);
      for (const x of gx) { const d = document.createElement('div'); d.className = 'dk-snapline'; d.style.cssText = `left:${x}px;top:0;width:${k}px;height:${host.H()}px`; sl.appendChild(d); }
      for (const y of gy) { const d = document.createElement('div'); d.className = 'dk-snapline'; d.style.cssText = `top:${y}px;left:0;height:${k}px;width:${host.W()}px`; sl.appendChild(d); }
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
        C.toast("Inserting image …", 20000);
        const f = await C.prepareImage(file);
        const res = await C.uploadImage(f);
        const iw = res.w || 800, ih = res.h || 600;
        const mw = host.W() * 0.6, mh = host.H() * 0.6;
        let w = Math.min(mw, iw), h = w * ih / iw;
        if (h > mh) { h = mh; w = h * iw / ih; }
        const [cx, cy] = host.center ? host.center() : [host.W() / 2, host.H() / 2];
        const e = { id: uid(), r: 0, t: 'img', src: res.src, iw, ih, x: r1(cx - w / 2), y: r1(cy - h / 2), w: r1(w), h: r1(h) };
        change(() => { els().push(e); ED.sel = [e.id]; }, true);
        C.toast("Image inserted.", 1500);
      } catch (err) { C.toast(err.message); }
    }
    async function addTable() {
      const ask = await C.askText("Insert table", "Rows × columns, e.g. 3 × 4", '3 × 3', "Insert");
      if (!ask) return;
      const m = ask.match(/(\d+)\D+(\d+)/);
      const q = u();
      const rows = Math.max(1, Math.min(30, m ? +m[1] : 3)), cols = Math.max(1, Math.min(12, m ? +m[2] : 3));
      const w = Math.min(host.W() - 100 * q, cols * 180 * q), h = rows * 44 * q;
      const [cx, cy] = host.center ? host.center() : [host.W() / 2, host.H() / 2];
      const e = { id: uid(), r: 0, t: 'table', x: r1(cx - w / 2), y: r1(Math.max(0, cy - h / 2)), w: r1(w), h: r1(h), fs: Math.round(18 * q), head: true, rows: Array.from({ length: rows }, () => Array(cols).fill('')), cw: Array(cols).fill(1 / cols) };
      change(() => { els().push(e); ED.sel = [e.id]; }, true);
      startEdit(e.id, null); // gleich in die erste Zelle schreiben
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
        ['l', host.alignWord ? "Left of the page" : "Left of slide", al((e) => { e.x = r1(mx); })], ['c', "Centre horizontally", al((e) => { e.x = r1((Wd - e.w) / 2); })], ['r', host.alignWord ? "Right of the page" : "Right of slide", al((e) => { e.x = r1(Wd - mx - e.w); })],
        ['-', ''],
        ['t', host.alignWord ? "Top of the page" : "Top of slide", al((e) => { e.y = r1(my); })], ['m', "Centre vertically", al((e) => { e.y = r1((Ht - e.h) / 2); })], ['b', host.alignWord ? "Bottom of the page" : "Bottom of slide", al((e) => { e.y = r1(Ht - my - e.h); })],
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
      if (kind === 'chart') { addChart(); return; }
      if (kind === 'crop') { addCrop(); return; }
      if (kind === 'table') { addTable(); return; }
      if (ED.insert === kind) { ED.insert = null; host.placing(false); return; }
      startInsert(kind, host.alignWord ? "Click on the page or drag with the mouse button held (Esc = cancel)." : "Click on the slide or drag with the mouse button held (Esc = cancel).");
    }
    function shapeMenu(x, y) {
      const k = [['rect', "Rectangle"], ['round', "Rounded rectangle"], ['ellipse', "Circle / ellipse"], ['tri', "Triangle"], ['arrowR', "Block arrow"], ['line', "Line"], ['arrow', "Arrow"]];
      popMenu(x, y, k.map(([id, l]) => [id, l, () => startInsert('shape:' + id, host.alignWord ? "Click on the page where the shape should go (Esc = cancel)." : "Click on the slide where the shape should go (Esc = cancel).")]));
    }
    // gemeinsame Knöpfe
    function act(a, b) {
      if (host.act && host.act(a, b)) return true;
      const r = b ? b.getBoundingClientRect() : { left: 200, bottom: 120 };
      if (a === 'text') { startInsert('text', host.alignWord ? "Click on the page where the text should go." : "Click on the slide where the text should go."); return true; }
      if (a === 'img') { host.pickImage(); return true; }
      if (a === 'shape') { shapeMenu(r.left, r.bottom + 4); return true; }
      if (a === 'table') { addTable(); return true; }
      if (!['align', 'del', 'dup', 'front', 'back'].includes(a)) return false;
      if (!ED.sel.length) { C.toast(host.alignWord ? "Please click an object first." : "Please click something on the slide first."); return true; }
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
      if (mod && k.toLowerCase() === 'g') { ev.preventDefault(); fmt(ev.shiftKey ? 'ungroup' : 'group'); return true; }
      if (mod && (k === ']' || k === '[')) { ev.preventDefault(); fmt(k === ']' ? 'fs+' : 'fs-'); return true; }
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
    Object.assign(ED, { change, render, renderStage, renderFmt, startEdit, endEdit, down, hit, act, key, addImage, addTable, pasteEls, copy, select, byId, insertAt, drawInsert, ins, toLocal, insertHtmlAt, addChart, addCrop, fmt, menu });
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
  // Designs: Hintergrund, Schriftfarbe, Akzent (Tabellenkopf, Formen) und Schrift
  const THEMES = [
    ["Clear", { bg: '#FFFFFF', fg: '#1A1A1A', accent: '#1E2F6E', font: 'sans' }],
    ["Night blue", { bg: '#1E2F6E', fg: '#FFFFFF', accent: '#B8E62E', font: 'sans' }],
    ["Slate", { bg: '#22262E', fg: '#F1F3F5', accent: '#0091FF', font: 'inter' }],
    ["Paper", { bg: '#FBF6EA', fg: '#3B2F2F', accent: '#A0522D', font: 'ebgaramond' }],
    ["Forest", { bg: '#0B3D2E', fg: '#F1F3F5', accent: '#B8E62E', font: 'lato' }],
    ["Coral", { bg: '#FFFFFF', fg: '#2B2B2B', accent: '#E8590C', font: 'montserrat' }],
    ["Purple", { bg: '#F4F1FB', fg: '#2A2140', accent: '#7048E8', font: 'worksans' }],
    ["Chalkboard", { bg: '#25332B', fg: '#F8F9FA', accent: '#FFE066', font: 'patrickhand' }],
    ["Ocean", { bgGrad: { a: '#1E2F6E', b: '#0091FF', dir: 'd' }, bg: '#1E2F6E', fg: '#FFFFFF', accent: '#B8E62E', font: 'sans' }],
    ["Sun", { bgGrad: { a: '#FFF3BF', b: '#FFD8A8', dir: 'v' }, bg: '#FFF3BF', fg: '#2B2B2B', accent: '#E8590C', font: 'poppins' }],
    ["Mint", { bgGrad: { a: '#FFFFFF', b: '#D3F9D8', dir: 'v' }, bg: '#FFFFFF', fg: '#1A1A1A', accent: '#1B8A3A', font: 'nunito' }],
    ["Midnight", { bgGrad: { a: '#141824', b: '#2B3245', dir: 'd' }, bg: '#141824', fg: '#E9ECEF', accent: '#D6409F', font: 'roboto' }],
  ];
  const ACCENTS = ['#1E2F6E', '#1F4FD6', '#0091FF', '#1B8A3A', '#B8E62E', '#E8590C', '#D6262B', '#D6409F', '#7048E8', '#A0522D', '#FFE066', '#868E96'];
  const VIEW = { grid: false, guides: false, snap: true, notes: false, zoom: 1, sorter: false };
  try { Object.assign(VIEW, JSON.parse(localStorage.getItem('pdfstift.dkView') || '{}'), { sorter: false }); } catch (er) { /* */ }
  const viewSave = () => { try { localStorage.setItem('pdfstift.dkView', JSON.stringify({ grid: VIEW.grid, guides: VIEW.guides, snap: VIEW.snap, notes: VIEW.notes, zoom: VIEW.zoom })); } catch (er) { /* */ } };
  function themeTile(name, t) {
    const bg = bgCss(null, t);
    return `<button type="button" class="dk-theme" data-f="theme" data-v="${esc(name)}" title="${esc(name)}"><span class="tt" style="background:${bg};color:${t.fg};font-family:${esc(fontCss(t.font))}">Aa<i style="background:${t.accent}"></i></span><span class="tn">${esc(name)}</span></button>`;
  }
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
    surface: () => {
      if (!slide()) return null;
      const sl = slideNode(slide(), D.k || 1, true, theme());
      if (VIEW.grid) { const g = document.createElement('div'); g.className = 'dk-gridov'; sl.appendChild(g); }
      if (VIEW.guides) { const g = document.createElement('div'); g.className = 'dk-guideov'; sl.appendChild(g); }
      return sl;
    },
    rendered: () => {
      fit();
      // Reihenfolge der Animationen als kleine Nummern an den Objekten
      const s0 = slide(), sl = D.root && $('.dk-box .dk-slide', D.root);
      if (!s0 || !sl) return;
      const k = 1 / (D.k || 1);
      animOrder(s0).forEach((e, i) => { const b = document.createElement('div'); b.className = 'dk-anbadge'; b.textContent = e.ao != null ? e.ao : i + 1; b.title = (AN_LIST.find((x) => x[0] === e.an) || ['', ''])[1] + (e.ap ? " (by paragraph)" : ''); b.style.cssText = `left:${e.x}px;top:${e.y}px;transform:translate(-110%,0) scale(${k});transform-origin:100% 0`; sl.appendChild(b); });
    },
    placing: (on, kind) => { if (!D.root) return; D.root.classList.toggle('dk-placing', !!on); D.root.querySelectorAll('[data-ins]').forEach((b) => b.classList.toggle('on', !!on && b.dataset.ins === kind)); },
    pickImage: () => $('.dk-file', D.root).click(),
    replaceAll: (f, r) => { let n = 0; D.ed.change(() => { for (const s0 of D.deck.slides) n += replaceInEls(s0.els, f, r); }, true); return n; },
    ribbonPre: ({ grp, rows, big, mb }) => grp("slides", big('data-menu="newslide"', "New slide", RI.newslide, true, true) +
      rows(mb('layout', "Layout of this slide", RI.layout, true, 'Layout'), mb('bg', "Background", RI.bg, true, "Background"), mb('design', "Design of all slides", RI.design, true, 'Design'))),
    act: (a) => { if (a === 'hf') { hfDialog(); return true; } return false; },
    tabs: () => [['design', "Design"], ['anim', "Animations"], ['show', "Slide show"], ['view', "View"]],
    tabContent: (tab, { grp, rows, big, sb, mb }) => {
      const th = theme();
      if (tab === 'design') {
        return grp("Themes", `<div class="dk-themes">${THEMES.map(([n, t]) => themeTile(n, t)).join('')}</div>`) +
          grp("Customize", rows(mb('accent', "Accent colour (table header, new shapes)", RI.design, true, "Colours"), fontSelect(th.font || 'sans', true).replace('data-f="ff"', 'data-f="thfont"').replace('title="Schriftart"', "title=\"Font of all slides\""), mb('bgfmt', "Background", RI.bg, true, "Background"))) +
          grp("slides", big('data-menu="size"', th.size === '43' ? "Slide size 4:3" : "Slide size 16:9", RI.layout, true, true) + big('data-menu="layout"', 'Layout', RI.layout, true, true));
      }
      if (tab === 'anim') {
        const s0 = slide() || { els: [] };
        const sel = D.ed.sel.map((id) => s0.els.find((x) => x.id === id)).filter(Boolean);
        const e0 = sel[0], has = !!e0, cur = e0 ? e0.an || '' : null;
        const ordList = animOrder(s0), nr = e0 && e0.an ? ordList.indexOf(e0) + 1 : 0;
        const texty = !!(e0 && e0.an && e0.html && plain(e0.html));
        return grp("Preview", big('data-f="an:preview"', "Preview", RI.play1, ordList.length > 0)) +
          grp('Animation', AN_LIST.map(([k, l]) => big(`data-f="an:set" data-v="${k}"`, l, AN_IC[k], has).replace('class="rb-big"', `class="rb-big${cur === k ? ' on' : ''}"`)).join('')) +
          grp("Settings", rows(sb('an:para', "For text: show each paragraph (bullet) separately", RI.ul, { label: "By paragraph", on: !!(e0 && e0.ap), en: texty }),
            sb('an:earlier', "Earlier in the order", RI.vt, { label: "Earlier", en: nr > 1 }), sb('an:later', "Later in the order", RI.vb, { label: "Later", en: nr > 0 && nr < ordList.length }))) +
          grp("This slide", rows(`<span class="rb-note">${ordList.length ? `${ordList.length} ${ordList.length === 1 ? 'Animation' : "Animations"} – each click while presenting shows the next.` : "No animation yet. Select an object, then choose an animation."}</span>`,
            sb('an:clear', "Remove all animations on this slide", ICON.del, { label: "Remove all", en: ordList.length > 0 })));
      }
      if (tab === 'show') {
        const s0 = slide() || {}, trN = (TR_LIST.find((t) => t[0] === (s0.tr || '')) || TR_LIST[0])[1];
        return grp("Start", big('data-f="pr:begin"', "From beginning", RI.play1) + big('data-f="pr:cur"', "From current slide", RI.playCur) + big('data-f="pr:presenter"', "Presenter view", RI.presenter)) +
          grp("Set up", rows(sb('pr:hide', "Skip this slide in the slide show", RI.hide, { label: s0.hidden ? "Unhide slide" : "Hide slide", on: !!s0.hidden }), mb('trans', "Transition to this slide", RI.trans, true, "Transition: " + trN), sb('pr:trall', "Use this transition for all slides", RI.trans, { label: "For all slides" }))) +
          grp("Ink", rows(sb('pr:inkclear', "Delete ink on this slide", ICON.del, { label: "Clear this slide", en: !!(s0.ink && s0.ink.length) }), sb('pr:inkall', "Delete ink on all slides", ICON.del, { label: "Clear all slides", en: D.deck.slides.some((x) => x.ink && x.ink.length) })));
      }
      if (tab === 'view') {
        return grp("Views", big('data-f="vw:normal"', 'Normal', RI.layout) + big('data-f="vw:sorter"', "Slide sorter", ICON.slide) + big('data-f="vw:notes"', "Notes", RI.hf)) +
          grp("Show", rows(sb('vw:grid', "Gridlines", RI.grid, { label: "Grid", on: VIEW.grid }), sb('vw:guides', "Guides (centre)", RI.guides, { label: "Guides", on: VIEW.guides }), sb('vw:snap', "Snap to other objects and the centre while moving", RI.magnet, { label: "Snap", on: VIEW.snap }))) +
          grp('Zoom', big('data-menu="zoom"', 'Zoom ' + Math.round(VIEW.zoom * 100) + ' %', RI.zoom, true, true) + big('data-f="vw:fit"', "Fit to window", RI.fitwin));
      }
      return '';
    },
    fmtExt: (f, v) => {
      if (f === 'theme') { const t = (THEMES.find((x) => x[0] === v) || [])[1]; if (t) change(() => { const sz = theme().size; D.deck.theme = { ...clone(t), ...(sz ? { size: sz } : {}) }; D.deck.slides.forEach((s0) => { delete s0.bg; delete s0.bgGrad; delete s0.bgImg; }); }); return true; }
      if (f === 'thfont') { if (fontOk(v)) change(() => { theme().font = v; }); return true; }
      if (f.startsWith('an:')) { animAct(f.slice(3), v); return true; }
      if (f.startsWith('vw:')) { viewAct(f.slice(3)); return true; }
      if (f.startsWith('pr:')) {
        const a = f.slice(3);
        if (a === 'begin') present(0);
        if (a === 'cur') present(D.cur);
        if (a === 'presenter') present(D.cur, true);
        if (a === 'hide') change(() => { const s0 = slide(); if (s0.hidden) delete s0.hidden; else s0.hidden = 1; });
        if (a === 'trall') change(() => { const tr = slide().tr; D.deck.slides.forEach((x) => { if (tr) x.tr = tr; else delete x.tr; }); C.toast("Transition applied to all slides.", 2000); });
        if (a === 'inkclear') change(() => { delete slide().ink; });
        if (a === 'inkall') C.confirmDlg("Delete ink", "Delete the ink on all slides?", "Delete").then((ok) => { if (ok) change(() => { D.deck.slides.forEach((x) => delete x.ink); }); });
        return true;
      }
      return false;
    },
    snapOn: () => VIEW.snap,
    gridSize: () => (VIEW.grid ? 20 : 0),
    insertText: ({ sb }) => sb('x:hf', "Header and footer, Foliennummer, Date", RI.hf, { label: "Footer …" }),
    insertExtra: ({ grp, big }) => grp("slides", big('data-menu="pdfslides"', "Slides from PDF", RI.slidesPdf)),
    menu: (m, btn) => {
      const r = btn.getBoundingClientRect(), x = r.left, y = r.bottom + 4;
      if (m === 'pdfslides') { importSlides(); return; }
      if (m === 'newslide') layoutMenu(x, y);
      if (m === 'layout') popMenu(x, y, Object.entries(LAYOUTS).map(([k, l]) => [k, esc(l.name), () => change(() => {
        // Platzhalter tauschen, eigene Inhalte bleiben
        const keep = slide().els.filter((e) => !e.ph);
        slide().els = [...newSlide(k).els, ...keep];
        D.ed.sel = [];
      })]));
      if (m === 'bg' || m === 'bgfmt') bgMenu(x, y);
      if (m === 'design') designMenu(x, y);
      if (m === 'accent') popMenu(x, y, ACCENTS.map((c) => [c.slice(1), `<span class="dk-sw" style="--c:${c};display:inline-block;vertical-align:middle;margin-right:8px"></span>${c}${theme().accent === c ? ' ✓' : ''}`, () => change(() => { theme().accent = c; })]));
      if (m === 'trans') popMenu(x, y, TR_LIST.map(([k, l]) => [k || 'none', esc(l) + ((slide().tr || '') === k ? ' ✓' : ''), () => change(() => { if (k) slide().tr = k; else delete slide().tr; })]));
      if (m === 'size') popMenu(x, y, [['169', "Widescreen 16:9" + (theme().size !== '43' ? ' ✓' : ''), () => setSize('169')], ['43', 'Standard 4:3' + (theme().size === '43' ? ' ✓' : ''), () => setSize('43')]]);
      if (m === 'zoom') popMenu(x, y, [0.5, 0.75, 1, 1.25, 1.5, 2].map((z) => ['z' + z * 100, Math.round(z * 100) + ' %' + (VIEW.zoom === z ? ' ✓' : ''), () => { VIEW.zoom = z; viewSave(); fit(true); D.ed.renderFmt(); }]));
    },
  };

  function build(root) {
    root.innerHTML = `
      <div class="dk-top">
        <input class="dk-title" aria-label="Name der Präsentation" maxlength="200">
        <span class="dk-sep"></span>
        ${ib('undo', ICON.undo, "Undo (Ctrl+Z)")}${ib('redo', ICON.redo, "Redo (Ctrl+Y)")}
        <span class="dk-grow"></span>
        <span class="dk-state muted small"></span>
        ${ib('play', ICON.play, "Present (F5)", "Present")}${ib('pdf', ICON.pdf, "Save as PDF or PowerPoint file", "Save")}
      </div>
      <div class="dk-fmt rb-band"></div>
      <div class="dk-main">
        <aside class="dk-list" aria-label="Slides"></aside>
        <div class="dk-center"><div class="dk-stage"><div class="dk-box"></div></div>
        <div class="dk-notes" hidden><textarea placeholder="Notes for this slide – only for you (e.g. for the talk)" aria-label="Slide notes"></textarea></div></div>
      </div>
      <input type="file" class="dk-file" accept="image/*" hidden>`;
    root.querySelector('.dk-top').onclick = (ev) => { const n = ev.target.closest('[data-ins]'); if (n) { if (D.deck) D.ed.ins(n.dataset.ins); return; } const b = ev.target.closest('[data-a]'); if (b) act(b.dataset.a, b); };
    const ti = $('.dk-title', root);
    ti.oninput = () => { D.deck.title = ti.value; save(); C.deckTitle(D.path, ti.value); };
    $('.dk-file', root).onchange = async (ev) => { const f = ev.target.files[0]; ev.target.value = ''; if (f) D.ed.addImage(f); };
    const stage = $('.dk-stage', root);
    new ResizeObserver(() => fit()).observe(stage);
    $('.dk-notes textarea', root).oninput = (ev) => { const s0 = slide(); if (!s0) return; if (ev.target.value) s0.notes = ev.target.value; else delete s0.notes; save(); };
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
    H = slideH(D.deck.theme);
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
          C.toast("This presentation was changed on another device in the meantime – the latest version is loaded.", 6000);
        } else if (!r.ok) throw new Error(j.error || "Error " + r.status);
        else if (D.path === path) { D.rev = j.rev; D.deck.rev = j.rev; state("Saved"); }
      } catch (e) {
        if (D.path === path) { D.dirty = true; state("Not saved"); D.saveT = setTimeout(flush, 5000); }
      }
    })();
    await D.saving; D.saving = null;
  }

  // ------------------------------------------------------------------ Änderungen mit Rückgängig
  function snap() { return JSON.stringify({ slides: D.deck.slides, theme: D.deck.theme, hf: D.deck.hf, cur: D.cur }); }
  const change = (fn) => D.ed.change(fn);
  function restore(json) { const o = JSON.parse(json); D.deck.slides = o.slides; D.deck.theme = o.theme; D.deck.hf = o.hf; H = slideH(o.theme); D.cur = Math.min(o.cur, o.slides.length - 1); D.ed.sel = []; renderAll(); save(); }
  function undo() { D.ed.endEdit(); if (!D.undo.length) return; D.redo.push(snap()); restore(D.undo.pop()); }
  function redo() { D.ed.endEdit(); if (!D.redo.length) return; D.undo.push(snap()); restore(D.redo.pop()); }

  // ------------------------------------------------------------------ Darstellung
  function renderAll() { if (!D.root || !D.deck) return; renderList(); D.ed.render(); renderNotes(); if (D.sorterDraw) D.sorterDraw(); }
  function renderList() {
    if (!D.root || !D.deck) return;
    const list = $('.dk-list', D.root);
    list.innerHTML = '';
    const sc = 150 / W;
    D.deck.slides.forEach((s, i) => {
      const it = document.createElement('div');
      it.className = 'dk-thumb' + (i === D.cur ? ' cur' : '') + (s.hidden ? ' hid' : '');
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
    add.type = 'button'; add.className = 'dk-add'; add.textContent = "+ New slide";
    add.onclick = (ev) => layoutMenu(ev.clientX, ev.clientY);
    list.appendChild(add);
    const cur = list.children[D.cur];
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }
  function fit(force) {
    if (!D.root) return;
    const st = $('.dk-stage', D.root), box = $('.dk-box', D.root);
    const k = Math.max(0.1, Math.min((st.clientWidth - 48) / W, (st.clientHeight - 48) / H)) * (VIEW.zoom || 1);
    st.classList.toggle('zoomed', (VIEW.zoom || 1) > 1);
    if (force) D.k = 0;
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

  // „Folie als Bild übernehmen“: die Folie aus der ursprünglichen PowerPoint-Datei (mit LibreOffice umgewandelt) –
  // für Folien, die beim Übernehmen nicht ganz gelingen. Danach nicht mehr bearbeitbar; Rückgängig geht.
  const srcPdf = {};
  async function slideAsImage() {
    const s0 = slide(), src = D.deck.src;
    if (!src || s0.sn == null) return;
    C.toast("Taking the slide from the PowerPoint file …", 180000);
    try {
      if (!srcPdf[src]) {
        srcPdf[src] = (async () => {
          const r = await fetch(C.API + '?a=pptxpdf&src=' + encodeURIComponent(src), { credentials: 'same-origin', headers: { 'X-PDFStift': '1' } });
          if (!r.ok) { let m = ''; try { m = (await r.json()).error; } catch (e) { /* */ } throw new Error(m || "The slide could not be taken over."); }
          return window.pdfjsLib.getDocument({ data: new Uint8Array(await r.arrayBuffer()), isEvalSupported: false }).promise;
        })();
      }
      let pdf;
      try { pdf = await srcPdf[src]; } catch (e) { delete srcPdf[src]; throw e; }
      if (s0.sn + 1 > pdf.numPages) throw new Error("This slide is missing in the converted file.");
      const cv = await renderPage(pdf, s0.sn + 1, 1920);
      const res = await C.uploadImage(await canvasFile(cv, 'image/jpeg', 'folie-' + (s0.sn + 1) + '.jpg'));
      change(() => {
        const s = D.deck.slides.find((x) => x.id === s0.id) || s0;
        s.els = [{ id: uid(), r: 0, t: 'img', src: res.src, iw: cv.width, ih: cv.height, x: 0, y: 0, w: W, h: H }];
        D.ed.sel = [];
      });
      C.toast("Slide taken over as a picture (undo: Ctrl+Z).", 3000);
    } catch (err) { C.toast(err.message || String(err), 6000); }
  }
  function layoutMenu(x, y) {
    popMenu(x, y, Object.entries(LAYOUTS).map(([k, l]) => [k, esc(l.name), () => change(() => { D.deck.slides.splice(D.cur + 1, 0, newSlide(k)); D.cur++; D.ed.sel = []; })]));
  }
  function slideMenu(x, y) {
    popMenu(x, y, [
      ['new', "New slide after this …", () => layoutMenu(x, y)],
      ['dup', "Duplicate slide", () => change(() => { const s = clone(slide()); s.id = uid(); s.els.forEach((e) => { e.id = uid(); }); D.deck.slides.splice(D.cur + 1, 0, s); D.cur++; })],
      ['bg', "Background of this slide …", () => bgMenu(x, y, false)],
      ...(D.deck.src && slide().sn != null ? [['img', "Take slide as picture from PowerPoint", () => slideAsImage()]] : []),
      ['-', ''],
      ['del', "Delete slide", () => { if (D.deck.slides.length < 2) { C.toast("The last slide stays."); return; } change(() => { D.deck.slides.splice(D.cur, 1); D.cur = Math.min(D.cur, D.deck.slides.length - 1); }); }],
    ]);
  }
  // Hintergrund dieser Folie: Farbe, Verlauf, Bild – oder für alle Folien übernehmen
  function bgMenu(x, y) {
    const cols = ['#FFFFFF', '#F4F6FA', '#FBF6EA', '#FFF3BF', '#D3F9D8', '#D0EBFF', '#1E2F6E', '#22262E', '#0B3D2E', '#1A1A1A'];
    popMenu(x, y, [
      ...cols.map((c) => [c.slice(1), `<span class="dk-sw" style="--c:${c};display:inline-block;vertical-align:middle;margin-right:8px"></span>Farbe ${c}`, () => change(() => { const s0 = slide(); delete s0.bgGrad; delete s0.bgImg; s0.bg = c; })]),
      ['-', ''],
      ['grad', "Gradient …", () => gradDlg()],
      ['img', "Picture as background …", () => { const f = document.createElement('input'); f.type = 'file'; f.accept = 'image/*'; f.onchange = async () => { const file = f.files[0]; if (!file) return; try { C.toast("Loading picture …", 20000); const res = await C.uploadImage(await C.prepareImage(file)); change(() => { const s0 = slide(); delete s0.bgGrad; s0.bgImg = res.src; }); C.toast("Background set.", 1500); } catch (err) { C.toast(err.message); } }; f.click(); }],
      ['-', ''],
      ['all', "Use this background for all slides", () => change(() => { const s0 = slide(), th = theme(); const b0 = bgOf(s0, th); th.bg = b0.color; if (b0.grad) th.bgGrad = b0.grad; else delete th.bgGrad; if (b0.img) th.bgImg = b0.img; else delete th.bgImg; D.deck.slides.forEach((x) => { delete x.bg; delete x.bgGrad; delete x.bgImg; }); })],
      ['reset', "Reset this slide's background", () => change(() => { const s0 = slide(); delete s0.bg; delete s0.bgGrad; delete s0.bgImg; })],
    ]);
  }
  async function gradDlg() {
    const g = (slide().bgGrad || theme().bgGrad || { a: '#1E2F6E', b: '#0091FF', dir: 'v' });
    const d = await modal("Gradient", `<label class="chk">From <input type="color" name="a" value="${g.a}"> to <input type="color" name="b" value="${g.b}"></label>
      <label class="chk">Direction <select name="dir"><option value="v"${g.dir === 'v' ? ' selected' : ''}>top to bottom</option><option value="h"${g.dir === 'h' ? ' selected' : ''}>left to right</option><option value="d"${g.dir === 'd' ? ' selected' : ''}>diagonal</option></select></label>`, "Apply");
    if (!d) return;
    change(() => { const s0 = slide(); delete s0.bgImg; s0.bgGrad = { a: d.querySelector('[name=a]').value, b: d.querySelector('[name=b]').value, dir: d.querySelector('[name=dir]').value }; s0.bg = s0.bgGrad.a; });
  }
  // Foliengröße 16:9 ↔ 4:3: Inhalte senkrecht mitstrecken
  function setSize(sz) {
    const oldH = H, newH = sz === '43' ? 720 : 540;
    if (oldH === newH) return;
    change(() => {
      const f = newH / oldH;
      for (const s0 of D.deck.slides) for (const e of s0.els) { e.y = r1(e.y * f); if (e.t !== 'img' && e.t !== 'chart') e.h = r1(e.h * f); }
      if (sz === '43') theme().size = '43'; else delete theme().size;
      H = newH;
    });
  }
  // Ansicht-Befehle
  function viewAct(a) {
    if (a === 'normal') { closeSorter(); return; }
    if (a === 'sorter') { openSorter(); return; }
    if (a === 'notes') { VIEW.notes = !VIEW.notes; viewSave(); renderNotes(); fit(true); return; }
    if (a === 'grid' || a === 'guides' || a === 'snap') { VIEW[a] = !VIEW[a]; viewSave(); D.ed.render(); return; }
    if (a === 'fit') { VIEW.zoom = 1; viewSave(); fit(true); D.ed.renderFmt(); }
  }
  function renderNotes() {
    if (!D.root) return;
    const n = $('.dk-notes', D.root);
    n.hidden = !VIEW.notes;
    const ta = $('textarea', n);
    if (slide() && document.activeElement !== ta) ta.value = slide().notes || '';
  }
  // Foliensortierung: große Übersicht, ziehen zum Umsortieren, Doppelklick öffnet
  function openSorter() {
    closeSorter();
    VIEW.sorter = true;
    const ov = document.createElement('div');
    ov.className = 'dk-sorter';
    const draw = () => {
      ov.innerHTML = "<div class=\"dk-sorter-head\"><b>Slide sorter</b><span class=\"muted small\">Drag to reorder · double-click opens the slide</span><button type=\"button\" class=\"btn small\" data-a=\"close\">Back to normal view</button></div><div class=\"dk-sorter-grid\"></div>";
      const grid = ov.querySelector('.dk-sorter-grid');
      const sc = 230 / W;
      D.deck.slides.forEach((s0, i) => {
        const it = document.createElement('div');
        it.className = 'dk-sort-it' + (i === D.cur ? ' cur' : '') + (s0.hidden ? ' hid' : '');
        it.draggable = true;
        it.innerHTML = `<div class="dk-mini" style="width:${W * sc}px;height:${H * sc}px"></div><span class="num">${i + 1}${s0.hidden ? " · hidden" : ''}</span>`;
        it.querySelector('.dk-mini').appendChild(slideNode(s0, sc, false, theme()));
        it.onclick = () => { D.cur = i; draw(); };
        it.ondblclick = () => { closeSorter(); go(i); };
        it.ondragstart = (ev) => { ev.dataTransfer.setData('text/x-dk-slide', String(i)); };
        it.ondragover = (ev) => { ev.preventDefault(); it.classList.add('drop'); };
        it.ondragleave = () => it.classList.remove('drop');
        it.ondrop = (ev) => { ev.preventDefault(); const from = +ev.dataTransfer.getData('text/x-dk-slide'); if (Number.isNaN(from) || from === i) return; change(() => { const [s1] = D.deck.slides.splice(from, 1); D.deck.slides.splice(i, 0, s1); D.cur = i; }); draw(); };
        grid.appendChild(it);
      });
      ov.querySelector('[data-a=close]').onclick = () => closeSorter();
    };
    draw();
    $('.dk-main', D.root).appendChild(ov);
    D.sorterDraw = draw;
  }
  function closeSorter() {
    VIEW.sorter = false;
    D.sorterDraw = null;
    if (D.root) D.root.querySelectorAll('.dk-sorter').forEach((x) => x.remove());
    renderAll();
  }
  // Kopf- und Fußzeile für alle Folien
  async function hfDialog() {
    const hf = D.deck.hf || {};
    const d = await modal("Header and footer", `<label class="chk"><input type="checkbox" name="date"${hf.date ? ' checked' : ''}> Date</label>
      <label class="sub">Fester Text statt des heutigen Dates (leer = immer aktuell): <input name="dateText" value="${esc(hf.dateText || '')}" placeholder="e.g. Winter term 2026/27"></label>
      <label class="chk"><input type="checkbox" name="num"${hf.num ? ' checked' : ''}> Slide number</label>
      <label class="chk"><input type="checkbox" name="footOn"${hf.foot ? ' checked' : ''}> Footer:</label><input name="foot" value="${esc(hf.foot || '')}" placeholder="e.g. Microeconomics · Prof. …">
      <label class="chk"><input type="checkbox" name="notFirst"${hf.notFirst !== false ? ' checked' : ''}> Not on the first slide (title slide)</label>`, "Apply to all slides");
    if (!d) return;
    const v = (n) => d.querySelector(`[name=${n}]`);
    change(() => {
      const foot = v('footOn').checked ? v('foot').value.trim() : '';
      D.deck.hf = { date: v('date').checked, dateText: v('dateText').value.trim(), num: v('num').checked, foot, notFirst: v('notFirst').checked };
      if (!D.deck.hf.date && !D.deck.hf.num && !foot) delete D.deck.hf;
    });
  }
  // Seiten einer PDF als Folien übernehmen (je Seite ein Bild, Seitenverhältnis bleibt)
  async function importSlides() {
    let doc;
    try { doc = await openPdf("Slides from PDF"); } catch (err) { C.toast(err.message); return; }
    if (!doc) return;
    const n = doc.pdf.numPages;
    const ans = await C.askText("Slides from PDF", `“${doc.name}” has ${n} pages. Which ones? (e.g. 1-5, 8)`, n > 1 ? `1-${n}` : '1', "Apply");
    if (!ans) return;
    const pages = [];
    for (const part of ans.split(/[,;\s]+/)) {
      const m = part.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) continue;
      const a = Math.max(1, +m[1]), b = Math.min(n, +(m[2] || m[1]));
      for (let i = a; i <= b; i++) if (!pages.includes(i)) pages.push(i);
    }
    if (!pages.length) { C.toast("No valid pages given."); return; }
    const made = [];
    try {
      for (const [k, pn] of pages.entries()) {
        C.toast(`Page ${pn} is being imported (${k + 1} of ${pages.length}) …`, 60000);
        const cv = await renderPage(doc.pdf, pn, 1920);
        const res = await C.uploadImage(await canvasFile(cv, 'image/jpeg', 'seite-' + pn + '.jpg'));
        const a = cv.width / cv.height;
        let w = W, h = W / a;
        if (h > H) { h = H; w = H * a; }
        made.push({ id: uid(), els: [{ id: uid(), r: 0, t: 'img', src: res.src, iw: cv.width, ih: cv.height, x: r1((W - w) / 2), y: r1((H - h) / 2), w: r1(w), h: r1(h) }] });
      }
    } catch (err) { C.toast("Import stopped: " + err.message, 6000); }
    if (!made.length) return;
    change(() => { D.deck.slides.splice(D.cur + 1, 0, ...made); D.cur += 1; D.ed.sel = []; });
    C.toast(`${made.length} slides imported.`, 3000);
  }
  function designMenu(x, y) {
    const th = theme();
    popMenu(x, y, [
      ['bg', "Background of all slides …", () => bgMenu(x, y, true)],
      ['ac1', `<span class="dk-sw" style="--c:#1E2F6E;display:inline-block;vertical-align:middle;margin-right:8px"></span>Accent dark blue${th.accent === '#1E2F6E' ? ' ✓' : ''}`, () => change(() => { th.accent = '#1E2F6E'; })],
      ['ac2', `<span class="dk-sw" style="--c:#1B8A3A;display:inline-block;vertical-align:middle;margin-right:8px"></span>Accent green${th.accent === '#1B8A3A' ? ' ✓' : ''}`, () => change(() => { th.accent = '#1B8A3A'; })],
      ['ac3', `<span class="dk-sw" style="--c:#D6262B;display:inline-block;vertical-align:middle;margin-right:8px"></span>Accent red${th.accent === '#D6262B' ? ' ✓' : ''}`, () => change(() => { th.accent = '#D6262B'; })],
      ['-', ''],
      ['fs', "Font: Helvetica/Arial" + (th.font !== 'serif' ? ' ✓' : ''), () => change(() => { th.font = 'sans'; })],
      ['ff', "Font: Times" + (th.font === 'serif' ? ' ✓' : ''), () => change(() => { th.font = 'serif'; })],
    ]);
  }

  // ------------------------------------------------------------------ Knöpfe und Tasten
  function act(a, b) {
    const r = b ? b.getBoundingClientRect() : { left: 200, bottom: 120 };
    if (a === 'newslide') { layoutMenu(r.left, r.bottom + 4); return; }
    if (a === 'undo') { undo(); return; }
    if (a === 'redo') { redo(); return; }
    if (a === 'design') { designMenu(r.left, r.bottom + 4); return; }
    if (a === 'play') { present(D.cur); return; }
    if (a === 'pdf') { popMenu(r.left - 120, r.bottom + 4, [['dl', "Download PDF", () => exportPdf('download')], ['lib', "Put PDF into “My PDFs” (to write on)", () => exportPdf('library')], ['pptx', "Save as PowerPoint file (.pptx)", () => exportPptxDeck()]]); return; }
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
    if (VIEW.sorter) { if (k === 'Escape') { ev.preventDefault(); closeSorter(); } return; }
    if (k === 'F5') { ev.preventDefault(); present(ev.shiftKey ? D.cur : 0); return; }
    if (mod && k.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
    if (mod && k.toLowerCase() === 'y') { ev.preventDefault(); redo(); return; }
    if (mod && k.toLowerCase() === 'a') { ev.preventDefault(); D.ed.select(slide().els.map((e) => e.id)); return; }
    if (D.ed.key(ev)) return;
    if ((k === 'PageDown' || (k === 'ArrowDown' && !D.ed.sel.length)) && D.cur < D.deck.slides.length - 1) { ev.preventDefault(); go(D.cur + 1); return; }
    if ((k === 'PageUp' || (k === 'ArrowUp' && !D.ed.sel.length)) && D.cur > 0) { ev.preventDefault(); go(D.cur - 1); }
  }

  // ================================================================== Bildschirmpräsentation
  // Freihand auf Folien (bleibt gespeichert): s.ink = [{ c, w, hl, p: [x, y, …] }] in Folienkoordinaten
  function inkPath(p) {
    if (p.length < 4) return p.length === 2 ? `M${p[0]} ${p[1]}l0.01 0` : '';
    let d = `M${p[0]} ${p[1]}`;
    for (let i = 2; i + 3 < p.length; i += 2) { const mx = (p[i] + p[i + 2]) / 2, my = (p[i + 1] + p[i + 3]) / 2; d += `Q${p[i]} ${p[i + 1]} ${+mx.toFixed(1)} ${+my.toFixed(1)}`; }
    return d + `L${p[p.length - 2]} ${p[p.length - 1]}`;
  }
  function inkSvg(s) {
    const list = (s && s.ink) || [];
    const g = list.map((k) => `<path d="${inkPath(k.p)}" fill="none" stroke="${k.c}" stroke-width="${k.w}" stroke-linecap="round" stroke-linejoin="round"${k.hl ? ' stroke-opacity=".38" style="mix-blend-mode:multiply"' : ''}/>`).join('');
    return `<svg class="dk-ink" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;max-width:none;pointer-events:none;overflow:visible">${g}</svg>`;
  }
  const order = () => D.deck.slides.map((x, i) => i).filter((i) => !D.deck.slides[i].hidden);
  const BCDK = 'BroadcastChannel' in window ? new BroadcastChannel('pdfstift-dk') : null;
  const TR_LIST = [['', "None"], ['fade', "Fade"], ['push', "Push"], ['wipe', "Wipe"], ['zoom', "Zoom"], ['cover', "Uncover"]];
  // Folie in einen Rahmen setzen (zentriert, so groß wie möglich)
  function mountSlide(host, i, deck) {
    const s = (deck || D.deck).slides[i];
    const r = host.getBoundingClientRect();
    const k = Math.min(r.width / W, r.height / H);
    const wrap = document.createElement('div');
    wrap.className = 'dk-pres-slide';
    wrap.style.cssText = `position:absolute;left:${(r.width - W * k) / 2}px;top:${(r.height - H * k) / 2}px;width:${W * k}px;height:${H * k}px;overflow:hidden`;
    if (s) wrap.appendChild(slideNode(s, k, false, theme()));
    return { wrap, k };
  }
  function transition(oldEl, newEl, tr, back) {
    const opt = { duration: 420, easing: 'cubic-bezier(.2,.7,.2,1)' };
    const done = () => { if (oldEl && oldEl.parentNode) oldEl.remove(); };
    if (!oldEl || !tr || !newEl.animate) { done(); return; }
    const dir = back ? -1 : 1;
    if (tr === 'fade') newEl.animate([{ opacity: 0 }, { opacity: 1 }], opt).onfinish = done;
    else if (tr === 'push') { newEl.animate([{ transform: `translateX(${100 * dir}%)` }, { transform: 'none' }], opt).onfinish = done; oldEl.animate([{ transform: 'none' }, { transform: `translateX(${-100 * dir}%)` }], opt); }
    else if (tr === 'wipe') newEl.animate([{ clipPath: back ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], opt).onfinish = done;
    else if (tr === 'zoom') newEl.animate([{ transform: 'scale(.82)', opacity: 0 }, { transform: 'none', opacity: 1 }], opt).onfinish = done;
    else if (tr === 'cover') { newEl.style.zIndex = 0; oldEl.style.zIndex = 1; oldEl.animate([{ transform: 'none' }, { transform: `translateY(${-100 * dir}%)` }], opt).onfinish = done; }
    else done();
  }
  /* Vortragen. presenter = Referentenansicht (zweites Fenster für den Beamer, hier Notizen, nächste Folie, Uhr) */
  function animAct(a, v) {
    const s0 = slide();
    if (!s0) return;
    const sel = D.ed.sel.map((id) => s0.els.find((x) => x.id === id)).filter(Boolean);
    const renumber = (list) => list.forEach((e, i) => { e.ao = i + 1; });
    if (a === 'preview') { animPreview(); return; }
    if (a === 'clear') { change(() => s0.els.forEach((e) => { delete e.an; delete e.ao; delete e.ap; })); return; }
    if (a === 'set') {
      change(() => {
        for (const e of sel) {
          if (!v) { delete e.an; delete e.ao; delete e.ap; continue; }
          if (!e.an) { e.ao = animOrder(s0).length + 1; const blocks = e.html ? (clean(e.html).match(/<(li|div)\b/g) || []).length : 0; if (blocks > 1) e.ap = 1; }
          e.an = v;
        }
        renumber(animOrder(s0));
      });
      if (v) setTimeout(animPreview, 50);
      return;
    }
    if (a === 'para') { change(() => sel.forEach((e) => { if (e.ap) delete e.ap; else e.ap = 1; })); return; }
    if (a === 'earlier' || a === 'later') {
      const e = sel[0];
      if (!e || !e.an) return;
      change(() => {
        const list = animOrder(s0), i = list.indexOf(e), j = i + (a === 'earlier' ? -1 : 1);
        if (j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
        renumber(list);
      });
    }
  }
  // die Animationen der Folie im Bearbeitungsfenster einmal abspielen
  function animPreview() {
    const s0 = slide(), box = D.root && $('.dk-box', D.root);
    const sl = box && box.querySelector('.dk-slide');
    if (!s0 || !sl) return;
    clearTimeout(D.anT);
    const tot = applySteps(sl, s0, 0, false);
    let n = 0;
    const next = () => { n++; applySteps(sl, s0, n, true); if (n < tot) D.anT = setTimeout(next, 650); else D.anT = setTimeout(() => D.ed.render(), 900); };
    if (tot) D.anT = setTimeout(next, 300);
  }
  function present(from, presenter) {
    D.ed.endEdit(); flush();
    const ord = order();
    if (!ord.length) { C.toast("All slides are hidden."); return; }
    let pos = Math.max(0, ord.indexOf(from));
    if (pos < 0 || ord.indexOf(from) < 0) pos = Math.max(0, ord.findIndex((i) => i >= from));
    const P = { tool: '', color: '#D6262B', black: '', t0: Date.now(), paused: 0, pauseAt: 0, notesFs: 18, end: false };
    let win = null;
    if (presenter) {
      const base = location.pathname.replace(/[^/]*$/, '') + (C.LANG === 'en' ? 'index.en.php' : 'index.php');
      win = window.open(base + '?show=1&dk=1', 'pdfstift-dkshow', 'popup=yes,width=1280,height=720');
      if (!win) C.toast("The projector window was blocked – please allow pop-ups. The slide show continues here.", 7000);
    }
    const ov = document.createElement('div');
    ov.className = presenter ? 'dk-pres' : 'dk-show';
    ov.innerHTML = (presenter ? `<div class="pr-top"><span class="pr-timer num">00:00</span><button type="button" class="pr-b" data-a="pause" title="Pause/resume stopwatch">⏸</button><button type="button" class="pr-b" data-a="reset" title="Reset stopwatch">↺</button><span class="pr-clock num"></span><span class="pr-no num"></span><span class="pr-grow"></span><button type="button" class="pr-b wide" data-a="end">End slide show</button></div>` : '') +
      `<div class="pr-main"><div class="pr-cur"></div>${presenter ? "<div class=\"pr-side\"><div class=\"pr-lbl\">Next slide</div><div class=\"pr-next\"></div><div class=\"pr-lbl\">Notes <button type=\"button\" class=\"pr-b sm\" data-a=\"nf-\">A−</button><button type=\"button\" class=\"pr-b sm\" data-a=\"nf+\">A+</button></div><div class=\"pr-notes\"></div></div>" : ''}</div>
      <div class="pr-tools"><button type="button" class="pr-b" data-a="prev" title="Back (←)">◀</button><button type="button" class="pr-b" data-a="next" title="Next (→, space)">▶</button><span class="pr-sep"></span>
      <button type="button" class="pr-b" data-t="pen" title="Pen (S)">✎</button><button type="button" class="pr-b" data-t="hl" title="Highlighter (M)">▬</button><button type="button" class="pr-b" data-t="er" title="Eraser (R)">⌫</button><button type="button" class="pr-b" data-t="laser" title="Laser pointer (L)">●</button>
      <span class="pr-sep"></span>${['#D6262B', '#1F4FD6', '#1A1A1A', '#1B8A3A'].map((c) => `<button type="button" class="pr-c" data-c="${c}" style="--c:${c}" title="Colour"></button>`).join('')}
      <span class="pr-sep"></span><button type="button" class="pr-b" data-a="clear" title="Clear ink on this slide">✕</button><button type="button" class="pr-b" data-a="black" title="Black screen (B)">■</button>${presenter ? '' : "<button type=\"button\" class=\"pr-b\" data-a=\"end\" title=\"End (Esc)\">⏏</button>"}</div>`;
    document.body.appendChild(ov);
    D.show = true;
    const cur = ov.querySelector('.pr-cur');
    let mounted = null, laserEl = null, laserT = 0, stp = 0, stTot = 0;
    const idx = () => ord[pos];
    const send = (m) => { if (BCDK) BCDK.postMessage(m); };
    const state = () => ({ t: 'state', deck: clone(D.deck), i: idx(), black: P.black, n: stp });
    const markTools = () => {
      ov.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === P.tool));
      ov.querySelectorAll('[data-c]').forEach((b) => b.classList.toggle('on', b.dataset.c === P.color));
      cur.style.cursor = P.tool === 'laser' ? 'none' : P.tool ? 'crosshair' : '';
    };
    const draw = (tr, back) => {
      const old = mounted && mounted.wrap;
      mounted = mountSlide(cur, idx());
      cur.appendChild(mounted.wrap);
      mounted.wrap.insertAdjacentHTML('beforeend', `<div class="pr-black ${P.black}"></div>`);
      stTot = applySteps(mounted.wrap, D.deck.slides[idx()], stp, false);
      if (stp > stTot) stp = stTot;
      transition(old, mounted.wrap, tr, back);
      if (presenter) {
        const nx = ov.querySelector('.pr-next'); nx.innerHTML = '';
        if (pos + 1 < ord.length) nx.appendChild(mountSlide(nx, ord[pos + 1]).wrap); else nx.innerHTML = "<div class=\"pr-endnote\">End of slide show</div>";
        const notes = (D.deck.slides[idx()].notes || '').trim();
        const nt = ov.querySelector('.pr-notes'); nt.textContent = notes || "No notes for this slide."; nt.classList.toggle('muted', !notes); nt.style.fontSize = P.notesFs + 'px';
        ov.querySelector('.pr-no').textContent = `Slide ${idx() + 1} of ${D.deck.slides.length}`;
      }
      send({ t: 'slide', i: idx(), tr: tr || '', back: !!back, n: stp });
    };
    // Animationen: erst die Schritte der Folie, dann die nächste Folie
    const stepTo = (n) => { stp = n; applySteps(mounted.wrap, D.deck.slides[idx()], stp, true); send({ t: 'step', i: idx(), n: stp }); };
    const go2 = (np, back) => {
      if (mounted && !P.end && np === pos + 1 && stp < stTot) { stepTo(stp + 1); return; }
      if (mounted && np === pos - 1 && stp > 0) { stepTo(stp - 1); return; }
      if (np < 0) return;
      if (np >= ord.length) { if (!P.end) { P.end = true; cur.querySelectorAll('.pr-endscreen').forEach((x) => x.remove()); cur.insertAdjacentHTML('beforeend', "<div class=\"pr-endscreen\">End of slide show – click or press Esc to exit</div>"); send({ t: 'black', v: 'b' }); return; } end(); return; }
      P.end = false; cur.querySelectorAll('.pr-endscreen').forEach((x) => x.remove());
      if (P.black) { P.black = ''; send({ t: 'black', v: '' }); }
      const back2 = np < pos;
      stp = back2 && np === pos - 1 ? 9999 : 0;
      pos = np;
      draw(back2 ? '' : D.deck.slides[idx()].tr || '', back2);
    };
    const toLocal = (ev) => { const r = mounted.wrap.getBoundingClientRect(); return [r1((ev.clientX - r.left) / mounted.k), r1((ev.clientY - r.top) / mounted.k)]; };
    const redrawInk = () => { const old = mounted.wrap.querySelector('.dk-ink'); const tmp = document.createElement('div'); tmp.innerHTML = inkSvg(D.deck.slides[idx()]); if (old) old.replaceWith(tmp.firstChild); send({ t: 'ink', i: idx(), ink: D.deck.slides[idx()].ink || [] }); };
    // Zeichnen, radieren, zeigen
    cur.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest && ev.target.closest('.dk-play, .dk-video')) return; // Video: abspielen statt weiterblättern
      if (ev.button > 0 || !mounted || ev.target.closest('.pr-tools')) return;
      if (!P.tool) { if (P.end) end(); else go2(pos + 1); return; }
      if (P.tool === 'laser') return;
      ev.preventDefault();
      cur.setPointerCapture(ev.pointerId);
      const s0 = D.deck.slides[idx()];
      if (P.tool === 'er') {
        const erase = (e2) => { const [x, y] = toLocal(e2); const n0 = (s0.ink || []).length; s0.ink = (s0.ink || []).filter((k) => { for (let i = 0; i + 1 < k.p.length; i += 2) if (Math.hypot(k.p[i] - x, k.p[i + 1] - y) < 12 + k.w) return false; return true; }); if (s0.ink.length !== n0) { redrawInk(); save(); } };
        erase(ev);
        const mv = (m) => erase(m), up = () => { cur.removeEventListener('pointermove', mv); cur.removeEventListener('pointerup', up); };
        cur.addEventListener('pointermove', mv); cur.addEventListener('pointerup', up);
        return;
      }
      const st = { c: P.tool === 'hl' ? '#FFD43B' : P.color, w: P.tool === 'hl' ? 16 : 3, p: toLocal(ev) };
      if (P.tool === 'hl') st.hl = 1;
      const svg = mounted.wrap.querySelector('.dk-ink');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('fill', 'none'); path.setAttribute('stroke', st.c); path.setAttribute('stroke-width', st.w); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
      if (st.hl) path.setAttribute('stroke-opacity', '.38');
      if (svg) svg.appendChild(path);
      const mv = (m) => { const q = toLocal(m); const L2 = st.p.length; if (Math.hypot(q[0] - st.p[L2 - 2], q[1] - st.p[L2 - 1]) < 1.5) return; st.p.push(...q); path.setAttribute('d', inkPath(st.p)); send({ t: 'live', i: idx(), st }); };
      const up = () => { cur.removeEventListener('pointermove', mv); cur.removeEventListener('pointerup', up); (s0.ink = s0.ink || []).push(st); redrawInk(); save(); };
      cur.addEventListener('pointermove', mv); cur.addEventListener('pointerup', up);
    });
    cur.addEventListener('pointermove', (ev) => {
      if (P.tool !== 'laser' || !mounted) return;
      const [x, y] = toLocal(ev);
      if (!laserEl) { laserEl = document.createElement('div'); laserEl.className = 'pr-laser'; }
      if (laserEl.parentNode !== mounted.wrap) mounted.wrap.appendChild(laserEl);
      laserEl.style.left = x * mounted.k + 'px'; laserEl.style.top = y * mounted.k + 'px'; laserEl.hidden = false;
      send({ t: 'laser', x, y });
      clearTimeout(laserT); laserT = setTimeout(() => { if (laserEl) laserEl.hidden = true; send({ t: 'laser', x: -1 }); }, 1500);
    });
    cur.addEventListener('contextmenu', (ev) => { ev.preventDefault(); go2(pos - 1, true); });
    ov.addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      ev.stopPropagation();
      if (b.dataset.t) { P.tool = P.tool === b.dataset.t ? '' : b.dataset.t; markTools(); return; }
      if (b.dataset.c) { P.color = b.dataset.c; if (!P.tool || P.tool === 'er' || P.tool === 'laser') P.tool = 'pen'; markTools(); return; }
      const a = b.dataset.a;
      if (a === 'prev') go2(pos - 1, true);
      if (a === 'next') go2(pos + 1);
      if (a === 'end') end();
      if (a === 'clear') { delete D.deck.slides[idx()].ink; redrawInk(); save(); }
      if (a === 'black') setBlack(P.black === 'b' ? '' : 'b');
      if (a === 'pause') { if (P.pauseAt) { P.paused += Date.now() - P.pauseAt; P.pauseAt = 0; b.textContent = '⏸'; } else { P.pauseAt = Date.now(); b.textContent = '▶'; } }
      if (a === 'reset') { P.t0 = Date.now(); P.paused = 0; if (P.pauseAt) P.pauseAt = Date.now(); }
      if (a === 'nf+' || a === 'nf-') { P.notesFs = Math.max(12, Math.min(40, P.notesFs + (a === 'nf+' ? 2 : -2))); ov.querySelector('.pr-notes').style.fontSize = P.notesFs + 'px'; }
    });
    const setBlack = (v) => { P.black = v; const bl = mounted && mounted.wrap.querySelector('.pr-black'); if (bl) bl.className = 'pr-black ' + v; send({ t: 'black', v }); };
    const kd = (ev) => {
      if (ev.target.closest && ev.target.closest('input, textarea')) return;
      const k = ev.key;
      ev.stopPropagation();
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'].includes(k)) { ev.preventDefault(); go2(pos + 1); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(k)) { ev.preventDefault(); go2(pos - 1, true); }
      else if (k === 'Home') go2(0, true); else if (k === 'End') go2(ord.length - 1);
      else if (k === 'Escape') { ev.preventDefault(); if (P.tool) { P.tool = ''; markTools(); } else end(); }
      else if (k === 'b' || k === 'B' || k === '.') setBlack(P.black === 'b' ? '' : 'b');
      else if (k === 'w' || k === 'W' || k === ',') setBlack(P.black === 'w' ? '' : 'w');
      else if (k === 's' || k === 'S') { P.tool = P.tool === 'pen' ? '' : 'pen'; markTools(); }
      else if (k === 'm' || k === 'M') { P.tool = P.tool === 'hl' ? '' : 'hl'; markTools(); }
      else if (k === 'r' || k === 'R') { P.tool = P.tool === 'er' ? '' : 'er'; markTools(); }
      else if (k === 'l' || k === 'L') { P.tool = P.tool === 'laser' ? '' : 'laser'; markTools(); }
    };
    const onMsg = (ev) => { const m = ev.data || {}; if (m.t === 'hello') send(state()); };
    if (BCDK) BCDK.addEventListener('message', onMsg);
    const tick = setInterval(() => {
      if (!presenter) return;
      const el = (P.pauseAt || Date.now()) - P.t0 - P.paused, sec = Math.floor(el / 1000);
      ov.querySelector('.pr-timer').textContent = `${sec >= 3600 ? Math.floor(sec / 3600) + ':' : ''}${String(Math.floor(sec / 60) % 60).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
      ov.querySelector('.pr-clock').textContent = new Date().toLocaleTimeString(NUM_LOC, { hour: '2-digit', minute: '2-digit' });
    }, 500);
    const onResize = () => { if (mounted) { mounted.wrap.remove(); mounted = null; draw(''); } };
    const end = () => {
      if (!D.show) return;
      D.show = false; clearInterval(tick);
      document.removeEventListener('keydown', kd, true); window.removeEventListener('resize', onResize);
      if (BCDK) { BCDK.removeEventListener('message', onMsg); BCDK.postMessage({ t: 'end' }); }
      ov.remove();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      flush(); go(idx());
    };
    document.addEventListener('keydown', kd, true);
    window.addEventListener('resize', onResize);
    markTools();
    if (!presenter && ov.requestFullscreen) ov.requestFullscreen().catch(() => {});
    if (!presenter) document.addEventListener('fullscreenchange', function fc() { if (!document.fullscreenElement && D.show) { document.removeEventListener('fullscreenchange', fc); end(); } });
    requestAnimationFrame(() => { draw(''); send(state()); });
  }
  // Beamer-Fenster der Referentenansicht: zeigt nur die Folie (mit Freihand und Laserpointer)
  function audience() {
    document.title = "Presentation – PDF-Stift";
    const ov = document.createElement('div');
    ov.className = 'dk-aud';
    ov.innerHTML = "<div class=\"pr-cur\"><div class=\"pr-wait\">Waiting for the slide show …</div></div>";
    document.body.appendChild(ov);
    const cur = ov.querySelector('.pr-cur');
    let deck = null, i = 0, mounted = null, live = null, laser = null, black = '', n = 0;
    const draw = (tr, back) => {
      if (!deck) return;
      D.deck = deck; H = slideH(deck.theme);
      const old = mounted && mounted.wrap;
      cur.querySelectorAll('.pr-wait').forEach((x) => x.remove());
      mounted = mountSlide(cur, i, deck);
      mounted.wrap.insertAdjacentHTML('beforeend', `<div class="pr-black ${black}"></div>`);
      cur.appendChild(mounted.wrap);
      applySteps(mounted.wrap, deck.slides[i], n, false);
      transition(old, mounted.wrap, tr, back);
    };
    const ink = () => { if (!mounted) return; const old = mounted.wrap.querySelector('.dk-ink'); const tmp = document.createElement('div'); tmp.innerHTML = inkSvg(deck.slides[i]); if (old) old.replaceWith(tmp.firstChild); live = null; };
    if (!BCDK) { cur.innerHTML = "<div class=\"pr-wait\">This browser does not support a second presentation window.</div>"; return; }
    BCDK.addEventListener('message', (ev) => {
      const m = ev.data || {};
      if (m.t === 'state') { deck = m.deck; i = m.i; black = m.black || ''; n = m.n || 0; draw(''); }
      if (!deck) return;
      if (m.t === 'slide') { i = m.i; n = m.n || 0; draw(m.tr, m.back); }
      if (m.t === 'step' && m.i === i && mounted) { const up = m.n > n; n = m.n; applySteps(mounted.wrap, deck.slides[i], n, up); }
      if (m.t === 'ink' && m.i === i) { deck.slides[i].ink = m.ink; ink(); }
      if (m.t === 'live' && m.i === i && mounted) {
        const svg = mounted.wrap.querySelector('.dk-ink');
        if (!live) { live = document.createElementNS('http://www.w3.org/2000/svg', 'path'); live.setAttribute('fill', 'none'); live.setAttribute('stroke-linecap', 'round'); live.setAttribute('stroke-linejoin', 'round'); if (svg) svg.appendChild(live); }
        live.setAttribute('stroke', m.st.c); live.setAttribute('stroke-width', m.st.w); if (m.st.hl) live.setAttribute('stroke-opacity', '.38'); live.setAttribute('d', inkPath(m.st.p));
      }
      if (m.t === 'laser' && mounted) {
        if (!laser) { laser = document.createElement('div'); laser.className = 'pr-laser'; }
        if (laser.parentNode !== mounted.wrap) mounted.wrap.appendChild(laser);
        laser.hidden = m.x < 0; laser.style.left = m.x * mounted.k + 'px'; laser.style.top = m.y * mounted.k + 'px';
      }
      if (m.t === 'black' && mounted) { black = m.v; const bl = mounted.wrap.querySelector('.pr-black'); if (bl) bl.className = 'pr-black ' + black; }
      if (m.t === 'end') { cur.innerHTML = "<div class=\"pr-wait\">The slide show has ended.</div>"; mounted = null; setTimeout(() => window.close(), 1200); }
    });
    window.addEventListener('resize', () => { if (mounted) { mounted.wrap.remove(); mounted = null; draw(''); if (deck) ink(); } });
    BCDK.postMessage({ t: 'hello' });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'F11' && document.documentElement.requestFullscreen) { ev.preventDefault(); document.documentElement.requestFullscreen().catch(() => {}); } });
    ov.ondblclick = () => { if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {}); };
  }

  // ================================================================== Als PDF: echte Schrift (durchsuchbar), Formen als Vektoren
  const WIN = new Set("€‚ƒ“…†‡ˆ‰Š‹ŒŽ‘’””•–—˜™š›œžŸ".split(''));
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
  // Absatzabstand vor/nach (in Schrifthöhen) aus dem Stil eines Absatzes
  function paraSp(p, el) {
    if (!p || !el || !el.style) return;
    if (el.style.margin === '0px' || el.style.marginBottom === '0px' || el.style.paddingTop || el.style.paddingBottom) { p.sb = parseFloat(el.style.paddingTop) || 0; p.sa = parseFloat(el.style.paddingBottom) || 0; }
    const lh = parseFloat(el.style.lineHeight); if (lh >= 0.5 && lh <= 4 && /^[\d.]+$/.test(el.style.lineHeight)) p.lh = lh;
    if (el.style.paddingLeft || el.style.textIndent) { p.ml = parseFloat(el.style.paddingLeft) || 0; p.ti = parseFloat(el.style.textIndent) || 0; }
  }
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
          for (const li of c.children) { if (li.tagName.toLowerCase() !== 'li') continue; k++; const b2 = { al: li.style.textAlign || blk.al, list: tag, lvl: (blk.lvl || 0) + 1, num: k }; newP(b2.al, tag, b2.lvl, k); paraSp(curP, li); if (li.getAttribute('data-bu')) curP.bu = li.getAttribute('data-bu'); curP.bc = li.getAttribute('data-bc') || ''; if (li.getAttribute('data-bi')) { curP.bi = parseFloat(li.getAttribute('data-bi')) || 0; curP.bin = li.getAttribute('data-bi') === '0'; curP.ml = parseFloat(li.style.marginLeft) || 0; curP.bs = parseFloat(li.getAttribute('data-bs')) || 0; } walk(li, st, b2); curP = null; }
          continue;
        }
        if (tag === 'div' || tag === 'li') { const b2 = { ...blk, al: c.style.textAlign || blk.al }; newP(b2.al, blk.list, blk.lvl, blk.num); paraSp(curP, c); walk(c, st, b2); curP = null; continue; }
        const s2 = { ...st };
        if (tag === 'b') s2.b = 1; if (tag === 'i') s2.i = 1; if (tag === 'u') s2.u = 1; if (tag === 's') s2.s = 1;
        if (tag === 'sup') { s2.sup = 1; delete s2.sub; } if (tag === 'sub') { s2.sub = 1; delete s2.sup; }
        if (tag === 'span' && /em$/.test(c.style.fontSize || '')) s2.z = (st.z || 1) * (parseFloat(c.style.fontSize) || 1);
        if (tag === 'span' && c.style.color) s2.c = c.style.color;
        if (tag === 'span' && c.style.backgroundColor) s2.bg = c.style.backgroundColor;
        if (tag === 'a') { s2.href = c.getAttribute('href'); s2.u = 1; if (!st.c || st.c === base) s2.c = '#1F4FD6'; }
        walk(c, s2, blk);
      }
    };
    walk(t, { c: base }, { al: '', list: null, lvl: 0, num: null });
    return out.filter((p, i) => p.runs.some((r) => r.t.trim()) || i < out.length - 1 || out.length === 1);
  }
  /* Zeichnet Elemente in eine PDF (pdf-lib). Vor drawEl muss der Aufrufer den Ursprung oben links setzen (y nach unten negativ).
   * K = Einheit → pt (Folie 0,75; PDF-Seite 1). */
  // Schriften, bei denen das Einbetten nur der benutzten Zeichen Buchstaben verliert: ganz einbetten
  const NO_SUBSET = new Set(['Carlito']);
  const NOLIG = { liga: false, clig: false, dlig: false, rlig: false, calt: false }; // Ligaturen (z. B. „ti“) verschieben sonst die Buchstaben
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
      const base0 = th.font && fontOk(th.font) ? th.font : 'sans';
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
          if (!list.length) {
            // nicht vorhanden: wie auf dem Bildschirm eine freie Schrift mit ähnlicher Laufweite nehmen
            const sub = /mono|courier|consol|\bcode\b/i.test(fam) ? 'cousine' : /serif(?!.*sans)|times|garamond|georgia|minion|book|roman|palatino|cambria|baskerville|caslon|bodoni|didot/i.test(fam) && !/sans/i.test(fam) ? 'tinos' : 'arimo';
            if (FM.by[sub]) { fams[ff] = await famOf(sub); return fams[ff]; }
            throw new Error(`The font “${fam}” is not available on this device`);
          }
          const st = (re) => list.find((f) => re.test(f.style || ''));
          const pickS = { Regular: st(/^(regular|normal|book|roman|standard)$/i) || list.find((f) => !/bold|italic|oblique|light|black|thin|medium|semi|demi|condensed|narrow/i.test(f.style || '')) || list[0],
            Bold: st(/^(bold|fett)$/i), Italic: st(/^(italic|oblique|kursiv)$/i), BoldItalic: st(/^bold ?(italic|oblique)$/i) };
          has = (x) => !!pickS[x];
          get = async (x) => {
            const fd = pickS[x];
            const bin = ttcPick(new Uint8Array(await (await fd.blob()).arrayBuffer()), fd.postscriptName);
            if (!embedOk(bin)) throw new Error(`The font “${fam}“ darf laut Hersteller nicht in PDFs eingebettet werden`);
            return doc.embedFont(bin, { subset: bin.length > 3e6, features: NOLIG }); // Teilmengen verlieren bei manchen Schriften Buchstaben – kleinere Schriften ganz einbetten
          };
        } else {
          const m = FM.by[ff];
          has = (x) => m.s.includes(x);
          get = async (x) => { const r = await fetch('vendor/fonts/' + m.f + '-' + x + '.ttf?v=' + C.VERSION); if (!r.ok) throw new Error("Font missing"); return doc.embedFont(new Uint8Array(await r.arrayBuffer()), { subset: !NO_SUBSET.has(m.f), features: NOLIG }); };
        }
        const r = await get('Regular');
        const b = has('Bold') ? await get('Bold') : r;
        const i = has('Italic') ? await get('Italic') : r;
        const bi = has('BoldItalic') ? await get('BoldItalic') : (has('Bold') ? b : i);
        fams[ff] = { r, b, i, bi, custom: true, set: new Set(r.getCharacterSet()) };
      } catch (err) {
        C.toast(err.message + ' – im PDF steht dort Helvetica.', 7000);
        fams[ff] = await famOf(ff === base0 ? 'sans' : base0);
      }
      return fams[ff];
    };
    const F = await famOf(th.font && fontOk(th.font) ? th.font : 'sans');
    let uni = null; // DejaVu für Zeichen außerhalb von WinAnsi (z. B. Pfeile, griechische Buchstaben)
    const needUni = (allEls || []).some((e) => [(e.html || '').replace(/data-bu="([^"]*)"/g, '>$1<'), ...(e.rows || []).flat().map((x) => String(x).replace(/data-bu="([^"]*)"/g, '>$1<')), e.title || '', ...(e.labels || []), ...(e.series || []).map((x) => x.n || '')].join('').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').split('').some((ch) => !winOk(ch) && ch !== '\n'));
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
    let SH = false, OP = 1, CUR = [1, 0, 0, 1, 0, 0];
    const mmul = (A, B) => [A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3], A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3], A[4] * B[0] + A[5] * B[2] + B[4], A[4] * B[1] + A[5] * B[3] + B[5]];
    // Link als klickbare Fläche in der PDF (Rechteck in Seitenkoordinaten)
    const addLink = (pg, href, x0, y0, x1, y1) => {
      try {
        const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [x * CUR[0] + y * CUR[2] + CUR[4], x * CUR[1] + y * CUR[3] + CUR[5]]);
        const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
        const ctx = doc.context;
        const an = ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFLib.PDFString.of(href) } });
        pg.node.addAnnot(ctx.register(an));
      } catch (er) { /* Link weglassen */ }
    };
    const col = (c) => (SH ? PDFLib.rgb(0, 0, 0) : hexRgb(c));
    const opa = () => { const o = SH ? 0.3 * OP : OP; return o < 1 ? { opacity: o, borderOpacity: o } : {}; };
    const tsz = (tk, fs) => (tk.sup || tk.sub ? fs * 0.65 : fs) * (tk.z || 1);
    // Text in ein Rechteck setzen (w in Einheiten)
    const layoutText = (ps, fs, w) => {
      const lines = [];
      const width = (tok) => { let s0 = 0; const z = tsz(tok, fs); for (const ch of tok.t) { const f = fontCh(ch, tok) || fontOf(tok); try { s0 += f.widthOfTextAtSize(ch, z); } catch (e) { s0 += z * 0.5; } } return s0; };
      for (const p of ps) {
        const ind0 = (p.list ? fs * 1.2 * p.lvl : 0) + (p.ml || 0) * fs; // Einzug links; erste Zeile zusätzlich um ti verschoben
        let ind = ind0 + (p.ti || 0) * fs + (p.bin ? fs * 0.75 : 0), maxW = Math.max(fs, w - ind); // Zeichen direkt vor dem Text
        const toks = [];
        for (const r of p.runs) for (const part of r.t.split(/(\s+)/)) if (part) toks.push({ ...r, t: part });
        let line = [], lw = 0, first = true;
        const push = (last) => { const m = line.length ? Math.max(...line.map((t) => t.z || 1)) : (p.runs[0] && p.runs[0].z) || 1; lines.push({ toks: line, w: lw, al: p.al, ind, bullet: first ? p : null, last, m, sb: first ? p.sb : undefined, sa: last ? p.sa : undefined, lh: p.lh }); first = false; line = []; lw = 0; ind = ind0; maxW = Math.max(fs, w - ind); };
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
      const fsL = fs * (ln.m || 1);
      const base = yTop + fsL * (0.92 + (lhm - 1.2) / 2);
      for (const tk of ln.toks) {
        const z = tsz(tk, fs), dy = tk.sup ? -z * 0.5 : tk.sub ? z * 0.2 : 0;
        // Markerfarbe hinter dem Wort (auch über die Lücke zum nächsten Wort)
        if (tk.bg && !SH) pg.drawRectangle({ x: x * K, y: -(yTop + fsL * lhm) * K, width: (tk.w + (gap || 0)) * K, height: fsL * lhm * K, color: hexRgb(tk.bg), ...opa() });
        let seg = '', segF = null;
        const flush2 = () => {
          if (!seg) return;
          pg.drawText(seg, { x: x * K, y: -(base + dy) * K, size: z * K, font: segF, color: col(tk.c || color), ...(opa().opacity != null ? { opacity: opa().opacity } : {}) });
          const w = segF.widthOfTextAtSize(seg, z);
          const lineAt = (yy) => pg.drawLine({ start: { x: x * K, y: -yy * K }, end: { x: (x + w) * K, y: -yy * K }, thickness: Math.max(0.5, z * 0.06 * K), color: col(tk.c || color), ...(opa().opacity != null ? { opacity: opa().opacity } : {}) });
          if (tk.u) lineAt(base + dy + z * 0.12);
          if (tk.s) lineAt(base + dy - z * 0.3);
          if (tk.href && !SH) addLink(pg, tk.href, x * K, -(yTop + fsL * lhm) * K, (x + w) * K, -yTop * K);
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
    // Höhe, die ein Text in einem Feld dieser Breite braucht (für Tabellenzeilen, die mit dem Text wachsen)
    // Gesamthöhe gesetzter Zeilen: Zeilenhöhe + Abstand vor/nach dem Absatz (eigener Abstand aus PowerPoint oder Standard G)
    const gapAfter = (l, fs, G) => (l.last ? fs * (l.m || 1) * (l.sa != null ? l.sa : G) : 0);
    const gapBefore = (l, fs) => (l.sb ? fs * (l.m || 1) * l.sb : 0);
    const linesHeight = (lines, fs, lhm, G) => {
      let h = 0;
      lines.forEach((l, i) => { h += gapBefore(l, fs) + fs * (l.m || 1) * (l.lh || lhm) + (i < lines.length - 1 ? gapAfter(l, fs, G) : 0); });
      return h;
    };
    const textHeight = (html, fs, w, pad, lhm, color, pg0) => {
      lhm = lhm || 1.2; const G = pg0 == null ? 0.3 : pg0;
      const lines = layoutText(paras(html, color), fs, w - 2 * pad);
      return linesHeight(lines, fs, lhm, G) + 2 * pad;
    };
    // pg0: Abstand nach einem Absatz in Schrifthöhen (Standard 0,3; Tabellen aus PowerPoint 0)
    const drawTextBox = (pg, html, x, y, w, h, fs, color, va, pad, K, lhm, pg0) => {
      lhm = lhm || 1.2; const G = pg0 == null ? 0.3 : pg0;
      const lines = layoutText(paras(html, color), fs, w - 2 * pad);
      const L = (l) => l.lh || lhm; // Zeilenabstand des Absatzes oder des Felds
      const lhOf = (l) => fs * (l.m || 1) * L(l);
      const total = linesHeight(lines, fs, lhm, G);
      let yy = y + pad + (va === 'm' ? Math.max(0, (h - 2 * pad - total) / 2) : va === 'b' ? Math.max(0, h - 2 * pad - total) : 0);
      lines.forEach((l, i) => { l.i0 = i; });
      for (const ln of lines) {
        yy += gapBefore(ln, fs);
        const avail = w - 2 * pad - ln.ind;
        const lx = x + pad + ln.ind + (ln.al === 'center' ? (avail - ln.w) / 2 : ln.al === 'right' ? avail - ln.w : 0);
        if (ln.bullet && ln.bullet.list) {
          const mark = ln.bullet.list === 'ol' ? ln.bullet.num + '.' : ln.bullet.bu || '•';
          const mf = ln.bullet.bu ? (fontCh([...mark][0], {}) || (FF.custom ? FF.r : F.r)) : (FF.custom ? FF.r : F.r);
          let mk = mark; if (ln.bullet.bu && !fontCh([...mark][0], {})) mk = '•';
          pg.drawText(mk, { x: (ln.bullet.bin ? lx - fs * 0.75 : x + pad + ln.ind + (ln.bullet.bi ? ln.bullet.bi * fs : -fs * (ln.bullet.list === 'ol' ? 1.1 : 0.8))) * K, y: -(yy + fs * (ln.m || 1) * (0.92 + (L(ln) - 1.2) / 2)) * K, size: fs * (ln.bullet.bs || 1) * K, font: mf, color: col(ln.bullet.bc || color) });
        }
        // Blocksatz: Lücken gleichmäßig strecken (nicht in der letzten Zeile eines Absatzes)
        let gap = 0;
        if (ln.al === 'justify' && !ln.last) {
          const spaces = ln.toks.filter((t) => !t.t.trim()).length;
          if (spaces) { const extra = (avail - ln.w) / spaces; ln.toks.forEach((t) => { if (!t.t.trim()) t.w += extra; }); gap = 0; drawJust(pg, ln, lx, yy, fs, color, K, L(ln), extra); yy += lhOf(ln); continue; }
        }
        drawRuns(pg, ln, lx, yy, fs, color, K, L(ln), gap);
        yy += lhOf(ln) + gapAfter(ln, fs, G);
      }
    };
    // Blocksatz-Zeile: Wort für Wort setzen
    const drawJust = (pg, ln, x0, yTop, fs, color, K, lhm, extra) => {
      let x = x0;
      for (const tk of ln.toks) {
        if (!tk.t.trim()) { x += tk.w; continue; }
        drawRuns(pg, { toks: [tk], m: ln.m }, x, yTop, fs, color, K, lhm, 0);
        x += tk.w;
      }
      void extra;
    };
    // Verlauf: Pfad als Schnittmaske, darin feine Streifen (linear) bzw. Ringe (rund)
    const gradAt = (st, t) => {
      if (t <= st[0][0]) return st[0];
      for (let i = 1; i < st.length; i++) if (t <= st[i][0]) { const [p0, c0, a0] = st[i - 1], [p1, c1, a1] = st[i]; const f = (t - p0) / Math.max(1e-6, p1 - p0); const A = hexRgb(c0), B = hexRgb(c1); return [t, PDFLib.rgb(A.red + (B.red - A.red) * f, A.green + (B.green - A.green) * f, A.blue + (B.blue - A.blue) * f), (a0 ?? 1) + ((a1 ?? 1) - (a0 ?? 1)) * f]; }
      return st[st.length - 1];
    };
    const drawGrad = (pg, d, e, K) => {
      const { pushGraphicsState, popGraphicsState, moveTo, lineTo, appendBezierCurve, appendQuadraticCurve, closePath, clip, endPath } = PDFLib;
      const ops = [pushGraphicsState()];
      for (const m of d.matchAll(/([MLCQZ])([^MLCQZ]*)/g)) {
        const v = (m[2].match(/-?\d*\.?\d+(e-?\d+)?/gi) || []).map((x) => +x * K);
        const Y = (i) => -v[i];
        if (m[1] === 'M') ops.push(moveTo(v[0], Y(1)));
        else if (m[1] === 'L') for (let i = 0; i + 1 < v.length; i += 2) ops.push(lineTo(v[i], Y(i + 1)));
        else if (m[1] === 'C') for (let i = 0; i + 5 < v.length; i += 6) ops.push(appendBezierCurve(v[i], Y(i + 1), v[i + 2], Y(i + 3), v[i + 4], Y(i + 5)));
        else if (m[1] === 'Q') for (let i = 0; i + 3 < v.length; i += 4) ops.push(appendQuadraticCurve(v[i], Y(i + 1), v[i + 2], Y(i + 3)));
        else ops.push(closePath());
      }
      ops.push(clip(), endPath());
      pg.pushOperators(...ops);
      const st = e.gr.s.map(([p, c, a]) => [p, c, a]);
      const N = 60, op0 = OP * (e.fo != null ? e.fo : 1);
      const colAt = (t) => { const g = gradAt(st, t); return { color: typeof g[1] === 'string' ? hexRgb(g[1]) : g[1], opacity: op0 * (g[2] ?? 1) }; };
      if (e.gr.rad) {
        const cx = e.w / 2, cy = e.h / 2;
        for (let i = N; i >= 1; i--) { const t = i / N, c = colAt(t); pg.drawEllipse({ x: cx * K, y: -cy * K, xScale: (e.w / 2) * 1.42 * t * K, yScale: (e.h / 2) * 1.42 * t * K, color: c.color, opacity: c.opacity }); }
      } else {
        const a = ((e.gr.ang || 0) * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a);
        const corners = [[0, 0], [e.w, 0], [0, e.h], [e.w, e.h]].map(([x, y]) => x * ux + y * uy);
        const t0 = Math.min(...corners), t1 = Math.max(...corners), L = Math.hypot(e.w, e.h) + 10;
        for (let i = 0; i < N; i++) {
          const a0 = t0 + ((t1 - t0) * i) / N, a1 = t0 + ((t1 - t0) * (i + 1.02)) / N, c = colAt((i + 0.5) / N);
          const P = (t, s0) => [t * ux - s0 * uy, t * uy + s0 * ux];
          const q = [P(a0, -L), P(a1, -L), P(a1, L), P(a0, L)];
          pg.drawSvgPath(`M${q[0][0]} ${q[0][1]}L${q[1][0]} ${q[1][1]}L${q[2][0]} ${q[2][1]}L${q[3][0]} ${q[3][1]}Z`, { x: 0, y: 0, scale: K, color: c.color, opacity: c.opacity });
        }
      }
      pg.pushOperators(popGraphicsState());
    };
    async function drawEl(pg, e, K, base) {
      FF = await famOf(e.ff);
      const B0 = base || [1, 0, 0, 1, 0, 0];
      OP = e.op != null ? Math.max(0, Math.min(1, e.op)) : 1;
      const cx = (e.x + e.w / 2) * K, cy = -(e.y + e.h / 2) * K;
      const a = -(e.r || 0) * Math.PI / 180;
      // zweimal zeichnen, wenn ein Schatten gewünscht ist: erst versetzt in Schwarz, dann normal
      for (const shadow of e.sh ? [true, false] : [false]) {
        SH = shadow;
        const d = shadow ? 3 * K : 0;
        const M1 = [1, 0, 0, 1, d, -d], M2 = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), cx, cy], M3 = [e.fx ? -1 : 1, 0, 0, e.fy ? -1 : 1, 0, 0], M4 = [1, 0, 0, 1, -e.w / 2 * K, e.h / 2 * K];
        CUR = mmul(M4, mmul(M3, mmul(M2, mmul(M1, B0))));
        pg.pushOperators(pushGraphicsState(), concatTransformationMatrix(...M1), concatTransformationMatrix(...M2), concatTransformationMatrix(...M3), concatTransformationMatrix(...M4));
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
        if (e.fill && e.fo != null && !SH) { pg.drawRectangle({ x: 0, y: -e.h * K, width: e.w * K, height: e.h * K, color: col(e.fill), opacity: OP * e.fo }); if (e.line) box(null, e.line); } else if (e.fill || e.line) box(e.fill, e.line);
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
          pg.drawSvgPath(shapePath(e.k, e.w, e.h, e), { ...opt, borderColor: col(stroke), borderWidth: sw * K, borderLineCap: 1 });
        } else {
          const dd0 = shapePath(e.k, e.w, e.h, e);
          if (dd0 && e.gr && !SH) { drawGrad(pg, dd0, e, K); }
          if (dd0) pg.drawSvgPath(dd0, { ...opt, color: e.fill && !(e.gr && !SH) ? col(e.fill) : undefined, borderColor: e.line ? col(e.line) : undefined, borderWidth: e.line ? sw * K : 0, ...(e.fo != null && e.fill && !SH ? { opacity: (opt.opacity != null ? opt.opacity : 1) * e.fo } : {}) });
          if (e.k === 'path' && e.ds && (e.line || '')) pg.drawSvgPath(scalePath(e.ds, e.w, e.h), { ...opt, borderColor: col(e.line), borderWidth: sw * K, borderLineCap: 1 });
          if (e.html) drawTextBox(pg, e.html, 0, 0, e.w, e.h, e.fs || 20, e.c || (e.fill ? '#FFFFFF' : th.fg), e.va || 'm', e.pad != null ? e.pad : 10, K, e.lh);
        }
        for (const hd of arrowHeads(e, sw)) pg.drawSvgPath(hd, { ...opt, borderColor: col(stroke), borderWidth: sw * K, borderLineCap: 1 });
      } else if (e.t === 'chart') {
        if (SH) { box('#000000', null); return; }
        if (e.fill) box(e.fill, null);
        for (const p of chartPrims(e, th)) {
          if (p.k === 'rect') { if (p.w > 0 && p.h > 0) pg.drawRectangle({ x: p.x * K, y: -(p.y + p.h) * K, width: p.w * K, height: p.h * K, color: hexRgb(p.fill), ...opa() }); }
          else if (p.k === 'line') pg.drawLine({ start: { x: p.x1 * K, y: -p.y1 * K }, end: { x: p.x2 * K, y: -p.y2 * K }, thickness: p.sw * K, color: hexRgb(p.c) });
          else if (p.k === 'path') pg.drawSvgPath(p.d, { x: 0, y: 0, scale: K, color: p.fill ? hexRgb(p.fill) : undefined, borderColor: p.stroke ? hexRgb(p.stroke) : undefined, borderWidth: (p.sw || 0) * K, ...opa() });
          else if (p.k === 'circle') pg.drawEllipse({ x: p.cx * K, y: -p.cy * K, xScale: p.r * K, yScale: p.r * K, color: hexRgb(p.fill) });
          else if (p.k === 'text') {
            const f = p.b ? FF.b : FF.r;
            const str = [...String(p.s)].filter((ch) => (FF.custom ? FF.set.has(ch.codePointAt(0)) : winOk(ch))).join('');
            let tw0 = 0; try { tw0 = f.widthOfTextAtSize(str, p.fs); } catch (er) { tw0 = str.length * p.fs * 0.5; }
            const x = p.a === 'middle' ? p.x - tw0 / 2 : p.a === 'end' ? p.x - tw0 : p.x;
            if (str) pg.drawText(str, { x: x * K, y: -p.y * K, size: p.fs * K, font: f, color: hexRgb(p.c) });
          }
        }
      } else if (e.t === 'table') {
        const rows = e.rows.length, cols = e.rows[0].length;
        const cw = e.cw || Array(cols).fill(1 / cols);
        const cp = e.cm ? e.cm[1] : Math.max(1, Math.round((e.fs || 18) / 3));
        const MG = mergeMap(e);
        let RH = tblRows(e).map((f) => f * e.h);
        if (e.rh) {
          // wie auf dem Bildschirm: Mindesthöhe je Zeile, bei mehr Text höher
          RH = tblRows(e, true).map((f, ri) => {
            let need = f * e.h;
            for (let ci = 0; ci < cols; ci++) {
              const k = ri + ',' + ci; if (MG.hid.has(k) || (MG.span[k] && MG.span[k][0] > 1)) continue;
              const csp = (MG.span[k] || [1, 1])[1]; let w = 0; for (let j = 0; j < csp; j++) w += e.w * cw[ci + j];
              const html = e.rows[ri][ci] || ''; if (!html.replace(/<[^>]+>/g, '').trim()) continue;
              try { need = Math.max(need, textHeight(html, e.fs || 18, w, cp, e.lh, th.fg, 0)); } catch (er) { /* */ }
            }
            return need;
          });
        }
        let yy = 0;
        for (let ri = 0; ri < rows; ri++) {
          let xx = 0;
          for (let ci = 0; ci < cols; ci++) {
            const w0 = e.w * cw[ci];
            if (MG.hid.has(ri + ',' + ci)) { xx += w0; continue; }
            const [rs, cs] = MG.span[ri + ',' + ci] || [1, 1];
            let w = 0; for (let j = 0; j < cs; j++) w += e.w * cw[ci + j];
            let hh = 0; for (let j = 0; j < rs && ri + j < rows; j++) hh += RH[ri + j];
            const head = ri === 0 && e.head, cst = (e.cs && e.cs[ri + ',' + ci]) || {};
            const cf = cst.f || (head ? th.accent : null);
            pg.drawRectangle({ x: xx * K, y: -(yy + hh) * K, width: w * K, height: hh * K, color: cf ? col(cf) : (SH ? col('#000000') : undefined), borderColor: col(e.line || '#868E96'), borderWidth: 0.75, ...opa() });
            const bold = head || cst.b;
            if (!SH) drawTextBox(pg, (bold ? '<b>' : '') + (e.rows[ri][ci] || '') + (bold ? '</b>' : ''), xx, yy, w, hh, e.fs || 18, cst.c || (head ? '#FFFFFF' : th.fg), cst.v || e.va || 'm', cp, K, e.lh, e.cm ? 0 : undefined);
            xx += w0;
          }
          yy += RH[ri];
        }
      }
    }
    return { drawEl };
  }
  // Hintergrund in die PDF: Farbe, Verlauf (feine Streifen) oder Bild (füllend)
  async function drawBg(doc, pg, s, th, K) {
    const b = bgOf(s, th);
    pg.drawRectangle({ x: 0, y: -H * K, width: W * K, height: H * K, color: hexRgb(b.color) });
    if (b.grad) {
      const A = hexRgb(b.grad.a), B = hexRgb(b.grad.b), n = 180, dir = b.grad.dir || 'v';
      const mix = (t) => PDFLib.rgb(A.red + (B.red - A.red) * t, A.green + (B.green - A.green) * t, A.blue + (B.blue - A.blue) * t);
      if (dir === 'd') {
        // schräg: Streifen senkrecht zur Diagonale, über die ganze Folie
        const L = (W + H) * K;
        for (let i = 0; i < n; i++) { const t0 = i / n; pg.drawSvgPath(`M${t0 * L} 0L${t0 * L + L / n + 1} 0L${t0 * L + L / n + 1 - H * K} ${H * K}L${t0 * L - H * K} ${H * K}Z`, { x: 0, y: 0, color: mix((i + 0.5) / n) }); }
      } else for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        if (dir === 'h') pg.drawRectangle({ x: (i / n) * W * K, y: -H * K, width: W * K / n + 0.5, height: H * K, color: mix(t) });
        else pg.drawRectangle({ x: 0, y: -((i + 1) / n) * H * K - 0.25, width: W * K, height: H * K / n + 0.5, color: mix(t) });
      }
    }
    if (b.img) {
      try {
        const bin = new Uint8Array(await (await fetch(imgUrl(b.img), { credentials: 'same-origin' })).arrayBuffer());
        const im = /\.png$/i.test(b.img) ? await doc.embedPng(bin) : await doc.embedJpg(bin);
        const a = im.width / im.height, sa = W / H;
        const w = a > sa ? H * a : W, h = a > sa ? H : W / a;
        pg.pushOperators(PDFLib.pushGraphicsState(), PDFLib.rectangle(0, -H * K, W * K, H * K), PDFLib.clip(), PDFLib.endPath());
        pg.drawImage(im, { x: (W - w) / 2 * K, y: -((H - h) / 2 + h) * K, width: w * K, height: h * K });
        pg.pushOperators(PDFLib.popGraphicsState());
      } catch (er) { /* Bild fehlt */ }
    }
  }
  // als PowerPoint-Datei (.pptx): Texte, Formen, Tabellen und Diagramme bleiben in PowerPoint bearbeitbar
  async function exportPptxDeck() {
    D.ed.endEdit(); await flush();
    C.toast("Creating PowerPoint file …", 120000);
    try {
      const M = await C.pptx();
      const { blob, skipped } = await M.exportPptx(D.deck, { hf: (i) => hfEls(i), progress: (t) => C.toast(t, 120000) });
      C.downloadBlob(blob, (D.deck.title || "Presentation").replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.pptx');
      C.toast(skipped ? `PowerPoint file created – ${skipped} object(s) could not be transferred.` : "PowerPoint file created.", 5000);
    } catch (e) { C.toast(e.message || String(e), 8000); }
  }
  async function exportPdf(where) {
    D.ed.endEdit(); await flush();
    C.toast("Creating PDF …", 60000);
    try {
      const { PDFDocument, pushGraphicsState, popGraphicsState, concatTransformationMatrix } = PDFLib;
      const doc = await PDFDocument.create();
      doc.setTitle(D.deck.title || "Presentation");
      doc.setCreator('PDF-Stift');
      const th = theme();
      const P = await painter(doc, th, D.deck.slides.flatMap((s) => s.els));
      const K = 0.75; // Bildpunkt → pt
      const hidden = D.deck.slides.filter((x) => x.hidden).length;
      for (const s of D.deck.slides) {
        if (s.hidden) continue;
        const pg = doc.addPage([W * K, H * K]);
        // Ursprung oben links, y nach unten negativ
        pg.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, 1, 0, H * K));
        await drawBg(doc, pg, s, th, K);
        for (const e of [...s.els, ...hfEls(D.deck.slides.indexOf(s))]) if (!isPh(e)) await P.drawEl(pg, e, K, [1, 0, 0, 1, 0, H * K]);
        for (const k of s.ink || []) { const d = inkPath(k.p); if (d) pg.drawSvgPath(d, { x: 0, y: 0, scale: K, borderColor: hexRgb(k.c), borderWidth: k.w * K, borderLineCap: 1, ...(k.hl ? { borderOpacity: 0.38, blendMode: PDFLib.BlendMode.Multiply } : {}) }); }
        pg.pushOperators(popGraphicsState());
      }
      const bytes = await doc.save();
      const name = (D.deck.title || "Presentation").replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.pdf';
      const blob = new Blob([bytes], { type: 'application/pdf' });
      if (where === 'library') { await C.uploadPdf(blob, name); C.toast(`“${name}” is now in “My PDFs”.`, 5000); }
      else { C.downloadBlob(blob, name); C.toast(hidden ? `PDF saved (${hidden} hidden slide${hidden > 1 ? 'n' : ''} not included).` : "PDF saved.", 3500); }
    } catch (err) { C.toast("PDF could not be created: " + err.message, 8000); }
  }

  // kleine Vorschau einer Folie (Bibliothek)
  function preview(s, th, width) {
    const k = width / W, oldH = H;
    H = slideH(th);
    const box = document.createElement('div');
    box.style.cssText = `width:${W * k}px;height:${H * k}px;overflow:hidden;position:relative`;
    box.appendChild(slideNode(s || { els: [] }, k, false, th || DEF_TH));
    H = oldH;
    return box;
  }

  FM.ready.then(() => { if (D.root && D.deck) renderAll(); if (C.fontsReady) C.fontsReady(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'F1' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); ev.stopImmediatePropagation(); rbCollapse(); } }, true);
  window.PDFSTIFT_DECK = { open, close, flush, preview, makeEditor, layerNode, elNode, painter, popMenu, clean, plain, insertGroup, ICON, RI,
    PX: { mergeMap, tblRows, animOrder, W, slideH, H: () => H, fontKey, fontOffice, fontsReady: () => FM.ready, chartColors, clean, isPh, imgUrl, mediaUrl, inkSvg, hfEls, uid, bgOf, DEF_TH }, replaceInEls, audience, rbCollapse, deckEditor: () => (D.root && D.deck ? D.ed : null), RB };
})();
