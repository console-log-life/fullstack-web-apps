/* =====================================================================
   TASK 4 - Real-time communication app frontend.

   Screens: a lobby (create or join by code) and the room itself.

   The room does five things at once:
     1. WebRTC mesh video/audio - one RTCPeerConnection per other person
     2. screen sharing by replacing the outgoing video track
     3. end-to-end encrypted chat (see crypto.js)
     4. end-to-end encrypted file sharing
     5. a shared whiteboard synced over Socket.io
   ===================================================================== */

const Meet = (() => {
  /**
   * STUN servers tell a browser what its public address looks like from the
   * outside, which is what lets two peers behind routers connect directly.
   * Google's public servers are used here; two are listed so one being
   * unreachable is not fatal.
   *
   * A production app would add a TURN server for the ~10% of networks where
   * a direct path cannot be found (strict corporate NAT). TURN relays media
   * and so needs a host to run it, which is out of scope here - this is
   * called out in the README rather than silently missing.
   */
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  // The whiteboard's internal pixel size. Strokes are sent as 0..1 fractions
  // and scaled to this, so every participant sees the same drawing whatever
  // their window size.
  const BOARD_W = 1280;
  const BOARD_H = 720;

  const SWATCHES = ['#15202b', '#e03131', '#1971c2', '#2f9e44', '#f08c00', '#9c36b5'];

  /* ====================================================================
     LOBBY
     ==================================================================== */

  async function renderLobby(root) {
    const myRooms = el('div');

    /* --- create --- */
    const nameInput = el('input', { type: 'text', maxlength: '80', required: 'required',
      placeholder: 'e.g. Team standup' });
    const createFeedback = el('div');
    const createBtn = el('button', { class: 'btn btn-block', type: 'submit' }, 'Create room');

    const createForm = el('form', { novalidate: 'novalidate' },
      el('div', { class: 'field' }, el('label', { text: 'Room name' }), nameInput),
      createFeedback,
      createBtn);

    createForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      createFeedback.innerHTML = '';
      const name = nameInput.value.trim();
      if (!name) return showError(createFeedback, new Error('Give the room a name.'));

      await withBusy(createBtn, async () => {
        try {
          const { room, message } = await API.post('/api/meet/rooms', { name });
          toastOk(message);
          location.href = `/meet/room.html?code=${room.code}`;
        } catch (err) {
          showError(createFeedback, err);
        }
      });
    });

    /* --- join --- */
    const codeInput = el('input', { type: 'text', maxlength: '12', required: 'required',
      placeholder: 'ABC123', class: 'join-code', autocomplete: 'off',
      style: 'text-transform:uppercase' });
    const joinFeedback = el('div');
    const joinBtn = el('button', { class: 'btn btn-block', type: 'submit' }, 'Join room');

    const joinForm = el('form', { novalidate: 'novalidate' },
      el('div', { class: 'field' },
        el('label', { text: 'Room code' }), codeInput,
        el('p', { class: 'small muted', style: 'margin:6px 0 0',
          text: 'Ask whoever created the room for the code and the passphrase.' })),
      joinFeedback,
      joinBtn);

    joinForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      joinFeedback.innerHTML = '';
      const code = codeInput.value.trim().toUpperCase();
      if (!code) return showError(joinFeedback, new Error('Enter a room code.'));

      await withBusy(joinBtn, async () => {
        try {
          // Check the room exists before navigating, for a clearer error.
          await API.get(`/api/meet/rooms/${encodeURIComponent(code)}`);
          location.href = `/meet/room.html?code=${code}`;
        } catch (err) {
          showError(joinFeedback, err);
        }
      });
    });

    root.innerHTML = '';
    root.append(
      el('div', { class: 'page-head' },
        el('div', {},
          el('h1', { text: 'Meetings' }),
          el('p', { class: 'muted', style: 'margin:0',
            text: 'Task 4 · video calls, screen share, encrypted chat and files, shared whiteboard.' }))),
      el('div', { class: 'lobby-grid' },
        el('div', { class: 'card' }, el('h2', { text: 'Start a meeting' }), createForm),
        el('div', { class: 'card' }, el('h2', { text: 'Join a meeting' }), joinForm)),
      el('div', { class: 'card' },
        el('h2', { text: 'Rooms you created' }),
        myRooms),
      el('div', { class: 'card', style: 'margin-top:18px' },
        el('h2', { text: 'How the privacy works' }),
        el('ul', { class: 'muted', style: 'font-size:0.9rem;padding-left:20px;margin:0' },
          el('li', { text: 'Audio and video go peer-to-peer and are encrypted by WebRTC itself (DTLS-SRTP). The server only helps the browsers find each other.' }),
          el('li', { text: 'Chat messages and shared files are encrypted in your browser with AES-GCM before they are sent. The key comes from the room passphrase, which never leaves your device.' }),
          el('li', { text: 'That means the server stores ciphertext it cannot read. Anyone without the passphrase sees nothing but random bytes.' })))
    );

    setLoading(myRooms);
    try {
      const { rooms } = await API.get('/api/meet/rooms');
      myRooms.innerHTML = '';

      if (!rooms.length) {
        myRooms.append(el('p', { class: 'muted small',
          text: 'You have not created a room yet. The demo seed includes room DEMO01 (passphrase: codealpha).' }));
        return;
      }

      for (const room of rooms) {
        const copyBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Copy code');
        copyBtn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(room.code);
            toastOk(`Code ${room.code} copied.`);
          } catch {
            // Clipboard access can be refused; show the code so it can be read.
            toast(`Room code: ${room.code}`, 'info', 6000);
          }
        });

        const delBtn = el('button', { class: 'icon-btn', type: 'button', style: 'color:var(--danger)' }, 'Delete');
        delBtn.addEventListener('click', async () => {
          const yes = await confirmDialog('Delete room',
            `Delete "${room.name}"? Its chat history and shared files go with it.`,
            { confirmLabel: 'Delete room' });
          if (!yes) return;
          try {
            const { message } = await API.del(`/api/meet/rooms/${room.code}`);
            toastOk(message);
            renderLobby(root);
          } catch (err) {
            toastError(err.message);
          }
        });

        myRooms.append(
          el('div', { class: 'room-row' },
            el('div', { class: 'grow' },
              el('strong', { text: room.name }),
              el('div', { class: 'small muted',
                text: `${room.message_count} message(s) · ${room.file_count} file(s) · created ${formatDate(room.created_at)}` })),
            el('span', { class: 'join-code', text: room.code }),
            el('a', { class: 'btn btn-sm', href: `/meet/room.html?code=${room.code}` }, 'Open'),
            copyBtn,
            delBtn)
        );
      }
    } catch (err) {
      showError(myRooms, err);
    }
  }

  /* ====================================================================
     ROOM
     ==================================================================== */

  async function renderRoom(root) {
    const code = (new URLSearchParams(location.search).get('code') || '').toUpperCase();

    root.innerHTML = '';
    const host = el('div');
    root.append(host);

    if (!code) {
      showError(host, new Error('No room code was given.'));
      host.append(el('p', { style: 'margin-top:12px' },
        el('a', { href: '/meet/' }, '← Back to the lobby')));
      return;
    }

    /* --- confirm the room exists --- */
    let room;
    try {
      const data = await API.get(`/api/meet/rooms/${encodeURIComponent(code)}`);
      room = data.room;
    } catch (err) {
      showError(host, err);
      host.append(el('p', { style: 'margin-top:12px' },
        el('a', { href: '/meet/' }, '← Back to the lobby')));
      return;
    }

    document.title = `${room.name} (${room.code}) - Meet`;

    /* ----------------------------------------------------------------
       Passphrase gate: the AES key is derived before anything is sent.
       ---------------------------------------------------------------- */
    if (!RoomCrypto.isAvailable()) {
      return showError(host, new Error(
        'This browser cannot encrypt: the Web Crypto API needs https or localhost.'
      ));
    }

    const passInput = el('input', { type: 'password', required: 'required',
      placeholder: 'Shared room passphrase', autocomplete: 'off' });
    const gateFeedback = el('div');
    const gateBtn = el('button', { class: 'btn btn-block', type: 'submit' }, 'Unlock and join');

    const gateForm = el('form', { novalidate: 'novalidate' },
      el('div', { class: 'field' },
        el('label', { text: 'Room passphrase' }), passInput,
        el('p', { class: 'small muted', style: 'margin:6px 0 0',
          text: 'Everyone in the room must type the same passphrase. It never leaves your browser: it is used locally to derive the AES-256 key that encrypts chat and files.' })),
      gateFeedback,
      gateBtn);

    host.append(
      el('div', { class: 'gate-wrap' },
        el('div', { class: 'card gate-card' },
          el('p', { style: 'margin:0' }, el('a', { href: '/meet/' }, '← Lobby')),
          el('h1', { text: room.name, style: 'margin:10px 0 0' }),
          el('span', { class: 'join-code muted', text: room.code }),
          gateForm,
          el('p', { class: 'small muted', style: 'margin-top:14px' },
            `Created by ${room.owner_username}. For the seeded demo room the passphrase is "codealpha".`)))
    );

    gateForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      gateFeedback.innerHTML = '';
      try {
        await RoomCrypto.unlock(room.code, passInput.value);
        startRoom(host, room);
      } catch (err) {
        showError(gateFeedback, err);
      }
    });

    passInput.focus();
  }

  /* ----------------------------------------------------------------
     The room proper, once the key is derived.
     ---------------------------------------------------------------- */
  async function startRoom(host, room) {
    const me = Shell.user();

    // Everything about the live call lives here.
    const state = {
      socket: null,
      selfId: null,
      localStream: null,
      screenStream: null,
      peers: new Map(),       // socket_id -> { pc, stream, username, tile }
      participants: [],
      muted: false,
      cameraOff: false,
      sharing: false,
      files: [],
      activePanel: 'chat',
    };

    /* ---------------------------- layout ---------------------------- */

    const videoGrid = el('div', { class: 'video-grid' });
    const controls = el('div', { class: 'controls' });
    const panelBody = el('div', { class: 'panel-body' });
    const statusChip = el('span', { class: 'badge', text: 'connecting…' });

    const copyBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Copy');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(room.code);
        toastOk('Room code copied.');
      } catch {
        toast(`Room code: ${room.code}`, 'info', 6000);
      }
    });

    /* panel tabs */
    const tabButtons = {};
    const panelTabs = el('div', { class: 'panel-tabs' });
    for (const [key, label] of [['chat', 'Chat'], ['files', 'Files'], ['people', 'People']]) {
      const btn = el('button', { type: 'button', class: key === 'chat' ? 'active' : '' }, label);
      btn.addEventListener('click', () => switchPanel(key));
      tabButtons[key] = btn;
      panelTabs.append(btn);
    }

    /* whiteboard */
    const canvas = el('canvas', { id: 'whiteboard', width: String(BOARD_W), height: String(BOARD_H) });
    const boardTools = el('div', { class: 'board-tools' });

    host.innerHTML = '';
    host.append(
      el('p', { style: 'margin:0 0 10px' }, el('a', { href: '/meet/' }, '← Lobby')),
      el('div', { class: 'room-head' },
        el('div', {},
          el('h1', { text: room.name, style: 'margin:0 0 6px' }),
          el('div', { class: 'row row-wrap' },
            el('span', { class: 'room-code-chip' }, 'Code:', el('strong', { text: room.code }), copyBtn),
            statusChip,
            el('span', { class: 'badge badge-success', text: '\u{1F512} end-to-end encrypted' })))),
      el('div', { class: 'room-layout' },
        el('div', {}, videoGrid, controls),
        el('div', { class: 'card' }, panelTabs, panelBody)),
      el('div', { class: 'card board-wrap' },
        el('h2', { text: 'Shared whiteboard' }),
        el('p', { class: 'muted small', style: 'margin:0 0 10px',
          text: 'Everyone draws on the same canvas, synced live over Socket.io.' }),
        boardTools,
        canvas)
    );

    /* ================================================================
       LOCAL MEDIA
       ================================================================ */

    /** Builds one video tile. */
    function videoTile({ id, username, isSelf }) {
      const video = el('video', {
        autoplay: 'autoplay', playsinline: 'playsinline',
        muted: isSelf ? 'muted' : null,   // never play your own audio back
      });
      const placeholder = el('div', {
        class: 'video-placeholder hidden',
        text: (username || '?').charAt(0).toUpperCase(),
      });
      const note = el('div', { class: 'connecting-note hidden', text: 'connecting…' });

      const tile = el('div', {
        class: `video-tile ${isSelf ? 'self' : ''}`.trim(),
        dataset: { peerId: id },
      },
        video, placeholder, note,
        el('div', { class: 'video-label' },
          el('span', { class: 'tag', text: isSelf ? `${username} (you)` : username },
          )));

      return { tile, video, placeholder, note };
    }

    const selfTile = videoTile({ id: 'self', username: me.username, isSelf: true });

    function paintVideoGrid() {
      videoGrid.innerHTML = '';
      videoGrid.append(selfTile.tile);
      for (const peer of state.peers.values()) {
        videoGrid.append(peer.ui.tile);
      }
    }

    /**
     * Asks for camera and microphone. A refusal is not fatal: the rest of the
     * room (chat, files, whiteboard) still works, so the error is reported and
     * the call continues without an outgoing stream.
     */
    async function startLocalMedia() {
      try {
        state.localStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        selfTile.video.srcObject = state.localStream;
        return true;
      } catch (err) {
        const reason = err.name === 'NotAllowedError'
          ? 'Camera and microphone access was blocked.'
          : err.name === 'NotFoundError'
            ? 'No camera or microphone was found.'
            : `Could not start your camera: ${err.message}`;
        toastError(`${reason} You can still use chat, files and the whiteboard.`);
        selfTile.placeholder.classList.remove('hidden');
        state.cameraOff = true;
        state.muted = true;
        return false;
      }
    }

    /* ================================================================
       WEBRTC MESH

       One RTCPeerConnection per other participant. The person who was
       already in the room waits; the newcomer sends the offer. That rule
       avoids "glare", where both sides offer at once and neither can
       answer.
       ================================================================ */

    function createPeer(peerId, username, isInitiator) {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const ui = videoTile({ id: peerId, username, isSelf: false });
      ui.note.classList.remove('hidden');

      const peer = { pc, username, ui, stream: new MediaStream() };
      state.peers.set(peerId, peer);
      paintVideoGrid();

      // Send our tracks. If the camera was refused there are none, which is
      // fine: this peer becomes receive-only.
      if (state.localStream) {
        for (const track of state.localStream.getTracks()) {
          pc.addTrack(track, state.localStream);
        }
      }

      // Each candidate is a possible network route; forward them as they come.
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          state.socket.emit('webrtc:ice', { to: peerId, candidate: event.candidate });
        }
      };

      pc.ontrack = (event) => {
        peer.stream.addTrack(event.track);
        ui.video.srcObject = peer.stream;
        ui.note.classList.add('hidden');
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          ui.note.classList.add('hidden');
        } else if (pc.connectionState === 'failed') {
          // Usually a NAT with no direct path available; a TURN server is the
          // real fix (see the ICE_SERVERS comment).
          ui.note.textContent = 'connection failed';
          ui.note.classList.remove('hidden');
        } else if (pc.connectionState === 'disconnected') {
          ui.note.textContent = 'reconnecting…';
          ui.note.classList.remove('hidden');
        }
      };

      // Fires for the first offer and again whenever tracks change, which is
      // what re-negotiates the call when a screen share starts or stops.
      pc.onnegotiationneeded = async () => {
        if (!isInitiator) return; // only one side drives negotiation
        try {
          await pc.setLocalDescription(await pc.createOffer());
          state.socket.emit('webrtc:offer', { to: peerId, description: pc.localDescription });
        } catch (err) {
          console.error('negotiation failed', err);
        }
      };

      return peer;
    }

    function removePeer(peerId) {
      const peer = state.peers.get(peerId);
      if (!peer) return;
      peer.pc.close();
      peer.ui.tile.remove();
      state.peers.delete(peerId);
      paintVideoGrid();
    }

    /* ================================================================
       CONTROLS: mute, camera, screen share, leave
       ================================================================ */

    const ctrlMic = el('button', { class: 'ctrl', type: 'button' },
      el('span', { class: 'ico', text: '\u{1F3A4}' }), el('span', { text: 'Mute' }));
    const ctrlCam = el('button', { class: 'ctrl', type: 'button' },
      el('span', { class: 'ico', text: '\u{1F4F7}' }), el('span', { text: 'Camera' }));
    const ctrlShare = el('button', { class: 'ctrl', type: 'button' },
      el('span', { class: 'ico', text: '\u{1F5B5}' }), el('span', { text: 'Share' }));
    const ctrlBoard = el('button', { class: 'ctrl', type: 'button' },
      el('span', { class: 'ico', text: '\u{1F3A8}' }), el('span', { text: 'Whiteboard' }));
    const ctrlLeave = el('button', { class: 'ctrl leave', type: 'button' },
      el('span', { class: 'ico', text: '\u{1F4F4}' }), el('span', { text: 'Leave' }));

    controls.append(ctrlMic, ctrlCam, ctrlShare, ctrlBoard, ctrlLeave);

    function pushMediaState() {
      state.socket?.emit('media:state', {
        muted: state.muted, cameraOff: state.cameraOff, sharing: state.sharing,
      });
    }

    function paintControls() {
      ctrlMic.classList.toggle('off', state.muted);
      ctrlMic.lastChild.textContent = state.muted ? 'Unmute' : 'Mute';
      ctrlCam.classList.toggle('off', state.cameraOff);
      ctrlCam.lastChild.textContent = state.cameraOff ? 'Camera on' : 'Camera off';
      ctrlShare.classList.toggle('on', state.sharing);
      ctrlShare.lastChild.textContent = state.sharing ? 'Stop share' : 'Share';
      selfTile.tile.classList.toggle('sharing', state.sharing);
      selfTile.placeholder.classList.toggle('hidden', !(state.cameraOff && !state.sharing));

      const hasMedia = !!state.localStream;
      ctrlMic.disabled = !hasMedia;
      ctrlCam.disabled = !hasMedia;
    }

    // Mute toggles the audio track's enabled flag. The track keeps flowing
    // but carries silence, which is cheaper than renegotiating the call.
    ctrlMic.addEventListener('click', () => {
      if (!state.localStream) return;
      state.muted = !state.muted;
      state.localStream.getAudioTracks().forEach((t) => { t.enabled = !state.muted; });
      paintControls();
      pushMediaState();
    });

    ctrlCam.addEventListener('click', () => {
      if (!state.localStream) return;
      state.cameraOff = !state.cameraOff;
      state.localStream.getVideoTracks().forEach((t) => { t.enabled = !state.cameraOff; });
      paintControls();
      pushMediaState();
    });

    /**
     * Screen sharing. getDisplayMedia gives a new video track; it replaces
     * the camera track in every peer connection via RTCRtpSender.replaceTrack,
     * which swaps the media without a renegotiation round trip.
     */
    ctrlShare.addEventListener('click', async () => {
      if (state.sharing) return stopSharing();

      try {
        state.screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 15 } },
          audio: false,
        });
      } catch (err) {
        if (err.name !== 'NotAllowedError') {
          toastError(`Screen sharing failed: ${err.message}`);
        }
        return; // the user simply cancelled the picker
      }

      const screenTrack = state.screenStream.getVideoTracks()[0];

      // Swap the outgoing video track for every peer.
      for (const peer of state.peers.values()) {
        const sender = peer.pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) await sender.replaceTrack(screenTrack);
        else peer.pc.addTrack(screenTrack, state.screenStream);
      }

      selfTile.video.srcObject = state.screenStream;
      state.sharing = true;
      paintControls();
      pushMediaState();
      toastOk('You are sharing your screen.');

      // The browser's own "Stop sharing" bar ends the track directly.
      screenTrack.addEventListener('ended', stopSharing);
    });

    async function stopSharing() {
      if (!state.sharing) return;
      state.screenStream?.getTracks().forEach((t) => t.stop());
      state.screenStream = null;

      // Put the camera track back for everyone.
      const cameraTrack = state.localStream?.getVideoTracks()[0] || null;
      for (const peer of state.peers.values()) {
        const sender = peer.pc.getSenders().find((s) => s.track?.kind === 'video' || !s.track);
        if (sender && cameraTrack) await sender.replaceTrack(cameraTrack);
      }

      selfTile.video.srcObject = state.localStream;
      state.sharing = false;
      paintControls();
      pushMediaState();
      toast('Screen sharing stopped.', 'info');
    }

    ctrlBoard.addEventListener('click', () => {
      canvas.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    ctrlLeave.addEventListener('click', async () => {
      const yes = await confirmDialog('Leave meeting', 'Leave this room?',
        { confirmLabel: 'Leave', danger: true });
      if (!yes) return;
      teardown();
      location.href = '/meet/';
    });

    /** Releases the camera, closes every peer connection and the socket. */
    function teardown() {
      state.localStream?.getTracks().forEach((t) => t.stop());
      state.screenStream?.getTracks().forEach((t) => t.stop());
      for (const peerId of Array.from(state.peers.keys())) removePeer(peerId);
      state.socket?.emit('room:leave');
      state.socket?.disconnect();
      RoomCrypto.lock();
    }

    // Also clean up if the tab is simply closed.
    window.addEventListener('beforeunload', teardown);

    /* ================================================================
       SIDE PANEL: chat, files, people
       ================================================================ */

    const chatLog = el('div', { class: 'chat-log' });

    function switchPanel(key) {
      state.activePanel = key;
      for (const [name, btn] of Object.entries(tabButtons)) {
        btn.classList.toggle('active', name === key);
      }
      if (key === 'chat') paintChat();
      else if (key === 'files') paintFiles();
      else paintPeople();
    }

    /* ----------------------------- chat ----------------------------- */

    const chatInput = el('textarea', { placeholder: 'Message (encrypted)…', maxlength: '2000',
      'aria-label': 'Chat message' });
    const chatSend = el('button', { class: 'btn btn-sm', type: 'submit' }, 'Send');
    const chatForm = el('form', { class: 'chat-form' },
      el('div', { class: 'grow' }, chatInput), chatSend);

    chatForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const text = chatInput.value.trim();
      if (!text) return;

      chatInput.value = '';
      try {
        // Encrypted here, in the browser, before it touches the socket.
        const { ciphertext, iv } = await RoomCrypto.encryptText(text);
        state.socket.emit('chat:send', { ciphertext, iv }, (ack) => {
          if (!ack?.ok) toastError(ack?.error || 'The message could not be sent.');
        });
      } catch (err) {
        toastError(`Could not encrypt that message: ${err.message}`);
        chatInput.value = text; // give the text back rather than losing it
      }
    });

    // Enter sends, Shift+Enter makes a new line.
    chatInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        chatForm.requestSubmit();
      }
    });

    function paintChat() {
      panelBody.innerHTML = '';
      panelBody.append(
        el('div', { class: 'e2ee-note',
          text: `\u{1F512} Encrypted with AES-256-GCM. PBKDF2 ${RoomCrypto.PBKDF2_ITERATIONS.toLocaleString()} iterations.` }),
        chatLog,
        chatForm
      );
      chatLog.scrollTop = chatLog.scrollHeight;
    }

    /** Decrypts a message and appends it to the log. */
    async function appendMessage(message) {
      const mine = message.user_id === me.id;
      const textNode = el('div', { class: 'text' });
      const node = el('div', { class: `chat-msg ${mine ? 'mine' : ''}`.trim() },
        el('div', { class: 'who', text: `${mine ? 'You' : message.username} · ${formatDateTime(message.created_at)}` }),
        textNode);

      try {
        textNode.textContent = await RoomCrypto.decryptText(message.ciphertext, message.iv);
      } catch {
        // A wrong passphrase, or a message from before the passphrase changed.
        node.classList.add('undecryptable');
        textNode.textContent = '[cannot decrypt - this message used a different passphrase]';
      }

      chatLog.append(node);
      chatLog.scrollTop = chatLog.scrollHeight;
    }

    /* ----------------------------- files ---------------------------- */

    const fileInput = el('input', { type: 'file' });
    const dropZone = el('label', { class: 'drop-zone' },
      el('div', {}, '\u{1F4C1} Click or drop a file here'),
      el('div', { class: 'small', text: 'Encrypted in your browser before upload. Up to 20MB.' }),
      fileInput);

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) uploadFile(file);
      fileInput.value = '';
    });

    // Drag-and-drop onto the zone.
    dropZone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropZone.classList.add('over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
    dropZone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropZone.classList.remove('over');
      const file = event.dataTransfer?.files?.[0];
      if (file) uploadFile(file);
    });

    const fileList = el('div');

    function paintFiles() {
      panelBody.innerHTML = '';
      panelBody.append(dropZone, fileList);
      paintFileList();
    }

    function humanSize(bytes) {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }

    function paintFileList() {
      fileList.innerHTML = '';
      if (!state.files.length) {
        fileList.append(el('p', { class: 'small muted', text: 'No files shared yet.' }));
        return;
      }

      for (const file of state.files) {
        const nameNode = el('div', { class: 'file-name', text: 'decrypting name…' });

        // The stored name is ciphertext, so it has to be decrypted to display.
        RoomCrypto.decryptFileName(file.original_name, file.name_iv)
          .then((meta) => {
            nameNode.textContent = meta.name;
            file.__type = meta.type;
            file.__name = meta.name;
          })
          .catch(() => {
            nameNode.textContent = '[name cannot be decrypted]';
            nameNode.style.fontStyle = 'italic';
          });

        const download = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Download');
        download.addEventListener('click', () => downloadFile(file, download));

        const row = el('div', { class: 'file-row' },
          el('span', { text: '\u{1F510}' }),
          el('div', { class: 'grow' },
            nameNode,
            el('div', { class: 'small muted',
              text: `${file.username} · ${humanSize(file.size_bytes)} · ${timeAgo(file.created_at)}` })),
          download);

        if (file.user_id === me.id || room.owner_id === me.id) {
          const del = el('button', { class: 'icon-btn', type: 'button', style: 'color:var(--danger)' }, '×');
          del.addEventListener('click', async () => {
            try {
              await API.del(`/api/meet/files/${file.id}`);
              state.files = state.files.filter((f) => f.id !== file.id);
              state.socket.emit('file:removed', { file_id: file.id });
              toastOk('File removed.');
              paintFileList();
            } catch (err) {
              toastError(err.message);
            }
          });
          row.append(del);
        }

        fileList.append(row);
      }
    }

    async function uploadFile(file) {
      if (file.size > 20 * 1024 * 1024) {
        return toastError('That file is larger than 20MB.');
      }

      const progress = el('p', { class: 'small muted', text: `Encrypting ${file.name}…` });
      fileList.prepend(progress);

      try {
        // Encrypt first, then upload the ciphertext. The server never sees the
        // real bytes or the real filename.
        const { blob, iv, encryptedName, nameIv } = await RoomCrypto.encryptFile(file);

        progress.textContent = `Uploading ${file.name}…`;

        const form = new FormData();
        form.set('file', blob, 'encrypted.bin');
        form.set('encrypted_name', encryptedName);
        form.set('iv', iv);
        form.set('name_iv', nameIv);

        const { file: saved } = await API.upload(
          `/api/meet/rooms/${room.code}/files`, form
        );

        state.files.unshift(saved);
        state.socket.emit('file:shared', { file: saved });
        toastOk(`${file.name} shared (encrypted).`);
      } catch (err) {
        toastError(`Could not share that file: ${err.message}`);
      } finally {
        progress.remove();
        paintFileList();
      }
    }

    async function downloadFile(file, button) {
      await withBusy(button, async () => {
        try {
          const response = await fetch(`/api/meet/files/${file.id}`, { credentials: 'include' });
          if (!response.ok) throw new Error('That file could not be downloaded.');
          const encrypted = await response.arrayBuffer();

          const meta = file.__name
            ? { name: file.__name, type: file.__type }
            : await RoomCrypto.decryptFileName(file.original_name, file.name_iv);

          const blob = await RoomCrypto.decryptFile(encrypted, file.iv, meta.type);

          // Hand the decrypted blob to the browser as a normal download.
          const url = URL.createObjectURL(blob);
          const link = el('a', { href: url, download: meta.name });
          document.body.append(link);
          link.click();
          link.remove();
          // Revoke a moment later, so the download has started.
          setTimeout(() => URL.revokeObjectURL(url), 10000);
          toastOk(`${meta.name} decrypted and saved.`);
        } catch (err) {
          toastError(`Could not decrypt that file: ${err.message}`);
        }
      });
    }

    /* ---------------------------- people ---------------------------- */

    function paintPeople() {
      panelBody.innerHTML = '';
      const list = el('div');
      panelBody.append(
        el('p', { class: 'small muted',
          text: `${state.participants.length} in the room. Video and audio are peer-to-peer (mesh).` }),
        list
      );

      if (!state.participants.length) {
        list.append(el('p', { class: 'small muted', text: 'Just you so far.' }));
        return;
      }

      for (const person of state.participants) {
        list.append(
          el('div', { class: 'participant-row' },
            avatarNode({ username: person.username }, 'avatar-sm'),
            el('span', {}, person.username, person.user_id === me.id ? ' (you)' : ''),
            el('span', { class: 'state' },
              person.muted ? el('span', { title: 'Muted', text: '\u{1F507}' }) : null,
              person.camera_off ? el('span', { title: 'Camera off', text: '\u{1F6AB}' }) : null,
              person.sharing ? el('span', { title: 'Sharing screen', text: '\u{1F5B5}' }) : null))
        );
      }
    }

    /* ================================================================
       WHITEBOARD

       Coordinates travel as 0..1 fractions of the canvas, so a stroke drawn
       on a phone lands in the same place on a desktop.
       ================================================================ */

    const ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const board = { drawing: false, last: null, color: SWATCHES[0], width: 3, erase: false };

    /* tools */
    const swatches = el('div', { class: 'swatches' });
    const swatchButtons = [];
    SWATCHES.forEach((color, index) => {
      const btn = el('button', {
        class: `swatch ${index === 0 ? 'active' : ''}`.trim(),
        type: 'button',
        style: `background:${color}`,
        title: color,
        'aria-label': `Colour ${color}`,
      });
      btn.addEventListener('click', () => {
        board.color = color;
        board.erase = false;
        swatchButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        penBtn.classList.add('on');
        eraserBtn.classList.remove('on');
      });
      swatchButtons.push(btn);
      swatches.append(btn);
    });

    const penBtn = el('button', { class: 'btn btn-ghost btn-sm on', type: 'button' }, '✏ Pen');
    const eraserBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, '\u{1F9FD} Eraser');
    const widthInput = el('input', { type: 'range', min: '1', max: '30', value: '3',
      style: 'width:110px', 'aria-label': 'Brush size' });
    const clearBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', style: 'color:var(--danger)' },
      'Clear board');

    penBtn.addEventListener('click', () => {
      board.erase = false;
      penBtn.classList.add('on');
      eraserBtn.classList.remove('on');
    });
    eraserBtn.addEventListener('click', () => {
      board.erase = true;
      eraserBtn.classList.add('on');
      penBtn.classList.remove('on');
    });
    widthInput.addEventListener('input', () => { board.width = Number(widthInput.value); });
    clearBtn.addEventListener('click', async () => {
      const yes = await confirmDialog('Clear whiteboard',
        'Clear the board for everyone in the room?', { confirmLabel: 'Clear it' });
      if (!yes) return;
      ctx.clearRect(0, 0, BOARD_W, BOARD_H);
      state.socket.emit('board:clear');
    });

    boardTools.append(
      el('span', { class: 'small muted', text: 'Colour' }), swatches,
      penBtn, eraserBtn,
      el('span', { class: 'small muted', text: 'Size' }), widthInput,
      clearBtn
    );

    /** Draws one segment. Coordinates are fractions of the canvas. */
    function drawSegment(seg) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(seg.x0 * BOARD_W, seg.y0 * BOARD_H);
      ctx.lineTo(seg.x1 * BOARD_W, seg.y1 * BOARD_H);
      ctx.lineWidth = seg.width;
      if (seg.erase) {
        // The eraser clears pixels rather than painting white, so the board
        // stays transparent-friendly.
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        ctx.lineWidth = seg.width * 3;
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = seg.color;
      }
      ctx.stroke();
      ctx.restore();
    }

    /** Pointer position as 0..1 fractions, independent of the display size. */
    function pointerPos(event) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height,
      };
    }

    canvas.addEventListener('pointerdown', (event) => {
      canvas.setPointerCapture(event.pointerId);
      board.drawing = true;
      board.last = pointerPos(event);
    });

    canvas.addEventListener('pointermove', (event) => {
      if (!board.drawing) return;
      const pos = pointerPos(event);
      const seg = {
        x0: board.last.x, y0: board.last.y, x1: pos.x, y1: pos.y,
        color: board.color, width: board.width, erase: board.erase,
      };
      drawSegment(seg);                       // draw locally straight away
      state.socket?.emit('board:stroke', seg); // and share it
      board.last = pos;
    });

    function endStroke(event) {
      if (!board.drawing) return;
      board.drawing = false;
      board.last = null;
      if (event?.pointerId !== undefined && canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    }
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);
    canvas.addEventListener('pointerleave', endStroke);

    /* ================================================================
       SOCKET WIRING
       ================================================================ */

    paintVideoGrid();
    paintControls();
    switchPanel('chat');

    await startLocalMedia();
    paintControls();

    const socket = io('/meet', { withCredentials: true });
    state.socket = socket;

    socket.on('connect', () => {
      socket.emit('room:join', { code: room.code }, async (ack) => {
        if (!ack?.ok) {
          statusChip.className = 'badge badge-danger';
          statusChip.textContent = ack?.error || 'could not join';
          return toastError(ack?.error || 'Could not join the room.');
        }

        state.selfId = ack.self.socket_id;
        statusChip.className = 'badge badge-success';
        statusChip.textContent = 'connected';

        // Replay the whiteboard so a late joiner sees the existing drawing.
        ctx.clearRect(0, 0, BOARD_W, BOARD_H);
        (ack.strokes || []).forEach(drawSegment);

        // Call everyone who was already here. We are the newcomer, so we offer.
        for (const peer of ack.peers) {
          createPeer(peer.socket_id, peer.username, true);
        }

        pushMediaState();
        await loadHistory();
      });
    });

    socket.on('disconnect', () => {
      statusChip.className = 'badge badge-warning';
      statusChip.textContent = 'reconnecting…';
    });

    socket.on('connect_error', (err) => {
      statusChip.className = 'badge badge-danger';
      statusChip.textContent = 'offline';
      toastError(err.message || 'Lost the connection to the server.');
    });

    /* --- peers --- */

    // Somebody new arrived. They will send us an offer, so we only prepare a
    // connection and wait (isInitiator = false).
    socket.on('peer:joined', ({ socket_id, username }) => {
      if (socket_id === state.selfId || state.peers.has(socket_id)) return;
      createPeer(socket_id, username, false);
      toast(`${username} joined the room.`, 'info');
    });

    socket.on('peer:left', ({ socket_id, username }) => {
      if (!state.peers.has(socket_id)) return;
      removePeer(socket_id);
      toast(`${username} left the room.`, 'info');
    });

    socket.on('room:participants', ({ participants }) => {
      state.participants = participants;
      if (state.activePanel === 'people') paintPeople();
    });

    /* --- WebRTC signalling --- */

    socket.on('webrtc:offer', async ({ from, username, description }) => {
      let peer = state.peers.get(from);
      if (!peer) peer = createPeer(from, username, false);

      try {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(description));
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        socket.emit('webrtc:answer', { to: from, description: peer.pc.localDescription });
      } catch (err) {
        console.error('failed to answer an offer', err);
      }
    });

    socket.on('webrtc:answer', async ({ from, description }) => {
      const peer = state.peers.get(from);
      if (!peer) return;
      try {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(description));
      } catch (err) {
        console.error('failed to apply an answer', err);
      }
    });

    socket.on('webrtc:ice', async ({ from, candidate }) => {
      const peer = state.peers.get(from);
      if (!peer || !candidate) return;
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        // A candidate arriving before the remote description is normal.
        console.debug('ICE candidate skipped', err.message);
      }
    });

    /* --- chat --- */

    socket.on('chat:message', (message) => {
      appendMessage(message);
      if (state.activePanel !== 'chat' && message.user_id !== me.id) {
        tabButtons.chat.textContent = 'Chat •';
      }
    });

    tabButtons.chat.addEventListener('click', () => { tabButtons.chat.textContent = 'Chat'; });

    /* --- files --- */

    socket.on('file:shared', ({ file, username }) => {
      state.files.unshift(file);
      toast(`${username} shared an encrypted file.`, 'info');
      if (state.activePanel === 'files') paintFileList();
    });

    socket.on('file:removed', ({ file_id }) => {
      state.files = state.files.filter((f) => f.id !== file_id);
      if (state.activePanel === 'files') paintFileList();
    });

    /* --- whiteboard --- */

    socket.on('board:stroke', drawSegment);

    socket.on('board:clear', ({ username }) => {
      ctx.clearRect(0, 0, BOARD_W, BOARD_H);
      toast(`${username} cleared the whiteboard.`, 'info');
    });

    /* --- history --- */

    async function loadHistory() {
      try {
        const [{ messages }, { files }] = await Promise.all([
          API.get(`/api/meet/rooms/${room.code}/messages`),
          API.get(`/api/meet/rooms/${room.code}/files`),
        ]);

        chatLog.innerHTML = '';
        // Sequential, so the messages stay in order while each is decrypted.
        for (const message of messages) {
          await appendMessage(message);
        }

        state.files = files;
        if (state.activePanel === 'files') paintFileList();
      } catch (err) {
        toastError(`Could not load the room history: ${err.message}`);
      }
    }
  }

  return { renderLobby, renderRoom };
})();

window.Meet = Meet;
