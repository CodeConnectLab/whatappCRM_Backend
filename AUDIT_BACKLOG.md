# Audit backlog — billing, campaigns, templates

Findings from a code audit on 2026-09-29, against branch `claude/gifted-pascal-1ysc5w`.
Nothing here is fixed yet. Each item says what is wrong, where, and what the fix is.

Line references are to the backend repo unless the path says `frontend/`.

Two facts everything below depends on, both verified against Meta's current docs:

- **The 24-hour service window is anchored to the customer's last message.** A reply
  from the business does *not* extend it. Only a new inbound message (or call) from the
  customer resets it to 24 hours.
- **Per-message pricing (PMP) replaced conversation-based pricing on 1 July 2025.**
  Service messages inside the window are free and unlimited. Utility templates sent
  *inside* an open window are also free. Marketing, authentication, and utility sent
  outside the window are billed per delivered message, by category and country.

---

## A. Billing and credits

Current model is **BYO-WABA**: each workspace pastes its own Meta access token, so Meta
bills the client directly. The reseller model comes later, once we are a Tech Provider.
Everything in this section should be built so the same data serves both phases.

### A1 — Credits are charged for messages Meta gives away free · **high**

`modules/chat/chat.service.ts:389` debits a credit for every outbound chat message,
including free-form replies inside the service window. Those cost nothing.
`modules/automation/auto-response.service.ts:281` does the same for auto-responses,
which are almost always welcome messages inside a freshly opened window — so the
feature that is supposed to be free to run is the one billing hardest.

**Fix.** Decide billability from the message, not from the fact that one was sent:

| Message | Billable |
| --- | --- |
| Free-form reply, window open | no |
| Utility template, window open | no |
| Utility / authentication template, window closed | yes |
| Marketing template, any time | yes |
| Auto-response (free-form, window open by definition) | no |

### A2 — Meta tells us the real billable category and we throw it away · **high**

The status webhook carries a `pricing` object per message — `billable`,
`pricing_model`, `category` (marketing / utility / authentication / service) and `type`
(`regular` or `free_customer_service`). The statuses loop at
`modules/webhook/meta.whatsapp.webhook.ts:407` reads only `status` and `errors`.

This is the single most valuable thing to fix: it is Meta's own answer to "was this
billed, and as what", it costs one field to store, and it is what makes an honest usage
report possible in the BYO phase and correct resale pricing later.

**Fix.** Store `pricing.category`, `pricing.billable` and `pricing.type` on the message
when the status webhook arrives. Everything else in this section builds on it.

### A3 — A flat credit per message cannot express Meta's price list · **high**

`modules/wallet/wallet.service.ts` has `CREDIT_PER_MESSAGE = 1` for everything. A
marketing template to India and a free service reply cost the same internally, which is
wrong by roughly the whole price of the marketing message.

**Fix.** A rate card keyed on `(category, country calling code)`, with the free cases at
zero. Seed it from Meta's published rates; make it editable per environment, because
Meta revises rates and volume tiers discount utility and authentication by up to 20%.

### A4 — Showing "credits" at all is wrong for the current model · **medium**

In BYO-WABA the client already has a bill from Meta. A credit balance next to it is a
second, invented currency that does not correspond to money anyone is charged.

**Fix, phase 1 (now).** Replace the credits pill with **Usage** — messages sent this
month, split by billable category, with an estimated Meta cost from the rate card,
clearly labelled an estimate and pointing at Meta's own billing as the source of truth.
Keep writing the ledger underneath; it becomes the resale ledger later.

**Fix, phase 2 (Tech Provider).** Switch the same ledger to a prepaid wallet: top-ups,
per-category deduction from the rate card plus margin, low-balance warnings, and a
hard stop before send rather than after.

### A5 — Messages keep sending after the balance hits zero · **high**

`modules/campaign/campaign.worker.ts:237` catches a failed debit and only logs it. The
message has already gone out at that point, so a workspace at zero credits keeps
sending indefinitely and the ledger silently stops matching reality.
`assertCampaignCanStart` (`modules/meta/whatsapp-readiness.service.ts:45`) checks
recipients, template and readiness, but never the balance.

**Fix.** Reserve before send, not after: check the balance in the preflight for the
whole recipient count, and per message debit *before* dispatch, failing the message if
the debit fails. Refund on a send that then fails.

---

## B. Campaigns

Campaigns do work on the Meta path with an approved template — `assertCampaignCanStart`
blocks the common misconfigurations with readable messages, and the worker refuses to
send a non-approved template rather than failing at Meta. These are the gaps around it.

### B1 — `scheduledAt` is stored and never read · **high**

`campaign.model.ts:23` holds it, the controller accepts it
(`campaign.controller.ts:51`), the form offers it — and nothing anywhere queries it. A
campaign scheduled for 9am tomorrow simply never sends, with no error and no clue.

**Fix.** Either a repeatable BullMQ job that sweeps due campaigns and enqueues them, or
a delayed job created at schedule time. The sweep is safer: it survives a restart
between scheduling and firing. Until it exists, hide the field.

### B2 — A campaign never reaches `completed` · **medium**

`'completed'` is in `CAMPAIGN_STATUSES` (`campaign.model.ts:9`) and nothing ever sets
it. Every finished campaign reads "running" forever.

**Fix.** When `stats.sent + stats.failed === stats.total`, move it to `completed` and
stamp a finish time.

### B3 — Delivery status never reaches campaign stats · **high**

The worker stores the Meta message id on `CampaignMessage.twilioSid`, but the status
webhook only updates `MessageModel`. So "sent" means "Meta accepted it", and a message
that later fails, or is delivered and read, never changes. Campaign reporting is
therefore accepted-count reporting.

**Fix.** In the statuses loop, update `CampaignMessage` by the same id, add
`delivered` / `read` / `failed` to its status enum, and count them in `stats`.

### B4 — Campaign sends are invisible in the inbox · **high**

The worker writes only to `CampaignMessage`. The chat thread has no record, so when the
contact replies to a campaign the agent sees a bare answer with no idea what prompted
it. It also means `lastInboundAt` / service-window tracking never sees campaign
traffic.

**Fix.** Write a `Message` row on the chat as well, flagged as campaign-originated, the
way auto-responses are flagged.

### B5 — Send rate is hardcoded at 30/minute · **medium**

`campaign.worker.ts:293`. A 10,000-contact campaign takes five and a half hours. Meta's
own throughput is far higher and varies with the number's quality tier and messaging
limit.

**Fix.** Make it configurable per workspace, default higher, and back off on Meta's
rate-limit errors rather than pacing for the worst case.

### B6 — `resumeCampaign` skips the preflight · **low**

`campaign.service.ts` re-enqueues without calling `assertCampaignCanStart`. A campaign
paused because the token expired can be resumed straight into a wall of failures.

---

## C. Templates

Submit, sync and delete against Meta all work. The gaps are in what can be expressed
and one real bug.

### C1 — Editing a template leaves the old Meta ID behind · **high (bug)**

`modules/template/template.controller.ts:68` sets `setDoc.metaTemplateId = undefined`
to clear it. Mongoose strips `undefined` from an update, so the field is not cleared —
the row keeps pointing at the old Meta template while its status resets to `local`.
Resubmitting then creates a *second* template on Meta, and the local row's id is stale.

**Fix.** `$unset` it, the way `imageUrl` is handled a few lines below.

### C2 — Only body plus an optional image header · **high**

`submitMetaTemplate` (`modules/meta/meta.service.ts:282`) builds `HEADER` (image only)
and `BODY`. No buttons, no footer, no text/video/document header, no limited-time offer
or carousel. Quick-reply and call-to-action buttons are what most real campaign
templates need, so this is the biggest functional gap in the feature.

**Fix.** Extend the builder and the form to cover footer, header variants, and the two
button types first.

### C3 — Variables are limited to `name`, `phone`, `email` · **medium**

`template.service.ts:7`. Anything else an operator wants to merge — order number,
appointment time, amount — cannot be expressed.

**Fix.** Arbitrary named variables with per-send values, which also needs a place in
the campaign UI to supply them.

### C4 — No validation on template update · **low**

`template.validation.ts:16` is `z.object({}).passthrough()`. Every other route is
validated; this one accepts anything.

### C5 — Approval status only updates when someone presses Sync · **medium**

Meta sends `message_template_status_update` webhooks. We do not subscribe, so a
template approved overnight shows as pending until a human clicks the button — and a
campaign preflight will refuse to start on that stale status.

**Fix.** Subscribe to the field and update on the webhook; keep the button as a manual
reconcile.

---

## D. Meta app review / Tech Provider readiness

**Not ready to submit.** One blocker, then a handful of smaller items.

### D1 — No Embedded Signup · **blocker**

Onboarding today is manual: each client pastes an access token, WABA ID and phone
number ID into Settings (`meta-whatsapp-config.model.ts`). Meta expects Tech Providers
to onboard customers through Embedded Signup, and as of April 2026 it is the default
path for all new WhatsApp Business API onboarding. Advanced access for
`whatsapp_business_management` and `whatsapp_business_messaging` is granted against
that flow.

This is the largest single piece of work in this document: a Facebook Login flow, code
exchange, subscribing the app to the customer's WABA, and session logging.

Note for whenever it is built: Embedded Signup v2 and v3 are deprecated on
15 October 2026, so build against v4.

### D2 — Already in place

- Public privacy policy, terms and data deletion pages, reachable without login and
  returning 200 (required, and previously a review failure).
- Per-tenant webhook with `X-Hub-Signature-256` verification.
- Credentials encrypted at rest.

### D3 — Still needed for the submission itself

- App Review request for Advanced access on the two WhatsApp permissions.
- A screencast walking through the whole flow, which has to show Embedded Signup.
- `message_template_status_update` subscription (C5) — reviewers look for the
  integration using the webhooks it asks permission for.

---

## Suggested order

1. **A2** — capture Meta's pricing object. Cheap, and everything else in A depends on it.
2. **A5, A1** — stop sending for free after zero balance; stop charging for free messages.
3. **B1, B3, B2** — scheduled campaigns that never fire, then real delivery stats.
4. **C1** — the duplicate-template bug.
5. **A3, A4** — rate card and the usage view that replaces credits.
6. **B4** — campaign messages in the inbox.
7. **C2** — buttons and footer in the template builder.
8. **D1** — Embedded Signup, ahead of any Tech Provider submission.
