// Ledger offline support. Asks GitHub for the newest copy first (bypassing the browser's 10-minute cache),
// so an update shows up on the next open. If the network is slow or offline it shows the saved copy instead
// and keeps downloading in the background, so the copy after that is fresh.
const C = 'ledger-v4';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const WAIT = 3000;   // how long to wait for the network before showing the saved copy
// the PDF reader is a fixed, versioned file, so it is safe to keep and lets statement import work offline.
// Must match PDFJS in index.html.
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/';

// If the download fails the install fails too, so the previous working version stays in charge
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x.startsWith('ledger-') && x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  if (r.url.startsWith(PDFJS)) {   // saved copy first; the version never changes
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => {
      if (res.ok || res.type === 'opaque') { const cp = res.clone(); e.waitUntil(caches.open(C).then(c => c.put(r, cp))); }
      return res;
    })));
    return;
  }
  if (new URL(r.url).origin !== location.origin) return;   // Google, Drive, the script and gold prices are never cached

  const nav = r.mode === 'navigate';
  let saving = Promise.resolve();
  const net = fetch(r, { cache: 'no-cache' }).then(res => {
    if (res.ok) { const cp = res.clone(); saving = caches.open(C).then(c => c.put(r, cp)); }
    return res;
  });
  e.waitUntil(net.then(() => saving, () => {}));   // let the background download finish saving
  // only pages fall back to the app; a missing image or file must not get index.html instead
  const saved = () => caches.match(r, nav ? { ignoreSearch: true } : undefined).then(m => m || (nav ? caches.match('./index.html') : undefined));

  e.respondWith(new Promise(done => {
    let sent = false;
    const send = x => { if (!sent) { sent = true; done(x); } };
    const t = setTimeout(() => saved().then(m => { if (m) send(m); }), WAIT);   // slow network: use the saved copy if there is one
    net.then(res => { clearTimeout(t); send(res); },
      () => { clearTimeout(t); saved().then(m => send(m || Response.error())); });
  }));
});
