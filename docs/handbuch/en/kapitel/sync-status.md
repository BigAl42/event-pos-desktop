---
title: Sync status
order: 50
slug: sync-status
---

# Sync status

**When?** You want to see whether **sync is running**, which **peers** are reachable, and which **addresses** are used.

## Open

Home → **Sync status** tile.

## Sync runtime

- **Sync started**: yes/no  
- **Connected peers**: count  
- optional **start time**

## Main registers on LAN (mDNS)

- **Search** runs discovery for mains on the local network.
- Results show **name** and **WebSocket URL** (for reference; to connect still use [Settings](handbuch://einstellungen) or satellite home).

## Sync peers (configured)

Registers this instance syncs with (entries with `ws_url`):

- **Name** / id  
- **Connected** or **Disconnected**  
- **Last sync** (timestamp; “stale” may be highlighted)  
- **WebSocket address**

**Main register additionally:**

- **Closeout OK** – for the **current billing cycle**.  
- **Closeout old** – closeout exists but for a **different** cycle (tooltip).  
- **Detach** – remove peer (with confirmation).

**Disconnected** may show a **retry** indicator for the next connection attempt.

## No peers

In **Settings**, start sync – main: **Start sync to peers**, satellite: **Start sync**.

## Errors

You can open **Settings** from this view when an error is shown.

## Common issues

- **Peers disconnected** → firewall, wrong `ws_url`, remote down; main **server** running?
- **Unexpected peers** → old entries; **Detach** on main or check **Connected registers** on home.

See also: [Settings](handbuch://einstellungen) · [Technical / administration](handbuch://technik)
