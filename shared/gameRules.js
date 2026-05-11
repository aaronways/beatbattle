// Shared game rules - imported by both client and server.
// Keep this file dependency-free so it can be used in any environment.

export const ROOM_CODE_LENGTH = 6;

// Default battle duration. Spec says 10 minutes; we expose a knob via env on the server.
export const DEFAULT_BATTLE_SECONDS = 10 * 60;

// How long voting stays open after both beats have played.
export const VOTING_SECONDS = 30;

// Grace period for a disconnected player to come back before they auto-forfeit.
export const RECONNECT_GRACE_SECONDS = 30;

// BPM bounds for the editor.
export const BPM_MIN = 60;
export const BPM_MAX = 200;
export const BPM_DEFAULT = 140;

// Sequencer dimensions.
export const STEPS_PER_BAR = 16;
export const DEFAULT_BARS = 4;

// Number of semitones rendered in a pitched track's piano roll. 12 = one full
// octave (C..B). The track's "root pitch" (defined in sounds.js per builder)
// is semitone 0; the row above is +1, etc. Keep this small enough that the
// roll fits on screen without dominating the viewport.
export const PITCHED_ROWS = 12;

// Pitch-class names for the piano-roll label column. Index = semitone offset
// from the track's root. Sharp accidentals only; flats would map to the same
// rows.
export const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Composition of every battle's sound kit. Server picks this many sounds from each
// category and sends the same list to both players.
export const KIT_COMPOSITION = {
  kick: 2,
  snare: 2,
  clap: 2,
  hat: 3,        // mix of closed + open
  bass: 2,
  melody: 4,     // melodic one-shots / chords
  fx: 3,         // percussion + fx
};

// Track slots in the editor — fixed lanes, each one targets one category.
//
// `type` controls how the lane is rendered and how cells are toggled:
//   - 'drum'    → one horizontal row, cells are on/off triggers at the
//                 sound's native pitch.
//   - 'pitched' → a vertical pitch axis (piano roll). Each cell carries
//                 its own semitone offset and the player composes a melody.
export const TRACK_SLOTS = [
  { id: 'kick',   label: 'Kick',     category: 'kick',   type: 'drum'    },
  { id: 'snare',  label: 'Snare',    category: 'snare',  type: 'drum'    },
  { id: 'clap',   label: 'Clap',     category: 'clap',   type: 'drum'    },
  { id: 'hatC',   label: 'Hat',      category: 'hat',    type: 'drum'    },
  { id: 'hatO',   label: 'Open Hat', category: 'hat',    type: 'drum'    },
  { id: 'bass',   label: 'Bass',     category: 'bass',   type: 'pitched' },
  { id: 'melody', label: 'Melody',   category: 'melody', type: 'pitched' },
  { id: 'fx',     label: 'FX',       category: 'fx',     type: 'drum'    },
];

// Room phases — drives UI routing on the client and state machine on the server.
export const PHASE = {
  LOBBY:    'lobby',     // waiting for second player / ready check
  BATTLE:   'battle',    // editing, timer running
  PLAYBACK: 'playback',  // server is broadcasting "play A then B"
  VOTING:   'voting',    // votes open
  RESULT:   'result',    // winner shown
};

// Default empty beat — used as initial state and as a fallback if a player
// never submits anything.
//
// Step model: every track has `steps: Array<Array<number>>` where each entry
// is the list of semitone offsets active at that step.
//   - Empty array = silent.
//   - Drum tracks only ever store [] or [0] (no pitch variation).
//   - Pitched tracks can store any list of offsets [0..PITCHED_ROWS-1].
//     Multiple values per step = chord.
//
// Track ids are no longer fixed names like "kick" — they're stable unique
// strings (e.g. "kick-1", "kick-2", "melody-1"). This lets users add more
// tracks of the same category dynamically (e.g. two kick lanes) without
// breaking the engine's channel-lookup-by-id contract.
export function makeEmptyBeat(bpm = BPM_DEFAULT, bars = DEFAULT_BARS) {
  const stepCount = STEPS_PER_BAR * bars;
  return {
    bpm,
    bars,
    tracks: TRACK_SLOTS.map((slot, idx) => makeTrack({
      // Default tracks keep the legacy id where possible so existing rooms
      // and submissions don't break. Open Hat is the one exception — uses
      // its own id but maps to the "hat" category.
      id: slot.id === 'hatO' ? 'hatO-1' : `${slot.category}-1`,
      label: slot.label,
      category: slot.category,
      type: slot.type,
      preferOpenHat: slot.id === 'hatO',     // used by auto-fill heuristic
    }, stepCount)),
    effects: { reverb: 0.15, delay: 0.0, filter: 18000, drive: 0 },
  };
}

// Build a fresh track record. Separate factory so the editor can construct
// extra tracks at runtime in the same shape.
export function makeTrack({ id, label, category, type, preferOpenHat = false }, stepCount) {
  return {
    id,
    name: label,
    category,
    type,
    soundId: null,
    volume: 0.8,
    pan: 0,
    muted: false,
    solo: false,
    // Per-track effect sends. 0 = none, 1 = full. These are sends INTO the
    // shared master FX returns — so two tracks can share the same reverb
    // tail but in different amounts. This is what makes mixes sit together.
    sends: { reverb: 0, delay: 0 },
    // Per-track high-cut (low-pass) and drive let each track be shaped
    // independently of master FX. filter 20000 = fully open (no cut).
    filter: 20000,
    drive: 0,
    preferOpenHat,
    steps: Array.from({ length: stepCount }, () => []),
  };
}

// How many tracks of each category a player is allowed to add. We cap at the
// kit composition for that category — no point allowing a 4th kick track
// when the kit only ships 2 kick sounds. (Players can still leave duplicate
// soundIds across tracks if they want.)
export function maxTracksForCategory(category) {
  return KIT_COMPOSITION[category] || 2;
}
