# Prüfbericht & Designbewertung – Stand der Behebung

Quelle: „Realm Prüfung vor dem öffentlichen Start“ (F01–F17) und „Realm: Design- und UX-Bewertung“ (D01–D10), beide vom 20.10.2026 zu Commit `b8ccffef`. Jede Behebung bekommt zuerst einen Test, der den Fehler reproduziert, dann den Fix.

| Befund | Status | Behebung | Abgesichert durch |
| --- | --- | --- | --- |
| F07 Chat-Absturz (Promise aus `scrollIntoView`) | behoben (Welle 0) | Effekte mit Blockrumpf (Crew- und Festival-Chat) | `tests/effects.test.mts` (statisch, schlägt am alten Stand an); alle Browsertests emulieren das Chrome-155-Verhalten (`tests/browser.mjs`); CI zusätzlich Firefox und WebKit |
| D07 Modaler Dialog lässt Fokus heraus, kein Schließen-Knopf | behoben (Welle 0) | Hintergrund `inert`, Tab kreist im Dialog, beschrifteter Schließen-Knopf | `tests/a11y.mjs` „Profil · Tastaturfokus bleibt im Dialog“ (40× Tab; alter Stand: 21 Ausbrüche) |
| D06 Vergangene Acts mit 45 % Deckkraft | behoben (Welle 0) | Abstufung über Farbe/Schriftstärke/Randmarke statt Transparenz; abgesagte Timeline-Acts über Graustufe + Durchstreichung | `tests/a11y.mjs` „Line-up · Vortag (vergangene Acts)“ (alter Stand: 45 Kontrastverstöße) |
| D08 320 px: „Mein Plan“ bricht in fester Höhe um | behoben (Welle 0) | Segmente wachsen, kein Umbruch, kompaktere Leiste ≤ 360 px; Navigationslabels 12 px | `tests/smoke.mjs` „narrow phone (320 px) with larger text“ (alter Stand schlägt an) |
| D08 Karte auf 320 px (Marker/Labels) | offen → Welle 2 | | |
| übrige F/D | offen | siehe Plan in `REALM_PROGRESS.md` | |
