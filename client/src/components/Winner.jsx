import { socket } from '../socket.js';

export default function Winner({ room, onLeave }) {
  const r = room.result;
  if (!r) return null;
  const draw = r.winner === 'DRAW';
  const you = room.players.find(p => p.isYou);
  const yourBeatIs = room.playback?.ownership
    ? (you?.username === room.playback.ownership.A ? 'A' : 'B')
    : null;
  const youWon = !draw && yourBeatIs === r.winner;
  const elo = r.eloChange;

  const rematch = () => socket.emit('rematch');

  return (
    <div className="winner-screen">
      <div className={'banner ' + (draw ? 'draw' : (youWon ? 'win' : 'loss'))}>
        {draw ? 'DRAW' : (youWon ? 'YOU WIN' : 'YOU LOSE')}
      </div>
      {r.forfeit && <p className="muted">Opponent forfeited by disconnecting.</p>}

      <div className="result-card">
        <h3>Vote tally</h3>
        <div className="vote-bars">
          <VoteBar label={`A · ${room.playback?.ownership?.A || '—'}`} count={r.voteCounts.A} winner={r.winner === 'A'} />
          <VoteBar label={`B · ${room.playback?.ownership?.B || '—'}`} count={r.voteCounts.B} winner={r.winner === 'B'} />
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
        <button className="btn primary big" onClick={rematch}>Rematch</button>
        <button className="btn big ghost" onClick={onLeave}>Back to lobby</button>
      </div>
    </div>
  );
}

function VoteBar({ label, count, winner }) {
  return (
    <div className={'vote-bar-row ' + (winner ? 'winner' : '')}>
      <div className="vb-label">{label}</div>
      <div className="vb-bar">
        <div className="vb-fill" style={{ width: `${Math.min(100, count * 50)}%` }} />
      </div>
      <div className="vb-count">{count}</div>
    </div>
  );
}
