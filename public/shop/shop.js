/* =====================================================================
   TASK 1 - E-commerce store frontend.

   One module holds the four screens (products, details, cart, orders);
   each HTML page calls the renderer it needs. Browsing works logged out;
   the cart and checkout ask for a login first.
   ===================================================================== */

const Shop = (() => {
  /* ------------------------- shared pieces ------------------------- */

  /** Deterministic gradient per product, so a product looks the same everywhere. */
  function thumbStyle(product) {
    const seed = (product.name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const hue = seed % 360;
    return `background:linear-gradient(135deg, hsl(${hue} 62% 52%), hsl(${(hue + 48) % 360} 64% 44%))`;
  }

  /** Product image when one exists, otherwise the generated initial tile. */
  function thumbNode(product, className) {
    const node = el('div', { class: className, style: thumbStyle(product) });
    if (product.image_url) {
      node.append(el('img', { src: product.image_url, alt: product.name }));
    } else {
      node.textContent = (product.name || '?').charAt(0).toUpperCase();
    }
    return node;
  }

  /**
   * The Products / Cart / Orders sub-nav, with a live cart count.
   * Carries id="shop-tabs" so addToCart can swap it out to refresh the count.
   */
  function tabs(active) {
    const cartLink = el('a', { href: '/shop/cart.html', class: active === 'cart' ? 'active' : '' }, 'Cart');
    const node = el(
      'div',
      { class: 'shop-tabs', id: 'shop-tabs', dataset: { active } },
      el('a', { href: '/shop/', class: active === 'products' ? 'active' : '' }, 'Products'),
      cartLink,
      el('a', { href: '/shop/orders.html', class: active === 'orders' ? 'active' : '' }, 'My orders')
    );

    // Only logged-in users have a cart, so skip the lookup when anonymous.
    if (Shell.user()) {
      API.get('/api/shop/cart')
        .then(({ cart }) => {
          if (cart.count > 0) cartLink.append(el('span', { class: 'cart-pill', text: String(cart.count) }));
        })
        .catch(() => { /* a failed count must not break the page */ });
    }
    return node;
  }

  function stockBadge(stock) {
    if (stock <= 0) return el('span', { class: 'badge badge-danger', text: 'Out of stock' });
    if (stock <= 5) return el('span', { class: 'badge badge-warning', text: `Only ${stock} left` });
    return el('span', { class: 'badge badge-success', text: 'In stock' });
  }

  /** Adds to the cart, or opens the login card when nobody is signed in. */
  async function addToCart(productId, quantity, button) {
    if (!Shell.user()) {
      toast('Please log in to use the cart.', 'info');
      Shell.promptLogin();
      return;
    }
    await withBusy(button, async () => {
      try {
        const { message } = await API.post('/api/shop/cart', { product_id: productId, quantity });
        toastOk(message || 'Added to your cart.');
        // Rebuild the sub-nav so the cart count updates without a reload.
        const host = document.getElementById('shop-tabs');
        if (host) host.replaceWith(tabs(host.dataset.active || 'products'));
      } catch (err) {
        toastError(err.message);
      }
    });
  }

  /* --------------------------- products page --------------------------- */

  async function renderProducts(root) {
    const state = {
      search: new URLSearchParams(location.search).get('search') || '',
      category: new URLSearchParams(location.search).get('category') || 'all',
      sort: 'newest',
    };

    const searchInput = el('input', {
      type: 'search', placeholder: 'Search products…', value: state.search, 'aria-label': 'Search products',
    });
    const categorySelect = el('select', { 'aria-label': 'Filter by category' },
      el('option', { value: 'all' }, 'All categories'));
    const sortSelect = el('select', { 'aria-label': 'Sort products' },
      el('option', { value: 'newest' }, 'Newest first'),
      el('option', { value: 'price_asc' }, 'Price: low to high'),
      el('option', { value: 'price_desc' }, 'Price: high to low'),
      el('option', { value: 'name' }, 'Name A-Z'));

    const grid = el('div', { class: 'grid' });
    const countLabel = el('p', { class: 'muted small', style: 'margin:0 0 12px' });

    root.innerHTML = '';
    root.append(
      el('div', { class: 'page-head' },
        el('div', {},
          el('h1', { text: 'Store' }),
          el('p', { class: 'muted', style: 'margin:0', text: 'Task 1 · browse, cart, checkout and order history.' }))),
      tabs('products'),
      el('div', { class: 'shop-filters' }, searchInput, categorySelect, sortSelect),
      countLabel,
      grid
    );

    // Load the category list once for the dropdown.
    try {
      const { categories } = await API.get('/api/shop/categories');
      for (const row of categories) {
        categorySelect.append(
          el('option', { value: row.category }, `${row.category} (${row.count})`)
        );
      }
      categorySelect.value = state.category;
    } catch (err) {
      console.warn('categories failed', err);
    }

    async function load() {
      setLoading(grid);
      countLabel.textContent = '';
      const params = new URLSearchParams();
      if (state.search) params.set('search', state.search);
      if (state.category && state.category !== 'all') params.set('category', state.category);
      params.set('sort', state.sort);

      try {
        const { products } = await API.get(`/api/shop/products?${params}`);
        grid.innerHTML = '';

        if (!products.length) {
          setEmpty(grid, state.search
            ? `No products match "${state.search}".`
            : 'No products in this category yet.', '\u{1F50D}');
          return;
        }

        countLabel.textContent = `${products.length} product${products.length === 1 ? '' : 's'}`;

        for (const product of products) {
          const addBtn = el('button', {
            class: 'btn btn-sm', type: 'button', disabled: product.stock <= 0 ? 'disabled' : null,
          }, product.stock > 0 ? 'Add to cart' : 'Sold out');
          addBtn.addEventListener('click', () => addToCart(product.id, 1, addBtn));

          grid.append(
            el('article', { class: 'product-card' },
              el('a', { href: `/shop/product.html?id=${product.id}`, 'aria-label': product.name },
                thumbNode(product, 'product-thumb')),
              el('div', { class: 'product-body' },
                el('div', { class: 'product-name' },
                  el('a', { href: `/shop/product.html?id=${product.id}`, text: product.name })),
                el('div', { class: 'product-meta' },
                  el('span', { class: 'product-price', text: money(product.price_cents) }),
                  el('span', { class: 'badge', text: product.category })),
                stockBadge(product.stock),
                el('div', { class: 'product-actions' },
                  addBtn,
                  el('a', { class: 'btn btn-ghost btn-sm', href: `/shop/product.html?id=${product.id}` }, 'Details'))))
          );
        }
      } catch (err) {
        showError(grid, err);
      }
    }

    // Debounce the search box so typing does not fire a request per keystroke.
    let timer = null;
    searchInput.addEventListener('input', () => {
      state.search = searchInput.value.trim();
      clearTimeout(timer);
      timer = setTimeout(load, 280);
    });
    categorySelect.addEventListener('change', () => {
      state.category = categorySelect.value;
      load();
    });
    sortSelect.addEventListener('change', () => {
      state.sort = sortSelect.value;
      load();
    });

    load();
  }

  /* --------------------------- details page --------------------------- */

  async function renderProduct(root) {
    const id = new URLSearchParams(location.search).get('id');
    root.innerHTML = '';
    const host = el('div');
    root.append(tabs('products'), host);
    setLoading(host);

    if (!id || !/^\d+$/.test(id)) {
      return showError(host, new Error('No product was selected.'));
    }

    try {
      const { product, related } = await API.get(`/api/shop/products/${id}`);
      document.title = `${product.name} - CodeAlpha Store`;

      const qtyInput = el('input', {
        type: 'number', min: '1', max: String(Math.max(1, Math.min(99, product.stock))),
        value: '1', 'aria-label': 'Quantity',
      });
      const addBtn = el('button', {
        class: 'btn', type: 'button', disabled: product.stock <= 0 ? 'disabled' : null,
      }, product.stock > 0 ? 'Add to cart' : 'Out of stock');

      addBtn.addEventListener('click', () => {
        const qty = Number(qtyInput.value);
        if (!Number.isInteger(qty) || qty < 1) return toastError('Enter a quantity of 1 or more.');
        if (qty > product.stock) return toastError(`Only ${product.stock} in stock.`);
        addToCart(product.id, qty, addBtn);
      });

      const relatedGrid = el('div', { class: 'grid' });
      for (const item of related) {
        relatedGrid.append(
          el('a', { class: 'product-card', href: `/shop/product.html?id=${item.id}` },
            thumbNode(item, 'product-thumb'),
            el('div', { class: 'product-body' },
              el('div', { class: 'product-name', text: item.name }),
              el('span', { class: 'product-price', text: money(item.price_cents) })))
        );
      }

      host.innerHTML = '';
      host.append(
        el('p', { style: 'margin:0 0 14px' }, el('a', { href: '/shop/' }, '← Back to all products')),
        el('div', { class: 'detail-layout' },
          thumbNode(product, 'detail-thumb'),
          el('div', { class: 'stack' },
            el('div', {},
              el('span', { class: 'badge badge-brand', text: product.category }),
              el('h1', { text: product.name, style: 'margin-top:8px' }),
              el('div', { class: 'detail-price', text: money(product.price_cents) })),
            stockBadge(product.stock),
            el('p', { text: product.description, class: 'muted' }),
            el('div', { class: 'qty-row' },
              el('label', { text: 'Qty', style: 'margin:0' }), qtyInput, addBtn),
            el('p', { class: 'small muted', style: 'margin:0',
              text: `Product #${product.id} · added ${formatDate(product.created_at)}` }))),
        related.length
          ? el('section', { style: 'margin-top:40px' },
              el('h2', { text: `More in ${product.category}` }), relatedGrid)
          : null
      );
    } catch (err) {
      host.innerHTML = '';
      showError(host, err);
      host.append(el('p', { style: 'margin-top:12px' }, el('a', { href: '/shop/' }, '← Back to all products')));
    }
  }

  /* ----------------------------- cart page ----------------------------- */

  async function renderCart(root) {
    root.innerHTML = '';
    const host = el('div');
    root.append(
      el('div', { class: 'page-head' }, el('h1', { text: 'Your cart' })),
      tabs('cart'),
      host
    );

    async function load() {
      setLoading(host);
      try {
        const { cart } = await API.get('/api/shop/cart');
        paint(cart);
      } catch (err) {
        showError(host, err);
      }
    }

    /** Sends a quantity change and repaints from the cart the server returns. */
    async function setQuantity(productId, quantity) {
      try {
        const { cart, message } = await API.patch(`/api/shop/cart/${productId}`, { quantity });
        if (message) toast(message, 'success', 1800);
        paint(cart);
      } catch (err) {
        toastError(err.message);
        load(); // resync, the server is the source of truth
      }
    }

    async function removeLine(productId, name) {
      try {
        const { cart } = await API.del(`/api/shop/cart/${productId}`);
        toastOk(`${name} removed.`);
        paint(cart);
      } catch (err) {
        toastError(err.message);
      }
    }

    function paint(cart) {
      host.innerHTML = '';

      if (!cart.items.length) {
        host.append(
          el('div', { class: 'empty' },
            el('div', { class: 'empty-icon', text: '\u{1F6D2}' }),
            el('p', { text: 'Your cart is empty.' }),
            el('a', { class: 'btn', href: '/shop/' }, 'Browse products'))
        );
        return;
      }

      const lines = el('div', { class: 'card' });

      for (const item of cart.items) {
        const minus = el('button', { type: 'button', 'aria-label': 'Decrease quantity' }, '−');
        const plus = el('button', {
          type: 'button', 'aria-label': 'Increase quantity',
          disabled: item.quantity >= item.stock ? 'disabled' : null,
        }, '+');
        minus.addEventListener('click', () => setQuantity(item.product_id, item.quantity - 1));
        plus.addEventListener('click', () => setQuantity(item.product_id, item.quantity + 1));

        const remove = el('button', { class: 'icon-btn', type: 'button' }, 'Remove');
        remove.addEventListener('click', () => removeLine(item.product_id, item.name));

        lines.append(
          el('div', { class: 'cart-line' },
            thumbNode(item, 'cart-thumb'),
            el('div', { class: 'grow' },
              el('div', {},
                el('a', { href: `/shop/product.html?id=${item.product_id}`,
                  style: 'font-weight:600;color:var(--text)', text: item.name })),
              el('div', { class: 'small muted', text: `${money(item.price_cents)} each` }),
              item.over_stock
                ? el('div', { class: 'small', style: 'color:var(--danger)',
                    text: `Only ${item.stock} in stock — lower the quantity to check out.` })
                : null,
              el('div', { class: 'row', style: 'margin-top:7px' },
                el('div', { class: 'cart-qty' }, minus, el('span', { text: String(item.quantity) }), plus),
                remove)),
            el('strong', { text: money(item.line_total_cents) }))
        );
      }

      // Flat shipping, free over $100 - simple but makes the summary realistic.
      const shipping = cart.subtotal_cents >= 10000 ? 0 : 499;
      const total = cart.subtotal_cents + shipping;
      const blocked = cart.items.some((i) => i.over_stock);

      const checkoutBtn = el('button', {
        class: 'btn btn-block', type: 'button', disabled: blocked ? 'disabled' : null,
      }, 'Proceed to checkout');
      checkoutBtn.addEventListener('click', () => openCheckout(total, shipping));

      const clearBtn = el('button', { class: 'btn btn-ghost btn-block btn-sm', type: 'button' }, 'Empty cart');
      clearBtn.addEventListener('click', async () => {
        if (!(await confirmDialog('Empty cart', 'Remove every item from your cart?', { confirmLabel: 'Empty it' }))) return;
        try {
          const { cart: fresh } = await API.del('/api/shop/cart');
          toastOk('Cart emptied.');
          paint(fresh);
        } catch (err) {
          toastError(err.message);
        }
      });

      host.append(
        el('div', { class: 'cart-layout' },
          lines,
          el('div', { class: 'card' },
            el('h2', { text: 'Summary' }),
            el('div', { class: 'summary-row' },
              el('span', { text: `Items (${cart.count})` }), el('span', { text: money(cart.subtotal_cents) })),
            el('div', { class: 'summary-row' },
              el('span', { text: 'Shipping' }),
              el('span', { text: shipping === 0 ? 'Free' : money(shipping) })),
            shipping > 0
              ? el('p', { class: 'small muted', style: 'margin:4px 0 0',
                  text: `Spend ${money(10000 - cart.subtotal_cents)} more for free shipping.` })
              : null,
            el('div', { class: 'summary-total' },
              el('span', { text: 'Total' }), el('span', { text: money(total) })),
            blocked
              ? el('div', { class: 'alert alert-error', style: 'margin:14px 0 0',
                  text: 'Some items exceed the stock available. Adjust the quantities to continue.' })
              : null,
            el('div', { style: 'margin-top:16px' }, checkoutBtn),
            el('div', { style: 'margin-top:8px' }, clearBtn)))
      );
    }

    /** Checkout modal: collects the shipping details and posts the order. */
    function openCheckout(total, shipping) {
      const feedback = el('div');
      const submit = el('button', { class: 'btn btn-block', type: 'submit' }, `Pay ${money(total)}`);

      const form = el('form', { novalidate: 'novalidate' },
        el('div', { class: 'field' },
          el('label', { for: 'co-name', text: 'Full name' }),
          el('input', { id: 'co-name', name: 'shipping_name', type: 'text', required: 'required',
            value: Shell.user()?.username || '', autocomplete: 'name' })),
        el('div', { class: 'field' },
          el('label', { for: 'co-address', text: 'Delivery address' }),
          el('textarea', { id: 'co-address', name: 'address', required: 'required',
            placeholder: 'Street, city, state and postcode' })),
        el('div', { class: 'summary-row' },
          el('span', { text: 'Shipping' }), el('span', { text: shipping === 0 ? 'Free' : money(shipping) })),
        el('div', { class: 'summary-total', style: 'margin-bottom:16px' },
          el('span', { text: 'Total' }), el('span', { text: money(total) })),
        feedback,
        submit);

      const close = openModal('Checkout', form);

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        feedback.innerHTML = '';
        const values = formValues(form);

        await withBusy(submit, async () => {
          try {
            const result = await API.post('/api/shop/checkout', values);
            close();
            toastOk(result.message || 'Order placed.');
            // Straight to the order so the new status is visible immediately.
            location.href = `/shop/orders.html?order=${result.order_id}`;
          } catch (err) {
            showError(feedback, err);
          }
        });
      });
    }

    load();
  }

  /* ---------------------------- orders page ---------------------------- */

  async function renderOrders(root) {
    root.innerHTML = '';
    const host = el('div');
    root.append(
      el('div', { class: 'page-head' }, el('h1', { text: 'My orders' })),
      tabs('orders'),
      host
    );

    const highlight = new URLSearchParams(location.search).get('order');

    const STATUS_CLASS = {
      pending: 'badge-warning',
      paid: 'badge-brand',
      shipped: 'badge-brand',
      delivered: 'badge-success',
      cancelled: 'badge-danger',
    };

    async function load() {
      setLoading(host);
      try {
        const { orders } = await API.get('/api/shop/orders');
        host.innerHTML = '';

        if (!orders.length) {
          host.append(
            el('div', { class: 'empty' },
              el('div', { class: 'empty-icon', text: '\u{1F4E6}' }),
              el('p', { text: 'No orders yet.' }),
              el('a', { class: 'btn', href: '/shop/' }, 'Start shopping'))
          );
          return;
        }

        for (const order of orders) {
          const itemRows = el('div', { class: 'order-items' },
            order.items.map((item) =>
              el('div', { class: 'order-item-row' },
                el('span', { text: `${item.quantity} × ${item.product_name}` }),
                el('span', { text: money(item.unit_price_cents * item.quantity) }))),
            el('div', { class: 'order-item-row', style: 'font-weight:700;border-top:1px solid var(--border);margin-top:6px;padding-top:8px' },
              el('span', { text: 'Order total' }), el('span', { text: money(order.total_cents) })),
            el('p', { class: 'small muted', style: 'margin:10px 0 0',
              text: `Ship to ${order.shipping_name} · ${order.address}` }));

          // Collapsed by default; the order you just placed opens expanded.
          const expanded = String(order.id) === highlight;
          itemRows.classList.toggle('hidden', !expanded);

          const toggle = el('button', { class: 'icon-btn', type: 'button' },
            expanded ? 'Hide items' : 'Show items');
          toggle.addEventListener('click', () => {
            const nowHidden = itemRows.classList.toggle('hidden');
            toggle.textContent = nowHidden ? 'Show items' : 'Hide items';
          });

          const actions = el('div', { class: 'row' }, toggle);

          if (['pending', 'paid'].includes(order.status)) {
            const cancel = el('button', { class: 'icon-btn', type: 'button', style: 'color:var(--danger)' }, 'Cancel order');
            cancel.addEventListener('click', async () => {
              const yes = await confirmDialog('Cancel order',
                `Cancel order #${order.id}? The items go back into stock.`,
                { confirmLabel: 'Cancel order' });
              if (!yes) return;
              try {
                const { message } = await API.patch(`/api/shop/orders/${order.id}/cancel`);
                toastOk(message);
                load();
              } catch (err) {
                toastError(err.message);
              }
            });
            actions.append(cancel);
          }

          host.append(
            el('article', {
              class: 'card order-card',
              style: expanded ? 'outline:2px solid var(--brand)' : null,
            },
              el('div', { class: 'order-head' },
                el('div', {},
                  el('h3', { text: `Order #${order.id}`, style: 'margin:0' }),
                  el('span', { class: 'small muted',
                    text: `${formatDateTime(order.created_at)} · ${order.item_count} item(s)` })),
                el('div', { class: 'row' },
                  el('strong', { text: money(order.total_cents) }),
                  el('span', { class: `badge ${STATUS_CLASS[order.status] || ''}`, text: order.status }))),
              actions,
              itemRows)
          );
        }
      } catch (err) {
        showError(host, err);
      }
    }

    load();
  }

  return { renderProducts, renderProduct, renderCart, renderOrders, addToCart, tabs, thumbNode };
})();

window.Shop = Shop;
