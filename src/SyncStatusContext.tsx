import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getConfig, getSyncStatus, type SyncStatusEntry } from "./db";
import { useSyncData } from "./SyncDataContext";

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
  return (
    !!syncError &&
    (syncError.includes("Eigene Sync-URL nicht konfiguriert") ||
      syncError.includes("Hauptkassen-URL nicht konfiguriert"))
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
    return notConfigured ? "Sync nicht konfiguriert – bitte Einstellungen prüfen." : "Sync-Status aktuell nicht abrufbar.";
  }
  if (total === 0) return "Keine weiteren Kassen im Netzwerk.";
  if (connected > 0) return `Verbunden mit ${connected} von ${total} Kassen`;
  return `Nicht verbunden (0 von ${total} Kassen)`;
}

export function SyncStatusProvider({ children }: { children: React.ReactNode }) {
  const { syncDataVersion } = useSyncData();
  const [role, setRole] = useState<string | null>(null);
  const [entries, setEntries] = useState<SyncStatusEntry[]>([]);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);

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
  }, [entries, syncError]);

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

