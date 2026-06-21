# Diagnostics-in-code — discovery + layered design plan

**Verdict: do NOT greenfield. The app already has a surprisingly capable error-sink
(an auto-report pipeline → Firestore `feedbackReports/` with console/network/toast
breadcrumb buffers). The gap is not "no telemetry" — it is (1) the sink only fires on
*unhandled* window errors, so the ~300 silent `catch{}` sites and every handled-but-
swallowed engine error are invisible to it; (2) it persists PII unscrubbed; and (3) the
data engines do no perf instrumentation — most damningly, `MastDB` mis-classifies a
missing-composite-index error as a transient network blip, retries it for ~5 s, then
throws away the "create the index here" URL Firestore handed us.** The plan is therefore
**build-on, not rebuild**: add one scrubbing capture API in front of the existing sink
(L1), instrument the handful of shared chokepoints the decomposition already funnels
everything through (L2), and expose an admin-gated self-diagnosis surface (L3). The
single highest-value first move is instrumenting `MastDB._fsGet` for missing-index +
slow reads — it sits on the universal read path, so one ~30-line change yields app-wide
query observability.

Assessed 2026-06-20 against **`origin/main` @ `ff4b30a4`** (NOT the working-tree branch
`feat/readiness-shared-core`, which is ~460 commits behind). All line numbers below are
origin/main; re-derive against HEAD before implementing.

> This is a **design/analysis doc only** — no code in this PR. It feeds (a) a separate
> implementation effort and (b) the operator's broader testing initiative running in
> another session. The L3 self-test, the L4 export bundle, and the structured `ctx`/
> fingerprints (L1) are deliberately shaped to be assertable from that testing harness.

---

## 0. The leverage thesis (why this is cheap now)

The decomposition onto shared engines means nearly all data + UI flow through a few
chokepoints. Instrumenting those *once* is app-wide observability — the same leverage
that justified the engines for features now pays off for diagnostics:

| Chokepoint | File | What flows through it | Diagnostic yield |
|---|---|---|---|
| `MastDB._fsGet` | `shared/mastdb.js:354` | **Every one-shot tenant read** (`get`/`list`/`query().once()`) | missing-index + slow-read detection, app-wide |
| `MastDB` writes | `shared/mastdb.js:904-909` | every `set`/`update`/`push`/`multiUpdate`/`transaction` | write-failure + slow-write detection |
| `_onSnapshotError` | `shared/mastdb-firestore.js:51` | every realtime listener error | missing-index in listeners; denial/transient already handled |
| `loadModule` | `app/index.html:20753` | every lazy module load (142 modules, 243 call sites) | module-load failures + load timing |
| `navigateTo` / hashchange | `app/index.html:19667 / 20627` | every route nav | route breadcrumb trail (the 4th buffer) |
| `MastEntity` render | `shared/mast-entity.js:131 / 682` | every list + record render | render-throw isolation on malformed data |
| `*Bridge` writes | per-module | every cross-module write | already mostly surfaced (see §5) |
| existing sink (`_submitAutoReport`) | `app/index.html:24368` | every unhandled error → `feedbackReports/` | the persistence layer to build on |

---

## 1. The existing ERROR-SINK (inventory) — richer than "T0 safety net" implies

It is an **auto-error-detection → user-feedback pipeline**, landed as the safety net,
not a thin console logger.

### 1.1 Entry points (what triggers a report)
- `window.onerror` — `app/index.html:24509` → `fireAutoReport('unhandled-error', msg, src:line:col + stack)`.
- `window.addEventListener('unhandledrejection')` — `app/index.html:24516` → `fireAutoReport('unhandled-rejection', …)`.
- Module-load failures use a **scoped** temporary `window.addEventListener('error', …)` keyed on the module `src` — `app/index.html:20776` (inside `loadModule`).
- Also: stalled-spinner detection + network/console "burst" detection feed the same `fireAutoReport` (per the header comment at `app/index.html:24305-24309`).

### 1.2 The pipeline
`fireAutoReport(type,msg,detail)` (`24415`) → consent gate → `_submitAutoReport` (`24368`)
→ `MastDB.feedback.ref().push(report)` (`24408`).
- `MastDB.feedback` is defined at `app/index.html:12714-12718`; **persist path = Firestore `feedbackReports/`**.
- Write is fire-and-forget; failure only `console.warn`s (`24411`).

### 1.3 What it captures (`report` object, `24384-24406`)
`appId` (tenant), `source:'auto'`, `screen`/`screenLabel` (route), `type`/`severity`,
`description` (`'[Auto-detected] ' + type + …'` with `msg.slice(0,200)`), `detail`
(`src:line:col`+stack, `.slice(0,2000)`), `userId` (uid), `userName`
(displayName||email), `tenantPlan`, `deviceInfo` (userAgent + viewport), `appVersion`,
ISO `timestamp`, `createdAt` (serverTimestamp), and — importantly — three **trailing-60 s
breadcrumb buffers**: `consoleBuffer`, `toastBuffer`, `networkErrors`.

### 1.4 The breadcrumb buffers already exist (`app/index.html:44705-44771`)
- `window._consoleBuffer` — last **20** `console.error/warn` (console is monkey-patched at `44710/44716`).
- `window._toastBuffer` — last **5** error toasts (populated by `showToast`).
- `window._networkErrors` — last **10** HTTP failures (`window.fetch` patched `44731`; `XMLHttpRequest` patched `44750/44756`).
- All filtered to `t >= now-60000` when attached (`24397-24399`).
- **Missing: a route-nav / user-action breadcrumb** — there is no `_routeBuffer`. This is the one buffer L2 adds.

### 1.5 Bounds, dedup, noise control (already present — reuse them)
- Session cap `_AUTO_REPORT_CAP = 5` (`24312`, enforced `24370`).
- 30-day persistent fingerprint dedup in `localStorage['mast_auto_report_seen']`; fingerprint = `screen|type|msg.slice(0,60)` (`24364`).
- **Noise allowlist `_AUTO_IGNORE` (`24339-24348`)** — already filters RBAC-seed noise, template 404s, `'Missing or insufficient permissions'` (boot race), `ResizeObserver loop`, `Script error.`. New captures routed through `_submitAutoReport` inherit this filtering for free.
- Consent gating: `_autoReportConsented()` (`24354`) shows a first-run dialog; opt-out `localStorage['mast_auto_report_disabled']`.

### 1.6 Surprises (report these)
- **Richer than expected:** breadcrumb buffers, dedup, consent, caps, and a noise allowlist all already exist. L2's "breadcrumb ring buffer" is **3/4 built**.
- **Poorer than expected in two specific ways:**
  1. **No explicit capture API.** Grep for `captureError|logError|logClientError|MastError|ErrorSink|errorSink|__mastError` across `app/index.html`, `shared/`, `app/modules/` → **zero matches.** Modules cannot report a handled error; they either let it bubble to `window.onerror` or swallow it. This is the L1 gap.
  2. **PII persisted raw.** `userId`, `userName` (an email), `deviceInfo.userAgent`, and the free-text `description`/`detail` (which can contain customer names/emails/IDs lifted from a thrown message or stack), plus the `networkErrors` URLs (query strings) and `consoleBuffer` contents — **none are scrubbed.** Given this app's identity-data/secrets-vault hardening, that is a live hazard the new capture API must close at the source.
- There is a **separate** audit trail `writeAudit()` → `admin/auditLog/` for *user actions* (not errors); `auditlog-v2.js` already renders it (`app/modules/auditlog-v2.js:153`) and is the UI pattern to mirror for L3.

---

## 2. The SILENT-CATCH landscape

grep of swallow sites (empty body or console-only) across the tree:

| Bucket | empty `catch{}` | console-only | ~true swallows |
|---|---|---|---|
| `app/index.html` (shell/boot) | ~143 | ~24 | **~167** |
| `shared/*.js` (engines) | ~8 | ~5 | **~13** |
| `app/modules/*.js` | ~480 | ~285 | **~765** |
| **total catch sites ≈ 945; true swallows ≈ 314** | | | |

(The "~248" figure in the brief is in the right order of magnitude; the grounded count
of genuine swallows is ~314, of ~945 total `catch` sites.)

**No swallow helper exists** — conventions vary (`catch(e){}`, `catch(_){}`,
`/* non-fatal */`, `/* noop */`). That *absence* is the opportunity: a single
`MastError.capture(e, ctx)` becomes the convention, and the mechanical conversion
`catch(e){}` → `catch(e){ MastError.capture(e,{where:'…'}); }` makes a swallow *visible*
without changing whether it's fatal (capture never rethrows).

**Highest-value engine swallows to convert first** (small, high-blast-radius):

| File:line | Swallows | Hides |
|---|---|---|
| `shared/orders-core.js:545,556` | `console.error` only on `onOrderShipped()` CF failure | order marked shipped in DB but ship-side-effect failed silently |
| `shared/orders-core.js:678` | `catch(_){}` on `MastDB.get('config/paymentProcessor')` | silently defaults processor to `'square'` |
| `shared/mast-entity.js:665` | `catch(e){}` on `f0.get(record)` | malformed-record field read → blank, no signal |
| `shared/mast-entity.js:568,590` | `catch(e){}` on `localStorage` get/set | UI-pref persistence failures invisible |
| `shared/mastdb-firestore.js:23` | `catch(e){/* fall through */}` | Firebase app init recovery is silent |
| `shared/camera.js:52` | `.catch(function(){})` | video `.play()` rejection, no fallback |

Module-level swallows worth early attention (data-integrity divergence risk):
`app/modules/customer-service.js:948/974/997` (cache vs DB divergence after a write),
`app/modules/finance.js:272` (UID-label resolution → raw UID leaks into a table),
`app/modules/maker.js:698/753/756` (readiness/materials recompute fails → stale costs).

---

## 3. What the engines already expose (and don't)

### 3.1 MastDB — public surface (`shared/mastdb.js:898-930`)
`init, get(p), list(p,o), set(p,v), update(p,x), push(p,v), newKey(p), remove(p),
multiUpdate(u), query(p)→builder, subscribe(p,cb), subscribeChild(p,e,cb),
transaction(p,fn), serverTimestamp, serverIncrement`, plus a parallel `platform.*` surface
(`916-930`). Query builder (`_makeQuery`, `290-351`): `orderByChild/Key/Value`,
`equalTo/startAt/startAfter/endAt/endBefore`, `limitToFirst/limitToLast`, `.once()`,
`.subscribe(cb,onErr)`.

- **Reads are NOT timed.** No `performance.now()` / `console.time` anywhere in the data layer (only `Date.now()` for token expiry etc.).
- **One-shot reads funnel through `_fsGet` (`354`).** Verified call sites: `query().once()` (`340`), `get` (`418/425`), `list` (`442`), and the platform variants (`690/703/710/727`). This is *the* read chokepoint.
- **Listeners are a separate path** — `onSnapshot` errors go to `_onSnapshotError` (`shared/mastdb-firestore.js:51-81`) / inline handlers (`shared/mastdb.js:347,575,615`), which already special-case `permission-denied`/`unauthenticated` (logged once, suppressed) and `unavailable`/`cancelled` (suppressed as transient).

### 3.2 loadModule (`app/index.html:20753-20797`)
Already decent: rejects on missing-manifest (`console.error` + `reject('Unknown module')`),
on parse/runtime error (scoped `window.error` listener matched to `manifest.src` → toast +
reject), and on network error (`script.onerror` → toast + reject). **But: no timing, no
load-health registry, and the reject does not reach the capture pipeline** (the toast is
the only durable trace). Manifest = 142 entries, shape `{src, v:<content-hash>, routes:[]}`
(`20885`). 243 `loadModule(` call sites.

### 3.3 Bridges — already surface write errors (good)
Defined per-module: `CustomersBridge` (`app/modules/customers-core.js:505`), `OrdersBridge`
(`app/modules/orders-v2.js:1151`), `ProductionBridge` (`app/modules/production.js:3432`),
`WebsiteBridge` (`app/modules/website-core.js:635`), `TeamBridge`
(`app/modules/team-v2.js:3874`), `NewsletterBridge` (`app/modules/newsletter-v2.js:1360`),
`ChannelsBridge`, + more. Three error patterns, **none silent**: catch+toast
(CustomersBridge `saveCustomerField`), per-item aggregate `{ok,fail}` (OrdersBridge
`bulkCancel`), pass-through reject (OrdersBridge `sendEmail`). Bridges are therefore the
*lowest*-priority instrumentation target — the win is making their toasts also feed the
capture ring (so a `fail>0` aggregate is visible in the surface), not rewiring them.

### 3.4 MastEntity render (`shared/mast-entity.js`)
Surface at `772-779` (`renderList:131, openRecord:682, drill:465, filterActivity:756,
validate:86, canonicalGet:54`). **`validate()` checks required + numeric-type only** and
only runs on **form save** (`openRecord` onSave, `726`) — **read-mode detail/list render
is unvalidated**. Crash points on malformed data, **none guarded by try/catch**:
`displayCell` money/tags formatting (`103-122`), custom `f.tone(v)`/`f.format(v)` callbacks
(`111-114`), and `renderParty` related-table per-row `render()` callbacks (`414-418`). A
single bad record can throw and blank an entire list/panel.

### 3.5 MastSanitize (`shared/mast-sanitize.js`)
Exposes `sanitizeHtml, esc, escAttr, _safeUrl, _safeSrc` with a tag allowlist (`51-64`).
**Called by only ~3-4 modules** (newsletter-v2, blog-v2, students). Form inputs
(`MastEntity` onSave reads `.value` directly, `720-729`) and inline-edit handlers
(`variant-detail-tabs.js:383`, `events.js:833`) **bypass it** before `MastDB` writes.

---

## 4. The PERFORMANCE deep-dive (the operator's priority)

### 4.1 MISSING composite indexes — the single highest-value detection
Firestore throws `FirebaseError{ code:'failed-precondition' }` whose `message` contains a
ready-to-click `https://console.firebase.google.com/v1/r/project/…/firestore/indexes?create_composite=…`
URL when a compound query lacks its index. **Today that URL is thrown away**, and worse:

`shared/mastdb.js:354-367` — `_fsGet`:
```js
function _fsGet(ref, opts, attempt) {
  attempt = attempt || 0;
  return ref.get(opts).catch(function(err) {
    var isConnErr = err.code === 'unavailable' || err.code === 'failed-precondition' ||   // ← BUG
      (err.message && (err.message.indexOf('offline') !== -1 || err.message.indexOf('unavailable') !== -1));
    if (isConnErr && attempt < 3) {
      var delay = [500, 1500, 3000][attempt];                                             // ← 5s wasted on a non-transient error
      return new Promise(function(resolve){ setTimeout(resolve, delay); }).then(function(){ return _fsGet(ref, opts, attempt+1); });
    }
    throw err;                                                                            // ← index URL discarded
  });
}
```
**A missing index is mis-classified as a transient connection error**, retried 3× (500 +
1500 + 3000 ms ≈ 5 s of pure latency the user eats), then thrown with the diagnostic URL
buried. Because `_fsGet` always reads `{source:'server'}`, a genuine offline condition
surfaces as `unavailable`, not `failed-precondition` — so `failed-precondition` here is
**effectively always a missing index / illegal query**, never transient. Splitting it out
is both a **bug fix** (kill the 5 s stall) and **the** detection hook.

There are abundant compound-query call sites that *require* composite indexes and would
trip this — e.g. `finance.js:565,609,1045,4678,4789,5347,5491` (`orderByChild('placedAt').startAt().endAt()`),
`wholesale.js:148,543,770,1062` (`orderByChild('type').equalTo('wholesale')`),
`customers-v2.js:104` (`orderByChild('customerId').equalTo()`), `studio.js:50`,
`email-log.js:108`, `auditlog-v2.js:153`. ~162 `MastDB.query()` sites total.

Listener path needs the same treatment: `_onSnapshotError` (`shared/mastdb-firestore.js:51`)
does not special-case `failed-precondition` — a missing-index listener currently logs a
generic warning while Firestore silently retries forever.

The only existing `failed-precondition` inspection is `fulfillment.js:276` — and it's a
*Cloud Functions* `functions/failed-precondition`, not a Firestore query. So the pattern
is proven in the codebase; it just needs to live on the read chokepoint.

### 4.2 Slow reads — timing on the same chokepoint
No timing exists. Wrap `_fsGet` (and a write equivalent around `set/update/push/
multiUpdate/transaction`) with `performance.now()` deltas. Above a threshold (proposal:
**warn ≥ 800 ms, capture ≥ 1500 ms** for reads; tune on dev), push `{op,path,ms}` to a
slow-op ring and (for the worst) `MastError.capture`. Path-tagging matters: the `path`
string is the query signature the operator needs to localize the offender.

### 4.3 Ill-formed inputs
Two complementary hooks, both lightweight:
- **At write:** an optional `MastDB` write-time shape assert (dev-loud, prod-quiet): reject
  `undefined`/function values, NaN where a number is expected, and run HTML-bearing fields
  through `MastSanitize.sanitizeHtml` at the few unsanitized entry points (`MastEntity`
  onSave `726`, inline-edit handlers). Surface violations via `MastError.capture`.
- **At render:** wrap `MastEntity` per-record/per-field render (`§3.4`) in try/catch →
  capture `{entity,recordId,field}` and emit a placeholder cell instead of throwing. This
  converts "one bad record blanks the screen" into "one cell shows ⚠ + a captured report."

---

## 5. Layered proposal

### L1 — Stop the bleeding: one scrubbing capture API in front of the existing sink
- Add `window.MastError` with `capture(err, ctx)`, `breadcrumb(kind, data)`, and a small
  in-memory **ring buffer** (recent N captures, kept even when persistence is capped/deduped
  so the L3 surface can show them). Define it **early** (head boot) so engines that load
  before the `24305` block can call it; it pushes to the ring synchronously and **late-binds**
  persistence to `_submitAutoReport` once that exists (errors in the first few ms are still
  covered by the global `window.onerror`).
- `capture` **never rethrows** — it is drop-in for swallow sites.
- **Scrub is built into capture from day one** (the PII design constraint): redact emails,
  long digit runs (≥7, card/account/phone-like), and known PII keys in `ctx`
  (`name,email,phone,address,taxId,ssn,ein,accountNumber,token,key,secret`); strip URL query
  strings; length-bound. **Route the existing `_submitAutoReport` through the same scrubber**
  — this retro-fixes the current unscrubbed `feedbackReports/` writes.
- Persistence reuses the existing path verbatim (caps, 30-day dedup, `_AUTO_IGNORE`, consent).
- Begin the mechanical `catch{}` → `catch(e){ MastError.capture(e,{where}) }` conversion,
  **engines first** (the ~13 shared swallows), modules in later waves.

### L2 — Instrument the chokepoints (the perf core)
- **`_fsGet` (`mastdb.js:354`):** split `failed-precondition` out of the transient-retry
  branch; extract the index URL (`/https:\/\/console\.firebase\.google\.com\S+/`); add
  read timing; `MastError.capture` with `kind:'missing-index'|'slow-read'` + `path`.
- **`_onSnapshotError` (`mastdb-firestore.js:51`):** add a `failed-precondition` branch →
  same capture.
- **Write timing:** light wrapper around `set/update/push/multiUpdate/transaction`.
- **`loadModule` (`index.html:20753`):** add load timing + a per-module health registry
  (`{ok,fail,ms}`); `MastError.capture` on the reject path.
- **Route breadcrumb:** add `window._routeBuffer` (ring of `{route,t}`) in `navigateTo`/
  hashchange (`19667/20627`); attach alongside the existing console/network/toast buffers
  (completes the 4-buffer set).
- **MastEntity render guards:** try/catch per-record/per-field (`§4.3`) — *defer to its own
  PR*, it changes render flow.

### L3 — Admin-gated self-diagnosis surface (new lazy module)
- New `app/modules/diagnostics.js`, route `#diagnostics`, RBAC-gated (reuse an admin axis,
  e.g. `settings:admin`, or add `diagnostics:view`), built on `MastEntity`/`MastUI`,
  mirroring `auditlog-v2.js`. Tenant-self scope only — reads **this** tenant's data, **no
  cross-tenant/fleet view** (that boundary is `runmast.com` admin, not here).
- Cards/tabs: (1) **Recent errors w/ context** (reads `feedbackReports` `source:'auto'`,
  scrubbed, + the in-memory ring); (2) **Module-load health** (the L2 registry); (3)
  **Slow-op + MISSING-INDEX list** — the perf headline; each missing-index row renders a
  prominent **"Create index"** button linking straight to the captured Firebase console URL;
  (4) **Live self-test** — a button that runs read probes against key paths and reports
  pass/fail/ms (the hook the testing session drives).

### L4 — Optional depth (defer)
Per-op timing traces/spans, cross-session error fingerprint aggregation (counts/trends
beyond the 30-day localStorage dedup), and an **exportable diagnostic bundle** (scrubbed
JSON: recent errors + module health + slow ops + env) to attach to a bug or hand to the
testing session.

---

## 6. Design constraints honored
- **(a) Build on the sink.** L1 wraps `_submitAutoReport`; reuses its caps/dedup/ignore/
  consent. No second persistence path.
- **(b) PII.** Scrub is in `capture` from L1 and is also applied to the *existing* sink —
  persisted diagnostics never leak emails/PII/secrets. This is mandatory, not optional.
- **(c) Tenant self-diagnosis only.** L3 reads only the current tenant; no fleet/cross-
  tenant aggregation. Consistent with the CC role-clarity rule and the `runmast.com`-admin
  boundary for platform ops.

---

## 7. RECOMMENDED FIRST PR (highest value for the perf-bug pain)

**Scope:** L1 capture+scrub core **+** the `_fsGet` missing-index/slow-read slice of L2.
Smallest change that directly attacks the #1 pain and unblocks safe persistence for
everything after.

**Files / functions:**
1. `app/index.html` — add `window.MastError` (capture + scrub + ring, late-bound to
   `_submitAutoReport`); route `_submitAutoReport` (`24368`) through the scrubber.
2. `shared/mastdb.js` — instrument `_fsGet` (`354`): de-classify `failed-precondition`
   from the retry branch, extract index URL, add read timing, capture.
3. `shared/mastdb-firestore.js` — add `failed-precondition` branch to `_onSnapshotError`
   (`51`).

**Gates / build:** capture is always-on; *persistence* still respects existing consent/
cap/dedup, so behavior is conservative. Cache-bust: touches `app/index.html` + `shared/*`
→ run the per-file cache-bust auto-bumper (`./scripts/install-hooks.sh`) or `lint-cache-bust`
fails the PR. Docs-only PRs (like this one) need no bump.

**Dev-verify (sgtest15, via `<tenant>.runmast.com`, hard-reload):**
1. Trigger a compound query missing its index → confirm a `missing-index` capture appears
   **with the console URL**, and that it **no longer burns ~5 s** on retries.
2. Confirm a normal read records timing; a deliberately slow/large read trips the slow-read
   threshold.
3. Throw an error whose message contains an email → confirm the persisted `feedbackReports/`
   doc has the email **redacted** (proves the scrub, including for the pre-existing sink).
4. Confirm existing auto-reports (unhandled error/rejection) still fire unchanged.

**Why first:** sits on the universal read path (≈30 lines, app-wide yield); fixes a real
latent perf bug already shipping; ships the scrub that unblocks safe persistence for L2-L4;
independently valuable even if nothing else lands.

---

## 8. Effort / risk / defer

| Layer | Effort | Risk | Notes |
|---|---|---|---|
| **L1** capture + scrub + ring | ~0.5-1 d | **Low** | additive; capture never rethrows. Risk = scrub over-redaction → keep conservative regexes + length-bounded fallback. |
| **L2** `_fsGet` + listener + loadModule + route buffer | ~2-3 d | **Med** | `_fsGet` change alters retry behavior for `failed-precondition` — safe because it can't succeed on retry and offline surfaces as `unavailable` (confirm no caller depends on the old swallow-by-retry). |
| **L2** MastEntity render guards | ~1 d | **Med** | changes render flow → **its own PR**, after L1/L2 core. |
| **L3** diagnostics surface | ~3-5 d | **Low** | read-only, RBAC-gated, no writes; mostly UI mirroring `auditlog-v2.js`. |
| **L4** traces / aggregation / export | — | — | **defer.** |

**Defer:** the mass `catch{}` conversion (do in waves, engines first); MastEntity render
guards (own PR); all of L4; any cross-tenant aggregation (out of scope by design §6c).

---

## 9. Chokepoint map (quick reference, origin/main @ ff4b30a4)

```
EXISTING SINK
  fireAutoReport ................ app/index.html:24415
  _submitAutoReport ............. app/index.html:24368   ← L1 routes scrub through here
  report object ................. app/index.html:24384-24406  (PII: 24394,24395,24400)
  caps / dedup / ignore ......... app/index.html:24312 / 24364 / 24339
  MastDB.feedback (path) ........ app/index.html:12714  → feedbackReports/
  window.onerror ................ app/index.html:24509
  unhandledrejection ............ app/index.html:24516
  breadcrumb buffers ............ app/index.html:44705-44771 (console/toast/network)
  (missing) route buffer ........ add at app/index.html:19667 / 20627   ← L2

DATA ENGINE
  MastDB public surface ......... shared/mastdb.js:898-930
  _fsGet (READ CHOKEPOINT) ...... shared/mastdb.js:354   ← L1+L2 first-PR keystone
  query builder ................. shared/mastdb.js:290-351
  _onSnapshotError .............. shared/mastdb-firestore.js:51   ← L2 listener missing-index
  (only failed-precond inspect) . app/modules/fulfillment.js:276 (CF, not Firestore)

UI / LOAD ENGINES
  loadModule .................... app/index.html:20753   ← L2 timing + health
  MODULE_MANIFEST (142) ......... app/index.html:20884
  navigateTo / hashchange ....... app/index.html:19667 / 20627
  MastEntity surface ............ shared/mast-entity.js:772-779
  MastEntity render crashes ..... shared/mast-entity.js:103-122, 111-114, 414-418   ← L2 guards
  MastEntity.validate ........... shared/mast-entity.js:86 (required+numeric only, save-only)
  MastSanitize .................. shared/mast-sanitize.js (sanitizeHtml; under-used)
  Bridges (already surface) ..... customers-core.js:505, orders-v2.js:1151, production.js:3432, website-core.js:635, …
```
