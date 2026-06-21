// ===== SECURITY UTILITIES =====
// Escapes special HTML characters to prevent XSS attacks.
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

// Shop WhatsApp number used to actually DELIVER form submissions.
// (localStorage only persists data in the visitor's own browser — it never
// reaches the business. Opening a pre-filled WhatsApp chat does.)
const SHOP_WHATSAPP = '255694666888';
function sendToWhatsApp(lines) {
  const text = encodeURIComponent(lines.filter(Boolean).join('\n'));
  // Opened synchronously inside the submit handler so the user gesture is kept
  // and the browser doesn't block it as a pop-up.
  window.open(`https://wa.me/${SHOP_WHATSAPP}?text=${text}`, '_blank', 'noopener');
}

// Rate limiter — prevents form spam. Returns true if allowed, false if throttled.
const _rateLimits = {};
function rateLimitCheck(key, limitMs = 60000) {
  const now = Date.now();
  if (_rateLimits[key] && (now - _rateLimits[key]) < limitMs) {
    return false;
  }
  _rateLimits[key] = now;
  return true;
}

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
      itemEl.dataset.cat = sanitize(item.cat);

      // Use safe DOM methods — never inject unsanitized innerHTML
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = sanitize(item.img);
      img.alt = sanitize(item.alt);
      img.onerror = () => { img.src = `https://placehold.co/600x450/16213e/ffffff?text=${encodeURIComponent(sanitize(item.title))}`; };

      const overlay = document.createElement('div');
      overlay.className = 'gallery-overlay';
      const span = document.createElement('span');
      span.textContent = sanitize(item.title); // textContent is always XSS-safe
      overlay.appendChild(span);

      itemEl.appendChild(img);
      itemEl.appendChild(overlay);
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

    // Rate limit: one booking submission per 60 seconds
    if (!rateLimitCheck('booking_submit', 60000)) {
      alert('Please wait a moment before submitting again.');
      return;
    }

    const btn = document.getElementById('submitBtn');
    btn.textContent = 'Processing...';
    btn.disabled = true;

    // Capture and sanitize booking data
    const getValue = (id) => sanitize(document.getElementById(id)?.value?.trim() || '');
    const booking = {
      id: 'BK-' + Date.now().toString().slice(-6),
      fname: getValue('fname'),
      lname: getValue('lname'),
      phone: getValue('phone'),
      email: getValue('email') || 'N/A',
      vehicle: getValue('vehicle'),
      service: getValue('service'),
      date: getValue('date'),
      time: getValue('time'),
      notes: getValue('notes') || 'No notes',
      status: 'Pending',
      createdAt: new Date().toLocaleString()
    };

    // Validate phone is numeric
    if (!/^[\d\s\+\-]{7,15}$/.test(booking.phone)) {
      alert('Please enter a valid phone number.');
      btn.textContent = 'Confirm Appointment ✓';
      btn.disabled = false;
      return;
    }

    // Save to localStorage (so the Staff Portal dashboard can list it too)
    const existingBookings = JSON.parse(localStorage.getItem('mjsd_bookings')) || [];
    existingBookings.unshift(booking);
    localStorage.setItem('mjsd_bookings', JSON.stringify(existingBookings));

    // Deliver the booking to the shop via WhatsApp
    sendToWhatsApp([
      `🔧 *New Booking Request* (${booking.id})`,
      `Name: ${booking.fname} ${booking.lname}`,
      `Phone: ${booking.phone}`,
      `Email: ${booking.email}`,
      `Vehicle: ${booking.vehicle}`,
      `Service: ${booking.service}`,
      `Date: ${booking.date} at ${booking.time}`,
      `Notes: ${booking.notes}`
    ]);

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

    // Rate limit: one inquiry per 60 seconds
    if (!rateLimitCheck('inquiry_submit', 60000)) {
      alert('Please wait a moment before submitting again.');
      return;
    }

    const btn = inquiryForm.querySelector('button[type="submit"]');
    btn.textContent = 'Sending...';
    btn.disabled = true;

    // Capture and sanitize inquiry data
    const getVal = (id) => sanitize(document.getElementById(id)?.value?.trim() || '');
    const inquiry = {
      id: 'INQ-' + Date.now().toString().slice(-6),
      name: getVal('iname'),
      phone: getVal('iphone'),
      subject: getVal('isubject') || 'General Inquiry',
      message: getVal('imessage'),
      status: 'Unread',
      createdAt: new Date().toLocaleString()
    };

    // Save to localStorage (so the Staff Portal dashboard can list it too)
    const existingInquiries = JSON.parse(localStorage.getItem('mjsd_inquiries')) || [];
    existingInquiries.unshift(inquiry);
    localStorage.setItem('mjsd_inquiries', JSON.stringify(existingInquiries));

    // Deliver the inquiry to the shop via WhatsApp
    sendToWhatsApp([
      `✉️ *New Inquiry* (${inquiry.id})`,
      `Name: ${inquiry.name}`,
      `Phone: ${inquiry.phone}`,
      `Subject: ${inquiry.subject}`,
      `Message: ${inquiry.message}`
    ]);

    setTimeout(() => {
      inquiryForm.style.display = 'none';
      inquirySuccess.classList.add('show');
    }, 1000);
  });
}

// ===== SCROLL ENGINE (GSAP only — native scrolling) =====
// Lenis smooth scroll is intentionally disabled: it was causing jumpy/stuck
// scrolling. The browser's native scrolling is used instead, and GSAP's
// ScrollTrigger reads native scroll directly (its default), so all the
// scroll-driven animations keep working.
if (window.gsap && window.ScrollTrigger) {
  gsap.registerPlugin(ScrollTrigger);
}

// 3. Register Scroll Animations with GSAP
function registerAnimations() {
  const animateElements = document.querySelectorAll('.service-card, .review-card, .gallery-item, .why-item, .info-card, .stat, .brands-section, .brands-ticker-wrap, .brands-grid-wrap, .model-search-wrap, .animate');
  
  if (window.gsap && window.ScrollTrigger) {
    animateElements.forEach(el => {
      // Add hardware acceleration hint
      el.classList.add('animate');
      
      gsap.from(el, {
        scrollTrigger: {
          trigger: el,
          start: "top 85%", // when top of element hits 85% down viewport
          toggleActions: "play none none reverse" // play when entering, reverse when leaving
        },
        opacity: 0,
        y: 40,
        duration: 0.8,
        ease: "power2.out"
      });
    });
  } else {
    // Fallback if GSAP fails to load
    animateElements.forEach(el => el.classList.add('animate', 'visible'));
  }
}
registerAnimations();

// ===== PHASE 4: IMAGE SEQUENCE SCRUBBING =====
function initSequenceScrubbing() {
  const canvas = document.getElementById("hero-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  
  // Set canvas resolution
  canvas.width = 1280;
  canvas.height = 720;

  const frameCount = 120;
  const images = [];
  
  // Preload all frames
  for (let i = 0; i < frameCount; i++) {
    const img = new Image();
    img.src = `./frames/frame-${String(i).padStart(4, "0")}.svg`;
    images.push(img);
  }

  function renderFrame(index) {
    if (!images[index]) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (images[index].complete && images[index].naturalHeight !== 0) {
      ctx.drawImage(images[index], 0, 0, canvas.width, canvas.height);
    } else {
      images[index].onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(images[index], 0, 0, canvas.width, canvas.height);
      };
    }
  }

  // Initial render when first image loads
  images[0].onload = () => renderFrame(0);
  
  // If already loaded
  if (images[0].complete) {
    renderFrame(0);
  }

  // GSAP scrubs the frame index as the section passes through the viewport.
  // No pin: pinning hijacks the scroll and makes the page feel stuck. This
  // scrubs naturally while you keep scrolling, so the page never sticks.
  if (window.gsap && window.ScrollTrigger) {
    gsap.to({ frame: 0 }, {
      frame: frameCount - 1,
      snap: "frame",
      ease: "none",
      scrollTrigger: {
        trigger: ".sequence-section",
        start: "top bottom", // begin when the section first enters from below
        end: "bottom top",   // finish when it has fully passed above
        scrub: 0.5
      },
      onUpdate: function() {
        renderFrame(Math.round(this.targets()[0].frame));
      }
    });
  }
}
// Lazy-init: only preload the 120 sequence frames once the section is near
// the viewport, so they don't compete with the hero/above-the-fold content
// on first load (important for mobile-data visitors).
(function lazyInitSequence() {
  const sec = document.querySelector('.sequence-section');
  if (!sec) return;
  if (!('IntersectionObserver' in window)) { initSequenceScrubbing(); return; }
  const io = new IntersectionObserver((entries, obs) => {
    if (entries.some(e => e.isIntersecting)) {
      initSequenceScrubbing();
      obs.disconnect();
    }
  }, { rootMargin: '600px 0px' });
  io.observe(sec);
})();

// ===== DYNAMIC COPYRIGHT YEAR =====
(function setCopyrightYear() {
  const el = document.getElementById('copyYear');
  if (el) el.textContent = new Date().getFullYear();
})();

// ===== ACTIVE NAV LINK ON SCROLL =====
// Toggle an `.active` class (styled in CSS) rather than writing inline styles,
// so there is a single source of truth and no stale inline colors left behind.
const sections = document.querySelectorAll('main section[id], body > section[id]');
const topLevelLinks = document.querySelectorAll('.nav-links > a, .nav-dropdown > .dropdown-trigger');
window.addEventListener('scroll', () => {
  let current = '';
  sections.forEach(section => {
    if (window.scrollY >= section.offsetTop - 150) current = section.id;
  });
  topLevelLinks.forEach(link => {
    link.classList.toggle('active', link.getAttribute('href') === `#${current}`);
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
  // Make the <div> a real, keyboard-operable control
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `Book a service for ${card.dataset.brand}`);

  const selectBrand = () => {
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
  };

  card.addEventListener('click', selectBrand);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectBrand();
    }
  });
});

// ===== SERVICES DROPDOWN → PRESELECT SERVICE + JUMP TO BOOKING =====
document.querySelectorAll('.dropdown-menu a[data-service]').forEach(link => {
  link.addEventListener('click', () => {
    const serviceSelect = document.getElementById('service');
    if (serviceSelect) {
      const wanted = link.dataset.service;
      // Match against an existing <option> if present
      [...serviceSelect.options].forEach(opt => {
        if (opt.value === wanted || opt.textContent.trim() === wanted) {
          serviceSelect.value = opt.value || opt.textContent.trim();
        }
      });
    }
    // Close the mobile menu/dropdown after choosing
    if (servicesDropdown) servicesDropdown.classList.remove('active');
    navLinks.classList.remove('open');
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

    // Build suggestions using safe DOM methods — no innerHTML with user input
    searchSuggestions.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'suggestions-title';
    const list = document.createElement('div');
    list.className = 'suggestions-list';

    const addPill = (label, vehicleValue) => {
      const pill = document.createElement('div');
      pill.className = 'suggestion-pill';
      pill.textContent = label; // textContent is always XSS-safe
      pill.dataset.vehicle = vehicleValue;
      pill.setAttribute('role', 'button');
      pill.setAttribute('tabindex', '0');
      const choosePill = () => {
        const vehicleInput = document.getElementById('vehicle');
        if (vehicleInput) { vehicleInput.value = vehicleValue; vehicleInput.focus(); }
        searchSuggestions.style.display = 'none';
        searchSuggestions.innerHTML = '';
        modelSearchInput.value = '';
        const bookingSection = document.getElementById('booking');
        if (bookingSection) bookingSection.scrollIntoView({ behavior: 'smooth' });
      };
      pill.addEventListener('click', choosePill);
      pill.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choosePill(); }
      });
      list.appendChild(pill);
    };

    if (matches.length > 0) {
      title.textContent = 'Matching Cars found:';
      matches.slice(0, 8).forEach(m => addPill(`${m.brand} ${m.model}`, `${m.brand} ${m.model}`));
    } else {
      title.textContent = 'No exact match found — you can still book any model!';
      title.style.color = 'var(--red-light)';
      // Limit raw user input: only pass if safe (max 60 chars, alphanumeric + spaces)
      const safeQuery = query.replace(/[^a-zA-Z0-9\s\-]/g, '').slice(0, 60);
      if (safeQuery) addPill(`Book "${safeQuery}" Anyway ➔`, safeQuery);
    }

    searchSuggestions.appendChild(title);
    searchSuggestions.appendChild(list);
    searchSuggestions.style.display = 'block';
  });

  // Close suggestions if user clicks outside
  document.addEventListener('click', (e) => {
    if (!modelSearchInput.contains(e.target) && !searchSuggestions.contains(e.target)) {
      searchSuggestions.style.display = 'none';
    }
  });
}

// ===== CINEMATIC LAYER (added) =====
// Injects film grain, vignette, and a scroll-progress scrubber, plus
// hero parallax and magnetic buttons. Everything degrades gracefully
// and respects the user's reduced-motion preference.
(function cinematicLayer() {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- Inject overlay elements once ---
  const makeOverlay = (cls) => {
    const el = document.createElement('div');
    el.className = cls;
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    return el;
  };
  const progress = makeOverlay('scroll-progress');
  makeOverlay('cine-vignette');
  if (!reduceMotion) makeOverlay('cine-grain');

  // --- Scroll progress bar ---
  // Cache the scroll range and recompute only on resize, so the scroll
  // handler never forces a synchronous layout (which causes jank).
  const doc = document.documentElement;
  let scrollMax = 1;
  function measure() { scrollMax = Math.max(1, doc.scrollHeight - doc.clientHeight); }
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY || doc.scrollTop;
      progress.style.width = Math.min(100, (y / scrollMax) * 100) + '%';
      ticking = false;
    });
  }
  measure();
  window.addEventListener('resize', measure, { passive: true });
  window.addEventListener('load', measure);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // --- Magnetic buttons: subtly lean toward the cursor ---
  if (!reduceMotion && window.matchMedia('(pointer:fine)').matches) {
    document.querySelectorAll('.btn-primary, .btn-outline').forEach((btn) => {
      btn.addEventListener('mousemove', (e) => {
        const r = btn.getBoundingClientRect();
        const mx = e.clientX - (r.left + r.width / 2);
        const my = e.clientY - (r.top + r.height / 2);
        btn.style.transform = `translate(${mx * 0.18}px, ${my * 0.28}px)`;
      });
      btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
    });
  }

  // --- Cinematic entrance for major section headings via GSAP ---
  if (window.gsap && window.ScrollTrigger && !reduceMotion) {
    document.querySelectorAll('.section-header, .sequence-content').forEach((el) => {
      gsap.from(el, {
        scrollTrigger: { trigger: el, start: 'top 80%', toggleActions: 'play none none reverse' },
        opacity: 0, y: 60, scale: 0.98, duration: 1, ease: 'power3.out'
      });
    });
  }
})();

// ===== SITE IMAGE OVERRIDES (added) =====
// Lets staff replace the fixed site imagery (hero, service cards, team photo)
// with real photos uploaded via the Staff Portal. Overrides are stored as
// data-URLs in localStorage['mjsd_site_images'] keyed by slot.
function applySiteImageOverrides() {
  let map = {};
  try { map = JSON.parse(localStorage.getItem('mjsd_site_images')) || {}; }
  catch (e) { map = {}; }

  // Hero background — painted by .hero::before via the --hero-img variable
  const hero = document.querySelector('.hero');
  if (hero && map.hero) {
    hero.style.setProperty('--hero-img', `url("${map.hero}")`);
  }

  // Six service-card images, in DOM order
  const serviceKeys = ['svc_engine', 'svc_brakes', 'svc_oil', 'svc_susp', 'svc_maint', 'svc_elec'];
  const serviceImgs = document.querySelectorAll('.services-grid .service-card .service-img');
  serviceImgs.forEach((el, i) => {
    const data = map[serviceKeys[i]];
    if (data) {
      // CSS sets these backgrounds with !important, so override at the same weight
      el.style.setProperty('background-image', `url("${data}")`, 'important');
      el.style.setProperty('background-size', 'cover', 'important');
      el.style.setProperty('background-position', 'center', 'important');
    }
  });

  // Team photo in the "Why Us" section
  const teamImg = document.querySelector('.why-image img');
  if (teamImg && map.team) teamImg.src = map.team;
}
applySiteImageOverrides();
