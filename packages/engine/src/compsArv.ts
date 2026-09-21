/**
 * Comparable sales to an after repair value. Pure, so the rules can be tested and so the same
 * numbers appear in the workspace and in anything that saves them.
 *
 * Every comp is adjusted toward the subject: if the subject is larger, newer, or has more rooms,
 * the comp gets a positive adjustment, because that comp would have sold higher if it matched the
 * subject. A time adjustment moves an older sale to today at a monthly market rate.
 *
 * The rates in DEFAULT_COMP_RATES and DEFAULT_COMP_SCORING are DEFAULTS, not market facts. They are
 * starting values so the page has something to show before anyone sets their own. Nothing here is an
 * appraisal, and the confidence score is an estimate aid, not a measure of value.
 */

export type CompsSubject = { sqft: number | null; beds: number | null; baths: number | null; yearBuilt: number | null; lotSqft: number | null };

/** One adjustment the user typed, in dollars. Negative lowers the comp toward the subject. */
export type ManualAdjustment = { label: string; amount: number };

export type CompInput = {
  id: string;
  /** Address or note. Carried through so the caller does not have to join back. */
  label: string;
  /** Sold price in dollars. */
  price: number;
  /** ISO date or timestamp. Null when the sale date is not on file. */
  soldOn: string | null;
  sqft: number | null; beds: number | null; baths: number | null; yearBuilt: number | null; lotSqft: number | null;
  distanceMi: number | null;
  included: boolean;
  manual: ManualAdjustment[];
};

/** Dollar rates behind each adjustment. Defaults only. Set them from local sales before relying on the output. */
export type CompsRates = {
  /** Dollars per square foot of interior difference. */
  perSqft: number;
  /** Dollars per bedroom of difference. */
  perBed: number;
  /** Dollars per bathroom of difference. */
  perBath: number;
  /** Dollars per year of age difference, applied to year built. */
  perYearBuilt: number;
  /** Dollars per square foot of lot difference. */
  perLotSqft: number;
  /** Share of the sale price per month since the sale, applied straight rather than compounded. 0.003 is 0.3 percent a month. */
  monthlyMarket: number;
};

/** Tuning behind the weights and the confidence score. Defaults only. */
export type CompsScoring = {
  /** Distance in miles at which the distance factor falls to one half. */
  distanceHalfMi: number;
  /** Months since sale at which the recency factor falls to one half. */
  recencyHalfMonths: number;
  /** Size difference as a share of subject square feet at which the size factor falls to one half. */
  sizeHalfPct: number;
  /** Factor used when the comp is missing the field a factor needs. */
  unknownWeight: number;
  /** Comp count at which the count part of confidence reaches full marks. */
  targetCount: number;
  /** Spread of adjusted prices, as a share of the ARV, at which the dispersion part reaches zero. */
  maxDispersion: number;
  /** Average months since sale at which the recency part of confidence reaches zero. */
  maxMonths: number;
  /** Average distance in miles at which the distance part of confidence reaches zero. */
  maxDistanceMi: number;
  /** Net adjustment above this share of the sale price raises a flag on that comp. */
  netAdjustmentWarnPct: number;
};

export const DEFAULT_COMP_RATES: CompsRates = { perSqft: 50, perBed: 5000, perBath: 7500, perYearBuilt: 250, perLotSqft: 2, monthlyMarket: 0.003 };

export const DEFAULT_COMP_SCORING: CompsScoring = {
  distanceHalfMi: 0.5, recencyHalfMonths: 6, sizeHalfPct: 0.15, unknownWeight: 0.5,
  targetCount: 5, maxDispersion: 0.2, maxMonths: 12, maxDistanceMi: 2, netAdjustmentWarnPct: 0.25,
};

/** Shares of the confidence score. They sum to 1. Defaults, like everything else here. */
export const CONFIDENCE_WEIGHTS = { count: 0.3, dispersion: 0.3, recency: 0.2, distance: 0.2 };

/** A month is 30 days here, so the time adjustment is easy to check by hand. */
export const DAYS_PER_MONTH = 30;

export type AdjustmentKey = "sqft" | "beds" | "baths" | "age" | "lot" | "time" | "manual";

export type CompAdjustment = {
  key: AdjustmentKey;
  label: string;
  /** Dollars added to the sale price. */
  amount: number;
  /** The arithmetic in words, so the page can show the math instead of a bare number. */
  basis: string;
};

export type CompResult = {
  id: string; label: string; price: number; included: boolean;
  adjustments: CompAdjustment[];
  /** Sum of the adjustments. */
  netAdjustment: number;
  /** Sum of the absolute adjustments. A large gross on a small net still means a distant comp. */
  grossAdjustment: number;
  adjustedPrice: number;
  /** Relative, not a percentage. Only included comps carry a weight above zero. */
  weight: number;
  weightParts: { distance: number; recency: number; size: number };
  monthsSinceSale: number | null;
  adjustedPerSqft: number | null;
  /** Anything the user should see before trusting this row. */
  flags: string[];
};

export type CompsArvResult = {
  comps: CompResult[];
  includedCount: number;
  /** Weighted average of the included adjusted prices. Null when nothing is included. */
  arv: number | null;
  low: number | null;
  high: number | null;
  /** ARV divided by subject square feet. Null when the subject square feet are not on file. */
  perSqft: number | null;
  /** Weighted standard deviation of the included adjusted prices. */
  spread: number | null;
  /** 0 to 1. An estimate aid, not an appraisal. */
  confidence: number;
  /** Plain sentences behind the score, in the order the parts are weighted. */
  reasons: string[];
  rates: CompsRates;
  scoring: CompsScoring;
};

export type CompsArvInput = {
  subject: CompsSubject;
  comps: CompInput[];
  /** The date the math is run as of. Passed in rather than read from the clock so the result is reproducible. */
  asOf: string;
  rates?: Partial<CompsRates>;
  scoring?: Partial<CompsScoring>;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const n1 = (n: number) => String(Math.round(n * 10) / 10);
const plain = (n: number) => Math.round(n).toLocaleString("en-US");
/** Counts and rates keep a decimal, because half baths and fractional rates are both real. */
const qty = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US");

/** A bare "2026-03-25" is read at noon UTC so it lands on the typed day in every US zone. */
function parseDate(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T12:00:00Z` : text);
  return Number.isFinite(ms) ? ms : null;
}

/** Months between two dates at 30 days a month. Negative when the sale is after the as of date. */
export function monthsBetween(soldOn: string | null, asOf: string): number | null {
  if (!soldOn) return null;
  const from = parseDate(soldOn);
  const to = parseDate(asOf);
  if (from === null || to === null) return null;
  return (to - from) / 86_400_000 / DAYS_PER_MONTH;
}

/** Falls from 1 toward 0 as the value grows, passing one half at `half`. */
function near(value: number, half: number): number {
  if (!(half > 0)) return 1;
  return 1 / (1 + Math.max(0, value) / half);
}

function adjustOne(comp: CompInput, subject: CompsSubject, rates: CompsRates, scoring: CompsScoring, asOf: string): CompResult {
  const adjustments: CompAdjustment[] = [];
  const flags: string[] = [];

  const pair = (key: AdjustmentKey, label: string, subjectValue: number | null, compValue: number | null, rate: number, unit: string, missing: string) => {
    if (subjectValue === null || compValue === null) { flags.push(missing); return; }
    const diff = subjectValue - compValue;
    adjustments.push({ key, label, amount: r2(diff * rate), basis: `Subject ${qty(subjectValue)} less comp ${qty(compValue)}, ${qty(diff)} ${unit} at ${qty(rate)} each` });
  };

  pair("sqft", "Square feet", subject.sqft, comp.sqft, rates.perSqft, "sq ft", "Square feet missing, no size adjustment applied.");
  pair("beds", "Bedrooms", subject.beds, comp.beds, rates.perBed, "beds", "Bedroom count missing, no bedroom adjustment applied.");
  pair("baths", "Bathrooms", subject.baths, comp.baths, rates.perBath, "baths", "Bathroom count missing, no bathroom adjustment applied.");
  pair("age", "Age", subject.yearBuilt, comp.yearBuilt, rates.perYearBuilt, "years", "Year built missing, no age adjustment applied.");
  // Lot size is absent on most feeds, so a missing lot is silent rather than a flag on every row.
  if (subject.lotSqft !== null && comp.lotSqft !== null) {
    const diff = subject.lotSqft - comp.lotSqft;
    adjustments.push({ key: "lot", label: "Lot size", amount: r2(diff * rates.perLotSqft), basis: `Subject ${qty(subject.lotSqft)} less comp ${qty(comp.lotSqft)}, ${qty(diff)} lot sq ft at ${qty(rates.perLotSqft)} each` });
  }

  const months = monthsBetween(comp.soldOn, asOf);
  if (months === null) flags.push("Sale date missing, no time adjustment applied.");
  else adjustments.push({ key: "time", label: "Time since sale", amount: r2(comp.price * rates.monthlyMarket * months), basis: `${plain(comp.price)} at ${r4(rates.monthlyMarket * 100)} percent a month for ${n1(months)} months` });

  for (const m of comp.manual) {
    if (!Number.isFinite(m.amount) || m.amount === 0) continue;
    adjustments.push({ key: "manual", label: m.label || "Manual adjustment", amount: r2(m.amount), basis: "Entered by hand" });
  }

  const netAdjustment = r2(adjustments.reduce((a, x) => a + x.amount, 0));
  const grossAdjustment = r2(adjustments.reduce((a, x) => a + Math.abs(x.amount), 0));
  const adjustedPrice = r2(comp.price + netAdjustment);

  if (comp.price > 0 && Math.abs(netAdjustment) / comp.price > scoring.netAdjustmentWarnPct) {
    flags.push(`Net adjustment is ${n1((Math.abs(netAdjustment) / comp.price) * 100)} percent of the sale price. This comp is far from the subject.`);
  }
  if (months !== null && months < 0) flags.push("Sale date is after the as of date.");

  const sizePart = subject.sqft !== null && subject.sqft > 0 && comp.sqft !== null ? near(Math.abs(subject.sqft - comp.sqft) / subject.sqft, scoring.sizeHalfPct) : scoring.unknownWeight;
  const distancePart = comp.distanceMi !== null ? near(comp.distanceMi, scoring.distanceHalfMi) : scoring.unknownWeight;
  const recencyPart = months !== null ? near(months, scoring.recencyHalfMonths) : scoring.unknownWeight;
  const weight = comp.included ? r4(distancePart * recencyPart * sizePart) : 0;
  if (comp.distanceMi === null) flags.push("Distance missing, the distance weight falls back to the unknown default.");

  return {
    id: comp.id, label: comp.label, price: comp.price, included: comp.included,
    adjustments, netAdjustment, grossAdjustment, adjustedPrice,
    weight, weightParts: { distance: r4(distancePart), recency: r4(recencyPart), size: r4(sizePart) },
    monthsSinceSale: months === null ? null : r2(months),
    adjustedPerSqft: comp.sqft !== null && comp.sqft > 0 ? r2(adjustedPrice / comp.sqft) : null,
    flags,
  };
}

export function compsArv(input: CompsArvInput): CompsArvResult {
  const rates: CompsRates = { ...DEFAULT_COMP_RATES, ...input.rates };
  const scoring: CompsScoring = { ...DEFAULT_COMP_SCORING, ...input.scoring };
  const comps = input.comps.map((c) => adjustOne(c, input.subject, rates, scoring, input.asOf));
  const used = comps.filter((c) => c.included && c.weight > 0 && Number.isFinite(c.adjustedPrice));
  const reasons: string[] = [];

  if (used.length === 0) {
    reasons.push("No comps are included, so there is nothing to average.");
    return { comps, includedCount: 0, arv: null, low: null, high: null, perSqft: null, spread: null, confidence: 0, reasons, rates, scoring };
  }

  const totalWeight = used.reduce((a, c) => a + c.weight, 0);
  const arv = r2(used.reduce((a, c) => a + c.weight * c.adjustedPrice, 0) / totalWeight);
  const variance = used.reduce((a, c) => a + c.weight * (c.adjustedPrice - arv) ** 2, 0) / totalWeight;
  const spread = r2(Math.sqrt(variance));
  const prices = used.map((c) => c.adjustedPrice);
  const low = r2(Math.max(Math.min(...prices), arv - spread));
  const high = r2(Math.min(Math.max(...prices), arv + spread));
  const perSqft = input.subject.sqft !== null && input.subject.sqft > 0 ? r2(arv / input.subject.sqft) : null;

  const dispersion = arv > 0 ? spread / arv : 0;
  const dated = used.filter((c) => c.monthsSinceSale !== null);
  const avgMonths = dated.length ? dated.reduce((a, c) => a + (c.monthsSinceSale as number), 0) / dated.length : null;
  const placed = input.comps.filter((c) => c.included && c.distanceMi !== null);
  const avgDistance = placed.length ? placed.reduce((a, c) => a + (c.distanceMi as number), 0) / placed.length : null;

  const countPart = Math.min(used.length / scoring.targetCount, 1);
  const dispersionPart = 1 - Math.min(dispersion / scoring.maxDispersion, 1);
  const recencyPart = avgMonths === null ? 0 : 1 - Math.min(Math.max(0, avgMonths) / scoring.maxMonths, 1);
  const distancePart = avgDistance === null ? 0 : 1 - Math.min(Math.max(0, avgDistance) / scoring.maxDistanceMi, 1);
  const confidence = r2(CONFIDENCE_WEIGHTS.count * countPart + CONFIDENCE_WEIGHTS.dispersion * dispersionPart + CONFIDENCE_WEIGHTS.recency * recencyPart + CONFIDENCE_WEIGHTS.distance * distancePart);

  reasons.push(used.length >= scoring.targetCount
    ? `${used.length} comps included, at or above the ${scoring.targetCount} this score looks for.`
    : `${used.length} of the ${scoring.targetCount} comps this score looks for.`);
  reasons.push(`Adjusted prices sit ${n1(dispersion * 100)} percent around the average, against the ${n1(scoring.maxDispersion * 100)} percent spread that would score zero.`);
  reasons.push(avgMonths === null
    ? "No sale dates on file, so recency scores zero."
    : `Average sale is ${n1(avgMonths)} months old, against the ${plain(scoring.maxMonths)} months that would score zero.`);
  reasons.push(avgDistance === null
    ? "No distances on file, so distance scores zero."
    : `Average distance is ${n1(avgDistance)} miles, against the ${n1(scoring.maxDistanceMi)} miles that would score zero.`);
  reasons.push("This score weighs comp count, spread, recency, and distance. It is an estimate aid, not an appraisal.");

  return { comps, includedCount: used.length, arv, low, high, perSqft, spread, confidence, reasons, rates, scoring };
}
