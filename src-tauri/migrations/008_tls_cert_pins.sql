-- TLS TOFU/Pinning: Zertifikat-Fingerprints persistieren

-- Join-Anfragen speichern den Fingerprint der anfragenden Kasse (TOFU-Quelle für Master).
ALTER TABLE join_requests ADD COLUMN cert_fingerprint TEXT;

-- Pins pro Peer-Kasse (Fingerprint der Peer-Server-Identity).
CREATE TABLE IF NOT EXISTS kassen_cert_pins (
  peer_kassen_id TEXT PRIMARY KEY,
  pinned_fingerprint TEXT NOT NULL,
  pinned_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('008_tls_cert_pins');

