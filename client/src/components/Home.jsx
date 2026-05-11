import { useState, useEffect } from 'react';
import { call, saveUsername, socket } from '../socket.js';

export default function Home({ user, setUser, onEnterRoom, onPractice, onLeaderboard, onSpectate }) {
  const [username, setUsername] = useState(user?.username || '');
  const [joinCode, setJoinCode] = useState('');
  const [mode, setMode] = useState('idle'); // idle | queueing
  const [error, setError] = useState('');

  useEffect(() => { setUsername(user?.username || ''); }, [user]);

  const commitName = () => {
    const trimmed = username.trim().slice(0, 20);
    if (!trimmed) return;
    saveUsername(trimmed);
    setUser({ ...user, username: trimmed });
    socket.emit('hello', { userId: user.id, username: trimmed });
  };

  const create = async (ranked) => {
    setError('');
    const res = await call('createRoom', { ranked });
    if (res?.code) onEnterRoom(res.code);
    else setError(res?.error || 'Could not create room');
  };

  const join = async () => {
    setError('');
    if (!joinCode.trim()) return;
    const res = await call('joinRoom', { code: joinCode.trim().toUpperCase() });
    if (res?.code) onEnterRoom(res.code);
    else setError(res?.error || 'Could not join');
  };

  const quick = async () => {
    setError('');
    const res = await call('quickBattle', {});
    if (res?.code) {
      setMode('idle');
      onEnterRoom(res.code);
    } else if (res?.queued) {
      setMode('queueing');
    } else {
      setError(res?.error || 'Matchmaking unavailable');
    }
  };

  const cancelQuick = () => {
    socket.emit('cancelQuick');
    setMode('idle');
  };

  return (
    <div className="home">
      <header className="hero">
        <h1 className="logo">BEAT<span>BATTLE</span></h1>
        <p className="tag">10 minutes. Same sounds. One winner.</p>
      </header>

      <section className="card identity">
        <label>YOUR NAME</label>
        <div className="row">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => e.key === 'Enter' && commitName()}
            maxLength={20}
            placeholder="Pick a name"
          />
        </div>
      </section>

      {mode === 'queueing' ? (
        <section className="card queueing">
          <div className="pulse" />
          <h2>Searching for an opponent…</h2>
          <p className="muted">You'll be matched with the next player who joins.</p>
          <button className="btn ghost" onClick={cancelQuick}>Cancel</button>
        </section>
      ) : (
        <section className="grid">
          <button className="btn primary big" onClick={quick}>
            <span className="big-label">Quick Battle</span>
            <span className="small-label">Ranked · 1v1</span>
          </button>
          <button className="btn big" onClick={() => create(false)}>
            <span className="big-label">Create Private Room</span>
            <span className="small-label">Casual · invite a friend</span>
          </button>
          <div className="btn big input-card">
            <span className="big-label">Join by Code</span>
            <div className="row">
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && join()}
                placeholder="ABCDEF"
                maxLength={6}
              />
              <button className="btn small" onClick={join}>Join</button>
            </div>
          </div>
          <button className="btn big" onClick={onPractice}>
            <span className="big-label">Practice</span>
            <span className="small-label">Solo, no opponent</span>
          </button>
          <button className="btn big" onClick={onSpectate}>
            <span className="big-label">Spectate</span>
            <span className="small-label">Watch live matches</span>
          </button>
          <button className="btn big ghost" onClick={onLeaderboard}>
            <span className="big-label">Leaderboard</span>
            <span className="small-label">Top players</span>
          </button>
        </section>
      )}

      {error && <div className="error">{error}</div>}

      <footer className="foot">
        <span>Rating: <b>{user?.rating ?? 1000}</b></span>
        <span>Wins: <b>{user?.wins ?? 0}</b></span>
        <span>Losses: <b>{user?.losses ?? 0}</b></span>
      </footer>
    </div>
  );
}
