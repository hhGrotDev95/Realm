# Löschkonzept (Prüfbericht F12)

Stand Welle 6b. Die Fristen stehen als `RETENTION` in `worker/src/index.ts`; der stündliche Cron (`housekeeping`) setzt jede Zeile um. Abgesichert durch `worker/test/api.test.mjs` „data lifecycle (audit F12)“ und `tests/live.mjs` „deleting the profile …“.

**Bitte prüfen:** Die Fristen sind ein technischer Vorschlag. Zweck und Rechtsgrundlage legt der Verantwortliche fest (siehe offene Entscheidungen zu Art. 26/28).

## Server

| Datenart | Zweck | Frist | Wie |
| --- | --- | --- | --- |
| Gastprofil (Name, Farbe, Token-Hash, Recovery-Hash) | Crew-Funktionen, Wiedererkennung | 180 Tage nach der letzten Aktivität | Cron; löscht kaskadierend Pläne, Schritte, Mitgliedschaften, Nachrichten, Meetups, Stimmen, Meldungen |
| Pläne (gemerkte Acts) | Crew-Übersicht, Auswertung in Summen | mit dem Gastprofil | Kaskade |
| Erinnerungen und „Warst du da?“-Antworten | Wiederherstellen auf neuem Gerät (nicht in Crew oder Auswertung sichtbar) | mit dem Gastprofil | Kaskade |
| Crew-Chat | Austausch in der Crew | 60 Tage nach dem Senden | Cron |
| Meetups | Treffen planen | 60 Tage nach dem Anlegen | Cron |
| Schritte (Tagessummen) | Step-Challenge | 60 Tage nach dem Abgleich; sofort beim Abschalten | Cron / Modul-Schalter |
| Geteilter Standort (Bühnenbereich) | Crew findet sich | 2 Stunden nach der letzten Bestätigung; sofort beim Ausschalten | Cron / Schalter |
| Leere Crews | – | sobald niemand mehr Mitglied ist | Cron |
| Community-Meldungen | aktuelle Lage | 60 Min. bis 4 Std. sichtbar, gelöscht 1 Tag nach Ablauf | Cron |
| Festival-Chat | öffentlicher Austausch | 30 Tage nach der letzten Änderung | Cron |
| FAQ-Bot-Statistik | fehlende Antworten finden | 365 Tage | Cron |
| Offizielle Meldungen | Information | 1 Tag nach Ablauf | Cron |
| Import-Snapshots | Rückgängig machen | 180 Tage | Cron |
| Änderungsprotokoll der Konsole | Nachvollziehbarkeit | 2 Jahre | Cron |
| Konsolen-Sitzungen, Einladungen | Anmeldung | 1 Tag nach Ablauf | Cron |
| Rate-Limit-Zähler, Anmelde-Aufgaben | Missbrauchsschutz | 2 Std. bzw. 10 Min. | Cron |

## Auf Wunsch sofort

- **Profil löschen** (App → Profil): löscht das Serverprofil hinter jeder in diesem Browser gespeicherten Sitzung – für alle besuchten Festivals – und alle lokalen Kopien (`realm.v2*`). Nur öffentliche Festivaldaten (Timetable-Cache) bleiben.
- Nachrichten, die andere schon gelesen oder kopiert haben, kann keine Löschung zurückholen; die App verspricht das auch nicht.

## Gerät (Browser)

| Schlüssel | Inhalt | Löschung |
| --- | --- | --- |
| `realm.v2:<festival>` / `realm.v2` | Plan, Einstellungen, Sitzung, Warteschlange | Profil löschen |
| `realm.bundle:<festival>` | öffentlicher Timetable (offline) | keine Identität; bleibt |
| `realm.festival` | zuletzt gewähltes Festival | keine Identität; bleibt |
| `realm.admin` (sessionStorage) | Konsolen-Sitzung | Abmelden / Tab schließen |
| Service-Worker-Cache | App-Dateien | keine personenbezogenen Daten |

## Offen

- **Backups:** D1 Time Travel hält Daten bis zu 30 Tage nach einer Löschung wiederherstellbar. Das muss in den Datenschutzhinweisen stehen (Welle 7).
- **Auskunft:** Die Auskunft nach Art. 15 ist derzeit ein manueller Vorgang über den Plattform-Betrieb. Ein Export im Profil ist ein möglicher nächster Schritt.
