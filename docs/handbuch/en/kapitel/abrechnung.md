---
title: Settlement
order: 30
slug: abrechnung
---

# Settlement

**When?** You need **totals per merchant**, **PDF statements**, or (main register) to **close the billing cycle** cleanly.

## Totals & PDF (all roles with access)

- The table shows **count** and **sum (€)** per **merchant number** from a **backend aggregate** (not recomputed in the UI).
- The **current billing cycle** is shown at the top.
- **Create PDF** (per row): one **A4 page** with merchant master data (incl. address/email if set), cycle info, **total** and **booking count** – **no** line-item list.
- **Create all PDFs**: pick a folder; all merchant PDFs are written sequentially with progress shown.

## Close billing cycle (main register only)

**Close billing cycle** opens a **three-step wizard**:

### Step 1 – Closeout

- Each **satellite** with a sync URL needs a valid **closeout** for the **current cycle**.
- **Check again** refreshes the list.
- If not all satellites are OK:
  - optional **Close anyway (ignore peers)** with **warning** (data from ignored registers may be missing).
  - **Clear ignore** resets the selection.

### Step 2 – Exports (required)

Starting a **new** cycle **deletes local transaction data** for the old cycle – exports are mandatory:

1. **Create all PDFs** – as above; must show **OK**.
2. **Save emergency export** – JSON with all transaction data for the active cycle (save dialog).

### Step 3 – New cycle

- **Export summary**: PDF count and path to emergency JSON (if set).
- Enter a **name** for the new cycle.
- **Start new cycle** ends the old cycle, creates the new one, and **deletes** old-cycle transactions.

The backend checks connected peers for completeness unless **ignored** in step 1.

## Billing cycles in settings

- List of cycles; **active** marked.
- **Start new billing cycle** (with confirmation) – clears customer receipts and lines; merchants and register setup stay.
- Non-active cycles can be **deleted** (with confirmation).

Details: [Settings](handbuch://einstellungen)

## Common issues

- **No active cycle** → check [Settings](handbuch://einstellungen).
- **Wizard step 2/3 blocked** → finish closeout or **ignore peers**; both exports (PDF batch + JSON) must be **OK**.
- **PDF errors** → folder permissions / path.

See also: [Technical / administration](handbuch://technik) · [Cashier (operation)](handbuch://kassierer)
