// Gemeinsame Helfer für die Übersetzung: Kandidaten finden (Extraktion) und ersetzen (Build)
'use strict';
const acorn = require('acorn');
const walk = require('acorn-walk');

const SKIP_CALLEE = /^(\$|\$\$|querySelector|querySelectorAll|getElementById|closest|matches|addEventListener|removeEventListener|setAttribute|getAttribute|removeAttribute|hasAttribute|toggleAttribute|createElement|createElementNS|getItem|setItem|removeItem|ls|fetch|apiJson|api|DB\.get|DB\.put|DB\.del|postMessage|importScripts|require|createObjectStore|transaction|objectStore|open|track)$/;

// kurze deutsche Wörter, die allein in Ausdrücken wie (n === 1 ? 'wird' : 'werden') vorkommen
const DE_WORDS = new Set(['wird', 'werden', 'wartet', 'warten', 'kontrastreicher', 'ab', 'von', 'bis', 'und', 'oder', 'auf', 'mit', 'aus', 'neu', 'alle', 'keine', 'leer', 'ist', 'sind', 'hat', 'haben', 'fehlt', 'fehlen', 'bleibt', 'bleiben', 'läuft', 'laufen', 'gerade', 'noch', 'schon', 'immer', 'nie', 'heute', 'gestern', 'seite', 'seiten', 'datei', 'dateien', 'ordner', 'kopie', 'kopien', 'treffer', 'stelle', 'stellen', 'eine', 'einer', 'einen', 'einem', 'ein', 'der', 'die', 'das', 'den', 'dem', 'zu', 'im', 'in', 'an', 'am', 'vom', 'zum', 'zur']);
// sieht aus wie Text für Menschen (deutsch)?
function looksHuman(s) {
  if (!s || !/[A-Za-zÄÖÜäöüß]/.test(s)) return false;
  const t = s.trim().replace(/^&(?=[A-Za-zÄÖÜ])/, '');
  if (!t) return false;
  if (DE_WORDS.has(t)) return true;
  if (s !== s.trim() && /[A-Za-zÄÖÜäöüß]{3}/.test(t) && !/[<>{};=]/.test(t)) return true; // Satzstück wie 'heute ' oder ' (Teil '
  if (/^-[A-ZÄÖÜ][a-zäöüß]+/.test(t)) return true; // '-Ordner'
  if (/^\.\s+[A-ZÄÖÜ„]/.test(t)) return true; // '. Neu: '
  if (/^<[a-z]+[^>]*\b(title|aria-label|placeholder|alt)="[^"]*[A-Za-zÄÖÜäöü]{2}/.test(t)) return true; // Tag mit Text im Attribut
  if (/^(https?:|data:|blob:|#|\.|\/|[a-z-]+:[a-z]|[a-z]+\/[a-z]+$)/.test(t)) return false;
  if (/^[a-z0-9_.\-:\[\]=>#*\s,()"']+$/.test(t) && !/\s[a-zäöü]{3,}\s/.test(' ' + t + ' ') && !/[äöüß]/.test(t)) {
    // nur Kleinbuchstaben ohne Leerzeichen: Bezeichner, CSS-Klassen, Schlüssel
    if (!/\s/.test(t)) return false;
    if (/^[a-z-]+(\s+[a-z-]+)*$/.test(t) && t.split(/\s+/).every((w) => /-/.test(w) || w.length < 3 || /^(btn|icon|text|small|muted|primary|danger|ghost|on|off|row|col|active|hidden|sel|open|tab|card|chip|mini)$/.test(w))) return false;
  }
  if (/^<[a-z]+[^>]*>?$/.test(t)) return false;
  if (/^[\d\s.,:%+\-–×x/()]*$/.test(t)) return false;
  if (/^(px|em|rem|vh|vw|deg|ms|s)$/.test(t)) return false;
  return /[äöüßÄÖÜ]/.test(t) || /\s/.test(t) || /^[A-ZÄÖÜ][a-zäöüß]{2,}/.test(t) || /[A-ZÄÖÜ][a-zäöü]+[A-Z]/.test(t) === false && /^[A-ZÄÖÜ]/.test(t);
}

function calleeName(n) {
  if (!n) return '';
  if (n.type === 'Identifier') return n.name;
  if (n.type === 'MemberExpression') {
    const p = n.property && (n.property.name || n.property.value);
    const o = n.object && n.object.type === 'Identifier' ? n.object.name + '.' : '';
    return /^(DB)$/.test(o.slice(0, -1)) ? o + p : p;
  }
  return '';
}

/** Liefert alle Text-Stellen: {start,end,kind:'lit'|'tpl',value,quote,ctx} */
function scan(src) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, locations: true });
  const out = [];
  const skip = new Set();
  walk.fullAncestor(ast, (node, _st, anc) => {
    if (node.type !== 'Literal' && node.type !== 'TemplateElement') return;
    const parent = anc[anc.length - 2];
    let flag = '';
    if (node.type === 'Literal') {
      if (typeof node.value !== 'string') return;
      if (parent && parent.type === 'Property' && parent.key === node && !parent.computed) return;
      if (parent && (parent.type === 'ImportDeclaration' || parent.type === 'ExportNamedDeclaration')) return;
      if (parent && parent.type === 'MemberExpression' && parent.property === node) return;
      if (parent && parent.type === 'BinaryExpression' && /^[!=]==?$/.test(parent.operator)) flag = 'cmp';
      if (parent && parent.type === 'SwitchCase') flag = 'cmp';
      if (parent && parent.type === 'CallExpression' && parent.arguments[0] === node && SKIP_CALLEE.test(calleeName(parent.callee))) return;
      if (parent && parent.type === 'CallExpression' && /^(includes|indexOf|startsWith|endsWith|test)$/.test(calleeName(parent.callee))) flag = 'cmp';
      if (parent && parent.type === 'ArrayExpression') {
        const gp = anc[anc.length - 3];
        if (gp && gp.type === 'MemberExpression' && gp.object === parent) flag = flag || 'arr';
      }
      out.push({ start: node.start, end: node.end, kind: 'lit', value: node.value, raw: node.raw, line: node.loc.start.line, flag });
    } else {
      const tl = parent; // TemplateLiteral
      const gp = anc[anc.length - 3];
      if (gp && gp.type === 'TaggedTemplateExpression') return;
      if (gp && gp.type === 'CallExpression' && gp.arguments[0] === tl && SKIP_CALLEE.test(calleeName(gp.callee))) return;
      out.push({ start: node.start, end: node.end, kind: 'tpl', value: node.value.cooked, raw: node.value.raw, line: node.loc.start.line, flag: '' });
    }
  });
  return out.filter((o) => looksHuman(o.value)).sort((a, b) => a.start - b.start);
}

/** Textstücke ohne Buchstaben mit deutschen Anführungszeichen („ “), z. B. vor ${name} – fürs Englische umsetzen */
function scanQuotes(src) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
  const out = [];
  const re = /^[^A-Za-zÄÖÜäöüß]*[„“][^A-Za-zÄÖÜäöüß]*$/;
  walk.full(ast, (node) => {
    if (node.type === 'Literal' && typeof node.value === 'string' && re.test(node.value)) out.push({ start: node.start, end: node.end, kind: 'lit', value: node.value });
    if (node.type === 'TemplateElement' && re.test(node.value.cooked || '')) out.push({ start: node.start, end: node.end, kind: 'tpl', value: node.value.cooked });
  });
  return out;
}
const enQuotes = (s) => s.replace(/\u201C/g, '\u201D').replace(/\u201E/g, '\u201C'); // deutsch „…“ → englisch “…”

// Schlüssel im Wörterbuch: der Text selbst (Leerraum am Rand bleibt erhalten)
function encodeLit(s) { return JSON.stringify(s).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }
function encodeTpl(s) { return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${'); }

module.exports = { scan, scanQuotes, enQuotes, looksHuman, encodeLit, encodeTpl };
