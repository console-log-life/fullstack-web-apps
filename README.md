# Full Stack Web Apps

Four full stack web applications, each one self-contained in its own folder:
an e-commerce store, a social platform, a real-time Kanban board, and a video
calling app with end-to-end encrypted chat.

I built these to work through the parts of web development that are easy to
read about and harder to actually get right — a checkout that cannot oversell
stock, drag and drop without a library, WebRTC signalling, and encryption where
the server genuinely cannot read the messages. The four project ideas came from
the CodeAlpha full stack task list; the implementation, structure and
documentation are my own.

Each folder has its own `package.json`, Express server, SQLite database and
copy of the shared authentication layer, so you can clone the repository, step
into any one folder, and run that app on its own.

```
Node.js + Express  ·  SQLite (better-sqlite3)  ·  vanilla HTML/CSS/JS
bcrypt + JWT in an httpOnly cookie  ·  Socket.io  ·  WebRTC  ·  Web Crypto (AES-GCM)
```

No frontend framework and no build step — the entire client is readable as-is.

---

## The four apps

| # | Project | Folder | Port | What it does |
| --- | --- | --- | --- | --- |
| 1 | E-commerce Store | [task1-ecommerce-store](https://github.com/console-log-life/fullstack-web-apps/tree/main/task1-ecommerce-store) | 3001 | Product catalogue with search and filters, cart persisted per user, checkout, order history |
| 2 | Social Platform | [task2-social-media](https://github.com/console-log-life/fullstack-web-apps/tree/main/task2-social-media) | 3002 | Profiles with avatar upload, posts with images, comments, likes, follow graph, home feed |
| 3 | Project Management Tool | [task3-project-management](https://github.com/console-log-life/fullstack-web-apps/tree/main/task3-project-management) | 3003 | Group projects, Kanban board with drag and drop, task comments, live sync and notifications |
| 4 | Real-Time Communication App | [task4-realtime-communication](https://github.com/console-log-life/fullstack-web-apps/tree/main/task4-realtime-communication) | 3004 | WebRTC video calls, screen share, end-to-end encrypted chat and files, shared whiteboard |

Each folder has its own README with the full feature list, the design decisions
behind its database schema, a demo walkthrough and its known limitations.

---

## Running any app

You need **Node.js 18 or newer**. Nothing else — SQLite is a single file, so
there is no database server to install.

```bash
git clone https://github.com/console-log-life/fullstack-web-apps.git
cd fullstack-web-apps/task1-ecommerce-store     # or any other folder

npm install
cp .env.example .env        # Windows: copy .env.example .env
# then open .env and set JWT_SECRET to a long random string

npm run seed                # loads the demo data
npm start
```

Then open the port that app prints, for example <http://localhost:3001>.

> **Set `JWT_SECRET` before starting.** Each server refuses to boot without one
> rather than signing session tokens with a guessable fallback. Generate one
> with:
> ```bash
> node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
> ```

Because every app uses a different default port, all four can run at the same
time in four terminals.

---

## Demo login credentials

Every app seeds the **same four accounts**, all with the password
**`password123`**:

| Username | Password |
| --- | --- |
| `demo` | `password123` |
| `alice` | `password123` |
| `bob` | `password123` |
| `carol` | `password123` |

`demo` owns the seeded data in each app. You can log in with the username or
the email (`demo@example.com`), or register a new account from any page.

For project 4 the seeded meeting room is code **`DEMO01`**, passphrase
**`codealpha`**.

---

## Why each folder repeats the shared code

Each app is meant to stand on its own, so every folder carries its own copy of
the foundation all four share:

| Duplicated in every folder | Why it is there |
| --- | --- |
| `server/routes/auth.js` | register / login / logout / me |
| `server/middleware/auth.js` | signs and verifies the JWT, the `authRequired` guard |
| `server/middleware/errorHandler.js` | turns a thrown error into `{ error: "message" }` |
| `server/utils/validate.js` | input validation helpers |
| `server/utils/asyncHandler.js` | passes async route rejections to the error handler |
| `server/db/index.js` | SQLite connection and the migration runner |
| `public/shared/*` | design tokens, fetch wrapper, UI helpers, navbar, page bootstrapper |

The duplication is deliberate rather than an accident of copy-pasting: it is
what lets each folder be cloned and run by itself. Each app's `schema.sql`
holds the shared `users` table plus only that app's own tables, and each
navbar links only to its own pages.

The honest trade-off: a fix to the shared auth layer has to be applied four
times. A monorepo with a shared package would avoid that, at the cost of no
folder being independently runnable.

---

## Security behaviour (identical in all four)

| Concern | How it is handled |
| --- | --- |
| Password storage | bcrypt, cost 10. The hash is never returned by any endpoint. |
| Session token | JWT in an **httpOnly, SameSite=Lax** cookie, `Secure` when `NODE_ENV=production`. Page JavaScript cannot read it, so an XSS bug cannot steal the session. |
| SQL injection | Every query is parameterized. Where SQL cannot take a parameter (`ORDER BY`), the value is mapped through a fixed whitelist. |
| XSS | User content is rendered with `textContent` or escaped. The CSP is `script-src 'self'` with **no `'unsafe-inline'`** — every page is started by `/shared/boot.js` reading `data-*` attributes, so there are no inline `<script>` blocks to allow. |
| Brute force | `express-rate-limit` on login and register: 20 attempts per IP per 15 minutes, configurable. |
| Login enumeration | A wrong username and a wrong password return the identical 401 message. |
| Missing secret | The server exits at boot if `JWT_SECRET` is absent or too short. |
| Upload safety | Files are stored under random server-generated names, never the name the browser sent, and the resolved path is re-checked to be inside the uploads folder. |

---

## Repository layout

```
fullstack-web-apps/
├── README.md                        this file
├── .gitignore
├── task1-ecommerce-store/           Project 1 - port 3001
├── task2-social-media/              Project 2 - port 3002
├── task3-project-management/        Project 3 - port 3003
└── task4-realtime-communication/    Project 4 - port 3004
```

Every folder follows the same shape:

```
taskN-.../
├── README.md            this app's documentation
├── package.json         only the dependencies this app needs
├── .env.example
├── server/
│   ├── app.js           Express app, CSP, static files
│   ├── db/              index.js, schema.sql, seed.js
│   ├── middleware/      auth.js, errorHandler.js (+ upload.js where needed)
│   ├── routes/          auth.js + this app's routes
│   ├── sockets/         only in projects 3 and 4
│   └── utils/           validate.js, asyncHandler.js
└── public/
    ├── index.html       landing page for this app
    ├── shared/          styles.css, api.js, ui.js, auth.js, boot.js, home.js
    └── <app>/           this app's pages
```

---

## A few things I would point out

- **Money is stored as integer cents**, never a float, so no rounding error can
  reach an order total.
- **Checkout runs in a single transaction** — order, line items, stock
  decrement and cart clear either all happen or none do, and stock is
  re-checked at checkout rather than only when an item was added.
- **Drag and drop is the native HTML5 API**, no library. A move rewrites the
  whole column's positions in one transaction, so the board can never end up
  with two cards claiming the same slot.
- **Likes and follows are single toggle endpoints**, so a double click cannot
  leave the UI and the database disagreeing.
- **The video chat is genuinely end-to-end encrypted.** The room passphrase
  never leaves the browser; it derives an AES-256-GCM key via PBKDF2, and the
  server stores ciphertext it cannot read. Project 4's README shows a real
  stored row and explains exactly what is and is not protected.
- **Timestamps keep milliseconds**, because `datetime('now')` only resolves to
  whole seconds — which made a post edited in its first second look unedited.
