# Project 2 — Social Media Platform

One of four apps in [fullstack-web-apps](https://github.com/console-log-life/fullstack-web-apps).

A small social network: profiles with avatars, posts with images, comments,
likes, and a follow graph that drives a personalised home feed. Built with
Node.js, Express and SQLite, with a plain HTML/CSS/JavaScript frontend and no
framework.

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
cd task2-social-media

npm install
cp .env.example .env        # Windows: copy .env.example .env
# open .env and set JWT_SECRET to a long random string

npm run seed                # 4 demo users with bios, 10 posts, comments, likes, follows
npm start
```

Open **<http://localhost:3002>**.

> **`JWT_SECRET` must be set.** The server exits at boot without it rather than
> signing session tokens with a guessable fallback. Generate one with:
> ```bash
> node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
> ```

| Command | What it does |
| --- | --- |
| `npm start` | Start the server on `PORT` (default 3002) |
| `npm run dev` | Same thing |
| `npm run seed` | Reset the database and reload the demo data |

---

## Demo login credentials

Four accounts, all with the password **`password123`**:

| Username | Password | What they have |
| --- | --- | --- |
| `demo` | `password123` | Follows all three others, so the home feed is populated |
| `alice` | `password123` | Posts, a bio, followers |
| `bob` | `password123` | Posts, a bio, followers |
| `carol` | `password123` | Posts, a bio, followers |

You can log in with the username or the email (`demo@example.com`), or register
a new account from the landing page.

---

## Features

What it does:

| Required | Status | Where |
| --- | --- | --- |
| **User profiles** | ✅ | `/social/profile.html?u=…` — display name, bio, avatar, counts, that user's posts |
| **Create / edit / delete posts** | ✅ | Composer on the feed; edit and delete from the post's own menu |
| **Comments on posts** | ✅ | 💬 on any post opens the thread |
| **Like / unlike posts** | ✅ | ♡ toggles, with a live count |
| **Follow / unfollow users** | ✅ | From a profile or the suggestions sidebar |
| **Home feed** | ✅ | `/social/` — posts from people you follow, plus your own |
| **Image upload** | ✅ | Avatars and post images, via multer |
| **Database** | ✅ | SQLite: `profiles`, `posts`, `comments`, `likes`, `follows` |

Beyond the minimum:

- **Explore page** (`/social/explore.html`) with every post and a search box —
  public, so it works logged out
- **Likes and follows are single toggle endpoints.** One request either creates
  or removes the row, so a double click cannot leave the UI and the database
  disagreeing
- **Comment moderation** — a comment can be deleted by its author *or* by the
  author of the post it is on
- **"People to follow" suggestions**, ordered by follower count, excluding
  yourself and anyone you already follow
- **Follower / following lists** in a modal, reachable by clicking the counts
- **Image previews before upload**, with a client-side size check so you are
  told before a 5MB request is attempted
- **An "edited" marker** on posts whose text has changed since posting
- **XSS protection you can test** — post `<img src=x onerror="alert(1)">` and it
  renders as visible characters, not an alert
- Empty states that explain what to do next (an empty feed tells you to follow
  someone or visit Explore), and a mobile layout with no horizontal scrolling

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | HTML, CSS, vanilla JavaScript — no framework, no build step |
| Backend | Node.js + Express 4 |
| Database | SQLite via `better-sqlite3` (single file, synchronous API) |
| Auth | `bcryptjs` for hashing, `jsonwebtoken` in an httpOnly cookie |
| Uploads | `multer` — avatars (2MB) and post images (5MB), images only |
| Security | `helmet` (strict CSP), `cors`, `express-rate-limit`, `dotenv` |

No Socket.io in this task — nothing here is real-time, so it is not a dependency.

The frontend shares four small modules that every page loads:

| File | Responsibility |
| --- | --- |
| `public/shared/api.js` | One `fetch` wrapper: sends the cookie, turns a non-2xx reply into a thrown error carrying the server's message |
| `public/shared/ui.js` | `el()` element builder, HTML escaping, toasts, modals, relative dates |
| `public/shared/auth.js` | Navbar, login/register card, the "this page needs a login" gate |
| `public/shared/boot.js` | Starts a page from `data-*` attributes on `<body>` |

The CSP is `script-src 'self'` with **no `'unsafe-inline'`**, so an inline
`<script>` block would be blocked by the browser. Each page declares what it
needs instead:

```html
<body data-module="social" data-require-auth="true" data-render="Social.renderFeed">
```

---

## Folder structure

```
task2-social-media/
├── README.md
├── package.json
├── .env.example
├── server/
│   ├── app.js                  Express app, CSP, static files, 404 handling
│   ├── db/
│   │   ├── index.js            SQLite connection + migration runner
│   │   ├── schema.sql          users + profiles, posts, comments, likes, follows
│   │   ├── seed.js             demo data (npm run seed)
│   │   └── data/app.db         created on first run (gitignored)
│   ├── middleware/
│   │   ├── auth.js             JWT issue/verify, attachUser, authRequired
│   │   ├── errorHandler.js     central error → { error: "message" }
│   │   └── upload.js           multer storage for avatars and post images
│   ├── routes/
│   │   ├── auth.js             register / login / logout / me
│   │   └── social.js           this task's endpoints
│   └── utils/
│       ├── validate.js         input validation, ApiError
│       └── asyncHandler.js     async route rejections → error handler
└── public/
    ├── index.html              landing page
    ├── shared/                 styles.css, api.js, ui.js, auth.js, boot.js, home.js
    ├── social/
    │   ├── index.html          home feed
    │   ├── explore.html        every post, with search
    │   ├── profile.html        a user profile
    │   ├── social.css
    │   └── social.js
    └── uploads/                avatars/ and posts/ (gitignored)
```

---

## Database schema

```
                    users
                      │
   ┌──────────┬───────┼────────┬──────────┐
   │          │       │        │          │
profiles    posts   likes   comments   follows
            │         │        │       (follower → following)
            └─────────┴────────┘
```

| Table | Holds |
| --- | --- |
| `users` | One account per person: username, email, bcrypt hash |
| `profiles` | Display name, bio, avatar URL — one row per user |
| `posts` | Author, text, optional image, created/updated timestamps |
| `comments` | Post, author, text |
| `likes` | Post + user pair |
| `follows` | `follower_id` follows `following_id` |

Decisions worth pointing out:

- **`UNIQUE (post_id, user_id)` on `likes`** makes liking idempotent — one user
  can like a post exactly once, enforced by the database rather than by hoping
  the UI behaves.
- **`UNIQUE (follower_id, following_id)` on `follows`**, with
  **`CHECK (follower_id <> following_id)`** so a self-follow is impossible at
  the schema level.
- **`profiles` is separate from `users`** so the account table stays the same
  shape across all four apps.
- **Timestamps keep milliseconds** (`strftime('%Y-%m-%d %H:%M:%f')`). Plain
  `datetime('now')` only resolves to whole seconds, which made a post edited in
  the same second it was created look unedited.
- **`ON DELETE CASCADE`** throughout, with `PRAGMA foreign_keys = ON` on every
  connection — deleting a post takes its likes and comments with it, and SQLite
  does not enforce foreign keys by default.

---

## API reference

Explore and profiles are public; posting and interacting need a session.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | — | Create an account and log in |
| `POST` | `/api/auth/login` | — | Log in with username or email |
| `POST` | `/api/auth/logout` | — | Clear the cookie |
| `GET` | `/api/auth/me` | — | Who am I? |
| `GET` | `/api/social/feed` | ✅ | Posts from people you follow, plus your own |
| `GET` | `/api/social/explore` | — | Every post, with `?search=` |
| `POST` | `/api/social/posts` | ✅ | Create a post (multipart, optional image) |
| `GET` | `/api/social/posts/:id` | — | One post with its comments |
| `PUT` | `/api/social/posts/:id` | ✅ | Edit your own post |
| `DELETE` | `/api/social/posts/:id` | ✅ | Delete your own post |
| `POST` | `/api/social/posts/:id/like` | ✅ | Like / unlike (toggle) |
| `GET` | `/api/social/posts/:id/comments` | — | Comments on a post |
| `POST` | `/api/social/posts/:id/comments` | ✅ | Add a comment |
| `DELETE` | `/api/social/comments/:id` | ✅ | Delete your comment, or one on your post |
| `GET` | `/api/social/users/:username` | — | Profile with counts and posts |
| `PUT` | `/api/social/profile` | ✅ | Edit name / bio / avatar (multipart) |
| `POST` | `/api/social/users/:username/follow` | ✅ | Follow / unfollow (toggle) |
| `GET` | `/api/social/users/:username/followers` | — | Follower list |
| `GET` | `/api/social/users/:username/following` | — | Following list |
| `GET` | `/api/social/suggestions` | ✅ | People you do not follow yet |

Editing or deleting checks ownership and returns **403** if the post is not
yours.

---

## How to demo

Run `npm run seed && npm start`, open <http://localhost:3002>, log in as
**`demo` / `password123`**.

1. **Home feed.** It shows posts from `alice`, `bob` and `carol` because `demo`
   follows them — and `demo`'s own posts are mixed in.
2. **Create a post.** Write something, attach an image, publish. It appears at
   the top without a page reload, and the preview showed before upload.
3. **Like and comment.** Click ♡ — the heart fills and the count moves. Click
   again to unlike. Click 💬, add a comment, then delete it.
4. **Edit.** Use **Edit** on your own post, change the text, save. The timestamp
   line now reads *edited*.
5. **Profiles and the follow graph.** Click `alice` to open her profile: bio,
   avatar, follower/following/post counts, her posts. Click the follower count
   to see the list. Hit **Unfollow**, go back to the feed — her posts are gone.
   Follow her again and they return.
6. **Edit your own profile.** Open your profile, **Edit profile**, change the
   bio and upload an avatar. The avatar appears everywhere you are shown.
7. **Explore works logged out.** Open `/social/explore.html` in a private
   window. The posts are there, there is no composer, and clicking ♡ opens the
   login card instead of failing.
8. **The XSS check.** Post the literal text `<img src=x onerror="alert(1)">`.
   It renders as visible characters — no alert, and no element is created.
   Every piece of user content goes through escaping on render, and the CSP
   blocks inline scripts as a second layer.

---

## Known limitations

- **No notifications.** Likes, comments and follows do not alert the other
  person. Notifications are built in Task 3, where they belong;
  adding them here would mean a Socket.io dependency this task does not
  otherwise need.
- **No real-time feed.** New posts from other people appear on reload, not
  live — for the same reason.
- **Follower counts are computed per request** with `COUNT(*)` subqueries. Clear
  and always correct, but a platform at scale would keep denormalised counters.
- **Feeds are capped at 100 posts** with no pagination or infinite scroll.
- **Images are stored on local disk** under `public/uploads/`, with no resizing
  or thumbnail generation, so a large upload is served at full size. A real
  deployment would use object storage and a CDN.
- **No direct messages, hashtags, reposts or blocking** — out of scope here.
- **SQLite suits one server process.** That is the right call for a project you
  can clone and run in two commands; a multi-instance deployment would want
  Postgres.
