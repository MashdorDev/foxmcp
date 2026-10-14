# FoxMCP Architecture

Overview of the FoxMCP system architecture, components, and data flow.

## System Overview

```
┌─────────────────┐    WebSocket     ┌──────────────────┐    MCP Protocol    ┌─────────────┐
│                 │   (Port 8765)    │                  │                    │             │
│  Firefox        │◄────────────────►│  Python Server   │◄──────────────────►│ MCP Client  │
│  Extension      │                  │  (FastMCP)       │                    │             │
│                 │                  │                  │                    │             │
└─────────────────┘                  └──────────────────┘                    └─────────────┘
        │
        ▼
┌─────────────────┐
│                 │
│ WebExtensions   │
│ APIs            │
│  - Tabs         │
│  - Windows      │
│  - History      │
│  - Bookmarks    │
│  - Navigation   │
│  - Content      │
│  - webRequest   │
└─────────────────┘
```

The Firefox extension acts as a bridge between WebExtensions APIs and MCP clients, enabling AI assistants and other tools to interact with browser functionality programmatically.

## Component Architecture

### 1. Firefox Extension

**Location**: `extension/`

**Manifest**: Manifest V2, extension ID `foxmcp@dorzairi.dev`.

#### Background Script (`background.js`)
- **Persistent Background Page**: Declared `"persistent": true` in the manifest, so it runs for the lifetime of the browser session (this is a background page, not a service worker)
- **WebSocket Client**: Maintains the connection to the Python server and reconnects when it drops. While that connection is up, it also scans the ports after it every 15 seconds (`scanExtraServers`) and keeps a connection to each further server it finds, one per Claude session; see [configuration.md](configuration.md#several-sessions)
- **Permission Check**: Before an action runs, `refusalFor` checks it against the person's settings: the pause switch, the permission group the action belongs to (`ACTION_PERMISSIONS` in `settings.js`), private windows, and the blocked sites list, which is matched against the URL the action opens and the URL of the tab it acts in. A refused action is answered with an error naming the reason, which the server passes on to the client
- **Action Router**: Splits each incoming action on `.` and dispatches to the handler for that namespace
- **Response Manager**: Formats and sends responses back on the connection the request came in on
- **Agent Tabs**: Tracks the tabs an agent is working in, for the overlay, the popup and the badge. A tab is let go when the agent calls `tabs_release`, when its server's connection closes, or after the idle time set on the options page (5 minutes by default)
- **Toolbar Badge**: `updateBadge` shows "off" when no server is connected, "stop" when the agent is paused, and otherwise how many tabs the agent is working in. The button's tooltip names the number of sessions. The badge can be turned off in the settings

#### Content Script (`content.js`)
- **Page Injection**: Injected into all pages (`<all_urls>`) for content access
- **JavaScript Execution**: Executes custom scripts in page context
- **DOM Interaction**: Extracts text, HTML, and manipulates page content; lists interactive elements with refs and clicks, hovers, drags and types into them with scripted events
- **Agent Overlay**: The border, status line, cursor and tab-icon ring that show the agent at work, drawn from the person's settings
- **Real Input Preparation**: Before real input, moves the on-page cursor to the target and marks the tab with a one-time token for the server to find (see [Real input](#3-real-input))
- **Communication Bridge**: Relays data between page and background script

#### Shared Settings (`settings.js`)
- Names and defaults of every setting the person can change (`SETTINGS_DEFAULTS`), the action-to-permission map (`ACTION_PERMISSIONS`), the permission names shown in the options page and in refusals, and the blocked-site matching
- Loaded by the background script, the content script, the popup and the options page, so all four agree on names and defaults
- Every value is kept in `storage.local`, per Firefox profile, so Firefox Sync does not copy one profile's settings to another. Only the reconnect timings stay in `storage.sync`

#### Popup Interface (`popup/`)
- **Status Panel**: Whether a server is connected and on which port, the other sessions sharing this browser, whether real input is on, this browser's name, and the tabs an agent is working in, each with a link to go to it and a Release button
- **Switches**: "Show me the tab the agent works in" and "Pause the agent", plus Reconnect and a button to the settings page
- **Setup Hint**: With no server connected, offers a request to copy into Claude Code that sets the server up

#### Options Page (`options.html`, `options.js`)
- The settings page, shown inside the add-on's page in `about:addons` (`options_ui.open_in_tab` is false). Each change saves as it is made, with no Save button. See [configuration.md](configuration.md#the-add-ons-settings-page) for what it holds
- `ui.css` gives the popup and the options page Firefox's own font and light and dark colours

### 2. Python Server

**Location**: `server/`

#### WebSocket Server (`server.py`)
- **Connection Management**: Accepts a connection from each browser running the add-on and keys it by the profile id the add-on sends on connecting. The first to connect is active; `browsers_select` picks another. A server that finds its port taken moves to the first free one of the next four (`EXTRA_SERVER_PORTS`)
- **Request Correlation**: Maps request IDs to `asyncio.Future` objects in `self.pending_requests` and resolves them when the matching response arrives
- **Protocol Implementation**: WebSocket message protocol handling
- **Security**: Localhost-only binding
- **Lifecycle**: Graceful startup and shutdown, including cleanup of the extension connection

#### MCP Tools (`mcp_tools.py`)
- **MCP Tool Definitions**: 51 browser functions registered as MCP tools on a `FastMCP("MCP Bridge for Firefox")` instance
- **Parameter Validation**: Type-annotated tool signatures; FastMCP derives the schema
- **Response Formatting**: Each tool turns the raw browser response into a human-readable string
- **Error Handling**: Every tool checks for `error` in the response before reading data. A result that reads as a failure ("Failed to ...", "Unable to ...") is raised as a `ToolError`, so the client sees `isError` (`_failures_as_errors`)
- **Status Line**: Tools that act in a tab get an optional `status` argument (`_with_status`), carried with every request the tool sends and shown on the page's overlay

#### Real Input (`bidi.py`)
- A small WebDriver BiDi client: opens a session on Firefox's remote control port, finds the marked tab, and sends pointer and key actions through `input.performActions`
- One short session per action, since Firefox allows one BiDi session at a time and several servers may share the browser

### 3. Communication Protocols

#### WebSocket Protocol
```json
{
  "id": "unique-request-id",
  "type": "request|response|error",
  "action": "namespace.function",
  "data": {},
  "timestamp": "ISO-8601"
}
```

Actions are namespaced with a dot: `windows.get`, `tabs.list`, `bookmarks.create`, `requests.start_monitoring`. The prefix selects the handler in the extension. See [protocol.md](protocol.md) for the full specification.

#### MCP Protocol
- **Standard MCP Tools**: Browser functions exposed as MCP tools
- **Parameter Schema**: Type-safe parameter definitions
- **Result Formatting**: Consistent response formatting
- **Error Codes**: Standardized error handling
- **Transport**: HTTP on port 3000 by default, run by uvicorn in a thread of its
  own. `--stdio` serves the same tools on the process's stdin and stdout instead,
  for clients that launch their servers; there the MCP server is an asyncio task
  beside the WebSocket server rather than a thread, since the stdio transport is
  asyncio throughout. The WebSocket half is identical either way

## Data Flow

### 1. MCP Client → Browser

```
MCP Client
    ↓ (MCP tool call)
FastMCP Server
    ↓ (WebSocket message)
Python Server
    ↓ (WebSocket)
Firefox Extension
    ↓ (WebExtensions API)
Browser Function
    ↓ (Result)
Firefox Extension
    ↓ (WebSocket response)
Python Server
    ↓ (MCP tool result)
FastMCP Server
    ↓ (MCP response)
MCP Client
```

### 2. Predefined Scripts Flow

```
MCP Client
    ↓ (content_execute_predefined tool)
Python Server
    ↓ (Execute external script)
External Script
    ↓ (JavaScript code output)
Python Server
    ↓ (WebSocket: content.execute_script)
Firefox Extension
    ↓ (Inject into content script)
Page JavaScript Context
    ↓ (Execution result)
Firefox Extension
    ↓ (WebSocket response)
Python Server
    ↓ (MCP tool result)
MCP Client
```

### 3. Real Input

For `content_click`, `content_hover`, `content_drag`, `content_type` and
`content_press_key`, when the person allows real input:

```
MCP tool call
    ↓ (WebSocket: content.real_input_prep or content.real_pointer_prep)
Firefox Extension
    ↓ (refusalFor: pause, permissions, blocked sites)
Content Script
    ↓ (moves the cursor, puts a one-time token on <html>, returns the target)
Python Server (bidi.py)
    ↓ (BiDi session on the remote control port, 9222-9229 or the one set)
Firefox Remote Control
    ↓ (finds the tab holding the token, performs the pointer or key actions)
Page receives trusted events
```

The prep step goes through the background script like any other action, so the
person's settings apply to real input too. Each action opens its own BiDi session
and ends it. If no port answers, or the tab is not found, the tool falls back to
the scripted action, and the server does not look for remote control on that
browser again for 60 seconds. `content_drag` on a page's own HTML5 drag-and-drop
stays scripted, because Firefox's remote control cannot drop. See
[configuration.md](configuration.md#real-input-webdriver-bidi).

## Security Architecture

### 1. Network Security
- **Localhost Binding**: The server binds to `localhost` by default, and `--host` is forced back to localhost if given anything else
- **No External Access**: Not reachable from the network in the default configuration
- **Port Separation**: WebSocket and MCP listen on different ports

**Localhost binding excludes the network, not web pages.** A page the user visits runs inside their browser, so it can reach `127.0.0.1`: the same-origin policy does not stop it, and WebSocket handshakes are never preflighted. Each port handles this differently:

| Port | What stops a web page |
|---|---|
| Extension WebSocket | An origin allowlist: `websockets.serve(origins=[...])` accepts only `moz-extension://` origins and rejects anything else with a 403 during the handshake. See [Extension Connection Origin](#4-extension-connection-origin) |
| MCP HTTP | No CORS headers are sent, so preflighted requests are blocked; a `text/plain` request that would skip preflight is rejected for its content type; and the transport requires a session id that cross-origin JavaScript cannot read. These come from `fastmcp`/uvicorn rather than from FoxMCP, so `tests/integration/test_mcp_port_not_web_reachable.py` asserts them, so a dependency upgrade that re-opens the port fails the suite |

Neither port authenticates local processes, which is deliberate: a process running as the user already has the browser profile and the script directory, so a shared secret between two components under that user's control would guard nothing.

### 2. Extension Security
- **Broad Permissions**: The extension requests `tabs`, `tabGroups`, `history`, `bookmarks`, `activeTab`, `storage`, `clipboardRead`, `clipboardWrite`, `webRequest`, `webRequestBlocking`, and `<all_urls>`. `webRequestBlocking` is there for `filterResponseData`, which is the only way to read a response body and which Firefox grants only to an extension holding that permission; no listener blocks, cancels or rewrites a request. The set is deliberately wide (the extension exists to expose browser state), and it is the reason the server must stay on localhost. Treat an installed FoxMCP as granting its MCP client the same reach over the browser that you have.
- **Sandboxing**: Content scripts run in the standard isolated content-script context
- **The Person's Settings**: The add-on's settings page can pause the agent, turn off any of ten permission groups, block sites and keep it out of private windows. `refusalFor` in `background.js` enforces these for every action, real input included, so they hold whatever the MCP client asks
- **Remote Control**: Real input needs Firefox started with `--remote-debugging-port`. While that port is open, any local program can drive Firefox through it, outside the add-on and its settings

### 3. Script Security

Enforced in `mcp_tools.py` before a predefined script runs:

- **Opt-in**: Scripts are disabled unless `FOXMCP_EXT_SCRIPTS` is set
- **Name Filtering**: Script names must match `^[a-zA-Z0-9._-]+$` and may not contain `/`, `\`, or `..`
- **Path Containment**: The resolved absolute path must stay inside the scripts directory
- **Executable Check**: The file must exist and be executable
- **Timeout Protection**: Scripts are killed after 30 seconds
- **Execution Isolation**: Scripts run as separate subprocesses
- **Audit Logging**: Every invocation is logged at `INFO` with script name, arguments and tab; every refusal and failure at `WARNING`. Arguments are truncated at 120 characters; the generated JavaScript is never logged, only its size. See [`scripts.md`](scripts.md#what-gets-logged)

### 4. Extension Connection Origin

Only browser extensions may connect to the WebSocket port. `server.py` passes an allowlist to `websockets.serve()`:

```python
EXTENSION_ORIGIN_PATTERN = re.compile(r'moz-extension://.+')
```

- **Scheme, not identity**: Firefox generates a per-install UUID, so the extension's origin differs on every profile: `moz-extension://8690897d-…` on one machine, something else on the next. Matching the scheme lets any legitimate install pass
- **Rejected during the handshake**: The connection never reaches `handle_extension_connection`, which matters because that function closes the existing extension connection to admit a new one, and a rejection arriving any later would itself be a denial of service
- **Matched with `fullmatch()`**: The trailing `.+` is required; a bare prefix pattern rejects everything, including the extension
- **Rejections are logged** at warning level with the offending origin. The library logs them only in debug mode, which would make a legitimate extension that stopped connecting look identical to a server that was never reached

This does not stop a *malicious installed extension*, which can send a `moz-extension://` origin of its own. That is a different threat: it requires the user to install hostile software, at which point the browser is already compromised.

Tested in `tests/integration/test_connection_origin.py`. Test clients standing in for the extension must use `connect_as_extension()` from `tests/test_config.py`; a plain `websockets.connect()` is refused.

## Concurrency and Limits

### 1. Connection Management
- **Several Browsers**: Every Firefox profile running the add-on can be connected at once. The first is active, and tools act on the active one until `browsers_select` picks another. A profile that reconnects keeps its id; its old socket, if still open, is closed.
- **Several Servers**: Each Claude session under `--stdio` runs its own server, on 8765 or the next free port up to 8769. The add-on holds a connection to each, and replies go back on the connection the request came in on.
- **MCP Clients**: Served by FastMCP. On one server, all clients share the active browser, and requests from different clients interleave.
- **Reconnection Logic**: The extension retries every `retryInterval` (5000 ms by default) and reconnects when settings change. `maxRetries: -1` retries forever, slowing from `retryInterval` to every 30 seconds after 50 attempts (`FAST_RETRIES` and `SLOW_RETRY_INTERVAL` in `background.js`); a positive `maxRetries` stops after that many attempts until **Reconnect** in the popup resets the counter.

### 2. Request Handling
- **Async Processing**: All operations are asynchronous
- **Concurrent Requests**: Multiple requests can be in flight on the single socket at once; responses are matched by `id`, not by order, so a slow request does not block the others
- **Timeouts**: `send_request_and_wait` defaults to 30 seconds and **returns** an `{"error": ...}` dict on expiry rather than raising, so callers must check for `error` before reading data
- **Cleanup**: Every exit path removes its entry from `pending_requests`

### 3. Known Limits
- **No queuing or retry**: A request sent while the extension is disconnected fails immediately; nothing is buffered for later delivery
- **No response caching**: Every tool call is a fresh round trip to the browser
- **Message size**: The server accepts messages from the extension up to 64 MB (`MAX_MESSAGE_BYTES`), since a full-window screenshot comes back as one base64 message of several MB

## Extension Points

### 1. Adding New Browser Functions

Both halves must be changed. One without the other is a silent failure.

**Step 1: Extension** (`background.js`): add a `case` to the handler for the namespace, or a new `handle<Namespace>Action` function plus a `case` in `handleMessage`'s router:

```javascript
case 'windows.new_function':
  if (!data.windowId) {
    sendError(id, 'INVALID_PARAMETER', 'windowId is required for windows.new_function');
    return;
  }
  const result = await browser.windows.someFunction(data.windowId);
  sendResponse(id, action, { result });
  break;
```

**Step 2: MCP Tool** (`mcp_tools.py`): register the tool and build the request explicitly:

```python
@self._tool()
async def new_function(window_id: int) -> str:
    """New browser function

    Args:
        window_id: The ID of the window

    Returns:
        String describing the outcome
    """
    request = {
        "id": str(uuid.uuid4()),
        "type": "request",
        "action": "windows.new_function",
        "data": {"windowId": window_id},
        "timestamp": datetime.now().isoformat()
    }

    response = await self.websocket_server.send_request_and_wait(request)

    if "error" in response:
        return f"Error: {response['error']}"

    return f"Result: {response.get('data', {}).get('result')}"
```

`@self._tool()` rather than `@self.mcp.tool()` is what makes `--disable-tools`, `--enable-tools`, the `status` argument and failures-as-errors apply to the new tool.

**Step 3**: add the action to a group in `ACTION_PERMISSIONS` (`extension/settings.js`), or the person's permission settings cannot turn it off; add the permission to `manifest.json` if the API needs one, document the action in [protocol.md](protocol.md) and the tool in [api-reference.md](api-reference.md), and add an integration test.

### 2. Custom Script Integration

A predefined script is a program whose **stdout is JavaScript**. The server runs it, then injects what it printed.

**Script Creation**
```bash
#!/bin/bash
echo "(function() { return 'Custom functionality'; })()"
```

**MCP Tool Usage**
```python
result = content_execute_predefined(
    tab_id=123,
    script_name="custom_script.sh",
    script_args='["arg1", "arg2"]'
)
```

See [scripts.md](scripts.md) for the full guide.

## Testing Architecture

### 1. Unit Tests
- **Server Components**: Test individual server functions
- **Protocol Validation**: Test message format validation

### 2. Integration Tests
- **End-to-End**: Test complete MCP → Browser flow
- **Extension Communication**: Test WebSocket communication
- **Browser APIs**: Test actual browser function calls with real Firefox
- **Script Execution**: Test predefined script execution

### 3. Test Infrastructure
- **Centralized Fixtures**: Shared test setup in `conftest.py`
- **Port Coordination**: `port_coordinator.py` allocates ports dynamically, and `FoxMCPServer` detects pytest to avoid the default MCP port, so the suite can run while a development server is up
- **Firefox Management**: Automated temporary profile creation and extension installation via `setup_and_start_firefox()`
- **Cleanup**: Automatic resource cleanup after tests

## Configuration Architecture

### 1. Server Configuration

Constructed in code:

```python
server = FoxMCPServer(
    host="localhost",      # Security: localhost only
    port=8765,             # WebSocket port
    mcp_port=3000,         # MCP server port (None → 3000, or dynamic under pytest)
    start_mcp=True,        # Enable MCP integration
    use_stdio=False        # True: serve MCP on stdin/stdout, and open no HTTP port
)
```

Or from the command line:

```bash
python server/server.py --host localhost --port 8765 --mcp-port 3000
python server/server.py --no-mcp          # WebSocket only
python server/server.py --stdio           # MCP on stdin/stdout, no HTTP listener
```

### 2. Extension Configuration
- **storage.local**: Every setting, per profile, with names and defaults in `settings.js`. The background and content scripts listen for changes and apply them at once
- **storage.sync**: Only the reconnect timings (retry interval, max retries, ping timeout)
- **UI Configuration**: The options page; the popup holds only the follow and pause switches
- **Test Overrides**: `testPort` and `testHostname`, set by the test suite, win over the saved host and port
- **Auto-reconnection**: Automatic reconnection when host or port change

### 3. Environment Configuration

```bash
# Required for predefined scripts; without it, the feature is disabled
export FOXMCP_EXT_SCRIPTS="/path/to/scripts"
```

The server also reads `FOXMCP_DISABLE_TOOLS` and `FOXMCP_ENABLE_TOOLS` (see [configuration.md](configuration.md#reducing-the-tool-surface)). Host and ports are set through the constructor or the command-line flags above.

## Deployment

### 1. Development

```bash
make dev                # Setup environment
make build              # Build extension
make run-server         # Start server
```

### 2. Distribution
- **Extension Packaging**: XPI file, published to the Firefox Add-ons store and attached to GitHub releases
- **Server**: A Python package (`pyproject.toml`, command `mcp-bridge-for-firefox`). Users run it with `uvx` from a release tag, directly or through the Claude Code plugin in `claude-plugin/`, which the repo lists as a plugin marketplace in `.claude-plugin/marketplace.json`. It can also run from a checkout with its virtual environment
- **Versioning**: Extension and server are released together; the WebSocket protocol is the compatibility boundary between them

### 3. Observability

Python `logging` at INFO level, in the default text format, to stderr. `claudebugzilla/start.sh` redirects this to a log file. There are no health endpoints, no metrics collection, and no structured log format.

## Future Architecture Considerations

These are not implemented. They are recorded as directions that have been considered, not as plans.

### 1. Multi-Browser Support
- **Browser Abstraction**: Common interface for different browsers
- **Protocol Standardization**: Browser-agnostic messaging
- **Extension Variants**: Browser-specific extension implementations

### 2. Production Hardening
- **Health Checks**: HTTP health endpoints for the WebSocket and MCP servers
- **Metrics**: Connection counts, request rates, response times, error rates
- **Structured Logging**: JSON-formatted logs with request tracing across components
- **Containerization**: A Docker image bundling the server and its dependencies

### 3. Enhanced Security
- **Authentication**: User authentication for MCP clients
- **Authorization**: Role-based access control over the tool surface
- **Audit Logging**: A record of which client invoked which tool
