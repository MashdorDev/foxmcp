/*
 * MCP Bridge for Firefox - toolbar popup
 * Licensed under the MIT License - see LICENSE file for details
 *
 * A status panel: whether a server is connected, which other Claude sessions
 * share this browser, and the tabs an agent is working in. Settings live on
 * the options page.
 */

const $ = id => document.getElementById(id);

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

  const { followAgent, paused } = await loadSettings();
  $('followAgent').checked = followAgent;
  $('paused').checked = paused;
  $('pausedNote').hidden = !paused;
}

$('version').textContent = `v${browser.runtime.getManifest().version}`;

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
