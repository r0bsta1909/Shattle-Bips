# Shattle Bips — Einstieg für jede Session

Seeschlacht-Redesign, Browser, Node. **Kein Build-Schritt, kein Framework, keine Datenbank.**
Live: <https://shattle-bips.onrender.com> · Repo: `r0bsta1909/Shattle-Bips` (public)

> **Lies zuerst:** dieses Dokument, dann [docs/LEARNINGS.md](docs/LEARNINGS.md) (Fallen, die
> schon Zeit gekostet haben). [docs/SESSIONS.md](docs/SESSIONS.md) ist das Logbuch — dort steht,
> was zuletzt passiert ist und was offen ist. Die Regeln des Spiels stehen in der
> [README.md](README.md), nicht hier.

---

## Stand

Spielbar gegen Bot und online, mobil wie am PC. Was über Standard-Schiffeversenken hinausgeht:
**Köder, Aufklärung, Tauchen, Tauchfahrt, Manöver, Scheinmanöver, Salven-Vorrat** — und der
Satz, aus dem alles folgt: *Das Orakel lügt nie, getäuscht wird über wahre Meldungen.*
Am Partieende zeigt die **Täuschungsbilanz**, was das bewirkt hat.

Was noch fehlt, steht unter „Noch offen" in der [README](README.md) und im Logbuch. Vertagt ist
ein Modus, der **Wiederkehr** erzeugt (Rätsel des Tages); eine **Notizschicht** auf dem
Gegnerraster wurde am 2026-09-04 vom Nutzer **gestrichen**. Für Neues gilt seine Vorgabe:

> Handarbeit, die das System auch erledigen könnte, ist keine Spieltiefe. Hinhören oder
> Hinsehen muss **belohnt** werden.

## Balance ist messbar — vor Regeländerungen simulieren

```bash
node tools/sim.mjs 500 --seed=7            # Standardregelsatz
node tools/sim.mjs 500 --seed=7 --no-diveEnabled   # Wirkung einer Regel isolieren
```

Zielkorridore: **Startvorteil ≤ 53 %**, **Comeback 35–45 %**. Zwei Ergebnisse, die man kennen
sollte, bevor man an der Balance dreht:

- **Tauchen und Manöver *sind* der Catch-up-Mechanismus** — jedes trägt gut vier Prozentpunkte.
- **Naiver Catch-up schadet:** mehr Schüsse für die Verliererseite verkürzt die Partie, und
  kurze Partien gehören dem Führenden. Und **Beweglichkeit hilft dem Gesunden, also dem
  Führenden** — Manöver brauchen unbeschädigte Schiffe.

Der Sim misst den **Bot**. Lernt der Bot eine Fähigkeit nicht, misst man sie auch nicht.

## Woran man zuerst denken sollte

**Der Nutzer spielt und meldet Fehler über den Feedback-Knopf im Spiel.** Sie landen als
GitHub-Issue mit Label `feedback`, samt Programmstand, Commit, Bildschirm und Lobbycode.
Das ist die wichtigste Arbeitsquelle:

```bash
gh issue list --repo r0bsta1909/Shattle-Bips --state open --label feedback
gh issue view <n> --repo r0bsta1909/Shattle-Bips --json body --jq .body
```

Ein Issue ist erst erledigt, wenn: **Ursache benannt → behoben → Regressionstest → Kommentar
im Issue mit Ursache und Fix → geschlossen.** Der Kommentar ist kein Formalismus: der Nutzer
liest dort, *warum* es passiert ist.

## Landkarte

| Datei | Rolle |
|---|---|
| `server/rules.js` | Regel-Engine, rein, ohne Seiteneffekte. **Einzige Wahrheit über Regeln.** Basis für Server, Bot und Sim. `game.log` ist das vollständige Partieprotokoll, `summarize()` liest die Täuschungsbilanz daraus — jede Kennzahl ist eine **Leseart** des Protokolls, gezählt wird während der Partie nichts |
| `server/rooms.js` | Lobbys, Zugtimer, Optionen, Revanche, Bot-Züge, autoritative Zustandsverteilung |
| `server/index.js` | Express (statisch) + WebSocket + `/version` + `/api/feedback` |
| `server/version.js` | Programmstand für die Kopfzeile |
| `server/feedback.js` | Freitext-Feedback, drei Senken, Missbrauchsbremse, Diagnose |
| `server/bot.js` | Probability-Density-Zielwahl, Ködererkennung, Gegnermodell |
| `public/` | Client ohne Build-Schritt. Effekte (Einblendung, Ton) hängen am **Ereignisstrom** (`emit`/`onEvent`) — ein neuer Effekt ist eine Zeile, kein Suchen in Nachrichtenzweigen |
| `tools/sim.mjs` | Headless-Balancing auf derselben Engine, mit denselben Optionen |
| `tools/shot.mjs` | Bildschirmfoto der Spielansicht über Chrome headless — macht Layout prüfbar. Die Seite läuft in einem `<iframe>` exakter Größe, sonst rendert Chrome breiter als das Bild. Schreibt Chrome nichts, **scheitert das Werkzeug laut** statt Erfolg zu melden |
| `test/` | siehe unten |

**Der Server ist autoritativ.** Der Client bekommt nie die gegnerische Flotte — nur sein Brett,
sein Wissen über das Gegnerbrett und die Meldungen des Orakels. Jede Aktion wird serverseitig
gegen die Regeln geprüft. Client-Prüfungen sind Bequemlichkeit, keine Sicherheit.

## Handgriffe

```bash
npm ci
npm start                 # http://localhost:3000
npm test                  # alle Unittests
npm run e2e               # Partie gegen den Bot über WebSocket
npm run e2e:lobby         # zwei Clients
npm run e2e:options       # Optionen, Zug-Timeout, Revanche
npm run e2e:feedback      # /version und /api/feedback über echtes HTTP
node tools/sim.mjs 800 --singleShotAfterHit    # Balancing mit Lobby-Optionen
node tools/shot.mjs 1440x900                   # Layout ansehen, ohne zu spielen
node tools/shot.mjs 390x844 maneuver            # hochkant, mit offenem Manöverfeld
node tools/shot.mjs 390x844 lobby               # Lobby mit aufgeklappten Einstellungen
node tools/shot.mjs 390x844 placement           # Aufstellung
```

**Vor jedem Push:** `npm test` **und** alle vier e2e-Suiten. Sie sind schnell und haben in
diesem Projekt schon mehrfach Regressionen gefangen, die im Browser erst der Nutzer bemerkt hätte.

Deploy läuft automatisch bei Push auf `main` (Render, Free-Plan). Danach prüfen:

```bash
curl -s https://shattle-bips.onrender.com/version              # Commit muss passen
curl -s https://shattle-bips.onrender.com/api/feedback/status   # Feedback-Weg intakt?
```

## Testschichten — und was jede fängt

| Datei | Fängt |
|---|---|
| `test/rules.test.js` | Regeln und Optionen, rein funktional |
| `test/sim.test.js` | Sim-Kommandozeile |
| `test/feedback.test.js` | Validierung, Bremsen, Memory-Senke |
| `test/github-sink.test.js` | GitHub-Senke gegen lokalen API-Nachbau, Diagnose |
| `test/client.test.js` | **statische Kopplung Client ↔ Markup ↔ Regeln.** Kein Build, keine Typen — hier fällt auf, was sonst erst im Browser auffällt. Auch: jede Standard-Sonderregel muss in „Regeln in 90 Sekunden" stehen |
| `test/client-render.test.js` | **führt `app.js` wirklich aus**, in einem selbstgeschriebenen Mini-DOM, angetrieben über `ws.onmessage`. Fängt Rendering-Fehler, die statisch unsichtbar sind. Ist der Prüfstand schwächer als der Browser, wird **er** repariert, nicht der Test |
| `test/playtest-bugs.test.js` | **jede Fehlermeldung aus dem Playtest, mit Issue-Nummer.** Neue Meldung ⇒ neuer Test hier |
| `test/e2e-*.mjs` | echte WebSocket-/HTTP-Wege gegen den laufenden Server |

Regressionstest-Regel: **gegen den kaputten Stand gegenprüfen.** Ein Test, der den Bug nicht
reproduziert, ist wertlos. Fehler kurz wieder einbauen, Test muss fallen, dann zurücknehmen.

---

## Pflicht am Ende jedes Arbeitsschritts

Das Kontextfenster ist endlich, und ein automatischer Compact verliert Zwischenwissen.
**Deshalb nicht bis Sessionende warten** — nach jedem abgeschlossenen Schritt (Fix gepusht,
Issue geschlossen, Erkenntnis gewonnen):

1. **`docs/SESSIONS.md`** — Eintrag oben ergänzen: Datum, was geändert, was gelernt, was offen.
   Kurz. Zwei bis fünf Zeilen.
2. **`docs/LEARNINGS.md`** — nur bei echten Fallen: etwas, das Zeit gekostet hat und wieder
   passieren kann. Mit **Ursache** und **Regel**, nicht nur „war kaputt".
3. **`CLAUDE.md`** — nur wenn sich Struktur, Befehle oder Einstiegspunkte geändert haben.
4. **Commit-Nachricht** — sie ist das dritte Gedächtnis. Ursache, Fix, und warum die Tests es
   nicht gefangen haben. Die Commits in diesem Repo sind absichtlich lang; das hat sich bezahlt.

Diese vier sind die Übergabe an die nächste Session. Wenn davon nur eines gepflegt wird,
dann `docs/SESSIONS.md`.

## Was hier nicht angetastet wird

- **`localStorage`-Schlüssel `nebel.*`** (`token`, `code`, `name`, `ton`). Heißen absichtlich
  noch so: umbenennen kostet laufende Sitzungen ihr Token. Sie sind nicht sichtbar.
- **`GITHUB_TOKEN`** steht nur in Renders Environment, nie im Repo. In `render.yaml` ist die
  Variable als `sync: false` deklariert.
- **`update/` und `nebel/`** sind Update-Lieferordner und in `.gitignore` — nie committen,
  sie verdoppeln das ganze Projekt.
