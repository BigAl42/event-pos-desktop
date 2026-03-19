import { useState, useEffect, useRef, type ChangeEvent } from "react";
import { confirm, save } from "@tauri-apps/plugin-dialog";
import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  getCurrentKasse,
  getConfig,
  setConfig,
  getJoinToken,
  generateJoinToken,
  updateKassenPersonen,
  startMasterServer,
  isMasterServerRunning,
  joinNetwork,
  startSyncConnections,
  discoverMasters,
  getAbrechnungsläufe,
  createAbrechnungslauf,
  deleteAbrechnungslauf,
  getAktivenAbrechnungslaufId,
  getNotfallExportData,
  importNotfallData,
  requestSlaveReset,
  requestCloseout,
  leaveNetwork,
  wipeLocalData,
} from "../db";
import type { Kasse, DiscoveredMaster, Abrechnungslauf, NotfallExportDto } from "../db";
import { buildNotfallCsv, buildNotfallExcel, parseNotfallCsv, parseNotfallExcel } from "../utils/notfallImportExport";
import "./EinstellungenView.css";

type Props = { onBack: () => void; onOpenHandbuch?: () => void };

const DEFAULT_WS_PORT = 8765;

function AccordionSection({
  title,
  subtitle,
  defaultOpen,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="einstellungen-accordion" open={defaultOpen}>
      <summary className="einstellungen-accordion-summary">
        <div className="einstellungen-accordion-summary-text">
          <span className="einstellungen-accordion-title">{title}</span>
          {subtitle && <span className="einstellungen-accordion-subtitle">{subtitle}</span>}
        </div>
      </summary>
      <div className="einstellungen-accordion-content">{children}</div>
    </details>
  );
}

export default function EinstellungenView({ onBack, onOpenHandbuch }: Props) {
  const [kasse, setKasse] = useState<Kasse | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [editPersonen, setEditPersonen] = useState(false);
  const [person1, setPerson1] = useState("");
  const [person2, setPerson2] = useState("");
  const [personenSaving, setPersonenSaving] = useState(false);
  const [personenMessage, setPersonenMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [wsServerPort, setWsServerPort] = useState(String(DEFAULT_WS_PORT));
  const [myWsUrl, setMyWsUrl] = useState("");
  const [joinToken, setJoinToken] = useState<string | null>(null);
  const [serverStarting, setServerStarting] = useState(false);
  const [serverRunning, setServerRunning] = useState<boolean | null>(null);
  const [serverMessage, setServerMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [masterWsUrl, setMasterWsUrl] = useState("");
  const [joinTokenInput, setJoinTokenInput] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinMessage, setJoinMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [syncStarting, setSyncStarting] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [discoveredMasters, setDiscoveredMasters] = useState<DiscoveredMaster[]>([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryDone, setDiscoveryDone] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [läufe, setLäufe] = useState<Abrechnungslauf[]>([]);
  const [laufLoading, setLaufLoading] = useState(false);
  const [laufError, setLaufError] = useState<string | null>(null);
  const [newLaufName, setNewLaufName] = useState("");
  const [slaveResetLoading, setSlaveResetLoading] = useState(false);
  const [slaveResetMessage, setSlaveResetMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [closeoutLoading, setCloseoutLoading] = useState(false);
  const [closeoutMessage, setCloseoutMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [leaveMessage, setLeaveMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [wipeInput, setWipeInput] = useState("");
  const [wipeLoading, setWipeLoading] = useState(false);
  const [wipeMessage, setWipeMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [wipeConfirm, setWipeConfirm] = useState(false);

  const importNotfallInputRef = useRef<HTMLInputElement | null>(null);
  const [notfallActiveLaufId, setNotfallActiveLaufId] = useState<string | null>(null);
  const [notfallPayload, setNotfallPayload] = useState<NotfallExportDto | null>(null);
  const [notfallImportAllowMismatch, setNotfallImportAllowMismatch] = useState(false);
  const [notfallMessage, setNotfallMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [notfallExporting, setNotfallExporting] = useState(false);
  const [notfallImporting, setNotfallImporting] = useState(false);

  useEffect(() => {
    getCurrentKasse().then(setKasse);
    getConfig("role").then(setRole);
  }, []);

  useEffect(() => {
    if (!kasse) return;
    setPerson1(kasse.person1_name || "");
    setPerson2(kasse.person2_name || "");
  }, [kasse]);

  useEffect(() => {
    getConfig("ws_server_port").then((v) => v && setWsServerPort(v));
    getConfig("my_ws_url").then((v) => setMyWsUrl(v ?? ""));
    getConfig("master_ws_url").then((v) => setMasterWsUrl(v ?? ""));
    getJoinToken().then(setJoinToken);
    if (role === "master") {
      isMasterServerRunning().then(setServerRunning);
    } else {
      setServerRunning(null);
    }
  }, [role]);

  useEffect(() => {
    if (role === "master" || role === "slave") {
      setLaufLoading(true);
      setLaufError(null);
      getAbrechnungsläufe()
        .then(setLäufe)
        .catch((e) => setLaufError(String(e)))
        .finally(() => setLaufLoading(false));
    }
  }, [role, resetMessage, slaveResetMessage]);

  async function ensureActiveLaufId(): Promise<string> {
    const id = await getAktivenAbrechnungslaufId();
    setNotfallActiveLaufId(id);
    return id;
  }

  function isNotfallMismatch(): boolean {
    if (!notfallPayload || !notfallActiveLaufId) return false;
    return notfallPayload.meta.exported_lauf_id !== notfallActiveLaufId;
  }

  async function handleNotfallExportExcel() {
    setNotfallMessage(null);
    setNotfallExporting(true);
    try {
      const laufId = await ensureActiveLaufId();
      const dto = await getNotfallExportData(laufId);
      const buffer = buildNotfallExcel(dto);
      const path = await save({
        defaultPath: `Notfall-Export_${dto.meta.exported_lauf_name}_${dto.meta.exported_lauf_id}.xlsx`,
        filters: [{ name: "Excel", extensions: ["xlsx"] }],
      });
      if (!path) return;
      await writeFile(path, new Uint8Array(buffer));
      setNotfallMessage({ ok: true, text: "Notfall-Export (Excel) wurde gespeichert." });
    } catch (e) {
      setNotfallMessage({ ok: false, text: String(e) });
    } finally {
      setNotfallExporting(false);
    }
  }

  async function handleNotfallExportCsv() {
    setNotfallMessage(null);
    setNotfallExporting(true);
    try {
      const laufId = await ensureActiveLaufId();
      const dto = await getNotfallExportData(laufId);
      const csv = buildNotfallCsv(dto);
      const path = await save({
        defaultPath: `Notfall-Export_${dto.meta.exported_lauf_name}_${dto.meta.exported_lauf_id}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!path) return;
      await writeTextFile(path, "\uFEFF" + csv);
      setNotfallMessage({ ok: true, text: "Notfall-Export (CSV) wurde gespeichert." });
    } catch (e) {
      setNotfallMessage({ ok: false, text: String(e) });
    } finally {
      setNotfallExporting(false);
    }
  }

  async function handleNotfallImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    setNotfallMessage(null);
    setNotfallPayload(null);
    setNotfallImportAllowMismatch(false);
    if (!file) return;

    try {
      const active = await ensureActiveLaufId();
      const name = file.name.toLowerCase();
      let payload: NotfallExportDto;
      if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
        payload = parseNotfallExcel(await file.arrayBuffer());
      } else if (name.endsWith(".csv")) {
        payload = parseNotfallCsv(await file.text());
      } else {
        throw new Error("Unbekanntes Dateiformat. Bitte .xlsx oder .csv wählen.");
      }
      setNotfallPayload(payload);
      if (payload.meta.exported_lauf_id !== active) {
        setNotfallMessage({
          ok: false,
          text:
            "Warnung: Exportierter Abrechnungslauf passt nicht zum aktiven Lauf dieser Kasse. " +
            "Du kannst trotzdem importieren (Notfallmodus).",
        });
      } else {
        setNotfallMessage({ ok: true, text: "Datei geladen. Abrechnungslauf passt zum aktiven Lauf." });
      }
    } catch (err) {
      setNotfallMessage({ ok: false, text: String(err) });
    }
  }

  async function handleNotfallImport() {
    if (!notfallPayload) return;
    setNotfallImporting(true);
    setNotfallMessage(null);
    try {
      const target = await ensureActiveLaufId();
      const mismatch = notfallPayload.meta.exported_lauf_id !== target;
      const allowMismatch = mismatch ? notfallImportAllowMismatch : true;
      if (mismatch && !allowMismatch) {
        setNotfallMessage({
          ok: false,
          text: "Import blockiert: Lauf-ID weicht ab. Aktiviere „Trotzdem importieren“, um fortzufahren.",
        });
        return;
      }
      const summary = await importNotfallData({
        payload: notfallPayload,
        targetAbrechnungslaufId: target,
        allowMismatch,
      });
      setNotfallMessage({
        ok: true,
        text:
          `Import abgeschlossen. ` +
          `Kassen: +${summary.inserted_kassen} (ignoriert ${summary.ignored_kassen}), ` +
          `Kundenabrechnungen: +${summary.inserted_kundenabrechnungen} (ignoriert ${summary.ignored_kundenabrechnungen}), ` +
          `Buchungen: +${summary.inserted_buchungen} (ignoriert ${summary.ignored_buchungen}), ` +
          `Stornos: +${summary.inserted_stornos} (ignoriert ${summary.ignored_stornos}).`,
      });
    } catch (e) {
      setNotfallMessage({ ok: false, text: String(e) });
    } finally {
      setNotfallImporting(false);
    }
  }

  async function handleSaveMasterConfig() {
    await setConfig("ws_server_port", wsServerPort);
    if (myWsUrl.trim()) await setConfig("my_ws_url", myWsUrl.trim());
  }

  async function handleSaveSlaveConfig() {
    if (masterWsUrl.trim()) await setConfig("master_ws_url", masterWsUrl.trim());
    if (myWsUrl.trim()) await setConfig("my_ws_url", myWsUrl.trim());
  }

  async function handleGenerateToken() {
    const token = await generateJoinToken();
    setJoinToken(token);
  }

  async function handleSavePersonen() {
    if (!kasse) return;
    setPersonenSaving(true);
    setPersonenMessage(null);
    try {
      await updateKassenPersonen(kasse.id, person1, person2);
      setKasse((prev) =>
        prev ? { ...prev, person1_name: person1.trim() || null, person2_name: person2.trim() || null } : prev
      );
      setEditPersonen(false);
      setPersonenMessage({ ok: true, text: "Besetzung gespeichert." });
    } catch (e) {
      setPersonenMessage({ ok: false, text: String(e) });
    } finally {
      setPersonenSaving(false);
    }
  }

  async function handleStartServer() {
    const port = parseInt(wsServerPort, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      return;
    }
    setServerStarting(true);
    setServerMessage(null);
    try {
      await setConfig("ws_server_port", String(port));
      if (myWsUrl.trim()) await setConfig("my_ws_url", myWsUrl.trim());
      await startMasterServer(port);
      setServerRunning(true);
      setServerMessage({
        ok: true,
        text: `Server gestartet (Port ${port}). Slaves können sich jetzt per „Master im Netzwerk suchen“ oder mit dieser URL anmelden.`,
      });
    } catch (e) {
      setServerMessage({ ok: false, text: String(e) });
      setServerRunning(false);
    } finally {
      setServerStarting(false);
    }
  }

  async function handleStartSync() {
    setSyncMessage(null);
    setSyncStarting(true);
    try {
      const msg = await startSyncConnections();
      setSyncMessage(msg);
    } catch (e) {
      setSyncMessage("Fehler: " + String(e));
    } finally {
      setSyncStarting(false);
    }
  }

  function normalizeJoinCode(input: string): string {
    return input.replace(/\D/g, "");
  }

  async function handleJoinNetwork() {
    const normalized = normalizeJoinCode(joinTokenInput);
    if (normalized.length !== 6) {
      setJoinMessage({ ok: false, text: "Bitte 6-stelligen Code eingeben (z.B. 123 456)." });
      return;
    }
    if (!masterWsUrl.trim()) {
      setJoinMessage({ ok: false, text: "Bitte Master-URL in den Einstellungen eintragen." });
      return;
    }
    if (!myWsUrl.trim()) {
      setJoinMessage({ ok: false, text: "Bitte eigene Sync-URL eintragen (z.B. wss://DEINE_IP:8766)." });
      return;
    }
    setJoinLoading(true);
    setJoinMessage(null);
    try {
      await setConfig("master_ws_url", masterWsUrl.trim());
      await setConfig("my_ws_url", myWsUrl.trim());
      const msg = await joinNetwork(normalized);
      setJoinMessage({ ok: true, text: msg });
      try {
        const syncMsg = await startSyncConnections();
        setJoinMessage((prev) => (prev?.ok ? { ok: true, text: `${prev.text} ${syncMsg}` } : prev));
      } catch {
        // Sync starten optional nach Join
      }
    } catch (e) {
      setJoinMessage({
        ok: false,
        text:
          String(e) +
          " Hinweis: Diese Kasse kann nur beitreten, wenn sie keine eigenen Buchungen hat. " +
          "Setze ggf. den lokalen Abrechnungslauf zurück, bevor du den Join erneut versuchst.",
      });
    } finally {
      setJoinLoading(false);
    }
  }

  return (
    <div className="einstellungen-view">
      <header className="einstellungen-header">
        <button type="button" onClick={onBack}>
          ← Zurück
        </button>
        <div className="einstellungen-header-title">
          <h1>Einstellungen</h1>
          {role && <p className="einstellungen-header-subtitle">{role === "master" ? "Hauptkasse" : "Nebenkasse"}</p>}
        </div>
        {onOpenHandbuch && (
          <button type="button" className="einstellungen-handbuch-link" onClick={onOpenHandbuch}>
            Handbuch
          </button>
        )}
      </header>

      {kasse && (
        <AccordionSection
          title="Diese Kasse"
          subtitle={kasse.name}
          defaultOpen
        >
          <section className="einstellungen-section">
            <div className="einstellungen-kv">
              <div className="einstellungen-kv-row">
                <span className="einstellungen-kv-key">Name</span>
                <span className="einstellungen-kv-value">{kasse.name}</span>
              </div>
              <div className="einstellungen-kv-row">
                <span className="einstellungen-kv-key">Rolle</span>
                <span className="einstellungen-kv-value">{role === "master" ? "Hauptkasse" : "Nebenkasse"}</span>
              </div>
              {!editPersonen ? (
                <>
                  <div className="einstellungen-kv-row">
                    <span className="einstellungen-kv-key">Person 1</span>
                    <span className="einstellungen-kv-value">{kasse.person1_name || "–"}</span>
                  </div>
                  <div className="einstellungen-kv-row">
                    <span className="einstellungen-kv-key">Person 2</span>
                    <span className="einstellungen-kv-value">{kasse.person2_name || "–"}</span>
                  </div>
                </>
              ) : (
                <div className="einstellungen-personen-edit">
                  <label>
                    Person 1
                    <input value={person1} onChange={(e) => setPerson1(e.target.value)} placeholder="Person 1" />
                  </label>
                  <label>
                    Person 2
                    <input value={person2} onChange={(e) => setPerson2(e.target.value)} placeholder="Person 2" />
                  </label>
                </div>
              )}
            </div>
            {!editPersonen ? (
              <div className="einstellungen-actions">
                <button type="button" className="einstellungen-secondary" onClick={() => setEditPersonen(true)}>
                  Besetzung bearbeiten
                </button>
              </div>
            ) : (
              <div className="einstellungen-actions">
                <button type="button" className="einstellungen-primary" onClick={handleSavePersonen} disabled={personenSaving}>
                  {personenSaving ? "Speichere…" : "Speichern"}
                </button>
                <button
                  type="button"
                  className="einstellungen-secondary"
                  onClick={() => {
                    setEditPersonen(false);
                    setPersonenMessage(null);
                    setPerson1(kasse.person1_name || "");
                    setPerson2(kasse.person2_name || "");
                  }}
                  disabled={personenSaving}
                >
                  Abbrechen
                </button>
              </div>
            )}
            {personenMessage && (
              <p className={personenMessage.ok ? "einstellungen-ok" : "einstellungen-error"}>{personenMessage.text}</p>
            )}
          </section>
        </AccordionSection>
      )}

      {role === "master" && (
        <AccordionSection
          title="Netzwerk (Hauptkasse)"
          subtitle="Server starten, Join-Token, Sync"
          defaultOpen
        >
          <section className="einstellungen-section">
            {serverRunning !== null && (
              <p className={serverRunning ? "einstellungen-server-ok" : "einstellungen-server-stopped"}>
                <strong>Status:</strong> {serverRunning ? "Server läuft" : "Server gestoppt"}
              </p>
            )}

            <div className="einstellungen-grid">
              <label>
                Server-Port
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={wsServerPort}
                  onChange={(e) => setWsServerPort(e.target.value)}
                  onBlur={handleSaveMasterConfig}
                />
              </label>
              <label className="einstellungen-grid-span">
                Meine Sync-URL (für andere Kassen)
                <input
                  type="text"
                  value={myWsUrl}
                  onChange={(e) => setMyWsUrl(e.target.value)}
                  onBlur={handleSaveMasterConfig}
                  placeholder="wss://IP:8765"
                />
              </label>
            </div>

            <p className="einstellungen-hinweis">
              Nach dem Start sehen Slaves diese URL in ihren Einstellungen als Master-URL.
            </p>

            <h3>Join-Token</h3>
            <p className="einstellungen-hinweis">
              Slaves brauchen diesen Code, um dem Netz beizutreten.
            </p>
            <div className="einstellungen-token-row">
              <code className="einstellungen-token">
                {joinToken?.length === 6
                  ? `${joinToken.slice(0, 3)} ${joinToken.slice(3)}`
                  : joinToken ?? "–"}
              </code>
              <button type="button" className="einstellungen-secondary" onClick={handleGenerateToken}>
                Neu generieren
              </button>
            </div>

            <div className="einstellungen-actions">
              <button
                type="button"
                className="einstellungen-primary"
                onClick={handleStartServer}
                disabled={serverStarting}
              >
                {serverStarting ? "Starte…" : "Server starten"}
              </button>
            </div>

            {serverMessage && (
              <p className={serverMessage.ok ? "einstellungen-ok" : "einstellungen-error"}>{serverMessage.text}</p>
            )}

            <h3>Sync</h3>
            <p className="einstellungen-hinweis">
              Nach dem Join von Slaves hier Sync starten, damit Kundenabrechnungen ausgetauscht werden.
            </p>
            <div className="einstellungen-actions">
              <button
                type="button"
                className="einstellungen-primary"
                onClick={handleStartSync}
                disabled={syncStarting}
              >
                {syncStarting ? "Starte…" : "Sync zu Peers starten"}
              </button>
            </div>
            {syncMessage && <p className="einstellungen-ok">{syncMessage}</p>}
          </section>
        </AccordionSection>
      )}

      {role === "slave" && (
        <AccordionSection
          title="Netzwerk (Nebenkasse)"
          subtitle="Beitreten, Sync, Reset, Closeout"
          defaultOpen
        >
          <section className="einstellungen-section">
            <p className="einstellungen-hinweis">
              Hauptkasse im Netzwerk suchen oder URL manuell eintragen. Auf dem gleichen Rechner funktioniert mDNS oft nicht – dann
              „Hauptkasse auf diesem Rechner“ wählen.
            </p>

            <div className="einstellungen-discovery">
              <button
                type="button"
                className="einstellungen-discovery-local"
                onClick={async () => {
                  const localUrl = `wss://127.0.0.1:${DEFAULT_WS_PORT}`;
                  setMasterWsUrl(localUrl);
                  await setConfig("master_ws_url", localUrl);
                }}
              >
                Hauptkasse auf diesem Rechner (127.0.0.1)
              </button>
              <button
                type="button"
                className="einstellungen-secondary"
                onClick={async () => {
                  setDiscoveryLoading(true);
                  setDiscoveredMasters([]);
                  setDiscoveryDone(false);
                  try {
                    const list = await discoverMasters();
                    setDiscoveredMasters(list);
                  } catch (e) {
                    setJoinMessage({ ok: false, text: "Suche fehlgeschlagen: " + String(e) });
                  } finally {
                    setDiscoveryLoading(false);
                    setDiscoveryDone(true);
                  }
                }}
                disabled={discoveryLoading}
              >
                {discoveryLoading ? "Suche…" : "Hauptkasse im Netzwerk suchen"}
              </button>
              {discoveredMasters.length > 0 && (
                <ul className="einstellungen-discovered-list">
                  {discoveredMasters.map((m) => (
                    <li key={m.ws_url}>
                      <button
                        type="button"
                        className="einstellungen-discovered-item"
                        onClick={async () => {
                          setMasterWsUrl(m.ws_url);
                          await setConfig("master_ws_url", m.ws_url);
                        }}
                      >
                        <span className="einstellungen-discovered-name">{m.name}</span>
                        <span className="einstellungen-discovered-url">{m.ws_url}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {discoveryDone && discoveredMasters.length === 0 && (
                <p className="einstellungen-discovery-hint">Keine Hauptkasse gefunden. Bitte URL manuell eintragen.</p>
              )}
            </div>

            <div className="einstellungen-grid">
              <label className="einstellungen-grid-span">
                Hauptkassen-URL (WebSocket der Hauptkasse)
                <input
                  type="text"
                  value={masterWsUrl}
                  onChange={(e) => setMasterWsUrl(e.target.value)}
                  onBlur={handleSaveSlaveConfig}
                  placeholder="wss://IP:8765"
                />
              </label>
              <label className="einstellungen-grid-span">
                Eigene Sync-URL (unter der diese Kasse erreichbar ist)
                <input
                  type="text"
                  value={myWsUrl}
                  onChange={(e) => setMyWsUrl(e.target.value)}
                  onBlur={handleSaveSlaveConfig}
                  placeholder="wss://IP:8766"
                />
              </label>
              <label>
                Join-Code (6 Ziffern, von der Hauptkasse)
                <input
                  type="text"
                  inputMode="numeric"
                  value={joinTokenInput}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "");
                    if (digits.length <= 6) setJoinTokenInput(digits);
                  }}
                  onBlur={() => {
                    const d = joinTokenInput.replace(/\D/g, "");
                    if (d.length <= 3) setJoinTokenInput(d);
                    else if (d.length <= 6) setJoinTokenInput(`${d.slice(0, 3)} ${d.slice(3)}`);
                  }}
                  placeholder="000 000"
                />
              </label>
            </div>

            <div className="einstellungen-actions">
              <button
                type="button"
                className="einstellungen-primary"
                onClick={handleJoinNetwork}
                disabled={joinLoading}
              >
                {joinLoading ? "Beitreten…" : "Netz beitreten"}
              </button>
            </div>
            {joinMessage && <p className={joinMessage.ok ? "einstellungen-ok" : "einstellungen-error"}>{joinMessage.text}</p>}

            <h3>Sync</h3>
            <p className="einstellungen-hinweis">Sync-Verbindungen erneut starten (z. B. nach Verbindungsabbruch).</p>
            <div className="einstellungen-actions">
              <button
                type="button"
                className="einstellungen-primary"
                onClick={handleStartSync}
                disabled={syncStarting}
              >
                {syncStarting ? "Starte…" : "Sync starten"}
              </button>
            </div>
            {syncMessage && <p className="einstellungen-ok">{syncMessage}</p>}

            <h3>Lokalen Abrechnungslauf leeren</h3>
            <p className="einstellungen-hinweis">
              Wenn diese Nebenkasse bereits eigene Buchungen hat und du dich deshalb nicht an die Hauptkasse koppeln kannst, kannst du
              hier eine Reset-Anfrage an die Hauptkasse senden. Die Hauptkasse prüft, ob alle deine Daten bei ihr angekommen sind; wenn
              ja, wird der lokale Abrechnungslauf geleert und mit dem Lauf der Hauptkasse abgeglichen.
            </p>
            <div className="einstellungen-actions">
              <button
                type="button"
                className="einstellungen-primary"
                onClick={async () => {
                  setSlaveResetLoading(true);
                  setSlaveResetMessage(null);
                  try {
                    const msg = await requestSlaveReset();
                    setSlaveResetMessage({ ok: true, text: msg });
                  } catch (e) {
                    setSlaveResetMessage({ ok: false, text: String(e) });
                  } finally {
                    setSlaveResetLoading(false);
                  }
                }}
                disabled={slaveResetLoading}
              >
                {slaveResetLoading ? "Anfrage wird gesendet…" : "Reset-Anfrage an Hauptkasse senden"}
              </button>
            </div>
            {slaveResetMessage && (
              <p className={slaveResetMessage.ok ? "einstellungen-ok" : "einstellungen-error"}>{slaveResetMessage.text}</p>
            )}

            <h3>Abmelden (Lauf fertig)</h3>
            <p className="einstellungen-hinweis">
              Am Laufende kann diese Nebenkasse eine Closeout-Bestätigung anfordern. Abmelden ist erst möglich, wenn die Hauptkasse
              bestätigt, dass alle Buchungen und Stornos dieser Nebenkasse angekommen sind.
            </p>
            <div className="einstellungen-actions">
              <button
                type="button"
                className="einstellungen-primary"
                onClick={async () => {
                  setCloseoutLoading(true);
                  setCloseoutMessage(null);
                  try {
                    const msg = await requestCloseout();
                    setCloseoutMessage({ ok: true, text: msg });
                  } catch (e) {
                    setCloseoutMessage({ ok: false, text: String(e) });
                  } finally {
                    setCloseoutLoading(false);
                  }
                }}
                disabled={closeoutLoading}
              >
                {closeoutLoading ? "Prüfe…" : "Closeout bei Hauptkasse anfragen"}
              </button>
              <button
                type="button"
                className="einstellungen-reset"
                onClick={async () => {
                  if (!closeoutMessage?.ok) {
                    setLeaveMessage({ ok: false, text: "Bitte zuerst Closeout erfolgreich anfragen." });
                    return;
                  }
                  const ok = await confirm("Nebenkasse wirklich entkoppeln? Danach ist ein erneuter Join nötig.", {
                    title: "Nebenkasse entkoppeln",
                    kind: "warning",
                    okLabel: "Entkoppeln",
                    cancelLabel: "Abbrechen",
                  });
                  if (!ok) {
                    return;
                  }
                  setLeaveLoading(true);
                  setLeaveMessage(null);
                  try {
                    const msg = await leaveNetwork();
                    setLeaveMessage({ ok: true, text: msg });
                  } catch (e) {
                    setLeaveMessage({ ok: false, text: String(e) });
                  } finally {
                    setLeaveLoading(false);
                  }
                }}
                disabled={leaveLoading}
              >
                {leaveLoading ? "Entkopple…" : "Abmelden & entkoppeln"}
              </button>
            </div>
            {closeoutMessage && (
              <p className={closeoutMessage.ok ? "einstellungen-ok" : "einstellungen-error"}>{closeoutMessage.text}</p>
            )}
            {leaveMessage && <p className={leaveMessage.ok ? "einstellungen-ok" : "einstellungen-error"}>{leaveMessage.text}</p>}
          </section>
        </AccordionSection>
      )}

      {(role === "master" || role === "slave") && (
        <AccordionSection
          title="Notfallmodus"
          subtitle="Export/Import (Excel/CSV)"
        >
          <section className="einstellungen-section">
            <p className="einstellungen-hinweis">
              Für den absoluten Notfall: Bewegungsdaten eines Abrechnungslaufs als Datei exportieren und auf einer anderen Kasse wieder
              importieren, um Daten manuell zusammenzuführen.
            </p>

            <div className="einstellungen-token-row">
              <button
                type="button"
                className="einstellungen-primary"
                onClick={handleNotfallExportExcel}
                disabled={notfallExporting}
              >
                {notfallExporting ? "Exportiere…" : "Notfall-Export (Excel)"}
              </button>
              <button
                type="button"
                className="einstellungen-secondary"
                onClick={handleNotfallExportCsv}
                disabled={notfallExporting}
              >
                {notfallExporting ? "Exportiere…" : "Notfall-Export (CSV)"}
              </button>
            </div>

            <input
              ref={importNotfallInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: "none" }}
              onChange={handleNotfallImportFile}
            />
            <div className="einstellungen-token-row">
              <button
                type="button"
                className="einstellungen-secondary"
                onClick={() => importNotfallInputRef.current?.click()}
                disabled={notfallImporting}
              >
                Datei wählen (Import)
              </button>
              <button
                type="button"
                className="einstellungen-primary"
                onClick={handleNotfallImport}
                disabled={!notfallPayload || notfallImporting}
              >
                {notfallImporting ? "Importiere…" : "Importieren"}
              </button>
            </div>

            {notfallPayload && (
              <div className="einstellungen-panel">
                <p>
                  <strong>Export-Lauf:</strong> {notfallPayload.meta.exported_lauf_name} ({notfallPayload.meta.exported_lauf_id})
                </p>
                <p>
                  <strong>Aktiver Lauf (Ziel):</strong> {notfallActiveLaufId ?? "–"}
                </p>
                <p>
                  <strong>Datensätze:</strong> {notfallPayload.kundenabrechnungen.length} Kundenabrechnungen,{" "}
                  {notfallPayload.buchungen.length} Buchungen, {notfallPayload.stornos.length} Stornos,{" "}
                  {notfallPayload.kassen.length} Kassen
                </p>

                {isNotfallMismatch() && (
                  <label className="einstellungen-inline-checkbox">
                    <input
                      type="checkbox"
                      checked={notfallImportAllowMismatch}
                      onChange={(e) => setNotfallImportAllowMismatch(e.target.checked)}
                    />
                    Trotzdem importieren (Lauf-ID weicht ab)
                  </label>
                )}
              </div>
            )}

            {notfallMessage && (
              <p className={notfallMessage.ok ? "einstellungen-ok" : "einstellungen-error"}>{notfallMessage.text}</p>
            )}
          </section>
        </AccordionSection>
      )}

      {(role === "master" || role === "slave") && (
        <AccordionSection title="Abrechnungsläufe" subtitle="Läufe verwalten / neuen Lauf starten">
          <section className="einstellungen-section">
            {laufLoading && <p>Abrechnungsläufe werden geladen…</p>}
            {laufError && <p className="einstellungen-error">{laufError}</p>}
            {!laufLoading && !laufError && läufe.length > 0 && (
              <ul className="einstellungen-läufe-list">
                {läufe.map((lauf) => (
                  <li key={lauf.id} className="einstellungen-lauf-item">
                    <div className="einstellungen-lauf-main">
                      <div>
                        <strong>{lauf.name}</strong> {lauf.is_aktiv && <span className="einstellungen-tag">aktiver Lauf</span>}
                      </div>
                      <div className="einstellungen-lauf-dates">
                        <span>Start: {new Date(lauf.start_zeitpunkt).toLocaleString()}</span>
                        {lauf.end_zeitpunkt && <span>Ende: {new Date(lauf.end_zeitpunkt).toLocaleString()}</span>}
                      </div>
                    </div>
                    {!lauf.is_aktiv && (
                      <button
                        type="button"
                        className="einstellungen-reset"
                        onClick={async () => {
                          const ok = await confirm("Diesen Abrechnungslauf und alle zugehörigen Belege löschen?", {
                            title: "Abrechnungslauf löschen",
                            kind: "warning",
                            okLabel: "Löschen",
                            cancelLabel: "Abbrechen",
                          });
                          if (!ok) {
                            return;
                          }
                          try {
                            await deleteAbrechnungslauf(lauf.id);
                            setLäufe((prev) => prev.filter((l) => l.id !== lauf.id));
                          } catch (e) {
                            setLaufError(String(e));
                          }
                        }}
                      >
                        Lauf löschen
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <h3>Neuen Abrechnungslauf starten</h3>
            <p className="einstellungen-hinweis">
              Alle Kundenabrechnungen und Buchungen werden gelöscht. Händlerliste und Kassen-Einrichtung bleiben erhalten.
            </p>
            <label>
              Name des neuen Abrechnungslaufs
              <input
                type="text"
                value={newLaufName}
                onChange={(e) => setNewLaufName(e.target.value)}
                placeholder="z.B. Stadtfest 2026"
              />
            </label>
            {!resetConfirm ? (
              <button
                type="button"
                className="einstellungen-reset"
                onClick={() => setResetConfirm(true)}
                disabled={!newLaufName.trim()}
              >
                Neuen Abrechnungslauf starten
              </button>
            ) : (
              <div className="einstellungen-reset-confirm">
                <p>Wirklich alle Buchungen löschen und neuen Abrechnungslauf „{newLaufName.trim()}“ starten?</p>
                <div className="einstellungen-reset-buttons">
                  <button
                    type="button"
                    onClick={() => {
                      setResetConfirm(false);
                      setResetMessage(null);
                    }}
                  >
                    Abbrechen
                  </button>
                  <button
                    type="button"
                    className="einstellungen-primary"
                    onClick={async () => {
                      setResetLoading(true);
                      setResetMessage(null);
                      try {
                        await createAbrechnungslauf(newLaufName.trim());
                        setNewLaufName("");
                        setResetConfirm(false);
                        setResetMessage("Neuer Abrechnungslauf gestartet.");
                        const list = await getAbrechnungsläufe();
                        setLäufe(list);
                      } catch (e) {
                        setResetMessage("Fehler: " + String(e));
                      } finally {
                        setResetLoading(false);
                      }
                    }}
                    disabled={resetLoading}
                  >
                    {resetLoading ? "…" : "Ja, neuen Lauf starten"}
                  </button>
                </div>
              </div>
            )}
            {resetMessage && <p className="einstellungen-ok">{resetMessage}</p>}
          </section>
        </AccordionSection>
      )}

      {(role === "master" || role === "slave") && (
        <AccordionSection title="Danger Zone" subtitle="Lokale Daten löschen">
          <section className="einstellungen-section einstellungen-danger-zone">
            <p className="einstellungen-danger-text">
              <strong>Lokale Daten komplett entfernen:</strong> Löscht die gesamte lokale Datenbasis dieser Kasse (inkl. Datenbank und
              lokaler Artefakte im App-Datenordner). Danach startet die App wieder im Erststart-Modus.
            </p>
            <p className="einstellungen-danger-text">
              Sicherheitsprüfung: Tippe <code>DELETE</code>, um den Button freizuschalten.
            </p>
            <label>
              Bestätigung
              <input
                type="text"
                value={wipeInput}
                onChange={(e) => setWipeInput(e.target.value)}
                placeholder="DELETE"
                autoComplete="off"
              />
            </label>

            {!wipeConfirm ? (
              <button
                type="button"
                className="einstellungen-danger-button"
                disabled={wipeLoading || wipeInput !== "DELETE"}
                onClick={() => {
                  setWipeConfirm(true);
                  setWipeMessage(null);
                }}
              >
                Alles lokal löschen
              </button>
            ) : (
              <div className="einstellungen-reset-confirm">
                <p className="einstellungen-danger-text">
                  Wirklich <strong>ALLE</strong> lokalen Daten dieser Kasse löschen? Dies kann nicht rückgängig gemacht werden.
                </p>
                <div className="einstellungen-reset-buttons">
                  <button
                    type="button"
                    onClick={() => {
                      setWipeConfirm(false);
                      setWipeMessage(null);
                    }}
                    disabled={wipeLoading}
                  >
                    Abbrechen
                  </button>
                  <button
                    type="button"
                    className="einstellungen-danger-button"
                    onClick={async () => {
                      setWipeLoading(true);
                      setWipeMessage(null);
                      try {
                        await wipeLocalData();
                        setWipeMessage({ ok: true, text: "Lokale Daten wurden gelöscht. App wird neu gestartet…" });
                        window.location.reload();
                      } catch (e) {
                        setWipeMessage({ ok: false, text: String(e) });
                      } finally {
                        setWipeLoading(false);
                      }
                    }}
                    disabled={wipeLoading}
                  >
                    {wipeLoading ? "Lösche…" : "Ja, alles löschen"}
                  </button>
                </div>
              </div>
            )}

            {wipeMessage && <p className={wipeMessage.ok ? "einstellungen-ok" : "einstellungen-error"}>{wipeMessage.text}</p>}
          </section>
        </AccordionSection>
      )}

      {role !== "master" && role !== "slave" && (
        <p className="einstellungen-footer">Master-Adresse, Sync-Port und weitere Optionen folgen in Phase 2.</p>
      )}
    </div>
  );
}
