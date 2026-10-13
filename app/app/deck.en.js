/* Automatisch erzeugt aus deck.js (tools/i18n) – nicht von Hand ändern. */
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
  const FONTS = { sans: 'Helvetica, Arial, "Liberation Sans", sans-serif', serif: '"Times New Roman", Times, "Liberation Serif", serif', mono: '"Courier New", Courier, "Liberation Mono", monospace',
    carlito: '"PS Carlito", Carlito, Calibri, sans-serif', opensans: '"PS Open Sans", "Open Sans", sans-serif', caveat: '"PS Caveat", Caveat, cursive' };
  // freie Schriften (SIL Open Font License) liegen in vendor/fonts und werden erst bei Bedarf geladen
  const FONT_LIST = [['sans', 'Helvetica / Arial'], ['carlito', "Carlito (like Calibri)"], ['opensans', 'Open Sans'], ['serif', 'Times'], ['mono', 'Courier'], ['caveat', "Caveat (handwriting)"]];
  const FONT_FILES = { carlito: 'Carlito', opensans: 'OpenSans', caveat: 'Caveat' };
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
  const newSlide = (lay) => ({ id: uid(), els: (LAYOUTS[lay] || LAYOUTS.blank).els().map((e) => ({ id: uid(), r: 0, ...e })) });
  const theme = () => D.deck.theme || (D.deck.theme = { ...DEF_TH });
  const slide = () => D.deck && D.deck.slides[D.cur];
  const isLine = (e) => e.t === 'shape' && (e.k === 'line' || e.k === 'arrow');

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
        else if (tag === 'span' || tag === 'font') {
          const c = st.color || n.getAttribute('color');
          const bold = /bold|[6-9]00/.test(st.fontWeight || ''), it = st.fontStyle === 'italic', un = /underline/.test(st.textDecoration || st.textDecorationLine || '');
          el = document.createElement('span');
          if (c) el.style.color = c;
          let inner = el;
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
  function shapePath(kind, w, h) {
    switch (kind) {
      case 'round': { const r = Math.min(w, h) * 0.18; return `M${r} 0H${w - r}Q${w} 0 ${w} ${r}V${h - r}Q${w} ${h} ${w - r} ${h}H${r}Q0 ${h} 0 ${h - r}V${r}Q0 0 ${r} 0Z`; }
      case 'ellipse': return `M0 ${h / 2}A${w / 2} ${h / 2} 0 1 0 ${w} ${h / 2}A${w / 2} ${h / 2} 0 1 0 0 ${h / 2}Z`;
      case 'tri': return `M${w / 2} 0L${w} ${h}L0 ${h}Z`;
      case 'arrowR': { const a = Math.min(w * 0.4, h); return `M0 ${h * 0.3}H${w - a}V0L${w} ${h / 2}L${w - a} ${h}V${h * 0.7}H0Z`; }
      case 'line': return `M0 ${h / 2}H${w}`;
      case 'arrow': return `M0 ${h / 2}H${w}`;
      default: return `M0 0H${w}V${h}H0Z`;
    }
  }
  const pos = (e) => `left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${e.h}px;transform:rotate(${e.r || 0}deg)`;
  function elNode(e, th) {
    th = th || DEF_TH;
    const n = document.createElement('div');
    n.className = 'dk-el dk-' + e.t;
    n.dataset.id = e.id;
    n.style.cssText = pos(e);
    if (e.ff && FONTS[e.ff]) n.style.fontFamily = FONTS[e.ff];
    const pad = e.pad != null ? e.pad : 8;
    if (e.t === 'text') {
      const tx = document.createElement('div');
      tx.className = 'dk-tx va-' + (e.va || 't');
      tx.style.fontSize = (e.fs || 24) + 'px';
      tx.style.color = e.c || th.fg;
      tx.style.padding = pad + 'px';
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
      const sw = isLine(e) ? Math.max(0.5, e.lw || 3) : (e.line ? e.lw || 2 : 0);
      const hp = sw / 2;
      const head = e.k === 'arrow' ? `<path d="M${e.w - 4 * sw - hp} ${e.h / 2 - 2.2 * sw}L${e.w - hp} ${e.h / 2}L${e.w - 4 * sw - hp} ${e.h / 2 + 2.2 * sw}" fill="none" stroke="${e.line || th.fg}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>` : '';
      const lineK = isLine(e);
      n.innerHTML = `<svg viewBox="${-hp} ${-hp} ${e.w + sw} ${e.h + sw}" width="${e.w + sw}" height="${e.h + sw}" style="margin:${-hp}px;width:${e.w + sw}px;height:${e.h + sw}px;max-width:none" preserveAspectRatio="none">` +
        `<path d="${shapePath(e.k, lineK ? e.w - (e.k === 'arrow' ? hp : 0) : e.w, e.h)}" fill="${lineK ? 'none' : e.fill || 'none'}" stroke="${e.line || (lineK ? th.fg : 'none')}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>${head}</svg>`;
      if (e.html && !lineK) {
        const tx = document.createElement('div');
        tx.className = 'dk-tx va-m'; tx.style.fontSize = (e.fs || 20) + 'px'; tx.style.color = e.c || '#FFFFFF'; tx.style.padding = pad + 'px';
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
    sl.style.cssText = `width:${W}px;height:${H}px;background:${s.bg || th.bg};font-family:${FONTS[th.font] || FONTS.sans};transform:scale(${scale});transform-origin:0 0`;
    for (const e of s.els) if (live || !isPh(e)) sl.appendChild(elNode(e, th));
    return sl;
  }
  // Ebene mit Objekten (z. B. über einer PDF-Seite): w × h Einheiten, durchsichtig
  function layerNode(els, w, h, scale, th) {
    th = th || DEF_TH;
    const sl = document.createElement('div');
    sl.className = 'dk-slide dk-layer';
    sl.style.cssText = `width:${w}px;height:${h}px;background:transparent;overflow:visible;font-family:${FONTS[th.font] || FONTS.sans};transform:scale(${scale});transform-origin:0 0`;
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
  const SHAPES = [['rect', "Rectangle"], ['round', "Rounded rectangle"], ['ellipse', "Circle / ellipse"], ['tri', "Triangle"], ['arrowR', "Block arrow"], ['line', "Line"], ['arrow', "Arrow"]];
  const SHAPE_IC = { rect: '<rect x="4" y="6.5" width="16" height="11"/>', round: '<rect x="4" y="6.5" width="16" height="11" rx="3.5"/>', ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6"/>', tri: '<path d="M12 5l8.5 14h-17z"/>',
    arrowR: '<path d="M3 9.5h10V5.5l8 6.5-8 6.5v-4H3z"/>', line: '<path d="M4 19L20 5"/>', arrow: '<path d="M4 19L20 5"/><path d="M12.5 5H20v7.5"/>' };
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

  // ================================================================== Bearbeitungskern (Folie oder PDF-Seite)
  /* host: box() Element mit der Fläche · stage() fängt den Zeiger · fmtBar() Format-Leiste · W(), H(), k() Maße und Maßstab
   *       unit Größenfaktor für neue Objekte · els()/setEls(a) · theme() · snap()/commit(vorher) Rückgängig + Speichern
   *       surface() Fläche zeichnen · typing() beim Tippen · placing(an) Einfügemodus · pickImage() · rendered() */
  function makeEditor(host) {
    const ED = { sel: [], edit: null, insert: null, clip: null };
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
        if (n) { n.style.cssText = pos(e); if (e.ff && FONTS[e.ff]) n.style.fontFamily = FONTS[e.ff]; }
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
      const e = list[0] || null, has = !!e;
      const line = !!e && isLine(e);
      const textish = !!e && (e.t === 'text' || e.t === 'table' || (e.t === 'shape' && !line));
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
      let h = '';
      if (host.ribbonPre) h += host.ribbonPre({ grp, rows, big, sb, mb, svg, sep });
      // Zwischenablage
      const canPaste = !!(ED.clip || (host.clipboard && host.clipboard()));
      h += grp("Clipboard", big('data-f="paste"', "Insert", RI.paste, canPaste) + rows(sb('cut', "Cut (Ctrl+X)", RI.cut, { en: has, label: "Cut" }), sb('copy', "Copy (Ctrl+C)", ICON.dup, { en: has, label: "Copy" }), sb('x:dup', "Duplicate (Ctrl+D)", RI.dup2, { en: has, label: "Duplicate" })));
      // Einfügen
      h += grp("Insert", big('data-ins="text"', "Text box", ICON.textbox) + big('data-ins="img"', "image", ICON.img) + big('data-ins="table"', "Table", ICON.table));
      // Schriftart
      const fs0 = e ? Math.round(e.fs || 24) : '';
      const sizes = !e || SIZES.includes(fs0) ? SIZES : [...SIZES, fs0].sort((x, y) => x - y);
      const ff0 = (e && e.ff) || host.theme().font || 'sans';
      h += grp("Font", rows(
        `<select data-f="ff" class="rb-font" title="Font"${dis(textish)}>${FONT_LIST.map(([k, l]) => `<option value="${k}"${k === ff0 ? ' selected' : ''} style="font-family:${esc(FONTS[k])}">${esc(l)}</option>`).join('')}</select>` +
        `<select data-f="fs" class="rb-size" title="Font size"${dis(textish)}>${e ? '' : '<option></option>'}${sizes.map((x) => `<option value="${x}"${x === fs0 ? ' selected' : ''}>${x}</option>`).join('')}</select>` +
        sb('fs+', "Increase font size", RI.grow, { en: textish }) + sb('fs-', "Decrease font size", RI.shrink, { en: textish }) + sb('clear', "Clear formatting", RI.clear, { en: textish }),
        `<button type="button" class="rb-s rb-t" data-f="bold" title="Bold (Ctrl+B)"${dis(textish)}><b>B</b></button><button type="button" class="rb-s rb-t" data-f="italic" title="Italic (Ctrl+I)"${dis(textish)}><i>I</i></button><button type="button" class="rb-s rb-t" data-f="underline" title="Underline (Ctrl+U)"${dis(textish)}><u>U</u></button>` +
        sep + cb('color', "Font color", ED.lastColor || '#D6262B', false, '<span class="cb-a">A</span>', textish)));
      // Absatz
      const va = e && e.t !== 'table' ? (e.va || 't') : '';
      const vaOk = textish && e.t !== 'table';
      h += grp("Paragraph", rows(
        sb('ul', "Bullets", RI.ul, { en: textish }) + sb('ol', "Numbering", RI.ol, { en: textish }) + sep + sb('outdent', "Decrease indent", RI.outdent, { en: textish }) + sb('indent', "Increase indent", RI.indent, { en: textish }),
        sb('al', "Align left", RI.al, { v: 'left', en: textish }) + sb('al', "Center", RI.ac, { v: 'center', en: textish }) + sb('al', "Align right", RI.ar, { v: 'right', en: textish }) + sb('al', "Justify", RI.aj, { v: 'justify', en: textish }) + sep +
        sb('va', "Align top", RI.vt, { v: 't', en: vaOk, on: va === 't' }) + sb('va', "Align middle", RI.vm, { v: 'm', en: vaOk, on: va === 'm' }) + sb('va', "Align bottom", RI.vb, { v: 'b', en: vaOk, on: va === 'b' })));
      // Zeichnen: Formen-Galerie, Anordnen, Füllung, Kontur
      const gal = `<div class="rb-gal">${SHAPES.map(([k, l]) => `<button type="button" class="rb-sh" data-ins="shape:${k}" title="${esc(l)} – click or drag" aria-label="${esc(l)}">${svg(SHAPE_IC[k])}</button>`).join('')}</div>`;
      const lw0 = e ? (e.lw || (line ? 3 : 2)) : 2;
      h += grp("Drawing", gal + big('data-menu="arrange"', "Arrange", RI.arrange, has, true) + rows(
        cb('fill', "Fill", e && e.fill, true, svg(ICON.fill), !!e && (e.t === 'shape' && !line || e.t === 'text')),
        cb('line', "Outline", e && (e.line || (e.t === 'table' ? '#868E96' : '')), e ? e.t !== 'table' : true, svg(ICON.line), shapeish || (!!e && e.t === 'table')),
        `<select data-f="lw" class="rb-lw" title="Line width"${dis(!!e && (e.t === 'shape' || e.t === 'text'))}>${[0.5, 1, 2, 3, 4, 6, 8, 12].map((v) => `<option value="${v}"${v === lw0 ? ' selected' : ''}>${v} pt</option>`).join('')}</select>`), 'rb-draw');
      // je nach Auswahl: Tabelle, Bild
      if (e && e.t === 'table') {
        h += grp("Table", rows(sb('row+', "Insert row below", RI.rowAdd, { label: "Row" }) + sb('col+', "Insert column right", RI.colAdd, { label: "Column" }),
          sb('row-', "Delete row", RI.rowDel, { label: "Row" }) + sb('col-', "Delete column", RI.colDel, { label: "Column" })) + big('data-f="head"', "Header row", ICON.table, true), 'ctx');
      }
      if (e && e.t === 'img') h += grp("image", big('data-f="imgreset"', "Original shape", ICON.img, true), 'ctx');
      // Bearbeiten
      h += grp("Editing", rows(sb('selall', "Select all (Ctrl+A)", RI.selall, { label: "Select All", en: els().length > 0 }), sb('x:del', "Delete (Del)", ICON.del, { label: "Delete", en: has }), sb('rot90', "Rotate 90°", RI.rot, { label: "Rotate", en: has })));
      bar.innerHTML = h;
      bar.hidden = false;
      if (e && e.t === 'table' && e.head) { const hb = bar.querySelector('[data-f="head"]'); if (hb) hb.classList.add('on'); }
      const insK = ED.insert || (host.insertKind && host.insertKind());
      if (insK) bar.querySelectorAll(`[data-ins="${insK}"]`).forEach((x) => x.classList.add('on'));
      bar.onmousedown = (ev) => { if (!ev.target.closest('select')) ev.preventDefault(); }; // Auswahl im Text bleibt erhalten
      bar.onpointerdown = (ev) => ev.stopPropagation();
      bar.onclick = (ev) => {
        const t = ev.target.closest('button');
        if (!t || t.disabled) return;
        if (t.dataset.ins) { if (host.onIns) host.onIns(t.dataset.ins); else ins(t.dataset.ins); return; }
        if (t.dataset.pal) { palette(t, t.dataset.pal, !!t.dataset.none); return; }
        if (t.dataset.menu) { menu(t.dataset.menu, t); return; }
        if (t.dataset.f) fmt(t.dataset.f, t.dataset.v, t);
      };
      bar.onchange = (ev) => { const sl = ev.target.closest('select[data-f]'); if (sl) fmt(sl.dataset.f, sl.value); };
    }
    // Auswahlmenüs im Menüband
    function menu(m, btn) {
      const r = btn.getBoundingClientRect();
      if (m === 'arrange') {
        popMenu(r.left, r.bottom + 4, [
          ['front', "Bring to front", () => act('front', btn)], ['back', "Send to back", () => act('back', btn)], ['-', ''],
          ['al', host.alignWord ? "Align to page …" : "Align to slide …", () => act('align', btn)], ['r90', "Rotate 90°", () => fmt('rot90')], ['r0', "Reset rotation", () => fmt('rot0')],
        ]);
        return;
      }
      if (host.menu) host.menu(m, btn);
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
      m.onclick = (ev) => { const b = ev.target.closest('[data-v]'); if (!b) return; m.remove(); if (f === 'color') ED.lastColor = b.dataset.v; fmt(f, b.dataset.v); };
      setTimeout(() => document.addEventListener('pointerdown', function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } }, true), 0);
    }
    // Format anwenden: im Bearbeiten auf die Markierung, sonst aufs ganze Element
    function fmt(f, v, btn) {
      const ids = ED.sel.slice();
      const each = (fn) => change(() => ids.forEach((id) => { const e = byId(id); if (e) fn(e); }), true);
      if (f.startsWith('x:')) { act(f.slice(2), btn); return; }
      if (f === 'paste') { if (host.onPaste) host.onPaste(); else pasteEls(); return; }
      if (f === 'copy') { copy(); C.toast("Copied – insert with “Paste” or Ctrl+V.", 2500); render(); return; }
      if (f === 'cut') { copy(); act('del'); return; }
      if (f === 'selall') { select(els().map((x) => x.id)); return; }
      if (f === 'rot90') { each((x) => { x.r = ((x.r || 0) + 90) % 360; }); return; }
      if (f === 'rot0') { each((x) => { x.r = 0; }); return; }
      if (f === 'fs+' || f === 'fs-') { each((x) => { const c = x.fs || 24; x.fs = f === 'fs+' ? (SIZES.find((z) => z > c) || c + 8) : ([...SIZES].reverse().find((z) => z < c) || Math.max(4, c - 2)); }); return; }
      const inline = ['bold', 'italic', 'underline', 'color', 'ul', 'ol', 'al', 'clear', 'indent', 'outdent'];
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
      if (f === 'ff') { if (!FONTS[v]) return; each((e) => { e.ff = v; }); if (document.fonts && FONT_FILES[v]) document.fonts.load(`16px ${FONTS[v].split(',')[0]}`).then(() => { if (grow()) render(); }).catch(() => {}); return; }
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
    function selAll(n) { const r = document.createRange(); r.selectNodeContents(n); const s = getSelection(); s.removeAllRanges(); s.addRange(r); n.focus(); }
    function execFmt(f, v) {
      document.execCommand('styleWithCSS', false, false);
      if (f === 'bold' || f === 'italic' || f === 'underline') document.execCommand(f);
      else if (f === 'color') { document.execCommand('styleWithCSS', false, true); document.execCommand('foreColor', false, v); }
      else if (f === 'ul') document.execCommand('insertUnorderedList');
      else if (f === 'ol') document.execCommand('insertOrderedList');
      else if (f === 'al') document.execCommand(v === 'center' ? 'justifyCenter' : v === 'right' ? 'justifyRight' : v === 'justify' ? 'justifyFull' : 'justifyLeft');
      else if (f === 'clear') document.execCommand('removeFormat');
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
      if (ev.shiftKey || ev.ctrlKey) { ED.sel = ED.sel.includes(nid) ? ED.sel.filter((x) => x !== nid) : [...ED.sel, nid]; render(); return true; }
      if (!ED.sel.includes(nid)) ED.sel = [nid];
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
        const line = k === 'line' || k === 'arrow';
        e = { ...base, t: 'shape', k, x: x - (line ? 0 : 90 * q), y: y - (line ? 10 * q : 60 * q), w: r1((line ? 220 : 180) * q), h: r1((line ? 20 : 120) * q), lw: line ? 3 : 2, fs: Math.round(20 * q) };
        if (line) e.line = host.theme().fg; else e.fill = host.theme().accent;
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
    fmtBar: () => D.root && $('.dk-fmt', D.root),
    W: () => W, H: () => H, k: () => D.k || 1, unit: 1,
    els: () => (slide() ? slide().els : []),
    setEls: (a) => { if (slide()) slide().els = a; },
    theme: () => theme(),
    snap: () => snap(),
    commit(b) { if (b !== snap()) { D.undo.push(b); if (D.undo.length > 150) D.undo.shift(); D.redo = []; } renderList(); save(); },
    typing() { save(); clearTimeout(D.thumbT); D.thumbT = setTimeout(renderList, 500); },
    surface: () => (slide() ? slideNode(slide(), D.k || 1, true, theme()) : null),
    rendered: () => fit(),
    placing: (on, kind) => { if (!D.root) return; D.root.classList.toggle('dk-placing', !!on); D.root.querySelectorAll('[data-ins]').forEach((b) => b.classList.toggle('on', !!on && b.dataset.ins === kind)); },
    pickImage: () => $('.dk-file', D.root).click(),
    ribbonPre: ({ grp, rows, big, mb }) => grp("slides", big('data-menu="newslide"', "New slide", RI.newslide, true, true) +
      rows(mb('layout', "Layout of this slide", RI.layout, true, 'Layout'), mb('bg', "Background", RI.bg, true, "Background"), mb('design', "Design of all slides", RI.design, true, 'Design'))),
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
        ${ib('undo', ICON.undo, "Undo (Ctrl+Z)")}${ib('redo', ICON.redo, "Redo (Ctrl+Y)")}
        <span class="dk-grow"></span>
        <span class="dk-state muted small"></span>
        ${ib('play', ICON.play, "Present (F5)", "Present")}${ib('pdf', ICON.pdf, "Save as PDF", 'PDF')}
      </div>
      <div class="dk-fmt rb-band"></div>
      <div class="dk-main">
        <aside class="dk-list" aria-label="Slides"></aside>
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
    add.type = 'button'; add.className = 'dk-add'; add.textContent = "+ New slide";
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
      ['new', "New slide after this …", () => layoutMenu(x, y)],
      ['dup', "Duplicate slide", () => change(() => { const s = clone(slide()); s.id = uid(); s.els.forEach((e) => { e.id = uid(); }); D.deck.slides.splice(D.cur + 1, 0, s); D.cur++; })],
      ['bg', "Background of this slide …", () => bgMenu(x, y, false)],
      ['-', ''],
      ['del', "Delete slide", () => { if (D.deck.slides.length < 2) { C.toast("The last slide stays."); return; } change(() => { D.deck.slides.splice(D.cur, 1); D.cur = Math.min(D.cur, D.deck.slides.length - 1); }); }],
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
    if (a === 'play') { present(); return; }
    if (a === 'pdf') { popMenu(r.left - 120, r.bottom + 4, [['dl', "Download PDF", () => exportPdf('download')], ['lib', "Put PDF into “My PDFs” (to write on)", () => exportPdf('library')]]); return; }
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
        if (tag === 'b') s2.b = 1; if (tag === 'i') s2.i = 1; if (tag === 'u') s2.u = 1;
        if (tag === 'span' && c.style.color) s2.c = c.style.color;
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
    const famOf = async (ff) => {
      ff = FONTS[ff] ? ff : (th.font === 'serif' ? 'serif' : 'sans');
      if (fams[ff]) return fams[ff];
      if (STD[ff]) {
        const [r, b, i, bi] = await Promise.all(STD[ff].map((n) => doc.embedFont(n)));
        fams[ff] = { r, b, i, bi, custom: false };
      } else {
        if (!kitOk) { await C.ensureFontkit(); doc.registerFontkit(window.fontkit); kitOk = true; }
        const base = FONT_FILES[ff];
        const get = async (st) => { const r = await fetch('vendor/fonts/' + base + '-' + st + '.ttf?v=' + C.VERSION); if (!r.ok) throw new Error("Font missing"); return doc.embedFont(new Uint8Array(await r.arrayBuffer()), { subset: true }); };
        const r = await get('Regular'), b = await get('Bold');
        const i = ff === 'caveat' ? r : await get('Italic'), bi = ff === 'caveat' ? b : await get('BoldItalic');
        fams[ff] = { r, b, i, bi, custom: true, set: new Set(r.getCharacterSet()) };
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
    // Text in ein Rechteck setzen (w in Einheiten)
    const layoutText = (ps, fs, w) => {
      const lines = [];
      const width = (tok) => { let s = 0; for (const ch of tok.t) { const f = fontCh(ch, tok) || fontOf(tok); try { s += f.widthOfTextAtSize(ch, fs); } catch (e) { s += fs * 0.5; } } return s; };
      for (const p of ps) {
        const ind = p.list ? fs * 1.2 * p.lvl : 0;
        const maxW = Math.max(fs, w - ind);
        const toks = [];
        for (const r of p.runs) for (const part of r.t.split(/(\s+)/)) if (part) toks.push({ ...r, t: part });
        let line = [], lw = 0, first = true;
        const push = (last) => { lines.push({ toks: line, w: lw, al: p.al, ind, bullet: first ? p : null, last }); first = false; line = []; lw = 0; };
        for (const tk of toks) {
          const tw = width(tk);
          if (lw + tw > maxW && line.length && tk.t.trim()) { while (line.length && !line[line.length - 1].t.trim()) lw -= width(line.pop()); push(false); }
          if (!line.length && !tk.t.trim()) continue;
          line.push(tk); lw += tw;
        }
        push(true);
      }
      return lines;
    };
    const drawRuns = (pg, ln, x0, yTop, fs, color, K) => {
      let x = x0;
      const base = yTop + fs * 0.92;
      for (const tk of ln.toks) {
        let seg = '', segF = null;
        const flush2 = () => {
          if (!seg) return;
          pg.drawText(seg, { x: x * K, y: -base * K, size: fs * K, font: segF, color: hexRgb(tk.c || color) });
          const w = segF.widthOfTextAtSize(seg, fs);
          if (tk.u) pg.drawLine({ start: { x: x * K, y: -(base + fs * 0.12) * K }, end: { x: (x + w) * K, y: -(base + fs * 0.12) * K }, thickness: Math.max(0.5, fs * 0.06 * K), color: hexRgb(tk.c || color) });
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
    const drawTextBox = (pg, html, x, y, w, h, fs, color, va, pad, K) => {
      const lines = layoutText(paras(html, color), fs, w - 2 * pad);
      const lh = fs * 1.2;
      const total = lines.reduce((a, l) => a + lh + (l.last ? fs * 0.3 : 0), 0) - (lines.length ? fs * 0.3 : 0);
      let yy = y + pad + (va === 'm' ? Math.max(0, (h - 2 * pad - total) / 2) : va === 'b' ? Math.max(0, h - 2 * pad - total) : 0);
      for (const ln of lines) {
        const avail = w - 2 * pad - ln.ind;
        const lx = x + pad + ln.ind + (ln.al === 'center' ? (avail - ln.w) / 2 : ln.al === 'right' ? avail - ln.w : 0);
        if (ln.bullet && ln.bullet.list) {
          const mark = ln.bullet.list === 'ol' ? ln.bullet.num + '.' : '•';
          pg.drawText(mark, { x: (x + pad + ln.ind - fs * (ln.bullet.list === 'ol' ? 1.1 : 0.8)) * K, y: -(yy + fs * 0.92) * K, size: fs * K, font: FF.custom ? FF.r : F.r, color: hexRgb(color) });
        }
        drawRuns(pg, ln, lx, yy, fs, color, K);
        yy += lh + (ln.last ? fs * 0.3 : 0);
      }
    };
    async function drawEl(pg, e, K) {
      FF = await famOf(e.ff);
      const cx = (e.x + e.w / 2) * K, cy = -(e.y + e.h / 2) * K;
      const a = -(e.r || 0) * Math.PI / 180;
      pg.pushOperators(pushGraphicsState(), concatTransformationMatrix(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), cx, cy), concatTransformationMatrix(1, 0, 0, 1, -e.w / 2 * K, e.h / 2 * K));
      // jetzt: lokaler Ursprung oben links am Element
      const lw = (e.lw || 2) * K;
      const pad = e.pad != null ? e.pad : 8;
      try {
        if (e.t === 'text') {
          if (e.fill || e.line) pg.drawRectangle({ x: 0, y: -e.h * K, width: e.w * K, height: e.h * K, color: e.fill ? hexRgb(e.fill) : undefined, borderColor: e.line ? hexRgb(e.line) : undefined, borderWidth: e.line ? lw : 0 });
          drawTextBox(pg, e.html || '', 0, 0, e.w, e.h, e.fs || 24, e.c || th.fg, e.va || 't', pad, K);
        } else if (e.t === 'img') {
          try { const im = await getImg(e.src); pg.drawImage(im, { x: 0, y: -e.h * K, width: e.w * K, height: e.h * K }); } catch (err) { /* Bild fehlt */ }
          if (e.line) pg.drawRectangle({ x: 0, y: -e.h * K, width: e.w * K, height: e.h * K, borderColor: hexRgb(e.line), borderWidth: lw });
        } else if (e.t === 'shape') {
          const line = isLine(e);
          const sw = (line ? (e.lw || 3) : (e.line ? e.lw || 2 : 0));
          const opt = { x: 0, y: 0, scale: K };
          if (line) {
            pg.drawLine({ start: { x: 0, y: -e.h / 2 * K }, end: { x: e.w * K, y: -e.h / 2 * K }, thickness: sw * K, color: hexRgb(e.line || th.fg), lineCap: 1 });
            if (e.k === 'arrow') pg.drawSvgPath(`M${e.w - 4 * sw} ${e.h / 2 - 2.2 * sw}L${e.w} ${e.h / 2}L${e.w - 4 * sw} ${e.h / 2 + 2.2 * sw}`, { ...opt, borderColor: hexRgb(e.line || th.fg), borderWidth: sw * K });
          } else {
            pg.drawSvgPath(shapePath(e.k, e.w, e.h), { ...opt, color: e.fill ? hexRgb(e.fill) : undefined, borderColor: e.line ? hexRgb(e.line) : undefined, borderWidth: e.line ? sw * K : 0 });
            if (e.html) drawTextBox(pg, e.html, 0, 0, e.w, e.h, e.fs || 20, e.c || '#FFFFFF', 'm', e.pad != null ? e.pad : 10, K);
          }
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
              pg.drawRectangle({ x: xx * K, y: -(yy + rh) * K, width: w * K, height: rh * K, color: head ? hexRgb(th.accent) : undefined, borderColor: hexRgb(e.line || '#868E96'), borderWidth: 0.75 });
              drawTextBox(pg, (head ? '<b>' : '') + (e.rows[ri][ci] || '') + (head ? '</b>' : ''), xx, yy, w, rh, e.fs || 18, head ? '#FFFFFF' : th.fg, 'm', cp, K);
              xx += w;
            }
            yy += rh;
          }
        }
      } finally {
        pg.pushOperators(popGraphicsState());
      }
    }
    return { drawEl };
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
      for (const s of D.deck.slides) {
        const pg = doc.addPage([W * K, H * K]);
        // Ursprung oben links, y nach unten negativ
        pg.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, 1, 0, H * K));
        pg.drawRectangle({ x: 0, y: -H * K, width: W * K, height: H * K, color: hexRgb(s.bg || th.bg) });
        for (const e of s.els) if (!isPh(e)) await P.drawEl(pg, e, K);
        pg.pushOperators(popGraphicsState());
      }
      const bytes = await doc.save();
      const name = (D.deck.title || "Presentation").replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.pdf';
      const blob = new Blob([bytes], { type: 'application/pdf' });
      if (where === 'library') { await C.uploadPdf(blob, name); C.toast(`“${name}” is now in “My PDFs”.`, 5000); }
      else { C.downloadBlob(blob, name); C.toast("PDF saved.", 2500); }
    } catch (err) { C.toast("PDF could not be created: " + err.message, 8000); }
  }

  // kleine Vorschau einer Folie (Bibliothek)
  function preview(s, th, width) {
    const k = width / W;
    const box = document.createElement('div');
    box.style.cssText = `width:${W * k}px;height:${H * k}px;overflow:hidden;position:relative`;
    box.appendChild(slideNode(s || { els: [] }, k, false, th || DEF_TH));
    return box;
  }

  window.PDFSTIFT_DECK = { open, close, flush, preview, makeEditor, layerNode, elNode, painter, popMenu, clean, plain, insertGroup, ICON };
})();
