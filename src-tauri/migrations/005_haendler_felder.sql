-- Händler: zusätzliche Stammdaten (Vorname, Nachname, Adresse)
ALTER TABLE haendler ADD COLUMN vorname TEXT;
ALTER TABLE haendler ADD COLUMN nachname TEXT;
ALTER TABLE haendler ADD COLUMN strasse TEXT;
ALTER TABLE haendler ADD COLUMN hausnummer TEXT;
ALTER TABLE haendler ADD COLUMN plz TEXT;
ALTER TABLE haendler ADD COLUMN stadt TEXT;

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('005_haendler_felder');
