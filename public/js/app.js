// NEBEL – Client

const N = 10;
const FLEET = [
  { type: 'traeger', label: 'Träger', len: 5 },
  { type: 'schlachtschiff', label: 'Schlachtschiff', len: 4 },
  { type: 'kreuzer', label: 'Kreuzer', len: 3 },
  { type: 'uboot', label: 'U-Boot', len: 3 },
  { type: 'zerstoerer', label: 'Zerstörer', len: 2 }
];
const DECOYS = [{ type: 'decoy', label: 'Köder 1', len: 2 }, { type: 'decoy', label: 'Köder 2', len: 2 }];

const $ = (id) => document.getElementById(id);
const ix = (r, c) => r * N + c;
const rc = (i) => [Math.floor(i / N), i % N];

// ------------------------------------------------------------------- Netz
let ws = null, myToken = null, myCode = null, mySlot = null;
let state = null, mode = 'normal', selected = new Set(), scanCenter = null;
let deadline = 0, clockTimer = null;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    $('conn').textContent = 'verbunden';
    send({ t: 'hello', name: nameValue(), code: myCode, token: myToken });
    setInterval(() => { if (ws.readyState === 1) send({ t: 'ping' }); }, 300_000);
  };
  ws.onclose = () => {
    $('conn').textContent = 'getrennt – verbinde neu…';
    setTimeout(connect, 2000);
  };
  ws.onmessage = (ev) => handle(JSON.parse(ev.data));
}
const send = (m) => ws && ws.readyState === 1 && ws.send(JSON.stringify(m));

function nameValue() {
  const v = $('name').value.trim();
  if (v) localStorage.setItem('nebel.name', v);
  return v || 'Kapitän';
}

// ------------------------------------------------------------- Screens
function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.remove('active');
  $(id).classList.add('active');
}

function log(text, strong = false) {
  const li = document.createElement('li');
  li.innerHTML = strong ? `<b>${text}</b>` : text;
  $('log').prepend(li);
}

// --------------------------------------------------------- Nachrichten
function handle(m) {
  switch (m.t) {
    case 'welcome':
      if (m.resumed) { mySlot = m.playerId; myCode = m.code; }
      break;
    case 'joined':
      myCode = m.code; myToken = m.token; mySlot = m.playerId;
      localStorage.setItem('nebel.token', myToken);
      localStorage.setItem('nebel.code', myCode);
      $('lobby-code').textContent = m.code;
      $('join-url').value = `${location.origin}/#${m.code}`;
      show('screen-lobby');
      if (m.vsBot) startPlacement();
      break;
    case 'lobby': {
      $('lobby-code').textContent = m.code;
      const ul = $('lobby-players'); ul.innerHTML = '';
      for (const p of m.players) {
        const li = document.createElement('li');
        li.textContent = p ? `${p.name}${p.bot ? ' (Bot)' : ''} — ${p.ready ? 'bereit' : 'stellt auf…'}` : 'wartet auf Mitspieler…';
        ul.appendChild(li);
      }
      break;
    }
    case 'placementOk':
      $('place-error').textContent = '';
      $('btn-ready').disabled = true;
      $('place-hint').textContent = 'Aufstellung übermittelt. Warte auf den Gegner…';
      break;
    case 'started':
      show('screen-game');
      log('Partie gestartet.', true);
      break;
    case 'state':
      state = m; renderGame(); break;
    case 'salvoResult':
      for (const r of m.results) {
        const [r0, c0] = rc(r.cell);
        const coord = `${String.fromCharCode(65 + c0)}${r0 + 1}`;
        if (r.result === 'water') log(`${coord}: Wasser.`);
        else if (r.result === 'hit') log(`${coord}: <b>Treffer.</b>`);
        else log(`${coord}: <b>${r.shipLabel} versenkt!</b>`, false);
      }
      break;
    case 'scanResult': {
      const [r0, c0] = rc(m.center);
      log(`Aufklärung um ${String.fromCharCode(65 + c0)}${r0 + 1}: <b>${m.count}</b> belegte Felder.`);
      break;
    }
    case 'notice':
      if (m.kind === 'maneuvered') log('Gegnermeldung: <b>Flotte manövriert.</b>');
      if (m.kind === 'evaded') log('Meldung: <b>U-Boot ausgewichen.</b> Einer deiner „Wasser“-Treffer war keiner.');
      if (m.kind === 'incoming') log(`Beschuss auf ${m.cells.length} Feld(er).`);
      if (m.kind === 'timeout') log('Zug verfallen (Zeit abgelaufen).');
      break;
    case 'randomFleet':
      loadPlacement(m.placement); break;
    case 'error':
      $('game-error').textContent = m.msg;
      $('place-error').textContent = m.msg;
      setTimeout(() => { $('game-error').textContent = ''; }, 4000);
      break;
  }
}

// -------------------------------------------------------- Aufstellung
let placeObjects = [];      // {kind,type,label,len,r,c,horiz,cells}
let placeSel = 0, placeHoriz = true;

function placeQueue() {
  return [...FLEET.map((f) => ({ ...f, kind: 'ship' })), ...DECOYS.map((d) => ({ ...d, kind: 'decoy' }))];
}

function startPlacement() {
  placeObjects = [];
  placeSel = 0; placeHoriz = true;
  buildGrid($('place-grid'), onPlaceClick, onPlaceHover);
  renderPlacement();
  show('screen-placement');
}

function cellsFor(r, c, len, horiz) {
  const out = [];
  for (let i = 0; i < len; i++) {
    const rr = horiz ? r : r + i, cc = horiz ? c + i : c;
    if (rr >= N || cc >= N) return null;
    out.push(ix(rr, cc));
  }
  return out;
}

function blockedSet(exceptIndex = -1) {
  const s = new Set();
  placeObjects.forEach((o, k) => {
    if (k === exceptIndex) return;
    for (const i of o.cells) {
      const [r, c] = rc(i);
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < N && cc >= 0 && cc < N) s.add(ix(rr, cc));
      }
    }
  });
  return s;
}

function onPlaceHover(i) {
  const q = placeQueue();
  if (placeSel >= q.length) return;
  const spec = q[placeSel];
  const [r, c] = rc(i);
  const cells = cellsFor(r, c, spec.len, placeHoriz);
  for (const el of $('place-grid').children) el.classList.remove('preview', 'bad');
  if (!cells) return;
  const blocked = blockedSet();
  const ok = !cells.some((x) => blocked.has(x));
  for (const x of cells) $('place-grid').children[x].classList.add(ok ? 'preview' : 'bad');
}

function onPlaceClick(i) {
  const q = placeQueue();
  if (placeSel >= q.length) return;
  const spec = q[placeSel];
  const [r, c] = rc(i);
  const cells = cellsFor(r, c, spec.len, placeHoriz);
  if (!cells) return;
  if (cells.some((x) => blockedSet().has(x))) { $('place-error').textContent = 'Dort ist kein Platz – ein Feld Abstand ist Pflicht.'; return; }
  $('place-error').textContent = '';
  placeObjects.push({ ...spec, r, c, horiz: placeHoriz, cells });
  placeSel = placeObjects.length;
  renderPlacement();
}

function renderPlacement() {
  const grid = $('place-grid');
  for (const el of grid.children) el.className = 'cell';
  for (const o of placeObjects) {
    for (const i of o.cells) grid.children[i].classList.add(o.kind === 'decoy' ? 'decoy' : 'ship');
  }
  const q = placeQueue();
  const ul = $('ship-list'); ul.innerHTML = '';
  q.forEach((spec, k) => {
    const li = document.createElement('li');
    li.textContent = `${spec.label} (${spec.len})`;
    if (k < placeObjects.length) li.classList.add('done');
    if (k === placeSel) li.classList.add('active');
    li.onclick = () => { if (k <= placeObjects.length) { placeObjects = placeObjects.slice(0, k); placeSel = k; renderPlacement(); } };
    ul.appendChild(li);
  });
  $('btn-ready').disabled = placeObjects.length !== q.length;
}

function loadPlacement(p) {
  placeObjects = [];
  for (const s of p.ships) {
    const spec = FLEET.find((f) => f.type === s.type);
    placeObjects.push({ ...spec, kind: 'ship', r: s.r, c: s.c, horiz: s.horiz, cells: cellsFor(s.r, s.c, spec.len, s.horiz) });
  }
  // Reihenfolge an die Warteschlange angleichen
  placeObjects.sort((a, b) => placeQueue().findIndex((q) => q.type === a.type) - placeQueue().findIndex((q) => q.type === b.type));
  p.decoys.forEach((d, k) => {
    placeObjects.push({ ...DECOYS[k], kind: 'decoy', r: d.r, c: d.c, horiz: d.horiz, cells: cellsFor(d.r, d.c, 2, d.horiz) });
  });
  placeSel = placeObjects.length;
  renderPlacement();
}

// --------------------------------------------------------------- Partie
function buildGrid(el, onClick, onHover) {
  el.innerHTML = '';
  for (let i = 0; i < N * N; i++) {
    const d = document.createElement('div');
    d.className = 'cell';
    d.dataset.i = i;
    if (onClick) d.onclick = () => onClick(i);
    if (onHover) d.onmouseenter = () => onHover(i);
    el.appendChild(d);
  }
}

function renderGame() {
  if (!state) return;
  if (state.status === 'finished') return renderEnd();

  const foe = $('foe-grid');
  if (!foe.children.length) {
    buildGrid(foe, onFoeClick, onFoeHover);
    buildGrid($('own-grid'), null, null);
  }

  // Gegnerbrett
  for (let i = 0; i < N * N; i++) {
    const el = foe.children[i];
    el.className = 'cell';
    const v = state.tracking[i];
    if (v === 1) el.classList.add('miss');
    if (v === 2) el.classList.add('hit');
    if (selected.has(i)) el.classList.add('sel');
  }

  // eigenes Brett
  const own = $('own-grid');
  for (let i = 0; i < N * N; i++) own.children[i].className = 'cell';
  for (const s of state.own.ships) {
    for (const i of s.cells) {
      const el = own.children[i];
      el.classList.add(s.sunk ? 'sunk' : (s.hits.includes(i) ? 'hit' : 'ship'));
    }
  }
  for (const d of state.own.decoys) {
    for (const i of d.cells) own.children[i].classList.add(d.hits.includes(i) ? 'hit' : 'decoy');
  }
  for (const i of state.own.incoming) {
    if (!own.children[i].classList.contains('hit') && !own.children[i].classList.contains('sunk')) {
      own.children[i].classList.add('miss');
    }
  }

  $('foe-name').textContent = state.opponent.name;
  $('foe-ships').textContent = `${state.opponent.shipsLeft} Schiffe`;
  const mine = state.turn === state.you;
  $('turn-banner').textContent = mine ? 'Du bist am Zug.' : `${state.opponent.name} ist am Zug…`;
  $('turn-banner').classList.toggle('you', mine);
  $('shots-left').textContent = mine ? `${selected.size}/${state.shots}` : '–';
  $('bank').textContent = `${Math.round(state.bank / 1000)} s`;
  deadline = state.deadline;

  $('btn-fire').disabled = !mine || mode !== 'normal' || selected.size !== state.shots;
  $('btn-scan').disabled = !mine || !state.canScan || mode === 'maneuver';
  $('btn-dive').disabled = !mine || !state.canDive;
  $('btn-maneuver').disabled = !mine;
  $('btn-scan').textContent = mode === 'scan' ? 'Scan-Ziel wählen…' : 'Aufklären';

  const sel = $('maneuver-ship'); sel.innerHTML = '';
  for (const s of state.own.ships) {
    if (s.hits.length === 0 && !s.sunk) {
      const o = document.createElement('option');
      o.value = s.index; o.textContent = `${s.label} (${s.len})`;
      sel.appendChild(o);
    }
  }
  if (!clockTimer) clockTimer = setInterval(tickClock, 500);
}

function tickClock() {
  if (!deadline) return;
  const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
  $('clock').textContent = `${left} s`;
}

function onFoeHover(i) {
  if (mode !== 'scan') return;
  const foe = $('foe-grid');
  for (const el of foe.children) el.classList.remove('scanzone');
  const [r, c] = rc(i);
  if (r < 1 || r > N - 2 || c < 1 || c > N - 2) return;
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) foe.children[ix(r + dr, c + dc)].classList.add('scanzone');
}

function onFoeClick(i) {
  if (!state || state.turn !== state.you) return;
  if (mode === 'scan') {
    const [r, c] = rc(i);
    if (r < 1 || r > N - 2 || c < 1 || c > N - 2) { $('game-error').textContent = 'Scan-Mittelpunkt muss vollständig im Raster liegen.'; return; }
    send({ t: 'scan', center: i });
    mode = 'normal';
    for (const el of $('foe-grid').children) el.classList.remove('scanzone');
    return;
  }
  if (state.tracking[i] !== 0) return;
  if (selected.has(i)) selected.delete(i);
  else if (selected.size < state.shots) selected.add(i);
  renderGame();
}

function renderEnd() {
  const won = state.winner === state.you;
  $('end-title').textContent = won ? 'Gewonnen.' : 'Verloren.';
  $('end-detail').textContent = `Partie nach ${state.turnCount} Zügen beendet.`;
  const paint = (elId, view) => {
    const el = $(elId);
    if (!el.children.length) buildGrid(el, null, null);
    for (const c of el.children) c.className = 'cell';
    for (const s of view.ships) for (const i of s.cells) el.children[i].classList.add(s.sunk ? 'sunk' : (s.hits.includes(i) ? 'hit' : 'ship'));
    for (const d of view.decoys) for (const i of d.cells) el.children[i].classList.add('decoy');
  };
  paint('reveal-foe', state.reveal.foe);
  paint('reveal-own', state.reveal.own);
  show('screen-end');
}

// ------------------------------------------------------------- Eingaben
$('name').value = localStorage.getItem('nebel.name') || '';
if (location.hash.length === 5) $('code').value = location.hash.slice(1).toUpperCase();

$('btn-create').onclick = () => send({ t: 'createLobby', name: nameValue() });
$('btn-bot').onclick = () => send({ t: 'startVsBot', name: nameValue() });
$('btn-join').onclick = () => {
  const code = $('code').value.trim().toUpperCase();
  if (code.length !== 4) return;
  send({ t: 'hello', name: nameValue() });
  send({ t: 'joinLobby', code, name: nameValue() });
};
$('btn-copy').onclick = () => navigator.clipboard.writeText($('join-url').value);
$('btn-to-placement').onclick = startPlacement;
$('btn-random').onclick = () => send({ t: 'randomFleet' });
$('btn-clear').onclick = () => { placeObjects = []; placeSel = 0; renderPlacement(); };
$('btn-ready').onclick = () => {
  send({
    t: 'placeFleet',
    placement: {
      ships: placeObjects.filter((o) => o.kind === 'ship').map((o) => ({ type: o.type, r: o.r, c: o.c, horiz: o.horiz })),
      decoys: placeObjects.filter((o) => o.kind === 'decoy').map((o) => ({ r: o.r, c: o.c, horiz: o.horiz }))
    }
  });
};
$('place-grid').addEventListener('contextmenu', (e) => { e.preventDefault(); placeHoriz = !placeHoriz; });
document.addEventListener('keydown', (e) => { if (e.key === 'r' || e.key === 'R') placeHoriz = !placeHoriz; });

$('btn-fire').onclick = () => { send({ t: 'salvo', shots: [...selected] }); selected.clear(); };
$('btn-scan').onclick = () => { mode = mode === 'scan' ? 'normal' : 'scan'; renderGame(); };
$('btn-dive').onclick = () => send({ t: 'dive' });
$('btn-maneuver').onclick = () => { $('maneuver-panel').classList.toggle('hidden'); };
$('btn-maneuver-cancel').onclick = () => $('maneuver-panel').classList.add('hidden');
for (const b of document.querySelectorAll('#maneuver-panel button[data-move]')) {
  b.onclick = () => {
    send({ t: 'maneuver', shipIndex: Number($('maneuver-ship').value), move: b.dataset.move });
    $('maneuver-panel').classList.add('hidden');
    selected.clear();
  };
}
$('btn-again').onclick = () => location.reload();

myToken = localStorage.getItem('nebel.token');
myCode = localStorage.getItem('nebel.code');
connect();
