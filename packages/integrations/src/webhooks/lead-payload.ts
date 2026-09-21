import { z } from "zod";

/**
 * Forgiving parsers for inbound lead and buyer records. The same rules serve the REST API and the CSV importers:
 * keys are matched without regard to case, spaces, underscores, or dashes, and common aliases are accepted.
 */

/** "First_Name", "firstName", and "First Name" all become "firstname". */
export function canonicalKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

type LeadField =
  | "addressLine1" | "addressLine2" | "city" | "state" | "postalCode" | "firstName" | "lastName" | "name" | "phone" | "email"
  | "askingPrice" | "source" | "notes" | "urgency" | "beds" | "baths" | "sqft" | "yearBuilt" | "propertyType" | "externalId";

const LEAD_ALIASES: Record<LeadField, string[]> = {
  addressLine1: ["addressline1", "address", "address1", "street", "streetaddress", "propertyaddress", "propertystreet", "siteaddress"],
  addressLine2: ["addressline2", "address2", "unit", "apt", "apartment", "suite"],
  city: ["city", "propertycity", "sitecity", "town"],
  state: ["state", "propertystate", "sitestate", "st", "province"],
  postalCode: ["postalcode", "zip", "zipcode", "postal", "propertyzip", "propertyzipcode", "sitezip"],
  firstName: ["firstname", "first", "ownerfirstname", "sellerfirstname", "owner1firstname"],
  lastName: ["lastname", "last", "ownerlastname", "sellerlastname", "owner1lastname", "surname"],
  name: ["name", "fullname", "ownername", "sellername", "contactname", "owner"],
  phone: ["phone", "phonenumber", "mobile", "cell", "cellphone", "mobilephone", "phone1", "primaryphone", "telephone"],
  email: ["email", "emailaddress", "email1", "primaryemail"],
  askingPrice: ["askingprice", "asking", "price", "listprice", "askprice"],
  source: ["source", "leadsource", "channel"],
  notes: ["notes", "note", "comments", "comment", "message", "description"],
  urgency: ["urgency", "sellerurgency", "timeline"],
  beds: ["beds", "bedrooms", "bed", "br"],
  baths: ["baths", "bathrooms", "bath", "ba"],
  sqft: ["sqft", "squarefeet", "squarefootage", "livingarea", "buildingsqft", "livingsqft"],
  yearBuilt: ["yearbuilt", "year", "built"],
  propertyType: ["propertytype", "type", "propertyuse"],
  externalId: ["externalid", "id", "recordid", "leadid", "referenceid", "ref"],
};

function aliasIndex<F extends string>(aliases: Record<F, string[]>): Map<string, F> {
  const map = new Map<string, F>();
  for (const field of Object.keys(aliases) as F[]) for (const alias of aliases[field]) map.set(alias, field);
  return map;
}

const LEAD_INDEX = aliasIndex(LEAD_ALIASES);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function scalarToString(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") { const t = v.trim(); return t === "" ? undefined : t; }
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : undefined;
  if (typeof v === "boolean") return String(v);
  return undefined;
}

/** Map raw keys to canonical fields. Nested objects such as { property: {...}, contact: {...} } are flattened one level. The first non blank value wins. */
function mapKeys<F extends string>(raw: Record<string, unknown>, index: Map<string, F>): Partial<Record<F, string>> {
  const out: Partial<Record<F, string>> = {};
  const visit = (obj: Record<string, unknown>, depth: number) => {
    for (const [k, v] of Object.entries(obj)) {
      if (isPlainObject(v)) { if (depth === 0) visit(v, 1); continue; }
      const field = index.get(canonicalKey(k));
      if (!field || out[field] !== undefined) continue;
      const s = scalarToString(v);
      if (s !== undefined) out[field] = s;
    }
  };
  visit(raw, 0);
  return out;
}

const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", districtofcolumbia: "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME",
  maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  newhampshire: "NH", newjersey: "NJ", newmexico: "NM", newyork: "NY", northcarolina: "NC", northdakota: "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", rhodeisland: "RI", southcarolina: "SC", southdakota: "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA",
  washington: "WA", westvirginia: "WV", wisconsin: "WI", wyoming: "WY", puertorico: "PR",
};

function normalizeState(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const t = v.trim();
  if (t.length === 2) return t.toUpperCase();
  return STATE_NAMES[canonicalKey(t)] ?? t.toUpperCase();
}

/** Spreadsheets drop leading zeros from ZIP codes (08001 becomes 8001). Pad short numeric values back to five digits. */
function normalizePostalCode(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const t = v.trim();
  if (/^\d{3,4}$/.test(t)) return t.padStart(5, "0");
  if (/^\d{9}$/.test(t)) return `${t.slice(0, 5)}-${t.slice(5)}`;
  return t;
}

function toNumberOrNull(v: string | undefined): number | null {
  if (v === undefined) return null;
  const cleaned = v.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

const URGENCY = ["none", "low", "medium", "high", "immediate"] as const;
const URGENCY_ALIASES: Record<string, (typeof URGENCY)[number]> = { urgent: "immediate", asap: "immediate", now: "immediate", hot: "high", warm: "medium", cold: "low", med: "medium" };

function normalizeUrgency(v: string | undefined): (typeof URGENCY)[number] {
  if (!v) return "none";
  const t = v.trim().toLowerCase();
  if ((URGENCY as readonly string[]).includes(t)) return t as (typeof URGENCY)[number];
  return URGENCY_ALIASES[t] ?? "none";
}

/** "123 Main St, Baltimore, MD 21201" split into parts. Returns null when the text does not have that shape. */
export function splitSingleLineAddress(text: string): { addressLine1: string; city: string; state: string; postalCode: string } | null {
  const m = /^(.+?),\s*([^,]+?),\s*([A-Za-z]{2}|[A-Za-z][A-Za-z ]{2,})\.?,?\s+(\d{5}(?:-\d{4})?)(?:,\s*(?:USA?|United States))?$/i.exec(text.trim());
  if (!m) return null;
  const state = normalizeState(m[3]);
  if (!state || state.length !== 2) return null;
  return { addressLine1: m[1]!.trim(), city: m[2]!.trim(), state, postalCode: m[4]! };
}

const optionalText = (max: number) => z.string().max(max).optional();
const optionalNumber = (min: number, max: number) => z.number({ invalid_type_error: "must be a number" }).min(min).max(max).nullable();

export const LeadPayloadSchema = z.object({
  addressLine1: z.string({ required_error: "is required" }).min(3, "is required").max(200),
  addressLine2: optionalText(100),
  city: z.string({ required_error: "is required" }).min(1, "is required").max(100),
  state: z.string({ required_error: "is required" }).regex(/^[A-Z]{2}$/, "must be a two letter state code"),
  postalCode: z.string({ required_error: "is required" }).regex(/^\d{5}(-\d{4})?$/, "must be a 5 digit ZIP or ZIP+4"),
  firstName: optionalText(100),
  lastName: optionalText(100),
  phone: optionalText(40),
  email: z.string().email("is not a valid email address").max(200).optional(),
  askingPrice: optionalNumber(0, 1e11),
  source: optionalText(100),
  notes: optionalText(5000),
  urgency: z.enum(URGENCY),
  beds: optionalNumber(0, 99),
  baths: optionalNumber(0, 99),
  sqft: optionalNumber(0, 10_000_000),
  yearBuilt: optionalNumber(1600, 2200),
  propertyType: optionalText(100),
  externalId: optionalText(200),
});

export type LeadPayload = z.infer<typeof LeadPayloadSchema>;

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

function issuesToText(err: z.ZodError): string {
  return err.issues.slice(0, 5).map((i) => `${String(i.path[0] ?? "record")} ${i.message}`).join("; ");
}

/** Validate and normalize one inbound lead record from JSON or a CSV row. */
export function parseLeadPayload(raw: unknown): ParseResult<LeadPayload> {
  if (!isPlainObject(raw)) return { ok: false, error: "Each lead must be a JSON object." };
  const m = mapKeys(raw, LEAD_INDEX);

  let { addressLine1, city, state, postalCode } = m;
  if (addressLine1 && (!city || !state || !postalCode)) {
    const split = splitSingleLineAddress(addressLine1);
    if (split) { addressLine1 = split.addressLine1; city = city ?? split.city; state = state ?? split.state; postalCode = postalCode ?? split.postalCode; }
  }

  let { firstName, lastName } = m;
  if (!firstName && m.name) {
    const name = m.name.replace(/\s+/g, " ").trim();
    const i = name.indexOf(" ");
    firstName = i === -1 ? name : name.slice(0, i);
    if (!lastName && i !== -1) lastName = name.slice(i + 1);
  }

  const parsed = LeadPayloadSchema.safeParse({
    addressLine1, addressLine2: m.addressLine2, city, state: normalizeState(state), postalCode: normalizePostalCode(postalCode),
    firstName, lastName, phone: m.phone, email: m.email?.toLowerCase(),
    askingPrice: toNumberOrNull(m.askingPrice), source: m.source, notes: m.notes, urgency: normalizeUrgency(m.urgency),
    beds: toNumberOrNull(m.beds), baths: toNumberOrNull(m.baths), sqft: roundOrPass(toNumberOrNull(m.sqft)), yearBuilt: roundOrPass(toNumberOrNull(m.yearBuilt)),
    propertyType: m.propertyType, externalId: m.externalId,
  });
  if (!parsed.success) return { ok: false, error: issuesToText(parsed.error) };
  return { ok: true, data: parsed.data };
}

function roundOrPass(n: number | null): number | null {
  return n === null || Number.isNaN(n) ? n : Math.round(n);
}

/**
 * Address key used to find an existing property. Lowercase, punctuation removed, common street suffixes and
 * directionals abbreviated, unit appended. Compare together with the five digit ZIP.
 */
const SUFFIXES: Record<string, string> = {
  street: "st", avenue: "ave", av: "ave", boulevard: "blvd", road: "rd", drive: "dr", lane: "ln", court: "ct", place: "pl", circle: "cir", terrace: "ter",
  highway: "hwy", parkway: "pkwy", square: "sq", trail: "trl", way: "way", north: "n", south: "s", east: "e", west: "w",
  northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw", apartment: "apt", suite: "ste", unit: "unit", number: "unit",
};

export function normalizeAddressKey(addressLine1: string, addressLine2?: string | null): string {
  const norm = (s: string) => s.toLowerCase().replace(/#/g, " unit ").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).map((w) => SUFFIXES[w] ?? w).join(" ");
  const one = norm(addressLine1);
  const two = addressLine2 ? norm(addressLine2) : "";
  return two ? `${one} ${two}` : one;
}

/* Buyers */

type BuyerField = "firstName" | "lastName" | "name" | "company" | "phone" | "email" | "website" | "source" | "notes" | "states";

const BUYER_ALIASES: Record<BuyerField, string[]> = {
  firstName: ["firstname", "first", "buyerfirstname"],
  lastName: ["lastname", "last", "surname", "buyerlastname"],
  name: ["name", "fullname", "buyername", "contactname", "contact"],
  company: ["company", "companyname", "business", "llc", "entity", "organization"],
  phone: ["phone", "phonenumber", "mobile", "cell", "cellphone", "mobilephone", "phone1", "telephone"],
  email: ["email", "emailaddress", "email1"],
  website: ["website", "url", "site", "web"],
  source: ["source", "buyersource", "leadsource"],
  notes: ["notes", "note", "comments", "comment", "description"],
  states: ["states", "state", "markets", "buysin"],
};

const BUYER_INDEX = aliasIndex(BUYER_ALIASES);

export const BuyerPayloadSchema = z.object({
  firstName: z.string({ required_error: "a name or company is required" }).min(1, "a name or company is required").max(100),
  lastName: optionalText(100),
  company: optionalText(200),
  phone: optionalText(40),
  email: z.string().email("is not a valid email address").max(200).optional(),
  website: optionalText(300),
  source: optionalText(100),
  notes: optionalText(5000),
  states: z.array(z.string().regex(/^[A-Z]{2}$/, "must be two letter state codes")).max(60),
});

export type BuyerPayload = z.infer<typeof BuyerPayloadSchema>;

/** Validate and normalize one buyer record from a CSV row. "states" accepts a list separated by commas, semicolons, or pipes. */
export function parseBuyerPayload(raw: unknown): ParseResult<BuyerPayload> {
  if (!isPlainObject(raw)) return { ok: false, error: "Each buyer must be an object." };
  const m = mapKeys(raw, BUYER_INDEX);
  let { firstName, lastName } = m;
  if (!firstName && m.name) {
    const name = m.name.replace(/\s+/g, " ").trim();
    const i = name.indexOf(" ");
    firstName = i === -1 ? name : name.slice(0, i);
    if (!lastName && i !== -1) lastName = name.slice(i + 1);
  }
  if (!firstName && m.company) firstName = m.company;
  const states = (m.states ?? "").split(/[,;|]/).map((s) => normalizeState(s.trim()) ?? "").filter(Boolean);
  const parsed = BuyerPayloadSchema.safeParse({ firstName, lastName, company: m.company, phone: m.phone, email: m.email?.toLowerCase(), website: m.website, source: m.source, notes: m.notes, states });
  if (!parsed.success) return { ok: false, error: issuesToText(parsed.error) };
  return { ok: true, data: parsed.data };
}

/** Column headers for the downloadable CSV templates. */
export const LEAD_CSV_TEMPLATE_COLUMNS = ["address", "city", "state", "zip", "first_name", "last_name", "phone", "email", "asking_price", "source", "urgency", "beds", "baths", "sqft", "year_built", "property_type", "notes", "external_id"];
export const BUYER_CSV_TEMPLATE_COLUMNS = ["first_name", "last_name", "company", "phone", "email", "website", "states", "source", "notes"];
