---
title: Settings
order: 42
slug: einstellungen
---

# Settings

**When?** You change **register data**, **network/sync**, **billing cycles**, **emergency mode**, or run a **full local wipe**.

Settings are grouped in **collapsible sections** (accordions).

## This register

- **Name** and **role** (main / satellite) – read-only.
- **Staff**: **Edit** → person 1 and 2 → **Save** or **Cancel**.

## Network (main register)

- **Server port** and **My sync URL** (WebSocket URL for this register). Values save on blur.
- **Join token**: 6-digit code (display e.g. `123 456`); **Generate new** creates a new code. Satellites need it to join.
- **Start server** – then satellites can join.
- **Start sync to peers** – starts data exchange with peer registers.

See: [Join requests](handbuch://join-anfragen) · [Sync status](handbuch://sync-status)

## Network (satellite)

- On the **same machine**, **mDNS** often fails – use **Main on this machine (127.0.0.1)** or enter URL manually.
- **Find main registers on the network** – pick an entry to set **main register URL**.
- **Main register URL** and **My sync URL**.
- **Join code** (6 digits from main) → **Join network**. Join can fail if this register **already has bookings** – use **Reset request** (below).
- **Start sync** – reconnect.
- **Send reset request to main**: main checks all data arrived; if yes, **local billing cycle** is cleared and aligned with main.
- **Request closeout from main** – confirms all receipts and voids from this satellite reached the main register.
- **Disconnect & detach** – only after a successful closeout hint; leaves the network (join again later).

Satellite **home** shows **Connect to main** and **Closeout** short status – see [First run & roles](handbuch://erststart-und-rollen).

## Emergency mode

Export/import **transaction data** as **Excel** or **CSV** for merge on another register in an emergency. Details: [Emergency mode](handbuch://notfallmodus).

## Billing cycles

- List; **active** highlighted.
- Delete non-active cycles (with confirmation).
- **Start new billing cycle**: enter name, confirm twice – **deletes all customer receipts and lines**; merchants and register stay.

Main register: guided close with required exports → [Settlement](handbuch://abrechnung).

## Danger zone – delete local data

- **Delete everything locally**: full **database** and data for this installation. Then **first-run** setup again.
- Type `DELETE` first, then confirm.

## Common issues

- **Join fails** → 6-digit code? **My sync URL** set? Existing bookings? → reset request or clarify data.
- **No sync** → main server running? **Start sync** on both sides? Check [Sync status](handbuch://sync-status).

See also: [Technical / administration](handbuch://technik)

## Language

You can switch **English** and **German** in the **Language** section (stored in the browser / app storage).
