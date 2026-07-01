import { createBridgeClient } from './bridge-client.js';
import { createInitialState, reduceSidePanelState } from './sidepanel-state.js';
import { createToolExecutor } from './tool-executor.js';
import { resolveCwdPath } from './cwd-picker.js';
import { renderMarkdown } from './markdown-renderer.js';

let state = createInitialState();
let client;
let promptWasFocused = false;

const els = {
  status: document.querySelector('#status'),
  offline: document.querySelector('#offline'),
  reloadBanner: document.querySelector('#reload-banner'),
  session: document.querySelector('#session'),
  messages: document.querySelector('#messages'),
  main: document.querySelector('main'),
  uiRequests: document.querySelector('#header-ui-requests'),
  notifications: document.querySelector('#notifications'),
  form: document.querySelector('#prompt-form'),
  prompt: document.querySelector('#prompt'),
  sendButton: document.querySelector('#send-button'),
  abortButton: document.querySelector('#abort-button'),
  cwdDisplay: document.querySelector('#cwd-display'),
  cwdPicker: document.querySelector('#cwd-picker'),
  cwdWarning: document.querySelector('#cwd-warning'),
  cwdInput: document.querySelector('#cwd-input'),
  cookies: document.querySelector('#cookies'),
  storage: document.querySelector('#storage'),
  devtoolsWarning: document.querySelector('#devtools-warning'),
  attachedTabsList: document.querySelector('#attached-tabs-list'),
  sessionSelect: document.querySelector('#session-select'),
  sessionError: document.querySelector('#session-error'),
  headerCwdRow: document.querySelector('#header-cwd-row'),
  themeToggle: document.querySelector('#theme-toggle'),
  autocompleteDropdown: document.querySelector('#autocomplete-dropdown'),
  modelSelectorBar: document.querySelector('#model-selector-bar'),
  modelSelect: document.querySelector('#model-select'),
};

let selectedCwd = null;
let lastFetchedCwd = null;
let autocompleteDebounceTimer = null;

// ── UI Request Timeout Timers ──────────────────────────────
const UI_REQUEST_TIMEOUT_MS = 30_000; // 30 seconds
const uiRequestTimers = new Map(); // id -> { timeout, interval }

function startUiRequestTimer(requestId, createdAt) {
  // Clear any existing timer for this request
  clearUiRequestTimer(requestId);

  const elapsed = Date.now() - createdAt;
  const remaining = Math.max(0, UI_REQUEST_TIMEOUT_MS - elapsed);

  const timeout = setTimeout(() => {
    clearUiRequestTimer(requestId);
    // Send default response based on kind
    const request = state.uiRequests.find((r) => r.id === requestId);
    if (request) {
      const defaultValue = request.kind === 'confirm' ? false : '';
      try {
        client.sendCommand({ type: 'extension_ui_response', id: requestId, value: defaultValue });
      } catch {
        // Bridge not connected
      }
      dispatch({ type: 'extension_ui_request_timeout', id: requestId });
    }
  }, remaining);

  const interval = setInterval(() => {
    render(); // Re-render to update countdown display
  }, 1000);

  uiRequestTimers.set(requestId, { timeout, interval });
}

function clearUiRequestTimer(requestId) {
  const timer = uiRequestTimers.get(requestId);
  if (timer) {
    clearTimeout(timer.timeout);
    clearInterval(timer.interval);
    uiRequestTimers.delete(requestId);
  }
}

function getRemainingSeconds(createdAt) {
  const elapsed = Date.now() - createdAt;
  return Math.max(0, Math.ceil((UI_REQUEST_TIMEOUT_MS - elapsed) / 1000));
}

// ── Autocomplete Engine ───────────────────────────────────

function buildAutocompleteItems(prefix) {
  const items = [];
  // Strip leading / so we match against bare command names
  const raw = prefix.startsWith('/') ? prefix.substring(1) : prefix;
  const lower = raw.toLowerCase();

  // Commands
  for (const cmd of state.commands) {
    if (cmd.name.toLowerCase().startsWith(lower)) {
      items.push({
        value: `/${cmd.name} `,
        label: `/${cmd.name}`,
        description: cmd.description || '',
        type: 'command',
      });
    }
  }

  // Skills
  for (const skill of state.skills) {
    const label = `/skill:${skill.name}`;
    if (label.toLowerCase().startsWith(lower)) {
      items.push({
        value: `${label} `,
        label,
        description: skill.description || '',
        type: 'skill',
      });
    }
  }

  // Templates
  for (const tmpl of state.templates) {
    if (tmpl.name.toLowerCase().startsWith(lower)) {
      items.push({
        value: `/${tmpl.name} `,
        label: `/${tmpl.name}`,
        description: tmpl.description || '',
        type: 'template',
      });
    }
  }

  return items;
}

function findCommandByName(name) {
  // Check commands
  for (const cmd of state.commands) {
    if (cmd.name === name) return cmd;
  }
  // Check skills (skill:name format)
  if (name.startsWith('skill:')) {
    const skillName = name.substring(6);
    for (const skill of state.skills) {
      if (skill.name === skillName) return skill;
    }
  }
  // Check templates
  for (const tmpl of state.templates) {
    if (tmpl.name === name) return tmpl;
  }
  return null;
}

function renderAutocompleteDropdown() {
  if (!state.autocompleteOpen || state.autocompleteItems.length === 0) {
    els.autocompleteDropdown.hidden = true;
    return;
  }

  els.autocompleteDropdown.hidden = false;
  els.autocompleteDropdown.innerHTML = '';

  for (let i = 0; i < state.autocompleteItems.length; i++) {
    const item = state.autocompleteItems[i];
    const el = document.createElement('div');
    el.className = 'autocomplete-item' + (i === state.autocompleteIndex ? ' selected' : '');

    const label = document.createElement('span');
    label.className = 'autocomplete-item-label';
    label.textContent = item.label;
    el.appendChild(label);

    if (item.description) {
      const desc = document.createElement('span');
      desc.className = 'autocomplete-item-desc';
      desc.textContent = item.description;
      el.appendChild(desc);
    }

    const type = document.createElement('span');
    type.className = 'autocomplete-item-type';
    type.textContent = item.type || 'cmd';
    el.appendChild(type);

    el.addEventListener('click', () => {
      acceptAutocompleteItem(item);
    });

    els.autocompleteDropdown.appendChild(el);
  }

  // Scroll the selected item into view
  const selected = els.autocompleteDropdown.querySelector('.autocomplete-item.selected');
  if (selected) {
    selected.scrollIntoView({ block: 'nearest' });
  }
}

function acceptAutocompleteItem(item) {
  if (!item) return;
  const textarea = els.prompt;
  const start = textarea.selectionStart;
  const text = textarea.value;
  // Find the start of the current word (from beginning or last space)
  let wordStart = 0;
  for (let i = start - 1; i >= 0; i--) {
    if (text[i] === ' ' || text[i] === '\n') {
      wordStart = i + 1;
      break;
    }
  }

  // Argument completions don't start with / — append after the current word
  // Command completions start with / — replace the current word
  if (item.value.startsWith('/')) {
    // Command completion: replace the current word
    textarea.value = text.substring(0, wordStart) + item.value + text.substring(start);
  } else {
    // Argument completion: append after the current word with a space
    const currentWord = text.substring(wordStart, start);
    const separator = currentWord.endsWith(' ') ? '' : ' ';
    textarea.value = text.substring(0, start) + separator + item.value + text.substring(start);
  }

  // Position cursor after the inserted text
  const newPos = textarea.value.indexOf(item.value, start) + item.value.length;
  textarea.setSelectionRange(newPos, newPos);
  textarea.focus();
  dispatch({ type: 'autocomplete_accept' });
  autoResizePrompt();
}

function navigateAutocomplete(direction) {
  const items = state.autocompleteItems;
  if (items.length === 0) return;
  let newIndex = state.autocompleteIndex + direction;
  if (newIndex < 0) newIndex = items.length - 1;
  if (newIndex >= items.length) newIndex = 0;
  dispatch({ type: 'autocomplete_select', index: newIndex });
}

function triggerAutocomplete() {
  const text = els.prompt.value;
  if (!text.startsWith('/')) {
    if (state.autocompleteOpen) {
      dispatch({ type: 'autocomplete_close' });
    }
    return;
  }

  // Find the current word
  const cursorPos = els.prompt.selectionStart;
  let wordStart = 0;
  for (let i = cursorPos - 1; i >= 0; i--) {
    if (text[i] === ' ' || text[i] === '\n') {
      wordStart = i + 1;
      break;
    }
  }
  const currentWord = text.substring(wordStart, cursorPos);

  // If there's a space in the current word, we're doing argument completion
  const spaceIdx = currentWord.indexOf(' ');
  if (spaceIdx >= 0) {
    // Argument completion — request from bridge
    const cmdName = currentWord.substring(1, spaceIdx);
    const args = currentWord.substring(spaceIdx + 1);
    try {
      client.sendCommand({ type: 'get_completions', command: cmdName, args });
    } catch {
      // Bridge not connected
    }
    return;
  }

  // Command name completion — local
  const items = buildAutocompleteItems(currentWord);

  // If the current word exactly matches a known command, also request argument completions
  // Strip leading / for the command name lookup
  const cmdNameBare = currentWord.startsWith('/') ? currentWord.substring(1) : currentWord;
  const exactMatch = findCommandByName(cmdNameBare);
  if (exactMatch && items.length <= 1) {
    // Request argument completions from the bridge
    try {
      dispatch({ type: 'autocomplete_request_completions', command: cmdNameBare });
      client.sendCommand({ type: 'get_completions', command: cmdNameBare, args: '' });
    } catch {
      // Bridge not connected — fall through to local completion
      if (items.length > 0) {
        dispatch({ type: 'autocomplete_open', items });
      } else {
        dispatch({ type: 'autocomplete_close' });
      }
    }
    return;
  }

  if (items.length > 0) {
    dispatch({ type: 'autocomplete_open', items });
  } else {
    dispatch({ type: 'autocomplete_close' });
  }
}

function onPromptInput() {
  autoResizePrompt();
  if (autocompleteDebounceTimer) {
    clearTimeout(autocompleteDebounceTimer);
  }
  autocompleteDebounceTimer = setTimeout(() => {
    triggerAutocomplete();
    autocompleteDebounceTimer = null;
  }, 150);
}

function fetchSessionsForCwd(cwd) {
  if (!cwd) return;
  // Only fetch sessions with absolute paths — relative paths can't be matched
  // against session records. Let the bridge resolve relative paths via new_session,
  // then session_state will fire back with the absolute cwd and trigger this again.
  const isAbsolute = cwd.startsWith('/') || /^[a-zA-Z]:/.test(cwd);
  if (!isAbsolute) return;
  if (cwd === lastFetchedCwd) return; // Already fetched
  if (!state.bridgeOnline) return;
  lastFetchedCwd = cwd;
  dispatch({ type: 'loading_sessions' });
  client.sendCommand({ type: 'list_sessions', cwd });
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${month} ${day}, ${displayHours}:${minutes} ${ampm}`;
}

function truncate(text, maxLength) {
  if (!text) return '';
  return text.length > maxLength ? text.substring(0, maxLength) + '…' : text;
}

function render() {
  els.status.textContent = state.bridgeOnline ? 'Bridge online' : 'Bridge offline';
  els.status.classList.toggle('online', state.bridgeOnline);
  els.offline.hidden = state.bridgeOnline || state.reconnectExhausted;
  els.reloadBanner.hidden = !state.reconnectExhausted;
  els.session.hidden = !state.bridgeOnline;
  els.headerCwdRow.hidden = !state.bridgeOnline;
  els.cookies.checked = state.cookieAccessEnabled;
  els.storage.checked = state.storageAccessEnabled;
  els.devtoolsWarning.hidden = !state.devtoolsConflict;
  
  // Update Send/Abort button toggle
  const isBusy = state.sending;
  els.sendButton.hidden = isBusy;
  els.abortButton.hidden = !isBusy;
  
  // Track if prompt was focused before disabling, so we can restore focus when re-enabled
  const willBeDisabled = !state.bridgeOnline || isBusy;
  if (!els.prompt.disabled && willBeDisabled) {
    promptWasFocused = document.activeElement === els.prompt;
  }
  els.prompt.disabled = willBeDisabled;
  if (!willBeDisabled && promptWasFocused) {
    promptWasFocused = false;
    els.prompt.focus();
  }
  
  // Show send error if present
  let errorEl = document.querySelector('#send-error');
  if (state.sendError) {
    if (!errorEl) {
      errorEl = document.createElement('div');
      errorEl.id = 'send-error';
      errorEl.className = 'send-error';
      els.form.parentNode.insertBefore(errorEl, els.form);
    }
    errorEl.textContent = `⚠ ${state.sendError}`;
    errorEl.hidden = false;
  } else if (errorEl) {
    errorEl.hidden = true;
  }
  
  els.uiRequests.innerHTML = '';

  // Clean up timers for requests no longer in state
  for (const [id] of uiRequestTimers) {
    if (!state.uiRequests.some((r) => r.id === id)) {
      clearUiRequestTimer(id);
    }
  }

  for (const request of state.uiRequests) {
    const item = document.createElement('div');
    item.className = 'header-ui-request';
    item.id = `ui-request-${request.id}`;

    const msg = document.createElement('span');
    msg.className = 'ui-request-message';
    msg.textContent = request.message ?? request.kind;
    item.appendChild(msg);

    // Countdown timer display
    const countdown = document.createElement('span');
    countdown.className = 'ui-request-countdown';
    countdown.textContent = `⏱ ${getRemainingSeconds(request.createdAt)}s`;
    countdown.style.fontSize = '11px';
    countdown.style.color = 'var(--ink-tertiary)';
    countdown.style.flexShrink = '0';
    item.appendChild(countdown);

    // Start timer if not already running
    if (!uiRequestTimers.has(request.id)) {
      startUiRequestTimer(request.id, request.createdAt);
    }

    const actions = document.createElement('div');
    actions.className = 'ui-request-actions';
    actions.style.display = 'flex';
    actions.style.gap = '6px';
    actions.style.alignItems = 'center';

    if (request.kind === 'confirm') {
      const okBtn = document.createElement('button');
      okBtn.textContent = 'OK';
      okBtn.style.background = 'var(--success)';
      okBtn.style.color = '#fff';
      okBtn.style.border = 'none';
      okBtn.style.borderRadius = 'var(--radius-sm)';
      okBtn.style.padding = '4px 14px';
      okBtn.style.fontSize = '12px';
      okBtn.style.fontWeight = '600';
      okBtn.style.cursor = 'pointer';
      okBtn.addEventListener('click', () => {
        client.sendCommand({ type: 'extension_ui_response', id: request.id, value: true });
        dispatch({ type: 'extension_ui_response_sent', id: request.id });
      });
      actions.appendChild(okBtn);

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.background = 'var(--surface-2)';
      cancelBtn.style.color = 'var(--ink)';
      cancelBtn.style.border = '1px solid var(--border)';
      cancelBtn.style.borderRadius = 'var(--radius-sm)';
      cancelBtn.style.padding = '4px 14px';
      cancelBtn.style.fontSize = '12px';
      cancelBtn.style.fontWeight = '600';
      cancelBtn.style.cursor = 'pointer';
      cancelBtn.addEventListener('click', () => {
        client.sendCommand({ type: 'extension_ui_response', id: request.id, value: false });
        dispatch({ type: 'extension_ui_response_sent', id: request.id });
      });
      actions.appendChild(cancelBtn);
    } else if (request.kind === 'select' && request.options) {
      const select = document.createElement('select');
      select.style.fontSize = '12px';
      select.style.padding = '3px 8px';
      select.style.border = '1px solid var(--border)';
      select.style.borderRadius = 'var(--radius-sm)';
      select.style.background = 'var(--surface)';
      select.style.color = 'var(--ink)';
      for (const opt of request.options) {
        const option = document.createElement('option');
        option.value = opt;
        option.textContent = opt;
        select.appendChild(option);
      }
      actions.appendChild(select);

      const submitBtn = document.createElement('button');
      submitBtn.textContent = 'Submit';
      submitBtn.style.background = 'var(--accent)';
      submitBtn.style.color = '#fff';
      submitBtn.style.border = 'none';
      submitBtn.style.borderRadius = 'var(--radius-sm)';
      submitBtn.style.padding = '4px 14px';
      submitBtn.style.fontSize = '12px';
      submitBtn.style.fontWeight = '600';
      submitBtn.style.cursor = 'pointer';
      submitBtn.addEventListener('click', () => {
        client.sendCommand({ type: 'extension_ui_response', id: request.id, value: select.value });
        dispatch({ type: 'extension_ui_response_sent', id: request.id });
      });
      actions.appendChild(submitBtn);
    } else if (request.kind === 'input') {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = request.message || 'Enter value...';
      input.style.fontSize = '12px';
      input.style.padding = '3px 8px';
      input.style.border = '1px solid var(--border)';
      input.style.borderRadius = 'var(--radius-sm)';
      input.style.background = 'var(--surface)';
      input.style.color = 'var(--ink)';
      input.style.minWidth = '120px';
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          client.sendCommand({ type: 'extension_ui_response', id: request.id, value: input.value });
          dispatch({ type: 'extension_ui_response_sent', id: request.id });
        }
      });
      actions.appendChild(input);

      const submitBtn = document.createElement('button');
      submitBtn.textContent = 'Submit';
      submitBtn.style.background = 'var(--accent)';
      submitBtn.style.color = '#fff';
      submitBtn.style.border = 'none';
      submitBtn.style.borderRadius = 'var(--radius-sm)';
      submitBtn.style.padding = '4px 14px';
      submitBtn.style.fontSize = '12px';
      submitBtn.style.fontWeight = '600';
      submitBtn.style.cursor = 'pointer';
      submitBtn.addEventListener('click', () => {
        client.sendCommand({ type: 'extension_ui_response', id: request.id, value: input.value });
        dispatch({ type: 'extension_ui_response_sent', id: request.id });
      });
      actions.appendChild(submitBtn);
    } else {
      // Default: simple OK button
      const ok = document.createElement('button');
      ok.textContent = 'OK';
      ok.addEventListener('click', () => {
        client.sendCommand({ type: 'extension_ui_response', id: request.id, value: request.kind === 'confirm' ? true : '' });
        dispatch({ type: 'extension_ui_response_sent', id: request.id });
      });
      actions.appendChild(ok);
    }

    item.appendChild(actions);
    els.uiRequests.append(item);
  }
  els.notifications.textContent = state.notifications.join('\n');
  els.messages.innerHTML = '';
  for (const message of state.messages) {
    const item = document.createElement('div');
    item.className = `message ${message.role}`;

    switch (message.role) {
      case 'user':
        if (message.isCommand) {
          // Render command messages with a terminal-like pill
          item.classList.add('command');
          const cmdIcon = document.createElement('span');
          cmdIcon.className = 'command-icon';
          cmdIcon.textContent = '⌘';
          item.appendChild(cmdIcon);
          const cmdText = document.createElement('span');
          cmdText.className = 'command-text';
          cmdText.textContent = message.text;
          item.appendChild(cmdText);
        } else {
          item.innerHTML = renderMarkdown(message.text);
          if (message.image) {
            const img = document.createElement('img');
            img.className = 'user-image';
            img.src = `data:${message.image.mimeType};base64,${message.image.data}`;
            item.appendChild(img);
          }
        }
        break;

      case 'assistant':
        if (message.thinking) {
          const thinkingToggle = document.createElement('button');
          thinkingToggle.className = 'thinking-toggle';
          thinkingToggle.textContent = '🤔 Thinking...';
          const thinkingBlock = document.createElement('div');
          thinkingBlock.className = 'thinking-block';
          thinkingBlock.textContent = message.thinking;
          thinkingToggle.addEventListener('click', () => {
            thinkingBlock.classList.toggle('expanded');
          });
          item.appendChild(thinkingToggle);
          item.appendChild(thinkingBlock);
        }
        item.insertAdjacentHTML('beforeend', renderMarkdown(message.text));
        break;

      case 'tool': {
        const toolHeader = document.createElement('div');
        toolHeader.className = 'tool-name';
        toolHeader.textContent = `🔧 ${message.toolName}${message.isError ? ' (error)' : ''}`;
        item.appendChild(toolHeader);

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'toggle-result';
        toggleBtn.textContent = '▼ Show result';
        const resultDiv = document.createElement('div');
        resultDiv.className = 'tool-result';
        resultDiv.textContent = message.toolResult;
        toggleBtn.addEventListener('click', () => {
          item.classList.toggle('expanded');
          toggleBtn.textContent = item.classList.contains('expanded') ? '▲ Hide result' : '▼ Show result';
        });
        item.appendChild(toggleBtn);
        item.appendChild(resultDiv);
        break;
      }

      case 'bash': {
        const cmd = document.createElement('div');
        cmd.className = 'bash-command';
        cmd.textContent = `$ ${message.command}`;
        item.appendChild(cmd);

        const output = document.createElement('div');
        output.className = 'bash-output';
        output.textContent = message.output;
        item.appendChild(output);

        if (message.isError) item.classList.add('error');
        break;
      }

      case 'compaction': {
        const compHeader = document.createElement('div');
        compHeader.textContent = `📦 Context compacted (${message.tokensBefore} tokens summarized)`;
        item.appendChild(compHeader);

        const summary = document.createElement('div');
        summary.className = 'compaction-summary';
        summary.textContent = message.summary;
        item.appendChild(summary);
        break;
      }

      case 'system':
        item.textContent = message.text;
        break;

      default:
        item.textContent = message.text || '';
    }

    els.messages.append(item);
  }
  // Scroll to bottom of messages
  els.main.scrollTop = els.main.scrollHeight;

  // Render session selector dropdown
  renderSessionSelect();

  // Render error pill
  renderErrorPill();

  // Render autocomplete dropdown
  renderAutocompleteDropdown();

  // Render model selector
  renderModelSelector();

  // Update cwd display from session state (synced from bridge) or local input
  const sessionCwd = state.session?.cwd;
  if (sessionCwd) {
    selectedCwd = sessionCwd;
    els.cwdDisplay.textContent = sessionCwd;
    els.cwdInput.value = sessionCwd;
    els.cwdWarning.hidden = true;
    els.cwdInput.hidden = true;
  } else if (!els.cwdInput.hidden) {
    els.cwdDisplay.textContent = els.cwdInput.value || 'not set';
  }
  
  // Render attached tabs list
  console.log(`[SidePanel] render: attachedTabs=${JSON.stringify(state.attachedTabs.map(t => ({ id: t.id, title: t.title })))}`);
  els.attachedTabsList.style.display = state.attachedTabs.length === 0 ? 'none' : 'flex';
  els.attachedTabsList.innerHTML = '';
  for (const tab of state.attachedTabs) {
    const chip = document.createElement('span');
    chip.className = 'tab-chip';

    const label = document.createElement('span');
    label.className = 'tab-chip-label';
    label.textContent = tab.title;
    chip.append(label);

    const remove = document.createElement('button');
    remove.className = 'tab-chip-remove';
    remove.textContent = '×';
    remove.title = 'Detach debugger from this tab';
    remove.addEventListener('click', () => {
      toolExecutor.detachTab(tab.id);
      dispatch({ type: 'debugger_detached', tabId: tab.id });
    });
    chip.append(remove);

    els.attachedTabsList.append(chip);
  }
}

function renderSessionSelect() {
  const select = els.sessionSelect;
  const sessions = state.sessionsList;

  select.innerHTML = '';

  // "+ New Session" option
  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '+ New Session';
  select.appendChild(newOpt);

  if (sessions.length === 0) {
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '— No sessions for this directory —';
    select.appendChild(noneOpt);
    select.disabled = true;
    return;
  }

  select.disabled = false;

  for (const session of sessions) {
    const opt = document.createElement('option');
    opt.value = session.path;
    const displayName = session.name || truncate(session.firstMessage, 60) || formatDate(session.timestamp);
    opt.textContent = displayName;
    select.appendChild(opt);
  }

  // Select the currently active session if it's in the list
  const currentSessionPath = state.session?.sessionPath;
  if (currentSessionPath && sessions.some((s) => s.path === currentSessionPath)) {
    select.value = currentSessionPath;
  }
}

function renderModelSelector() {
  if (state.modelList.length === 0) {
    els.modelSelectorBar.hidden = true;
    return;
  }

  els.modelSelectorBar.hidden = false;
  els.modelSelect.innerHTML = '';

  for (const model of state.modelList) {
    const opt = document.createElement('option');
    opt.value = `${model.provider}/${model.name}`;
    opt.textContent = `${model.provider}/${model.name}`;
    if (model.provider === state.currentModelProvider && model.id === state.currentModelId) {
      opt.selected = true;
    }
    els.modelSelect.appendChild(opt);
  }
}

function renderErrorPill() {
  if (state.sessionError && state.sessionError.trim()) {
    els.sessionError.textContent = `⚠ ${state.sessionError}`;
    els.sessionError.classList.add('visible');
  } else {
    els.sessionError.classList.remove('visible');
    els.sessionError.textContent = '';
  }
}

function dispatch(event) {
  state = reduceSidePanelState(state, event);
  render();
}

const toolExecutor = createToolExecutor(undefined, {
  onAttach: (tabId, title) => {
    console.log(`[SidePanel] onAttach fired: tabId=${tabId}, title="${title}"`);
    dispatch({ type: 'debugger_attached', tabId, title });
    // If this is the active tab, resolve any pending conflict
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.id === tabId) {
        dispatch({ type: 'devtools_conflict_resolved' });
      }
    });
  },
  onDetach: (tabId, reason) => {
    console.log(`[SidePanel] onDetach fired: tabId=${tabId}, reason=${reason}`);
    dispatch({ type: 'debugger_detached', tabId });
    // Check if this is the active tab for DevTools warning
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.id === tabId) {
        dispatch({ type: 'devtools_conflict' });
      }
    });
  },
  onReattach: (tabId) => {
    console.log(`[SidePanel] onReattach fired: tabId=${tabId}`);
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.id === tabId) {
        dispatch({ type: 'devtools_conflict_resolved' });
      }
    });
  },
  onAttachFailed: (tabId) => {
    console.warn(`[SidePanel] onAttachFailed: tabId=${tabId}`);
    // Auto-attach failed on a newly activated tab — show conflict if it's active
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.id === tabId) {
        dispatch({ type: 'devtools_conflict' });
      }
    });
  },
});

client = createBridgeClient({
  onEvent: (event) => {
    if (event.type === 'bridge_connected') {
      // Sync initial attached tabs from toolExecutor
      for (const tabId of toolExecutor.attachedTabIds) {
        chrome.tabs.get(tabId).then((tab) => {
          dispatch({ type: 'debugger_attached', tabId, title: tab.title });
        }).catch(() => {});
      }
    }
    if (event.type === 'session_state' && event.session?.cwd) {
      // Auto-fetch sessions when cwd changes
      fetchSessionsForCwd(event.session.cwd);
    }
    dispatch(event);
  },
  executeTool: (tool, params) => toolExecutor.execute(tool, params),
});
client.connect();

els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = els.prompt.value.trim();
  if (!message) return;
  if (!state.bridgeOnline) {
    dispatch({ type: 'bridge_error', error: 'Bridge is offline — cannot send message' });
    return;
  }

  // Close autocomplete if open
  if (state.autocompleteOpen) {
    dispatch({ type: 'autocomplete_close' });
  }

  // Validate command if message starts with /
  if (message.startsWith('/')) {
    const parts = message.split(/\s+/);
    const cmdName = parts[0].substring(1); // Remove leading /
    const resolved = findCommandByName(cmdName);
    if (!resolved) {
      // Unknown command — block submit, show error
      dispatch({ type: 'extension_command_error', command: cmdName });
      els.prompt.value = '';
      autoResizePrompt();
      return;
    }
  }

  dispatch({ type: 'user_message', text: message });
  try {
    client.sendCommand({ type: 'prompt', message });
  } catch (error) {
    dispatch({ type: 'prompt_error', message, error: error.message });
  }
  els.prompt.value = '';
  autoResizePrompt();
});

// Auto-grow textarea + Enter to send, Shift+Enter for newline
function autoResizePrompt() {
  els.prompt.style.height = 'auto';
  els.prompt.style.height = Math.min(els.prompt.scrollHeight, 180) + 'px';
}

els.prompt.addEventListener('input', onPromptInput);

els.prompt.addEventListener('keydown', (event) => {
  // Handle autocomplete keyboard navigation
  if (state.autocompleteOpen) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      navigateAutocomplete(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      navigateAutocomplete(-1);
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const item = state.autocompleteItems[state.autocompleteIndex];
      if (item) {
        acceptAutocompleteItem(item);
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const item = state.autocompleteItems[state.autocompleteIndex];
      if (item) {
        acceptAutocompleteItem(item);
      } else {
        // No item selected, submit form
        els.form.dispatchEvent(new Event('submit', { cancelable: true }));
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      dispatch({ type: 'autocomplete_close' });
      return;
    }
  }

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    els.form.dispatchEvent(new Event('submit', { cancelable: true }));
  }
});

els.abortButton.addEventListener('click', (event) => {
  event.preventDefault();
  console.log('[SidePanel] Abort button clicked, bridgeOnline:', state.bridgeOnline);
  if (!state.bridgeOnline) {
    console.log('[SidePanel] Bridge is offline, not sending abort');
    return;
  }
  try {
    console.log('[SidePanel] Sending abort command to bridge');
    client.sendCommand({ type: 'abort' });
    console.log('[SidePanel] Abort command sent successfully');
  } catch (error) {
    console.error('[SidePanel] Failed to send abort command:', error.message);
    dispatch({ type: 'bridge_error', error: error.message });
    return;
  }
  console.log('[SidePanel] Dispatching abort_sent');
  dispatch({ type: 'abort_sent' });
});

els.cwdPicker.addEventListener('click', async () => {
  try {
    const dirHandle = await window.showDirectoryPicker();
    const path = await resolveCwdPath(dirHandle);
    const isAbsolute = path.startsWith('/') || /^[a-zA-Z]:/.test(path);
    
    selectedCwd = path;
    els.cwdDisplay.textContent = path;
    els.cwdInput.value = path;
    
    // Show warning if path is not absolute (only directory name was resolved)
    els.cwdWarning.hidden = isAbsolute;
    els.cwdInput.hidden = isAbsolute;

    // Fetch sessions only if we have an absolute path
    // If not absolute, the bridge will resolve it via new_session and
    // session_state will fire back with the correct absolute cwd
    fetchSessionsForCwd(isAbsolute ? path : null);

    if (!state.bridgeOnline) {
      dispatch({ type: 'bridge_error', error: 'Bridge is offline — cannot create session' });
      return;
    }
    // Always send the path as-is — the bridge's resolveCwd handles relative paths
    client.sendCommand({ type: 'new_session', cwd: path });
  } catch {
    // User cancelled or API not available
  }
});

// Sync cwd input field with selectedCwd
els.cwdInput.addEventListener('input', () => {
  selectedCwd = els.cwdInput.value;
  els.cwdDisplay.textContent = els.cwdInput.value || 'not set';
});

els.cookies.addEventListener('change', () => client.sendCommand({ type: 'set_cookie_access', enabled: els.cookies.checked }));
els.storage.addEventListener('change', () => client.sendCommand({ type: 'set_storage_access', enabled: els.storage.checked }));

// Session selector change handler
els.sessionSelect.addEventListener('change', () => {
  const value = els.sessionSelect.value;
  if (value === '__new__') {
    // Create new session with current cwd
    const cwd = state.session?.cwd || selectedCwd || els.cwdInput.value;
    if (cwd) {
      lastFetchedCwd = null; // Reset so sessions re-fetch after new session
      client.sendCommand({ type: 'new_session', cwd });
    }
  } else if (value) {
    // Resume session
    client.sendCommand({ type: 'resume_session', sessionPath: value });
  }
});

// ── Theme toggle ──────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('pi-web-ui-theme', theme);
}

function getPreferredTheme() {
  const stored = localStorage.getItem('pi-web-ui-theme');
  if (stored) return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Initialize theme
applyTheme(getPreferredTheme());

els.themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (!localStorage.getItem('pi-web-ui-theme')) {
    applyTheme(e.matches ? 'dark' : 'light');
  }
});

// Model selector
els.modelSelect.addEventListener('change', () => {
  const value = els.modelSelect.value;
  if (value) {
    const [provider, modelId] = value.split('/');
    client.sendCommand({ type: 'set_model', provider, modelId });
  }
});

render();
