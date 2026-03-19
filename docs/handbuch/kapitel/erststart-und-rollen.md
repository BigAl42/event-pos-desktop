---
title: Erststart & Rollen
order: 40
slug: erststart-und-rollen
---

# Erststart & Rollen

**Wann brauche ich das?** Die App wird das **erste Mal** geöffnet oder du willst die **Rolle** der Kasse verstehen.

## Erststart-Dialog

1. **Als Hauptkasse** – diese Installation wird zur **Hauptkasse** (Master).
2. **Netz beitreten (Nebenkasse)** – diese Installation wird zur **Nebenkasse** (Slave).

Danach: **Kassenname** und **Person 1** / **Person 2** eintragen und abschließen.

## Hauptkasse (Master)

- Stellt den **WebSocket-Server** für Join und Sync bereit.
- **Händlerverwaltung** (Stammdaten), **Join-Anfragen**, **Abrechnungslauf abschließen** (Wizard).
- Auf der **Startseite**: Liste **Angemeldete Kassen** mit Verbindungsstatus und letztem Sync; **Entkoppeln** entfernt eine Nebenkasse aus dem Netz (mit Bestätigung).

Nach dem Setup: in [Einstellungen](handbuch://einstellungen) Server-Port, **Meine Sync-URL**, Join-Token, **Server starten**, dann **Sync zu Peers starten**.

## Nebenkasse (Slave)

- Verbindet sich mit der **Hauptkasse** (URL + 6-stelliger Join-Code + eigene Sync-URL).
- **Keine** Stammdaten-Änderungen an Händlern; **Händlerübersicht** nur **Lesen**.
- **Closeout** vor dem dauerhaften Abmelden wichtig – siehe [Einstellungen](handbuch://einstellungen).

**Startseite (Slave)**:

- Wenn **nicht verbunden**: automatische Suche nach Hauptkassen (**mDNS**); Liste mit **Beitreten** öffnet Dialog für **Join-Code** und **eigene Sync-URL**.
- Wenn **verbunden**: Kurzhinweis und Link zu Einstellungen für erneute Suche.
- Kachel **Closeout anfragen** öffnet die Einstellungen; Anzeige **aktiver Lauf** und **Closeout-Status**.

## Automatischer Start (Hintergrund)

Wenn Rolle und Konfiguration passen, kann die App beim Start **Server** (Hauptkasse) und **Sync** (wenn eine eigene Sync-URL gesetzt ist) **automatisch** versuchen zu starten. Wenn etwas fehlt, erfolgt die Einrichtung manuell in den Einstellungen.

## Häufige Probleme

- **Zwei Kassen auf einem PC** → Entwicklungs-Setup mit getrennten Instanzen; im normalen Betrieb je Kasse eine Installation mit eigener Sync-URL.
- **Master nicht gefunden** → URL manuell in [Einstellungen](handbuch://einstellungen) oder `127.0.0.1` wählen.

Siehe auch: [Technik / Administration](handbuch://technik) · [Überblick](handbuch://ueberblick)
