# BeatBattle

A 1v1 online beat-making battle game. Two players join a room, both get the
same randomly-selected sound kit, have **10 minutes** to build a beat in a
browser-based step sequencer, and then vote on each other's work.

This is a working **MVP**. The full game loop (matchmake → battle → playback
→ vote → winner → ELO update) runs end-to-end. Scope notes are at the
bottom.

---

## Quickstart

You need **Node.js 18+** and npm.

```bash
# 1. Clone / unzip and enter the project
cd beatbattle

# 2. Install both client and server dependencies
npm run install:all

# 3. Run client + server together (dev mode, hot reload on both)
npm run dev
```

Then open **http://localhost:5173** in two browser windows (or two devices
on the same network — see deployment section). One creates a room, the
other joins by code. Click "Ready up" in both, and the battle starts.

To test the full loop quickly, set a shorter battle duration:

```bash
BATTLE_SECONDS=60 npm run dev
```

That gives you a 60-second round instead of the default 600s.

---

## Project structure

```
beatbattle/
├── package.json              ← root scripts (run client + server together)
├── README.md
│
├── shared/
│   └── gameRules.js          ← phase enum, kit composition, timer constants,
│                                empty-beat factory. Imported by both sides.
│
├── server/
│   ├── package.json
│   └── src/
│       ├── index.js          ← Express + Socket.io entry point
│       ├── rooms.js          ← room state machine (the big one)
│       ├── sounds.js         ← server-side sound catalog + deterministic kit gen
│       ├── elo.js            ← ELO rating math
│       └── store.js          ← in-memory user/match store (swap for SQL later)
│
└── client/
    ├── package.json
    ├── index.html
    ├── vite.config.js
    └── src/
        ├── main.jsx
        ├── App.jsx           ← screen routing based on phase
        ├── socket.js         ← Socket.io client + identity persistence
        ├── styles.css        ← all styles (dark / neon)
        ├── audio/
        │   ├── engine.js     ← Tone.js wrapper, transport, master FX
        │   ├── sounds.js     ← synth recipes (no audio files)
        │   └── kitGen.js     ← client-side kit gen for practice mode
        └── components/
            ├── Home.jsx
            ├── Lobby.jsx
            ├── BeatEditor.jsx
            ├── Sequencer.jsx
            ├── Mixer.jsx
            ├── Playback.jsx
            ├── Winner.jsx
            └── Leaderboard.jsx
```

---

## Architecture notes

- **Server-authoritative timer.** The 10-minute countdown lives on the
  server. Clients receive `tick` events every second and a full `room`
  snapshot on every state change. If the client clock drifts, the server
  truth wins.
- **Deterministic kit selection.** Each room has a seed; `generateKit(seed)`
  picks the same sounds for both players. The seed is the only thing the
  server needs to broadcast for kits to stay in sync.
- **No audio files.** All sounds are synthesized at trigger time via
  Tone.js. Each `soundId` (e.g. `kick_punch`, `bass_808`) maps to a builder
  function in `client/src/audio/sounds.js`. The server only deals in IDs.
  Adding a sound = add an entry to *both* catalogs and a renderer.
- **Beat JSON.** Submissions look like:
  ```json
  {
    "bpm": 140,
    "bars": 4,
    "tracks": [{ "id": "kick", "soundId": "kick_punch", "volume": 0.9,
                  "pan": 0, "muted": false, "solo": false,
                  "steps": [1,0,0,0, 1,0,0,0, ...] }],
    "effects": { "reverb": 0.2, "delay": 0.1, "filter": 12000, "drive": 0 }
  }
  ```
  The server accepts the JSON, stores it, and rebroadcasts during playback.
  Both clients re-render from the same JSON.
- **Anonymous voting.** During `playback` and `voting` phases the server
  hides which beat belongs to which player. Ownership is revealed only on
  the result screen. Players cannot vote for their own beat.
- **Disconnect handling.** A 30-second grace window. If a player doesn't
  reconnect, the remaining player wins by forfeit and the match is
  recorded.
- **Identity persistence.** Guest user IDs are stored in `localStorage`.
  Refreshing the page reconnects to the same in-flight room.

---

## Gameplay flow

1. Open the site. Set a username (or accept the random one).
2. Choose a mode:
   - **Quick Battle** — ranked, matched with the next player to queue.
   - **Create Private Room** — get a 6-letter code, share it.
   - **Join by Code** — enter a friend's code.
   - **Practice** — solo, no opponent, no timer.
   - **Leaderboard** — top 50 by rating.
3. In a private room, both players hit "Ready". Battle starts when both
   are ready.
4. Battle phase: 10 minutes to build a beat. The same shared kit is loaded
   for both players. Click cells in the sequencer to place hits, pick from
   the kit per lane, tweak BPM / bars / FX / mixer.
5. Submit early or wait for the timer. The other player's status (editing
   / submitted / disconnected) is visible.
6. Playback: beat A then beat B, ~1s gap, both anonymized.
7. Voting: 30 seconds. You can replay either beat. You cannot vote for
   yourself.
8. Result: winner reveal, vote count, ELO change (if ranked). Rematch or
   leave.

---

## What works in this MVP

- ✅ Homepage with all four entry points
- ✅ Quick matchmaking queue
- ✅ Private rooms with shareable 6-letter codes
- ✅ Two-player Socket.io rooms
- ✅ Server-authoritative 10-minute timer
- ✅ Deterministic shared sound kit per battle
- ✅ Step sequencer (16 steps × 4 bars by default, 1/2/4/8 bars selectable)
- ✅ 8 lanes (kick, snare, clap, closed hat, open hat, bass, melody, FX)
- ✅ Per-track volume / pan / mute / solo
- ✅ Master reverb / delay / filter / drive
- ✅ BPM control, metronome, play/pause/stop, sound preview
- ✅ Submit beat, anonymized playback, voting
- ✅ Winner screen with vote tally + ELO change
- ✅ Rematch
- ✅ Leaderboard (REST endpoint, top 50 by rating)
- ✅ Practice mode (solo, fresh random kit, no timer)
- ✅ Disconnect grace + forfeit
- ✅ Refresh-to-reconnect (identity in localStorage)

## What's scaffolded but not finished

- 🟡 **Persistence**: data is in-memory; restart wipes everything. The
  `server/src/store.js` API is intentionally narrow so you can drop in
  SQLite or Postgres without touching room logic.
- 🟡 **Accounts / auth**: guest-only. Username is editable but not unique.
- 🟡 **Spectators**: hooks exist (`room.spectators` set, separate vote
  pool) but no UI surfaces them.
- 🟡 **Beat saves / match history**: matches are stored in `store.js` but
  there's no UI to browse a player's past beats.
- 🟡 **Cosmetics shop**: not implemented.

## Suggested next steps

- Replace `store.js` with SQLite (`better-sqlite3`) — schema is implied by
  the in-memory structures and would translate one-to-one.
- Add a piano-roll for melodic lanes (currently melody/bass cycle through
  a minor pentatonic per step — fine for variety, not full musical control).
- Add `<audio>`-render export so winners can download their beat as a WAV
  via `Tone.Offline`.
- Spectator chat with profanity filter.

---

## Deployment notes

- The client is a static SPA — `npm run build --prefix client` produces
  `client/dist/`. Drop it on Netlify, Vercel, S3, anywhere.
- The server is a Node process. Procfile-style: `node server/src/index.js`.
  Render, Fly, Railway, Heroku-style platforms all work. It needs websocket
  support, so behind nginx make sure `proxy_set_header Upgrade $http_upgrade`
  is on.
- Set `VITE_SERVER_URL` at client build time to point at the deployed
  server URL.
- Set `BATTLE_SECONDS` env on the server to override the default 600s.
- The server listens on `PORT` env, default 3001.

---

## Testing checklist

Manual smoke test for the full loop:

- [ ] Open two browser windows (or one window + one incognito).
- [ ] Window 1: enter a name, click "Create Private Room".
- [ ] Copy the room code from the lobby.
- [ ] Window 2: enter a different name, paste the code into "Join by Code".
- [ ] Both windows should see each other in the lobby with avatars.
- [ ] Both click "Ready up". The battle screen should appear in both.
- [ ] Verify both players see the **same** sound options in the lane
      dropdowns (open them and compare labels).
- [ ] Click some cells, hit play — you should hear your pattern.
- [ ] Adjust mixer, FX. Try the metronome.
- [ ] Click "Submit Beat" in both. (Or run with `BATTLE_SECONDS=60` and
      let the timer expire.)
- [ ] Playback screen plays A then B. Both windows hear identical timing.
- [ ] Voting screen appears. The player who *owns* beat A sees that tile
      labeled "Your beat" and disabled. They vote for B (or vice versa).
- [ ] Winner screen shows a winner, the vote count, and (since this was a
      casual private room) no ELO change.
- [ ] Click rematch — back to lobby with a fresh seed and fresh kit.
- [ ] Test disconnect: in the middle of a battle, close one window. After
      ~30s, the remaining window should show a forfeit win.
- [ ] Test refresh: in the middle of a battle, refresh one window. It
      should reconnect to the same room and continue editing.

For the leaderboard:

- [ ] After at least one ranked Quick Battle, open the Leaderboard. Both
      players should appear with updated ratings.

---

## License

MIT for the code. All sounds are synthesized at runtime — no third-party
audio is bundled.
