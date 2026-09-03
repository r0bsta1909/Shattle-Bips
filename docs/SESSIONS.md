# Logbuch

Neueste Sitzung oben. Pro Eintrag: **Datum · Stand · Was geändert · Was gelernt · Was offen.**
Zwei bis fünf Zeilen pro Punkt, keine Romane — Details stehen in `git log` und den Issues.

Dauerhafte Fallen gehören nicht hierher, sondern in [LEARNINGS.md](LEARNINGS.md).

---

## 2026-09-03 (Fortsetzung) · Playtest-Runde 3

**Geändert**
- Rasterbeschriftung A–J / 1–10 als Rahmen um das Raster (#16). Bewusst als Geschwister,
  damit `grid.children[i]` weiterhin Feld i ist — davon hängt der ganze Client ab.
- Schiffssymbole je Typ auf dem eigenen Brett (#19), Flottenübersicht mit gegnerischen
  Verlusten und eigenem Zustand plus Aufstellungsregel (#20 Teil 2, #21).
- Scroll-Luft unter der klebenden Bedienleiste (#18 Teil 1).
- **Eigene Regression behoben (#17):** ein CSS-`¹5` lief durch ein Python-Heredoc,
  dort ist `¹` ein Oktal-Escape → im Raster stand `¹5`.

**Gelernt**
- Dritte Rendering-Regression in Folge. Deshalb jetzt `test/client-render.test.js`: ein
  selbstgeschriebenes Mini-DOM führt `app.js` wirklich aus und treibt es über die
  WebSocket-Nachrichten an. Es modelliert absichtlich, dass `textContent` Kinder löscht.
  Hätte #9, #10 und #17 alle gefangen.
- Werkzeugkette ist Teil der Fehlerquelle: Escapes nie durch ein Python-Heredoc schicken.
- Client-Timer halten den Testprozess wach, genau wie die Zug-Timer serverseitig.

**Offen**
- #20 schlägt ein neues Salvensystem vor (1×4, 1×3, 1×2 als einmalige Ressourcen, sonst
  Einzelschuss). Das ist eine Kernregeländerung — Entscheidung liegt beim Nutzer. Simulation
  zeigt: „1 Schuss pro Zug" verlängert die Partie von 39 auf **103 Züge**.
- Simulation widerspricht zwei Vermutungen aus #18: ohne Aufklärung sinkt die Comeback-Rate
  auf 37 % und der Startvorteil steigt auf 53 %; mit nur 1 Köder sinkt sie auf 36 %. Beide
  helfen also dem Zurückliegenden.

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
