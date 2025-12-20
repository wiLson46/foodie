
// --- CONFIG & DATA ---
const GOOGLE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv';

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

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
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

    fetchRestaurants();

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

function fetchRestaurants() {
    let url = GOOGLE_SHEET_CSV_URL;

    if (window.location.protocol === 'file:') {
        console.warn("--- ADVERTENCIA DE SEGURIDAD ---");
        console.warn("Estás abriendo el archivo directamente (file://).");
        console.warn("El navegador bloqueará la carga de datos de Google Sheets por políticas de CORS.");
        console.warn("SOLUCIÓN: Usa un servidor local (Live Server en VS Code o ejecuta 'npx serve' en la carpeta).");
    }

    // Auto-convert standard sheet links to CSV export links
    if (url.includes('/edit')) {
        url = url.replace(/\/edit.*$/, '/export?format=csv');
    }

    Papa.parse(url, {
        download: true,
        header: true,
        complete: (results) => {
            let fetchedData = results.data || [];

            // DEBUG: Log the first few items to see what we actually got
            console.log("PapaParse Final Results:", results);

            // Check if the first line looks like HTML (common when redirected to a Google login page)
            if (fetchedData.length > 0 && Object.keys(fetchedData[0]).some(k => k.includes('<!DOCTYPE') || k.includes('<html'))) {
                console.error("ERROR: El Google Sheet parece ser PRIVADO. El servidor devolvió una página de login en lugar de datos.");
                console.warn("SOLUCIÓN: Cambia los permisos a 'Cualquier persona con el enlace'.");
                restaurants = MOCK_DATA;
                renderRanking();
                return;
            }

            // Filter out empty rows often found at the end of sheets
            fetchedData = fetchedData.filter(row => Object.values(row).some(v => String(v).trim() !== ""));

            if (fetchedData.length > 0) {
                // Determine if we have a valid 'name' column (case-insensitive)
                const firstRow = fetchedData[0];
                const nameKey = Object.keys(firstRow).find(k => k.toLowerCase() === 'name');

                if (nameKey) {
                    // Standardize all keys to lowercase to match the rest of the application
                    restaurants = fetchedData.map(row => {
                        const standardRow = {};
                        Object.keys(row).forEach(key => {
                            standardRow[key.toLowerCase()] = row[key];
                        });
                        return standardRow;
                    });
                    console.log("Datos cargados exitosamente desde Google Sheets:", restaurants);
                    renderRanking();
                    return;
                }
            }

            console.warn("No se encontró una columna 'name' o el Sheet está vacío. Usando datos locales.");
            restaurants = MOCK_DATA;
            renderRanking();
        },
        error: (err) => {
            console.error("Error crítico al obtener datos del Sheet:", err);
            restaurants = MOCK_DATA;
            renderRanking();
        }
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

        item.className = `ranking-item ${medalClass}`;
        item.innerHTML = `
            <div class="rank-number">${rank}</div>
            <div class="restaurant-info">
                <h3 class="restaurant-name">${res.name}</h3>
                <p class="restaurant-rating">${res.location || 'Luxury'} • ${res.rating}/10</p>
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
    restaurantContent.innerHTML = `
        <div class="detail-header">
            <h1 class="detail-title" style="font-family: var(--font-title); font-weight: 800; font-size: 2.5rem;">${res.name}</h1>
            <p class="subtitle">${res.location || 'Global Selection'}</p>
            <p style="margin-top: 1rem; color: var(--text-muted);">${res.description || 'Una joya gastronómica seleccionada para el ranking mensual.'}</p>
        </div>
        <div class="timeline" style="margin-top: 3rem;">
            <h2 style="font-family: var(--font-title); margin-bottom: 1.5rem;">Visitas</h2>
            ${MOCK_VISITS.map((v, i) => `
                <div class="visit-card" data-index="${i}">
                    <div class="visit-header">
                        <div class="visit-date">${v.date}</div>
                        <div class="sub-tabs">
                            <button class="sub-tab-btn active" data-subtab="fotos" data-visit="${i}">Fotos y Detalle</button>
                            <button class="sub-tab-btn" data-subtab="puntajes" data-visit="${i}">Puntajes</button>
                        </div>
                    </div>

                    <div id="fotos-${i}" class="sub-tab-content">
                        <p style="font-style: italic; margin-bottom: 1rem; margin-top: 1rem;">"${v.comment}"</p>
                        <div class="gallery" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                            ${v.images.map(img => `<img src="${img}" class="gallery-img" style="width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px;">`).join('')}
                        </div>
                    </div>

                    <div id="puntajes-${i}" class="sub-tab-content hidden">
                        <div class="puntajes-placeholder" style="margin-top: 1rem; padding: 1rem; background: rgba(0,0,0,0.02); border-radius: 12px; border: 1px dashed rgba(0,0,0,0.1);">
                            <p style="text-align: center; color: var(--text-muted); font-size: 0.9rem;">Próximamente: Detalle de votación de los críticos y desglose de puntajes por categoría.</p>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    // Sub-tab logic
    document.querySelectorAll('.sub-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const visitIdx = btn.getAttribute('data-visit');
            const target = btn.getAttribute('data-subtab');
            const card = btn.closest('.visit-card');

            // Update buttons in this card only
            card.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update content in this card only
            card.querySelectorAll('.sub-tab-content').forEach(content => content.classList.add('hidden'));
            card.querySelector(`#${target}-${visitIdx}`).classList.remove('hidden');
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
