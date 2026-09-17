import type { NormalizedPropertyReport } from "@dealcalc/db";

export type AddressQuery = {
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  apn?: string | null;
};

export type PropertyLookupResult = {
  provider: string;
  status: "ok" | "partial" | "failed";
  normalized: NormalizedPropertyReport;
  raw: Record<string, unknown>;
  costCents: number;
  error?: string;
};

export type CompQuery = AddressQuery & { sqft?: number | null; beds?: number | null; radiusMiles?: number; monthsBack?: number };

export type CompResult = {
  address: string;
  soldPrice?: number;
  soldAt?: string;
  sqft?: number;
  beds?: number;
  baths?: number;
  yearBuilt?: number;
  distanceMi?: number;
  raw?: Record<string, unknown>;
};

/** Swappable property data boundary. One real adapter, one mock. */
export interface PropertyDataProvider {
  readonly name: string;
  lookup(query: AddressQuery): Promise<PropertyLookupResult>;
  comps(query: CompQuery): Promise<{ comps: CompResult[]; costCents: number; raw: Record<string, unknown> }>;
}

export const EMPTY_REPORT: NormalizedPropertyReport = {
  characteristics: {},
  owner: { names: [] },
  valuation: {},
  mortgages: [],
  liens: [],
  transactions: [],
  tax: {},
  distress: { flags: [] },
  location: {},
  arv: {},
};
