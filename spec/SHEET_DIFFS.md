# Sheet Diffs

Cell by cell differences between the paired sheets. Only cells whose stored content (formula or typed value) differs are listed. Cells whose cached value differs only because an upstream cell changed are summarized at the end of each section.

## Delayed Draw Cash Flow (A) versus Up Front Draw Cash Flow (B)

17 cells differ in content. Every other cell, including all 590 formulas per sheet apart from C7:C9, is identical.

| cell | value in A | value in B | meaning |
|---|---|---|---|
| A1 | DELAYED DRAW CASH FLOW SCHEDULE | UP FRONT DRAW CASH FLOW SCHEDULE | Sheet title. |
| O4 | Monthly | One Time | Frequency label for first mortgage interest. Not referenced by any formula (A-09). |
| B7 | Lender Draw 1 at 25% | Lender Draw 1 at 1% | Label for draw 1. |
| C7 | `=F4*E7` | `=roundup($F$4*E7,0)` | Draw 1 week. B rounds up to a whole week (A-08). |
| E7 | 0.25 | 0.01 | Draw 1 timing as a share of duration. |
| B8 | Lender Draw 2 at 50% | Lender Draw 2 at 33% | Label for draw 2. |
| C8 | `=F4*E8` | `=roundup($F$4*E8,0)` | Draw 2 week. |
| E8 | 0.5 | 0.33 | Draw 2 timing. |
| B9 | Lender Draw 3 at 75% | Lender Draw 3 at 66% | Label for draw 3. |
| C9 | `=F4*E9` | `=roundup($F$4*E9,0)` | Draw 3 week. |
| E9 | 0.75 | 0.66 | Draw 3 timing. |
| B13 | Other Expense 1 | empty | Label rows shifted down one on B (A-34). |
| B14 | Other Expense 2 | Other Expense 1 | same |
| B15 | Other Expense 3 | Other Expense 2 | same |
| B16 | Other Expense 4 | Other Expense 3 | same |
| B17 | Other Expense 5 | Other Expense 4 | same |
| B18 | empty | Other Expense 5 | same |

Cached value consequences with the current inputs (16 week duration):

| cell | A | B | meaning |
|---|---|---|---|
| C7, C8, C9 | 4, 8, 12 | 1, 6, 11 | Draw weeks. B: roundup(0.16) = 1, roundup(5.28) = 6, roundup(10.56) = 11. |
| G6 | 200,000 | 206,683.33 | Week 1 cash in. B receives draw 1 in week 1. |
| G7:G15 | draws at weeks 4, 8, 12 | draws at weeks 6, 11 | Cash in by week. |
| H6:H15 | see FORMULA_SPEC 4.3 | see FORMULA_SPEC 4.3 | Balance path differs through week 15. |
| H16:H41, H43, E43 | 67,420 and 44,453.33 | same | Both schedules end at the same balance because the same money moves. |
| minimum of H6:H41 | -3,246.875 at week 15 | -3,246.875 at week 15 | Same minimum, so Acquisitions I39 and I46 agree today. |

Engine consequence: one `drawCashFlow` function with `schedule` selecting the draw percentages (0.25/0.50/0.75 or 0.01/0.33/0.66) and whether to round up. Nothing else differs.

## Buy & Hold (A) versus Buy & Hold 2 (B)

B is the same layout with a 1.5MM single tenant example. Seven formula cells differ. About 30 typed inputs differ. Rows 10 to 28 of the unit table are cleared on B.

Formula differences:

| cell | value in A | value in B | meaning |
|---|---|---|---|
| E6 | empty | `=E9/0.4` | B adds "rent divided by 0.4" (33,500). Purpose unknown; possibly income needed to qualify at a 40% rent to income ratio. Feeds nothing. |
| F6 | empty | `=E6*12` | Annual version of E6 (402,000). Feeds nothing. |
| V9 | `=I23*12` | `=I8*12` | "Actual" gross rents. A uses market rents, B uses current rents (A-26). |
| V12 | `=T12*V9` | `=0.03*V9` | Cash reserves in the Actual column. B hardcodes 3%. |
| T10 | `=C41` | 0.1 | Vacancy percent for the loan test. A links to the input, B types 10%. |
| T11 | `=C40` | 0.08 | Management percent for the loan test. A links, B types 8%. |
| T15 | `=C42` | 0.2 | Maintenance plus utilities percent for the loan test. A links, B types 20%. |
| C33 | 1,400 | `=0.0063*F5` | Property tax per year. B computes 0.63% of tax value (9,450). |
| E36 | `=0.01*C5` | `=0.03*C5` | Closing costs. B uses 3% (45,000). |

Typed value differences:

| cell | value in A | value in B | meaning |
|---|---|---|---|
| C5 | 210,000 | 1,500,000 | Sale price. |
| F5 | 210,000 | 1,500,000 | Tax value. |
| H6 | CUURENT RATE ANALYSIS | empty | Header removed on B. |
| C9, D9 | 3, 2.5 | 3.5, 3 | Unit 1 beds and baths. |
| E9, F9 | 2,000; 3,000 | 13,400; 13,400 | Unit 1 rent and market rent. |
| C10:F22 | 3 beds, 2.5 or 3 baths, 0 rent | empty | Units 2 to 14 cleared on B. |
| F23 | 0 | empty | Unit 15 market rent cleared. |
| B24:B28 | 16 to 20 | empty | Unit numbers 16 to 20 cleared. |
| T12 | 0 | 0.03 | Cash reserves percent. |
| P21 | 1.00 | 0.80 | Improved value to assessed value ratio. |
| P22 | 0.21 | 0.33 | Marginal tax rate. |
| S24 | 0.025 | 0.035 | Appreciation rate. |
| E33 | 0.01 | 0.10 | Down payment percent. |
| F33 | Discount | empty | Stray label removed. |
| C34 | 100 | 32 | Insurance per month. |
| E34 | 0.07 | 0.085 | Interest rate. |
| C35 | 0 | 500 | Gas and electric per month. |
| C36 | 0 | 200 | Water per month. |
| F36 | Estimated 1% for closing | Estimated 3% for closing | Note text. |
| C37 | 0 | 200 | Sewer per month. |
| C38 | 0 | 300 | Garbage per month. |
| C39 | 0 | 300 | Lawn and snow per month. |

Key cached outputs for reference:

| cell | A | B | meaning |
|---|---|---|---|
| I16 | 1,683.33 | 10,410.50 | Monthly NOI. |
| I18 | 0.0962 | 0.0833 | Cap rate. |
| L15 | 1,383.16 | 10,380.33 | Monthly mortgage. |
| L18 | 0.8576 | 0.0019 | Annualized ROI. |
| U20 | 1.2170 | 0.6827 | Pro forma debt coverage ratio. |
| V20 | 1.9400 | 0.9642 | Actual debt coverage ratio. |

Engine consequence: one `buyAndHold` function. The B edits are three switches (tax from tax value at a rate, closing cost percent, DCR percentages linked or typed) plus the Actual column rent choice (A-26). `Buy & Hold` is the golden fixture. B's example is recorded in `spec/cells.json` and can become a second fixture once Ous says which sheet is current (A-15).
