/**
 * Configuración compartida — Comer.ar
 * Cargar antes de main.js / admin.js / carga.js en cada HTML.
 */
window.COMER_CONFIG = {
    SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwT-nXuJoL1NHnTJlmEnusynJuRgICkXH0OkNTb_XGQnVS9X-AbVGnjd9ve0W12kR5H/exec',
    TRACKING_URL: 'https://script.google.com/macros/s/AKfycbzliZeD8VmFGgCmvUMsm7MmwNDkvsIdsbF6RfY550eEW2Ls9VLHb1CnfljO_hAxaDt1/exec',
    MAIN_DATA_SHEET: 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv',

    // --- Alfajores ---
    ALFAJORES_SHEET: 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv&gid=317984049',

    // --- Login de Google (GIS) ---
    // Client ID de OAuth 2.0 (Web application) creado en Google Cloud Console.
    // Authorized JavaScript origins debe incluir https://wilson46.github.io y, para dev,
    // http://localhost:8000 / http://127.0.0.1:8000.
    GOOGLE_CLIENT_ID: 'PEGAR_CLIENT_ID.apps.googleusercontent.com',

    // --- Voto público ---
    // Los promedios públicos se sirven AGREGADOS (sin emails) desde el backend
    // (SCRIPT_URL?action=publicVotes). NO se lee la pestaña de votos por CSV para
    // no exponer los emails de los votantes.

    INITIAL_PHOTOS_LIMIT: 6,
    DEBUG: false
};
