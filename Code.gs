/**
 * Código para ser desplegado como Web App en Google Apps Script.
 * Administra las solicitudes GET (para obtener críticos y fechas)
 * y POST (para cargar reseñas) desde la página de Frontend.
 *
 * IMPORTANTE: Después de pegar este código, crear una NUEVA implementación
 * (Desplegar > Nueva implementación) para que los cambios tomen efecto.
 */

const SHEET_NAME = 'mainTable';

/**
 * Responde a solicitudes HTTP GET.
 * Devuelve un JSON con: críticos, fechas, e información de restaurantes relacionada.
 * Detecta columnas dinámicamente leyendo los headers de la Fila 1.
 */
function doGet(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
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
    //    Esto es más robusto que saltar de a N columnas.
    // =============================================
    var critics = [];
    for (var i = 0; i < headers.length; i++) {
      var h = String(headers[i]).toLowerCase().trim();
      if (h.endsWith(' rating')) {
        var criticName = h.replace(/ rating$/, '').trim();
        // Capitalizar primera letra
        criticName = criticName.charAt(0).toUpperCase() + criticName.slice(1);
        critics.push({
          name: criticName,
          colIndex: i + 1  // 1-based para getRange()
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

      // Formatear fecha (GAS puede devolver objeto Date nativo)
      var dateStr = String(rawDate);
      if (rawDate instanceof Date) {
        dateStr = Utilities.formatDate(rawDate, Session.getScriptTimeZone(), "dd/MM/yyyy");
      }

      datesSet[dateStr] = true;
      if (!restaurantsByDate[dateStr]) {
        restaurantsByDate[dateStr] = [];
      }

      restaurantsByDate[dateStr].push({
        name: String(restaurant),
        type: String(type),
        rowIndex: r + 1  // 1-based para getRange()
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
      // Debug: incluir los headers detectados para verificación
      _debug: {
        dateCol: dateCol,
        nameCol: nameCol,
        typeCol: typeCol,
        totalHeaders: headers.length,
        sampleHeaders: headers.slice(0, 20).map(function(h) { return String(h); })
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
 * Graba una reseña garantizando usar el bloque correcto del crítico.
 *
 * Payload esperado:
 * {
 *   rowIndex: number (1-based),
 *   colIndex: number (1-based, columna del " rating" del crítico),
 *   criticName: string,
 *   restaurantName: string,
 *   type: "presencial" | "delivery",
 *   values: { rating: number, comida: number, field2: number, field3: number }
 * }
 *
 * El bloque por crítico es de 6 columnas:
 * [rating, comida, lugar, atencion, presentacion, precio]
 */
function doPost(e) {
  try {
    Logger.log("Recibido POST: " + e.postData.contents);
    var postData = JSON.parse(e.postData.contents);

    var rowIndex = parseInt(postData.rowIndex);
    var colIndex = parseInt(postData.colIndex);
    var vals = postData.values;
    var type = String(postData.type || '').toLowerCase();

    if (!rowIndex || !colIndex || !vals) {
      throw new Error("Datos de envío inválidos o incompletos.");
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);

    // Construir el array de 6 valores según el tipo
    // Orden de columnas: [rating, comida, lugar, atencion, presentacion, precio]
    var writeValues;
    if (type === 'delivery') {
      writeValues = [vals.rating, vals.comida, "", "", vals.field2, vals.field3];
    } else {
      // Presencial (por defecto)
      writeValues = [vals.rating, vals.comida, vals.field2, vals.field3, "", ""];
    }

    // Escribir exactamente 6 celdas en el bloque del crítico
    var range = sheet.getRange(rowIndex, colIndex, 1, 6);
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
