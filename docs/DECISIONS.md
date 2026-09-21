# Decisions

Each entry: Decision, Why, What we gave up, Revisit when.

## D-01 Pure engine, separate from the UI

- **Decision.** All math lives in `packages/engine` as pure functions. `apps/web` calls them and formats the result.
- **Why.** The golden fixtures can be tested without a browser. The same engine can run in a server action, a PDF renderer, or a script that re-imports Airtable rows.
- **What we gave up.** Some duplication: the UI holds form state and the engine holds the same shape as an input object.
- **Revisit when.** Never for the math. Revisit the package boundary if a second app (mobile, CLI) never appears and the split feels like ceremony.

## D-02 One cash flow model with a schedule parameter

- **Decision.** `drawCashFlow` takes `schedule: "delayed" | "upfront"` and reproduces both sheets.
- **Why.** The sheets differ in 17 cells, all of them draw timing and labels. One loop, two parameter sets.
- **What we gave up.** The ability to edit the two schedules independently, for example different cost timing on one of them.
- **Revisit when.** Ous asks for per deal draw schedules with more than three draws. Then the schedule becomes a list of `{ week, share }` and the two presets remain as defaults.

## D-03 Port anomalies as they are, behind flags

- **Decision.** Every anomaly is ported exactly, tagged `// ANOMALY-A-nn`, with a flag in `anomalies.ts` defaulting to the sheet's behavior.
- **Why.** The only proof the port is right is that it reproduces the workbook. Corrections without Ous's agreement would break that proof and might change numbers he has already used with lenders.
- **What we gave up.** Cleaner code. Some branches exist only to preserve a bug.
- **Revisit when.** Ous decides on each item on the discovery call. Confirmed corrections flip the default and get a second fixture. Rejected corrections lose the flag and keep the tag.

## D-04 jsonb inputs and outputs instead of one column per field

- **Decision.** `deals.inputs` and `deals.outputs` are jsonb blobs validated by the Zod schema. `engine_version` is stored beside them.
- **Why.** About 120 inputs across five calculators, and the list will change after every conversation with Ous. A column per field means a migration per change. The engine can always recompute outputs from inputs, so outputs are a cache for lists and comparisons.
- **What we gave up.** Plain SQL reporting on single fields. Postgres jsonb operators and generated columns cover the few fields worth indexing (net profit, ROI, address).
- **Revisit when.** A report needs joins across many fields, or Airtable style views are wanted inside the app. Then promote those fields to generated columns.

## D-05 Excel function parity via tested helpers, not a formula library

- **Decision.** `money.ts` implements PMT, CUMIPMT, ROUNDUP, AVERAGE, and day arithmetic by hand, each tested against cached values.
- **Why.** The workbook uses fourteen functions. A formula library would add a dependency the allowed list does not include, would pull in hundreds of functions, and would hide the one place where parity matters.
- **What we gave up.** Free coverage of functions Ous might add to a future version of the sheet.
- **Revisit when.** A new workbook version introduces functions with tricky semantics (XIRR, date functions with day count conventions).

## D-06 Golden fixtures come from cached values and are never hand edited

- **Decision.** `spec/golden/*.json` is written only by `tools/extract_workbook.py`. The workbook's cached values are the expected values.
- **Why.** Hand edited expectations drift toward what the code produces. The workbook is the client's truth.
- **What we gave up.** Fixtures for corrected anomaly behavior cannot come from the workbook. Those get a separate `spec/golden/corrected/` set, written by the engine once Ous approves and reviewed by hand once.
- **Revisit when.** Ous sends a new workbook. Rerun the extractor, diff the fixtures, and treat every changed expected value as a question.

## D-07 The week cap is a parameter, not a constant

- **Decision.** `drawCashFlow` takes `maxWeeks`. Phase 3 passes 36 for parity. The engine does not fail above it; it computes as the sheet would.
- **Why.** The cap is the highest impact structural limit (A-07). Keeping it as a parameter lets one test show what happens at a 10 month hold without changing the model.
- **What we gave up.** Nothing today. A future "grow with hold time" mode is one line.
- **Revisit when.** Ous states his longest hold.

## D-08 Buy & Hold (the first sheet) is canonical

- **Decision.** The engine and fixture follow `Buy & Hold`. The `Buy & Hold 2` edits are recorded as three switches and one flag.
- **Why.** Sheet 1 links its loan test percentages to the inputs; sheet 2 hardcodes them. Sheet 1 is the more general form.
- **What we gave up.** Sheet 2's tax from tax value rule and its 3% closing cost, until switched on.
- **Revisit when.** Ous says sheet 2 is the one he uses (A-15).

## D-09 Amortization ships as a plain loan calculator

- **Decision.** `amortization` reproduces the whole sheet for parity, including the vehicle side table behind a flag. The UI at `/tools/amortization` shows only loan, rate, term, start date, schedule, and payoff lookup.
- **Why.** The side table is a different deal (A-13). Showing it would confuse Ous and any partner he shares a screen with.
- **What we gave up.** Nothing he has asked for.
- **Revisit when.** He says the tab is part of his work.

## D-10 Repair costs flow from the checklist with an override

- **Decision.** `acquisitions` calls `rehabEstimator` and uses its total unless `repairCostsOverride` is set. The UI shows which one is in use.
- **Why.** The sheet's typed number equals the checklist total today but is not linked (A-04). Linking removes the most likely silent error in daily use.
- **What we gave up.** The typed number as the default. A contractor quote still fits through the override.
- **Revisit when.** Ous says he never uses the checklist for offers.

## D-11 Lien interest is entered as an annual rate

- **Decision.** Each lien has one input, an annual interest rate. The engine turns it into the workbook's own shape: the lien's interest only cell becomes annual divided by 12 and its other rate cell becomes zero (`annualRates()` in `packages/engine/src/acquisitions.ts`). Interest for the hold is lien times annual rate, divided by 12, times hold months. Decided by Russ on 2026-09-21. Engine version 0.3.0.
- **Why.** The sheet has two rate cells per lien and neither takes an annual rate. F21 multiplies its rate by the lien and by the hold months, so a typed 12 percent charges 12 percent a month. Ous never uses that cell; he types `=0.14/12` into the interest only cell instead (A-03). F25 leaves the hold months out for the second lien (A-21). A loan quotes an annual rate and accrues monthly, so one annual field is what a user expects, and it removes the hand division.
- **Parity.** For the first lien this reproduces the workbook's cached numbers to the cent. `tests/annualRates.test.ts` pins financing, net profit, and both draw schedule returns to the golden fixture with 14 percent entered as an annual rate. The golden tests themselves still run on the raw workbook cells and are unchanged.
- **What we gave up.** The second lien no longer follows F25. It accrues per hold month like the first lien. No saved deal has a second lien, so no stored result changes. Versions saved before 0.3.0 open with an equivalent annual rate: exact for the first lien, and for the second lien the once only charge is spread over the hold so the total at the saved hold length is the same.
- **Revisit when.** Ous says a lender of his charges interest some other way, such as on the drawn balance only. That is the multi loan financing model listed as deferred in `docs/MAC_PARITY.md`.

