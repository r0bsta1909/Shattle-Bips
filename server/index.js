// Shattle Bips – Server-Entry: Express (statisch) + WebSocket (Spiel)

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';

import {
  createRoom, getRoom, joinRoom, rebind, pushLobby, pushState,
  setPlacement, tryStart, doSalvo, doManeuver, doDive, doScan,
  sweep, roomCount, randomPlacementForClient, lobbyState, setOptions, voteRematch, withdrawPlacement
} from './rooms.js';
import { VERSION } from './version.js';
import { submitFeedback, sweepLimits, feedbackStatus, readMemory, diagnose, explain } from './feedback.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();

// Auf Render steht genau ein Proxy davor. Ohne das landet jedes Feedback unter
// derselben IP und die Pro-Absender-Bremse waere wirkungslos. Lokal bleibt es
// aus, damit sich X-Forwarded-For nicht faelschen laesst.
if (process.env.RENDER) app.set('trust proxy', 1);

// "no-cache" heisst nicht "nicht cachen", sondern "vor jeder Nutzung rueckfragen".
// Der Browser behaelt die Datei, validiert sie aber gegen den ETag und bekommt in
// aller Regel ein leeres 304 zurueck – ein paar hundert Byte pro Aufruf.
//
// Vorher stand hier maxAge: '1h'. Das ist fuer ein Projekt ohne Build-Schritt und
// ohne Hashes in den Dateinamen die falsche Wahl: nach einem Deploy laeuft bis zu
// eine Stunde lang altes app.js gegen neues index.html. Sichtbar wurde das am
// Feedback-Knopf, der zwar erschien, aber ins Leere klickte – der Handler steckte
// im alten Skript. Der Versionsstand im Kopf kommt von /version und war zugleich
// schon der neue, was die Fehlersuche zusaetzlich in die Irre fuehrt.
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: true,
  lastModified: true,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache')
}));
app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: roomCount(), version: VERSION.label }));

// ------------------------------------------------------------------ Version
// Der Client holt das beim Laden und schreibt es in die Kopfzeile.
app.get('/version', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(VERSION);
});

// ----------------------------------------------------------------- Feedback
app.post('/api/feedback', express.json({ limit: '16kb' }), async (req, res) => {
  const body = req.body || {};
  const r = await submitFeedback({
    text: body.text,
    ip: req.ip,
    meta: {
      screen: body.screen,
      code: body.code,
      options: body.options,
      ua: req.get('user-agent')
    }
  });
  if (!r.ok) {
    if (r.detail) console.error('feedback:', r.detail);   // Interna nur ins Log
    const code = r.status || (r.detail ? 502 : 400);      // 429 Bremse, 502 Senke, 400 Text
    return res.status(code).json({ ok: false, error: r.error });
  }
  res.json({ ok: true, ref: r.ref || null, url: r.url || null });
});

// Diagnose, damit ein kaputter Feedback-Weg nicht im Serverlog gesucht werden muss.
// Oeffentlich steht hier nur, ob die Senke arbeitsfaehig ist und woran es sonst
// liegt - keine Tokens, keine GitHub-Rohantworten. Mit FEEDBACK_ADMIN_TOKEN
// kommen Repo-Pfad, Statuscode und der letzte Fehlschlag dazu.
app.get('/api/feedback/status', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const d = await diagnose();
  const admin = process.env.FEEDBACK_ADMIN_TOKEN
    && req.get('x-admin-token') === process.env.FEEDBACK_ADMIN_TOKEN;

  // Oeffentlich nur Kategorien, nie Inhalte: der Ursachen-Slug reicht zur
  // Selbsthilfe und verraet weder Token noch GitHub-Rohantwort.
  if (!admin) return res.json({ sink: d.sink, ok: d.ok, reason: d.reason, reads: d.reads ?? null });

  // Bewusst Feld fuer Feld statt Spread: feedbackStatus() fuehrt selbst ein
  // "version" (den Labelstring) und wuerde das Versionsobjekt still ueberschreiben.
  res.json({
    ...d,
    hint: explain(d),
    version: VERSION,
    lastError: feedbackStatus().lastError
  });
});

// Nur fuer die Memory-Senke gedacht: ohne Token gibt es den Endpunkt nicht.
app.get('/api/feedback', (req, res) => {
  const want = process.env.FEEDBACK_ADMIN_TOKEN;
  if (!want) return res.status(404).end();
  if (req.get('x-admin-token') !== want) return res.status(401).json({ ok: false });
  res.json({ ok: true, ...feedbackStatus(), entries: readMemory() });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

setInterval(sweep, 60_000);
setInterval(() => sweepLimits(), 10 * 60_000);

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

        case 'withdrawPlacement': {
          if (!ctx.room) return fail(ws, 'Keine Lobby.');
          const r = withdrawPlacement(ctx.room, ctx.slot);
          if (!r.ok) return fail(ws, r.error);
          ws.send(JSON.stringify({ t: 'placementWithdrawn' }));
          return pushLobby(ctx.room);
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

server.listen(PORT, async () => {
  console.log(`Shattle Bips ${VERSION.label} läuft auf :${PORT}`);
  // Einmal beim Start pruefen, damit eine falsch gesetzte Variable sofort
  // im Log steht statt erst beim ersten Feedback eines Spielers.
  try { console.log(explain(await diagnose())); } catch { /* Diagnose darf den Start nie verhindern */ }
});
