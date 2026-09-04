// Shattle Bips – Regel-Engine v0.2
// Reine Funktionen: kein Netzwerk, kein Timer, kein globaler Zufall.
// Dieselbe Datei laeuft im Server, im Bot und in tools/sim.mjs.

export const N = 10;
export const CELLS = N * N;

export const FLEET_SPEC = [
  { type: 'traeger',       label: 'Träger',        len: 5 },
  { type: 'schlachtschiff',label: 'Schlachtschiff',len: 4 },
  { type: 'kreuzer',       label: 'Kreuzer',       len: 3 },
  { type: 'uboot',         label: 'U-Boot',        len: 3 },
  { type: 'zerstoerer',    label: 'Zerstörer',     len: 2 }
];

export const DECOY_COUNT = 2;
export const DECOY_LEN = 2;

export const UNKNOWN = 0;
export const WATER = 1;
export const HIT = 2;

export const MIN_SALVO = 2;
export const MAX_SALVO = 4;

/** Testbare Stellschrauben. Werden vor Partiebeginn in der Lobby gesetzt. */
export const DEFAULT_OPTIONS = {
  minSalvo: 2,
  maxSalvo: 4,
  openingBalance: true,     // Startspieler hat im ersten Zug nur 1 Schuss
  singleShotAfterHit: false,// nach einem Treffer im letzten Zug nur 1 Schuss
  decoyCount: 2,
  decoyLen: 2,
  scanEnabled: true,
  diveEnabled: true,
  maneuverEnabled: true,
  turnSeconds: 60,
  // Salven-Vorrat: begrenzt, wie OFT eine volle Salve geschossen werden darf,
  // nicht wie gross sie ist. Jeder Zug ist eine Entscheidung – Salve kostet
  // eine aus dem Vorrat, Einzelschuss kostet nichts. Ist er leer, geht nur
  // noch Einzelschuss.
  salvoPool: false,
  salvoPoolSize: 8,
  // Bedenkzeit des Bots in Sekunden, als Bereich. Ein Bot, der sofort
  // antwortet, wirkt maschinell; einer mit fester Pause wirkt abgezaehlt.
  // Deshalb wird pro Zug neu gewuerfelt. 0/0 heisst ohne Pause – das brauchen
  // die e2e-Laeufe, sonst dauert eine Partie Minuten.
  botMinSeconds: 3,
  botMaxSeconds: 6
};

export function mergeOptions(raw = {}) {
  const o = { ...DEFAULT_OPTIONS };
  const num = (v, lo, hi, def) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : def;
  };
  o.minSalvo = num(raw.minSalvo, 1, 6, o.minSalvo);
  o.maxSalvo = num(raw.maxSalvo, 1, 8, o.maxSalvo);
  if (o.maxSalvo < o.minSalvo) o.maxSalvo = o.minSalvo;
  o.decoyCount = num(raw.decoyCount, 0, 4, o.decoyCount);
  o.decoyLen = num(raw.decoyLen, 1, 3, o.decoyLen);
  o.turnSeconds = num(raw.turnSeconds, 15, 300, o.turnSeconds);
  o.salvoPoolSize = num(raw.salvoPoolSize, 0, 30, o.salvoPoolSize);
  o.botMinSeconds = num(raw.botMinSeconds, 0, 30, o.botMinSeconds);
  o.botMaxSeconds = num(raw.botMaxSeconds, 0, 30, o.botMaxSeconds);
  // Wie bei minSalvo/maxSalvo: ein umgedrehter Bereich ist kein Fehler des
  // Nutzers, sondern eine halb fertige Eingabe. Obergrenze zieht nach.
  if (o.botMaxSeconds < o.botMinSeconds) o.botMaxSeconds = o.botMinSeconds;
  for (const k of ['openingBalance', 'singleShotAfterHit', 'scanEnabled', 'diveEnabled', 'maneuverEnabled', 'salvoPool']) {
    if (raw[k] !== undefined) o[k] = !!raw[k];
  }
  return o;
}

// ---------------------------------------------------------------- Geometrie
export const ix = (r, c) => r * N + c;
export const rc = (i) => [Math.floor(i / N), i % N];
export const inBounds = (r, c) => r >= 0 && r < N && c >= 0 && c < N;

export function lineCells(r, c, len, horiz) {
  const out = [];
  for (let i = 0; i < len; i++) {
    const rr = horiz ? r : r + i;
    const cc = horiz ? c + i : c;
    if (!inBounds(rr, cc)) return null;
    out.push(ix(rr, cc));
  }
  return out;
}

export function halo(cells) {
  const out = new Set();
  for (const i of cells) {
    const [r, c] = rc(i);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (inBounds(r + dr, c + dc)) out.add(ix(r + dr, c + dc));
      }
    }
  }
  return out;
}

export function orth(i) {
  const [r, c] = rc(i);
  const out = [];
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    if (inBounds(r + dr, c + dc)) out.push(ix(r + dr, c + dc));
  }
  return out;
}

// ------------------------------------------------------------- Aufstellung
// placement = { ships: [{type,r,c,horiz}], decoys: [{r,c,horiz}] }
export function validatePlacement(placement, opts = DEFAULT_OPTIONS) {
  if (!placement || !Array.isArray(placement.ships) || !Array.isArray(placement.decoys)) {
    return { ok: false, error: 'Aufstellung unvollständig.' };
  }
  if (placement.ships.length !== FLEET_SPEC.length) {
    return { ok: false, error: `Es müssen genau ${FLEET_SPEC.length} Schiffe gesetzt sein.` };
  }
  if (placement.decoys.length !== opts.decoyCount) {
    return { ok: false, error: `Es müssen genau ${opts.decoyCount} Köder gesetzt sein.` };
  }

  const wanted = FLEET_SPEC.map((s) => s.type).sort();
  const got = placement.ships.map((s) => s.type).sort();
  if (wanted.join(',') !== got.join(',')) {
    return { ok: false, error: 'Falsche Flottenzusammensetzung.' };
  }

  const objects = [];
  for (const s of placement.ships) {
    const spec = FLEET_SPEC.find((f) => f.type === s.type);
    const cells = lineCells(s.r, s.c, spec.len, !!s.horiz);
    if (!cells) return { ok: false, error: `${spec.label} liegt außerhalb des Rasters.` };
    objects.push({ kind: 'ship', type: spec.type, label: spec.label, len: spec.len, horiz: !!s.horiz, cells });
  }
  for (const d of placement.decoys) {
    const cells = lineCells(d.r, d.c, opts.decoyLen, !!d.horiz);
    if (!cells) return { ok: false, error: 'Köder liegt außerhalb des Rasters.' };
    objects.push({ kind: 'decoy', len: opts.decoyLen, horiz: !!d.horiz, cells });
  }

  const occupied = new Set();
  const blocked = new Set();
  for (const o of objects) {
    for (const i of o.cells) {
      if (occupied.has(i)) return { ok: false, error: 'Objekte überlappen sich.' };
      if (blocked.has(i)) return { ok: false, error: 'Objekte berühren sich – ein Feld Abstand ist Pflicht.' };
    }
    for (const i of o.cells) occupied.add(i);
    for (const i of halo(o.cells)) blocked.add(i);
  }
  return { ok: true, objects };
}

export function makePlayer(name, placement, opts = {}) {
  const v = validatePlacement(placement, opts.options || DEFAULT_OPTIONS);
  if (!v.ok) throw new Error(v.error);
  return {
    name,
    isBot: !!opts.isBot,
    ships: v.objects.filter((o) => o.kind === 'ship')
      .map((o) => ({ type: o.type, label: o.label, len: o.len, horiz: o.horiz, cells: o.cells.slice(), hits: [] })),
    decoys: v.objects.filter((o) => o.kind === 'decoy')
      .map((o) => ({ len: o.len, horiz: o.horiz, cells: o.cells.slice(), hits: [] })),
    tracking: new Array(CELLS).fill(UNKNOWN), // Wissen ueber das GEGNERISCHE Brett
    sunkEnemy: [],                            // Typen, die dieser Spieler versenkt hat
    incoming: new Set(),                      // Felder, auf die auf MICH geschossen wurde
    diving: false,
    divedLastTurn: false,
    divedThisTurn: false,
    scannedThisTurn: false,
    lastSalvoHit: false,     // fuer die Option "nach Treffer nur Einzelschuss"
    scans: [],               // {center, count} – fuer die Markierung im Client
    salvosLeft: (opts.options || DEFAULT_OPTIONS).salvoPoolSize
  };
}

export function randomPlacement(rand = Math.random, opts = DEFAULT_OPTIONS) {
  const rnd = (n) => Math.floor(rand() * n);
  for (let attempt = 0; attempt < 500; attempt++) {
    const blocked = new Set();
    const ships = [];
    const decoys = [];
    let ok = true;

    const put = (len) => {
      for (let t = 0; t < 300; t++) {
        const horiz = rand() < 0.5;
        const r = rnd(N), c = rnd(N);
        const cells = lineCells(r, c, len, horiz);
        if (!cells) continue;
        if (cells.some((i) => blocked.has(i))) continue;
        for (const i of halo(cells)) blocked.add(i);
        return { r, c, horiz };
      }
      return null;
    };

    for (const spec of FLEET_SPEC) {
      const p = put(spec.len);
      if (!p) { ok = false; break; }
      ships.push({ type: spec.type, ...p });
    }
    if (!ok) continue;
    for (let d = 0; d < opts.decoyCount; d++) {
      const p = put(opts.decoyLen);
      if (!p) { ok = false; break; }
      decoys.push(p);
    }
    if (ok) return { ships, decoys };
  }
  throw new Error('Zufallsaufstellung fehlgeschlagen.');
}

// ------------------------------------------------------------------- Partie
export function createGame(playerA, playerB, opts = {}) {
  const starter = opts.starter ?? 0;
  return {
    status: 'playing',
    options: opts.options || DEFAULT_OPTIONS,
    players: [playerA, playerB],
    starter,
    turn: starter,
    turnCount: 0,
    winner: null,
    log: []
  };
}

export const aliveShips = (p) => p.ships.filter((s) => s.hits.length < s.len);
export const sub = (p) => p.ships.find((s) => s.type === 'uboot');
export const shipAlive = (p, type) => p.ships.some((s) => s.type === type && s.hits.length < s.len);
export const allSunk = (p) => p.ships.every((s) => s.hits.length >= s.len);

/** Salvengröße vor Abzügen. */
export function baseSalvo(game, slot) {
  const o = game.options || DEFAULT_OPTIONS;
  const p = game.players[slot];
  if (o.openingBalance && game.turnCount === 0 && slot === game.starter) return 1;
  if (o.singleShotAfterHit && p.lastSalvoHit) return 1;   // Jagd nur mit Einzelschuss
  return Math.max(o.minSalvo, Math.min(o.maxSalvo, aliveShips(p).length));
}

/** Tatsächlich verfügbare Schüsse in diesem Zug (nach Tauchen/Scan). */
export function shotsAvailable(game, slot) {
  const p = game.players[slot];
  let n = baseSalvo(game, slot);
  if (p.divedThisTurn) n -= 1;
  if (p.scannedThisTurn) n -= 1;
  return Math.max(1, n);
}

function unknownCount(p) {
  let n = 0;
  for (const v of p.tracking) if (v === UNKNOWN) n++;
  return n;
}

/**
 * Obergrenze der Schuesse in diesem Zug.
 *
 * Der Salven-Vorrat greift bewusst ERST HIER und nicht in baseSalvo(): sonst
 * waeren mit leerem Vorrat auch Aufklaerung und Tauchen gesperrt, weil beide
 * an baseSalvo >= 2 haengen. Der Vorrat soll die Salve begrenzen, nicht die
 * uebrigen Faehigkeiten mit abraeumen.
 */
export function maxShots(game, slot) {
  const o = game.options || DEFAULT_OPTIONS;
  const p = game.players[slot];
  const n = shotsAvailable(game, slot);
  if (o.salvoPool && p.salvosLeft <= 0) return 1;
  return n;
}

/**
 * Wie viele Schüsse der Spieler abgeben muss – bzw. hoechstens darf, wenn der
 * Salven-Vorrat laeuft. Dann ist jede Zahl von 1 bis hierhin erlaubt.
 */
export function requiredShots(game, slot) {
  return Math.min(maxShots(game, slot), unknownCount(game.players[slot]));
}

export function beginTurn(game) {
  const p = game.players[game.turn];
  p.divedLastTurn = p.diving; // Schutz der letzten Runde lief ab
  p.diving = false;
  p.divedThisTurn = false;
  p.scannedThisTurn = false;
}

function endTurn(game) {
  game.turnCount += 1;
  game.turn = 1 - game.turn;
  beginTurn(game);
}

// ------------------------------------------------------------------ Aktionen
export function applyDive(game, slot) {
  if (game.status !== 'playing') return { ok: false, error: 'Partie läuft nicht.' };
  if (!(game.options || DEFAULT_OPTIONS).diveEnabled) return { ok: false, error: 'Tauchen ist in dieser Partie deaktiviert.' };
  if (game.turn !== slot) return { ok: false, error: 'Nicht am Zug.' };
  const p = game.players[slot];
  if (p.divedThisTurn) return { ok: false, error: 'Bereits getaucht.' };
  if (p.divedLastTurn) return { ok: false, error: 'Nicht zwei Züge hintereinander tauchen.' };
  const s = sub(p);
  if (!s || s.hits.length > 0) return { ok: false, error: 'U-Boot beschädigt oder versenkt.' };
  p.diving = true;
  p.divedThisTurn = true;
  game.log.push({ turn: game.turnCount, slot, kind: 'dive' });
  return { ok: true };
}

export function applyManeuver(game, slot, shipIndex, move) {
  if (game.status !== 'playing') return { ok: false, error: 'Partie läuft nicht.' };
  if (!(game.options || DEFAULT_OPTIONS).maneuverEnabled) return { ok: false, error: 'Manöver sind in dieser Partie deaktiviert.' };
  if (game.turn !== slot) return { ok: false, error: 'Nicht am Zug.' };
  const p = game.players[slot];
  const ship = p.ships[shipIndex];
  if (!ship) return { ok: false, error: 'Unbekanntes Schiff.' };
  if (ship.hits.length > 0) return { ok: false, error: 'Beschädigte Schiffe sind fixiert.' };

  const [r0, c0] = rc(ship.cells[0]);
  let cells = null, horiz = ship.horiz;
  if (move === 'rotate') {
    horiz = !ship.horiz;
    cells = lineCells(r0, c0, ship.len, horiz);
  } else {
    const d = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] }[move];
    if (!d) return { ok: false, error: 'Unbekannte Bewegung.' };
    cells = lineCells(r0 + d[0], c0 + d[1], ship.len, horiz);
  }
  if (!cells) return { ok: false, error: 'Zielposition liegt außerhalb des Rasters.' };

  for (const i of cells) {
    if (p.incoming.has(i)) return { ok: false, error: 'Dort wurde bereits hingeschossen.' };
  }
  const others = new Set();
  for (const s of p.ships) if (s !== ship) for (const i of halo(s.cells)) others.add(i);
  for (const d of p.decoys) for (const i of halo(d.cells)) others.add(i);
  for (const i of cells) {
    if (others.has(i)) return { ok: false, error: 'Zielposition berührt ein anderes Objekt.' };
  }

  const from = ship.cells.slice();
  ship.cells = cells;
  ship.horiz = horiz;
  ship.movedTurn = game.turnCount;
  p.lastSalvoHit = false;
  // `from` ist der Kern der Manoever-Bilanz: erst damit laesst sich hinterher
  // pruefen, ob ein spaeterer Schuss das Schiff getroffen HAETTE.
  game.log.push({ turn: game.turnCount, slot, kind: 'maneuver', shipType: ship.type, from, to: cells.slice() });
  endTurn(game);
  return { ok: true, notice: 'maneuvered' };
}

export function applyScan(game, slot, center) {
  if (game.turn !== slot) return { ok: false, error: 'Nicht am Zug.' };
  if (!(game.options || DEFAULT_OPTIONS).scanEnabled) return { ok: false, error: 'Aufklärung ist in dieser Partie deaktiviert.' };
  const p = game.players[slot];
  if (p.scannedThisTurn) return { ok: false, error: 'Bereits aufgeklärt.' };
  if (!shipAlive(p, 'traeger')) return { ok: false, error: 'Träger versenkt – keine Aufklärung.' };
  const [r, c] = rc(center);
  if (r < 1 || r > N - 2 || c < 1 || c > N - 2) {
    return { ok: false, error: 'Scan-Mittelpunkt muss vollständig im Raster liegen.' };
  }
  if (baseSalvo(game, slot) - (p.divedThisTurn ? 1 : 0) < 2) {
    return { ok: false, error: 'Zu wenige Schüsse für einen Scan.' };
  }
  const foe = game.players[1 - slot];
  const occ = new Set();
  for (const s of foe.ships) for (const i of s.cells) occ.add(i); // Köder zählen NICHT
  let count = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) if (occ.has(ix(r + dr, c + dc))) count++;
  }
  p.scannedThisTurn = true;
  p.scans.push({ center, count, turn: game.turnCount });
  game.log.push({ turn: game.turnCount, slot, kind: 'scan', center, count });
  return { ok: true, count };
}

/**
 * Salve abfeuern. shots = Array von Zellindizes.
 * Beendet den Zug.
 */
export function applySalvo(game, slot, shots) {
  if (game.status !== 'playing') return { ok: false, error: 'Partie läuft nicht.' };
  if (game.turn !== slot) return { ok: false, error: 'Nicht am Zug.' };
  const p = game.players[slot];
  const foe = game.players[1 - slot];

  const o = game.options || DEFAULT_OPTIONS;
  const need = requiredShots(game, slot);
  if (!Array.isArray(shots)) return { ok: false, error: 'Keine Schüsse angesagt.' };

  if (o.salvoPool) {
    // Die Anzahl der gesendeten Schuesse IST die Entscheidung: mehr als einer
    // heisst "ich gebe eine Salve aus dem Vorrat aus". Ein eigenes Feld im
    // Protokoll braucht es dafuer nicht.
    if (shots.length < 1 || shots.length > need) {
      return { ok: false, error: `1 bis ${need} Schüsse ansagen.` };
    }
    if (shots.length > 1 && p.salvosLeft <= 0) {
      return { ok: false, error: 'Salven aufgebraucht – nur noch Einzelschuss.' };
    }
  } else if (shots.length !== need) {
    return { ok: false, error: `Genau ${need} Schuss/Schüsse ansagen.` };
  }
  const seen = new Set();
  for (const i of shots) {
    if (!Number.isInteger(i) || i < 0 || i >= CELLS) return { ok: false, error: 'Ungültiges Feld.' };
    if (seen.has(i)) return { ok: false, error: 'Doppeltes Zielfeld in der Salve.' };
    if (p.tracking[i] !== UNKNOWN) return { ok: false, error: 'Feld wurde bereits beschossen.' };
    seen.add(i);
  }

  // Erst hier abziehen: eine abgewiesene Salve darf nichts kosten.
  if (o.salvoPool && shots.length > 1) p.salvosLeft -= 1;

  const results = [];
  const waterCells = [];
  let evaded = false;
  const foeSub = sub(foe);

  for (const i of shots) {
    foe.incoming.add(i);

    if (foe.diving && foeSub && foeSub.hits.length === 0 && foeSub.cells.includes(i)) {
      p.tracking[i] = WATER;
      waterCells.push(i);
      evaded = true;
      results.push({ cell: i, result: 'water' });
      continue;
    }

    const ship = foe.ships.find((s) => s.cells.includes(i) && !s.hits.includes(i));
    if (ship) {
      ship.hits.push(i);
      p.tracking[i] = HIT;
      if (ship.hits.length >= ship.len) {
        p.sunkEnemy.push(ship.type);
        results.push({ cell: i, result: 'sunk', shipType: ship.type, shipLabel: ship.label, shipCells: ship.cells.slice() });
      } else {
        results.push({ cell: i, result: 'hit' });
      }
      continue;
    }

    const decoy = foe.decoys.find((d) => d.cells.includes(i) && !d.hits.includes(i));
    if (decoy) {
      decoy.hits.push(i);
      p.tracking[i] = HIT;             // ununterscheidbar von einem Schiffstreffer
      results.push({ cell: i, result: 'hit' });
      continue;
    }

    p.tracking[i] = WATER;
    waterCells.push(i);
    results.push({ cell: i, result: 'water' });
  }

  // Ausweichmanöver des U-Boots: Alle Wasser-Meldungen DIESER Salve werden
  // zurückgesetzt. Sonst wäre ein getauchtes U-Boot dauerhaft unversenkbar –
  // das Feld bliebe für immer als Wasser markiert. So bleibt die Deduktion
  // ehrlich (das Orakel hat nicht gelogen, die Auskunft wird nur ungültig)
  // und der Angreifer weiß nicht, welcher seiner Schüsse betroffen war.
  if (evaded) {
    for (const i of waterCells) p.tracking[i] = UNKNOWN;
  }

  p.lastSalvoHit = results.some((x) => x.result === 'hit' || x.result === 'sunk');
  game.log.push({ turn: game.turnCount, slot, kind: 'salvo', results, evaded, reset: evaded ? waterCells.slice() : [] });

  if (allSunk(foe)) {
    game.status = 'finished';
    game.winner = slot;
    return { ok: true, results, evaded, finished: true };
  }
  endTurn(game);
  return { ok: true, results, evaded };
}

/** Zug verfallen lassen (Timeout). */
export function passTurn(game, slot) {
  if (game.turn !== slot || game.status !== 'playing') return { ok: false };
  game.log.push({ turn: game.turnCount, slot, kind: 'timeout' });
  endTurn(game);
  return { ok: true };
}

/** Sicht eines Spielers auf sein eigenes Brett (fuer den Client). */
export function ownView(p) {
  return {
    ships: p.ships.map((s, idx) => ({
      index: idx, type: s.type, label: s.label, len: s.len, horiz: s.horiz,
      cells: s.cells, hits: s.hits, sunk: s.hits.length >= s.len
    })),
    decoys: p.decoys.map((d) => ({ cells: d.cells, hits: d.hits, horiz: d.horiz })),
    incoming: [...p.incoming]
  };
}

// ----------------------------------------------------- Täuschungsbilanz
/**
 * Was hat die Täuschung dieses Spielers bewirkt?
 *
 * Rein aus `game.log` und den Flotten gerechnet – waehrend der Partie wird
 * dafuer nichts mitgefuehrt. Das ist Absicht: das Protokoll ist die eine
 * Wahrheit, jede Kennzahl ist eine Leseart davon. Wer eine ergaenzen will,
 * haengt hier einen Eintrag an und muss die Spielschleife nicht anfassen.
 *
 * Jeder Eintrag: `{ key, value, ...Zusatz }`. Kennzahlen ohne Aussage fallen
 * raus – eine Bilanz aus lauter Nullen sagt weniger als eine kurze. Der Client
 * zeigt einen unbekannten `key` roh an, statt ihn zu verschlucken; so kann der
 * Server hier vorlegen, ohne dass der Client im selben Zug mitziehen muss.
 */
export function summarize(game, slot) {
  const me = game.players[slot];
  if (!me) return [];
  const log = game.log || [];
  const gegnerSalven = log.filter((e) => e.kind === 'salvo' && e.slot === 1 - slot);
  const schuesse = gegnerSalven.reduce((n, e) => n + e.results.length, 0);
  const out = [];

  // Köder: wie viele gegnerische Schüsse haben sie geschluckt?
  if (me.decoys.length) {
    out.push({ key: 'decoyEaten', value: me.decoys.reduce((n, d) => n + d.hits.length, 0), of: schuesse });
  }

  // Ausweichen: gegnerische Salven, in denen das U-Boot getaucht war, und wie
  // viele Wasser-Meldungen dadurch verfielen.
  const ausgewichen = gegnerSalven.filter((e) => e.evaded);
  if (ausgewichen.length) {
    out.push({
      key: 'evaded',
      value: ausgewichen.length,
      cells: ausgewichen.reduce((n, e) => n + (e.reset ? e.reset.length : 0), 0)
    });
  }

  // Manöver: hat es ein Schiff aus einem späteren Schuss gezogen? Der Beweis
  // steht im Protokoll – die alten Felder gegen jeden danach abgegebenen
  // gegnerischen Schuss halten. Nur `water` zaehlt: haette der Schuss etwas
  // getroffen, war das Feld nicht leer und das Manöver hat nichts gerettet.
  const manoever = log.filter((e) => e.kind === 'maneuver' && e.slot === slot);
  if (manoever.length) {
    let gerettet = 0;
    const schiffe = new Set();
    for (const m of manoever) {
      const alt = new Set(m.from || []);
      const treffer = new Set();
      for (const e of gegnerSalven) {
        if (e.turn <= m.turn) continue;
        for (const r of e.results) if (alt.has(r.cell) && r.result === 'water') treffer.add(r.cell);
      }
      if (treffer.size) { gerettet += treffer.size; schiffe.add(m.shipType); }
    }
    out.push({ key: 'maneuver', value: manoever.length, saved: gerettet, ships: schiffe.size });
  }

  if (me.scans.length) out.push({ key: 'scan', value: me.scans.length });
  return out;
}
