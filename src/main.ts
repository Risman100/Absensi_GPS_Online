import 'leaflet/dist/leaflet.css';
import './style.css';
import { initAuth, getCurrentSession, login, logout, listenAuthState, register, loginWithGoogle } from './auth';
import { initApp } from './app';
import { initAdmin } from './admin';
import { initHR } from './hr';
import { showToast } from './ui';
import { seedDefaultAnnouncements } from './announcement';
import { updateMapTheme } from './map';

document.addEventListener('DOMContentLoaded', () => {
  // Theme Toggle Logic
  const toggleBtn = document.getElementById('global-theme-toggle');
  const root = document.documentElement;
  
  function updateThemeIcon(isLight: boolean) {
    if (!toggleBtn) return;
    if (isLight) {
      toggleBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-sun"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
      toggleBtn.setAttribute('title', 'Switch to Dark Mode');
    } else {
      toggleBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-moon"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
      toggleBtn.setAttribute('title', 'Switch to Light Mode');
    }
  }

  // Load saved theme
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'light') {
    root.classList.add('light-theme');
    updateThemeIcon(true);
  } else {
    updateThemeIcon(false);
  }

  toggleBtn?.addEventListener('click', () => {
    root.classList.toggle('light-theme');
    const isLight = root.classList.contains('light-theme');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    updateThemeIcon(isLight);
    updateMapTheme(isLight);
  });

  // Initialize user db
  initAuth();
  seedDefaultAnnouncements();

  const loginContainer      = document.getElementById('login-container')!;
  const employeeContainer   = document.getElementById('employee-container')!;
  const employeeMobileNav   = document.getElementById('emp-mobile-nav')!;
  const hrContainer         = document.getElementById('hr-container')!;
  const hrMobileNav         = document.getElementById('hr-mobile-nav')!;
  const adminContainer      = document.getElementById('admin-container')!;
  const adminMobileNav      = document.getElementById('adm-mobile-nav')!;
  const loginForm           = document.getElementById('login-form') as HTMLFormElement;

  function hideAll(): void {
    loginContainer.style.display    = 'none';
    employeeContainer.style.display = 'none';
    employeeMobileNav.style.display = 'none';
    hrContainer.style.display       = 'none';
    hrMobileNav.style.display       = 'none';
    adminContainer.style.display    = 'none';
    adminMobileNav.style.display    = 'none';
  }

  function renderView(): void {
    const session = getCurrentSession();
    hideAll();

    if (!session) {
      loginContainer.style.display = 'flex';
      return;
    }

    const isMobile = window.innerWidth <= 768;

    if (session.role === 'admin') {
      adminContainer.style.display = 'grid';
      if (isMobile) adminMobileNav.style.display = 'flex';
      initAdmin(session);

    } else if (session.role === 'hr') {
      hrContainer.style.display = 'grid';
      if (isMobile) hrMobileNav.style.display = 'flex';
      initHR(session);

    } else {
      // employee
      employeeContainer.style.display = 'grid';
      if (isMobile) employeeMobileNav.style.display = 'flex';
      initApp();
    }
  }

  // ─── Login ───────────────────────────────────────────────────────────────────
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = (document.getElementById('login-username') as HTMLInputElement).value.trim();
    const password = (document.getElementById('login-password') as HTMLInputElement).value;

    const btnSubmit = loginForm.querySelector('button[type="submit"]') as HTMLButtonElement;
    const originalText = btnSubmit.innerHTML;
    btnSubmit.innerHTML = 'Memproses...';
    btnSubmit.disabled = true;

    try {
      const session = await login(email, password);
      if (session) {
        showToast(`Selamat datang, ${session.name}!`, 'success');
        (document.getElementById('login-username') as HTMLInputElement).value = '';
        (document.getElementById('login-password') as HTMLInputElement).value = '';
        // renderView akan dipanggil otomatis oleh listenAuthState
      }
    } catch (error: any) {
      if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
        showToast('Email atau password salah!', 'error');
      } else {
        showToast(`Gagal login: ${error.message}`, 'error');
      }
    } finally {
      btnSubmit.innerHTML = originalText;
      btnSubmit.disabled = false;
    }
  });

  // ─── Register ────────────────────────────────────────────────────────────────
  const registerForm = document.getElementById('register-form') as HTMLFormElement;
  registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = (document.getElementById('reg-name') as HTMLInputElement).value.trim();
    const email = (document.getElementById('reg-email') as HTMLInputElement).value.trim();
    const password = (document.getElementById('reg-password') as HTMLInputElement).value;

    const btnSubmit = registerForm.querySelector('button[type="submit"]') as HTMLButtonElement;
    const originalText = btnSubmit.innerHTML;
    btnSubmit.innerHTML = 'Mendaftar...';
    btnSubmit.disabled = true;

    try {
      const session = await register(email, password, name);
      if (session) {
        showToast(`Pendaftaran berhasil! Selamat datang, ${session.name}!`, 'success');
        
        // Sync to Google Sheets
        import('./utils').then(({ backupToGoogleSheets }) => {
          backupToGoogleSheets('onboarding', {
            id: session.userId,
            employeeName: session.name,
            email: session.email,
            password: password
          });
        });

        (document.getElementById('reg-name') as HTMLInputElement).value = '';
        (document.getElementById('reg-email') as HTMLInputElement).value = '';
        (document.getElementById('reg-password') as HTMLInputElement).value = '';
      }
    } catch (error: any) {
      if (error.code === 'auth/email-already-in-use') {
        showToast('Email ini sudah terdaftar!', 'error');
      } else if (error.code === 'auth/weak-password') {
        showToast('Password terlalu lemah, minimal 6 karakter!', 'error');
      } else {
        showToast(`Gagal daftar: ${error.message}`, 'error');
      }
    } finally {
      btnSubmit.innerHTML = originalText;
      btnSubmit.disabled = false;
    }
  });

  // ─── Form Toggles ────────────────────────────────────────────────────────────
  const showRegisterBtn = document.getElementById('show-register-btn');
  const showLoginBtn = document.getElementById('show-login-btn');
  const loginSwitch = document.getElementById('login-switch');
  const registerSwitch = document.getElementById('register-switch');

  showRegisterBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.style.display = 'none';
    if(loginSwitch) loginSwitch.style.display = 'none';
    registerForm.style.display = 'flex';
    registerForm.style.flexDirection = 'column';
    registerForm.style.gap = '16px';
    if(registerSwitch) registerSwitch.style.display = 'block';
  });

  showLoginBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    registerForm.style.display = 'none';
    if(registerSwitch) registerSwitch.style.display = 'none';
    loginForm.style.display = 'flex';
    if(loginSwitch) loginSwitch.style.display = 'block';
  });

  // ─── Google Login ────────────────────────────────────────────────────────────
  const googleBtns = document.querySelectorAll('.btn-google');
  googleBtns.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      
      const targetBtn = e.currentTarget as HTMLButtonElement;
      const originalHtml = targetBtn.innerHTML;
      targetBtn.innerHTML = 'Memproses...';
      targetBtn.disabled = true;

      try {
        const session = await loginWithGoogle();
        if (session) {
          showToast(`Selamat datang, ${session.name}!`, 'success');
          
          // Sync to Google Sheets
          import('./utils').then(({ backupToGoogleSheets }) => {
            backupToGoogleSheets('onboarding', {
              id: session.userId,
              employeeName: session.name,
              email: session.email,
              password: 'Google Auth'
            });
          });
        }
      } catch (error: any) {
        // Abaikan jika user membatalkan popup (popup-closed-by-user)
        if (error.code !== 'auth/popup-closed-by-user') {
          showToast(`Gagal login Google: ${error.message}`, 'error');
        }
      } finally {
        targetBtn.innerHTML = originalHtml;
        targetBtn.disabled = false;
      }
    });
  });

  // Password Visibility Toggle
  const togglePassBtn = document.querySelector('.btn-toggle-password');
  const passInput = document.getElementById('login-password') as HTMLInputElement;
  const eyeOpen = document.querySelector('.eye-icon-open') as HTMLElement;
  const eyeClosed = document.querySelector('.eye-icon-closed') as HTMLElement;

  togglePassBtn?.addEventListener('click', () => {
    if (!passInput) return;
    if (passInput.type === 'password') {
      passInput.type = 'text';
      if (eyeOpen) eyeOpen.style.display = 'block';
      if (eyeClosed) eyeClosed.style.display = 'none';
    } else {
      passInput.type = 'password';
      if (eyeOpen) eyeOpen.style.display = 'none';
      if (eyeClosed) eyeClosed.style.display = 'block';
    }
  });

  // Demo Account Quick Fill
  document.querySelectorAll('.hint-row').forEach(row => {
    row.addEventListener('click', () => {
      const user = row.getAttribute('data-user');
      const pass = row.getAttribute('data-pass');
      if (user && pass) {
        const userInput = document.getElementById('login-username') as HTMLInputElement;
        const passInputElem = document.getElementById('login-password') as HTMLInputElement;
        if (userInput) userInput.value = user;
        if (passInputElem) passInputElem.value = pass;
        showToast(`Akun ${user} terisi otomatis`, 'info');
      }
    });
  });

  // ─── Logout handlers ─────────────────────────────────────────────────────────
  async function doLogout(): Promise<void> {
    await logout();
    showToast('Berhasil keluar dari aplikasi', 'info');
    // Halaman tidak perlu direload, listenAuthState akan otomatis menangani transisi UI
  }

  // Employee sidebar logout
  document.getElementById('btn-emp-logout')?.addEventListener('click', doLogout);
  // Employee mobile nav logout
  document.getElementById('emp-mobile-logout')?.addEventListener('click', doLogout);
  // HR sidebar logout
  document.getElementById('btn-hr-logout')?.addEventListener('click', doLogout);
  // HR mobile nav logout
  document.getElementById('hr-mobile-logout')?.addEventListener('click', doLogout);
  // Admin sidebar logout
  document.getElementById('adm-logout')?.addEventListener('click', doLogout);
  // Admin mobile nav logout
  document.getElementById('adm-mobile-logout')?.addEventListener('click', doLogout);

  // ─── Responsive resize ───────────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    const session = getCurrentSession();
    if (!session) return;
    const isMobile = window.innerWidth <= 768;

    if (session.role === 'employee') {
      employeeMobileNav.style.display = isMobile ? 'flex' : 'none';
    } else if (session.role === 'hr') {
      hrMobileNav.style.display = isMobile ? 'flex' : 'none';
    } else if (session.role === 'admin') {
      adminMobileNav.style.display = isMobile ? 'flex' : 'none';
    }
  });

  // ─── Initial render via Firebase Listener ────────────────────────────────────
  listenAuthState((_session) => {
    // Dipanggil setiap kali status login Firebase berubah
    renderView();
  });
});
