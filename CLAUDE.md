# Realm – Arbeitsanweisungen für automatische Durchläufe

Realm ist eine Festival-Companion-App (Vite/React im Browser, Cloudflare-Worker + D1 in `worker/`). Produktvision, Fahrplan und Stand: `REALM_PROGRESS.md` (unten „Nächster Schritt“), Prüfbericht-Status: `docs/AUDIT.md`.

## Vor jeder Arbeit

1. **Immer vom aktuellen `main` ausgehen.** Der vorgegebene Session-Branch zeigt beim Start oft noch auf den alten Merge `b8ccffe` (PR #13). Auf diesem Stand wurden am 27. und 28.10. bereits erledigte Arbeiten (Karteneditor P6) ein zweites Mal gebaut. Deshalb zuerst:
   `git fetch origin main && git checkout -B <session-branch> origin/main`
   (nur wenn der Branch keine eigenen, ungemergten Commits trägt – sonst diese auf `origin/main` rebasen).
2. Offene PRs prüfen. Eigene PRs werden nach grüner CI selbst gemergt (Absprache vom 20.10.2026).
3. `REALM_PROGRESS.md` → „Nächster Schritt“ lesen; offene Produktentscheidungen dort **nicht** eigenmächtig umsetzen.

## Prüfen

- `npm ci` und `cd worker && npm ci` (nicht vorinstalliert)
- `npm run typecheck`, `npm run test:import` (alle Unit-Tests), `npm run build`
- Browser-Tests mit dem vorinstallierten Chromium: `CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e` (ebenso `test:a11y`, `test:live`)
- Worker: `cd worker && npm run typecheck && npm test`
- Neue UI-Texte über `t('Deutscher Text')` und englisch in `src/i18n/` – der Test `tests/i18n.test.mts` schlägt sonst an.
- Firefox/WebKit laufen nur in CI.

## Fortschritt festhalten

Jede Runde ergänzt `REALM_PROGRESS.md` (erledigt, Prüfungen mit tatsächlichem Ergebnis, Blocker, konkreter nächster Schritt).
