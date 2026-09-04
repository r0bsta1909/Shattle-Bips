// Bildschirmfoto der Spielansicht, ohne den Server zu starten und ohne zu spielen.
//
// Warum es das gibt: Layout-Geometrie war in diesem Projekt lange "statisch
// nicht pruefbar" (docs/LEARNINGS.md) - jede Runde wurde geschaetzt, und der
// Nutzer musste am Geraet korrigieren. Chrome ist auf jedem Entwicklungsrechner
// da; damit laesst sich das ECHTE Markup mit dem ECHTEN CSS rendern und
// ansehen. Kein Zusatzpaket, keine devDependency.
//
//   node tools/shot.mjs                          # 1859x990, Spielansicht
//   node tools/shot.mjs 393x852                  # hochkant
//   node tools/shot.mjs 1440x900 maneuver        # mit geoeffnetem Manoevermodus
//   node tools/shot.mjs 1440x900 normal out.png  # Ziel selbst waehlen
//   node tools/shot.mjs 393x852 lobby            # Lobby mit aufgeklappten Einstellungen
//   node tools/shot.mjs 393x852 placement        # Aufstellung mit halber Flotte
//
// Der Prüfstand fuellt die Raster und Listen mit Platzhaltern - er beweist
// deshalb Geometrie, nicht Spiellogik. Dafuer sind die e2e-Laeufe da.

import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const KANDIDATEN = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);

const chrome = KANDIDATEN.find((p) => existsSync(p));
if (!chrome) {
  console.error('Kein Chrome gefunden. Pfad ueber die Umgebungsvariable CHROME setzen.');
  process.exit(1);
}

const [groesse = '1859x990', modus = 'normal', ziel = 'shot.png'] = process.argv.slice(2);
const [breite, hoehe] = groesse.split('x').map(Number);
if (!breite || !hoehe) { console.error('Groesse als BREITExHOEHE angeben, z.B. 1440x900.'); process.exit(1); }

/** Baut die Seite: echtes Markup, echtes CSS, nur der aktive Bildschirm umgestellt. */
function seite() {
  let html = readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  // CSS einbetten statt verlinken - eine file://-Seite laedt sonst nichts nach.
  html = html.replace('<link rel="stylesheet" href="/css/style.css">',
    `<style>${readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8')}</style>`);
  html = html.replace('id="screen-start" class="screen active"', 'id="screen-start" class="screen"');
  // Welcher Bildschirm: Spiel (normal/maneuver), Lobby oder Aufstellung.
  const screen = modus === 'lobby' ? 'screen-lobby' : modus === 'placement' ? 'screen-placement' : 'screen-game';
  html = html.replace(`id="${screen}" class="screen"`, `id="${screen}" class="screen active"`);
  // Die Einstellungen sind absichtlich eingeklappt - fuers Foto aufklappen.
  if (modus === 'lobby') html = html.replace('id="opt-card">', 'id="opt-card" open>');
  // app.js braucht einen Server und eine Partie - hier fuellt ein Platzhalter.
  html = html.replace('<script type="module" src="/js/app.js"></script>', '');
  if (modus === 'maneuver') {
    html = html.replace('id="maneuver-panel" class="man-panel hidden"', 'id="maneuver-panel" class="man-panel"');
  }
  return html.replace('</body>', fuellung() + '</body>');
}

function fuellung() {
  const flotte = [['\u2b1f', 'Träger', 5], ['\u25cf', 'Schlachtschiff', 4],
    ['\u25c6', 'Kreuzer', 3], ['\u25c9', 'U-Boot', 3], ['\u25aa', 'Zerstörer', 2]];
  if (modus === 'lobby') return `<script>
document.getElementById('lobby-code').textContent = 'NZRM';
document.getElementById('join-url').value = 'https://shattle-bips.onrender.com/#NZRM';
for (const t of ['Rob – du — stellt auf…', 'wartet auf Mitspieler…']) {
  const li = document.createElement('li'); li.textContent = t; document.getElementById('lobby-players').appendChild(li);
}
</script>`;
  if (modus === 'placement') return `<script>
const grid = document.getElementById('place-grid');
for (let i = 0; i < 100; i++) { const d = document.createElement('div'); d.className = 'cell'; grid.appendChild(d); }
for (const i of [0,1,2,3,4, 20,21,22,23, 60,70,80]) grid.children[i].classList.add('ship');
const ul = document.getElementById('ship-list');
[['Träger (5)','done'],['Schlachtschiff (4)','done'],['Kreuzer (3)','done'],['U-Boot (3)','active'],['Zerstörer (2)',''],['Köder 1 (2)',''],['Köder 2 (2)','']]
  .forEach(([t, c]) => { const li = document.createElement('li'); li.textContent = t; if (c) li.className = c; ul.appendChild(li); });
</script>`;
  return `<script>
const A = 'ABCDEFGHIJ';
function rahmen(id){
  const grid = document.getElementById(id);
  for (let i = 0; i < 100; i++) { const d = document.createElement('div'); d.className = 'cell'; grid.appendChild(d); }
  const wrap = document.createElement('div'); wrap.className = 'board-frame';
  const ecke = document.createElement('div'); ecke.className = 'axis-corner';
  const oben = document.createElement('div'); oben.className = 'axis axis-top';
  for (const c of A) { const s = document.createElement('span'); s.textContent = c; oben.appendChild(s); }
  const links = document.createElement('div'); links.className = 'axis axis-left';
  for (let r = 1; r <= 10; r++) { const s = document.createElement('span'); s.textContent = r; links.appendChild(s); }
  grid.parentNode.insertBefore(wrap, grid);
  wrap.append(ecke, oben, links, grid);
}
rahmen('foe-grid'); rahmen('own-grid');
const setzen = (id, text) => { const e = document.getElementById(id); if (e) e.textContent = text; };
setzen('foe-name', 'Shattle-Bot'); setzen('foe-ships', '5 Schiffe'); setzen('own-ships', '5 Schiffe');
setzen('turn-text', 'Du bist am Zug.'); setzen('salvo-count', '0/4'); setzen('clock', '37 s');
${modus === 'maneuver' ? "setzen('mode-pill', 'Manövermodus');" : ''}
for (const id of ['fleet-foe', 'fleet-own']) {
  const ul = document.getElementById(id);
  for (const [sym, name, len] of ${JSON.stringify(flotte)}) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="sym">' + sym + '</span><span class="name">' + name +
      '</span><span class="len">' + len + ' Felder</span>';
    ul.appendChild(li);
  }
}
const log = document.getElementById('log');
for (const t of ['<i>Shattle-Bot</i> \\u2192 Beschuss auf E5.', '<b>Partie gestartet.</b>']) {
  const li = document.createElement('li'); li.innerHTML = t; log.appendChild(li);
}
${modus === 'maneuver' ? `
const ms = document.getElementById('maneuver-ships');
for (const [n, l] of [['Träger',5],['Schlachtschiff',4],['Kreuzer',3],['U-Boot',3],['Zerstörer',2]]) {
  const b = document.createElement('button'); b.textContent = n + ' (' + l + ')'; ms.appendChild(b);
}` : ''}
</script>`;
}

const arbeit = mkdtempSync(path.join(tmpdir(), 'shattle-shot-'));
const datei = path.join(arbeit, 'seite.html');
writeFileSync(datei, seite());

/*
 * Die Seite laeuft in einem Rahmen GENAU der gewuenschten Groesse.
 *
 * Warum nicht einfach --window-size: Chrome legt darunter eine Mindestbreite
 * fest und rendert dann breiter, als das Bild hinterher gross ist. Ein
 * 375px-Foto zeigte in Wahrheit ein 412px-Layout - alles sah zu eng aus, und
 * wer dem Bild glaubt, repariert Fehler, die es nicht gibt. Ein <iframe> hat
 * dagegen exakt die gesetzte Breite als Viewport, egal wie gross das Fenster
 * ist. Deshalb ist das Fenster absichtlich groesser: der Rand ausserhalb des
 * Rahmens gehoert nicht zur Seite.
 */
const rahmen = path.join(arbeit, 'rahmen.html');
writeFileSync(rahmen, `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#000}
iframe{display:block;width:${breite}px;height:${hoehe}px;border:0;margin:12px}</style>
<iframe src="seite.html"></iframe>`);

execFileSync(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  // Eigenes Profil je Lauf: zwei Chrome-Aufrufe hintereinander streiten sich
  // sonst um die Sperre im Profilordner und der zweite schreibt kein Bild.
  `--user-data-dir=${path.join(arbeit, 'profil')}`,
  `--window-size=${Math.max(breite + 24, 560)},${hoehe + 24}`,
  '--virtual-time-budget=4000',
  // Vorwaertsschraegstriche auch unter Windows: mit Backslashes schreibt
  // Chrome das Bild wortlos nicht.
  `--screenshot=${path.resolve(ziel).replace(/\\/g, '/')}`,
  `file:///${rahmen.replace(/\\/g, '/')}`
], { stdio: 'ignore' });

// Nachsehen, ob wirklich etwas entstanden ist. Chrome beendet sich auch dann
// mit 0, wenn es gar kein Bild geschrieben hat - in einer Sitzung liefen so
// mehrere Vergleiche gegen Dateien, die es nie gab, und meldeten brav
// "Unterschied". Ein Messwerkzeug, das stumm nichts tut, ist schlimmer als
// keines: es erzeugt Befunde statt sie zu verhindern.
if (!existsSync(path.resolve(ziel))) {
  console.error(`Chrome hat kein Bild geschrieben: ${ziel}`);
  console.error('Chrome beendet sich auch bei Fehlschlag mit 0. Pruefen:');
  console.error('  "%s" --version   (antwortet das nicht, laeuft Chrome hier gar nicht)', chrome);
  process.exit(1);
}

console.log(`${ziel}  (${breite}x${hoehe}, ${modus})`);
