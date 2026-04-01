/**
 * REEMPLAZA ESTA URL CON TU URL DE DEPLOY DE GOOGLE APPS SCRIPT
 */
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxtDmXiZ6Wyr62IFdhTu-7D7G3wHS0FWiadNnxXi2RQ_DOZATN3_02Q6B916NPMxo7H/exec';

// --- Estado global ---
let appData = {
    critics: [],
    dates: [],
    restaurantsByDate: {}
};

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
const in2 = document.getElementById('score-2'); // Lugar/Presentacion
const in3 = document.getElementById('score-3'); // Atencion/Precio

// Alargar inicialización
document.addEventListener('DOMContentLoaded', init);

async function init() {
    if (SCRIPT_URL === 'AGREGA_AQUI_LA_URL_DE_TU_WEB_APP_APPS_SCRIPT') {
        statusText.textContent = "⚠ Atención: Falta configurar SCRIPT_URL en carga.js";
        statusText.style.color = "#e74c3c";
        return; // Detenemos la carga si no está configurado
    }

    try {
        const res = await fetch(SCRIPT_URL);
        const json = await res.json();

        if (json.error) throw new Error(json.error);

        appData = json;
        console.log("Datos cargados: ", appData);

        populateCritics();
        populateDates();

        statusText.textContent = "Datos sincronizados correctamente con Google Sheets.";
        statusText.style.color = "#2ecc71";

    } catch (error) {
        console.error("Error detallado al obtener datos:", error);
        statusText.textContent = `❌ Error: ${error.message || "No se pudo conectar con la base de datos"}.`;
        statusText.style.color = "#e74c3c";

        // Sugerencia para el usuario en consola
        console.warn("Sugerencias de depuración:\n1. Verifica que el script esté publicado como 'Cualquiera' (Anyone).\n2. Asegúrate de que el nombre de la pestaña en Google Sheets sea exactamente 'mainTable'.\n3. Revisa la consola de red (F12 > Network) para ver si hay bloqueos de CORS.");
    }
}

function populateCritics() {
    criticSelect.innerHTML = '<option value="" disabled selected>Elegí tu nombre</option>';
    appData.critics.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.colIndex;      // Grabamos la columna en el value
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

// Escuchar cambios de fecha para poblar restaurantes
dateSelect.addEventListener('change', (e) => {
    const selectedDate = e.target.value;
    const restaurants = appData.restaurantsByDate[selectedDate] || [];

    restSelect.innerHTML = '<option value="" disabled selected>Elegí el lugar o pedir a...</option>';

    restaurants.forEach(r => {
        const opt = document.createElement('option');
        opt.value = String(r.rowIndex); // Enviamos el row index en el value
        opt.textContent = r.name;
        opt.dataset.type = r.type;      // Guardamos el tipo (Presencial o Delivery)
        opt.dataset.name = r.name;
        restSelect.appendChild(opt);
    });

    restSelect.disabled = false;
    fieldContainer.classList.remove('show'); // Ocultar si cambia fecha
    badgeType.style.display = 'none';
});

// Escuchar cambios de restaurante para mostrar labels dinámicas
restSelect.addEventListener('change', (e) => {
    const selectedOpt = e.target.selectedOptions[0];
    if (!selectedOpt) return;

    const rawType = selectedOpt.dataset.type || '';
    const upperType = rawType.toUpperCase();

    // Asumir Presencial por defecto si no estipula claramente lo contrario
    const isDelivery = upperType.includes('D') || upperType.includes('L'); // "D" o "Delivery" o "Local"

    if (isDelivery) {
        labelScore2.textContent = "Presentación";
        iconScore2.setAttribute('data-lucide', 'package');

        labelScore3.textContent = "Precio";
        iconScore3.setAttribute('data-lucide', 'dollar-sign');

        badgeType.textContent = "Modalidad: Delivery";
    } else {
        labelScore2.textContent = "Lugar";
        iconScore2.setAttribute('data-lucide', 'armchair');

        labelScore3.textContent = "Atención";
        iconScore3.setAttribute('data-lucide', 'smile');

        badgeType.textContent = "Modalidad: Presencial";
    }

    badgeType.style.display = 'block';

    // Re-render strings to SVG
    lucide.createIcons();

    // Resetear valor de los text boxes (opcional)
    inAvg.value = '';
    in1.value = '';
    in2.value = '';
    in3.value = '';

    // Mostrar sección
    fieldContainer.style.display = 'block';

    // trigger reflow para dar espacio a la animación
    void fieldContainer.offsetWidth;
    fieldContainer.classList.add('show');
});

// Submit del formulario
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const criticOpt = criticSelect.selectedOptions[0];
    const restOpt = restSelect.selectedOptions[0];

    const colIndex = criticOpt.value;
    const criticName = criticOpt.dataset.name;
    const rowIndex = restOpt.value;
    const restName = restOpt.dataset.name;

    const avg = parseFloat(inAvg.value);
    const var1 = parseFloat(in1.value);
    const var2 = parseFloat(in2.value);
    const var3 = parseFloat(in3.value);

    // Creamos payload
    const payload = {
        rowIndex: parseInt(rowIndex),
        colIndex: parseInt(colIndex),
        criticName: criticName,
        restaurantName: restName,
        // El array es de 5 campos. El 5to lo dejamos vacío por convención de espacios.
        values: [avg, var1, var2, var3, ""]
    };

    // UI Loading
    msgBox.className = "message-box"; // reset
    msgBox.style.display = "none";
    btnSubmit.disabled = true;
    btnSubmit.classList.add('loading');

    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
            // No enviar Content-Type application/json porque dispara preflight requests de CORS muy restrictivos en GAS
            // fetch toma DOMString por defecto y envía plain/text lo cual GAS acepta en doPost()
        });

        const result = await response.json();

        if (result.success) {
            msgBox.textContent = result.message || "¡Reseña subida con éxito!";
            msgBox.classList.add('success');
            // Podríamos deshabilitar los selects temporalmente hasta q el usuario refresque,
            // o limpiar el formulario:
            inAvg.value = ''; in1.value = ''; in2.value = ''; in3.value = '';
        } else {
            msgBox.textContent = result.message || "Error al subir la reseña.";
            msgBox.classList.add('error');
        }

    } catch (error) {
        msgBox.textContent = "Error de red: " + error.message;
        msgBox.classList.add('error');
        console.error("Fetch POST Error: ", error);
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.classList.remove('loading');
    }
});
