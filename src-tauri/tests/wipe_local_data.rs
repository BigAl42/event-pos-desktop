#[cfg(feature = "test")]
mod wipe_local_data_tests {
    use app_lib::{build_test_app, commands, db};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    #[cfg_attr(
        any(target_os = "macos", target_os = "linux"),
        ignore = "Tauri EventLoop requires dedicated UI thread; run on stable Windows CI or dedicated UI test env"
    )]
    fn wipe_local_data_deletes_instance_dir_contents() {
        let dir = tempdir().expect("tempdir");
        std::env::set_var("KASSEN_TEST_DB_DIR", dir.path());
        std::env::set_var("KASSEN_INSTANCE", "slave");

        let (_app, handle) = build_test_app();

        // Create DB file (and folders) via init_db.
        let _ = db::init_db(&handle).expect("init_db");

        // Create extra artifact files/dirs inside instance dir.
        let inst = db::instance_dir(&handle).expect("instance_dir");
        fs::create_dir_all(&inst).expect("create instance dir");
        fs::write(inst.join("extra.log"), "hello").expect("write file");
        fs::create_dir_all(inst.join("cache")).expect("create cache dir");
        fs::write(inst.join("cache").join("tmp.bin"), "x").expect("write cache file");

        let before: Vec<_> = fs::read_dir(&inst).unwrap().collect();
        assert!(!before.is_empty());

        commands::wipe_local_data(handle).expect("wipe_local_data");

        let after: Vec<_> = fs::read_dir(&inst).unwrap().collect();
        assert!(after.is_empty());

        std::env::remove_var("KASSEN_TEST_DB_DIR");
        std::env::remove_var("KASSEN_INSTANCE");
    }
}

