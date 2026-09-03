// NEBEL – Server-Entry: Express (statisch) + WebSocket (Spiel)

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';

import {
  createRoom, getRoom, joinRoom, rebind, pushLobby, pushState,
  setPlacement, tryStart, doSalvo, doManeuver, doDive, doScan,
  sweep, roomCount, randomPlacementForClient, lobbyState, setOptions, voteRematch
} from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: roomCount() }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

setInterval(sweep, 60_000);

function fail(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'error', msg }));
}

wss.on('connection', (ws) => {
  const ctx = { room: null, slot: -1, name: 'Kapitän' };

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return fail(ws, 'Ungültige Nachricht.'); }

    try {
      switch (m.t) {
        case 'ping':
          return ws.send(JSON.stringify({ t: 'pong' }));

        case 'hello': {
          ctx.name = m.name || ctx.name;
          if (m.code && m.token) {
            const room = getRoom(m.code);
            if (room) {
              const i = rebind(room, m.token, ws);
              if (i >= 0) {
                ctx.room = room; ctx.slot = i;
                ws.send(JSON.stringify({ t: 'welcome', playerId: i, token: m.token, code: room.code, resumed: true }));
                pushLobby(room); pushState(room);
                return;
              }
            }
          }
          return ws.send(JSON.stringify({ t: 'welcome', playerId: null, resumed: false }));
        }

        case 'createLobby': {
          const room = createRoom(false);
          const j = joinRoom(room, ctx.name, ws);
          if (!j.ok) return fail(ws, j.error);
          ctx.room = room; ctx.slot = j.index;
          ws.send(JSON.stringify({ t: 'joined', code: room.code, playerId: j.index, token: j.slot.token }));
          return pushLobby(room);
        }

        case 'joinLobby': {
          const room = getRoom(m.code);
          if (!room) return fail(ws, 'Lobby nicht gefunden. Läuft der Code noch?');
          const j = joinRoom(room, ctx.name, ws);
          if (!j.ok) return fail(ws, j.error);
          ctx.room = room; ctx.slot = j.index;
          ws.send(JSON.stringify({ t: 'joined', code: room.code, playerId: j.index, token: j.slot.token }));
          pushLobby(room);
          return;
        }

        case 'startVsBot': {
          const room = createRoom(true);
          const j = joinRoom(room, ctx.name, ws);
          if (!j.ok) return fail(ws, j.error);
          ctx.room = room; ctx.slot = j.index;
          ws.send(JSON.stringify({ t: 'joined', code: room.code, playerId: j.index, token: j.slot.token, vsBot: true }));
          return pushLobby(room);
        }

        case 'randomFleet':
          return ws.send(JSON.stringify({ t: 'randomFleet', placement: randomPlacementForClient(ctx.room) }));

        case 'setOptions': {
          if (!ctx.room) return fail(ws, 'Keine Lobby.');
          const r = setOptions(ctx.room, ctx.slot, m.options);
          if (!r.ok) return fail(ws, r.error);
          return pushLobby(ctx.room);
        }

        case 'rematch': {
          if (!ctx.room) return fail(ws, 'Keine Lobby.');
          const r = voteRematch(ctx.room, ctx.slot);
          if (!r.ok) return fail(ws, r.error);
          return;
        }

        case 'placeFleet': {
          if (!ctx.room) return fail(ws, 'Keine Lobby.');
          const r = setPlacement(ctx.room, ctx.slot, m.placement);
          if (!r.ok) return fail(ws, r.error);
          ws.send(JSON.stringify({ t: 'placementOk' }));
          pushLobby(ctx.room);
          return tryStart(ctx.room);
        }

        case 'salvo': {
          if (!ctx.room?.game) return fail(ws, 'Keine Partie.');
          if (m.scan !== null && m.scan !== undefined) {
            const s = doScan(ctx.room, ctx.slot, m.scan);
            if (!s.ok) return fail(ws, s.error);
          }
          const r = doSalvo(ctx.room, ctx.slot, m.shots);
          if (!r.ok) return fail(ws, r.error);
          return;
        }

        case 'maneuver': {
          if (!ctx.room?.game) return fail(ws, 'Keine Partie.');
          const r = doManeuver(ctx.room, ctx.slot, m.shipIndex, m.move);
          if (!r.ok) return fail(ws, r.error);
          return;
        }

        case 'dive': {
          if (!ctx.room?.game) return fail(ws, 'Keine Partie.');
          const r = doDive(ctx.room, ctx.slot);
          if (!r.ok) return fail(ws, r.error);
          return;
        }

        case 'scan': {
          if (!ctx.room?.game) return fail(ws, 'Keine Partie.');
          const r = doScan(ctx.room, ctx.slot, m.center);
          if (!r.ok) return fail(ws, r.error);
          return;
        }

        default:
          return fail(ws, 'Unbekannter Nachrichtentyp.');
      }
    } catch (err) {
      console.error('handler', err);
      return fail(ws, 'Serverfehler.');
    }
  });

  ws.on('close', () => {
    if (ctx.room && ctx.slot >= 0 && ctx.room.slots[ctx.slot]) {
      ctx.room.slots[ctx.slot].connected = false;
      pushLobby(ctx.room);
      pushState(ctx.room);
    }
  });
});

// tote Verbindungen aufraeumen
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

server.listen(PORT, () => console.log(`NEBEL läuft auf :${PORT}`));
