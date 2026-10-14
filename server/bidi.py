#!/usr/bin/env python3
"""
Real (trusted) mouse and keyboard input through WebDriver BiDi

Events an extension dispatches are untrusted, and pages that check (Miro's
canvas and menus, file pickers, native context menus) ignore them. Firefox
started with --remote-debugging-port speaks WebDriver BiDi, whose
input.performActions produces events the page cannot tell from a person's.

Firefox allows one BiDi session at a time, and several MCP servers may share
a browser (one per Claude session), so each action opens a session, does its
work and ends it. That costs a few milliseconds and leaves no session behind
for another server to trip over.

The tab is found by a token the content script puts on the page just before:
the extension's tab ids and BiDi's browsing-context ids are unrelated.

Licensed under the MIT License - see LICENSE file for details
"""

import asyncio
import itertools
import json
import logging
from typing import Any, Dict, List

import websockets

logger = logging.getLogger(__name__)

# The attribute the content script sets on <html> so the tab can be found
TAB_TOKEN_ATTR = 'data-foxmcp-tab'
CONNECT_TIMEOUT = 3.0
COMMAND_TIMEOUT = 30.0
# A Firefox still restoring its tabs can take a while to open a session
SESSION_TIMEOUT = 15.0
LATE_SESSION_WAIT = 120.0
# Keys per performActions call, so a long text does not become one huge message
KEYS_PER_BATCH = 200

# KeyboardEvent.key names to WebDriver key codes
SPECIAL_KEYS = {
    'Enter': '', 'Return': '', 'Tab': '', 'Escape': '', 'Esc': '',
    'Backspace': '', 'Delete': '', 'Space': ' ', ' ': ' ',
    'ArrowLeft': '', 'ArrowUp': '', 'ArrowRight': '', 'ArrowDown': '',
    'Home': '', 'End': '', 'PageUp': '', 'PageDown': '', 'Insert': '',
    'Shift': '', 'Control': '', 'Ctrl': '', 'Alt': '',
    'Meta': '', 'Command': '',
    **{f'F{n}': chr(0xE031 + n - 1) for n in range(1, 13)},
}


class BidiUnavailable(Exception):
    """Firefox is not listening for BiDi on that port, or the tab was not found"""


class BidiSession:
    """One short BiDi session: `async with BidiSession(port) as bidi:`"""

    _ids = itertools.count(1)

    def __init__(self, port: int):
        self.port = port
        self.ws = None

    async def __aenter__(self):
        try:
            self.ws = await asyncio.wait_for(
                websockets.connect(f'ws://127.0.0.1:{self.port}/session', max_size=None),
                CONNECT_TIMEOUT)
        except (OSError, asyncio.TimeoutError, websockets.WebSocketException) as error:
            raise BidiUnavailable(f'Firefox is not accepting real input on port {self.port}: {error}')
        try:
            await self.command('session.new', {'capabilities': {}}, timeout=SESSION_TIMEOUT)
        except asyncio.TimeoutError:
            # Firefox may still create the session after we stop waiting, and
            # it allows only one: it would be stuck until Firefox restarts. So
            # the reply is still awaited, and the session ended, in the background.
            asyncio.create_task(self._end_late_session())
            raise BidiUnavailable("Firefox's remote control did not answer in time")
        except Exception:
            await self.ws.close()
            raise
        return self

    async def _end_late_session(self):
        try:
            while True:
                message = json.loads(await asyncio.wait_for(self.ws.recv(), LATE_SESSION_WAIT))
                if message.get('type') == 'success' and 'sessionId' in message.get('result', {}):
                    await self.command('session.end', {})
                    break
        except Exception:
            pass
        finally:
            await self.ws.close()

    async def __aexit__(self, *exc):
        try:
            await self.command('session.end', {})
        except Exception:
            pass
        await self.ws.close()

    async def command(self, method: str, params: Dict[str, Any], timeout: float = COMMAND_TIMEOUT) -> Dict[str, Any]:
        command_id = next(self._ids)
        await self.ws.send(json.dumps({'id': command_id, 'method': method, 'params': params}))
        while True:
            message = json.loads(await asyncio.wait_for(self.ws.recv(), timeout))
            if message.get('id') != command_id:
                continue  # an event, or an older reply
            if message.get('type') == 'error':
                if method == 'session.new' and message.get('error') == 'session not created':
                    raise BidiUnavailable(f"Firefox's remote control is busy: {message.get('message')}")
                raise RuntimeError(f"{method}: {message.get('error')}: {message.get('message')}")
            return message['result']

    async def find_tab(self, token: str) -> str:
        """The browsing context of the tab the content script marked with token"""
        tree = await self.command('browsingContext.getTree', {'maxDepth': 0})
        for context in tree['contexts']:
            try:
                found = await self.command('script.evaluate', {
                    'target': {'context': context['context'], 'sandbox': 'foxmcp'},
                    'expression': f"document.documentElement.getAttribute('{TAB_TOKEN_ATTR}')",
                    'awaitPromise': False})
            except RuntimeError:
                continue  # a privileged page (about:, view-source) scripts cannot reach
            if found.get('result', {}).get('value') == token:
                return context['context']
        raise BidiUnavailable('The tab was not found through remote control')

    async def element(self, context: str, selector: str) -> str:
        found = await self.command('script.evaluate', {
            'target': {'context': context, 'sandbox': 'foxmcp'},
            'expression': f'document.querySelector({json.dumps(selector)})',
            'awaitPromise': False})
        shared_id = found.get('result', {}).get('sharedId')
        if not shared_id:
            raise RuntimeError(f'No element matches {selector}')
        return shared_id

    async def click(self, context: str, element: str, button: int = 0, clicks: int = 1):
        steps: List[Dict[str, Any]] = [{
            'type': 'pointerMove', 'x': 0, 'y': 0, 'duration': 0,
            'origin': {'type': 'element', 'element': {'sharedId': element}}}]
        for _ in range(clicks):
            steps += [{'type': 'pointerDown', 'button': button}, {'type': 'pointerUp', 'button': button}]
        await self.command('input.performActions', {'context': context, 'actions': [{
            'type': 'pointer', 'id': 'mouse', 'parameters': {'pointerType': 'mouse'}, 'actions': steps}]})
        await self.command('input.releaseActions', {'context': context})

    async def keys(self, context: str, steps: List[Dict[str, Any]]):
        for start in range(0, len(steps), KEYS_PER_BATCH * 2):
            await self.command('input.performActions', {'context': context, 'actions': [{
                'type': 'key', 'id': 'keyboard', 'actions': steps[start:start + KEYS_PER_BATCH * 2]}]})
        await self.command('input.releaseActions', {'context': context})

    async def type_text(self, context: str, text: str):
        steps = []
        for char in text:
            value = SPECIAL_KEYS['Enter'] if char == '\n' else char
            steps += [{'type': 'keyDown', 'value': value}, {'type': 'keyUp', 'value': value}]
        await self.keys(context, steps)

    async def press(self, context: str, combo: str):
        """A key, or a combination such as "Control+a" or "Shift+Tab" """
        names = [part for part in combo.split('+') if part] if len(combo) > 1 else [combo]
        values = [SPECIAL_KEYS.get(name, name) for name in names]
        for value, name in zip(values, names):
            if len(value) != 1:
                raise ValueError(f'Unknown key "{name}"')
        steps = [{'type': 'keyDown', 'value': v} for v in values]
        steps += [{'type': 'keyUp', 'value': v} for v in reversed(values)]
        await self.keys(context, steps)

