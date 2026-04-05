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

    if (p.sku) schema.sku = p.sku;
    if (p.materials && Array.isArray(p.materials) && p.materials.length) {
      schema.material = p.materials.join(', ');
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

  // --- Blog ---

  function blogPosting(post) {
    var brand = getBrand();
    var base = getBaseUrl();
    var schema = {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title || '',
      url: base + '/blog/post.html?id=' + encodeURIComponent(post._id || post.id || '')
    };

    if (post.publishedAt) schema.datePublished = post.publishedAt;
    if (post.updatedAt) schema.dateModified = post.updatedAt;
    if (post.bodyHtml) {
      // Strip HTML for description, truncate to 200 chars
      var tmp = document.createElement('div');
      tmp.innerHTML = post.bodyHtml;
      var text = (tmp.textContent || tmp.innerText || '').trim();
      if (text) schema.description = text.substring(0, 200);
    }
    if (post.excerpt) schema.description = post.excerpt;

    if (post.author) {
      schema.author = { '@type': 'Person', name: post.author };
    }

    if (brand.name) {
      schema.publisher = { '@type': 'Organization', name: brand.name };
    }

    if (post.image || post.coverImage) {
      schema.image = post.image || post.coverImage;
    }

    if (post.tags && post.tags.length) {
      schema.keywords = Array.isArray(post.tags) ? post.tags.join(', ') : post.tags;
    }

    return schema;
  }

  function blogList(posts) {
    return posts.filter(function(p) {
      return p.title;
    }).map(function(p) {
      return blogPosting(p);
    });
  }

  // --- Gift Cards ---

  function giftCardList(config) {
    var brand = getBrand();
    var base = getBaseUrl();
    var denoms = config.giftCardDenominations || [];
    if (!denoms.length) return [];

    return denoms.map(function(cents) {
      var price = formatPrice(cents);
      if (!price) return null;
      return {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: (brand.name || '') + ' Gift Card — $' + (cents / 100).toFixed(0),
        url: base + '/gift-cards.html',
        description: 'Digital gift card for ' + (brand.name || 'this shop'),
        brand: brand.name ? { '@type': 'Brand', name: brand.name } : undefined,
        offers: {
          '@type': 'Offer',
          price: price,
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock'
        }
      };
    }).filter(Boolean);
  }

  // --- Membership ---

  function membership(config) {
    var brand = getBrand();
    var base = getBaseUrl();
    var price = config.annualPrice ? formatPrice(config.annualPrice) : null;

    var schema = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: (config.programName || 'Membership') + ' — ' + (brand.name || ''),
      url: base + '/membership.html',
      description: 'Annual membership program'
    };

    var benefits = [];
    if (config.productDiscountPct) benefits.push(config.productDiscountPct + '% off products');
    if (config.serviceDiscountPct) benefits.push(config.serviceDiscountPct + '% off services');
    if (config.freeShippingThreshold === 0) benefits.push('Free shipping');
    if (config.loyaltyMultiplier && config.loyaltyMultiplier > 1) benefits.push(config.loyaltyMultiplier + 'x loyalty points');
    if (benefits.length) schema.description = benefits.join(', ');

    if (brand.name) {
      schema.brand = { '@type': 'Brand', name: brand.name };
    }

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

  // --- Service (Commissions) ---

  function service(name, description) {
    var brand = getBrand();
    var base = getBaseUrl();
    var schema = {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: name || 'Custom Commission',
      url: base + '/commission.html',
      serviceType: 'Custom artwork commission'
    };

    if (description) schema.description = description;

    if (brand.name) {
      schema.provider = { '@type': 'Organization', name: brand.name };
    }

    return schema;
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
    breadcrumbList: breadcrumbList,
    blogPosting: blogPosting,
    blogList: blogList,
    giftCardList: giftCardList,
    membership: membership,
    service: service
  };
})();
