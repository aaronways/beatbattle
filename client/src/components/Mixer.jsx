import { useState, useEffect } from 'react';

// Right-pane mixer. Vertical rows so it fits in a 320px column.
// Each row's basic state: volume, pan, mute, solo. Click ▾ to expand the
// row and reveal per-track effect sends + tone shaping (filter, drive,
// reverb send, delay send).
//
// Per-track sends feed INTO the master reverb/delay returns — so the master
// reverb knob still controls overall ambience, while per-track sends decide
// how WET each individual lane sits in that ambience. This is how real mixes
// stay glued together: shared FX returns, varying send amounts.
export default function Mixer({ beat, locked, onUpdateTrack, onUpdateEffects, onBeginDrag, onEndDrag }) {
  const [expanded, setExpanded] = useState(() => new Set());

  // Prune expanded set when tracks disappear so stale ids don't accumulate
  // and so reusing the same id later doesn't unexpectedly re-open a row.
  useEffect(() => {
    if (!beat) return;
    const liveIds = new Set(beat.tracks.map(t => t.id));
    setExpanded(prev => {
      const cleaned = new Set();
      let changed = false;
      for (const id of prev) {
        if (liveIds.has(id)) cleaned.add(id);
        else changed = true;
      }
      return changed ? cleaned : prev;
    });
  }, [beat?.tracks]);

  if (!beat) return null;

  // Drag handlers attached to every continuous input. Pointer events fire
  // before keyboard/click events for sliders, so this is the right hook.
  const dragProps = {
    onPointerDown: onBeginDrag,
    onPointerUp: onEndDrag,
    onPointerCancel: onEndDrag,
  };

  const toggle = (id) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <aside className="mixer-panel">
      <div className="panel-header">MIXER</div>

      <div className="mixer-tracks">
        {beat.tracks.map(t => {
          const isOpen = expanded.has(t.id);
          // Safe accessors so older submitted beats (without sends/filter/drive)
          // still render without crashing.
          const sends = t.sends || { reverb: 0, delay: 0 };
          const trackFilter = typeof t.filter === 'number' ? t.filter : 20000;
          const trackDrive = typeof t.drive === 'number' ? t.drive : 0;
          return (
            <div key={t.id} className={'mix-row-v ' + (t.muted ? 'muted ' : '') + (t.solo ? 'solo ' : '') + (isOpen ? 'open' : '')}>
              <div className="mix-row-header">
                <div className="mix-row-name">{t.name}</div>
                <button
                  className="mix-expand"
                  onClick={() => toggle(t.id)}
                  title={isOpen ? 'Collapse' : 'Expand FX'}
                  aria-expanded={isOpen}
                >{isOpen ? '▴' : '▾'}</button>
              </div>
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
                    {...dragProps}
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
                    {...dragProps}
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

              {isOpen && (
                <div className="mix-row-fx">
                  <MiniSlider
                    label="REV"
                    value={sends.reverb}
                    min={0} max={1} step={0.01}
                    onChange={(v) => onUpdateTrack(t.id, { sends: { ...sends, reverb: v } })}
                    disabled={locked}
                    dragProps={dragProps}
                  />
                  <MiniSlider
                    label="DLY"
                    value={sends.delay}
                    min={0} max={1} step={0.01}
                    onChange={(v) => onUpdateTrack(t.id, { sends: { ...sends, delay: v } })}
                    disabled={locked}
                    dragProps={dragProps}
                  />
                  <MiniSlider
                    label="FLT"
                    value={trackFilter}
                    min={200} max={20000} step={50}
                    display={(v) => `${(v / 1000).toFixed(1)}k`}
                    onChange={(v) => onUpdateTrack(t.id, { filter: v })}
                    disabled={locked}
                    dragProps={dragProps}
                  />
                  <MiniSlider
                    label="DRV"
                    value={trackDrive}
                    min={0} max={0.9} step={0.01}
                    onChange={(v) => onUpdateTrack(t.id, { drive: v })}
                    disabled={locked}
                    dragProps={dragProps}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mixer-fx">
        <div className="panel-subheader">MASTER FX</div>
        <div className="fx-grid">
          <FxKnob label="Reverb" value={beat.effects.reverb} min={0} max={1} step={0.01}
            onChange={(v) => onUpdateEffects({ reverb: v })} disabled={locked} dragProps={dragProps} />
          <FxKnob label="Delay" value={beat.effects.delay} min={0} max={0.8} step={0.01}
            onChange={(v) => onUpdateEffects({ delay: v })} disabled={locked} dragProps={dragProps} />
          <FxKnob label="Filter" value={beat.effects.filter} min={200} max={20000} step={50}
            display={(v) => `${(v / 1000).toFixed(1)}k`}
            onChange={(v) => onUpdateEffects({ filter: v })} disabled={locked} dragProps={dragProps} />
          <FxKnob label="Drive" value={beat.effects.drive} min={0} max={0.9} step={0.01}
            onChange={(v) => onUpdateEffects({ drive: v })} disabled={locked} dragProps={dragProps} />
        </div>
      </div>
    </aside>
  );
}

function FxKnob({ label, value, min, max, step, onChange, disabled, display, dragProps }) {
  return (
    <div className="fx-knob">
      <div className="fx-name">{label}</div>
      <input
        type="range" min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        aria-label={label}
        {...(dragProps || {})}
      />
      <div className="fx-val">{display ? display(value) : value.toFixed(2)}</div>
    </div>
  );
}

// Compact per-track slider that fits within the row's narrow column.
function MiniSlider({ label, value, min, max, step, onChange, display, disabled, dragProps }) {
  return (
    <div className="mini-slider">
      <span className="mini-tag">{label}</span>
      <input
        type="range" min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        className="mix-slider"
        {...(dragProps || {})}
      />
      <span className="mini-val">{display ? display(value) : value.toFixed(2)}</span>
    </div>
  );
}
