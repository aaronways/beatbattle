// Audio engine. One instance per browser session. Wraps Tone.Transport,
// owns the master FX chain, and knows how to schedule a beat from JSON.

import * as Tone from 'tone';
import { SOUND_BUILDERS } from './sounds.js';
import { STEPS_PER_BAR } from '../../../shared/gameRules.js';

class AudioEngine {
  constructor() {
    this.started = false;
    this.master = null;
    this.fx = null;        // { reverb, delay, filter, drive, output }
    this.trackChannels = new Map(); // trackId → Tone.Channel (per-track mixer strip)
    this.scheduleId = null;
    this.metronome = null;
    this.metronomeOn = false;
    this.onStep = null;    // callback(stepIndex)
  }

  // Tone needs an explicit user gesture before audio can start. Call this
  // from a click handler.
  async start() {
    if (this.started) return;
    await Tone.start();
    this._buildMaster();
    this.started = true;
  }

  _buildMaster() {
    // Master FX chain: drive → filter → delay (parallel) → reverb (parallel) → master.
    const reverb = new Tone.Reverb({ decay: 2.5, wet: 0.15 });
    const delay = new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.3, wet: 0 });
    const filter = new Tone.Filter({ frequency: 18000, type: 'lowpass', rolloff: -24 });
    const drive = new Tone.Distortion({ distortion: 0, wet: 0 });
    const limiter = new Tone.Limiter(-1);
    const master = new Tone.Gain(0.9);

    drive.chain(filter, delay, reverb, limiter, master, Tone.getDestination());
    this.fx = { reverb, delay, filter, drive, master };
    this.master = drive; // the input to the chain
  }

  // Update master FX from a {reverb, delay, filter, drive} dict.
  setEffects({ reverb, delay, filter, drive }) {
    if (!this.fx) return;
    if (typeof reverb === 'number') this.fx.reverb.wet.value = reverb;
    if (typeof delay === 'number') this.fx.delay.wet.value = delay;
    if (typeof filter === 'number') this.fx.filter.frequency.value = filter;
    if (typeof drive === 'number') {
      this.fx.drive.distortion = drive;
      this.fx.drive.wet.value = drive > 0 ? 1 : 0;
    }
  }

  // Get (or create) the per-track mixer strip.
  _channel(trackId) {
    let ch = this.trackChannels.get(trackId);
    if (!ch) {
      ch = new Tone.Channel({ volume: 0, pan: 0 });
      ch.connect(this.master);
      this.trackChannels.set(trackId, ch);
    }
    return ch;
  }

  setTrackMix(trackId, { volume, pan, muted, solo, anySolo }) {
    const ch = this._channel(trackId);
    if (typeof volume === 'number') {
      // volume is 0..1; convert to dB. Special-case 0 → silence.
      ch.volume.value = volume <= 0 ? -Infinity : Tone.gainToDb(volume);
    }
    if (typeof pan === 'number') ch.pan.value = Math.max(-1, Math.min(1, pan));
    // Mute is true if the track is explicitly muted, OR another track is soloed
    // and this one isn't. Caller supplies anySolo so we can decide here.
    const effectiveMute = muted || (anySolo && !solo);
    ch.mute = !!effectiveMute;
  }

  // Trigger one shot of a sound — used for preview clicks in the sound browser.
  // Plays at the sound's root pitch (semitone offset 0) by default.
  preview(soundId, semis = 0) {
    if (!this.started) return;
    const builder = SOUND_BUILDERS[soundId];
    if (!builder) return;
    const trigger = builder(this.master);
    trigger(Tone.now(), semis | 0);
  }

  // Schedule a beat to play on the Transport. Replaces any prior schedule.
  // beat: { bpm, bars, tracks: [{ id, soundId, steps, volume, pan, muted, solo }], effects }
  schedule(beat) {
    if (!this.started) return;
    this.stop();

    Tone.Transport.bpm.value = beat.bpm;
    this.setEffects(beat.effects || {});

    const totalSteps = STEPS_PER_BAR * beat.bars;
    const anySolo = beat.tracks.some(t => t.solo);

    // Apply per-track mix.
    for (const track of beat.tracks) {
      this.setTrackMix(track.id, {
        volume: track.volume,
        pan: track.pan,
        muted: track.muted,
        solo: track.solo,
        anySolo,
      });
    }

    // Schedule a callback every 16th note. Inside the callback we look up
    // which tracks have a hit on this step and trigger their builders.
    let stepIdx = 0;
    this.scheduleId = Tone.Transport.scheduleRepeat((time) => {
      const idx = stepIdx % totalSteps;
      // Visual sync — call back to UI on the main thread (Tone fires on audio thread).
      if (this.onStep) Tone.Draw.schedule(() => this.onStep(idx), time);
      // Metronome.
      if (this.metronomeOn && idx % STEPS_PER_BAR === 0) {
        const click = new Tone.Synth({
          oscillator: { type: 'sine' },
          envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.01 },
        }).toDestination();
        click.triggerAttackRelease(idx === 0 ? 'C6' : 'C5', '32n', time, 0.3);
        setTimeout(() => click.dispose(), 200);
      }
      // Trigger track hits. Each step holds a list of semitone offsets;
      // we fire the synth once per offset (chord = multiple offsets per cell).
      for (const track of beat.tracks) {
        if (!track.soundId) continue;
        const cell = track.steps[idx];
        if (!cell || cell.length === 0) continue;
        const builder = SOUND_BUILDERS[track.soundId];
        if (!builder) continue;
        const ch = this._channel(track.id);
        for (const semis of cell) {
          const trigger = builder(ch);
          trigger(time, semis | 0);
        }
      }
      stepIdx++;
    }, '16n');
  }

  play() {
    if (!this.started) return;
    Tone.Transport.start('+0.05');
  }

  pause() {
    Tone.Transport.pause();
  }

  stop() {
    Tone.Transport.stop();
    Tone.Transport.cancel(0);
    if (this.scheduleId !== null) {
      Tone.Transport.clear(this.scheduleId);
      this.scheduleId = null;
    }
  }

  setMetronome(on) { this.metronomeOn = !!on; }
  setBpm(bpm) { Tone.Transport.bpm.value = bpm; }
}

// Singleton.
export const engine = new AudioEngine();
