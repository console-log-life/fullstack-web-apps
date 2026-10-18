/**
 * Project 2 - Social Media Platform
 *
 * A standalone Express app. It carries its own copy of the shared foundation
 * (authentication, validation, error handling) so this folder runs on its own
 * with nothing else checked out:
 *
 *   /api/auth   register / login / logout / me
 *   /api/social     this task's endpoints
 *
 */
require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');

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
        connectSrc: ["'self'"],
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
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3002')
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
app.use('/api/social', require('./routes/social'));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, task: 2, db: path.basename(DB_PATH), schema: migration.version });
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

const PORT = Number(process.env.PORT) || 3002;
app.listen(PORT, () => {
  console.log(`\n  Project 2: Social Media Platform (Social)`);
  console.log(`  Server   : http://localhost:${PORT}`);
  console.log(`  Database : ${DB_PATH}`);
  console.log(`  App      : http://localhost:${PORT}/social/\n`);
});

module.exports = { app };
