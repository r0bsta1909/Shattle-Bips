// NEBEL – Headless-Balancing. Bot gegen Bot auf der echten Regel-Engine.
//
// Aufruf: node tools/sim.mjs [Partien] [--option=wert | --flag | --no-flag]
//
// Beispiele:
//   node tools/sim.mjs 800
//   node tools/sim.mjs 800 --singleShotAfterHit          Jagdmodus
//   node tools/sim.mjs 800 --minSalvo=1 --maxSalvo=3     engere Salve
//   node tools/sim.mjs 800 --decoyCount=0                klassisches Spiel
//   node tools/sim.mjs 800 --no-scanEnabled --seed=7     ohne Aufklaerung
//
// Die Optionen sind exakt die der Lobby (server/rules.js, DEFAULT_OPTIONS) und
// laufen durch dasselbe mergeOptions(), damit der Sim keine Regeln kennen kann,
// die im Spiel nicht einstellbar waeren.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  makePlayer, createGame, beginTurn, randomPlacement,
  applySalvo, applyManeuver, applyDive, applyScan,
  mergeOptions, DEFAULT_OPTIONS
} from '../server/rules.js';
import {
  createBotBrain, planTurn, planShots, noteResults, noteEvade,
  noteManeuver, applyScanResult
} from '../server/bot.js';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------- Kommandozeile
const BOOL_KEYS = ['openingBalance', 'singleShotAfterHit', 'scanEnabled', 'diveEnabled', 'maneuverEnabled'];
const NUM_KEYS = ['minSalvo', 'maxSalvo', 'decoyCount', 'decoyLen', 'turnSeconds'];

export function parseArgs(argv) {
  const raw = {};
  let games = 500;
  let seed = 20260903;

  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      const n = Number(arg);
      if (!Number.isFinite(n)) throw new Error(`Unbekanntes Argument: ${arg}`);
      games = Math.max(1, Math.round(n));
      continue;
    }
    let body = arg.slice(2);
    let negate = false;
    if (body.startsWith('no-')) { negate = true; body = body.slice(3); }

    const eq = body.indexOf('=');
    const key = eq >= 0 ? body.slice(0, eq) : body;
    const val = eq >= 0 ? body.slice(eq + 1) : null;

    if (key === 'seed') {
      const n = Number(val);
      if (!Number.isFinite(n)) throw new Error('--seed braucht eine Zahl, z. B. --seed=7');
      seed = n;
      continue;
    }
    if (BOOL_KEYS.includes(key)) {
      raw[key] = negate ? false : (val === null ? true : val !== 'false' && val !== '0');
      continue;
    }
    if (NUM_KEYS.includes(key)) {
      if (val === null) throw new Error(`--${key} braucht einen Wert, z. B. --${key}=3`);
      const n = Number(val);
      if (!Number.isFinite(n)) throw new Error(`--${key}: "${val}" ist keine Zahl.`);
      raw[key] = n;
      continue;
    }
    throw new Error(`Unbekannte Option: --${key}\nErlaubt: ${[...NUM_KEYS, ...BOOL_KEYS].join(', ')}, seed`);
  }
  // mergeOptions klammert und korrigiert (max<min) – exakt wie in der Lobby.
  return { games, seed, options: mergeOptions(raw), raw };
}

// ------------------------------------------------------------------- Partie
function playGame(rand, options) {
  const g = createGame(
    makePlayer('A', randomPlacement(rand, options), { options }),
    makePlayer('B', randomPlacement(rand, options), { options }),
    { starter: rand() < 0.5 ? 0 : 1, options }
  );
  beginTurn(g);
  const brains = [createBotBrain(rand), createBotBrain(rand)];
  const shots = [0, 0];
  const maneuvers = [0, 0];
  const scans = [0, 0];
  const dives = [0, 0];
  let firstLoss = null;
  let guard = 0;

  while (g.status === 'playing' && guard++ < 600) {
    const slot = g.turn;
    const brain = brains[slot];
    const plan = planTurn(brain, g, slot);

    if (plan.maneuver) {
      const r = applyManeuver(g, slot, plan.maneuver.shipIndex, plan.maneuver.move);
      if (r.ok) { maneuvers[slot]++; noteManeuver(brains[1 - slot]); continue; }
      // Abgeschaltete Manoever fallen hier durch auf die normale Salve.
    }
    if (plan.dive && applyDive(g, slot).ok) dives[slot]++;
    if (plan.scan !== null && plan.scan !== undefined) {
      const r = applyScan(g, slot, plan.scan);
      if (r.ok) { scans[slot]++; applyScanResult(brain, plan.scan, r.count); }
    }
    const cells = planShots(brain, g, slot);
    const res = applySalvo(g, slot, cells);
    if (!res.ok) break;
    shots[slot] += cells.length;
    noteResults(brain, res.results, g.players[slot].tracking);
    if (res.evaded) noteEvade(brain);
    if (firstLoss === null && res.results.some((x) => x.result === 'sunk')) firstLoss = 1 - slot;
  }
  if (g.status !== 'finished') return null;
  return { winner: g.winner, shots, turns: g.turnCount, maneuvers, scans, dives, firstLoss, starter: g.starter };
}

export function runSim({ games, seed, options }) {
  const rand = mulberry32(seed);
  let starterWins = 0, played = 0, flWins = 0, flGames = 0, aborted = 0;
  const shotList = [], turnList = [];
  let man = 0, scan = 0, dive = 0;

  for (let i = 0; i < games; i++) {
    const r = playGame(rand, options);
    if (!r) { aborted++; continue; }
    played++;
    if (r.winner === r.starter) starterWins++;
    shotList.push(r.shots[r.winner]);
    turnList.push(r.turns);
    man += r.maneuvers[0] + r.maneuvers[1];
    scan += r.scans[0] + r.scans[1];
    dive += r.dives[0] + r.dives[1];
    if (r.firstLoss !== null) { flGames++; if (r.winner === r.firstLoss) flWins++; }
  }
  return { played, aborted, starterWins, flWins, flGames, shotList, turnList, man, scan, dive };
}

/** Welche Optionen weichen vom Standard ab? Fuer Kopfzeile und Zielkorridore. */
export function changedOptions(options) {
  return Object.keys(DEFAULT_OPTIONS)
    .filter((k) => options[k] !== DEFAULT_OPTIONS[k])
    .map((k) => `${k}=${options[k]}`);
}

// -------------------------------------------------------------------- Ausgabe
function report({ seed, options }, r) {
  const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const pct = (n, d) => (d ? (n / d * 100).toFixed(1) : '—');
  const changed = changedOptions(options);

  console.log(`Regelsatz:               ${changed.length ? changed.join(' · ') : 'Standard'}`);
  console.log(`Salve / Köder / Zugzeit: ${options.minSalvo}–${options.maxSalvo} · ${options.decoyCount}×${options.decoyLen} · ${options.turnSeconds}s`);
  console.log(`Seed:                    ${seed}`);
  console.log('');

  if (!r.played) {
    console.log('Keine Partie kam zu Ende – der Regelsatz ist vermutlich nicht spielbar.');
    return;
  }

  // Die Zielkorridore sind fuer den Standardregelsatz kalibriert und werden
  // bei abweichenden Optionen bewusst nicht mitgedruckt.
  const goalStarter = changed.length ? '' : '   (Ziel ≤ 53 %)';
  const goalComeback = changed.length ? '' : '   (Ziel 35–45 %)';

  console.log(`Partien:                 ${r.played}${r.aborted ? `   (${r.aborted} ohne Ende abgebrochen)` : ''}`);
  console.log(`Startspieler gewinnt:    ${pct(r.starterWins, r.played)} %${goalStarter}`);
  console.log(`Sieg nach Erstverlust:   ${pct(r.flWins, r.flGames)} %${goalComeback}`);
  console.log(`Schüsse des Siegers:     Median ${med(r.shotList)} · Ø ${avg(r.shotList).toFixed(1)}`);
  console.log(`Züge gesamt:             Ø ${avg(r.turnList).toFixed(1)}`);
  console.log(`Manöver / Scans / Tauch: Ø ${(r.man / r.played).toFixed(2)} / ${(r.scan / r.played).toFixed(2)} / ${(r.dive / r.played).toFixed(2)}`);

  if (changed.length) {
    console.log('');
    console.log('Die Zielkorridore gelten nur für den Standardregelsatz und stehen deshalb');
    console.log('oben nicht dabei. Zum Vergleich denselben Seed ohne Optionen laufen lassen.');
  }
}

// Nur ausfuehren, wenn direkt aufgerufen – nicht beim Import aus den Tests.
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  let cfg;
  try {
    cfg = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  report(cfg, runSim(cfg));
}
