use crate::db;
use openssl::asn1::Asn1Time;
use openssl::hash::MessageDigest;
use openssl::pkcs12::Pkcs12;
use openssl::pkey::PKey;
use openssl::rsa::Rsa;
use openssl::x509::extension::SubjectAlternativeName;
use openssl::x509::{X509NameBuilder, X509};
use openssl::x509::X509Builder;
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

const TLS_DIR: &str = "tls";
const TLS_IDENTITY_FILENAME: &str = "identity.p12";
const TLS_PASSWORD_KEY: &str = "tls_identity_password";

fn tls_identity_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(db::instance_dir(app)?.join(TLS_DIR).join(TLS_IDENTITY_FILENAME))
}

fn ensure_password(app: &AppHandle) -> Result<String, String> {
    if let Some(pw) = db::get_config(app, TLS_PASSWORD_KEY).map_err(|e| e.to_string())? {
        if !pw.trim().is_empty() {
            return Ok(pw);
        }
    }
    // Random hex password; not a security boundary, just to protect the PKCS12 container.
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    let pw = hex::encode(bytes);
    db::set_config(app, TLS_PASSWORD_KEY, &pw).map_err(|e| e.to_string())?;
    Ok(pw)
}

pub fn sha256_fingerprint_hex(cert_der: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(cert_der);
    hex::encode(h.finalize())
}

/// Ensures a self-signed PKCS12 identity exists and returns the DER-encoded leaf cert fingerprint.
pub fn ensure_identity_and_fingerprint(app: &AppHandle) -> Result<(native_tls::Identity, String), String> {
    let pw = ensure_password(app)?;
    let path = tls_identity_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    if !path.exists() {
        // Build a self-signed cert whose CN includes this kasse's id for debugging.
        let kassen_id = db::get_config(app, "kassen_id")
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|| "unknown".to_string());

        let rsa = Rsa::generate(2048).map_err(|e| e.to_string())?;
        let pkey = PKey::from_rsa(rsa).map_err(|e| e.to_string())?;

        let mut name = X509NameBuilder::new().map_err(|e| e.to_string())?;
        name.append_entry_by_text("CN", &format!("kassensystem-{}", kassen_id))
            .map_err(|e| e.to_string())?;
        let name = name.build();

        let mut builder = X509Builder::new().map_err(|e| e.to_string())?;
        builder.set_version(2).map_err(|e| e.to_string())?;
        builder.set_subject_name(&name).map_err(|e| e.to_string())?;
        builder.set_issuer_name(&name).map_err(|e| e.to_string())?;
        builder.set_pubkey(&pkey).map_err(|e| e.to_string())?;
        let not_before = Asn1Time::days_from_now(0).map_err(|e| e.to_string())?;
        let not_after = Asn1Time::days_from_now(3650).map_err(|e| e.to_string())?;
        builder
            .set_not_before(not_before.as_ref())
            .map_err(|e| e.to_string())?;
        builder
            .set_not_after(not_after.as_ref())
            .map_err(|e| e.to_string())?;

        let mut san = SubjectAlternativeName::new();
        san.dns("localhost");
        san.ip("127.0.0.1");
        let san_ext = san.build(&builder.x509v3_context(None, None)).map_err(|e| e.to_string())?;
        builder.append_extension(san_ext).map_err(|e| e.to_string())?;

        builder.sign(&pkey, MessageDigest::sha256()).map_err(|e| e.to_string())?;
        let x509: X509 = builder.build();

        let builder = Pkcs12::builder();
        let pkcs12 = builder
            .build(&pw, "kassensystem", &pkey, &x509)
            .map_err(|e| e.to_string())?;
        fs::write(&path, pkcs12.to_der().map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    }

    let der = fs::read(&path).map_err(|e| e.to_string())?;
    let id = native_tls::Identity::from_pkcs12(&der, &pw).map_err(|e| e.to_string())?;

    // Compute fingerprint by parsing the PKCS12 and extracting the leaf certificate.
    let parsed = Pkcs12::from_der(&der).map_err(|e| e.to_string())?.parse(&pw).map_err(|e| e.to_string())?;
    let cert_der = parsed.cert.to_der().map_err(|e| e.to_string())?;
    let fp = sha256_fingerprint_hex(&cert_der);

    Ok((id, fp))
}

