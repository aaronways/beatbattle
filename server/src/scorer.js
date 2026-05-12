// Algorithmic beat scorer.
//
// Players cannot vote for themselves and there's only one of each in a 1v1
// match — so without spectators, every match would deadlock at 1-1. This
// scorer breaks ties by analyzing the actual musical content of each beat.
//
// Design philosophy: reward musicality, not raw activity. A simple beat with
// a clear groove and an in-key melody scores higher than a chaotic wall of
// random notes. Specifically, we look at:
//
//   1. Rhythmic foundation: kick on 1, backbeat on 2/4, some filler between.
//      This is the spine of nearly every popular music genre. Absence is
//      heavily penalized; presence is the single biggest score component.
//
//   2. Harmonic coherence: pitched notes (bass + melody) that fit a single
//      key. We try all 24 major/minor scales and pick the best fit. Notes
//      outside the key cost points; strong scale degrees (root, 5th, 4th)
//      earn extra.
//
//   3. Kick/bass pocket: bass notes near kick hits create groove. Bass that
//      wanders independently is dock'd.
//
//   4. Variation with continuity: bar 2 should differ from bar 1 (so it's
//      not just a 1-bar loop on repeat) but not COMPLETELY differ (that's
//      noise, not composition). We measure the bar-to-bar similarity and
//      reward the "small-edit" sweet spot.
//
//   5. Repetition with intent: short motifs (4 or 8 steps) that recur are
//      what gives a beat a hook. Detected by sub-pattern frequency.
//
//   6. Track usage: more lanes = more texture, but with hard diminishing
//      returns. Two well-used tracks beat eight half-used ones.
//
// All weights are tunable. The current values were picked to put a "good
// beat" (kick on 1, snare on 3, hat on offbeats, simple bass in C major,
// recognizable melody) in roughly the 70-90 range, and a chaotic random
// beat in the 20-40 range. Empty beats score < 0 to ensure they always lose.

import { STEPS_PER_BAR } from '../../shared/gameRules.js';

// Major scale intervals (semitones above the root, 0-11).
// All other modes/scales can be derived by rotating this.
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

// Strong scale degrees — the root, perfect fifth, and perfect fourth.
// These are the most consonant intervals and define tonality. Used to
// give extra credit when the bass camps on these.
const STRONG_DEGREES = [0, 7, 5];

// Build all 12 transpositions of a scale (one starting on each chromatic
// pitch). Cached at module load.
function buildScales() {
  const out = [];
  for (let root = 0; root < 12; root++) {
    out.push({
      type: 'major',
      root,
      pitches: new Set(MAJOR_SCALE.map(p => (p + root) % 12)),
    });
    out.push({
      type: 'minor',
      root,
      pitches: new Set(MINOR_SCALE.map(p => (p + root) % 12)),
    });
  }
  return out;
}
const SCALES = buildScales();

// Given a flat list of semitones used in pitched tracks, find the scale
// that best fits. Returns { scale, inKeyRatio } where inKeyRatio is the
// fraction of notes that landed inside the best-fit scale.
function detectKey(semis) {
  if (semis.length === 0) return { scale: null, inKeyRatio: 1 };
  const pitchCounts = new Array(12).fill(0);
  for (const s of semis) {
    pitchCounts[((s % 12) + 12) % 12]++;
  }
  let best = null;
  let bestHits = -1;
  for (const scale of SCALES) {
    let hits = 0;
    for (let p = 0; p < 12; p++) {
      if (pitchCounts[p] === 0) continue;
      if (scale.pitches.has(p)) hits += pitchCounts[p];
    }
    // Tie-breaker: prefer the scale whose root is the most-played pitch.
    // Two scales might "fit" all notes (C major and A minor share notes),
    // but the tonic of the actual key is usually the most-emphasized note.
    const rootWeight = pitchCounts[scale.root] * 0.5;
    const total = hits + rootWeight;
    if (total > bestHits) {
      bestHits = total;
      best = scale;
    }
  }
  return {
    scale: best,
    inKeyRatio: bestHits > 0 ? Math.min(1, bestHits / semis.length) : 0,
  };
}

// Collect every pitched semitone (with offset wrapped to 0-11) across
// pitched tracks. Returns a flat array, one entry per note triggered
// (so chords contribute multiple entries per step).
function collectPitchedNotes(beat) {
  const out = [];
  for (const t of beat.tracks) {
    if (t.type !== 'pitched') continue;
    if (!t.soundId) continue;
    for (const cell of t.steps) {
      if (!cell) continue;
      for (const semi of cell) out.push(semi);
    }
  }
  return out;
}

// Score the rhythmic foundation: kick should land on the downbeat (step 0
// of each bar) and snare/clap on the backbeat (steps 4 and 12 — beats 2
// and 4 in a 4/4 bar).
//
// Returns 0-40. Most beats land 15-35.
function scoreRhythm(beat) {
  let score = 0;
  const bars = beat.bars;
  const stepsPerBar = STEPS_PER_BAR;

  // ── Kick on downbeat ───────────────────────────────────────────────
  // Look at any track in the kick category. A solid kick pattern hits
  // step 0 of every bar (or at least most of them).
  const kickTracks = beat.tracks.filter(t => t.category === 'kick' && t.soundId);
  if (kickTracks.length > 0) {
    let kicksOnOne = 0;
    for (let b = 0; b < bars; b++) {
      const stepIdx = b * stepsPerBar;
      const hit = kickTracks.some(t => t.steps[stepIdx]?.length > 0);
      if (hit) kicksOnOne++;
    }
    const ratio = kicksOnOne / bars;
    // 0 kicks on 1 = -5 (active penalty for missing the most basic rule)
    // All kicks on 1 = +20
    score += Math.round(-5 + ratio * 25);
  } else {
    // No kick at all = real penalty. Beats without kicks feel rootless.
    score -= 10;
  }

  // ── Backbeat (snare/clap on 2 and 4) ───────────────────────────────
  // Step 4 = beat 2, step 12 = beat 4.
  const backbeatTracks = beat.tracks.filter(
    t => (t.category === 'snare' || t.category === 'clap') && t.soundId
  );
  if (backbeatTracks.length > 0) {
    let backbeatHits = 0;
    let possible = 0;
    for (let b = 0; b < bars; b++) {
      possible += 2;
      const beat2 = b * stepsPerBar + 4;
      const beat4 = b * stepsPerBar + 12;
      if (backbeatTracks.some(t => t.steps[beat2]?.length > 0)) backbeatHits++;
      if (backbeatTracks.some(t => t.steps[beat4]?.length > 0)) backbeatHits++;
    }
    const ratio = possible > 0 ? backbeatHits / possible : 0;
    score += Math.round(ratio * 15);
  }

  // ── Filler between (any hat/percussion activity in the spaces) ─────
  // Not as critical — many genres skip this — but a totally dry beat
  // with only kick+snare and nothing else feels skeletal. Look for hat,
  // FX, or any other percussion firing on offbeats (odd 8th-note steps).
  const fillerTracks = beat.tracks.filter(
    t => (t.category === 'hat' || t.category === 'fx') && t.soundId
  );
  if (fillerTracks.length > 0) {
    let fillerHits = 0;
    const totalSteps = bars * stepsPerBar;
    for (let i = 0; i < totalSteps; i++) {
      if (fillerTracks.some(t => t.steps[i]?.length > 0)) fillerHits++;
    }
    // Sweet spot: 25-50% of steps have some filler (so it grooves rather
    // than overwhelms). Linear ramp up to 25%, plateau, ramp down past 50%.
    const fillerDensity = fillerHits / totalSteps;
    let fillerScore = 0;
    if (fillerDensity > 0 && fillerDensity <= 0.25) {
      fillerScore = fillerDensity * 40;   // 0..10
    } else if (fillerDensity <= 0.5) {
      fillerScore = 10;                    // plateau
    } else if (fillerDensity <= 0.85) {
      fillerScore = 10 - (fillerDensity - 0.5) * 30; // tapers off
    } else {
      fillerScore = 0;
    }
    score += Math.round(fillerScore);
  }

  return score;
}

// Score the harmonic content: pitched notes that fit a key, with extra
// credit for resting on strong scale degrees. 0-30 typical.
function scoreHarmony(beat) {
  const semis = collectPitchedNotes(beat);
  if (semis.length === 0) {
    // No pitched content at all. Drum-only beats are fine, but they don't
    // earn harmony points. Return 0, not negative.
    return 0;
  }

  const { scale, inKeyRatio } = detectKey(semis);

  // Base harmony score scales with how cleanly the notes fit.
  // 100% in-key = 20 pts. 50% in-key = ~5 pts. Below 50% = penalty.
  let score = 0;
  if (inKeyRatio >= 0.5) {
    score += Math.round((inKeyRatio - 0.5) * 40);   // 0..20
  } else {
    score += Math.round((inKeyRatio - 0.5) * 30);   // -15..0
  }

  // Bonus for actually emphasizing strong scale degrees (root + 5th + 4th
  // are the spine of tonality). Count how many played notes are on these
  // degrees, relative to the detected scale's root.
  if (scale) {
    let strongHits = 0;
    for (const s of semis) {
      const rel = ((s - scale.root) % 12 + 12) % 12;
      if (STRONG_DEGREES.includes(rel)) strongHits++;
    }
    const strongRatio = strongHits / semis.length;
    // Strong-degree emphasis up to 10 extra pts. Hitting more than ~70%
    // strong degrees doesn't add more — that's just a single-note drone.
    score += Math.round(Math.min(0.7, strongRatio) * 14);
  }

  // Dissonance check: count occurrences of intervals known to clash within
  // the same step (minor 2nd = 1 semitone, major 7th = 11 semitones, tritone
  // = 6 semitones with no resolution).
  let dissonantPairs = 0;
  for (const t of beat.tracks) {
    if (t.type !== 'pitched') continue;
    for (const cell of t.steps) {
      if (!cell || cell.length < 2) continue;
      for (let i = 0; i < cell.length; i++) {
        for (let j = i + 1; j < cell.length; j++) {
          const interval = Math.abs(cell[i] - cell[j]) % 12;
          if (interval === 1 || interval === 11 || interval === 6) {
            dissonantPairs++;
          }
        }
      }
    }
  }
  score -= Math.min(15, dissonantPairs * 2);

  return score;
}

// Score how locked-in the bass is with the kick. Bass notes that hit on
// the same step as a kick (or one 16th away) create groove. Bass that
// just wanders gets no points. 0-15.
function scoreBassKickPocket(beat) {
  const kickTracks = beat.tracks.filter(t => t.category === 'kick' && t.soundId);
  const bassTracks = beat.tracks.filter(t => t.category === 'bass' && t.soundId);
  if (kickTracks.length === 0 || bassTracks.length === 0) return 0;

  const totalSteps = beat.bars * STEPS_PER_BAR;
  const kickSteps = new Set();
  for (let i = 0; i < totalSteps; i++) {
    if (kickTracks.some(t => t.steps[i]?.length > 0)) kickSteps.add(i);
  }
  if (kickSteps.size === 0) return 0;

  let basssNotes = 0;
  let basssWithKick = 0;
  for (let i = 0; i < totalSteps; i++) {
    const bassHere = bassTracks.some(t => t.steps[i]?.length > 0);
    if (!bassHere) continue;
    basssNotes++;
    // Same step OR one 16th adjacent counts as "with the kick" (16ths
    // are pretty tight; off by one is still groove-aligned).
    if (kickSteps.has(i) || kickSteps.has(i - 1) || kickSteps.has(i + 1)) {
      basssWithKick++;
    }
  }
  if (basssNotes === 0) return 0;
  const lockRatio = basssWithKick / basssNotes;
  return Math.round(lockRatio * 15);
}

// Bar-to-bar similarity. If every bar is identical, we have a loop, not
// a beat. If every bar is totally different, it's chaos. The musical
// sweet spot is high similarity (say 70-90%) with small intentional
// variations (a fill, a one-off note, an octave drop).
//
// We compute Jaccard similarity (intersection over union) between every
// pair of adjacent bars and reward beats whose average similarity is in
// the sweet spot. 0-15.
function scoreVariation(beat) {
  if (beat.bars < 2) return 5;  // 1-bar beats can't be judged on this; small flat bonus
  const stepsPerBar = STEPS_PER_BAR;

  // Convert each bar's content (across all tracks) into a Set of "trackId@step:notes"
  // strings, then Jaccard-compare.
  const bars = [];
  for (let b = 0; b < beat.bars; b++) {
    const events = new Set();
    for (const t of beat.tracks) {
      if (!t.soundId) continue;
      for (let s = 0; s < stepsPerBar; s++) {
        const cell = t.steps[b * stepsPerBar + s];
        if (cell && cell.length > 0) {
          events.add(`${t.id}@${s}:${cell.join(',')}`);
        }
      }
    }
    bars.push(events);
  }

  // Jaccard similarity of each adjacent bar pair.
  let totalSim = 0;
  let pairs = 0;
  for (let i = 1; i < bars.length; i++) {
    const a = bars[i - 1], b = bars[i];
    if (a.size === 0 && b.size === 0) continue;
    let intersection = 0;
    for (const x of a) if (b.has(x)) intersection++;
    const union = a.size + b.size - intersection;
    if (union === 0) continue;
    totalSim += intersection / union;
    pairs++;
  }
  if (pairs === 0) return 0;
  const avgSim = totalSim / pairs;

  // Sweet spot: avgSim between 0.6 and 0.95.
  //   - 0.0-0.6: too different (chaos), score scales linearly
  //   - 0.6-0.95: in the pocket, max points
  //   - 0.95-1.0: pure loop, mild penalty
  //   - 1.0: identical, harder penalty
  let s;
  if (avgSim < 0.6) s = avgSim * 25;             // 0..15
  else if (avgSim < 0.95) s = 15;                // plateau
  else if (avgSim < 1.0) s = 15 - (avgSim - 0.95) * 100;  // 15..10
  else s = 8;                                     // pure loop: still some credit (it's coherent)
  return Math.round(s);
}

// Reward track diversity, with diminishing returns. Up to 12.
function scoreTrackUsage(beat) {
  const usedTracks = beat.tracks.filter(t => {
    if (!t.soundId) return false;
    return t.steps.some(c => c && c.length > 0);
  });
  if (usedTracks.length === 0) return 0;
  // 1 track = 2, 2 = 5, 3 = 7, 4 = 9, 5 = 10, 6+ = 12.
  // Diminishing returns: don't reward filling all 8 lanes equally.
  const curve = [0, 2, 5, 7, 9, 10, 11, 12, 12];
  return curve[Math.min(usedTracks.length, 8)];
}

// Detect short motifs (4-step or 8-step) that recur. A beat with a hook
// — a small pattern that returns — feels musical. 0-10.
function scoreMotif(beat) {
  const stepsPerBar = STEPS_PER_BAR;
  if (beat.bars < 2) return 0;

  // For each melodic/bass track, slide a 4-step window across the whole
  // pattern and see if any 4-step sequence appears multiple times.
  // Drum tracks don't count for this (they'd reward straight 16ths trivially).
  let motifHits = 0;
  for (const t of beat.tracks) {
    if (!t.soundId) continue;
    if (t.type !== 'pitched') continue;
    const len = t.steps.length;
    for (let win = 4; win <= 8; win += 4) {
      const seen = new Map();   // window string -> count
      for (let i = 0; i + win <= len; i++) {
        const slice = t.steps.slice(i, i + win)
          .map(c => (c?.length ? c.join(',') : '-'))
          .join('|');
        if (slice === Array(win).fill('-').join('|')) continue;  // all silent
        seen.set(slice, (seen.get(slice) || 0) + 1);
      }
      for (const count of seen.values()) {
        if (count >= 2) motifHits += count - 1;  // each repeat past the first
      }
    }
  }
  return Math.min(10, motifHits * 2);
}

// Active penalties for obvious anti-patterns. Returns a negative number.
function scorePenalties(beat) {
  let penalty = 0;
  const stepsPerBar = STEPS_PER_BAR;
  const totalSteps = beat.bars * stepsPerBar;

  // Total notes across the whole beat.
  let totalNotes = 0;
  for (const t of beat.tracks) {
    if (!t.soundId) continue;
    for (const cell of t.steps) totalNotes += (cell?.length || 0);
  }

  // Empty or near-empty: catastrophic penalty. The beat won't lose just
  // for being sparse, but a beat with literally nothing in it absolutely
  // should lose to any beat with content.
  if (totalNotes === 0) penalty -= 100;
  else if (totalNotes < 4) penalty -= 30;

  // Wall-of-sound: every step has at least one note across all tracks.
  let stepsWithAnyNote = 0;
  for (let i = 0; i < totalSteps; i++) {
    if (beat.tracks.some(t => t.steps[i]?.length > 0)) stepsWithAnyNote++;
  }
  const density = totalSteps > 0 ? stepsWithAnyNote / totalSteps : 0;
  if (density > 0.95) penalty -= 25;
  else if (density > 0.85) penalty -= 12;

  // Buzzer-tracks: any single drum track that fires on >75% of steps is
  // almost never musical. Real drum patterns are sparse (kick on 1+3, snare
  // on 2+4, hats on 8ths at most). A track hitting every 16th is noise.
  for (const t of beat.tracks) {
    if (!t.soundId || t.type !== 'drum') continue;
    const hits = t.steps.filter(c => c?.length > 0).length;
    const trackDensity = hits / totalSteps;
    if (trackDensity > 0.75) penalty -= 12;
  }

  // Kick that hits >50% of steps isn't a kick line, it's percussion mush.
  const kickTracks = beat.tracks.filter(t => t.category === 'kick' && t.soundId);
  for (const t of kickTracks) {
    const hits = t.steps.filter(c => c?.length > 0).length;
    if (hits / totalSteps > 0.5) penalty -= 10;
  }

  return penalty;
}

// Top-level entry point. Returns { score, breakdown } where breakdown is
// a record of each sub-score (useful for debugging / display).
export function scoreBeat(beat) {
  if (!beat || !Array.isArray(beat.tracks)) {
    return { score: -100, breakdown: { error: 'invalid' } };
  }

  const rhythm   = scoreRhythm(beat);
  const harmony  = scoreHarmony(beat);
  const pocket   = scoreBassKickPocket(beat);
  const variation = scoreVariation(beat);
  const tracks   = scoreTrackUsage(beat);
  const motif    = scoreMotif(beat);
  const penalty  = scorePenalties(beat);

  const score = rhythm + harmony + pocket + variation + tracks + motif + penalty;

  return {
    score,
    breakdown: { rhythm, harmony, pocket, variation, tracks, motif, penalty },
  };
}
