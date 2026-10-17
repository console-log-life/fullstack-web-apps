/**
 * TASK 4 - Socket.io namespace for the meeting rooms: /meet
 *
 * This server does four jobs, and only four:
 *
 * 1. WEBRTC SIGNALLING (the handshake, never the media)
 *    Audio and video travel peer-to-peer. But two browsers cannot find each
 *    other unaided, so they swap three kinds of message through here:
 *      - offer   : "here is my session description, can you match it?"
 *      - answer  : "yes, here is mine"
 *      - ice      : "here is a network route you could reach me on"
 *    Each is relayed verbatim to one named socket id and nothing else. Once
 *    the handshake finishes the media flows directly between the browsers and
 *    this server sees none of it (and could not read it anyway: WebRTC
 *    mandates DTLS-SRTP encryption).
 *
 *    Topology is a MESH: on joining, the newcomer is told who is already in
 *    the room, and it sends an offer to each of them. With N people each
 *    browser holds N-1 connections. That needs no media server, which is why
 *    it suits this project, but it does limit a room to a handful of people.
 *
 * 2. CHAT RELAY - messages arrive as AES-GCM ciphertext. They are stored and
 *    rebroadcast as-is; the passphrase never reaches the server.
 *
 * 3. WHITEBOARD - stroke segments are broadcast to the rest of the room, and
 *    a short history is kept in memory so somebody joining late sees the
 *    drawing already on the board.
 *
 * 4. PRESENCE - who is in the room, and their mute / camera / sharing state.
 */
const { db } = require('../db');
const { userFromToken, COOKIE_NAME } = require('../middleware/auth');
const meetRoutes = require('../routes/meet');

/** Pulls one cookie value out of a raw Cookie header. */
function cookieValue(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

// Whiteboard history per room code, so a late joiner can catch up. Capped so a
// long session cannot grow without bound.
const MAX_STROKES = 1500;
const whiteboards = new Map(); // code -> array of stroke segments

module.exports = function registerMeetSockets(io) {
  const nsp = io.of('/meet');

  // Same cookie-based auth as the rest of the app.
  nsp.use((socket, next) => {
    const token = cookieValue(socket.handshake.headers.cookie, COOKIE_NAME);
    const user = userFromToken(token);
    if (!user) return next(new Error('Please log in to join a meeting.'));
    socket.user = user;
    next();
  });

  /** Everyone currently in a room, as plain objects for the client. */
  function participants(code) {
    const room = nsp.adapter.rooms.get(`room:${code}`);
    if (!room) return [];
    const list = [];
    for (const socketId of room) {
      const peer = nsp.sockets.get(socketId);
      if (peer?.user) {
        list.push({
          socket_id: socketId,
          user_id: peer.user.id,
          username: peer.user.username,
          muted: !!peer.state?.muted,
          camera_off: !!peer.state?.cameraOff,
          sharing: !!peer.state?.sharing,
        });
      }
    }
    return list;
  }

  nsp.on('connection', (socket) => {
    socket.roomCode = null;
    socket.state = { muted: false, cameraOff: false, sharing: false };

    /* ----------------------------------------------------------------
       Joining a room
       ---------------------------------------------------------------- */
    socket.on('room:join', (payload, ack) => {
      let code;
      try {
        code = meetRoutes.normaliseCode(payload?.code);
        meetRoutes.findRoom(code); // 404s for an unknown code
      } catch (err) {
        return ack?.({ ok: false, error: err.message });
      }

      // One room per socket: leaving first keeps presence lists honest.
      if (socket.roomCode) leaveRoom(socket.roomCode);

      // The list of people already here is captured BEFORE joining, so the
      // newcomer does not try to call itself.
      const existing = participants(code);

      socket.join(`room:${code}`);
      socket.roomCode = code;

      // Tell the others to expect an offer from this socket.
      socket.to(`room:${code}`).emit('peer:joined', {
        socket_id: socket.id,
        user_id: socket.user.id,
        username: socket.user.username,
      });

      ack?.({
        ok: true,
        code,
        self: { socket_id: socket.id, user_id: socket.user.id, username: socket.user.username },
        peers: existing,                                 // the newcomer calls each of these
        strokes: whiteboards.get(code) || [],            // catch up on the drawing
      });

      nsp.to(`room:${code}`).emit('room:participants', { participants: participants(code) });
    });

    function leaveRoom(code) {
      if (!code) return;
      socket.leave(`room:${code}`);
      socket.to(`room:${code}`).emit('peer:left', {
        socket_id: socket.id,
        username: socket.user.username,
      });
      nsp.to(`room:${code}`).emit('room:participants', { participants: participants(code) });
    }

    socket.on('room:leave', () => {
      const code = socket.roomCode;
      socket.roomCode = null;
      leaveRoom(code);
    });

    /* ----------------------------------------------------------------
       WebRTC signalling - relayed to one peer, never broadcast
       ---------------------------------------------------------------- */

    /** Only relay to a socket that is in the same room as the sender. */
    function sameRoom(targetId) {
      const target = nsp.sockets.get(targetId);
      return target && socket.roomCode && target.roomCode === socket.roomCode ? target : null;
    }

    socket.on('webrtc:offer', ({ to, description }) => {
      if (!sameRoom(to)) return;
      nsp.to(to).emit('webrtc:offer', {
        from: socket.id,
        username: socket.user.username,
        description,
      });
    });

    socket.on('webrtc:answer', ({ to, description }) => {
      if (!sameRoom(to)) return;
      nsp.to(to).emit('webrtc:answer', { from: socket.id, description });
    });

    socket.on('webrtc:ice', ({ to, candidate }) => {
      if (!sameRoom(to)) return;
      nsp.to(to).emit('webrtc:ice', { from: socket.id, candidate });
    });

    /* ----------------------------------------------------------------
       Media state (mute / camera / screen share)
       ---------------------------------------------------------------- */
    socket.on('media:state', ({ muted, cameraOff, sharing }) => {
      socket.state = {
        muted: !!muted,
        cameraOff: !!cameraOff,
        sharing: !!sharing,
      };
      if (!socket.roomCode) return;
      nsp.to(`room:${socket.roomCode}`).emit('room:participants', {
        participants: participants(socket.roomCode),
      });
    });

    /* ----------------------------------------------------------------
       Encrypted chat
       ---------------------------------------------------------------- */
    socket.on('chat:send', ({ ciphertext, iv }, ack) => {
      if (!socket.roomCode) return ack?.({ ok: false, error: 'Join a room first.' });
      if (typeof ciphertext !== 'string' || typeof iv !== 'string'
          || !ciphertext || ciphertext.length > 20000 || iv.length > 64) {
        return ack?.({ ok: false, error: 'That message could not be sent.' });
      }

      let room;
      try {
        room = meetRoutes.findRoom(socket.roomCode);
      } catch {
        return ack?.({ ok: false, error: 'This room no longer exists.' });
      }

      // Stored exactly as received: the server has no key and cannot read it.
      const info = db
        .prepare('INSERT INTO room_messages (room_id, user_id, ciphertext, iv) VALUES (?, ?, ?, ?)')
        .run(room.id, socket.user.id, ciphertext, iv);

      const message = {
        id: Number(info.lastInsertRowid),
        user_id: socket.user.id,
        username: socket.user.username,
        ciphertext,
        iv,
        created_at: new Date().toISOString(),
      };

      // Echoed to the sender too, so every client renders from one path.
      nsp.to(`room:${socket.roomCode}`).emit('chat:message', message);
      ack?.({ ok: true, id: message.id });
    });

    /* ----------------------------------------------------------------
       Shared files - the upload itself is a REST call; this just tells the
       room that a new encrypted file is available.
       ---------------------------------------------------------------- */
    socket.on('file:shared', ({ file }) => {
      if (!socket.roomCode || !file) return;
      socket.to(`room:${socket.roomCode}`).emit('file:shared', {
        file,
        username: socket.user.username,
      });
    });

    socket.on('file:removed', ({ file_id }) => {
      if (!socket.roomCode) return;
      socket.to(`room:${socket.roomCode}`).emit('file:removed', { file_id });
    });

    /* ----------------------------------------------------------------
       Collaborative whiteboard
       ---------------------------------------------------------------- */
    socket.on('board:stroke', (stroke) => {
      if (!socket.roomCode || !stroke) return;

      // Only the fields needed to redraw are kept, and they are bounded, so a
      // client cannot push arbitrary data into another participant's canvas.
      const safe = {
        x0: Number(stroke.x0), y0: Number(stroke.y0),
        x1: Number(stroke.x1), y1: Number(stroke.y1),
        color: typeof stroke.color === 'string' ? stroke.color.slice(0, 24) : '#15202b',
        width: Math.min(60, Math.max(1, Number(stroke.width) || 3)),
        erase: !!stroke.erase,
      };
      if (![safe.x0, safe.y0, safe.x1, safe.y1].every(Number.isFinite)) return;

      const history = whiteboards.get(socket.roomCode) || [];
      history.push(safe);
      // Drop the oldest segments once the cap is hit.
      if (history.length > MAX_STROKES) history.splice(0, history.length - MAX_STROKES);
      whiteboards.set(socket.roomCode, history);

      socket.to(`room:${socket.roomCode}`).emit('board:stroke', safe);
    });

    socket.on('board:clear', () => {
      if (!socket.roomCode) return;
      whiteboards.set(socket.roomCode, []);
      nsp.to(`room:${socket.roomCode}`).emit('board:clear', {
        username: socket.user.username,
      });
    });

    /* ----------------------------------------------------------------
       Disconnect
       ---------------------------------------------------------------- */
    socket.on('disconnect', () => {
      const code = socket.roomCode;
      if (!code) return;
      socket.roomCode = null;
      socket.to(`room:${code}`).emit('peer:left', {
        socket_id: socket.id,
        username: socket.user.username,
      });
      nsp.to(`room:${code}`).emit('room:participants', { participants: participants(code) });

      // Free the whiteboard history once the last person leaves.
      const remaining = nsp.adapter.rooms.get(`room:${code}`);
      if (!remaining || remaining.size === 0) whiteboards.delete(code);
    });
  });

  return nsp;
};
