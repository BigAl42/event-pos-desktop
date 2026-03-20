import { useMemo, useState, useEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  createAbrechnungslauf,
  getAbrechnung,
  getConfig,
  getNotfallExportData,
  getSyncStatus,
  type AbrechnungZeile,
  getAbrechnungsläufe,
  getHaendlerAbrechnungPdfData,
} from "../db";
import { useSyncData } from "../SyncDataContext";
import "./SettlementView.css";
import { MerchantSettlementPdf } from "./MerchantSettlementPdf";
import { exportElementAsPdf, exportElementAsPdfToPath, sanitizeFilename } from "../utils/pdfExport";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { join } from "@tauri-apps/api/path";
import { writeTextFile } from "@tauri-apps/plugin-fs";

type Props = { onBack: () => void };

export default function SettlementView({ onBack }: Props) {
  const { syncDataVersion } = useSyncData();
  const [role, setRole] = useState<string | null>(null);
  const [rows, setRows] = useState<AbrechnungZeile[]>([]);
  const [loading, setLoading] = useState(true);
  const [aktuellerLaufName, setAktuellerLaufName] = useState<string | null>(null);
  const [aktuellerLaufId, setAktuellerLaufId] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfBatch, setPdfBatch] = useState<{ done: number; total: number } | null>(null);

  const [abschlussOpen, setAbschlussOpen] = useState(false);
  const [abschlussStep, setAbschlussStep] = useState<1 | 2 | 3>(1);
  const [abschlussBusy, setAbschlussBusy] = useState(false);
  const [abschlussError, setAbschlussError] = useState<string | null>(null);
  const [syncEntries, setSyncEntries] = useState<Awaited<ReturnType<typeof getSyncStatus>>>([]);
  const [syncLoading, setSyncLoading] = useState(false);
  const [exportPdfDone, setExportPdfDone] = useState(false);
  const [exportNotfallDone, setExportNotfallDone] = useState(false);
  const [exportSummary, setExportSummary] = useState<{ pdfCount: number | null; notfallPath: string | null }>({
    pdfCount: null,
    notfallPath: null,
  });
  const [ignoredPeersForAbschluss, setIgnoredPeersForAbschluss] = useState<string[]>([]);
  const [newLaufName, setNewLaufName] = useState("");

  useEffect(() => {
    getConfig("role").then(setRole).catch(() => setRole(null));
  }, []);

  useEffect(() => {
    setLoading(true);
    getAbrechnung().then((r) => {
      setRows(r);
      setLoading(false);
    });
    getAbrechnungsläufe()
      .then((läufe) => {
        const aktiver = läufe.find((l) => l.is_aktiv);
        setAktuellerLaufName(aktiver ? aktiver.name : null);
        setAktuellerLaufId(aktiver ? aktiver.id : null);
      })
      .catch(() => {
        setAktuellerLaufName(null);
        setAktuellerLaufId(null);
      });
  }, [syncDataVersion]);

  const gesamt = rows.reduce((s, r) => s + r.summe, 0);

  async function withPrintable<T>(
    dto: Awaited<ReturnType<typeof getHaendlerAbrechnungPdfData>>,
    fn: (printable: HTMLElement) => Promise<T>
  ): Promise<T> {
    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.left = "0";
    container.style.top = "0";
    container.style.opacity = "0";
    container.style.pointerEvents = "none";
    container.style.zIndex = "-1";
    container.style.width = "210mm";
    container.style.background = "#fff";
    document.body.appendChild(container);

    const root = createRoot(container);
    flushSync(() => {
      root.render(<MerchantSettlementPdf data={dto} />);
    });

    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
    if (fonts?.ready) {
      await fonts.ready.catch(() => {});
    }

    const printable = container.querySelector<HTMLElement>(".haendler-settlement-pdf") ?? container;
    try {
      return await fn(printable);
    } finally {
      root.unmount();
      container.remove();
    }
  }

  async function handleCreatePdf(haendlernummer: string) {
    if (!aktuellerLaufId) {
      setPdfError("Kein aktiver Abrechnungslauf gefunden.");
      return;
    }
    setPdfError(null);
    setPdfBusy(haendlernummer);
    setPdfBatch(null);
    try {
      const dto = await getHaendlerAbrechnungPdfData(haendlernummer, aktuellerLaufId);
      await withPrintable(dto, async (printable) =>
        exportElementAsPdf(printable, {
          filenameSuggestion: sanitizeFilename(
            `Abrechnung_${dto.lauf.name}_Haendler_${dto.haendler.haendlernummer}.pdf`
          ),
        })
      );
    } catch (e) {
      setPdfError(String(e));
    } finally {
      setPdfBusy(null);
    }
  }

  async function handleCreateAllPdfs(): Promise<boolean> {
    if (!aktuellerLaufId) {
      setPdfError("Kein aktiver Abrechnungslauf gefunden.");
      return false;
    }
    if (rows.length === 0) return false;
    setPdfError(null);
    setPdfBusy("__ALL__");
    setPdfBatch({ done: 0, total: rows.length });

    try {
      const dir = await open({
        directory: true,
        multiple: false,
        title: "Zielordner für Händler-PDFs auswählen",
      });
      if (!dir) return false;
      const targetDir = Array.isArray(dir) ? dir[0] : dir;

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const dto = await getHaendlerAbrechnungPdfData(r.haendlernummer, aktuellerLaufId);
        const filename = sanitizeFilename(
          `Abrechnung_${dto.lauf.name}_Haendler_${dto.haendler.haendlernummer}.pdf`
        );
        const outPath = await join(targetDir, filename);
        await withPrintable(dto, async (printable) => exportElementAsPdfToPath(printable, outPath));
        setPdfBatch({ done: i + 1, total: rows.length });
      }
      return true;
    } catch (e) {
      setPdfError(String(e));
      return false;
    } finally {
      setPdfBusy(null);
    }
  }

  async function refreshSyncGate() {
    setSyncLoading(true);
    try {
      const list = await getSyncStatus();
      setSyncEntries(list);
    } catch (e) {
      setSyncEntries([]);
      throw e;
    } finally {
      setSyncLoading(false);
    }
  }

  const relevantPeers = useMemo(() => {
    return syncEntries.filter((e) => (e.ws_url ?? "").trim() !== "");
  }, [syncEntries]);

  const syncGate = useMemo(() => {
    if (!aktuellerLaufId) {
      return { ok: false, reason: "Kein aktiver Abrechnungslauf gefunden.", missing: [] as string[] };
    }
    const missing: string[] = [];
    for (const e of relevantPeers) {
      const ok =
        e.connected === true &&
        (e.closeout_ok_for_lauf_id ?? null) === aktuellerLaufId &&
        (e.closeout_ok_at ?? null) !== null;
      if (!ok) missing.push(e.peer_id);
    }
    return { ok: missing.length === 0, reason: null as string | null, missing };
  }, [aktuellerLaufId, relevantPeers]);

  const canProceedDespiteCloseout = useMemo(
    () =>
      syncGate.ok ||
      syncGate.missing.every((id) => ignoredPeersForAbschluss.includes(id)),
    [syncGate.ok, syncGate.missing, ignoredPeersForAbschluss]
  );

  function openAbschlussWizard() {
    setAbschlussError(null);
    setAbschlussBusy(false);
    setExportPdfDone(false);
    setExportNotfallDone(false);
    setExportSummary({ pdfCount: null, notfallPath: null });
    setIgnoredPeersForAbschluss([]);
    setNewLaufName(
      `Kassentag ${new Date().toLocaleDateString("de-DE", { year: "numeric", month: "2-digit", day: "2-digit" })}`
    );
    setAbschlussStep(1);
    setAbschlussOpen(true);
    refreshSyncGate().catch((e) => setAbschlussError(String(e)));
  }

  async function handleWizardCreateAllPdfs() {
    setAbschlussError(null);
    try {
      const ok = await handleCreateAllPdfs();
      if (ok) {
        setExportPdfDone(true);
        setExportSummary((prev) => ({ ...prev, pdfCount: rows.length }));
      }
    } catch (e) {
      setAbschlussError(String(e));
    }
  }

  async function handleWizardNotfallExport() {
    if (!aktuellerLaufId) {
      setAbschlussError("Kein aktiver Abrechnungslauf gefunden.");
      return;
    }
    setAbschlussError(null);
    setAbschlussBusy(true);
    try {
      const dto = await getNotfallExportData(aktuellerLaufId);
      const suggested = sanitizeFilename(
        `NotfallExport_${dto.meta.exported_lauf_name}_${dto.meta.exported_lauf_id}.json`
      );
      const path = await save({
        defaultPath: suggested,
        filters: [{ name: "JSON", extensions: ["json"] }],
        title: "Notfall-Export speichern",
      });
      if (!path) return;
      await writeTextFile(path, JSON.stringify(dto, null, 2));
      setExportNotfallDone(true);
      setExportSummary((prev) => ({ ...prev, notfallPath: path }));
    } catch (e) {
      setAbschlussError(String(e));
    } finally {
      setAbschlussBusy(false);
    }
  }

  async function handleWizardStartNewLauf() {
    if (!newLaufName.trim()) {
      setAbschlussError("Bitte einen Namen für den neuen Abrechnungslauf eingeben.");
      return;
    }
    setAbschlussError(null);
    setAbschlussBusy(true);
    try {
      await createAbrechnungslauf(newLaufName.trim(), ignoredPeersForAbschluss);
      // Refresh UI state (neuer Lauf + leere Bewegungsdaten)
      const [r, läufe] = await Promise.all([getAbrechnung(), getAbrechnungsläufe()]);
      setRows(r);
      const aktiver = läufe.find((l) => l.is_aktiv);
      setAktuellerLaufName(aktiver ? aktiver.name : null);
      setAktuellerLaufId(aktiver ? aktiver.id : null);
      setAbschlussOpen(false);
    } catch (e) {
      setAbschlussError(String(e));
    } finally {
      setAbschlussBusy(false);
    }
  }

  return (
    <div className="settlement-view">
      <header className="settlement-header">
        <button type="button" onClick={onBack}>← Zurück</button>
        <h1>Abrechnung (Händler)</h1>
        {aktuellerLaufName && (
          <p className="settlement-hinweis-lauf">
            Aktueller Abrechnungslauf: <strong>{aktuellerLaufName}</strong>
          </p>
        )}
        <button
          type="button"
          onClick={handleCreateAllPdfs}
          disabled={loading || rows.length === 0 || pdfBusy !== null}
        >
          {pdfBusy === "__ALL__" ? "Erzeuge alle…" : "Alle PDFs erstellen"}
        </button>
        {role === "master" && (
          <button
            type="button"
            className="settlement-closeout"
            onClick={openAbschlussWizard}
            disabled={loading || pdfBusy !== null}
            title="Geführter Abschluss: Closeout prüfen, Exporte speichern, neuen Lauf starten"
          >
            Abrechnungslauf abschließen
          </button>
        )}
      </header>

      {pdfError && <p className="settlement-error">{pdfError}</p>}
      {pdfBatch && (
        <p className="settlement-hinweis-lauf">
          PDF-Fortschritt: <strong>{pdfBatch.done}</strong> / {pdfBatch.total}
        </p>
      )}

      {loading ? (
        <p>Lade…</p>
      ) : rows.length === 0 ? (
        <p className="settlement-leer">Noch keine Buchungen.</p>
      ) : (
        <>
          <table className="settlement-table">
            <thead>
              <tr>
                <th>Händlernummer</th>
                <th className="num">Anzahl</th>
                <th className="num">Summe (€)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.haendlernummer}>
                  <td>{r.haendlernummer}</td>
                  <td className="num">{r.anzahl}</td>
                  <td className="num">{r.summe.toFixed(2)}</td>
                  <td className="action">
                    <button
                      type="button"
                      onClick={() => handleCreatePdf(r.haendlernummer)}
                      disabled={pdfBusy !== null}
                    >
                      {pdfBusy === r.haendlernummer ? "Erzeuge…" : "PDF erstellen"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="settlement-gesamt">
            <strong>Gesamt:</strong> {gesamt.toFixed(2)} €
          </p>
        </>
      )}

      {abschlussOpen && (
        <div className="settlement-modal-overlay" onClick={() => setAbschlussOpen(false)}>
          <div className="settlement-modal" onClick={(e) => e.stopPropagation()}>
            <div className="settlement-modal-header">
              <h2>Abrechnungslauf abschließen</h2>
              <button type="button" onClick={() => setAbschlussOpen(false)} aria-label="Schließen" disabled={abschlussBusy}>
                ✕
              </button>
            </div>

            <p className="settlement-modal-subtitle">
              Aktiver Lauf: <strong>{aktuellerLaufName ?? "—"}</strong>
            </p>

            {abschlussError && <p className="settlement-error">{abschlussError}</p>}

            <div className="settlement-wizard-steps">
              <button type="button" className={abschlussStep === 1 ? "active" : ""} onClick={() => setAbschlussStep(1)}>
                1) Closeout
              </button>
              <button
                type="button"
                className={abschlussStep === 2 ? "active" : ""}
                onClick={() => setAbschlussStep(2)}
                disabled={!canProceedDespiteCloseout}
                title={!canProceedDespiteCloseout ? "Closeout muss zuerst OK sein oder Peers ignorieren." : ""}
              >
                2) Export
              </button>
              <button
                type="button"
                className={abschlussStep === 3 ? "active" : ""}
                onClick={() => setAbschlussStep(3)}
                disabled={!canProceedDespiteCloseout || !exportPdfDone || !exportNotfallDone}
                title={
                  !canProceedDespiteCloseout
                    ? "Closeout muss zuerst OK sein oder Peers ignorieren."
                    : !exportPdfDone || !exportNotfallDone
                      ? "Exporte fehlen."
                      : ""
                }
              >
                3) Neuer Lauf
              </button>
            </div>

            {abschlussStep === 1 && (
              <section className="settlement-wizard-section">
                <h3>Closeout prüfen (alle Nebenkassen)</h3>
                <p className="settlement-hinweis">
                  Der Lauf kann erst abgeschlossen werden, wenn jede verbundene Nebenkasse „Abmelden/Lauf fertig“ erfolgreich angefragt
                  hat.
                </p>
                <div className="settlement-actions">
                  <button type="button" onClick={() => refreshSyncGate().catch((e) => setAbschlussError(String(e)))} disabled={syncLoading}>
                    {syncLoading ? "Prüfe…" : "Neu prüfen"}
                  </button>
                  {syncGate.missing.length > 0 && (
                    <button
                      type="button"
                      className="settlement-peer-ignore"
                      onClick={async () => {
                        const names = syncGate.missing
                          .map((id) => relevantPeers.find((p) => p.peer_id === id)?.name || id)
                          .join(", ");
                        const ok = await confirm(
                          `Folgende Nebenkassen haben noch keinen Closeout: ${names}. Daten dieser Kassen können verloren gehen. Trotzdem abschließen?`,
                          { title: "Peers ignorieren?", kind: "warning" }
                        );
                        if (ok) setIgnoredPeersForAbschluss(syncGate.missing);
                      }}
                      disabled={abschlussBusy}
                    >
                      Trotzdem abschließen (Peers ignorieren)
                    </button>
                  )}
                  {ignoredPeersForAbschluss.length > 0 && (
                    <button type="button" onClick={() => setIgnoredPeersForAbschluss([])} disabled={abschlussBusy}>
                      Ignorierung aufheben
                    </button>
                  )}
                  <button type="button" onClick={() => setAbschlussStep(2)} disabled={!canProceedDespiteCloseout}>
                    Weiter
                  </button>
                </div>
                {ignoredPeersForAbschluss.length > 0 && (
                  <p className="settlement-hinweis">
                    Beim Abschluss werden folgende Peers ignoriert:{" "}
                    {ignoredPeersForAbschluss
                      .map((id) => relevantPeers.find((p) => p.peer_id === id)?.name || id)
                      .join(", ")}
                  </p>
                )}

                {relevantPeers.length === 0 ? (
                  <p className="settlement-leer">Keine Peers mit URL konfiguriert.</p>
                ) : (
                  <ul className="settlement-peer-list">
                    {relevantPeers.map((e) => {
                      const ok =
                        e.connected === true &&
                        (e.closeout_ok_for_lauf_id ?? null) === aktuellerLaufId &&
                        (e.closeout_ok_at ?? null) !== null;
                      let hint = "";
                      if (!e.connected) hint = "Nicht verbunden. Sync starten/abwarten.";
                      else if ((e.closeout_ok_for_lauf_id ?? null) !== aktuellerLaufId) hint = "Closeout fehlt oder gilt für anderen Lauf.";
                      else if (!e.closeout_ok_at) hint = "Closeout-Zeitpunkt fehlt (bitte erneut anfragen).";
                      return (
                        <li key={e.peer_id} className={ok ? "ok" : "warn"}>
                          <div className="settlement-peer-main">
                            <span className="settlement-peer-name">{e.name || e.peer_id}</span>
                            <span className={ok ? "settlement-badge ok" : "settlement-badge warn"}>{ok ? "OK" : "Fehlt"}</span>
                          </div>
                          <div className="settlement-peer-sub">
                            <span className="settlement-peer-url">{e.ws_url}</span>
                            {e.closeout_ok_at && (
                              <span className="settlement-peer-closeout">
                                Closeout: {new Date(e.closeout_ok_at).toLocaleString("de-DE")}
                              </span>
                            )}
                          </div>
                          {!ok && hint && <div className="settlement-peer-hint">{hint}</div>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}

            {abschlussStep === 2 && (
              <section className="settlement-wizard-section">
                <h3>Exporte erstellen (Pflicht)</h3>
                <p className="settlement-hinweis">
                  Wichtig: Beim Start des neuen Abrechnungslaufs werden lokale Bewegungsdaten gelöscht. Bitte Exporte vorher speichern.
                </p>
                <div className="settlement-export-grid">
                  <div className="settlement-export-card">
                    <div className="settlement-export-title">
                      Händler-PDFs (alle) {exportPdfDone && <span className="settlement-badge ok">OK</span>}
                    </div>
                    <p className="settlement-export-desc">Erstellt pro Händler eine PDF im Zielordner.</p>
                    <button
                      type="button"
                      onClick={handleWizardCreateAllPdfs}
                      disabled={loading || rows.length === 0 || pdfBusy !== null || abschlussBusy}
                    >
                      {pdfBusy === "__ALL__" ? "Erzeuge…" : "Alle PDFs erstellen"}
                    </button>
                  </div>
                  <div className="settlement-export-card">
                    <div className="settlement-export-title">
                      Notfall-Export (JSON) {exportNotfallDone && <span className="settlement-badge ok">OK</span>}
                    </div>
                    <p className="settlement-export-desc">Speichert alle Bewegungsdaten des aktiven Laufs als Datei.</p>
                    <button type="button" onClick={handleWizardNotfallExport} disabled={abschlussBusy}>
                      {abschlussBusy ? "Speichere…" : "Notfall-Export speichern"}
                    </button>
                  </div>
                </div>
                <div className="settlement-actions">
                  <button type="button" onClick={() => setAbschlussStep(1)} disabled={abschlussBusy}>
                    Zurück
                  </button>
                  <button
                    type="button"
                    onClick={() => setAbschlussStep(3)}
                    disabled={!exportPdfDone || !exportNotfallDone || abschlussBusy}
                  >
                    Weiter
                  </button>
                </div>
              </section>
            )}

            {abschlussStep === 3 && (
              <section className="settlement-wizard-section">
                <h3>Neuen Abrechnungslauf starten</h3>
                <p className="settlement-hinweis">
                  Der aktive Lauf wird beendet (Ende-Zeitpunkt gesetzt), anschließend wird ein neuer Lauf angelegt und Bewegungsdaten
                  werden gelöscht.
                </p>
                {(exportSummary.pdfCount != null || exportSummary.notfallPath) && (
                  <div className="settlement-export-summary">
                    <strong>Export-Zusammenfassung</strong>
                    <ul>
                      {exportSummary.pdfCount != null && (
                        <li>{exportSummary.pdfCount} PDFs erstellt.</li>
                      )}
                      {exportSummary.notfallPath && (
                        <li>
                          Notfall-Export gespeichert nach:{" "}
                          {exportSummary.notfallPath.split(/[/\\]/).slice(-2).join("/") || exportSummary.notfallPath}
                        </li>
                      )}
                    </ul>
                  </div>
                )}
                <label className="settlement-label">
                  Name des neuen Abrechnungslaufs
                  <input
                    type="text"
                    value={newLaufName}
                    onChange={(e) => setNewLaufName(e.target.value)}
                    placeholder="z.B. Stadtfest 2026"
                    disabled={abschlussBusy}
                  />
                </label>
                <div className="settlement-actions">
                  <button type="button" onClick={() => setAbschlussStep(2)} disabled={abschlussBusy}>
                    Zurück
                  </button>
                  <button
                    type="button"
                    className="settlement-danger"
                    onClick={handleWizardStartNewLauf}
                    disabled={abschlussBusy}
                  >
                    {abschlussBusy ? "Starte…" : "Ja, neuen Lauf starten"}
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
