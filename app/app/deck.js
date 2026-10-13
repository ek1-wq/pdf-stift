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
  const FONTS = { sans: 'Helvetica, Arial, "Liberation Sans", sans-serif', serif: '"Times New Roman", Times, "Liberation Serif", serif' };
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
      h.innerHTML = ps.map((p) => `<i class="dk-h ${p}" data-h="${p}" style="transform:scale(${k})"></i>`).join('') + `<i class="dk-h rot" data-h="rot" style="transform:scale(${k});top:${-28 * k}px" title="Drehen"></i>`;
      sl.appendChild(h);
    }
    // beim Ziehen nur die Lage ändern (schnell, Bilder flackern nicht)
    function place(list) {
      const box = host.box();
      if (!box) return;
      for (const e of list) {
        const n = box.querySelector(`.dk-el[data-id="${e.id}"]`);
        if (n) n.style.cssText = pos(e);
        if (n && (e.t === 'shape' || e.t === 'table')) { const nn = elNode(e, host.theme()); nn.className = n.className; n.replaceWith(nn); }
      }
      const h = box.querySelector('.dk-handles');
      if (h && list[0]) h.style.cssText = pos(list[0]);
    }

    // ---------------------------------------------------------------- Format-Leiste (je nach Auswahl)
    function renderFmt() {
      const bar = host.fmtBar();
      if (!bar) return;
      const list = ED.sel.map(byId).filter(Boolean);
      if (!list.length) { bar.hidden = true; bar.innerHTML = ''; if (host.fmtShown) host.fmtShown(false); return; }
      const e = list[0];
      const sw = (a, c, cur) => `<button type="button" class="dk-sw${cur === c ? ' on' : ''}" data-f="${a}" data-v="${c}" style="--c:${c}" title="${c}"></button>`;
      const none = (a) => `<button type="button" class="dk-sw none" data-f="${a}" data-v="" title="Ohne">∅</button>`;
      let h = '';
      const textish = e.t === 'text' || e.t === 'table' || (e.t === 'shape' && !isLine(e));
      if (textish) {
        const fs0 = Math.round(e.fs || 24);
        const sizes = SIZES.includes(fs0) ? SIZES : [...SIZES, fs0].sort((a, b) => a - b);
        h += `<select data-f="fs" title="Schriftgröße">${sizes.map((s) => `<option value="${s}"${s === fs0 ? ' selected' : ''}>${s}</option>`).join('')}</select>
          <button type="button" class="dk-fb" data-f="bold" title="Fett (Strg+B)"><b>F</b></button><button type="button" class="dk-fb" data-f="italic" title="Kursiv (Strg+I)"><i>K</i></button><button type="button" class="dk-fb" data-f="underline" title="Unterstrichen (Strg+U)"><u>U</u></button>
          <span class="dk-sep"></span>${COLORS.map((c) => `<button type="button" class="dk-sw" data-f="color" data-v="${c}" style="--c:${c}" title="Schriftfarbe"></button>`).join('')}
          <span class="dk-sep"></span><button type="button" class="dk-fb" data-f="ul" title="Aufzählung">•≡</button><button type="button" class="dk-fb" data-f="ol" title="Nummerierung">1≡</button>
          <button type="button" class="dk-fb" data-f="al" data-v="left" title="Linksbündig">⇤</button><button type="button" class="dk-fb" data-f="al" data-v="center" title="Zentriert">↔</button><button type="button" class="dk-fb" data-f="al" data-v="right" title="Rechtsbündig">⇥</button>`;
        if (e.t !== 'table') h += `<button type="button" class="dk-fb" data-f="va" data-v="t" title="Oben">⤒</button><button type="button" class="dk-fb" data-f="va" data-v="m" title="Mitte">↕</button><button type="button" class="dk-fb" data-f="va" data-v="b" title="Unten">⤓</button>`;
      }
      if (e.t === 'shape' || e.t === 'text') {
        if (!isLine(e)) h += `<span class="dk-sep"></span><span class="dk-lbl">Füllung</span>${none('fill')}${COLORS.map((c) => sw('fill', c, e.fill)).join('')}`;
        h += `<span class="dk-sep"></span><span class="dk-lbl">Linie</span>${none('line')}${COLORS.slice(0, 10).map((c) => sw('line', c, e.line)).join('')}<select data-f="lw" title="Linienstärke">${[0.5, 1, 2, 3, 4, 6, 8, 12].map((v) => `<option value="${v}"${v === (e.lw || (isLine(e) ? 3 : 2)) ? ' selected' : ''}>${v} pt</option>`).join('')}</select>`;
      }
      if (e.t === 'table') {
        h += `<span class="dk-sep"></span><button type="button" class="dk-fb wide" data-f="row+">+ Zeile</button><button type="button" class="dk-fb wide" data-f="row-">− Zeile</button><button type="button" class="dk-fb wide" data-f="col+">+ Spalte</button><button type="button" class="dk-fb wide" data-f="col-">− Spalte</button><button type="button" class="dk-fb wide${e.head ? ' on' : ''}" data-f="head">Kopfzeile</button>`;
        h += `<span class="dk-lbl">Linien</span>${COLORS.slice(0, 10).map((c) => sw('line', c, e.line)).join('')}`;
      }
      if (e.t === 'img') h += `<span class="dk-lbl">Bild:</span><button type="button" class="dk-fb wide" data-f="imgreset">Originalgröße (Seitenverhältnis)</button><span class="dk-lbl">Rahmen</span>${none('line')}${COLORS.slice(0, 10).map((c) => sw('line', c, e.line)).join('')}`;
      if (host.fmtExtra) h += host.fmtExtra();
      bar.innerHTML = h;
      bar.hidden = false;
      if (host.fmtShown) host.fmtShown(true);
      bar.onmousedown = (ev) => { if (!ev.target.closest('select')) ev.preventDefault(); }; // Auswahl im Text bleibt erhalten
      bar.onpointerdown = (ev) => ev.stopPropagation();
      bar.onclick = (ev) => { const b = ev.target.closest('[data-f]'); if (b && b.tagName !== 'SELECT') fmt(b.dataset.f, b.dataset.v); };
      bar.onchange = (ev) => { const s = ev.target.closest('select[data-f]'); if (s) fmt(s.dataset.f, s.value); };
    }
    // Format anwenden: im Bearbeiten auf die Markierung, sonst aufs ganze Element
    function fmt(f, v) {
      const ids = ED.sel.slice();
      const each = (fn) => change(() => ids.forEach((id) => { const e = byId(id); if (e) fn(e); }), true);
      if (f.startsWith('x:') && host.fmtAct) { host.fmtAct(f.slice(2), v); return; }
      const inline = ['bold', 'italic', 'underline', 'color', 'ul', 'ol', 'al'];
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
      else if (f === 'al') document.execCommand(v === 'center' ? 'justifyCenter' : v === 'right' ? 'justifyRight' : 'justifyLeft');
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
      if (ED.insert) { endEdit(); const kind = ED.insert; ED.insert = null; host.placing(false); insertAt(kind, ...toLocal(ev)); ev.preventDefault(); return true; }
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
    function insertAt(kind, x, y) {
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
      e.x = r1(Math.max(0, e.x)); e.y = r1(Math.max(0, e.y));
      change(() => { els().push(e); ED.sel = [e.id]; }, true);
      if (e.t === 'text') startEdit(e.id, null);
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
      host.placing(true);
      C.toast(msg, 4000);
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
    Object.assign(ED, { change, render, renderStage, renderFmt, startEdit, endEdit, down, hit, act, key, addImage, addTable, pasteEls, copy, select, byId, insertAt, toLocal });
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
    placing: (on) => { if (D.root) D.root.classList.toggle('dk-placing', on); },
    pickImage: () => $('.dk-file', D.root).click(),
  };

  function build(root) {
    root.innerHTML = `
      <div class="dk-top">
        <input class="dk-title" aria-label="Name der Präsentation" maxlength="200">
        <span class="dk-sep"></span>
        ${ib('newslide', ICON.slide, 'Neue Folie', 'Folie')}${ib('text', ICON.text, 'Textfeld', 'Text')}${ib('img', ICON.img, 'Bild einfügen', 'Bild')}${ib('shape', ICON.shape, 'Form', 'Form')}${ib('table', ICON.table, 'Tabelle', 'Tabelle')}
        <span class="dk-sep"></span>
        ${ib('undo', ICON.undo, 'Rückgängig (Strg+Z)')}${ib('redo', ICON.redo, 'Wiederholen (Strg+Y)')}
        ${ib('front', ICON.front, 'Nach vorne')}${ib('back', ICON.back, 'Nach hinten')}${ib('align', ICON.align, 'Ausrichten')}${ib('dup', ICON.dup, 'Duplizieren (Strg+D)')}${ib('del', ICON.del, 'Löschen (Entf)')}
        <span class="dk-sep"></span>
        ${ib('design', ICON.design, 'Design', 'Design')}
        <span class="dk-grow"></span>
        <span class="dk-state muted small"></span>
        ${ib('play', ICON.play, 'Präsentieren (F5)', 'Präsentieren')}${ib('pdf', ICON.pdf, 'Als PDF speichern', 'PDF')}
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
    const serif = th.font === 'serif';
    const F = {
      r: await doc.embedFont(serif ? StandardFonts.TimesRoman : StandardFonts.Helvetica),
      b: await doc.embedFont(serif ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold),
      i: await doc.embedFont(serif ? StandardFonts.TimesRomanItalic : StandardFonts.HelveticaOblique),
      bi: await doc.embedFont(serif ? StandardFonts.TimesRomanBoldItalic : StandardFonts.HelveticaBoldOblique),
    };
    let uni = null; // DejaVu für Zeichen außerhalb von WinAnsi (z. B. Pfeile, griechische Buchstaben)
    const needUni = (allEls || []).some((e) => [e.html || '', ...(e.rows || []).flat()].join('').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').split('').some((ch) => !winOk(ch) && ch !== '\n'));
    if (needUni) {
      await C.ensureFontkit();
      doc.registerFontkit(window.fontkit);
      const get = async (n) => new Uint8Array(await (await fetch('vendor/fonts/' + n + '?v=' + C.VERSION)).arrayBuffer());
      uni = { r: await doc.embedFont(await get('DejaVuSans.ttf'), { subset: true }), b: await doc.embedFont(await get('DejaVuSans-Bold.ttf'), { subset: true }) };
    }
    const fontOf = (r) => F[(r.b ? 'b' : '') + (r.i ? 'i' : '') || 'r'] || F.r;
    const fontCh = (ch, tok) => (winOk(ch) ? fontOf(tok) : (uni ? (tok.b ? uni.b : uni.r) : null));
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
          pg.drawText(mark, { x: (x + pad + ln.ind - fs * (ln.bullet.list === 'ol' ? 1.1 : 0.8)) * K, y: -(yy + fs * 0.92) * K, size: fs * K, font: F.r, color: hexRgb(color) });
        }
        drawRuns(pg, ln, lx, yy, fs, color, K);
        yy += lh + (ln.last ? fs * 0.3 : 0);
      }
    };
    async function drawEl(pg, e, K) {
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

  window.PDFSTIFT_DECK = { open, close, flush, preview, makeEditor, layerNode, elNode, painter, popMenu, clean, plain };
})();
