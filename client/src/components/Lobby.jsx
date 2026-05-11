import { useState } from 'react';
import { socket } from '../socket.js';

export default function Lobby({ room, onLeave }) {
  const [copied, setCopied] = useState(false);
  const you = room.players.find(p => p.isYou);
  const opp = room.players.find(p => !p.isYou);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* user can read it */ }
  };

  const toggleReady = () => {
    socket.emit('ready', { ready: !you?.ready });
  };

  return (
    <div className="lobby">
      <button className="btn small ghost back" onClick={onLeave}>← Leave</button>
      <h2>Room <span className="code">{room.code}</span>
        <button className="btn small" onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
      </h2>
      <p className="muted">{room.ranked ? 'Ranked battle — affects your rating' : 'Casual battle — no rating change'}</p>

      <div className="lobby-slots">
        <PlayerSlot player={you} you />
        <span className="vs">VS</span>
        <PlayerSlot player={opp} />
      </div>

      <div className="lobby-actions">
        <button
          className={'btn big ' + (you?.ready ? 'primary' : '')}
          onClick={toggleReady}
        >
          {you?.ready ? '✓ Ready — click to cancel' : 'Ready up'}
        </button>
        {!opp && <p className="muted">Share the code <b>{room.code}</b> to invite a friend.</p>}
        {opp && !opp.ready && <p className="muted">Waiting for {opp.username}…</p>}
        {opp && opp.ready && you?.ready && <p className="muted">Starting battle…</p>}
      </div>
    </div>
  );
}

function PlayerSlot({ player, you }) {
  if (!player) {
    return (
      <div className="slot empty">
        <div className="avatar">?</div>
        <div className="slot-name">Empty slot</div>
        <div className="slot-status">Waiting…</div>
      </div>
    );
  }
  return (
    <div className={'slot ' + (player.ready ? 'ready' : '')}>
      <div className="avatar">{(player.username || '?').charAt(0).toUpperCase()}</div>
      <div className="slot-name">{player.username}{you ? ' (you)' : ''}</div>
      <div className="slot-status">{player.ready ? 'Ready' : 'Not ready'}</div>
    </div>
  );
}
