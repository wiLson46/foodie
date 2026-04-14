/**
 * Código para ser desplegado como Web App en Google Apps Script.
 *
 * ESTRUCTURA POR CRÍTICO (6 columnas):
 * [comida, lugar, atencion, presentacion, precio, RATING(AUTO)]
 * La columna "RATING" (auto-calculada) es la ÚLTIMA del bloque.
 * Los datos del usuario se escriben en las 5 columnas ANTERIORES.
 *
 * IMPORTANTE: Después de pegar este código, crear una NUEVA implementación.
 */

var SHEET_NAME = 'mainTable';
var LINKS_SHEET_NAME = 'links';
var STATS_SHEET_NAME = 'stats';

// =============================================
// CAMPOS BASE de cada restaurante (columnas A-M aprox.)
// Se detectan dinámicamente por nombre de header.
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

    // --- Flujo original: datos para index.html / carga.html ---
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
    Logger.log("Recibido POST: " + e.postData.contents);
    var postData = JSON.parse(e.postData.contents);
    var action = postData.action || 'submitReview';

    switch (action) {
      case 'updateRestaurant':
        return sendJson(updateRestaurant(postData));
      case 'addRestaurant':
        return sendJson(addRestaurant(postData));
      case 'generateToken':
        return sendJson(generateToken(postData));
      case 'trackEvent':
        return sendJson(trackEvent(postData));
      case 'submitReview':
      default:
        return sendJson(handleReviewSubmit(postData));
    }

  } catch (error) {
    Logger.log("Error en POST: " + error.toString());
    return sendJson({ success: false, message: error.toString() });
  }
}

// =============================================
// UTILIDADES
// =============================================

function sendJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Construye un mapa de nombre_header → índice_columna (0-based)
 */
function buildColumnMap(headers) {
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).toLowerCase().trim();
    if (h) map[h] = i;
  }
  return map;
}

/**
 * Genera un token alfanumérico aleatorio de longitud dada
 */
function generateRandomToken(length) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var token = '';
  for (var i = 0; i < length; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// =============================================
// DATOS PÚBLICOS (index.html, carga.html)
// =============================================
function getPublicData(token) {
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

  // Detectar columnas clave
  var dateCol = -1, nameCol = -1, typeCol = -1;
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).toLowerCase().trim();
    if ((h === 'fecha' || h === 'date') && dateCol === -1) dateCol = i;
    if ((h === 'name' || h === 'nombre') && nameCol === -1) nameCol = i;
    if ((h === 'presencial delivery' || h === 'tipo' || h === 'type') && typeCol === -1) typeCol = i;
  }

  // Encontrar críticos buscando headers "RATING"
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

  // Construir mapeo Fecha -> Restaurantes
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

  // Ordenar fechas cronológicamente
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
    restaurantsByDate: restaurantsByDate,
    _debug: {
      dateCol: dateCol,
      nameCol: nameCol,
      typeCol: typeCol,
      totalHeaders: headers.length,
      sampleHeaders: headers.slice(0, 25).map(function(h) { return String(h); })
    }
  };

  if (token) {
    var linksSheet = ss.getSheetByName(LINKS_SHEET_NAME);
    if (linksSheet) {
      var linksData = linksSheet.getDataRange().getValues();
      var linksDisplayData = linksSheet.getDataRange().getDisplayValues();
      for (var i = 1; i < linksData.length; i++) {
        if (String(linksData[i][0]) === token) {
          if (String(linksData[i][4]) === 'usado') {
             break; // Token ya usado, no devolver tokenInfo
          }
          resultData.tokenInfo = {
            critico: String(linksData[i][1]),
            fecha: String(linksDisplayData[i][2]),
            restaurante: String(linksDisplayData[i][3])
          };
          break;
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

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var linksSheet = ss.getSheetByName(LINKS_SHEET_NAME);
  if (!linksSheet) {
    throw new Error("Falta la configuración de seguridad (links).");
  }

  var linksData = linksSheet.getDataRange().getValues();
  var tokenRow = -1;
  for (var i = 1; i < linksData.length; i++) {
    if (String(linksData[i][0]) === token) {
      if (String(linksData[i][4]) === 'usado') {
        throw new Error("Este enlace ya ha sido utilizado para enviar una reseña.");
      }
      tokenRow = i + 1; // Indexación 1-based nativa en Google Sheets
      break;
    }
  }

  if (tokenRow === -1) {
    throw new Error("El link proporcionado no es válido o fue modificado.");
  }

  if (!rowIndex || !colIndex || !vals) {
    throw new Error("Datos de envío inválidos o incompletos.");
  }

  var sheet = ss.getSheetByName(SHEET_NAME);

  var writeValues;
  if (type === 'delivery') {
    writeValues = [vals.comida, "", "", vals.field2, vals.field3];
  } else {
    writeValues = [vals.comida, vals.field2, vals.field3, "", ""];
  }

  var range = sheet.getRange(rowIndex, colIndex, 1, 5);
  range.setValues([writeValues]);

  // Marcar token como utilizado para cerrar la brecha de un solo uso
  linksSheet.getRange(tokenRow, 5).setValue('usado');

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

  // Detectar críticos
  var critics = [];
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).toLowerCase().trim();
    if (h.endsWith(' rating')) {
      var criticName = h.replace(/ rating$/i, '').trim();
      criticName = criticName.charAt(0).toUpperCase() + criticName.slice(1);
      critics.push(criticName);
    }
  }

  // Construir lista de restaurantes con todos los campos
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
    
    // Asegurar formato de 7 dígitos para enviar al cliente
    if (idVal) {
        idVal = ("0000000" + parseInt(idVal, 10)).slice(-7);
    }

    var nameVal = getVal(row, colMap, 'name') || getVal(row, colMap, 'nombre');
    // Considerar válidas filas que tienen nombre o id (en caso de que falte nombre temporalmente)
    if (!nameVal && !idVal) continue; 

    var resto = {
      rowIndex: r + 1, // 1-based para Google Sheets
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

/**
 * Obtiene un valor de una fila a partir del mapa de columnas
 */
function getVal(row, colMap, fieldName) {
  var idx = colMap[fieldName.toLowerCase()];
  if (idx === undefined || idx === null) return '';
  var val = row[idx];
  return val !== undefined && val !== null ? String(val).trim() : '';
}

/**
 * Obtiene el displayValue (texto visible en la celda) de una fila
 */
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

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error("No se encontró la pestaña '" + SHEET_NAME + "'");

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var colMap = buildColumnMap(headers);

  // Mapa de campo → nombre de header
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

  // Escribir cada campo que exista en el mapa de columnas
  for (var field in fieldToHeader) {
    if (datos.hasOwnProperty(field)) {
      var headerName = fieldToHeader[field];
      var colIdx = colMap[headerName];
      if (colIdx !== undefined && colIdx !== null) {
        // colIdx es 0-based, sheet.getRange necesita 1-based
        sheet.getRange(rowIndex, colIdx + 1).setValue(datos[field]);
      }
    }
  }

  return {
    success: true,
    message: "Restaurante '" + (datos.name || '') + "' actualizado correctamente."
  };
}

// =============================================
// ADMIN: Agregar un nuevo restaurante
// =============================================
function addRestaurant(postData) {
  var datos = postData.data;
  if (!datos || !datos.name) {
    throw new Error("El nombre del restaurante es obligatorio.");
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error("No se encontró la pestaña '" + SHEET_NAME + "'");

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var colMap = buildColumnMap(headers);

  // Buscar el último ID para la fila correcta y auto-generar
  var idColIdx = colMap['id'];
  var insertRowIndex = sheet.getLastRow() + 1;
  var idGenerado = 1;

  if (idColIdx !== undefined && idColIdx !== null) {
      var idValues = sheet.getRange(2, idColIdx + 1, sheet.getMaxRows() - 1, 1).getValues();
      var maxId = 0;
      var lastPopulatedIdx = -1; // -1 corresponde a la ausencia de datos en el rango
      
      for (var i = 0; i < idValues.length; i++) {
        var strVal = String(idValues[i][0]).trim();
        if (strVal !== '') {
           lastPopulatedIdx = i;
           var pId = parseInt(strVal, 10);
           if (!isNaN(pId) && pId > maxId) maxId = pId;
        }
      }
      
      insertRowIndex = lastPopulatedIdx + 3; // +2 de offset (row 2 empieza index 0), +1 para nueva fila
      idGenerado = ("0000000" + (maxId + 1)).slice(-7);
      datos['id'] = idGenerado;
  } else {
      // Fallback si no está la columna ID (buscamos por nombre)
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

  // Escribir campo por campo (celda por celda) en vez de un Array completo 
  // para NO borrar las fórmulas en columnas vacías.
  for (var field in fieldToHeader) {
    if (datos.hasOwnProperty(field)) {
      var headerName = fieldToHeader[field];
      var colIdx = colMap[headerName];
      if (colIdx !== undefined && colIdx !== null) {
        var range = sheet.getRange(insertRowIndex, colIdx + 1);
        if (field === 'id') {
           // Forzar formato texto para que no borre los ceros
           range.setNumberFormat('@');
        }
        range.setValue(datos[field]);
      }
    }
  }

  // --- NUEVO: Propagar fórmulas de RATING (promedios) ---
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

  // Obtener o crear la pestaña de links
  var linksSheet = ss.getSheetByName(LINKS_SHEET_NAME);
  if (!linksSheet) {
    linksSheet = ss.insertSheet(LINKS_SHEET_NAME);
    // Crear headers
    linksSheet.getRange(1, 1, 1, 6).setValues([
      ['Token', 'Crítico', 'Fecha', 'Restaurante', 'Estado', 'Creado']
    ]);
    // Formato de headers
    linksSheet.getRange(1, 1, 1, 6).setFontWeight('bold');
  }

  // Generar token único
  var token = generateRandomToken(8);

  // Verificar que no exista (muy improbable pero seguro)
  var existingData = linksSheet.getDataRange().getValues();
  var tokenExists = true;
  while (tokenExists) {
    tokenExists = false;
    for (var i = 1; i < existingData.length; i++) {
      if (String(existingData[i][0]) === token) {
        tokenExists = true;
        token = generateRandomToken(8);
        break;
      }
    }
  }

  // Insertar la fila del link
  var timestamp = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  linksSheet.appendRow([token, critico, fecha, restaurante, 'pendiente', timestamp]);

  // Construir la URL completa de la web app
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

  // Solo aceptar eventos conocidos
  if (eventType !== 'pageview' && eventType !== 'detail_view') {
    return { success: false, message: 'Tipo de evento no válido.' };
  }

  var restaurant = String(postData.restaurant || '').trim();
  var timestamp = new Date().toISOString();

  var sheet = getOrCreateStatsSheet();
  sheet.appendRow([timestamp, eventType, restaurant]);

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

  // Agrupar pageviews por día y mes
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

    // Formato día: YYYY-MM-DD
    var dayKey = d.getFullYear() + '-' +
      ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getDate()).slice(-2);

    // Formato mes: YYYY-MM
    var monthKey = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);

    if (event === 'pageview') {
      dailyMap[dayKey] = (dailyMap[dayKey] || 0) + 1;
      monthlyMap[monthKey] = (monthlyMap[monthKey] || 0) + 1;
    }

    if (event === 'detail_view' && restName) {
      restaurantMap[restName] = (restaurantMap[restName] || 0) + 1;
    }
  }

  // Convertir a arrays ordenados
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
