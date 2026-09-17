# Formula Specification

Source: `Deal Analyzer + Rehab Estimator.xlsx` (sha256 in `spec/cells.json`). Cached values were computed by the workbook on 2026-09-14, the date `TODAY()` returned at last save.

Conventions used in this document:

- Names are the proposed camelCase identifiers for the engine.
- Math is written with those names. No bare cell references appear in a math column.
- `hardcoded` marks a constant that lives inside a formula. Each one has a proposal.
- Percent inputs are stored as fractions (0.03 means 3%). The min and max columns are proposed UI bounds, not workbook rules.
- Units: USD, percent, months, weeks, count, sqft, Yes/No, date, text.
- Anomaly IDs (A-nn) refer to `spec/ANOMALIES.md`.

Calculators in dependency order:

1. Quick Offers
2. Rehab Estimator
3. Acquisitions Deal Analyzer
4. Draw Cash Flow (one model, `schedule` parameter)
5. Buy and Hold
6. Amortization Schedule

---

## 1. Quick Offers

Sheet `Quick Offers`. Three offer blocks (full, medium, light) that share one ARV and one square footage. Only the three assignment fee cells carry the yellow input fill. The comps, square footage, and per square foot costs are typed constants without input styling and are treated as inputs here.

### 1.1 Inputs

| name | label | cell | current value | unit | source |
|---|---|---|---|---|---|
| comps[0..2] | average of 3 comps | H3, I3, J3 | 300,000 each | USD | Comparative Analysis or Appraisal |
| squareFeet | Square Footage | F4 | 2,000 | sqft | Total Square Footage (Definitions) |
| assignmentFeeFull | Assignment Fee | C4 | -10,000 | USD, entered negative | How Much You wanna Make (Fields) |
| assignmentFeeMedium | Assignment Fee | C13 | -10,000 | USD, entered negative | same |
| assignmentFeeLight | Assignment Fee | C22 | -10,000 | USD, entered negative | same |
| costPerSqftFull | Full Rehab, per squre foot cost | F5 | 150 | USD per sqft | none given |
| costPerSqftMedium | Medium Rehab, per squre foot cost | F6 | 100 | USD per sqft | none given |
| costPerSqftLight | Light Rehab, per squre foot cost | F7 | 60 | USD per sqft | none given |
| valueWant.probabilityOfSale | Where they want, Probability of Sale | G14 | 0.60 | percent | none given |
| valueWant.timeMonths | Where they want, Time (Months) | I14 | 1 | months | none given |
| valueWant.effort | Where they want, Effort | J14 | 1 | count | none given |
| valueAre.probabilityOfSale | Where they are, Probability of Sale | G15 | 1.00 | percent | none given |
| valueAre.timeMonths | Where they are, Time (Months) | I15 | 5 | months | none given |
| valueAre.effort | Where they are, Effort | J15 | 5 | count | none given |

Percent bounds: probabilityOfSale min 0, max 1, current 0.60 and 1.00.

Hardcoded constants:

| constant | value | where | proposal |
|---|---|---|---|
| arvFactor | 0.70 | C3, C12, C21 (and Acquisitions N3) | Make it an input with default 0.70. Ous may use other factors for different markets. See A-27. |

### 1.2 Derived values

Shared:

```
arv               = average(comps)                      K3, copied to F3
seventyPercentArv = arv * arvFactor                     C3, C12, C21 (arvFactor hardcoded 0.70)
```

Per tier (tier in full, medium, light):

```
allInMaxLimit[tier] = seventyPercentArv + assignmentFee[tier]      C5, C14, C23 (fee is negative, so this subtracts)
repairCosts[tier]   = -(squareFeet * costPerSqft[tier])            C6, C15, C24 (stored negative)
offer[tier]         = allInMaxLimit[tier] + repairCosts[tier]      C7, C16, C25
pctOfArv[tier]      = offer[tier] / arv                            C8, C17, C26
```

Value block (feeds nothing else, see A-06):

```
valueWantPrice   = arv                                                          F14
valueArePrice    = arv                                                          F15
valueWant        = valueWantPrice * valueWant.probabilityOfSale / (valueWant.timeMonths * valueWant.effort)   K14
valueAre         = valueArePrice  * valueAre.probabilityOfSale  / (valueAre.timeMonths  * valueAre.effort)    K15
valueDifference  = valueWant - valueAre                                         K16
```

TypeScript:

```ts
type QuickOffersInput = {
  comps: [number, number, number];
  squareFeet: number;
  assignmentFee: { full: number; medium: number; light: number }; // negative as in the sheet
  costPerSqft: { full: number; medium: number; light: number };
  valueWant: { probabilityOfSale: number; timeMonths: number; effort: number };
  valueAre: { probabilityOfSale: number; timeMonths: number; effort: number };
  arvFactor?: number; // default 0.70
};
type OfferTier = { seventyPercentArv: number; allInMaxLimit: number; repairCosts: number; offer: number; pctOfArv: number };
type QuickOffersOutput = {
  arv: number;
  full: OfferTier; medium: OfferTier; light: OfferTier;
  valueWant: number; valueAre: number; valueDifference: number;
};
declare function quickOffers(input: QuickOffersInput): QuickOffersOutput;
```

### 1.3 Outputs

| name | label | cell | current cached value |
|---|---|---|---|
| arv | ARV (after repair value) | F3, K3 | 300,000 |
| full.seventyPercentArv | 70% of ARV | C3 | 210,000 |
| full.allInMaxLimit | All In Max Limit | C5 | 200,000 |
| full.repairCosts | Repair Costs | C6 | -300,000 |
| full.offer | Offer | C7 | -100,000 |
| full.pctOfArv | % of ARV | C8 | -0.3333333333 |
| medium.seventyPercentArv | 70% of ARV | C12 | 210,000 |
| medium.allInMaxLimit | All In Max Limit | C14 | 200,000 |
| medium.repairCosts | Repair Costs | C15 | -200,000 |
| medium.offer | Offer | C16 | 0 |
| medium.pctOfArv | % of ARV | C17 | 0 |
| light.seventyPercentArv | 70% of ARV | C21 | 210,000 |
| light.allInMaxLimit | All In Max Limit | C23 | 200,000 |
| light.repairCosts | Repair Costs | C24 | -120,000 |
| light.offer | Offer | C25 | 80,000 |
| light.pctOfArv | % of ARV | C26 | 0.2666666667 |
| valueWant | Value (where they want) | K14 | 180,000 |
| valueAre | Value (where they are) | K15 | 12,000 |
| valueDifference | Value | K16 | 168,000 |

The full and medium offers are negative or zero with the current defaults. See A-20.

---

## 2. Rehab Estimator

Sheet `Rehab Estimator`. 25 numbered checklist items (column A) spread over rows 3 to 69. Each row is one priced option: a Yes/No answer (E, data validation list Yes/No from E1:F1), a quantity (F), a unit cost (H), and a line total (I). Rows without an answer cell or a unit cost always compute 0.

### 2.1 Inputs

| name | label | cell | current value | unit | source |
|---|---|---|---|---|---|
| address | Address | B1 | Address: Bagley Avenue | text | none |
| lines[n].answer | Yes/No | E3:E69 | see table | Yes/No | Inspection |
| lines[n].quantity | # of Units | F3:F69 | see table | count (or sqft for per sqft rows) | Inspection |
| lines[n].unitCost | Repair Cost Calculations | H3:H69 | see table | USD | Fields sheet points to homeguide.com cost estimates |

The Fields sheet (`Rehab Estimator Fields`) restates the 25 item questions and notes that roof needs a Single/Multi choice and a shingle Low/High choice. It does not add fields beyond the sheet.

Full line table (row, item number, question, option, answer, quantity, unit cost, cached line total):

| row | item | question | option | answer | qty | unit cost | line total |
|---|---|---|---|---|---|---|---|
| 3 | 1 | Need a Roof? | Single? | Yes | 1 | 6,000 | 6000 |
| 4 |  |  | Full Roof  Multi Unit |  | 0 | 9,000 | 0 |
| 5 |  |  | 1 Layer of Shingles Added  Low |  | 0 | 2,500 | 0 |
| 6 |  |  | 1 Layer of Shingles Added  High |  | 0 | 3,000 | 0 |
| 7 | 2 | Exterion Paint/Siding? | Paint Single Fam Home | Yes | 1 | 3,000 | 3000 |
| 8 |  |  | Paint Multi Fam  Low  1500sq ft |  | 0 | 6,000 | 0 |
| 9 |  |  | Paint Multi Fam  Low  3000sq ft |  | 0 | 7,000 | 0 |
| 10 |  |  | Sinding Single Fam  Low  1500sq ft |  | 0 | 7,000 | 0 |
| 11 |  |  | Siding Multi Fam  Low  3000sq ft |  | 0 | 11,000 | 0 |
| 12 | 3 | Need Windows? | Cost/Window | Yes | 20 | 250 | 5000 |
| 13 | 4 | Garage Repair? | Garage Door | Yes | 1 | 550 | 550 |
| 14 |  |  | Reframe Stucture |  | 0 | 1,500 | 0 |
| 15 |  |  | 1 Car Garage Paint |  | 0 | 500 | 0 |
| 16 |  |  | 2 Car Garage Paint |  | 0 | 1,000 | 0 |
| 17 |  |  | Roof |  | 0 | 2,000 | 0 |
| 18 | 5 | Yard Cleaned/Landscapes | Clean Yard  Easy | Yes | 1 | 5,000 | 5000 |
| 19 |  |  | Clean Yard  Hard |  | 0 | 750 | 0 |
| 20 |  |  | Landscape  Easy | Yes | 1 | 500 | 500 |
| 21 |  |  | Landscape  Hard | No | 0 | 1,000 | 0 |
| 22 | 6 | Heating or Furnaces Need Replacing? | Replace Furnace | No | 1 | 1,500 | 0 |
| 23 |  |  | Replace Hot Water Heater | No | 1 | 600 | 0 |
| 24 |  |  | Install Zone Baseboard Heater Gut Job |  |  | 4,500 | 0 |
| 25 | 7 | Plumbimg need Repair? | New Plumbimg/Floor | No | 1 | 2,500 | 0 |
| 26 | 8 | Electrical Need Repair | New Panel |  |  | 1,500 | 0 |
| 27 |  |  | # of Floor Fixtures That needs new Fixtures |  | 0 | 200 | 0 |
| 28 |  |  | #of floors  Rewire House w/ New Service |  | 0 | 4,000 | 0 |
| 29 | 9 | Foundation Need Repair? | Reframe Support Beam |  | 0 | 300 | 0 |
| 30 | 10 | Basement Need Repair? | Seal Basement |  | 0 | 250 | 0 |
| 31 |  |  | # of 5yard Increments  Pour Concrete Floor |  | 0 | 800 | 0 |
| 32 |  |  | Replace Stairwell |  | 0 | 1,000 | 0 |
| 33 |  |  | Jack 1 Support Beam |  | 0 | 200 | 0 |
| 34 | 11 | Need Interior Paint | # of square FT | No | 1,400 | 2 | 0 |
| 35 |  |  | Single Family 1500 sf ft |  | 0 | 2,500 | 0 |
| 36 |  |  | Three Family Home 3000 sq ft |  | 0 | 4,500 | 0 |
| 37 | 12 | House Need Carpet? | Single Family Carpet | No | 1 | 1,500 | 0 |
| 38 | 13 | House Need Tile/Vinyl | Three Family Home |  |  | 2,000 | 0 |
| 39 | 14 | Floor need to be sanded? | 1 Unit Carpet  500 sq ft : $500 Carpet Rule:Sq ft. / 9 x $10=Cost |  | 0 |  | 0 |
| 40 |  |  | 1 Unit Carpet  500 sq ft : $500 Carpet Rule:Sq ft. / 9 x $10=Cost |  | 0 |  | 0 |
| 41 |  |  | 1 Kitchen Vinyl tiles  10x10  = $700 |  | 0 |  | 0 |
| 42 |  |  | Hardwood Install = $7.00 sq/ft Sand & Refinish= $2.75sq/ft |  | 0 |  | 0 |
| 43 | 15 | Unit 1 Kitchen Need Repair | Single Fam Rental | No | 0 | 2,000 | 0 |
| 44 | 16 | Unit 2 Kitcken Need Repair? | Three Fam Rental |  | 0 | 6,000 | 0 |
| 45 | 17 | Unit 3 Kitchen Need Repair? | Single Fam Owner |  | 0 | 3,500 | 0 |
| 46 |  |  | Three Fam Owner |  | 0 | 7,500 | 0 |
| 47 |  |  | Single Family Nice |  | 0 | 4,000 | 0 |
| 48 | 18 | Kitchen Need Appliances? | Stove |  | 0 | 350 | 0 |
| 49 |  |  | Refridgerator |  | 0 | 500 | 0 |
| 50 |  |  | Overhead Microwave |  | 0 | 200 | 0 |
| 51 |  |  | Dishwasher |  | 0 | 250 | 0 |
| 52 | 19 | Unit 1 Bath need Repair? | Redo Full Bath | No | 1 | 1,500 | 0 |
| 53 | 20 | Unit 2 Bath need Repair? | Redo Half Bath |  | 0 | 1,000 | 0 |
| 54 | 21 | Unit 3 Bath need Repair? | Fixtures only Full Bath |  | 0 | 500 | 0 |
| 55 |  |  | Fixtures Only Half Bath |  | 0 | 350 | 0 |
| 56 | 22 | Sheetrock damaged or Need Replacing? | # of Square FT  Total Gut Job |  | 0 | 3 | 0 |
| 57 |  |  | Single Fam Patch  Low |  | 0 | 500 | 0 |
| 58 |  |  | Single Fam Patch  High |  | 0 | 1,000 | 0 |
| 59 |  |  | Single Fam Gut Rock/Tape  Low |  | 0 | 9,000 | 0 |
| 60 |  |  | Single Fam Gut Rock/Tape  High |  | 0 | 10,000 | 0 |
| 61 |  |  | Patch Area  10x10 |  | 0 | 300 | 0 |
| 62 | 23 | Dumpsters | Dumpster  Low | No | 1 | 500 | 0 |
| 63 | 24 | Decks | Dumpster  High |  | 0 | 600 | 0 |
| 64 |  |  | Single Family Patch 3 Dumps |  | 0 | 1,000 | 0 |
| 65 |  |  | Family Gut |  | 0 | 3,500 | 0 |
| 66 |  |  | Deck  10x10 |  | 0 | 2,000 | 0 |
| 67 |  |  | Deck  15x15 |  | 0 | 3,500 | 0 |
| 68 |  |  | 3 Family w/ Fire Escape |  |  | 5,000 | 0 |
| 69 | 25 | Miscellaneous | # of Square Ft |  | 0 | 0.50 | 0 |

Rows 39 to 42 carry a pricing rule as text and no unit cost (A-30). Rows 63 to 65 are dumpster options that sit under item 24 "Decks" (A-31).

### 2.2 Derived values

```
lineTotal[n] = answer[n] == "Yes" ? unitCost[n] * quantity[n] : 0     I3:I69
total        = sum(lineTotal)                                          I1 (= SUM(I2:I69); I2 is a text header and adds nothing)
```

TypeScript:

```ts
type RehabLine = { row: number; itemNumber: number | null; question: string | null; option: string | null;
                   answer: "Yes" | "No" | null; quantity: number | null; unitCost: number | null };
type RehabEstimatorInput = { address?: string; lines: RehabLine[] };
type RehabEstimatorOutput = { lineTotals: number[]; total: number };
declare function rehabEstimator(input: RehabEstimatorInput): RehabEstimatorOutput;
```

### 2.3 Outputs

| name | label | cell | current cached value |
|---|---|---|---|
| total | TOTAL ESTIMATED REPAIR COST | I1 | 20,050 |
| lineTotals | Repair Cost | I3:I69 | see table above (nonzero: I3 6,000; I7 3,000; I12 5,000; I13 550; I18 5,000; I20 500) |

---

## 3. Acquisitions Deal Analyzer

Sheet `Aquisitions Deal Analyzer` (sheet name typo is the workbook's, A-16). Flip profit and loss. Pulls two ROI figures from the draw cash flow sheets.

### 3.1 Inputs

Where to find (source) comes from `Deal Analyzer Fields` column E.

| name | label | cell | current value | unit | source |
|---|---|---|---|---|---|
| holdMonths | Estimated Hold Time months | E9 | 4 | months | Contractor + Realtor |
| asIsValue | Current "As-Is" Value | E10 | 200,000 | USD | Tax Assessment |
| purchasePrice | Purchase Price | E11 | 200,000 | USD | Purchase Agreement or estimate |
| repairCosts | Estimated Repair Costs | E12 | 20,050 | USD | Quotes from Handymen or General Contractor. Typed by hand, equals Rehab Estimator I1 (A-04) |
| arv | After Repair Value | E13 | 300,000 | USD | Comparative Analysis or Appraisal |
| assignmentFee | Assignment Fee | N4 | -10,000 | USD, entered negative | How Much You wanna Make |
| firstLienAmount | First Mortgage / Lien Amount | E19 | 200,000 | USD | Hard Money or Private Lender |
| firstPointsRate | First Mortgage Points | E20 | 0.03 | percent (min 0, max 0.15) | same |
| firstInterestRate | First Mortgage Interest | E21 | 0.00 | percent (min 0, max 0.30) | same |
| firstMonthlyInterestOnlyRate | First Mortgage Monthly Interest Only Payment | E22 | 0.0116667 (formula `=0.14/12`, A-03) | percent per month (min 0, max 0.03) | same |
| secondLienAmount | Second Mortgage / Lien Amount | E23 | 0 | USD | same |
| secondPointsRate | Second Mortgage Points | E24 | 0.10 | percent (min 0, max 0.15) | same |
| secondInterestRate | Second Mortgage Interest | E25 | 0.00 | percent (min 0, max 0.30) | same |
| secondMonthlyInterestOnlyRate | Second Mortgage Monthly Interest Only Payment | E26 | 0.00 | percent per month (min 0, max 0.03) | same |
| miscLienAmountPaid | Misc. Mortgage / Lien Amount | F27 | 0 | USD (amount, no rate cell) | same |
| miscPointsPaid | Misc. Mortgage Points | F28 | 0 | USD | same |
| miscInterestPaid | Misc. Mortgage Interest | F29 | 0 | USD | same |
| miscMonthlyInterestOnlyPaid | Misc. Mortgage Monthly Interest Only Payment | F30 | 0 | USD | same |
| miscFinancingCosts | Miscellaneous Financing Costs | F31 | 0 | USD | same |
| propertyTaxRate | Property Taxes (annual rate on as-is value) | J19 | 0.0875 | percent per year (min 0, max 0.10) | County or City Website |
| hoaMonthly | HOA & Condo Fees | J20 | 0 | USD per month | HOA |
| insuranceMonthly | Insurance Costs | J21 | 100 | USD per month | Insurance Broker |
| utilitiesMonthly | Utilities | J22 | 0 | USD per month | Utility Company Website |
| gasMonthly | Gas | J23 | 150 | USD per month | Utility Company Website |
| waterMonthly | Water | J24 | 100 | USD per month | Utility Company Website |
| electricityMonthly | Electricity | J25 | 100 | USD per month | Utility Company Website |
| miscUtilitiesMonthly | Miscellaneous | J26 | empty (0) | USD per month | Utility Company Website |
| miscHoldingMonthly[0..3] | Miscellaneous Holding Costs | J28:J31 | empty (0) | USD per month | Miscellaneous |
| buyEscrowRate | Escrow / Attorney Fees (% of Price) | E37 | 0.005 | percent (min 0, max 0.05) | The Attorney |
| buyTitleRate | Title Insurance / Search Costs | E38 | 0.01 | percent (min 0, max 0.05) | Title Company |
| buyMiscRate | Miscellaneous Buying Costs | E39 | 0 | percent (min 0, max 0.05) | Miscellaneous |
| sellEscrowRate | Escrow / Attorney Fees | E42 | 0.005 | percent (min 0, max 0.05) | The Attorney |
| sellRecordingRate | Selling Recording Fees | E43 | 0.0025 | percent (min 0, max 0.02) | Title Company |
| sellRealtorRate | Realtor Fees | E44 | 0.03 | percent (min 0, max 0.07) | Miscellaneous |
| sellTransferRate | Transfer & Conveyance Fees | E45 | 0.0001 | percent (min 0, max 0.03) | Local City or State Municipality |
| sellHomeWarranty | Home Warranty | F46 | 0 | USD | none |
| sellStaging | Staging Costs | F47 | 0 | USD | none |
| sellMarketing | Marketing Costs | F48 | 0 | USD | none |
| sellMisc | Miscellaneous Selling Costs | F49 | 0 | USD | none |

Property information cells (address B3, square footage B4, units B5, occupied B6) have no value cells filled and feed no formula. They are text fields for the record.

Hardcoded constants:

| constant | value | where | proposal |
|---|---|---|---|
| arvFactor | 0.70 | N3 | Same input as Quick Offers. |
| firstMonthlyInterestOnlyRate | 0.14 / 12 | E22 | It is an input cell that holds a formula. Store 0.14 as an annual rate input and divide by 12 in the engine, or accept the monthly rate directly. See A-03. |
| weeksPerMonth | 4 | draw sheets F4 | See section 4. |

### 3.2 Derived values

Offer block (same math as Quick Offers, with repairCosts from E12):

```
seventyPercentArv = arv * arvFactor                                   N3
allInMaxLimit     = seventyPercentArv + assignmentFee                 N5 (fee negative)
offerRepairCosts  = -repairCosts                                      N6
offer             = allInMaxLimit + offerRepairCosts                  N7
offerPctOfArv     = offer / arv                                       N8
```

Financing projection:

```
firstPointsPaid        = firstPointsRate * firstLienAmount                             F20
firstInterestPaid      = firstInterestRate * firstLienAmount * holdMonths              F21
firstInterestOnlyPaid  = firstMonthlyInterestOnlyRate * firstLienAmount * holdMonths   F22
secondPointsPaid       = secondPointsRate * secondLienAmount                           F24
secondInterestPaid     = secondInterestRate * secondLienAmount                         F25  (no holdMonths factor, unlike F21; A-21)
secondInterestOnlyPaid = secondMonthlyInterestOnlyRate * secondLienAmount * holdMonths F26
totalFinancingCosts    = firstPointsPaid + firstInterestPaid + firstInterestOnlyPaid
                       + secondPointsPaid + secondInterestPaid + secondInterestOnlyPaid
                       + miscLienAmountPaid + miscPointsPaid + miscInterestPaid
                       + miscMonthlyInterestOnlyPaid + miscFinancingCosts                E32 (= SUM(F19:F31); F19 and F23 are empty)
```

Holding costs:

```
propertyTaxesTotal   = (propertyTaxRate * asIsValue / 12) * holdMonths     K19
hoaTotal             = hoaMonthly * holdMonths                              K20
insuranceTotal       = insuranceMonthly * holdMonths                        K21
utilitiesTotal       = utilitiesMonthly * holdMonths                        K22
gasTotal             = gasMonthly * holdMonths                              K23
waterTotal           = waterMonthly * holdMonths                            K24
electricityTotal     = electricityMonthly * holdMonths                      K25
miscUtilitiesTotal   = miscUtilitiesMonthly * holdMonths                    K26
totalMaintenanceCosts = sum(propertyTaxesTotal .. miscUtilitiesTotal)       J27
miscHoldingTotal[i]  = holdMonths * miscHoldingMonthly[i]                   K28:K31
totalHoldingCosts    = totalMaintenanceCosts + sum(miscHoldingTotal)        J32 (= SUM(K19:K31), K27 empty)
```

Buying transaction costs (base is ARV, header says "% of Price", A-02):

```
buyEscrow         = buyEscrowRate * arv                  F37
buyTitle          = buyTitleRate * arv                   F38
buyMisc           = buyMiscRate * arv                    F39
totalBuyingCosts  = buyEscrow + buyTitle + buyMisc       J12
```

Selling transaction costs (mixed bases, A-02):

```
sellEscrow        = sellEscrowRate * arv                          F42
sellRecording     = sellRecordingRate * purchasePrice             F43
sellRealtor       = sellRealtorRate * purchasePrice               F44
sellTransfer      = sellTransferRate * arv                        F45
totalSellingCosts = sellEscrow + sellRecording + sellRealtor + sellTransfer
                  + sellHomeWarranty + sellStaging + sellMarketing + sellMisc     J13 (= SUM(F42:F49))
```

Deal summary:

```
purchaseAndRepairCosts = -(purchasePrice + repairCosts)                                        E14
netProfit              = arv - (purchasePrice + repairCosts + totalFinancingCosts
                               + totalHoldingCosts + totalBuyingCosts + totalSellingCosts)     J14
cashInvested           = totalFinancingCosts + totalHoldingCosts                               N11, H39, H46
cashReturn             = netProfit                                                             N12, H40, H47
roiOnCash              = cashReturn / cashInvested                                             N13, H41, H48
timeToReturn           = holdMonths + " Months"                                                N14, H42, J42, H49, J49 (text)
```

Draw scenario ROI (pulls the weekly balance column from each draw sheet):

```
delayedCashToCover   = minBalance(delayed) < 0 ? -minBalance(delayed) : 0                     I39
delayedTotalCash     = cashInvested + delayedCashToCover                                        J39
delayedActualRoi     = cashReturn / delayedTotalCash                                            J41
upfrontCashToCover   = -minBalance(upfront)          (both IF branches return the min, A-18)    I46
upfrontTotalCash     = cashInvested + upfrontCashToCover                                        J46
upfrontActualRoi     = cashReturn / upfrontTotalCash                                            J48
```

H48 is `=H40/H39`, a copy of H41, where J48 is `=J47/J46`. See A-01.

TypeScript:

```ts
type AcquisitionsInput = {
  holdMonths: number; asIsValue: number; purchasePrice: number; arv: number;
  repairCosts: number;               // linked to rehabEstimator().total unless overridden
  repairCostsOverride?: number;
  assignmentFee: number;
  firstLienAmount: number; firstPointsRate: number; firstInterestRate: number; firstMonthlyInterestOnlyRate: number;
  secondLienAmount: number; secondPointsRate: number; secondInterestRate: number; secondMonthlyInterestOnlyRate: number;
  miscLienAmountPaid: number; miscPointsPaid: number; miscInterestPaid: number; miscMonthlyInterestOnlyPaid: number; miscFinancingCosts: number;
  propertyTaxRate: number; hoaMonthly: number; insuranceMonthly: number; utilitiesMonthly: number;
  gasMonthly: number; waterMonthly: number; electricityMonthly: number; miscUtilitiesMonthly: number;
  miscHoldingMonthly: [number, number, number, number];
  buyEscrowRate: number; buyTitleRate: number; buyMiscRate: number;
  sellEscrowRate: number; sellRecordingRate: number; sellRealtorRate: number; sellTransferRate: number;
  sellHomeWarranty: number; sellStaging: number; sellMarketing: number; sellMisc: number;
  arvFactor?: number;
};
type AcquisitionsOutput = {
  offer: { seventyPercentArv: number; allInMaxLimit: number; offerRepairCosts: number; offer: number; offerPctOfArv: number };
  financing: { firstPointsPaid: number; firstInterestPaid: number; firstInterestOnlyPaid: number;
               secondPointsPaid: number; secondInterestPaid: number; secondInterestOnlyPaid: number; total: number };
  holding: { propertyTaxesTotal: number; hoaTotal: number; insuranceTotal: number; utilitiesTotal: number; gasTotal: number;
             waterTotal: number; electricityTotal: number; miscUtilitiesTotal: number; totalMaintenanceCosts: number;
             miscHoldingTotal: number[]; total: number };
  buying: { escrow: number; title: number; misc: number; total: number };
  selling: { escrow: number; recording: number; realtor: number; transfer: number; total: number };
  purchaseAndRepairCosts: number; netProfit: number; cashInvested: number; cashReturn: number; roiOnCash: number; timeToReturn: string;
  delayed: { cashToCover: number; totalCash: number; actualRoi: number; cashFlow: DrawCashFlowOutput };
  upfront: { cashToCover: number; totalCash: number; actualRoi: number; cashFlow: DrawCashFlowOutput };
};
declare function acquisitions(input: AcquisitionsInput): AcquisitionsOutput; // calls rehabEstimator and drawCashFlow twice
```

### 3.3 Outputs

| name | label | cell | current cached value |
|---|---|---|---|
| offer.seventyPercentArv | 70% of ARV | N3 | 210,000 |
| offer.allInMaxLimit | All In Max Limit | N5 | 200,000 |
| offer.offerRepairCosts | Repair Costs | N6 | -20,050 |
| offer.offer | Offer | N7 | 179,950 |
| offer.offerPctOfArv | % of ARV | N8 | 0.5998333333 |
| financing.firstPointsPaid | First Mortgage Points, Amount Paid | F20 | 6,000 |
| financing.firstInterestPaid | First Mortgage Interest, Amount Paid | F21 | 0 |
| financing.firstInterestOnlyPaid | First Mortgage Monthly Interest Only Payment, Amount Paid | F22 | 9,333.333333 |
| financing.total | TOTAL FINANCING COSTS | E32, J10 | 15,333.33333 |
| holding.propertyTaxesTotal | Property Taxes, Annualized | K19 | 5,833.333333 |
| holding.insuranceTotal | Insurance Costs | K21 | 400 |
| holding.gasTotal | Gas | K23 | 600 |
| holding.waterTotal | Water | K24 | 400 |
| holding.electricityTotal | Electricity | K25 | 400 |
| holding.totalMaintenanceCosts | Total Maintenance Costs | J27 | 7,633.333333 |
| holding.total | TOTAL HOLDING COSTS | J32, J11 | 7,633.333333 |
| buying.total | Total Buying Transaction Costs | J12 | 4,500 |
| selling.total | Total Selling Transaction Costs | J13 | 8,030 |
| purchaseAndRepairCosts | PURCHSE AND REPAIR COSTS | E14 | -220,050 |
| netProfit | ESTIMATED NET PROFIT | J14 | 44,453.33333 |
| cashInvested | Cash Invested | N11 | 22,966.66667 |
| cashReturn | Cash Return | N12 | 44,453.33333 |
| roiOnCash | ROI on Cash | N13 | 1.935558781 |
| timeToReturn | Time to Return | N14 | "4 Months" |
| delayed.cashToCover | Cash to Cover Delayed Draw | I39 | 3,246.875 |
| delayed.totalCash | Cash Invested (delayed) | J39 | 26,213.54167 |
| delayed.actualRoi | Actual Delayed Draw ROI | J41 | 1.695815617 |
| upfront.cashToCover | Cash to Cover Up Front Draw | I46 | 3,246.875 |
| upfront.totalCash | Cash Invested (up front) | J46 | 26,213.54167 |
| upfront.actualRoi | Actual Upfront Draw ROI | J48 | 1.695815617 |

The brief for this session quoted a net profit of about $133M and ROI on cash of about 16.12x. This workbook version has different example inputs and computes $44M and 1.94x. The fixtures follow the workbook.

---

## 4. Draw Cash Flow

Sheets `Delayed Draw Cash Flow` and `Up Front Draw Cash Flow`. One model with a `schedule` parameter. The two sheets differ only in the three lender draw percentages, whether the draw week is rounded up, one frequency label, and the sheet title (see `spec/SHEET_DIFFS.md`).

### 4.1 Inputs

All money inputs come from the Acquisitions sheet. The engine passes them in rather than reading another module's cells.

| name | label | cell | current value | unit | source |
|---|---|---|---|---|---|
| schedule | sheet identity | n/a | delayed or upfront | enum | n/a |
| maxWeeks | rows 6 to 41 | n/a | 36 | weeks | structural limit (A-07) |
| holdMonths | via Acquisitions E9 | F4 uses it | 4 | months | Acquisitions |
| beginningCashBalance | Beginning Cash Balance | H3 (= Acquisitions H39) | 22,966.67 | USD | Acquisitions cashInvested |
| purchasePrice | via Acquisitions E11 | D6, M3 | 200,000 | USD | Acquisitions |
| repairCosts | via Acquisitions E12 | D7:D9 (each /3), L3 | 20,050 | USD | Acquisitions |
| arv | via Acquisitions E13 | D10 | 300,000 | USD | Acquisitions |
| drawPercents[0..2] | Lender Draw 1, 2, 3 at n% | E7, E8, E9 | delayed 0.25, 0.50, 0.75; upfront 0.01, 0.33, 0.66 | percent of duration (min 0, max 1) | sheet constants, not styled as inputs |
| costTotals.constructionCosts | Construction Costs | L3 | 20,050 | USD | Acquisitions E12 |
| costTotals.purchasePrice | Purchase Price | M3 | 200,000 | USD | Acquisitions E11 |
| costTotals.firstPoints | First Mortgage Points | N3 | 6,000 | USD | Acquisitions F20 |
| costTotals.firstInterest | First Mortgage Interest | O3 | 0 | USD | Acquisitions F21 |
| costTotals.firstInterestOnly | First Mortgage Monthly Interest Only Payment | P3 | 9,333.33 | USD | Acquisitions F22 |
| costTotals.propertyTaxes | Property Taxes | Q3 | 5,833.33 | USD | Acquisitions K19 |
| costTotals.hoa | HOA & Condo Fees | R3 | 0 | USD | Acquisitions K20 |
| costTotals.insurance | Insurance Costs | S3 | 400 | USD | Acquisitions K21 |
| costTotals.gas | Gas | T3 | 600 | USD | Acquisitions K23 |
| costTotals.water | Water | U3 | 400 | USD | Acquisitions K24 |
| costTotals.electricity | Electricity | V3 | 400 | USD | Acquisitions K25 |
| costTotals.miscUtilities | Miscellaneous | W3 | 0 | USD | Acquisitions K26 |
| costTotals.buyEscrow | Escrow / Attorney Fees | X3 | 1,500 | USD | Acquisitions F37 |
| costTotals.buyTitle | Title Insurance/Search Costs | Y3 | 3,000 | USD | Acquisitions F38 |
| costTotals.buyMisc | Miscellaneous Buying Costs | Z3 | 0 | USD | Acquisitions F39 |
| costTotals.sellEscrow | Escrow / Attorney Fees | AA3 | 1,500 | USD | Acquisitions F42 |
| costTotals.sellRecording | Selling Recording Fees | AB3 | 500 | USD | Acquisitions F43 |
| costTotals.sellRealtor | Realtor Fees | AC3 | 6,000 | USD | Acquisitions F44 |
| costTotals.sellTransfer | Transfer & Conveyance Fees | AD3 | 30 | USD | Acquisitions F45 |
| costTotals.sellHomeWarranty | Home Warranty | AE3 | 0 | USD | Acquisitions F46 |
| costTotals.sellStaging | Staging Costs | AF3 | 0 | USD | Acquisitions F47 |
| costTotals.sellMarketing | Marketing Costs | AG3 | 0 | USD | Acquisitions F48 |
| costTotals.sellMisc | Miscellaneous Selling Costs | AH3 | 0 | USD | Acquisitions F49 |
| otherExpenses[0..4] | Other Expense 1 to 5 | B13:D17 (delayed), B14:D18 (upfront) | empty | USD, with a week | yellow input slots, unused |

Note on the Acquisitions holding cost "Utilities" (J22, K22): it has no column on the draw sheets. Only gas, water, electricity, and miscellaneous flow through (A-22).

Hardcoded constants:

| constant | value | where | proposal |
|---|---|---|---|
| weeksPerMonth | 4 | F4 `= holdMonths * 4` | Keep 4 for parity. Note that 9 months is the ceiling (A-07). |
| monthlyCadenceWeeks | 4 | monthly columns place cost at rows 6, 10, 14, ... | Keep. |
| remainderTolerance | 0.1 | every "is there cost left" test | Keep. |
| drawCount and split | 3 draws of repairCosts / 3 | D7:D9 | Keep as default; propose making draw count and split editable later. |

### 4.2 Derived values

Duration and cash in table:

```
durationWeeks = holdMonths * weeksPerMonth                                                  F4

drawWeek[i] = schedule == "delayed" ? durationWeeks * drawPercents[i]                       C7:C9 (delayed, no rounding)
            : roundUp(durationWeeks * drawPercents[i], 0)                                   C7:C9 (upfront, ROUNDUP)

cashInTable = [
  { week: 1,             amount: purchasePrice },        row 6, Lender Purchase Loan
  { week: drawWeek[0],   amount: repairCosts / 3 },      row 7, Lender Draw 1
  { week: drawWeek[1],   amount: repairCosts / 3 },      row 8, Lender Draw 2
  { week: drawWeek[2],   amount: repairCosts / 3 },      row 9, Lender Draw 3
  { week: durationWeeks, amount: arv },                  row 10, Property Sale
  { week: durationWeeks, amount: -purchasePrice },       row 11, Purchase Loan Repayment
  { week: durationWeeks, amount: -repairCosts },         row 12, Construction Loan Repayment
  ...otherExpenses                                       rows 13 to 17, empty
]
netCashIn = sum(cashInTable.amount)                                                        C3 (= SUM(D6:D43))
```

Weekly cost grid, one column per cost, rows for week 1 to 36. Frequency is fixed per column by the formulas; the "Frequency" labels in row 4 are not referenced by any formula (A-09).

```
Weekly (construction, column L):
  cost[1] = constructionCosts / durationWeeks
  cost[w] = (constructionCosts - sum(cost[1..w-1])) > 0.1 ? cost[w-1] : 0          for w = 2..36
  Exception at row 16 (week 11): the test subtracts the literal 15 instead of cost[10]. See A-17.

Monthly (columns O, P, S, T, U, V, W):
  cost[1] = total / holdMonths
  cost[w] = (total - sum(cost at earlier monthly weeks)) > 0.1 ? previous monthly cost : 0
            for w in 5, 9, 13, 17, 21, 25, 29, 33        (rows 10, 14, ... 38; every 4 weeks)
  cost[w] = 0 for every other week (typed constants)

One time at week 1 (columns M, N, Q, R, X, Y, Z):
  cost[1] = total, cost[w] = 0 otherwise (cells empty)

One time at the last week (columns AA to AH):
  cost[w] = (w == durationWeeks) ? total : 0            for every w = 1..36

expenses[w]     = sum over columns of cost[w]                                              I6:I41
totalExpenses   = sum(expenses)                                                            I4
columnTotal[c]  = sum over w of cost[c][w]                                                 L42:AH42
unaccounted[c]  = total[c] - columnTotal[c]                                                L43:AH43
```

Weekly balance:

```
cashIn[w]  = sum of cashInTable.amount where cashInTable.week == w                         G6:G41 (SUMIF, growing range, A-10)
balance[1] = beginningCashBalance - expenses[1] + cashIn[1]                                H6 (H4 is empty and adds 0)
balance[w] = balance[w-1] - expenses[w] + cashIn[w]                                        H7:H41
endingBalance = last numeric value in balance[1..36] = balance[36]                         H43 (array formula INDEX/MATCH)
excessCash    = endingBalance - beginningCashBalance                                       E43
minBalance    = min(balance[1..36])                                                        used by Acquisitions I39, I46
```

A draw week that is fractional or larger than 36 never matches a week and its amount is silently dropped from the balance (A-08, A-07).

TypeScript:

```ts
type DrawSchedule = "delayed" | "upfront";
type DrawCashFlowInput = {
  schedule: DrawSchedule; maxWeeks: number;             // 36 for parity
  holdMonths: number; beginningCashBalance: number;
  purchasePrice: number; repairCosts: number; arv: number;
  drawPercents?: [number, number, number];             // defaults by schedule
  costTotals: Record<CostColumn, number>;
  otherExpenses?: { week: number; amount: number }[];
};
type WeekRow = { week: number; cashIn: number; expenses: number; balance: number };
type DrawCashFlowOutput = {
  durationWeeks: number; drawWeeks: [number, number, number];
  cashInTable: { label: string; week: number; amount: number }[]; netCashIn: number;
  weeks: WeekRow[]; grid: Record<CostColumn, number[]>;
  columnTotals: Record<CostColumn, number>; unaccounted: Record<CostColumn, number>;
  totalExpenses: number; endingBalance: number; excessCash: number; minBalance: number; minBalanceWeek: number;
};
declare function drawCashFlow(input: DrawCashFlowInput): DrawCashFlowOutput;
```

### 4.3 Outputs

Delayed sheet:

| name | label | cell | current cached value |
|---|---|---|---|
| durationWeeks | Duration Weeks | F4 | 16 |
| netCashIn | Net Cash In | C3 | 300,000 |
| totalExpenses | Net Cash Out Below | I4 | 255,546.6667 |
| drawWeeks | Lender Draw 1, 2, 3 | C7, C8, C9 | 4, 8, 12 |
| weeks[].balance | Balance @ End of Week | H6:H41 | 2,596.875; 1,343.75; 90.625; 5,520.83; 1,484.375; 231.25; -1,021.875; 4,408.33; 371.875; -881.25; -2,134.375; 3,295.83; -740.625; -1,993.75; -3,246.875; 67,420; then 67,420 through week 36 |
| minBalance | min of H6:H41 | derived | -3,246.875 (week 15) |
| endingBalance | Ending Bank Balance | H43 | 67,420 |
| excessCash | Excess Cash Profit (Loss) | E43 | 44,453.33333 |
| columnTotals | TOTAL | L42:AH42 | L 20,050; M 200,000; N 6,000; O 0; P 9,333.33; Q 5,833.33; R 0; S 400; T 600; U 400; V 400; W 0; X 1,500; Y 3,000; Z 0; AA 1,500; AB 500; AC 6,000; AD 30; AE 0; AF 0; AG 0; AH 0 |
| unaccounted | Unaccounted Costs | L43:AH43 | all 0 |

Up front sheet:

| name | label | cell | current cached value |
|---|---|---|---|
| durationWeeks | Duration Weeks | F4 | 16 |
| netCashIn | Net Cash In | C3 | 300,000 |
| totalExpenses | Net Cash Out Below | I4 | 255,546.6667 |
| drawWeeks | Lender Draw 1, 2, 3 | C7, C8, C9 | 1, 6, 11 |
| weeks[].balance | Balance @ End of Week | H6:H41 | 9,280.21; 8,027.08; 6,773.96; 5,520.83; 1,484.375; 6,914.58; 5,661.46; 4,408.33; 371.875; -881.25; 4,548.96; 3,295.83; -740.625; -1,993.75; -3,246.875; 67,420; then 67,420 through week 36 |
| minBalance | min of H6:H41 | derived | -3,246.875 (week 15) |
| endingBalance | Ending Bank Balance | H43 | 67,420 |
| excessCash | Excess Cash Profit (Loss) | E43 | 44,453.33333 |
| columnTotals | TOTAL | L42:AH42 | same as delayed |

Excess cash equals the Acquisitions net profit on both sheets. That is expected: every cost total and every cash in event is the same money as the P&L.

---

## 5. Buy and Hold

Sheet `Buy & Hold` (the fixture) and `Buy & Hold 2` (a second copy with a 1.5MM example and a few formula edits, see `spec/SHEET_DIFFS.md`). Inputs use light blue fill (C9DAF8), which the sheet's own note calls out. Up to 20 units.

### 5.1 Inputs

| name | label | cell | current value | unit | source |
|---|---|---|---|---|---|
| salePrice | Sale Price | C5 | 210,000 | USD | none given |
| taxValue | Tax Value | F5 | 210,000 | USD | none given. Feeds nothing on this sheet. On Buy & Hold 2 it feeds property tax (C33). |
| rentGrowthRate | Rent Growth Rate | Z5 | 0.035 | percent per year (min 0, max 0.10) | none given |
| dcrRequired | Debt Coverage Ratio Required | T6 | 1.25 | ratio | none given. Feeds nothing (A-25). |
| units[0..19].unit | Unit # | B9:B28 | 1 to 20 | count | none |
| units[0..19].beds | #Beds | C9:C28 | 3 | count | none |
| units[0..19].baths | #Baths | D9:D28 | 2.5 or 3 | count | none |
| units[0..19].rent | Rent/Mo | E9:E28 | unit 1: 2,000, others 0 | USD per month | none |
| units[0..19].marketRent | Market Rent | F9:F28 | unit 1: 3,000, others 0 | USD per month | none |
| propertyTaxYear | Property Tax/Yr | C33 | 1,400 | USD per year | none |
| downPaymentPct | Downpayment (%) | E33 | 0.01 | percent (min 0, max 1) | none. See A-11. |
| insuranceMonth | Insurance/Mo | C34 | 100 | USD per month | none |
| interestRate | Interest Rate (%) | E34 | 0.07 | percent per year (min 0, max 0.20) | none |
| gasElectricMonth | Gas & Electric/Mo | C35 | 0 | USD per month | none |
| loanTermYears | Loan Term (Years) | E35 | 30 | years | none |
| waterMonth | Water/Mo | C36 | 0 | USD per month | none |
| closingCosts | Closing Costs | E36 | 2,100 (formula `=0.01*C5`, "Estimated 1% for closing") | USD | none. See A-11. |
| sewerMonth | Sewer/Mo | C37 | 0 | USD per month | none |
| garbageMonth | Garbage/Mo | C38 | 0 | USD per month | none |
| lawnSnowMonth | Lawn and Snow | C39 | 0 | USD per month | none |
| managementPct | Management (%) | C40 | 0 | percent of gross rent (min 0, max 0.20) | none |
| vacancyPct | Vacancy (%) | C41 | 0 | percent (min 0, max 0.30) | none |
| maintenancePct | Maintenance (%) | C42 | 0.05 | percent (min 0, max 0.20) | none |
| cashReservesPct | Cash Reserves | T12 | 0 | percent (min 0, max 0.20) | none |
| improvedValueRatio | Improved Value: Assessed Value Ratio (%) | P21 | 1.00 | percent (min 0, max 1) | none |
| marginalTaxRate | Marginal Tax Rate | P22 | 0.21 | percent (min 0, max 0.50) | none |
| appreciationRate | Assumed Rate (appreciation) | S24 | 0.025 | percent per year (min 0, max 0.10) | none |

Hardcoded constants:

| constant | value | where | proposal |
|---|---|---|---|
| depreciationYears | 27.5 | P25, P28, P31, P34, P37 | Keep as a named engine constant. Residential straight line is 27.5 years under current US tax law. Expose as an advanced input later. |
| closingCostRate | 0.01 | E36 | Make closing costs a percent input with default 1% (Buy & Hold 2 uses 3%). |
| DCR pass level | 1.25 | T6 | Already a cell; wire it to a pass/fail output (A-25). |

### 5.2 Derived values

Current rate analysis (columns H to L, rows 8 to 18):

```
totalRent           = sum(units.rent)                                        E29
totalMarketRent     = sum(units.marketRent)                                  F29
grossRents          = totalRent                                              I8
management          = managementPct * grossRents                             I9
propertyTaxes       = propertyTaxYear / 12                                   I10
insurance           = insuranceMonth                                         I11
ownerPaidUtilities  = gasElectricMonth + waterMonth + sewerMonth + garbageMonth + lawnSnowMonth    I12 (SUM(C35:C39))
vacancyReserve      = vacancyPct * totalRent                                 I13
maintenanceReserve  = grossRents * maintenancePct                            I14
totalOperatingExpenses = sum(management .. maintenanceReserve)               I15
monthlyNoi          = grossRents - totalOperatingExpenses                    I16
annualizedNoi       = monthlyNoi * 12                                        I17
capRate             = annualizedNoi / salePrice                              I18

loanToValue         = 1 - downPaymentPct                                     L9
downPayment         = downPaymentPct * salePrice                             L10
closingCosts        = closingCosts input                                     L11
principal           = salePrice * loanToValue                                L12
monthlyMortgage     = -PMT(interestRate / 12, loanTermYears * 12, principal) L15
monthlyNet          = monthlyNoi - monthlyMortgage                           L16
annualizedNet       = monthlyNet * 12                                        L17
annualizedRoi       = annualizedNet / (downPayment + closingCosts)           L18
```

Market rate analysis (rows 23 to 33) repeats the block with grossRents = totalMarketRent:

```
market.grossRents = totalMarketRent                                          I23
market.management = managementPct * market.grossRents                        I24
market.vacancyReserve = vacancyPct * market.grossRents                       I28
market.maintenanceReserve = maintenancePct * market.grossRents               I29
(taxes I25, insurance I26, utilities I27 same as current)
market.monthlyNoi, annualizedNoi, capRate                                    I31, I32, I33
market.monthlyMortgage (same loan)                                           L30
market.monthlyNet, annualizedNet, annualizedRoi                              L31, L32, L33
```

Five year debt paydown (rows 8 to 17, columns N to P), year y = 1..5:

```
interestPaid[y]     = -CUMIPMT(interestRate / 12, loanTermYears * 12, principal, 1 + 12 * (y - 1), 12 * y, 0)   P26, P29, P32, P35, P38
debtPaydown[y]      = monthlyMortgage * 12 - interestPaid[y]                                                   P8, P10, P12, P14, P16
roiOnPaydown[y]     = debtPaydown[y] / downPayment                                                             P9, P11, P13, P15, P17
```

Five year tax deduction summary (rows 25 to 41):

```
depreciation[y]     = (improvedValueRatio * salePrice) / 27.5                P25, P28, P31, P34, P37 (same every year)
totalDeductions[y]  = depreciation[1] + interestPaid[y]                      P27, P30, P33, P36, P39 (always uses year 1 depreciation, P25 absolute)
avgYearlyTaxSavings = average(totalDeductions[1..5]) * marginalTaxRate       P40
annualRoiOnTaxSavings = avgYearlyTaxSavings / downPayment                    P41
```

Commercial loan test (rows 8 to 21, columns R to V). Column U is labeled Pro Forma and uses current rents. Column V is labeled Actual and uses market rents (A-26).

```
pf.grossRents  = grossRents * 12                        U9         act.grossRents = market.grossRents * 12         V9
pf.vacancy     = pf.grossRents * vacancyPct             U10        act.vacancy    = vacancyReserve * 12            V10
pf.propMgmt    = pf.grossRents * managementPct          U11        act.propMgmt   = 12 * management                V11
pf.cashReserves = cashReservesPct * pf.grossRents       U12        act.cashReserves = cashReservesPct * act.grossRents   V12
pf.taxes       = propertyTaxes * 12                     U13        act.taxes      = same                            V13
pf.insurance   = insurance * 12                         U14        act.insurance  = same                            V14
pf.maintUtil   = pf.grossRents * maintenancePct         U15        act.maintUtil  = (ownerPaidUtilities + maintenanceReserve) * 12   V15
pf.totalExpenses = sum(U10:U15)                         U16        act.totalExpenses = sum(V10:V15)                 V16
pf.noi         = pf.grossRents - pf.totalExpenses       U17        act.noi        = act.grossRents - act.totalExpenses   V17
pf.mortgage    = monthlyMortgage * 12                   U18        act.mortgage   = pf.mortgage                     V18
pf.dcr         = pf.noi / pf.mortgage                   U20        act.dcr        = act.noi / act.mortgage          V20
pf.netProfit   = pf.noi - pf.mortgage                   U21        act.netProfit  = act.noi - act.mortgage          V21
```

T10, T11, T15 mirror vacancyPct, managementPct, maintenancePct (`=C41`, `=C40`, `=C42`). On Buy & Hold 2 they are typed constants instead.

Appreciation (rows 27 to 31):

```
estValue[1]  = salePrice * (1 + appreciationRate)                              S27
estValue[y]  = estValue[y-1] * (1 + appreciationRate)                          S28:S31
annualGain[y] = estValue[y] - estValue[y-1]   (year 1 uses salePrice)          T27:T31
pctGain[y]   = annualGain[y] / downPayment                                     U27:U31
```

Total return (rows 36 to 41, columns S to W):

```
cashFlowRoi[y]   = market.annualizedRoi           S36:W36 (constant, =$L$33)
debtPaydownRoi[y] = roiOnPaydown[y]               S37:W37
taxSavingsRoi[y] = totalDeductions[y] * marginalTaxRate / downPayment    S38:W38
appreciationRoi[y] = pctGain[y]                   S39:W39
totalRoi[y]      = sum of the four                S40:W40
totalDollarReturn[y] = totalRoi[y] * downPayment  S41:W41
```

Rent growth table (rows 9 to 28, columns Y to Z):

```
marketRentYear1 = totalMarketRent                                    Z6
marketRent[y]   = marketRentYear1 * (1 + rentGrowthRate) ^ (y - 1)   Z9:Z28, y = 1..20
```

TypeScript:

```ts
type Unit = { unit: number; beds: number; baths: number; rent: number; marketRent: number };
type BuyAndHoldInput = {
  salePrice: number; taxValue: number; units: Unit[];
  propertyTaxYear: number; insuranceMonth: number; gasElectricMonth: number; waterMonth: number;
  sewerMonth: number; garbageMonth: number; lawnSnowMonth: number;
  managementPct: number; vacancyPct: number; maintenancePct: number; cashReservesPct: number;
  downPaymentPct: number; interestRate: number; loanTermYears: number; closingCosts: number;
  improvedValueRatio: number; marginalTaxRate: number; appreciationRate: number; rentGrowthRate: number;
  dcrRequired: number;
};
type ProForma = { grossRents: number; management: number; propertyTaxes: number; insurance: number; ownerPaidUtilities: number;
  vacancyReserve: number; maintenanceReserve: number; totalOperatingExpenses: number; monthlyNoi: number; annualizedNoi: number;
  capRate: number; loanToValue: number; downPayment: number; closingCosts: number; principal: number; monthlyMortgage: number;
  monthlyNet: number; annualizedNet: number; annualizedRoi: number };
type BuyAndHoldOutput = {
  current: ProForma; market: ProForma;
  debtPaydown: { year: number; interestPaid: number; totalDebtPaydown: number; roiOnPaydown: number }[];
  taxDeductions: { year: number; depreciation: number; totalDeductions: number }[];
  avgYearlyTaxSavings: number; annualRoiOnTaxSavings: number;
  dcr: { proForma: DcrBlock; actual: DcrBlock };
  appreciation: { year: number; estValue: number; annualGain: number; pctGain: number }[];
  totalReturn: { year: number; cashFlow: number; debtPaydown: number; taxSavings: number; appreciation: number; totalRoi: number; totalDollarReturn: number }[];
  rentGrowth: { year: number; marketRent: number }[];
};
declare function buyAndHold(input: BuyAndHoldInput): BuyAndHoldOutput;
```

### 5.3 Outputs

| name | label | cell | current cached value |
|---|---|---|---|
| current.grossRents | Gross Rents | I8 | 2,000 |
| current.totalOperatingExpenses | Total Operating Expenses | I15 | 316.6666667 |
| current.monthlyNoi | Monthly NOI | I16 | 1,683.333333 |
| current.annualizedNoi | Annualized NOI | I17 | 20,200 |
| current.capRate | Capitalization Rate | I18 | 0.09619047619 |
| current.downPayment | Down Payment | L10 | 2,100 |
| current.principal | Principal | L12 | 207,900 |
| current.monthlyMortgage | Monthly Mortgage | L15 | 1,383.163887 |
| current.monthlyNet | Monthly Net | L16 | 300.1694459 |
| current.annualizedRoi | Annualized ROI | L18 | 0.8576269882 |
| market.monthlyNoi | Monthly NOI | I31 | 2,633.333333 |
| market.capRate | Capitalization Rate | I33 | 0.1504761905 |
| market.annualizedRoi | Annualized ROI | L33 | 3.571912702 |
| debtPaydown[1..5].totalDebtPaydown | Total Debt Paydown | P8, P10, P12, P14, P16 | 2,111.868635; 2,264.535789; 2,428.239265; 2,603.776878; 2,792.004119 |
| debtPaydown[1..5].roiOnPaydown | ROI on Paydown | P9, P11, P13, P15, P17 | 1.005651731; 1.078350376; 1.156304412; 1.239893751; 1.329525771 |
| debtPaydown[1..5].interestPaid | Total Interest Paid | P26, P29, P32, P35, P38 | 14,486.09801; 14,333.43086; 14,169.72738; 13,994.18977; 13,805.96253 |
| taxDeductions[1].depreciation | Depreciation (Straight Line) | P25 | 7,636.363636 |
| avgYearlyTaxSavings | Avg Yearly Tax Savings | P40 | 4,576.791523 |
| dcr.proForma.dcr | Debt Coverage Ratio | U20 | 1.217016543 |
| dcr.actual.dcr | Debt Coverage Ratio | V20 | 1.939996668 |
| appreciation[1].estValue | Est. Value | S27 | 215,250 |
| totalReturn[1].totalRoi | Total ROI | S40 | 9.289810599 |
| totalReturn[1].totalDollarReturn | Total $ Return | S41 | 19,508.60226 |
| rentGrowth[2].marketRent | Market Rent, year 2 | Z10 | 3,105 |

The brief quoted L18 about 0.5752, I18 about 0.0905, U20 about 0.6224. This workbook computes 0.8576, 0.0962, 1.2170. The fixtures follow the workbook.

---

## 6. Amortization Schedule

Sheet `Amortization Schedule`. A 60 period monthly amortization of a 500,000 loan at 3% with a date column driven by `TODAY()`, a payoff lookup for six months, and a side table that splits an operating profit 35/65 between "Owner" and "VDA". The side table and rows 6 to 7 refer to a car loan (headers "Make", "Model", "Year", "Car Loan Patyment"). See A-13.

### 6.1 Inputs

| name | label | cell | current value | unit | source |
|---|---|---|---|---|---|
| loanAmount | Loan Amount | B2 | -500,000 | USD, entered negative | none |
| annualRate | Interest Rate | B3 | 0.03 | percent per year (min 0, max 0.20) | none |
| periods | Period | B4 | 60 | months | none |
| startDate | first period date | C10 (`=today()`) | 2026-09-14 | date | engine input, replaces TODAY() (A-14) |
| daysInMonth[1..12] | row 2 | D2:O2 | 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 | count | typed constants, no leap year (A-28) |
| payoffLookupMonths[0..5] | Months into Loan | E4:J4 | 21, 30, 45, 50, 55, 60 | months | none |
| monthlyInsurance | Monthly Insurance | R5 | 300 | USD per month | none |
| monthlyRevenue | Monthly Revenue | R6 | 15,000 | USD per month | yellow input fill |

Hardcoded constants:

| constant | value | where | proposal |
|---|---|---|---|
| opsRevenue and expense | (1000 * 4) - 250 | B6 | Unknown deal. Ask Ous (A-13). Do not port to the product unless he wants the sheet. |
| ownerShare / vdaShare | 0.35 / 0.65 | E6:J7, V10:W69 | Same question. If kept, make both shares inputs. |
| lookup column | 3 (Beginning Balance) | E5:J5 | Keep: payoff amount at month n = beginning balance of period n. |

### 6.2 Derived values

```
payment            = PMT(annualRate / 12, periods, loanAmount, 0, 0)          B5 (positive because loanAmount is negative)
summary            = { loanAmount: -loanAmount, annualRate, periods, payment } R1:R4

For period p = 1..periods (rows 10 to 69):
  date[1]          = startDate                                                 C10
  daysInMonth[p]   = daysInMonth[month(date[p])]                                A10:A69 (nested IF on MONTH)
  date[p+1]        = date[p] + daysInMonth[p]                                  C11:C69
  beginningBalance[1] = -loanAmount                                            D10
  beginningBalance[p] = endingBalance[p-1]                                     D11:D69
  interest[p]      = beginningBalance[p] * (annualRate / 12)                   G10:G69
  principal[p]     = payment - interest[p]                                     F10:F69
  cumulativePrincipal[1] = 0, [2] = principal[1] + principal[2], [p] = cum[p-1] + principal[p]   H10:H69 (H10 typed 0, H11 = F10 + F11)
  cumulativeInterest similarly                                                 I10:I69
  endingBalance[p] = beginningBalance[p] - principal[p]                        J10:J69

payoffAmount[i]    = beginningBalance at period payoffLookupMonths[i]          E5:J5 (VLOOKUP col 3, approximate match)
totalPrincipal     = sum(principal)                                            F71
totalInterest      = sum(interest)                                             G71

Side table (rows 10 to 69, columns P to W):
  month[p] = p, sidePayment[p] = payment, insurance[p] = monthlyInsurance, revenue[p] = monthlyRevenue
  profit[p] = revenue[p] - insurance[p] - sidePayment[p]                       T10:T69
  financialRisk[p] = endingBalance[p]                                          U10:U69
  investorProfit[p] = profit[p] * 0.35, vdaProfit[p] = profit[p] * 0.65        V, W
  totals: revenue S70, profit T70, investorProfit V70, vdaProfit W70

Rows 6 to 7:
  monthlyOpsProfit = (1000 * 4) - payment - 250                                B6
  ownerRealizedProfit[i] = monthlyOpsProfit * 0.35 * payoffLookupMonths[i]     E6:J6
  vdaRealizedProfit[i]   = monthlyOpsProfit * 0.65 * payoffLookupMonths[i]     E7:J7
```

Cumulative principal for period 1 is a typed 0, and period 2 is `F10 + F11`, so the running total matches from period 2 onward. Cumulative interest is the same shape.

TypeScript:

```ts
type AmortizationInput = {
  loanAmount: number; annualRate: number; periods: number; startDate: string; // ISO date
  daysInMonth?: number[]; payoffLookupMonths?: number[];
  monthlyInsurance?: number; monthlyRevenue?: number;
};
type AmortizationRow = { period: number; date: string; daysInMonth: number; beginningBalance: number; payment: number;
  principal: number; interest: number; cumulativePrincipal: number; cumulativeInterest: number; endingBalance: number };
type AmortizationOutput = {
  payment: number; rows: AmortizationRow[]; payoffAmounts: number[];
  totalPrincipal: number; totalInterest: number;
  side: { monthlyOpsProfit: number; ownerRealizedProfit: number[]; vdaRealizedProfit: number[];
          rows: { profit: number; investorProfit: number; vdaProfit: number }[]; totals: { revenue: number; profit: number; investorProfit: number; vdaProfit: number } };
};
declare function amortization(input: AmortizationInput): AmortizationOutput;
```

### 6.3 Outputs

| name | label | cell | current cached value |
|---|---|---|---|
| payment | Payment | B5 | 8,984.345332 |
| payoffAmounts[0..5] | Loan Payoff Amount | E5:J5 | 341,583.5819; 267,674.0852; 140,740.1293; 97,361.30172; 53,437.52078; 8,961.940481 |
| rows[0].date | date, period 1 | C10 | 2026-09-14 |
| rows[59].date | date, period 60 | C69 | 2031-08-13 |
| rows[0].endingBalance | Ending Balance | J10 | 492,265.6547 |
| rows[59].endingBalance | Ending Balance | J69 | -0.00000001098 (floating point zero) |
| totalPrincipal | Total | F71 | 500,000 |
| totalInterest | Total | G71 | 39,060.71992 |
| side.monthlyOpsProfit | Monthly Ops Profit | B6 | -5,234.345332 |
| side.totals.profit | Total | T70 | 342,939.2801 |

The full 60 row ending balance column is in `spec/golden/amortization.json`.

---

## Excel functions used

SUM, SUMIF, AVERAGE, IF, MIN, ROUNDUP, PMT, CUMIPMT, VLOOKUP, CONCATENATE, TODAY, MONTH, and INDEX with MATCH inside the one array formula (H43 on each draw sheet). PMT and CUMIPMT need tested helpers in the engine. INDEX/MATCH on H43 reduces to "last value in the column" because every balance cell is numeric.

## Out of scope sheets

- `Example` has no formulas. It is an older printed layout of the flip model.
- `Example 2` has 37 formulas that restate the flip model in an older layout with interest at 14% per year (B25). It is the origin of the `0.14/12` constant in Acquisitions E22. Nothing in it exists nowhere else.
- `Table 1` has one formula, a SUM on a printable repair sheet with text price ranges. Nothing to port.
- `Deal Analyzer Fields`, `Rehab Estimator Fields`, `Definitions`, `To Airtable` hold no formulas and become schema, help text, and the export shape.
