import { describe, expect, it, vi } from 'vitest';
import { createBridgeClient } from '../bridge-client.js';

function createFakeWebSocket({ listeners = {}, sent = [], readyState = 1 } = {}) {
  class FakeWebSocket {
    constructor() { this.readyState = readyState; }
    addEventListener(name, handler) { listeners[name] = handler; }
    send(message) { sent.push(message); }
    close() {}
  }
  return { FakeWebSocket, listeners, sent };
}

describe('bridge client - extension commands', () => {
  it('sends list_resources on connect', () => {
    const { FakeWebSocket, listeners, sent } = createFakeWebSocket();
    const onEvent = vi.fn();

    const client = createBridgeClient({ WebSocketCtor: FakeWebSocket, port: 43117, onEvent });
    client.connect();
    listeners.open();

    expect(sent).toEqual([JSON.stringify({ type: 'list_resources' })]);
  });

  it('receives resources_list event', () => {
    const { FakeWebSocket, listeners } = createFakeWebSocket();
    const onEvent = vi.fn();

    const client = createBridgeClient({ WebSocketCtor: FakeWebSocket, port: 43117, onEvent });
    client.connect();
    listeners.open();

    const resources = {
      type: 'resources_list',
      commands: [{ name: 'persona', description: 'Load a persona', source: 'extension', hasCompletions: true }],
      skills: [{ name: 'git-workflow', description: 'Git best practices' }],
      templates: [{ name: 'review', description: 'Review code', args: ['file', 'focus'] }],
    };
    listeners.message({ data: JSON.stringify(resources) });

    expect(onEvent).toHaveBeenCalledWith(resources);
  });

  it('sends get_completions command', () => {
    const { FakeWebSocket, sent } = createFakeWebSocket();
    const client = createBridgeClient({ WebSocketCtor: FakeWebSocket, port: 43117 });
    client.connect();

    client.sendCommand({ type: 'get_completions', command: 'persona', args: '' });

    expect(sent).toEqual([JSON.stringify({ type: 'get_completions', command: 'persona', args: '' })]);
  });

  it('receives command_completions event', () => {
    const { FakeWebSocket, listeners } = createFakeWebSocket();
    const onEvent = vi.fn();

    const client = createBridgeClient({ WebSocketCtor: FakeWebSocket, port: 43117, onEvent });
    client.connect();
    listeners.open();

    const completions = {
      type: 'command_completions',
      items: [
        { value: 'x', label: 'x', description: 'Persona x' },
        { value: 'y', label: 'y', description: 'Persona y' },
      ],
    };
    listeners.message({ data: JSON.stringify(completions) });

    expect(onEvent).toHaveBeenCalledWith(completions);
  });

  it('receives extension_command_error event', () => {
    const { FakeWebSocket, listeners } = createFakeWebSocket();
    const onEvent = vi.fn();

    const client = createBridgeClient({ WebSocketCtor: FakeWebSocket, port: 43117, onEvent });
    client.connect();
    listeners.open();

    const error = {
      type: 'extension_command_error',
      command: 'unknown-cmd',
      error: 'Command not found',
    };
    listeners.message({ data: JSON.stringify(error) });

    expect(onEvent).toHaveBeenCalledWith(error);
  });

  it('sends list_resources after reconnection', async () => {
    vi.useFakeTimers();
    const connectCalls = [];
    const sockets = [];
    const allSent = [];
    class FakeWebSocket {
      constructor(url) {
        this.readyState = 1;
        this._sent = [];
        sockets.push(this);
        connectCalls.push(url);
      }
      addEventListener(name, handler) {
        if (name === 'open') handler();
        if (name === 'close') this._onClose = handler;
      }
      send(message) { this._sent.push(message); allSent.push({ socket: this, message }); }
      close() {}
    }

    const client = createBridgeClient({ WebSocketCtor: FakeWebSocket, port: 43117 });
    client.connect();
    // First connect sends list_resources
    const firstSent = sockets[0]._sent;
    expect(firstSent).toEqual([JSON.stringify({ type: 'list_resources' })]);

    // Trigger close and reconnect
    sockets[0]._onClose({ code: 1006, reason: '' });
    await vi.advanceTimersByTimeAsync(2000);

    // Second connect also sends list_resources
    const secondSent = sockets[1]._sent;
    expect(secondSent).toEqual([JSON.stringify({ type: 'list_resources' })]);

    vi.useRealTimers();
  });
});
