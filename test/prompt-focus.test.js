import { describe, expect, it, beforeEach } from 'vitest';
import { createInitialState, reduceSidePanelState } from '../sidepanel-state.js';

// Test the focus restoration logic that lives in the render() function of sidepanel.js.
// The logic:
//   1. When prompt transitions enabled -> disabled, save if it was focused
//   2. When prompt transitions disabled -> enabled, restore focus if it was previously focused
//
// We simulate this logic here since the real code closes over DOM elements.

function simulateRenderFocusLogic(prompt, activeElementRef, promptWasFocusedRef) {
  const willBeDisabled = !activeElementRef.state.bridgeOnline || activeElementRef.state.sending;

  // Save focus state before disabling
  if (!prompt.disabled && willBeDisabled) {
    promptWasFocusedRef.value = activeElementRef.current === prompt;
  }

  // Apply disabled state
  prompt.disabled = willBeDisabled;

  // Restore focus when re-enabled
  if (!willBeDisabled && promptWasFocusedRef.value) {
    promptWasFocusedRef.value = false;
    prompt.focus();
  }
}

describe('prompt focus restoration', () => {
  let prompt;
  let activeElementRef;
  let promptWasFocusedRef;

  beforeEach(() => {
    // Create a mock textarea element
    prompt = { disabled: false, focusCalls: 0, focus: function() { this.focusCalls++; } };
    promptWasFocusedRef = { value: false };
    activeElementRef = { current: prompt, state: { bridgeOnline: true, sending: false } };
  });

  it('saves focused state when prompt is disabled due to sending', () => {
    activeElementRef.current = prompt;
    activeElementRef.state = { bridgeOnline: true, sending: true };

    simulateRenderFocusLogic(prompt, activeElementRef, promptWasFocusedRef);

    expect(prompt.disabled).toBe(true);
    expect(promptWasFocusedRef.value).toBe(true);
  });

  it('restores focus when prompt is re-enabled after model response', () => {
    // First render: disable the prompt (user sent message)
    activeElementRef.current = prompt;
    activeElementRef.state = { bridgeOnline: true, sending: true };
    simulateRenderFocusLogic(prompt, activeElementRef, promptWasFocusedRef);
    expect(prompt.disabled).toBe(true);
    expect(promptWasFocusedRef.value).toBe(true);

    // Focus moves away while disabled (simulated)
    activeElementRef.current = { tagName: 'BODY' };

    // Second render: re-enable the prompt (model responded)
    activeElementRef.state = { bridgeOnline: true, sending: false };
    simulateRenderFocusLogic(prompt, activeElementRef, promptWasFocusedRef);

    expect(prompt.disabled).toBe(false);
    expect(promptWasFocusedRef.value).toBe(false);
    expect(prompt.focusCalls).toBe(1);
  });

  it('does not restore focus if prompt was not focused before disabling', () => {
    activeElementRef.current = { tagName: 'BODY' };
    activeElementRef.state = { bridgeOnline: true, sending: true };
    simulateRenderFocusLogic(prompt, activeElementRef, promptWasFocusedRef);
    expect(prompt.disabled).toBe(true);
    expect(promptWasFocusedRef.value).toBe(false);

    activeElementRef.state = { bridgeOnline: true, sending: false };
    simulateRenderFocusLogic(prompt, activeElementRef, promptWasFocusedRef);

    expect(prompt.disabled).toBe(false);
    expect(prompt.focusCalls).toBe(0);
  });

  it('disables prompt when bridge is offline', () => {
    activeElementRef.current = prompt;
    activeElementRef.state = { bridgeOnline: false, sending: false };

    simulateRenderFocusLogic(prompt, activeElementRef, promptWasFocusedRef);

    expect(prompt.disabled).toBe(true);
    expect(promptWasFocusedRef.value).toBe(true);
  });

  it('restores focus when bridge comes back online', () => {
    activeElementRef.current = prompt;
    activeElementRef.state = { bridgeOnline: false, sending: false };
    simulateRenderFocusLogic(prompt, activeElementRef, promptWasFocusedRef);
    expect(prompt.disabled).toBe(true);

    activeElementRef.current = { tagName: 'BODY' };
    activeElementRef.state = { bridgeOnline: true, sending: false };
    simulateRenderFocusLogic(prompt, activeElementRef, promptWasFocusedRef);

    expect(prompt.disabled).toBe(false);
    expect(prompt.focusCalls).toBe(1);
  });

  it('handles error scenario - restores focus after prompt_error', () => {
    let state = createInitialState();
    state = reduceSidePanelState(state, { type: 'bridge_connected' });
    expect(state.bridgeOnline).toBe(true);
    expect(state.sending).toBe(false);

    state = reduceSidePanelState(state, { type: 'user_message', text: 'Hello' });
    expect(state.sending).toBe(true);

    state = reduceSidePanelState(state, { type: 'prompt_error', message: 'Hello', error: 'Network error' });
    expect(state.sending).toBe(false);
    expect(state.sendError).toBe('Network error');

    activeElementRef.current = prompt;
    activeElementRef.state = { bridgeOnline: state.bridgeOnline, sending: true };
    simulateRenderFocusLogic(prompt, activeElementRef, promptWasFocusedRef);
    expect(prompt.disabled).toBe(true);
    expect(promptWasFocusedRef.value).toBe(true);

    activeElementRef.current = { tagName: 'BODY' };
    activeElementRef.state = { bridgeOnline: state.bridgeOnline, sending: state.sending };
    simulateRenderFocusLogic(prompt, activeElementRef, promptWasFocusedRef);
    expect(prompt.disabled).toBe(false);
    expect(prompt.focusCalls).toBe(1);
  });

  it('handles abort scenario - restores focus after abort_sent', () => {
    let state = createInitialState();
    state = reduceSidePanelState(state, { type: 'bridge_connected' });
    state = reduceSidePanelState(state, { type: 'user_message', text: 'Do something' });
    expect(state.sending).toBe(true);

    state = reduceSidePanelState(state, { type: 'abort_sent' });
    expect(state.sending).toBe(false);

    activeElementRef.current = prompt;
    activeElementRef.state = { bridgeOnline: true, sending: true };
    simulateRenderFocusLogic(prompt, activeElementRef, promptWasFocusedRef);
    activeElementRef.current = { tagName: 'BODY' };
    activeElementRef.state = { bridgeOnline: true, sending: false };
    simulateRenderFocusLogic(prompt, activeElementRef, promptWasFocusedRef);

    expect(prompt.disabled).toBe(false);
    expect(prompt.focusCalls).toBe(1);
  });

  it('full flow: send -> tool_call -> tool_result -> assistant -> focus restored', () => {
    let state = createInitialState();
    state = reduceSidePanelState(state, { type: 'bridge_connected' });

    state = reduceSidePanelState(state, { type: 'user_message', text: 'Read file' });
    expect(state.sending).toBe(true);

    state = reduceSidePanelState(state, { type: 'tool_call', name: 'read_file', params: {} });
    expect(state.sending).toBe(true);

    state = reduceSidePanelState(state, { type: 'tool_result', name: 'read_file', result: 'content' });
    expect(state.sending).toBe(true);

    state = reduceSidePanelState(state, { type: 'assistant_message', text: 'Here is the content' });
    expect(state.sending).toBe(false);

    activeElementRef.current = prompt;
    activeElementRef.state = { bridgeOnline: true, sending: true };
    simulateRenderFocusLogic(prompt, activeElementRef, promptWasFocusedRef);
    expect(prompt.disabled).toBe(true);

    activeElementRef.current = { tagName: 'BODY' };
    activeElementRef.state = { bridgeOnline: true, sending: false };
    simulateRenderFocusLogic(prompt, activeElementRef, promptWasFocusedRef);
    expect(prompt.disabled).toBe(false);
    expect(prompt.focusCalls).toBe(1);
  });

  it('handles multiple send-response cycles', () => {
    // Cycle 1
    activeElementRef.current = prompt;
    activeElementRef.state = { bridgeOnline: true, sending: true };
    simulateRenderFocusLogic(prompt, activeElementRef, promptWasFocusedRef);
    activeElementRef.current = { tagName: 'BODY' };
    activeElementRef.state = { bridgeOnline: true, sending: false };
    simulateRenderFocusLogic(prompt, activeElementRef, promptWasFocusedRef);
    expect(prompt.focusCalls).toBe(1);

    // Cycle 2
    activeElementRef.current = prompt;
    activeElementRef.state = { bridgeOnline: true, sending: true };
    simulateRenderFocusLogic(prompt, activeElementRef, promptWasFocusedRef);
    activeElementRef.current = { tagName: 'BODY' };
    activeElementRef.state = { bridgeOnline: true, sending: false };
    simulateRenderFocusLogic(prompt, activeElementRef, promptWasFocusedRef);
    expect(prompt.focusCalls).toBe(2);
  });
});
