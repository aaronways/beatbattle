// In-memory store. For an MVP we keep everything in process memory; in
// production you'd swap these maps for SQLite / Postgres / Redis. The API
// shape is intentionally narrow so that's a small change.

const users = new Map();      // userId → { id, username, rating, wins, losses, games, streak }
const matches = [];           // append-only match history

let userCounter = 0;

export function getOrCreateUser({ id, username }) {
  if (id && users.has(id)) {
    const u = users.get(id);
    if (username) u.username = username;
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
  return user;
}

export function getUser(id) {
  return users.get(id) || null;
}

export function recordMatch(match) {
  matches.push({ ...match, ts: Date.now() });
  // Apply outcome to user records.
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
}

export function leaderboard(limit = 50) {
  return Array.from(users.values())
    .filter(u => u.games > 0)
    .sort((x, y) => y.rating - x.rating)
    .slice(0, limit)
    .map((u, i) => ({
      rank: i + 1,
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
