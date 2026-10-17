# CodeAlpha Tasks

All four tasks from the **CodeAlpha Full Stack Development** internship.

Each task is a **self-contained application in its own folder** — its own
`package.json`, its own Express server, its own SQLite database and its own
copy of the shared authentication layer. You can clone this repository, step
into any one folder, and run that task on its own without touching the others.

```
Node.js + Express  ·  SQLite (better-sqlite3)  ·  vanilla HTML/CSS/JS
bcrypt + JWT in an httpOnly cookie  ·  Socket.io  ·  WebRTC  ·  Web Crypto (AES-GCM)
```

---

## The four tasks

| # | Task | Folder | Port | What it does |
| --- | --- | --- | --- | --- |
| 1 | Simple E-commerce Store | [task1-ecommerce-store](https://github.com/Apeksha-22/codealpha_tasks/tree/main/task1-ecommerce-store) | 3001 | Product catalogue with search and filters, cart persisted per user, checkout, order history |
| 2 | Social Media Platform | [task2-social-media](https://github.com/Apeksha-22/codealpha_tasks/tree/main/task2-social-media) | 3002 | Profiles with avatar upload, posts with images, comments, likes, follow graph, home feed |
| 3 | Project Management Tool | [task3-project-management](https://github.com/Apeksha-22/codealpha_tasks/tree/main/task3-project-management) | 3003 | Group projects, Kanban board with drag and drop, task comments, live sync and notifications |
| 4 | Real-Time Communication App | [task4-realtime-communication](https://github.com/Apeksha-22/codealpha_tasks/tree/main/task4-realtime-communication) | 3004 | WebRTC video calls, screen share, end-to-end encrypted chat and files, shared whiteboard |

Each folder has its own README with the full feature checklist, a demo script
and its known limitations.

---

## Running any task

You need **Node.js 18 or newer**. Nothing else — SQLite is a single file, so
there is no database server to install.

```bash
git clone https://github.com/Apeksha-22/codealpha_tasks.git
cd codealpha_tasks/task1-ecommerce-store     # or any other task folder

npm install
cp .env.example .env        # Windows: copy .env.example .env
# then open .env and set JWT_SECRET to a long random string

npm run seed                # loads the demo data
npm start
```

Then open the port that task prints, for example <http://localhost:3001>.

> **Set `JWT_SECRET` before starting.** Each server refuses to boot without one
> rather than signing session tokens with a guessable fallback. Generate one
> with:
> ```bash
> node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
> ```

Because every task uses a different default port, all four can run at the same
time in four terminals.

---

## Demo login credentials

Every task seeds the **same four accounts**, all with the password
**`password123`**:

| Username | Password |
| --- | --- |
| `demo` | `password123` |
| `alice` | `password123` |
| `bob` | `password123` |
| `carol` | `password123` |

`demo` is the account that owns the seeded data in each task. You can log in
with the username or the email (`demo@example.com`), or register a new account
from any page.

For Task 4 the seeded meeting room is code **`DEMO01`**, passphrase
**`codealpha`**.

---

## Why each folder repeats the shared code

The CodeAlpha submission form asks for a separate link per task, so every task
has to stand on its own. That means each folder carries its own copy of the
foundation all four share:

| Duplicated in every task | Why it is there |
| --- | --- |
| `server/routes/auth.js` | register / login / logout / me |
| `server/middleware/auth.js` | signs and verifies the JWT, the `authRequired` guard |
| `server/middleware/errorHandler.js` | turns a thrown error into `{ error: "message" }` |
| `server/utils/validate.js` | input validation helpers |
| `server/utils/asyncHandler.js` | passes async route rejections to the error handler |
| `server/db/index.js` | SQLite connection and the migration runner |
| `public/shared/*` | design tokens, fetch wrapper, UI helpers, navbar, page bootstrapper |

The duplication is deliberate rather than an accident of copy-pasting: it is
what lets each folder be cloned and run by itself. Each task's `schema.sql`
holds the shared `users` table plus only that task's own tables, and each
task's navbar links only to its own pages.

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
codealpha_tasks/
├── README.md                        this file
├── .gitignore
├── task1-ecommerce-store/           Task 1 - port 3001
├── task2-social-media/              Task 2 - port 3002
├── task3-project-management/        Task 3 - port 3003
└── task4-realtime-communication/    Task 4 - port 3004
```

Every task folder follows the same shape:

```
taskN-.../
├── README.md            this task's documentation
├── package.json         only the dependencies this task needs
├── .env.example
├── server/
│   ├── app.js           Express app, CSP, static files
│   ├── db/              index.js, schema.sql, seed.js
│   ├── middleware/      auth.js, errorHandler.js (+ upload.js where needed)
│   ├── routes/          auth.js + this task's routes
│   ├── sockets/         only in tasks 3 and 4
│   └── utils/           validate.js, asyncHandler.js
└── public/
    ├── index.html       landing page for this task
    ├── shared/          styles.css, api.js, ui.js, auth.js, boot.js, home.js
    └── <app>/           this task's pages
```

---

Built for the **CodeAlpha Full Stack Development** internship.
