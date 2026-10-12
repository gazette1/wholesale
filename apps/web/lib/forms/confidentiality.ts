/**
 * Buyer facing output never shows the contract price, the spread, MAO, or the assignment fee
 * (AGENTS.md section 9). ARV is allowed on buyer packages today, so it is not listed here.
 * Keys are compared after lower casing and removing every character that is not a letter or digit.
 */
export const FORBIDDEN_BUYER_KEYS: readonly string[] = [
  "contract_price", "contractPrice", "contract-price", "contract price", "contractprice", "our_contract_price", "ourContractPrice",
  "purchase_price", "purchasePrice", "our_price", "ourPrice",
  "spread", "gross_spread", "grossSpread", "net_spread", "netSpread",
  "mao", "max_allowable_offer", "maxAllowableOffer", "maximum_allowable_offer", "maximumAllowableOffer",
  "assignment_fee", "assignmentFee", "assignment fee", "assignmentfee", "wholesale_fee", "wholesaleFee",
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const FORBIDDEN_NORMALIZED = new Set(FORBIDDEN_BUYER_KEYS.map(norm));

// Phrases checked inside string values. "mao" and "spread" match as whole words only.
const FORBIDDEN_PHRASES: RegExp[] = [
  /contract[\s_-]*price/i, /assignment[\s_-]*fee/i, /purchase[\s_-]*price/i, /\bspread\b/i, /\bmao\b/i,
  /max(imum)?[\s_-]*allowable[\s_-]*offer/i,
];

const MAX_DEPTH = 40;

/** Throws if a forbidden key or phrase appears anywhere in the value. The message never repeats the matched content. */
export function assertNoConfidentialData(value: unknown): void {
  scan(value, 0, new WeakSet());
}

function scan(v: unknown, depth: number, seen: WeakSet<object>): void {
  if (depth > MAX_DEPTH) throw new Error("Confidential data check failed: value is nested too deeply.");
  if (typeof v === "string") {
    if (FORBIDDEN_PHRASES.some((re) => re.test(v))) throw new Error("Confidential data check failed: a value mentions a deal figure that buyers must not see.");
    return;
  }
  if (!v || typeof v !== "object") return;
  if (seen.has(v)) return;
  seen.add(v);
  if (Array.isArray(v)) {
    for (const x of v) scan(x, depth + 1, seen);
    return;
  }
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (FORBIDDEN_NORMALIZED.has(norm(k))) throw new Error("Confidential data check failed: a field name is a deal figure that buyers must not see.");
    scan(x, depth + 1, seen);
  }
}
