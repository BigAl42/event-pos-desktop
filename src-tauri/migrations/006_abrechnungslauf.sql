-- Abrechnungsläufe (Events) systemweit

CREATE TABLE IF NOT EXISTS abrechnungslauf (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_zeitpunkt TEXT NOT NULL,
  end_zeitpunkt TEXT,
  is_aktiv INTEGER NOT NULL DEFAULT 0
);

-- Default-Lauf für bestehende Installationen anlegen (falls noch keiner existiert)
INSERT OR IGNORE INTO abrechnungslauf (id, name, start_zeitpunkt, end_zeitpunkt, is_aktiv)
VALUES ('initial', 'Initialer Lauf', datetime('now'), NULL, 1);

-- Kundenabrechnungen logisch an einen Abrechnungslauf koppeln
ALTER TABLE kundenabrechnung ADD COLUMN abrechnungslauf_id TEXT;

-- Bestehende Kundenabrechnungen dem Default-Lauf zuordnen
UPDATE kundenabrechnung
SET abrechnungslauf_id = 'initial'
WHERE abrechnungslauf_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_kundenabrechnung_lauf ON kundenabrechnung(abrechnungslauf_id);

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('006_abrechnungslauf');

