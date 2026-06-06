/**
 * Configuración compartida — Comer.ar
 * Cargar antes de main.js / admin.js / carga.js en cada HTML.
 */
window.COMER_CONFIG = {
    SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbw_jpOh2RaRblRX5kZvxfBre99kHrdfagUr44I4hpese2LrqAtJRDK5Z0pdT7gGoIGQ/exec',
    TRACKING_URL: 'https://script.google.com/macros/s/AKfycbzliZeD8VmFGgCmvUMsm7MmwNDkvsIdsbF6RfY550eEW2Ls9VLHb1CnfljO_hAxaDt1/exec',
    MAIN_DATA_SHEET: 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv',
    VOTES_SHEET: 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv&gid=1795075061',

    // --- Alfajores ---
    ALFAJORES_SHEET: 'https://docs.google.com/spreadsheets/d/1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA/export?format=csv&gid=317984049',
    // TODO: pegar el gid de la pestaña de respuestas del Form de votación de alfajores.
    // Vacío => el detalle del alfajor muestra "sin votos" (degrada con elegancia).
    ALFAJORES_VOTES_SHEET: '',

    // --- Formularios de votación pública ---
    VOTE_FORM_URL: 'https://docs.google.com/forms/d/e/1FAIpQLSccteyXdae90sOgyONjnyXqJCjRWk211Vjk89aMDR0_3qyr-A/viewform',
    // TODO: pegar la URL (viewform) del Form de votación de alfajores.
    VOTE_FORM_URL_ALFAJOR: '',

    INITIAL_PHOTOS_LIMIT: 6,
    DEBUG: false
};
