/* =====================================================================
   Shared navbar + login gate.

   Every page calls Shell.init({ module, requireAuth }) which:
     1. asks GET /api/auth/me who is logged in,
     2. renders the navbar linking to all four apps,
     3. for a protected page, shows the register/login card instead of the
        page content until the visitor signs in.

   Because the session lives in an httpOnly cookie, the page cannot read
   the token - it only ever learns "am I logged in" from /me.
   ===================================================================== */

const Shell = (() => {
  let currentUser = null;
  const listeners = [];

  const MODULES = [
    { key: 'home', href: '/', label: 'Home' },
    { key: 'shop', href: '/shop/', label: 'Shop' },
    { key: 'social', href: '/social/', label: 'Social' },
    { key: 'projects', href: '/projects/', label: 'Projects' },
    { key: 'meet', href: '/meet/', label: 'Meet' },
  ];

  /** Re-reads the session from the server. */
  async function refresh() {
    try {
      const { user } = await API.get('/api/auth/me');
      currentUser = user;
    } catch {
      currentUser = null; // offline or server restarting
    }
    return currentUser;
  }

  function user() {
    return currentUser;
  }

  /** Register a callback fired whenever login state changes. */
  function onAuthChange(fn) {
    listeners.push(fn);
  }

  function emit() {
    listeners.forEach((fn) => {
      try {
        fn(currentUser);
      } catch (err) {
        console.error('auth listener failed', err);
      }
    });
  }

  /* ---------------------------- Navbar ---------------------------- */

  function renderNavbar(activeKey) {
    const host = document.getElementById('navbar');
    if (!host) return;

    const links = el(
      'nav',
      { class: 'nav-links' },
      MODULES.map((m) =>
        el('a', { href: m.href, class: m.key === activeKey ? 'active' : '' }, m.label)
      )
    );

    const right = el('div', { class: 'nav-right', id: 'nav-right' });

    if (currentUser) {
      // The bell is only meaningful in the projects module, but notifications
      // are global, so it is rendered on every page once logged in.
      right.append(
        el('div', { id: 'bell-slot' }),
        el('span', { class: 'nav-user', html: `Hi, <strong>${esc(currentUser.username)}</strong>` }),
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: logout }, 'Log out')
      );
    } else {
      right.append(
        el('a', { class: 'btn btn-sm', href: `/?next=${encodeURIComponent(location.pathname)}` }, 'Log in')
      );
    }

    host.innerHTML = '';
    host.className = 'navbar';
    host.append(
      el(
        'div',
        { class: 'container' },
        el(
          'a',
          { class: 'nav-brand', href: '/' },
          'CodeAlpha',
          el('span', { class: 'nav-brand-long', text: ' Projects' })
        ),
        links,
        right
      )
    );
  }

  async function logout() {
    try {
      await API.post('/api/auth/logout');
    } catch {
      /* clearing the cookie client-side is enough to end the session view */
    }
    currentUser = null;
    toastOk('Logged out.');
    // Back to the landing page so the user is never left on a blocked screen.
    location.href = '/';
  }

  /* -------------------------- Login gate -------------------------- */

  /** Builds the register/login card shown in place of protected content. */
  function authCard(onSuccess) {
    let mode = 'login';

    const feedback = el('div');
    const tabLogin = el('button', { type: 'button', class: 'active' }, 'Log in');
    const tabRegister = el('button', { type: 'button' }, 'Register');
    const formHost = el('div');

    function renderForm() {
      const isRegister = mode === 'register';
      const submit = el(
        'button',
        { class: 'btn btn-block', type: 'submit' },
        isRegister ? 'Create account' : 'Log in'
      );

      const form = el(
        'form',
        { novalidate: 'novalidate' },
        isRegister
          ? el(
              'div',
              { class: 'field' },
              el('label', { for: 'au-username', text: 'Username' }),
              el('input', {
                id: 'au-username', name: 'username', type: 'text', required: 'required',
                autocomplete: 'username', placeholder: 'letters, numbers, underscore',
              })
            )
          : null,
        isRegister
          ? el(
              'div',
              { class: 'field' },
              el('label', { for: 'au-email', text: 'Email' }),
              el('input', {
                id: 'au-email', name: 'email', type: 'email', required: 'required',
                autocomplete: 'email', placeholder: 'you@example.com',
              })
            )
          : el(
              'div',
              { class: 'field' },
              el('label', { for: 'au-identifier', text: 'Username or email' }),
              el('input', {
                id: 'au-identifier', name: 'identifier', type: 'text', required: 'required',
                autocomplete: 'username', placeholder: 'demo',
              })
            ),
        el(
          'div',
          { class: 'field' },
          el('label', { for: 'au-password', text: 'Password' }),
          el('input', {
            id: 'au-password', name: 'password', type: 'password', required: 'required',
            autocomplete: isRegister ? 'new-password' : 'current-password',
            placeholder: isRegister ? 'at least 6 characters' : '',
          })
        ),
        submit
      );

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        feedback.innerHTML = '';
        const values = formValues(form);

        await withBusy(submit, async () => {
          try {
            const path = isRegister ? '/api/auth/register' : '/api/auth/login';
            const { user: loggedIn } = await API.post(path, values);
            currentUser = loggedIn;
            emit();
            toastOk(isRegister ? `Welcome, ${loggedIn.username}!` : `Welcome back, ${loggedIn.username}!`);
            onSuccess(loggedIn);
          } catch (err) {
            showError(feedback, err);
          }
        });
      });

      formHost.innerHTML = '';
      formHost.append(form);
    }

    function setMode(next) {
      mode = next;
      tabLogin.classList.toggle('active', next === 'login');
      tabRegister.classList.toggle('active', next === 'register');
      feedback.innerHTML = '';
      renderForm();
    }

    tabLogin.addEventListener('click', () => setMode('login'));
    tabRegister.addEventListener('click', () => setMode('register'));
    renderForm();

    // Returned bare so the caller decides the frame: a full-height wrapper for
    // a blocked page, or nothing extra when it sits inside a modal.
    return el(
      'div',
      { class: 'card auth-card' },
      el('h1', { class: 'center', text: 'Sign in to continue' }),
      el('p', {
        class: 'center muted small',
        text: 'One account works across all four apps.',
      }),
      el('div', { class: 'auth-tabs' }, tabLogin, tabRegister),
      feedback,
      formHost,
      el('p', {
        class: 'center muted small',
        style: 'margin-top:16px',
        html: 'Demo account: <strong>demo</strong> / <strong>password123</strong>',
      })
    );
  }

  /**
   * Boots a page.
   * @param {string} module    which nav link to highlight
   * @param {boolean} requireAuth  show the login card instead of content when
   *                               nobody is signed in
   * @param {Function} onReady called with the user once the page may render
   */
  async function init({ module = 'home', requireAuth = false, onReady } = {}) {
    await refresh();
    renderNavbar(module);

    const content = document.getElementById('app');

    if (requireAuth && !currentUser) {
      if (content) {
        content.innerHTML = '';
        content.append(
          el(
            'div',
            { class: 'auth-wrap' },
            // Reload on success so the page boots cleanly as a logged-in user.
            authCard(() => location.reload())
          )
        );
      }
      return null;
    }

    if (onReady) await onReady(currentUser);
    return currentUser;
  }

  /** Shows the login card on demand (used by "log in to do this" prompts). */
  function promptLogin() {
    const close = openModal('Log in', authCard(() => location.reload()));
    return close;
  }

  return { init, refresh, user, logout, onAuthChange, renderNavbar, promptLogin, authCard, MODULES };
})();

window.Shell = Shell;
