# Acquisitions CRM with Integrated Deal Analyzer

Proposal for architecture, database schema, route map, and phased build plan. This document supersedes the route map and deploy plan in `docs/ARCHITECTURE.md`. The engine design, precision policy, anomaly policy, and golden fixtures in that document and in `spec/` remain the basis for the analyzer math.

Audience: Russ and the build. Status: proposal, awaiting approval before any dependency is installed.

---

## 1. Product shape

One web application, installed as a desktop app on Mac and Windows, with one shared database. Six modules on one property centric data model:

| Module | Anchor record | What it does |
|---|---|---|
| Pipeline | `leads` | Kanban and table of seller leads through nine stages, activity log, tasks, tags, offers, documents |
| Property report | `property_reports` | Enrichment snapshot per property from a swappable provider, shown as a readable report |
| Messaging | `messages`, `campaigns` | One to one SMS and email, templates with merge fields, sequences, consent and opt out |
| Deal analyzer | `deal_analyses` | Versioned analyses per property using the pure engine, decision status, scenario comparison, sensitivity |
| Buyers | `buyers`, `buyer_criteria` | Investor directory with buy box, matching against a deal, submission history |
| Deal package | `deal_packages` | Investor facing PDF from an analysis, shareable link |

The operating loop the UI is built around: lead in, call fast, enrich, qualify, analyze, check buyers, send offer, contract and close, package to investors. Speed to contact and repeated follow up drive every list and dashboard default.

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Monorepo | pnpm workspaces | `apps/web`, `packages/engine`, `packages/db`, `packages/integrations` |
| Web | Next.js App Router, TypeScript strict, Tailwind | Server components for lists, server actions for writes, one deploy target |
| UI kit | shadcn/ui pattern (Radix primitives, local components), lucide icons | Professional, accessible, owned code rather than a themed dependency. `impeccable.style` and the `taste-skill` guidance are applied at the component and page level |
| Tables | TanStack Table | Sorting, filtering, column state for saved views |
| Kanban | dnd-kit | Keyboard and pointer drag between stage columns |
| Charts | Recharts | Dashboard and sensitivity charts |
| Validation | Zod | Every form, every server action input, every provider response at the adapter boundary |
| Database | PostgreSQL on Supabase | Managed Postgres, row level security, backups |
| ORM and migrations | Drizzle ORM and drizzle-kit | Typed schema in TypeScript, SQL migrations checked into `packages/db/migrations` |
| Auth | Supabase Auth behind an `AuthProvider` interface | Magic link and password, sessions in cookies, roles in a `profiles` table |
| Local dev and tests | PGlite (in process Postgres) | No Docker on this machine. Migrations and seed run against PGlite in tests; hosted Supabase for dev and production |
| SMS | Twilio behind `MessagingProvider` | Numbers, outbound, inbound webhook, status callbacks |
| Email | Resend behind the same `MessagingProvider` | Transactional email with webhooks; swappable |
| Property data | RealEstateAPI behind `PropertyDataProvider` | Property detail, owner, AVM, liens, sales history, tax, comps. A `MockPropertyDataProvider` ships with seed data so the app runs without a key |
| PDF | `@react-pdf/renderer` on the server | No headless browser; same React components render the package |
| Desktop | Tauri | Wraps the deployed web app into `.dmg` and `.msi`. Phase 2 packaging step, no code changes required |
| Jobs | Vercel Cron hitting `/api/cron/dispatch` each minute | Sends due campaign steps and scheduled follow ups. A `jobs` table makes this swappable for a queue later |
| Tests | Vitest for engine and services, Playwright for three critical flows in Phase 2 | |
| Hosting | Vercel plus Supabase | GitHub Actions runs test and build |

Service boundaries live in `packages/integrations/src/<boundary>/index.ts` as interfaces, with one real adapter and one mock adapter each: `property-data`, `messaging`, `pdf`, `auth`, `storage`.

## 3. Repo layout

```
apps/web/                  Next.js app. No math, no provider SDK imports outside packages/integrations.
packages/engine/           Pure calculators from spec/FORMULA_SPEC.md plus wholesale.ts and sensitivity.ts
packages/db/               Drizzle schema, migrations, seed, RLS policies, typed query helpers
packages/integrations/     Provider interfaces, real adapters, mock adapters
spec/                      Workbook extraction and golden fixtures (unchanged)
docs/                      This proposal, architecture, decisions, discovery call
tools/                     extract_workbook.py
```

## 4. Database schema

All tables carry `id uuid`, `org_id uuid`, `created_at`, `updated_at`. `org_id` is single valued today (Ous and Russ's company) and keeps a second operation possible later. Row level security scopes every table by `org_id` and by role.

### Identity and access

| Table | Columns |
|---|---|
| `orgs` | name, branding jsonb (logo url, colors, disclosure text) |
| `profiles` | user_id (auth), org_id, full_name, email, phone, role enum(admin, acquisitions, dispositions, viewer), twilio_number, active |
| `audit_log` | actor_id, entity_type, entity_id, action, before jsonb, after jsonb, at |

### Properties and contacts

| Table | Columns |
|---|---|
| `properties` | address_line1, address_line2, city, state, postal_code, county, lat, lng, apn, property_type, beds, baths, sqft, lot_sqft, year_built, units, occupancy enum(owner, tenant, vacant, unknown), condition enum(1 to 5 or unknown), photos jsonb, notes |
| `contacts` | first_name, last_name, phones jsonb (number, type, is_primary), emails jsonb, mailing_address, relationship enum(owner, heir, agent, attorney, tenant, other), sms_consent enum(unknown, opted_in, opted_out), sms_consent_at, email_consent, do_not_contact, notes |
| `property_contacts` | property_id, contact_id, role, is_primary |

### Pipeline

| Table | Columns |
|---|---|
| `pipeline_stages` | org_id, key, name, position, is_terminal, color. Seeded with the nine stages |
| `lead_sources` | org_id, name, cost_per_lead, active |
| `leads` | property_id, primary_contact_id, stage_id, source_id, assigned_to, status enum(open, won, lost, nurture), motivation_score int, seller_urgency enum, asking_price, next_follow_up_at, last_contact_at, contact_attempts int, first_response_minutes, lost_reason, deal_issues jsonb (checklist, see section 4.7) |
| `activities` | lead_id, property_id, actor_id, type enum(call, sms, email, note, stage_change, offer, task, enrichment, document, system), payload jsonb, occurred_at |
| `tasks` | lead_id, assigned_to, title, due_at, done_at, kind enum(call, text, email, visit, other) |
| `tags` | org_id, name, color, kind enum(lead, buyer, issue) |
| `lead_tags` | lead_id, tag_id |
| `offers` | lead_id, analysis_id, amount, type enum(cash, creative, assignment), sent_at, sent_via, status enum(draft, sent, countered, accepted, rejected, expired), counter_amount, notes |
| `documents` | lead_id or property_id or buyer_id, storage_path, filename, mime, size, uploaded_by |
| `saved_views` | owner_id, entity enum(leads, buyers), name, filters jsonb, sort jsonb, columns jsonb, is_shared |

### Enrichment

| Table | Columns |
|---|---|
| `property_reports` | property_id, provider, fetched_at, normalized jsonb (characteristics, owner, avm, mortgages, liens, sales, tax, comps), raw jsonb, cost_cents, status enum(ok, partial, failed) |
| `comps` | property_id, report_id, source enum(provider, manual), address, sold_price, sold_at, sqft, beds, baths, distance_mi, adjusted_price, included bool |

The report page reads the latest `property_reports` row. Older rows are kept for history. Manual comps live beside provider comps so ARV notes are preserved.

### Messaging

| Table | Columns |
|---|---|
| `message_templates` | org_id, channel enum(sms, email), name, subject, body, merge_fields text[] |
| `messages` | lead_id, contact_id, channel, direction enum(in, out), from_addr, to_addr, body, template_id, campaign_step_id, provider, provider_message_id, status enum(queued, sent, delivered, failed, received, undelivered), status_at, error, sent_by |
| `campaigns` | org_id, name, channel, status enum(draft, active, paused, done), segment jsonb (filters), created_by |
| `campaign_steps` | campaign_id, position, delay_hours, template_id, stop_on_reply bool |
| `campaign_enrollments` | campaign_id, lead_id, contact_id, current_step, next_send_at, status enum(active, replied, stopped, done, opted_out) |
| `jobs` | kind, run_at, payload jsonb, status, attempts, last_error |

Consent rule: no outbound SMS to a contact whose `sms_consent` is `opted_out` or whose `do_not_contact` is true. Inbound STOP, UNSUBSCRIBE, and similar keywords set `opted_out` and stop every enrollment. Inbound HELP gets the compliance reply. Every send records the consent state at send time in `messages.payload`.

### Deal analyzer

| Table | Columns |
|---|---|
| `deal_analyses` | property_id, lead_id, version int, name, status enum(draft, reviewing, approved_for_offer, rejected), inputs jsonb (DealInput), outputs jsonb, engine_version, created_by, is_primary bool, notes |
| `rehab_line_items` | analysis_id, row_number, item_number, question, option, answer, quantity, unit_cost, line_total |
| `cost_defaults` | org_id, row_number, item_number, question, option, unit_cost, unit, market, as_of |

`inputs` is the `DealInput` from `docs/ARCHITECTURE.md` section 6 extended with a `wholesale` block (investor buy price, target margin, existing mortgage payoff, closing costs). `outputs` is the engine result. Versions are immutable once status leaves `draft`; a new version is cloned from the last one.

### Buyers

| Table | Columns |
|---|---|
| `buyers` | company, first_name, last_name, phones jsonb, emails jsonb, website, notes, source, active, last_contacted_at |
| `buyer_criteria` | buyer_id, states text[], counties text[], zips text[], property_types text[], price_min, price_max, arv_pct_max, buying_formula text, condition_levels int[], occupancy_prefs text[], funding enum(cash, hard_money, conventional, mixed), proof_of_funds_on_file bool, sight_unseen bool, min_margin_amount, min_margin_pct, closes_in_days |
| `buyer_purchases` | buyer_id, property_id, price, closed_at, notes |
| `deal_submissions` | analysis_id, buyer_id, package_id, sent_at, sent_via, response enum(none, interested, pass, offer), response_amount, notes |

### Deal packages

| Table | Columns |
|---|---|
| `deal_packages` | analysis_id, version, storage_path, share_token, expires_at, sections jsonb, generated_by |

### 4.7 Deal issue checklist

`leads.deal_issues` is a jsonb object with one boolean and one note per issue, validated by Zod, plus a derived `messy_score`. Issues: dirty_title, probate_or_inherited, liens_or_judgments, mortgage_default_or_foreclosure, code_violations, poor_condition, occupied_by_tenant, occupied_by_squatter, seller_urgency, divorce_or_partner_dispute, tax_delinquent, hoarder_or_environmental, other. Each issue also exists as a `tags` row of kind `issue` so the table view can filter on them.

## 5. Engine additions

The engine keeps every module from `spec/FORMULA_SPEC.md` and adds two:

- `wholesale.ts`: maximum allowable offer (ARV times factor, less rehab, less assignment fee or target margin, the workbook's Quick Offers math), investor buy price, spread between acquisition price and investor buy price, gross profit, net profit after closing and holding, ARV percentage, cost breakdown, existing mortgage payoff check (offer minus payoff and closing must be positive for the seller).
- `sensitivity.ts`: a grid function that reruns the analysis over a range of ARV, rehab, and resale assumptions and returns net profit and spread per cell. Pure, so the UI renders it as a table and a chart without math.

Golden tests from `spec/golden` stay green. New modules get fixtures from hand checked cases reviewed with Ous.

## 6. Route map

| Route | Screen | Role |
|---|---|---|
| `/login` | Magic link and password | any |
| `/dashboard` | Pipeline counts, leads by source, follow ups due today, offers sent, contracts, closed, speed to contact | any |
| `/pipeline` | Kanban by stage, drag between columns, quick actions (call, text, task) on each card | acquisitions, admin |
| `/leads` | Table with sort, filter, search, saved views, bulk tag and assign | any |
| `/leads/[id]` | Lead detail: header (address, stage, assigned, next follow up), tabs Overview, Activity, Messages, Property Report, Analyzer, Offers, Documents | any, write by role |
| `/leads/new` | Create lead with property and contact in one form, address lookup | acquisitions, admin |
| `/properties/[id]/report` | Property report with enrich button, raw data in an admin section | any |
| `/analyzer` | List of analyses, filters by status | any |
| `/analyzer/[id]` | Analysis editor: inputs left, outputs right, tabs Offer, Flip P&L, Cash Flow, Rehab, Buy and Hold, Sensitivity, Compare versions | acquisitions, admin |
| `/buyers` | Directory with buy box columns and match count for a selected deal | dispositions, admin, viewer read |
| `/buyers/[id]` | Buyer detail with criteria, purchases, submissions | dispositions, admin |
| `/buyers/match/[analysisId]` | Ranked buyers for a deal with reasons | dispositions, admin |
| `/campaigns`, `/campaigns/[id]` | Segment builder, steps, schedule, delivery and reply stats | acquisitions, admin |
| `/templates` | SMS and email templates with merge field preview | acquisitions, admin |
| `/tasks` | Follow ups due, overdue, by user | any |
| `/packages/[id]/preview` | PDF preview, regenerate, copy share link | dispositions, admin |
| `/share/[token]` | Public read only package page with PDF download | public, token |
| `/settings` | Team and roles, pipeline stages, tags, lead sources, integrations (keys stored as env, status only), branding | admin |
| `/api/webhooks/twilio/sms`, `/api/webhooks/twilio/status`, `/api/webhooks/resend` | Inbound messages and delivery status | provider signed |
| `/api/cron/dispatch` | Sends due steps and tasks | cron secret |

Mobile: `/pipeline` collapses to a stage picker plus card list, `/leads/[id]` stacks header, quick actions bar (call, text, email, task), then tabs.

## 7. Permissions

| Role | Leads and pipeline | Messaging | Analyzer | Buyers and packages | Settings |
|---|---|---|---|---|---|
| admin | all | all | all | all | all |
| acquisitions | create, edit, move, assign | send, campaigns | create, edit, approve | read | none |
| dispositions | read, add notes | send to buyers | read, comment | all | none |
| viewer | read | read | read | read | none |

Enforced twice: in server actions by role check, and in Postgres by row level security policies keyed on `org_id` and role. Audit log entries are written by the server action layer for stage changes, offers, status changes on analyses, consent changes, role changes, and deletes.

## 8. Phased build plan

### MVP, daily lead operations

1. Repo, workspace, engine port from `spec/` with green golden tests, `wholesale.ts`.
2. Database schema, migrations, RLS, seed with 40 leads across all stages, 25 properties, 30 contacts, 12 buyers with criteria, 6 templates, 2 campaigns, 8 analyses. Seed runs on PGlite for tests and on Supabase for dev.
3. Auth with magic link and password, profiles and roles, invite flow.
4. Leads: create, table view with filters and search, detail page, activity log, tasks, tags, notes, documents upload to Supabase storage.
5. Pipeline kanban with drag and drop, stage change logged.
6. Messaging: one to one SMS and email from the lead record through the provider interface, Twilio and Resend adapters, inbound webhook, status webhook, consent handling, templates with merge fields, communication timeline.
7. Property report with the provider interface, mock adapter with seeded data, RealEstateAPI adapter with normalized mapping, enrich on demand, raw section for admins.
8. Deal analyzer: analysis editor on the engine, versions, status, compare two versions side by side, cost breakdown.
9. Buyers directory and buyer detail with criteria.
10. Deal package PDF with property, assumptions, comps, notes, branding placeholder, share link.
11. Dashboard.
12. README with local setup, environment variables, deployment steps. GitHub Actions running test and build.

### Phase 2, automation and reporting

- Campaign builder: segments, sequences, scheduling, stop on reply, the cron dispatcher.
- Automatic enrichment on lead creation with a per lead cost cap.
- Saved views shared across the team, bulk actions.
- Sensitivity analysis tab and chart.
- Reporting: speed to contact, conversion by source, cost per contract, agent activity.
- Audit log viewer in settings.
- Tauri desktop packaging for Mac and Windows with auto update.
- Playwright tests for lead create, stage move, send SMS.

### Phase 3, buyer matching and analytics

- Buyer match scoring with reasons (geography, price, ARV percent, condition, occupancy, funding), match before lead spend in a new market such as Maryland.
- One click submission of a package to matched buyers with response tracking.
- Analyzer comps tool with adjustments and ARV confidence.
- Market analytics by county and zip.
- Team performance dashboards and alerts (lead untouched for 15 minutes).

## 9. Dependencies to approve

Runtime: `next`, `react`, `react-dom`, `zod`, `drizzle-orm`, `postgres`, `@electric-sql/pglite`, `@supabase/supabase-js`, `@supabase/ssr`, `@tanstack/react-table`, `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `recharts`, `@react-pdf/renderer`, `twilio`, `resend`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `date-fns`, Radix primitives used by the shadcn components (`@radix-ui/react-dialog`, `-dropdown-menu`, `-select`, `-tabs`, `-tooltip`, `-popover`, `-checkbox`, `-switch`, `-toast`).

Dev: `typescript`, `tailwindcss`, `postcss`, `autoprefixer`, `drizzle-kit`, `vitest`, `@types/react`, `@types/react-dom`, `@types/node`, `eslint`, `eslint-config-next`, `prettier`, `tsx`.

Tooling on this machine: enable pnpm through corepack (already present), `git init` in the project folder.

Accounts Russ creates, keys go in `.env.local` only: Supabase project (database, auth, storage), Twilio account and one number, Resend domain, RealEstateAPI key when obtained, Vercel project when deploying.

## 10. Open items for the Ous call

- Confirm the nine stages and what moves a lead between them.
- Lead sources today and volume per week.
- Which analyzer outputs he quotes to sellers and to buyers.
- Assignment versus double close as the default exit.
- Buy box fields he actually asks buyers.
- The eight anomaly questions from `spec/ANOMALIES.md`.
