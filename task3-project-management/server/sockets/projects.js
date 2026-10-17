/**
 * TASK 3 bonus - real-time board updates and notifications.
 *
 * Namespace: /projects
 *
 * Two kinds of room are used:
 *   user:<id>     every socket of one person, for bell notifications. A
 *                 notification must reach you wherever you are in the app, not
 *                 only when the board is open.
 *   project:<id>  everyone currently looking at one board, for card events.
 *
 * The REST routes stay the source of truth: a write happens over HTTP, then
 * this module broadcasts what changed. That keeps one validation and
 * authorization path instead of duplicating the rules in socket handlers.
 */
const { userFromToken, COOKIE_NAME } = require('../middleware/auth');
const projectRoutes = require('../routes/projects');

/** Pulls one cookie value out of a raw Cookie header. */
function cookieValue(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

module.exports = function registerProjectSockets(io) {
  const nsp = io.of('/projects');

  // Authenticate the socket from the same httpOnly JWT cookie the REST API
  // uses, so there is no second token mechanism to keep in sync.
  nsp.use((socket, next) => {
    const token = cookieValue(socket.handshake.headers.cookie, COOKIE_NAME);
    const user = userFromToken(token);
    if (!user) return next(new Error('Please log in to receive live updates.'));
    socket.user = user;
    next();
  });

  nsp.on('connection', (socket) => {
    // Personal room: joined immediately so the bell works on every page.
    socket.join(`user:${socket.user.id}`);

    /**
     * Opening a board. Membership is re-checked here: a client cannot listen
     * to a project it does not belong to just by emitting its id.
     */
    socket.on('board:join', (payload, ack) => {
      const projectId = Number(payload?.project_id);
      if (!Number.isInteger(projectId)) {
        return ack?.({ ok: false, error: 'A project id is required.' });
      }

      try {
        projectRoutes.requireMembership(projectId, socket.user.id);
      } catch (err) {
        return ack?.({ ok: false, error: err.message });
      }

      // Leave any previously watched board so events do not pile up.
      for (const room of socket.rooms) {
        if (room.startsWith('project:')) socket.leave(room);
      }
      socket.join(`project:${projectId}`);

      // Tell the others who just arrived, for the "live" presence hint.
      socket.to(`project:${projectId}`).emit('presence:joined', {
        username: socket.user.username,
      });

      ack?.({ ok: true, project_id: projectId });
    });

    socket.on('board:leave', (payload) => {
      const projectId = Number(payload?.project_id);
      if (Number.isInteger(projectId)) {
        socket.leave(`project:${projectId}`);
        socket.to(`project:${projectId}`).emit('presence:left', {
          username: socket.user.username,
        });
      }
    });

    socket.on('disconnect', () => {
      for (const room of socket.rooms) {
        if (room.startsWith('project:')) {
          socket.to(room).emit('presence:left', { username: socket.user.username });
        }
      }
    });
  });

  /* ------------------------------------------------------------------
     Wire the REST routes' no-op hooks to this namespace.
     ------------------------------------------------------------------ */

  projectRoutes.realtime.emitBoard = (projectId, event, payload) => {
    nsp.to(`project:${projectId}`).emit(event, payload);
  };

  projectRoutes.realtime.emitNotify = (userId, notification) => {
    nsp.to(`user:${userId}`).emit('notification', notification);
  };

  return nsp;
};
