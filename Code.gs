/**
 * Código para ser desplegado como Web App en Google Apps Script.
 * Administra las solicitudes GET (para obtener críticos y fechas)
 * y POST (para cargar reseñas) desde la página de Frontend.
 */

const SHEET_NAME = 'mainTable';

/**
 * Responde a solicitudes HTTP GET.
 * Devuelve un JSON con: críticos, fechas, e información de restaurantes relacionada.
 */
function doGet(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) {
        return ContentService.createTextOutput(JSON.stringify({ error: "No se encontró la pestaña " + SHEET_NAME }))
          .setMimeType(ContentService.MimeType.JSON);
    }

    var data = sheet.getDataRange().getValues();
    if (data.length === 0) {
      return ContentService.createTextOutput(JSON.stringify({ error: "La pestaña está vacía" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    var headers = data[0];
    
    // 1. Extraer los nombres de Críticos
    // El requerimiento dice que están en la Fila 1 a partir de la columna N (índice 13).
    // Tomamos saltos de 5 columnas para encontrar al siguiente crítico.
    var critics = [];
    var criticsStartCol = 13; // Índice de columna N (0-based)
    var columnasPorCritico = 5; 
    
    for (var i = criticsStartCol; i < headers.length; i += columnasPorCritico) {
      // Remover " rating" del nombre si lo tiene
      let rawName = headers[i];
      if (rawName && typeof rawName === 'string' && rawName.trim() !== "") {
          let cleanName = rawName.replace(/ rating$/i, '').trim();
          critics.push({
            name: cleanName,
            colIndex: i + 1 // Para .getRange(), las columnas son 1-based
          });
      }
    }
    
    // 2. Extraer Restaurantes y Fechas
    var restaurantsMapping = {}; 
    var datesObj = {};
    
    // Iteramos desde la fila 2 en adelante
    for (var r = 1; r < data.length; r++) {
      var fullRow = data[r];
      var rawDate = fullRow[0]; // Columna A
      var restaurant = fullRow[1]; // Columna B
      var type = fullRow[2]; // Columna C (Presencial / Delivery)
      
      if (!rawDate || !restaurant) continue;
      
      // Formatear correctamente la fecha (si viene como objeto Date de GAS)
      var dateStr = String(rawDate);
      if (rawDate instanceof Date) {
         // Ajustar formato según como esté en la vista D/M/YYYY
         dateStr = Utilities.formatDate(rawDate, Session.getScriptTimeZone(), "dd/MM/yyyy");
      }
      
      datesObj[dateStr] = true;
      if (!restaurantsMapping[dateStr]) {
        restaurantsMapping[dateStr] = [];
      }
      
      restaurantsMapping[dateStr].push({
        name: restaurant,
        type: type,
        rowIndex: r + 1 // Para .getRange(), las filas son 1-based
      });
    }
    
    var sortedDates = Object.keys(datesObj).sort(function(a, b){
      // Intenta ordenar dd/mm/yyyy
      var pa = a.split('/'); var pb = b.split('/');
      if(pa.length === 3 && pb.length === 3) {
         var da = new Date(pa[2], pa[1]-1, pa[0]);
         var db = new Date(pb[2], pb[1]-1, pb[0]);
         return da - db;
      }
      return 0;
    });

    var response = {
      critics: critics,
      dates: sortedDates,
      restaurantsByDate: restaurantsMapping
    };
    
    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Responde a solicitudes HTTP POST.
 * Graba una reseña garantizando usar el bloque correcto.
 */
function doPost(e) {
  try {
    Logger.log("Recibido POST: " + e.postData.contents);
    var postData = JSON.parse(e.postData.contents);
    
    var rowIndex = parseInt(postData.rowIndex);
    var colIndex = parseInt(postData.colIndex);
    var targetValues = postData.values; // Formato esperado: [promedio, comida, lugar_o_presentacion, atencion_o_precio, ""]
    
    if (!rowIndex || !colIndex || !targetValues || !Array.isArray(targetValues)) {
       throw new Error("Datos de envío inválidos o incompletos.");
    }

    if (targetValues.length < 5) {
       // Rellenar si mandan menos campos.
       while(targetValues.length < 5) targetValues.push("");
    } else if (targetValues.length > 5) {
       targetValues = targetValues.slice(0, 5); // Acotar a 5 exactos
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    
    // Escribe exactamente en 1 fila, arrancando en `colIndex` y a lo largo de 5 celdas a la derecha
    var range = sheet.getRange(rowIndex, colIndex, 1, 5);
    
    // IMPORTANTE: setValue recibe un 2D array: [[val1, val2, ...]]
    range.setValues([targetValues]);
    
    return ContentService.createTextOutput(JSON.stringify({
      success: true, 
      message: "Reseña de " + postData.criticName + " guardada en " + postData.restaurantName
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    Logger.log("Error en POST: " + error.toString());
    return ContentService.createTextOutput(JSON.stringify({
      success: false, 
      message: error.toString() 
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Permite manejar solicitudes OPTION si el navegador hace 'preflight' por temas de CORS
 */
function doOptions(e) {
  return ContentService.createTextOutput("")
    .setMimeType(ContentService.MimeType.TEXT);
}
