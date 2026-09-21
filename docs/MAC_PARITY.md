# Mac app parity

Reference: `deal-analyzer-mac-reference.md`, reconstructed on 2026-09-21 from `DealAnalyzer-1.0.0-build2-mac.dmg`. No source code was in that package, so this table maps behavior, not code. Status values: **Built** (added in engine 0.2.0), **Present** (the web app already had it), **Different** (same need, met another way), **Deferred** (not built, reason given).

The rule that decided what to build: nothing may change a number that the golden fixtures in `spec/golden/` pin to the workbook. Features that only add inputs, views, or tracking were built. Features that replace the workbook's financing, fee, or cash flow model were deferred until Ous decides, because they would make the web analyzer disagree with his spreadsheet.

## Built in this pass

| Mac feature | Web location | Notes |
| --- | --- | --- |
| Three tier quick offers (light, medium, full per foot) plus "Offer using linked rehab" | Analyzer, Offers section and Offers results tab | `packages/engine/src/dealOffers.ts`. Same rule as the Quick Offers sheet; a test pins it to `quickOffers()` for equal inputs. A negative offer stays visible. |
| Offer percent as an input | Deal and Offers sections | Was already editable as "ARV factor", now labeled "Offer percent of ARV". |
| Comparable sales list with "use average for ARV" | Offers section | One click adds the property report comps. When the switch is on, the average drives every calculator and the typed ARV is set aside. |
| Seller value comparison | Offers section and results | Outcome times probability, divided by months times effort (workbook K14, K15). Labeled a comparison score, not an appraisal. |
| Rehab source switch: checklist, manual, per square foot | Rehab section | `packages/engine/src/rehabPlan.ts`. An explicit checklist source ignores a stale manual override. |
| Checklist item status, notes, custom items, "Needs price or quantity" | Rehab section | Status and notes never change the estimate. Custom rows start at row 1000 so they cannot collide with workbook rows. |
| Completion percent and progress history | Rehab section and Rehab results tab | Completion counts finished items only. It does not measure money spent. |
| Standalone loan amortization with payoff after payment N | Loan section and Loan tab | `packages/engine/src/loanAnalysis.ts`. Calendar months, month end dates clamp, final payment clears the balance. Separate from `amortization.ts`, which reproduces the workbook sheet cell for cell. |
| DSCR pass or fail per case, current and market side by side | Buy and hold tab | Also added required DCR, cash reserves, sewer, garbage, lawn, beds and baths to the inputs. |
| Five year returns table and 20 year rent growth | Buy and hold tab | Values come from the workbook port in `buyAndHold.ts`. |
| Validation messages | Every section, plus a summary above the results | `packages/engine/src/validate.ts`. Wording follows the Mac app where it had a message for the same rule. Errors and warnings link to the section that fixes them. |
| Field guide (glossary) | "Field guide" button in the editor | 60 workbook definitions in 8 sections, searchable, each with its Definitions sheet cell. |
| Library: search, strategy and status filters, sort, archive, trash, restore, duplicate | Deal Analyzer list | Trash is reversible. "Delete for good" only works from trash. Trashing the primary version hands the flag to the newest remaining version. |
| Strategy on the record (Wholesale, Flip, Rental) | Deal section, list column, compare tab | Stored in `deal_analyses.strategy`. |
| Calculation rule version saved with results | Already present as `engine_version`; now 0.2.0 | Shown in the page header and the compare tab. |
| Autosave warning | Editor | The browser warns before leaving with unsaved edits. |
| Annual interest rate per loan | Financing section | Decision D-11: one annual rate per lien, accrued monthly over the hold. Reproduces the workbook's cached result to the cent. The rest of the Mac financing model stays deferred. |

## Present before this pass

| Mac feature | Web location |
| --- | --- |
| Rehab checklist priced from the workbook catalog with include, quantity, editable price | Rehab section. Prices come from `cost_defaults` per org, seeded from the workbook. Checked row by row on 2026-09-21: the Mac `rehab-catalog.json` has the same 67 rows and all 67 prices match the workbook. Three rows (63, 64, 65: Dumpster High, Single Family Patch 3 Dumps, Family Gut) carry the category "Decks" in the Mac file where the workbook has "Dumpsters", so the workbook rows were kept as the source. |
| Weekly construction cash flow, delayed and up front draws, minimum balance | Cash flow tab |
| Rent roll by unit, current vs market cases | Buy and hold |
| Offer and counteroffer history with dates and notes | Lead, Offers tab. Linked from the analysis header. |
| PDF export with section picker | Deal package. The buyer package never shows the contract price, the spread, or the assignment fee, and it renders on the server so those numbers are not sent to the browser. Analysis notes are now off by default in new packages. |
| Saved versions | Versions are rows (v1, v2, ...) with clone to edit, compare, review status, and lock on approval. |

## Different by design

| Mac feature | Web approach |
| --- | --- |
| Deal stage on the record (Evaluating through Sold) | The stage lives on the lead and the pipeline board. The analysis has its own review status. The pipeline card and its quick view now show the primary analysis numbers and link straight into the analyzer. |
| Restore a version with a recovery copy first | Versions are never overwritten. Clone makes the new version; the old one stays. |
| Local backups with checksum | Hosted Postgres with provider backups. CSV export of leads, buyers, and analyses is under Settings, Integrations. |
| One library per Mac user, teammates exchange PDFs | Multi user with roles, audit log, and share links. |

## Deferred, with reasons

| Mac feature | Why it waits |
| --- | --- |
| Multiple loans with purchase and rehab funding, fixed fees, and interest on drawn balance vs full commitment | Replaces the workbook's first lien, second lien, misc model. The web numbers would stop matching the spreadsheet and the golden fixtures. Needs a decision from Ous, then a flag in `anomalies.ts` or a second financing mode. |
| Fee items with a basis choice (fixed, % of purchase, % of sale, % of as is) | Same reason. The workbook's percent bases are recorded as anomalies A-02 and related; the fix is already behind the `fixTransactionCostBases` flag. |
| Monthly holding cost line items charged at month start | The workbook holds four misc holding lines and fixed categories. Free form lines change the cash flow timing rules. |
| Draw tranches with timing and funding percents, dated rehab expenses, other dated cash events, cash profit reconciliation | The workbook hard codes two draw schedules. A general schedule is a new cash flow engine, not a port. |
| Hold period up to 120 months in the weekly grid | The workbook grid stops at week 39. The validator warns above 9 months and the flip totals still compute. |
| 20 year projection with depreciation, tax savings, and cumulative ROI per year | The workbook projects 5 years of returns and 20 years of rent. Extending returns to 20 years needs rules the workbook does not define. |
| Undo and redo | Browser form state plus versions cover the need. Not built. |
| Inspection worksheet PDF section | Not reconstructable from the binary. Needs the Swift source or a screenshot. |

## Project model (engine 0.3.0, model 0.2.0-preview)

The deferred financing and cash flow features now have a home that cannot disturb the workbook numbers. `DealInput.project` is optional and absent by default. `runDeal()` passes it to `runProject()` in `packages/engine/src/project/` and returns the result as `outputs.project`. Nothing in that folder is read by `acquisitions()`, `wholesale()`, or the draw cash flow, and `tests/projectModel.test.ts` asserts that every workbook output is identical with the model on and off. In the analyzer it is the "Project model" input section and the "Project model" results tab, both labeled preview. The Flip P&L stays the number of record until Ous approves the model.

| Deferred feature | File | State |
| --- | --- | --- |
| Fee items with a basis (fixed, % of purchase, % of sale, % of as is) | `project/fees.ts` | Calculated and tested. |
| Monthly holding cost lines charged at month start | `project/holdingLines.ts` | Calculated and tested. A part month counts as a month start. |
| Multiple loans with purchase and rehab funding, points on commitment, fixed fees | `project/financing.ts` | Calculated and tested. |
| Interest on the drawn balance | `project/financing.ts` | Calculated and tested. It uses the debt at each month start, so it needs a project start date. |
| Draw tranches, dated rehab expenses, other dated cash events, cash profit reconciliation, holds up to 120 months | `project/cashFlow.ts` | Calculated and tested. The calendar skeleton is `buildProjectTimeline()` and every dated part of the model shares it. |
| Year by year projection with depreciation, tax savings, cumulative ROI | `project/rentalProjection.ts` | Calculated and tested. It reads the rents, expenses, and loan terms off `DealInput.buyAndHold` through `ProjectContext.rental`. |
| Mac validation messages for the above | `project/validateProject.ts` | Built and tested. Issues carry the section "project". |
| Undo and redo, inspection worksheet PDF | none | Still not built, for the reasons in the table above. |

Rules the modules follow, as the Mac reference states them. Check them against the Swift source when it arrives.

- Monthly interest is the annual rate divided by 12. Calendar months. Costs and interest land at month start. Interest on a drawn balance uses the debt at month start. Points are charged on the commitment. No loans means an all cash purchase.
- Weekly rows carry number, date, cash in, cash out, ending balance, and minimum balance, on calendar dates from the start date through the hold.
- Draw timing is a percent of the hold period, rounded up to a week. Funding shares apply to each loan's rehab commitment and sum to at most 100 percent.
- Default rehab spend is even across weeks with the cent adjustment in the final week. Dated rehab expenses must sum to the linked rehab total and fall inside the hold.
- A negative ending balance is additional owner cash required. Outputs: interest, points and fees, financing costs, cash profit, exit date, and a cash profit reconciliation.
- Projection: fixed dollar operating expenses stay constant, percentage expenses grow with rent, estimated tax savings sit outside operating cash flow. The return denominator is down payment plus closing costs plus owner funded initial rehab.

### Inferred rules, verify against the Swift source

The reference leaves these gaps. Each one was filled with the simplest reading that keeps the model self consistent, and each one is pinned by a test in `packages/engine/tests/projectModel.test.ts`. None of them touches a workbook number.

1. The grid runs from the start date to the start date plus the hold's month starts, so the number of weeks is the days in that span divided by 7, rounded down, plus one. Week 1 is the start date and every later week is seven days after the one before, which puts the exit date inside the last week.
2. A dated item is charged in the week that contains its date. A date outside the hold is clamped to the first or the last week. The validator already reports it as an error.
3. The purchase price, the buying fees, the loan points, and the lender fixed fees are all charged in week 1, the week the purchase loans fund.
4. The sale proceeds, the selling fees, and the loan payoff all land in the last week. The payoff is the purchase funding plus the rehab the draws actually released, not the full commitment.
5. Draw timing rounds up against the number of weeks in the grid. A timing of 0 percent moves to week 1 rather than to week 0.
6. A draw releases its funding share of each loan's rehab commitment, capped so the running total for that loan never passes the commitment. Draws past the commitment release nothing.
7. Debt at a month start is the loan's purchase funding plus every draw dated on or before that month start. Purchase funding is drawn in full on day one.
8. Even rehab spend rounds the estimate to whole cents, divides by the week count to the nearest cent for every week but the last, and puts the remainder in the last week, so the schedule sums to the estimate exactly.
9. Initial owner cash is the opening balance of the grid, not a cash in row. Cash profit is the final ending balance less that opening balance, which is what makes the reconciliation equal the project net profit.
10. Additional owner cash is the lowest ending balance when that balance is negative. It is not injected back into the rows, so it changes the funding need and not the profit.
11. Return on owner cash is the project net profit over initial cash plus additional cash. It reads "Not available yet" when that total is zero, which happens when the loans fund the whole project.
12. A hold longer than 120 months leaves the weekly cash flow unavailable with a reason rather than truncating the grid.
13. The projection uses market rent, and current rent when no market rent is entered. Year 1 is the rent as entered and each later year grows it by the rent growth rate.
14. The projection's percentage operating expenses are management plus vacancy plus maintenance from Buy and hold. The fixed dollar ones are property tax, insurance, gas and electric, water, sewer, garbage, and lawn and snow.
15. Depreciation stops when the depreciable basis is used up. A part year at the end takes what is left.
16. Estimated tax savings are the marginal tax rate on depreciation plus that year's mortgage interest, the same two deductions the workbook uses on the Buy and Hold sheet.
17. Appreciation compounds on the property value from the year before, starting at the Buy and hold sale price.
18. Debt service, mortgage interest, and principal paydown are all zero once the loan term is over.

`runDeal()` passes the rental context into `runProject()` through `projectRentalContext(inputs.buyAndHold)`. The projection is connected to the Buy and hold inputs.

## Still needed from the iMac

The Swift source under `~/Desktop/projects/DealAnalyzer/Sources/`. Zip that folder (not the DMG) and the deferred calculators can be ported rule for rule instead of inferred.
