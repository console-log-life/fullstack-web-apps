# Project 1 — Simple E-commerce Store

One of four apps in [fullstack-web-apps](https://github.com/console-log-life/fullstack-web-apps).

A working storefront: browse a catalogue, add things to a cart that survives
logging out, check out, and look back at your orders. Built with Node.js,
Express and SQLite, with a plain HTML/CSS/JavaScript frontend and no framework.

This folder is **self-contained** — it has its own server, database, dependencies
and authentication, so it runs on its own.

---

## Contents

- [Quick start](#quick-start)
- [Demo login credentials](#demo-login-credentials)
- [Features](#features)
- [Tech stack](#tech-stack)
- [Folder structure](#folder-structure)
- [Database schema](#database-schema)
- [API reference](#api-reference)
- [How to demo](#how-to-demo)
- [Known limitations](#known-limitations)

---

## Quick start

Needs **Node.js 18 or newer**. No database server to install.

```bash
cd task1-ecommerce-store

npm install
cp .env.example .env        # Windows: copy .env.example .env
# open .env and set JWT_SECRET to a long random string

npm run seed                # 4 demo users + 16 products + a cart and an order
npm start
```

Open **<http://localhost:3001>**.

> **`JWT_SECRET` must be set.** The server exits at boot without it rather than
> signing session tokens with a guessable fallback. Generate one with:
> ```bash
> node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
> ```

| Command | What it does |
| --- | --- |
| `npm start` | Start the server on `PORT` (default 3001) |
| `npm run dev` | Same thing |
| `npm run seed` | Reset the database and reload the demo data |

`npm run seed` is safe to re-run: it clears the tables and re-inserts, so you
always get the same predictable state for a demo.

---

## Demo login credentials

Four accounts, all with the password **`password123`**:

| Username | Password | What they have |
| --- | --- | --- |
| `demo` | `password123` | 2 items already in the cart and one past order (status `shipped`) |
| `alice` | `password123` | Empty cart |
| `bob` | `password123` | Empty cart |
| `carol` | `password123` | Empty cart |

You can log in with the username or the email (`demo@example.com`), or register
a new account from the landing page.

---

## Features

What it does:

| Required | Status | Where |
| --- | --- | --- |
| **Product listing page** | ✅ | `/shop/` — responsive grid of 16 seeded products |
| **Product details page** | ✅ | `/shop/product.html?id=…` |
| **Shopping cart** | ✅ | `/shop/cart.html` — add, remove, update quantity |
| **Checkout and order processing** | ✅ | Checkout modal → creates order + order items, reduces stock |
| **User authentication** | ✅ | bcrypt + JWT in an httpOnly cookie, required for cart and checkout |
| **Database** | ✅ | SQLite: `products`, `cart_items`, `orders`, `order_items` |

Beyond the minimum:

- **Search** across product name and description, debounced so typing does not
  fire a request per keystroke
- **Category filter** built from the catalogue itself, plus four sort orders
  (newest, price up, price down, name)
- **Cart stored in the database per user**, not in `localStorage`, so it follows
  you to another browser or device
- **Stock awareness throughout** — "only 3 left" badges, a quantity cap, and
  stock re-checked *at checkout* as well as when an item was added, so a cart
  left open overnight cannot oversell the last unit
- **Checkout is one transaction** — the order, its line items, the stock
  decrement and clearing the cart either all happen or none do
- **Order history with statuses** (`pending` / `paid` / `shipped` / `delivered`
  / `cancelled`), expandable line items, and **cancel-with-restock**
- **Prices stored as integer cents**, so no floating-point rounding can reach a
  total
- **Order lines snapshot the product name and price** at purchase time, so a
  past order stays correct even if the product is later renamed or repriced
- Empty states, inline error messages and a mobile layout with no horizontal
  scrolling

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | HTML, CSS, vanilla JavaScript — no framework, no build step |
| Backend | Node.js + Express 4 |
| Database | SQLite via `better-sqlite3` (single file, synchronous API) |
| Auth | `bcryptjs` for hashing, `jsonwebtoken` in an httpOnly cookie |
| Security | `helmet` (strict CSP), `cors`, `express-rate-limit`, `dotenv` |

No Socket.io and no multer in this task — it does not need them, so they are
not in `package.json`.

The frontend shares four small modules that every page loads:

| File | Responsibility |
| --- | --- |
| `public/shared/api.js` | One `fetch` wrapper: sends the cookie, turns a non-2xx reply into a thrown error carrying the server's message |
| `public/shared/ui.js` | `el()` element builder, HTML escaping, toasts, modals, money and date formatting |
| `public/shared/auth.js` | Navbar, login/register card, the "this page needs a login" gate |
| `public/shared/boot.js` | Starts a page from `data-*` attributes on `<body>` |

That last one matters: the CSP is `script-src 'self'` with **no
`'unsafe-inline'`**, so an inline `<script>` block would be blocked by the
browser. Each page declares what it needs instead:

```html
<body data-module="shop" data-require-auth="true" data-render="Shop.renderCart">
```

---

## Folder structure

```
task1-ecommerce-store/
├── README.md
├── package.json
├── .env.example
├── server/
│   ├── app.js                  Express app, CSP, static files, 404 handling
│   ├── db/
│   │   ├── index.js            SQLite connection + migration runner
│   │   ├── schema.sql          users + products, cart_items, orders, order_items
│   │   ├── seed.js             demo data (npm run seed)
│   │   └── data/app.db         created on first run (gitignored)
│   ├── middleware/
│   │   ├── auth.js             JWT issue/verify, attachUser, authRequired
│   │   └── errorHandler.js     central error → { error: "message" }
│   ├── routes/
│   │   ├── auth.js             register / login / logout / me
│   │   └── shop.js             this task's endpoints
│   └── utils/
│       ├── validate.js         input validation, ApiError
│       └── asyncHandler.js     async route rejections → error handler
└── public/
    ├── index.html              landing page
    ├── shared/                 styles.css, api.js, ui.js, auth.js, boot.js, home.js
    └── shop/
        ├── index.html          product listing
        ├── product.html        product details
        ├── cart.html           cart + checkout
        ├── orders.html         order history
        ├── shop.css
        └── shop.js
```

---

## Database schema

```
users ──┬── cart_items ──── products
        └── orders ──────── order_items ──── products
```

| Table | Holds |
| --- | --- |
| `users` | One account per person: username, email, bcrypt hash |
| `products` | Name, description, `price_cents`, category, stock |
| `cart_items` | The live cart, one row per user + product |
| `orders` | One per checkout: total, status, shipping name and address |
| `order_items` | The lines of an order, with name and price copied in |

Decisions worth pointing out:

- **`price_cents` is an integer.** Money as a float is how rounding errors end
  up in a total.
- **`UNIQUE (user_id, product_id)` on `cart_items`** turns "add again" into a
  quantity bump instead of a duplicate row.
- **`order_items` copies `product_name` and `unit_price_cents`** so history is
  immutable: renaming or repricing a product does not rewrite past orders.
- **`CHECK` constraints** keep quantities positive and stock non-negative at the
  database level, not just in the application.
- **Timestamps keep milliseconds** (`strftime('%Y-%m-%d %H:%M:%f')`); plain
  `datetime('now')` only resolves to whole seconds.
- **`ON DELETE CASCADE`** throughout, with `PRAGMA foreign_keys = ON` set on
  every connection — SQLite does not enforce foreign keys by default.

Migrations run on boot: `schema.sql` is all `CREATE ... IF NOT EXISTS`, so new
tables appear and existing data is untouched.

---

## API reference

Browsing is public; anything touching a cart or an order requires a session.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | — | Create an account and log in |
| `POST` | `/api/auth/login` | — | Log in with username or email |
| `POST` | `/api/auth/logout` | — | Clear the cookie |
| `GET` | `/api/auth/me` | — | Who am I? (`{ user: null }` when logged out) |
| `GET` | `/api/shop/products` | — | List, with `?search=`, `?category=`, `?sort=` |
| `GET` | `/api/shop/categories` | — | Category names and counts |
| `GET` | `/api/shop/products/:id` | — | One product plus related items |
| `GET` | `/api/shop/cart` | ✅ | The signed-in user's cart with totals |
| `POST` | `/api/shop/cart` | ✅ | Add a product, or bump its quantity |
| `PATCH` | `/api/shop/cart/:productId` | ✅ | Set an exact quantity (0 removes) |
| `DELETE` | `/api/shop/cart/:productId` | ✅ | Remove one line |
| `DELETE` | `/api/shop/cart` | ✅ | Empty the cart |
| `POST` | `/api/shop/checkout` | ✅ | Turn the cart into an order |
| `GET` | `/api/shop/orders` | ✅ | Order history with line items |
| `GET` | `/api/shop/orders/:id` | ✅ | One order |
| `PATCH` | `/api/shop/orders/:id/cancel` | ✅ | Cancel and return the stock |

Order lookups are scoped by `user_id`, so another account cannot read your
order by guessing its id — it gets a 404.

---

## How to demo

Run `npm run seed && npm start`, open <http://localhost:3001>, log in as
**`demo` / `password123`**.

1. **Authentication.** Open devtools → Application → Cookies and point out
   `ca_token` with **HttpOnly ticked** — that is why page JavaScript cannot read
   the session token.
2. **Listing, search, filter.** Go to the store. Type `keyboard` in the search
   box; the grid narrows as you type. Switch the category dropdown to `books`.
   Change the sort to "Price: low to high".
3. **Details.** Click a product. Show the stock badge, set the quantity to 2,
   **Add to cart**.
4. **Cart.** Open the cart. It already had items from the seed — because the
   cart lives in the database, not `localStorage`. Use − / + to change a
   quantity; the subtotal and the nav badge update.
5. **The transaction, which is the interesting part.** Open a product page in a
   second tab and note its stock. Check out in the first tab. Reload the second
   tab: the stock has dropped by exactly what you bought, because the order and
   the stock decrement happen in one transaction.
6. **Order history.** You land on the new order, expanded, with its status.
   **Cancel** it and reload the product page again — the stock comes back.
7. **Login gate.** Open `/shop/cart.html` in a private window. Instead of an
   error you get the login card, and the cart is not shown.

---

## Known limitations

- **Checkout is simulated.** It creates the order and reduces stock, but no
  payment provider is integrated — there is no card capture and nothing is
  charged.
- **No admin interface.** Products come from the seed script; adding or editing
  a product means editing `server/db/seed.js` and re-seeding.
- **Order status does not advance on its own.** The seeded order is `shipped`
  and checkout creates `paid`; there is no fulfilment workflow to move it
  further, only the cancel action.
- **Shipping is a flat rule** (free over $100, otherwise $4.99) rather than
  anything address-aware.
- **SQLite suits one server process.** That is the right call for a project you
  can clone and run in two commands; a multi-instance deployment would want
  Postgres.
- **No product images in the seed.** Thumbnails are generated gradients with the
  product's initial, so nothing looks broken; `products.image_url` is there and
  is used when set.
