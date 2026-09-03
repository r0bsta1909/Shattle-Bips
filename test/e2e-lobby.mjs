// End-to-End: zwei menschliche Clients, Lobby erstellen + beitreten,
// vollstaendige Partie ueber den echten Server.
process.env.PORT = process.env.PORT || '3220';
await import('../server/index.js');
await new Promise((r) => setTimeout(r, 400));
const { default: WebSocket } = await import('ws');

const URL = `ws://127.0.0.1:${process.env.PORT}/ws`;
let code = null, finished = 0;

function client(label, onJoined) {
  const ws = new WebSocket(URL);
  const send = (m) => ws.send(JSON.stringify(m));
  ws.on('open', () => { send({ t: 'hello', name: label }); onJoined(send); });
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'joined') { code = code || m.code; console.log(`${label}: in Lobby ${m.code} als Slot ${m.playerId}`); send({ t: 'randomFleet' }); }
    if (m.t === 'randomFleet') send({ t: 'placeFleet', placement: m.placement });
    if (m.t === 'started') console.log(`${label}: Partie gestartet`);
    if (m.t === 'error') console.log(`${label}: ERROR ${m.msg}`);
    if (m.t === 'state') {
      if (m.status === 'finished') {
        if (!ws._done) {
          ws._done = true;
          console.log(`${label}: ${m.winner === m.you ? 'gewonnen' : 'verloren'} nach ${m.turnCount} Zügen`);
          if (++finished === 2) process.exit(0);
        }
        return;
      }
      if (m.turn !== m.you) return;
      const open = [];
      for (let i = 0; i < 100; i++) if (m.tracking[i] === 0) open.push(i);
      const shots = [];
      while (shots.length < m.shots && open.length) shots.push(open.splice(Math.floor(Math.random() * open.length), 1)[0]);
      setTimeout(() => send({ t: 'salvo', shots }), 5);
    }
  });
  return ws;
}

client('Rob', (send) => send({ t: 'createLobby', name: 'Rob' }));
setTimeout(() => {
  client('Michi', (send) => send({ t: 'joinLobby', code, name: 'Michi' }));
}, 600);

setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 120000);
