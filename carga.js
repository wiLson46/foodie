/**
 * Carga (crítico) — carga.js
 */
const SCRIPT_URL = (window.COMER_CONFIG && window.COMER_CONFIG.SCRIPT_URL) || '';

let appData = {
    critics: [],
    dates: [],
    restaurantsByDate: {}
};
let appToken = null;
let isSuccess = false;

let currentType = 'presencial';
let currentFlow = 'restaurant'; // 'restaurant' | 'alfajor'
let appAlfajorInfo = null;

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

const resultModal = document.getElementById('result-modal');
const resultIconSuccess = document.getElementById('result-icon-success');
const resultIconError = document.getElementById('result-icon-error');
const resultTitle = document.getElementById('result-title');
const resultMessage = document.getElementById('result-message');
const resultBtn = document.getElementById('result-btn');

const inAvg = document.getElementById('score-avg');
const in1 = document.getElementById('score-1');
const in2 = document.getElementById('score-2');
const in3 = document.getElementById('score-3');

// --- Alfajor ---
const restaurantSection = document.getElementById('restaurant-form-section');
const alfajorSection = document.getElementById('alfajor-form-section');
const alfajorCriticInput = document.getElementById('alfajor-critic');
const alfajorNameInput = document.getElementById('alfajor-name');
const alfAvg = document.getElementById('alf-avg');
const alfInputs = {
    relleno: document.getElementById('alf-relleno'),
    tapas: document.getElementById('alf-tapas'),
    armonia: document.getElementById('alf-armonia'),
    presentacion: document.getElementById('alf-presentacion')
};
const btnSubmitAlfajor = document.getElementById('submit-btn-alfajor');

document.addEventListener('DOMContentLoaded', init);

async function init() {
    if (!SCRIPT_URL) {
        statusText.textContent = "⚠ Atención: Falta configurar SCRIPT_URL en config.js";
        statusText.style.color = "#e74c3c";
        return;
    }

    [in1, in2, in3].forEach(input => {
        input.addEventListener('input', () => {
            validateScoreInput(input);
            updateAverage();
        });
        input.addEventListener('blur', () => validateScoreInput(input));
    });

    Object.values(alfInputs).forEach(input => {
        if (!input) return;
        input.addEventListener('input', () => {
            validateScoreInput(input);
            updateAverageAlfajor();
        });
        input.addEventListener('blur', () => validateScoreInput(input));
    });

    resultBtn.addEventListener('click', resetForm);

    try {
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token') || urlParams.get('id');
        appToken = token;

        // Limpiar el token de la URL/historial tras leerlo (no se queda en el address bar)
        if (token) {
            try {
                const cleanUrl = window.location.pathname;
                history.replaceState({}, document.title, cleanUrl);
            } catch (e) {}
        }

        const reqUrl = SCRIPT_URL + (token ? `?token=${encodeURIComponent(token)}` : "");
        const res = await fetch(reqUrl);
        const json = await res.json();

        if (json.error) throw new Error(json.error);

        appData = json;

        if (appData.tokenInfo && appData.tokenInfo.type === 'alfajor') {
            // --- Flujo ALFAJOR ---
            currentFlow = 'alfajor';
            appAlfajorInfo = appData.tokenInfo;
            alfajorCriticInput.value = appData.tokenInfo.critico || '';
            alfajorNameInput.value = appData.tokenInfo.alfajor || '';
            alfajorSection.style.display = 'block';
            statusText.textContent = "Datos sincronizados correctamente.";
            statusText.style.color = "#2ecc71";
        } else if (appData.tokenInfo) {
            // --- Flujo RESTAURANTE ---
            currentFlow = 'restaurant';
            populateCritics();
            populateDates();
            autoSelectFromToken(appData.tokenInfo);
            restaurantSection.style.display = 'block';
            statusText.textContent = "Datos sincronizados correctamente.";
            statusText.style.color = "#2ecc71";
        } else {
            // Sin token válido: no mostramos ningún formulario (ambas secciones ocultas).
            btnSubmit.disabled = true;
            if (appToken) {
                statusText.textContent = "❌ El link no es válido o ya fue usado.";
            } else {
                statusText.textContent = "❌ Acceso restringido. Se requiere un link de crítico.";
            }
        }

        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }

    } catch (error) {
        console.error('[Carga] Error cargando datos:', error);
        statusText.textContent = `❌ Error: ${error.message || "No se pudo conectar"}.`;
        statusText.style.color = "#e74c3c";
        criticSelect.disabled = true;
        dateSelect.disabled = true;
        btnSubmit.disabled = true;
    }
}

function autoSelectFromToken(info) {
    if (!info) return;

    // 1. Critic
    for (let i = 0; i < criticSelect.options.length; i++) {
        if (criticSelect.options[i].text.trim() === (info.critico || '').trim()) {
            criticSelect.selectedIndex = i;
            break;
        }
    }
    criticSelect.disabled = true;

    // 2. Date — con fallback si el formato no matchea exactamente
    let dateFound = false;
    const normalFecha = (info.fecha || '').trim();
    for (let i = 0; i < dateSelect.options.length; i++) {
        if (dateSelect.options[i].text.trim() === normalFecha) {
            dateSelect.selectedIndex = i;
            dateFound = true;
            break;
        }
    }

    if (!dateFound && normalFecha) {
        const opt = document.createElement('option');
        opt.value = normalFecha;
        opt.textContent = normalFecha;
        dateSelect.appendChild(opt);
        dateSelect.value = normalFecha;

        // Registrar el restaurante del token en appData para que el change handler lo encuentre
        if (info.rowIndex && info.restaurante) {
            if (!appData.restaurantsByDate[normalFecha]) {
                appData.restaurantsByDate[normalFecha] = [];
            }
            const already = appData.restaurantsByDate[normalFecha].some(
                r => r.name.trim() === info.restaurante.trim()
            );
            if (!already) {
                appData.restaurantsByDate[normalFecha].push({
                    name: info.restaurante.trim(),
                    type: info.type || '',
                    rowIndex: info.rowIndex
                });
            }
        }
    }

    dateSelect.disabled = true;
    dateSelect.dispatchEvent(new Event('change'));

    // 3. Restaurant — con fallback si no matchea
    const normalRest = (info.restaurante || '').trim();
    let restFound = false;
    for (let i = 0; i < restSelect.options.length; i++) {
        if (restSelect.options[i].text.trim() === normalRest) {
            restSelect.selectedIndex = i;
            restFound = true;
            break;
        }
    }

    if (!restFound && info.rowIndex && normalRest) {
        const opt = document.createElement('option');
        opt.value = String(info.rowIndex);
        opt.textContent = normalRest;
        opt.dataset.type = info.type || '';
        opt.dataset.name = normalRest;
        restSelect.appendChild(opt);
        restSelect.value = String(info.rowIndex);
    }

    restSelect.disabled = true;
    restSelect.dispatchEvent(new Event('change'));
}

/**
 * Marca visual de validez sin auto-corregir el valor.
 */
function validateScoreInput(input) {
    if (!input) return false;
    if (input.value === '') {
        input.classList.remove('invalid');
        clearScoreError(input);
        return false;
    }
    const v = parseFloat(input.value);
    const valid = !isNaN(v) && v >= 0 && v <= 10;
    input.classList.toggle('invalid', !valid);
    if (!valid) showScoreError(input, 'Ingresá un número entre 0 y 10');
    else clearScoreError(input);
    return valid;
}

function showScoreError(input, msg) {
    let err = input.parentNode.querySelector('.error-msg');
    if (!err) {
        err = document.createElement('small');
        err.className = 'error-msg';
        err.style.color = '#e74c3c';
        err.style.fontSize = '0.8rem';
        err.style.marginTop = '0.25rem';
        input.parentNode.appendChild(err);
    }
    err.textContent = msg;
}

function clearScoreError(input) {
    const err = input.parentNode.querySelector('.error-msg');
    if (err) err.remove();
}

function updateAverage() {
    const v1 = parseFloat(in1.value);
    const v2 = parseFloat(in2.value);
    const v3 = parseFloat(in3.value);

    if (!isNaN(v1) && !isNaN(v2) && !isNaN(v3) &&
        v1 >= 0 && v1 <= 10 && v2 >= 0 && v2 <= 10 && v3 >= 0 && v3 <= 10) {
        inAvg.value = ((v1 + v2 + v3) / 3).toFixed(2);
    } else {
        inAvg.value = '';
    }
}

function updateAverageAlfajor() {
    const vals = Object.values(alfInputs).map(i => parseFloat(i.value));
    const allValid = vals.every(v => !isNaN(v) && v >= 0 && v <= 10);
    alfAvg.value = allValid ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : '';
}

async function submitAlfajor() {
    if (!appAlfajorInfo) return;

    let allValid = true;
    Object.values(alfInputs).forEach(i => {
        if (!validateScoreInput(i)) allValid = false;
    });

    if (!allValid) {
        showResult(false, "Valores inválidos", "Los 4 puntajes deben estar entre 0 y 10.");
        return;
    }

    const values = {};
    ['relleno', 'tapas', 'armonia', 'presentacion'].forEach(k => {
        values[k] = parseFloat(alfInputs[k].value);
    });

    const payload = {
        token: appToken,
        rowIndex: parseInt(appAlfajorInfo.rowIndex),
        colIndex: parseInt(appAlfajorInfo.colIndex),
        criticName: appAlfajorInfo.critico,
        restaurantName: appAlfajorInfo.alfajor,
        type: 'alfajor',
        values: values
    };

    btnSubmitAlfajor.disabled = true;
    btnSubmitAlfajor.classList.add('loading');

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
        console.error('[Carga] Error enviando reseña de alfajor:', error);
    } finally {
        btnSubmitAlfajor.disabled = false;
        btnSubmitAlfajor.classList.remove('loading');
    }
}

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
    if (typeof lucide !== 'undefined') lucide.createIcons();

    inAvg.value = '';
    in1.value = '';
    in2.value = '';
    in3.value = '';
    [in1, in2, in3].forEach(input => {
        input.classList.remove('invalid');
        clearScoreError(input);
    });

    fieldContainer.style.display = 'block';
    void fieldContainer.offsetWidth;
    fieldContainer.classList.add('show');
});

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Evita envíos duplicados si se dispara el submit dos veces seguidas.
    if (btnSubmit.disabled) return;

    if (currentFlow === 'alfajor') {
        await submitAlfajor();
        return;
    }

    const criticOpt = criticSelect.selectedOptions[0];
    const restOpt = restSelect.selectedOptions[0];

    if (!criticOpt || !criticOpt.value || !restOpt || !restOpt.value) return;

    const v1 = validateScoreInput(in1);
    const v2 = validateScoreInput(in2);
    const v3 = validateScoreInput(in3);

    if (!v1 || !v2 || !v3) {
        showResult(false, "Valores inválidos", "Los puntajes deben estar entre 0 y 10.");
        return;
    }

    const comida = parseFloat(in1.value);
    const field2 = parseFloat(in2.value);
    const field3 = parseFloat(in3.value);

    const payload = {
        token: appToken,
        rowIndex: parseInt(restOpt.value),
        colIndex: parseInt(criticOpt.value),
        criticName: criticOpt.dataset.name,
        restaurantName: restOpt.dataset.name,
        type: currentType,
        values: { comida, field2, field3 }
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
        console.error('[Carga] Error enviando reseña:', error);
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.classList.remove('loading');
    }
});

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
    resultModal.classList.add('hidden');
}
