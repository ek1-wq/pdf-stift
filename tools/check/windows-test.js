// Check of the installed Windows app: start it and test the main functions (Playwright drives Electron)
const { _electron } = require('playwright');
const fs = require('fs'), path = require('path');
const [exe, docx, pptx, out] = process.argv.slice(2);
const log = (...a) => { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); console.log(s); fs.appendFileSync(path.join(out, 'test.txt'), s + '\n'); };
(async () => {
  const t0 = Date.now();
  const app = await _electron.launch({ executablePath: exe, timeout: 180000 });
  const win = await app.firstWindow({ timeout: 180000 });
  win.on('pageerror', (e) => log('SEITENFEHLER', e.message));
  await win.waitForLoadState('load');
  await win.waitForTimeout(12000);
  log('Start bis Fenster bereit (s):', Math.round((Date.now() - t0) / 1000));
  await win.screenshot({ path: path.join(out, '1-start.png') });
  const tabs = await win.evaluate(() => [...document.querySelectorAll('.tab, [data-tab-path]')].map((t) => t.textContent.trim().slice(0, 50)));
  log('Reiter beim Start:', tabs);
  log('Kurzanleitung offen:', tabs.some((t) => /Quick guide|Kurzanleitung/.test(t)));
  // Word-Datei hochladen → mit LibreOffice zu PDF
  let t1 = Date.now();
  try {
    await win.evaluate(() => document.querySelector('#btnUpload').click()); await win.waitForTimeout(800);
    await win.setInputFiles('#upFiles', docx);
    await win.click('#upGo');
    let found = null;
    for (let i = 0; i < 90 && !found; i++) {
      await win.waitForTimeout(2000);
      const lib = await win.evaluate(async () => { const r = await fetch('api.php?a=list', { headers: { 'X-PDFStift': '1' } }); return r.ok ? r.json() : null; });
      found = lib && (lib.files || []).find((f) => /brief/i.test(f.path || f.name || ''));
    }
    log('Word → PDF:', found ? 'ok – ' + (found.path || found.name) : 'NICHT gefunden', Math.round((Date.now() - t1) / 1000), 's');
  } catch (e) { log('Word → PDF Fehler:', e.message); }
  await win.screenshot({ path: path.join(out, '2-word.png') });
  // PowerPoint übernehmen und „Folie als Bild“ (Umwandlung der Original-Datei mit LibreOffice)
  t1 = Date.now();
  try {
    const b64 = fs.readFileSync(pptx).toString('base64');
    const r = await win.evaluate(async (b64) => {
      while (!window.PDFSTIFT_CORE) await new Promise((r) => setTimeout(r, 100));
      await window.PDFSTIFT_CORE.pptx();
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const { deck, warn } = await window.PDFSTIFT_PPTX.importPptx(new File([bin], 'test.pptx'), null);
      const out = { folien: deck.slides.length, warn, src: deck.src || null };
      if (deck.src) {
        const t = Date.now();
        const rr = await fetch('api.php?a=pptxpdf&src=' + deck.src, { headers: { 'X-PDFStift': '1' } });
        out.pptxpdf = rr.status; out.ms = Date.now() - t;
        if (rr.ok) { const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await rr.arrayBuffer()) }).promise; out.seiten = pdf.numPages; }
        else out.fehler = await rr.text();
      }
      return out;
    }, b64);
    log('PowerPoint / Folie als Bild:', r, Math.round((Date.now() - t1) / 1000), 's');
  } catch (e) { log('PowerPoint Fehler:', e.message); }
  await win.screenshot({ path: path.join(out, '3-ende.png') });
  await app.close();
  log('fertig');
})().catch((e) => { log('ABBRUCH', e.message); process.exit(1); });
