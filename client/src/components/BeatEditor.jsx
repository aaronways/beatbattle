import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Sequencer from './Sequencer.jsx';
import Mixer from './Mixer.jsx';
import SoundKit from './SoundKit.jsx';
import { engine } from '../audio/engine.js';
import { exportBeatAsMp3, downloadBlob } from '../audio/export.js';
import { call } from '../socket.js';
import {
  makeEmptyBeat, BPM_MIN, BPM_MAX, TRACK_SLOTS, PHASE,
} from '../../../shared/gameRules.js';

// Cap so the redo stack can't grow unbounded over a 10-min match.
const HISTORY_LIMIT = 80;

// Max number of bars a single beat can hold. The data model itself has no
// upper bound, but the sequencer renders one DOM cell per (step, pitch row)
// and gets sluggish above ~32 bars on slower machines. Cap at 64 — that's
// ~38 seconds at 100 BPM, plenty for any normal beat.
const MAX_BARS = 64;

// Look up which kit category a given soundId belongs to. Used to figure out
// which track lanes are valid drop targets when a sound is "armed".
function categoryForSound(kit, soundId) {
  if (!kit || !soundId) return null;
  for (const cat in kit.sounds) {
    if (kit.sounds[cat].some(s => s.id === soundId)) return cat;
  }
  return null;
}

export default function BeatEditor({ room, kit, isPractice, onLeave, onSubmitted }) {
  const [beat, setBeat] = useState(() => makeEmptyBeat());
  const [history, setHistory] = useState([]);     // past beat states (undo stack)
  const [redoStack, setRedoStack] = useState([]); // future beat states (redo stack)
  const [playing, setPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [metronome, setMetronome] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [armedSoundId, setArmedSoundId] = useState(null);
  const [exportStatus, setExportStatus] = useState(null); // null | 'rendering' | 'encoding'
  const [exportLoops, setExportLoops] = useState(4);      // how many times the pattern repeats in the export
  const submittedRef = useRef(false);
  const beatRef = useRef(beat);
  beatRef.current = beat;

  const locked = !isPractice && (
    submitted ||
    room?.phase === PHASE.PLAYBACK ||
    room?.phase === PHASE.VOTING ||
    room?.phase === PHASE.RESULT
  );

  // ── History helpers ────────────────────────────────────────────────────
  // Snapshot the current beat onto the undo stack and clear the redo stack.
  // Call this before any user-initiated mutation. Programmatic mutations
  // (e.g. the auto-fill on kit arrival) deliberately skip this.
  const pushHistory = useCallback(() => {
    setHistory(h => {
      const next = [...h, beatRef.current];
      if (next.length > HISTORY_LIMIT) next.shift();
      return next;
    });
    setRedoStack([]);
  }, []);

  const undo = useCallback(() => {
    if (locked) return;
    setHistory(h => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setRedoStack(r => [...r, beatRef.current]);
      setBeat(prev);
      return h.slice(0, -1);
    });
  }, [locked]);

  const redo = useCallback(() => {
    if (locked) return;
    setRedoStack(r => {
      if (!r.length) return r;
      const next = r[r.length - 1];
      setHistory(h => [...h, beatRef.current]);
      setBeat(next);
      return r.slice(0, -1);
    });
  }, [locked]);

  // ── Engine wiring ──────────────────────────────────────────────────────
  useEffect(() => {
    engine.onStep = (i) => setCurrentStep(i);
    return () => { engine.onStep = null; };
  }, []);

  useEffect(() => {
    if (playing) {
      engine.schedule(beat);
      engine.play();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat, playing]);

  useEffect(() => { engine.setMetronome(metronome); }, [metronome]);

  // ── Auto-fill kit defaults (programmatic — no history entry) ──────────
  useEffect(() => {
    if (!kit) return;
    setBeat(prev => {
      let changed = false;
      const tracks = prev.tracks.map(t => {
        if (t.soundId) return t;
        const slot = TRACK_SLOTS.find(s => s.id === t.id);
        const sounds = kit.sounds[slot?.category] || [];
        if (!sounds.length) return t;
        let pick = sounds[0];
        if (t.id === 'hatO') {
          pick = sounds.find(s => s.id.includes('open')) || sounds[1] || sounds[0];
        } else if (t.id === 'hatC') {
          pick = sounds.find(s => s.id.includes('closed')) || sounds[0];
        }
        changed = true;
        return { ...t, soundId: pick.id };
      });
      return changed ? { ...prev, tracks } : prev;
    });
  }, [kit]);

  // ── Auto-submit when timer hits zero ───────────────────────────────────
  useEffect(() => {
    if (isPractice) return;
    if (room?.phase !== PHASE.BATTLE) return;
    if (room.battleSecondsLeft === 0 && !submittedRef.current) {
      submittedRef.current = true;
      doSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.battleSecondsLeft, room?.phase]);

  // ── Actions ────────────────────────────────────────────────────────────
  const togglePlay = useCallback(async () => {
    await engine.start();
    if (playing) {
      engine.pause();
      setPlaying(false);
      setCurrentStep(-1);
    } else {
      engine.schedule(beatRef.current);
      engine.play();
      setPlaying(true);
    }
  }, [playing]);

  const stop = () => { engine.stop(); setPlaying(false); setCurrentStep(-1); };

  // ── Step / note mutations ──────────────────────────────────────────────
  // Drum cells are binary: empty array ↔ [0]. Pitched cells hold a list of
  // semitone offsets and we toggle individual pitches in/out of the set.
  const toggleDrumStep = (trackId, idx) => {
    if (locked) return;
    pushHistory();
    setBeat(b => ({
      ...b,
      tracks: b.tracks.map(t => t.id === trackId
        ? {
            ...t,
            steps: t.steps.map((cell, i) => {
              if (i !== idx) return cell;
              return cell && cell.length ? [] : [0];
            }),
          }
        : t),
    }));
  };

  const toggleNote = (trackId, idx, semitone) => {
    if (locked) return;
    pushHistory();
    setBeat(b => ({
      ...b,
      tracks: b.tracks.map(t => t.id === trackId
        ? {
            ...t,
            steps: t.steps.map((cell, i) => {
              if (i !== idx) return cell;
              const set = new Set(cell || []);
              if (set.has(semitone)) set.delete(semitone);
              else set.add(semitone);
              return Array.from(set).sort((a, b) => a - b);
            }),
          }
        : t),
    }));
  };

  const assignSoundToTrack = (trackId, soundId) => {
    if (locked) return;
    pushHistory();
    setBeat(b => ({
      ...b,
      tracks: b.tracks.map(t => t.id === trackId ? { ...t, soundId } : t),
    }));
    setArmedSoundId(null);
  };

  const updateTrack = (trackId, patch) => {
    if (locked) return;
    pushHistory();
    setBeat(b => ({
      ...b,
      tracks: b.tracks.map(t => t.id === trackId ? { ...t, ...patch } : t),
    }));
  };

  const updateEffects = (patch) => {
    if (locked) return;
    pushHistory();
    setBeat(b => ({ ...b, effects: { ...b.effects, ...patch } }));
  };

  const setBpm = (bpm) => {
    if (locked) return;
    const v = Math.max(BPM_MIN, Math.min(BPM_MAX, bpm));
    pushHistory();
    setBeat(b => ({ ...b, bpm: v }));
    engine.setBpm(v);
  };

  const setBars = (bars) => {
    if (locked) return;
    const safeBars = Math.max(1, Math.min(MAX_BARS, bars | 0));
    pushHistory();
    setBeat(b => {
      const newSteps = 16 * safeBars;
      return {
        ...b,
        bars: safeBars,
        tracks: b.tracks.map(t => {
          if (t.steps.length === newSteps) return t;
          if (t.steps.length < newSteps) {
            const pad = Array.from({ length: newSteps - t.steps.length }, () => []);
            return { ...t, steps: [...t.steps, ...pad] };
          }
          return { ...t, steps: t.steps.slice(0, newSteps) };
        }),
      };
    });
  };

  // Doubles the pattern: 1 bar → 2 bars (bar 2 = bar 1), capped at MAX_BARS.
  // If we're at the cap, no-op. If doubling would overflow, copy as much as
  // fits onto the end.
  const duplicatePattern = () => {
    if (locked) return;
    pushHistory();
    setBeat(b => {
      if (b.bars >= MAX_BARS) return b;
      const newBars = Math.min(b.bars * 2, MAX_BARS);
      const copyStepCount = (newBars - b.bars) * 16;
      return {
        ...b,
        bars: newBars,
        tracks: b.tracks.map(t => ({
          ...t,
          // Deep-clone the source cells so future edits to bar 1 don't
          // accidentally mutate the duplicated cells via shared array refs.
          steps: [
            ...t.steps,
            ...t.steps.slice(0, copyStepCount).map(cell => [...(cell || [])]),
          ],
        })),
      };
    });
  };

  const clearAll = () => {
    if (locked) return;
    if (!confirm('Clear all steps?')) return;
    pushHistory();
    setBeat(b => ({
      ...b,
      tracks: b.tracks.map(t => ({
        ...t,
        steps: t.steps.map(() => []),
      })),
    }));
  };

  // ── MP3 export ─────────────────────────────────────────────────────────
  // Renders the current beat through an offline audio context, encodes the
  // resulting buffer as MP3, and triggers a browser download. Independent of
  // the realtime engine — runs while the editor is playing if the user wants.
  const doExportMp3 = async () => {
    if (exportStatus) return;
    try {
      const { blob, durationSec, sizeBytes } = await exportBeatAsMp3(beatRef.current, {
        loops: exportLoops,
        onPhase: setExportStatus,
      });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `beatbattle-${beatRef.current.bpm}bpm-${beatRef.current.bars}bars-${stamp}.mp3`;
      downloadBlob(blob, filename);
      // Brief confirmation flash via status text — auto-clear.
      setExportStatus(`saved (${(sizeBytes / 1024).toFixed(0)} KB · ${durationSec.toFixed(1)}s)`);
      setTimeout(() => setExportStatus(null), 3500);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed: ' + (err.message || err));
      setExportStatus(null);
    }
  };

  const previewSound = async (soundId) => {
    await engine.start();
    engine.preview(soundId);
  };

  const armSound = (soundId) => {
    if (locked) return;
    setArmedSoundId(prev => prev === soundId ? null : soundId);
  };

  const doSubmit = async () => {
    if (submitted) return;
    setSubmitted(true);
    submittedRef.current = true;
    engine.stop();
    setPlaying(false);
    const res = await call('submitBeat', { beat: beatRef.current });
    if (res?.error) {
      // Server rejected — unlock so the player can fix and retry.
      setSubmitted(false);
      submittedRef.current = false;
      alert(res.error);
    } else {
      onSubmitted?.();
    }
  };

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  // Space: play/pause. Cmd/Ctrl+Z: undo. Cmd/Ctrl+Shift+Z (or Ctrl+Y): redo.
  // Esc: cancel armed sound. Use a ref to call the latest closures without
  // re-binding the listener every render.
  const handlersRef = useRef({});
  handlersRef.current = { togglePlay, undo, redo, setArmedSoundId };
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const h = handlersRef.current;
      if (e.code === 'Space') { e.preventDefault(); h.togglePlay(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); h.undo(); }
      else if ((e.metaKey || e.ctrlKey) && ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y')) { e.preventDefault(); h.redo(); }
      else if (e.key === 'Escape') { h.setArmedSoundId(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Derived ────────────────────────────────────────────────────────────
  const opponent = useMemo(() => room?.players.find(p => !p.isYou), [room]);
  const armedCategory = useMemo(() => categoryForSound(kit, armedSoundId), [kit, armedSoundId]);

  const timeStr = (s) => {
    if (s == null) return '—';
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const opponentLabel = (status) => {
    if (status === 'editing')      return 'Editing';
    if (status === 'submitted')    return 'Submitted';
    if (status === 'disconnected') return 'Disconnected';
    return status || '—';
  };

  return (
    <div className="arena">
      {/* ── TOP BAR ────────────────────────────────────────────── */}
      <header className="arena-top">
        <div className="top-left">
          <button className="btn small ghost" onClick={onLeave}>← Leave</button>
          {!isPractice && room && (
            <span className="room-tag">
              <span className="room-tag-label">ROOM</span>
              <b>{room.code}</b>
              <span className={'ranked-tag ' + (room.ranked ? 'ranked' : 'casual')}>
                {room.ranked ? 'RANKED' : 'CASUAL'}
              </span>
            </span>
          )}
          {isPractice && <span className="room-tag"><span className="room-tag-label">MODE</span><b>PRACTICE</b></span>}
        </div>

        <div className="top-center">
          {isPractice ? (
            <div className="timer">
              <span className="timer-label">FREE PLAY</span>
              <span className="timer-num practice">∞</span>
            </div>
          ) : (
            <div className={'timer ' + (room?.battleSecondsLeft <= 30 ? 'urgent' : '')}>
              <span className="timer-label">TIME LEFT</span>
              <span className="timer-num">{timeStr(room?.battleSecondsLeft)}</span>
            </div>
          )}
        </div>

        <div className="top-right">
          {!isPractice && opponent && (
            <div className={'opp-pill ' + (opponent.status || '')}>
              <span className="status-dot"></span>
              <div className="opp-info">
                <span className="opp-name">{opponent.username}</span>
                <span className="opp-status">{opponentLabel(opponent.status)}</span>
              </div>
            </div>
          )}
          {!isPractice ? (
            <button className="btn primary submit-btn" onClick={doSubmit} disabled={submitted}>
              {submitted ? 'SUBMITTED ✓' : 'SUBMIT BEAT'}
            </button>
          ) : (
            <span className="muted small">Free play — no submit</span>
          )}
        </div>
      </header>

      {/* ── MAIN: KIT | SEQUENCER | MIXER ───────────────────────── */}
      <div className="arena-main">
        <SoundKit
          kit={kit}
          beat={beat}
          locked={locked}
          armedSoundId={armedSoundId}
          onArm={armSound}
          onPreview={previewSound}
        />

        <div className="seq-pane">
          <div className="panel-header">
            <span>SEQUENCER</span>
            {armedSoundId && (
              <span className="seq-arm-hint">→ click a matching track</span>
            )}
          </div>
          <div className="seq-scroll">
            <Sequencer
              beat={beat}
              kit={kit}
              currentStep={currentStep}
              locked={locked}
              armedSoundId={armedSoundId}
              armedCategory={armedCategory}
              onToggleDrumStep={toggleDrumStep}
              onToggleNote={toggleNote}
              onAssignSound={assignSoundToTrack}
              onPreview={previewSound}
            />
          </div>
        </div>

        <Mixer
          beat={beat}
          locked={locked}
          onUpdateTrack={updateTrack}
          onUpdateEffects={updateEffects}
        />
      </div>

      {/* ── BOTTOM BAR: TRANSPORT + PATTERN CONTROLS ─────────── */}
      <footer className="arena-bottom">
        <div className="bottom-section transport-section">
          <button
            className="btn primary play-btn"
            onClick={togglePlay}
            title="Play / Pause (Space)"
            aria-label="Play or pause"
          >{playing ? '❚❚' : '▶'}</button>
          <button className="btn small ghost stop-btn" onClick={stop} title="Stop">■</button>
        </div>

        <div className="bottom-section">
          <label className="bottom-field">
            <span>BPM</span>
            <input
              type="number" min={BPM_MIN} max={BPM_MAX}
              value={beat.bpm}
              onChange={(e) => setBpm(parseInt(e.target.value || '0', 10))}
              disabled={locked}
            />
          </label>
          <label className="bottom-field">
            <span>BARS</span>
            <input
              type="number" min={1} max={MAX_BARS}
              value={beat.bars}
              onChange={(e) => setBars(parseInt(e.target.value || '1', 10))}
              disabled={locked}
              title={`1 – ${MAX_BARS} bars. Long beats may slow down the grid.`}
            />
          </label>
          <label className="bottom-field check">
            <input type="checkbox" checked={metronome} onChange={(e) => setMetronome(e.target.checked)} />
            <span>METRO</span>
          </label>
        </div>

        <div className="bottom-section actions">
          <button
            className="btn small"
            onClick={duplicatePattern}
            disabled={locked || beat.bars >= MAX_BARS}
            title="Double the pattern (copy current bars to fill more)"
          >⎘ DUPLICATE</button>
          <button
            className="btn small ghost"
            onClick={clearAll}
            disabled={locked}
            title="Clear every step"
          >⊘ CLEAR</button>
          <button
            className="btn small ghost"
            onClick={undo}
            disabled={locked || !history.length}
            title="Undo (Ctrl/Cmd+Z)"
          >↶ UNDO</button>
          <button
            className="btn small ghost"
            onClick={redo}
            disabled={locked || !redoStack.length}
            title="Redo (Ctrl/Cmd+Shift+Z)"
          >↷ REDO</button>

          {/* MP3 export. The loops selector controls how many times the
              pattern repeats in the rendered file. */}
          <label className="bottom-field export-loops" title="How many times to loop the pattern in the exported file">
            <span>×</span>
            <select
              value={exportLoops}
              onChange={(e) => setExportLoops(parseInt(e.target.value, 10))}
              disabled={!!exportStatus}
            >
              {[1, 2, 4, 8, 16].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button
            className="btn small primary export-btn"
            onClick={doExportMp3}
            disabled={!!exportStatus && exportStatus !== null && !exportStatus.startsWith('saved')}
            title="Render this beat and save as MP3"
          >
            {exportStatus === 'rendering' ? '⟳ RENDERING…'
              : exportStatus === 'encoding'  ? '⟳ ENCODING…'
              : exportStatus?.startsWith('saved') ? '✓ ' + exportStatus.toUpperCase()
              : '⬇ EXPORT MP3'}
          </button>
        </div>
      </footer>

      {locked && !isPractice && (
        <div className="locked-banner">
          {submitted
            ? 'Beat submitted. Waiting for the other player…'
            : "Time's up — your beat is locked in."}
        </div>
      )}
    </div>
  );
}
