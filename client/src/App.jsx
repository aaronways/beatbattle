import { useEffect, useRef, useState } from 'react';
import Home from './components/Home.jsx';
import Lobby from './components/Lobby.jsx';
import BeatEditor from './components/BeatEditor.jsx';
import Playback from './components/Playback.jsx';
import Winner from './components/Winner.jsx';
import Leaderboard from './components/Leaderboard.jsx';
import MatchBrowser from './components/MatchBrowser.jsx';
import SpectatorView from './components/SpectatorView.jsx';
import { connect, socket } from './socket.js';
import { generateKitClient } from './audio/kitGen.js';
import { PHASE, KIT_COMPOSITION } from '../../shared/gameRules.js';

export default function App() {
  const [user, setUser] = useState(null);
  const [room, setRoom] = useState(null);
  const [view, setView] = useState('home'); // home | leaderboard | practice | spectate-browser
  const [practiceKit, setPracticeKit] = useState(null);
  // Tracks the room code we just left, so that any straggler 'room' events
  // for it from the server (in flight when we called leaveRoom) get ignored
  // instead of snapping us back into the room. Cleared after 2s.
  const leavingCodeRef = useRef(null);

  // Initial connect.
  useEffect(() => {
    connect().then(setUser);
    const onRoom = (r) => {
      // Ignore straggler snapshots for a room we just left.
      if (leavingCodeRef.current && r?.code === leavingCodeRef.current) return;
      setRoom(r);
    };
    const onTick = (t) => setRoom(prev => prev ? { ...prev, ...t } : prev);
    // When a room a spectator was watching disappears (both players left),
    // server sends this. We clear local state and bounce them to the browser.
    const onEnded = () => {
      setRoom(null);
      setView('spectate-browser');
    };
    socket.on('room', onRoom);
    socket.on('tick', onTick);
    socket.on('spectateEnded', onEnded);
    return () => {
      socket.off('room', onRoom);
      socket.off('tick', onTick);
      socket.off('spectateEnded', onEnded);
    };
  }, []);

  const enterRoom = (_code) => { /* server pushes 'room' event next */ };
  const enterSpectate = (_code) => { /* server pushes 'room' event with isSpectator: true */ };

  const leaveRoom = () => {
    // Stamp the code we're leaving so any in-flight snapshot for it gets
    // ignored. Cleared shortly after — by then the server is fully aware.
    if (room?.code) {
      leavingCodeRef.current = room.code;
      setTimeout(() => {
        if (leavingCodeRef.current === room.code) leavingCodeRef.current = null;
      }, 2000);
    }
    // The server-side leaveRoom handles BOTH player and spectator roles —
    // it picks the right cleanup based on which map the user is in.
    if (room?.isSpectator) {
      socket.emit('leaveSpectate');
    } else {
      socket.emit('leaveRoom');
    }
    setRoom(null);
    setView('home');
  };

  const startPractice = () => {
    setPracticeKit(generateKitClient(Date.now() & 0x7fffffff, KIT_COMPOSITION));
    setView('practice');
  };

  // ── Routing ──────────────────────────────────────────────────────────────
  if (view === 'leaderboard') {
    return <Leaderboard onBack={() => setView('home')} />;
  }
  if (view === 'spectate-browser' && !room) {
    return (
      <MatchBrowser
        onBack={() => setView('home')}
        onEnterSpectate={enterSpectate}
      />
    );
  }
  if (view === 'practice') {
    return (
      <BeatEditor
        room={null}
        kit={practiceKit}
        isPractice
        onLeave={() => setView('home')}
      />
    );
  }

  // If we're in a room (player or spectator), route by phase.
  if (room) {
    // Spectator routing — different from player routing because spectators
    // never see the editor.
    if (room.isSpectator) {
      if (room.phase === PHASE.LOBBY || room.phase === PHASE.BATTLE) {
        return <SpectatorView room={room} onLeave={leaveRoom} />;
      }
      if (room.phase === PHASE.PLAYBACK || room.phase === PHASE.VOTING) {
        return <Playback room={room} />;
      }
      if (room.phase === PHASE.RESULT) {
        return <Winner room={room} onLeave={leaveRoom} />;
      }
    }

    // Player routing.
    if (room.phase === PHASE.LOBBY) {
      return <Lobby room={room} onLeave={leaveRoom} />;
    }
    if (room.phase === PHASE.BATTLE) {
      return (
        <BeatEditor
          room={room}
          kit={room.kit}
          onLeave={leaveRoom}
        />
      );
    }
    if (room.phase === PHASE.PLAYBACK || room.phase === PHASE.VOTING) {
      return <Playback room={room} />;
    }
    if (room.phase === PHASE.RESULT) {
      return <Winner room={room} onLeave={leaveRoom} />;
    }
  }

  // Default home.
  return (
    <Home
      user={user}
      setUser={setUser}
      onEnterRoom={enterRoom}
      onPractice={startPractice}
      onLeaderboard={() => setView('leaderboard')}
      onSpectate={() => setView('spectate-browser')}
    />
  );
}
