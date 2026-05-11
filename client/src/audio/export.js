// Beat → MP3 export.
//
// Pipeline:
//   1. renderBeatToBuffer(beat, loops)
//        Uses Tone.Offline to run the same scheduling logic the realtime
//        engine uses, but inside an offline AudioContext that produces an
//        AudioBuffer instead of speaker output. Builds its own master FX
//        chain and per-track channels — does NOT touch the realtime engine.
//
//   2. encodeBufferAsMp3(buffer, kbps)
//        Converts the float32 stereo AudioBuffer to interleaved int16 PCM,
//        then runs lamejs to produce MP3 frame bytes. Returns a Blob.
//
// Reverb note: Tone.Reverb pre-renders its impulse response via OfflineAudio
// under the hood. Calling it from inside another Tone.Offline can deadlock
// in some browsers. We use Tone.JCReverb here instead — algorithmic, no IR
// generation needed — even though the realtime engine uses convolution
// reverb. The sound is similar enough at the wet levels we use.

import * as Tone from 'tone';
// lamejs has a long-standing bug where it references its internal classes
// (MPEGMode, Lame, BitStream) as globals before they're defined, which
// crashes under Vite/Rollup at runtime even though the build succeeds.
// @breezystack/lamejs is a maintained fork that fixes the packaging. Same
// API, just doesn't blow up.
import lamejs from '@breezystack/lamejs';
import { SOUND_BUILDERS } from './sounds.js';
import { STEPS_PER_BAR } from '../../../shared/gameRules.js';

const SAMPLE_RATE = 44100;
const MP3_KBPS = 192;        // 192 kbps stereo — good quality, ~1.4 MB/min
const TAIL_SECONDS = 1.5;    // extra render time so reverb/delay tails decay

/**
 * Render a beat into a stereo AudioBuffer by playing it `loops` times.
 * @param {object} beat - the beat JSON (bpm, bars, tracks, effects)
 * @param {object} opts - { loops, onProgress }
 * @returns {Promise<AudioBuffer>}
 */
export async function renderBeatToBuffer(beat, { loops = 4 } = {}) {
  const secondsPerStep = 60 / beat.bpm / 4;           // 16th note duration
  const totalSteps = beat.bars * STEPS_PER_BAR;
  const loopDuration = totalSteps * secondsPerStep;
  const totalDuration = loopDuration * loops + TAIL_SECONDS;

  // Why this is fiddly: Tone synth constructors implicitly attach to
  // `Tone.getContext()`. If we let `Tone.Offline` do the context swap, the
  // timing of WHEN that swap takes effect (relative to our `new Tone.X(...)`
  // calls inside the callback) is unreliable in v15 — some synths end up
  // bound to the realtime context, then crash when you try to connect them
  // to the offline graph ("cannot connect to AudioNode belonging to a
  // different audio context").
  //
  // Solution: build the OfflineContext explicitly, swap Tone's global
  // context BEFORE constructing anything, then restore it in `finally`.
  const realtimeContext = Tone.getContext();
  const offlineCtx = new Tone.OfflineContext(2, totalDuration, SAMPLE_RATE);

  try {
    Tone.setContext(offlineCtx);

    // ── Master FX (offline-friendly substitutes) ──────────────────────
    const masterReverbWet = new Tone.JCReverb({ roomSize: 0.75, wet: beat.effects.reverb });
    const masterDelayWet  = new Tone.FeedbackDelay({
      delayTime: '8n.', feedback: 0.3, wet: beat.effects.delay,
    });
    const masterFilter = new Tone.Filter({
      frequency: beat.effects.filter, type: 'lowpass', rolloff: -24,
    });
    const masterDrive  = new Tone.Distortion({
      distortion: beat.effects.drive,
      wet: beat.effects.drive > 0 ? 1 : 0,
    });
    const limiter = new Tone.Limiter(-1);
    const masterOut = new Tone.Gain(0.9);

    // Shared reverb/delay buses for per-track sends (mirrors engine.js routing).
    const busReverb = new Tone.Gain(1);
    const busDelay  = new Tone.Gain(1);
    const reverbReturn = new Tone.JCReverb({ roomSize: 0.85, wet: 1 });
    const delayReturn  = new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.45, wet: 1 });
    busReverb.connect(reverbReturn);
    reverbReturn.connect(masterFilter);
    busDelay.connect(delayReturn);
    delayReturn.connect(masterFilter);

    masterDrive.connect(masterFilter);
    masterFilter.chain(masterDelayWet, masterReverbWet, limiter, masterOut, offlineCtx.destination);

    // ── Per-track strips (filter → drive → channel → dry/sends) ───────
    const anySolo = beat.tracks.some(t => t.solo);
    const strips = new Map();
    for (const track of beat.tracks) {
      const muted = track.muted || (anySolo && !track.solo);
      const filterHz = typeof track.filter === 'number' ? track.filter : 20000;
      const driveAmt = typeof track.drive  === 'number' ? track.drive  : 0;
      const sendsR = track.sends?.reverb || 0;
      const sendsD = track.sends?.delay  || 0;

      const filter = new Tone.Filter({ frequency: filterHz, type: 'lowpass', rolloff: -12 });
      const drive  = new Tone.Distortion({ distortion: driveAmt, wet: driveAmt > 0 ? 1 : 0 });
      const channel = new Tone.Channel({
        volume: track.volume <= 0 ? -Infinity : Tone.gainToDb(track.volume),
        pan: Math.max(-1, Math.min(1, track.pan || 0)),
        mute: muted,
      });
      const revSend = new Tone.Gain(sendsR);
      const dlySend = new Tone.Gain(sendsD);

      filter.connect(drive);
      drive.connect(channel);
      channel.connect(masterDrive);   // dry
      channel.connect(revSend);
      channel.connect(dlySend);
      revSend.connect(busReverb);
      dlySend.connect(busDelay);

      strips.set(track.id, filter);   // synth input is filter (top of strip)
    }

    // ── Schedule the pattern on the OFFLINE transport ─────────────────
    // The offline context has its own transport, fully independent of the
    // realtime one. Using the realtime transport here would (a) emit audio
    // to the speakers, and (b) not actually drive the offline render.
    const transport = offlineCtx.transport;
    transport.bpm.value = beat.bpm;
    const totalStepsAcrossLoops = totalSteps * loops;
    let stepIdx = 0;

    transport.scheduleRepeat((time) => {
      if (stepIdx >= totalStepsAcrossLoops) return;
      const idx = stepIdx % totalSteps;
      for (const track of beat.tracks) {
        if (!track.soundId) continue;
        const cell = track.steps[idx];
        if (!cell || cell.length === 0) continue;
        const builder = SOUND_BUILDERS[track.soundId];
        if (!builder) continue;
        const stripIn = strips.get(track.id);
        for (const semis of cell) {
          const trigger = builder(stripIn);
          trigger(time, semis | 0);
        }
      }
      stepIdx++;
    }, '16n');

    transport.start(0);

    // `offlineCtx.render()` runs the audio graph faster than realtime and
    // returns a Tone Buffer wrapper. Unwrap to the raw AudioBuffer.
    const rendered = await offlineCtx.render();
    return rendered.get ? rendered.get() : rendered;
  } finally {
    // Always restore the realtime context — even if rendering throws — so
    // the editor keeps working after a failed export attempt.
    Tone.setContext(realtimeContext);
  }
}

/**
 * Encode a stereo AudioBuffer into an MP3 Blob using lamejs.
 *
 * lamejs wants Int16 PCM samples. We process in 1152-sample chunks (one
 * MP3 frame's worth of input) so the encoder has clean boundaries.
 *
 * @param {AudioBuffer} buffer
 * @param {object} opts - { kbps, onProgress }
 * @returns {Blob}
 */
export function encodeBufferAsMp3(buffer, { kbps = MP3_KBPS, onProgress } = {}) {
  const numChannels = Math.min(buffer.numberOfChannels, 2);
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;

  // Pull channels. AudioBuffer might be mono; in that case duplicate L → R.
  const leftF32  = buffer.getChannelData(0);
  const rightF32 = numChannels === 2 ? buffer.getChannelData(1) : leftF32;

  // Convert float32 (-1..1) to int16 (-32768..32767) in-place into new arrays.
  const left  = float32ToInt16(leftF32);
  const right = float32ToInt16(rightF32);

  const encoder = new lamejs.Mp3Encoder(2, sampleRate, kbps);
  const CHUNK = 1152;          // one MP3 frame's worth of PCM samples
  const mp3Data = [];

  for (let i = 0; i < length; i += CHUNK) {
    const end = Math.min(i + CHUNK, length);
    const lChunk = left.subarray(i, end);
    const rChunk = right.subarray(i, end);
    const mp3buf = encoder.encodeBuffer(lChunk, rChunk);
    if (mp3buf.length > 0) mp3Data.push(mp3buf);
    if (onProgress && i % (CHUNK * 100) === 0) {
      onProgress(i / length);
    }
  }
  const flushed = encoder.flush();
  if (flushed.length > 0) mp3Data.push(flushed);
  if (onProgress) onProgress(1);

  return new Blob(mp3Data, { type: 'audio/mpeg' });
}

/**
 * Convert float32 PCM samples to int16 with clipping.
 */
function float32ToInt16(input) {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return out;
}

/**
 * Convenience: render + encode + return an Object URL ready for download.
 * Caller is responsible for revoking the URL when done.
 */
export async function exportBeatAsMp3(beat, { loops = 4, onPhase } = {}) {
  onPhase?.('rendering');
  const buffer = await renderBeatToBuffer(beat, { loops });
  onPhase?.('encoding');
  const blob = encodeBufferAsMp3(buffer);
  onPhase?.('done');
  return {
    blob,
    url: URL.createObjectURL(blob),
    sizeBytes: blob.size,
    durationSec: buffer.duration,
  };
}

/**
 * Trigger a browser download for a Blob. Creates a hidden <a>, clicks it,
 * revokes the URL after a short delay so the download has time to start.
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
