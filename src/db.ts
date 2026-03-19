import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (db) return db;
  try {
    const path = await invoke<string>("init_db");
    db = await Database.load(`sqlite:${path}`);
    return db;
  } catch (e) {
    throw new Error(
      `Datenbank konnte nicht initialisiert werden (init_db/Database.load fehlgeschlagen): ${String(e)}`
    );
  }
}

export type Kasse = {
  id: string;
  name: string;
  person1_name: string | null;
  person2_name: string | null;
  is_master: number;
  created_at: string;
};

export type Kundenabrechnung = {
  id: string;
  kassen_id: string;
  person1_name: string | null;
  person2_name: string | null;
  zeitstempel: string;
  belegnummer: string | null;
  sequence: number;
};

export type Buchung = {
  id: string;
  kundenabrechnung_id: string;
  haendlernummer: string;
  betrag: number;
  bezeichnung: string | null;
};

export type AbrechnungZeile = {
  haendlernummer: string;
  summe: number;
  anzahl: number;
};

export type Abrechnungslauf = {
  id: string;
  name: string;
  start_zeitpunkt: string;
  end_zeitpunkt: string | null;
  is_aktiv: boolean;
};

export type HaendlerAbrechnungPdfData = {
  haendler: {
    haendlernummer: string;
    name: string;
    vorname: string | null;
    nachname: string | null;
    strasse: string | null;
    hausnummer: string | null;
    plz: string | null;
    stadt: string | null;
    email: string | null;
  };
  lauf: {
    id: string;
    name: string;
    start_zeitpunkt: string;
    end_zeitpunkt: string | null;
  };
  werte: {
    summe: number;
    anzahl: number;
  };
};

// ---------- Notfallmodus: Export/Import ----------

export type NotfallExportMeta = {
  exported_lauf_id: string;
  exported_lauf_name: string;
  exported_lauf_start_zeitpunkt: string;
  exported_lauf_end_zeitpunkt: string | null;
  export_at: string;
  exporting_kasse_id: string | null;
  exporting_kasse_name: string | null;
};

export type NotfallKasseRow = {
  id: string;
  name: string;
  is_master: number;
  ws_url: string | null;
};

export type NotfallKundenabrechnungRow = {
  id: string;
  kassen_id: string;
  person1_name: string | null;
  person2_name: string | null;
  zeitstempel: string;
  belegnummer: string | null;
  sequence: number;
  abrechnungslauf_id: string | null;
};

export type NotfallBuchungRow = {
  id: string;
  kundenabrechnung_id: string;
  haendlernummer: string;
  betrag: number;
  bezeichnung: string | null;
};

export type NotfallStornoRow = {
  id: string;
  buchung_id: string;
  kassen_id: string;
  zeitstempel: string;
  kundenabrechnung_id: string | null;
};

export type NotfallExportDto = {
  meta: NotfallExportMeta;
  kassen: NotfallKasseRow[];
  kundenabrechnungen: NotfallKundenabrechnungRow[];
  buchungen: NotfallBuchungRow[];
  stornos: NotfallStornoRow[];
};

export type NotfallImportSummary = {
  inserted_kassen: number;
  ignored_kassen: number;
  inserted_kundenabrechnungen: number;
  ignored_kundenabrechnungen: number;
  inserted_buchungen: number;
  ignored_buchungen: number;
  inserted_stornos: number;
  ignored_stornos: number;
};

export async function getConfig(key: string): Promise<string | null> {
  const database = await getDb();
  const rows = (await database.select(
    "SELECT value FROM config WHERE key = $1",
    [key]
  )) as { value: string | null }[];
  return rows[0]?.value ?? null;
}

/** Gibt true zurück, wenn die Kasse mit einer Hauptkasse abgestimmt ist (Master-Setup oder erfolgreicher Join). */
export async function isInitializedFromMaster(): Promise<boolean> {
  const v = await getConfig("initialized_from_master");
  if (v === "true") return true;
  if (v === "false") return false;

  // Master-Kassen gelten immer als "abgestimmt".
  const role = await getConfig("role");
  if (role === "master") {
    await setConfig("initialized_from_master", "true");
    return true;
  }

  // Backwards-Compatibility: ältere Installationen hatten das Flag nicht.
  // Wenn diese Kasse als Nebenkasse konfiguriert ist und eine Hauptkassen-URL gesetzt ist,
  // behandeln wir sie als abgestimmt und setzen das Flag einmalig.
  const masterUrl = await getConfig("master_ws_url");
  if (role === "slave" && masterUrl) {
    await setConfig("initialized_from_master", "true");
    return true;
  }
  return false;
}

export async function setConfig(key: string, value: string): Promise<void> {
  const database = await getDb();
  await database.execute("INSERT OR REPLACE INTO config (key, value) VALUES ($1, $2)", [
    key,
    value,
  ]);
}

export async function getCurrentKasse(): Promise<Kasse | null> {
  const database = await getDb();
  const kassenId = await getConfig("kassen_id");
  if (!kassenId) return null;
  const rows = (await database.select("SELECT * FROM kassen WHERE id = $1", [kassenId])) as Kasse[];
  return rows[0] ?? null;
}

function uuid(): string {
  return crypto.randomUUID();
}

export async function setupMaster(
  name: string,
  person1: string,
  person2: string
): Promise<void> {
  const database = await getDb();
  const id = uuid();
  await database.execute(
    "INSERT INTO kassen (id, name, person1_name, person2_name, is_master) VALUES ($1, $2, $3, $4, 1)",
    [id, name, person1 || null, person2 || null]
  );
  await setConfig("role", "master");
  await setConfig("kassen_id", id);
  await setConfig("kassenname", name);
  await setConfig("beleg_prefix", (await getConfig("beleg_prefix")) || "BELEG");
  await setConfig("initialized_from_master", "true");
}

export async function setupSlave(
  name: string,
  person1: string,
  person2: string
): Promise<void> {
  const database = await getDb();
  const id = uuid();
  await database.execute(
    "INSERT INTO kassen (id, name, person1_name, person2_name, is_master) VALUES ($1, $2, $3, $4, 0)",
    [id, name, person1 || null, person2 || null]
  );
  await setConfig("role", "slave");
  await setConfig("kassen_id", id);
  await setConfig("kassenname", name);
  await setConfig("beleg_prefix", (await getConfig("beleg_prefix")) || "BELEG");
}

export async function updateKassenPersonen(
  kassenId: string,
  person1: string,
  person2: string
): Promise<void> {
  const database = await getDb();
  await database.execute(
    "UPDATE kassen SET person1_name = $1, person2_name = $2 WHERE id = $3",
    [person1 || null, person2 || null, kassenId]
  );
}

async function nextBelegnummer(kassenId: string): Promise<string> {
  const prefix = (await getConfig("beleg_prefix")) || "BELEG";
  const year = new Date().getFullYear();
  const key = `beleg_counter_${kassenId}_${year}`;
  const database = await getDb();
  const rows = (await database.select("SELECT value FROM config WHERE key = $1", [key])) as {
    value: string;
  }[];
  const next = (rows[0] ? parseInt(rows[0].value, 10) + 1 : 1).toString().padStart(3, "0");
  await database.execute(
    "INSERT OR REPLACE INTO config (key, value) VALUES ($1, $2)",
    [key, String(parseInt(next, 10))]
  );
  return `${prefix}-${year}-${next}`;
}

async function nextSequence(kassenId: string): Promise<number> {
  const database = await getDb();
  const rows = (await database.select(
    "SELECT MAX(sequence) as max_seq FROM kundenabrechnung WHERE kassen_id = $1",
    [kassenId]
  )) as { max_seq: number | null }[];
  const next = (rows[0]?.max_seq ?? 0) + 1;
  return next;
}

export async function getAktivenAbrechnungslaufId(): Promise<string> {
  const laufe = await getAbrechnungsläufe();
  const aktiv = laufe.find((l) => l.is_aktiv);
  if (!aktiv) {
    throw new Error("Kein aktiver Abrechnungslauf vorhanden.");
  }
  return aktiv.id;
}

export async function getNotfallExportData(
  abrechnungslaufId: string
): Promise<NotfallExportDto> {
  const dto = await invoke<NotfallExportDto>("get_notfall_export_data", {
    abrechnungslaufId,
  });
  return {
    ...dto,
    buchungen: dto.buchungen.map((b) => ({ ...b, betrag: Number(b.betrag) })),
  };
}

export async function importNotfallData(params: {
  payload: NotfallExportDto;
  targetAbrechnungslaufId: string;
  allowMismatch: boolean;
}): Promise<NotfallImportSummary> {
  return invoke<NotfallImportSummary>("import_notfall_data", {
    payload: params.payload,
    targetAbrechnungslaufId: params.targetAbrechnungslaufId,
    allowMismatch: params.allowMismatch,
  });
}

export async function createKundenabrechnung(
  kassenId: string,
  person1: string,
  person2: string,
  positionen: { haendlernummer: string; betrag: number; bezeichnung?: string }[]
): Promise<string> {
  const database = await getDb();
  const id = uuid();
  const belegnummer = await nextBelegnummer(kassenId);
  const sequence = await nextSequence(kassenId);
  const zeitstempel = new Date().toISOString();
   const abrechnungslaufId = await getAktivenAbrechnungslaufId();

  await database.execute(
    `INSERT INTO kundenabrechnung (id, kassen_id, person1_name, person2_name, zeitstempel, belegnummer, sequence, abrechnungslauf_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, kassenId, person1 || null, person2 || null, zeitstempel, belegnummer, sequence, abrechnungslaufId]
  );

  for (const p of positionen) {
    const posId = crypto.randomUUID();
    await database.execute(
      `INSERT INTO buchungen (id, kundenabrechnung_id, haendlernummer, betrag, bezeichnung)
       VALUES ($1, $2, $3, $4, $5)`,
      [posId, id, p.haendlernummer, p.betrag, p.bezeichnung || null]
    );
  }

  return belegnummer;
}

export async function getAbrechnung(): Promise<AbrechnungZeile[]> {
  const rows = await invoke<AbrechnungZeile[]>("get_haendler_umsatz");
  return rows.map((r) => ({
    haendlernummer: r.haendlernummer,
    summe: Number(r.summe),
    anzahl: Number(r.anzahl),
  }));
}

export async function hasKasse(): Promise<boolean> {
  const kassenId = await getConfig("kassen_id");
  return !!kassenId;
}

// ---------- Phase 2: Händler (invoke Rust) ----------

export type HaendlerItem = {
  haendlernummer: string;
  name: string;
  sort: number | null;
  vorname?: string | null;
  nachname?: string | null;
  strasse?: string | null;
  hausnummer?: string | null;
  plz?: string | null;
  stadt?: string | null;
  email?: string | null;
};

export type CreateHaendlerParams = {
  haendlernummer: string;
  name: string;
  sort?: number | null;
  vorname?: string | null;
  nachname?: string | null;
  strasse?: string | null;
  hausnummer?: string | null;
  plz?: string | null;
  stadt?: string | null;
  email?: string | null;
};

export async function getHaendlerList(): Promise<HaendlerItem[]> {
  return invoke<HaendlerItem[]>("get_haendler_list");
}

export async function createHaendler(params: CreateHaendlerParams): Promise<void> {
  await invoke("create_haendler", {
    haendlernummer: params.haendlernummer,
    name: params.name,
    sort: params.sort ?? null,
    vorname: params.vorname ?? null,
    nachname: params.nachname ?? null,
    strasse: params.strasse ?? null,
    hausnummer: params.hausnummer ?? null,
    plz: params.plz ?? null,
    stadt: params.stadt ?? null,
    email: params.email ?? null,
  });
}

export async function updateHaendler(
  haendlernummer: string,
  params: Omit<CreateHaendlerParams, "haendlernummer">
): Promise<void> {
  await invoke("update_haendler", {
    haendlernummer,
    name: params.name,
    sort: params.sort ?? null,
    vorname: params.vorname ?? null,
    nachname: params.nachname ?? null,
    strasse: params.strasse ?? null,
    hausnummer: params.hausnummer ?? null,
    plz: params.plz ?? null,
    stadt: params.stadt ?? null,
    email: params.email ?? null,
  });
}

export async function deleteHaendler(haendlernummer: string): Promise<void> {
  await invoke("delete_haendler", { haendlernummer });
}

// ---------- Phase 2: Join (Master/Slave, invoke Rust) ----------

export async function getJoinToken(): Promise<string | null> {
  return invoke<string | null>("get_join_token");
}

export async function generateJoinToken(): Promise<string> {
  return invoke<string>("generate_join_token");
}

export async function startMasterServer(port: number): Promise<void> {
  await invoke("start_master_server", { port });
}

export async function isMasterServerRunning(): Promise<boolean> {
  return invoke<boolean>("is_master_server_running");
}

export type JoinRequestItem = {
  id: string;
  kassen_id: string;
  name: string;
  my_ws_url: string | null;
  cert_fingerprint: string | null;
  status: string;
  created_at: string;
};

export async function getJoinRequests(): Promise<JoinRequestItem[]> {
  return invoke<JoinRequestItem[]>("get_join_requests");
}

export async function approveJoinRequest(kassenId: string): Promise<void> {
  await invoke("approve_join_request", { kassenId });
}

export async function rejectJoinRequest(kassenId: string): Promise<void> {
  await invoke("reject_join_request", { kassenId });
}

export async function joinNetwork(token: string): Promise<string> {
  return invoke<string>("join_network", { token });
}

// ---------- Discovery (Master im Netzwerk suchen) ----------

export type DiscoveredMaster = {
  name: string;
  host: string;
  port: number;
  ws_url: string;
};

export async function discoverMasters(): Promise<DiscoveredMaster[]> {
  return invoke<DiscoveredMaster[]>("discover_masters");
}

/** Phase 3: Startet lokalen Sync-Server und verbindet zu allen Peers. */
export async function startSyncConnections(): Promise<string> {
  return invoke<string>("start_sync_connections");
}

export type SyncRuntimeStatus = {
  started: boolean;
  connected_peers: number;
  started_at: string | null;
};

export async function getSyncRuntimeStatus(): Promise<SyncRuntimeStatus> {
  return invoke<SyncRuntimeStatus>("get_sync_runtime_status");
}

// ---------- Phase 4: Storno ----------

export type KundenabrechnungListItem = {
  id: string;
  belegnummer: string | null;
  zeitstempel: string;
  kassen_id: string;
  kassen_name: string | null;
  summe: number;
  anzahl_positionen: number;
};

export type BuchungListItem = {
  id: string;
  haendlernummer: string;
  betrag: number;
  bezeichnung: string | null;
  ist_storniert: boolean;
};

export type HaendlerBuchungItem = {
  id: string;
  haendlernummer: string;
  betrag: number;
  bezeichnung: string | null;
  zeitstempel: string;
  kassen_id: string;
  kassen_name: string | null;
  ist_storniert: boolean;
};

export async function getRecentAbrechnungen(limit: number): Promise<KundenabrechnungListItem[]> {
  return invoke<KundenabrechnungListItem[]>("get_recent_abrechnungen", { limit });
}

export async function getBuchungenForAbrechnung(kundenabrechnungId: string): Promise<BuchungListItem[]> {
  return invoke<BuchungListItem[]>("get_buchungen_for_abrechnung", { kundenabrechnungId });
}

export async function getBuchungenForHaendler(haendlernummer: string): Promise<HaendlerBuchungItem[]> {
  return invoke<HaendlerBuchungItem[]>("get_buchungen_for_haendler", { haendlernummer });
}

export async function stornoPosition(buchungId: string): Promise<void> {
  await invoke("storno_position", { buchungId });
}

export async function stornoAbrechnung(kundenabrechnungId: string): Promise<void> {
  await invoke("storno_abrechnung", { kundenabrechnungId });
}

// ---------- Sync-Status ----------

export type SyncStatusEntry = {
  peer_id: string;
  name: string;
  ws_url: string;
  connected: boolean;
  last_sync: string | null;
  closeout_ok_for_lauf_id?: string | null;
  closeout_ok_at?: string | null;
};

export async function getSyncStatus(): Promise<SyncStatusEntry[]> {
  return invoke<SyncStatusEntry[]>("get_sync_status");
}

export async function removePeerFromNetwork(kassenId: string): Promise<void> {
  // #region agent log
  fetch("http://127.0.0.1:7475/ingest/339f8301-dff1-46a5-b3e4-2b85e31fc48f", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "06ad72",
    },
    body: JSON.stringify({
      sessionId: "06ad72",
      runId: "initial",
      hypothesisId: "H2",
      location: "db.ts:removePeerFromNetwork:beforeInvoke",
      message: "Calling tauri command remove_peer_from_network",
      data: { kassenId },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion agent log

  await invoke("remove_peer_from_network", { kassenId });
}

// ---------- Reset Abrechnungslauf ----------

export async function resetAbrechnungslauf(): Promise<string> {
  return invoke<string>("reset_abrechnungslauf");
}

export async function getAbrechnungsläufe(): Promise<Abrechnungslauf[]> {
  return invoke<Abrechnungslauf[]>("get_abrechnungsläufe");
}

export async function getHaendlerAbrechnungPdfData(
  haendlernummer: string,
  abrechnungslaufId: string
): Promise<HaendlerAbrechnungPdfData> {
  const dto = await invoke<HaendlerAbrechnungPdfData>("get_haendler_abrechnung_pdf_data", {
    haendlernummer,
    abrechnungslaufId,
  });
  return {
    ...dto,
    werte: {
      summe: Number(dto.werte.summe),
      anzahl: Number(dto.werte.anzahl),
    },
  };
}

export async function createAbrechnungslauf(name: string, ignorePeers?: string[]): Promise<string> {
  return invoke<string>("create_abrechnungslauf", {
    name,
    ignore_peers: ignorePeers?.length ? ignorePeers : undefined,
  });
}

export async function deleteAbrechnungslauf(id: string): Promise<string> {
  return invoke<string>("delete_abrechnungslauf", { id });
}

/** Nebenkasse: Fordert bei der Hauptkasse einen Reset des lokalen Abrechnungslaufs an (alle lokalen Buchungen werden gelöscht, Lauf = Hauptkasse). */
export async function requestSlaveReset(): Promise<string> {
  return invoke<string>("request_slave_reset");
}

/** Nebenkasse: „Abmelden/Lauf fertig“ – lässt die Hauptkasse bestätigen, dass alle Daten angekommen sind. */
export async function requestCloseout(): Promise<string> {
  return invoke<string>("request_closeout");
}

/** Nebenkasse: Entkoppelt diese Kasse lokal vom Netzwerk (vergisst Master/Peers). */
export async function leaveNetwork(): Promise<string> {
  return invoke<string>("leave_network");
}

/** Löscht alle lokalen Daten dieser Kasse (DB + lokale Artefakte im App-Datenordner) und setzt den Erststart zurück. */
export async function wipeLocalData(): Promise<void> {
  await invoke("wipe_local_data");
  db = null;
}
