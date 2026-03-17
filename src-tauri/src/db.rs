//! Datenbank-Initialisierung und Migrationen

use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const DB_FILENAME: &str = "kassensystem.db";
const ENV_INSTANCE: &str = "KASSEN_INSTANCE";

/// Umgebungsvariable für Integrationstests: falls gesetzt, wird dieses Verzeichnis als DB-Basis genutzt.
const ENV_TEST_DB_DIR: &str = "KASSEN_TEST_DB_DIR";

/// Gibt den Pfad zur SQLite-Datenbank im App-Datenverzeichnis zurück.
/// Mit Umgebungsvariable KASSEN_INSTANCE (z. B. "master", "slave") wird ein Unterordner genutzt,
/// sodass zwei Kassen lokal parallel laufen können.
/// In Tests kann KASSEN_TEST_DB_DIR gesetzt werden, um ein temporäres Verzeichnis zu nutzen.
pub fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base = if let Ok(test_dir) = std::env::var(ENV_TEST_DB_DIR) {
        PathBuf::from(test_dir)
    } else {
        app.path()
            .app_data_dir()
            .map_err(|e: tauri::Error| e.to_string())?
    };
    let dir = match std::env::var(ENV_INSTANCE) {
        Ok(instance) if !instance.trim().is_empty() => {
            let sub = base.join(instance.trim());
            fs::create_dir_all(&sub).map_err(|e| e.to_string())?;
            sub
        }
        _ => base,
    };
    Ok(dir.join(DB_FILENAME))
}

/// Führt alle ausstehenden Migrationen aus und gibt den DB-Pfad zurück.
pub fn init_db(app: &AppHandle) -> Result<String, String> {
    let path = db_path(app)?;
    let path_str = path.to_string_lossy().to_string();

    let conn = Connection::open(&path).map_err(|e| e.to_string())?;

    // Prüfen ob schema_migrations existiert (erste Migration)
    let has_migrations: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    if !has_migrations {
        run_migration_001(&conn)?;
    } else {
        let applied: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version='001_initial'",
                [],
                |row| Ok(row.get::<_, i32>(0)? == 1),
            )
            .map_err(|e| e.to_string())?;
        if !applied {
            run_migration_001(&conn)?;
        }
    }

    // Phase 2: ws_url auf kassen und join_requests
    let applied_002: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version='002_phase2_ws_join'",
            [],
            |row| Ok(row.get::<_, i32>(0)? == 1),
        )
        .map_err(|e| e.to_string())?;
    if !applied_002 {
        run_migration_002(&conn)?;
    }

    // Phase 4: Stornos
    let applied_003: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version='003_phase4_stornos'",
            [],
            |row| Ok(row.get::<_, i32>(0)? == 1),
        )
        .map_err(|e| e.to_string())?;
    if !applied_003 {
        run_migration_003(&conn)?;
    }

    // Phase 4: Storno-Sync (last_sent_storno_zeitstempel in sync_state)
    let applied_004: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version='004_storno_sync'",
            [],
            |row| Ok(row.get::<_, i32>(0)? == 1),
        )
        .map_err(|e| e.to_string())?;
    if !applied_004 {
        run_migration_004(&conn)?;
    }

    // Händler: zusätzliche Felder (Vorname, Nachname, Adresse)
    let applied_005: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version='005_haendler_felder'",
            [],
            |row| Ok(row.get::<_, i32>(0)? == 1),
        )
        .map_err(|e| e.to_string())?;
    if !applied_005 {
        run_migration_005(&conn)?;
    }

    // Abrechnungsläufe (Events, systemweit)
    let applied_006: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version='006_abrechnungslauf'",
            [],
            |row| Ok(row.get::<_, i32>(0)? == 1),
        )
        .map_err(|e| e.to_string())?;
    if !applied_006 {
        run_migration_006(&conn)?;
    }

    Ok(path_str)
}

fn run_migration_001(conn: &Connection) -> Result<(), String> {
    let sql = include_str!("../migrations/001_initial.sql");
    conn.execute_batch(sql).map_err(|e| e.to_string())?;
    Ok(())
}

fn run_migration_002(conn: &Connection) -> Result<(), String> {
    let sql = include_str!("../migrations/002_phase2_ws_join.sql");
    conn.execute_batch(sql).map_err(|e| e.to_string())?;
    Ok(())
}

fn run_migration_003(conn: &Connection) -> Result<(), String> {
    let sql = include_str!("../migrations/003_phase4_stornos.sql");
    conn.execute_batch(sql).map_err(|e| e.to_string())?;
    Ok(())
}

fn run_migration_004(conn: &Connection) -> Result<(), String> {
    let sql = include_str!("../migrations/004_storno_sync.sql");
    conn.execute_batch(sql).map_err(|e| e.to_string())?;
    Ok(())
}

fn run_migration_005(conn: &Connection) -> Result<(), String> {
    let sql = include_str!("../migrations/005_haendler_felder.sql");
    conn.execute_batch(sql).map_err(|e| e.to_string())?;
    Ok(())
}

fn run_migration_006(conn: &Connection) -> Result<(), String> {
    let sql = include_str!("../migrations/006_abrechnungslauf.sql");
    conn.execute_batch(sql).map_err(|e| e.to_string())?;
    Ok(())
}

/// Config-Wert lesen (für Rust/Backend).
pub fn get_config(app: &AppHandle, key: &str) -> Result<Option<String>, String> {
    let path = db_path(app)?;
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT value FROM config WHERE key = ?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query(rusqlite::params![key])
        .map_err(|e| e.to_string())?;
    let row = rows.next().map_err(|e| e.to_string())?;
    Ok(row.and_then(|r| r.get(0).ok()))
}

/// Config-Wert schreiben (für Rust/Backend).
pub fn set_config(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
    let path = db_path(app)?;
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO config (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
