# Anomalies

Every formula that looks wrong, inconsistent, or hardcoded. Nothing here was fixed. The engine ports each one as is, tags the line with `// ANOMALY-A-nn`, and puts the corrected behavior behind a flag that defaults to the sheet's behavior (see `docs/ARCHITECTURE.md`, section 4).

Status codes: **confirmed** (the suspect from the brief is real), **cleared** (the suspect is not present in this workbook version), **new** (found during extraction).

Each entry: ID, sheet and cell, what it computes, why it looks off, likely intent, the question for Ous in one plain sentence, and a default if he has no opinion.

## Acquisitions Deal Analyzer

### A-01 Up front ROI links to the delayed block (confirmed)
- Cell: `Aquisitions Deal Analyzer!H48` is `=H40/H39`, identical to H41. J48 is `=J47/J46`.
- Computes: "ROI on Cash" for the up front scenario from the delayed scenario's cells.
- Why off: every other cell in the up front block references rows 46 and 47.
- Likely intent: `=H47/H46`. The number is the same today because H46 and H47 hold the same formulas as H39 and H40.
- Question: Is the up front "ROI on Cash" supposed to be its own number, or a copy of the delayed one?
- Default: compute `H47/H46`. Same value, correct link.

### A-02 Transaction cost percentages use two different bases (confirmed, widened)
- Cells: F37, F38, F39 (buying) multiply by E13 (ARV). F42, F45 (selling) multiply by E13 (ARV). F43, F44 (selling recording, realtor) multiply by E11 (purchase price).
- Computes: dollar cost = rate times base.
- Why off: the column header says "% of Price". Buying costs on a purchase are normally a percent of the purchase price. Selling costs, realtor fees above all, are normally a percent of the sale price, which is ARV here. The sheet does the opposite on both sides for some rows.
- Likely intent: buying costs on purchase price, selling costs on ARV.
- Question: When you pay closing costs to buy, should the percent apply to what you paid, and when you sell, should the percent apply to what you sold for?
- Default: buying on purchase price, selling on ARV. With the current inputs this changes total buying costs from 4,500 to 3,000 and total selling costs from 8,030 to 11,280.

### A-03 Interest only rate is a formula constant (confirmed)
- Cell: E22 is `=0.14/12` inside a yellow input cell.
- Computes: monthly interest only rate of 1.1667%.
- Why off: every other financing cell is a typed number. `Example 2!B25` shows the same 14% as an annual input, which is where this came from.
- Likely intent: a 14% annual hard money rate, divided by 12.
- Question: Is 14% per year your usual hard money rate, and do you want to type the yearly rate and let the app divide by 12?
- Default: input `firstAnnualInterestOnlyRate` = 0.14, engine divides by 12.
- Resolved 2026-09-21 (Russ): the app takes an annual rate per lien and divides by 12. See D-11 in `docs/DECISIONS.md`. Reproduces the cached F22 to the cent.

### A-04 Repair costs typed by hand (confirmed)
- Cell: E12 = 20,050 typed. `Rehab Estimator!I1` = 20,050 computed. Not linked.
- Why off: a change in the checklist does not reach the deal.
- Likely intent: the same number.
- Question: Should the repair number on the deal page always come from the checklist, with a way to type over it?
- Default: link, with an override field.

### A-05 Assignment fee sign convention (cleared, with a note)
- Cells: `Quick Offers!C4, C13, C22` = -10,000 and `Aquisitions Deal Analyzer!N4` = -10,000. All four add the value. Both sheets subtract repairs the same way (`-F4*F5` on Quick Offers, `=-E12` on Acquisitions).
- The brief said Acquisitions holds a positive fee. In this version both sheets hold a negative fee and the two produce the same offer for the same repair number.
- Why still worth a question: the label says "Assignment Fee" and a user must remember to type a minus sign.
- Question: Do you think of the assignment fee as a positive number that gets taken off the offer?
- Default: the app takes a positive fee and subtracts it.

### A-06 Value block feeds nothing (confirmed)
- Cells: `Quick Offers!E13:K16`. K14 = `F14*G14/(I14*J14)`, K15 same shape, K16 = K14 - K15.
- Computes: ARV times probability of sale divided by months times effort, for "where they want" and "where they are".
- Why off: no other cell reads K14:K16.
- Question: Do you still use the "where they want / where they are" box, and what decision does it drive?
- Default: leave it out of the app until he asks for it.

### A-07 Hold time above 9 months breaks the cash flow (confirmed)
- Cells: `Delayed Draw Cash Flow!F4` = hold months times 4. Rows 6 to 41 cover weeks 1 to 36. Same on the up front sheet.
- Why off: with a 10 month hold the sale week is 40. No row has week 40, so the sale, the loan payoff, and the third draw never land, and the ending balance is deeply negative with no warning. Monthly costs also stop after week 33.
- Likely intent: the sheet was built for hold times up to 9 months.
- Question: What is the longest hold time you would ever model?
- Default: engine accepts any hold, grows the week count to hold months times 4, and shows the 36 week cap only as a display option. Flag keeps the 36 row cap for parity tests.

### A-08 Draw weeks can be fractional on the delayed sheet (confirmed)
- Cells: delayed C7:C9 = `F4*E7` with no rounding. Up front C7:C9 = `roundup($F$4*E7,0)`.
- Why off: a 4.5 month hold gives duration 18 and delayed draw weeks 4.5, 9, 13.5. SUMIF matches week numbers exactly, so draws 1 and 3 vanish from the balance. For whole month holds the delayed percentages 25/50/75 always give whole weeks.
- Question: Do you ever enter a hold time with a half month?
- Default: round up on both schedules, behind the flag.

### A-09 Frequency labels do not drive anything (confirmed, widened)
- Cells: row 4 on both draw sheets ("Weekly", "One Time", "Monthly"). `Up Front Draw Cash Flow!O4` says One Time where the delayed sheet says Monthly.
- Why off: no formula references row 4. Column O spreads monthly on both sheets (O6 = `O3/holdMonths`, O10, O14, ... check the remainder). The label difference has no effect on any number.
- Question: Should each cost's timing (one time at close, spread monthly, spread weekly, at sale) be something you can change per deal?
- Default: keep the sheet's fixed timing per column; treat the label as documentation.

### A-10 SUMIF ranges grow one row per line (confirmed)
- Cells: G6 uses `$C$6:$C44`, G7 uses `$C$6:$C45`, up to G41 with `$C$6:$C79`.
- Why off: copy paste growth. Rows past 41 are empty so the result is unchanged.
- Default: engine matches on the full cash in table. No question needed.

### A-11 Buy and Hold down payment and closing costs are placeholders (confirmed)
- Cells: `Buy & Hold!E33` = 0.01 (1% down). E36 = `=0.01*C5` with the note "Estimated 1% for closing". `Buy & Hold 2` uses 0.10 and `=0.03*C5`.
- Why off: a 1% down payment makes every ROI figure on the sheet a multiple of a very small denominator (annualized ROI 85.8%, first year appreciation ROI 250%).
- Question: What down payment and closing cost percentages do you normally use for a rental purchase?
- Default: inputs, 20% down and 3% closing, with the sheet's 1% kept only in the parity fixture.

### A-12 Tax savings block (cleared, question kept)
- Cells: S38:W38 = `(P27*P22)/L10`. P22 = 0.21 in this version, not blank as the brief said. The block computes 221% per year because L10 is the 1% down payment.
- Why still worth a question: the numbers depend entirely on A-11 and on whether Ous files taxes on these properties in a way that uses the deduction.
- Question: Do you look at the tax savings numbers when you decide on a rental?
- Default: keep the block, show it below the fold.

### A-13 Amortization sheet is a vehicle loan model (confirmed)
- Cells: B6 = `(1000*4)-B5-250`. E6:J7 split B6 by 0.35 and 0.65 across "Owner" and "VDA". Q1:U3 read "Make", "Model", "Year". P9:W9 read "Car Loan Patyment", "Insurance", "Revenue", "Investor Profit", "VDA Profit". R6 monthly revenue 15,000.
- Why off: nothing on this sheet reads any other sheet, and the labels describe a car purchased for an operator with a 35/65 profit split.
- Question: Is the amortization tab part of your real estate work, or a leftover from a different deal?
- Default: ship a plain amortization calculator (loan, rate, term, start date, payoff at month n). Leave the side table and rows 6 to 7 out of the product but keep them in the engine behind a flag for parity.

### A-14 TODAY() drives the amortization dates (confirmed)
- Cell: C10 = `=today()`. Cached value 2026-09-14.
- Why off: the schedule shifts every day the file is opened.
- Default: `startDate` input. Fixture records the cached date. No question needed.

### A-15 Buy and Hold versus Buy and Hold 2 (confirmed, more than three cells)
- The two sheets differ in seven formula cells and about 30 typed values, not three. See `spec/SHEET_DIFFS.md`.
- Question: Which of the two rental tabs is the one you use now, and is the other one safe to drop?
- Default: `Buy & Hold` is the fixture. Buy & Hold 2's edits (tax from tax value at 0.63%, closing at 3%, hardcoded DCR percentages) are recorded and can be turned on later.

### A-16 Sheet names and labels carry typos (confirmed, cosmetic)
- `Aquisitions Deal Analyzer` (Acquisitions), `PURCHSE AND REPAIR COSTS`, `CUURENT RATE ANALYSIS`, `Exterion`, `Sinding`, `Plumbimg`, `Kitcken`, `Refridgerator`, `Reframe Stucture`, `per squre foot cost`, `Car Loan Patyment`. The Fields sheet is named `Deal Analyzer Fields`, spelled correctly; the brief's `Fiels` does not appear.
- Default: the app uses correct spelling. Tooltips from `Definitions` are clean.

### A-17 Construction cost test at week 11 subtracts 15 instead of the week 10 cost (new)
- Cells: `Delayed Draw Cash Flow!L16` and `Up Front Draw Cash Flow!L16` are `=if((L3-L6-L7-L8-L9-L10-L11-L12-L13-L14-15)>0.1,L15,0)`. Every other row subtracts the previous cells; this row subtracts the literal number 15 where `L15` was meant.
- Effect: the "is there cost left" test at week 11 is too generous by one week's cost minus 15 dollars. With a 10 week duration (2.5 month hold) the sheet places an eleventh week of construction cost, and L43 "Unaccounted Costs" goes negative. With the current 16 week hold there is no effect.
- Question: none needed for a non engineer. Confirm in passing that construction cost should stop once the budget is spent.
- Default: corrected form `-L15` behind the flag.

### A-18 Up front "cash to cover" returns the minimum even when it is positive (new)
- Cell: I46 = `=-if(min(H6:H41)<0, min(...), min(...))`. Both branches return the minimum. I39 (delayed) returns 0 when the minimum is positive.
- Effect: when the up front schedule never dips below zero, I46 becomes a negative "cash to cover" and reduces cash invested, inflating the up front ROI. Today both minimums are negative so both give 3,246.88.
- Likely intent: same as I39.
- Question: If the bank balance never goes negative, should the extra cash needed be zero?
- Default: zero, matching I39, behind the flag.

### A-19 Cash invested excludes buying transaction costs (new)
- Cells: N11, H39, H46 = `J10+J11` (financing plus holding). Buying costs J12 are paid out of the same starting cash on the draw sheets (X6, Y6, Z6 are week 1 expenses) but are not counted in the denominator of ROI on cash.
- Effect: ROI on cash is higher than cash out of pocket would suggest. With current inputs: 44,453 over 22,967 = 1.94x. Including buying costs it is 44,453 over 27,467 = 1.62x.
- Question: When you say "cash invested" in a flip, does that include your closing costs at purchase?
- Default: keep the sheet's definition; expose a second figure that includes buying costs.

### A-20 Quick Offers per square foot defaults exceed the ARV (new)
- Cells: F5:F7 = 150, 100, 60 per sqft, F4 = 2,000 sqft. Full rehab repair costs 300,000 against a 300,000 ARV. Full offer C7 = -100,000, medium offer C16 = 0, light offer C25 = 80,000.
- Why off: a negative offer is not usable. 150 per sqft is a full gut in an expensive market.
- Question: What per square foot numbers do you actually use for full, medium, and light rehab, and for which market?
- Default: keep the sheet's numbers as the prefill and let Ous edit them on the page.

### A-21 Second mortgage interest is not multiplied by hold time (new)
- Cell: F25 = `=E25*$E$23`. Compare F21 = `=E21*E19*E9` (first mortgage interest times hold months) and F26 = `=E26*$E$23*E9`.
- Effect: second lien interest is charged once, not per month. Zero today because E23 = 0.
- Likely intent: same shape as F21.
- Question: If you took a second loan at, say, 1% per month, should the deal charge that for every month you hold?
- Default: multiply by hold months, behind the flag.
- Resolved 2026-09-21 (Russ): with the annual rate input the second lien accrues per hold month like the first. See D-11. The flag still governs the raw workbook cell for parity tests.

### A-22 Holding cost "Utilities" has no column on the draw sheets (new)
- Cells: Acquisitions J22, K22 flow into total holding costs J32. The draw sheets carry gas (T), water (U), electricity (V), miscellaneous (W) but nothing for J22.
- Effect: any amount typed in J22 raises the P&L holding costs but never leaves the bank balance on the cash flow. Excess cash and net profit then disagree. Zero today.
- Question: Is "Utilities" a total you type when you do not know the breakdown, or a separate bill?
- Default: treat J22 as a fourth utility line that the cash flow spreads monthly, behind the flag.

### A-23 Property tax rate default is 8.75% of as-is value per year (new)
- Cell: J19 = 0.0875 and K19 = `((J19*E10)/12)*E9`.
- Why off: 8.75% per year on 200,000 is 17,500 per year, several times a normal residential tax bill. The Fields sheet shows 2.2% as its example.
- Question: What is a normal yearly property tax on the houses you buy, as a percent of value or as dollars?
- Default: keep the formula, prefill 2.2% from the Fields sheet.

### A-24 Property taxes and HOA land in week 1 on the cash flow (new)
- Cells: Q6 = `=Q3`, R6 = `=R3` (one time at week 1). Insurance and utilities spread monthly.
- Why off: both are recurring bills. Paying the full hold's taxes in week 1 makes week 1 look worse than reality and the later weeks better.
- Question: Do you pay property taxes and HOA dues up front on a flip, or as they come due?
- Default: keep week 1 for parity; monthly spread behind the flag.

### A-25 Required debt coverage ratio is never checked (new)
- Cell: `Buy & Hold!T6` = 1.25 "Debt Coverage Ratio Required". U20 and V20 compute ratios. No cell compares them to T6.
- Question: Should the rental page say yes or no to "qualifies for a commercial loan" based on your 1.25 rule?
- Default: add a pass/fail output, no engine math changes.

### A-26 Pro Forma and Actual columns swap rent sets (new)
- Cells: `Buy & Hold!U9` = current rents times 12 under the "Pro Forma" header. V9 = market rents times 12 under "Actual". V15 = `(I12+I14)*12` uses the current rent maintenance reserve (I14) while the rest of column V uses market rents; I29 (market maintenance) is unused. `Buy & Hold 2` sets V9 to current rents as well, so both columns use the same rents there.
- Question: On the loan test, which column should use the rent the tenants pay today and which the rent you expect after improvements?
- Default: U = current rents, V = market rents, all rows consistent, behind the flag.

### A-27 ARV factor is hardcoded in four places (new)
- Cells: `Quick Offers!C3, C12, C21` and `Aquisitions Deal Analyzer!N3` all multiply by 0.7.
- Question: Do you always use 70% of ARV, or does it move by market or by deal type?
- Default: one input, default 0.70.

### A-28 Amortization day counts ignore leap years (new)
- Cells: D2:O2 hold 31, 28, 31, ... typed. A10:A69 pick the count by month. C11 = C10 + A10.
- Effect: from 2028-02 the dates drift one day per leap year. Cosmetic for a payment schedule.
- Default: engine uses real calendar month lengths behind the flag; parity mode uses the typed table.

### A-29 Rehab Estimator rows with no unit cost (new)
- Cells: H39:H42 are empty. G39:G42 hold text pricing rules ("$500 Carpet Rule: Sq ft / 9 x $10", "Hardwood Install = $7.00 sq/ft"). Rows 24, 26, 38, 68 have no answer cell.
- Effect: those lines can never add to the total.
- Question: For carpet, vinyl, and hardwood, what unit cost and unit (per sqft, per room) do you want?
- Default: unit costs from the text rules (carpet 1.11 per sqft, vinyl 700 per 10x10 kitchen, hardwood 7.00 per sqft install, 2.75 per sqft refinish) proposed, not applied.

### A-30 Rehab option rows sit under the wrong item number (new)
- Cells: item 24 "Decks" (B63) sits on the "Dumpster High" row. Rows 62 to 65 are dumpster options, rows 66 to 68 are deck options. Item 13 "Tile/Vinyl" (B38) sits on "Three Family Home". Item 14 "sanded" (B39) sits on a carpet rule.
- Effect: none on totals. It affects how the app groups options under questions.
- Default: group by the option text, and confirm the grouping with Ous on the Rehab page.

### A-31 Formula cells styled as inputs (new, cosmetic)
- Cells: Acquisitions K28:K31 are formulas with yellow fill. Amortization R6, S10:T69, W10:W69 are yellow. Buy & Hold H6 (a header) is yellow. Quick Offers has only three yellow cells although comps, square footage, and per sqft costs are typed.
- Effect: the yellow fill rule from row 2 of the draw sheets does not hold across the workbook. `spec/cells.json` records fill per cell and applies the blue rule on the Buy and Hold sheets.
- Default: the Fields sheets and this spec decide what is an input, not the fill.

### A-32 Duration uses 4 weeks per month (new)
- Cell: F4 = `holdMonths * 4`. Monthly costs are placed every 4 weeks.
- Effect: a 12 month hold is 48 weeks, not 52. Interest and holding costs are already computed per month on the Acquisitions sheet, so only the placement changes.
- Default: keep 4 for parity. No question unless the cap in A-07 is lifted.

### A-33 Total deductions always use year 1 depreciation (new, harmless)
- Cells: P27, P30, P33, P36, P39 = `SUM($P$25+P26)` and so on. P25 is absolute. Depreciation is the same every year so the value is right. The link is fragile.
- Default: engine computes depreciation per year and sums per year. No question.

### A-34 Cash in table label rows shift between the two draw sheets (new, cosmetic)
- Cells: delayed B13:B17 "Other Expense 1..5". Up front B14:B18. The up front sheet's B13 is empty.
- Effect: none. Both sheets have empty week and amount cells for the other expenses.
- Default: five optional other expense rows in the engine, each with a week and an amount.

## Summary

| ID | Status | Impact today | Needs Ous |
|---|---|---|---|
| A-01 | confirmed | none | low |
| A-02 | confirmed | 4,500 buying and 8,030 selling would become 3,000 and 11,280 | high |
| A-03 | confirmed | none | medium |
| A-04 | confirmed | none | medium |
| A-05 | cleared | none | low |
| A-06 | confirmed | none | low |
| A-07 | confirmed | none at 4 months | high |
| A-08 | confirmed | none at 4 months | medium |
| A-09 | confirmed | none | low |
| A-10 | confirmed | none | no |
| A-11 | confirmed | large on every rental ROI | high |
| A-12 | cleared | depends on A-11 | medium |
| A-13 | confirmed | scope | high |
| A-14 | confirmed | dates | no |
| A-15 | confirmed | scope | high |
| A-16 | confirmed | none | no |
| A-17 | new | none at 16 weeks | low |
| A-18 | new | none today | low |
| A-19 | new | 1.94x versus 1.62x | high |
| A-20 | new | negative offers on the Quick Offers page | high |
| A-21 | new | none today | low |
| A-22 | new | none today | medium |
| A-23 | new | 5,833 of holding costs | high |
| A-24 | new | week 1 balance | medium |
| A-25 | new | missing output | low |
| A-26 | new | DCR numbers | medium |
| A-27 | new | none | low |
| A-28 | new | dates after 2028 | no |
| A-29 | new | lines stuck at 0 | medium |
| A-30 | new | grouping | low |
| A-31 | new | none | no |
| A-32 | new | none | no |
| A-33 | new | none | no |
| A-34 | new | none | no |
