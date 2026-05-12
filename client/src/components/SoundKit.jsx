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
  collapsed, onToggleCollapse,
}) {
  // Collapsed rail mode — shrunken vertical strip with just a chevron button.
  // We keep this BEFORE the loading check so it works even before the kit
  // arrives, and so the collapsed/expanded grid layout stays consistent.
  if (collapsed) {
    return (
      <aside className="kit-panel collapsed" aria-label="Sound kit (collapsed)">
        <button
          className="panel-collapse-toggle"
          onClick={onToggleCollapse}
          title="Expand sound kit"
          aria-label="Expand sound kit"
        >▶</button>
        <div className="collapsed-label">KIT</div>
        {kit && (
          <div className="collapsed-meta">
            {Object.values(kit.sounds).reduce((n, arr) => n + arr.length, 0)}
          </div>
        )}
      </aside>
    );
  }

  if (!kit) {
    return (
      <aside className="kit-panel">
        <div className="panel-header">
          <span>SOUND KIT</span>
          <button
            className="panel-collapse-btn"
            onClick={onToggleCollapse}
            title="Collapse panel"
            aria-label="Collapse sound kit"
          >◀</button>
        </div>
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
        <div className="panel-header-actions">
          {armedSoundId && (
            <button className="kit-cancel" onClick={() => onArm(null)} title="Cancel (Esc)">
              ✕ CANCEL
            </button>
          )}
          <button
            className="panel-collapse-btn"
            onClick={onToggleCollapse}
            title="Collapse panel"
            aria-label="Collapse sound kit"
          >◀</button>
        </div>
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
