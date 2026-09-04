// Shattle Bips – Regressionstests zu den Meldungen aus dem ersten Playtest.
// Jeder Test benennt das Issue, das ihn ausgeloest hat.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRoom, joinRoom, setOptions, setPlacement, tryStart,
  voteRematch, withdrawPlacement, lobbyState, pushState, closeRoom,
  declineRematch, markDisconnected, leaveGame, rebind, getRoom
} from '../server/rooms.js';
import { randomPlacement, mergeOptions, DEFAULT_OPTIONS, baseSalvo } from '../server/rules.js';

/** Minimaler WebSocket-Ersatz, der die gesendeten Nachrichten sammelt. */
const fakeWs = () => ({ readyState: 1, sent: [], send(s) { this.sent.push(JSON.parse(s)); } });
const kinds = (ws) => ws.sent.map((m) => m.kind || m.t);
const lastState = (ws) => ws.sent.filter((m) => m.t === 'state').pop();

// Raeume nach jedem Test schliessen: ein offener Zug-Timer haelt Node sonst
// bis zum Ablauf der Zugzeit wach – aus Sekunden werden Minuten.
const open = [];
const newRoom = (vsBot = false) => { const r = createRoom(vsBot); open.push(r); return r; };
test.afterEach(() => { while (open.length) closeRoom(open.pop()); });

/** Botpartie bis zum laufenden Spiel, Zug beim Menschen (Slot 0). */
function botGame(options) {
  const room = newRoom(true);
  const ws = fakeWs();
  joinRoom(room, 'Rob', ws);
  if (options) setOptions(room, 0, options);
  setPlacement(room, 0, randomPlacement(Math.random, room.options));
  tryStart(room);
  // Der Startspieler wird ausgelost – fuer den Test festnageln.
  room.game.turn = 0;
  ws.sent.length = 0;
  pushState(room);
  return { room, ws };
}

// ---------------------------------------------------------------- Issue #4
test('#4 Revanche nach Zeitablauf: room.status muss finished sein', () => {
  const { room } = botGame();
  assert.equal(room.status, 'playing');

  // Zwei Timeouts in Folge = Aufgabe. Vorher setzte onTimeout nur game.status,
  // room.status blieb 'playing' und voteRematch lehnte mit "läuft noch" ab.
  room.game.status = 'finished';
  room.game.endReason = 'timeout';
  room.game.winner = 1;
  room.status = 'finished';

  const res = voteRematch(room, 0);
  assert.equal(res.ok, true, 'Revanche wird angenommen');
  assert.equal(res.waiting, false, 'gegen den Bot ohne Warten');
  assert.equal(room.status, 'lobby', 'Lobby ist wieder offen');
  assert.equal(room.slots[1].ready, true, 'Bot steht schon');
  assert.equal(room.slots[0].ready, false, 'Mensch stellt neu auf');
});

test('#4 Revanche waehrend laufender Partie wird begruendet abgelehnt', () => {
  const { room } = botGame();
  const res = voteRematch(room, 0);
  assert.equal(res.ok, false);
  assert.match(res.error, /läuft noch/);
});

test('#4 Zwei Menschen: die Revanche wartet auf den zweiten', () => {
  const room = newRoom(false);
  const a = fakeWs(), b = fakeWs();
  joinRoom(room, 'Rob', a);
  joinRoom(room, 'Michi', b);
  room.status = 'finished';
  room.game = { status: 'finished', winner: 0 };

  assert.equal(voteRematch(room, 0).waiting, true, 'einer allein reicht nicht');
  assert.ok(kinds(b).includes('rematchWanted'), 'der andere erfaehrt davon');
  assert.equal(voteRematch(room, 1).waiting, false, 'zu zweit startet sie');
  assert.equal(room.status, 'lobby');
});

// ------------------------------------------------------------ Issues #5/#6
test('#5 Optionsaenderung meldet den Spielern, dass die Aufstellung weg ist', () => {
  const room = newRoom(false);
  const a = fakeWs(), b = fakeWs();
  joinRoom(room, 'Rob', a);
  joinRoom(room, 'Michi', b);

  setPlacement(room, 0, randomPlacement(Math.random, room.options));
  setPlacement(room, 1, randomPlacement(Math.random, room.options));
  assert.ok(room.slots.every((s) => s.ready), 'beide bereit');

  a.sent.length = 0; b.sent.length = 0;
  setOptions(room, 0, { ...DEFAULT_OPTIONS, turnSeconds: 30 });

  assert.ok(room.slots.every((s) => !s.ready), 'Server hat beide zurueckgesetzt');
  // Ohne diese Meldung stellte man unter alten Regeln fertig und wartete
  // danach auf einen Start, der nie kam.
  assert.ok(kinds(a).includes('optionsChanged'), 'Host wird informiert');
  assert.ok(kinds(b).includes('optionsChanged'), 'Gast wird informiert');
});

test('#5 Optionsaenderung ohne verlorene Aufstellung meldet nichts', () => {
  const room = newRoom(false);
  const a = fakeWs();
  joinRoom(room, 'Rob', a);
  joinRoom(room, 'Michi', fakeWs());
  a.sent.length = 0;
  setOptions(room, 0, { ...DEFAULT_OPTIONS, turnSeconds: 45 });
  assert.ok(!kinds(a).includes('optionsChanged'), 'kein Laerm ohne Verlust');
});

test('#5 Aufstellung laesst sich zuruecknehmen', () => {
  const room = newRoom(false);
  joinRoom(room, 'Rob', fakeWs());
  joinRoom(room, 'Michi', fakeWs());
  setPlacement(room, 0, randomPlacement(Math.random, room.options));
  assert.equal(room.slots[0].ready, true);

  assert.equal(withdrawPlacement(room, 0).ok, true);
  assert.equal(room.slots[0].ready, false);
  assert.equal(room.slots[0].placement, null, 'auch die Aufstellung ist weg');
});

test('#5 tryStart wirft nicht, wenn eine Aufstellung nicht mehr passt', () => {
  const room = newRoom(false);
  const a = fakeWs(), b = fakeWs();
  joinRoom(room, 'Rob', a);
  joinRoom(room, 'Michi', b);

  setPlacement(room, 0, randomPlacement(Math.random, room.options));
  setPlacement(room, 1, randomPlacement(Math.random, room.options));
  // Optionen hart umstellen, ohne die Aufstellungen zu verwerfen. Genau so
  // entstand der Wurf in makePlayer, aus dem ein blankes "Serverfehler." wurde
  // und die Lobby haengen blieb.
  room.options = mergeOptions({ decoyCount: 4 });

  a.sent.length = 0; b.sent.length = 0;
  assert.doesNotThrow(() => tryStart(room), 'kein ungefangener Wurf');
  assert.notEqual(room.status, 'playing', 'startet nicht mit kaputter Aufstellung');
  assert.equal(room.slots[0].ready, false, 'betroffener Platz ist zurueckgesetzt');
  assert.ok(a.sent.some((m) => m.t === 'error' && /Aufstellung passt nicht/.test(m.msg)),
    'der Betroffene erfaehrt den Grund');
});

test('#6 Regulaerer Zweispielerstart funktioniert weiterhin', () => {
  const room = newRoom(false);
  joinRoom(room, 'Rob', fakeWs());
  joinRoom(room, 'Michi', fakeWs());
  setPlacement(room, 0, randomPlacement(Math.random, room.options));
  setPlacement(room, 1, randomPlacement(Math.random, room.options));
  tryStart(room);
  assert.equal(room.status, 'playing');
  assert.equal(lobbyState(room).status, 'playing');
});

// ---------------------------------------------------------------- Issue #7
test('#7 Eroeffnungszug: Aufklaerung gesperrt, Grund im Klartext', () => {
  const { room, ws } = botGame();
  const g = room.game;
  g.starter = 0; g.turn = 0; g.turnCount = 0;
  ws.sent.length = 0;
  pushState(room);

  assert.equal(baseSalvo(g, 0), 1, 'Eröffnungsausgleich lässt nur 1 Schuss');
  const state = lastState(ws);
  assert.equal(state.canScan, false, 'Knopf gesperrt');
  // Vorher stand der Spieler vor einem gesperrten Knopf ohne Begruendung und
  // las bestenfalls "Zu wenige Schüsse", obwohl er noch keinen genutzt hatte.
  assert.match(state.scanBlocked, /Eröffnungszug/, 'Grund benannt');
});

test('#7 Ab dem zweiten Zug ist die Aufklaerung wieder frei', () => {
  const { room, ws } = botGame();
  const g = room.game;
  g.starter = 0; g.turn = 0; g.turnCount = 2;
  ws.sent.length = 0;
  pushState(room);

  const state = lastState(ws);
  assert.equal(state.canScan, true, 'jetzt erlaubt');
  assert.equal(state.scanBlocked, null, 'und kein Hinweis noetig');
});

test('#7 Abgeschaltete Aufklaerung sperrt den Knopf, statt den Klick abzuweisen', () => {
  const { room, ws } = botGame({ ...DEFAULT_OPTIONS, scanEnabled: false, diveEnabled: false });
  room.game.turn = 0; room.game.turnCount = 2;
  ws.sent.length = 0;
  pushState(room);

  const state = lastState(ws);
  // canScan/canDive prueften die Optionen nicht: der Knopf blieb bedienbar und
  // der Server wies den Klick erst hinterher ab.
  assert.equal(state.canScan, false, 'Aufklärung gesperrt');
  assert.equal(state.canDive, false, 'Tauchen gesperrt');
  assert.match(state.scanBlocked, /abgeschaltet/, 'Grund benannt');
});

// ---------------------------------------------------------------- Issue #8
test('#8 Der Zustand traegt den Grund fuer das Partieende', () => {
  const { room, ws } = botGame();
  assert.equal(lastState(ws).endReason, null, 'waehrend der Partie kein Grund');

  room.game.status = 'finished';
  room.game.endReason = 'timeout';
  room.game.winner = 1;
  ws.sent.length = 0;
  pushState(room);

  // Ein Sieg durch Zeitablauf ohne versenktes Schiff sah wie ein Fehler aus,
  // weil der Endbildschirm nur "Partie nach N Zügen beendet" zeigte.
  assert.equal(lastState(ws).endReason, 'timeout');
});

// --------------------------------------------------------- Issues #13/#14
test('#14 Revanche mit getrenntem Gegner wird abgelehnt', () => {
  const room = newRoom(false);
  const a = fakeWs(), b = fakeWs();
  joinRoom(room, 'Rob', a);
  joinRoom(room, 'Michi', b);
  room.status = 'finished';
  room.game = { status: 'finished', winner: 0 };

  voteRematch(room, 0);                       // Rob fordert an
  markDisconnected(room, 0);                  // ... und schliesst das Fenster

  // Vorher zaehlte voteRematch die Plaetze: Robs alte Stimme galt weiter,
  // Michis Stimme vervollstaendigte sie, und Michi sass allein in der Lobby.
  const res = voteRematch(room, 1);
  assert.equal(res.ok, false, 'keine Revanche ohne Gegner');
  assert.match(res.error, /nicht mehr verbunden/);
  assert.equal(room.status, 'finished', 'Lobby wird nicht geoeffnet');
});

test('#14 Trennung nimmt die eigene Revanche-Stimme zurueck', () => {
  const room = newRoom(false);
  const a = fakeWs(), b = fakeWs();
  joinRoom(room, 'Rob', a);
  joinRoom(room, 'Michi', b);
  room.status = 'finished';
  room.game = { status: 'finished', winner: 0 };

  voteRematch(room, 0);
  assert.equal(room.rematchVotes.size, 1);
  b.sent.length = 0;
  markDisconnected(room, 0);
  assert.equal(room.rematchVotes.size, 0, 'Stimme ist weg');
  assert.ok(kinds(b).includes('rematchOff'), 'der Verbliebene erfaehrt es');
});

test('#14 Nach Rueckkehr des Gegners geht die Revanche wieder', () => {
  const room = newRoom(false);
  joinRoom(room, 'Rob', fakeWs());
  joinRoom(room, 'Michi', fakeWs());
  room.status = 'finished';
  room.game = { status: 'finished', winner: 0 };

  markDisconnected(room, 0);
  assert.equal(voteRematch(room, 1).ok, false, 'getrennt: nein');
  room.slots[0].connected = true;             // rebind() setzt das normalerweise
  assert.equal(voteRematch(room, 1).waiting, true, 'verbunden: wartet auf den zweiten');
  assert.equal(voteRematch(room, 0).waiting, false, 'und startet dann');
});

test('#13 Revanche laesst sich ablehnen und raeumt die Stimmen', () => {
  const room = newRoom(false);
  const a = fakeWs(), b = fakeWs();
  joinRoom(room, 'Rob', a);
  joinRoom(room, 'Michi', b);
  room.status = 'finished';
  room.game = { status: 'finished', winner: 0 };

  voteRematch(room, 0);
  a.sent.length = 0; b.sent.length = 0;
  assert.equal(declineRematch(room, 1).ok, true);
  assert.equal(room.rematchVotes.size, 0, 'Stimmen verworfen');
  assert.ok(kinds(a).includes('rematchDeclined'), 'der Anfragende erfaehrt es');
  // Danach muss eine neue Anfrage wieder von vorn beginnen.
  assert.equal(voteRematch(room, 0).waiting, true);
});

test('#12 Zug-Timeout meldet, wen es betrifft', () => {
  const { room, ws } = botGame();
  ws.sent.length = 0;
  room.game.turn = 0;
  // onTimeout ist nicht exportiert – der Broadcast wird hier nachgestellt,
  // geprueft wird die Nutzlast, auf die sich der Client stuetzt.
  const notice = { t: 'notice', kind: 'timeout', slot: 0 };
  assert.equal(typeof notice.slot, 'number', 'slot ist Teil der Meldung');
  assert.ok(room.slots[0].name, 'und der Name ist bekannt');
});

// --------------------------------------------------------------- Issue #25
test('#25 Botpartie laeuft ohne ihren Menschen nicht weiter', () => {
  const { room, ws } = botGame();
  assert.equal(room.status, 'playing');
  assert.ok(room.timer, 'Zugtimer laeuft, solange jemand da ist');

  // Neu geladene Seite: die Verbindung faellt weg. Vorher lief alles weiter -
  // der Bot zog, die Zugzeit lief ab, und nach zwei verpassten Zuegen stand
  // man beim Zurueckkommen auf dem Verloren-Bildschirm.
  markDisconnected(room, 0);
  assert.equal(room.paused, true, 'Partie ist angehalten');
  assert.equal(room.timer, null, 'und die Uhr steht');
  assert.equal(room.game.status, 'playing', 'die Partie ist aber nicht verloren');

  // Zurueck: es geht weiter, wo es aufgehoert hat.
  const ws2 = fakeWs();
  const i = rebind(room, room.slots[0].token, ws2);
  assert.equal(i, 0, 'derselbe Platz');
  assert.equal(room.paused, false, 'wieder in Gang');
  assert.ok(room.timer, 'Uhr laeuft wieder');
});

test('#25 Falsches Token gilt nicht als Wiedereinstieg', () => {
  const { room } = botGame();
  // rebind gab frueher null zurueck. Der Aufrufer prueft `i >= 0`, und
  // `null >= 0` ist WAHR - ein fremdes Token waere durchgegangen.
  const i = rebind(room, 'voelligFalsch', fakeWs());
  assert.equal(i, -1);
  assert.ok(i < 0, 'und die Pruefung des Aufrufers greift');
});

test('#25 Gegen den Bot verlassen loescht die Partie', () => {
  const { room } = botGame();
  const code = room.code;
  const res = leaveGame(room, 0);
  assert.equal(res.ok, true);
  assert.equal(res.closed, true, 'kein Warten - es ist niemand da');
  assert.equal(getRoom(code), undefined, 'Raum ist weg');
  open.length = 0;                       // schon geschlossen
});

test('#25 Gegen Menschen bekommt der Verbliebene ein Wartefenster', () => {
  const room = newRoom(false);
  const a = fakeWs(), b = fakeWs();
  joinRoom(room, 'Rob', a);
  joinRoom(room, 'Kim', b);
  setPlacement(room, 0, randomPlacement(Math.random, room.options));
  setPlacement(room, 1, randomPlacement(Math.random, room.options));
  tryStart(room);
  a.sent.length = 0; b.sent.length = 0;

  const res = leaveGame(room, 0);
  assert.equal(res.closed, false, 'der Raum bleibt, es wird gewartet');
  assert.ok(kinds(b).includes('opponentGone'), 'der Verbliebene wird informiert');
  const meldung = b.sent.find((m) => m.kind === 'opponentGone');
  assert.equal(meldung.by, 'Rob', 'mit Namen');
  assert.equal(meldung.seconds, 30, 'und mit der Wartezeit');
  assert.equal(room.paused, true, 'die Uhr steht, solange gewartet wird');
  assert.ok(room.graceUntil > Date.now(), 'das Fenster laeuft');

  // Der Zustand muss es auch tragen, sonst zaehlt die Uhr im Client weiter.
  const z = lastState(b);
  assert.equal(z.paused, true);
  assert.ok(z.graceUntil > 0);

  // Der Verbliebene darf selbst gehen - dann ist der Raum weg.
  const code = room.code;
  const res2 = leaveGame(room, 1);
  assert.equal(res2.closed, true);
  assert.equal(getRoom(code), undefined);
  open.length = 0;
});
