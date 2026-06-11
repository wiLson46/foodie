/**
 * Admin Panel JS — admin.js
 * Lógica para el panel de administración de Comer.ar
 *
 * Requiere: admin.html + Code.gs deployado como Web App + ADMIN_SECRET en Script Properties.
 */

const SCRIPT_URL = (window.COMER_CONFIG && window.COMER_CONFIG.SCRIPT_URL) || '';

let adminData = {
    restaurants: [],
    critics: [],
    columnMap: {},
    headers: []
};

let generatedUrl = '';
let linkType = 'restaurant'; // 'restaurant' | 'alfajor' (generador de links)

const statusText = document.getElementById('status-text');
const adminLoader = document.getElementById('admin-loader');
const adminContent = document.getElementById('admin-content');
const restaurantsList = document.getElementById('restaurants-list');
const restaurantCount = document.getElementById('restaurant-count');
const toastContainer = document.getElementById('toast-container');

// =============================================
// AUTENTICACIÓN — Google login (solo admins)
// =============================================
// La contraseña fue reemplazada por login de Google. Gatea por email: el chequeo
// del front (COMER_CONFIG.ADMIN_EMAILS) es solo UX; la seguridad real la valida
// el backend (Code.gs > requireAdmin) verificando el ID token contra su allowlist.

const adminGate = document.getElementById('admin-gate');
const adminGateLogin = document.getElementById('admin-gate-login');
const adminGateDenied = document.getElementById('admin-gate-denied');
const adminLoginBtn = document.getElementById('admin-login-btn');
const adminDeniedEmail = document.getElementById('admin-denied-email');

function isAdminEmail(email) {
    const list = (window.COMER_CONFIG && window.COMER_CONFIG.ADMIN_EMAILS) || [];
    return !!email && list.indexOf(String(email).toLowerCase()) !== -1;
}

// Devuelve el ID token de Google para autorizar las requests al backend.
// ComerAuth.getCredential() re-promptea si la sesión expiró; si no hay, lanza.
async function getCred() {
    const cred = await ComerAuth.getCredential();
    if (!cred) throw new Error('Tu sesión expiró. Volvé a iniciar sesión.');
    return cred;
}

function showGateLogin() {
    if (adminLoader) adminLoader.style.display = 'none';
    if (adminContent) adminContent.style.display = 'none';
    if (adminGateDenied) adminGateDenied.style.display = 'none';
    if (adminGateLogin) adminGateLogin.style.display = 'block';
    if (adminGate) adminGate.style.display = 'flex';
    if (statusText) { statusText.textContent = 'Iniciá sesión para administrar'; statusText.style.color = ''; }
    if (adminLoginBtn && window.ComerAuth) {
        ComerAuth.renderButton(adminLoginBtn, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with' });
    }
}

function showGateDenied(email) {
    if (adminLoader) adminLoader.style.display = 'none';
    if (adminContent) adminContent.style.display = 'none';
    if (adminGateLogin) adminGateLogin.style.display = 'none';
    if (adminDeniedEmail) adminDeniedEmail.textContent = email || '';
    if (adminGateDenied) adminGateDenied.style.display = 'block';
    if (adminGate) adminGate.style.display = 'flex';
    if (statusText) { statusText.textContent = 'Cuenta sin permisos de admin'; statusText.style.color = '#e74c3c'; }
}

function hideGate() {
    if (adminGate) adminGate.style.display = 'none';
}

// =============================================
// INICIALIZACIÓN
// =============================================
let adminLoaded = false;

document.addEventListener('DOMContentLoaded', () => {
    if (!window.ComerAuth) {
        if (statusText) {
            statusText.textContent = '⚠ Falta auth.js (login de Google)';
            statusText.style.color = '#e74c3c';
        }
        if (adminLoader) adminLoader.innerHTML = '<p style="color:#e74c3c;">No se pudo cargar el login de Google (auth.js).</p>';
        return;
    }
    const switchBtn = document.getElementById('admin-switch-account');
    if (switchBtn) switchBtn.addEventListener('click', () => ComerAuth.logout());

    ComerAuth.subscribe(onAuthChange);
    ComerAuth.init();
});

// Reacciona a cambios de sesión: login / sin permisos / carga del panel (una sola vez).
function onAuthChange(user) {
    if (!user) {
        adminLoaded = false;
        showGateLogin();
    } else if (!isAdminEmail(user.email)) {
        adminLoaded = false;
        showGateDenied(user.email);
    } else if (!adminLoaded) {
        adminLoaded = true;
        hideGate();
        initAdmin();
    }
}

async function initAdmin() {
    if (!SCRIPT_URL) {
        statusText.textContent = '⚠ Falta configurar SCRIPT_URL en config.js';
        statusText.style.color = '#e74c3c';
        adminLoader.innerHTML = '<p style="color: #e74c3c;">Configurá la URL del script en config.js</p>';
        return;
    }

    if (adminLoader) adminLoader.style.display = '';

    // Los endpoints GET admin/getStats/getUsers se autorizan con el ID token de Google.
    let credQS;
    try {
        credQS = '&credential=' + encodeURIComponent(await getCred());
    } catch (e) {
        adminLoaded = false;
        showGateLogin();
        return;
    }

    try {
        // Carga en paralelo: datos admin + stats + usuarios
        const [adminRes, statsRes, usersRes] = await Promise.allSettled([
            fetch(SCRIPT_URL + '?action=admin' + credQS).then(r => r.json()),
            fetch(SCRIPT_URL + '?action=getStats' + credQS).then(r => r.json()),
            fetch(SCRIPT_URL + '?action=getUsers' + credQS).then(r => r.json())
        ]);

        if (adminRes.status !== 'fulfilled') throw adminRes.reason || new Error('Error cargando datos');
        const json = adminRes.value;
        if (json.error) {
            // El backend rechazó la sesión: volvemos al gate para reloguear con una cuenta admin.
            if (/no autorizado/i.test(json.error)) { adminLoaded = false; showGateLogin(); return; }
            throw new Error(json.error);
        }

        adminData = json;

        if (adminData.critics) {
            adminData.critics.sort((a, b) => a.localeCompare(b));
        }

        if (adminData.restaurants) {
            adminData.restaurants.sort((a, b) => {
                const nameA = (a.name || '').toLowerCase();
                const nameB = (b.name || '').toLowerCase();
                if (nameA < nameB) return -1;
                if (nameA > nameB) return 1;

                const dateA = (a.fecha || '').split('/').reverse().join('');
                const dateB = (b.fecha || '').split('/').reverse().join('');
                return dateB.localeCompare(dateA);
            });
        }

        if (adminData.nextId) {
            const newIdInput = document.getElementById('new-id');
            if (newIdInput) newIdInput.value = adminData.nextId;
        }

        if (adminData.alfajores) {
            adminData.alfajores.sort((a, b) => (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase()));
        } else {
            adminData.alfajores = [];
        }
        if (!adminData.alfajorCritics) adminData.alfajorCritics = [];

        if (adminData.nextAlfajorId) {
            const newAlfIdInput = document.getElementById('new-alfajor-id');
            if (newAlfIdInput) newAlfIdInput.value = adminData.nextAlfajorId;
        }

        renderRestaurants();
        populateLinkSelectors();
        setupSmartPaste();
        setupNewPhotoUploaders();

        adminLoader.style.display = 'none';
        adminContent.style.display = 'block';

        statusText.textContent = `✅ ${adminData.restaurants.length} restaurantes cargados`;
        statusText.style.color = '#2ecc71';
        const statusAlfajores = document.getElementById('status-text-alfajores');
        if (statusAlfajores) {
            statusAlfajores.textContent = `🍫 ${(adminData.alfajores || []).length} alfajores cargados`;
            statusAlfajores.style.color = '#2ecc71';
            statusAlfajores.style.display = '';
        }

        if (window.lucide) lucide.createIcons();

        // Procesar stats si vinieron OK
        if (statsRes.status === 'fulfilled' && !statsRes.value.error) {
            renderStats(statsRes.value);
        } else {
            const statsLoader = document.getElementById('stats-loader');
            if (statsLoader) {
                statsLoader.innerHTML = `
                    <div class="stats-empty">
                        <i data-lucide="bar-chart-3"></i>
                        <p>No se pudieron cargar las estadísticas</p>
                    </div>
                `;
                if (window.lucide) lucide.createIcons();
            }
        }

        // Procesar usuarios si vinieron OK
        if (usersRes.status === 'fulfilled' && !usersRes.value.error) {
            renderUsers(usersRes.value);
        } else {
            const usersLoader = document.getElementById('users-loader');
            if (usersLoader) {
                usersLoader.innerHTML = `
                    <div class="stats-empty">
                        <i data-lucide="users"></i>
                        <p>No se pudieron cargar los usuarios</p>
                    </div>
                `;
                if (window.lucide) lucide.createIcons();
            }
        }

    } catch (error) {
        console.error('[Admin] Error cargando datos:', error);
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

    if (name === 'stats' && body.classList.contains('open')) {
        setTimeout(() => {
            if (statsChart) {
                statsChart.resize();
            } else if (statsData) {
                renderPageViewsChart(currentStatsMode);
            }
        }, 150);
    }
}
window.toggleSection = toggleSection;

// =============================================
// RENDERIZAR RESTAURANTES
// =============================================
function renderRestaurants(filterText = '') {
    const list = document.getElementById('restaurants-list');

    if (!filterText.trim()) {
        list.innerHTML = `
            <div class="empty-state" style="padding: 3rem 1.5rem; opacity: 0.5;">
                <i data-lucide="search" style="width: 40px; height: 40px; margin-bottom: 1rem;"></i>
                <p style="font-weight: 500;">Ingresá un nombre para gestionar restaurantes o alfajores</p>
            </div>
        `;
        restaurantCount.textContent = '0';
        if (window.lucide) lucide.createIcons();
        return;
    }

    const noRestos = !adminData.restaurants || adminData.restaurants.length === 0;
    const noAlfajores = !adminData.alfajores || adminData.alfajores.length === 0;
    if (noRestos && noAlfajores) {
        list.innerHTML = `
            <div class="empty-state">
                <i data-lucide="inbox"></i>
                <p>No hay restaurantes ni alfajores en la tabla</p>
            </div>
        `;
        restaurantCount.textContent = '0';
        if (window.lucide) lucide.createIcons();
        return;
    }

    const q = filterText.toLowerCase();
    const filteredRestos = (adminData.restaurants || []).filter(r =>
        (r.name || '').toLowerCase().includes(q) ||
        (r.location || '').toLowerCase().includes(q) ||
        (r.id || '').toLowerCase().includes(q));
    const filteredAlfajores = (adminData.alfajores || []).filter(a =>
        (a.name || '').toLowerCase().includes(q) ||
        (a.id || '').toLowerCase().includes(q));

    const total = filteredRestos.length + filteredAlfajores.length;
    restaurantCount.textContent = total;

    if (total === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <i data-lucide="search-x"></i>
                <p>No se encontraron restaurantes ni alfajores</p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    let html = '';
    filteredRestos.forEach((r) => {
        html += createRestaurantCard(r, adminData.restaurants.indexOf(r));
    });
    filteredAlfajores.forEach((a) => {
        html += createAlfajorCard(a, adminData.alfajores.indexOf(a));
    });

    list.innerHTML = html;
    if (window.lucide) lucide.createIcons();
}

function createRestaurantCard(r, globalIdx) {
    const modalidad = (r.presencialDelivery || '').toUpperCase();
    const isPresencial = modalidad === 'P' || modalidad === 'PRESENCIAL' || modalidad === '';

    return `
    <div class="restaurant-block" id="block-${globalIdx}">
        <div class="restaurant-block-header">
            <div class="restaurant-block-name">
                🍴 ${escapeHtml(r.name || 'Sin nombre')}
            </div>
        </div>

        <div class="restaurant-fields-grid">
            <div class="admin-form-group">
                <label class="admin-label" for="edit-id-${globalIdx}"><i data-lucide="hash"></i> ID</label>
                <input type="text" class="admin-input" id="edit-id-${globalIdx}" value="${escapeHtml(r.id || '')}" disabled style="background: rgba(0,0,0,0.05); font-weight: bold;">
            </div>
            <div class="admin-form-group">
                <label class="admin-label" for="edit-name-${globalIdx}"><i data-lucide="store"></i> Nombre</label>
                <input type="text" class="admin-input" id="edit-name-${globalIdx}" value="${escapeHtml(r.name || '')}">
            </div>
            <div class="admin-form-group">
                <label class="admin-label" for="edit-location-${globalIdx}"><i data-lucide="map-pin"></i> Ubicación</label>
                <input type="text" class="admin-input" id="edit-location-${globalIdx}" value="${escapeHtml(r.location || '')}">
            </div>
            <div class="admin-form-group field-full">
                <label class="admin-label" for="edit-description-${globalIdx}"><i data-lucide="file-text"></i> Descripción</label>
                <textarea class="admin-textarea" id="edit-description-${globalIdx}">${escapeHtml(r.description || '')}</textarea>
            </div>
            <div class="admin-form-group">
                <label class="admin-label" for="edit-fecha-${globalIdx}"><i data-lucide="calendar"></i> Fecha</label>
                <input type="text" class="admin-input" id="edit-fecha-${globalIdx}" value="${escapeHtml(r.fecha || '')}">
            </div>
            <div class="admin-form-group">
                <label class="admin-label" for="edit-direccion-${globalIdx}"><i data-lucide="navigation"></i> Dirección</label>
                <input type="text" class="admin-input" id="edit-direccion-${globalIdx}" value="${escapeHtml(r.direccion || '')}">
            </div>
            <div class="admin-form-group">
                <label class="admin-label" for="edit-telefono-${globalIdx}"><i data-lucide="phone"></i> Teléfono</label>
                <input type="text" class="admin-input" id="edit-telefono-${globalIdx}" value="${escapeHtml(r.telefono || '')}">
            </div>
            <div class="admin-form-group">
                <label class="admin-label" for="edit-instagram-${globalIdx}"><i data-lucide="camera"></i> Instagram</label>
                <input type="text" class="admin-input" id="edit-instagram-${globalIdx}" value="${escapeHtml(r.instagram || '')}">
            </div>
            <div class="admin-form-group">
                <label class="admin-label" for="edit-linkMapa-${globalIdx}"><i data-lucide="map"></i> Link Mapa</label>
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
                <label class="admin-label" for="edit-pedidoPor-${globalIdx}"><i data-lucide="shopping-bag"></i> Pedido por</label>
                <input type="text" class="admin-input" id="edit-pedidoPor-${globalIdx}" value="${escapeHtml(r.pedidoPor || '')}">
            </div>
            <div class="admin-form-group field-full">${photoUploaderHTML('edit-resto-' + globalIdx, r.fotos)}</div>
        </div>

        <button type="button" class="admin-btn btn-save btn-inline-spin" id="btn-save-${globalIdx}" onclick="saveRestaurant(${globalIdx})">
            <span class="btn-label"><i data-lucide="save"></i> Guardar Cambios</span>
            <div class="btn-spinner"></div>
        </button>
        <div class="save-status" id="save-status-${globalIdx}">
            <span class="save-status-dot"></span>
            <span class="save-status-progress"><i></i></span>
            <span class="save-status-text"></span>
        </div>
    </div>
    `;
}

function filterRestaurants() {
    const query = document.getElementById('search-restaurants').value;
    renderRestaurants(query);
}
window.filterRestaurants = filterRestaurants;

// =============================================
// GUARDAR RESTAURANTE
// =============================================
async function saveRestaurant(idx) {
    const r = adminData.restaurants[idx];
    if (!r) return;

    const btn = document.getElementById(`btn-save-${idx}`);

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
        return;
    }

    if (!confirm(`¿Guardar cambios en "${data.name}"?`)) {
        return;
    }

    const statusId = `save-status-${idx}`;
    setButtonLoading(btn, true);
    setSaveStatus(statusId, 'Preparando…', 'working', 0);

    try {
        data.fotos = await collectFotos('edit-resto-' + idx, data.fecha,
            (msg, pct) => setSaveStatus(statusId, msg, 'working', pct));

        setSaveStatus(statusId, 'Guardando cambios…', 'working', 100);

        const credential = await getCred();
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'updateRestaurant',
                rowIndex: r.rowIndex,
                data: data,
                credential
            })
        });

        const result = await res.json();

        if (result.success) {
            Object.assign(adminData.restaurants[idx], data);
            showToast(`✅ "${data.name}" guardado con éxito`, 'success');
            setSaveStatus(statusId, 'Guardado con éxito', 'success');
            setTimeout(() => setSaveStatus(statusId, '', 'hide'), 4000);

            const block = document.getElementById(`block-${idx}`);
            if (block) {
                block.style.borderColor = '#2ecc71';
                setTimeout(() => { block.style.borderColor = ''; }, 2800);
            }
        } else {
            showToast(`❌ Error: ${result.message}`, 'error');
            setSaveStatus(statusId, result.message || 'No se pudo guardar', 'error');
        }

    } catch (error) {
        console.error('[Admin] Error guardando restaurante:', error);
        showToast(`❌ Error de conexión: ${error.message}`, 'error');
        setSaveStatus(statusId, error.message || 'Error de conexión', 'error');
    } finally {
        setButtonLoading(btn, false);
    }
}
window.saveRestaurant = saveRestaurant;

// =============================================
// CREAR RESTAURANTE
// =============================================
async function createRestaurant() {
    const btn = document.getElementById('btn-create-restaurant');

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
        return;
    }

    setButtonLoading(btn, true);

    try {
        data.fotos = await collectFotos('new-resto', data.fecha);

        const credential = await getCred();
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'addRestaurant',
                data: data,
                credential
            })
        });

        const result = await res.json();

        if (result.success) {
            showToast(`✅ "${data.name}" creado exitosamente`, 'success');

            data.rowIndex = result.rowIndex;
            if (result.idGenerado) {
                data.id = result.idGenerado;
                adminData.nextId = ("0000000" + (parseInt(result.idGenerado, 10) + 1)).slice(-7);
            }
            adminData.restaurants.push(data);
            renderRestaurants();
            populateLinkSelectors();

            clearNewForm();
            clearPhotoScope('new-resto');

            const newIdInput = document.getElementById('new-id');
            if (newIdInput && adminData.nextId) {
                newIdInput.value = adminData.nextId;
            }

        } else {
            showToast(`❌ Error: ${result.message}`, 'error');
        }

    } catch (error) {
        console.error('[Admin] Error creando restaurante:', error);
        showToast(`❌ Error de conexión: ${error.message}`, 'error');
    } finally {
        setButtonLoading(btn, false);
    }
}
window.createRestaurant = createRestaurant;

function clearNewForm() {
    const fields = ['name', 'location', 'description', 'fecha', 'direccion', 'telefono', 'instagram', 'linkMapa', 'pedidoPor'];
    fields.forEach(f => {
        const el = document.getElementById(`new-${f}`);
        if (el) el.value = '';
    });
    document.getElementById('new-modal-p').checked = true;
}

// =============================================
// ALFAJORES: card de edición + crear + guardar
// =============================================
function createAlfajorCard(a, idx) {
    return `
    <div class="restaurant-block" id="alfajor-block-${idx}">
        <div class="restaurant-block-header">
            <div class="restaurant-block-name">
                🍫 ${escapeHtml(a.name || 'Sin nombre')}
            </div>
            <span class="count-badge" style="background: rgba(205,127,50,0.12); color:#CD7F32;">Alfajor</span>
        </div>

        <div class="restaurant-fields-grid">
            <div class="admin-form-group">
                <label class="admin-label" for="alf-edit-id-${idx}"><i data-lucide="hash"></i> ID</label>
                <input type="text" class="admin-input" id="alf-edit-id-${idx}" value="${escapeHtml(a.id || '')}" disabled style="background: rgba(0,0,0,0.05); font-weight: bold;">
            </div>
            <div class="admin-form-group">
                <label class="admin-label" for="alf-edit-name-${idx}"><i data-lucide="cookie"></i> Nombre</label>
                <input type="text" class="admin-input" id="alf-edit-name-${idx}" value="${escapeHtml(a.name || '')}">
            </div>
            <div class="admin-form-group field-full">
                <label class="admin-label" for="alf-edit-description-${idx}"><i data-lucide="file-text"></i> Descripción</label>
                <textarea class="admin-textarea" id="alf-edit-description-${idx}">${escapeHtml(a.description || '')}</textarea>
            </div>
            <div class="admin-form-group field-full">
                <label class="admin-label" for="alf-edit-web-${idx}"><i data-lucide="globe"></i> Web</label>
                <input type="text" class="admin-input" id="alf-edit-web-${idx}" value="${escapeHtml(a.web || '')}">
            </div>
            <div class="admin-form-group field-full">${photoUploaderHTML('edit-alf-' + idx, a.fotos)}</div>
        </div>

        <button type="button" class="admin-btn btn-save btn-inline-spin" id="alf-btn-save-${idx}" onclick="saveAlfajor(${idx})">
            <span class="btn-label"><i data-lucide="save"></i> Guardar Cambios</span>
            <div class="btn-spinner"></div>
        </button>
        <div class="save-status" id="alf-save-status-${idx}">
            <span class="save-status-dot"></span>
            <span class="save-status-progress"><i></i></span>
            <span class="save-status-text"></span>
        </div>
    </div>
    `;
}

async function saveAlfajor(idx) {
    const a = adminData.alfajores[idx];
    if (!a) return;

    const btn = document.getElementById(`alf-btn-save-${idx}`);

    const data = {
        name: document.getElementById(`alf-edit-name-${idx}`).value.trim(),
        description: document.getElementById(`alf-edit-description-${idx}`).value.trim(),
        web: document.getElementById(`alf-edit-web-${idx}`).value.trim()
    };

    if (!data.name) {
        showToast('El nombre del alfajor es obligatorio', 'error');
        return;
    }

    if (!confirm(`¿Guardar cambios en "${data.name}"?`)) return;

    const statusId = `alf-save-status-${idx}`;
    setButtonLoading(btn, true);
    setSaveStatus(statusId, 'Preparando…', 'working', 0);

    try {
        data.fotos = await collectFotos('edit-alf-' + idx, '',
            (msg, pct) => setSaveStatus(statusId, msg, 'working', pct));

        setSaveStatus(statusId, 'Guardando cambios…', 'working', 100);

        const credential = await getCred();
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'updateAlfajor',
                rowIndex: a.rowIndex,
                data: data,
                credential
            })
        });

        const result = await res.json();

        if (result.success) {
            Object.assign(adminData.alfajores[idx], data);
            showToast(`✅ "${data.name}" guardado con éxito`, 'success');
            setSaveStatus(statusId, 'Guardado con éxito', 'success');
            setTimeout(() => setSaveStatus(statusId, '', 'hide'), 4000);

            const block = document.getElementById(`alfajor-block-${idx}`);
            if (block) {
                block.style.borderColor = '#2ecc71';
                setTimeout(() => { block.style.borderColor = ''; }, 2800);
            }
        } else {
            showToast(`❌ Error: ${result.message}`, 'error');
            setSaveStatus(statusId, result.message || 'No se pudo guardar', 'error');
        }
    } catch (error) {
        console.error('[Admin] Error guardando alfajor:', error);
        showToast(`❌ Error de conexión: ${error.message}`, 'error');
        setSaveStatus(statusId, error.message || 'Error de conexión', 'error');
    } finally {
        setButtonLoading(btn, false);
    }
}
window.saveAlfajor = saveAlfajor;

async function createAlfajor() {
    const btn = document.getElementById('btn-create-alfajor');

    const data = {
        name: document.getElementById('new-alfajor-name').value.trim(),
        description: document.getElementById('new-alfajor-description').value.trim(),
        web: document.getElementById('new-alfajor-web').value.trim()
    };

    if (!data.name) {
        showToast('El nombre del alfajor es obligatorio', 'error');
        return;
    }

    setButtonLoading(btn, true);

    try {
        data.fotos = await collectFotos('new-alfajor', '');

        const credential = await getCred();
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'addAlfajor',
                data: data,
                credential
            })
        });

        const result = await res.json();

        if (result.success) {
            showToast(`✅ "${data.name}" creado exitosamente`, 'success');

            data.rowIndex = result.rowIndex;
            if (result.idGenerado) {
                data.id = result.idGenerado;
                adminData.nextAlfajorId = ("0000000" + (parseInt(result.idGenerado, 10) + 1)).slice(-7);
            }
            if (!adminData.alfajores) adminData.alfajores = [];
            adminData.alfajores.push(data);
            populateLinkSelectors();

            ['name', 'description', 'web'].forEach(f => {
                const el = document.getElementById(`new-alfajor-${f}`);
                if (el) el.value = '';
            });
            clearPhotoScope('new-alfajor');

            const idEl = document.getElementById('new-alfajor-id');
            if (idEl && adminData.nextAlfajorId) idEl.value = adminData.nextAlfajorId;

        } else {
            showToast(`❌ Error: ${result.message}`, 'error');
        }
    } catch (error) {
        console.error('[Admin] Error creando alfajor:', error);
        showToast(`❌ Error de conexión: ${error.message}`, 'error');
    } finally {
        setButtonLoading(btn, false);
    }
}
window.createAlfajor = createAlfajor;

// =============================================
// GENERADOR DE LINKS
// =============================================
let linkSelectorsInitialized = false;

function populateLinkSelectors() {
    const criticoSelect = document.getElementById('link-critico');
    const critics = (linkType === 'alfajor' ? adminData.alfajorCritics : adminData.critics) || [];
    criticoSelect.innerHTML = '<option value="" disabled selected>Seleccioná un crítico</option>';
    critics.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        criticoSelect.appendChild(opt);
    });

    const restoSelect = document.getElementById('link-restaurante');
    const fechaSelect = document.getElementById('link-fecha');

    restoSelect.innerHTML = `<option value="" disabled selected>${linkType === 'alfajor' ? 'Selecciona alfajor' : 'Selecciona restaurante'}</option>`;
    fechaSelect.innerHTML = '<option value="" disabled selected>Elige fecha</option>';
    fechaSelect.disabled = true;

    const uniqueNames = [];
    const source = linkType === 'alfajor' ? (adminData.alfajores || []) : (adminData.restaurants || []);
    source.forEach(item => {
        if (item.name && !uniqueNames.includes(item.name)) {
            uniqueNames.push(item.name);
        }
    });

    uniqueNames.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        restoSelect.appendChild(opt);
    });

    if (!linkSelectorsInitialized) {
        restoSelect.addEventListener('change', () => {
            if (linkType === 'alfajor') return; // los alfajores no usan fecha
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

function setLinkType(type) {
    if (type !== 'alfajor') type = 'restaurant';
    linkType = type;

    document.querySelectorAll('#link-type-switcher .stats-toggle-btn').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-link-type') === type);
    });

    const restoLabelText = document.getElementById('link-resto-label-text');
    const fechaGroup = document.getElementById('link-fecha-group');

    if (type === 'alfajor') {
        if (restoLabelText) restoLabelText.textContent = 'Alfajor';
        if (fechaGroup) fechaGroup.style.display = 'none';
    } else {
        if (restoLabelText) restoLabelText.textContent = 'Restaurante';
        if (fechaGroup) fechaGroup.style.display = '';
    }

    // Ocultar el resultado previo al cambiar de tipo
    const resultDiv = document.getElementById('link-result');
    if (resultDiv) resultDiv.classList.remove('show');

    populateLinkSelectors();
    if (window.lucide) lucide.createIcons();
}
window.setLinkType = setLinkType;

async function generateLink() {
    const btn = document.getElementById('btn-generate-link');
    const critico = document.getElementById('link-critico').value;
    const restaurante = document.getElementById('link-restaurante').value;
    const fecha = document.getElementById('link-fecha').value;

    if (linkType === 'alfajor') {
        if (!critico || !restaurante) {
            showToast('Seleccioná un crítico y un alfajor', 'error');
            return;
        }
    } else if (!critico || !restaurante || !fecha) {
        showToast('Seleccioná un crítico, un restaurante y una fecha', 'error');
        return;
    }

    setButtonLoading(btn, true);

    try {
        const credential = await getCred();
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'generateToken',
                tipo: linkType,
                critico: critico,
                fecha: linkType === 'alfajor' ? '' : fecha,
                restaurante: restaurante,
                credential
            })
        });

        const result = await res.json();

        if (result.success) {
            const currentUrl = new URL(window.location.href);
            const pathParts = currentUrl.pathname.split('/');
            pathParts[pathParts.length - 1] = 'carga.html';
            currentUrl.pathname = pathParts.join('/');
            currentUrl.search = '?token=' + result.token;

            generatedUrl = currentUrl.toString();

            const resultDiv = document.getElementById('link-result');
            const urlDiv = document.getElementById('link-result-url');
            urlDiv.textContent = generatedUrl;
            resultDiv.classList.add('show');

            showToast(`✅ ${result.message}`, 'success');

            await copyToClipboard(generatedUrl);

            if (window.lucide) lucide.createIcons();
        } else {
            showToast(`❌ Error: ${result.message}`, 'error');
        }

    } catch (error) {
        console.error('[Admin] Error generando link:', error);
        showToast(`❌ Error de conexión: ${error.message}`, 'error');
    } finally {
        setButtonLoading(btn, false);
    }
}
window.generateLink = generateLink;

async function copyLink() {
    if (!generatedUrl) {
        showToast('No hay link generado para copiar', 'error');
        return;
    }
    await copyToClipboard(generatedUrl);
}
window.copyLink = copyLink;

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('📋 Link copiado al portapapeles', 'info');
    } catch (err) {
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

    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
    }, 3500);
}

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

// Actualiza la línea de estado debajo de un botón Guardar.
// state: 'working' (spinner) | 'success' | 'error' | 'hide'
// pct: 0–100 opcional → mueve la barra de progreso (solo en 'working')
function setSaveStatus(statusId, message, state = 'working', pct = null) {
    const el = document.getElementById(statusId);
    if (!el) return;
    if (state === 'hide') { el.className = 'save-status'; return; }
    el.className = `save-status show ${state}`;
    const txt = el.querySelector('.save-status-text');
    if (txt) txt.textContent = message || '';
    const bar = el.querySelector('.save-status-progress > i');
    if (bar && pct != null) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
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
// FOTOS: carga desde el navegador (Canvas thumb + commit a GitHub)
// =============================================
const THUMB_MAX_WIDTH = 400;       // igual que generate_thumbnails.py
const THUMB_JPEG_QUALITY = 0.6;    // ≈ quality=60
// Tope del ORIGINAL antes de subir: una foto de celular pesa varios MB y, en base64,
// hacía fallar el POST a Apps Script con "load failed". Si supera este lado largo se
// re-escala y recomprime a JPEG; las fotos por debajo del tope se suben tal cual.
const ORIGINAL_MAX_WIDTH = 2560;
const ORIGINAL_JPEG_QUALITY = 0.85;

// Estado por "scope": new-resto | new-alfajor | edit-resto-<idx> | edit-alf-<idx>
// { existing: [paths], pending: [{ id, file, previewUrl }] }
const photoState = {};

function parseFotosList(str) {
    if (!str) return [];
    return String(str).split(';').map(s => s.trim()).filter(Boolean);
}

// Deriva la ruta del thumbnail desde la del original (igual que getThumbnailUrl en main.js).
function getAdminThumb(originalUrl) {
    if (!originalUrl) return originalUrl;
    const thumb = originalUrl.replace(/\/fotos\//, '/fotos_thumb/').replace(/\bfotos\//, 'fotos_thumb/');
    return thumb.replace(/\.(jpeg|jpg|png|webp)$/i, '.jpg');
}

function initPhotoScope(scope, existingStr) {
    photoState[scope] = { existing: parseFotosList(existingStr), pending: [] };
    return photoState[scope];
}

function clearPhotoScope(scope) {
    const st = photoState[scope];
    if (st) st.pending.forEach(p => { try { URL.revokeObjectURL(p.previewUrl); } catch (e) {} });
    photoState[scope] = { existing: [], pending: [] };
    renderPhotoGrid(scope);
}

function existingChipHTML(scope, i, path) {
    return `<div class="photo-chip">
        <img src="${escapeHtml(getAdminThumb(path))}" alt="" loading="lazy" onerror="this.style.opacity=0.2">
        <button type="button" class="photo-chip-x" title="Quitar" onclick="removeExistingPhotoAt('${scope}', ${i})">×</button>
    </div>`;
}

function pendingChipHTML(scope, p) {
    return `<div class="photo-chip photo-chip-new">
        <img src="${p.previewUrl}" alt="">
        <button type="button" class="photo-chip-x" title="Quitar" onclick="removePendingPhoto('${scope}', '${p.id}')">×</button>
    </div>`;
}

function gridInnerHTML(scope) {
    const st = photoState[scope] || { existing: [], pending: [] };
    const chips = st.existing.map((p, i) => existingChipHTML(scope, i, p)).join('') +
        st.pending.map(p => pendingChipHTML(scope, p)).join('');
    return chips || '<span class="photo-empty">Sin fotos aún</span>';
}

function renderPhotoGrid(scope) {
    const grid = document.getElementById(`photo-grid-${scope}`);
    if (!grid) return;
    grid.innerHTML = gridInnerHTML(scope);
    if (window.lucide) lucide.createIcons();
}

function photoUploaderHTML(scope, existingStr) {
    initPhotoScope(scope, existingStr);
    return `
        <label class="admin-label"><i data-lucide="image"></i> Fotos</label>
        <div class="photo-grid" id="photo-grid-${scope}">${gridInnerHTML(scope)}</div>
        <label class="photo-dropzone" for="photo-input-${scope}">
            <i data-lucide="upload-cloud"></i>
            <span>Tocá o arrastrá fotos acá</span>
            <input type="file" id="photo-input-${scope}" accept="image/*" multiple style="display:none" onchange="onPhotoInput('${scope}', this)">
        </label>
        <div class="photo-progress" id="photo-progress-${scope}" style="display:none"><div class="photo-progress-bar" id="photo-progress-bar-${scope}"></div></div>`;
}

function onPhotoInput(scope, inputEl) {
    const st = photoState[scope] || initPhotoScope(scope, '');
    Array.from(inputEl.files || []).forEach((file) => {
        if (!file.type || file.type.indexOf('image/') !== 0) return;
        const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        st.pending.push({ id, file, previewUrl: URL.createObjectURL(file) });
    });
    inputEl.value = '';
    renderPhotoGrid(scope);
}

function removeExistingPhotoAt(scope, i) {
    const st = photoState[scope];
    if (!st) return;
    st.existing.splice(i, 1);
    renderPhotoGrid(scope);
}

function removePendingPhoto(scope, id) {
    const st = photoState[scope];
    if (!st) return;
    const idx = st.pending.findIndex(p => p.id === id);
    if (idx >= 0) {
        try { URL.revokeObjectURL(st.pending[idx].previewUrl); } catch (e) {}
        st.pending.splice(idx, 1);
    }
    renderPhotoGrid(scope);
}

async function loadBitmap(file) {
    if (typeof createImageBitmap === 'function') {
        try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
        catch (e) { try { return await createImageBitmap(file); } catch (e2) {} }
    }
    return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('No se pudo decodificar la imagen'));
        img.src = URL.createObjectURL(file);
    });
}

// Genera el thumbnail (≤400px, JPEG q≈0.6) y devuelve su base64 (sin prefijo data:).
async function makeThumbBase64(file) {
    const bmp = await loadBitmap(file);
    const iw = bmp.width || bmp.naturalWidth;
    const ih = bmp.height || bmp.naturalHeight;
    const scale = iw > THUMB_MAX_WIDTH ? THUMB_MAX_WIDTH / iw : 1;
    const w = Math.max(1, Math.round(iw * scale));
    const h = Math.max(1, Math.round(ih * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';           // flatten alpha (como convert('RGB') en el .py)
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) { try { bmp.close(); } catch (e) {} }
    return canvas.toDataURL('image/jpeg', THUMB_JPEG_QUALITY).split(',')[1];
}

function readFileBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo'));
        reader.readAsDataURL(file);
    });
}

// Prepara el ORIGINAL para subir. Si el lado largo supera ORIGINAL_MAX_WIDTH lo
// re-escala con Canvas y lo recomprime a JPEG (acota el payload para que el POST no
// falle con "load failed"); si no, lo sube tal cual con su extensión original.
// Devuelve { b64, ext }.
async function makeUploadOriginal(file, fallbackExt) {
    const bmp = await loadBitmap(file);
    const iw = bmp.width || bmp.naturalWidth;
    const ih = bmp.height || bmp.naturalHeight;
    const longEdge = Math.max(iw, ih);

    if (longEdge <= ORIGINAL_MAX_WIDTH) {
        if (bmp.close) { try { bmp.close(); } catch (e) {} }
        return { b64: await readFileBase64(file), ext: fallbackExt };
    }

    const scale = ORIGINAL_MAX_WIDTH / longEdge;
    const w = Math.max(1, Math.round(iw * scale));
    const h = Math.max(1, Math.round(ih * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';           // flatten alpha
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) { try { bmp.close(); } catch (e) {} }
    return { b64: canvas.toDataURL('image/jpeg', ORIGINAL_JPEG_QUALITY).split(',')[1], ext: 'jpg' };
}

function folderFromFecha(fecha) {
    const m = (fecha || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}-${m[3]}`;
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function buildPhotoName(file) {
    const dot = file.name.lastIndexOf('.');
    let base = (dot > 0 ? file.name.slice(0, dot) : file.name)
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
    if (!base) base = 'foto';
    const ext = (dot > 0 ? file.name.slice(dot + 1) : 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    return { name: `${base}-${suffix}`, ext };
}

// Sube secuencialmente las fotos pendientes del scope. Devuelve las rutas nuevas.
// onStatus(text, pct) opcional → reporta el avance a la línea de estado del botón.
async function uploadPendingPhotos(scope, folder, onStatus) {
    const st = photoState[scope];
    if (!st || !st.pending.length) return [];

    const progress = document.getElementById(`photo-progress-${scope}`);
    const bar = document.getElementById(`photo-progress-bar-${scope}`);
    if (progress) progress.style.display = 'block';

    const newPaths = [];
    const total = st.pending.length;
    const credential = await getCred();
    for (let i = 0; i < total; i++) {
        if (onStatus) onStatus(`Subiendo foto ${i + 1} de ${total}…`, Math.round((i / total) * 100));
        const file = st.pending[i].file;
        const { name, ext } = buildPhotoName(file);
        const [thumbB64, original] = await Promise.all([
            makeThumbBase64(file),
            makeUploadOriginal(file, ext)
        ]);
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'uploadPhotos',
                credential,
                folder, name, ext: original.ext, originalB64: original.b64, thumbB64
            })
        });
        const result = await res.json();
        if (!result.success || !result.path) {
            throw new Error(result.message || 'Falló la subida de una foto.');
        }
        newPaths.push(result.path);
        const pct = Math.round(((i + 1) / total) * 100);
        if (bar) bar.style.width = pct + '%';
        if (onStatus) onStatus(`Subiendo foto ${i + 1} de ${total}…`, pct);
    }
    if (progress) setTimeout(() => { progress.style.display = 'none'; if (bar) bar.style.width = '0%'; }, 600);
    return newPaths;
}

// Sube lo pendiente y devuelve el string final de `fotos` (existentes + nuevas).
async function collectFotos(scope, fecha, onStatus) {
    const st = photoState[scope] || initPhotoScope(scope, '');
    const folder = folderFromFecha(fecha);
    const newPaths = await uploadPendingPhotos(scope, folder, onStatus);
    st.pending.forEach(p => { try { URL.revokeObjectURL(p.previewUrl); } catch (e) {} });
    st.pending = [];
    st.existing = st.existing.concat(newPaths);
    renderPhotoGrid(scope);
    return st.existing.join('; ');
}

// Inyecta el uploader en los forms de creación (placeholders en admin.html).
function setupNewPhotoUploaders() {
    const resto = document.getElementById('photo-uploader-new-resto');
    if (resto) resto.innerHTML = photoUploaderHTML('new-resto', '');
    const alf = document.getElementById('photo-uploader-new-alfajor');
    if (alf) alf.innerHTML = photoUploaderHTML('new-alfajor', '');
    if (window.lucide) lucide.createIcons();
}

// Handlers usados por atributos inline (onchange/onclick) → exponer en window.
window.onPhotoInput = onPhotoInput;
window.removeExistingPhotoAt = removeExistingPhotoAt;
window.removePendingPhoto = removePendingPhoto;

// =============================================
// SMART PASTE (JSON Auto-fill)
// =============================================
function setupSmartPaste() {
    const pasteArea = document.getElementById('smart-paste');
    if (!pasteArea) return;

    const sanitizePasteValue = (val) => {
        if (typeof val !== 'string') return String(val || '');
        return val.replace(/<[^>]*>?/gm, '').trim();
    };

    const looksLikeJson = (s) => {
        const t = s.trim();
        return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
    };

    const MAX_PASTE_LEN = 20000; // evita freeze del navegador con pegados gigantes

    pasteArea.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        if (!val || val.length < 10) return;
        if (val.length > MAX_PASTE_LEN) {
            showToast('❌ El texto pegado es demasiado largo', 'error');
            return;
        }

        let data;
        try {
            data = JSON.parse(val);
        } catch (err) {
            // Solo mostrar error si claramente parece JSON pero está mal
            if (looksLikeJson(val)) {
                showToast(`❌ JSON inválido: ${err.message}`, 'error');
            }
            return;
        }

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

        if (data.modalidad) {
            const modInput = sanitizePasteValue(String(data.modalidad)).toUpperCase();
            if (modInput === 'D' || modInput.includes('DELIVERY')) {
                document.getElementById('new-modal-d').checked = true;
            } else if (modInput === 'P' || modInput.includes('PRESENCIAL')) {
                document.getElementById('new-modal-p').checked = true;
            }
        }

        pasteArea.value = '';
        showToast('✅ Campos completados exitosamente', 'success');
    });
}

// =============================================
// ESTADÍSTICAS
// =============================================
let statsChart = null;
let statsData = null;
let currentStatsMode = 'daily';

function renderStats(json) {
    const statsLoader = document.getElementById('stats-loader');
    const statsContent = document.getElementById('stats-content');

    statsData = json;

    const totalViews = (statsData.dailyViews || []).reduce((sum, d) => sum + d.count, 0);
    const totalEl = document.getElementById('stats-total-count');
    if (totalEl) totalEl.textContent = totalViews.toLocaleString('es-AR');

    const statsBody = document.getElementById('body-stats');
    if (statsBody && statsBody.classList.contains('open')) {
        renderPageViewsChart('daily');
    }

    renderRestaurantTop(statsData.restaurantViews || []);

    if (statsLoader) statsLoader.style.display = 'none';
    if (statsContent) statsContent.style.display = 'block';

    if (window.lucide) lucide.createIcons();
}

function renderPageViewsChart(mode) {
    const ctx = document.getElementById('stats-chart');
    if (!ctx || !statsData) return;

    if (statsChart) {
        statsChart.destroy();
        statsChart = null;
    }

    let labels, data, xLabel;

    if (mode === 'monthly') {
        const monthlyData = statsData.monthlyViews || [];
        labels = monthlyData.map(d => {
            const [year, month] = d.month.split('-');
            const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
            return `${monthNames[parseInt(month) - 1]} ${year}`;
        });
        data = monthlyData.map(d => d.count);
        xLabel = 'Mes';
    } else {
        const dailyData = statsData.dailyViews || [];
        labels = dailyData.map(d => {
            const [y, m, day] = d.date.split('-');
            return `${day}/${m}`;
        });
        data = dailyData.map(d => d.count);
        xLabel = 'Día';
    }

    if (labels.length === 0) {
        ctx.parentElement.innerHTML = `
            <div class="stats-empty">
                <i data-lucide="bar-chart-3"></i>
                <p>Aún no hay datos de visitas</p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    const isDark = document.body.classList.contains('dark-mode');
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';
    const textColor = isDark ? '#AAAAAA' : '#555555';
    const goldColor = '#FF9100';
    const goldBg = isDark ? 'rgba(255, 145, 0, 0.25)' : 'rgba(255, 145, 0, 0.15)';

    statsChart = new Chart(ctx, {
        type: mode === 'monthly' ? 'bar' : 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Visitas',
                data: data,
                borderColor: goldColor,
                backgroundColor: goldBg,
                borderWidth: mode === 'monthly' ? 0 : 2.5,
                fill: true,
                tension: 0.4,
                pointRadius: mode === 'monthly' ? 0 : 4,
                pointBackgroundColor: goldColor,
                pointBorderColor: isDark ? '#1E1E1E' : '#FFFFFF',
                pointBorderWidth: 2,
                pointHoverRadius: 6,
                borderRadius: mode === 'monthly' ? 6 : 0,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: isDark ? '#333' : '#fff',
                    titleColor: isDark ? '#eee' : '#111',
                    bodyColor: isDark ? '#ccc' : '#555',
                    borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                    borderWidth: 1,
                    cornerRadius: 8,
                    padding: 10,
                    titleFont: { family: "'Outfit', sans-serif", weight: '700' },
                    bodyFont: { family: "'DM Sans', sans-serif" },
                    callbacks: {
                        label: function (context) {
                            return `  ${context.parsed.y} visitas`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: textColor,
                        font: { family: "'DM Sans', sans-serif", size: 11 },
                        maxRotation: 45,
                        maxTicksLimit: mode === 'monthly' ? 12 : 15
                    }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: gridColor },
                    ticks: {
                        color: textColor,
                        font: { family: "'DM Sans', sans-serif", size: 11 },
                        precision: 0
                    }
                }
            }
        }
    });
}

function renderRestaurantTop(restaurantViews) {
    const container = document.getElementById('stats-top-restaurants');
    if (!container) return;

    if (!restaurantViews || restaurantViews.length === 0) {
        container.innerHTML = `
            <div class="stats-empty">
                <i data-lucide="eye-off"></i>
                <p>Aún no hay datos de restaurantes visitados</p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    const maxCount = restaurantViews[0].count;

    let html = '<div class="top-restaurant-list">';
    restaurantViews.forEach((item, index) => {
        const rankNum = index + 1;
        let rankClass = '';
        if (rankNum === 1) rankClass = 'gold';
        else if (rankNum === 2) rankClass = 'silver';
        else if (rankNum === 3) rankClass = 'bronze';

        const percentage = Math.round((item.count / maxCount) * 100);

        html += `
            <div class="top-restaurant-item">
                <div class="top-rank ${rankClass}">${rankNum}</div>
                <div class="top-info">
                    <div class="top-name">${escapeHtml(item.name)}</div>
                    <div class="top-bar-container">
                        <div class="top-bar" style="width: ${percentage}%"></div>
                    </div>
                </div>
                <div>
                    <div class="top-count">${item.count}</div>
                    <div class="top-count-label">visitas</div>
                </div>
            </div>
        `;
    });
    html += '</div>';

    container.innerHTML = html;
}

function switchStatsMode(mode) {
    currentStatsMode = mode;

    document.querySelectorAll('.stats-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-stats-mode') === mode);
    });

    renderPageViewsChart(mode);
}
window.switchStatsMode = switchStatsMode;

// =============================================
// USUARIOS
// =============================================
function tipoLabelAdmin(t) {
    t = String(t || '').toLowerCase().trim();
    if (t === 'alfajor') return 'Alfajor';
    if (t === 'delivery') return 'Delivery';
    return 'Restaurante';
}

function renderUsers(json) {
    const loader = document.getElementById('users-loader');
    const contentEl = document.getElementById('users-content');
    const list = document.getElementById('users-list');
    const totalEl = document.getElementById('users-total-count');

    const users = (json && json.users) ? json.users : [];

    // Más recientes primero (por último acceso o registro, formato dd/MM/yyyy HH:mm).
    const toSortable = (s) => {
        const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
        if (!m) return '';
        return m[3] + m[2] + m[1] + (m[4] || '00') + (m[5] || '00');
    };
    users.sort((a, b) => toSortable(b.ultimoAcceso || b.registrado).localeCompare(toSortable(a.ultimoAcceso || a.registrado)));

    if (totalEl) totalEl.textContent = users.length;

    if (users.length === 0) {
        list.innerHTML = `
            <div class="stats-empty">
                <i data-lucide="users"></i>
                <p>Todavía no hay usuarios registrados</p>
            </div>`;
    } else {
        let html = '<div class="users-list">';
        users.forEach((u) => {
            const initial = escapeHtml((u.nombre || u.email || '?').charAt(0).toUpperCase());
            const avatar = u.foto
                ? `<img src="${escapeHtml(u.foto)}" class="user-avatar" referrerpolicy="no-referrer" alt="">`
                : `<div class="user-avatar user-avatar-fallback">${initial}</div>`;

            const votes = u.votes || [];
            const votesHtml = votes.length
                ? votes.map(v => `
                    <div class="user-vote">
                        <span class="user-vote-name">${escapeHtml(v.vota)}</span>
                        <span class="user-vote-tipo">${escapeHtml(tipoLabelAdmin(v.tipo))}</span>
                        <span class="user-vote-score">${escapeHtml(v.puntaje)}</span>
                        <span class="user-vote-date">${escapeHtml(v.timestamp || '')}</span>
                    </div>`).join('')
                : '<div class="user-vote-empty">Sin votos todavía</div>';

            html += `
                <div class="user-card">
                    <div class="user-head">
                        ${avatar}
                        <div class="user-meta">
                            <div class="user-name">${escapeHtml(u.nombre || '(sin nombre)')}</div>
                            <div class="user-email">${escapeHtml(u.email)}</div>
                            <div class="user-dates">Registrado: ${escapeHtml(u.registrado || '—')} · Último acceso: ${escapeHtml(u.ultimoAcceso || '—')}</div>
                        </div>
                        <div class="user-votecount">${votes.length}<span>votos</span></div>
                    </div>
                    <div class="user-votes">${votesHtml}</div>
                </div>`;
        });
        html += '</div>';
        list.innerHTML = html;
    }

    if (loader) loader.style.display = 'none';
    if (contentEl) contentEl.style.display = 'block';
    if (window.lucide) lucide.createIcons();
}
window.renderUsers = renderUsers;
