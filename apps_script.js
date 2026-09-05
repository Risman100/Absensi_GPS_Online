// ============================================
// KONFIGURASI FOLDER GOOGLE DRIVE
// Ganti dengan ID Folder Google Drive Anda tempat menyimpan foto
// ============================================
var FOLDER_ID = "MASUKKAN_ID_FOLDER_DISINI";

// ============================================
// JALANKAN FUNGSI INI SEKALI UNTUK MEMBUAT KOLOM OTOMATIS
// Pilih fungsi "setup" di menu atas lalu klik tombol "Run" / "Jalankan"
// ============================================
function setup() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet();
  
  function createOrUpdate(sheetName, headers) {
    var ws = sheet.getSheetByName(sheetName);
    if (!ws) {
      ws = sheet.insertSheet(sheetName);
    }
    if (ws.getLastRow() === 0) {
      ws.appendRow(headers);
      ws.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#f3f4f6");
    }
  }

  createOrUpdate("Absensi", [
    "ID Karyawan", "Tanggal", "Nama", "Jam Masuk", "Lokasi Masuk", 
    "Status Masuk", "Jam Keluar", "Lokasi Keluar", "Foto Keluar", 
    "Foto Masuk", "Catatan"
  ]);

  createOrUpdate("Data Karyawan", [
    "ID Karyawan", "Nama", "Email", "Password", "No Handphone", 
    "Alamat Lengkap", "Foto Wajah (Base64)"
  ]);

  createOrUpdate("Cuti", [
    "ID Request", "Nama", "Departemen", "Tipe Cuti", 
    "Tanggal Mulai", "Tanggal Selesai", "Alasan", "Status", "Waktu Pengajuan"
  ]);
}

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet();
    var payload = JSON.parse(e.postData.contents);
    
    // Helper function to get or create sheet with headers
    function getOrCreateSheet(sheetName, headers) {
      var ws = sheet.getSheetByName(sheetName);
      if (!ws) {
        ws = sheet.insertSheet(sheetName);
        ws.appendRow(headers);
        ws.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#f3f4f6");
      } else if (ws.getLastRow() === 0) {
        ws.appendRow(headers);
        ws.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#f3f4f6");
      }
      return ws;
    }
    
    // Helper function to save image to Google Drive
    function saveImageToDrive(base64String, fileName) {
      if (!base64String || base64String.trim() === "") return "";
      try {
        var base64Data = base64String.split(",")[1] || base64String;
        var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), "image/jpeg", fileName + ".jpg");
        var folder = DriveApp.getFolderById(FOLDER_ID);
        var file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        return file.getUrl(); 
      } catch(e) {
        return "Error saving image";
      }
    }

    // ============================================
    // GET USER DATA
    // ============================================
    if (payload.action === 'getUser') {
      var ws = sheet.getSheetByName("Data Karyawan");
      if (!ws) {
        return ContentService.createTextOutput(JSON.stringify({ found: false })).setMimeType(ContentService.MimeType.JSON);
      }
      
      var data = ws.getDataRange().getValues();
      var user = null;
      
      for (var i = 1; i < data.length; i++) {
        if (data[i][0] === payload.data.id || (payload.data.email && data[i][2] === payload.data.email)) {
          user = {
            id: data[i][0],
            name: data[i][1],
            email: data[i][2],
            phone: data[i][4],
            address: data[i][5],
            avatar: data[i][6]
          };
          break;
        }
      }
      
      return ContentService.createTextOutput(JSON.stringify({ 
        found: user !== null, 
        user: user 
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // ============================================
    // 1. ABSENSI
    // ============================================
    if (payload.action === 'absen') {
      var ws = getOrCreateSheet("Absensi", [
        "ID Karyawan", "Tanggal", "Nama", "Jam Masuk", "Lokasi Masuk", 
        "Status Masuk", "Jam Keluar", "Lokasi Keluar", "Foto Keluar", 
        "Foto Masuk", "Catatan"
      ]);
      
      var data = ws.getDataRange().getValues();
      var foundRow = -1;
      
      for (var i = 1; i < data.length; i++) {
        // Cari ID Karyawan & Tanggal (Kombinasi agar bisa Update Absen Keluar)
        if (data[i][0] === payload.data.id && data[i][1] === payload.data.date) {
          foundRow = i + 1;
          break;
        }
      }
      
      if (foundRow > -1) {
        // UPDATE (Absen Keluar)
        var photoOutUrl = payload.data.photoOut ? saveImageToDrive(payload.data.photoOut, "Out_" + payload.data.employeeName + "_" + payload.data.date) : "";
        ws.getRange(foundRow, 7).setValue(payload.data.clockOutTime || "");
        ws.getRange(foundRow, 8).setValue(payload.data.clockOutAddress || "");
        if (photoOutUrl) ws.getRange(foundRow, 9).setValue(photoOutUrl); 
      } else {
        // INSERT BARU (Absen Masuk)
        var photoInUrl = payload.data.photoIn ? saveImageToDrive(payload.data.photoIn, "In_" + payload.data.employeeName + "_" + payload.data.date) : "";
        ws.appendRow([
          payload.data.id,
          payload.data.date,
          payload.data.employeeName,
          payload.data.clockInTime || "",
          payload.data.clockInAddress || "",
          payload.data.clockInStatus || "",
          "", // ClockOutTime
          "", // ClockOutAddress
          "", // PhotoOut
          photoInUrl, 
          payload.data.notes || ""
        ]);
      }
      return ContentService.createTextOutput("Success: Data Absensi Tersimpan");
    }

    // ============================================
    // 2. KARYAWAN / ONBOARDING / REGISTER
    // ============================================
    if (payload.action === 'onboarding') {
      var ws = getOrCreateSheet("Data Karyawan", [
        "ID Karyawan", "Nama", "Email", "Password", "No Handphone", 
        "Alamat Lengkap", "Foto Wajah (Base64)"
      ]);
      
      var data = ws.getDataRange().getValues();
      var foundRow = -1;
      
      for (var i = 1; i < data.length; i++) {
        if (data[i][0] === payload.data.id) {
          foundRow = i + 1;
          break;
        }
      }

      if (foundRow > -1) {
        if (payload.data.employeeName) ws.getRange(foundRow, 2).setValue(payload.data.employeeName);
        if (payload.data.email) ws.getRange(foundRow, 3).setValue(payload.data.email);
        if (payload.data.password) ws.getRange(foundRow, 4).setValue(payload.data.password);
        if (payload.data.phone) ws.getRange(foundRow, 5).setValue(payload.data.phone);
        if (payload.data.address) ws.getRange(foundRow, 6).setValue(payload.data.address);
        if (payload.data.photoBase64) {
          var avatarUrl = saveImageToDrive(payload.data.photoBase64, "Profile_" + (payload.data.employeeName || payload.data.id));
          ws.getRange(foundRow, 7).setValue(avatarUrl);
        }
      } else {
        var newAvatarUrl = payload.data.photoBase64 ? saveImageToDrive(payload.data.photoBase64, "Profile_" + (payload.data.employeeName || payload.data.id)) : "";
        ws.appendRow([
          payload.data.id,
          payload.data.employeeName || "",
          payload.data.email || "",
          payload.data.password || "",
          payload.data.phone || "",
          payload.data.address || "",
          newAvatarUrl
        ]);
      }
      return ContentService.createTextOutput("Success: Data Karyawan Tersimpan");
    }

    // ============================================
    // 3. CUTI
    // ============================================
    if (payload.action === 'cuti') {
      var ws = getOrCreateSheet("Cuti", [
        "ID Request", "Nama", "Departemen", "Tipe Cuti", 
        "Tanggal Mulai", "Tanggal Selesai", "Alasan", "Status", "Waktu Pengajuan"
      ]);
      
      ws.appendRow([
        payload.data.id,
        payload.data.employeeName,
        payload.data.department,
        payload.data.type,
        payload.data.startDate,
        payload.data.endDate,
        payload.data.reason,
        payload.data.status,
        payload.data.submittedAt
      ]);
      return ContentService.createTextOutput("Success: Data Cuti Tersimpan");
    }
    
    return ContentService.createTextOutput("Error: Action tidak dikenali");
  } catch (error) {
    return ContentService.createTextOutput("Error: " + error.toString());
  }
}
