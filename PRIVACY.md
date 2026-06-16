# Privacy Policy — Pi Web UI Chrome Extension

**Last updated:** June 2026

## Overview

Pi Web UI is a Chrome extension that connects to a local bridge process running on your machine. It gives [Pi Coding Agent](https://pi.dev) the ability to interact with your browser for development tasks.

**All data stays on your machine.** The extension communicates exclusively with a local WebSocket server at `127.0.0.1:43117`. No data is transmitted to external servers by this extension.

## Data Accessed

The extension requests broad Chrome permissions to enable Pi to perform browser operations. Here's what it can access and why:

| Data | Permission | Why |
|---|---|---|
| Tab list, URLs, titles | `tabs`, `activeTab` | Pi needs to know which tabs exist and which is active |
| Page content (HTML, text, selected text) | `scripting` | Pi reads the DOM to inspect, debug, and modify pages |
| Console output | `debugger` (CDP Runtime) | Pi reads browser console logs to diagnose issues |
| Network requests & responses | `debugger` (CDP Network) | Pi inspects network traffic for debugging |
| Screenshots | `tabs.captureVisibleTab` | Pi captures visual state of pages |
| Cookies | `cookies` | Pi can read cookies for debugging (opt-in) |
| localStorage / sessionStorage | `storage` | Pi can read web storage for debugging (opt-in) |
| JavaScript execution | `debugger` (CDP Runtime.evaluate) | Pi runs scripts in the page context (requires confirmation) |
| Raw CDP commands | `debugger` | Pi can send any Chrome DevTools Protocol command (requires confirmation) |

## Opt-In Controls

- **Cookie access** — disabled by default. Enable via the "cookies" toggle in the side panel header.
- **Storage access** — disabled by default. Enable via the "storage" toggle in the side panel header.
- **Script evaluation** — always requires explicit user confirmation before execution.
- **Raw CDP commands** — always requires explicit user confirmation before execution.

## Data Flow

```
Chrome tabs → Extension (this repo) → WebSocket → Local bridge (127.0.0.1) → Pi session
```

The extension is purely a transport layer. It forwards browser data to the local bridge, which relays it to your Pi session. Nothing leaves your computer through this extension.

Whether Pi itself (the local agent) sends data externally — for example to an LLM API — is outside the scope of this extension and is the user's responsibility.

## Sessions

Sessions are stored locally on your machine in your project directory. They are never transmitted externally by this extension.

## No Telemetry

This extension does not collect analytics, usage metrics, crash reports, or any other telemetry data.

## Contact

For questions about this privacy policy, open an issue on [GitHub](https://github.com/isr4el-silv4/pi-web-ui-chrome-extension/issues).
