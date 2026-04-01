/**
 * Código para ser desplegado como Web App en Google Apps Script.
 * Administra las solicitudes GET (para obtener críticos y fechas)
 * y POST (para cargar reseñas) desde la página de Frontend.
 *
 * ESTRUCTURA POR CRÍTICO (6 columnas):
 * [comida, lugar, atencion, presentacion, precio, rating(AUTO)]
 * La columna "rating" es la que termina en " rating" en el header.
 * Los datos se escriben en las 5 columnas ANTERIORES al rating.
 *
 * IMPORTANTE: Después de pegar este código, crear una NUEVA implementación.
 */

const SHEET_NAME = 'mainTable';

function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({
        error: "No se encontró la pestaña '" + SHEET_NAME + "'"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var data = sheet.getDataRange().getValues();
    if (data.length === 0) {
      return ContentService.createTextOutput(JSON.stringify({
        error: "La pestaña está vacía"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var headers = data[0];
    var tz = ss.getSpreadsheetTimeZone(); // Usar timezone del spreadsheet

    // =============================================
    // 1. Detectar columnas clave dinámicamente
    // =============================================
    var dateCol = -1;
    var nameCol = -1;
    var typeCol = -1;

    for (var i = 0; i < headers.length; i++) {
      var h = String(headers[i]).toLowerCase().trim();
      if ((h === 'fecha' || h === 'date') && dateCol === -1) dateCol = i;
      if ((h === 'name' || h === 'nombre') && nameCol === -1) nameCol = i;
      if ((h === 'presencial delivery' || h === 'tipo' || h === 'type') && typeCol === -1) typeCol = i;
    }

    // =============================================
    // 2. Encontrar críticos buscando headers " rating"
    //    El " rating" es la ÚLTIMA columna del bloque.
    //    Las 5 columnas de datos están ANTES del rating.
    // =============================================
    var critics = [];
    for (var i = 0; i < headers.length; i++) {
      var h = String(headers[i]).toLowerCase().trim();
      if (h.endsWith(' rating')) {
        var criticName = h.replace(/ rating$/, '').trim();
        criticName = criticName.charAt(0).toUpperCase() + criticName.slice(1);

        // dataStartCol = 5 columnas ANTES del rating (1-based para getRange)
        var ratingCol1Based = i + 1;
        var dataStartCol = ratingCol1Based - 5;

        critics.push({
          name: criticName,
          colIndex: dataStartCol  // Columna donde empieza el bloque de datos (1-based)
        });
      }
    }

    // =============================================
    // 3. Construir mapeo Fecha -> Restaurantes
    // =============================================
    var datesSet = {};
    var restaurantsByDate = {};

    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      var rawDate = dateCol >= 0 ? row[dateCol] : '';
      var restaurant = nameCol >= 0 ? row[nameCol] : '';
      var type = typeCol >= 0 ? row[typeCol] : '';

      if (!rawDate || !restaurant) continue;

      // Formatear fecha usando el timezone del spreadsheet
      var dateStr = '';
      if (rawDate instanceof Date) {
        dateStr = Utilities.formatDate(rawDate, tz, "dd/MM/yyyy");
      } else {
        dateStr = String(rawDate);
      }

      datesSet[dateStr] = true;
      if (!restaurantsByDate[dateStr]) {
        restaurantsByDate[dateStr] = [];
      }

      restaurantsByDate[dateStr].push({
        name: String(restaurant),
        type: String(type),
        rowIndex: r + 1  // 1-based
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

    var response = {
      critics: critics,
      dates: sortedDates,
      restaurantsByDate: restaurantsByDate,
      _debug: {
        dateCol: dateCol,
        nameCol: nameCol,
        typeCol: typeCol,
        timezone: tz,
        totalHeaders: headers.length,
        sampleHeaders: headers.slice(0, 25).map(function(h) { return String(h); })
      }
    };

    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Responde a solicitudes HTTP POST.
 * Escribe la reseña en las 5 columnas de datos del crítico.
 * NO toca la columna de rating/promedio (se auto-calcula en el sheet).
 *
 * Payload esperado:
 * {
 *   rowIndex: number (1-based),
 *   colIndex: number (1-based, inicio del bloque de datos),
 *   criticName: string,
 *   restaurantName: string,
 *   type: "presencial" | "delivery",
 *   values: { comida: number, field2: number, field3: number }
 * }
 *
 * Bloque de 5 columnas de datos:
 * [comida, lugar, atencion, presentacion, precio]
 *
 * Presencial: escribe comida, lugar, atencion (pos 1, 2, 3)
 * Delivery:   escribe comida, presentacion, precio (pos 1, 4, 5)
 */
function doPost(e) {
  try {
    Logger.log("Recibido POST: " + e.postData.contents);
    var postData = JSON.parse(e.postData.contents);

    var rowIndex = parseInt(postData.rowIndex);
    var colIndex = parseInt(postData.colIndex); // Inicio del bloque de datos (1-based)
    var vals = postData.values;
    var type = String(postData.type || '').toLowerCase();

    if (!rowIndex || !colIndex || !vals) {
      throw new Error("Datos de envío inválidos o incompletos.");
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);

    // Construir array de 5 valores para las columnas de datos
    // Orden: [comida, lugar, atencion, presentacion, precio]
    var writeValues;
    if (type === 'delivery') {
      writeValues = [vals.comida, "", "", vals.field2, vals.field3];
    } else {
      // Presencial (por defecto)
      writeValues = [vals.comida, vals.field2, vals.field3, "", ""];
    }

    // Escribir exactamente 5 celdas (SIN tocar la 6ta que es el promedio auto)
    var range = sheet.getRange(rowIndex, colIndex, 1, 5);
    range.setValues([writeValues]);

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      message: "Reseña de " + postData.criticName + " guardada para " + postData.restaurantName
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    Logger.log("Error en POST: " + error.toString());
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
