---
title: Merchants
order: 55
slug: haendler
---

# Merchants (main & satellite)

**When?** You maintain **master data** (main only) or view **totals and bookings** (main and satellite).

## Roles at a glance

| Role | Merchant admin (CRUD, import/export) | Overview (totals, drilldown) |
|--------|----------------------------------------|--------------------------------------|
| **Main** | Yes – **Merchant administration**; master data also via **Merchant overview** → **Manage master data** | Yes – **Merchant overview** |
| **Satellite** | No (read-only) | Yes – **Merchant overview** (read-only) |

## Merchant administration (main only)

- **New merchant**: number (no leading zeros), optional sort, display name or first/last name, email, address.
- **Save**, **Edit**, **Delete** (with confirmation).
- **Import / export**: **CSV** and **Excel** – export via save dialog; import via file picker (existing numbers updated, new ones created).

Master data appears on **PDF statements** – [Settlement](handbuch://abrechnung).

## Merchant overview (main)

- All merchants with **total** and **count** in the **current cycle** (same aggregates as settlement table).
- **Details** (per row): **drilldown** with all bookings for that merchant.
- **Manage master data…** → merchant administration.

## Merchant overview (satellite)

- Same **totals** display, **no** edit/delete/import.
- Hint: changes only on the main register.

## Drilldown “Bookings per merchant”

- Bookings in the **current cycle**, **grouped by register** (register name).
- Columns: time, receipt reference, amount, description, status (ok / voided).
- **Export CSV** – download visible data.
- **Print** – print dialog for the view.
- **Back** returns to **merchant overview** (main or satellite, depending where you opened the drilldown).

**Note:** The table row is **not** fully clickable – only **Details** opens the drilldown.

See also: [Settlement](handbuch://abrechnung) · [Technical / administration](handbuch://technik)
