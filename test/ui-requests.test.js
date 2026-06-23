import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createInitialState, reduceSidePanelState } from '../sidepanel-state.js';

describe('side panel UI requests', () => {
  it('tracks extension UI requests and notifications', () => {
    let state = reduceSidePanelState(createInitialState(), { id: 'ui-1', type: 'extension_ui_request', kind: 'confirm', message: 'Proceed?' });
    expect(state.uiRequests).toMatchObject([{ id: 'ui-1', kind: 'confirm', message: 'Proceed?' }]);
    expect(state.uiRequests[0].createdAt).toBeTypeOf('number');
    state = reduceSidePanelState(state, { type: 'extension_ui_notify', message: 'Done' });
    expect(state.notifications).toEqual(['Done']);
    state = reduceSidePanelState(state, { type: 'extension_ui_response_sent', id: 'ui-1' });
    expect(state.uiRequests).toEqual([]);
  });

  it('captures createdAt timestamp on extension_ui_request', () => {
    const before = Date.now();
    const state = reduceSidePanelState(createInitialState(), {
      id: 'ui-1',
      type: 'extension_ui_request',
      kind: 'confirm',
      message: 'Proceed?',
    });
    const after = Date.now();

    expect(state.uiRequests[0].createdAt).toBeGreaterThanOrEqual(before);
    expect(state.uiRequests[0].createdAt).toBeLessThanOrEqual(after);
  });

  it('removes request on extension_ui_request_timeout', () => {
    let state = reduceSidePanelState(createInitialState(), {
      id: 'ui-1',
      type: 'extension_ui_request',
      kind: 'confirm',
      message: 'Proceed?',
    });
    expect(state.uiRequests).toHaveLength(1);

    state = reduceSidePanelState(state, { type: 'extension_ui_request_timeout', id: 'ui-1' });
    expect(state.uiRequests).toEqual([]);
  });

  it('keeps other requests when one times out', () => {
    let state = createInitialState();
    state = reduceSidePanelState(state, { id: 'ui-1', type: 'extension_ui_request', kind: 'confirm', message: 'First?' });
    state = reduceSidePanelState(state, { id: 'ui-2', type: 'extension_ui_request', kind: 'select', message: 'Choose?', options: ['a', 'b'] });

    state = reduceSidePanelState(state, { type: 'extension_ui_request_timeout', id: 'ui-1' });
    expect(state.uiRequests).toHaveLength(1);
    expect(state.uiRequests[0].id).toBe('ui-2');
  });

  it('adds timeout notification on extension_ui_request_timeout', () => {
    let state = reduceSidePanelState(createInitialState(), {
      id: 'ui-1',
      type: 'extension_ui_request',
      kind: 'confirm',
      message: 'Proceed?',
    });
    state = reduceSidePanelState(state, { type: 'extension_ui_request_timeout', id: 'ui-1' });

    expect(state.notifications).toEqual(['⏱ Dialog timed out']);
  });

  it('preserves existing notifications when timeout occurs', () => {
    let state = reduceSidePanelState(createInitialState(), {
      type: 'extension_ui_notify',
      message: 'Previous notification',
    });
    state = reduceSidePanelState(state, { id: 'ui-1', type: 'extension_ui_request', kind: 'confirm', message: 'Proceed?' });
    state = reduceSidePanelState(state, { type: 'extension_ui_request_timeout', id: 'ui-1' });

    expect(state.notifications).toEqual([
      'Previous notification',
      '⏱ Dialog timed out',
    ]);
  });

  it('ignores timeout for unknown request id', () => {
    const state = reduceSidePanelState(createInitialState(), {
      type: 'extension_ui_request_timeout',
      id: 'nonexistent',
    });
    expect(state.uiRequests).toEqual([]);
    expect(state.notifications).toEqual([]);
  });

  it('captures options on select kind request', () => {
    const state = reduceSidePanelState(createInitialState(), {
      id: 'ui-1',
      type: 'extension_ui_request',
      kind: 'select',
      message: 'Choose?',
      options: ['alpha', 'beta', 'gamma'],
    });
    expect(state.uiRequests[0].options).toEqual(['alpha', 'beta', 'gamma']);
  });
});
