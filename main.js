
// --- CONFIG & DATA ---
const GOOGLE_SHEETS = {
    // La hoja principal contiene el ranking general y las fotos (Columna G)
    main: 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv',
    wil: 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv&gid=667637220',
    fer: 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv&gid=445878910',
    colo: 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv&gid=1592300088',
    andy: 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv&gid=1438813672'
};

const GOOGLE_SHEET_CSV_URL = GOOGLE_SHEETS.main;

const MOCK_DATA = [
    { rank: 1, name: "Pujol", rating: "9.8", description: "Cocina mexicana de autor en las manos de Enrique Olvera.", location: "CDMX, México" },
    { rank: 2, name: "Central", rating: "9.7", description: "Exploración de ecosistemas peruanos por Virgilio Martínez.", location: "Lima, Perú" },
    { rank: 3, name: "DiverXO", rating: "9.6", description: "Vanguardia extrema de Dabiz Muñoz en Madrid.", location: "Madrid, España" },
    { rank: 4, name: "Oteque", rating: "9.5", description: "Minimalismo y elegancia en Río de Janeiro.", location: "Río, Brasil" }
];

// --- APP STATE ---
let restaurants = [];
let filteredRestaurants = [];
let criticsData = { wil: [], fer: [], colo: [], andy: [] };
let currentSort = 'score'; // Default sort order

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

    return new Promise((resolve, reject) => {
        Papa.parse(url, {
            download: true,
            header: true,
            complete: (results) => {
                const normalized = normalizeData(results.data || []);
                resolve(normalized);
            },
            error: (err) => {
                console.warn(`Error fetching sheet: ${url}`, err);
                resolve([]); // Resolve with empty array to not break Promise.all
            }
        });
    });
}

/**
 * Fetches all critics data and main data
 */
function fetchCriticsData() {
    const promises = [
        fetchSheet(GOOGLE_SHEETS.main),
        fetchSheet(GOOGLE_SHEETS.wil).then(data => { criticsData.wil = data; return data; }),
        fetchSheet(GOOGLE_SHEETS.fer).then(data => { criticsData.fer = data; return data; }),
        fetchSheet(GOOGLE_SHEETS.colo).then(data => { criticsData.colo = data; return data; }),
        fetchSheet(GOOGLE_SHEETS.andy).then(data => { criticsData.andy = data; return data; })
    ];

    Promise.all(promises).then(results => {
        const mainData = results[0];

        if (isValidData(mainData)) {
            const hasName = Object.keys(mainData[0]).some(k => k === 'name' || k === 'nombre');
            if (hasName) {
                restaurants = mainData.map((r, index) => ({
                    ...r,
                    name: r.name || r.nombre,
                    rating: r.rating || r.promedio || r.score || '0',
                    rank: index + 1,
                    description: r.description || r.descripcion || ''
                }));
            } else {
                console.warn("No 'name' column found, using MOCK_DATA");
                restaurants = MOCK_DATA;
            }
        } else {
            console.warn("Invalid or empty data, using MOCK_DATA");
            restaurants = MOCK_DATA;
        }

        console.log("Datos cargados:", { restaurants, criticsData });
        filteredRestaurants = [...restaurants];
        populateLocationFilter();
        applySort(); // Apply initial sort
        renderRanking();

        // Handle hash navigation after data is loaded
        handleHashChange();
    }).catch(err => {
        console.error("Error loading data:", err);
        restaurants = MOCK_DATA;
        filteredRestaurants = [...restaurants];
        populateLocationFilter();
        renderRanking();

        // Handle hash navigation even with mock data
        handleHashChange();
    });
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
    lucide.createIcons();
    gsap.to('.ranking-item', { opacity: 1, y: 0, stagger: 0.1, duration: 0.8, ease: "power4.out" });
}

// --- DETAIL VIEW HELPERS ---

/**
 * Finds photos for a restaurant from critics data
 */
function findPhotosForRestaurant(restaurantName, mainPhotos) {
    if (mainPhotos && mainPhotos.trim()) {
        return mainPhotos;
    }

    // Search in all critics' data
    const criticNames = ['wil', 'fer', 'colo', 'andy'];
    for (const critic of criticNames) {
        const data = criticsData[critic] || [];
        const criticRes = data.find(r =>
            (r.nombre && r.nombre.toLowerCase().trim() === restaurantName.toLowerCase().trim()) ||
            (r.name && r.name.toLowerCase().trim() === restaurantName.toLowerCase().trim())
        );

        if (criticRes) {
            const criticPhotos = criticRes.fotos || criticRes.images || criticRes.photos;
            if (criticPhotos && criticPhotos.trim()) {
                console.log(`Fotos encontradas en pestaña de ${critic}`);
                return criticPhotos;
            }
        }
    }
    return '';
}

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
            ${photos.map(img => `<img src="${img}" class="gallery-img" style="width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; cursor: pointer; transition: opacity 0.2s;" onclick="openLightbox('${img}')">`).join('')}
        </div>
    `;
}

/**
 * Generates scores table HTML
 */
function generateScoresTableHTML(restaurantName) {
    const criticNames = ['wil', 'fer', 'colo', 'andy'];
    let rowsHtml = '';
    let hasData = false;

    criticNames.forEach(critic => {
        const data = criticsData[critic] || [];
        const criticRes = data.find(r =>
            (r.nombre && r.nombre.toLowerCase().trim() === restaurantName.toLowerCase().trim()) ||
            (r.name && r.name.toLowerCase().trim() === restaurantName.toLowerCase().trim())
        );

        if (criticRes) {
            hasData = true;
            const avg = criticRes.promedio || criticRes.average || criticRes.rating || '-';
            const food = criticRes.comida || criticRes.food || '-';
            const place = criticRes.lugar || criticRes.place || criticRes.ambience || '-';
            const service = criticRes.atencion || criticRes.service || '-';

            rowsHtml += `
                <tr class="score-row">
                    <td class="col-critic">${critic}</td>
                    <td class="col-score col-avg">${avg}</td>
                    <td class="col-score">${food}</td>
                    <td class="col-score">${place}</td>
                    <td class="col-score">${service}</td>
                </tr>
            `;
        }
    });

    if (!hasData) {
        return `
            <div style="padding: 2rem; text-align: center; color: var(--text-muted);">
                <p style="font-size: 0.9rem;">No hay detalles de puntajes para este lugar.</p>
            </div>
        `;
    }

    return `
        <table class="scores-table">
            <thead>
                <tr class="score-header-row">
                    <th style="text-align: left;">Crítico</th>
                    <th>Prom.</th>
                    <th><i data-lucide="utensils" class="header-icon"></i> Comida</th>
                    <th><i data-lucide="armchair" class="header-icon"></i> Lugar</th>
                    <th><i data-lucide="thumbs-up" class="header-icon"></i> Atención</th>
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
    return name.toLowerCase()
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

    // Update URL hash if needed
    if (updateHash) {
        const slug = getRestaurantSlug(res.name);
        window.location.hash = `restaurant/${slug}`;
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

    const instagramLink = instagram ? `https://instagram.com/${instagram.replace('@', '').replace('https://instagram.com/', '')}` : '';

    // Find photos
    const mainPhotos = res.fotos || res.images || res.photos || '';
    const photosString = findPhotosForRestaurant(res.name, mainPhotos);

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

                <!-- Score -->
                <div class="detail-score-box">
                    <div class="score-label">Puntaje</div>
                    <div class="score-value">${rating}</div>
                </div>

                <!-- Location -->
                <p class="detail-location">${res.location || 'Global Selection'}</p>
                
                <!-- Description -->
                <div class="detail-description">
                    <p>${res.description || ''}</p>
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

            <!-- 4) Mapa -->
            ${mapLink ?
            `<a href="${mapLink}" target="_blank" class="info-item active link">
                    <i data-lucide="map"></i>
                    <span>Ir al local</span>
                </a>` :
            `<div class="info-item inactive">
                    <i data-lucide="map"></i>
                    <span>Ir al local</span>
                </div>`
        }
        </div>
        
        <div class="detail-tabs-container" style="margin-top: 3rem;">
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
                    ${generateScoresTableHTML(res.name)}
                </div>
            </div>
        </div>
    `;

    // Initialize icons for new content
    lucide.createIcons();

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
                    lucide.createIcons();
                }, 100);
            } else {
                locationFilterContainer.classList.remove('show');
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
    locationFilterContainer = document.getElementById('location-filter-container');
    locationFilter = document.getElementById('location-filter');
    lightboxImg = document.getElementById('lightbox-img');
    lightboxClose = document.getElementById('lightbox-close');

    // Setup location filter listener
    if (locationFilter) {
        locationFilter.addEventListener('change', (e) => {
            filterByLocation(e.target.value);
        });
    }

    // Sort filter listener
    sortFilter = document.getElementById('sort-filter');
    if (sortFilter) {
        sortFilter.addEventListener('change', (e) => {
            currentSort = e.target.value;
            applySort();
            renderRanking();
        });
    }
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
            lucide.createIcons();
        }
    }, 100);

    // Fetch data
    fetchCriticsData();
}

// Single DOMContentLoaded listener
document.addEventListener('DOMContentLoaded', initApp);
