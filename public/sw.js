const CACHE = 'bongly-docscan-v4'
const APP_SHELL = ['/', '/manifest.webmanifest', '/logo.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      for (const asset of APP_SHELL) {
        try {
          await cache.add(asset)
        } catch {
          // A single unavailable asset must not prevent the PWA installing.
        }
      }
    }),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('bongly-docscan-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/_next/image') ||
    /\.(?:js|css|woff2?|ttf|otf|png|jpg|jpeg|svg|webp|ico|webmanifest)$/.test(
      url.pathname,
    )
  )
}

async function cacheResponse(request, response) {
  if (!response || !response.ok) return response
  const cache = await caches.open(CACHE)
  await cache.put(request, response.clone())
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached ||
        fetch(request)
          .then((response) => cacheResponse(request, response))
          .catch(() => caches.match('/logo.png')),
      ),
    )
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => cacheResponse(request, response))
        .catch(async () => {
          const cached = await caches.match(request)
          return cached || caches.match('/')
        }),
    )
    return
  }

  event.respondWith(
    fetch(request)
      .then((response) => cacheResponse(request, response))
      .catch(() => caches.match(request)),
  )
})
