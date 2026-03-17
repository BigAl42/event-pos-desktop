-- Phase 4: Stornos (einzelne Position oder ganze Kundenabrechnung)

CREATE TABLE IF NOT EXISTS stornos (
  id TEXT PRIMARY KEY,
  buchung_id TEXT NOT NULL,
  kassen_id TEXT NOT NULL,
  zeitstempel TEXT NOT NULL DEFAULT (datetime('now')),
  kundenabrechnung_id TEXT,
  FOREIGN KEY (buchung_id) REFERENCES buchungen(id),
  FOREIGN KEY (kundenabrechnung_id) REFERENCES kundenabrechnung(id)
);

CREATE INDEX IF NOT EXISTS idx_stornos_buchung ON stornos(buchung_id);
CREATE INDEX IF NOT EXISTS idx_stornos_kundenabrechnung ON stornos(kundenabrechnung_id);

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('003_phase4_stornos');
