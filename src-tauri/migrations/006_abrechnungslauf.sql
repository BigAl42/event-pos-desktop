-- Abrechnungsläufe (Events) systemweit

CREATE TABLE IF NOT EXISTS abrechnungslauf (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_zeitpunkt TEXT NOT NULL,
  end_zeitpunkt TEXT,
  is_aktiv INTEGER NOT NULL DEFAULT 0
);

-- Kundenabrechnungen logisch an einen Abrechnungslauf koppeln
ALTER TABLE kundenabrechnung ADD COLUMN abrechnungslauf_id TEXT;

CREATE INDEX IF NOT EXISTS idx_kundenabrechnung_lauf ON kundenabrechnung(abrechnungslauf_id);

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('006_abrechnungslauf');

