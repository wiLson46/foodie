(function () {
'use strict';

const CFG = window.COMER_CONFIG || {};

// --- CONFIG & DATA ---
const CONFIG = {
    mainDataSheet: CFG.MAIN_DATA_SHEET,
    votesSheet: CFG.VOTES_SHEET,
    alfajoresSheet: CFG.ALFAJORES_SHEET,
    alfajoresVotesSheet: CFG.ALFAJORES_VOTES_SHEET,
    tabsData: {
        presencial: ['ranking', 'map'],
        delivery: ['ranking'],
        alfajores: ['ranking']
    }
};

const TRACKING_URL = CFG.TRACKING_URL;
const VOTE_FORM_URL = CFG.VOTE_FORM_URL || '';
const VOTE_FORM_URL_ALFAJOR = CFG.VOTE_FORM_URL_ALFAJOR || '';
const INITIAL_PHOTOS_LIMIT = CFG.INITIAL_PHOTOS_LIMIT || 6;
const DEBUG = !!CFG.DEBUG;

/**
 * Sends a tracking event silently (fire-and-forget) using sendBeacon.
 */
function trackEvent(event, restaurant) {
    if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') {
        return;
    }
    try {
        const body = { action: 'trackEvent', event };
        if (restaurant) body.restaurant = restaurant;
        const payload = JSON.stringify(body);
        if (navigator.sendBeacon) {
            const blob = new Blob([payload], { type: 'application/json' });
            navigator.sendBeacon(TRACKING_URL, blob);
        } else {
            fetch(TRACKING_URL, {
                method: 'POST',
                body: payload,
                redirect: 'follow',
                headers: { 'Content-Type': 'application/json' },
                keepalive: true
            }).catch(() => {});
        }
    } catch (e) {
        console.warn('[Tracking] Error:', e.message || e);
    }
}

// --- PERFORMANCE: Debounced Lucide icon rendering ---
let _lucideTimer = null;
function debouncedCreateIcons() {
    if (_lucideTimer) clearTimeout(_lucideTimer);
    _lucideTimer = setTimeout(() => {
        if (window.lucide) lucide.createIcons();
        _lucideTimer = null;
    }, 50);
}

let mapLoaded = false;

const MOCK_DATA = [
    { rank: 1, name: "Pujol", rating: "9.8", description: "Cocina mexicana de autor en las manos de Enrique Olvera.", location: "CDMX, México" },
    { rank: 2, name: "Central", rating: "9.7", description: "Exploración de ecosistemas peruanos por Virgilio Martínez.", location: "Lima, Perú" },
    { rank: 3, name: "DiverXO", rating: "9.6", description: "Vanguardia extrema de Dabiz Muñoz en Madrid.", location: "Madrid, España" },
    { rank: 4, name: "Oteque", rating: "9.5", description: "Minimalismo y elegancia en Río de Janeiro.", location: "Río, Brasil" }
];

// --- APP STATE ---
let allRestaurants = [];
let restaurants = [];
let filteredRestaurants = [];

let currentSort = 'score';
let currentMode = 'presencial';
let currentLocation = 'all';
let publicVotes = {};

// --- ALFAJORES STATE ---
let allAlfajores = [];
let alfajoresLoaded = false;
let publicVotesAlfajor = {};

// Original meta state (to restore when leaving detail)
const ORIGINAL_TITLE = document.title;
let originalDescription = '';

// Lightbox state
let lightboxPhotos = [];
let lightboxIndex = 0;
let lightboxPreviousFocus = null;
let lightboxTouchStartX = null;
let currentDetailRestaurantName = '';

// IntersectionObserver to pause/resume top-3 shimmer animation
let topShimmerObserver = null;

// --- DOM ELEMENTS (Cached) ---
let rankingList, homeView, detailView, restaurantContent, backBtn, header;
let settingsBtn, settingsMenu, darkModeToggle, lightbox, lightboxImg, lightboxClose;
let locationFilterContainer, locationFilter, sortFilter;

// --- UTILITIES ---

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function normalizeData(data) {
    const filtered = data.filter(row => Object.values(row).some(v => String(v).trim() !== ""));
    return filtered.map(row => {
        const standardRow = {};
        Object.keys(row).forEach(key => {
            standardRow[key.toLowerCase()] = row[key];
        });
        return standardRow;
    });
}

function isValidData(data) {
    if (!data || data.length === 0) return false;
    const firstRow = data[0];
    return !Object.keys(firstRow).some(k => k.includes('<!DOCTYPE') || k.includes('<html'));
}

function fetchSheet(url) {
    if (url.includes('/edit')) {
        url = url.replace(/\/edit.*$/, '/export?format=csv');
    }

    return new Promise((resolve, reject) => {
        Papa.parse(url, {
            download: true,
            header: true,
            worker: true,
            complete: (results) => {
                if (results.errors?.length > 0 && DEBUG) {
                    console.warn('[FetchSheet] Errores de parseo:', results.errors.slice(0, 3));
                }
                const normalized = normalizeData(results.data || []);
                resolve(normalized);
            },
            error: (err) => {
                console.error('[FetchSheet] Error descargando CSV:', url, err);
                reject(err);
            }
        });
    });
}

function showErrorBanner(message, retry) {
    if (!rankingList) return;
    rankingList.innerHTML = `
        <div class="error-banner" role="alert" style="text-align:center; padding:2rem; color:var(--text-muted);">
            <p style="font-weight:600; margin-bottom:1rem;">${escapeHtml(message)}</p>
            <button type="button" class="error-retry-btn" style="padding:0.6rem 1.5rem; border:2px solid var(--border); border-radius:10px; background:var(--card-bg); color:var(--text-main); font-weight:600; cursor:pointer;">
                Reintentar
            </button>
        </div>
    `;
    const btn = rankingList.querySelector('.error-retry-btn');
    if (btn && retry) btn.addEventListener('click', retry);
}

async function fetchData() {
    try {
        const [mainData, votesData] = await Promise.all([
            fetchSheet(CONFIG.mainDataSheet),
            fetchSheet(CONFIG.votesSheet).catch(() => [])
        ]);

        scheduleIdle(() => processVotes(votesData));

        if (isValidData(mainData)) {
            const hasName = Object.keys(mainData[0]).some(k => k === 'name' || k === 'nombre');
            if (hasName) {
                const firstRowKeys = Object.keys(mainData[0]);
                const criticNames = firstRowKeys
                    .filter(k => k.endsWith(' rating'))
                    .map(k => k.replace(' rating', '').trim());

                allRestaurants = mainData.map((r, index) => {
                    const critics = {};
                    criticNames.forEach(critic => {
                        if (r[`${critic} rating`]) {
                            critics[critic] = {
                                rating: r[`${critic} rating`],
                                comida: r[`${critic} comida`],
                                lugar: r[`${critic} lugar`],
                                atencion: r[`${critic} atencion`],
                                presentacion: r[`${critic} presentacion`],
                                precio: r[`${critic} precio`]
                            };
                        }
                    });

                    return {
                        ...r,
                        name: r.name || r.nombre,
                        rating: r.rating || r.promedio || r.score || '0',
                        rank: r.ranking || r.rank || index + 1,
                        description: r.description || r.descripcion || '',
                        orderedBy: r['pedido por'] || r.pedido_por || '',
                        presencialDelivery: (r['presencial delivery'] || '').toUpperCase(),
                        critics: critics
                    };
                });
            } else {
                allRestaurants = MOCK_DATA.map(m => ({ ...m, presencialDelivery: 'P', critics: {} }));
            }
        } else {
            allRestaurants = MOCK_DATA.map(m => ({ ...m, presencialDelivery: 'P', critics: {} }));
        }
    } catch (err) {
        console.error('[FetchData] Error:', err);
        showErrorBanner('No pudimos cargar los datos. Revisá tu conexión.', () => {
            renderSkeleton();
            fetchData();
        });
        return;
    }

    await filterByMode();
    handleRouteChange();
}

/**
 * Carga (lazy, una sola vez) el ranking de alfajores desde su propio CSV.
 * Mapea las 4 dimensiones (relleno, tapas, armonía, presentación) por crítico.
 */
async function fetchAlfajores() {
    if (alfajoresLoaded) return;
    try {
        const [alfData, votesData] = await Promise.all([
            fetchSheet(CONFIG.alfajoresSheet),
            CONFIG.alfajoresVotesSheet ? fetchSheet(CONFIG.alfajoresVotesSheet).catch(() => []) : Promise.resolve([])
        ]);

        publicVotesAlfajor = buildVotes(votesData, 'alfajor a votar');

        if (isValidData(alfData)) {
            const firstRowKeys = Object.keys(alfData[0]);
            const criticNames = firstRowKeys
                .filter(k => k.endsWith(' rating'))
                .map(k => k.replace(' rating', '').trim());

            allAlfajores = alfData
                .filter(r => (r.name || r.nombre || '').trim() !== '')
                .map((r, index) => {
                    const critics = {};
                    criticNames.forEach(critic => {
                        if (r[`${critic} rating`]) {
                            critics[critic] = {
                                rating: r[`${critic} rating`],
                                relleno: r[`${critic} relleno`],
                                tapas: r[`${critic} tapas`],
                                armonia: r[`${critic} armonia`],
                                presentacion: r[`${critic} presentacion`]
                            };
                        }
                    });
                    return {
                        ...r,
                        name: r.name || r.nombre,
                        rating: r.rating || r.promedio || r.score || '0',
                        rank: r.ranking || r.rank || index + 1,
                        description: r.description || r.descripcion || '',
                        web: r.web || '',
                        fotos: r.fotos || '',
                        isAlfajor: true,
                        critics: critics
                    };
                });
        } else {
            allAlfajores = [];
        }
    } catch (err) {
        console.error('[FetchAlfajores] Error:', err);
        allAlfajores = [];
    }
    alfajoresLoaded = true;
}

function scheduleIdle(fn) {
    if ('requestIdleCallback' in window) {
        requestIdleCallback(fn, { timeout: 1000 });
    } else {
        setTimeout(fn, 0);
    }
}

function buildVotes(votesData, nameKey) {
    const store = {};
    if (!votesData || votesData.length === 0) return store;
    votesData.forEach(v => {
        const name = (v[nameKey] || '').trim().toLowerCase();
        const score = parseFloat(v['puntuar']);
        if (name && !isNaN(score)) {
            if (!store[name]) store[name] = { total: 0, count: 0 };
            store[name].total += score;
            store[name].count++;
        }
    });
    Object.keys(store).forEach(key => {
        store[key].avg = (store[key].total / store[key].count).toFixed(1);
    });
    return store;
}

function processVotes(votesData) {
    publicVotes = buildVotes(votesData, 'lugar a votar');
}

async function filterByMode() {
    if (currentMode === 'alfajores') {
        await fetchAlfajores();
        restaurants = allAlfajores.slice();
        currentLocation = 'all';
        applyLocationFilter(); // alfajor no tiene ubicación → sin populateLocationFilter
        return;
    }

    if (currentMode === 'presencial') {
        restaurants = allRestaurants.filter(r => r.presencialDelivery === 'P');
    } else {
        restaurants = allRestaurants.filter(r => r.presencialDelivery === 'D' || r.presencialDelivery === 'L');
    }

    populateLocationFilter();
    applyLocationFilter();
}

function applyLocationFilter() {
    if (currentLocation === 'all') {
        filteredRestaurants = [...restaurants];
    } else {
        filteredRestaurants = restaurants.filter(res => (res.location || 'Sin ubicación') === currentLocation);
    }
    applySort();
    renderRanking();
}

function populateLocationFilter() {
    if (!locationFilter) return;

    const locations = new Set();
    restaurants.forEach(res => {
        const location = res.location || 'Sin ubicación';
        if (location) locations.add(location);
    });

    const frag = document.createDocumentFragment();
    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = 'Todas las ubicaciones';
    frag.appendChild(allOpt);

    Array.from(locations).sort().forEach(location => {
        const option = document.createElement('option');
        option.value = location;
        option.textContent = location;
        frag.appendChild(option);
    });

    locationFilter.replaceChildren(frag);

    // Restore selection if matches
    if (currentLocation && Array.from(locationFilter.options).some(o => o.value === currentLocation)) {
        locationFilter.value = currentLocation;
    } else {
        currentLocation = 'all';
        locationFilter.value = 'all';
    }
}

function filterByLocation(selectedLocation) {
    currentLocation = selectedLocation;
    applyLocationFilter();
    syncFiltersToUrl();
}

function parseDate(dateStr) {
    if (!dateStr) return new Date(0);
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    }
    return new Date(0);
}

function applySort() {
    filteredRestaurants.sort((a, b) => {
        if (currentSort === 'score') {
            const scoreA = parseFloat(a.rating) || 0;
            const scoreB = parseFloat(b.rating) || 0;
            return scoreB - scoreA;
        } else if (currentSort === 'date') {
            const dateA = parseDate(a.date || a.fecha);
            const dateB = parseDate(b.date || b.fecha);
            return dateB - dateA;
        } else if (currentSort === 'name') {
            return (a.name || '').localeCompare(b.name || '');
        }
        return 0;
    });
}

function getMedalClass(rank) {
    if (rank === 1) return 'top-1';
    if (rank === 2) return 'top-2';
    if (rank === 3) return 'top-3';
    return '';
}

function renderSkeleton() {
    if (!rankingList) return;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 8; i++) {
        const sk = document.createElement('div');
        sk.className = 'ranking-item-skeleton';
        sk.setAttribute('aria-hidden', 'true');
        frag.appendChild(sk);
    }
    rankingList.replaceChildren(frag);
}

function renderRanking() {
    if (!rankingList) return;
    const dataToRender = filteredRestaurants.length > 0 ? filteredRestaurants : restaurants;

    if (dataToRender.length === 0) {
        const emptyMsg = currentMode === 'alfajores'
            ? 'Todavía no hay alfajores cargados.'
            : 'No se encontraron restaurantes para esta ubicación.';
        rankingList.innerHTML = `<div style="text-align:center; padding:3rem; color:var(--text-muted);">${emptyMsg}</div>`;
        return;
    }

    const frag = document.createDocumentFragment();

    dataToRender.forEach((res, i) => {
        const item = document.createElement('div');
        const rank = parseInt(res.rank || i + 1);
        const medalClass = getMedalClass(rank);
        const visitDate = res.date || res.fecha || '';
        const rating = res.rating || '0';
        const safeName = escapeHtml(res.name);
        const safeLocation = escapeHtml(res.location || 'Luxury');
        const safeDate = escapeHtml(visitDate);
        const safeRating = escapeHtml(rating);

        item.className = `ranking-item ${medalClass}`;
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '0');
        item.setAttribute('aria-label', `Ver detalle de ${res.name || ''}`);
        item.innerHTML = `
            <div class="rank-number">${rank}</div>
            <div class="restaurant-info">
                <div class="restaurant-name-row">
                    <h3 class="restaurant-name">${safeName}</h3>
                    ${visitDate ? `
                    <div class="ranking-date-box">
                        <div class="date-label">VISITADO EL</div>
                        <div class="date-value">${safeDate}</div>
                    </div>` : ''}
                </div>
                ${currentMode === 'alfajores' ? '' : `<p class="restaurant-location">${safeLocation}</p>`}
            </div>
            <div class="score-box">
                <div class="score-label">Puntaje</div>
                <div class="score-value">${safeRating}</div>
            </div>
            <i data-lucide="arrow-right-circle" aria-hidden="true"></i>
        `;
        const handler = () => showDetail(res);
        item.addEventListener('click', handler);
        item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handler();
            }
        });
        frag.appendChild(item);
    });

    rankingList.replaceChildren(frag);
    debouncedCreateIcons();

    const MAX_ANIMATED = 8;
    const allItems = rankingList.querySelectorAll('.ranking-item');
    const animatedItems = Array.from(allItems).slice(0, MAX_ANIMATED);
    const instantItems = Array.from(allItems).slice(MAX_ANIMATED);

    if (animatedItems.length > 0 && window.gsap) {
        gsap.to(animatedItems, { opacity: 1, y: 0, stagger: 0.08, duration: 0.5, ease: "power4.out" });
    }
    if (instantItems.length > 0 && window.gsap) {
        gsap.set(instantItems, { opacity: 1, y: 0 });
    }

    setupTopShimmerObserver();
}

function setupTopShimmerObserver() {
    if (!('IntersectionObserver' in window)) return;
    if (topShimmerObserver) topShimmerObserver.disconnect();

    topShimmerObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            entry.target.classList.toggle('shimmer-active', entry.isIntersecting);
        });
    }, { threshold: 0.1 });

    rankingList.querySelectorAll('.top-1, .top-2, .top-3').forEach((el) => {
        topShimmerObserver.observe(el);
    });
}

// --- DETAIL VIEW HELPERS ---

function getThumbnailUrl(originalUrl) {
    if (!originalUrl) return originalUrl;
    let thumb = originalUrl.replace(/\/fotos\//, '/fotos_thumb/').replace(/\bfotos\//, 'fotos_thumb/');
    thumb = thumb.replace(/\.(jpeg|jpg|png|webp)$/i, '.jpg');
    return thumb;
}

function generatePhotosGalleryHTML(photosString) {
    if (!photosString || !photosString.trim()) {
        return `
            <div style="margin-top:1.5rem; padding:2rem; text-align:center; color:var(--text-muted);">
                <i data-lucide="image-off" style="width:48px; height:48px; margin:0 auto 1rem; opacity:0.3;"></i>
                <p style="font-size:1rem;">No hay fotos para este evento</p>
            </div>
        `;
    }

    const photos = photosString.split(';').map(url => url.trim()).filter(url => url.length > 0);
    const initialPhotos = photos.slice(0, INITIAL_PHOTOS_LIMIT);
    const remainingPhotos = photos.slice(INITIAL_PHOTOS_LIMIT);
    const hasMore = remainingPhotos.length > 0;
    const total = photos.length;
    const initialCount = initialPhotos.length;

    return `
        <div class="gallery" id="photo-gallery" style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; margin-top:1.5rem;">
            ${initialPhotos.map(img => `
                <div class="gallery-img-wrapper">
                    <img data-src="${escapeHtml(getThumbnailUrl(img))}" data-full="${escapeHtml(img)}" class="gallery-img gallery-lazy" decoding="async" loading="lazy" width="400" height="400" alt="Foto del restaurante" style="width:100%; height:100%; object-fit:cover; cursor:pointer;">
                </div>
            `).join('')}
        </div>
        <div class="gallery-progress" id="gallery-progress" style="text-align:center; margin-top:0.75rem; color:var(--text-muted); font-size:0.85rem; font-family:var(--font-body);">${initialCount} de ${total} ${total === 1 ? 'foto' : 'fotos'}</div>
        ${hasMore ? `
        <div id="gallery-more-container" style="text-align:center; margin-top:1rem;">
            <button id="gallery-show-more" type="button" style="padding:0.6rem 1.5rem; border:2px solid var(--border); border-radius:10px; background:var(--card-bg); color:var(--text-main); font-family:var(--font-title); font-weight:600; font-size:0.85rem; cursor:pointer; transition:all 0.3s ease;">
                Ver ${remainingPhotos.length} foto${remainingPhotos.length > 1 ? 's' : ''} más
            </button>
        </div>
        <template id="remaining-photos-data" data-photos='${escapeHtml(JSON.stringify(remainingPhotos))}'></template>
        ` : ''}
    `;
}

let galleryObserver = null;
let galleryLoadQueue = [];
let galleryLoadTimer = null;

function processGalleryQueue() {
    if (galleryLoadQueue.length === 0) {
        galleryLoadTimer = null;
        return;
    }

    const img = galleryLoadQueue.shift();
    const src = img.getAttribute('data-src');
    if (!src) {
        processGalleryQueue();
        return;
    }

    img.src = src;
    img.removeAttribute('data-src');
    img.style.opacity = '1';

    img.addEventListener('load', () => {
        requestAnimationFrame(() => {
            img.classList.add('loaded');
            const wrapper = img.closest('.gallery-img-wrapper');
            if (wrapper) wrapper.classList.add('loaded');
        });
    }, { once: true });

    if (img.complete && img.naturalWidth > 0) {
        img.classList.add('loaded');
        const wrapper = img.closest('.gallery-img-wrapper');
        if (wrapper) wrapper.classList.add('loaded');
    }

    galleryLoadTimer = setTimeout(processGalleryQueue, 150);
}

function setupGalleryObserver() {
    if (galleryObserver) {
        galleryObserver.disconnect();
        galleryObserver = null;
    }
    if (galleryLoadTimer) {
        clearTimeout(galleryLoadTimer);
        galleryLoadTimer = null;
    }
    galleryLoadQueue = [];

    const lazyImages = document.querySelectorAll('.gallery-lazy:not(.loaded)');
    if (lazyImages.length === 0) return;

    if ('IntersectionObserver' in window) {
        galleryObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    galleryLoadQueue.push(entry.target);
                    galleryObserver.unobserve(entry.target);
                }
            });
            if (galleryLoadQueue.length > 0 && !galleryLoadTimer) {
                processGalleryQueue();
            }
        }, { rootMargin: '200px', threshold: 0.01 });

        lazyImages.forEach(img => galleryObserver.observe(img));
    } else {
        lazyImages.forEach(img => {
            img.src = img.getAttribute('data-src');
            img.removeAttribute('data-src');
            img.style.opacity = '1';
            img.classList.add('loaded');
            const wrapper = img.closest('.gallery-img-wrapper');
            if (wrapper) wrapper.classList.add('loaded');
        });
    }
}

function setupGalleryClickDelegation() {
    const gallery = document.getElementById('photo-gallery');
    if (gallery) {
        gallery.addEventListener('click', (e) => {
            const img = e.target.closest('.gallery-img');
            if (img && img.dataset.full) openLightbox(img.dataset.full);
        });
    }
    const moreBtn = document.getElementById('gallery-show-more');
    if (moreBtn) {
        moreBtn.addEventListener('click', showMorePhotos);
    }
}

function showMorePhotos() {
    const template = document.getElementById('remaining-photos-data');
    const gallery = document.getElementById('photo-gallery');
    const moreContainer = document.getElementById('gallery-more-container');
    const progress = document.getElementById('gallery-progress');

    if (!template || !gallery) return;

    try {
        const remainingPhotos = JSON.parse(template.getAttribute('data-photos') || '[]');
        const frag = document.createDocumentFragment();

        remainingPhotos.forEach(img => {
            const wrapper = document.createElement('div');
            wrapper.className = 'gallery-img-wrapper';

            const imgEl = document.createElement('img');
            imgEl.setAttribute('data-src', getThumbnailUrl(img));
            imgEl.dataset.full = img;
            imgEl.className = 'gallery-img gallery-lazy';
            imgEl.decoding = 'async';
            imgEl.loading = 'lazy';
            imgEl.width = 400;
            imgEl.height = 400;
            imgEl.alt = 'Foto del restaurante';
            imgEl.style.cssText = 'width:100%; height:100%; object-fit:cover; cursor:pointer;';

            wrapper.appendChild(imgEl);
            frag.appendChild(wrapper);
        });

        gallery.appendChild(frag);

        if (moreContainer) moreContainer.remove();
        template.remove();

        if (progress) {
            const total = gallery.querySelectorAll('.gallery-img').length;
            progress.textContent = `${total} de ${total} ${total === 1 ? 'foto' : 'fotos'}`;
        }

        setupGalleryObserver();

    } catch (e) {
        console.warn('[Gallery] Error loading more photos:', e);
    }
}
window.showMorePhotos = showMorePhotos;

function generateScoresTableHTML(res) {
    if (!res.critics || Object.keys(res.critics).length === 0) {
        return `
            <div style="padding:2rem; text-align:center; color:var(--text-muted);">
                <p style="font-size:0.9rem;">No hay detalles de puntajes para este lugar.</p>
            </div>
        `;
    }

    const criticNames = Object.keys(res.critics);
    let rowsHtml = '';
    const isDelivery = res.presencialDelivery === 'D' || res.presencialDelivery === 'L';

    criticNames.forEach(critic => {
        const criticRes = res.critics[critic];
        const avg = criticRes.rating || '-';
        const food = criticRes.comida || '-';

        let col3, col4;
        if (isDelivery) {
            col3 = criticRes.presentacion || '-';
            col4 = criticRes.precio || '-';
        } else {
            col3 = criticRes.lugar || '-';
            col4 = criticRes.atencion || '-';
        }

        rowsHtml += `
            <tr class="score-row">
                <td class="col-critic">${escapeHtml(critic)}</td>
                <td class="col-score col-avg">${escapeHtml(avg)}</td>
                <td class="col-score">${escapeHtml(food)}</td>
                <td class="col-score">${escapeHtml(col3)}</td>
                <td class="col-score">${escapeHtml(col4)}</td>
            </tr>
        `;
    });

    return `
        <table class="scores-table">
            <thead>
                <tr class="score-header-row">
                    <th style="text-align:left;">Crítico</th>
                    <th>Prom.</th>
                    <th><i data-lucide="utensils" class="header-icon" aria-hidden="true"></i> Comida</th>
                    ${isDelivery ?
            `<th><i data-lucide="box" class="header-icon" aria-hidden="true"></i> Presentación</th>
                     <th><i data-lucide="dollar-sign" class="header-icon" aria-hidden="true"></i> Precio</th>` :
            `<th><i data-lucide="armchair" class="header-icon" aria-hidden="true"></i> Lugar</th>
                     <th><i data-lucide="thumbs-up" class="header-icon" aria-hidden="true"></i> Atención</th>`
        }
                </tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>
    `;
}

function generateAlfajorScoresTableHTML(res) {
    if (!res.critics || Object.keys(res.critics).length === 0) {
        return `
            <div style="padding:2rem; text-align:center; color:var(--text-muted);">
                <p style="font-size:0.9rem;">No hay detalles de puntajes para este alfajor.</p>
            </div>
        `;
    }

    const criticNames = Object.keys(res.critics);
    let rowsHtml = '';

    criticNames.forEach(critic => {
        const c = res.critics[critic];
        rowsHtml += `
            <tr class="score-row">
                <td class="col-critic">${escapeHtml(critic)}</td>
                <td class="col-score col-avg">${escapeHtml(c.rating || '-')}</td>
                <td class="col-score">${escapeHtml(c.relleno || '-')}</td>
                <td class="col-score">${escapeHtml(c.tapas || '-')}</td>
                <td class="col-score">${escapeHtml(c.armonia || '-')}</td>
                <td class="col-score">${escapeHtml(c.presentacion || '-')}</td>
            </tr>
        `;
    });

    return `
        <table class="scores-table">
            <thead>
                <tr class="score-header-row">
                    <th style="text-align:left;">Crítico</th>
                    <th>Prom.</th>
                    <th><i data-lucide="cookie" class="header-icon" aria-hidden="true"></i> Relleno</th>
                    <th><i data-lucide="layers" class="header-icon" aria-hidden="true"></i> Tapas</th>
                    <th><i data-lucide="heart" class="header-icon" aria-hidden="true"></i> Armonía</th>
                    <th><i data-lucide="image" class="header-icon" aria-hidden="true"></i> Present.</th>
                </tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>
    `;
}

function getRestaurantSlug(name) {
    if (!name) return '';
    return String(name).toLowerCase()
        .normalize('NFD')
        .replace(new RegExp('[̀-ͯ]', 'g'), '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function findRestaurantBySlug(slug) {
    return restaurants.find(r => getRestaurantSlug(r.name) === slug)
        || allRestaurants.find(r => getRestaurantSlug(r.name) === slug)
        || allAlfajores.find(r => getRestaurantSlug(r.name) === slug);
}

function setMeta(name, content, isProperty) {
    const attr = isProperty ? 'property' : 'name';
    let el = document.querySelector(`meta[${attr}="${name}"]`);
    if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, name);
        document.head.appendChild(el);
    }
    el.setAttribute('content', content);
}

function updateMetaForDetail(res) {
    const title = `${res.name || ''} — Comer.ar`;
    document.title = title;
    const desc = (res.description || res.location || ORIGINAL_TITLE).slice(0, 155);
    setMeta('description', desc);
    setMeta('og:title', title, true);
    setMeta('og:description', desc, true);
    setMeta('og:type', 'restaurant.restaurant', true);
    setMeta('og:url', window.location.href, true);
    setMeta('twitter:title', title);
    setMeta('twitter:description', desc);

    // JSON-LD Restaurant schema
    let ldEl = document.getElementById('restaurant-jsonld');
    if (!ldEl) {
        ldEl = document.createElement('script');
        ldEl.type = 'application/ld+json';
        ldEl.id = 'restaurant-jsonld';
        document.head.appendChild(ldEl);
    }
    const ld = {
        '@context': 'https://schema.org',
        '@type': 'Restaurant',
        name: res.name || '',
        description: res.description || '',
        address: res.address || res.direccion || '',
        telephone: res.phone || res.telefono || '',
        aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: res.rating || '0',
            bestRating: '10',
            ratingCount: 1
        }
    };
    ldEl.textContent = JSON.stringify(ld);
}

function restoreOriginalMeta() {
    document.title = ORIGINAL_TITLE;
    setMeta('description', originalDescription);
    setMeta('og:title', ORIGINAL_TITLE, true);
    setMeta('og:description', originalDescription, true);
    setMeta('og:type', 'website', true);
    setMeta('og:url', window.location.origin + window.location.pathname, true);
    const ldEl = document.getElementById('restaurant-jsonld');
    if (ldEl) ldEl.remove();
}

function showDetail(res, updateUrl = true) {
    if (updateUrl) {
        trackEvent('detail_view', res.name);
    }

    const slug = getRestaurantSlug(res.name);
    if (updateUrl) {
        try {
            history.pushState({ slug }, '', '?r=' + encodeURIComponent(slug));
        } catch (e) {
            window.location.hash = '#restaurant/' + slug;
            return;
        }
    }

    currentDetailRestaurantName = res.name || '';
    updateMetaForDetail(res);

    const visitDate = res.date || res.fecha || '';
    const rating = res.rating || '0';
    const rank = parseInt(res.rank || 0);
    const medalClass = getMedalClass(rank);

    const address = res.address || res.direccion || '';
    const phone = res.phone || res.telefono || '';
    const instagram = res.instagram || '';
    const mapLink = res['link mapa'] || res.link_mapa || res.google_maps || '';
    const orderedBy = res.orderedBy || '';

    const instagramLink = instagram ? `https://instagram.com/${instagram.replace('@', '').replace('https://instagram.com/', '')}` : '';

    const photosString = res.fotos || res.images || res.photos || '';

    const isAlf = !!res.isAlfajor;
    const voteKey = (res.name || '').trim().toLowerCase();
    const votesStore = isAlf ? publicVotesAlfajor : publicVotes;
    const voteData = votesStore[voteKey];
    const publicScore = voteData ? voteData.avg : '-';
    const voteCount = voteData ? voteData.count : 0;
    const voteFormUrl = isAlf ? VOTE_FORM_URL_ALFAJOR : VOTE_FORM_URL;

    // Web del alfajor (normalizada con protocolo)
    const webUrl = res.web || '';
    const webHref = webUrl ? (/^https?:\/\//i.test(webUrl) ? webUrl : 'https://' + webUrl) : '';

    const safeName = escapeHtml(res.name);
    const safeLocation = escapeHtml(res.location || 'Global Selection');
    const safeDescription = escapeHtml(res.description || '');
    const safeRating = escapeHtml(rating);
    const safeDate = escapeHtml(visitDate);
    const safeAddress = escapeHtml(address);
    const safePhone = escapeHtml(phone);
    const safeMapLink = escapeHtml(mapLink);
    const safeInstagramLink = escapeHtml(instagramLink);
    const safeOrderedBy = escapeHtml(orderedBy);
    const safePublic = escapeHtml(publicScore);

    const infoListHtml = isAlf
        ? (webHref
            ? `<a href="${escapeHtml(webHref)}" target="_blank" rel="noopener" class="info-item active link">
                    <i data-lucide="globe" aria-hidden="true"></i>
                    <span>Ver la web del alfajor</span>
                </a>`
            : `<div class="info-item inactive">
                    <i data-lucide="globe" aria-hidden="true"></i>
                    <span>Web no disponible</span>
                </div>`)
        : `
            <div class="info-item ${address ? 'active' : 'inactive'}">
                <i data-lucide="map-pin" aria-hidden="true"></i>
                <span>${safeAddress || 'Dirección no disponible'}</span>
            </div>

            <div class="info-item ${phone ? 'active' : 'inactive'}">
                <i data-lucide="phone" aria-hidden="true"></i>
                <span>${safePhone || 'Teléfono no disponible'}</span>
            </div>

            ${instagramLink ?
                `<a href="${safeInstagramLink}" target="_blank" rel="noopener" class="info-item active link">
                    <i data-lucide="instagram" aria-hidden="true"></i>
                    <span>Ver el IG del local</span>
                </a>` :
                `<div class="info-item inactive">
                    <i data-lucide="instagram" aria-hidden="true"></i>
                    <span>Ver el IG del local</span>
                </div>`}

            ${(mapLink && res.presencialDelivery === 'P') ?
                `<a href="${safeMapLink}" target="_blank" rel="noopener" class="info-item active link">
                    <i data-lucide="map" aria-hidden="true"></i>
                    <span>Ir al local</span>
                </a>` :
                (res.presencialDelivery === 'P' ? `<div class="info-item inactive">
                    <i data-lucide="map" aria-hidden="true"></i>
                    <span>Ir al local</span>
                </div>` : '')}

            ${orderedBy ?
                `<div class="info-item active">
                    <i data-lucide="shopping-bag" aria-hidden="true"></i>
                    <span>Pedido por: <strong>${safeOrderedBy}</strong></span>
                </div>` : ''}
        `;

    restaurantContent.innerHTML = `
        <div class="detail-header">
            <div class="detail-header-grid">
                <div class="detail-rank ${medalClass}">${rank > 0 ? rank : '-'}</div>
                <h1 class="detail-title">${safeName}</h1>
                ${visitDate ? `<div class="detail-date-box">
                    <div class="date-label">VISITADO EL</div>
                    <div class="date-value">${safeDate}</div>
                </div>` : ''}

                <div class="scores-wrapper">
                    <div class="detail-score-box">
                        <div class="score-label">Puntaje de Comer.ar</div>
                        <div class="score-value">${safeRating}</div>
                    </div>

                    <div class="detail-score-box public-score-box">
                        <div class="score-label">Puntaje del Público</div>
                        <div class="score-value-row">
                            <div class="score-value">${safePublic}</div>
                            <div class="votes-pill">${voteCount} ${voteCount === 1 ? 'voto' : 'votos'}</div>
                        </div>
                    </div>

                    ${voteFormUrl ? `<button class="vote-btn" type="button" id="vote-btn">
                        <i data-lucide="star" aria-hidden="true"></i>
                        <span>Votá acá</span>
                    </button>` : ''}
                </div>

                ${isAlf ? '' : `<p class="detail-location">${safeLocation}</p>`}

                <div class="detail-description">
                    <p>${safeDescription}</p>
                </div>
            </div>
        </div>

        <div class="detail-info-list">
            ${infoListHtml}
        </div>

        <div class="detail-tabs-container">
            <div class="sub-tabs">
                <button class="sub-tab-btn active" type="button" data-subtab="fotos">Fotos</button>
                <button class="sub-tab-btn" type="button" data-subtab="puntajes">Puntajes</button>
            </div>

            <div id="fotos-content" class="sub-tab-content">
                ${generatePhotosGalleryHTML(photosString)}
            </div>

            <div id="puntajes-content" class="sub-tab-content hidden">
                <div class="scores-table-container">
                    ${isAlf ? generateAlfajorScoresTableHTML(res) : generateScoresTableHTML(res)}
                </div>
            </div>
        </div>
    `;

    const voteBtn = document.getElementById('vote-btn');
    if (voteBtn && voteFormUrl) {
        voteBtn.addEventListener('click', () => {
            window.open(voteFormUrl, '_blank', 'noopener');
        });
    }

    debouncedCreateIcons();
    setupSubTabs();
    setupGalleryObserver();
    setupGalleryClickDelegation();

    if (window.gsap) {
        const tl = gsap.timeline();
        tl.to(homeView, {
            opacity: 0, duration: 0.3, onComplete: () => {
                homeView.classList.add('hidden');
                detailView.classList.remove('hidden');
                gsap.fromTo('.detail-container', { opacity: 0 }, { opacity: 1, duration: 0.5 });
            }
        });
    } else {
        homeView.classList.add('hidden');
        detailView.classList.remove('hidden');
    }
}

function setupSubTabs() {
    document.querySelectorAll('.sub-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const target = btn.getAttribute('data-subtab');
            document.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.sub-tab-content').forEach(content => content.classList.add('hidden'));
            document.getElementById(`${target}-content`).classList.remove('hidden');
        });
    });
}

function toggleHome(updateUrl = true) {
    if (window.gsap) {
        const tl = gsap.timeline();
        tl.to('.detail-container', {
            opacity: 0, duration: 0.3, onComplete: () => {
                detailView.classList.add('hidden');
                homeView.classList.remove('hidden');
            }
        });
        tl.to(homeView, { opacity: 1, duration: 0.4 });
    } else {
        detailView.classList.add('hidden');
        homeView.classList.remove('hidden');
    }

    restoreOriginalMeta();
    currentDetailRestaurantName = '';

    if (updateUrl) {
        try {
            const url = new URL(window.location.href);
            url.search = syncFiltersToParams(new URLSearchParams()).toString();
            const queryString = url.search;
            history.pushState({}, '', window.location.pathname + queryString + '');
        } catch (e) {
            if (window.location.hash) {
                history.pushState('', document.title, window.location.pathname + window.location.search);
            }
        }
    }
}

// --- ROUTING ---

function syncFiltersToParams(params) {
    if (currentMode && currentMode !== 'presencial') params.set('mode', currentMode);
    else params.delete('mode');
    if (currentSort && currentSort !== 'score') params.set('sort', currentSort);
    else params.delete('sort');
    if (currentLocation && currentLocation !== 'all') params.set('location', currentLocation);
    else params.delete('location');
    return params;
}

function syncFiltersToUrl() {
    try {
        const params = new URLSearchParams(window.location.search);
        // Preserve r= if present (detail view)
        const r = params.get('r');
        params.delete('mode'); params.delete('sort'); params.delete('location');
        syncFiltersToParams(params);
        if (r) params.set('r', r);
        const qs = params.toString();
        const newUrl = window.location.pathname + (qs ? '?' + qs : '');
        history.replaceState(history.state, '', newUrl);
    } catch (e) {}
}

function readFiltersFromUrl() {
    try {
        const params = new URLSearchParams(window.location.search);
        const m = params.get('mode');
        const s = params.get('sort');
        const l = params.get('location');
        if (m === 'presencial' || m === 'delivery' || m === 'alfajores') currentMode = m;
        if (s === 'score' || s === 'date' || s === 'name') currentSort = s;
        if (l) currentLocation = l;
    } catch (e) {}
}

function handleRouteChange() {
    let slug = '';
    try {
        const params = new URLSearchParams(window.location.search);
        slug = params.get('r') || '';
    } catch (e) {}
    if (!slug) {
        const hash = window.location.hash.slice(1);
        if (hash.startsWith('restaurant/')) slug = hash.replace('restaurant/', '');
    }

    if (slug) {
        const restaurant = findRestaurantBySlug(slug);
        if (restaurant) {
            showDetail(restaurant, false);
        } else if (allRestaurants.length > 0) {
            toggleHome(false);
        }
    } else {
        if (!detailView.classList.contains('hidden')) {
            toggleHome(false);
        }
    }
}

// --- TAB MANAGEMENT ---

function setupMainTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-tab');

            if (target === 'ranking') {
                setTimeout(() => {
                    locationFilterContainer.classList.add('show');
                    debouncedCreateIcons();
                }, 100);
            } else {
                locationFilterContainer.classList.remove('show');
            }

            if (target === 'map' && !mapLoaded) {
                const mapContainer = document.getElementById('map-container');
                if (mapContainer) {
                    mapContainer.innerHTML = `
                        <div class="map-loader" id="map-loader" style="text-align:center; padding:2rem; color:var(--text-muted);">Cargando mapa…</div>
                        <iframe
                            src="https://www.google.com/maps/d/embed?mid=1rViUskbYtl1mWekFkuBO6AQdzEsOI20&ehbc=2E312F&noprof=1"
                            width="100%" height="450" style="border:0; border-radius:16px;" loading="lazy" allowfullscreen
                            referrerpolicy="no-referrer-when-downgrade" title="Mapa de ubicación de restaurantes"></iframe>
                    `;
                    const iframe = mapContainer.querySelector('iframe');
                    const loader = mapContainer.querySelector('#map-loader');
                    if (iframe && loader) {
                        iframe.addEventListener('load', () => loader.remove(), { once: true });
                    }
                    mapLoaded = true;
                }
            }

            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            tabContents.forEach(content => content.classList.add('hidden'));
            document.getElementById(`${target}-view`).classList.remove('hidden');
        });
    });
}

// --- LIGHTBOX ---

function openLightbox(src) {
    if (!lightbox || !lightboxImg) return;

    const galleryImgs = Array.from(document.querySelectorAll('.gallery-img'));
    lightboxPhotos = galleryImgs.map(img => img.dataset.full).filter(Boolean);
    lightboxIndex = Math.max(0, lightboxPhotos.indexOf(src));
    if (lightboxIndex < 0) {
        lightboxPhotos = [src];
        lightboxIndex = 0;
    }

    lightboxImg.src = src;
    lightboxImg.alt = (currentDetailRestaurantName || 'Foto del restaurante') + ' — foto';
    lightbox.classList.add('visible');
    lightboxPreviousFocus = document.activeElement;
    if (lightboxClose) lightboxClose.focus();
}
window.openLightbox = openLightbox;

function closeLightbox() {
    if (!lightbox) return;
    lightbox.classList.remove('visible');
    setTimeout(() => {
        if (lightboxImg) lightboxImg.src = '';
    }, 300);
    if (lightboxPreviousFocus && typeof lightboxPreviousFocus.focus === 'function') {
        try { lightboxPreviousFocus.focus(); } catch (e) {}
    }
}
window.closeLightbox = closeLightbox;

function showNextPhoto(delta) {
    if (lightboxPhotos.length === 0) return;
    lightboxIndex = (lightboxIndex + delta + lightboxPhotos.length) % lightboxPhotos.length;
    lightboxImg.src = lightboxPhotos[lightboxIndex];
}

function setupLightbox() {
    if (lightbox) {
        lightbox.addEventListener('click', (e) => {
            if (e.target === lightbox) closeLightbox();
        });
        // Swipe support
        lightbox.addEventListener('touchstart', (e) => {
            if (e.touches && e.touches.length === 1) {
                lightboxTouchStartX = e.touches[0].clientX;
            }
        }, { passive: true });
        lightbox.addEventListener('touchend', (e) => {
            if (lightboxTouchStartX === null) return;
            const endX = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientX : null;
            if (endX !== null) {
                const dx = endX - lightboxTouchStartX;
                if (Math.abs(dx) > 50) {
                    showNextPhoto(dx < 0 ? 1 : -1);
                }
            }
            lightboxTouchStartX = null;
        });
    }

    if (lightboxClose) {
        lightboxClose.addEventListener('click', closeLightbox);
    }

    document.addEventListener('keydown', (e) => {
        if (!lightbox || !lightbox.classList.contains('visible')) return;
        if (e.key === 'Escape') closeLightbox();
        else if (e.key === 'ArrowRight') showNextPhoto(1);
        else if (e.key === 'ArrowLeft') showNextPhoto(-1);
        else if (e.key === 'Tab') {
            // Trap focus inside lightbox
            e.preventDefault();
            if (lightboxClose) lightboxClose.focus();
        }
    });
}

// --- SETTINGS ---

function setupSettings() {
    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsMenu.classList.toggle('hidden');
        const expanded = settingsBtn.getAttribute('aria-expanded') === 'true';
        settingsBtn.setAttribute('aria-expanded', String(!expanded));
    });

    document.addEventListener('click', () => {
        settingsMenu.classList.add('hidden');
        settingsBtn.setAttribute('aria-expanded', 'false');
    });
    settingsMenu.addEventListener('click', (e) => e.stopPropagation());

    // Sync dark mode persisted state
    const isDark = localStorage.getItem('darkMode') === 'true';
    if (isDark) {
        document.body.classList.remove('light-mode');
        document.body.classList.add('dark-mode');
        if (darkModeToggle) darkModeToggle.checked = true;
    }

    if (darkModeToggle) {
        darkModeToggle.addEventListener('change', () => {
            const checked = darkModeToggle.checked;
            document.body.classList.toggle('dark-mode', checked);
            document.body.classList.toggle('light-mode', !checked);
            localStorage.setItem('darkMode', String(checked));
        });
    }
}

// --- INITIALIZATION ---

function cacheDOMElements() {
    rankingList = document.getElementById('ranking-list');
    homeView = document.getElementById('home');
    detailView = document.getElementById('detail');
    restaurantContent = document.getElementById('restaurant-content');
    backBtn = document.getElementById('back-btn');
    header = document.querySelector('.header');
    settingsBtn = document.getElementById('settings-btn');
    settingsMenu = document.getElementById('settings-menu');
    darkModeToggle = document.getElementById('dark-mode-toggle');
    lightbox = document.getElementById('lightbox');
    lightboxImg = document.getElementById('lightbox-img');
    lightboxClose = document.getElementById('lightbox-close');
    locationFilterContainer = document.getElementById('location-filter-container');
    locationFilter = document.getElementById('location-filter');
    sortFilter = document.getElementById('sort-filter');
}

function setupFilters() {
    if (locationFilter) {
        locationFilter.addEventListener('change', (e) => {
            filterByLocation(e.target.value);
        });
    }

    if (sortFilter) {
        sortFilter.addEventListener('change', (e) => {
            currentSort = e.target.value;
            applySort();
            renderRanking();
            syncFiltersToUrl();
        });
    }
}

function updateChromeForMode() {
    // En modo alfajores ocultamos el filtro de ubicación (los alfajores no tienen ubicación).
    const locGroup = locationFilter ? locationFilter.closest('.filter-group') : null;
    if (locGroup) locGroup.style.display = (currentMode === 'alfajores') ? 'none' : '';
}

function setupModeSwitcher() {
    const modeBtns = document.querySelectorAll('.mode-btn');

    modeBtns.forEach(btn => {
        btn.addEventListener('click', async () => {
            const newMode = btn.getAttribute('data-mode');
            if (newMode === currentMode) return;

            currentMode = newMode;
            currentLocation = 'all';

            modeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const activeTabsForMode = CONFIG.tabsData[currentMode] || ['ranking'];
            const tabs = document.querySelectorAll('.tab-btn');
            tabs.forEach(tab => {
                const tabId = tab.getAttribute('data-tab');
                tab.style.display = activeTabsForMode.includes(tabId) ? 'flex' : 'none';
            });

            const activeTab = document.querySelector('.tab-btn.active');
            if (activeTab && activeTab.style.display === 'none') {
                document.querySelector('.tab-btn[data-tab="ranking"]').click();
            }

            updateChromeForMode();

            // Skeleton mientras carga el CSV de alfajores la primera vez
            if (currentMode === 'alfajores' && !alfajoresLoaded) renderSkeleton();

            await filterByMode();
            syncFiltersToUrl();
        });
    });
}

function applyInitialFiltersUI() {
    if (sortFilter) sortFilter.value = currentSort;
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-mode') === currentMode);
    });
    const activeTabsForMode = CONFIG.tabsData[currentMode] || ['ranking'];
    document.querySelectorAll('.tab-btn').forEach(tab => {
        const tabId = tab.getAttribute('data-tab');
        tab.style.display = activeTabsForMode.includes(tabId) ? 'flex' : 'none';
    });

    updateChromeForMode();
}

function registerServiceWorker() {
    if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js').catch(() => {});
        });
    }
}

function initApp() {
    cacheDOMElements();

    // Capture original meta description for restoration later
    const metaDesc = document.querySelector('meta[name="description"]');
    originalDescription = metaDesc ? metaDesc.getAttribute('content') || '' : '';

    if (window.gsap) {
        gsap.from('.header', { opacity: 0, y: 30, duration: 1, ease: "expo.out" });
    }

    readFiltersFromUrl();
    applyInitialFiltersUI();

    setupMainTabs();
    setupSettings();
    setupLightbox();
    setupModeSwitcher();
    setupFilters();

    backBtn.addEventListener('click', () => toggleHome(true));

    window.addEventListener('popstate', handleRouteChange);
    window.addEventListener('hashchange', handleRouteChange);

    setTimeout(() => {
        const activeTab = document.querySelector('.tab-btn.active');
        if (activeTab && activeTab.getAttribute('data-tab') === 'ranking') {
            locationFilterContainer.classList.add('show');
            debouncedCreateIcons();
        }
    }, 100);

    renderSkeleton();
    fetchData();

    trackEvent('pageview');

    registerServiceWorker();
}

document.addEventListener('DOMContentLoaded', initApp);

})();
