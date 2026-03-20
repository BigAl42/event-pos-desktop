---
title: Overview
order: 8
slug: ueberblick
---

# Overview

**When?** You want to understand how the app is structured and which areas exist.

The system is **offline-capable** and supports multiple registers (**main** and **satellites**). Data syncs between registers over **WebSockets**.

## Navigation

![Home screen with tiles (main register)](./handbuch/en/assets/startseite.png)

- **Home**: tiles depend on role (e.g. register, settlement, void, sync status, handbook, settings, merchants, join requests).
- **Status bar** (bottom): role, sync text, current billing cycle, pending join requests, **Help** (opens the handbook).

## Core features

- **Register**: customer receipts with 1–n lines, automatic receipt numbers (**prefix-year-nnn**), staff (person 1/2). Details: [Register](handbuch://kasse).
- **Void**: recent receipts; void lines or whole receipts. Details: [Void](handbuch://storno).
- **Settlement**: totals per merchant (from backend), PDF per merchant; on the main register **Close billing cycle** (wizard). Details: [Settlement](handbuch://abrechnung).
- **Billing cycles**: the **active cycle** defines the “register day”; postings belong to a cycle id. Manage in [Settings](handbuch://einstellungen).
- **Sync (main/satellite)**: exchange of customer receipts (sequence-based) and voids. Diagnostics: [Sync status](handbuch://sync-status).
- **Merchants**: master data and overviews differ by role. Details: [Merchants](handbuch://haendler).

## Data

- **SQLite** in the app data directory.
- Migrations live in `src-tauri/migrations/` in the project (embedded in the built app).

## Read more

- Operation: [Cashier (operation)](handbuch://kassierer)
- Setup & operations: [Technical / administration](handbuch://technik)
