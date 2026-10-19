# Realm – Festival Companion (V2)

Mobile-first Web-App für ein Festival („Realm Open Air 2027“, Demo-Daten). Leitprinzip: **V1 zeigt alle Möglichkeiten – V2 zeigt nur, was gerade relevant ist.**

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```

## Struktur

| Tab | Beantwortet |
| --- | --- |
| **Home** | Was ist gerade wichtig? – passt sich der Festivalphase an (Vorher · Anreise · Festival · Abreise · Danach) |
| **Line-up** | Was läuft, was habe ich geplant? – `Mein Plan \| Alle`, Sticky-Day-Picker, Suche/Filter als Icons, Liste oder Timeline |
| **Map** | Wo ist etwas? – Vollbild, Pan/Pinch/Zoom, Kategorien, Ebenen (Freunde, Meldungen, Pins, Satellit), Route |
| **Crew** | Wo sind meine Leute? – Gruppen pro Stage, nächster gemeinsamer Act, Meetups, Chat, Step-Challenge, Standort teilen |

Profil & Einstellungen öffnen sich über den Avatar oben rechts (dort auch der **Demo-Phasenwechsler**).

## Features

- **Gastmodus ohne Login**: zufällige pseudonyme ID; Name + Farbe werden erst beim ersten sozialen Feature abgefragt; optional sichern per Passkey, Apple/Google oder Recovery-Code.
- **Konflikt-Resolver**: Überschneidungen als eine kompakte Zeile („19:30–20:30 · 3 Acts“), Entscheidung mit Crew-Verteilung, Laufweg, Community-Tendenz – plus **Battle-Modus** (K.-o.-Duell).
- **Updates-Center**: Offiziell / Community bestätigt / Unbestätigt / App-Hinweis, mit Ort, Alter und Ablauf; „Stimmt noch“ / „Behoben“; eigene Meldungen laufen nach 60 Min. ab. Home zeigt maximal zwei.
- **Meetups kontextuell**: aus Act („Vor diesem Set treffen“), Kartenpunkt („Hier treffen“) oder Chatnachricht („In Meetup umwandeln“).
- **Festival Wrapped** (Phase „Danach“): Story-Slides; „Warst du da?“-Abfragen trennen *geplant* von *besucht*.
- **Step-Challenge**: explizites Opt-in, nur Tagessumme, crew-intern, „Top 10 %“ statt öffentlichem Rang.
- Zustand lokal persistiert (localStorage), Bottom-Sheets mit Drag-to-dismiss & Escape, Tap auf aktiven Tab scrollt nach oben, `prefers-reduced-motion` respektiert.

## Visuelles System

Violett nur für Marke und primäre Aktionen · Stage-Farben nur als Punkt/Kante · Grün = live/bestätigt, Amber = Warnung, Rot = kritisch · Uppercase nur für Mini-Labels · ein primärer Button pro Card.

Stack: Vite, React 19, TypeScript, Framer Motion, Lucide.
