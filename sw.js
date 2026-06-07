/**
 * Service Worker — Comer.ar
 * - Cache-first para assets estáticos (CSS, fonts, logos).
 * - Stale-while-revalidate para CSV de Google Sheets.
 * - Network-only para POST (tracking, submitReview, etc.).
 */
const CACHE_VERSION = 'comer-ar-v2';
const STATIC_CACHE = CACHE_VERSION + '-static';
const DYNAMIC_CACHE = CACHE_VERSION + '-dynamic';

const STATIC_ASSETS = [
    './',
    './index.html',
    './perfil.html',
    './style.css',
    './config.js',
    './auth.js',
    './vote.js',
    './main.js',
    './manifest.json',
    './fotos/imagenes/logoB.png',
    './fotos/imagenes/logoW.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => cache.addAll(STATIC_ASSETS).catch(() => {}))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((k) => k.startsWith('comer-ar-') && k !== STATIC_CACHE && k !== DYNAMIC_CACHE)
                    .map((k) => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    if (url.hostname.includes('docs.google.com') || url.hostname.includes('script.google.com')) {
        event.respondWith(staleWhileRevalidate(req));
        return;
    }

    if (url.origin === location.origin) {
        event.respondWith(cacheFirst(req));
        return;
    }

    if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com') || url.hostname.includes('cdnjs.cloudflare.com') || url.hostname.includes('unpkg.com') || url.hostname.includes('cdn.jsdelivr.net')) {
        event.respondWith(cacheFirst(req));
    }
});

function cacheFirst(req) {
    return caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
            if (res && res.status === 200) {
                const clone = res.clone();
                caches.open(STATIC_CACHE).then((cache) => cache.put(req, clone));
            }
            return res;
        }).catch(() => cached);
    });
}

function staleWhileRevalidate(req) {
    return caches.open(DYNAMIC_CACHE).then((cache) => {
        return cache.match(req).then((cached) => {
            const network = fetch(req).then((res) => {
                if (res && res.status === 200) cache.put(req, res.clone());
                return res;
            }).catch(() => cached);
            return cached || network;
        });
    });
}
