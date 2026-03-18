import { useState, useEffect, useRef, useCallback } from "react";
import {
  getCurrentKasse,
  getHaendlerList,
  createKundenabrechnung,
  updateKassenPersonen,
  isInitializedFromMaster,
  getAbrechnungsläufe,
  type Kasse,
} from "../db";
import "./KasseView.css";

type Position = { haendlernummer: string; betrag: string; bezeichnung: string };

type PositionRefs = {
  haendlernummer: HTMLInputElement | null;
  betrag: HTMLInputElement | null;
  bezeichnung: HTMLInputElement | null;
};

type Props = { onBack: () => void };

function parseBetrag(value: string): number {
  const normalized = value.trim().replace(",", ".");
  return parseFloat(normalized);
}

/** Händlernummer für Vergleich normalisieren (ohne führende Nullen). */
function normalizeHaendlernummer(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const n = parseInt(trimmed, 10);
  if (Number.isNaN(n)) return trimmed;
  return String(n);
}

export default function KasseView({ onBack }: Props) {
  const [kasse, setKasse] = useState<Kasse | null>(null);
  const [positionen, setPositionen] = useState<Position[]>([
    { haendlernummer: "", betrag: "", bezeichnung: "" },
  ]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [editPersonen, setEditPersonen] = useState(false);
  const [person1, setPerson1] = useState("");
  const [person2, setPerson2] = useState("");
  const [schnellEingabe, setSchnellEingabe] = useState("");
  const [pendingUnknownHaendler, setPendingUnknownHaendler] = useState<string[] | null>(null);
  const [kasseBereit, setKasseBereit] = useState<boolean | null>(null);
  const [blockMessage, setBlockMessage] = useState("");
  const schnellEingabeRef = useRef<HTMLInputElement | null>(null);
  const positionRefs = useRef<PositionRefs[]>([]);
  const focusLastRowRef = useRef(false);

  useEffect(() => {
    getCurrentKasse().then((k) => {
      setKasse(k);
      if (k) {
        setPerson1(k.person1_name || "");
        setPerson2(k.person2_name || "");
      }
    });
  }, []);

  useEffect(() => {
    if (!kasse) return;
    let cancelled = false;
    (async () => {
      const initialized = await isInitializedFromMaster();
      // #region agent log
      fetch("http://127.0.0.1:7475/ingest/339f8301-dff1-46a5-b3e4-2b85e31fc48f", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-Session-Id": "b96c54",
        },
        body: JSON.stringify({
          sessionId: "b96c54",
          runId: "pre-fix",
          hypothesisId: "H1",
          location: "KasseView.tsx:guardEffect",
          message: "KasseView guard state",
          data: {
            initialized,
            hasKasse: !!kasse,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion agent log
      if (cancelled) return;
      if (!initialized) {
        setKasseBereit(false);
        setBlockMessage("Kasse ist nicht mit einer Hauptkasse abgestimmt. Bitte in den Einstellungen als Hauptkasse einrichten oder an die Hauptkasse koppeln.");
        return;
      }
      const laufe = await getAbrechnungsläufe();
      if (cancelled) return;
      const aktiv = laufe.find((l) => l.is_aktiv);
      if (!aktiv) {
        setKasseBereit(false);
        setBlockMessage("Kein aktiver Abrechnungslauf. Bitte in den Einstellungen einen Abrechnungslauf starten.");
        return;
      }
      setKasseBereit(true);
      setBlockMessage("");
    })();
    return () => {
      cancelled = true;
    };
  }, [kasse]);

  // Initial focus on first Händlernummer when kasse is loaded
  useEffect(() => {
    if (!kasse || positionen.length === 0) return;
    positionRefs.current[0]?.haendlernummer?.focus();
  }, [kasse]);

  // Focus new row after addPosition (Enter or Ctrl+N)
  useEffect(() => {
    if (!focusLastRowRef.current || positionen.length === 0) return;
    const last = positionRefs.current[positionen.length - 1];
    if (last?.haendlernummer) {
      last.haendlernummer.focus();
      focusLastRowRef.current = false;
    }
  }, [positionen.length]);

  function addPosition() {
    focusLastRowRef.current = true;
    setPositionen((p) => [...p, { haendlernummer: "", betrag: "", bezeichnung: "" }]);
  }

  function removePosition(i: number) {
    setPositionen((p) => (p.length > 1 ? p.filter((_, j) => j !== i) : p));
  }

  function updatePosition(i: number, field: keyof Position, value: string) {
    setPositionen((p) =>
      p.map((row, j) => (j === i ? { ...row, [field]: value } : row))
    );
  }

  async function handleSavePersonen() {
    if (!kasse) return;
    setSaving(true);
    try {
      await updateKassenPersonen(kasse.id, person1, person2);
      setKasse((k) => (k ? { ...k, person1_name: person1 || null, person2_name: person2 || null } : null));
      setEditPersonen(false);
    } catch (e) {
      setMessage(String(e));
    } finally {
      setSaving(false);
    }
  }

  const validPositionen = positionen.filter(
    (p) =>
      p.haendlernummer.trim() &&
      p.betrag.trim() &&
      !isNaN(parseBetrag(p.betrag))
  );

  const doCreateKundenabrechnung = useCallback(async () => {
    if (!kasse || validPositionen.length === 0) return;
    if (kasseBereit !== true) {
      setMessage(blockMessage || "Buchungen sind derzeit nicht möglich.");
      return;
    }
    setSaving(true);
    setMessage("");
    setPendingUnknownHaendler(null);
    try {
      const belegnummer = await createKundenabrechnung(
        kasse.id,
        kasse.person1_name || "",
        kasse.person2_name || "",
        validPositionen.map((p) => ({
          haendlernummer: p.haendlernummer.trim(),
          betrag: parseBetrag(p.betrag),
          bezeichnung: p.bezeichnung.trim() || undefined,
        }))
      );
      setMessage(`Beleg ${belegnummer} gespeichert.`);
      setPositionen([{ haendlernummer: "", betrag: "", bezeichnung: "" }]);
    } catch (e) {
      setMessage(String(e));
    } finally {
      setSaving(false);
    }
  }, [kasse, validPositionen, kasseBereit, blockMessage]);

  const handleAbschliessen = useCallback(async () => {
    if (!kasse) return;
    if (kasseBereit !== true) {
      setMessage(blockMessage || "Buchungen sind derzeit nicht möglich.");
      return;
    }
    if (validPositionen.length === 0) {
      setMessage("Mindestens eine Position mit Händlernummer und Betrag erforderlich.");
      return;
    }
    try {
      const haendlerList = await getHaendlerList();
      const knownNummern = new Set(
        haendlerList.map((h) => normalizeHaendlernummer(h.haendlernummer))
      );
      const unknown: string[] = [];
      for (const p of validPositionen) {
        const nr = normalizeHaendlernummer(p.haendlernummer);
        if (nr && !knownNummern.has(nr)) unknown.push(p.haendlernummer.trim());
      }
      const uniqueUnknown = [...new Set(unknown)];
      if (uniqueUnknown.length > 0) {
        setPendingUnknownHaendler(uniqueUnknown);
        setMessage("");
        return;
      }
    } catch {
      // Bei Fehler (z. B. Liste nicht geladen) trotzdem durchlassen
    }
    await doCreateKundenabrechnung();
  }, [kasse, validPositionen, kasseBereit, blockMessage, doCreateKundenabrechnung]);

  // Global shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";

      if (e.key === "Escape") {
        if (editPersonen) {
          setEditPersonen(false);
          e.preventDefault();
        } else {
          onBack();
        }
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === "Enter" || e.key === "n") {
          e.preventDefault();
          if (e.key === "Enter" && validPositionen.length > 0 && !saving) {
            handleAbschliessen();
          } else if (e.key === "n") {
            addPosition();
          }
          return;
        }
        if (e.key === "Delete" || e.key === "-") {
          e.preventDefault();
          if (inInput && target.hasAttribute("data-row-index")) {
            const i = parseInt(target.getAttribute("data-row-index") ?? "", 10);
            if (!isNaN(i)) removePosition(i);
          }
          return;
        }
      }

      if (e.key === "F2") {
        e.preventDefault();
        if (validPositionen.length > 0 && !saving) handleAbschliessen();
        return;
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editPersonen, validPositionen.length, saving, handleAbschliessen]);

  if (!kasse) {
    return (
      <div className="kasse-view">
        <button type="button" onClick={onBack}>← Zurück</button>
        <p>Lade…</p>
      </div>
    );
  }

  return (
    <div className="kasse-view">
      <header className="kasse-header">
        <button type="button" onClick={onBack}>← Zurück</button>
        <h1>Kasse – {kasse.name}</h1>
      </header>

      {pendingUnknownHaendler != null && pendingUnknownHaendler.length > 0 && (
        <div className="kasse-unknown-haendler">
          <p>
            Folgende Händlernummer(n) sind nicht in der Händlerliste:{" "}
            <strong>{pendingUnknownHaendler.join(", ")}</strong>
          </p>
          <p>Trotzdem buchen?</p>
          <div className="kasse-unknown-haendler-actions">
            <button type="button" onClick={() => setPendingUnknownHaendler(null)}>
              Abbrechen
            </button>
            <button
              type="button"
              className="kasse-trotzdem-buchen"
              onClick={() => doCreateKundenabrechnung()}
              disabled={saving}
            >
              Trotzdem buchen
            </button>
          </div>
        </div>
      )}

      {kasseBereit === false && blockMessage && (
        <div className="kasse-block-message" role="alert">
          {blockMessage}
        </div>
      )}

      <section className="kasse-personen">
        {!editPersonen ? (
          <p>
            <strong>Besetzung:</strong> {kasse.person1_name || "–"} / {kasse.person2_name || "–"}
            <button type="button" className="link-btn" onClick={() => setEditPersonen(true)}>
              Ändern
            </button>
          </p>
        ) : (
          <div className="personen-edit">
            <input
              value={person1}
              onChange={(e) => setPerson1(e.target.value)}
              placeholder="Person 1"
            />
            <input
              value={person2}
              onChange={(e) => setPerson2(e.target.value)}
              placeholder="Person 2"
            />
            <button type="button" onClick={handleSavePersonen} disabled={saving}>
              Speichern
            </button>
            <button type="button" onClick={() => setEditPersonen(false)}>Abbrechen</button>
          </div>
        )}
      </section>

      <section className="kasse-schnell">
        <input
          ref={schnellEingabeRef}
          type="text"
          className="kasse-schnell-input"
          placeholder="Schnelleingabe: Händlernummer Betrag (Enter für nächste Position)"
          value={schnellEingabe}
          onChange={(e) => setSchnellEingabe(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const s = schnellEingabe.trim();
            if (!s) return;
            // Format: "<Händlernummer> <Betrag> [optionale Bezeichnung …]"
            const match = s.match(/^(\S+)\s+(.+)$/);
            if (!match) return;
            const haendler = match[1].trim();
            const rest = match[2].trim();
            const [betragToken, ...descParts] = rest.split(/\s+/);
            if (betragToken) {
              const num = parseBetrag(betragToken);
              if (!isNaN(num)) {
                setPositionen((prev) => [
                  ...prev,
                  {
                    haendlernummer: haendler,
                    betrag: betragToken.trim(),
                    bezeichnung: descParts.join(" ").trim() || "",
                  },
                ]);
                setSchnellEingabe("");
                schnellEingabeRef.current?.focus();
              }
            }
          }}
        />
      </section>

      <section className="kasse-positionen">
        <h2>Positionen</h2>
        {positionen.map((p, i) => (
          <div key={i} className="position-row" data-row-index={i}>
            <input
              ref={(el) => {
                if (!positionRefs.current[i]) positionRefs.current[i] = { haendlernummer: null, betrag: null, bezeichnung: null };
                positionRefs.current[i].haendlernummer = el;
              }}
              data-row-index={i}
              placeholder="Händlernummer"
              value={p.haendlernummer}
              onChange={(e) => updatePosition(i, "haendlernummer", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  positionRefs.current[i]?.betrag?.focus();
                }
                if (e.key === "ArrowUp" && i > 0) {
                  e.preventDefault();
                  positionRefs.current[i - 1]?.betrag?.focus();
                }
              }}
            />
            <input
              ref={(el) => {
                if (!positionRefs.current[i]) positionRefs.current[i] = { haendlernummer: null, betrag: null, bezeichnung: null };
                positionRefs.current[i].betrag = el;
              }}
              data-row-index={i}
              inputMode="decimal"
              type="text"
              pattern="[0-9]*[.,]?[0-9]*"
              placeholder="Betrag"
              value={p.betrag}
              onChange={(e) => updatePosition(i, "betrag", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  positionRefs.current[i]?.bezeichnung?.focus();
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  if (i + 1 < positionen.length) {
                    positionRefs.current[i + 1]?.haendlernummer?.focus();
                  } else {
                    addPosition();
                  }
                }
                if (e.key === "ArrowUp" && i > 0) {
                  e.preventDefault();
                  positionRefs.current[i - 1]?.haendlernummer?.focus();
                }
              }}
            />
            <input
              ref={(el) => {
                if (!positionRefs.current[i]) positionRefs.current[i] = { haendlernummer: null, betrag: null, bezeichnung: null };
                positionRefs.current[i].bezeichnung = el;
              }}
              data-row-index={i}
              placeholder="Bezeichnung (optional)"
              value={p.bezeichnung}
              onChange={(e) => updatePosition(i, "bezeichnung", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addPosition();
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  if (i + 1 < positionen.length) {
                    positionRefs.current[i + 1]?.haendlernummer?.focus();
                  } else {
                    addPosition();
                  }
                }
                if (e.key === "ArrowUp" && i > 0) {
                  e.preventDefault();
                  positionRefs.current[i - 1]?.betrag?.focus();
                }
              }}
            />
            <button type="button" onClick={() => removePosition(i)} title="Entfernen (Strg+Entf)">−</button>
          </div>
        ))}
        <button type="button" onClick={addPosition} className="add-pos">+ Position hinzufügen (Strg+N)</button>
      </section>

      {message && <p className="kasse-message">{message}</p>}

      <button
        type="button"
        className="kasse-abschliessen"
        onClick={handleAbschliessen}
        disabled={saving || kasseBereit !== true}
      >
        {saving ? "Speichern…" : "Kundenabrechnung abschließen"}
      </button>
    </div>
  );
}
