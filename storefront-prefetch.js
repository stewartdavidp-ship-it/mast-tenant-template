/**
 * storefront-prefetch.js — hover/touch prefetch for snappier page-to-page nav.
 *
 * Each storefront page is a full document load; the heavy part is re-running the
 * (cached) script chain, but the HTML fetch still costs a round-trip on click.
 * This warms the NEXT page's HTML on intent (hover on desktop, touchstart on
 * mobile) via <link rel="prefetch">, so the click navigates to an already-fetched
 * document. Pure-additive: it never touches the current page's rendering, never
 * executes the target page's JS, and only prefetches same-origin storefront links.
 *
 * Deliberately conservative:
 *  - respects Save-Data
 *  - same-origin only; skips download/_blank/hash-only/current-page links
 *  - de-duplicates; small hover delay so fly-overs don't prefetch
 *  - no-ops where rel=prefetch isn't supported
 */
(function () {
  var nav = navigator;
  if (nav.connection && nav.connection.saveData) return;

  var probe = document.createElement('link');
  if (!(probe.relList && probe.relList.supports && probe.relList.supports('prefetch'))) return;

  var done = Object.create(null);
  var hoverTimer;

  function prefetch(url) {
    if (done[url]) return;
    done[url] = true;
    var link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = url;
    link.as = 'document';
    document.head.appendChild(link);
  }

  function candidate(target) {
    var a = target && target.closest ? target.closest('a[href]') : null;
    if (!a) return null;
    if (a.target === '_blank' || a.hasAttribute('download')) return null;
    var u;
    try { u = new URL(a.href); } catch (e) { return null; }
    if (u.origin !== location.origin) return null;
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.href.split('#')[0] === location.href.split('#')[0]) return null; // same page / hash only
    return u.href;
  }

  document.addEventListener('mouseover', function (e) {
    var url = candidate(e.target);
    if (!url) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(function () { prefetch(url); }, 65);
  }, { capture: true, passive: true });

  document.addEventListener('mouseout', function () { clearTimeout(hoverTimer); }, { capture: true, passive: true });

  document.addEventListener('touchstart', function (e) {
    var url = candidate(e.target);
    if (url) prefetch(url);
  }, { capture: true, passive: true });
})();
