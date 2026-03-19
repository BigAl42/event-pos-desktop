---
title: Abrechnung
order: 30
slug: abrechnung
---

# Abrechnung

**Wann brauche ich das?** Du willst **Summen pro Händler** sehen, **PDF-Abrechnungen** erzeugen oder (Hauptkasse) den **Abrechnungslauf** sauber beenden.

## Summen & PDF (alle Rollen mit Zugriff)

- Die Tabelle zeigt pro **Händlernummer** die **Anzahl** der Buchungen und die **Summe (€)** – die Werte kommen als **Backend-Aggregat** (nicht im Frontend nachgerechnet).
- Oben wird der **aktuelle Abrechnungslauf** angezeigt.
- **PDF erstellen** (pro Zeile): eine **1-seitige A4-PDF** mit Stammdaten des Händlers (inkl. Adresse und E-Mail, falls gepflegt), Angaben zum Lauf, **Gesamtsumme** und **Anzahl Buchungen** – **ohne** Auflistung einzelner Buchungen.
- **Alle PDFs erstellen**: Ordner wählen; es werden nacheinander alle Händler-PDFs in diesen Ordner geschrieben. Fortschritt wird angezeigt.

## Abrechnungslauf abschließen (nur Hauptkasse)

Button **Abrechnungslauf abschließen** öffnet einen **dreistufigen Wizard**:

### Schritt 1 – Closeout

- Für jede **Nebenkasse** mit konfigurierter Sync-URL muss ein gültiger **Closeout** für den **aktuellen Lauf** vorliegen (verbunden + Closeout-Zeit + passende Lauf-ID).
- **Neu prüfen** aktualisiert die Liste.
- Wenn nicht alle Nebenkassen „OK“ sind:
  - optional **Trotzdem abschließen (Peers ignorieren)** – mit **Warn-Dialog** (Daten ausgelassener Kassen können fehlen). Danach können die Schritte 2 und 3 genutzt werden.
  - **Ignorierung aufheben** setzt die Auswahl zurück.

### Schritt 2 – Exporte (Pflicht)

Beim Start eines **neuen** Laufs werden **lokale Bewegungsdaten** des alten Laufs gelöscht – daher sind Exporte Pflicht:

1. **Alle PDFs erstellen** – wie oben, Ordner wählen. Erst danach gilt dieser Teil als erledigt (**OK**).
2. **Notfall-Export speichern** – speichert alle Bewegungsdaten des aktiven Laufs als **JSON-Datei** (eigener Dialog „Speichern unter“).

### Schritt 3 – Neuer Lauf

- **Export-Zusammenfassung**: Anzahl erstellter PDFs und Kurzpfad zum Notfall-Export (falls gesetzt).
- **Name** für den neuen Abrechnungslauf eintragen.
- **Ja, neuen Lauf starten** beendet den alten Lauf, legt den neuen an und **löscht** die Bewegungsdaten des alten Laufs.

Backend: Beim Anlegen des neuen Laufs werden verbundene Peers auf **Vollständigkeit** geprüft – außer für zuvor **ignorierte** Peers (siehe Schritt 1).

## Abrechnungsläufe in den Einstellungen

- Liste der Läufe, **aktiver Lauf** markiert.
- **Neuen Abrechnungslauf starten** (mit Bestätigung) – löscht Kundenabrechnungen/Buchungen; Händler und Kassen-Einrichtung bleiben.
- Nicht aktive Läufe können **gelöscht** werden (mit Bestätigung).

Details: [Einstellungen](handbuch://einstellungen)

## Häufige Probleme

- **Kein aktiver Lauf** → In [Einstellungen](handbuch://einstellungen) Lauf prüfen/starten.
- **Wizard Schritt 2/3 blockiert** → Closeout erledigen oder bewusst **Peers ignorieren**; beide Exporte (PDF-Batch + JSON) müssen **OK** sein.
- **PDF-Fehler** → Schreibberechtigung/Zielordner prüfen.

Siehe auch: [Technik / Administration](handbuch://technik) · [Kassierer (Bedienung)](handbuch://kassierer)
