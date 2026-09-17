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
