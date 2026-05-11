// Group raw kit categories into the four user-facing panels per design spec.
// Drums folds in kick/snare/clap/hat — they all live under one section.
const KIT_GROUPS = [
  { id: 'drums',  label: 'DRUMS',  cats: ['kick', 'snare', 'clap', 'hat'] },
  { id: 'bass',   label: 'BASS',   cats: ['bass']                          },
  { id: 'melody', label: 'MELODY', cats: ['melody']                        },
  { id: 'fx',     label: 'FX',     cats: ['fx']                            },
];

export default function SoundKit({
  kit, beat, locked, armedSoundId, onArm, onPreview,
}) {
  if (!kit) {
    return (
      <aside className="kit-panel">
        <div className="panel-header">SOUND KIT</div>
        <div className="kit-empty">Loading kit…</div>
      </aside>
    );
  }

  // Map soundId → list of lane labels currently using it. Walks the live
  // tracks list (which can be dynamic now), not the static TRACK_SLOTS.
  const usedBy = {};
  for (const t of beat.tracks) {
    if (!t.soundId) continue;
    (usedBy[t.soundId] = usedBy[t.soundId] || []).push(t.name || t.id);
  }

  return (
    <aside className="kit-panel">
      <div className="panel-header">
        <span>SOUND KIT</span>
        {armedSoundId && (
          <button className="kit-cancel" onClick={() => onArm(null)} title="Cancel (Esc)">
            ✕ CANCEL
          </button>
        )}
      </div>

      <div className="kit-scroll">
        {KIT_GROUPS.map(group => {
          const sounds = group.cats.flatMap(cat => kit.sounds[cat] || []);
          if (!sounds.length) return null;
          return (
            <div key={group.id} className="kit-group">
              <div className="kit-group-label">{group.label}</div>
              {sounds.map(s => {
                const isArmed = armedSoundId === s.id;
                const lanes = usedBy[s.id] || [];
                return (
                  <div key={s.id} className={'kit-row ' + (isArmed ? 'armed ' : '') + (lanes.length ? 'used' : '')}>
                    <button
                      className="kit-preview"
                      onClick={(e) => { e.stopPropagation(); onPreview(s.id); }}
                      title="Preview"
                      aria-label={`Preview ${s.label}`}
                    >▸</button>
                    <button
                      className="kit-name"
                      onClick={() => !locked && onArm(s.id)}
                      disabled={locked}
                      title={locked ? '' : (isArmed ? 'Click a track to assign' : 'Tap, then tap a track')}
                    >
                      <span className="kit-name-label">{s.label}</span>
                      {lanes.length > 0 && (
                        <span className="kit-lane-tag">{lanes.join(' · ')}</span>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {armedSoundId && (
        <div className="kit-arm-hint">
          Click a matching track →
        </div>
      )}
    </aside>
  );
}
