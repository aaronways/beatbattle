import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Sequencer from './Sequencer.jsx';
import Mixer from './Mixer.jsx';
import SoundKit from './SoundKit.jsx';
import { engine } from '../audio/engine.js';
import { exportBeatAsMp3, downloadBlob } from '../audio/export.js';
import { call } from '../socket.js';
import {
  makeEmptyBeat, makeTrack, maxTracksForCategory,
  BPM_MIN, BPM_MAX, TRACK_SLOTS, PHASE,
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
  // Per-track pattern clipboard. Keyed by source category so paste only
  // works onto matching-category tracks (preventing nonsense like pasting
  // a melody into a kick lane). Holds either:
  //   - { steps: [...] } for full-pattern copy of a single track
  //   - null if nothing copied
  const [trackClipboard, setTrackClipboard] = useState(null);
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
  // Call this BEFORE any user-initiated mutation. Programmatic mutations
  // (e.g. the auto-fill on kit arrival) deliberately skip this.
  //
  // NOTE on the race condition: previously this called `setHistory(h => [...h, beatRef.current])`
  // but `beatRef.current` was only updated AFTER a re-render. Two rapid
  // clicks in the same tick would both capture the same beat, corrupting
  // history. We now update `beatRef.current` synchronously inside
  // `applyBeatMutation` (the wrapper every editor action goes through), so
  // pushHistory always sees the latest snapshot.
  const pushHistory = useCallback(() => {
    const snapshot = beatRef.current;
    setHistory(h => {
      const next = h.length >= HISTORY_LIMIT ? [...h.slice(1), snapshot] : [...h, snapshot];
      return next;
    });
    setRedoStack([]);
  }, []);

  // Undo/redo use ONLY pure top-level state updates. No nested setState
  // inside an updater (which would be undefined behavior in React 18
  // StrictMode and breaks under concurrent rendering).
  const undo = useCallback(() => {
    if (locked) return;
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setRedoStack(r => [...r, beatRef.current]);
    setHistory(h => h.slice(0, -1));
    setBeat(prev);
    beatRef.current = prev;   // keep ref in lockstep
  }, [locked, history]);

  const redo = useCallback(() => {
    if (locked) return;
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setHistory(h => [...h, beatRef.current]);
    setRedoStack(r => r.slice(0, -1));
    setBeat(next);
    beatRef.current = next;
  }, [locked, redoStack]);

  // All editor mutations go through this wrapper. It (a) pushes history,
  // (b) updates the beat state, (c) keeps beatRef synchronized so a follow-up
  // pushHistory in the same tick sees the new value.
  const applyBeatMutation = useCallback((updater) => {
    if (locked) return;
    pushHistory();
    const next = updater(beatRef.current);
    if (next === beatRef.current) return;  // no-op skipped
    beatRef.current = next;
    setBeat(next);
  }, [locked, pushHistory]);

  // ── Engine wiring ──────────────────────────────────────────────────────
  useEffect(() => {
    engine.onStep = (i) => setCurrentStep(i);
    return () => { engine.onStep = null; };
  }, []);

  useEffect(() => {
    if (playing) {
      // Re-schedule the engine when the beat data changes mid-play, but
      // preserve the current playhead position so the loop doesn't jump
      // back to bar 1 on every step toggle. engine.schedule() captures the
      // beat by reference and re-arms the transport; we then nudge the
      // transport back to where it was before this re-arm.
      engine.scheduleAtPosition(beat);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat, playing]);

  useEffect(() => { engine.setMetronome(metronome); }, [metronome]);

  // ── Auto-fill kit defaults (programmatic — no history entry) ──────────
  useEffect(() => {
    if (!kit) return;
    setBeat(prev => {
      let changed = false;
      // Track which sounds have already been assigned to other tracks, so a
      // second "kick" track auto-fills with a different kick (when possible)
      // rather than duplicating the first.
      const used = new Set(prev.tracks.map(t => t.soundId).filter(Boolean));
      const tracks = prev.tracks.map(t => {
        if (t.soundId) return t;
        const sounds = kit.sounds[t.category] || [];
        if (!sounds.length) return t;
        // Default: first unused sound in the category. Open-hat lanes prefer
        // an "open" sound; closed-hat lanes prefer "closed".
        let pick = sounds.find(s => !used.has(s.id)) || sounds[0];
        if (t.preferOpenHat) {
          pick = sounds.find(s => s.id.includes('open')) || pick;
        } else if (t.category === 'hat' && !t.preferOpenHat) {
          pick = sounds.find(s => s.id.includes('closed') && !used.has(s.id)) || pick;
        }
        used.add(pick.id);
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
  const toggleDrumStep = (trackId, idx) => applyBeatMutation(b => ({
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

  const toggleNote = (trackId, idx, semitone) => applyBeatMutation(b => ({
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

  const assignSoundToTrack = (trackId, soundId) => {
    applyBeatMutation(b => ({
      ...b,
      tracks: b.tracks.map(t => t.id === trackId ? { ...t, soundId } : t),
    }));
    setArmedSoundId(null);
  };

  // updateTrack is the hot path for slider drags. We DON'T push history here
  // on every change — instead, we group drags into single history entries
  // via beginDrag/endDrag (called from mouse-down / mouse-up). See onDragStart.
  // For non-drag changes (mute/solo button clicks), we always push history.
  const dragInProgressRef = useRef(false);
  const updateTrack = (trackId, patch) => {
    if (locked) return;
    if (!dragInProgressRef.current) pushHistory();
    const next = {
      ...beatRef.current,
      tracks: beatRef.current.tracks.map(t => t.id === trackId ? { ...t, ...patch } : t),
    };
    beatRef.current = next;
    setBeat(next);
  };

  const updateEffects = (patch) => {
    if (locked) return;
    if (!dragInProgressRef.current) pushHistory();
    const next = { ...beatRef.current, effects: { ...beatRef.current.effects, ...patch } };
    beatRef.current = next;
    setBeat(next);
  };

  // Begin/end a drag session — call from onPointerDown / onPointerUp on
  // continuous-input controls (sliders, knobs). pushHistory fires once at
  // the start; all changes within the drag share that history entry.
  const beginDrag = useCallback(() => {
    if (locked) return;
    if (dragInProgressRef.current) return;
    dragInProgressRef.current = true;
    pushHistory();
  }, [locked, pushHistory]);

  const endDrag = useCallback(() => {
    dragInProgressRef.current = false;
  }, []);

  const setBpm = (bpm) => {
    if (locked) return;
    const v = Math.max(BPM_MIN, Math.min(BPM_MAX, bpm));
    if (v === beatRef.current.bpm) return;
    pushHistory();
    const next = { ...beatRef.current, bpm: v };
    beatRef.current = next;
    setBeat(next);
    engine.setBpm(v);
  };

  const setBars = (bars) => {
    if (locked) return;
    const safeBars = Math.max(1, Math.min(MAX_BARS, bars | 0));
    if (safeBars === beatRef.current.bars) return;
    applyBeatMutation(b => {
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
  const duplicatePattern = () => applyBeatMutation(b => {
    if (b.bars >= MAX_BARS) return b;
    const newBars = Math.min(b.bars * 2, MAX_BARS);
    const copyStepCount = (newBars - b.bars) * 16;
    return {
      ...b,
      bars: newBars,
      tracks: b.tracks.map(t => ({
        ...t,
        steps: [
          ...t.steps,
          ...t.steps.slice(0, copyStepCount).map(cell => [...(cell || [])]),
        ],
      })),
    };
  });

  const clearAll = () => {
    if (locked) return;
    if (!confirm('Clear all steps?')) return;
    applyBeatMutation(b => ({
      ...b,
      tracks: b.tracks.map(t => ({ ...t, steps: t.steps.map(() => []) })),
    }));
  };

  // ── Per-track pattern operations ───────────────────────────────────────
  const clearTrack = (trackId) => {
    if (locked) return;
    if (!confirm('Clear this track?')) return;
    applyBeatMutation(b => ({
      ...b,
      tracks: b.tracks.map(t => t.id === trackId
        ? { ...t, steps: t.steps.map(() => []) }
        : t),
    }));
  };

  const copyTrack = (trackId) => {
    const src = beatRef.current.tracks.find(t => t.id === trackId);
    if (!src) return;
    setTrackClipboard({
      category: src.category,
      type: src.type,
      steps: src.steps.map(cell => [...(cell || [])]),
    });
  };

  const pasteTrack = (trackId) => {
    if (locked || !trackClipboard) return;
    const dst = beatRef.current.tracks.find(t => t.id === trackId);
    if (!dst) return;
    if (dst.type !== trackClipboard.type) {
      alert(`Can't paste a ${trackClipboard.type} pattern into a ${dst.type} track.`);
      return;
    }
    applyBeatMutation(b => {
      const targetLen = b.tracks.find(t => t.id === trackId).steps.length;
      const clipped = trackClipboard.steps.slice(0, targetLen);
      const padded = clipped.length === targetLen
        ? clipped.map(c => [...c])
        : [...clipped.map(c => [...c]), ...Array.from({ length: targetLen - clipped.length }, () => [])];
      return {
        ...b,
        tracks: b.tracks.map(t => t.id === trackId ? { ...t, steps: padded } : t),
      };
    });
  };

  const loopFillTrack = (trackId) => applyBeatMutation(b => ({
    ...b,
    tracks: b.tracks.map(t => {
      if (t.id !== trackId) return t;
      const oneBar = t.steps.slice(0, 16).map(c => [...(c || [])]);
      const out = [];
      for (let i = 0; i < t.steps.length; i++) {
        out.push([...oneBar[i % 16]]);
      }
      return { ...t, steps: out };
    }),
  }));

  const addTrack = (category) => {
    if (locked) return;
    const cap = maxTracksForCategory(category);
    const existing = beatRef.current.tracks.filter(t => t.category === category);
    if (existing.length >= cap) {
      alert(`Max ${cap} ${category} track${cap > 1 ? 's' : ''}.`);
      return;
    }
    const usedNums = new Set(existing.map(t => parseInt(t.id.split('-').pop(), 10)).filter(Number.isFinite));
    let n = 1;
    while (usedNums.has(n)) n++;
    const slot = TRACK_SLOTS.find(s => s.category === category);
    const label = `${slot?.label || category} ${n}`;
    applyBeatMutation(b => {
      const stepCount = b.bars * 16;
      const newTrack = makeTrack({
        id: `${category}-${n}`,
        label,
        category,
        type: slot?.type || 'drum',
      }, stepCount);
      if (kit) {
        const used = new Set(b.tracks.map(t => t.soundId).filter(Boolean));
        const choice = (kit.sounds[category] || []).find(s => !used.has(s.id)) || (kit.sounds[category] || [])[0];
        if (choice) newTrack.soundId = choice.id;
      }
      return { ...b, tracks: [...b.tracks, newTrack] };
    });
  };

  const removeTrack = (trackId) => {
    if (locked) return;
    if (!confirm('Remove this track? All its notes will be lost.')) return;
    applyBeatMutation(b => ({
      ...b,
      tracks: b.tracks.filter(t => t.id !== trackId),
    }));
    // Tell the engine to dispose this track's strip so we don't leak nodes.
    engine.removeTrackStrip?.(trackId);
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
    // Use the ref (not state) so this stays correct across renders.
    // If we used `submitted` from state closure, a stale-closure version
    // of this function could re-submit even after a previous submit.
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitted(true);
    engine.stop();
    setPlaying(false);
    const res = await call('submitBeat', { beat: beatRef.current });
    if (res?.error) {
      // Server rejected — unlock so the player can fix and retry.
      submittedRef.current = false;
      setSubmitted(false);
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
  handlersRef.current = { togglePlay, undo, redo, setArmedSoundId, locked };
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const h = handlersRef.current;
      // Lock-out: no editor-affecting shortcuts during PLAYBACK/VOTING/RESULT.
      if (h.locked && (e.code === 'Space' || ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')))) {
        return;
      }
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
            <div className={'timer ' + (typeof room?.battleSecondsLeft === 'number' && room.battleSecondsLeft <= 30 ? 'urgent' : '')}>
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
              onClearTrack={clearTrack}
              onCopyTrack={copyTrack}
              onPasteTrack={pasteTrack}
              onLoopFillTrack={loopFillTrack}
              onRemoveTrack={removeTrack}
              clipboardType={trackClipboard?.type}
            />
            <AddTrackBar
              beat={beat}
              kit={kit}
              locked={locked}
              onAddTrack={addTrack}
            />
          </div>
        </div>

        <Mixer
          beat={beat}
          locked={locked}
          onUpdateTrack={updateTrack}
          onUpdateEffects={updateEffects}
          onBeginDrag={beginDrag}
          onEndDrag={endDrag}
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

// ── Add Track bar ─────────────────────────────────────────────────────────
// Renders one button per kit category that has room for another track.
// Disabled when the category is already at its cap, so the player sees the
// limit (rather than the button silently doing nothing).
const ADD_TRACK_CATEGORIES = [
  { key: 'kick',   label: '+ Kick'    },
  { key: 'snare',  label: '+ Snare'   },
  { key: 'clap',   label: '+ Clap'    },
  { key: 'hat',    label: '+ Hat'     },
  { key: 'bass',   label: '+ Bass'    },
  { key: 'melody', label: '+ Melody'  },
  { key: 'fx',     label: '+ FX'      },
];

function AddTrackBar({ beat, kit, locked, onAddTrack }) {
  if (!kit) return null;
  return (
    <div className="add-track-bar">
      <span className="add-track-label">ADD TRACK</span>
      {ADD_TRACK_CATEGORIES.map(({ key, label }) => {
        const count = beat.tracks.filter(t => t.category === key).length;
        const cap = maxTracksForCategory(key);
        const atCap = count >= cap;
        const noSoundsInKit = !(kit.sounds[key] || []).length;
        return (
          <button
            key={key}
            className="btn small ghost add-track-btn"
            onClick={() => onAddTrack(key)}
            disabled={locked || atCap || noSoundsInKit}
            title={atCap ? `Max ${cap} ${key} tracks` : noSoundsInKit ? `No ${key} sounds in kit` : `Add a ${key} track`}
          >{label} <span className="add-track-count">{count}/{cap}</span></button>
        );
      })}
    </div>
  );
}
