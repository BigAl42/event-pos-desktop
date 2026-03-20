---
title: Händler
order: 55
slug: haendler
---

# Händler (Master & Nebenkasse)

**Wann brauche ich das?** Du pflegst **Stammdaten** (nur Hauptkasse) oder siehst **Umsätze und Buchungen** (Haupt- und Nebenkasse).

## Rollen auf einen Blick

| Rolle | Händlerverwaltung (CRUD, Import/Export) | Händlerübersicht (Umsatz, Drilldown) |
|--------|----------------------------------------|--------------------------------------|
| **Hauptkasse** | Ja – Kachel **Händlerverwaltung**; Stammdaten auch über **Händlerübersicht** → **Stammdaten verwalten** | Ja – Kachel **Händlerübersicht** |
| **Nebenkasse** | Nein (schreibgeschützt) | Ja – Kachel **Händlerübersicht** (nur Lesen) |

## Händlerverwaltung (nur Hauptkasse)

- **Neuer Händler**: Nummer (ohne führende Nullen), optional Sortierung, Name/Anzeigename oder Vorname/Nachname, E-Mail, Adresse.
- **Speichern**, **Bearbeiten**, **Löschen** (mit Bestätigung).
- **Import / Export**: **CSV** und **Excel** – Export über Speichern-Dialog; Import per Dateiauswahl (bestehende Nummern werden aktualisiert, neue angelegt).

Stammdaten (Adresse, E-Mail) fließen in die **PDF-Abrechnung** ein – siehe [Abrechnung](handbuch://abrechnung).

## Händlerübersicht (Hauptkasse)

- Liste aller Händler mit **Umsatz** und **Anzahl** im **aktuellen Abrechnungslauf** (aus den gleichen Aggregaten wie die Abrechnungstabelle).
- **Details** (Button pro Zeile): öffnet den **Drilldown** mit allen Buchungen dieses Händlers.
- **Stammdaten verwalten…** → Wechsel in die Händlerverwaltung.

## Händlerübersicht (Nebenkasse)

- Gleiche Darstellung der **Umsätze**, aber **keine** Bearbeiten/Löschen/Import.
- Hinweistext: Änderungen nur an der Hauptkasse.

## Drilldown „Buchungen pro Händler“

- Buchungen des Händlers im **aktuellen Abrechnungslauf**, **gruppiert nach Kasse** (Kassenname).
- Spalten u. a.: Zeit, Belegbezug, Betrag, Bezeichnung, Status (ok / storniert).
- **Export CSV** – Download der angezeigten Daten.
- **Drucken** – Druckdialog für die aktuelle Ansicht.
- **Zurück** kehrt zur **Händlerübersicht** (Master oder Nebenkasse, je nachdem wo du den Drilldown geöffnet hast).

**Hinweis:** Die Zeile in der Liste ist **nicht** insgesamt klickbar – nur der Button **Details** öffnet den Drilldown.

## Bezug zur Kasse

Beim Abschließen einer Kundenabrechnung prüft die [Kasse](handbuch://kasse) bekannte Händlernummern; bei unbekannter Nummer erscheint **Trotzdem buchen**.

## Häufige Probleme

- **Nebenkasse: falsche/fehlende Händler** → Sync und Rolle prüfen; Stammdaten immer auf **Hauptkasse** ändern.
- **Umsatz 0** → Keine Buchungen für diesen Händler im aktiven Lauf.

Siehe auch: [Technik / Administration](handbuch://technik)
