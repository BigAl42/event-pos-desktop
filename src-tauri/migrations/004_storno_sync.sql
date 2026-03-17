-- Phase 4: Storno-Sync: Welche Stornos haben wir dem Peer schon geschickt?
ALTER TABLE sync_state ADD COLUMN last_sent_storno_zeitstempel TEXT;

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('004_storno_sync');
