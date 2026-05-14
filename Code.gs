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

var PUBLIC_CACHE_KEY = 'publicData_v1';
var PUBLIC_CACHE_TTL = 300; // 5 min

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
      return sendJson(getAdminData());
    }

    if (action === 'getStats') {
      return sendJson(getStats());
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
      case 'generateToken':
        requireAdminSecret(postData);
        return sendJson(generateToken(postData));
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
 *
 * Para producción: configurar `ADMIN_SECRET` en Project Settings > Script Properties.
 * Si no está configurado, se usa el fallback hardcodeado.
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
  ['location', 'description', 'direccion', 'telefono', 'instagram', 'pedidoPor'].forEach(function (f) {
    if (data[f] && String(data[f]).length > 1000) {
      throw new Error('Campo demasiado largo: ' + f);
    }
  });
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
  validateScores(vals);

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

  return {
    success: true,
    restaurants: restaurants,
    critics: critics,
    columnMap: colMap,
    headers: headers.map(function(h) { return String(h); }),
    nextId: ("0000000" + (maxId + 1)).slice(-7)
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

  if (idColIdx !== undefined && idColIdx !== null) {
      var idValues = sheet.getRange(2, idColIdx + 1, sheet.getMaxRows() - 1, 1).getValues();
      var maxId = 0;
      var lastPopulatedIdx = -1;

      for (var i = 0; i < idValues.length; i++) {
        var strVal = String(idValues[i][0]).trim();
        if (strVal !== '') {
           lastPopulatedIdx = i;
           var pId = parseInt(strVal, 10);
           if (!isNaN(pId) && pId > maxId) maxId = pId;
        }
      }

      insertRowIndex = lastPopulatedIdx + 3;
      idGenerado = ("0000000" + (maxId + 1)).slice(-7);
      datos['id'] = idGenerado;
  } else {
      var nameColIdx = colMap['name'] !== undefined ? colMap['name'] : colMap['nombre'];
      if (nameColIdx !== undefined && nameColIdx !== null) {
          var nameValues = sheet.getRange(2, nameColIdx + 1, sheet.getMaxRows() - 1, 1).getValues();
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
  var fecha = postData.fecha;
  var restaurante = postData.restaurante;

  if (!critico || !fecha || !restaurante) {
    throw new Error("Faltan datos: crítico, fecha y restaurante son obligatorios.");
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var linksSheet = ss.getSheetByName(LINKS_SHEET_NAME);
  if (!linksSheet) {
    linksSheet = ss.insertSheet(LINKS_SHEET_NAME);
    linksSheet.getRange(1, 1, 1, 6).setValues([
      ['Token (hash)', 'Crítico', 'Fecha', 'Restaurante', 'Estado', 'Creado']
    ]);
    linksSheet.getRange(1, 1, 1, 6).setFontWeight('bold');
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
  linksSheet.appendRow([tokenHash, sanitizeCellValue(critico), sanitizeCellValue(fecha), sanitizeCellValue(restaurante), 'pendiente', timestamp]);

  var scriptUrl = ScriptApp.getService().getUrl();
  var fullUrl = scriptUrl + '?id=' + token;

  return {
    success: true,
    token: token,
    url: fullUrl,
    message: "Link generado para " + critico + " — " + restaurante + " (" + fecha + ")"
  };
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
