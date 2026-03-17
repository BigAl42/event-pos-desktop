//! mDNS Discovery: Hauptkasse registriert sich, Nebenkassen browsen nach _kassensystem-master._tcp.local

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use std::collections::HashSet;
use std::time::Duration;

pub const SERVICE_TYPE: &str = "_kassensystem-master._tcp.local.";

/// Registriert die Hauptkasse im LAN. Der übergebene ServiceDaemon muss in App-State
/// gehalten werden, damit die Ankündigung aktiv bleibt.
pub fn register_master(
    daemon: &ServiceDaemon,
    port: u16,
    instance_name: &str,
) -> Result<(), String> {
    let host_name = format!(
        "kassensystem-master-{}.local.",
        instance_name.replace(' ', "-")
    );
    let props: [(&str, &str); 0] = [];
    let service_info = ServiceInfo::new(
        SERVICE_TYPE,
        instance_name,
        &host_name,
        "127.0.0.1",
        port,
        &props[..],
    )
    .map_err(|e| e.to_string())?
    .enable_addr_auto();
    daemon.register(service_info).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Clone, serde::Serialize)]
pub struct DiscoveredMaster {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub ws_url: String,
}

/// Sucht im LAN nach Hauptkassen (Timeout z.B. 5 Sekunden).
pub async fn discover_masters(timeout_secs: u64) -> Result<Vec<DiscoveredMaster>, String> {
    let mdns = ServiceDaemon::new().map_err(|e| e.to_string())?;
    let receiver = mdns.browse(SERVICE_TYPE).map_err(|e| e.to_string())?;

    let mut seen: HashSet<(String, u16)> = HashSet::new();
    let mut results = Vec::new();
    let timeout = Duration::from_secs(timeout_secs);
    let start = std::time::Instant::now();

    while start.elapsed() < timeout {
        let wait = timeout - start.elapsed();
        match tokio::time::timeout(wait, receiver.recv_async()).await {
            Ok(Ok(event)) => {
                if let ServiceEvent::ServiceResolved(resolved) = event {
                    let host = resolved
                        .addresses
                        .iter()
                        .find(|a| matches!(a, mdns_sd::ScopedIp::V4(_)))
                        .map(|a| a.to_string())
                        .or_else(|| resolved.addresses.iter().next().map(|a| a.to_string()));
                    if let Some(ip) = host {
                        let port = resolved.port;
                        if seen.insert((ip.clone(), port)) {
                            let name = resolved
                                .fullname
                                .split("._")
                                .next()
                                .unwrap_or("Master")
                                .to_string();
                            let ws_url = format!("ws://{}:{}", ip, port);
                            results.push(DiscoveredMaster {
                                name,
                                host: ip,
                                port,
                                ws_url,
                            });
                        }
                    }
                }
            }
            Ok(Err(_)) => break,
            Err(_) => break,
        }
    }

    mdns.stop_browse(SERVICE_TYPE).ok();
    Ok(results)
}
