// Sound catalog. Each entry is a "recipe" — parameters the client uses to
// synthesize the sound with Tone.js. The server only deals in IDs; it never
// touches audio. Adding a new sound = add an entry here AND a renderer in
// client/src/audio/sounds.js with the same id.

export const SOUND_CATALOG = {
  kick: [
    { id: 'kick_punch',   label: 'Punch Kick'   },
    { id: 'kick_sub',     label: 'Sub Kick'     },
    { id: 'kick_trap',    label: 'Trap Kick'    },
    { id: 'kick_tight',   label: 'Tight Kick'   },
    { id: 'kick_boom',    label: 'Boom Kick'    },
  ],
  snare: [
    { id: 'snare_crisp',  label: 'Crisp Snare'  },
    { id: 'snare_fat',    label: 'Fat Snare'    },
    { id: 'snare_rim',    label: 'Rimshot'      },
    { id: 'snare_lofi',   label: 'Lo-fi Snare'  },
  ],
  clap: [
    { id: 'clap_classic', label: 'Classic Clap' },
    { id: 'clap_tight',   label: 'Tight Clap'   },
    { id: 'clap_wide',    label: 'Wide Clap'    },
    { id: 'clap_snap',    label: 'Snap'         },
  ],
  hat: [
    { id: 'hat_closed',   label: 'Closed Hat'   },
    { id: 'hat_open',     label: 'Open Hat'     },
    { id: 'hat_tick',     label: 'Tick Hat'     },
    { id: 'hat_metal',    label: 'Metal Hat'    },
    { id: 'hat_shaker',   label: 'Shaker'       },
    { id: 'hat_ride',     label: 'Ride'         },
  ],
  bass: [
    { id: 'bass_808',     label: '808'          },
    { id: 'bass_reese',   label: 'Reese'        },
    { id: 'bass_sub',     label: 'Sub'          },
    { id: 'bass_pluck',   label: 'Pluck Bass'   },
  ],
  melody: [
    { id: 'mel_pluck',    label: 'Pluck'        },
    { id: 'mel_pad',      label: 'Pad'          },
    { id: 'mel_bell',     label: 'Bell'         },
    { id: 'mel_lead',     label: 'Lead'         },
    { id: 'mel_keys',     label: 'Keys'         },
    { id: 'mel_chord',    label: 'Chord Stab'   },
    { id: 'mel_vox',      label: 'Vox Chop'     },
  ],
  fx: [
    { id: 'fx_riser',     label: 'Riser'        },
    { id: 'fx_impact',    label: 'Impact'       },
    { id: 'fx_perc',      label: 'Perc Tap'     },
    { id: 'fx_zap',       label: 'Zap'          },
    { id: 'fx_noise',     label: 'Noise Sweep'  },
  ],
};

// Build a deterministic kit for a given seed. Same seed → same kit, both
// clients in a room get identical sounds.
export function generateKit(seed, composition) {
  const rng = mulberry32(seed);
  const kit = { seed, sounds: {} };
  for (const [category, count] of Object.entries(composition)) {
    const pool = [...SOUND_CATALOG[category]];
    const picks = [];
    for (let i = 0; i < count && pool.length > 0; i++) {
      const idx = Math.floor(rng() * pool.length);
      picks.push(pool.splice(idx, 1)[0]);
    }
    kit.sounds[category] = picks;
  }
  return kit;
}

// Tiny seeded RNG. mulberry32 is a single-line PRNG that's adequate for
// "pick from a list" work; we don't need cryptographic quality here.
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
