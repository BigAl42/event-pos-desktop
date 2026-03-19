---
title: Sync-Status
order: 50
slug: sync-status
---

# Sync-Status

**Wann brauche ich das?** Du willst sehen, ob **Sync läuft**, welche **Peers** erreichbar sind und welche **Adressen** verwendet werden.

## Öffnen

Startseite → Kachel **Sync-Status**.

## Sync Runtime

- **Sync gestartet**: Ja/Nein  
- **Verbundene Peers**: Anzahl  
- ggf. **Startzeit** des Sync

## Hauptkassen im LAN (mDNS)

- Button **Suchen** startet eine **Discovery** nach Hauptkassen im lokalen Netz.
- Treffer zeigen **Name** und **WebSocket-URL** (zur Orientierung; zum Verbinden weiterhin [Einstellungen](handbuch://einstellungen) oder Startseite der Nebenkasse nutzen).

## Sync-Peers (konfiguriert)

Liste aller Kassen, mit denen diese Instanz **Sync-Kontakt** hält (Einträge mit gesetzter `ws_url`):

- **Name** / ID  
- **Verbunden** oder **Getrennt**  
- **Letzter Sync** (Zeitstempel; „alt“ kann optisch hervorgehoben sein)  
- **WebSocket-Adresse** (`ws_url`)

**Hauptkasse zusätzlich:**

- **Closeout OK** – Closeout gilt für den **aktuellen Abrechnungslauf**.  
- **Closeout alt** – Closeout vorhanden, aber für einen **anderen** Lauf (Tooltip mit Details).  
- **Entkoppeln** – Peer aus dem Netz entfernen (mit Bestätigung).

Bei **Getrennt** kann ein **Retry-Indikator** (Ring) den nächsten Verbindungsversuch grob anzeigen.

## Keine Peers

Hinweis: In den **Einstellungen** Sync starten – Hauptkasse: **Sync zu Peers starten**, Nebenkasse: **Sync starten**.

## Fehler

Wenn eine Fehlermeldung erscheint, kann **Einstellungen öffnen** direkt aus der Ansicht wählbar sein.

## Häufige Probleme

- **Peers zeigen „Getrennt“** → Firewall, falsche `ws_url`, Gegenstelle nicht erreichbar; Server auf Hauptkasse läuft?
- **Viele/unerwartete Peers** → Alte Einträge; auf Hauptkasse **Entkoppeln** oder Startseite **Angemeldete Kassen** prüfen.

Siehe auch: [Einstellungen](handbuch://einstellungen) · [Technik / Administration](handbuch://technik)
