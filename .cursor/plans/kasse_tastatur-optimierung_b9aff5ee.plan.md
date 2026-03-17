---
name: Kasse Tastatur-Optimierung
overview: "Die Kassen-Ansicht wird für rein tastaturbasierte Nutzung optimiert: logische Fokus-Steuerung, Enter-Navigation, globale Shortcuts und optionaler Schnellmodus."
todos: []
isProject: false
---

# Kasse-Ansicht: Tastatur-Optimierung

## Ziel

Rein tastaturbasierte, schnelle Erfassung in [src/components/KasseView.tsx](src/components/KasseView.tsx): Fokus steuern, Enter für „Weiter/Neue Zeile“, globale Shortcuts, optional Einzeilen-Schnellmodus.

## Abhängigkeiten

- Refs für alle relevanten Inputs (pro Zeile: Händlernummer, Betrag, Bezeichnung), damit Fokus programmatisch gesetzt werden kann.
- Ein globaler `keydown`-Listener (z.B. in der Komponente via `useEffect`) für Shortcuts, der in Eingabefeldern nur bei bestimmten Tastenkombinationen greift.

---

## 1. Fokus und Tab-Reihenfolge

- **Initial-Fokus:** Beim Mount (wenn `kasse` geladen) Fokus auf das erste Feld „Händlernummer“ der ersten Position setzen (`ref` + `useEffect`).
- **Tab-Reihenfolge:** Keine `tabIndex`-Änderungen nötig, wenn die DOM-Reihenfolge stimmt: Zeile 1 (Händlernummer → Betrag → Bezeichnung) → Zeile 2 → … → „+ Position“ → „Abschließen“. Sicherstellen, dass keine umgebenden Elemente die Reihenfolge stören.

---

## 2. Enter = „Weiter“ / „Neue Zeile“

- **Händlernummer:** `onKeyDown` → bei Enter `e.preventDefault()`, Fokus auf **Betrag** derselben Zeile.
- **Betrag:** Enter → Fokus auf **Bezeichnung** derselben Zeile.
- **Bezeichnung:** Enter → **neue Position** anlegen (`addPosition()`), Fokus auf Händlernummer der neuen Zeile (Ref nach State-Update setzen, z.B. `setTimeout` oder `flushSync`/`requestAnimationFrame`).
- Abschließen-Button: Enter-Verhalten bleibt unverändert (natürliches Button-Submit).

Refs als Array oder Objekt pro Zeile anlegen (z.B. `positionRefs.current[i] = { haendlernummer, betrag, bezeichnung }`), damit die Ziele für Fokus-Sprünge verfügbar sind.

---

## 3. Globale Shortcuts

In `useEffect` einen `keydown`-Listener auf `document` registrieren (Cleanup: `removeEventListener`):


| Shortcut                       | Aktion                                                                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ctrl+Enter** (oder F2)       | `handleAbschliessen()` aufrufen (nur wenn mindestens eine gültige Position).                                                                                         |
| **Ctrl+N** (oder Ctrl+Plus)    | `addPosition()` + Fokus auf Händlernummer der neuen Zeile.                                                                                                           |
| **Ctrl+Entf** / **Ctrl+Minus** | Wenn Fokus in einer Positionen-Zeile liegt: `removePosition(i)` für diese Zeile. Dazu Zeilen-Index ermitteln (z.B. `data-row-index` am Container oder über Ref-Map). |
| **Escape**                     | Wenn Personen-Bereich im Edit-Modus: Edit abbrechen (`setEditPersonen(false)`). Sonst: `onBack()`.                                                                   |


In Eingabefeldern nur diese Kombinationen auswerten, bei normalem Tastendruck (z.B. Strg+V) den Listener nicht stören.

---

## 4. Pfeiltasten zwischen Zeilen (optional, aber empfohlen)

- **Pfeil runter** im Betrag- oder Bezeichnungsfeld der Zeile `i`: Fokus auf Händlernummer der Zeile `i+1`. Wenn keine nächste Zeile existiert: `addPosition()` und Fokus in die neue Zeile.
- **Pfeil hoch** im Händlernummer-Feld der Zeile `i` (i > 0): Fokus auf Betrag (oder Bezeichnung) der Zeile `i-1`.

Ebenfalls in `onKeyDown` der jeweiligen Inputs, mit `e.preventDefault()` um Standard-Scroll zu verhindern.

---

## 5. Schnellmodus / Einzeilen-Eingabe (optional)

- **Neues Eingabefeld** „Schnelleingabe“ (z.B. oberhalb der Positions-Tabelle), Platzhalter z.B. „Händlernummer Betrag (Enter für nächste Position)“.
- **Parsing:** Bei Enter Zeichenkette parsen (z.B. `4711 12.50` oder `4711,12.50`), Händlernummer und Betrag extrahieren, neue Position an `positionen` anhängen, Feld leeren, Fokus im Schnellfeld lassen.
- **Integration:** Schnellmodus und Tabellen-Modus nutzen dieselbe `positionen`-State-Liste; „Abschließen“ wie gewohnt. Optional: Schnellmodus per Toggle oder nur anzeigen, wenn gewünscht (Konfiguration/UI-Flag).

---

## 6. Technische Details

- **Betrag-Input:** `inputMode="decimal"` setzen (bessere Numpad-Nutzung auf Touch).
- **Komma-Eingabe:** Optional vor `handleAbschliessen` bzw. beim Parsen der Schnelleingabe Komma in Punkt umwandeln (`parseFloat(value.replace(',', '.'))`).
- **Refs:** Nutzung von `useRef` für die Positions-Inputs; bei dynamischer Listenlänge Refs in einem Array/Map halten und bei `addPosition` / nach State-Update den Fokus auf die neue Zeile setzen.

---

## Betroffene Dateien

- [src/components/KasseView.tsx](src/components/KasseView.tsx): State, Refs, `addPosition`/`removePosition`/`handleAbschliessen`, Key-Handler, optional Schnellmodus-State und -UI.
- [src/components/KasseView.css](src/components/KasseView.css): Ggf. minimale Anpassungen für Schnellmodus-Feld (Layout).

---

## Empfohlene Reihenfolge

1. Refs anlegen und Initial-Fokus + Enter-Navigation (Punkt 1 + 2).
2. Globale Shortcuts (Punkt 3).
3. Pfeiltasten (Punkt 4).
4. Optional: Schnellmodus (Punkt 5) und Komma-Ersetzung/`inputMode` (Punkt 6).

