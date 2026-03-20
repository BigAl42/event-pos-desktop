---
title: Überblick
order: 8
slug: ueberblick
---

# Überblick

**Wann brauche ich das?** Du willst verstehen, wie die App insgesamt aufgebaut ist und welche Bereiche es gibt.

Das Kassensystem ist **offline-fähig** und unterstützt mehrere Kassenplätze (**Hauptkasse** und **Nebenkassen**). Daten werden per **WebSocket** zwischen den Kassen synchronisiert.

## Navigation in der App

![Startseite mit Kacheln (Hauptkasse)](./handbuch/de/assets/startseite.png)

- **Startseite**: Kacheln je nach Rolle (z. B. Kasse, Abrechnung, Storno, Sync-Status, Handbuch, Einstellungen, Händler, Join-Anfragen).
- **Statuszeile** (unten): Rolle, Sync-Text, aktueller Abrechnungslauf, ggf. ausstehende Join-Anfragen, **Hilfe** (öffnet das Handbuch).

## Kernfunktionen

- **Kasse**: Kundenabrechnungen mit 1–n Positionen, automatische Belegnummern (Format **Prefix-Jahr-NNN**), Besetzung (Person 1/2). Details: [Kasse](handbuch://kasse).
- **Storno**: Letzte Abrechnungen, Positionen oder ganze Belege stornieren. Details: [Storno](handbuch://storno).
- **Abrechnung**: Summen/Anzahl pro Händler (Backend), PDF pro Händler; auf der Hauptkasse **Abrechnungslauf abschließen** (Wizard). Details: [Abrechnung](handbuch://abrechnung).
- **Abrechnungsläufe**: Der **aktive Lauf** steuert den „Kassentag“; Buchungen hängen an einer Lauf-ID. Verwaltung in [Einstellungen](handbuch://einstellungen).
- **Sync (Master/Slave)**: Austausch von Kundenabrechnungen (sequenzbasiert) und Stornos. Diagnose: [Sync-Status](handbuch://sync-status).
- **Händler**: Stammdaten und Übersichten – je nach Rolle unterschiedlich. Details: [Händler](handbuch://haendler).

## Daten

- **SQLite** im App-Datenverzeichnis.
- Migrationen im Projekt unter `src-tauri/migrations/` (für Entwickler; in der gebauten App sind sie eingebettet).

## Weiterlesen

- Bedienung: [Kassierer (Bedienung)](handbuch://kassierer)
- Einrichtung & Betrieb: [Technik / Administration](handbuch://technik)
