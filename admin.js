/* ==========================================================================
   MJSD MECHANICS | ADMINISTRATIVE CONTROL PORTAL LOGIC ENGINE
   ========================================================================== */

// No mock/seed data — the dashboard starts empty and fills with real
// customer bookings & inquiries and staff-entered inventory/finance records.

// App State
let bookings = [];
let inquiries = [];
let galleryItems = [];
let uploadedImgBase64 = "";

// ===== SHARED HELPERS =====
// Escape for safe innerHTML rendering of staff-entered data.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}
function uid(prefix) {
  return prefix + '-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
}
// Tanzanian Shilling formatting.
function fmtTZS(n) {
  return 'TZS ' + (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
// Local YYYY-MM-DD (matches <input type="date"> values; avoids the UTC shift
// that toISOString() introduces for timezones behind UTC).
function ymdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function randSalt() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function hashWithSalt(salt, secret) {
  return sha256(salt + ':' + secret);
}

// One-time removal of previously-seeded demo data (for browsers that ran an
// earlier build). Strips known sample IDs and the old Unsplash gallery mock,
// while preserving any real records staff have added.
function purgeSeedData() {
  if (localStorage.getItem('mjsd_seed_purged')) return;
  const demoIds = {
    mjsd_bookings: ['BK-982173', 'BK-472091', 'BK-104928'],
    mjsd_inquiries: ['INQ-481920', 'INQ-882103'],
    mjsd_inventory: ['INV-OIL5W30', 'INV-BRKPAD', 'INV-OILFILT', 'INV-BATT'],
    mjsd_transactions: ['TX-1001', 'TX-1002', 'TX-1003', 'TX-1004', 'TX-1005', 'TX-1006', 'TX-1007']
  };
  Object.entries(demoIds).forEach(([key, ids]) => {
    try {
      const arr = JSON.parse(localStorage.getItem(key));
      if (Array.isArray(arr)) localStorage.setItem(key, JSON.stringify(arr.filter(x => !ids.includes(x.id))));
    } catch (e) { /* ignore */ }
  });
  try {
    const g = JSON.parse(localStorage.getItem('mjsd_gallery'));
    if (Array.isArray(g)) localStorage.setItem('mjsd_gallery', JSON.stringify(g.filter(it => !String(it.img || '').includes('unsplash.com'))));
  } catch (e) { /* ignore */ }
  localStorage.setItem('mjsd_seed_purged', '1');
}

// Initialize Dashboard
document.addEventListener("DOMContentLoaded", async () => {
  purgeSeedData();
  await seedAccountsIfEmpty();
  initTabs();
  loadAllData();
  initUploader();
  initSiteImages();
  await initAuth();
});

// ===== STAFF PORTAL AUTHENTICATION (multi-account) =====
// NOTE: This is a static site with no backend. Accounts, password hashes and
// sessions all live in the browser. Passwords are stored only as salted
// SHA-256 hashes (never plaintext), but client-side auth can always be
// bypassed by a determined local user — it gates the UI, it is not a security
// boundary. For real security you would move auth to a server.
const ACCOUNTS_KEY = 'mjsd_staff_accounts';
const SESSION_KEY = 'mjsd_session';
const PASSWORD_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const STAFF_ROLES = ['Admin', 'Mechanic', 'Receptionist'];

let currentUser = null;     // the logged-in account
let _pendingUser = null;    // account awaiting a forced password change (expired)

function getAccounts() { try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY)) || []; } catch (e) { return []; } }
function saveAccounts(a) { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(a)); }
function findAccountByEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  return getAccounts().find(a => a.email === e);
}
function countActiveAdmins() { return getAccounts().filter(a => a.role === 'Admin' && a.active).length; }

function passwordDaysLeft(acc) {
  const set = new Date(acc.passwordSetAt || 0).getTime();
  return Math.ceil((set + PASSWORD_TTL_MS - Date.now()) / (24 * 60 * 60 * 1000));
}
function isPasswordExpired(acc) {
  return (new Date(acc.passwordSetAt || 0).getTime() + PASSWORD_TTL_MS) < Date.now();
}

// Seed a default Admin on first run so the portal is reachable.
async function seedAccountsIfEmpty() {
  if (getAccounts().length) return;
  const salt = randSalt();
  const saSalt = randSalt();
  const admin = {
    id: uid('USR'),
    name: 'MJSD Admin',
    email: 'admin@mjsdmechanics.com',
    role: 'Admin',
    salt,
    passHash: await hashWithSalt(salt, 'mjsd2026'),
    passwordSetAt: new Date().toISOString(),
    securityQuestion: 'In which town is the workshop located?',
    securityAnswerSalt: saSalt,
    securityAnswerHash: await hashWithSalt(saSalt, 'morogoro'),
    active: true,
    createdAt: new Date().toISOString()
  };
  saveAccounts([admin]);
}

function getLoginAttempts() {
  return JSON.parse(sessionStorage.getItem('mjsd_login_attempts') || '{"count":0,"lockedUntil":0}');
}
function setLoginAttempts(data) {
  sessionStorage.setItem('mjsd_login_attempts', JSON.stringify(data));
}

function setSession(acc) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({
    userId: acc.id, role: acc.role, name: acc.name, email: acc.email, loginAt: Date.now()
  }));
}
function getSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (e) { return null; } }

// --- Login overlay view switching ---
function showLoginView(view) {
  document.querySelectorAll('.login-view').forEach(v => v.classList.add('hidden'));
  const el = document.getElementById('view-' + view);
  if (el) el.classList.remove('hidden');
}

function enterDashboard(acc) {
  currentUser = acc;
  setSession(acc);
  const overlay = document.getElementById('adminLoginOverlay');
  const layout = document.querySelector('.admin-layout');
  if (overlay) overlay.classList.add('hidden');
  if (layout) layout.classList.remove('hidden');
  applyRoleGating(acc.role);
  updateAccountUI();
  loadAllData();
}

// Show/hide admin-only navigation + areas based on role.
function applyRoleGating(role) {
  const isAdmin = role === 'Admin';
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });
  // If a non-admin is somehow on an admin tab, bounce to overview.
  if (!isAdmin) {
    const active = document.querySelector('.admin-tab-content.active');
    if (active && ['tab-inventory', 'tab-staff', 'tab-accounting'].includes(active.id)) {
      switchTab('overview');
    }
  }
}

function updateAccountUI() {
  if (!currentUser) return;
  const nameEl = document.getElementById('sidebarUserName');
  const roleEl = document.getElementById('sidebarUserRole');
  const expEl = document.getElementById('sidebarPassExp');
  if (nameEl) nameEl.textContent = currentUser.name;
  if (roleEl) roleEl.textContent = currentUser.role;
  if (expEl) {
    const left = passwordDaysLeft(currentUser);
    expEl.textContent = left <= 0 ? 'Password expired' : `Password expires in ${left} day${left === 1 ? '' : 's'}`;
    expEl.style.color = left <= 5 ? 'var(--status-cancelled)' : 'var(--gray)';
  }
}

async function initAuth() {
  const loginForm = document.getElementById('adminLoginForm');
  const emailInput = document.getElementById('loginEmail');
  const passwordInput = document.getElementById('loginPassword');
  const errorMsg = document.getElementById('loginError');

  // Resume an existing session if the account still exists & is active.
  const sess = getSession();
  if (sess) {
    const acc = getAccounts().find(a => a.id === sess.userId);
    if (acc && acc.active && !isPasswordExpired(acc)) {
      enterDashboard(acc);
    } else {
      sessionStorage.removeItem(SESSION_KEY);
      showLoginView('login');
    }
  } else {
    showLoginView('login');
  }

  // --- Login submit ---
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const attempts = getLoginAttempts();
      const now = Date.now();
      if (attempts.lockedUntil > now) {
        const m = Math.ceil((attempts.lockedUntil - now) / 60000);
        return showLoginError(errorMsg, passwordInput, `🔒 Too many failed attempts. Locked for ${m} more minute(s).`);
      }

      const email = (emailInput.value || '').trim().toLowerCase();
      const pass = (passwordInput.value || '').trim();
      if (!email || !pass) return;

      const acc = findAccountByEmail(email);
      const ok = acc && acc.active && (await hashWithSalt(acc.salt, pass)) === acc.passHash;

      if (!ok) {
        const newCount = (attempts.count || 0) + 1;
        const lockedUntil = newCount >= MAX_LOGIN_ATTEMPTS ? now + LOCKOUT_DURATION_MS : 0;
        setLoginAttempts({ count: newCount, lockedUntil });
        const msg = lockedUntil
          ? '🔒 Too many failed attempts. Locked for 30 minutes.'
          : `❌ Invalid email or password. ${MAX_LOGIN_ATTEMPTS - newCount} attempt(s) remaining.`;
        return showLoginError(errorMsg, passwordInput, msg);
      }

      // Success
      setLoginAttempts({ count: 0, lockedUntil: 0 });
      if (errorMsg) errorMsg.style.display = 'none';
      passwordInput.value = '';

      if (isPasswordExpired(acc)) {
        _pendingUser = acc;
        showLoginView('expired');
        return;
      }
      enterDashboard(acc);
    });
  }

  // --- Forgot password flow ---
  const forgotLink = document.getElementById('forgotLink');
  if (forgotLink) forgotLink.addEventListener('click', (e) => { e.preventDefault(); resetForgotFlow(); showLoginView('forgot'); });
  document.querySelectorAll('.backToLogin').forEach(b => b.addEventListener('click', (e) => { e.preventDefault(); showLoginView('login'); }));

  const forgotStep1 = document.getElementById('forgotStep1Form');
  if (forgotStep1) {
    forgotStep1.addEventListener('submit', (e) => {
      e.preventDefault();
      const err = document.getElementById('forgotError');
      const acc = findAccountByEmail(document.getElementById('forgotEmail').value);
      if (!acc || !acc.active) { return showInlineError(err, 'No active account found for that email.'); }
      if (!acc.securityQuestion) { return showInlineError(err, 'This account has no security question. Ask an Admin to reset it.'); }
      err.style.display = 'none';
      document.getElementById('forgotQuestionText').textContent = acc.securityQuestion;
      document.getElementById('forgotEmailHidden').value = acc.email;
      document.getElementById('forgotStep1').classList.add('hidden');
      document.getElementById('forgotStep2').classList.remove('hidden');
    });
  }
  const forgotStep2 = document.getElementById('forgotStep2Form');
  if (forgotStep2) {
    forgotStep2.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.getElementById('forgotError');
      const acc = findAccountByEmail(document.getElementById('forgotEmailHidden').value);
      if (!acc) return showInlineError(err, 'Account not found.');
      const answer = document.getElementById('forgotAnswer').value.trim().toLowerCase();
      const np = document.getElementById('forgotNew').value;
      const cp = document.getElementById('forgotConfirm').value;
      const aHash = await hashWithSalt(acc.securityAnswerSalt, answer);
      if (aHash !== acc.securityAnswerHash) return showInlineError(err, 'Security answer is incorrect.');
      const pwErr = validatePassword(np, cp);
      if (pwErr) return showInlineError(err, pwErr);
      await setAccountPassword(acc.id, np);
      alert('✅ Password updated. You can now sign in with your new password.');
      showLoginView('login');
    });
  }

  // --- Forced change on expiry ---
  const expiredForm = document.getElementById('expiredForm');
  if (expiredForm) {
    expiredForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.getElementById('expiredError');
      if (!_pendingUser) return showLoginView('login');
      const np = document.getElementById('expiredNew').value;
      const cp = document.getElementById('expiredConfirm').value;
      const pwErr = validatePassword(np, cp);
      if (pwErr) return showInlineError(err, pwErr);
      await setAccountPassword(_pendingUser.id, np);
      const fresh = getAccounts().find(a => a.id === _pendingUser.id);
      _pendingUser = null;
      enterDashboard(fresh);
    });
  }

  // --- Logout ---
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (confirm('Sign out of the staff portal?')) {
        sessionStorage.removeItem(SESSION_KEY);
        window.location.reload();
      }
    });
  }

  // --- Change my password ---
  const changePwBtn = document.getElementById('changePwBtn');
  if (changePwBtn) changePwBtn.addEventListener('click', (e) => { e.preventDefault(); openChangePasswordModal(); });
}

function resetForgotFlow() {
  const s1 = document.getElementById('forgotStep1');
  const s2 = document.getElementById('forgotStep2');
  if (s1) s1.classList.remove('hidden');
  if (s2) s2.classList.add('hidden');
  ['forgotEmail', 'forgotAnswer', 'forgotNew', 'forgotConfirm'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const err = document.getElementById('forgotError'); if (err) err.style.display = 'none';
}

function validatePassword(np, cp) {
  if (!np || np.length < 6) return 'Password must be at least 6 characters.';
  if (np !== cp) return 'Passwords do not match.';
  return null;
}

// Hash + persist a new password and refresh the expiry clock.
async function setAccountPassword(userId, newPassword) {
  const accounts = getAccounts();
  const i = accounts.findIndex(a => a.id === userId);
  if (i < 0) return false;
  const salt = randSalt();
  accounts[i].salt = salt;
  accounts[i].passHash = await hashWithSalt(salt, newPassword);
  accounts[i].passwordSetAt = new Date().toISOString();
  saveAccounts(accounts);
  if (currentUser && currentUser.id === userId) { currentUser = accounts[i]; updateAccountUI(); }
  return true;
}

function showLoginError(errorMsg, input, text) {
  if (errorMsg) { errorMsg.textContent = text; errorMsg.style.display = 'block'; }
  if (input) {
    input.style.borderColor = 'var(--status-cancelled)';
    input.style.transform = 'translateX(5px)';
    setTimeout(() => input.style.transform = 'translateX(-5px)', 70);
    setTimeout(() => input.style.transform = 'translateX(5px)', 140);
    setTimeout(() => { input.style.transform = ''; input.style.borderColor = ''; }, 210);
  }
}
function showInlineError(el, text) { if (el) { el.textContent = text; el.style.display = 'block'; } }

// ===== REUSABLE ADMIN MODAL =====
function openAdminModal(title, bodyHTML) {
  const root = document.getElementById('adminModalRoot');
  if (!root) return;
  root.innerHTML = `
    <div class="admin-modal-overlay" id="adminModalOverlay">
      <div class="admin-modal-card">
        <button type="button" class="admin-modal-close" id="adminModalClose" aria-label="Close">×</button>
        <h3 class="admin-modal-title">${esc(title)}</h3>
        ${bodyHTML}
      </div>
    </div>`;
  const ov = document.getElementById('adminModalOverlay');
  requestAnimationFrame(() => ov.classList.add('show'));
  ov.addEventListener('click', (e) => { if (e.target === ov) closeAdminModal(); });
  document.getElementById('adminModalClose').addEventListener('click', closeAdminModal);
}
function closeAdminModal() {
  const ov = document.getElementById('adminModalOverlay');
  if (!ov) return;
  ov.classList.remove('show');
  setTimeout(() => { const r = document.getElementById('adminModalRoot'); if (r) r.innerHTML = ''; }, 250);
}

function openChangePasswordModal() {
  openAdminModal('Change My Password', `
    <form id="changePwForm" class="admin-modal-form">
      <label>Current Password</label>
      <input type="password" id="cpCurrent" required autocomplete="current-password" />
      <label>New Password</label>
      <input type="password" id="cpNew" required autocomplete="new-password" />
      <label>Confirm New Password</label>
      <input type="password" id="cpConfirm" required autocomplete="new-password" />
      <p class="modal-err" id="cpErr" style="display:none"></p>
      <div class="admin-modal-actions">
        <button type="button" class="btn-ghost" onclick="closeAdminModal()">Cancel</button>
        <button type="submit" class="btn-primary">Update Password</button>
      </div>
    </form>`);
  document.getElementById('changePwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('cpErr');
    const cur = document.getElementById('cpCurrent').value;
    const np = document.getElementById('cpNew').value;
    const cp = document.getElementById('cpConfirm').value;
    const fresh = getAccounts().find(a => a.id === currentUser.id);
    if ((await hashWithSalt(fresh.salt, cur)) !== fresh.passHash) return showInlineError(err, 'Current password is incorrect.');
    const pwErr = validatePassword(np, cp);
    if (pwErr) return showInlineError(err, pwErr);
    await setAccountPassword(currentUser.id, np);
    closeAdminModal();
    alert('✅ Your password has been updated.');
  });
}

// ===== DYNAMIC TAB SWITCHING =====
function initTabs() {
  const navItems = document.querySelectorAll(".sidebar-nav .nav-item:not(.return-btn)");
  navItems.forEach(item => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      const tabId = item.getAttribute("data-tab");
      switchTab(tabId);
    });
  });

  // Honor a deep-link / reload to a specific tab (e.g. admin.html#uploader)
  const hashTab = (location.hash || "").replace("#", "");
  const validTabs = Array.from(navItems).map(i => i.getAttribute("data-tab"));
  if (hashTab && validTabs.includes(hashTab)) switchTab(hashTab);
}

function switchTab(tabId) {
  // Update nav item active state
  document.querySelectorAll(".sidebar-nav .nav-item").forEach(btn => {
    if (btn.getAttribute("data-tab") === tabId) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  // Update visible section
  document.querySelectorAll(".admin-tab-content").forEach(section => {
    section.classList.remove("active");
  });
  
  const targetSection = document.getElementById(`tab-${tabId}`);
  if (targetSection) {
    targetSection.classList.add("active");
  }

  // Update Page Header Title
  const pageTitle = document.getElementById("pageTitle");
  const pageDescription = document.getElementById("pageDescription");
  
  const titles = {
    overview:   ["Overview", "Real-time status overview of MJSD Mechanics workshop"],
    bookings:   ["Appointments", "Review, schedule and coordinate customer service bookings"],
    messages:   ["Customer Messages", "Read and respond to inquiries sent from the website contact form"],
    uploader:   ["Gallery Portfolio Manager", "Publish vehicle photos directly to the main customer website"],
    inventory:  ["Inventory Management", "Track parts, fluids and consumables stock for the workshop"],
    staff:      ["Staff Management", "Manage staff accounts, roles and passwords"],
    accounting: ["Accounting", "Record income & expenses and monitor workshop finances"]
  };
  if (titles[tabId]) {
    pageTitle.textContent = titles[tabId][0];
    pageDescription.textContent = titles[tabId][1];
  }
}

// ===== DATA LOADING AND REDRAWING =====
function loadAllData() {
  // Real data only — bookings & inquiries come from the public website forms.
  bookings = JSON.parse(localStorage.getItem("mjsd_bookings")) || [];
  inquiries = JSON.parse(localStorage.getItem("mjsd_inquiries")) || [];
  // Gallery is seeded by the public site (real workshop images); read-only here.
  galleryItems = JSON.parse(localStorage.getItem("mjsd_gallery")) || [];

  // Load extended modules
  loadInventory();
  loadTransactions();

  // Redraw all components
  updateCounters();
  renderOverviewBookings();
  renderOverviewInbox();
  renderFullBookingsTable();
  renderFullInboxList();
  renderAdminGallery();
  renderInventory();
  renderAccounting();
  renderStaff();
}

function updateCounters() {
  const pendingCount = bookings.filter(b => b.status === "Pending").length;
  const unreadMessagesCount = inquiries.filter(i => i.status === "Unread").length;

  // Sidebar badges
  const bookingsBadge = document.getElementById("bookingsCountBadge");
  const messagesBadge = document.getElementById("messagesCountBadge");
  
  if (bookingsBadge) {
    bookingsBadge.textContent = pendingCount;
    bookingsBadge.style.display = pendingCount > 0 ? "inline-block" : "none";
  }
  if (messagesBadge) {
    messagesBadge.textContent = unreadMessagesCount;
    messagesBadge.style.display = unreadMessagesCount > 0 ? "inline-block" : "none";
  }

  // Stat Widgets
  document.getElementById("statTotalBookings").textContent = bookings.length;
  document.getElementById("statPendingBookings").textContent = pendingCount;
  document.getElementById("statTotalInquiries").textContent = inquiries.length;
  document.getElementById("statTotalPhotos").textContent = galleryItems.length;
  
  const galleryCountText = document.getElementById("galleryCountText");
  if (galleryCountText) galleryCountText.textContent = galleryItems.length;
}

// ===== RENDER OVERVIEW TAB =====
function renderOverviewBookings() {
  const tbody = document.getElementById("recentBookingsTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  
  // Show first 4 bookings
  const slice = bookings.slice(0, 4);
  
  if (slice.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--gray)">No appointments scheduled yet.</td></tr>`;
    return;
  }

  slice.forEach(booking => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${booking.fname} ${booking.lname}</strong></td>
      <td>${booking.vehicle}</td>
      <td><span style="color:var(--red-light); font-weight:500;">${booking.service}</span></td>
      <td>${booking.date} | ${booking.time}</td>
      <td><span class="status-badge ${booking.status.toLowerCase()}">${booking.status}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderOverviewInbox() {
  const container = document.getElementById("recentInboxList");
  if (!container) return;
  container.innerHTML = "";

  const slice = inquiries.slice(0, 3);
  
  if (slice.length === 0) {
    container.innerHTML = `<p style="text-align:center; color:var(--gray); margin-top:2rem;">Your inbox is clean!</p>`;
    return;
  }

  slice.forEach(inquiry => {
    const item = document.createElement("div");
    item.className = "inbox-card";
    if (inquiry.status === "Unread") {
      item.style.borderLeft = "3px solid var(--red)";
    }
    item.innerHTML = `
      <div class="inbox-card-header">
        <div class="inbox-sender">
          <h4>${inquiry.name}</h4>
          <span>${inquiry.createdAt.split(",")[0]}</span>
        </div>
      </div>
      <div class="inbox-subject">${inquiry.subject}</div>
      <div class="inbox-body">${inquiry.message.slice(0, 70)}...</div>
    `;
    container.appendChild(item);
  });
}

// ===== RENDER FULL BOOKINGS TABLE =====
function renderFullBookingsTable() {
  const tbody = document.getElementById("fullBookingsTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (bookings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--gray)">No bookings found.</td></tr>`;
    return;
  }

  bookings.forEach(booking => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><code style="color:var(--red-light); font-weight:600;">${booking.id}</code></td>
      <td><strong>${booking.fname} ${booking.lname}</strong></td>
      <td><a href="tel:${booking.phone}" style="color:#fff; text-decoration:none; font-weight:500;">📞 ${booking.phone}</a></td>
      <td>${booking.vehicle}</td>
      <td>${booking.service}</td>
      <td><strong>${booking.date}</strong> at ${booking.time}</td>
      <td><span class="status-badge ${booking.status.toLowerCase()}">${booking.status}</span></td>
      <td>
        <select class="action-select" onchange="updateBookingStatus('${booking.id}', this.value)">
          <option value="Pending" ${booking.status === 'Pending' ? 'selected' : ''}>⏳ Pending</option>
          <option value="Confirmed" ${booking.status === 'Confirmed' ? 'selected' : ''}>💙 Confirm</option>
          <option value="Completed" ${booking.status === 'Completed' ? 'selected' : ''}>👍 Complete</option>
          <option value="Cancelled" ${booking.status === 'Cancelled' ? 'selected' : ''}>✗ Cancel</option>
          <option value="DELETE">🗑 Delete</option>
        </select>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function updateBookingStatus(id, newStatus) {
  if (newStatus === "DELETE") {
    if (confirm("Are you sure you want to delete this booking history?")) {
      bookings = bookings.filter(b => b.id !== id);
    } else {
      loadAllData();
      return;
    }
  } else {
    bookings = bookings.map(b => {
      if (b.id === id) {
        return { ...b, status: newStatus };
      }
      return b;
    });
  }
  localStorage.setItem("mjsd_bookings", JSON.stringify(bookings));
  loadAllData();
}

function filterBookingsTable() {
  const query = document.getElementById("bookingSearchInput").value.toLowerCase();
  const service = document.getElementById("bookingServiceFilter").value;
  const status = document.getElementById("bookingStatusFilter").value;

  const tbody = document.getElementById("fullBookingsTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const filtered = bookings.filter(b => {
    const matchesSearch = 
      b.fname.toLowerCase().includes(query) ||
      b.lname.toLowerCase().includes(query) ||
      b.phone.includes(query) ||
      b.id.toLowerCase().includes(query) ||
      b.vehicle.toLowerCase().includes(query);
      
    const matchesService = service === "all" || b.service === service;
    const matchesStatus = status === "all" || b.status === status;

    return matchesSearch && matchesService && matchesStatus;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--gray)">No matching appointments found.</td></tr>`;
    return;
  }

  filtered.forEach(booking => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><code style="color:var(--red-light); font-weight:600;">${booking.id}</code></td>
      <td><strong>${booking.fname} ${booking.lname}</strong></td>
      <td><a href="tel:${booking.phone}" style="color:#fff; text-decoration:none; font-weight:500;">📞 ${booking.phone}</a></td>
      <td>${booking.vehicle}</td>
      <td>${booking.service}</td>
      <td><strong>${booking.date}</strong> at ${booking.time}</td>
      <td><span class="status-badge ${booking.status.toLowerCase()}">${booking.status}</span></td>
      <td>
        <select class="action-select" onchange="updateBookingStatus('${booking.id}', this.value)">
          <option value="Pending" ${booking.status === 'Pending' ? 'selected' : ''}>⏳ Pending</option>
          <option value="Confirmed" ${booking.status === 'Confirmed' ? 'selected' : ''}>💙 Confirm</option>
          <option value="Completed" ${booking.status === 'Completed' ? 'selected' : ''}>👍 Complete</option>
          <option value="Cancelled" ${booking.status === 'Cancelled' ? 'selected' : ''}>✗ Cancel</option>
          <option value="DELETE">🗑 Delete</option>
        </select>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ===== RENDER FULL MESSAGES INBOX =====
function renderFullInboxList() {
  const container = document.getElementById("fullInboxList");
  if (!container) return;
  container.innerHTML = "";

  if (inquiries.length === 0) {
    container.innerHTML = `<p style="text-align:center; color:var(--gray); grid-column: 1/-1; padding: 3rem 0;">Your messages inbox is empty!</p>`;
    return;
  }

  inquiries.forEach(inquiry => {
    const card = document.createElement("div");
    card.className = "inbox-card";
    
    if (inquiry.status === "Unread") {
      card.style.borderLeft = "3px solid var(--red)";
      card.style.background = "rgba(255, 255, 255, 0.03)";
    }

    card.innerHTML = `
      <div class="inbox-card-header">
        <div class="inbox-sender">
          <h4>${inquiry.name}</h4>
          <span style="font-size: .8rem; color:var(--gray);">Received: ${inquiry.createdAt}</span>
        </div>
      </div>
      <div class="inbox-subject">${inquiry.subject}</div>
      <p style="color:#ddd; font-size:0.9rem; line-height: 1.5; margin: .5rem 0 1rem 0;">${inquiry.message}</p>
      <div style="font-size:.8rem; margin-bottom: 1.2rem; color:var(--gray);">
        Phone: <a href="tel:${inquiry.phone}" style="color:#fff; text-decoration:none;"><strong>${inquiry.phone}</strong></a>
      </div>
      <div class="inbox-actions">
        ${inquiry.status === "Unread" ? `<button class="btn-sm-dismiss" onclick="markMessageRead('${inquiry.id}')" style="background:var(--bg-green-glow); color:var(--status-completed); border-color:rgba(46,204,113,0.3)">✓ Mark Read</button>` : ''}
        <button class="btn-sm-dismiss" onclick="deleteMessage('${inquiry.id}')">🗑 Delete</button>
      </div>
    `;
    container.appendChild(card);
  });
}

function markMessageRead(id) {
  inquiries = inquiries.map(i => {
    if (i.id === id) return { ...i, status: "Read" };
    return i;
  });
  localStorage.setItem("mjsd_inquiries", JSON.stringify(inquiries));
  loadAllData();
}

function deleteMessage(id) {
  if (confirm("Are you sure you want to permanently delete this message?")) {
    inquiries = inquiries.filter(i => i.id !== id);
    localStorage.setItem("mjsd_inquiries", JSON.stringify(inquiries));
    loadAllData();
  }
}

// ===== RENDER GALLERY AND UPLOAD SYSTEM =====
function renderAdminGallery() {
  const container = document.getElementById("adminGalleryGrid");
  if (!container) return;
  container.innerHTML = "";

  galleryItems.forEach((item, index) => {
    const div = document.createElement("div");
    div.className = "admin-gallery-item animate visible";
    div.innerHTML = `
      <img src="${item.img}" alt="${item.alt}" onerror="this.src='https://placehold.co/200x150/16213e/ffffff?text=${encodeURIComponent(item.title)}'">
      <div class="admin-gallery-overlay">
        <div class="admin-gallery-title">${item.title}</div>
        <button class="btn-delete-img" onclick="deleteGalleryItem(${index})">🗑 Delete</button>
      </div>
    `;
    container.appendChild(div);
  });
}

function deleteGalleryItem(index) {
  if (confirm(`Are you sure you want to delete "${galleryItems[index].title}" from the live gallery?`)) {
    galleryItems.splice(index, 1);
    localStorage.setItem("mjsd_gallery", JSON.stringify(galleryItems));
    loadAllData();
  }
}

// ===== UPLOAD DRAG-AND-DROP FILE UPLOADER =====
function initUploader() {
  const uploadZone = document.getElementById('uploadZone');
  const imageInput = document.getElementById('imageInput');
  const uploadPreview = document.getElementById('uploadPreview');
  const adminUploadForm = document.getElementById('adminUploadForm');

  if (uploadZone && imageInput) {
    uploadZone.addEventListener('click', () => imageInput.click());
    
    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadZone.style.borderColor = 'var(--red-light)';
    });
    
    uploadZone.addEventListener('dragleave', () => {
      uploadZone.style.borderColor = '';
    });
    
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.style.borderColor = '';
      const file = e.dataTransfer.files[0];
      if (file) handleUploadFile(file);
    });
    
    imageInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleUploadFile(file);
    });
  }

  function handleUploadFile(file) {
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('Image size exceeds 5MB. Please choose a smaller file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      uploadedImgBase64 = e.target.result;
      if (uploadPreview) {
        uploadPreview.style.backgroundImage = `url(${uploadedImgBase64})`;
        uploadPreview.classList.add('has-img');
      }
    };
    reader.readAsDataURL(file);
  }

  if (adminUploadForm) {
    adminUploadForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = document.getElementById('uploadTitle').value;
      const cat = document.getElementById('uploadCategory').value;
      
      if (!uploadedImgBase64) {
        alert('Please select or drop a photo first.');
        return;
      }
      
      const newItem = {
        cat: cat,
        img: uploadedImgBase64,
        alt: title,
        title: title
      };
      
      galleryItems.unshift(newItem); // Add new item at the top
      localStorage.setItem('mjsd_gallery', JSON.stringify(galleryItems));
      
      // Reset form
      adminUploadForm.reset();
      if (uploadPreview) {
        uploadPreview.classList.remove('has-img');
        uploadPreview.style.backgroundImage = '';
      }
      uploadedImgBase64 = "";
      
      // Reload UI
      loadAllData();
      alert("🎉 Image uploaded and published live in the customer gallery!");
    });
  }
}

/* ==========================================================================
   SITE IMAGES MANAGER
   Lets staff replace fixed site imagery (hero, service cards, team photo)
   with real photos. Stored compressed in localStorage['mjsd_site_images'];
   the main site reads this on load (see applySiteImageOverrides in script.js).
   ========================================================================== */

// Slot definitions — keys MUST match those in script.js applySiteImageOverrides().
const SITE_IMAGE_SLOTS = [
  { key: 'hero',       label: 'Hero Banner Background', def: 'images/hero_banner.jpg' },
  { key: 'svc_engine', label: 'Service · Engine Diagnosis', def: 'engine_diagnosis.png' },
  { key: 'svc_brakes', label: 'Service · Brakes & Safety',  def: 'brake_service.png' },
  { key: 'svc_oil',    label: 'Service · Oil & Fluid',      def: 'oil_service.png' },
  { key: 'svc_susp',   label: 'Service · Suspension & Repair', def: 'suspension_repair.png' },
  { key: 'svc_maint',  label: 'Service · General Maintenance', def: 'hero_banner.png' },
  { key: 'svc_elec',   label: 'Service · Body & Electrical', def: 'team_photo.png' },
  { key: 'team',       label: 'Team Photo (Why Us)',         def: 'team_photo.png' },
];

const SITE_IMAGES_KEY = 'mjsd_site_images';
let _activeSlotKey = null; // which slot a pending file upload belongs to

function getSiteImages() {
  try { return JSON.parse(localStorage.getItem(SITE_IMAGES_KEY)) || {}; }
  catch (e) { return {}; }
}

function saveSiteImages(map) {
  try {
    localStorage.setItem(SITE_IMAGES_KEY, JSON.stringify(map));
    return true;
  } catch (e) {
    alert('Storage limit reached — could not save this image. Try removing some custom images first, or use a smaller photo.');
    return false;
  }
}

// Downscale + compress an image file to a JPEG data-URL so localStorage
// (≈5MB total) is not exhausted. Returns a Promise<string>.
function compressImageFile(file, maxW = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderSiteImages() {
  const grid = document.getElementById('siteImagesGrid');
  if (!grid) return;
  const map = getSiteImages();
  grid.innerHTML = '';

  SITE_IMAGE_SLOTS.forEach(slot => {
    const overridden = !!map[slot.key];
    const src = overridden ? map[slot.key] : slot.def;

    const card = document.createElement('div');
    card.className = 'site-image-slot';

    const thumb = document.createElement('div');
    thumb.className = 'site-image-thumb';
    thumb.style.backgroundImage = `url("${src}")`;
    if (overridden) {
      const tag = document.createElement('span');
      tag.className = 'custom-tag';
      tag.textContent = 'Custom';
      thumb.appendChild(tag);
    }

    const meta = document.createElement('div');
    meta.className = 'site-image-meta';

    const label = document.createElement('span');
    label.className = 'site-image-label';
    label.textContent = slot.label;

    const actions = document.createElement('div');
    actions.className = 'site-image-actions';

    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'btn-slot-upload';
    uploadBtn.textContent = overridden ? 'Replace' : 'Upload';
    uploadBtn.addEventListener('click', () => triggerSiteUpload(slot.key));
    actions.appendChild(uploadBtn);

    if (overridden) {
      const resetBtn = document.createElement('button');
      resetBtn.className = 'btn-slot-reset';
      resetBtn.title = 'Reset to default placeholder';
      resetBtn.textContent = '↺';
      resetBtn.addEventListener('click', () => resetSiteImage(slot.key, slot.label));
      actions.appendChild(resetBtn);
    }

    meta.appendChild(label);
    meta.appendChild(actions);
    card.appendChild(thumb);
    card.appendChild(meta);
    grid.appendChild(card);
  });
}

function triggerSiteUpload(slotKey) {
  _activeSlotKey = slotKey;
  const input = document.getElementById('siteImageInput');
  if (input) { input.value = ''; input.click(); }
}

function resetSiteImage(slotKey, label) {
  if (!confirm(`Reset "${label}" back to the default placeholder image?`)) return;
  const map = getSiteImages();
  delete map[slotKey];
  saveSiteImages(map);
  renderSiteImages();
}

function initSiteImages() {
  const input = document.getElementById('siteImageInput');
  if (input) {
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file || !_activeSlotKey) return;
      if (!file.type.startsWith('image/')) { alert('Please select an image file.'); return; }
      if (file.size > 5 * 1024 * 1024) { alert('Image exceeds 5MB. Please choose a smaller file.'); return; }
      try {
        const dataUrl = await compressImageFile(file);
        const map = getSiteImages();
        map[_activeSlotKey] = dataUrl;
        if (saveSiteImages(map)) {
          renderSiteImages();
          alert('✅ Image published live on the website.');
        }
      } catch (err) {
        alert('Could not process that image. Please try a different file.');
      } finally {
        _activeSlotKey = null;
      }
    });
  }
  renderSiteImages();
}

/* ==========================================================================
   INVENTORY MANAGEMENT
   Parts / fluids / consumables stock. Stored in mjsd_inventory.
   ========================================================================== */
const INVENTORY_KEY = 'mjsd_inventory';
const INV_CATEGORIES = ['Engine', 'Brakes', 'Suspension', 'Fluids & Oils', 'Electrical', 'Filters', 'Tyres', 'Consumables', 'Other'];
let inventory = [];

function loadInventory() {
  // Starts empty; staff add their own parts/stock.
  inventory = JSON.parse(localStorage.getItem(INVENTORY_KEY)) || [];
}
function saveInventory() { localStorage.setItem(INVENTORY_KEY, JSON.stringify(inventory)); }

function renderInventory(filterQuery) {
  const tbody = document.getElementById('inventoryTableBody');
  if (!tbody) return;
  const q = (filterQuery != null ? filterQuery : (document.getElementById('inventorySearch') || {}).value || '').toLowerCase();

  // Summary widgets
  const totalValue = inventory.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);
  const lowStock = inventory.filter(it => Number(it.quantity) <= Number(it.reorderLevel));
  setText('invTotalItems', inventory.length);
  setText('invStockValue', fmtTZS(totalValue));
  setText('invLowStock', lowStock.length);

  const lowBadge = document.getElementById('inventoryLowBadge');
  if (lowBadge) {
    lowBadge.textContent = lowStock.length;
    lowBadge.style.display = lowStock.length > 0 ? 'inline-block' : 'none';
  }

  const rows = inventory.filter(it =>
    !q || it.name.toLowerCase().includes(q) || (it.sku || '').toLowerCase().includes(q) ||
    (it.category || '').toLowerCase().includes(q) || (it.supplier || '').toLowerCase().includes(q)
  );

  tbody.innerHTML = '';
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--gray)">No inventory items found.</td></tr>`;
    return;
  }
  rows.forEach(it => {
    const low = Number(it.quantity) <= Number(it.reorderLevel);
    const tr = document.createElement('tr');
    if (low) tr.style.background = 'rgba(239,68,68,0.06)';
    tr.innerHTML = `
      <td><strong>${esc(it.name)}</strong><br><code style="color:var(--gray);font-size:.75rem">${esc(it.sku || '—')}</code></td>
      <td>${esc(it.category)}</td>
      <td>${low ? `<span class="status-badge cancelled">${esc(it.quantity)} low</span>` : `<strong>${esc(it.quantity)}</strong>`}</td>
      <td>${fmtTZS(it.unitPrice)}</td>
      <td>${fmtTZS((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0))}</td>
      <td>${esc(it.supplier || '—')}</td>
      <td>
        <button class="btn-sm-dismiss" onclick="openInventoryModal('${esc(it.id)}')">✏️ Edit</button>
        <button class="btn-sm-dismiss" onclick="deleteInventoryItem('${esc(it.id)}')">🗑</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

function openInventoryModal(id) {
  const it = id ? inventory.find(x => x.id === id) : null;
  const opts = INV_CATEGORIES.map(c => `<option ${it && it.category === c ? 'selected' : ''}>${c}</option>`).join('');
  openAdminModal(it ? 'Edit Inventory Item' : 'Add Inventory Item', `
    <form id="invForm" class="admin-modal-form">
      <label>Item Name *</label>
      <input type="text" id="invName" required value="${it ? esc(it.name) : ''}" placeholder="e.g. Engine Oil 5W-30 (5L)" />
      <div class="modal-grid-2">
        <div><label>SKU / Code</label><input type="text" id="invSku" value="${it ? esc(it.sku || '') : ''}" placeholder="OIL-5W30-5L" /></div>
        <div><label>Category *</label><select id="invCategory" required>${opts}</select></div>
      </div>
      <div class="modal-grid-3">
        <div><label>Quantity *</label><input type="number" id="invQty" min="0" required value="${it ? esc(it.quantity) : '0'}" /></div>
        <div><label>Unit Price (TZS) *</label><input type="number" id="invPrice" min="0" required value="${it ? esc(it.unitPrice) : '0'}" /></div>
        <div><label>Reorder Level</label><input type="number" id="invReorder" min="0" value="${it ? esc(it.reorderLevel) : '5'}" /></div>
      </div>
      <label>Supplier</label>
      <input type="text" id="invSupplier" value="${it ? esc(it.supplier || '') : ''}" placeholder="Supplier name" />
      <p class="modal-err" id="invErr" style="display:none"></p>
      <div class="admin-modal-actions">
        <button type="button" class="btn-ghost" onclick="closeAdminModal()">Cancel</button>
        <button type="submit" class="btn-primary">${it ? 'Save Changes' : 'Add Item'}</button>
      </div>
    </form>`);
  document.getElementById('invForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
      name: document.getElementById('invName').value.trim(),
      sku: document.getElementById('invSku').value.trim(),
      category: document.getElementById('invCategory').value,
      quantity: Math.max(0, parseInt(document.getElementById('invQty').value, 10) || 0),
      unitPrice: Math.max(0, parseFloat(document.getElementById('invPrice').value) || 0),
      reorderLevel: Math.max(0, parseInt(document.getElementById('invReorder').value, 10) || 0),
      supplier: document.getElementById('invSupplier').value.trim(),
      updatedAt: new Date().toISOString()
    };
    if (!data.name) return showInlineError(document.getElementById('invErr'), 'Item name is required.');
    if (it) {
      inventory = inventory.map(x => x.id === it.id ? { ...x, ...data } : x);
    } else {
      inventory.unshift({ id: uid('INV'), ...data });
    }
    saveInventory();
    closeAdminModal();
    renderInventory();
  });
}

function deleteInventoryItem(id) {
  const it = inventory.find(x => x.id === id);
  if (!it) return;
  if (confirm(`Delete "${it.name}" from inventory?`)) {
    inventory = inventory.filter(x => x.id !== id);
    saveInventory();
    renderInventory();
  }
}

/* ==========================================================================
   ACCOUNTING — income & expense ledger. Stored in mjsd_transactions.
   ========================================================================== */
const TX_KEY = 'mjsd_transactions';
const INCOME_CATS = ['Service / Labour Revenue', 'Parts Sale', 'Inspection / Diagnostics', 'Other Income'];
// Standard small-workshop expense (chart-of-accounts) categories.
const EXPENSE_CATS = [
  'Parts & Materials', 'Wages & Salaries', 'Rent', 'Utilities', 'Fuel & Transport',
  'Tools & Equipment', 'Repairs & Maintenance', 'Marketing & Advertising', 'Insurance',
  'Licenses & Permits', 'Bank & Mobile Fees', 'Office & Supplies', 'Other Expense'
];
const PAYMENT_METHODS = ['Cash', 'Mobile Money', 'Bank Transfer', 'Card', 'Cheque'];
let transactions = [];

function loadTransactions() {
  // Starts empty; staff record real income & expenses.
  transactions = JSON.parse(localStorage.getItem(TX_KEY)) || [];
}
function saveTransactions() { localStorage.setItem(TX_KEY, JSON.stringify(transactions)); }

// --- Period helpers (This Month / Last Month / This Year / All / Custom) ---
function acctRange() {
  const preset = (document.getElementById('txPeriod') || {}).value || 'month';
  const now = new Date();
  const ymd = ymdLocal;
  let from = null, to = null;
  if (preset === 'month') { from = ymd(new Date(now.getFullYear(), now.getMonth(), 1)); to = ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)); }
  else if (preset === 'lastmonth') { from = ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)); to = ymd(new Date(now.getFullYear(), now.getMonth(), 0)); }
  else if (preset === 'year') { from = ymd(new Date(now.getFullYear(), 0, 1)); to = ymd(new Date(now.getFullYear(), 11, 31)); }
  else if (preset === 'custom') { from = (document.getElementById('txFrom') || {}).value || null; to = (document.getElementById('txTo') || {}).value || null; }
  return { preset, from, to };
}
function txInRange(t, from, to) { const d = t.date || ''; if (from && d < from) return false; if (to && d > to) return false; return true; }
function txSum(arr) { return arr.reduce((s, t) => s + (Number(t.amount) || 0), 0); }
// VAT-inclusive portion of an amount (e.g. 18% VAT inside a gross figure).
function vatPortion(t) { const r = Number(t.vatRate) || 0; return r > 0 ? (Number(t.amount) || 0) * r / (100 + r) : 0; }

function renderAccounting() {
  const tbody = document.getElementById('txTableBody');
  if (!tbody) return;
  const { preset, from, to } = acctRange();

  // Show custom date inputs only for the Custom preset.
  const custom = document.getElementById('txCustomRange');
  if (custom) custom.classList.toggle('hidden', preset !== 'custom');
  const label = document.getElementById('acctPeriodLabel');
  if (label) label.textContent = preset === 'all' ? 'All time'
    : (from && to ? `${from} → ${to}` : (from ? `from ${from}` : (to ? `until ${to}` : 'All time')));

  const periodTx = transactions.filter(t => txInRange(t, from, to));
  const incomeTx = periodTx.filter(t => t.type === 'income');
  const expenseTx = periodTx.filter(t => t.type === 'expense');
  const income = txSum(incomeTx);
  const expense = txSum(expenseTx);
  const net = income - expense;
  const unpaidInc = txSum(incomeTx.filter(t => (t.status || 'Paid') === 'Unpaid'));
  const unpaidExp = txSum(expenseTx.filter(t => (t.status || 'Paid') === 'Unpaid'));
  const vatOut = incomeTx.reduce((s, t) => s + vatPortion(t), 0);
  const vatIn = expenseTx.reduce((s, t) => s + vatPortion(t), 0);

  // Summary widgets
  setText('accIncome', fmtTZS(income));
  setText('accExpense', fmtTZS(expense));
  const netEl = document.getElementById('accNet');
  if (netEl) { netEl.textContent = fmtTZS(net); netEl.style.color = net >= 0 ? 'var(--status-completed)' : 'var(--status-cancelled)'; }
  setText('accOutstanding', fmtTZS(unpaidInc + unpaidExp));

  renderExpenseBreakdown(expenseTx, expense);
  renderPL({ income, expense, net, unpaidInc, unpaidExp, vatOut, vatIn });

  // Transactions table (period + type + search)
  const typeFilter = (document.getElementById('txTypeFilter') || {}).value || 'all';
  const q = ((document.getElementById('txSearch') || {}).value || '').toLowerCase();
  const rows = periodTx
    .filter(t => typeFilter === 'all' || t.type === typeFilter)
    .filter(t => !q || (t.description || '').toLowerCase().includes(q) || (t.category || '').toLowerCase().includes(q) ||
      (t.payee || '').toLowerCase().includes(q) || (t.reference || '').toLowerCase().includes(q))
    .slice()
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  tbody.innerHTML = '';
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--gray)">No transactions for this period.</td></tr>`;
    return;
  }
  rows.forEach(t => {
    const inc = t.type === 'income';
    const status = t.status || 'Paid';
    const sub = [t.payee, t.reference].filter(Boolean).map(esc).join(' · ');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="white-space:nowrap">${esc(t.date || '—')}</td>
      <td><span class="status-badge ${inc ? 'completed' : 'cancelled'}">${inc ? 'Income' : 'Expense'}</span></td>
      <td>${esc(t.category)}</td>
      <td>${esc(t.description || '—')}${sub ? `<br><span style="color:var(--gray);font-size:.75rem">${sub}</span>` : ''}</td>
      <td>${esc(t.paymentMethod || '—')}</td>
      <td style="font-weight:700;white-space:nowrap;color:${inc ? 'var(--status-completed)' : 'var(--status-cancelled)'}">${inc ? '+' : '−'} ${fmtTZS(t.amount)}</td>
      <td><span class="status-badge ${status === 'Paid' ? 'completed' : 'pending'}">${esc(status)}</span></td>
      <td style="white-space:nowrap">
        <button class="btn-sm-dismiss" onclick="openTransactionModal('${esc(t.id)}')">✏️</button>
        <button class="btn-sm-dismiss" onclick="deleteTransaction('${esc(t.id)}')">🗑</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

// Expenses grouped by category, sorted, with proportional bars.
function renderExpenseBreakdown(expenseTx, totalExpense) {
  const box = document.getElementById('expenseBreakdown');
  if (!box) return;
  const map = {};
  expenseTx.forEach(t => { const c = t.category || 'Other Expense'; map[c] = (map[c] || 0) + (Number(t.amount) || 0); });
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    box.innerHTML = `<p style="color:var(--gray);text-align:center;padding:1.5rem 0">No expenses recorded for this period.</p>`;
    return;
  }
  box.innerHTML = entries.map(([cat, amt]) => {
    const pct = totalExpense > 0 ? Math.round(amt / totalExpense * 100) : 0;
    return `<div class="breakdown-row">
      <div class="breakdown-top"><span>${esc(cat)}</span><span><strong>${fmtTZS(amt)}</strong> · ${pct}%</span></div>
      <div class="breakdown-bar"><div class="breakdown-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

// Profit & Loss summary for the selected period.
function renderPL(d) {
  const box = document.getElementById('plSummary');
  if (!box) return;
  const margin = d.income > 0 ? Math.round(d.net / d.income * 100) : 0;
  const row = (label, val, opts = {}) =>
    `<div class="pl-row ${opts.total ? 'pl-total' : ''}"><span>${label}</span><span style="${opts.color ? 'color:' + opts.color : ''}">${val}</span></div>`;
  let html =
    row('Total Income', fmtTZS(d.income), { color: 'var(--status-completed)' }) +
    row('Total Expenses', '− ' + fmtTZS(d.expense), { color: 'var(--status-cancelled)' }) +
    row('Net Profit', fmtTZS(d.net), { total: true, color: d.net >= 0 ? 'var(--status-completed)' : 'var(--status-cancelled)' }) +
    row('Profit Margin', margin + '%');
  if (d.vatOut || d.vatIn) {
    html += `<div class="pl-divider"></div>` +
      row('VAT collected (output)', fmtTZS(d.vatOut)) +
      row('VAT paid (input)', fmtTZS(d.vatIn)) +
      row('Net VAT due', fmtTZS(d.vatOut - d.vatIn), { total: true });
  }
  html += `<div class="pl-divider"></div>` +
    row('Receivable (unpaid income)', fmtTZS(d.unpaidInc)) +
    row('Payable (unpaid expenses)', fmtTZS(d.unpaidExp));
  box.innerHTML = html;
}

// Export the current period's transactions to a CSV file for the accountant.
function exportTransactionsCSV() {
  const { from, to } = acctRange();
  const rows = transactions.filter(t => txInRange(t, from, to)).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (!rows.length) { alert('No transactions in this period to export.'); return; }
  const headers = ['Date', 'Type', 'Category', 'Payee', 'Description', 'Amount (TZS)', 'VAT %', 'Status', 'Payment Method', 'Reference'];
  const cell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [headers.join(',')];
  rows.forEach(t => lines.push([t.date, t.type, t.category, t.payee || '', t.description || '', Number(t.amount) || 0, t.vatRate || 0, t.status || 'Paid', t.paymentMethod || '', t.reference || ''].map(cell).join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mjsd-transactions-${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function openTransactionModal(id) {
  const tx = id ? transactions.find(x => x.id === id) : null;
  const incOpts = INCOME_CATS.map(c => `<option value="${c}" ${tx && tx.category === c ? 'selected' : ''}>${c}</option>`).join('');
  const expOpts = EXPENSE_CATS.map(c => `<option value="${c}" ${tx && tx.category === c ? 'selected' : ''}>${c}</option>`).join('');
  const methodOpts = PAYMENT_METHODS.map(m => `<option ${tx && tx.paymentMethod === m ? 'selected' : ''}>${m}</option>`).join('');
  const today = ymdLocal(new Date());
  const type = tx ? tx.type : 'income';
  openAdminModal(tx ? 'Edit Transaction' : 'Record Transaction', `
    <form id="txForm" class="admin-modal-form">
      <div class="modal-grid-2">
        <div><label>Type *</label>
          <select id="txType" required>
            <option value="income" ${type === 'income' ? 'selected' : ''}>Income</option>
            <option value="expense" ${type === 'expense' ? 'selected' : ''}>Expense</option>
          </select>
        </div>
        <div><label>Date *</label><input type="date" id="txDate" required value="${tx ? esc(tx.date) : today}" /></div>
      </div>
      <label>Category *</label>
      <select id="txCategory" required>
        <optgroup label="Income">${incOpts}</optgroup>
        <optgroup label="Expense">${expOpts}</optgroup>
      </select>
      <label>Payee / Vendor / Customer</label>
      <input type="text" id="txPayee" value="${tx ? esc(tx.payee || '') : ''}" placeholder="Who was paid, or who paid you" />
      <label>Description</label>
      <input type="text" id="txDesc" value="${tx ? esc(tx.description || '') : ''}" placeholder="e.g. Brake service – BMW 320i" />
      <div class="modal-grid-3">
        <div><label>Amount (TZS) *</label><input type="number" id="txAmount" min="0" step="any" required value="${tx ? esc(tx.amount) : ''}" placeholder="0" /></div>
        <div><label>VAT %</label><input type="number" id="txVat" min="0" max="100" step="any" value="${tx ? esc(tx.vatRate || 0) : '0'}" /></div>
        <div><label>Status</label>
          <select id="txStatus">
            <option ${(!tx || tx.status === 'Paid') ? 'selected' : ''}>Paid</option>
            <option ${tx && tx.status === 'Unpaid' ? 'selected' : ''}>Unpaid</option>
          </select>
        </div>
      </div>
      <div class="modal-grid-2">
        <div><label>Payment Method</label><select id="txMethod">${methodOpts}</select></div>
        <div><label>Reference / Receipt #</label><input type="text" id="txRef" value="${tx ? esc(tx.reference || '') : ''}" placeholder="RCT-0001" /></div>
      </div>
      <p class="modal-err" id="txErr" style="display:none"></p>
      <div class="admin-modal-actions">
        <button type="button" class="btn-ghost" onclick="closeAdminModal()">Cancel</button>
        <button type="submit" class="btn-primary">${tx ? 'Save Changes' : 'Save Transaction'}</button>
      </div>
    </form>`);
  document.getElementById('txForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = parseFloat(document.getElementById('txAmount').value);
    if (!amount || amount <= 0) return showInlineError(document.getElementById('txErr'), 'Enter a valid amount.');
    const data = {
      type: document.getElementById('txType').value,
      date: document.getElementById('txDate').value,
      category: document.getElementById('txCategory').value,
      payee: document.getElementById('txPayee').value.trim(),
      description: document.getElementById('txDesc').value.trim(),
      amount,
      vatRate: Math.max(0, parseFloat(document.getElementById('txVat').value) || 0),
      status: document.getElementById('txStatus').value,
      paymentMethod: document.getElementById('txMethod').value,
      reference: document.getElementById('txRef').value.trim()
    };
    if (tx) {
      transactions = transactions.map(x => x.id === tx.id ? { ...x, ...data } : x);
    } else {
      transactions.unshift({ id: uid('TX'), ...data, createdAt: new Date().toISOString() });
    }
    saveTransactions();
    closeAdminModal();
    renderAccounting();
  });
}

function deleteTransaction(id) {
  if (confirm('Delete this transaction?')) {
    transactions = transactions.filter(t => t.id !== id);
    saveTransactions();
    renderAccounting();
  }
}

/* ==========================================================================
   STAFF MANAGEMENT (Admin only) — CRUD over mjsd_staff_accounts.
   ========================================================================== */
function renderStaff() {
  const tbody = document.getElementById('staffTableBody');
  if (!tbody) return;
  const accounts = getAccounts();
  setText('staffTotal', accounts.length);
  setText('staffAdmins', accounts.filter(a => a.role === 'Admin').length);
  setText('staffInactive', accounts.filter(a => !a.active).length);

  tbody.innerHTML = '';
  accounts.forEach(a => {
    const left = passwordDaysLeft(a);
    const expired = isPasswordExpired(a);
    const pwLabel = expired ? `<span class="status-badge cancelled">Expired</span>`
      : `<span class="status-badge ${left <= 5 ? 'pending' : 'completed'}">${left}d left</span>`;
    const isSelf = currentUser && currentUser.id === a.id;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(a.name)}</strong>${isSelf ? ' <span style="color:var(--gray);font-size:.75rem">(you)</span>' : ''}</td>
      <td>${esc(a.email)}</td>
      <td><span class="status-badge ${a.role === 'Admin' ? 'confirmed' : 'completed'}">${esc(a.role)}</span></td>
      <td>${a.active ? '<span class="status-badge completed">Active</span>' : '<span class="status-badge cancelled">Inactive</span>'}</td>
      <td>${pwLabel}</td>
      <td>
        <button class="btn-sm-dismiss" onclick="openStaffModal('${esc(a.id)}')">✏️ Edit</button>
        <button class="btn-sm-dismiss" onclick="resetStaffPassword('${esc(a.id)}')">🔑 Reset</button>
        <button class="btn-sm-dismiss" onclick="toggleStaffActive('${esc(a.id)}')">${a.active ? '⛔ Disable' : '✅ Enable'}</button>
        ${isSelf ? '' : `<button class="btn-sm-dismiss" onclick="deleteStaff('${esc(a.id)}')">🗑</button>`}
      </td>`;
    tbody.appendChild(tr);
  });
}

function openStaffModal(id) {
  const acc = id ? getAccounts().find(a => a.id === id) : null;
  const roleOpts = STAFF_ROLES.map(r => `<option ${acc && acc.role === r ? 'selected' : ''}>${r}</option>`).join('');
  openAdminModal(acc ? 'Edit Staff Member' : 'Add Staff Member', `
    <form id="staffForm" class="admin-modal-form">
      <label>Full Name *</label>
      <input type="text" id="stName" required value="${acc ? esc(acc.name) : ''}" placeholder="e.g. Juma Hamisi" />
      <div class="modal-grid-2">
        <div><label>Email *</label><input type="email" id="stEmail" required value="${acc ? esc(acc.email) : ''}" placeholder="name@mjsdmechanics.com" /></div>
        <div><label>Role *</label><select id="stRole" required>${roleOpts}</select></div>
      </div>
      ${acc ? '' : `
        <label>Temporary Password *</label>
        <input type="text" id="stPass" required placeholder="Min 6 characters" />
        <div class="modal-grid-2">
          <div><label>Security Question *</label><input type="text" id="stQ" required value="In which town is the workshop located?" /></div>
          <div><label>Answer *</label><input type="text" id="stA" required placeholder="e.g. Morogoro" /></div>
        </div>`}
      <p class="modal-err" id="stErr" style="display:none"></p>
      <div class="admin-modal-actions">
        <button type="button" class="btn-ghost" onclick="closeAdminModal()">Cancel</button>
        <button type="submit" class="btn-primary">${acc ? 'Save Changes' : 'Create Account'}</button>
      </div>
    </form>`);
  document.getElementById('staffForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('stErr');
    const name = document.getElementById('stName').value.trim();
    const email = document.getElementById('stEmail').value.trim().toLowerCase();
    const role = document.getElementById('stRole').value;
    if (!name || !email) return showInlineError(err, 'Name and email are required.');

    let accounts = getAccounts();
    const dupe = accounts.find(a => a.email === email && (!acc || a.id !== acc.id));
    if (dupe) return showInlineError(err, 'Another account already uses that email.');

    if (acc) {
      // Guard: don't let the last admin be demoted away.
      if (acc.role === 'Admin' && role !== 'Admin' && countActiveAdmins() <= 1 && acc.active) {
        return showInlineError(err, 'You cannot remove the last active Admin.');
      }
      accounts = accounts.map(a => a.id === acc.id ? { ...a, name, email, role } : a);
      saveAccounts(accounts);
      if (currentUser && currentUser.id === acc.id) { currentUser = accounts.find(a => a.id === acc.id); updateAccountUI(); applyRoleGating(currentUser.role); }
    } else {
      const pass = document.getElementById('stPass').value;
      const q = document.getElementById('stQ').value.trim();
      const ans = document.getElementById('stA').value.trim().toLowerCase();
      if (pass.length < 6) return showInlineError(err, 'Temporary password must be at least 6 characters.');
      if (!q || !ans) return showInlineError(err, 'Security question and answer are required.');
      const salt = randSalt(), saSalt = randSalt();
      accounts.unshift({
        id: uid('USR'), name, email, role,
        salt, passHash: await hashWithSalt(salt, pass), passwordSetAt: new Date().toISOString(),
        securityQuestion: q, securityAnswerSalt: saSalt, securityAnswerHash: await hashWithSalt(saSalt, ans),
        active: true, createdAt: new Date().toISOString()
      });
      saveAccounts(accounts);
    }
    closeAdminModal();
    renderStaff();
  });
}

function resetStaffPassword(id) {
  const acc = getAccounts().find(a => a.id === id);
  if (!acc) return;
  openAdminModal(`Reset Password — ${acc.name}`, `
    <form id="resetForm" class="admin-modal-form">
      <p style="color:var(--gray);font-size:.85rem;margin-bottom:.6rem">Set a new password for <strong>${esc(acc.email)}</strong>. They can change it after signing in.</p>
      <label>New Password *</label>
      <input type="text" id="rsNew" required placeholder="Min 6 characters" />
      <p class="modal-err" id="rsErr" style="display:none"></p>
      <div class="admin-modal-actions">
        <button type="button" class="btn-ghost" onclick="closeAdminModal()">Cancel</button>
        <button type="submit" class="btn-primary">Reset Password</button>
      </div>
    </form>`);
  document.getElementById('resetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const np = document.getElementById('rsNew').value;
    if (!np || np.length < 6) return showInlineError(document.getElementById('rsErr'), 'Password must be at least 6 characters.');
    await setAccountPassword(id, np);
    closeAdminModal();
    renderStaff();
    alert('✅ Password has been reset.');
  });
}

function toggleStaffActive(id) {
  let accounts = getAccounts();
  const acc = accounts.find(a => a.id === id);
  if (!acc) return;
  if (currentUser && currentUser.id === id) return alert('You cannot disable your own account.');
  if (acc.active && acc.role === 'Admin' && countActiveAdmins() <= 1) return alert('You cannot disable the last active Admin.');
  accounts = accounts.map(a => a.id === id ? { ...a, active: !a.active } : a);
  saveAccounts(accounts);
  renderStaff();
}

function deleteStaff(id) {
  if (currentUser && currentUser.id === id) return alert('You cannot delete your own account.');
  const acc = getAccounts().find(a => a.id === id);
  if (!acc) return;
  if (acc.role === 'Admin' && countActiveAdmins() <= 1 && acc.active) return alert('You cannot delete the last active Admin.');
  if (confirm(`Delete staff account for ${acc.name} (${acc.email})?`)) {
    saveAccounts(getAccounts().filter(a => a.id !== id));
    renderStaff();
  }
}

// Small DOM text helper used by the new modules.
function setText(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; }
