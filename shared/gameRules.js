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
// Keeping the inner shape an array (rather than a scalar) avoids a second
// migration later if we want chords on melody tracks, and serialises cleanly
// to JSON for the server to relay.
export function makeEmptyBeat(bpm = BPM_DEFAULT, bars = DEFAULT_BARS) {
  const stepCount = STEPS_PER_BAR * bars;
  return {
    bpm,
    bars,
    tracks: TRACK_SLOTS.map(slot => ({
      id: slot.id,
      name: slot.label,
      type: slot.type,
      soundId: null,
      volume: 0.8,
      pan: 0,
      muted: false,
      solo: false,
      steps: Array.from({ length: stepCount }, () => []),
    })),
    effects: { reverb: 0.15, delay: 0.0, filter: 18000, drive: 0 },
  };
}
