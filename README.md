# NEBEL

Ein Redesign von *Schiffe versenken* für 14–99: Salve statt Einzelschuss, zwei Köder, die
sich als Schiffe ausgeben, ein U-Boot, das ausweicht, ein Träger, der aufklärt — und die
Möglichkeit, statt zu feuern die eigene Flotte zu verschieben.

Online-Duell im Browser oder gegen den Bot. Kein Build-Schritt, kein Framework, keine Datenbank.

---

## Warum das Ganze

Das Original ist nach fünf Partien durchschaut: Spieleragency endet mit der Aufstellung, der
Rest ist eine gelöste Suchaufgabe. NEBEL setzt drei Effekte dagegen, die nach dem Aufstellen
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

## Tests

```bash
npm test           # 17 Regeltests (node:test)
npm run e2e        # vollständige Partie gegen den Bot über WebSocket
npm run e2e:lobby  # zwei Clients, Lobby erstellen + beitreten
npm run sim -- 800 # Headless-Balancing, Bot gegen Bot
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
server/rules.js   Regel-Engine, rein und ohne Seiteneffekte — Grundlage für Server, Bot und Sim
server/bot.js     Probability-Density-Zielwahl, Ködererkennung, Gegnermodell
server/rooms.js   Lobbys, Zugtimer, Zeitbank, Bot-Züge, autoritative Zustandsverteilung
server/index.js   Express (statisch) + WebSocket
public/           Client ohne Build-Schritt (ES-Module, DOM-Raster)
tools/sim.mjs     Headless-Balancing auf derselben Engine
test/             Regeltests + zwei End-to-End-Tests
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

Zum Vergleich: Klassisches Schiffe versenken mit optimalem Bot liegt bei ~42 Schüssen. NEBEL
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

## Noch offen

- Ladder und Statistiken (brauchen Persistenz).
- Replay-Overlay mit der Wahrscheinlichkeitskarte nach Partieende.
- Sound.
- Bot-Abnahme gegen Menschen: Zielkorridor 55–65 % Siegrate gegen erfahrene Spieler.
