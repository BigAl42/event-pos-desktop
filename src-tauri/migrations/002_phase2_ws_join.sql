-- Phase 2: WebSocket-URLs für Kassen und Join-Anfragen

-- Kassen: ws_url für Peer-Verbindungen (jede Kasse hat eigenen Server)
ALTER TABLE kassen ADD COLUMN ws_url TEXT;

-- Join-Anfragen: URL, unter der die anfragende Kasse erreichbar ist
ALTER TABLE join_requests ADD COLUMN my_ws_url TEXT;

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('002_phase2_ws_join');
