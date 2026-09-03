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

async function toGithub(text, meta) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.FEEDBACK_REPO || process.env.RENDER_GIT_REPO_SLUG;
  if (!token) return { ok: false, error: 'Feedback ist auf diesem Server nicht eingerichtet.', detail: 'GITHUB_TOKEN fehlt' };
  if (!repo) return { ok: false, error: 'Feedback ist auf diesem Server nicht eingerichtet.', detail: 'FEEDBACK_REPO fehlt' };

  // Ueberschreibbar fuer Tests und GitHub Enterprise.
  const api = (process.env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/$/, '');
  const body = `${text}\n\n---\n${contextBlock(meta)}`;
  const res = await fetch(`${api}/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'nebel-feedback',      // ohne UA antwortet GitHub mit 403
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ title: `[Feedback] ${titleFor(text)}`, body, labels: ['feedback'] }),
    signal: AbortSignal.timeout(8000)
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false, error: 'Konnte gerade nicht abgeschickt werden.', detail: `GitHub ${res.status}: ${detail.slice(0, 300)}` };
  }
  const issue = await res.json();
  return { ok: true, ref: `#${issue.number}`, url: issue.html_url };
}

async function toWebhook(text, meta) {
  const url = process.env.FEEDBACK_WEBHOOK_URL;
  if (!url) return { ok: false, error: 'Feedback ist auf diesem Server nicht eingerichtet.', detail: 'FEEDBACK_WEBHOOK_URL fehlt' };

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
    return { ok: false, error: 'Konnte gerade nicht abgeschickt werden.', detail: `Webhook ${res.status}: ${detail.slice(0, 300)}` };
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
  try {
    if (sink === 'github') return await toGithub(v.text, meta);
    if (sink === 'webhook') return await toWebhook(v.text, meta);
    return toMemory(v.text, meta);
  } catch (err) {
    return { ok: false, error: 'Konnte gerade nicht abgeschickt werden.', detail: String(err && err.message || err) };
  }
}

export function feedbackStatus() {
  return { sink: sinkName(), version: VERSION.label };
}
