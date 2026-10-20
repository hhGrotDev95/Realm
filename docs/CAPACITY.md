# Kapazität, Last und Ausfallverhalten (Prüfbericht F08, F17)

Stand Welle 4. Alles hier ist **Rechnung und lokale Messung, keine belegte Belastungsgrenze**. Die gibt es erst mit einem Lasttest gegen eine Staging-Umgebung auf Cloudflare (Voraussetzung: Deployment, Roadmap-Schritt 8).

## Kapazitätsziel (Annahme, bitte bestätigen)

| Größe | Ziel |
| --- | --- |
| Besucher:innen gesamt | 30.000 |
| gleichzeitig aktiv mit offener App | 10.000 |
| davon gerade in Benutzung (≤ 2 Min. ohne Eingabe) | 3.000 |
| Neuanmeldungen in der Einlass-Spitze | 300 pro 10 Min. hinter **einer** WLAN-IP |

## Anfragen pro Sekunde (Rechnung)

Jede Poll-Runde = 1 Crew-Abruf + 1 Meldungsabruf. Verdeckte Tabs fragen gar nicht.

| Zustand | Intervall (±20 % Streuung) | 10.000 Nutzer:innen |
| --- | --- | --- |
| in Benutzung | 8 s | 2.500 Anfragen/s |
| unberührt seit 2 Min. | 30 s | 667 Anfragen/s |
| unberührt seit 15 Min. | 60 s | 333 Anfragen/s |

Mit dem Ziel oben (3.000 in Benutzung, 7.000 unberührt) ≈ 750 + 470 = **rund 1.200 Anfragen/s** statt 2.500 vorher. Die Streuung verhindert, dass Tausende Handys in derselben Sekunde fragen.

**DB-Budget:** Ein Crew-Abruf liest 7 Abfragen in einem D1-Batch (inkrementell: nur neue Nachrichten), ein Meldungsabruf 1 Abfrage. Bei 600 Crew-Abrufen/s also ≈ 4.200 Lesevorgänge/s. Das ist die Zahl, die ein Staging-Lasttest bestätigen oder widerlegen muss.

## Ausfallverhalten

- Jede Anfrage bricht nach 15 s ab (Konsole: 60 s), zählt als Netzfehler und wird später wiederholt. Eine hängende Anfrage blockiert die Warteschlange nicht mehr (`tests/live.mjs` „a hanging request times out …“).
- Bei Fehlern verdoppelt sich die Wartezeit bis 2 Min.; Wiederkehr von Netz oder Tab synchronisiert sofort.
- Schreibvorgänge tragen eine Client-ID und werden bei Wiederholung nur einmal gespeichert.

## Anmeldungen hinter geteilten IPs (F08)

- 60 Anmeldungen pro IP und 10 Min. ohne Hürde.
- Darüber löst das Gerät eine einmalige Proof-of-Work-Aufgabe (12 Bit ≈ 0,2 s, mit der Menge steigend bis 20 Bit).
- Harte Grenze: 3.000 pro IP und Stunde.
- Andere Limits hängen am Gastprofil, nicht an der IP.
- Abnahme: 300 Besucher:innen hinter einer IP, daneben ein Skript ohne Lösung (`worker/test/api.test.mjs` „festival WLAN (audit F08)“).

## Lokales Lastskript

```
cd worker
npx wrangler dev --local --port 8797
node scripts/load.mjs --users 200 --seconds 40
```

Lokale Messung (Entwicklungsrechner, wrangler dev, lokale D1): 200 Besucher:innen in Crews zu fünft hinter einer IP, Poll alle 8 s, 5 % schreiben pro Runde: 51 Anfragen/s, Latenz p50 32 ms, p95 80 ms, p99 126 ms, keine Fehler.

## Offen (braucht Staging)

- Lasttest mit 10.000 simulierten Nutzer:innen und Netzabbrüchen gegen Cloudflare.
- Monitoring/Alarme (Fehlerquote, Latenz, D1-Limits) und ein Wiederherstellungsplan für D1 (Time Travel).
