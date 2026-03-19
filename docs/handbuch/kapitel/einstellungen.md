---
title: Einstellungen
order: 42
slug: einstellungen
---

# Einstellungen

**Wann brauche ich das?** Du änderst **Kassendaten**, **Netzwerk/Sync**, **Abrechnungsläufe**, den **Notfallmodus** oder führst eine **komplette Löschung** durch.

Die Einstellungen sind in **einklappbaren Bereichen** (Akkordeon) gegliedert.

## Diese Kasse

- **Name** und **Rolle** (Hauptkasse / Nebenkasse) – nur Anzeige.
- **Besetzung**: **Bearbeiten** → Person 1 und 2 → **Speichern** oder **Abbrechen**.

## Netzwerk (Hauptkasse)

- **Server-Port** und **Meine Sync-URL** (WebSocket-Adresse, unter der diese Kasse für andere erreichbar ist). Werte werden beim Verlassen der Felder mitgespeichert.
- **Join-Token**: 6-stelliger Code (Anzeige z. B. als `123 456`); **Neu generieren** erstellt einen neuen Code. Nebenkassen brauchen diesen Code zum Beitreten.
- **Server starten** – danach können Slaves joinen.
- **Sync zu Peers starten** – beginnt den Datenaustausch mit eingetragenen Peer-Kassen.

Siehe auch: [Join-Anfragen](handbuch://join-anfragen) · [Sync-Status](handbuch://sync-status)

## Netzwerk (Nebenkasse)

- Hinweis: Auf dem **gleichen Rechner** funktioniert **mDNS** oft nicht – dann **Hauptkasse auf diesem Rechner (127.0.0.1)** oder URL manuell.
- **Hauptkasse im Netzwerk suchen** – Liste der gefundenen Master; Eintrag wählen setzt die **Hauptkassen-URL**.
- **Hauptkassen-URL** und **Eigene Sync-URL** (unter der diese Nebenkasse erreichbar ist).
- **Join-Code** (6 Ziffern von der Hauptkasse) → **Netz beitreten**.  
  Hinweis: Beitritt kann fehlschlagen, wenn diese Kasse **bereits eigene Buchungen** hat – dann ggf. **Reset-Anfrage** (unten).
- **Sync starten** – Verbindung erneut aufbauen.
- **Reset-Anfrage an Hauptkasse senden**: Die Hauptkasse prüft, ob alle Daten dieser Nebenkasse angekommen sind; wenn ja, wird der **lokale Abrechnungslauf** geleert und an den Lauf der Hauptkasse angeglichen.
- **Closeout bei Hauptkasse anfragen** – Bestätigung, dass alle Buchungen und Stornos dieser Nebenkasse beim Master angekommen sind (für Laufende).
- **Abmelden & entkoppeln** – nur sinnvoll nach erfolgreichem Closeout-Hinweis; trennt die Kasse vom Netz (erneuter Join nötig).

Startseite (Nebenkasse): Bereich **Mit Hauptkasse verbinden** und **Closeout** mit Kurzstatus – siehe [Erststart & Rollen](handbuch://erststart-und-rollen).

## Notfallmodus

Export/Import von **Bewegungsdaten** als **Excel** oder **CSV** – Zusammenführung auf einer anderen Kasse im Notfall. Ausführlich: [Notfallmodus](handbuch://notfallmodus).

## Abrechnungsläufe

- Liste aller Läufe; **aktiver Lauf** gekennzeichnet.
- Nicht aktive Läufe: **Lauf löschen** (mit Bestätigung).
- **Neuen Abrechnungslauf starten**: Name eingeben, zweimal bestätigen – **löscht alle Kundenabrechnungen und Buchungen**; Händlerliste und Kasse bleiben.

Hauptkasse: geführter Abschluss mit Pflicht-Exporten → [Abrechnung](handbuch://abrechnung).

## Danger Zone – Lokale Daten löschen

- **Alles lokal löschen**: Löscht die **gesamte lokale Datenbasis** dieser Installation (inkl. Datenbank). Danach **Erststart** wie bei neuer Installation.
- Sicherheit: Zuerst `DELETE` eintippen, dann bestätigen.

## Häufige Probleme

- **Join schlägt fehl** → Code 6-stellig? Eigene Sync-URL gesetzt? Bereits Buchungen? → Reset-Anfrage oder Datenlage klären.
- **Kein Sync** → Server auf Hauptkasse? **Sync starten** auf beiden Seiten? [Sync-Status](handbuch://sync-status) prüfen.

Siehe auch: [Technik / Administration](handbuch://technik)
