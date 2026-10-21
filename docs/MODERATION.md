# Meldeweg und Moderationsentscheidungen

Stand Welle 7b. Dies dokumentiert den implementierten Ablauf; die rechtliche Einordnung des Dienstes und verbindliche Community-Regeln müssen die Betreiber festlegen.

- Besucher melden Crew-Nachrichten, Festival-Chat oder Community-Meldungen mit Kategorie und optionaler Erläuterung (bis 1.000 Zeichen). Ein benanntes Gastprofil wird benötigt. Kategorien: Spam/Werbung, Belästigung/Drohung, Hass/Diskriminierung, möglicherweise rechtswidriger Inhalt, anderer Grund. Die Meldung bezeichnet automatisch den konkreten Inhalt.
- Crew-Inhalte können nur freigegebene Mitglieder melden. Veranstalter sehen nur tatsächlich gemeldete Crew-Nachrichten, keine vollständigen privaten Unterhaltungen. Veranstalterzugriffe sind auf das zugeordnete Festival begrenzt.
- Automatisches Ausblenden bleibt eine vorläufige Anzeigeentscheidung (zwei Crew-Meldungen, drei Festival-Chat-Meldungen). Community-Meldungen werden nicht durch einen bloßen Missbrauchsvorwurf automatisch entfernt.
- Die Konsole zeigt Kategorien und Erläuterungen. Entfernen oder Beibehalten verlangt eine Begründung mit 3–1.000 Zeichen. „Offiziell bestätigen“ bei einer Lage-Meldung ist eine gesonderte fachliche Bestätigung.
- Entscheidung, Änderungsprotokoll und Autorenmitteilung werden in einer D1-Transaktion gespeichert. Die Begründung ist im Änderungsprotokoll sichtbar. Andere Besucher erhalten die Begründung nicht.
- Autoren sehen bei entfernten Chat-Inhalten „Vom Veranstalter entfernt: …“ und können Entscheidungen im Profil lesen. Dieser Weg funktioniert auch nach Crew-Austritt oder Ablauf einer Community-Meldung. Er setzt den Zugriff auf das Gastprofil voraus; es gibt keine E-Mail- oder Push-Zustellung.
- Entfernte Lage-Meldungen können durch spätere Bestätigungen nicht wieder veröffentlicht werden. Meldungen desselben Gastprofils sind idempotent.

## Aufbewahrung

Meldegründe werden mit ihrem Inhalt gelöscht (Crew-Chat nach 60 Tagen, Festival-Chat 30 Tage nach letzter Änderung, Lage-Meldungen einen Tag nach Ablauf). Autorenmitteilungen bleiben höchstens 60 Tage; Profillöschung entfernt sie unmittelbar per Fremdschlüssel. Das Änderungsprotokoll einschließlich Entscheidungsbegründung hat die bestehende Frist von zwei Jahren. Deshalb sollen Begründungen keine unnötigen Daten anderer Personen enthalten. Diese Fristen brauchen weiterhin eine Freigabe durch den Verantwortlichen.

## Vor einem öffentlichen Start offen

Der implementierte Ablauf allein belegt keine vollständige Erfüllung des DSA. Die Betreiber müssen Anwendbarkeit, Zuständigkeit, Kontaktstellen, Bearbeitungsfristen, Community-Regeln, Informationen zu Rechtsbehelfen und gegebenenfalls ein formelles Meldeverfahren festlegen. Zu prüfen sind insbesondere die Anforderungen an Meldungen und Entscheidungsbegründungen nach [Art. 16 und 17 DSA](https://eur-lex.europa.eu/eli/reg/2022/2065/oj/deu). Der derzeitige Gastprofil-Meldeweg enthält beispielsweise kein eigenes Kontaktfeld für eine formelle Mitteilung.

Nachweise: API-Test „moderation (Welle 7b)“, erweiterte Mandantentrennung bei „organizer accounts“, Live-Schritte für Crew-/Community-Moderation und Festival-Chat einschließlich erstmaliger Namenseingabe, Smoke-Test für das Meldeformular.
