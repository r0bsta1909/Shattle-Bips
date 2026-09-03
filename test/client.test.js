// Shattle Bips – Statische Kopplung zwischen Client und Markup.
//
// Der Client hat keinen Build-Schritt und keine Typen. Ein $('tippfehler') faellt
// deshalb erst im Browser auf, und dort nur auf dem Bildschirm, der ihn benutzt.
// Dieser Test zieht die Kopplung nach vorn: jede ID, die app.js anspricht, muss
// im HTML stehen.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
const html = readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const css = readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');

// Kommentare raus, bevor CSS analysiert wird. Ein Kommentar, der eine alte
// Deklaration ZITIERT, sah fuer die Regex sonst aus wie die Deklaration selbst -
// der Test schlug an der eigenen Prosa fehl.
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');

const referenced = [...app.matchAll(/\$\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
const present = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

test('Jede vom Client angesprochene ID steht im HTML', () => {
  const missing = [...new Set(referenced)].filter((id) => !present.has(id));
  assert.deepEqual(missing, [], `Fehlende IDs: ${missing.join(', ')}`);
});

test('IDs im HTML sind eindeutig', () => {
  const all = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const doppelt = all.filter((id, i) => all.indexOf(id) !== i);
  assert.deepEqual([...new Set(doppelt)], []);
});

test('Kopfzeile trägt Programmstand und Feedback-Knopf', () => {
  assert.match(html, /<h1>Shattle Bips <span id="version"/, 'Version steht in der Überschrift');
  assert.ok(present.has('btn-feedback'), 'Feedback-Knopf vorhanden');
  assert.match(css, /\.version\{/, 'Version ist gestylt');
});

test('Feedback-Dialog ist vollständig verdrahtet', () => {
  for (const id of ['feedback-dialog', 'feedback-form', 'feedback-text',
    'feedback-msg', 'feedback-count', 'feedback-send', 'feedback-cancel']) {
    assert.ok(present.has(id), `${id} fehlt im HTML`);
  }
  assert.match(html, /<dialog id="feedback-dialog"/, 'natives <dialog> statt Eigenbau');
  assert.match(html, /maxlength="4000"/, 'Zeichengrenze auch im Markup');
  assert.match(css, /dialog\.sheet::backdrop/, 'Backdrop gestylt');
});

test('Client holt Version und postet Feedback an den eigenen Server', () => {
  assert.match(app, /fetch\('\/version'\)/);
  assert.match(app, /fetch\('\/api\/feedback'/);
  assert.ok(!/api\.github\.com/.test(app), 'kein GitHub-Zugriff aus dem Browser');
  assert.ok(!/GITHUB_TOKEN/.test(app), 'kein Token im Client');
});

/**
 * Ermittelt die IDs, deren Element im HTML weitere IDs enthaelt.
 * Kleiner Tiefenzaehler statt echtem Parser – reicht fuer dieses Markup.
 */
function containerIds(markup) {
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img',
    'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const stack = [];
  const containers = new Set();
  const tag = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

  for (let m; (m = tag.exec(markup));) {
    const [, closing, name, attrs] = m;
    if (closing) { stack.pop(); continue; }
    if (VOID.has(name.toLowerCase()) || /\/\s*$/.test(attrs)) {
      // Selbstschliessend: kann trotzdem eine ID in einen Container legen.
      const id = (attrs.match(/\bid="([^"]+)"/) || [])[1];
      if (id) for (const open of stack) if (open) containers.add(open);
      continue;
    }
    const id = (attrs.match(/\bid="([^"]+)"/) || [])[1] || null;
    if (id) for (const open of stack) if (open) containers.add(open);
    stack.push(id);
  }
  return containers;
}

test('Kein textContent/innerHTML auf ein Element, das andere IDs enthält', () => {
  // Loeste Issues #9 und #10 aus: <b id="orient"> steckt in <p id="place-hint">.
  // Ein $('place-hint').textContent = '' loescht damit #orient aus dem DOM,
  // und der naechste $('orient')-Zugriff wirft. Statisch sichtbar, sobald man
  // Schreibziele mit der Verschachtelung im Markup abgleicht.
  const containers = containerIds(html);
  assert.ok(containers.has('place-hint'), 'Selbsttest: place-hint enthält #orient');

  const writes = [...app.matchAll(/\$\(\s*'([^']+)'\s*\)\s*\.\s*(textContent|innerHTML)\s*=/g)]
    .map((m) => ({ id: m[1], prop: m[2] }));

  const kaputt = writes.filter((w) => containers.has(w.id));
  assert.deepEqual(kaputt, [],
    `Diese Zuweisungen löschen verschachtelte Elemente: ${kaputt.map((w) => `$('${w.id}').${w.prop}`).join(', ')}`);
});

test('Aufstellung: Anleitung und Statusmeldung sind getrennte Elemente', () => {
  assert.ok(present.has('place-hint'), 'Anleitung mit #orient');
  assert.ok(present.has('place-status'), 'eigenes Feld für Statusmeldungen');
  assert.match(html, /id="place-hint"[^>]*>[^<]*<b id="orient"/, '#orient liegt in der Anleitung');
  assert.match(app, /\$\('place-status'\)\.textContent/, 'Status geht nach place-status');
  assert.ok(!/\$\('place-hint'\)\.textContent\s*=/.test(app), 'und nie mehr nach place-hint');
});

test('CSS-content-Werte sind einzelne Zeichen, keine kaputten Escapes', () => {
  // Loeste Issue #17 aus: ein CSS-"\2715" (✕) lief durch ein Python-Heredoc,
  // dort ist \271 ein Oktal-Escape -> "¹", Rest "5". Im Raster stand "¹5".
  const values = [...cssCode.matchAll(/content\s*:\s*"([^"]*)"/g)].map((m) => m[1]);
  const verdaechtig = values.filter((v) => [...v].length > 1);
  assert.deepEqual(verdaechtig, [],
    `content-Werte mit mehr als einem Zeichen: ${verdaechtig.map((v) => JSON.stringify(v)).join(', ')}`);
});

test('Keine Zeichensatz-Schaeden in den ausgelieferten Dateien', () => {
  // Klassische Mojibake-Marker. Sie entstehen, wenn Text durch ein Werkzeug
  // laeuft, das die Kodierung wechselt - im Browser sieht man sie sofort,
  // in einem Diff leicht zu uebersehen.
  for (const [name, text] of [['index.html', html], ['style.css', css], ['app.js', app]]) {
    for (const marker of ['\uFFFD', 'Ã¤', 'Ã¶', 'Ã¼', 'ÃŸ', 'â€']) {
      assert.ok(!text.includes(marker),
        `${name} enthält den Mojibake-Marker ${JSON.stringify(marker)}`);
    }
  }
});

test('Kachelgröße ist an Breite UND Höhe gekoppelt', () => {
  // Loeste die Hochkant-Meldung aus: --cs stand auf min(9vw,34px), landete auf
  // jedem iPhone bei 34px, und mit der Rasterbeschriftung passte das Brett
  // nicht mehr in die Breite.
  const decls = [...cssCode.matchAll(/--cs\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.ok(decls.length >= 2, 'Rückfallwert und moderne Fassung vorhanden');

  const modern = decls[decls.length - 1];
  assert.match(modern, /clamp\(/, 'Unter- und Obergrenze gesetzt');
  assert.match(modern, /100vw/, 'Breite berücksichtigt');
  assert.match(modern, /dvh/, 'Höhe berücksichtigt – sonst ragt das Brett quer heraus');

  // Der 780px-Block darf --cs nicht mehr hart setzen, sonst ist die
  // Hoehenkopplung genau dort wieder weg, wo sie gebraucht wird.
  const wide = cssCode.slice(cssCode.indexOf('@media(min-width:780px)'));
  assert.ok(!/--cs\s*:/.test(wide.slice(0, wide.indexOf('}\n}') + 3)),
    'im Breitbild-Block wird --cs nicht überschrieben');
});

test('Sichere Bereiche und Leistenhöhe sind berücksichtigt', () => {
  assert.match(css, /env\(safe-area-inset-bottom\)/, 'Safaris untere Leiste eingeplant');
  assert.match(css, /var\(--controls-h/, 'Scrollraum richtet sich nach der gemessenen Leiste');
  assert.match(app, /--controls-h/, 'und der Client misst sie auch');
  assert.match(css, /#mode-pill:empty\{display:none\}/, 'leere Kapsel wird ausgeblendet');
});
