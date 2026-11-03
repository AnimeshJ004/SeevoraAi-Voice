/* ==========================================================================
   Seevora AI Voice - Public Site Interactive Script (site.js)
   Mobile navigation, active tab detection, animations & scroll reveal
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

    // 4. Voice Audio Equalizer Injection
    const liveBadges = document.querySelectorAll('.sim-live-badge');
    liveBadges.forEach(function(badge) {
      if (!badge.querySelector('.audio-equalizer')) {
        const eq = document.createElement('span');
        eq.className = 'audio-equalizer';
        eq.style.marginLeft = '6px';
        eq.innerHTML = '<span class="audio-bar"></span><span class="audio-bar"></span><span class="audio-bar"></span><span class="audio-bar"></span><span class="audio-bar"></span>';
        badge.appendChild(eq);
      }
    });

    // 5. Scroll Reveal with IntersectionObserver
    const animatedElements = document.querySelectorAll(
      '.bento-card, .site-card, .testimonial-card, .pricing-card, .hero-visual-card, .simulator-card, .team-support-card'
    );

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(function(entries, obs) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
            obs.unobserve(entry.target);
          }
        });
      }, {
        threshold: 0.12,
        rootMargin: '0px 0px -40px 0px'
      });

      animatedElements.forEach(function(el, idx) {
        el.classList.add('reveal-on-scroll');
        el.style.transitionDelay = (idx % 3 * 0.1) + 's';
        observer.observe(el);
      });
    } else {
      animatedElements.forEach(function(el) {
        el.classList.add('in-view');
      });
    }

    // 6. Interactive Simulator Dialogue Bubbles
    const bubbles = document.querySelectorAll('.sim-bubble');
    bubbles.forEach(function(bubble, idx) {
      bubble.style.animationDelay = (0.15 + (idx * 0.15)) + 's';
      bubble.addEventListener('mouseenter', function() {
        bubbles.forEach(function(b) { b.style.opacity = '0.65'; });
        bubble.style.opacity = '1';
      });
      bubble.addEventListener('mouseleave', function() {
        bubbles.forEach(function(b) { b.style.opacity = '1'; });
      });
    });
  });
})();
