// Server entry. Express for the small REST surface (leaderboard, health),
// Socket.io for everything real-time.

import express from 'express';
import http from 'node:http';
import cors from 'cors';
import { Server as IOServer } from 'socket.io';

import * as store from './store.js';
import * as rooms from './rooms.js';

const PORT = parseInt(process.env.PORT || '3001', 10);

// CORS configuration.
//   - In dev: leave CLIENT_ORIGIN unset, we accept everything. Fine for
//     localhost.
//   - In prod: set CLIENT_ORIGIN to your deployed client URL, or a
//     comma-separated list of them (e.g.
//     "https://beatbattle.vercel.app,https://beatbattle.com").
//     Anything not on that list will be blocked by the browser.
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN;
const corsOrigin = CLIENT_ORIGIN
  ? CLIENT_ORIGIN.split(',').map(s => s.trim())
  : true; // true = reflect request origin (dev only)

const app = express();
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/api/leaderboard', (_req, res) => {
  res.json({ entries: store.leaderboard(50) });
});

app.get('/api/me/:id', (req, res) => {
  const u = store.getUser(req.params.id);
  if (!u) return res.status(404).json({ error: 'not found' });
  res.json({ user: u, recent: store.recentMatches(u.id, 20) });
});

// Public list of active matches anyone can spectate. Used by the match
// browser on the home screen.
app.get('/api/matches', (_req, res) => {
  res.json({ matches: rooms.listPublicMatches() });
});

const server = http.createServer(app);
const io = new IOServer(server, {
  cors: { origin: corsOrigin, credentials: true },
});

io.on('connection', (socket) => {
  // Identity is sent from the client on connect — could be a returning user id
  // (stored in localStorage) or a fresh signup.
  let user = null;

  socket.on('hello', ({ userId, username }, ack) => {
    user = store.getOrCreateUser({ id: userId, username });
    socket.data.userId = user.id;
    // If they were already in a room (refreshed page), reattach.
    const existing = rooms.getRoomForUser(user.id);
    if (existing) {
      rooms.attachSocket(io, existing, user.id, socket.id);
    }
    // Same for spectator role — keep them watching after a refresh.
    const spectating = rooms.getSpectateRoomForUser(user.id);
    if (spectating) {
      rooms.spectateRoom(io, user, spectating.code, socket.id);
    }
    ack?.({ user });
  });

  socket.on('createRoom', ({ ranked = false } = {}, ack) => {
    if (!user) return ack?.({ error: 'No user' });
    const room = rooms.createPrivateRoom(io, user, { ranked }, socket.id);
    ack?.({ code: room.code });
  });

  socket.on('joinRoom', ({ code }, ack) => {
    if (!user) return ack?.({ error: 'No user' });
    const r = rooms.joinByCode(io, user, code, socket.id);
    if (r.error) return ack?.({ error: r.error });
    ack?.({ code: r.room.code });
  });

  socket.on('quickBattle', (_payload, ack) => {
    if (!user) return ack?.({ error: 'No user' });
    const r = rooms.quickBattle(io, user, socket.id);
    if (r.queued) return ack?.({ queued: true });
    if (r.room) {
      // joinRoom inside quickBattle already attached this socket to the room
      // channel, so we don't need a separate attachSocket call. Keeping the
      // ack so the client knows the match landed.
      return ack?.({ code: r.room.code });
    }
    ack?.({ error: 'Could not match' });
  });

  socket.on('cancelQuick', () => {
    if (user) rooms.cancelQuickBattle(user.id);
  });

  socket.on('ready', ({ ready }) => {
    if (!user) return;
    const room = rooms.getRoomForUser(user.id);
    if (room) rooms.setReady(io, room, user.id, !!ready);
  });

  socket.on('submitBeat', ({ beat }, ack) => {
    if (!user) return ack?.({ error: 'No user' });
    const room = rooms.getRoomForUser(user.id);
    if (!room) return ack?.({ error: 'Not in room' });
    const r = rooms.submitBeat(io, room, user.id, beat);
    ack?.(r);
  });

  socket.on('status', ({ status }) => {
    if (!user) return;
    const room = rooms.getRoomForUser(user.id);
    if (room) rooms.updateStatus(io, room, user.id, status);
  });

  socket.on('vote', ({ choice }, ack) => {
    if (!user) return ack?.({ error: 'No user' });
    const room = rooms.getRoomForUser(user.id);
    if (!room) return ack?.({ error: 'Not in room' });
    const r = rooms.castVote(io, room, user.id, choice);
    ack?.(r);
  });

  socket.on('rematch', () => {
    if (!user) return;
    const room = rooms.getRoomForUser(user.id);
    if (room) rooms.rematch(io, room);
  });

  socket.on('spectate', ({ code }, ack) => {
    if (!user) return ack?.({ error: 'No user' });
    const r = rooms.spectateRoom(io, user, code, socket.id);
    if (r.error) return ack?.({ error: r.error });
    ack?.({ code: r.room.code });
  });

  socket.on('leaveSpectate', () => {
    if (!user) return;
    rooms.leaveSpectate(io, user.id);
  });

  socket.on('leaveRoom', () => {
    if (!user) return;
    rooms.handleDisconnect(io, user.id);
  });

  socket.on('disconnect', () => {
    if (user) rooms.handleDisconnect(io, user.id);
  });
});

// Bind to 0.0.0.0 rather than localhost so the process accepts traffic from
// outside its container (required by Render, Fly, Railway, Heroku, etc.).
server.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`[beatbattle] listening on :${PORT}`);
});
