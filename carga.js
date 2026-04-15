/**
 * URL del Web App de Google Apps Script
 */
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwxeoejxV6citQRUl4PinrsDpnp3TNQBA7wrCXbHw2a02MvUsARYZnOwBWdVxEWjR6P/exec';

// --- Estado global ---
let appData = {
    critics: [],
    dates: [],
    restaurantsByDate: {}
};
let appToken = null;
let isSuccess = false;

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
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token') || urlParams.get('id');
        appToken = token;
        const reqUrl = SCRIPT_URL + (token ? `?token=${token}` : "");

        console.log('[Carga] Cargando datos desde:', reqUrl);
        const res = await fetch(reqUrl);
        console.log('[Carga] Respuesta del servidor:', res.status, res.statusText);
        const json = await res.json();
        console.log('[Carga] JSON recibido, keys:', Object.keys(json));

        if (json.error) throw new Error(json.error);

        appData = json;
        console.log("[Carga] Datos cargados:", appData);
        if (json._debug) console.log("[Carga] Debug columnas:", json._debug);

        populateCritics();
        populateDates();

        if (appData.tokenInfo) {
            autoSelectFromToken(appData.tokenInfo);
            statusText.textContent = "Datos sincronizados correctamente.";
            statusText.style.color = "#2ecc71";
        } else {
            // No hay tokenInfo: el token no existe, expiró o ya fue usado
            btnSubmit.disabled = true;
            if (appToken) {
                statusText.textContent = "❌ El link no es válido o ya fue usado.";
            } else {
                statusText.textContent = "❌ Acceso restringido. Se requiere un link de crítico.";
            }
        }

        // Forzar renderizado de iconos
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }

    } catch (error) {
        console.error('[Carga] Error cargando datos:', error);
        console.error('[Carga] Stack:', error.stack);
        statusText.textContent = `❌ Error: ${error.message || "No se pudo conectar"}.`;
        statusText.style.color = "#e74c3c";
        // Asegurar que todo esté deshabilitado en caso de error
        criticSelect.disabled = true;
        dateSelect.disabled = true;
        btnSubmit.disabled = true;
    }
}

// --- Autocompletado por link secreto ---
function autoSelectFromToken(info) {
    if (!info) return;

    // 1. Setear y bloquear crítico
    for (let i = 0; i < criticSelect.options.length; i++) {
        if (criticSelect.options[i].text === info.critico) {
            criticSelect.selectedIndex = i;
            break;
        }
    }
    criticSelect.disabled = true;

    // 2. Setear y bloquear fecha
    for (let i = 0; i < dateSelect.options.length; i++) {
        if (dateSelect.options[i].text === info.fecha) {
            dateSelect.selectedIndex = i;
            break;
        }
    }
    dateSelect.disabled = true;

    // 3. Disparar el evento change para poblar los restaurantes de esa fecha
    dateSelect.dispatchEvent(new Event('change'));

    // 4. Setear y bloquear restaurante
    for (let i = 0; i < restSelect.options.length; i++) {
        if (restSelect.options[i].text === info.restaurante) {
            restSelect.selectedIndex = i;
            break;
        }
    }
    restSelect.disabled = true;

    // 5. Disparar el evento change para mostrar los campos de puntuación
    restSelect.dispatchEvent(new Event('change'));
}

// --- Auto-cálculo del promedio ---
function updateAverage() {
    let v1 = parseFloat(in1.value);
    let v2 = parseFloat(in2.value);
    let v3 = parseFloat(in3.value);

    // Corregir valores fuera de rango o con exceso de decimales
    const checkAndFix = (input) => {
        let val = parseFloat(input.value);
        if (isNaN(val)) return NaN;
        val = Math.max(0, Math.min(10, val));
        input.value = val;
        return val;
    };

    v1 = checkAndFix(in1);
    v2 = checkAndFix(in2);
    v3 = checkAndFix(in3);

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
}

function populateDates() {
    dateSelect.innerHTML = '<option value="" disabled selected>Elegí la fecha</option>';
    appData.dates.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        dateSelect.appendChild(opt);
    });
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

    if (comida < 0 || comida > 10 || field2 < 0 || field2 > 10 || field3 < 0 || field3 > 10) {
        showResult(false, "Valores inválidos", "Los puntajes deben estar entre 0 y 10.");
        return;
    }

    const payload = {
        token: appToken,
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
        console.log('[Carga] Enviando reseña:', payload);
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        console.log('[Carga] Respuesta del servidor:', response.status, response.statusText);
        const result = await response.json();
        console.log('[Carga] Resultado:', result);

        if (result.success) {
            showResult(true, "¡Reseña cargada!", result.message || "Los datos fueron guardados correctamente.");
        } else {
            showResult(false, "Error al guardar", result.message || "Ocurrió un problema al guardar la reseña.");
        }

    } catch (error) {
        showResult(false, "Error de conexión", error.message);
        console.error('[Carga] Error enviando reseña:', error);
        console.error('[Carga] Stack:', error.stack);
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.classList.remove('loading');
    }
});

// --- Modal de resultado ---
function showResult(success, title, message) {
    isSuccess = success;
    resultIconSuccess.style.display = success ? 'flex' : 'none';
    resultIconError.style.display = success ? 'none' : 'flex';
    resultTitle.textContent = title;
    resultMessage.textContent = message;
    resultBtn.textContent = success ? "Ir al Inicio" : "Volver a intentar";
    resultModal.classList.remove('hidden');
}

function resetForm() {
    if (isSuccess) {
        window.location.href = 'index.html';
        return;
    }
    // Si hubo un error (no es success), simplemente ocultamos el modal.
    // Como los campos están bloqueados por token, borrarlos empêchería 
    // volver a intentar el submit con la misma data.
    resultModal.classList.add('hidden');
}
