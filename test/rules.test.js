import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ix, validatePlacement, makePlayer, createGame, beginTurn,
  applySalvo, applyManeuver, applyDive, applyScan, requiredShots,
  baseSalvo, randomPlacement, aliveShips, allSunk, FLEET_SPEC
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
