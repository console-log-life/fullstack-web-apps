/**
 * CodeAlpha Full Stack Projects - single Express server for all four tasks.
 *
 *   /api/auth      shared authentication (Phase 1)
 *   /api/shop      Task 1: e-commerce store
 *   /api/social    Task 2: social media platform
 *   /api/projects  Task 3: project management tool
 *   /api/meet      Task 4: real-time communication app
 *
 * Socket.io runs on the same HTTP server, split into one namespace per
 * real-time module (/projects for the Kanban board, /meet for WebRTC
 * signalling, chat and the whiteboard).
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

// Create/upgrade tables before anything can query them.
const migration = migrate();

const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1); // correct client IPs for rate limiting behind a proxy

// --- Security headers -------------------------------------------------
// The CSP is explicit because the pages load Socket.io's client script and use
// blob:/data: URLs for WebRTC video, canvas snapshots and decrypted downloads.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // inline styles set by the UI code
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:', 'mediastream:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],   // Socket.io websocket upgrade
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
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
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
app.use(express.json({ limit: '2mb' })); // 2mb covers base64 whiteboard snapshots
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Decode the JWT cookie once per request so req.user is available everywhere.
app.use(attachUser);

// --- API routes -------------------------------------------------------
app.use('/api/auth', require('./routes/auth'));
app.use('/api/shop', require('./routes/shop'));
// Added in Phase 3-5 as each task is built.
// app.use('/api/social', require('./routes/social'));
// app.use('/api/projects', require('./routes/projects'));
// app.use('/api/meet', require('./routes/meet'));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, db: path.basename(DB_PATH), schema: migration.version });
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

// Namespaces are registered in Phase 4 and Phase 5.
// require('./sockets/projects')(io);
// require('./sockets/meet')(io);

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  console.log(`\n  CodeAlpha Full Stack Projects`);
  console.log(`  Server   : http://localhost:${PORT}`);
  console.log(`  Database : ${DB_PATH}`);
  console.log(`  Modules  : /shop  /social  /projects  /meet\n`);
});

module.exports = { app, server, io };
