// NEBEL – Feedback: Validierung, Titelbildung, Bremsen, Memory-Senke.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validate, titleFor, checkLimit, sweepLimits, resetLimits,
  submitFeedback, readMemory, feedbackStatus, MAX_TEXT
} from '../server/feedback.js';

test('Validierung: zu kurz, zu lang, kein String', () => {
  assert.equal(validate('').ok, false);
  assert.equal(validate('ok').ok, false);          // 2 Zeichen
  assert.equal(validate(null).ok, false);
  assert.equal(validate(123).ok, false);
  assert.equal(validate('x'.repeat(MAX_TEXT + 1)).ok, false);
  assert.equal(validate('x'.repeat(MAX_TEXT)).ok, true);
});

test('Validierung: trimmt und normalisiert Zeilenenden', () => {
  const v = validate('  Zeile 1\r\nZeile 2  ');
  assert.equal(v.ok, true);
  assert.equal(v.text, 'Zeile 1\nZeile 2');
});

test('Titel: erste nichtleere Zeile, einzeilig, gekürzt', () => {
  assert.equal(titleFor('Kurzer Hinweis'), 'Kurzer Hinweis');
  assert.equal(titleFor('\n\nZweite Zeile zuerst\nnoch was'), 'Zweite Zeile zuerst');
  assert.equal(titleFor('viele   Leer\tzeichen'), 'viele Leer zeichen');
  const long = titleFor('w'.repeat(200));
  assert.ok(long.length <= 70, `Titel zu lang: ${long.length}`);
  assert.ok(long.endsWith('…'));
});

test('Bremse: pro Absender ist bei 5 Schluss', () => {
  resetLimits();
  for (let i = 0; i < 5; i++) assert.equal(checkLimit('1.2.3.4').ok, true, `Versuch ${i + 1}`);
  assert.equal(checkLimit('1.2.3.4').ok, false);
  assert.equal(checkLimit('5.6.7.8').ok, true, 'andere IP bleibt frei');
});

test('Bremse: Fenster läuft ab', () => {
  resetLimits();
  const t0 = Date.now();
  for (let i = 0; i < 5; i++) checkLimit('9.9.9.9', t0);
  assert.equal(checkLimit('9.9.9.9', t0).ok, false);
  assert.equal(checkLimit('9.9.9.9', t0 + 61 * 60_000).ok, true, 'nach einer Stunde wieder frei');
});

test('Bremse: globale Obergrenze greift über alle Absender', () => {
  resetLimits();
  let accepted = 0;
  for (let i = 0; i < 200; i++) if (checkLimit(`10.0.0.${i}`).ok) accepted++;
  assert.equal(accepted, 60, 'global bei 60 gedeckelt');
});

test('sweepLimits räumt abgelaufene Einträge weg', () => {
  resetLimits();
  const t0 = Date.now();
  checkLimit('7.7.7.7', t0);
  sweepLimits(t0 + 61 * 60_000);
  // Nach dem Aufräumen stehen wieder alle fünf Versuche zur Verfügung.
  for (let i = 0; i < 5; i++) assert.equal(checkLimit('7.7.7.7', t0 + 61 * 60_000).ok, true);
});

test('Memory-Senke nimmt an und gibt zurück', async () => {
  resetLimits();
  process.env.FEEDBACK_SINK = 'memory';
  assert.equal(feedbackStatus().sink, 'memory');

  const r = await submitFeedback({ text: 'Der Scan war unklar.', ip: '2.2.2.2', meta: { screen: 'screen-game' } });
  assert.equal(r.ok, true);

  const all = readMemory();
  assert.equal(all.length, 1);
  assert.equal(all[0].text, 'Der Scan war unklar.');
  assert.equal(all[0].meta.screen, 'screen-game');
  assert.ok(all[0].version, 'Version wird mitgeschrieben');
});

test('Abgelehnter Text erreicht die Senke nicht', async () => {
  resetLimits();
  process.env.FEEDBACK_SINK = 'memory';
  const r = await submitFeedback({ text: 'ne', ip: '3.3.3.3' });
  assert.equal(r.ok, false);
  assert.equal(readMemory().length, 0);
});

test('Fehlende Konfiguration meldet einen Fehler statt zu werfen', async () => {
  resetLimits();
  process.env.FEEDBACK_SINK = 'github';
  const token = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  try {
    const r = await submitFeedback({ text: 'Test ohne Token', ip: '4.4.4.4' });
    assert.equal(r.ok, false);
    assert.ok(r.error, 'Nutzertext vorhanden');
    assert.ok(r.detail, 'Detail nur fürs Log');
    assert.ok(!r.error.includes('GITHUB_TOKEN'), 'Interna nicht an den Client');
  } finally {
    if (token) process.env.GITHUB_TOKEN = token;
    process.env.FEEDBACK_SINK = 'memory';
  }
});
