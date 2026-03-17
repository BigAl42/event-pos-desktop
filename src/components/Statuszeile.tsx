import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getConfig, getSyncStatus, getJoinRequests, getAbrechnungsläufe, type Abrechnungslauf } from "../db";
import { useSyncData } from "../SyncDataContext";
import "./Statuszeile.css";

const HYSTERESIS_MS = 8000;

type Props = {
  onOpenJoinAnfragen?: () => void;
};

export default function Statuszeile({ onOpenJoinAnfragen }: Props) {
  const [role, setRole] = useState<string | null>(null);
  const [connected, setConnected] = useState<number>(0);
  const [total, setTotal] = useState<number>(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [considerConnected, setConsiderConnected] = useState(false);
  const [disconnectTimerActive, setDisconnectTimerActive] = useState(false);
  const [lastConnectedCount, setLastConnectedCount] = useState(0);
  const [pendingJoinCount, setPendingJoinCount] = useState(0);
  const { syncDataVersion } = useSyncData();
  const [kassenName, setKassenName] = useState<string | null>(null);
  const [aktuellerLaufName, setAktuellerLaufName] = useState<string | null>(null);

  useEffect(() => {
    getConfig("role").then(setRole);
    getConfig("kassenname").then(setKassenName);
  }, []);

  useEffect(() => {
    function load() {
      getSyncStatus()
        .then((entries) => {
          setSyncError(null);
          setTotal(entries.length);
          const c = entries.filter((e) => e.connected).length;
          setConnected(c);
          if (c > 0) setLastConnectedCount(c);
        })
        .catch((e) => {
          const msg = String(e);
          setSyncError(msg);
          setTotal(0);
          setConnected(0);
        });
    }
    load();
    const id = setInterval(load, 3500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // sofort nach sync-data-changed neu laden
    getSyncStatus()
      .then((entries) => {
        setSyncError(null);
        setTotal(entries.length);
        const c = entries.filter((e) => e.connected).length;
        setConnected(c);
        if (c > 0) setLastConnectedCount(c);
      })
      .catch((e) => {
        const msg = String(e);
        setSyncError(msg);
        setTotal(0);
        setConnected(0);
      });
  }, [syncDataVersion]);

  useEffect(() => {
    if (role !== "master" && role !== "slave") {
      setAktuellerLaufName(null);
      return;
    }
    getAbrechnungsläufe()
      .then((läufe: Abrechnungslauf[]) => {
        const aktiver = läufe.find((l) => l.is_aktiv);
        setAktuellerLaufName(aktiver ? aktiver.name : null);
      })
      .catch(() => {
        setAktuellerLaufName(null);
      });
  }, [role, syncDataVersion]);

  useEffect(() => {
    if (role !== "master") return;
    function loadPending() {
      getJoinRequests()
        .then((list) => setPendingJoinCount(list.length))
        .catch(() => setPendingJoinCount(0));
    }
    loadPending();
    const id = setInterval(loadPending, 3500);
    const unlisten = listen("join-request-pending", loadPending);
    return () => {
      clearInterval(id);
      unlisten.then((fn) => fn());
    };
  }, [role]);

  useEffect(() => {
    if (role !== "master" && role !== "slave") {
      setConsiderConnected(false);
      setDisconnectTimerActive(false);
      return;
    }
    if (total > 0 && connected > 0) {
      setConsiderConnected(true);
      setDisconnectTimerActive(false);
      return;
    }
    if (!considerConnected || disconnectTimerActive) return;
    setDisconnectTimerActive(true);
    const t = setTimeout(() => {
      setConsiderConnected(false);
      setDisconnectTimerActive(false);
    }, HYSTERESIS_MS);
    return () => clearTimeout(t);
  }, [role, total, connected, considerConnected, disconnectTimerActive]);

  if (role !== "master" && role !== "slave") return null;

  const roleLabel = role === "master" ? "Hauptkasse" : "Nebenkasse";
  const notConfigured =
    !!syncError &&
    (syncError.includes("Eigene Sync-URL nicht konfiguriert") ||
      syncError.includes("Hauptkassen-URL nicht konfiguriert"));
  const isOk = !syncError && total > 0 && (connected > 0 || considerConnected);
  const displayConnected = connected > 0 ? connected : lastConnectedCount;
  const statusText = syncError
    ? notConfigured
      ? "Sync nicht konfiguriert – bitte Einstellungen prüfen."
      : "Sync-Status aktuell nicht abrufbar."
    : total === 0
      ? "Keine weiteren Kassen im Netzwerk."
      : isOk
        ? `Verbunden mit ${displayConnected} von ${total} Kassen`
        : `Nicht verbunden (0 von ${total} Kassen)`;

  return (
    <footer className="statuszeile" role="status" aria-live="polite">
      <span className="statuszeile-role">
        {roleLabel}
        {kassenName ? ` – ${kassenName}` : ""}
      </span>
      <span className="statuszeile-sep"> · </span>
      <span className={isOk ? "statuszeile-ok" : "statuszeile-warn"}>{statusText}</span>
      {aktuellerLaufName && (
        <>
          <span className="statuszeile-sep"> · </span>
          <span className="statuszeile-lauf">
            Aktueller Abrechnungslauf: <strong>{aktuellerLaufName}</strong>
          </span>
        </>
      )}
      {role === "master" && pendingJoinCount > 0 && onOpenJoinAnfragen && (
        <>
          <span className="statuszeile-sep"> · </span>
          <button
            type="button"
            className="statuszeile-pending-join"
            onClick={onOpenJoinAnfragen}
            aria-label={`${pendingJoinCount} Join-Anfrage(n) ausstehend – öffnen`}
          >
            {pendingJoinCount} Join-Anfrage{pendingJoinCount !== 1 ? "n" : ""} ausstehend
          </button>
        </>
      )}
    </footer>
  );
}
