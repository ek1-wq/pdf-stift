// Freie Ausgabe: PDF-Stift arbeitet nur auf diesem PC. Ein mitgelieferter PHP-Server (nur für 127.0.0.1)
// stellt dieselbe Oberfläche bereit wie pdf-stift.example.org – die Bibliothek ist ein normaler Ordner.
'use strict';
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');

const KEY = crypto.randomBytes(24).toString('hex');
let proc = null;
let port = 0;

const res = (...p) => (app.isPackaged ? path.join(process.resourcesPath, ...p) : path.join(__dirname, ...p));
const phpExe = () => res('php', process.platform === 'win32' ? 'php.exe' : 'php');
// Oberfläche und PHP-Teil: im installierten Programm unter resources/web, beim Entwickeln daneben
function webRoot() {
  const c = app.isPackaged ? [path.join(process.resourcesPath, 'web')] : [path.join(__dirname, 'web'), path.join(__dirname, '..', 'app'), path.join(__dirname, '..', 'server')];
  return c.find((d) => fs.existsSync(path.join(d, 'api.php'))) || c[0];
}
const dataDir = () => path.join(app.getPath('userData'), 'data');
const cfgFile = () => path.join(app.getPath('userData'), 'bibliothek.json');

function libraryDir() {
  try { const d = JSON.parse(fs.readFileSync(cfgFile(), 'utf8')).dir; if (d) return d; } catch (e) { /* Standard */ }
  return path.join(docsDir(), 'PDF-Stift');
}
// im Snap-Paket zeigt „documents“ in den versteckten Snap-Ordner – dann den echten Dokumente-Ordner nehmen
function docsDir() {
  const h = process.env.SNAP_REAL_HOME;
  if (!h) return app.getPath('documents');
  for (const n of ['Dokumente', 'Documents']) { const d = path.join(h, n); if (fs.existsSync(d)) return d; }
  return h;
}
function setLibraryDir(dir) { fs.writeFileSync(cfgFile(), JSON.stringify({ dir })); }

function tryPort(p) {
  return new Promise((ok) => {
    const s = net.createServer();
    s.once('error', () => ok(false));
    s.once('listening', () => s.close(() => ok(true)));
    s.listen(p, '127.0.0.1');
  });
}
// immer derselbe Port, damit Einstellungen im Fenster (an die Adresse gebunden) erhalten bleiben
async function pickPort() {
  const f = path.join(app.getPath('userData'), 'port.json');
  let pref = 38517;
  try { pref = JSON.parse(fs.readFileSync(f, 'utf8')).port || pref; } catch (e) { /* */ }
  for (let p = pref; p < pref + 40; p++) {
    if (await tryPort(p)) { if (p !== pref) try { fs.writeFileSync(f, JSON.stringify({ port: p })); } catch (e) { /* */ } return p; }
  }
  throw new Error('Kein freier Port gefunden.');
}

async function waitReady(base) {
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    try { const r = await fetch(base + 'api.php?a=me', { headers: { 'X-PDFStift-Local': KEY } }); if (r.ok) return; } catch (e) { /* startet noch */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Der interne Server antwortet nicht.');
}

/** startet den Server und liefert die Adresse, z. B. http://127.0.0.1:38517/ */
async function start(lang, log) {
  port = await pickPort();
  const lib = libraryDir();
  fs.mkdirSync(lib, { recursive: true });
  fs.mkdirSync(dataDir(), { recursive: true });
  const ini = res('php', 'php.ini');
  const args = ['-S', `127.0.0.1:${port}`, '-t', webRoot()];
  if (fs.existsSync(ini)) args.unshift('-c', ini, '-d', 'extension_dir=' + path.join(path.dirname(phpExe()), 'ext'));
  proc = spawn(phpExe(), args, {
    cwd: webRoot(), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PDFSTIFT_LOCAL_KEY: KEY, PDFSTIFT_DATA: dataDir(), PDFSTIFT_LIBRARY: lib, PDFSTIFT_LANG: lang || 'en' },
  });
  let err = '';
  proc.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
  proc.on('exit', (code) => { if (log) log('PHP beendet: ' + code + ' ' + err.slice(-500)); proc = null; });
  const base = `http://127.0.0.1:${port}/`;
  await waitReady(base);
  return base;
}
function stop() { if (proc) try { proc.kill(); } catch (e) { /* */ } proc = null; }
app.on('will-quit', stop);

/** schickt bei jeder Anfrage an den internen Server den Schlüssel mit (nur dieses Programm kommt hinein) */
function attach(ses) {
  ses.webRequest.onBeforeSendHeaders({ urls: [`http://127.0.0.1:${port}/*`] }, (d, cb) => {
    d.requestHeaders['X-PDFStift-Local'] = KEY;
    cb({ requestHeaders: d.requestHeaders });
  });
}

module.exports = { start, stop, attach, libraryDir, setLibraryDir, KEY };
