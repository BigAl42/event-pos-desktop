---
title: First run & roles
order: 40
slug: erststart-und-rollen
---

# First run & roles

**When?** The app opens for the **first time**, or you need to understand **roles**.

## First-run dialog

1. **Set up as main register** – this install becomes **main** (master).
2. **Join network (satellite)** – this install becomes **satellite** (slave).

Then enter **register name** and **person 1** / **person 2** and finish.

## Main register (master)

- Provides **WebSocket server** for join and sync.
- **Merchant administration**, **join requests**, **Close billing cycle** (wizard).
- **Home**: **Connected registers** with status and last sync; **Detach** removes a satellite (with confirmation).

After setup: [Settings](handbuch://einstellungen) for port, **My sync URL**, join token, **Start server**, **Start sync to peers**.

## Satellite register (slave)

- Connects to **main** (URL + 6-digit join code + own sync URL).
- **No** merchant master edits; **merchant overview** is **read-only**.
- **Closeout** before permanent disconnect – [Settings](handbuch://einstellungen).

**Satellite home**:

- If **not connected**: automatic search for mains (**mDNS**); **Join** opens dialog for **join code** and **sync URL**.
- If **connected**: short hint and link to settings to search again.
- **Request closeout** tile opens settings; shows **active cycle** and **closeout** status.

## Automatic start (background)

If role and config fit, the app may try to start **server** (main) and **sync** (when **My sync URL** is set) on launch. If something is missing, configure manually in settings.

## Common issues

- **Two registers on one PC** → dev setup uses separate instances; in production one install per register with its own sync URL.
- **Main not found** → set URL manually in [Settings](handbuch://einstellungen) or use `127.0.0.1`.

See also: [Technical / administration](handbuch://technik)
