/**
 * ═══════════════════════════════════════════════════════════
 * DEVCORE ULTRA — Service Worker
 * Handles caching, offline support, and background sync
 * Strategy: Cache First for assets, Network First for HTML
 * ═══════════════════════════════════════════════════════════
 */

'use strict';

/* ─── CACHE CONFIGURATION ─── */
const APP_NAME = 'devcore-ultra';
const CACHE_VERSION = 'v1.0.0';
const CACHE_NAME = `${APP_NAME}-${CACHE_VERSION}`;
const OFFLINE_CACHE = `${APP_NAME}-offline-${CACHE_VERSION}`;
const RUNTIME_CACHE = `${APP_NAME}-runtime-${CACHE_VERSION}`;

/* ─── FILES TO PRECACHE ON INSTALL ─── */
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-72.png',
  '/icons/icon-96.png',
  '/icons/icon-128.png',
  '/icons/icon-144.png',
  '/icons/icon-152.png',
  '/icons/icon-192.png',
  '/icons/icon-384.png',
  '/icons/icon-512.png',
];

/* ─── CACHE LIMITS ─── */
const RUNTIME_CACHE_LIMIT = 50;
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/* ─── INSTALL EVENT ─── */
/* Pre-cache all critical assets */
self.addEventListener('install', (event) => {
  console.log(`[Devcore SW] Installing cache: ${CACHE_NAME}`);

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Devcore SW] Pre-caching assets...');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => {
        console.log('[Devcore SW] Pre-cache complete');
        // Force activate immediately without waiting
        return self.skipWaiting();
      })
      .catch((err) => {
        console.error('[Devcore SW] Pre-cache failed:', err);
      })
  );
});

/* ─── ACTIVATE EVENT ─── */
/* Clean up old caches from previous versions */
self.addEventListener('activate', (event) => {
  console.log(`[Devcore SW] Activating: ${CACHE_NAME}`);

  const validCaches = [CACHE_NAME, OFFLINE_CACHE, RUNTIME_CACHE];

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => !validCaches.includes(name))
            .map((name) => {
              console.log(`[Devcore SW] Deleting old cache: ${name}`);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[Devcore SW] Activation complete. Claiming clients...');
        // Take control of all clients immediately
        return self.clients.claim();
      })
  );
});

/* ─── FETCH EVENT ─── */
/* Smart caching strategy based on request type */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension and non-http requests
  if (!url.protocol.startsWith('http')) return;

  // Skip analytics and external requests (none in this app, but future-proof)
  if (url.origin !== self.location.origin) return;

  /* Strategy selection */
  if (isHTMLRequest(request)) {
    // HTML: Network first, fall back to cache, then offline page
    event.respondWith(networkFirstStrategy(request));
  } else if (isStaticAsset(request)) {
    // Static assets: Cache first, fall back to network
    event.respondWith(cacheFirstStrategy(request));
  } else {
    // Everything else: Stale while revalidate
    event.respondWith(staleWhileRevalidate(request));
  }
});

/* ─── STRATEGY: Network First ─── */
async function networkFirstStrategy(request) {
  try {
    const networkResponse = await fetchWithTimeout(request, 5000);
    if (networkResponse && networkResponse.ok) {
      // Update cache with fresh response
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
      return networkResponse;
    }
    throw new Error('Network response not ok');
  } catch (err) {
    console.log('[Devcore SW] Network failed, trying cache:', request.url);
    const cached = await caches.match(request);
    if (cached) return cached;
    // Last resort: offline page
    return caches.match('/offline.html');
  }
}

/* ─── STRATEGY: Cache First ─── */
async function cacheFirstStrategy(request) {
  const cached = await caches.match(request);
  if (cached) {
    // Check if cache entry is still fresh
    const cacheDate = cached.headers.get('sw-cache-date');
    if (cacheDate) {
      const age = Date.now() - parseInt(cacheDate, 10);
      if (age < CACHE_EXPIRY_MS) {
        return cached;
      }
    } else {
      return cached;
    }
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      await cacheResponseWithDate(request, networkResponse.clone());
      return networkResponse;
    }
    return cached || networkResponse;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

/* ─── STRATEGY: Stale While Revalidate ─── */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  // Fetch fresh in background regardless
  const fetchPromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse && networkResponse.ok) {
        cache.put(request, networkResponse.clone());
        trimCache(RUNTIME_CACHE, RUNTIME_CACHE_LIMIT);
      }
      return networkResponse;
    })
    .catch(() => null);

  return cached || fetchPromise;
}

/* ─── HELPERS ─── */

function isHTMLRequest(request) {
  return request.headers.get('Accept')?.includes('text/html') ||
    request.url.endsWith('.html') ||
    request.url.endsWith('/');
}

function isStaticAsset(request) {
  const url = request.url;
  return (
    url.endsWith('.js') ||
    url.endsWith('.css') ||
    url.endsWith('.png') ||
    url.endsWith('.jpg') ||
    url.endsWith('.jpeg') ||
    url.endsWith('.svg') ||
    url.endsWith('.ico') ||
    url.endsWith('.woff') ||
    url.endsWith('.woff2') ||
    url.endsWith('.json')
  );
}

function fetchWithTimeout(request, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Fetch timeout'));
    }, timeout);

    fetch(request)
      .then((response) => {
        clearTimeout(timer);
        resolve(response);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function cacheResponseWithDate(request, response) {
  const cache = await caches.open(CACHE_NAME);
  // Clone and inject cache date header
  const headers = new Headers(response.headers);
  headers.append('sw-cache-date', Date.now().toString());
  const modifiedResponse = new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  await cache.put(request, modifiedResponse);
}

async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    // Delete oldest entries
    const deleteCount = keys.length - maxItems;
    for (let i = 0; i < deleteCount; i++) {
      await cache.delete(keys[i]);
    }
  }
}

/* ─── MESSAGE HANDLER ─── */
/* Receive messages from main app */
self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};

  switch (type) {

    /* Force cache clear */
    case 'CLEAR_CACHE':
      event.waitUntil(
        caches.keys().then((names) =>
          Promise.all(names.map((name) => caches.delete(name)))
        ).then(() => {
          event.ports[0]?.postMessage({ success: true, type: 'CACHE_CLEARED' });
        })
      );
      break;

    /* Skip waiting (activate new SW immediately) */
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    /* Get cache status */
    case 'GET_CACHE_STATUS':
      event.waitUntil(
        getCacheStatus().then((status) => {
          event.ports[0]?.postMessage({ success: true, type: 'CACHE_STATUS', payload: status });
        })
      );
      break;

    /* Prefetch specific URL */
    case 'PREFETCH':
      if (payload?.url) {
        event.waitUntil(
          caches.open(CACHE_NAME).then((cache) => cache.add(payload.url))
        );
      }
      break;

    default:
      console.log('[Devcore SW] Unknown message type:', type);
  }
});

/* ─── GET CACHE STATUS ─── */
async function getCacheStatus() {
  const cacheNames = await caches.keys();
  const status = {};

  for (const name of cacheNames) {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    status[name] = {
      entries: keys.length,
      urls: keys.map((r) => r.url),
    };
  }

  return {
    version: CACHE_VERSION,
    caches: status,
    timestamp: new Date().toISOString(),
  };
}

/* ─── PUSH NOTIFICATION HANDLER ─── */
/* Future-proof — no notifications in v1 but structure ready */
self.addEventListener('push', (event) => {
  console.log('[Devcore SW] Push received (not implemented in v1)');
});

/* ─── BACKGROUND SYNC ─── */
/* Future-proof structure */
self.addEventListener('sync', (event) => {
  console.log('[Devcore SW] Background sync:', event.tag);
});

console.log(`[Devcore SW] Service Worker loaded: ${CACHE_NAME}`);