/* =====================================================================
   Small DOM/UI helpers shared by all four apps: element creation, HTML
   escaping, toasts, modals, money and date formatting.
   ===================================================================== */

/**
 * Escapes text before it goes into innerHTML.
 * Every place the UI interpolates user content (post text, usernames, chat)
 * runs through this, so a post containing <script> renders as characters
 * instead of executing - the client-side half of XSS protection.
 */
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** document.querySelector shorthands. */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Creates an element with attributes and children in one call. */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/* ------------------------------ Toasts ------------------------------ */

function toastHost() {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = el('div', { id: 'toast-host' });
    document.body.append(host);
  }
  return host;
}

/** Shows a transient message. type: 'info' | 'success' | 'error'. */
function toast(message, type = 'info', ms = 3200) {
  const node = el('div', { class: `toast toast-${type}`, text: message });
  toastHost().append(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity .2s';
    setTimeout(() => node.remove(), 220);
  }, ms);
}

const toastError = (m) => toast(m, 'error', 4200);
const toastOk = (m) => toast(m, 'success');

/** Renders an error from a thrown API error into a container element. */
function showError(container, error) {
  if (!container) return toastError(error.message || String(error));
  container.innerHTML = '';
  container.append(el('div', { class: 'alert alert-error', text: error.message || String(error) }));
}

/* ------------------------------ Modal ------------------------------- */

/**
 * Opens a modal containing `contentNode`. Returns a close() function.
 * Closes on backdrop click, the X button, and Escape.
 */
function openModal(title, contentNode, { onClose } = {}) {
  const closeBtn = el('button', { class: 'modal-close', type: 'button', 'aria-label': 'Close' }, '×');
  const modal = el(
    'div',
    { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
    el('div', { class: 'modal-head' }, el('h2', { text: title }), closeBtn),
    contentNode
  );
  const backdrop = el('div', { class: 'modal-backdrop' }, modal);

  function close() {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    if (onClose) onClose();
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close(); // only the backdrop itself, not the card
  });
  document.addEventListener('keydown', onKey);

  document.body.append(backdrop);
  const firstInput = modal.querySelector('input, textarea, select');
  if (firstInput) firstInput.focus();
  return close;
}

/** Yes/no confirmation built on openModal. Resolves to a boolean. */
function confirmDialog(title, message, { confirmLabel = 'Confirm', danger = true } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const yes = el('button', { class: `btn ${danger ? 'btn-danger' : ''}`, type: 'button' }, confirmLabel);
    const no = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Cancel');
    const body = el(
      'div',
      {},
      el('p', { text: message }),
      el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:16px' }, no, yes)
    );

    const close = openModal(title, body, { onClose: () => finish(false) });
    yes.addEventListener('click', () => {
      finish(true);
      close();
    });
    no.addEventListener('click', close);
  });
}

/* ---------------------------- Formatting ---------------------------- */

/** Cents -> "$12.34". Prices are stored as integers to avoid float errors. */
function money(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

/** SQLite datetimes are UTC "YYYY-MM-DD HH:MM:SS" with no zone marker. */
function parseDbDate(value) {
  if (!value) return null;
  const iso = String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = parseDbDate(value);
  if (!date) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(value) {
  const date = parseDbDate(value);
  if (!date) return '';
  return date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/** "3 hours ago" style label used on posts and comments. */
function timeAgo(value) {
  const date = parseDbDate(value);
  if (!date) return '';
  const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000);
  const steps = [
    [60, 'second', 1],
    [3600, 'minute', 60],
    [86400, 'hour', 3600],
    [604800, 'day', 86400],
    [2629800, 'week', 604800],
    [31557600, 'month', 2629800],
  ];
  for (const [limit, unit, divisor] of steps) {
    if (seconds < limit) {
      const n = Math.floor(seconds / divisor);
      if (unit === 'second' && n < 10) return 'just now';
      return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
    }
  }
  const years = Math.floor(seconds / 31557600);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/** An <img> avatar, or initials when the user has not uploaded one. */
function avatarNode(user, size = '') {
  const cls = `avatar ${size}`.trim();
  if (user && user.avatar_url) {
    return el('img', { class: cls, src: user.avatar_url, alt: `${user.username} avatar` });
  }
  const letter = (user?.display_name || user?.username || '?').charAt(0);
  return el('div', { class: `${cls} avatar-fallback`, text: letter });
}

/** Replaces a container's contents with a centered spinner. */
function setLoading(container) {
  if (container) container.innerHTML = '<div class="spinner"></div>';
}

/** Replaces a container's contents with an empty-state message. */
function setEmpty(container, message, icon = '\u{1F4C4}') {
  if (!container) return;
  container.innerHTML = '';
  container.append(
    el('div', { class: 'empty' }, el('div', { class: 'empty-icon', text: icon }), el('p', { text: message }))
  );
}

/** Reads a form into a plain object (trimming strings). */
function formValues(form) {
  const out = {};
  for (const [key, value] of new FormData(form).entries()) {
    out[key] = typeof value === 'string' ? value.trim() : value;
  }
  return out;
}

/** Disables a submit button while an async action runs. */
async function withBusy(button, fn) {
  if (!button) return fn();
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Please wait…';
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

Object.assign(window, {
  esc, $, $$, el, toast, toastError, toastOk, showError,
  openModal, confirmDialog, money, formatDate, formatDateTime, timeAgo,
  avatarNode, setLoading, setEmpty, formValues, withBusy,
});
