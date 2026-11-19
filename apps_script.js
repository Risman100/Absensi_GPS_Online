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
    "Alamat Lengkap", "Foto Wajah (Base64)", "Role", "Departemen", "Posisi"
  ]);

  createOrUpdate("Cuti", [
    "ID Request", "ID Karyawan", "Nama", "Departemen", "Tipe Cuti", 
    "Tanggal Mulai", "Tanggal Selesai", "Alasan", "Status", "Waktu Pengajuan", "Penyetuju", "Alasan Ditolak"
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
      if (base64String.indexOf('http') === 0) return base64String; // already a URL
      try {
        var base64Data = base64String.split(",")[1] || base64String;
        var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), "image/jpeg", fileName + ".jpg");
        var folder = DriveApp.getFolderById(FOLDER_ID);
        var file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        return file.getUrl(); 
      } catch(err) {
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
            avatar: data[i][6],
            role: data[i][7] || 'employee',
            department: data[i][8] || 'Umum',
            position: data[i][9] || 'Staff'
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
    // 1. ABSENSI (WRITE & READ)
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
        if (data[i][0] === payload.data.id && data[i][1] === payload.data.date) {
          foundRow = i + 1;
          break;
        }
      }
      
      if (foundRow > -1) {
        var photoOutUrl = payload.data.photoOut ? saveImageToDrive(payload.data.photoOut, "Out_" + payload.data.employeeName + "_" + payload.data.date) : "";
        ws.getRange(foundRow, 7).setValue(payload.data.clockOutTime || "");
        ws.getRange(foundRow, 8).setValue(payload.data.clockOutAddress || "");
        if (photoOutUrl) ws.getRange(foundRow, 9).setValue(photoOutUrl); 
      } else {
        var photoInUrl = payload.data.photoIn ? saveImageToDrive(payload.data.photoIn, "In_" + payload.data.employeeName + "_" + payload.data.date) : "";
        ws.appendRow([
          payload.data.id,
          payload.data.date,
          payload.data.employeeName,
          payload.data.clockInTime || "",
          payload.data.clockInAddress || "",
          payload.data.clockInStatus || "",
          "", "", "",
          photoInUrl, 
          payload.data.notes || ""
        ]);
      }
      return ContentService.createTextOutput("Success: Data Absensi Tersimpan");
    }

    if (payload.action === 'getRecords') {
      var ws = sheet.getSheetByName("Absensi");
      var results = [];
      if (ws) {
        var data = ws.getDataRange().getValues();
        for (var i = 1; i < data.length; i++) {
          if (!payload.data || !payload.data.userId || data[i][0] === payload.data.userId) {
            results.push({
              id: data[i][0] + "_" + data[i][1], // idKaryawan_tanggal
              userId: data[i][0],
              date: data[i][1],
              employeeName: data[i][2],
              clockInTime: data[i][3],
              clockInAddress: data[i][4],
              clockInStatus: data[i][5],
              clockOutTime: data[i][6],
              clockOutAddress: data[i][7],
              photoOutUrl: data[i][8],
              photoInUrl: data[i][9],
              notes: data[i][10]
            });
          }
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ records: results })).setMimeType(ContentService.MimeType.JSON);
    }

    // ============================================
    // 2. KARYAWAN (WRITE & READ)
    // ============================================
    if (payload.action === 'onboarding') {
      var ws = getOrCreateSheet("Data Karyawan", [
        "ID Karyawan", "Nama", "Email", "Password", "No Handphone", 
        "Alamat Lengkap", "Foto Wajah (Base64)", "Role", "Departemen", "Posisi"
      ]);
      
      var data = ws.getDataRange().getValues();
      var foundRow = -1;
      
      for (var i = 1; i < data.length; i++) {
        if (data[i][0] === payload.data.id || (payload.data.email && data[i][2] === payload.data.email)) {
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
        if (payload.data.role) ws.getRange(foundRow, 8).setValue(payload.data.role);
        if (payload.data.department) ws.getRange(foundRow, 9).setValue(payload.data.department);
        if (payload.data.position) ws.getRange(foundRow, 10).setValue(payload.data.position);
      } else {
        var newAvatarUrl = payload.data.photoBase64 ? saveImageToDrive(payload.data.photoBase64, "Profile_" + (payload.data.employeeName || payload.data.id)) : "";
        ws.appendRow([
          payload.data.id,
          payload.data.employeeName || "",
          payload.data.email || "",
          payload.data.password || "",
          payload.data.phone || "",
          payload.data.address || "",
          newAvatarUrl,
          payload.data.role || "employee",
          payload.data.department || "Umum",
          payload.data.position || "Staff"
        ]);
      }
      return ContentService.createTextOutput("Success: Data Karyawan Tersimpan");
    }

    if (payload.action === 'getUsers') {
      var ws = sheet.getSheetByName("Data Karyawan");
      var results = [];
      if (ws) {
        var data = ws.getDataRange().getValues();
        for (var i = 1; i < data.length; i++) {
          results.push({
            id: data[i][0],
            name: data[i][1],
            email: data[i][2],
            phone: data[i][4],
            address: data[i][5],
            avatar: data[i][6],
            role: data[i][7] || 'employee',
            department: data[i][8] || 'Umum',
            position: data[i][9] || 'Staff'
          });
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ users: results })).setMimeType(ContentService.MimeType.JSON);
    }

    if (payload.action === 'deleteUser') {
      var ws = sheet.getSheetByName("Data Karyawan");
      if (ws) {
        var data = ws.getDataRange().getValues();
        for (var i = 1; i < data.length; i++) {
          if (data[i][0] === payload.data.id) {
            ws.deleteRow(i + 1);
            return ContentService.createTextOutput("Success: Karyawan berhasil dihapus");
          }
        }
      }
      return ContentService.createTextOutput("Error: Karyawan tidak ditemukan");
    }

    // ============================================
    // 3. CUTI (WRITE & READ & UPDATE STATUS)
    // ============================================
    if (payload.action === 'cuti') {
      var ws = getOrCreateSheet("Cuti", [
        "ID Request", "ID Karyawan", "Nama", "Departemen", "Tipe Cuti", 
        "Tanggal Mulai", "Tanggal Selesai", "Alasan", "Status", "Waktu Pengajuan", "Penyetuju", "Alasan Ditolak"
      ]);
      
      ws.appendRow([
        payload.data.id,
        payload.data.userId || "",
        payload.data.employeeName,
        payload.data.department,
        payload.data.type,
        payload.data.startDate,
        payload.data.endDate,
        payload.data.reason,
        payload.data.status || 'Pending',
        payload.data.submittedAt,
        "", "" // Penyetuju, Alasan Ditolak
      ]);
      return ContentService.createTextOutput("Success: Data Cuti Tersimpan");
    }

    if (payload.action === 'getLeaves') {
      var ws = sheet.getSheetByName("Cuti");
      var results = [];
      if (ws) {
        var data = ws.getDataRange().getValues();
        for (var i = 1; i < data.length; i++) {
          if (!payload.data || !payload.data.userId || data[i][1] === payload.data.userId) {
            results.push({
              id: data[i][0],
              employeeId: data[i][1], // ID Karyawan added at column 1
              employeeName: data[i][2],
              department: data[i][3],
              type: data[i][4],
              startDate: data[i][5],
              endDate: data[i][6],
              reason: data[i][7],
              status: data[i][8],
              submittedAt: data[i][9],
              approvedBy: data[i][10],
              rejectedReason: data[i][11]
            });
          }
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ leaves: results })).setMimeType(ContentService.MimeType.JSON);
    }

    if (payload.action === 'updateLeaveStatus') {
      var ws = sheet.getSheetByName("Cuti");
      if (ws) {
        var data = ws.getDataRange().getValues();
        for (var i = 1; i < data.length; i++) {
          if (data[i][0] === payload.data.id) {
            ws.getRange(i + 1, 9).setValue(payload.data.status); // Status
            if (payload.data.approverName) ws.getRange(i + 1, 11).setValue(payload.data.approverName); // Penyetuju
            if (payload.data.rejectedReason) ws.getRange(i + 1, 12).setValue(payload.data.rejectedReason); // Alasan ditolak
            return ContentService.createTextOutput("Success: Status Cuti Diperbarui");
          }
        }
      }
      return ContentService.createTextOutput("Error: Pengajuan Cuti tidak ditemukan");
    }
    
    return ContentService.createTextOutput("Error: Action tidak dikenali");
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ error: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}
