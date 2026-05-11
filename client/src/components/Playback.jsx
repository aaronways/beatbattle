import { useEffect, useRef, useState } from 'react';
import { engine } from '../audio/engine.js';
import { call } from '../socket.js';
import { PHASE } from '../../../shared/gameRules.js';

export default function Playback({ room }) {
  const [stage, setStage] = useState('intro'); // intro | playA | gap | playB | done
  const [voted, setVoted] = useState(false);
  const playedRef = useRef(false);
  const beats = room.playback?.beats;

  // Play A → gap → B once per playback phase.
  useEffect(() => {
    if (room.phase !== PHASE.PLAYBACK) return;
    if (playedRef.current) return;
    playedRef.current = true;
    let cancelled = false;

    (async () => {
      await engine.start();
      // Tiny intro pause so everyone sees the screen before sound starts.
      setStage('intro');
      await wait(1200);
      if (cancelled) return;

      if (beats?.A?.tracks?.length) {
        setStage('playA');
        engine.schedule(beats.A);
        engine.play();
        await wait(durationMs(beats.A));
        engine.stop();
      }
      if (cancelled) return;

      setStage('gap');
      await wait(900);
      if (cancelled) return;

      if (beats?.B?.tracks?.length) {
        setStage('playB');
        engine.schedule(beats.B);
        engine.play();
        await wait(durationMs(beats.B));
        engine.stop();
      }
      setStage('done');
    })();

    return () => { cancelled = true; engine.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.phase]);

  const replay = async (which) => {
    const beat = beats?.[which];
    if (!beat?.tracks?.length) return;
    await engine.start();
    engine.schedule(beat);
    engine.play();
    setTimeout(() => engine.stop(), durationMs(beat));
  };

  const vote = async (which) => {
    const res = await call('vote', { choice: which });
    if (res?.error) alert(res.error);
    else setVoted(true);
  };

  // What is "you" — A, B, or neither (shouldn't happen for an active player).
  const you = room.players.find(p => p.isYou);
  const yourBeatIs = room.playback?.ownership
    ? (you?.username === room.playback.ownership.A ? 'A' : 'B')
    : null;

  const isVoting = room.phase === PHASE.VOTING;

  return (
    <div className="playback-screen">
      <h2 className="phase-title">
        {room.phase === PHASE.PLAYBACK ? 'Playback' : 'Vote for the better beat'}
      </h2>

      <div className="playback-stage">
        <BeatTile
          label="A"
          highlight={stage === 'playA'}
          played={['gap', 'playB', 'done'].includes(stage)}
          canVote={isVoting && !voted && yourBeatIs !== 'A'}
          onVote={() => vote('A')}
          onReplay={() => replay('A')}
          isYours={yourBeatIs === 'A' && isVoting}
          disabled={!isVoting}
        />
        <div className="vs-big">VS</div>
        <BeatTile
          label="B"
          highlight={stage === 'playB'}
          played={stage === 'done'}
          canVote={isVoting && !voted && yourBeatIs !== 'B'}
          onVote={() => vote('B')}
          onReplay={() => replay('B')}
          isYours={yourBeatIs === 'B' && isVoting}
          disabled={!isVoting}
        />
      </div>

      <div className="playback-foot">
        {!isVoting && <p className="muted">Listen carefully — you'll vote next.</p>}
        {isVoting && voted && <p className="muted">Vote locked. Waiting for everyone else…</p>}
        {isVoting && !voted && (
          <p className="muted">
            Voting closes in <b>{room.votingSecondsLeft}s</b>
          </p>
        )}
      </div>
    </div>
  );
}

function BeatTile({ label, highlight, played, canVote, isYours, disabled, onVote, onReplay }) {
  return (
    <div className={[
      'beat-tile', highlight ? 'now-playing' : '',
      played ? 'played' : '', isYours ? 'yours' : '',
    ].join(' ')}>
      <div className="beat-letter">{label}</div>
      <div className="beat-meta">
        {highlight && <span className="now">▶ Now playing</span>}
        {!highlight && played && <span className="muted">Heard</span>}
        {!highlight && !played && <span className="muted">Up next</span>}
      </div>
      <div className="beat-actions">
        <button className="btn small" disabled={disabled} onClick={onReplay}>Replay</button>
        <button
          className="btn primary"
          disabled={disabled || !canVote}
          onClick={onVote}
        >
          {isYours ? 'Your beat' : 'Vote'}
        </button>
      </div>
    </div>
  );
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// Estimate duration of a beat in ms — bars * 4 beats * (60/bpm) sec, +0.5s safety tail.
function durationMs(beat) {
  if (!beat?.bpm) return 4000;
  const beats = beat.bars * 4;
  return Math.round(beats * (60 / beat.bpm) * 1000) + 500;
}
