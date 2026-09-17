"""Extract every formula and input cell from the Deal Analyzer workbook.

Usage:
    python tools/extract_workbook.py [path/to/workbook.xlsx]

Outputs (all under spec/):
    spec/cells.json            every formula cell and every input cell, with
                               repeated row patterns collapsed
    spec/golden/*.json         one fixture per calculator, inputs = current
                               workbook values, expected = cached values

The workbook is opened twice: once for formulas, once with data_only=True for
the cached values Excel stored on last save. Nothing is written back to the
workbook.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path

import openpyxl
from openpyxl.utils import get_column_letter, column_index_from_string

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "spec"
GOLDEN = SPEC / "golden"

INPUT_FILL = "FFFFF2CC"          # light yellow, the workbook's stated input color
BUY_HOLD_INPUT_FILL = "FFC9DAF8"  # light blue, Buy & Hold B2 says "fill in all the blue cells"
BUY_HOLD_SHEETS = {"Buy & Hold", "Buy & Hold 2"}

# Known repeated row ranges to collapse into patterns.
REPEATED_RANGES = {
    "Delayed Draw Cash Flow": (6, 41),
    "Up Front Draw Cash Flow": (6, 41),
    "Amortization Schedule": (10, 69),
    "Rehab Estimator": (3, 69),
    "Buy & Hold": (9, 28),
    "Buy & Hold 2": (9, 28),
}

REF_RE = re.compile(
    r"(?P<sheet>'[^']+'!|[A-Za-z_][A-Za-z0-9_\. ]*!)?"
    r"(?P<c1>\$?[A-Z]{1,3}\$?\d+)(?::(?P<c2>\$?[A-Z]{1,3}\$?\d+))?"
    r"(?![A-Za-z0-9_\(])"
)
CELL_RE = re.compile(r"(\$?)([A-Z]{1,3})(\$?)(\d+)")


# --------------------------------------------------------------------------
# Workbook helpers
# --------------------------------------------------------------------------

def find_workbook(argv: list[str]) -> Path:
    if len(argv) > 1:
        return Path(argv[1])
    candidates = sorted((ROOT / "source").glob("*.xlsx")) + sorted(ROOT.glob("*.xlsx"))
    if not candidates:
        sys.exit("No workbook found. Pass the path as the first argument.")
    return candidates[0]


def color_of(color) -> str | None:
    if color is None:
        return None
    try:
        if color.type == "rgb" and isinstance(color.rgb, str):
            return color.rgb.upper()
        if color.type == "theme":
            return f"theme{color.theme}"
        if color.type == "indexed":
            return f"indexed{color.indexed}"
    except Exception:  # openpyxl raises on some malformed colors
        return None
    return None


def fill_of(cell) -> str | None:
    if cell.fill is None or cell.fill.fill_type != "solid":
        return None
    rgb = color_of(cell.fill.fgColor)
    if rgb in (None, "00000000"):
        return None
    return rgb


def is_formula(value) -> bool:
    return (isinstance(value, str) and value.startswith("=")) or type(value).__name__ == "ArrayFormula"


def formula_text(value) -> str | None:
    if type(value).__name__ == "ArrayFormula":
        return value.text
    if isinstance(value, str) and value.startswith("="):
        return value
    return None


def jsonable(v):
    if isinstance(v, (dt.datetime, dt.date)):
        return v.isoformat()
    if isinstance(v, float) and v != v:  # NaN
        return None
    return v


def precedents_of(formula: str, own_sheet: str) -> tuple[list[str], bool]:
    refs: list[str] = []
    cross = False
    for m in REF_RE.finditer(formula):
        sheet = m.group("sheet")
        ref = m.group("c1") + (":" + m.group("c2") if m.group("c2") else "")
        ref = ref.replace("$", "")
        if sheet:
            sname = sheet[:-1].strip("'")
            if sname != own_sheet:
                cross = True
            refs.append(f"{sname}!{ref}")
        else:
            refs.append(ref)
    seen: list[str] = []
    for r in refs:
        if r not in seen:
            seen.append(r)
    return seen, cross


def normalize_formula(formula: str, row: int) -> str:
    """Rewrite relative row numbers as offsets so copied-down formulas compare equal."""
    def repl(m):
        dcol, col, drow, r = m.groups()
        if drow == "$":
            return m.group(0)
        off = int(r) - row
        sign = "+" if off >= 0 else "-"
        return f"{dcol}{col}{{r{sign}{abs(off)}}}"
    # skip sheet-qualified names inside quotes; they carry no row numbers of their own
    return CELL_RE.sub(repl, formula)


def is_text(v) -> bool:
    return isinstance(v, str) and not v.startswith("=") and v.strip() != ""


def label_for(ws, row: int, col: int) -> str | None:
    for c in range(col - 1, 0, -1):
        v = ws.cell(row=row, column=c).value
        if is_text(v):
            return v.strip()
    for r in range(row - 1, 0, -1):
        v = ws.cell(row=r, column=col).value
        if is_text(v):
            return v.strip()
    return None


def section_for(ws, row: int) -> str | None:
    """Nearest all-caps text above in columns A to C. Falls back to nearest bold
    text only when no all-caps header exists above, because most row labels in
    this workbook are bold and would otherwise shadow the real section header."""
    bold_fallback = None
    for r in range(row - 1, 0, -1):
        for c in (1, 2, 3):
            cell = ws.cell(row=r, column=c)
            v = cell.value
            if not is_text(v):
                continue
            letters = [ch for ch in v if ch.isalpha()]
            all_caps = bool(letters) and all(ch.isupper() for ch in letters)
            if all_caps:
                return v.strip()
            if bold_fallback is None and cell.font and cell.font.bold:
                bold_fallback = v.strip()
    return bold_fallback


# --------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------

def cell_entry(ws, wsv, cell) -> dict | None:
    v = cell.value
    fill = fill_of(cell)
    yellow = fill == INPUT_FILL
    blue = ws.title in BUY_HOLD_SHEETS and fill == BUY_HOLD_INPUT_FILL
    formula = formula_text(v)
    if formula is None and not (yellow or blue):
        return None
    if formula is None and v is None:
        # an empty yellow cell is still an input slot; keep it
        pass
    cached = wsv[cell.coordinate].value
    if formula is not None:
        prec, cross = precedents_of(formula, ws.title)
    else:
        prec, cross = [], False
    entry = {
        "sheet": ws.title,
        "cell": cell.coordinate,
        "formula": formula,
        "cached_value": jsonable(cached),
        "precedents": prec,
        "cross_sheet": cross,
        "is_input": yellow or blue,
        "label": label_for(ws, cell.row, cell.column),
        "section": section_for(ws, cell.row),
        "fill": fill,
        "font_color": color_of(cell.font.color) if cell.font else None,
        "number_format": cell.number_format,
    }
    if blue:
        entry["input_convention"] = "blue fill (Buy & Hold sheet rule)"
    if type(v).__name__ == "ArrayFormula":
        entry["array_formula"] = True
        entry["array_ref"] = v.ref
    if formula is None:
        entry["constant_value"] = jsonable(v)
    return entry


def extract_sheet(ws, wsv) -> dict:
    entries: list[dict] = []
    for row in ws.iter_rows():
        for cell in row:
            e = cell_entry(ws, wsv, cell)
            if e is not None:
                entries.append(e)

    rng = REPEATED_RANGES.get(ws.title)
    if rng is None:
        return {"cells": entries, "patterns": []}

    lo, hi = rng
    in_range = [e for e in entries if lo <= int(CELL_RE.match(e["cell"]).group(4)) <= hi]
    outside = [e for e in entries if e not in in_range]

    by_col: dict[str, list[dict]] = {}
    for e in in_range:
        col = CELL_RE.match(e["cell"]).group(2)
        by_col.setdefault(col, []).append(e)

    patterns: list[dict] = []
    leftovers: list[dict] = []
    for col in sorted(by_col, key=column_index_from_string):
        cells = by_col[col]
        formula_cells = [e for e in cells if e["formula"] is not None]
        const_cells = [e for e in cells if e["formula"] is None]
        if formula_cells:
            norm = Counter(
                normalize_formula(e["formula"], int(CELL_RE.match(e["cell"]).group(4)))
                for e in formula_cells
            )
            best, n = norm.most_common(1)[0]
            if n >= 3 and n * 2 >= len(cells):
                matching = [
                    e for e in formula_cells
                    if normalize_formula(e["formula"], int(CELL_RE.match(e["cell"]).group(4))) == best
                ]
                exceptions = [e for e in cells if e not in matching]
                rows = [int(CELL_RE.match(e["cell"]).group(4)) for e in matching]
                ex = matching[0]
                patterns.append({
                    "sheet": ws.title,
                    "column": col,
                    "row_range": [min(rows), max(rows)],
                    "rows_matching": rows,
                    "cell_count": len(matching),
                    "formula_pattern": best,
                    "formula_example": ex["formula"],
                    "example_cell": ex["cell"],
                    "precedents_example": ex["precedents"],
                    "cross_sheet": ex["cross_sheet"],
                    "is_input": ex["is_input"],
                    "label": ex["label"],
                    "section": ex["section"],
                    "number_format": ex["number_format"],
                    "cached_values": {e["cell"]: e["cached_value"] for e in matching},
                    "exceptions": exceptions,
                })
                continue
            leftovers.extend(cells)
            continue
        if const_cells and all(e["is_input"] for e in const_cells) and len(const_cells) >= 3:
            rows = [int(CELL_RE.match(e["cell"]).group(4)) for e in const_cells]
            ex = const_cells[0]
            patterns.append({
                "sheet": ws.title,
                "column": col,
                "row_range": [min(rows), max(rows)],
                "rows_matching": rows,
                "cell_count": len(const_cells),
                "formula_pattern": None,
                "formula_example": None,
                "example_cell": ex["cell"],
                "precedents_example": [],
                "cross_sheet": False,
                "is_input": True,
                "label": ex["label"],
                "section": ex["section"],
                "number_format": ex["number_format"],
                "cached_values": {e["cell"]: e["cached_value"] for e in const_cells},
                "exceptions": [],
            })
            continue
        leftovers.extend(cells)

    return {"cells": outside + leftovers, "patterns": patterns}


# --------------------------------------------------------------------------
# Golden fixtures
# --------------------------------------------------------------------------

def V(wbv, sheet: str, ref: str):
    return jsonable(wbv[sheet][ref].value)


def col_range(wbv, sheet: str, col: str, lo: int, hi: int) -> list:
    return [V(wbv, sheet, f"{col}{r}") for r in range(lo, hi + 1)]


def acquisitions_inputs(wbv) -> dict:
    s = "Aquisitions Deal Analyzer"
    g = lambda ref: V(wbv, s, ref)
    return {
        "holdMonths": g("E9"),
        "asIsValue": g("E10"),
        "purchasePrice": g("E11"),
        "repairCosts": g("E12"),
        "arv": g("E13"),
        "assignmentFee": g("N4"),
        "firstLienAmount": g("E19"),
        "firstPointsRate": g("E20"),
        "firstInterestRate": g("E21"),
        "firstMonthlyInterestOnlyRate": g("E22"),
        "secondLienAmount": g("E23"),
        "secondPointsRate": g("E24"),
        "secondInterestRate": g("E25"),
        "secondMonthlyInterestOnlyRate": g("E26"),
        "miscLienAmountPaid": g("F27"),
        "miscPointsPaid": g("F28"),
        "miscInterestPaid": g("F29"),
        "miscMonthlyInterestOnlyPaid": g("F30"),
        "miscFinancingCosts": g("F31"),
        "propertyTaxRate": g("J19"),
        "hoaMonthly": g("J20"),
        "insuranceMonthly": g("J21"),
        "utilitiesMonthly": g("J22"),
        "gasMonthly": g("J23"),
        "waterMonthly": g("J24"),
        "electricityMonthly": g("J25"),
        "miscUtilitiesMonthly": g("J26") or 0,
        "miscHoldingMonthly1": g("J28") or 0,
        "miscHoldingMonthly2": g("J29") or 0,
        "miscHoldingMonthly3": g("J30") or 0,
        "miscHoldingMonthly4": g("J31") or 0,
        "buyEscrowRate": g("E37"),
        "buyTitleRate": g("E38"),
        "buyMiscRate": g("E39"),
        "sellEscrowRate": g("E42"),
        "sellRecordingRate": g("E43"),
        "sellRealtorRate": g("E44"),
        "sellTransferRate": g("E45"),
        "sellHomeWarranty": g("F46"),
        "sellStaging": g("F47"),
        "sellMarketing": g("F48"),
        "sellMisc": g("F49"),
    }


def acquisitions_expected(wbv) -> dict:
    s = "Aquisitions Deal Analyzer"
    g = lambda ref: V(wbv, s, ref)
    return {
        "seventyPercentArv": g("N3"),
        "allInMaxLimit": g("N5"),
        "offerRepairCosts": g("N6"),
        "offer": g("N7"),
        "offerPctOfArv": g("N8"),
        "totalFinancingCosts": g("E32"),
        "totalHoldingCosts": g("J32"),
        "totalBuyingCosts": g("J12"),
        "totalSellingCosts": g("J13"),
        "purchaseAndRepairCosts": g("E14"),
        "netProfit": g("J14"),
        "cashInvested": g("N11"),
        "cashReturn": g("N12"),
        "roiOnCash": g("N13"),
        "timeToReturn": g("N14"),
        "firstPointsPaid": g("F20"),
        "firstInterestPaid": g("F21"),
        "firstInterestOnlyPaid": g("F22"),
        "secondPointsPaid": g("F24"),
        "secondInterestPaid": g("F25"),
        "secondInterestOnlyPaid": g("F26"),
        "propertyTaxesTotal": g("K19"),
        "hoaTotal": g("K20"),
        "insuranceTotal": g("K21"),
        "utilitiesTotal": g("K22"),
        "gasTotal": g("K23"),
        "waterTotal": g("K24"),
        "electricityTotal": g("K25"),
        "miscUtilitiesTotal": g("K26"),
        "totalMaintenanceCosts": g("J27"),
        "miscHoldingTotal1": g("K28"),
        "miscHoldingTotal2": g("K29"),
        "miscHoldingTotal3": g("K30"),
        "miscHoldingTotal4": g("K31"),
        "buyEscrow": g("F37"),
        "buyTitle": g("F38"),
        "buyMisc": g("F39"),
        "sellEscrow": g("F42"),
        "sellRecording": g("F43"),
        "sellRealtor": g("F44"),
        "sellTransfer": g("F45"),
        "delayedCashInvested": g("H39"),
        "delayedCashToCover": g("I39"),
        "delayedTotalCash": g("J39"),
        "delayedCashReturn": g("J40"),
        "delayedExpectedRoi": g("H41"),
        "delayedActualRoi": g("J41"),
        "upfrontCashInvested": g("H46"),
        "upfrontCashToCover": g("I46"),
        "upfrontTotalCash": g("J46"),
        "upfrontCashReturn": g("J47"),
        "upfrontExpectedRoi": g("H48"),
        "upfrontActualRoi": g("J48"),
    }


COST_COLUMNS = [
    ("L", "constructionCosts"), ("M", "purchasePrice"), ("N", "firstPoints"),
    ("O", "firstInterest"), ("P", "firstInterestOnly"), ("Q", "propertyTaxes"),
    ("R", "hoa"), ("S", "insurance"), ("T", "gas"), ("U", "water"),
    ("V", "electricity"), ("W", "miscUtilities"), ("X", "buyEscrow"),
    ("Y", "buyTitle"), ("Z", "buyMisc"), ("AA", "sellEscrow"),
    ("AB", "sellRecording"), ("AC", "sellRealtor"), ("AD", "sellTransfer"),
    ("AE", "sellHomeWarranty"), ("AF", "sellStaging"), ("AG", "sellMarketing"),
    ("AH", "sellMisc"),
]


def draw_fixture(wbv, wb, sheet: str, schedule: str) -> dict:
    g = lambda ref: V(wbv, sheet, ref)
    acq = "Aquisitions Deal Analyzer"
    inputs = {
        "schedule": schedule,
        "maxWeeks": 36,
        "holdMonths": V(wbv, acq, "E9"),
        "purchasePrice": V(wbv, acq, "E11"),
        "repairCosts": V(wbv, acq, "E12"),
        "arv": V(wbv, acq, "E13"),
        "beginningCashBalance": g("H3"),
        "drawPercents": [g("E7"), g("E8"), g("E9")],
        "frequencyLabels": {name: g(f"{col}4") for col, name in COST_COLUMNS},
        "costTotals": {name: g(f"{col}3") for col, name in COST_COLUMNS},
    }
    weeks = []
    for r in range(6, 42):
        weeks.append({
            "week": g(f"F{r}"),
            "cashIn": g(f"G{r}"),
            "balance": g(f"H{r}"),
            "expenses": g(f"I{r}"),
        })
    balances = [w["balance"] for w in weeks]
    cash_in_table = []
    for r in range(6, 13):
        cash_in_table.append({
            "row": r,
            "label": g(f"B{r}"),
            "week": g(f"C{r}"),
            "amount": g(f"D{r}"),
        })
    expected = {
        "durationWeeks": g("F4"),
        "netCashIn": g("C3"),
        "totalExpenses": g("I4"),
        "drawWeeks": [g("C7"), g("C8"), g("C9")],
        "cashInTable": cash_in_table,
        "weeks": weeks,
        "balances": balances,
        "minBalance": min(balances),
        "minBalanceWeek": balances.index(min(balances)) + 1,
        "endingBalance": g("H43"),
        "excessCash": g("E43"),
        "columnTotals": {name: g(f"{col}42") for col, name in COST_COLUMNS},
        "unaccountedCosts": {name: g(f"{col}43") for col, name in COST_COLUMNS},
        "weeklyCostGrid": {
            name: col_range(wbv, sheet, col, 6, 41) for col, name in COST_COLUMNS
        },
    }
    return {
        "source": {"sheet": sheet, "workbook": WORKBOOK_NAME, "sha256": WORKBOOK_SHA},
        "inputs": inputs,
        "expected": expected,
    }


def quick_offers_fixture(wbv) -> dict:
    s = "Quick Offers"
    g = lambda ref: V(wbv, s, ref)
    inputs = {
        "comps": [g("H3"), g("I3"), g("J3")],
        "squareFeet": g("F4"),
        "assignmentFeeFull": g("C4"),
        "assignmentFeeMedium": g("C13"),
        "assignmentFeeLight": g("C22"),
        "costPerSqftFull": g("F5"),
        "costPerSqftMedium": g("F6"),
        "costPerSqftLight": g("F7"),
        "valueWant": {"probabilityOfSale": g("G14"), "timeMonths": g("I14"), "effort": g("J14")},
        "valueAre": {"probabilityOfSale": g("G15"), "timeMonths": g("I15"), "effort": g("J15")},
    }
    expected = {
        "arv": g("F3"),
        "arvAverage": g("K3"),
        "full": {
            "seventyPercentArv": g("C3"), "allInMaxLimit": g("C5"), "repairCosts": g("C6"),
            "offer": g("C7"), "pctOfArv": g("C8"),
        },
        "medium": {
            "seventyPercentArv": g("C12"), "allInMaxLimit": g("C14"), "repairCosts": g("C15"),
            "offer": g("C16"), "pctOfArv": g("C17"),
        },
        "light": {
            "seventyPercentArv": g("C21"), "allInMaxLimit": g("C23"), "repairCosts": g("C24"),
            "offer": g("C25"), "pctOfArv": g("C26"),
        },
        "valueWantPrice": g("F14"),
        "valueArePrice": g("F15"),
        "valueWant": g("K14"),
        "valueAre": g("K15"),
        "valueDifference": g("K16"),
    }
    return {"source": {"sheet": s, "workbook": WORKBOOK_NAME, "sha256": WORKBOOK_SHA},
            "inputs": inputs, "expected": expected}


def rehab_fixture(wb, wbv) -> dict:
    s = "Rehab Estimator"
    ws, wsv = wb[s], wbv[s]
    items = []
    line_totals = {}
    current_item = None
    for r in range(3, 70):
        a = ws[f"A{r}"].value
        if a is not None:
            current_item = int(a)
        items.append({
            "row": r,
            "itemNumber": current_item,
            "question": ws[f"B{r}"].value,
            "option": ws[f"G{r}"].value,
            "answer": ws[f"E{r}"].value,
            "quantity": ws[f"F{r}"].value,
            "unitCost": ws[f"H{r}"].value,
        })
        line_totals[f"I{r}"] = jsonable(wsv[f"I{r}"].value)
    return {
        "source": {"sheet": s, "workbook": WORKBOOK_NAME, "sha256": WORKBOOK_SHA},
        "inputs": {"address": ws["B1"].value, "lines": items},
        "expected": {"total": jsonable(wsv["I1"].value), "lineTotals": line_totals},
    }


def buy_hold_fixture(wb, wbv, sheet: str) -> dict:
    ws = wb[sheet]
    g = lambda ref: V(wbv, sheet, ref)
    raw = lambda ref: jsonable(ws[ref].value)
    units = []
    for r in range(9, 29):
        units.append({
            "unit": raw(f"B{r}"), "beds": raw(f"C{r}"), "baths": raw(f"D{r}"),
            "rent": raw(f"E{r}"), "marketRent": raw(f"F{r}"),
        })
    inputs = {
        "salePrice": g("C5"), "taxValue": g("F5"),
        "rentGrowthRate": g("Z5"), "dcrRequired": g("T6"),
        "units": units,
        "propertyTaxYear": g("C33"), "downPaymentPct": g("E33"),
        "insuranceMonth": g("C34"), "interestRate": g("E34"),
        "gasElectricMonth": g("C35"), "loanTermYears": g("E35"),
        "waterMonth": g("C36"), "closingCosts": g("E36"),
        "closingCostsFormula": raw("E36"),
        "sewerMonth": g("C37"), "garbageMonth": g("C38"), "lawnSnowMonth": g("C39"),
        "managementPct": g("C40"), "vacancyPct": g("C41"), "maintenancePct": g("C42"),
        "cashReservesPct": g("T12"),
        "vacancyPctDcr": g("T10"), "managementPctDcr": g("T11"), "maintenancePctDcr": g("T15"),
        "improvedValueRatio": g("P21"), "marginalTaxRate": g("P22"),
        "appreciationRate": g("S24"),
    }
    expected = {
        "current": {
            "grossRents": g("I8"), "management": g("I9"), "propertyTaxes": g("I10"),
            "insurance": g("I11"), "ownerPaidUtilities": g("I12"), "vacancyReserve": g("I13"),
            "maintenanceReserve": g("I14"), "totalOperatingExpenses": g("I15"),
            "monthlyNoi": g("I16"), "annualizedNoi": g("I17"), "capRate": g("I18"),
            "salePrice": g("L8"), "loanToValue": g("L9"), "downPayment": g("L10"),
            "closingCosts": g("L11"), "principal": g("L12"), "interestRate": g("L13"),
            "termYears": g("L14"), "monthlyMortgage": g("L15"), "monthlyNet": g("L16"),
            "annualizedNet": g("L17"), "annualizedRoi": g("L18"),
        },
        "market": {
            "grossRents": g("I23"), "management": g("I24"), "propertyTaxes": g("I25"),
            "insurance": g("I26"), "ownerPaidUtilities": g("I27"), "vacancyReserve": g("I28"),
            "maintenanceReserve": g("I29"), "totalOperatingExpenses": g("I30"),
            "monthlyNoi": g("I31"), "annualizedNoi": g("I32"), "capRate": g("I33"),
            "salePrice": g("L23"), "loanToValue": g("L24"), "downPayment": g("L25"),
            "closingCosts": g("L26"), "principal": g("L27"), "interestRate": g("L28"),
            "termYears": g("L29"), "monthlyMortgage": g("L30"), "monthlyNet": g("L31"),
            "annualizedNet": g("L32"), "annualizedRoi": g("L33"),
        },
        "debtPaydown": [
            {"year": y, "totalDebtPaydown": g(f"P{8 + 2 * (y - 1)}"), "roiOnPaydown": g(f"P{9 + 2 * (y - 1)}")}
            for y in range(1, 6)
        ],
        "taxDeductions": [
            {"year": y, "depreciation": g(f"P{25 + 3 * (y - 1)}"), "totalInterestPaid": g(f"P{26 + 3 * (y - 1)}"),
             "totalDeductions": g(f"P{27 + 3 * (y - 1)}")}
            for y in range(1, 6)
        ],
        "avgYearlyTaxSavings": g("P40"),
        "annualRoiOnTaxSavings": g("P41"),
        "dcr": {
            "proForma": {
                "grossRents": g("U9"), "vacancy": g("U10"), "propMgmt": g("U11"),
                "cashReserves": g("U12"), "taxes": g("U13"), "insurance": g("U14"),
                "maintenanceUtilities": g("U15"), "totalExpenses": g("U16"), "noi": g("U17"),
                "mortgage": g("U18"), "dcr": g("U20"), "netProfit": g("U21"),
            },
            "actual": {
                "grossRents": g("V9"), "vacancy": g("V10"), "propMgmt": g("V11"),
                "cashReserves": g("V12"), "taxes": g("V13"), "insurance": g("V14"),
                "maintenanceUtilities": g("V15"), "totalExpenses": g("V16"), "noi": g("V17"),
                "mortgage": g("V18"), "dcr": g("V20"), "netProfit": g("V21"),
            },
        },
        "appreciation": [
            {"year": y, "estValue": g(f"S{26 + y}"), "annualGain": g(f"T{26 + y}"), "pctGain": g(f"U{26 + y}")}
            for y in range(1, 6)
        ],
        "totalReturn": [
            {"year": y, "cashFlow": g(f"{c}36"), "debtPaydown": g(f"{c}37"), "taxSavings": g(f"{c}38"),
             "appreciation": g(f"{c}39"), "totalRoi": g(f"{c}40"), "totalDollarReturn": g(f"{c}41")}
            for y, c in zip(range(1, 6), "STUVW")
        ],
        "rentGrowth": [{"year": r - 8, "marketRent": g(f"Z{r}")} for r in range(9, 29)],
        "marketRentYear1": g("Z6"),
        "totalRent": g("E29"),
        "totalMarketRent": g("F29"),
    }
    if sheet == "Buy & Hold 2":
        expected["rentDerived"] = {"E6": g("E6"), "F6": g("F6")}
    return {"source": {"sheet": sheet, "workbook": WORKBOOK_NAME, "sha256": WORKBOOK_SHA},
            "inputs": inputs, "expected": expected}


def amortization_fixture(wb, wbv) -> dict:
    s = "Amortization Schedule"
    g = lambda ref: V(wbv, s, ref)
    inputs = {
        "loanAmount": g("B2"),
        "annualRate": g("B3"),
        "periods": g("B4"),
        "startDate": g("C10"),
        "startDateSource": "TODAY() cached at last save",
        "daysInMonth": [g(f"{c}2") for c in "DEFGHIJKLMNO"],
        "payoffLookupMonths": [g(f"{c}4") for c in "EFGHIJ"],
        "monthlyInsurance": g("R5"),
        "monthlyRevenue": g("R6"),
    }
    rows = []
    for r in range(10, 70):
        rows.append({
            "period": g(f"B{r}"), "daysInMonth": g(f"A{r}"), "date": g(f"C{r}"),
            "beginningBalance": g(f"D{r}"), "payment": g(f"E{r}"), "principal": g(f"F{r}"),
            "interest": g(f"G{r}"), "cumulativePrincipal": g(f"H{r}"),
            "cumulativeInterest": g(f"I{r}"), "endingBalance": g(f"J{r}"),
            "side": {"month": g(f"P{r}"), "payment": g(f"Q{r}"), "insurance": g(f"R{r}"),
                     "revenue": g(f"S{r}"), "profit": g(f"T{r}"), "financialRisk": g(f"U{r}"),
                     "investorProfit": g(f"V{r}"), "vdaProfit": g(f"W{r}")},
        })
    expected = {
        "payment": g("B5"),
        "monthlyOpsProfit": g("B6"),
        "payoffAmounts": [g(f"{c}5") for c in "EFGHIJ"],
        "ownerRealizedProfit": [g(f"{c}6") for c in "EFGHIJ"],
        "vdaRealizedProfit": [g(f"{c}7") for c in "EFGHIJ"],
        "summary": {"loanAmount": g("R1"), "interestRate": g("R2"), "loanPeriod": g("R3"), "payment": g("R4")},
        "rows": rows,
        "endingBalances": [row["endingBalance"] for row in rows],
        "totals": {"principal": g("F71"), "interest": g("G71"), "revenue": g("S70"),
                   "profit": g("T70"), "investorProfit": g("V70"), "vdaProfit": g("W70")},
    }
    return {"source": {"sheet": s, "workbook": WORKBOOK_NAME, "sha256": WORKBOOK_SHA},
            "inputs": inputs, "expected": expected}


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main(argv: list[str]) -> None:
    global WORKBOOK_NAME, WORKBOOK_SHA
    path = find_workbook(argv)
    WORKBOOK_NAME = path.name
    WORKBOOK_SHA = hashlib.sha256(path.read_bytes()).hexdigest()

    wb = openpyxl.load_workbook(path)
    wbv = openpyxl.load_workbook(path, data_only=True)

    sheets: dict[str, dict] = {}
    formula_total = 0
    input_total = 0
    missing_cache: list[str] = []
    functions: Counter = Counter()
    for ws in wb.worksheets:
        wsv = wbv[ws.title]
        data = extract_sheet(ws, wsv)
        f_count = 0
        i_count = 0
        for e in data["cells"]:
            if e["formula"] is not None:
                f_count += 1
            if e["is_input"]:
                i_count += 1
            if e["formula"] is not None and e["cached_value"] is None:
                missing_cache.append(f"{ws.title}!{e['cell']}")
        for p in data["patterns"]:
            if p["formula_pattern"] is not None:
                f_count += p["cell_count"]
            if p["is_input"]:
                i_count += p["cell_count"]
            for c, v in p["cached_values"].items():
                if p["formula_pattern"] is not None and v is None:
                    missing_cache.append(f"{ws.title}!{c}")
            for e in p["exceptions"]:
                if e["formula"] is not None:
                    f_count += 1
                    if e["cached_value"] is None:
                        missing_cache.append(f"{ws.title}!{e['cell']}")
                if e["is_input"]:
                    i_count += 1
        for row in ws.iter_rows():
            for cell in row:
                f = formula_text(cell.value)
                if f:
                    for m in re.findall(r"([A-Za-z]+)\(", f):
                        functions[m.upper()] += 1
        data["formula_cells"] = f_count
        data["input_cells"] = i_count
        data["dimensions"] = ws.dimensions
        sheets[ws.title] = data
        formula_total += f_count
        input_total += i_count

    validations = []
    for ws in wb.worksheets:
        for dv in ws.data_validations.dataValidation:
            validations.append({"sheet": ws.title, "range": str(dv.sqref), "type": dv.type, "formula1": dv.formula1})

    out = {
        "source": {
            "workbook": WORKBOOK_NAME,
            "sha256": WORKBOOK_SHA,
            "extracted_at": dt.datetime.now().isoformat(timespec="seconds"),
            "today_cached": V(wbv, "Amortization Schedule", "C10"),
            "input_fill": INPUT_FILL,
            "buy_hold_input_fill": BUY_HOLD_INPUT_FILL,
        },
        "summary": {
            "formula_cells": formula_total,
            "input_cells": input_total,
            "sheets": {name: {"formula_cells": d["formula_cells"], "input_cells": d["input_cells"],
                              "patterns": len(d["patterns"])} for name, d in sheets.items()},
            "functions_used": dict(sorted(functions.items())),
            "defined_names": list(wb.defined_names.keys()) if hasattr(wb.defined_names, "keys") else [],
            "external_links": len(wb._external_links),
            "data_validations": validations,
            "formula_cells_without_cached_value": missing_cache,
        },
        "sheets": sheets,
    }
    SPEC.mkdir(exist_ok=True)
    GOLDEN.mkdir(exist_ok=True)
    (SPEC / "cells.json").write_text(json.dumps(out, indent=1), encoding="utf-8")

    fixtures = {
        "quick-offers.json": quick_offers_fixture(wbv),
        "rehab-estimator.json": rehab_fixture(wb, wbv),
        "acquisitions.json": {
            "source": {"sheet": "Aquisitions Deal Analyzer", "workbook": WORKBOOK_NAME, "sha256": WORKBOOK_SHA},
            "inputs": acquisitions_inputs(wbv),
            "expected": acquisitions_expected(wbv),
        },
        "draw-cash-flow-delayed.json": draw_fixture(wbv, wb, "Delayed Draw Cash Flow", "delayed"),
        "draw-cash-flow-upfront.json": draw_fixture(wbv, wb, "Up Front Draw Cash Flow", "upfront"),
        "buy-and-hold.json": buy_hold_fixture(wb, wbv, "Buy & Hold"),
        "amortization.json": amortization_fixture(wb, wbv),
    }
    for name, fx in fixtures.items():
        (GOLDEN / name).write_text(json.dumps(fx, indent=1), encoding="utf-8")

    print(f"workbook: {path}")
    print(f"formula cells: {formula_total}")
    print(f"input cells: {input_total}")
    for name, d in sheets.items():
        print(f"  {name!r:32} formulas={d['formula_cells']:5} inputs={d['input_cells']:4} patterns={len(d['patterns'])}")
    print(f"functions: {sorted(functions)}")
    print(f"formula cells without cached value: {missing_cache or 'none'}")
    print(f"fixtures: {', '.join(fixtures)}")


if __name__ == "__main__":
    main(sys.argv)
