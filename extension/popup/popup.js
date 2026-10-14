/*
 * MCP Bridge for Firefox - toolbar popup
 * Licensed under the MIT License - see LICENSE file for details
 *
 * A status panel: whether a server is connected, which other Claude sessions
 * share this browser, and the tabs an agent is working in. Settings live on
 * the options page.
 */

const $ = id => document.getElementById(id);

// The one line that installs and registers the server on a new computer,
// pinned to this add-on's version so the two halves match
const SETUP_COMMAND = 'claude mcp add firefox -- uvx --from ' +
  `git+https://github.com/MashdorDev/mcp-bridge-for-firefox@v${browser.runtime.getManifest().version} ` +
  'mcp-bridge-for-firefox --stdio';

async function render() {
  const status = await browser.runtime.sendMessage({ action: 'getConnectionStatus' })
    .catch(() => ({ connected: false, config: {}, extraPorts: [], agentTabs: [] }));
  const { config = {}, extraPorts = [], agentTabs = [] } = status;
  const url = `ws://${config.hostname || 'localhost'}:${config.port || 8765}`;

  $('dot').classList.toggle('on', status.connected);
  $('statusText').textContent = status.connected ? 'Connected' : 'Not connected';
  if (status.connected) {
    $('servers').textContent = extraPorts.length
      ? `${url}, and ${extraPorts.length} more session${extraPorts.length > 1 ? 's' : ''} on ${extraPorts.join(', ')}`
      : url;
  } else {
    $('servers').textContent = status.retryAttempts
      ? `Trying ${url} again (attempt ${status.retryAttempts}). Is a Claude session with the bridge running?`
      : `Waiting for a server at ${url}`;
  }

  // Not connected: either no Claude Code session is running, or the server was
  // never set up on this computer, so say how to set it up
  $('setup').hidden = status.connected || (status.extraPorts || []).length > 0;

  $('browserName').textContent = status.browserName || 'unnamed';
  $('browserName').classList.toggle('muted', !status.browserName);

  $('agentSection').hidden = !agentTabs.length;
  $('agentCount').textContent = `Agent working in ${agentTabs.length} tab${agentTabs.length > 1 ? 's' : ''}`;
  $('tabs').replaceChildren(...agentTabs.map(tab => {
    const item = document.createElement('li');
    const open = document.createElement('button');
    open.className = 'link';
    open.title = 'Go to this tab';
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = tab.title;
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = tab.label;
    open.append(title, label);
    open.addEventListener('click', async () => {
      const { windowId } = await browser.tabs.update(tab.tabId, { active: true });
      await browser.windows.update(windowId, { focused: true });
      window.close();
    });
    const release = document.createElement('button');
    release.className = 'release';
    release.textContent = 'Release';
    release.title = 'Take the agent overlay off this tab';
    release.addEventListener('click', async () => {
      await browser.runtime.sendMessage({ action: 'releaseAgentTab', tabId: tab.tabId });
      render();
    });
    item.append(open, release);
    return item;
  }));

  const { followAgent, paused, realInput, realInputPort } = await loadSettings();
  $('realInput').textContent = !realInput ? 'Real input: off'
    : realInputPort ? `Real input: on, port ${realInputPort}` : 'Real input: on when Firefox allows it';
  $('followAgent').checked = followAgent;
  $('paused').checked = paused;
  $('pausedNote').hidden = !paused;
}

$('version').textContent = `v${browser.runtime.getManifest().version}`;
$('setupCommand').textContent = SETUP_COMMAND;

$('copySetup').addEventListener('click', async () => {
  await navigator.clipboard.writeText(SETUP_COMMAND);
  $('copySetup').textContent = 'Copied';
  setTimeout(() => { $('copySetup').textContent = 'Copy command'; }, 1500);
});

$('followAgent').addEventListener('change', event =>
  browser.storage.local.set({ followAgent: event.target.checked }));

$('paused').addEventListener('change', async event => {
  await browser.storage.local.set({ paused: event.target.checked });
  render();
});

$('reconnect').addEventListener('click', async () => {
  $('statusText').textContent = 'Reconnecting';
  await browser.runtime.sendMessage({ action: 'forceReconnect' });
  setTimeout(render, 800);
});

$('settings').addEventListener('click', () => {
  browser.runtime.openOptionsPage();
  window.close();
});

$('rename').addEventListener('click', event => {
  event.preventDefault();
  browser.runtime.openOptionsPage();
  window.close();
});

render();
