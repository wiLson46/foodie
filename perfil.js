/**
 * perfil.js — Página "Mi perfil". Muestra los votos del usuario logueado, permite
 * re-votar (editar) cada uno y borrar la cuenta.
 *
 * Depende de config.js, auth.js (ComerAuth) y vote.js (ComerVote).
 */
(function () {
    'use strict';

    var CFG = window.COMER_CONFIG || {};
    var SCRIPT_URL = CFG.SCRIPT_URL || '';

    var statusText = document.getElementById('status-text');
    var content = document.getElementById('perfil-content');
    var loadedEmail = null;

    var TIPO_LABEL = { restaurant: 'Restaurante', delivery: 'Delivery', alfajor: 'Alfajor' };

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function icons() { if (window.lucide) { try { lucide.createIcons(); } catch (e) {} } }

    // --- Render ---

    function renderSignedOut() {
        if (statusText) statusText.textContent = 'Iniciá sesión para ver tus votos.';
        content.innerHTML =
            '<div class="perfil-signin">' +
            '  <i data-lucide="lock" class="perfil-signin-icon"></i>' +
            '  <p>Iniciá sesión con Google para ver y editar tus votos.</p>' +
            '  <div id="perfil-gbtn" class="perfil-gbtn"></div>' +
            '</div>';
        if (window.ComerAuth) ComerAuth.renderButton(document.getElementById('perfil-gbtn'), {
            theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with'
        });
        icons();
    }

    function renderProfileShell(user) {
        if (statusText) statusText.textContent = '';
        var initial = escapeHtml((user.name || user.email || '?').charAt(0).toUpperCase());
        var avatar = user.picture
            ? '<img src="' + escapeHtml(user.picture) + '" alt="" class="perfil-avatar" referrerpolicy="no-referrer">'
            : '<div class="perfil-avatar perfil-avatar-fallback">' + initial + '</div>';

        content.innerHTML =
            '<div class="perfil-user">' +
            avatar +
            '  <div class="perfil-user-info">' +
            '    <div class="perfil-user-name">' + escapeHtml(user.name || '') + '</div>' +
            '    <div class="perfil-user-email">' + escapeHtml(user.email || '') + '</div>' +
            '  </div>' +
            '</div>' +
            '<h2 class="perfil-section-title"><i data-lucide="star"></i> Mis votos</h2>' +
            '<div id="votes-container"><p class="perfil-muted">Cargando tus votos…</p></div>' +
            '<div class="perfil-danger">' +
            '  <button type="button" class="perfil-delete-btn" id="delete-account">' +
            '    <i data-lucide="trash-2"></i> Borrar mi cuenta' +
            '  </button>' +
            '  <p class="perfil-danger-hint">Se eliminan tu cuenta y todos tus votos. No se puede deshacer.</p>' +
            '</div>';

        var del = document.getElementById('delete-account');
        if (del) del.addEventListener('click', deleteAccount);
        icons();
    }

    function renderVotes(votes) {
        var container = document.getElementById('votes-container');
        if (!container) return;

        if (!votes || votes.length === 0) {
            container.innerHTML =
                '<div class="perfil-empty">' +
                '  <i data-lucide="inbox"></i>' +
                '  <p>Todavía no votaste nada. Entrá a un local o alfajor y tocá “Puntaje del Público”.</p>' +
                '</div>';
            icons();
            return;
        }

        var rows = votes.map(function (v) {
            var tipo = String(v.tipo || '').toLowerCase().trim();
            var badge = TIPO_LABEL[tipo] || 'Restaurante';
            return '' +
                '<tr>' +
                '  <td class="pv-name">' + escapeHtml(v.vota) + '<span class="pv-badge pv-badge-' + escapeHtml(tipo) + '">' + escapeHtml(badge) + '</span></td>' +
                '  <td class="pv-score">' + escapeHtml(v.puntaje) + '</td>' +
                '  <td class="pv-date">' + escapeHtml(v.timestamp || '—') + '</td>' +
                '  <td class="pv-action">' +
                '    <button type="button" class="pv-edit" data-name="' + escapeHtml(v.vota) + '" data-tipo="' + escapeHtml(tipo) + '">' +
                '      <i data-lucide="pencil"></i> Editar' +
                '    </button>' +
                '  </td>' +
                '</tr>';
        }).join('');

        container.innerHTML =
            '<div class="perfil-table-wrap"><table class="perfil-table">' +
            '<thead><tr><th>Qué votaste</th><th>Tu puntaje</th><th>Fecha</th><th></th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
            '</table></div>';

        container.querySelectorAll('.pv-edit').forEach(function (btn) {
            btn.addEventListener('click', function () {
                ComerVote.open({
                    name: btn.getAttribute('data-name'),
                    tipo: btn.getAttribute('data-tipo'),
                    onDone: function () { loadVotes(); }
                });
            });
        });
        icons();
    }

    // --- Data ---

    function loadVotes() {
        var container = document.getElementById('votes-container');
        if (container) container.innerHTML = '<p class="perfil-muted">Cargando tus votos…</p>';
        ComerAuth.getCredential().then(function (cred) {
            if (!cred) { renderSignedOut(); return; }
            return fetch(SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({ action: 'getUserVotes', credential: cred })
            }).then(function (r) { return r.json(); }).then(function (json) {
                renderVotes((json && json.votes) ? json.votes : []);
            });
        }).catch(function () {
            if (container) container.innerHTML = '<p class="perfil-muted">No se pudieron cargar tus votos.</p>';
        });
    }

    function deleteAccount() {
        if (!confirm('¿Seguro que querés borrar tu cuenta? Se eliminan todos tus votos y no se puede deshacer.')) return;

        var btn = document.getElementById('delete-account');
        if (btn) { btn.disabled = true; btn.classList.add('loading'); }

        ComerAuth.getCredential().then(function (cred) {
            if (!cred) {
                if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
                alert('Tu sesión expiró. Volvé a iniciar sesión e intentá de nuevo.');
                return;
            }
            return fetch(SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({ action: 'deleteAccount', credential: cred })
            }).then(function (r) { return r.json(); }).then(function (res) {
                if (res && res.success) {
                    ComerAuth.logout();
                    alert('Tu cuenta fue borrada. ¡Gracias por pasar!');
                    window.location.href = 'index.html';
                } else {
                    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
                    alert((res && res.message) ? res.message : 'No se pudo borrar la cuenta.');
                }
            });
        }).catch(function (err) {
            if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
            alert('Error de conexión: ' + (err && err.message ? err.message : err));
        });
    }

    // --- Init ---

    function onAuth(user) {
        if (!user) { loadedEmail = null; renderSignedOut(); return; }
        if (loadedEmail === user.email) return; // ya renderizado para este usuario
        loadedEmail = user.email;
        renderProfileShell(user);
        loadVotes();
    }

    document.addEventListener('DOMContentLoaded', function () {
        if (!window.ComerAuth) {
            content.innerHTML = '<p class="perfil-muted">Falta configurar el login (auth.js).</p>';
            return;
        }
        ComerAuth.subscribe(onAuth);
        ComerAuth.init();
    });
})();
