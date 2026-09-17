# Implementation plan

Status as of 2026-09-17. Items marked done exist in the repo and pass typecheck, tests, and the production build.

## MVP: daily lead operations

| Item | Status | Notes |
|---|---|---|
| Monorepo, engine port with golden tests | done | 44 tests against the workbook's cached values |
| Schema, migrations, RLS, seed | done | Applied to Supabase project `wholesale`. Seed runs on PGlite locally |
| Auth with roles | done | Supabase Auth, magic link and password, profiles claimed by email. Dev login for local work |
| Leads: create, table with filters and saved views, detail with tabs, activity log, tasks, tags, notes | done | Document upload UI is not wired; storage boundary and table exist |
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

## Connect when keys arrive

1. `DATABASE_URL` from Supabase, Project Settings, Database. Then `pnpm --filter @dealcalc/db seed` once, and remove `DEV_AUTH_EMAIL`.
2. Twilio account, one number, webhook URLs as in `docs/INTEGRATIONS.md`.
3. Resend domain and key.
4. RealEstateAPI key, then verify the field mapping on one real address.
5. TypeSafe key.
6. Vercel project with `CRON_SECRET`.

## Phase 2: automation and reporting

- Document uploads on the lead page (drag and drop to the storage boundary, list, delete).
- Automatic enrichment on lead creation with a per lead cost cap and a monthly budget.
- Reporting page: speed to contact by user, conversion by source, cost per contract, offers to contracts.
- Saved views stored per user and shared views for the team (table exists).
- Tauri wrapper producing `.dmg` and `.msi` with auto update.
- Playwright tests for lead create, stage move, send SMS, analyzer save.
- Bulk actions on the leads table (assign, tag, enroll).
- Twilio voice: click to call through the browser with call logging.

## Phase 3: buyer matching and analytics

- Weighted match scoring learned from past submissions and responses.
- One click send of a package to every matched buyer with tracked links.
- Comps tool with adjustments and ARV confidence, fed by RealEstateAPI comps.
- Market analytics by county and ZIP: lead volume, offer acceptance, average spread.
- Alerts: lead untouched for 15 minutes, follow up overdue, offer expiring.
- Jev based lead scoring from every touch, with a review queue for low confidence outcomes.
