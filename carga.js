/**
 * URL del Web App de Google Apps Script
 */
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw36jX3H8Ifc2rp7-ZtRROfmbApIbQMe3ZuKjnbXLArJj07kZGSDMWu3veRHPJ-TkGT/exec';

// --- Estado global ---
let appData = {
    critics: [],
    dates: [],
    restaurantsByDate: {}
};

let currentType = 'presencial';

// --- Cache DOM ---
const criticSelect = document.getElementById('critic-select');
const dateSelect = document.getElementById('date-select');
const restSelect = document.getElementById('restaurant-select');
const badgeType = document.getElementById('restaurant-type-badge');

const fieldContainer = document.getElementById('dynamic-fields');
const labelScore2 = document.getElementById('text-score-2');
const iconScore2 = document.getElementById('icon-score-2');
const labelScore3 = document.getElementById('text-score-3');
const iconScore3 = document.getElementById('icon-score-3');

const statusText = document.getElementById('status-text');
const form = document.getElementById('review-form');
const btnSubmit = document.getElementById('submit-btn');

// Modal de resultado
const resultModal = document.getElementById('result-modal');
const resultIconSuccess = document.getElementById('result-icon-success');
const resultIconError = document.getElementById('result-icon-error');
const resultTitle = document.getElementById('result-title');
const resultMessage = document.getElementById('result-message');
const resultBtn = document.getElementById('result-btn');

// Inputs de puntuación
const inAvg = document.getElementById('score-avg');
const in1 = document.getElementById('score-1'); // Comida
const in2 = document.getElementById('score-2'); // Lugar / Presentación
const in3 = document.getElementById('score-3'); // Atención / Precio

// --- Inicialización ---
document.addEventListener('DOMContentLoaded', init);

async function init() {
    if (SCRIPT_URL === 'AGREGA_AQUI_LA_URL_DE_TU_WEB_APP_APPS_SCRIPT') {
        statusText.textContent = "⚠ Atención: Falta configurar SCRIPT_URL en carga.js";
        statusText.style.color = "#e74c3c";
        return;
    }

    // Auto-cálculo del promedio
    in1.addEventListener('input', updateAverage);
    in2.addEventListener('input', updateAverage);
    in3.addEventListener('input', updateAverage);

    // Botón del modal para resetear
    resultBtn.addEventListener('click', resetForm);

    try {
        const res = await fetch(SCRIPT_URL);
        const json = await res.json();

        if (json.error) throw new Error(json.error);

        appData = json;
        console.log("Datos cargados:", appData);
        if (json._debug) console.log("Debug columnas:", json._debug);

        populateCritics();
        populateDates();

        statusText.textContent = "Datos sincronizados correctamente.";
        statusText.style.color = "#2ecc71";

    } catch (error) {
        console.error("Error:", error);
        statusText.textContent = `❌ Error: ${error.message || "No se pudo conectar"}.`;
        statusText.style.color = "#e74c3c";
    }
}

// --- Auto-cálculo del promedio ---
function updateAverage() {
    const v1 = parseFloat(in1.value);
    const v2 = parseFloat(in2.value);
    const v3 = parseFloat(in3.value);

    if (!isNaN(v1) && !isNaN(v2) && !isNaN(v3)) {
        inAvg.value = ((v1 + v2 + v3) / 3).toFixed(2);
    } else {
        inAvg.value = '';
    }
}

// --- Poblar selectores ---
function populateCritics() {
    criticSelect.innerHTML = '<option value="" disabled selected>Elegí tu nombre</option>';
    appData.critics.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.colIndex;
        opt.textContent = c.name;
        opt.dataset.name = c.name;
        criticSelect.appendChild(opt);
    });
    criticSelect.disabled = false;
}

function populateDates() {
    dateSelect.innerHTML = '<option value="" disabled selected>Elegí la fecha</option>';
    appData.dates.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        dateSelect.appendChild(opt);
    });
    dateSelect.disabled = false;
}

// --- Cambio de fecha → poblar restaurantes ---
dateSelect.addEventListener('change', (e) => {
    const selectedDate = e.target.value;
    const restaurants = appData.restaurantsByDate[selectedDate] || [];

    restSelect.innerHTML = '<option value="" disabled selected>Elegí el restaurante</option>';

    restaurants.forEach(r => {
        const opt = document.createElement('option');
        opt.value = String(r.rowIndex);
        opt.textContent = r.name;
        opt.dataset.type = r.type;
        opt.dataset.name = r.name;
        restSelect.appendChild(opt);
    });

    restSelect.disabled = false;
    fieldContainer.classList.remove('show');
    fieldContainer.style.display = 'none';
    badgeType.style.display = 'none';
});

// --- Cambio de restaurante → mostrar campos dinámicos ---
restSelect.addEventListener('change', (e) => {
    const selectedOpt = e.target.selectedOptions[0];
    if (!selectedOpt) return;

    const rawType = (selectedOpt.dataset.type || '').toUpperCase().trim();
    const isDelivery = rawType === 'D' || rawType === 'DELIVERY' || rawType === 'L';
    currentType = isDelivery ? 'delivery' : 'presencial';

    if (isDelivery) {
        labelScore2.textContent = "Presentación";
        iconScore2.setAttribute('data-lucide', 'package');
        labelScore3.textContent = "Precio";
        iconScore3.setAttribute('data-lucide', 'dollar-sign');
        badgeType.textContent = "📦 Modalidad: Delivery";
    } else {
        labelScore2.textContent = "Lugar";
        iconScore2.setAttribute('data-lucide', 'armchair');
        labelScore3.textContent = "Atención";
        iconScore3.setAttribute('data-lucide', 'smile');
        badgeType.textContent = "🍽️ Modalidad: Presencial";
    }

    badgeType.style.display = 'block';
    lucide.createIcons();

    inAvg.value = '';
    in1.value = '';
    in2.value = '';
    in3.value = '';

    fieldContainer.style.display = 'block';
    void fieldContainer.offsetWidth;
    fieldContainer.classList.add('show');
});

// --- Submit ---
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const criticOpt = criticSelect.selectedOptions[0];
    const restOpt = restSelect.selectedOptions[0];

    if (!criticOpt || !criticOpt.value || !restOpt || !restOpt.value) return;

    const comida = parseFloat(in1.value);
    const field2 = parseFloat(in2.value);
    const field3 = parseFloat(in3.value);

    if (isNaN(comida) || isNaN(field2) || isNaN(field3)) {
        showResult(false, "Campos incompletos", "Todos los puntajes son obligatorios.");
        return;
    }

    const payload = {
        rowIndex: parseInt(restOpt.value),
        colIndex: parseInt(criticOpt.value),
        criticName: criticOpt.dataset.name,
        restaurantName: restOpt.dataset.name,
        type: currentType,
        values: {
            comida: comida,
            field2: field2,
            field3: field3
        }
    };

    btnSubmit.disabled = true;
    btnSubmit.classList.add('loading');

    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (result.success) {
            showResult(true, "¡Reseña cargada!", result.message || "Los datos fueron guardados correctamente.");
        } else {
            showResult(false, "Error al guardar", result.message || "Ocurrió un problema al guardar la reseña.");
        }

    } catch (error) {
        showResult(false, "Error de conexión", error.message);
        console.error("Fetch POST Error:", error);
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.classList.remove('loading');
    }
});

// --- Modal de resultado ---
function showResult(success, title, message) {
    resultIconSuccess.style.display = success ? 'flex' : 'none';
    resultIconError.style.display = success ? 'none' : 'flex';
    resultTitle.textContent = title;
    resultMessage.textContent = message;
    resultBtn.textContent = success ? "Cargar otra reseña" : "Volver a intentar";
    resultModal.classList.remove('hidden');
}

function resetForm() {
    resultModal.classList.add('hidden');

    // Reset todos los selectors e inputs
    criticSelect.selectedIndex = 0;
    dateSelect.selectedIndex = 0;
    restSelect.innerHTML = '<option value="" disabled selected>Selecciona primero una fecha</option>';
    restSelect.disabled = true;

    fieldContainer.classList.remove('show');
    fieldContainer.style.display = 'none';
    badgeType.style.display = 'none';

    inAvg.value = '';
    in1.value = '';
    in2.value = '';
    in3.value = '';
}
