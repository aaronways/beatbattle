// Audio engine. One instance per browser session. Wraps Tone.Transport,
// owns the master FX chain, and knows how to schedule a beat from JSON.
//
// ── Routing topology ──────────────────────────────────────────────────────
//
// Each track has its own "strip":
//
//   synth → trackFilter → trackDrive → trackChannel ─┬─► dry  → driveBus
//                                                    ├─► revSend → reverbReturn
//                                                    └─► dlySend → delayReturn
//
// Then everything sums into the master:
//
//   driveBus + reverbReturn + delayReturn → masterFilter → masterDrive → limiter → out
//
// Per-track sends FEED the same shared reverb/delay returns — so two lanes
// can share the same reverb tail but in different amounts. That's how a mix
// stays glued together; everything sharing FX feels like it's in the same
// space, while individual prominence is set by per-track send levels.

import * as Tone from 'tone';
import { SOUND_BUILDERS } from './sounds.js';
import { STEPS_PER_BAR } from '../../../shared/gameRules.js';

class AudioEngine {
  constructor() {
    this.started = false;
    this.master = null;          // input node for "dry" path
    this.fx = null;              // master FX nodes
    this.busReverb = null;       // reverb-return input
    this.busDelay = null;        // delay-return input
    this.tracks = new Map();     // trackId → { channel, filter, drive, revSend, dlySend }
    this.scheduleId = null;
    this.metronome = null;
    this.metronomeOn = false;
    this.onStep = null;
  }

  async start() {
    if (this.started) return;
    await Tone.start();
    this._buildMaster();
    this.started = true;
  }

  _buildMaster() {
    // Master FX chain — used to color the entire mix at the end.
    const masterReverb = new Tone.Reverb({ decay: 2.5, wet: 0.15 });
    const masterDelay  = new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.3, wet: 0 });
    const masterFilter = new Tone.Filter({ frequency: 18000, type: 'lowpass', rolloff: -24 });
    const masterDrive  = new Tone.Distortion({ distortion: 0, wet: 0 });
    const limiter      = new Tone.Limiter(-1);
    const masterOut    = new Tone.Gain(0.9);

    // The two FX-return buses. They sum together with the dry path at the
    // input of masterFilter, so anything routed via a track send becomes
    // part of the mix.
    this.busReverb = new Tone.Gain(1);
    this.busDelay  = new Tone.Gain(1);

    // Reverb return: input → reverb (100% wet) → masterFilter
    const reverbReturn = new Tone.Reverb({ decay: 3.0, wet: 1 });
    this.busReverb.connect(reverbReturn);
    reverbReturn.connect(masterFilter);

    // Delay return: input → delay (100% wet) → masterFilter
    const delayReturn = new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.45, wet: 1 });
    this.busDelay.connect(delayReturn);
    delayReturn.connect(masterFilter);

    // Dry path also feeds masterFilter.
    masterDrive.connect(masterFilter);
    masterFilter.chain(masterDelay, masterReverb, limiter, masterOut, Tone.getDestination());

    this.fx = {
      reverb: masterReverb,
      delay: masterDelay,
      filter: masterFilter,
      drive: masterDrive,
      reverbReturn,
      delayReturn,
      master: masterOut,
    };
    // "this.master" is the entry point for sounds that play dry through the
    // master chain (used by previews and the metronome).
    this.master = masterDrive;
  }

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

  // Build (or fetch) the full per-track strip. Each strip owns:
  //   - filter: low-pass for tone shaping
  //   - drive:  per-track distortion
  //   - channel: gain/pan/mute/solo
  //   - revSend, dlySend: independent gain sends to the shared reverb/delay buses
  //
  // The synth gets connected to filter, which → drive → channel.
  // From channel we tap THREE outputs: master dry, reverb send, delay send.
  _strip(trackId) {
    let strip = this.tracks.get(trackId);
    if (strip) return strip;

    const filter  = new Tone.Filter({ frequency: 20000, type: 'lowpass', rolloff: -12 });
    const drive   = new Tone.Distortion({ distortion: 0, wet: 0 });
    const channel = new Tone.Channel({ volume: 0, pan: 0 });
    const revSend = new Tone.Gain(0);
    const dlySend = new Tone.Gain(0);

    filter.connect(drive);
    drive.connect(channel);
    channel.connect(this.master);    // dry to master
    channel.connect(revSend);
    channel.connect(dlySend);
    revSend.connect(this.busReverb);
    dlySend.connect(this.busDelay);

    strip = { filter, drive, channel, revSend, dlySend };
    this.tracks.set(trackId, strip);
    return strip;
  }

  // Dispose a single track's strip. Called from the editor when the user
  // removes a track, so the audio graph doesn't accumulate dead nodes.
  removeTrackStrip(trackId) {
    const strip = this.tracks.get(trackId);
    if (!strip) return;
    try {
      strip.filter.dispose();
      strip.drive.dispose();
      strip.channel.dispose();
      strip.revSend.dispose();
      strip.dlySend.dispose();
    } catch { /* already gone */ }
    this.tracks.delete(trackId);
  }

  // Sweep through and dispose strips for any trackId no longer in `liveIds`.
  // Called from schedule() so play sessions don't keep dead strips around.
  _gcStrips(liveIds) {
    for (const trackId of [...this.tracks.keys()]) {
      if (!liveIds.has(trackId)) {
        this.removeTrackStrip(trackId);
      }
    }
  }

  setTrackMix(trackId, opts) {
    const strip = this._strip(trackId);
    const { volume, pan, muted, solo, anySolo, sends, filter: filterHz, drive: driveAmt } = opts;
    if (typeof volume === 'number') {
      strip.channel.volume.value = volume <= 0 ? -Infinity : Tone.gainToDb(volume);
    }
    if (typeof pan === 'number') {
      strip.channel.pan.value = Math.max(-1, Math.min(1, pan));
    }
    const effectiveMute = muted || (anySolo && !solo);
    strip.channel.mute = !!effectiveMute;
    if (sends) {
      if (typeof sends.reverb === 'number') strip.revSend.gain.value = sends.reverb;
      if (typeof sends.delay  === 'number') strip.dlySend.gain.value = sends.delay;
    }
    if (typeof filterHz === 'number') {
      strip.filter.frequency.value = Math.max(20, Math.min(20000, filterHz));
    }
    if (typeof driveAmt === 'number') {
      strip.drive.distortion = driveAmt;
      strip.drive.wet.value = driveAmt > 0 ? 1 : 0;
    }
  }

  // Preview a sound at the sound's root pitch (or with an offset). Plays dry
  // through the master FX, doesn't apply per-track FX.
  preview(soundId, semis = 0) {
    if (!this.started) return;
    const builder = SOUND_BUILDERS[soundId];
    if (!builder) return;
    const trigger = builder(this.master);
    trigger(Tone.now(), semis | 0);
  }

  schedule(beat) {
    if (!this.started) return;
    this.stop();
    this._scheduleInternal(beat);
    // Reset for fresh play.
  }

  // Same as schedule(), but preserves the transport position so the playhead
  // continues from where it was. Used when the user edits a step while the
  // editor is playing — without this, every click jumped the loop back to
  // bar 1.
  scheduleAtPosition(beat) {
    if (!this.started) return;
    const savedPosition = Tone.Transport.position;
    // Compute step index that matches the current position so the visual
    // playhead and the internal stepIdx stay in sync after re-arming.
    const totalSteps = STEPS_PER_BAR * beat.bars;
    const sixteenths = Tone.Time(savedPosition).toTicks() / (Tone.Transport.PPQ / 4);
    const startStep = Math.floor(sixteenths) % totalSteps;
    if (this.scheduleId !== null) {
      Tone.Transport.clear(this.scheduleId);
      this.scheduleId = null;
    }
    Tone.Transport.cancel(0);
    this._scheduleInternal(beat, startStep);
    Tone.Transport.position = savedPosition;
  }

  _scheduleInternal(beat, startStep = 0) {
    Tone.Transport.bpm.value = beat.bpm;
    this.setEffects(beat.effects || {});

    const totalSteps = STEPS_PER_BAR * beat.bars;
    const anySolo = beat.tracks.some(t => t.solo);

    // Reclaim strips for tracks the user has since removed.
    this._gcStrips(new Set(beat.tracks.map(t => t.id)));

    // Apply per-track mix (volume/pan/mute/solo/sends/filter/drive).
    for (const track of beat.tracks) {
      this.setTrackMix(track.id, {
        volume: track.volume,
        pan: track.pan,
        muted: track.muted,
        solo: track.solo,
        anySolo,
        sends: track.sends,           // { reverb, delay }
        filter: track.filter,         // Hz
        drive: track.drive,           // 0..1
      });
    }

    let stepIdx = startStep;
    this.scheduleId = Tone.Transport.scheduleRepeat((time) => {
      const idx = stepIdx % totalSteps;
      if (this.onStep) Tone.Draw.schedule(() => this.onStep(idx), time);

      if (this.metronomeOn && idx % STEPS_PER_BAR === 0) {
        const click = new Tone.Synth({
          oscillator: { type: 'sine' },
          envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.01 },
        }).toDestination();
        click.triggerAttackRelease(idx === 0 ? 'C6' : 'C5', '32n', time, 0.3);
        setTimeout(() => click.dispose(), 200);
      }

      for (const track of beat.tracks) {
        if (!track.soundId) continue;
        const cell = track.steps[idx];
        if (!cell || cell.length === 0) continue;
        const builder = SOUND_BUILDERS[track.soundId];
        if (!builder) continue;
        // Route the new synth into this track's filter (top of the strip).
        const strip = this._strip(track.id);
        for (const semis of cell) {
          const trigger = builder(strip.filter);
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

  pause() { Tone.Transport.pause(); }

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

export const engine = new AudioEngine();
