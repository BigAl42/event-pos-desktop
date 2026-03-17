-- Schema-Versionierung
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Kassen (Stammdaten)
CREATE TABLE IF NOT EXISTS kassen (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  person1_name TEXT,
  person2_name TEXT,
  is_master INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Händler (Stammdaten, Master pflegt)
CREATE TABLE IF NOT EXISTS haendler (
  haendlernummer TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort INTEGER
);

-- Konfiguration (Key-Value)
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Kundenabrechnung (ein Beleg pro Kunden-Vorgang)
CREATE TABLE IF NOT EXISTS kundenabrechnung (
  id TEXT PRIMARY KEY,
  kassen_id TEXT NOT NULL,
  person1_name TEXT,
  person2_name TEXT,
  zeitstempel TEXT NOT NULL,
  belegnummer TEXT,
  sequence INTEGER NOT NULL,
  FOREIGN KEY (kassen_id) REFERENCES kassen(id)
);

CREATE INDEX IF NOT EXISTS idx_kundenabrechnung_kassen_sequence ON kundenabrechnung(kassen_id, sequence);

-- Buchungen (Positionen pro Kundenabrechnung)
CREATE TABLE IF NOT EXISTS buchungen (
  id TEXT PRIMARY KEY,
  kundenabrechnung_id TEXT NOT NULL,
  haendlernummer TEXT NOT NULL,
  betrag REAL NOT NULL,
  bezeichnung TEXT,
  FOREIGN KEY (kundenabrechnung_id) REFERENCES kundenabrechnung(id)
);

CREATE INDEX IF NOT EXISTS idx_buchungen_haendler ON buchungen(haendlernummer);

-- Sync-Metadaten (für Phase 2+)
CREATE TABLE IF NOT EXISTS sync_state (
  peer_kassen_id TEXT PRIMARY KEY,
  last_sequence INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Join-Anfragen (nur Master, Phase 2+)
CREATE TABLE IF NOT EXISTS join_requests (
  id TEXT PRIMARY KEY,
  kassen_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Erste Migration eintragen
INSERT OR IGNORE INTO schema_migrations (version) VALUES ('001_initial');
