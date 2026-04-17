
// --- CONFIG & DATA ---
const CONFIG = {
    mainDataSheet: 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv',
    votesSheet: 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv&gid=1795075061',
    tabsData: {
        presencial: ['ranking', 'map'],
        delivery: ['ranking']
    }
};

// --- TRACKING ---
const TRACKING_URL = 'https://script.google.com/macros/s/AKfycbxT0G-CwgaZgAZsKXdNgrMm5Bffl77ItglK_CtJyVYX1_OWeeI7Ze0eue1eO4fsujFw/exec';

/**
 * Sends a tracking event silently (fire-and-forget)
 */
function trackEvent(event, restaurant) {
    try {
        const body = { action: 'trackEvent', event };
        if (restaurant) body.restaurant = restaurant;
        console.log('[Tracking] Enviando evento:', JSON.stringify(body));
        fetch(TRACKING_URL, {
            method: 'POST',
            body: JSON.stringify(body),
            redirect: 'follow',
            headers: { 'Content-Type': 'text/plain' }
        })
        .then(res => {
            console.log('[Tracking] Respuesta:', res.status, res.statusText, 'URL:', res.url);
            return res.text();
        })
        .then(text => {
            console.log('[Tracking] Body respuesta:', text.substring(0, 200));
        })
        .catch(err => {
            console.warn('[Tracking] Error en fetch:', err.message || err);
        });
    } catch (e) {
        console.warn('[Tracking] Error general:', e.message || e);
    }
}

// --- PERFORMANCE: Debounced Lucide icon rendering ---
let _lucideTimer = null;
function debouncedCreateIcons() {
    if (_lucideTimer) clearTimeout(_lucideTimer);
    _lucideTimer = setTimeout(() => {
        lucide.createIcons();
        _lucideTimer = null;
    }, 50);
}

// Track if map has been loaded
let mapLoaded = false;

const MOCK_DATA = [
    { rank: 1, name: "Pujol", rating: "9.8", description: "Cocina mexicana de autor en las manos de Enrique Olvera.", location: "CDMX, México" },
    { rank: 2, name: "Central", rating: "9.7", description: "Exploración de ecosistemas peruanos por Virgilio Martínez.", location: "Lima, Perú" },
    { rank: 3, name: "DiverXO", rating: "9.6", description: "Vanguardia extrema de Dabiz Muñoz en Madrid.", location: "Madrid, España" },
    { rank: 4, name: "Oteque", rating: "9.5", description: "Minimalismo y elegancia en Río de Janeiro.", location: "Río, Brasil" }
];

// --- APP STATE ---
let allRestaurants = []; // Stores all fetched restaurants
let restaurants = []; // Restaurants filtered by currentMode
let filteredRestaurants = []; // Restaurants filtered by both mode and location

let currentSort = 'score'; // Default sort order
let currentMode = 'presencial'; // 'presencial' | 'delivery'
let publicVotes = {}; // { 'restaurant name (lowercase)': { avg: 8.5, count: 3 } }

// --- DOM ELEMENTS (Cached) ---
let rankingList, homeView, detailView, restaurantContent, backBtn, header;
let settingsBtn, settingsMenu, darkModeToggle, lightbox, lightboxImg, lightboxClose;
let locationFilterContainer, locationFilter, sortFilter;

// --- UTILITIES ---

/**
 * Normalizes CSV data keys to lowercase and filters empty rows
 */
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

/**
 * Checks if fetched data is valid (not a login page HTML)
 */
function isValidData(data) {
    if (!data || data.length === 0) return false;
    const firstRow = data[0];
    return !Object.keys(firstRow).some(k => k.includes('<!DOCTYPE') || k.includes('<html'));
}

/**
 * Fetches a single CSV sheet via Promise
 */
function fetchSheet(url) {
    // Auto-convert edit links if needed
    if (url.includes('/edit')) {
        url = url.replace(/\/edit.*$/, '/export?format=csv');
    }

    console.log('[FetchSheet] Descargando CSV desde:', url);

    return new Promise((resolve, reject) => {
        Papa.parse(url, {
            download: true,
            header: true,
            complete: (results) => {
                console.log('[FetchSheet] CSV parseado OK —', (results.data || []).length, 'filas, errores PapaParse:', results.errors?.length || 0);
                if (results.errors?.length > 0) {
                    console.warn('[FetchSheet] Errores de parseo:', results.errors.slice(0, 5));
                }
                const normalized = normalizeData(results.data || []);
                resolve(normalized);
            },
            error: (err) => {
                console.error('[FetchSheet] Error descargando CSV:', url, err);
                resolve([]); // Resolve with empty array to not break Promise.all
            }
        });
    });
}

/**
 * Fetches all data once and initializes the view
 */
async function fetchData() {
    // Show loading state
    rankingList.innerHTML = '<div class="loader">Cargando la selección...</div>';

    try {
        // Fetch main data and votes in parallel
        const [mainData, votesData] = await Promise.all([
            fetchSheet(CONFIG.mainDataSheet),
            fetchSheet(CONFIG.votesSheet)
        ]);

        // Process public votes
        publicVotes = {};
        if (votesData && votesData.length > 0) {
            console.log('[Votes] Procesando', votesData.length, 'votos públicos');
            votesData.forEach(v => {
                const name = (v['lugar a votar'] || '').trim().toLowerCase();
                const score = parseFloat(v['puntuar']);
                if (name && !isNaN(score)) {
                    if (!publicVotes[name]) {
                        publicVotes[name] = { total: 0, count: 0 };
                    }
                    publicVotes[name].total += score;
                    publicVotes[name].count++;
                }
            });
            // Calculate averages
            Object.keys(publicVotes).forEach(key => {
                publicVotes[key].avg = (publicVotes[key].total / publicVotes[key].count).toFixed(1);
            });
            console.log('[Votes] Votos procesados:', publicVotes);
        } else {
            console.log('[Votes] No se encontraron votos públicos');
        }

        if (isValidData(mainData)) {
            const hasName = Object.keys(mainData[0]).some(k => k === 'name' || k === 'nombre');
            if (hasName) {
                // Determine critics from headers
                const firstRowKeys = Object.keys(mainData[0]);
                const criticNames = firstRowKeys
                    .filter(k => k.endsWith(' rating'))
                    .map(k => k.replace(' rating', '').trim());

                allRestaurants = mainData.map((r, index) => {
                    // Extract critics data for this restaurant
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
                        rank: r.ranking || r.rank || index + 1, // Use ranking from data
                        description: r.description || r.descripcion || '',
                        orderedBy: r['pedido por'] || r.pedido_por || '',
                        presencialDelivery: (r['presencial delivery'] || '').toUpperCase(),
                        critics: critics
                    };
                });
            } else {
                console.warn("No 'name' column found, using MOCK_DATA");
                allRestaurants = MOCK_DATA.map(m => ({ ...m, presencialDelivery: 'P', critics: {} }));
            }
        } else {
            console.warn("Invalid or empty data, using MOCK_DATA");
            allRestaurants = MOCK_DATA.map(m => ({ ...m, presencialDelivery: 'P', critics: {} }));
        }

        console.log("Datos cargados:", { mode: currentMode, allRestaurants });
    } catch (err) {
        console.error('[FetchData] Error cargando datos del spreadsheet:', err);
        console.error('[FetchData] Stack:', err.stack);
        allRestaurants = MOCK_DATA.map(m => ({ ...m, presencialDelivery: 'P', critics: {} }));
    }

    // Filter by the current mode immediately
    filterByMode();

    // Handle hash navigation after data is loaded
    handleHashChange();
}

/**
 * Filters the master list by the current mode (presencial vs delivery)
 */
function filterByMode() {
    if (currentMode === 'presencial') {
        restaurants = allRestaurants.filter(r => r.presencialDelivery === 'P');
    } else {
        restaurants = allRestaurants.filter(r => r.presencialDelivery === 'D' || r.presencialDelivery === 'L');
    }

    filteredRestaurants = [...restaurants];
    populateLocationFilter();
    applySort(); // Apply sort resets filteredRestaurants based on new set
    renderRanking();
}

/**
 * Populates the location filter dropdown with unique locations
 */
function populateLocationFilter() {
    if (!locationFilter) return;

    // Extract unique locations
    const locations = new Set();
    restaurants.forEach(res => {
        const location = res.location || 'Sin ubicación';
        if (location) locations.add(location);
    });

    // Clear existing options except "All"
    locationFilter.innerHTML = '<option value="all">Todas las ubicaciones</option>';

    // Add unique locations
    Array.from(locations).sort().forEach(location => {
        const option = document.createElement('option');
        option.value = location;
        option.textContent = location;
        locationFilter.appendChild(option);
    });
}

/**
 * Filters restaurants by location
 */
function filterByLocation(selectedLocation) {
    if (selectedLocation === 'all') {
        filteredRestaurants = [...restaurants];
    } else {
        filteredRestaurants = restaurants.filter(res => {
            const location = res.location || 'Sin ubicación';
            return location === selectedLocation;
        });
    }
    applySort();
    renderRanking();
}

/**
 * Parses a date string in DD/MM/YYYY format
 */
function parseDate(dateStr) {
    if (!dateStr) return new Date(0);
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        // DD/MM/YYYY -> YYYY-MM-DD (ISO suitable for Date constructor)
        return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    }
    return new Date(0);
}

/**
 * Sorts the filtered restaurants based on current criteria
 */
function applySort() {
    filteredRestaurants.sort((a, b) => {
        if (currentSort === 'score') {
            const scoreA = parseFloat(a.rating) || 0;
            const scoreB = parseFloat(b.rating) || 0;
            return scoreB - scoreA; // Descending
        } else if (currentSort === 'date') {
            const dateA = parseDate(a.date || a.fecha);
            const dateB = parseDate(b.date || b.fecha);
            return dateB - dateA; // Newest first
        } else if (currentSort === 'name') {
            return (a.name || '').localeCompare(b.name || ''); // A-Z
        }
        return 0;
    });
}

/**
 * Gets medal class for top 3 rankings
 */
function getMedalClass(rank) {
    if (rank === 1) return 'top-1';
    if (rank === 2) return 'top-2';
    if (rank === 3) return 'top-3';
    return '';
}

/**
 * Renders the ranking list
 */
function renderRanking() {
    rankingList.innerHTML = '';
    const dataToRender = filteredRestaurants.length > 0 ? filteredRestaurants : restaurants;

    if (dataToRender.length === 0) {
        rankingList.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--text-muted);">No se encontraron restaurantes para esta ubicación.</div>';
        lucide.createIcons();
        return;
    }

    dataToRender.forEach((res, i) => {
        const item = document.createElement('div');
        const rank = parseInt(res.rank || i + 1);
        const medalClass = getMedalClass(rank);
        const visitDate = res.date || res.fecha || '';
        const rating = res.rating || '0';

        item.className = `ranking-item ${medalClass}`;
        item.innerHTML = `
            <div class="rank-number">${rank}</div>
            <div class="restaurant-info">
                <div class="restaurant-name-row">
                    <h3 class="restaurant-name">${res.name}</h3>
                    ${visitDate ? `
                    <div class="ranking-date-box">
                        <div class="date-label">VISITADO EL</div>
                        <div class="date-value">${visitDate}</div>
                    </div>` : ''}
                </div>
                <p class="restaurant-location">${res.location || 'Luxury'}</p>
            </div>
            <div class="score-box">
                <div class="score-label">Puntaje</div>
                <div class="score-value">${rating}</div>
            </div>
            <i data-lucide="arrow-right-circle"></i>
        `;
        item.addEventListener('click', () => showDetail(res));
        rankingList.appendChild(item);
    });
    debouncedCreateIcons();

    // Performance: Only stagger-animate first 8 items, rest appear instantly
    const MAX_ANIMATED = 8;
    const allItems = document.querySelectorAll('.ranking-item');
    const animatedItems = Array.from(allItems).slice(0, MAX_ANIMATED);
    const instantItems = Array.from(allItems).slice(MAX_ANIMATED);

    if (animatedItems.length > 0) {
        gsap.to(animatedItems, { opacity: 1, y: 0, stagger: 0.08, duration: 0.5, ease: "power4.out" });
    }
    if (instantItems.length > 0) {
        gsap.set(instantItems, { opacity: 1, y: 0 });
    }
}

// --- DETAIL VIEW HELPERS ---

/**
 * Generates photos gallery HTML
 */
function generatePhotosGalleryHTML(photosString) {
    if (!photosString || !photosString.trim()) {
        return `
            <div style="margin-top: 1.5rem; padding: 2rem; text-align: center; color: var(--text-muted);">
                <i data-lucide="image-off" style="width: 48px; height: 48px; margin: 0 auto 1rem; opacity: 0.3;"></i>
                <p style="font-size: 1rem;">No hay fotos para este evento</p>
            </div>
        `;
    }

    const photos = photosString.split(';').map(url => url.trim()).filter(url => url.length > 0);

    return `
        <div class="gallery" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-top: 1.5rem;">
            ${photos.map(img => `<img src="${img}" class="gallery-img" loading="lazy" style="width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; cursor: pointer; transition: opacity 0.2s;" onclick="openLightbox('${img}')">`).join('')}
        </div>
    `;
}

/**
 * Generates scores table HTML
 */
function generateScoresTableHTML(res) {
    if (!res.critics || Object.keys(res.critics).length === 0) {
        return `
            <div style="padding: 2rem; text-align: center; color: var(--text-muted);">
                <p style="font-size: 0.9rem;">No hay detalles de puntajes para este lugar.</p>
            </div>
        `;
    }

    const criticNames = Object.keys(res.critics);
    let rowsHtml = '';
    const isDelivery = currentMode === 'delivery';

    criticNames.forEach(critic => {
        const criticRes = res.critics[critic];
        const avg = criticRes.rating || '-';
        const food = criticRes.comida || '-';

        let col3, col4;
        if (isDelivery) {
            // Delivery columns: Presentacion, Precio
            col3 = criticRes.presentacion || '-';
            col4 = criticRes.precio || '-';
        } else {
            // Presencial columns: Lugar, Atencion
            col3 = criticRes.lugar || '-';
            col4 = criticRes.atencion || '-';
        }

        rowsHtml += `
            <tr class="score-row">
                <td class="col-critic">${critic}</td>
                <td class="col-score col-avg">${avg}</td>
                <td class="col-score">${food}</td>
                <td class="col-score">${col3}</td>
                <td class="col-score">${col4}</td>
            </tr>
        `;
    });

    return `
        <table class="scores-table">
            <thead>
                <tr class="score-header-row">
                    <th style="text-align: left;">Crítico</th>
                    <th>Prom.</th>
                    <th><i data-lucide="utensils" class="header-icon"></i> Comida</th>
                    ${isDelivery ?
            `<th><i data-lucide="box" class="header-icon"></i> Presentación</th>
                     <th><i data-lucide="dollar-sign" class="header-icon"></i> Precio</th>` :
            `<th><i data-lucide="armchair" class="header-icon"></i> Lugar</th>
                     <th><i data-lucide="thumbs-up" class="header-icon"></i> Atención</th>`
        }
                </tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>
    `;
}

/**
 * Converts restaurant name to URL-safe slug
 */
function getRestaurantSlug(name) {
    if (!name) return '';
    return String(name).toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Finds restaurant by slug
 */
function findRestaurantBySlug(slug) {
    return restaurants.find(r => getRestaurantSlug(r.name) === slug);
}

/**
 * Shows restaurant detail view
 */
function showDetail(res, updateHash = true) {
    console.log("--- DEBUG DETALLE ---");
    console.log("Datos del restaurante:", res);

    // Track detail view only on the initial call (not on hashchange re-entry)
    if (updateHash) {
        trackEvent('detail_view', res.name);
    }

    // Update URL hash if needed
    if (updateHash) {
        const slug = getRestaurantSlug(res.name);
        const expectedHash = `#restaurant/${slug}`;
        if (window.location.hash !== expectedHash) {
            window.location.hash = expectedHash;
            return; // Let the hashchange event listener handle the actual rendering
        }
    }

    const visitDate = res.date || res.fecha || '';
    const rating = res.rating || '0';
    const rank = parseInt(res.rank || 0);
    const medalClass = getMedalClass(rank);

    // Location data
    const address = res.address || res.direccion || '';
    const phone = res.phone || res.telefono || '';
    const instagram = res.instagram || '';
    const mapLink = res['link mapa'] || res.link_mapa || res.google_maps || '';
    const orderedBy = res.orderedBy || '';

    const instagramLink = instagram ? `https://instagram.com/${instagram.replace('@', '').replace('https://instagram.com/', '')}` : '';

    // Find photos
    const photosString = res.fotos || res.images || res.photos || '';

    restaurantContent.innerHTML = `
        <div class="detail-header">
            <div class="detail-header-grid">
                <!-- Rank -->
                <div class="detail-rank ${medalClass}">${rank > 0 ? rank : '-'}</div>
                
                <!-- Title -->
                <h1 class="detail-title">${res.name}</h1>
                
                <!-- Date -->
                <div class="detail-date-box">
                    <div class="date-label">VISITADO EL</div>
                    <div class="date-value">${visitDate}</div>
                </div>

                <!-- Scores Wrapper -->
                <div class="scores-wrapper">
                    <!-- Comer.ar Score -->
                    <div class="detail-score-box">
                        <div class="score-label">Puntaje de Comer.ar</div>
                        <div class="score-value">${rating}</div>
                    </div>

                    <!-- Public Score -->
                    ${(() => {
                        const voteKey = (res.name || '').trim().toLowerCase();
                        const voteData = publicVotes[voteKey];
                        const publicScore = voteData ? voteData.avg : '-';
                        const voteCount = voteData ? voteData.count : 0;
                        return `
                    <div class="detail-score-box public-score-box">
                        <div class="score-label">Puntaje del Público</div>
                        <div class="score-value-row">
                            <div class="score-value">${publicScore}</div>
                            <div class="votes-pill">${voteCount} ${voteCount === 1 ? 'voto' : 'votos'}</div>
                        </div>
                    </div>
                        `;
                    })()}

                    <!-- Vote Button -->
                    <button class="vote-btn" onclick="window.open('https://docs.google.com/forms/d/e/1FAIpQLSccteyXdae90sOgyONjnyXqJCjRWk211Vjk89aMDR0_3qyr-A/viewform', '_blank')">
                        <i data-lucide="star"></i>
                        <span>Votá acá</span>
                    </button>
                </div>

                <!-- Location -->
                <p class="detail-location">${res.location || 'Global Selection'}</p>
                
                <!-- Description -->
                <div class="detail-description">
                    <p>${res.description || ''}</p>
                </div>
                
            </div>

            </div>
        </div>
        
        <div class="detail-info-list">
            <!-- 1) Dirección -->
            <div class="info-item ${address ? 'active' : 'inactive'}">
                <i data-lucide="map-pin"></i>
                <span>${address || 'Dirección no disponible'}</span>
            </div>

            <!-- 2) Teléfono -->
            <div class="info-item ${phone ? 'active' : 'inactive'}">
                <i data-lucide="phone"></i>
                <span>${phone || 'Teléfono no disponible'}</span>
            </div>

            <!-- 3) Instagram -->
            ${instagramLink ?
            `<a href="${instagramLink}" target="_blank" class="info-item active link">
                    <i data-lucide="instagram"></i>
                    <span>Ver el IG del local</span>
                </a>` :
            `<div class="info-item inactive">
                    <i data-lucide="instagram"></i>
                    <span>Ver el IG del local</span>
                </div>`
        }

            <!-- 4) Mapa (Presencial only) -->
            ${(mapLink && currentMode === 'presencial') ?
            `<a href="${mapLink}" target="_blank" class="info-item active link">
                    <i data-lucide="map"></i>
                    <span>Ir al local</span>
                </a>` :
            (currentMode === 'presencial' ? `<div class="info-item inactive">
                    <i data-lucide="map"></i>
                    <span>Ir al local</span>
                </div>` : '')
        }

            <!-- 5) Pedido por (Delivery only) -->
             ${orderedBy ?
            `<div class="info-item active">
                    <i data-lucide="shopping-bag"></i>
                    <span>Pedido por: <strong>${orderedBy}</strong></span>
                </div>` : ''
        }
        </div>
        
        <div class="detail-tabs-container">
            <div class="sub-tabs">
                <button class="sub-tab-btn active" data-subtab="fotos">Fotos</button>
                <button class="sub-tab-btn" data-subtab="puntajes">Puntajes</button>
            </div>
            
            <div id="fotos-content" class="sub-tab-content">
                ${generatePhotosGalleryHTML(photosString)}
            </div>
            
            <div id="puntajes-content" class="sub-tab-content hidden">
                <style>
                    .scores-table-container {
                        background: rgba(255, 255, 255, 0.4);
                        border: 1px solid rgba(255, 255, 255, 0.6);
                        border-radius: 12px;
                        padding: 1rem;
                        backdrop-filter: blur(10px);
                        overflow-x: auto;
                    }
                    .dark-mode .scores-table-container {
                        background: rgba(30, 30, 30, 0.4);
                        border-color: rgba(255, 255, 255, 0.1);
                    }
                    .scores-table {
                        width: 100%;
                        border-collapse: collapse;
                        min-width: 300px;
                    }
                    
                    /* Headers */
                    .score-header-row th {
                        text-align: center;
                        padding-bottom: 1rem;
                        border-bottom: 1px solid rgba(0,0,0,0.1);
                        color: var(--text-muted);
                        font-family: var(--font-body);
                        font-weight: 600;
                        font-size: 0.8rem;
                        text-transform: uppercase;
                        letter-spacing: 0.05em;
                        vertical-align: middle;
                    }
                    .dark-mode .score-header-row th {
                        border-bottom-color: rgba(255,255,255,0.1);
                    }
                    .header-icon {
                        width: 16px;
                        height: 16px;
                        margin-right: 4px;
                        vertical-align: text-bottom;
                        opacity: 0.7;
                    }

                    /* Rows */
                    .score-row td {
                        padding: 1rem 0;
                        text-align: center;
                        border-bottom: 1px solid rgba(0,0,0,0.05);
                        vertical-align: middle;
                    }
                    .score-row:last-child td {
                        border-bottom: none;
                        padding-bottom: 0;
                    }
                    .dark-mode .score-row td {
                        border-bottom-color: rgba(255,255,255,0.05);
                    }

                    /* Columns */
                    .col-critic {
                        text-align: left !important;
                        font-family: var(--font-title);
                        font-weight: 700;
                        text-transform: capitalize;
                        font-size: 1.05rem;
                        width: 25%;
                    }
                    .col-score {
                        font-family: var(--font-title);
                        font-weight: 600;
                        font-size: 1rem;
                        width: 18%;
                        position: relative;
                    }
                    /* Vertical Dividers */
                    .col-score::before {
                        content: '';
                        position: absolute;
                        left: 0;
                        top: 25%;
                        bottom: 25%;
                        width: 1px;
                        background-color: rgba(0,0,0,0.1);
                    }
                    .dark-mode .col-score::before {
                        background-color: rgba(255,255,255,0.1);
                    }

                    .col-avg {
                        font-weight: 800;
                        font-size: 1.1rem;
                        color: var(--text-main);
                        width: 15%;
                    }
                </style>
                <div class="scores-table-container">
                    ${generateScoresTableHTML(res)}
                </div>
            </div>
        </div>
    `;

    // Initialize icons for new content (debounced to avoid redundant DOM scans)
    debouncedCreateIcons();

    // Sub-tab logic
    setupSubTabs();

    // Transition animation
    const tl = gsap.timeline();
    tl.to(homeView, {
        opacity: 0, duration: 0.3, onComplete: () => {
            homeView.classList.add('hidden');
            detailView.classList.remove('hidden');
            gsap.fromTo('.detail-container', { opacity: 0 }, { opacity: 1, duration: 0.5 });
        }
    });
}

/**
 * Sets up sub-tab switching logic
 */
function setupSubTabs() {
    document.querySelectorAll('.sub-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const target = btn.getAttribute('data-subtab');

            // Update buttons
            document.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update content
            document.querySelectorAll('.sub-tab-content').forEach(content => content.classList.add('hidden'));
            document.getElementById(`${target}-content`).classList.remove('hidden');
        });
    });
}

/**
 * Toggles back to home view
 */
function toggleHome(updateHash = true) {
    const tl = gsap.timeline();
    tl.to('.detail-container', {
        opacity: 0, duration: 0.3, onComplete: () => {
            detailView.classList.add('hidden');
            homeView.classList.remove('hidden');
        }
    });
    tl.to(homeView, { opacity: 1, duration: 0.4 });

    // Clear hash when going back to home
    if (updateHash && window.location.hash) {
        history.pushState('', document.title, window.location.pathname + window.location.search);
    }
}

// --- HASH NAVIGATION ---

/**
 * Handles hash changes for navigation
 */
function handleHashChange() {
    const hash = window.location.hash.slice(1); // Remove #

    if (hash.startsWith('restaurant/')) {
        const slug = hash.replace('restaurant/', '');
        const restaurant = findRestaurantBySlug(slug);

        if (restaurant) {
            // Show detail without updating hash (to avoid loop)
            showDetail(restaurant, false);
        } else {
            // Restaurant not found, go back to home
            console.warn(`Restaurant not found for slug: ${slug}`);
            toggleHome(false);
        }
    } else if (hash === '' || hash === '/') {
        // Empty hash or root, show home
        if (!detailView.classList.contains('hidden')) {
            toggleHome(false);
        }
    }
}

// --- TAB MANAGEMENT ---

/**
 * Sets up main tab switching
 */
function setupMainTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-tab');

            // Show/hide location filter with animation
            if (target === 'ranking') {
                setTimeout(() => {
                    locationFilterContainer.classList.add('show');
                    debouncedCreateIcons();
                }, 100);
            } else {
                locationFilterContainer.classList.remove('show');
            }

            // Lazy-load Google Maps iframe on first click
            if (target === 'map' && !mapLoaded) {
                const mapContainer = document.getElementById('map-container');
                if (mapContainer) {
                    mapContainer.innerHTML = `
                        <iframe
                            src="https://www.google.com/maps/d/embed?mid=1rViUskbYtl1mWekFkuBO6AQdzEsOI20&ehbc=2E312F&noprof=1"
                            width="100%" height="450" style="border:0; border-radius: 16px;" loading="lazy" allowfullscreen
                            referrerpolicy="no-referrer-when-downgrade" title="Mapa de ubicación de restaurantes"></iframe>
                    `;
                    mapLoaded = true;
                }
            }

            // Update buttons
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update content visibility
            tabContents.forEach(content => content.classList.add('hidden'));
            document.getElementById(`${target}-view`).classList.remove('hidden');
        });
    });
}

// --- LIGHTBOX ---

window.openLightbox = function (src) {
    if (lightbox && lightboxImg) {
        lightboxImg.src = src;
        lightbox.classList.add('visible');
    }
};

window.closeLightbox = function () {
    if (lightbox) {
        lightbox.classList.remove('visible');
        setTimeout(() => {
            if (lightboxImg) lightboxImg.src = '';
        }, 300);
    }
};

// Removed duplicated initApp and DOMContentLoaded handler

/**
 * Sets up lightbox event listeners
 */
function setupLightbox() {
    if (lightbox) {
        lightbox.addEventListener('click', (e) => {
            if (e.target === lightbox) closeLightbox();
        });
    }

    if (lightboxClose) {
        lightboxClose.addEventListener('click', closeLightbox);
    }

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeLightbox();
    });
}

// --- SETTINGS ---

/**
 * Sets up settings menu and dark mode toggle
 */
function setupSettings() {
    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsMenu.classList.toggle('hidden');
    });

    document.addEventListener('click', () => settingsMenu.classList.add('hidden'));
    settingsMenu.addEventListener('click', (e) => e.stopPropagation());

    darkModeToggle.addEventListener('change', () => {
        document.body.classList.toggle('dark-mode');
        document.body.classList.toggle('light-mode');
    });
}

// --- INITIALIZATION ---

/**
 * Caches all DOM elements
 */
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

// Setup location filter listener (moved to init or separate setup, but keeping logic consistent)
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
        });
    }
}

/**
 * Sets up mode switcher
 */
function setupModeSwitcher() {
    const modeBtns = document.querySelectorAll('.mode-btn');

    modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const newMode = btn.getAttribute('data-mode');
            if (newMode === currentMode) return;

            currentMode = newMode;

            // Update buttons
            modeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Handle Tabs visibility based on mode
            const activeTabsForMode = CONFIG.tabsData[currentMode] || ['ranking'];
            const tabs = document.querySelectorAll('.tab-btn');
            tabs.forEach(tab => {
                const tabId = tab.getAttribute('data-tab');
                if (activeTabsForMode.includes(tabId)) {
                    tab.style.display = 'flex';
                } else {
                    tab.style.display = 'none';
                }
            });

            // If current tab is hidden, switch to first available tab (usually 'ranking')
            const activeTab = document.querySelector('.tab-btn.active');
            if (activeTab && activeTab.style.display === 'none') {
                // Trigger click on ranking tab
                document.querySelector('.tab-btn[data-tab="ranking"]').click();
            }

            // Filter existing data without re-fetching
            filterByMode();
        });
    });
}


/**
 * Main initialization function
 */
function initApp() {
    cacheDOMElements();

    // Header animation
    gsap.from('.header', { opacity: 0, y: 30, duration: 1, ease: "expo.out" });

    // Setup all event listeners
    setupMainTabs();
    setupSettings();
    setupLightbox();
    setupModeSwitcher();
    setupFilters();

    // Back button
    backBtn.addEventListener('click', () => toggleHome(true));

    // Hash navigation listeners
    window.addEventListener('hashchange', handleHashChange);
    // Note: Don't call handleHashChange on load event, it's called after data loads

    // Show location filter on load if ranking tab is active
    setTimeout(() => {
        const activeTab = document.querySelector('.tab-btn.active');
        if (activeTab && activeTab.getAttribute('data-tab') === 'ranking') {
            locationFilterContainer.classList.add('show');
            debouncedCreateIcons();
        }
    }, 100);

    // Fetch data
    fetchData();

    // Track page view (fire-and-forget)
    trackEvent('pageview');
}

// Single DOMContentLoaded listener
document.addEventListener('DOMContentLoaded', initApp);
