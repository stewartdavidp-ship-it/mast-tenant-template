// app/modules/business-view.js — lazy-loaded on demand by the 'business' route
// setup (decomposition Track 1). The D-22 Unified Business Entity read-only
// dashboard, extracted verbatim from index.html. Exposes window.loadBusinessView,
// window.detachBusinessListeners, window.bizNavToSettings, window.bizNavToModule.
// ============================================================
// D-22: Unified Business Entity — read-only Dashboard (Type 6)
// ============================================================
// Aggregates entity data across identity, presence, channels, compliance,
// renewals, people, operations, engagement, discovery. No inline edit:
// every row/section deep-links to its canonical editor (Settings sub-view
// or full module). Edits happen in their canonical homes where Paradigm A
// already lives; this page is the overview.
(function() {
  'use strict';

  var entityData = null;
  var renewalsData = [];
  var documentsData = [];
  var channelsData = [];
  var entitySub = null, renewalsSub = null, documentsSub = null, channelsSub = null;
  var cssInjected = false;
  var loaded = false;

  function injectCss() {
    if (cssInjected) return;
    cssInjected = true;
    var style = document.createElement('style');
    style.textContent = [
      '#businessTab .bz-wrap { display:grid; grid-template-columns:220px 1fr; gap:24px; align-items:start; margin-top:16px; }',
      '@media (max-width:1023px) { #businessTab .bz-wrap { grid-template-columns:180px 1fr; gap:16px; } }',
      '@media (max-width:767px)  { #businessTab .bz-wrap { grid-template-columns:1fr; } #businessTab .bz-rail { display:none !important; } }',
      '#businessTab .bz-rail { position:sticky; top:70px; max-height:calc(100vh - 90px); overflow-y:auto; padding:8px 0; }',
      '#businessTab .bz-rail a { display:block; padding:6px 10px; border-radius:6px; font-size:0.85rem; color:var(--warm-gray,#888); text-decoration:none; margin-bottom:2px; cursor:pointer; transition:color 0.15s, background 0.15s; }',
      '#businessTab .bz-rail a:hover  { color:var(--text,#fff); background:rgba(255,255,255,0.04); }',
      '#businessTab .bz-rail a:focus { outline:none; }',
      '#businessTab .bz-rail a:focus-visible { outline:2px solid var(--amber-glow,#f59e0b); outline-offset:1px; }',
      '#businessTab .bz-rail a.active { color:var(--amber,#c4853c); font-weight:600; border-left:2px solid var(--amber,#c4853c); padding-left:8px; }',
      '#businessTab .bz-mobile-nav { display:none; width:100%; padding:8px 10px; margin-bottom:14px; background:var(--bg-secondary,#232323); color:var(--text,#fff); border:1px solid rgba(255,255,255,0.1); border-radius:6px; font-size:0.85rem; font-family:inherit; }',
      '@media (max-width:767px) { #businessTab .bz-mobile-nav { display:block; } }',
      '#businessTab .bz-content { scroll-padding-top:80px; padding-bottom:30vh; }',
      '#businessTab .bz-section { scroll-margin-top:80px; margin-bottom:24px; }',
      '#businessTab .bz-section-header { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:10px; }',
      '#businessTab .bz-section-title  { font-size:1.15rem; font-weight:600; color:var(--text,#fff); display:flex; align-items:center; gap:8px; margin:0; }',
      '#businessTab .bz-section-links  { display:flex; flex-wrap:wrap; gap:14px; font-size:0.85rem; }',
      '#businessTab .bz-link { color:var(--teal,#2a9d8f); cursor:pointer; text-decoration:none; background:none; border:none; padding:0; font-size:inherit; font-family:inherit; }',
      '#businessTab .bz-link:hover { text-decoration:underline; }',
      '#businessTab .bz-link:focus { outline:none; }',
      '#businessTab .bz-link:focus-visible { outline:2px solid var(--amber-glow,#f59e0b); outline-offset:2px; border-radius:2px; }',
      '#businessTab .bz-card { background:var(--bg-secondary,#232323); border-radius:10px; padding:14px 18px; border:1px solid rgba(255,255,255,0.04); }',
      '#businessTab .bz-row  { display:flex; align-items:flex-start; gap:12px; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.04); font-size:0.9rem; color:var(--text,#fff); line-height:1.5; }',
      '#businessTab .bz-row:last-child { border-bottom:none; padding-bottom:0; }',
      '#businessTab .bz-row .bz-label { color:var(--warm-gray,#888); font-size:0.78rem; min-width:160px; text-transform:uppercase; letter-spacing:0.04em; padding-top:2px; }',
      '#businessTab .bz-row .bz-val   { flex:1; word-break:break-word; }',
      '#businessTab .bz-empty { color:var(--warm-gray-light,#666); font-style:italic; }',
      '#businessTab .bz-chip  { display:inline-block; padding:2px 10px; border-radius:12px; background:rgba(42,157,143,0.15); color:var(--teal,#2a9d8f); font-size:0.78rem; margin-right:4px; margin-bottom:4px; }',
      '#businessTab .bz-chip.muted   { background:rgba(255,255,255,0.05); color:var(--warm-gray,#888); }',
      '#businessTab .bz-chip.warning { background:rgba(234,179,8,0.15);  color:#eab308; }',
      '#businessTab .bz-chip.danger  { background:rgba(239,68,68,0.15);  color:#ef4444; }',
      '#businessTab .bz-status-strip { background:var(--bg-secondary,#232323); border-radius:10px; padding:10px 16px; margin-top:8px; display:flex; align-items:center; gap:14px; flex-wrap:wrap; font-size:0.85rem; color:var(--warm-gray,#888); }',
      '#businessTab .bz-status-sep   { width:1px; height:14px; background:rgba(255,255,255,0.12); }',
      '#businessTab .bz-draft-banner { background:rgba(234,179,8,0.08); border:1px solid rgba(234,179,8,0.25); border-radius:8px; padding:10px 14px; margin:12px 0; font-size:0.85rem; color:var(--text,#fff); }',
      '#businessTab .bz-empty-global { text-align:center; padding:60px 20px; }',
      '#businessTab .bz-empty-global h2 { font-size:1.6rem; font-weight:500; margin-bottom:8px; color:var(--text,#fff); }',
      '#businessTab .bz-empty-global p  { color:var(--warm-gray,#888); font-size:0.9rem; margin-bottom:20px; max-width:460px; margin-left:auto; margin-right:auto; }',
      '#businessTab .bz-section-empty  { padding:14px; color:var(--warm-gray,#888); font-size:0.85rem; background:rgba(255,255,255,0.02); border:1px dashed rgba(255,255,255,0.08); border-radius:8px; }'
    ].join('\n');
    document.head.appendChild(style);
  }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; });
  }
  function timeAgo(iso) {
    if (!iso) return '';
    var diff = Date.now() - new Date(iso).getTime();
    if (isNaN(diff)) return '';
    var days = Math.floor(diff / 86400000);
    if (days === 0) {
      var hrs = Math.floor(diff / 3600000);
      return hrs === 0 ? 'just now' : hrs + 'h ago';
    }
    if (days === 1) return 'yesterday';
    if (days < 30)  return days + 'd ago';
    var mo = Math.floor(days / 30);
    return mo < 12 ? mo + 'mo ago' : Math.floor(mo / 12) + 'y ago';
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }
  function daysUntil(iso) {
    if (!iso) return null;
    var t = new Date(iso).getTime();
    return isNaN(t) ? null : Math.floor((t - Date.now()) / 86400000);
  }

  var SECTIONS = [
    { id: 'overview',    label: 'Overview' },
    { id: 'identity',    label: 'Identity' },
    { id: 'presence',    label: 'Presence' },
    { id: 'channels',    label: 'Integrations' },
    { id: 'compliance',  label: 'Compliance' },
    { id: 'renewals',    label: 'Renewals' },
    { id: 'people',      label: 'People' },
    { id: 'operations',  label: 'Operations' },
    { id: 'engagement',  label: 'Engagement' },
    { id: 'discovery',   label: 'Discovery' }
  ];

  // MastNavStack push before every cross-screen nav so Back from the editor
  // returns to Business (design-system rule 11: context-aware back nav).
  function navToSettings(subView) {
    if (window.MastNavStack && typeof MastNavStack.push === 'function') {
      MastNavStack.push({ route: 'business', view: 'overview', state: {}, label: 'Business' });
    }
    navigateTo('settings');
    setTimeout(function(){ if (typeof switchSettingsSubView === 'function') switchSettingsSubView(subView); }, 80);
  }
  function navToModule(route) {
    if (window.MastNavStack && typeof MastNavStack.push === 'function') {
      MastNavStack.push({ route: 'business', view: 'overview', state: {}, label: 'Business' });
    }
    navigateTo(route);
  }
  window.bizNavToSettings = navToSettings;
  window.bizNavToModule   = navToModule;

  function loadBusinessView() {
    injectCss();
    var container = document.getElementById('businessTab');
    if (!container) return;
    if (!loaded) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--warm-gray,#888);font-size:0.9rem;">Loading business profile&hellip;</div>';
    }
    if (!entitySub && window.MastDB && MastDB.businessEntity && MastDB.businessEntity.subscribe) {
      try {
        entitySub = MastDB.businessEntity.subscribe(function(ent) {
          entityData = ent;
          loaded = true;
          if (document.getElementById('businessTab').style.display !== 'none') renderAll();
        });
      } catch (err) { console.warn('[biz] entity subscribe failed:', err && err.message); }
    }
    if (!renewalsSub && window.MastDB && MastDB.businessEntity && MastDB.businessEntity.renewals && MastDB.businessEntity.renewals.subscribeItems) {
      try {
        renewalsSub = MastDB.businessEntity.renewals.subscribeItems(function(items) {
          renewalsData = Array.isArray(items) ? items : [];
          rerender('renewals'); rerender('compliance');
        });
      } catch (err) { console.warn('[biz] renewals subscribe failed:', err && err.message); }
    }
    if (!documentsSub && window.MastDB && MastDB.businessEntity && MastDB.businessEntity.documents && MastDB.businessEntity.documents.subscribe) {
      try {
        documentsSub = MastDB.businessEntity.documents.subscribe(function(docs) {
          documentsData = Array.isArray(docs) ? docs : [];
          rerender('compliance');
        });
      } catch (err) { console.warn('[biz] documents subscribe failed:', err && err.message); }
    }
    if (!channelsSub && window.MastDB && MastDB.businessEntity && MastDB.businessEntity.channels && MastDB.businessEntity.channels.subscribe) {
      try {
        channelsSub = MastDB.businessEntity.channels.subscribe(function(items) {
          channelsData = Array.isArray(items) ? items : [];
          rerender('channels');
        });
      } catch (err) { console.warn('[biz] channels subscribe failed:', err && err.message); }
    }
  }
  function detachBusinessListeners() {
    [entitySub, renewalsSub, documentsSub, channelsSub].forEach(function(fn){
      if (typeof fn === 'function') { try { fn(); } catch (_) {} }
    });
    entitySub = renewalsSub = documentsSub = channelsSub = null;
  }
  window.loadBusinessView = loadBusinessView;
  window.detachBusinessListeners = detachBusinessListeners;

  function renderAll() {
    var container = document.getElementById('businessTab');
    if (!container) return;
    var status = (entityData && entityData.entityStatus) || 'none';
    if (status === 'none' || !entityData) {
      container.innerHTML =
        '<div class="section-header"><h2>&#127970; Business</h2></div>' +
        '<div class="bz-empty-global">' +
          '<div style="font-size:1.6rem;margin-bottom:12px;" aria-hidden="true">&#127970;</div>' +
          '<h2>Let\'s set up your business</h2>' +
          '<p>Takes about 2 minutes. We\'ll tailor Mast to how you actually work &mdash; identity, channels, compliance, renewals, and more in one place.</p>' +
          '<button type="button" class="btn btn-primary" onclick="window.bizNavToSettings(\'engagement\')">Start setup</button>' +
        '</div>';
      return;
    }

    var h = '';
    h += '<div class="section-header"><h2>&#127970; Business</h2></div>';
    h += renderStatusStrip();
    if (status === 'draft') {
      h += '<div class="bz-draft-banner"><strong>&#9999;&#65039; Onboarding in progress.</strong> ' +
        '<button type="button" class="bz-link" onclick="window.bizNavToSettings(\'engagement\')">Complete setup</button> to unlock all features.</div>';
    }
    h += '<select class="bz-mobile-nav" aria-label="Jump to section" onchange="if(this.value){document.getElementById(\'bz-\'+this.value).scrollIntoView({behavior:\'smooth\'});this.value=\'\';}">';
    h += '<option value="">Jump to section&hellip;</option>';
    SECTIONS.forEach(function(s){ h += '<option value="' + s.id + '">' + esc(s.label) + '</option>'; });
    h += '</select>';
    h += '<div class="bz-wrap">';
    h += '<nav class="bz-rail" aria-label="Section navigation">';
    SECTIONS.forEach(function(s, i){
      h += '<a href="#" data-bz-anchor="' + s.id + '"' + (i === 0 ? ' class="active"' : '') +
           ' onclick="event.preventDefault(); document.getElementById(\'bz-' + s.id + '\').scrollIntoView({behavior:\'smooth\'}); this.blur();">' +
           esc(s.label) + '</a>';
    });
    h += '</nav>';
    h += '<div class="bz-content">';
    SECTIONS.forEach(function(s){
      h += '<section class="bz-section" id="bz-' + s.id + '" aria-labelledby="bz-title-' + s.id + '">' + renderSection(s.id) + '</section>';
    });
    h += '</div></div>';
    container.innerHTML = h;
    bindScrollSpy();
  }

  function rerender(id) {
    var el = document.getElementById('bz-' + id);
    if (el) el.innerHTML = renderSection(id);
    if (id === 'identity' || id === 'people' || id === 'presence' || id === 'operations' || id === 'engagement') {
      var strip = document.getElementById('bzStatusStrip');
      if (strip) strip.outerHTML = renderStatusStrip();
    }
  }
  function renderSection(id) {
    switch (id) {
      case 'overview':   return renderOverview();
      case 'identity':   return renderIdentity();
      case 'presence':   return renderPresence();
      case 'channels':   return renderChannels();
      case 'compliance': return renderCompliance();
      case 'renewals':   return renderRenewals();
      case 'people':     return renderPeople();
      case 'operations': return renderOperations();
      case 'engagement': return renderEngagement();
      case 'discovery':  return renderDiscovery();
    }
    return '';
  }

  function renderStatusStrip() {
    var status = (entityData && entityData.entityStatus) || 'none';
    var cls = status === 'active' ? 'bz-chip' : status === 'draft' ? 'bz-chip warning' : 'bz-chip muted';
    var pc = (entityData && entityData.people && entityData.people.primaryContact) || {};
    var residency = entityData && entityData.residency;
    var updatedAt = entityData && entityData.updatedAt;
    var h = '<div class="bz-status-strip" id="bzStatusStrip">';
    h += '<span><span class="' + cls + '" style="text-transform:uppercase;font-weight:700;letter-spacing:0.04em;">' + esc(status) + '</span></span>';
    if (residency && residency.region) {
      h += '<span class="bz-status-sep" aria-hidden="true"></span><span>&#127760; ' + esc(residency.region) + '</span>';
    }
    if (pc.dpaAcceptedAt && pc.dpaVersion) {
      h += '<span class="bz-status-sep" aria-hidden="true"></span><span>DPA ' + esc(pc.dpaVersion) + ' accepted ' + esc(fmtDate(pc.dpaAcceptedAt)) + '</span>';
    }
    if (updatedAt) {
      h += '<span class="bz-status-sep" aria-hidden="true"></span><span>Updated ' + esc(timeAgo(updatedAt)) + '</span>';
    }
    h += '</div>';
    return h;
  }

  function sectionHeader(id, title, icon, links) {
    var h = '<div class="bz-section-header">';
    h += '<h3 id="bz-title-' + id + '" class="bz-section-title">' + (icon || '') + ' ' + esc(title) + '</h3>';
    if (Array.isArray(links) && links.length) {
      h += '<div class="bz-section-links">';
      links.forEach(function(ln){
        h += '<button type="button" class="bz-link" onclick="' + ln.onclick + '">' + esc(ln.label) + ' &rarr;</button>';
      });
      h += '</div>';
    }
    h += '</div>';
    return h;
  }
  function row(label, valueHtml) {
    var val = valueHtml === '' || valueHtml === null || valueHtml === undefined
      ? '<span class="bz-empty">Not set</span>'
      : valueHtml;
    return '<div class="bz-row"><span class="bz-label">' + esc(label) + '</span><span class="bz-val">' + val + '</span></div>';
  }

  function renderOverview() {
    var id = (entityData && entityData.identity) || {};
    var eng = (entityData && entityData.engagement) || {};
    var parts = [];
    if (id.businessName) parts.push('<strong>' + esc(id.businessName) + '</strong>');
    var arch = archetypeLabel(id.archetype);
    if (arch) parts.push(esc(arch));
    if (eng.mode) parts.push(esc(modeLabel(eng.mode)) + (eng.surface ? ' &middot; ' + esc(eng.surface) : ''));
    var summary = parts.length ? parts.join(' &middot; ') : '<span class="bz-empty">Not yet set up</span>';
    return sectionHeader('overview', 'Overview', '&#128269;', []) +
      '<div class="bz-card"><div style="font-size:1rem;line-height:1.6;">' + summary + '</div></div>';
  }

  function renderIdentity() {
    var id = (entityData && entityData.identity) || {};
    var h = sectionHeader('identity', 'Identity', '&#127976;', [
      { label: 'Edit legal details', onclick: "window.bizNavToSettings('tax')" }
    ]);
    h += '<div class="bz-card">';
    h += row('Business name', esc(id.businessName || ''));
    h += row('Archetype', esc(archetypeLabel(id.archetype) || ''));
    h += row('Legal name', esc(id.legalName || ''));
    var dba = Array.isArray(id.dba) ? id.dba : [];
    h += row('DBA / trade names', dba.length ? dba.map(function(d){ return '<span class="bz-chip muted">' + esc(d) + '</span>'; }).join('') : '');
    h += row('Entity type', esc(id.entityType || ''));
    h += row('Year founded', id.yearFounded != null ? esc(String(id.yearFounded)) : '');
    h += row('Years in business', id.yearsInBusiness != null ? esc(String(id.yearsInBusiness)) : '');
    h += row('Tagline', esc(id.tagline || ''));
    h += row('One-line description', esc(id.oneLineDescription || ''));
    h += row('EIN', id.ein ? '<span class="bz-chip muted">&#128274; On file</span>' : '<span class="bz-empty">Not set</span>');
    h += '</div>';
    return h;
  }

  function renderPresence() {
    var p = (entityData && entityData.presence) || {};
    // Presence splits across three canonical homes:
    //   1. presence.declaredChannels[] (strategy chips) -> Settings > Channels
    //   2. OAuth integrations (covered in Integrations section below)
    //   3. admin/channels/{id} sales-channel entity (different model) -> Manage > Channels module
    var h = sectionHeader('presence', 'Presence', '&#127760;', [
      { label: 'Edit declared channels', onclick: "window.bizNavToSettings('channels')" },
      { label: 'Open Channels module',   onclick: "window.bizNavToModule('channels')" }
    ]);
    h += '<div class="bz-card">';
    h += row('Primary domain', esc(p.primaryDomain || ''));
    var chans = Array.isArray(p.declaredChannels) ? p.declaredChannels : [];
    h += row('Declared channels', chans.length ? chans.map(function(c){ return '<span class="bz-chip">' + esc(channelLabel(c)) + '</span>'; }).join('') : '');
    var socials = Array.isArray(p.socialProfiles) ? p.socialProfiles : [];
    var socialHtml = socials.map(function(s){
      var url = typeof s === 'string' ? s : (s && (s.url || s.handle)) || '';
      return url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener" class="bz-link">' + esc(url) + '</a>' : '';
    }).filter(Boolean).join('<br>');
    h += row('Social profiles', socialHtml);
    var owned = Array.isArray(p.ownedDomains) ? p.ownedDomains : [];
    if (owned.length) h += row('Other domains', owned.map(function(d){ return '<span class="bz-chip muted">' + esc(d) + '</span>'; }).join(''));
    var ext = Array.isArray(p.externalChannels) ? p.externalChannels : [];
    if (ext.length) h += row('Other channels', ext.map(function(e){
      var lbl = typeof e === 'string' ? e : (e && (e.name || e.url)) || '';
      return '<span class="bz-chip muted">' + esc(lbl) + '</span>';
    }).join(''));
    h += '</div>';
    return h;
  }

  function renderChannels() {
    // OAuth integration health (Shopify/Etsy/Square connection state, webhook count, sync freshness).
    // Canonical editor: Settings > Channels (OAuth connect/disconnect + sync cadence).
    var items = Array.isArray(channelsData) ? channelsData : [];
    var h = sectionHeader('channels', 'Integrations', '&#128279;', [
      { label: 'Manage integrations', onclick: "window.bizNavToSettings('channels')" }
    ]);
    if (items.length === 0) {
      h += '<div class="bz-section-empty">No sales platform integrations connected yet. ' +
        '<button type="button" class="bz-link" onclick="window.bizNavToSettings(\'channels\')">Connect a platform &rarr;</button></div>';
      return h;
    }
    h += '<div class="bz-card">';
    items.forEach(function(c, i) {
      var platform = c.platform || c.channelId || '—';
      var status = c.status || 'unknown';
      var cls = (status === 'connected') ? 'bz-chip' : (status === 'expired' || status === 'error' || status === 'revoked') ? 'bz-chip danger' : 'bz-chip muted';
      var sub = [];
      if (c.shopDomain || c.shopId) sub.push(esc(c.shopDomain || c.shopId));
      if (typeof c.webhookSubscriptionCount === 'number') sub.push(c.webhookSubscriptionCount + ' webhook' + (c.webhookSubscriptionCount === 1 ? '' : 's'));
      if (c.lastSyncAt) sub.push('Synced ' + esc(timeAgo(c.lastSyncAt)));
      var val = '<span class="' + cls + '" style="text-transform:uppercase;font-weight:700;letter-spacing:0.04em;">' + esc(status) + '</span>';
      if (sub.length) val += '<div style="font-size:0.78rem;color:var(--warm-gray,#888);margin-top:4px;">' + sub.join(' &middot; ') + '</div>';
      var last = i === items.length - 1;
      h += '<div class="bz-row"' + (last ? ' style="border-bottom:none;"' : '') + '>' +
        '<span class="bz-label" style="text-transform:capitalize;letter-spacing:normal;">' + esc(platform) + '</span>' +
        '<span class="bz-val">' + val + '</span></div>';
    });
    h += '</div>';
    return h;
  }

  function renderCompliance() {
    var c = (entityData && entityData.compliance) || {};
    var lic = Array.isArray(c.licenses) ? c.licenses : [];
    var ins = Array.isArray(c.insurance) ? c.insurance : [];
    var cert = Array.isArray(c.certifications) ? c.certifications : [];
    var tax = Array.isArray(c.taxJurisdictions) ? c.taxJurisdictions : [];
    var total = lic.length + ins.length + cert.length + tax.length;
    var h = sectionHeader('compliance', 'Compliance', '&#128737;&#65039;', [
      { label: 'Manage compliance', onclick: "window.bizNavToSettings('compliance')" }
    ]);
    if (total === 0) {
      h += '<div class="bz-section-empty">No compliance records yet. ' +
        '<button type="button" class="bz-link" onclick="window.bizNavToSettings(\'compliance\')">Add your first license &rarr;</button></div>';
      return h;
    }
    h += '<div class="bz-card">';
    h += row('Licenses',         lic.length  ? esc(String(lic.length))  + ' on file'    : '');
    h += row('Insurance',        ins.length  ? esc(String(ins.length))  + ' policies'   : '');
    h += row('Certifications',   cert.length ? esc(String(cert.length)) + ' certs'      : '');
    h += row('Tax jurisdictions', tax.length ? esc(String(tax.length)) + ' registered' : '');
    var docCount = Array.isArray(documentsData)
      ? documentsData.filter(function(d){ return d && d.status !== 'deleted-pending-purge' && d.status !== 'deleted'; }).length
      : 0;
    h += row('Documents', docCount ? esc(String(docCount)) + ' stored' : '');
    var ui = (entityData && entityData.ui) || {};
    var activeR = Array.isArray(renewalsData) ? renewalsData.filter(function(r){ return r && r.status !== 'archived' && r.status !== 'completed'; }).length : 0;
    if (total >= 1 && activeR === 0 && !ui.renewalSeedDismissedAt) {
      h += '<div class="bz-row" style="border-bottom:none;"><span class="bz-label"></span><span class="bz-val">' +
        '<div style="padding:10px 12px;background:rgba(42,157,143,0.08);border:1px solid rgba(42,157,143,0.25);border-radius:8px;font-size:0.85rem;">' +
        '&#128161; You have compliance items but no renewals scheduled. ' +
        '<button type="button" class="bz-link" onclick="window.bizNavToSettings(\'compliance\')">Seed renewals &rarr;</button>' +
        '</div></span></div>';
    }
    h += '</div>';
    return h;
  }

  function renderRenewals() {
    var items = Array.isArray(renewalsData) ? renewalsData : [];
    var active   = items.filter(function(r){ return r.status === 'active';   }).length;
    var warning  = items.filter(function(r){ return r.status === 'warning';  }).length;
    var expired  = items.filter(function(r){ return r.status === 'expired';  }).length;
    var archived = items.filter(function(r){ return r.status === 'archived'; }).length;
    // Per-item CRUD in Settings > Compliance; cadence + reminder settings in Settings > Notifications.
    var h = sectionHeader('renewals', 'Renewals', '&#128197;', [
      { label: 'Manage items',      onclick: "window.bizNavToSettings('compliance')"    },
      { label: 'Reminder settings', onclick: "window.bizNavToSettings('notifications')" }
    ]);
    if (items.length === 0) {
      h += '<div class="bz-section-empty">No renewals tracked yet. ' +
        '<button type="button" class="bz-link" onclick="window.bizNavToSettings(\'compliance\')">Seed from Compliance &rarr;</button></div>';
      return h;
    }
    h += '<div class="bz-card">';
    var chips = '<span class="bz-chip">' + active + ' active</span>' +
      (warning  ? '<span class="bz-chip warning">' + warning  + ' warning</span>'  : '') +
      (expired  ? '<span class="bz-chip danger">'  + expired  + ' expired</span>'  : '') +
      (archived ? '<span class="bz-chip muted">'   + archived + ' archived</span>' : '');
    h += row('Summary', chips);
    var upcoming = items
      .filter(function(r){ return r && r.status !== 'archived' && r.status !== 'completed' && r.expiresAt; })
      .map(function(r){ return Object.assign({}, r, { _daysUntil: daysUntil(r.expiresAt) }); })
      .filter(function(r){ return r._daysUntil !== null && r._daysUntil <= 60; })
      .sort(function(a,b){ return a._daysUntil - b._daysUntil; })
      .slice(0, 3);
    if (upcoming.length) {
      var uh = '';
      upcoming.forEach(function(r, i){
        var last = i === upcoming.length - 1;
        var dtxt = r._daysUntil < 0 ? Math.abs(r._daysUntil) + 'd overdue' : r._daysUntil + 'd';
        var cls = r._daysUntil < 0 ? 'bz-chip danger' : r._daysUntil <= 14 ? 'bz-chip warning' : 'bz-chip';
        uh += '<div style="padding:6px 0;display:flex;justify-content:space-between;gap:10px;font-size:0.85rem;' + (last ? '' : 'border-bottom:1px solid rgba(255,255,255,0.04);') + '">' +
          '<span>' + esc(r.title || r.sourceType || 'Renewal') + '</span>' +
          '<span><span class="' + cls + '">' + esc(dtxt) + '</span></span></div>';
      });
      h += '<div class="bz-row" style="border-bottom:none;align-items:flex-start;"><span class="bz-label">Upcoming</span><span class="bz-val">' + uh + '</span></div>';
    }
    h += '</div>';
    return h;
  }

  function renderPeople() {
    var p  = (entityData && entityData.people) || {};
    var pc = p.primaryContact || {};
    // primaryContact + dpa live in Settings > Tax & Legal (Notice-at-Collection block).
    // Staff accounts live in Manage > Permissions (separate data model).
    var h = sectionHeader('people', 'People', '&#128101;', [
      { label: 'Edit contact details', onclick: "window.bizNavToSettings('tax')" },
      { label: 'Open Permissions',     onclick: "window.bizNavToModule('employees')" }
    ]);
    h += '<div class="bz-card">';
    h += row('Primary contact', esc(pc.name || ''));
    h += row('Email', esc(pc.email || ''));
    h += row('Phone', esc(pc.phone || ''));
    h += row('Role',  esc(roleLabel(pc.role) || ''));
    h += row('Preferred contact channel', esc(pc.preferredChannel || ''));
    h += row('Team size', esc(teamSizeLabel(p.teamSize) || ''));
    h += row('Employees',   p.hasEmployees   ? '<span class="bz-chip">Yes</span>' : '<span class="bz-chip muted">No</span>');
    h += row('Contractors', p.hasContractors ? '<span class="bz-chip">Yes</span>' : '<span class="bz-chip muted">No</span>');
    var owners = Array.isArray(p.owners) ? p.owners : [];
    if (owners.length) h += row('Owners', owners.map(function(o){
      return '<span class="bz-chip muted">' + esc(typeof o === 'string' ? o : (o && (o.name || o.email) || '')) + '</span>';
    }).join(''));
    var roles  = Array.isArray(p.roles)  ? p.roles  : [];
    if (roles.length) h += row('Additional roles', roles.map(function(r){
      return '<span class="bz-chip muted">' + esc(typeof r === 'string' ? r : (r && (r.name || r.role) || '')) + '</span>';
    }).join(''));
    h += '<div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06);font-size:0.85rem;color:var(--warm-gray,#a09890);">' +
         '<button type="button" class="bz-link" onclick="window.bizNavToModule(\'employees\')" style="font-size:0.85rem;color:var(--warm-gray,#a09890);">Manage Mast admin users &rarr;</button>' +
         '</div>';
    h += '</div>';
    return h;
  }

  function renderOperations() {
    var o   = (entityData && entityData.operations) || {};
    var loc = o.localization || {};
    var h = sectionHeader('operations', 'Operations', '&#9881;&#65039;', [
      { label: 'Edit operations',   onclick: "window.bizNavToSettings('operations')" },
      { label: 'Tax jurisdictions', onclick: "window.bizNavToSettings('tax')"        }
    ]);
    h += '<div class="bz-card">';
    h += row('Business model', esc(o.businessModel || ''));
    var modes = Array.isArray(o.fulfillmentModes) ? o.fulfillmentModes : [];
    h += row('Fulfillment modes', modes.length ? modes.map(function(m){ return '<span class="bz-chip">' + esc(m) + '</span>'; }).join('') : '');
    h += row('Currency', esc(loc.currency || ''));
    h += row('Timezone', (loc.timezone ? esc(loc.timezone) : '') +
      ' <button type="button" class="bz-link" onclick="window.bizNavToSettings(\'operations\')" style="margin-left:8px;">Edit timezone in Settings &rarr;</button>');
    h += row('Language', esc(loc.language || ''));
    h += row('Fiscal year start month', loc.fiscalYearStartMonth != null ? esc(String(loc.fiscalYearStartMonth)) : '');
    if (o.serviceArea) {
      var sa = o.serviceArea;
      var txt = typeof sa === 'string' ? sa : (sa.type ? sa.type + (sa.note ? ' — ' + sa.note : '') : JSON.stringify(sa));
      h += row('Service area', esc(txt));
    }
    h += '</div>';
    return h;
  }

  function renderEngagement() {
    var eng = (entityData && entityData.engagement) || {};
    var cal = eng.calibration || {};
    var goals = Array.isArray(eng.goals) ? eng.goals : [];
    var mods = Array.isArray(eng.modulesShown) ? eng.modulesShown : [];
    var h = sectionHeader('engagement', 'Engagement', '&#128161;', [
      { label: 'Edit engagement', onclick: "window.bizNavToSettings('engagement')" }
    ]);
    h += '<div class="bz-card">';
    h += row('Mode', eng.mode ? esc(modeLabel(eng.mode)) : '');
    h += row('Surface', esc(eng.surface || ''));
    h += row('Goals', goals.length ? goals.map(function(g){ return '<span class="bz-chip">' + esc(goalLabel(g)) + '</span>'; }).join('') : '');
    if (cal.revenueBracket) h += row('Revenue', esc(cal.revenueBracket));
    if (cal.wishStatement) {
      var wish = cal.wishStatement;
      if (wish.length > 160) wish = wish.slice(0, 157) + '...';
      h += row('Wish', esc(wish));
    }
    if (mods.length) h += row('Modules shown', mods.map(function(m){ return '<span class="bz-chip muted">' + esc(m) + '</span>'; }).join(''));
    h += '</div>';
    return h;
  }

  function renderDiscovery() {
    var d = (entityData && entityData.discovery) || null;
    var h = sectionHeader('discovery', 'Discovery', '&#128269;', []);
    if (!d || !d.lastScrapeAt) {
      h += '<div class="bz-section-empty">No site scan on record yet.</div>';
      return h;
    }
    h += '<div class="bz-card">';
    h += row('Last scanned', esc(timeAgo(d.lastScrapeAt)) + ' (' + esc(fmtDate(d.lastScrapeAt)) + ')');
    if (d.scrapeUrl) h += row('Site', '<a href="' + esc(d.scrapeUrl) + '" target="_blank" rel="noopener" class="bz-link">' + esc(d.scrapeUrl) + '</a>');
    if (d.inferredArchetype) {
      var conf = d.archetypeConfidence != null ? ' (' + Math.round(d.archetypeConfidence * 100) + '% confident)' : '';
      h += row('Inferred archetype', esc(archetypeLabel(d.inferredArchetype)) + esc(conf));
    }
    var types = Array.isArray(d.inferredProductTypes) ? d.inferredProductTypes : [];
    if (types.length) h += row('Inferred products', types.map(function(t){ return '<span class="bz-chip muted">' + esc(t) + '</span>'; }).join(''));
    var chans = Array.isArray(d.inferredChannels) ? d.inferredChannels : [];
    if (chans.length) h += row('Inferred channels', chans.map(function(c){ return '<span class="bz-chip muted">' + esc(channelLabel(c)) + '</span>'; }).join(''));
    h += '</div>';
    return h;
  }

  // Defensive Array.isArray on every constants read. Without it, an early
  // call into label functions (before BusinessEntityConstants finishes
  // loading, or if a constant ever ships as non-array) throws
  // "list.filter is not a function" and tanks the whole render.
  // Caught by auto-detect on customers screen (feedback 2uxHr7aBYBgw5od6e7nr).
  function _bzListOrEmpty(key) {
    var c = window.BusinessEntityConstants && window.BusinessEntityConstants[key];
    return Array.isArray(c) ? c : [];
  }
  function archetypeLabel(v) {
    var m = _bzListOrEmpty('ARCHETYPES').filter(function(a){ return a.value === v; })[0];
    return m ? m.label : (v || '');
  }
  function goalLabel(v) {
    var map = (window.BusinessEntityConstants && BusinessEntityConstants.GOAL_LABELS) || {};
    return map[v] || v;
  }
  function channelLabel(v) {
    var m = _bzListOrEmpty('DECLARED_CHANNELS').filter(function(c){ return c.value === v; })[0];
    return m ? m.label : v;
  }
  function modeLabel(v) {
    var m = _bzListOrEmpty('ENGAGEMENT_MODE_CARDS').filter(function(c){ return c.value === v; })[0];
    return m ? m.title : (v || '');
  }
  function roleLabel(v) {
    var m = _bzListOrEmpty('PRIMARY_CONTACT_ROLES').filter(function(c){ return c.value === v; })[0];
    return m ? m.label : (v || '');
  }
  function teamSizeLabel(v) {
    var m = _bzListOrEmpty('TEAM_SIZE_BANDS').filter(function(c){ return c.value === v; })[0];
    return m ? m.label : (v || '');
  }

  function bindScrollSpy() {
    var anchors = document.querySelectorAll('#businessTab .bz-rail a');
    function onScroll() {
      // Pick the section whose header most recently passed the top threshold.
      // "Most recent" = smallest non-negative distance between threshold and top.
      // Matches "which section am I currently reading from the top?"
      var threshold = 120;
      var bestId = null, bestDist = Infinity;
      for (var i = 0; i < SECTIONS.length; i++) {
        var el = document.getElementById('bz-' + SECTIONS[i].id);
        if (!el) continue;
        var top = el.getBoundingClientRect().top;
        if (top <= threshold) {
          var dist = threshold - top;
          if (dist < bestDist) { bestDist = dist; bestId = SECTIONS[i].id; }
        }
      }
      // Before first section passes threshold, highlight the first.
      // After scrolling past the last, keep the last highlighted.
      if (!bestId && SECTIONS.length) bestId = SECTIONS[0].id;
      anchors.forEach(function(a){
        if (a.getAttribute('data-bz-anchor') === bestId) a.classList.add('active');
        else a.classList.remove('active');
      });
    }
    if (window._bzScrollSpy) window.removeEventListener('scroll', window._bzScrollSpy);
    window._bzScrollSpy = onScroll;
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // No route, no listeners — register only so loadModule() short-circuits on
  // repeat opens instead of re-fetching the script.
  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('business-view', {});
  }
})();
