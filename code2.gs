// =============================================
// ACTUALIZAR FORMULARIO DE VOTOS
// =============================================
/**
 * Actualiza las opciones de la pregunta "Lugar a votar" en Google Forms
 * basándose en los nombres únicos de la tabla principal.
 */
function updateFormRestaurants() {
  var FORM_ID = '1KHULr2NKXyvU57qObwUw9S1y2h_S8TZFimIIWfScnVk'; 
  var SPREADSHEET_ID = '1x6ZnQFGZW-YkzoCxN51NXvpsYl3XuV4rtfBN5k7EucA';
  
  // Usamos openById para evitar el error "Cannot read properties of null" si se pierde el contexto activo
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('mainTable');
  if (!sheet) {
    Logger.log("No se encontró la hoja 'mainTable'");
    return;
  }
  
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return; // Sin datos
  
  var headers = data[0];
  
  // Encontrar la columna "name" o "nombre"
  var nameCol = -1;
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).toLowerCase().trim();
    if (h === 'name' || h === 'nombre') {
      nameCol = i;
      break;
    }
  }
  
  if (nameCol === -1) {
    Logger.log("No se encontró la columna name/nombre en la hoja " + SHEET_NAME);
    return;
  }
  
  // Extraer nombres únicos filtrando vacíos y errores de Google Sheets como #REF!
  var uniqueNames = [];
  for (var i = 1; i < data.length; i++) {
    var name = String(data[i][nameCol]).trim();
    // Validar que no esté vacío, que no sea repetido y que no sea un error de fórmula
    if (name !== "" && 
        uniqueNames.indexOf(name) === -1 &&
        name.indexOf('#REF!') === -1 &&
        name.indexOf('#N/A') === -1 &&
        name.indexOf('#NAME?') === -1 &&
        name.indexOf('#VALUE!') === -1) {
      
      uniqueNames.push(name);
    }
  }
  
  if (uniqueNames.length === 0) {
    uniqueNames.push('Sin restaurantes (vacio)');
  }

  // Ordenar alfabéticamente
  uniqueNames.sort(function(a, b) {
    return a.toLowerCase().localeCompare(b.toLowerCase());
  });
  
  Logger.log("Se encontraron " + uniqueNames.length + " restaurantes únicos.");
  
  if (FORM_ID === 'AQUI_PONE_EL_ID_DEL_FORM_DE_EDICION') {
    Logger.log("ERORR: Debes poner el ID de tu formulario en la variable FORM_ID.");
    return;
  }
  
  try {
    var form = FormApp.openById(FORM_ID);
    var items = form.getItems();
    
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var title = item.getTitle().toLowerCase().trim();
      
      // Busca la pregunta llamada "Lugar a votar" (o que contenga esas palabras)
      if (title.indexOf('lugar') !== -1 || title.indexOf('restaurante') !== -1) {
        var itemType = item.getType();
        
        if (itemType === FormApp.ItemType.LIST) {
          item.asListItem().setChoiceValues(uniqueNames);
          Logger.log("Pregunta de tipo Lista Desplegable actualizada con éxito.");
          return;
        } else if (itemType === FormApp.ItemType.MULTIPLE_CHOICE) {
          item.asMultipleChoiceItem().setChoiceValues(uniqueNames);
          Logger.log("Pregunta de tipo Selección Múltiple actualizada con éxito.");
          return;
        }
      }
    }
    
    Logger.log("No se encontró ninguna pregunta que contenga 'Lugar' o 'Restaurante' en su título.");
    
  } catch (error) {
    Logger.log("Error al abrir o editar el Formulario: " + error.toString());
  }
}
