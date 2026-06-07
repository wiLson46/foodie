/**
 * auth.js — Login de Google (Google Identity Services) compartido.
 *
 * Expone window.ComerAuth. Lo usan index (main.js), perfil.js y el modal de voto
 * (vote.js). El sitio es estático: la identidad se obtiene como ID token (JWT) en
 * el cliente y el backend (Code.gs) lo verifica antes de escribir.
 *
 * Requiere, antes de este script:
 *   - config.js  (window.COMER_CONFIG con SCRIPT_URL y GOOGLE_CLIENT_ID)
 *   - el SDK GIS: <script src="https://accounts.google.com/gsi/client" async defer>
 */
(function () {
    'use strict';

    var CFG = window.COMER_CONFIG || {};
    var SCRIPT_URL = CFG.SCRIPT_URL || '';
    var CLIENT_ID = CFG.GOOGLE_CLIENT_ID || '';
    var STORAGE_KEY = 'comer_user';

    var currentUser = null;        // { email, name, picture }
    var currentCredential = null;  // JWT
    var currentExp = 0;            // epoch seconds
    var myVotes = {};              // { "nombre|tipo": puntaje }
    var myVotesList = [];          // [{ vota, tipo, puntaje, timestamp }]

    var subscribers = [];
    var initialized = false;
    var pendingCredResolvers = [];

    // --- GIS readiness ---
    var gisReadyResolve;
    var gisReady = new Promise(function (res) { gisReadyResolve = res; });
    // GIS llama a window.onGoogleLibraryLoad cuando termina de cargar.
    var prevOnLoad = window.onGoogleLibraryLoad;
    window.onGoogleLibraryLoad = function () {
        if (typeof prevOnLoad === 'function') { try { prevOnLoad(); } catch (e) {} }
        gisReadyResolve();
    };
    if (window.google && window.google.accounts && window.google.accounts.id) {
        gisReadyResolve();
    }

    // --- Utils ---
    function decodeJwt(token) {
        try {
            var payload = token.split('.')[1];
            var b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
            var raw = atob(b64);
            var json = decodeURIComponent(Array.prototype.map.call(raw, function (c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
            return JSON.parse(json);
        } catch (e) {
            return null;
        }
    }

    function normName(s) {
        return String(s || '').trim().toLowerCase();
    }

    function voteKey(name, tipo) {
        return normName(name) + '|' + String(tipo || '').toLowerCase().trim();
    }

    function nowSec() {
        return Math.floor(Date.now() / 1000);
    }

    function isExpired() {
        return !currentExp || currentExp <= nowSec() + 10; // 10s de margen
    }

    function buildMyVotes(votes) {
        myVotes = {};
        myVotesList = votes || [];
        myVotesList.forEach(function (v) {
            myVotes[voteKey(v.vota, v.tipo)] = v.puntaje;
        });
    }

    // --- Sesión ---
    function loadSession() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return false;
            var data = JSON.parse(raw);
            if (!data || !data.credential || !data.exp) return false;
            if (data.exp <= nowSec()) { return false; } // expirada
            currentCredential = data.credential;
            currentExp = data.exp;
            currentUser = { email: data.email, name: data.name, picture: data.picture };
            return true;
        } catch (e) {
            return false;
        }
    }

    function saveSession() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                email: currentUser.email,
                name: currentUser.name,
                picture: currentUser.picture,
                credential: currentCredential,
                exp: currentExp
            }));
        } catch (e) {}
    }

    function clearSession() {
        currentUser = null;
        currentCredential = null;
        currentExp = 0;
        myVotes = {};
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    }

    function notify() {
        subscribers.forEach(function (fn) {
            try { fn(currentUser); } catch (e) {}
        });
    }

    // --- Callback de GIS ---
    function handleCredentialResponse(response) {
        var cred = response && response.credential;
        if (!cred) return;
        var payload = decodeJwt(cred);
        if (!payload || !payload.email) return;

        currentCredential = cred;
        currentExp = parseInt(payload.exp, 10) || (nowSec() + 3000);
        currentUser = {
            email: String(payload.email).toLowerCase(),
            name: payload.name || payload.email,
            picture: payload.picture || ''
        };
        saveSession();
        notify();

        // Resolver getCredential() pendientes (re-login por expiración).
        var resolvers = pendingCredResolvers;
        pendingCredResolvers = [];
        resolvers.forEach(function (fn) { fn(currentCredential); });

        // Registrar/actualizar al usuario y traer sus votos (para saber qué ya votó).
        registerUser();
    }

    function ensureGisInit() {
        return gisReady.then(function () {
            if (!window.google || !window.google.accounts || !window.google.accounts.id) return;
            if (!ensureGisInit._done) {
                google.accounts.id.initialize({
                    client_id: CLIENT_ID,
                    callback: handleCredentialResponse,
                    auto_select: true,
                    cancel_on_tap_outside: true,
                    use_fedcm_for_prompt: true
                });
                ensureGisInit._done = true;
            }
        });
    }

    // --- API pública ---
    var ComerAuth = {
        /** Inicializa GIS y restaura la sesión guardada. Idempotente. */
        init: function () {
            if (initialized) return;
            initialized = true;

            if (!CLIENT_ID || CLIENT_ID.indexOf('PEGAR_CLIENT_ID') === 0) {
                console.warn('[Auth] Falta GOOGLE_CLIENT_ID en config.js — el login no funcionará.');
            }

            var hadSession = loadSession();
            ensureGisInit();
            // Notificar el estado inicial (logueado o no) en el próximo tick.
            setTimeout(notify, 0);
            // Si había sesión, refrescar usuario/votos desde el backend.
            if (hadSession) registerUser();
        },

        /** Agrega un listener fn(user|null); se llama inmediatamente con el estado actual. */
        subscribe: function (fn) {
            if (typeof fn !== 'function') return;
            subscribers.push(fn);
            try { fn(currentUser); } catch (e) {}
        },

        getUser: function () { return currentUser; },
        isLoggedIn: function () { return !!currentUser; },
        getMyVotes: function () { return myVotes; },
        getMyVotesList: function () { return myVotesList; },

        /** puntaje del voto previo del usuario para (name, tipo), o null. */
        getMyVote: function (name, tipo) {
            var v = myVotes[voteKey(name, tipo)];
            return (v === undefined) ? null : v;
        },

        /** Actualiza el cache local tras votar/editar (evita refetch). */
        setMyVote: function (name, tipo, puntaje) {
            var k = voteKey(name, tipo);
            myVotes[k] = puntaje;
            var found = false;
            for (var i = 0; i < myVotesList.length; i++) {
                if (voteKey(myVotesList[i].vota, myVotesList[i].tipo) === k) {
                    myVotesList[i].puntaje = puntaje;
                    found = true;
                    break;
                }
            }
            if (!found) myVotesList.push({ vota: name, tipo: String(tipo || '').toLowerCase().trim(), puntaje: puntaje, timestamp: '' });
        },
        removeMyVote: function (name, tipo) {
            var k = voteKey(name, tipo);
            delete myVotes[k];
            myVotesList = myVotesList.filter(function (v) { return voteKey(v.vota, v.tipo) !== k; });
        },

        /**
         * Renderiza el botón oficial "Sign in with Google" dentro de `el`.
         * opts se pasa a google.accounts.id.renderButton.
         */
        renderButton: function (el, opts) {
            if (!el) return;
            ensureGisInit().then(function () {
                if (!window.google || !window.google.accounts || !window.google.accounts.id) return;
                try {
                    el.innerHTML = '';
                    google.accounts.id.renderButton(el, opts || {
                        theme: 'outline', size: 'large', shape: 'pill',
                        text: 'signin_with', logo_alignment: 'left'
                    });
                } catch (e) {}
            });
        },

        /** Dispara One Tap / auto-select (para un botón propio "Ingresá"). */
        promptOneTap: function () {
            ensureGisInit().then(function () {
                try { google.accounts.id.prompt(); } catch (e) {}
            });
        },

        /**
         * Devuelve (Promise) un credential válido para operaciones de escritura.
         * Si el actual está vigente, lo devuelve ya. Si expiró, intenta re-login
         * silencioso (One Tap) y espera; si no, resuelve null tras un timeout.
         */
        getCredential: function () {
            return new Promise(function (resolve) {
                if (currentCredential && !isExpired()) { resolve(currentCredential); return; }
                pendingCredResolvers.push(resolve);
                ensureGisInit().then(function () {
                    try { google.accounts.id.prompt(); } catch (e) {}
                });
                setTimeout(function () {
                    var idx = pendingCredResolvers.indexOf(resolve);
                    if (idx >= 0) {
                        pendingCredResolvers.splice(idx, 1);
                        resolve((currentCredential && !isExpired()) ? currentCredential : null);
                    }
                }, 60000);
            });
        },

        /** Cierra sesión local y deshabilita el auto-select de GIS. */
        logout: function () {
            ensureGisInit().then(function () {
                try { google.accounts.id.disableAutoSelect(); } catch (e) {}
            });
            clearSession();
            notify();
        },

        /** Registra/actualiza al usuario en el backend y cachea sus votos. */
        registerUser: function () { return registerUser(); },

        decodeJwt: decodeJwt
    };

    function registerUser() {
        if (!currentCredential || !SCRIPT_URL) return Promise.resolve(null);
        return fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'registerUser', credential: currentCredential })
        }).then(function (r) { return r.json(); }).then(function (res) {
            if (res && res.success) {
                buildMyVotes(res.votes || []);
                notify();
            }
            return res;
        }).catch(function () { return null; });
    }

    window.ComerAuth = ComerAuth;
})();
