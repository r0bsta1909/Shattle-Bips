// End-to-End: /version im Kopf und der Feedback-Endpunkt über echtes HTTP.
// Läuft gegen die Memory-Senke, damit nichts nach draußen geht.

process.env.PORT = process.env.PORT || '3250';
process.env.FEEDBACK_SINK = 'memory';
process.env.FEEDBACK_ADMIN_TOKEN = 'test-admin-token';

await import('../server/index.js');
await new Promise((r) => setTimeout(r, 400));

const BASE = `http://127.0.0.1:${process.env.PORT}`;
let fails = 0;
const check = (cond, label) => { console.log(`${cond ? 'ok  ' : 'FAIL'} – ${label}`); if (!cond) fails++; };

const post = (body, headers = {}) =>
  fetch(`${BASE}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });

// ------------------------------------------------------------------ Version
const vres = await fetch(`${BASE}/version`);
const v = await vres.json();
check(vres.status === 200, '/version antwortet');
check(typeof v.label === 'string' && v.label.startsWith('v'), `Label vorhanden: ${v.label}`);
check(v.version && /^\d+\.\d+\.\d+$/.test(v.version), `Semver aus package.json: ${v.version}`);
check(v.build !== null || v.short !== null, 'fortlaufende Nummer oder Commit vorhanden');
check(vres.headers.get('cache-control') === 'no-store', 'Version wird nicht gecacht');

const health = await (await fetch(`${BASE}/healthz`)).json();
check(health.version === v.label, 'healthz meldet dieselbe Version');

// ------------------------------------------------------------ Cache-Politik
// Regression: mit "max-age=1h" lief nach einem Deploy bis zu eine Stunde altes
// app.js gegen neues index.html. Der Feedback-Knopf erschien dann, klickte aber
// ins Leere. Statische Dateien muessen revalidiert werden, nicht blind gecacht.
for (const file of ['/', '/js/app.js', '/css/style.css']) {
  const r = await fetch(`${BASE}${file}`);
  const cc = r.headers.get('cache-control') || '';
  check(!/max-age=[1-9]/.test(cc), `${file}: kein blindes max-age (${cc || 'kein Header'})`);
  check(/no-cache|no-store|max-age=0/.test(cc), `${file}: Revalidierung verlangt`);
  check(!!r.headers.get('etag'), `${file}: ETag vorhanden`);
}

// Unveraenderte Datei muss 304 ohne Rumpf liefern, sonst kostet no-cache echte Bytes.
//
// Bewusst ueber node:http statt fetch: Node-fetch haengt von sich aus
// "cache-control: no-cache" an den Request, und Express behandelt einen solchen
// Request korrekterweise immer als veraltet – der Test wuerde nie 304 sehen.
// Ein Browser schickt das nur beim harten Neuladen.
const { request } = await import('node:http');

const conditionalGet = (pathname, etag) => new Promise((resolve, reject) => {
  const req = request(
    { host: '127.0.0.1', port: Number(process.env.PORT), path: pathname, headers: { 'If-None-Match': etag } },
    (res) => {
      let bytes = 0;
      res.on('data', (c) => { bytes += c.length; });
      res.on('end', () => resolve({ status: res.statusCode, bytes }));
    }
  );
  req.on('error', reject);
  req.end();
});

const first = await fetch(`${BASE}/js/app.js`);
const again = await conditionalGet('/js/app.js', first.headers.get('etag'));
check(again.status === 304, `unveränderte Datei revalidiert zu 304 (war ${again.status})`);
check(again.bytes === 0, `304 kommt ohne Rumpf (${again.bytes} Byte)`);

const changed = await conditionalGet('/js/app.js', 'W/"veraltet"');
check(changed.status === 200, 'veralteter ETag liefert die Datei neu aus');

// ----------------------------------------------------------- Ablehnungsfälle
check((await post({ text: 'ne' })).status === 400, 'zu kurzer Text: 400');
check((await post({ text: 'x'.repeat(4001) })).status === 400, 'zu langer Text: 400');
check((await post({})).status === 400, 'ohne Text: 400');

// ---------------------------------------------------------------- Annahme
const okRes = await post({
  text: 'Der Scan war unklar.\nZweite Zeile.',
  screen: 'screen-game',
  code: 'AB12',
  options: '{"minSalvo":2}'
});
const okBody = await okRes.json();
check(okRes.status === 200 && okBody.ok === true, 'gültiges Feedback: 200');
check(typeof okBody.ref === 'string', `Referenz zurückgegeben: ${okBody.ref}`);

// -------------------------------------------------------------- Diagnose
const pubRes = await fetch(`${BASE}/api/feedback/status`);
const pub = await pubRes.json();
check(pubRes.status === 200, '/api/feedback/status antwortet');
check(pub.sink === 'memory' && pub.ok === true, `Senke gemeldet: ${pub.sink}`);
// Positivliste statt fester Reihenfolge: neue Kategorien duerfen dazukommen,
// Interna nicht. Die Namen unten sind genau die, die nach aussen duerfen.
const ALLOWED = ['sink', 'ok', 'reason', 'reads'];
const leaked = Object.keys(pub).filter((k) => !ALLOWED.includes(k));
check(leaked.length === 0, `öffentlich nur ${ALLOWED.join('/')} (zusätzlich: ${leaked.join(',') || 'nichts'})`);
for (const secret of ['lastError', 'repo', 'status', 'detail', 'hint', 'version']) {
  check(!(secret in pub), `öffentlich kein "${secret}"`);
}

const admRes = await fetch(`${BASE}/api/feedback/status`, { headers: { 'x-admin-token': 'test-admin-token' } });
const adm = await admRes.json();
check(typeof adm.hint === 'string' && adm.hint.length > 0, `mit Token gibt es Klartext: "${adm.hint}"`);
check(!!adm.version && adm.version.label === v.label, 'mit Token kommt der Programmstand mit');

// ------------------------------------------------------------- Adminzugriff
check((await fetch(`${BASE}/api/feedback`)).status === 401, 'Adminliste ohne Token: 401');

const adminRes = await fetch(`${BASE}/api/feedback`, { headers: { 'x-admin-token': 'test-admin-token' } });
const admin = await adminRes.json();
check(adminRes.status === 200, 'Adminliste mit Token: 200');
check(admin.sink === 'memory', 'Senke gemeldet');
check(admin.entries.length === 1, 'genau ein Eintrag gespeichert');
check(admin.entries[0].text.startsWith('Der Scan war unklar.'), 'Text unverändert');
check(admin.entries[0].meta.screen === 'screen-game', 'Bildschirm mitgeschickt');
check(admin.entries[0].meta.code === 'AB12', 'Lobbycode mitgeschickt');
check(!!admin.entries[0].meta.ua, 'User-Agent erfasst');

// ------------------------------------------------------------------ Bremse
// Ein Eintrag ist schon durch; ab dem sechsten muss 429 kommen.
let limited = null;
for (let i = 0; i < 8 && limited === null; i++) {
  const r = await post({ text: `Wiederholung ${i}` });
  if (r.status === 429) limited = i;
}
check(limited !== null, `Bremse greift (beim ${limited + 2}. Versuch)`);

const after = await (await fetch(`${BASE}/api/feedback`, { headers: { 'x-admin-token': 'test-admin-token' } })).json();
check(after.entries.length === 5, `Bremse deckelt bei 5 gespeicherten Einträgen (waren ${after.entries.length})`);

console.log(fails ? `\n${fails} PRÜFUNG(EN) FEHLGESCHLAGEN` : '\nALLE PRÜFUNGEN BESTANDEN');
process.exit(fails ? 1 : 0);
