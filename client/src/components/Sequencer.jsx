import { STEPS_PER_BAR, PITCHED_ROWS, PITCH_NAMES } from '../../../shared/gameRules.js';

// The center pane. Renders one block per track. Two block flavours:
//   - DrumTrack:    single row of step cells (binary on/off)
//   - PitchedTrack: 12-row piano roll. X = step, Y = semitone offset (top = B,
//                   bottom = C). Click a (step, pitch) cell to toggle a note.
//
// Sound assignment still flows through the SoundKit panel ("arm → click
// track"). When a sound is armed, only matching lanes light up as targets.
export default function Sequencer({
  beat, kit, currentStep, locked,
  armedSoundId, armedCategory,
  onToggleDrumStep, onToggleNote, onAssignSound, onPreview,
  onClearTrack, onCopyTrack, onPasteTrack, onLoopFillTrack, onRemoveTrack,
  clipboardType,
}) {
  if (!beat) return null;
  const totalSteps = STEPS_PER_BAR * beat.bars;
  const stepCols = `repeat(${totalSteps}, minmax(18px, 1fr))`;

  // Look up a sound's display label by id (for the track header).
  const labelForSound = (id) => {
    if (!id || !kit) return null;
    for (const cat in kit.sounds) {
      const found = kit.sounds[cat].find(s => s.id === id);
      if (found) return found.label;
    }
    return id;
  };

  return (
    <div className="sequencer">
      {/* Step-number header. Stays sticky to top while the user scrolls. */}
      <div className="step-header">
        <div className="track-meta-spacer" />
        <div className="steps-row header-row" style={{ gridTemplateColumns: stepCols }}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={[
                'step-marker',
                i === currentStep ? 'active' : '',
                i % 4 === 0 ? 'beat-mark' : '',
                i % STEPS_PER_BAR === 0 && i > 0 ? 'bar-mark' : '',
              ].join(' ')}
            >
              {i % 4 === 0 ? (i / 4) + 1 : ''}
            </div>
          ))}
        </div>
      </div>

      {beat.tracks.map(track => {
        // Tracks now carry their own category/type, so we don't need a
        // TRACK_SLOTS lookup. The slot reference here is just for the assign
        // target check (which uses category).
        const isAssignTarget = !!armedSoundId && armedCategory === track.category && !locked;
        const soundLabel = labelForSound(track.soundId);
        const isPitched = track.type === 'pitched';
        // Paste is only enabled when the clipboard exists AND types match.
        const canPaste = !locked && !!clipboardType && clipboardType === track.type;

        const headerProps = {
          track,
          soundLabel,
          isAssignTarget,
          locked,
          armedSoundId,
          onAssignSound,
          onPreview,
          onClearTrack,
          onCopyTrack,
          onPasteTrack,
          onLoopFillTrack,
          onRemoveTrack,
          canPaste,
        };

        if (isPitched) {
          return (
            <PitchedTrack
              key={track.id}
              track={track}
              header={headerProps}
              totalSteps={totalSteps}
              currentStep={currentStep}
              locked={locked}
              onToggleNote={onToggleNote}
              stepCols={stepCols}
            />
          );
        }
        return (
          <DrumTrack
            key={track.id}
            track={track}
            header={headerProps}
            totalSteps={totalSteps}
            currentStep={currentStep}
            locked={locked}
            onToggleDrumStep={onToggleDrumStep}
            stepCols={stepCols}
          />
        );
      })}
    </div>
  );
}

// ────── Track header (meta column on the left) ───────────────────────────
// Layout: label / sound name / preview button on top row, action buttons
// (clear / copy / paste / loop-fill / remove) on a thin row below.
function TrackMeta({
  track, soundLabel, isAssignTarget, locked, armedSoundId,
  onAssignSound, onPreview,
  onClearTrack, onCopyTrack, onPasteTrack, onLoopFillTrack, onRemoveTrack,
  canPaste, compact,
}) {
  const assignClick = () => isAssignTarget && onAssignSound(track.id, armedSoundId);
  return (
    <div
      className={'track-meta ' + (compact ? 'compact ' : '') + (isAssignTarget ? 'clickable' : '')}
    >
      {/* Top row IS the assign target — clicking anywhere here assigns the
          armed sound. We don't put role=button on the outer wrapper because
          it contains other <button> elements (the action row) and nesting
          interactive ARIA roles confuses screen readers and breaks click
          dispatch in some browsers. */}
      <div
        className="track-meta-top"
        onClick={assignClick}
        role={isAssignTarget ? 'button' : undefined}
        tabIndex={isAssignTarget ? 0 : undefined}
        onKeyDown={(e) => {
          if (isAssignTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            assignClick();
          }
        }}
      >
        <div className="track-label">{track.name || ''}</div>
        <div className="track-sound" title={soundLabel || ''}>
          {soundLabel
            ? <span className="track-sound-name">{soundLabel}</span>
            : <span className="track-sound-empty">— empty —</span>}
        </div>
        <button
          className="preview-btn"
          onClick={(e) => { e.stopPropagation(); track.soundId && onPreview(track.soundId); }}
          disabled={!track.soundId}
          title="Preview"
          aria-label={`Preview ${track.name}`}
        >▸</button>
      </div>
      <div className="track-actions">
        <button
          className="track-act-btn"
          onClick={() => onCopyTrack?.(track.id)}
          disabled={locked}
          title="Copy this track's pattern"
        >COPY</button>
        <button
          className="track-act-btn"
          onClick={() => onPasteTrack?.(track.id)}
          disabled={!canPaste}
          title={canPaste ? 'Paste pattern' : 'Copy a same-type pattern first'}
        >PASTE</button>
        <button
          className="track-act-btn"
          onClick={() => onLoopFillTrack?.(track.id)}
          disabled={locked}
          title="Loop bar 1 across all bars in this track"
        >LOOP</button>
        <button
          className="track-act-btn"
          onClick={() => onClearTrack?.(track.id)}
          disabled={locked}
          title="Clear this track"
        >CLR</button>
        <button
          className="track-act-btn danger"
          onClick={() => onRemoveTrack?.(track.id)}
          disabled={locked}
          title="Remove this track"
        >✕</button>
      </div>
    </div>
  );
}

// ────── Drum track: one horizontal row ───────────────────────────────────
function DrumTrack({ track, header, totalSteps, currentStep, locked, onToggleDrumStep, stepCols }) {
  return (
    <div className={'track-row ' + (header.isAssignTarget ? 'assign-target' : '')}>
      <TrackMeta {...header} />
      <div className="steps-row" style={{ gridTemplateColumns: stepCols }}>
        {Array.from({ length: totalSteps }).map((_, i) => {
          const on = track.steps[i] && track.steps[i].length > 0;
          return (
            <button
              key={i}
              className={[
                'step-cell',
                on ? 'on' : '',
                i === currentStep ? 'playhead' : '',
                i % 4 === 0 ? 'beat' : '',
                i % STEPS_PER_BAR === 0 && i > 0 ? 'bar' : '',
              ].join(' ')}
              onClick={() => !locked && onToggleDrumStep(track.id, i)}
              disabled={locked || !track.soundId}
              aria-label={`${track.name} step ${i + 1}`}
              aria-pressed={!!on}
            />
          );
        })}
      </div>
    </div>
  );
}

// ────── Pitched track: piano-roll grid ───────────────────────────────────
// Rows go top-to-bottom in descending pitch order so it reads like a piano
// roll (high = top). Inside the data model, semitone 0 is the lowest pitch
// (root), so when rendering we iterate semitones from high to low.
function PitchedTrack({ track, header, totalSteps, currentStep, locked, onToggleNote, stepCols }) {
  // Build a quick {step → Set<semitone>} lookup for O(1) cell checks.
  const noteMap = track.steps.map(arr => new Set(arr || []));

  return (
    <div className={'pitched-track ' + (header.isAssignTarget ? 'assign-target' : '')}>
      {/* Header strip at the top of the block — meta info + assign target */}
      <div className="pitched-header">
        <TrackMeta {...header} compact />
      </div>

      {/* The grid itself: 12 pitch rows × N step columns, with pitch labels
          embedded as the first column of each row. */}
      <div className="pitched-body">
        <div className="pitch-axis">
          {Array.from({ length: PITCHED_ROWS }).map((_, rowFromTop) => {
            const semi = PITCHED_ROWS - 1 - rowFromTop;       // top row = highest pitch
            const name = PITCH_NAMES[semi];
            const isRoot = semi === 0;
            const isFifth = semi === 7;
            const black  = name.includes('#');
            return (
              <div
                key={semi}
                className={[
                  'pitch-label',
                  black ? 'black' : '',
                  isRoot ? 'root' : '',
                  isFifth ? 'fifth' : '',
                ].join(' ')}
              >
                {name}
                {isRoot && <span className="pitch-octave">{root_octave_label(track.category)}</span>}
              </div>
            );
          })}
        </div>

        <div className="pitched-grid" style={{ gridTemplateColumns: stepCols }}>
          {Array.from({ length: PITCHED_ROWS }).map((_, rowFromTop) => {
            const semi = PITCHED_ROWS - 1 - rowFromTop;
            const name = PITCH_NAMES[semi];
            const black = name.includes('#');
            const isRoot = semi === 0;
            return Array.from({ length: totalSteps }).map((_, i) => {
              const active = noteMap[i].has(semi);
              return (
                <button
                  key={`${semi}-${i}`}
                  className={[
                    'step-cell',
                    'pitched-cell',
                    active ? 'on' : '',
                    i === currentStep ? 'playhead' : '',
                    i % 4 === 0 ? 'beat' : '',
                    i % STEPS_PER_BAR === 0 && i > 0 ? 'bar' : '',
                    black ? 'lane-black' : '',
                    isRoot ? 'lane-root' : '',
                  ].join(' ')}
                  onClick={() => !locked && onToggleNote(track.id, i, semi)}
                  disabled={locked || !track.soundId}
                  title={`${name} · step ${i + 1}`}
                  aria-label={`${track.name} ${name} step ${i + 1}`}
                  aria-pressed={active}
                />
              );
            });
          })}
        </div>
      </div>
    </div>
  );
}

// Small helper to show which octave the root note actually sits at (so the
// player knows bass C2 is two octaves below melody C4).
function root_octave_label(category) {
  if (category === 'bass')   return '2';
  if (category === 'melody') return '4';
  return '';
}
