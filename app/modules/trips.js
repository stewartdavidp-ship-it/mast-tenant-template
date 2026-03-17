/**
 * Trips & Mileage Module — Business trip tracking, mileage logging, tax reporting
 * Lazy-loaded via MastAdmin module registry.
 */
(function() {
  'use strict';

  // ============================================================
  // Module-private state
  // ============================================================

  var tripsData = [];
  var tripsLoaded = false;
  var showsData = window.showsData || {}; // Cross-module: loaded by shows module or fetched locally
  var showsLoaded = !!(window.showsData && Object.keys(window.showsData).length > 0);
  var tripLocationsData = {};
  var tripLocationsLoaded = false;
  var tripSettingsData = { irsRates: { '2025': 70, '2026': 70 }, knownLocations: ['home-studio', 'new-studio'] };
  var activeTripData = null; // current user's open trip
  var selectedTripPurpose = null;
  var selectedTripPurposeLabel = null; // For custom "Other" purposes
  var tripMilesSource = null;
  var tripPulseTimer = null;
  var customTripPurposes = []; // User-added custom purposes

  // Default trip purpose options (Other always last)
  var DEFAULT_TRIP_PURPOSES = [
    { key: 'fair-market', icon: '🎪', label: 'Fair/Market' },
    { key: 'vendor', icon: '🏭', label: 'Vendor' },
    { key: 'supplies', icon: '🛒', label: 'Supplies' },
    { key: 'studio-run', icon: '🏠', label: 'Studio Run' },
    { key: 'bank', icon: '🏦', label: 'Bank' },
    { key: 'delivery', icon: '📦', label: 'Delivery' }
  ];
  var TRIP_PURPOSES = DEFAULT_TRIP_PURPOSES.concat([{ key: 'other', icon: '✏️', label: 'Other' }]);

  // Retroactive trip modal state
  var retroModalData = null;
  var distanceCalcTimeout = null;
  var tripReminderTimer = null;

  // ============================================================
  // Helpers — access globals from core
  // ============================================================

  function tripsGetUid() {
    return currentUser ? currentUser.uid : null;
  }

  // ============================================================
  // Load Functions
  // ============================================================

  function loadTrips() {
    var user = auth.currentUser;
    if (!user) return;
    // Load custom purposes on first load
    if (!tripsLoaded) loadCustomTripPurposes();
    var loading = document.getElementById('tripsLoading');
    if (loading) loading.style.display = '';

    MastDB.trips.ref(user.uid).orderByChild('startTime').limitToLast(200).once('value').then(function(snap) {
      var val = snap.val();
      tripsData = val ? Object.keys(val).map(function(k) { var t = val[k]; t.id = k; return t; }) : [];
      tripsData.sort(function(a, b) { return (b.startTime || '').localeCompare(a.startTime || ''); });
      tripsLoaded = true;
      // Check for active trip
      activeTripData = tripsData.find(function(t) { return t.status === 'open'; }) || null;
      if (activeTripData) showTripPulsingIndicator();
      renderTripsHistory();
      if (loading) loading.style.display = 'none';
    }).catch(function(err) {
      console.error('Error loading trips:', err);
      if (loading) loading.style.display = 'none';
    });
  }

  function loadTripLocations() {
    MastDB.tripLocations.ref().once('value').then(function(snap) {
      tripLocationsData = snap.val() || {};
      tripLocationsLoaded = true;
      // Auto-seed default locations if empty
      if (Object.keys(tripLocationsData).length === 0 && isAdmin()) {
        var seeds = {
          'home-studio': { label: 'Home Studio', lat: 0, lng: 0, useCount: 0, lastUsed: new Date().toISOString() },
          'new-studio': { label: 'New Studio', lat: 0, lng: 0, useCount: 0, lastUsed: new Date().toISOString() }
        };
        MastDB.tripLocations.ref().set(seeds).then(function() {
          tripLocationsData = seeds;
        }).catch(function() {});
      }
    });
  }

  function loadTripSettings() {
    MastDB.tripSettings.ref().once('value').then(function(snap) {
      var val = snap.val();
      if (val) {
        tripSettingsData = val;
        if (!tripSettingsData.irsRates) tripSettingsData.irsRates = { '2025': 70, '2026': 70 };
      } else if (isAdmin()) {
        // Auto-seed defaults
        var defaults = { irsRates: { '2025': 70, '2026': 70 }, knownLocations: ['home-studio', 'new-studio'] };
        MastDB.tripSettings.ref().set(defaults).then(function() {
          tripSettingsData = defaults;
        }).catch(function() {}); // silent if write fails
      }
    });
  }

  // ============================================================
  // Check for Active Trip
  // ============================================================

  function checkForActiveTrip() {
    var user = auth.currentUser;
    if (!user) return;
    MastDB.trips.ref(user.uid).orderByChild('status').equalTo('open').limitToLast(1).once('value').then(function(snap) {
      var val = snap.val();
      if (val) {
        var key = Object.keys(val)[0];
        activeTripData = val[key];
        activeTripData.id = key;
        showTripPulsingIndicator();
        renderActiveTripBanner();
      } else {
        activeTripData = null;
        hideTripPulsingIndicator();
      }
    });
  }

  // ============================================================
  // Pulsing Indicator
  // ============================================================

  function showTripPulsingIndicator() {
    var el = document.getElementById('tripPulsingIndicator');
    if (el) el.style.display = '';
    updatePulseLabel();
    if (tripPulseTimer) clearInterval(tripPulseTimer);
    tripPulseTimer = setInterval(updatePulseLabel, 60000);
  }

  function hideTripPulsingIndicator() {
    var el = document.getElementById('tripPulsingIndicator');
    if (el) el.style.display = 'none';
    if (tripPulseTimer) { clearInterval(tripPulseTimer); tripPulseTimer = null; }
  }

  function updatePulseLabel() {
    if (!activeTripData || !activeTripData.startTime) return;
    var elapsed = Date.now() - new Date(activeTripData.startTime).getTime();
    var mins = Math.floor(elapsed / 60000);
    var hrs = Math.floor(mins / 60);
    mins = mins % 60;
    var label = hrs > 0 ? hrs + 'h ' + mins + 'm' : mins + 'm';
    var el = document.getElementById('tripPulseLabel');
    if (el) el.textContent = 'Trip in progress · ' + label;
  }

  // ============================================================
  // Active Trip Banner
  // ============================================================

  function renderActiveTripBanner() {
    var banner = document.getElementById('activeTripBanner');
    if (!banner) return;
    if (!activeTripData) { banner.style.display = 'none'; return; }
    var elapsed = Date.now() - new Date(activeTripData.startTime).getTime();
    var mins = Math.floor(elapsed / 60000);
    var hrs = Math.floor(mins / 60);
    mins = mins % 60;
    var timeStr = hrs > 0 ? hrs + 'h ' + mins + 'm' : mins + 'm';
    var dest = activeTripData.destination ? activeTripData.destination.label : 'Unknown';
    banner.style.display = '';
    banner.innerHTML = '<div style="background:linear-gradient(135deg,#f59e0b,#d97706);color:white;border-radius:10px;padding:16px 20px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;" onclick="openEndTripSheet()">' +
      '<div>' +
        '<div style="font-weight:700;font-size:1rem;">🚗 Trip in Progress</div>' +
        '<div style="font-size:0.85rem;opacity:0.9;">To ' + esc(dest) + ' · ' + timeStr + '</div>' +
      '</div>' +
      '<button class="btn" style="background:white;color:#d97706;font-weight:700;border:none;padding:8px 16px;border-radius:8px;font-size:0.85rem;">End Trip</button>' +
    '</div>';
  }

  // ============================================================
  // Start Trip
  // ============================================================

  function openStartTripModal() {
    // Check for existing open trip first
    if (activeTripData) {
      showToast('You already have an open trip. End it first.', true);
      openEndTripSheet();
      return;
    }

    var modal = document.getElementById('startTripModal');
    if (modal) modal.style.display = 'flex';

    // Load locations if not loaded
    if (!tripLocationsLoaded) loadTripLocations();
    loadTripSettings();

    // GPS
    var statusEl = document.getElementById('startTripGpsStatus');
    var originSelect = document.getElementById('startTripOrigin');
    originSelect.innerHTML = '<option value="">Detecting location...</option>';

    if (!navigator.geolocation) {
      statusEl.textContent = '⚠️ GPS not available — select origin manually';
      populateOriginDropdown(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      function(pos) {
        var lat = pos.coords.latitude;
        var lng = pos.coords.longitude;
        statusEl.textContent = '📍 Location found';
        populateOriginDropdown({ lat: lat, lng: lng });
      },
      function(err) {
        statusEl.textContent = '⚠️ Could not get GPS — select origin manually';
        populateOriginDropdown(null);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );

    // Populate destination datalist
    populateDestinationList();
  }

  function populateOriginDropdown(gpsCoords) {
    var select = document.getElementById('startTripOrigin');
    var options = '<option value="">-- Select Origin --</option>';

    // Find nearest location if GPS available
    var nearestKey = null;
    if (gpsCoords && tripLocationsLoaded) {
      var minDist = Infinity;
      Object.keys(tripLocationsData).forEach(function(k) {
        var loc = tripLocationsData[k];
        if (!loc.lat || !loc.lng) return;
        var dist = haversineMeters(gpsCoords.lat, gpsCoords.lng, loc.lat, loc.lng);
        if (dist < minDist) { minDist = dist; nearestKey = k; }
      });
      if (minDist > 500) nearestKey = null; // not close enough
    }

    // Add locations sorted by use count
    var locKeys = Object.keys(tripLocationsData);
    locKeys.sort(function(a, b) {
      return (tripLocationsData[b].useCount || 0) - (tripLocationsData[a].useCount || 0);
    });
    locKeys.forEach(function(k) {
      var loc = tripLocationsData[k];
      var selected = k === nearestKey ? ' selected' : '';
      options += '<option value="' + k + '"' + selected + '>' + esc(loc.label || k) + '</option>';
    });

    // Also check studio locations
    Object.keys(studioLocations).forEach(function(k) {
      var sl = studioLocations[k];
      var alreadyInTrips = locKeys.some(function(lk) {
        return tripLocationsData[lk].label === sl.name;
      });
      if (!alreadyInTrips) {
        options += '<option value="studio_' + k + '">' + esc(sl.name) + ' (Studio)</option>';
      }
    });

    select.innerHTML = options;
  }

  function populateDestinationList() {
    var datalist = document.getElementById('destinationList');
    if (!datalist) return;
    var html = '';
    var locKeys = Object.keys(tripLocationsData);
    locKeys.sort(function(a, b) {
      return (tripLocationsData[b].useCount || 0) - (tripLocationsData[a].useCount || 0);
    });
    locKeys.forEach(function(k) {
      var loc = tripLocationsData[k];
      html += '<option value="' + esc(loc.label || k) + '">';
    });
    datalist.innerHTML = html;
  }

  function closeStartTripModal() {
    var modal = document.getElementById('startTripModal');
    if (modal) modal.style.display = 'none';
  }

  function confirmStartTrip() {
    var user = auth.currentUser;
    if (!user) { showToast('Not signed in', true); return; }

    var originKey = document.getElementById('startTripOrigin').value;
    var destInput = document.getElementById('startTripDestination').value.trim();

    if (!originKey) { showToast('Select an origin', true); return; }
    if (!destInput) { showToast('Enter a destination', true); return; }

    // Resolve origin
    var origin = { label: 'Unknown', lat: 0, lng: 0, geocoded: false };
    if (originKey.startsWith('studio_')) {
      var studioKey = originKey.replace('studio_', '');
      var sl = studioLocations[studioKey];
      if (sl) origin = { label: sl.name, lat: sl.lat, lng: sl.lng, geocoded: true };
    } else if (tripLocationsData[originKey]) {
      var loc = tripLocationsData[originKey];
      origin = { label: loc.label || originKey, lat: loc.lat || 0, lng: loc.lng || 0, geocoded: !!loc.lat };
    }

    // Resolve destination — check if it matches existing location
    var destination = { label: destInput, lat: 0, lng: 0, geocoded: false };
    var matchedDestKey = Object.keys(tripLocationsData).find(function(k) {
      return (tripLocationsData[k].label || '').toLowerCase() === destInput.toLowerCase();
    });
    if (matchedDestKey) {
      var dl = tripLocationsData[matchedDestKey];
      destination = { label: dl.label, lat: dl.lat || 0, lng: dl.lng || 0, geocoded: !!dl.lat };
    }

    // Get IRS rate for current year
    var year = new Date().getFullYear();
    var rate = tripSettingsData.irsRates ? (tripSettingsData.irsRates[year] || tripSettingsData.irsRates[year - 1] || 70) : 70;

    var tripRef = MastDB.trips.push(user.uid);
    var tripData = {
      tripId: tripRef.key,
      driverId: user.uid,
      driverName: user.displayName || user.email || 'Unknown',
      status: 'open',
      startTime: new Date().toISOString(),
      endTime: null,
      origin: origin,
      destination: destination,
      miles: 0,
      milesSource: null,
      purpose: null,
      notes: '',
      irsRateYear: year,
      irsRateCentsPerMile: rate,
      deductibleValue: 0,
      expenses: [],
      entryMethod: 'live'
    };

    tripRef.set(tripData).then(function() {
      // Add destination to tripLocations if new
      if (!matchedDestKey) {
        var slug = destInput.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        MastDB.tripLocations.ref(slug).set({
          label: destInput, lat: 0, lng: 0, useCount: 0, lastUsed: new Date().toISOString()
        });
        tripLocationsData[slug] = { label: destInput, lat: 0, lng: 0, useCount: 0 };
      }

      activeTripData = tripData;
      activeTripData.id = tripRef.key;
      showTripPulsingIndicator();
      closeStartTripModal();
      showToast('Trip started — drive safe! 🚗');
      requestNotificationPermission(); // Ask for notification permission when starting a trip
      writeAudit('create', 'trips', tripRef.key);
      emitTestingEvent('trip_started', { tripId: tripRef.key });
      emitTestingEvent('trip_destination_set', { tripId: tripRef.key, destination: destInput });

      // Schedule 4hr notification
      scheduleTripReminder();

      // Refresh if on trips page
      if (currentRoute === 'trips') { tripsLoaded = false; loadTrips(); }
      if (currentRoute === 'dashboard') renderActiveTripBanner();
    }).catch(function(err) {
      showToast('Error starting trip: ' + err.message, true);
    });
  }

  // ============================================================
  // End Trip
  // ============================================================

  function openEndTripSheet() {
    if (!activeTripData) { showToast('No active trip', true); return; }
    var sheet = document.getElementById('endTripSheet');
    if (sheet) sheet.style.display = '';

    // Elapsed time
    var elapsed = Date.now() - new Date(activeTripData.startTime).getTime();
    var mins = Math.floor(elapsed / 60000);
    var hrs = Math.floor(mins / 60);
    mins = mins % 60;
    var elapsedEl = document.getElementById('endTripElapsed');
    if (elapsedEl) elapsedEl.textContent = '⏱️ ' + (hrs > 0 ? hrs + 'h ' + mins + 'm' : mins + ' minutes');

    // Pre-fill destination
    var destEl = document.getElementById('endTripDestination');
    if (destEl && activeTripData.destination) destEl.value = activeTripData.destination.label || '';

    // Reset purpose selection
    selectedTripPurpose = null;
    selectedTripPurposeLabel = null;
    renderPurposeQuickPick();

    // Auto-calculate miles via Maps API
    var milesEl = document.getElementById('endTripMiles');
    var sourceEl = document.getElementById('endTripMilesSource');
    if (milesEl) milesEl.value = '';
    if (sourceEl) sourceEl.textContent = 'Calculating...';
    tripMilesSource = null;

    calculateTripDistance();

    // Populate destination datalist
    populateDestinationList();
  }

  function renderPurposeQuickPick() {
    var container = document.getElementById('purposeQuickPick');
    if (!container) return;
    var html = '';
    TRIP_PURPOSES.forEach(function(p) {
      var selected = selectedTripPurpose === p.key ? ' selected' : '';
      html += '<div class="purpose-chip' + selected + '" onclick="selectTripPurpose(\'' + p.key + '\')">' +
        p.icon + ' ' + p.label + '</div>';
    });
    container.innerHTML = html;
  }

  function selectTripPurpose(key) {
    if (key === 'other') {
      showOtherPurposeModal();
      return;
    }
    selectedTripPurpose = key;
    selectedTripPurposeLabel = null;
    renderPurposeQuickPick();
  }

  function showOtherPurposeModal() {
    // Remove existing modal if any
    var existing = document.getElementById('otherPurposeModal');
    if (existing) existing.remove();

    var isDark = document.body.classList.contains('dark-mode');
    var bg = isDark ? '#2a2a2a' : 'white';
    var border = isDark ? '#444' : '#ddd';
    var textColor = isDark ? '#e0e0e0' : '#1A1A1A';
    var inputBg = isDark ? '#1e1e1e' : '#f9f9f9';

    var overlay = document.createElement('div');
    overlay.id = 'otherPurposeModal';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML =
      '<div style="background:' + bg + ';border-radius:12px;padding:24px;width:100%;max-width:340px;box-shadow:0 8px 32px rgba(0,0,0,0.3);">' +
        '<div style="font-weight:700;font-size:1rem;margin-bottom:4px;color:' + textColor + ';">What was this trip for?</div>' +
        '<div style="font-size:0.8rem;color:var(--warm-gray);margin-bottom:16px;">Enter a purpose — it will be saved for future trips.</div>' +
        '<input id="otherPurposeInput" type="text" placeholder="e.g. Glass class, Repair job, Post office" ' +
          'style="width:100%;padding:10px 12px;border:1px solid ' + border + ';border-radius:8px;font-size:0.9rem;' +
          'background:' + inputBg + ';color:' + textColor + ';box-sizing:border-box;font-family:DM Sans,sans-serif;" />' +
        '<div style="display:flex;gap:10px;margin-top:16px;">' +
          '<button onclick="cancelOtherPurpose()" style="flex:1;padding:10px;border:1px solid ' + border + ';border-radius:8px;background:transparent;color:' + textColor + ';cursor:pointer;font-family:DM Sans,sans-serif;font-size:0.85rem;">Cancel</button>' +
          '<button onclick="confirmOtherPurpose()" style="flex:1;padding:10px;border:none;border-radius:8px;background:var(--amber-glow,#C4853C);color:white;cursor:pointer;font-weight:600;font-family:DM Sans,sans-serif;font-size:0.85rem;">Save</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    // Focus input
    setTimeout(function() {
      var input = document.getElementById('otherPurposeInput');
      if (input) input.focus();
    }, 100);

    // Enter key to confirm
    var input = document.getElementById('otherPurposeInput');
    if (input) {
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') confirmOtherPurpose();
        if (e.key === 'Escape') cancelOtherPurpose();
      });
    }
  }

  function cancelOtherPurpose() {
    var modal = document.getElementById('otherPurposeModal');
    if (modal) modal.remove();
  }

  function confirmOtherPurpose() {
    var input = document.getElementById('otherPurposeInput');
    var value = input ? input.value.trim() : '';
    if (!value) {
      showToast('Enter a purpose description', true);
      return;
    }

    // Generate a key from the label
    var key = 'custom-' + value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    // Save to Firebase so it appears in future trips
    var alreadyExists = customTripPurposes.some(function(p) { return p.key === key; });
    if (!alreadyExists) {
      var newPurpose = { key: key, icon: '📌', label: value };
      customTripPurposes.push(newPurpose);
      rebuildTripPurposes();
      // Persist to Firebase
      MastDB.tripCustomPurposes.ref().child(key).set({ icon: '📌', label: value, createdAt: new Date().toISOString() });
    }

    // Select it
    selectedTripPurpose = key;
    selectedTripPurposeLabel = value;
    renderPurposeQuickPick();
    cancelOtherPurpose();
  }

  function rebuildTripPurposes() {
    TRIP_PURPOSES = DEFAULT_TRIP_PURPOSES.concat(customTripPurposes).concat([{ key: 'other', icon: '✏️', label: 'Other' }]);
  }

  function loadCustomTripPurposes() {
    MastDB.tripCustomPurposes.ref().once('value').then(function(snap) {
      var data = snap.val();
      if (!data) return;
      customTripPurposes = [];
      Object.keys(data).forEach(function(key) {
        customTripPurposes.push({ key: key, icon: data[key].icon || '📌', label: data[key].label });
      });
      rebuildTripPurposes();
    });
  }

  function closeEndTripSheet() {
    var sheet = document.getElementById('endTripSheet');
    if (sheet) sheet.style.display = 'none';
  }

  function confirmEndTrip() {
    if (!activeTripData) return;
    var user = auth.currentUser;
    if (!user) return;

    var miles = parseFloat(document.getElementById('endTripMiles').value) || 0;
    var destValue = document.getElementById('endTripDestination').value.trim();
    var notes = document.getElementById('endTripNotes').value.trim();

    // Inline validation with visual feedback
    var hasError = false;

    if (!selectedTripPurpose) {
      showToast('Select a trip purpose', true);
      var purposeContainer = document.getElementById('purposeQuickPick');
      if (purposeContainer) {
        purposeContainer.style.outline = '2px solid #dc2626';
        purposeContainer.style.borderRadius = '8px';
        purposeContainer.style.padding = '4px';
        purposeContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(function() { purposeContainer.style.outline = ''; purposeContainer.style.padding = ''; }, 3000);
      }
      hasError = true;
    }

    if (miles < 0) { showToast('Miles cannot be negative', true); hasError = true; }
    if (miles === 0 && tripMilesSource !== 'same-location') {
      if (!tripMilesSource || tripMilesSource === null) {
        showToast('Enter miles or tap "Enter miles manually"', true);
        var milesInput = document.getElementById('endTripMiles');
        if (milesInput) { milesInput.style.outline = '2px solid #dc2626'; setTimeout(function() { milesInput.style.outline = ''; }, 3000); }
        hasError = true;
      }
    }

    if (hasError) return;

    var source = tripMilesSource || 'manual-override';
    var rate = activeTripData.irsRateCentsPerMile || 70;
    var deductible = Math.round(miles * (rate / 100) * 100) / 100;

    // Update destination if changed
    var destination = activeTripData.destination || { label: destValue, lat: 0, lng: 0, geocoded: false };
    if (destValue && destValue !== destination.label) {
      destination.label = destValue;
    }

    // For custom purposes, store the label too
    var purposeLabel = selectedTripPurposeLabel || null;
    var purposeObj = TRIP_PURPOSES.find(function(p) { return p.key === selectedTripPurpose; });
    if (purposeObj && !purposeLabel) purposeLabel = purposeObj.label;

    var updates = {
      status: 'completed',
      endTime: new Date().toISOString(),
      miles: miles,
      milesSource: source,
      purpose: selectedTripPurpose,
      purposeLabel: purposeLabel,
      notes: notes,
      destination: destination,
      deductibleValue: deductible
    };

    MastDB.trips.update(user.uid, activeTripData.id, updates).then(function() {
      // Increment location use counts
      incrementLocationUseCount(activeTripData.origin);
      incrementLocationUseCount(destination);

      // Increment quick action count
      incrementQuickAction('start-trip');

      hideTripPulsingIndicator();
      closeEndTripSheet();
      activeTripData = null;
      showToast('Trip logged — ' + miles.toFixed(1) + ' miles · $' + deductible.toFixed(2) + ' deductible');
      writeAudit('update', 'trips', activeTripData ? activeTripData.id : 'unknown');
      emitTestingEvent('trip_completed', { tripId: activeTripData ? activeTripData.id : null, miles: miles, deductible: deductible });

      // Cancel reminder
      cancelTripReminder();

      // Refresh
      tripsLoaded = false;
      if (currentRoute === 'trips') loadTrips();
      if (currentRoute === 'dashboard') {
        var banner = document.getElementById('activeTripBanner');
        if (banner) banner.style.display = 'none';
      }
    }).catch(function(err) {
      showToast('Error ending trip: ' + err.message, true);
    });
  }

  function incrementLocationUseCount(locationObj) {
    if (!locationObj || !locationObj.label) return;
    var slug = locationObj.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    var ref = MastDB.tripLocations.ref(slug);
    ref.child('useCount').set(firebase.database.ServerValue.increment(1));
    ref.child('lastUsed').set(new Date().toISOString());
    // Ensure label is set
    ref.child('label').set(locationObj.label);
  }

  function discardActiveTrip() {
    if (!activeTripData) return;
    if (!confirm('Discard this trip? It will be deleted and not logged.')) return;
    var user = auth.currentUser;
    if (!user) return;
    MastDB.trips.ref(user.uid + '/' + activeTripData.id).remove().then(function() {
      hideTripPulsingIndicator();
      closeEndTripSheet();
      activeTripData = null;
      showToast('Trip discarded');
      tripsLoaded = false;
      if (currentRoute === 'trips') loadTrips();
      var banner = document.getElementById('activeTripBanner');
      if (banner) banner.style.display = 'none';
    }).catch(function(err) {
      showToast('Error discarding trip: ' + err.message, true);
    });
  }

  // ============================================================
  // Distance Calculation (Google Maps Directions API)
  // ============================================================

  function calculateTripDistance() {
    if (!activeTripData) return;
    var origin = activeTripData.origin;
    var dest = activeTripData.destination;

    if (!origin || !dest) {
      setManualMilesMode('No origin/destination');
      return;
    }

    // Check if origin and destination are the same location (user hasn't moved)
    if (origin.lat && origin.lng && dest.lat && dest.lng) {
      var distMetersHav = haversineMeters(origin.lat, origin.lng, dest.lat, dest.lng);
      if (distMetersHav < 100) { // Less than 100 meters — effectively same spot
        document.getElementById('endTripMiles').value = 0;
        document.getElementById('endTripMilesSource').textContent = '📍 Same location';
        tripMilesSource = 'same-location';
        return;
      }
    }

    // Try using coordinates if available
    var originStr = origin.lat && origin.lng ? origin.lat + ',' + origin.lng : origin.label;
    var destStr = dest.lat && dest.lng ? dest.lat + ',' + dest.lng : dest.label;

    if (!originStr || !destStr) {
      setManualMilesMode('Missing location data');
      return;
    }

    // Set a timeout — if Maps API callback doesn't fire within 5s, fall back to manual/haversine
    if (distanceCalcTimeout) clearTimeout(distanceCalcTimeout);
    distanceCalcTimeout = setTimeout(function() {
      // API didn't respond in time — try haversine fallback
      if (origin.lat && origin.lng && dest.lat && dest.lng) {
        var fallbackMeters = haversineMeters(origin.lat, origin.lng, dest.lat, dest.lng);
        var fallbackMiles = Math.round((fallbackMeters / 1609.344) * 10) / 10;
        document.getElementById('endTripMiles').value = fallbackMiles;
        document.getElementById('endTripMilesSource').textContent = '📍 Estimated (straight-line)';
        tripMilesSource = 'haversine-fallback';
      } else {
        setManualMilesMode('Enter miles manually');
      }
    }, 5000);

    try {
      if (window.google && window.google.maps) {
        var service = new google.maps.DistanceMatrixService();
        service.getDistanceMatrix({
          origins: [originStr],
          destinations: [destStr],
          travelMode: 'DRIVING',
          unitSystem: google.maps.UnitSystem.IMPERIAL
        }, function(response, status) {
          // Cancel timeout — we got a response
          if (distanceCalcTimeout) { clearTimeout(distanceCalcTimeout); distanceCalcTimeout = null; }
          if (status === 'OK' && response.rows[0] && response.rows[0].elements[0].status === 'OK') {
            var distMeters = response.rows[0].elements[0].distance.value;
            var miles = Math.round((distMeters / 1609.344) * 10) / 10;
            document.getElementById('endTripMiles').value = miles;
            document.getElementById('endTripMilesSource').textContent = '📍 via Google Maps';
            tripMilesSource = 'maps-api';
          } else {
            setManualMilesMode('Maps unavailable');
          }
        });
      } else {
        // No Google Maps JS — cancel timeout and fall back immediately
        if (distanceCalcTimeout) { clearTimeout(distanceCalcTimeout); distanceCalcTimeout = null; }
        if (origin.lat && origin.lng && dest.lat && dest.lng) {
          var hvMeters = haversineMeters(origin.lat, origin.lng, dest.lat, dest.lng);
          var hvMiles = Math.round((hvMeters / 1609.344) * 10) / 10;
          document.getElementById('endTripMiles').value = hvMiles;
          document.getElementById('endTripMilesSource').textContent = '📍 Estimated (straight-line)';
          tripMilesSource = 'haversine-fallback';
        } else {
          setManualMilesMode('Enter miles manually');
        }
      }
    } catch (e) {
      if (distanceCalcTimeout) { clearTimeout(distanceCalcTimeout); distanceCalcTimeout = null; }
      setManualMilesMode('Enter miles manually');
    }
  }

  function setManualMilesMode(reason) {
    var sourceEl = document.getElementById('endTripMilesSource');
    if (sourceEl) sourceEl.textContent = reason || 'Enter miles manually';
    tripMilesSource = 'manual-override';
  }

  // ============================================================
  // Haversine Distance
  // ============================================================

  function haversineMeters(lat1, lng1, lat2, lng2) {
    var R = 6371000;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng/2) * Math.sin(dLng/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  // ============================================================
  // Trip Reminder (Push Notification fallback: in-app timer)
  // ============================================================

  function scheduleTripReminder() {
    cancelTripReminder();
    // 4 hours
    tripReminderTimer = setTimeout(function() {
      if (activeTripData) {
        showToast('⚠️ You have an open trip — still traveling?');
        // Also try browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification((TENANT_BRAND && TENANT_BRAND.name) || 'Admin', {
            body: 'You have an open trip — still traveling? Tap to end it.',
            icon: '/favicon.svg'
          });
        }
      }
    }, 4 * 60 * 60 * 1000);
  }

  function cancelTripReminder() {
    if (tripReminderTimer) { clearTimeout(tripReminderTimer); tripReminderTimer = null; }
  }

  // Request notification permission on first trip
  function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  // ============================================================
  // On-launch safety net: check if user is near known location
  // ============================================================

  function checkForgottenTrip() {
    if (!activeTripData) return;
    if (!navigator.geolocation) return;

    // Only check GPS if permission was already granted — don't prompt on startup
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' }).then(function(result) {
        if (result.state === 'granted') {
          doForgottenTripCheck();
        }
        // If 'prompt' or 'denied', skip silently — don't bother user on launch
      }).catch(function() {
        // permissions API not supported — skip to avoid popup
      });
    }
    return;
  }

  function doForgottenTripCheck() {
    navigator.geolocation.getCurrentPosition(function(pos) {
      var lat = pos.coords.latitude;
      var lng = pos.coords.longitude;

      // Check against studio locations
      var nearLocation = null;
      Object.keys(studioLocations).forEach(function(k) {
        var sl = studioLocations[k];
        if (haversineMeters(lat, lng, sl.lat, sl.lng) < 200) {
          nearLocation = sl.name;
        }
      });
      // Check trip locations too
      if (!nearLocation) {
        Object.keys(tripLocationsData).forEach(function(k) {
          var tl = tripLocationsData[k];
          if (tl.lat && tl.lng && haversineMeters(lat, lng, tl.lat, tl.lng) < 200) {
            nearLocation = tl.label || k;
          }
        });
      }

      if (nearLocation) {
        // Show soft prompt
        var banner = document.getElementById('activeTripBanner');
        if (banner && currentRoute === 'trips') {
          banner.innerHTML += '<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:12px 16px;margin-bottom:12px;font-size:0.85rem;color:#92400e;">' +
            '📍 Looks like you\'re back at <strong>' + esc(nearLocation) + '</strong> — ' +
            '<a href="#" onclick="openEndTripSheet();return false;" style="color:#d97706;font-weight:600;">end your trip?</a>' +
          '</div>';
        }
      }
    }, function() {}, { enableHighAccuracy: false, timeout: 5000, maximumAge: 120000 });
  }

  // ============================================================
  // Trips History View
  // ============================================================

  function switchTripsSubView(view) {
    var history = document.getElementById('tripsSubHistory');
    var report = document.getElementById('tripsSubReport');
    if (history) history.style.display = view === 'history' ? '' : 'none';
    if (report) report.style.display = view === 'report' ? '' : 'none';

    document.querySelectorAll('#tripsSubNav .view-tab').forEach(function(btn) { btn.classList.remove('active'); });
    document.querySelectorAll('#tripsSubNav .view-tab').forEach(function(btn, i) {
      if ((i === 0 && view === 'history') || (i === 1 && view === 'report')) btn.classList.add('active');
    });

    if (view === 'report') {
      renderTaxReport();
      emitTestingEvent('trip_report_viewed', {});
    }
  }

  function renderTripsHistory() {
    var headerActions = document.getElementById('tripsHeaderActions');
    if (headerActions) {
      headerActions.innerHTML = '<button class="btn btn-secondary btn-sm" onclick="openPreviousTripsModal()" style="margin-right:6px;">Previous Trips</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="startRetroactiveManual()" style="margin-right:6px;">Add Past Trip</button>' +
        '<button class="btn btn-primary" onclick="openStartTripModal()">🚗 Start Trip</button>';
    }

    // Filters
    var filtersEl = document.getElementById('tripsFilters');
    if (filtersEl) {
      var currentYear = new Date().getFullYear();
      var currentMonth = new Date().getMonth();
      filtersEl.innerHTML = '<select id="tripsMonthFilter" onchange="renderTripsList()" style="padding:6px 12px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.85rem;">' +
        '<option value="all">All Time</option>' +
        '<option value="' + currentYear + '-' + (currentMonth + 1) + '" selected>This Month</option>' +
        '<option value="' + currentYear + '-' + currentMonth + '">' + getMonthName(currentMonth - 1) + '</option>' +
        '<option value="' + currentYear + '">This Year (' + currentYear + ')</option>' +
        '<option value="' + (currentYear - 1) + '">' + (currentYear - 1) + '</option>' +
      '</select>' +
      (isAdmin() ? ' <label style="font-size:0.85rem;display:flex;align-items:center;gap:6px;"><input type="checkbox" id="tripsAllDrivers" onchange="loadAllDriversTrips()"> All Drivers</label>' : '');
    }

    renderActiveTripBanner();
    renderTripsList();
  }

  function getMonthName(idx) {
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[((idx % 12) + 12) % 12];
  }

  function renderTripsList() {
    var container = document.getElementById('tripsList');
    if (!container) return;

    var completed = tripsData.filter(function(t) { return t.status === 'completed'; });

    // Apply date filter
    var filterVal = document.getElementById('tripsMonthFilter') ? document.getElementById('tripsMonthFilter').value : 'all';
    if (filterVal !== 'all') {
      var parts = filterVal.split('-');
      var filterYear = parseInt(parts[0]);
      var filterMonth = parts[1] ? parseInt(parts[1]) : null;
      completed = completed.filter(function(t) {
        var d = new Date(t.startTime);
        if (filterMonth) return d.getFullYear() === filterYear && (d.getMonth() + 1) === filterMonth;
        return d.getFullYear() === filterYear;
      });
    }

    if (completed.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--warm-gray);"><p style="font-size:1.2rem;margin-bottom:8px;">No trips yet</p><p style="font-size:0.85rem;">Start your first business trip to begin tracking mileage.</p></div>';
      return;
    }

    // Summary
    var totalMiles = 0, totalDeductible = 0;
    completed.forEach(function(t) { totalMiles += (t.miles || 0); totalDeductible += (t.deductibleValue || 0); });

    var html = '<div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap;">' +
      '<div class="trip-stat-card" style="background:var(--cream,#FAF6F0);border-radius:8px;padding:12px 18px;flex:1;min-width:120px;text-align:center;">' +
        '<div class="trip-stat-value" style="font-size:1.5rem;font-weight:700;color:var(--charcoal);">' + completed.length + '</div>' +
        '<div class="trip-stat-label" style="font-size:0.78rem;color:var(--warm-gray);">Trips</div>' +
      '</div>' +
      '<div class="trip-stat-card" style="background:var(--cream,#FAF6F0);border-radius:8px;padding:12px 18px;flex:1;min-width:120px;text-align:center;">' +
        '<div class="trip-stat-value" style="font-size:1.5rem;font-weight:700;color:var(--charcoal);">' + totalMiles.toFixed(1) + '</div>' +
        '<div class="trip-stat-label" style="font-size:0.78rem;color:var(--warm-gray);">Miles</div>' +
      '</div>' +
      '<div class="trip-stat-card" style="background:var(--cream,#FAF6F0);border-radius:8px;padding:12px 18px;flex:1;min-width:120px;text-align:center;">' +
        '<div class="trip-stat-value" style="font-size:1.5rem;font-weight:700;color:var(--charcoal);">$' + totalDeductible.toFixed(2) + '</div>' +
        '<div class="trip-stat-label" style="font-size:0.78rem;color:var(--warm-gray);">Deductible</div>' +
      '</div>' +
    '</div>';

    // Trip rows
    completed.forEach(function(t) {
      var d = new Date(t.startTime);
      var dateStr = (d.getMonth()+1) + '/' + d.getDate() + '/' + d.getFullYear();
      var dest = t.destination ? t.destination.label : 'Unknown';
      var purposeObj = TRIP_PURPOSES.find(function(p) { return p.key === t.purpose; });
      var purposeIcon = purposeObj ? purposeObj.icon : (t.purpose && t.purpose.indexOf('custom-') === 0 ? '📌' : '•');
      var driverNote = t.driverName && t.driverId !== (auth.currentUser ? auth.currentUser.uid : '') ? ' · ' + esc(t.driverName) : '';

      html += '<div class="trip-card" style="background:white;border:1px solid #eee;border-radius:8px;padding:12px 16px;margin-bottom:8px;cursor:pointer;" onclick="toggleTripDetail(\'' + t.id + '\')">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<div>' +
            '<span class="trip-dest" style="font-weight:600;font-size:0.9rem;">' + purposeIcon + ' ' + esc(dest) + '</span>' +
            '<div style="font-size:0.8rem;color:var(--warm-gray);">' + dateStr + driverNote + '</div>' +
          '</div>' +
          '<div style="text-align:right;">' +
            '<div class="trip-miles" style="font-weight:600;">' + (t.miles || 0).toFixed(1) + ' mi</div>' +
            '<div class="trip-deductible" style="font-size:0.8rem;color:#059669;">$' + (t.deductibleValue || 0).toFixed(2) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="trip-detail" id="tripDetail_' + t.id + '" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid #eee;font-size:0.85rem;color:var(--warm-gray);">' +
          '<div>Origin: ' + esc(t.origin ? t.origin.label : 'Unknown') + '</div>' +
          '<div>Destination: ' + esc(dest) + '</div>' +
          '<div>Purpose: ' + (purposeObj ? purposeObj.icon + ' ' + purposeObj.label : (t.purposeLabel ? '📌 ' + esc(t.purposeLabel) : t.purpose)) + '</div>' +
          '<div>Miles: ' + (t.miles || 0).toFixed(1) + ' (' + (t.milesSource || 'unknown') + ')</div>' +
          '<div>IRS Rate: ' + (t.irsRateCentsPerMile || 0) + '¢/mi (' + (t.irsRateYear || '') + ')</div>' +
          '<div>Deductible: $' + (t.deductibleValue || 0).toFixed(2) + '</div>' +
          (t.notes ? '<div>Notes: ' + esc(t.notes) + '</div>' : '') +
          '<div>Time: ' + formatTripTime(t.startTime) + ' → ' + formatTripTime(t.endTime) + '</div>' +
        '</div>' +
      '</div>';
    });

    container.innerHTML = html;
  }

  function toggleTripDetail(tripId) {
    var el = document.getElementById('tripDetail_' + tripId);
    if (el) {
      el.style.display = el.style.display === 'none' ? '' : 'none';
      emitTestingEvent('trip_history_viewed', { tripId: tripId });
    }
  }

  function formatTripTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function loadAllDriversTrips() {
    var checkbox = document.getElementById('tripsAllDrivers');
    if (!checkbox || !isAdmin()) return;

    if (checkbox.checked) {
      // Load all drivers
      MastDB.trips.allDrivers().then(function(snap) {
        var val = snap.val() || {};
        tripsData = [];
        Object.keys(val).forEach(function(uid) {
          var userTrips = val[uid];
          Object.keys(userTrips).forEach(function(k) {
            var t = userTrips[k];
            t.id = k;
            t.driverId = uid;
            tripsData.push(t);
          });
        });
        tripsData.sort(function(a, b) { return (b.startTime || '').localeCompare(a.startTime || ''); });
        renderTripsList();
      });
    } else {
      tripsLoaded = false;
      loadTrips();
    }
  }

  // ============================================================
  // Tax Report
  // ============================================================

  function renderTaxReport() {
    var container = document.getElementById('taxReportContent');
    if (!container) return;

    var currentYear = new Date().getFullYear();
    var completed = tripsData.filter(function(t) {
      return t.status === 'completed' && new Date(t.startTime).getFullYear() === currentYear;
    });

    var totalMiles = 0, totalDeductible = 0;
    completed.forEach(function(t) { totalMiles += (t.miles || 0); totalDeductible += (t.deductibleValue || 0); });
    var rate = tripSettingsData.irsRates ? (tripSettingsData.irsRates[currentYear] || 70) : 70;

    var html = '<div style="margin-bottom:20px;">' +
      '<div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;flex-wrap:wrap;">' +
        '<select id="taxReportYear" onchange="renderTaxReport()" style="padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.9rem;">';
    for (var y = currentYear; y >= currentYear - 3; y--) {
      html += '<option value="' + y + '"' + (y === currentYear ? ' selected' : '') + '>' + y + '</option>';
    }
    html += '</select>' +
        '<button class="btn btn-secondary" style="font-size:0.82rem;" onclick="exportTripsCSV()">📄 Export CSV</button>' +
        '<button class="btn btn-secondary" style="font-size:0.82rem;" onclick="printTaxReport()">🖨️ Print Report</button>' +
      '</div>' +
    '</div>';

    // Summary cards
    html += '<div style="display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap;">' +
      '<div class="trip-stat-card" style="background:var(--cream,#FAF6F0);border-radius:8px;padding:16px 20px;flex:1;min-width:140px;">' +
        '<div class="trip-stat-label" style="font-size:0.78rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.5px;">Total Trips</div>' +
        '<div class="trip-stat-value" style="font-size:1.8rem;font-weight:700;margin-top:4px;">' + completed.length + '</div>' +
      '</div>' +
      '<div class="trip-stat-card" style="background:var(--cream,#FAF6F0);border-radius:8px;padding:16px 20px;flex:1;min-width:140px;">' +
        '<div class="trip-stat-label" style="font-size:0.78rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.5px;">Total Miles</div>' +
        '<div class="trip-stat-value" style="font-size:1.8rem;font-weight:700;margin-top:4px;">' + totalMiles.toFixed(1) + '</div>' +
      '</div>' +
      '<div class="trip-stat-card" style="background:var(--cream,#FAF6F0);border-radius:8px;padding:16px 20px;flex:1;min-width:140px;">' +
        '<div class="trip-stat-label" style="font-size:0.78rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.5px;">IRS Rate</div>' +
        '<div class="trip-stat-value" style="font-size:1.8rem;font-weight:700;margin-top:4px;">' + rate + '¢</div>' +
      '</div>' +
      '<div class="trip-stat-card trip-stat-highlight" style="background:#ecfdf5;border-radius:8px;padding:16px 20px;flex:1;min-width:140px;">' +
        '<div class="trip-stat-label" style="font-size:0.78rem;color:#059669;text-transform:uppercase;letter-spacing:0.5px;">Total Deductible</div>' +
        '<div class="trip-stat-value" style="font-size:1.8rem;font-weight:700;margin-top:4px;color:#059669;">$' + totalDeductible.toFixed(2) + '</div>' +
      '</div>' +
    '</div>';

    // Trip table
    if (completed.length > 0) {
      html += '<div style="overflow-x:auto;"><table class="trip-table" style="width:100%;border-collapse:collapse;font-size:0.85rem;">' +
        '<thead><tr style="border-bottom:2px solid #eee;text-align:left;">' +
          '<th style="padding:8px;">Date</th>' +
          '<th style="padding:8px;">Driver</th>' +
          '<th style="padding:8px;">Route</th>' +
          '<th style="padding:8px;">Purpose</th>' +
          '<th style="padding:8px;text-align:right;">Miles</th>' +
          '<th style="padding:8px;text-align:right;">Deductible</th>' +
        '</tr></thead><tbody>';
      completed.forEach(function(t) {
        var d = new Date(t.startTime);
        var dateStr = (d.getMonth()+1) + '/' + d.getDate() + '/' + d.getFullYear();
        var origin = t.origin ? t.origin.label : '?';
        var dest = t.destination ? t.destination.label : '?';
        var purposeObj = TRIP_PURPOSES.find(function(p) { return p.key === t.purpose; });
        html += '<tr style="border-bottom:1px solid #f0f0f0;">' +
          '<td style="padding:8px;">' + dateStr + '</td>' +
          '<td style="padding:8px;">' + esc(t.driverName || 'Unknown') + '</td>' +
          '<td style="padding:8px;">' + esc(origin) + ' → ' + esc(dest) + '</td>' +
          '<td style="padding:8px;">' + (purposeObj ? purposeObj.icon + ' ' + purposeObj.label : (t.purposeLabel ? '📌 ' + esc(t.purposeLabel) : t.purpose || '')) + '</td>' +
          '<td style="padding:8px;text-align:right;">' + (t.miles || 0).toFixed(1) + '</td>' +
          '<td style="padding:8px;text-align:right;">$' + (t.deductibleValue || 0).toFixed(2) + '</td>' +
        '</tr>';
      });
      html += '</tbody></table></div>';
    }

    container.innerHTML = html;
  }

  function exportTripsCSV() {
    var yearEl = document.getElementById('taxReportYear');
    var year = yearEl ? parseInt(yearEl.value) : new Date().getFullYear();
    var completed = tripsData.filter(function(t) {
      return t.status === 'completed' && new Date(t.startTime).getFullYear() === year;
    });

    var csv = 'Date,Driver,Origin,Destination,Purpose,Miles,IRS Rate (¢/mi),Deductible ($),Notes\n';
    completed.forEach(function(t) {
      var d = new Date(t.startTime);
      var dateStr = (d.getMonth()+1) + '/' + d.getDate() + '/' + d.getFullYear();
      csv += '"' + dateStr + '","' + (t.driverName || '') + '","' + (t.origin ? t.origin.label : '') + '","' +
        (t.destination ? t.destination.label : '') + '","' + (t.purpose || '') + '",' +
        (t.miles || 0).toFixed(1) + ',' + (t.irsRateCentsPerMile || 70) + ',' +
        (t.deductibleValue || 0).toFixed(2) + ',"' + (t.notes || '').replace(/"/g, '""') + '"\n';
    });

    var blob = new Blob([csv], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'trip-mileage-report-' + year + '.csv';
    a.click();
    showToast('CSV exported');
  }

  function printTaxReport() {
    window.print();
  }

  // ============================================================
  // Settings: IRS Rates
  // ============================================================

  function renderIrsRates() {
    var container = document.getElementById('irsRatesList');
    if (!container) return;
    var rates = tripSettingsData.irsRates || {};
    var years = Object.keys(rates).sort().reverse();
    if (years.length === 0) {
      container.innerHTML = '<div style="padding:8px;color:var(--warm-gray);font-size:0.85rem;">No rates configured.</div>';
      return;
    }
    var html = '';
    years.forEach(function(y) {
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--cream,#FAF6F0);border-radius:6px;margin-bottom:6px;">' +
        '<span style="font-weight:600;">' + y + '</span>' +
        '<span>' + rates[y] + '¢/mile</span>' +
        '<button class="btn btn-secondary" style="font-size:0.75rem;padding:4px 10px;color:#E53935;" onclick="removeIrsRate(\'' + y + '\')">Remove</button>' +
      '</div>';
    });
    container.innerHTML = html;
  }

  function addIrsRate() {
    var yearEl = document.getElementById('newIrsYear');
    var rateEl = document.getElementById('newIrsRate');
    var year = yearEl ? yearEl.value.trim() : '';
    var rate = rateEl ? parseFloat(rateEl.value) : 0;
    if (!year || rate <= 0) { showToast('Enter year and rate', true); return; }

    MastDB.tripSettings.subRef('irsRates', year).set(rate).then(function() {
      tripSettingsData.irsRates[year] = rate;
      yearEl.value = '';
      rateEl.value = '';
      renderIrsRates();
      showToast('IRS rate saved: ' + year + ' = ' + rate + '¢/mile');
      writeAudit('update', 'settings', 'irsRate-' + year);
    });
  }

  function removeIrsRate(year) {
    if (!confirm('Remove IRS rate for ' + year + '?')) return;
    MastDB.tripSettings.subRef('irsRates', year).remove().then(function() {
      delete tripSettingsData.irsRates[year];
      renderIrsRates();
      showToast('Rate removed');
    });
  }

  // ============================================================
  // Settings: Trip Locations
  // ============================================================

  function renderTripLocations() {
    var container = document.getElementById('tripLocationsList');
    if (!container) return;
    var keys = Object.keys(tripLocationsData);
    keys.sort(function(a, b) { return (tripLocationsData[b].useCount || 0) - (tripLocationsData[a].useCount || 0); });
    if (keys.length === 0) {
      container.innerHTML = '<div style="padding:8px;color:var(--warm-gray);font-size:0.85rem;">No saved locations yet. Locations are auto-added when you start trips.</div>';
      return;
    }
    var html = '';
    keys.forEach(function(k) {
      var loc = tripLocationsData[k];
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--cream,#FAF6F0);border-radius:6px;margin-bottom:6px;">' +
        '<div>' +
          '<div style="font-weight:600;font-size:0.9rem;">' + esc(loc.label || k) + '</div>' +
          '<div style="font-size:0.78rem;color:var(--warm-gray);">Used ' + (loc.useCount || 0) + ' times</div>' +
        '</div>' +
        '<button class="btn btn-secondary" style="font-size:0.75rem;padding:4px 10px;color:#E53935;" onclick="removeTripLocation(\'' + k + '\')">Remove</button>' +
      '</div>';
    });
    container.innerHTML = html;
  }

  function addTripLocationManual() {
    var nameEl = document.getElementById('newTripLocationName');
    var name = nameEl ? nameEl.value.trim() : '';
    if (!name) { showToast('Enter a location name', true); return; }
    var slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    MastDB.tripLocations.ref(slug).set({
      label: name, lat: 0, lng: 0, useCount: 0, lastUsed: new Date().toISOString()
    }).then(function() {
      tripLocationsData[slug] = { label: name, lat: 0, lng: 0, useCount: 0 };
      nameEl.value = '';
      renderTripLocations();
      showToast('Location added: ' + name);
    });
  }

  function removeTripLocation(key) {
    if (!confirm('Remove this location?')) return;
    MastDB.tripLocations.ref(key).remove().then(function() {
      delete tripLocationsData[key];
      renderTripLocations();
      showToast('Location removed');
    });
  }

  // ============================================================
  // Init: Load on auth
  // ============================================================

  function initTripsModule() {
    loadTripLocations();
    loadTripSettings();
    checkForActiveTrip();
    // Notification permission is now requested when starting a trip, not on every login.
    // Forgotten trip GPS check only runs if permission was already granted (no popup).
    setTimeout(checkForgottenTrip, 3000);
  }

  // ============================================================
  // Settings lazy load for trips sub-view
  // ============================================================

  function loadTripsSettings() {
    loadTripLocations();
    loadTripSettings();
    // Wait briefly for data, then render
    setTimeout(function() {
      renderIrsRates();
      renderTripLocations();
    }, 500);
  }

  // ============================================================
  // Nudge Provider: Unrecorded Event Mileage
  // ============================================================

  registerNudgeProvider(async function mileageNudgeProvider() {
    var user = auth.currentUser;
    if (!user) return [];

    // Ensure shows data is loaded
    if (!showsLoaded) {
      try {
        var snap = await MastDB.shows.list(200);
        showsData = snap.val() || {};
        showsLoaded = true;
      } catch (e) { return []; }
    }

    // Load user's trips
    var tripsSnap;
    try {
      tripsSnap = await MastDB.trips.ref(user.uid).limitToLast(500).once('value');
    } catch (e) { return []; }
    var allTrips = tripsSnap.val() || {};

    // Build set of dates that have trip records (YYYY-MM-DD)
    var tripDates = {};
    Object.values(allTrips).forEach(function(t) {
      if (t.startTime) {
        var d = new Date(t.startTime);
        tripDates[d.toISOString().slice(0, 10)] = true;
      }
      // Also check retroactive trips by their tripDate field
      if (t.tripDate) {
        tripDates[t.tripDate] = true;
      }
    });

    var now = new Date();
    var nudges = [];

    Object.keys(showsData).forEach(function(showId) {
      var s = showsData[showId];
      if (!s.startDate) return;
      var showDate = new Date(s.startDate + 'T12:00:00');
      // Only past shows
      if (showDate >= now) return;
      // Only shows with location info
      if (!s.locationCity && !s.locationState) return;
      // Check if any trip recorded for this show date
      var dateKey = s.startDate; // Already YYYY-MM-DD
      if (tripDates[dateKey]) return;
      // Multi-day: also check end date
      if (s.endDate && tripDates[s.endDate]) return;

      var location = [s.locationCity, s.locationState].filter(Boolean).join(', ');
      var dateStr = formatShowDate(s.startDate);
      nudges.push({
        key: 'mileage-show-' + showId,
        type: 'mileage',
        timestamp: s.startDate,
        showId: showId,
        html: 'You attended <strong>' + esc(s.name || 'a show') + '</strong> on ' + dateStr +
          (location ? ' in ' + esc(location) : '') + ' — mileage not recorded. ' +
          '<a href="#" onclick="startRetroactiveFromShow(\'' + esc(showId) + '\');return false;" ' +
          'style="color:#d97706;font-weight:600;">Record Now</a>'
      });
    });

    // Sort by most recent first
    nudges.sort(function(a, b) { return b.timestamp.localeCompare(a.timestamp); });
    return nudges;
  });

  // ============================================================
  // Retroactive Trip Entry
  // Flow A: Event-based (from show), Flow B: Manual destination
  // Both support multi-leg recording loop
  // ============================================================

  function startRetroactiveFromShow(showId) {
    var s = showsData[showId];
    if (!s) { showToast('Show not found', true); return; }

    var location = [s.locationCity, s.locationState].filter(Boolean).join(', ');
    retroModalData = {
      showId: showId,
      showName: s.name,
      showDate: s.startDate,
      showLocation: location,
      entryMethod: 'event-retroactive',
      legs: [],
      currentLegOrigin: null,
      eventSessionId: null
    };

    openRetroactiveTripModal();
  }

  function startRetroactiveManual() {
    retroModalData = {
      showId: null,
      showName: null,
      showDate: null,
      showLocation: null,
      entryMethod: 'manual-retroactive',
      legs: [],
      currentLegOrigin: null,
      eventSessionId: null
    };
    openRetroactiveTripModal();
  }

  function openRetroactiveTripModal() {
    // Remove existing modal if any
    var existing = document.getElementById('retroTripModal');
    if (existing) existing.remove();

    var isDark = document.body.classList.contains('dark-mode');
    var bg = isDark ? '#1e1e1e' : 'white';
    var cardBg = isDark ? '#2a2a2a' : '#f9f9f9';
    var border = isDark ? '#444' : '#ddd';
    var textColor = isDark ? '#e0e0e0' : '#1A1A1A';
    var inputBg = isDark ? '#1a1a1a' : '#fff';

    var isEventBased = !!retroModalData.showId;
    var title = isEventBased ? 'Record Mileage — ' + esc(retroModalData.showName) : 'Add Past Trip';
    var dateHint = isEventBased && retroModalData.showDate ? ' on ' + formatShowDate(retroModalData.showDate) : '';

    var overlay = document.createElement('div');
    overlay.id = 'retroTripModal';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10001;' +
      'display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto;';
    overlay.innerHTML =
      '<div style="background:' + bg + ';border-radius:12px;padding:24px;width:100%;max-width:420px;' +
        'box-shadow:0 8px 32px rgba(0,0,0,0.3);margin-top:40px;color:' + textColor + ';">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
          '<div style="font-weight:700;font-size:1.05rem;">' + title + '</div>' +
          '<button onclick="closeRetroTripModal()" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:' + textColor + ';">✕</button>' +
        '</div>' +
        (dateHint ? '<div style="font-size:0.8rem;color:var(--warm-gray);margin-bottom:16px;">' + dateHint + '</div>' : '<div style="margin-bottom:16px;"></div>') +

        // Logged legs summary
        '<div id="retroLegsSummary" style="display:none;margin-bottom:16px;"></div>' +

        // Current leg form
        '<div id="retroLegForm">' +
          // Trip date (manual only, event-based pre-fills)
          (!isEventBased ? '<div style="margin-bottom:12px;">' +
            '<label style="font-size:0.8rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Trip Date</label>' +
            '<input type="date" id="retroTripDate" style="width:100%;padding:8px 10px;border:1px solid ' + border + ';border-radius:8px;font-size:0.9rem;' +
              'background:' + inputBg + ';color:' + textColor + ';box-sizing:border-box;font-family:DM Sans,sans-serif;" value="' + new Date().toISOString().slice(0, 10) + '">' +
          '</div>' : '') +

          // Start location
          '<div style="margin-bottom:12px;">' +
            '<label style="font-size:0.8rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Start Location</label>' +
            '<select id="retroOrigin" style="width:100%;padding:8px 10px;border:1px solid ' + border + ';border-radius:8px;font-size:0.9rem;' +
              'background:' + inputBg + ';color:' + textColor + ';box-sizing:border-box;font-family:DM Sans,sans-serif;">' +
              buildRetroOriginOptions() +
            '</select>' +
          '</div>' +

          // End location
          '<div style="margin-bottom:12px;">' +
            '<label style="font-size:0.8rem;color:var(--warm-gray);display:block;margin-bottom:4px;">End Location</label>' +
            (isEventBased && retroModalData.legs.length === 0
              ? '<input type="text" id="retroDestination" value="' + esc(retroModalData.showLocation || '') + '" style="width:100%;padding:8px 10px;border:1px solid ' + border + ';border-radius:8px;font-size:0.9rem;' +
                'background:' + inputBg + ';color:' + textColor + ';box-sizing:border-box;font-family:DM Sans,sans-serif;" list="retroDestList">'
              : '<input type="text" id="retroDestination" placeholder="Enter destination" style="width:100%;padding:8px 10px;border:1px solid ' + border + ';border-radius:8px;font-size:0.9rem;' +
                'background:' + inputBg + ';color:' + textColor + ';box-sizing:border-box;font-family:DM Sans,sans-serif;" list="retroDestList">') +
            '<datalist id="retroDestList">' + buildRetroDestDatalist() + '</datalist>' +
          '</div>' +

          // Purpose
          '<div style="margin-bottom:12px;">' +
            '<label style="font-size:0.8rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Purpose</label>' +
            '<input type="text" id="retroPurpose" value="' + esc(isEventBased && retroModalData.legs.length === 0 ? retroModalData.showName || '' : '') + '" ' +
              'placeholder="e.g. Show, Supplies, Delivery" style="width:100%;padding:8px 10px;border:1px solid ' + border + ';border-radius:8px;font-size:0.9rem;' +
              'background:' + inputBg + ';color:' + textColor + ';box-sizing:border-box;font-family:DM Sans,sans-serif;">' +
          '</div>' +

          // Round trip toggle
          '<div style="margin-bottom:16px;display:flex;align-items:center;gap:10px;">' +
            '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.85rem;">' +
              '<input type="checkbox" id="retroRoundTrip" checked style="width:16px;height:16px;cursor:pointer;">' +
              ' Round trip' +
            '</label>' +
          '</div>' +

          // Calculated miles display
          '<div id="retroMilesDisplay" style="display:none;margin-bottom:12px;padding:10px 12px;background:' + cardBg + ';border-radius:8px;font-size:0.85rem;">' +
            '<span id="retroMilesValue"></span> <span id="retroMilesSource" style="color:var(--warm-gray);font-size:0.78rem;"></span>' +
          '</div>' +

          // Actions
          '<div style="display:flex;gap:10px;">' +
            '<button onclick="closeRetroTripModal()" style="flex:1;padding:10px;border:1px solid ' + border + ';border-radius:8px;background:transparent;color:' + textColor + ';cursor:pointer;font-family:DM Sans,sans-serif;font-size:0.85rem;">Cancel</button>' +
            '<button id="retroSaveLegBtn" onclick="saveRetroactiveLeg()" style="flex:1;padding:10px;border:none;border-radius:8px;background:var(--amber-glow,#C4853C);color:white;cursor:pointer;font-weight:600;font-family:DM Sans,sans-serif;font-size:0.85rem;">Calculate & Save Leg</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    // If we have legs already, update the origin to last destination
    if (retroModalData.legs.length > 0) {
      var lastLeg = retroModalData.legs[retroModalData.legs.length - 1];
      var originSelect = document.getElementById('retroOrigin');
      if (originSelect) {
        var lastDest = lastLeg.destination.label;
        var found = false;
        for (var i = 0; i < originSelect.options.length; i++) {
          if (originSelect.options[i].text === lastDest) { originSelect.selectedIndex = i; found = true; break; }
        }
        if (!found) {
          var opt = document.createElement('option');
          opt.value = 'custom_' + lastDest;
          opt.text = lastDest;
          opt.selected = true;
          originSelect.appendChild(opt);
        }
      }
      renderRetroLegsSummary();
    }
  }

  function closeRetroTripModal() {
    var modal = document.getElementById('retroTripModal');
    if (modal) modal.remove();
    retroModalData = null;
  }

  function buildRetroOriginOptions() {
    var html = '';
    // Studio locations
    if (typeof studioLocations !== 'undefined') {
      Object.keys(studioLocations).forEach(function(k) {
        var sl = studioLocations[k];
        html += '<option value="studio_' + k + '">' + esc(sl.name) + '</option>';
      });
    }
    // Trip locations (sorted by use count)
    var keys = Object.keys(tripLocationsData);
    keys.sort(function(a, b) { return (tripLocationsData[b].useCount || 0) - (tripLocationsData[a].useCount || 0); });
    keys.forEach(function(k) {
      var loc = tripLocationsData[k];
      html += '<option value="trip_' + k + '">' + esc(loc.label || k) + '</option>';
    });
    return html;
  }

  function buildRetroDestDatalist() {
    var html = '';
    var keys = Object.keys(tripLocationsData);
    keys.sort(function(a, b) { return (tripLocationsData[b].useCount || 0) - (tripLocationsData[a].useCount || 0); });
    keys.forEach(function(k) {
      html += '<option value="' + esc(tripLocationsData[k].label || k) + '">';
    });
    return html;
  }

  function renderRetroLegsSummary() {
    var container = document.getElementById('retroLegsSummary');
    if (!container || !retroModalData || retroModalData.legs.length === 0) {
      if (container) container.style.display = 'none';
      return;
    }
    container.style.display = '';
    var isDark = document.body.classList.contains('dark-mode');
    var html = '<div style="font-size:0.8rem;font-weight:600;margin-bottom:6px;color:var(--warm-gray);">Legs recorded:</div>';
    retroModalData.legs.forEach(function(leg) {
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;' +
        'background:' + (isDark ? '#1a2e1a' : '#f0fdf4') + ';border-radius:6px;margin-bottom:4px;font-size:0.82rem;">' +
        '<span>' + esc(leg.origin.label) + ' → ' + esc(leg.destination.label) +
          (leg.roundTrip ? ' (round trip)' : '') + '</span>' +
        '<span style="font-weight:600;">' + leg.miles.toFixed(1) + ' mi</span>' +
      '</div>';
    });
    container.innerHTML = html;
  }

  async function saveRetroactiveLeg() {
    var user = auth.currentUser;
    if (!user) { showToast('Not signed in', true); return; }
    if (!retroModalData) return;

    var btn = document.getElementById('retroSaveLegBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Calculating...'; }

    // Get form values
    var originKey = document.getElementById('retroOrigin').value;
    var destValue = document.getElementById('retroDestination').value.trim();
    var purpose = document.getElementById('retroPurpose').value.trim();
    var roundTrip = document.getElementById('retroRoundTrip').checked;
    var tripDate = retroModalData.showDate || (document.getElementById('retroTripDate') ? document.getElementById('retroTripDate').value : new Date().toISOString().slice(0, 10));

    if (!destValue) { showToast('Enter a destination', true); if (btn) { btn.disabled = false; btn.textContent = 'Calculate & Save Leg'; } return; }

    // Resolve origin and destination
    var origin = resolveRetroOrigin(originKey);
    var destination = resolveRetroDestination(destValue);

    // Calculate distance
    var mileageResult = await calculateRetroactiveMileage(origin, destination);
    var onewayMiles = mileageResult.miles;
    var totalMiles = roundTrip ? onewayMiles * 2 : onewayMiles;
    var milesSource = mileageResult.source;

    // Get IRS rate
    var tripYear = new Date(tripDate + 'T12:00:00').getFullYear();
    var rate = tripSettingsData.irsRates ? (tripSettingsData.irsRates[tripYear] || tripSettingsData.irsRates[tripYear - 1] || 70) : 70;
    var deductible = Math.round(totalMiles * (rate / 100) * 100) / 100;

    // Generate session ID for grouping legs
    if (!retroModalData.eventSessionId) {
      retroModalData.eventSessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
    }

    // Create trip record
    var tripRef = MastDB.trips.push(user.uid);
    var tripData = {
      tripId: tripRef.key,
      driverId: user.uid,
      driverName: user.displayName || user.email || 'Unknown',
      status: 'completed',
      startTime: tripDate + 'T09:00:00.000Z',
      endTime: tripDate + 'T10:00:00.000Z',
      tripDate: tripDate,
      origin: origin,
      destination: destination,
      miles: totalMiles,
      milesSource: milesSource,
      purpose: purpose || null,
      purposeLabel: purpose || null,
      notes: roundTrip ? 'Round trip' : '',
      irsRateYear: tripYear,
      irsRateCentsPerMile: rate,
      deductibleValue: deductible,
      expenses: [],
      entryMethod: retroModalData.entryMethod,
      eventSessionId: retroModalData.eventSessionId,
      roundTrip: roundTrip
    };

    try {
      await tripRef.set(tripData);

      // Add destination to tripLocations if new
      var destSlug = destValue.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      if (!tripLocationsData[destSlug]) {
        await MastDB.tripLocations.ref(destSlug).set({
          label: destValue, lat: destination.lat || 0, lng: destination.lng || 0, useCount: 0, lastUsed: new Date().toISOString()
        });
        tripLocationsData[destSlug] = { label: destValue, lat: 0, lng: 0, useCount: 0 };
      }
      incrementLocationUseCount(origin);
      incrementLocationUseCount(destination);

      // Track this leg
      retroModalData.legs.push({
        tripId: tripRef.key,
        origin: origin,
        destination: destination,
        miles: totalMiles,
        roundTrip: roundTrip,
        purpose: purpose
      });

      writeAudit('create', 'trips', tripRef.key);
      showToast('Leg recorded — ' + totalMiles.toFixed(1) + ' mi · $' + deductible.toFixed(2));

      // Ask about more legs
      askForMoreLegs();
    } catch (err) {
      showToast('Error saving trip: ' + err.message, true);
      if (btn) { btn.disabled = false; btn.textContent = 'Calculate & Save Leg'; }
    }
  }

  function askForMoreLegs() {
    var formEl = document.getElementById('retroLegForm');
    if (!formEl) return;

    var isDark = document.body.classList.contains('dark-mode');
    var border = isDark ? '#444' : '#ddd';
    var textColor = isDark ? '#e0e0e0' : '#1A1A1A';

    renderRetroLegsSummary();

    formEl.innerHTML =
      '<div style="text-align:center;padding:20px 0;">' +
        '<div style="font-size:1.1rem;margin-bottom:16px;">Any other destinations on this trip?</div>' +
        '<div style="display:flex;gap:10px;justify-content:center;">' +
          '<button onclick="addAnotherLeg()" style="padding:10px 24px;border:none;border-radius:8px;background:var(--amber-glow,#C4853C);color:white;cursor:pointer;font-weight:600;font-family:DM Sans,sans-serif;font-size:0.9rem;">Yes, add another</button>' +
          '<button onclick="finishRetroactiveTrip()" style="padding:10px 24px;border:1px solid ' + border + ';border-radius:8px;background:transparent;color:' + textColor + ';cursor:pointer;font-family:DM Sans,sans-serif;font-size:0.9rem;">No, I\'m done</button>' +
        '</div>' +
      '</div>';
  }

  function addAnotherLeg() {
    openRetroactiveTripModal();
  }

  function finishRetroactiveTrip() {
    var totalMiles = 0;
    if (retroModalData) {
      retroModalData.legs.forEach(function(leg) {
        totalMiles += leg.miles;
      });
      var legCount = retroModalData.legs.length;
      closeRetroTripModal();
      showToast('Trip complete — ' + legCount + ' leg(s), ' + totalMiles.toFixed(1) + ' total miles');
    } else {
      closeRetroTripModal();
    }

    // Refresh trips list and dashboard
    tripsLoaded = false;
    if (currentRoute === 'trips') loadTrips();
    if (currentRoute === 'dashboard') renderDashboardTodos();
  }

  function resolveRetroOrigin(key) {
    if (key && key.startsWith('studio_')) {
      var studioKey = key.replace('studio_', '');
      if (typeof studioLocations !== 'undefined') {
        var sl = studioLocations[studioKey];
        if (sl) return { label: sl.name, lat: sl.lat, lng: sl.lng, geocoded: true };
      }
    }
    if (key && key.startsWith('trip_')) {
      var tripKey = key.replace('trip_', '');
      var loc = tripLocationsData[tripKey];
      if (loc) return { label: loc.label || tripKey, lat: loc.lat || 0, lng: loc.lng || 0, geocoded: !!loc.lat };
    }
    if (key && key.startsWith('custom_')) {
      return { label: key.replace('custom_', ''), lat: 0, lng: 0, geocoded: false };
    }
    return { label: 'Unknown', lat: 0, lng: 0, geocoded: false };
  }

  function resolveRetroDestination(destValue) {
    var matchKey = Object.keys(tripLocationsData).find(function(k) {
      return (tripLocationsData[k].label || '').toLowerCase() === destValue.toLowerCase();
    });
    if (matchKey) {
      var dl = tripLocationsData[matchKey];
      return { label: dl.label, lat: dl.lat || 0, lng: dl.lng || 0, geocoded: !!dl.lat };
    }
    return { label: destValue, lat: 0, lng: 0, geocoded: false };
  }

  function calculateRetroactiveMileage(origin, destination) {
    return new Promise(function(resolve) {
      var originStr = origin.lat && origin.lng && origin.geocoded ? origin.lat + ',' + origin.lng : origin.label;
      var destStr = destination.lat && destination.lng && destination.geocoded ? destination.lat + ',' + destination.lng : destination.label;

      if (!originStr || !destStr) {
        resolve({ miles: 0, source: 'manual-override' });
        return;
      }

      var display = document.getElementById('retroMilesDisplay');
      var valueEl = document.getElementById('retroMilesValue');
      var sourceEl = document.getElementById('retroMilesSource');
      if (display) display.style.display = '';
      if (valueEl) valueEl.textContent = 'Calculating...';
      if (sourceEl) sourceEl.textContent = '';

      var timeout = setTimeout(function() {
        if (origin.lat && origin.lng && destination.lat && destination.lng) {
          var hv = haversineMeters(origin.lat, origin.lng, destination.lat, destination.lng);
          var hvMiles = Math.round((hv / 1609.344) * 10) / 10;
          if (valueEl) valueEl.textContent = hvMiles.toFixed(1) + ' miles (one way)';
          if (sourceEl) sourceEl.textContent = 'Estimated (straight-line)';
          resolve({ miles: hvMiles, source: 'haversine-fallback' });
        } else {
          if (valueEl) valueEl.textContent = 'Enter miles manually';
          resolve({ miles: 0, source: 'manual-override' });
        }
      }, 5000);

      try {
        if (window.google && window.google.maps) {
          var service = new google.maps.DistanceMatrixService();
          service.getDistanceMatrix({
            origins: [originStr],
            destinations: [destStr],
            travelMode: 'DRIVING',
            unitSystem: google.maps.UnitSystem.IMPERIAL
          }, function(response, status) {
            clearTimeout(timeout);
            if (status === 'OK' && response.rows[0] && response.rows[0].elements[0].status === 'OK') {
              var meters = response.rows[0].elements[0].distance.value;
              var miles = Math.round((meters / 1609.344) * 10) / 10;
              if (valueEl) valueEl.textContent = miles.toFixed(1) + ' miles (one way)';
              if (sourceEl) sourceEl.textContent = 'via Google Maps';
              resolve({ miles: miles, source: 'maps-api' });
            } else {
              if (origin.lat && origin.lng && destination.lat && destination.lng) {
                var hv = haversineMeters(origin.lat, origin.lng, destination.lat, destination.lng);
                var hvMiles = Math.round((hv / 1609.344) * 10) / 10;
                if (valueEl) valueEl.textContent = hvMiles.toFixed(1) + ' miles (one way)';
                if (sourceEl) sourceEl.textContent = 'Estimated (straight-line)';
                resolve({ miles: hvMiles, source: 'haversine-fallback' });
              } else {
                if (valueEl) valueEl.textContent = 'Maps unavailable';
                resolve({ miles: 0, source: 'manual-override' });
              }
            }
          });
        } else {
          clearTimeout(timeout);
          if (origin.lat && origin.lng && destination.lat && destination.lng) {
            var hv = haversineMeters(origin.lat, origin.lng, destination.lat, destination.lng);
            var hvMiles = Math.round((hv / 1609.344) * 10) / 10;
            if (valueEl) valueEl.textContent = hvMiles.toFixed(1) + ' miles (one way)';
            if (sourceEl) sourceEl.textContent = 'Estimated (straight-line)';
            resolve({ miles: hvMiles, source: 'haversine-fallback' });
          } else {
            if (valueEl) valueEl.textContent = 'Enter miles manually';
            resolve({ miles: 0, source: 'manual-override' });
          }
        }
      } catch (e) {
        clearTimeout(timeout);
        resolve({ miles: 0, source: 'manual-override' });
      }
    });
  }

  // ============================================================
  // Previous Trips (unrecorded shows list)
  // ============================================================

  function openPreviousTripsModal() {
    var user = auth.currentUser;
    if (!user) { showToast('Not signed in', true); return; }

    var isDark = document.body.classList.contains('dark-mode');
    var bg = isDark ? '#1e1e1e' : 'white';
    var border = isDark ? '#444' : '#ddd';
    var textColor = isDark ? '#e0e0e0' : '#1A1A1A';

    var existing = document.getElementById('prevTripsModal');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'prevTripsModal';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10001;' +
      'display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto;';
    overlay.innerHTML =
      '<div style="background:' + bg + ';border-radius:12px;padding:24px;width:100%;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,0.3);margin-top:40px;color:' + textColor + ';">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
          '<div style="font-weight:700;font-size:1.05rem;">Previous Trips</div>' +
          '<button onclick="closePrevTripsModal()" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:' + textColor + ';">✕</button>' +
        '</div>' +
        '<div style="font-size:0.82rem;color:var(--warm-gray);margin-bottom:12px;">Past shows with no mileage recorded:</div>' +
        '<div id="prevTripsListContent" style="color:' + textColor + ';">Loading...</div>' +
        '<div style="margin-top:16px;padding-top:12px;border-top:1px solid ' + border + ';">' +
          '<button onclick="closePrevTripsModal(); startRetroactiveManual();" style="width:100%;padding:10px;border:1px solid ' + border + ';border-radius:8px;background:transparent;color:' + textColor + ';cursor:pointer;font-family:DM Sans,sans-serif;font-size:0.85rem;">+ Add Past Trip Manually</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    loadPreviousTrips();
  }

  function closePrevTripsModal() {
    var modal = document.getElementById('prevTripsModal');
    if (modal) modal.remove();
  }

  async function loadPreviousTrips() {
    var container = document.getElementById('prevTripsListContent');
    if (!container) return;
    var user = auth.currentUser;
    if (!user) return;

    // Ensure shows loaded
    if (!showsLoaded) {
      try {
        var snap = await MastDB.shows.list(200);
        showsData = snap.val() || {};
        showsLoaded = true;
      } catch (e) {
        container.innerHTML = '<div style="color:var(--warm-gray);">Could not load shows.</div>';
        return;
      }
    }

    // Load trips
    var tripsSnap;
    try {
      tripsSnap = await MastDB.trips.ref(user.uid).limitToLast(500).once('value');
    } catch (e) {
      container.innerHTML = '<div style="color:var(--warm-gray);">Could not load trips.</div>';
      return;
    }
    var allTrips = tripsSnap.val() || {};
    var tripDates = {};
    Object.values(allTrips).forEach(function(t) {
      if (t.startTime) tripDates[new Date(t.startTime).toISOString().slice(0, 10)] = true;
      if (t.tripDate) tripDates[t.tripDate] = true;
    });

    var now = new Date();
    var isDark = document.body.classList.contains('dark-mode');
    var items = [];

    Object.keys(showsData).forEach(function(showId) {
      var s = showsData[showId];
      if (!s.startDate) return;
      var showDate = new Date(s.startDate + 'T12:00:00');
      if (showDate >= now) return;
      if (!s.locationCity && !s.locationState) return;
      if (tripDates[s.startDate]) return;
      if (s.endDate && tripDates[s.endDate]) return;
      items.push({ showId: showId, show: s });
    });

    items.sort(function(a, b) { return (b.show.startDate || '').localeCompare(a.show.startDate || ''); });

    if (items.length === 0) {
      container.innerHTML = '<div style="padding:12px 0;text-align:center;color:var(--warm-gray);font-size:0.85rem;">All past shows have mileage recorded!</div>';
      return;
    }

    var html = '';
    items.forEach(function(item) {
      var s = item.show;
      var location = [s.locationCity, s.locationState].filter(Boolean).join(', ');
      html += '<div onclick="closePrevTripsModal(); startRetroactiveFromShow(\'' + esc(item.showId) + '\');" style="' +
        'padding:12px;border-radius:8px;margin-bottom:8px;cursor:pointer;' +
        'background:' + (isDark ? '#2a2a2a' : '#f9f9f9') + ';border:1px solid ' + (isDark ? '#444' : '#eee') + ';">' +
        '<div style="font-weight:600;font-size:0.9rem;">' + esc(s.name || 'Unnamed show') + '</div>' +
        '<div style="font-size:0.8rem;color:var(--warm-gray);margin-top:2px;">' +
          formatShowDate(s.startDate) + (location ? ' · ' + esc(location) : '') +
        '</div>' +
      '</div>';
    });
    container.innerHTML = html;
  }

  // ============================================================
  // Window exports for onclick handlers
  // ============================================================

  window.openStartTripModal = openStartTripModal;
  window.closeStartTripModal = closeStartTripModal;
  window.confirmStartTrip = confirmStartTrip;
  window.openEndTripSheet = openEndTripSheet;
  window.closeEndTripSheet = closeEndTripSheet;
  window.confirmEndTrip = confirmEndTrip;
  window.discardActiveTrip = discardActiveTrip;
  window.selectTripPurpose = selectTripPurpose;
  window.cancelOtherPurpose = cancelOtherPurpose;
  window.confirmOtherPurpose = confirmOtherPurpose;
  window.switchTripsSubView = switchTripsSubView;
  window.renderTripsList = renderTripsList;
  window.toggleTripDetail = toggleTripDetail;
  window.loadAllDriversTrips = loadAllDriversTrips;
  window.renderTaxReport = renderTaxReport;
  window.exportTripsCSV = exportTripsCSV;
  window.printTaxReport = printTaxReport;
  window.renderIrsRates = renderIrsRates;
  window.addIrsRate = addIrsRate;
  window.removeIrsRate = removeIrsRate;
  window.renderTripLocations = renderTripLocations;
  window.addTripLocationManual = addTripLocationManual;
  window.removeTripLocation = removeTripLocation;
  window.openPreviousTripsModal = openPreviousTripsModal;
  window.closePrevTripsModal = closePrevTripsModal;
  window.startRetroactiveFromShow = startRetroactiveFromShow;
  window.startRetroactiveManual = startRetroactiveManual;
  window.closeRetroTripModal = closeRetroTripModal;
  window.saveRetroactiveLeg = saveRetroactiveLeg;
  window.addAnotherLeg = addAnotherLeg;
  window.finishRetroactiveTrip = finishRetroactiveTrip;
  window.loadTripsSettings = loadTripsSettings;

  // Expose for core to call on auth (dashboard active trip banner)
  window.checkForActiveTrip = checkForActiveTrip;
  window.renderActiveTripBanner = renderActiveTripBanner;
  window.initTripsModule = initTripsModule;

  // ============================================================
  // Register with MastAdmin
  // ============================================================

  MastAdmin.registerModule('trips', {
    routes: {
      'trips': {
        tab: 'tripsTab',
        setup: function() {
          if (!tripsLoaded) loadTrips();
          switchTripsSubView('history');
          checkForActiveTrip();
        }
      }
    }
  });

})();
