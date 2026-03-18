-- Händler: optionale eMail-Adresse
ALTER TABLE haendler ADD COLUMN email TEXT;

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('007_haendler_email');

