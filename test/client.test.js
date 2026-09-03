// NEBEL – Statische Kopplung zwischen Client und Markup.
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
  assert.match(html, /<h1>NEBEL <span id="version"/, 'Version steht in der Überschrift');
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
