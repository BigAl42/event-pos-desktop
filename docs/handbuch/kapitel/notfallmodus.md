---
title: Notfallmodus
order: 60
slug: notfallmodus
---

# Notfallmodus (Export / Import)

**Wann brauche ich das?** **Nur im absoluten Notfall**: Sync oder Netzwerk versagen, du musst **Bewegungsdaten** eines Abrechnungslaufs als Datei **sichern** oder auf einer **anderen Kasse** zusammenführen.

**Warnung:** Falscher oder doppelter Import kann zu **doppelten oder inkonsistenten** Daten führen. Vorher abstimmen, wer die „führende“ Kasse ist.

## Wo?

[Einstellungen](handbuch://einstellungen) → Bereich **Notfallmodus** (für Haupt- und Nebenkasse sichtbar).

## Export

- **Notfall-Export (Excel)** – speichert eine `.xlsx` mit mehreren Sheets (META, Kassen, Kundenabrechnungen, Buchungen, Stornos).
- **Notfall-Export (CSV)** – eine CSV-Datei mit allen Datensätzen (Excel-kompatibel mit BOM).

Der Export bezieht sich auf den **aktuellen aktiven Abrechnungslauf** dieser Kasse.

## Import

1. **Datei wählen (Import)** – `.xlsx` / `.xls` oder `.csv`.
2. Die Ansicht zeigt **Export-Lauf** (aus der Datei) vs. **Aktiver Lauf (Ziel)** und die Anzahl Datensätze.
3. Wenn die **Lauf-ID** nicht zum aktiven Lauf passt: **Warnung** – du kannst **Trotzdem importieren (Lauf-ID weicht ab)** aktivieren.
4. **Importieren** – danach erscheint eine **Zusammenfassung** (z. B. eingefügte/ignorierte Kassen, Kundenabrechnungen, Buchungen, Stornos).

Duplikate werden über die Datenbank-Logik weitgehend **ignoriert** (`INSERT OR IGNORE`).

## Unterschied zum Wizard-JSON

Im **Abrechnungslauf abschließen**-Wizard ([Abrechnung](handbuch://abrechnung)) wird ein **Notfall-Export als JSON** gespeichert – strukturell ähnlicher Zweck, anderes Dateiformat. Für manuelles Zusammenführen in Excel sind **XLSX/CSV** im Einstellungen-Notfallmodus gedacht.

## Häufige Probleme

- **Import blockiert** → Bei Lauf-Mismatch Checkbox **Trotzdem importieren** setzen (bewusst!).
- **Falsche Kasse** → Immer prüfen, ob der **aktive Ziel-Lauf** der gemeinsame Lauf ist.

Siehe auch: [Technik / Administration](handbuch://technik)
