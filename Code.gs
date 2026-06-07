/**
 * Código para ser desplegado como Web App en Google Apps Script.
 *
 * ESTRUCTURA POR CRÍTICO (6 columnas):
 * [comida, lugar, atencion, presentacion, precio, RATING(AUTO)]
 * La columna "RATING" (auto-calculada) es la ÚLTIMA del bloque.
 * Los datos del usuario se escriben en las 5 columnas ANTERIORES.
 *
 * IMPORTANTE: Después de pegar este código, crear una NUEVA implementación.
 *
 * CONFIGURACIÓN:
 * - Definir en Project Settings > Script Properties:
 *     ADMIN_SECRET = <string aleatorio largo>
 *   Acciones admin (addRestaurant, updateRestaurant, generateToken) lo requieren.
 */

var SHEET_NAME = 'mainTable';
var LINKS_SHEET_NAME = 'links';
var STATS_SHEET_NAME = 'stats';

// Pestaña de alfajores (mismo spreadsheet, otra hoja). La targeteamos por gid
// para no depender del nombre exacto de la pestaña.
var ALFAJORES_SHEET_GID = 317984049;

/**
 * Devuelve la hoja de alfajores buscándola por su gid (getSheetId()).
 * Retorna null si no se encuentra.
 */
function getAlfajoresSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === ALFAJORES_SHEET_GID) return sheets[i];
  }
  return null;
}

// Las 4 dimensiones que puntúa un alfajor (orden = columnas de datos antes de RATING).
var ALFAJOR_SCORE_KEYS = ['relleno', 'tapas', 'armonia', 'presentacion'];

// Límite de la descripción. Tope práctico apenas por debajo del máximo de Google
// Sheets (50.000 chars por celda) para no romper la escritura; a efectos de uso
// es "sin límite". Aplica a restaurantes y alfajores.
var MAX_DESCRIPTION_LEN = 45000;

var PUBLIC_CACHE_KEY = 'publicData_v1';
var PUBLIC_CACHE_TTL = 300; // 5 min

// Pestaña de votos del público (mismo spreadsheet, otra hoja), targeteada por gid.
var VOTES_SHEET_GID = 413818553;
var USERS_SHEET_NAME = 'usuarios';
var PUBLIC_VOTES_CACHE_KEY = 'publicVotes_v1';
var PUBLIC_VOTES_CACHE_TTL = 180; // 3 min

// GitHub (repo de GitHub Pages donde viven las fotos estáticas).
// El token va en Script Properties: GITHUB_TOKEN (fine-grained, Contents: read/write).
var GITHUB_OWNER = 'wiLson46';
var GITHUB_REPO = 'foodie';
var GITHUB_BRANCH = 'main';
var GITHUB_API = 'https://api.github.com';

// =============================================
// CAMPOS BASE de cada restaurante (columnas A-M aprox.)
// =============================================
var BASE_FIELDS = [
  'name', 'location', 'description', 'fecha',
  'direccion', 'telefono', 'instagram', 'link mapa',
  'presencial delivery', 'pedido por', 'rating',
  'fotos', 'ranking'
];

// =============================================
// doGet — Router principal para solicitudes GET
// =============================================
function doGet(e) {
  try {
    var params = e ? e.parameter : {};
    var action = params.action || 'default';
    var token = params.token || null;

    if (action === 'admin') {
      requireAdminSecret(params);
      return sendJson(getAdminData());
    }

    if (action === 'getStats') {
      requireAdminSecret(params);
      return sendJson(getStats());
    }

    if (action === 'getUsers') {
      requireAdminSecret(params);
      return sendJson(getUsersAdmin_());
    }

    // Promedios públicos de votos (agregados, SIN emails). Reemplaza la lectura
    // por CSV: así los emails de la pestaña de votos no quedan expuestos.
    if (action === 'publicVotes') {
      return sendJson(getPublicVotes());
    }

    return sendJson(getPublicData(token));

  } catch (error) {
    return sendJson({ error: error.toString() });
  }
}

// =============================================
// doPost — Router principal para solicitudes POST
// =============================================
function doPost(e) {
  try {
    var postData = JSON.parse(e.postData.contents);
    var action = postData.action || 'submitReview';
    Logger.log("POST action=" + action);

    switch (action) {
      case 'updateRestaurant':
        requireAdminSecret(postData);
        return sendJson(updateRestaurant(postData));
      case 'addRestaurant':
        requireAdminSecret(postData);
        return sendJson(addRestaurant(postData));
      case 'addAlfajor':
        requireAdminSecret(postData);
        return sendJson(addAlfajor(postData));
      case 'updateAlfajor':
        requireAdminSecret(postData);
        return sendJson(updateAlfajor(postData));
      case 'generateToken':
        requireAdminSecret(postData);
        return sendJson(generateToken(postData));
      case 'uploadPhotos':
        requireAdminSecret(postData);
        return sendJson(uploadPhotos(postData));
      case 'submitVote':
        return sendJson(submitVote(postData));
      case 'updateVote':
        return sendJson(updateVote(postData));
      case 'deleteVote':
        return sendJson(deleteVote(postData));
      case 'getUserVotes':
        return sendJson(getUserVotes(postData));
      case 'registerUser':
        return sendJson(registerUser(postData));
      case 'deleteAccount':
        return sendJson(deleteAccount(postData));
      case 'trackEvent':
        if (!checkRateLimit('trackEvent', clientKey_(e), 100, 60)) {
          return sendJson({ success: false, message: 'rate limited' });
        }
        return sendJson(trackEvent(postData));
      case 'submitReview':
      default:
        if (!checkRateLimit('submitReview', clientKey_(e), 5, 60)) {
          return sendJson({ success: false, message: 'rate limited' });
        }
        return sendJson(handleReviewSubmit(postData));
    }

  } catch (error) {
    Logger.log("Error en POST: " + error.toString());
    return sendJson({ success: false, message: error.toString() });
  }
}

// =============================================
// SEGURIDAD
// =============================================

/**
 * Valida el secret admin. Lanza error si no matchea.
 * Sirve tanto para POST (postData.adminSecret) como para GET (params.adminSecret).
 *
 * Para producción: configurar `ADMIN_SECRET` en Project Settings > Script Properties.
 */
function requireAdminSecret(postData) {
  var expected = PropertiesService.getScriptProperties().getProperty('ADMIN_SECRET');
  if (!expected) {
    throw new Error('Servidor mal configurado: ADMIN_SECRET no seteado.');
  }
  if (!postData || postData.adminSecret !== expected) {
    throw new Error('No autorizado.');
  }
}

/**
 * Rate limit por acción + clave (IP no es accesible en Apps Script,
 * usamos IP-equivalent del request o fallback a 'global').
 * Devuelve true si está dentro del límite, false si lo excede.
 */
function checkRateLimit(action, key, limit, windowSec) {
  try {
    var cache = CacheService.getScriptCache();
    var k = 'rl:' + action + ':' + key;
    var current = parseInt(cache.get(k) || '0', 10);
    if (current >= limit) return false;
    cache.put(k, String(current + 1), windowSec);
    return true;
  } catch (e) {
    return true; // no bloquear si CacheService falla
  }
}

/**
 * Construye una clave estable para identificar al cliente.
 * Apps Script no expone IP directamente; usamos User-Agent + sesión efímera.
 */
function clientKey_(e) {
  try {
    if (e && e.parameter && e.parameter.cid) return String(e.parameter.cid).slice(0, 64);
  } catch (err) {}
  return 'global';
}

/**
 * Sanitiza un valor antes de escribirlo en una celda para evitar
 * inyección de fórmulas (CSV/Spreadsheet injection).
 */
function sanitizeCellValue(v) {
  if (v === null || v === undefined) return v;
  var s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) {
    return "'" + s;
  }
  return s;
}

/**
 * Valida los datos básicos de un restaurante (longitudes, formatos).
 */
function validateRestaurant(data) {
  if (!data) throw new Error('Datos vacíos');
  if (!data.name || String(data.name).trim().length === 0) throw new Error('El nombre es obligatorio.');
  if (String(data.name).length > 200) throw new Error('Nombre demasiado largo.');
  ['location', 'direccion', 'telefono', 'instagram', 'pedidoPor'].forEach(function (f) {
    if (data[f] && String(data[f]).length > 1000) {
      throw new Error('Campo demasiado largo: ' + f);
    }
  });
  if (data.description && String(data.description).length > MAX_DESCRIPTION_LEN) {
    throw new Error('Descripción demasiado larga.');
  }
  if (data.linkMapa && String(data.linkMapa).length > 2000) throw new Error('linkMapa demasiado largo.');
  if (data.fecha && String(data.fecha).length > 30) throw new Error('Fecha inválida.');
}

/**
 * Valida los puntajes (0-10) en una review.
 */
function validateScores(vals) {
  if (!vals) throw new Error('Faltan puntajes.');
  ['comida', 'field2', 'field3'].forEach(function (k) {
    var n = parseFloat(vals[k]);
    if (isNaN(n) || n < 0 || n > 10) throw new Error('Puntaje inválido: ' + k);
  });
}

/**
 * Valida los 4 puntajes (0-10) de un alfajor.
 */
function validateScoresAlfajor(vals) {
  if (!vals) throw new Error('Faltan puntajes.');
  ALFAJOR_SCORE_KEYS.forEach(function (k) {
    var n = parseFloat(vals[k]);
    if (isNaN(n) || n < 0 || n > 10) throw new Error('Puntaje inválido: ' + k);
  });
}

/**
 * Valida los datos básicos de un alfajor.
 */
function validateAlfajor(data) {
  if (!data) throw new Error('Datos vacíos');
  if (!data.name || String(data.name).trim().length === 0) throw new Error('El nombre es obligatorio.');
  if (String(data.name).length > 200) throw new Error('Nombre demasiado largo.');
  if (data.description && String(data.description).length > MAX_DESCRIPTION_LEN) throw new Error('Descripción demasiado larga.');
  if (data.web && String(data.web).length > 2000) throw new Error('Web demasiado larga.');
}

/**
 * SHA-256 hex de un string. Para tokens.
 */
function hashToken_(token) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token), Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < raw.length; i++) {
    var b = raw[i];
    if (b < 0) b += 256;
    hex += ('0' + b.toString(16)).slice(-2);
  }
  return hex;
}

/**
 * Encuentra la fila del token en la sheet de links.
 * Acepta tokens hasheados (nuevos) y planos (legacy).
 * Retorna { rowIndex (1-based), row, isHashed } o null.
 */
function findTokenRow_(linksData, token) {
  var hashed = hashToken_(token);
  for (var i = 1; i < linksData.length; i++) {
    var stored = String(linksData[i][0]);
    if (stored === hashed) return { rowIndex: i + 1, row: linksData[i], isHashed: true };
    if (stored === token) return { rowIndex: i + 1, row: linksData[i], isHashed: false };
  }
  return null;
}

// =============================================
// UTILIDADES
// =============================================

function sendJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function buildColumnMap(headers) {
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).toLowerCase().trim();
    if (h) map[h] = i;
  }
  return map;
}

/**
 * Genera un token alfanumérico aleatorio criptográficamente fuerte.
 * Usa getUuid() (RFC 4122 v4) y elimina guiones — 32 chars hex.
 */
function generateRandomToken() {
  var u = Utilities.getUuid();
  return u.replace(/-/g, '');
}

function invalidatePublicCache_() {
  try { CacheService.getScriptCache().remove(PUBLIC_CACHE_KEY); } catch (e) {}
}

// =============================================
// DATOS PÚBLICOS (index.html, carga.html)
// =============================================
function getPublicData(token) {
  var cache = CacheService.getScriptCache();

  // Cache solo aplica cuando NO hay token (los tokens cambian la respuesta)
  if (!token) {
    var cached = cache.get(PUBLIC_CACHE_KEY);
    if (cached) {
      try { return JSON.parse(cached); } catch (e) {}
    }
  }

  // Si el token corresponde a un alfajor, devolvemos su payload y salimos
  // (el flujo de restaurantes queda intacto para tokens de restaurante / legacy).
  if (token) {
    var alfajorPayload = getAlfajorTokenData_(token);
    if (alfajorPayload) return alfajorPayload;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    return { error: "No se encontró la pestaña '" + SHEET_NAME + "'" };
  }

  var dataRange = sheet.getDataRange();
  var data = dataRange.getValues();
  var displayData = dataRange.getDisplayValues();

  if (data.length === 0) {
    return { error: "La pestaña está vacía" };
  }

  var headers = data[0];

  var dateCol = -1, nameCol = -1, typeCol = -1;
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).toLowerCase().trim();
    if ((h === 'fecha' || h === 'date') && dateCol === -1) dateCol = i;
    if ((h === 'name' || h === 'nombre') && nameCol === -1) nameCol = i;
    if ((h === 'presencial delivery' || h === 'tipo' || h === 'type') && typeCol === -1) typeCol = i;
  }

  var critics = [];
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).toLowerCase().trim();
    if (h.endsWith(' rating')) {
      var criticName = h.replace(/ rating$/i, '').trim();
      criticName = criticName.charAt(0).toUpperCase() + criticName.slice(1);
      var ratingCol1Based = i + 1;
      // Restaurante: cada crítico ocupa 6 columnas [comida, lugar, atencion,
      // presentacion, precio, RATING]. La primera columna de datos = RATING - 5.
      var dataStartCol = ratingCol1Based - 5;
      critics.push({ name: criticName, colIndex: dataStartCol });
    }
  }

  var datesSet = {};
  var restaurantsByDate = {};

  for (var r = 1; r < data.length; r++) {
    var restaurant = nameCol >= 0 ? String(data[r][nameCol]).trim() : '';
    var type = typeCol >= 0 ? String(data[r][typeCol]).trim() : '';
    if (!restaurant) continue;

    var dateStr = dateCol >= 0 ? String(displayData[r][dateCol]).trim() : '';
    if (!dateStr) continue;

    datesSet[dateStr] = true;
    if (!restaurantsByDate[dateStr]) restaurantsByDate[dateStr] = [];

    restaurantsByDate[dateStr].push({
      name: restaurant,
      type: type,
      rowIndex: r + 1
    });
  }

  var sortedDates = Object.keys(datesSet).sort(function(a, b) {
    var pa = a.split('/'), pb = b.split('/');
    if (pa.length === 3 && pb.length === 3) {
      return new Date(pa[2], pa[1] - 1, pa[0]) - new Date(pb[2], pb[1] - 1, pb[0]);
    }
    return 0;
  });

  var resultData = {
    critics: critics,
    dates: sortedDates,
    restaurantsByDate: restaurantsByDate
  };

  if (!token) {
    try { cache.put(PUBLIC_CACHE_KEY, JSON.stringify(resultData), PUBLIC_CACHE_TTL); } catch (e) {}
  }

  if (token) {
    var linksSheet = ss.getSheetByName(LINKS_SHEET_NAME);
    if (linksSheet) {
      var linksData = linksSheet.getDataRange().getValues();
      var linksDisplayData = linksSheet.getDataRange().getDisplayValues();
      var found = findTokenRow_(linksData, token);
      if (found) {
        var idx = found.rowIndex - 1;
        if (String(linksData[idx][4]) !== 'usado') {
          resultData.tokenInfo = {
            critico: String(linksData[idx][1]),
            fecha: String(linksDisplayData[idx][2]),
            restaurante: String(linksDisplayData[idx][3])
          };

          // Buscar rowIndex del restaurante en mainTable para el fallback del frontend
          var tokenRestNorm = resultData.tokenInfo.restaurante.trim().toLowerCase();
          for (var ri = 1; ri < data.length; ri++) {
            var rName = nameCol >= 0 ? String(data[ri][nameCol]).trim().toLowerCase() : '';
            if (rName === tokenRestNorm) {
              resultData.tokenInfo.rowIndex = ri + 1;
              resultData.tokenInfo.type = typeCol >= 0 ? String(data[ri][typeCol]).trim() : '';
              break;
            }
          }

          // Buscar colIndex del crítico en la lista ya armada
          for (var ci = 0; ci < resultData.critics.length; ci++) {
            if (resultData.critics[ci].name === resultData.tokenInfo.critico) {
              resultData.tokenInfo.colIndex = resultData.critics[ci].colIndex;
              break;
            }
          }
        }
      }
    }
  }

  return resultData;
}

/**
 * Si el token es de tipo 'alfajor', arma el payload de carga para alfajores:
 *   { critics:[], dates:[], restaurantsByDate:{}, tokenInfo:{ type, critico, alfajor, rowIndex, colIndex } }
 * Retorna null si el token NO es de alfajor (restaurante o legacy) => sigue el flujo normal.
 * Retorna el payload SIN tokenInfo si el token ya fue usado (carga muestra "inválido").
 */
function getAlfajorTokenData_(token) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var linksSheet = ss.getSheetByName(LINKS_SHEET_NAME);
  if (!linksSheet) return null;

  var linksRange = linksSheet.getDataRange();
  var linksData = linksRange.getValues();
  var found = findTokenRow_(linksData, token);
  if (!found) return null;

  var tipo = String(found.row[6] || '').toLowerCase().trim();
  if (tipo !== 'alfajor') return null; // restaurante o legacy => flujo normal

  // carga.js espera estos arrays aunque no los use en modo alfajor
  var base = { critics: [], dates: [], restaurantsByDate: {} };

  if (String(found.row[4]) === 'usado') return base; // sin tokenInfo => "ya usado"

  var critico = String(found.row[1]).trim();
  var alfajorName = String(linksRange.getDisplayValues()[found.rowIndex - 1][3]).trim();

  var sheet = getAlfajoresSheet_();
  if (!sheet) return base;

  var data = sheet.getDataRange().getValues();
  if (data.length === 0) return base;
  var headers = data[0];

  var nameCol = -1;
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).toLowerCase().trim();
    if ((h === 'name' || h === 'nombre') && nameCol === -1) nameCol = i;
  }

  // colIndex del crítico: header que termina en " rating", datos = RATING(1-based) - 4
  var colIndex = null;
  for (var c = 0; c < headers.length; c++) {
    var hc = String(headers[c]).toLowerCase().trim();
    if (hc.endsWith(' rating')) {
      var critName = hc.replace(/ rating$/i, '').trim();
      if (critName.toLowerCase() === critico.toLowerCase()) {
        // Alfajor: cada crítico ocupa 5 columnas [relleno, tapas, armonia,
        // presentacion, RATING]. La primera columna de datos = RATING - 4.
        colIndex = (c + 1) - 4;
        break;
      }
    }
  }

  // Fila del alfajor por nombre
  var rowIndex = null;
  var target = alfajorName.toLowerCase();
  for (var r = 1; r < data.length; r++) {
    var rn = nameCol >= 0 ? String(data[r][nameCol]).trim().toLowerCase() : '';
    if (rn === target) { rowIndex = r + 1; break; }
  }

  if (!rowIndex || !colIndex) return base;

  base.tokenInfo = {
    type: 'alfajor',
    critico: critico,
    alfajor: alfajorName,
    rowIndex: rowIndex,
    colIndex: colIndex
  };
  return base;
}

// =============================================
// SUBMIT REVIEW (flujo POST original)
// =============================================
function handleReviewSubmit(postData) {
  var rowIndex = parseInt(postData.rowIndex);
  var colIndex = parseInt(postData.colIndex);
  var vals = postData.values;
  var type = String(postData.type || '').toLowerCase();
  var token = postData.token;

  if (!token) {
    throw new Error("Se requiere un link confidencial para enviar reseñas.");
  }
  if (!rowIndex || !colIndex || !vals) {
    throw new Error("Datos de envío inválidos o incompletos.");
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var linksSheet = ss.getSheetByName(LINKS_SHEET_NAME);
  if (!linksSheet) {
    throw new Error("Falta la configuración de seguridad (links).");
  }

  var linksData = linksSheet.getDataRange().getValues();
  var found = findTokenRow_(linksData, token);
  if (!found) {
    throw new Error("El link proporcionado no es válido o fue modificado.");
  }
  var idx = found.rowIndex - 1;
  if (String(linksData[idx][4]) === 'usado') {
    throw new Error("Este enlace ya ha sido utilizado para enviar una reseña.");
  }

  // El tipo lo manda el servidor (fila de links), no el cliente.
  var linkTipo = String(found.row[6] || '').toLowerCase().trim();

  // --- Alfajor: escribe las 4 dimensiones en la hoja de alfajores ---
  if (linkTipo === 'alfajor') {
    validateScoresAlfajor(vals);
    var aSheet = getAlfajoresSheet_();
    if (!aSheet) throw new Error("No se encontró la hoja de alfajores.");

    var alfaValues = ALFAJOR_SCORE_KEYS.map(function (k) { return sanitizeCellValue(vals[k]); });
    aSheet.getRange(rowIndex, colIndex, 1, 4).setValues([alfaValues]);

    // Sella la fecha del día en la columna "fecha" del alfajor (texto DD/MM/YYYY,
    // igual que los restaurantes). Se busca por header para no depender de la posición.
    var aHeaders = aSheet.getRange(1, 1, 1, aSheet.getLastColumn()).getValues()[0];
    var fechaColIdx = buildColumnMap(aHeaders)['fecha'];
    if (fechaColIdx !== undefined && fechaColIdx !== null) {
      var hoy = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'dd/MM/yyyy');
      var fechaCell = aSheet.getRange(rowIndex, fechaColIdx + 1);
      fechaCell.setNumberFormat('@');
      fechaCell.setValue(hoy);
    }

    linksSheet.getRange(found.rowIndex, 5).setValue('usado');

    return {
      success: true,
      message: "Reseña de alfajor de " + postData.criticName + " guardada para " + postData.restaurantName
    };
  }

  // --- Restaurante (flujo original) ---
  validateScores(vals);

  var sheet = ss.getSheetByName(SHEET_NAME);

  var writeValues;
  if (type === 'delivery') {
    writeValues = [vals.comida, "", "", vals.field2, vals.field3];
  } else {
    writeValues = [vals.comida, vals.field2, vals.field3, "", ""];
  }
  // Sanitización de cada valor
  writeValues = writeValues.map(sanitizeCellValue);

  var range = sheet.getRange(rowIndex, colIndex, 1, 5);
  range.setValues([writeValues]);

  linksSheet.getRange(found.rowIndex, 5).setValue('usado');

  invalidatePublicCache_();

  return {
    success: true,
    message: "Reseña de " + postData.criticName + " guardada para " + postData.restaurantName
  };
}

// =============================================
// ADMIN: Obtener todos los datos para el panel
// =============================================
function getAdminData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    return { error: "No se encontró la pestaña '" + SHEET_NAME + "'" };
  }

  var dataRange = sheet.getDataRange();
  var data = dataRange.getValues();
  var displayData = dataRange.getDisplayValues();

  if (data.length === 0) {
    return { error: "La pestaña está vacía" };
  }

  var headers = data[0];
  var colMap = buildColumnMap(headers);

  var critics = [];
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).toLowerCase().trim();
    if (h.endsWith(' rating')) {
      var criticName = h.replace(/ rating$/i, '').trim();
      criticName = criticName.charAt(0).toUpperCase() + criticName.slice(1);
      critics.push(criticName);
    }
  }

  var maxId = 0;
  var restaurants = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var displayRow = displayData[r];

    var idVal = getVal(row, colMap, 'id');
    var pId = parseInt(idVal, 10);
    if (!isNaN(pId) && pId > maxId) {
        maxId = pId;
    }

    if (idVal) {
        idVal = ("0000000" + parseInt(idVal, 10)).slice(-7);
    }

    var nameVal = getVal(row, colMap, 'name') || getVal(row, colMap, 'nombre');
    if (!nameVal && !idVal) continue;

    var resto = {
      rowIndex: r + 1,
      id: idVal,
      name: nameVal,
      location: getVal(row, colMap, 'location') || '',
      description: getVal(row, colMap, 'description') || getVal(row, colMap, 'descripcion') || '',
      fecha: getDisplayVal(displayRow, colMap, 'fecha') || getDisplayVal(displayRow, colMap, 'date') || '',
      direccion: getVal(row, colMap, 'direccion') || getVal(row, colMap, 'address') || '',
      telefono: getVal(row, colMap, 'telefono') || getVal(row, colMap, 'phone') || '',
      instagram: getVal(row, colMap, 'instagram') || '',
      linkMapa: getVal(row, colMap, 'link mapa') || '',
      presencialDelivery: getVal(row, colMap, 'presencial delivery') || '',
      pedidoPor: getVal(row, colMap, 'pedido por') || '',
      rating: getVal(row, colMap, 'rating') || getVal(row, colMap, 'promedio') || '',
      fotos: getVal(row, colMap, 'fotos') || '',
      ranking: getVal(row, colMap, 'ranking') || ''
    };

    restaurants.push(resto);
  }

  var alfajoresInfo = getAlfajoresAdminList_();

  return {
    success: true,
    restaurants: restaurants,
    critics: critics,
    columnMap: colMap,
    headers: headers.map(function(h) { return String(h); }),
    nextId: ("0000000" + (maxId + 1)).slice(-7),
    alfajores: alfajoresInfo.alfajores,
    alfajorCritics: alfajoresInfo.alfajorCritics,
    nextAlfajorId: alfajoresInfo.nextAlfajorId
  };
}

/**
 * ADMIN: lista de alfajores + críticos + próximo ID (para el panel).
 */
function getAlfajoresAdminList_() {
  var empty = { alfajores: [], alfajorCritics: [], nextAlfajorId: '0000001' };
  var sheet = getAlfajoresSheet_();
  if (!sheet) return empty;

  var data = sheet.getDataRange().getValues();
  if (data.length === 0) return empty;

  var headers = data[0];
  var colMap = buildColumnMap(headers);

  var critics = [];
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).toLowerCase().trim();
    if (h.endsWith(' rating')) {
      var critName = h.replace(/ rating$/i, '').trim();
      critName = critName.charAt(0).toUpperCase() + critName.slice(1);
      critics.push(critName);
    }
  }

  var maxId = 0;
  var alfajores = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];

    var idVal = getVal(row, colMap, 'id');
    var pId = parseInt(idVal, 10);
    if (!isNaN(pId) && pId > maxId) maxId = pId;
    if (idVal) idVal = ("0000000" + parseInt(idVal, 10)).slice(-7);

    var nameVal = getVal(row, colMap, 'name') || getVal(row, colMap, 'nombre');
    if (!nameVal && !idVal) continue;

    alfajores.push({
      rowIndex: r + 1,
      id: idVal,
      name: nameVal,
      description: getVal(row, colMap, 'description') || getVal(row, colMap, 'descripcion') || '',
      web: getVal(row, colMap, 'web') || '',
      fotos: getVal(row, colMap, 'fotos') || ''
    });
  }

  return {
    alfajores: alfajores,
    alfajorCritics: critics,
    nextAlfajorId: ("0000000" + (maxId + 1)).slice(-7)
  };
}

function getVal(row, colMap, fieldName) {
  var idx = colMap[fieldName.toLowerCase()];
  if (idx === undefined || idx === null) return '';
  var val = row[idx];
  return val !== undefined && val !== null ? String(val).trim() : '';
}

function getDisplayVal(displayRow, colMap, fieldName) {
  var idx = colMap[fieldName.toLowerCase()];
  if (idx === undefined || idx === null) return '';
  var val = displayRow[idx];
  return val !== undefined && val !== null ? String(val).trim() : '';
}

// =============================================
// ADMIN: Actualizar un restaurante existente
// =============================================
function updateRestaurant(postData) {
  var rowIndex = parseInt(postData.rowIndex);
  var datos = postData.data;

  if (!rowIndex || !datos) {
    throw new Error("Faltan datos para actualizar el restaurante.");
  }
  validateRestaurant(datos);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error("No se encontró la pestaña '" + SHEET_NAME + "'");

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var colMap = buildColumnMap(headers);

  var fieldToHeader = {
    'id': 'id',
    'name': 'name',
    'location': 'location',
    'description': 'description',
    'fecha': 'fecha',
    'direccion': 'direccion',
    'telefono': 'telefono',
    'instagram': 'instagram',
    'linkMapa': 'link mapa',
    'presencialDelivery': 'presencial delivery',
    'pedidoPor': 'pedido por',
    'fotos': 'fotos',
    'ranking': 'ranking'
  };

  for (var field in fieldToHeader) {
    if (datos.hasOwnProperty(field)) {
      var headerName = fieldToHeader[field];
      var colIdx = colMap[headerName];
      if (colIdx !== undefined && colIdx !== null) {
        sheet.getRange(rowIndex, colIdx + 1).setValue(sanitizeCellValue(datos[field]));
      }
    }
  }

  try {
    updateFormRestaurants();
  } catch(e) {
    Logger.log("Non-fatal error updating form: " + e);
  }

  invalidatePublicCache_();

  return {
    success: true,
    message: "Restaurante '" + (datos.name || '') + "' actualizado correctamente."
  };
}

// =============================================
// ADMIN: Registrar una Nueva Visita (Agregar restaurante)
// =============================================
function addRestaurant(postData) {
  var datos = postData.data;
  validateRestaurant(datos);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error("No se encontró la pestaña '" + SHEET_NAME + "'");

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var colMap = buildColumnMap(headers);

  var idColIdx = colMap['id'];
  var insertRowIndex = sheet.getLastRow() + 1;
  var idGenerado = 1;

  // Solo leemos hasta la última fila con datos (getLastRow), no toda la hoja
  // (getMaxRows incluye ~1M de filas vacías y vuelve la operación lentísima).
  var numDataRows = sheet.getLastRow() - 1;

  if (idColIdx !== undefined && idColIdx !== null) {
      var maxId = 0;
      var lastPopulatedIdx = -1;

      if (numDataRows > 0) {
        var idValues = sheet.getRange(2, idColIdx + 1, numDataRows, 1).getValues();
        for (var i = 0; i < idValues.length; i++) {
          var strVal = String(idValues[i][0]).trim();
          if (strVal !== '') {
             lastPopulatedIdx = i;
             var pId = parseInt(strVal, 10);
             if (!isNaN(pId) && pId > maxId) maxId = pId;
          }
        }
      }

      insertRowIndex = lastPopulatedIdx + 3;
      idGenerado = ("0000000" + (maxId + 1)).slice(-7);
      datos['id'] = idGenerado;
  } else {
      var nameColIdx = colMap['name'] !== undefined ? colMap['name'] : colMap['nombre'];
      if (nameColIdx !== undefined && nameColIdx !== null && numDataRows > 0) {
          var nameValues = sheet.getRange(2, nameColIdx + 1, numDataRows, 1).getValues();
          var lastIdx = -1;
          for (var i = 0; i < nameValues.length; i++) {
              if (String(nameValues[i][0]).trim() !== '') {
                  lastIdx = i;
              }
          }
          insertRowIndex = lastIdx + 3;
      }
  }

  var fieldToHeader = {
    'id': 'id',
    'name': 'name',
    'location': 'location',
    'description': 'description',
    'fecha': 'fecha',
    'direccion': 'direccion',
    'telefono': 'telefono',
    'instagram': 'instagram',
    'linkMapa': 'link mapa',
    'presencialDelivery': 'presencial delivery',
    'pedidoPor': 'pedido por',
    'fotos': 'fotos',
    'ranking': 'ranking'
  };

  for (var field in fieldToHeader) {
    if (datos.hasOwnProperty(field)) {
      var headerName = fieldToHeader[field];
      var colIdx = colMap[headerName];
      if (colIdx !== undefined && colIdx !== null) {
        var range = sheet.getRange(insertRowIndex, colIdx + 1);
        if (field === 'id') {
           range.setNumberFormat('@');
        }
        range.setValue(sanitizeCellValue(datos[field]));
      }
    }
  }

  if (insertRowIndex > 2) {
    for (var i = 0; i < headers.length; i++) {
      var h = String(headers[i]).toLowerCase().trim();
      if (h.endsWith(' rating')) {
        var sourceRange = sheet.getRange(insertRowIndex - 1, i + 1);
        var destRange = sheet.getRange(insertRowIndex, i + 1);
        sourceRange.copyTo(destRange, SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
      }
    }
  }

  try {
    updateFormRestaurants();
  } catch(e) {
    Logger.log("Non-fatal error updating form: " + e);
  }

  invalidatePublicCache_();

  return {
    success: true,
    message: "Restaurante '" + datos.name + "' creado exitosamente.",
    rowIndex: insertRowIndex,
    idGenerado: idGenerado
  };
}

// =============================================
// ADMIN: Generar token de link de un solo uso
// =============================================
function generateToken(postData) {
  var critico = postData.critico;
  var restaurante = postData.restaurante;

  // tipo: 'restaurant' (default / legacy) | 'alfajor'
  var tipo = String(postData.tipo || 'restaurant').toLowerCase().trim();
  if (tipo !== 'alfajor') tipo = 'restaurant';

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Restaurante: fecha de la visita (la elige el admin). Alfajor: no tiene fecha de
  // visita, así que sellamos la fecha del día en que se genera el link (columna C),
  // en el mismo formato DD/MM/YYYY que usan los restaurantes.
  var fecha = tipo === 'alfajor'
    ? Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'dd/MM/yyyy')
    : postData.fecha;

  if (!critico || !restaurante) {
    throw new Error("Faltan datos: crítico y " + (tipo === 'alfajor' ? 'alfajor' : 'restaurante') + " son obligatorios.");
  }
  if (tipo === 'restaurant' && !fecha) {
    throw new Error("Falta la fecha.");
  }

  var linksSheet = ss.getSheetByName(LINKS_SHEET_NAME);
  if (!linksSheet) {
    linksSheet = ss.insertSheet(LINKS_SHEET_NAME);
    linksSheet.getRange(1, 1, 1, 7).setValues([
      ['Token (hash)', 'Crítico', 'Fecha', 'Restaurante', 'Estado', 'Creado', 'Tipo']
    ]);
    linksSheet.getRange(1, 1, 1, 7).setFontWeight('bold');
  } else if (!String(linksSheet.getRange(1, 7).getValue()).trim()) {
    // Sheet legacy de 6 columnas: agregamos el header 'Tipo' (no rompe filas viejas).
    linksSheet.getRange(1, 7).setValue('Tipo').setFontWeight('bold');
  }

  var token = generateRandomToken();
  var tokenHash = hashToken_(token);

  // Verificar colisión por hash (extremadamente improbable, pero seguro)
  var existingData = linksSheet.getDataRange().getValues();
  var collision = true;
  while (collision) {
    collision = false;
    for (var i = 1; i < existingData.length; i++) {
      if (String(existingData[i][0]) === tokenHash) {
        collision = true;
        token = generateRandomToken();
        tokenHash = hashToken_(token);
        break;
      }
    }
  }

  var timestamp = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  linksSheet.appendRow([tokenHash, sanitizeCellValue(critico), sanitizeCellValue(fecha), sanitizeCellValue(restaurante), 'pendiente', timestamp, tipo]);

  var scriptUrl = ScriptApp.getService().getUrl();
  var fullUrl = scriptUrl + '?id=' + token;

  var label = tipo === 'alfajor' ? (critico + " — " + restaurante + " (alfajor)")
                                 : (critico + " — " + restaurante + " (" + fecha + ")");

  return {
    success: true,
    token: token,
    url: fullUrl,
    tipo: tipo,
    message: "Link generado para " + label
  };
}

// =============================================
// ADMIN ALFAJORES: Crear un nuevo alfajor
// =============================================
function addAlfajor(postData) {
  var datos = postData.data;
  validateAlfajor(datos);

  var sheet = getAlfajoresSheet_();
  if (!sheet) throw new Error("No se encontró la hoja de alfajores (gid " + ALFAJORES_SHEET_GID + ").");

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var colMap = buildColumnMap(headers);

  var idColIdx = colMap['id'];
  var insertRowIndex = sheet.getLastRow() + 1;
  var idGenerado = ("0000000" + 1).slice(-7);

  // Acotamos la lectura a las filas con datos (getLastRow) en vez de toda la hoja.
  var numDataRows = sheet.getLastRow() - 1;

  if (idColIdx !== undefined && idColIdx !== null) {
    var maxId = 0;
    var lastPopulatedIdx = -1;
    if (numDataRows > 0) {
      var idValues = sheet.getRange(2, idColIdx + 1, numDataRows, 1).getValues();
      for (var i = 0; i < idValues.length; i++) {
        var strVal = String(idValues[i][0]).trim();
        if (strVal !== '') {
          lastPopulatedIdx = i;
          var pId = parseInt(strVal, 10);
          if (!isNaN(pId) && pId > maxId) maxId = pId;
        }
      }
    }
    insertRowIndex = lastPopulatedIdx + 3;
    idGenerado = ("0000000" + (maxId + 1)).slice(-7);
    datos['id'] = idGenerado;
  } else {
    var nameColIdx = colMap['name'] !== undefined ? colMap['name'] : colMap['nombre'];
    if (nameColIdx !== undefined && nameColIdx !== null && numDataRows > 0) {
      var nameValues = sheet.getRange(2, nameColIdx + 1, numDataRows, 1).getValues();
      var lastIdx = -1;
      for (var j = 0; j < nameValues.length; j++) {
        if (String(nameValues[j][0]).trim() !== '') lastIdx = j;
      }
      insertRowIndex = lastIdx + 3;
    }
  }

  var fieldToHeader = {
    'id': 'id',
    'name': 'name',
    'description': 'description',
    'web': 'web',
    'fotos': 'fotos'
  };

  for (var field in fieldToHeader) {
    if (datos.hasOwnProperty(field)) {
      var headerName = fieldToHeader[field];
      var colIdx = colMap[headerName];
      if (colIdx !== undefined && colIdx !== null) {
        var range = sheet.getRange(insertRowIndex, colIdx + 1);
        if (field === 'id') range.setNumberFormat('@');
        range.setValue(sanitizeCellValue(datos[field]));
      }
    }
  }

  // Copiar fórmulas de las columnas "… rating" (RATING por crítico) desde la fila anterior
  if (insertRowIndex > 2) {
    for (var k = 0; k < headers.length; k++) {
      var hk = String(headers[k]).toLowerCase().trim();
      if (hk.endsWith(' rating')) {
        var sourceRange = sheet.getRange(insertRowIndex - 1, k + 1);
        var destRange = sheet.getRange(insertRowIndex, k + 1);
        sourceRange.copyTo(destRange, SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
      }
    }
  }

  try {
    updateFormAlfajores();
  } catch (e) {
    Logger.log("Non-fatal error updating alfajor form: " + e);
  }

  return {
    success: true,
    message: "Alfajor '" + datos.name + "' creado exitosamente.",
    rowIndex: insertRowIndex,
    idGenerado: idGenerado
  };
}

// =============================================
// ADMIN ALFAJORES: Actualizar un alfajor existente
// =============================================
function updateAlfajor(postData) {
  var rowIndex = parseInt(postData.rowIndex);
  var datos = postData.data;

  if (!rowIndex || !datos) {
    throw new Error("Faltan datos para actualizar el alfajor.");
  }
  validateAlfajor(datos);

  var sheet = getAlfajoresSheet_();
  if (!sheet) throw new Error("No se encontró la hoja de alfajores.");

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var colMap = buildColumnMap(headers);

  var fieldToHeader = {
    'name': 'name',
    'description': 'description',
    'web': 'web',
    'fotos': 'fotos'
  };

  for (var field in fieldToHeader) {
    if (datos.hasOwnProperty(field)) {
      var headerName = fieldToHeader[field];
      var colIdx = colMap[headerName];
      if (colIdx !== undefined && colIdx !== null) {
        sheet.getRange(rowIndex, colIdx + 1).setValue(sanitizeCellValue(datos[field]));
      }
    }
  }

  try {
    updateFormAlfajores();
  } catch (e) {
    Logger.log("Non-fatal error updating alfajor form: " + e);
  }

  return {
    success: true,
    message: "Alfajor '" + (datos.name || '') + "' actualizado correctamente."
  };
}

// =============================================
// GITHUB: Subida de fotos (commit original + thumb al repo de Pages)
// =============================================

function githubHeaders_() {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('Servidor mal configurado: GITHUB_TOKEN no seteado.');
  return {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'comer-ar-admin'
  };
}

function githubApi_(method, path, payloadObj) {
  var options = {
    method: method,
    headers: githubHeaders_(),
    muteHttpExceptions: true
  };
  if (payloadObj) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payloadObj);
  }
  var resp = UrlFetchApp.fetch(GITHUB_API + path, options);
  var code = resp.getResponseCode();
  var text = resp.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('GitHub API ' + code + ': ' + text);
  }
  return text ? JSON.parse(text) : {};
}

// Defensa server-side: el cliente ya manda segmentos sanitizados.
function sanitizeSegment_(s) {
  return String(s || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

/**
 * Commitea una foto (original + thumbnail) al repo de GitHub Pages en UN solo commit
 * (Git Trees API). Protegido por requireAdminSecret en doPost.
 * Espera: { folder, name, ext, originalB64, thumbB64 } (base64 sin prefijo data:).
 * Devuelve: { success, path: './fotos/<folder>/<name>.<ext>', thumb: './fotos_thumb/...' }
 */
function uploadPhotos(postData) {
  var folder = sanitizeSegment_(postData.folder);
  var name = sanitizeSegment_(postData.name);
  var ext = String(postData.ext || 'jpg').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'jpg';
  var originalB64 = postData.originalB64;
  var thumbB64 = postData.thumbB64;

  if (!folder || !name) throw new Error('Falta folder o name para la foto.');
  if (!originalB64 || !thumbB64) throw new Error('Faltan los datos de la imagen.');

  var fullPath = 'fotos/' + folder + '/' + name + '.' + ext;
  var thumbPath = 'fotos_thumb/' + folder + '/' + name + '.jpg';
  var base = '/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO;
  var headRef = 'heads/' + GITHUB_BRANCH;

  // 1) ref de la rama -> sha del commit base
  var ref = githubApi_('get', base + '/git/ref/' + headRef);
  var baseCommitSha = ref.object.sha;

  // 2) commit base -> sha del tree base
  var baseCommit = githubApi_('get', base + '/git/commits/' + baseCommitSha);
  var baseTreeSha = baseCommit.tree.sha;

  // 3) blobs (original + thumb)
  var blobFull = githubApi_('post', base + '/git/blobs', { content: originalB64, encoding: 'base64' });
  var blobThumb = githubApi_('post', base + '/git/blobs', { content: thumbB64, encoding: 'base64' });

  // 4) nuevo tree colgando del base
  var newTree = githubApi_('post', base + '/git/trees', {
    base_tree: baseTreeSha,
    tree: [
      { path: fullPath, mode: '100644', type: 'blob', sha: blobFull.sha },
      { path: thumbPath, mode: '100644', type: 'blob', sha: blobThumb.sha }
    ]
  });

  // 5) nuevo commit
  var newCommit = githubApi_('post', base + '/git/commits', {
    message: 'admin: foto ' + fullPath,
    tree: newTree.sha,
    parents: [baseCommitSha]
  });

  // 6) mover el ref de la rama al nuevo commit
  githubApi_('patch', base + '/git/refs/' + headRef, { sha: newCommit.sha });

  return { success: true, path: './' + fullPath, thumb: './' + thumbPath };
}

// =============================================
// STATS: Obtener o crear la pestaña de estadísticas
// =============================================
function getOrCreateStatsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(STATS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(STATS_SHEET_NAME);
    sheet.getRange(1, 1, 1, 3).setValues([
      ['timestamp', 'event', 'restaurant']
    ]);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
  }
  return sheet;
}

// =============================================
// STATS: Registrar un evento de tracking
// =============================================
function trackEvent(postData) {
  var eventType = String(postData.event || '').trim();
  if (!eventType) {
    return { success: false, message: 'Tipo de evento requerido.' };
  }

  if (eventType !== 'pageview' && eventType !== 'detail_view') {
    return { success: false, message: 'Tipo de evento no válido.' };
  }

  var restaurant = String(postData.restaurant || '').trim();
  if (restaurant.length > 200) restaurant = restaurant.slice(0, 200);
  var timestamp = new Date().toISOString();

  var sheet = getOrCreateStatsSheet();
  sheet.appendRow([timestamp, eventType, sanitizeCellValue(restaurant)]);

  return { success: true };
}

// =============================================
// STATS: Obtener datos agregados de estadísticas
// =============================================
function getStats() {
  var sheet;
  try {
    sheet = getOrCreateStatsSheet();
  } catch (e) {
    return { success: true, dailyViews: [], monthlyViews: [], restaurantViews: [] };
  }

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return { success: true, dailyViews: [], monthlyViews: [], restaurantViews: [] };
  }

  var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();

  var dailyMap = {};
  var monthlyMap = {};
  var restaurantMap = {};

  for (var i = 0; i < data.length; i++) {
    var ts = data[i][0];
    var event = String(data[i][1]).trim();
    var restName = String(data[i][2]).trim();

    var d;
    if (ts instanceof Date) {
      d = ts;
    } else {
      d = new Date(String(ts));
    }

    if (isNaN(d.getTime())) continue;

    var dayKey = d.getFullYear() + '-' +
      ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getDate()).slice(-2);

    var monthKey = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);

    if (event === 'pageview') {
      dailyMap[dayKey] = (dailyMap[dayKey] || 0) + 1;
      monthlyMap[monthKey] = (monthlyMap[monthKey] || 0) + 1;
    }

    if (event === 'detail_view' && restName) {
      restaurantMap[restName] = (restaurantMap[restName] || 0) + 1;
    }
  }

  var dailyViews = Object.keys(dailyMap).sort().map(function(k) {
    return { date: k, count: dailyMap[k] };
  });

  var monthlyViews = Object.keys(monthlyMap).sort().map(function(k) {
    return { month: k, count: monthlyMap[k] };
  });

  var restaurantViews = Object.keys(restaurantMap).map(function(k) {
    return { name: k, count: restaurantMap[k] };
  }).sort(function(a, b) {
    return b.count - a.count;
  });

  return {
    success: true,
    dailyViews: dailyViews,
    monthlyViews: monthlyViews,
    restaurantViews: restaurantViews
  };
}

// =============================================
// VOTO PÚBLICO (Google OAuth)
// =============================================

/**
 * Ejecutar UNA vez desde el editor de Apps Script para autorizar el permiso de
 * "conexión a servicio externo" (script.external_request) que usa la verificación
 * del token de Google. Tras aceptar el permiso, el web app ya puede verificar
 * tokens (no hace falta redeploy). Después se puede ignorar.
 */
function forceAuth() {
  var r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=test', { muteHttpExceptions: true });
  Logger.log('forceAuth OK — HTTP ' + r.getResponseCode());
}

/**
 * Verifica un ID token (JWT) de Google contra el endpoint tokeninfo.
 * Chequea aud (== GOOGLE_CLIENT_ID), iss, exp y email_verified.
 * Devuelve { email, name, picture, sub } o lanza error.
 */
function verifyGoogleIdToken_(credential) {
  if (!credential) throw new Error('Falta la sesión de Google. Iniciá sesión para votar.');
  var clientId = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
  if (!clientId) throw new Error('Servidor mal configurado: GOOGLE_CLIENT_ID no seteado.');

  var url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential);
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Sesión inválida o expirada. Volvé a iniciar sesión.');
  }

  var info;
  try { info = JSON.parse(resp.getContentText()); } catch (e) { throw new Error('No se pudo validar la sesión.'); }

  if (String(info.aud) !== String(clientId)) {
    throw new Error('Token no emitido para esta aplicación.');
  }
  if (info.iss !== 'accounts.google.com' && info.iss !== 'https://accounts.google.com') {
    throw new Error('Emisor de token inválido.');
  }
  var now = Math.floor(Date.now() / 1000);
  if (info.exp && parseInt(info.exp, 10) < now) {
    throw new Error('Sesión expirada. Volvé a iniciar sesión.');
  }
  if (!info.email || (info.email_verified !== 'true' && info.email_verified !== true)) {
    throw new Error('No se pudo verificar tu email de Google.');
  }

  return {
    email: String(info.email).toLowerCase().trim(),
    name: info.name || info.email,
    picture: info.picture || '',
    sub: info.sub || ''
  };
}

/**
 * Pestaña de votos por gid. Garantiza los headers (incluida la columna 'tipo').
 * Retorna la hoja o null si no se encuentra el gid.
 */
function getVotesSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var sheet = null;
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === VOTES_SHEET_GID) { sheet = sheets[i]; break; }
  }
  if (!sheet) return null;

  var lastCol = sheet.getLastColumn();
  var headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var map = buildColumnMap(headers);

  if (map['timestamp'] === undefined && map['email'] === undefined) {
    // Hoja vacía: escribir los 5 headers.
    sheet.getRange(1, 1, 1, 5).setValues([['timestamp', 'email', 'vota', 'puntaje', 'tipo']]);
    sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
  } else if (map['tipo'] === undefined) {
    // Falta solo la columna 'tipo': agregarla al final sin tocar las filas viejas.
    sheet.getRange(1, lastCol + 1).setValue('tipo').setFontWeight('bold');
  }
  return sheet;
}

/**
 * Pestaña 'usuarios' (por nombre). La crea con headers si no existe.
 */
function getOrCreateUsersSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(USERS_SHEET_NAME);
    sheet.getRange(1, 1, 1, 5).setValues([['email', 'nombre', 'foto', 'registrado', 'ultimo_acceso']]);
    sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
  }
  return sheet;
}

function normalizeVoteName_(s) {
  return String(s || '').trim().toLowerCase();
}

function normalizeTipo_(tipo) {
  var t = String(tipo || '').toLowerCase().trim();
  if (t === 'delivery') return 'delivery';
  if (t === 'alfajor') return 'alfajor';
  return 'restaurant';
}

/**
 * Los tipos que comparten ranking/cuadro: el alfajor va aparte; presencial y
 * delivery se agregan juntos (igual que el frontend público).
 */
function tiposForBucket_(tipo) {
  return tipo === 'alfajor' ? ['alfajor'] : ['restaurant', 'delivery'];
}

function validateVotePuntaje_(p) {
  var n = parseFloat(p);
  if (isNaN(n) || n < 0 || n > 10) throw new Error('Puntaje inválido (debe ser un número entre 0 y 10).');
  return Math.round(n * 10) / 10;
}

function invalidateVotesCache_() {
  try { CacheService.getScriptCache().remove(PUBLIC_VOTES_CACHE_KEY); } catch (e) {}
}

/**
 * Alta o actualización del usuario en la pestaña 'usuarios'.
 */
function upsertUser_(profile) {
  var sheet = getOrCreateUsersSheet_();
  var nowStr = Utilities.formatDate(new Date(), SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'dd/MM/yyyy HH:mm');
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var emails = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < emails.length; i++) {
      if (String(emails[i][0]).toLowerCase().trim() === profile.email) {
        var rowIdx = i + 2;
        sheet.getRange(rowIdx, 2).setValue(sanitizeCellValue(profile.name));
        sheet.getRange(rowIdx, 3).setValue(sanitizeCellValue(profile.picture));
        sheet.getRange(rowIdx, 5).setValue(nowStr);
        return;
      }
    }
  }
  sheet.appendRow([profile.email, sanitizeCellValue(profile.name), sanitizeCellValue(profile.picture), nowStr, nowStr]);
}

/**
 * Agrega una fila de voto respetando el orden de columnas (por header).
 * El timestamp se sella como texto (formato '@') para que no se reinterprete.
 */
function appendVoteRow_(sheet, map, ts, email, itemName, puntaje, tipo) {
  var width = sheet.getLastColumn();
  var row = [];
  for (var i = 0; i < width; i++) row.push('');
  row[map['timestamp']] = ts;
  row[map['email']] = email;
  row[map['vota']] = sanitizeCellValue(itemName);
  row[map['puntaje']] = puntaje;
  row[map['tipo']] = tipo;
  sheet.appendRow(row);

  var r = sheet.getLastRow();
  var tsCell = sheet.getRange(r, map['timestamp'] + 1);
  tsCell.setNumberFormat('@');
  tsCell.setValue(ts);
}

function findVoteRow_(sheet, map, email, name, tipo) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  var tgtName = normalizeVoteName_(name);
  var tgtEmail = String(email).toLowerCase().trim();
  var tgtTipo = String(tipo).toLowerCase().trim();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][map['email']]).toLowerCase().trim() !== tgtEmail) continue;
    if (normalizeVoteName_(data[i][map['vota']]) !== tgtName) continue;
    if (String(data[i][map['tipo']]).toLowerCase().trim() !== tgtTipo) continue;
    return { rowIndex: i + 2, puntaje: data[i][map['puntaje']] };
  }
  return null;
}

/**
 * Promedio + cantidad de votos de un ítem (entre los tipos indicados).
 */
function aggregateForItem_(sheet, map, name, tipos) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { avg: '-', count: 0 };
  var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  var target = normalizeVoteName_(name);
  var total = 0, count = 0;
  for (var i = 0; i < data.length; i++) {
    var t = String(data[i][map['tipo']]).toLowerCase().trim();
    if (tipos.indexOf(t) === -1) continue;
    if (normalizeVoteName_(data[i][map['vota']]) !== target) continue;
    var p = parseFloat(data[i][map['puntaje']]);
    if (!isNaN(p)) { total += p; count++; }
  }
  return { avg: count ? (total / count).toFixed(1) : '-', count: count };
}

function getVotesForEmail_(email) {
  var sheet = getVotesSheet_();
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = buildColumnMap(headers);
  var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  var tgt = String(email).toLowerCase().trim();
  var out = [];
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][map['email']]).toLowerCase().trim() !== tgt) continue;
    out.push({
      vota: String(data[i][map['vota']]).trim(),
      tipo: String(data[i][map['tipo']]).toLowerCase().trim(),
      puntaje: String(data[i][map['puntaje']]).trim(),
      timestamp: String(data[i][map['timestamp']]).trim()
    });
  }
  return out;
}

// --- Endpoints ---

function submitVote(postData) {
  var profile = verifyGoogleIdToken_(postData.credential);
  if (!checkRateLimit('submitVote', profile.email, 20, 60)) {
    return { success: false, message: 'Demasiados votos en poco tiempo. Esperá un momento.' };
  }

  var name = String(postData.vota || '').trim();
  if (!name) throw new Error('Falta el ítem a votar.');
  var tipo = normalizeTipo_(postData.tipo);
  var puntaje = validateVotePuntaje_(postData.puntaje);

  var sheet = getVotesSheet_();
  if (!sheet) throw new Error('No se encontró la planilla de votos.');
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = buildColumnMap(headers);

  upsertUser_(profile);

  var existing = findVoteRow_(sheet, map, profile.email, name, tipo);
  if (existing) {
    var aggExist = aggregateForItem_(sheet, map, name, tiposForBucket_(tipo));
    return {
      success: false,
      code: 'already_voted',
      message: 'Ya tenés un voto registrado para esto.',
      puntaje: String(existing.puntaje),
      avg: aggExist.avg,
      count: aggExist.count
    };
  }

  var ts = Utilities.formatDate(new Date(), SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'dd/MM/yyyy HH:mm');
  appendVoteRow_(sheet, map, ts, profile.email, name, puntaje, tipo);
  invalidateVotesCache_();

  var agg = aggregateForItem_(sheet, map, name, tiposForBucket_(tipo));
  return { success: true, avg: agg.avg, count: agg.count, puntaje: String(puntaje) };
}

function updateVote(postData) {
  var profile = verifyGoogleIdToken_(postData.credential);
  if (!checkRateLimit('updateVote', profile.email, 20, 60)) {
    return { success: false, message: 'Demasiados cambios en poco tiempo. Esperá un momento.' };
  }

  var name = String(postData.vota || '').trim();
  if (!name) throw new Error('Falta el ítem a votar.');
  var tipo = normalizeTipo_(postData.tipo);
  var puntaje = validateVotePuntaje_(postData.puntaje);

  var sheet = getVotesSheet_();
  if (!sheet) throw new Error('No se encontró la planilla de votos.');
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = buildColumnMap(headers);

  upsertUser_(profile);

  var ts = Utilities.formatDate(new Date(), SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'dd/MM/yyyy HH:mm');
  var existing = findVoteRow_(sheet, map, profile.email, name, tipo);
  if (!existing) {
    // Idempotente: si no había voto previo, lo creamos.
    appendVoteRow_(sheet, map, ts, profile.email, name, puntaje, tipo);
  } else {
    sheet.getRange(existing.rowIndex, map['puntaje'] + 1).setValue(puntaje);
    var tsCell = sheet.getRange(existing.rowIndex, map['timestamp'] + 1);
    tsCell.setNumberFormat('@');
    tsCell.setValue(ts);
  }
  invalidateVotesCache_();

  var agg = aggregateForItem_(sheet, map, name, tiposForBucket_(tipo));
  return { success: true, avg: agg.avg, count: agg.count, puntaje: String(puntaje) };
}

function deleteVote(postData) {
  var profile = verifyGoogleIdToken_(postData.credential);
  var name = String(postData.vota || '').trim();
  if (!name) throw new Error('Falta el ítem.');
  var tipo = normalizeTipo_(postData.tipo);

  var sheet = getVotesSheet_();
  if (!sheet) throw new Error('No se encontró la planilla de votos.');
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = buildColumnMap(headers);

  var existing = findVoteRow_(sheet, map, profile.email, name, tipo);
  if (existing) {
    sheet.deleteRow(existing.rowIndex);
    invalidateVotesCache_();
  }
  var agg = aggregateForItem_(sheet, map, name, tiposForBucket_(tipo));
  return { success: true, avg: agg.avg, count: agg.count };
}

function getUserVotes(postData) {
  var profile = verifyGoogleIdToken_(postData.credential);
  return { success: true, profile: profile, votes: getVotesForEmail_(profile.email) };
}

function registerUser(postData) {
  var profile = verifyGoogleIdToken_(postData.credential);
  upsertUser_(profile);
  return { success: true, profile: profile, votes: getVotesForEmail_(profile.email) };
}

function deleteAccount(postData) {
  var profile = verifyGoogleIdToken_(postData.credential);

  // 1) Borrar todos los votos del usuario (de abajo hacia arriba).
  var sheet = getVotesSheet_();
  if (sheet) {
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      var map = buildColumnMap(headers);
      var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
      for (var i = data.length - 1; i >= 0; i--) {
        if (String(data[i][map['email']]).toLowerCase().trim() === profile.email) {
          sheet.deleteRow(i + 2);
        }
      }
    }
    invalidateVotesCache_();
  }

  // 2) Borrar la fila del usuario en 'usuarios'.
  var usersSheet = getOrCreateUsersSheet_();
  var ulast = usersSheet.getLastRow();
  if (ulast >= 2) {
    var emails = usersSheet.getRange(2, 1, ulast - 1, 1).getValues();
    for (var j = emails.length - 1; j >= 0; j--) {
      if (String(emails[j][0]).toLowerCase().trim() === profile.email) {
        usersSheet.deleteRow(j + 2);
      }
    }
  }

  return { success: true };
}

/**
 * Promedios públicos agregados (SIN emails), cacheados. Es lo que consume el
 * frontend en vez de leer la pestaña de votos por CSV.
 *   { restaurants: { <name_lower>: {avg,count} }, alfajores: { ... } }
 */
function getPublicVotes() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(PUBLIC_VOTES_CACHE_KEY);
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }

  var result = { success: true, restaurants: {}, alfajores: {} };
  var sheet = getVotesSheet_();
  if (sheet) {
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      var map = buildColumnMap(headers);
      var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
      var accR = {}, accA = {};
      for (var i = 0; i < data.length; i++) {
        var name = String(data[i][map['vota']]).trim();
        if (!name) continue;
        var p = parseFloat(data[i][map['puntaje']]);
        if (isNaN(p)) continue;
        var tipo = String(data[i][map['tipo']]).toLowerCase().trim();
        var key = name.toLowerCase();
        var acc = (tipo === 'alfajor') ? accA : accR;
        if (!acc[key]) acc[key] = { total: 0, count: 0 };
        acc[key].total += p;
        acc[key].count++;
      }
      Object.keys(accR).forEach(function (k) {
        result.restaurants[k] = { avg: (accR[k].total / accR[k].count).toFixed(1), count: accR[k].count };
      });
      Object.keys(accA).forEach(function (k) {
        result.alfajores[k] = { avg: (accA[k].total / accA[k].count).toFixed(1), count: accA[k].count };
      });
    }
  }

  try { cache.put(PUBLIC_VOTES_CACHE_KEY, JSON.stringify(result), PUBLIC_VOTES_CACHE_TTL); } catch (e) {}
  return result;
}

/**
 * ADMIN: usuarios registrados + sus votos. Requiere adminSecret (en doGet).
 */
function getUsersAdmin_() {
  var users = [];
  var byEmail = {};

  var usersSheet = getOrCreateUsersSheet_();
  var ulast = usersSheet.getLastRow();
  if (ulast >= 2) {
    var uheaders = usersSheet.getRange(1, 1, 1, usersSheet.getLastColumn()).getValues()[0];
    var umap = buildColumnMap(uheaders);
    var udata = usersSheet.getRange(2, 1, ulast - 1, usersSheet.getLastColumn()).getValues();
    for (var i = 0; i < udata.length; i++) {
      var em = String(udata[i][umap['email']]).toLowerCase().trim();
      if (!em) continue;
      var u = {
        email: em,
        nombre: String(udata[i][umap['nombre']] || ''),
        foto: String(udata[i][umap['foto']] || ''),
        registrado: String(udata[i][umap['registrado']] || ''),
        ultimoAcceso: String(udata[i][umap['ultimo_acceso']] || ''),
        votes: []
      };
      users.push(u);
      byEmail[em] = u;
    }
  }

  var vsheet = getVotesSheet_();
  if (vsheet) {
    var vlast = vsheet.getLastRow();
    if (vlast >= 2) {
      var vheaders = vsheet.getRange(1, 1, 1, vsheet.getLastColumn()).getValues()[0];
      var vmap = buildColumnMap(vheaders);
      var vdata = vsheet.getRange(2, 1, vlast - 1, vsheet.getLastColumn()).getValues();
      for (var k = 0; k < vdata.length; k++) {
        var vem = String(vdata[k][vmap['email']]).toLowerCase().trim();
        if (!vem) continue;
        var vote = {
          vota: String(vdata[k][vmap['vota']] || ''),
          tipo: String(vdata[k][vmap['tipo']] || '').toLowerCase().trim(),
          puntaje: String(vdata[k][vmap['puntaje']] || ''),
          timestamp: String(vdata[k][vmap['timestamp']] || '')
        };
        if (!byEmail[vem]) {
          var nu = { email: vem, nombre: '', foto: '', registrado: '', ultimoAcceso: '', votes: [] };
          users.push(nu);
          byEmail[vem] = nu;
        }
        byEmail[vem].votes.push(vote);
      }
    }
  }

  return { success: true, users: users };
}
