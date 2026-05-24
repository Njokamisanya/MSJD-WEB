// ===== NAVBAR SCROLL =====
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 50);
  document.getElementById('backToTop').classList.toggle('show', window.scrollY > 400);
  document.getElementById('floatCall').classList.toggle('show', window.scrollY > 400);
});

// ===== HAMBURGER & NAVIGATION DROPDOWN =====
const hamburger = document.getElementById('hamburger');
const navLinks = document.getElementById('navLinks');
const servicesDropdown = document.getElementById('servicesDropdown');

hamburger.addEventListener('click', () => {
  navLinks.classList.toggle('open');
  if (!navLinks.classList.contains('open') && servicesDropdown) {
    servicesDropdown.classList.remove('active');
  }
});

// Dropdown Mobile Toggle Logic
if (servicesDropdown) {
  const trigger = servicesDropdown.querySelector('.dropdown-trigger');
  trigger.addEventListener('click', (e) => {
    if (window.innerWidth <= 768) {
      e.preventDefault();
      servicesDropdown.classList.toggle('active');
    }
  });
}

document.querySelectorAll('.nav-links a').forEach(a => {
  a.addEventListener('click', () => {
    // If clicking a sub-link inside dropdown, close mobile dropdown too
    if (a.closest('.dropdown-menu')) {
      if (servicesDropdown) servicesDropdown.classList.remove('active');
    }
    navLinks.classList.remove('open');
  });
});

// ===== BACK TO TOP =====
document.getElementById('backToTop').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

// ===== DYNAMIC GALLERY & ADMIN UPLOAD =====
const defaultGalleryItems = [
  { cat: 'engine', img: 'engine_diagnosis.png', alt: 'Engine diagnosis on SUV', title: 'Engine Diagnostics – Nissan X-Trail' },
  { cat: 'brakes', img: 'brake_service.png', alt: 'Brake pad replacement', title: 'Brake Service – BMW 3 Series' },
  { cat: 'suspension', img: 'suspension_repair.png', alt: 'Suspension repair', title: 'Suspension Rebuild – Toyota RAV4' },
  { cat: 'engine', img: 'oil_service.png', alt: 'Oil change service', title: 'Full Oil Service – Subaru Forester' },
  { cat: 'engine', img: 'gallery1.png', alt: 'Land Cruiser service', title: 'Full Service – Toyota Land Cruiser' },
  { cat: 'brakes', img: 'gallery2.png', alt: 'Mercedes inspection', title: 'Full Inspection – Mercedes-Benz C200' }
];

let galleryItems = JSON.parse(localStorage.getItem('mjsd_gallery')) || defaultGalleryItems;
if (!localStorage.getItem('mjsd_gallery')) {
  localStorage.setItem('mjsd_gallery', JSON.stringify(defaultGalleryItems));
}

const galleryGrid = document.getElementById('galleryGrid');

function renderGallery(filter = 'all') {
  if (!galleryGrid) return;
  galleryGrid.innerHTML = '';
  
  galleryItems.forEach(item => {
    if (filter === 'all' || item.cat === filter) {
      const itemEl = document.createElement('div');
      itemEl.className = 'gallery-item animate visible';
      itemEl.dataset.cat = item.cat;
      itemEl.innerHTML = `
        <img src="${item.img}" alt="${item.alt}" onerror="this.src='https://placehold.co/600x450/16213e/ffffff?text=${encodeURIComponent(item.title)}'">
        <div class="gallery-overlay"><span>${item.title}</span></div>
      `;
      galleryGrid.appendChild(itemEl);
    }
  });
}

// Initial render
renderGallery();

// Gallery filter click handlers
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderGallery(btn.dataset.filter);
  });
});

// ===== BOOKING FORM PERSISTENCE =====
const bookingForm = document.getElementById('bookingForm');
const bookingSuccess = document.getElementById('bookingSuccess');

if (bookingForm) {
  // Set min date to today
  const today = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('date');
  if (dateInput) dateInput.setAttribute('min', today);

  bookingForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = document.getElementById('submitBtn');
    btn.textContent = 'Processing...';
    btn.disabled = true;

    // Capture booking data
    const booking = {
      id: 'BK-' + Date.now().toString().slice(-6),
      fname: document.getElementById('fname').value,
      lname: document.getElementById('lname').value,
      phone: document.getElementById('phone').value,
      email: document.getElementById('email').value || 'N/A',
      vehicle: document.getElementById('vehicle').value,
      service: document.getElementById('service').value,
      date: document.getElementById('date').value,
      time: document.getElementById('time').value,
      notes: document.getElementById('notes').value || 'No notes',
      status: 'Pending',
      createdAt: new Date().toLocaleString()
    };

    // Save to localStorage
    const existingBookings = JSON.parse(localStorage.getItem('mjsd_bookings')) || [];
    existingBookings.unshift(booking);
    localStorage.setItem('mjsd_bookings', JSON.stringify(existingBookings));

    setTimeout(() => {
      bookingForm.style.display = 'none';
      bookingSuccess.classList.add('show');
    }, 1200);
  });
}

function resetForm() {
  if (bookingForm) {
    bookingForm.reset();
    bookingForm.style.display = 'block';
  }
  if (bookingSuccess) bookingSuccess.classList.remove('show');
  const btn = document.getElementById('submitBtn');
  if (btn) {
    btn.textContent = 'Confirm Appointment ✓';
    btn.disabled = false;
  }
}

// ===== INQUIRY FORM PERSISTENCE =====
const inquiryForm = document.getElementById('inquiryForm');
const inquirySuccess = document.getElementById('inquirySuccess');

if (inquiryForm) {
  inquiryForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = inquiryForm.querySelector('button[type="submit"]');
    btn.textContent = 'Sending...';
    btn.disabled = true;

    // Capture inquiry data
    const inquiry = {
      id: 'INQ-' + Date.now().toString().slice(-6),
      name: document.getElementById('iname').value,
      phone: document.getElementById('iphone').value,
      subject: document.getElementById('isubject').value || 'General Inquiry',
      message: document.getElementById('imessage').value,
      status: 'Unread',
      createdAt: new Date().toLocaleString()
    };

    // Save to localStorage
    const existingInquiries = JSON.parse(localStorage.getItem('mjsd_inquiries')) || [];
    existingInquiries.unshift(inquiry);
    localStorage.setItem('mjsd_inquiries', JSON.stringify(existingInquiries));

    setTimeout(() => {
      inquiryForm.style.display = 'none';
      inquirySuccess.classList.add('show');
    }, 1000);
  });
}

// ===== SCROLL ANIMATIONS =====
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, { threshold: 0.1 });

function registerAnimations() {
  document.querySelectorAll('.service-card, .review-card, .gallery-item, .why-item, .info-card, .stat, .brands-section, .brands-ticker-wrap, .brands-grid-wrap, .model-search-wrap, .animate').forEach(el => {
    el.classList.add('animate');
    observer.observe(el);
  });
}
registerAnimations();

// ===== ACTIVE NAV LINK ON SCROLL =====
const sections = document.querySelectorAll('section[id], div[id]');
window.addEventListener('scroll', () => {
  let current = '';
  sections.forEach(section => {
    if (window.scrollY >= section.offsetTop - 150) current = section.id;
  });
  document.querySelectorAll('.nav-links a').forEach(link => {
    const isActive = link.getAttribute('href') === `#${current}`;
    link.style.color = isActive ? 'var(--red)' : '';
  });
});

// ===== DAY/NIGHT MODE SWITCHER =====
const themeToggleBtn = document.getElementById('themeToggle');
const toggleIcon = themeToggleBtn ? themeToggleBtn.querySelector('.toggle-icon') : null;

// Apply initial theme immediately to avoid flash
function initTheme() {
  const savedTheme = localStorage.getItem('mjsd_theme') || 'dark';
  if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
    if (toggleIcon) toggleIcon.textContent = '☀️';
  } else {
    document.body.classList.remove('light-mode');
    if (toggleIcon) toggleIcon.textContent = '🌙';
  }
}
initTheme();

if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    const isLight = document.body.classList.toggle('light-mode');
    localStorage.setItem('mjsd_theme', isLight ? 'light' : 'dark');
    
    if (toggleIcon) {
      toggleIcon.textContent = isLight ? '☀️' : '🌙';
    }
    
    // Smooth micro-animation click effect
    themeToggleBtn.style.transform = 'scale(0.85) rotate(45deg)';
    setTimeout(() => {
      themeToggleBtn.style.transform = '';
    }, 150);
  });
}

// ===== BRANDS AND VEHICLE MODELS INTERACTIVE REGISTRATION =====
const popularModels = {
  'Toyota': ['Land Cruiser', 'Hilux', 'Prado', 'RAV4', 'Fortuner', 'Harrier', 'Vanguard'],
  'Audi': ['A4', 'A6', 'Q5', 'Q7', 'e-tron', 'Q8', 'A8'],
  'BMW': ['3 Series', '5 Series', 'X3', 'X5', 'X7', 'M5', 'iX'],
  'Mercedes-Benz': ['C-Class', 'E-Class', 'GLC', 'GLE', 'G-Wagon', 'S-Class'],
  'Nissan': ['Patrol', 'Navara', 'X-Trail', 'Qashqai', 'Sylphy', 'Murano'],
  'Subaru': ['Forester', 'Outback', 'Impreza', 'XV', 'Legacy', 'WRX'],
  'Hyundai': ['Tucson', 'Santa Fe', 'Elantra', 'Creta', 'Palisade'],
  'Ford': ['Ranger', 'Everest', 'Explorer', 'F-150', 'Mustang'],
  'Lexus': ['RX350', 'LX570', 'NX200t', 'IS250', 'GX460'],
  'Land Rover': ['Range Rover', 'Defender', 'Discovery', 'Evoque', 'Velar'],
  'Porsche': ['Cayenne', 'Macan', 'Panamera', '911 Carrera', 'Taycan'],
  'Jeep': ['Grand Cherokee', 'Wrangler', 'Cherokee', 'Compass']
};

// Set up showcase card click handlers to automatically populate the booking form
document.querySelectorAll('.brand-showcase-card').forEach(card => {
  card.addEventListener('click', () => {
    // Clear active status and select current
    document.querySelectorAll('.brand-showcase-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    
    const brand = card.dataset.brand;
    const vehicleInput = document.getElementById('vehicle');
    if (vehicleInput) {
      vehicleInput.value = brand;
      vehicleInput.focus();
    }
    
    // Smooth scroll to booking
    const bookingSection = document.getElementById('booking');
    if (bookingSection) {
      bookingSection.scrollIntoView({ behavior: 'smooth' });
    }
  });
});

// Models Search Box Fuzzy Matching
const modelSearchInput = document.getElementById('modelSearchInput');
const searchSuggestions = document.getElementById('searchSuggestions');

if (modelSearchInput && searchSuggestions) {
  modelSearchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    if (!query) {
      searchSuggestions.style.display = 'none';
      searchSuggestions.innerHTML = '';
      return;
    }

    const matches = [];
    Object.entries(popularModels).forEach(([brand, models]) => {
      models.forEach(model => {
        if (model.toLowerCase().includes(query) || brand.toLowerCase().includes(query)) {
          matches.push({ brand, model });
        }
      });
    });

    if (matches.length > 0) {
      searchSuggestions.style.display = 'block';
      searchSuggestions.innerHTML = `
        <div class="suggestions-title">Matching Cars found:</div>
        <div class="suggestions-list">
          ${matches.slice(0, 8).map(m => `
            <div class="suggestion-pill" data-vehicle="${m.brand} ${m.model}">
              ${m.brand} ${m.model}
            </div>
          `).join('')}
        </div>
      `;

      // Attach click events to pills
      searchSuggestions.querySelectorAll('.suggestion-pill').forEach(pill => {
        pill.addEventListener('click', () => {
          const val = pill.dataset.vehicle;
          const vehicleInput = document.getElementById('vehicle');
          if (vehicleInput) {
            vehicleInput.value = val;
            vehicleInput.focus();
          }

          // Clear suggestions and search input
          searchSuggestions.style.display = 'none';
          searchSuggestions.innerHTML = '';
          modelSearchInput.value = '';

          // Smooth scroll to booking
          const bookingSection = document.getElementById('booking');
          if (bookingSection) {
            bookingSection.scrollIntoView({ behavior: 'smooth' });
          }
        });
      });
    } else {
      searchSuggestions.style.display = 'block';
      searchSuggestions.innerHTML = `
        <div class="suggestions-title" style="color: var(--red-light);">No exact matching model found, but you can book any model!</div>
        <div class="suggestions-list">
          <div class="suggestion-pill" data-vehicle="${e.target.value}">
            Book "${e.target.value}" Anyway ➔
          </div>
        </div>
      `;
      
      searchSuggestions.querySelector('.suggestion-pill').addEventListener('click', () => {
        const vehicleInput = document.getElementById('vehicle');
        if (vehicleInput) {
          vehicleInput.value = e.target.value;
          vehicleInput.focus();
        }
        searchSuggestions.style.display = 'none';
        searchSuggestions.innerHTML = '';
        modelSearchInput.value = '';

        const bookingSection = document.getElementById('booking');
        if (bookingSection) {
          bookingSection.scrollIntoView({ behavior: 'smooth' });
        }
      });
    }
  });

  // Close suggestions if user clicks outside
  document.addEventListener('click', (e) => {
    if (!modelSearchInput.contains(e.target) && !searchSuggestions.contains(e.target)) {
      searchSuggestions.style.display = 'none';
    }
  });
}
