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

// ────────────────────────────────────────────────────────────────────────────
// New sounds — second wave (5 per category)
// ────────────────────────────────────────────────────────────────────────────
//
// Design intent: don't just clone existing patches with different envelopes —
// give each one a distinct musical character so a kit picking 4 of 10 kicks
// produces meaningfully different palettes. Each builder follows the same
// (out) → trigger(time, semis) contract, with semis ignored on drums.

// ── Kicks (additional 5) ────────────────────────────────────────────────────

function kickDistorted(out) {
  // Hardcore-style overdriven kick. Add saturation via WaveShaper.
  const s = new Tone.MembraneSynth({
    pitchDecay: 0.05, octaves: 5,
    envelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.1 },
  });
  const shaper = new Tone.WaveShaper(x => Math.tanh(x * 4), 256);
  s.chain(shaper, out);
  return (time) => {
    s.triggerAttackRelease('A1', '8n', time);
    cleanup(s, time, 0.6);
    cleanup(shaper, time, 0.7);
  };
}

function kickClean(out) {
  // 909-style: very short pitch sweep, almost pure sine. No sub-rumble.
  const s = new Tone.MembraneSynth({
    pitchDecay: 0.03, octaves: 3,
    envelope: { attack: 0.0005, decay: 0.25, sustain: 0, release: 0.05 },
  }).connect(out);
  return (time) => { s.triggerAttackRelease('C2', '8n', time); cleanup(s, time, 0.4); };
}

function kickAcoustic(out) {
  // Wooden body resonance — kick from a real drum kit. Bandpass filter
  // shapes the noise transient to give the "beater on skin" attack.
  const body = new Tone.MembraneSynth({
    pitchDecay: 0.025, octaves: 3,
    envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 },
  }).connect(out);
  const click = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.001, decay: 0.02, sustain: 0 },
  });
  const clickFilter = new Tone.Filter(2500, 'bandpass');
  click.chain(clickFilter, out);
  return (time) => {
    body.triggerAttackRelease('B1', '8n', time);
    click.triggerAttackRelease('64n', time, 0.5);
    cleanup(body, time, 0.5);
    cleanup(click, time, 0.2);
    cleanup(clickFilter, time, 0.3);
  };
}

function kickLayered(out) {
  // Click on top of sub: pluck-y high transient + low fundamental. Mix
  // them together for a punch that cuts through busy mixes.
  const sub = new Tone.MembraneSynth({
    pitchDecay: 0.1, octaves: 6,
    envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.2 },
  }).connect(out);
  const click = new Tone.MembraneSynth({
    pitchDecay: 0.005, octaves: 2,
    envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
  }).connect(out);
  return (time) => {
    sub.triggerAttackRelease('F1', '4n', time);     // low body
    click.triggerAttackRelease('C4', '64n', time, 0.6); // high transient
    cleanup(sub, time, 0.8);
    cleanup(click, time, 0.2);
  };
}

function kickLofi(out) {
  // Heavily low-passed and slightly degraded — vinyl/cassette character.
  const s = new Tone.MembraneSynth({
    pitchDecay: 0.06, octaves: 5,
    envelope: { attack: 0.002, decay: 0.5, sustain: 0, release: 0.2 },
  });
  const lpf = new Tone.Filter(800, 'lowpass', -24);
  s.chain(lpf, out);
  return (time) => {
    s.triggerAttackRelease('G1', '4n', time);
    cleanup(s, time, 0.8);
    cleanup(lpf, time, 0.9);
  };
}

// ── Snares (additional 5) ───────────────────────────────────────────────────

function snareBrushed(out) {
  // Jazz brush-on-snare: soft, more wash than crack. No tone component.
  const noise = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.02, decay: 0.18, sustain: 0 },
  });
  const bp = new Tone.Filter(1500, 'bandpass');
  noise.chain(bp, out);
  return (time) => {
    noise.triggerAttackRelease('16n', time, 0.5);
    cleanup(noise, time, 0.3);
    cleanup(bp, time, 0.4);
  };
}

function snareGated(out) {
  // 80s reverb-snare with hard cutoff. Quick burst, "splash" character.
  // Implemented as snare + short bright noise tail with sharp envelope.
  const tone = new Tone.MembraneSynth({
    pitchDecay: 0.015, octaves: 2.5,
    envelope: { attack: 0.001, decay: 0.15, sustain: 0 },
  }).connect(out);
  const tail = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.001 },
  });
  const hp = new Tone.Filter(3000, 'highpass');
  tail.chain(hp, out);
  return (time) => {
    tone.triggerAttackRelease('D3', '16n', time, 0.7);
    tail.triggerAttackRelease('8n', time, 0.6);
    cleanup(tone, time, 0.3);
    cleanup(tail, time, 0.4);
    cleanup(hp, time, 0.5);
  };
}

function snareTrap(out) {
  // Slowed-down trap snare: lower fundamental, slappier transient.
  const tone = new Tone.MembraneSynth({
    pitchDecay: 0.03, octaves: 3,
    envelope: { attack: 0.001, decay: 0.22, sustain: 0 },
  }).connect(out);
  const noise = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.001, decay: 0.15, sustain: 0 },
  }).connect(out);
  return (time) => {
    tone.triggerAttackRelease('A2', '8n', time, 0.8);
    noise.triggerAttackRelease('16n', time, 0.4);
    cleanup(tone, time, 0.4);
    cleanup(noise, time, 0.3);
  };
}

function snareClapLayer(out) {
  // Snare + multi-hand clap stacked. Hybrid attack with body.
  const tone = new Tone.MembraneSynth({
    pitchDecay: 0.01, octaves: 2,
    envelope: { attack: 0.001, decay: 0.1, sustain: 0 },
  }).connect(out);
  const noise = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.08, sustain: 0 },
  }).connect(out);
  return (time) => {
    tone.triggerAttackRelease('C3', '16n', time, 0.6);
    // Three quick noise transients = clap-style stacked hits.
    [0, 0.012, 0.024].forEach(off => noise.triggerAttackRelease('64n', time + off, 0.5));
    cleanup(tone, time, 0.2);
    cleanup(noise, time, 0.2);
  };
}

function snareAcoustic(out) {
  // Real drum-kit snare: clear fundamental + buzzy snare-wire noise tail.
  const tone = new Tone.MembraneSynth({
    pitchDecay: 0.008, octaves: 2,
    envelope: { attack: 0.001, decay: 0.18, sustain: 0 },
  }).connect(out);
  const buzz = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.2, sustain: 0.2, release: 0.08 },
  });
  const bp = new Tone.Filter(4500, 'bandpass');
  buzz.chain(bp, out);
  return (time) => {
    tone.triggerAttackRelease('E3', '16n', time, 0.7);
    buzz.triggerAttackRelease('8n', time, 0.45);
    cleanup(tone, time, 0.3);
    cleanup(buzz, time, 0.4);
    cleanup(bp, time, 0.5);
  };
}

// ── Claps (additional 5) ────────────────────────────────────────────────────

function clapLayered(out) {
  // Multi-hand sample-style. 5 transients with random microtiming.
  const noise = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.001, decay: 0.06, sustain: 0 },
  }).connect(out);
  return (time) => {
    [0, 0.008, 0.016, 0.024, 0.042].forEach(off =>
      noise.triggerAttackRelease('32n', time + off, 0.55 - off));
    cleanup(noise, time, 0.4);
  };
}

function clapFingerSnap(out) {
  // Sharp single transient + woody body. The body is what makes it sound
  // like a finger snap vs. just a click.
  const noise = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.0005, decay: 0.025, sustain: 0 },
  });
  const bp = new Tone.Filter(3500, 'bandpass');
  noise.chain(bp, out);
  const body = new Tone.MembraneSynth({
    pitchDecay: 0.005, octaves: 1,
    envelope: { attack: 0.001, decay: 0.05, sustain: 0 },
  }).connect(out);
  return (time) => {
    noise.triggerAttackRelease('64n', time, 0.7);
    body.triggerAttackRelease('C4', '64n', time, 0.4);
    cleanup(noise, time, 0.2);
    cleanup(bp, time, 0.3);
    cleanup(body, time, 0.2);
  };
}

function clapHandclapHall(out) {
  // Layered clap with a long shimmery tail simulating a hall reverb.
  const noise = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.08, sustain: 0 },
  }).connect(out);
  const tail = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.05, decay: 0.5, sustain: 0, release: 0.2 },
  });
  const hp = new Tone.Filter(2000, 'highpass');
  tail.chain(hp, out);
  return (time) => {
    [0, 0.012, 0.026].forEach(off => noise.triggerAttackRelease('32n', time + off, 0.5));
    tail.triggerAttackRelease('4n', time, 0.25);
    cleanup(noise, time, 0.3);
    cleanup(tail, time, 0.8);
    cleanup(hp, time, 0.9);
  };
}

function clap808(out) {
  // The classic synthetic 808 clap: 4 quick noise bursts at decreasing
  // amplitude. Pure noise — no tonal element.
  const noise = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.04, sustain: 0 },
  });
  const bp = new Tone.Filter(1200, 'bandpass');
  bp.Q.value = 2;
  noise.chain(bp, out);
  return (time) => {
    [0, 0.013, 0.026, 0.052].forEach((off, i) =>
      noise.triggerAttackRelease('64n', time + off, 0.7 - i * 0.15));
    cleanup(noise, time, 0.4);
    cleanup(bp, time, 0.5);
  };
}

function clapLow(out) {
  // Body-thumping clap — most energy in the low-mid range. Less crack,
  // more whoomph.
  const noise = new Tone.NoiseSynth({
    noise: { type: 'brown' },
    envelope: { attack: 0.001, decay: 0.1, sustain: 0 },
  }).connect(out);
  return (time) => {
    [0, 0.014, 0.028].forEach(off => noise.triggerAttackRelease('32n', time + off, 0.6));
    cleanup(noise, time, 0.4);
  };
}

// ── Hats (additional 5) ─────────────────────────────────────────────────────

function hatPedal(out) {
  // Hi-hat closed via pedal: thicker than a stick-hit closed hat, dry.
  const s = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.04, release: 0.01 },
    harmonicity: 4, modulationIndex: 22, resonance: 4000, octaves: 1,
  }).connect(out);
  return (time) => { s.triggerAttackRelease(180, '32n', time, 0.4); cleanup(s, time, 0.3); };
}

function hatGlitch(out) {
  // Pitched-up stutter — three quick MetalSynth hits with rising pitch.
  return (time) => {
    [180, 350, 500].forEach((freq, i) => {
      const s = new Tone.MetalSynth({
        envelope: { attack: 0.001, decay: 0.02, release: 0.005 },
        harmonicity: 6, modulationIndex: 28, resonance: 6500, octaves: 1.2,
      }).connect(out);
      s.triggerAttackRelease(freq, '64n', time + i * 0.015, 0.35);
      cleanup(s, time + i * 0.015, 0.15);
    });
  };
}

function hatLofi(out) {
  // Hat through a low-pass + bit-crush-ish saturation.
  const s = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.05, release: 0.01 },
    harmonicity: 5, modulationIndex: 20, resonance: 5000, octaves: 1.2,
  });
  const lpf = new Tone.Filter(4500, 'lowpass');
  const sat = new Tone.WaveShaper(x => Math.tanh(x * 1.8), 256);
  s.chain(lpf, sat, out);
  return (time) => {
    s.triggerAttackRelease(200, '32n', time, 0.4);
    cleanup(s, time, 0.3);
    cleanup(lpf, time, 0.4);
    cleanup(sat, time, 0.4);
  };
}

function hatTrapRoll(out) {
  // Quick triplet roll — 3 fast hat hits in succession. Trap signature.
  return (time) => {
    [0, 0.04, 0.08].forEach(off => {
      const s = new Tone.MetalSynth({
        envelope: { attack: 0.001, decay: 0.04, release: 0.005 },
        harmonicity: 5.1, modulationIndex: 28, resonance: 6800, octaves: 1.3,
      }).connect(out);
      s.triggerAttackRelease(220, '64n', time + off, 0.4);
      cleanup(s, time + off, 0.2);
    });
  };
}

function hatCrash(out) {
  // Short crash cymbal — splash sound, longer than a hat but still drum-ish.
  const s = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.8, release: 0.4 },
    harmonicity: 12, modulationIndex: 64, resonance: 4500, octaves: 2,
  }).connect(out);
  return (time) => { s.triggerAttackRelease(280, '8n', time, 0.45); cleanup(s, time, 1.4); };
}

// ── Basses (additional 5) ───────────────────────────────────────────────────

function bassGrowl(out) {
  // Heavy detuned growl — saw stack with movement on filter.
  const s = new Tone.MonoSynth({
    oscillator: { type: 'fatsawtooth', count: 3, spread: 25 },
    envelope: { attack: 0.005, decay: 0.5, sustain: 0.8, release: 0.4 },
    filterEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.3, baseFrequency: 150, octaves: 3 },
    filter: { Q: 3 },
  }).connect(out);
  return (time, semis = 0) => { s.triggerAttackRelease(shift('C2', semis), '4n', time, 0.7); cleanup(s, time, 1.0); };
}

function bassAcid(out) {
  // TB-303 acid: squelchy resonant filter, snappy envelope. Iconic.
  const s = new Tone.MonoSynth({
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.001, decay: 0.15, sustain: 0.3, release: 0.15 },
    filterEnvelope: { attack: 0.001, decay: 0.25, sustain: 0.1, release: 0.15, baseFrequency: 180, octaves: 4 },
    filter: { Q: 8 },
  }).connect(out);
  return (time, semis = 0) => { s.triggerAttackRelease(shift('C2', semis), '8n', time, 0.7); cleanup(s, time, 0.5); };
}

function bassWobble(out) {
  // LFO-driven filter wobble: filter cutoff oscillates over the note.
  const s = new Tone.MonoSynth({
    oscillator: { type: 'square' },
    envelope: { attack: 0.005, decay: 0.4, sustain: 0.7, release: 0.4 },
    filterEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.3, baseFrequency: 100, octaves: 3 },
  });
  const lfo = new Tone.LFO('8n', 200, 1500).start();
  lfo.connect(s.filter.frequency);
  s.connect(out);
  return (time, semis = 0) => {
    s.triggerAttackRelease(shift('C2', semis), '2n', time, 0.7);
    cleanup(s, time, 1.2);
    cleanup(lfo, time, 1.3);
  };
}

function bassSynthwave(out) {
  // Bright analog-square bass — classic 80s synthpop bassline.
  const s = new Tone.MonoSynth({
    oscillator: { type: 'square' },
    envelope: { attack: 0.005, decay: 0.2, sustain: 0.6, release: 0.2 },
    filterEnvelope: { attack: 0.005, decay: 0.15, sustain: 0.7, release: 0.2, baseFrequency: 400, octaves: 2 },
  }).connect(out);
  return (time, semis = 0) => { s.triggerAttackRelease(shift('C2', semis), '8n', time, 0.6); cleanup(s, time, 0.6); };
}

function bassFm(out) {
  // FM synthesis: harmonic modulation gives metallic / glassy bass character.
  const s = new Tone.FMSynth({
    harmonicity: 2, modulationIndex: 8,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.005, decay: 0.3, sustain: 0.5, release: 0.3 },
    modulation: { type: 'sine' },
    modulationEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.3, release: 0.3 },
  }).connect(out);
  return (time, semis = 0) => { s.triggerAttackRelease(shift('C2', semis), '4n', time, 0.7); cleanup(s, time, 0.8); };
}

// ── Melodies (additional 5) ─────────────────────────────────────────────────

function melMarimba(out) {
  // Soft mallet instrument: short attack, percussive but tonal. AM synth
  // with bright partials gives the wooden mallet timbre.
  const s = new Tone.AMSynth({
    harmonicity: 3,
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.5 },
    modulation: { type: 'sine' },
    modulationEnvelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.2 },
  }).connect(out);
  return (time, semis = 0) => { s.triggerAttackRelease(shift('C4', semis), '8n', time, 0.7); cleanup(s, time, 0.8); };
}

function melPiano(out) {
  // Rhodes-ish electric piano: triangle + soft attack, mild FM color.
  const s = new Tone.FMSynth({
    harmonicity: 1, modulationIndex: 2,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.005, decay: 0.8, sustain: 0.2, release: 0.8 },
    modulation: { type: 'triangle' },
    modulationEnvelope: { attack: 0.001, decay: 0.3, sustain: 0.1, release: 0.3 },
  }).connect(out);
  return (time, semis = 0) => { s.triggerAttackRelease(shift('C4', semis), '4n', time, 0.55); cleanup(s, time, 1.2); };
}

function melStrings(out) {
  // Sustained string ensemble — slow attack, slow release, multiple
  // detuned voices. Add a fifth on top so even a single note sounds rich.
  const s = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 4, spread: 18 },
    envelope: { attack: 0.5, decay: 0.4, sustain: 0.8, release: 1.5 },
  }).connect(out);
  return (time, semis = 0) => {
    const root = shift('C4', semis);
    s.triggerAttackRelease([root, shift(root, 7), shift(root, 12)], '2n', time, 0.35);
    cleanup(s, time, 2.0);
  };
}

function melFlute(out) {
  // Breathy lead: sine with a noise component for the breath.
  const tone = new Tone.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.08, decay: 0.1, sustain: 0.7, release: 0.4 },
  }).connect(out);
  const breath = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.1, decay: 0.2, sustain: 0.2, release: 0.3 },
  });
  const bp = new Tone.Filter(3000, 'bandpass');
  breath.chain(bp, out);
  return (time, semis = 0) => {
    tone.triggerAttackRelease(shift('C5', semis), '4n', time, 0.6);
    breath.triggerAttackRelease('4n', time, 0.15);
    cleanup(tone, time, 0.8);
    cleanup(breath, time, 0.8);
    cleanup(bp, time, 0.9);
  };
}

function melArp(out) {
  // Arpeggiated pluck — single click triggers a 3-note up-arpeggio.
  // Player can still control the root via semitone offset; arpeggio is
  // built relative to it.
  const s = new Tone.Synth({
    oscillator: { type: 'square' },
    envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.15 },
  }).connect(out);
  const lpf = new Tone.Filter(3000, 'lowpass');
  s.disconnect(); s.chain(lpf, out);
  return (time, semis = 0) => {
    // Root, third, fifth (relative to the playhead's chosen note).
    const root = shift('C4', semis);
    s.triggerAttackRelease(root, '16n', time + 0.00, 0.55);
    s.triggerAttackRelease(shift(root, 4), '16n', time + 0.08, 0.55);
    s.triggerAttackRelease(shift(root, 7), '16n', time + 0.16, 0.55);
    cleanup(s, time, 0.6);
    cleanup(lpf, time, 0.7);
  };
}

// ── FX (additional 5) ───────────────────────────────────────────────────────

function fxVinyl(out) {
  // Quick scratchy noise burst with a downward pitch sweep — vinyl scratch.
  const noise = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.005, decay: 0.15, sustain: 0 },
  });
  const bp = new Tone.Filter(2000, 'bandpass');
  bp.Q.value = 4;
  noise.chain(bp, out);
  return (time) => {
    noise.triggerAttackRelease('8n', time, 0.5);
    bp.frequency.cancelScheduledValues(time);
    bp.frequency.setValueAtTime(3000, time);
    bp.frequency.exponentialRampToValueAtTime(600, time + 0.18);
    cleanup(noise, time, 0.3);
    cleanup(bp, time, 0.4);
  };
}

function fxReverseCymbal(out) {
  // Reverse cymbal swell — slow attack, sharp release. Sounds like
  // tape played backwards.
  const noise = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.8, decay: 0.05, sustain: 0, release: 0.02 },
  });
  const hp = new Tone.Filter(2500, 'highpass');
  noise.chain(hp, out);
  return (time) => {
    noise.triggerAttackRelease('2n', time, 0.5);
    cleanup(noise, time, 1.0);
    cleanup(hp, time, 1.1);
  };
}

function fxGlitch(out) {
  // Digital glitch — rapid pitch jumps with a sawtooth, then silence.
  // Sounds like a CPU error / data corruption.
  return (time) => {
    const pitches = [440, 880, 220, 660, 330];
    pitches.forEach((freq, i) => {
      const s = new Tone.Synth({
        oscillator: { type: 'square' },
        envelope: { attack: 0.001, decay: 0.02, sustain: 0, release: 0.005 },
      }).connect(out);
      s.triggerAttackRelease(freq, '64n', time + i * 0.022, 0.4);
      cleanup(s, time + i * 0.022, 0.1);
    });
  };
}

function fxSweep(out) {
  // Long downward sweep — opposite of fx_riser. Drops the energy.
  // Useful before a drop or section change.
  const s = new Tone.Synth({
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.05, decay: 0.5, sustain: 0.4, release: 0.5 },
  }).connect(out);
  return (time) => {
    s.triggerAttackRelease('A4', '2n', time, 0.4);
    s.frequency.cancelScheduledValues(time);
    s.frequency.setValueAtTime(880, time);
    s.frequency.exponentialRampToValueAtTime(55, time + 1.0);
    cleanup(s, time, 1.5);
  };
}

function fxTelephone(out) {
  // Old telephone ring — two alternating bell-like tones.
  return (time) => {
    [0, 0.18].forEach(off => {
      const s = new Tone.FMSynth({
        harmonicity: 3.5, modulationIndex: 10,
        envelope: { attack: 0.01, decay: 0.12, sustain: 0, release: 0.08 },
        modulationEnvelope: { attack: 0.005, decay: 0.05, sustain: 0, release: 0.05 },
      }).connect(out);
      s.triggerAttackRelease(off === 0 ? 'E5' : 'A5', '16n', time + off, 0.55);
      cleanup(s, time + off, 0.3);
    });
  };
}


function cleanup(node, time, tailSec) {
  setTimeout(() => {
    try { node.dispose(); } catch { /* already gone */ }
  }, (time - Tone.now() + tailSec) * 1000 + 50);
}

// Map from id → builder. The builder takes a destination node and returns
// a "trigger" function (time, semitoneOffset?) → void.
export const SOUND_BUILDERS = {
  // ── Originals ────────────────────────────────────────────────────────
  kick_punch: kickPunch, kick_sub: kickSub, kick_trap: kickTrap, kick_tight: kickTight, kick_boom: kickBoom,
  snare_crisp: snareCrisp, snare_fat: snareFat, snare_rim: snareRim, snare_lofi: snareLofi,
  clap_classic: clapClassic, clap_tight: clapTight, clap_wide: clapWide, clap_snap: clapSnap,
  hat_closed: hatClosed, hat_open: hatOpen, hat_tick: hatTick, hat_metal: hatMetal,
  hat_shaker: hatShaker, hat_ride: hatRide,
  bass_808: bass808, bass_reese: bassReese, bass_sub: bassSub, bass_pluck: bassPluck,
  mel_pluck: melPluck, mel_pad: melPad, mel_bell: melBell, mel_lead: melLead,
  mel_keys: melKeys, mel_chord: melChord, mel_vox: melVox,
  fx_riser: fxRiser, fx_impact: fxImpact, fx_perc: fxPerc, fx_zap: fxZap, fx_noise: fxNoise,

  // ── Second wave (added later) ────────────────────────────────────────
  kick_distorted: kickDistorted, kick_clean: kickClean, kick_acoustic: kickAcoustic,
  kick_layered: kickLayered, kick_lofi: kickLofi,
  snare_brushed: snareBrushed, snare_gated: snareGated, snare_trap: snareTrap,
  snare_clap_layer: snareClapLayer, snare_acoustic: snareAcoustic,
  clap_layered: clapLayered, clap_finger_snap: clapFingerSnap, clap_handclap_hall: clapHandclapHall,
  clap_808: clap808, clap_low: clapLow,
  hat_pedal: hatPedal, hat_glitch: hatGlitch, hat_lofi: hatLofi,
  hat_trap_roll: hatTrapRoll, hat_crash: hatCrash,
  bass_growl: bassGrowl, bass_acid: bassAcid, bass_wobble: bassWobble,
  bass_synthwave: bassSynthwave, bass_fm: bassFm,
  mel_marimba: melMarimba, mel_piano: melPiano, mel_strings: melStrings,
  mel_flute: melFlute, mel_arp: melArp,
  fx_vinyl: fxVinyl, fx_reverse_cymbal: fxReverseCymbal, fx_glitch: fxGlitch,
  fx_sweep: fxSweep, fx_telephone: fxTelephone,
};
