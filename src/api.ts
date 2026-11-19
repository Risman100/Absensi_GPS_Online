import type { AuthUser } from './auth';
import type { AttendanceRecord, LeaveRequest } from './types';

const getUrl = () => import.meta.env.VITE_GOOGLE_SCRIPT_URL;

async function gasFetch(payload: any): Promise<any> {
  const url = getUrl();
  if (!url || url === 'MASUKAN_URL_WEB_APP_DI_SINI') {
    throw new Error("URL Google Apps Script belum dikonfigurasi di file .env");
  }
  
  const response = await fetch(url, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    if (text.startsWith('Success:') || text.startsWith('Error:')) {
      return text;
    }
    throw new Error('Gagal mem-parsing respons dari server: ' + text);
  }
}

export async function fetchUsers(): Promise<AuthUser[]> {
  const res = await gasFetch({ action: 'getUsers', data: {} });
  if (res && res.users) {
    return res.users as AuthUser[];
  }
  return [];
}

export async function fetchUser(email: string): Promise<AuthUser | null> {
  const res = await gasFetch({ action: 'getUser', data: { email } });
  if (res && res.found && res.user) {
    return res.user as AuthUser;
  }
  return null;
}

export async function deleteUser(id: string): Promise<void> {
  await gasFetch({ action: 'deleteUser', data: { id } });
}

export async function fetchAttendanceRecords(userId?: string): Promise<AttendanceRecord[]> {
  const res = await gasFetch({ action: 'getRecords', data: { userId } });
  if (res && res.records) {
    return res.records.map((r: any) => {
      const record: AttendanceRecord = {
        id: r.id || `${r.userId}_${r.date}`,
        employeeId: r.userId,
        employeeName: r.employeeName,
        date: r.date,
        notes: r.notes
      };
      
      if (r.clockInTime) {
        record.clockIn = {
          time: r.clockInTime,
          address: r.clockInAddress,
          status: (r.clockInStatus || 'on-time') as any,
          photo: r.photoInUrl,
          gps: { latitude: 0, longitude: 0, accuracy: 0, altitude: 0, timestamp: 0 } // default dummy
        };
      }
      
      if (r.clockOutTime) {
        record.clockOut = {
          time: r.clockOutTime,
          address: r.clockOutAddress,
          photo: r.photoOutUrl,
          gps: { latitude: 0, longitude: 0, accuracy: 0, altitude: 0, timestamp: 0 }
        };
      }
      return record;
    });
  }
  return [];
}

export async function fetchLeaves(userId?: string): Promise<LeaveRequest[]> {
  const res = await gasFetch({ action: 'getLeaves', data: { userId } });
  if (res && res.leaves) {
    return res.leaves as LeaveRequest[];
  }
  return [];
}

export async function updateLeaveStatus(id: string, status: 'Approved' | 'Rejected', approverName: string, rejectedReason: string = ''): Promise<void> {
  await gasFetch({ 
    action: 'updateLeaveStatus', 
    data: { id, status, approverName, rejectedReason } 
  });
}
