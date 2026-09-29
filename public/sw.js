// Versão do cache — mudar aqui força o navegador a descartar o cache
// antigo na próxima ativação.
const CACHE_NAME = 'mamacos-voip-v3'
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/favicon.png', '/logo.png', '/logo-192.png']
// Teto de itens no cache de runtime — sem isso o cache crescia pra
// sempre (cada build novo gera arquivos com hash diferente).
const MAX_RUNTIME_ENTRIES = 120

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

async function trimCache() {
  const cache = await caches.open(CACHE_NAME)
  const keys = await cache.keys()
  if (keys.length <= MAX_RUNTIME_ENTRIES) return
  await Promise.all(keys.slice(0, keys.length - MAX_RUNTIME_ENTRIES).map((key) => cache.delete(key)))
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }

  // SÓ o próprio site é cacheado. Antes, qualquer GET de outro domínio
  // que desse certo ia pro cache (respostas da API do GIPHY com a chave
  // na URL, imagens de preview de link de sites quaisquer, arquivos do
  // Storage do Supabase servidos por domínio próprio...) — e ficava lá
  // pra sempre, inclusive depois de sair da conta. Chamadas à API do
  // Supabase (auth, dados, Realtime) nunca passam por aqui.
  if (url.origin !== self.location.origin) return
  if (request.headers.has('range')) return

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')))
    return
  }

  // Só arquivos estáticos (assets com hash do build + ícones/manifest).
  const isStatic = url.pathname.startsWith('/assets/') || APP_SHELL.includes(url.pathname)
  if (!isStatic) return

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const clone = response.clone()
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(request, clone))
            .then(trimCache)
            .catch(() => {})
        }
        return response
      })
    })
  )
})
