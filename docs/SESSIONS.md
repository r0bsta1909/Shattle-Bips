# Logbuch

Neueste Sitzung oben. Pro Eintrag: **Datum · Stand · Was geändert · Was gelernt · Was offen.**
Zwei bis fünf Zeilen pro Punkt, keine Romane — Details stehen in `git log` und den Issues.

Dauerhafte Fallen gehören nicht hierher, sondern in [LEARNINGS.md](LEARNINGS.md).

---

## 2026-09-04 (Fortsetzung) · Mittelspalte ohne Lücke, Bot-Bedenkzeit

**Geändert**
- **Mittelspalte gefüllt.** `grid-template-rows:min-content auto auto` — Reihe 1 ist genau
  so hoch wie das Kommandofeld, Reihe 2 nimmt den Überschuss der hohen Bretter auf, und der
  Funk füllt ihn (`align-self:stretch` + `flex:1` auf der Liste). Vorher waren beide Reihen
  `auto`: das Raster verteilte den Überschuss gleichmäßig, es klaffte eine Lücke zwischen den
  Karten und darunter blieb Rest — es sah aus, als schwebten sie.
- **Manövermodus** blendet den Funk aus, das Kommandofeld bekommt die Spalte allein. Rein per
  CSS über `:has(#maneuver-panel:not(.hidden))` — der Zustand steht schon im Markup, es
  braucht kein zusätzliches Feld im Client.
- **Bot-Bedenkzeit** als Lobby-Option: `botMinSeconds` / `botMaxSeconds`, Standard **3–6 s**,
  pro Zug neu gewürfelt. War fest verdrahtet auf 1,2–2,8 s.

**Nebenbefund im Prüfstand — der eigentliche Fund dieser Runde**
`npm run e2e` brauchte 24 s, manchmal 61. Ich hielt das erst für die Folge der neuen
Bot-Pause. Es war ein **vorbestehender Fehler im Testklienten**: der Scan-Mittelpunkt wurde
als `11 + rand*77` gewürfelt und traf auch Randfelder (19 = Reihe 1 / Spalte 9). Der Server
wies den Scan ab und schickte **keinen** neuen Zustand — der Klient wartete auf einen Zug, der
nicht kam, bis der 60-s-Zugtimer ihn erlöste. Der Lauf bestand trotzdem, nur langsam.
Mittelpunkt jetzt auf Reihe/Spalte 1–8 beschränkt: **24 s → 1 s**, keine Fehlermeldungen mehr.
Ganze e2e-Strecke 95 s → 23 s.

**Gelernt**
- Ein Test, der nur über einen Timeout ins Ziel kommt, meldet das nicht — er ist bloß langsam.
  **Laufzeit ist ein Prüfergebnis.** Der Sprung von 24 auf 61 s war das einzige Signal.
- `e2e:options` fiel durch die neue Bot-Pause in seinen 180-s-Deckel. Wer eine Wartezeit zur
  Voreinstellung macht, muss jeden Prüfstand mitziehen, der eine ganze Partie spielt.

**Offen**
- Am PC gegenprüfen: Mittelspalte bündig mit den Brettern, Manövermodus ruhiger.
- Die Richtungsknöpfe im Manövermodus stehen 3+2 nebeneinander. Ein 3×3-Steuerkreuz wäre
  ruhiger — bewusst nicht gemacht, war nicht Teil der Rückmeldung.

## 2026-09-04 (Fortsetzung) · Bedienung in die Mitte, Funk zentriert

Rückmeldung zum Spieltisch: „ich muss im linken feld auswählen was ich machen will und ganz
rechts dann die aktion bestätigen, langer weg" — und der Vorschlag, den Funkverkehr mittig wie
die Legende zu setzen, damit nichts nach außen ausreißt.

**Geändert** (weiter nur `@media(min-width:780px)`)
- Bedienung steht **zwischen** den Brettern: `"foe ctrl own"`. Beide Bretter haben denselben
  kurzen Weg zur Leiste, statt einer Diagonale über den ganzen Schirm.
- Funkverkehr in die **Mittelspalte** unter die Bedienung, Flottenübersicht quer über die
  volle Breite. Nichts sitzt mehr am äußeren Rand.
- Aktionsknöpfe **2×2 mit Umbruch** statt untereinander: `flex:1 1 120px` mit
  `min-width:auto` — nie schmaler als ihr Text, also nie abgeschnitten, und bei zu wenig
  Platz umgebrochen statt gequetscht. Spart 112 px Höhe.
- Flottenlisten am PC **waagerecht**. In einer Karte über die volle Breite ließen fünf
  untereinander stehende Zeilen den halben Kasten leer.
- Brettspalten als **festes Gleis** (`--board-w`) statt `max-content`, weil jetzt auch die
  querliegende Übersicht an der Spaltenbreite mitgemessen hätte.

**Gelernt**
- Der naheliegende Weg — Funk als vierte Reihe quer unter die Legende — kostet **265 px**
  Höhe und hätte die Kacheln von 52 auf **34 px** gedrückt. Vor dem Umbauen ausgerechnet,
  nicht danach gemerkt. Die Mittelspalte war ohnehin halb leer.
- Zwei Tests prüften das **Mittel** (`flex-direction:column`, `.board-col{width:…}`) statt der
  **Regel**. Als das Mittel wechselte, fielen sie, obwohl die Regel weiter galt. Jetzt geprüft:
  „ein Knopf wird nie schmaler als sein Text" und „die Brettbreite ist gerechnet".

**Nachgerechnet** — Kachel · Gesamtbreite · passt senkrecht

| Schirm | Kachel | Breite | Höhe |
|---|---|---|---|
| 1859×990 (Schirm des Nutzers) | 52,0 | 1498 | passt |
| 1440×900 | 48,5 | 1428 | passt |
| 1366×768 | 42,8 | 1314 | passt |
| 1024×768 | 27,7 | 1012 | passt |

Unter ~720 px Fensterhöhe scrollt die Seite: Bedienung (196) + Funk (244) setzen in der
Mittelspalte eine Untergrenze, die von der Kachelgröße unabhängig ist.

**Offen**
- Am PC gegenprüfen: Weg vom Brett zum Feuern kurz genug, Knöpfe vollständig beschriftet.

## 2026-09-04 · `834e968` + `a635d01` · Spieltisch für den PC

Aus einem Screenshot vom PC. Der Nutzer bestätigt Mobil („sieht wirklich gut aus"), meldet
aber: „am pc ist es dafür unbrauchbar geworden". Der Umbau aus Runde 3 hatte den PC zerlegt,
**ohne dass ein Test angeschlagen hätte** — 113 Tests grün, Anwendung kaputt.

**Geändert** (nur `@media(min-width:780px)`, Mobil blieb unberührt)
- Beide Bretter **nebeneinander** statt untereinander: `grid-template-areas` mit
  `display:contents` auf den Bereichen, damit Brett und Flottenübersicht getrennt platzierbar
  sind. Bedienung als Seitenspalte, Funk darunter, Übersicht quer unter den Brettern.
- Aktionsknöpfe am PC **untereinander** statt in einer Zeile — dort ist die Spalte schmal,
  nicht der Schirm. Vorher stand da „Feue", „Aufklä", „Tauch".
- Bedienspalte `minmax(200px,300px)` statt `1fr`; `max-width` von `main` an `.screen`
  umgehängt, damit die Spielansicht ausscheren kann.
- Kacheln am PC bis **52px** (vorher 34): `(100vw − 470px)/20`, weil sich zwei Bretter die
  Breite teilen. Aufstellung wächst mit (bis 44px), sonst stellt man klein auf und spielt groß.
- Einblendung liegt am PC **über dem Gegnerbrett** statt in der Bildmitte.
- Nachtrag `a635d01`: Brettspalte auf `calc(var(--cs)*10+41px)` festgelegt. Als `max-content`
  hätte ein langer Gegnername („Gegner: … [5 Schiffe]" ≈ 250px) die Spalte auf Fenstern bis
  852px breiter gemacht als ihr Brett (241px) — und zentriert läuft ein Überhang nach links
  aus dem Bild, wohin man nicht scrollen kann. Dazu `justify-content:safe center`.

**Gelernt**
- Eine Regel für den engsten Fall (`min-width:0`, damit vier Knöpfe auf ein Telefon passen)
  darf nicht global stehen. `min-width:0` schneidet Text ab, ohne einen Überlauf zu erzeugen:
  es sieht falsch aus, es bricht nichts — deshalb fällt es nur am Gerät auf.
- `grid-template-columns:auto 1fr`: die `auto`-Spalte nimmt max-content, `1fr` sichert
  **keinen** Anteil zu. Wer eine Mindestbreite braucht, schreibt `minmax()`.
- Der alte `--cs`-Test prüfte eine **Ortsangabe** („im ersten 780px-Block kein `--cs`"), nicht
  die Regel. Jetzt: jede gerechnete Fassung nennt beide Achsen — das kann kein zweiter Block
  mehr umgehen.
- Mein erster Höhenansatz (330px) hätte auf 1440×900, 1366×768 und 1280×800 **gescrollt**;
  die Funkkarte in Reihe 2 war nicht eingerechnet. Nachgerechnet statt geschätzt → 440px.

**Nachgerechnet** (Kachelgröße · Gesamtbreite · passt senkrecht)

| Schirm | Kachel | Breite | Höhe |
|---|---|---|---|
| 1920×1080 | 52,0 | 1498 | passt |
| 1440×900 | 46,0 | 1378 | passt |
| 1366×768 | 32,8 | 1114 | passt |
| 1024×768 | 27,7 | 1012 | passt |
| 852×393 (iPhone quer) | 20,0 | 852 | scrollt |

Tests 113 → 116, alle vier e2e-Suiten grün. Jeder neue Test gegen den kaputten Stand
gegengeprüft: Spalten zurück auf `auto 1fr`, Knopfregel ohne Ausnahme, `max-width` zurück an
`main`, Breite durch 10 — jedes Mal fiel genau der zuständige Test.

**Offen**
- Am PC gegenprüfen: kein waagerechter Rollbalken, keine abgeschnittene Beschriftung.
- Am iPhone gegenprüfen, dass Mobil **unverändert** ist (berührt wurde nur `main`/`.screen`,
  greift erst ab 1100px).

## 2026-09-03 (Fortsetzung) · `4fd10db` · Ereignis-Einblendung

**Geändert**
- Kurze Meldung in der Bildmitte bei Versenkung, Treffern, Aufklärungsergebnis, Ausweichen,
  gegnerischem Manöver und **eigenem Schiffsverlust**. Verschwindet nach 1,5 s von selbst,
  `pointer-events:none`, `prefers-reduced-motion` respektiert.
- Spielbrett rund 10 % größer: begrenzend war die **Breite**, nicht die Höhe — daher der
  Leerraum unter dem Raster. Der globale `--cs`-Abzug rechnet 28 px Karten-Innenrand mit,
  den das Spielbrett gar nicht hat.

**Gelernt**
- Der eigene Schiffsverlust steht in **keiner** Nachricht: die Salve geht an den Gegner, man
  selbst bekommt nur „Beschuss auf …". Das ereignisreichste Ereignis überhaupt muss deshalb
  aus dem Zustandswechsel abgeleitet werden.
- Bei mehreren Ereignissen einer Salve nur das Wichtigste zeigen. Vier Meldungen nacheinander
  vermitteln weniger als eine.

## 2026-09-03 (Fortsetzung) · `51de8ed` · Feste Spielansicht, Salven-Vorrat

**Geändert**
- Spielansicht scrollt hochkant **gar nicht mehr** (#22, #23). Kopfzeile, Umschalter, ein
  Bereich und die Bedienleiste stehen fest. Umschalter: Gegner · Meine Flotte · Funk; bei
  eigenem Zug springt er zurück auf Gegner. Leiste von ~340 auf ~150 px geschrumpft.
- **Salven-Vorrat** als Lobby-Option (#20, #24): Kontingent voller Salven pro Partie,
  Verbrauch ist Entscheidung pro Zug, danach nur Einzelschuss.
- Lobby-Link führt direkt hinein statt nur den Code vorzubefüllen (#15).

**Gelernt**
- Auf einem Telefon passen Gegnerraster, Bedienleiste und eigenes Raster **nie** gleichzeitig
  auf den Schirm. Kleiner rechnen hilft nur bis zum nächsten Knopf — die Ansicht muss
  entscheiden, was sie zeigt.
- `applySalvo` verlangte „genau N ansagen". Bei freier Wahl **ist die gesendete Schusszahl
  die Entscheidung** — kein neues Protokollfeld nötig.
- Der Prüfstand kannte keine Nachfahren-Selektoren und hätte einen toten Umschalter als
  bestanden gemeldet. Ein Stub, der weniger kann als der Browser, gibt falsche Sicherheit.

**Balance-Daten** (je 400 Partien) — sie widerlegen meine Schätzung aus #20 von 80–90 Zügen:

| Regelsatz | Start | Comeback | Züge Ø |
|---|---|---|---|
| Standard | 47,5 % | 41,0 % | 38,7 |
| Vorrat 8 | 52,3 % | 39,0 % | 58,6 |
| Vorrat 4 | 52,3 % | 44,5 % | 77,6 |
| Vorrat 15 | 53,5 % | 28,5 % | 42,4 |

Vorrat 8 landet in beiden Zielkorridoren. Bei 15 kippt die Comeback-Rate auf 28,5 % — zu
viele Salven begünstigen den Führenden.

**Offen**
- Am Gerät gegenprüfen: Brett vollständig, nichts überlagert, Umschalter erreichbar.
- Der Vorrat ist simuliert, aber nicht gegen Menschen gespielt.

## 2026-09-03 (Fortsetzung) · `cacd71a` · Hochkant auf dem iPhone

Aus Screenshots vom Gerät, nicht aus einem Issue. Das Spiel war nur quer benutzbar.

**Geändert**
- `--cs` an **beide** Achsen gekoppelt statt `min(9vw,34px)`. Die Rasterbeschriftung aus
  Runde 3 hatte die Breite gesprengt: Aufstellung brauchte 433 px auf 393 px Schirm.
- Flottenübersicht aus der klebenden Leiste in eine eigene Karte. Die Leiste durfte `52vh`
  hoch werden und verdeckte hochkant die halbe Spielfläche.
- `env(safe-area-inset-bottom)` gesetzt — Safaris untere Leiste überlagerte den Seitenfuß.
- Zerstörer-Symbol mit U+FE0E als Text statt schwarzem Emoji-Quadrat; leere Modus-Kapsel weg.

**Gelernt**
- **Quer erzwingen geht auf dem iPhone nicht** — kein Orientation-Lock in Safari. Hochkant
  muss funktionieren, ein „bitte drehen" ist keine Lösung.
- Layout-Geometrie ist statisch nicht prüfbar. Kein Test hätte den abgeschnittenen Rand
  gefunden; nur der Blick aufs Gerät. Deshalb prüfen die neuen Tests die **Form** der Regel
  (beide Achsen gekoppelt, kein Überschreiben im Media-Block), nicht die Pixel.
- Der neue Test schlug zuerst an meiner eigenen Prosa fehl: ein Kommentar zitiert die alte
  Deklaration. CSS-Tests entfernen jetzt Kommentare vor der Analyse.

**Offen**
- Am Gerät gegenprüfen: alle zehn Spalten hochkant, Reihen 6–10 erreichbar, Fußzeile frei.

## 2026-09-03 (Fortsetzung) · Playtest-Runde 3

**Geändert**
- Rasterbeschriftung A–J / 1–10 als Rahmen um das Raster (#16). Bewusst als Geschwister,
  damit `grid.children[i]` weiterhin Feld i ist — davon hängt der ganze Client ab.
- Schiffssymbole je Typ auf dem eigenen Brett (#19), Flottenübersicht mit gegnerischen
  Verlusten und eigenem Zustand plus Aufstellungsregel (#20 Teil 2, #21).
- Scroll-Luft unter der klebenden Bedienleiste (#18 Teil 1).
- **Eigene Regression behoben (#17):** das CSS-Escape für „✕" lief durch ein Python-Heredoc,
  das den Backslash als Oktal-Escape gelesen hat → im Raster stand „¹5".

**Gelernt**
- Dritte Rendering-Regression in Folge. Deshalb jetzt `test/client-render.test.js`: ein
  selbstgeschriebenes Mini-DOM führt `app.js` wirklich aus und treibt es über die
  WebSocket-Nachrichten an. Es modelliert absichtlich, dass `textContent` Kinder löscht.
  Hätte #9, #10 und #17 alle gefangen.
- Werkzeugkette ist Teil der Fehlerquelle: Escapes nie durch ein Python-Heredoc schicken.
- Client-Timer halten den Testprozess wach, genau wie die Zug-Timer serverseitig.

- Versenkte Gegner sind auf dem Raster erkennbar (#18). `tracking` kannte nur
  unbekannt/Wasser/Treffer; der Zustand trägt jetzt `sunkCells`. Leakt nichts — diese Felder
  hat der Spieler selbst getroffen.

**Zwei Entscheidungen liegen beim Nutzer — Issues bewusst offen**
- **#20 Salvensystem.** Vorschlag: je 1× 4er/3er/2er-Salve als einmalige Ressource, sonst
  Einzelschuss. Mechanisch reizvoll (Salve wird zur Entscheidung statt zur Funktion der
  Restflotte), aber die Simulation warnt: „1 Schuss pro Zug" verlängert von 39 auf **103 Züge**.
  Sein Vorschlag liegt bei geschätzt 80–90. Bei 60 s Zugzeit über anderthalb Stunden.
  Drei Wege angeboten: als Lobby-Option, als neuer Standard, oder erst im Simulator messen.
- **#15 Lobby-Übersicht.** Existiert nicht (nie gebaut, keine bewusste Entscheidung).
  Eine öffentliche Liste hieße: Fremde sehen und betreten offene Lobbys. Drei Wege angeboten.

**Balance-Daten (je 400 Partien) — widerlegen zwei Vermutungen aus #18**

| Regelsatz | Start | Comeback | Züge Ø |
|---|---|---|---|
| Standard | 47,5 % | 41,0 % | 38,7 |
| 1 Schuss/Zug | 50,5 % | 45,5 % | 103,3 |
| ohne Aufklärung | 53,0 % | 37,0 % | 38,2 |
| 1 Köder | 48,0 % | 36,0 % | 38,1 |

Aufklärung und Köder sind **nicht** zu mächtig — sie helfen dem Zurückliegenden. Ohne sie
steigt der Startvorteil und die Comeback-Rate fällt. Sie abzuschaffen macht das Spiel
einseitiger, nicht ausgewogener.

**Sonst offen**
- Mobiles Layout weiter nicht auf echten Geräten getestet.
- Jagdmodus simuliert, aber nicht gegen Menschen gespielt.

## 2026-09-03 · `da3bbd5` · v0.4.0 · b260903.13xx

Erste Sitzung mit echtem Playtest. Reihenfolge: Update integriert, Features gebaut, dann
zwei Runden Fehlerbehebung aus dem Feedback des Nutzers.

**Geändert**
- Update aus `update/nebel` (v0.3.0) integriert: Lobby-Optionen, Revanche, Scan-Historie.
  `nebel/` und `update/` danach gelöscht und in `.gitignore` (`f61a797`, `dacfc6e`).
- Umbenennung **NEBEL → Shattle Bips** überall, wo sichtbar. Bot heißt „Shattle-Bot".
- `tools/sim.mjs` nimmt die Lobby-Optionen per Kommandozeile (`--flag`, `--key=wert`, `--seed`).
- Programmstand dauerhaft in der Kopfzeile, `/version`.
- **Feedback-Knopf** → GitHub-Issue mit Kontext, drei Senken, Missbrauchsbremse,
  Diagnose unter `/api/feedback/status`.
- 11 gemeldete Fehler behoben (Issues #4–#14). Tests **17 → 77**.

**Gelernt** (ausführlich in [LEARNINGS.md](LEARNINGS.md))
- Der Feedback-Knopf hat sich sofort bezahlt: 11 echte Fehler in zwei Runden, mit Stacktrace,
  Programmstand und Lobbycode. Ohne ihn wäre nichts davon reproduzierbar gewesen.
- Zwei der Fehler waren **meine eigenen Regressionen** (`a70ac24` → #9/#10). Beide Male hat
  der bestehende Test sie nicht gefangen, weil er nur statische Existenz prüfte, nicht
  Laufzeitverhalten. Daraus ist der Container-Schreibtest geworden.
- Der Jagdmodus überkorrigiert allein und ist ein Substitut für den Eröffnungsausgleich,
  keine Ergänzung.
- Render: flacher Klon, gesperrtes SMTP, und `maxAge` auf statischen Dateien ist eine Falle.

**Offen**
- Der Jagdmodus ist simuliert, aber nicht gegen Menschen gespielt. 57 Züge im Schnitt sind der
  Punkt, an dem er scheitern könnte.
- Timeout-Regel (zwei verpasste Züge = Aufgabe) fühlt sich möglicherweise hart an. Jetzt
  wenigstens begründet auf dem Endbildschirm. Ggf. Lobby-Option daraus machen.
- Mobiles Layout ist nach Viewport-Breiten gebaut, aber nicht auf echten Geräten getestet.
- Bot-Abnahme gegen Menschen: Zielkorridor 55–65 % Siegrate.
- Offene Frage an den Nutzer aus #9: Lobbycode soll sich beim Aufstellen geändert haben. Konnte
  ich nicht reproduzieren, Verdacht: neu erstellte Lobby nach dem toten Knopf.
