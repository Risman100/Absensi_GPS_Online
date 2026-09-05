import { auth } from './firebase';
import { 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut, 
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential
} from 'firebase/auth';
import type { User as FirebaseUser } from 'firebase/auth';

const googleProvider = new GoogleAuthProvider();

export interface AuthUser {
  id: string;
  email: string;
  role: 'admin' | 'hr' | 'employee';
  name: string;
  employeeId?: string;
  department: string;
  position: string;
  phone?: string;
  address?: string;
  avatar?: string;
}

export interface Session {
  userId: string;
  email: string;
  role: 'admin' | 'hr' | 'employee';
  name: string;
  employeeId?: string;
  department?: string;
  position?: string;
  loginTime: string;
  phone?: string;
  address?: string;
  avatar?: string;
}

const SESSION_KEY = 'absensi_session';

// Pemetaan sementara Role berdasarkan Email karena Firebase Auth default tidak menyimpan role
let MOCK_USER_PROFILES: Record<string, Omit<AuthUser, 'id' | 'email'>> = {
  'admin@email.com': {
    role: 'admin',
    name: 'Super Administrator',
    department: 'Management',
    position: 'System Administrator',
  },
  'budi@email.com': {
    role: 'hr',
    name: 'Budi Santoso',
    department: 'Human Resources',
    position: 'HR Manager',
  },
  'rhein@email.com': {
    role: 'employee',
    name: 'Rhein',
    employeeId: 'EMP001',
    department: 'IT',
    position: 'Developer',
  },
  'sari@email.com': {
    role: 'employee',
    name: 'Sari Dewi',
    employeeId: 'EMP003',
    department: 'Finance',
    position: 'Accountant',
  },
};

export function initAuth(): void {
  const saved = localStorage.getItem('absensi_users');
  if (saved) {
    try {
      MOCK_USER_PROFILES = JSON.parse(saved);
    } catch (e) {}
  }
}

// Untuk mempertahankan kompatibilitas dengan UI saat ini
export function getUsers(): AuthUser[] {
  return Object.entries(MOCK_USER_PROFILES).map(([email, profile]) => ({
    id: email, // Pakai email sebagai ID sementara
    email,
    ...profile
  }));
}

export function saveUsers(users: AuthUser[]): void {
  const newProfiles: Record<string, Omit<AuthUser, 'id' | 'email'>> = {};
  users.forEach(u => {
    const { id, email, ...rest } = u;
    newProfiles[email.toLowerCase()] = rest;
  });
  MOCK_USER_PROFILES = newProfiles;
  localStorage.setItem('absensi_users', JSON.stringify(MOCK_USER_PROFILES));
}

export async function login(email: string, password: string): Promise<Session | null> {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    return createSessionForUser(user);
  } catch (error: any) {
    console.error("Login error:", error.message);
    throw error;
  }
}

export async function loginWithGoogle(): Promise<Session | null> {
  try {
    const userCredential = await signInWithPopup(auth, googleProvider);
    const user = userCredential.user;
    
    // Register the user to MOCK_USER_PROFILES so they have a name in the UI
    const email = user.email || '';
    if (!MOCK_USER_PROFILES[email.toLowerCase()]) {
      MOCK_USER_PROFILES[email.toLowerCase()] = {
        role: 'employee',
        name: user.displayName || email.split('@')[0],
        department: 'Umum',
        position: 'Staff',
      };
    }

    return createSessionForUser(user);
  } catch (error: any) {
    console.error("Google Login error:", error.message);
    throw error;
  }
}

export async function register(email: string, password: string, name: string): Promise<Session | null> {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    // Daftarkan profil baru ke MOCK_USER_PROFILES untuk disesi ini agar namanya tersimpan
    MOCK_USER_PROFILES[email.toLowerCase()] = {
      role: 'employee',
      name: name,
      department: 'Umum',
      position: 'Staff',
    };

    return createSessionForUser(user);
  } catch (error: any) {
    console.error("Register error:", error.message);
    throw error;
  }
}

export function createSessionForUser(firebaseUser: FirebaseUser): Session {
  const email = firebaseUser.email || '';
  
  // Ambil profil berdasarkan email, atau gunakan default employee jika tidak terdaftar
  const profile = MOCK_USER_PROFILES[email.toLowerCase()] || {
    role: 'employee',
    name: email.split('@')[0], // Nama default dari email
    department: 'Umum',
    position: 'Staff',
  };

  const session: Session = {
    userId: firebaseUser.uid,
    email: email,
    role: profile.role,
    name: profile.name,
    employeeId: profile.employeeId,
    loginTime: new Date().toISOString(),
    phone: profile.phone,
    address: profile.address,
    avatar: profile.avatar,
  };

  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export async function logout(): Promise<void> {
  try {
    await firebaseSignOut(auth);
    sessionStorage.removeItem(SESSION_KEY);
  } catch (error) {
    console.error("Logout error:", error);
  }
}

export function getCurrentSession(): Session | null {
  try {
    const s = sessionStorage.getItem(SESSION_KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export function isLoggedIn(): boolean {
  return getCurrentSession() !== null;
}

// Helper function untuk mendengarkan perubahan status login (digunakan di main.ts)
export function listenAuthState(callback: (session: Session | null) => void) {
  return onAuthStateChanged(auth, (user) => {
    if (user) {
      const session = createSessionForUser(user);
      callback(session);
    } else {
      sessionStorage.removeItem(SESSION_KEY);
      callback(null);
    }
  });
}

export async function updateUserProfile(updates: Partial<Session>): Promise<void> {
  const session = getCurrentSession();
  if (!session) throw new Error("Tidak ada sesi aktif");
  
  const email = session.email.toLowerCase();
  if (!MOCK_USER_PROFILES[email]) {
    MOCK_USER_PROFILES[email] = {
      role: session.role,
      name: session.name,
      department: session.department || 'Umum',
      position: session.position || 'Staff'
    };
  }
  
  if (updates.phone !== undefined) MOCK_USER_PROFILES[email].phone = updates.phone;
  if (updates.address !== undefined) MOCK_USER_PROFILES[email].address = updates.address;
  if (updates.avatar !== undefined) MOCK_USER_PROFILES[email].avatar = updates.avatar;
  
  localStorage.setItem('absensi_users', JSON.stringify(MOCK_USER_PROFILES));
  
  // Update current session
  Object.assign(session, updates);
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export async function updateUserPassword(oldPass: string, newPass: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.email) throw new Error("Pengguna tidak terautentikasi");
  
  const credential = EmailAuthProvider.credential(user.email, oldPass);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPass);
}
