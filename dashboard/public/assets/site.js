/* ==========================================================================
   Seevora AI Voice - Public Site Interactive Script (site.js)
   Mobile navigation, active tab detection, session state sync
   ========================================================================== */
(function() {
  'use strict';

  document.addEventListener('DOMContentLoaded', function() {
    // 1. Mobile Menu Toggle
    const navToggle = document.getElementById('siteNavToggle');
    const mobileDrawer = document.getElementById('siteMobileDrawer');
    if (navToggle && mobileDrawer) {
      navToggle.addEventListener('click', function(e) {
        e.stopPropagation();
        const isOpen = mobileDrawer.classList.toggle('open');
        navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });

      document.addEventListener('click', function(e) {
        if (!mobileDrawer.contains(e.target) && !navToggle.contains(e.target)) {
          mobileDrawer.classList.remove('open');
          navToggle.setAttribute('aria-expanded', 'false');
        }
      });
    }

    // 2. Mark active navigation links
    const currentPath = window.location.pathname.toLowerCase();
    document.querySelectorAll('.site-nav-link, .site-mobile-link').forEach(function(link) {
      const href = (link.getAttribute('href') || '').toLowerCase();
      if ((href === '/' && (currentPath === '/' || currentPath === '/index.html' || currentPath === '/home.html')) ||
          (href !== '/' && currentPath.includes(href.replace('.html', '')))) {
        link.classList.add('active');
      }
    });

    // 3. Dynamic Session Check: If already signed in, upgrade header CTA to "Go to Dashboard"
    if (document.cookie && document.cookie.includes('rxv_sess=')) {
      document.querySelectorAll('.btn-auth-entry').forEach(function(btn) {
        btn.textContent = 'Go to Dashboard →';
        btn.setAttribute('href', '/app.html');
      });
      document.querySelectorAll('.link-auth-signin').forEach(function(link) {
        link.textContent = 'Studio Console';
        link.setAttribute('href', '/app.html');
      });
    }
  });
})();

