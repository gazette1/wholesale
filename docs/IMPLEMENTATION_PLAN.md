# Implementation plan

Status as of 2026-09-21. Items marked done exist in the repo and pass typecheck, tests, and the production build.

## MVP: daily lead operations

| Item | Status | Notes |
|---|---|---|
| Monorepo, engine port with golden tests | done | 44 tests against the workbook's cached values |
| Schema, migrations, RLS, seed | done | Applied to Supabase project `wholesale`. Seed runs on PGlite locally |
| Auth with roles | done | Supabase Auth, magic link and password, profiles claimed by email. Dev login for local work |
| Leads: create, table with filters and saved views, detail with tabs, activity log, tasks, tags, notes | done | Document uploads arrived with the Phase 2 skeleton |
| Pipeline kanban with drag and drop | done | |
| Messaging: one to one SMS and email, templates, consent, inbound webhook, status webhook, timeline | done | Mock adapters until keys arrive |
| Property report with provider interface, mock and RealEstateAPI adapters, comps, raw data for admins | done | Field mapping to verify against live responses |
| Deal analyzer: editor on the engine, versions, status, compare, sensitivity, cash flow chart, rehab checklist | done | |
| Buyers directory, buy box, matching with reasons, submissions | done | |
| Deal package PDF, preview, share link | done | Photos render when property photos have URLs |
| Dashboard | done | |
| Campaigns: segments, steps, enrollment, dispatcher, cron endpoint | done | Ahead of the original Phase 2 plan |
| Settings: team, pipeline stages, tags, sources, branding, integration status, audit log | done | |
| README, CI, integration docs | done | |

## Waiting on Russ

These remaining items need credentials, approval, external services, desktop tooling, or the Mac app's Swift source. Local verification is recorded below.

1. **Supabase database credentials.** Get `DATABASE_URL` and the service role key from Supabase, Project Settings, Database, for project `wholesale` (ref `auswzhwjtkwuvvdizmqq`). Put them in `apps/web/.env.local`. Then run `pnpm --filter @dealcalc/db seed` once and remove `DEV_AUTH_EMAIL`.
2. **Apply the pending migrations to Supabase.** Four files have run only on the local PGlite database: `0005_calls_and_enrichment_budget.sql`, `0006_rls_calls_enrichment.sql`, `0007_alerts_scoring_and_match_models.sql`, `0008_rls_alerts_scoring.sql`. Apply them in that order. The two with `rls` in the name are Supabase only and are skipped on PGlite, so they have never run anywhere; read them before applying.
3. **Twilio.** Create the account, buy one number, set the SMS and status webhooks as in `docs/INTEGRATIONS.md`, set the voice env vars, and create the TwiML app. Then place one live test call, because the voice code in `apps/web/lib/services/voice.ts` and `packages/integrations/src/voice/` has never run against Twilio. Separately, decide whether to add `@twilio/voice-sdk` for the browser softphone; it is a dependency decision and the bridge call path works without it.
4. **RealEstateAPI.** Get the key, then check the field mapping against one real address (`packages/integrations/src/property-data/realestateapi.ts`). Get the real per call pricing and wire it into the adapter: `costCents` is recorded as 0 today, so the per lead cap and the monthly budget in `apps/web/lib/services/enrichment-budget.ts` cannot trigger on live data.
5. **Resend.** Verify a sending domain and set the key.
6. **TypeSafe.** Get the key, then check Jev's real scoring against the deterministic mock in `packages/integrations/src/judgment/mock.ts`. The thresholds (act above 0.9, suggest above 0.6, otherwise review) are already wired.
7. **Vercel production project.** Create one separate from the `wholesale-demo` Hobby project, set `CRON_SECRET`, and set every variable from the README table. Rotate the Vercel token that was pasted in chat on 2026-09-17; it still works and was never rotated.
8. **Git.** Decide how to commit today's uncommitted work on branch `mac-parity-and-integrations`, and merge PR 1 on github.com/gazette1/wholesale. The GitHub CLI is not installed on this machine, so the merge has to happen in the browser.
9. **Tauri desktop builds.** Install Rust (rustup) and, on Windows, the WiX toolset; `cargo --version` fails here, so `apps/desktop` is a scaffold only and no installer was produced. Generate signing keys with `pnpm --filter desktop tauri signer generate`, put the public key in `apps/desktop/src-tauri/tauri.conf.json`, set a release endpoint, and set the updater's `active` to true. The `.dmg` can only be built on macOS, so the partner's Mac produces that one. Build commands are in the README.
10. **Playwright in CI.** The local Edge suite is implemented. Adding it to `.github/workflows` still waits for Russ.
11. **Decisions that belong to Ous.** Approving the project model so it can replace the workbook's Flip P&L; the inferred rules list in `docs/MAC_PARITY.md` under "Inferred rules, verify against the Swift source"; the 34 workbook anomalies in `spec/ANOMALIES.md`; and which outside tools to connect first, which decides whether any native adapter is worth building.
12. **The Swift source from the iMac.** Zip `~/Desktop/projects/DealAnalyzer/Sources/` (the folder, not the DMG). The project model's cash flow, drawn balance interest, and projection rules were inferred from the reconstructed reference and should be checked against the source rule for rule.

## Phase 2: automation and reporting

Skeleton built 2026-09-21. "Working" means it runs end to end on the local database with mock providers. What is left is marked `TODO(phase2)` in the code; search for that string.

| Item | State | What is left |
|---|---|---|
| Document uploads on the lead page | Working: drag and drop, type and content checks, 25 MB limit, list, download, delete by uploader or admin | Property and buyer panels are implemented. Virus scanning remains a product decision. |
| Automatic enrichment with a per lead cap and a monthly budget | Working: settings tab, spend read from `property_reports.cost_cents`, runs on app and API lead creation (not CSV), skips are noted on the lead | The RealEstateAPI adapter records a cost of 0, so the caps cannot trigger on live data until real pricing is wired in. Manual report runs use the budget check. The check is not atomic |
| Reporting page `/reports` | Working: speed to contact by user, conversion by source, cost per contract, offers to contracts, range selector | Stage history, accepted dates, fell-out counts, CSV export, market analytics, and matching lead date filters are implemented. |
| Saved views, per user and shared | Working on the leads table: save, share, delete, built in views kept | Column picker, rename and overwrite, and buyer saved views are implemented. |
| Bulk actions on the leads table | Working: assign, tag, enroll, with the same consent checks as single enroll, 200 per call | Filtered select-all, shift selection, and moving open tasks are implemented. |
| Twilio voice with call logging | Working with the mock: `calls` table, Calls tab, outcome form, bridge call, TwiML, status webhook, access token route | Not yet run against Twilio. The browser softphone needs the `@twilio/voice-sdk` dependency. Recording and consent decision. Inbound calls |
| Tauri wrapper producing `.dmg` and `.msi` with auto update | Scaffold with installed JavaScript dependencies | Rust, platform builds, signing and release endpoint remain pending |
| Playwright tests for lead create, stage move, send SMS, analyzer save | Implemented locally on Edge | CI integration needs approval |

Migrations 0005 through 0008 are in the repo. Local PGlite applies 0005 and 0007; the RLS migrations 0006 and 0008 are Supabase-only and have not run. They are not applied to the Supabase project yet.

The deferred Mac app features have their own skeleton, the project model. See "Project model" in `docs/MAC_PARITY.md`.

## Phase 3: buyer matching and analytics

| Item | State | What is left |
|---|---|---|
| Weighted buyer matching | Implemented with defaults and learned weights | Real submission history is needed to assess learned ranking |
| Send to matched buyers with tracked links | Implemented with per-buyer tokens and PDF downloads | Live email provider verification |
| Comps workspace | Implemented with manual comps, adjustments, ARV and confidence | RealEstateAPI field mapping and pricing |
| Market analytics | Implemented by county and ZIP | Verification on production data |
| Alerts | Implemented for untouched leads, overdue follow ups and expiring offers | Production scheduler setup |
| Lead scoring and review queue | Implemented with the mock and confidence thresholds | TypeSafe credentials and live scoring validation |

The project model remains a preview. Hosted migrations, deployment, provider calls, desktop builds, and CI changes are outside this local verification pass.

## Local verification completed 2026-09-21

- Installed dependencies with the repository-pinned pnpm 10.34.5. A subsequent frozen-lockfile install passed.
- Unit tests passed: engine 135, database 8, integrations 70. Typecheck passed across the workspace.
- The production web build passed after moving client-safe saved-view constants out of the database query module.
- Four Edge browser scenarios passed on isolated PGlite data and mock providers: lead creation, stage movement, SMS, offer expiry and acceptance alerts, analyzer persistence; public/tracked package HTML and PDF, expired links and matched-buyer sends; saved columns, filtered bulk selection, shift selection and view rename; dashboard, pipeline, reports, market analytics, alerts, review, enrichment settings, calls, documents, property reports, comps, analyzer and buyer matching.
- Property and buyer document upload/download and manual comp persistence passed. Public and tracked PDF text excludes contract price, spread, MAO and assignment fee; the generated PDF layout was inspected. The buyer email template contains the address and tracked URL only.
- Fixed the handoff gaps, saved date filters, shift-click state replay, selection reset on filter changes, and tracked-token PDF downloads. Accepting an offer dismisses only that offer's expiry alerts.
- The browser console check excludes the existing missing favicon request. No application console errors remained on the tested pages.
- No hosted migrations, deployment, live provider calls, CI changes, Git commits, push or merge were performed. The working tree remains available for review and the commit plan in AGENTS.md.
