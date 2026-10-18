# Project 4 — Real-Time Communication App

One of four apps in [fullstack-web-apps](https://github.com/console-log-life/fullstack-web-apps).

A meeting room in the browser: multi-user video and audio over WebRTC, screen
sharing, a shared whiteboard, and chat plus file sharing that are **encrypted
end-to-end** so the server stores only ciphertext it cannot read.

Built with Node.js, Express, SQLite and Socket.io, with a plain
HTML/CSS/JavaScript frontend. The encryption uses the browser's built-in Web
Crypto API — no cryptography library.

This folder is **self-contained** — it has its own server, database, dependencies
and authentication, so it runs on its own.

---

## Contents

- [Quick start](#quick-start)
- [Demo login credentials](#demo-login-credentials)
- [Features](#features)
- [Tech stack](#tech-stack)
- [Folder structure](#folder-structure)
- [How WebRTC signalling works](#how-webrtc-signalling-works)
- [End-to-end encryption](#end-to-end-encryption)
- [Database schema](#database-schema)
- [API reference](#api-reference)
- [How to demo](#how-to-demo)
- [Known limitations](#known-limitations)

---

## Quick start

Needs **Node.js 18 or newer**. No database server to install.

```bash
cd task4-realtime-communication

npm install
cp .env.example .env        # Windows: copy .env.example .env
# open .env and set JWT_SECRET to a long random string

npm run seed                # 4 demo users + the DEMO01 meeting room
npm start
```

Open **<http://localhost:3004>**.

> **`JWT_SECRET` must be set.** The server exits at boot without it rather than
> signing session tokens with a guessable fallback. Generate one with:
> ```bash
> node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
> ```

> **Use `localhost`, or deploy over HTTPS.** `getUserMedia`,
> `getDisplayMedia` and the Web Crypto API all require a secure context.
> `http://localhost` counts as one, so local development is fine, but on a
> plain-HTTP host the camera will not start and the encryption will not
> initialise.

| Command | What it does |
| --- | --- |
| `npm start` | Start the server on `PORT` (default 3004) |
| `npm run dev` | Same thing |
| `npm run seed` | Reset the database and reload the demo data |

---

## Demo login credentials

Four accounts, all with the password **`password123`**:

| Username | Password |
| --- | --- |
| `demo` | `password123` |
| `alice` | `password123` |
| `bob` | `password123` |
| `carol` | `password123` |

| Seeded room | |
| --- | --- |
| **Room code** | `DEMO01` |
| **Room passphrase** | `codealpha` |

The room code and the passphrase are **two different things**. The code says
*which* room to join and the server knows it; the passphrase derives the
encryption key and the server never sees it.

To demo the video call you need **two browser windows** logged in as different
users — use a private/incognito window for the second.

> **No chat history or files are seeded, on purpose.** Both are encrypted in the
> browser with a key derived from the room passphrase. The seed script has no
> passphrase, so any row it wrote would be undecryptable noise.

---

## Features

What it does:

| Required | Status | Where |
| --- | --- | --- |
| **Create / join meeting rooms via room code** | ✅ | `/meet/` lobby; login required |
| **Multi-user video + audio calling (WebRTC)** | ✅ | Mesh topology, one connection per peer |
| **Mute / unmute** | ✅ | Toggles the audio track's `enabled` flag |
| **Camera on / off** | ✅ | Same for the video track, with a placeholder tile |
| **Leave** | ✅ | Releases the camera and closes every peer connection |
| **Screen sharing** | ✅ | `getDisplayMedia` + `RTCRtpSender.replaceTrack` |
| **File sharing in the room** | ✅ | Uploaded to the server, listed to everyone, downloadable by all |
| **In-room chat** | ✅ | Over the Socket.io `/meet` namespace |
| **Collaborative whiteboard on `<canvas>`** | ✅ | Pen, 6 colours, brush size, eraser, clear-for-all |
| **Data encryption** | ✅ | Two layers — see [End-to-end encryption](#end-to-end-encryption) |

Beyond the minimum:

- **Room codes are crypto-random** — 6 characters from `crypto.randomInt` over
  an alphabet with no `O`/`0` or `I`/`1` confusion. A guessable code would let
  anyone walk into a meeting.
- **A passphrase gate before anything loads** — the AES key is derived first
- **A participant panel** showing who is in the room and their mute / camera /
  sharing state
- **A late joiner receives the whiteboard already on the board**, replayed from
  a capped in-memory history
- **Undecryptable messages are flagged in the UI** rather than shown as garbage,
  so a wrong passphrase is obvious
- **Filenames are encrypted separately from file contents**, each with its own
  IV, so the server cannot even see what a file is called
- **Graceful degradation** — if the camera is refused, chat, files and the
  whiteboard still work and you are told why
- A mobile layout with no horizontal scrolling

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | HTML, CSS, vanilla JavaScript — no framework, no build step |
| Backend | Node.js + Express 4 |
| Database | SQLite via `better-sqlite3` (single file, synchronous API) |
| Real-time | `socket.io`, one `/meet` namespace |
| Video | WebRTC (mesh) + Google public STUN servers |
| Encryption | Web Crypto API — AES-256-GCM and PBKDF2, built into the browser |
| Uploads | `multer` — encrypted blobs up to 20MB |
| Auth | `bcryptjs` for hashing, `jsonwebtoken` in an httpOnly cookie |
| Security | `helmet` (strict CSP), `cors`, `express-rate-limit`, `dotenv` |

The CSP is `script-src 'self'` with **no `'unsafe-inline'`**, so an inline
`<script>` block would be blocked. Each page declares what it needs instead:

```html
<body data-module="meet" data-require-auth="true" data-render="Meet.renderRoom">
```

`media-src` additionally allows `blob:` and `mediastream:`, which WebRTC video
elements need.

---

## Folder structure

```
task4-realtime-communication/
├── README.md
├── package.json
├── .env.example
├── server/
│   ├── app.js                  Express app, CSP, Socket.io server, static files
│   ├── db/
│   │   ├── index.js            SQLite connection + migration runner
│   │   ├── schema.sql          users + rooms, room_messages, room_files
│   │   ├── seed.js             demo data (npm run seed)
│   │   └── data/app.db         created on first run (gitignored)
│   ├── middleware/
│   │   ├── auth.js             JWT issue/verify, attachUser, authRequired
│   │   ├── errorHandler.js     central error → { error: "message" }
│   │   └── upload.js           multer storage for the encrypted blobs
│   ├── routes/
│   │   ├── auth.js             register / login / logout / me
│   │   └── meet.js             rooms, encrypted messages, encrypted files
│   ├── sockets/
│   │   └── meet.js             /meet namespace: signalling, chat, whiteboard
│   └── utils/
│       ├── validate.js         input validation, ApiError
│       └── asyncHandler.js     async route rejections → error handler
└── public/
    ├── index.html              landing page
    ├── shared/                 styles.css, api.js, ui.js, auth.js, boot.js, home.js
    ├── meet/
    │   ├── index.html          lobby: create or join a room
    │   ├── room.html           the meeting room
    │   ├── crypto.js           Web Crypto AES-GCM / PBKDF2 module
    │   ├── meet.css
    │   └── meet.js             WebRTC mesh, chat, files, whiteboard
    └── uploads/                rooms/ (gitignored)
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

Three message types are relayed, each to **one named socket id** and nowhere
else:

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
possible. Two are configured so one being unreachable is not fatal.

**Security of the relay.** The socket is authenticated from the same httpOnly
JWT cookie the REST API uses, and a signalling message is only forwarded if the
target socket is in the same room as the sender. A client cannot use the
signalling channel to reach into another meeting.

**Screen sharing without renegotiation.** `getDisplayMedia` returns a new video
track. Rather than tearing the call down, each peer's
`RTCRtpSender.replaceTrack` swaps the outgoing camera track for the screen
track in place, so the other participants see your screen without
reconnecting. Stopping the share swaps the camera track back.

**What is NOT here: TURN.** On about 10% of networks — strict corporate or
carrier NAT — no direct path exists and the media needs to be relayed by a TURN
server. Running one needs a host with bandwidth, which is out of scope for this
project, so on such a network a call will show *"connection failed"* rather
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
 file bytes   ──► AES-GCM(key, iv)      ──► uploaded as "encrypted.bin"
 {name,type}  ──► AES-GCM(key, name_iv) ──► stored in original_name
```

Downloading reverses it: the client fetches the ciphertext, decrypts the
metadata to recover the real name and type, decrypts the bytes, and hands the
browser a normal download.

### What the server actually stores

This is a **real row**, captured by running this app, joining `DEMO01` with the
passphrase `codealpha`, and sending the message `hello team`:

```json
{
  "id": 1,
  "ciphertext": "iQPATRaNcyuP0KrXaBpy3OP55Id5+X5onLc=",
  "iv": "mXKVNE+V7o5S3JiD",
  "created_at": "2026-10-17 20:00:33.547",
  "user_id": 1,
  "username": "demo"
}
```

Two things to notice. The plaintext `hello team` appears nowhere. And the
ciphertext decodes to 26 bytes for a 10-byte message — the extra 16 are the
AES-GCM authentication tag, which is what makes tampering detectable rather
than silently corrupting.

You can reproduce this yourself; see
[*Prove the encryption is real*](#prove-the-encryption-is-real) below.

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

## Database schema

```
  users ──┬── rooms (owner_id)
          │     │
          │     ├── room_messages → users
          │     └── room_files    → users
          └─────────────┘
```

| Table | Holds |
| --- | --- |
| `users` | One account per person: username, email, bcrypt hash |
| `rooms` | Join `code`, name, owner |
| `room_messages` | **Ciphertext only**, plus the IV needed to decrypt it |
| `room_files` | Encrypted filename, random stored blob name, size, two IVs |

Decisions worth pointing out:

- **`room_messages.ciphertext` and `room_files.original_name` are base64
  ciphertext**, not readable values. The IVs are stored next to them because an
  IV is not secret — only the key is, and the server never has it.
- **`stored_name` is a random server-generated name**, never the name the
  browser sent, so a crafted filename cannot escape the uploads folder. The
  resolved path is re-checked to be inside that folder before any read or
  delete.
- **Files are always served as `application/octet-stream` with `nosniff`.** The
  real type is only known after decryption, and serving attacker-chosen types
  from our own origin would be a content-sniffing risk.
- **Timestamps keep milliseconds** (`strftime('%Y-%m-%d %H:%M:%f')`); plain
  `datetime('now')` only resolves to whole seconds.
- **The whiteboard is deliberately not in the database.** Its history lives in
  memory, capped at 1500 segments and freed when the last person leaves. It
  exists to catch up a late joiner, not to be a permanent record.

---

## API reference

Everything here requires a session. The REST layer handles rooms, history and
file transfer; the live call, chat and whiteboard run over Socket.io.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Create an account and log in |
| `POST` | `/api/auth/login` | Log in with username or email |
| `POST` | `/api/auth/logout` | Clear the cookie |
| `GET` | `/api/auth/me` | Who am I? |
| `GET` | `/api/meet/rooms` | Rooms I created |
| `POST` | `/api/meet/rooms` | Create a room, returns its code |
| `GET` | `/api/meet/rooms/:code` | Room info by join code |
| `DELETE` | `/api/meet/rooms/:code` | Delete a room I own |
| `GET` | `/api/meet/rooms/:code/messages` | Encrypted chat history |
| `GET` | `/api/meet/rooms/:code/files` | List the shared files |
| `POST` | `/api/meet/rooms/:code/files` | Upload an encrypted file |
| `GET` | `/api/meet/files/:id` | Download the ciphertext |
| `DELETE` | `/api/meet/files/:id` | Delete a file you shared |

Socket.io events on `/meet`:

| Event | Direction | Purpose |
| --- | --- | --- |
| `room:join` / `room:leave` | client → server | Enter or leave a room |
| `peer:joined` / `peer:left` | server → clients | Someone arrived or left |
| `room:participants` | server → clients | The participant list and their states |
| `webrtc:offer` / `:answer` / `:ice` | relayed 1-to-1 | The signalling handshake |
| `media:state` | client → room | Mute / camera / sharing flags |
| `chat:send` / `chat:message` | client ↔ room | Encrypted chat |
| `file:shared` / `file:removed` | client → room | A file was added or removed |
| `board:stroke` / `board:clear` | client → room | Whiteboard updates |

---

## How to demo

Run `npm run seed && npm start` and open **two windows side by side**:

- Window 1: <http://localhost:3004> as **`demo` / `password123`**
- Window 2: a **private/incognito** window, same URL, as **`alice` / `password123`**

1. **The lobby.** Window 1 shows the seeded `DEMO01` room. Point out **Create a
   meeting** and the privacy explanation underneath.
2. **The passphrase gate.** Both windows: join `DEMO01`. The room asks for the
   passphrase **before anything loads** — type `codealpha`. Explain that the
   code says which room, the passphrase derives the key, and only the code
   reaches the server.
3. **The call connects.** Both video tiles appear. Try **Mute** and **Camera
   off** — the other window's **People** panel shows the 🔇 / 🚫 state.
4. **Screen share.** Click **Share** in window 1 and pick a window or screen.
   Window 2 now sees your screen instead of your camera, and the call never
   reconnected — the track was swapped with `replaceTrack`. Stop sharing and the
   camera comes back.
5. **Chat.** Send a message from window 1; it arrives in window 2 decrypted.
6. **Files.** Drop a file onto the **Files** tab in window 1. Window 2 sees it
   appear with the correct filename and can download it, decrypted on arrival.
7. **Whiteboard.** Scroll down and draw — the stroke appears in the other window
   as you move. Change colour, use the eraser, then **Clear board**: it clears
   for both.
8. **Late joiner.** Open a third window as `bob` and join with the same
   passphrase. The existing drawing is already on his board.

### Prove the encryption is real

This is the most convincing 60 seconds of the demo.

1. With a few messages sent, open a new tab at
   **<http://localhost:3004/api/meet/rooms/DEMO01/messages>**

   You are logged in, so the server happily returns the chat history — and it is
   **unreadable base64**. The server stores ciphertext and has no key.

2. Note that **every message has a different `iv`**. That is the per-message
   random IV AES-GCM requires.

3. Now join `DEMO01` in a private window with a **deliberately wrong
   passphrase**. The room opens, the history loads — and every message reads
   *"[cannot decrypt — this message used a different passphrase]"*. AES-GCM
   verifies its authentication tag, so a wrong key fails cleanly instead of
   producing garbage.

4. Same for files: open
   **<http://localhost:3004/api/meet/rooms/DEMO01/files>** and show that
   `original_name` is base64 ciphertext — the server does not even know what the
   file is called.

---

## Known limitations

- **The WebRTC mesh scales to a handful of people.** Each browser uploads its
  video once per peer, so 4–6 participants is comfortable and more is not.
  Beyond that you need an SFU — a media server that forwards streams.
- **No TURN server.** On strict NAT where no direct path exists, a call reports
  *"connection failed"*. Chat, files and the whiteboard still work.
- **A secure context is required.** `getUserMedia`, `getDisplayMedia` and Web
  Crypto all need HTTPS or `localhost`. On a plain-HTTP deployment the camera
  will not start and the room cannot derive its key.
- **Encryption covers contents, not metadata.** See
  [the trust model](#what-this-does-and-does-not-protect).
- **No passphrase rotation.** Change a room's passphrase and the earlier history
  becomes undecryptable — it is shown flagged rather than hidden. There is no
  re-key mechanism.
- **The whiteboard history is in memory**, capped at 1500 segments and freed
  when the last person leaves, so it is not a permanent record and does not
  survive a server restart.
- **Screen share audio is not captured** — `getDisplayMedia` is requested with
  `audio: false`, so you share the picture, not system sound.
- **Socket.io state is in memory.** With more than one server process,
  participants on different instances would not find each other; that needs the
  Redis adapter.
- **No recording, no raise-hand, no breakout rooms, no waiting room** — outside
  the Task 4 brief.
- **SQLite suits one server process.** That is the right call for a project you
  can clone and run in two commands; a multi-instance deployment would want
  Postgres.
