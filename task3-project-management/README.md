# Task 3 — Project Management Tool

**CodeAlpha Full Stack Development internship · Task 3**

A Trello-style project board: create a group project, add teammates by username,
and move task cards across three columns by dragging them. The board updates
live in everybody's browser, and a notification bell tells you when a task is
assigned to you or somebody comments.

Built with Node.js, Express, SQLite and Socket.io, with a plain
HTML/CSS/JavaScript frontend — the drag and drop is the **native HTML5 API**,
not a library.

This folder is **self-contained** — it has its own server, database, dependencies
and authentication, so it runs on its own.

---

## Contents

- [Quick start](#quick-start)
- [Demo login credentials](#demo-login-credentials)
- [Features](#features)
- [Tech stack](#tech-stack)
- [Folder structure](#folder-structure)
- [How the drag and drop works](#how-the-drag-and-drop-works)
- [How the real-time layer works](#how-the-real-time-layer-works)
- [Database schema](#database-schema)
- [API reference](#api-reference)
- [How to demo](#how-to-demo)
- [Screenshots](#screenshots)
- [Known limitations](#known-limitations)

---

## Quick start

Needs **Node.js 18 or newer**. No database server to install.

```bash
cd task3-project-management

npm install
cp .env.example .env        # Windows: copy .env.example .env
# open .env and set JWT_SECRET to a long random string

npm run seed                # 4 demo users, 1 project, 10 tasks, comments, 2 notifications
npm start
```

Open **<http://localhost:3003>**.

> **`JWT_SECRET` must be set.** The server exits at boot without it rather than
> signing session tokens with a guessable fallback. Generate one with:
> ```bash
> node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
> ```

| Command | What it does |
| --- | --- |
| `npm start` | Start the server on `PORT` (default 3003) |
| `npm run dev` | Same thing |
| `npm run seed` | Reset the database and reload the demo data |

---

## Demo login credentials

Four accounts, all with the password **`password123`**:

| Username | Password | Role in the seeded project |
| --- | --- | --- |
| `demo` | `password123` | **Owner** — can rename, delete, and remove members. Has 2 unread notifications |
| `alice` | `password123` | Member, has assigned tasks |
| `bob` | `password123` | Member, has assigned tasks |
| `carol` | `password123` | Member, has assigned tasks |

To see the real-time features you need **two browser windows** logged in as two
different users — use a private/incognito window for the second.

---

## Features

Mapped to the CodeAlpha Task 3 requirements:

| Required | Status | Where |
| --- | --- | --- |
| **Create group projects** | ✅ | `/projects/` → **New project** |
| **Invite / add members by username** | ✅ | Board → **Add member**, with a datalist of existing users |
| **Kanban board with columns** | ✅ | To Do / In Progress / Done |
| **Task cards** | ✅ | Title, description, assignee, due date, comment count |
| **Drag and drop between columns** | ✅ | Native HTML5 drag and drop, no library |
| **Assign tasks to members** | ✅ | Restricted to actual project members |
| **Due dates** | ✅ | With overdue and due-soon styling |
| **Descriptions** | ✅ | On the card detail modal |
| **Comments inside each task** | ✅ | Threaded in the card detail modal |
| **BONUS: real-time board updates** | ✅ | Socket.io `/projects` namespace |
| **BONUS: notifications** | ✅ | On task assigned, comment added, card moved, project invite |
| **BONUS: notification bell + unread count** | ✅ | In the navbar, on every page |

Beyond the minimum:

- **Reordering within a column**, not just moving between them
- **A "live" presence pill** showing whether the board socket is connected, and
  a banner naming who just did what
- **Progress bars** on the project list showing percentage done
- **Owner-only actions** — rename, delete the project, remove members — with the
  owner unable to remove themselves
- **Removing a member unassigns their cards** rather than deleting them
- **Membership checked on every route**, returning **404 rather than 403** for a
  non-member so project ids cannot be probed
- Keyboard-accessible cards (Enter or Space opens the detail modal)
- A mobile layout where the board scrolls sideways instead of squashing the
  three columns

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | HTML, CSS, vanilla JavaScript — no framework, no build step |
| Backend | Node.js + Express 4 |
| Database | SQLite via `better-sqlite3` (single file, synchronous API) |
| Real-time | `socket.io`, one `/projects` namespace |
| Auth | `bcryptjs` for hashing, `jsonwebtoken` in an httpOnly cookie |
| Security | `helmet` (strict CSP), `cors`, `express-rate-limit`, `dotenv` |

No multer in this task — nothing here is uploaded, so it is not a dependency.

The frontend shares five small modules:

| File | Responsibility |
| --- | --- |
| `public/shared/api.js` | One `fetch` wrapper: sends the cookie, turns a non-2xx reply into a thrown error |
| `public/shared/ui.js` | `el()` element builder, HTML escaping, toasts, modals, relative dates |
| `public/shared/auth.js` | Navbar, login/register card, the login gate |
| `public/shared/notifications.js` | The bell: unread count, panel, live push |
| `public/shared/boot.js` | Starts a page from `data-*` attributes on `<body>` |

The CSP is `script-src 'self'` with **no `'unsafe-inline'`**, so an inline
`<script>` block would be blocked. Each page declares what it needs instead:

```html
<body data-module="projects" data-require-auth="true" data-render="Projects.renderBoard">
```

---

## Folder structure

```
task3-project-management/
├── README.md
├── package.json
├── .env.example
├── server/
│   ├── app.js                  Express app, CSP, Socket.io server, static files
│   ├── db/
│   │   ├── index.js            SQLite connection + migration runner
│   │   ├── schema.sql          users + projects, project_members, tasks,
│   │   │                       task_comments, notifications
│   │   ├── seed.js             demo data (npm run seed)
│   │   └── data/app.db         created on first run (gitignored)
│   ├── middleware/
│   │   ├── auth.js             JWT issue/verify, attachUser, authRequired
│   │   └── errorHandler.js     central error → { error: "message" }
│   ├── routes/
│   │   ├── auth.js             register / login / logout / me
│   │   └── projects.js         this task's endpoints
│   ├── sockets/
│   │   └── projects.js         /projects namespace: live board + notifications
│   └── utils/
│       ├── validate.js         input validation, ApiError
│       └── asyncHandler.js     async route rejections → error handler
└── public/
    ├── index.html              landing page
    ├── shared/                 styles.css, api.js, ui.js, auth.js,
    │                           notifications.js, boot.js, home.js
    └── projects/
        ├── index.html          project list
        ├── board.html          the Kanban board
        ├── projects.css
        └── projects.js
```

---

## How the drag and drop works

This uses the browser's own drag-and-drop API — `draggable="true"` plus the
`dragstart` / `dragover` / `drop` events. No library. Three details are what
make it actually work:

1. **`dragstart` must call `dataTransfer.setData`.** Without it, Firefox never
   fires a `drop` event at all. The card's id goes in as `text/plain`.
2. **`dragover` must call `preventDefault()`.** The default behaviour is to
   *refuse* the drop, so a column that does not cancel the event can never
   receive a card.
3. **The insertion point is computed from the pointer against each card's
   midpoint.** Above the midpoint means "insert before this card", below means
   "after". That is what makes a drop marker appear where you expect:

```
   ┌─────────────┐
   │   Card A    │
   ├ ─ ─ ─ ─ ─ ─ ┤  ← midpoint: above here, insert before A
   │             │
   └─────────────┘
   ══════════════   ← the blue drop marker renders at the computed index
   ┌─────────────┐
   │   Card B    │
   └─────────────┘
```

**On the server**, a move does not patch one row. It rewrites the whole
column's order inside a transaction:

```
PATCH /api/projects/tasks/:id/move  { status: "done", position: 1 }

  1. read the target column's other cards, in order
  2. splice the dragged card in at the requested index
  3. write positions 0..n-1 back over the lot
  4. if the card changed column, close the gap in the old one too
```

Doing it that way means the board can never end up with two cards claiming the
same slot. A position past the end clamps to the end rather than erroring, and
if the request fails the client refetches the board so the UI snaps back to the
server's version rather than lying about where the card is.

---

## How the real-time layer works

Socket.io runs on the same HTTP server, in the `/projects` namespace. The
socket is authenticated from **the same httpOnly JWT cookie** the REST API
uses, so there is no second token mechanism to keep in sync.

Two kinds of room are used, and the distinction matters:

```
  user:<id>      every socket belonging to one person
                 → bell notifications, so they reach you on ANY page

  project:<id>   everyone currently looking at one board
                 → card created / updated / moved / deleted
```

**The REST routes stay the source of truth.** A write happens over HTTP, is
validated and authorized there, and only then does the socket layer broadcast
what changed:

```
  Browser A                Express                Socket.io              Browser B
      │                       │                       │                      │
      │ ── PATCH .../move ──► │                       │                      │
      │                       │ validate + authorize  │                      │
      │                       │ rewrite positions     │                      │
      │                       │ ── emit task:moved ─► │ ── task:moved ─────► │ redraws
      │ ◄── 200 { columns } ─ │                       │                      │
      │                       │ ── emit notification ►│ ── notification ───► │ bell +1
```

That keeps one validation and authorization path instead of duplicating the
rules inside socket handlers. Membership is re-checked when a client joins a
board room, so emitting a project id you do not belong to gets you nothing.

Notifications are written to the database *and* pushed, so the bell is correct
after a page reload and not only while you happen to be connected. The actor is
never notified of their own action.

---

## Database schema

```
  users ──┬── projects (owner_id)
          │      │
          │      ├── project_members ── users
          │      ├── tasks ──┬── task_comments ── users
          │      │           └── assignee → users
          │      └── notifications → users
          └──────────────────┘
```

| Table | Holds |
| --- | --- |
| `users` | One account per person: username, email, bcrypt hash |
| `projects` | Name, description, owner |
| `project_members` | Who is on a project, and whether they are `owner` or `member` |
| `tasks` | Title, description, `status`, assignee, due date, `position` |
| `task_comments` | Task, author, text |
| `notifications` | Recipient, type, message, read flag |

Decisions worth pointing out:

- **`position` is rewritten on every move**, never incremented, which is what
  keeps the order unambiguous.
- **`status` has a `CHECK` constraint** limited to `todo` / `in_progress` /
  `done`, so an invalid column cannot be stored even if a request got past
  validation.
- **`UNIQUE (project_id, user_id)` on `project_members`** means adding the same
  person twice is a 409, not a duplicate row.
- **`assignee_id` is `ON DELETE SET NULL`** — removing a person leaves their
  cards on the board, unassigned, rather than deleting work.
- **An index on `(project_id, status, position)`** matches exactly how the board
  is read.
- **Timestamps keep milliseconds** (`strftime('%Y-%m-%d %H:%M:%f')`); plain
  `datetime('now')` only resolves to whole seconds.

---

## API reference

Everything here requires a session, and every project route checks membership
first.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Create an account and log in |
| `POST` | `/api/auth/login` | Log in with username or email |
| `POST` | `/api/auth/logout` | Clear the cookie |
| `GET` | `/api/auth/me` | Who am I? |
| `GET` | `/api/auth/users` | Usernames, for the member picker |
| `GET` | `/api/projects/notifications` | Bell list + unread count |
| `POST` | `/api/projects/notifications/read-all` | Clear the unread badge |
| `POST` | `/api/projects/notifications/:id/read` | Mark one as read |
| `GET` | `/api/projects` | Projects I own or belong to |
| `POST` | `/api/projects` | Create a project |
| `GET` | `/api/projects/:id` | Project + members + the whole board |
| `PUT` | `/api/projects/:id` | Rename / re-describe (owner only) |
| `DELETE` | `/api/projects/:id` | Delete (owner only) |
| `POST` | `/api/projects/:id/members` | Add a member by username |
| `DELETE` | `/api/projects/:id/members/:userId` | Remove a member (owner only) |
| `POST` | `/api/projects/:id/tasks` | Create a card |
| `GET` | `/api/projects/tasks/:taskId` | One card with its comments |
| `PUT` | `/api/projects/tasks/:taskId` | Edit a card |
| `PATCH` | `/api/projects/tasks/:taskId/move` | Drag and drop: new column + order |
| `DELETE` | `/api/projects/tasks/:taskId` | Delete a card |
| `POST` | `/api/projects/tasks/:taskId/comments` | Add a comment |
| `DELETE` | `/api/projects/comments/:commentId` | Delete your own comment |

> **A route-ordering note.** `/api/projects/notifications` is declared **before**
> `/api/projects/:id`. Express matches in declaration order, so with `:id` first
> a GET of `/notifications` would be read as a project id called
> "notifications" and fail validation.

---

## How to demo

Run `npm run seed && npm start` and open **two windows side by side**:

- Window 1: <http://localhost:3003> as **`demo` / `password123`**
- Window 2: a **private/incognito** window, same URL, as **`alice` / `password123`**

1. **Project list.** Window 1 shows the seeded project with its member count and
   a progress bar. Create a second project with **New project** to show the form.
2. **Open the board in both windows.** Both show the "live" pill once the socket
   connects. Three columns, ten cards, four member chips.
3. **Drag a card** from *To Do* to *In Progress* in window 1. It moves in window
   2 immediately, and a banner there says *"demo moved … to In Progress"*.
4. **Reorder within a column** by dragging a card up past another one. That
   syncs too — it is the same endpoint.
5. **Open a card.** Show the assignee, due date, description and comments. Add a
   comment in window 2; the 💬 count on the card rises in window 1.
6. **Assign a task.** In window 1, **Add task**, assign it to `alice`. In window
   2 the **bell badge increments live**, with no reload. Open the bell, read the
   notification, hit **Mark all read** — the badge clears.
7. **The detail worth showing.** Navigate window 2 to the task's landing page
   (`/`), away from the board. Now assign `alice` another task from window 1.
   The bell **still** increments, because notifications go to a per-user room
   rather than a board room.
8. **Access control.** Log a third window in as a user who is not a member and
   open `/projects/board.html?project=1`. It shows a friendly "not found" error
   rather than leaking that the project exists.
9. **Owner-only actions.** In window 1 (owner) show **Edit** / **Delete
   project** and the × on a member chip. Window 2 (member) does not have them.

---

## Screenshots

> Replace these placeholders with your own captures before submitting.
> Suggested: 1280×800 PNG in a `screenshots/` folder.

### Project list
<!-- ![Project list](screenshots/01-projects.png) -->
_`screenshots/01-projects.png` — projects with member counts and progress bars._

### Kanban board
<!-- ![Kanban board](screenshots/02-board.png) -->
_`screenshots/02-board.png` — the three columns with cards, members and the live pill._

### Drag and drop
<!-- ![Dragging a card](screenshots/03-drag.png) -->
_`screenshots/03-drag.png` — a card mid-drag with the drop marker visible._

### Task detail
<!-- ![Task detail](screenshots/04-task.png) -->
_`screenshots/04-task.png` — assignee, due date, description and comments._

### Real-time sync
<!-- ![Two windows in sync](screenshots/05-realtime.png) -->
_`screenshots/05-realtime.png` — two windows side by side, one showing the live banner._

### Notifications
<!-- ![Notification bell](screenshots/06-notifications.png) -->
_`screenshots/06-notifications.png` — the bell panel open with unread items._

---

## Known limitations

- **Three fixed columns.** To Do / In Progress / Done are a `CHECK` constraint,
  not user-configurable lists. Custom columns would mean a `columns` table and a
  foreign key instead.
- **The whole board reloads on some events.** A card *edited* by someone else
  triggers a refetch rather than a surgical patch, because the edit may have
  moved it between columns. Correct, but chattier than it needs to be.
- **No optimistic UI on drag.** The card moves after the server confirms, so on
  a slow connection there is a visible pause. The trade is that the board never
  shows an order the server disagrees with.
- **No activity log or audit history.** Notifications are the only record that
  something happened, and they are per-recipient.
- **No file attachments, labels, checklists or subtasks** — outside the Task 3
  brief.
- **Socket.io state is in memory.** With more than one server process, two
  people on different instances would not see each other's updates; that needs
  the Redis adapter.
- **SQLite suits one server process.** That is the right call for a project you
  can clone and run in two commands; a multi-instance deployment would want
  Postgres.
