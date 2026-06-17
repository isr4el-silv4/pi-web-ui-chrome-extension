<div align="center">
  <img src="https://i.imgur.com/kRzvtpk.webp" alt="pi-web-ui screenshot" style="max-width:800px;">
</div>

# Pi Coding Agent Web UI — Chrome Extension

Chrome side-panel extension that gives [Pi Coding Agent](https://pi.dev) direct browser control. Works together with the **[pi-web-ui Pi extension](https://www.npmjs.com/package/@isr4el-silv4/pi-web-ui)** (the local bridge) to connect Pi to your running Chrome browser.

## Architecture

```
┌───────────────────────────┐         WebSocket          ┌──────────────────────┐
│   Chrome Extension        │ ◄──── ws://127.0.0.1 ───►  │   Local Bridge       │
│   (this repo)             │         (port 43117)       │  (pi-web-ui ext)     │
│                           │                            │                      │
│  Pi Coding Agent Web UI   │   browser_tool_request     │  • Pi SDK session    │
│  • Debugger client        │ ◄───────────────────────── │  • Tool executor     │
│  • Network capture        │   browser_tool_response    │  • Permission gates  │
│  • Console capture        │                            │  • Session registry  │
└───────────────────────────┘                            └──────────────────────┘
         ▲                                                │
         │                                                ▼
   Chrome tabs ─────────────────────────────────── Chrome DevTools Protocol
```

1. You launch the bridge from Pi's terminal with `/pi-web-ui start`
2. The bridge spawns a local WebSocket server on `127.0.0.1:43117`
3. The Chrome extension connects to the bridge via WebSocket
4. Pi sends `browser_tool_request` messages through the bridge
5. The extension executes browser operations and returns results

## Prerequisites

- **Pi Coding Agent** ([pi.dev](https://pi.dev)) installed
- **pi-web-ui** Pi extension installed (follow [this](https://pi.dev/packages/@isr4el-silv4/pi-web-ui))
- **This Chrome extension** loaded in Chrome (dev mode or from the Web Store)

## Setup

### 1. Install the Chrome Extension

**From the Chrome Web Store:** Coming soon.

**Manual (development):**
1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this directory

### 2. Start the Bridge

From a Pi terminal session, run:

```
/pi-web-ui start
```

This starts the local bridge process. The side panel will show **Bridge online** when connected.

### 3. Pick Your Working Directory

Click **Browse…** in the side panel header to select your project directory. This sets the `cwd` for the Pi session and determines where sessions are saved.

## What It Unlocks

### Browser Tools

Pi gains access to these browser operations on your active tabs:

| Category | Tools |
|---|---|
| **Page** | `page.getText`, `page.getHtml`, `page.getSelection`, `page.captureScreenshot` |
| **Tabs** | `tabs.list`, `tabs.getCurrent` |
| **Console** | `console.getLogs`, `console.clearLogBuffer` |
| **Network** | `network.startCapture`, `network.stopCapture`, `network.getRequests`, `network.getRequest`, `network.getResponseBody` |
| **Debugger** | `debugger.attach`, `debugger.detach`, `debugger.evaluateScript`, `debugger.sendCdpCommand` |
| **Cookies** | `cookies.get` (opt-in via header toggle) |
| **Storage** | `storage.getLocal`, `storage.getSession` (opt-in via header toggle) |

### Frontend Development Workflow

This is where it shines. Pi can now:

- **Inspect live pages** — read HTML, text content, or selected text from any tab
- **Debug network issues** — capture and inspect network requests, including response bodies
- **Read console output** — see what's logging in the browser
- **Take screenshots** — verify visual state after changes
- **Evaluate scripts** — run JavaScript in the page context (requires confirmation)
- **Send raw CDP commands** — access any Chrome DevTools Protocol method

Typical flow: you're working on a frontend issue, ask Pi to inspect the page, and it reads the DOM, checks the network tab, reads console errors, and suggests fixes — all without you switching contexts.

### Session Management

- **New session** — click "+ New Session" or refresh the extension to start fresh in the current directory
- **Resume session** — pick a previous session from the dropdown to continue where you left off
- **Switch between terminal and browser** — start from Pi's terminal, then interact through the side panel. Sessions persist in your project directory so you can pick them up later

### Permissions & Safety

- **Cookie and storage access** are **opt-in** — toggled via checkboxes in the header
- **Script evaluation** and **raw CDP commands** require explicit confirmation before execution
- All sensitive browser actions are recorded in an audit log on the bridge side

## Message Types

The WebSocket protocol uses these message types:

**Client → Bridge:**
- `prompt` — send a message to Pi
- `abort` — stop the current response
- `new_session` — start a new session (with `cwd`)
- `resume_session` — resume a previous session (with `sessionPath`)
- `list_sessions` — list available sessions for a directory
- `set_cookie_access` / `set_storage_access` — toggle sensitive permissions

**Bridge → Client:**
- `session_state` — current session info
- `assistant_message` — Pi's response (with optional `thinking`)
- `tool_call` / `tool_result` — tool execution progress
- `browser_tool_request` — bridge asking the extension to execute a browser tool
- `extension_ui_request` — confirm/input prompts from Pi

## Development

Tests live in the `test/` directory. Run them with your preferred test runner.

## License

Apache 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
