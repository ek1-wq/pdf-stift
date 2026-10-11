// Startdatei: wählt die Sprache der Programmfenster und Menüs (main.js = Deutsch, main.en.js = Englisch, aus tools/i18n erzeugt)
'use strict';
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
let ed = { edition: 'server', lang: 'de' };
try { ed = Object.assign(ed, JSON.parse(fs.readFileSync(path.join(__dirname, 'edition.json'), 'utf8'))); } catch (e) { /* eigene Ausgabe */ }
// freie Ausgabe: eigener Datenordner, damit sie neben der eigenen Ausgabe installiert sein kann
if (ed.edition === 'local') app.setPath('userData', path.join(app.getPath('appData'), 'pdf-stift'));
let lang = ed.lang;
try { const l = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'sprache.json'), 'utf8')).lang; if (l === 'de' || l === 'en') lang = l; } catch (e) { /* Standard */ }
global.PDFSTIFT = { edition: ed.edition, lang, repo: ed.repo || '' };
require(lang === 'en' && fs.existsSync(path.join(__dirname, 'main.en.js')) ? './main.en.js' : './main.js');
