/*
 * FoxMCP Firefox Extension - Content Script
 * Copyright (c) 2024 FoxMCP Project
 * Licensed under the MIT License - see LICENSE file for details
 */


// Elements a snapshot lists. Anything clickable or editable, plus headings so
// the listing reads as an outline of the page rather than a bag of controls.
const INTERACTIVE_SELECTOR = [
  'a[href]', 'button', 'input', 'select', 'textarea', 'summary', 'label',
  '[role=button]', '[role=link]', '[role=checkbox]', '[role=radio]', '[role=switch]',
  '[role=tab]', '[role=menuitem]', '[role=option]', '[role=combobox]', '[role=textbox]',
  '[role=row]', '[contenteditable=""]', '[contenteditable=true]', '[tabindex]:not([tabindex="-1"])',
  'h1', 'h2', 'h3'
].join(',');

const REF_ATTR = 'data-foxmcp-ref';
let nextRef = 1;

function isVisible(el) {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return false;
  }
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
}

// A ref stays on its element across snapshots, so a ref read from one
// snapshot still works after the page re-renders other parts of itself.
function refFor(el) {
  let ref = el.getAttribute(REF_ATTR);
  if (!ref) {
    ref = 'r' + nextRef++;
    el.setAttribute(REF_ATTR, ref);
  }
  return ref;
}

function describe(el) {
  const role = el.getAttribute('role') || el.tagName.toLowerCase();
  const name = (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder ||
    el.title || el.alt || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const extras = [];
  if (el.type && el.tagName === 'INPUT') extras.push('type=' + el.type);
  if (el.disabled) extras.push('disabled');
  if (el.checked) extras.push('checked');
  if (el.getAttribute('aria-selected') === 'true') extras.push('selected');
  return `[${refFor(el)}] ${role} "${name}"${extras.length ? ' (' + extras.join(', ') + ')' : ''}`;
}

function snapshot(maxElements) {
  const lines = [];
  for (const el of document.querySelectorAll(INTERACTIVE_SELECTOR)) {
    if (!isVisible(el)) continue;
    lines.push(describe(el));
    if (lines.length >= maxElements) {
      lines.push(`... truncated at ${maxElements} elements`);
      break;
    }
  }
  return lines.join('\n');
}

// Where an action happens: an element (by ref or selector), scrolled into view,
// or a point given as x and y in the viewport, for canvases. Returns the point
// and whatever element is there.
function targetPoint({ ref, selector, x, y }) {
  if (ref || selector) {
    const el = findTarget({ ref, selector });
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, el, size: Math.min(rect.width, rect.height) };
  }
  if (typeof x !== 'number' || typeof y !== 'number') {
    throw new Error('Give an element (ref or selector) or a point (x and y)');
  }
  if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) {
    throw new Error(`The point ${x},${y} is outside the visible page (${innerWidth}x${innerHeight})`);
  }
  return { x, y, el: document.elementFromPoint(x, y) || document.body, size: 24 };
}

function mouseInit(point, extra = {}) {
  return { bubbles: true, cancelable: true, composed: true, view: window, clientX: point.x, clientY: point.y,
    screenX: point.x + window.screenX, screenY: point.y + window.screenY, pointerId: 1, pointerType: 'mouse',
    isPrimary: true, button: 0, ...extra };
}

// Scripted hover: what a mouse moving onto the point fires
function hoverAt(point) {
  const init = mouseInit(point);
  for (const type of ['pointerover', 'pointerenter', 'pointermove']) point.el.dispatchEvent(new PointerEvent(type, init));
  for (const type of ['mouseover', 'mouseenter', 'mousemove']) point.el.dispatchEvent(new MouseEvent(type, init));
}

// Scripted drag: the pointer and mouse events along the way, and the page's
// drag-and-drop events when the element it starts on is draggable
function usesPageDragAndDrop(el) {
  return Boolean(el.closest('[draggable="true"]') || (el.closest('a[href], img') && !el.closest('[draggable="false"]')));
}

async function dragBetween(from, to, steps = 12) {
  // A slider ignores scripted mouse events: set the value the drop point means
  const range = from.el.closest('input[type="range"]');
  if (range) {
    const rect = range.getBoundingClientRect();
    const share = Math.min(1, Math.max(0, (to.x - rect.left) / rect.width));
    const min = Number(range.min || 0), max = Number(range.max || 100);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(range, String(min + share * (max - min)));
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  const transfer = new DataTransfer();
  const draggable = usesPageDragAndDrop(from.el) ? from.el.closest('[draggable="true"], a[href], img') : null;
  from.el.dispatchEvent(new PointerEvent('pointerdown', mouseInit(from, { buttons: 1 })));
  from.el.dispatchEvent(new MouseEvent('mousedown', mouseInit(from, { buttons: 1 })));
  if (draggable) draggable.dispatchEvent(new DragEvent('dragstart', { ...mouseInit(from), dataTransfer: transfer }));
  let over = from.el;
  for (let i = 1; i <= steps; i++) {
    const t = minimumJerk(i / steps);
    const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    const el = document.elementFromPoint(point.x, point.y) || document.body;
    el.dispatchEvent(new PointerEvent('pointermove', mouseInit(point, { buttons: 1 })));
    el.dispatchEvent(new MouseEvent('mousemove', mouseInit(point, { buttons: 1 })));
    if (draggable) {
      if (el !== over) el.dispatchEvent(new DragEvent('dragenter', { ...mouseInit(point), dataTransfer: transfer }));
      el.dispatchEvent(new DragEvent('dragover', { ...mouseInit(point), dataTransfer: transfer }));
    }
    over = el;
    await new Promise(resolve => setTimeout(resolve, 16));
  }
  const end = document.elementFromPoint(to.x, to.y) || document.body;
  if (draggable) {
    end.dispatchEvent(new DragEvent('drop', { ...mouseInit(to), dataTransfer: transfer }));
    draggable.dispatchEvent(new DragEvent('dragend', { ...mouseInit(to), dataTransfer: transfer }));
  }
  end.dispatchEvent(new PointerEvent('pointerup', mouseInit(to)));
  end.dispatchEvent(new MouseEvent('mouseup', mouseInit(to)));
}

function findTarget({ ref, selector }) {
  const el = ref
    ? document.querySelector(`[${REF_ATTR}="${CSS.escape(ref)}"]`)
    : document.querySelector(selector);
  if (!el) {
    throw new Error(ref ? `No element with ref ${ref}; take a new snapshot` : `No element matches ${selector}`);
  }
  return el;
}

// Sites listen on pointerdown or mousedown as often as on click (Google Drive's
// menus open on mousedown), so the whole sequence is dispatched at the element's
// centre rather than calling el.click(). A double click repeats the sequence
// with the click count in `detail` and ends with dblclick, which is what opens
// a folder in Google Drive; a lone dblclick event is ignored there.
// clicks: 1, 2 for a double-click, or 'right' for a right-click
function clickElement(el, clicks = 1) {
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const rect = el.getBoundingClientRect();
  const init = {
    bubbles: true, cancelable: true, composed: true, view: window, button: 0,
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
  };
  el.dispatchEvent(new PointerEvent('pointerover', init));
  el.dispatchEvent(new MouseEvent('mouseover', init));
  if (clicks === 'right') {
    const right = { ...init, button: 2, buttons: 2 };
    el.dispatchEvent(new PointerEvent('pointerdown', right));
    el.dispatchEvent(new MouseEvent('mousedown', right));
    el.dispatchEvent(new PointerEvent('pointerup', { ...right, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...right, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('contextmenu', right));
    return;
  }
  for (let detail = 1; detail <= clicks; detail++) {
    el.dispatchEvent(new PointerEvent('pointerdown', { ...init, detail, buttons: 1 }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...init, detail, buttons: 1 }));
    if (typeof el.focus === 'function') el.focus();
    el.dispatchEvent(new PointerEvent('pointerup', { ...init, detail }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...init, detail }));
    el.dispatchEvent(new MouseEvent('click', { ...init, detail }));
  }
  if (clicks === 2) {
    el.dispatchEvent(new MouseEvent('dblclick', { ...init, detail: 2 }));
  }
}

// insertText goes through the editor's own input path, so frameworks that track
// value through input events (React, Vue) see the change. Setting .value directly
// is the fallback for inputs where the command is refused.
//
// The text goes in a few characters at a time, spread over at most
// TYPE_ANIMATION_MS, so a person watching sees it being written. Pages get one
// input event per piece, as they would from a keyboard.
const TYPE_ANIMATION_MS = 1000;
const TYPE_STEP_MS = 25;

// Focusing an editable element does not put the caret inside it, and
// insertText with no caret in the element is refused.
//
// The caret goes at the end of the last text, not at the end of the element:
// after the last <p> of a ProseMirror editor (ChatGPT) each piece typed there
// became a paragraph of its own, splitting words across lines.
function caretToEnd(el) {
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let last = null;
  while (walker.nextNode()) last = walker.currentNode;
  if (last) {
    range.setStart(last, last.length);
  } else {
    let deepest = el;
    while (deepest.lastElementChild && deepest.lastElementChild.tagName !== 'BR') deepest = deepest.lastElementChild;
    range.selectNodeContents(deepest);
  }
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

async function typeInto(el, text, clear) {
  el.scrollIntoView({ block: 'center' });
  el.focus();
  if (clear) {
    if (el.isContentEditable) {
      document.execCommand('selectAll');
    } else if (typeof el.select === 'function') {
      el.select();
    }
  } else if (el.isContentEditable) {
    caretToEnd(el);
  }
  // In a hidden tab the text goes in at once: nobody is watching, and Firefox
  // throttles its timers so hard that a 300-character text took minutes.
  // Typing animation can also be turned off in the settings
  const size = document.hidden || !settings.typingAnimated ? Math.max(1, text.length)
    : Math.max(1, Math.ceil(text.length * TYPE_STEP_MS / TYPE_ANIMATION_MS));
  const pieces = [];
  for (let i = 0; i < text.length; i += size) pieces.push(text.slice(i, i + size));
  if (pieces.length === 0) pieces.push('');
  for (let i = 0; i < pieces.length; i++) {
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, TYPE_STEP_MS));
      // An autocomplete popup can take focus between pieces; the rest of the
      // text still belongs in this field.
      if (document.activeElement !== el && !el.contains(document.activeElement)) {
        el.focus();
      }
      // Rich editors (ProseMirror in ChatGPT) can leave the piece just inserted
      // selected, and the next piece would then replace it, so only the last
      // few dozen characters of a long text arrived.
      if (el.isContentEditable) caretToEnd(el);
      else el.setSelectionRange?.(el.value.length, el.value.length);
    }
    if (!document.execCommand('insertText', false, pieces[i])) {
      if (i > 0) throw new Error('The field stopped accepting text partway through typing');
      break;
    }
    showTypingField(el);
    if (i === pieces.length - 1) {
      checkTyped(el, text);
      return;
    }
  }
  if (el.isContentEditable) {
    el.textContent = clear ? text : el.textContent + text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    showTypingField(el);
    return;
  }
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, clear ? text : el.value + text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  showTypingField(el);
}

// Whether the text that was typed is all there. An editor that drops or replaces
// part of it would otherwise report success with half a message in the field.
function checkTyped(el, text) {
  const normalise = value => value.replace(/\s+/g, ' ').trim();
  const now = normalise(el.isContentEditable ? el.innerText : el.value || '');
  const wanted = normalise(text);
  if (!now.includes(wanted)) {
    throw new Error(`Only part of the text arrived in the field (it now holds ${now.length} characters, ` +
      `the text was ${wanted.length})`);
  }
}

function pressKey(el, key) {
  const init = { key, bubbles: true, cancelable: true, composed: true };
  const notCancelled = el.dispatchEvent(new KeyboardEvent('keydown', init));
  el.dispatchEvent(new KeyboardEvent('keyup', init));
  // A synthetic Enter does not submit a form, so do what the browser would.
  if (key === 'Enter' && notCancelled && el.form && el.tagName !== 'TEXTAREA') {
    el.form.requestSubmit();
  }
}

// Many sites (Google Drive among them) open the file dialog by calling click()
// on an <input type=file> they create on the spot, and a native dialog is not
// something an extension can fill in. While armed, this swaps the page's own
// click() and showPicker() so the next file input is handed back here instead
// of opening the dialog. It goes through wrappedJSObject because the page's
// prototypes are invisible from the content script's side.
function captureNextFileInput(timeoutMs) {
  const proto = window.wrappedJSObject.HTMLInputElement.prototype;
  const originalClick = proto.click;
  const originalShowPicker = proto.showPicker;
  return new Promise((resolve, reject) => {
    const restore = () => {
      proto.click = originalClick;
      proto.showPicker = originalShowPicker;
    };
    const timer = setTimeout(() => {
      restore();
      reject(new Error('The trigger did not open a file dialog'));
    }, timeoutMs);
    const intercept = exportFunction(function () {
      if (this.type !== 'file') {
        return originalClick.call(this);
      }
      clearTimeout(timer);
      restore();
      // Inputs created just for the dialog are often never attached, and a
      // detached element cannot be found again by ref.
      if (!this.isConnected) {
        this.hidden = true;
        document.body.appendChild(this);
      }
      resolve(this);
    }, window);
    proto.click = intercept;
    proto.showPicker = intercept;
  });
}

// webkitRelativePath is what tells a page the files came from a folder (and
// which subfolder each sits in), so it is set where the page reads it.
async function setInputFiles(el, files, relativePaths) {
  if (el.tagName !== 'INPUT' || el.type !== 'file') {
    throw new Error('Target must be an <input type=file>');
  }
  // A page ignores files set on a disabled input (ChatGPT's, while it loads),
  // so setting them would report success with nothing attached.
  if (el.disabled) {
    throw new Error('The file input is disabled; wait for the page to finish loading and try again');
  }
  // Files built in the extension belong to it, and the page gets "Permission
  // denied" reading them. Each one is rebuilt in the page from its bytes and set
  // through the page's own DataTransfer, so it is an ordinary file as far as the
  // page can tell. A clone of the extension's File was not enough: Miro accepted
  // it, showed "Uploading..." and never finished, apparently because its
  // uploader passes the file on to a worker.
  const page = window.wrappedJSObject;
  const transfer = new page.DataTransfer();
  for (const file of files) {
    const bytes = cloneInto(await file.arrayBuffer(), window);
    const pageFile = new page.File(cloneInto([bytes], window), file.name,
      cloneInto({ type: file.type, lastModified: file.lastModified }, window));
    transfer.items.add(pageFile);
  }
  el.wrappedJSObject.files = transfer.files;
  const pageFiles = el.wrappedJSObject.files;
  // A browser only reports folder paths for inputs that pick folders, so a
  // folder given to a plain file input arrives as loose files, as it would.
  for (let i = 0; i < pageFiles.length; i++) {
    if (el.webkitdirectory && relativePaths[i]) {
      Object.defineProperty(pageFiles[i], 'webkitRelativePath', {
        value: relativePaths[i], configurable: true
      });
    }
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return Array.from({ length: pageFiles.length },
    (_, i) => pageFiles[i].webkitRelativePath || pageFiles[i].name);
}

// Overlay shown while an agent works in the tab: a glowing border, a label in
// the first person saying what it is doing, a cursor that is always on screen
// and animates the current state, and a pulsing ring on the tab's icon in the tab
// strip. It is purely visual (pointer-events: none) and stays until the agent
// releases the tab; the background script releases it when the agent's server
// goes, or after five minutes with no action.
const OVERLAY_ID = 'foxmcp-agent-overlay';
const OVERLAY_LABEL = 'AI agent is working in this tab';
// How long the ring stays on a field after the last piece of text goes in.
const FIELD_LINGER_MS = 800;
// After this long in "thinking" the cursor settles to idle.
const IDLE_AFTER_MS = 20000;
const CURSOR_STATES = ['idle', 'thinking', 'reading', 'clicking', 'typing', 'waiting', 'working'];
let fieldTimer = null;
let idleTimer = null;
let cursorPos = null;
let cursorState = 'idle';
let agentLabel = OVERLAY_LABEL;

// The person's settings for what the overlay shows (settings.js), applied
// as they change them, without a reload
let settings = { ...SETTINGS_DEFAULTS };
loadSettings().then(saved => { settings = saved; applyOverlaySettings(); });
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const [key, change] of Object.entries(changes)) {
    if (key in SETTINGS_DEFAULTS) settings[key] = change.newValue ?? SETTINGS_DEFAULTS[key];
  }
  applyOverlaySettings();
});

function applyOverlaySettings() {
  const host = document.getElementById(OVERLAY_ID);
  if (host) {
    host.style.setProperty('--c', settings.overlayColor);
    host.classList.toggle('no-border', !settings.overlayBorder);
    host.classList.toggle('no-label', !settings.overlayLabel);
    host.classList.toggle('no-cursor', !settings.cursorEnabled);
    host.classList.toggle('label-top', settings.labelPosition === 'top');
    if (!settings.overlayEnabled) host.style.opacity = '0';
  }
  if (!settings.tabMarker || !settings.overlayEnabled) stopTabMarker();
}

function overlayRoot() {
  let host = document.getElementById(OVERLAY_ID);
  // An overlay left by an older version of the add-on, from before it was
  // updated in a tab that stayed open, lacks the parts this one drives.
  if (host && !host.shadowRoot?.querySelector('.pointer .badge')) {
    host.remove();
    host = null;
  }
  if (!host) {
    host = document.createElement('div');
    host.id = OVERLAY_ID;
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;opacity:0;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { transition: opacity .4s; --c: rgb(217,119,87); }
        :host(.no-border) .glow, :host(.no-label) .label, :host(.no-cursor) .pointer { display:none; }
        :host(.label-top) .label { bottom:auto; top:14px; }
        .glow { position:fixed; inset:0; box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--c) 90%, transparent), inset 0 0 22px color-mix(in srgb, var(--c) 50%, transparent);
          animation: glow 3s ease-in-out infinite; }
        @keyframes glow { 50% { box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--c) 60%, transparent), inset 0 0 14px color-mix(in srgb, var(--c) 30%, transparent); } }
        .label { position:fixed; left:50%; bottom:14px; transform:translateX(-50%); display:flex; align-items:center; gap:8px;
          padding:7px 14px; border-radius:999px; background:rgba(28,25,23,.92); color:#fff; max-width:80vw;
          font:500 13px/1.2 system-ui, sans-serif; box-shadow:0 2px 10px rgba(0,0,0,.3); white-space:nowrap; }
        .label .text { overflow:hidden; text-overflow:ellipsis; }
        .dot { flex:none; width:8px; height:8px; border-radius:50%; background:var(--c); animation: dot 1.6s ease-in-out infinite; }
        @keyframes dot { 50% { opacity:.35; } }
        .pointer { position:fixed; left:0; top:0; width:22px; height:22px; }
        .cursor { width:22px; height:22px; filter:drop-shadow(0 1px 2px rgba(0,0,0,.45)); }
        .badge { position:absolute; left:18px; top:16px; display:none; }
        .pointer.idle .cursor { animation: breathe 2.4s ease-in-out infinite; }
        @keyframes breathe { 50% { opacity:.55; } }
        .pointer.thinking .badge.think { display:flex; gap:3px; padding:3px 5px; border-radius:8px; background:rgba(28,25,23,.85); }
        .think i { width:5px; height:5px; border-radius:50%; background:#fff; animation: think 1s ease-in-out infinite; }
        .think i:nth-child(2) { animation-delay:.15s } .think i:nth-child(3) { animation-delay:.3s }
        @keyframes think { 0%,100% { transform:translateY(0); opacity:.4 } 50% { transform:translateY(-3px); opacity:1 } }
        .pointer.reading .badge.read { display:block; width:26px; height:3px; border-radius:2px; background:color-mix(in srgb, var(--c) 35%, transparent); overflow:hidden; }
        .read b { display:block; width:9px; height:3px; background:var(--c); animation: read .9s linear infinite; }
        @keyframes read { from { transform:translateX(-9px) } to { transform:translateX(26px) } }
        .pointer.waiting .badge.wait { display:block; width:14px; height:14px; border-radius:50%;
          border:2px solid color-mix(in srgb, var(--c) 30%, transparent); border-top-color:var(--c); animation: spin .8s linear infinite; }
        @keyframes spin { to { transform:rotate(360deg) } }
        .pointer.typing .badge.type { display:block; width:2px; height:14px; background:var(--c); animation: blink .8s steps(1) infinite; }
        @keyframes blink { 50% { opacity:0 } }
        .pointer.working .badge.work { display:block; width:10px; height:10px; border-radius:50%; background:var(--c); animation: dot 1s ease-in-out infinite; }
        .ripple { position:fixed; width:28px; height:28px; margin:-14px 0 0 -14px; border-radius:50%;
          border:2px solid var(--c); animation:ripple .45s ease-out forwards; }
        @keyframes ripple { from { transform:scale(.3); opacity:1; } to { transform:scale(1.4); opacity:0; } }
        .field { position:fixed; display:none; border-radius:6px; box-shadow:0 0 0 2px var(--c), 0 0 14px 2px color-mix(in srgb, var(--c) 55%, transparent);
          animation:field-pulse 1.2s ease-in-out infinite; }
        @keyframes field-pulse { 50% { box-shadow:0 0 0 2px var(--c), 0 0 4px 1px color-mix(in srgb, var(--c) 30%, transparent); } }
        @media (prefers-reduced-motion: reduce) { * { animation:none !important; } }
      </style>
      <div class="glow"></div>
      <div class="field"></div>
      <div class="label"><span class="dot"></span><span class="text"></span></div>
      <div class="pointer idle">
        <svg class="cursor" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
          <path d="M2 1.5 L2 18 L6.6 13.9 L9.6 20.5 L12.5 19.2 L9.6 12.7 L15.8 12.7 Z" style="fill:var(--c)" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/>
        </svg>
        <span class="badge think"><i></i><i></i><i></i></span>
        <span class="badge read"><b></b></span>
        <span class="badge wait"></span>
        <span class="badge type"></span>
        <span class="badge work"></span>
      </div>`;
    root.querySelector('.label .text').textContent = agentLabel;
    document.documentElement.appendChild(host);
    applyOverlaySettings();
  }
  return host;
}

// The cursor stays where the agent last acted; before any click or typing it
// rests a little right of the middle of the page.
function placeCursor(root) {
  if (!cursorPos) cursorPos = { x: Math.round(innerWidth * 0.62), y: Math.round(innerHeight * 0.42) };
  root.querySelector('.pointer').style.transform = `translate(${cursorPos.x}px, ${cursorPos.y}px)`;
}

function setCursorState(state) {
  const pointer = overlayRoot().shadowRoot.querySelector('.pointer');
  for (const name of CURSOR_STATES) pointer.classList.toggle(name, name === state);
  clearTimeout(idleTimer);
  if (state === 'thinking') idleTimer = setTimeout(() => setCursorState('idle'), IDLE_AFTER_MS);
  if (state !== cursorState) reading = null;
  cursorState = state;
  scheduleIdleMotion();
}

function setLabel(text) {
  agentLabel = text || OVERLAY_LABEL;
  overlayRoot().shadowRoot.querySelector('.label .text').textContent = agentLabel;
}

// state: what the cursor shows; label: the line under it. Both are optional,
// so a page action can show the overlay without changing what was said.
function showOverlay(state, label) {
  if (!settings.overlayEnabled) return;
  const host = overlayRoot();
  host.style.opacity = '1';
  host.style.visibility = 'visible';
  placeCursor(host.shadowRoot);
  if (state) setCursorState(state);
  if (label) setLabel(label);
  if (settings.tabMarker) startTabMarker();
}

function hideOverlay() {
  const host = document.getElementById(OVERLAY_ID);
  if (host) {
    host.style.opacity = '0';
    host.shadowRoot.querySelector('.field').style.display = 'none';
    host.shadowRoot.querySelector('.label .text').textContent = agentLabel;
  }
  clearTimeout(idleTimer);
  clearTimeout(fieldTimer);
  clearTimeout(idleMotionTimer);
  stopTabMarker();
}

// Ring the field being typed into and name it in the label. Called after each
// piece of text, so the ring follows a field that grows or moves as it fills.
function showTypingField(el) {
  const root = overlayRoot().shadowRoot;
  const rect = el.getBoundingClientRect();
  const field = root.querySelector('.field');
  Object.assign(field.style, {
    display: 'block', left: rect.left + 'px', top: rect.top + 'px',
    width: rect.width + 'px', height: rect.height + 'px',
  });
  const name = (el.getAttribute('aria-label') || el.placeholder || el.labels?.[0]?.innerText ||
    el.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  root.querySelector('.label .text').textContent = name ? `Typing into "${name}"` : 'Typing';
  clearTimeout(fieldTimer);
  fieldTimer = setTimeout(() => {
    field.style.display = 'none';
    root.querySelector('.label .text').textContent = agentLabel;
  }, FIELD_LINGER_MS);
}

// The tab's icon in the tab strip gets a pulsing ring while the agent works
// here, so the tab stands out in a row of tabs. Drawn on a canvas from the
// page's own icon (fetched, so a cross-origin icon does not taint the canvas)
// and swapped in as the page's icon a few times a second; the original icon
// links go back on release.
const MARKER_FRAME_MS = 140;
const MARKER_FRAMES = 14;
let markerTimer = null;
let markerLinks = null;
let markerFrame = 0;

async function loadPageIcon() {
  const link = document.querySelector('link[rel~="icon"]:not([data-foxmcp-marker])');
  const url = link ? link.href : new URL('/favicon.ico', location.href).href;
  try {
    const response = await fetch(url, { credentials: 'omit' });
    if (!response.ok) return null;
    return await createImageBitmap(await response.blob());
  } catch (error) {
    return null; // no icon, or one createImageBitmap cannot decode (SVG): the ring is drawn alone
  }
}

async function buildMarkerFrames() {
  const icon = await loadPageIcon();
  const frames = [];
  for (let i = 0; i < MARKER_FRAMES; i++) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const pulse = (Math.sin(i / MARKER_FRAMES * Math.PI * 2) + 1) / 2;
    if (icon) {
      ctx.drawImage(icon, 14, 14, 36, 36);
    } else {
      ctx.fillStyle = settings.overlayColor;
      ctx.beginPath(); ctx.arc(32, 32, 12, 0, Math.PI * 2); ctx.fill();
    }
    ctx.lineWidth = 6 + pulse * 3;
    ctx.globalAlpha = 0.55 + pulse * 0.45;
    ctx.strokeStyle = settings.overlayColor;
    ctx.beginPath(); ctx.arc(32, 32, 27, 0, Math.PI * 2); ctx.stroke();
    frames.push(canvas.toDataURL('image/png'));
  }
  return frames;
}

async function startTabMarker() {
  if (markerTimer || !document.head) return;
  markerTimer = -1; // frames being built
  const frames = await buildMarkerFrames();
  if (markerTimer !== -1) return; // released meanwhile
  markerLinks = [...document.querySelectorAll('link[rel~="icon"]')];
  for (const link of markerLinks) link.remove();
  const marker = document.createElement('link');
  marker.rel = 'icon';
  marker.setAttribute('data-foxmcp-marker', '');
  document.head.appendChild(marker);
  markerTimer = setInterval(() => {
    marker.href = frames[markerFrame++ % frames.length];
  }, MARKER_FRAME_MS);
}

function stopTabMarker() {
  if (markerTimer && markerTimer !== -1) clearInterval(markerTimer);
  markerTimer = null;
  document.querySelectorAll('link[data-foxmcp-marker]').forEach(link => link.remove());
  if (markerLinks && document.head) {
    for (const link of markerLinks) document.head.appendChild(link);
  }
  markerLinks = null;
}

// The cursor moves the way a hand on a mouse does, after the motor-control
// research on pointing:
// - Fitts' law: the move takes longer the farther and smaller the target,
//   a + b * log2(distance / width + 1).
// - A fast first submovement with a bell-shaped speed (minimum jerk), skewed so
//   it speeds up quicker than it slows down, along a slight arc; on longer moves
//   it usually stops a little short of the target and now and then past it.
// - One small corrective submovement onto the target, a faint tremor, and a
//   short pause to check the target before a click.
const FITTS_A_MS = 120;
const FITTS_B_MS = 110;
const MIN_MOVE_MS = 180;
const MAX_MOVE_MS = 900;
const CORRECTION_SHARE = 0.22; // of the move's time, spent on the correction
const CHECK_PAUSE_MS = [70, 160];

const minimumJerk = t => t * t * t * (10 - 15 * t + 6 * t * t);
const between = ([low, high]) => low + Math.random() * (high - low);

function humanPath(from, to, targetSize) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const human = settings.cursorMotion !== 'direct';
  const duration = (CURSOR_SPEEDS[settings.cursorSpeed] || 1) * Math.min(MAX_MOVE_MS, Math.max(MIN_MOVE_MS,
    FITTS_A_MS + FITTS_B_MS * Math.log2(distance / Math.max(targetSize, 8) + 1)));
  // Where the first submovement ends: short of the target 70% of the time.
  // "Direct" motion (a setting) goes straight there in one smooth move.
  const corrects = human && distance > 80;
  const miss = corrects ? (Math.random() < 0.7 ? -1 : 1) * between([0.03, 0.08]) : 0;
  const sway = corrects ? Math.min(6, targetSize / 4) : 0;
  const land = {
    x: to.x + dx * miss + (Math.random() - 0.5) * sway,
    y: to.y + dy * miss + (Math.random() - 0.5) * sway,
  };
  // The arc: a control point off the straight line, to either side
  const bend = human ? (Math.random() < 0.5 ? -1 : 1) * distance * between([0.04, 0.12]) : 0;
  const control = {
    x: (from.x + land.x) / 2 - (dy / distance) * bend,
    y: (from.y + land.y) / 2 + (dx / distance) * bend,
  };
  const points = [];
  const primaryShare = corrects ? 1 - CORRECTION_SHARE : 1;
  const steps = Math.max(12, Math.round(duration * primaryShare / 16));
  for (let i = 0; i <= steps; i++) {
    const s = minimumJerk(Math.pow(i / steps, 0.85));
    const tremor = human && i < steps ? 0.6 : 0;
    points.push({
      x: (1 - s) * (1 - s) * from.x + 2 * (1 - s) * s * control.x + s * s * land.x + (Math.random() - 0.5) * tremor,
      y: (1 - s) * (1 - s) * from.y + 2 * (1 - s) * s * control.y + s * s * land.y + (Math.random() - 0.5) * tremor,
      offset: (i / steps) * primaryShare,
    });
  }
  if (corrects) {
    const fix = Math.max(4, Math.round(duration * CORRECTION_SHARE / 16));
    for (let i = 1; i <= fix; i++) {
      const s = minimumJerk(i / fix);
      points.push({
        x: land.x + (to.x - land.x) * s,
        y: land.y + (to.y - land.y) * s,
        offset: primaryShare + (i / fix) * CORRECTION_SHARE,
      });
    }
  }
  points[points.length - 1] = { ...to, offset: 1 };
  return { points, duration };
}

async function moveCursorTo(el, press) {
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const rect = el.getBoundingClientRect();
  const to = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  return moveCursorToPoint(to, Math.min(rect.width, rect.height), press);
}

// The same move to a point in the viewport, for clicks and drags on a canvas
async function moveCursorToPoint(to, targetSize, press) {
  const from = cursorPos || to;
  cursorPos = to;
  const root = overlayRoot().shadowRoot;
  const pointer = root.querySelector('.pointer');
  pointer.getAnimations().forEach(animation => animation.cancel());
  pointer.style.transition = 'none';
  pointer.style.transform = `translate(${to.x}px, ${to.y}px)`;
  // Nobody sees a hidden tab, and Firefox holds its timers back for seconds
  if (document.hidden || !settings.overlayEnabled || !settings.cursorEnabled) return;
  if (Math.hypot(to.x - from.x, to.y - from.y) >= 2) {
    const { points, duration } = humanPath(from, to, targetSize);
    const motion = pointer.animate(
      points.map(({ x, y, offset }) => ({ transform: `translate(${x}px, ${y}px)`, offset })),
      { duration, easing: 'linear' });
    await motion.finished.catch(() => {});
  }
  if (press) {
    if (settings.cursorMotion !== 'direct') await new Promise(resolve => setTimeout(resolve, between(CHECK_PAUSE_MS)));
    const ripple = document.createElement('div');
    ripple.className = 'ripple';
    ripple.style.left = to.x + 'px';
    ripple.style.top = to.y + 'px';
    root.appendChild(ripple);
    setTimeout(() => ripple.remove(), 500);
  }
}

// Where the viewport sits on screen, for real input posted to the window
// (server/win_input.py): its top left in CSS pixels, the scale to physical
// pixels, and the title Firefox gives the window
function screenInfo() {
  return { x: window.mozInnerScreenX, y: window.mozInnerScreenY, dpr: window.devicePixelRatio, title: document.title };
}

// Between actions the cursor moves the way a hand resting on a mouse does.
// Studies of the pointer during reading and search (Rodden et al., CHI 2008;
// Huang, White and Buscher, CHI 2012) find it parked most of the time. When it
// moves, it follows the eyes: sideways along the line being read, then back to
// the start of the next one, or it hesitates in small moves near where it
// rests. The pauses between moves are long and uneven (log-normal here).
const IDLE_MOTION = {
  idle: { pause: 4000, spread: 0.6, drift: [3, 16], reposition: 0.12 },
  thinking: { pause: 1800, spread: 0.5, drift: [3, 10], reposition: 0.05 },
  waiting: { pause: 2400, spread: 0.5, drift: [3, 12], reposition: 0.05 },
  reading: { pause: 700, spread: 0.4 },
};
const READ_STEP = [22, 70];      // px per eye-following move along a line
const READ_LINE = [180, 420];    // how far along a line before the return sweep
const LINE_HEIGHT = [18, 28];
const EDGE = 24;
let idleMotionTimer = null;
let reading = null;

function gaussian() {
  let u = 0;
  while (!u) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

function scheduleIdleMotion() {
  clearTimeout(idleMotionTimer);
  const style = IDLE_MOTION[cursorState];
  if (style) idleMotionTimer = setTimeout(idleStep, style.pause * Math.exp(style.spread * gaussian()));
}

const clampToView = point => ({
  x: Math.min(innerWidth - EDGE, Math.max(EDGE, point.x)),
  y: Math.min(innerHeight - EDGE, Math.max(EDGE, point.y)),
});

function nextReadingPoint() {
  if (!reading) reading = { startX: cursorPos.x, y: cursorPos.y, length: between(READ_LINE) };
  if (cursorPos.x - reading.startX >= reading.length || cursorPos.x > innerWidth - EDGE * 3) {
    // Return sweep to the start of the next line, back up the page at the bottom
    reading.y += between(LINE_HEIGHT);
    if (reading.y > innerHeight * 0.85) reading.y = innerHeight * 0.3;
    reading.length = between(READ_LINE);
    return { point: clampToView({ x: reading.startX + (Math.random() - 0.5) * 12, y: reading.y }), ms: between([320, 480]) };
  }
  return { point: clampToView({ x: cursorPos.x + between(READ_STEP), y: reading.y + (Math.random() - 0.5) * 3 }),
    ms: between([150, 260]) };
}

function nextRestingPoint(style) {
  const far = Math.random() < style.reposition;
  const distance = far ? between([40, 120]) : between(style.drift);
  const angle = Math.random() * 2 * Math.PI;
  return { point: clampToView({ x: cursorPos.x + Math.cos(angle) * distance, y: cursorPos.y + Math.sin(angle) * distance }),
    ms: far ? between([380, 650]) : between([220, 420]) };
}

async function idleStep() {
  const style = IDLE_MOTION[cursorState];
  const host = document.getElementById(OVERLAY_ID);
  if (!style || !host || host.style.opacity !== '1') return;
  if (!document.hidden && cursorPos && settings.cursorEnabled && settings.cursorIdleMotion &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const { point, ms } = cursorState === 'reading' ? nextReadingPoint() : nextRestingPoint(style);
    const from = cursorPos;
    cursorPos = point;
    const pointer = host.shadowRoot.querySelector('.pointer');
    pointer.style.transform = `translate(${point.x}px, ${point.y}px)`;
    const frames = [];
    for (let i = 0; i <= 10; i++) {
      const s = minimumJerk(i / 10);
      frames.push({ transform: `translate(${from.x + (point.x - from.x) * s}px, ${from.y + (point.y - from.y) * s}px)` });
    }
    await pointer.animate(frames, { duration: ms, easing: 'linear' }).finished.catch(() => {});
  }
  scheduleIdleMotion();
}

// Listen for messages from background script
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { action, data } = request;

  console.log('📨 Content script received message:', action, data);

  try {
    switch (action) {
      case 'extractText':
        showOverlay('reading');
        sendResponse({ text: document.body.innerText });
        break;

      case 'extractHTML':
        showOverlay('reading');
        sendResponse({ html: document.documentElement.outerHTML });
        break;

      // What the agent is doing in this tab, sent by the background script
      // before and after each action, and when a page it opened finishes loading.
      case 'agentActive':
        showOverlay(data && data.state, data && data.label);
        sendResponse({ ok: true });
        break;

      // The agent is done with this tab (tabs_release, its server went, or
      // it has been idle for a while).
      case 'agentRelease':
        hideOverlay();
        sendResponse({ ok: true });
        break;

      case 'getPageTitle':
        sendResponse({ title: document.title });
        break;

      case 'getPageURL':
        sendResponse({ url: window.location.href });
        break;

      case 'snapshot':
        showOverlay('reading');
        sendResponse({ snapshot: snapshot(data.maxElements || 300), url: location.href, title: document.title });
        break;

      case 'click': {
        // A click at a point (a canvas) rather than on an element
        if (!data.ref && !data.selector) {
          const point = targetPoint(data);
          showOverlay('clicking');
          moveCursorToPoint(point, point.size, true)
            .then(() => {
              const init = mouseInit(point, data.rightClick ? { button: 2, buttons: 2 } : { buttons: 1 });
              for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
                point.el.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, init));
              }
              point.el.dispatchEvent(new MouseEvent(data.rightClick ? 'contextmenu' : 'click', init));
              if (data.doubleClick && !data.rightClick) point.el.dispatchEvent(new MouseEvent('dblclick', { ...init, detail: 2 }));
              sendResponse({ clicked: `${describe(point.el)} at ${point.x},${point.y}` });
            })
            .catch(error => sendResponse({ error: error.message }));
          break;
        }
        const el = findTarget(data);
        showOverlay('clicking');
        // A bare "Clicking" from the background gets the element's name
        if (agentLabel === 'Clicking') {
          const name = (el.getAttribute('aria-label') || el.innerText || el.value || el.title || '')
            .replace(/\s+/g, ' ').trim().slice(0, 40);
          if (name) setLabel(`Clicking "${name}"`);
        }
        moveCursorTo(el, true)
          .then(() => {
            clickElement(el, data.rightClick ? 'right' : data.doubleClick ? 2 : 1);
            sendResponse({ clicked: describe(el) });
          })
          .catch(error => sendResponse({ error: error.message }));
        break;
      }

      case 'type': {
        const el = findTarget(data);
        showOverlay('typing');
        moveCursorTo(el, true)
          .then(() => typeInto(el, data.text, data.clear !== false))
          .then(() => {
            if (data.submit) pressKey(el, 'Enter');
            sendResponse({ typed: describe(el) });
          })
          .catch(error => sendResponse({ error: error.message }));
        break;
      }

      // Before real input (server/win_input.py or bidi.py): move the cursor
      // there, say where the page is on screen, and mark the page so the server
      // can find this tab among BiDi's browsing contexts, whose ids are
      // unrelated to the extension's tab ids.
      case 'realInputPrep': {
        const el = data.ref || data.selector ? findTarget(data) : null;
        showOverlay(data.purpose === 'type' ? 'typing' : 'clicking');
        if (el && data.purpose === 'click' && agentLabel === 'Clicking') {
          const name = (el.getAttribute('aria-label') || el.innerText || el.value || el.title || '')
            .replace(/\s+/g, ' ').trim().slice(0, 40);
          if (name) setLabel(`Clicking "${name}"`);
        }
        (el ? moveCursorTo(el, data.purpose === 'click') : Promise.resolve())
          .then(() => {
            document.documentElement.setAttribute('data-foxmcp-tab', data.token);
            const rect = el && el.getBoundingClientRect();
            sendResponse(el ? {
              selector: `[${REF_ATTR}="${refFor(el)}"]`, target: describe(el), screen: screenInfo(),
              point: { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) },
            } : { target: 'the page', screen: screenInfo() });
          })
          .catch(error => sendResponse({ error: error.message }));
        break;
      }

      case 'hover': {
        const point = targetPoint(data);
        showOverlay('clicking');
        moveCursorToPoint(point, point.size, false)
          .then(() => {
            hoverAt(point);
            sendResponse({ hovered: point.el === document.body ? `${point.x},${point.y}` : describe(point.el) });
          })
          .catch(error => sendResponse({ error: error.message }));
        break;
      }

      case 'drag': {
        const from = targetPoint(data.from);
        const to = targetPoint(data.to);
        showOverlay('clicking');
        moveCursorToPoint(from, from.size, true)
          .then(() => Promise.all([dragBetween(from, to), moveCursorToPoint(to, to.size, false)]))
          .then(() => sendResponse({ dragged: `${describe(from.el)} to ${describe(to.el)}` }))
          .catch(error => sendResponse({ error: error.message }));
        break;
      }

      // Points for a real hover, point click or drag: the cursor moves to
      // the start, and the server gets viewport coordinates to send to Firefox
      case 'realPointerPrep': {
        try {
          const from = targetPoint(data.from);
          const to = data.to ? targetPoint(data.to) : null;
          showOverlay('clicking');
          moveCursorToPoint(from, from.size, data.purpose === 'click' || data.purpose === 'drag')
            .then(() => {
              document.documentElement.setAttribute('data-foxmcp-tab', data.token);
              if (to) moveCursorToPoint(to, to.size, false);  // follows the real drag on screen
              sendResponse({
                from: { x: Math.round(from.x), y: Math.round(from.y) },
                to: to && { x: Math.round(to.x), y: Math.round(to.y) },
                target: describe(from.el) + (to ? ` to ${describe(to.el)}` : ''),
                screen: screenInfo(),
                // Firefox's remote control starts the page's drag-and-drop but
                // cannot drop, so those drags are scripted (see content_drag)
                pageDragAndDrop: data.purpose === 'drag' && usesPageDragAndDrop(from.el),
              });
            })
            .catch(error => sendResponse({ error: error.message }));
        } catch (error) {
          sendResponse({ error: error.message });
        }
        break;
      }

      case 'checkTypedText': {
        const el = findTarget(data);
        try {
          checkTyped(el, data.text);
          showTypingField(el);
          sendResponse({ typed: describe(el) });
        } catch (error) {
          sendResponse({ error: error.message });
        }
        break;
      }

      case 'pressKey': {
        const el = data.ref || data.selector ? findTarget(data) : (document.activeElement || document.body);
        showOverlay('typing');
        pressKey(el, data.key);
        sendResponse({ pressed: data.key });
        break;
      }

      case 'captureFileInput': {
        const trigger = findTarget({ ref: data.triggerRef, selector: data.triggerSelector });
        showOverlay('clicking');
        const captured = captureNextFileInput(data.timeoutMs || 3000);
        moveCursorTo(trigger, true)
          .then(() => clickElement(trigger))
          .then(() => captured)
          .then(input => sendResponse({ ref: refFor(input), multiple: input.multiple, directory: input.webkitdirectory }))
          .catch(error => sendResponse({ error: error.message }));
        break;
      }

      case 'setFiles': {
        const el = findTarget(data);
        showOverlay('waiting');
        setInputFiles(el, data.files, data.relativePaths || [])
          .then(paths => sendResponse({ count: paths.length, paths: paths.slice(0, 5), target: describe(el) }))
          .catch(error => sendResponse({ error: error.message }));
        break;
      }

      // The bytes of an image on the page, for "Copy Image". Read with the
      // page's own fetch so a same-origin image comes with the page's cookies
      // and a blob: URL resolves; a cross-origin one the page may not read is
      // left to the background script, by its URL.
      case 'imageSource': {
        const el = findTarget(data);
        const img = el.tagName === 'IMG' ? el : el.querySelector('img');
        if (!img) {
          sendResponse({ error: `${describe(el)} is not an image and holds none` });
          break;
        }
        showOverlay('reading');
        moveCursorTo(img, false)
          .then(() => window.wrappedJSObject.fetch(img.currentSrc || img.src))
          .then(response => response.ok ? response.arrayBuffer() : null)
          // copied out of the page's realm, so the message can carry it
          .then(buffer => buffer && new Uint8Array(buffer).slice().buffer)
          .catch(() => null)
          .then(bytes => sendResponse({ src: img.currentSrc || img.src, bytes, target: describe(img) }));
        break;
      }

      // A real paste of the clipboard into the element given, or into the
      // page. The page gets a trusted paste event carrying what is on the
      // clipboard, as from Ctrl+V; a synthetic event with the same data is
      // ignored by canvas apps such as Miro.
      //
      // Firefox runs a content script's paste only into a <textarea>. For any
      // other target, or none, a textarea is added off screen for the moment
      // of the paste; the paste event bubbles from it to the document, where
      // canvas apps listen.
      case 'paste': {
        const el = data.ref || data.selector ? findTarget(data) : null;
        const previous = document.activeElement;
        showOverlay('typing');
        (el ? moveCursorTo(el, true) : Promise.resolve()).then(() => {
          let into = el;
          let scratch = null;
          if (!(el instanceof HTMLTextAreaElement)) {
            scratch = document.createElement('textarea');
            scratch.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
            document.body.appendChild(scratch);
            into = scratch;
          }
          into.focus();
          const pasted = document.execCommand('paste');
          if (scratch) {
            scratch.remove();
            previous?.focus?.();
          }
          sendResponse(pasted ? { pasted: scratch ? 'the page' : describe(el) } : { error: 'Firefox refused the paste' });
        });
        break;
      }

      // Hidden while a screenshot is taken, so the capture shows the page as
      // it is rather than with the agent's border and cursor on top.
      case 'overlayVisibility': {
        const host = document.getElementById(OVERLAY_ID);
        if (host) host.style.visibility = data.visible ? 'visible' : 'hidden';
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ error: `Unknown content action: ${action}` });
    }
  } catch (error) {
    sendResponse({ error: error.message });
  }

  return true; // Keep message channel open for async response
});
// A page the agent opened or navigated to shows the overlay as soon as this
// script runs, instead of waiting for the tab's load to complete.
browser.runtime.sendMessage({ action: 'isAgentTab' })
  .then(reply => { if (reply && reply.active) showOverlay(reply.state, reply.label); })
  .catch(error => console.warn('Could not ask whether an agent is working in this tab:', error.message));
