/**
 * Storefront Content Injection
 *
 * Runs after tenant-brand.js. Reads webPresence/config/sections from
 * tenant RTDB and injects admin-configured content into public pages.
 *
 * Elements use data-content attributes to mark injectable content:
 *   data-content="hero-headline"       → sections.hero.headline
 *   data-content="hero-subheadline"    → sections.hero.subheadline
 *   data-content="hero-tagline"        → brand tagline (hero context)
 *   data-content="hero-cta"            → sections.hero.ctaText
 *   data-content="about-heading"       → sections.about.heading
 *   data-content="about-body"          → sections.about.body
 *   data-content="about-label"         → sections.about label text
 *   data-content="contact-heading"     → sections.contact.heading
 *   data-content="contact-label"       → sections.contact label text
 *   data-content="contact-subtitle"    → sections.contact subtitle
 *   data-content="gallery-heading"     → sections.gallery.heading
 *   data-content="gallery-label"       → sections.gallery label
 *   data-content="gallery-subtitle"    → sections.gallery subtitle
 *   data-content="newsletter-heading"  → sections.newsletter.heading
 *   data-content="newsletter-subheadline" → sections.newsletter.subheadline
 *   data-content="newsletter-button"   → sections.newsletter.buttonLabel
 *
 * Content injection only applies non-empty values — if the admin hasn't
 * configured a field, the existing HTML placeholder remains untouched.
 * This allows tenant-brand.js to still provide brand name/tagline fallbacks.
 *
 * Priority: storefront-content.js runs AFTER tenant-brand.js, so content
 * config values override brand fallbacks when both exist.
 */

(function() {
  if (typeof window.TENANT_READY === 'undefined') return;

  // Skip admin app pages
  if (window.location.pathname.indexOf('/app') === 0) return;

  window.TENANT_READY.then(function() {
    var tenantId = window.TENANT_ID;
    var config = window.TENANT_FIREBASE_CONFIG;
    if (!tenantId || !config || !config.databaseURL) return;

    // Ensure DOM is loaded
    var domReady = new Promise(function(resolve) {
      if (document.readyState !== 'loading') resolve();
      else document.addEventListener('DOMContentLoaded', resolve);
    });

    // Fetch sections config from tenant RTDB (world-readable under public rules)
    var sectionsUrl = config.databaseURL + '/' + tenantId + '/webPresence/config/sections.json';
    var sectionsReady = fetch(sectionsUrl)
      .then(function(resp) { return resp.ok ? resp.json() : null; })
      .catch(function() { return null; });

    Promise.all([sectionsReady, domReady]).then(function(results) {
      var sections = results[0];
      if (!sections) return;

      applyContent(sections);
    });
  });

  function applyContent(sections) {
    // Build a flat map of data-content key → value from the sections config
    var contentMap = {};

    if (sections.hero) {
      if (sections.hero.headline) contentMap['hero-headline'] = sections.hero.headline;
      if (sections.hero.subheadline) contentMap['hero-subheadline'] = sections.hero.subheadline;
      if (sections.hero.ctaText) contentMap['hero-cta'] = sections.hero.ctaText;
    }

    if (sections.about) {
      if (sections.about.heading) contentMap['about-heading'] = sections.about.heading;
      if (sections.about.body) contentMap['about-body'] = sections.about.body;
    }

    if (sections.gallery) {
      if (sections.gallery.heading) contentMap['gallery-heading'] = sections.gallery.heading;
    }

    if (sections.contact) {
      if (sections.contact.heading) contentMap['contact-heading'] = sections.contact.heading;
    }

    if (sections.newsletter) {
      if (sections.newsletter.heading) contentMap['newsletter-heading'] = sections.newsletter.heading;
      if (sections.newsletter.subheadline) contentMap['newsletter-subheadline'] = sections.newsletter.subheadline;
      if (sections.newsletter.buttonLabel) contentMap['newsletter-button'] = sections.newsletter.buttonLabel;
    }

    // Apply values to matching data-content elements
    var elements = document.querySelectorAll('[data-content]');
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      var key = el.getAttribute('data-content');
      if (contentMap[key]) {
        el.textContent = contentMap[key];
        el.setAttribute('data-content-applied', '1');
      }
    }

    // Hero styling controls (headline size, text position)
    if (sections.hero) {
      var heroSize = sections.hero.headlineSize || 'medium';
      var heroAlign = sections.hero.textAlign || 'center';

      var sizeMap = {
        small: 'clamp(1.8rem, 4vw, 3rem)',
        medium: '',
        large: 'clamp(3.5rem, 8vw, 6rem)',
        xl: 'clamp(4.5rem, 12vw, 9rem)'
      };

      if (sizeMap[heroSize]) {
        document.querySelectorAll('.hero h1, .hero-minimal-headline').forEach(function(el) {
          el.style.fontSize = sizeMap[heroSize];
        });
      }

      if (heroAlign !== 'center') {
        var alignItems = heroAlign === 'left' ? 'flex-start' : 'flex-end';
        document.querySelectorAll('.hero-content, .hero-split-content, .hero-minimal').forEach(function(el) {
          el.style.textAlign = heroAlign;
          el.style.alignItems = alignItems;
        });
      }
    }

    // Handle about image separately (it's an img src, not textContent)
    if (sections.about && sections.about.imageUrl) {
      var aboutImg = document.querySelector('[data-slot="about"] .about-image img');
      if (aboutImg) {
        aboutImg.src = sections.about.imageUrl;
        aboutImg.style.display = '';
      }
    }

    // Dispatch event for page-specific JS
    window.dispatchEvent(new CustomEvent('storefront-content-ready', { detail: sections }));
  }
})();
