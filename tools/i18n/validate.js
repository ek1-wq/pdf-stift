// node validate.js chunk.json chunk.en.json → prüft Vollständigkeit und Form der Übersetzung
const fs = require('fs');
const [inp, outp] = process.argv.slice(2);
const a = JSON.parse(fs.readFileSync(inp, 'utf8'));
let b;
try { b = JSON.parse(fs.readFileSync(outp, 'utf8')); } catch (e) { console.log('UNGÜLTIGES JSON: ' + e.message); process.exit(1); }
const errs = [];
const tags = (s) => (s.match(/<\/?[a-zA-Z][^>]*>/g) || []).map((t) => t.replace(/\s.*$/, '').replace(/>$/, '')).sort().join(',');
const braces = (s) => (s.match(/\{[a-zA-Z_]+\}/g) || []).sort().join(',');
for (const k of Object.keys(a)) {
  if (!(k in b)) { errs.push('FEHLT: ' + JSON.stringify(k).slice(0, 80)); continue; }
  const v = b[k];
  if (v === null) continue;
  if (typeof v !== 'string') { errs.push('KEIN TEXT: ' + k.slice(0, 60)); continue; }
  if (k.match(/^\s*/)[0] !== v.match(/^\s*/)[0]) errs.push('LEERZEICHEN VORNE: ' + JSON.stringify(k).slice(0, 60) + ' -> ' + JSON.stringify(v).slice(0, 60));
  if (k.match(/\s*$/)[0] !== v.match(/\s*$/)[0]) errs.push('LEERZEICHEN HINTEN: ' + JSON.stringify(k).slice(0, 60) + ' -> ' + JSON.stringify(v).slice(0, 60));
  if (tags(k) !== tags(v)) errs.push('HTML-TAGS ANDERS: ' + JSON.stringify(k).slice(0, 80));
  if (braces(k) !== braces(v)) errs.push('PLATZHALTER ANDERS: ' + JSON.stringify(k).slice(0, 80));
  if (/[äöüÄÖÜß]/.test(v) && !/[äöüÄÖÜß]/.test(k) === false && v === k) {}
}
for (const k of Object.keys(b)) if (!(k in a)) errs.push('ZUSÄTZLICH (Schlüssel verändert?): ' + JSON.stringify(k).slice(0, 80));
console.log(errs.length ? errs.join('\n') : 'OK ' + Object.keys(a).length);
process.exit(errs.length ? 1 : 0);
