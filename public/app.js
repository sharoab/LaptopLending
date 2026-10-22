/**
 * אפליקציית ניהול השאלת עגלת מחשבים - "תפוס"
 * School Laptop Loan Management System
 */

// 3 מנהלי המערכת המורשים בלבד
const STRICT_ADMIN_EMAILS = [
  "sharonabudi@gmail.com",
  "iritulp@gmail.com",
  "zviajer@gmail.com"
];

// Global State
let currentUser = null;
let appState = {
  laptops: Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    isTaken: false,
    takenBy: null,
    takenEmail: null,
    takenAt: null
  })),
  adminEmails: STRICT_ADMIN_EMAILS
};

let activeTimerInterval = null;
let pendingBorrowLaptopId = null;

// Audio synth effects (Web Audio API)
function playSound(type) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    
    if (type === 'success') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.15); // G5
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.35);
    } else if (type === 'return') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(659.25, ctx.currentTime); // E5
      osc.frequency.exponentialRampToValueAtTime(440.00, ctx.currentTime + 0.2); // A4
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    }
  } catch (e) {
    // Audio context not allowed before user gesture or unavailable
  }
}

// Format duration from ISO string
function formatDuration(isoString) {
  if (!isoString) return "00:00:00";
  const start = new Date(isoString).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - start) / 1000));
  
  const hours = Math.floor(diffSec / 3600);
  const minutes = Math.floor((diffSec % 3600) / 60);
  const seconds = diffSec % 60;
  
  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0')
  ].join(':');
}

// Format human Hebrew duration
function formatHumanDuration(isoString) {
  if (!isoString) return "כרגע";
  const start = new Date(isoString).getTime();
  const now = Date.now();
  const diffMinutes = Math.floor((now - start) / 60000);
  
  if (diffMinutes < 1) return "לפני פחות מדקה";
  if (diffMinutes === 1) return "לפני דקה";
  if (diffMinutes < 60) return `${diffMinutes} דקות`;
  
  const hours = Math.floor(diffMinutes / 60);
  const remainingMins = diffMinutes % 60;
  if (hours === 1) return remainingMins > 0 ? `שעה ו-${remainingMins} דק'` : "שעה אחת";
  if (hours === 2) return remainingMins > 0 ? `שעתיים ו-${remainingMins} דק'` : "שעתיים";
  return remainingMins > 0 ? `${hours} שעות ו-${remainingMins} דק'` : `${hours} שעות`;
}

// ------------------------------------------------------------------
// API & Data Sync
// ------------------------------------------------------------------
async function fetchState() {
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      appState = data;
      localStorage.setItem('laptop_cart_state', JSON.stringify(appState));
      render();
      return;
    }
  } catch (err) {
    // If running as local file without server, fallback to localStorage
    const saved = localStorage.getItem('laptop_cart_state');
    if (saved) {
      try {
        appState = JSON.parse(saved);
      } catch (e) {}
    }
  }
  render();
}

async function apiBorrow(laptopId) {
  if (!currentUser) return;
  try {
    const res = await fetch('/api/borrow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userName: currentUser.name,
        userEmail: currentUser.email,
        laptopId: laptopId
      })
    });
    const result = await res.json();
    if (res.ok) {
      appState = result.state;
      localStorage.setItem('laptop_cart_state', JSON.stringify(appState));
      if (typeof syncCartToFirebase === 'function') syncCartToFirebase(appState);
      playSound('success');
      showToast(result.message || 'המחשב הוקצה לך בהצלחה!', 'success');
    } else {
      showToast(result.error || 'שגיאה בהשאלת המחשב', 'error');
    }
  } catch (e) {
    // Local fallback
    localBorrow(laptopId);
  }
  render();
}

function localBorrow(laptopId) {
  let target = laptopId 
    ? appState.laptops.find(l => l.id === laptopId)
    : appState.laptops.find(l => !l.isTaken);
    
  if (!target || target.isTaken) {
    showToast('המחשב אינו פנוי', 'error');
    return;
  }
  
  target.isTaken = true;
  target.takenBy = currentUser.name;
  target.takenEmail = currentUser.email;
  target.takenAt = new Date().toISOString();
  localStorage.setItem('laptop_cart_state', JSON.stringify(appState));
  if (typeof syncCartToFirebase === 'function') syncCartToFirebase(appState);
  playSound('success');
  showToast(`מחשב מס' ${target.id} הוקצה לך בהצלחה!`, 'success');
}

async function apiReturn() {
  if (!currentUser) return;
  try {
    const res = await fetch('/api/return', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userName: currentUser.name,
        userEmail: currentUser.email
      })
    });
    const result = await res.json();
    if (res.ok) {
      appState = result.state;
      localStorage.setItem('laptop_cart_state', JSON.stringify(appState));
      if (typeof syncCartToFirebase === 'function') syncCartToFirebase(appState);
      playSound('return');
      showToast(result.message || 'המחשב הוחזר בהצלחה, תודה!', 'success');
    } else {
      showToast(result.error || 'שגיאה בהחזרת המחשב', 'error');
    }
  } catch (e) {
    // Local fallback
    localReturn();
  }
  render();
}

function localReturn() {
  const target = appState.laptops.find(l => l.isTaken && (
    (currentUser.email && l.takenEmail === currentUser.email) ||
    l.takenBy === currentUser.name
  ));
  if (target) {
    const num = target.id;
    target.isTaken = false;
    target.takenBy = null;
    target.takenEmail = null;
    target.takenAt = null;
    localStorage.setItem('laptop_cart_state', JSON.stringify(appState));
    if (typeof syncCartToFirebase === 'function') syncCartToFirebase(appState);
    playSound('return');
    showToast(`המחשב הוחזר בהצלחה, תודה!`, 'success');
  }
}

async function apiAdminReset(laptopId) {
  try {
    const res = await fetch('/api/admin/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ laptopId })
    });
    const result = await res.json();
    if (res.ok) {
      appState = result.state;
      localStorage.setItem('laptop_cart_state', JSON.stringify(appState));
      if (typeof syncCartToFirebase === 'function') syncCartToFirebase(appState);
      showToast(`מחשב מס' ${laptopId} שוחרר למצב פנוי`, 'success');
    }
  } catch (e) {
    const target = appState.laptops.find(l => l.id === laptopId);
    if (target) {
      target.isTaken = false;
      target.takenBy = null;
      target.takenEmail = null;
      target.takenAt = null;
      localStorage.setItem('laptop_cart_state', JSON.stringify(appState));
      if (typeof syncCartToFirebase === 'function') syncCartToFirebase(appState);
      showToast(`מחשב מס' ${laptopId} שוחרר למצב פנוי`, 'success');
    }
  }
  render();
}

async function apiAdminResetAll() {
  try {
    const res = await fetch('/api/admin/reset-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const result = await res.json();
    if (res.ok) {
      appState = result.state;
      localStorage.setItem('laptop_cart_state', JSON.stringify(appState));
      if (typeof syncCartToFirebase === 'function') syncCartToFirebase(appState);
      showToast('כל המחשבים בעגלה אופסו ושוחררו בהצלחה!', 'success');
    }
  } catch (e) {
    appState.laptops.forEach(l => {
      l.isTaken = false;
      l.takenBy = null;
      l.takenEmail = null;
      l.takenAt = null;
    });
    localStorage.setItem('laptop_cart_state', JSON.stringify(appState));
    if (typeof syncCartToFirebase === 'function') syncCartToFirebase(appState);
    showToast('כל המחשבים בעגלה אופסו ושוחררו בהצלחה!', 'success');
  }
  render();
}

// ------------------------------------------------------------------
// Auth & Session
// ------------------------------------------------------------------
function initAuth() {
  const savedUser = localStorage.getItem('laptop_user');
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      showScreen('home');
      return;
    } catch (e) {}
  }
  showScreen('login');
}

function handleLogin(name, email, avatar = '👩‍🏫', isRemember = true) {
  if (!name.trim()) {
    showToast('נא להזין את שם המורה', 'error');
    return;
  }
  
  const cleanEmail = email.trim().toLowerCase();
  // בדיקה קפדנית: רק 3 המיילים שהוגדרו מורשים להיכנס למסך הניהול
  const isAdmin = STRICT_ADMIN_EMAILS.includes(cleanEmail);

  currentUser = {
    name: name.trim(),
    email: cleanEmail,
    avatar: isAdmin ? '👑' : avatar,
    isAdmin: isAdmin
  };

  if (isRemember) {
    localStorage.setItem('laptop_user', JSON.stringify(currentUser));
  }
  
  if (isAdmin) {
    showToast(`שלום ${currentUser.name}, זוהית כמנהל מערכת מורשה 👑`, 'success');
  } else {
    showToast(`ברוך הבא, ${currentUser.name}!`, 'success');
  }
  
  showScreen('home');
  render();
}

function handleLogout() {
  localStorage.removeItem('laptop_user');
  currentUser = null;
  document.body.classList.remove('has-floating-widget');
  showScreen('login');
  showToast('התנתקת מהמערכת בהצלחה', 'info');
}

// ------------------------------------------------------------------
// Navigation & Views
// ------------------------------------------------------------------
let currentScreen = 'login';

function showScreen(screenId) {
  // אבטחת מסך ניהול: חסימה מוחלטת למי שאינו מ-3 המנהלים
  if (screenId === 'admin') {
    if (!currentUser || !currentUser.isAdmin) {
      showToast('גישה חסומה: מסך הניהול מורשה ל-3 מנהלי המערכת בלבד', 'error');
      showScreen('home');
      return;
    }
  }

  currentScreen = screenId;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  
  const target = document.getElementById(`screen-${screenId}`);
  if (target) target.classList.add('active');

  const navHomeBtn = document.getElementById('nav-btn-home');
  const navAdminBtn = document.getElementById('nav-btn-admin');
  
  if (navHomeBtn && navAdminBtn) {
    navHomeBtn.classList.toggle('active', screenId === 'home');
    navAdminBtn.classList.toggle('active', screenId === 'admin');
  }

  // Header visibility: hide header on login screen
  const header = document.getElementById('app-header');
  if (header) {
    header.style.display = screenId === 'login' ? 'none' : 'flex';
  }

  render();
}

// ------------------------------------------------------------------
// UI Rendering
// ------------------------------------------------------------------
function getUserLaptop() {
  if (!currentUser) return null;
  return appState.laptops.find(l => l.isTaken && (
    (currentUser.email && l.takenEmail === currentUser.email) ||
    l.takenBy === currentUser.name
  ));
}

function render() {
  const userLaptop = getUserLaptop();
  const availableLaptops = appState.laptops.filter(l => !l.isTaken);
  const availableCount = availableLaptops.length;
  const totalCount = appState.laptops.length;

  // 1. Render Floating Widget
  const floatingWidget = document.getElementById('floating-widget');
  if (userLaptop) {
    document.body.classList.add('has-floating-widget');
    floatingWidget.style.display = 'flex';
    document.getElementById('widget-laptop-num').textContent = userLaptop.id;
    document.getElementById('widget-timer').textContent = formatDuration(userLaptop.takenAt);
  } else {
    document.body.classList.remove('has-floating-widget');
    floatingWidget.style.display = 'none';
  }

  // 2. Render Header User Profile
  if (currentUser) {
    document.getElementById('header-user-name').textContent = `שלום, ${currentUser.name}`;
    document.getElementById('header-user-avatar').textContent = currentUser.avatar || '👩‍🏫';
    
    const roleBadge = document.getElementById('header-user-role');
    if (currentUser.isAdmin) {
      roleBadge.textContent = 'רכז תקשוב';
      roleBadge.style.display = 'inline-block';
    } else {
      roleBadge.textContent = 'מורה';
      roleBadge.style.display = 'inline-block';
    }

    // Admin nav button in header
    const adminNavBtn = document.getElementById('nav-btn-admin');
    if (adminNavBtn) {
      adminNavBtn.style.display = currentUser.isAdmin ? 'flex' : 'none';
    }
  }

  // 3. Render Screen 2 (Home Screen)
  // Availability Card
  const countEl = document.getElementById('available-count');
  const totalEl = document.getElementById('total-count');
  const barFill = document.getElementById('counter-bar-fill');
  if (countEl) countEl.textContent = `${availableCount} מחשבים פנויים`;
  if (totalEl) totalEl.textContent = `(מתוך ${totalCount})`;
  if (barFill) {
    const pct = Math.round((availableCount / totalCount) * 100);
    barFill.style.width = `${pct}%`;
  }

  // Main CTA Button
  const mainCtaBtn = document.getElementById('main-cta-btn');
  const activeNoticeCard = document.getElementById('active-loan-notice-card');
  
  if (mainCtaBtn) {
    if (userLaptop) {
      // Teacher already has a laptop
      mainCtaBtn.disabled = true;
      mainCtaBtn.classList.add('disabled');
      mainCtaBtn.innerHTML = `
        <span class="cta-icon">🔒</span>
        <span>מחשב מספר ${userLaptop.id} ברשותך.</span>
        <span class="cta-notice">לא תוכל להשאיל מחשב נוסף</span>
      `;
      if (activeNoticeCard) activeNoticeCard.style.display = 'flex';
    } else {
      // Teacher has no laptop
      mainCtaBtn.disabled = availableCount === 0;
      mainCtaBtn.classList.remove('disabled');
      mainCtaBtn.innerHTML = availableCount > 0 ? `
        <span class="cta-icon">💻</span>
        <span>קח מחשב פנוי</span>
      ` : `
        <span class="cta-icon">⏳</span>
        <span>אין מחשבים פנויים כרגע</span>
      `;
      if (activeNoticeCard) activeNoticeCard.style.display = 'none';
    }
  }

  // 12-Laptops Selection Grid
  renderLaptopsGrid(userLaptop);

  // 4. Render Screen 3 (Admin Screen)
  renderAdminView();
}

function renderLaptopsGrid(userLaptop) {
  const grid = document.getElementById('laptops-grid');
  if (!grid) return;

  grid.innerHTML = '';
  
  appState.laptops.forEach(laptop => {
    const isMine = userLaptop && userLaptop.id === laptop.id;
    const isFree = !laptop.isTaken;
    
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'laptop-btn';
    
    if (isMine) {
      card.classList.add('current-user-laptop');
    } else if (isFree) {
      card.classList.add('available');
    } else {
      card.classList.add('taken');
      card.disabled = true;
    }

    // If user already has a laptop, free laptops are not clickable to prevent multiple loans
    if (userLaptop && !isMine) {
      card.style.opacity = '0.7';
    }

    const padId = String(laptop.id).padStart(2, '0');
    
    let statusText = 'פנוי';
    if (isMine) {
      statusText = 'המחשב שלך';
    } else if (laptop.isTaken) {
      statusText = 'תפוס';
    }

    card.innerHTML = `
      <div class="laptop-icon">${isMine ? '⭐' : '💻'}</div>
      <div class="laptop-num">${laptop.id}</div>
      <div class="laptop-status-tag">${statusText}</div>
      ${laptop.isTaken && !isMine ? `<div class="laptop-user-name" title="${laptop.takenBy}">${laptop.takenBy}</div>` : ''}
    `;

    // Click behavior
    card.onclick = () => {
      if (userLaptop) {
        if (isMine) {
          showToast(`מחשב מס' ${laptop.id} נמצא אצלך. להחזרה לחץ על הכפתור האדום בראש המסך.`, 'info');
        } else {
          showToast(`כבר יש ברשותך מחשב פעיל (מס' ${userLaptop.id}). החזר אותו כדי לבחור מחשב אחר.`, 'error');
        }
        return;
      }
      
      if (isFree) {
        // Open confirmation modal for this specific laptop
        openBorrowDialog(laptop.id);
      }
    };

    grid.appendChild(card);
  });
}

function renderAdminView() {
  const freeCount = appState.laptops.filter(l => !l.isTaken).length;
  const takenCount = appState.laptops.filter(l => l.isTaken).length;
  
  const freeStat = document.getElementById('admin-stat-free');
  const takenStat = document.getElementById('admin-stat-taken');
  const totalStat = document.getElementById('admin-stat-total');
  
  if (freeStat) freeStat.textContent = freeCount;
  if (takenStat) takenStat.textContent = takenCount;
  if (totalStat) totalStat.textContent = appState.laptops.length;

  const tableContainer = document.getElementById('admin-laptops-list');
  if (!tableContainer) return;

  tableContainer.innerHTML = '';

  appState.laptops.forEach(laptop => {
    const row = document.createElement('div');
    row.className = 'admin-list-row';

    const padId = String(laptop.id).padStart(2, '0');
    const isFree = !laptop.isTaken;

    row.innerHTML = `
      <div class="admin-row-right">
        <div class="admin-laptop-badge">
          💻 מחשב ${laptop.id}
        </div>
        <span class="admin-status-pill ${isFree ? 'free' : 'busy'}">
          ${isFree ? '🟢 פנוי' : '🔴 תפוס'}
        </span>
      </div>

      <div class="admin-row-details">
        ${!isFree ? `
          <div class="admin-teacher-name">אצל: ${laptop.takenBy || 'ללא שם'}</div>
          <div class="admin-loan-time">
            ⏱️ ${formatHumanDuration(laptop.takenAt)} (${formatDuration(laptop.takenAt)})
          </div>
        ` : `
          <div style="font-size: 12.5px; color: #64748b;">מוכן להשאלה בעגלה</div>
        `}
      </div>

      <div class="admin-row-actions">
        ${!isFree ? `
          <button class="admin-reset-btn" onclick="openAdminSingleResetModal(${laptop.id})">
            🔓 שחרר מחשב
          </button>
        ` : `
          <span style="font-size: 12px; color: #10b981; font-weight: 600;">זמין</span>
        `}
      </div>
    `;

    tableContainer.appendChild(row);
  });
}

// ------------------------------------------------------------------
// Modals & Action Flows
// ------------------------------------------------------------------

// 1. CTA Flow ("קח מחשב פנוי")
function handleMainCtaClick() {
  const userLaptop = getUserLaptop();
  if (userLaptop) {
    showToast(`מחשב מס' ${userLaptop.id} כבר ברשותך`, 'info');
    return;
  }

  const freeLaptops = appState.laptops.filter(l => !l.isTaken);
  if (freeLaptops.length === 0) {
    showToast('אין מחשבים פנויים כרגע בעגלה', 'error');
    return;
  }

  // "מה קורה בלחיצה? המסך מתרענן לשנייה, והאפליקציה פותחת דיאלוג ובו 2 אפשרויות: 1.לקחתי, 2.התחרטתי, החזר מחשב"
  const overlay = document.getElementById('loader-refresh-overlay');
  overlay.classList.add('active');

  setTimeout(() => {
    overlay.classList.remove('active');
    // Select lowest numbered free laptop
    const targetLaptop = freeLaptops[0];
    openBorrowDialog(targetLaptop.id);
  }, 900);
}

function openBorrowDialog(laptopId) {
  pendingBorrowLaptopId = laptopId;
  const modal = document.getElementById('modal-borrow');
  document.getElementById('modal-borrow-laptop-num').textContent = laptopId;
  modal.classList.add('active');
}

function closeBorrowDialog() {
  const modal = document.getElementById('modal-borrow');
  modal.classList.remove('active');
  pendingBorrowLaptopId = null;
}

function confirmBorrow() {
  if (pendingBorrowLaptopId !== null) {
    apiBorrow(pendingBorrowLaptopId);
  }
  closeBorrowDialog();
}

function cancelBorrow() {
  closeBorrowDialog();
  showToast('הפעולה בוטלה. המחשב נשאר בעגלה.', 'info');
}

// 2. Return Laptop Flow ("לחצי להחזרה")
function handleReturnClick() {
  const userLaptop = getUserLaptop();
  if (!userLaptop) return;

  // Perform return
  apiReturn();
}

// 3. Admin Reset Flows
let pendingResetLaptopId = null;

function openAdminSingleResetModal(laptopId) {
  pendingResetLaptopId = laptopId;
  const modal = document.getElementById('modal-admin-reset');
  document.getElementById('modal-reset-laptop-num').textContent = laptopId;
  modal.classList.add('active');
}

function closeAdminSingleResetModal() {
  const modal = document.getElementById('modal-admin-reset');
  modal.classList.remove('active');
  pendingResetLaptopId = null;
}

function confirmAdminSingleReset() {
  if (pendingResetLaptopId !== null) {
    apiAdminReset(pendingResetLaptopId);
  }
  closeAdminSingleResetModal();
}

function openAdminResetAllModal() {
  const takenCount = appState.laptops.filter(l => l.isTaken).length;
  if (takenCount === 0) {
    showToast('כל המחשבים בעגלה כבר פנויים!', 'info');
    return;
  }
  const modal = document.getElementById('modal-admin-reset-all');
  document.getElementById('modal-reset-all-count').textContent = takenCount;
  modal.classList.add('active');
}

function closeAdminResetAllModal() {
  const modal = document.getElementById('modal-admin-reset-all');
  modal.classList.remove('active');
}

function confirmAdminResetAll() {
  apiAdminResetAll();
  closeAdminResetAllModal();
}

// ------------------------------------------------------------------
// Toasts
// ------------------------------------------------------------------
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '⚠️';

  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ------------------------------------------------------------------
// Quick Select Google Profiles
// ------------------------------------------------------------------
const DEMO_PROFILES = [
  { name: 'שרון אבודי (מנהל)', email: 'sharonabudi@gmail.com', avatar: '👑', desc: 'מנהל מערכת' },
  { name: 'אירית (מנהלת)', email: 'iritulp@gmail.com', avatar: '👑', desc: 'מנהלת מערכת' },
  { name: 'צביה (מנהלת)', email: 'zviajer@gmail.com', avatar: '👑', desc: 'מנהלת מערכת' },
  { name: 'דוד לוי (מורה)', email: 'david.l@school.edu.il', avatar: '👨‍🏫', desc: 'מורה ללא הרשאת ניהול' }
];

// ------------------------------------------------------------------
// Google Sign-In Email Modal Flow
// ------------------------------------------------------------------
function openGoogleSignInModal() {
  const modal = document.getElementById('modal-google-signin');
  if (modal) {
    modal.classList.add('active');
    setTimeout(() => {
      document.getElementById('google-email-input')?.focus();
    }, 150);
  }
}

function closeGoogleSignInModal() {
  const modal = document.getElementById('modal-google-signin');
  if (modal) modal.classList.remove('active');
}

// ------------------------------------------------------------------
// Share & QR Modal
// ------------------------------------------------------------------
function getAppShareUrl() {
  if (appState.localIp && appState.serverPort) {
    return `http://${appState.localIp}:${appState.serverPort}`;
  }
  return window.location.origin;
}

function openShareModal() {
  const modal = document.getElementById('modal-share');
  if (!modal) return;
  const shareUrl = getAppShareUrl();
  const urlEl = document.getElementById('share-url-text');
  const qrImg = document.getElementById('qr-code-img');

  if (urlEl) urlEl.textContent = shareUrl;
  if (qrImg) {
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(shareUrl)}`;
  }
  modal.classList.add('active');
}

function closeShareModal() {
  const modal = document.getElementById('modal-share');
  if (modal) modal.classList.remove('active');
}

function copyShareUrl() {
  const shareUrl = getAppShareUrl();
  navigator.clipboard.writeText(shareUrl).then(() => {
    showToast('הקישור הועתק ללוח!', 'success');
  }).catch(() => {
    showToast(`הקישור הוא: ${shareUrl}`, 'info');
  });
}

function printQrSticker() {
  const shareUrl = getAppShareUrl();
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    showToast('נא לאפשר חלונות קופצים כדי להדפיס', 'error');
    return;
  }
  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="he" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <title>מדבקת עגלת מחשבים - סריקת QR</title>
      <style>
        body { font-family: system-ui, sans-serif; text-align: center; padding: 40px; margin: 0; }
        .card { border: 4px solid #0284c7; border-radius: 24px; padding: 30px; max-width: 450px; margin: 0 auto; }
        h1 { color: #0284c7; font-size: 28px; margin-bottom: 6px; }
        p { color: #475569; font-size: 16px; margin-bottom: 20px; font-weight: 600; }
        .qr-box { background: white; padding: 15px; border-radius: 16px; display: inline-block; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
        .qr-box img { width: 240px; height: 240px; }
        .url-box { font-family: monospace; font-size: 16px; color: #0369a1; font-weight: bold; margin-top: 15px; background: #f0f9ff; padding: 8px 12px; border-radius: 8px; }
        .instructions { font-size: 14px; color: #64748b; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>💻 עגלת מחשבים בית ספרית</h1>
        <p>סרקו את הברקוד עם מצלמת הטלפון להשאלת מחשב</p>
        <div class="qr-box">
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(shareUrl)}" alt="QR Code">
        </div>
        <div class="url-box">${shareUrl}</div>
        <div class="instructions">
          1. פתח מצלמה בטלפון 📱<br>
          2. סרוק את הקוד והתחבר 👨‍🏫<br>
          3. לחץ על "קח מחשב פנוי" 💻
        </div>
      </div>
      <script>
        window.onload = () => { window.print(); };
      </script>
    </body>
    </html>
  `);
  printWindow.document.close();
}

// ------------------------------------------------------------------
// Event Listeners & Initialization
// ------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  fetchState();

  // אתחול סנכרון בזמן אמת מול פיירבייס (Firebase Realtime Firestore)
  if (typeof initFirebase === 'function') {
    initFirebase((firebaseData) => {
      if (firebaseData && firebaseData.laptops) {
        appState.laptops = firebaseData.laptops;
        localStorage.setItem('laptop_cart_state', JSON.stringify(appState));
        render();
      }
    });
  }

  // Regular Polling every 2.5 seconds to sync state across devices
  setInterval(fetchState, 2500);

  // Live Timer ticker every 1 second
  setInterval(() => {
    const userLaptop = getUserLaptop();
    if (userLaptop && userLaptop.takenAt) {
      const timerEl = document.getElementById('widget-timer');
      if (timerEl) {
        timerEl.textContent = formatDuration(userLaptop.takenAt);
      }
    }
    // Also update admin screen times if active
    if (currentScreen === 'admin') {
      renderAdminView();
    }
  }, 1000);

  // כניסה דרך טופס הקלדת מייל (ללא גוגל)
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('teacher-name-input').value.trim();
      const email = document.getElementById('teacher-email-input').value.trim();
      
      if (!name) {
        showToast('חובה להכניס את שמך תחילה', 'error');
        document.getElementById('teacher-name-input').focus();
        return;
      }
      if (!email) {
        showToast('נא להזין כתובת אימייל', 'error');
        document.getElementById('teacher-email-input').focus();
        return;
      }

      const remember = document.getElementById('remember-me-checkbox').checked;
      handleLogin(name, email, '👨‍🏫', remember);
    });
  }

  // חיבור דרך גוגל -> מוודא ששם המורה הוזן תחילה, ואז פותח את מסך הכנסת מייל Google
  const googleBtn = document.getElementById('google-login-btn');
  if (googleBtn) {
    googleBtn.addEventListener('click', () => {
      const name = document.getElementById('teacher-name-input').value.trim();
      if (!name) {
        showToast('נא להכניס תחילה את שמך בשדה השם', 'error');
        document.getElementById('teacher-name-input').focus();
        return;
      }
      openGoogleSignInModal();
    });
  }

  // טופס הזנת מייל גוגל
  const googleEmailForm = document.getElementById('google-email-form');
  if (googleEmailForm) {
    googleEmailForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('google-email-input').value.trim();
      const teacherNameInput = document.getElementById('teacher-name-input');
      const name = (teacherNameInput?.value.trim()) || email.split('@')[0];
      const remember = document.getElementById('remember-me-checkbox')?.checked ?? true;
      closeGoogleSignInModal();
      handleLogin(name, email, '👑', remember);
    });
  }

  // כפתור ביטול במסך מייל גוגל
  document.getElementById('google-modal-cancel')?.addEventListener('click', closeGoogleSignInModal);

  // Header Nav buttons
  document.getElementById('nav-btn-home')?.addEventListener('click', () => showScreen('home'));
  document.getElementById('nav-btn-admin')?.addEventListener('click', () => showScreen('admin'));

  // User Dropdown toggle
  const userAvatar = document.getElementById('header-user-avatar');
  const userMenu = document.getElementById('user-menu-dropdown');
  if (userAvatar && userMenu) {
    userAvatar.addEventListener('click', (e) => {
      e.stopPropagation();
      userMenu.classList.toggle('active');
    });

    document.addEventListener('click', () => {
      userMenu.classList.remove('active');
    });
  }

  // Logout button
  document.getElementById('btn-logout')?.addEventListener('click', handleLogout);

  // Main CTA button
  document.getElementById('main-cta-btn')?.addEventListener('click', handleMainCtaClick);

  // Share / QR Modal (מופעל מכפתור ה-Header)
  document.getElementById('btn-share-qr')?.addEventListener('click', openShareModal);
  document.getElementById('modal-share-close')?.addEventListener('click', closeShareModal);
  document.getElementById('btn-copy-url')?.addEventListener('click', copyShareUrl);
  document.getElementById('btn-print-qr')?.addEventListener('click', printQrSticker);

  // Return button in floating widget
  document.getElementById('widget-return-btn')?.addEventListener('click', handleReturnClick);

  // Borrow Modal buttons
  document.getElementById('modal-btn-take')?.addEventListener('click', confirmBorrow);
  document.getElementById('modal-btn-cancel')?.addEventListener('click', cancelBorrow);

  // Admin Single Reset Modal buttons
  document.getElementById('modal-admin-btn-confirm')?.addEventListener('click', confirmAdminSingleReset);
  document.getElementById('modal-admin-btn-cancel')?.addEventListener('click', closeAdminSingleResetModal);

  // Admin Reset All Modal buttons
  document.getElementById('admin-release-all-btn')?.addEventListener('click', openAdminResetAllModal);
  document.getElementById('modal-reset-all-confirm')?.addEventListener('click', confirmAdminResetAll);
  document.getElementById('modal-reset-all-cancel')?.addEventListener('click', closeAdminResetAllModal);
});
