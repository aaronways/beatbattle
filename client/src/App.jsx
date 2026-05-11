import { useEffect, useState } from 'react';
import Home from './components/Home.jsx';
import Lobby from './components/Lobby.jsx';
import BeatEditor from './components/BeatEditor.jsx';
import Playback from './components/Playback.jsx';
import Winner from './components/Winner.jsx';
import Leaderboard from './components/Leaderboard.jsx';
import { connect, socket } from './socket.js';
import { generateKitClient } from './audio/kitGen.js';
import { PHASE, KIT_COMPOSITION } from '../../shared/gameRules.js';

export default function App() {
  const [user, setUser] = useState(null);
  const [room, setRoom] = useState(null);
  const [view, setView] = useState('home'); // home | leaderboard | practice
  const [practiceKit, setPracticeKit] = useState(null);

  // Initial connect.
  useEffect(() => {
    connect().then(setUser);
    const onRoom = (r) => setRoom(r);
    const onTick = (t) => setRoom(prev => prev ? { ...prev, ...t } : prev);
    socket.on('room', onRoom);
    socket.on('tick', onTick);
    return () => {
      socket.off('room', onRoom);
      socket.off('tick', onTick);
    };
  }, []);

  const enterRoom = (_code) => { /* server pushes 'room' event next */ };

  const leaveRoom = () => {
    socket.emit('leaveRoom');
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

  // If we're in a room, route by phase.
  if (room) {
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
    />
  );
}
