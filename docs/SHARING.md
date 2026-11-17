# Teilen und Zwischenablage

Stand: 17.11.2026. Die Besucheroberfläche verwendet die vorhandenen Web Share-
und Clipboard-APIs auch innerhalb der iPhone-Hülle. Auf dem verbundenen iPhone
öffnet bereits Build 5 das iOS-Teilen-Menü; Build 6 korrigiert die Rückmeldungen
und vereinheitlicht die Aufrufstellen. Keine zusätzlichen nativen Plugins,
Berechtigungen oder Änderungen an Keychain und Backend.

## Verhalten

- Crew und Home übergeben Einladungstext und genau eine öffentliche HTTPS-URL
  an das Teilen-Menü. Die URL enthält Festival und Einladungscode; native
  Einladungen zeigen niemals auf `capacitor://localhost`.
- Wrapped übergibt den angezeigten Rückblick als Text. Eine erfolgreiche
  Übergabe an das Betriebssystem beweist keine Zustellung an eine Person.
- Fehlt die Share-API, wird der vorgesehene Text/Link kopiert. Die Meldung
  „kopiert“ erscheint erst nach erfolgreich aufgelöstem Schreibversprechen.
- Abbruch (`AbortError`) bleibt ohne Erfolgsmeldung und ohne automatisches
  Kopieren. Andere Fehler zeigen eine verständliche deutsche/englische Meldung.
- „Profil sichern → Kopieren“ schreibt ausschließlich den vom Nutzer gewählten
  Recovery-Code in die Zwischenablage, nicht ins Teilen-Menü. Das ist eine
  bewusste Ausgabe aus der geschützten Sitzung; die Zwischenablage selbst ist
  keine Keychain. Diagnose/Tests lesen keinen echten Code oder Zwischenablageinhalt.
- Laufende Aktionen sperren weitere Klicks bis zum Abschluss. Transportaufrufe
  geschehen im ursprünglichen Klickablauf, ohne vorgelagertes asynchrones Laden
  oder Berechtigungsabfragen, um die Benutzeraktivierung zu erhalten.

Implementierung: `src/sharing.ts` (Transport/Ergebnis), `src/useSharing.ts`
(Bedienzustand/Rückmeldung), Aufrufstellen in Home, Crew, Wrapped und Secure.

## Nachweise und Grenzen

`tests/sharing.test.mts` prüft fehlende, verzögerte und abgewiesene Schreibvorgänge,
Abbruch, Fehler, Payload und synchronen Aufruf. `tests/sharing-browser.mjs` prüft
die echten Schaltflächen mit synthetischen Daten und ersetzten Browser-APIs;
es ist kein Test des iOS-Teilen-Menüs. Der bestehende Live-Test prüft außerdem
Einladungs-URL samt Festival und Crew-Beitritt gegen eine lokale API.

Gerät: Realm 1.0 Build 6, signiert mit derselben Identität wie Build 5,
datenerhaltend installiert. Signatur und 53 gebündelte Webdateien geprüft.
Hannes bestätigt auf Build 6 die beiden Teilen-Menüs aus Crew und Home,
Abbrechen ohne falsche Meldung sowie den über das iOS-Menü kopierten einzelnen
HTTPS-Einladungslink mit Festival und Code. Das private Safari-Ziel zeigt laut Nutzer das richtige Festival samt Einladung. Der Recovery-Code stimmt nach bewusstem Kopieren beim privaten Vergleich im Passwortmanager vollständig überein. Auch offline funktioniert Teilen/Kopieren des Einladungslinks. Wrapped übergibt den erwarteten kurzen Text; Hannes bestätigt dessen Kopie, wieder eingeschaltetes Netz und die wiederhergestellte ursprüngliche Zeiteinstellung. Damit ist der vorhandene Text-/Link-Teilumfang auf diesem Gerät abgenommen.

Keine tatsächliche Nachricht an Dritte wird für diese Prüfung verschickt.
Andere iOS-Versionen/Geräte und Empfang durch beliebige Ziel-Apps bleiben
eigene Kompatibilitätsnachweise. A2b/B4 und Store-Freigabe bleiben offen.

Grundlage: [W3C Web Share](https://www.w3.org/TR/web-share/),
[Clipboard writeText](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText).

## Gewünschte Bildkarten für Wrapped

Hannes wünscht seit dem 17.11.2026 teilbare Bilder für WhatsApp/Social Media:
einzelne Wrapped-Seiten oder eine Zusammenfassung am Ende. Aktuell wird nur der
kurze Text geteilt. Die Bildfunktion ist **nicht implementiert oder abgenommen**.
Empfehlung für die spätere Umsetzung: zuerst eine Zusammenfassungskarte,
anschließend bei Bedarf einzelne Seiten; Variante und Gestaltung sind noch
offen. Der Wunsch ist im nachrangigen Wrapped-Arbeitspaket E1 erfasst und folgt
auf die verbleibenden A2b-Grundlagen. Bilder/Dateien benötigen eine eigene
Export-/Ziel-App-Prüfung; die heutigen Text-/Linktests decken sie nicht ab.
