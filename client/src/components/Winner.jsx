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
  const decidedBy = r.decidedBy;     // 'votes' | 'algorithm' | 'tied'
  const algScores = r.algorithmScores; // { A: { score, breakdown }, B: ... }

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

  // Friendly explanation of how the result was decided. Only shown when
  // it's not just "human votes picked the winner" — e.g. when the
  // algorithm broke a tie, the user should know.
  const decisionNote = decidedBy === 'algorithm'
    ? 'Vote was tied — decided by the algorithmic judge on musicality.'
    : decidedBy === 'tied'
      ? 'Vote tied and beats were musically equivalent.'
      : null;

  return (
    <div className="winner-screen">
      <div className={'banner ' + bannerClass}>
        {bannerText}
      </div>
      {r.forfeit && <p className="muted">Opponent forfeited by disconnecting.</p>}
      {decisionNote && <p className="decision-note">⚖ {decisionNote}</p>}

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

        {algScores && (
          <div className="alg-scores">
            <h4>Algorithmic judge {decidedBy === 'algorithm' && <span className="alg-tag">DECIDED</span>}</h4>
            <ScoreBreakdown
              label={`A · ${room.playback?.ownership?.A || ''}`}
              data={algScores.A}
              winner={decidedBy === 'algorithm' && r.winner === 'A'}
            />
            <ScoreBreakdown
              label={`B · ${room.playback?.ownership?.B || ''}`}
              data={algScores.B}
              winner={decidedBy === 'algorithm' && r.winner === 'B'}
            />
          </div>
        )}

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

// Display the per-dimension scores from the algorithm. Helps users
// understand WHY one beat scored higher — was it rhythm, harmony,
// pocket, etc.
function ScoreBreakdown({ label, data, winner }) {
  if (!data) return null;
  const b = data.breakdown || {};
  const items = [
    { name: 'Rhythm',    val: b.rhythm },
    { name: 'Harmony',   val: b.harmony },
    { name: 'Pocket',    val: b.pocket },
    { name: 'Variation', val: b.variation },
    { name: 'Tracks',    val: b.tracks },
    { name: 'Motif',     val: b.motif },
  ].filter(i => typeof i.val === 'number');
  return (
    <div className={'alg-row ' + (winner ? 'alg-winner' : '')}>
      <div className="alg-label">
        <span>{label}</span>
        <span className="alg-total">{data.score}</span>
      </div>
      <div className="alg-bars">
        {items.map(i => (
          <div key={i.name} className="alg-chip" title={`${i.name}: ${i.val}`}>
            <span className="alg-chip-name">{i.name}</span>
            <span className="alg-chip-val">{i.val > 0 ? '+' + i.val : i.val}</span>
          </div>
        ))}
        {b.penalty < 0 && (
          <div className="alg-chip alg-penalty" title={`Penalty: ${b.penalty}`}>
            <span className="alg-chip-name">Penalty</span>
            <span className="alg-chip-val">{b.penalty}</span>
          </div>
        )}
      </div>
    </div>
  );
}
