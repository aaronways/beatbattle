// Sound catalog. Each entry is a "recipe" — parameters the client uses to
// synthesize the sound with Tone.js. The server only deals in IDs; it never
// touches audio. Adding a new sound = add an entry here AND a renderer in
// client/src/audio/sounds.js with the same id.

export const SOUND_CATALOG = {
  kick: [
    { id: 'kick_punch',     label: 'Punch Kick'   },
    { id: 'kick_sub',       label: 'Sub Kick'     },
    { id: 'kick_trap',      label: 'Trap Kick'    },
    { id: 'kick_tight',     label: 'Tight Kick'   },
    { id: 'kick_boom',      label: 'Boom Kick'    },
    { id: 'kick_distorted', label: 'Distorted Kick' },
    { id: 'kick_clean',     label: 'Clean Kick'   },
    { id: 'kick_acoustic',  label: 'Acoustic Kick' },
    { id: 'kick_layered',   label: 'Layered Kick' },
    { id: 'kick_lofi',      label: 'Lo-fi Kick'   },
  ],
  snare: [
    { id: 'snare_crisp',       label: 'Crisp Snare'  },
    { id: 'snare_fat',         label: 'Fat Snare'    },
    { id: 'snare_rim',         label: 'Rimshot'      },
    { id: 'snare_lofi',        label: 'Lo-fi Snare'  },
    { id: 'snare_brushed',     label: 'Brushed Snare' },
    { id: 'snare_gated',       label: 'Gated Snare'  },
    { id: 'snare_trap',        label: 'Trap Snare'   },
    { id: 'snare_clap_layer',  label: 'Clap Snare'   },
    { id: 'snare_acoustic',    label: 'Acoustic Snare' },
  ],
  clap: [
    { id: 'clap_classic',         label: 'Classic Clap' },
    { id: 'clap_tight',           label: 'Tight Clap'   },
    { id: 'clap_wide',            label: 'Wide Clap'    },
    { id: 'clap_snap',            label: 'Snap'         },
    { id: 'clap_layered',         label: 'Stacked Clap' },
    { id: 'clap_finger_snap',     label: 'Finger Snap'  },
    { id: 'clap_handclap_hall',   label: 'Hall Clap'    },
    { id: 'clap_808',             label: '808 Clap'     },
    { id: 'clap_low',             label: 'Low Clap'     },
  ],
  hat: [
    { id: 'hat_closed',     label: 'Closed Hat'   },
    { id: 'hat_open',       label: 'Open Hat'     },
    { id: 'hat_tick',       label: 'Tick Hat'     },
    { id: 'hat_metal',      label: 'Metal Hat'    },
    { id: 'hat_shaker',     label: 'Shaker'       },
    { id: 'hat_ride',       label: 'Ride'         },
    { id: 'hat_pedal',      label: 'Pedal Hat'    },
    { id: 'hat_glitch',     label: 'Glitch Hat'   },
    { id: 'hat_lofi',       label: 'Lo-fi Hat'    },
    { id: 'hat_trap_roll',  label: 'Trap Roll'    },
    { id: 'hat_crash',      label: 'Crash'        },
  ],
  bass: [
    { id: 'bass_808',       label: '808'          },
    { id: 'bass_reese',     label: 'Reese'        },
    { id: 'bass_sub',       label: 'Sub'          },
    { id: 'bass_pluck',     label: 'Pluck Bass'   },
    { id: 'bass_growl',     label: 'Growl Bass'   },
    { id: 'bass_acid',      label: 'Acid Bass'    },
    { id: 'bass_wobble',    label: 'Wobble Bass'  },
    { id: 'bass_synthwave', label: 'Synthwave Bass' },
    { id: 'bass_fm',        label: 'FM Bass'      },
  ],
  melody: [
    { id: 'mel_pluck',    label: 'Pluck'        },
    { id: 'mel_pad',      label: 'Pad'          },
    { id: 'mel_bell',     label: 'Bell'         },
    { id: 'mel_lead',     label: 'Lead'         },
    { id: 'mel_keys',     label: 'Keys'         },
    { id: 'mel_chord',    label: 'Chord Stab'   },
    { id: 'mel_vox',      label: 'Vox Chop'     },
    { id: 'mel_marimba',  label: 'Marimba'      },
    { id: 'mel_piano',    label: 'E-Piano'      },
    { id: 'mel_strings',  label: 'Strings'      },
    { id: 'mel_flute',    label: 'Flute'        },
    { id: 'mel_arp',      label: 'Arp'          },
  ],
  fx: [
    { id: 'fx_riser',           label: 'Riser'         },
    { id: 'fx_impact',          label: 'Impact'        },
    { id: 'fx_perc',            label: 'Perc Tap'      },
    { id: 'fx_zap',             label: 'Zap'           },
    { id: 'fx_noise',           label: 'Noise Sweep'   },
    { id: 'fx_vinyl',           label: 'Vinyl Scratch' },
    { id: 'fx_reverse_cymbal',  label: 'Reverse Cymbal' },
    { id: 'fx_glitch',          label: 'Glitch'        },
    { id: 'fx_sweep',           label: 'Down Sweep'    },
    { id: 'fx_telephone',       label: 'Telephone'     },
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
