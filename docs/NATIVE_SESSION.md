# Native Sitzung und Keychain

Implementierung vom 16.11.2026. Der tatsächliche Build-, Geräte- und Veröffentlichungsnachweis steht im jüngsten Eintrag in [REALM_PROGRESS.md](../REALM_PROGRESS.md). Ein bestandener Browserfall ersetzt keine iPhone-Prüfung. A2b bleibt bis zur gesamten nativen Abnahme offen.

## Speichergrenze

Die iPhone-App legt Besucher-Bearer und Wiederherstellungscode in einem eigenen iOS-Keychain-Element ab: Service `app.realm.festival.session.v1`, Account = konfigurierte API-Origin. Der Inhalt enthält getrennte Festival-Slots und die Profilkennung. `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, keine Synchronisierung, keine gemeinsame Access Group. Der Schlüsselbund ist nur bei entsperrtem Gerät lesbar; seine Inhalte wandern nicht mit einem Gerätebackup auf ein anderes iPhone. Es gibt keine Biometriepflicht und keine dauerhafte Hintergrund-Authentifizierung.

Im WebView-Speicher bleiben Profilkennung, Name/Farbe, Favoriten, Crew-/Chat-Snapshots und Outbox. Eine aktive Sitzung enthält dort nur `{id}`, keinen Bearer. Wiederherstellungscodes werden vor jedem nativen Speichern entfernt. Die Website behält ihren bisherigen Browser-Speicherpfad; die Admin-Konsole ist davon getrennt. Keychain schützt Daten im Ruhezustand, nicht vor Schadcode in einem bereits entsperrten WebView: benötigte Zugangsdaten befinden sich während der Nutzung auch im JavaScript-Arbeitsspeicher.

## Erststart und Übergänge

- Vor dem Mounten des Besucher-Stores liest die App die Keychain. Ein Lesefehler führt zu einem Fehlerbild mit Wiederholen, nicht zu einer anonymen Ersatzidentität oder Klartext-Fallback.
- Bestehende `realm.v2`-/`realm.v2:<festival>`-Zugangsdaten werden zuerst in die Keychain geschrieben. Erst danach entfernt die Migration die Klartextfelder, einschließlich des alten Default-Festival-Alias. Favoriten und ausstehende Änderungen bleiben erhalten.
- Identitätswechsel schreiben zunächst einen **geheimnisfreien** Übergangsstand unter `realm.session.pending:<profil-speicherschlüssel>`, dann Credential und Revision atomar in ein Keychain-Element. Ein Neustart kann einen bestätigten Übergang fertigstellen. Die Revision verhindert, dass ein alter Journalstand spätere Favoriten oder Outbox-Einträge überschreibt.
- Ein fehlendes Keychain-Element bei vorhandenem ID-Marker bedeutet abgemeldet: lokale Daten bleiben erhalten, ein Code stellt die Sitzung wieder her. Keychain-Reste ohne passenden lokalen Profilstand werden verworfen, sodass eine Neuinstallation weder alte Profile anmeldet noch deren Serverdaten bei späterer Löschung erfasst.
- Während eines Übergangs sind Bedienung und profilbezogene Hintergrundschreibvorgänge gesperrt. Alte HTTP-Anfragen werden abgebrochen; Rückmeldungen dürfen keine andere Sitzung verändern. Bei einem anderen Profil werden dessen Plan und private lokale Einstellungen verwendet, keine alte Queue, Pins oder Rückzugsentscheidungen übernommen.

## Abmelden, Wiederherstellen und Löschen

**Abmelden:** benötigt ein mit Code gesichertes Profil, Bestätigung über den gesicherten Code und eine leere Outbox. Entfernt die lokale nutzbare Credential, behält lokale Daten und eine Abmeldemarkierung. Anschließend widerruft `POST /api/me/logout` den Bearer auf dem Server. Da Realm derzeit einen Bearer pro Profil hat, betrifft der Widerruf alle Kopien dieses Bearers; Profil und Recovery-Hash bleiben bestehen. Bei fehlender Serverbestätigung sagt die App ausdrücklich, dass nur die Geräte-Abmeldung bestätigt ist. Eine spätere Wiederherstellung rotiert den alten Bearer.

**Wiederherstellen:** derselbe Profilbesitzer behält seine lokale Warteschlange. Bei ausstehenden Änderungen sendet der Client `expectedId`; der Server prüft die Identität vor einer Tokenrotation und lehnt einen anderen Besitzer ab. Ein anderes Profil erhält keine privaten Daten des Vorgängers. Aktive Festival-Aliase derselben Identität übernehmen die rotierte Credential.

**Profil löschen:** bleibt ein eigener endgültiger Vorgang. Identitäten werden nach ID dedupliziert; bestätigte Einzellöschungen werden unter `realm.profile-deletion.v1` protokolliert. Eine 401-Antwort ist kein Löschbeleg. Vor jeder Löschanfrage wird ein Intent unter `realm.profile-deletion-pending.v1` gespeichert. Bei verlorener Antwort oder fehlgeschlagenem Abschluss-Speichern bleibt die Löschung unbestätigt. Die Oberfläche erlaubt erneuten Versuch oder separat bestätigte **reine Gerätebereinigung**, ohne dadurch eine Serverlöschung zu behaupten. Offene Intents bleiben auch nach einem Profilwechsel bestehen. Diese Journale enthalten Kennungen, keine Tokens oder Codes; nach vollständiger Bereinigung werden sie entfernt.

## Prüfung

- `npm run test:session`: Migration, Fehler/Neustart, Aliase, Abmeldung, Wiederherstellung, verwaiste Credentials und Löschfehler mit synthetischen Daten.
- `npm run test:session:browser`: echte App/Store-Oberfläche mit isolierten API- und nativen Bridge-Fixtures; keine echten Nutzerzugangsdaten. Das ist ein Integrationsnachweis, kein iOS-Keychain-Lauf.
- `npm run test:live`: echter lokaler Worker mit isolierter Datenbank, einschließlich verzögerter Sends und Profilgrenzen.
- `npm run ios:sync`, anschließend Xcode-Build und datenerhaltendes Upgrade mit gleicher Bundle-ID/Signierungsidentität.
- Auf dem iPhone: vorhandenes Profil/Favorit nach Upgrade, Prozessneustart offline, Abmelden und Neustart, Wiederherstellen desselben Profils, Wechsel auf separates Testprofil und Rückkehr. Keine fremden Chatnachrichten versenden und keine bestehenden Profile zum Test löschen.

Capacitor-Bridge-Logging ist deaktiviert: eine Debug-Ausgabe der Rückgabewerte könnte sonst Credentials enthalten. Ausschließlich ein Debug-Build mit Startargument `--realm-session-audit` erzeugt feste Keychain-Ereignisse und validierte Zähler (Profile, Web-Tokens/-Codes, Sitzungsmarker, abgemeldet, Favoriten, Outbox). Keine Kennungen, Codes, Chattexte oder Token-Hashes werden ausgegeben. Release-Builds enthalten diese Probe nicht. Eine vollständige Kopie des App-Speichers ist weder erforderlich noch Teil der Prüfung.
