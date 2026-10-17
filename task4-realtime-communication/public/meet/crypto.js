/* =====================================================================
   TASK 4 - End-to-end encryption with the Web Crypto API.

   Why this exists
   ---------------
   WebRTC already encrypts audio and video for us: the spec mandates
   DTLS-SRTP, so the media stream is encrypted between browsers and there
   is nothing to add. But chat messages and shared files do pass through
   the server, and by default the server would be able to read them.

   This module closes that gap. Everything typed in the chat, and every
   file shared, is encrypted in the browser before it is sent, and only
   decrypted in the browsers of people who know the room passphrase. The
   server stores and relays ciphertext it cannot read.

   How the key is made
   -------------------
   The room passphrase is NEVER transmitted. Each participant types it
   locally, and the same key is derived independently in every browser:

     passphrase + salt  --PBKDF2(SHA-256, 150k iterations)-->  AES-256 key

   The salt is derived from the room code, so everyone in a room reaches
   the same key while two different rooms with the same passphrase do not.
   PBKDF2 with a high iteration count is what makes a weak passphrase
   expensive to brute-force.

   How a message is encrypted
   --------------------------
   AES-GCM with a fresh 12-byte IV per message. GCM is an AEAD mode, so it
   gives us two things at once:
     - confidentiality: the server sees random bytes
     - integrity: if a byte of the ciphertext is altered, decryption fails
       loudly instead of returning wrong plaintext
   Reusing an IV with the same key would break AES-GCM badly, hence a new
   random IV every single time, sent alongside the ciphertext (an IV is
   not secret).

   What the server can still see
   -----------------------------
   Metadata: which account sent a message, when, how large it was, and who
   is in the room. Encrypting that too would need a different design. The
   contents of messages and files, and their filenames, it cannot read.
   ===================================================================== */

const RoomCrypto = (() => {
  const PBKDF2_ITERATIONS = 150000;
  const IV_BYTES = 12;          // 96 bits, the recommended size for AES-GCM
  const KEY_BITS = 256;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let key = null;        // the derived CryptoKey for this room
  let roomCode = null;

  /** Web Crypto needs a secure context; http://localhost counts as one. */
  function isAvailable() {
    return typeof crypto !== 'undefined' && !!crypto.subtle;
  }

  /* ------------------------- base64 helpers ------------------------- */

  function toBase64(bytes) {
    let binary = '';
    const view = new Uint8Array(bytes);
    // Chunked, because String.fromCharCode(...hugeArray) overflows the stack.
    const CHUNK = 0x8000;
    for (let i = 0; i < view.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, view.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  function fromBase64(text) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /* --------------------------- key setup ---------------------------- */

  /**
   * Derives this room's AES-GCM key from the passphrase.
   * Called once when joining; the key stays only in memory.
   */
  async function unlock(code, passphrase) {
    if (!isAvailable()) {
      throw new Error('This browser cannot encrypt (Web Crypto unavailable). Use https or localhost.');
    }
    if (!passphrase || passphrase.length < 4) {
      throw new Error('The room passphrase must be at least 4 characters.');
    }

    // The passphrase becomes the PBKDF2 input key.
    const baseKey = await crypto.subtle.importKey(
      'raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']
    );

    // Salt from the room code: same room + same passphrase = same key, while
    // a different room with the same passphrase derives a different one.
    const salt = encoder.encode(`codealpha-meet-v1:${String(code).toUpperCase()}`);

    key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: KEY_BITS },
      false,                 // not extractable: the key cannot be read back out
      ['encrypt', 'decrypt']
    );

    roomCode = String(code).toUpperCase();
    return true;
  }

  function isUnlocked() {
    return key !== null;
  }

  function lock() {
    key = null;
    roomCode = null;
  }

  /* ---------------------------- strings ----------------------------- */

  /** Encrypts a string. Returns { ciphertext, iv } as base64. */
  async function encryptText(plaintext) {
    if (!key) throw new Error('The room is locked. Enter the passphrase first.');
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, encoder.encode(plaintext)
    );
    return { ciphertext: toBase64(encrypted), iv: toBase64(iv) };
  }

  /**
   * Decrypts a string. Throws if the passphrase is wrong or the ciphertext
   * was tampered with - AES-GCM verifies its authentication tag, so a bad
   * key cannot silently produce garbage plaintext.
   */
  async function decryptText(ciphertext, iv) {
    if (!key) throw new Error('The room is locked. Enter the passphrase first.');
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(iv) }, key, fromBase64(ciphertext)
    );
    return decoder.decode(decrypted);
  }

  /* ----------------------------- files ------------------------------ */

  /**
   * Encrypts a File. The name is encrypted separately from the bytes, with
   * its own IV, so the server cannot even see what a file is called.
   * Returns { blob, iv, encryptedName, nameIv }.
   */
  async function encryptFile(file) {
    if (!key) throw new Error('The room is locked. Enter the passphrase first.');

    const bytes = await file.arrayBuffer();
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);

    // The real name and type are packed together so both survive the round
    // trip while staying unreadable to the server.
    const meta = JSON.stringify({ name: file.name, type: file.type || 'application/octet-stream' });
    const { ciphertext: encryptedName, iv: nameIv } = await encryptText(meta);

    return {
      blob: new Blob([encrypted], { type: 'application/octet-stream' }),
      iv: toBase64(iv),
      encryptedName,
      nameIv,
    };
  }

  /** Decrypts the packed {name, type} metadata of a shared file. */
  async function decryptFileName(encryptedName, nameIv) {
    const json = await decryptText(encryptedName, nameIv);
    try {
      const meta = JSON.parse(json);
      return { name: meta.name || 'file', type: meta.type || 'application/octet-stream' };
    } catch {
      // Older or unexpected payload: treat the whole thing as the name.
      return { name: json, type: 'application/octet-stream' };
    }
  }

  /** Decrypts downloaded ciphertext back into a Blob the browser can save. */
  async function decryptFile(arrayBuffer, iv, type) {
    if (!key) throw new Error('The room is locked. Enter the passphrase first.');
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(iv) }, key, arrayBuffer
    );
    return new Blob([decrypted], { type: type || 'application/octet-stream' });
  }

  return {
    isAvailable,
    unlock,
    isUnlocked,
    lock,
    encryptText,
    decryptText,
    encryptFile,
    decryptFile,
    decryptFileName,
    get roomCode() { return roomCode; },
    // Exposed for the README demo: prove the stored value is unreadable.
    toBase64,
    fromBase64,
    PBKDF2_ITERATIONS,
  };
})();

window.RoomCrypto = RoomCrypto;
