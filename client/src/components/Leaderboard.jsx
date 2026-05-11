import { useEffect, useState } from 'react';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export default function Leaderboard({ onBack }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${SERVER_URL}/api/leaderboard`)
      .then(r => r.json())
      .then(d => setEntries(d.entries || []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="leaderboard">
      <button className="btn small ghost back" onClick={onBack}>← Back</button>
      <h2>Leaderboard</h2>
      {loading && <p className="muted">Loading…</p>}
      {!loading && entries.length === 0 && (
        <p className="muted">No matches played yet. Be the first.</p>
      )}
      {entries.length > 0 && (
        <table className="lb-table">
          <thead>
            <tr>
              <th>#</th><th>Player</th><th>Rating</th>
              <th>W</th><th>L</th><th>Win%</th><th>Streak</th><th>Games</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.username}>
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
