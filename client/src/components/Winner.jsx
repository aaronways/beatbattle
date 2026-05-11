import { socket } from '../socket.js';

export default function Winner({ room, onLeave }) {
  const r = room.result;
  if (!r) return null;
  const draw = r.winner === 'DRAW';
  const isSpectator = !!room.isSpectator;
  const you = room.players.find(p => p.isYou);
  const yourBeatIs = room.playback?.youAre
    || (room.playback?.ownership
      ? (you?.username === room.playback.ownership.A ? 'A' : 'B')
      : null);
  const youWon = !isSpectator && !draw && yourBeatIs === r.winner;
  const elo = r.eloChange;

  // Spectators just see neutral "Winner: X" framing.
  // Players see the binary "YOU WIN / YOU LOSE" call-out.
  const bannerText = draw
    ? 'DRAW'
    : isSpectator
      ? `WINNER: ${r.winnerUsername || r.winner}`
      : (youWon ? 'YOU WIN' : 'YOU LOSE');
  const bannerClass = draw ? 'draw'
    : isSpectator ? 'neutral'
    : (youWon ? 'win' : 'loss');

  const rematch = () => socket.emit('rematch');

  return (
    <div className="winner-screen">
      <div className={'banner ' + bannerClass}>
        {bannerText}
      </div>
      {r.forfeit && <p className="muted">Opponent forfeited by disconnecting.</p>}

      <div className="result-card">
        <h3>Vote tally</h3>
        <div className="vote-bars">
          <VoteBar label={`A · ${room.playback?.ownership?.A || '—'}`}
            count={r.voteCounts.A}
            total={r.voteCounts.A + r.voteCounts.B}
            winner={r.winner === 'A'} />
          <VoteBar label={`B · ${room.playback?.ownership?.B || '—'}`}
            count={r.voteCounts.B}
            total={r.voteCounts.A + r.voteCounts.B}
            winner={r.winner === 'B'} />
        </div>

        {elo && (
          <div className="elo-change">
            <h4>Rating change</h4>
            <div className="elo-row">
              <span>{room.playback?.ownership?.A}</span>
              <span className={elo.deltaA >= 0 ? 'plus' : 'minus'}>
                {elo.deltaA >= 0 ? '+' : ''}{elo.deltaA} → {elo.newA}
              </span>
            </div>
            <div className="elo-row">
              <span>{room.playback?.ownership?.B}</span>
              <span className={elo.deltaB >= 0 ? 'plus' : 'minus'}>
                {elo.deltaB >= 0 ? '+' : ''}{elo.deltaB} → {elo.newB}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="winner-actions">
        {!isSpectator && (
          <button className="btn primary big" onClick={rematch}>Rematch</button>
        )}
        <button className="btn big ghost" onClick={onLeave}>
          {isSpectator ? 'Back to matches' : 'Back to lobby'}
        </button>
      </div>
    </div>
  );
}

function VoteBar({ label, count, total, winner }) {
  // Empty totals render as 0% — don't divide by zero.
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className={'vote-bar-row ' + (winner ? 'winner' : '')}>
      <div className="vb-label">{label}</div>
      <div className="vb-bar">
        <div className="vb-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="vb-count">{count}</div>
    </div>
  );
}
