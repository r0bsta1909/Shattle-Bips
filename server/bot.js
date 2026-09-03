// NEBEL – Bot v1
// Probability-Density-Zielwahl + rudimentaeres Gegnermodell.
// Eine Stufe, menschlich getunt (keine Schwierigkeitsgrade).

import {
  N, CELLS, FLEET_SPEC, UNKNOWN, WATER, HIT,
  ix, rc, orth, lineCells, randomPlacement, DEFAULT_OPTIONS,
  aliveShips, shipAlive, sub, baseSalvo, requiredShots, shotsAvailable
} from './rules.js';

export function createBotBrain(rand = Math.random) {
  return {
    rand,
    knownDecoyCells: new Set(),
    openHits: new Set(),      // Treffer, die zu keinem versenkten Schiff gehoeren
    scanBonus: new Map(),
    lastShots: [],
    maneuverNoticed: 0
  };
}

export function botPlacement(rand = Math.random, options) {
  return randomPlacement(rand, options);
}

// ------------------------------------------------------------- Buchhaltung
export function noteResults(brain, results, tracking) {
  for (const r of results) {
    if (r.result === 'hit') brain.openHits.add(r.cell);
    if (r.result === 'sunk') {
      for (const c of r.shipCells || []) brain.openHits.delete(c);
      brain.openHits.delete(r.cell);
    }
  }
  flagDecoys(brain, tracking);
}

/** Ein Trefferblock, den nur Wasser umschliesst und der nie versenkt gemeldet
 *  wurde, kann nur ein Koeder sein. */
function flagDecoys(brain, tracking) {
  const seen = new Set();
  for (const cell of [...brain.openHits]) {
    if (seen.has(cell)) continue;
    const block = new Set([cell]);
    const stack = [cell];
    while (stack.length) {
      const cur = stack.pop();
      for (const n of orth(cur)) {
        if (brain.openHits.has(n) && !block.has(n)) { block.add(n); stack.push(n); }
      }
    }
    for (const b of block) seen.add(b);
    let closed = true;
    for (const b of block) {
      for (const n of orth(b)) {
        if (!block.has(n) && tracking[n] !== WATER) closed = false;
      }
    }
    if (closed) {
      for (const b of block) { brain.openHits.delete(b); brain.knownDecoyCells.add(b); }
    }
  }
}

/** Meldung "U-Boot ausgewichen": die Engine hat die Wasser-Felder dieser Salve
 *  bereits auf UNBEKANNT zurueckgesetzt. Der Bot muss nur seinen Scan-Bonus in
 *  der Region auffrischen, damit er dort wieder hinschaut. */
export function noteEvade(brain) {
  for (const i of brain.lastShots) brain.scanBonus.delete(i);
}

/** Meldung "Flotte manoevriert": das Brett hat sich veraendert. */
export function noteManeuver(brain) {
  brain.maneuverNoticed += 1;
}

// ------------------------------------------------------- Wahrscheinlichkeit
function remainingLengths(sunkTypes) {
  const lens = FLEET_SPEC.map((s) => s.len);
  const spec = FLEET_SPEC.slice();
  for (const t of sunkTypes) {
    const k = spec.findIndex((s) => s.type === t);
    if (k >= 0) { lens.splice(lens.indexOf(spec[k].len), 1); spec.splice(k, 1); }
  }
  return lens;
}

export function density(brain, tracking, sunkTypes) {
  const dens = new Float64Array(CELLS);
  const lens = remainingLengths(sunkTypes);
  const counts = new Map();
  for (const l of lens) counts.set(l, (counts.get(l) || 0) + 1);

  const blocked = (i) => tracking[i] === WATER || brain.knownDecoyCells.has(i);

  for (const [len, mult] of counts) {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        for (const horiz of [true, false]) {
          const cells = lineCells(r, c, len, horiz);
          if (!cells) continue;
          if (cells.some(blocked)) continue;
          let cover = 0;
          for (const i of cells) if (brain.openHits.has(i)) cover++;
          const w = mult * (1 + 40 * cover);
          for (const i of cells) {
            if (tracking[i] === UNKNOWN) dens[i] += w;
          }
        }
      }
    }
  }

  for (const [i, f] of brain.scanBonus) if (tracking[i] === UNKNOWN) dens[i] *= f;

  if (brain.openHits.size === 0 && lens.length) {
    const k = Math.min(...lens);
    for (let i = 0; i < CELLS; i++) {
      const [r, c] = rc(i);
      if ((r + c) % k !== 0) dens[i] *= 0.55;
    }
  }
  return dens;
}

function pickCells(brain, tracking, sunkTypes, n) {
  const dens = density(brain, tracking, sunkTypes);
  const cand = [];
  for (let i = 0; i < CELLS; i++) if (tracking[i] === UNKNOWN) cand.push([dens[i], i]);
  cand.sort((a, b) => b[0] - a[0]);
  // 5 % Menschlichkeit: gelegentlich das zweitbeste Feld
  if (cand.length > 2 && brain.rand() < 0.05) {
    const t = cand[0]; cand[0] = cand[1]; cand[1] = t;
  }
  return cand.slice(0, n).map(([, i]) => i);
}

function bestScanCenter(brain, tracking, sunkTypes) {
  const dens = density(brain, tracking, sunkTypes);
  let best = -1, bc = null;
  for (let r = 1; r < N - 1; r++) {
    for (let c = 1; c < N - 1; c++) {
      let s = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) s += dens[ix(r + dr, c + dc)];
      if (s > best) { best = s; bc = ix(r, c); }
    }
  }
  return bc;
}

export function applyScanResult(brain, center, count) {
  const [r, c] = rc(center);
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      brain.scanBonus.set(ix(r + dr, c + dc), count > 0 ? 3.0 : 0.15);
    }
  }
}

// ------------------------------------------------------------- Zugplanung
/**
 * Liefert einen Aktionsplan. Der Aufrufer fuehrt ihn ueber die Regel-Engine aus.
 * plan = { dive:bool, maneuver:{shipIndex,move}|null, scan:cellIndex|null }
 * Die Schuesse werden erst NACH Tauchen/Scan gezogen (Salvengroesse aendert sich).
 */
export function planTurn(brain, game, slot) {
  const me = game.players[slot];
  const plan = { dive: false, maneuver: null, scan: null };

  // --- Manoever: reaktiv, plus ~20 % Taeuschung ohne Not -------------------
  const damaged = me.ships.some((s) => s.hits.length > 0 && s.hits.length < s.len);
  if (!damaged) {
    const threatened = [];
    for (let i = 0; i < me.ships.length; i++) {
      const s = me.ships[i];
      if (s.hits.length > 0) continue;
      const near = s.cells.some((cell) => orth(cell).some((n) => me.incoming.has(n)));
      if (near) threatened.push(i);
    }
    const bluff = brain.rand() < 0.20;
    if ((threatened.length && brain.rand() < 0.35) || bluff) {
      const pool = threatened.length ? threatened
        : me.ships.map((s, i) => (s.hits.length === 0 ? i : -1)).filter((i) => i >= 0);
      if (pool.length) {
        const shipIndex = pool[Math.floor(brain.rand() * pool.length)];
        const moves = ['up', 'down', 'left', 'right', 'rotate'];
        plan.maneuver = { shipIndex, move: moves[Math.floor(brain.rand() * moves.length)] };
        return plan; // Manoever ersetzt die Salve
      }
    }
  }

  // --- Tauchen -------------------------------------------------------------
  const s = sub(me);
  if (s && s.hits.length === 0 && !me.divedLastTurn && baseSalvo(game, slot) > 1) {
    const danger = s.cells.some((cell) => orth(cell).some((n) => me.incoming.has(n)));
    if ((danger && brain.rand() < 0.5) || brain.rand() < 0.08) plan.dive = true;
  }

  // --- Aufklaerung ---------------------------------------------------------
  if (shipAlive(me, 'traeger') && brain.openHits.size === 0) {
    const avail = baseSalvo(game, slot) - (plan.dive ? 1 : 0);
    if (avail >= 2) plan.scan = bestScanCenter(brain, me.tracking, me.sunkEnemy);
  }
  return plan;
}

export function planShots(brain, game, slot) {
  const me = game.players[slot];
  const n = requiredShots(game, slot);
  const shots = pickCells(brain, me.tracking, me.sunkEnemy, n);
  brain.lastShots = shots.slice();
  return shots;
}

export function thinkDelay(brain) {
  return 1200 + Math.floor(brain.rand() * 1600); // 1,2–2,8 s
}
