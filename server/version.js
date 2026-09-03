// NEBEL – Versionsauskunft. Einmal beim Start aufgeloest, danach konstant.
//
// Die Build-Nummer leitet sich aus dem Zeitpunkt des Commits ab: bYYMMDD.HHMM
// in UTC. Sie waechst mit jedem Commit, ist ueberall gleich aufgebaut und
// laesst sich zwischen zwei Staenden direkt vergleichen.
//
// Warum nicht die Commit-Anzahl (`git rev-list --count HEAD`)? Die stand hier
// zuerst, funktioniert lokal (b5) und ist auf Render trotzdem unbrauchbar:
// Render klont mit --depth 1, die Zaehlung ergibt dort immer 1. Der Kopf haette
// also dauerhaft "b1" gezeigt, egal wie oft deployt wird - genau das Gegenteil
// einer fortlaufenden Nummer. Der Zeitstempel des Commits liegt dagegen auch im
// flachen Klon vollstaendig vor.
//
// Quellenreihenfolge:
//   1. APP_BUILD / APP_COMMIT  – explizit gesetzt (render.yaml, CI)
//   2. git im Arbeitsverzeichnis – lokal wie auf Render
//   3. RENDER_GIT_COMMIT       – Renders eingebaute Variable, immer vorhanden
// Faellt alles aus, bleibt die Semver-Nummer aus der package.json.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(args) {
  try {
    const out = execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return out.trim() || null;
  } catch {
    return null; // kein git, kein Repo, kein Problem
  }
}

function readPkgVersion() {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** ISO-Zeitpunkt -> "260903.1106" (UTC, damit der Wert ortsunabhaengig ist). */
export function buildStamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`
    + `.${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

function resolve() {
  const version = readPkgVersion();

  const commit =
    process.env.APP_COMMIT ||
    process.env.RENDER_GIT_COMMIT ||
    git(['rev-parse', 'HEAD']) ||
    null;
  const short = commit ? commit.slice(0, 7) : null;

  const committedAt = git(['show', '-s', '--format=%cI', 'HEAD']);
  const build = (process.env.APP_BUILD || '').trim() || (committedAt ? buildStamp(committedAt) : null);

  // Nur als Zusatzinfo in /version – im flachen Klon ist der Wert wertlos,
  // deshalb steht er bewusst nicht im Label.
  const shallow = git(['rev-parse', '--is-shallow-repository']) === 'true';
  const commitCount = shallow ? null : Number(git(['rev-list', '--count', 'HEAD'])) || null;

  // Was im Kopf steht: "v0.4.0 · b260903.1106".
  let label = `v${version}`;
  if (build) label += ` · b${build}`;
  else if (short) label += ` · ${short}`;

  return Object.freeze({ version, build, commit, short, committedAt, commitCount, shallow, label });
}

export const VERSION = resolve();
