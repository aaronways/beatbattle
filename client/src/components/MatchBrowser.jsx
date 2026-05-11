import { useEffect, useState, useCallback } from 'react';
import { call } from '../socket.js';
import { PHASE } from '../../../shared/gameRules.js';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

// Auto-refresh interval. 4s feels lively without hammering the server. Tweak
// up if the listing gets crowded enough that traffic matters.
const REFRESH_MS = 4000;

const PHASE_LABEL = {
  [PHASE.LOBBY]:    { text: 'Lobby',    cls: 'phase-lobby' },
  [PHASE.BATTLE]:   { text: 'Battling', cls: 'phase-battle' },
  [PHASE.PLAYBACK]: { text: 'Playback', cls: 'phase-playback' },
  [PHASE.VOTING]:   { text: 'Voting',   cls: 'phase-voting' },
  [PHASE.RESULT]:   { text: 'Done',     cls: 'phase-result' },
};

export default function MatchBrowser({ onBack, onEnterSpectate }) {
  const [matches, setMatches] = useState(null);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(null);   // code currently being joined

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/matches`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMatches(data.matches || []);
      setError('');
    } catch (e) {
      setError(e.message || 'Could not load matches');
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const spectate = async (code) => {
    setJoining(code);
    setError('');
    const res = await call('spectate', { code });
    setJoining(null);
    if (res?.error) {
      setError(res.error);
      // The match might have just ended — refresh the list so it disappears.
      refresh();
      return;
    }
    onEnterSpectate?.(code);
  };

  return (
    <div className="match-browser">
      <header className="mb-header">
        <button className="btn small ghost" onClick={onBack}>← Back</button>
        <h2>Live Matches</h2>
        <button className="btn small" onClick={refresh}>↻ Refresh</button>
      </header>

      {error && <div className="error">{error}</div>}

      {matches === null && <p className="muted">Loading…</p>}

      {matches?.length === 0 && (
        <div className="mb-empty">
          <p>No public matches right now.</p>
          <p className="muted">When two players Quick Battle, they'll show up here.</p>
        </div>
      )}

      <div className="match-list">
        {matches?.map(m => {
          const label = PHASE_LABEL[m.phase] || { text: m.phase, cls: '' };
          const [a, b] = m.players;
          return (
            <div key={m.code} className="match-card">
              <div className="match-vs">
                <div className="match-player">{a?.username || '—'}</div>
                <div className="match-vs-sep">vs</div>
                <div className="match-player">{b?.username || '—'}</div>
              </div>

              <div className="match-meta">
                <span className={'phase-pill ' + label.cls}>{label.text}</span>
                {m.ranked && <span className="match-tag ranked">RANKED</span>}
                {!m.ranked && <span className="match-tag">CASUAL</span>}
                {m.battleSecondsLeft != null && m.phase === PHASE.BATTLE && (
                  <span className="match-tag">⏱ {formatTime(m.battleSecondsLeft)}</span>
                )}
                {m.spectatorCount > 0 && (
                  <span className="match-tag">👁 {m.spectatorCount}</span>
                )}
              </div>

              <button
                className="btn primary"
                onClick={() => spectate(m.code)}
                disabled={joining === m.code}
              >
                {joining === m.code ? 'Joining…' : 'Watch'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
