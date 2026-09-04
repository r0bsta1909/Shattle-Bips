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

**Dritter Treffer, andere Werkzeugkette:** Ein `\\b` in einem Test kam als `\b` an — im
Template-Literal einer `new RegExp()` ist das ein Rückschritt-Zeichen, keine Wortgrenze, also
passte das Muster auf nichts. Vorher hatte ich einen Rundlauf-Test gemacht: **Umlaute** kamen
sauber durch, deshalb hielt ich den Weg für sicher. Backslashes hatte ich nicht geprüft.
**Regel:** Ein Rundlauf-Test beweist nur, was er testet. Sonderzeichen sind nicht eine Klasse,
sondern mehrere. Sicherer Ausweg ohne Escape: `[;}]` statt `\b`, Zeichenklasse statt Grenze.

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

### Auf dem Telefon entscheidet die Ansicht, was sie zeigt
Gegnerraster, Bedienleiste und eigenes Raster brauchen zusammen mehr Höhe, als ein Telefon
hat — gemessen 745 px bei 715 px Schirm. Kleiner rechnen verschiebt das Problem nur bis zum
nächsten Knopf. **Regel:** Die Spielansicht ist hochkant genau schirmhoch (`100dvh` minus
gemessener Kopfzeile), scrollt selbst nicht, und ein Umschalter wählt den sichtbaren Bereich.
Was gehandelt wird, steht immer da; was nachgeschlagen wird, ist einen Tipp entfernt.
Quer bleibt alles gleichzeitig sichtbar — dort ist Platz.

### Eine Regel für den engsten Fall gehört in den Media-Block des engsten Falls
**Symptom:** Der Umbau fürs Telefon war abgenommen — und machte den PC unbrauchbar. Vier
Knöpfe hießen dort „Feue", „Aufklä", „Tauch", beide Bretter lagen untereinander auf einer
2500 px hohen Seite, und rechts blieben 600 px leer. **Kein einziger Test schlug an.**

**Ursache:** zwei CSS-Eigenheiten, beide leise:
- `.row.actions button{flex:1 1 0;min-width:0}` stand **global**. Es ist die Telefonlösung
  (vier Knöpfe müssen in eine Zeile passen). `min-width:0` erlaubt dem Knopf, schmaler zu
  werden als sein Text — der läuft dann über und wird vom Hintergrund des Nachbarn
  überdeckt. Es *sieht* falsch aus, es *bricht* nichts: keine Ausnahme, kein Überlauf.
- `grid-template-columns:auto 1fr` — die `auto`-Spalte nimmt sich die **max-content**-Breite
  ihres breitesten Kindes (hier die Flottenübersicht, ~660 px). `1fr` sichert **keinen**
  Anteil zu, es verteilt nur, was übrig bleibt: 155 px.

**Regel:** Was für den engsten Fall gebaut ist, steht im Media-Block des engsten Falls, nicht
global. Und eine Spalte, die nicht beliebig schrumpfen darf, braucht `minmax()`, kein `1fr`.
Nebenbei: eine Breitengrenze (`max-width`) gehört an den einzelnen Bildschirm, nicht an
`main` — sonst kann kein Bildschirm ausscheren, wenn er einmal mehr Platz braucht.

Nützlich dabei: `display:contents` auf einem Zwischenbehälter gibt dessen Kinder ans Raster
ab, sodass sie einzeln in Flächen gesetzt werden können — mit `display:block` davor als
Rückfall, dasselbe Muster wie bei `--cs`.

### Beweglichkeit hilft dem Gesunden — also dem Führenden
Manöver und Tauchfahrt sind nur mit **unbeschädigten** Schiffen möglich. Wer vorn liegt, hat
mehr davon. Als der Bot dreimal so oft manövrierte wie vorher, fiel die Comeback-Rate von
40,3 auf **33,0 %** — unter den Zielkorridor.

**Regel:** Jede Fähigkeit, die intakte Einheiten voraussetzt, ist ein **Anti**-Catch-up, egal
wie sehr sie sich nach Verteidigung anfühlt. Vor dem Verstärken solcher Mechaniken die
Comeback-Rate messen, nicht danach.

Dazu die Gegenprobe, die überrascht hat: der naheliegende Catch-up — der Verliererseite mehr
Schüsse geben (`minSalvo` 2 → 3) — senkt die Comeback-Rate ebenfalls (42 → 38,8 %). Mehr
Feuerkraft verkürzt die Partie (38,9 → 34,2 Züge), und wer weniger Züge hat, holt weniger auf.
**Mehr Feuerkraft für beide hilft dem Führenden.**

### Ein Zug, der scheitert, ist ein Zug, der nicht stattfindet
Der Bot würfelte Manöverrichtungen blind. War die Zielposition belegt, wies die Engine ab, und
`maybeBotTurn` fiel stillschweigend auf eine normale Salve zurück. Ergebnis: die Heuristik war
auf ~9 Manöver je Partie eingestellt, herausgekommen sind **3** — und die Tuning-Werte waren
jahrelang an dieser Fehlerquote kalibriert.

**Regel:** Wer eine Aktion planen lässt, muss ihre Zulässigkeit vorher kennen. Der Server
rechnet die erlaubten Züge ohnehin für die Anzeige aus (`maneuverOptions`) — dieselbe Quelle
gehört in den Bot. Und: wenn ein stiller Rückfallpfad existiert, misst man nie, wie oft er
genommen wird. Der Test dazu prüft die Kopplung direkt: **jeder angebotene Zug muss auch
angenommen werden.**

### Zwei Stellen, ein Ablauf — eine wird vergessen
`applyManeuver` wird von `rooms.js` **und** von `tools/sim.mjs` aufgerufen. Neue Argumente kamen
nur in den Server. Der Simulator führte damit einen anderen Zug aus als das Spiel und meldete
für zwei neue Einstellungen sauber gemessene, völlig unveränderte Zahlen — die Optionen sahen
wirkungslos aus, waren es aber nur im Messgerät.

**Regel:** Wenn zwei Aufrufer dieselbe Engine-Funktion benutzen, gehört ein Test dazu, der
beide nebeneinanderlegt. Eine Messung, die nichts zeigt, ist erst dann ein Ergebnis, wenn das
Messgerät nachweislich misst.

### Ein Effekt kommt selten allein — Ereignisstrom statt Streuung
Die Einblendung war in die Nachrichtenzweige eingestreut. Als der Ton dazukam, hätte er
dieselben sechs Stellen gebraucht — und die nächste Sache (Notizen, Haptik, Statistik) wieder.

**Regel:** Sobald ein **zweiter** Effekt auf dieselben Vorgänge reagiert, gehört dazwischen ein
Ereignisstrom: `emit('sunk', …)` dort, wo es passiert, `onEvent(…)` je Effekt. Jeder Verbraucher
läuft in seinem eigenen `try` — ein kaputter Ton darf nicht das Brett lahmlegen.

Dasselbe serverseitig: `game.log` ist die eine Wahrheit, jede Kennzahl ist eine **Leseart**
davon. Deshalb rechnet `summarize()` die Täuschungsbilanz aus dem Protokoll, statt während der
Partie mitzuzählen — eine neue Kennzahl fasst die Spielschleife nicht mehr an.

### In einem festen Raster frisst eine wachsende Leiste den Inhalt
Die Spielansicht ist hochkant genau schirmhoch: `grid-template-rows: auto 1fr auto`. Als das
Manöverfeld aufklappte, wuchs die `auto`-Zeile der Bedienleiste über den ganzen Schirm und
drückte das `1fr` auf null — vom Brett blieb **eine Zeile** übrig.

**Regel:** Jeder aufklappbare Bereich in einer `auto`-Zeile eines schirmhohen Rasters braucht
eine Obergrenze (`max-height` + `overflow:auto`) als Fangnetz. Und aufklappen heißt aufräumen:
was der Modus nicht braucht, verschwindet für seine Dauer — im Manövermodus sind Feuern,
Aufklären und Tauchen ohnehin gesperrt.

### Ein Modus, der etwas markiert, muss das Markierte auch zeigen
Die erreichbaren Felder werden auf dem **eigenen** Brett hell. Hochkant ist immer nur ein
Bereich sichtbar — und der Umschalter stand auf „Gegner". Die ganze Anzeige lief ins Leere,
ohne dass irgendetwas kaputt war. **Regel:** Wer eine Markierung einführt, prüft im selben Zug,
ob sie auf dem gerade sichtbaren Bereich liegt.

### Ein Messwerkzeug, das stumm nichts tut, erzeugt Befunde statt sie zu verhindern
`tools/shot.mjs` hörte mitten in einer Sitzung auf, Bilder zu schreiben — Chrome beendet sich
auch im Fehlerfall mit 0. Der Vergleich „vorher gegen nachher" lief daraufhin gegen zwei
Dateien, die es nie gab, und meldete brav „Unterschied". Ich hätte daraus beinahe geschlossen,
die Desktop-Ansicht sei kaputt.

**Regel:** Nach jedem Werkzeuglauf prüfen, ob das Ergebnis überhaupt existiert, und sonst laut
scheitern. Das Werkzeug tut das jetzt selbst. Und wenn kein Bild zu bekommen ist, lässt sich
„am PC ändert sich nichts" auch **strukturell** absichern: ein Test, der belegt, dass jede neue
Regel im `max-width:779px`-Block steht und in keinem Breitbild-Block.

### Ein Bildschirmfoto kann enger sein als die Wirklichkeit
`tools/shot.mjs` zeigte hochkant ein Bild, in dem Kopfzeile, Reiter und Brett rechts
abgeschnitten waren. Ich hätte beinahe CSS repariert, das nie kaputt war.

**Ursache:** Chrome erzwingt für `--window-size` eine Mindestbreite und rendert dann breiter,
als das Bild hinterher groß ist — ein 375px-Foto zeigte ein 412px-Layout.
**Regel:** Die Seite läuft im Prüfstand in einem `<iframe>` genau der gewünschten Größe; dessen
Breite *ist* der Viewport, unabhängig vom Fenster. Und generell: bevor man einem Messwerkzeug
glaubt, einmal etwas messen, dessen Ergebnis man schon kennt.

### Layout ist doch prüfbar — Chrome ist schon da
Hier stand lange „Layout-Geometrie ist statisch nicht prüfbar, der Beweis ist das Gerät".
Das stimmt für *Tests*, war aber die falsche Schlussfolgerung für die *Arbeit*: jede Runde
wurde geschätzt, und der Nutzer musste am Bildschirm korrigieren. Chrome liegt auf jedem
Entwicklungsrechner. `node tools/shot.mjs 1440x900` rendert das **echte** Markup mit dem
**echten** CSS und legt ein Bild hin — ohne Server, ohne Partie, ohne Zusatzpaket.

Damit ließ sich in einer Runde durchprobieren, was drei Runden Rechnen nicht geklärt hatten:
dass ein Raster den Höhenüberschuss eines über mehrere Reihen spannenden Elements auf **alle**
gespannten Reihen mit intrinsischer Größe verteilt. Weder `auto` noch `min-content` noch
`minmax(0,min-content)` verhindern das — entweder klafft eine Lücke oder etwas rutscht heraus.
**Regel:** Sitzen zwei Karten in einer Spalte neben einem hohen Element, gehören sie in **ein**
Rasterfeld, das sich innen selbst aufteilt (Flexbox), nicht in zwei Rasterreihen.

Und der Gegenbeweis ist genauso billig: dieselbe Ansicht vor und nach dem Umbau hochkant
rendern und die Dateien vergleichen. `cmp` sagt dann Pixel für Pixel, ob Mobil unberührt blieb.

### Laufzeit ist ein Prüfergebnis
`npm run e2e` brauchte mal 24, mal 61 Sekunden und bestand jedes Mal. Ursache: der Testklient
würfelte Scan-Mittelpunkte als `11 + rand*77` und traf damit auch Randfelder. Der Server wies
den Scan ab und schickte **keinen** neuen Zustand — der Klient wartete auf einen Zug, der nie
kam, bis der 60-Sekunden-Zugtimer die Partie weiterschob. Bestanden hat er trotzdem.

**Regel:** Ein Lauf, der nur über einen Timeout ins Ziel kommt, meldet das nicht. Wenn eine
Suite ohne erkennbaren Grund langsamer wird, ist das ein Befund und keine Randnotiz — die
Schwankung war hier das einzige Signal. Und: wer eine Wartezeit zur Voreinstellung macht
(hier die Bot-Bedenkzeit), muss jeden Prüfstand mitziehen, der eine ganze Partie spielt,
sonst läuft der in seinen eigenen Deckel.

### Zustand, der schon im Markup steht, braucht kein zweites Feld
Der Manövermodus schaltet `#maneuver-panel.hidden`. Dass daneben der Funkverkehr weichen soll,
lässt sich damit allein ausdrücken: `:has(#maneuver-panel:not(.hidden))`. Kein neues
Client-Feld, keine zweite Wahrheit, die auseinanderlaufen kann — und Browser ohne `:has()`
verwerfen nur die Regel und zeigen weiter beides. **Regel:** Vor einem neuen Zustandsfeld
prüfen, ob der vorhandene DOM-Zustand die Frage schon beantwortet.

### Die Bedienung gehört zwischen die Bretter, nicht an den Rand
Am PC lag die Leiste zunächst rechts außen: auswählen links, bestätigen ganz rechts — eine
Diagonale über den ganzen Schirm, bei jedem Zug. **Regel:** Was gemeinsam bedient wird, steht
nebeneinander. Zwischen beiden Brettern ist der Weg von *beiden* Seiten kurz, und der Platz
in der Mittelspalte trägt nebenbei den Funkverkehr, der sonst außen ausreißt.

Dazu die Rechnung, die man **vor** dem Umbauen macht: eine zusätzliche Reihe quer unter der
Legende hätte 265 px Höhe gekostet und die Kacheln von 52 auf 34 px gedrückt. Eine halb leere
Spalte zu füllen ist billiger als eine Reihe anzuhängen — Höhe ist am PC die knappe Achse,
nicht die Breite.

### Ein Test, der das Mittel prüft, fällt beim Umbau — obwohl die Regel gilt
Zwei Tests sicherten `flex-direction:column` und `.board-col{width:…}`. Beim nächsten Umbau
wurden dieselben Ziele anders erreicht (Umbruch statt Spalte, Gleisbreite statt Elementbreite)
— beide Tests fielen, ohne dass etwas kaputt war. **Regel:** die Bedingung so formulieren, wie
die Regel lautet: „ein Knopf wird nie schmaler als seine Beschriftung" (`min-width:auto`) statt
„die Knöpfe stehen untereinander". Ein Test, der beim Umbau lärmt, wird beim nächsten Mal
gelockert statt gelesen.

### Ein Test, der eine Ortsangabe prüft, prüft nicht die Regel
Der `--cs`-Test verlangte: „im **ersten** `@media(min-width:780px)`-Block steht kein `--cs`".
Gemeint war: „die Höhenkopplung darf nirgends verloren gehen". Ein zweiter Block hätte die
Prüfung wortlos umgangen. **Regel:** Die Bedingung so formulieren, wie die Regel lautet —
hier: *jede* gerechnete Fassung von `--cs` nennt Breite **und** Höhe. Beim Zerlegen von CSS
Klammern zählen; ein `@media`-Rumpf enthält wieder Regeln mit Klammern, ein `.*?` bis zur
nächsten schließenden erwischt nur die erste.

### Nicht jedes Ereignis steht in einer Nachricht
Dass der Gegner ein eigenes Schiff versenkt hat, wird nirgends gemeldet: die Salve geht an
ihn, der Betroffene bekommt nur `notice: incoming` mit den Feldern. Das Wichtigste, was einem
passieren kann, muss deshalb aus dem **Zustandswechsel** abgeleitet werden (vorherige
`own.ships` mit den neuen vergleichen). **Regel:** Bevor man ein Protokollfeld ergänzt,
prüfen, ob der Zustand die Information schon trägt — und bei Ereignis-Einblendungen pro
Aktion nur das Wichtigste zeigen, keine Warteschlange.

### Eine Einblendung über dem Brett darf keine Tipps schlucken
`pointer-events:none` ist bei allem Pflicht, was über der Spielfläche liegt. Sonst landet
genau der Tipp, den man als Nächstes machen will, auf der Meldung. Und
`prefers-reduced-motion` bekommt dieselbe Information ohne Bewegung — nicht gar keine.

### Die gesendete Menge kann die Entscheidung sein
`applySalvo` verlangte „genau N Schüsse ansagen". Für den Salven-Vorrat, bei dem der Spieler
pro Zug zwischen Einzelschuss und Salve wählt, brauchte es trotzdem **kein neues
Protokollfeld**: die Anzahl der gesendeten Schüsse *ist* die Wahl. **Regel:** Bevor man das
Protokoll erweitert, prüfen, ob die vorhandene Nutzlast die Absicht schon trägt.
Und: eine Begrenzung dort ansetzen, wo sie wirken soll — der Vorrat greift in `maxShots`,
nicht in `baseSalvo`, sonst hätte er Aufklärung und Tauchen gleich mit abgeräumt.

### Ein Prüfstand, der weniger kann als der Browser, lügt
Das Mini-DOM kannte nur einfache Selektoren. Der Client verdrahtet seine Umschalter über
`.game-tabs .tab` — `querySelectorAll` fand nichts, die Handler blieben unverdrahtet, und der
Test hätte einen toten Umschalter als bestanden gemeldet. **Regel:** Was der Client an
DOM-Fähigkeiten benutzt, muss der Prüfstand können. Nachfahren-Ketten, Kommalisten und
`[attribut]` sind jetzt drin.

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
