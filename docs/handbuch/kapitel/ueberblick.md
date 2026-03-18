---
title: Überblick
order: 10
slug: ueberblick
---

# Überblick

Das Kassensystem ist offline-fähig und unterstützt mehrere Kassenplätze (Hauptkasse und Nebenkassen). Daten werden per WebSocket zwischen den Kassen synchronisiert.

## Kernfunktionen

- **Kasse**: Erfassen von Kundenabrechnungen mit 1–n Positionen, automatische Belegnummern (Prefix-Jahr-NNN), Besetzung (Person 1/2).
- **Abrechnung**: Backend-Aggregat „Summe/Anzahl pro Händler“, pro Händler eine 1-seitige A4-PDF.
- **Abrechnungsläufe**: Der aktive Lauf steuert den „Kassentag“; Buchungen hängen an einer Lauf-ID.
- **Sync (Master/Slave)**: WebSocket-Sync für Kundenabrechnungen (sequenzbasiert) und Stornos.

## Daten

- SQLite-Datenbank im App-Datenverzeichnis.
- Migrationen unter `src-tauri/migrations/`.
