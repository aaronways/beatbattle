// Right-pane mixer. Vertical rows so it fits in a 320px column.
// Each row: name, volume slider, pan slider, mute, solo. Below, a 2x2 grid
// of master FX knobs (reverb / delay / filter / drive). Per the design spec,
// no advanced DAW controls — just the essentials.
export default function Mixer({ beat, locked, onUpdateTrack, onUpdateEffects }) {
  if (!beat) return null;

  return (
    <aside className="mixer-panel">
      <div className="panel-header">MIXER</div>

      <div className="mixer-tracks">
        {beat.tracks.map(t => (
          <div key={t.id} className={'mix-row-v ' + (t.muted ? 'muted ' : '') + (t.solo ? 'solo' : '')}>
            <div className="mix-row-name">{t.name}</div>
            <div className="mix-row-controls">
              <div className="mix-knob-line">
                <span className="mix-knob-tag">VOL</span>
                <input
                  type="range" min="0" max="1" step="0.01"
                  value={t.volume}
                  onChange={(e) => onUpdateTrack(t.id, { volume: parseFloat(e.target.value) })}
                  disabled={locked}
                  className="mix-slider"
                  aria-label={`${t.name} volume`}
                />
              </div>
              <div className="mix-knob-line">
                <span className="mix-knob-tag">PAN</span>
                <input
                  type="range" min="-1" max="1" step="0.01"
                  value={t.pan}
                  onChange={(e) => onUpdateTrack(t.id, { pan: parseFloat(e.target.value) })}
                  disabled={locked}
                  className="mix-slider pan"
                  aria-label={`${t.name} pan`}
                />
              </div>
              <div className="mix-tag-row">
                <button
                  className={'tag-btn ' + (t.muted ? 'on' : '')}
                  onClick={() => onUpdateTrack(t.id, { muted: !t.muted })}
                  disabled={locked}
                  title="Mute"
                  aria-pressed={t.muted}
                >M</button>
                <button
                  className={'tag-btn solo ' + (t.solo ? 'on' : '')}
                  onClick={() => onUpdateTrack(t.id, { solo: !t.solo })}
                  disabled={locked}
                  title="Solo"
                  aria-pressed={t.solo}
                >S</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mixer-fx">
        <div className="panel-subheader">MASTER FX</div>
        <div className="fx-grid">
          <FxKnob label="Reverb" value={beat.effects.reverb} min={0} max={1} step={0.01}
            onChange={(v) => onUpdateEffects({ reverb: v })} disabled={locked} />
          <FxKnob label="Delay" value={beat.effects.delay} min={0} max={0.8} step={0.01}
            onChange={(v) => onUpdateEffects({ delay: v })} disabled={locked} />
          <FxKnob label="Filter" value={beat.effects.filter} min={200} max={20000} step={50}
            display={(v) => `${(v / 1000).toFixed(1)}k`}
            onChange={(v) => onUpdateEffects({ filter: v })} disabled={locked} />
          <FxKnob label="Drive" value={beat.effects.drive} min={0} max={0.9} step={0.01}
            onChange={(v) => onUpdateEffects({ drive: v })} disabled={locked} />
        </div>
      </div>
    </aside>
  );
}

function FxKnob({ label, value, min, max, step, onChange, disabled, display }) {
  return (
    <div className="fx-knob">
      <div className="fx-name">{label}</div>
      <input
        type="range" min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        aria-label={label}
      />
      <div className="fx-val">{display ? display(value) : value.toFixed(2)}</div>
    </div>
  );
}
