import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ix, validatePlacement, makePlayer, createGame, beginTurn,
  applySalvo, applyManeuver, applyDive, applyScan, requiredShots,
  baseSalvo, randomPlacement, aliveShips, allSunk, FLEET_SPEC, summarize, UNKNOWN
} from '../server/rules.js';

// Deterministische Aufstellung: alles in Spalten mit Abstand
const FIXED = {
  ships: [
    { type: 'traeger',        r: 0, c: 0, horiz: false }, // 0,0 .. 4,0
    { type: 'schlachtschiff', r: 0, c: 2, horiz: false },
    { type: 'kreuzer',        r: 0, c: 4, horiz: false },
    { type: 'uboot',          r: 0, c: 6, horiz: false },
    { type: 'zerstoerer',     r: 0, c: 8, horiz: false }
  ],
  decoys: [
    { r: 7, c: 0, horiz: true },   // 7,0 7,1
    { r: 7, c: 4, horiz: true }
  ]
};

const mk = () => {
  const a = makePlayer('A', FIXED);
  const b = makePlayer('B', FIXED);
  const g = createGame(a, b, { starter: 0 });
  beginTurn(g);
  return g;
};

test('Aufstellung: gültige Formation wird akzeptiert', () => {
  assert.equal(validatePlacement(FIXED).ok, true);
});

test('Aufstellung: Berührung wird abgelehnt', () => {
  const bad = JSON.parse(JSON.stringify(FIXED));
  bad.ships[1].c = 1; // direkt neben dem Träger
  const v = validatePlacement(bad);
  assert.equal(v.ok, false);
});

test('Aufstellung: Köder sind zwei Felder lang', () => {
  const v = validatePlacement(FIXED);
  const decoys = v.objects.filter((o) => o.kind === 'decoy');
  assert.equal(decoys.length, 2);
  for (const d of decoys) assert.equal(d.cells.length, 2);
});

test('Aufstellung: Zufallsaufstellung ist immer gültig', () => {
  for (let i = 0; i < 200; i++) assert.equal(validatePlacement(randomPlacement()).ok, true);
});

test('Eröffnungsausgleich: Startspieler hat genau 1 Schuss', () => {
  const g = mk();
  assert.equal(baseSalvo(g, 0), 1);
  assert.equal(requiredShots(g, 0), 1);
});

test('Salvengröße ist auf 2..4 geklammert', () => {
  const g = mk();
  applySalvo(g, 0, [ix(9, 9)]);          // Eröffnung
  assert.equal(baseSalvo(g, 1), 4);      // 5 Schiffe -> max 4
  // Zerstörer (2 Felder) versenken
  applySalvo(g, 1, [ix(9, 0), ix(9, 1), ix(9, 2), ix(9, 3)]);
  applySalvo(g, 0, [ix(0, 8), ix(1, 8), ix(8, 8), ix(8, 9)]);
  assert.equal(g.players[0].sunkEnemy.includes('zerstoerer'), true);
  assert.equal(baseSalvo(g, 1), 4);   // Verlierer behält 4 (noch 4 Schiffe)
});

test('Köder meldet Treffer, wird aber nie versenkt', () => {
  const g = mk();
  applySalvo(g, 0, [ix(7, 0)]);
  assert.equal(g.log[0].results[0].result, 'hit');
  applySalvo(g, 1, [ix(9, 9), ix(9, 8), ix(9, 7), ix(9, 6)]);
  const res = applySalvo(g, 0, [ix(7, 1), ix(9, 5), ix(9, 4), ix(9, 3)]);
  assert.equal(res.results[0].result, 'hit');   // zweites Köderfeld: kein "sunk"
  assert.equal(g.players[0].sunkEnemy.length, 0);
});

test('Aufklärung zählt Köder nicht mit', () => {
  const g = mk();
  applySalvo(g, 0, [ix(9, 9)]);
  const r = applyScan(g, 1, ix(7, 1)); // Zentrum über dem Köder des Gegners
  assert.equal(r.ok, true);
  assert.equal(r.count, 0);
});

test('Aufklärung zählt Schiffsfelder korrekt', () => {
  const g = mk();
  applySalvo(g, 0, [ix(9, 9)]);
  const r = applyScan(g, 1, ix(1, 1)); // 3x3 um (1,1) deckt Spalte 0 und 2
  assert.equal(r.count, 6);
});

test('Manöver: beschädigtes Schiff ist fixiert', () => {
  const g = mk();
  applySalvo(g, 0, [ix(0, 0)]);                       // Träger von B getroffen
  applySalvo(g, 1, [ix(9, 9), ix(9, 8), ix(9, 7), ix(9, 6)]);
  const before = g.players[0].tracking.slice();
  const r = applyManeuver(g, 0, 0, 'down');           // A manövriert (eigener Träger unbeschädigt)
  assert.equal(r.ok, true);
  assert.deepEqual(g.players[0].tracking, before);    // Manöver schießt nicht
  const r2 = applyManeuver(g, 1, 0, 'down');          // B: Träger hat Treffer
  assert.equal(r2.ok, false);
});

test('Manöver: Zug in beschossenes Wasser wird abgelehnt', () => {
  const g = mk();
  applySalvo(g, 0, [ix(0, 1)]);                       // Wasser neben B-Träger
  applySalvo(g, 1, [ix(9, 9), ix(9, 8), ix(9, 7), ix(9, 6)]);
  applySalvo(g, 0, [ix(1, 1), ix(2, 1), ix(3, 1), ix(4, 1)]);
  applySalvo(g, 1, [ix(9, 5), ix(9, 4), ix(9, 3), ix(9, 2)]);
  const r = applyManeuver(g, 0, 0, 'right');
  assert.equal(r.ok, false);
});

test('Tauchen: nicht zwei Züge hintereinander', () => {
  const g = mk();
  applySalvo(g, 0, [ix(9, 9)]);
  assert.equal(applyDive(g, 1).ok, true);
  applySalvo(g, 1, [ix(9, 0), ix(9, 1), ix(9, 2)]);   // 4 - 1 (Tauchen) = 3
  applySalvo(g, 0, [ix(5, 5), ix(5, 6), ix(5, 7), ix(5, 8)]);
  assert.equal(applyDive(g, 1).ok, false);
});

test('Tauchen: Schuss auf getauchtes U-Boot meldet Wasser und Ausweichen', () => {
  const g = mk();
  applySalvo(g, 0, [ix(9, 9)]);
  applyDive(g, 1);
  applySalvo(g, 1, [ix(9, 0), ix(9, 1), ix(9, 2)]);
  const res = applySalvo(g, 0, [ix(0, 6), ix(5, 5), ix(5, 7), ix(5, 8)]);
  assert.equal(res.results[0].result, 'water');
  assert.equal(res.evaded, true);
  assert.equal(g.players[1].ships.find((s) => s.type === 'uboot').hits.length, 0);
});

test('Salve: doppelte oder bereits beschossene Felder werden abgelehnt', () => {
  const g = mk();
  applySalvo(g, 0, [ix(9, 9)]);
  assert.equal(applySalvo(g, 1, [ix(0, 0), ix(0, 0), ix(1, 1), ix(2, 2)]).ok, false);
  applySalvo(g, 1, [ix(0, 0), ix(1, 1), ix(2, 2), ix(3, 3)]);
  applySalvo(g, 0, [ix(5, 5), ix(5, 6), ix(5, 7), ix(5, 8)]);
  assert.equal(applySalvo(g, 1, [ix(0, 0), ix(4, 4), ix(4, 5), ix(4, 6)]).ok, false);
});

test('Sieg: alle fünf Schiffe versenkt beendet die Partie', () => {
  const g = mk();
  const targets = [];
  for (const s of g.players[1].ships) targets.push(...s.cells);
  const filler = [];
  for (let r = 5; r < 10; r++) for (let c = 0; c < 10; c++) filler.push(ix(r, c));

  applySalvo(g, 0, [targets.shift()]);            // Eröffnung
  let guard = 0;
  while (g.status === 'playing' && guard++ < 60) {
    const n1 = requiredShots(g, 1);
    applySalvo(g, 1, filler.splice(0, n1));       // B schießt ins Leere
    if (g.status !== 'playing') break;
    const n0 = requiredShots(g, 0);
    applySalvo(g, 0, targets.splice(0, n0));
  }
  assert.equal(allSunk(g.players[1]), true);
  assert.equal(g.status, 'finished');
  assert.equal(g.winner, 0);
});

test('Ausweichen: Wasser-Meldungen der Salve werden zurückgesetzt', () => {
  const g = mk();
  applySalvo(g, 0, [ix(9, 9)]);
  applyDive(g, 1);
  applySalvo(g, 1, [ix(9, 0), ix(9, 1), ix(9, 2)]);
  const res = applySalvo(g, 0, [ix(0, 6), ix(5, 5), ix(5, 7), ix(5, 8)]);
  assert.equal(res.evaded, true);
  // alle vier Felder waren Wasser -> wieder unbekannt, U-Boot bleibt angreifbar
  for (const c of [ix(0, 6), ix(5, 5), ix(5, 7), ix(5, 8)]) {
    assert.equal(g.players[0].tracking[c], 0);
  }
});

test('Ausweichen: Treffer der Salve bleiben bestehen', () => {
  const g = mk();
  applySalvo(g, 0, [ix(9, 9)]);
  applyDive(g, 1);
  applySalvo(g, 1, [ix(9, 0), ix(9, 1), ix(9, 2)]);
  const res = applySalvo(g, 0, [ix(0, 6), ix(0, 0), ix(5, 7), ix(5, 8)]);
  assert.equal(res.evaded, true);
  assert.equal(g.players[0].tracking[ix(0, 0)], 2); // Treffer auf Träger bleibt
});

// ---------------------------------------------------------------- Optionen
import { mergeOptions, DEFAULT_OPTIONS } from '../server/rules.js';

const mkOpt = (o) => {
  const options = mergeOptions(o);
  const a = makePlayer('A', FIXED, { options });
  const b = makePlayer('B', FIXED, { options });
  const g = createGame(a, b, { starter: 0, options });
  beginTurn(g);
  return g;
};

test('Optionen: Grenzen werden erzwungen und max < min korrigiert', () => {
  const o = mergeOptions({ minSalvo: 99, maxSalvo: 1, turnSeconds: 2, decoyCount: 9 });
  assert.equal(o.minSalvo, 6);
  assert.equal(o.maxSalvo, 6);      // auf min hochgezogen
  assert.equal(o.turnSeconds, 15);
  assert.equal(o.decoyCount, 4);
});

test('Option: Eröffnungsausgleich abschaltbar', () => {
  const g = mkOpt({ openingBalance: false });
  assert.equal(baseSalvo(g, 0), 4);
});

test('Option: Salvengrenzen wirken', () => {
  const g = mkOpt({ minSalvo: 1, maxSalvo: 2, openingBalance: false });
  assert.equal(baseSalvo(g, 0), 2);
});

test('Option: nach einem Treffer nur Einzelschuss', () => {
  const g = mkOpt({ singleShotAfterHit: true, openingBalance: false });
  applySalvo(g, 0, [ix(0, 0), ix(9, 9), ix(9, 8), ix(9, 7)]);  // Treffer auf Träger
  applySalvo(g, 1, [ix(5, 5), ix(5, 6), ix(5, 7), ix(5, 8)]);  // nur Wasser
  assert.equal(baseSalvo(g, 0), 1, 'nach Treffer nur 1 Schuss');
  assert.equal(baseSalvo(g, 1), 4, 'ohne Treffer volle Salve');
  applySalvo(g, 0, [ix(8, 8)]);                                // Wasser
  applySalvo(g, 1, [ix(4, 4), ix(4, 5), ix(4, 6), ix(4, 7)]);
  assert.equal(baseSalvo(g, 0), 4, 'nach Fehlschuss wieder volle Salve');
});

test('Option: Manöver, Tauchen und Aufklärung abschaltbar', () => {
  const g = mkOpt({ maneuverEnabled: false, diveEnabled: false, scanEnabled: false, openingBalance: false });
  assert.equal(applyManeuver(g, 0, 0, 'down').ok, false);
  assert.equal(applyDive(g, 0).ok, false);
  assert.equal(applyScan(g, 0, ix(5, 5)).ok, false);
});

test('Option: Köderzahl 0 wird akzeptiert', () => {
  const options = mergeOptions({ decoyCount: 0 });
  const p = randomPlacement(Math.random, options);
  assert.equal(p.decoys.length, 0);
  assert.equal(validatePlacement(p, options).ok, true);
  assert.equal(validatePlacement(p, DEFAULT_OPTIONS).ok, false); // Default verlangt 2
});

test('Option: drei Köder à 3 Feldern sind aufstellbar', () => {
  const options = mergeOptions({ decoyCount: 3, decoyLen: 3 });
  for (let i = 0; i < 50; i++) {
    const p = randomPlacement(Math.random, options);
    assert.equal(p.decoys.length, 3);
    assert.equal(validatePlacement(p, options).ok, true);
  }
});

test('Scan-Historie wird für die Markierung im Client gespeichert', () => {
  const g = mkOpt({ openingBalance: false });
  applySalvo(g, 0, [ix(9, 9), ix(9, 8), ix(9, 7), ix(9, 6)]);
  const r = applyScan(g, 1, ix(1, 1));
  assert.equal(r.ok, true);
  assert.equal(g.players[1].scans.length, 1);
  assert.equal(g.players[1].scans[0].count, r.count);
});

// ------------------------------------------------------------ Salven-Vorrat
test('Vorrat: Einzelschuss kostet nichts, Salve zieht ab', () => {
  const g = mkOpt({ salvoPool: true, salvoPoolSize: 2, openingBalance: false });
  assert.equal(g.players[0].salvosLeft, 2);

  applySalvo(g, 0, [ix(5, 5)]);                       // Einzelschuss
  assert.equal(g.players[0].salvosLeft, 2, 'Einzelschuss ist frei');

  applySalvo(g, 1, [ix(5, 0), ix(5, 1), ix(5, 2), ix(5, 3)]);
  assert.equal(g.players[1].salvosLeft, 1, 'Salve kostet eine');
});

test('Vorrat: bei 0 ist nur noch Einzelschuss erlaubt', () => {
  const g = mkOpt({ salvoPool: true, salvoPoolSize: 0, openingBalance: false });
  assert.equal(requiredShots(g, 0), 1, 'Obergrenze faellt auf 1');

  const r = applySalvo(g, 0, [ix(5, 5), ix(5, 6)]);
  assert.equal(r.ok, false);
  assert.match(r.error, /1 bis 1/);
  assert.equal(applySalvo(g, 0, [ix(5, 5)]).ok, true, 'einer geht');
});

test('Vorrat: jede Zahl von 1 bis zum Maximum ist erlaubt', () => {
  const g = mkOpt({ salvoPool: true, salvoPoolSize: 5, openingBalance: false });
  assert.equal(requiredShots(g, 0), 4);
  // Ohne Vorrat waeren nur exakt 4 erlaubt – die Zahl IST die Entscheidung.
  assert.equal(applySalvo(g, 0, [ix(0, 5), ix(0, 7)]).ok, true, '2 von 4 gehen');
  assert.equal(g.players[0].salvosLeft, 4);
});

test('Vorrat: abgewiesene Salve kostet nichts', () => {
  const g = mkOpt({ salvoPool: true, salvoPoolSize: 3, openingBalance: false });
  const r = applySalvo(g, 0, [ix(5, 5), ix(5, 5)]);   // doppeltes Feld
  assert.equal(r.ok, false);
  assert.equal(g.players[0].salvosLeft, 3, 'Vorrat unangetastet');
});

test('Vorrat sperrt Aufklärung und Tauchen nicht', () => {
  // Der Vorrat greift erst in maxShots, nicht in baseSalvo. Sonst waeren mit
  // leerem Vorrat auch Scan und Tauchen weg, weil beide an baseSalvo >= 2
  // haengen – das hat niemand verlangt.
  const g = mkOpt({ salvoPool: true, salvoPoolSize: 0, openingBalance: false });
  assert.equal(baseSalvo(g, 0), 4, 'Salvengröße bleibt unberührt');
  assert.equal(applyScan(g, 0, ix(5, 5)).ok, true, 'Aufklärung geht weiter');
});

test('Vorrat: Optionen werden geklammert', () => {
  assert.equal(mergeOptions({ salvoPoolSize: 999 }).salvoPoolSize, 30);
  assert.equal(mergeOptions({ salvoPoolSize: -5 }).salvoPoolSize, 0);
  assert.equal(mergeOptions({ salvoPool: 1 }).salvoPool, true);
  assert.equal(mergeOptions({}).salvoPool, false, 'standardmäßig aus');
});

// ------------------------------------------------------- Bedenkzeit des Bots
import { thinkDelay } from '../server/bot.js';

test('Bot-Bedenkzeit: Bereich wird geklammert und nie verdreht', () => {
  assert.equal(mergeOptions({}).botMinSeconds, 3, 'Standard 3 s');
  assert.equal(mergeOptions({}).botMaxSeconds, 6, 'bis 6 s');
  assert.equal(mergeOptions({ botMinSeconds: -5 }).botMinSeconds, 0);
  assert.equal(mergeOptions({ botMaxSeconds: 999 }).botMaxSeconds, 30);

  // Ein umgedrehter Bereich ist eine halb fertige Eingabe, kein Fehler des
  // Nutzers - die Obergrenze zieht nach, wie bei minSalvo/maxSalvo.
  assert.equal(mergeOptions({ botMinSeconds: 8, botMaxSeconds: 2 }).botMaxSeconds, 8);
});

test('Bot denkt innerhalb des eingestellten Bereichs', () => {
  const o = mergeOptions({ botMinSeconds: 3, botMaxSeconds: 6 });
  assert.equal(thinkDelay({ rand: () => 0 }, o), 3000, 'untere Grenze erreichbar');
  for (const r of [0, 0.25, 0.5, 0.999999]) {
    const ms = thinkDelay({ rand: () => r }, o);
    assert.ok(ms >= 3000 && ms <= 6000, `${ms} ms liegt ausserhalb von 3000..6000`);
  }

  // Ohne Pause: das brauchen die e2e-Laeufe, sonst dauert eine Partie Minuten.
  const schnell = mergeOptions({ botMinSeconds: 0, botMaxSeconds: 0 });
  assert.equal(thinkDelay({ rand: () => 0.9 }, schnell), 0);

  // Ohne Optionen faellt er auf den Standard zurueck statt auf 0 - sonst
  // antwortet der Bot ueberall dort sofort, wo jemand das Argument vergisst.
  const ohne = thinkDelay({ rand: () => 0 });
  assert.equal(ohne, DEFAULT_OPTIONS.botMinSeconds * 1000);
});

// ------------------------------------------------------- Täuschungsbilanz
/**
 * Salve mit genau der geforderten Schusszahl. Fehlende Schuesse gehen in die
 * leere Reihe 10 – eine Salve mit falscher Anzahl wird abgewiesen und taucht
 * dann im Protokoll gar nicht auf.
 */
function salve(g, slot, ziele) {
  const shots = ziele.slice();
  const wissen = g.players[slot].tracking;
  // Nur unbeschossene Felder auffuellen: auf dasselbe Feld zweimal zu
  // schiessen weist applySalvo ab, und die Salve taucht dann im Protokoll
  // gar nicht auf - der Test prueft danach ins Leere.
  for (let f = 99; f >= 0 && shots.length < requiredShots(g, slot); f--) {
    if (!shots.includes(f) && wissen[f] === UNKNOWN) shots.push(f);
  }
  return applySalvo(g, slot, shots);
}

test('Bilanz: Köder zählen die geschluckten Schüsse', () => {
  const g = mk();
  // B schiesst auf As Koeder bei 7,0 und 7,1 - beides meldet "Treffer",
  // versenkt aber nie etwas. Genau das soll die Bilanz sichtbar machen.
  g.turn = 1;
  const r = salve(g, 1, [ix(7, 0), ix(7, 1)]);
  assert.equal(r.ok, true, 'Selbsttest: Salve wurde angenommen');

  const b = summarize(g, 0).find((e) => e.key === 'decoyEaten');
  assert.ok(b, 'Köder-Kennzahl vorhanden');
  assert.equal(b.value, 2, 'zwei Schüsse geschluckt');
  assert.equal(b.of, r.results.length, 'gemessen an allen abgegebenen');
});

test('Bilanz: ohne Köder in den Regeln entfällt die Kennzahl', () => {
  // Eine Bilanz aus lauter Nullen sagt weniger als eine kurze.
  const ohne = { ships: FIXED.ships, decoys: [] };
  const opts = mergeOptions({ decoyCount: 0 });
  const g = createGame(makePlayer('A', ohne, { options: opts }),
    makePlayer('B', ohne, { options: opts }), { starter: 0, options: opts });
  beginTurn(g);
  assert.equal(summarize(g, 0).some((e) => e.key === 'decoyEaten'), false);
});

test('Bilanz: Manöver zieht ein Schiff aus einem späteren Schuss', () => {
  const g = mk();
  // A versetzt den Zerstoerer (0,8 und 1,8) um ein Feld nach rechts.
  const idx = g.players[0].ships.findIndex((s) => s.type === 'zerstoerer');
  const alt = g.players[0].ships[idx].cells.slice();
  assert.equal(applyManeuver(g, 0, idx, 'right').ok, true, 'Manöver geht');
  assert.notDeepEqual(g.players[0].ships[idx].cells, alt, 'Schiff steht woanders');

  // B schiesst auf das alte Feld - dort ist jetzt Wasser.
  g.turn = 1;
  const r = salve(g, 1, [alt[0], alt[1]]);
  assert.equal(r.ok, true, 'Selbsttest: Salve wurde angenommen');
  assert.equal(r.results.slice(0, 2).every((x) => x.result === 'water'), true, 'beide ins Leere');

  const m = summarize(g, 0).find((e) => e.key === 'maneuver');
  assert.ok(m, 'Manöver-Kennzahl vorhanden');
  assert.equal(m.value, 1, 'ein Manöver gefahren');
  assert.equal(m.saved, 2, 'zwei Schüsse ins Leere gezogen');
  assert.equal(m.ships, 1, 'ein Schiff gerettet');
});

test('Bilanz: ein Schuss VOR dem Manöver zählt nicht als Rettung', () => {
  const g = mk();
  const idx = g.players[0].ships.findIndex((s) => s.type === 'zerstoerer');
  const alt = g.players[0].ships[idx].cells.slice();

  // Erst schiessen (Treffer), dann waere das Schiff beschaedigt und duerfte
  // gar nicht mehr manoevrieren - deshalb auf ein leeres Feld daneben.
  g.turn = 1;
  assert.equal(salve(g, 1, [ix(9, 9), ix(9, 8)]).ok, true);
  g.turn = 0;
  assert.equal(applyManeuver(g, 0, idx, 'right').ok, true);

  const m = summarize(g, 0).find((e) => e.key === 'maneuver');
  assert.equal(m.saved, 0, 'frühere Schüsse hat das Manöver nicht verhindert');
  assert.equal(m.ships, 0);
  assert.ok(!alt.includes(ix(9, 9)), 'Selbsttest: es wurde woanders hingeschossen');
});

test('Bilanz: Ausweichen zählt Salven und entwertete Meldungen', () => {
  const g = mk();
  assert.equal(applyDive(g, 0).ok, true, 'A taucht');
  g.turn = 1;
  // B schiesst auf As U-Boot (0,6) und daneben ins Wasser.
  const r = salve(g, 1, [ix(0, 6)]);
  assert.equal(r.ok, true, 'Selbsttest: Salve wurde angenommen');
  assert.equal(r.evaded, true, 'Selbsttest: es wurde ausgewichen');

  const e = summarize(g, 0).find((x) => x.key === 'evaded');
  assert.ok(e, 'Ausweich-Kennzahl vorhanden');
  assert.equal(e.value, 1, 'eine Salve');
  assert.ok(e.cells >= 1, 'mindestens eine Wasser-Meldung entwertet');
});

test('Bilanz: ein Schuss auf das Feld VOR dem Manöver ist keine Rettung', () => {
  // Konstruierbar nur ueber das getauchte U-Boot: ein Schuss auf seine Felder
  // meldet Wasser, ohne dass es beschaedigt wird - es darf danach also noch
  // manoevrieren. Ohne die Zeitordnung in summarize() wuerde dieser fruehere
  // Schuss faelschlich als Rettung gezaehlt.
  const g = mk();
  assert.equal(applyDive(g, 0).ok, true);
  g.turn = 1;
  const r = salve(g, 1, [ix(0, 6)]);              // erstes Feld des U-Boots
  assert.equal(r.evaded, true, 'Selbsttest: ausgewichen, Meldung ist Wasser');

  g.turn = 0;
  const idx = g.players[0].ships.findIndex((s) => s.type === 'uboot');
  const alt = g.players[0].ships[idx].cells.slice();
  assert.ok(alt.includes(ix(0, 6)), 'Selbsttest: es wurde auf ein altes Feld geschossen');
  assert.equal(applyManeuver(g, 0, idx, 'down').ok, true, 'U-Boot weicht aus');

  const m = summarize(g, 0).find((e) => e.key === 'maneuver');
  assert.equal(m.saved, 0, 'was vorher passierte, hat das Manöver nicht verhindert');
});

test('Bilanz: ein Treffer auf dem alten Feld ist keine Rettung', () => {
  // Das Schiff kann zurueckwandern. Steht es wieder da, ist ein Schuss dorthin
  // ein TREFFER - gerettet hat das erste Manoever dann gar nichts. Ohne die
  // Bedingung "nur Wasser zaehlt" wuerde es trotzdem als Rettung gebucht.
  const g = mk();
  const idx = g.players[0].ships.findIndex((s) => s.type === 'zerstoerer');
  const zuhause = g.players[0].ships[idx].cells.slice();

  assert.equal(applyManeuver(g, 0, idx, 'right').ok, true, 'raus');
  g.turn = 1;
  assert.equal(salve(g, 1, [ix(5, 5)]).ok, true, 'Gegner schießt woanders hin');
  g.turn = 0;
  assert.equal(applyManeuver(g, 0, idx, 'left').ok, true, 'und wieder zurück');
  assert.deepEqual(g.players[0].ships[idx].cells, zuhause, 'Selbsttest: steht wieder da');

  g.turn = 1;
  const r = salve(g, 1, [zuhause[0], zuhause[1]]);
  assert.equal(r.results.slice(0, 2).every((x) => x.result !== 'water'), true,
    'Selbsttest: das sind Treffer, kein Wasser');

  const m = summarize(g, 0).find((e) => e.key === 'maneuver');
  assert.equal(m.saved, 0, 'ein Treffer auf dem alten Feld rettet nichts');
});
