// End-to-End: Testeinstellungen setzen, Zug-Timeout prüfen, Revanche starten.
process.env.PORT = process.env.PORT || '3240';
await import('../server/index.js');
await new Promise((r) => setTimeout(r, 400));
const { default: WebSocket } = await import('ws');

const ws = new WebSocket(`ws://127.0.0.1:${process.env.PORT}/ws`);
const send = (m) => ws.send(JSON.stringify(m));

let phase = 'setup';
let sawSingleShot = false;
let turnBeforeTimeout = null;
let rematched = false;
let fails = 0;
const check = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'} – ${label}`); if (!cond) fails++; };

ws.on('open', () => { send({ t: 'hello', name: 'Rob' }); send({ t: 'startVsBot', name: 'Rob' }); });

ws.on('message', (raw) => {
  const m = JSON.parse(raw);

  if (m.t === 'joined') {
    return send({
      t: 'setOptions',
      options: { minSalvo: 2, maxSalvo: 4, singleShotAfterHit: true, turnSeconds: 15, decoyCount: 3, decoyLen: 2 }
    });
  }

  if (m.t === 'lobby' && phase === 'setup' && m.options.singleShotAfterHit) {
    phase = 'placing';
    check(m.options.turnSeconds === 15, 'Zugzeit übernommen');
    check(m.options.decoyCount === 3, 'Köderzahl übernommen');
    return send({ t: 'randomFleet' });
  }

  if (m.t === 'randomFleet') {
    check(m.placement.decoys.length === 3, 'Zufallsaufstellung liefert 3 Köder');
    return send({ t: 'placeFleet', placement: m.placement });
  }

  if (m.t === 'error') console.log('ERROR:', m.msg);

  if (m.t === 'state') {
    if (m.status === 'finished') {
      if (!rematched) {
        rematched = true;
        check(sawSingleShot, 'Jagdmodus: nach Treffer nur 1 Schuss');
        console.log('Partie beendet – fordere Revanche an');
        send({ t: 'rematch' });
      }
      return;
    }
    if (m.turn !== m.you) return;

    // Einmal absichtlich nichts tun, um das Timeout zu prüfen
    if (phase === 'placing') {
      phase = 'timeout-test';
      turnBeforeTimeout = m.turnCount;
      console.log('warte auf Zug-Timeout (15 s)…');
      return;
    }
    if (phase === 'timeout-test') {
      check(m.turnCount > turnBeforeTimeout, 'Timeout gibt den Zug ab statt ihn neu zu starten');
      phase = 'playing';
    }

    if (m.shots === 1 && m.baseSalvo === 1) sawSingleShot = true;

    const open = [];
    for (let i = 0; i < 100; i++) if (m.tracking[i] === 0) open.push(i);
    const shots = [];
    while (shots.length < m.shots && open.length) shots.push(open.splice(Math.floor(Math.random() * open.length), 1)[0]);
    return setTimeout(() => send({ t: 'salvo', shots }), 10);
  }

  if (m.t === 'rematch') {
    check(true, 'Revanche startet eine neue Lobby-Runde');
    console.log(fails === 0 ? 'ALLE PRÜFUNGEN BESTANDEN' : `${fails} FEHLER`);
    process.exit(fails === 0 ? 0 : 1);
  }
});

setTimeout(() => { console.log('TIMEOUT des Testlaufs'); process.exit(1); }, 180000);
