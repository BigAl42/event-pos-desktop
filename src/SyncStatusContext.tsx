import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getConfig, getSyncStatus, type SyncStatusEntry } from "./db";
import { useSyncData } from "./SyncDataContext";
import i18n from "./i18n";

export const SYNC_STATUS_POLL_MS = 3500;

type SyncStatusState = {
  role: string | null;
  entries: SyncStatusEntry[];
  total: number;
  connected: number;
  syncError: string | null;
  notConfigured: boolean;
  isConnected: boolean;
  statusText: string;
  lastRefreshAt: number | null;
  pollMs: number;
  refresh: () => void;
};

const SyncStatusContext = createContext<SyncStatusState | null>(null);

function computeNotConfigured(syncError: string | null): boolean {
  if (!syncError) return false;
  return (
    syncError.includes("My sync URL is not configured") ||
    syncError.includes("Main register URL is not configured") ||
    syncError.includes("Eigene Sync-URL nicht konfiguriert") ||
    syncError.includes("Hauptkassen-URL nicht konfiguriert")
  );
}

function computeStatusText(args: {
  syncError: string | null;
  notConfigured: boolean;
  total: number;
  connected: number;
}): string {
  const { syncError, notConfigured, total, connected } = args;
  if (syncError) {
    return notConfigured
      ? i18n.t("syncStatus.notConfigured")
      : i18n.t("syncStatus.unavailable");
  }
  if (total === 0) return i18n.t("syncStatus.noPeers");
  if (connected > 0) return i18n.t("syncStatus.connected", { connected, total });
  return i18n.t("syncStatus.disconnected", { total });
}

export function SyncStatusProvider({ children }: { children: React.ReactNode }) {
  const { syncDataVersion } = useSyncData();
  const [role, setRole] = useState<string | null>(null);
  const [entries, setEntries] = useState<SyncStatusEntry[]>([]);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [i18nTick, setI18nTick] = useState(0);

  useEffect(() => {
    const onLang = () => setI18nTick((n) => n + 1);
    i18n.on("languageChanged", onLang);
    return () => {
      i18n.off("languageChanged", onLang);
    };
  }, []);

  const load = useCallback(() => {
    getSyncStatus()
      .then((list) => {
        setEntries(list);
        setSyncError(null);
      })
      .catch((e) => {
        setEntries([]);
        setSyncError(String(e));
      })
      .finally(() => {
        setLastRefreshAt(Date.now());
      });
  }, []);

  useEffect(() => {
    getConfig("role").then(setRole);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, SYNC_STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    load();
  }, [syncDataVersion, load]);

  const derived = useMemo(() => {
    const total = entries.length;
    const connected = entries.filter((e) => e.connected).length;
    const notConfigured = computeNotConfigured(syncError);
    const isConnected = !syncError && total > 0 && connected > 0;
    const statusText = computeStatusText({ syncError, notConfigured, total, connected });
    return { total, connected, notConfigured, isConnected, statusText };
  }, [entries, syncError, i18nTick]);

  const value: SyncStatusState = useMemo(
    () => ({
      role,
      entries,
      total: derived.total,
      connected: derived.connected,
      syncError,
      notConfigured: derived.notConfigured,
      isConnected: derived.isConnected,
      statusText: derived.statusText,
      lastRefreshAt,
      pollMs: SYNC_STATUS_POLL_MS,
      refresh: load,
    }),
    [role, entries, derived, syncError, lastRefreshAt, load]
  );

  return <SyncStatusContext.Provider value={value}>{children}</SyncStatusContext.Provider>;
}

export function useSyncStatus() {
  const ctx = useContext(SyncStatusContext);
  if (!ctx) throw new Error("useSyncStatus must be used within SyncStatusProvider");
  return ctx;
}

