# Architecture

## 1. Repo layout

| Folder | What lives there | What must never live there |
|---|---|---|
| `apps/web` | Next.js App Router pages, forms, tables, charts, tooltips, formatting for display | Math. No arithmetic on deal values outside a call into the engine. |
| `packages/engine` | Pure TypeScript calculators, Excel parity helpers, Zod schemas, anomaly flags | React, Node IO, fetch, dates from the clock. |
| `supabase/migrations` | SQL migration drafts, applied only by hand in a later session | Secrets, seed data with real deals. |
| `spec/` | Extraction output, formula spec, anomalies, sheet diffs, golden fixtures | Hand edits to `cells.json` or `golden/*.json`. Rerun the extractor instead. |
| `tools/` | `extract_workbook.py` and any future workbook tooling | App code. |
| `docs/` | Architecture, decisions, discovery call script | Generated files. |

## 2. Engine module map

Every module exports one pure function. Inputs object in, outputs object out. Grids are loops.

| Module | Input type | Output type | Calls |
|---|---|---|---|
| `quickOffers.ts` | `QuickOffersInput` | `QuickOffersOutput` | `money.average` |
| `rehabEstimator.ts` | `RehabEstimatorInput` | `RehabEstimatorOutput` | none |
| `acquisitions.ts` | `AcquisitionsInput` | `AcquisitionsOutput` | `rehabEstimator` (linked repair total unless `repairCostsOverride` is set), `drawCashFlow` twice (delayed, upfront) |
| `drawCashFlow.ts` | `DrawCashFlowInput` with `schedule` and `maxWeeks` | `DrawCashFlowOutput` | `money.roundUp` |
| `buyAndHold.ts` | `BuyAndHoldInput` | `BuyAndHoldOutput` | `money.pmt`, `money.cumipmt` |
| `amortization.ts` | `AmortizationInput` with `startDate` | `AmortizationOutput` | `money.pmt`, `money.addDays` |
| `money.ts` | n/a | `pmt`, `cumipmt`, `roundUp`, `average`, `addDays`, `daysInMonth` | none |
| `anomalies.ts` | n/a | `AnomalyFlags` object, one boolean per A-nn, all false | none |
| `schemas.ts` | n/a | Zod schemas and inferred types for every input | `zod` |
| `types.ts` | n/a | Shared output types (`WeekRow`, `ProForma`, `DcrBlock`) | none |
| `index.ts` | n/a | Re-exports every function, type, schema, and `ENGINE_VERSION` | all |

Signatures are written out in `spec/FORMULA_SPEC.md`. `acquisitions` builds both `DrawCashFlowInput` objects from its own inputs, so a caller never assembles cost totals by hand.

## 3. Precision policy

Compute in IEEE doubles. Never round inside the engine. Round only in `apps/web` formatters, two decimals for currency and percent. Golden tests assert every value in `expected` within 0.01 for currency and 1e-6 for ratios and percentages. The amortization and weekly balance loops are checked at every row, so drift shows up where it starts. `pmt` and `cumipmt` follow Excel's closed form definitions.

## 4. Anomaly policy

The engine ports every entry in `spec/ANOMALIES.md` exactly as the sheet computes it. Each such line carries a comment `// ANOMALY-A-nn`. `anomalies.ts` exports one flag per entry that has a corrected form. Default is the sheet's behavior, so golden tests pass with all flags false. When Ous decides, the flag flips in one place and a second fixture is added for the corrected form. Flags are passed in the input object as `flags?: Partial<AnomalyFlags>` so two behaviors can run side by side for comparison.

## 5. Data model

Draft only, in `supabase/migrations/0001_init.sql`. Not applied.

```sql
create table deals (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id),
  name text not null,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  inputs jsonb not null,
  outputs jsonb not null,
  engine_version text not null
);
create table rehab_line_items (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  row_number int not null, item_number int, question text, option text,
  answer text, quantity numeric, unit_cost numeric, line_total numeric
);
create table cost_defaults (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id),
  row_number int not null, item_number int, question text, option text,
  unit_cost numeric, unit text, updated_at timestamptz not null default now()
);
```

`inputs` holds one `DealInput`. `outputs` holds the engine result at save time. `rehab_line_items` is a normalized copy of the checklist written on save, for reporting and the PDF. `cost_defaults` is seeded per user from the Rehab Estimator H column so Ous can raise prices without touching a deal.

Airtable mapping. The `To Airtable` row has 87 columns: name, property, the Acquisitions inputs and totals, notes, and the offer block. All of it maps onto `deals.inputs.acquisitions`, `deals.outputs.acquisitions`, `deals.name`, `deals.address`, and `deals.notes`. Nothing in the export covers rehab, cash flow, or rentals. Four columns share the header "Miscellaneous Holding Costs Annualized" and map to `miscHoldingTotal[0..3]` by position. "Name" is address plus profit and is rebuilt on export, not stored.

## 6. Input schema

`packages/engine/schemas.ts`, generated from the two Fields sheets and the Definitions sheet. Top level shape:

```ts
const DealInputSchema = z.object({
  meta: z.object({ name: z.string(), address: z.string().optional(), notes: z.string().optional() }),
  quickOffers: QuickOffersInputSchema,
  rehab: RehabEstimatorInputSchema,
  acquisitions: AcquisitionsInputSchema,   // repairCosts comes from rehab unless repairCostsOverride is set
  drawCashFlow: z.object({ maxWeeks: z.number().int().min(1).default(36) }),
  buyAndHold: BuyAndHoldInputSchema.optional(),
  amortization: AmortizationInputSchema.optional(),
  flags: AnomalyFlagsSchema.partial().optional(),
});
type DealInput = z.infer<typeof DealInputSchema>;
```

Each field schema carries `describe()` text from the Definitions sheet, which the UI reads for tooltips. Percent fields carry the min and max from the spec.

## 7. UI route map

| Route | Content | Phase 3 |
|---|---|---|
| `/quick-offers` | Three offer tiers, comps, per sqft costs | yes, in memory |
| `/deals/[id]` | Tabs: Acquisitions, Cash Flow, Rehab, Buy and Hold | no routes under `/deals`. Phase 3 serves the same four tabs at `/acquisitions`, `/cash-flow`, `/rehab`, `/buy-and-hold` on one example deal held in React state. |
| `/deals/compare` | Side by side of two saved deals | no |
| `/tools/amortization` | Loan, rate, term, start date, payoff lookup | yes, in memory |

Phase 3 is six pages, no auth, no persistence. The example deal is the workbook's own inputs from `spec/golden`.

## 8. Deploy plan

Vercel hosts `apps/web`. Supabase provides Postgres, auth, and row level security. GitHub Actions runs `pnpm test` and `pnpm build` on every push and blocks merge on failure.

| Item | Monthly |
|---|---|
| Vercel Hobby (one developer, non commercial) or Pro | $0 or $20 |
| Supabase Free or Pro | $0 or $25 |
| GitHub Actions on a private repo, 2,000 free minutes | $0 |
| Domain | about $1 |

Total: $0 to start, about $46 on paid tiers, which are needed once Ous shares with partners and wants daily backups.

## 9. Risks

- **36 week cap (A-07).** The sheet silently drops the sale for holds over 9 months. The engine takes `maxWeeks` as a parameter and Phase 3 keeps 36 for parity. Lifting it needs the flag and a new fixture, and Ous must say his longest hold.
- **Excel function parity.** `PMT` and `CUMIPMT` are hand written. A one cent drift on `CUMIPMT` compounds through five years of paydown. Mitigation: unit tests against the cached values for every year, not one.
- **Floating point drift over loops.** The 60 period balance ends at negative 1.1e-8 in Excel. The engine matches within tolerance and the UI shows 0.00.
- **Rehab cost defaults go stale.** The H column is one market at one date. `cost_defaults` is per user and dated, and the Rehab page shows the date of the defaults in use.
- **Several example deals.** The Fields sheet, the Airtable row, and the brief each describe a different deal. Fixtures follow the workbook only, and the extractor records the file hash so a new version produces a new fixture set.
