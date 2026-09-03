# Shattle Bips

Ein Redesign von *Schiffe versenken* für 14–99: Salve statt Einzelschuss, zwei Köder, die
sich als Schiffe ausgeben, ein U-Boot, das ausweicht, ein Träger, der aufklärt — und die
Möglichkeit, statt zu feuern die eigene Flotte zu verschieben.

Online-Duell im Browser oder gegen den Bot. Kein Build-Schritt, kein Framework, keine Datenbank.

**Am Code arbeiten?** [CLAUDE.md](CLAUDE.md) ist der Einstieg (Landkarte, Befehle, Testschichten),
[docs/LEARNINGS.md](docs/LEARNINGS.md) sammelt die Fallen, [docs/SESSIONS.md](docs/SESSIONS.md)
ist das Logbuch mit dem letzten Stand und den offenen Punkten. Diese README beschreibt das
**Spiel**, nicht die Entwicklung.

---

## Warum das Ganze

Das Original ist nach fünf Partien durchschaut: Spieleragency endet mit der Aufstellung, der
Rest ist eine gelöste Suchaufgabe. Shattle Bips setzt drei Effekte dagegen, die nach dem Aufstellen
weiterlaufen:

- **Antizipation** — der Gegner sendet Signale („Flotte manövriert", „U-Boot ausgewichen"), die du lesen musst.
- **Adaption** — Verluste ändern deine Möglichkeiten: Salvengröße, Aufklärung, Tauchen sterben mit den Schiffen.
- **Bluff** — du darfst manövrieren und tauchen, ohne dass Not besteht. Das Orakel lügt nie; getäuscht wird über wahre Meldungen.

---

## Regeln

**Flotte (17 Felder):** Träger 5 · Schlachtschiff 4 · Kreuzer 3 · U-Boot 3 · Zerstörer 2.
**Köder:** 2 Stück à **2 Feldern**. Nichts darf sich berühren, auch nicht diagonal.

**Salve:** So viele Schüsse wie du Schiffe hast — **mindestens 2, höchstens 4**.

| Schiffe übrig | 5 | 4 | 3 | 2 | 1 |
|---|---|---|---|---|---|
| Schüsse | 4 | 4 | 3 | 2 | 2 |

**Eröffnungsausgleich:** Der Startspieler hat in seinem ersten Zug nur 1 Schuss.

**Orakel:** Wasser · Treffer · Versenkt (mit Schiffstyp). Immer wahrheitsgemäß.

**Köder** melden „Treffer", werden aber nie versenkt. Da sie zwei Felder lang sind, sind sie
von einem Zerstörer nicht zu unterscheiden — bis der Trefferblock rundum von Wasser
umschlossen ist.

**Manöver:** Statt einer Salve ein **unbeschädigtes** Schiff um 1 Feld versetzen oder um 90°
drehen. Zielfelder müssen frei, berührungsfrei und **noch nie beschossen** sein. Der Gegner
hört nur „Flotte manövriert" — ohne Ort. Beschädigte Schiffe sind fixiert.

**Aufklärung** (Träger lebt): Ein Schuss der Salve wird zu einem 3×3-Scan. Antwort ist nur
die **Anzahl** belegter Felder. Köder zählen nicht mit. Ein Scan pro Zug.

**Tauchen** (U-Boot unbeschädigt, nicht zwei Züge in Folge): kostet einen Schuss. Treffer auf
das U-Boot melden „Wasser". Danach erhält der Gegner die Meldung „U-Boot ausgewichen" —
und **alle Wasser-Meldungen dieser Salve werden auf unbekannt zurückgesetzt**. Er weiß also,
dass eine seiner Auskünfte wertlos war, aber nicht welche, und muss die Felder erneut prüfen.

**Sieg:** Wer zuerst alle fünf Schiffe des Gegners versenkt. Köder sind für den Sieg irrelevant.

---

## Lokal starten

```bash
npm ci
npm start          # http://localhost:3000
```

Zwei Browserfenster öffnen, in einem „Lobby erstellen", im anderen den 4-stelligen Code
eingeben. Oder direkt „Gegen Bot spielen".

## Testeinstellungen

In der Lobby stellt der **Host** die Regeln ein, bevor aufgestellt wird. Damit lässt sich jede
Stellschraube im Playtest verschieben, ohne Code anzufassen:

| Einstellung | Standard | Wirkung |
|---|---|---|
| Salve min / max | 2 / 4 | Klammer um „Schüsse = lebende Schiffe" |
| Köder-Anzahl / -Länge | 2 / 2 | 0 Köder = klassisches Spiel; 3×3 = Bluff-Maximum |
| Zugzeit | 60 s | Timeout gibt den Zug ab |
| Eröffnungsausgleich | an | Startspieler hat im ersten Zug 1 Schuss |
| **Nach Treffer nur Einzelschuss** | aus | Jagdmodus: wer im letzten Zug getroffen hat, schießt nur einmal |
| Aufklärung / Tauchen / Manöver | an | einzeln abschaltbar |

Der Jagdmodus ist die Antwort auf den Verdacht, dass eine volle Salve nach einem Treffer zu
stark ist: Suchen bleibt breit, Nachsetzen wird teuer.

Änderungen setzen die Aufstellungen beider Spieler zurück, weil sich die Köderzahl ändern kann.

### Optionen durchsimulieren

`tools/sim.mjs` nimmt dieselben Optionen wie die Lobby und schickt sie durch dasselbe
`mergeOptions()`. Der Sim kann also keinen Regelsatz testen, der im Spiel nicht einstellbar wäre.

```bash
npm run sim -- 800                                # Standard
node tools/sim.mjs 800 --singleShotAfterHit       # Jagdmodus
node tools/sim.mjs 800 --minSalvo=1 --maxSalvo=3  # engere Salve
node tools/sim.mjs 800 --decoyCount=0             # klassisches Spiel
node tools/sim.mjs 800 --no-scanEnabled --seed=7  # ohne Aufklärung, eigener Seed
```

Schalter setzt man mit `--flag`, löscht sie mit `--no-flag`; Zahlen brauchen `--key=wert`.
Der Kopf der Ausgabe nennt den Regelsatz und den Seed. Die Zielkorridore sind für den
**Standardregelsatz** kalibriert und werden bei abweichenden Optionen bewusst nicht gedruckt —
zum Vergleich denselben Seed einmal ohne Optionen laufen lassen.

Erste Ergebnisse über je 300 Partien, Seed 20260903:

| Regelsatz | Startspieler | Sieg nach Erstverlust | Züge Ø |
|---|---|---|---|
| Standard | 49,0 % | 42,3 % | 39,2 |
| `--singleShotAfterHit` | 44,7 % | 43,0 % | 56,9 |
| `--no-openingBalance` | 55,7 % | 34,3 % | 37,4 |
| `--singleShotAfterHit --no-openingBalance` | 52,4 % | 40,2 % | 55,2 |
| `--decoyCount=0` | 48,3 % | 41,7 % | 36,3 |

Zwei Dinge fallen auf. Der Jagdmodus **allein überkorrigiert**: er dreht den Startvorteil in
einen Nachteil (44,7 %), weil er zusätzlich zum Eröffnungsausgleich bremst — die beiden Regeln
sind Substitute, keine Ergänzungen. Zusammen mit abgeschaltetem Eröffnungsausgleich landet er
wieder in beiden Zielkorridoren (52,4 % / 40,2 %). Und er verlängert die Partie um gut 45 %
(39 → 57 Züge), was bei 60 s Zugzeit spürbar ist.

## Tests

```bash
npm test              # 96 Tests (node:test): Regeln, Optionen, Sim-CLI, Feedback, Client-Kopplung, Playtest-Regressionen
npm run e2e           # vollständige Partie gegen den Bot über WebSocket
npm run e2e:lobby     # zwei Clients, Lobby erstellen + beitreten
npm run e2e:options   # Optionen, Zug-Timeout und Revanche
npm run e2e:feedback  # /version und der Feedback-Endpunkt über echtes HTTP
npm run sim -- 800    # Headless-Balancing, Bot gegen Bot
```

## Deploy auf Render

1. Repo auf GitHub pushen.
2. Render → **New → Web Service** → Repo verbinden.
3. Runtime `Node`, Build `npm ci`, Start `node server/index.js`, Plan `Free`.

Alternativ liegt eine `render.yaml` als Blueprint bei.

**Free-Tier-Verhalten:** Der Dienst schläft nach 15 Minuten **ohne eingehenden Traffic** ein.
WebSocket-Nachrichten aus laufenden Partien zählen als Traffic — eine laufende Partie hält den
Server also wach. Der Client sendet zusätzlich alle 5 Minuten einen Ping. Nach dem Einschlafen
dauert der Kaltstart bis zu einer Minute, **und alle offenen Lobbys sind weg** (Zustand liegt
im RAM). Für den Testbetrieb ist das in Ordnung; für ein öffentliches Produkt ist der bezahlte
Tier die ehrliche Antwort.

---

## Architektur

```
server/rules.js    Regel-Engine, rein und ohne Seiteneffekte — Grundlage für Server, Bot und Sim
server/bot.js      Probability-Density-Zielwahl, Ködererkennung, Gegnermodell
server/rooms.js    Lobbys, Zugtimer, Optionen, Revanche, Bot-Züge, autoritative Zustandsverteilung
server/index.js    Express (statisch) + WebSocket + /version + /api/feedback
server/version.js  Programmstand aus package.json, git und den Render-Variablen
server/feedback.js Freitext-Feedback, drei Senken, Missbrauchsbremse
public/            Client ohne Build-Schritt (ES-Module, DOM-Raster)
tools/sim.mjs      Headless-Balancing auf derselben Engine, mit denselben Optionen
test/              Regeltests, Sim-CLI, Feedback, Client-Kopplung, Playtest-Regressionen + vier End-to-End-Tests
```

**Der Server ist autoritativ.** Der Client erhält niemals die gegnerische Flotte — nur sein
eigenes Brett, sein Wissen über das Gegnerbrett und die Meldungen des Orakels. Jede Aktion wird
serverseitig gegen die Regeln geprüft.

---

## Balancing-Stand

Bot gegen Bot auf der echten Engine, 800 Partien (`npm run sim -- 800`):

| Kennzahl | Wert | Ziel |
|---|---|---|
| Startspieler gewinnt | 50,0 % | ≤ 53 % |
| Sieg nach erstem Schiffsverlust | 40,5 % | 35–45 % |
| Schüsse des Siegers | Median 51 | — |
| Züge gesamt | Ø 38,5 | — |

Zum Vergleich: Klassisches Schiffe versenken mit optimalem Bot liegt bei ~42 Schüssen. Shattle Bips
liegt höher, weil Köder, Manöver und Tauchen echte Kosten verursachen.

**Grenze dieser Zahlen:** Der Bot hat nur ein rudimentäres Gegnermodell. Er blufft nach Plan,
aber er *liest* keinen Bluff. Antizipation und Bluff sind damit strukturell untermessen — die
Zahlen sind eine Untergrenze und ersetzen keinen Playtest mit Menschen.

---

## Abweichungen von der Spec v1.0

- **Client-Raster als DOM statt Canvas.** Klick-Handling, Hover-Vorschau und Barrierefreiheit sind ohne Canvas einfacher und robuster.
- **Aufstellung per Klick statt Drag & Drop.** Schiff wählen, Feld klicken, `R` oder Rechtsklick dreht. Weniger Code, auf Touch besser bedienbar.
- **Ein Client-Modul** (`public/js/app.js`) statt fünf. Bei dieser Größe ist die Aufteilung Ballast.
- **Neue Regel: Ausweich-Rücksetzung.** Der Sim deckte auf, dass ein getauchtes U-Boot sonst dauerhaft unversenkbar wird — das betroffene Feld bliebe für immer als Wasser markiert und ~3 % der Partien liefen endlos. Deshalb werden nach einem Ausweichmanöver alle Wasser-Meldungen der Salve zurückgesetzt.
- **Scan und Tauchen senken die Salve auf minimal 1** (nicht 2). Sonst wären beide bei zwei verbliebenen Schiffen kostenlos.
- **Kein Zeitbank-System.** Ein abgelaufener Zug geht an den Gegner. Die Bank hatte den Timer faktisch mehrfach neu gestartet, was wie ein Fehler wirkte statt wie eine Regel. Zwei Timeouts in Folge gelten als Aufgabe — der Endbildschirm sagt das seit dem ersten Playtest auch dazu, vorher sah ein Sieg ohne versenktes Schiff wie ein Fehler aus.
- **Der Server sagt, warum ein Knopf gesperrt ist.** `canScan`/`canDive` reichen dem Client nicht nur ein Ja/Nein, sondern mit `scanBlocked` auch den Grund. Ein gesperrter Knopf ohne Begründung erzeugt sonst genau die Fehlermeldungen, die im Playtest kamen.
- **Die Aufstellung ist gesperrt, sobald der Server sie hat.** Sonst ändert der Client sie weiter, während der Server die alte hält — der Spieler sieht dann eine andere Flotte, als gespielt wird.

## Programmstand und Feedback

Im Kopf steht dauerhaft der Programmstand, z. B. `Shattle Bips v0.4.0 · b260903.1106`. Die Build-Nummer
ist der Zeitpunkt des Commits als `bYYMMDD.HHMM` in UTC — sie wächst mit jedem Commit, ist
überall gleich aufgebaut und lässt zwei Stände direkt vergleichen. Der Server löst sie einmal
beim Start auf: `APP_BUILD` / `APP_COMMIT`, sonst `git`, sonst `RENDER_GIT_COMMIT`. Fällt alles
aus, bleibt die Semver-Nummer aus der `package.json`. Abrufbar unter `/version`.

Hier stand zuerst die Commit-Anzahl (`git rev-list --count HEAD`). Das funktioniert lokal und ist
auf Render trotzdem unbrauchbar: Render klont mit `--depth 1`, die Zählung ergibt dort immer `1`.
Der Kopf hätte dauerhaft `b1` gezeigt, egal wie oft deployt wird — das Gegenteil einer
fortlaufenden Nummer. Der Zeitstempel des Commits liegt auch im flachen Klon vollständig vor.

Der **Feedback**-Knopf daneben schickt Freitext an den eigenen Server; Programmstand,
Bildschirm, Lobbycode, Regelsatz und Browser hängen automatisch dran. Der Server entscheidet,
wohin das geht:

| `FEEDBACK_SINK` | Ziel | Nötig |
|---|---|---|
| `github` | ein GitHub-Issue im Repo | `GITHUB_TOKEN`, optional `FEEDBACK_REPO` |
| `webhook` | Discord- oder Slack-Kanal | `FEEDBACK_WEBHOOK_URL` |
| `memory` | Ringpuffer im Prozess + Logzeile | — (Standard ohne Token) |

Ohne `FEEDBACK_SINK` wählt der Server selbst: `github`, wenn ein Token da ist, sonst `webhook`,
wenn eine URL da ist, sonst `memory`.

**Einrichtung für GitHub-Issues** (das ist der Weg „Feedback landet im Repo"):

1. Auf GitHub unter *Settings → Developer settings → Personal access tokens → Fine-grained*
   ein Token nur für dieses Repo anlegen, Recht **Issues: Read and write**. Sonst nichts.
2. Auf Render unter *Environment* `GITHUB_TOKEN` eintragen. Der Wert steht nie im Repo —
   in der `render.yaml` ist die Variable als `sync: false` deklariert.
3. Optional `FEEDBACK_REPO=user/repo` setzen. Ohne das nimmt der Server
   `RENDER_GIT_REPO_SLUG`, also das Repo, aus dem deployt wird.

Zwei Dinge sind dabei bewusst so gebaut:

- **Der Token bleibt auf dem Server.** Der Browser postet an `/api/feedback`, kennt weder Token
  noch Zielrepo und bekommt auch keine Fehlerdetails zu sehen — die stehen nur im Serverlog.
- **Zwei Bremsen.** 5 Meldungen pro Absender und Stunde, 60 insgesamt. Ein offener Endpunkt,
  der bei GitHub schreibt, ist sonst ein Missbrauchsziel. Über der Grenze kommt `429`.

**Wenn es nicht geht:** `GET /api/feedback/status` sagt ohne Umweg über das Serverlog, woran es
liegt. Öffentlich steht dort nur `{sink, ok, reason}` — keine Tokens, keine GitHub-Rohantworten.
Mit `FEEDBACK_ADMIN_TOKEN` im Header `x-admin-token` kommen Repo-Pfad, Statuscode, der letzte
Fehlschlag und ein Klartextsatz dazu. Dieselbe Prüfung läuft beim Serverstart und landet als
eine Zeile im Log. Mögliche `reason`-Werte:

| `reason` | Bedeutung |
|---|---|
| `no-token` | `GITHUB_TOKEN` ist nicht gesetzt |
| `no-repo` | weder `FEEDBACK_REPO` noch `RENDER_GIT_REPO_SLUG` gesetzt |
| `auth` | GitHub lehnt den Token ab (401) — abgelaufen, widerrufen, oder mit Anführungszeichen eingefügt |
| `forbidden` | 403. Mit `"reads": true` darf der Token lesen, aber nicht schreiben — siehe die drei Fallen unten |
| `not-found` | Repo für diesen Token nicht sichtbar (404) — Pfad falsch oder Repo nicht im Token ausgewählt |
| `issues-disabled` | Issues sind im Repo abgeschaltet |
| `github-down` | GitHub antwortet mit 5xx — vorübergehend, nichts zu tun |

**Drei Fallen beim Token**, die alle dasselbe Bild erzeugen (Lesen geht, Anlegen scheitert mit 403):

1. **„Repository access" steht auf „Public Repositories (read-only)".** Das ist die Voreinstellung
   und der häufigste Fall. In diesem Modus ist jeder Zugriff lesend, und der Abschnitt
   „Repository permissions" lässt sich gar nicht bedienen — eine dort gesetzte Berechtigung wird
   beim Speichern still verworfen. Nötig ist **„Only select repositories"** mit ausgewähltem Repo;
   erst danach wird der Rechte-Abschnitt aktiv. Ein Token in diesem Modus zeigt in der
   Token-Übersicht „no access to any repository" an.
2. **„Issue Types" ist nicht „Issues".** „Issue Types" steht unter *Organization permissions* und
   regelt nur eigene Issue-Typen. Gebraucht wird **„Issues"** unter *Repository permissions*.
3. **„Issues" steht auf Read-only.** `POST /repos/…/issues` verlangt **write**, `GET` nur read —
   deshalb gehen alle Leseproben durch und erst das Anlegen scheitert.

Die Reihenfolge ist wichtig: erst „Only select repositories" plus Repo, dann „Issues: Read and
write". Andersherum wird die Berechtigung nicht gespeichert.

Zu bedenken: Dieses Repo ist **öffentlich**, Issues also auch. Wer das nicht will, setzt
`FEEDBACK_REPO` auf ein privates Repo — der Token darf ein anderes Repo adressieren als das,
aus dem deployt wird.

**Warum kein Mailversand:** Render blockiert auf dem Free-Plan ausgehenden Verkehr auf die
SMTP-Ports 25, 465 und 587. Klassischer Mailversand fällt damit aus; er ginge nur über einen
HTTPS-Maildienst (Resend, Mailgun, Postmark) oder einen bezahlten Plan. Ein Webhook oder ein
GitHub-Issue kostet nichts und braucht keinen zusätzlichen Dienst.

**Warum keine Commits ins Repo:** Technisch ginge auch die Contents-API, also pro Feedback ein
Commit in eine Datei. Das wäre aber ein Auto-Deploy pro Meldung, dazu Konflikte bei zwei
gleichzeitigen Absendern und eine unbrauchbare Commit-Historie. Issues sind für genau diesen
Zweck da.

## Bedienung

- **Scans bleiben sichtbar.** Jedes aufgeklärte 3×3-Feld behält eine Umrandung auf dem Gegnerraster, im Mittelpunkt steht die gemeldete Anzahl. Man sieht also jederzeit, wo man schon hingeschaut hat und was dabei herauskam.
- **Manöver:** Knopf drücken, dann Schiff antippen — entweder in der Liste oder direkt auf dem eigenen Raster. Das gewählte Schiff wird gelb umrandet, danach Richtung wählen.
- **Mobile first.** Zellgröße skaliert mit dem Viewport (`min(9vw, 34px)`), Bedienleiste klebt unten am Bildschirmrand, alle Tippziele mindestens 44 px. Ab 780 px Breite schaltet das Layout zweispaltig.

## Noch offen

- Ladder und Statistiken (brauchen Persistenz).
- Replay-Overlay mit der Wahrscheinlichkeitskarte nach Partieende.
- Sound.
- Bot-Abnahme gegen Menschen: Zielkorridor 55–65 % Siegrate gegen erfahrene Spieler.
- Das mobile Layout ist nach Viewport-Breiten gebaut, aber nicht auf echten Geräten getestet.
- Der Jagdmodus ist simuliert, aber nicht gegen Menschen gespielt. Die 57 Züge im Schnitt sind der Punkt, an dem er scheitern könnte.
- Feedback in der Memory-Senke überlebt keinen Neustart. Das ist Absicht — wer es dauerhaft braucht, nimmt `github` oder `webhook`.
