/**
 * vote.js — Modal de voto público compartido. Expone window.ComerVote.
 *
 * Lo usan index (main.js) y perfil.js. Depende de window.ComerAuth (auth.js) y
 * window.COMER_CONFIG (config.js). El voto es el PROMEDIO de las dimensiones
 * (las mismas que usan los críticos), y se envía verificado por el backend.
 *
 *   ComerVote.open({ name, tipo, onDone })
 *     name : nombre del local/alfajor (== columna "vota")
 *     tipo : 'restaurant' | 'delivery' | 'alfajor'
 *     onDone(aggregate) : callback con { avg, count } del ítem tras votar.
 */
(function () {
    'use strict';

    var CFG = window.COMER_CONFIG || {};
    var SCRIPT_URL = CFG.SCRIPT_URL || '';

    var DIMS = {
        restaurant: [
            { key: 'comida', label: 'Comida', icon: 'utensils' },
            { key: 'lugar', label: 'Lugar', icon: 'armchair' },
            { key: 'atencion', label: 'Atención', icon: 'smile' }
        ],
        delivery: [
            { key: 'comida', label: 'Comida', icon: 'utensils' },
            { key: 'presentacion', label: 'Presentación', icon: 'package' },
            { key: 'precio', label: 'Precio', icon: 'dollar-sign' }
        ],
        alfajor: [
            { key: 'relleno', label: 'Relleno', icon: 'cookie' },
            { key: 'tapas', label: 'Tapas', icon: 'layers' },
            { key: 'armonia', label: 'Armonía', icon: 'heart' },
            { key: 'presentacion', label: 'Presentación', icon: 'image' }
        ]
    };

    var backdrop, modal, bodyEl;
    var isOpen = false;
    var current = null; // { name, tipo, onDone, alreadyVoted, prevScore }

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function normTipo(t) {
        t = String(t || '').toLowerCase().trim();
        return (t === 'delivery' || t === 'alfajor') ? t : 'restaurant';
    }

    function icons() {
        if (window.lucide) { try { lucide.createIcons(); } catch (e) {} }
    }

    function ensureDom() {
        if (backdrop) return;
        backdrop = document.createElement('div');
        backdrop.className = 'cv-backdrop hidden';
        backdrop.innerHTML =
            '<div class="cv-modal" role="dialog" aria-modal="true" aria-label="Votar">' +
            '  <button type="button" class="cv-close" aria-label="Cerrar">&times;</button>' +
            '  <div class="cv-body"></div>' +
            '</div>';
        document.body.appendChild(backdrop);
        modal = backdrop.querySelector('.cv-modal');
        bodyEl = backdrop.querySelector('.cv-body');

        backdrop.addEventListener('click', function (e) {
            if (e.target === backdrop) close();
        });
        backdrop.querySelector('.cv-close').addEventListener('click', close);
        document.addEventListener('keydown', function (e) {
            if (isOpen && e.key === 'Escape') close();
        });

        // Si el usuario inicia sesión con el modal abierto, pasamos a modo voto.
        if (window.ComerAuth) {
            ComerAuth.subscribe(function () {
                if (isOpen && current) render();
            });
        }
    }

    function open(opts) {
        opts = opts || {};
        if (!opts.name) return;
        ensureDom();
        var tipo = normTipo(opts.tipo);
        var prev = (window.ComerAuth) ? ComerAuth.getMyVote(opts.name, tipo) : null;
        current = {
            name: opts.name,
            tipo: tipo,
            onDone: typeof opts.onDone === 'function' ? opts.onDone : function () {},
            alreadyVoted: prev !== null && prev !== undefined,
            prevScore: prev
        };
        isOpen = true;
        backdrop.classList.remove('hidden');
        render();
    }

    function close() {
        if (!backdrop) return;
        isOpen = false;
        backdrop.classList.add('hidden');
        bodyEl.innerHTML = '';
        current = null;
    }

    function render() {
        if (!current) return;
        var loggedIn = window.ComerAuth && ComerAuth.isLoggedIn();
        if (!loggedIn) {
            renderLoggedOut();
        } else {
            renderVote();
        }
        icons();
    }

    function renderLoggedOut() {
        bodyEl.innerHTML =
            '<h2 class="cv-title">Votá ' + escapeHtml(current.name) + '</h2>' +
            '<p class="cv-sub">Para votar necesitás iniciar sesión con tu cuenta de Google. ' +
            'Es gratis y solo lo usamos para que votes una vez cada cosa.</p>' +
            '<div class="cv-gbtn" id="cv-gbtn"></div>';
        if (window.ComerAuth) ComerAuth.renderButton(document.getElementById('cv-gbtn'));
    }

    function renderVote() {
        var dims = DIMS[current.tipo] || DIMS.restaurant;

        var noteHtml = '';
        if (current.alreadyVoted) {
            noteHtml =
                '<div class="cv-note">Ya tenés un voto registrado para esto' +
                (current.prevScore ? ' (promedio: <strong>' + escapeHtml(current.prevScore) + '</strong>)' : '') +
                '. Si guardás, lo <strong>actualizás</strong>.</div>';
        }

        var fieldsHtml = dims.map(function (d) {
            return '' +
                '<div class="cv-field">' +
                '  <label class="cv-label" for="cv-' + d.key + '"><i data-lucide="' + d.icon + '"></i> ' + escapeHtml(d.label) + '</label>' +
                '  <input type="number" id="cv-' + d.key + '" class="cv-input" data-key="' + d.key + '" min="0" max="10" step="0.01" inputmode="decimal" placeholder="0–10">' +
                '</div>';
        }).join('');

        bodyEl.innerHTML =
            '<h2 class="cv-title">Votá ' + escapeHtml(current.name) + '</h2>' +
            noteHtml +
            '<div class="cv-avg-box"><span class="cv-avg-label">Tu promedio</span><span class="cv-avg" id="cv-avg">–</span></div>' +
            '<div class="cv-grid">' + fieldsHtml + '</div>' +
            '<button type="button" class="cv-submit" id="cv-submit">' +
            (current.alreadyVoted ? 'Actualizar voto' : 'Votar') +
            '</button>' +
            '<div class="cv-msg" id="cv-msg" role="status"></div>';

        var inputs = bodyEl.querySelectorAll('.cv-input');
        inputs.forEach(function (inp) {
            inp.addEventListener('input', function () { validateInput(inp); updateAvg(); });
            inp.addEventListener('blur', function () { validateInput(inp); });
        });
        bodyEl.querySelector('#cv-submit').addEventListener('click', submit);
    }

    function validateInput(inp) {
        if (inp.value === '') { inp.classList.remove('cv-invalid'); return true; }
        var v = parseFloat(inp.value);
        var ok = !isNaN(v) && v >= 0 && v <= 10;
        inp.classList.toggle('cv-invalid', !ok);
        return ok;
    }

    function readDims() {
        var inputs = bodyEl.querySelectorAll('.cv-input');
        var vals = [];
        var allValid = true;
        inputs.forEach(function (inp) {
            var v = parseFloat(inp.value);
            if (inp.value === '' || isNaN(v) || v < 0 || v > 10) { allValid = false; }
            else vals.push(v);
        });
        return { vals: vals, allValid: allValid && vals.length === inputs.length, n: inputs.length };
    }

    function updateAvg() {
        var avgEl = bodyEl.querySelector('#cv-avg');
        if (!avgEl) return;
        var r = readDims();
        if (r.allValid) {
            var avg = r.vals.reduce(function (a, b) { return a + b; }, 0) / r.vals.length;
            avgEl.textContent = avg.toFixed(1);
        } else {
            avgEl.textContent = '–';
        }
    }

    function setMsg(text, kind) {
        var el = bodyEl.querySelector('#cv-msg');
        if (!el) return;
        el.textContent = text || '';
        el.className = 'cv-msg' + (kind ? ' cv-msg-' + kind : '');
    }

    function setLoading(btn, loading) {
        if (!btn) return;
        btn.disabled = loading;
        btn.classList.toggle('loading', loading);
    }

    function submit() {
        var btn = bodyEl.querySelector('#cv-submit');
        var r = readDims();
        if (!r.allValid) {
            setMsg('Completá las ' + r.n + ' dimensiones con números entre 0 y 10.', 'error');
            return;
        }
        var avg = r.vals.reduce(function (a, b) { return a + b; }, 0) / r.vals.length;
        avg = Math.round(avg * 10) / 10;

        setMsg('', '');
        setLoading(btn, true);

        ComerAuth.getCredential().then(function (cred) {
            if (!cred) {
                setLoading(btn, false);
                setMsg('Tu sesión expiró. Volvé a iniciar sesión.', 'error');
                render(); // vuelve a estado logged-out si corresponde
                return;
            }
            var action = current.alreadyVoted ? 'updateVote' : 'submitVote';
            return fetch(SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({
                    action: action,
                    credential: cred,
                    vota: current.name,
                    tipo: current.tipo,
                    puntaje: avg
                })
            }).then(function (res) { return res.json(); }).then(function (result) {
                setLoading(btn, false);

                if (result && result.success) {
                    ComerAuth.setMyVote(current.name, current.tipo, avg.toFixed(1));
                    current.alreadyVoted = true;
                    current.prevScore = avg.toFixed(1);
                    current.onDone({ avg: result.avg, count: result.count });
                    renderSuccess(action === 'updateVote');
                    return;
                }

                if (result && result.code === 'already_voted') {
                    // Ya había un voto: pasamos a modo edición y avisamos.
                    current.alreadyVoted = true;
                    current.prevScore = result.puntaje;
                    render();
                    setMsg('Ya tenés un voto registrado para esto. Cambiá los valores y tocá "Actualizar voto".', 'error');
                    return;
                }

                setMsg((result && result.message) ? result.message : 'No se pudo guardar el voto.', 'error');
            });
        }).catch(function (err) {
            setLoading(btn, false);
            setMsg('Error de conexión: ' + (err && err.message ? err.message : err), 'error');
        });
    }

    function renderSuccess(wasUpdate) {
        bodyEl.innerHTML =
            '<div class="cv-success">' +
            '  <div class="cv-success-icon">✓</div>' +
            '  <h2 class="cv-title">' + (wasUpdate ? '¡Voto actualizado!' : '¡Voto registrado!') + '</h2>' +
            '  <p class="cv-sub">Gracias por votar ' + escapeHtml(current.name) + '.</p>' +
            '  <button type="button" class="cv-submit" id="cv-done">Listo</button>' +
            '</div>';
        bodyEl.querySelector('#cv-done').addEventListener('click', close);
        icons();
    }

    window.ComerVote = { open: open, close: close };
})();
