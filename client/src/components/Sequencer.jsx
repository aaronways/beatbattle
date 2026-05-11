import { TRACK_SLOTS, STEPS_PER_BAR, PITCHED_ROWS, PITCH_NAMES } from '../../../shared/gameRules.js';

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
        const slot = TRACK_SLOTS.find(s => s.id === track.id);
        const isAssignTarget = !!armedSoundId && armedCategory === slot?.category && !locked;
        const soundLabel = labelForSound(track.soundId);
        const isPitched = slot?.type === 'pitched';

        const headerProps = {
          slot,
          soundLabel,
          isAssignTarget,
          locked,
          armedSoundId,
          onAssignSound,
          onPreview,
          trackSoundId: track.soundId,
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
function TrackMeta({ slot, soundLabel, isAssignTarget, locked, armedSoundId, trackSoundId, onAssignSound, onPreview, compact }) {
  return (
    <div
      className={'track-meta ' + (compact ? 'compact ' : '') + (isAssignTarget ? 'clickable' : '')}
      onClick={() => isAssignTarget && onAssignSound(slot.id, armedSoundId)}
      role={isAssignTarget ? 'button' : undefined}
      tabIndex={isAssignTarget ? 0 : undefined}
      onKeyDown={(e) => {
        if (isAssignTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onAssignSound(slot.id, armedSoundId);
        }
      }}
    >
      <div className="track-label">{slot?.label || ''}</div>
      <div className="track-sound" title={soundLabel || ''}>
        {soundLabel
          ? <span className="track-sound-name">{soundLabel}</span>
          : <span className="track-sound-empty">— empty —</span>}
      </div>
      <button
        className="preview-btn"
        onClick={(e) => { e.stopPropagation(); trackSoundId && onPreview(trackSoundId); }}
        disabled={!trackSoundId}
        title="Preview"
        aria-label={`Preview ${slot?.label}`}
      >▸</button>
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
                {isRoot && <span className="pitch-octave">{root_octave_label(track.id)}</span>}
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
function root_octave_label(trackId) {
  if (trackId === 'bass')   return '2';
  if (trackId === 'melody') return '4';
  return '';
}
