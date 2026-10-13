/* PDF-Stift Service Worker: hält die App selbst offline bereit. PDFs und Notizen liegen in IndexedDB. */
const VERSION = '1.67.2';
const CACHE = 'pdfstift-' + VERSION;
const SHELL = [
  './',
  'app/app.css?v=' + VERSION,
  'app/app.js?v=' + VERSION,
  'app/app.en.js?v=' + VERSION,
  'app/l10n.en.js?v=' + VERSION,
  'vendor/pdfjs/pdf.min.js?v=' + VERSION,
  'vendor/pdfjs/pdf.worker.min.js?v=' + VERSION,
  'vendor/pdf-lib.min.js?v=' + VERSION,
  'vendor/qrcode.js?v=' + VERSION,
  'vendor/fflate.min.js?v=' + VERSION,
  'vendor/pptxgen.bundle.js?v=' + VERSION,
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/favicon.svg',
  'icons/favicon-32.png',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pdfstift-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/api.php')) return; // Daten nie aus dem Cache – die App regelt offline selbst

  if (url.pathname.endsWith('/live.php') || url.pathname.includes('/app/live')) return; // Live-Mitschau: immer direkt vom Server

  if (req.mode === 'navigate') {
    // Seite: immer frisch vom Server, offline die gespeicherte Fassung (nur die App selbst wird gespeichert)
    // Die App selbst kommt sofort aus dem Speicher des Geräts (neue Versionen bringt der Service Worker beim Update mit),
    // im Hintergrund wird die gespeicherte Fassung aufgefrischt.
    const isShell = /\/(index\.php)?$/.test(url.pathname) && !url.search;
    const net = fetch(req).then((r) => {
      if (r.ok && isShell) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('./', copy)); }
      return r;
    });
    if (!isShell) { e.respondWith(net.catch(() => caches.match('./'))); return; }
    e.respondWith(caches.match('./').then((hit) => {
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
      return net.catch(() => caches.match('./'));
    }));
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return r;
    }))
  );
});
