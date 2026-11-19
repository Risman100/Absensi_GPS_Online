import { auth, firebaseConfig } from './firebase';
import { initializeApp } from 'firebase/app';
import { 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut, 
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  getAuth
} from 'firebase/auth';
import type { User as FirebaseUser } from 'firebase/auth';
import { fetchUser, fetchUsers as apiFetchUsers } from './api';
import { backupToGoogleSheets } from './utils'; // to reuse onboarding action

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

export function initAuth(): void {
  // Data is now fetched asynchronously from Google Sheets via api.ts
  // Nothing to initialize from localStorage.
}

export async function getUsers(): Promise<AuthUser[]> {
  return await apiFetchUsers();
}

export async function login(email: string, password: string): Promise<Session | null> {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    return await createSessionForUser(user);
  } catch (error: any) {
    console.error("Login error:", error.message);
    throw error;
  }
}

export async function loginWithGoogle(): Promise<Session | null> {
  try {
    const userCredential = await signInWithPopup(auth, googleProvider);
    const user = userCredential.user;
    
    // Attempt to create session. If the user doesn't exist in Sheets, register them implicitly
    let session = await createSessionForUser(user);
    if (session.name === session.email.split('@')[0]) { // newly created default mock
       // Push to Google sheets
       await backupToGoogleSheets('onboarding', {
         id: user.uid,
         email: user.email,
         employeeName: user.displayName || user.email?.split('@')[0],
         role: 'employee',
         department: 'Umum',
         position: 'Staff'
       });
       // refetch session
       session = await createSessionForUser(user);
    }

    return session;
  } catch (error: any) {
    console.error("Google Login error:", error.message);
    throw error;
  }
}

export async function register(email: string, password: string, name: string): Promise<Session | null> {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    // Register the user to Google Sheets
    await backupToGoogleSheets('onboarding', {
      id: user.uid,
      email: email,
      employeeName: name,
      role: 'employee',
      department: 'Umum',
      position: 'Staff'
    });

    return await createSessionForUser(user);
  } catch (error: any) {
    console.error("Register error:", error.message);
    throw error;
  }
}

// Function for Admin to create a user without signing themselves out
export async function adminCreateUser(email: string, password: string, profileData: Partial<AuthUser>): Promise<void> {
  const secondaryApp = initializeApp(firebaseConfig, "SecondaryApp_" + Date.now());
  const secondaryAuth = getAuth(secondaryApp);
  
  try {
    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const user = userCredential.user;
    
    // Register the user to Google Sheets
    await backupToGoogleSheets('onboarding', {
      id: user.uid,
      email: email,
      employeeName: profileData.name,
      role: profileData.role || 'employee',
      department: profileData.department || 'Umum',
      position: profileData.position || 'Staff',
    });
  } catch (error: any) {
    console.error("Admin Create User error:", error.message);
    throw error;
  } finally {
    await firebaseSignOut(secondaryAuth);
  }
}

export async function createSessionForUser(firebaseUser: FirebaseUser): Promise<Session> {
  const email = firebaseUser.email || '';
  
  // Fetch real profile from Google Sheets
  let profile = await fetchUser(email);

  if (!profile) {
    // If not found in Google Sheets, fallback to default employee (or mock hardcoded admin)
    // We still keep hardcoded admins in case Google Sheets is empty or failed
    if (email.toLowerCase() === 'admin@email.com' || email.toLowerCase() === 'andrensetiawan@gmail.com') {
      profile = {
        id: firebaseUser.uid,
        email: email,
        role: 'admin',
        name: email.toLowerCase() === 'andrensetiawan@gmail.com' ? 'Andren Setiawan' : 'Super Administrator',
        department: 'Management',
        position: 'System Administrator'
      };
    } else {
      profile = {
        id: firebaseUser.uid,
        email: email,
        role: 'employee',
        name: email.split('@')[0], 
        department: 'Umum',
        position: 'Staff',
      };
    }
  }

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
    department: profile.department,
    position: profile.position
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

export function listenAuthState(callback: (session: Session | null) => void) {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      const session = await createSessionForUser(user);
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
  
  // Backup to Google Sheets
  await backupToGoogleSheets('onboarding', {
    id: session.userId,
    email: session.email,
    employeeName: updates.name !== undefined ? updates.name : session.name,
    phone: updates.phone !== undefined ? updates.phone : session.phone,
    address: updates.address !== undefined ? updates.address : session.address,
    photoBase64: updates.avatar !== undefined ? updates.avatar : session.avatar,
    role: session.role,
    department: session.department,
    position: session.position
  });
  
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
