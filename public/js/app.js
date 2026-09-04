// Shattle Bips – Client

const N = 10;
const FLEET = [
  { type: 'traeger', label: 'Träger', len: 5 },
  { type: 'schlachtschiff', label: 'Schlachtschiff', len: 4 },
  { type: 'kreuzer', label: 'Kreuzer', len: 3 },
  { type: 'uboot', label: 'U-Boot', len: 3 },
  { type: 'zerstoerer', label: 'Zerstörer', len: 2 }
];

// Ein Zeichen je Schiffstyp (Issue #19). Bewusst geometrisch statt Emoji:
// Emoji werden je Plattform anders breit gerendert und sprengen die Kachel.
const SHIP_SYM = {
  traeger: '⬟',
  schlachtschiff: '⬢',
  kreuzer: '◆',
  uboot: '◉',
  // Variationsselektor U+FE0E erzwingt Textdarstellung. Ohne ihn rendert iOS
  // das Zeichen als schwarzes Emoji-Quadrat, das neben den hellen Formen der
  // anderen Schiffe wie ein Fremdkoerper wirkt.
  zerstoerer: '▪︎',
  decoy: '◌'
};

const $ = (id) => document.getElementById(id);
const ix = (r, c) => r * N + c;
const rc = (i) => [Math.floor(i / N), i % N];
const coord = (i) => { const [r, c] = rc(i); return `${String.fromCharCode(65 + c)}${r + 1}`; };

let ws = null, myToken = null, myCode = null, mySlot = null, isHost = false;
let state = null, opts = null, mode = 'normal', selected = new Set();
let manShip = null, deadline = 0, clockTimer = null;

// ------------------------------------------------------------------- Netz
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    $('conn').textContent = 'verbunden';
    send({ t: 'hello', name: nameValue(), code: myCode, token: myToken });
    setInterval(() => { if (ws.readyState === 1) send({ t: 'ping' }); }, 300_000);
  };
  ws.onclose = () => { $('conn').textContent = 'getrennt – verbinde neu…'; setTimeout(connect, 2000); };
  ws.onmessage = (ev) => handle(JSON.parse(ev.data));
}
const send = (m) => ws && ws.readyState === 1 && ws.send(JSON.stringify(m));

function nameValue() {
  const v = $('name').value.trim();
  if (v) localStorage.setItem('nebel.name', v);
  return v || 'Kapitän';
}

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.remove('active');
  $(id).classList.add('active');
  window.scrollTo(0, 0);
}

/** Wer ist mit diesem Platz gemeint? Aus Sicht des Lesers. (Issue #12) */
function who(slot) {
  if (!state || slot === undefined || slot === null) return 'Jemand';
  return slot === state.you ? 'Du' : (state.opponent?.name ?? 'Der Gegner');
}
const foeName = () => state?.opponent?.name ?? 'Der Gegner';

/**
 * Kurze Meldung in der Bildmitte. Die roten Kacheln allein gehen unter -
 * man schiesst, schaut auf die Knoepfe und bekommt nicht mit, dass gerade
 * ein Schiff gesunken ist.
 *
 * kind: 'sunk' | 'good' | 'bad' | ''
 * Ein zweiter Aufruf ueberschreibt den ersten und startet die Animation neu;
 * eine Warteschlange waere hier falsch, weil die Meldungen einer Salve
 * gleichzeitig entstehen und der Spieler nur das Wichtigste braucht.
 */
let flashTimer = null;
function flash(text, kind = '', sub = '') {
  const el = $('flash');
  if (!el) return;
  el.innerHTML = sub ? `${text}<small>${sub}</small>` : text;
  el.className = `flash ${kind}`;
  // Animation neu ausloesen: ohne den Zwischenschritt laeuft sie nicht erneut,
  // wenn die Klasse schon dranhing.
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove('show'), 1500);
}

function log(html) {
  const li = document.createElement('li');
  li.innerHTML = html;
  $('log').prepend(li);
}

// --------------------------------------------------------- Nachrichten
function handle(m) {
  switch (m.t) {
    case 'welcome':
      if (m.resumed) { mySlot = m.playerId; myCode = m.code; break; }
      // Wer einen Lobby-Link oeffnet, will hinein - nicht den Code vorbefuellt
      // bekommen und dann noch klicken muessen (Issue #15). Schlaegt es fehl,
      // bleibt der Code im Feld stehen und die Fehlermeldung erscheint wie
      // sonst auch; niemand landet in einer Sackgasse.
      if (linkCode && !myCode) {
        send({ t: 'joinLobby', code: linkCode, name: nameValue() });
      }
      break;

    case 'joined':
      myCode = m.code; myToken = m.token; mySlot = m.playerId;
      isHost = m.playerId === 0;
      localStorage.setItem('nebel.token', myToken);
      localStorage.setItem('nebel.code', myCode);
      $('lobby-code').textContent = m.code;
      $('join-url').value = `${location.origin}/#${m.code}`;
      show('screen-lobby');
      break;

    case 'lobby': {
      opts = m.options;
      applyOptionsToForm(opts);
      $('lobby-code').textContent = m.code;
      const ul = $('lobby-players'); ul.innerHTML = '';
      m.players.forEach((p, k) => {
        const li = document.createElement('li');
        li.textContent = p
          ? `${p.name}${p.bot ? ' (Bot)' : ''}${k === mySlot ? ' – du' : ''} — ${p.ready ? 'bereit' : 'stellt auf…'}`
          : 'wartet auf Mitspieler…';
        ul.appendChild(li);
      });
      const canEdit = mySlot === 0;
      $('opt-owner').textContent = canEdit ? '' : '(nur der Host stellt ein)';
      for (const el of document.querySelectorAll('.opts input')) el.disabled = !canEdit;
      $('btn-opts').disabled = !canEdit;
      if (show.pendingPlacement) { show.pendingPlacement = false; startPlacement(); }
      break;
    }

    case 'placementOk':
      $('place-error').textContent = '';
      placementLocked = true;
      $('place-status').textContent = 'Aufstellung übermittelt. Warte auf den Gegner…';
      renderPlacement();
      break;

    case 'placementWithdrawn':
      placementLocked = false;
      $('place-status').textContent = 'Aufstellung wieder freigegeben.';
      renderPlacement();
      break;

    case 'started':
      selected.clear(); mode = 'normal'; manShip = null;
      $('log').innerHTML = '';
      show('screen-game');
      log('<b>Partie gestartet.</b>');
      break;

    case 'rematch':
      closeRematchAsk();
      $('rematch-hint').textContent = '';
      show.pendingPlacement = true;
      show('screen-lobby');
      break;

    case 'state': {
      // Modus und Auswahl gehoeren zu genau einem Zug. Blieb der Scan-Modus
      // ueber den Zugwechsel stehen, loeste der naechste Klick eine Aufklaerung
      // aus, die der Server dann ablehnte (Issue #7).
      const turnChanged = !state || state.turn !== m.turn || state.turnCount !== m.turnCount;

      // Dass der Gegner eines MEINER Schiffe versenkt hat, steht in keiner
      // Nachricht - die Salve geht an ihn, ich bekomme nur "Beschuss auf ...".
      // Der Verlust ist aber das Ereignisreichste, was einem passieren kann,
      // also aus dem Zustand ableiten.
      const sunkBefore = state ? state.own.ships.filter((sh) => sh.sunk).map((sh) => sh.type) : null;
      state = m; opts = m.options;
      if (sunkBefore && m.status === 'playing') {
        const verloren = m.own.ships.filter((sh) => sh.sunk && !sunkBefore.includes(sh.type));
        if (verloren.length) {
          const sym = SHIP_SYM[verloren[0].type] || '';
          flash(`${sym} ${verloren[0].label} verloren`, 'bad',
            `${m.opponent.name} hat getroffen`);
        }
      }
      if (turnChanged) {
        mode = 'normal'; selected.clear(); manShip = null;
        $('maneuver-panel').classList.add('hidden');
        // Wird es dein Zug, gehoert das Gegnerbrett nach vorn - man soll nicht
        // suchen muessen, wo geschossen wird.
        if (m.turn === m.you && m.status === 'playing') showPane('pane-foe');
      }
      renderGame();
      break;
    }

    case 'salvoResult': {
      for (const r of m.results) {
        if (r.result === 'water') log(`<i>Du</i> → ${coord(r.cell)}: Wasser.`);
        else if (r.result === 'hit') log(`<i>Du</i> → ${coord(r.cell)}: <b>Treffer.</b>`);
        else log(`<i>Du</i> → ${coord(r.cell)}: <b>${r.shipLabel} versenkt!</b>`);
      }
      // Nur das Wichtigste einer Salve zeigen, nicht vier Meldungen nacheinander.
      const sunk = m.results.filter((r) => r.result === 'sunk');
      const hits = m.results.filter((r) => r.result === 'hit').length;
      if (sunk.length) {
        const sym = SHIP_SYM[sunk[0].shipType] || '';
        flash(sunk.length > 1 ? `${sunk.length} Schiffe versenkt!` : `${sym} ${sunk[0].shipLabel} versenkt!`,
          'sunk', sunk.length === 1 ? coord(sunk[0].cell) : '');
      } else if (hits) {
        flash(hits > 1 ? `${hits} Treffer!` : 'Treffer!', 'good');
      }
      break;
    }

    case 'scanResult':
      log(`<i>Du</i> → Aufklärung um <b>${coord(m.center)}</b>: <b>${m.count}</b> belegte Felder im 3×3-Feld.`);
      flash(m.count === 0 ? 'Nichts geortet' : `${m.count} Felder belegt`,
        m.count ? 'good' : '', `Aufklärung um ${coord(m.center)}`);
      break;

    case 'notice':
      // Jede Zeile nennt jetzt den Urheber – vorher stand da nur die Tatsache
      // und man wusste nicht, wen sie betrifft (Issue #12).
      if (m.kind === 'maneuvered') {
        log(`<i>${foeName()}</i> → <b>Flotte manövriert.</b>`);
        flash('Flotte manövriert', '', `${foeName()} hat ein Schiff versetzt`);
      }
      if (m.kind === 'evaded') {
        log(`<i>${foeName()}</i> → <b>U-Boot ausgewichen.</b> Deine Wasser-Meldungen dieser Salve sind zurückgesetzt.`);
        flash('U-Boot ausgewichen', 'bad', 'Deine Wasser-Meldungen dieser Salve gelten nicht mehr');
      }
      if (m.kind === 'incoming') log(`<i>${foeName()}</i> → Beschuss auf ${m.cells.map(coord).join(', ')}.`);
      if (m.kind === 'timeout') log(`<i>${who(m.slot)}</i> → Zug verfallen, Zeit abgelaufen.`);
      if (m.kind === 'rematchDeclined') { closeRematchAsk(); $('rematch-hint').textContent = `${m.by} hat die Revanche abgelehnt.`; }
      if (m.kind === 'rematchOff') { closeRematchAsk(); $('rematch-hint').textContent = `${m.by} hat die Partie verlassen.`; }
      if (m.kind === 'rematchWanted') openRematchAsk(m.by);
      if (m.kind === 'optionsChanged') {
        // Der Host hat die Regeln geaendert – der Server hat beide Aufstellungen
        // verworfen. Ohne diesen Zweig legte man unter alten Regeln fertig und
        // wartete danach auf einen Start, der nie kam.
        if (document.querySelector('.screen.active')?.id === 'screen-placement') {
          startPlacement();
          $('place-error').textContent = 'Der Host hat die Regeln geändert. Bitte neu aufstellen.';
        } else {
          show.pendingPlacement = false;
        }
      }
      if (m.kind === 'placementDropped') {
        $('place-error').textContent = `${m.who} muss neu aufstellen – die Regeln haben sich geändert.`;
      }
      break;

    case 'randomFleet': loadPlacement(m.placement); break;

    case 'error':
      $('game-error').textContent = m.msg;
      $('place-error').textContent = m.msg;
      // Auf dem Endbildschirm gibt es kein game-error-Feld – ohne diese Zeile
      // blieb "Revanche angefragt…" stehen und der Fehler war unsichtbar.
      $('rematch-hint').textContent = m.msg;
      setTimeout(() => { $('game-error').textContent = ''; }, 4000);
      break;
  }
}

// ------------------------------------------------------ Einstellungen
function applyOptionsToForm(o) {
  if (!o) return;
  $('o-min').value = o.minSalvo; $('o-max').value = o.maxSalvo;
  $('o-decoys').value = o.decoyCount; $('o-decoylen').value = o.decoyLen;
  $('o-time').value = o.turnSeconds;
  $('o-opening').checked = o.openingBalance;
  $('o-single').checked = o.singleShotAfterHit;
  $('o-scan').checked = o.scanEnabled;
  $('o-dive').checked = o.diveEnabled;
  $('o-man').checked = o.maneuverEnabled;
  $('o-pool').checked = o.salvoPool;
  $('o-poolsize').value = o.salvoPoolSize;
  $('o-botmin').value = o.botMinSeconds;
  $('o-botmax').value = o.botMaxSeconds;
}

// Der Vorrat verlaengert die Partie deutlich (Simulation: 39 -> 59 Zuege).
// Beim Einschalten deshalb die Zugzeit auf 20 s vorschlagen - danach frei.
$('o-pool').addEventListener('change', () => {
  if ($('o-pool').checked && +$('o-time').value > 20) $('o-time').value = 20;
});

$('btn-opts').onclick = () => send({
  t: 'setOptions',
  options: {
    minSalvo: +$('o-min').value, maxSalvo: +$('o-max').value,
    decoyCount: +$('o-decoys').value, decoyLen: +$('o-decoylen').value,
    turnSeconds: +$('o-time').value,
    openingBalance: $('o-opening').checked, singleShotAfterHit: $('o-single').checked,
    scanEnabled: $('o-scan').checked, diveEnabled: $('o-dive').checked,
    maneuverEnabled: $('o-man').checked,
    salvoPool: $('o-pool').checked, salvoPoolSize: +$('o-poolsize').value,
    botMinSeconds: +$('o-botmin').value, botMaxSeconds: +$('o-botmax').value
  }
});

// -------------------------------------------------------- Aufstellung
let placeObjects = [], placeSel = 0, placeHoriz = true;
let placementLocked = false;   // true, sobald der Server die Aufstellung hat

function placeQueue() {
  const q = FLEET.map((f) => ({ ...f, kind: 'ship' }));
  const n = opts ? opts.decoyCount : 2;
  const len = opts ? opts.decoyLen : 2;
  for (let i = 0; i < n; i++) q.push({ kind: 'decoy', type: 'decoy', label: `Köder ${i + 1}`, len });
  return q;
}

function startPlacement() {
  placeObjects = []; placeSel = 0; placeHoriz = true; placementLocked = false;
  // Nicht place-hint: dort steckt <b id="orient"> drin, und textContent = ''
  // haette es aus dem DOM geloescht – renderPlacement() greift zwei Zeilen
  // spaeter darauf zu und warf danach bei jedem Klick auf "Flotte aufstellen".
  $('place-status').textContent = '';
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

function blockedSet() {
  const s = new Set();
  for (const o of placeObjects) {
    for (const i of o.cells) {
      const [r, c] = rc(i);
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < N && cc >= 0 && cc < N) s.add(ix(rr, cc));
      }
    }
  }
  return s;
}

function onPlaceHover(i) {
  if (placementLocked) return;
  const q = placeQueue();
  if (placeSel >= q.length) return;
  for (const el of $('place-grid').children) el.classList.remove('preview', 'bad');
  const [r, c] = rc(i);
  const cells = cellsFor(r, c, q[placeSel].len, placeHoriz);
  if (!cells) return;
  const blocked = blockedSet();
  const ok = !cells.some((x) => blocked.has(x));
  for (const x of cells) $('place-grid').children[x].classList.add(ok ? 'preview' : 'bad');
}

function onPlaceClick(i) {
  if (placementLocked) return;
  const q = placeQueue();
  if (placeSel >= q.length) return;
  const spec = q[placeSel];
  const [r, c] = rc(i);
  const cells = cellsFor(r, c, spec.len, placeHoriz);
  if (!cells) { $('place-error').textContent = 'Passt dort nicht ins Raster.'; return; }
  if (cells.some((x) => blockedSet().has(x))) { $('place-error').textContent = 'Kein Platz – ein Feld Abstand ist Pflicht.'; return; }
  $('place-error').textContent = '';
  placeObjects.push({ ...spec, r, c, horiz: placeHoriz, cells });
  placeSel = placeObjects.length;
  renderPlacement();
}

function renderPlacement() {
  const grid = $('place-grid');
  for (const el of grid.children) el.className = 'cell';
  for (const o of placeObjects) for (const i of o.cells) grid.children[i].classList.add(o.kind === 'decoy' ? 'decoy' : 'ship');

  const q = placeQueue();
  const ul = $('ship-list'); ul.innerHTML = '';
  q.forEach((spec, k) => {
    const li = document.createElement('li');
    li.textContent = `${spec.label} (${spec.len})`;
    if (k < placeObjects.length) li.classList.add('done');
    if (k === placeSel) li.classList.add('active');
    li.onclick = () => { if (!placementLocked && k <= placeObjects.length) { placeObjects = placeObjects.slice(0, k); placeSel = k; renderPlacement(); } };
    ul.appendChild(li);
  });
  $('orient').textContent = placeHoriz ? 'waagerecht' : 'senkrecht';

  // Solange die Aufstellung beim Server liegt, darf sie hier nicht mehr
  // veraendert werden. Vorher blieben "Zufaellig" und "Leeren" bedienbar und
  // renderPlacement() hat den Bereit-Knopf gleich wieder freigeschaltet -
  // der Client zeigte danach eine andere Flotte als der Server hatte.
  $('btn-ready').disabled = placementLocked || placeObjects.length !== q.length;
  $('btn-random').disabled = placementLocked;
  $('btn-clear').disabled = placementLocked;
  $('btn-withdraw').classList.toggle('hidden', !placementLocked);
  $('place-grid').classList.toggle('locked', placementLocked);
}

function loadPlacement(p) {
  placeObjects = [];
  const q = placeQueue();
  for (const s of p.ships) {
    const spec = FLEET.find((f) => f.type === s.type);
    placeObjects.push({ ...spec, kind: 'ship', r: s.r, c: s.c, horiz: s.horiz, cells: cellsFor(s.r, s.c, spec.len, s.horiz) });
  }
  placeObjects.sort((a, b) => q.findIndex((x) => x.type === a.type) - q.findIndex((x) => x.type === b.type));
  p.decoys.forEach((d, k) => {
    const len = opts ? opts.decoyLen : 2;
    placeObjects.push({ kind: 'decoy', type: 'decoy', label: `Köder ${k + 1}`, len, r: d.r, c: d.c, horiz: d.horiz, cells: cellsFor(d.r, d.c, len, d.horiz) });
  });
  placeSel = placeObjects.length;
  renderPlacement();
}

// --------------------------------------------------------------- Partie
/**
 * Legt A–J und 1–10 als Streifen um ein Raster (Issue #16).
 *
 * Bewusst als Geschwister in einem Rahmen und nicht als zusaetzliche Zellen:
 * der ganze Client adressiert Felder ueber grid.children[i], das muss
 * unveraendert Feld i bleiben. Idempotent – buildGrid laeuft mehrfach.
 */
function ensureFrame(el) {
  if (el.parentElement?.classList.contains('board-frame')) return;

  const frame = document.createElement('div');
  frame.className = 'board-frame';
  el.parentElement.insertBefore(frame, el);

  const corner = document.createElement('div');
  corner.className = 'axis-corner';

  const top = document.createElement('div');
  top.className = 'axis axis-top';
  for (let c = 0; c < N; c++) {
    const s = document.createElement('span');
    s.textContent = String.fromCharCode(65 + c);
    top.appendChild(s);
  }

  const left = document.createElement('div');
  left.className = 'axis axis-left';
  for (let r = 0; r < N; r++) {
    const s = document.createElement('span');
    s.textContent = String(r + 1);
    left.appendChild(s);
  }

  frame.append(corner, top, left, el);
}

function buildGrid(el, onClick, onHover) {
  ensureFrame(el);
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
  if (!foe.children.length) { buildGrid(foe, onFoeClick, onFoeHover); buildGrid($('own-grid'), onOwnClick, null); }

  // Gegnerbrett inkl. Scan-Historie
  // Versenkte Schiffe heben sich von blossen Treffern ab - vorher sah beides
  // gleich aus und man wusste nicht, was man schon erledigt hat (Issue #18).
  const sunkSet = new Set(state.sunkCells || []);
  for (let i = 0; i < N * N; i++) {
    const el = foe.children[i];
    el.className = 'cell'; el.textContent = '';
    const v = state.tracking[i];
    if (v === 1) el.classList.add('miss');
    if (v === 2) el.classList.add(sunkSet.has(i) ? 'sunk' : 'hit');
    if (selected.has(i)) el.classList.add('sel');
  }
  for (const s of state.scans || []) {
    const [r, c] = rc(s.center);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      foe.children[ix(r + dr, c + dc)].classList.add('scanned');
    }
    const ctr = foe.children[s.center];
    ctr.classList.add('scancenter');
    ctr.textContent = s.count;
  }

  // eigenes Brett
  const own = $('own-grid');
  for (let i = 0; i < N * N; i++) { own.children[i].className = 'cell'; own.children[i].textContent = ''; }
  state.own.ships.forEach((s) => {
    for (const i of s.cells) {
      const el = own.children[i];
      el.classList.add(s.sunk ? 'sunk' : (s.hits.includes(i) ? 'hit' : 'ship'));
      if (manShip === s.index) el.classList.add('manship');
    }
    // Typsymbol auf das erste Feld – aber nicht dorthin, wo schon ein Treffer
    // sein Kreuz zeichnet, sonst liegen zwei Zeichen uebereinander (#19).
    const head = s.cells[0];
    if (!s.sunk && !s.hits.includes(head)) {
      own.children[head].textContent = SHIP_SYM[s.type] || '';
      own.children[head].classList.add('sym');
    }
  });
  for (const d of state.own.decoys) {
    d.cells.forEach((i, k) => {
      own.children[i].classList.add(d.hits.includes(i) ? 'hit' : 'decoy');
      if (k === 0 && !d.hits.includes(i)) {
        own.children[i].textContent = SHIP_SYM.decoy;
        own.children[i].classList.add('sym');
      }
    });
  }
  for (const i of state.own.incoming) {
    const el = own.children[i];
    if (!el.classList.contains('hit') && !el.classList.contains('sunk')) el.classList.add('miss');
  }
  if (mode === 'maneuver' && manShip !== null) previewManeuver();

  $('foe-name').textContent = state.opponent.name;
  $('foe-ships').textContent = `${state.opponent.shipsLeft} Schiffe`;
  // Eigene Restflotte genauso zeigen wie die gegnerische - man soll nicht
  // die Uebersicht durchzaehlen muessen, um zu wissen, wie man dasteht.
  $('own-ships').textContent = `${state.own.ships.filter((s) => !s.sunk).length} Schiffe`;
  const mine = state.turn === state.you;
  // In #turn-banner darf kein textContent geschrieben werden: er enthaelt
  // #turn-text, #salvo-count, #clock und #mode-pill. Ein Schreibzugriff auf den
  // Container wuerde alle vier aus dem DOM loeschen (siehe docs/LEARNINGS.md).
  $('turn-text').textContent = mine ? 'Du bist am Zug.' : `${state.opponent.name} ist am Zug…`;
  $('turn-banner').classList.toggle('you', mine);
  $('salvo-count').textContent = mine ? salvoLabel() : '';
  $('mode-pill').textContent = mode === 'scan' ? 'Scan-Ziel wählen' : (mode === 'maneuver' ? 'Manövermodus' : (state.diving ? 'U-Boot getaucht' : ''));
  deadline = state.deadline;

  // Ohne Vorrat gilt "genau N". Mit Vorrat ist die Anzahl die Entscheidung:
  // alles von 1 bis zum Maximum geht, mehr als einer kostet eine Salve.
  const enough = state.salvoPool
    ? (selected.size >= 1 && selected.size <= state.shots)
    : selected.size === state.shots;
  $('btn-fire').disabled = !mine || mode !== 'normal' || !enough;
  $('btn-fire').textContent = state.salvoPool && selected.size > 1 ? 'Salve feuern' : 'Feuern';
  $('btn-scan').disabled = !mine || !state.canScan || mode === 'maneuver';
  $('btn-scan').title = state.canScan ? 'Ein Schuss der Salve wird zum 3×3-Scan' : (state.scanBlocked || '');
  $('scan-hint').textContent = mine && !state.canScan && state.scanBlocked ? state.scanBlocked : '';
  $('btn-dive').disabled = !mine || !state.canDive;
  $('btn-maneuver').disabled = !mine || !(opts?.maneuverEnabled ?? true);
  $('btn-scan').textContent = mode === 'scan' ? 'Scan abbrechen' : 'Aufklären';

  renderFleetLegend();

  const box = $('maneuver-ships'); box.innerHTML = '';
  for (const s of state.own.ships) {
    if (s.hits.length || s.sunk) continue;
    const b = document.createElement('button');
    b.textContent = `${s.label} (${s.len})`;
    if (manShip === s.index) b.classList.add('sel');
    b.onclick = () => { manShip = s.index; renderGame(); };
    box.appendChild(b);
  }
  if (!clockTimer) clockTimer = setInterval(tickClock, 500);
}

/**
 * Was steht dem Gegner noch, und wie steht meine Flotte da (Issues #20, #21).
 * Der Server liefert dafuer schon alles: sunkEnemy sind die versenkten
 * Gegnertypen, own.ships den eigenen Zustand.
 */
/** Was in der Zugzeile steht: gewaehlt/Maximum, bei Vorrat plus Restbestand. */
function salvoLabel() {
  const base = `${selected.size}/${state.shots}`;
  if (!state.salvoPool) return base;
  return `${base} · Vorrat ${state.salvosLeft}`;
}

function renderFleetLegend() {
  const row = (sym, label, len, cls, note) => {
    const li = document.createElement('li');
    if (cls) li.className = cls;
    li.innerHTML = `<span class="sym">${sym}</span>`
      + `<span class="name">${label}</span>`
      + `<span class="len">${note || len}</span>`;
    return li;
  };

  const foe = $('fleet-foe'); foe.innerHTML = '';
  const sunk = state.sunkEnemy || [];
  for (const f of FLEET) {
    const gone = sunk.includes(f.type);
    foe.appendChild(row(SHIP_SYM[f.type], f.label, f.len, gone ? 'gone' : '', gone ? 'versenkt' : `${f.len} Felder`));
  }

  const own = $('fleet-own'); own.innerHTML = '';
  for (const s of state.own.ships) {
    const cls = s.sunk ? 'gone' : (s.hits.length ? 'hurt' : '');
    const note = s.sunk ? 'versenkt' : (s.hits.length ? `${s.hits.length}/${s.len} getroffen` : `${s.len} Felder`);
    own.appendChild(row(SHIP_SYM[s.type], s.label, s.len, cls, note));
  }
}

function tickClock() {
  if (!deadline || !state || state.status !== 'playing') return;
  $('clock').textContent = `${Math.max(0, Math.round((deadline - Date.now()) / 1000))} s`;
}

function previewManeuver() {
  const s = state.own.ships.find((x) => x.index === manShip);
  if (!s) return;
  const own = $('own-grid');
  for (const i of s.cells) own.children[i].classList.add('manship');
}

function onOwnClick(i) {
  if (mode !== 'maneuver') return;
  const s = state.own.ships.find((x) => x.cells.includes(i) && !x.hits.length && !x.sunk);
  if (s) { manShip = s.index; renderGame(); }
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
    if (r < 1 || r > N - 2 || c < 1 || c > N - 2) { $('game-error').textContent = 'Der Scan-Mittelpunkt braucht rundum ein Feld Platz.'; return; }
    send({ t: 'scan', center: i });
    mode = 'normal';
    for (const el of $('foe-grid').children) el.classList.remove('scanzone');
    return;
  }
  if (mode === 'maneuver') return;
  if (state.tracking[i] !== 0) return;
  if (selected.has(i)) selected.delete(i);
  else if (selected.size < state.shots) selected.add(i);
  renderGame();
}

function renderEnd() {
  const won = state.winner === state.you;
  $('end-title').textContent = won ? 'Gewonnen.' : 'Verloren.';
  // Ohne Grund wirkte ein Sieg durch Zeitablauf wie ein Fehler: die Partie war
  // vorbei, ohne dass ein Schiff versenkt wurde (Issue #8).
  const reason = state.endReason === 'timeout'
    ? (won
        ? 'Der Gegner hat zwei Züge in Folge verstreichen lassen – das gilt als Aufgabe.'
        : 'Du hast zwei Züge in Folge verstreichen lassen – das gilt als Aufgabe.')
    : 'Alle fünf Schiffe versenkt.';
  $('end-detail').textContent = `${reason} Partie nach ${state.turnCount} Zügen beendet.`;
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
const linkCode = location.hash.length === 5 ? location.hash.slice(1).toUpperCase() : null;
if (linkCode) $('code').value = linkCode;

$('btn-create').onclick = () => send({ t: 'createLobby', name: nameValue() });
$('btn-bot').onclick = () => send({ t: 'startVsBot', name: nameValue() });
$('btn-join').onclick = () => {
  const code = $('code').value.trim().toUpperCase();
  if (code.length !== 4) return;
  send({ t: 'hello', name: nameValue() });
  send({ t: 'joinLobby', code, name: nameValue() });
};
$('btn-copy').onclick = () => navigator.clipboard?.writeText($('join-url').value);
$('btn-to-placement').onclick = startPlacement;
$('btn-random').onclick = () => { if (!placementLocked) send({ t: 'randomFleet' }); };
$('btn-clear').onclick = () => { if (!placementLocked) { placeObjects = []; placeSel = 0; renderPlacement(); } };
$('btn-withdraw').onclick = () => send({ t: 'withdrawPlacement' });
$('btn-rotate').onclick = () => { placeHoriz = !placeHoriz; renderPlacement(); };
$('btn-ready').onclick = () => send({
  t: 'placeFleet',
  placement: {
    ships: placeObjects.filter((o) => o.kind === 'ship').map((o) => ({ type: o.type, r: o.r, c: o.c, horiz: o.horiz })),
    decoys: placeObjects.filter((o) => o.kind === 'decoy').map((o) => ({ r: o.r, c: o.c, horiz: o.horiz }))
  }
});
$('place-grid').addEventListener('contextmenu', (e) => { e.preventDefault(); placeHoriz = !placeHoriz; renderPlacement(); });
document.addEventListener('keydown', (e) => { if (e.key === 'r' || e.key === 'R') { placeHoriz = !placeHoriz; renderPlacement(); } });

$('btn-fire').onclick = () => { send({ t: 'salvo', shots: [...selected] }); selected.clear(); };
$('btn-scan').onclick = () => { mode = mode === 'scan' ? 'normal' : 'scan'; renderGame(); };
$('btn-dive').onclick = () => send({ t: 'dive' });
$('btn-maneuver').onclick = () => {
  mode = mode === 'maneuver' ? 'normal' : 'maneuver';
  $('maneuver-panel').classList.toggle('hidden', mode !== 'maneuver');
  if (mode === 'maneuver' && manShip === null) {
    const first = state.own.ships.find((s) => !s.hits.length && !s.sunk);
    if (first) manShip = first.index;
  }
  renderGame();
};
$('btn-maneuver-cancel').onclick = () => { mode = 'normal'; manShip = null; $('maneuver-panel').classList.add('hidden'); renderGame(); };
for (const b of document.querySelectorAll('#maneuver-panel button[data-move]')) {
  b.onclick = () => {
    if (manShip === null) { $('game-error').textContent = 'Erst ein Schiff wählen.'; return; }
    send({ t: 'maneuver', shipIndex: manShip, move: b.dataset.move });
    mode = 'normal'; manShip = null;
    $('maneuver-panel').classList.add('hidden');
    selected.clear();
  };
}

// Die Anfrage stand vorher nur als kleine Zeile unter den Knoepfen und wurde
// leicht uebersehen. Jetzt ein Dialog, der eine Entscheidung verlangt (#13).
const rematchDialog = $('rematch-dialog');
function openRematchAsk(byName) {
  $('rematch-who').textContent = `${byName} fordert eine Revanche.`;
  if (!rematchDialog.open) rematchDialog.showModal();
}
function closeRematchAsk() { if (rematchDialog.open) rematchDialog.close(); }

$('rematch-accept').onclick = () => { closeRematchAsk(); $('rematch-hint').textContent = 'Revanche angenommen…'; send({ t: 'rematch' }); };
$('rematch-decline').onclick = () => { closeRematchAsk(); $('rematch-hint').textContent = 'Revanche abgelehnt.'; send({ t: 'rematchDecline' }); };

$('btn-rematch').onclick = () => { $('rematch-hint').textContent = 'Revanche angefragt – warte auf den Gegner…'; send({ t: 'rematch' }); };
$('btn-lobby').onclick = () => { show.pendingPlacement = false; show('screen-lobby'); };
$('btn-quit').onclick = () => { localStorage.removeItem('nebel.token'); localStorage.removeItem('nebel.code'); location.href = location.origin; };

// ------------------------------------------------------------- Programmstand
// Steht dauerhaft im Kopf, damit Feedback einem Stand zuzuordnen ist.
fetch('/version')
  .then((r) => (r.ok ? r.json() : null))
  .then((v) => {
    if (!v) throw new Error('keine Antwort');
    $('version').textContent = v.label;
    $('version').title = v.commit ? `Programmstand ${v.label} · Commit ${v.commit}` : `Programmstand ${v.label}`;
  })
  .catch(() => { $('version').textContent = ''; });

// ----------------------------------------------------------------- Feedback
const fbDialog = $('feedback-dialog');
const fbText = $('feedback-text');
const fbMsg = $('feedback-msg');

const currentScreen = () => (document.querySelector('.screen.active') || {}).id || null;

function fbSetMsg(text, kind) {
  fbMsg.textContent = text;
  fbMsg.className = `hint${kind ? ` msg-${kind}` : ''}`;
}

$('btn-feedback').onclick = () => {
  fbSetMsg('');
  $('feedback-send').disabled = false;
  fbDialog.showModal();
  fbText.focus();
};
$('feedback-cancel').onclick = () => fbDialog.close();
fbText.addEventListener('input', () => { $('feedback-count').textContent = fbText.value.length; });

$('feedback-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();                       // Dialog offen halten für die Rückmeldung
  const text = fbText.value.trim();
  if (text.length < 3) return fbSetMsg('Bitte ein paar Worte mehr.', 'err');

  $('feedback-send').disabled = true;
  fbSetMsg('wird gesendet…');
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        screen: currentScreen(),
        code: myCode || null,
        options: opts ? JSON.stringify(opts) : null
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      fbSetMsg(data.error || 'Konnte gerade nicht abgeschickt werden.', 'err');
      $('feedback-send').disabled = false;
      return;
    }
    fbSetMsg(`Danke! Angekommen${data.ref ? ` als ${data.ref}` : ''}.`, 'ok');
    fbText.value = '';
    $('feedback-count').textContent = '0';
    setTimeout(() => fbDialog.close(), 1400);
  } catch {
    fbSetMsg('Keine Verbindung. Später noch einmal versuchen.', 'err');
    $('feedback-send').disabled = false;
  }
});

// ------------------------------------------------------------- Umschalter
// Hochkant ist die Spielansicht fest: es scrollt nichts, und ein Bereich ist
// sichtbar. Quer blendet das CSS den Umschalter aus und zeigt alles.
function showPane(id) {
  for (const p of document.querySelectorAll('.game-pane')) p.classList.toggle('active', p.id === id);
  for (const t of document.querySelectorAll('.game-tabs .tab')) t.classList.toggle('active', t.dataset.pane === id);
}
for (const t of document.querySelectorAll('.game-tabs .tab')) {
  t.onclick = () => showPane(t.dataset.pane);
}

// -------------------------------------------------- Hoehe der Kopfzeile
// Die Spielansicht ist hochkant genau so hoch wie der Schirm minus Kopfzeile.
// Deren Hoehe haengt an der Schriftgroesse und daran, ob der Programmstand
// umbricht - fest verdrahtet waere sie irgendwann falsch, und dann ragt die
// Ansicht unten heraus. Faellt die Messung aus, traegt der Wert im calc().
(function trackHeaderHeight() {
  const head = document.querySelector('header');
  if (!head || typeof ResizeObserver !== 'function') return;
  const apply = () => document.documentElement.style.setProperty('--header-h', `${head.offsetHeight}px`);
  new ResizeObserver(apply).observe(head);
  apply();
})();

myToken = localStorage.getItem('nebel.token');
myCode = localStorage.getItem('nebel.code');
connect();
