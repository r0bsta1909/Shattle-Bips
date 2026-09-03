// NEBEL – Headless-Balancing. Bot gegen Bot auf der echten Regel-Engine.
// Aufruf: node tools/sim.mjs [Partien]

import {
  makePlayer, createGame, beginTurn, randomPlacement,
  applySalvo, applyManeuver, applyDive, applyScan,
  requiredShots, allSunk, aliveShips
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

function playGame(rand) {
  const g = createGame(
    makePlayer('A', randomPlacement(rand)),
    makePlayer('B', randomPlacement(rand)),
    { starter: rand() < 0.5 ? 0 : 1 }
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

const games = Number(process.argv[2] || 500);
const rand = mulberry32(20260903);
let starterWins = 0, played = 0, flWins = 0, flGames = 0;
const shotList = [], turnList = [];
let man = 0, scan = 0, dive = 0;

for (let i = 0; i < games; i++) {
  const r = playGame(rand);
  if (!r) continue;
  played++;
  if (r.winner === r.starter) starterWins++;
  shotList.push(r.shots[r.winner]);
  turnList.push(r.turns);
  man += r.maneuvers[0] + r.maneuvers[1];
  scan += r.scans[0] + r.scans[1];
  dive += r.dives[0] + r.dives[1];
  if (r.firstLoss !== null) { flGames++; if (r.winner === r.firstLoss) flWins++; }
}

const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;

console.log(`Partien:                 ${played}`);
console.log(`Startspieler gewinnt:    ${(starterWins / played * 100).toFixed(1)} %   (Ziel ≤ 53 %)`);
console.log(`Sieg nach Erstverlust:   ${(flWins / flGames * 100).toFixed(1)} %   (Ziel 35–45 %)`);
console.log(`Schüsse des Siegers:     Median ${med(shotList)} · Ø ${avg(shotList).toFixed(1)}`);
console.log(`Züge gesamt:             Ø ${avg(turnList).toFixed(1)}`);
console.log(`Manöver / Scans / Tauch: Ø ${(man / played).toFixed(2)} / ${(scan / played).toFixed(2)} / ${(dive / played).toFixed(2)}`);
