// ===== NAVBAR SCROLL =====
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 50);
  document.getElementById('backToTop').classList.toggle('show', window.scrollY > 400);
  document.getElementById('floatCall').classList.toggle('show', window.scrollY > 400);
});

// ===== HAMBURGER =====
const hamburger = document.getElementById('hamburger');
const navLinks = document.getElementById('navLinks');
hamburger.addEventListener('click', () => navLinks.classList.toggle('open'));
document.querySelectorAll('.nav-links a').forEach(a => {
  a.addEventListener('click', () => navLinks.classList.remove('open'));
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

document.querySelectorAll('.service-card, .review-card, .gallery-item, .why-item, .info-card, .stat').forEach(el => {
  el.classList.add('animate');
  observer.observe(el);
});

// ===== ACTIVE NAV LINK ON SCROLL =====
const sections = document.querySelectorAll('section[id]');
window.addEventListener('scroll', () => {
  let current = '';
  sections.forEach(section => {
    if (window.scrollY >= section.offsetTop - 120) current = section.id;
  });
  document.querySelectorAll('.nav-links a').forEach(link => {
    link.style.color = link.getAttribute('href') === `#${current}` ? '#fff' : '';
  });
});
