import { createContext, useContext, useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

const SyncDataContext = createContext<{ syncDataVersion: number }>({ syncDataVersion: 0 });

export function SyncDataProvider({ children }: { children: React.ReactNode }) {
  const [syncDataVersion, setSyncDataVersion] = useState(0);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen("sync-data-changed", () => {
      setSyncDataVersion((v) => v + 1);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  return (
    <SyncDataContext.Provider value={{ syncDataVersion }}>
      {children}
    </SyncDataContext.Provider>
  );
}

export function useSyncData() {
  return useContext(SyncDataContext);
}
