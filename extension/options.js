/*
 * MCP Bridge for Firefox - options page
 * Licensed under the MIT License - see LICENSE file for details
 *
 * Every field saves as it changes. Name, follow, host and port are per profile
 * (storage.local), since Firefox Sync would copy synced values to every
 * profile on the account; the retry settings stay in storage.sync, where older
 * versions kept them. Test overrides (testPort/testHostname, set by the test
 * suite) win over the saved host and port, and the page says so.
 */

const $ = id => document.getElementById(id);

const DEFAULTS = {
  local: { hostname: 'localhost', port: 8765, browserName: '', followAgent: false },
  sync: { retryInterval: 5000, maxRetries: -1, pingTimeout: 5000 },
};
const ADVANCED = {
  retryInterval: { min: 1000, max: 60000, message: 'Use 1000 to 60000 ms' },
  maxRetries: { min: -1, max: 100, message: 'Use -1, or 0 to 100' },
  pingTimeout: { min: 1000, max: 30000, message: 'Use 1000 to 30000 ms' },
};
const SAVED_SHOWN_MS = 1500;

function flashSaved(key) {
  const note = document.querySelector(`.saved[data-for="${key}"]`);
  if (!note) return;
  note.hidden = false;
  clearTimeout(note.timer);
  note.timer = setTimeout(() => { note.hidden = true; }, SAVED_SHOWN_MS);
}

function setError(id, message) {
  $(`${id}Error`).textContent = message || '';
  $(id).setAttribute('aria-invalid', message ? 'true' : 'false');
}

async function load() {
  const sync = await browser.storage.sync.get({ ...DEFAULTS.sync, hostname: null, port: null, testPort: null, testHostname: null });
  const local = await browser.storage.local.get({ ...DEFAULTS.local, hostname: null, port: null });
  // Older versions saved host and port to storage.sync
  $('hostname').value = local.hostname || sync.hostname || DEFAULTS.local.hostname;
  $('port').value = local.port || sync.port || DEFAULTS.local.port;
  $('browserName').value = local.browserName;
  $('followAgent').checked = local.followAgent;
  for (const id of Object.keys(ADVANCED)) $(id).value = sync[id];

  const testing = sync.testPort || sync.testHostname;
  $('testNotice').hidden = !testing;
  if (testing) {
    $('testNotice').textContent = `The test suite has set ${sync.testHostname || 'the host'}` +
      `${sync.testPort ? ':' + sync.testPort : ''}, which is used instead of the host and port below.`;
  }
}

async function refreshStatus() {
  const status = await browser.runtime.sendMessage({ action: 'getConnectionStatus' }).catch(() => null);
  const connected = Boolean(status && status.connected);
  const config = (status && status.config) || {};
  const extra = (status && status.extraPorts) || [];
  $('dot').classList.toggle('on', connected);
  $('statusText').textContent = connected
    ? (extra.length ? `Connected to ${1 + extra.length} sessions` : 'Connected')
    : 'Not connected';
  $('url').textContent = `ws://${config.hostname || $('hostname').value}:${config.port || $('port').value}`;
}

let nameTimer;
$('browserName').addEventListener('input', () => {
  clearTimeout(nameTimer);
  nameTimer = setTimeout(async () => {
    await browser.storage.local.set({ browserName: $('browserName').value.trim().slice(0, 60) });
    flashSaved('browserName');
  }, 400);
});

$('followAgent').addEventListener('change', async () => {
  await browser.storage.local.set({ followAgent: $('followAgent').checked });
  flashSaved('followAgent');
});

async function saveConnection() {
  const hostname = $('hostname').value.trim();
  const port = Number($('port').value);
  setError('hostname', hostname ? '' : 'Enter a host, such as localhost');
  setError('port', Number.isInteger(port) && port >= 1 && port <= 65535 ? '' : 'Use a port from 1 to 65535');
  if (!hostname || $('port').getAttribute('aria-invalid') === 'true') return;
  await browser.storage.local.set({ hostname, port });
  await browser.runtime.sendMessage({ type: 'configUpdated', config: { hostname, port } });
  flashSaved('connection');
  setTimeout(refreshStatus, 800);
}
$('hostname').addEventListener('change', saveConnection);
$('port').addEventListener('change', saveConnection);

for (const [id, range] of Object.entries(ADVANCED)) {
  $(id).addEventListener('change', async () => {
    const value = Number($(id).value);
    const valid = Number.isInteger(value) && value >= range.min && value <= range.max;
    setError(id, valid ? '' : range.message);
    if (!valid) return;
    await browser.storage.sync.set({ [id]: value });
    await browser.runtime.sendMessage({ type: 'advancedConfigUpdated', config: { [id]: value } });
    flashSaved('advanced');
  });
}

$('reconnect').addEventListener('click', async () => {
  $('statusText').textContent = 'Reconnecting';
  await browser.runtime.sendMessage({ action: 'forceReconnect' });
  setTimeout(refreshStatus, 800);
});

// A second press within a few seconds confirms, so a stray click cannot wipe
// the settings and no modal dialog is needed
let resetArmed;
$('reset').addEventListener('click', async () => {
  if (!resetArmed) {
    $('reset').textContent = 'Press again to reset';
    resetArmed = setTimeout(() => {
      resetArmed = null;
      $('reset').textContent = 'Reset all settings';
    }, 4000);
    return;
  }
  clearTimeout(resetArmed);
  resetArmed = null;
  $('reset').textContent = 'Reset all settings';
  await browser.storage.local.set(DEFAULTS.local);
  await browser.storage.sync.set(DEFAULTS.sync);
  await browser.runtime.sendMessage({ type: 'configUpdated', config: { ...DEFAULTS.sync, hostname: DEFAULTS.local.hostname, port: DEFAULTS.local.port } });
  await load();
  flashSaved('advanced');
  setTimeout(refreshStatus, 800);
});

load().then(refreshStatus);
setInterval(refreshStatus, 3000);
