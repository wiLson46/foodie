
// --- CONFIG & DATA ---
// Google Sheets - Diferentes pestañas por crítico
const GOOGLE_SHEETS = {
    wil: 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv&gid=667637220',
    fer: 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv&gid=445878910',
    colo: 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv&gid=1592300088',
    andy: 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv&gid=1438813672'
};

// URL principal (pestaña wil por defecto)
const GOOGLE_SHEET_CSV_URL = GOOGLE_SHEETS.wil;

const MOCK_DATA = [
    { rank: 1, name: "Pujol", rating: "9.8", description: "Cocina mexicana de autor en las manos de Enrique Olvera.", location: "CDMX, México" },
    { rank: 2, name: "Central", rating: "9.7", description: "Exploración de ecosistemas peruanos por Virgilio Martínez.", location: "Lima, Perú" },
    { rank: 3, name: "DiverXO", rating: "9.6", description: "Vanguardia extrema de Dabiz Muñoz en Madrid.", location: "Madrid, España" },
    { rank: 4, name: "Oteque", rating: "9.5", description: "Minimalismo y elegancia en Río de Janeiro.", location: "Río, Brasil" }
];

const MOCK_VISITS = [
    { date: "15 DIC 2024", critic: "M. Michelin", comment: "Una experiencia sublime que redefine la cocina moderna.", images: ["https://picsum.photos/400/400?random=1", "https://picsum.photos/400/400?random=2"] },
    { date: "02 NOV 2024", critic: "J. Gold", comment: "Los matices de los sabores locales son impresionantes.", images: ["https://picsum.photos/400/400?random=3"] }
];

// --- APP STATE ---
let restaurants = [];
// Store data for each critic
let criticsData = {
    wil: [],
    fer: [],
    colo: [],
    andy: []
};

// --- DOM ELEMENTS ---
const rankingList = document.getElementById('ranking-list');
const homeView = document.getElementById('home');
const detailView = document.getElementById('detail');
const restaurantContent = document.getElementById('restaurant-content');
const backBtn = document.getElementById('back-btn');
const header = document.querySelector('.header');
const settingsBtn = document.getElementById('settings-btn');
const settingsMenu = document.getElementById('settings-menu');
const darkModeToggle = document.getElementById('dark-mode-toggle');

// Init
window.addEventListener('DOMContentLoaded', () => {
    // initApp is called here
    initApp();
});

async function initApp() {
    gsap.from('.header', { opacity: 0, y: 30, duration: 1, ease: "expo.out" });
    // Tab Switching Logic
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-tab');

            // Update buttons
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update content visibility
            tabContents.forEach(content => {
                content.classList.add('hidden');
            });
            document.getElementById(`${target}-view`).classList.remove('hidden');
        });
    });

    fetchCriticsData();

    // UI Events
    backBtn.addEventListener('click', toggleHome);

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

// Helper to fetch a single CSV via Promise
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
                const data = results.data || [];
                // Filter empty rows
                const filtered = data.filter(row => Object.values(row).some(v => String(v).trim() !== ""));

                // Normalize keys to lowercase
                const normalized = filtered.map(row => {
                    const standardRow = {};
                    Object.keys(row).forEach(key => {
                        standardRow[key.toLowerCase()] = row[key];
                    });
                    return standardRow;
                });

                resolve(normalized);
            },
            error: (err) => {
                console.warn(`Error fetching specific sheet: ${url}`, err);
                resolve([]); // Resolve with empty array on error to not break Promise.all
            }
        });
    });
}

function fetchCriticsData() {
    // We assume 'wil' is the main data source for the ranking list
    // But we fetch all of them
    const promises = [
        fetchSheet(GOOGLE_SHEETS.wil).then(data => { criticsData.wil = data; return data; }),
        fetchSheet(GOOGLE_SHEETS.fer).then(data => { criticsData.fer = data; return data; }),
        fetchSheet(GOOGLE_SHEETS.colo).then(data => { criticsData.colo = data; return data; }),
        fetchSheet(GOOGLE_SHEETS.andy).then(data => { criticsData.andy = data; return data; })
    ];

    Promise.all(promises).then(results => {
        // Results[0] is 'wil', which we use for the main list
        const mainData = results[0];

        if (mainData && mainData.length > 0) {
            // Check if we got a login page instead of data (private sheet check)
            const firstRow = mainData[0];
            if (Object.keys(firstRow).some(k => k.includes('<!DOCTYPE') || k.includes('<html'))) {
                console.error("ERROR: El Google Sheet parece ser PRIVADO.");
                restaurants = MOCK_DATA;
            } else {
                // Check if we have a 'name' or 'nombre' column
                const hasName = Object.keys(firstRow).some(k => k === 'name' || k === 'nombre');
                if (hasName) {
                    restaurants = mainData.map(r => ({
                        ...r,
                        name: r.name || r.nombre, // Normalize name property
                        rating: r.rating || r.promedio || r.score || '0'
                    }));
                } else {
                    restaurants = MOCK_DATA;
                }
            }
        } else {
            console.warn("No main data found, using MOCK_DATA");
            restaurants = MOCK_DATA;
        }

        console.log("Datos cargados:", { restaurants, criticsData });
        renderRanking();
    });
}

function renderRanking() {
    rankingList.innerHTML = '';
    restaurants.forEach((res, i) => {
        const item = document.createElement('div');
        const rank = parseInt(res.rank || i + 1);
        let medalClass = '';
        if (rank === 1) medalClass = 'top-1';
        else if (rank === 2) medalClass = 'top-2';
        else if (rank === 3) medalClass = 'top-3';

        const visitDate = res.date || res.fecha || '';
        const rating = res.rating || '0';

        item.className = `ranking-item ${medalClass}`;
        item.innerHTML = `
            <div class="rank-number">${rank}</div>
            <div class="restaurant-info">
                <div class="restaurant-name-row">
                    <h3 class="restaurant-name">${res.name}</h3>
                    ${visitDate ? `<span class="restaurant-date">${visitDate}</span>` : ''}
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

function showDetail(res) {
    const visitDate = res.date || res.fecha || '';
    const rating = res.rating || '0';

    restaurantContent.innerHTML = `
        <div class="detail-header">
            <div class="detail-header-content">
                <div>
                    <div class="detail-title-row">
                        <h1 class="detail-title" style="font-family: var(--font-title); font-weight: 800; font-size: 2.5rem;">${res.name}</h1>
                        ${visitDate ? `<span class="detail-date">${visitDate}</span>` : ''}
                    </div>
                    <p class="subtitle">${res.location || 'Global Selection'}</p>
                </div>
                <div class="detail-score-box">
                    <div class="score-label">Puntaje</div>
                    <div class="score-value">${rating}</div>
                </div>
            </div>
        </div>
        
        <div class="detail-tabs-container" style="margin-top: 3rem;">
            <div class="sub-tabs">
                <button class="sub-tab-btn active" data-subtab="fotos">Fotos</button>
                <button class="sub-tab-btn" data-subtab="puntajes">Puntajes</button>
            </div>
            
            <div id="fotos-content" class="sub-tab-content">
                ${(() => {
            // Intentar obtener fotos del Google Sheet
            const photosString = res.fotos || res.images || res.photos || '';
            let photos = [];

            if (photosString && photosString.trim()) {
                // Separar por punto y coma y limpiar espacios
                photos = photosString.split(';')
                    .map(url => url.trim())
                    .filter(url => url.length > 0);
            }

            // Si hay fotos, mostrar la galería
            if (photos.length > 0) {
                return `
                            <div class="gallery" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-top: 1.5rem;">
                                ${photos.map(img => `<img src="${img}" class="gallery-img" style="width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px;">`).join('')}
                            </div>
                        `;
            } else {
                // Si no hay fotos, mostrar mensaje
                return `
                            <div style="margin-top: 1.5rem; padding: 2rem; text-align: center; color: var(--text-muted);">
                                <i data-lucide="image-off" style="width: 48px; height: 48px; margin: 0 auto 1rem; opacity: 0.3;"></i>
                                <p style="font-size: 1rem;">No hay fotos para este evento</p>
                            </div>
                        `;
            }
        })()}
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
                    ${(() => {
            const criticNames = ['wil', 'fer', 'colo', 'andy'];
            let rowsHtml = '';
            let hasData = false;

            criticNames.forEach(critic => {
                const data = criticsData[critic] || [];
                const criticRes = data.find(r =>
                    (r.nombre && r.nombre.toLowerCase().trim() === res.name.toLowerCase().trim()) ||
                    (r.name && r.name.toLowerCase().trim() === res.name.toLowerCase().trim())
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
        })()}
                </div>
            </div>
        </div>
    `;

    // Sub-tab logic
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

    const tl = gsap.timeline();
    tl.to(homeView, {
        opacity: 0, duration: 0.3, onComplete: () => {
            homeView.classList.add('hidden');
            detailView.classList.remove('hidden');
            gsap.fromTo('.detail-container', { opacity: 0 }, { opacity: 1, duration: 0.5 });
        }
    });
}

function toggleHome() {
    const tl = gsap.timeline();
    tl.to('.detail-container', {
        opacity: 0, duration: 0.3, onComplete: () => {
            detailView.classList.add('hidden');
            homeView.classList.remove('hidden');
        }
    });

    tl.to(homeView, { opacity: 1, duration: 0.4 });
}
