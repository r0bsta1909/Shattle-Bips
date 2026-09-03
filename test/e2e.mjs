// End-to-End: startet den echten Server im selben Prozess und spielt
// eine vollstaendige Partie gegen den Bot ueber WebSocket.
process.env.PORT = process.env.PORT || '3210';
await import('../server/index.js');
await new Promise((r) => setTimeout(r, 400));

const { default: WebSocket } = await import('ws');
const ws = new WebSocket(`ws://127.0.0.1:${process.env.PORT}/ws`);
const send = (m) => ws.send(JSON.stringify(m));
let done = false;
const seen = { scan: 0, evade: 0, maneuver: 0, incoming: 0 };

ws.on('open', () => { send({ t: 'hello', name: 'TestRob' }); send({ t: 'startVsBot', name: 'TestRob' }); });

ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  switch (m.t) {
    case 'joined': console.log('joined', m.code, 'vsBot=' + m.vsBot); return send({ t: 'randomFleet' });
    case 'randomFleet': return send({ t: 'placeFleet', placement: m.placement });
    case 'placementOk': return console.log('Aufstellung akzeptiert');
    case 'started': return console.log('Partie gestartet, Starter=' + m.starter);
    case 'error': return console.log('ERROR:', m.msg);
    case 'scanResult': seen.scan++; return;
    case 'notice':
      if (m.kind === 'evaded') seen.evade++;
      if (m.kind === 'maneuvered') seen.maneuver++;
      if (m.kind === 'incoming') seen.incoming++;
      return;
    case 'state': {
      if (m.status === 'finished') {
        if (done) return;
        done = true;
        console.log(`FERTIG nach ${m.turnCount} Zügen. Sieger: ${m.winner === m.you ? 'Mensch' : 'Bot'}`);
        console.log('Meldungen:', JSON.stringify(seen));
        return process.exit(0);
      }
      if (m.turn !== m.you) return;
      if (m.canDive && Math.random() < 0.3) return send({ t: 'dive' });
      if (m.canScan && Math.random() < 0.4) return send({ t: 'scan', center: 11 + Math.floor(Math.random() * 77) });
      const open = [];
      for (let i = 0; i < 100; i++) if (m.tracking[i] === 0) open.push(i);
      const shots = [];
      while (shots.length < m.shots && open.length) shots.push(open.splice(Math.floor(Math.random() * open.length), 1)[0]);
      return setTimeout(() => send({ t: 'salvo', shots }), 10);
    }
  }
});

setTimeout(() => { console.log('TIMEOUT – Partie nicht beendet'); process.exit(1); }, 120000);
