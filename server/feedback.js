// NEBEL – Freitext-Feedback aus dem Spiel heraus.
//
// Drei Senken, per Umgebungsvariable gewaehlt. Der Client kennt keine davon und
// bekommt auch keine Fehlerdetails: er postet an den eigenen Server, fertig.
//
//   FEEDBACK_SINK=github   -> legt ein GitHub-Issue an (Standard, wenn ein Token da ist)
//     GITHUB_TOKEN         Fine-grained PAT, Repo-Rechte "Issues: Read and write"
//     FEEDBACK_REPO        "user/repo" (Standard: RENDER_GIT_REPO_SLUG)
//
//   FEEDBACK_SINK=webhook  -> POST an einen Discord-/Slack-Webhook
//     FEEDBACK_WEBHOOK_URL
//
//   FEEDBACK_SINK=memory   -> Ringpuffer im Prozess + Logzeile (Standard ohne Token)
//     Auslesbar ueber GET /api/feedback mit FEEDBACK_ADMIN_TOKEN.
//     Achtung: geht bei jedem Neustart und jedem Deploy verloren.

import { VERSION } from './version.js';

export const MAX_TEXT = 4000;
const MIN_TEXT = 3;
const MAX_TITLE = 70;

// Ein oeffentlicher Endpunkt, der bei GitHub schreibt, ist ein Missbrauchsziel.
// Deshalb zwei Bremsen: pro Absender und global.
const PER_IP_LIMIT = 5;
const GLOBAL_LIMIT = 60;
const WINDOW_MS = 60 * 60_000;

const MEMORY_MAX = 200;

const hits = new Map();       // ip -> Zeitstempel[]
let globalHits = [];
const memory = [];            // juengste zuerst
let counter = 0;
let lastError = null;         // letzter Fehlschlag, fuer die Diagnose

function prune(list, cutoff) {
  let i = 0;
  while (i < list.length && list[i] < cutoff) i++;
  return i ? list.slice(i) : list;
}

/** Sichtbar fuer Tests: Zaehler zuruecksetzen. */
export function resetLimits() {
  hits.clear();
  globalHits = [];
  memory.length = 0;
  counter = 0;
  lastError = null;
}

export function checkLimit(ip, now = Date.now()) {
  const cutoff = now - WINDOW_MS;

  globalHits = prune(globalHits, cutoff);
  if (globalHits.length >= GLOBAL_LIMIT) {
    return { ok: false, status: 429, error: 'Gerade kommt viel Feedback herein. Bitte später noch einmal.' };
  }

  const key = ip || 'unbekannt';
  const mine = prune(hits.get(key) || [], cutoff);
  if (mine.length >= PER_IP_LIMIT) {
    hits.set(key, mine);
    return { ok: false, status: 429, error: 'Danke – für den Moment reicht es. Bitte in einer Stunde noch einmal.' };
  }

  mine.push(now);
  hits.set(key, mine);
  globalHits.push(now);
  return { ok: true };
}

/** Ablaufende Eintraege wegraeumen, damit die Map nicht unbegrenzt waechst. */
export function sweepLimits(now = Date.now()) {
  const cutoff = now - WINDOW_MS;
  for (const [ip, list] of hits) {
    const kept = prune(list, cutoff);
    if (kept.length) hits.set(ip, kept);
    else hits.delete(ip);
  }
  globalHits = prune(globalHits, cutoff);
}

export function validate(text) {
  if (typeof text !== 'string') return { ok: false, error: 'Kein Text übermittelt.' };
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (clean.length < MIN_TEXT) return { ok: false, error: 'Bitte ein paar Worte mehr.' };
  if (clean.length > MAX_TEXT) return { ok: false, error: `Bitte auf ${MAX_TEXT} Zeichen kürzen.` };
  return { ok: true, text: clean };
}

/** Erste Zeile als Titel – einzeilig, gekuerzt, nie leer. */
export function titleFor(text) {
  const first = text.split('\n').find((l) => l.trim()) || text;
  const flat = first.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_TITLE ? `${flat.slice(0, MAX_TITLE - 1)}…` : flat;
}

function contextBlock(meta = {}) {
  const rows = [
    ['Version', VERSION.label],
    ['Commit', VERSION.short || '—'],
    ['Bildschirm', meta.screen],
    ['Lobby', meta.code],
    ['Regelsatz', meta.options],
    ['Browser', meta.ua],
    ['Zeitpunkt', new Date().toISOString()]
  ];
  return rows
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `- **${k}:** ${String(v).replace(/\s+/g, ' ').slice(0, 300)}`)
    .join('\n');
}

function sinkName() {
  const explicit = (process.env.FEEDBACK_SINK || '').trim().toLowerCase();
  if (explicit) return explicit;
  if (process.env.GITHUB_TOKEN) return 'github';
  if (process.env.FEEDBACK_WEBHOOK_URL) return 'webhook';
  return 'memory';
}

const CONFIG_HINT = 'Feedback ist auf diesem Server nicht richtig eingerichtet.';
/** Ursachen, die eine Einrichtung verlangen – keine voruebergehenden Stoerungen. */
const CONFIG_REASONS = new Set(['no-token', 'no-repo', 'no-webhook', 'auth', 'forbidden', 'not-found', 'rejected', 'issues-disabled']);
const TRANSIENT_HINT = 'GitHub antwortet gerade nicht. Bitte später noch einmal.';

export function githubTarget() {
  return {
    token: process.env.GITHUB_TOKEN || null,
    repo: process.env.FEEDBACK_REPO || process.env.RENDER_GIT_REPO_SLUG || null,
    // Ueberschreibbar fuer Tests und GitHub Enterprise.
    api: (process.env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/$/, '')
  };
}

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'nebel-feedback',      // ohne UA antwortet GitHub mit 403
    'Content-Type': 'application/json'
  };
}

/**
 * Ordnet einen GitHub-Statuscode einer Ursache zu.
 * 401 = Token ungueltig, 403 = Token hat das Recht nicht, 404 = Repo-Pfad falsch
 * (GitHub antwortet auf fehlende Berechtigung teils mit 404 statt 403).
 */
function classify(status) {
  if (status === 401) return { reason: 'auth', config: true };
  if (status === 403) return { reason: 'forbidden', config: true };
  if (status === 404) return { reason: 'not-found', config: true };
  if (status === 422) return { reason: 'rejected', config: true };
  if (status >= 500) return { reason: 'github-down', config: false };
  return { reason: `http-${status}`, config: false };
}

async function toGithub(text, meta) {
  const { token, repo, api } = githubTarget();
  if (!token) return { ok: false, error: CONFIG_HINT, reason: 'no-token', detail: 'GITHUB_TOKEN fehlt' };
  if (!repo) return { ok: false, error: CONFIG_HINT, reason: 'no-repo', detail: 'FEEDBACK_REPO und RENDER_GIT_REPO_SLUG fehlen' };

  const body = `${text}\n\n---\n${contextBlock(meta)}`;
  const res = await fetch(`${api}/repos/${repo}/issues`, {
    method: 'POST',
    headers: ghHeaders(token),
    body: JSON.stringify({ title: `[Feedback] ${titleFor(text)}`, body, labels: ['feedback'] }),
    signal: AbortSignal.timeout(8000)
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    const { reason, config } = classify(res.status);
    return {
      ok: false,
      error: config ? CONFIG_HINT : TRANSIENT_HINT,
      reason,
      detail: `GitHub ${res.status} auf ${repo}: ${raw.slice(0, 300)}`
    };
  }
  const issue = await res.json();
  return { ok: true, ref: `#${issue.number}`, url: issue.html_url };
}

// ------------------------------------------------------------------ Diagnose
// Lesende Vorabpruefung. Beantwortet ohne Schreibzugriff und ohne Logsuche,
// warum die GitHub-Senke nicht laeuft.
export async function diagnose() {
  const sink = sinkName();
  if (sink !== 'github') return { sink, ok: true, reason: 'ok' };

  const { token, repo, api } = githubTarget();
  if (!token) return { sink, ok: false, reason: 'no-token' };
  if (!repo) return { sink, ok: false, reason: 'no-repo' };

  try {
    const meta = await fetch(`${api}/repos/${repo}`, {
      headers: ghHeaders(token),
      signal: AbortSignal.timeout(8000)
    });
    if (!meta.ok) return { sink, ok: false, repo, status: meta.status, ...classify(meta.status) };

    const info = await meta.json().catch(() => ({}));
    if (info.has_issues === false) return { sink, ok: false, repo, reason: 'issues-disabled' };

    const issues = await fetch(`${api}/repos/${repo}/issues?per_page=1`, {
      headers: ghHeaders(token),
      signal: AbortSignal.timeout(8000)
    });
    if (!issues.ok) return { sink, ok: false, repo, status: issues.status, ...classify(issues.status) };

    // Ab hier ist bewiesen: Token gueltig, Repo sichtbar, Issues lesbar.
    //
    // Nicht bewiesen ist das Schreibrecht. Ein fein granulierter Token kann
    // "Issues: Read-only" haben - dann geht jede Leseprobe durch und erst das
    // Anlegen scheitert mit 403. Eine Vorabpruefung ohne Schreibzugriff gibt es
    // dafuer nicht: GitHub kennt keinen Trockenlauf fuer POST /issues.
    //
    // Deshalb zaehlt hier der letzte echte Schreibversuch mehr als die Leseprobe.
    // Ohne diesen Vorrang meldete die Diagnose "ok", waehrend der Knopf im
    // Browser weiter scheiterte - genau der Fall, der sie ueberfluessig macht.
    if (lastError && CONFIG_REASONS.has(lastError.reason)) {
      return {
        sink, ok: false, repo,
        reason: lastError.reason,
        reads: true,               // Lesen geht, nur das Schreiben nicht
        since: lastError.at,
        permissions: info.permissions || null
      };
    }

    return {
      sink, ok: true, reason: 'ok', repo,
      private: !!info.private,
      writeUnproven: true,
      permissions: info.permissions || null
    };
  } catch (err) {
    return { sink, ok: false, repo, reason: 'unreachable', detail: String(err && err.message || err) };
  }
}

/** Klartext fuer das Serverlog beim Start. */
export function explain(d) {
  switch (d.reason) {
    case 'ok': return `Feedback-Senke ${d.sink} einsatzbereit${d.repo ? ` (${d.repo}${d.private ? ', privat' : ''})` : ''}.`
      + (d.writeUnproven ? ' Lesen ist geprueft; ob der Token Issues anlegen darf, zeigt erst die erste Meldung.' : '');
    case 'no-token': return 'Feedback-Senke github gewaehlt, aber GITHUB_TOKEN ist nicht gesetzt.';
    case 'no-repo': return 'Feedback-Senke github gewaehlt, aber weder FEEDBACK_REPO noch RENDER_GIT_REPO_SLUG ist gesetzt.';
    case 'auth': return `GITHUB_TOKEN wird von GitHub abgelehnt (401). Token abgelaufen, widerrufen oder mit Leerzeichen/Anfuehrungszeichen eingefuegt?`;
    case 'forbidden': return d.reads
      ? [
          `Der Token darf ${d.repo} lesen, aber keine Issues anlegen (403). Drei haeufige Ursachen:`,
          '1. "Repository access" steht auf "Public Repositories (read-only)". In diesem Modus ist jeder',
          '   Zugriff lesend und die Repository-Rechte lassen sich nicht setzen. Noetig: "Only select',
          '   repositories" und das Repo auswaehlen - erst danach wird der Rechte-Abschnitt bedienbar.',
          '2. Das Recht heisst "Issues" (Repository permissions), nicht "Issue Types" (Organization',
          '   permissions). Letzteres regelt nur eigene Issue-Typen und hilft hier nicht.',
          '3. "Issues" steht auf Read-only statt auf Read and write.'
        ].join('\n')
      : `GITHUB_TOKEN darf auf ${d.repo} nicht zugreifen (403). Fehlt dem Token das Recht "Issues: Read and write"?`;
    case 'not-found': return `${d.repo} ist fuer diesen Token nicht sichtbar (404). Stimmt der Repo-Pfad, und ist das Repo in der Tokenkonfiguration ausgewaehlt?`;
    case 'issues-disabled': return `Issues sind fuer ${d.repo} abgeschaltet.`;
    case 'unreachable': return `GitHub ist vom Server aus nicht erreichbar: ${d.detail}`;
    default: return `Feedback-Senke ${d.sink}: ${d.reason}${d.status ? ` (HTTP ${d.status})` : ''}`;
  }
}

async function toWebhook(text, meta) {
  const url = process.env.FEEDBACK_WEBHOOK_URL;
  if (!url) return { ok: false, error: CONFIG_HINT, reason: 'no-webhook', detail: 'FEEDBACK_WEBHOOK_URL fehlt' };

  const payload = `**NEBEL-Feedback** (${VERSION.label})\n\n${text}\n\n${contextBlock(meta)}`;
  // "content" ist Discord, "text" ist Slack – beide ignorieren das jeweils andere Feld.
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: payload.slice(0, 1900), text: payload.slice(0, 1900) }),
    signal: AbortSignal.timeout(8000)
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const { reason, config } = classify(res.status);
    return { ok: false, error: config ? CONFIG_HINT : TRANSIENT_HINT, reason, detail: `Webhook ${res.status}: ${detail.slice(0, 300)}` };
  }
  return { ok: true };
}

function toMemory(text, meta) {
  const entry = {
    id: ++counter,
    at: new Date().toISOString(),
    version: VERSION.label,
    text,
    meta
  };
  memory.unshift(entry);
  if (memory.length > MEMORY_MAX) memory.length = MEMORY_MAX;
  console.log(`[feedback #${entry.id}] ${VERSION.label} – ${titleFor(text)}`);
  return { ok: true, ref: `#${entry.id}` };
}

export function readMemory() {
  return memory.slice();
}

/**
 * Nimmt Feedback entgegen. Liefert nie Interna an den Aufrufer weiter –
 * `detail` ist ausschliesslich fuer das Serverlog gedacht.
 */
export async function submitFeedback({ text, meta = {}, ip } = {}) {
  const v = validate(text);
  if (!v.ok) return v;

  const limit = checkLimit(ip);
  if (!limit.ok) return limit;

  const sink = sinkName();
  let r;
  try {
    if (sink === 'github') r = await toGithub(v.text, meta);
    else if (sink === 'webhook') r = await toWebhook(v.text, meta);
    else r = toMemory(v.text, meta);
  } catch (err) {
    r = { ok: false, error: TRANSIENT_HINT, reason: 'threw', detail: String(err && err.message || err) };
  }
  // Erfolg loescht den gemerkten Fehlschlag. Ohne das bliebe eine behobene
  // Fehlkonfiguration bis zum naechsten Neustart als "kaputt" stehen, weil
  // diagnose() dem letzten Schreibversuch Vorrang vor der Leseprobe gibt.
  if (r.ok) lastError = null;
  else lastError = { at: new Date().toISOString(), reason: r.reason || 'unknown', detail: r.detail || null };
  return r;
}

export function feedbackStatus() {
  return { sink: sinkName(), version: VERSION.label, lastError };
}
