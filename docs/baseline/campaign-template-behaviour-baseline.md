# Baseline behaviour — Campaigns & Templates (pre-change snapshot)

**Captured:** 2026-11-07, before any P1 / P2.5 code changes.
**Backend:** `main` @ `d3ab236` · **Frontend:** `main` @ `4add73b`
**Branch for changes:** `claude/eager-sagan-iwbh42` (both repos)

## Why this file exists

Live clients depend on these flows today. This records **exactly what happens now**, so that
after the planned fixes we can re-run the same steps and spot any unintended change.

How to use it:

1. **Before changes** — walk the manual test script in §9 on the current build and tick each row.
2. **After changes** — walk the same script. Any row whose result differs and is **not** listed in
   §8 "Intended changes" is a **regression**.

Anything in §7 is a bug that already exists. Those behaviours are *not* worth preserving — they are
the things we are fixing.

---

## 1. Roles and visibility

Both pages gate every write behind one check:

```
canManage = workspaceRole === 'company_admin'
```

| Role | Templates page | Campaigns page |
| --- | --- | --- |
| `company_admin` | Full: create, submit, delete, refresh | Full: create, start, pause, resume, delete |
| any other role | Read-only list. Note: *"Only company admins can create or delete templates. You can still use approved templates in campaigns."* | Read-only table. Note: *"Only company admins create or control campaigns."* |

Backend: every route sits behind `requireAuth + tenantMiddleware + requireAgent`
(`company/tenant.routes.ts:40`); Meta config routes additionally require `requireCompanyAdmin`.
Every query is scoped by `companyId`.

---

## 2. Templates page — current UI behaviour

`frontend/src/pages/TemplatesPage.tsx`

### Header
- Title **"Templates"**, description *"Reusable message drafts. WhatsApp needs Meta approval before a template can be sent."*
- Admin buttons: **"Refresh from Meta"** (shows *"Refreshing…"* while pending) and **"New template"** / **"Close"**.

### Composer (admin, when open)
Two-column layout: form on the left, **"Live preview"** card on the right (sticky on `lg`).

| Field | Required | Default | Notes |
| --- | --- | --- | --- |
| Name | yes | empty | placeholder *"e.g. Welcome / Promo week"* |
| Placeholder chips | — | — | exactly three: `{{name}}`, `{{phone}}`, `{{email}}`; click inserts at cursor |
| Message body | yes | empty | 6-row textarea, placeholder *"Hi {{name}}, thanks for joining us!"* |
| Image URL | no | empty | `type="url"`; hint *"Public HTTPS link — shown in preview and attached when campaigns send."* |
| Language code | no | `en` | free text |
| Category | no | `UTILITY` | Utility / Marketing / Authentication, each with a hint |

Static note under the form: *"Meta rejects templates filed under the wrong category — promotional content must be Marketing."*

Buttons: **Cancel** and **"Save template"** (*"Saving…"* while pending). On success the form clears
(`name`, `body`, `imageUrl`) and the composer closes. On failure the error renders in a red alert
at the top of the page.

### Live preview
- Two modes: **"Placeholders visible"** (default) and **"Sample contact"**.
- In "Sample contact" mode, three editable inputs appear — `name`, `phone`, `email` — defaulting to
  **Alex Kumar / +1 555 010-2048 / alex@example.com**.
- Bubble renders the image on top (capped height) and the body beneath. In tokens mode every
  `{{…}}` is highlighted; in filled mode only `name`, `phone`, `email` are substituted
  (case-insensitive) — any other token is left as literal text.

### Library (card grid)
- Sorted **by name, ascending** (`localeCompare`). 1 / 2 / 3 columns responsive.
- Each card shows: `WhatsApp` badge, status badge, category (right-aligned), name + language,
  body clamped to 4 lines, and `Image: <url>` when present.
- When status is `REJECTED` **and** `rejectedReason` is set, a red box reads
  *"Meta rejected this: &lt;reason&gt;"*.

Status badge labels (exact):

| Status | Label |
| --- | --- |
| `local` | Not submitted |
| `PENDING` | Pending review |
| `APPROVED` | Approved |
| `REJECTED` | Rejected |
| `PAUSED` | Paused |
| `DISABLED` | Disabled |
| `IN_APPEAL` | In appeal |

### Card actions (admin only)
- **"Submit for approval"** — rendered **only** when status is neither `APPROVED` nor `PENDING`.
  Shows *"Submitting…"* while pending.
- **"Delete"** — always rendered. **There is no confirmation dialog**; the click deletes immediately.
- **There is no edit UI.** The `PATCH /templates/:id` route exists and is live, but nothing in the
  frontend calls it.

---

## 3. Templates — current backend behaviour

| Action | Route | Behaviour today |
| --- | --- | --- |
| List | `GET /templates` | All non-deleted templates for the company. No pagination. |
| Create | `POST /templates` | Stores name, body, language, category, imageUrl; derives `variables` from the body (only `name`/`phone`/`email` are recognised) and `metaTemplateName` as a lowercase snake_case slug; status `local`. Unique index on `(companyId, name)`. |
| Submit | `POST /templates/:id/submit` | 409 if already `APPROVED` or `PENDING`. Rewrites `{{name}}` → `{{1}}`, uploads the header image to Meta (Resumable Upload) when one is set, POSTs the template, stores returned id + status, stamps `submittedAt`, clears `rejectedReason`. |
| Sync | `POST /templates/sync` | Fetches `id,name,status,category,language,rejected_reason` from Meta and matches **by name**. Updates status/category/rejection and stamps `syncedAt`. Returns `{ok, checked, updated, remote}`. Does **not** fetch `components`. |
| Delete | `DELETE /templates/:id` | Best-effort delete on Meta (failures only logged), then soft-deletes locally. Always responds `{ok:true}`. |
| Update | `PATCH /templates/:id` | Live but unused by the UI. Body changes reset status to `local`. |

Submitted template structure today: **BODY only**, plus an **IMAGE header** when `imageUrl` is set.
No footer, no buttons, no text/video/document header.

Sample values sent to Meta for the three variables: `Rahul` / `919876543210` / `rahul@example.com`.

---

## 4. Campaigns page — current UI behaviour

`frontend/src/pages/CampaignsPage.tsx`

### Header and banners
- Title **"Campaigns"**, description *"One-time broadcasts tied to a WhatsApp sender and an approved template."*
- Admin button: **"New campaign"** / **"Close"**.
- When `summary.metaReadyForCampaigns` is false, a yellow panel appears:
  heading *"Complete Meta setup before starting campaigns"*, then the `metaSetupIssues` list, or the
  single fallback item *"Open Settings and finish Meta WhatsApp configuration"*.

### Composer (admin, when open)
Form on the left, **"Template preview"** card on the right.

| Field | Required | Default | Notes |
| --- | --- | --- | --- |
| Campaign name | yes | empty | placeholder *"Spring promo blast"* |
| WhatsApp sender | yes | auto-selected | prefers workspace default sender, then first available |
| Template | yes (in the UI) | empty | hint *"Required before you start the campaign"* |
| Contact group | no | none | **single group only** — the UI cannot pick several; hint *"Who receives this campaign"* |
| Schedule (optional) | no | empty | `datetime-local`, converted to ISO and sent as `scheduledAt` |

Buttons: **Cancel** and **"Create draft"** (*"Saving…"* while pending). On success `name` and the
schedule field clear and the composer closes. The campaign is created with status **`draft`**.

Preview card: empty state reads *"Select a template to see the WhatsApp bubble, including image and
placeholders like {{name}}."* Once a template is chosen it shows
*"Showing sample data. Real sends use each contact's name, phone, and email."* above a bubble
rendered with sample values and the template name as the caption.

### Table
Columns: **Campaign · Channel · Audience · Status · Sent · Failed · Actions**. Sorted by
`createdAt` **descending**. Minimum width 720px with horizontal scroll.

- **Channel** is always the static badge `WhatsApp`.
- **Audience** shows joined group names, else `N contacts`, else `—`.
- **Sent** renders as `sent / total`; **Failed** turns red when non-zero.

Status badge tone: `running`/`completed`/`sent` → brand · `scheduled`/`paused` → warn ·
`failed`/`cancelled` → danger · anything else → neutral.

### Row actions (admin only)
**Start · Pause · Resume · Delete** — all four are **always rendered and always enabled**,
whatever the campaign's status. They are disabled only while another action is in flight.
There is **no confirmation on Delete**.

Empty state: *"No campaigns yet. Create a draft with "New campaign"."*
Pagination: **Previous** / **Next** plus *"Page N · T total"*.

---

## 5. Campaigns — current backend behaviour

### Start (`POST /campaigns/:id/start`)
1. Collects recipients: `contactIds` plus every contact in each `contactGroupIds` group, de-duplicated.
2. Loads the template body and image.
3. Runs `assertCampaignCanStart` (see the gate list below). Any failure returns **400** with the
   message shown verbatim in the red alert.
4. Sets status `running` and `stats = {total, sent: 0, failed: 0}`.
5. Upserts one `CampaignMessage` per recipient with the body already personalised, then enqueues one
   BullMQ job per recipient (`jobId: camp-<campaignId>-<contactId>`, 5 attempts, exponential backoff).

**Preflight gates and their exact messages:**

| Condition | Message |
| --- | --- |
| no recipients | `Campaign has no recipients — add a contact group or contacts` |
| no template | `Campaign needs a message template before starting` |
| no template body | `Campaign has no template body` |
| credentials missing | `Meta credentials are not configured — open Settings and save access token + app secret` |
| webhook unverified | `Meta webhook is not verified — paste the callback URL and verify token in Meta Developer Console` |
| sender not found | `WhatsApp sender not found for this workspace` |
| sender missing phone id | `Selected Meta sender is missing phone number ID` |
| template row missing | `Campaign template not found` |
| template not approved | `Template "<name>" is <status> — submit it for Meta approval and wait until it is approved before starting a campaign` |
| wallet short | `This campaign needs <N> credits for <M> recipients and the wallet has <B>. Top up, or reduce the audience.` |

### Pause / Resume / Delete
- **Pause** sets status `paused`. Always responds `{ok:true}` — even for a campaign that is not running.
- **Resume** re-runs the full preflight sized to the outstanding recipients, sets status `running`,
  and re-enqueues every message still `pending`/`failed`/`queued` without a provider id.
- **Delete** soft-deletes and forces status `paused`. Always `{ok:true}`.

### Worker (per recipient)
Rate limited to **30 jobs / minute**, process-wide.

1. Skips silently if the campaign is missing, `paused`, or deleted.
2. Skips if the `CampaignMessage` is already `sent` or already has a provider id.
3. Marks it `queued`.
4. Fails the message with `contact missing` / `whatsapp number missing` when either is gone.
5. For a Meta sender, requires an `APPROVED` template with a `metaTemplateName`; otherwise fails the
   message with *"campaign has no template"* or
   *"template "&lt;name&gt;" is &lt;status&gt; on Meta — submit it and wait for approval"* and increments `stats.failed`.
6. **Debits 1 credit before dispatch.** If the debit fails, the message is failed with `out of credits`,
   `stats.failed` increments, and the **whole campaign is paused**.
7. Sends, stores the provider message id, marks `sent`, increments `stats.sent`.
8. On a send error: marks `failed`, increments `stats.failed`, **refunds the credit**, and rethrows so
   BullMQ retries.
9. Lost race (another worker already sent): refunds the credit and stops.

### Delivery status
The Meta status webhook updates the chat `Message` **and** the matching `CampaignMessage`
(`applyCampaignMessageStatus`), guarded so a late `delivered` cannot overwrite a `read`.
A message that Meta later rejects moves from `sent` to `failed` in `stats`.
Once `stats.sent + stats.failed === stats.total`, the campaign becomes `completed` with `completedAt`.

Meta's `pricing` object (`billable`, `category`, `pricingModel`, `pricingType`) is stored on both the
`Message` and the `CampaignMessage`. **Nothing reads it back yet.**

---

## 6. Webhook behaviour

- Two URL shapes: per-tenant `/webhooks/meta/whatsapp/:webhookSlug`, and a legacy slug-less path.
- `GET` verify: matches the tenant's `webhookVerifyToken` (by slug or by token) and records
  `webhookVerificationStatus = verified`. A match against `env.META_VERIFY_TOKEN` returns the
  challenge but records **nothing**.
- `POST`: tenant resolved by slug, else by `phone_number_id` → sender → company. Signature verified
  as HMAC-SHA256 of the **raw body** against the tenant's app secret (falling back to
  `env.META_APP_SECRET`), compared with `timingSafeEqual`. A failure returns **401** unless there is
  no app secret at all and `NODE_ENV === 'development'`.
- **Only `change.field === 'messages'` is processed.** Every other field is skipped.
- Inbound messages are de-duplicated by provider id, every message type is stored, the chat's
  `lastInboundAt` is refreshed, and media download / CRM push / auto-response / lead assignment all
  run detached so the webhook answers quickly.

---

## 7. Known-broken behaviour today (do NOT preserve)

| # | Behaviour now | Where |
| --- | --- | --- |
| 1 | A campaign given a **Schedule** is created as `draft` and **never sends**. Nothing reads `scheduledAt`; the `scheduled` status is never set. Silent. | `campaign.controller.ts:51,83` |
| 2 | `PATCH /templates/:id` does not clear `metaTemplateId` (Mongoose strips `undefined` from `$set`), so an edited template keeps pointing at the old Meta template. Not reachable from the UI today. | `template.controller.ts:68` |
| 3 | Account- and template-level webhooks (`account_update`, `account_alerts`, `message_template_status_update`, …) are **dropped**: they carry no `phone_number_id`, so no tenant resolves, and the field filter skips them anyway. | `meta.whatsapp.webhook.ts:204` |
| 4 | Verifying with `env.META_VERIFY_TOKEN` never records `webhookVerificationStatus`, so the campaign preflight can refuse to start with *"Meta webhook is not verified"*. | `meta.whatsapp.webhook.ts:149` |
| 5 | A message that reaches `read` and then `failed` increments `stats.failed` without decrementing `stats.sent`, so `sent + failed` can exceed `total`. | `campaign.service.ts:217` |
| 6 | The template header image URL is fetched server-side with no private-IP block, timeout, or size cap. | `meta.service.ts:226` |
| 7 | A running or completed campaign can have its template, sender and audience swapped; in-flight jobs pick up the change. | `campaign.controller.ts:57` |

---

## 8. Intended changes (expected to differ after the work)

Everything here is a **deliberate** change. A difference in any of these rows is not a regression.

| Area | Today | After |
| --- | --- | --- |
| Scheduled campaign | silently never sends | fires at `scheduledAt` (or the field is hidden until it does) |
| Template edit via API | keeps stale `metaTemplateId` | field cleared with `$unset` |
| Header image fetch | any URL, no limits | private IPs rejected, timeout and size cap applied |
| Billable decision | reads `pricing.billable` | derived from `pricing.type` + `pricing.category` |
| Category casing | mixed | normalised at the boundary |
| `PATCH` validation | `passthrough()` | real schema; `imageUrl` must be a URL |
| Campaign edit | allowed in any status | blocked once running/completed |
| `read` → `failed` | double-counted | counted once |
| Webhook fields | `messages` only | account/template fields accepted, tenant resolved by WABA id |

**Everything in §1–§6 that is not in this table must behave identically.**

---

## 9. Manual regression script

Run as a `company_admin` in a test workspace. Record the result in the "Before" column now, and in
"After" once the changes land.

### Templates

| # | Step | Expected (current) | Before | After |
| --- | --- | --- | --- | --- |
| T1 | Open Templates as a non-admin | Read-only; the admin note shows; no buttons | | |
| T2 | Open the composer | Two columns; preview empty-state visible | | |
| T3 | Click each placeholder chip | `{{name}}`, `{{phone}}`, `{{email}}` insert at the cursor | | |
| T4 | Type a body with `{{name}}` | Tokens mode highlights it | | |
| T5 | Switch to "Sample contact" | Three editable inputs; body shows *Alex Kumar* | | |
| T6 | Paste an image URL | Image appears on top of the bubble | | |
| T7 | Save with an empty name or body | Browser blocks submission (required) | | |
| T8 | Save a valid template | Card appears; badge **Not submitted**; form clears; composer closes | | |
| T9 | Save a second template with the same name | Server rejects (unique index); red alert shows | | |
| T10 | Library ordering | Sorted by name A→Z | | |
| T11 | Submit for approval | Button hidden for APPROVED/PENDING, shown otherwise; status becomes **Pending review** | | |
| T12 | Submit an already-pending template (API) | 409 *"Template already pending on Meta"* | | |
| T13 | "Refresh from Meta" | Button shows *"Refreshing…"*; statuses update | | |
| T14 | A REJECTED template | Red box *"Meta rejected this: …"* | | |
| T15 | Delete | Deletes immediately, **no confirmation** | | |

### Campaigns

| # | Step | Expected (current) | Before | After |
| --- | --- | --- | --- | --- |
| C1 | Open Campaigns as a non-admin | Read-only; admin note; no action buttons | | |
| C2 | Meta setup incomplete | Yellow panel lists the issues | | |
| C3 | Open the composer | Sender pre-selected to the workspace default | | |
| C4 | Pick a template | Right card renders the bubble with sample data | | |
| C5 | Create a draft | Row appears with status **draft**; name and schedule clear | | |
| C6 | Audience column | Group name, else `N contacts`, else `—` | | |
| C7 | Start with no recipients | 400 *"Campaign has no recipients — add a contact group or contacts"* | | |
| C8 | Start with an unapproved template | 400 *"Template "X" is local — submit it for Meta approval…"* | | |
| C9 | Start with an empty wallet | 400 *"This campaign needs N credits…"* | | |
| C10 | Start a valid campaign | Status **running**; Sent climbs as `sent / total` | | |
| C11 | Wallet hits zero mid-run | Message fails with `out of credits`; **campaign pauses** | | |
| C12 | Pause, then Resume | Resume re-runs the preflight and re-queues outstanding recipients only | | |
| C13 | All recipients finish | Status becomes **completed** | | |
| C14 | A delivered message later fails | `Failed` increments, `Sent` decrements | | |
| C15 | Delete | Row disappears immediately, **no confirmation** | | |
| C16 | Table ordering | Newest first | | |
| C17 | Pagination | Previous/Next behave; *"Page N · T total"* correct | | |
| C18 | **Create with a Schedule** | Row is **draft** and **never sends** (bug #1) | | |

### Webhook / messaging

| # | Step | Expected (current) | Before | After |
| --- | --- | --- | --- | --- |
| W1 | Inbound message from a contact | Appears in the inbox; unread count rises | | |
| W2 | Inbound image / ad click | Stored with a caption or `[type]` placeholder | | |
| W3 | Outbound delivery status | Chat message moves sent → delivered → read | | |
| W4 | Campaign message status | `CampaignMessage` and campaign stats follow the same status | | |
| W5 | POST with a bad signature | **401** `Invalid signature` | | |
| W6 | Duplicate inbound id | Ignored, no duplicate row | | |
| W7 | Campaign send | Does **not** appear in the chat thread (known gap) | | |

---

## 10. Snapshot before you start

Worth capturing now, so "it looked different" can be checked rather than argued:

- Screenshots: Templates library, template composer in both preview modes, Campaigns table,
  campaign composer with a template selected, the Meta-setup warning panel.
- A `GET /templates` and `GET /campaigns?page=1` response body from the test workspace.
- Counts: templates by status, campaigns by status, wallet balance.
