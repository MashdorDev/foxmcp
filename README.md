# MCP Bridge for Firefox

Let Claude, Cursor or any MCP client use your everyday Firefox. The agent can read pages, click, type, upload files and whole folders, and take screenshots, in the tabs you already have open and signed in.

It is a regular Firefox add-on plus a small local MCP server. Firefox does **not** run in automation mode: no `navigator.webdriver`, no striped address bar, no special launch flags. Tools built on Marionette or WebDriver BiDi (Playwright, Selenium, firefox-devtools-mcp) need those, and sites with bot checks notice.

Based on [FoxMCP](https://github.com/ThinkerYzu/foxmcp) by ThinkerYzu (MIT). The interaction, overlay, upload and reconnect changes are also offered upstream as pull requests.

## What it can do

- **Read and act on pages:** list a page's interactive elements with stable refs, then click, double-click, type into and press keys on them. Typing works with React and Vue inputs.
- **Upload files and folders:** put a local file or a whole folder on a page's file input. Folders keep their structure where the site supports folder upload, and buttons that open a file dialog are handled without the dialog.
- **See what it's doing:** while the agent acts on a tab, an orange border, a label and a moving cursor show it. They fade when it stops and stay out of screenshots.
- **Tabs, windows, navigation, screenshots, history, bookmarks** and **network request monitoring**, from FoxMCP.
- **Any MCP client:** Claude Code, Claude Desktop, Cursor, VS Code, Codex, Gemini CLI and others.

## Install

### 1. The add-on

Install **MCP Bridge for Firefox** from Firefox Add-ons (listing in review). Until then, a signed build can be installed from this repo's releases.

### 2. The MCP server

Python 3.10 or newer.

```bash
git clone https://github.com/MashdorDev/mcp-bridge-for-firefox.git
cd mcp-bridge-for-firefox
python -m venv venv
venv/bin/pip install -r server/requirements.txt        # Windows: venv\Scripts\pip
```

### 3. Connect your AI client

Claude Code, letting the client start the server:

```bash
claude mcp add firefox -- /path/to/mcp-bridge-for-firefox/venv/bin/python /path/to/mcp-bridge-for-firefox/server/server.py --stdio
```

Any client that reads an `mcp.json` (Cursor, Claude Desktop, VS Code):

```json
{
  "mcpServers": {
    "firefox": {
      "command": "/path/to/mcp-bridge-for-firefox/venv/bin/python",
      "args": ["/path/to/mcp-bridge-for-firefox/server/server.py", "--stdio"]
    }
  }
}
```

The add-on connects to the server on `localhost:8765` and keeps retrying while no server is running, so start order doesn't matter. Under `--stdio` only one client at a time gets the browser; to share it between several, run the server in HTTP mode (`python server/server.py`) and point clients at `http://localhost:3000/mcp/`. See [docs/configuration.md](docs/configuration.md).

## Privacy

The add-on sends page content, tab URLs, bookmarks, history and network activity only to the MCP server on your own machine, and only when your AI client asks for it. From there it goes to the AI client you connected, and to that client's provider. Nothing is sent to us. See [PRIVACY.md](PRIVACY.md).

Use it with AI clients you trust, and consider a separate Firefox profile for agent work.

## Docs

- [Tools reference](docs/api-reference.md)
- [Configuration](docs/configuration.md)
- [Protocol between server and add-on](docs/protocol.md)
- [Architecture](docs/architecture.md)
- [Security model](SECURITY.md)

## Limits

- Clicks and typing are synthetic events. Most sites accept them; a few ignore them, such as some login forms and anti-bot checks.
- Pages Firefox protects from add-ons (`about:` pages, addons.mozilla.org) can't be driven.
- Uploads stream through the local connection in 512 KB chunks: fine for project files, slow for multi-gigabyte ones.

## License

MIT. See [LICENSE](LICENSE). Copyright notices from FoxMCP are kept in the source files.
