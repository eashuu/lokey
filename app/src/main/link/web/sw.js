// Lokey Link service worker: caches only the static shell so the app opens offline; API calls are never cached.
const C = 'lokey-link-v1', SHELL = ['/', '/app.js', '/manifest.webmanifest', '/icon.svg']
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())))
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim())))
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url)
  if (e.request.method !== 'GET' || !SHELL.includes(u.pathname)) return
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(C).then(c => c.put(e.request, copy)); return r }).catch(() => caches.match(e.request)))
})
