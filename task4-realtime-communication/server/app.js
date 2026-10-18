/**
 * Project 4 - Real-Time Communication App
 *
 * A standalone Express app. It carries its own copy of the shared foundation
 * (authentication, validation, error handling) so this folder runs on its own
 * with nothing else checked out:
 *
 *   /api/auth   register / login / logout / me
 *   /api/meet       this task's endpoints
 *
 * Socket.io runs on the same HTTP server under the /meet namespace, which is
 * the WebRTC signalling channel and also carries the chat and the whiteboard.
 */
require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');

const { migrate, DB_PATH } = require('./db');
const { attachUser } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/errorHandler');

// Fail at boot rather than at the first login attempt: a missing secret is a
// setup mistake, and signing tokens with a guessable fallback would be worse
// than refusing to start.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  console.error(
    '\n  JWT_SECRET is missing or too short.\n' +
    '  Copy .env.example to .env and set it to a long random string, e.g.\n' +
    '    node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n'
  );
  process.exit(1);
}

// Create/upgrade tables before anything can query them.
const migration = migrate();

const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1); // correct client IPs for rate limiting behind a proxy

// --- Security headers -------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // No 'unsafe-inline': every page is started by /shared/boot.js reading
        // data-* attributes, so there are no inline <script> blocks to allow.
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // inline styles set by the UI code
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        mediaSrc: ["'self'", 'blob:', 'mediastream:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
      },
    },
    // Lets the pages keep working when opened over plain http on localhost.
    crossOriginEmbedderPolicy: false,
  })
);

// --- CORS -------------------------------------------------------------
// The frontend is served by this same server, so CORS is only needed if you
// open the pages from another origin. credentials:true keeps the auth cookie.
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3004')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error('Origin not allowed by CORS'));
    },
    credentials: true,
  })
);

// --- Body + cookie parsing -------------------------------------------
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Decode the JWT cookie once per request so req.user is available everywhere.
app.use(attachUser);

// --- API routes -------------------------------------------------------
app.use('/api/auth', require('./routes/auth'));
app.use('/api/meet', require('./routes/meet'));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, task: 4, db: path.basename(DB_PATH), schema: migration.version });
});

// --- Static frontend --------------------------------------------------
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// Only /api/* gets a JSON 404; anything else falls through to the landing page
// so a mistyped page URL does not show a raw error.
app.use('/api', notFound);
app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use(errorHandler);

// --- Socket.io --------------------------------------------------------
const io = new Server(server, {
  cors: { origin: allowedOrigins, credentials: true },
});

require('./sockets/meet')(io);

const PORT = Number(process.env.PORT) || 3004;
server.listen(PORT, () => {
  console.log(`\n  Project 4: Real-Time Communication App (Meet)`);
  console.log(`  Server   : http://localhost:${PORT}`);
  console.log(`  Database : ${DB_PATH}`);
  console.log(`  App      : http://localhost:${PORT}/meet/\n`);
});

module.exports = { app, server, io };
