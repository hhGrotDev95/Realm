# Realm · gemeinsamer Arbeitsstand

Realm ist eine Festival-App mit responsiver Website und iPhone-Hülle, keine
Aufgaben-/Habit-App. Die gemeinsame Projektanleitung steht in [AGENTS.md](AGENTS.md).
Sie gilt unabhängig davon, welcher Assistent die Arbeit ausführt.

Vor jedem Durchlauf den aktuellen `origin/main`, offene PRs, den
[Winterplan](docs/WINTER_RELEASE_PLAN.md) und den jüngsten datierten Eintrag in
[REALM_PROGRESS.md](REALM_PROGRESS.md) lesen. Vorhandene lokale Änderungen und
ungemergte Commits erhalten. Nicht auf einen alten Session-Ausgangsstand
zurücksetzen; bereits enthaltene Funktionen nicht erneut implementieren.

Prüfungen aus `package.json` und `worker/package.json` verwenden und tatsächlich
ausgeführte Ergebnisse dokumentieren. `npm run build:ios` prüft die gebündelten
Web-Assets, nicht Xcode-Kompilierung oder iPhone-Laufzeit. Zugangsdaten und die
persönliche DOKU bleiben außerhalb des öffentlichen Repositorys.

Merge und Veröffentlichung richten sich nach dem aktuellen Nutzerauftrag.
Historische Freigaben sind keine pauschale Erlaubnis für neue Produktions-,
Store- oder Kontoänderungen. Der Auftrag vom 16.11.2026 erlaubt ausdrücklich
die geprüfte Zusammenführung von PR #53, den noch relevanten Teilen von #26
und den lokalen iPhone-Korrekturen.

Nach jedem Arbeitspaket auch die geprüfte Projektzusammenfassung in
`docs/PROJECT_STATUS.json` gemäß `AGENTS.md` aktualisieren; Anleitung und
Datengrenzen in [docs/OWNER_DASHBOARD.md](docs/OWNER_DASHBOARD.md).
Hannes hat den täglichen Claude-Zeitplan am 16.11.2026 laut Nutzerangabe deaktiviert.
Ein Status-Deploy ist kein Auftrag, einen neuen KI-Zeitplan einzurichten.
