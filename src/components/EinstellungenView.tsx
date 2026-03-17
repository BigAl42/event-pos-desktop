import { useState, useEffect } from "react";
import {
  getCurrentKasse,
  getConfig,
  setConfig,
  getJoinToken,
  generateJoinToken,
  startMasterServer,
  isMasterServerRunning,
  joinNetwork,
  startSyncConnections,
  discoverMasters,
  getAbrechnungsläufe,
  createAbrechnungslauf,
  deleteAbrechnungslauf,
  requestSlaveReset,
} from "../db";
import type { Kasse, DiscoveredMaster, Abrechnungslauf } from "../db";
import "./EinstellungenView.css";

type Props = { onBack: () => void };

const DEFAULT_WS_PORT = 8765;

export default function EinstellungenView({ onBack }: Props) {
  const [kasse, setKasse] = useState<Kasse | null>(null);
  const [role, setRole] = useState<string | null>(null);

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

  useEffect(() => {
    getCurrentKasse().then(setKasse);
    getConfig("role").then(setRole);
  }, []);

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
      setJoinMessage({ ok: false, text: "Bitte eigene Sync-URL eintragen (z.B. ws://DEINE_IP:8766)." });
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
      } catch (_) {
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
        <h1>Einstellungen</h1>
      </header>

      {kasse && (
        <section className="einstellungen-section">
          <h2>Diese Kasse</h2>
          <p>
            <strong>Name:</strong> {kasse.name}
          </p>
          <p>
            <strong>Rolle:</strong> {role === "master" ? "Hauptkasse" : "Nebenkasse"}
          </p>
          <p>
            <strong>Person 1:</strong> {kasse.person1_name || "–"}
          </p>
          <p>
            <strong>Person 2:</strong> {kasse.person2_name || "–"}
          </p>
          <p className="einstellungen-hinweis">
            Personen können in der Kassen-Ansicht unter „Besetzung ändern“ angepasst werden.
          </p>
        </section>
      )}

      {role === "master" && (
        <section className="einstellungen-section">
          <h2>Hauptkasse: WebSocket-Server</h2>
          {serverRunning !== null && (
            <p className={serverRunning ? "einstellungen-server-ok" : "einstellungen-server-stopped"}>
              <strong>Status:</strong> {serverRunning ? "Server läuft" : "Server gestoppt"}
            </p>
          )}
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
          <label>
            Meine Sync-URL (für andere Kassen, z.B. ws://192.168.1.1:8765)
            <input
              type="text"
              value={myWsUrl}
              onChange={(e) => setMyWsUrl(e.target.value)}
              onBlur={handleSaveMasterConfig}
              placeholder="ws://IP:8765"
            />
          </label>
          <p className="einstellungen-hinweis">
            Nach dem Start sehen Slaves diese URL in ihren Einstellungen als Master-URL.
          </p>
          <h3>Join-Token</h3>
          <p>
            Slaves brauchen diesen Token, um dem Netz beizutreten. Token generieren und anzeigen:
          </p>
          <div className="einstellungen-token-row">
            <code className="einstellungen-token">
              {joinToken?.length === 6
                ? `${joinToken.slice(0, 3)} ${joinToken.slice(3)}`
                : joinToken ?? "–"}
            </code>
            <button type="button" onClick={handleGenerateToken}>
              Neu generieren
            </button>
          </div>
          <button
            type="button"
            className="einstellungen-primary"
            onClick={handleStartServer}
            disabled={serverStarting}
          >
            {serverStarting ? "Starte…" : "Server starten"}
          </button>
          {serverMessage && (
            <p className={serverMessage.ok ? "einstellungen-ok" : "einstellungen-error"}>
              {serverMessage.text}
            </p>
          )}
          <h3>Sync (Phase 3)</h3>
          <p>Nach dem Join von Slaves hier Sync starten, damit Kundenabrechnungen ausgetauscht werden.</p>
          <button
            type="button"
            className="einstellungen-primary"
            onClick={handleStartSync}
            disabled={syncStarting}
          >
            {syncStarting ? "Starte…" : "Sync zu Peers starten"}
          </button>
          {syncMessage && <p className="einstellungen-ok">{syncMessage}</p>}
        </section>
      )}

      {role === "slave" && (
        <section className="einstellungen-section">
          <h2>Nebenkasse: Netz beitreten</h2>
          <p className="einstellungen-hinweis">
            Hauptkasse im Netzwerk suchen oder URL manuell eintragen. Auf dem gleichen Rechner funktioniert mDNS oft nicht – dann „Hauptkasse auf diesem Rechner“ wählen.
          </p>
          <div className="einstellungen-discovery">
            <button
              type="button"
              className="einstellungen-discovery-local"
              onClick={async () => {
                const localUrl = `ws://127.0.0.1:${DEFAULT_WS_PORT}`;
                setMasterWsUrl(localUrl);
                await setConfig("master_ws_url", localUrl);
              }}
            >
              Hauptkasse auf diesem Rechner (127.0.0.1)
            </button>
            <button
              type="button"
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
          <label>
            Hauptkassen-URL (WebSocket der Hauptkasse, z.B. ws://192.168.1.1:8765)
            <input
              type="text"
              value={masterWsUrl}
              onChange={(e) => setMasterWsUrl(e.target.value)}
              onBlur={handleSaveSlaveConfig}
              placeholder="ws://IP:8765"
            />
          </label>
          <label>
            Eigene Sync-URL (unter der diese Kasse erreichbar ist, z.B. ws://192.168.1.2:8766)
            <input
              type="text"
              value={myWsUrl}
              onChange={(e) => setMyWsUrl(e.target.value)}
              onBlur={handleSaveSlaveConfig}
              placeholder="ws://IP:8766"
            />
          </label>
          <label>
            Join-Code (6 Ziffern, von der Hauptkasse, z.B. 123 456)
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
          <button
            type="button"
            className="einstellungen-primary"
            onClick={handleJoinNetwork}
            disabled={joinLoading}
          >
            {joinLoading ? "Beitreten…" : "Netz beitreten"}
          </button>
          {joinMessage && (
            <p className={joinMessage.ok ? "einstellungen-ok" : "einstellungen-error"}>
              {joinMessage.text}
            </p>
          )}
          <h3>Sync (Phase 3)</h3>
          <p>Sync-Verbindungen erneut starten (z. B. nach Verbindungsabbruch).</p>
          <button
            type="button"
            className="einstellungen-primary"
            onClick={handleStartSync}
            disabled={syncStarting}
          >
            {syncStarting ? "Starte…" : "Sync starten"}
          </button>
          {syncMessage && <p className="einstellungen-ok">{syncMessage}</p>}

          <h3>Lokalen Abrechnungslauf leeren</h3>
          <p className="einstellungen-hinweis">
            Wenn diese Nebenkasse bereits eigene Buchungen hat und du dich deshalb nicht an die Hauptkasse koppeln kannst, kannst du hier eine Reset-Anfrage an die Hauptkasse senden. Die Hauptkasse prüft, ob alle deine Daten bei ihr angekommen sind; wenn ja, wird der lokale Abrechnungslauf geleert und mit dem Lauf der Hauptkasse abgeglichen. Anschließend kannst du erneut „Netz beitreten“.
          </p>
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
          {slaveResetMessage && (
            <p className={slaveResetMessage.ok ? "einstellungen-ok" : "einstellungen-error"}>
              {slaveResetMessage.text}
            </p>
          )}
        </section>
      )}

      {(role === "master" || role === "slave") && (
        <section className="einstellungen-section">
          <h2>Abrechnungsläufe</h2>
          {laufLoading && <p>Abrechnungsläufe werden geladen…</p>}
          {laufError && <p className="einstellungen-error">{laufError}</p>}
          {!laufLoading && !laufError && läufe.length > 0 && (
            <ul className="einstellungen-läufe-list">
              {läufe.map((lauf) => (
                <li key={lauf.id} className="einstellungen-lauf-item">
                  <div>
                    <strong>{lauf.name}</strong>{" "}
                    {lauf.is_aktiv && <span className="einstellungen-tag">aktiver Lauf</span>}
                  </div>
                  <div className="einstellungen-lauf-dates">
                    <span>Start: {new Date(lauf.start_zeitpunkt).toLocaleString()}</span>
                    {lauf.end_zeitpunkt && (
                      <span>Ende: {new Date(lauf.end_zeitpunkt).toLocaleString()}</span>
                    )}
                  </div>
                  {!lauf.is_aktiv && (
                    <button
                      type="button"
                      className="einstellungen-reset"
                      onClick={async () => {
                        if (!window.confirm("Diesen Abrechnungslauf und alle zugehörigen Belege löschen?")) {
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
            Name des neuen Abrechnungslaufs (z.B. Event-Name)
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
              <p>
                Wirklich alle Buchungen löschen und neuen Abrechnungslauf „{newLaufName.trim()}“ starten?
              </p>
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
      )}

      {role !== "master" && role !== "slave" && (
        <p className="einstellungen-footer">
          Master-Adresse, Sync-Port und weitere Optionen folgen in Phase 2.
        </p>
      )}
    </div>
  );
}
