/* Automatisch erzeugt aus deck.js (tools/i18n) – nicht von Hand ändern. */
/* PDF-Stift – Präsentationen: Folien bauen (Text, Bilder, Formen, Tabellen) und als PDF speichern.
 * Wird erst geladen, wenn eine Präsentation geöffnet wird. Braucht window.PDFSTIFT_CORE (aus app.js). */
(() => {
  'use strict';
  const C = window.PDFSTIFT_CORE;
  const W = 960, H = 540; // Folie in Bildpunkten (16:9); als PDF 720 × 405 pt
  const $ = (q, el = document) => el.querySelector(q);
  const esc = C.esc;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const r1 = (v) => Math.round(v * 10) / 10;
  const uid = () => Math.random().toString(36).slice(2, 10);
  const FONTS = { sans: 'Helvetica, Arial, "Liberation Sans", sans-serif', serif: '"Times New Roman", Times, "Liberation Serif", serif' };
  const COLORS = ['#1A1A1A', '#FFFFFF', '#1E2F6E', '#1F4FD6', '#0091FF', '#1B8A3A', '#B8E62E', '#E8590C', '#D6262B', '#D6409F', '#7048E8', '#868E96'];
  const SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 60, 72];
  const D = { path: '', deck: null, rev: 0, cur: 0, sel: [], edit: null, undo: [], redo: [], saveT: 0, saving: null, dirty: false, root: null, clip: null, drag: null };

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
  const theme = () => D.deck.theme || (D.deck.theme = { bg: '#FFFFFF', fg: '#1A1A1A', accent: '#1E2F6E', font: 'sans' });
  const slide = () => D.deck.slides[D.cur];
  const elById = (id) => slide() && slide().els.find((e) => e.id === id);

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
  function elNode(e, live) {
    const th = theme();
    const n = document.createElement('div');
    n.className = 'dk-el dk-' + e.t;
    n.dataset.id = e.id;
    n.style.cssText = `left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${e.h}px;transform:rotate(${e.r || 0}deg)`;
    if (e.t === 'text') {
      const tx = document.createElement('div');
      tx.className = 'dk-tx va-' + (e.va || 't');
      tx.style.fontSize = (e.fs || 24) + 'px';
      tx.style.color = e.c || th.fg;
      tx.innerHTML = clean(e.html);
      if (e.fill) n.style.background = e.fill;
      if (e.line) n.style.boxShadow = `inset 0 0 0 ${e.lw || 2}px ${e.line}`;
      n.appendChild(tx);
    } else if (e.t === 'img') {
      const im = document.createElement('img');
      im.src = imgUrl(e.src); im.alt = ''; im.draggable = false;
      n.appendChild(im);
    } else if (e.t === 'shape') {
      const sw = e.k === 'line' || e.k === 'arrow' ? Math.max(1, e.lw || 3) : (e.line ? e.lw || 2 : 0);
      const pad = sw / 2;
      const head = e.k === 'arrow' ? `<path d="M${e.w - 4 * sw - pad} ${e.h / 2 - 2.2 * sw}L${e.w - pad} ${e.h / 2}L${e.w - 4 * sw - pad} ${e.h / 2 + 2.2 * sw}" fill="none" stroke="${e.line || th.fg}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>` : '';
      const lineK = e.k === 'line' || e.k === 'arrow';
      n.innerHTML = `<svg viewBox="${-pad} ${-pad} ${e.w + sw} ${e.h + sw}" width="${e.w + sw}" height="${e.h + sw}" style="margin:${-pad}px;width:${e.w + sw}px;height:${e.h + sw}px;max-width:none" preserveAspectRatio="none">` +
        `<path d="${shapePath(e.k, lineK ? e.w - (e.k === 'arrow' ? pad : 0) : e.w, e.h)}" fill="${lineK ? 'none' : e.fill || 'none'}" stroke="${e.line || (lineK ? th.fg : 'none')}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>${head}</svg>`;
      if (e.html && !lineK) {
        const tx = document.createElement('div');
        tx.className = 'dk-tx va-m'; tx.style.fontSize = (e.fs || 20) + 'px'; tx.style.color = e.c || '#FFFFFF';
        tx.innerHTML = clean(e.html);
        n.appendChild(tx);
      }
    } else if (e.t === 'table') {
      const tb = document.createElement('table');
      tb.style.fontSize = (e.fs || 18) + 'px';
      tb.style.setProperty('--bc', e.line || '#868E96');
      const cw = e.cw || e.rows[0].map(() => 1 / e.rows[0].length);
      tb.innerHTML = '<colgroup>' + cw.map((f) => `<col style="width:${f * 100}%">`).join('') + '</colgroup>' +
        e.rows.map((row, ri) => '<tr>' + row.map((cell, ci) => `<td data-r="${ri}" data-c="${ci}" class="${ri === 0 && e.head ? 'head' : ''}" style="${ri === 0 && e.head ? `background:${th.accent};color:#fff` : ''}"><div class="dk-cell">${clean(cell)}</div></td>`).join('') + '</tr>').join('');
      n.appendChild(tb);
    }
    return n;
  }
  function slideNode(s, scale, live) {
    const th = theme();
    const sl = document.createElement('div');
    sl.className = 'dk-slide';
    sl.style.cssText = `width:${W}px;height:${H}px;background:${s.bg || th.bg};font-family:${FONTS[th.font] || FONTS.sans};transform:scale(${scale});transform-origin:0 0`;
    for (const e of s.els) if (live || !isPh(e)) sl.appendChild(elNode(e, false));
    return sl;
  }

  // ------------------------------------------------------------------ Oberfläche
  const ICON = {
    slide: '<path d="M4 5h16v12H4z"/><path d="M12 9v4M10 11h4"/>', text: '<path d="M5 6h14M12 6v13"/>', img: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.5L20 17"/>',
    shape: '<rect x="3.5" y="4" width="9" height="9" rx="1"/><circle cx="15.5" cy="15.5" r="4.5"/>', table: '<rect x="3.5" y="5" width="17" height="14" rx="1"/><path d="M3.5 10h17M3.5 14.5h17M9.5 5v14M15 5v14"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>', redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
    front: '<rect x="8" y="8" width="12" height="12" rx="1" fill="currentColor"/><rect x="4" y="4" width="12" height="12" rx="1"/>', back: '<rect x="4" y="4" width="12" height="12" rx="1" fill="currentColor"/><rect x="8" y="8" width="12" height="12" rx="1"/>',
    dup: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>', del: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
    design: '<circle cx="12" cy="12" r="8"/><circle cx="9" cy="10" r="1.2" fill="currentColor"/><circle cx="14" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="13" r="1.2" fill="currentColor"/>',
    play: '<path d="M7 5l12 7-12 7z"/>', pdf: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 14h6M13 11v6"/>', align: '<path d="M4 4v16M8 8h10M8 16h6"/>',
  };
  const ib = (id, ic, title, label) => `<button type="button" class="dk-b" data-a="${id}" title="${esc(title)}" aria-label="${esc(title)}"><svg viewBox="0 0 24 24">${ic}</svg>${label ? `<span>${esc(label)}</span>` : ''}</button>`;

  function build(root) {
    root.innerHTML = `
      <div class="dk-top">
        <input class="dk-title" aria-label="Name der Präsentation" maxlength="200">
        <span class="dk-sep"></span>
        ${ib('newslide', ICON.slide, "New slide", 'Folie')}${ib('text', ICON.text, "Text box", 'Text')}${ib('img', ICON.img, "Insert image", "image")}${ib('shape', ICON.shape, "Shape", "Shape")}${ib('table', ICON.table, "Table", "Table")}
        <span class="dk-sep"></span>
        ${ib('undo', ICON.undo, "Undo (Ctrl+Z)")}${ib('redo', ICON.redo, "Redo (Ctrl+Y)")}
        ${ib('front', ICON.front, "Bring to front")}${ib('back', ICON.back, "Send to back")}${ib('align', ICON.align, "Align")}${ib('dup', ICON.dup, "Duplicate (Ctrl+D)")}${ib('del', ICON.del, "Delete (Del)")}
        <span class="dk-sep"></span>
        ${ib('design', ICON.design, 'Design', 'Design')}
        <span class="dk-grow"></span>
        <span class="dk-state muted small"></span>
        ${ib('play', ICON.play, "Present (F5)", "Present")}${ib('pdf', ICON.pdf, "Save as PDF", 'PDF')}
      </div>
      <div class="dk-fmt" hidden></div>
      <div class="dk-main">
        <aside class="dk-list" aria-label="Folien"></aside>
        <div class="dk-stage"><div class="dk-box"></div></div>
      </div>
      <input type="file" class="dk-file" accept="image/*" hidden>`;
    root.querySelector('.dk-top').onclick = (ev) => { const b = ev.target.closest('[data-a]'); if (b) act(b.dataset.a, b); };
    const ti = $('.dk-title', root);
    ti.oninput = () => { D.deck.title = ti.value; save(); C.deckTitle(D.path, ti.value); };
    $('.dk-file', root).onchange = async (ev) => { const f = ev.target.files[0]; ev.target.value = ''; if (f) addImage(f); };
    const stage = $('.dk-stage', root);
    new ResizeObserver(() => fit()).observe(stage);
    stage.addEventListener('pointerdown', stageDown);
    stage.addEventListener('dblclick', (e) => { const n = e.target.closest('.dk-el'); if (n) startEdit(n.dataset.id, e); });
  }

  // ------------------------------------------------------------------ Laden, Speichern
  async function open(path, root) {
    close();
    D.root = root; D.path = path; D.sel = []; D.undo = []; D.redo = []; D.edit = null;
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
    endEdit();
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
  function change(fn, keepSel) {
    D.undo.push(snap()); if (D.undo.length > 150) D.undo.shift();
    D.redo = [];
    fn();
    if (!keepSel) D.sel = D.sel.filter((id) => elById(id));
    renderAll();
    save();
  }
  function restore(json) { const o = JSON.parse(json); D.deck.slides = o.slides; D.deck.theme = o.theme; D.cur = Math.min(o.cur, o.slides.length - 1); D.sel = []; renderAll(); save(); }
  function undo() { endEdit(); if (!D.undo.length) return; D.redo.push(snap()); restore(D.undo.pop()); }
  function redo() { endEdit(); if (!D.redo.length) return; D.undo.push(snap()); restore(D.redo.pop()); }

  // ------------------------------------------------------------------ Darstellung
  function renderAll() { if (!D.root) return; renderList(); renderStage(); renderFmt(); }
  function renderList() {
    const list = $('.dk-list', D.root);
    list.innerHTML = '';
    const sc = 150 / W;
    D.deck.slides.forEach((s, i) => {
      const it = document.createElement('div');
      it.className = 'dk-thumb' + (i === D.cur ? ' cur' : '');
      it.draggable = true;
      it.innerHTML = `<span class="dk-no num">${i + 1}</span><div class="dk-mini" style="width:${W * sc}px;height:${H * sc}px"></div>`;
      it.querySelector('.dk-mini').appendChild(slideNode(s, sc));
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
    D.k = k;
    box.style.width = W * k + 'px'; box.style.height = H * k + 'px';
    const sl = $('.dk-slide', box);
    if (sl) sl.style.transform = `scale(${k})`;
  }
  function renderStage() {
    const box = $('.dk-box', D.root);
    const s = slide();
    box.innerHTML = '';
    if (!s) return;
    const sl = slideNode(s, D.k || 1, true);
    sl.classList.add('dk-live');
    for (const n of sl.querySelectorAll('.dk-el')) {
      const e = elById(n.dataset.id);
      if (e && isPh(e)) n.classList.add('dk-ph');
      if (D.sel.includes(n.dataset.id)) n.classList.add('sel');
    }
    box.appendChild(sl);
    fit();
    if (D.sel.length === 1 && !D.edit) handles(sl);
    if (D.edit) { const n = sl.querySelector(`.dk-el[data-id="${D.edit.id}"]`); if (n) reEdit(n); }
  }
  function handles(sl) {
    const e = elById(D.sel[0]);
    if (!e) return;
    const h = document.createElement('div');
    h.className = 'dk-handles';
    h.style.cssText = `left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${e.h}px;transform:rotate(${e.r || 0}deg)`;
    const k = 1 / (D.k || 1);
    const pos = (e.t === 'shape' && (e.k === 'line' || e.k === 'arrow')) ? ['w', 'e'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    h.innerHTML = pos.map((p) => `<i class="dk-h ${p}" data-h="${p}" style="transform:scale(${k})"></i>`).join('') + `<i class="dk-h rot" data-h="rot" style="transform:scale(${k})" title="Drehen"></i>`;
    sl.appendChild(h);
  }
  // beim Ziehen nur die Lage ändern (schnell, Bilder flackern nicht)
  function place(els) {
    const box = $('.dk-box', D.root);
    for (const e of els) {
      const n = box.querySelector(`.dk-el[data-id="${e.id}"]`);
      if (n) n.style.cssText = `left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${e.h}px;transform:rotate(${e.r || 0}deg)`;
      if (n && (e.t === 'shape' || e.t === 'table')) { const nn = elNode(e, true); nn.className = n.className; n.replaceWith(nn); }
    }
    const h = box.querySelector('.dk-handles');
    const e = els[0];
    if (h && e) h.style.cssText = `left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${e.h}px;transform:rotate(${e.r || 0}deg)`;
  }
  function go(i) {
    endEdit();
    D.cur = Math.max(0, Math.min(i, D.deck.slides.length - 1));
    D.sel = [];
    renderAll();
  }

  // ------------------------------------------------------------------ Format-Leiste (je nach Auswahl)
  function renderFmt() {
    const bar = $('.dk-fmt', D.root);
    const els = D.sel.map(elById).filter(Boolean);
    if (!els.length) { bar.hidden = true; bar.innerHTML = ''; return; }
    const e = els[0];
    const sw = (a, c, cur) => `<button type="button" class="dk-sw${cur === c ? ' on' : ''}" data-f="${a}" data-v="${c}" style="--c:${c}" title="${c}"></button>`;
    const none = (a) => `<button type="button" class="dk-sw none" data-f="${a}" data-v="" title="Ohne">∅</button>`;
    let h = '';
    const textish = e.t === 'text' || e.t === 'table' || (e.t === 'shape' && !['line', 'arrow'].includes(e.k));
    if (textish) {
      h += `<select data-f="fs" title="Font size">${SIZES.map((s) => `<option value="${s}"${s === (e.fs || 24) ? ' selected' : ''}>${s}</option>`).join('')}</select>
        <button type="button" class="dk-fb" data-f="bold" title="Fett (Strg+B)"><b>F</b></button><button type="button" class="dk-fb" data-f="italic" title="Kursiv (Strg+I)"><i>K</i></button><button type="button" class="dk-fb" data-f="underline" title="Unterstrichen (Strg+U)"><u>U</u></button>
        <span class="dk-sep"></span>${COLORS.map((c) => `<button type="button" class="dk-sw" data-f="color" data-v="${c}" style="--c:${c}" title="Text colour"></button>`).join('')}
        <span class="dk-sep"></span><button type="button" class="dk-fb" data-f="ul" title="Aufzählung">•≡</button><button type="button" class="dk-fb" data-f="ol" title="Nummerierung">1≡</button>
        <button type="button" class="dk-fb" data-f="al" data-v="left" title="Linksbündig">⇤</button><button type="button" class="dk-fb" data-f="al" data-v="center" title="Zentriert">↔</button><button type="button" class="dk-fb" data-f="al" data-v="right" title="Rechtsbündig">⇥</button>`;
      if (e.t !== 'table') h += `<button type="button" class="dk-fb" data-f="va" data-v="t" title="Oben">⤒</button><button type="button" class="dk-fb" data-f="va" data-v="m" title="Mitte">↕</button><button type="button" class="dk-fb" data-f="va" data-v="b" title="Unten">⤓</button>`;
    }
    if (e.t === 'shape' || e.t === 'text') {
      if (!(e.t === 'shape' && ['line', 'arrow'].includes(e.k))) h += `<span class="dk-sep"></span><span class="dk-lbl">Fill</span>${none('fill')}${COLORS.map((c) => sw('fill', c, e.fill)).join('')}`;
      h += `<span class="dk-sep"></span><span class="dk-lbl">Line</span>${none('line')}${COLORS.slice(0, 10).map((c) => sw('line', c, e.line)).join('')}<select data-f="lw" title="Line width">${[1, 2, 3, 4, 6, 8, 12].map((v) => `<option value="${v}"${v === (e.lw || (e.t === 'shape' && ['line', 'arrow'].includes(e.k) ? 3 : 2)) ? ' selected' : ''}>${v} pt</option>`).join('')}</select>`;
    }
    if (e.t === 'table') {
      h += `<span class="dk-sep"></span><button type="button" class="dk-fb wide" data-f="row+">+ Zeile</button><button type="button" class="dk-fb wide" data-f="row-">− Zeile</button><button type="button" class="dk-fb wide" data-f="col+">+ Spalte</button><button type="button" class="dk-fb wide" data-f="col-">− Spalte</button><button type="button" class="dk-fb wide${e.head ? ' on' : ''}" data-f="head">Header row</button>`;
      h += `<span class="dk-lbl">Lines</span>${COLORS.slice(0, 10).map((c) => sw('line', c, e.line)).join('')}`;
    }
    if (e.t === 'img') h += `<span class="dk-lbl">Image:</span><button type="button" class="dk-fb wide" data-f="imgreset">Original proportions</button><span class="dk-lbl">Border</span>${none('line')}${COLORS.slice(0, 10).map((c) => sw('line', c, e.line)).join('')}`;
    bar.innerHTML = h;
    bar.hidden = false;
    bar.onmousedown = (ev) => { if (!ev.target.closest('select')) ev.preventDefault(); }; // Auswahl im Text bleibt erhalten
    bar.onclick = (ev) => { const b = ev.target.closest('[data-f]'); if (b && b.tagName !== 'SELECT') fmt(b.dataset.f, b.dataset.v); };
    bar.onchange = (ev) => { const s = ev.target.closest('select[data-f]'); if (s) fmt(s.dataset.f, s.value); };
  }
  // Format anwenden: im Bearbeiten auf die Markierung, sonst aufs ganze Element
  function fmt(f, v) {
    const ids = D.sel.slice();
    const inline = ['bold', 'italic', 'underline', 'color', 'ul', 'ol', 'al'];
    if (inline.includes(f)) {
      if (D.edit) { execFmt(f, v); return; }
      // ganzes Feld: kurz alles markieren, anwenden, fertig
      change(() => {
        for (const id of ids) {
          const e = elById(id);
          if (!e) continue;
          const tmp = document.createElement('div');
          tmp.contentEditable = 'true'; tmp.style.cssText = 'position:fixed;left:-9999px;top:0';
          document.body.appendChild(tmp);
          if (e.t === 'table') {
            e.rows = e.rows.map((row) => row.map((cell) => { tmp.innerHTML = clean(cell) || '&#8203;'; selAll(tmp); execFmt(f, v); return clean(tmp.innerHTML.replace(/​/g, '')); }));
          } else if (e.html !== undefined || e.t === 'shape') {
            tmp.innerHTML = clean(e.html || '') || '&#8203;'; selAll(tmp); execFmt(f, v); e.html = clean(tmp.innerHTML.replace(/​/g, ''));
          }
          tmp.remove();
        }
      }, true);
      return;
    }
    if (f === 'fs') { change(() => ids.forEach((id) => { const e = elById(id); if (e) e.fs = +v; }), true); return; }
    if (f === 'va') { change(() => ids.forEach((id) => { const e = elById(id); if (e) e.va = v; }), true); return; }
    if (f === 'fill') { change(() => ids.forEach((id) => { const e = elById(id); if (e) { if (v) e.fill = v; else delete e.fill; } }), true); return; }
    if (f === 'line') { change(() => ids.forEach((id) => { const e = elById(id); if (e) { if (v) e.line = v; else delete e.line; } }), true); return; }
    if (f === 'lw') { change(() => ids.forEach((id) => { const e = elById(id); if (e) e.lw = +v; }), true); return; }
    const e = elById(ids[0]);
    if (!e) return;
    if (f === 'imgreset' && e.t === 'img') { change(() => { const a = (e.iw || e.w) / (e.ih || e.h); e.h = e.w / a; }, true); return; }
    if (e.t === 'table') {
      const cols = e.rows[0].length;
      const cell = D.edit && D.edit.cell;
      const ri = cell ? cell[0] : e.rows.length - 1, ci = cell ? cell[1] : cols - 1;
      endEdit();
      change(() => {
        if (f === 'row+') { e.rows.splice(ri + 1, 0, Array(cols).fill('')); e.h += e.h / (e.rows.length - 1); }
        if (f === 'row-' && e.rows.length > 1) { e.h -= e.h / e.rows.length; e.rows.splice(ri, 1); }
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
    else if (f === 'al') document.execCommand(v === 'center' ? 'justifyCenter' : v === 'right' ? 'justifyRight' : 'justifyLeft');
  }

  // ------------------------------------------------------------------ Bearbeiten von Text (wie in PowerPoint: Feld anklicken, dann tippen)
  function startEdit(id, ev) {
    const e = elById(id);
    if (!e || e.t === 'img' || (e.t === 'shape' && ['line', 'arrow'].includes(e.k))) return;
    if (D.edit && D.edit.id === id) return;
    endEdit();
    D.undo.push(snap()); D.redo = [];
    D.sel = [id];
    D.edit = { id, before: JSON.stringify(e), cell: null };
    if (e.t === 'table' && ev) { const td = ev.target.closest && ev.target.closest('td'); if (td) D.edit.cell = [+td.dataset.r, +td.dataset.c]; }
    if (e.t === 'shape' && !e.html) e.html = '<div style="text-align: center;"></div>';
    renderStage(); renderFmt();
    const n = $(`.dk-box .dk-el[data-id="${id}"]`, D.root);
    if (!n) return;
    const tgt = e.t === 'table' ? n.querySelector(`td[data-r="${D.edit.cell ? D.edit.cell[0] : 0}"][data-c="${D.edit.cell ? D.edit.cell[1] : 0}"] .dk-cell`) : n.querySelector('.dk-tx');
    if (!tgt) return;
    // Platzhaltertext beim ersten Klick ganz markieren, sonst Schreibmarke an die Klickstelle
    if (n.classList.contains('dk-ph') || !ev) selAll(tgt);
    else if (ev && document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(ev.clientX, ev.clientY); tgt.focus(); if (r && tgt.contains(r.startContainer)) { const s = getSelection(); s.removeAllRanges(); s.addRange(r); } }
    else tgt.focus();
  }
  function reEdit(n) {
    const e = elById(D.edit.id);
    n.classList.add('editing', 'sel');
    if (e.t === 'table') {
      n.querySelectorAll('.dk-cell').forEach((c) => {
        c.contentEditable = 'true';
        c.addEventListener('focus', () => { const td = c.closest('td'); D.edit.cell = [+td.dataset.r, +td.dataset.c]; });
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
    const e = elById(D.edit && D.edit.id);
    if (!e) return;
    if (e.t === 'table') e.rows = e.rows.map((row, ri) => row.map((cell, ci) => { const c = n.querySelector(`td[data-r="${ri}"][data-c="${ci}"] .dk-cell`); return c ? clean(c.innerHTML) : cell; }));
    else e.html = clean(n.querySelector('.dk-tx').innerHTML);
    // Text wächst nach unten mit (wie in PowerPoint)
    const need = (e.t === 'table' ? n.querySelector('table') : n.querySelector('.dk-tx')).scrollHeight;
    if (need > e.h + 1 && e.t !== 'shape') { e.h = Math.min(H * 2, need); n.style.height = e.h + 'px'; }
    save();
    clearTimeout(D.thumbT); D.thumbT = setTimeout(renderList, 500);
  }
  function endEdit() {
    if (!D.edit) return;
    const ed = D.edit;
    D.edit = null;
    const e = elById(ed.id);
    if (e) {
      if (e.t !== 'table' && !String(e.html || '').replace(/<[^>]+>/g, '').trim() && e.t === 'text' && !e.fill && !e.line) {
        slide().els = slide().els.filter((x) => x.id !== e.id); // leeres Textfeld verschwindet
        D.sel = [];
      } else if (e.t === 'shape' && !String(e.html || '').replace(/<[^>]+>/g, '').trim()) delete e.html;
      if (e && e.ph && JSON.stringify(e) !== ed.before) delete e.ph;
    }
    if (e && JSON.stringify(e) === ed.before) D.undo.pop(); // nichts geändert
    getSelection().removeAllRanges();
    if (D.root) { renderAll(); save(); }
  }

  // ------------------------------------------------------------------ Maus und Stift auf der Folie
  const toSlide = (ev) => { const r = $('.dk-box', D.root).getBoundingClientRect(); return [(ev.clientX - r.left) / D.k, (ev.clientY - r.top) / D.k]; };
  function stageDown(ev) {
    if (ev.button > 0) return;
    if (D.insert && ev.target.closest('.dk-box')) { endEdit(); insertAt(D.insert, ...toSlide(ev)); D.insert = null; D.root.classList.remove('dk-placing'); return; }
    const hEl = ev.target.closest('.dk-h');
    const n = ev.target.closest('.dk-el');
    if (D.edit && n && n.dataset.id === D.edit.id) return; // im Text: Schreibmarke setzen, markieren
    if (hEl) { startDrag(ev, hEl.dataset.h); return; }
    if (!n) {
      endEdit();
      if (D.sel.length) { D.sel = []; renderStage(); renderFmt(); }
      if (D.insert) { insertAt(D.insert, ...toSlide(ev)); D.insert = null; D.root.classList.remove('dk-placing'); }
      return;
    }
    ev.preventDefault();
    const id = n.dataset.id;
    const wasSel = D.sel.includes(id) && D.sel.length === 1;
    if (D.edit) endEdit();
    if (ev.shiftKey || ev.ctrlKey) { D.sel = D.sel.includes(id) ? D.sel.filter((x) => x !== id) : [...D.sel, id]; renderStage(); renderFmt(); return; }
    if (!D.sel.includes(id)) D.sel = [id];
    renderStage(); renderFmt();
    startDrag(ev, 'move', wasSel ? id : null);
  }
  function startDrag(ev, mode, clickEdit) {
    const els = D.sel.map(elById).filter(Boolean);
    if (!els.length) return;
    const [sx, sy] = toSlide(ev);
    const before = snap();
    const orig = els.map((e) => ({ x: e.x, y: e.y, w: e.w, h: e.h, r: e.r || 0 }));
    let moved = false;
    const pid = ev.pointerId;
    const tgt = $('.dk-stage', D.root);
    try { tgt.setPointerCapture(pid); } catch (e) { /* */ }
    const mv = (m) => {
      if (m.pointerId !== pid) return;
      const [x, y] = toSlide(m);
      let dx = x - sx, dy = y - sy;
      if (!moved && Math.hypot(dx, dy) * D.k < 3) return;
      moved = true;
      if (mode === 'move') {
        // an der Folienmitte und an den Rändern einrasten
        const e0 = els[0], o0 = orig[0];
        if (!m.altKey) {
          const cx = o0.x + dx + o0.w / 2, cy = o0.y + dy + o0.h / 2, sn = 6 / D.k;
          if (Math.abs(cx - W / 2) < sn) dx = W / 2 - o0.w / 2 - o0.x;
          if (Math.abs(cy - H / 2) < sn) dy = H / 2 - o0.h / 2 - o0.y;
        }
        els.forEach((e, i) => { e.x = r1(orig[i].x + dx); e.y = r1(orig[i].y + dy); });
        void e0;
      } else if (mode === 'rot') {
        const e = els[0], o = orig[0];
        const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        let a = Math.atan2(y - cy, x - cx) * 180 / Math.PI + 90;
        if (!m.shiftKey) { const s = Math.round(a / 15) * 15; if (Math.abs(a - s) < 4) a = s; }
        e.r = Math.round(((a % 360) + 360) % 360);
      } else {
        const e = els[0], o = orig[0];
        // im gedrehten Element rechnen
        const rad = (o.r || 0) * Math.PI / 180, cs = Math.cos(rad), sn = Math.sin(rad);
        const lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
        let { x: nx, y: ny, w: nw, h: nh } = o;
        if (mode.includes('e')) nw = o.w + lx;
        if (mode.includes('s')) nh = o.h + ly;
        if (mode.includes('w')) nw = o.w - lx;
        if (mode.includes('n')) nh = o.h - ly;
        const keep = (e.t === 'img' && !m.shiftKey) || (e.t !== 'img' && m.shiftKey && mode.length === 2);
        if (keep && mode.length === 2) { const a = o.w / o.h; if (nw / nh > a) nw = nh * a; else nh = nw / a; }
        nw = Math.max(8, nw); nh = Math.max(e.t === 'shape' && ['line', 'arrow'].includes(e.k) ? 4 : 8, nh);
        // feste Gegenecke: Position so verschieben, dass sie stehen bleibt
        const ax = mode.includes('w') ? o.w - nw : 0, ay = mode.includes('n') ? o.h - nh : 0;
        const cx0 = o.w / 2, cy0 = o.h / 2, cx1 = ax + nw / 2, cy1 = ay + nh / 2;
        const ddx = cx1 - cx0, ddy = cy1 - cy0;
        const gx = ddx * cs - ddy * sn, gy = ddx * sn + ddy * cs;
        nx = o.x + o.w / 2 + gx - nw / 2; ny = o.y + o.h / 2 + gy - nh / 2;
        Object.assign(e, { x: r1(nx), y: r1(ny), w: r1(nw), h: r1(nh) });
      }
      place(els);
    };
    const up = (u) => {
      if (u.pointerId !== pid) return;
      tgt.removeEventListener('pointermove', mv); tgt.removeEventListener('pointerup', up); tgt.removeEventListener('pointercancel', up);
      if (moved) { D.undo.push(before); D.redo = []; renderAll(); save(); }
      else if (clickEdit && mode === 'move') startEdit(clickEdit, u);
    };
    tgt.addEventListener('pointermove', mv); tgt.addEventListener('pointerup', up); tgt.addEventListener('pointercancel', up);
  }

  // ------------------------------------------------------------------ Einfügen
  function insertAt(kind, x, y) {
    const base = { id: uid(), r: 0 };
    let e;
    if (kind === 'text') e = { ...base, t: 'text', x: x - 10, y: y - 20, w: 360, h: 50, fs: 24, html: '' };
    else if (kind.startsWith('shape:')) {
      const k = kind.slice(6);
      const line = k === 'line' || k === 'arrow';
      e = { ...base, t: 'shape', k, x: x - (line ? 0 : 90), y: y - (line ? 10 : 60), w: line ? 220 : 180, h: line ? 20 : 120, fill: line ? undefined : theme().accent, lw: line ? 3 : 2 };
      if (line) e.line = theme().fg;
    }
    if (!e) return;
    e.x = r1(Math.max(0, e.x)); e.y = r1(Math.max(0, e.y));
    change(() => { slide().els.push(e); D.sel = [e.id]; }, true);
    if (e.t === 'text') startEdit(e.id, null);
  }
  async function addImage(file) {
    try {
      C.toast("Inserting image …", 20000);
      const f = await C.prepareImage(file);
      const res = await C.uploadImage(f);
      const iw = res.w || 800, ih = res.h || 600;
      let w = Math.min(560, iw), h = w * ih / iw;
      if (h > 400) { h = 400; w = h * iw / ih; }
      const e = { id: uid(), r: 0, t: 'img', src: res.src, iw, ih, x: (W - w) / 2, y: (H - h) / 2 + 20, w: r1(w), h: r1(h) };
      change(() => { slide().els.push(e); D.sel = [e.id]; }, true);
      C.toast("Image inserted.", 1500);
    } catch (err) { C.toast(err.message); }
  }
  async function addTable() {
    const ask = await C.askText("Insert table", "Rows × columns, e.g. 3 × 4", '3 × 3', "Insert");
    if (!ask) return;
    const m = ask.match(/(\d+)\D+(\d+)/);
    const rows = Math.max(1, Math.min(30, m ? +m[1] : 3)), cols = Math.max(1, Math.min(12, m ? +m[2] : 3));
    const w = Math.min(860, cols * 180), h = rows * 44;
    const e = { id: uid(), r: 0, t: 'table', x: (W - w) / 2, y: Math.max(120, (H - h) / 2), w, h, fs: 18, head: true, rows: Array.from({ length: rows }, () => Array(cols).fill('')), cw: Array(cols).fill(1 / cols) };
    change(() => { slide().els.push(e); D.sel = [e.id]; }, true);
  }
  function onPaste(ev) {
    if (!D.root || D.edit || ev.target.closest('input, textarea, [contenteditable="true"]')) return;
    const items = [...(ev.clipboardData ? ev.clipboardData.items : [])];
    const img = items.find((i) => i.type.startsWith('image/'));
    if (img) { ev.preventDefault(); addImage(img.getAsFile()); return; }
    if (D.clip) { ev.preventDefault(); pasteEls(); }
  }
  function pasteEls() {
    if (!D.clip) return;
    const neu = D.clip.map((e) => ({ ...clone(e), id: uid(), x: e.x + 20, y: e.y + 20 }));
    D.clip = neu.map(clone);
    change(() => { slide().els.push(...neu); D.sel = neu.map((e) => e.id); }, true);
  }

  // ------------------------------------------------------------------ Menüs
  function popMenu(x, y, items) {
    document.querySelectorAll('.dk-menu').forEach((m) => m.remove());
    const m = document.createElement('div');
    m.className = 'menu dk-menu';
    m.style.cssText = `position:fixed;left:${Math.min(x, innerWidth - 240)}px;top:${Math.min(y, innerHeight - items.length * 36 - 10)}px;z-index:60`;
    m.innerHTML = items.map(([a, l]) => (a === '-' ? '<span class="menu-sep"></span>' : `<button type="button" data-a="${a}">${l}</button>`)).join('');
    m.onclick = (ev) => { const b = ev.target.closest('[data-a]'); if (!b) return; m.remove(); const it = items.find((i) => i[0] === b.dataset.a); if (it && it[2]) it[2](); };
    document.body.appendChild(m);
    setTimeout(() => document.addEventListener('pointerdown', function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } }, true), 0);
  }
  function layoutMenu(x, y) {
    popMenu(x, y, Object.entries(LAYOUTS).map(([k, l]) => [k, esc(l.name), () => change(() => { D.deck.slides.splice(D.cur + 1, 0, newSlide(k)); D.cur++; D.sel = []; })]));
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
  function alignMenu(x, y) {
    const al = (fn) => () => change(() => D.sel.map(elById).filter(Boolean).forEach(fn), true);
    popMenu(x, y, [
      ['l', "Left of slide", al((e) => { e.x = 40; })], ['c', "Centre horizontally", al((e) => { e.x = r1((W - e.w) / 2); })], ['r', "Right of slide", al((e) => { e.x = W - 40 - e.w; })],
      ['-', ''],
      ['t', "Top of slide", al((e) => { e.y = 30; })], ['m', "Centre vertically", al((e) => { e.y = r1((H - e.h) / 2); })], ['b', "Bottom of slide", al((e) => { e.y = H - 30 - e.h; })],
    ]);
  }
  function shapeMenu(x, y) {
    const k = [['rect', "Rectangle"], ['round', "Rounded rectangle"], ['ellipse', "Circle / ellipse"], ['tri', "Triangle"], ['arrowR', "Block arrow"], ['line', "Line"], ['arrow', "Arrow"]];
    popMenu(x, y, k.map(([id, l]) => [id, l, () => { D.insert = 'shape:' + id; D.root.classList.add('dk-placing'); C.toast("Click on the slide where the shape should go (Esc = cancel).", 4000); }]));
  }

  // ------------------------------------------------------------------ Knöpfe und Tasten
  function act(a, b) {
    const r = b ? b.getBoundingClientRect() : { left: 200, bottom: 120 };
    if (a === 'newslide') { layoutMenu(r.left, r.bottom + 4); return; }
    if (a === 'text') { endEdit(); D.insert = 'text'; D.root.classList.add('dk-placing'); C.toast("Click on the slide where the text should go.", 3000); return; }
    if (a === 'img') { $('.dk-file', D.root).click(); return; }
    if (a === 'shape') { shapeMenu(r.left, r.bottom + 4); return; }
    if (a === 'table') { addTable(); return; }
    if (a === 'undo') { undo(); return; }
    if (a === 'redo') { redo(); return; }
    if (a === 'design') { designMenu(r.left, r.bottom + 4); return; }
    if (a === 'play') { present(); return; }
    if (a === 'pdf') { popMenu(r.left - 120, r.bottom + 4, [['dl', "Download PDF", () => exportPdf('download')], ['lib', "Put PDF into “My PDFs” (to write on)", () => exportPdf('library')]]); return; }
    if (!D.sel.length) { C.toast("Please click something on the slide first."); return; }
    if (a === 'align') { alignMenu(r.left, r.bottom + 4); return; }
    endEdit();
    if (a === 'del') change(() => { slide().els = slide().els.filter((e) => !D.sel.includes(e.id)); D.sel = []; });
    if (a === 'dup') { D.clip = D.sel.map(elById).filter(Boolean).map(clone); pasteEls(); }
    if (a === 'front' || a === 'back') change(() => { const s = slide(); const pick = s.els.filter((e) => D.sel.includes(e.id)); const rest = s.els.filter((e) => !D.sel.includes(e.id)); s.els = a === 'front' ? [...rest, ...pick] : [...pick, ...rest]; }, true);
  }
  function keys(ev) {
    if (!D.root || D.root.hidden || document.querySelector('dialog[open]') || D.show) return;
    const inField = ev.target.closest && ev.target.closest('input, textarea, select');
    const mod = ev.ctrlKey || ev.metaKey;
    if (D.edit) {
      if (ev.key === 'Escape') { ev.preventDefault(); const id = D.edit.id; endEdit(); D.sel = [id]; renderStage(); renderFmt(); }
      else if (mod && ev.key.toLowerCase() === 'z') { ev.preventDefault(); undo(); }
      return; // sonst gehört die Taste dem Text
    }
    if (inField) return;
    const k = ev.key;
    if (k === 'Escape') { D.insert = null; D.root.classList.remove('dk-placing'); D.sel = []; renderStage(); renderFmt(); return; }
    if (k === 'F5') { ev.preventDefault(); present(); return; }
    if (mod && k.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
    if (mod && k.toLowerCase() === 'y') { ev.preventDefault(); redo(); return; }
    if (mod && k.toLowerCase() === 'd') { ev.preventDefault(); act('dup'); return; }
    if (mod && k.toLowerCase() === 'c' && D.sel.length) { D.clip = D.sel.map(elById).filter(Boolean).map(clone); return; }
    if (mod && k.toLowerCase() === 'a') { ev.preventDefault(); D.sel = slide().els.map((e) => e.id); renderStage(); renderFmt(); return; }
    if ((k === 'Delete' || k === 'Backspace') && D.sel.length) { ev.preventDefault(); act('del'); return; }
    if ((k === 'Enter' || k === 'F2') && D.sel.length === 1) { ev.preventDefault(); startEdit(D.sel[0], null); return; }
    if (k.startsWith('Arrow') && D.sel.length) {
      ev.preventDefault();
      const s = ev.shiftKey ? 10 : 1;
      const dx = k === 'ArrowLeft' ? -s : k === 'ArrowRight' ? s : 0, dy = k === 'ArrowUp' ? -s : k === 'ArrowDown' ? s : 0;
      change(() => D.sel.map(elById).filter(Boolean).forEach((e) => { e.x += dx; e.y += dy; }), true);
      return;
    }
    if ((k === 'PageDown' || (k === 'ArrowDown' && !D.sel.length)) && D.cur < D.deck.slides.length - 1) { ev.preventDefault(); go(D.cur + 1); return; }
    if ((k === 'PageUp' || (k === 'ArrowUp' && !D.sel.length)) && D.cur > 0) { ev.preventDefault(); go(D.cur - 1); }
  }

  // ------------------------------------------------------------------ Vortragen (einfach; Notizen und Referentenansicht folgen)
  function present() {
    endEdit(); flush();
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
      wrap.appendChild(slideNode(D.deck.slides[i], k));
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

  // ------------------------------------------------------------------ Als PDF: echte Schrift (durchsuchbar), Formen als Vektoren
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
  async function exportPdf(where) {
    endEdit(); await flush();
    C.toast("Creating PDF …", 60000);
    try {
      const { PDFDocument, StandardFonts, pushGraphicsState, popGraphicsState, concatTransformationMatrix, rgb } = PDFLib;
      const doc = await PDFDocument.create();
      doc.setTitle(D.deck.title || "Presentation");
      doc.setCreator('PDF-Stift');
      const th = theme();
      const serif = th.font === 'serif';
      const F = {
        r: await doc.embedFont(serif ? StandardFonts.TimesRoman : StandardFonts.Helvetica),
        b: await doc.embedFont(serif ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold),
        i: await doc.embedFont(serif ? StandardFonts.TimesRomanItalic : StandardFonts.HelveticaOblique),
        bi: await doc.embedFont(serif ? StandardFonts.TimesRomanBoldItalic : StandardFonts.HelveticaBoldOblique),
      };
      let uni = null; // DejaVu für Zeichen außerhalb von WinAnsi (z. B. Pfeile, griechische Buchstaben)
      const uniFont = async (bold) => {
        if (!uni) {
          await C.ensureFontkit();
          doc.registerFontkit(window.fontkit);
          const get = async (n) => new Uint8Array(await (await fetch('vendor/fonts/' + n + '?v=' + C.VERSION)).arrayBuffer());
          uni = { r: await doc.embedFont(await get('DejaVuSans.ttf'), { subset: true }), b: await doc.embedFont(await get('DejaVuSans-Bold.ttf'), { subset: true }) };
        }
        return bold ? uni.b : uni.r;
      };
      const needUni = D.deck.slides.some((s) => s.els.some((e) => [e.html || '', ...(e.rows || []).flat()].join('').replace(/<[^>]+>/g, '').split('').some((ch) => !winOk(ch) && ch !== '\n')));
      if (needUni) { await uniFont(false); await uniFont(true); }
      const fontOf = (r) => F[(r.b ? 'b' : '') + (r.i ? 'i' : '') || 'r'] || F.r;
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
      const K = 0.75; // Bildpunkt → pt
      // Text in ein Rechteck setzen (w, h in Bildpunkten, Ursprung oben links im lokalen System)
      const layoutText = (ps, fs, w) => {
        const lines = [];
        for (const p of ps) {
          const ind = p.list ? fs * 1.2 * p.lvl : 0;
          const maxW = Math.max(10, w - ind);
          // Wörter mit Schrift
          const toks = [];
          for (const r of p.runs) for (const part of r.t.split(/(\s+)/)) if (part) toks.push({ ...r, t: part });
          let line = [], lw = 0;
          const push = (last) => { lines.push({ toks: line, w: lw, al: p.al, ind, bullet: line.length || !p.runs.length ? (lines.some((l) => l.p === p) ? null : p) : null, p, last, fs }); line = []; lw = 0; };
          const width = (tok) => { let s = 0; for (const ch of tok.t) { const f = winOk(ch) ? fontOf(tok) : (uni ? (tok.b ? uni.b : uni.r) : fontOf(tok)); try { s += f.widthOfTextAtSize(ch, fs); } catch (e) { s += fs * 0.5; } } return s; };
          for (const tk of toks) {
            const tw = width(tk);
            if (lw + tw > maxW && line.length && tk.t.trim()) { while (line.length && !line[line.length - 1].t.trim()) { lw -= width(line.pop()); } push(false); }
            if (!line.length && !tk.t.trim()) continue;
            line.push(tk); lw += tw;
          }
          push(true);
        }
        return lines;
      };
      const drawRuns = (pg, ln, x0, yTop, fs, color) => {
        // Grundlinie etwa 0,8 × Schriftgröße unter der Zeilenoberkante
        let x = x0;
        const base = yTop + fs * 0.92;
        for (const tk of ln.toks) {
          // Abschnitte gleicher Schrift
          let seg = '', segF = null;
          const flush2 = () => {
            if (!seg) return;
            pg.drawText(seg, { x: x * K, y: -base * K, size: fs * K, font: segF, color: hexRgb(tk.c || color) });
            const w = segF.widthOfTextAtSize(seg, fs);
            if (tk.u) pg.drawLine({ start: { x: x * K, y: -(base + fs * 0.12) * K }, end: { x: (x + w) * K, y: -(base + fs * 0.12) * K }, thickness: Math.max(0.5, fs * 0.06 * K), color: hexRgb(tk.c || color) });
            x += w; seg = '';
          };
          for (const ch of tk.t) {
            const f = winOk(ch) ? fontOf(tk) : (uni ? (tk.b ? uni.b : uni.r) : null);
            if (!f) continue;
            if (f !== segF) { flush2(); segF = f; }
            seg += ch;
          }
          flush2();
        }
      };
      const drawTextBox = (pg, html, e, x, y, w, h, fs, color, va, pad) => {
        const ps = paras(html, color);
        const lines = layoutText(ps, fs, w - 2 * pad);
        const lh = fs * 1.2;
        const total = lines.reduce((a, l) => a + lh + (l.last ? fs * 0.3 : 0), 0) - (lines.length ? fs * 0.3 : 0);
        let yy = y + pad + (va === 'm' ? Math.max(0, (h - 2 * pad - total) / 2) : va === 'b' ? Math.max(0, h - 2 * pad - total) : 0);
        for (const ln of lines) {
          const avail = w - 2 * pad - ln.ind;
          const lx = x + pad + ln.ind + (ln.al === 'center' ? (avail - ln.w) / 2 : ln.al === 'right' ? avail - ln.w : 0);
          if (ln.bullet && ln.bullet.list) {
            const mark = ln.bullet.list === 'ol' ? ln.bullet.num + '.' : '•';
            const bf = F.r;
            pg.drawText(mark, { x: (x + pad + ln.ind - fs * (ln.bullet.list === 'ol' ? 1.1 : 0.8)) * K, y: -(yy + fs * 0.92) * K, size: fs * K, font: bf, color: hexRgb(color) });
          }
          drawRuns(pg, ln, lx, yy, fs, color);
          yy += lh + (ln.last ? fs * 0.3 : 0);
        }
      };
      for (const s of D.deck.slides) {
        const pg = doc.addPage([W * K, H * K]);
        // Ursprung oben links, y nach unten negativ
        pg.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, 1, 0, H * K));
        pg.drawRectangle({ x: 0, y: -H * K, width: W * K, height: H * K, color: hexRgb(s.bg || th.bg) });
        for (const e of s.els) {
          if (isPh(e)) continue;
          const cx = (e.x + e.w / 2) * K, cy = -(e.y + e.h / 2) * K;
          const a = -(e.r || 0) * Math.PI / 180;
          pg.pushOperators(pushGraphicsState(), concatTransformationMatrix(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), cx, cy), concatTransformationMatrix(1, 0, 0, 1, -e.w / 2 * K, e.h / 2 * K));
          // jetzt: lokaler Ursprung oben links am Element
          const lw = (e.lw || 2) * K;
          if (e.t === 'text') {
            if (e.fill || e.line) pg.drawRectangle({ x: 0, y: -e.h * K, width: e.w * K, height: e.h * K, color: e.fill ? hexRgb(e.fill) : undefined, borderColor: e.line ? hexRgb(e.line) : undefined, borderWidth: e.line ? lw : 0 });
            drawTextBox(pg, e.html || '', e, 0, 0, e.w, e.h, e.fs || 24, e.c || th.fg, e.va || 't', 8);
          } else if (e.t === 'img') {
            try { const im = await getImg(e.src); pg.drawImage(im, { x: 0, y: -e.h * K, width: e.w * K, height: e.h * K }); } catch (err) { /* Bild fehlt */ }
            if (e.line) pg.drawRectangle({ x: 0, y: -e.h * K, width: e.w * K, height: e.h * K, borderColor: hexRgb(e.line), borderWidth: lw });
          } else if (e.t === 'shape') {
            const line = e.k === 'line' || e.k === 'arrow';
            const sw = (line ? (e.lw || 3) : (e.line ? e.lw || 2 : 0));
            const opt = { x: 0, y: 0, scale: K };
            if (line) {
              pg.drawLine({ start: { x: 0, y: -e.h / 2 * K }, end: { x: e.w * K, y: -e.h / 2 * K }, thickness: sw * K, color: hexRgb(e.line || th.fg), lineCap: 1 });
              if (e.k === 'arrow') pg.drawSvgPath(`M${e.w - 4 * sw} ${e.h / 2 - 2.2 * sw}L${e.w} ${e.h / 2}L${e.w - 4 * sw} ${e.h / 2 + 2.2 * sw}`, { ...opt, borderColor: hexRgb(e.line || th.fg), borderWidth: sw * K });
            } else {
              pg.drawSvgPath(shapePath(e.k, e.w, e.h), { ...opt, color: e.fill ? hexRgb(e.fill) : undefined, borderColor: e.line ? hexRgb(e.line) : undefined, borderWidth: e.line ? sw * K : 0 });
              if (e.html) drawTextBox(pg, e.html, e, 0, 0, e.w, e.h, e.fs || 20, e.c || '#FFFFFF', 'm', 10);
            }
          } else if (e.t === 'table') {
            const rows = e.rows.length, cols = e.rows[0].length;
            const cw = e.cw || Array(cols).fill(1 / cols);
            const rh = e.h / rows;
            let yy = 0;
            for (let ri = 0; ri < rows; ri++) {
              let xx = 0;
              for (let ci = 0; ci < cols; ci++) {
                const w = e.w * cw[ci];
                const head = ri === 0 && e.head;
                pg.drawRectangle({ x: xx * K, y: -(yy + rh) * K, width: w * K, height: rh * K, color: head ? hexRgb(th.accent) : undefined, borderColor: hexRgb(e.line || '#868E96'), borderWidth: 0.75 });
                drawTextBox(pg, e.rows[ri][ci] || '', e, xx, yy, w, rh, e.fs || 18, head ? '#FFFFFF' : th.fg, 'm', 6);
                xx += w;
              }
              yy += rh;
            }
          }
          pg.pushOperators(popGraphicsState());
        }
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
    const old = D.deck;
    D.deck = D.deck || { theme: th };
    const sav = D.deck.theme; D.deck.theme = th || sav;
    const k = width / W;
    const box = document.createElement('div');
    box.style.cssText = `width:${W * k}px;height:${H * k}px;overflow:hidden;position:relative`;
    box.appendChild(slideNode(s || { els: [] }, k));
    D.deck.theme = sav;
    if (!old) D.deck = null;
    return box;
  }

  window.PDFSTIFT_DECK = { open, close, flush, preview };
})();
