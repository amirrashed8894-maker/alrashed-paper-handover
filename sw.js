/* تسليم أصول ورق — service worker: يشتغل أوفلاين. الصفحة نفسها network-first عشان التحديثات توصل فورًا. */
const CACHE = 'paper-handover-v1.1.1';
const SHELL = ['./', 'index.html', 'app.css?v=1.0.0', 'config.js?v=1.0.0', 'auth-gate.js?v=8', 'imgproc.js?v=1.0.0', 'app.js?v=1.1.0', 'pdf-share.js?v=1', 'pdfjs/pdf.min.js?v=3.11.174', 'pdfjs/pdf.worker.min.js?v=3.11.174', 'manifest.webmanifest',
  'brand/alrashed_header.png', 'brand/alrashed_footer.png', 'brand/alrashed_logo.jpg', 'icon-192.png', 'icon-180.png', 'fonts/cairo-arabic.woff2', 'fonts/cairo-latin.woff2', 'fonts/cairo-latin-ext.woff2'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('paper-handover-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // السحابة وسيرفر الدخول: من غير كاش
  if (u.pathname.includes('/loading/')) return; // شيك ليست التحميل: صفحة مستقلة، خارج كاش البرنامج
  if (e.request.mode === 'navigate') { e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put('index.html', cp)); return r; }).catch(() => caches.match('index.html'))); return; }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); } return r; })));
});
