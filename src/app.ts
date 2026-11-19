import type { AppConfig, AttendanceRecord, Employee, DashboardStats, GpsCoordinates } from './types';
import {
  loadRecords, saveRecords, backupToGoogleSheets, getUserFromGoogleSheets, loadEmployee, saveEmployee,
  loadConfig, saveConfig,
  getCurrentPosition, reverseGeocode, calculateDistance,
  getISODate, getAttendanceStatus, generateId,
  formatTime, formatDate, minutesToDuration, exportToCSV, parseTimeToMinutes,
} from './utils';
import {
  showToast, setGpsStatus, updateClock, renderEmployee,
  setAttendanceButtonState, renderTodayStatus, renderStats,
  renderHistoryTable, renderGpsInfo, renderDistanceInfo,
  populateSettingsForm, getSettingsFormValues, setActiveTab, getTodayRecord,
} from './ui';
import {
  initMap, updateUserPosition, addAttendanceMarker,
  clearAttendanceMarkers, updateOfficeLocation, resizeMap,
  focusMapMarker,
} from './map';
import { getCurrentSession, getUsers } from './auth';
import {
  loadLeaveRequests, submitLeaveRequest, deleteLeaveRequest,
  loadOvertimeRequests, submitOvertimeRequest,
  getLeaveBalance,
  leaveTypeLabel, leaveTypeBadgeClass, statusBadgeClass, statusLabel,
} from './leave';
import { CameraService } from './camera';
import L from 'leaflet';
import { seedDefaultAnnouncements, getAnnouncementsForRole, relativeDate } from './announcement';
declare const faceapi: any;
// ─── State ────────────────────────────────────────────────────────────────────
let records: AttendanceRecord[] = [];
let employee: Employee;
let config: AppConfig;
let currentGps: GpsCoordinates | null = null;
let currentLeaveTab = 'leave'; // 'leave' | 'overtime' | 'correction'

// ─── Init ─────────────────────────────────────────────────────────────────────
export async function initApp(): Promise<void> {
  const session = getCurrentSession();
  
  if (session) {
    try {
      records = await loadRecords(session.userId);
    } catch (e) {
      console.error("Gagal memuat absensi", e);
    }
  } else {
    records = [];
  }

  try {
    console.log("[FaceAPI] Memuat model...");
    await faceapi.nets.tinyFaceDetector.loadFromUri('https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/');
    console.log("[FaceAPI] Model berhasil dimuat.");
  } catch (err) {
    console.error("[FaceAPI] Gagal memuat model:", err);
  }

  // Sync employee with current active session
  if (session) {
    employee = {
      id: session.userId, // Use Firebase UID instead of defaulting to EMP001
      name: session.name,
      position: 'Staff',
      department: 'Umum',
      phone: session.phone || '',
      address: session.address || '',
      avatar: session.avatar || ''
    };

    const users = await getUsers();
    const activeUser = users.find(u => (u.email || "").toLowerCase() === (session.email || "").toLowerCase());
    if (activeUser) {
      employee.position = activeUser.position || 'Staff';
      employee.department = activeUser.department || 'Umum';
    }

    // Tanya ke Google Sheets sebagai Source of Truth
    try {
      const btnLabel = document.getElementById('hero-greeting');
      if (btnLabel) btnLabel.textContent = `Menyinkronkan data...`;
      
      const sheetUser = await getUserFromGoogleSheets(session.userId, session.email);
      if (sheetUser) {
        // Timpa data lokal dengan data asli dari Google Sheets
        employee.phone = sheetUser.phone || employee.phone;
        employee.address = sheetUser.address || employee.address;
        employee.avatar = sheetUser.avatar || employee.avatar;

        // Update session lokal agar aplikasi tetap cepat
        session.phone = employee.phone;
        session.address = employee.address;
        session.avatar = employee.avatar;
        sessionStorage.setItem('absensi_session', JSON.stringify(session));

        // We no longer update Mock DB locally because saveUsers is removed.
      }
    } catch (err) {
      console.warn("Gagal mengambil data dari server Google Sheets", err);
    }
  } else {
    employee = loadEmployee();
  }

  config = loadConfig();
  seedDefaultAnnouncements();

  renderEmployee(employee);

  const heroGreeting = document.getElementById('hero-greeting');
  if (heroGreeting) heroGreeting.textContent = `Halo, ${employee.name}!`;

  updateDashboard();
  startClock();
  setupEventListeners();

  // ── Profile Completion + Face Verification Gate ──
  if (!isProfileComplete()) {
    // Dashboard dikunci sampai data diri + foto wajah lengkap & terverifikasi
    const overlay = document.getElementById('profile-gate-overlay');
    if (overlay) overlay.style.display = 'block';
    showOnboardingModal();
    return; // Jangan inisialisasi GPS/map sampai gate lolos
  }

  requestFaceGate(() => {
    // Dashboard dibuka setelah verifikasi wajah sukses
    initMap('map-container', config.officeLocation);
    startGpsWatch();
    const today = getTodayRecord(records);
    if (today?.clockIn) addAttendanceMarker(today.clockIn.gps, 'in', `Clock In ${formatTime(new Date(today.clockIn.time))}`);
    if (today?.clockOut) addAttendanceMarker(today.clockOut.gps, 'out', `Clock Out ${formatTime(new Date(today.clockOut.time))}`);
    updateButtonState();
    renderHomeAnnouncements();
  });
}

/** Dipanggil setelah gate lolos untuk menghilangkan overlay pemblokir */
function releaseDashboardGate(): void {
  const overlay = document.getElementById('profile-gate-overlay');
  if (overlay) overlay.style.display = 'none';
}

// ─── Onboarding ──────────────────────────────────────────────────────────────
let onboardCamera: CameraService | null = null;
let onboardBase64: string = '';

/** Apakah data diri wajib sudah lengkap (telepon + alamat + foto wajah valid) */
function isProfileComplete(): boolean {
  const saved = localStorage.getItem('absensi_onboard_photo');
  return !!(employee.phone && employee.address && employee.avatar
    && employee.avatar !== '[Tersimpan di Drive]'
    && saved && saved.length > 100);
}

function showOnboardingModal() {
  const modal = document.getElementById('onboarding-modal');
  if (modal) modal.style.display = 'flex';
  
  const btnCamera = document.getElementById('btn-onboard-camera');
  const preview = document.getElementById('onboard-photo-preview') as HTMLImageElement;
  const form = document.getElementById('onboarding-form') as HTMLFormElement;
  const btnSubmit = document.getElementById('btn-submit-onboard') as HTMLButtonElement;
  const errEl = document.getElementById('onboard-error') as HTMLElement;

  if (errEl) errEl.style.display = 'none';

  // Restore saved photo if it exists from a previous session
  const savedPhoto = localStorage.getItem('absensi_onboard_photo');
  if (savedPhoto) {
    onboardBase64 = savedPhoto;
    preview.src = savedPhoto;
    preview.style.display = 'block';
    btnSubmit.disabled = false;
    if (btnCamera) {
      btnCamera.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><polyline points="23 20 23 14 17 14"></polyline><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"></path></svg>
        <span style="font-size:13px; font-weight:500;">Foto Ulang</span>
      `;
      btnCamera.style.height = 'auto';
      btnCamera.style.padding = '12px';
    }
  } else {
    btnSubmit.disabled = true;
    preview.style.display = 'none';
  }
  
  btnCamera?.addEventListener('click', async () => {
    if (!onboardCamera) onboardCamera = new CameraService('camera-video');
    const camModal = document.getElementById('camera-modal');
    if (camModal) {
      camModal.setAttribute('data-flow', 'onboarding');
      camModal.style.display = 'flex';
    }
    try {
      await onboardCamera.start();
    } catch (err: any) {
      showToast(err.message, 'error');
      if (camModal) camModal.style.display = 'none';
    }
  });
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = (document.getElementById('onboard-phone') as HTMLInputElement).value.trim();
    const address = (document.getElementById('onboard-address') as HTMLTextAreaElement).value.trim();

    if (errEl) errEl.style.display = 'none';
    const fail = (msg: string) => { if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; } };

    if (!phone || !address) { fail('Lengkapi Nomor Telepon dan Alamat Lengkap terlebih dahulu.'); return; }
    if (!onboardBase64 || onboardBase64.length < 100) { fail('Foto Wajah wajib diambil sebelum data dapat disimpan.'); return; }
    
    employee.phone = phone;
    employee.address = address;
    employee.avatar = "[Tersimpan di Drive]";
    saveEmployee(employee);
    localStorage.setItem('absensi_onboard_photo', onboardBase64);
    
    const session = getCurrentSession();
    if (session) {
      session.phone = phone;
      session.address = address;
      session.avatar = "[Tersimpan di Drive]";
      sessionStorage.setItem('absensi_session', JSON.stringify(session));
    }
    
    // Backup onboarding to Google Sheets
    backupToGoogleSheets('onboarding', {
      id: employee.id,
      employeeName: employee.name,
      phone,
      address,
      photoBase64: onboardBase64
    });
    
    if (modal) modal.style.display = 'none';
    showToast('Data diri berhasil disimpan!', 'success');
    // Lanjut ke verifikasi wajah sebelum dashboard dibuka
    requestFaceGate(() => {
      initMap('map-container', config.officeLocation);
      startGpsWatch();
      renderHomeAnnouncements();
      releaseDashboardGate();
    });
  });
}

// ─── Face Verification Gate (setelah login / lengkapi data diri) ─────────────────────
let verifyCamera: CameraService | null = null;
let verifyCallback: (() => void) | null = null;

/**
 * Gate wajah: tampilkan overlay + modal verifikasi.
 * Dashboard baru boleh diakses setelah callback dipanggil (verifikasi sukses).
 */
function requestFaceGate(onSuccess: () => void): void {
  verifyCallback = onSuccess;
  const overlay = document.getElementById('profile-gate-overlay');
  const verifyModal = document.getElementById('verify-modal');
  const preview = document.getElementById('verify-photo-preview') as HTMLImageElement;
  const status = document.getElementById('verify-status-text');
  const btn = document.getElementById('btn-start-verify') as HTMLButtonElement;

  if (preview) { preview.src = ''; preview.style.display = 'none'; }
  if (status) status.textContent = 'Siap untuk memindai wajah.';
  if (btn) { btn.disabled = false; btn.style.display = ''; btn.textContent = 'Mulai Verifikasi Wajah'; }
  if (overlay) overlay.style.display = 'block';
  if (verifyModal) verifyModal.style.display = 'flex';
}

function grantDashboardAccess(): void {
  const overlay = document.getElementById('profile-gate-overlay');
  const verifyModal = document.getElementById('verify-modal');
  if (overlay) overlay.style.display = 'none';
  if (verifyModal) verifyModal.style.display = 'none';
  verifyCamera?.stop();
  verifyCamera = null;
  showToast('✅ Verifikasi wajah berhasil. Selamat bekerja!', 'success');
  verifyCallback?.();
  verifyCallback = null;
  releaseDashboardGate();
}

document.getElementById('btn-start-verify')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-start-verify') as HTMLButtonElement;
  const camModal = document.getElementById('camera-modal');

  if (!verifyCamera) verifyCamera = new CameraService('camera-video');
  btn.disabled = true;
  btn.textContent = 'Memproses...';
  if (camModal) {
    camModal.setAttribute('data-flow', 'verify');
    camModal.style.display = 'flex';
  }
  try {
    await verifyCamera.start();
  } catch (err: any) {
    showToast(err.message, 'error');
    if (camModal) camModal.style.display = 'none';
    btn.disabled = false;
    btn.textContent = 'Coba Lagi';
  }
});

// ─── Clock ────────────────────────────────────────────────────────────────────
function startClock(): void {
  const tick = () => updateClock(formatTime(), formatDate());
  tick();
  window.setInterval(tick, 1000);
}

// ─── GPS Watch ────────────────────────────────────────────────────────────────
function startGpsWatch(): void {
  setGpsStatus('loading', 'Mendapatkan lokasi GPS...');

  if (!navigator.geolocation) {
    setGpsStatus('error', 'GPS tidak didukung');
    return;
  }

  navigator.geolocation.watchPosition(
    (pos) => {
      currentGps = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        altitude: pos.coords.altitude,
        timestamp: pos.timestamp,
      };
      setGpsStatus('success', 'GPS Aktif', currentGps.accuracy);
      updateUserPosition(currentGps);
      renderGpsInfo(currentGps.latitude, currentGps.longitude, currentGps.accuracy, currentGps.altitude);

      const dist = calculateDistance(
        currentGps.latitude, currentGps.longitude,
        config.officeLocation.latitude, config.officeLocation.longitude,
      );
      renderDistanceInfo(dist, config.officeLocation.radius);
    },
    (err) => setGpsStatus('error', 'GPS Error: ' + err.message),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
  );
}

// ─── Dashboard Update ─────────────────────────────────────────────────────────
function updateDashboard(): void {
  const today = getTodayRecord(records);
  renderTodayStatus(today);

  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthRecords = records.filter(r => r.date.startsWith(thisMonth));

  const stats: DashboardStats = {
    totalPresent: monthRecords.filter(r => r.clockIn).length,
    totalOnTime: monthRecords.filter(r => r.clockIn?.status === 'on-time').length,
    totalLate: monthRecords.filter(r => r.clockIn?.status === 'late').length,
    totalAbsent: 0,
    currentMonth: now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }),
    averageClockIn: '—',
  };
  renderStats(stats);
  renderHistoryTable(records);
}

// ─── Button State ─────────────────────────────────────────────────────────────
function updateButtonState(): void {
  const today = getTodayRecord(records);
  setAttendanceButtonState(!!today?.clockIn, !!today?.clockOut, false);
}

// ─── Attendance Flow (Selfie + Preview) ───────────────────────────────────────
let attCamera: CameraService | null = null;
let previewMap: L.Map | null = null;
let currentPhotoBase64 = '';
let attendanceType: 'in' | 'out' = 'in';

async function startAttendanceFlow(type: 'in' | 'out') {
  attendanceType = type;
  if (!attCamera) {
    attCamera = new CameraService('camera-video');
  }
  const camModal = document.getElementById('camera-modal');
  if (camModal) camModal.style.display = 'flex';
  try {
    await attCamera.start();
  } catch(e:any) {
    showToast(e.message, 'error');
    if (camModal) camModal.style.display = 'none';
  }
}

document.getElementById('btn-capture')?.addEventListener('click', async () => {
  const camModal = document.getElementById('camera-modal');
  if (camModal?.style.display === 'none' || !camModal) return;

  const flow = camModal?.getAttribute('data-flow');
  
  // ── Flow: Verifikasi Wajah ──
  if (flow === 'verify') {
    if (!verifyCamera) return;
    const photo = verifyCamera.captureBase64(320);
    verifyCamera.stop();
    camModal.style.display = 'none';
    camModal.removeAttribute('data-flow');

    const status = document.getElementById('verify-status-text');
    const btn = document.getElementById('btn-start-verify') as HTMLButtonElement;
    const preview = document.getElementById('verify-photo-preview') as HTMLImageElement;
    preview.src = photo;
    preview.style.display = 'block';

    try {
      if (status) status.textContent = 'Memvalidasi wajah...';
      const tempImg = new Image();
      tempImg.src = photo;
      await new Promise((r) => { tempImg.onload = r; });
      const detections = await faceapi.detectAllFaces(tempImg, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.15, inputSize: 320 }));
      if (detections.length === 0) {
        if (status) status.innerHTML = '<span style="color:var(--rose-500)">❌ Wajah tidak terdeteksi. Coba lagi dengan pencahayaan lebih baik.</span>';
        btn.disabled = false;
        btn.textContent = 'Coba Lagi';
        return;
      }
      if (status) status.innerHTML = '<span style="color:var(--emerald-500)">✅ Verifikasi berhasil!</span>';
      setTimeout(grantDashboardAccess, 800);
    } catch (err: any) {
      if (status) status.textContent = 'Error: ' + err.message;
      btn.disabled = false;
      btn.textContent = 'Coba Lagi';
    }
    return;
  }

  // ── Flow: Onboarding Foto Wajah ──
  if (flow === 'onboarding') {
    if (!onboardCamera) return;
    onboardBase64 = onboardCamera.captureBase64(320);
    onboardCamera.stop();
    camModal.style.display = 'none';
    camModal.removeAttribute('data-flow');

    const preview = document.getElementById('onboard-photo-preview') as HTMLImageElement;
    const btnSubmit = document.getElementById('btn-submit-onboard') as HTMLButtonElement;
    const btnCamera = document.getElementById('btn-onboard-camera');
    preview.src = onboardBase64;
    preview.style.display = 'block';
    btnSubmit.disabled = false;
    const errEl = document.getElementById('onboard-error');
    if (errEl) errEl.style.display = 'none';

    if (btnCamera) {
      btnCamera.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><polyline points="23 20 23 14 17 14"></polyline><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"></path></svg>
        <span style="font-size:13px; font-weight:500;">Foto Ulang</span>
      `;
      btnCamera.style.height = 'auto';
      btnCamera.style.padding = '12px';
    }
    return;
  }

  if (!attCamera) return;
  if (document.getElementById('onboarding-modal')?.style.display === 'flex') return;

  currentPhotoBase64 = attCamera.captureBase64(320);
  attCamera.stop();
  if (camModal) {
    camModal.style.display = 'none';
    camModal.removeAttribute('data-flow');
  }
  
  if (flow === 'settings') {
    const facePreview = document.getElementById('settings-face-preview');
    if (facePreview) {
      facePreview.innerHTML = `<img src="${currentPhotoBase64}" style="width:100%;height:100%;object-fit:cover" />`;
    }
    showToast('Wajah berhasil dipindai! (Simulasi pendaftaran)', 'success');
    return;
  }
  
  await showPreviewModal();
});

document.getElementById('btn-camera-close')?.addEventListener('click', () => {
  const camModal = document.getElementById('camera-modal');
  const flow = camModal?.getAttribute('data-flow');
  
  if (flow === 'verify') {
    verifyCamera?.stop();
    const btn = document.getElementById('btn-start-verify') as HTMLButtonElement;
    if (btn) { btn.disabled = false; btn.textContent = 'Mulai Verifikasi Wajah'; }
  } else {
    if (attCamera) attCamera.stop();
    onboardCamera?.stop();
  }
  if (camModal) camModal.style.display = 'none';
});

async function showPreviewModal() {
  const modal = document.getElementById('preview-modal');
  if (modal) modal.style.display = 'flex';
  
  const img = document.getElementById('preview-image') as HTMLImageElement;
  img.src = currentPhotoBase64;
  
  const statusText = document.getElementById('preview-status-text');
  if (statusText) statusText.innerHTML = 'Mendapatkan lokasi GPS... <div class="spinner" style="display:inline-block;width:12px;height:12px;"></div>';
  
  const btnSubmit = document.getElementById('btn-submit-absen') as HTMLButtonElement;
  btnSubmit.disabled = true;

  try {
    if (statusText) statusText.innerHTML = 'Memvalidasi wajah... <div class="spinner" style="display:inline-block;width:12px;height:12px;"></div>';
    
    const tempImg = new Image();
    tempImg.src = currentPhotoBase64;
    await new Promise((resolve) => { tempImg.onload = resolve; });
    
    const detections = await faceapi.detectAllFaces(tempImg, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.15, inputSize: 320 }));
    if (detections.length === 0) {
      if (statusText) statusText.innerHTML = `<span style="color:var(--rose-500)">❌ Validasi Wajah Gagal: Wajah tidak terdeteksi. Tolong buka kacamata atau apapun yang menutupi wajah Anda.</span>`;
      return; 
    }

    if (statusText) statusText.innerHTML = 'Mendapatkan lokasi GPS... <div class="spinner" style="display:inline-block;width:12px;height:12px;"></div>';

    const gps = await getCurrentPosition();
    currentGps = gps;
    const dist = calculateDistance(gps.latitude, gps.longitude, config.officeLocation.latitude, config.officeLocation.longitude);
    
    // Render Mini Map
    const mapContainer = document.getElementById('preview-map-container');
    if (mapContainer) {
      if (!previewMap) {
        previewMap = L.map('preview-map-container', { zoomControl: false, attributionControl: false });
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=cb1_2y3t_1_c2ac00cfdabbebeac1836a5b').addTo(previewMap);
      }
      previewMap.setView([gps.latitude, gps.longitude], 16);
      previewMap.eachLayer((layer) => {
        if (layer instanceof L.Marker || layer instanceof L.Circle) {
          previewMap?.removeLayer(layer);
        }
      });
      L.circle([config.officeLocation.latitude, config.officeLocation.longitude], {
        radius: config.officeLocation.radius, color: '#4f8ef7', fillColor: '#4f8ef7', fillOpacity: 0.2
      }).addTo(previewMap);
      L.marker([gps.latitude, gps.longitude]).addTo(previewMap);
      setTimeout(() => previewMap?.invalidateSize(), 100);
    }
    
    let isPending = dist > config.officeLocation.radius;
    if (statusText) {
      statusText.innerHTML = isPending 
        ? `<span style="color:var(--amber-500)">⚠️ Anda berada di luar radius kantor (${dist.toFixed(0)}m). Absen akan berstatus PENDING.</span>`
        : `<span style="color:var(--emerald-500)">✅ Lokasi valid (${dist.toFixed(0)}m dari titik pusat).</span>`;
    }
    
    btnSubmit.disabled = false;
  } catch (err: any) {
    if (statusText) statusText.innerHTML = `<span style="color:var(--rose-500)">❌ Error GPS: ${err.message}</span>`;
  }
}

document.getElementById('btn-cancel-absen')?.addEventListener('click', () => {
  const modal = document.getElementById('preview-modal');
  if (modal) modal.style.display = 'none';
});

document.getElementById('btn-retake')?.addEventListener('click', () => {
  const modal = document.getElementById('preview-modal');
  if (modal) modal.style.display = 'none';
  startAttendanceFlow(attendanceType);
});

document.getElementById('btn-submit-absen')?.addEventListener('click', async () => {
  const modal = document.getElementById('preview-modal');
  if (modal) modal.style.display = 'none';
  
  if (attendanceType === 'in') await executeClockIn();
  else await executeClockOut();
});

// ─── Clock In ─────────────────────────────────────────────────────────────────
async function executeClockIn(): Promise<void> {
  setAttendanceButtonState(false, false, true);
  try {
    const gps = currentGps!;
    const address = await reverseGeocode(gps.latitude, gps.longitude);
    const now = new Date();
    const today = getISODate();
    
    const dist = calculateDistance(gps.latitude, gps.longitude, config.officeLocation.latitude, config.officeLocation.longitude);
    const status = getAttendanceStatus(now, config, dist);

    let record = getTodayRecord(records);
    if (!record) {
      record = { id: generateId(), employeeId: employee.id, employeeName: employee.name, date: today };
      records.push(record);
    }
    record.clockIn = { time: now.toISOString(), gps, address, status, photo: "[Tersimpan di Drive]" };

    await saveRecords(records);
    await backupToGoogleSheets('absen', {
      id: record.id,
      employeeName: record.employeeName,
      date: record.date,
      clockInTime: record.clockIn?.time,
      clockInAddress: record.clockIn?.address,
      clockInStatus: record.clockIn?.status,
      photoIn: currentPhotoBase64,
      clockOutTime: record.clockOut?.time,
      clockOutAddress: record.clockOut?.address,
      photoOut: record.clockOut?.photo,
      notes: record.notes
    });
    updateUserPosition(gps);
    addAttendanceMarker(gps, 'in', `Clock In ${formatTime(now)}`);
    renderGpsInfo(gps.latitude, gps.longitude, gps.accuracy, gps.altitude);
    renderDistanceInfo(dist, config.officeLocation.radius);

    updateDashboard();
    updateButtonState();

    const lateMin = Math.round((now.getHours() * 60 + now.getMinutes()) - parseTimeToMinutes(config.workStartTime));
    let msg = '';
    if (status === 'pending') msg = `⚠️ Berada di luar zona. Absen PENDING menunggu persetujuan HR.`;
    else if (status === 'on-time') msg = `✅ Clock In berhasil! Tepat waktu pukul ${formatTime(now)}`;
    else msg = `⚠️ Clock In berhasil. Terlambat ${lateMin} menit`;
    
    showToast(msg, status === 'on-time' ? 'success' : (status === 'pending' ? 'error' : 'info'));
  } catch (err: any) {
    showToast(err.message, 'error');
    updateButtonState();
  }
}

// ─── Clock Out ────────────────────────────────────────────────────────────────
async function executeClockOut(): Promise<void> {
  const today = getTodayRecord(records);
  if (!today?.clockIn) { showToast('Anda belum melakukan Clock In hari ini!', 'error'); return; }

  setAttendanceButtonState(true, false, true);
  try {
    const gps = currentGps!;
    const address = await reverseGeocode(gps.latitude, gps.longitude);
    const now = new Date();

    today.clockOut = { time: now.toISOString(), gps, address, photo: "[Tersimpan di Drive]" };
    today.workDuration = Math.round((now.getTime() - new Date(today.clockIn.time).getTime()) / 60000);

    await saveRecords(records);
    await backupToGoogleSheets('absen', {
      id: today.id,
      employeeName: today.employeeName,
      date: today.date,
      clockInTime: today.clockIn?.time,
      clockInAddress: today.clockIn?.address,
      clockInStatus: today.clockIn?.status,
      photoIn: today.clockIn?.photo,
      clockOutTime: today.clockOut?.time,
      clockOutAddress: today.clockOut?.address,
      photoOut: currentPhotoBase64,
      notes: today.notes
    });
    addAttendanceMarker(gps, 'out', `Clock Out ${formatTime(now)}`);
    updateDashboard();
    updateButtonState();
    showToast(`✅ Clock Out berhasil! Durasi kerja: ${minutesToDuration(today.workDuration)}`, 'success');
  } catch (err: any) {
    showToast(err.message, 'error');
    updateButtonState();
  }
}

// ─── Announcements on Home ────────────────────────────────────────────────────
function renderHomeAnnouncements(): void {
  const container = document.getElementById('emp-announcements');
  if (!container) return;

  const items = getAnnouncementsForRole('employee');
  if (items.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:16px 0">Tidak ada pengumuman terbaru.</p>';
    return;
  }

  container.innerHTML = items.slice(0, 3).map(a => `
    <div class="announcement-card ${a.pinned ? 'announcement-card--pinned' : ''}">
      ${a.pinned ? '<span class="ann-pin-badge">📌 Penting</span>' : ''}
      <div class="ann-title">${a.title}</div>
      <div class="ann-content">${a.content}</div>
      <div class="ann-meta">${a.author} · ${relativeDate(a.createdAt)}</div>
    </div>
  `).join('');
}

// ─── Leave / Pengajuan Panel ──────────────────────────────────────────────────
function renderLeavePanel(): void {
  renderLeaveBalance();
  renderLeaveSubTabs();
  renderLeaveHistory();
}

function renderLeaveBalance(): void {
  const balance = getLeaveBalance(employee.id);
  const remaining = balance.annualTotal - balance.annualUsed;

  const el = document.getElementById('leave-balance-display');
  if (!el) return;
  el.innerHTML = `
    <div class="balance-card balance-card--green">
      <div class="balance-num">${remaining}</div>
      <div class="balance-label">Cuti Tersisa</div>
      <div class="balance-sub">dari ${balance.annualTotal} hari/tahun</div>
    </div>
    <div class="balance-card balance-card--amber">
      <div class="balance-num">${balance.sickUsed}</div>
      <div class="balance-label">Sakit Dipakai</div>
      <div class="balance-sub">hari tahun ini</div>
    </div>
    <div class="balance-card balance-card--blue">
      <div class="balance-num">${balance.izinUsed}</div>
      <div class="balance-label">Izin Dipakai</div>
      <div class="balance-sub">hari tahun ini</div>
    </div>
  `;
}

function renderLeaveSubTabs(): void {
  document.querySelectorAll('.leave-subtab').forEach(btn => {
    const tab = btn.getAttribute('data-leave-tab')!;
    btn.classList.toggle('active', tab === currentLeaveTab);
  });

  const leaveForm = document.getElementById('leave-form-wrapper');
  const overtimeForm = document.getElementById('overtime-form-wrapper');
  const correctionForm = document.getElementById('correction-form-wrapper');

  if (leaveForm) leaveForm.style.display = currentLeaveTab === 'leave' ? 'block' : 'none';
  if (overtimeForm) overtimeForm.style.display = currentLeaveTab === 'overtime' ? 'block' : 'none';
  if (correctionForm) correctionForm.style.display = currentLeaveTab === 'correction' ? 'block' : 'none';
}

function renderLeaveHistory(): void {
  const container = document.getElementById('leave-history-list');
  if (!container) return;

  const leaves = loadLeaveRequests().filter(r => r.employeeId === employee.id);
  const overtimes = loadOvertimeRequests().filter(r => r.employeeId === employee.id);

  // Combine & sort by date
  type Combined = { id: string; kind: 'leave' | 'overtime'; submittedAt: string; html: string };
  const items: Combined[] = [
    ...leaves.map(r => ({
      id: r.id,
      kind: 'leave' as const,
      submittedAt: r.submittedAt,
      html: `
        <div class="request-card" id="req-${r.id}">
          <div class="request-card-header">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <span class="req-badge ${leaveTypeBadgeClass(r.type)}">${leaveTypeLabel(r.type)}</span>
              <span class="req-badge ${statusBadgeClass(r.status)}">${statusLabel(r.status)}</span>
            </div>
            ${r.status === 'pending' ? `<button class="btn-icon-sm btn-icon-delete" data-delete-leave="${r.id}" title="Batalkan">✕</button>` : ''}
          </div>
          <div class="request-card-body">
            ${r.type === 'koreksi'
              ? `<div class="req-info-row"><span>Tanggal Koreksi</span><span>${r.correctionDate ?? r.startDate}</span></div>
                 ${r.correctionClockIn ? `<div class="req-info-row"><span>Clock In Koreksi</span><span>${r.correctionClockIn}</span></div>` : ''}
                 ${r.correctionClockOut ? `<div class="req-info-row"><span>Clock Out Koreksi</span><span>${r.correctionClockOut}</span></div>` : ''}`
              : `<div class="req-info-row"><span>Tanggal</span><span>${r.startDate}${r.endDate !== r.startDate ? ` s.d. ${r.endDate}` : ''} (${r.daysCount} hari)</span></div>`
            }
            <div class="req-info-row"><span>Alasan</span><span>${r.reason}</span></div>
            ${r.rejectedReason ? `<div class="req-info-row req-info-row--reject"><span>Alasan Tolak</span><span>${r.rejectedReason}</span></div>` : ''}
            <div class="req-info-row req-info-row--meta"><span>Diajukan</span><span>${relativeDate(r.submittedAt)}</span></div>
          </div>
        </div>`,
    })),
    ...overtimes.map(r => ({
      id: r.id,
      kind: 'overtime' as const,
      submittedAt: r.submittedAt,
      html: `
        <div class="request-card" id="req-ot-${r.id}">
          <div class="request-card-header">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <span class="req-badge badge-purple">Lembur</span>
              <span class="req-badge ${statusBadgeClass(r.status)}">${statusLabel(r.status)}</span>
            </div>
            ${r.status === 'pending' ? `<button class="btn-icon-sm btn-icon-delete" data-delete-ot="${r.id}" title="Batalkan">✕</button>` : ''}
          </div>
          <div class="request-card-body">
            <div class="req-info-row"><span>Tanggal</span><span>${r.date}</span></div>
            <div class="req-info-row"><span>Jam</span><span>${r.startTime} – ${r.endTime}</span></div>
            <div class="req-info-row"><span>Keperluan</span><span>${r.reason}</span></div>
            ${r.rejectedReason ? `<div class="req-info-row req-info-row--reject"><span>Alasan Tolak</span><span>${r.rejectedReason}</span></div>` : ''}
            <div class="req-info-row req-info-row--meta"><span>Diajukan</span><span>${relativeDate(r.submittedAt)}</span></div>
          </div>
        </div>`,
    })),
  ];

  items.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());

  if (items.length === 0) {
    container.innerHTML = `<div class="history-empty" style="padding:32px 16px">
      <div class="history-empty__icon">📋</div>
      <div class="history-empty__text">Belum ada pengajuan</div>
    </div>`;
    return;
  }

  container.innerHTML = items.map(i => i.html).join('');

  // Attach delete handlers
  container.querySelectorAll('[data-delete-leave]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-delete-leave')!;
      if (!confirm('Batalkan pengajuan ini?')) return;
      deleteLeaveRequest(id);
      renderLeavePanel();
      showToast('Pengajuan dibatalkan', 'info');
    });
  });
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
function setupEventListeners(): void {
  // Tab navigation (sidebar + mobile)
  // Tab navigation: sidebar (.tab-btn) + mobile nav (.nav-item with data-tab)
  document.querySelectorAll('[data-tab]').forEach(btn => {
    // Hanya handle tombol yang ada di dalam #employee-container atau #emp-mobile-nav
    const inEmpShell = btn.closest('#employee-container') || btn.closest('#emp-mobile-nav');
    if (!inEmpShell) return;
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab')!;
      if (!tabId) return;
      setActiveTab(tabId);
      // Sync active state: sidebar buttons
      document.querySelectorAll('#employee-container [data-tab]').forEach(b => b.classList.remove('active'));
      // Sync active state: mobile nav buttons
      document.querySelectorAll('#emp-mobile-nav [data-tab]').forEach(b => b.classList.remove('active'));
      // Set active on matching buttons (both sidebar & mobile)
      document.querySelectorAll(`[data-tab="${tabId}"]`).forEach(b => {
        if (b.closest('#employee-container') || b.closest('#emp-mobile-nav')) b.classList.add('active');
      });
      if (tabId === 'map') setTimeout(resizeMap, 100);
      if (tabId === 'history') renderHistoryTable(records);
      if (tabId === 'settings') populateSettingsForm(config, employee);
      if (tabId === 'leave') renderLeavePanel();
    });
  });

  // Clock In / Out buttons
  document.getElementById('btn-clock-in')?.addEventListener('click', () => startAttendanceFlow('in'));
  document.getElementById('btn-clock-out')?.addEventListener('click', () => startAttendanceFlow('out'));

  // Refresh GPS
  document.getElementById('btn-refresh-gps')?.addEventListener('click', async () => {
    setGpsStatus('loading', 'Memperbarui lokasi...');
    try {
      const gps = await getCurrentPosition();
      currentGps = gps;
      setGpsStatus('success', 'GPS Aktif', gps.accuracy);
      updateUserPosition(gps);
      renderGpsInfo(gps.latitude, gps.longitude, gps.accuracy, gps.altitude);
      const dist = calculateDistance(gps.latitude, gps.longitude, config.officeLocation.latitude, config.officeLocation.longitude);
      renderDistanceInfo(dist, config.officeLocation.radius);
      showToast('Lokasi GPS diperbarui!', 'success');
    } catch (err: any) {
      setGpsStatus('error', err.message);
      showToast(err.message, 'error');
    }
  });

  // Export CSV
  document.getElementById('btn-export')?.addEventListener('click', () => {
    if (records.length === 0) { showToast('Tidak ada data untuk diekspor', 'error'); return; }
    exportToCSV(records);
    showToast('Data berhasil diekspor!', 'success');
  });

  // Legend Interactions
  document.getElementById('legend-user')?.addEventListener('click', () => focusMapMarker('user'));
  document.getElementById('legend-office')?.addEventListener('click', () => focusMapMarker('office'));
  document.getElementById('legend-clockin')?.addEventListener('click', () => focusMapMarker('in'));
  document.getElementById('legend-clockout')?.addEventListener('click', () => focusMapMarker('out'));

  // Clear history
  document.getElementById('btn-clear-history')?.addEventListener('click', () => {
    if (!confirm('Hapus semua riwayat absensi? Tindakan ini tidak dapat dibatalkan.')) return;
    records = [];
    saveRecords(records);
    clearAttendanceMarkers();
    updateDashboard();
    updateButtonState();
    showToast('Riwayat absensi dihapus', 'info');
  });

  // Settings save
  // HR Settings global save
  document.getElementById('btn-save-settings')?.addEventListener('click', () => {
    const { config: newConfig } = getSettingsFormValues();
    config = newConfig;
    saveConfig(config);
    updateOfficeLocation(config.officeLocation);
    showToast('Pengaturan global disimpan!', 'success');
  });

  // Avatar upload
  document.getElementById('setting-emp-avatar')?.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const base64 = evt.target?.result as string;
        employee.avatar = base64; // Temporarily assign to employee
        const avatarPreview = document.getElementById('settings-avatar-preview');
        if (avatarPreview) {
          avatarPreview.innerHTML = `<img src="${base64}" style="width:100%;height:100%;object-fit:cover" />`;
        }
      };
      reader.readAsDataURL(file);
    }
  });

  // Employee Personal Settings save
  document.getElementById('btn-save-personal')?.addEventListener('click', async () => {
    const phone = (document.getElementById('setting-emp-phone') as HTMLInputElement).value;
    const address = (document.getElementById('setting-emp-address') as HTMLTextAreaElement).value;
    employee.phone = phone;
    employee.address = address;
    saveEmployee(employee);
    
    try {
      const { updateUserProfile } = await import('./auth');
      await updateUserProfile({ phone, address, avatar: employee.avatar });
      showToast('Informasi personal disimpan!', 'success');
      renderEmployee(employee); // update UI with new avatar
    } catch (e) {
      console.warn("Could not save to auth profile", e);
      showToast('Tersimpan di perangkat ini', 'success');
    }
  });

  // Employee Password Change
  document.getElementById('btn-change-password')?.addEventListener('click', async () => {
    const oldPass = (document.getElementById('setting-emp-pass-old') as HTMLInputElement).value;
    const newPass = (document.getElementById('setting-emp-pass-new') as HTMLInputElement).value;
    const confPass = (document.getElementById('setting-emp-pass-confirm') as HTMLInputElement).value;
    
    if (!oldPass || !newPass || !confPass) {
      showToast('Lengkapi semua field password', 'error'); return;
    }
    if (newPass !== confPass) {
      showToast('Konfirmasi password tidak cocok', 'error'); return;
    }
    
    try {
      const { updateUserPassword } = await import('./auth');
      await updateUserPassword(oldPass, newPass);
      showToast('Password berhasil diubah', 'success');
      (document.getElementById('setting-emp-pass-old') as HTMLInputElement).value = '';
      (document.getElementById('setting-emp-pass-new') as HTMLInputElement).value = '';
      (document.getElementById('setting-emp-pass-confirm') as HTMLInputElement).value = '';
    } catch (e: any) {
      showToast('Gagal mengubah password: ' + e.message, 'error');
    }
  });

  // Employee Face Register
  document.getElementById('btn-re-register-face')?.addEventListener('click', async () => {
    if (!attCamera) {
      attCamera = new CameraService('camera-video');
    }
    
    const camModal = document.getElementById('camera-modal');
    if (camModal) {
      camModal.setAttribute('data-flow', 'settings');
      camModal.style.display = 'flex';
    }
    try {
      await attCamera.start();
    } catch(e:any) {
      showToast(e.message, 'error');
      if (camModal) camModal.style.display = 'none';
    }
  });

  // ─── Leave Sub-tabs ────────────────────────────────────────────────────────
  document.querySelectorAll('.leave-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      currentLeaveTab = btn.getAttribute('data-leave-tab') ?? 'leave';
      renderLeaveSubTabs();
    });
  });

  // Leave form submit
  document.getElementById('leave-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const type = (document.getElementById('leave-type') as HTMLSelectElement).value as any;
    const startDate = (document.getElementById('leave-start') as HTMLInputElement).value;
    const endDate = (document.getElementById('leave-end') as HTMLInputElement).value;
    const reason = (document.getElementById('leave-reason') as HTMLTextAreaElement).value.trim();

    if (!startDate || !endDate || !reason) { showToast('Lengkapi semua field!', 'error'); return; }
    if (endDate < startDate) { showToast('Tanggal akhir tidak boleh sebelum tanggal mulai!', 'error'); return; }

    // Check cuti balance
    if (type === 'cuti') {
      const { annualTotal, annualUsed } = getLeaveBalance(employee.id);
      const days = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1;
      if (annualUsed + days > annualTotal) {
        showToast(`Saldo cuti tidak cukup! Sisa: ${annualTotal - annualUsed} hari`, 'error');
        return;
      }
    }

    submitLeaveRequest(employee.id, employee.name, employee.department, type, startDate, endDate, reason);
    (document.getElementById('leave-form') as HTMLFormElement).reset();
    renderLeavePanel();
    showToast('✅ Pengajuan berhasil dikirim! Menunggu persetujuan HR.', 'success');
  });

  // Overtime form submit
  document.getElementById('overtime-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const date = (document.getElementById('ot-date') as HTMLInputElement).value;
    const startTime = (document.getElementById('ot-start') as HTMLInputElement).value;
    const endTime = (document.getElementById('ot-end') as HTMLInputElement).value;
    const reason = (document.getElementById('ot-reason') as HTMLTextAreaElement).value.trim();

    if (!date || !startTime || !endTime || !reason) { showToast('Lengkapi semua field!', 'error'); return; }

    submitOvertimeRequest(employee.id, employee.name, employee.department, date, startTime, endTime, reason);
    (document.getElementById('overtime-form') as HTMLFormElement).reset();
    renderLeavePanel();
    showToast('✅ Pengajuan lembur berhasil dikirim!', 'success');
  });

  // Correction form submit
  document.getElementById('correction-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const corrDate = (document.getElementById('corr-date') as HTMLInputElement).value;
    const corrIn = (document.getElementById('corr-clock-in') as HTMLInputElement).value;
    const corrOut = (document.getElementById('corr-clock-out') as HTMLInputElement).value;
    const reason = (document.getElementById('corr-reason') as HTMLTextAreaElement).value.trim();

    if (!corrDate || !reason) { showToast('Lengkapi tanggal dan alasan!', 'error'); return; }

    submitLeaveRequest(
      employee.id, employee.name, employee.department,
      'koreksi', corrDate, corrDate, reason, undefined,
      corrDate, corrIn, corrOut,
    );
    (document.getElementById('correction-form') as HTMLFormElement).reset();
    renderLeavePanel();
    showToast('✅ Pengajuan koreksi absen berhasil dikirim!', 'success');
  });
}
