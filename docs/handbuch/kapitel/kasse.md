---
title: Kasse
order: 20
slug: kasse
---

# Kasse

**Wann brauche ich das?** Du erfasst eine **Kundenabrechnung** (ein Beleg mit einer oder mehreren Positionen).

**Schritte (kurz)**

1. Startseite → **Kasse**.
2. **Besetzung** prüfen oder über **Ändern** Person 1 / Person 2 anpassen und **Speichern**.
3. Pro Position: **Händlernummer**, **Betrag**, optional **Bezeichnung**.
4. **Kundenabrechnung abschließen** – die **Belegnummer** wird automatisch vergeben (Format **Prefix-Jahr-NNN**).

## Voraussetzungen

Die Kasse ist nur buchbar, wenn:

- ein **aktiver Abrechnungslauf** existiert und
- die Kasse mit der Rolle/Hauptkasse **abgestimmt** ist (keine Sperrmeldung).

Andernfalls erscheint ein Hinweis – ggf. [Einstellungen](handbuch://einstellungen) oder [Erststart & Rollen](handbuch://erststart-und-rollen) prüfen.

## Positionen

- **Mehrere Positionen**: **+ Position hinzufügen** oder Tastatur (siehe unten).
- **Zeile entfernen**: Button **−** oder **Strg+Entf** / **Strg+-** bei Fokus in einer Positionszeile.
- **Betrag**: Komma oder Punkt möglich (z. B. `12,50` oder `12.5`).

## Unbekannte Händlernummer

Wenn eine eingegebene Nummer **nicht** in der Händlerliste steht, erscheint ein Hinweis mit **Abbrechen** und **Trotzdem buchen**. Stammdaten pflegst du an der **Hauptkasse**: [Händler](handbuch://haendler).

## Schnelleingabe

Über dem Positionsblock: Feld **„Schnelleingabe“**.

- Format: `Händlernummer` **Leerzeichen** `Betrag` optional weitere Wörter als **Bezeichnung**.
- **Enter** legt eine Position an und leert das Feld.

Beispiel: `42 10,50 Getränke`

## Tastatur (Auszug)

| Aktion | Taste |
|--------|--------|
| Zeile: Händlernummer → Betrag → Bezeichnung | **Enter** (in den Feldern) |
| Neue Zeile / nächste Position | **Enter** in Bezeichnung oder **Strg+N** (Cmd+N auf macOS) |
| Abschließen (speichern) | **Strg+Enter** / **Cmd+Enter** oder **F2** |
| Neue Position | **Strg+N** / **Cmd+N** |
| Zeile löschen (Fokus in Positionsfeld) | **Strg+Entf** oder **Strg+-** |
| Zurück zur Startseite | **Escape** (wenn Besetzung nicht im Bearbeiten-Modus) |
| Besetzung-Bearbeiten abbrechen | **Escape** |

## Häufige Probleme

- **„Kein aktiver Abrechnungslauf“** → Hauptkasse: neuen Lauf starten oder warten; ggf. [Abrechnung](handbuch://abrechnung) / [Einstellungen](handbuch://einstellungen).
- **„Kasse ist nicht mit einer Hauptkasse abgestimmt“** → Nebenkasse: [Netzwerk](handbuch://einstellungen) / [Erststart](handbuch://erststart-und-rollen).
- **Button Abschließen ausgegraut** → Sperrmeldung lesen oder Pflichtfelder (Händlernummer + gültiger Betrag) prüfen.

Siehe auch: [Kassierer (Bedienung)](handbuch://kassierer)
