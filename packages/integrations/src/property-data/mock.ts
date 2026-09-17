import type { PropertyDataProvider, AddressQuery, PropertyLookupResult, CompQuery, CompResult } from "./types";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Deterministic fake data keyed on the address so demos are stable. Costs nothing. */
export class MockPropertyDataProvider implements PropertyDataProvider {
  readonly name = "mock";

  async lookup(q: AddressQuery): Promise<PropertyLookupResult> {
    const h = hash(`${q.addressLine1}|${q.city}|${q.state}|${q.postalCode}`.toLowerCase());
    const r = (n: number) => (h >>> (n % 24)) % 1000 / 1000;
    const sqft = 900 + Math.round(r(3) * 1500);
    const arv = Math.round((140 + r(5) * 280) * 1000);
    const yearsOwned = 2 + Math.round(r(7) * 28);
    const preForeclosure = r(9) < 0.15;
    const taxDelinquent = r(11) < 0.12;
    const vacant = r(13) < 0.2;
    return {
      provider: this.name,
      status: "ok",
      costCents: 0,
      normalized: {
        characteristics: { propertyType: r(1) < 0.6 ? "Single Family" : "Rowhome", beds: 2 + Math.round(r(2) * 3), baths: 1 + Math.round(r(4) * 2), sqft, lotSqft: 1500 + Math.round(r(6) * 9000), yearBuilt: 1920 + Math.round(r(8) * 85), stories: 1 + Math.round(r(10)) },
        owner: { names: ["Owner of Record"], mailingAddress: r(12) < 0.5 ? `${q.addressLine1}, ${q.city}, ${q.state} ${q.postalCode}` : "PO Box 100, Towson, MD 21204", ownerOccupied: r(12) < 0.5, absentee: r(12) >= 0.5, ownerType: r(14) < 0.85 ? "individual" : "entity", yearsOwned },
        valuation: { avm: Math.round(arv * 0.9), avmLow: Math.round(arv * 0.82), avmHigh: Math.round(arv * 1.0), confidence: 0.65 + r(15) * 0.25, rentEstimate: Math.round(arv * 0.0075), asOf: new Date().toISOString().slice(0, 10) },
        mortgages: r(16) < 0.6 ? [{ lender: "Example Mortgage Co", amount: Math.round(arv * 0.55), originatedAt: `${2005 + Math.round(r(17) * 18)}-06-01`, rate: 3.5 + r(18) * 4, type: "conventional", estimatedBalance: Math.round(arv * 0.4), position: 1 }] : [],
        liens: r(19) < 0.2 ? [{ kind: "judgment", amount: 2000 + Math.round(r(20) * 20000), recordedAt: "2024-08-15", holder: "Example Creditor LLC" }] : [],
        transactions: [{ date: `${2026 - yearsOwned}-05-14`, price: Math.round(arv * 0.55), type: "sale", buyer: "Owner of Record" }],
        tax: { assessedValue: Math.round(arv * 0.8), assessedLand: Math.round(arv * 0.2), assessedImprovement: Math.round(arv * 0.6), taxAmount: Math.round(arv * 0.8 * 0.011), taxYear: 2025, delinquent: taxDelinquent },
        distress: { preForeclosure, foreclosureStage: preForeclosure ? "notice_of_default" : undefined, taxDelinquent, vacant, probate: r(21) < 0.08, flags: [preForeclosure && "pre_foreclosure", taxDelinquent && "tax_delinquent", vacant && "vacant"].filter(Boolean) as string[] },
        location: { lat: 39.29 + r(22) * 0.25, lng: -76.75 + r(23) * 0.35, county: q.state === "MD" ? "Baltimore" : undefined, floodZone: "X" },
        arv: { estimate: arv, low: Math.round(arv * 0.93), high: Math.round(arv * 1.06), perSqft: Math.round(arv / sqft), compCount: 3, method: "mock average of 3" },
      },
      raw: { provider: "mock", query: q, note: "Deterministic sample data. Set PROPERTY_DATA_PROVIDER=realestateapi and REALESTATEAPI_KEY for live data." },
    };
  }

  async comps(q: CompQuery) {
    const h = hash(`comps|${q.addressLine1}|${q.postalCode}`.toLowerCase());
    const base = 140000 + (h % 280) * 1000;
    const sqft = q.sqft ?? 1400;
    const comps: CompResult[] = [0, 1, 2, 3].map((i) => ({
      address: `${100 + ((h >>> (i * 3)) % 9800)} Sample St, ${q.city}, ${q.state} ${q.postalCode}`,
      soldPrice: Math.round(base * (0.9 + ((h >>> (i * 5)) % 20) / 100)),
      soldAt: new Date(Date.now() - (30 + ((h >>> (i * 2)) % 300)) * 86_400_000).toISOString().slice(0, 10),
      sqft: sqft + (((h >>> (i * 4)) % 600) - 300),
      beds: 2 + ((h >>> i) % 3),
      baths: 1 + ((h >>> (i + 1)) % 2),
      distanceMi: Number((((h >>> (i * 6)) % 120) / 100).toFixed(2)),
    }));
    return { comps, costCents: 0, raw: { provider: "mock" } };
  }
}
