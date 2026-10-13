"""
A full-window screenshot reaches the server as one base64 message of several
MB. The websockets library closes the connection on anything over 1 MiB by
default, which made screenshots of busy pages time out.
"""

import asyncio
import json

import pytest
import pytest_asyncio

import test_imports  # Automatic path setup
from server.server import FoxMCPServer
from port_coordinator import get_port_by_type
from test_config import connect_as_extension


@pytest_asyncio.fixture
async def server():
    server = FoxMCPServer(
        host="localhost",
        port=get_port_by_type('test_individual'),
        mcp_port=get_port_by_type('test_mcp_individual'),
        start_mcp=False
    )
    server_task = asyncio.create_task(server.start_server())
    await asyncio.sleep(0.5)

    yield server

    await server.shutdown(server_task)


@pytest.mark.asyncio
async def test_screenshot_sized_message_keeps_the_connection(server):
    """A 5 MB response arrives and the extension stays connected"""
    async with connect_as_extension(f"ws://localhost:{server.port}") as ws:
        await asyncio.sleep(0.2)
        await ws.send(json.dumps({
            "id": "big", "type": "response", "action": "tabs.captureVisibleTab",
            "data": {"dataUrl": "data:image/png;base64," + "A" * (5 * 1024 * 1024)},
        }))
        await asyncio.sleep(0.5)
        await ws.ping()
        assert server.extension_connection is not None
