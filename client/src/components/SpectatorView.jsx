import { useEffect } from 'react';
import { socket } from '../socket.js';
import { PHASE } from '../../../shared/gameRules.js';

// What spectators see during LOBBY and BATTLE phases.
// Just status info — no editor, no kit reveal (kit is hidden during BATTLE
// so a spectator can't broadcast the random sounds to non-spectators).
export default function SpectatorView({ room, onLeave }) {
  // Gracefully exit if the room was torn down.
  useEffect(() => {
    const onEnded = ({ code }) => {
      if (code === room?.code) onLeave?.();
    };
    socket.on('spectateEnded', onEnded);
    return () => socket.off('spectateEnded', onEnded);
  }, [room?.code, onLeave]);

  const phaseLabel = room.phase === PHASE.LOBBY ? 'Waiting in lobby'
    : room.phase === PHASE.BATTLE ? 'Battle in progress'
    : room.phase;

  return (
    <div className="spectator-view">
      <header className="spec-header">
        <button className="btn small ghost" onClick={onLeave}>← Leave</button>
        <div className="spec-title">
          <span className="spec-eye">👁 SPECTATING</span>
          <span className="spec-room">Room <b>{room.code}</b></span>
          <span className={'ranked-tag ' + (room.ranked ? 'ranked' : 'casual')}>
            {room.ranked ? 'RANKED' : 'CASUAL'}
          </span>
        </div>
        <div className="spec-count">
          {room.spectatorCount > 1 ? `👁 ${room.spectatorCount} watching` : ''}
        </div>
      </header>

      <div className="spec-phase">{phaseLabel}</div>

      {room.phase === PHASE.BATTLE && room.battleSecondsLeft != null && (
        <div className="spec-timer">
          <div className="timer-label">TIME LEFT</div>
          <div className={'timer-num ' + (room.battleSecondsLeft <= 30 ? 'urgent' : '')}>
            {formatTime(room.battleSecondsLeft)}
          </div>
        </div>
      )}

      <div className="spec-players">
        {room.players.map(p => (
          <div key={p.id} className={'spec-player-card ' + (p.status || '')}>
            <div className="avatar">{(p.username || '?').charAt(0).toUpperCase()}</div>
            <div className="spec-player-name">{p.username}</div>
            <div className="spec-player-status">{statusLabel(p)}</div>
          </div>
        ))}
      </div>

      <p className="muted spec-note">
        {room.phase === PHASE.LOBBY && 'Waiting for both players to ready up…'}
        {room.phase === PHASE.BATTLE && 'Beats are hidden until playback to keep things fair.'}
      </p>
    </div>
  );
}

function statusLabel(p) {
  if (p.status === 'submitted') return '✓ Submitted';
  if (p.status === 'disconnected') return '⚠ Disconnected';
  if (p.ready) return '✓ Ready';
  return p.status === 'editing' ? 'Editing…' : 'Not ready';
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
