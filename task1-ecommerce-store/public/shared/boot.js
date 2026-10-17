/* =====================================================================
   Page bootstrapper.

   Every page is started from this one external script instead of an inline
   <script> block, which keeps the Content-Security-Policy strict
   (script-src 'self' with no 'unsafe-inline'). A page declares what it
   needs with data attributes on <body>:

     <body data-module="shop" data-require-auth="true" data-render="Shop.renderCart">

     data-module       which navbar link to highlight
     data-require-auth "true" shows the shared login card instead of content
                       when nobody is signed in
     data-render       dotted path to the render function, called with the
                       #app element
   ===================================================================== */

(() => {
  /** Resolves "Shop.renderCart" to the actual function on window. */
  function resolve(path) {
    if (!path) return null;
    return path.split('.').reduce((obj, key) => (obj ? obj[key] : undefined), window);
  }

  async function boot() {
    const body = document.body;
    const module = body.dataset.module || 'home';
    const requireAuth = body.dataset.requireAuth === 'true';
    const renderPath = body.dataset.render;

    await Shell.init({
      module,
      requireAuth,
      onReady: async () => {
        const render = resolve(renderPath);
        const app = document.getElementById('app');

        if (!render) {
          if (renderPath) console.error(`boot: no render function at "${renderPath}"`);
          return;
        }

        try {
          await render(app);
        } catch (err) {
          // A renderer that throws must not leave a blank page.
          console.error('boot: render failed', err);
          if (app) {
            app.innerHTML = '';
            app.append(
              el('div', { class: 'alert alert-error' },
                `This page failed to load: ${err.message}`)
            );
          }
        }
      },
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
