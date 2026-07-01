// app/modules/testing-mode.js  (T1 extraction)
//
// Testing Mode — data-driven missions with event-based auto-detection: the
// event system (emitTestingEvent), open/close + progress load (toggleTestingMode /
// loadTestingProgress), mission accomplishment + expand/collapse state, mission
// card rendering (renderMissionCard / MISSION_CATEGORIES / renderTestingMode), the
// pre/post-prompt + task-completion handlers, the studio-assistant panel, and
// reset. Extracted byte-identical from the inline block in index.html (no token /
// hex / locale conversions were needed — the cluster was already clean). The
// testingMissions / testingModeState state stays declared in index.html (read by
// the Testing-Mode visibility helpers there), and escapeHtml stays inline (generic
// helper); these top-level functions remain window globals (the inline block is not
// an IIFE) so the sidebar/handle onclick handlers, the cross-app emitTestingEvent
// call sites, and other modules resolve them post-load.

// --- Event System ---
function emitTestingEvent(eventName, context) {
  if (!testingModeState.loaded) return;
  if (!testingMissions.length) return;
  context = context || {};
  testingMissions.forEach(function(mission) {
    var mp = testingModeState.missionProgress[mission.id];
    if (!mp || !mp.reflections || !mp.reflections.pre) return; // hasn't started
    if (mp.reflections.post) return; // already accomplished
    mission.tasks.forEach(function(task, idx) {
      if (!task.trigger) return; // manual task
      if (mp.progress[idx] === true) return; // already done
      if (task.trigger.event !== eventName) return;
      if (task.trigger.match) {
        var allMatch = Object.keys(task.trigger.match).every(function(key) {
          return context[key] === task.trigger.match[key];
        });
        if (!allMatch) return;
      }
      notifyTestingMode(mission.id, idx);
    });
  });
}

// --- Panel Toggle ---
function toggleTestingMode() {
  var panel = document.getElementById('testingModePanel');
  var handle = document.getElementById('testingModeHandle');
  testingModeState.open = !testingModeState.open;
  if (testingModeState.open) {
    panel.classList.add('open');
    if (handle) handle.classList.add('hidden');
    if (!testingModeState.loaded) {
      loadTestingProgress();
    } else {
      renderTestingMode();
    }
  } else {
    panel.classList.remove('open');
    if (handle) handle.classList.remove('hidden');
  }
  if (testingModeState.open && window.innerWidth <= 768) {
    hideSidebar();
  }
}

// --- Load Missions + Progress from Firebase ---
function loadTestingProgress() {
  var user = auth.currentUser;
  if (!user) return;
  Promise.all([
    MastDB.testingMissions.list(),
    MastDB.testingMode.ref(user.uid).once('value')
  ]).then(function(snaps) {
    var missionsData = snaps[0] || {};
    var progressData = snaps[1].val() || {};
    // Convert missions object to sorted array
    testingMissions = Object.keys(missionsData).map(function(key) {
      var m = missionsData[key];
      m.id = m.id || key;
      if (m.tasks && !Array.isArray(m.tasks)) {
        m.tasks = Object.keys(m.tasks).sort(function(a, b) { return Number(a) - Number(b); }).map(function(k) { return m.tasks[k]; });
      }
      return m;
    }).sort(function(a, b) { return (a.sequence || 0) - (b.sequence || 0); });
    // Load per-mission progress
    testingModeState.missionProgress = {};
    testingMissions.forEach(function(m) {
      var pd = progressData[m.id] || {};
      testingModeState.missionProgress[m.id] = {
        progress: pd.progress || {},
        reflections: pd.reflections || {}
      };
    });
    // Expand first non-accomplished mission by default
    testingModeState.expandedMissionId = null;
    for (var i = 0; i < testingMissions.length; i++) {
      if (!isMissionAccomplished(testingMissions[i].id)) {
        testingModeState.expandedMissionId = testingMissions[i].id;
        break;
      }
    }
    testingModeState.loaded = true;
    renderTestingMode();
  });
}

function isMissionAccomplished(missionId) {
  var mp = testingModeState.missionProgress[missionId];
  return mp && mp.reflections && !!mp.reflections.post;
}

function toggleMissionExpand(missionId) {
  testingModeState.expandedMissionId = (testingModeState.expandedMissionId === missionId) ? null : missionId;
  testingModeState.assistantTaskIdx = null;
  testingModeState.assistantMessages = [];
  renderTestingMode();
}

function toggleCategoryCollapse(catKey) {
  if (testingModeState.collapsedCategories[catKey]) {
    delete testingModeState.collapsedCategories[catKey];
  } else {
    testingModeState.collapsedCategories[catKey] = true;
  }
  renderTestingMode();
}

function areMissionTasksDone(mission) {
  var mp = testingModeState.missionProgress[mission.id];
  if (!mp) return false;
  return mission.tasks.filter(function(t) { return !t.optional; }).every(function(_, i) {
    // find the actual index in the full tasks array
    var realIdx = 0;
    var nonOptCount = 0;
    for (var j = 0; j < mission.tasks.length; j++) {
      if (!mission.tasks[j].optional) {
        if (nonOptCount === i) { realIdx = j; break; }
        nonOptCount++;
      }
    }
    return mp.progress[realIdx] === true;
  });
}

// --- Render ---
function renderMissionCard(mission) {
  var mp = testingModeState.missionProgress[mission.id] || { progress: {}, reflections: {} };
  var accomplished = isMissionAccomplished(mission.id);
  var isExpanded = testingModeState.expandedMissionId === mission.id;
  var hasPreReflection = !!(mp.reflections && mp.reflections.pre);
  var completedCount = 0;
  var requiredCount = 0;
  mission.tasks.forEach(function(t, i) {
    if (!t.optional) {
      requiredCount++;
      if (mp.progress[i] === true) completedCount++;
    }
  });
  var allRequiredDone = requiredCount > 0 && completedCount === requiredCount;
  var h = '';

  // Mission card header — always clickable
  var cardClasses = 'tm-mission-card';
  if (accomplished) cardClasses += ' accomplished';
  if (allRequiredDone && !accomplished) cardClasses += ' tm-pulse';
  h += '<div class="' + cardClasses + '">';

  // Clickable header
  h += '<div class="tm-mission-header" onclick="toggleMissionExpand(\'' + mission.id + '\')" style="cursor:pointer;display:flex;align-items:center;gap:8px;">';
  h += '<span style="flex-shrink:0;font-size:0.78rem;color:var(--warm-gray);">' + (isExpanded ? '▼' : '▶') + '</span>';
  h += '<span class="tm-mission-title" style="flex:1;margin:0;">' + escapeHtml(mission.title) + '</span>';
  if (accomplished) {
    h += '<span class="tm-mission-status tm-status-done">✅ Done</span>';
  } else if (hasPreReflection) {
    h += '<span class="tm-mission-status tm-status-active">⚡ ' + completedCount + '/' + requiredCount + '</span>';
  } else {
    h += '<span class="tm-mission-status tm-status-new">New</span>';
  }
  h += '</div>';

  // Collapsed — stop here
  if (!isExpanded) {
    h += '</div>';
    return h;
  }

  // Expanded content
  h += '<div class="tm-scenario">' + escapeHtml(mission.scenario) + '</div>';

  // Precondition notice
  if (mission.preconditionNotice) {
    h += '<div class="tm-precondition-notice">' + escapeHtml(mission.preconditionNotice) + '</div>';
  }

  // Pre-prompt section, if not yet started
  if (!hasPreReflection) {
    h += '<div class="tm-prompt-area">';
    h += '<label>' + escapeHtml(mission.prePrompt) + '</label>';
    h += '<textarea id="tmPrePrompt" placeholder="Share your thinking..."></textarea>';
    h += '<button onclick="handlePrePromptSubmit(\'' + mission.id + '\')">Submit & Start</button>';
    h += '</div>';
    h += '</div>';
    return h;
  }

  // Tasks
  h += '<ul class="tm-task-list">';
  mission.tasks.forEach(function(task, idx) {
    var checked = mp.progress[idx] === true;
    var isManual = !task.trigger;
    var isOptional = !!task.optional;
    h += '<li class="tm-task-item' + (checked ? ' checked' : '') + (isOptional ? ' tm-optional' : '') + '">';
    if (isManual && !checked && !accomplished) {
      h += '<span style="flex-shrink:0;width:20px;text-align:center;cursor:pointer;" onclick="toggleManualTask(\'' + mission.id + '\',' + idx + ')">⬜</span>';
    } else {
      h += '<span style="flex-shrink:0;width:20px;text-align:center;">' + (checked ? '✅' : '⬜') + '</span>';
    }
    h += '<span class="tm-task-text">' + escapeHtml(task.text) + (isOptional ? ' <em>(optional)</em>' : '') + '</span>';
    if (!accomplished) {
      h += '<button class="tm-task-hint-btn" onclick="openAssistant(\'' + mission.id + '\',' + idx + ')" title="Ask for a hint">?</button>';
    }
    h += '</li>';
  });
  h += '</ul>';

  // Assistant area
  if (testingModeState.assistantTaskIdx !== null && testingModeState.expandedMissionId === mission.id && !accomplished) {
    h += '<div class="tm-assistant-area">';
    h += '<div class="tm-assistant-label">Studio Assistant — Task ' + (testingModeState.assistantTaskIdx + 1) + '</div>';
    testingModeState.assistantMessages.forEach(function(msg) {
      h += '<div class="tm-assistant-response" style="' + (msg.role === 'user' ? 'color:var(--warm-gray);font-style:italic;' : '') + '">';
      h += msg.role === 'user' ? '→ ' + escapeHtml(msg.text) : msg.text;
      h += '</div>';
    });
    if (testingModeState.assistantLoading) {
      h += '<div class="tm-typing-dots"><span></span><span></span><span></span></div>';
    }
    h += '<div class="tm-assistant-input-row">';
    h += '<input type="text" id="tmAssistantInput" placeholder="Ask a question..." onkeydown="if(event.key===\'Enter\')askStudioAssistant()">';
    h += '<button onclick="askStudioAssistant()" ' + (testingModeState.assistantLoading ? 'disabled' : '') + '>Ask</button>';
    h += '</div>';
    h += '</div>';
  }

  // Post-prompt section: all required tasks done, not yet accomplished
  if (allRequiredDone && !accomplished) {
    h += '<div class="tm-prompt-area">';
    h += '<label>' + escapeHtml(mission.postPrompt) + '</label>';
    h += '<textarea id="tmPostPrompt" placeholder="Your feedback..."></textarea>';
    h += '<button onclick="handlePostPromptSubmit(\'' + mission.id + '\')">Submit Feedback</button>';
    h += '</div>';
  }

  h += '</div>';
  return h;
}

var MISSION_CATEGORIES = [
  { key: 'Selling', emoji: '🛒' },
  { key: 'Making', emoji: '🔨' },
  { key: 'Shipping', emoji: '📦' },
  { key: 'Marketing', emoji: '📣' },
  { key: 'Managing', emoji: '🗂️' },
  { key: 'Running', emoji: '⚙️' },
  { key: 'Shows', emoji: '🎪' },
  { key: 'Events', emoji: '📋' }
];

function renderTestingMode() {
  var body = document.getElementById('testingModeBody');
  var footer = document.getElementById('testingModeFooter');
  if (!testingMissions.length) {
    body.innerHTML = '<div style="padding:16px;color:var(--warm-gray);">No missions available yet.</div>';
    footer.innerHTML = '';
    return;
  }

  // Group missions by category
  var grouped = {};
  var uncategorized = [];
  testingMissions.forEach(function(m) {
    if (m.category) {
      if (!grouped[m.category]) grouped[m.category] = [];
      grouped[m.category].push(m);
    } else {
      uncategorized.push(m);
    }
  });

  var html = '';
  var focusedMission = testingModeState.expandedMissionId;

  // If a mission is expanded/focused, only show that mission
  if (focusedMission) {
    var mission = testingMissions.find(function(m) { return m.id === focusedMission; });
    if (mission) {
      html += renderMissionCard(mission);
    }
  } else {
    // No mission focused — show all categories with collapse support
    MISSION_CATEGORIES.forEach(function(cat) {
      if (!grouped[cat.key] || !grouped[cat.key].length) return;
      var missions = grouped[cat.key];
      var doneCount = missions.filter(function(m) { return isMissionAccomplished(m.id); }).length;
      var isCollapsed = !!testingModeState.collapsedCategories[cat.key];
      html += '<div class="tm-category-group">';
      html += '<div class="tm-category-header" onclick="toggleCategoryCollapse(\'' + cat.key + '\')" style="cursor:pointer;display:flex;align-items:center;gap:6px;">';
      html += '<span style="font-size:0.72rem;color:var(--warm-gray);">' + (isCollapsed ? '▶' : '▼') + '</span>';
      html += '<span>' + cat.emoji + ' ' + cat.key + '</span>';
      html += '<span style="margin-left:auto;font-size:0.72rem;color:var(--warm-gray);">' + doneCount + '/' + missions.length + '</span>';
      html += '</div>';
      if (!isCollapsed) {
        missions.forEach(function(mission) {
          html += renderMissionCard(mission);
        });
      }
      html += '</div>';
    });

    // Uncategorized missions (backwards compat)
    uncategorized.forEach(function(mission) {
      html += renderMissionCard(mission);
    });
  }

  body.innerHTML = html;

  // Focus assistant input if open
  if (testingModeState.assistantTaskIdx !== null) {
    var inp = document.getElementById('tmAssistantInput');
    if (inp && !testingModeState.assistantLoading) inp.focus();
  }

  footer.innerHTML = isAdmin() ? '<button onclick="resetTestingProgress()">Reset Progress</button>' : '';
}

// --- Pre/Post Prompt Handlers ---
function handlePrePromptSubmit(missionId) {
  var textarea = document.getElementById('tmPrePrompt');
  var value = textarea ? textarea.value.trim() : '';
  if (!value) { showToast('Please share your thinking before starting.', true); return; }
  var user = auth.currentUser;
  if (!user) return;
  if (!testingModeState.missionProgress[missionId]) testingModeState.missionProgress[missionId] = { progress: {}, reflections: {} };
  testingModeState.missionProgress[missionId].reflections.pre = value;
  MastDB.testingMode.setReflection(user.uid, missionId, 'pre', value);
  renderTestingMode();
}

function handlePostPromptSubmit(missionId) {
  var textarea = document.getElementById('tmPostPrompt');
  var value = textarea ? textarea.value.trim() : '';
  if (!value) { showToast('Please share your feedback.', true); return; }
  var user = auth.currentUser;
  if (!user) return;
  testingModeState.missionProgress[missionId].reflections.post = value;
  MastDB.testingMode.setReflection(user.uid, missionId, 'post', value);
  showToast('Feedback saved — thank you!');
  // Expand next non-accomplished mission
  testingModeState.expandedMissionId = null;
  for (var i = 0; i < testingMissions.length; i++) {
    if (!isMissionAccomplished(testingMissions[i].id)) {
      testingModeState.expandedMissionId = testingMissions[i].id;
      break;
    }
  }
  renderTestingMode();
}

// --- Task Completion ---
function notifyTestingMode(missionId, taskIdx) {
  if (!testingModeState.loaded) return;
  var mp = testingModeState.missionProgress[missionId];
  if (!mp || !mp.reflections || !mp.reflections.pre) return;
  if (mp.progress[taskIdx] === true) return;
  var user = auth.currentUser;
  if (!user) return;
  mp.progress[taskIdx] = true;
  MastDB.testingMode.progress(user.uid, missionId, taskIdx).set(true);

  var mission = testingMissions.find(function(m) { return m.id === missionId; });
  if (!mission) return;
  var allRequiredDone = mission.tasks.filter(function(t) { return !t.optional; }).every(function(_, i) {
    var count = 0;
    for (var j = 0; j < mission.tasks.length; j++) {
      if (!mission.tasks[j].optional) {
        if (count === i) return mp.progress[j] === true;
        count++;
      }
    }
    return false;
  });
  renderTestingMode();
  if (allRequiredDone) {
    var card = document.querySelector('.tm-mission-card.tm-pulse');
    if (!testingModeState.open) toggleTestingMode();
  } else if (testingModeState.open) {
    var body = document.getElementById('testingModeBody');
    if (body) body.scrollTop = 0;
  }
}

function toggleManualTask(missionId, taskIdx) {
  var mp = testingModeState.missionProgress[missionId];
  if (!mp) return;
  if (mp.progress[taskIdx] === true) return; // can't uncheck
  notifyTestingMode(missionId, taskIdx);
}

// --- Assistant ---
function openAssistant(missionId, taskIdx) {
  testingModeState.expandedMissionId = missionId;
  if (testingModeState.assistantTaskIdx === taskIdx) {
    testingModeState.assistantTaskIdx = null;
    testingModeState.assistantMessages = [];
  } else {
    testingModeState.assistantTaskIdx = taskIdx;
    testingModeState.assistantMessages = [];
  }
  renderTestingMode();
}

async function askStudioAssistant() {
  var input = document.getElementById('tmAssistantInput');
  var question = input ? input.value.trim() : '';
  if (!question || testingModeState.assistantLoading) return;
  var user = auth.currentUser;
  if (!user) return;
  var missionId = testingModeState.expandedMissionId;
  var mission = testingMissions.find(function(m) { return m.id === missionId; });
  if (!mission) return;
  var task = mission.tasks[testingModeState.assistantTaskIdx];
  if (!task) return;

  testingModeState.assistantMessages.push({ role: 'user', text: question });
  testingModeState.assistantLoading = true;
  renderTestingMode();

  try {
    var token = await auth.currentUser.getIdToken();
    var missionIdx = testingMissions.indexOf(mission);
    var body = {
      question: question,
      missionIndex: missionIdx,
      taskIndex: testingModeState.assistantTaskIdx,
      taskText: task.text,
      category: mission.category || ''
    };
    if (task.assistantContext) {
      body.assistantContext = task.assistantContext;
    }
    var resp = await callCF('/studioAssistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(body)
    });
    if (resp.status === 402) {
      // Token balance exhausted
      var errData = await resp.json();
      testingModeState.assistantMessages.push({ role: 'assistant', text: errData.error || 'Token balance exhausted. Purchase coins to continue using AI features.', isTokenError: true });
      testingModeState.assistantLoading = false;
      renderTestingMode();
      return;
    }
    var data = await resp.json();
    // Update token balance indicator from response
    if (data.tokenBalance !== undefined) {
      if (_tokenWallet) {
        _tokenWallet.currentBalance = data.tokenBalance;
        _tokenWallet.status = data.tokenStatus || _tokenWallet.status;
        if (data.coinBalance !== undefined) _tokenWallet.coinBalance = data.coinBalance;
        renderTokenBalanceIndicator();
      }
    }
    testingModeState.assistantMessages.push({ role: 'assistant', text: data.answer || 'Hmm, I\'m not sure about that one.' });

    MastDB.testingMode.questions(user.uid, missionId).push({
      taskIndex: testingModeState.assistantTaskIdx,
      question: question,
      answer: data.answer || '',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    testingModeState.assistantMessages.push({ role: 'assistant', text: 'Sorry, I couldn\'t connect. Try again in a moment.' });
  }

  testingModeState.assistantLoading = false;
  renderTestingMode();
}

// --- Reset ---
async function resetTestingProgress() {
  if (!isAdmin()) return;
  if (!await mastConfirm('Reset all testing progress? This clears tasks, reflections, and questions for all missions.', { title: 'Reset Progress', danger: true })) return;
  var user = auth.currentUser;
  if (!user) return;
  MastDB.testingMode.ref(user.uid).remove();
  testingModeState.missionProgress = {};
  testingMissions.forEach(function(m) {
    testingModeState.missionProgress[m.id] = { progress: {}, reflections: {} };
  });
  testingModeState.expandedMissionId = testingMissions.length ? testingMissions[0].id : null;
  testingModeState.assistantTaskIdx = null;
  testingModeState.assistantMessages = [];
  renderTestingMode();
  showToast('Testing progress reset.');
}
