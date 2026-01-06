
// --- CONFIG & DATA ---
const CONFIG = {
    presencial: {
        main: 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv',
        critics: {
            wil: 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv&gid=667637220',
            fer: 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv&gid=445878910',
            colo: 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv&gid=1592300088',
            andy: 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv&gid=1438813672'
        },
        tabs: ['ranking', 'map']
    },
    delivery: {
        main: 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv&gid=2117542404',
        critics: {
            wil: 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv&gid=1858951681'
            // Add more critics here when available
        },
        tabs: ['ranking']
    }
};

const PEOPLE_SCORE_SHEET = 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv&gid=1841885372';

const MOCK_DATA = [
    { rank: 1, name: "Pujol", rating: "9.8", description: "Cocina mexicana de autor en las manos de Enrique Olvera.", location: "CDMX, México" },
    { rank: 2, name: "Central", rating: "9.7", description: "Exploración de ecosistemas peruanos por Virgilio Martínez.", location: "Lima, Perú" },
    { rank: 3, name: "DiverXO", rating: "9.6", description: "Vanguardia extrema de Dabiz Muñoz en Madrid.", location: "Madrid, España" },
    { rank: 4, name: "Oteque", rating: "9.5", description: "Minimalismo y elegancia en Río de Janeiro.", location: "Río, Brasil" }
];

// --- APP STATE ---
let restaurants = [];
let filteredRestaurants = [];
let criticsData = { wil: [], fer: [], colo: [], andy: [] }; // This will be dynamic based on mode
let peopleScores = []; // New state for people's scores
let currentSort = 'score'; // Default sort order
let currentMode = 'presencial'; // 'presencial' | 'delivery'

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
    const config = CONFIG[currentMode];

    // Reset critics data structure
    criticsData = {};
    const criticsPromises = [];
    const criticsKeys = Object.keys(config.critics);

    criticsKeys.forEach(key => {
        criticsPromises.push(
            fetchSheet(config.critics[key]).then(data => {
                criticsData[key] = data;
                return data;
            })
        );
    });

    const promises = [
        fetchSheet(config.main),
        ...criticsPromises,
        fetchSheet(PEOPLE_SCORE_SHEET) // Fetch people scores
    ];

    // Show loading state
    rankingList.innerHTML = '<div class="loader">Cargando la selección...</div>';

    Promise.all(promises).then(results => {
        const mainData = results[0];
        // People scores are the last result
        const peopleData = results[results.length - 1];

        // Parse people scores
        if (isValidData(peopleData)) {
            peopleScores = peopleData.map(row => ({
                name: Object.values(row)[0] || '', // Column A
                score: Object.values(row)[1] || '' // Column B
            }));
        } else {
            peopleScores = [];
        }

        if (isValidData(mainData)) {
            const hasName = Object.keys(mainData[0]).some(k => k === 'name' || k === 'nombre');
            if (hasName) {
                restaurants = mainData.map((r, index) => ({
                    ...r,
                    name: r.name || r.nombre,
                    rating: r.rating || r.promedio || r.score || '0',
                    rank: index + 1,
                    description: r.description || r.descripcion || '',
                    orderedBy: r['pedido por'] || r.pedido_por || ''
                }));
            } else {
                console.warn("No 'name' column found, using MOCK_DATA");
                restaurants = MOCK_DATA;
            }
        } else {
            console.warn("Invalid or empty data, using MOCK_DATA");
            restaurants = MOCK_DATA;
        }

        console.log("Datos cargados:", { mode: currentMode, restaurants, criticsData, peopleScores });
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
    // Search in all critics' data
    const criticNames = Object.keys(criticsData);
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
    const criticNames = Object.keys(criticsData);
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
            const isDelivery = currentMode === 'delivery';
            const avg = criticRes.promedio || criticRes.average || criticRes.rating || '-';
            const food = criticRes.comida || criticRes.food || '-';

            let col3, col4;
            if (isDelivery) {
                // Delivery columns: Envio, Precio
                col3 = criticRes.envio || criticRes['envio'] || '-';
                col4 = criticRes.precio || criticRes.price || '-';
            } else {
                // Presencial columns: Lugar, Atencion
                col3 = criticRes.lugar || criticRes.place || criticRes.ambience || '-';
                col4 = criticRes.atencion || criticRes.service || '-';
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
        }
    });

    const isDelivery = currentMode === 'delivery';

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
                    ${isDelivery ?
            `<th><i data-lucide="bike" class="header-icon"></i> Envío</th>
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
 * Finds people's score for a restaurant
 */
function getPeopleScore(restaurantName) {
    if (!peopleScores || peopleScores.length === 0) return '-.-';

    // Normalize logic similar to critics search
    const found = peopleScores.find(p =>
        p.name && p.name.toLowerCase().trim() === restaurantName.toLowerCase().trim()
    );

    return (found && found.score) ? found.score : '-.-';
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
    const orderedBy = res.orderedBy || '';

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

                <!-- Scores Wrapper -->
                <div class="scores-wrapper">
                    <!-- Comer.ar Score -->
                    <div class="detail-score-box">
                        <div class="score-label">Puntaje de Comer.ar</div>
                        <div class="score-value">${rating}</div>
                    </div>

                    <!-- People's Score -->
                    ${(() => {
            const pScore = getPeopleScore(res.name);
            return (pScore && pScore !== '-.-') ? `
                            <div class="detail-score-box people-score-box" onclick="openSurveyModal()">
                                <div class="score-label">Puntaje de la gente</div>
                                <div class="score-value">${pScore}</div>
                            </div>
                        ` : '';
        })()}
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

// --- SURVEY MODAL ---

window.openSurveyModal = function () {
    const modal = document.getElementById('survey-modal');
    const container = document.getElementById('survey-container');

    if (!modal || !container) return;

    // Detect device for iframe sizing
    const isMobile = window.innerWidth <= 768;
    const width = isMobile ? "300" : "640";
    const height = isMobile ? "600" : "946";

    container.innerHTML = `
        <iframe src="https://docs.google.com/forms/d/e/1FAIpQLSccteyXdae90sOgyONjnyXqJCjRWk211Vjk89aMDR0_3qyr-A/viewform?embedded=true" 
        width="${width}" height="${height}" frameborder="0" marginheight="0" marginwidth="0">Loading...</iframe>
   `;

    modal.classList.remove('hidden');
    // Force reflow
    void modal.offsetWidth;
    modal.classList.add('visible');
    document.body.style.overflow = 'hidden';
};

window.closeSurveyModal = function () {
    const modal = document.getElementById('survey-modal');
    if (!modal) return;

    modal.classList.remove('visible');
    setTimeout(() => {
        modal.classList.add('hidden');
        document.getElementById('survey-container').innerHTML = '';
        document.body.style.overflow = '';
    }, 300);
};

// --- INITIALIZATION ---

function initApp() {
    // Cache DOM elements
    cacheDOMElements();

    // Mode Switcher
    setupModeSwitcher();

    // Filters
    setupFilters();

    // Event Listeners
    if (settingsBtn) {
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            settingsMenu.classList.toggle('hidden');
        });
    }

    if (backBtn) {
        backBtn.addEventListener('click', () => toggleHome());
    }

    if (darkModeToggle) {
        // Check system preference
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            darkModeToggle.checked = true;
            document.body.className = 'dark-mode';
        }

        darkModeToggle.addEventListener('change', () => {
            document.body.className = darkModeToggle.checked ? 'dark-mode' : 'light-mode';
        });
    }

    document.addEventListener('click', (e) => {
        if (settingsMenu && !settingsMenu.classList.contains('hidden') && !e.target.closest('.dropdown')) {
            settingsMenu.classList.add('hidden');
        }
    });

    // Lightbox events
    if (lightboxClose) {
        lightboxClose.addEventListener('click', closeLightbox);
    }

    if (lightbox) {
        lightbox.addEventListener('click', (e) => {
            if (e.target === lightbox) closeLightbox();
        });
    }

    // Survey Modal events
    const surveyClose = document.getElementById('survey-close');
    const surveyModal = document.getElementById('survey-modal');

    if (surveyClose) {
        surveyClose.addEventListener('click', closeSurveyModal);
    }

    if (surveyModal) {
        surveyModal.addEventListener('click', (e) => {
            if (e.target === surveyModal) closeSurveyModal();
        });
    }

    // Tabs
    setupMainTabs();

    // Initial Data Fetch
    fetchCriticsData();
}

// Start App
document.addEventListener('DOMContentLoaded', initApp);

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
            const config = CONFIG[currentMode];
            const tabs = document.querySelectorAll('.tab-btn');
            tabs.forEach(tab => {
                const tabId = tab.getAttribute('data-tab');
                if (config.tabs.includes(tabId)) {
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

            // Clear existing data and re-fetch
            restaurants = [];
            filteredRestaurants = [];
            rankingList.innerHTML = '<div class="loader">Cargando nueva selección...</div>';

            fetchCriticsData();
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
            lucide.createIcons();
        }
    }, 100);

    // Fetch data
    fetchCriticsData();
}

// Single DOMContentLoaded listener
document.addEventListener('DOMContentLoaded', initApp);
