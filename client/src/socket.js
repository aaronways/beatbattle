// Socket.io client wrapper. We persist a guest user id in localStorage so that
// refreshing the tab returns the same identity to the server (which lets it
// rejoin an in-flight room).

import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

const STORAGE_KEY = 'beatbattle.user';

function loadIdentity() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}

export function saveUsername(username) {
  const id = loadIdentity();
  id.username = username;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(id));
}

export const socket = io(SERVER_URL, { autoConnect: false });

// Connect + handshake. Resolves with the server-assigned user record.
export function connect(usernameOverride) {
  return new Promise((resolve) => {
    if (!socket.connected) socket.connect();
    const id = loadIdentity();
    const username = usernameOverride || id.username;
    const send = () => socket.emit('hello', { userId: id.userId, username }, (res) => {
      if (res?.user) {
        const next = { userId: res.user.id, username: res.user.username };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        resolve(res.user);
      }
    });
    if (socket.connected) send();
    else socket.once('connect', send);
  });
}

// Promise-style wrapper around emit-with-ack.
export function call(event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}
