// Persistent store. Keeps users + match history in memory for fast reads,
// but flushes the whole state to a JSON file on disk after every mutation
// (debounced 1s to coalesce bursts). On boot, hydrates from that file.
//
// File location:
//   - Reads $DATA_DIR if set (Render Disk users point this at /var/data).
//   - Falls back to ./.data/store.json relative to the server directory.
//
// Render note: free-tier instances have an EPHEMERAL filesystem — files
// written at runtime DO NOT survive a redeploy/restart. To actually persist
// across restarts on Render, you need either:
//   1. A Render Disk ($1/mo) — mount it, set DATA_DIR to the mount path.
//   2. Move to a host with persistent disk (Fly volumes, etc.).
//   3. Swap this for an external DB (Postgres, Supabase, Turso).
//
// The data shape here is JSON-serializable on purpose — same file works
// for any of those swaps later. Pull JSON out, write SQL in, done.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '.data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const TMP_FILE   = path.join(DATA_DIR, 'store.json.tmp');

// In-memory state. Always the source of truth for reads. Writes update
// these, then schedule a flush.
let users = new Map();
let matches = [];
let userCounter = 0;

// Hydrate on import. Sync I/O is fine — happens once at server boot.
function load() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(STORE_FILE)) {
      // eslint-disable-next-line no-console
      console.log(`[store] no existing file at ${STORE_FILE} — starting fresh`);
      return;
    }
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data.users)) {
      for (const u of data.users) users.set(u.id, u);
    }
    if (Array.isArray(data.matches)) matches = data.matches;
    if (typeof data.userCounter === 'number') userCounter = data.userCounter;
    // eslint-disable-next-line no-console
    console.log(`[store] loaded ${users.size} users, ${matches.length} matches from ${STORE_FILE}`);
  } catch (err) {
    // If the file is corrupt, back it up and start fresh so we don't keep
    // crash-looping. The bad file is preserved for inspection.
    // eslint-disable-next-line no-console
    console.error(`[store] failed to load ${STORE_FILE}:`, err.message);
    try {
      const backup = STORE_FILE + '.corrupt.' + Date.now();
      fs.renameSync(STORE_FILE, backup);
      // eslint-disable-next-line no-console
      console.error(`[store] moved corrupt file to ${backup}`);
    } catch { /* nothing we can do */ }
  }
}

// Debounced atomic save: collect mutations for up to 1s, then write the
// whole state in one shot to a temp file and rename over the real file
// (atomic at the filesystem level — readers never see a half-written file).
let pendingTimer = null;
let saveInFlight = false;
let dirty = false;
function scheduleSave() {
  dirty = true;
  if (pendingTimer) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    flush();
  }, 1000);
}

function flush() {
  if (saveInFlight) {
    // Another flush is mid-write; just leave dirty=true so the next call
    // will re-run. We can't have two writers racing the rename.
    return;
  }
  if (!dirty) return;
  dirty = false;
  saveInFlight = true;
  const snapshot = JSON.stringify({
    version: 1,
    savedAt: Date.now(),
    userCounter,
    users: Array.from(users.values()),
    matches,
  });
  fs.writeFile(TMP_FILE, snapshot, 'utf8', (err) => {
    if (err) {
      saveInFlight = false;
      // eslint-disable-next-line no-console
      console.error('[store] write to tmp failed:', err.message);
      // Re-mark dirty so we try again on the next scheduled save.
      dirty = true;
      return;
    }
    fs.rename(TMP_FILE, STORE_FILE, (renameErr) => {
      saveInFlight = false;
      if (renameErr) {
        // eslint-disable-next-line no-console
        console.error('[store] rename failed:', renameErr.message);
        dirty = true;
        return;
      }
      // If something marked us dirty during the write, schedule another save.
      if (dirty) scheduleSave();
    });
  });
}

// On graceful shutdown (or even non-graceful when possible), force a final
// sync flush so the last second of edits doesn't get lost. SIGTERM is what
// Render and most container hosts send on redeploy.
function syncFlush() {
  if (!dirty) return;
  try {
    const snapshot = JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      userCounter,
      users: Array.from(users.values()),
      matches,
    });
    fs.writeFileSync(TMP_FILE, snapshot, 'utf8');
    fs.renameSync(TMP_FILE, STORE_FILE);
    dirty = false;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[store] sync flush failed:', err.message);
  }
}
process.on('SIGTERM', () => { syncFlush(); process.exit(0); });
process.on('SIGINT',  () => { syncFlush(); process.exit(0); });
process.on('beforeExit', syncFlush);

load();

// ────────────────────────────────────────────────────────────────────────
// Public API — same shape as before. Each mutating call schedules a save.
// ────────────────────────────────────────────────────────────────────────

export function getOrCreateUser({ id, username }) {
  if (id && users.has(id)) {
    const u = users.get(id);
    if (username) {
      if (u.username !== username) scheduleSave();
      u.username = username;
    }
    return u;
  }
  const newId = id || `u_${++userCounter}_${Date.now().toString(36)}`;
  const user = {
    id: newId,
    username: username || `Beatmaker${newId.slice(-4)}`,
    rating: 1000,
    wins: 0,
    losses: 0,
    draws: 0,
    games: 0,
    streak: 0,
    bestStreak: 0,
  };
  users.set(newId, user);
  scheduleSave();
  return user;
}

export function getUser(id) {
  return users.get(id) || null;
}

export function recordMatch(match) {
  matches.push({ ...match, ts: Date.now() });
  // Cap match log so the JSON file doesn't grow unbounded. Keep the most
  // recent 10k matches — plenty for any reasonable history view.
  if (matches.length > 10000) matches = matches.slice(-10000);

  const a = users.get(match.playerA);
  const b = users.get(match.playerB);
  if (a) {
    a.games++;
    if (match.winner === 'A') { a.wins++; a.streak = Math.max(1, a.streak + 1); }
    else if (match.winner === 'B') { a.losses++; a.streak = Math.min(0, a.streak) - 1; }
    else { a.draws++; a.streak = 0; }
    a.bestStreak = Math.max(a.bestStreak, a.streak);
    if (typeof match.newRatingA === 'number') a.rating = match.newRatingA;
  }
  if (b) {
    b.games++;
    if (match.winner === 'B') { b.wins++; b.streak = Math.max(1, b.streak + 1); }
    else if (match.winner === 'A') { b.losses++; b.streak = Math.min(0, b.streak) - 1; }
    else { b.draws++; b.streak = 0; }
    b.bestStreak = Math.max(b.bestStreak, b.streak);
    if (typeof match.newRatingB === 'number') b.rating = match.newRatingB;
  }
  scheduleSave();
}

export function leaderboard(limit = 50) {
  return Array.from(users.values())
    .filter(u => u.games > 0)
    .sort((x, y) => y.rating - x.rating)
    .slice(0, limit)
    .map((u, i) => ({
      rank: i + 1,
      id: u.id,                         // expose for React key (usernames can collide)
      username: u.username,
      rating: u.rating,
      wins: u.wins,
      losses: u.losses,
      games: u.games,
      winRate: u.games ? Math.round((u.wins / u.games) * 100) : 0,
      streak: u.streak,
    }));
}

export function recentMatches(userId, limit = 20) {
  return matches
    .filter(m => m.playerA === userId || m.playerB === userId)
    .slice(-limit)
    .reverse();
}

// Exposed for testing or admin endpoints. Not currently used by the server.
export function _storePath() { return STORE_FILE; }
