#!/usr/bin/env python3
"""
What server/bidi.py asks Firefox to do, checked without a browser

Copyright (c) 2024 FoxMCP Project
Licensed under the MIT License - see LICENSE file for details
"""

import pytest

import test_imports  # Automatic path setup
from server.bidi import BidiSession, BidiUnavailable, SPECIAL_KEYS


class RecordingSession(BidiSession):
    """Records commands instead of sending them"""

    def __init__(self, tree=None, marks=None):
        super().__init__(0)
        self.sent = []
        self.tree = tree or []
        self.marks = marks or {}

    async def command(self, method, params):
        self.sent.append((method, params))
        if method == 'browsingContext.getTree':
            return {'contexts': [{'context': c} for c in self.tree]}
        if method == 'script.evaluate':
            return {'result': {'value': self.marks.get(params['target']['context'])}}
        return {}


def key_steps(session):
    return [step for method, params in session.sent if method == 'input.performActions'
            for source in params['actions'] for step in source['actions']]


@pytest.mark.asyncio
async def test_a_combination_holds_the_modifier_around_the_key():
    session = RecordingSession()
    await session.press('ctx', 'Control+a')
    assert key_steps(session) == [
        {'type': 'keyDown', 'value': SPECIAL_KEYS['Control']}, {'type': 'keyDown', 'value': 'a'},
        {'type': 'keyUp', 'value': 'a'}, {'type': 'keyUp', 'value': SPECIAL_KEYS['Control']}]


@pytest.mark.asyncio
async def test_a_plus_sign_on_its_own_is_a_key():
    session = RecordingSession()
    await session.press('ctx', '+')
    assert key_steps(session) == [{'type': 'keyDown', 'value': '+'}, {'type': 'keyUp', 'value': '+'}]


@pytest.mark.asyncio
async def test_an_unknown_key_name_is_refused():
    with pytest.raises(ValueError, match='Unknown key "Hyper"'):
        await RecordingSession().press('ctx', 'Hyper')


@pytest.mark.asyncio
async def test_a_newline_is_shift_enter_so_a_chat_box_does_not_send():
    session = RecordingSession()
    await session.type_text('ctx', 'a\nb')
    values = [step['value'] for step in key_steps(session) if step['type'] == 'keyDown']
    assert values == ['a', SPECIAL_KEYS['Shift'], SPECIAL_KEYS['Enter'], 'b']


@pytest.mark.asyncio
async def test_a_long_text_is_sent_in_batches():
    session = RecordingSession()
    await session.type_text('ctx', 'x' * 450)
    batches = [params for method, params in session.sent if method == 'input.performActions']
    assert len(batches) == 3
    assert len(key_steps(session)) == 900


@pytest.mark.asyncio
async def test_the_tab_is_found_by_its_token():
    session = RecordingSession(tree=['one', 'two'], marks={'two': 'token-2'})
    assert await session.find_tab('token-2') == 'two'


@pytest.mark.asyncio
async def test_a_tab_without_the_token_is_unavailable():
    session = RecordingSession(tree=['one'], marks={'one': 'other'})
    with pytest.raises(BidiUnavailable):
        await session.find_tab('token')


def pointer_steps(session):
    return [step for method, params in session.sent if method == 'input.performActions'
            for source in params['actions'] if source['type'] == 'pointer' for step in source['actions']]


@pytest.mark.asyncio
async def test_a_drag_presses_moves_in_steps_and_releases():
    session = RecordingSession()
    await session.drag('ctx', {'x': 10, 'y': 20}, {'x': 210, 'y': 120})
    steps = pointer_steps(session)
    assert steps[0] == {'type': 'pointerMove', 'x': 10, 'y': 20, 'duration': 0, 'origin': 'viewport'}
    assert steps[1] == {'type': 'pointerDown', 'button': 0}
    moves = [s for s in steps[2:] if s['type'] == 'pointerMove']
    assert len(moves) > 5
    assert (moves[-1]['x'], moves[-1]['y']) == (210, 120)
    assert steps[-1] == {'type': 'pointerUp', 'button': 0}
    # held at both ends, which apps wait for before a drag starts or drops
    assert steps[2]['type'] == 'pause' and steps[-2]['type'] == 'pause'


@pytest.mark.asyncio
async def test_a_point_click_happens_where_it_was_asked():
    session = RecordingSession()
    await session.click_at('ctx', 300, 40, button=2)
    assert pointer_steps(session) == [
        {'type': 'pointerMove', 'x': 300, 'y': 40, 'duration': 0, 'origin': 'viewport'},
        {'type': 'pointerDown', 'button': 2}, {'type': 'pointerUp', 'button': 2}]


@pytest.mark.asyncio
async def test_a_hover_only_moves():
    session = RecordingSession()
    await session.hover('ctx', 5, 6)
    assert [s['type'] for s in pointer_steps(session)] == ['pointerMove']
