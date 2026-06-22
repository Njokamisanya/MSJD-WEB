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
function openAdminModal(title, bodyHTML, wide = false) {
  const root = document.getElementById('adminModalRoot');
  if (!root) return;
  root.innerHTML = `
    <div class="admin-modal-overlay" id="adminModalOverlay">
      <div class="admin-modal-card${wide ? ' wide' : ''}">
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
    invoices:   ["Invoices", "Create, print and track customer invoices for workshop jobs"],
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
  loadInvoices();

  // Redraw all components
  updateCounters();
  renderOverviewBookings();
  renderOverviewInbox();
  renderFullBookingsTable();
  renderFullInboxList();
  renderAdminGallery();
  renderInventory();
  renderAccounting();
  renderInvoices();
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

function inventoryQrPayload(it) {
  return [
    'MJSD INVENTORY',
    `Item: ${it.name || ''}`,
    `SKU: ${it.sku || it.id || ''}`,
    `Category: ${it.category || ''}`,
    `Qty: ${Number(it.quantity) || 0}`,
    `Reorder: ${Number(it.reorderLevel) || 0}`,
    `Supplier: ${it.supplier || ''}`
  ].join('\n');
}

function inventoryQrUrl(it, size = 260) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=10&data=${encodeURIComponent(inventoryQrPayload(it))}`;
}

function csvCell(value) {
  const s = String(value == null ? '' : value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(v => String(v).trim()));
}

function normalizeInventoryImportRow(raw) {
  const pick = (...keys) => {
    for (const key of keys) {
      const val = raw[key.toLowerCase()];
      if (val != null && String(val).trim() !== '') return String(val).trim();
    }
    return '';
  };
  const name = pick('item name', 'name', 'item');
  if (!name) return null;
  const category = pick('category') || 'Other';
  const matchedCategory = INV_CATEGORIES.find(c => c.toLowerCase() === category.toLowerCase());
  return {
    name,
    sku: pick('sku', 'code', 'sku / code'),
    category: matchedCategory || 'Other',
    quantity: Math.max(0, parseInt(pick('quantity', 'qty'), 10) || 0),
    unitPrice: Math.max(0, parseFloat(pick('unit price', 'unit price (tzs)', 'price')) || 0),
    reorderLevel: Math.max(0, parseInt(pick('reorder level', 'reorder', 'minimum stock'), 10) || 0),
    supplier: pick('supplier', 'vendor'),
    updatedAt: new Date().toISOString()
  };
}

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
        <button class="btn-sm-dismiss" onclick="openInventoryQrModal('${esc(it.id)}')">QR</button>
        <button class="btn-sm-dismiss" onclick="deleteInventoryItem('${esc(it.id)}')">🗑</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

function downloadInventoryCSV() {
  const headers = ['Item Name', 'SKU', 'Category', 'Quantity', 'Unit Price', 'Reorder Level', 'Supplier'];
  const lines = [headers.map(csvCell).join(',')];
  inventory
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    .forEach(it => lines.push([
      it.name, it.sku, it.category, Number(it.quantity) || 0, Number(it.unitPrice) || 0,
      Number(it.reorderLevel) || 0, it.supplier
    ].map(csvCell).join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mjsd-inventory-${ymdLocal(new Date())}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function uploadInventoryCSV(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    const rows = parseCSV(await file.text());
    if (rows.length < 2) return alert('CSV must include a header row and at least one inventory item.');
    const headers = rows[0].map(h => String(h).trim().toLowerCase());
    let added = 0, updated = 0, skipped = 0;
    rows.slice(1).forEach(row => {
      const raw = {};
      headers.forEach((h, i) => raw[h] = row[i] || '');
      const item = normalizeInventoryImportRow(raw);
      if (!item) { skipped++; return; }
      const idx = item.sku
        ? inventory.findIndex(x => String(x.sku || '').toLowerCase() === item.sku.toLowerCase())
        : -1;
      if (idx >= 0) {
        inventory[idx] = { ...inventory[idx], ...item };
        updated++;
      } else {
        inventory.unshift({ id: uid('INV'), ...item });
        added++;
      }
    });
    saveInventory();
    renderInventory();
    alert(`Inventory upload complete.\nAdded: ${added}\nUpdated: ${updated}\nSkipped: ${skipped}`);
  } catch (err) {
    alert('Could not read that CSV. Please check the file format and try again.');
  } finally {
    input.value = '';
  }
}

function openInventoryQrModal(id) {
  const it = inventory.find(x => x.id === id);
  if (!it) return;
  const qr = inventoryQrUrl(it, 320);
  openAdminModal(`QR — ${it.name}`, `
    <div class="inventory-qr-modal">
      <div class="inventory-qr-card">
        <img src="${qr}" alt="QR code for ${esc(it.name)}">
        <div>
          <strong>${esc(it.name)}</strong>
          <span>${esc(it.sku || it.id)}</span>
        </div>
      </div>
      <div class="inventory-qr-meta">
        <div><span>Category</span><strong>${esc(it.category || 'Other')}</strong></div>
        <div><span>Quantity</span><strong>${esc(it.quantity)}</strong></div>
        <div><span>Reorder</span><strong>${esc(it.reorderLevel)}</strong></div>
        <div><span>Supplier</span><strong>${esc(it.supplier || '—')}</strong></div>
      </div>
      <textarea readonly>${esc(inventoryQrPayload(it))}</textarea>
      <div class="admin-modal-actions">
        <a class="btn-ghost inventory-qr-download" href="${qr}" download="mjsd-${esc(it.sku || it.id)}-qr.png" target="_blank" rel="noopener">Download QR</a>
        <button type="button" class="btn-primary" onclick="printInventoryQr('${esc(it.id)}')">Print Label</button>
      </div>
    </div>
  `);
}

function printInventoryQr(id) {
  const it = inventory.find(x => x.id === id);
  if (!it) return;
  const qr = inventoryQrUrl(it, 260);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Inventory QR ${esc(it.sku || it.id)}</title>
    <style>
      *{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;padding:24px;color:#111;background:#fff}
      .label{width:320px;border:2px solid #111;border-radius:12px;padding:16px;text-align:center}
      img{width:220px;height:220px}.name{font-size:18px;font-weight:800;margin-top:10px}.sku{font-size:13px;color:#555;margin-top:4px}
      .meta{font-size:12px;margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:4px}
      @media print{body{padding:0}.label{border-color:#111;break-inside:avoid}}
    </style></head><body>
    <div class="label">
      <img src="${qr}" alt="QR">
      <div class="name">${esc(it.name)}</div>
      <div class="sku">${esc(it.sku || it.id)}</div>
      <div class="meta"><div>Qty: ${esc(it.quantity)}</div><div>Reorder: ${esc(it.reorderLevel)}</div><div>${esc(it.category || 'Other')}</div><div>${esc(it.supplier || '—')}</div></div>
    </div>
    <script>window.addEventListener('load',()=>setTimeout(()=>print(),300));</script></body></html>`;
  printInvoiceInFrame(html);
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
let invoices = [];

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

/* ==========================================================================
   INVOICING — create, print & track customer invoices. Stored in mjsd_invoices.
   ========================================================================== */
const INVOICES_KEY = 'mjsd_invoices';

function loadInvoices() {
  invoices = JSON.parse(localStorage.getItem(INVOICES_KEY)) || [];
}
function saveInvoices() { localStorage.setItem(INVOICES_KEY, JSON.stringify(invoices)); }

function nextInvoiceNo() {
  const year = new Date().getFullYear();
  const max = invoices.reduce((m, inv) => {
    const p = (inv.invoiceNo || '').split('-');
    if (p.length === 3 && p[0] === 'INV' && p[1] === String(year)) return Math.max(m, parseInt(p[2], 10) || 0);
    return m;
  }, 0);
  return `INV-${year}-${String(max + 1).padStart(4, '0')}`;
}

function invoiceDaysUntilDue(inv) {
  if (!inv || !inv.dueDate || inv.status === 'Paid') return null;
  const today = new Date(ymdLocal(new Date()) + 'T00:00:00');
  const due = new Date(inv.dueDate + 'T00:00:00');
  return Math.round((due - today) / 86400000);
}

function invoiceDueLabel(inv) {
  const days = invoiceDaysUntilDue(inv);
  if (days == null) return inv.status === 'Paid' ? 'Paid' : 'No due date';
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days} days`;
}

function renderInvoiceInsights() {
  const wrap = document.getElementById('invoiceInsights');
  if (!wrap) return;
  const open = invoices.filter(i => ['Issued', 'Overdue'].includes(i.status));
  const overdue = open.filter(i => invoiceDaysUntilDue(i) < 0);
  const dueSoon = open.filter(i => {
    const d = invoiceDaysUntilDue(i);
    return d != null && d >= 0 && d <= 7;
  });
  const average = invoices.length ? invoices.reduce((s, i) => s + (Number(i.total) || 0), 0) / invoices.length : 0;
  const latestPaid = invoices
    .filter(i => i.status === 'Paid')
    .slice()
    .sort((a, b) => String(b.paidAt || b.date || '').localeCompare(String(a.paidAt || a.date || '')))[0];

  wrap.innerHTML = `
    <div class="invoice-insight-card danger">
      <span class="insight-label">Overdue</span>
      <strong>${overdue.length}</strong>
      <span>${fmtTZS(overdue.reduce((s, i) => s + (Number(i.total) || 0), 0))}</span>
    </div>
    <div class="invoice-insight-card warn">
      <span class="insight-label">Due This Week</span>
      <strong>${dueSoon.length}</strong>
      <span>${fmtTZS(dueSoon.reduce((s, i) => s + (Number(i.total) || 0), 0))}</span>
    </div>
    <div class="invoice-insight-card">
      <span class="insight-label">Average Invoice</span>
      <strong>${fmtTZS(average)}</strong>
      <span>${open.length} open invoice${open.length === 1 ? '' : 's'}</span>
    </div>
    <div class="invoice-insight-card good">
      <span class="insight-label">Last Paid</span>
      <strong>${latestPaid ? esc(latestPaid.invoiceNo) : '—'}</strong>
      <span>${latestPaid ? fmtTZS(latestPaid.total) : 'No paid invoices yet'}</span>
    </div>`;
}

function renderInvoices() {
  const tbody = document.getElementById('invTableBody');
  if (!tbody) return;

  // Auto-mark overdue: Issued invoices past due date
  const today = ymdLocal(new Date());
  let statusChanged = false;
  invoices = invoices.map(inv =>
    (inv.status === 'Issued' && inv.dueDate && inv.dueDate < today) ? (statusChanged = true, { ...inv, status: 'Overdue' }) : inv
  );
  if (statusChanged) saveInvoices();

  // Stat widgets
  const drafts = invoices.filter(i => i.status === 'Draft').length;
  const paid   = invoices.filter(i => i.status === 'Paid').length;
  const outstanding = invoices.filter(i => ['Issued', 'Overdue'].includes(i.status))
    .reduce((s, i) => s + (Number(i.total) || 0), 0);
  setText('invInvoicesTotal', invoices.length);
  setText('invDraftCount', drafts);
  setText('invPaidCount', paid);
  setText('invOutstandingAmt', fmtTZS(outstanding));
  renderInvoiceInsights();

  const badge = document.getElementById('invoicesDraftBadge');
  if (badge) { badge.textContent = drafts; badge.style.display = drafts > 0 ? 'inline-block' : 'none'; }

  // Filter + search
  const q  = ((document.getElementById('invoiceSearch') || {}).value || '').toLowerCase();
  const sf = (document.getElementById('invoiceStatusFilter') || {}).value || 'all';
  const rows = invoices
    .filter(inv => sf === 'all' || inv.status === sf)
    .filter(inv => !q ||
      (inv.invoiceNo || '').toLowerCase().includes(q) ||
      (inv.customerName || '').toLowerCase().includes(q) ||
      (inv.customerPhone || '').toLowerCase().includes(q) ||
      (inv.vehicle || '').toLowerCase().includes(q))
    .slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--gray)">No invoices found. Click "+ New Invoice" to create one.</td></tr>`;
    return;
  }
  const sc = { Draft: 'pending', Issued: 'confirmed', Paid: 'completed', Overdue: 'cancelled' };
  rows.forEach(inv => {
    const tr = document.createElement('tr');
    const days = invoiceDaysUntilDue(inv);
    const dueClass = days == null || inv.status === 'Paid' ? '' : days < 0 ? ' overdue' : days <= 7 ? ' soon' : '';
    tr.innerHTML = `
      <td><code style="color:var(--red-light);font-weight:600">${esc(inv.invoiceNo)}</code></td>
      <td style="white-space:nowrap">${esc(inv.date || '—')}</td>
      <td style="white-space:nowrap"><span class="invoice-due${dueClass}">${esc(invoiceDueLabel(inv))}</span>${inv.dueDate ? `<br><span style="color:var(--gray);font-size:.72rem">${esc(inv.dueDate)}</span>` : ''}</td>
      <td><strong>${esc(inv.customerName)}</strong>${inv.customerPhone ? `<br><span style="color:var(--gray);font-size:.78rem">${esc(inv.customerPhone)}</span>` : ''}</td>
      <td>${esc(inv.vehicle || '—')}</td>
      <td style="font-weight:700;white-space:nowrap">${fmtTZS(inv.total)}</td>
      <td><span class="status-badge ${sc[inv.status] || 'pending'}">${esc(inv.status)}</span></td>
      <td style="white-space:nowrap">
        <button class="btn-sm-dismiss" onclick="printInvoice('${esc(inv.id)}')">🖨 Print</button>
        ${inv.status !== 'Paid' && inv.customerPhone ? `<button class="btn-sm-dismiss" onclick="sendInvoiceReminder('${esc(inv.id)}')">Remind</button>` : ''}
        <button class="btn-sm-dismiss" onclick="duplicateInvoice('${esc(inv.id)}')">Copy</button>
        <button class="btn-sm-dismiss" onclick="openInvoiceModal('${esc(inv.id)}')">✏️</button>
        ${inv.status !== 'Paid' ? `<button class="btn-sm-dismiss" style="color:var(--c-green);border-color:rgba(52,211,153,0.3)" onclick="markInvoicePaid('${esc(inv.id)}')">✓ Paid</button>` : ''}
        <button class="btn-sm-dismiss" onclick="deleteInvoice('${esc(inv.id)}')">🗑</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

// ---- Create / Edit modal ----
function openInvoiceModal(id) {
  const inv = id ? invoices.find(x => x.id === id) : null;
  const items = (inv && inv.items && inv.items.length) ? inv.items : [{ description: '', qty: 1, unitPrice: 0 }];
  const today = ymdLocal(new Date());
  const defaultDue = ymdLocal(new Date(Date.now() + 14 * 86400000));

  const statusOpts = ['Draft', 'Issued', 'Paid', 'Overdue']
    .map(s => `<option ${(inv ? inv.status : 'Draft') === s ? 'selected' : ''}>${s}</option>`).join('');
  const methodOpts = PAYMENT_METHODS
    .map(m => `<option ${inv && inv.paymentMethod === m ? 'selected' : ''}>${m}</option>`).join('');
  const itemsHTML = items.map(it => `
    <div class="inv-item-row">
      <input type="text" class="if-desc" value="${esc(it.description)}" placeholder="e.g. Brake pad replacement" />
      <input type="number" class="if-qty" value="${Number(it.qty) || 1}" min="0.01" step="any" />
      <input type="number" class="if-up" value="${Number(it.unitPrice) || 0}" min="0" step="any" />
      <span class="if-row-total">${fmtTZS((Number(it.qty) || 0) * (Number(it.unitPrice) || 0))}</span>
      <button type="button" class="btn-remove-item" onclick="removeInvItemRow(this)" title="Remove row">×</button>
    </div>`).join('');

  openAdminModal(inv ? `Edit — ${inv.invoiceNo}` : 'New Invoice', `
    <form id="invoiceForm" class="admin-modal-form">
      <div class="modal-grid-2">
        <div><label>Customer Name *</label><input id="ifCustName" required value="${inv ? esc(inv.customerName) : ''}" placeholder="Full name" /></div>
        <div><label>Phone</label><input id="ifCustPhone" value="${inv ? esc(inv.customerPhone || '') : ''}" placeholder="+255 xxx xxx xxx" /></div>
      </div>
      <div class="modal-grid-2">
        <div><label>Vehicle (Make / Model / Plate)</label><input id="ifVehicle" value="${inv ? esc(inv.vehicle || '') : ''}" placeholder="e.g. Toyota Hilux – T 482 BCA" /></div>
        <div><label>Email</label><input type="email" id="ifCustEmail" value="${inv ? esc(inv.customerEmail || '') : ''}" placeholder="Optional" /></div>
      </div>
      <div class="modal-grid-3">
        <div><label>Invoice No.</label><input id="ifNo" readonly value="${inv ? esc(inv.invoiceNo) : 'Auto-generated'}" style="opacity:.55;cursor:default" /></div>
        <div><label>Date *</label><input type="date" id="ifDate" required value="${inv ? esc(inv.date) : today}" /></div>
        <div><label>Due Date</label><input type="date" id="ifDue" value="${inv ? esc(inv.dueDate || '') : defaultDue}" /></div>
      </div>

      <div class="inv-section-label">Line Items</div>
      <div class="inv-items-header">
        <span>Description</span><span style="text-align:center">Qty</span><span style="text-align:right">Unit Price</span><span style="text-align:right">Total</span><span></span>
      </div>
      <div id="ifItemsContainer">${itemsHTML}</div>
      <button type="button" class="btn-add-item" id="btnAddInvItem">+ Add Line</button>

      <div class="inv-totals">
        <div class="inv-total-row"><span>Subtotal</span><span id="ifSubtotal">TZS 0</span></div>
        <div class="inv-total-row">
          <span>VAT&nbsp;<input type="number" id="ifVatRate" value="${inv ? (inv.vatRate || 0) : 18}" min="0" max="100" step="any" style="width:3.6rem;display:inline-block;padding:.2rem .4rem;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.1);border-radius:6px;color:#fff;text-align:center;font-size:.85rem" />&nbsp;%</span>
          <span id="ifVatAmt">TZS 0</span>
        </div>
        <div class="inv-total-row inv-grand-total"><span>Grand Total</span><span id="ifGrandTotal">TZS 0</span></div>
      </div>

      <div class="modal-grid-2">
        <div><label>Status</label><select id="ifStatus">${statusOpts}</select></div>
        <div><label>Payment Method</label><select id="ifPayMethod">${methodOpts}</select></div>
      </div>
      <label>Notes / Terms</label>
      <textarea id="ifNotes" rows="2" placeholder="e.g. 3-month warranty on parts. Payment due within 14 days.">${inv ? esc(inv.notes || '') : ''}</textarea>

      <p class="modal-err" id="ifErr" style="display:none"></p>
      <div class="admin-modal-actions">
        <button type="button" class="btn-ghost" onclick="closeAdminModal()">Cancel</button>
        <button type="submit" class="btn-primary">${inv ? 'Save Changes' : 'Create Invoice'}</button>
      </div>
    </form>`, true);

  // Wire up events after modal is rendered
  calcInvTotals();
  document.querySelectorAll('#ifItemsContainer .if-qty, #ifItemsContainer .if-up')
    .forEach(inp => inp.addEventListener('input', calcInvTotals));
  document.getElementById('ifVatRate').addEventListener('input', calcInvTotals);
  document.getElementById('btnAddInvItem').addEventListener('click', addInvItemRow);
  document.getElementById('invoiceForm').addEventListener('submit', (e) => {
    e.preventDefault();
    saveInvoiceFromForm(inv ? inv.id : null);
  });
}

function addInvItemRow() {
  const container = document.getElementById('ifItemsContainer');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'inv-item-row';
  div.innerHTML = `
    <input type="text" class="if-desc" placeholder="e.g. Labour — engine service" />
    <input type="number" class="if-qty" value="1" min="0.01" step="any" />
    <input type="number" class="if-up" value="0" min="0" step="any" />
    <span class="if-row-total">${fmtTZS(0)}</span>
    <button type="button" class="btn-remove-item" onclick="removeInvItemRow(this)" title="Remove">×</button>`;
  container.appendChild(div);
  div.querySelectorAll('.if-qty, .if-up').forEach(inp => inp.addEventListener('input', calcInvTotals));
  div.querySelector('.if-desc').focus();
}

function removeInvItemRow(btn) {
  const container = document.getElementById('ifItemsContainer');
  if (!container || container.children.length <= 1) return;
  btn.closest('.inv-item-row').remove();
  calcInvTotals();
}

function calcInvTotals() {
  let subtotal = 0;
  document.querySelectorAll('#ifItemsContainer .inv-item-row').forEach(row => {
    const qty = parseFloat(row.querySelector('.if-qty').value) || 0;
    const up  = parseFloat(row.querySelector('.if-up').value) || 0;
    const rt  = qty * up;
    subtotal += rt;
    row.querySelector('.if-row-total').textContent = fmtTZS(rt);
  });
  const vatRate = parseFloat((document.getElementById('ifVatRate') || {}).value) || 0;
  const vatAmt  = subtotal * vatRate / 100;
  setText('ifSubtotal',   fmtTZS(subtotal));
  setText('ifVatAmt',     fmtTZS(vatAmt));
  setText('ifGrandTotal', fmtTZS(subtotal + vatAmt));
}

function saveInvoiceFromForm(editId) {
  const err = document.getElementById('ifErr');
  const custName = document.getElementById('ifCustName').value.trim();
  if (!custName) return showInlineError(err, 'Customer name is required.');
  const date = document.getElementById('ifDate').value;
  if (!date) return showInlineError(err, 'Invoice date is required.');

  const items = [];
  let subtotal = 0;
  document.querySelectorAll('#ifItemsContainer .inv-item-row').forEach(row => {
    const desc = row.querySelector('.if-desc').value.trim();
    const qty  = Math.max(0, parseFloat(row.querySelector('.if-qty').value) || 0);
    const up   = Math.max(0, parseFloat(row.querySelector('.if-up').value) || 0);
    if (desc || qty > 0 || up > 0) {
      items.push({ description: desc || '—', qty, unitPrice: up });
      subtotal += qty * up;
    }
  });
  if (!items.length) return showInlineError(err, 'Add at least one line item.');

  const vatRate  = Math.max(0, parseFloat(document.getElementById('ifVatRate').value) || 0);
  const vatAmount = subtotal * vatRate / 100;
  const data = {
    customerName:  custName,
    customerPhone: document.getElementById('ifCustPhone').value.trim(),
    customerEmail: document.getElementById('ifCustEmail').value.trim(),
    vehicle:       document.getElementById('ifVehicle').value.trim(),
    date,
    dueDate:       document.getElementById('ifDue').value,
    items,
    subtotal,
    vatRate,
    vatAmount,
    total:         subtotal + vatAmount,
    status:        document.getElementById('ifStatus').value,
    paymentMethod: document.getElementById('ifPayMethod').value,
    notes:         document.getElementById('ifNotes').value.trim()
  };

  if (editId) {
    invoices = invoices.map(i => i.id === editId ? { ...i, ...data } : i);
  } else {
    invoices.unshift({ id: uid('INVR'), invoiceNo: nextInvoiceNo(), ...data, createdAt: new Date().toISOString() });
  }
  saveInvoices();
  closeAdminModal();
  renderInvoices();
}

function duplicateInvoice(id) {
  const inv = invoices.find(i => i.id === id);
  if (!inv) return;
  const today = ymdLocal(new Date());
  const due = ymdLocal(new Date(Date.now() + 14 * 86400000));
  invoices.unshift({
    ...inv,
    id: uid('INVR'),
    invoiceNo: nextInvoiceNo(),
    date: today,
    dueDate: due,
    status: 'Draft',
    paidAt: '',
    createdAt: new Date().toISOString()
  });
  saveInvoices();
  renderInvoices();
}

function sendInvoiceReminder(id) {
  const inv = invoices.find(i => i.id === id);
  if (!inv || !inv.customerPhone) return;
  const phone = inv.customerPhone.replace(/[^\d+]/g, '');
  const text = `Hello ${inv.customerName || 'there'}, this is MJSD Mechanics. Invoice ${inv.invoiceNo} for ${fmtTZS(inv.total)} is ${invoiceDueLabel(inv).toLowerCase()}. Thank you.`;
  window.open(`https://wa.me/${encodeURIComponent(phone.replace(/^\+/, ''))}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

function exportInvoicesCSV() {
  const cell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const lines = [['Invoice No', 'Date', 'Due Date', 'Customer', 'Phone', 'Vehicle', 'Subtotal', 'VAT Rate', 'VAT Amount', 'Total', 'Status', 'Payment Method', 'Notes'].map(cell).join(',')];
  invoices.forEach(inv => {
    lines.push([
      inv.invoiceNo, inv.date, inv.dueDate, inv.customerName, inv.customerPhone, inv.vehicle,
      Number(inv.subtotal) || 0, Number(inv.vatRate) || 0, Number(inv.vatAmount) || 0, Number(inv.total) || 0,
      inv.status, inv.paymentMethod, inv.notes
    ].map(cell).join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mjsd-invoices-${ymdLocal(new Date())}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function printInvoiceInFrame(html) {
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.setAttribute('aria-hidden', 'true');
  document.body.appendChild(frame);
  const doc = frame.contentWindow && frame.contentWindow.document;
  if (!doc) {
    frame.remove();
    alert('Print preview could not be prepared. Please try again.');
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 1200);
  }, 500);
}

function openInvoicePrintPreview(html, invoiceNo) {
  openAdminModal(`Print — ${invoiceNo}`, `
    <div class="invoice-print-actions">
      <button type="button" class="btn-primary" onclick="printInvoicePreview()">Print Invoice</button>
      <button type="button" class="btn-ghost" onclick="closeAdminModal()">Close</button>
    </div>
    <iframe id="invoicePrintPreview" class="invoice-print-preview" title="Invoice print preview"></iframe>
  `, true);
  const card = document.querySelector('.admin-modal-card.wide');
  if (card) card.classList.add('print-preview');
  const frame = document.getElementById('invoicePrintPreview');
  if (frame) frame.srcdoc = html;
}

function printInvoicePreview() {
  const frame = document.getElementById('invoicePrintPreview');
  if (!frame || !frame.contentWindow) {
    alert('Print preview is not ready yet. Please try again.');
    return;
  }
  frame.contentWindow.focus();
  frame.contentWindow.print();
}

// ---- Mark invoice paid + optional accounting post ----
function markInvoicePaid(id) {
  const inv = invoices.find(i => i.id === id);
  if (!inv) return;
  if (!confirm(`Mark ${inv.invoiceNo} as Paid?`)) return;

  invoices = invoices.map(i => i.id === id ? { ...i, status: 'Paid', paidAt: new Date().toISOString() } : i);
  saveInvoices();

  if (confirm(`Post TZS ${Number(inv.total || 0).toLocaleString()} to Accounting as income?`)) {
    transactions.unshift({
      id: uid('TX'),
      type: 'income',
      date: ymdLocal(new Date()),
      category: 'Service / Labour Revenue',
      payee: inv.customerName,
      description: `Invoice ${inv.invoiceNo}${inv.vehicle ? ' — ' + inv.vehicle : ''}`,
      amount: inv.total,
      vatRate: inv.vatRate || 0,
      status: 'Paid',
      paymentMethod: inv.paymentMethod || 'Cash',
      reference: inv.invoiceNo,
      createdAt: new Date().toISOString()
    });
    saveTransactions();
    renderAccounting();
  }
  renderInvoices();
}

function deleteInvoice(id) {
  const inv = invoices.find(i => i.id === id);
  if (!inv) return;
  if (confirm(`Delete invoice ${inv.invoiceNo}? This cannot be undone.`)) {
    invoices = invoices.filter(i => i.id !== id);
    saveInvoices();
    renderInvoices();
  }
}

// ---- Print invoice in a new popup window ----
function printInvoice(id) {
  const inv = invoices.find(i => i.id === id);
  if (!inv) return;

  const sc = { Draft: '#f59e0b', Issued: '#3b82f6', Paid: '#10b981', Overdue: '#ef4444' };
  const color = sc[inv.status] || '#6b7280';
  const fmt = n => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

  const itemRows = (inv.items || []).map((it, i) => `
    <tr>
      <td style="text-align:center;color:#6b7280">${i + 1}</td>
      <td>${esc(it.description || '—')}</td>
      <td style="text-align:center">${esc(it.qty)}</td>
      <td style="text-align:right">TZS ${fmt(it.unitPrice)}</td>
      <td style="text-align:right;font-weight:600">TZS ${fmt((Number(it.qty) || 0) * (Number(it.unitPrice) || 0))}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Invoice ${esc(inv.invoiceNo)} — MJSD Mechanics</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a2e;background:#f3f4f6;font-size:14px;line-height:1.5}
    .print-toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:center;gap:10px;padding:12px;background:#111827;box-shadow:0 8px 24px rgba(0,0,0,.18)}
    .print-toolbar button{border:0;border-radius:8px;padding:10px 16px;font-weight:700;cursor:pointer}
    .print-toolbar .primary{background:#f97316;color:#fff}
    .print-toolbar .secondary{background:#374151;color:#fff}
    .page{max-width:760px;margin:24px auto;padding:40px;background:#fff;box-shadow:0 20px 60px rgba(15,23,42,.14)}
    .inv-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;padding-bottom:20px;border-bottom:3px solid #f97316}
    .co-name{font-size:22px;font-weight:800;color:#f97316;letter-spacing:-0.5px}
    .co-sub{font-size:11px;color:#6b7280;margin-top:2px}
    .co-contact{font-size:12px;color:#4b5563;margin-top:8px;line-height:1.8}
    .inv-title-block{text-align:right}
    .inv-title{font-size:34px;font-weight:900;color:#1a1a2e;letter-spacing:-1px}
    .inv-no{font-size:14px;color:#f97316;font-weight:700;margin-top:4px}
    .inv-badge{display:inline-block;background:${color}20;color:${color};border:1.5px solid ${color};border-radius:20px;padding:3px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-top:8px}
    .inv-meta{display:flex;gap:36px;margin-bottom:28px;flex-wrap:wrap}
    .meta-label{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#9ca3af;font-weight:600}
    .meta-value{font-size:14px;font-weight:600;color:#1a1a2e;margin-top:2px}
    .bill-to{background:#f9fafb;border-radius:10px;padding:16px 20px;display:inline-block;min-width:260px;margin-bottom:28px}
    .bill-label{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#9ca3af;font-weight:700;margin-bottom:8px}
    .bill-name{font-size:16px;font-weight:700;color:#1a1a2e}
    .bill-detail{font-size:13px;color:#4b5563;margin-top:3px}
    table.items{width:100%;border-collapse:collapse;margin-bottom:20px}
    table.items th{background:#1a1a2e;color:#fff;padding:10px 14px;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
    table.items th:first-child{border-radius:8px 0 0 8px}
    table.items th:last-child{border-radius:0 8px 8px 0}
    table.items td{padding:11px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;vertical-align:middle}
    table.items tr:last-child td{border-bottom:2px solid #e5e7eb}
    table.items tr:nth-child(even) td{background:#f9fafb}
    .totals-wrap{display:flex;justify-content:flex-end;margin-bottom:28px}
    .totals-box{width:280px}
    .t-row{display:flex;justify-content:space-between;padding:7px 0;font-size:13px;color:#4b5563;border-bottom:1px dashed #e5e7eb}
    .t-row span:last-child{font-weight:600;color:#1a1a2e}
    .t-grand{display:flex;justify-content:space-between;padding:12px 16px;background:#1a1a2e;border-radius:10px;margin-top:8px}
    .t-grand span:first-child{color:#9ca3af;font-weight:600;font-size:14px}
    .t-grand span:last-child{color:#f97316;font-weight:800;font-size:18px}
    .notes{background:#f9fafb;border-left:4px solid #f97316;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:28px;font-size:13px;color:#4b5563}
    .notes strong{display:block;color:#1a1a2e;margin-bottom:4px}
    .footer{text-align:center;padding-top:20px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;line-height:1.8}
    @media print{body{background:#fff;print-color-adjust:exact;-webkit-print-color-adjust:exact}.print-toolbar{display:none}.page{padding:20px;margin:0 auto;box-shadow:none}}
  </style>
</head>
<body>
<div class="page">
  <div class="inv-header">
    <div>
      <div class="co-name">⚙ MJSD Mechanics</div>
      <div class="co-sub">Professional Vehicle Diagnostics &amp; Repair</div>
      <div class="co-contact">📍 Morogoro-Mkundi, Tanzania<br>📞 +255 694 666 888<br>✉ admin@mjsdmechanics.com</div>
    </div>
    <div class="inv-title-block">
      <div class="inv-title">INVOICE</div>
      <div class="inv-no">${esc(inv.invoiceNo)}</div>
      <div><span class="inv-badge">${esc(inv.status)}</span></div>
    </div>
  </div>

  <div class="inv-meta">
    <div><div class="meta-label">Invoice Date</div><div class="meta-value">${esc(inv.date || '—')}</div></div>
    ${inv.dueDate ? `<div><div class="meta-label">Due Date</div><div class="meta-value">${esc(inv.dueDate)}</div></div>` : ''}
    ${inv.paymentMethod ? `<div><div class="meta-label">Payment</div><div class="meta-value">${esc(inv.paymentMethod)}</div></div>` : ''}
  </div>

  <div class="bill-to">
    <div class="bill-label">Bill To</div>
    <div class="bill-name">${esc(inv.customerName || '—')}</div>
    ${inv.customerPhone ? `<div class="bill-detail">📞 ${esc(inv.customerPhone)}</div>` : ''}
    ${inv.customerEmail ? `<div class="bill-detail">✉ ${esc(inv.customerEmail)}</div>` : ''}
    ${inv.vehicle ? `<div class="bill-detail" style="margin-top:6px;font-weight:600;color:#1a1a2e">🚗 ${esc(inv.vehicle)}</div>` : ''}
  </div>

  <table class="items">
    <thead>
      <tr>
        <th style="width:36px;text-align:center">#</th>
        <th>Description</th>
        <th style="width:56px;text-align:center">Qty</th>
        <th style="width:120px;text-align:right">Unit Price</th>
        <th style="width:120px;text-align:right">Total</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="totals-wrap">
    <div class="totals-box">
      <div class="t-row"><span>Subtotal</span><span>TZS ${fmt(inv.subtotal)}</span></div>
      ${(inv.vatRate > 0) ? `<div class="t-row"><span>VAT (${inv.vatRate}%)</span><span>TZS ${fmt(inv.vatAmount)}</span></div>` : ''}
      <div class="t-grand"><span>TOTAL DUE</span><span>TZS ${fmt(inv.total)}</span></div>
    </div>
  </div>

  ${inv.notes ? `<div class="notes"><strong>Notes &amp; Terms</strong>${esc(inv.notes)}</div>` : ''}

  <div class="footer">
    <strong style="color:#1a1a2e;font-size:14px">Thank you for choosing MJSD Mechanics!</strong><br>
    Accepted payments: Cash · Mobile Money (M-Pesa / Tigo Pesa) · Bank Transfer<br>
    Generated ${new Date().toLocaleDateString('en-TZ', { dateStyle: 'long' })}
  </div>
</div>
</body>
</html>`;

  openInvoicePrintPreview(html, inv.invoiceNo);
}
