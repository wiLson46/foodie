/**
 * Admin Panel JS — admin.js
 * Lógica para el panel de administración de Comer.ar
 *
 * Requiere: admin.html + Code.gs deployado como Web App
 */

// =============================================
// CONFIGURACIÓN
// =============================================
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw6Vg9eGEYZPR6HgcGxfbRR1gU9QRUPtDP_GE9mteCO5WcFbLHHyYQGkcw_1uDRZ_CX/exec';

// =============================================
// ESTADO GLOBAL
// =============================================
let adminData = {
    restaurants: [],
    critics: [],
    columnMap: {},
    headers: []
};

let generatedUrl = '';

// =============================================
// DOM CACHE
// =============================================
const statusText = document.getElementById('status-text');
const adminLoader = document.getElementById('admin-loader');
const adminContent = document.getElementById('admin-content');
const restaurantsList = document.getElementById('restaurants-list');
const restaurantCount = document.getElementById('restaurant-count');
const toastContainer = document.getElementById('toast-container');

// =============================================
// INICIALIZACIÓN
// =============================================
document.addEventListener('DOMContentLoaded', initAdmin);

async function initAdmin() {
    if (!SCRIPT_URL || SCRIPT_URL.includes('AGREGA_AQUI')) {
        statusText.textContent = '⚠ Falta configurar SCRIPT_URL en admin.js';
        statusText.style.color = '#e74c3c';
        adminLoader.innerHTML = '<p style="color: #e74c3c;">Configurá la URL del script en admin.js</p>';
        return;
    }

    try {
        const res = await fetch(SCRIPT_URL + '?action=admin');
        const json = await res.json();

        if (json.error) throw new Error(json.error);

        adminData = json;

        // --- Ordenamiento Global ---
        // 1. Críticos: Orden Alfabético
        if (adminData.critics) {
            adminData.critics.sort((a, b) => a.localeCompare(b));
        }

        // 2. Restaurantes: Nombre (A-Z) y luego Fecha (Descendente)
        if (adminData.restaurants) {
            adminData.restaurants.sort((a, b) => {
                const nameA = (a.name || '').toLowerCase();
                const nameB = (b.name || '').toLowerCase();
                if (nameA < nameB) return -1;
                if (nameA > nameB) return 1;

                // Si se llama igual, la fecha más nueva primero
                const dateA = (a.fecha || '').split('/').reverse().join('');
                const dateB = (b.fecha || '').split('/').reverse().join('');
                return dateB.localeCompare(dateA);
            });
        }

        console.log('Admin data loaded (sorted):', adminData);

        if (adminData.nextId) {
            const newIdInput = document.getElementById('new-id');
            if (newIdInput) newIdInput.value = adminData.nextId;
        }

        // Render UI
        renderRestaurants();
        populateLinkSelectors();
        setupSmartPaste();

        // Show content
        adminLoader.style.display = 'none';
        adminContent.style.display = 'block';

        statusText.textContent = `✅ ${adminData.restaurants.length} restaurantes cargados`;
        statusText.style.color = '#2ecc71';

        // Re-initialize lucide icons for dynamic content
        lucide.createIcons();

    } catch (error) {
        console.error('Error loading admin data:', error);
        statusText.textContent = `❌ Error: ${error.message}`;
        statusText.style.color = '#e74c3c';
        adminLoader.innerHTML = `
            <p style="color: #e74c3c; margin-bottom: 1rem;">No se pudieron cargar los datos</p>
            <button class="admin-btn btn-save" style="max-width: 200px; margin: 0 auto;" onclick="location.reload()">
                Reintentar
            </button>
        `;
    }
}

// =============================================
// SECCIONES COLAPSABLES
// =============================================
function toggleSection(name) {
    const body = document.getElementById(`body-${name}`);
    const chevron = document.getElementById(`chevron-${name}`);
    const header = body.previousElementSibling;

    body.classList.toggle('open');
    chevron.classList.toggle('open');
    header.classList.toggle('open');
}

// =============================================
// RENDERIZAR RESTAURANTES
// =============================================
function renderRestaurants(filterText = '') {
    const restaurantsList = document.getElementById('restaurants-list');

    // Solo mostrar resultados si hay algo escrito en el buscador
    if (!filterText.trim()) {
        restaurantsList.innerHTML = `
            <div class="empty-state" style="padding: 3rem 1.5rem; opacity: 0.5;">
                <i data-lucide="search" style="width: 40px; height: 40px; margin-bottom: 1rem;"></i>
                <p style="font-weight: 500;">Ingresá un nombre para gestionar restaurantes</p>
            </div>
        `;
        restaurantCount.textContent = '0';
        lucide.createIcons();
        return;
    }

    if (!adminData.restaurants || adminData.restaurants.length === 0) {
        restaurantsList.innerHTML = `
            <div class="empty-state">
                <i data-lucide="inbox"></i>
                <p>No hay restaurantes en la tabla</p>
            </div>
        `;
        restaurantCount.textContent = '0';
        lucide.createIcons();
        return;
    }

    const filtered = adminData.restaurants.filter(r => {
        const q = filterText.toLowerCase();
        return (r.name || '').toLowerCase().includes(q) ||
            (r.location || '').toLowerCase().includes(q) ||
            (r.id || '').toLowerCase().includes(q);
    });

    restaurantCount.textContent = filtered.length;

    if (filtered.length === 0) {
        restaurantsList.innerHTML = `
            <div class="empty-state">
                <i data-lucide="search-x"></i>
                <p>No se encontraron restaurantes</p>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    let html = '';
    filtered.forEach((r, idx) => {
        const modalidad = (r.presencialDelivery || '').toUpperCase();
        const isPresencial = modalidad === 'P' || modalidad === 'PRESENCIAL' || modalidad === '';
        const globalIdx = adminData.restaurants.indexOf(r);

        html += `
        <div class="restaurant-block" id="block-${globalIdx}">
            <div class="restaurant-block-header">
                <div class="restaurant-block-name">
                    ${r.name || 'Sin nombre'}
                </div>
            </div>

            <div class="restaurant-fields-grid">
                <div class="admin-form-group">
                    <label class="admin-label"><i data-lucide="hash"></i> ID</label>
                    <input type="text" class="admin-input" id="edit-id-${globalIdx}" value="${escapeHtml(r.id || '')}" disabled style="background: rgba(0,0,0,0.05); font-weight: bold;">
                </div>
                <div class="admin-form-group">
                    <label class="admin-label"><i data-lucide="store"></i> Nombre</label>
                    <input type="text" class="admin-input" id="edit-name-${globalIdx}" value="${escapeHtml(r.name || '')}">
                </div>
                <div class="admin-form-group">
                    <label class="admin-label"><i data-lucide="map-pin"></i> Ubicación</label>
                    <input type="text" class="admin-input" id="edit-location-${globalIdx}" value="${escapeHtml(r.location || '')}">
                </div>
                <div class="admin-form-group field-full">
                    <label class="admin-label"><i data-lucide="file-text"></i> Descripción</label>
                    <textarea class="admin-textarea" id="edit-description-${globalIdx}">${escapeHtml(r.description || '')}</textarea>
                </div>
                <div class="admin-form-group">
                    <label class="admin-label"><i data-lucide="calendar"></i> Fecha</label>
                    <input type="text" class="admin-input" id="edit-fecha-${globalIdx}" value="${escapeHtml(r.fecha || '')}">
                </div>
                <div class="admin-form-group">
                    <label class="admin-label"><i data-lucide="navigation"></i> Dirección</label>
                    <input type="text" class="admin-input" id="edit-direccion-${globalIdx}" value="${escapeHtml(r.direccion || '')}">
                </div>
                <div class="admin-form-group">
                    <label class="admin-label"><i data-lucide="phone"></i> Teléfono</label>
                    <input type="text" class="admin-input" id="edit-telefono-${globalIdx}" value="${escapeHtml(r.telefono || '')}">
                </div>
                <div class="admin-form-group">
                    <label class="admin-label"><i data-lucide="camera"></i> Instagram</label>
                    <input type="text" class="admin-input" id="edit-instagram-${globalIdx}" value="${escapeHtml(r.instagram || '')}">
                </div>
                <div class="admin-form-group">
                    <label class="admin-label"><i data-lucide="map"></i> Link Mapa</label>
                    <input type="url" class="admin-input" id="edit-linkMapa-${globalIdx}" value="${escapeHtml(r.linkMapa || '')}">
                </div>
                <div class="admin-form-group">
                    <label class="admin-label"><i data-lucide="truck"></i> Modalidad</label>
                    <div class="radio-group">
                        <div class="radio-option">
                            <input type="radio" name="edit-modalidad-${globalIdx}" id="edit-modal-p-${globalIdx}" value="P" ${isPresencial ? 'checked' : ''}>
                            <label for="edit-modal-p-${globalIdx}">🍽️ Presencial</label>
                        </div>
                        <div class="radio-option">
                            <input type="radio" name="edit-modalidad-${globalIdx}" id="edit-modal-d-${globalIdx}" value="D" ${!isPresencial ? 'checked' : ''}>
                            <label for="edit-modal-d-${globalIdx}">📦 Delivery</label>
                        </div>
                    </div>
                </div>
                <div class="admin-form-group">
                    <label class="admin-label"><i data-lucide="shopping-bag"></i> Pedido por</label>
                    <input type="text" class="admin-input" id="edit-pedidoPor-${globalIdx}" value="${escapeHtml(r.pedidoPor || '')}">
                </div>
            </div>

            <button type="button" class="admin-btn btn-save" id="btn-save-${globalIdx}" onclick="saveRestaurant(${globalIdx})">
                <span class="btn-label"><i data-lucide="save"></i> Guardar Cambios</span>
                <div class="btn-spinner"></div>
            </button>
        </div>
        `;
    });

    restaurantsList.innerHTML = html;
    lucide.createIcons();
}

// =============================================
// FILTRAR RESTAURANTES (Search bar)
// =============================================
function filterRestaurants() {
    const query = document.getElementById('search-restaurants').value;
    renderRestaurants(query);
}

// =============================================
// GUARDAR RESTAURANTE (Actualizar fila)
// =============================================
async function saveRestaurant(idx) {
    const r = adminData.restaurants[idx];
    if (!r) return;

    const btn = document.getElementById(`btn-save-${idx}`);
    setButtonLoading(btn, true);

    const modalidadEl = document.querySelector(`input[name="edit-modalidad-${idx}"]:checked`);

    const data = {
        id: document.getElementById(`edit-id-${idx}`).value.trim(),
        name: document.getElementById(`edit-name-${idx}`).value.trim(),
        location: document.getElementById(`edit-location-${idx}`).value.trim(),
        description: document.getElementById(`edit-description-${idx}`).value.trim(),
        fecha: document.getElementById(`edit-fecha-${idx}`).value.trim(),
        direccion: document.getElementById(`edit-direccion-${idx}`).value.trim(),
        telefono: document.getElementById(`edit-telefono-${idx}`).value.trim(),
        instagram: document.getElementById(`edit-instagram-${idx}`).value.trim(),
        linkMapa: document.getElementById(`edit-linkMapa-${idx}`).value.trim(),
        presencialDelivery: modalidadEl ? modalidadEl.value : 'P',
        pedidoPor: document.getElementById(`edit-pedidoPor-${idx}`).value.trim()
    };

    if (!data.name) {
        showToast('El nombre del restaurante es obligatorio', 'error');
        setButtonLoading(btn, false);
        return;
    }

    try {
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'updateRestaurant',
                rowIndex: r.rowIndex,
                data: data
            })
        });

        const result = await res.json();

        if (result.success) {
            // Actualizar datos locales
            Object.assign(adminData.restaurants[idx], data);
            showToast(`✅ "${data.name}" guardado con éxito`, 'success');

            // Breve flash visual en el bloque
            const block = document.getElementById(`block-${idx}`);
            if (block) {
                block.style.borderColor = '#2ecc71';
                setTimeout(() => { block.style.borderColor = ''; }, 1500);
            }
        } else {
            showToast(`❌ Error: ${result.message}`, 'error');
        }

    } catch (error) {
        console.error('Error saving restaurant:', error);
        showToast(`❌ Error de conexión: ${error.message}`, 'error');
    } finally {
        setButtonLoading(btn, false);
    }
}

// =============================================
// CREAR RESTAURANTE
// =============================================
async function createRestaurant() {
    const btn = document.getElementById('btn-create-restaurant');
    setButtonLoading(btn, true);

    const modalidadEl = document.querySelector('input[name="new-modalidad"]:checked');

    const data = {
        name: document.getElementById('new-name').value.trim(),
        location: document.getElementById('new-location').value.trim(),
        description: document.getElementById('new-description').value.trim(),
        fecha: document.getElementById('new-fecha').value.trim(),
        direccion: document.getElementById('new-direccion').value.trim(),
        telefono: document.getElementById('new-telefono').value.trim(),
        instagram: document.getElementById('new-instagram').value.trim(),
        linkMapa: document.getElementById('new-linkMapa').value.trim(),
        presencialDelivery: modalidadEl ? modalidadEl.value : 'P',
        pedidoPor: document.getElementById('new-pedidoPor').value.trim()
    };

    if (!data.name) {
        showToast('El nombre del restaurante es obligatorio', 'error');
        setButtonLoading(btn, false);
        return;
    }

    try {
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'addRestaurant',
                data: data
            })
        });

        const result = await res.json();

        if (result.success) {
            showToast(`✅ "${data.name}" creado exitosamente`, 'success');

            // Agregar al estado local y re-renderizar
            data.rowIndex = result.rowIndex;
            if (result.idGenerado) {
                data.id = result.idGenerado;
                adminData.nextId = ("0000000" + (parseInt(result.idGenerado, 10) + 1)).slice(-7);
            }
            adminData.restaurants.push(data);
            renderRestaurants();
            populateLinkSelectors();

            // Limpiar formulario y actualizar el nuevo ID visible
            clearNewForm();

            const newIdInput = document.getElementById('new-id');
            if (newIdInput && adminData.nextId) {
                newIdInput.value = adminData.nextId;
            }

        } else {
            showToast(`❌ Error: ${result.message}`, 'error');
        }

    } catch (error) {
        console.error('Error creating restaurant:', error);
        showToast(`❌ Error de conexión: ${error.message}`, 'error');
    } finally {
        setButtonLoading(btn, false);
    }
}

function clearNewForm() {
    const fields = ['name', 'location', 'description', 'fecha', 'direccion', 'telefono', 'instagram', 'linkMapa', 'pedidoPor'];
    fields.forEach(f => {
        const el = document.getElementById(`new-${f}`);
        if (el) el.value = '';
    });
    document.getElementById('new-modal-p').checked = true;
}

// =============================================
// GENERADOR DE LINKS
// =============================================

// One-time listener setup (called once at init)
let linkSelectorsInitialized = false;

function populateLinkSelectors() {
    // Críticos (Ya vienen ordenados globalmente)
    const criticoSelect = document.getElementById('link-critico');
    criticoSelect.innerHTML = '<option value="" disabled selected>Seleccioná un crítico</option>';
    (adminData.critics || []).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        criticoSelect.appendChild(opt);
    });

    // Restaurantes (Únicos y ordenados)
    const restoSelect = document.getElementById('link-restaurante');
    const fechaSelect = document.getElementById('link-fecha');

    restoSelect.innerHTML = '<option value="" disabled selected>Selecciona restaurante</option>';
    fechaSelect.innerHTML = '<option value="" disabled selected>Elige fecha</option>';
    fechaSelect.disabled = true;

    // Obtener nombres únicos manteniendo el orden actual (que ya es alfabético)
    const uniqueNames = [];
    (adminData.restaurants || []).forEach(r => {
        if (!uniqueNames.includes(r.name)) {
            uniqueNames.push(r.name);
        }
    });

    uniqueNames.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        restoSelect.appendChild(opt);
    });

    // Listener para poblar fechas al elegir restaurante (ya vienen ordenadas descendente)
    if (!linkSelectorsInitialized) {
        restoSelect.addEventListener('change', () => {
            const selectedName = restoSelect.value;
            fechaSelect.innerHTML = '<option value="" disabled selected>Elige fecha</option>';

            const matches = adminData.restaurants.filter(r => r.name === selectedName);

            if (matches.length > 0) {
                matches.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m.fecha;
                    opt.textContent = m.fecha || 'Sin fecha';
                    fechaSelect.appendChild(opt);
                });
                fechaSelect.disabled = false;
                // Auto-seleccionar la primera fecha si solo hay una
                if (matches.length === 1) {
                    fechaSelect.selectedIndex = 1;
                }
            } else {
                fechaSelect.disabled = true;
            }
        });
        linkSelectorsInitialized = true;
    }
}

async function generateLink() {
    const btn = document.getElementById('btn-generate-link');
    const critico = document.getElementById('link-critico').value;
    const restaurante = document.getElementById('link-restaurante').value;
    const fecha = document.getElementById('link-fecha').value;

    if (!critico || !restaurante || !fecha) {
        showToast('Seleccioná un crítico, un restaurante y una fecha', 'error');
        return;
    }

    setButtonLoading(btn, true);

    try {
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'generateToken',
                critico: critico,
                fecha: fecha,
                restaurante: restaurante
            })
        });

        const result = await res.json();

        if (result.success) {
            // Construir URL relativa a carga.html usando el host actual
            const currentUrl = new URL(window.location.href);
            const pathParts = currentUrl.pathname.split('/');
            pathParts[pathParts.length - 1] = 'carga.html';
            currentUrl.pathname = pathParts.join('/');
            currentUrl.search = '?token=' + result.token;

            generatedUrl = currentUrl.toString();

            // Show result
            const resultDiv = document.getElementById('link-result');
            const urlDiv = document.getElementById('link-result-url');
            urlDiv.textContent = generatedUrl;
            resultDiv.classList.add('show');

            showToast(`✅ ${result.message}`, 'success');

            // Auto-copy to clipboard
            await copyToClipboard(generatedUrl);

            lucide.createIcons();
        } else {
            showToast(`❌ Error: ${result.message}`, 'error');
        }

    } catch (error) {
        console.error('Error generating link:', error);
        showToast(`❌ Error de conexión: ${error.message}`, 'error');
    } finally {
        setButtonLoading(btn, false);
    }
}

async function copyLink() {
    if (!generatedUrl) {
        showToast('No hay link generado para copiar', 'error');
        return;
    }
    await copyToClipboard(generatedUrl);
}

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('📋 Link copiado al portapapeles', 'info');
    } catch (err) {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('📋 Link copiado al portapapeles', 'info');
    }
}

// =============================================
// TOAST NOTIFICATIONS
// =============================================
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    toastContainer.appendChild(toast);

    // Auto-remove after 3 seconds
    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
    }, 3000);
}

// =============================================
// UTILIDADES UI
// =============================================
function setButtonLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
        btn.classList.add('loading');
        btn.disabled = true;
    } else {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// =============================================
// SMART PASTE (JSON Auto-fill)
// =============================================
function setupSmartPaste() {
    const pasteArea = document.getElementById('smart-paste');
    if (!pasteArea) return;

    // Saneamiento de seguridad estricto (Previene vulnerabilidades XSS por inyección)
    const sanitizePasteValue = (val) => {
        if (typeof val !== 'string') return String(val || '');
        // Eliminar posibles etiquetas HTML, scripts, iframes...
        return val.replace(/<[^>]*>?/gm, '').trim();
    };

    pasteArea.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        if (!val || val.length < 10) return; // Validación básica de tamaño antes de intentar parsear

        try {
            const data = JSON.parse(val);

            // Mapeo seguro de claves del origen Gemini a los Inputs de admin.html
            const mapping = {
                name: 'new-name',
                location: 'new-location',
                description: 'new-description',
                fecha: 'new-fecha',
                direccion: 'new-direccion',
                telefono: 'new-telefono',
                instagram: 'new-instagram',
                linkMapa: 'new-linkMapa',
                pedidoPor: 'new-pedidoPor'
            };

            for (const key in mapping) {
                if (data[key] !== undefined && data[key] !== null) {
                    const input = document.getElementById(mapping[key]);
                    if (input) {
                        input.value = sanitizePasteValue(data[key]);
                    }
                }
            }

            // Tratamiento especial radio button
            if (data.modalidad) {
                const modInput = sanitizePasteValue(String(data.modalidad)).toUpperCase();
                if (modInput === 'D' || modInput.includes('DELIVERY')) {
                    document.getElementById('new-modal-d').checked = true;
                } else if (modInput === 'P' || modInput.includes('PRESENCIAL')) {
                    document.getElementById('new-modal-p').checked = true;
                }
            }

            pasteArea.value = ''; // Limpiar el pegado exitoso
            showToast('✅ Campos completados exitosamente', 'success');

        } catch (error) {
            // Falla de parseo silenciada (el usuario aún está pegando/escribiendo o pego mal)
        }
    });
}
