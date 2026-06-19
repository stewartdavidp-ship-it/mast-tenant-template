/**
 * Unit tests for the canonical HTML sanitizer core (shared/mast-sanitize.js,
 * Track 7). Run in node, so these exercise the NODE regex-fallback path of
 * sanitizeHtml (there is no `document` in this process) plus the pure esc()/
 * escAttr() escapers. The DOM <template>-walk path is the authoritative
 * sanitizer in the browser; this suite pins the rule contract the fallback
 * must also uphold: drop-listed elements removed, on*= handlers stripped,
 * javascript:/data: URLs neutralized, and safe markup preserved.
 *
 * Hand-rolled assert + t() helper, matching test/format-goldens.test.js.
 *
 * Run: node test/mast-sanitize.test.js
 */
'use strict';

const assert = require('assert');
const S = require('../shared/mast-sanitize.js');

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓ ' + name); }

console.log('MastSanitize (node fallback path + escapers)');

// ── sanitizeHtml: dangerous constructs stripped ─────────────────────────────
t('<script> element is stripped (tag + content)', () => {
  const out = S.sanitizeHtml('<p>hi</p><script>alert(1)</script>');
  assert.strictEqual(/<script/i.test(out), false, 'script tag survived');
  assert.strictEqual(/alert\(1\)/.test(out), false, 'script content survived');
  assert.strictEqual(/<p>hi<\/p>/.test(out), true, 'safe sibling lost');
});

t('<style> / <iframe> / <object> / <embed> are stripped', () => {
  const out = S.sanitizeHtml(
    '<style>body{}</style><iframe src="x"></iframe><object></object><embed>'
  );
  assert.strictEqual(/<(style|iframe|object|embed)/i.test(out), false);
});

t('onerror= handler attribute is stripped', () => {
  const out = S.sanitizeHtml('<img src="x" onerror="steal()">');
  assert.strictEqual(/onerror/i.test(out), false, 'onerror survived');
});

t('onclick= handler attribute is stripped', () => {
  const out = S.sanitizeHtml('<a href="/ok" onclick="evil()">go</a>');
  assert.strictEqual(/onclick/i.test(out), false, 'onclick survived');
  assert.strictEqual(/go<\/a>/.test(out), true, 'link text lost');
});

t('javascript: href is neutralized', () => {
  const out = S.sanitizeHtml('<a href="javascript:alert(1)">x</a>');
  assert.strictEqual(/javascript:/i.test(out), false, 'javascript: URL survived');
});

t('data: src on img is neutralized (node fallback drops the attr)', () => {
  const out = S.sanitizeHtml('<img src="data:text/html,<script>1</script>">');
  assert.strictEqual(/data:text\/html/i.test(out), false);
});

t('HTML comments are stripped', () => {
  const out = S.sanitizeHtml('<p>a</p><!-- secret --><p>b</p>');
  assert.strictEqual(/<!--/.test(out), false);
});

// ── sanitizeHtml: safe markup preserved ─────────────────────────────────────
t('safe <a href> is preserved', () => {
  const out = S.sanitizeHtml('<a href="https://example.com">link</a>');
  assert.strictEqual(/href="https:\/\/example\.com"/.test(out), true);
  assert.strictEqual(/link<\/a>/.test(out), true);
});

t('safe <b> formatting is preserved', () => {
  assert.strictEqual(S.sanitizeHtml('<b>bold</b>'), '<b>bold</b>');
});

t('safe <img src alt> is preserved', () => {
  const out = S.sanitizeHtml('<img src="https://cdn/x.png" alt="pic">');
  assert.strictEqual(/src="https:\/\/cdn\/x\.png"/.test(out), true);
  assert.strictEqual(/alt="pic"/.test(out), true);
});

t('plain text passes through unchanged', () => {
  assert.strictEqual(S.sanitizeHtml('just some words'), 'just some words');
});

t('empty / null input → empty string', () => {
  assert.strictEqual(S.sanitizeHtml(''), '');
  assert.strictEqual(S.sanitizeHtml(null), '');
  assert.strictEqual(S.sanitizeHtml(undefined), '');
});

// ── esc / escAttr ───────────────────────────────────────────────────────────
t('esc() escapes < > & " \'', () => {
  assert.strictEqual(S.esc(`<a href="x">b&'c</a>`),
    '&lt;a href=&quot;x&quot;&gt;b&amp;&#39;c&lt;/a&gt;');
});

t('esc() coerces null/undefined to empty string', () => {
  assert.strictEqual(S.esc(null), '');
  assert.strictEqual(S.esc(undefined), '');
});

t('escAttr() escapes both quote styles', () => {
  assert.strictEqual(S.escAttr(`"'`), '&quot;&#39;');
});

// ── _safeUrl / _safeSrc helpers ─────────────────────────────────────────────
t('_safeUrl allows http(s)/mailto/tel/relative, drops javascript:', () => {
  assert.strictEqual(S._safeUrl('https://a.com'), 'https://a.com');
  assert.strictEqual(S._safeUrl('/rel/path'), '/rel/path');
  assert.strictEqual(S._safeUrl('mailto:a@b.com'), 'mailto:a@b.com');
  assert.strictEqual(S._safeUrl('java\tscript:alert(1)'), '');
  assert.strictEqual(S._safeUrl('vbscript:x'), '');
});

t('_safeSrc allows safe image data URI, drops data:text/html', () => {
  assert.strictEqual(
    S._safeSrc('data:image/png;base64,iVBORw0KGgo='),
    'data:image/png;base64,iVBORw0KGgo='
  );
  assert.strictEqual(S._safeSrc('data:image/svg+xml;base64,PHN2Zz4='), '');
  assert.strictEqual(S._safeSrc('data:text/html,<script>1</script>'), '');
});

console.log('\n' + pass + ' assertions passed.');
