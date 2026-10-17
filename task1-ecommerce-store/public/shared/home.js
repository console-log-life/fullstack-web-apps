/* =====================================================================
   Landing page behaviour.

   Kept in its own file (rather than an inline script) so the strict
   Content-Security-Policy can stay script-src 'self'.

   The landing page is public. It only offers the login card when nobody
   is signed in, and honours ?next=/path so a visitor bounced here from a
   protected page lands back where they started.
   ===================================================================== */

async function renderHome() {
  const slot = document.getElementById('landing-session');
  const user = Shell.user();
  const next = new URLSearchParams(location.search).get('next');
  // Only same-origin paths are honoured, so ?next= cannot be used to bounce
  // somebody to another site after login.
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;

  if (user) {
    if (slot) {
      slot.innerHTML = '';
      slot.append(el('span', { class: 'badge badge-success', text: `Signed in as ${user.username}` }));
    }
    if (safeNext) location.replace(safeNext);
    return;
  }

  if (slot) {
    slot.innerHTML = '';
    slot.append(el('span', { class: 'badge', text: 'Not signed in' }));
  }

  const card = Shell.authCard(() => {
    location.href = safeNext || '/';
  });

  document.getElementById('app').append(
    el('div', { style: 'max-width:420px;margin:34px auto 0' }, card)
  );
}

window.renderHome = renderHome;
