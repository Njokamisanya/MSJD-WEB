/* ==========================================================================
   MJSD MECHANICS | ADMINISTRATIVE CONTROL PORTAL LOGIC ENGINE
   ========================================================================== */

// Default Seed Data in case user cache is empty
const defaultBookings = [
  {
    id: "BK-982173",
    fname: "Juma",
    lname: "Hamisi",
    phone: "0694333222",
    email: "juma.h@gmail.com",
    vehicle: "Toyota Hilux (2020)",
    service: "Engine Diagnosis",
    date: "2026-05-28",
    time: "10:30",
    notes: "Engine light is flashing. Sounds like a minor knocking sound from cold start.",
    status: "Pending",
    createdAt: "5/24/2026, 10:15:23 AM"
  },
  {
    id: "BK-472091",
    fname: "Aisha",
    lname: "Mwamba",
    phone: "0694555888",
    email: "aisha.mwamba@yahoo.com",
    vehicle: "Nissan Patrol Y62",
    service: "Brake Service",
    date: "2026-05-29",
    time: "14:00",
    notes: "Brake oil fluid low and front brakes squeaking when stopping.",
    status: "Confirmed",
    createdAt: "5/23/2026, 3:45:10 PM"
  },
  {
    id: "BK-104928",
    fname: "Robert",
    lname: "Mushi",
    phone: "0788334455",
    email: "robmush@outlook.com",
    vehicle: "Subaru Forester XT",
    service: "Suspension Repair",
    date: "2026-05-26",
    time: "09:00",
    notes: "Clunking noise in front left strut over bumps.",
    status: "Completed",
    createdAt: "5/22/2026, 9:20:00 AM"
  }
];

const defaultInquiries = [
  {
    id: "INQ-481920",
    name: "Baraka Kagashe",
    phone: "0694112233",
    subject: "Engine Rebuilding Cost Estimation",
    message: "Habari! I would like to get a rough quote for a full engine rebuild on a 1HZ diesel motor for my Land Cruiser. Do you provide warranty on your work?",
    status: "Unread",
    createdAt: "5/24/2026, 11:05:44 AM"
  },
  {
    id: "INQ-882103",
    name: "Neema Ndosa",
    phone: "0694778899",
    subject: "Opening hours on public holidays",
    message: "Are you guys open this coming Thursday? I need to drop off my vehicle for oil service early in the morning before driving up to Dodoma.",
    status: "Read",
    createdAt: "5/23/2026, 8:40:12 AM"
  }
];

// Seed default images in case not set
const defaultGalleryItems = [
  {
    cat: 'engine',
    img: 'https://images.unsplash.com/photo-1486006920555-c77dce18193b?auto=format&fit=crop&w=600&q=80',
    alt: 'Engine diagnostics on SUV',
    title: 'Engine Diagnostics & Precision Tuning'
  },
  {
    cat: 'brakes',
    img: 'https://images.unsplash.com/photo-1486006920555-c77dce18193b?auto=format&fit=crop&w=600&q=80',
    alt: 'Brake calipers and rotor assembly replacement',
    title: 'High-Performance Brake System Installation'
  },
  {
    cat: 'suspension',
    img: 'https://images.unsplash.com/photo-1486006920555-c77dce18193b?auto=format&fit=crop&w=600&q=80',
    alt: 'Complete front suspension overhaul',
    title: 'Heavy Duty 4x4 Offroad Suspension Upgrade'
  }
];

// App State
let bookings = [];
let inquiries = [];
let galleryItems = [];
let uploadedImgBase64 = "";

// Initialize Dashboard
document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  loadAllData();
  initUploader();
});

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
  
  if (tabId === "overview") {
    pageTitle.textContent = "Overview";
    pageDescription.textContent = "Real-time status overview of MJSD Mechanics workshop";
  } else if (tabId === "bookings") {
    pageTitle.textContent = "Appointments";
    pageDescription.textContent = "Review, schedule and coordinate customer service bookings";
  } else if (tabId === "messages") {
    pageTitle.textContent = "Customer Messages";
    pageDescription.textContent = "Read and respond to inquiries sent from the website contact form";
  } else if (tabId === "uploader") {
    pageTitle.textContent = "Gallery Portfolio Manager";
    pageDescription.textContent = "Publish vehicle photos directly to the main customer website";
  }
}

// ===== DATA LOADING AND REDRAWING =====
function loadAllData() {
  // Load bookings
  bookings = JSON.parse(localStorage.getItem("mjsd_bookings"));
  if (!bookings || bookings.length === 0) {
    bookings = defaultBookings;
    localStorage.setItem("mjsd_bookings", JSON.stringify(bookings));
  }

  // Load inquiries
  inquiries = JSON.parse(localStorage.getItem("mjsd_inquiries"));
  if (!inquiries || inquiries.length === 0) {
    inquiries = defaultInquiries;
    localStorage.setItem("mjsd_inquiries", JSON.stringify(inquiries));
  }

  // Load gallery
  galleryItems = JSON.parse(localStorage.getItem("mjsd_gallery"));
  if (!galleryItems || galleryItems.length === 0) {
    galleryItems = defaultGalleryItems;
    localStorage.setItem("mjsd_gallery", JSON.stringify(galleryItems));
  }

  // Redraw all components
  updateCounters();
  renderOverviewBookings();
  renderOverviewInbox();
  renderFullBookingsTable();
  renderFullInboxList();
  renderAdminGallery();
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
