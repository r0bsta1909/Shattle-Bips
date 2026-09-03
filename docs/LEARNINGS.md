# Learnings

Fallen, die in diesem Projekt schon Zeit gekostet haben. Jeder Eintrag: **Symptom → Ursache →
Regel.** Wer hier vorher liest, verliert die Stunde nicht noch einmal.

Nur echte Fallen aufnehmen. Keine Änderungshistorie — die steht in `git log` und
[SESSIONS.md](SESSIONS.md).

---

## Plattform: Render (Free-Plan)

### Statische Dateien nie blind cachen
**Symptom:** Nach einem Deploy erschien ein neuer Knopf, klickte aber ins Leere. Die
Versionsanzeige im Kopf zeigte bereits den neuen Stand.
**Ursache:** `express.static(..., { maxAge: '1h' })` → `Cache-Control: public, max-age=3600`.
In dieser Stunde fragt der Browser **gar nicht erst nach**. Ergebnis: neues `index.html`,
altes `app.js`. Die Versionsanzeige kommt von `/version` mit `no-store` und war schon neu —
was die Fehlersuche zusätzlich in die Irre führte.
**Regel:** Ohne Build-Schritt und ohne Hashes in Dateinamen gehört auf statische Dateien
`Cache-Control: no-cache` (behalten, aber immer per ETag rückfragen). Unverändert kostet das
ein leeres 304 statt 21 kB. Abgesichert in `test/e2e-feedback.mjs`.
**Nebenwirkung:** Der Fix wirkt nur auf künftige Auslieferungen. Eine schon gecachte Kopie
trägt noch das alte `max-age` — einmal hart neu laden.

### Render klont flach — Commits zählen geht nicht
**Symptom:** `/version` meldete auf Render dauerhaft `build: 1`, lokal korrekt `5`.
**Ursache:** Render klont mit `--depth 1`. `git rev-list --count HEAD` ergibt dort immer 1.
**Regel:** Für eine fortlaufende Nummer den **Commit-Zeitstempel** nehmen
(`git show -s --format=%cI HEAD` → `bYYMMDD.HHMM`). Der liegt auch im flachen Klon vollständig
vor, wächst monoton und ist lokal wie in Produktion gleich aufgebaut.

### SMTP ist auf dem Free-Plan gesperrt
Ausgehender Verkehr auf Port 25/465/587 ist seit September 2025 blockiert. Mailversand geht nur
über einen HTTPS-Maildienst oder einen bezahlten Plan. Deshalb läuft Feedback über die
GitHub-Issues-API. ([Changelog](https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports))

### Nützliche Variablen
`RENDER` (immer `true`), `RENDER_GIT_COMMIT`, `RENDER_GIT_REPO_SLUG`, `RENDER_EXTERNAL_URL` —
verfügbar zur Bau- **und** Laufzeit. `RENDER` gatet `app.set('trust proxy', 1)`: ohne das
landet jedes Feedback unter derselben IP und die Pro-Absender-Bremse ist wirkungslos; lokal
bleibt es aus, damit sich `X-Forwarded-For` nicht fälschen lässt.

---

## Client ohne Build-Schritt

### `textContent` auf einen Container löscht verschachtelte IDs
**Symptom:** „Flotte aufstellen" reagierte nicht.
`Uncaught TypeError: Cannot set properties of null (setting 'textContent')`
**Ursache:** `<b id="orient">` lag **innerhalb** von `<p id="place-hint">`. Ein
`$('place-hint').textContent = ''` löscht alle Kindknoten — auch `#orient`. Zwei Zeilen später
greift `renderPlacement()` darauf zu und wirft. Weil der Wurf vor `show('screen-placement')`
passierte, wechselte der Bildschirm nie: von außen ein toter Knopf.
**Regel:** Anzeigetext und Statusmeldung sind **getrennte Elemente**. Nie in einen Container
schreiben, der benannte Kinder hat. Statisch abgesichert in `test/client.test.js` — der Test
liest aus dem Markup, welche IDs weitere IDs enthalten, und verbietet Schreibzugriffe darauf.

### Escapes nie durch ein Python-Heredoc schicken
**Symptom:** Auf getroffenen eigenen Feldern stand „¹5" statt eines Kreuzes.
**Ursache:** Das CSS-Escape für ✕ wurde in einem `python - <<'PY'`-Block geschrieben. Python
liest den Backslash als **Oktal-Escape** (Wert 185 = `¹`), die restliche Ziffer bleibt stehen.
**Regel:** Zeichen **direkt** schreiben (`content:"✕"`), nicht als Escape. Und Datei­änderungen
mit Sonderzeichen über das Edit-Werkzeug machen, nicht über Skript-Heredocs. Diese Falle ist
zweimal zugeschlagen — beim zweiten Mal ausgerechnet in dem Satz, der sie beschreibt.
Abgesichert: `test/client.test.js` prüft, dass `content:`-Werte genau ein Zeichen lang sind,
und sucht in den ausgelieferten Dateien nach Mojibake-Markern.

### Den Client wirklich ausführen, nicht nur statisch prüfen
Drei Rendering-Regressionen in Folge (#9, #10, #17) waren statisch unsichtbar.
`test/client-render.test.js` fährt `app.js` in einem selbstgeschriebenen Mini-DOM hoch und
treibt es über dieselben WebSocket-Nachrichten an, die der Server schickt. Das DOM modelliert
absichtlich die Fallen: `textContent` löscht Kinder samt IDs, `dataset` speichert nur Strings.
**Regel:** Wer am Rendering etwas ändert, ergänzt dort einen Fall. Und: der Prüfstand sammelt
die Timer des Clients ein — die 500-ms-Zuguhr hält den Testprozess sonst wach.

### Statische Prüfung schlägt Vertrauen
`test/client.test.js` gleicht ab, dass jede `$('id')` aus `app.js` im HTML existiert, dass IDs
eindeutig sind und dass keine Container beschrieben werden. Ohne Typen und Build ist das die
einzige Instanz, die solche Fehler vor dem Nutzer findet. **Neue Client-Fehlerklasse ⇒ hier
eine Prüfung ergänzen.**

### Wer die Rastergeometrie ändert, muss `--cs` nachrechnen
**Symptom:** Auf dem iPhone war Spalte J abgeschnitten, hochkant war das Spiel unbenutzbar.
**Ursache:** `--cs: min(9vw, 34px)` landet auf jedem aktuellen iPhone bei 34 px. Die
Rasterbeschriftung hat einen 16-px-Streifen plus Lücke hinzugefügt — damit brauchte die
Aufstellung 433 px auf einem 393-px-Schirm. Vorher waren es 386 px, es passte knapp. **Kein
Test konnte das merken:** Layout-Geometrie ist statisch nicht prüfbar, und das Mini-DOM rechnet
keine Pixel.
**Regel:** `--cs` ist an **beide** Achsen gekoppelt und lässt Reserve:
`clamp(24px, min((100vw - 100px)/10, (100dvh - 190px)/10), 34px)`. Die 100 px sind alles, was
neben den Zellen Breite kostet, plus 7 px Puffer — eine Punktlandung bricht bei Rundung oder
sichtbarer Scrollleiste. Wer Ränder, Streifen oder Lücken am Raster ändert, rechnet die Zahl
nach. `dvh` statt `vh`, weil Safaris Leisten ein- und ausfahren. Und: `--cs` **nicht** in einem
Media-Block überschreiben — das hebelt die Höhenkopplung genau quer aus, wo der Schirm niedrig ist.

### Quer erzwingen geht auf dem iPhone nicht
`screen.orientation.lock()` ist in Safari nicht verfügbar, und Apple bietet keine Möglichkeit,
die Ausrichtung für eine Webseite festzulegen — ohne native App und Vollbild geht das nicht.
Man kann nur *bitten* zu drehen. Wer die Rotationssperre aktiviert hat, könnte dann gar nicht
spielen. **Regel:** Hochkant muss funktionieren, ein Rotationshinweis ist keine Lösung.
Dazu gehört `env(safe-area-inset-bottom)` — `viewport-fit=cover` im Meta-Tag allein bewirkt
nichts, der Abstand muss auch gesetzt werden.

### Nur Aktionen kleben, Nachschlagewerk scrollt
Die klebende Bedienleiste durfte `52vh` hoch werden und trug zusätzlich die Flottenübersicht —
hochkant verdeckte sie die halbe Spielfläche. **Regel:** In den klebenden Bereich gehört, was
man zum Handeln braucht; was man nachschlägt, scrollt darunter. Der Scrollraum kommt aus
`--controls-h`, das der Client aus der gemessenen Höhe setzt — eine feste Zahl wird beim
nächsten Knopf falsch.

### CSS-Tests müssen Kommentare entfernen
Der Test für `--cs` schlug an der eigenen Prosa fehl: ein Kommentar **zitiert** die alte
Deklaration (`--cs:34px`), und die Regex las rohen Text. **Regel:** Vor jeder Analyse
`css.replace(/\/\*[\s\S]*?\*\//g, '')`. Betrifft alle Tests, die CSS nach Mustern durchsuchen.

### Farbe allein trägt nicht
Schiff `#3f6d84`, gegnerischer Fehlschuss `#2a5670` und leeres Wasser `#17394d` waren drei
ähnliche Blautöne und praktisch nicht zu trennen. Jeder Zustand auf dem eigenen Brett trägt
jetzt zusätzlich eine **Form** (Innenkante, Punkt, Kreuz).

### Modus gehört zu genau einem Zug
Der Scan-Modus blieb über den Zugwechsel stehen; der nächste Klick löste eine Aufklärung aus,
die der Server ablehnte. **Regel:** Bei Zugwechsel `mode`, `selected` und `manShip`
zurücksetzen.

---

## Client/Server-Konsistenz

### Ein `canX` im Zustand muss die Serverprüfung exakt spiegeln
**Symptom:** „Zu wenige Schüsse für einen Scan", obwohl noch keiner abgegeben war.
**Ursache:** `canScan` prüfte `scanEnabled` nicht. Bei abgeschalteter Aufklärung blieb der Knopf
bedienbar, und der Server wies den Klick erst hinterher ab. Getrennt gepflegte Bedingungen
laufen auseinander.
**Regel:** Jede `canX`-Flagge im Zustand muss dieselben Bedingungen prüfen wie die
zugehörige `applyX`. Und: **ein gesperrter Knopf braucht einen Grund.** Der Zustand liefert
`scanBlocked` im Klartext — sonst rät der Spieler und meldet einen Bug, der keiner ist.

### Spiel- und Raumzustand nur an einer Stelle beenden
`onTimeout()` setzte `game.status = 'finished'`, aber nicht `room.status`. `voteRematch()` prüft
den Raumzustand und lehnte deshalb mit „Partie läuft noch" ab — die Revanche wurde angefragt und
nie angenommen. **Regel:** Ein Zustandsübergang, der zwei Objekte betrifft, gehört in **eine**
Funktion (`finishRoom()`).

### Verbundene Spieler zählen, nicht Plätze
`voteRematch` zählte `room.slots`. Hatte der Anfragende das Fenster geschlossen, galt seine alte
Stimme weiter — der Annehmende startete allein in eine Lobby. **Regel:** Bei allem, was auf
Zustimmung wartet, nur **verbundene** Teilnehmer zählen, und eine Trennung nimmt die Stimme mit.

### Ein Wurf im Handler wird zu „Serverfehler."
`makePlayer()` wirft, wenn eine gespeicherte Aufstellung nicht mehr zu den Optionen passt. Der
zentrale `try/catch` machte daraus ein blankes „Serverfehler.", und die Lobby blieb hängen.
**Regel:** Erwartbare Ungültigkeit vorher prüfen und benennen, statt sie werfen zu lassen.

### Wer wartet, muss erfahren, wenn sich die Grundlage ändert
Eine Optionsänderung verwirft serverseitig beide Aufstellungen. Ohne Meldung stellte der Gast
unter alten Regeln fertig, bekam beim „Bereit" eine leicht zu übersehende Ablehnung und wartete
auf einen Start, der nie kam — mal ja, mal nein, je nach Zeitpunkt.
**Regel:** Verwirft der Server fremden Zustand, sagt er es aktiv (`notice: optionsChanged`).

### Jede Logzeile braucht einen Absender
„Zug verfallen" ließ offen, wessen Zug. Das `slot`-Feld war in der Nachricht, wurde aber nicht
ausgewertet. **Regel:** Meldungen im Funkverkehr nennen Urheber oder Betroffenen.

---

## Werkzeuge

### Node-`fetch` erzwingt Revalidierung
Ein Test auf `304` schlug fehl, obwohl der Server korrekt antwortete: Node-`fetch` hängt von
sich aus `cache-control: no-cache` an **jeden** Request, worauf Express die Datei immer
ausliefert. Ein Browser tut das nur beim harten Neuladen.
**Regel:** Cache-Verhalten mit `node:http` prüfen, wo die Header genau kontrollierbar sind.

### Offene Timer halten den Testprozess wach
Botpartien lassen Zug-Timer laufen; die Regressionsdatei brauchte drei Minuten statt Sekunden.
`closeRoom()` gibt Raum und Timer frei — in `test.afterEach()` aufrufen.

### GitHub-Token für Issues: drei Fallen, ein Symptom
Alle drei sehen gleich aus (Lesen geht, Anlegen scheitert mit 403):

1. **„Repository access" auf „Public Repositories (read-only)"** — die Voreinstellung. In diesem
   Modus ist jeder Zugriff lesend, und „Repository permissions" lässt sich nicht bedienen: dort
   gesetzte Rechte werden beim Speichern still verworfen. Nötig ist **„Only select
   repositories"** samt Repo; *erst danach* wird der Rechte-Abschnitt aktiv.
2. **„Issue Types" ≠ „Issues"** — Ersteres steht unter *Organization permissions* und regelt nur
   eigene Issue-Typen. Gebraucht wird **„Issues"** unter *Repository permissions*.
3. **„Issues" auf Read-only** — `POST /repos/…/issues` verlangt `write`, `GET` nur `read`.

**Regel:** Lesezugriff beweist kein Schreibrecht. Es gibt keinen Trockenlauf für
`POST /issues`, deshalb hat in `diagnose()` der letzte **echte** Schreibversuch Vorrang vor der
Leseprobe — und ein Erfolg löscht den gemerkten Fehlschlag wieder.
Diagnose: `GET /api/feedback/status`, mit `x-admin-token` ausführlich.

---

## Balancing

`tools/sim.mjs` nimmt dieselben Optionen wie die Lobby und schickt sie durch dasselbe
`mergeOptions()` — der Sim kann keinen Regelsatz testen, der im Spiel nicht einstellbar wäre.

**Der Jagdmodus (`--singleShotAfterHit`) allein überkorrigiert.** Er dreht den Startvorteil in
einen Nachteil (49,0 % → 44,7 %), weil er *zusätzlich* zum Eröffnungsausgleich bremst — die
beiden Regeln sind **Substitute, keine Ergänzungen**. Zusammen mit `--no-openingBalance` landet
er wieder in beiden Zielkorridoren (52,4 % / 40,2 %), verlängert die Partie aber um gut 45 %
(39 → 57 Züge). Bei 60 s Zugzeit ist das der Punkt, an dem er im Playtest scheitern könnte.

**Regel:** Zielkorridore gelten nur für den Standardregelsatz. Zum Vergleich denselben `--seed`
einmal ohne Optionen laufen lassen.
