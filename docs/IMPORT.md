# Timetable importieren

Die Veranstalter-Konsole (`/#admin` → Festival wählen → **Import**, oder im Einrichtungs-Assistenten) liest **JSON**, **CSV** (Trennzeichen `,` `;` oder Tab, UTF-8, auch mit BOM) und **Excel (.xlsx, erstes Blatt)**.

## Spalten

Groß-/Kleinschreibung, Leerzeichen und Umlaute in den Spaltennamen sind egal. Die Reihenfolge auch.

| Feld | Pflicht | Erkannte Spaltennamen |
| --- | --- | --- |
| Act | ja | Act, Artist, Name, Künstler, Künstlerin, Band, Performer, DJ |
| Bühne | ja | Bühne, Buehne, Stage, Floor, Area, Venue, Location, Ort |
| Tag | ja* | Tag, Day, Wochentag, Weekday, Festivaltag |
| Datum | ja* | Datum, Date |
| Beginn | ja** | Beginn, Start, Von, From, Startzeit |
| Ende | nein | Ende, End, Bis, To, Until, Endzeit |
| Zeit | ja** | Zeit, Time, Slot, Uhrzeit (z. B. `22:00–23:30`) |
| Genre | nein | Genre, Vibe, Style, Stil, Musik, Tags |
| Beschreibung | nein | Beschreibung, Description, Bio, Info, Text |
| ID | nein | ID, Act-ID, Slug, Kennung |

\* Tag **oder** Datum. \*\* Beginn **oder** Zeit.

## Werte

- **Tag**: Nummer ab 1 (`1`, `Tag 2`), Wochentag deutsch oder englisch (`Freitag`, `Fr`, `Friday`, `Fri`), Datum (`2027-07-16`, `16.07.2027`, `16.7.`) oder die Tagesbezeichnung des Festivals.
- **Zeiten**: `22:15`, `22.15`, `2215`, `22 Uhr`, Excel-Zeitzellen. Zeiten **vor 06:00** gehören zur Nacht des vorherigen Festivaltags: `01:30` und `25:30` bedeuten dasselbe. `24:30` ist erlaubt.
- **Ende fehlt** → 60 Minuten werden angenommen (Warnung). Liegt das Ende vor dem Beginn, gilt es als nach Mitternacht.

## Prüfen, Fehler, Warnungen

Nach dem Laden prüft die Konsole die Datei und der Server macht einen **Probelauf** – noch wird nichts gespeichert. Angezeigt werden:

- **Fehler** (rot, mit Zeilennummer der Datei): fehlender Act, unbekannter Tag, ungültige Zeit, Ende vor Beginn, mehr als 12 Stunden … Solange es Fehler gibt, wird **nichts** importiert.
- **Warnungen** (gelb): fehlendes Ende, doppelte Zeilen (werden übersprungen), Überschneidungen auf derselben Bühne, neu angelegte Bühnen.
- **Zusammenfassung**: neu, geändert, unverändert, entfernt, neue Bühnen.

## Modi

- **Zusammenführen** (Standard): neue Acts kommen dazu, vorhandene werden aktualisiert, nichts wird gelöscht.
- **Ersetzen**: Acts, die nicht in der Datei stehen, werden entfernt. Vorher speichert der Server automatisch einen **Snapshot**; unter „Snapshots vor ‚Ersetzen‘“ lässt sich jeder Stand wiederherstellen.
  Vor dem Bestätigen zeigt die Prüfung, wie viele Besucher:innen entfallende Acts in ihrem (mit dem Server abgeglichenen) Plan haben und wie viele einer Verlegung automatisch folgen (gleicher Act, genau ein neuer Termin). Gruppen unter 3 werden nur als „weniger als 3“ angegeben, einzelne Acts erst ab 3 Plänen aufgelistet.

## Stabile IDs – Favoriten bleiben erhalten

Jeder Act hat eine feste ID. Ohne ID-Spalte ist sie `<Tag>-<Name>` (z. B. `1-maduk`). Wird ein Act nur verschoben, behält er seine ID, und alle Favoriten, Pläne und Meetups bleiben gültig. Wer einen Act umbenennt, setzt eine eigene ID-Spalte, damit er nicht als neuer Act gilt.

## Beispiele

CSV (deutsch):

```csv
Künstler;Bühne;Tag;Beginn;Ende;Genre
Neon Saint;Generator;Freitag;23:00;00:30;Future Garage
Unit 47;Archive;Fr;24:30;02:00;Acid
```

JSON:

```json
{ "acts": [{ "id": "1-maduk", "artist": "Maduk", "stage": "Generator", "day": 2, "start": "20:20", "end": "21:50" }] }
```
