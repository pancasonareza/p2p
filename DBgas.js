// Ganti dengan URL Google Sheets Anda jika ingin memantau log data lewat spreadsheet
const SPREADSHEET_ID = ""; 

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    
    // Inisialisasi properti cache/simpanan
    const scriptProperties = PropertiesService.getScriptProperties();

    // AKSI 1: Menyimpan kode SDP (Offer atau Answer)
    if (action === "save") {
      const payload = JSON.parse(data.text);
      const roomId = payload.id;
      const type = payload.type;

      // Simpan data SDP ke dalam server cache properti GAS menggunakan key unik
      // Format Key: room_[ID_ROOM]_[TYPE_SDP] (Contoh: room_p_xyz123_offer)
      scriptProperties.setProperty("room_" + roomId + "_" + type, data.text);

      // (Opsional) Tulis ke Google Sheets jika ID diisi untuk backup data
      if (SPREADSHEET_ID) {
        const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getActiveSheet();
        sheet.appendRow([new Date(), roomId, type, data.text]);
      }

      return ContentService.createTextOutput(JSON.stringify({ success: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // AKSI 2: Mengambil daftar seluruh sinyal SDP yang aktif untuk kebutuhan polling
    if (action === "list") {
      const allProps = scriptProperties.getProperties();
      const sdpList = [];

      for (let key in allProps) {
        if (key.indexOf("room_") === 0) {
          sdpList.push(allProps[key]);
        }
      }

      // Kembalikan data dalam bentuk Array JSON murni
      return ContentService.createTextOutput(JSON.stringify(sdpList))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // AKSI TAMBAHAN: Membersihkan database/cache lama yang tidak terpakai
    if (action === "clear") {
      scriptProperties.deleteAllProperties();
      return ContentService.createTextOutput(JSON.stringify({ success: true, message: "Database dibersihkan" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Mengizinkan pengetesan via browser / metode GET jika diperlukan
function doGet() {
  return ContentService.createTextOutput("Server signaling WebRTC P2P Chat aktif.");
}
