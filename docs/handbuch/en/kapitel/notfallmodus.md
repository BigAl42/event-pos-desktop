---
title: Emergency mode
order: 60
slug: notfallmodus
---

# Emergency mode (export / import)

**When?** **Only in a real emergency**: sync or network fails and you must **save transaction data** for a billing cycle to a file or **merge** it on another register.

**Warning:** Wrong or duplicate imports can cause **duplicate or inconsistent** data. Agree which register is “leading” first.

## Where?

[Settings](handbuch://einstellungen) → **Emergency mode** (visible for main and satellite).

## Export

- **Emergency export (Excel)** – `.xlsx` with sheets (META, registers, customer receipts, lines, voids).
- **Emergency export (CSV)** – one CSV with all rows (Excel-friendly BOM).

Export covers the **current active billing cycle** on this register.

## Import

1. **Choose file (import)** – `.xlsx` / `.xls` or `.csv`.
2. The view shows **export cycle** (from file) vs **active cycle (target)** and row counts.
3. If **cycle id** does not match: **warning** – you can enable **Import anyway (cycle id differs)**.
4. **Import** – then a **summary** (e.g. inserted/ignored registers, receipts, lines, voids).

Duplicates are mostly **ignored** (`INSERT OR IGNORE`).

## Difference from wizard JSON

The **Close billing cycle** wizard ([Settlement](handbuch://abrechnung)) saves an **emergency JSON** – same idea, different format. For manual merge in Excel, use **XLSX/CSV** from settings emergency mode.

## Common issues

- **Import blocked** → for cycle mismatch, enable **Import anyway** (on purpose!).
- **Wrong register** → always verify the **active target cycle** is the shared one.

See also: [Technical / administration](handbuch://technik)
