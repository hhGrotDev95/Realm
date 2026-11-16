# Realm auf dem iPhone: Architekturentscheidung

Stand: 31.10.2026. Hannes hat entschieden, Realm mit seinem vorhandenen
Funktionsumfang, seiner Oberfläche und seinem Backend als Basis zu behalten und
eine iPhone-Hülle hinzuzufügen. Der separate V2-Kandidat bleibt pausiert. Der
Realm-Shell-Sync und generische unsignierte iOS Debug-Build sind erfolgreich;
das belegt noch keine Signierung, Installation, Laufzeit oder Geräteabnahme.
Die technische A2-Prüfung bleibt offen.

## Was die bisherige V2-Arbeit für Realm bedeutet

Geprüft wurde der **separate LIR-Companion-V2-Kandidat**, nicht eine iPhone-Ausgabe
der aktuellen Realm-Oberfläche. Realm-App und Realm-Backend wurden in diesem
Arbeitsschritt nicht verändert. Die eingerichtete Xcode-/Signing-Umgebung ist
auch für einen späteren Realm-Build nutzbar. Die gefundenen CORS-, Plugin- und
Offline-Probleme liefern technische Erkenntnisse, sind aber bislang Korrekturen
an V2 und kein übertragener Funktionsfortschritt in Realm.

Zum Stand des damaligen Vergleichs war der Realm-Quellstand `062d8eb` mit
lokalen Dokumentänderungen. V2 basierte auf `7380ba9`; drei Korrekturdateien lagen uncommitted auf
`codex/iphone-a2-validation`. Weitere V2-Offline-Änderungen liegen in der
temporären Prüfkopie und als dauerhafter lokaler Patch in der persönlichen DOKU.
Diese Verweise dokumentieren den historischen V2-Prüfstand, nicht den aktiven
Realm-Buildablauf. Die getrennte Dokumentation steht im
[historischen V2-Geräteprotokoll](NATIVE_BUILD_GATE.md).

## Vergleich anhand des vorhandenen Codes

| Bereich | Realm um eine iPhone-Hülle ergänzen | V2 als Basis, Realm-Funktionen übertragen |
| --- | --- | --- |
| Oberfläche | Bestehende Realm-Ansichten Home, Line-up, Karte und Crew samt Gestaltung und Bedienabläufen bleiben die gemeinsame Web-/iPhone-Oberfläche. | V2 hat eigene Ansichten derselben vier Bereiche. Realm-Gestaltung und Abläufe müssten gezielt übernommen oder auf die V2-Komponenten angepasst werden. Die Hülle übernimmt sie nicht automatisch. |
| Besucherfunktionen | Bestehende Pläne, Konflikte, Crew, Chat, Meetups, Meldungen, FAQ und weitere Module bleiben in ihrem bisherigen Datenfluss. | Grundfunktionen überschneiden sich. Realm-spezifische Community-Meldungen, Festival-Chat, FAQ-Bot, Wrapped, Schritte und konfigurierbare Module sind im geprüften V2-Routensatz nicht gleichwertig abgebildet; gewünschte Teile müssten ergänzt werden. |
| Veranstalterwerkzeuge | Bestehende Realm-Konsole mit Import, Karte, Branding, Modulen, FAQ, Meldungen, Live-Timetable-Änderungen und Zugriffsverwaltung bleibt erhalten und kann weiter im Browser laufen. | V2 hat ein separates Edition Studio für Entwürfe, Import, Validierung, veröffentlichte Revisionen und Rollback. Das ist ein anderer Arbeitsablauf; zusätzliche Realm-Betriebsfunktionen müssten daran angepasst werden. |
| Backend und Daten | Realm-Worker, D1, Festival-Mandanten, API und vorhandene Staging-Pipeline bleiben die Basis. Hauptanpassung zunächst an der Grenze zur iPhone-App. | V2 nutzt eigene API-Verträge, Edition-Snapshots, Better Auth, D1, R2, Queues und Durable Objects. Realm-Funktionen wären deshalb überwiegend UI- **und** Backend-Arbeit; ein bloßer Wechsel der API-Adresse reicht nicht. |
| Konten | Realm-Gasttoken/Wiederherstellung und Admin-Konten bleiben. Für iOS sind sichere Tokenablage und native Kontenabläufe zu klären. Die im Realm-README genannten Passkey-/Apple-/Google-Optionen sind im geprüften Besucher-Code nicht als echte Anmeldungen belegt. | Better-Auth-/Passkey-Ansatz und native Sitzungsschicht sind vorhanden. Domain-Verknüpfung, Wiederherstellung und Geräteabnahme sind offen. Bestehende Realm-Identitäten und Daten sind nicht direkt kompatibel. |
| Offline | Realm speichert Festivaldaten, Zustand und Outbox bereits selbst. Gebündelte iOS-App, WebView-Speicher, Lebenszyklus und Service Worker müssen trotzdem separat geprüft werden. | Dexie und eine Favoriten-/Chat-Outbox sind vorhanden. Der neu ergänzte Release-Cache besteht lokale Tests, ist aber nicht am iPhone abgenommen. Das bisher installierte V2 zeigte nur die eingebaute Vorschau. |
| Native Grundlage | Capacitor-/iOS-Projekt und Bundle der bestehenden Realm-Oberfläche sind integriert; Sync und generischer unsignierter Debug-Build bestehen. `capacitor://localhost` erhält bei der lesenden API-Abfrage Health 200, aber noch keinen CORS-Header. CORS-Allowlist ist lokal vorbereitet. Signierung, Installation, Laufzeit, WebView-Speicher, API-/Offline-Abläufe, Links/Exporte und native Dienste bleiben abzunehmen. | Capacitor-/iOS-Projekt sowie Bausteine für Keychain, Erinnerungen, Push und Standort existieren. Build/Installation sind grundsätzlich möglich; sichere Sitzung, echte API-/Offline-Abläufe, Push und Hintergrundortung sind damit noch nicht abgenommen. |
| Umbau und Hauptrisiko | Voraussichtlich der kleinere Eingriff, wenn der heutige Realm-Funktionsumfang erhalten werden soll. Risiko liegt vor allem in nativen Integrations- und Betriebsgrenzen. | Größerer Umbau über Oberfläche, Datenmodelle, Authentifizierung, Admin und Backend hinweg. Risiko: vorhandene Realm-Funktionen nachbauen und erneut abnehmen, während V2 selbst noch native Lücken hat. |

Die qualitative Aufwandseinschätzung folgt aus den gelesenen Abhängigkeiten und
Verträgen. Sie ist keine Termin- oder Kostenzusage und kein Gerätebeweis.
Funktionsnamen im README allein gelten nicht als Nachweis ihrer Fertigstellung.

## Konkrete Quellbelege

- Realm-Oberfläche: [App.tsx](../src/App.tsx), [Module](../src/modules.ts),
  [Veranstalterkonsole](../src/admin/Admin.tsx).
- Realm-API und Mandanten: [API-Client](../src/api.ts),
  [Worker](../worker/src/index.ts), [Staging-Origin](../worker/wrangler.toml).
- Realm-Speicher, Offline und native Grenzen: [Festival-Cache](../src/festival.ts),
  [Zustand/Outbox/Erinnerungen](../src/store.tsx),
  [Persistenz](../src/persist.ts), [Service Worker](../public/sw.js),
  [ICS-Export](../src/calendar/download.ts), [Abhängigkeiten](../package.json).
- Separates V2 unter `lir-timetable-cloudflare-design-integration/v2/`:
  `apps/web/src/app.tsx`, `apps/web/src/screens/crew-screen.tsx`,
  `apps/web/src/lib/db.ts`, `apps/web/src/lib/auth.ts`,
  `packages/domain/src/schemas/edition.ts`, `apps/admin/src/App.tsx`,
  `apps/api/src/routes/`, `apps/mobile/src/` und
  `apps/mobile/ios/App/App/LIRBridgeViewController.swift`.

Realm ist mehrmandantenfähig; V2 setzt auf eine aktive Let-It-Roll-Edition.
Beide nutzen React und Cloudflare, haben aber keine austauschbaren
Daten-/Authentifizierungsmodelle. Gemeinsame Technologien bedeuten hier keine
einfache Komponenten- oder Datenübernahme.

## Getroffene Entscheidung vom 31.10.2026

**Realm bleibt die führende Basis und erhält eine iPhone-Hülle.** Die bestehende
Oberfläche, Funktionen und Backend/API bleiben erhalten. Der erste Shell-Sync,
Web-/Worker-Prüfungen und der generische unsignierte iOS Debug-Build bestanden;
die Laufzeit- und Geräteprüfung sind der nächste technische Gate. V2 bleibt
pausiert; es werden dafür keine Builds, Geräteprüfungen oder Deployments
durchgeführt. Das entspricht der am 31.10.2026 getroffenen Wahl.

Die Architekturentscheidung ist abgeschlossen. Sie erlaubt die Arbeit an der
Realm-iPhone-Hülle; sie ändert weder Realm-Identität noch Backend, Datenmodell
oder Funktionsumfang und belegt keine erfolgreiche Umsetzung. Interne Realm-
Versionsbezeichnungen oder `v2`-Schlüssel sind Teil des bestehenden Realm-
Projekts und bedeuten keinen Wechsel zum separaten V2-Kandidaten. Für den
aktuellen Ablauf siehe den [iPhone-Integrationsleitfaden](IPHONE_INTEGRATION.md);
die native API-, Offline-/Outbox- und Signierungsprüfung bleibt offen.
