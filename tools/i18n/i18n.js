#!/usr/bin/env node
// Übersetzung von PDF-Stift ins Englische.
//   node i18n.js extract   → pending.json: alle Texte, die im Wörterbuch en.json noch fehlen (mit Zusammenhang)
//   node i18n.js build     → erzeugt die englischen Dateien (app.en.js, index.en.php, main.en.js, l10n.en.js)
//   node i18n.js prune     → entfernt Wörterbuch-Einträge, die in keiner Quelle mehr vorkommen
//   node i18n.js check     → wie build, meldet aber einen Fehler, wenn erzeugte Dateien veraltet sind
// Wörterbuch en.json: { "deutscher Text": "English text" }  –  null = unverändert lassen (kein Text für Menschen)
'use strict';
const fs = require('fs');
const path = require('path');
const { scan, scanQuotes, enQuotes, encodeLit, encodeTpl } = require('./lib');

const ROOT = path.resolve(__dirname, '../..');
const R = (p) => path.join(ROOT, p);
const DICT_FILE = path.join(__dirname, 'en.json');

const JS_SOURCES = [
  { src: 'app/app/app.js', out: 'app/app/app.en.js' },
  { src: 'app/app/deck.js', out: 'app/app/deck.en.js' },
  { src: 'desktop/main.js', out: 'desktop/main.en.js', prefix: 'main:' }, // „main:Text“ = eigene Übersetzung nur für das Windows-Programm
];
const HTML_SOURCES = [
  { src: 'app/index.php', out: 'app/index.en.php' },
];
const SERVER_MSG_SOURCES = ['app/api.php', ...fs.readdirSync(R('app/lib')).filter((f) => f.endsWith('.php')).map((f) => 'app/lib/' + f)];
const L10N_OUT = 'app/app/l10n.en.js';

const readSrc = (p) => fs.readFileSync(R(p), 'utf8').replace(/\r\n/g, '\n'); // Windows-Zeilenenden vereinheitlichen
const loadDict = () => (fs.existsSync(DICT_FILE) ? JSON.parse(fs.readFileSync(DICT_FILE, 'utf8')) : {});

// ---------------------------------------------------------------- HTML (mit PHP-Einschüben) zerlegen
const ATTRS = ['title', 'aria-label', 'placeholder', 'alt', 'data-tip', 'data-label', 'label', 'value'];
function htmlSegments(html) {
  // PHP-Teile schützen
  const php = [];
  const masked = html.replace(/<\?[\s\S]*?\?>/g, (m) => { php.push(m); return `\u0000${php.length - 1}\u0000`; });
  const segs = []; // {start,end,value,kind:'text'|'attr'}
  const re = /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1>|<svg\b[\s\S]*?<\/svg>|<[^>]+>/gi;
  let last = 0, m;
  const pushText = (a, b) => {
    const t = masked.slice(a, b);
    const lead = t.match(/^\s*/)[0].length, trail = t.match(/\s*$/)[0].length;
    const core = t.slice(lead, t.length - trail);
    if (core && /[A-Za-zÄÖÜäöüß]/.test(core) && !/\u0000/.test(core)) segs.push({ start: a + lead, end: b - trail, value: core, kind: 'text' });
  };
  while ((m = re.exec(masked))) {
    pushText(last, m.index);
    const tag = m[0];
    if (!/^<(!--|script|style|svg)/i.test(tag)) {
      const ar = /\s([a-z-]+)="([^"]*)"/gi;
      let a;
      while ((a = ar.exec(tag))) {
        const name = a[1].toLowerCase();
        if (!ATTRS.includes(name)) continue;
        if (name === 'value' && !/^<(option|button|input[^>]*type="(button|submit)")/i.test(tag)) continue;
        const v = a[2];
        if (!v || !/[A-Za-zÄÖÜäöüß]/.test(v) || /\u0000/.test(v)) continue;
        const vs = m.index + a.index + a[0].indexOf('"') + 1;
        segs.push({ start: vs, end: vs + v.length, value: v, kind: 'attr' });
      }
    }
    last = m.index + tag.length;
  }
  pushText(last, masked.length);
  const unmask = (s) => s.replace(/\u0000(\d+)\u0000/g, (_, i) => php[+i]);
  return { masked, segs, unmask };
}
const decodeEnt = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
const encodeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const encodeAttr = (s) => encodeText(s).replace(/"/g, '&quot;');

// ---------------------------------------------------------------- Server-Meldungen (fail('…'), 'error' => '…', 'msg' => '…')
function serverMessages() {
  const out = new Map();
  for (const f of SERVER_MSG_SOURCES) {
    const s = readSrc(f);
    const re = /(?:fail|RuntimeException|Exception)\(\s*'((?:[^'\\]|\\.)*)'|'(?:error|msg|message|hint|note)'\s*=>\s*'((?:[^'\\]|\\.)*)'/g;
    let m;
    while ((m = re.exec(s))) {
      const v = (m[1] ?? m[2]).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
      if (/[A-Za-zÄÖÜäöüß]{3}/.test(v)) out.set(v, f + ':' + s.slice(0, m.index).split('\n').length);
    }
  }
  return out;
}

// ---------------------------------------------------------------- Extraktion
function extract() {
  const dict = loadDict();
  const pending = {};
  const add = (v, where, ctx) => {
    if (Object.prototype.hasOwnProperty.call(dict, v)) return;
    if (!pending[v]) pending[v] = { where: [], ctx };
    if (pending[v].where.length < 3) pending[v].where.push(where);
  };
  for (const { src } of JS_SOURCES) {
    const code = readSrc(src);
    const lines = code.split('\n');
    for (const s of scan(code)) {
      const ctx = lines[s.line - 1].trim().slice(0, 300);
      add(s.value, `${src}:${s.line}${s.flag ? ' [' + s.flag + ']' : ''}`, ctx);
    }
  }
  for (const { src } of HTML_SOURCES) {
    const html = readSrc(src);
    const { masked, segs } = htmlSegments(html);
    for (const g of segs) {
      const line = masked.slice(0, g.start).split('\n').length;
      const ctx = masked.split('\n')[line - 1].trim().slice(0, 300);
      add(decodeEnt(g.value), `${src}:${line} [${g.kind}]`, ctx);
    }
  }
  for (const [v, where] of serverMessages()) add(v, where + ' [server]', '');
  fs.writeFileSync(path.join(__dirname, 'pending.json'), JSON.stringify(pending, null, 1));
  console.log('fehlend:', Object.keys(pending).length);
}

// ---------------------------------------------------------------- Aufräumen: Einträge, die in keiner Quelle mehr vorkommen
function prune() {
  const dict = loadDict();
  const used = new Set();
  for (const { src } of JS_SOURCES) for (const x of scan(readSrc(src))) used.add(x.value);
  for (const { src } of HTML_SOURCES) for (const g of htmlSegments(readSrc(src)).segs) used.add(decodeEnt(g.value));
  for (const [v] of serverMessages()) used.add(v);
  let n = 0;
  for (const k of Object.keys(dict)) {
    const base = k.replace(/^(html|main):/, '');
    if (!used.has(base)) { delete dict[k]; n++; }
  }
  fs.writeFileSync(DICT_FILE, JSON.stringify(dict, null, 1));
  console.log('entfernt:', n, '· bleiben:', Object.keys(dict).length);
}

// ---------------------------------------------------------------- Build
function translateJs(code, dict, missing, prefix) {
  const segs = scan(code);
  const seen = new Set(segs.map((x) => x.start));
  for (const q of scanQuotes(code)) if (!seen.has(q.start)) segs.push({ ...q, quote: true });
  segs.sort((a, b) => a.start - b.start);
  let out = '', pos = 0;
  for (const s of segs) {
    if (s.quote) { out += code.slice(pos, s.start) + (s.kind === 'lit' ? encodeLit(enQuotes(s.value)) : encodeTpl(enQuotes(s.value))); pos = s.end; continue; }
    const t = prefix && dict[prefix + s.value] !== undefined ? dict[prefix + s.value] : dict[s.value];
    if (t === undefined) { missing.add(s.value); continue; }
    if (t === null || t === s.value) continue;
    out += code.slice(pos, s.start);
    out += s.kind === 'lit' ? encodeLit(t) : encodeTpl(t);
    pos = s.end;
  }
  return out + code.slice(pos);
}
function translateHtml(html, dict, missing) {
  const { masked, segs, unmask } = htmlSegments(html);
  let out = '', pos = 0;
  for (const g of segs) {
    const key = decodeEnt(g.value);
    const t = dict['html:' + key] !== undefined ? dict['html:' + key] : dict[key]; // „html:“ = eigene Übersetzung nur für die Seite
    if (t === undefined) { missing.add(key); continue; }
    if (t === null || t === key) continue;
    out += masked.slice(pos, g.start) + (g.kind === 'attr' ? encodeAttr(t) : encodeText(t));
    pos = g.end;
  }
  return unmask(out + masked.slice(pos));
}

function build(check) {
  const dict = loadDict();
  const missing = new Set();
  const results = [];
  for (const { src, out, prefix } of JS_SOURCES) {
    let code = translateJs(readSrc(src), dict, missing, prefix);
    code = '/* Automatisch erzeugt aus ' + path.basename(src) + ' (tools/i18n) – nicht von Hand ändern. */\n' + code;
    results.push([out, code]);
  }
  for (const { src, out } of HTML_SOURCES) {
    let html = translateHtml(readSrc(src), dict, missing);
    html = html.replace('<html lang="de">', '<html lang="en">');
    html = html.replace('<script defer src="app/app.js?v=<?= $v ?>"></script>', '<script src="app/l10n.en.js?v=<?= $v ?>"></script>\n<script defer src="app/app.en.js?v=<?= $v ?>"></script>');
    if (!html.includes('app/app.en.js')) throw new Error('index.en.php: Skript-Verweis nicht gefunden');
    results.push([out, html]);
  }
  // Laufzeit-Wörterbuch für Meldungen, die vom Server kommen
  const msgs = {};
  for (const [v] of serverMessages()) if (dict[v]) msgs[v] = dict[v];
  results.push([L10N_OUT, '/* Automatisch erzeugt (tools/i18n): englische Fassung der Server-Meldungen. */\nwindow.PDFSTIFT_L10N = ' + JSON.stringify(msgs) + ';\n']);
  let stale = 0;
  for (const [out, content] of results) {
    const cur = fs.existsSync(R(out)) ? readSrc(out) : '';
    if (cur.replace(/\r\n/g, '\n') !== content.replace(/\r\n/g, '\n')) { // Windows-Zeilenenden zählen nicht
      stale++;
      if (!check) fs.writeFileSync(R(out), content);
    }
  }
  if (missing.size) console.log('noch ohne Übersetzung:', missing.size, [...missing].slice(0, process.env.ALL ? 999 : 15).map((x) => JSON.stringify(process.env.ALL ? x : x.slice(0, 60))).join(', '));
  if (check && stale) { console.error('Englische Dateien sind veraltet – bitte "node tools/i18n/i18n.js build" ausführen.'); process.exit(1); }
  console.log(check ? 'aktuell' : 'erzeugt', results.length, 'Dateien');
}

const cmd = process.argv[2];
if (cmd === 'extract') extract();
else if (cmd === 'build') build(false);
else if (cmd === 'check') build(true);
else if (cmd === 'prune') prune();
else console.log('node i18n.js extract|build|check');
