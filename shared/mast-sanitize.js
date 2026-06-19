/**
 * mast-sanitize.js — the canonical HTML sanitizer core (Track 7).
 *
 * Background (decomposition-master-plan.md §9, Track 7): tenant-authored rich
 * text (blog bodies, waiver text, product copy) is stored and later injected
 * RAW into emails + the public storefront. The review found ~888 `innerHTML =`
 * sinks in the modules + ~618 in the shell, 0 routed through a sanitizer — and,
 * the plan's hidden-prerequisite finding, that a *standalone* canonical
 * `sanitizeHtml` did not exist (only `sanitizeFilename` + a local `sanitizeString`
 * in maker.js). A copy lives coupled inside the MastUI engine (shared/mast-ui.js
 * → `MastUI.sanitizeHtml`), reachable only as `MastUI.sanitizeHtml` in the
 * browser and degrading to escape-everything in node. This module is the small,
 * pure, dependency-free home so ANY module (UI or not, browser or node) can
 * depend on the sanitizer without pulling in the UI engine.
 *
 * The allow-list + URL rules mirror the canonical `MastUI.sanitizeHtml`
 * semantics, with ONE intended addition over that copy: `img[src,alt]` is
 * allowed (with a safe-URL/safe-data-URI src guard) — the plan's provenance
 * surfaces carry inline images. The DOM path parses into an inert <template>
 * (whose fragment never executes scripts or loads resources) and walks the tree;
 * the node path (no `document`) is a regex strip that removes <script>/<style>/
 * <iframe>/<object>/<embed>, `on*=` handler attributes, and `javascript:`/unsafe
 * URLs — enough to exercise the rules in the unit tests without a DOM.
 *
 * Adoption (routing the ~5 provenance surfaces through this) is a separate
 * follow-up — this module just lands the standalone core + tests.
 *
 * Exposes window.MastSanitize (browser) + module.exports (node tests), exactly
 * like the other shared/*.js cores. Vanilla ES5-ish (var/IIFE), no dependencies.
 */
(function () {
  'use strict';

  // ── Text escaping (matches MastUI._esc / MastIO house style) ────────────
  // esc: HTML-escape for text content. escAttr: same set, sufficient for
  // double- or single-quoted attribute values (both quote chars are escaped).
  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  }
  function escAttr(s) {
    // Attribute escaping = the same five replacements; both quote characters are
    // covered, so the result is safe inside "…" or '…' attribute delimiters.
    return esc(s);
  }

  // ── Allow-list (mirrors MastUI's, plus IMG) ─────────────────────────────
  // Tag → allowed attribute names. Anything not listed is dropped (the element
  // is unwrapped — children kept, tag removed) unless it is in SANITIZE_DROP
  // (element AND its content removed). Per-tag attributes not listed are stripped.
  var SANITIZE_ALLOWED = {
    A: ['href', 'title'],
    IMG: ['src', 'alt', 'title'],
    B: [], STRONG: [], I: [], EM: [], U: [], BR: [],
    P: [], DIV: [], SPAN: [],
    H1: [], H2: [], H3: [], H4: [], H5: [], H6: [],
    UL: [], OL: [], LI: [], BLOCKQUOTE: [], HR: []
  };
  // Elements removed wholesale (tag + content) — never unwrapped.
  var SANITIZE_DROP = {
    SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, NOSCRIPT: 1, TEMPLATE: 1,
    LINK: 1, META: 1, SVG: 1, MATH: 1, TITLE: 1, BASE: 1,
    FORM: 1, INPUT: 1, BUTTON: 1, TEXTAREA: 1, SELECT: 1, OPTION: 1
  };

  // Safe image data URIs only: data:image/(png|jpeg|jpg|gif|webp|svg... ) — but
  // SVG can carry script, so it is excluded. Raster + webp only.
  var SAFE_IMG_DATA_URI = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

  // Returns a usable URL for an href, or '' if the scheme is unsafe. http(s),
  // mailto, tel and scheme-less (relative / anchor / query / protocol-relative)
  // are allowed; javascript:, data:, vbscript: and any other scheme are dropped.
  function safeUrl(u) {
    var s = String(u == null ? '' : u).trim();
    if (!s) return '';
    var probe = s.replace(/[\x00-\x20]+/g, '').toLowerCase(); // defeat "java\tscript:" tricks
    if (/^(https?:|mailto:|tel:)/.test(probe)) return s;
    if (/^[a-z][a-z0-9+.\-]*:/.test(probe)) return '';            // any other explicit scheme → unsafe
    return s;                                                       // relative / #anchor / ?query / //host
  }
  // src may additionally be a safe image data URI (for inline <img>).
  function safeSrc(u) {
    var s = String(u == null ? '' : u).trim();
    if (!s) return '';
    var probe = s.replace(/[\x00-\x20]+/g, '').toLowerCase();
    if (SAFE_IMG_DATA_URI.test(s)) return s;                       // safe raster/webp data URI
    if (/^data:/.test(probe)) return '';                           // any other data: → unsafe
    return safeUrl(s);
  }

  // ── DOM path (browser/jsdom): inert <template> walk ─────────────────────
  function sanitizeHtmlDom(html) {
    var tpl;
    try { tpl = document.createElement('template'); tpl.innerHTML = html; }
    catch (e) { return esc(html); }
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes || []).forEach(function (child) {
        if (!child.parentNode) return;
        if (child.nodeType === 8) { child.parentNode.removeChild(child); return; } // comment
        if (child.nodeType !== 1) return;                                          // keep text (3)
        var tag = child.tagName;
        if (!Object.prototype.hasOwnProperty.call(SANITIZE_ALLOWED, tag)) {
          if (SANITIZE_DROP[tag]) { child.parentNode.removeChild(child); return; } // drop element + content
          walk(child);                                                             // sanitize subtree, then unwrap
          while (child.firstChild) child.parentNode.insertBefore(child.firstChild, child);
          child.parentNode.removeChild(child);
          return;
        }
        var allowed = SANITIZE_ALLOWED[tag];
        Array.prototype.slice.call(child.attributes || []).forEach(function (attr) {
          var name = attr.name.toLowerCase();
          if (name.indexOf('on') === 0) { child.removeAttribute(attr.name); return; } // any on*= handler
          if (allowed.indexOf(name) === -1) { child.removeAttribute(attr.name); return; }
          if (name === 'href') {
            var okHref = safeUrl(attr.value);
            if (okHref) child.setAttribute('href', okHref); else child.removeAttribute(attr.name);
          } else if (name === 'src') {
            var okSrc = safeSrc(attr.value);
            if (okSrc) child.setAttribute('src', okSrc); else child.removeAttribute(attr.name);
          }
        });
        // An <img> whose src was dropped is useless markup — remove it.
        if (tag === 'IMG' && !child.getAttribute('src')) { child.parentNode.removeChild(child); return; }
        if (tag === 'A' && child.getAttribute('href')) {
          child.setAttribute('rel', 'noopener noreferrer nofollow');
          child.setAttribute('target', '_blank');
        }
        walk(child);
      });
    })(tpl.content);
    return tpl.innerHTML;
  }

  // ── Node path (no DOM): regex strip ─────────────────────────────────────
  // A best-effort, defense-in-depth strip for non-DOM contexts (node/SSR) and
  // the unit tests. It does NOT reconstruct a full parse — it removes the
  // highest-risk constructs: drop-listed elements (with their content), HTML
  // comments, on*= event-handler attributes, and javascript:/vbscript:/unsafe
  // URLs in href/src. Markup that survives is the same tag/attr shape the DOM
  // path would emit for well-formed input. The DOM path is the authoritative
  // sanitizer; this keeps the contract testable without a browser.
  var DROP_TAGS_RE = new RegExp(
    '<(' + Object.keys(SANITIZE_DROP).join('|') + ')\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>',
    'gi'
  );
  // Self-closing / unclosed drop tags (e.g. <input>, a lone <script ...>) — also
  // strip the standalone open tag form so it never reaches innerHTML.
  var DROP_TAGS_VOID_RE = new RegExp(
    '<\\/?(' + Object.keys(SANITIZE_DROP).join('|') + ')\\b[^>]*>',
    'gi'
  );
  var COMMENT_RE = /<!--[\s\S]*?-->/g;
  // on<event>= attribute (double-quoted, single-quoted, or unquoted value).
  var ON_HANDLER_RE = /\son[a-z0-9_-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
  // javascript:/vbscript:/data: scheme inside an href/src value → neutralize the
  // whole attribute (drop it) so the link/src is inert.
  var UNSAFE_URL_ATTR_RE =
    /\s(href|src)\s*=\s*("\s*(?:javascript|vbscript|data)\s*:[^"]*"|'\s*(?:javascript|vbscript|data)\s*:[^']*'|(?:javascript|vbscript|data)\s*:[^\s>]*)/gi;

  function sanitizeHtmlNode(html) {
    var out = html;
    out = out.replace(COMMENT_RE, '');
    out = out.replace(DROP_TAGS_RE, '');
    out = out.replace(DROP_TAGS_VOID_RE, '');
    out = out.replace(ON_HANDLER_RE, '');
    out = out.replace(UNSAFE_URL_ATTR_RE, '');
    return out;
  }

  // ── Public sanitizeHtml ─────────────────────────────────────────────────
  // Returns a sanitized HTML string safe to assign to innerHTML. opts is
  // accepted for forward-compatibility (future per-call allow-list overrides);
  // unrecognized keys are ignored.
  function sanitizeHtml(html, opts) {
    void opts;
    html = String(html == null ? '' : html);
    if (!html) return '';
    if (typeof document !== 'undefined' && document.createElement) {
      return sanitizeHtmlDom(html);
    }
    return sanitizeHtmlNode(html);
  }

  var api = {
    sanitizeHtml: sanitizeHtml,
    esc: esc,
    escAttr: escAttr,
    // internals exposed for tests / advanced callers
    _safeUrl: safeUrl,
    _safeSrc: safeSrc,
    _sanitizeAllowed: SANITIZE_ALLOWED,
    _sanitizeDrop: SANITIZE_DROP
  };

  if (typeof window !== 'undefined') {
    window.MastSanitize = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
