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

## Still needed from the iMac

The Swift source under `~/Desktop/projects/DealAnalyzer/Sources/`. Zip that folder (not the DMG) and the deferred calculators can be ported rule for rule instead of inferred.
