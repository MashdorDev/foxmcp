"""
The agent overlay, against real Firefox

The overlay used to appear only once the agent snapshotted, clicked or typed, so
a session that opened a tab and read it showed nothing for its first several
actions. Opening a tab and navigating now show it too: these run in the
background script, which tells the page once it has loaded.

The overlay is read with content_execute_script, which now shows the overlay as
well, so these tests catch the old behaviour (no overlay from any of these
tools) but can't tell which of the calls showed it.
"""

import asyncio
import re

import pytest

import test_imports  # Automatic path setup
from mcp_client_harness import DirectMCPTestClient


OVERLAY_STATE = (
    "(() => { const host = document.getElementById('foxmcp-agent-overlay');"
    " return host ? 'overlay:' + host.style.opacity : 'no overlay' })()"
)

# Long enough for example.org to load and the content script to start
LOAD_SECONDS = 3.0


async def call(client, name, args=None):
    """Call an MCP tool, failing the test if the call itself did not succeed"""
    result = await client.call_tool(name, args or {})
    assert result.get("success", False), f"{name} should succeed: {result}"
    return result.get("content", "")


async def overlay_state(client, tab_id):
    return await call(client, "content_execute_script", {"tab_id": tab_id, "code": OVERLAY_STATE})


class TestOverlayFromTheFirstAction:

    @pytest.mark.asyncio
    async def test_a_new_tab_shows_the_overlay(self, server_with_extension):
        client = DirectMCPTestClient(server_with_extension['server'].mcp_tools)
        await client.connect()
        tab_id = None
        try:
            created = await call(client, "tabs_create", {"url": "https://example.org/overlay-new-tab", "active": True})
            match = re.search(r'ID (\d+)', created)
            assert match, f"Could not read the new tab's ID from: {created}"
            tab_id = int(match.group(1))

            await asyncio.sleep(LOAD_SECONDS)
            assert "overlay:1" in await overlay_state(client, tab_id), \
                "Opening a tab should show the overlay once the page loads"
        finally:
            if tab_id is not None:
                await client.call_tool("tabs_close", {"tab_id": tab_id})
            await client.disconnect()

    @pytest.mark.asyncio
    async def test_navigating_shows_the_overlay_on_the_new_page(self, server_with_extension):
        client = DirectMCPTestClient(server_with_extension['server'].mcp_tools)
        await client.connect()
        tab_id = None
        try:
            created = await call(client, "tabs_create", {"url": "https://example.org/overlay-start", "active": True})
            tab_id = int(re.search(r'ID (\d+)', created).group(1))
            await asyncio.sleep(LOAD_SECONDS)

            await call(client, "navigation_go_to_url", {"tab_id": tab_id, "url": "https://example.org/overlay-next"})
            await asyncio.sleep(LOAD_SECONDS)

            state = await call(client, "content_execute_script", {
                "tab_id": tab_id,
                "code": "location.pathname + ' ' + " + OVERLAY_STATE,
            })
            assert "/overlay-next" in state, f"The probe should run on the new page: {state}"
            assert "overlay:1" in state, "Navigating should show the overlay on the page it lands on"
        finally:
            if tab_id is not None:
                await client.call_tool("tabs_close", {"tab_id": tab_id})
            await client.disconnect()
