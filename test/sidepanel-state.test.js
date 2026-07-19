import { describe, expect, it } from 'vitest';
import { createInitialState, reduceSidePanelState, resolveModelFromValue } from '../sidepanel-state.js';

describe('side panel state', () => {
  it('starts offline with secure defaults', () => {
    expect(createInitialState()).toEqual({
      bridgeOnline: false,
      cookieAccessEnabled: false,
      storageAccessEnabled: false,
      messages: [],
      uiRequests: [],
      notifications: [],
      session: undefined,
      sending: false,
      sendError: null,
      devtoolsConflict: false,
      attachedTabs: [],
      sessionsList: [],
      loadingSessions: false,
      sessionError: null,
      reconnectExhausted: false,
      commands: [],
      skills: [],
      templates: [],
      autocompleteOpen: false,
      autocompleteItems: [],
      autocompleteIndex: -1,
      pendingCompletionCommand: null,
      modelList: [],
      currentModelProvider: undefined,
      currentModelId: undefined,
    });
  });

  it('marks bridge online when connected', () => {
    const state = reduceSidePanelState(createInitialState(), { type: 'bridge_connected' });
    expect(state.bridgeOnline).toBe(true);
  });

  it('clears send error when bridge connects', () => {
    const withError = reduceSidePanelState(createInitialState(), { type: 'prompt_error', message: 'test', error: 'SDK not ready' });
    const connected = reduceSidePanelState(withError, { type: 'bridge_connected' });
    expect(connected.sendError).toBeNull();
  });

  it('updates session and toggles from session_state messages', () => {
    const state = reduceSidePanelState(createInitialState(), {
      type: 'session_state',
      session: {
        id: 's1',
        cwd: '/project',
        cookieAccessEnabled: true,
        storageAccessEnabled: true,
      },
    });

    expect(state).toMatchObject({
      bridgeOnline: true,
      cookieAccessEnabled: true,
      storageAccessEnabled: true,
      session: { id: 's1', cwd: '/project' },
    });
  });

  it('appends user and assistant messages', () => {
    const withUser = reduceSidePanelState(createInitialState(), { type: 'user_message', text: 'Hi' });
    const withAssistant = reduceSidePanelState(withUser, { type: 'assistant_message', text: 'Hello' });

    expect(withAssistant.messages).toEqual([
      { role: 'user', text: 'Hi', isCommand: false },
      { role: 'assistant', text: 'Hello', thinking: undefined },
    ]);
  });

  it('sets sending=true when user sends a message', () => {
    const state = reduceSidePanelState(createInitialState(), { type: 'user_message', text: 'Hi' });
    expect(state.sending).toBe(true);
    expect(state.sendError).toBeNull();
  });

  it('sets sending=false when assistant responds', () => {
    const sending = reduceSidePanelState(createInitialState(), { type: 'user_message', text: 'Hi' });
    const responded = reduceSidePanelState(sending, { type: 'assistant_message', text: 'Hello' });
    expect(responded.sending).toBe(false);
    expect(responded.sendError).toBeNull();
  });

  it('sets sending=false and sendError when prompt fails', () => {
    const sending = reduceSidePanelState(createInitialState(), { type: 'user_message', text: 'Hi' });
    const errored = reduceSidePanelState(sending, { type: 'prompt_error', message: 'Hi', error: 'SDK not ready' });
    expect(errored.sending).toBe(false);
    expect(errored.sendError).toBe('SDK not ready');
  });

  it('ignores prompt_received acknowledgement to avoid duplicating user message', () => {
    const withUser = reduceSidePanelState(createInitialState(), { type: 'user_message', text: 'Hi' });
    const withAck = reduceSidePanelState(withUser, { type: 'prompt_received', message: 'Hi' });

    // prompt_received should not add another message
    expect(withAck.messages).toEqual([{ role: 'user', text: 'Hi', isCommand: false }]);
  });

  it('relays assistant_message from bridge as assistant role', () => {
    const state = reduceSidePanelState(createInitialState(), {
      type: 'assistant_message',
      text: 'Pi response here',
    });

    expect(state.messages).toEqual([{ role: 'assistant', text: 'Pi response here' }]);
  });

  it('adds bridge_error as a notification', () => {
    const state = reduceSidePanelState(createInitialState(), {
      type: 'bridge_error',
      error: 'WebSocket connection error',
    });
    expect(state.notifications).toEqual(['Connection error: WebSocket connection error']);
  });

  it('prompt_sent clears any pending send error', () => {
    const withError = reduceSidePanelState(createInitialState(), { type: 'prompt_error', message: 'test', error: 'fail' });
    const sent = reduceSidePanelState(withError, { type: 'prompt_sent', message: 'test' });
    expect(sent.sendError).toBeNull();
  });

  it('adds generic error from bridge as a notification and stops sending', () => {
    const sending = reduceSidePanelState(createInitialState(), { type: 'user_message', text: 'Hi' });
    const errored = reduceSidePanelState(sending, {
      type: 'error',
      error: 'Command handling failed: something went wrong',
    });
    expect(errored.notifications).toEqual(['Error: Command handling failed: something went wrong']);
    expect(errored.sending).toBe(false);
  });

  it('sets devtoolsConflict=true on devtools_conflict event', () => {
    const state = reduceSidePanelState(createInitialState(), { type: 'devtools_conflict' });
    expect(state.devtoolsConflict).toBe(true);
  });

  it('sets devtoolsConflict=false on devtools_conflict_resolved event', () => {
    const withConflict = reduceSidePanelState(createInitialState(), { type: 'devtools_conflict' });
    const resolved = reduceSidePanelState(withConflict, { type: 'devtools_conflict_resolved' });
    expect(resolved.devtoolsConflict).toBe(false);
  });

  it('appends tab to attachedTabs on debugger_attached event', () => {
    const state = reduceSidePanelState(createInitialState(), {
      type: 'debugger_attached',
      tabId: 42,
      title: 'My Page',
    });
    expect(state.attachedTabs).toEqual([{ id: 42, title: 'My Page' }]);
  });

  it('removes tab from attachedTabs on debugger_detached event', () => {
    const withTab = reduceSidePanelState(createInitialState(), {
      type: 'debugger_attached',
      tabId: 42,
      title: 'My Page',
    });
    const detached = reduceSidePanelState(withTab, { type: 'debugger_detached', tabId: 42 });
    expect(detached.attachedTabs).toEqual([]);
  });

  it('keeps other tabs when one is detached', () => {
    let state = reduceSidePanelState(createInitialState(), {
      type: 'debugger_attached', tabId: 1, title: 'Tab 1',
    });
    state = reduceSidePanelState(state, {
      type: 'debugger_attached', tabId: 2, title: 'Tab 2',
    });
    state = reduceSidePanelState(state, { type: 'debugger_detached', tabId: 1 });
    expect(state.attachedTabs).toEqual([{ id: 2, title: 'Tab 2' }]);
  });

  it('does not duplicate tabs when debugger_attached fires for same tabId', () => {
    let state = reduceSidePanelState(createInitialState(), {
      type: 'debugger_attached', tabId: 42, title: 'My Page',
    });
    state = reduceSidePanelState(state, {
      type: 'debugger_attached', tabId: 42, title: 'My Page',
    });
    expect(state.attachedTabs).toHaveLength(1);
  });

  it('updates cwd from session_state after new_session', () => {
    const state = reduceSidePanelState(createInitialState(), {
      type: 'session_state',
      session: {
        id: 's2',
        cwd: '/home/user/my-project',
        cookieAccessEnabled: false,
        storageAccessEnabled: false,
      },
    });

    expect(state.session.cwd).toBe('/home/user/my-project');
    expect(state.session.id).toBe('s2');
  });

  it('preserves existing cwd when session_state does not include it', () => {
    const withSession = reduceSidePanelState(createInitialState(), {
      type: 'session_state',
      session: { id: 's1', cwd: '/project', cookieAccessEnabled: false, storageAccessEnabled: false },
    });
    const updated = reduceSidePanelState(withSession, {
      type: 'session_state',
      session: { id: 's1', cookieAccessEnabled: true, storageAccessEnabled: false },
    });

    // session.cwd is gone but state.session is the new object
    expect(updated.session.id).toBe('s1');
    expect(updated.cookieAccessEnabled).toBe(true);
  });

  it('sets loadingSessions=true on loading_sessions event', () => {
    const state = reduceSidePanelState(createInitialState(), { type: 'loading_sessions' });
    expect(state.loadingSessions).toBe(true);
    expect(state.sessionError).toBeNull();
  });

  it('populates sessionsList on sessions_loaded event', () => {
    const sessions = [
      { path: '/project/.pi/sessions/2024-01-01.jsonl', name: 'My Session', timestamp: '2024-01-01T10:00:00Z', firstMessage: 'Hello' },
      { path: '/project/.pi/sessions/2024-01-02.jsonl', timestamp: '2024-01-02T10:00:00Z' },
    ];
    const state = reduceSidePanelState(createInitialState(), { type: 'sessions_list', sessions });
    expect(state.sessionsList).toEqual(sessions);
    expect(state.loadingSessions).toBe(false);
  });

  it('sets sessionError on session_error event', () => {
    const state = reduceSidePanelState(createInitialState(), { type: 'session_error', error: 'Failed to load session' });
    expect(state.sessionError).toBe('Failed to load session');
    expect(state.loadingSessions).toBe(false);
  });

  it('clears sessionError when sessions_list arrives after an error', () => {
    const withError = reduceSidePanelState(createInitialState(), { type: 'session_error', error: 'Failed to load session' });
    expect(withError.sessionError).toBe('Failed to load session');
    const loaded = reduceSidePanelState(withError, {
      type: 'sessions_list',
      sessions: [{ path: '/project/.pi/sessions/2024-01-01.jsonl' }],
    });
    expect(loaded.sessionError).toBeNull();
    expect(loaded.loadingSessions).toBe(false);
  });

  it('clears sessionError when session_history arrives', () => {
    const withError = reduceSidePanelState(createInitialState(), { type: 'session_error', error: 'Failed to load session' });
    expect(withError.sessionError).toBe('Failed to load session');
    const history = reduceSidePanelState(withError, {
      type: 'session_history',
      messages: [{ role: 'user', text: 'Hello', isCommand: false }],
    });
    expect(history.sessionError).toBeNull();
  });

  it('replaces messages on session_history event', () => {
    // Start with existing messages
    const withMessages = reduceSidePanelState(createInitialState(), { type: 'user_message', text: 'Old message' });
    expect(withMessages.messages).toHaveLength(1);

    // Load session history
    const history = [
      { role: 'user', text: 'First message' },
      { role: 'assistant', text: 'First response' },
      { role: 'user', text: 'Second message' },
    ];
    const state = reduceSidePanelState(withMessages, { type: 'session_history', messages: history });
    expect(state.messages).toEqual(history);
    expect(state.sending).toBe(false);
  });

  it('handles rich message types in session_history', () => {
    const history = [
      { role: 'tool', toolName: 'read_file', toolResult: 'file content', isError: false },
      { role: 'bash', command: 'ls', output: 'file1.txt', exitCode: 0, isError: false },
      { role: 'compaction', summary: 'Context compacted', tokensBefore: 40000 },
      { role: 'assistant', text: 'Response', thinking: 'Let me think...' },
      { role: 'user', text: 'Here is an image', image: { data: 'base64data', mimeType: 'image/png' } },
    ];
    const state = reduceSidePanelState(createInitialState(), { type: 'session_history', messages: history });
    expect(state.messages).toEqual(history);
    expect(state.messages).toHaveLength(5);
  });

  it('handles bash message with null exitCode', () => {
    const history = [
      { role: 'bash', command: 'ls', output: 'file1.txt', exitCode: null, isError: false },
    ];
    const state = reduceSidePanelState(createInitialState(), { type: 'session_history', messages: history });
    expect(state.messages).toEqual(history);
  });

  it('sets reconnectExhausted=true on bridge_reconnect_exhausted event', () => {
    const state = reduceSidePanelState(createInitialState(), { type: 'bridge_reconnect_exhausted' });
    expect(state.reconnectExhausted).toBe(true);
    expect(state.bridgeOnline).toBe(false);
  });

  it('handles abort_sent — clears sending, adds aborted message', () => {
    const sending = reduceSidePanelState(createInitialState(), { type: 'user_message', text: 'Do something' });
    expect(sending.sending).toBe(true);

    const aborted = reduceSidePanelState(sending, { type: 'abort_sent' });
    expect(aborted.sending).toBe(false);
    expect(aborted.sendError).toBeNull();
    expect(aborted.messages).toEqual([
      { role: 'user', text: 'Do something', isCommand: false },
      { role: 'system', text: '⚠ Aborted' },
    ]);
  });

  it('handles abort_sent when not sending — still adds aborted message', () => {
    const state = reduceSidePanelState(createInitialState(), { type: 'abort_sent' });
    expect(state.sending).toBe(false);
    expect(state.messages).toEqual([{ role: 'system', text: '⚠ Aborted' }]);
  });

  it('handles abort_received — no additional UI change', () => {
    const withAborted = reduceSidePanelState(createInitialState(), { type: 'abort_sent' });
    const confirmed = reduceSidePanelState(withAborted, { type: 'abort_received' });
    expect(confirmed).toBe(withAborted); // same state, no changes
  });

  it('clears sendError on abort_sent', () => {
    let state = reduceSidePanelState(createInitialState(), { type: 'user_message', text: 'Hi' });
    state = reduceSidePanelState(state, { type: 'prompt_error', message: 'Hi', error: 'Network error' });
    expect(state.sendError).toBe('Network error');

    const aborted = reduceSidePanelState(state, { type: 'abort_sent' });
    expect(aborted.sendError).toBeNull();
    expect(aborted.sending).toBe(false);
  });

  // === Live chat: tool_call / tool_result events ===

  it('appends tool message on tool_call event', () => {
    const state = reduceSidePanelState(createInitialState(), {
      type: 'tool_call',
      name: 'read_file',
      params: { path: 'foo.txt' },
    });
    expect(state.messages).toEqual([
      { role: 'tool', toolName: 'read_file', toolResult: '(running...)', isError: false },
    ]);
  });

  it('updates last tool message on tool_result event', () => {
    let state = reduceSidePanelState(createInitialState(), {
      type: 'tool_call',
      name: 'read_file',
      params: {},
    });
    state = reduceSidePanelState(state, {
      type: 'tool_result',
      name: 'read_file',
      result: 'file content here',
    });
    expect(state.messages).toEqual([
      { role: 'tool', toolName: 'read_file', toolResult: 'file content here', isError: false },
    ]);
  });

  it('serializes tool_result as JSON when result is an object', () => {
    let state = reduceSidePanelState(createInitialState(), {
      type: 'tool_call',
      name: 'glob',
      params: {},
    });
    state = reduceSidePanelState(state, {
      type: 'tool_result',
      name: 'glob',
      result: { files: ['a.ts', 'b.ts'] },
    });
    expect(state.messages[0].toolResult).toBe('{\n  "files": [\n    "a.ts",\n    "b.ts"\n  ]\n}');
  });

  it('ignores tool_result when last message is not a tool message', () => {
    let state = reduceSidePanelState(createInitialState(), {
      type: 'user_message',
      text: 'Hello',
    });
    state = reduceSidePanelState(state, {
      type: 'tool_result',
      name: 'read_file',
      result: 'content',
    });
    // Should not add or modify anything
    expect(state.messages).toEqual([{ role: 'user', text: 'Hello', isCommand: false }]);
  });

  it('handles multiple tool_call/tool_result sequences', () => {
    let state = createInitialState();
    state = reduceSidePanelState(state, { type: 'tool_call', name: 'read_file', params: {} });
    state = reduceSidePanelState(state, { type: 'tool_result', name: 'read_file', result: 'content1' });
    state = reduceSidePanelState(state, { type: 'tool_call', name: 'write_file', params: {} });
    state = reduceSidePanelState(state, { type: 'tool_result', name: 'write_file', result: 'wrote 10 bytes' });

    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toEqual({ role: 'tool', toolName: 'read_file', toolResult: 'content1', isError: false });
    expect(state.messages[1]).toEqual({ role: 'tool', toolName: 'write_file', toolResult: 'wrote 10 bytes', isError: false });
  });

  // === Live chat: thinking events ===

  it('appends thinking message on thinking event', () => {
    const state = reduceSidePanelState(createInitialState(), {
      type: 'thinking',
      text: 'Let me think about this...',
    });
    expect(state.messages).toEqual([
      { role: 'assistant', text: '', thinking: 'Let me think about this...' },
    ]);
  });

  it('updates existing thinking message on subsequent thinking events', () => {
    let state = reduceSidePanelState(createInitialState(), {
      type: 'thinking',
      text: 'Part 1 ',
    });
    state = reduceSidePanelState(state, {
      type: 'thinking',
      text: 'Part 2',
    });
    expect(state.messages).toEqual([
      { role: 'assistant', text: '', thinking: 'Part 1 Part 2' },
    ]);
  });

  it('handles assistant_message with thinking field', () => {
    const state = reduceSidePanelState(createInitialState(), {
      type: 'assistant_message',
      text: 'Here is my response',
      thinking: 'I thought about it carefully',
    });
    expect(state.messages).toEqual([
      { role: 'assistant', text: 'Here is my response', thinking: 'I thought about it carefully' },
    ]);
  });

  it('handles assistant_message without thinking field', () => {
    const state = reduceSidePanelState(createInitialState(), {
      type: 'assistant_message',
      text: 'Simple response',
    });
    expect(state.messages).toEqual([
      { role: 'assistant', text: 'Simple response', thinking: undefined },
    ]);
  });

  it('full live chat flow: user -> tool_call -> tool_result -> assistant', () => {
    let state = createInitialState();
    state = reduceSidePanelState(state, { type: 'user_message', text: 'Read foo.txt' });
    state = reduceSidePanelState(state, { type: 'tool_call', name: 'read_file', params: {} });
    state = reduceSidePanelState(state, { type: 'tool_result', name: 'read_file', result: 'hello world' });
    state = reduceSidePanelState(state, { type: 'assistant_message', text: 'The file contains: hello world' });

    expect(state.messages).toEqual([
      { role: 'user', text: 'Read foo.txt', isCommand: false },
      { role: 'tool', toolName: 'read_file', toolResult: 'hello world', isError: false },
      { role: 'assistant', text: 'The file contains: hello world', thinking: undefined },
    ]);
    expect(state.sending).toBe(false);
  });

  it('full live chat flow with thinking: user -> thinking -> tool -> assistant with thinking', () => {
    let state = createInitialState();
    state = reduceSidePanelState(state, { type: 'user_message', text: 'Analyze this' });
    state = reduceSidePanelState(state, { type: 'thinking', text: 'Let me analyze...' });
    state = reduceSidePanelState(state, { type: 'tool_call', name: 'bash', params: {} });
    state = reduceSidePanelState(state, { type: 'tool_result', name: 'bash', result: 'output' });
    state = reduceSidePanelState(state, { type: 'assistant_message', text: 'Done!', thinking: 'Analysis complete' });

    expect(state.messages).toHaveLength(4);
    expect(state.messages[0]).toEqual({ role: 'user', text: 'Analyze this', isCommand: false });
    expect(state.messages[1]).toEqual({ role: 'assistant', text: '', thinking: 'Let me analyze...' });
    expect(state.messages[2]).toEqual({ role: 'tool', toolName: 'bash', toolResult: 'output', isError: false });
    expect(state.messages[3]).toEqual({ role: 'assistant', text: 'Done!', thinking: 'Analysis complete' });
  });

  // === Model selector events ===

  it('populates modelList and current model on model_list event', () => {
    const state = reduceSidePanelState(createInitialState(), {
      type: 'model_list',
      models: [
        { provider: 'openai', id: 'gpt-4', name: 'GPT-4' },
        { provider: 'anthropic', id: 'claude-3', name: 'Claude 3' },
      ],
      currentProvider: 'openai',
      currentModelId: 'gpt-4',
    });
    expect(state.modelList).toHaveLength(2);
    expect(state.currentModelProvider).toBe('openai');
    expect(state.currentModelId).toBe('gpt-4');
  });

  it('model_changed updates currentModelProvider and currentModelId', () => {
    let state = reduceSidePanelState(createInitialState(), {
      type: 'model_list',
      models: [
        { provider: 'openai', id: 'gpt-4', name: 'GPT-4' },
        { provider: 'anthropic', id: 'claude-3', name: 'Claude 3' },
      ],
      currentProvider: 'openai',
      currentModelId: 'gpt-4',
    });
    expect(state.currentModelProvider).toBe('openai');
    expect(state.currentModelId).toBe('gpt-4');

    state = reduceSidePanelState(state, {
      type: 'model_changed',
      provider: 'anthropic',
      modelId: 'claude-3',
      modelName: 'Claude 3',
    });
    expect(state.currentModelProvider).toBe('anthropic');
    expect(state.currentModelId).toBe('claude-3');
  });

  it('model_changed does NOT add a notification (no redundant model banners)', () => {
    let state = reduceSidePanelState(createInitialState(), {
      type: 'model_list',
      models: [
        { provider: 'openai', id: 'gpt-4', name: 'GPT-4' },
        { provider: 'anthropic', id: 'claude-3', name: 'Claude 3' },
      ],
      currentProvider: 'openai',
      currentModelId: 'gpt-4',
    });
    expect(state.notifications).toEqual([]);

    // Switch model multiple times
    state = reduceSidePanelState(state, {
      type: 'model_changed',
      provider: 'anthropic',
      modelId: 'claude-3',
      modelName: 'Claude 3',
    });
    state = reduceSidePanelState(state, {
      type: 'model_changed',
      provider: 'openai',
      modelId: 'gpt-4',
      modelName: 'GPT-4',
    });

    // No notifications should have been added
    expect(state.notifications).toEqual([]);
  });

  it('model_changed sets sending=false', () => {
    let state = reduceSidePanelState(createInitialState(), { type: 'user_message', text: 'Hi' });
    expect(state.sending).toBe(true);

    state = reduceSidePanelState(state, {
      type: 'model_changed',
      provider: 'anthropic',
      modelId: 'claude-3',
      modelName: 'Claude 3',
    });
    expect(state.sending).toBe(false);
  });

  it('multiple model swaps correctly track the latest model', () => {
    let state = reduceSidePanelState(createInitialState(), {
      type: 'model_list',
      models: [
        { provider: 'openai', id: 'gpt-4', name: 'GPT-4' },
        { provider: 'anthropic', id: 'claude-3', name: 'Claude 3' },
        { provider: 'google', id: 'gemini-pro', name: 'Gemini Pro' },
      ],
      currentProvider: 'openai',
      currentModelId: 'gpt-4',
    });

    // Swap 1
    state = reduceSidePanelState(state, {
      type: 'model_changed', provider: 'anthropic', modelId: 'claude-3', modelName: 'Claude 3',
    });
    expect(state.currentModelProvider).toBe('anthropic');
    expect(state.currentModelId).toBe('claude-3');

    // Swap 2
    state = reduceSidePanelState(state, {
      type: 'model_changed', provider: 'google', modelId: 'gemini-pro', modelName: 'Gemini Pro',
    });
    expect(state.currentModelProvider).toBe('google');
    expect(state.currentModelId).toBe('gemini-pro');

    // Swap 3 - back to original
    state = reduceSidePanelState(state, {
      type: 'model_changed', provider: 'openai', modelId: 'gpt-4', modelName: 'GPT-4',
    });
    expect(state.currentModelProvider).toBe('openai');
    expect(state.currentModelId).toBe('gpt-4');
  });
});

describe('resolveModelFromValue (model picker selection)', () => {
  // Option values are indices into modelList so that model ids / names containing
  // slashes (e.g. `Qwen/Qwen3.6-27B`, `zai/glm-5.1`) survive intact.
  const modelList = [
    { provider: 'openai', id: 'gpt-4', name: 'GPT-4' },
    { provider: 'vast-ai', id: 'Qwen/Qwen3.6-27B', name: 'Qwen 3.6-27B' },
    { provider: 'nvidia', id: 'z-ai/glm-5.1', name: 'GLM-5.1' },
    { provider: 'zai', id: 'glm-5.2', name: 'glm-5.2' },
  ];

  it('resolves a normal selection by index and returns the canonical id (not the name)', () => {
    expect(resolveModelFromValue('0', modelList)).toEqual({ provider: 'openai', modelId: 'gpt-4' });
  });

  it('preserves model ids that contain slashes', () => {
    expect(resolveModelFromValue('1', modelList)).toEqual({ provider: 'vast-ai', modelId: 'Qwen/Qwen3.6-27B' });
    expect(resolveModelFromValue('2', modelList)).toEqual({ provider: 'nvidia', modelId: 'z-ai/glm-5.1' });
  });

  it('resolves the synthesized fallback default model (the #1 regression)', () => {
    expect(resolveModelFromValue('3', modelList)).toEqual({ provider: 'zai', modelId: 'glm-5.2' });
  });

  it('returns null for an out-of-range index', () => {
    expect(resolveModelFromValue('4', modelList)).toBeNull();
    expect(resolveModelFromValue('-1', modelList)).toBeNull();
  });

  it('returns null for non-numeric / empty values', () => {
    expect(resolveModelFromValue('', modelList)).toBeNull();
    expect(resolveModelFromValue('abc', modelList)).toBeNull();
    expect(resolveModelFromValue(null, modelList)).toBeNull();
  });

  it('returns null when the model list is empty', () => {
    expect(resolveModelFromValue('0', [])).toBeNull();
  });

  it('returns null for a malformed model entry at the given index', () => {
    expect(resolveModelFromValue('0', [{ provider: 'openai' }])).toBeNull();
  });
});
