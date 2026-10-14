# FoxMCP Project Skeleton Structure

This document explains the basic skeleton structure created for the FoxMCP project.

## Project Overview

```
foxmcp/
├── CLAUDE.md           # Project requirements and instructions
├── README.md          # Main project documentation and quick start
├── LICENSE             # MIT License file
├── SECURITY.md         # Threat model and vulnerability reporting
├── package.json        # Project metadata and npm scripts
├── pyproject.toml      # The server as a Python package (mcp-bridge-for-firefox command)
├── .claude-plugin/
│   └── marketplace.json # Lists the repo as a Claude Code plugin marketplace
├── claude-plugin/      # The Claude Code plugin that starts the server
│   ├── .claude-plugin/plugin.json # Plugin name, version and description
│   └── .mcp.json      # The uvx command Claude Code runs for the server
├── claude.sh          # Claude Code integration script with FM_ROOT environment
├── Makefile           # Build system and development commands
├── docs/               # Documentation directory
│   ├── protocol.md    # WebSocket message protocol specification
│   ├── files.md       # This file - explains project structure
│   └── venv-setup.md  # Virtual environment setup documentation
├── venv/              # Python virtual environment (created)
├── extension/         # Browser extension directory
│   ├── manifest.json  # Extension configuration and permissions
│   ├── settings.js    # Settings names, defaults and permission groups, shared by all scripts
│   ├── background.js  # Persistent background script: WebSocket clients, permission checks, badge
│   ├── content.js     # Content script for page interaction, overlay and cursor
│   ├── options.html   # Settings page, shown inside about:addons
│   ├── options.js     # Settings page logic: autosave, export, import, reset
│   ├── ui.css         # Styles shared by the popup and the settings page
│   ├── icons/         # Add-on and toolbar icons
│   └── popup/         # Toolbar popup, a status panel
│       ├── popup.html # Connection, sessions, agent tabs, follow and pause switches
│       └── popup.js   # Popup logic
├── server/            # Python MCP server directory
│   ├── __init__.py    # Python package init (for imports)
│   ├── requirements.txt # Python dependencies
│   ├── server.py       # WebSocket server implementation with ping-pong
│   ├── mcp_tools.py    # FastMCP tool definitions and handlers
│   └── bidi.py         # WebDriver BiDi client for real mouse and keyboard input
├── predefined-ex/     # Example predefined scripts
└── tests/             # Test suite directory
    ├── conftest.py    # Pytest configuration and fixtures
    ├── pytest.ini     # Pytest settings
    ├── requirements.txt # Test dependencies (with pytest-cov)
    ├── run_tests.py   # Test runner script (with PYTHONPATH fix)
    ├── test_imports.py # Test import system with automatic path setup
    ├── README.md      # Test documentation
    ├── htmlcov/       # Coverage HTML reports (generated)
    ├── firefox_test_utils.py   # Firefox testing utilities with SQLite configuration
    ├── test_config.py          # Test configuration and port allocation
    ├── port_coordinator.py     # Test port coordination system
    ├── unit/          # Unit tests
    │   ├── test_server.py      # Server component tests
    │   ├── test_protocol.py    # Protocol message tests
    │   ├── test_ping_pong.py   # Ping-pong functionality tests
    │   ├── test_window_handlers.py # Window management message and MCP tool tests
    │   ├── test_tab_move.py    # Tab moving, and the window scoping on tabs_list
    │   └── test_protocol_pairing.py # Every action the server sends has a handler, and back
    ├── integration/   # Integration tests
    │   ├── test_websocket_communication.py # WebSocket communication tests
    │   ├── test_ping_pong_integration.py  # End-to-end ping tests
    │   ├── test_real_firefox_communication.py # Real Firefox extension tests
    │   ├── test_ui_storage_sync.py        # UI storage synchronization tests with Firefox
    │   ├── test_window_management.py      # End-to-end window management tests with Firefox
    │   ├── test_tab_move_end_to_end.py    # Gathering tabs into a window, and reordering within one
    │   ├── test_test_helper_protocol.py   # Test helper protocol unit tests
    │   └── foxmcp_scripts/    # External scripts for predefined script execution tests
    │       ├── simple_test.sh     # Basic test script (no user interaction)
    │       ├── get_page_info.sh   # Page information extraction (title, URL, text, links)
    │       └── multi_arg_test.sh  # Multi-argument demo script with DOM manipulation
    └── fixtures/      # Test data files
```

## Extension Directory (`/extension`)

### `manifest.json`
- **Purpose**: Extension configuration file for Firefox
- **Key Features**:
  - Manifest V2 format for Firefox WebExtensions compatibility
  - Permissions for tabs, tabGroups, history, bookmarks, activeTab, storage, clipboardRead, clipboardWrite, webRequest, webRequestBlocking, and all URLs
  - Persistent background script registration (`settings.js`, then `background.js`)
  - Content script injection for all URLs (`settings.js`, then `content.js`)
  - Browser action popup UI configuration
  - `options_ui` with `open_in_tab: false`, so the settings page shows inside `about:addons`

### `settings.js`
- **Purpose**: The settings a person can change, and their defaults
- **Key Features**:
  - `SETTINGS_DEFAULTS`: every setting with its default (pause, the ten permission groups, blocked sites, private windows, follow, idle release, overlay, cursor, typing, colour, badge, browser name, session ports, real input)
  - `ACTION_PERMISSIONS`: which permission group each protocol action needs; actions not listed are always allowed
  - `PERMISSION_NAMES`: the names shown on the settings page and in refusals
  - `loadSettings()` and the blocked-site matching (`isBlockedHost`), which also blocks subdomains
  - Loaded by the background script, the content script, the popup and the options page; every value lives in `storage.local`, per profile

### `ui.css`
- **Purpose**: Styles shared by the popup and the settings page
- **Key Features**: Firefox's own system font, light and dark colours, and the overlay's orange as the one accent

### `background.js`
- **Purpose**: Extension persistent background script
- **Key Features**:
  - WebSocket client connection to MCP server (ws://localhost:8765)
  - **Configurable connection parameters**: host and port in browser.storage.local, per profile; retry interval, max retries and ping timeout in browser.storage.sync
  - **Connections to further servers** on the ports after the configured one (`scanExtraServers`), one per Claude session
  - **Permission checks** (`refusalFor`): pause, permission groups, private windows and blocked sites, applied to every action before it runs
  - **Agent tabs and toolbar badge**: tracks the tabs an agent works in and releases idle ones; the badge shows "off", "stop", or the number of agent tabs
  - **Test configuration override system** - reads testPort/testHostname with priority over regular settings
  - Automatic reconnection with configurable retry intervals and limits
  - Message routing to appropriate handler functions
  - Request/response message handling with async support
  - **Ping-pong functionality** for connection testing
  - **Runtime message handling** for popup and options page communication
  - **Async ping testing** with timeout and correlation
  - **Configuration loading and updating** with test environment support
  - Error handling and logging
  - **Complete WebExtensions API implementations** for all function categories:
    - **History management**: Query history, get recent items via browser.history
    - **Tab management**: List, create, close, update tabs via browser.tabs
    - **Window management**: List, get, create, close, focus, update windows via browser.windows
    - **Content extraction**: Text and HTML extraction from pages via browser.tabs.sendMessage
    - **Navigation control**: URL navigation, back/forward, reload via browser.tabs
    - **Bookmark management**: List, search, create bookmarks and folders, update titles/URLs, remove bookmarks via browser.bookmarks
  - **Test Helper Protocol** - WebSocket messages for automated UI testing:
    - **test.get_popup_state**: Get current popup display values and test override status
    - **test.get_options_state**: Get options page display values and configuration state
    - **test.get_storage_values**: Retrieve raw storage.sync values for validation
    - **test.validate_ui_sync**: Validate UI-storage synchronization with expected values
    - **test.refresh_ui_state**: Trigger UI state refresh for testing scenarios

### `content.js`
- **Purpose**: Content script injected into web pages
- **Key Features**:
  - Page content extraction (text, HTML) via browser.runtime.onMessage
  - JavaScript execution capability with eval()
  - Message passing with background script using WebExtensions messaging
  - Error handling for page interactions

### `popup/popup.html` and `popup/popup.js`
- **Purpose**: Toolbar popup, a status panel rather than a settings form
- **Key Features**:
  - Connection status, the server's address, and any other sessions on the ports after it
  - Whether real input is on
  - This browser's name, with a link to rename it on the settings page
  - The tabs an agent is working in, each with a link to go to it and a Release button
  - "Show me the tab the agent works in" and "Pause the agent" switches
  - Reconnect and Settings buttons
  - With no server connected, a setup request to copy into Claude Code

### `options.html` & `options.js`
- **Purpose**: The add-on's settings page, shown inside `about:addons`
- **Key Features**:
  - Sections for what the agent may do, how it looks on the page, the connection, real input, and backup and reset
  - **Autosave**: every element with `data-setting` is bound to that key of `settings.js` and saves as it changes; there is no Save button
  - Host and port go through the background script, which reconnects; retry interval, max retries and ping timeout go to `storage.sync`
  - **Export, import and reset**: export writes a JSON file, import accepts only known keys of the right type and keeps this profile's name, reset needs a second press
  - **Test configuration override support**: shows when `testPort`/`testHostname` from the test suite are in effect
  - See [configuration.md](configuration.md#the-add-ons-settings-page) for every setting

## Server Directory (`/server`)

### `requirements.txt`
- **Purpose**: Python package dependencies
- **Dependencies** (the same list as `pyproject.toml`):
  - `websockets>=12.0` - WebSocket server implementation, and the BiDi client
  - `fastmcp>=3.0.0,<4` - FastMCP framework for MCP protocol
  - `uvicorn>=0.31.1` - HTTP server for MCP over HTTP
  - `pydantic>=2.11.7` - Tool parameter models

### `server.py`
- **Purpose**: Main WebSocket server implementation
- **Key Features**:
  - WebSocket server on localhost:8765
  - Extension connection management with proper cleanup
  - **Request/response correlation system** with unique ID tracking
  - **Pending requests map** with Future-based async response handling
  - **Ping-pong message handling** for connection testing
  - **Bidirectional ping functionality** (server can ping extension)
  - **send_request_and_wait method** with configurable timeouts
  - **Async ping testing methods** with correlation
  - **Test helper protocol** with 5 WebSocket test commands for automated UI validation:
    - `test.get_popup_state` - Get popup display state and test override status
    - `test.get_options_state` - Get options page configuration and warnings  
    - `test.get_storage_values` - Get raw storage.sync values
    - `test.validate_ui_sync` - Validate UI synchronization with expected values
    - `test.refresh_ui_state` - Trigger UI state refresh
  - **Response type handling** (success, error, timeout scenarios)
  - Message handling and comprehensive logging
  - Connection state tracking
  - Error handling and recovery
  - Async/await architecture
  - Graceful shutdown handling

### `mcp_tools.py`
- **Purpose**: FastMCP protocol integration and tool definitions
- **Key Features**:
  - **Modern FastMCP framework integration** with decorator-based tool definitions
  - **Complete MCP tool registry** with all browser functions:
    - **History**: query with search terms/time ranges, recent items
    - **Tabs**: list all tabs, create new tabs, close tabs, update tabs
    - **Content**: text extraction, HTML extraction, direct script execution, predefined script execution
    - **Navigation**: URL navigation, back/forward, reload with cache options
    - **Bookmarks**: list bookmarks tree, search bookmarks, create bookmarks and folders, update titles/URLs, remove bookmarks
  - **Comprehensive tool parameter definitions** with types and validation
  - **UUID-based request ID generation** for correlation tracking
  - **Complete action mapping** between MCP tools and WebSocket actions
  - **Full response correlation implementation** with timeout handling
  - **Response type processing** (success data extraction, error handling)
  - **30-second default timeout** for extension responses (`send_request_and_wait`)
  - **Failures as MCP errors**: a result that reads as a failure is raised as a `ToolError`, so the client sees `isError`
  - **Optional `status` argument** on the tools that act in a tab, shown on the page's overlay
  - **Real input**: click, hover, drag, type and press-key tools use `bidi.py` when Firefox has remote control, and scripted events otherwise
  - **Predefined Script Execution System**:
    - `content_execute_predefined()` - Execute external scripts that generate JavaScript
    - **Environment variable configuration**: `FOXMCP_EXT_SCRIPTS` directory path
    - **Security validation**: Path traversal protection, character validation, directory containment
    - **JSON argument support**: JSON array of strings or empty string for no arguments
    - **External script execution**: Subprocess execution with 30-second timeout
    - **JavaScript injection**: Generated script output executed in browser tabs
    - **Comprehensive error handling**: Script validation, execution, and browser injection errors

### `bidi.py`
- **Purpose**: Real (trusted) mouse and keyboard input through WebDriver BiDi
- **Key Features**:
  - Probes Firefox's usual remote control ports, 9222 to 9229 (`LIKELY_PORTS`)
  - `BidiSession`: one short session per action, since Firefox allows one at a time; a `session.new` that times out is ended in the background
  - Finds the tab by the token the content script set on `<html>` (`data-foxmcp-tab`)
  - Click, point click, hover, drag (with a slow-fast-slow move and short holds at each end), typing (line breaks as Shift+Enter) and key combinations such as `Control+a`

## Packaging and Plugin

### `pyproject.toml`
- **Purpose**: Makes the server an installable Python package, so `uvx --from git+https://github.com/MashdorDev/mcp-bridge-for-firefox@v1.8.1 mcp-bridge-for-firefox --stdio` runs it with no clone
- **Key Features**: Python 3.10 or newer; the code in `server/` is installed as the `mcp_bridge_for_firefox` package; the `mcp-bridge-for-firefox` command runs `server.run`

### `.claude-plugin/marketplace.json`
- **Purpose**: Lists the repo as a Claude Code plugin marketplace, so `claude plugin marketplace add MashdorDev/mcp-bridge-for-firefox` finds it
- **Key Features**: One plugin, `firefox`, whose source is `./claude-plugin`

### `claude-plugin/`
- **Purpose**: The plugin `claude plugin install firefox@mcp-bridge-for-firefox` installs
- **Files**:
  - `.claude-plugin/plugin.json`: name, display name, version and description
  - `.mcp.json`: registers the `firefox` MCP server as the `uvx` command above, pinned to the release tag, so Claude Code starts it in every session

## Communication Flow

1. **Extension Startup**: Firefox extension connects to WebSocket server with auto-retry
2. **MCP Request**: MCP client calls browser tool via FastMCP framework
3. **Request Generation**: MCP handler creates unique request with UUID-based ID
4. **Tool Mapping**: MCP handler maps tool name to WebSocket action
5. **Extension Forward**: Server sends request to extension via send_request_and_wait
6. **WebExtensions API**: Extension calls Firefox WebExtensions APIs (browser.history, browser.tabs, etc.)
7. **Response Correlation**: Extension sends response with matching request ID
8. **Future Completion**: Server correlates response and completes pending Future
9. **Response Chain**: Actual results flow back through WebSocket to MCP client
10. **Error Handling**: Timeouts, API errors, and connection issues handled gracefully

## Current Implementation Status

- ✅ **Basic Structure**: All directories and files created (26 files)
- ✅ **WebSocket Foundation**: Connection handling implemented with modern API
- ✅ **Message Protocol**: Request/response format defined and implemented
- ✅ **Tool Definitions**: MCP tools registered and mapped to browser actions
- ✅ **Unit Test Infrastructure**: Complete test suite with fixtures and runners
- ✅ **Ping-Pong Communication**: End-to-end connection testing implemented
- ✅ **Build System**: Makefile with complete development workflow
- ✅ **Documentation**: README, protocol spec, and project documentation
- ✅ **Virtual Environment**: Python venv with all dependencies installed
- ✅ **Comprehensive Test Suite**: 91 tests passing (47 unit + 44 integration), 74% code coverage, all tests enabled including automated UI validation
- ✅ **Firefox WebExtensions API Integration**: Complete browser.* API implementations for all handlers
- ✅ **Response Correlation**: Full async response handling with UUID-based correlation
- ✅ **Configuration System**: Configurable retry intervals and connection parameters
- ✅ **FastMCP Integration**: MCP over HTTP and over stdio
- ⏳ **Error Handling**: Comprehensive error scenarios (partially implemented)
- ⏳ **Integration Testing**: End-to-end testing with real Firefox extension and MCP client

## Tests Directory (`/tests`)

### `conftest.py`
- **Purpose**: Pytest configuration and shared fixtures
- **Key Features**:
  - Sample message fixtures (request, response, error)
  - Mock WebSocket and Chrome API objects
  - Test data fixtures (tabs, history, bookmarks)
  - Async test support configuration

### `pytest.ini`
- **Purpose**: Pytest configuration settings
- **Key Features**:
  - Test discovery patterns
  - Async test mode configuration
  - Coverage and reporting settings

### `requirements.txt`
- **Purpose**: Test-specific Python dependencies
- **Dependencies**: pytest, pytest-asyncio, pytest-mock, coverage, websockets

### `test_imports.py`
- **Purpose**: Test import system with automatic path configuration
- **Key Features**:
  - **Automatic project root detection** by locating 'server' package
  - **Zero-configuration path setup** - eliminates manual sys.path manipulation
  - **Symbolic link support** - available in subdirectories via symlinks
  - **Works everywhere** - pytest, direct execution, any working directory
  - **Debug utilities** - verification, status reporting, and troubleshooting
  - **Type hints and error handling** for robust operation
  - **CLI interface** for debugging import system status

### `run_tests.py`
- **Purpose**: Test runner script with coverage
- **Key Features**:
  - Run all tests with coverage reporting
  - Run unit tests only
  - Run integration tests only
  - HTML coverage reports

### Unit Tests (`/unit`)
- **`test_server.py`**: WebSocket server functionality tests
  
- **`test_protocol.py`**: Message format and data structure validation tests
- **`test_ping_pong.py`**: Ping-pong message handling and protocol tests

### Integration Tests (`/integration`)
- **`test_websocket_communication.py`**: End-to-end WebSocket communication tests
- **`test_ping_pong_integration.py`**: Ping-pong functionality integration tests
- **`test_ui_storage_sync.py`**: UI storage synchronization tests with real Firefox extension using test helper protocol
- **`test_test_helper_protocol.py`**: Unit tests for test helper protocol with mock WebSocket

## Build and Development System

### `Makefile`
- **Purpose**: Complete build system and development workflow
- **Key Features**:
  - **Setup and Installation**: `make setup` - Install all dependencies and setup test imports
  - **Test Import Management**: `make setup-test-imports` - Create symbolic links for test import system
  - **Building**: `make build` - Build extension package
  - **Testing**: `make test` - Run comprehensive test suite with coverage
  - **Unit Testing**: `make test-unit` - Run unit tests only (fast)
  - **Integration Testing**: `make test-integration` - Run integration tests with Firefox automation
  - **Development**: `make run-server` - Start WebSocket server
  - **Quality Assurance**: `make check` - Run linting and tests
  - **Packaging**: `make package` - Create distributable ZIP files
  - **Maintenance**: `make clean` - Clean build artifacts and remove symbolic links
  - **Status Monitoring**: `make status` - Check project status including test import system

### `claude.sh`
- **Purpose**: Claude Code integration script
- **Key Features**:
  - **Automatic FM_ROOT setup** - Sets environment variable to project root directory
  - **Argument pass-through** - Forwards all command line arguments to claude
  - **Project context** - Enables Claude Code to reference project paths in bash commands
  - **Zero configuration** - Automatically detects project root from script location

### `README.md`
- **Purpose**: Main project documentation and quick start guide
- **Key Features**:
  - **Quick Start**: Get running in 5 commands
  - **Complete Function Reference**: All browser APIs documented
  - **Development Workflow**: Step-by-step development process
  - **WebSocket Protocol**: Message format examples
  - **Troubleshooting Guide**: Common issues and solutions
  - **Architecture Diagram**: System overview with data flow

## Virtual Environment and Testing

### `venv/` - Python Virtual Environment
- **Python 3.10 or newer**, which is `fastmcp` 3's floor; development and CI run 3.14
- **Dependencies**: websockets, fastmcp, uvicorn, pydantic (server); pytest, pytest-asyncio, pytest-mock, pytest-cov, coverage, aiohttp (tests)
- **Created by** `make install` (server only) or `make setup` (server plus tests)
- **Usage**: `source venv/bin/activate`, or run `venv/bin/python` directly as the Makefile does

### `docs/venv-setup.md` - Setup Documentation
- Complete virtual environment setup instructions
- Package installation commands and verification steps
- Server and test running instructions

### Test Results (Current)
- **259 tests passing** - 107 unit and 152 integration, collected by `make test`
- **0 tests skipped** - a skip means Firefox was unusable, and CI fails the build on one
- **18 standalone drivers** - `tests/*.py`, run by hand, not collected by `make test`
- **HTML coverage reports** - Generated in tests/htmlcov/
- **Real Firefox integration** - Automated testing with temporary profiles and extension installation
- **Dynamic port allocation** - Tests use unique ports (9000-10999) to prevent conflicts
- **Robust fixture management** - Proper async cleanup and resource management
- **Response correlation testing** - All async handler tests passing
- **Multi-client testing** - Concurrent connection handling and server resilience testing
- **Extension configuration testing** - SQLite storage-based configuration injection and testing
- **Test override system** - Test configurations preserve and override regular extension settings

### Firefox Test Infrastructure (`tests/firefox_test_utils.py`)
- **Purpose**: Complete Firefox testing framework with automatic extension configuration
- **Key Features**:
  - **Temporary Firefox profile creation** with test-optimized preferences
  - **Extension installation and enablement** via extensions.json modification using jq
  - **SQLite storage configuration injection** - directly modifies storage-sync-v2.sqlite database
  - **Test configuration override system** - injects testPort/testHostname with priority over regular settings
  - **Firefox process management** - automated startup, initialization, and cleanup
  - **Dynamic port allocation integration** - works with port coordination system
  - **Context manager support** - automatic resource cleanup with proper error handling
  - **Extension XPI detection** - automatic location of built extension packages
  - **Profile isolation** - each test gets clean temporary profile to prevent conflicts

## Next Steps

1. ✅ ~~**Run existing tests** to validate current implementation: `make test`~~
2. ✅ ~~**Implement actual browser API calls** in extension handlers~~
3. ✅ ~~**Add response correlation** and async waiting in MCP handler~~
4. ✅ ~~**Integrate FastMCP server framework** for MCP protocol compliance~~
5. ✅ ~~**Add comprehensive error handling** for edge cases and permissions~~
6. ✅ ~~**Create testing framework and test cases**~~
7. ✅ ~~**Add ping-pong communication for connection validation**~~
8. ✅ ~~**Create build system and documentation**~~
9. ✅ ~~**Set up virtual environment and fix test infrastructure**~~
10. ✅ ~~**Complete window management functionality** with focus switching and cross-window operations~~
11. ✅ ~~**End-to-end integration testing** with real Firefox extension and MCP client~~
12. **Add logging and debugging capabilities** for production deployment
13. **Performance optimization and connection management** for multiple clients

This foundation provides a complete development environment with professional build tooling, comprehensive testing infrastructure, working Python environment, and full documentation for implementing the FoxMCP system with clear separation of concerns and validation.