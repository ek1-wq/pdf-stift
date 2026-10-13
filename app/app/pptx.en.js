/* Automatisch erzeugt aus pptx.js (tools/i18n) – nicht von Hand ändern. */
/* PDF-Stift – PowerPoint-Dateien (.pptx): als Präsentation öffnen und Präsentationen als .pptx speichern.
 * Wird erst bei Bedarf geladen. Braucht window.PDFSTIFT_CORE (app.js), window.PDFSTIFT_DECK (deck.js) und fflate.
 * Maßstab: eine Folie ist 960 Bildpunkte breit; in PowerPoint 13,333 Zoll = 960 pt – 1 Bildpunkt entspricht also 1 pt. */
(() => {
  'use strict';
  const C = window.PDFSTIFT_CORE;
  const X = () => window.PDFSTIFT_DECK.PX;
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

  // ================================================================== Einlesen
  async function importPptx(file, progress) {
    const u8 = new Uint8Array(await file.arrayBuffer());
    let z;
    try { z = window.fflate.unzipSync(u8); } catch (e) { throw new Error("This is not a valid PowerPoint file (.pptx). Please save older .ppt files as .pptx in PowerPoint first."); }
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

    const pres = xml('ppt/presentation.xml');
    if (!pres) throw new Error("This is not a PowerPoint presentation (.pptx).");
    await X().fontsReady();
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
      const t = { scheme, map, major: fs ? fontOf('majorFont') : '', minor: fs ? fontOf('minorFont') : '', fmt, master: m, masterPath };
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
      for (const m of n.children) {
        const v = num(at(m, 'val')) / 100000;
        if (m.localName === 'alpha') alpha = v;
        else if (m.localName === 'lumMod' || m.localName === 'lumOff') {
          const [h, s, l] = rgb2hsl(r, g, b);
          [r, g, b] = hsl2rgb(h, s, Math.max(0, Math.min(1, m.localName === 'lumMod' ? l * v : l + v)));
        } else if (m.localName === 'tint') { r = r * v + 255 * (1 - v); g = g * v + 255 * (1 - v); b = b * v + 255 * (1 - v); }
        else if (m.localName === 'shade') { r *= v; g *= v; b *= v; }
      }
      return { c: '#' + (hex2(r) + hex2(g) + hex2(b)).toUpperCase(), a: alpha };
    }
    // Füllung: solidFill, Verlauf (erste Farbe), Muster; sonst Stil-Referenz
    function fillOf(spPr, style, T) {
      if (spPr) {
        if (kid(spPr, 'noFill')) return null;
        const sf = kid(spPr, 'solidFill'); if (sf) return color(sf, T);
        const gf = kid(spPr, 'gradFill'); if (gf) { const gs = all(gf, 'gs'); if (gs.length) return color(gs[0], T); }
        const pf = kid(spPr, 'pattFill'); if (pf) return color(kid(pf, 'fgClr'), T);
        if (kid(spPr, 'grpFill')) return null;
      }
      const fr = style && kid(style, 'fillRef');
      if (fr && num(at(fr, 'idx')) > 0) return color(fr, T);
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
    async function upload(mediaPath, crop) {
      const key = mediaPath + (crop ? JSON.stringify(crop) : '');
      if (key in upCache) return upCache[key];
      return (upCache[key] = (async () => {
        const b = z[mediaPath];
        if (!b) return null;
        const ext = (mediaPath.split('.').pop() || '').toLowerCase();
        if (/^(emf|wmf|tif|tiff)$/.test(ext)) { warn.emf++; return null; }
        const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' }[ext];
        if (!type) { warn.other++; return null; }
        let blob = new Blob([b], { type });
        const needCanvas = crop || type === 'image/svg+xml' || type === 'image/bmp' || b.length > 6e6;
        if (needCanvas) {
          const url = URL.createObjectURL(blob);
          try {
            const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("image")); i.src = url; });
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
            blob = await new Promise((res) => cv.toBlob(res, jpg ? 'image/jpeg' : 'image/png', 0.88));
          } catch (e) { warn.other++; return null; } finally { URL.revokeObjectURL(url); }
        }
        try {
          const r = await C.uploadImage(new File([blob], 'pptx.' + (blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1] || 'png'), { type: blob.type }));
          return r;
        } catch (e) { warn.other++; return null; }
      })());
    }

    // ---- Platzhalter: Lage und Textstile aus Layout und Master
    const phOf = (sp) => path(sp, sp.localName === 'pic' ? 'nvPicPr' : sp.localName === 'graphicFrame' ? 'nvGraphicFramePr' : 'nvSpPr', 'nvPr', 'ph');
    const phType = (ph) => at(ph, 'type') || (ph ? 'body' : '');
    const masterType = (t) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' || t === 'obj' || t === '' ? 'body' : t);
    function findPh(doc, ph) {
      if (!doc || !ph) return null;
      const list = all(doc, 'sp').concat(all(doc, 'pic')).filter((x) => phOf(x));
      const idx = at(ph, 'idx'), t = phType(ph);
      return (idx != null && list.find((x) => at(phOf(x), 'idx') === idx)) || list.find((x) => phType(phOf(x)) === t) || list.find((x) => masterType(phType(phOf(x))) === masterType(t)) || null;
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
      const paras = [];
      const stats = { sz: new Map(), c: new Map(), ff: new Map() };
      const bump = (m, k, n) => m.set(k, (m.get(k) || 0) + n);
      for (const p of kids(txBody, 'p')) {
        const pPr = kid(p, 'pPr');
        const lvl = num(at(pPr, 'lvl'));
        const lv = chain.map((s) => kid(s, `lvl${lvl + 1}pPr`)).filter(Boolean);
        const pl = [pPr, ...lv].filter(Boolean);
        const algn = firstAttr(pl, 'algn') || 'l';
        let list = null;
        for (const e of pl) {
          if (kid(e, 'buNone')) { list = null; break; }
          if (kid(e, 'buAutoNum')) { list = 'ol'; break; }
          if (kid(e, 'buChar') || kid(e, 'buBlip')) { list = 'ul'; break; }
        }
        const defR = pl.map((e) => kid(e, 'defRPr')).filter(Boolean);
        const ownDef = [pPr, ...chain.slice(0, chain.own || 0).map((st) => kid(st, `lvl${lvl + 1}pPr`))].filter(Boolean).map((e) => kid(e, 'defRPr')).filter(Boolean); // eigene Stile vor dem Formstil (fontRef)
        const runs = [];
        for (const r of p.children) {
          if (r.localName === 'br') { runs.push({ br: 1 }); continue; }
          if (r.localName !== 'r' && r.localName !== 'fld') continue;
          const t = (kid(r, 't') || {}).textContent || '';
          if (!t) continue;
          const rPr = kid(r, 'rPr');
          const rl = [rPr, ...defR].filter(Boolean);
          const szv = firstAttr(rl, 'sz');
          const size = (szv ? num(szv) / 100 : base.sz || 18) * scale * K;
          let col = null;
          const ownL = [rPr, ...ownDef].filter(Boolean);
          const pick = (list) => { for (const e of list) { const f = kid(e, 'solidFill'); if (f) return color(f, T); } return null; };
          col = pick(ownL) || base.fontRef || pick(rl);
          let face = null;
          for (const e of rl) { const l = kid(e, 'latin'); if (l && at(l, 'typeface')) { face = at(l, 'typeface'); break; } }
          if (face === '+mj-lt') face = T.major; else if (face === '+mn-lt') face = T.minor;
          if (!face) face = base.major ? T.major : T.minor;
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
        paras.push({ algn, list, lvl, runs });
      }
      const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0];
      const fs = top(stats.sz) ? top(stats.sz)[0] : Math.round((base.sz || 18) * K);
      const c = top(stats.c) ? top(stats.c)[0] : base.c || '';
      const ff = top(stats.ff) ? top(stats.ff)[0] : base.major ? T.major : T.minor;
      // HTML bauen
      const runHtml = (r) => {
        let h = esc(r.t).replace(/\t/g, ' ').replace(/ {2}/g, ' &nbsp;');
        if (r.sup) h = `<sup>${h}</sup>`; if (r.sub) h = `<sub>${h}</sub>`;
        if (r.u) h = `<u>${h}</u>`; if (r.s) h = `<s>${h}</s>`; if (r.i) h = `<i>${h}</i>`; if (r.b) h = `<b>${h}</b>`;
        const st = (r.c && r.c !== c ? `color:${r.c};` : '') + (r.hi ? `background-color:${r.hi};` : '');
        if (st) h = `<span style="${st}">${h}</span>`;
        if (r.href) h = `<a href="${esc(r.href)}">${h}</a>`;
        return h;
      };
      const AL = { ctr: 'center', r: 'right', just: 'justify', dist: 'justify' };
      let html = '';
      const stack = []; // offene Listen [{tag, lvl}]
      const closeTo = (depth) => { while (stack.length > depth) html += `</li></${stack.pop().tag}>`; };
      for (const p of paras) {
        const inner = p.runs.map((r) => (r.br ? '<br>' : runHtml(r))).join('') || '<br>';
        const al = AL[p.algn] ? ` style="text-align: ${AL[p.algn]};"` : '';
        if (p.list && p.runs.length) {
          const depth = p.lvl + 1;
          if (stack.length > depth) closeTo(depth);
          if (stack.length === depth && stack[depth - 1].tag !== p.list) closeTo(depth - 1);
          if (stack.length === depth) html += '</li>';
          while (stack.length < depth) { html += `<${p.list}>`; stack.push({ tag: p.list }); if (stack.length < depth) html += '<li>'; }
          html += `<li>${al ? `<div${al}>${inner}</div>` : inner}`;
        } else {
          closeTo(0);
          html += `<div${al}>${inner}</div>`;
        }
      }
      closeTo(0);
      const hasText = paras.some((p) => p.runs.some((r) => r.t && r.t.trim()));
      return { html, fs: Math.max(4, fs), c, ff, hasText };
    }

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
    const LINE_PRST = /^(line|straightConnector1|curvedConnector\d|bentConnector2)$/;
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
          M2 = { f: (x, y) => M.f(g.x + (x - ox) * sx, g.y + (y - oy) * sy), s: M.s * Math.sqrt(sx * sy) };
        }
        const id = X().uid();
        const before = out.length;
        for (const c of sp.children) await convert(c, ctx, M2, out, gid || id);
        if (out.length - before < 2 && !gid) for (let i = before; i < out.length; i++) delete out[i].g;
        return;
      }
      if (!/^(sp|pic|cxnSp|graphicFrame)$/.test(ln)) return;
      const spPr = kid(sp, 'spPr');
      const style = kid(sp, 'style');
      const ph = phOf(sp);
      // Lage (bei Platzhaltern ohne eigene Lage: aus Layout oder Master)
      let xf = ln === 'graphicFrame' ? kid(sp, 'xfrm') : xfrmOf(sp);
      if ((!xf || !kid(xf, 'ext')) && ph) { const lp = findPh(ctx.layout, ph) || findPh(T.master, ph); xf = lp && xfrmOf(lp); if (!xf) { const mp = findPh(T.master, ph); xf = mp && xfrmOf(mp); } }
      if (!xf) return;
      const b = box(xf);
      const [x0, y0] = M.f(b.x, b.y), [x1, y1] = M.f(b.x + b.w, b.y + b.h);
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
        const res = await upload(target.target, crop);
        if (!res) return;
        const e = { ...base, t: 'img', src: res.src, iw: res.w, ih: res.h };
        if (b.fx) e.fx = 1; if (b.fy) e.fy = 1;
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
          const rows = [];
          for (const tr of kids(tbl, 'tr')) {
            const row = [];
            for (const tc of kids(tr, 'tc')) {
              if (at(tc, 'hMerge') === '1' || at(tc, 'vMerge') === '1') { row.push(''); continue; }
              if (!rows.length && path(tc, 'tcPr', 'solidFill')) headFill++;
              const t = textOf(kid(tc, 'txBody'), chain, ctx, { sz: 18 });
              if (t && t.hasText && !fs) fs = t.fs;
              row.push(t ? t.html : '');
              if (!lineC) { const lb = path(tc, 'tcPr', 'lnB') || path(tc, 'tcPr', 'lnL'); const c = lb && !kid(lb, 'noFill') && color(kid(lb, 'solidFill'), T); if (c) lineC = c.c; }
            }
            while (row.length < grid.length) row.push('');
            rows.push(row.slice(0, Math.max(1, grid.length)));
          }
          if (!rows.length) return;
          const e = { ...base, t: 'table', rows, cw: grid.map((g) => Math.round((g / tot) * 1000) / 1000), fs: Math.round(fs || 18) };
          if (at(kid(tbl, 'tblPr'), 'firstRow') === '1' || (headFill && headFill >= rows[0].length && rows.length > 1)) e.head = 1;
          if (lineC) e.line = lineC;
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
          const ch = pa && [...pa.children].find((n) => /(bar|bar3D|line|line3D|pie|pie3D|doughnut|area|area3D)Chart$/.test(n.localName));
          if (!ch) return;
          const kind = ch.localName.replace(/3D/, '');
          const ct = kind === 'barChart' ? (at(kid(ch, 'barDir'), 'val') === 'bar' ? 'bar' : 'col') : kind === 'pieChart' || kind === 'doughnutChart' ? 'pie' : 'line';
          const pts = (el) => { const ml = el && all(el, 'multiLvlStrCache')[0]; const cache = el && (all(el, 'strCache')[0] || all(el, 'numCache')[0] || (ml && kids(ml, 'lvl')[0])); const o = []; if (cache) for (const p of kids(cache, 'pt')) o[num(at(p, 'idx'))] = (kid(p, 'v') || {}).textContent || ''; return o; };
          const sers = kids(ch, 'ser');
          let labels = [];
          const series = sers.map((s) => {
            const cat = pts(kid(s, 'cat')); if (cat.length > labels.length) labels = cat;
            const nm = pts(kid(s, 'tx'))[0] || (path(s, 'tx', 'v') || {}).textContent || '';
            return { n: nm, v: pts(kid(s, 'val')).map((v) => num(v)) };
          }).filter((s) => s.v.length);
          if (!series.length) return;
          labels = labels.map((l) => (l == null ? '' : String(l)));
          while (labels.length < series[0].v.length) labels.push(String(labels.length + 1));
          const title = all(path(cd.documentElement, 'chart', 'title'), 't').map((t) => t.textContent).join('') || '';
          const e = { ...base, t: 'chart', ct, labels: labels.slice(0, 40), series: series.slice(0, 10).map((s) => ({ n: s.n, v: s.v.slice(0, 40) })), fs: Math.max(8, Math.round(14 * K)), legend: path(cd.documentElement, 'chart', 'legend') ? 1 : 0 };
          if (title && path(cd.documentElement, 'chart', 'autoTitleDeleted') && at(path(cd.documentElement, 'chart', 'autoTitleDeleted'), 'val') === '1') { /* kein Titel */ } else if (title) e.title = title;
          out.push(e);
          return;
        }
        // SmartArt: die mitgespeicherte Zeichnung übernehmen
        if (/diagram$/.test(uri)) {
          const rel = Object.values(ctx.rels).find((r) => r.type === 'diagramDrawing' && xml(r.target));
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
      let fill = fillOf(spPr, style, T);
      const line = lineOf(spPr, style, T);
      const fontRefEl = style && kid(style, 'fontRef');
      const fontRef = fontRefEl ? color(fontRefEl, T) : null;
      const isLineShape = ln === 'cxnSp' || LINE_PRST.test(prst);
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
      const k = PRST_K[prst] || (prst === 'custom' ? 'rect' : 'rect');
      const bodies = bodyPrChain(sp, ctx);
      const anchor = firstAttr(bodies, 'anchor');
      const va = anchor === 'ctr' ? 'm' : anchor === 'b' ? 'b' : 't';
      const ins = ['lIns', 'tIns', 'rIns', 'bIns'].map((n) => { const v = firstAttr(bodies, n); return v == null ? (n[0] === 'l' || n[0] === 'r' ? 91440 : 45720) : num(v); });
      const pad = r1(Math.max(0, Math.min(40, px((ins[0] + ins[1] + ins[2] + ins[3]) / 4))));
      const plainBox = k === 'rect' && !fill && !line;
      if (plainBox && !(t && t.hasText)) return; // leerer Rahmen
      const e = { ...base };
      if (fill && fill.a < 1 && fill.a > 0) { if (!(t && t.hasText)) e.op = r1(fill.a); }
      if (plainBox || (k === 'rect' && t && t.hasText && !line && fill)) {
        e.t = 'text';
        if (fill) e.fill = fill.c;
      } else {
        e.t = 'shape'; e.k = k;
        e.fill = fill ? fill.c : undefined;
        if (!fill) delete e.fill;
        if (b.fx) e.fx = 1; if (b.fy) e.fy = 1;
      }
      if (line) { e.line = line.c; e.lw = line.w; }
      if (t && t.hasText) {
        e.html = t.html; e.fs = r1(t.fs); e.va = va; e.pad = pad;
        e.c = t.c || (e.t === 'shape' && fill ? '#FFFFFF' : T.scheme.dk1 ? '#' + T.scheme.dk1 : '#1A1A1A');
        const key = X().fontKey(t.ff);
        if (key && key !== ctx.deckFont) e.ff = key;
        const lnSp = firstAttr(chain.map((s) => kid(s, 'lvl1pPr')).filter(Boolean).map((x) => path(x, 'lnSpc', 'spcPct')).filter(Boolean), 'val');
        if (lnSp && Math.abs(num(lnSp) / 100000 - 1) > 0.05) e.lh = r1(num(lnSp) / 100000 * 1.2);
      } else if (e.t === 'text') return;
      out.push(e);
    }

    // Hintergrund einer Folie, eines Layouts oder des Masters
    async function bgOfDoc(doc, rels, T) {
      const bg = doc && path(doc.documentElement, 'cSld', 'bg');
      if (!bg) return null;
      const pr = kid(bg, 'bgPr');
      if (pr) {
        const sf = kid(pr, 'solidFill'); if (sf) { const c = color(sf, T); return c ? { bg: c.c } : null; }
        const gf = kid(pr, 'gradFill');
        if (gf) {
          const gs = all(gf, 'gs').sort((a, b) => num(at(a, 'pos')) - num(at(b, 'pos')));
          const a = color(gs[0], T), z2 = color(gs[gs.length - 1], T);
          const ang = num(at(kid(gf, 'lin'), 'ang')) / 60000;
          if (a && z2) return { bg: a.c, bgGrad: { a: a.c, b: z2.c, dir: Math.abs(ang - 90) < 20 ? 'v' : ang < 20 || ang > 340 ? 'h' : 'd' } };
        }
        const bf = kid(pr, 'blipFill');
        if (bf) { const r = rels[rid(kid(bf, 'blip'), 'embed')]; const up = r && !r.ext && (await upload(r.target)); if (up) return { bgImg: up.src }; }
        if (kid(pr, 'noFill')) return { bg: '#FFFFFF' };
      }
      const ref = kid(bg, 'bgRef');
      if (ref) {
        const idx = num(at(ref, 'idx'));
        const c = color(ref, T);
        if (idx >= 1001 && T.fmt) {
          const lst = all(T.fmt, 'bgFillStyleLst')[0];
          const f = lst && lst.children[idx - 1001];
          if (f && f.localName === 'solidFill') { const c2 = color(f, T, c && c.c); if (c2) return { bg: c2.c }; }
          if (f && f.localName === 'gradFill') { const gs = all(f, 'gs'); const a = color(gs[0], T, c && c.c), z2 = color(gs[gs.length - 1], T, c && c.c); if (a && z2) return { bg: a.c, bgGrad: { a: a.c, b: z2.c, dir: 'v' } }; }
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
      if (decoCache[docPath]) return decoCache[docPath];
      const d = xml(docPath);
      const tree = d && all(d, 'spTree')[0];
      const out = [];
      if (tree) for (const c of tree.children) { if (/^(sp|pic|cxnSp|grpSp|graphicFrame)$/.test(c.localName) && !phOf(c)) await convert(c, { ...ctx, rels: relsOf(docPath) }, ID, out); }
      return (decoCache[docPath] = out);
    }
    const TR = { fade: 'fade', dissolve: 'fade', push: 'push', wipe: 'wipe', split: 'wipe', zoom: 'zoom', cover: 'cover', pull: 'cover', randomBar: 'wipe', morph: 'fade' };
    const slides = [];
    for (let i = 0; i < slideIds.length; i++) {
      progress && progress(`Slide ${i + 1} of ${slideIds.length} is being imported …`);
      const sp = slideIds[i];
      const d = xml(sp);
      if (!d) continue;
      const rels = relsOf(sp);
      const layR = relOfType(sp, 'slideLayout');
      const layout = layR ? xml(layR.target) : null;
      const mR = layR && relOfType(layR.target, 'slideMaster');
      const T = mR ? themeOf(mR.target) : T0;
      const ctx = { T, layout, rels, deckFont };
      const els = [];
      const showMaster = at(d.documentElement, 'showMasterSp') !== '0' && (!layout || at(layout.documentElement, 'showMasterSp') !== '0');
      if (mR && showMaster) for (const e of await deco(mR.target, { T, layout: null, deckFont })) els.push({ ...JSON.parse(JSON.stringify(e)), id: X().uid() });
      if (layR) for (const e of await deco(layR.target, { T, layout, deckFont })) els.push({ ...JSON.parse(JSON.stringify(e)), id: X().uid() });
      const tree = all(d, 'spTree')[0];
      if (tree) for (const c of tree.children) await convert(c, ctx, ID, els);
      // Gruppen-IDs je Folie neu vergeben (Gestaltungselemente werden mehrfach verwendet)
      const gmap = {};
      for (const e of els) if (e.g) e.g = gmap[e.g] || (gmap[e.g] = X().uid());
      const s = { id: X().uid(), els };
      const bg = (await bgOfDoc(d, rels, T)) || (layout && (await bgOfDoc(layout, relsOf(layR.target), T)));
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
      slides.push(s);
    }
    if (!slides.length) throw new Error("No slides were found in this PowerPoint file.");
    let title = '';
    const core = xml('docProps/core.xml');
    if (core) title = (all(core, 'title')[0] || {}).textContent || '';
    title = (title || file.name.replace(/\.[^.]+$/, '')).trim().slice(0, 200);
    return { deck: { v: 1, w: W, h: H, title, theme, slides }, warn };
  }

  // ================================================================== Speichern als .pptx
  let libP = null;
  function lib() {
    if (window.PptxGenJS) return Promise.resolve(window.PptxGenJS);
    libP = libP || new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'vendor/pptxgen.bundle.js?v=' + C.VERSION; sc.onload = () => res(window.PptxGenJS); sc.onerror = () => { libP = null; rej(new Error("PowerPoint module could not be loaded.")); }; document.head.appendChild(sc); });
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
    const np = (blk) => { cur = { al: blk.al || '', list: blk.list || null, lvl: blk.lvl || 0, runs: [] }; paras.push(cur); return cur; };
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
        if (tag === 'ul' || tag === 'ol') { cur = null; walk(k, st, { ...blk, list: tag, lvl: blk.list ? blk.lvl + 1 : 0 }); cur = null; continue; }
        if (tag === 'li' || tag === 'div' || tag === 'p') {
          const al = (k.style && k.style.textAlign) || blk.al || '';
          if (tag === 'li') { np({ ...blk, al }); walk(k, st, { ...blk, al, inLi: 1 }); cur = null; continue; }
          if (blk.inLi && cur && !cur.runs.length) { cur.al = al; walk(k, st, { ...blk, al }); continue; }
          np({ ...blk, al }); walk(k, st, { ...blk, al }); cur = null; continue;
        }
        if (tag === 'br') { if (!cur) np(blk); else if (cur.runs.length) np(blk); else cur.br = 1; continue; }
        const s2 = { ...st };
        if (tag === 'b') s2.b = 1; else if (tag === 'i') s2.i = 1; else if (tag === 'u') s2.u = 1; else if (tag === 's') s2.s = 1;
        else if (tag === 'sup') s2.sup = 1; else if (tag === 'sub') s2.sub = 1;
        else if (tag === 'a') s2.href = k.getAttribute('href');
        else if (tag === 'span') { if (k.style.color) s2.c = toHex(k.style.color); if (k.style.backgroundColor) s2.hi = toHex(k.style.backgroundColor); }
        walk(k, s2, blk);
      }
    };
    walk(t.content, {}, {});
    if (!paras.length) return [{ text: '', options: {} }];
    const AL = { center: 'center', right: 'right', justify: 'justify' };
    const out = [];
    paras.forEach((p, pi) => {
      const po = { align: AL[p.al] || 'left' };
      if (p.list) { po.bullet = p.list === 'ol' ? { type: 'number' } : true; if (p.lvl) po.indentLevel = p.lvl; }
      const runs = p.runs.length ? p.runs : [{ t: '', st: {} }];
      runs.forEach((r, ri) => {
        const op = { ...po };
        if (r.st.b) op.bold = true; if (r.st.i) op.italic = true; if (r.st.u) op.underline = { style: 'sng' }; if (r.st.s) op.strike = 'sngStrike';
        if (r.st.sup) op.superscript = true; if (r.st.sub) op.subscript = true;
        if (r.st.c) op.color = r.st.c; else if (o && o.color) op.color = o.color;
        if (r.st.hi) op.highlight = r.st.hi;
        if (r.st.href) op.hyperlink = { url: r.st.href };
        if (ri === runs.length - 1 && pi < paras.length - 1) op.breakLine = true;
        out.push({ text: r.t, options: op });
      });
    });
    return out;
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
    pres.title = deck.title || "Presentation";
    pres.company = '';
    const baseFont = P.fontOffice(th.font);
    pres.theme = { headFontFace: baseFont, bodyFontFace: baseFont };
    const imgCache = {};
    const imgData = (src) => (imgCache[src] = imgCache[src] || fetch(P.imgUrl(src), { credentials: 'same-origin' }).then((r) => { if (!r.ok) throw new Error("image"); return r.blob(); }).then(blobToData));
    const inch = (v) => Math.round((v / IN) * 10000) / 10000;
    const VA = { t: 'top', m: 'middle', b: 'bottom' };
    const LINE_K = ['line', 'arrow', 'arrow2'], OPEN_K = ['elbow', 'brackL', 'brackR', 'braceL', 'braceR', 'arc'];
    let skipped = 0;
    for (let si = 0; si < deck.slides.length; si++) {
      const s = deck.slides[si];
      opt.progress && opt.progress(`Slide ${si + 1} of ${deck.slides.length} …`);
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
      const els = [...s.els.filter((e) => !P.isPh(e)), ...(opt.hf ? opt.hf(si) : [])];
      for (const e of els) {
        try {
          const boxO = { x: inch(e.x), y: inch(e.y), w: inch(e.w), h: inch(e.h) };
          if (e.r) boxO.rotate = e.r;
          const shadow = e.sh ? { type: 'outer', blur: 3, offset: 3, angle: 45, color: '000000', opacity: 0.35 } : undefined;
          const tr = e.op != null && e.op < 1 ? Math.round((1 - e.op) * 100) : 0;
          const face = e.ff ? P.fontOffice(e.ff) : baseFont;
          if (e.t === 'text') {
            const o = { ...boxO, fontFace: face, fontSize: e.fs || 24, color: noHash(e.c || th.fg), valign: VA[e.va || 't'], margin: e.pad != null ? e.pad : 8, fit: 'none', shadow };
            if (e.fill) o.fill = { color: noHash(e.fill), transparency: tr || undefined };
            if (e.line) o.line = { color: noHash(e.line), width: e.lw || 2 };
            if (e.lh) o.lineSpacingMultiple = Math.round((e.lh / 1.2) * 100) / 100;
            sl.addText(runsOf(e.html, { color: noHash(e.c || th.fg) }), o);
          } else if (e.t === 'shape') {
            const lineK = LINE_K.includes(e.k), openK = OPEN_K.includes(e.k);
            if (lineK) {
              sl.addShape('line', { x: inch(e.x), y: inch(e.y + e.h / 2), w: inch(e.w), h: 0, rotate: e.r || 0, shadow, line: { color: noHash(e.line || th.fg), width: e.lw || 3, transparency: tr || undefined, endArrowType: e.k !== 'line' ? 'triangle' : undefined, beginArrowType: e.k === 'arrow2' ? 'triangle' : undefined } });
              continue;
            }
            const o = { ...boxO, shape: SHAPE_P[e.k] || 'rect', shadow, flipH: !!e.fx, flipV: !!e.fy };
            if (openK) { o.fill = { type: 'none' }; o.line = { color: noHash(e.line || th.fg), width: e.lw || 2 }; if (e.k === 'elbow' && e.head !== 0) o.line.endArrowType = 'triangle'; }
            else {
              o.fill = e.fill ? { color: noHash(e.fill), transparency: tr || undefined } : { type: 'none' };
              o.line = e.line ? { color: noHash(e.line), width: e.lw || 2 } : { type: 'none' };
            }
            if (e.html && !openK) {
              Object.assign(o, { fontFace: face, fontSize: e.fs || 20, color: noHash(e.c || (e.fill ? '#FFFFFF' : th.fg)), valign: VA[e.va || 'm'], margin: e.pad != null ? e.pad : 8, align: 'center' });
              sl.addText(runsOf(e.html, { color: o.color }), o);
            } else sl.addText('', o);
          } else if (e.t === 'img') {
            const o = { ...boxO, data: await imgData(e.src), flipH: !!e.fx, flipV: !!e.fy, shadow };
            if (tr) o.transparency = tr;
            sl.addImage(o);
          } else if (e.t === 'table') {
            const n = e.rows[0] ? e.rows[0].length : 1;
            const cw = e.cw || e.rows[0].map(() => 1 / n);
            const rows = e.rows.map((row, ri) => row.map((cell) => {
              const head = ri === 0 && e.head;
              const color = head ? 'FFFFFF' : noHash(th.fg);
              return { text: runsOf(cell, { color }), options: { color, fill: head ? { color: noHash(th.accent) } : undefined, bold: head ? true : undefined } };
            }));
            sl.addTable(rows, { x: inch(e.x), y: inch(e.y), w: inch(e.w), colW: cw.map((f) => inch(f * e.w)), rowH: inch(e.h / Math.max(1, e.rows.length)), fontFace: face, fontSize: e.fs || 18, valign: 'middle', border: { type: 'solid', pt: 1, color: noHash(e.line || '#868E96') }, margin: Math.max(1, Math.round((e.fs || 18) / 3)) });
          } else if (e.t === 'chart') {
            const T = { col: 'bar', bar: 'bar', line: 'line', pie: 'pie' }[e.ct] || 'bar';
            const ser = (e.series || []).filter((x) => x && Array.isArray(x.v));
            const data = (e.ct === 'pie' ? ser.slice(0, 1) : ser).map((x) => ({ name: x.n || '', labels: (e.labels || []).map(String), values: x.v.map((v) => +v || 0) }));
            if (!data.length) continue;
            const fs = e.fs || 14;
            const o = { ...boxO, chartColors: P.chartColors(th).map(noHash), showLegend: e.legend !== 0 && (e.ct === 'pie' || data.length > 1), legendPos: 'b', legendFontSize: fs, catAxisLabelFontSize: fs, valAxisLabelFontSize: fs, showTitle: !!e.title, title: e.title || '', titleFontSize: Math.round(fs * 1.25) };
            if (T === 'bar') o.barDir = e.ct === 'bar' ? 'bar' : 'col';
            delete o.rotate;
            sl.addChart(T, data, o);
          }
        } catch (err) { skipped++; }
      }
      // Stiftnotizen auf der Folie als Bild darüber
      if (s.ink && s.ink.length) {
        try {
          const svg = P.inkSvg(s).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
          sl.addImage({ data: await svgToPng(svg, W, H, 2), x: 0, y: 0, w: W / IN, h: H / IN });
        } catch (err) { skipped++; }
      }
      if (s.notes) sl.addNotes(s.notes);
    }
    const blob = await pres.write({ outputType: 'blob' });
    return { blob, skipped };
  }

  window.PDFSTIFT_PPTX = { importPptx, exportPptx };
})();
