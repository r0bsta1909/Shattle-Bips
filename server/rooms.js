// Shattle Bips – Lobby- und Partieverwaltung (autoritativ, in-memory)

import {
  makePlayer, createGame, randomPlacement, validatePlacement, mergeOptions, DEFAULT_OPTIONS,
  applySalvo, applyManeuver, applyDive, applyScan, passTurn, beginTurn,
  requiredShots, shotsAvailable, baseSalvo, ownView, aliveShips, shipAlive, summarize, maneuverOptions
} from './rules.js';
import {
  createBotBrain, botPlacement, planTurn, planShots,
  noteResults, noteEvade, noteManeuver, applyScanResult, thinkDelay
} from './bot.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne I,O,0,1
const BANK_MS = 0;   // Zeitbank standardmaessig aus: Timeout gibt den Zug ab
const PLACEMENT_MS = 180_000;
const ROOM_TTL_MS = 45 * 60_000;
// Wartefenster auf die Rueckkehr eines Menschen, bevor die Partie ihm
// abgenommen wird (Issue #25).
const GRACE_MS = 30_000;

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
    options: { ...DEFAULT_OPTIONS },
    rematchVotes: new Set(),
    paused: false,
    graceTimer: null,
    graceUntil: 0,
    vsBot
  };
  rooms.set(code, room);
  return room;
}

export const getRoom = (code) => rooms.get(String(code || '').toUpperCase());

/**
 * Raum sofort freigeben: Timer loeschen und aus der Ablage nehmen.
 * Ohne das haelt ein offener Zug-Timer den Prozess am Leben – im Test war das
 * der Unterschied zwischen einer und drei Minuten Laufzeit.
 */
export function closeRoom(room) {
  if (!room) return;
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
  if (room.graceTimer) { clearTimeout(room.graceTimer); room.graceTimer = null; }
  rooms.delete(room.code);
}

export function sweep() {
  for (const [code, room] of rooms) {
    if (now() - room.createdAt > ROOM_TTL_MS) {
      if (room.timer) clearTimeout(room.timer);
      if (room.graceTimer) clearTimeout(room.graceTimer);
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
    const bot = makeSlot('Shattle-Bot', null, true);
    bot.placement = botPlacement(Math.random, room.options);
    bot.ready = true;
    room.slots[1] = bot;
    room.brain = createBotBrain();
  }
  return { ok: true, index: free, slot };
}

export function setOptions(room, slotIndex, raw) {
  if (room.status === 'playing') return { ok: false, error: 'Partie läuft bereits.' };
  if (slotIndex !== 0) return { ok: false, error: 'Nur der Host stellt die Regeln ein.' };
  room.options = mergeOptions(raw);
  // Aufstellungen verwerfen, wenn sich die Köderzahl geändert hat
  let dropped = false;
  for (const s of room.slots) {
    if (!s) continue;
    if (s.isBot) { s.placement = botPlacement(Math.random, room.options); s.ready = true; }
    else {
      if (s.ready || s.placement) dropped = true;
      s.placement = null;
      s.ready = false;
    }
  }
  // Wer gerade aufstellt, muss davon erfahren: sonst legt er unter alten Regeln
  // fertig, bekommt beim "Bereit" eine unverständliche Ablehnung und wartet auf
  // einen Start, der nie kommt (Issues #5 und #6).
  if (dropped) broadcast(room, { t: 'notice', kind: 'optionsChanged' });
  return { ok: true, options: room.options };
}

/** Bereit-Status zuruecknehmen, um die Aufstellung noch einmal zu aendern. */
export function withdrawPlacement(room, slotIndex) {
  if (room.status === 'playing') return { ok: false, error: 'Partie läuft bereits.' };
  const slot = room.slots[slotIndex];
  if (!slot) return { ok: false, error: 'Unbekannter Platz.' };
  slot.placement = null;
  slot.ready = false;
  return { ok: true };
}

export function rebind(room, playerToken, ws) {
  const i = room.slots.findIndex((s) => s && s.token === playerToken);
  // -1 statt null: der Aufrufer prueft `i >= 0`, und `null >= 0` ist WAHR.
  // Mit null waere ein falsches Token als geglueckter Wiedereinstieg
  // durchgegangen und der Platz danach undefined.
  if (i < 0) return -1;
  room.slots[i].ws = ws;
  room.slots[i].connected = true;
  resumeRoom(room);
  return i;
}

/** Ist noch ein Mensch verbunden, der ziehen koennte? */
function connectedHumans(room) {
  return room.slots.filter((s) => s && !s.isBot && s.connected).length;
}

/**
 * Niemand mehr da, der ziehen koennte: Uhr anhalten (Issue #25).
 *
 * Vorher lief die Partie ohne ihren Menschen weiter - der Bot zog, die Zugzeit
 * des Abwesenden lief ab, und nach zwei verpassten Zuegen stand er beim
 * Zurueckkommen auf dem Verloren-Bildschirm einer Partie, die er nur verlassen
 * hatte, um die Seite neu zu laden.
 *
 * Ist noch ein Mensch da (Partie unter Menschen), bekommt der ein Zeitfenster:
 * `graceUntil` sagt ihm, wie lange auf die Rueckkehr gewartet wird. Danach
 * gewinnt er. Ohne das Fenster gaebe es fuer ihn kein Ende.
 */
function pauseRoom(room, by) {
  if (!room.game || room.game.status !== 'playing') return;
  if (connectedHumans(room) > 0 && !by) return;
  clearTimer(room);
  room.paused = true;

  if (connectedHumans(room) > 0) {
    room.graceUntil = now() + GRACE_MS;
    room.graceTimer = setTimeout(() => {
      if (!room.game || room.game.status !== 'playing') return;
      const bleibt = room.slots.findIndex((s) => s && !s.isBot && s.connected);
      if (bleibt >= 0) room.game.winner = bleibt;
      finishRoom(room, 'left');
    }, GRACE_MS + 200);
    broadcast(room, { t: 'notice', kind: 'opponentGone', by, seconds: GRACE_MS / 1000 });
  }
  pushState(room);
}

/** Jemand ist zurueck: Uhr wieder anwerfen und das Wartefenster abraeumen. */
function resumeRoom(room) {
  if (room.graceTimer) { clearTimeout(room.graceTimer); room.graceTimer = null; }
  room.graceUntil = 0;
  if (!room.paused) return;
  room.paused = false;
  if (!room.game || room.game.status !== 'playing') return;
  broadcast(room, { t: 'notice', kind: 'opponentBack' });
  armTurnTimer(room);
  pushState(room);
  maybeBotTurn(room);
}

/**
 * Partie freiwillig verlassen (Issue #25).
 * Gegen den Bot ist sie danach weg - es gibt niemanden, auf den zu warten
 * waere. Gegen Menschen ist es dasselbe wie ein Verbindungsabbruch: der
 * Verbliebene wird informiert und bekommt sein Wartefenster.
 */
export function leaveGame(room, slotIndex) {
  const slot = room.slots[slotIndex];
  if (!slot) return { ok: false, error: 'Nicht in dieser Partie.' };

  const andereMenschen = room.slots.some((s, i) => s && !s.isBot && i !== slotIndex && s.connected);
  if (!andereMenschen) { closeRoom(room); return { ok: true, closed: true }; }

  slot.connected = false;
  room.rematchVotes.delete(slotIndex);
  pauseRoom(room, slot.name);
  return { ok: true, closed: false };
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
    options: room.options,
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
      // Angehalten, weil der Gegenspieler weg ist. Ohne diese beiden Felder
      // laeuft die Uhr im Client weiter, obwohl serverseitig nichts mehr
      // passiert - und der Verbliebene weiss nicht, worauf er wartet.
      paused: room.paused === true,
      graceUntil: room.graceUntil || 0,
      own: ownView(me),
      tracking: me.tracking,
      scans: me.scans,
      options: g.options,
      sunkEnemy: me.sunkEnemy,
      // Welche Treffer zu einem versenkten Schiff gehoeren. Verraet nichts:
      // jedes Feld eines versenkten Schiffs hat der Spieler selbst getroffen,
      // steht bei ihm also ohnehin auf HIT. Ohne das sieht ein versenktes
      // Schiff auf dem Gegnerraster aus wie ein angeschlagenes (Issue #18).
      sunkCells: foe.ships.filter((sh) => sh.hits.length >= sh.len).flatMap((sh) => sh.cells),
      shots: g.turn === i ? requiredShots(g, i) : 0,
      baseSalvo: baseSalvo(g, i),
      // Bei laufendem Vorrat ist "shots" die Obergrenze, nicht die Pflicht -
      // der Spieler waehlt zwischen Einzelschuss und Salve.
      // Was gerade manoevriert werden darf, rechnet der Server: sonst muesste
      // der Client Halo, Beschuss und Reichweite noch einmal nachbauen - eine
      // zweite Fassung der Regeln, die auseinanderlaufen kann.
      maneuver: maneuverOptions(g, i),
      salvoPool: (g.options || {}).salvoPool === true,
      salvosLeft: me.salvosLeft,
      // Die Optionsflags fehlten hier: bei abgeschalteter Aufklärung blieb der
      // Knopf bedienbar und der Server wies den Klick erst hinterher ab.
      canScan: (g.options || {}).scanEnabled !== false
               && g.turn === i && shipAlive(me, 'traeger') && !me.scannedThisTurn
               && baseSalvo(g, i) - (me.divedThisTurn ? 1 : 0) >= 2,
      canDive: (g.options || {}).diveEnabled !== false
               && g.turn === i && !me.divedThisTurn && !me.divedLastTurn
               && me.ships.some((sh) => sh.type === 'uboot' && sh.hits.length === 0)
               && baseSalvo(g, i) > 1,
      // Warum ein Knopf gesperrt ist – sonst raet der Spieler.
      scanBlocked: scanBlockReason(g, i, me),
      diving: me.diving,
      endReason: g.endReason || null,
      opponent: { name: room.slots[1 - i]?.name ?? '—', shipsLeft: aliveShips(foe).length, connected: room.slots[1 - i]?.connected !== false },
      winner: g.winner,
      reveal: g.status === 'finished'
        ? { own: ownView(me), foe: ownView(foe) }
        : null,
      // Taeuschungsbilanz beider Seiten, erst am Ende. Verraet nichts, was die
      // Aufdeckung darueber nicht ohnehin zeigt - und die gegnerische Bilanz
      // ist die interessantere: sie erklaert, WARUM es so ausging.
      summary: g.status === 'finished'
        ? { own: summarize(g, i), foe: summarize(g, 1 - i) }
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
  const ms = (room.options.turnSeconds || 60) * 1000;
  room.deadline = now() + ms;
  room.timer = setTimeout(() => onTimeout(room), ms + 200);
}

/**
 * Warum die Aufklärung gerade nicht geht. null = sie geht.
 * Im Eröffnungszug hat der Startspieler nur 1 Schuss, ein Scan kostet aber
 * einen und verlangt mindestens 2 – das war fuer Spieler nicht erkennbar
 * und fuehrte zu "zu wenig Schuesse, obwohl noch keiner genutzt" (Issue #7).
 */
function scanBlockReason(g, slot, me) {
  if (g.turn !== slot) return null;
  if ((g.options || {}).scanEnabled === false) return 'Aufklärung ist in dieser Partie abgeschaltet.';
  if (!shipAlive(me, 'traeger')) return 'Träger versenkt – keine Aufklärung mehr.';
  if (me.scannedThisTurn) return 'In diesem Zug schon aufgeklärt.';
  if (baseSalvo(g, slot) - (me.divedThisTurn ? 1 : 0) < 2) {
    return g.turnCount === 0 && slot === g.starter
      ? 'Eröffnungszug: nur 1 Schuss. Aufklärung braucht mindestens 2.'
      : 'Zu wenige Schüsse für eine Aufklärung – sie kostet einen davon.';
  }
  return null;
}

/**
 * Partie beenden – an genau einer Stelle, damit Spiel- und Raumzustand nicht
 * auseinanderlaufen koennen.
 *
 * Vorher setzte onTimeout() nur g.status. room.status blieb auf 'playing',
 * und voteRematch() lehnte danach mit "Partie läuft noch." ab: Die Revanche
 * wurde angefragt und nie angenommen (Issue #4).
 */
function finishRoom(room, reason) {
  room.game.status = 'finished';
  room.game.endReason = reason;
  room.status = 'finished';
  clearTimer(room);
  pushState(room);
}

function onTimeout(room) {
  const g = room.game;
  if (!g || g.status !== 'playing') return;
  const slot = g.turn;
  room.timeoutStreak[slot] += 1;
  passTurn(g, slot);
  broadcast(room, { t: 'notice', kind: 'timeout', slot });
  if (room.timeoutStreak[slot] >= 2) {
    g.winner = 1 - slot;
    finishRoom(room, 'timeout');
    return;
  }
  afterTurn(room);
}

// -------------------------------------------------------------- Partiestart
export function setPlacement(room, slotIndex, placement) {
  const slot = room.slots[slotIndex];
  if (!slot) return { ok: false, error: 'Unbekannter Platz.' };
  if (room.status === 'playing') return { ok: false, error: 'Partie läuft bereits.' };
  const v = validatePlacement(placement, room.options);
  if (!v.ok) return v;
  slot.placement = placement;
  slot.ready = true;
  return { ok: true };
}

export function tryStart(room) {
  if (room.status === 'playing') return;
  if (!room.slots[0] || !room.slots[1]) return;
  if (!room.slots.every((s) => s.ready && s.placement)) return;

  // makePlayer wirft, wenn eine gespeicherte Aufstellung nicht mehr zu den
  // Optionen passt. Ungefangen wurde daraus ein blankes "Serverfehler." und
  // die Lobby blieb haengen. Jetzt wird der betroffene Platz gezielt
  // zurueckgesetzt und benannt, damit er neu aufstellen kann.
  for (let i = 0; i < 2; i++) {
    const check = validatePlacement(room.slots[i].placement, room.options);
    if (!check.ok) {
      room.slots[i].placement = null;
      room.slots[i].ready = false;
      send(room.slots[i].ws, { t: 'error', msg: `Aufstellung passt nicht mehr zu den Regeln: ${check.error}` });
      broadcast(room, { t: 'notice', kind: 'placementDropped', who: room.slots[i].name });
      pushLobby(room);
      return;
    }
  }

  const pa = makePlayer(room.slots[0].name, room.slots[0].placement, { isBot: room.slots[0].isBot, options: room.options });
  const pb = makePlayer(room.slots[1].name, room.slots[1].placement, { isBot: room.slots[1].isBot, options: room.options });
  const starter = Math.random() < 0.5 ? 0 : 1;
  room.game = createGame(pa, pb, { starter, options: room.options });
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
    finishRoom(room, g.endReason || 'allSunk');
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

export function doManeuver(room, slot, shipIndex, move, extra) {
  const res = applyManeuver(room.game, slot, shipIndex, move, extra);
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
      const r = doManeuver(room, slot, plan.maneuver.shipIndex, plan.maneuver.move,
        { steps: plan.maneuver.steps, dive: plan.maneuver.dive });
      if (r.ok) return;
    }
    if (plan.dive) applyDive(g, slot);
    if (plan.scan !== null && plan.scan !== undefined) {
      const r = applyScan(g, slot, plan.scan);
      if (r.ok) applyScanResult(room.brain, plan.scan, r.count);
    }
    const shots = planShots(room.brain, g, slot);
    doSalvo(room, slot, shots);
  }, thinkDelay(room.brain, room.options));
}

export function randomPlacementForClient(room) {
  return randomPlacement(Math.random, room ? room.options : undefined);
}

/** Revanche: gleiche Lobby, gleiche Gegner, neue Aufstellung. */
export function voteRematch(room, slotIndex) {
  if (room.status !== 'finished') return { ok: false, error: 'Partie läuft noch.' };

  // Nur verbundene Menschen zaehlen. Vorher wurden die Plaetze gezaehlt: hatte
  // der Gegner das Fenster geschlossen, galt seine alte Stimme weiter, die
  // Revanche startete - und der Annehmende sass allein in der Lobby (Issue #14).
  const humans = room.slots.filter((s) => s && !s.isBot);
  const present = humans.filter((s) => s.connected);
  if (present.length < humans.length) {
    return { ok: false, error: 'Der Gegner ist nicht mehr verbunden. Keine Revanche möglich.' };
  }

  room.rematchVotes.add(slotIndex);
  if (room.rematchVotes.size < present.length) {
    broadcast(room, { t: 'notice', kind: 'rematchWanted', by: room.slots[slotIndex].name });
    return { ok: true, waiting: true };
  }
  clearTimer(room);
  room.rematchVotes.clear();
  room.game = null;
  room.status = 'lobby';
  room.timeoutStreak = [0, 0];
  room.bank = [BANK_MS, BANK_MS];
  for (const s of room.slots) {
    if (!s) continue;
    if (s.isBot) { s.placement = botPlacement(Math.random, room.options); s.ready = true; }
    else { s.placement = null; s.ready = false; }
  }
  if (room.brain) room.brain = createBotBrain();
  broadcast(room, { t: 'rematch' });
  pushLobby(room);
  return { ok: true, waiting: false };
}

/** Revanche ablehnen: Stimmen verwerfen und den Anfragenden informieren. */
export function declineRematch(room, slotIndex) {
  if (room.status !== 'finished') return { ok: false, error: 'Partie läuft noch.' };
  room.rematchVotes.clear();
  broadcast(room, { t: 'notice', kind: 'rematchDeclined', by: room.slots[slotIndex]?.name ?? '—' });
  return { ok: true };
}

/**
 * Verbindung eines Platzes ist weg. Seine Revanche-Stimme muss mit, sonst
 * genuegt spaeter die Stimme des Verbliebenen und er startet allein.
 */
export function markDisconnected(room, slotIndex) {
  const slot = room.slots[slotIndex];
  if (!slot) return;
  slot.connected = false;
  room.rematchVotes.delete(slotIndex);
  // Nach Partieende wartet der Verbliebene sonst auf eine Revanche, die nie
  // kommen kann. Die Meldung geht raus, egal ob der Weggegangene schon
  // abgestimmt hatte – wichtig ist, dass das Warten aufhoert.
  if (room.status === 'finished' && !slot.isBot) {
    broadcast(room, { t: 'notice', kind: 'rematchOff', by: slot.name });
  }
  // Laufende Partie ohne ihren Menschen: Uhr anhalten statt sie weiterlaufen
  // zu lassen (Issue #25).
  if (!slot.isBot) pauseRoom(room, connectedHumans(room) > 0 ? slot.name : null);
}

export function roomCount() { return rooms.size; }
