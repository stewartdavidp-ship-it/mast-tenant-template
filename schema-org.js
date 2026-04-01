/**
 * Schema.org JSON-LD Generator for Mast Tenant Public Pages
 *
 * Generates structured data markup from tenant data loaded by each page.
 * Call the appropriate generator after page data loads, then inject().
 *
 * Usage:
 *   MastSchema.inject(MastSchema.organization());
 *   MastSchema.inject(MastSchema.product(productData));
 *   MastSchema.injectAll(MastSchema.eventList(events));
 */
(function() {
  'use strict';

  function getBaseUrl() {
    return window.location.origin;
  }

  function getBrand() {
    return window.TENANT_BRAND || {};
  }

  // --- Injection ---

  function inject(jsonLd) {
    if (!jsonLd) return;
    var script = document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute('data-mast-schema', '');
    script.textContent = JSON.stringify(jsonLd);
    document.head.appendChild(script);
  }

  function injectAll(jsonLdArray) {
    if (!jsonLdArray || !jsonLdArray.length) return;
    jsonLdArray.forEach(function(item) { inject(item); });
  }

  // --- Helpers ---

  function mapAvailability(p) {
    if (p.availability === 'sold') return 'https://schema.org/SoldOut';
    if (p.availability === 'discontinued') return 'https://schema.org/Discontinued';
    var si = p.stockInfo;
    if (si) {
      var eff = (si.totalAvailable || 0) - (si.totalReserved || 0);
      if (eff <= 0) return 'https://schema.org/OutOfStock';
    }
    return 'https://schema.org/InStock';
  }

  function formatPrice(cents) {
    if (!cents || cents <= 0) return null;
    return (cents / 100).toFixed(2);
  }

  function extractImages(p) {
    if (p.images && p.images.length) {
      return p.images.map(function(img) {
        return typeof img === 'string' ? img : (img.url || '');
      }).filter(Boolean);
    }
    if (p.image) return [p.image];
    return [];
  }

  // --- Generators ---

  function organization() {
    var brand = getBrand();
    var base = getBaseUrl();
    var schema = {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: brand.name || '',
      url: base
    };

    if (brand.description) schema.description = brand.description;
    else if (brand.tagline) schema.description = brand.tagline;

    var sameAs = [];
    if (brand.instagramUrl) sameAs.push(brand.instagramUrl);
    if (brand.etsyUrl) sameAs.push(brand.etsyUrl);
    if (sameAs.length) schema.sameAs = sameAs;

    if (brand.contactEmail) {
      schema.contactPoint = {
        '@type': 'ContactPoint',
        email: brand.contactEmail,
        contactType: 'customer service'
      };
    }

    if (brand.location) {
      schema.address = {
        '@type': 'PostalAddress',
        addressLocality: brand.location
      };
    }

    return schema;
  }

  function product(p, saleInfo) {
    var base = getBaseUrl();
    var pid = p.pid || p.id || '';
    var priceCents = p.priceCents || (p.price ? Math.round(p.price * 100) : 0);

    var schema = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: p.name || '',
      url: base + '/product.html?id=' + encodeURIComponent(pid)
    };

    if (p.description) schema.description = p.description;

    var images = extractImages(p);
    if (images.length) schema.image = images.length === 1 ? images[0] : images;

    var brand = getBrand();
    if (brand.name) {
      schema.brand = { '@type': 'Brand', name: brand.name };
    }

    // Offers — handle variants
    if (p.variants && p.variants.length > 1) {
      var prices = p.variants.map(function(v) {
        return v.priceCents || priceCents;
      }).filter(function(c) { return c > 0; });

      if (prices.length) {
        var lo = Math.min.apply(null, prices);
        var hi = Math.max.apply(null, prices);
        schema.offers = {
          '@type': 'AggregateOffer',
          lowPrice: formatPrice(lo),
          highPrice: formatPrice(hi),
          priceCurrency: 'USD',
          availability: mapAvailability(p),
          offerCount: prices.length
        };
      }
    } else {
      var effectivePrice = priceCents;
      // Apply sale pricing if provided
      if (saleInfo && saleInfo.discountType) {
        if (saleInfo.discountType === 'percent') {
          effectivePrice = Math.round(priceCents * (1 - saleInfo.discountValue / 100));
        } else if (saleInfo.discountType === 'fixed') {
          effectivePrice = Math.max(0, priceCents - saleInfo.discountValue);
        }
      }
      var price = formatPrice(effectivePrice);
      if (price) {
        schema.offers = {
          '@type': 'Offer',
          price: price,
          priceCurrency: 'USD',
          availability: mapAvailability(p),
          url: schema.url
        };
      }
    }

    return schema;
  }

  function productList(products, pageName) {
    var base = getBaseUrl();
    var brand = getBrand();
    return {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: pageName || 'Shop',
      url: base + '/shop.html',
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: products.length,
        itemListElement: products.slice(0, 30).map(function(p, i) {
          var s = product(p);
          delete s['@context'];
          return {
            '@type': 'ListItem',
            position: i + 1,
            item: s
          };
        })
      }
    };
  }

  function event(e) {
    var schema = {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: e.name || '',
      startDate: e.date || ''
    };

    if (e.dateEnd) schema.endDate = e.dateEnd;
    if (e.description) schema.description = e.description;
    if (e.location) {
      schema.location = { '@type': 'Place', name: e.location };
    }
    if (e.url) schema.url = e.url;

    var brand = getBrand();
    if (brand.name) {
      schema.organizer = { '@type': 'Organization', name: brand.name };
    }

    return schema;
  }

  function eventList(events) {
    return events.filter(function(e) {
      return e.visible !== false;
    }).map(function(e) {
      return event(e);
    });
  }

  function course(cls) {
    var brand = getBrand();
    var base = getBaseUrl();
    var priceCents = cls.priceCents || (cls.price ? Math.round(cls.price * 100) : 0);

    var schema = {
      '@context': 'https://schema.org',
      '@type': 'Course',
      name: cls.name || '',
      url: base + '/class-detail.html?id=' + encodeURIComponent(cls.id || '')
    };

    if (cls.description) schema.description = cls.description;

    if (brand.name) {
      schema.provider = { '@type': 'Organization', name: brand.name };
    }

    if (cls.instructorName) {
      schema.instructor = { '@type': 'Person', name: cls.instructorName };
    }

    if (cls.duration) {
      schema.timeRequired = 'PT' + cls.duration + 'M';
    }

    var price = formatPrice(priceCents);
    if (price) {
      schema.offers = {
        '@type': 'Offer',
        price: price,
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock'
      };
    }

    return schema;
  }

  function courseWithSessions(cls, sessions) {
    var schema = course(cls);
    if (sessions && sessions.length) {
      schema.hasCourseInstance = sessions.map(function(s) {
        var instance = {
          '@type': 'CourseInstance',
          courseMode: 'https://schema.org/OnSite'
        };
        if (s.date) instance.startDate = s.date;
        if (s.time) instance.startDate = (s.date || '') + 'T' + s.time;
        if (cls.duration) instance.duration = 'PT' + cls.duration + 'M';
        return instance;
      });
    }
    return schema;
  }

  function courseList(classes) {
    return classes.filter(function(cls) {
      return cls.status === 'active' || !cls.status;
    }).map(function(cls) {
      return course(cls);
    });
  }

  function breadcrumbList(items) {
    return {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items.map(function(item, i) {
        var el = {
          '@type': 'ListItem',
          position: i + 1,
          name: item.name
        };
        if (item.url) el.item = item.url;
        return el;
      })
    };
  }

  // --- Public API ---
  window.MastSchema = {
    inject: inject,
    injectAll: injectAll,
    organization: organization,
    product: product,
    productList: productList,
    event: event,
    eventList: eventList,
    course: course,
    courseWithSessions: courseWithSessions,
    courseList: courseList,
    breadcrumbList: breadcrumbList
  };
})();
