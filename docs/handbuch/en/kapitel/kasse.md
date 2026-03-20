---
title: Register
order: 20
slug: kasse
---

# Register

**When?** You record a **customer receipt** (one receipt with one or more lines).

![Register: line entry](./handbuch/en/assets/kasse.png)

**Steps (short)**

1. Home → **Register**.
2. **Staff**: check or **Change** person 1 / person 2, then **Save**.
3. Per line: **Merchant number**, **Amount**, optional **Description**.
4. **Complete customer receipt** – **Receipt number** is assigned automatically (**prefix-year-nnn**).

## Requirements

The register is only open when:

- an **active billing cycle** exists and
- the register matches its role/main register (no blocking message).

Otherwise a hint is shown – check [Settings](handbuch://einstellungen) or [First run & roles](handbuch://erststart-und-rollen).

## Lines

- **Multiple lines**: **Add line** or keyboard shortcuts (below).
- **Remove line**: **−** button or **Ctrl+Del** / **Ctrl+-** with focus in a line.
- **Amount**: comma or dot (e.g. `12.50` or `12,5`).

## Unknown merchant number

If the number is **not** in the merchant list, you see **Cancel** and **Post anyway**. Master data is edited on the **main register**: [Merchants](handbuch://haendler).

## Quick entry

Above the lines: **Quick entry** field.

- Format: `merchant_number` **space** `amount` optional text as **description**.
- **Enter** adds a line and clears the field.

Example: `42 10.50 Drinks`

## Keyboard (selection)

| Action | Key |
|--------|-----|
| Line: merchant → amount → description | **Enter** |
| New line | **Enter** in description or **Ctrl+N** (**Cmd+N** on macOS) |
| Complete (save) | **Ctrl+Enter** / **Cmd+Enter** or **F2** |
| Remove line (focus in line) | **Ctrl+Del** or **Ctrl+-** |
| Back to home | **Escape** (when staff edit is not open) |

## Common issues

- **No active billing cycle** → main: start cycle or wait; see [Settlement](handbuch://abrechnung) / [Settings](handbuch://einstellungen).
- **Register not aligned with main** → satellite: [Settings](handbuch://einstellungen) / [First run](handbuch://erststart-und-rollen).
- **Complete disabled** → read block message or check merchant number + valid amount.

See also: [Cashier (operation)](handbuch://kassierer)
