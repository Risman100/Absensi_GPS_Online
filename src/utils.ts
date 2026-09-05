import type { GpsCoordinates, AttendanceRecord, AppConfig, Employee } from './types';

// ─── Storage Keys ───────────────────────────────────────────────────────────
const STORAGE_KEYS = {
  RECORDS: 'absensi_records',
  EMPLOYEE: 'absensi_employee',
  CONFIG: 'absensi_config',
} as const;

// ─── Default Config ─────────────────────────────────────────────────────────
export const DEFAULT_CONFIG: AppConfig = {
  officeLocation: {
    name: 'Kantor Pusat (Jl. Kuningan Persada No.Kav 4)',
    latitude: -6.2115,
    longitude: 106.8335,
    radius: 200,
  },
  workStartTime: '08:00',
  workEndTime: '17:00',
  lateThresholdMinutes: 15,
};

export const DEFAULT_EMPLOYEE: Employee = {
  id: 'EMP001',
  name: 'Nama Karyawan',
  position: 'Staff',
  department: 'Umum',
};

// ─── Date / Time Helpers ────────────────────────────────────────────────────
export function formatDate(date: Date = new Date()): string {
  return date.toLocaleDateString('id-ID', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatTime(date: Date = new Date()): string {
  return date.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).replace(/\./g, ':');
}

export function formatTimeShort(date: Date = new Date()): string {
  return date.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).replace(/\./g, ':');
}

export function getISODate(date: Date = new Date()): string {
  return date.toISOString().split('T')[0];
}

export function parseTimeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} menit`;
  return `${h} jam ${m} menit`;
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ─── GPS Helpers ─────────────────────────────────────────────────────────────
export function getCurrentPosition(): Promise<GpsCoordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation tidak didukung oleh browser ini.'));
      return;
    }

    const getPos = (highAccuracy = true): Promise<GeolocationPosition> => {
      return new Promise((res, rej) => {
        navigator.geolocation.getCurrentPosition(res, (err) => {
          if (highAccuracy && (err.code === err.TIMEOUT || err.code === err.POSITION_UNAVAILABLE)) {
            // Fallback to low accuracy
            navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
          } else {
            rej(err);
          }
        }, { enableHighAccuracy: highAccuracy, timeout: 15000, maximumAge: 0 });
      });
    };

    getPos(true)
      .then((pos) => {
        if ((pos as any).mocked) {
          reject(new Error('Fake GPS terdeteksi. Harap matikan aplikasi Fake GPS.'));
          return;
        }
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          altitude: pos.coords.altitude,
          timestamp: pos.timestamp,
          isMocked: false
        });
      })
      .catch((err) => {
        let errMsg = 'Gagal mendapatkan lokasi. Pastikan GPS aktif dan diizinkan.';
        if (err.code === 1) errMsg = 'Akses GPS ditolak. Tolong izinkan akses lokasi di browser Anda.';
        else if (err.code === 2) errMsg = 'Posisi GPS tidak tersedia. Coba pindah ke area terbuka.';
        else if (err.code === 3) errMsg = 'Pencarian lokasi GPS memakan waktu terlalu lama (Timeout).';
        reject(new Error(errMsg));
      });
  });
}

export function calculateDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000; // earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`,
      { headers: { 'Accept-Language': 'id' } }
    );
    const data = await res.json();
    return data.display_name ?? `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  } catch {
    return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }
}

// ─── Storage Helpers ─────────────────────────────────────────────────────────
export async function backupToGoogleSheets(action: 'absen' | 'cuti' | 'lembur' | 'onboarding', data: any) {
  const url = import.meta.env.VITE_GOOGLE_SCRIPT_URL;
  if (!url || url === 'MASUKAN_URL_WEB_APP_DI_SINI') return;

  try {
    const payload = { action, data };
    // GAS fetch is best without headers to avoid CORS preflight, sending as text/plain implicitly
    await fetch(url, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error('Failed to backup to Google Sheets:', error);
  }
}

export async function getUserFromGoogleSheets(id: string, email: string): Promise<any> {
  const url = import.meta.env.VITE_GOOGLE_SCRIPT_URL;
  if (!url || url === 'MASUKAN_URL_WEB_APP_DI_SINI') return null;

  try {
    const payload = { action: 'getUser', data: { id, email } };
    const response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    return result.user || null;
  } catch (error) {
    console.error('Failed to get user from Google Sheets:', error);
    return null;
  }
}

export function saveRecords(records: AttendanceRecord[]): void {
  localStorage.setItem(STORAGE_KEYS.RECORDS, JSON.stringify(records));
}

export function loadRecords(): AttendanceRecord[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.RECORDS) ?? '[]');
  } catch {
    return [];
  }
}

export function saveEmployee(employee: Employee): void {
  localStorage.setItem(STORAGE_KEYS.EMPLOYEE, JSON.stringify(employee));
}

export function loadEmployee(): Employee {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.EMPLOYEE) ?? 'null') ?? DEFAULT_EMPLOYEE;
  } catch {
    return DEFAULT_EMPLOYEE;
  }
}

export function saveConfig(config: AppConfig): void {
  localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(config));
}

export function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CONFIG);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.officeLocation && (Math.abs(parsed.officeLocation.latitude - (-6.2088)) < 0.0001 || !parsed.officeLocation.latitude)) {
      parsed.officeLocation.name = DEFAULT_CONFIG.officeLocation.name;
      parsed.officeLocation.latitude = DEFAULT_CONFIG.officeLocation.latitude;
      parsed.officeLocation.longitude = DEFAULT_CONFIG.officeLocation.longitude;
      localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(parsed));
    }
    return { ...DEFAULT_CONFIG, ...parsed, officeLocation: { ...DEFAULT_CONFIG.officeLocation, ...(parsed.officeLocation || {}) } };
  } catch {
    return DEFAULT_CONFIG;
  }
}

// ─── Attendance Status ────────────────────────────────────────────────────────
export function getAttendanceStatus(
  clockInTime: Date,
  config: AppConfig,
  distanceToOffice: number
): 'on-time' | 'late' | 'pending' {
  if (distanceToOffice > config.officeLocation.radius) {
    return 'pending';
  }
  const workStart = parseTimeToMinutes(config.workStartTime);
  const clockInMin = clockInTime.getHours() * 60 + clockInTime.getMinutes();
  return clockInMin <= workStart + config.lateThresholdMinutes ? 'on-time' : 'late';
}

// ─── CSV Export ───────────────────────────────────────────────────────────────
export function exportToCSV(records: AttendanceRecord[]): void {
  const header = ['ID', 'Tanggal', 'Nama', 'Jabatan', 'Clock In', 'Clock Out',
    'Durasi', 'Status', 'Lat In', 'Lng In', 'Akurasi In', 'Alamat In'];
  const rows = records.map(r => [
    r.id,
    r.date,
    r.employeeName,
    '',
    r.clockIn?.time ? new Date(r.clockIn.time).toLocaleTimeString('id-ID') : '-',
    r.clockOut?.time ? new Date(r.clockOut.time).toLocaleTimeString('id-ID') : '-',
    r.workDuration ? minutesToDuration(r.workDuration) : '-',
    r.clockIn?.status ?? '-',
    r.clockIn?.gps.latitude.toFixed(6) ?? '-',
    r.clockIn?.gps.longitude.toFixed(6) ?? '-',
    r.clockIn?.gps.accuracy.toFixed(1) ?? '-',
    r.clockIn?.address ?? '-',
  ]);
  const csv = [header, ...rows].map(row => row.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `absensi_${getISODate()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
