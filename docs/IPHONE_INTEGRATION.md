# Realm · iPhone-Integration

Stand: 16.11.2026. Realm ist die gewählte Produktbasis: dieselbe React-Oberfläche,
dieselben Funktionen und derselbe Cloudflare-Worker mit D1. Die iPhone-App
bündelt diese Oberfläche mit Capacitor. Das separate V2 bleibt pausiert und
wurde für diese Integration weder geändert noch gebaut.

## Erster Integrationsschritt

- Capacitor Core/CLI/iOS sind auf **8.5.3** festgelegt; Swift Package Manager
  bindet dieselbe Version. Das Xcode-Projekt liegt unter `ios/App/`.
- Lokale Entwicklungs-ID `app.realm.festival`, Anzeigename **Realm**, Version
  1.0, Build 1, Zielgerät iPhone, Mindestziel **iOS 16.4** passend zum expliziten
  Safari-16.4-Buildziel und der bestehenden Web-CSS. Die ID ist noch keine
  bestätigte App-Store-Registrierung. Für den lokalen Testbuild wurde ein lokal
  eingerichtetes Team verwendet; Signierungsgeheimnisse und Profile liegen
  nicht im Projekt. Release-Signing und Store-Registrierung bleiben offen.
- `npm run ios:sync` baut die vorhandene App im Staging-Modus nach `dist-ios/`
  und kopiert sie ins native Projekt. Web-`dist/` und Web-Staging-Build bleiben
  getrennt. Keine entfernte Website als `server.url`, keine zusätzliche
  Navigationserlaubnis und keine Umgehung von WebView-CORS über natives HTTP.
- API und öffentliche Linkadresse werden als absolute HTTPS-Origins geprüft.
  Fehlende/relative Werte, Klartext-HTTP und URLs mit Zugangsdaten brechen den
  nativen Build ab. `.env.staging` enthält ausschließlich öffentliche Adressen;
  `VITE_API_URL` und `VITE_PUBLIC_APP_URL` können bewusst überschrieben werden.
  Der derzeitige Workflow baut ausschließlich eine **Staging-Test-App**.
- Die native Origin bleibt `capacitor://localhost`; sie ist auch die Grenze
  des lokalen WebView-Speichers. Die lokale Worker-Staging-Konfiguration erlaubt
  zusätzlich genau diese Origin. API-Verträge, Datenbank und Authentifizierung
  bleiben unverändert. Einladungslinks verwenden in der App die öffentliche
  Website, im Browser weiterhin dessen aktuelle Origin.
- Der Service Worker läuft nur im Web. Die iPhone-Hülle hat ihre Oberfläche
  bereits im Bundle; Festivalcache, Zustand und Outbox verwenden weiter die
  bestehende Realm-Persistenz. `realm.v2:*` bezeichnet deren unverändertes
  Speicherformat, nicht das separate V2-Projekt. Safari-Daten werden nicht
  automatisch in die neue WebView übernommen.
- Bestehende Safe-Area-CSS bleibt zuständig (`contentInset: never`). App-Icon
  aus `public/icon.svg`, dunkler Startbildschirm entsprechend der Realm-Farbe.
  Keine zusätzlichen Standort-, Push- oder Health-Berechtigungen angefordert.

## Lokal reproduzieren

Voraussetzung: Node ≥ 22.12, Xcode ≥ 26 mit iOS-SDK; hier verwendet wurden Node
26.5.0, npm 11.17.0 und Xcode 27.2 (27B52), iOS-SDK 27.2. Pakete neu mit `npm ci`
installieren. Alle folgenden Befehle laufen im Repository `realm/`:

```bash
npm ci
npm run test:import
npm run ios:sync
npm run ios:open
```

Das iOS-Projekt wird als Quellbestand verwaltet; `cap add ios` nicht erneut
ausführen. Bei SVG-Änderungen kann `node scripts/ios-icon.mjs` mit installiertem
Playwright-Chromium das Icon neu rendern (`CHROMIUM_PATH` unterstützt einen
anderen lokalen Chromium-Browser). Kopierte Web-Assets und `dist-ios/` werden beim
Sync erzeugt und nicht eingecheckt. `native-build.json` im Bundle benennt API,
Webadresse, Quellcommit und lokale Änderungen; `dirty: true` ist kein exakter
Quell-Snapshot. Für verteilte Builds sind Commit und Artefakthash erforderlich.

Unsignierten Geräte-Build erzeugen (prüft Kompilierung, installiert nichts):

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -configuration Debug -destination 'generic/platform=iOS' \
  -derivedDataPath /private/tmp/realm-iphone-derived \
  -clonedSourcePackagesDirPath /private/tmp/realm-iphone-spm \
  CODE_SIGNING_ALLOWED=NO
```

Für signierte Tests Team und Geräteprofil im Realm-Projekt wählen. Keine
Signing-Identität, Provisionierungsdatei oder private Gerätekennung einchecken.
Die separate V2-App wird weder überschrieben noch als Realm-Test gezählt.

## Prüfstand und nächste Abnahme

Build- und Testergebnisse dieses Arbeitspakets stehen in
[`REALM_PROGRESS.md`](../REALM_PROGRESS.md). A2b bleibt bis zur Geräteabnahme
offen; das frühere [`NATIVE_BUILD_GATE.md`](NATIVE_BUILD_GATE.md) enthält nur
historische V2-Belege.

Am 31.10.2026 bestanden Typprüfung, 18 Unit-/Strukturtestdateien, Web-Build und
18 Browser-Smoke-Szenarien; Worker-Typprüfung, 42 API-Tests einschließlich
nativer CORS-Antworten sowie 4 alte + 16 neue Migrationen bestanden in einer
isolierten Prüfkopie. Zusätzlich bestanden alle 28 Mehrbenutzer-Live-Szenarien
gegen eine isolierte lokale API, einschließlich exakt unverändertem
Browser-Einladungslink, Crew-Beitritt, Chat und Offline-Wiederverbindung.
`ios:sync` und der unsignierte generische iOS-Debug-Build
bestanden nach unabhängigem Review mit Mindestziel 16.4. Diese frühere
Kompilierungsprüfung vom 31.10.2026 lag vor dem signierten Gerätebuild und
belegte weder Installation noch Laufzeit. Die Web-Dateien sind
bytegleich in `dist-ios/`, Xcode-Quellbundle und gebauter App enthalten.
CI enthält den iPhone-Web-Build als zusätzlichen Schritt; remote wurde er
noch nicht ausgeführt. WebKit/Firefox und Store-Abnahme wurden nicht
durchgeführt.

Früheres lokales Artefakt der unsignierten Kompilierungsprüfung:
`/private/tmp/realm-iphone-derived/Build/Products/Debug-iphoneos/App.app`.
Es ist unsigniert, nicht installierbar und keine dauerhafte Release-Ablage.

**Staging-CORS, 31.10.2026:** Die Cloudflare-Allowlist wurde gezielt um
`capacitor://localhost` ergänzt. Der Einstellungs-Deploy änderte weder Worker-
Code noch Web-Assets. Öffentlich geprüft wurden Preflight 204, Festival-API 200,
fehlende Authentifizierung 401 und fehlende Route 404; die Antworten enthielten
für Web- und native Origin die erwarteten CORS-Header. Eine nicht erlaubte
fremde Origin erhielt kein `Access-Control-Allow-Origin`. Vorher/Nachher
verglichen wurden Worker-Modulhash und ETag, Assets-Routing, Zeitpläne und
D1-Bindung; diese Werte blieben unverändert. Nur App-Shell (`/`),
`/build-info.json` und Festivalantworten waren bytegleich. Es wurden keine
Assets hochgeladen und keine D1-Migration oder Schreiboperation ausgeführt;
D1-Daten und einzelne Assets wurden nicht verglichen. Diese öffentlichen
API-Prüfungen ersetzen keinen Test aus der installierten App.

**Signierung und Installation, 31.10.2026:** Realm 1.0 (Build 1,
`app.realm.festival`) wurde für ein iPhone 17 Pro Max mit iOS 27.2 gebaut.
`codesign --verify --deep --strict` bestand; das eingebettete Profil enthält
das Zielgerät. Die frische Installation endete erfolgreich; vor der Installation
war keine Realm-App dieses Bundle-IDs vorhanden. Artefakt-SHA-256:
`67a6389e14fcf2a3435f7f330a19fbce7fdad55a07ab20e5154a494022b555e5`.
Der Build stammt vom lokalen, geänderten Arbeitsstand mit Quellcommit
`062d8ebf33474fcd55404e9d898d036d42000bdb`; er ist ein Staging-Testbuild,
kein Store-Build. Zum Ende dieses Installationsschritts waren Start und Laufzeit
noch unbestätigt; die damalige Speicherkopie enthielt keine Realm-Schlüssel.
Die anschließenden Geräteergebnisse sind unten getrennt dokumentiert.

Die Cloudflare-Allowlist wurde per gezieltem Einstellungs-PATCH live geändert.
Die lokale `worker/wrangler.toml` stimmt für Staging damit überein; der
ausgelieferte `main`-Quellstand `062d8ebf33474fcd55404e9d898d036d42000bdb`
enthält jedoch noch die alte Web-only-Origin. Ein regulärer Pipeline-Deploy
könnte die native Origin zurücksetzen. Vor dem nächsten regulären Deploy muss
die geprüfte CORS-Quelländerung integriert sein.

### Erneute Vorprüfung am 31.10.2026

Nach erneutem Fetch steht `origin/main` auf `e7ddf7d` (PR #42 integriert);
offen sind PR #26 und #44. Die lokale iPhone-Arbeitskopie und der installierte
Build bleiben auf Basis `062d8eb` mit vorhandenen lokalen Änderungen. Es wurde
nichts zusammengeführt. Der öffentliche Web-Build meldet weiterhin `062d8eb`,
`dirty: false`; zwölf aktuelle CORS-Prüfungen bestanden, einschließlich nativer,
Web- und fremder Origin. Die Festival-API liefert `realm-open-air` mit 59 Acts.
Diese Daten sind Staging-Testdaten, kein bestätigtes Winterprogramm.

`npm run test:native` bestand erneut. Das vorhandene signierte App-Artefakt hat
weiterhin 81 Dateien und den oben dokumentierten SHA-256. Alle 53 Dateien aus
`dist-ios/` stimmen mit ihren Gegenstücken im App-Bundle überein; dieses enthält
zusätzlich `cordova.js` und `cordova_plugins.js`. Die Signaturprüfung meldete
innerhalb der Sandbox `CSSMERR_TP_NOT_TRUSTED`; derselbe lesende
`codesign --verify --deep --strict`-Aufruf außerhalb der Sandbox bestand mit
Exit 0. Es wurde weder neu signiert noch gebaut oder installiert.

### Geräteergebnisse am 31.10.2026

Geprüft auf dem oben bezeichneten iPhone und unveränderten Build 1,
15:34–15:41 Uhr Europe/Berlin. Die Netzwerkumschaltung führte Hannes aus;
die App wurde anschließend zweimal per
`devicectl device process launch --terminate-existing app.realm.festival`
vollständig neu gestartet (jeweils Exit 0).

| Fall | Tatsächliches Ergebnis und Beleg |
| --- | --- |
| Erster Start ohne Netz | Hannes beobachtete im Flugmodus bei ausgeschaltetem WLAN „Festival nicht erreichbar“ mit „Erneut versuchen“. Die erste App-Library-Kopie enthielt keine Realm-Schlüssel. |
| Download nach Netzrückkehr | Die nächste App-Speicherkopie enthält erstmals den Festival-Cache für `realm-open-air`, inhaltlich exakt identisch mit der öffentlichen Staging-API (59 Test-Acts), sowie einen gespeicherten Favoriten. Kein nativer HTTP-Mitschnitt; der Nachweis beruht auf dem frisch entstandenen Cache und dem API-Abgleich. |
| Favorit und Outbox nach Offline-Prozessneustart | Vor und nach dem Neustart genau ein Favorit mit identischer Plan-Prüfsumme und genau eine Nachrichtenaktion mit identischer ID-Prüfsumme. Hannes bestätigte den sichtbaren Favoriten und „Wird gesendet …“. Beide Serverabfragen fanden die Testaktion noch nicht. |
| Zustellung und weiterer Online-Prozessneustart | Nach Wiederverbindung Outbox leer, die ursprüngliche Aktions-ID und der synthetische Testmarker serverseitig jeweils genau einmal vorhanden. Nach erneutem Prozessneustart weiterhin leere Outbox, derselbe Favorit und genau eine Servernachricht. Hannes bestätigte das Verschwinden des Pending-Hinweises nach Netzrückkehr. |

Die Staging-Testcrew wurde von Hannes eigens angelegt; über die App entstanden
ein Testprofil, eine Crew und eine synthetische Nachricht. Die Verifikations-
GETs verändern keine Nachrichten, können aber über die Authentifizierung den
Aktivitätszeitpunkt `last_seen` aktualisieren. Die Crew-API liefert maximal
200 Nachrichten; in dieser frischen Testcrew waren es vor Zustellung 0 und
danach 1. Keine Datenbankmigration, Veröffentlichung oder Neuinstallation.

**Grenze:** Ein Gerät, ein Offline-Zyklus und ein zusätzlicher Online-Neustart.
Kein Screenshot oder nativer HTTP-Mitschnitt; Netzwerkmodus und sichtbares
Verhalten beruhen auf Hannes' Antworten. Die vollständige Prüfung aller vier
Hauptansichten, Safe Areas, Tastatur, großer Schrift und Hintergrundrückkehr
ist damit nicht abgenommen. A2b bleibt für diese und weitere native Grenzen
offen. Bereinigte Einzelbelege liegen in der persönlichen, Git-ausgeschlossenen
DOKU; öffentliche Dokumente enthalten keine Gerätekennungen oder Zugangsdaten.

### Bedienprüfung auf dem iPhone · Ausgangsstand 31.10.2026

Die damalige ergänzende Prüfung verwendete Realm 1.0/Build 1 auf dem
iPhone 17 Pro Max/iOS 27.2. Der aktuelle Nachtest auf Build 4 steht weiter unten. Hochformat und die vorhandene Schriftgröße sind der
Ausgangspunkt. Schriftvergrößerung wird gesondert geprüft: Ein unverändertes
Layout bei unveränderter Textgröße ist kein bestandener Großschrifttest.

| Prüffall | Konkrete Abnahmebedingung |
| --- | --- |
| Vier Hauptansichten und Ränder | Home und Line-up bis zum Ende scrollen, Act-Detail, Kartenort und Crew-Chat öffnen/schließen. Überschriften und Bedienelemente bleiben frei von Dynamic Island und Home-Balken; untere Navigation und letzte Inhalte sind erreichbar. |
| Tastatur | In Line-up und Karte suchen, Suche leeren und Tastatur schließen; im bestehenden Crew-Chat einen synthetischen Entwurf eingeben. Suchfeld, Texteingabe und Senden bleiben erreichbar; nach Schließen wird die normale Ansicht wiederhergestellt. |
| Große Schrift | Bisherige Einstellung merken, für Realm eine deutlich größere iOS-Textgröße wählen. Prüfen, ob der App-Text tatsächlich wächst; anschließend alle vier Ansichten und Details auf abgeschnittene Texte, überlappende Knöpfe und erreichbare Aktionen prüfen. Einstellung danach zurückstellen. |
| Rückkehr aus dem Hintergrund | Jede Ansicht kurz über den Home-Bildschirm verlassen, dann ohne Beenden der App zurückkehren. Zusätzlich Crew-Chat mit ungesendetem Entwurf für etwa 30 Sekunden verlassen und einmal sperren/entsperren. Ansicht, Bedienbarkeit und Entwurf bleiben erhalten; keine leere oder eingefrorene Oberfläche. Dies ist getrennt vom bereits geprüften Prozessneustart. |

Die iOS-Einstellung lässt sich auf Realm begrenzen:
Einstellungen → Bedienungshilfen → App-spezifische Einstellungen → App hinzufügen
→ Realm. Den ursprünglichen Wert vor dem Test notieren und danach
wiederherstellen ([Apple-Anleitung](https://support.apple.com/de-at/guide/iphone/iph1f48544ab/ios)).
Die Umsetzung verwendet bisher überwiegend feste CSS-Schriftgrößen;
Unterstützung der iOS-Textgröße muss am Gerät beobachtet werden und folgt
nicht allein aus einer erfolgreich dargestellten Oberfläche.

**Bedienbefund vom 31.10.2026, Build 1:** Hannes bestätigte im Hochformat bei
seiner bisherigen Schriftgröße alle vier Hauptansichten einschließlich
Scroll-Enden, Act-Detail, Kartenort und Crew-Chat als bedienbar, ohne verdeckte
oder abgeschnittene Ränder. Das ist eine Nutzerbeobachtung, keine vollständige
Layout- oder Barrierefreiheitsabnahme.

Beim Crew-Chat ist die Tastaturprüfung **fehlgeschlagen**: Nach Fokussieren des
Nachrichtenfelds erscheint die Ansicht stark verschoben; im Screenshot ist
der Senden-Knopf rechts abgeschnitten und der Chatkopf nicht mehr sichtbar.
Nach Schließen der Tastatur bleibt die Vergrößerung/Verschiebung laut Hannes
und zweitem Screenshot bestehen. Ein Prozessneustart stellt die normale
Home-Ansicht wieder her, behebt aber die Ursache nicht. Die App-Version wurde
nicht geändert. Die beiden Suchfelder wurden in der Antwort nicht einzeln
bestätigt und gelten nicht als separat abgenommen.

Die Ursache ist noch nicht isoliert. Die Weboberfläche verwendet für
Eingaben geerbte 15px-Schrift, eine `100dvh`-Hülle und ein scrollbares Sheet
mit feststehender Eingabe. Fokuszoom und die Größen-/Offsetänderung des
WebView bei Tastaturanzeige sind gezielt zu messen; kein pauschaler nativer
Plugin-Umbau ist daraus bereits begründet. Der synthetische Testtext war im
zweiten Screenshot als Nachricht sichtbar. Hannes bestätigt, nur das Häkchen
über der Tastatur betätigt zu haben. Der Chat verwendet einen Formular-Submit;
auch implizites Absenden per Enter ist möglich, ein eigener Blur-Sendehandler
existiert nicht. Die tatsächliche Ereignisfolge des iOS-Häkchens wurde noch
nicht gemessen. Dies ist ein unerwarteter Sendevorgang mit ungeklärter Ursache,
kein belegter Tap auf den Senden-Knopf. Belege bleiben in der persönlichen DOKU.

**Große Schrift:** Hannes meldet sichtbares Textwachstum nach der angeforderten
maximalen app-spezifischen Textgröße. Die übrigen Ansichten und Details sind
laut seiner Prüfung lesbar; er beanstandet jedoch den Chat. Seine bereitgestellte
Aufnahme zeigt Chatkopf, Schließen, Nachrichten, Eingabe und Senden vollständig,
aber die Eingabe steht weit über dem unteren Rand mit großer Leerfläche darunter.
Das Chatlayout bleibt auffällig. Die genaue iOS-Stufe wurde nicht unabhängig
ausgelesen; kein kontrollierter Home-Vorher-/Nachhervergleich. Daher keine
vollständige Abnahme der Textskalierung oder des Chatlayouts.

**Hintergrund und Rückstellung:** Hannes bestätigt die ursprüngliche Textgröße
als wiederhergestellt. Home, Line-up, Karte und Crew blieben nach jeweils etwa
10 Sekunden über den iPhone-Home-Bildschirm erhalten und bedienbar; ebenso das
Act-Detail nach etwa 30 Sekunden Sperren/Entsperren. Dieser UI-Teiltest ist als
Nutzerbeobachtung bestanden; Dauer und Lebenszyklus wurden nicht mitgeschnitten.
Die spätere Prozessabfrage fand eine andere Realm-Prozesskennung als die frühere
Vergleichsmessung. Der Messabstand umfasst auch Einstellungsänderungen und
Wartezeit; Zeitpunkt und Ursache des Wechsels sind unbekannt. Daraus folgt weder
ein Fehler beim Hintergrundwechsel noch der Nachweis ununterbrochener
Prozesslaufzeit. Ein Chatentwurf wird wegen des bekannten Tastaturfehlers erst
nach dessen Korrektur isoliert geprüft. Die beiden diagnostischen Neustarts
zählen nicht als Hintergrundtest. A2b und B4 bleiben offen.

### Geräteablauf mit getrennten Nachweisen · Laufzeitprüfung vom 31.10.2026

Diese historische Abfolge wurde mit Realm `app.realm.festival`, Version 1.0/Build 1,
ausgeführt. Bei neuen Prüfungen den aktuellen Build ausdrücklich protokollieren. Nicht mit der separaten V2-App verwechseln. Zunächst entsperrt per
USB verbinden; keinen vorhandenen App-Speicher löschen. Falls bereits ein
Festival-Cache vorhanden ist, zählt ein Offline-Start als Cachetest und nicht
als frischer Erststart.

| Schritt | Durchführung und erwartetes Ergebnis | Benötigter Nachweis |
| --- | --- | --- |
| 1 · Erster Start ohne Netz | Flugmodus an, WLAN aus, Realm öffnen. Ohne gespeicherte Festivaldaten erscheint „Festival nicht erreichbar“ mit „Erneut versuchen“. | Nutzerbeobachtung mit Zeitpunkt; Start/Fehlerzustand und fehlenden Festival-Cache getrennt belegen. Installation oder leere Speicherkopie allein genügt nicht. |
| 2 · Festival vom Server | Netz einschalten, „Erneut versuchen“. Home, Line-up, Karte und Crew öffnen. | Erfolgreicher Festival-GET aus der App oder frisch gespeicherter Festival-Cache, der zur aktuellen Staging-Antwort passt; Modell/OS und Build festhalten. Angezeigte Namen allein beweisen keinen API-Abruf. |
| 3 · Plan nach Prozessende | Einen Act als Favorit markieren, Speicherung abwarten. Flugmodus an, WLAN aus, Realm im App-Umschalter vollständig beenden und erneut öffnen. | Festivaldaten und derselbe Favorit bleiben erhalten. Favoriten gehören zum lokalen Plan; sie sind keine Outbox-Nachrichten. |
| 4 · Outbox nach Prozessende | In einer eigenen Testcrew online Sitzung herstellen. Offline genau eine eindeutig markierte synthetische Testnachricht senden. „Wird gesendet …“ und eine wartende Änderung prüfen; App vollständig beenden und offline erneut öffnen. | Derselbe Outbox-Eintrag bleibt mit derselben ID erhalten. Nach Netzrückkehr Outbox leer und genau eine Nachricht mit dieser ID serverseitig; nach erneutem Öffnen weiterhin genau eine. |

Technische Lesepunkte im Realm-WebView-Speicher: Festival unter
`realm.bundle:realm-open-air`, Plan und Outbox unter
`realm.v2:realm-open-air`. Für Belege nur Cache-Vorhandensein/-Vergleich,
Plan-/Outbox-Anzahl und den Bezug der synthetischen Testaktion festhalten.
Keine Sitzungstokens, Crew-Codes, persönlichen Nachrichten oder vollständigen
Storage-Dumps in öffentliche Dokumente übernehmen. Eine lesende Serverabfrage
oder eine zweite berechtigte Crew-Ansicht muss die Zustellung bestätigen;
ein verschwundener Pending-Hinweis allein genügt nicht.

Diese vier Fälle sind ein Teil von A2b. Safe Areas, Tastatur, große Schrift,
Hintergrundrückkehr und die unten genannten nativen Integrationsgrenzen bleiben
separate Prüfungen; auch vier bestandene Fälle schließen A2b nicht pauschal ab.

Nächste Schritte in dieser Reihenfolge:

1. **Erledigt:** Realm-Staging-CORS gezielt aktualisiert und öffentliche
   Antworten, Preflight, Authentifizierungsfehler und fremde Origins geprüft.
   Worker-Einstellungen wurden gezielt geändert; keine Assets hochgeladen,
   keine D1-Migration oder Schreiboperation ausgeführt.
2. **Teilprüfung erledigt:** Erster Offline-Start, Staging-Festivaldownload,
   Plan-/Outbox-Erhalt nach Offline-Prozessneustart und einmalige Zustellung
   einschließlich weiterem Online-Neustart sind wie oben belegt.
3. **Bedien-Teilpaket am 13.11. erledigt:** Fokuszoom und Chat-Höhe korrigiert,
   Tastatur/Häkchen mit Entwurf, Suchfelder, große Schrift und Hintergrundrückkehr
   in Build 4 im unten beschriebenen Umfang geprüft; Originalschrift wiederhergestellt.
   Längere Laufzeit, weitere Netzfehler und Browser-Kompatibilität bleiben B4-Fälle.
4. **Als Nächstes:** Native Sitzungs-/Tokenablage samt Logout/Profilwechsel/Neustart
   prüfen und sichere Sitzung/Keychain schließen. Weitere Integrationslücken:
   Teilen/Clipboard, Kalenderexport, Universal Links und native Erinnerungen.
   Aktuelle Web-Erinnerungen sind keine nativen Hintergrund-Wecker. APNs und
   Hintergrundstandort bleiben eigene Aufgaben im Winterplan. Vorhandene
   Funktionen bleiben erhalten, ihre iOS-Unterstützung wird einzeln geprüft.
5. Danach TestFlight/Store-Gates aus dem Winterplan; kein Web-Test ersetzt die
   echte iPhone-Abnahme. Bezahlte Mitgliedschaft, Release-Signing und Store-ID
   sind noch nicht durch diesen lokalen Build erledigt.

Die frühere `npm audit`-Prüfung meldete sechs moderate Befunde im **Entwicklungswerkzeug**
Capacitor CLI (transitiv glob/minimatch/rimraf und uuid/xcode). Der vorgeschlagene
Downgrade auf Capacitor 4 wurde nicht angewendet. Vor CI-/Release-Freigabe
Upstream-Korrekturen erneut prüfen; keine automatischen Major-Overrides.

## Technische Quellen

- [Capacitor: bestehendes Webprojekt integrieren](https://capacitorjs.com/docs/getting-started)
- [Capacitor 8: Voraussetzungen und SPM](https://capacitorjs.com/docs/updating/8-0)
- [Konfiguration und lokale WebView-Origin](https://capacitorjs.com/docs/config)
- [Capacitor-Veröffentlichungen](https://github.com/ionic-team/capacitor/releases)


### Chatkorrektur und Gerätevergleich · 13.11.2026

Lokaler Branch `codex/realm-chat-keyboard`, frische main-Basis `a08bef9`;
vorherige Änderungen erhalten, PR #26 offen. Web-Staging liefert `a08bef9`.
Der Quellpatch ist nicht committed oder gemergt. Der installierte Realm-Teststand
ist inzwischen **1.0 Build 4**; die älteren Gerätebelege bleiben versionsgebunden.

Crew-Chat sendet nur durch ausdrückliche Aktivierung von **Senden**. Enter und
Fokusverlust erhalten den Entwurf. Nachrichten scrollen getrennt; die Eingabe
liegt am unteren Rand des Chatbereichs und kann größere geerbte Schrift
übernehmen (mindestens 16px). `useChatKeyboard` passt ausschließlich das native
Crew-Sheet bei unskalierter Tastaturansicht an den sichtbaren Clientbereich an.
Es kompensiert die am Gerät gemessene Verschiebung des App-Rahmens, berücksichtigt
oben die Safe Area und wartet beim Schließen sowohl Höhen- als auch Pan-Rückkehr
ab. Keine globale Hüllenänderung, Zoomsperre oder neue Keyboard-Bibliothek.

| Vergleich | Befund |
| --- | --- |
| Build 2, Ausgangslayout | 15px-Eingabe; Fokuszoom 1→1,0659, Senden rechts abgeschnitten und Chatkopf außerhalb. Nach Häkchen weiter gezoomt/verschoben, später selektiv wiedergewonnener Blur-Nachweis mit Skalierung 1,0659 und Scroll 59. Im leeren Versuch kein Keydown/Submit; das beweist nicht die Ursache des unerwarteten Versands vom 31.10. |
| Build 3, erster Fix | 16px, kein Fokuszoom und normale Rückkehr nach Blur. Bei geöffneter Tastatur blieb die 956px-Hülle jedoch bestehen; Pan 415px, Sheetoberkante −339px. Hannes bestätigte schließlich fehlende Überschrift/Nachrichten. |
| Build 4, zusätzlicher Höhenfix | Sofortige Fokusaufnahme, Messwerte und Nutzerbeobachtung bestätigen Kopf, Schließen, Nachrichten und Eingabe vollständig sichtbar: Sheet y=62…541, Höhe 479; Senden bis y=533 bei sichtbarer Höhe 541; Skalierung 1. Nach Blur normale Höhe/Position. |
| Build 4, Entwurf | Laut Hannes bleibt „Realm Entwurf 4“ nach dem weißen Häkchen in der Zubehörleiste ungesendet im Feld, Ansicht normal. Eine weitere kurze Nachricht wurde bewusst über Senden verschickt. Kein zusätzlicher Serverzustellcheck. |

Alle drei signierten Debug-Builds bestanden Signaturprüfung und Vergleich ihrer
je 54 Webdateien. Installation/Versionsabfragen erfolgreich; CLI-Buildnummern
2, 3 und 4 überschreiben die unveränderte Projekt-Buildnummer 1. Aktuelles
Artefakt: `/private/tmp/realm-keyboard-fit-ios/Build/Products/Debug-iphoneos/App.app`.
Temporäre Dateien sind keine dauerhafte Release-Ablage. Profile/Identitäten und
Kennungen stehen nicht im öffentlichen Projekt.

Fünf finale Chat-Browserfälle bestanden, einschließlich nachgebildeter nativer
Viewport-/Pan-Geometrie, Entwurferhalt, 320px-Layout, geerbter 22px-Schrift,
Höhenwechsel, versetzter Rückstellung, bewusstem Zoom und Sheetwechsel.
Ausgangsfehler wurden jeweils rot reproduziert. Typprüfung und finale Web-/iOS-
Builds bestanden. Vor dem zusätzlichen Höhenpatch bestanden außerdem
`test:import`, 18 Chrome-Smoke-Fälle und Barrierefreiheitssuite ohne schwerwiegende
Befunde. CI enthält den Chatcheck für Chromium/Firefox/WebKit; lokal lief
vorhandenes Google Chrome. Remote-CI, Firefox/WebKit und vollständige
Live-/API-Suite wurden nicht wiederholt. Browser-Simulation ersetzt keine
Geräteprüfung. Hannes bestätigt inzwischen Erhalt und Bedienbarkeit nach
kurzem Hintergrundwechsel und Gerätesperre mit Entwurf sowie beide Suchfelder
ohne Verschiebung. Beim angeforderten Maximum der app-spezifischen iOS-Schrift
meldet er sichtbares Textwachstum und lesbare/erreichbare vier Ansichten samt
Details und Chat; die Chataufnahme belegt erreichbare Bedienelemente. Der
ursprüngliche Wert ist wiederhergestellt. Exakte iOS-Textkategorie, tatsächliche
Skalierungszunahme und durchgehende Prozesslaufzeit wurden nicht unabhängig
gemessen. Dieses Bedien-Teilpaket auf einem Gerät im Hochformat ist abgeschlossen;
die übrigen A2b-/B4-Fälle bleiben offen.

Die native Staging-Origin fehlte nach neuerem Web-Deploy erneut und wurde per
autorisiertem Settings-PATCH wiederhergestellt: 12/12 Fälle bestanden.
Vergleichsgrenzen im [Staging-Leitfaden](STAGING.md#native-origin-erneut-wiederhergestellt--13112026).
Die CORS-Quelländerung muss vor einem regulären Pipeline-Deploy integriert sein.

### Begrenzte Tastaturdiagnose

`scripts/keyboard-probe.mjs` injiziert ausdrücklich nur in das erzeugte native
Bundle eine lokale Messung (höchstens 300 Einträge): Fokus/Blur, kategorisierte
Tasten/Submit, Viewport-Größe, Offset, Skalierung, Geometrie und Schriftgröße.
Keine Eingabetexte, Chats, Tokens oder Gerätekennungen; kein Upload. Speicherung
nur in `realm.debug.keyboard.v1`. Ab Build 4 werden beim Start ausschließlich
bereinigte Werte dieses Schlüssels unter einem getrennten History-Präfix erneut
ausgegeben. Dadurch wurden 64 historische Messwerte ohne App-Speicherkopie
wiedergewonnen. Feste Enum-/Feld-/Zahlen-Whitelist, Syntax- und isolierter
VM-Datenschutzcheck sowie unabhängiger Review bestanden.

```bash
npm run build:ios
node scripts/keyboard-probe.mjs
npx cap sync ios
```

Danach signierten Debug-Build mit passender `CURRENT_PROJECT_VERSION` erstellen.
`npm run ios:sync` zwischen Injektion und Xcode-Build würde neu bauen und die
Injektion entfernen. Ein normaler Neubau enthält keine Diagnose; gespeicherte
Diagnosewerte löscht er nicht. Konsolenverbindungen endeten teils mit Exit 0;
daraus wurden weder Absturzursache noch durchgehende Prozesslaufzeit abgeleitet.
Eine vollständige Library-Kopie wurde von der automatischen Freigabeprüfung
abgelehnt und nicht ausgeführt. Der Messwertabruf nutzt ausschließlich den
eigenen Diagnoseschlüssel, keine Umgehung über andere App-Speicherpfade.


## Gemeinsamer Quellstand · 16.11.2026

[PR #54](https://github.com/hhGrotDev95/Realm/pull/54) verbindet die lokale
Realm-Hülle und den Build-4-Tastaturfix mit PR #53. Die native CORS-Allowlist
ist dabei im Worker-Staging-Quellstand enthalten. Der integrierte Stand bestand
Typprüfungen, Unit-/Native-Guards, 18 Chrome-Smoke-Fälle, fünf Chatfälle,
17 Barrierefreiheitsansichten, API/Migrationen sowie den vollständigen
29-Szenarien-Live-Nachlauf. Ein weiterer Ausfall des Zwei-Tab-Offlinetests
in der GitHub-CI führte anschließend zur Ursachenbehebung: Wartende Aktionen
bleiben ohne ausdrückliche Abschluss-ID erhalten, bestätigte Chatzeilen werden
nicht durch ältere wartende Snapshots ersetzt. Profilwechsel übernehmen keine
fremde Queue; laufende Sendungen/Refreshes prüfen ihren Sitzungskontext.
Wiederherstellung desselben Profils erhält wartende Nachrichten trotz Tokenwechsel.
Die erweiterten Unit-/Live-Regressionen und tatsächlichen Abschlussresultate
sind im jüngsten Eintrag von [REALM_PROGRESS.md](../REALM_PROGRESS.md) dokumentiert.

`ios:sync` und ein unsignierter generischer Xcode-Debug-Build bestanden;
53 Webdateien waren bytegleich in Buildausgabe, Quellbundle und App-Bundle.
Dieser Build wurde nicht installiert. Build 4 vom 13.11. bleibt die letzte
Geräteabnahme im oben beschriebenen Teilumfang. A2b/B4 bleiben offen;
als Nächstes folgt die sichere native Sitzung/Keychain. Die laufenden und
abgeschlossenen Remote-Prüfungen sind am Integrations-PR einsehbar.

## Sitzungs-Teilpaket abgeschlossen · 16.11.2026

Realm 1.0 Build 5 ist signiert über Build 4 installiert. [PR #57](https://github.com/hhGrotDev95/Realm/pull/57) ist zusammengeführt. Die iOS-Brücke registriert das eigene Keychain-Plugin explizit; Besucher-Bearer und Recovery-Code verlassen den WebView-Speicher. Vertrag, Migration, Fehlerpfade und lokale Debug-Zähler sind in [NATIVE_SESSION.md](NATIVE_SESSION.md) beschrieben.

Gerät: Hannes bestätigt erhaltene Identität/Crew/beide Favoriten nach Upgrade und Offline-Prozessneustart. Testprofil B erscheint ohne die Daten von A und bleibt nach Neustart B; Code A bringt das Originalprofil zurück. Online-Abmeldung bewahrt die Favoriten, bleibt nach Neustart abgemeldet, anschließend stellt Code A alles wieder her. Die Zähler bestätigen null Klartext-Credentials, erfolgreiche Keychain-Zugriffe und passende An-/Abmeldemarker. Das ursprüngliche Profil ist abschließend aktiv. Codes wurden ausschließlich vom Nutzer privat gespeichert/eingegeben.

Build 5 wurde vor dem Commit gebaut; seine Metadaten kennzeichnen Basis `95975e7` plus lokale Änderungen. Signatur, Team-/Bundle-Identität, alle 53 Webdateien und private Quellhashbelege binden das tatsächlich getestete Artefakt. Dokumentations-/Merge-Commits sind keine neu installierten Builds. Native Ausfall-/Crash-/Neuinstallationsfälle sind zusätzlich synthetisch geprüft, kein physischer Gerätewechsel. A2b/B4 bleiben offen. Nächster Arbeitsschritt: Teilen/Clipboard, danach Kalenderexport, Universal Links und native Erinnerungen.
