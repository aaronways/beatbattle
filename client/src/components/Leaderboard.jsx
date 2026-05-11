import { useEffect, useState } from 'react';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export default function Leaderboard({ onBack }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${SERVER_URL}/api/leaderboard`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => { if (!cancelled) setEntries(d.entries || []); })
      .catch(err => { if (!cancelled) setError(err.message || 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="leaderboard">
      <button className="btn small ghost back" onClick={onBack}>← Back</button>
      <h2>Leaderboard</h2>
      {loading && <p className="muted">Loading…</p>}
      {!loading && error && <div className="error">⚠ Couldn't load leaderboard: {error}</div>}
      {!loading && !error && entries.length === 0 && (
        <p className="muted">No matches played yet. Be the first.</p>
      )}
      {!loading && !error && entries.length > 0 && (
        <table className="lb-table">
          <thead>
            <tr>
              <th>#</th><th>Player</th><th>Rating</th>
              <th>W</th><th>L</th><th>Win%</th><th>Streak</th><th>Games</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              // Use the persistent user id as key — two players can share a
              // username so username-as-key would collide and lose React's
              // ability to reconcile rows correctly across refreshes.
              <tr key={e.id || e.username}>
                <td>{e.rank}</td>
                <td>{e.username}</td>
                <td><b>{e.rating}</b></td>
                <td>{e.wins}</td>
                <td>{e.losses}</td>
                <td>{e.winRate}%</td>
                <td>{e.streak > 0 ? `+${e.streak}` : e.streak}</td>
                <td>{e.games}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
