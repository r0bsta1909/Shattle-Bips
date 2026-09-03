// NEBEL – Lobby- und Partieverwaltung (autoritativ, in-memory)

import {
  makePlayer, createGame, randomPlacement, validatePlacement,
  applySalvo, applyManeuver, applyDive, applyScan, passTurn, beginTurn,
  requiredShots, shotsAvailable, baseSalvo, ownView, aliveShips, shipAlive
} from './rules.js';
import {
  createBotBrain, botPlacement, planTurn, planShots,
  noteResults, noteEvade, noteManeuver, applyScanResult, thinkDelay
} from './bot.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne I,O,0,1
const TURN_MS = 60_000;
const BANK_MS = 300_000;
const PLACEMENT_MS = 180_000;
const ROOM_TTL_MS = 45 * 60_000;

const rooms = new Map();

const now = () => Date.now();
const token = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

function newCode() {
  for (let t = 0; t < 200; t++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
  throw new Error('Keine freien Lobby-Codes.');
}

function cleanName(raw) {
  const s = String(raw ?? '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 16);
  return s || 'Kapitän';
}

// ------------------------------------------------------------------ Struktur
export function createRoom(vsBot = false) {
  const code = newCode();
  const room = {
    code,
    status: 'lobby',          // lobby | placement | playing | finished
    createdAt: now(),
    slots: [null, null],
    game: null,
    brain: null,
    timer: null,
    timeoutStreak: [0, 0],
    bank: [BANK_MS, BANK_MS],
    deadline: 0,
    vsBot
  };
  rooms.set(code, room);
  return room;
}

export const getRoom = (code) => rooms.get(String(code || '').toUpperCase());

export function sweep() {
  for (const [code, room] of rooms) {
    if (now() - room.createdAt > ROOM_TTL_MS) {
      if (room.timer) clearTimeout(room.timer);
      rooms.delete(code);
    }
  }
}

function makeSlot(name, ws, isBot = false) {
  return {
    name: cleanName(name), token: token(), ws, isBot,
    placement: null, ready: false, connected: true
  };
}

export function joinRoom(room, name, ws) {
  const free = room.slots.findIndex((s) => s === null);
  if (free < 0) return { ok: false, error: 'Lobby ist voll.' };
  if (room.status !== 'lobby') return { ok: false, error: 'Partie läuft bereits.' };
  const slot = makeSlot(name, ws);
  room.slots[free] = slot;
  if (room.vsBot && free === 0) {
    const bot = makeSlot('Nebel-Bot', null, true);
    bot.placement = botPlacement();
    bot.ready = true;
    room.slots[1] = bot;
    room.brain = createBotBrain();
  }
  return { ok: true, index: free, slot };
}

export function rebind(room, playerToken, ws) {
  const i = room.slots.findIndex((s) => s && s.token === playerToken);
  if (i < 0) return null;
  room.slots[i].ws = ws;
  room.slots[i].connected = true;
  return i;
}

// ------------------------------------------------------------------- Senden
function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg) {
  for (const s of room.slots) if (s && !s.isBot) send(s.ws, msg);
}

export function lobbyState(room) {
  return {
    t: 'lobby',
    code: room.code,
    status: room.status,
    players: room.slots.map((s) => (s ? { name: s.name, ready: s.ready, bot: s.isBot, connected: s.connected } : null))
  };
}

export function pushLobby(room) {
  broadcast(room, lobbyState(room));
}

export function pushState(room) {
  if (!room.game) return;
  const g = room.game;
  for (let i = 0; i < 2; i++) {
    const s = room.slots[i];
    if (!s || s.isBot) continue;
    const me = g.players[i];
    const foe = g.players[1 - i];
    send(s.ws, {
      t: 'state',
      status: g.status,
      you: i,
      turn: g.turn,
      turnCount: g.turnCount,
      deadline: room.deadline,
      bank: room.bank[i],
      own: ownView(me),
      tracking: me.tracking,
      sunkEnemy: me.sunkEnemy,
      shots: g.turn === i ? requiredShots(g, i) : 0,
      baseSalvo: baseSalvo(g, i),
      canScan: g.turn === i && shipAlive(me, 'traeger') && !me.scannedThisTurn
               && baseSalvo(g, i) - (me.divedThisTurn ? 1 : 0) >= 2,
      canDive: g.turn === i && !me.divedThisTurn && !me.divedLastTurn
               && me.ships.some((sh) => sh.type === 'uboot' && sh.hits.length === 0)
               && baseSalvo(g, i) > 1,
      diving: me.diving,
      opponent: { name: room.slots[1 - i]?.name ?? '—', shipsLeft: aliveShips(foe).length, connected: room.slots[1 - i]?.connected !== false },
      winner: g.winner,
      reveal: g.status === 'finished'
        ? { own: ownView(me), foe: ownView(foe) }
        : null
    });
  }
}

// ------------------------------------------------------------------- Timer
function clearTimer(room) {
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
}

function armTurnTimer(room) {
  clearTimer(room);
  if (!room.game || room.game.status !== 'playing') return;
  room.deadline = now() + TURN_MS;
  room.timer = setTimeout(() => onTimeout(room), TURN_MS + 200);
}

function onTimeout(room) {
  const g = room.game;
  if (!g || g.status !== 'playing') return;
  const slot = g.turn;
  const extra = Math.min(room.bank[slot], 30_000);
  if (extra > 0) {
    room.bank[slot] -= extra;
    room.deadline = now() + extra;
    room.timer = setTimeout(() => onTimeout(room), extra + 200);
    pushState(room);
    return;
  }
  room.timeoutStreak[slot] += 1;
  passTurn(g, slot);
  broadcast(room, { t: 'notice', kind: 'timeout', slot });
  if (room.timeoutStreak[slot] >= 2) {
    g.status = 'finished';
    g.winner = 1 - slot;
    clearTimer(room);
    pushState(room);
    return;
  }
  afterTurn(room);
}

// -------------------------------------------------------------- Partiestart
export function setPlacement(room, slotIndex, placement) {
  const slot = room.slots[slotIndex];
  if (!slot) return { ok: false, error: 'Unbekannter Platz.' };
  if (room.status === 'playing') return { ok: false, error: 'Partie läuft bereits.' };
  const v = validatePlacement(placement);
  if (!v.ok) return v;
  slot.placement = placement;
  slot.ready = true;
  return { ok: true };
}

export function tryStart(room) {
  if (room.status === 'playing') return;
  if (!room.slots[0] || !room.slots[1]) return;
  if (!room.slots.every((s) => s.ready && s.placement)) return;

  const pa = makePlayer(room.slots[0].name, room.slots[0].placement, { isBot: room.slots[0].isBot });
  const pb = makePlayer(room.slots[1].name, room.slots[1].placement, { isBot: room.slots[1].isBot });
  const starter = Math.random() < 0.5 ? 0 : 1;
  room.game = createGame(pa, pb, { starter });
  beginTurn(room.game);
  room.status = 'playing';
  room.bank = [BANK_MS, BANK_MS];
  room.timeoutStreak = [0, 0];
  broadcast(room, { t: 'started', starter });
  armTurnTimer(room);
  pushState(room);
  maybeBotTurn(room);
}

// --------------------------------------------------------------- Zug-Ablauf
function afterTurn(room) {
  const g = room.game;
  if (g.status === 'finished') {
    room.status = 'finished';
    clearTimer(room);
    pushState(room);
    return;
  }
  armTurnTimer(room);
  pushState(room);
  maybeBotTurn(room);
}

export function doSalvo(room, slot, shots) {
  const g = room.game;
  const res = applySalvo(g, slot, shots);
  if (!res.ok) return res;
  room.timeoutStreak[slot] = 0;

  const foeIsBot = room.slots[1 - slot].isBot;
  const me = room.slots[slot];
  if (!me.isBot) send(me.ws, { t: 'salvoResult', results: res.results });
  if (res.evaded) {
    if (me.isBot) noteEvade(room.brain);
    else send(me.ws, { t: 'notice', kind: 'evaded' });
  }
  if (me.isBot) noteResults(room.brain, res.results, g.players[slot].tracking);

  // Verteidiger erfaehrt nur, dass er beschossen wurde
  const foe = room.slots[1 - slot];
  if (!foe.isBot) send(foe.ws, { t: 'notice', kind: 'incoming', cells: shots });

  afterTurn(room);
  return res;
}

export function doManeuver(room, slot, shipIndex, move) {
  const res = applyManeuver(room.game, slot, shipIndex, move);
  if (!res.ok) return res;
  room.timeoutStreak[slot] = 0;
  const foe = room.slots[1 - slot];
  if (foe.isBot) noteManeuver(room.brain);
  else send(foe.ws, { t: 'notice', kind: 'maneuvered' });
  afterTurn(room);
  return res;
}

export function doDive(room, slot) {
  const res = applyDive(room.game, slot);
  if (res.ok) pushState(room);
  return res;
}

export function doScan(room, slot, center) {
  const res = applyScan(room.game, slot, center);
  if (!res.ok) return res;
  const me = room.slots[slot];
  if (!me.isBot) send(me.ws, { t: 'scanResult', center, count: res.count });
  pushState(room);
  return res;
}

// ------------------------------------------------------------------ Bot-Zug
function maybeBotTurn(room) {
  const g = room.game;
  if (!g || g.status !== 'playing') return;
  const slot = g.turn;
  if (!room.slots[slot]?.isBot) return;

  setTimeout(() => {
    if (!room.game || room.game.status !== 'playing' || room.game.turn !== slot) return;
    const plan = planTurn(room.brain, g, slot);

    if (plan.maneuver) {
      const r = doManeuver(room, slot, plan.maneuver.shipIndex, plan.maneuver.move);
      if (r.ok) return;
    }
    if (plan.dive) applyDive(g, slot);
    if (plan.scan !== null && plan.scan !== undefined) {
      const r = applyScan(g, slot, plan.scan);
      if (r.ok) applyScanResult(room.brain, plan.scan, r.count);
    }
    const shots = planShots(room.brain, g, slot);
    doSalvo(room, slot, shots);
  }, thinkDelay(room.brain));
}

export function randomPlacementForClient() {
  return randomPlacement();
}

export function roomCount() { return rooms.size; }
