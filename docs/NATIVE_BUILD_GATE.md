# A2 · Historische V2-Build-Vorprüfung und Geräteabnahme

> **Einordnung vom 31.10.2026:** Realm ist als Basis gewählt und erhält eine
> eigene iPhone-Hülle. V2 bleibt pausiert: keine weitere V2-Implementierung,
> kein Deployment und keine Geräteprüfung. Der aktive Ablauf steht in
> [`IPHONE_INTEGRATION.md`](IPHONE_INTEGRATION.md). Die folgenden V2-Gerätebefehle
> und Ergebnisse sind archivierte Nachweise vom 30.10.2026 und keine aktuelle
> Arbeitsfreigabe oder Realm-Geräteabnahme.

**Prüfdatum: 30.10.2026 · Ergebnis: erster signierter iPhone-Build installiert und gestartet; Datenpfade noch nicht nachgewiesen.**
Der V2-Kandidat wurde aus Commit `7380ba9389c46a77d7f77b8e0a21810da46da341`
frisch gebaut, mit dem verbundenen iPhone signiert, installiert und gestartet.
Die spätere Prüfung des lokalen IndexedDB-Abzugs zeigte jedoch, dass die eine
gespeicherte Favoritenzeile und alle drei Outbox-Zeilen zur Vorschauausgabe
`LIRVORSCHAU2027` gehören; für eine Staging-Ausgabe gab es keine Datensätze. Der
ursprüngliche Test belegt daher weder Staging-Offline-Erhalt noch eine
funktionierende API-/Outbox-Verbindung. Ursache war ein nicht registriertes
`SecureSession`-Plugin: `registerPluginType` war bei Capacitor 8.5.0 ein No-op.
`requireNativePlugin` scheiterte vor jedem Abruf, daher wurde keine HTTP-Anfrage
aus der App ausgelöst. Eine Korrektur liegt in einem neuen lokalen
Validierungsbranch und wurde in Build 2 kompiliert; Installation und erneute Abnahme sind nicht erfolgt und bleiben pausiert. Zum damaligen Prüfzeitpunkt war die
Architekturentscheidung offen; am 31.10.2026 wurde Realm gewählt. Dieser
V2-Versuch portierte keinen Code zwischen den Projekten. Die Release-Entscheidung vom 30.10.2026 legt für diese
Veröffentlichung iPhone-App plus responsive Website fest; Android-/Google-Play-
App ist abgesagt.
Maßgeblich bleibt [A2 im Winterplan](WINTER_RELEASE_PLAN.md). Frühere Android-
Prüfungen in diesem Protokoll bleiben als historische Belege des früheren Umfangs erhalten,
sind aber keine Voraussetzung oder aktiver Release-Gate.

## Quellstand und Prüfgrenzen

| Gegenstand | Tatsächlich geprüfter Stand |
| --- | --- |
| Realm | `062d8ebf33474fcd55404e9d898d036d42000bdb`, nach Fetch identisch mit `origin/main`; vorhandene lokale Dokumentänderungen erhalten |
| Realm-Arbeitsbranch | `codex/a2-build-preflight`, von diesem main-Stand; Vorgängerbranch `codex/winter-release-plan` unverändert |
| V2-Ausgangsstand | Unterordner `v2/` im separaten Integration-Repository, ursprünglicher Branch `integration`, Commit `7380ba9389c46a77d7f77b8e0a21810da46da341` |
| Aktueller Validierungszweig | Lokaler Branch `codex/iphone-a2-validation` von `7380ba9`; zwei API-Dateien und `LIRBridgeViewController` geändert, lokal und uncommitted. Der Native-Bridge-Fix wurde in Build 2 mitgebaut; der Build wurde nicht installiert oder auf dem Gerät geprüft. |
| Offline-/Cache-Korrekturen | Zusätzlicher Patch liegt in `DOKU/A2_PATCHES/v2-iphone-session-offline.patch` (SHA-256 `d220e6046a772690ec0940d96e1e1be2fad7630213e366dad25583c211990a4f`). Enthält lokale Release-Cache-/Sitzungswachen und UI-Hinweise; Die sieben Web-Dateien sind nur in der temporären Snapshot-Prüfkopie angewandt, die enthaltene Swift-Korrektur auch im V2-Branch. Keine Gerätewirkung belegt. |
| V2-Arbeitskopie | Aktuell die drei oben genannten versionierten Dateien geändert; zwei bereits vorhandene unversionierte Dokumentkopien erhalten |
| V2-Prüfkopie | Anfänglich 242 versionierte Dateien gegen den damals unveränderten Index/HEAD geprüft und kopiert; CRLF bei `gradlew.bat` berücksichtigt. Später kamen die dokumentierten lokalen Korrekturen und Build-Anpassungen hinzu. |
| Abhängigkeiten | Frischer Paketstore und neue `node_modules`, `pnpm@11.19.0`, `install --frozen-lockfile`; keine übernommenen Installationen, `.env`-Geheimnisse oder lokalen Datenbanken |
| Rechner | macOS 27.2, Node 26.5.0, npm 11.17.0; globales pnpm 11.25.0 vorhanden, abschließende Prüfungen mit pnpm 11.19.0 im vorgeschalteten temporären Suchpfad, ohne globale Installation |

### Tatsächlicher iPhone-Build am 30.10.2026

| Gegenstand | Ergebnis |
| --- | --- |
| Xcode / Gerät | Xcode 27.2 (27B52); iPhone 17 Pro Max, iOS 27.2 (24B115), per USB gekoppelt und verbunden; Entwicklermodus durch Hannes eingeschaltet |
| Signierung | Hannes hat das vorhandene Personal Team ausdrücklich für lokale Tests freigegeben. Personal Team kann für diesen Build keine APNs-Fähigkeit bereitstellen. Eine bezahlte Store-Mitgliedschaft ist damit nicht belegt; A1 bleibt offen. |
| Quellstand / App | V2-Commit `7380ba9389c46a77d7f77b8e0a21810da46da341`; `app.lircompanion.unofficial`, Version 1.0 (Build 1), Mindest-iOS 15, SDK iOS 27.2 |
| Lokale Build-Abweichungen | Personal Team in der lokalen `project.pbxproj`; generierte SwiftPM-`Package.resolved` (Capacitor 8.5.0, iongeo 2.1.1); leere gültige plist-Datei außerhalb des Quellprojekts als `CODE_SIGN_ENTITLEMENTS`-Überschreibung. `App.entitlements` im Quellstand blieb unverändert. |
| Ergebnis | Generischer unsignierter iOS-Device-Build und signierter Gerätebuild bestanden. Abschließendes Artefakt mit `codesign --verify --deep --strict` Exit 0; Provisioning-Profil enthält das angeschlossene Gerät; `devicectl install` und `devicectl launch` Exit 0. Ein Simulator-Build wurde nicht nachgewiesen. |
| Artefakt | `/private/tmp/realm-a2-snapshot-oo0oye_6/ios-iphone-final/Build/Products/Debug-iphoneos/App.app`; Manifest-SHA-256 `1527c29fb8b9261608e61288065fc11c674416c9eb33931e3d050aa03abc395b`. Temporär, kein dauerhaftes Release-Artefakt. Vollständiger lesbarer Datensatz: `DOKU/A2_PATCHES/iphone-build-evidence.json`. |

### Zweiter Build vor der Pause

Am 30.10.2026 endete der zweite Build vor der Pause mit `xcodebuild` Exit 0 /
`BUILD SUCCEEDED`. Der Debug-Device-Build enthält die
Swift-Plugin-Registrierungskorrektur und die Release-Cache-/UI-Wachen aus dem
temporären Offline-Patch. Artefakt: Version 1.0 (Build 2) unter
`/private/tmp/realm-a2-snapshot-oo0oye_6/ios-iphone-build2/Build/Products/Debug-iphoneos/App.app`.
Dieser Build wurde nicht auf dem iPhone installiert oder gestartet; es gab
keine Geräteprüfung und keine abschließende `codesign --verify`-Prüfung.
Build 1 blieb der installierte Stand; der IndexedDB-Abzug belegt darin nur
Vorschauausgabe-Datensätze und keine Staging-Daten. Build 2 ist kein Nachweis,
dass der Bridge-Fix oder Offline-Cache auf dem Gerät funktioniert.

Beim ersten Geräteversuch fehlte dem generischen Provisioning-Profil das Gerät
(Installationsfehler `0xe8008012`). Ein nachfolgender inkrementeller Gerätebuild
hatte ungültig versiegelte Ressourcen (`Assets.car` und Profil). Ein vollständig
frisches Derived-Data-Verzeichnis behob den Buildfehler; der oben genannte
Abschlussbuild stammt daraus. Für lokale Tests wurde die Signierungs-
Entitlements-Datei als leere gültige plist überschrieben, damit keine APNs-
Entitlement vorgetäuscht wird. Die App enthält deshalb keinen Nachweis für APNs
oder Push-Zustellung.

Die frühere manuelle Beobachtung, Testdaten und ein Favorit seien nach Flugmodus,
WLAN aus und App-Neustart erhalten geblieben, wurde durch die spätere
IndexedDB-Prüfung eingegrenzt: Eine Favoritenzeile und drei Outbox-Einträge
gehörten ausschließlich zur Vorschauausgabe `LIRVORSCHAU2027`; für Staging gab es
keine Datensätze. Daher ist der Bericht kein Nachweis für Staging-Offline-Erhalt.
Der Abzug wurde nur lesend kopiert und enthält keine Gerätekennungen oder
Rohdatensätze. Beleg: `DOKU/A2_PATCHES/iphone-storage-evidence.json`.

Als technische Ursache wurde festgestellt, dass `bridge.registerPluginType`
mit Capacitor 8.5.0 nicht registrierte, weil `registerPluginType` ein No-op ist.
`requireNativePlugin` schlug vor jedem Datenabruf fehl; die App sendete deshalb
keine HTTP-Anfrage. Zwei API-Dateien und `LIRBridgeViewController` wurden im
lokalen Branch `codex/iphone-a2-validation` korrigiert. Ein neuer Gerätebuild
wurde zwar erstellt, aber nicht installiert oder auf dem Gerät geprüft. Die
Korrektur ist damit noch nicht als wirksam verifiziert.

Danach wurde der autorisierte CORS-Fix in der V2-Staging-API ausgeliefert.
Remote-Prüfungen bestanden: `/health` 200 und `/api/v2/release/current` 200/304
mit `capacitor://localhost`; Release-Anfrage mit der Staging-Web-Origin ebenfalls
200; nicht erlaubte Origin 403 ohne CORS-Freigabe. `Vary: Origin` und
`nosniff` sind vorhanden; Release-Hash und 178 Einträge blieben unverändert.
Das belegt die API-Antworten aus den Prüfaufrufen, aber noch keinen frischen
Netzwerkabruf aus der iPhone-App. Der Prozess der App lief bei der Abfrage weiter.
Die Dateiinventur fand IndexedDB-Daten und WAL, aber im Cache Storage nur den
Salt und keine Service-Worker-Dateien; eine funktionierende Workbox-Cache-
Auslieferung in der nativen Hülle ist daher nicht belegt. Beleg:
`DOKU/A2_PATCHES/v2-staging-cors-evidence.json`.

SHA-256 des unveränderten V2-Lockfiles:
`ee62ccc3f665f4f0c5668ff8eafab63a3b05dc86e8be709d0511cd5f39806b09`.
SHA-256 des Dateimanifests der Prüfkopie:
`f982ed93b985bea5ab506ce23b24dba6d0544737270f1a3b99988c54e26f990c`.

Der zunächst versuchte `git archive`-Export lieferte keinen Fortschritt und wurde
abgebrochen; seine Ursache ist nicht geklärt. Die oben beschriebene, gegen den
Git-Index geprüfte Dateikopie war der tatsächlich verwendete Weg. Das ist ein
frischer Build-Durchlauf, kein Nachweis identischer Binärdateien aus zwei Builds.
Die temporäre Kopie ist kein dauerhaftes Release-Artefakt.

Vor Arbeitsbeginn wurden die offenen Realm-PRs geprüft: #26 und #42 sind noch
offen und wurden weder übernommen noch gemergt. V1 blieb unverändert; die späteren lokalen V2-Korrekturen und das autorisierte V2-API-Deployment sind oben getrennt dokumentiert.

## Tatsächlich ausgeführte Prüfungen

| Prüfung | Ergebnis |
| --- | --- |
| Realm `npm run typecheck`, `npm run test:import`, `npm run build` | Bestanden; alle 17 Testdateien der Unit-/Struktursuite ausgeführt |
| Realm Worker `npm run typecheck` | Bestanden |
| Realm API-/Migrationstests | 42 API-Tests und Erhalt der Altdaten über 4 alte + 16 neue Migrationen bestanden; temporäre Testkopien mit isolierten lokalen D1-Pfaden, bestehende Testdaten erhalten |
| V2 `pnpm install --frozen-lockfile` | Bestanden; 639 Pakete in frischen Store installiert, Lockfile unverändert |
| V2 `pnpm verify:passkey-patch` | Bestanden, 6/6 Patch-Effekte einschließlich Lockfile-/Installationsbindung |
| V2 `pnpm typecheck` | Alle sechs Teilprojekte bestanden, einschließlich Mobile-TypeScript |
| V2 `pnpm test` | 109 Tests bestanden: Domain 31, Admin 16, Web 19, API 43; UI-Paket hat keine Tests, Mobile kein Testskript |
| V2 `pnpm build` | Web und Admin gebaut, API nur mit Wrangler `--dry-run`; kein nativer Build im rekursiven Buildskript |
| V2 `pnpm --filter @lir/mobile sync` (damaliger Android-/iOS-Sync) | Android und iOS synchronisiert; jeweils alle 24 erzeugten Web-Dateien bytegleich in die native Hülle kopiert |
| V2 Android `./gradlew assembleDebug --no-daemon` (historischer Versuch; Android-Ziel inzwischen gestrichen) | Exit 1 vor Kompilierung: keine Java-Laufzeit gefunden |
| V2 iOS erster `xcodebuild … CODE_SIGNING_ALLOWED=NO build` | Historischer Versuch: Exit 1 vor Kompilierung, da die aktiven Command Line Tools keine vollständige Xcode-Installation waren; später mit Xcode 27.2 behoben |
| V2 generischer unsignierter iOS-Device-Build | Bestanden in frischer Prüfkopie nach Xcode-Installation; ein Simulator-Build wurde nicht ausgeführt |
| V2 signierter iPhone-Gerätebuild | Bestanden mit Personal Team und leerer lokaler Entitlements-Überschreibung; Details und Artefakthash oben |
| App-Signatur, Profil, Installation und Start | `codesign --verify --deep --strict`, Geräteprofil, `devicectl install` und `devicectl launch` bestanden |
| V2 Staging-CORS-Deployment | Autorisierter API-Fix ausgeliefert; Remote-Health, Release 200/304, Web-Origin 200 und verweigerte Origin 403 geprüft; Belegdatei oben genannt |
| V2 Web/API offline-cache patch snapshot | Vor der Pause 33 Tests aus 6 Dateien, TypeScript-Prüfung, Web-Build und iOS-Capacitor-Sync bestanden; keine neue Prüfung nach diesen Läufen. Gerätebuild 2 erfolgreich, aber nicht installiert/launched und nicht codesign-verifiziert. |

Der erste Realm-API-Testversuch scheiterte an der Sandbox-Portfreigabe; der
erneute lokale Lauf mit erlaubtem Loopback-Zugriff bestand. V2-API-Tests liefen
mit `remoteBindings: false` aus `apps/api/vitest.config.ts`. Die generische
Workers-AI-Warnung beim Teststart ist kein Provider-Abnahmetest; insbesondere
ersetzen die Tests keine echten Moderations- oder Lastmessungen.

V2 meldet einen Web-Karten-Chunk über 500 kB. Das ist eine Buildwarnung; Ladezeit
und Speicherverhalten auf echten Geräten sind noch nicht gemessen. Browser-E2E,
ein frischer API-Abruf aus der installierten App, native Passkeys, Push,
Hintergrundortung und Store-Verteilung sind offen. Die externe Staging-API wurde
mit dem autorisierten CORS-Fix geändert; Datenbankmigration, Realm-Web-Staging,
Produktion und Store wurden nicht geändert.

## Lücken gegenüber dem Winterplan

| Bereich | Realm-Referenz | V2-Kandidat / offener Nachweis |
| --- | --- | --- |
| Web/Admin | React/Vite, Hono/D1; Build, Unit- und API-Tests aktuell grün | Workspace aus Web, Admin, API, Mobile und zwei gemeinsamen Paketen aktuell geprüft |
| Native Hülle | Keine Capacitor-Abhängigkeiten oder iOS-Projekte im geprüften Stand | Capacitor 8.5.0 und iOS-Projekt; nativer Build, lokale Signierung, Installation und Start bestanden. API-/Sitzungs-/Offline-Geräteverhalten bleibt offen. Android-Projektbefund bleibt nur historischer Kontext. |
| API und Identität | Realm-Gast-/Admin-Modell | Better Auth/Passkeys und native Bearer-Sitzungen; keine Kompatibilität oder Datenmigration zu Realm nachgewiesen |
| Offline | Persistierte Outbox und bestehende Webtests | IndexedDB, Favoriten-/Chat-Outbox und PWA-Cache vorhanden; Neustart, Flugmodus, Wiederanlauf und Duplikatfreiheit in der nativen Hülle offen |
| Standort | Manuell gewählte Orte | Standort-Controller vorhanden; `FORK_NOTES.md` beschreibt noch ausstehenden nativen Ablauf-/Kill-Switch-Fork und Geräteprüfungen |
| Push/Erinnerungen | Kein Nachweis nativer Zustellung | Lokaler Personal-Team-Build ohne APNs-Entitlement; APNs, Domains, Berechtigungen und echte iPhone-Zustellung offen; Web Push/Browsereinschränkungen ebenfalls zu prüfen |
| Release | Web-Staging separat vorhanden | Test-App-ID noch vorläufig; lokale Testsignierung bestanden; native Passkey-Domainbindung, Testverteilung und Store-Abnahme offen |

V2-Belegstellen relativ zu dessen `v2/`: `docs/PROJECT_STATUS.md`,
`docs/RELEASE_RUNBOOK.md`, `apps/mobile/README.md`, `apps/mobile/FORK_NOTES.md`,
`apps/mobile/package.json`, `apps/mobile/capacitor.config.ts`,
`apps/web/src/lib/config.ts`, `apps/web/src/lib/db.ts` und `apps/web/src/lib/auth.ts`.
Historische Prozentangaben aus V2 werden nicht als aktueller Release-Nachweis
übernommen. Die beiden API-/Datenmodelle bleiben getrennt.

## Archivierte Build-Anleitung

Die folgenden Befehle dokumentieren den bisherigen Ablauf. Wegen der oben
festgehaltenen Pause sind sie keine Freigabe für einen weiteren Build oder
Geräteversuch. Erst Hannes’ ausdrückliche neue Entscheidung ändert diesen Stand.

In einer **separaten Kopie des oben genannten V2-Commits**, im Unterordner `v2/`,
mit Node 26.5.0 und pnpm 11.19.0 ausführen. Keine `.dev.vars`, lokalen Datenbanken
oder Signaturschlüssel aus einer bestehenden Arbeitskopie übernehmen. Bei
abweichendem Quellstand den neuen Commit und alle Änderungen mitprotokollieren.

```sh
pnpm --version
pnpm exec pnpm --version
pnpm install --frozen-lockfile
pnpm verify:passkey-patch
pnpm typecheck
pnpm test
VITE_API_BASE_URL=https://api-v2-staging.lir-timetable.com pnpm build
pnpm --filter @lir/mobile exec capacitor sync ios
```

Beide Versionsabfragen müssen `11.19.0` liefern. Ein bloßer Aufruf der
festgelegten `pnpm.cjs` per Node reicht hier nicht: Die rekursiven Skripte können
weiterhin das globale `pnpm` finden. Deshalb den Binärordner der temporären
pnpm-Installation im `PATH` voranstellen. Dieser Unterschied wurde bei der
Abschlusskontrolle gefunden und die betroffenen Prüfungen mit dem korrigierten
Suchpfad wiederholt.

Der API-Wert stammt aus der vorhandenen V2-Staging-Konfiguration; der
vorangegangene Buildbefehl selbst prüft weder Erreichbarkeit noch die Verbindung
aus der nativen App. Externe Origin-Antworten wurden anschließend separat wie
oben protokolliert geprüft. Eine leere Variable lässt V2 in der nativen Hülle
gegen deren eigene Origin anfragen. Die Realm-Staging-API ist kein austauschbares
Ziel. Ein anderer API-Wert erfordert erneuten Web-Build und Sync. Der API-Teil
von `pnpm build` erzeugt nur ein lokales Worker-Bundle.

Xcode 27.2 ist installiert und eingerichtet. In einer frischen V2-Prüfkopie
unter `v2/` zuerst die oben genannten Paket-/Typ-/Test-/Web-Build- und iOS-Sync-
Befehle ausführen. Der generische unsignierte iOS-Device-Build, der tatsächlich
bestanden hat, lautet:

```sh
xcodebuild -project apps/mobile/ios/App/App.xcodeproj \
  -scheme App -destination 'generic/platform=iOS' \
  -derivedDataPath /private/tmp/realm-a2-ios \
  CODE_SIGNING_ALLOWED=NO build
```

Für den reproduzierbaren signierten Build auf einem autorisierten Testgerät die
lokalen Werte `TEAM_ID` und `DEVICE_UDID` einsetzen; sie nicht in die Doku oder
ins Repository schreiben. Erzeuge außerhalb des Quellstands eine gültige leere
plist-Entitlements-Datei und verwende einen vollständig neuen Derived-Data-Pfad.
Ein vollständig frisches Derived-Data-Verzeichnis ist nötig, weil ein
inkrementeller Versuch versiegelte Ressourcen lieferte:

```sh
TEAM_ID='<TEAM_ID>'
DEVICE_UDID='<DEVICE_UDID>'
ENTITLEMENTS='/private/tmp/realm-local-test.entitlements'
DERIVED='/private/tmp/realm-ios-device-fresh'
python3 -c 'import plistlib,sys; plistlib.dump({}, open(sys.argv[1], "wb"))' "$ENTITLEMENTS"
APP_PATH="$DERIVED/Build/Products/Debug-iphoneos/App.app"
xcodebuild -project apps/mobile/ios/App/App.xcodeproj \
  -scheme App -configuration Debug \
  -destination "platform=iOS,id=$DEVICE_UDID" \
  -derivedDataPath "$DERIVED" \
  CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGN_ENTITLEMENTS="$ENTITLEMENTS" \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
xcrun devicectl device install app --device "$DEVICE_UDID" "$APP_PATH"
xcrun devicectl device process launch --device "$DEVICE_UDID" \
  app.lircompanion.unofficial
```

Vor dem Geräteversuch `xcodebuild -version`, `xcrun devicectl list devices`
und den lokalen Projekt-/Paketstatus erfassen. Anschließend das App-Artefakt
mit `codesign --verify --deep --strict`, das Profil auf das Zielgerät und
Installation/Start mit `xcrun devicectl` prüfen. Diese lokalen Build-Anpassungen
sind keine Änderung an `App.entitlements` im Quellstand. Personal Team ist kein
APNs-Nachweis und ersetzt weder TestFlight noch Store-Mitgliedschaft. Keine
Schlüssel oder privaten Geräte-/Teamkennungen speichern. Der frühere
Android-Buildversuch ist ausschließlich historischer Beleg.

## Voraussetzungen und nächster konkreter Schritt

| Voraussetzung | Stand / Verantwortung |
| --- | --- |
| Aktuelle Xcode-Version und iOS-SDK | Xcode 27.2 (27B52) installiert und verwendet; Gerätebuild mit iOS SDK 27.2 bestanden |
| iPhone | iPhone 17 Pro Max, iOS 27.2 (24B115), USB gekoppelt/verbunden; Test-App installiert und gestartet; Projektziel mindestens iOS 15 |
| Apple-Signierung/Testverteilung | Autorisiertes Personal Team für lokalen Testbuild verwendet; APNs nicht verfügbar. Bezahlte Store-Mitgliedschaft, TestFlight und Store-Freigabe bleiben separat offen; A1 bleibt offen. |

Die allgemeine Capacitor-Mindestversion (Xcode 26) ist vom passenden SDK für das
genannte iOS 27 zu unterscheiden. Xcode 27.2 mit iOS SDK 27.2 wurde tatsächlich
verwendet. Frühere Beobachtungen zur App-Store-Oberfläche und fehlenden USB-
Erkennung beschreiben nur den Vorbereitungsversuch vor erfolgreicher Einrichtung;
sie sind kein aktueller Blocker.

Die allgemeinen Xcode-Voraussetzungen stehen in der offiziellen
[Capacitor-8-Umgebungsanleitung](https://capacitorjs.com/docs/getting-started/environment-setup).
Persönliche iPhone-Tests können mit Apples kostenlosem Personal Team möglich sein;
dessen Fähigkeiten und begrenzte Provisionierung ersetzen weder TestFlight noch
die benötigte Store-Mitgliedschaft ([Apple Programmvergleich](https://developer.apple.com/help/account/membership/programs-overview/)).

**Aktueller nächster Schritt (31.10.2026):** Die Basisentscheidung zugunsten von
Realm ist in [`ARCHITECTURE_OPTIONS.md`](ARCHITECTURE_OPTIONS.md) dokumentiert.
Realm-Integration und Geräteabnahme folgen [`IPHONE_INTEGRATION.md`](IPHONE_INTEGRATION.md).
V2 bleibt ohne weitere Implementierung, Bereitstellung oder Geräteprüfung
pausiert. Die folgende Tabelle bewahrt die offenen historischen V2-Nachweise;
sie bewertet nicht die neue Realm-Hülle. Android bleibt Website-Browserziel.

| Nachweis je Gerät | Aktueller Status |
| --- | --- |
| iPhone: Modell, iOS, Commit, Buildnummer, App-ID, API-Ziel, Werkzeugversionen, Artefakt-Hash | Modell, OS, Quellcommit, App-ID/-Version, Xcode/SDK und Artefakt-Hash dokumentiert; Staging-API-Verhalten noch zu belegen |
| iPhone: frische Installation, Start und API-Verbindung | Lokale Installation und Start bestanden; API-Verbindung/Netzwerkbeleg noch offen |
| iPhone: erster Start ohne Netz mit verständlichem Leerzustand | Offen |
| iPhone: Daten herunterladen, Flugmodus, App beenden und neu öffnen | Nur lokale Daten der Vorschauausgabe `LIRVORSCHAU2027` belegt; kein Staging-Datensatz. Staging-Offline-Erhalt nicht belegt. |
| iPhone: Offline-Aktion, Neustart, Wiederverbindung, genau eine serverseitige Aktion | Offen; kein Outbox-/genau-einmaliger Servernachweis |
| iPhone: Anmeldung/Abmeldung, sichere Sitzung, Signierung und Testinstallation | Lokale Signierung, Installation und Start bestanden; Anmeldung/Abmeldung und Sitzung offen |
| Responsive Web: Gerät/OS/Browser/Commit, Darstellung, Kernabläufe, API und Offlinegrenzen | Offen; Browsermatrix fehlt |
| Wiederholung aus frischem Quellstand und dokumentierte Abweichungen | Vollständiger frischer Derived-Data-Build belegt; unabhängige Wiederholung aus frischem Quellstand noch offen |

Diese Liste dokumentiert frühere Abnahmekriterien; sie ist während der Pause
kein Arbeitsauftrag. Nur falls Hannes nach seiner Architekturentscheidung
Prüfungen ausdrücklich wieder freigibt, wären diese Belege vor einer A2-Wahl
heranzuziehen. B2/B4 verlangen gegebenenfalls weitere iPhone-Prüfungen für
Standort, Push, Langzeitbetrieb und Berechtigungswiderruf. Frühere Android-Sync-
und Fehlversuche bleiben als historische Belege des früheren Umfangs dokumentiert.
