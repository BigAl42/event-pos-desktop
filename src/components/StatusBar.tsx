import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { getConfig, getJoinRequests, getAbrechnungsläufe, type Abrechnungslauf } from "../db";
import { useSyncData } from "../SyncDataContext";
import { useSyncStatus } from "../SyncStatusContext";
import "./StatusBar.css";

type Props = {
  onOpenJoinRequests?: () => void;
  onOpenHandbook?: () => void;
};

export default function StatusBar({ onOpenJoinRequests, onOpenHandbook }: Props) {
  const { t } = useTranslation();
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

  const roleLabel = role === "master" ? t("statusBar.roleMain") : t("statusBar.roleSlave");

  return (
    <footer className="status-bar" role="status" aria-live="polite">
      <span className="status-bar-role">
        {roleLabel}
        {kassenName ? ` – ${kassenName}` : ""}
      </span>
      <span className="status-bar-sep"> · </span>
      <span className={isConnected ? "status-bar-ok" : "status-bar-warn"}>{statusText}</span>
      {aktuellerLaufName && (
        <>
          <span className="status-bar-sep"> · </span>
          <span className="status-bar-lauf">
            {t("statusBar.currentBillingCycle")} <strong>{aktuellerLaufName}</strong>
          </span>
        </>
      )}
      {role === "master" && pendingJoinCount > 0 && onOpenJoinRequests && (
        <>
          <span className="status-bar-sep"> · </span>
          <button
            type="button"
            className="status-bar-pending-join"
            onClick={onOpenJoinRequests}
            aria-label={t("statusBar.joinRequestsAria", { count: pendingJoinCount })}
          >
            {t("statusBar.joinRequestsPending", { count: pendingJoinCount })}
          </button>
        </>
      )}
      {onOpenHandbook && (
        <>
          <span className="status-bar-sep"> · </span>
          <button type="button" className="status-bar-hilfe" onClick={onOpenHandbook}>
            {t("statusBar.help")}
          </button>
        </>
      )}
    </footer>
  );
}
