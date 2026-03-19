use app_lib::{db, sync};
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::env;
use std::net::TcpListener;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tempfile::TempDir;
use tokio::task::JoinHandle;
use tokio::net::TcpStream;
use tokio_native_tls::TlsConnector;
use url::Url;
use uuid::Uuid;

fn env_lock() -> &'static Mutex<()> {
    static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    ENV_LOCK.get_or_init(|| Mutex::new(()))
}

pub struct TestNode {
    pub name: String,
    pub temp_dir: TempDir,
    pub app: tauri::App<tauri::Wry>,
    pub handle: AppHandle,
    pub kassen_id: String,
    pub lauf_id: String,
    pub ws_port: u16,
    pub ws_url: String,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Counts {
    pub kundenabrechnung: i64,
    pub buchungen: i64,
    pub stornos: i64,
}

#[derive(Debug, Clone)]
pub struct Snapshot {
    pub counts: Counts,
    pub max_sequence_per_kasse: HashMap<String, i64>,
    pub max_storno_ts_per_kasse: HashMap<String, Option<String>>,
}

pub fn pick_free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind random local port");
    listener.local_addr().expect("local addr").port()
}

async fn read_server_fingerprint(ws_url: &str) -> String {
    let parsed = Url::parse(ws_url).expect("parse ws url");
    let host = parsed.host_str().expect("ws url host");
    let port = parsed.port_or_known_default().expect("ws url port");
    let addr = format!("{host}:{port}");
    let tcp = TcpStream::connect(&addr).await.expect("connect ws tcp");
    let connector = native_tls::TlsConnector::builder()
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .build()
        .expect("build tls connector");
    let connector = TlsConnector::from(connector);
    let tls = connector.connect(host, tcp).await.expect("tls connect");
    let cert_der = tls
        .get_ref()
        .peer_certificate()
        .expect("peer certificate query")
        .expect("peer certificate")
        .to_der()
        .expect("certificate der");
    let mut hasher = Sha256::new();
    hasher.update(cert_der);
    hex::encode(hasher.finalize())
}

pub async fn spawn_node(name: &str, abrechnungslauf_id: &str) -> TestNode {
    let temp_dir = TempDir::new().expect("temp dir for test node");
    let dir_str = temp_dir.path().to_string_lossy().to_string();
    let (app, handle) = {
        // Nach Panic im kritischen Abschnitt kann std::Mutex vergiftet sein — trotzdem weiterkommen.
        let _guard = env_lock()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        env::set_var("KASSEN_TEST_DB_DIR", &dir_str);
        let (app, handle) = app_lib::build_test_app();
        db::init_db(&handle).expect("init test db");
        (app, handle)
    };

    let kassen_id = Uuid::new_v4().to_string();
    db::set_config(&handle, "kassen_id", &kassen_id).expect("set kassen_id");

    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.fZ")
        .to_string();
    let path = db::db_path(&handle).expect("db_path");
    let conn = Connection::open(&path).expect("open db");
    conn.execute(
        "INSERT INTO kassen (id, name, person1_name, person2_name, is_master) VALUES (?1, ?2, 'P1', 'P2', 0)",
        rusqlite::params![&kassen_id, name],
    )
    .expect("insert test kasse");
    conn.execute(
        "INSERT OR REPLACE INTO abrechnungslauf (id, name, start_zeitpunkt, end_zeitpunkt, is_aktiv) VALUES (?1, ?2, ?3, NULL, 1)",
        rusqlite::params![abrechnungslauf_id, format!("Lauf-{name}"), now],
    )
    .expect("insert active abrechnungslauf");

    let ws_port = pick_free_port();
    let _approve_tx = sync::server::start_ws_server(handle.clone(), ws_port)
        .await
        .expect("start ws server");
    let ws_url = format!("wss://localhost:{ws_port}");
    let fingerprint = read_server_fingerprint(&ws_url).await;

    TestNode {
        name: name.to_string(),
        temp_dir,
        app,
        handle,
        kassen_id,
        lauf_id: abrechnungslauf_id.to_string(),
        ws_port,
        ws_url,
        fingerprint,
    }
}

pub fn pin_peer(source: &TestNode, target: &TestNode) {
    db::set_cert_pin(&source.handle, &target.kassen_id, &target.fingerprint)
        .expect("set cert pin");
}

/// Jede Kasse in der DB hat nur die eigene `kassen`-Zeile; replizierte `kundenabrechnung` verweisen aber
/// auf fremde `kassen_id`. Ohne Stub-Zeilen schlägt `apply_batch` bei aktivem FK fehl → Sync bricht ab
/// (Konvergenz-Timeout). Produktiv entstehen die Zeilen über Join/Netzwerk.
pub fn seed_peer_kassen_stubs(nodes: &[&TestNode]) {
    for host in nodes {
        let path = db::db_path(&host.handle).expect("db_path");
        let conn = Connection::open(&path).expect("open db for peer kassen seed");
        for peer in nodes {
            if peer.kassen_id == host.kassen_id {
                continue;
            }
            conn.execute(
                "INSERT OR IGNORE INTO kassen (id, name, person1_name, person2_name, is_master) VALUES (?1, ?2, 'P1', 'P2', 0)",
                rusqlite::params![&peer.kassen_id, format!("stub-{}", peer.name)],
            )
            .expect("seed peer kasse stub");
        }
    }
}

pub fn start_sync_edge(from: &TestNode, to: &TestNode) -> JoinHandle<()> {
    let app = from.handle.clone();
    let url = to.ws_url.clone();
    let peer_kassen_id = to.kassen_id.clone();
    tokio::spawn(async move {
        let _ = sync::client::run_sync_to_peer(app, &url, &peer_kassen_id).await;
    })
}

pub fn start_ring_sync(a: &TestNode, b: &TestNode, c: &TestNode) -> Vec<JoinHandle<()>> {
    vec![
        start_sync_edge(a, b),
        start_sync_edge(b, c),
        start_sync_edge(c, a),
    ]
}

pub fn insert_kundenabrechnung_with_one_buchung(
    node: &TestNode,
    bezeichnung: &str,
    betrag: f64,
) -> (String, String, i64) {
    let ka_id = Uuid::new_v4().to_string();
    let buchung_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.fZ")
        .to_string();

    let path = db::db_path(&node.handle).expect("db_path");
    let conn = Connection::open(&path).expect("open db");
    let sequence: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sequence), 0) + 1 FROM kundenabrechnung WHERE kassen_id = ?1",
            rusqlite::params![&node.kassen_id],
            |r| r.get(0),
        )
        .expect("next sequence");

    conn.execute(
        "INSERT INTO kundenabrechnung (id, kassen_id, person1_name, person2_name, zeitstempel, belegnummer, sequence, abrechnungslauf_id) VALUES (?1, ?2, 'A', 'B', ?3, ?4, ?5, ?6)",
        rusqlite::params![&ka_id, &node.kassen_id, &now, format!("BELEG-{sequence}"), sequence, &node.lauf_id],
    )
    .expect("insert kundenabrechnung");
    conn.execute(
        "INSERT INTO buchungen (id, kundenabrechnung_id, haendlernummer, betrag, bezeichnung) VALUES (?1, ?2, 'H1', ?3, ?4)",
        rusqlite::params![&buchung_id, &ka_id, betrag, bezeichnung],
    )
    .expect("insert buchung");

    (ka_id, buchung_id, sequence)
}

pub fn insert_storno(node: &TestNode, buchung_id: &str, kundenabrechnung_id: Option<&str>) -> String {
    let storno_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.fZ")
        .to_string();

    let path = db::db_path(&node.handle).expect("db_path");
    let conn = Connection::open(&path).expect("open db");
    conn.execute(
        "INSERT INTO stornos (id, buchung_id, kassen_id, zeitstempel, kundenabrechnung_id) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![&storno_id, buchung_id, &node.kassen_id, &now, kundenabrechnung_id],
    )
    .expect("insert storno");
    now
}

pub fn snapshot(node: &TestNode) -> Snapshot {
    let path = db::db_path(&node.handle).expect("db_path");
    let conn = Connection::open(&path).expect("open db");

    let kundenabrechnung: i64 = conn
        .query_row("SELECT COUNT(*) FROM kundenabrechnung", [], |r| r.get(0))
        .expect("count kundenabrechnung");
    let buchungen: i64 = conn
        .query_row("SELECT COUNT(*) FROM buchungen", [], |r| r.get(0))
        .expect("count buchungen");
    let stornos: i64 = conn
        .query_row("SELECT COUNT(*) FROM stornos", [], |r| r.get(0))
        .expect("count stornos");

    let mut seq_stmt = conn
        .prepare("SELECT kassen_id, COALESCE(MAX(sequence), 0) FROM kundenabrechnung GROUP BY kassen_id")
        .expect("prepare max sequence map");
    let seq_rows = seq_stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        .expect("query max sequence map");
    let mut max_sequence_per_kasse = HashMap::new();
    for row in seq_rows {
        let (kassen_id, max_seq) = row.expect("row max sequence");
        max_sequence_per_kasse.insert(kassen_id, max_seq);
    }

    let mut storno_stmt = conn
        .prepare("SELECT kassen_id, MAX(zeitstempel) FROM stornos GROUP BY kassen_id")
        .expect("prepare max storno map");
    let storno_rows = storno_stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)))
        .expect("query max storno map");
    let mut max_storno_ts_per_kasse = HashMap::new();
    for row in storno_rows {
        let (kassen_id, ts) = row.expect("row max storno");
        max_storno_ts_per_kasse.insert(kassen_id, ts);
    }

    Snapshot {
        counts: Counts {
            kundenabrechnung,
            buchungen,
            stornos,
        },
        max_sequence_per_kasse,
        max_storno_ts_per_kasse,
    }
}

pub fn assert_no_duplicate_ids(node: &TestNode) {
    let path = db::db_path(&node.handle).expect("db_path");
    let conn = Connection::open(&path).expect("open db");

    for (table, col) in [
        ("kundenabrechnung", "id"),
        ("buchungen", "id"),
        ("stornos", "id"),
    ] {
        let total: i64 = conn
            .query_row(
                &format!("SELECT COUNT(*) FROM {table}"),
                [],
                |r| r.get(0),
            )
            .expect("count rows");
        let distinct: i64 = conn
            .query_row(
                &format!("SELECT COUNT(DISTINCT {col}) FROM {table}"),
                [],
                |r| r.get(0),
            )
            .expect("count distinct rows");
        assert_eq!(
            total, distinct,
            "duplicate IDs in table {table} on node {}",
            node.name
        );
    }
}

pub async fn wait_for_convergence(
    nodes: &[&TestNode],
    expected_counts: Counts,
    expected_max_sequence_per_kasse: &HashMap<String, i64>,
    expected_max_storno_ts_per_kasse: &HashMap<String, Option<String>>,
    timeout: Duration,
    poll_interval: Duration,
) {
    let deadline = Instant::now() + timeout;
    loop {
        let snapshots: Vec<Snapshot> = nodes.iter().map(|n| snapshot(n)).collect();
        let first = snapshots.first().expect("at least one node snapshot");

        let all_same_counts = snapshots.iter().all(|s| s.counts == first.counts);
        let all_same_seq = snapshots
            .iter()
            .all(|s| s.max_sequence_per_kasse == first.max_sequence_per_kasse);
        let all_same_storno = snapshots
            .iter()
            .all(|s| s.max_storno_ts_per_kasse == first.max_storno_ts_per_kasse);
        let matches_expected = first.counts == expected_counts
            && first.max_sequence_per_kasse == *expected_max_sequence_per_kasse
            && first.max_storno_ts_per_kasse == *expected_max_storno_ts_per_kasse;

        if all_same_counts && all_same_seq && all_same_storno && matches_expected {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "convergence timeout. snapshots: {:?}",
            snapshots
                .iter()
                .map(|s| (&s.counts, &s.max_sequence_per_kasse, &s.max_storno_ts_per_kasse))
                .collect::<Vec<_>>()
        );
        tokio::time::sleep(poll_interval).await;
    }
}
