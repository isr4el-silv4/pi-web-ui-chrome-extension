# Pi Commands on Chrome Extension

## Problem

When the user types `/persona some-persona` in the Pi terminal, the TUI's input pipeline intercepts the message, resolves it to a registered extension command, and executes its handler with full `ExtensionCommandContext` (UI dialogs, session control, etc.).

When the same message is sent from the Chrome extension, it flows as:

```
Chrome Extension → WebSocket → Bridge → sdkSession.prompt(message) → Pi SDK AgentSession
```

The bridge creates the `AgentSession` **without calling `bindExtensions()`**, so:

- Extension commands are never resolved — `/persona` is sent as literal text to the LLM
- Skills (`/skill:name`) and prompt templates (`/template args`) don't expand
- There's no autocomplete, no validation, and no error feedback

## Root Cause

`AgentSession.prompt()` *does* handle slash commands internally via `_tryExecuteExtensionCommand()`. But that method queries `this._extensionRunner.getCommand(name)`, and the extension runner is empty because `bindExtensions()` was never called.

The bridge's `sdk-session.ts` creates the session and returns it:

```typescript
const session = extractSession(await sdk.createAgentSession({ ... }));
return session; // ← no bindExtensions()
```

## Solution

Build a **translation layer** that implements `ExtensionUIContext` and `ExtensionCommandContextActions`, then call `session.bindExtensions()` with them. This wires the full Pi extension lifecycle into the bridge — extension commands execute, their `ctx.ui` calls route to the Chrome extension via WebSocket, and session control methods delegate back to the bridge.

```
┌──────────────────────────────┐       WS        ┌──────────────────────────────┐
│  Pi Extension Runtime        │◄───────────────►│  Chrome Extension            │
│  (inside bridge process)     │                 │  (side panel)                │
│                              │                 │                              │
│  ExtensionRunner             │                 │  Prompt input                │
│  ┌────────────────────────┐  │  WS broadcast   │  ┌────────────────────────┐  │
│  │ command.handler(args)  │  │◄────────────────│  │ /persona [autocomplete] │  │
│  │   ctx.ui.confirm()     │  │                 │  │ [dropdown]             │  │
│  │   ctx.ui.select()      │  │  WS request     │  │                        │  │
│  │   ctx.waitForIdle()    │  │────────────────►│  │ [confirm dialog card]  │  │
│  └────────────────────────┘  │                 │  └────────────────────────┘  │
│  WebUiContext  ◄────────────┘                 │                              │
│  CommandContextActions                        │  Autocomplete engine         │
└──────────────────────────────┘                 │  Command validation          │
```

## Architecture

### Bridge-Side Components

#### `WebUiContext` — `ExtensionUIContext` implementation

Delegates all UI operations to the Chrome extension via WebSocket.

| Method | Behavior |
|---|---|
| `notify(msg, type)` | Fire-and-forget: broadcast `{ type: 'extension_ui_notify', message }` |
| `confirm(title, message)` | Send `extension_ui_request` with `kind: 'confirm'`, await `extension_ui_response`, return `Boolean(value)` |
| `select(title, options)` | Send `extension_ui_request` with `kind: 'select'` + `options`, await response, return selected value |
| `input(title, placeholder)` | Send `extension_ui_request` with `kind: 'input'`, await response, return text |
| `custom()` | Returns `undefined` (TUI-only, not supported) |
| `setStatus`, `setWidget`, `setFooter`, etc. | No-ops (TUI-specific) |
| `theme` | Minimal default theme object |

**Timeout:** Interactive methods (`confirm`, `select`, `input`) resolve with defaults after 30 seconds if no response arrives:

| Method | Default on timeout |
|---|---|
| `confirm()` | `false` |
| `select()` | `undefined` |
| `input()` | `undefined` |

Pending requests are tracked in a `Map<string, { resolve, reject, timer }>`. On `session_shutdown`, all pending requests are rejected.

#### `CommandContextActions` — `ExtensionCommandContextActions` implementation

Delegates session control to the bridge's existing command handler.

| Method | Implementation |
|---|---|
| `waitForIdle()` | Poll `session.isStreaming` every 100ms until `false` (60s max timeout) |
| `newSession()` | Call `handleClientCommand({ type: 'new_session', cwd })`, return `{ cancelled: false }` |
| `switchSession(path)` | Call `handleClientCommand({ type: 'resume_session', sessionPath })`, return `{ cancelled: false }` |
| `fork(entryId)` | Return `{ cancelled: true }` (not yet supported) |
| `navigateTree(targetId)` | Return `{ cancelled: true }` (not yet supported) |
| `reload()` | Call `session.reload()` if available |

#### Wiring

After `createAgentSession()` in `sdk-session.ts`:

```
session.bindExtensions({
  uiContext: createWebUiContext(broadcast),
  mode: 'rpc',
  commandContextActions: createCommandContextActions(session, onSessionChange),
  onError: (err) => broadcast({ type: 'extension_ui_notify', message: err.error }),
});
```

### Chrome-Side Components

#### Resource Discovery

On bridge connect, the extension sends `list_resources` and receives back:

```json
{
  "type": "resources_list",
  "commands": [{ "name": "persona", "description": "Load a persona", "hasCompletions": true }],
  "skills": [{ "name": "git-workflow", "description": "Git best practices" }],
  "templates": [{ "name": "review", "description": "Review code", "args": ["file", "focus"] }]
}
```

#### Autocomplete Engine

Triggers on every input change (150ms debounce) when the textarea value starts with `/`.

**Command name completion** (no space yet):

1. Filter `commands`, `skills` (`skill:name`), and `templates` by prefix match
2. Build items: `{ label: '/name', value: '/name ', description, type }`

**Argument completion** (space found):

1. Extract command name and current args text
2. Send `get_completions` to bridge with `{ command, args }`
3. Bridge looks up the command's `getArgumentCompletions(prefix)` and returns results
4. Build items from response

**Keyboard navigation:**

| Key | Behavior |
|---|---|
| `↑` / `↓` | Navigate items (wraps) |
| `Tab` | Accept highlighted item |
| `Enter` (dropdown open) | Accept highlighted item |
| `Enter` (dropdown closed) | Submit form |
| `Esc` | Close dropdown |

#### Command Validation

On form submit, if the message starts with `/`:

1. Parse command name (first word after `/`)
2. Look up in `commands`, `skills` (`skill:name`), `templates`
3. If **not found**: block the submit, show error notification `⚠ Unknown command: /name`, clear textarea
4. If **found**: proceed with normal send

**Strict mode:** Any message starting with `/` must be a recognized command. No passthrough.

#### Dialog Rendering

When the bridge broadcasts `extension_ui_request`, render an inline card in the message stream:

| Kind | Rendering |
|---|---|
| `confirm` | Message text + **OK** / **Cancel** buttons |
| `select` | Message text + `<select>` dropdown + **Submit** button |
| `input` | Message text + `<input>` field + **Submit** button |

On button click, send `extension_ui_response` with the selected value.

**Timeout indicator:** Each dialog card shows a countdown (e.g., "⏱ 30s"). On timeout, auto-send default response and remove the card.

## Protocol Changes

### New Client Commands

| Type | Fields | Purpose |
|---|---|---|
| `list_resources` | *(none)* | Request all commands, skills, and templates |
| `get_completions` | `command: string`, `args: string` | Request argument completions |

### New Server Events

| Type | Fields | Purpose |
|---|---|---|
| `resources_list` | `commands: CommandInfo[]`, `skills: SkillInfo[]`, `templates: TemplateInfo[]` | Resource catalog |
| `command_completions` | `items: CompletionItem[]` | Argument completions |
| `extension_command_error` | `command: string`, `error: string` | Command execution failed |

### New Types

```typescript
interface CommandInfo {
  name: string;
  description: string;
  source: string;
  hasCompletions: boolean;
}

interface SkillInfo {
  name: string;
  description: string;
}

interface TemplateInfo {
  name: string;
  description: string;
  args: string[];
}

interface CompletionItem {
  value: string;
  label: string;
  description?: string;
}
```

## File Inventory

### Bridge — New Files

| File | Purpose |
|---|---|
| `src/bridge/web-ui-context.ts` | `ExtensionUIContext` → WebSocket translation layer |
| `src/bridge/command-context-actions.ts` | `ExtensionCommandContextActions` → bridge command delegation |

### Bridge — Modified Files

| File | Changes |
|---|---|
| `src/bridge/sdk-session.ts` | Call `session.bindExtensions()` after session creation |
| `src/bridge/server.ts` | Add `GET /api/commands`, `POST /api/completions` HTTP endpoints; handle `list_resources` and `get_completions` WebSocket commands |
| `src/protocol/messages.ts` | Add new message types and validators |

### Chrome Extension — Modified Files

| File | Changes |
|---|---|
| `bridge-client.js` | Send `list_resources` on connect; add `get_completions` command |
| `sidepanel-state.js` | Add `commands`, `skills`, `templates`, `autocompleteOpen`, `autocompleteItems`, `autocompleteIndex` state + reducers |
| `sidepanel.js` | Resource fetching, autocomplete engine, keyboard handlers, command validation on submit, dialog rendering in message stream |
| `sidepanel.html` | Add `#autocomplete-dropdown` element |
| `sidepanel.css` | Autocomplete dropdown styles (dark/light theme) |

## Implementation Status

### Chrome Extension — Implemented ✅

| Component | File(s) | Status |
|---|---|---|
| State: commands, skills, templates, autocomplete | `sidepanel-state.js` | ✅ Done |
| State: reducers for resources_list, command_completions, autocomplete events | `sidepanel-state.js` | ✅ Done |
| State: createdAt timestamp on UI requests | `sidepanel-state.js` | ✅ Done |
| State: extension_ui_request_timeout reducer | `sidepanel-state.js` | ✅ Done |
| Bridge: send `list_resources` on connect | `bridge-client.js` | ✅ Done |
| Bridge: send `get_completions` command | `bridge-client.js` | ✅ Done |
| Autocomplete engine (build items, filter, debounce) | `sidepanel.js` | ✅ Done |
| Autocomplete dropdown UI + keyboard navigation | `sidepanel.js`, `sidepanel.html`, `sidepanel.css` | ✅ Done |
| Command validation on submit (block unknown commands) | `sidepanel.js` | ✅ Done |
| Dialog rendering (confirm, select, input) | `sidepanel.js` | ✅ Done |
| Dialog countdown timer (⏱ 30s) | `sidepanel.js` | ✅ Done |
| Dialog auto-timeout with default response | `sidepanel.js` | ✅ Done |
| Tests: state reducers for autocomplete/commands | `test/autocomplete.test.js` | ✅ Done |
| Tests: bridge-client list_resources/get_completions | `test/bridge-client-commands.test.js` | ✅ Done |
| Tests: UI request timeout handling | `test/ui-requests.test.js` | ✅ Done |

### Bridge — Implemented ✅

| Component | File(s) | Status |
|---|---|---|
| WebUiContext | `src/bridge/web-ui-context.ts` | ✅ Done |
| bindExtensions wired into session | `src/bridge/server.ts` | ✅ Done |
| list_resources handler | `src/bridge/server.ts` | ✅ Done |
| get_completions handler | `src/bridge/server.ts` | ✅ Done |
| Protocol types | `src/protocol/messages.ts` | ✅ Done |
| Tests: web-ui-context | `src/bridge/test/web-ui-context.test.ts` | ✅ Done |
| Tests: protocol types | `src/protocol/test/messages.test.ts` | ✅ Done |

## Implementation Order

### Milestone 1 — Commands Execute

Extension commands run end-to-end. User types `/persona x` in the side panel, the handler executes, and `ctx.ui` dialogs render as inline cards.

| Phase | File(s) | Status |
|---|---|---|
| Protocol types | `messages.ts` | ✅ |
| WebUiContext | `web-ui-context.ts` | ✅ |
| Wire into session (bindExtensions) | `server.ts` | ✅ |
| Dialog rendering | `sidepanel.js`, `sidepanel-state.js` | ✅ |

### Milestone 2 — Autocomplete & Validation

`/` shows a dropdown with all commands, Tab completes, unknown commands are blocked.

| Phase | File(s) | Status |
|---|---|---|
| Resource discovery | `server.ts`, `messages.ts` | ✅ |
| Resource fetching | `bridge-client.js` | ✅ |
| State + autocomplete engine | `sidepanel-state.js`, `sidepanel.js` | ✅ |
| Autocomplete UI | `sidepanel.html`, `sidepanel.css` | ✅ |
| Keyboard navigation | `sidepanel.js` | ✅ |
| Command validation | `sidepanel.js` | ✅ |

### Milestone 3 — Polish

| Phase | File(s) | Status |
|---|---|---|
| Timeout handling (bridge: 30s default) | `web-ui-context.ts` | ✅ |
| Timeout handling (Chrome: countdown + auto-response) | `sidepanel.js`, `sidepanel-state.js` | ✅ |
| Error feedback | `sidepanel.js`, `sidepanel-state.js` | ✅ |

## What Works After

| Feature | Status |
|---|---|
| Extension commands (`/persona x`) | ✅ Full support with `ctx.ui` dialogs |
| Prompt templates (`/review file.ts`) | ✅ SDK handles expansion |
| Skills (`/skill:git-workflow`) | ✅ SDK handles expansion |
| Built-in commands (`/compact`, `/model`) | ✅ Full support |
| `ctx.ui.notify()` | ✅ Inline notification |
| `ctx.ui.confirm()` | ✅ Inline card with OK/Cancel |
| `ctx.ui.select()` | ✅ Inline card with dropdown |
| `ctx.ui.input()` | ✅ Inline card with text input |
| `ctx.waitForIdle()` | ✅ Polls `isStreaming` |
| `ctx.newSession()` / `ctx.switchSession()` | ✅ Delegates to bridge |
| `/` autocomplete (names + args) | ✅ Dropdown with descriptions |
| Unknown command blocking | ✅ Error notification, submit blocked |
| Dialog timeout (30s) | ✅ Auto-default response + countdown |
| `ctx.ui.custom()` | ❌ TUI-only, not supported |
| `ctx.ui.setWidget()` / `setFooter()` | ❌ TUI-only, no-ops |

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| `_extensionRunner` is private on AgentSession | Can't enumerate commands | Attach a `getCommands()` getter to the returned session object in `sdk-session.ts` |
| `bindExtensions()` signature changes in Pi SDK | Breaks on Pi update | Wrap in try/catch; log warning; continue without extensions |
| Extension commands call `ctx.ui.custom()` | Complex TUI components can't render | `custom()` returns `undefined`; document as known limitation |
| Multiple Chrome tabs open | Duplicate UI dialogs | Each tab gets its own WebSocket; last `extension_ui_response` wins (Pi already handles this) |
| Extension commands are long-running | User sees no feedback | `extension_ui_notify` broadcasts keep user informed |
