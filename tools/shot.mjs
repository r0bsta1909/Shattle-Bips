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
  html = html.replace('id="screen-game" class="screen"', 'id="screen-game" class="screen active"');
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

execFileSync(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  // Eigenes Profil je Lauf: zwei Chrome-Aufrufe hintereinander streiten sich
  // sonst um die Sperre im Profilordner und der zweite schreibt kein Bild.
  `--user-data-dir=${path.join(arbeit, 'profil')}`,
  `--window-size=${breite},${hoehe}`,
  '--virtual-time-budget=4000',
  // Vorwaertsschraegstriche auch unter Windows: mit Backslashes schreibt
  // Chrome das Bild wortlos nicht.
  `--screenshot=${path.resolve(ziel).replace(/\\/g, '/')}`,
  `file:///${datei.replace(/\\/g, '/')}`
], { stdio: 'ignore' });

console.log(`${ziel}  (${breite}x${hoehe}, ${modus})`);
