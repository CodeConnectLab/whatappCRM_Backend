# P0 — WABA Graph API verification spike

**Goal:** before building the P3 pricing/analytics dashboard, confirm against a
**real client WABA** what Meta's Graph API actually returns. The whole P3 plan
depends on one answer: **does `pricing_analytics` return a real `cost`, or `null`?**

- **Run it:** `scripts/waba-p0-verify.sh` (read-only; the one mutating POST is opt-in).
- **Token:** needs a `whatsapp_business_management` user / system-user token.
- **Graph version:** backend currently pins `v21.0` (`src/modules/meta/meta.service.ts`).
  Run the spike on `v21.0` first (that's what prod will use), then optionally on
  `v23.0` to see if a newer version unlocks the newest fields.

---

## The 8 probes

| # | Probe | What we're checking | Pre-research answer (NEEDS LIVE CONFIRM) |
|---|-------|---------------------|------------------------------------------|
| 1 | `pricing_analytics` + `metric_types([COST,VOLUME])` | **Is `cost` null?** | **cost is returned ONLY if the business is billed directly by Meta. Through a BSP / Solution Partner it is null / "Cost not available".** Most reseller-CRM tenants ⇒ expect null. ⬅ decides P3. |
| 2 | `.dimensions([...,TIER])` | Is `TIER` accepted? | **Yes** — valid dimensions are `COUNTRY, PHONE, PRICING_CATEGORY, PRICING_TYPE, TIER`. For volume-tier data, pass `TIER + PRICING_CATEGORY + COUNTRY` together. |
| 3 | `.granularity(MONTHLY)` | Valid granularity? | **Likely yes** (`HALF_HOUR / DAILY / MONTHLY`). Confirm live — some versions reject MONTHLY on narrow windows. |
| 4 | `conversation_analytics` | Field present, or gone/empty? | Field **still exists**, but under per-message pricing (since Jul 2025) conversation-based data may be **empty/zero for recent dates**. Must confirm live. |
| 5 | `analytics` | `sent` / `delivered` present? | **Yes, stable.** Returns `data_points[]` with `sent` and `delivered`. |
| 6 | WABA fields `currency, account_review_status, business_verification_status, health_status` | Do they exist? | **Expected yes** for all four (`health_status` is the newer messaging-health object). Confirm exact shape. |
| 7 | `phone_numbers`: `whatsapp_business_manager_messaging_limit` vs `messaging_limit_tier` | Which field is live? | **`messaging_limit_tier` is DEPRECATED.** Meta's docs say request **`whatsapp_business_manager_messaging_limit`** instead. The spike requests both so we see which the pinned version still honors. |
| 8 | `GET` (and opt-in `POST`) `/{waba}/subscribed_apps` | Which fields subscribe / are returned? | GET returns `whatsapp_business_api_data` + `override_callback_uri`. POST subscribes the app (supports per-WABA `override_callback_uri`). **POST mutates — opt-in via `RUN_SUBSCRIBE_POST=1` only.** |

---

## Decision rule for P3 (fill after the run)

- **If `cost` has real numbers** → P3 shows Meta's **actual** spend. Original plan holds.
- **If `cost` is null / errors ("Cost not available")** → account bills via a BSP/Solution
  Partner. **P3 changes:** show `VOLUME` + `PRICING_CATEGORY` + `PRICING_TYPE` + `TIER`
  broken down, and compute an **estimated** cost from our own rate card. Do **not**
  present it as Meta's billed amount. (`PRICING_TYPE=regular` ⇒ charged;
  `free_customer_service` / `free_entry_point` ⇒ not charged.)

---

## Results (paste after running)

> Fill HTTP status + the key observation for each. Raw JSON is saved under
> `p0-results/<timestamp>/` by the script.

| # | HTTP | Observed | cost present? |
|---|------|----------|---------------|
| 1 pricing_analytics COST+VOLUME | | | |
| 2 TIER dimension | | | n/a |
| 3 MONTHLY granularity | | | |
| 4 conversation_analytics | | | |
| 5 analytics sent/delivered | | | n/a |
| 6 WABA fields | | | n/a |
| 7 phone_numbers limits | | | n/a |
| 8 subscribed_apps GET | | | n/a |

**Final P3 verdict:** _actual cost available_ / _estimate only_ → _______________

---

### Sources
- Meta — WhatsApp Analytics (`pricing_analytics` dimensions incl. `TIER`, cost-via-BSP caveat): https://developers.facebook.com/documentation/business-messaging/whatsapp/analytics/
- Meta — Messaging Limits (`messaging_limit_tier` deprecated → `whatsapp_business_manager_messaging_limit`): https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits
- Backend Graph version pin: `src/modules/meta/meta.service.ts` (`GRAPH_API_VERSION = 'v21.0'`)
