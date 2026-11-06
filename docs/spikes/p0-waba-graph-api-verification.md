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

## Results — LIVE RUN 2026-11-06

Ran against WABA `1721309295524444` ("code connect", currency INR) on `v21.0`.
Raw JSON saved locally under `p0-results/<timestamp>/` (git-ignored — contains the
client phone number).

| # | HTTP | Observed | cost present? |
|---|------|----------|---------------|
| 1 pricing_analytics COST+VOLUME | 200 | `cost` + `volume` returned per data point. All sampled points were `pricing_type=FREE_CUSTOMER_SERVICE`, `pricing_category=SERVICE`, `cost=0` (genuinely free). No BSP "cost not available" error. | ✅ **YES — numeric, not null** |
| 2 TIER dimension | 200 | Accepted (no error). No `tier` key in points because all volume was free-service → no tier breakdown. Valid param; populates for billable volume. | n/a |
| 3 MONTHLY granularity | 200 | Valid. Monthly buckets: volume 8 then 10, cost 0. | ✅ |
| 4 conversation_analytics | 200 | **Empty** — response was `{"id":...}` only, field silently dropped. Effectively dead under per-message pricing. | ❌ unusable |
| 5 analytics sent/delivered | 200 | `data_points[]` with `sent`/`delivered` per day (1/1, 1/1, 2/2). `phone_numbers=["917376103969"]`. | n/a |
| 6 WABA fields | 200 | `currency=INR`, `account_review_status=APPROVED`, `business_verification_status=verified`, `health_status={can_send_message:AVAILABLE, entities:[WABA,BUSINESS,APP all AVAILABLE]}`, `timezone_id=71`, `message_template_namespace` present. | n/a |
| 7 phone_numbers limits | 200 | `whatsapp_business_manager_messaging_limit="TIER_2K"` ✅. `messaging_limit_tier` **absent (deprecated, silently dropped)**. Also `quality_rating=GREEN`, `throughput.level=STANDARD`, `display_phone_number="+91 73761 03969"`. | n/a |
| 8 subscribed_apps GET | 200 | One app subscribed: `connectcrm` (id `1385910615841011`). `override_callback_uri` not set (uses app-level webhook). | n/a |

**Final P3 verdict: ACTUAL COST AVAILABLE** (not estimate-only). `pricing_analytics.cost`
is present and numeric for this WABA — the BSP cost-hidden case does **not** apply here.

**Caveat / final confirmation step:** the test window held only free service messages
(`cost=0` is correct), so a *non-zero* cost was not directly observed. After any paid
(marketing / utility / authentication) send, re-run probe #1 to see a real cost value.

### Build notes for P3 (from this run)
- **Cost/volume source:** `pricing_analytics` with `metric_types([COST,VOLUME])` and
  `dimensions([COUNTRY,PRICING_CATEGORY,PRICING_TYPE])` (add `TIER` when you want the
  tier breakdown). Treat `pricing_type=FREE_*` as non-billable; `regular` as charged.
- **Do NOT use `conversation_analytics`** — it returns empty here.
- **Volume/delivery source:** `analytics` (`sent`/`delivered`) is reliable.
- **Messaging limit:** use `whatsapp_business_manager_messaging_limit` (e.g. `TIER_2K`),
  NOT the deprecated `messaging_limit_tier`.
- **Health panel:** `health_status.can_send_message` + per-entity statuses + `quality_rating`
  + `throughput.level` give a complete readiness widget.
- **Graph version:** `v21.0` already honors every field above (incl. the new limit field),
  so no version bump needed for P3.

---

### Sources
- Meta — WhatsApp Analytics (`pricing_analytics` dimensions incl. `TIER`, cost-via-BSP caveat): https://developers.facebook.com/documentation/business-messaging/whatsapp/analytics/
- Meta — Messaging Limits (`messaging_limit_tier` deprecated → `whatsapp_business_manager_messaging_limit`): https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits
- Backend Graph version pin: `src/modules/meta/meta.service.ts` (`GRAPH_API_VERSION = 'v21.0'`)
