// Socket.io client wrapper. We persist a guest user id in localStorage so that
// refreshing the tab returns the same identity to the server (which lets it
// rejoin an in-flight room).
//
// Key behaviors:
//   - On every (re)connect, we automatically re-emit `hello` so the server
//     always knows who this socket is. Without this, after a Render restart
//     or network blip, the client reconnects silently but the server has
//     no user binding — every subsequent event fails with "No user".
//   - connect() resolves with the user on first successful hello.
//   - call() has a built-in timeout to prevent indefinite hangs when the
//     server is unreachable.

import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
const STORAGE_KEY = 'beatbattle.user';
const CALL_TIMEOUT_MS = 10_000;     // hard ceiling for any single round-trip
const CONNECT_TIMEOUT_MS = 15_000;  // initial connect

function loadIdentity() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}

export function saveUsername(username) {
  const id = loadIdentity();
  id.username = username;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(id));
}

export const socket = io(SERVER_URL, {
  autoConnect: false,
  // Socket.io's default reconnect is fine, but we want the events.
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 5000,
});

// Send the hello handshake. Always uses the persisted userId + username.
// Updates localStorage if the server assigns a new id.
function sendHello(usernameOverride) {
  return new Promise((resolve) => {
    const id = loadIdentity();
    const username = usernameOverride || id.username;
    socket.emit('hello', { userId: id.userId, username }, (res) => {
      if (res?.user) {
        const next = { userId: res.user.id, username: res.user.username };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        resolve(res.user);
      } else {
        resolve(null);
      }
    });
  });
}

// On every socket-level connect (initial OR auto-reconnect after a drop),
// re-send hello so the server re-binds this socket to the user. Without
// this, after a server restart or transient disconnect, all subsequent
// emits hit a connection with no `user` bound and silently fail.
socket.on('connect', () => {
  sendHello();
});

// Connect + initial handshake. Resolves with the server-assigned user.
// Rejects after CONNECT_TIMEOUT_MS if the server is unreachable.
export function connect(usernameOverride) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (val, err) => {
      if (settled) return;
      settled = true;
      if (err) reject(err); else resolve(val);
    };

    const timeoutId = setTimeout(() => {
      finish(null, new Error('Could not reach the server. Check your connection.'));
    }, CONNECT_TIMEOUT_MS);

    const doHandshake = async () => {
      const user = await sendHello(usernameOverride);
      clearTimeout(timeoutId);
      if (user) finish(user);
      else finish(null, new Error('Server did not respond to handshake'));
    };

    if (!socket.connected) socket.connect();
    if (socket.connected) doHandshake();
    else socket.once('connect', doHandshake);
  });
}

// Promise-style wrapper around emit-with-ack. Times out after
// CALL_TIMEOUT_MS so the UI doesn't hang forever if the server is gone.
export function call(event, payload) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    const timeoutId = setTimeout(() => {
      finish({ error: 'Request timed out. Check your connection.' });
    }, CALL_TIMEOUT_MS);
    socket.emit(event, payload, (res) => {
      clearTimeout(timeoutId);
      finish(res);
    });
  });
}
