---
name: entkoppeln_cancel_logik_pruefen
overview: Analyse der Entkoppeln-/Cancel-Logik, um sicherzustellen, dass ein Abbrechen die Kasse nicht aus dem Netzwerk entfernt.
todos: []
isProject: false
---

### Ziel

Überprüfen, ob beim Entkoppeln einer Kasse das Betätigen von "Cancel" (Abbrechen) zuverlässig verhindert, dass `removePeerFromNetwork` ausgeführt wird, und einen klaren Vorschlag machen, falls hier ein Bug oder eine UX-Unklarheit vorliegt.

### 1. Relevante Stellen im Frontend identifizieren

- **Dateien sichten**: 
  - `[src/components/SyncStatusView.tsx](src/components/SyncStatusView.tsx)` – Entkoppeln-Button in der Sync-Status-Ansicht.
  - `[src/components/Startseite.tsx](src/components/Startseite.tsx)` – Entkoppeln-Button in der Kassenliste auf der Startseite.
  - `[src/db.ts](src/db.ts)` – Wrapper für `removePeerFromNetwork`.
- **Bedeutung**: Sicherstellen, dass es keine anderen versteckten Aufrufer von `removePeerFromNetwork` gibt.

### 2. Aktuelle Cancel-/Confirm