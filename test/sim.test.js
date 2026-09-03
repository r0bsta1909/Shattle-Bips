// NEBEL – Sim-Kommandozeile: reicht sie die Lobby-Optionen unverfälscht durch?

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs, changedOptions } from '../tools/sim.mjs';
import { DEFAULT_OPTIONS } from '../server/rules.js';

test('Ohne Argumente: Standardregelsatz, 500 Partien', () => {
  const c = parseArgs([]);
  assert.equal(c.games, 500);
  assert.deepEqual(c.options, DEFAULT_OPTIONS);
  assert.deepEqual(changedOptions(c.options), []);
});

test('Partienzahl als Positionsargument', () => {
  assert.equal(parseArgs(['800']).games, 800);
  assert.equal(parseArgs(['0']).games, 1, 'mindestens eine Partie');
});

test('Schalter: --flag setzt, --no-flag löscht', () => {
  assert.equal(parseArgs(['--singleShotAfterHit']).options.singleShotAfterHit, true);
  assert.equal(parseArgs(['--no-openingBalance']).options.openingBalance, false);
  assert.equal(parseArgs(['--scanEnabled=false']).options.scanEnabled, false);
  assert.equal(parseArgs(['--scanEnabled=0']).options.scanEnabled, false);
});

test('Zahlen brauchen einen Wert und laufen durch mergeOptions', () => {
  assert.equal(parseArgs(['--minSalvo=1', '--maxSalvo=3']).options.minSalvo, 1);
  assert.equal(parseArgs(['--decoyCount=0']).options.decoyCount, 0);
  // Dieselbe Klammer wie in der Lobby: 99 wird auf 6 gedeckelt, max auf min gezogen.
  const o = parseArgs(['--minSalvo=99', '--maxSalvo=1']).options;
  assert.equal(o.minSalvo, 6);
  assert.equal(o.maxSalvo, 6);
});

test('Seed ist einstellbar', () => {
  assert.equal(parseArgs(['--seed=7']).seed, 7);
  assert.equal(parseArgs([]).seed, 20260903, 'sonst reproduzierbar fest');
});

test('Unbekannte und unvollständige Argumente werden abgewiesen', () => {
  assert.throws(() => parseArgs(['--quatsch']), /Unbekannte Option/);
  assert.throws(() => parseArgs(['--minSalvo']), /braucht einen Wert/);
  assert.throws(() => parseArgs(['--minSalvo=viel']), /keine Zahl/);
  assert.throws(() => parseArgs(['--seed=x']), /--seed/);
  assert.throws(() => parseArgs(['hallo']), /Unbekanntes Argument/);
});

test('changedOptions zeigt genau die Abweichungen', () => {
  const c = parseArgs(['--singleShotAfterHit', '--decoyCount=0']);
  assert.deepEqual(changedOptions(c.options).sort(), ['decoyCount=0', 'singleShotAfterHit=true']);
});
