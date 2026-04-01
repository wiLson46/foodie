/**
 * REEMPLAZA ESTA URL CON TU URL DE DEPLOY DE GOOGLE APPS SCRIPT
 */
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxRCTZV4StErQ_tesloY3-JIpI_xjB2rtCz7kLi116NoY5D03mHDV22caUi5Hmh8sYj/exec';

// --- Estado global ---
let appData = {
    critics: [],
    dates: [],
    restaurantsByDate: {}
};

// Tipo actual del restaurante seleccionado ('presencial' o 'delivery')
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
const msgBox = document.getElementById('message-container');

// Inputs de puntuación
const inAvg = document.getElementById('score-avg');
const in1 = document.getElementById('score-1'); // Comida (siempre)
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

    // Configurar auto-cálculo del promedio
    in1.addEventListener('input', updateAverage);
    in2.addEventListener('input', updateAverage);
    in3.addEventListener('input', updateAverage);

    try {
        const res = await fetch(SCRIPT_URL);
        const json = await res.json();

        if (json.error) throw new Error(json.error);

        appData = json;
        console.log("Datos cargados:", appData);

        // Mostrar info de debug si existe
        if (json._debug) {
            console.log("Debug - Columnas detectadas:", json._debug);
        }

        populateCritics();
        populateDates();

        statusText.textContent = "Datos sincronizados correctamente con Google Sheets.";
        statusText.style.color = "#2ecc71";

    } catch (error) {
        console.error("Error detallado al obtener datos:", error);
        statusText.textContent = `❌ Error: ${error.message || "No se pudo conectar con la base de datos"}.`;
        statusText.style.color = "#e74c3c";
        console.warn("Sugerencias:\n1. Verifica que el script esté publicado como 'Cualquiera' (Anyone).\n2. Asegúrate de que la pestaña se llame 'mainTable'.\n3. Después de cambiar Code.gs, crea una NUEVA implementación.");
    }
}

// --- Auto-cálculo del promedio ---
function updateAverage() {
    const v1 = parseFloat(in1.value);
    const v2 = parseFloat(in2.value);
    const v3 = parseFloat(in3.value);

    if (!isNaN(v1) && !isNaN(v2) && !isNaN(v3)) {
        const avg = (v1 + v2 + v3) / 3;
        inAvg.value = avg.toFixed(2);
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
    dateSelect.innerHTML = '<option value="" disabled selected>Elegí la fecha de la juntada</option>';
    appData.dates.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        dateSelect.appendChild(opt);
    });
    dateSelect.disabled = false;
}

// --- Evento: Cambio de fecha → poblar restaurantes ---
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

// --- Evento: Cambio de restaurante → mostrar campos dinámicos ---
restSelect.addEventListener('change', (e) => {
    const selectedOpt = e.target.selectedOptions[0];
    if (!selectedOpt) return;

    const rawType = (selectedOpt.dataset.type || '').toUpperCase().trim();

    // Determinar si es Delivery: buscamos "D" o "DELIVERY"
    // Presencial: "P" o "PRESENCIAL"
    const isDelivery = rawType === 'D' || rawType === 'DELIVERY';
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

    // Limpiar inputs
    inAvg.value = '';
    in1.value = '';
    in2.value = '';
    in3.value = '';

    // Mostrar sección con animación
    fieldContainer.style.display = 'block';
    void fieldContainer.offsetWidth; // trigger reflow
    fieldContainer.classList.add('show');
});

// --- Submit ---
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const criticOpt = criticSelect.selectedOptions[0];
    const restOpt = restSelect.selectedOptions[0];

    if (!criticOpt || !criticOpt.value || !restOpt || !restOpt.value) {
        msgBox.textContent = "Por favor completá todos los campos.";
        msgBox.className = "message-box error";
        return;
    }

    const colIndex = parseInt(criticOpt.value);
    const criticName = criticOpt.dataset.name;
    const rowIndex = parseInt(restOpt.value);
    const restName = restOpt.dataset.name;

    const comida = parseFloat(in1.value);
    const field2 = parseFloat(in2.value);
    const field3 = parseFloat(in3.value);

    if (isNaN(comida) || isNaN(field2) || isNaN(field3)) {
        msgBox.textContent = "Todos los puntajes son obligatorios.";
        msgBox.className = "message-box error";
        return;
    }

    const avg = parseFloat(((comida + field2 + field3) / 3).toFixed(2));

    const payload = {
        rowIndex: rowIndex,
        colIndex: colIndex,
        criticName: criticName,
        restaurantName: restName,
        type: currentType,
        values: {
            rating: avg,
            comida: comida,
            field2: field2,
            field3: field3
        }
    };

    // UI Loading
    msgBox.className = "message-box";
    msgBox.style.display = "none";
    btnSubmit.disabled = true;
    btnSubmit.classList.add('loading');

    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (result.success) {
            msgBox.textContent = `✅ ${result.message || "¡Reseña subida con éxito!"}`;
            msgBox.className = "message-box success";
            inAvg.value = '';
            in1.value = '';
            in2.value = '';
            in3.value = '';
        } else {
            msgBox.textContent = result.message || "Error al subir la reseña.";
            msgBox.className = "message-box error";
        }

    } catch (error) {
        msgBox.textContent = "Error de red: " + error.message;
        msgBox.className = "message-box error";
        console.error("Fetch POST Error:", error);
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.classList.remove('loading');
    }
});
