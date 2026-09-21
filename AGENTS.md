# Handoff for the production build

## Local verification follow-up, 2026-09-21

The development and local verification pass is complete. See `docs/IMPLEMENTATION_PLAN.md`, "Local verification completed 2026-09-21", for current results. The handoff below remains a record of the earlier state; its missing-code and unverified-browser notes are superseded by that verification section. The four listed wiring gaps, saved-view client import build failure, shift selection, and tracked-link PDF downloads are fixed. Dependencies and lockfile are updated. The four-scenario Edge suite exists and passes separately from `pnpm test`. Unit tests pass at engine 135, db 8, integrations 70; typecheck and the web build pass. Production work and the section 7 commit plan remain pending; changes are uncommitted.


Written 2026-09-21, 14:20 EDT, for the agent taking this repo to production. Codex reads this file on its own. Read it fully before changing anything. The authoritative docs are `README.md`, `docs/IMPLEMENTATION_PLAN.md` (status tables and the "Waiting on Russ" checklist), `docs/MAC_PARITY.md`, `docs/INTEGRATIONS.md`, `docs/CRM_ARCHITECTURE.md`, and `docs/DECISIONS.md`.

## 1. What this is

An acquisitions CRM with a deal analyzer for a residential wholesale and flip business. Owner: Russ Harris. Client and partner: Ous, not technical, works on a Mac. Two deliverables matter now: a demo Ous can click through, and a downloadable desktop app (a Tauri wrapper around the deployed web app) for Windows and Mac.

## 2. State of the working tree

- Branch `mac-parity-and-integrations`. Remote `origin` is `git@github.com:gazette1/wholesale.git`. PR 1 against `main` is open and not merged. Today's Phase 2, Phase 3, project model, desktop scaffold, and Playwright work was committed on this branch on 2026-09-21 (see `git log`).
- Verified on 2026-09-21 at about 15:35 EDT, after the local verification pass: `pnpm install --frozen-lockfile` passes; `pnpm test` passes (engine 135, db 8, integrations 70); `pnpm typecheck` is clean in all four packages; `pnpm --filter web build` passes; `pnpm --filter web test:e2e` passes 4 of 4 scenarios in installed Edge on an isolated PGlite folder and mock providers.
- The local verification pass is recorded in `docs/IMPLEMENTATION_PLAN.md` under "Local verification completed 2026-09-21". Hosted state (Supabase migrations, Vercel deploys) is recorded in section 8 below as it happens.

## 3. Repo map

| Path | Contents |
|---|---|
| `apps/web` | Next.js 15 App Router. Every screen, server action, webhook, PDF renderer. No math outside the engine. |
| `apps/web/app/(app)/*` | Signed in pages: dashboard, pipeline, leads, tasks, reports, analyzer, buyers, campaigns, templates, settings, alerts, review, properties. |
| `apps/web/app/api/*` | `cron/dispatch`, `export/[entity]`, `files/[...path]`, `health`, `packages/[id]/pdf`, `v1/*` (inbound REST), `voice/token`, `webhooks/{resend,twilio/sms,twilio/status,twilio/voice,twilio/voice-status}`. |
| `apps/web/lib/actions` | Server actions. Pattern: `requireSession`, `requireCan`, `isUuid`, org scoped queries, `audit`, `revalidatePath`, return `ActionResult`, errors through `friendlyError`. |
| `apps/web/lib/data` | Read queries. `apps/web/lib/services`: multi step operations (messaging, campaigns, enrichment, voice, alerts, lead scoring, intake). |
| `apps/web/lib/auth.ts`, `safe.ts`, `audit.ts` | Session and roles, input guards, audit log. |
| `apps/desktop` | Tauri 2 scaffold. `src-tauri/tauri.conf.json`, `src-tauri/src/main.rs` (reads `DEALCALC_APP_URL` at compile time), `shell/` frontend folder. Never built: Rust is not installed on this machine. |
| `packages/engine` | Pure TypeScript calculators ported from the workbook, golden tests against `spec/golden`. `src/project/` is the opt in second model. |
| `packages/db` | Drizzle schema in `src/schema`, SQL in `migrations`, embedded copy in `src/migrations.generated.ts`, seed, PGlite fallback. |
| `packages/integrations` | Provider boundaries with mock adapters: `property-data`, `messaging`, `voice`, `judgment`, `storage`, `webhooks`. All env access is in `src/env.ts`. |
| `spec/` | Workbook extraction and golden fixtures. NEVER hand edit. |
| `docs/` | Architecture, decisions, plan, parity, integrations. |

## 4. What was built on 2026-09-21

Engine (`packages/engine`)
- `src/project/*` and `tests/projectModel.test.ts`: the project model for the deferred Mac app features (multi loan financing, fee bases, monthly holding lines, weekly project cash flow, drawn balance interest, 20 year projection). Opt in through `DealInput.project`, labeled preview, version `0.2.0-preview`. A test asserts every workbook output is identical with it on and off. 18 rules were inferred and are listed in `docs/MAC_PARITY.md` under "Inferred rules, verify against the Swift source". `ENGINE_VERSION` stays 0.3.0.
- `src/compsArv.ts`, `src/matchLearning.ts` with tests. Wiring edits in `index.ts`, `runDeal.ts`, `schemas.ts`, `validate.ts`.

Database (`packages/db`)
- Schema edits in `_shared.ts`, `messaging.ts` (calls), `enrichment.ts` (enrichment_settings), `pipeline.ts` (offers.accepted_at, offers.expires_at, alerts, lead_scores), `buyers.ts` (buyer_match_models, deal_submissions token and open tracking).
- Migrations `0005_calls_and_enrichment_budget.sql`, `0006_rls_calls_enrichment.sql`, `0007_alerts_scoring_and_match_models.sql`, `0008_rls_alerts_scoring.sql`, plus `meta/0003_snapshot.json`, `meta/0004_snapshot.json`, `_journal.json`, `migrations.generated.ts`. Applied on local PGlite only. The two `rls` files have never run anywhere.

Integrations (`packages/integrations`)
- `src/voice/*` (mock and Twilio adapters, never run against Twilio), `judgment/uses.ts` (`scoreLead`, motivation scale helper), `webhooks/events.ts` (`alert.created`), `env.ts`, tests `voice.test.ts`, `leadScoring.test.ts`.

Web, Phase 2 (checked in a browser unless noted)
- Documents: `lib/actions/documents.ts`, `components/documents/*`, `leads/[id]/tabs/documents.tsx`, property and buyer document panels (the property and buyer panels are unverified in browser).
- Reports: `lib/data/reports.ts`, `lib/reports-math.ts`, `app/(app)/reports/*`, CSV in `app/api/export/[entity]/route.ts`. Stage history contracts, fell out column, market analytics tab: unverified in browser.
- Enrichment budget: `lib/services/enrichment-budget.ts`, `lib/actions/enrichment-settings.ts`, settings tab, call sites in `lib/actions/leads.ts` and `lib/services/lead-intake.ts`.
- Leads table: `leads/bulk-select.tsx`, `leads/saved-views.tsx`, `lib/actions/leads-bulk.ts`, `lib/actions/saved-views.ts`, `lib/data/saved-views.ts`. Column picker, select all matching, shift click, rename view: unverified in browser.
- Voice: `lib/services/voice.ts`, `lib/actions/calls.ts`, `lib/data/calls.ts`, `leads/[id]/tabs/calls.tsx`, three routes under `app/api`.
- Analyzer: `analyzer/[id]/project-section.tsx`, `project-outputs.tsx`, edits in `editor.tsx`, `outputs.tsx`.

Web, Phase 3 (all unverified in browser)
- Comps workspace: `properties/[id]/comps/*`, `lib/actions/comps.ts`, `lib/data/comps.ts`.
- Buyer matching: `lib/data/match-model.ts`, `lib/actions/buyers.ts` (`retrainMatchModel`, `sendToAllMatched`), `buyers/match/[analysisId]/page.tsx`, open tracking in `app/share/[token]/page.tsx`.
- Alerts: `lib/services/alerts.ts`, `lib/data/alerts.ts`, `lib/actions/alerts.ts`, `app/(app)/alerts/page.tsx`, cron pass in `app/api/cron/dispatch/route.ts`, bell in `components/shell/sidebar.tsx` and `app/(app)/layout.tsx`, expiry field in `leads/[id]/tabs/offers.tsx`.
- Lead scoring: `lib/services/lead-scoring.ts`, `lib/actions/lead-scores.ts`, `app/(app)/review/*`. `leads.motivationScore` is 1 to 10; `lead_scores.score` is 0 to 100; one helper converts. Do not write a 0 to 100 value into the lead column.

Security fixes made today: `app/api/files/[...path]/route.ts` rejects `.` and `..` segments; the documents query in `lib/data/leads.ts` is org scoped; server action body limit is `26mb` in `next.config.ts`.

## 5. Local checklist (complete)

Closed on 2026-09-21: install and lockfile, unit tests, typecheck, production build, the leads page merges (`filters` on `BulkSelectProvider`, column hiding from `sp.cols`), offer expiry saved by `createOffer`, accepting an offer dismisses that offer's expiry alerts, a browser pass over every Phase 2 and Phase 3 page, the buyer confidentiality check on public and tracked package HTML, PDF, and email, the Playwright suite (`apps/web/e2e`, `pnpm --filter web test:e2e`, kept out of `pnpm test`), and the plan and README updates.

Still open locally: Playwright is not in CI (`.github/workflows` changes wait for Russ), and the missing favicon request is a known console noise item.

## 6. Access and keys

No secret value is written in this file, on purpose. This file is tracked by git and the repo has a remote. Secrets live in one place on this machine: `apps/web/.env.local` (gitignored). Read them from there or ask Russ. Never print them, never commit them, never put them in a URL.

Present in `apps/web/.env.local` today (names only): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `DIRECT_URL`, `PROPERTY_DATA_PROVIDER`, `APP_URL`, `DEV_AUTH_EMAIL`, `VERCEL_OIDC_TOKEN`. Check whether `DATABASE_URL` and the service role key hold real values before relying on them; earlier notes said they were not obtained yet.

Not obtained yet (the app falls back to mock adapters without them): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_FROM_NUMBER`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_TWIML_APP_SID`, `VOICE_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`, `REALESTATEAPI_KEY`, `TYPESAFE_API_KEY`, `CRON_SECRET`, `MOCK_WEBHOOK_SECRET`. The full table with purposes is in `README.md` and `.env.example`.

Where each account lives
- GitHub: `github.com/gazette1/wholesale`. Push works over SSH with the key already on this machine (the branch was pushed from here this morning). No token is needed and none exists. The GitHub CLI is not installed; PRs are merged in the browser.
- Supabase: project `wholesale`, ref `auswzhwjtkwuvvdizmqq`, region us-west-2. Migrations are applied through the SQL editor or the Supabase MCP. Production data lives here; treat every statement as irreversible.
- Vercel: project `wholesale-demo` (Hobby, daily cron only), linked through `.vercel/` (gitignored). The Vercel token pasted in chat on 2026-09-17 still works and must be rotated before production. Create a separate production project; do not promote the demo project.
- Desktop signing keys: none exist. Generate with `pnpm --filter desktop tauri signer generate`. The private key never goes in the repo.

## 7. How to commit this work

Russ has not reviewed the diff, so keep commits readable. Commits are authored as Russ Harris (git config is already set). Do not force push, do not rewrite history, do not skip hooks.

1. `pnpm install` so `pnpm-lock.yaml` matches `apps/desktop/package.json`.
2. `git status` and confirm nothing under `spec/` changed and no `.env*`, `.pglite/`, `.storage/`, or `.vercel/` path is staged.
3. Suggested commit split, staging files by name:
   - Database: `packages/db/**` (schema, migrations 0005 to 0008, journal, snapshots, embedded migrations).
   - Engine project model: `packages/engine/src/project/**`, `tests/projectModel.test.ts`, `runDeal.ts`, `schemas.ts`, `validate.ts`, analyzer `project-*.tsx`, `editor.tsx`, `outputs.tsx`, `docs/MAC_PARITY.md`.
   - Engine comps and match learning: `compsArv.ts`, `matchLearning.ts`, their tests, `index.ts`.
   - Phase 2 web: documents, reports, enrichment budget, saved views, bulk actions, voice, `packages/integrations/src/voice/**`, `env.ts`, `.env.example`, `docs/INTEGRATIONS.md`.
   - Phase 3 web: comps workspace, buyer matching and tracked sends, alerts, lead scoring and review, `judgment/uses.ts`, `webhooks/events.ts`.
   - Desktop scaffold: `apps/desktop/**`, `.gitignore`, `pnpm-lock.yaml`, README desktop section.
   - Docs: `README.md`, `docs/IMPLEMENTATION_PLAN.md`, this file.
   If a clean split costs too much time, one commit per package is acceptable. A single commit is the last resort.
4. `git push origin mac-parity-and-integrations` updates PR 1. CI runs install with a frozen lockfile, typecheck, tests, and the web build.

## 8. Production checklist, in order

Hosted state on 2026-09-21 (about 15:30 EDT): today's work is committed in six commits and pushed to `mac-parity-and-integrations`, which updates PR 1. Migrations `0005` to `0008` are applied to the Supabase project `wholesale` through the Supabase MCP, as migrations `calls_and_enrichment_budget`, `rls_calls_enrichment`, `alerts_scoring_and_match_models`, `rls_alerts_scoring`. All five new tables have row level security on with a select and a write policy. The Supabase security advisor reports four warnings, all on functions from `0001` (`set_updated_at` has a mutable search_path; `current_org_id`, `current_profile`, `current_role_name` are SECURITY DEFINER and executable by `anon` and `authenticated` over `/rest/v1/rpc`); these predate today and are not fixed. The Vercel redeploy did NOT happen: the Vercel CLI on this machine is not logged in. Steps 1 and 3 below are done except the seed, which is not needed while the app runs on the demo.


1. Section 5, then section 7.
2. Merge PR 1 in the browser once CI is green.
3. Supabase: confirm `DATABASE_URL` and the service role key, apply migrations `0005`, `0006`, `0007`, `0008` in order (read the two `rls` files first; they have never executed), run `pnpm --filter @dealcalc/db seed` once only if the database is empty.
4. Vercel: new production project from `apps/web` (root directory `apps/web`, install `pnpm install`, build `pnpm build`), every variable from the README table, `CRON_SECRET` set, NO `DEV_AUTH_EMAIL`, NO `DEMO_MODE`. Supabase Auth site URL and redirect `https://<app>/login/callback`.
5. Providers as keys arrive: Twilio (SMS webhooks, then voice, then one live test call), Resend domain, RealEstateAPI (verify field mapping on one real address and wire real per call pricing, because `costCents` is recorded as 0 and the enrichment caps cannot trigger), TypeSafe. Details in `docs/INTEGRATIONS.md` and "Waiting on Russ".
6. Desktop: install Rust (rustup) and, on Windows, WiX. From the repo root: `DEALCALC_APP_URL=https://<production url> pnpm --filter desktop desktop:build` produces the `.msi`. The `.dmg` must be built on a Mac with the same command. Turn the updater on only after signing keys and a release endpoint exist.

## 9. Rules that hold for every change

- Golden fixtures and `spec/` never change. No feature may move a number the golden tests pin unless Ous decides it, recorded in `docs/DECISIONS.md` and `spec/ANOMALIES.md`.
- The project model stays a preview. The Flip P&L tab is the number of record until Ous approves.
- Every query is scoped by `orgId`. Route params pass `isUuid`. Forms submit through `useServerForm`, `ActionForm`, or `ActionButton`, not React's form `action` prop, except redirecting forms with `SubmitOnce`.
- Buyer facing output never shows contract price, spread, MAO, or assignment fee.
- Jev (TypeSafe) never touches deal math. Thresholds: act above 0.9 confidence, suggest above 0.6, otherwise human review.
- Schema changes: edit `packages/db/src/schema`, run `pnpm --filter @dealcalc/db generate`, rename the generated file to the next number in the folder, fix its `tag` in `migrations/meta/_journal.json`, run `pnpm --filter @dealcalc/db embed`, run the db tests. RLS goes in a hand written file with `rls` in its name.
- Writing rules for UI copy, comments, and docs: plain factual sentences, no em dashes, no exclamation points, no hype words. Financial documents use M for thousands and MM for millions; the UI shows plain dollar figures.
- Ask Russ before: adding a dependency, deploying, applying anything to Supabase, deleting data, or changing CI.
