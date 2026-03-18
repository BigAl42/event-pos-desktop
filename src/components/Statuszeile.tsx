import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getConfig, getJoinRequests, getAbrechnungsläufe, type Abrechnungslauf } from "../db";
import { useSyncData } from "../SyncDataContext";
import { useSyncStatus } from "../SyncStatusContext";
import "./Statuszeile.css";

type Props = {
  onOpenJoinAnfragen?: () => void;
};

export default function Statuszeile({ onOpenJoinAnfragen }: Props) {
  const { role, isConnected, statusText } = useSyncStatus();
  const [pendingJoinCount, setPendingJoinCount] = useState(0);
  const { syncDataVersion } = useSyncData();
  const [kassenName, setKassenName] = useState<string | null>(null);
  const [aktuellerLaufName, setAktuellerLaufName] = useState<string | null>(null);

  useEffect(() => {
    getConfig("kassenname").then(setKassenName);
  }, []);

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

  if (role !== "master" && role !== "slave") return null;

  const roleLabel = role === "master" ? "Hauptkasse" : "Nebenkasse";

  return (
    <footer className="statuszeile" role="status" aria-live="polite">
      <span className="statuszeile-role">
        {roleLabel}
        {kassenName ? ` – ${kassenName}` : ""}
      </span>
      <span className="statuszeile-sep"> · </span>
      <span className={isConnected ? "statuszeile-ok" : "statuszeile-warn"}>{statusText}</span>
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
