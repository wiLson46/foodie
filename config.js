/**
 * Configuración compartida — Comer.ar
 * Cargar antes de main.js / admin.js / carga.js en cada HTML.
 */
window.COMER_CONFIG = {
    // Versión de la app. Se autoincrementa en cada commit vía el hook .githooks/pre-commit
    // (1.8 → 1.9 → 2.0 …; el minor va 0–9 y al llegar a 10 sube el major). Single source of
    // truth: se inyecta en los footers (elementos .app-version) de todas las páginas.
    VERSION: '2.2',

    SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwpKyJcHnDWDiSLZXz1_foSbxEKlyFyTqSaiK_22GzZUQuDLPLS_N078pU6aBR3_xy7/exec',
    TRACKING_URL: 'https://script.google.com/macros/s/AKfycbzliZeD8VmFGgCmvUMsm7MmwNDkvsIdsbF6RfY550eEW2Ls9VLHb1CnfljO_hAxaDt1/exec',
    MAIN_DATA_SHEET: 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv',

    // --- Alfajores ---
    ALFAJORES_SHEET: 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv&gid=317984049',

    // --- Login de Google (GIS) ---
    // Client ID de OAuth 2.0 (Web application) creado en Google Cloud Console.
    // Authorized JavaScript origins debe incluir https://wilson46.github.io y, para dev,
    // http://localhost:8000 / http://127.0.0.1:8000.
    GOOGLE_CLIENT_ID: '1016739440960-m9hh2gv6r3aj0c9lc9v8ic1h5u1i393k.apps.googleusercontent.com',

    // --- Admin ---
    // Allowlist para gatear el panel admin. SOLO se usa para UX (mostrar/ocultar el
    // panel según el email logueado). La seguridad real se valida en el backend
    // contra la Script Property ADMIN_EMAILS (Code.gs > requireAdmin).
    ADMIN_EMAILS: ['flashiando@gmail.com'],

    // --- Voto público ---
    // Los promedios públicos se sirven AGREGADOS (sin emails) desde el backend
    // (SCRIPT_URL?action=publicVotes). NO se lee la pestaña de votos por CSV para
    // no exponer los emails de los votantes.

    INITIAL_PHOTOS_LIMIT: 6,
    DEBUG: false
};

// Inyecta la versión (window.COMER_CONFIG.VERSION) en los footers de todas las páginas.
// Cada footer trae <span class="app-version"></span>; acá se rellena con el número actual.
(function () {
    function applyVersion() {
        var v = window.COMER_CONFIG && window.COMER_CONFIG.VERSION;
        if (!v) return;
        document.querySelectorAll('.app-version').forEach(function (el) {
            el.textContent = v;
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyVersion);
    } else {
        applyVersion();
    }
})();
