/* =====================================================================
   Shared notification bell (Task 3 bonus).

   The bell lives in the navbar on every page, so a task assigned to you
   while you are in the shop still shows up. It gets its unread count from
   GET /api/projects/notifications, and when a page has loaded the
   Socket.io client it also listens on the /projects namespace for live
   pushes - no polling needed.
   ===================================================================== */

const Notifications = (() => {
  let items = [];
  let unread = 0;
  let panel = null;
  let bellButton = null;
  let socket = null;
  let mounted = false;

  /** Loads the latest notifications. Stays quiet if the module is unavailable. */
  async function load() {
    try {
      const data = await API.get('/api/projects/notifications');
      items = data.notifications || [];
      unread = data.unread || 0;
      paintCount();
      if (panel) paintPanel();
    } catch {
      // Not logged in, or the projects module is not mounted yet.
      items = [];
      unread = 0;
      paintCount();
    }
  }

  function paintCount() {
    if (!bellButton) return;
    const existing = bellButton.querySelector('.bell-count');
    if (existing) existing.remove();
    if (unread > 0) {
      bellButton.append(
        el('span', { class: 'bell-count', text: unread > 99 ? '99+' : String(unread) })
      );
      bellButton.setAttribute('aria-label', `Notifications, ${unread} unread`);
    } else {
      bellButton.setAttribute('aria-label', 'Notifications');
    }
  }

  function paintPanel() {
    if (!panel) return;
    panel.innerHTML = '';

    if (!items.length) {
      panel.append(
        el('div', { class: 'notif-item muted center', text: 'No notifications yet.' })
      );
      return;
    }

    panel.append(
      el(
        'div',
        {
          class: 'notif-item row spread',
          style: 'position:sticky;top:0;background:var(--surface);font-weight:600',
        },
        el('span', { text: 'Notifications' }),
        el('button', { class: 'icon-btn', type: 'button', onClick: markAllRead }, 'Mark all read')
      )
    );

    for (const n of items) {
      const link = n.project_id ? `/projects/?project=${n.project_id}` : null;
      const body = el(
        'div',
        { class: `notif-item ${n.is_read ? '' : 'unread'}`.trim() },
        el('div', { text: n.message }),
        el('div', { class: 'small muted', text: timeAgo(n.created_at) })
      );
      if (link) {
        body.style.cursor = 'pointer';
        body.addEventListener('click', () => {
          location.href = link;
        });
      }
      panel.append(body);
    }
  }

  async function markAllRead() {
    try {
      await API.post('/api/projects/notifications/read-all');
      items = items.map((n) => ({ ...n, is_read: 1 }));
      unread = 0;
      paintCount();
      paintPanel();
    } catch (err) {
      toastError(err.message);
    }
  }

  function closePanel() {
    if (panel) {
      panel.remove();
      panel = null;
    }
    document.removeEventListener('click', onOutsideClick, true);
  }

  function onOutsideClick(event) {
    if (!panel) return;
    if (panel.contains(event.target) || bellButton.contains(event.target)) return;
    closePanel();
  }

  function togglePanel() {
    if (panel) return closePanel();
    panel = el('div', { class: 'notif-panel' });
    document.body.append(panel);
    paintPanel();
    // Capture phase so the listener runs before React-less re-renders remove nodes.
    document.addEventListener('click', onOutsideClick, true);
    load(); // refresh while open
  }

  /**
   * Subscribes to live pushes. Only works on pages that loaded the Socket.io
   * client script; elsewhere the bell still shows the count fetched by load().
   */
  function connectSocket() {
    if (socket || typeof window.io !== 'function') return;
    socket = window.io('/projects', { withCredentials: true });

    socket.on('notification', (payload) => {
      items.unshift(payload);
      items = items.slice(0, 30);
      unread += 1;
      paintCount();
      if (panel) paintPanel();
      toast(payload.message, 'info', 4500);
    });

    socket.on('connect_error', (err) => {
      console.warn('notification socket:', err.message);
    });
  }

  /** Puts the bell into the navbar slot. Safe to call on every page. */
  function mount() {
    const slot = document.getElementById('bell-slot');
    if (!slot || !Shell.user()) return;
    if (mounted && bellButton?.isConnected) return;

    bellButton = el('button', { class: 'bell', type: 'button', title: 'Notifications' }, '\u{1F514}');
    bellButton.addEventListener('click', (event) => {
      event.stopPropagation();
      togglePanel();
    });
    slot.innerHTML = '';
    slot.append(bellButton);
    mounted = true;

    load();
    connectSocket();
  }

  /** Lets the projects page reuse this module's socket for board events. */
  function getSocket() {
    connectSocket();
    return socket;
  }

  return { mount, load, getSocket, markAllRead };
})();

window.Notifications = Notifications;
