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
import { getCurrentSession, getUsers, saveUsers } from './auth';
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
  records = loadRecords();

  try {
    console.log("[FaceAPI] Memuat model...");
    await faceapi.nets.tinyFaceDetector.loadFromUri('https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/');
    console.log("[FaceAPI] Model berhasil dimuat.");
  } catch (err) {
    console.error("[FaceAPI] Gagal memuat model:", err);
  }

  // Sync employee with current active session
  const session = getCurrentSession();
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

    const users = getUsers();
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

        // Update Mock DB
        const userEmail = (session.email || "").toLowerCase();
        const userIdx = users.findIndex(u => (u.email || "").toLowerCase() === userEmail);
        if (userIdx !== -1) {
          users[userIdx].phone = employee.phone;
          users[userIdx].address = employee.address;
          users[userIdx].avatar = employee.avatar;
          saveUsers(users);
        } else {
          users.push({
            id: session.userId,
            email: session.email || "",
            name: session.name || "Unknown",
            role: session.role || "employee",
            department: 'Umum',
            position: 'Staff',
            phone: employee.phone,
            address: employee.address,
            avatar: employee.avatar
          });
          saveUsers(users);
        }
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
  initMap('map-container', config.officeLocation);
  setupEventListeners();
  startGpsWatch();

  // Restore today's map markers
  const today = getTodayRecord(records);
  if (today?.clockIn) addAttendanceMarker(today.clockIn.gps, 'in', `Clock In ${formatTime(new Date(today.clockIn.time))}`);
  if (today?.clockOut) addAttendanceMarker(today.clockOut.gps, 'out', `Clock Out ${formatTime(new Date(today.clockOut.time))}`);
  updateButtonState();

  // Render announcements on home panel
  renderHomeAnnouncements();
  
  // Check Onboarding
  if (!employee.phone || !employee.avatar) {
    showOnboardingModal();
  }
}

// ─── Onboarding ──────────────────────────────────────────────────────────────
let onboardCamera: CameraService | null = null;
let onboardBase64: string = '';

function showOnboardingModal() {
  const modal = document.getElementById('onboarding-modal');
  if (modal) modal.style.display = 'flex';
  
  const btnCamera = document.getElementById('btn-onboard-camera');
  const preview = document.getElementById('onboard-photo-preview') as HTMLImageElement;
  const form = document.getElementById('onboarding-form') as HTMLFormElement;
  const btnSubmit = document.getElementById('btn-submit-onboard') as HTMLButtonElement;
  
  btnCamera?.addEventListener('click', async () => {
    if (!onboardCamera) {
      onboardCamera = new CameraService('camera-video');
    }
    const camModal = document.getElementById('camera-modal');
    if (camModal) camModal.style.display = 'flex';
    await onboardCamera.start();
    
    const btnCapture = document.getElementById('btn-capture');
    const captureHandler = () => {
      onboardBase64 = onboardCamera!.captureBase64(320);
      onboardCamera!.stop();
      if (camModal) camModal.style.display = 'none';
      preview.src = onboardBase64;
      preview.style.display = 'block';
      
      if (btnCamera) {
        btnCamera.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><polyline points="23 20 23 14 17 14"></polyline><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"></path></svg>
          <span style="font-size:13px; font-weight:500;">Foto Ulang</span>
        `;
        btnCamera.style.height = 'auto';
        btnCamera.style.padding = '12px';
      }
      
      btnSubmit.disabled = false;
      btnCapture?.removeEventListener('click', captureHandler);
    };
    btnCapture?.addEventListener('click', captureHandler);
  });
  
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const phone = (document.getElementById('onboard-phone') as HTMLInputElement).value;
    const address = (document.getElementById('onboard-address') as HTMLTextAreaElement).value;
    
    employee.phone = phone;
    employee.address = address;
    employee.avatar = "[Tersimpan di Drive]";
    saveEmployee(employee);
    
    const session = getCurrentSession();
    if (session) {
      session.phone = phone;
      session.address = address;
      session.avatar = "[Tersimpan di Drive]";
      sessionStorage.setItem('absensi_session', JSON.stringify(session));
      
      try {
        // Also update mock db
        const users = getUsers();
        const userEmail = (session.email || "").toLowerCase();
        const userIdx = users.findIndex(u => (u.email || "").toLowerCase() === userEmail);
        
        if (userIdx !== -1) {
          users[userIdx].phone = phone;
          users[userIdx].address = address;
          users[userIdx].avatar = "[Tersimpan di Drive]";
          saveUsers(users);
        } else {
          // If somehow not in mock db, add it
          users.push({
            id: session.email || session.userId,
            email: session.email || "",
            name: session.name || "Unknown",
            role: session.role || "employee",
            department: 'Umum',
            position: 'Staff',
            phone: phone,
            address: address,
            avatar: "[Tersimpan di Drive]"
          });
          saveUsers(users);
        }
      } catch (err) {
        console.error("Failed to update local mock DB:", err);
      }
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
  });
}

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
  if (!attCamera || document.getElementById('camera-modal')?.style.display === 'none') return;
  // If the onboarding is currently using it, don't interfere (handled by separate event listener)
  // Wait, btn-capture is shared. Better to differentiate or check which modal triggered it.
  // Actually, we'll just check if onboardBase64 is empty to know if it's onboarding.
  // A better way is to bind the click inside the flow, but let's keep it simple: 
  // If preview-modal is supposed to show, it means it's attendance.
  if (document.getElementById('onboarding-modal')?.style.display === 'flex') return;

  currentPhotoBase64 = attCamera.captureBase64(320);
  attCamera.stop();
  const camModal = document.getElementById('camera-modal');
  if (camModal) camModal.style.display = 'none';
  
  await showPreviewModal();
});

document.getElementById('btn-camera-close')?.addEventListener('click', () => {
  if (attCamera) attCamera.stop();
  if (typeof onboardCamera !== 'undefined' && onboardCamera) onboardCamera.stop();
  const camModal = document.getElementById('camera-modal');
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
    
    const detections = await faceapi.detectAllFaces(tempImg, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.3 }));
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

    saveRecords(records);
    backupToGoogleSheets('absen', {
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

    saveRecords(records);
    backupToGoogleSheets('absen', {
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
  document.getElementById('btn-save-settings')?.addEventListener('click', () => {
    const { config: newConfig, emp: newEmp } = getSettingsFormValues();
    config = newConfig;
    employee = newEmp;
    saveConfig(config);
    saveEmployee(employee);

    const session = getCurrentSession();
    if (session) {
      const users = getUsers();
      const userIdx = users.findIndex(u => u.id === session.userId);
      if (userIdx !== -1) {
        users[userIdx].name = employee.name;
        users[userIdx].employeeId = employee.id;
        users[userIdx].position = employee.position;
        users[userIdx].department = employee.department;
        saveUsers(users);
        session.name = employee.name;
        session.employeeId = employee.id;
        sessionStorage.setItem('absensi_session', JSON.stringify(session));
      }
    }
    renderEmployee(employee);
    updateOfficeLocation(config.officeLocation);
    const heroGreeting = document.getElementById('hero-greeting');
    if (heroGreeting) heroGreeting.textContent = `Halo, ${employee.name}!`;
    showToast('Pengaturan disimpan!', 'success');
    setActiveTab('home');
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
