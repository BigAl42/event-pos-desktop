//! N=3 Ring-Sync Integrationtests.
//!
//! **Tokio:** `flavor = "multi_thread"` — `tauri-plugin-sql` verlangt einen Multi-Thread-Runtime
//! („can call blocking only when running on the multi-threaded runtime“).
//! Tao/Wry ist dafür über `Builder::any_thread()` unter `feature = "test"` (Linux/Windows) abgesichert.
//!
//! **Nur Windows:** Der Test wird mit `#[cfg(target_os = "windows")]` gebaut — unter Linux/macOS
//! startet kein Tauri/GTK (headless CI, `org.gtk.Application`-Konflikte). Lokal auf Windows:
//! `cd src-tauri && cargo test --features test --test sync_ring_n3`

#[cfg(target_os = "windows")]
mod common;

#[cfg(target_os = "windows")]
mod sync_ring_n3_impl {
    use super::common::cluster::{
        assert_no_duplicate_ids, insert_kundenabrechnung_with_one_buchung, insert_storno, pin_peer,
        seed_peer_kassen_stubs, snapshot, spawn_node, start_ring_sync, start_sync_edge,
        wait_for_convergence, Counts,
    };
    use std::collections::HashMap;
    use std::time::Duration;
    use tokio::task::JoinHandle;
    use uuid::Uuid;

    fn abort_all(handles: &mut Vec<JoinHandle<()>>) {
        for handle in handles.drain(..) {
            handle.abort();
        }
    }

    /// Beide Szenarien in **einem** libtest-Eintrag: verhindert parallelen Start durch den Test-Harness
    /// (zwei `#[tokio::test]` laufen sonst gleichzeitig → GTK/GLib „main context already acquired“).
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn sync_ring_n3_both_scenarios_sequential() {
        run_ring_n3_eventually_converges_and_keeps_stornos().await;
        run_ring_recovers_after_edge_down_and_rejoin().await;
    }

    async fn run_ring_n3_eventually_converges_and_keeps_stornos() {
        let lauf_id = Uuid::new_v4().to_string();
        let a = spawn_node("A", &lauf_id).await;
        let b = spawn_node("B", &lauf_id).await;
        let c = spawn_node("C", &lauf_id).await;

        seed_peer_kassen_stubs(&[&a, &b, &c]);

        pin_peer(&a, &b);
        pin_peer(&b, &c);
        pin_peer(&c, &a);

        let mut handles = start_ring_sync(&a, &b, &c);

        let (_a_ka1, a_b1, _a_seq1) = insert_kundenabrechnung_with_one_buchung(&a, "A-1", 10.0);
        let (_a_ka2, _a_b2, a_seq2) = insert_kundenabrechnung_with_one_buchung(&a, "A-2", 11.0);
        let (_b_ka1, _b_b1, b_seq1) = insert_kundenabrechnung_with_one_buchung(&b, "B-1", 12.0);
        let (c_ka1, c_b1, c_seq1) = insert_kundenabrechnung_with_one_buchung(&c, "C-1", 13.0);
        let c_storno_ts = insert_storno(&c, &c_b1, Some(&c_ka1));
        let a_storno_ts = insert_storno(&a, &a_b1, None);

        let expected_counts = Counts {
            kundenabrechnung: 4,
            buchungen: 4,
            stornos: 2,
        };
        let expected_max_sequence_per_kasse = HashMap::from([
            (a.kassen_id.clone(), a_seq2),
            (b.kassen_id.clone(), b_seq1),
            (c.kassen_id.clone(), c_seq1),
        ]);
        let expected_max_storno_ts_per_kasse = HashMap::from([
            (a.kassen_id.clone(), Some(a_storno_ts)),
            (c.kassen_id.clone(), Some(c_storno_ts)),
        ]);

        wait_for_convergence(
            &[&a, &b, &c],
            expected_counts,
            &expected_max_sequence_per_kasse,
            &expected_max_storno_ts_per_kasse,
            Duration::from_secs(25),
            Duration::from_millis(300),
        )
        .await;

        assert_no_duplicate_ids(&a);
        assert_no_duplicate_ids(&b);
        assert_no_duplicate_ids(&c);

        abort_all(&mut handles);
    }

    async fn run_ring_recovers_after_edge_down_and_rejoin() {
        let lauf_id = Uuid::new_v4().to_string();
        let a = spawn_node("A", &lauf_id).await;
        let b = spawn_node("B", &lauf_id).await;
        let c = spawn_node("C", &lauf_id).await;

        seed_peer_kassen_stubs(&[&a, &b, &c]);

        pin_peer(&a, &b);
        pin_peer(&b, &c);
        pin_peer(&c, &a);

        let ab = start_sync_edge(&a, &b);
        let bc = start_sync_edge(&b, &c);
        let mut ca = start_sync_edge(&c, &a);

        let (_a_ka1, _a_b1, a_seq1) = insert_kundenabrechnung_with_one_buchung(&a, "A-1", 10.0);
        let (_b_ka1, _b_b1, b_seq1) = insert_kundenabrechnung_with_one_buchung(&b, "B-1", 11.0);
        wait_for_convergence(
            &[&a, &b, &c],
            Counts {
                kundenabrechnung: 2,
                buchungen: 2,
                stornos: 0,
            },
            &HashMap::from([
                (a.kassen_id.clone(), a_seq1),
                (b.kassen_id.clone(), b_seq1),
            ]),
            &HashMap::new(),
            Duration::from_secs(25),
            Duration::from_millis(300),
        )
        .await;

        ca.abort();
        tokio::time::sleep(Duration::from_millis(500)).await;

        let (_c_ka1, c_b1, c_seq1) = insert_kundenabrechnung_with_one_buchung(&c, "C-offline", 14.0);
        let c_storno_ts = insert_storno(&c, &c_b1, None);

        tokio::time::sleep(Duration::from_secs(2)).await;
        let a_mid = snapshot(&a);
        assert!(
            !a_mid.max_sequence_per_kasse.contains_key(&c.kassen_id),
            "A should not have C sequence while C->A edge is down"
        );

        ca = start_sync_edge(&c, &a);

        let expected_seq = HashMap::from([
            (a.kassen_id.clone(), a_seq1),
            (b.kassen_id.clone(), b_seq1),
            (c.kassen_id.clone(), c_seq1),
        ]);
        let expected_storno = HashMap::from([(c.kassen_id.clone(), Some(c_storno_ts))]);
        wait_for_convergence(
            &[&a, &b, &c],
            Counts {
                kundenabrechnung: 3,
                buchungen: 3,
                stornos: 1,
            },
            &expected_seq,
            &expected_storno,
            Duration::from_secs(25),
            Duration::from_millis(300),
        )
        .await;

        assert_no_duplicate_ids(&a);
        assert_no_duplicate_ids(&b);
        assert_no_duplicate_ids(&c);

        let mut handles = vec![ab, bc, ca];
        abort_all(&mut handles);
    }
}
