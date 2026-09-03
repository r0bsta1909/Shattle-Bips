// Shattle Bips – GitHub-Senke gegen einen lokalen Nachbau der API.
// Prueft die Form der Anfrage, nicht GitHub selbst: Header, Titel, Kontextblock,
// und dass Fehlerdetails im Log bleiben statt beim Absender zu landen.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { submitFeedback, resetLimits, diagnose, explain, feedbackStatus } from '../server/feedback.js';

/** Startet einen Server, der jede Anfrage aufzeichnet und `reply` zurückgibt. */
async function withFakeGithub(reply, fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.writeHead(reply.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const saved = { ...process.env };
  process.env.FEEDBACK_SINK = 'github';
  process.env.GITHUB_TOKEN = 'ghp_testtoken';
  process.env.FEEDBACK_REPO = 'r0bsta1909/Shattle-Bips';
  process.env.GITHUB_API_BASE = base;
  resetLimits();

  try {
    return await fn(seen);
  } finally {
    await new Promise((r) => server.close(r));
    for (const k of ['FEEDBACK_SINK', 'GITHUB_TOKEN', 'FEEDBACK_REPO', 'GITHUB_API_BASE']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    process.env.FEEDBACK_SINK = 'memory';
  }
}

test('GitHub-Senke: Anfrage hat die richtige Form', async () => {
  await withFakeGithub(
    { status: 201, body: { number: 42, html_url: 'https://github.com/x/y/issues/42' } },
    async (seen) => {
      const r = await submitFeedback({
        text: 'Tauchen war unklar.\nZweite Zeile mit Details.',
        ip: '1.1.1.1',
        meta: { screen: 'screen-game', code: 'AB12', ua: 'TestBrowser/1.0' }
      });

      assert.equal(r.ok, true);
      assert.equal(r.ref, '#42');
      assert.equal(r.url, 'https://github.com/x/y/issues/42');

      assert.equal(seen.length, 1);
      const req = seen[0];
      assert.equal(req.method, 'POST');
      assert.equal(req.url, '/repos/r0bsta1909/Shattle-Bips/issues');
      assert.equal(req.headers.authorization, 'Bearer ghp_testtoken');
      assert.equal(req.headers.accept, 'application/vnd.github+json');
      assert.equal(req.headers['x-github-api-version'], '2022-11-28');
      assert.ok(req.headers['user-agent'], 'User-Agent gesetzt – ohne den antwortet GitHub 403');

      const sent = JSON.parse(req.body);
      assert.equal(sent.title, '[Feedback] Tauchen war unklar.');
      assert.ok(sent.body.startsWith('Tauchen war unklar.'), 'Freitext steht oben');
      assert.match(sent.body, /\*\*Version:\*\*/);
      assert.match(sent.body, /\*\*Bildschirm:\*\* screen-game/);
      assert.match(sent.body, /\*\*Lobby:\*\* AB12/);
      assert.match(sent.body, /\*\*Browser:\*\* TestBrowser\/1\.0/);
      assert.deepEqual(sent.labels, ['feedback']);
    }
  );
});

test('GitHub-Senke: Fehler bleibt im Log, nicht in der Antwort', async () => {
  await withFakeGithub(
    { status: 401, body: { message: 'Bad credentials' } },
    async () => {
      const r = await submitFeedback({ text: 'Irgendein Hinweis', ip: '2.2.2.2' });
      assert.equal(r.ok, false);
      // 401 ist ein Einrichtungsfehler – der Absender erfaehrt das, aber ohne Interna.
      assert.equal(r.error, 'Feedback ist auf diesem Server nicht richtig eingerichtet.');
      assert.match(r.detail, /GitHub 401/, 'Detail fürs Log vorhanden');
      assert.ok(!r.error.includes('401'), 'Statuscode nicht an den Absender');
      assert.ok(!r.error.includes('credentials'), 'GitHub-Meldung nicht an den Absender');
      assert.ok(!r.error.includes('ghp_'), 'niemals der Token');
    }
  );
});

test('GitHub-Senke: leere Metadaten erzeugen keine leeren Zeilen', async () => {
  await withFakeGithub(
    { status: 201, body: { number: 7, html_url: 'u' } },
    async (seen) => {
      await submitFeedback({ text: 'Nur Text, kein Kontext.', ip: '3.3.3.3', meta: {} });
      const sent = JSON.parse(seen[0].body);
      assert.ok(!sent.body.includes('**Lobby:**'), 'fehlende Felder fallen weg');
      assert.ok(!/- \*\*\w+:\*\*\s*$/m.test(sent.body), 'keine Zeile ohne Wert');
      assert.match(sent.body, /\*\*Version:\*\*/, 'Version steht immer drin');
    }
  );
});

// ------------------------------------------------------------------ Diagnose

/** Nachbau mit Routing: /repos/:slug und /repos/:slug/issues getrennt bedienbar. */
async function withRoutedGithub(routes, fn) {
  const server = http.createServer((req, res) => {
    const hit = Object.keys(routes).find((k) => req.url.startsWith(k));
    const r = hit ? routes[hit] : { status: 404, body: { message: 'Not Found' } };
    res.writeHead(r.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(r.body));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  const saved = { ...process.env };
  process.env.FEEDBACK_SINK = 'github';
  process.env.GITHUB_TOKEN = 'ghp_testtoken';
  process.env.FEEDBACK_REPO = 'u/r';
  process.env.GITHUB_API_BASE = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn();
  } finally {
    await new Promise((r) => server.close(r));
    for (const k of ['FEEDBACK_SINK', 'GITHUB_TOKEN', 'FEEDBACK_REPO', 'GITHUB_API_BASE']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    process.env.FEEDBACK_SINK = 'memory';
  }
}

test('Diagnose: alles in Ordnung', async () => {
  await withRoutedGithub(
    { '/repos/u/r/issues': { status: 200, body: [] }, '/repos/u/r': { status: 200, body: { has_issues: true, private: false } } },
    async () => {
      const d = await diagnose();
      assert.equal(d.ok, true);
      assert.equal(d.reason, 'ok');
      assert.match(explain(d), /einsatzbereit/);
    }
  );
});

test('Diagnose: Repo lesbar, aber Token darf keine Issues', async () => {
  await withRoutedGithub(
    { '/repos/u/r/issues': { status: 403, body: { message: 'Resource not accessible' } }, '/repos/u/r': { status: 200, body: { has_issues: true } } },
    async () => {
      const d = await diagnose();
      assert.equal(d.ok, false);
      assert.equal(d.reason, 'forbidden');
      assert.match(explain(d), /Issues: Read and write/);
    }
  );
});

test('Diagnose: Issues im Repo abgeschaltet', async () => {
  await withRoutedGithub(
    { '/repos/u/r': { status: 200, body: { has_issues: false } } },
    async () => {
      const d = await diagnose();
      assert.equal(d.reason, 'issues-disabled');
      assert.match(explain(d), /abgeschaltet/);
    }
  );
});

test('Diagnose: Token abgelehnt', async () => {
  await withRoutedGithub(
    { '/repos/u/r': { status: 401, body: { message: 'Bad credentials' } } },
    async () => {
      const d = await diagnose();
      assert.equal(d.reason, 'auth');
      assert.match(explain(d), /401/);
    }
  );
});

test('Senkenfehler unterscheidet Konfiguration von Stoerung', async () => {
  // 401 ist ein Einrichtungsfehler ...
  await withFakeGithub({ status: 401, body: {} }, async () => {
    const r = await submitFeedback({ text: 'Hinweis eins', ip: '9.1.1.1' });
    assert.match(r.error, /nicht richtig eingerichtet/);
  });
  // ... 503 dagegen eine voruebergehende Stoerung.
  await withFakeGithub({ status: 503, body: {} }, async () => {
    const r = await submitFeedback({ text: 'Hinweis zwei', ip: '9.2.2.2' });
    assert.match(r.error, /antwortet gerade nicht/);
    assert.equal(r.reason, 'github-down');
  });
});

test('Letzter Fehlschlag wird fuer die Diagnose gemerkt', async () => {
  await withFakeGithub({ status: 401, body: {} }, async () => {
    resetLimits();
    await submitFeedback({ text: 'Wird scheitern', ip: '9.3.3.3' });
    const s = feedbackStatus();
    assert.ok(s.lastError, 'lastError gesetzt');
    assert.equal(s.lastError.reason, 'auth');
    assert.match(s.lastError.detail, /GitHub 401/);
  });
});

test('Diagnose meldet nicht "ok", wenn der letzte Schreibversuch abgelehnt wurde', async () => {
  // Leseproben gehen durch, das Anlegen scheitert mit 403 – genau der Fall
  // "Issues: Read-only". Ohne den Vorrang des echten Schreibversuchs haette
  // die Diagnose hier faelschlich "ok" gemeldet.
  const routes = {
    '/repos/u/r/issues': { status: 200, body: [] },
    '/repos/u/r': { status: 200, body: { has_issues: true } }
  };
  await withRoutedGithub(routes, async () => {
    resetLimits();
    assert.equal((await diagnose()).ok, true, 'ohne Vorgeschichte sieht alles gut aus');
    assert.equal((await diagnose()).writeUnproven, true, 'Schreibrecht bleibt unbewiesen');
  });

  await withFakeGithub({ status: 403, body: { message: 'Resource not accessible by personal access token' } }, async () => {
    resetLimits();
    await submitFeedback({ text: 'Der echte Schreibversuch', ip: '8.8.8.8' });
  });

  await withRoutedGithub(routes, async () => {
    const d = await diagnose();
    assert.equal(d.ok, false, 'der gescheiterte Schreibversuch schlaegt die Leseprobe');
    assert.equal(d.reason, 'forbidden');
    assert.equal(d.reads, true, 'Lesen geht weiterhin');
    assert.match(explain(d), /Read-only/, 'Klartext benennt die Ursache');
  });
  resetLimits();
});

test('Ein erfolgreicher Schreibversuch loescht den gemerkten Fehlschlag', async () => {
  const routes = {
    '/repos/u/r/issues': { status: 200, body: [] },
    '/repos/u/r': { status: 200, body: { has_issues: true } }
  };

  // Erst scheitern lassen ...
  await withFakeGithub({ status: 403, body: { message: 'Resource not accessible' } }, async () => {
    resetLimits();
    await submitFeedback({ text: 'Scheitert zunaechst', ip: '7.1.1.1' });
  });
  await withRoutedGithub(routes, async () => {
    assert.equal((await diagnose()).reason, 'forbidden', 'Fehlschlag ist gemerkt');
  });

  // ... dann die Berechtigung reparieren und erneut senden.
  await withFakeGithub({ status: 201, body: { number: 9, html_url: 'u' } }, async () => {
    const r = await submitFeedback({ text: 'Jetzt klappt es', ip: '7.2.2.2' });
    assert.equal(r.ok, true);
    assert.equal(feedbackStatus().lastError, null, 'Erfolg raeumt den Fehlschlag weg');
  });

  // Ohne das Aufraeumen bliebe die Diagnose bis zum Neustart auf "forbidden".
  await withRoutedGithub(routes, async () => {
    const d = await diagnose();
    assert.equal(d.ok, true, 'Diagnose meldet wieder einsatzbereit');
    assert.equal(d.reason, 'ok');
  });
  resetLimits();
});
