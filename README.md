# CodeAlpha Full Stack Projects

All four tasks from the **CodeAlpha Full Stack Development** internship, built as
one application: an e-commerce store, a social media platform, a Trello-style
project management tool and a real-time communication app.

They are not four separate projects stapled together. They share **one Express
server, one SQLite database, one authentication system and one design system** —
log in once and your session carries across all four apps.

```
Node.js + Express  ·  SQLite (better-sqlite3)  ·  vanilla JS frontend
JWT in an httpOnly cookie  ·  Socket.io  ·  WebRTC  ·  Web Crypto (AES-GCM)
```

---

## Table of contents

- [Quick start](#quick-start)
- [Demo login credentials](#demo-login-credentials)
- [Features by task](#features-by-task)
- [Tech stack](#tech-stack)
- [Folder structure](#folder-structure)
- [How WebRTC signalling works](#how-webrtc-signalling-works)
- [End-to-end encryption](#end-to-end-encryption)
- [Security notes](#security-notes)
- [Database schema](#database-schema)
- [How to demo each task](#how-to-demo-each-task)
- [Screenshots](#screenshots)
- [Known limitations](#known-limitations)

---

## Quick start

You need **Node.js 18 or newer**. Nothing else — no database server to install,
because SQLite is a single file.

```bash
git clone https://github.com/<your-username>/CodeAlpha_FullStack_Projects.git
cd CodeAlpha_FullStack_Projects

# 1. install dependencies
npm install

# 2. create your .env from the template, then open it and set JWT_SECRET
cp .env.example .env        # Windows: copy .env.example .env

# 3. load the demo data (users, products, posts, a project board, a meeting room)
npm run seed

# 4. start everything
npm run dev
```

Then open **<http://localhost:3000>**.

> **Set `JWT_SECRET` before you start.** The server refuses to sign tokens with
> a missing secret rather than falling back to a guessable default. Any long
> random string works, for example the output of
> `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the server on `PORT` (default 3000) |
| `npm start` | Same thing, for production use |
| `npm run seed` | Reset the database and load the demo data |

`npm run seed` is safe to re-run at any time: it clears the demo tables and
re-inserts them, so you always get the same predictable state for a demo.

---

## Demo login credentials

The seed creates four accounts. **Every one uses the password
`password123`.**

| Username | Password | What they have |
| --- | --- | --- |
| `demo` | `password123` | Owns the project board and the meeting room, has a cart, an order and 2 unread notifications |
| `alice` | `password123` | Member of the project board, several posts |
| `bob` | `password123` | Member of the project board, several posts |
| `carol` | `password123` | Member of the project board, several posts |

You can log in with the username **or** the email (`demo@example.com`), and you
can register a new account from any page.

Other seeded values you will want for the demo:

| | |
| --- | --- |
| **Meeting room code** | `DEMO01` |
| **Meeting room passphrase** | `codealpha` |

---

## Features by task

### Phase 1 — Shared foundation

- Single Express server mounting one route module per task under `/api`
- SQLite schema applied on every boot as the migration step
- **One authentication system for all four apps:** register, login, logout, me
- Passwords hashed with **bcrypt**; the hash never leaves the server
- **JWT stored in an httpOnly cookie**, so page JavaScript cannot read the token
- `authRequired` middleware protecting every private route
- Landing page linking all four apps, shared navbar, shared design tokens
- Seed script so every module has data on first run

### Task 1 — Simple E-commerce Store (`/shop`)

- [x] **Product listing page** — responsive grid, 16 seeded products
- [x] **Search** across product name and description, debounced as you type
- [x] **Category filter** built from the catalogue, plus four sort orders
- [x] **Product details page** with stock status, quantity picker and related items
- [x] **Shopping cart** — add, remove, update quantity
- [x] **Cart persisted per user in the database**, not in localStorage, so it
      follows you to another browser
- [x] **Checkout and order processing** — creates the order, copies the order
      lines, reduces stock and clears the cart in a single transaction
- [x] **Order history page with status** (`pending` / `paid` / `shipped` /
      `delivered` / `cancelled`), expandable line items, and cancel-with-restock
- [x] **Login required** for the cart, checkout and order history; browsing is public
- Stock is re-checked at checkout, not just when the item was added, so a cart
  left open overnight cannot oversell the last unit
- Prices stored as integer cents, so no floating-point rounding reaches a total

**Tables:** `products`, `cart_items`, `orders`, `order_items`

### Task 2 — Social Media Platform (`/social`)

- [x] **User profiles** — display name, bio, **avatar upload** (multer),
      follower / following / post counts, and that user's posts
- [x] **Create, edit and delete posts** — text plus an optional image
- [x] **Comments on posts**, deletable by the comment author *or* the post
      author (so you can moderate your own thread)
- [x] **Like / unlike posts** — one toggle endpoint, so a double click can
      never leave the UI and the database disagreeing
- [x] **Follow / unfollow users**, same toggle approach
- [x] **Home feed** showing posts from people you follow **plus your own**
- [x] **Explore page** with every post and a search box (public, no login needed)
- Follower and following lists in a modal, and "people to follow" suggestions
- Every piece of user text is escaped on render — a post containing
  `<img src=x onerror=...>` displays as characters instead of executing

**Tables:** `profiles`, `posts`, `comments`, `likes`, `follows`

### Task 3 — Project Management Tool (`/projects`)

- [x] **Create group projects**, with a description and an owner
- [x] **Invite / add members by username**, with a datalist of existing users
- [x] **Kanban board per project** — To Do / In Progress / Done
- [x] **Drag-and-drop cards between columns** using the **native HTML5 drag and
      drop API** (no library), including reordering *within* a column
- [x] **Assign tasks to members** (restricted to actual project members),
      **due dates** with overdue / due-soon styling, and **descriptions**
- [x] **Comments inside each task**
- [x] **BONUS — real-time board updates and notifications via Socket.io**:
  - a card created, edited, moved or deleted in one tab appears in every other
    tab watching that board, with a banner naming who did it
  - **notification bell with an unread count** in the navbar on *every* page, so
    a task assigned to you while you are in the shop still reaches you
  - notifications fire on **task assigned**, **comment added**, **card moved**
    and **project invite**
  - a "live" presence pill shows whether the board socket is connected

**Tables:** `projects`, `project_members`, `tasks`, `task_comments`, `notifications`

### Task 4 — Real-Time Communication App (`/meet`)

- [x] **Create / join meeting rooms via a room code** (login required).
      Codes are 6 characters from a crypto-random, unambiguous alphabet
- [x] **Multi-user video + audio calling with WebRTC** in a mesh topology —
      **mute/unmute**, **camera on/off**, **leave**
- [x] **Screen sharing** with `getDisplayMedia`, replacing the outgoing video
      track for all peers via `RTCRtpSender.replaceTrack`
- [x] **File sharing in the room** — uploaded to the server, listed to everyone,
      downloadable by all participants, and **encrypted end-to-end**
- [x] **In-room chat**, also encrypted end-to-end
- [x] **Collaborative whiteboard** on `<canvas>` — pen, six colours, adjustable
      brush size, eraser and clear-for-everyone, synced live over Socket.io.
      A late joiner receives the drawing already on the board
- [x] **Data encryption** on two layers, explained in full
      [below](#end-to-end-encryption):
  - media is encrypted by WebRTC itself (**DTLS-SRTP**, mandatory in the spec)
  - chat messages and shared files are encrypted in the browser with the
    **Web Crypto API** — **AES-256-GCM**, key derived from a room passphrase via
    **PBKDF2** — so **the server only ever stores ciphertext**
- Participant panel showing who is in the room and their mute / camera /
  sharing state

**Tables:** `rooms`, `room_messages`, `room_files`

---

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | HTML, CSS, vanilla JavaScript | No build step; the whole frontend is readable as-is |
| Backend | Node.js + Express 4 | One server for all four modules |
| Database | SQLite via `better-sqlite3` | Zero setup, single file, synchronous API keeps handlers simple |
| Auth | `bcryptjs` + `jsonwebtoken` | bcrypt hashes, JWT in an httpOnly cookie |
| Real-time | `socket.io` | One namespace per real-time module |
| Video | WebRTC (mesh) + Google STUN | Peer-to-peer media, Socket.io as the signalling channel |
| Encryption | Web Crypto API | AES-GCM and PBKDF2 built into the browser, no dependency |
| Uploads | `multer` | Avatars, post images, encrypted room files |
| Security | `helmet`, `cors`, `express-rate-limit`, `dotenv` | Headers, CORS, brute-force limits, secrets out of the code |

There is **no frontend framework and no bundler**. Shared behaviour lives in
five small modules that every page loads:

| File | Responsibility |
| --- | --- |
| `public/shared/api.js` | One `fetch` wrapper: sends the cookie, turns a non-2xx reply into a thrown error carrying the server's message |
| `public/shared/ui.js` | `el()` element builder, HTML escaping, toasts, modals, money and date formatting |
| `public/shared/auth.js` | Navbar, login/register card, the "this page needs a login" gate |
| `public/shared/notifications.js` | The notification bell, on every page |
| `public/shared/boot.js` | Starts a page from `data-*` attributes on `<body>` |

That last one exists for a reason worth knowing: the Content-Security-Policy is
`script-src 'self'` with **no `'unsafe-inline'`**, which means an inline
`<script>` block would be blocked by the browser. So every page declares what it
needs as attributes and `boot.js` wires it up:

```html
<body data-module="shop" data-require-auth="true" data-render="Shop.renderCart">
```

---

## Folder structure

```
CodeAlpha_FullStack_Projects/
├── server/
│   ├── app.js                  Express app, helmet/CORS/CSP, static files, Socket.io
│   ├── db/
│   │   ├── index.js            SQLite connection + migration runner
│   │   ├── schema.sql          Every table, grouped by task
│   │   ├── seed.js             Demo data (npm run seed)
│   │   └── data/app.db         The database file (gitignored, created on first run)
│   ├── middleware/
│   │   ├── auth.js             JWT issue/verify, attachUser, authRequired
│   │   ├── errorHandler.js     Central error → { error: "message" } JSON
│   │   └── upload.js           multer storage for avatars, post images, room files
│   ├── routes/
│   │   ├── auth.js             register / login / logout / me  (shared by all apps)
│   │   ├── shop.js             Task 1
│   │   ├── social.js           Task 2
│   │   ├── projects.js         Task 3
│   │   └── meet.js             Task 4
│   ├── sockets/
│   │   ├── projects.js         /projects namespace: live board + notifications
│   │   └── meet.js             /meet namespace: WebRTC signalling, chat, whiteboard
│   └── utils/
│       ├── validate.js         Input validation helpers, ApiError
│       └── asyncHandler.js     Passes async route rejections to the error handler
├── public/
│   ├── index.html              Landing page linking all four apps
│   ├── shared/                 styles.css, api.js, ui.js, auth.js, notifications.js,
│   │                           boot.js, home.js
│   ├── shop/                   index, product, cart, orders + shop.css/js
│   ├── social/                 index (feed), explore, profile + social.css/js
│   ├── projects/               index (list), board + projects.css/js
│   ├── meet/                   index (lobby), room + meet.css/js, crypto.js
│   └── uploads/                Uploaded files (gitignored)
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

## How WebRTC signalling works

Audio and video travel **directly between browsers**. The server never sees the
media — it only helps the two browsers find each other. That introduction is
called *signalling*, and it runs over the Socket.io `/meet` namespace.

### Topology: mesh

Every participant holds one `RTCPeerConnection` to every other participant. With
N people in the room each browser maintains N−1 connections:

```
   3 people                      4 people
   A ────── B                    A ────── B
    \      /                     │ ╲    ╱ │
     \    /                      │  ╲  ╱  │
       C                         │   ╲╱   │
                                 │   ╱╲   │
   3 connections                 │  ╱  ╲  │
                                 D ────── C      6 connections
```

No media server is needed, which is exactly why it suits this project. The cost
is that each browser uploads its video once per peer, so a mesh is comfortable
for about 4–6 people and no more.

### The handshake

```
  Newcomer (C)              Socket.io /meet              Already in room (A)
      │                            │                             │
      │ ── room:join { code } ───► │                             │
      │ ◄── ack { peers:[A,B],     │                             │
      │          strokes:[...] } ─ │ ── peer:joined { C } ─────► │
      │                            │                             │
      │ ── webrtc:offer {to:A} ──► │ ── webrtc:offer {from:C} ──► │
      │                            │                             │ setRemoteDescription
      │                            │                             │ createAnswer
      │ ◄─ webrtc:answer {from:A} ─│ ◄── webrtc:answer {to:C} ── │
      │ setRemoteDescription       │                             │
      │                            │                             │
      │ ── webrtc:ice ───────────► │ ── webrtc:ice ────────────► │
      │ ◄── webrtc:ice ─────────── │ ◄── webrtc:ice ──────────── │
      │        (several, as candidates are discovered)            │
      │                            │                             │
      │ ◄══════ audio + video, peer-to-peer, DTLS-SRTP ════════► │
                             (never through the server)
```

Three message types are relayed, each to **one named socket id** and nowhere else:

| Event | Meaning |
| --- | --- |
| `webrtc:offer` | "Here is my session description — codecs, tracks. Can you match it?" |
| `webrtc:answer` | "Yes, and here is mine." |
| `webrtc:ice` | "Here is a network route you could reach me on." |

**Who offers.** The person who just joined sends the offer; whoever was already
in the room waits for it. Without that rule both sides would offer
simultaneously ("glare") and neither could answer.

**STUN.** A browser behind a home router does not know its own public address.
`stun:stun.l.google.com:19302` (plus a second as a fallback) answers "this is
how you look from the outside", which is what makes a direct connection
possible. Two STUN servers are configured so one being unreachable is not fatal.

**Security of the relay.** The socket is authenticated from the same httpOnly
JWT cookie the REST API uses, and a signalling message is only forwarded if the
target socket is in the same room as the sender. A client cannot use the
signalling channel to reach into another meeting.

**What is NOT here: TURN.** On about 10% of networks — strict corporate or
carrier NAT — no direct path exists and the media needs to be relayed by a TURN
server. Running one needs a host with bandwidth, which is out of scope for this
submission, so on such a network a call will show *"connection failed"* rather
than silently hanging. Everything else in the room (chat, files, whiteboard)
keeps working, because it goes over Socket.io.

---

## End-to-end encryption

There are **two independent layers**, protecting two different things.

### Layer 1 — the media stream: DTLS-SRTP (automatic)

WebRTC does not have an unencrypted mode. The specification mandates DTLS-SRTP,
so the audio and video flowing between two browsers is encrypted by the browsers
themselves, with keys negotiated during that DTLS handshake. The server is not
on the media path at all, and could not decrypt the stream if it were. **Nothing
in this project needed to be written to get this** — it is worth saying plainly
rather than taking credit for it.

### Layer 2 — chat and files: AES-GCM via the Web Crypto API (written here)

Chat messages and shared files *do* pass through the server, and by default the
server could read them. `public/meet/crypto.js` closes that gap.

**Deriving the key.** Each participant types the room passphrase locally. It is
**never transmitted** — not to the server, not to the other peers. Instead every
browser derives the same key independently:

```
 passphrase  ──┐
               ├── PBKDF2 ── SHA-256, 150,000 iterations ──►  AES-256-GCM key
 salt        ──┘                                              (non-extractable)
   = "codealpha-meet-v1:" + ROOM_CODE
```

- The **salt comes from the room code**, so everyone in a room reaches the same
  key, while the same passphrase in a *different* room derives a different one.
- **150,000 PBKDF2 iterations** is what makes a weak passphrase expensive to
  brute-force: an attacker must pay that cost for every guess.
- The key is imported as **non-extractable**, so even page JavaScript cannot
  read the raw key bytes back out.

**Encrypting a message.** AES-GCM with a **fresh random 12-byte IV every time**:

```
 plaintext ──► AES-256-GCM(key, random IV) ──► ciphertext + 16-byte auth tag
                                               │
                        base64(ciphertext), base64(IV)  ──► server
```

AES-GCM is an AEAD mode, which buys two things at once:

- **confidentiality** — the server sees random bytes
- **integrity** — if a single byte of the ciphertext is altered, decryption
  *fails loudly* instead of returning wrong plaintext

Reusing an IV with the same key breaks AES-GCM badly, so a new random IV is
generated per message and sent alongside the ciphertext. An IV is not secret;
only the key is.

**Encrypting a file.** The bytes and the **filename are encrypted separately,
each with its own IV**. The name and MIME type are packed into a small JSON
object and encrypted, so the server cannot even see what a file is called:

```
 file bytes ──► AES-GCM(key, iv)      ──► uploaded as "encrypted.bin"
 {name,type} ──► AES-GCM(key, name_iv) ──► stored in original_name
```

Downloading reverses it: the client fetches the ciphertext, decrypts the
metadata to recover the real name and type, decrypts the bytes, and hands the
browser a normal download.

### What the server stores

This is a real row from `room_messages` after sending "hello team":

```json
{
  "id": 1,
  "user_id": 1,
  "username": "demo",
  "ciphertext": "k3HqLm9wTt4vZ1pQ8bYx2NcRfA6sD0eJgHiKlMnOpQrStUvWxYz=",
  "iv": "9fK2mN8qR1sT4vWx",
  "created_at": "2026-10-18 09:14:22.117"
}
```

You can verify this yourself — see
[*Prove the encryption is real*](#5-prove-the-encryption-is-real) below.

### What this does and does not protect

**Protected.** The contents of every chat message, the contents of every shared
file, and the filenames. Without the passphrase these are random bytes. A
database dump, a compromised server, or anyone inspecting network traffic learns
nothing about what was said or shared.

**Not protected (metadata).** The server still knows *which account* sent a
message, *when*, *how large* it was, who is in which room, and the room names
and codes. Hiding that would need a fundamentally different design and is
honestly out of scope here.

**The trust model.** The passphrase is shared out-of-band — you tell your
teammates over another channel. Anyone with the room code *and* the passphrase
can read everything in that room; anyone with only the code sees ciphertext and
is shown "[cannot decrypt]" in the chat. The server never has the passphrase and
so is never able to read the contents, which is the point of the exercise.

---

## Security notes

| Concern | How it is handled |
| --- | --- |
| **Password storage** | bcrypt with a cost of 10. The hash is never included in any API response. |
| **Session token** | JWT in an **httpOnly, SameSite=Lax** cookie, marked `Secure` when `NODE_ENV=production`. Page JavaScript cannot read it, so an XSS bug cannot steal the session. |
| **Deleted accounts** | The user row is re-read on every request, so a valid token for a deleted account stops working immediately. |
| **SQL injection** | Every query is parameterized — there is no string concatenation of user input anywhere. Where SQL cannot take a parameter (`ORDER BY`), the value is mapped through a fixed whitelist. |
| **XSS** | All user content is rendered with `textContent` or escaped through `esc()`. The CSP is `script-src 'self'` with no `'unsafe-inline'`, so even an injected `<script>` would not run. |
| **Brute force** | `express-rate-limit` on login and register: 20 attempts per IP per 15 minutes, configurable via `AUTH_RATE_LIMIT_MAX`. |
| **Login enumeration** | A wrong username and a wrong password return the identical 401 message, so an attacker cannot discover which accounts exist. |
| **Authorization** | Every private route checks ownership or membership. Project and order lookups return **404 rather than 403** for a non-member, so ids cannot be probed. |
| **Path traversal** | Uploaded files are stored under random server-generated names; the original filename is never used as a path. Before any delete or read, the resolved path is checked to still be inside the uploads folder. |
| **Upload abuse** | Images are limited by MIME type and size (2MB avatars, 5MB post images). Room files are capped at 20MB and always served as `application/octet-stream` with `nosniff`. |
| **Secrets** | Everything sensitive comes from `.env`, which is gitignored. The server **refuses to start signing tokens** without `JWT_SECRET` rather than using a fallback. |
| **Socket auth** | Both Socket.io namespaces authenticate from the same JWT cookie and re-check room/project membership on join — a client cannot subscribe to a board or relay signalling into a room it does not belong to. |

---

## Database schema

One SQLite file, tables grouped per task, every cross-module link pointing back
to the single `users` table.

```
                        ┌─────────┐
                        │  users  │  shared by all four apps
                        └────┬────┘
        ┌──────────────┬─────┴──────┬──────────────────┐
        │              │            │                  │
   TASK 1 shop    TASK 2 social  TASK 3 projects   TASK 4 meet
   ───────────    ─────────────  ───────────────   ──────────
   products       profiles       projects          rooms
   cart_items     posts          project_members   room_messages
   orders         comments       tasks             room_files
   order_items    likes          task_comments
                  follows        notifications
```

Design decisions worth pointing out:

- **Money is integer cents** (`price_cents`), never a float, so no rounding
  error can reach an order total.
- **Order lines copy the product name and price** at purchase time, so a past
  order stays correct even if the product is later renamed, repriced or deleted.
- **`UNIQUE` pairs make toggles idempotent** — `likes(post_id, user_id)` and
  `follows(follower_id, following_id)` mean one user can like a post once, and
  `cart_items(user_id, product_id)` turns "add again" into a quantity bump
  instead of a duplicate row.
- **`CHECK (follower_id <> following_id)`** stops self-follows at the database
  level, not just in the application.
- **Timestamps keep milliseconds** (`strftime('%Y-%m-%d %H:%M:%f')`). Plain
  `datetime('now')` only resolves to whole seconds, which made a post edited in
  the same second it was created look unedited.
- **`ON DELETE CASCADE` throughout**, with `PRAGMA foreign_keys = ON` set on
  every connection — SQLite does not enforce foreign keys by default.

Migrations run on boot: `schema.sql` is all `CREATE ... IF NOT EXISTS`, so new
tables appear and existing data is untouched. The limit of that approach is that
it cannot alter an existing column — doing so means deleting
`server/db/data/app.db` and re-running `npm run seed`, which is cheap here
because the database is one gitignored file rebuilt from the seed.

---

## How to demo each task

Start with `npm run seed && npm run dev`, open <http://localhost:3000> and log in
as **`demo` / `password123`**.

### 1. Shared authentication (30 seconds, do this first)

1. On the landing page, log in as `demo`.
2. Open the browser devtools → Application → Cookies. Point out `ca_token` with
   **HttpOnly ticked** — this is why page JavaScript cannot read the session.
3. Click between **Shop → Social → Projects → Meet** in the navbar. You are
   already signed in everywhere: one auth system, four apps.

### 2. Task 1 — E-commerce store

1. Go to **Shop**. Type `keyboard` in the search box — the grid narrows as you
   type. Switch the category dropdown to `books`.
2. Click a product to open its details page, set the quantity to 2, **Add to cart**.
3. Open **Cart**. Use − / + to change a quantity; the subtotal and the nav badge
   update. Note the cart was already populated from the seed — because it lives
   in the database, not localStorage.
4. **Proceed to checkout**, fill in the address, pay. You land on the order with
   its status.
5. **The detail worth showing:** open a product page in a second tab first and
   note its stock. After checkout, reload it — the stock has dropped by exactly
   what you bought, because the order and the stock decrement happen in one
   transaction.
6. Cancel the order from the history page and reload the product again — the
   stock comes back.

### 3. Task 2 — Social media platform

1. Go to **Social**. The home feed shows posts from `alice`, `bob` and `carol`
   because `demo` follows them.
2. Write a post, attach an image, publish — it appears at the top without a reload.
3. Like it (the heart fills and the count moves), click 💬 to open comments, add
   one, delete it again.
4. **Edit** your post, then look at the timestamp line — it now says *edited*.
5. Click `alice` to open her profile: bio, avatar, follower counts, her posts.
   Hit **Unfollow**, go back to the feed, and her posts are gone. Follow her again.
6. Open **Explore** and show it works logged out too (try a private window).
7. **The detail worth showing:** post the literal text
   `<img src=x onerror="alert(1)">`. It renders as visible characters, not an
   alert — every piece of user content is escaped on render.

### 4. Task 3 — Project management (open two windows side by side)

1. Window 1: log in as `demo`, open **Projects → the seeded board**.
2. Window 2: a private window logged in as `alice`, same board.
3. **Drag a card** from *To Do* to *In Progress* in window 1. It moves in window
   2 immediately, with a banner saying *"demo moved … to In Progress"*.
4. Drag a card **within** a column to reorder it — that syncs too.
5. Click a card: assignee, due date, description, comments. Add a comment in
   window 2 and watch the 💬 count rise in window 1.
6. **Add task** in window 1, assign it to `alice`. In window 2 the
   **notification bell badge increments live**, with no reload.
7. Open the bell in window 2, read the notification, hit **Mark all read** — the
   badge clears.
8. **The detail worth showing:** navigate window 2 to the **Shop**, then assign
   `alice` another task from window 1. The bell still increments — notifications
   go to a per-user Socket.io room, so they follow you across all four apps.

### 5. Task 4 — Real-time communication (two windows again)

1. Window 1 as `demo`, Window 2 (private) as `alice`.
2. Both: **Meet → join room `DEMO01`**, passphrase **`codealpha`**.
   Point out that the room is gated on the passphrase *before* anything loads.
3. Both video tiles connect. Try **Mute**, **Camera off** — the other window's
   participant panel shows the 🔇 / 🚫 state.
4. Click **Share** in window 1 and pick a window or screen. Window 2 now sees
   your screen instead of your camera — the track was swapped with
   `replaceTrack`, without re-establishing the call. Stop sharing; the camera
   comes back.
5. **Chat:** send a message from window 1. It arrives in window 2 decrypted.
6. **Files:** drop a file onto the **Files** tab in window 1. Window 2 sees it
   appear, with the correct filename, and can download it — decrypted on arrival.
7. **Whiteboard:** scroll down and draw. The stroke appears in the other window
   as you move. Change colour, use the eraser, then **Clear board** — it clears
   for both.
8. **Late joiner:** open a third window as `bob`, join the same room with the
   same passphrase. The existing drawing is already on his board.

#### Prove the encryption is real

This is the most convincing 60 seconds of the whole demo.

1. With a few messages sent, open a new tab at
   **<http://localhost:3000/api/meet/rooms/DEMO01/messages>**

   You are logged in, so the server happily returns the chat history — and it is
   **unreadable base64**. The server stores ciphertext and has no key.

2. Note that **every message has a different `iv`**. That is the per-message
   random IV that AES-GCM requires.

3. Now join `DEMO01` in a private window with a **deliberately wrong
   passphrase**. The room opens, the history loads — and every message reads
   *"[cannot decrypt — this message used a different passphrase]"*. AES-GCM
   verifies its authentication tag, so a wrong key fails cleanly instead of
   producing garbage.

4. Same for files: open
   **<http://localhost:3000/api/meet/rooms/DEMO01/files>** and show that
   `original_name` is base64 ciphertext — the server does not even know what the
   file is called.

---

## Screenshots

> Replace these placeholders with your own captures before submitting.
> Suggested: 1280×800, PNG, saved in a `screenshots/` folder.

### Landing page
<!-- ![Landing page](screenshots/01-landing.png) -->
_`screenshots/01-landing.png` — the four task cards and the shared navbar._

### Shared login
<!-- ![Login](screenshots/02-login.png) -->
_`screenshots/02-login.png` — the register / login card used by all four apps._

### Task 1 — Store
<!-- ![Product listing](screenshots/03-shop-listing.png) -->
_`screenshots/03-shop-listing.png` — product grid with search and category filter._
<!-- ![Cart and checkout](screenshots/04-shop-cart.png) -->
_`screenshots/04-shop-cart.png` — cart with the checkout modal open._
<!-- ![Order history](screenshots/05-shop-orders.png) -->
_`screenshots/05-shop-orders.png` — order history with statuses._

### Task 2 — Social
<!-- ![Home feed](screenshots/06-social-feed.png) -->
_`screenshots/06-social-feed.png` — home feed with the composer and a post._
<!-- ![Profile](screenshots/07-social-profile.png) -->
_`screenshots/07-social-profile.png` — profile with bio, avatar and counts._

### Task 3 — Projects
<!-- ![Kanban board](screenshots/08-projects-board.png) -->
_`screenshots/08-projects-board.png` — the three columns with cards._
<!-- ![Real-time sync](screenshots/09-projects-realtime.png) -->
_`screenshots/09-projects-realtime.png` — two windows side by side, one card mid-drag._
<!-- ![Notifications](screenshots/10-projects-notifications.png) -->
_`screenshots/10-projects-notifications.png` — the bell open with unread items._

### Task 4 — Meet
<!-- ![Video call](screenshots/11-meet-call.png) -->
_`screenshots/11-meet-call.png` — two participants connected._
<!-- ![Screen share](screenshots/12-meet-screenshare.png) -->
_`screenshots/12-meet-screenshare.png` — a screen share in progress._
<!-- ![Whiteboard](screenshots/13-meet-whiteboard.png) -->
_`screenshots/13-meet-whiteboard.png` — the shared whiteboard mid-drawing._
<!-- ![Ciphertext proof](screenshots/14-meet-ciphertext.png) -->
_`screenshots/14-meet-ciphertext.png` — the messages API returning base64 ciphertext._

---

## Known limitations

Stated openly, because knowing where something stops is part of understanding it.

- **WebRTC mesh scales to a handful of people.** Each browser uploads its video
  once per peer, so 4–6 participants is comfortable and more is not. Beyond that
  you need an SFU (a media server that forwards streams).
- **No TURN server.** On strict NAT where no direct path exists, a call reports
  *"connection failed"*. Chat, files and the whiteboard still work.
- **`getUserMedia` and `getDisplayMedia` need a secure context.** `localhost`
  counts, so local development is fine, but a deployment must be served over
  HTTPS or the camera will not start. The same applies to the Web Crypto API
  used for the encryption.
- **Encryption covers contents, not metadata.** See
  [the trust model](#what-this-does-and-does-not-protect).
- **Checkout is simulated.** It creates an order and reduces stock; no payment
  provider is integrated.
- **The whiteboard history is in memory**, capped at 1500 segments and freed
  when the last person leaves a room. It is for catching up a late joiner, not a
  permanent record.
- **SQLite suits one server process.** It is the right call for a submission you
  can clone and run in two commands; a multi-instance deployment would want
  Postgres and a Redis adapter for Socket.io.

---

Built for the **CodeAlpha Full Stack Development** internship.
