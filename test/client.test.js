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

/**
 * Alle Rumpfe der Media-Bloecke mit diesem Kopf, aneinandergehaengt.
 * Klammern werden gezaehlt: in einem @media-Block stehen wieder Regeln mit
 * Klammern, ein `.*?` bis zur naechsten schliessenden erwischt nur die erste.
 */
function mediaBody(source, marker) {
  let out = '';
  for (let at = source.indexOf(marker); at !== -1; at = source.indexOf(marker, at)) {
    let i = source.indexOf('{', at) + 1;
    const start = i;
    for (let depth = 1; i < source.length && depth > 0; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
    }
    out += `${source.slice(start, i - 1)}\n`;
    at = i;
  }
  return out;
}
const desktopCss = mediaBody(cssCode, '@media(min-width:780px)');

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
  // Bis zum ";" ODER zur "}" lesen: die letzte Deklaration einer Regel hat
  // kein Semikolon, und ein /[^;]+;/ lief dann bis weit in die naechste Regel.
  const decls = [...cssCode.matchAll(/--cs\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());
  assert.ok(decls.some((d) => !d.includes('clamp(')), 'Rückfallwert für alte Browser');

  // Frueher stand hier: "im ERSTEN 780px-Block darf kein --cs stehen". Das war
  // eine Ortsangabe, keine Regel - ein zweiter Block haette sie umgangen.
  // Geprueft wird jetzt die Regel selbst: JEDE gerechnete Fassung nennt beide
  // Achsen. Sonst ragt das Brett genau dort heraus, wo die Kopplung fehlt.
  const modern = decls.filter((d) => d.includes('clamp('));
  assert.ok(modern.length >= 3, 'Grundfassung, Hochkant und Breitbild gerechnet');
  for (const d of modern) {
    assert.match(d, /100vw/, `Breite fehlt in "${d}"`);
    assert.match(d, /dvh/, `Höhe fehlt in "${d}" – sonst ragt das Brett heraus`);
  }

  // Am PC stehen ZWEI Bretter nebeneinander. Teilt die Breite dort weiter
  // durch 10, ist die Rechnung um ein ganzes Brett zu grosszuegig.
  const wideCs = /#screen-game\{--cs:([^}]+)\}/.exec(desktopCss);
  assert.ok(wideCs, 'Breitbild rechnet eine eigene Kachelgröße');
  assert.match(wideCs[1], /100vw[^,]*\/\s*20/,
    'zwei Bretter teilen sich die Breite');
});

test('Sichere Bereiche und Kopfzeilenhöhe sind berücksichtigt', () => {
  assert.match(css, /env\(safe-area-inset-bottom\)/, 'Safaris untere Leiste eingeplant');
  // Die Spielansicht ist so hoch wie der Schirm minus Kopfzeile. Deren Hoehe
  // wird gemessen, nicht geraten - sie haengt an Schriftgroesse und Umbruch.
  assert.match(cssCode, /var\(--header-h/, 'Ansichtshöhe richtet sich nach der gemessenen Kopfzeile');
  assert.match(app, /--header-h/, 'und der Client misst sie auch');
  assert.ok(!/--controls-h/.test(cssCode), 'kein Rest der alten Klebe-Leiste im CSS');
  assert.ok(!/--controls-h/.test(app), 'und keiner im Client');
});

test('Spielansicht steht hochkant fest und scrollt nicht (#22, #23)', () => {
  const portrait = cssCode.slice(cssCode.indexOf('@media(max-width:779px)'));
  assert.match(portrait, /#screen-game\.active\{[^}]*overflow:hidden/,
    'die Ansicht selbst scrollt nicht');
  assert.match(portrait, /100dvh/, 'sie ist genau schirmhoch');
  assert.match(cssCode, /\.game-pane:not\(\.active\)\{display:none\}/,
    'immer nur ein Bereich sichtbar');
  // Die Leiste klebte und schob sich ueber die Reihen 9-10. Jetzt gibt es
  // die Klasse gar nicht mehr - sie steht fest im Gitter.
  assert.ok(!/\.controls\.sticky/.test(cssCode), 'nichts klebt mehr über dem Brett');
  assert.ok(!/class="controls card sticky"/.test(html), 'auch nicht im Markup');
});

// ------------------------------------------------------ Spieltisch am PC
// Der Umbau fuer das Telefon (Runde 3) hat den PC unbrauchbar gemacht, ohne
// dass ein Test angeschlagen haette: die Bretter lagen untereinander, die
// Bedienspalte war 155px schmal und schnitt ihre Knopfbeschriftung ab.
// Gemeldet per Screenshot, nicht per Feedback-Knopf - deshalb hier und nicht
// in playtest-bugs.test.js, das nach Issue-Nummern indiziert.

test('Am PC stehen beide Bretter nebeneinander', () => {
  const areas = /grid-template-areas:([^;]+);/.exec(desktopCss);
  assert.ok(areas, 'Breitbild ordnet die Bereiche in Flächen an');

  const rows = [...areas[1].matchAll(/"([^"]+)"/g)].map((m) => m[1].split(/\s+/).filter(Boolean));
  assert.ok(rows.length >= 2, 'mindestens zwei Reihen');
  assert.ok(rows[0].includes('foe') && rows[0].includes('own'),
    'Gegnerbrett und eigenes Brett in derselben Reihe – sonst stapeln sie sich');
  assert.ok(rows[0].includes('ctrl'), 'die Bedienung steht daneben, nicht darunter');

  // Ohne display:contents bleiben Brett und Flottenuebersicht in einem Kasten
  // und lassen sich nicht getrennt setzen.
  assert.match(desktopCss, /\.game-pane\{[^}]*display:contents/,
    'die Bereiche geben ihre Kinder ans Raster ab');
  assert.match(desktopCss, /\.game-pane\{display:block ?!important/,
    'display:block bleibt als Rückfall für Browser ohne display:contents');

  for (const area of ['foe', 'own', 'info', 'log', 'ctrl']) {
    // Zeichenklasse statt \b: ein Escape in einem Template-Literal wird vom
    // JS-Parser gelesen, bevor die RegExp ihn sieht - "\b" ist dort ein
    // Rueckschritt-Zeichen, keine Wortgrenze.
    assert.match(desktopCss, new RegExp(`grid-area:${area}[;}]`), `${area} ist gesetzt`);
  }

  // Die alte Aufteilung: eine auto-Spalte nimmt sich die max-content-Breite
  // ihres breitesten Kindes, 1fr bekommt nur den Rest.
  assert.ok(!/grid-template-columns:auto 1fr/.test(desktopCss),
    'keine auto-Spalte mehr, die der Bedienung den Platz wegnimmt');
  const cols = /grid-template-columns:([^;]+);/.exec(desktopCss);
  assert.match(cols[1], /minmax\(/, 'die Bedienspalte hat eine Untergrenze');
});

test('Aktionsknöpfe werden am PC nicht gequetscht', () => {
  // Die globale Regel ist fuer das Telefon: vier Knoepfe muessen in eine
  // Zeile, also duerfen sie unter ihre Textbreite schrumpfen. In einer
  // schmalen Seitenspalte stand danach "Feue", "Aufklae", "Tauch".
  assert.match(cssCode, /\.row\.actions button\{[^}]*min-width:0/,
    'die enge Fassung existiert weiterhin');
  assert.match(desktopCss, /\.row\.actions\{[^}]*flex-direction:column/,
    'am PC untereinander – dort ist die Spalte schmal, nicht der Schirm');
});

test('Die Breitengrenze hängt am Bildschirm, nicht an main', () => {
  // Solange main auf 1100px deckelte, konnte kein einzelner Bildschirm
  // ausscheren - zwei Bretter plus Bedienung passen da nicht hinein.
  assert.ok(!/(^|\n)main\{[^}]*max-width/.test(cssCode),
    'main deckelt nicht mehr alle Bildschirme');
  assert.match(cssCode, /\.screen\{[^}]*max-width:1100px/,
    'die Lesebreite liegt jetzt am einzelnen Bildschirm');
  assert.match(desktopCss, /#screen-game\.active\{[^}]*max-width:none/,
    'die Spielansicht hebt sie auf');
});
