# Integrations

Every outside service sits behind an interface in `packages/integrations`. Each has one real adapter and one mock. The mock is selected whenever the key is missing, so the app runs with an empty `.env.local`. Settings, Integrations in the app shows which adapter is live.

## Property data: RealEstateAPI

Interface `PropertyDataProvider` with `lookup(address)` and `comps(address)`. The adapter in `src/property-data/realestateapi.ts` calls `PropertyDetail` and `PropertyComps` on `https://api.realestateapi.com/v2` with the `x-api-key` header.

What to check when the key arrives:

1. Set `PROPERTY_DATA_PROVIDER=realestateapi` and `REALESTATEAPI_KEY`.
2. Open any lead, Property report tab, Pull report. The raw response is stored in `property_reports.raw` and shown to admins at the bottom of the full report page.
3. Compare the raw field names against the mapping in the adapter. Every field is optional and read defensively, so a renamed field shows as blank rather than breaking the page. Fix the names in one place and re pull.
4. The adapter records `costCents` as 0 until the account's per call pricing is known. Fill it in so the report shows spend.

Where it is used: lead creation (optional auto pull), lead Property report tab, full report page, analyzer defaults (ARV, AVM, payoff, taxes, rent estimate), deal packages.

## SMS: Twilio

Interface `SmsProvider`. The adapter posts to the Messages endpoint with basic auth and validates webhooks with the X-Twilio-Signature HMAC. No SDK.

Setup:

1. `MESSAGING_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`.
2. Each team member can have their own number under Settings, Team (twilio number). Sends from that number when set.
3. Number configuration: "A message comes in" webhook to `https://<app>/api/webhooks/twilio/sms`, HTTP POST. Status callbacks are attached per send when `APP_URL` is set.
4. `APP_URL` must be the exact public origin, because the signature check hashes the full URL.

Compliance built in: STOP, UNSUBSCRIBE, CANCEL, END, QUIT set the contact to opted out and stop every sequence. START and YES opt back in. HELP gets a fixed reply. Every send stores the consent state at send time on the message row. Sending to an opted out or do not contact number is refused before the provider is called.

## Email: Resend

Interface `EmailProvider`. Posts to `https://api.resend.com/emails`. `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` (a verified domain sender). Delivery events arrive at `/api/webhooks/resend`; set `RESEND_WEBHOOK_SECRET` from the dashboard so the Svix signature verifies.

## Judgment: TypeSafe Jev

Interface `JudgmentProvider` with `ask(state, questions)`. Questions are either a `choice` over fixed options or a `noul` probability. The adapter posts to `{TYPESAFE_BASE_URL}/systemone` with `model: jev-latest` and retries 429 and 529.

Why Jev instead of a general LLM: the CRM needs a classification or a probability, not prose. Jev returns calibrated confidence, so the app can act only above 0.9, suggest between 0.6 and 0.9, and leave the rest for a human. Nothing Jev returns ever reaches the deal math.

Where it runs:

| Use | Function | Effect |
|---|---|---|
| Inbound reply | `classifyReply` | Intent (interested, not interested, stop, wrong number, question, callback, price given, other) and urgency. Stored on the message and the activity. Amounts are extracted by a regex, not the model. |
| Call notes | `assessDistress` | Probability per deal thesis signal. Strong signals are posted as a suggestion on the lead timeline. The checklist is never auto flagged. |
| Buyer notes | `inferBuyerCriteria` | Funding type, sight unseen, condition range as a suggestion on the buyer page. |

Setup: `JUDGMENT_PROVIDER=typesafe`, `TYPESAFE_API_KEY`. The response parser accepts several field spellings; after the first live call, look at `messages.payload.classification` and tighten the schema in `src/judgment/typesafe.ts`.

## File storage

Supabase storage bucket `crm-files` (created by the RLS migration) when `SUPABASE_SERVICE_ROLE_KEY` is set, otherwise `.storage/` on disk served through `/api/files/`. Paths are prefixed by org id and the storage policies enforce it.

## Sequences and the scheduler

`campaign_enrollments.next_send_at` is the queue. `GET /api/cron/dispatch` with `Authorization: Bearer $CRON_SECRET` sends everything due. `apps/web/vercel.json` schedules it every minute on Vercel. Anywhere else, any scheduler that can send an HTTP request works. The Campaigns page has a Send due steps now button for development.

## Connecting other software

A general layer for any lead source, dialer, form, spreadsheet, or automation tool (Zapier, Make, n8n, a script). It has three parts, all managed by an admin under Settings, Integrations:

1. An inbound REST API under `/api/v1`, authenticated with API keys.
2. Outbound webhooks: a signed JSON POST on CRM events.
3. CSV import and export.

Code: `apps/web/lib/services/integrations.ts` (keys, delivery), `apps/web/lib/services/lead-intake.ts` (shared lead creation), `apps/web/lib/services/api-auth.ts` (key check, rate limit), `apps/web/app/api/v1/*`, `apps/web/app/api/export/[entity]/route.ts`, `apps/web/lib/actions/integrations.ts`. Pure helpers with tests: `packages/integrations/src/webhooks/` (CSV, signature, events and URL policy, payload parsing).

### API keys

Create a key under Settings, Integrations, API keys. The key looks like `dc_live_` plus 32 characters and is shown once. Only its SHA-256 hash is stored (`api_keys.key_hash`), so a lost key cannot be recovered; revoke it and create another. Give each tool its own key. A key can carry a default lead source that is applied when the sender does not name one.

Send the key on every request in one of two headers:

```
Authorization: Bearer dc_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
X-Api-Key: dc_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### GET /api/v1/ping

Checks a key. Response `200 { "ok": true, "org": "<workspace name>" }`. A missing, unknown, or revoked key returns `401 { "ok": false, "error": "..." }`.

### POST /api/v1/leads

Body: one lead object, an array of lead objects, or `{ "leads": [ ... ] }`. At most 200 leads and 2 MB per request. JSON is expected; `application/x-www-form-urlencoded` is also accepted for a single lead.

Field names are matched without regard to case, underscores, spaces, or dashes, so `firstName`, `first_name`, and `First Name` are the same field. One level of nesting is flattened, so `{ "property": {...}, "contact": {...} }` works.

| Field | Accepted names | Notes |
|---|---|---|
| address | `addressLine1`, `address`, `street`, `property_address` | Required. A single line such as `123 Main St, Baltimore, MD 21201` is split when city, state, and zip are absent. |
| unit | `addressLine2`, `address2`, `unit`, `apt` | |
| city | `city` | Required |
| state | `state` | Required. Two letter code or full state name. |
| zip | `postalCode`, `zip`, `zip_code` | Required. 5 digits or ZIP+4. A 4 digit value is padded with a leading zero. |
| name | `firstName`, `lastName`, or `name` | `name` is split on the first space. |
| phone | `phone`, `mobile`, `cell` | |
| email | `email` | Must be a valid address when present. |
| asking price | `askingPrice`, `asking_price`, `price` | Number. `$` and commas are ignored. |
| source | `source`, `lead_source` | Falls back to the key default, then to `API`. The lead source is created when it does not exist. |
| notes | `notes`, `comments`, `message` | Saved on the property and as a note on the lead. |
| urgency | `urgency` | `none`, `low`, `medium`, `high`, `immediate`. Anything else is stored as `none`. |
| property facts | `beds`, `baths`, `sqft`, `yearBuilt`, `propertyType` | |
| external id | `externalId`, `external_id`, `id` | Echoed in the response and stored on the creation activity. |

Behavior for each lead:

- The property is matched inside the workspace by normalized street address (case, punctuation, and common suffixes such as Street and St are ignored), unit, and 5 digit ZIP. A new property is created when none matches.
- If the property already has an open lead, no second lead is created. A note is added to the existing lead and the result carries `"duplicate": true` with that lead id.
- Otherwise a contact (reused when the phone or email matches a contact already linked to the property), a lead in the first open pipeline stage, a creation activity, a note activity when notes were sent, and a First call task are created. API leads are unassigned.
- SMS consent is always `unknown`. Consent is never inferred from an API call or an import. Record consent in the CRM after the seller gives it.
- `lead.created` is emitted for each new lead.

Response:

```json
{
  "ok": true,
  "created": 1,
  "duplicates": 1,
  "errors": 1,
  "results": [
    { "index": 0, "leadId": "uuid", "propertyId": "uuid", "duplicate": false, "externalId": "row-1" },
    { "index": 1, "leadId": "uuid", "propertyId": "uuid", "duplicate": true },
    { "index": 2, "leadId": null, "propertyId": null, "duplicate": false, "error": "postalCode is required" }
  ]
}
```

| Status | Meaning |
|---|---|
| 201 | At least one lead was created. Items that failed carry their own `error`. |
| 200 | Nothing was created and at least one item was a duplicate. |
| 422 | Every item failed validation. `ok` is false and each result has an `error`. |
| 400 | The body could not be parsed, or `leads` is not an array. |
| 401 | Missing, unknown, or revoked key. |
| 413 | More than 200 leads, or a body over 2 MB. |
| 429 | Rate limit. See `Retry-After`. |

`ok` is true when at least one item was accepted (created or duplicate).

### GET /api/v1/leads

For polling triggers. Most recently updated first.

| Query | Meaning |
|---|---|
| `updatedSince` | ISO 8601 timestamp. Only leads updated at or after it. |
| `limit` | 1 to 200, default 100. |
| `cursor` | The `nextCursor` value from the previous page. |

Response `200 { "ok": true, "count": n, "leads": [ ... ], "nextCursor": "..." | null }`. Each lead has `id`, `status`, `stage { key, name }`, `address { line1, line2, city, state, postalCode }`, `propertyId`, `contact { id, firstName, lastName, phone, email, smsConsent, doNotContact } | null`, `askingPrice`, `urgency`, `source`, `createdAt`, `updatedAt`, `stageEnteredAt`, `nextFollowUpAt`, `lastContactAt`.

`updatedAt` is maintained by the database trigger from migration `0001`. That trigger is installed on Postgres only, so on the local PGlite demo database `updatedAt` stays equal to `createdAt` and `updatedSince` behaves as "created since".

### Limits

- 120 requests per minute per key, fixed window, `429` with `Retry-After` and `X-RateLimit-*` headers. The counter lives in process memory, so it is per server instance. On serverless hosting the effective ceiling is higher. It stops runaway loops; it is not a security control.
- 30 failed key attempts per minute per client address.
- 200 leads and 2 MB per POST.
- CSV: 2 MB and 2,000 data rows per file.
- Webhook delivery timeout: 5 seconds. No automatic retry.

### Outbound webhooks

Add an endpoint under Settings, Integrations, Webhooks: a name, an `https` URL, and the events to receive. An endpoint with no events selected (or all of them) receives every event, including events added in later versions. Send test posts a `ping` event to that endpoint only and shows the status. The last 10 deliveries are listed per endpoint, and every attempt is stored in `webhook_deliveries`.

Each delivery is one POST with this body:

```json
{ "id": "uuid of this delivery", "event": "lead.created", "createdAt": "2026-01-31T15:04:05.000Z", "orgId": "uuid", "data": { } }
```

Headers:

| Header | Value |
|---|---|
| `X-DealCalc-Event` | The event name |
| `X-DealCalc-Delivery` | Same as `id` in the body. Use it to ignore repeats. |
| `X-DealCalc-Timestamp` | Unix time in seconds when the request was signed |
| `X-DealCalc-Signature` | `sha256=` plus the hex HMAC-SHA256 of `{timestamp}.{raw body}` keyed with the endpoint signing secret |

Any 2xx response within 5 seconds counts as delivered. Redirects are not followed. Anything else is a failure: `failure_count` goes up by one, a success resets it to 0, and after 10 failures in a row the endpoint is paused (`active = false`). Resume it in Settings after the receiver is fixed; resuming clears the count. Deliveries run after the user action has responded (Next.js `after`), never throw into the action that triggered them, and are not retried. If a missed event matters, poll `GET /api/v1/leads` as a backstop.

Events and the `data` object of each:

| Event | Sent when | `data` |
|---|---|---|
| `lead.created` | A lead is created in the app, through the API, or by CSV import | `leadId`, `propertyId`, `via` (`app`, `api`, `csv`), `externalId`, `address { line1, line2, city, state, postalCode }`, `contact { id, firstName, lastName, phone, email }` or null, `askingPrice`, `urgency`, `source` (name; null for app leads, which carry `sourceId`), `stage { key, name }` |
| `lead.stage_changed` | A lead moves to another pipeline stage, including automatic moves after an offer | `leadId`, `propertyId`, `status`, `from { key, name }`, `to { key, name }` |
| `lead.updated` | Reserved. Not sent yet. | |
| `offer.created` | An offer is recorded | `offerId`, `leadId`, `analysisId`, `amount`, `type`, `status` |
| `offer.status_changed` | An offer is accepted, rejected, countered, or expired | `offerId`, `leadId`, `amount`, `from`, `to`, `counterAmount` |
| `analysis.saved` | A deal analysis is saved | `analysisId`, `leadId`, `propertyId`, `version`, `name`, `arv`, `purchasePrice`, `maxAllowableOffer`, `spread`, `netProfit`, `strategy` |
| `analysis.status_changed` | An analysis changes review status | `analysisId`, `propertyId`, `leadId`, `version`, `from`, `to` |
| `message.received` | An inbound SMS is matched to a contact | `channel`, `leadId`, `contactId`, `from`, `to`, `body`, `keyword` (`stop`, `start`, `help`, or null), `intent`, `confidence`, `urgency` (from the judgment provider when available) |
| `buyer.created` | A buyer is created in the app or by CSV import | `buyerId`, `firstName`, `lastName`, `company`, `phone`, `email`, `source`, `via` |
| `package.created` | A deal package is generated | `packageId`, `analysisId`, `propertyId`, `leadId`, `version`, `expiresAt` |
| `ping` | Send test is pressed | `message`, `endpointId`, `endpointName` |

A CSV import that creates more than 100 records does not send per record events, so a large file cannot flood a receiver. The import result says so when that happens.

### Verifying the signature

Compute the HMAC over the exact bytes received, before any JSON parsing, and compare in constant time. Reject timestamps more than 5 minutes from the current time to limit replay.

```js
const crypto = require("node:crypto");

function verifyDealCalcWebhook(headers, rawBody, secret) {
  const timestamp = headers["x-dealcalc-timestamp"];
  const given = String(headers["x-dealcalc-signature"] || "").replace("sha256=", "");
  const expected = crypto.createHmac("sha256", secret).update(timestamp + "." + rawBody).digest("hex");
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return fresh && a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

Inside this repo the same logic is `signPayload` and `verifySignature` in `@dealcalc/integrations`. The signing secret is shown (hidden until revealed) on each endpoint in Settings and can be rotated there. Zapier and Make catch hooks do not verify signatures; the secrecy of the hook URL is their protection, so treat that URL as a secret.

### Zapier and Make

- Into the CRM, Zapier: action Webhooks by Zapier, event POST. URL `https://<your app>/api/v1/leads`, payload type json, map fields under Data, add the header `Authorization` with the value `Bearer <key>`.
- Out of the CRM, Zapier: trigger Webhooks by Zapier, event Catch Hook. Paste the hook URL as a new webhook endpoint in Settings, choose the events, then press Send test so Zapier has a sample to map.
- Polling, Zapier: trigger Webhooks by Zapier, event Retrieve Poll. URL `https://<your app>/api/v1/leads`, key `leads`, header `X-Api-Key`. Zapier removes repeats by the `id` field.
- Make: the HTTP module, Make a request, for inbound leads with the same URL and header. For outbound, create a Custom webhook in Make and paste its URL as a webhook endpoint.

### CSV import and export

Import (admin only, Settings, Integrations, Import and export). Columns are matched by header name with the same aliases as the API, in any order. Quoted fields, embedded commas and line breaks, CRLF, and a UTF-8 byte order mark are handled. Templates: `/api/export/leads-template.csv` and `/api/export/buyers-template.csv`.

| File | Required columns | Optional columns |
|---|---|---|
| Leads | `address`, `city`, `state`, `zip` | `first_name`, `last_name` or `name`, `phone`, `email`, `asking_price`, `source`, `urgency`, `beds`, `baths`, `sqft`, `year_built`, `property_type`, `notes`, `external_id` |
| Buyers | one of `first_name`, `name`, `company` | `last_name`, `phone`, `email`, `website`, `states` (for example `MD, PA`), `source`, `notes` |

Lead rows go through the same intake as the API: property matching, duplicate handling, and SMS consent `unknown`. Imported leads are assigned to the admin who ran the import and do not get a First call task. Rows without a source get the source typed on the form, or `CSV import`. A buyer row is a duplicate when its email or phone already belongs to a buyer in the workspace. The result shows counts of created, duplicates, and errors, with the first 10 error messages by row number. Each import writes one audit row with the counts.

Export (any signed in role, including viewers): `GET /api/export/leads.csv`, `/api/export/buyers.csv`, `/api/export/analyses.csv`. These use the browser session, not an API key, and return `401` without one. Files are sent as attachments with a byte order mark so Excel reads UTF-8. Trashed analyses are left out. Each export is capped at 50,000 rows.

Formula injection: on export, any cell that begins with `=`, `+`, `-`, `@`, a tab, or a carriage return is prefixed with a single quote so a spreadsheet shows it as text. Plain negative numbers such as `-5000` are left as they are. A phone number stored as `+14105550000` exports as `'+14105550000`.

### Security notes

- API keys are stored as SHA-256 hashes and compared in constant time. Raw keys and webhook secrets are never logged and never written to the audit log. `key_hash` is never sent to the browser.
- Webhook signing secrets are stored in plain text in `webhook_endpoints.secret` because the server has to sign with them. Keys and secrets are loaded only for admins, and only on the Integrations tab.
- Webhook URLs must be `https`. `http://localhost` and `http://127.0.0.1` are allowed only when `NODE_ENV` is not `production`. In production, URLs whose host is `localhost`, `127.x`, `10.x`, `192.168.x`, `169.254.x`, `172.16` to `172.31`, an IPv6 loopback or private literal, or ends in `.internal` or `.local` are rejected, and redirects are not followed. This is a hostname check. It does not resolve DNS, so it does not stop a public name that points at a private address. Put the app behind egress filtering if that matters for the deployment.
- `/api/v1/*` is public in `apps/web/middleware.ts` because the key is the authentication. Every query in those handlers is scoped to the org that owns the key.
- All key and webhook changes, and every import, write an audit row.
- The new tables have row level security enabled by migration `0003_rls_integrations.sql`.
