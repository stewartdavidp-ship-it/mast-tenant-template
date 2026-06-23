/**
 * ask-ai-chat.js — the "Ask AI" assistant chat surface (route render +
 * send/cost-preview/history handlers for the askAiTab).
 *
 * Loaded EAGERLY via <script defer src> in app/index.html (NOT a lazy MANIFEST
 * entry). Extracted byte-for-byte from the index.html inline <script> for the T1
 * decomposition, except the native dialog becomes the themed mastConfirm helper
 * (Promise-style, awaited) and the bare white hex becomes rgba() (identical
 * color, hex-lint clean). The inline block is top-level scope, so every symbol
 * stays a window global; the cluster's own state (_askAiState, ASK_AI_PROXY_URL)
 * and its bare deps (MastUtil, MastDB, firebase, esc, navigateTo,
 * switchSettingsSubView, showToast, renderTokenBalanceIndicator) are window
 * globals read only POST-LOAD (renderAskAi is the route setup fn; askAi* fire via
 * onclick), so the deferred load is safe.
 *
 * window exports: renderAskAi, askAiSend, askAiConfirmSend,
 *   askAiCancelCostPreview, askAiNewChat, askAiClearHistory, askAiLoadChat.
 */

var _askAiState = {
  chatId: null,
  messages: [],
  provider: null,
  byoFallbackUsed: false,
  pendingCost: null,
  history: [] // list of {id, title, updatedAt}
};
var ASK_AI_PROXY_URL = 'https://us-central1-mast-platform-prod.cloudfunctions.net/askAiProxy';

function _askAiChatId() {
  if (_askAiState.chatId) return _askAiState.chatId;
  _askAiState.chatId = MastUtil.genId('chat_');
  return _askAiState.chatId;
}

async function renderAskAi() {
  // Reset transient banners
  var fb = document.getElementById('askAiFallbackBanner'); if (fb) fb.style.display = 'none';
  var oot = document.getElementById('askAiOutOfTokens'); if (oot) oot.style.display = 'none';
  var cp = document.getElementById('askAiCostPreview'); if (cp) cp.style.display = 'none';
  // Load provider + render mode badge
  loadAskAiProviderBadge();
  // Load chat history list
  loadAskAiHistory();
  // Restore current chat from state or start fresh
  if (!_askAiState.chatId || !_askAiState.messages.length) {
    _askAiState.chatId = null;
    _askAiState.messages = [];
  }
  renderAskAiMessages();
}

async function loadAskAiProviderBadge() {
  var el = document.getElementById('askAiModeBadge');
  if (!el) return;
  try {
    var res = await firebase.functions().httpsCallable('byoAnthropicStatus')({});
    var s = (res && res.data) ? res.data : {};
    _askAiState.provider = s.byo ? 'byo' : 'mast';
    var label = s.byo ? '✨ Your Anthropic key' : '⚡ Mast-managed (uses tokens)';
    var color = s.byo ? 'var(--teal)' : 'var(--amber)';
    el.innerHTML = '<span style="color:' + color + ';font-weight:600;">' + label + '</span> · <a href="javascript:void(0)" onclick="navigateTo(\'settings\'); setTimeout(function(){switchSettingsSubView(\'ai\')},100);" style="color:var(--teal);text-decoration:underline;font-size:0.78rem;">Change provider</a>';
  } catch (err) {
    el.innerHTML = '<span style="color:var(--warm-gray);">Provider status unavailable</span>';
  }
}

function _askAiMessageHtml(m) {
  var role = m.role === 'user' ? 'You' : 'Assistant';
  var bg = m.role === 'user' ? 'rgba(42,124,111,0.08)' : 'rgba(255,255,255,1)';
  var border = m.role === 'user' ? 'rgba(42,124,111,0.2)' : 'var(--cream-dark)';
  var h = '<div style="margin-bottom:10px;padding:10px 12px;background:' + bg + ';border:1px solid ' + border + ';border-radius:8px;">';
  h += '<div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">' + role + '</div>';
  h += '<div style="font-size:0.9rem;color:var(--text-primary);white-space:pre-wrap;">' + esc(m.text || '') + '</div>';
  if (m.cost) {
    h += '<div style="margin-top:6px;font-size:0.72rem;color:var(--warm-gray);">' + esc(m.cost) + '</div>';
  }
  h += '</div>';
  return h;
}

function renderAskAiMessages() {
  var el = document.getElementById('askAiMessages');
  if (!el) return;
  if (!_askAiState.messages.length) {
    el.innerHTML = '<div style="color:var(--warm-gray);font-size:0.85rem;text-align:center;padding:40px 20px;">Ask anything about your business. Examples: <em>“What were my top 3 selling products last month?”</em>, <em>“Draft a reply to this customer complaint.”</em></div>';
    return;
  }
  el.innerHTML = _askAiState.messages.map(_askAiMessageHtml).join('');
  el.scrollTop = el.scrollHeight;
}

async function askAiSend() {
  var input = document.getElementById('askAiInput');
  var btn = document.getElementById('askAiSendBtn');
  var statusEl = document.getElementById('askAiSendStatus');
  var modelEl = document.getElementById('askAiModel');
  var costPrevEl = document.getElementById('askAiCostPreview');
  var prompt = (input && input.value || '').trim();
  var model = (modelEl && modelEl.value) || 'claude-sonnet-4-6';

  if (!prompt) { if (statusEl) statusEl.textContent = 'Enter a question first.'; return; }

  // Cost preview when prompt is long. Skipped on BYO (no Mast tokens deducted)
  // and skipped if user has already seen + confirmed it for this prompt.
  if (prompt.length > 200 && _askAiState.provider !== 'byo' && _askAiState.pendingCost !== prompt) {
    if (btn) { btn.disabled = true; btn.textContent = 'Estimating…'; }
    try {
      var user = firebase.auth().currentUser;
      if (!user) throw new Error('Sign in first');
      var idToken = await user.getIdToken();
      var url = ASK_AI_PROXY_URL + '?cost=true';
      var resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
        body: JSON.stringify({ tenantId: MastDB.tenantId(), prompt: prompt, model: model })
      });
      var data = await resp.json();
      if (resp.ok && (data.estimatedMastTokenCost != null)) {
        if (costPrevEl) {
          costPrevEl.style.display = 'block';
          costPrevEl.innerHTML = 'This will cost roughly <strong>' + data.estimatedMastTokenCost + '</strong> Mast tokens (model: ' + esc(data.model || model) + '). <button class="btn btn-primary btn-small" onclick="askAiConfirmSend()" style="margin-left:8px;font-size:0.72rem;padding:4px 10px;">Send anyway</button> <button class="btn btn-secondary btn-small" onclick="askAiCancelCostPreview()" style="font-size:0.72rem;padding:4px 10px;">Cancel</button>';
        }
        _askAiState.pendingCost = prompt;
        if (statusEl) statusEl.textContent = '';
        return;
      }
    } catch (err) {
      // Fall through to send anyway on preview failure
      console.warn('cost preview failed:', err && err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
    }
  }

  // Proceed with actual send
  await _askAiActuallySend(prompt, model);
}

function askAiConfirmSend() {
  var input = document.getElementById('askAiInput');
  var modelEl = document.getElementById('askAiModel');
  var prompt = (input && input.value || '').trim();
  var model = (modelEl && modelEl.value) || 'claude-sonnet-4-6';
  var costPrevEl = document.getElementById('askAiCostPreview');
  if (costPrevEl) costPrevEl.style.display = 'none';
  _askAiActuallySend(prompt, model);
}
function askAiCancelCostPreview() {
  var costPrevEl = document.getElementById('askAiCostPreview');
  if (costPrevEl) costPrevEl.style.display = 'none';
  _askAiState.pendingCost = null;
}

async function _askAiActuallySend(prompt, model) {
  var btn = document.getElementById('askAiSendBtn');
  var statusEl = document.getElementById('askAiSendStatus');
  var input = document.getElementById('askAiInput');
  var fbEl = document.getElementById('askAiFallbackBanner');
  var ootEl = document.getElementById('askAiOutOfTokens');

  _askAiState.messages.push({ role: 'user', text: prompt });
  renderAskAiMessages();
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  if (statusEl) statusEl.textContent = '';
  if (fbEl) fbEl.style.display = 'none';
  if (ootEl) ootEl.style.display = 'none';

  try {
    var user = firebase.auth().currentUser;
    if (!user) throw new Error('Sign in first');
    var idToken = await user.getIdToken();
    var resp = await fetch(ASK_AI_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
      body: JSON.stringify({ tenantId: MastDB.tenantId(), prompt: prompt, model: model, maxTokens: 1024 })
    });
    if (resp.status === 402) {
      if (ootEl) ootEl.style.display = 'block';
      _askAiState.messages.push({ role: 'assistant', text: '(Out of tokens. Buy coins or connect your Anthropic key to continue.)' });
      renderAskAiMessages();
      return;
    }
    var data = await resp.json();
    if (!resp.ok) {
      var errMsg = (data && data.error) || ('HTTP ' + resp.status);
      _askAiState.messages.push({ role: 'assistant', text: '(Error: ' + errMsg + ')' });
      renderAskAiMessages();
      return;
    }
    var text = data.text || '(empty response)';
    var costLine = '';
    if (data.mode === 'byo') {
      costLine = 'via your Anthropic key · no Mast tokens';
    } else {
      var deducted = (data.usage && data.usage.mastTokensDeducted) || 0;
      costLine = 'Cost: ' + deducted + ' Mast tokens · ' + esc(data.model || model);
    }
    if (data.byoFallbackUsed && fbEl) {
      fbEl.innerHTML = '<strong>Your Anthropic key failed</strong> — this answer used Mast tokens as a fallback. Check Settings → AI to fix the key or disable the fallback.';
      fbEl.style.display = 'block';
    }
    _askAiState.messages.push({ role: 'assistant', text: text, cost: costLine });
    renderAskAiMessages();
    _askAiPersist();
    // Refresh token-balance chip if present
    if (typeof renderTokenBalanceIndicator === 'function') {
      MastDB.tokenWallet.get().then(function(w) { if (w) { _tokenWallet = w; renderTokenBalanceIndicator(); } }).catch(function(){});
    }
  } catch (err) {
    _askAiState.messages.push({ role: 'assistant', text: '(Network error: ' + (err.message || err) + ')' });
    renderAskAiMessages();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
    if (input) input.value = '';
    _askAiState.pendingCost = null;
  }
}

function _askAiPersist() {
  try {
    var id = _askAiChatId();
    var firstUser = _askAiState.messages.find(function(m) { return m.role === 'user'; });
    var title = firstUser ? (firstUser.text.slice(0, 60) + (firstUser.text.length > 60 ? '…' : '')) : 'New chat';
    MastDB.set('ai_chats/' + id, {
      id: id,
      title: title,
      messages: _askAiState.messages,
      updatedAt: new Date().toISOString()
    }).catch(function(err){ console.warn('ai_chats persist failed:', err && err.message); });
  } catch (e) { console.warn('persist threw:', e && e.message); }
}

async function loadAskAiHistory() {
  var el = document.getElementById('askAiHistoryStrip');
  if (!el) return;
  try {
    var chats = await MastDB.query('ai_chats').orderByChild('updatedAt').limitToLast(10).get();
    var rows = [];
    if (chats) {
      Object.keys(chats).forEach(function(k) { rows.push(chats[k]); });
    }
    rows.sort(function(a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
    _askAiState.history = rows.map(function(c) { return { id: c.id, title: c.title, updatedAt: c.updatedAt }; });
    if (!rows.length) { el.innerHTML = ''; return; }
    var h = '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:0.78rem;color:var(--warm-gray);">';
    h += '<span>Recent:</span>';
    rows.slice(0, 6).forEach(function(c) {
      h += '<button class="btn btn-secondary btn-small" onclick="askAiLoadChat(\'' + esc(c.id) + '\')" style="font-size:0.72rem;padding:4px 8px;">' + esc((c.title || 'Untitled').slice(0, 30)) + '</button>';
    });
    h += '</div>';
    el.innerHTML = h;
  } catch (err) {
    el.innerHTML = '';
  }
}

async function askAiLoadChat(id) {
  try {
    var chat = await MastDB.get('ai_chats/' + id);
    if (!chat) return;
    _askAiState.chatId = chat.id;
    _askAiState.messages = chat.messages || [];
    renderAskAiMessages();
  } catch (e) { /* ignore */ }
}

function askAiNewChat() {
  _askAiState.chatId = null;
  _askAiState.messages = [];
  _askAiState.byoFallbackUsed = false;
  _askAiState.pendingCost = null;
  var fb = document.getElementById('askAiFallbackBanner'); if (fb) fb.style.display = 'none';
  var cp = document.getElementById('askAiCostPreview'); if (cp) cp.style.display = 'none';
  renderAskAiMessages();
}

async function askAiClearHistory() {
  if (!(await mastConfirm('Clear all Ask AI chat history? This deletes saved chats from this tenant.'))) return;
  try {
    await MastDB.set('ai_chats', null);
    askAiNewChat();
    loadAskAiHistory();
    showToast('Ask AI history cleared.');
  } catch (e) {
    showToast('Could not clear history: ' + (e && e.message ? e.message : e), true);
  }
}

window.renderAskAi = renderAskAi;
window.askAiSend = askAiSend;
window.askAiConfirmSend = askAiConfirmSend;
window.askAiCancelCostPreview = askAiCancelCostPreview;
window.askAiNewChat = askAiNewChat;
window.askAiClearHistory = askAiClearHistory;
window.askAiLoadChat = askAiLoadChat;
