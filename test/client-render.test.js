// Shattle Bips – der Client wird wirklich ausgefuehrt.
//
// Warum das noetig ist: dreimal in Folge hat eine Aenderung am Rendering den
// Bildschirm zerstoert (Issues #9/#10, #17), und jedes Mal war der Fehler
// statisch nicht sichtbar. app.js hat keine Exporte, laesst sich also nicht
// direkt aufrufen – aber es haengt seine Handler an echte Elemente und setzt
// ws.onmessage. Genau darueber wird es hier angetrieben: ein Zustand kommt
// per WebSocket herein, und das Rendering muss ihn ohne Ausnahme verarbeiten.
//
// Das DOM ist selbst geschrieben, ohne Abhaengigkeit, und modelliert
// absichtlich die Falle aus #10: textContent auf einen Knoten loescht seine
// Kinder samt deren IDs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

// ------------------------------------------------------------------- Mini-DOM
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img',
  'input', 'link', 'meta', 'source', 'track', 'wbr']);

function makeDoc() {
  const byId = new Map();

  class El {
    constructor(tag) {
      this.tagName = (tag || 'div').toUpperCase();
      this._id = null;
      this.children = [];
      this.parentElement = null;
      // Ein echtes dataset speichert ausschliesslich Strings. Ohne diese
      // Umwandlung testet man gegen ein DOM, das es so nicht gibt.
      this.dataset = new Proxy({}, {
        set(t, k, v) { t[k] = String(v); return true; }
      });
      this.style = {};
      this._classes = new Set();
      this._text = '';
      this.value = '';
      this.disabled = false;
      this.checked = false;
      this.title = '';
      this.open = false;
      this._ev = {};
      const self = this;
      this.classList = {
        add: (...c) => c.forEach((x) => self._classes.add(x)),
        remove: (...c) => c.forEach((x) => self._classes.delete(x)),
        contains: (c) => self._classes.has(c),
        toggle: (c, force) => {
          const on = force === undefined ? !self._classes.has(c) : !!force;
          if (on) self._classes.add(c); else self._classes.delete(c);
          return on;
        }
      };
    }
    get id() { return this._id; }
    set id(v) { this._id = v; if (v) byId.set(v, this); }
    get className() { return [...this._classes].join(' '); }
    set className(v) {
      this._classes = new Set(String(v).split(/\s+/).filter(Boolean));
    }
    /** Kernpunkt: Text setzen entfernt alle Kinder – und ihre IDs. */
    get textContent() { return this._text; }
    set textContent(v) {
      for (const c of this.children) c._unregister();
      this.children = [];
      this._text = String(v);
    }
    set innerHTML(v) {
      for (const c of this.children) c._unregister();
      this.children = [];
      this._text = String(v).replace(/<[^>]*>/g, '');
    }
    get innerHTML() { return this._text; }
    _unregister() {
      for (const c of this.children) c._unregister();
      if (this._id && byId.get(this._id) === this) byId.delete(this._id);
    }
    appendChild(c) { c.parentElement = this; this.children.push(c); if (c._id) byId.set(c._id, c); return c; }
    append(...cs) { cs.forEach((c) => this.appendChild(c)); }
    prepend(c) { c.parentElement = this; this.children.unshift(c); if (c._id) byId.set(c._id, c); }
    insertBefore(node, ref) {
      node.parentElement = this;
      const k = this.children.indexOf(ref);
      this.children.splice(k < 0 ? this.children.length : k, 0, node);
      if (node._id) byId.set(node._id, node);
      return node;
    }
    setAttribute(k, v) { if (k === 'id') this.id = v; }
    getAttribute() { return null; }
    focus() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
    addEventListener(ev, fn) { this._ev[ev] = fn; }
    querySelectorAll(sel) { return all(this).filter((e) => matches(e, sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  }

  const all = (root) => root.children.flatMap((c) => [c, ...all(c)]);
  const matches = (el, sel) => {
    if (sel.startsWith('.')) return el._classes.has(sel.slice(1));
    if (sel.startsWith('#')) return el._id === sel.slice(1);
    return el.tagName === sel.toUpperCase();
  };

  const root = new El('body');
  const doc = {
    getElementById: (id) => byId.get(id) || null,
    createElement: (t) => new El(t),
    querySelectorAll: (s) => root.querySelectorAll(s),
    querySelector: (s) => root.querySelector(s),
    addEventListener() {},
    body: root
  };

  // ---- Markup einlesen: Tags und Verschachtelung, Text interessiert nicht.
  const stack = [root];
  const tag = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  for (let m; (m = tag.exec(HTML));) {
    const [, closing, name, attrs] = m;
    const low = name.toLowerCase();
    if (low === 'script' || low === 'html' || low === 'head' || low === 'body') continue;
    if (closing) { if (stack.length > 1) stack.pop(); continue; }

    const el = new El(low);
    const id = (attrs.match(/\bid="([^"]+)"/) || [])[1];
    const cls = (attrs.match(/\bclass="([^"]+)"/) || [])[1];
    if (cls) el.className = cls;
    if (id) el.id = id;
    for (const d of attrs.matchAll(/\bdata-([\w-]+)="([^"]*)"/g)) el.dataset[d[1]] = d[2];
    stack[stack.length - 1].appendChild(el);
    if (!VOID.has(low) && !/\/\s*$/.test(attrs)) stack.push(el);
  }
  return { doc, byId };
}

// ------------------------------------------------------------------ Harness
// renderGame() startet einen 500-ms-Takt fuer die Zuguhr. Der haelt den
// Testprozess am Leben, bis er abgeschossen wird - dieselbe Falle wie die
// offenen Zug-Timer serverseitig. Deshalb werden alle Timer eingesammelt.
const timers = [];
const realSetInterval = globalThis.setInterval;
const realSetTimeout = globalThis.setTimeout;
test.afterEach(() => {
  while (timers.length) clearInterval(timers.pop());
});

async function bootClient() {
  const { doc, byId } = makeDoc();
  const sockets = [];

  globalThis.setInterval = (fn, ms) => { const h = realSetInterval(fn, ms); timers.push(h); return h; };
  globalThis.setTimeout = (fn, ms) => { const h = realSetTimeout(fn, ms); timers.push(h); return h; };

  globalThis.document = doc;
  globalThis.window = { scrollTo() {}, addEventListener() {} };
  globalThis.location = { protocol: 'https:', host: 'x', origin: 'https://x', hash: '' };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ label: 'v0.0.0-test', commit: 'abc1234' }) });
  globalThis.WebSocket = class {
    constructor() { this.readyState = 1; sockets.push(this); }
    send() {}
    close() {}
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: () => Promise.resolve() } }, configurable: true
  });

  // Cache-Buster: jeder Testlauf braucht ein frisches Modul.
  await import(`file:///${path.join(ROOT, 'public/js/app.js').replace(/\\/g, '/')}?t=${Date.now()}`);
  await new Promise((r) => setImmediate(r));   // fetch('/version') abarbeiten

  const ws = sockets[0];
  assert.ok(ws && typeof ws.onmessage === 'function', 'Client hat eine Verbindung geoeffnet');
  return { doc, byId, feed: (msg) => ws.onmessage({ data: JSON.stringify(msg) }) };
}

const FLEET = [
  { type: 'traeger', label: 'Träger', len: 5 },
  { type: 'schlachtschiff', label: 'Schlachtschiff', len: 4 },
  { type: 'kreuzer', label: 'Kreuzer', len: 3 },
  { type: 'uboot', label: 'U-Boot', len: 3 },
  { type: 'zerstoerer', label: 'Zerstörer', len: 2 }
];

/** Ein plausibler Spielzustand, wie pushState() ihn schickt. */
function stateMsg(over = {}) {
  let cell = 0;
  const ships = FLEET.map((f, idx) => {
    const cells = [];
    for (let k = 0; k < f.len; k++) cells.push(cell++ + idx * 10);
    return { index: idx, type: f.type, label: f.label, len: f.len, horiz: true, cells, hits: [], sunk: false };
  });
  return {
    t: 'state', status: 'playing', you: 0, turn: 0, turnCount: 3,
    deadline: Date.now() + 60000, bank: 0,
    own: { ships, decoys: [{ cells: [95, 96], hits: [], horiz: true }], incoming: [40, 41] },
    tracking: new Array(100).fill(0),
    scans: [{ center: 55, count: 2, turn: 1 }],
    options: { minSalvo: 2, maxSalvo: 4, decoyCount: 1, decoyLen: 2, turnSeconds: 60,
      openingBalance: true, singleShotAfterHit: false,
      scanEnabled: true, diveEnabled: true, maneuverEnabled: true },
    sunkEnemy: ['zerstoerer'],
    shots: 4, baseSalvo: 4, canScan: true, canDive: true, scanBlocked: null,
    diving: false, endReason: null,
    opponent: { name: 'Michi', shipsLeft: 4, connected: true },
    winner: null, reveal: null,
    ...over
  };
}

// -------------------------------------------------------------------- Tests
test('Zustand rendern wirft nicht und fuellt das Raster', async () => {
  const { byId, feed } = await bootClient();
  assert.doesNotThrow(() => feed(stateMsg()));

  assert.equal(byId.get('foe-grid').children.length, 100, 'Gegnerraster hat 100 Felder');
  assert.equal(byId.get('own-grid').children.length, 100, 'eigenes Raster hat 100 Felder');
});

test('Rasterbeschriftung A–J und 1–10 liegt um das Raster (#16)', async () => {
  const { byId, feed } = await bootClient();
  feed(stateMsg());

  const frame = byId.get('foe-grid').parentElement;
  assert.ok(frame._classes.has('board-frame'), 'Raster steckt in einem Rahmen');

  const top = frame.children.find((c) => c._classes.has('axis-top'));
  const left = frame.children.find((c) => c._classes.has('axis-left'));
  assert.equal(top.children.map((s) => s.textContent).join(''), 'ABCDEFGHIJ');
  assert.equal(left.children.map((s) => s.textContent).join(','), '1,2,3,4,5,6,7,8,9,10');

  // Entscheidend: die Beschriftung darf die Feldindizes nicht verschieben.
  assert.equal(byId.get('foe-grid').children.length, 100);
  assert.equal(byId.get('foe-grid').children[0].dataset.i, '0');
});

test('Mehrfaches Rendern legt keine zweite Beschriftung an', async () => {
  const { byId, feed } = await bootClient();
  feed(stateMsg());
  const frames1 = byId.get('foe-grid').parentElement;
  feed(stateMsg({ turnCount: 4 }));
  feed(stateMsg({ turnCount: 5 }));
  assert.equal(byId.get('foe-grid').parentElement, frames1, 'derselbe Rahmen');
  assert.equal(frames1.children.filter((c) => c._classes.has('axis-top')).length, 1);
});

test('Schiffssymbole stehen auf dem eigenen Brett (#19)', async () => {
  const { byId, feed } = await bootClient();
  feed(stateMsg());

  const own = byId.get('own-grid');
  const syms = own.children.filter((c) => c._classes.has('sym')).map((c) => c.textContent);
  assert.equal(syms.length, 6, 'fünf Schiffe und ein Köder');
  // Zerstoerer traegt U+FE0E, damit iOS Text statt Emoji rendert.
  for (const s of ['⬟', '⬢', '◆', '◉', '▪︎', '◌']) {
    assert.ok(syms.includes(s), `Symbol ${s} fehlt`);
  }
});

test('Getroffenes Kopffeld traegt kein Symbol – sonst zwei Zeichen (#19)', async () => {
  const { byId, feed } = await bootClient();
  const m = stateMsg();
  m.own.ships[0].hits = [m.own.ships[0].cells[0]];
  feed(m);

  const head = byId.get('own-grid').children[m.own.ships[0].cells[0]];
  assert.ok(head._classes.has('hit'), 'Treffer ist markiert');
  assert.ok(!head._classes.has('sym'), 'kein Symbol darueber');
});

test('Flottenuebersicht zeigt gegnerische Verluste und eigenen Zustand (#20, #21)', async () => {
  const { byId, feed } = await bootClient();
  const m = stateMsg();
  m.own.ships[2].hits = [m.own.ships[2].cells[0]];        // Kreuzer angeschlagen
  m.own.ships[3].sunk = true;                             // U-Boot versenkt
  feed(m);

  const foe = byId.get('fleet-foe').children;
  assert.equal(foe.length, 5, 'alle fünf Typen aufgelistet');
  const zerst = foe.find((li) => li.innerHTML.includes('Zerstörer'));
  assert.ok(zerst._classes.has('gone'), 'versenkter Gegner ist durchgestrichen');
  assert.ok(zerst.innerHTML.includes('versenkt'));
  const traeger = foe.find((li) => li.innerHTML.includes('Träger'));
  assert.ok(!traeger._classes.has('gone'), 'lebender Gegner nicht');
  assert.ok(traeger.innerHTML.includes('5 Felder'));

  const own = byId.get('fleet-own').children;
  const kreuzer = own.find((li) => li.innerHTML.includes('Kreuzer'));
  assert.ok(kreuzer._classes.has('hurt'), 'angeschlagen markiert');
  assert.ok(kreuzer.innerHTML.includes('1/3 getroffen'));
  const uboot = own.find((li) => li.innerHTML.includes('U-Boot'));
  assert.ok(uboot._classes.has('gone'));
});

test('Gesperrte Aufklaerung zeigt den Grund an (#7)', async () => {
  const { byId, feed } = await bootClient();
  feed(stateMsg({ canScan: false, scanBlocked: 'Eröffnungszug: nur 1 Schuss.' }));
  assert.equal(byId.get('btn-scan').disabled, true);
  assert.match(byId.get('scan-hint').textContent, /Eröffnungszug/);
});

test('Aufstellungsbildschirm oeffnet sich ohne Ausnahme (#9, #10)', async () => {
  const { byId, feed } = await bootClient();
  feed({ t: 'lobby', code: 'AB12', status: 'lobby', options: stateMsg().options, players: [{ name: 'Rob', ready: false }, null] });

  // Genau der Weg, der in #9/#10 warf: der Knopf ruft startPlacement(),
  // das renderPlacement() aufruft, das #orient anspricht.
  assert.doesNotThrow(() => byId.get('btn-to-placement').onclick());
  assert.ok(byId.get('orient'), '#orient existiert noch');
  assert.equal(byId.get('screen-placement')._classes.has('active'), true);
  assert.equal(byId.get('place-grid').children.length, 100);
});

test('Statusmeldung zur Aufstellung loescht #orient nicht (#10)', async () => {
  const { byId, feed } = await bootClient();
  feed({ t: 'lobby', code: 'AB12', status: 'lobby', options: stateMsg().options, players: [{ name: 'Rob', ready: false }, null] });
  byId.get('btn-to-placement').onclick();

  assert.doesNotThrow(() => feed({ t: 'placementOk' }));
  assert.ok(byId.get('orient'), '#orient ueberlebt die Statusmeldung');
  assert.match(byId.get('place-status').textContent, /übermittelt/);
  assert.equal(byId.get('btn-random').disabled, true, 'gesperrt, solange der Server sie hat');

  assert.doesNotThrow(() => feed({ t: 'placementWithdrawn' }));
  assert.equal(byId.get('btn-random').disabled, false);
});

test('Endbildschirm nennt den Grund fuer das Partieende (#8)', async () => {
  const { byId, feed } = await bootClient();
  const m = stateMsg();
  feed(m);
  const reveal = { own: m.own, foe: m.own };
  assert.doesNotThrow(() => feed(stateMsg({ status: 'finished', winner: 1, endReason: 'timeout', reveal })));
  assert.match(byId.get('end-detail').textContent, /zwei Züge in Folge/);
  assert.match(byId.get('end-title').textContent, /Verloren/);
});

test('Funkverkehr nennt den Absender (#12)', async () => {
  const { byId, feed } = await bootClient();
  feed(stateMsg());
  feed({ t: 'notice', kind: 'timeout', slot: 0 });
  feed({ t: 'notice', kind: 'timeout', slot: 1 });
  const lines = byId.get('log').children.map((li) => li.innerHTML);
  assert.ok(lines.some((l) => l.includes('Du')), 'eigener Zug benannt');
  assert.ok(lines.some((l) => l.includes('Michi')), 'gegnerischer Zug benannt');
});

test('Revanche-Anfrage oeffnet den Dialog (#13)', async () => {
  const { byId, feed } = await bootClient();
  feed(stateMsg());
  feed({ t: 'notice', kind: 'rematchWanted', by: 'Michi' });
  assert.equal(byId.get('rematch-dialog').open, true, 'Dialog ist offen');
  assert.match(byId.get('rematch-who').textContent, /Michi/);

  byId.get('rematch-decline').onclick();
  assert.equal(byId.get('rematch-dialog').open, false, 'Ablehnen schliesst ihn');
});

test('Versenkte Gegner heben sich von blossen Treffern ab (#18)', async () => {
  const { byId, feed } = await bootClient();
  const m = stateMsg();
  m.tracking = new Array(100).fill(0);
  for (const i of [10, 11]) m.tracking[i] = 2;   // versenktes Schiff
  for (const i of [30, 31]) m.tracking[i] = 2;   // nur angeschlagen
  m.sunkCells = [10, 11];
  feed(m);

  const foe = byId.get('foe-grid').children;
  assert.ok(foe[10]._classes.has('sunk'), 'versenktes Feld ist als versenkt markiert');
  assert.ok(!foe[10]._classes.has('hit'), 'und nicht mehr nur als Treffer');
  assert.ok(foe[30]._classes.has('hit'), 'angeschlagenes Feld bleibt Treffer');
  assert.ok(!foe[30]._classes.has('sunk'));
});

test('Ohne sunkCells bleibt alles beim Alten', async () => {
  const { byId, feed } = await bootClient();
  const m = stateMsg();
  m.tracking[10] = 2;
  delete m.sunkCells;                            // aeltere Serverfassung
  assert.doesNotThrow(() => feed(m));
  assert.ok(byId.get('foe-grid').children[10]._classes.has('hit'));
});

test('Flottenuebersicht haengt nicht im klebenden Bereich', async () => {
  const { byId, feed } = await bootClient();
  feed(stateMsg());

  // Hochkant klebt .controls unten. Lag die Uebersicht darin, wuchs die Leiste
  // auf ueber die halbe Schirmhoehe und verdeckte das Spielfeld.
  const inSticky = (el) => {
    for (let p = el; p; p = p.parentElement) if (p._classes?.has('controls')) return true;
    return false;
  };
  assert.equal(inSticky(byId.get('fleet-foe')), false, 'Gegnerliste steht ausserhalb');
  assert.equal(inSticky(byId.get('fleet-own')), false, 'eigene Liste steht ausserhalb');

  // Und trotzdem gefuellt - der Umzug darf das Rendern nicht abhaengen.
  assert.equal(byId.get('fleet-foe').children.length, 5);
  assert.equal(byId.get('fleet-own').children.length, 5);
});
