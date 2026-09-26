const CACHE_NAME = 'mamacos-voip-v2'
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/favicon.png', '/logo.png', '/logo-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Nunca cachear chamadas à API do Supabase — precisam ser sempre
  // frescas (auth, dados em tempo real, RLS). Só o "app shell" (HTML/
  // JS/CSS estáticos) é cacheado.
  if (request.url.includes('supabase.co') || request.method !== 'GET') {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html'))
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
        }
        return response
      })
    })
  )
})
