---
title: Abrechnung
order: 30
slug: abrechnung
---

# Abrechnung

In der **Abrechnung** siehst du die Summen pro Händlernummer für den aktiven Abrechnungslauf.

## Funktionen

- **Summen pro Händler**: Werte kommen als Backend-Aggregat (nicht im Frontend berechnet).
- **PDF pro Händler**: Über „PDF erstellen“ wird eine 1-seitige A4-Händlerabrechnung erzeugt (Stammdaten, Lauf, Gesamtsumme, Anzahl Buchungen).

## Abrechnungslauf abschließen (Hauptkasse)

Der Wizard **Abrechnungslauf abschließen**:

1. Prüft das Closeout aller relevanten Nebenkassen (Gate).
2. Speichert Exporte (PDF-Batch + Notfall-Export).
3. Startet einen neuen Lauf (Bewegungsdaten des alten Laufs werden gelöscht).

Optional kann „Trotzdem abschließen (Peers ignorieren)“ mit Bestätigung genutzt werden.
