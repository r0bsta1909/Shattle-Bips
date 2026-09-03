// NEBEL – Versionsauskunft. Einmal beim Start aufgeloest, danach konstant.
//
// Die Build-Nummer ist die Anzahl der Commits auf HEAD. Sie waechst mit jedem
// Commit und ist damit die "fortlaufende" Nummer, die im Kopf steht.
// Quellenreihenfolge, damit das ueberall funktioniert:
//   1. APP_BUILD / APP_COMMIT  – explizit gesetzt (render.yaml, CI)
//   2. git im Arbeitsverzeichnis – lokal und auf Render, das den Klon behaelt
//   3. RENDER_GIT_COMMIT       – Renders eingebaute Variable, immer vorhanden
// Faellt alles aus, bleibt die Semver-Nummer aus der package.json uebrig.

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

function resolve() {
  const version = readPkgVersion();

  const envBuild = Number(process.env.APP_BUILD);
  const build = Number.isFinite(envBuild) && envBuild > 0
    ? Math.round(envBuild)
    : Number(git(['rev-list', '--count', 'HEAD'])) || null;

  const commit =
    process.env.APP_COMMIT ||
    process.env.RENDER_GIT_COMMIT ||
    git(['rev-parse', 'HEAD']) ||
    null;

  const short = commit ? commit.slice(0, 7) : null;

  // Was im Kopf steht: "v0.4.0 · b49" – bzw. der Commit, wenn kein Zaehler da ist.
  let label = `v${version}`;
  if (build) label += ` · b${build}`;
  else if (short) label += ` · ${short}`;

  return Object.freeze({ version, build, commit, short, label });
}

export const VERSION = resolve();

/** Eine Zeile fuer Logs und Feedback-Meldungen. */
export function versionLine() {
  const parts = [VERSION.label];
  if (VERSION.build && VERSION.short) parts.push(VERSION.short);
  return parts.join(' · ');
}
