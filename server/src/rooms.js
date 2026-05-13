// Room state machine. The server is authoritative for:
//   - timer (battle countdown, voting countdown)
//   - sound kit selection (deterministic from a per-room seed)
//   - vote tallying (one vote per player, no self-vote)
//   - winner decision and ELO updates
//
// The client only receives state snapshots and emits intent events.

import { generateKit } from './sounds.js';
import { applyElo } from './elo.js';
import { scoreBeat } from './scorer.js';
import * as store from './store.js';
import {
  ROOM_CODE_LENGTH,
  DEFAULT_BATTLE_SECONDS,
  VOTING_SECONDS,
  RECONNECT_GRACE_SECONDS,
  KIT_COMPOSITION,
  PHASE,
} from '../../shared/gameRules.js';

const BATTLE_SECONDS = parseInt(process.env.BATTLE_SECONDS || DEFAULT_BATTLE_SECONDS, 10);

const rooms = new Map();             // code → room
const userToRoom = new Map();        // userId → room code (PLAYER)
const userToSpectateRoom = new Map();// userId → room code (SPECTATOR)
// Queue entries hold the socketId at the moment of queueing, so when a
// match fires we can immediately join BOTH players' sockets to the new
// room channel — not just the player who clicked Quick Battle second.
// Without this, the first-queued player never receives the 'room' event
// and appears stuck in matchmaking until some other action retriggers a
// broadcast.
let quickBattleQueue = [];           // [{ userId, socketId, joinedAt }]

// ────────────────────────────────────────────────────────────────────────────
// Leaving rooms cleanly
// ────────────────────────────────────────────────────────────────────────────

// Fully evict a user from a room: stop all bookkeeping, leave the Socket.io
// channel, and delete the room if it's now empty. This is the function that
// handles every "I'm out, for real" case — leaving from RESULT, leaving from
// LOBBY, hopping rooms via joinRoom, etc.
//
// This is separate from `handleDisconnect`, which deals with the
// "they got disconnected but might come back" case and keeps the player slot
// alive for RECONNECT_GRACE_SECONDS.
function leaveRoomFully(io, room, userId) {
  if (!room) return;
  const player = room.players[userId];
  if (player && io && player.socketId) {
    // Leave the Socket.io broadcast channel so they don't receive any more
    // 'room'/'tick' events for this room after they've left.
    io.sockets.sockets.get(player.socketId)?.leave(room.code);
  }
  delete room.players[userId];
  // Only delete the userToRoom mapping if it still points to THIS room — the
  // user might have already joined a different one (room-hop case).
  if (userToRoom.get(userId) === room.code) {
    userToRoom.delete(userId);
  }
  // If there's a pending battle timer and nobody is left, kill it.
  if (Object.keys(room.players).length === 0) {
    if (room.timer) { clearInterval(room.timer); room.timer = null; }
    // Boot any spectators so they don't get stranded on a deleted room.
    for (const s of room.spectators.values()) {
      if (io && s.socketId) {
        io.sockets.sockets.get(s.socketId)?.leave(room.code);
        io.sockets.sockets.get(s.socketId)?.emit('spectateEnded', { code: room.code });
      }
      userToSpectateRoom.delete(s.id);
    }
    rooms.delete(room.code);
    return;
  }
  // Otherwise let the remaining player know someone left.
  broadcast(io, room);
}



function generateCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 — easier to read aloud
  let code;
  do {
    code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
  } while (rooms.has(code));
  return code;
}

function newRoom({ ranked = false, isPrivate = true } = {}) {
  const code = generateCode();
  const room = {
    code,
    phase: PHASE.LOBBY,
    ranked,
    isPrivate,
    createdAt: Date.now(),
    seed: Math.floor(Math.random() * 0x7fffffff),
    kit: null,           // computed when battle starts
    players: {},         // userId → { id, username, ready, status, beat, voted, socketId, disconnectedAt }
    spectators: new Map(), // userId → { id, username, socketId, voted }
    battleEndsAt: null,
    votingEndsAt: null,
    timer: null,
    voteCounts: { A: 0, B: 0 },
    playerOrder: [],     // [userIdA, userIdB] — A is first to play during playback
    result: null,
  };
  rooms.set(code, room);
  return room;
}

export function getRoom(code) {
  return rooms.get(code) || null;
}

export function getRoomForUser(userId) {
  const code = userToRoom.get(userId);
  return code ? rooms.get(code) : null;
}

// ────────────────────────────────────────────────────────────────────────────
// Snapshot — what we send to clients. Strips internal stuff like timer handles.
// ────────────────────────────────────────────────────────────────────────────

function snapshot(room, viewerId = null) {
  const players = Object.values(room.players).map(p => ({
    id: p.id,
    username: p.username,
    ready: p.ready,
    status: p.status,             // 'editing' | 'submitted' | 'disconnected'
    voted: !!p.voted,
    isYou: p.id === viewerId,
  }));
  // During voting we keep beat ownership hidden by design — both beats are
  // anonymized as A and B until the result phase.
  const reveal = room.phase === PHASE.RESULT;
  const isSpectator = !room.players[viewerId] && room.spectators?.has(viewerId);
  return {
    code: room.code,
    phase: room.phase,
    ranked: room.ranked,
    isPrivate: room.isPrivate,
    seed: room.seed,
    // Kit is only relevant to players inside the editor. Spectators get it
    // too (for display purposes during PLAYBACK so they know what palette
    // the players were working with) but only after BATTLE ends.
    kit: (isSpectator && room.phase === PHASE.BATTLE) ? null : room.kit,
    players,
    playerCount: players.length,
    spectatorCount: room.spectators ? room.spectators.size : 0,
    isSpectator,
    battleSecondsLeft: room.battleEndsAt
      ? Math.max(0, Math.ceil((room.battleEndsAt - Date.now()) / 1000))
      : null,
    votingSecondsLeft: room.votingEndsAt
      ? Math.max(0, Math.ceil((room.votingEndsAt - Date.now()) / 1000))
      : null,
    // Expose the live vote tally during VOTING as well as the final RESULT,
    // so spectators see the count climb as votes come in.
    voteCounts: (room.phase === PHASE.VOTING || room.phase === PHASE.RESULT)
      ? { ...room.voteCounts } : null,
    playback: room.phase === PHASE.PLAYBACK || room.phase === PHASE.VOTING
      ? {
          beats: {
            A: room.players[room.playerOrder[0]]?.beat || null,
            B: room.players[room.playerOrder[1]]?.beat || null,
          },
          // During VOTING, tell each player viewer which letter is THEIR own
          // beat. We don't reveal the other player's identity (that happens
          // only at RESULT phase via `ownership`). Without this the client
          // can't disable the self-vote button locally and has to rely on
          // the server rejecting "you cannot vote for yourself", which
          // looks like a broken UI.
          youAre: (room.phase === PHASE.VOTING && viewerId)
            ? (viewerId === room.playerOrder[0] ? 'A'
              : viewerId === room.playerOrder[1] ? 'B' : null)
            : null,
          ownership: reveal ? {
            A: room.players[room.playerOrder[0]]?.username,
            B: room.players[room.playerOrder[1]]?.username,
          } : null,
        }
      : null,
    result: room.result,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Public actions (called from socket handlers)
// ────────────────────────────────────────────────────────────────────────────

export function createPrivateRoom(io, user, { ranked = false } = {}, socketId = null) {
  const room = newRoom({ ranked, isPrivate: true });
  joinRoom(io, room, user, socketId);
  return room;
}

export function joinByCode(io, user, code, socketId = null) {
  const room = rooms.get(String(code || '').trim().toUpperCase());
  if (!room) return { error: 'Room not found' };
  if (Object.keys(room.players).length >= 4 && !room.players[user.id]) {
    return { error: 'Room is full' };
  }
  joinRoom(io, room, user, socketId);
  return { room };
}

// Match a user against the quick-battle queue.
//
// `socketId` is the joining user's current socket. We need it for two reasons:
//   (a) so when we DO match this user, their socket joins the room channel.
//   (b) so when we QUEUE this user, we remember their socket — and when a
//       future caller matches against them, we can join that queued user's
//       socket to the room as well. Without (b), the first-queued player
//       never receives the room broadcast and looks stuck.
export function quickBattle(io, user, socketId) {
  // Drop any stale entry for this user (re-clicked Quick Battle, reconnected).
  quickBattleQueue = quickBattleQueue.filter(e => e.userId !== user.id);
  // Match with the oldest waiting player if any.
  if (quickBattleQueue.length > 0) {
    const opponent = quickBattleQueue.shift();
    const opponentUser = store.getUser(opponent.userId);
    if (!opponentUser) return quickBattle(io, user, socketId); // their account vanished, retry
    const room = newRoom({ ranked: true, isPrivate: false });
    // Join the queued opponent first (passing their stored socketId), then
    // the joining user. Each joinRoom() calls broadcast() at the end, so by
    // the time the second joinRoom completes, both sockets are in the room
    // channel and both clients receive the full snapshot.
    joinRoom(io, room, opponentUser, opponent.socketId);
    joinRoom(io, room, user, socketId);
    return { room };
  }
  quickBattleQueue.push({ userId: user.id, socketId, joinedAt: Date.now() });
  return { queued: true };
}

export function cancelQuickBattle(userId) {
  quickBattleQueue = quickBattleQueue.filter(e => e.userId !== userId);
}

function joinRoom(io, room, user, socketId = null) {
  // If this user is already in a DIFFERENT room (room-hop / left lobby then
  // created a new one before the 30s disconnect grace expired), evict them
  // from the old one cleanly first. Without this, the old room still has
  // them as 'disconnected' and the user is logically in two rooms at once.
  const priorCode = userToRoom.get(user.id);
  if (priorCode && priorCode !== room.code) {
    const priorRoom = rooms.get(priorCode);
    if (priorRoom) leaveRoomFully(io, priorRoom, user.id);
  }

  // Reconnect path: player already in this room.
  if (room.players[user.id]) {
    const p = room.players[user.id];
    p.disconnectedAt = null;
    p.status = p.beat ? 'submitted' : 'editing';
    if (socketId) p.socketId = socketId;
  } else {
    room.players[user.id] = {
      id: user.id,
      username: user.username,
      ready: false,
      status: 'editing',
      beat: null,
      voted: null,
      socketId,
      disconnectedAt: null,
    };
  }
  userToRoom.set(user.id, room.code);
  if (io && socketId) {
    io.sockets.sockets.get(socketId)?.join(room.code);
  }
  broadcast(io, room);
}

export function attachSocket(io, room, userId, socketId) {
  if (!room.players[userId]) return;
  const player = room.players[userId];
  // If they had a previous socket (e.g. another tab), pull that one out of
  // the room channel so it stops receiving broadcasts. Without this, two
  // tabs from the same user both listen to room events and one of them
  // becomes a "ghost" pointer when the other tab closes.
  if (player.socketId && player.socketId !== socketId) {
    io.sockets.sockets.get(player.socketId)?.leave(room.code);
  }
  player.socketId = socketId;
  player.disconnectedAt = null;   // they're back — cancel the grace forfeit
  if (player.status === 'disconnected') {
    player.status = player.beat ? 'submitted' : 'editing';
  }
  io.sockets.sockets.get(socketId)?.join(room.code);
  // Push the current state so the reconnecting client doesn't sit on a
  // blank screen waiting for the next event. This was the root of the
  // "refresh in lobby → no UI" bug.
  io.sockets.sockets.get(socketId)?.emit('room', snapshot(room, userId));
}

export function setReady(io, room, userId, ready) {
  const p = room.players[userId];
  if (!p) return;
  p.ready = ready;
  // Start once at least 2 players are ready in a lobby up to 4 players.
  const all = Object.values(room.players);
  const readyCount = all.filter(x => x.ready).length;
  if (room.phase === PHASE.LOBBY && all.length >= 2 && readyCount >= 2) {
    startBattle(io, room);
  } else {
    broadcast(io, room);
  }
}

function startBattle(io, room) {
  room.phase = PHASE.BATTLE;
  room.kit = generateKit(room.seed, KIT_COMPOSITION);
  room.battleEndsAt = Date.now() + BATTLE_SECONDS * 1000;
  room.playerOrder = Object.keys(room.players);
  // Tick once a second so clients get a server-authoritative countdown
  // (clients also run a local interpolation, but this is the truth).
  if (room.timer) clearInterval(room.timer);
  room.timer = setInterval(() => {
    if (Date.now() >= room.battleEndsAt) {
      clearInterval(room.timer);
      room.timer = null;
      lockSubmissions(io, room);
    } else {
      // Lightweight tick — only emits the time, full snapshot is heavier.
      io.to(room.code).emit('tick', {
        battleSecondsLeft: Math.max(0, Math.ceil((room.battleEndsAt - Date.now()) / 1000)),
      });
    }
  }, 1000);
  broadcast(io, room);
}

export function submitBeat(io, room, userId, beat) {
  if (room.phase !== PHASE.BATTLE) return { error: 'Not in battle phase' };
  const p = room.players[userId];
  if (!p) return { error: 'Not in room' };
  // Trust but bound — clamp obviously broken data.
  if (!beat || !Array.isArray(beat.tracks)) return { error: 'Invalid beat' };
  p.beat = beat;
  p.status = 'submitted';
  // Early-end: if both players submitted, skip ahead to playback.
  const all = Object.values(room.players);
  if (all.length === 2 && all.every(x => x.beat)) {
    if (room.timer) { clearInterval(room.timer); room.timer = null; }
    lockSubmissions(io, room);
  } else {
    broadcast(io, room);
  }
  return { ok: true };
}

export function updateStatus(io, room, userId, status) {
  const p = room.players[userId];
  if (!p) return;
  p.status = status;
  broadcast(io, room);
}

function lockSubmissions(io, room) {
  // Anyone who didn't submit gets an empty beat — they forfeit by silence.
  for (const p of Object.values(room.players)) {
    if (!p.beat) {
      p.beat = { bpm: 140, bars: 4, tracks: [], effects: {} };
      p.status = 'submitted';
    }
  }
  room.phase = PHASE.PLAYBACK;
  room.battleEndsAt = null;
  broadcast(io, room);

  // Compute the actual playback window from the submitted beats. Each beat
  // runs for (bars * 4 * 60 / bpm) seconds. Add a small gap between A and B
  // (matches the client's 0.9s gap and intro animations) and a safety margin.
  //
  // Before this fix, a hardcoded 35s window truncated long beats — a 64-bar
  // beat at 60 BPM is 256s per beat = nearly 9 minutes total, and the server
  // would yank everyone into VOTING after 35s, ending playback prematurely.
  const beatA = room.players[room.playerOrder[0]]?.beat;
  const beatB = room.players[room.playerOrder[1]]?.beat;
  const seconds = (beat) =>
    beat?.bpm > 0 ? (beat.bars * 4 * 60) / beat.bpm : 0;
  const playbackSec =
    Math.max(2, seconds(beatA)) +   // beat A duration (or min 2s if empty)
    1.2 +                            // intro + inter-beat gap
    Math.max(2, seconds(beatB)) +
    3;                               // generous safety tail
  // Cap so a misbehaving client can't make us wait forever.
  const waitMs = Math.min(playbackSec * 1000, 11 * 60 * 1000);

  // Track the timeout id so we can cancel it from leaveRoomNow/disconnect.
  room.lockTimeout = setTimeout(() => {
    room.lockTimeout = null;
    openVoting(io, room);
  }, waitMs);
}

function openVoting(io, room) {
  // The room might have been deleted (last player left during PLAYBACK).
  // The lockSubmissions setTimeout closure still holds a reference to the
  // old room object — without this check we'd start a setInterval that
  // emits events to a channel with no listeners and never stops.
  if (!rooms.has(room.code)) return;
  if (room.phase !== PHASE.PLAYBACK) return;
  room.phase = PHASE.VOTING;
  room.votingEndsAt = Date.now() + VOTING_SECONDS * 1000;
  broadcast(io, room);
  if (room.timer) clearInterval(room.timer);
  room.timer = setInterval(() => {
    // Defensive: if the room disappears mid-voting, stop the timer.
    if (!rooms.has(room.code)) {
      clearInterval(room.timer);
      room.timer = null;
      return;
    }
    if (Date.now() >= room.votingEndsAt) {
      clearInterval(room.timer);
      room.timer = null;
      finalizeVotes(io, room);
    } else {
      io.to(room.code).emit('tick', {
        votingSecondsLeft: Math.max(0, Math.ceil((room.votingEndsAt - Date.now()) / 1000)),
      });
    }
  }, 1000);
}

export function castVote(io, room, userId, choice) {
  if (room.phase !== PHASE.VOTING) return { error: 'Voting closed' };
  if (choice !== 'A' && choice !== 'B') return { error: 'Bad choice' };
  const p = room.players[userId];
  const s = room.spectators.get(userId);
  if (!p && !s) return { error: 'You are not in this match' };

  // Players cannot vote for themselves — A is playerOrder[0], B is [1].
  const youAre = p
    ? (userId === room.playerOrder[0] ? 'A' : userId === room.playerOrder[1] ? 'B' : null)
    : null;
  if (youAre && youAre === choice) return { error: 'You cannot vote for yourself' };

  // One vote per user (player OR spectator), no changes.
  if (p && p.voted) return { error: 'Already voted' };
  if (s && s.voted) return { error: 'Already voted' };
  if (p) p.voted = choice;
  if (s) s.voted = choice;
  room.voteCounts[choice]++;

  // Don't auto-finalize on player votes alone anymore — spectators get to
  // weigh in until the timer runs out. Just broadcast the updated tally so
  // the count climbs live on everyone's screen.
  broadcast(io, room);
  return { ok: true };
}

function finalizeVotes(io, room) {
  const { A, B } = room.voteCounts;
  const userA = room.playerOrder[0];
  const userB = room.playerOrder[1];
  const beatA = room.players[userA]?.beat;
  const beatB = room.players[userB]?.beat;

  // Compute algorithmic scores for BOTH beats up front. We always include
  // them in the result payload (so the client can show "judged on
  // musicality" when applicable), but they only DETERMINE the winner when
  // human votes are tied.
  const scoreA_alg = scoreBeat(beatA);
  const scoreB_alg = scoreBeat(beatB);

  // Tie-breaking rules:
  //   1. If human votes are decisive → human votes pick the winner.
  //   2. If votes are tied (which is GUARANTEED in 1v1 without spectators
  //      because players can't vote for themselves), the algorithmic
  //      scorer breaks the tie. The whole point: avoid the mathematical
  //      always-DRAW outcome that 1v1 voting locks us into.
  //   3. If even the algorithm scores are exactly equal, declare a real
  //      draw. Extremely rare in practice — score has ~150 distinct
  //      values across reasonable beats.
  let winner;
  let decidedBy;
  if (A > B) {
    winner = 'A';
    decidedBy = 'votes';
  } else if (B > A) {
    winner = 'B';
    decidedBy = 'votes';
  } else if (scoreA_alg.score !== scoreB_alg.score) {
    winner = scoreA_alg.score > scoreB_alg.score ? 'A' : 'B';
    decidedBy = 'algorithm';
  } else {
    winner = 'DRAW';
    decidedBy = 'tied';
  }

  const ratingA = store.getUser(userA)?.rating ?? 1000;
  const ratingB = store.getUser(userB)?.rating ?? 1000;
  const gamesA = store.getUser(userA)?.games ?? 0;
  const gamesB = store.getUser(userB)?.games ?? 0;

  let eloChange = null;
  if (room.ranked && winner !== 'DRAW') {
    const scoreA = winner === 'A' ? 1 : 0;
    eloChange = applyElo(ratingA, ratingB, scoreA, gamesA, gamesB);
  } else if (room.ranked && winner === 'DRAW') {
    eloChange = applyElo(ratingA, ratingB, 0.5, gamesA, gamesB);
  }

  store.recordMatch({
    code: room.code,
    ranked: room.ranked,
    playerA: userA,
    playerB: userB,
    winner,
    voteCounts: { ...room.voteCounts },
    decidedBy,
    newRatingA: eloChange?.newA,
    newRatingB: eloChange?.newB,
  });

  room.phase = PHASE.RESULT;
  room.votingEndsAt = null;
  room.result = {
    winner, // 'A' | 'B' | 'DRAW'
    decidedBy,                 // 'votes' | 'algorithm' | 'tied'
    voteCounts: { ...room.voteCounts },
    // Expose the score breakdowns so the result screen can show which
    // dimensions each beat scored well on (rhythm, harmony, etc).
    algorithmScores: {
      A: scoreA_alg,
      B: scoreB_alg,
    },
    winnerUsername: winner === 'A' ? room.players[userA]?.username
                  : winner === 'B' ? room.players[userB]?.username
                  : null,
    eloChange,
  };
  broadcast(io, room);
}

// Rematch resets the room back to lobby with the same players.
export function rematch(io, room) {
  if (room.phase !== PHASE.RESULT) return;
  // Clear any lingering timers/timeouts from the previous round.
  if (room.timer) { clearInterval(room.timer); room.timer = null; }
  if (room.lockTimeout) { clearTimeout(room.lockTimeout); room.lockTimeout = null; }
  room.phase = PHASE.LOBBY;
  room.seed = Math.floor(Math.random() * 0x7fffffff);
  room.kit = null;
  room.battleEndsAt = null;
  room.votingEndsAt = null;
  room.voteCounts = { A: 0, B: 0 };
  room.playerOrder = [];
  room.result = null;
  for (const p of Object.values(room.players)) {
    p.ready = false;
    p.status = 'editing';
    p.beat = null;
    p.voted = null;
  }
  // Spectators from the prior round had their `voted` set — clear it so
  // they can vote in the new round. Otherwise castVote rejects them.
  for (const s of room.spectators.values()) {
    s.voted = null;
  }
  broadcast(io, room);
}

// ────────────────────────────────────────────────────────────────────────────
// Disconnect handling — give them RECONNECT_GRACE_SECONDS to come back.
// ────────────────────────────────────────────────────────────────────────────

// Explicit "Leave" button — user is choosing to exit, not a connection drop.
// In LOBBY: clean eviction, no grace. In any other phase: same as a
// disconnect path that immediately evicts (RESULT/PLAYBACK/VOTING) or
// counts as a forfeit (BATTLE). The point: a deliberate leave never leaves
// userToRoom pointing at the room they just left, which is what caused the
// "snaps you back to the lobby" bug.
export function leaveRoomNow(io, userId) {
  cancelQuickBattle(userId);

  // Spectator? Easy — just leave.
  const spectateRoom = getSpectateRoomForUser(userId);
  if (spectateRoom && !spectateRoom.players[userId]) {
    leaveSpectate(io, userId, spectateRoom);
    return;
  }

  const room = getRoomForUser(userId);
  if (!room) return;

  // Cancel any pending playback-lock timeout (otherwise it'd later fire
  // openVoting on a settled-by-forfeit room).
  if (room.lockTimeout) { clearTimeout(room.lockTimeout); room.lockTimeout = null; }

  // In BATTLE, an explicit leave with an opponent present forfeits the match.
  if (room.phase === PHASE.BATTLE) {
    const other = Object.values(room.players).find(x => x.id !== userId);
    if (other) {
      // The remaining player wins. Compute ELO if ranked.
      const ratingWin  = store.getUser(other.id)?.rating ?? 1000;
      const ratingLose = store.getUser(userId)?.rating ?? 1000;
      const gamesWin   = store.getUser(other.id)?.games ?? 0;
      const gamesLose  = store.getUser(userId)?.games ?? 0;
      const eloChange = room.ranked
        ? applyElo(ratingWin, ratingLose, 1, gamesWin, gamesLose)
        : null;

      room.playerOrder = [other.id, userId];
      // We don't synthesize a fake vote tally — the result is a forfeit.
      // The client renders this via the `forfeit` flag, not the counts.
      room.voteCounts = { A: 0, B: 0 };
      room.players[userId].beat ||= { bpm: 140, bars: 4, tracks: [], effects: {} };
      room.players[other.id].beat ||= { bpm: 140, bars: 4, tracks: [], effects: {} };
      room.phase = PHASE.RESULT;
      room.result = {
        winner: 'A',
        voteCounts: { A: 0, B: 0 },
        winnerUsername: other.username,
        forfeit: true,
        eloChange,
      };
      if (room.timer) { clearInterval(room.timer); room.timer = null; }
      store.recordMatch({
        code: room.code,
        ranked: room.ranked,
        playerA: other.id,
        playerB: userId,
        winner: 'A',
        forfeit: true,
        newRatingA: eloChange?.newA,
        newRatingB: eloChange?.newB,
      });
      // Now evict the leaver fully so they go back to home.
      leaveRoomFully(io, room, userId);
      return;
    }
    // No opponent in BATTLE (shouldn't happen, but defensive) — just leave.
    leaveRoomFully(io, room, userId);
    return;
  }

  // Any other phase (LOBBY, PLAYBACK, VOTING, RESULT): just fully evict.
  leaveRoomFully(io, room, userId);
}

export function handleDisconnect(io, userId) {
  cancelQuickBattle(userId);

  // If they were a spectator (and not a player), just remove them cleanly —
  // no reconnect grace, nothing to forfeit.
  const spectateRoom = getSpectateRoomForUser(userId);
  if (spectateRoom && !spectateRoom.players[userId]) {
    leaveSpectate(io, userId, spectateRoom);
    return;
  }

  const room = getRoomForUser(userId);
  if (!room) return;
  const p = room.players[userId];
  if (!p) return;

  // Socket closed during RESULT/PLAYBACK/VOTING: game is settled or settling,
  // just remove them. There's nothing to "come back to."
  if (
    room.phase === PHASE.RESULT ||
    room.phase === PHASE.PLAYBACK ||
    room.phase === PHASE.VOTING
  ) {
    leaveRoomFully(io, room, userId);
    return;
  }

  // Otherwise (LOBBY or BATTLE) — keep the slot alive and give them the
  // grace window to reconnect. If they don't, forfeit at the end.
  p.status = 'disconnected';
  p.disconnectedAt = Date.now();
  broadcast(io, room);

  setTimeout(() => {
    const stillRoom = rooms.get(room.code);
    if (!stillRoom) return;
    const stillPlayer = stillRoom.players[userId];
    if (!stillPlayer) return;
    if (!stillPlayer.disconnectedAt) return; // they came back
    if (Date.now() - stillPlayer.disconnectedAt < RECONNECT_GRACE_SECONDS * 1000) return;
    // They didn't return — auto-forfeit if a battle is in flight.
    if (stillRoom.phase === PHASE.BATTLE || stillRoom.phase === PHASE.LOBBY) {
      // Award the win to the other player if present.
      const other = Object.values(stillRoom.players).find(x => x.id !== userId);
      if (other && stillRoom.phase === PHASE.BATTLE) {
        // Cancel any pending lock timeout.
        if (stillRoom.lockTimeout) { clearTimeout(stillRoom.lockTimeout); stillRoom.lockTimeout = null; }

        const ratingWin  = store.getUser(other.id)?.rating ?? 1000;
        const ratingLose = store.getUser(userId)?.rating ?? 1000;
        const gamesWin   = store.getUser(other.id)?.games ?? 0;
        const gamesLose  = store.getUser(userId)?.games ?? 0;
        const eloChange = stillRoom.ranked
          ? applyElo(ratingWin, ratingLose, 1, gamesWin, gamesLose)
          : null;

        stillRoom.playerOrder = [other.id, userId];
        stillRoom.voteCounts = { A: 0, B: 0 };
        stillRoom.players[userId].beat ||= { bpm: 140, bars: 4, tracks: [], effects: {} };
        stillRoom.players[other.id].beat ||= { bpm: 140, bars: 4, tracks: [], effects: {} };
        stillRoom.phase = PHASE.RESULT;
        stillRoom.result = {
          winner: 'A',
          voteCounts: { A: 0, B: 0 },
          winnerUsername: other.username,
          forfeit: true,
          eloChange,
        };
        if (stillRoom.timer) { clearInterval(stillRoom.timer); stillRoom.timer = null; }
        store.recordMatch({
          code: stillRoom.code,
          ranked: stillRoom.ranked,
          playerA: other.id,
          playerB: userId,
          winner: 'A',
          forfeit: true,
          newRatingA: eloChange?.newA,
          newRatingB: eloChange?.newB,
        });
        broadcast(io, stillRoom);
      } else {
        // Lobby phase with nobody else, or the leaver was already alone —
        // fully evict so the room can be cleaned up.
        leaveRoomFully(io, stillRoom, userId);
      }
    }
  }, RECONNECT_GRACE_SECONDS * 1000 + 100);
}

// ────────────────────────────────────────────────────────────────────────────
// Broadcast helper
// ────────────────────────────────────────────────────────────────────────────

function broadcast(io, room) {
  if (!io) return;
  // Personalize per-socket so each player sees `isYou` correctly.
  for (const p of Object.values(room.players)) {
    if (!p.socketId) continue;
    const sock = io.sockets.sockets.get(p.socketId);
    if (sock) sock.emit('room', snapshot(room, p.id));
  }
  // Also push the snapshot to every spectator. Their snapshot will have
  // isSpectator=true and the kit hidden during BATTLE phase.
  for (const s of room.spectators.values()) {
    if (!s.socketId) continue;
    const sock = io.sockets.sockets.get(s.socketId);
    if (sock) sock.emit('room', snapshot(room, s.id));
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Spectator API
// ────────────────────────────────────────────────────────────────────────────

// Return a public list of active matches that anyone is allowed to spectate.
// Excludes:
//   - Private rooms (invite-only by design)
//   - Rooms in LOBBY with fewer than 2 players (nothing to watch yet)
//   - Rooms in RESULT phase (the match is over)
// Returns lightweight info — full state is only sent when a viewer actually
// joins as a spectator. Keeps this endpoint cheap and cacheable.
export function listPublicMatches() {
  const out = [];
  for (const room of rooms.values()) {
    if (room.isPrivate) continue;
    if (room.phase === PHASE.RESULT) continue;
    const playerList = Object.values(room.players);
    if (playerList.length < 2 && room.phase === PHASE.LOBBY) continue;
    out.push({
      code: room.code,
      phase: room.phase,
      ranked: room.ranked,
      players: playerList.map(p => ({ username: p.username, status: p.status })),
      spectatorCount: room.spectators.size,
      battleSecondsLeft: room.battleEndsAt
        ? Math.max(0, Math.ceil((room.battleEndsAt - Date.now()) / 1000))
        : null,
      createdAt: room.createdAt,
    });
  }
  // Newest first.
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

// Add a spectator to a room. Returns { error } or { room }.
// Rules:
//   - User can't spectate if they're currently playing in some room.
//   - User can't spectate a private room.
//   - User can't spectate a finished match.
//   - Idempotent if they're already a spectator here (just refresh socket).
export function spectateRoom(io, user, code, socketId) {
  const room = rooms.get(String(code || '').trim().toUpperCase());
  if (!room) return { error: 'Match not found' };
  if (room.isPrivate) return { error: 'This match is private' };
  if (room.phase === PHASE.RESULT) return { error: 'Match is over' };
  if (room.players[user.id]) return { error: 'You are a player in this match' };

  // Evict from any prior spectator slot first (room-hop).
  const priorCode = userToSpectateRoom.get(user.id);
  if (priorCode && priorCode !== room.code) {
    const priorRoom = rooms.get(priorCode);
    if (priorRoom) leaveSpectate(io, user.id, priorRoom);
  }

  // Add (or refresh) spectator record.
  room.spectators.set(user.id, {
    id: user.id,
    username: user.username,
    socketId,
    voted: null,
  });
  userToSpectateRoom.set(user.id, room.code);
  if (io && socketId) {
    io.sockets.sockets.get(socketId)?.join(room.code);
  }
  broadcast(io, room);
  return { room };
}

// Remove a spectator from a room. `room` is optional (we'll look it up).
export function leaveSpectate(io, userId, room = null) {
  if (!room) {
    const code = userToSpectateRoom.get(userId);
    if (!code) return;
    room = rooms.get(code);
    if (!room) {
      userToSpectateRoom.delete(userId);
      return;
    }
  }
  const s = room.spectators.get(userId);
  if (s && io && s.socketId) {
    io.sockets.sockets.get(s.socketId)?.leave(room.code);
  }
  // If they voted, decrement the tally so a leaver doesn't "lock in" a vote
  // they can't speak for anymore. Only valid during VOTING.
  if (s?.voted && room.phase === PHASE.VOTING && room.voteCounts[s.voted] > 0) {
    room.voteCounts[s.voted]--;
  }
  room.spectators.delete(userId);
  if (userToSpectateRoom.get(userId) === room.code) {
    userToSpectateRoom.delete(userId);
  }
  broadcast(io, room);
}

export function getSpectateRoomForUser(userId) {
  const code = userToSpectateRoom.get(userId);
  return code ? rooms.get(code) : null;
}

export { snapshot };
