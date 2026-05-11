// Synth library. Each builder returns a trigger function:
//   trigger(time, semitoneOffset) → void
//
// `semitoneOffset` is added to the sound's notional root pitch. For drum
// sounds the offset is ignored (drums always play at their native pitch).
// For pitched sounds it shifts the playback note in semitones.
//
// Every id here must also exist in server/src/sounds.js — the server picks
// IDs and the client renders them.
//
// Audibility note: any sound below ~40 Hz is inaudible on laptop speakers.
// Kicks and basses are tuned to land their fundamental in the 50–90 Hz range
// where a typical built-in speaker can actually push air.

import * as Tone from 'tone';

// Helper: shift a base note by N semitones, return Tone.js note name.
function shift(note, semitones) {
  return Tone.Frequency(note).transpose(semitones).toNote();
}

// ────── Drums ───────────────────────────────────────────────────────────────
// All drum builders ignore the pitch argument — they always trigger at their
// designed root pitch. Drums use a single trigger per cell.

function kickPunch(out) {
  const s = new Tone.MembraneSynth({
    pitchDecay: 0.04, octaves: 6,
    envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.1 },
  }).connect(out);
  return (time) => { s.triggerAttackRelease('C2', '8n', time); cleanup(s, time, 0.6); };
}

function kickSub(out) {
  // Was A0 (27 Hz) — totally inaudible on laptop speakers. Bumped to E1 (~41 Hz)
  // which still feels sub-y on a real system but at least registers on a laptop.
  const s = new Tone.MembraneSynth({
    pitchDecay: 0.08, octaves: 6,
    envelope: { attack: 0.001, decay: 0.6, sustain: 0, release: 0.2 },
  }).connect(out);
  return (time) => { s.triggerAttackRelease('E1', '4n', time); cleanup(s, time, 0.9); };
}

function kickTrap(out) {
  // Was G0 (24 Hz). Now C1 (~33 Hz) with octaves: 8 → fundamental rides up
  // from C1 to ~C2 over the decay, which is the classic trap-kick swoop.
  const s = new Tone.MembraneSynth({
    pitchDecay: 0.12, octaves: 8,
    envelope: { attack: 0.001, decay: 0.7, sustain: 0, release: 0.3 },
  }).connect(out);
  return (time) => { s.triggerAttackRelease('C1', '2n', time); cleanup(s, time, 1.1); };
}

function kickTight(out) {
  const s = new Tone.MembraneSynth({
    pitchDecay: 0.02, octaves: 4,
    envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.05 },
  }).connect(out);
  return (time) => { s.triggerAttackRelease('C2', '16n', time); cleanup(s, time, 0.4); };
}

function kickBoom(out) {
  // Was F0 (22 Hz). Now A1 (~55 Hz) — punchier and actually audible.
  const s = new Tone.MembraneSynth({
    pitchDecay: 0.18, octaves: 8,
    envelope: { attack: 0.001, decay: 1.0, sustain: 0, release: 0.4 },
  }).connect(out);
  return (time) => { s.triggerAttackRelease('A1', '2n', time); cleanup(s, time, 1.4); };
}

function snareCrisp(out) {
  const noise = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.18, sustain: 0 },
  }).connect(out);
  const tone = new Tone.MembraneSynth({
    pitchDecay: 0.01, octaves: 2,
    envelope: { attack: 0.001, decay: 0.1, sustain: 0 },
  }).connect(out);
  return (time) => {
    noise.triggerAttackRelease('16n', time);
    tone.triggerAttackRelease('A2', '32n', time, 0.4);
    cleanup(noise, time, 0.4); cleanup(tone, time, 0.4);
  };
}

function snareFat(out) {
  const noise = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.002, decay: 0.3, sustain: 0 },
  }).connect(out);
  const tone = new Tone.MembraneSynth({
    pitchDecay: 0.02, octaves: 3,
    envelope: { attack: 0.001, decay: 0.15, sustain: 0 },
  }).connect(out);
  return (time) => {
    noise.triggerAttackRelease('8n', time, 0.8);
    tone.triggerAttackRelease('E2', '16n', time, 0.6);
    cleanup(noise, time, 0.6); cleanup(tone, time, 0.6);
  };
}

function snareRim(out) {
  const s = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.06, release: 0.05 },
    harmonicity: 5.1, modulationIndex: 16, resonance: 4000, octaves: 0.5,
  }).connect(out);
  return (time) => { s.triggerAttackRelease(600, '32n', time, 0.5); cleanup(s, time, 0.3); };
}

function snareLofi(out) {
  const noise = new Tone.NoiseSynth({
    noise: { type: 'brown' },
    envelope: { attack: 0.005, decay: 0.25, sustain: 0 },
  }).connect(out);
  return (time) => { noise.triggerAttackRelease('8n', time); cleanup(noise, time, 0.5); };
}

function clapClassic(out) {
  const noise = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.18, sustain: 0 },
  }).connect(out);
  return (time) => {
    // Multi-hit clap — three quick bursts produce that classic flam.
    [0, 0.012, 0.024].forEach(off => noise.triggerAttackRelease('32n', time + off, 0.7));
    cleanup(noise, time, 0.5);
  };
}

function clapTight(out) {
  const noise = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.08, sustain: 0 },
  }).connect(out);
  return (time) => { noise.triggerAttackRelease('32n', time); cleanup(noise, time, 0.3); };
}

function clapWide(out) {
  const noise = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.002, decay: 0.3, sustain: 0 },
  }).connect(out);
  return (time) => {
    [0, 0.018, 0.036, 0.054].forEach(off => noise.triggerAttackRelease('16n', time + off, 0.6));
    cleanup(noise, time, 0.6);
  };
}

function clapSnap(out) {
  const noise = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.0005, decay: 0.04, sustain: 0 },
  }).connect(out);
  return (time) => { noise.triggerAttackRelease('64n', time); cleanup(noise, time, 0.2); };
}

// ────── Hats / cymbals ──────────────────────────────────────────────────────

function makeHat(out, { dur = 0.05, level = 0.4, baseFreq = 200 } = {}) {
  // MetalSynth in Tone 15 must have frequency set via the constructor's
  // `frequency` option — passing it later via triggerAttack() positional arg
  // works in some versions but is unreliable. Build per-trigger so each hit
  // is fresh.
  const s = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: dur, release: 0.01 },
    harmonicity: 5.1, modulationIndex: 32, resonance: 7000, octaves: 1.5,
  }).connect(out);
  return (time) => { s.triggerAttackRelease(baseFreq, '32n', time, level); cleanup(s, time, dur + 0.2); };
}

const hatClosed = (out) => makeHat(out, { dur: 0.05, level: 0.45, baseFreq: 200 });
const hatOpen   = (out) => makeHat(out, { dur: 0.4,  level: 0.5,  baseFreq: 250 });
const hatTick   = (out) => makeHat(out, { dur: 0.02, level: 0.35, baseFreq: 180 });
const hatMetal  = (out) => makeHat(out, { dur: 0.08, level: 0.55, baseFreq: 220 });

function hatShaker(out) {
  // Was: NoiseSynth + filter, but the filter's tail-cleanup of `noise` was
  // happening before `noise.connect(hp)` had any data flowing because
  // NoiseSynth was never explicitly started. Tone 15 is also stricter about
  // dispose-during-render. Rebuilt as a single chain.
  const noise = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.05, sustain: 0 },
  });
  const hp = new Tone.Filter(8000, 'highpass');
  noise.chain(hp, out);
  return (time) => {
    noise.triggerAttackRelease('32n', time, 0.4);
    cleanup(noise, time, 0.3);
    cleanup(hp, time, 0.4);
  };
}

function hatRide(out) {
  const s = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.5, release: 0.2 },
    harmonicity: 8, modulationIndex: 50, resonance: 5000, octaves: 1.2,
  }).connect(out);
  return (time) => { s.triggerAttackRelease(350, '16n', time, 0.45); cleanup(s, time, 0.8); };
}

// ────── Bass ────────────────────────────────────────────────────────────────
// Pitched. Builder accepts a semitone offset (0..11+) from the root note.
// The root sits in the C2 area so offsets stay in audible bass territory.

function bass808(out) {
  const s = new Tone.MonoSynth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.005, decay: 0.4, sustain: 0.5, release: 0.4 },
    filterEnvelope: { attack: 0.001, decay: 0.1, sustain: 0.5, release: 0.2, baseFrequency: 80, octaves: 1 },
  }).connect(out);
  return (time, semis = 0) => { s.triggerAttackRelease(shift('C2', semis), '8n', time); cleanup(s, time, 0.8); };
}

function bassReese(out) {
  const s = new Tone.MonoSynth({
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.3 },
    filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.2, baseFrequency: 200, octaves: 2 },
  }).connect(out);
  return (time, semis = 0) => { s.triggerAttackRelease(shift('C2', semis), '4n', time, 0.7); cleanup(s, time, 0.8); };
}

function bassSub(out) {
  // Was A1 (55 Hz, marginal on laptops). Now C2 root (65 Hz) which is
  // comfortably audible and still bass-register.
  const s = new Tone.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.01, decay: 0.5, sustain: 0.6, release: 0.5 },
  }).connect(out);
  return (time, semis = 0) => { s.triggerAttackRelease(shift('C2', semis), '4n', time); cleanup(s, time, 1.0); };
}

function bassPluck(out) {
  const s = new Tone.PluckSynth({ attackNoise: 1, dampening: 4000, resonance: 0.85 }).connect(out);
  return (time, semis = 0) => { s.triggerAttackRelease(shift('C2', semis), '8n', time); cleanup(s, time, 0.6); };
}

// ────── Melodic ─────────────────────────────────────────────────────────────
// All pitched. Root = C4 (middle C). Semitone offsets shift up from there.

function melPluck(out) {
  const s = new Tone.PluckSynth({ attackNoise: 0.5, dampening: 5000, resonance: 0.7 }).connect(out);
  return (time, semis = 0) => { s.triggerAttackRelease(shift('C4', semis), '8n', time); cleanup(s, time, 0.5); };
}

function melPad(out) {
  const s = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 30 },
    envelope: { attack: 0.4, decay: 0.5, sustain: 0.6, release: 1.2 },
  }).connect(out);
  return (time, semis = 0) => {
    // Pad plays a fifth on top automatically so even a single click sounds
    // chordal — but the player's chosen pitch still controls the root.
    const root = shift('C4', semis);
    s.triggerAttackRelease([root, shift(root, 7)], '2n', time, 0.4);
    cleanup(s, time, 1.6);
  };
}

function melBell(out) {
  const s = new Tone.FMSynth({
    harmonicity: 3.01, modulationIndex: 14,
    envelope: { attack: 0.001, decay: 1.2, sustain: 0, release: 1.5 },
    modulationEnvelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.5 },
  }).connect(out);
  return (time, semis = 0) => { s.triggerAttackRelease(shift('C5', semis), '4n', time, 0.6); cleanup(s, time, 1.5); };
}

function melLead(out) {
  const s = new Tone.MonoSynth({
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.3 },
    filterEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.4, release: 0.3, baseFrequency: 800, octaves: 2 },
  }).connect(out);
  return (time, semis = 0) => { s.triggerAttackRelease(shift('C4', semis), '8n', time, 0.6); cleanup(s, time, 0.6); };
}

function melKeys(out) {
  const s = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.005, decay: 0.4, sustain: 0.3, release: 0.6 },
  }).connect(out);
  return (time, semis = 0) => { s.triggerAttackRelease(shift('C4', semis), '4n', time, 0.5); cleanup(s, time, 0.8); };
}

function melChord(out) {
  const s = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.005, decay: 0.3, sustain: 0.3, release: 0.5 },
  }).connect(out);
  return (time, semis = 0) => {
    // Always plays a major triad rooted at the player's pitch.
    const root = shift('C4', semis);
    const chord = [root, shift(root, 4), shift(root, 7)];
    s.triggerAttackRelease(chord, '4n', time, 0.5);
    cleanup(s, time, 0.7);
  };
}

function melVox(out) {
  // Was: synth never disposed properly, and the formant filter was the only
  // thing connected to `out` — but the synth's signal still flowed via the
  // pre-built s→formant chain, so it was audible. Kept the chain, simplified.
  const s = new Tone.MonoSynth({
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.05, decay: 0.2, sustain: 0.6, release: 0.4 },
    filterEnvelope: { attack: 0.02, decay: 0.2, sustain: 0.5, release: 0.4, baseFrequency: 700, octaves: 1.5 },
  });
  const formant = new Tone.Filter(1100, 'bandpass', -24);
  s.chain(formant, out);
  return (time, semis = 0) => {
    s.triggerAttackRelease(shift('A4', semis), '4n', time, 0.4);
    cleanup(s, time, 0.8);
    cleanup(formant, time, 0.9);
  };
}

// ────── FX ──────────────────────────────────────────────────────────────────
// Drum-style: pitch arg ignored.

function fxRiser(out) {
  const s = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.5, decay: 0.5, sustain: 0, release: 0.3 },
  });
  const filter = new Tone.Filter(200, 'highpass');
  s.chain(filter, out);
  return (time) => {
    s.triggerAttackRelease('2n', time, 0.4);
    filter.frequency.cancelScheduledValues(time);
    filter.frequency.setValueAtTime(200, time);
    filter.frequency.exponentialRampToValueAtTime(8000, time + 1.0);
    cleanup(s, time, 1.5);
    cleanup(filter, time, 1.6);
  };
}

function fxImpact(out) {
  const noise = new Tone.NoiseSynth({
    noise: { type: 'brown' },
    envelope: { attack: 0.001, decay: 0.6, sustain: 0 },
  }).connect(out);
  // Was C1 (33 Hz) — fundamental inaudible on small speakers. Bumped to G1
  // (~49 Hz) with bigger octaves so the pitch sweep hits the audible band.
  const tone = new Tone.MembraneSynth({
    pitchDecay: 0.5, octaves: 10,
    envelope: { attack: 0.001, decay: 0.8, sustain: 0 },
  }).connect(out);
  return (time) => {
    noise.triggerAttackRelease('4n', time, 0.7);
    tone.triggerAttackRelease('G1', '2n', time, 0.8);
    cleanup(noise, time, 1.0); cleanup(tone, time, 1.0);
  };
}

function fxPerc(out) {
  const s = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.1, release: 0.05 },
    harmonicity: 3.5, modulationIndex: 8, resonance: 3000, octaves: 0.8,
  }).connect(out);
  return (time) => { s.triggerAttackRelease(440, '16n', time, 0.4); cleanup(s, time, 0.4); };
}

function fxZap(out) {
  // Was: triggerAttackRelease then frequency ramp — the ramp happened after
  // the envelope had already started releasing, so on some browsers it was
  // imperceptible. Rebuilt to schedule the ramp BEFORE the attack.
  const s = new Tone.Synth({
    oscillator: { type: 'square' },
    envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.05 },
  }).connect(out);
  return (time) => {
    s.frequency.cancelScheduledValues(time);
    s.frequency.setValueAtTime(880, time);
    s.frequency.exponentialRampToValueAtTime(80, time + 0.12);
    s.triggerAttackRelease(880, '8n', time, 0.6);
    cleanup(s, time, 0.4);
  };
}

function fxNoise(out) {
  const s = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.2, decay: 0.5, sustain: 0, release: 0.2 },
  });
  const filter = new Tone.Filter(2000, 'bandpass', -12);
  s.chain(filter, out);
  return (time) => {
    s.triggerAttackRelease('2n', time, 0.4);
    filter.frequency.cancelScheduledValues(time);
    filter.frequency.setValueAtTime(800, time);
    filter.frequency.exponentialRampToValueAtTime(6000, time + 0.8);
    cleanup(s, time, 1.2);
    cleanup(filter, time, 1.3);
  };
}

// Dispose nodes after their tail. Tone.js doesn't auto-dispose ad-hoc graphs
// and we'd leak audio nodes per step otherwise.
function cleanup(node, time, tailSec) {
  setTimeout(() => {
    try { node.dispose(); } catch { /* already gone */ }
  }, (time - Tone.now() + tailSec) * 1000 + 50);
}

// Map from id → builder. The builder takes a destination node and returns
// a "trigger" function (time, semitoneOffset?) → void.
export const SOUND_BUILDERS = {
  kick_punch: kickPunch, kick_sub: kickSub, kick_trap: kickTrap, kick_tight: kickTight, kick_boom: kickBoom,
  snare_crisp: snareCrisp, snare_fat: snareFat, snare_rim: snareRim, snare_lofi: snareLofi,
  clap_classic: clapClassic, clap_tight: clapTight, clap_wide: clapWide, clap_snap: clapSnap,
  hat_closed: hatClosed, hat_open: hatOpen, hat_tick: hatTick, hat_metal: hatMetal,
  hat_shaker: hatShaker, hat_ride: hatRide,
  bass_808: bass808, bass_reese: bassReese, bass_sub: bassSub, bass_pluck: bassPluck,
  mel_pluck: melPluck, mel_pad: melPad, mel_bell: melBell, mel_lead: melLead,
  mel_keys: melKeys, mel_chord: melChord, mel_vox: melVox,
  fx_riser: fxRiser, fx_impact: fxImpact, fx_perc: fxPerc, fx_zap: fxZap, fx_noise: fxNoise,
};
