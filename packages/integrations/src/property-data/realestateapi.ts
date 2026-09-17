import { z } from "zod";
import type { PropertyDataProvider, AddressQuery, PropertyLookupResult, CompQuery, CompResult } from "./types";
import { EMPTY_REPORT } from "./types";

/**
 * RealEstateAPI.com adapter.
 *
 * Endpoints used (v2): PropertyDetail, PropertyComps. Field names below follow
 * the public docs as of the last check and are read defensively: every field
 * is optional and the raw response is stored untouched, so a renamed field
 * degrades to a blank on the report rather than a crash. Verify the mapping
 * against the account's live responses when the key arrives, then tighten the
 * schema. See docs/INTEGRATIONS.md.
 */
const num = z.union([z.number(), z.string().transform((s) => Number(s))]).optional().nullable().transform((v) => (v == null || Number.isNaN(Number(v)) ? undefined : Number(v)));
const str = z.string().optional().nullable().transform((v) => v ?? undefined);
const bool = z.union([z.boolean(), z.string(), z.number()]).optional().nullable().transform((v) => (v == null ? undefined : v === true || v === "true" || v === 1 || v === "1"));

const DetailSchema = z.object({
  data: z.object({
    propertyInfo: z.object({
      address: z.object({ address: str, city: str, state: str, zip: str, county: str, latitude: num, longitude: num }).passthrough().optional(),
      bedrooms: num, bathrooms: num, buildingSquareFeet: num, livingSquareFeet: num, lotSquareFeet: num, yearBuilt: num, stories: num, propertyUse: str, propertyType: str, pool: bool, garageType: str, unitsCount: num,
    }).passthrough().optional(),
    ownerInfo: z.object({
      owner1FirstName: str, owner1LastName: str, owner1FullName: str, owner2FullName: str, mailAddress: z.object({ address: str, city: str, state: str, zip: str, label: str }).passthrough().optional(),
      ownerOccupied: bool, absenteeOwner: bool, corporateOwned: bool, ownershipLength: num,
    }).passthrough().optional(),
    estimatedValue: num, estimatedValueLow: num, estimatedValueHigh: num, estimatedEquity: num, estimatedMortgageBalance: num, rentAmount: num, suggestedRent: num,
    mortgageHistory: z.array(z.object({ lenderName: str, amount: num, recordingDate: str, interestRate: num, loanType: str, position: num, estimatedBalance: num }).passthrough()).optional(),
    currentMortgages: z.array(z.object({ lenderName: str, amount: num, recordingDate: str, interestRate: num, loanType: str, position: num, estimatedBalance: num }).passthrough()).optional(),
    saleHistory: z.array(z.object({ saleDate: str, saleAmount: num, buyerNames: str, sellerNames: str, documentType: str, documentNumber: str }).passthrough()).optional(),
    taxInfo: z.object({ assessedValue: num, assessedLandValue: num, assessedImprovementValue: num, taxAmount: num, year: num, taxDelinquentYear: num }).passthrough().optional(),
    lienInfo: z.array(z.object({ lienType: str, amount: num, recordingDate: str, creditor: str }).passthrough()).optional(),
    preForeclosure: bool, foreclosure: bool, foreclosureInfo: z.object({ status: str }).passthrough().optional(), taxLien: bool, vacant: bool, death: bool, inherited: bool, bankruptcy: bool, divorce: bool, judgment: bool, floodZone: bool, floodZoneDescription: str,
  }).passthrough(),
}).passthrough();

const CompsSchema = z.object({
  data: z.union([
    z.array(z.object({ address: z.union([z.string(), z.object({ address: str, city: str, state: str, zip: str }).passthrough()]).optional(), lastSaleAmount: num, lastSaleDate: str, squareFeet: num, bedrooms: num, bathrooms: num, yearBuilt: num, distance: num }).passthrough()),
    z.object({ comps: z.array(z.record(z.unknown())).optional() }).passthrough(),
  ]).optional(),
}).passthrough();

export class RealEstateApiProvider implements PropertyDataProvider {
  readonly name = "realestateapi";
  constructor(private readonly apiKey: string, private readonly baseUrl = "https://api.realestateapi.com/v2", private readonly fetchImpl: typeof fetch = fetch) {}

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-api-key": this.apiKey, "x-user-id": "dealcalc" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`RealEstateAPI ${path} responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }

  async lookup(q: AddressQuery): Promise<PropertyLookupResult> {
    let raw: unknown;
    try {
      raw = await this.post("PropertyDetail", { address: `${q.addressLine1}, ${q.city}, ${q.state} ${q.postalCode}`, comps: false, exact_match: true });
    } catch (err) {
      return { provider: this.name, status: "failed", normalized: EMPTY_REPORT, raw: {}, costCents: 0, error: err instanceof Error ? err.message : String(err) };
    }
    const parsed = DetailSchema.safeParse(raw);
    if (!parsed.success) {
      return { provider: this.name, status: "partial", normalized: EMPTY_REPORT, raw: raw as Record<string, unknown>, costCents: 0, error: `Unrecognized response shape: ${parsed.error.issues[0]?.path.join(".")}` };
    }
    const d = parsed.data.data;
    const pi = d.propertyInfo;
    const oi = d.ownerInfo;
    const mortgages = (d.currentMortgages?.length ? d.currentMortgages : d.mortgageHistory) ?? [];
    const flags: string[] = [];
    if (d.preForeclosure) flags.push("pre_foreclosure");
    if (d.foreclosure) flags.push("foreclosure");
    if (d.taxLien) flags.push("tax_lien");
    if (d.vacant) flags.push("vacant");
    if (d.death || d.inherited) flags.push("probate");
    if (d.bankruptcy) flags.push("bankruptcy");
    if (d.divorce) flags.push("divorce");
    if (d.judgment) flags.push("judgment");
    const owners = [oi?.owner1FullName ?? [oi?.owner1FirstName, oi?.owner1LastName].filter(Boolean).join(" "), oi?.owner2FullName].filter((n): n is string => Boolean(n && n.trim()));
    return {
      provider: this.name,
      status: "ok",
      costCents: 0,
      normalized: {
        characteristics: { propertyType: pi?.propertyType ?? pi?.propertyUse, beds: pi?.bedrooms, baths: pi?.bathrooms, sqft: pi?.livingSquareFeet ?? pi?.buildingSquareFeet, lotSqft: pi?.lotSquareFeet, yearBuilt: pi?.yearBuilt, stories: pi?.stories, garage: pi?.garageType, pool: pi?.pool, units: pi?.unitsCount },
        owner: { names: owners, mailingAddress: oi?.mailAddress?.label ?? ([oi?.mailAddress?.address, oi?.mailAddress?.city, oi?.mailAddress?.state, oi?.mailAddress?.zip].filter(Boolean).join(", ") || undefined), ownerOccupied: oi?.ownerOccupied, absentee: oi?.absenteeOwner, ownerType: oi?.corporateOwned ? "entity" : owners.length ? "individual" : "unknown", yearsOwned: oi?.ownershipLength },
        valuation: { avm: d.estimatedValue, avmLow: d.estimatedValueLow, avmHigh: d.estimatedValueHigh, rentEstimate: d.rentAmount ?? d.suggestedRent, asOf: new Date().toISOString().slice(0, 10) },
        mortgages: mortgages.map((m) => ({ lender: m.lenderName, amount: m.amount, originatedAt: m.recordingDate, rate: m.interestRate, type: m.loanType, estimatedBalance: m.estimatedBalance, position: m.position })),
        liens: (d.lienInfo ?? []).map((l) => ({ kind: l.lienType ?? "lien", amount: l.amount, recordedAt: l.recordingDate, holder: l.creditor })),
        transactions: (d.saleHistory ?? []).map((s) => ({ date: s.saleDate ?? "", price: s.saleAmount, buyer: s.buyerNames, seller: s.sellerNames, type: s.documentType, documentNumber: s.documentNumber })),
        tax: { assessedValue: d.taxInfo?.assessedValue, assessedLand: d.taxInfo?.assessedLandValue, assessedImprovement: d.taxInfo?.assessedImprovementValue, taxAmount: d.taxInfo?.taxAmount, taxYear: d.taxInfo?.year, delinquent: d.taxInfo?.taxDelinquentYear != null || d.taxLien },
        distress: { preForeclosure: d.preForeclosure, foreclosureStage: d.foreclosureInfo?.status, taxDelinquent: d.taxLien, vacant: d.vacant, probate: d.death || d.inherited, bankruptcy: d.bankruptcy, divorce: d.divorce, flags },
        location: { lat: pi?.address?.latitude, lng: pi?.address?.longitude, county: pi?.address?.county, floodZone: d.floodZoneDescription ?? (d.floodZone ? "yes" : undefined) },
        arv: {},
      },
      raw: raw as Record<string, unknown>,
    };
  }

  async comps(q: CompQuery) {
    const raw = await this.post("PropertyComps", { address: `${q.addressLine1}, ${q.city}, ${q.state} ${q.postalCode}`, max_radius_miles: q.radiusMiles ?? 1, max_days_back: (q.monthsBack ?? 12) * 30, max_results: 10 });
    const parsed = CompsSchema.safeParse(raw);
    const list: unknown[] = parsed.success ? (Array.isArray(parsed.data.data) ? parsed.data.data : (parsed.data.data?.comps ?? [])) : [];
    const comps: CompResult[] = list.map((c: any) => ({
      address: typeof c.address === "string" ? c.address : [c.address?.address, c.address?.city, c.address?.state, c.address?.zip].filter(Boolean).join(", "),
      soldPrice: c.lastSaleAmount, soldAt: c.lastSaleDate, sqft: c.squareFeet, beds: c.bedrooms, baths: c.bathrooms, yearBuilt: c.yearBuilt, distanceMi: c.distance, raw: c,
    }));
    return { comps, costCents: 0, raw: raw as Record<string, unknown> };
  }
}
