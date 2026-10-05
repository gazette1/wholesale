import { describe, it, expect } from "vitest";
import { parseCsv, parseCsvRecords, toCsv, recordsToCsv, guardFormulaCell, escapeCsvCell } from "../src/webhooks/csv";
import { signPayload, verifySignature, safeEqual } from "../src/webhooks/signature";
import { EVENTS, SUBSCRIBABLE_EVENTS, isWebhookEvent, checkWebhookUrl, isPrivateHost } from "../src/webhooks/events";
import { parseLeadPayload, parseBuyerPayload, normalizeAddressKey, splitSingleLineAddress, canonicalKey, splitStates, hasKnownCsvHeader, publicFieldName } from "../src/webhooks/lead-payload";
import { phoneDigits, phoneMatchKey, phonesMatch, pickInboundContact } from "../src/webhooks/phone-match";

const BOM = String.fromCharCode(0xfeff);

describe("csv parse", () => {
  it("parses quoted fields, escaped quotes, commas and newlines inside quotes", () => {
    const text = 'name,notes\r\n"Doe, Jane","said ""call me""\nafter 5"\r\nBob,plain\r\n';
    expect(parseCsv(text)).toEqual([["name", "notes"], ["Doe, Jane", 'said "call me"\nafter 5'], ["Bob", "plain"]]);
  });

  it("strips a byte order mark and accepts LF, CRLF, and a bare CR", () => {
    expect(parseCsv(BOM + "a,b\nc,d")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseCsv("a,b\rc,d")).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("keeps empty cells, keeps quoted empty rows, skips blank lines", () => {
    expect(parseCsv("a,,c\n\n,,\n")).toEqual([["a", "", "c"], ["", "", ""]]);
    expect(parseCsv('""\n')).toEqual([[""]]);
    expect(parseCsv("")).toEqual([]);
  });

  it("keeps CRLF that sits inside a quoted cell", () => {
    expect(parseCsv('a\r\n"line1\r\nline2"\r\n')).toEqual([["a"], ["line1\r\nline2"]]);
  });

  it("maps records by header and pads short rows", () => {
    const { headers, records } = parseCsvRecords(BOM + " Address ,City\r\n 1 Main St ,Towson\r\n2 Oak Ave\r\n");
    expect(headers).toEqual(["Address", "City"]);
    expect(records).toEqual([{ Address: "1 Main St", City: "Towson" }, { Address: "2 Oak Ave", City: "" }]);
  });
});

describe("csv serialize", () => {
  it("round trips quotes, commas, newlines, and CRLF", () => {
    const rows = [["id", "text"], ["1", 'He said "hi", then left'], ["2", "two\nlines"], ["3", "crlf\r\ninside"], ["4", " padded "], ["5", ""]];
    const csv = toCsv(rows, { guardFormulas: false });
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(parseCsv(csv)).toEqual(rows);
  });

  it("round trips with a byte order mark", () => {
    const csv = toCsv([["a", "b"], ["1", "2"]], { bom: true });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(parseCsv(csv)).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("serializes null, numbers, dates, and objects", () => {
    const csv = toCsv([[null, undefined, 12.5, new Date("2026-01-02T03:04:05.000Z"), { a: 1 }]]);
    expect(csv).toBe(',,12.5,2026-01-02T03:04:05.000Z,"{""a"":1}"\r\n');
  });

  it("writes a header row from column names", () => {
    const csv = recordsToCsv(["a", "b"], [{ a: "x", b: "=1+1" }, { a: "y" }]);
    expect(parseCsv(csv)).toEqual([["a", "b"], ["x", "'=1+1"], ["y", ""]]);
  });

  it("quotes only when needed", () => {
    expect(escapeCsvCell("plain")).toBe("plain");
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('a"b')).toBe('"a""b"');
  });
});

describe("csv formula injection guard", () => {
  it("prefixes cells that start with =, +, -, or @", () => {
    expect(guardFormulaCell("=HYPERLINK(\"http://x\")")).toBe("'=HYPERLINK(\"http://x\")");
    expect(guardFormulaCell("+14105550000")).toBe("'+14105550000");
    expect(guardFormulaCell("-2+3")).toBe("'-2+3");
    expect(guardFormulaCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(guardFormulaCell("\tcmd")).toBe("'\tcmd");
  });

  it("leaves safe text, empty cells, and plain negative numbers alone", () => {
    expect(guardFormulaCell("123 Main St")).toBe("123 Main St");
    expect(guardFormulaCell("")).toBe("");
    expect(guardFormulaCell("-5000")).toBe("-5000");
    expect(guardFormulaCell("-12.5")).toBe("-12.5");
    expect(guardFormulaCell("a=b")).toBe("a=b");
  });

  it("is applied by toCsv unless turned off", () => {
    expect(toCsv([["=SUM(A1:A9)"]])).toBe("'=SUM(A1:A9)\r\n");
    expect(toCsv([["=1"]], { guardFormulas: false })).toBe("=1\r\n");
  });
});

describe("webhook signature", () => {
  const secret = "whsec_test_secret";
  const body = JSON.stringify({ id: "evt_1", event: "lead.created", data: { leadId: "abc" } });
  const now = Date.UTC(2026, 0, 15, 12, 0, 0);
  const ts = String(Math.floor(now / 1000));

  it("signs deterministically with HMAC-SHA256 hex", () => {
    const sig = signPayload(secret, ts, body);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(signPayload(secret, ts, body)).toBe(sig);
    expect(signPayload("other", ts, body)).not.toBe(sig);
  });

  it("verifies a valid signature with or without the sha256= prefix", () => {
    const sig = signPayload(secret, ts, body);
    expect(verifySignature({ secret, timestamp: ts, body, signature: `sha256=${sig}`, now })).toBe(true);
    expect(verifySignature({ secret, timestamp: ts, body, signature: sig, now })).toBe(true);
  });

  it("rejects a tampered body, a tampered timestamp, and a wrong secret", () => {
    const sig = `sha256=${signPayload(secret, ts, body)}`;
    expect(verifySignature({ secret, timestamp: ts, body: body.replace("abc", "abd"), signature: sig, now })).toBe(false);
    expect(verifySignature({ secret, timestamp: String(Number(ts) + 1), body, signature: sig, now })).toBe(false);
    expect(verifySignature({ secret: "nope", timestamp: ts, body, signature: sig, now })).toBe(false);
  });

  it("rejects a stale timestamp outside the 5 minute tolerance and accepts one inside it", () => {
    const sig = `sha256=${signPayload(secret, ts, body)}`;
    expect(verifySignature({ secret, timestamp: ts, body, signature: sig, now: now + 301_000 })).toBe(false);
    expect(verifySignature({ secret, timestamp: ts, body, signature: sig, now: now - 301_000 })).toBe(false);
    expect(verifySignature({ secret, timestamp: ts, body, signature: sig, now: now + 299_000 })).toBe(true);
  });

  it("rejects missing or malformed input", () => {
    expect(verifySignature({ secret, timestamp: ts, body, signature: null, now })).toBe(false);
    expect(verifySignature({ secret, timestamp: ts, body, signature: "sha256=zz", now })).toBe(false);
    expect(verifySignature({ secret, timestamp: "not-a-number", body, signature: signPayload(secret, "not-a-number", body), now })).toBe(false);
    expect(verifySignature({ secret, timestamp: "", body, signature: signPayload(secret, "", body), now })).toBe(false);
  });

  it("compares strings in constant time and handles unequal lengths", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("events and url policy", () => {
  it("lists the events and excludes ping from subscriptions", () => {
    expect(EVENTS).toContain("lead.created");
    expect(EVENTS).toContain("ping");
    expect(SUBSCRIBABLE_EVENTS).not.toContain("ping");
    expect(isWebhookEvent("offer.created")).toBe(true);
    expect(isWebhookEvent("offer.deleted")).toBe(false);
  });

  it("allows https, and http only for loopback outside production", () => {
    expect(checkWebhookUrl("https://hooks.zapier.com/hooks/catch/1/abc", { production: true }).ok).toBe(true);
    expect(checkWebhookUrl("http://localhost:4000/hook", { production: false }).ok).toBe(true);
    expect(checkWebhookUrl("http://127.0.0.1:4000/hook", { production: false }).ok).toBe(true);
    expect(checkWebhookUrl("http://localhost:4000/hook", { production: true }).ok).toBe(false);
    expect(checkWebhookUrl("http://example.com/hook", { production: false }).ok).toBe(false);
    expect(checkWebhookUrl("ftp://example.com", { production: false }).ok).toBe(false);
    expect(checkWebhookUrl("not a url", { production: false }).ok).toBe(false);
    expect(checkWebhookUrl("https://user:pass@example.com/hook", { production: true }).ok).toBe(false);
  });

  it("rejects private hosts in production", () => {
    for (const host of ["localhost", "127.0.0.1", "127.8.8.8", "10.1.2.3", "192.168.1.10", "169.254.169.254", "172.16.0.1", "172.31.255.1", "db.internal", "[::1]"]) {
      expect(checkWebhookUrl(`https://${host}/hook`, { production: true }).ok).toBe(false);
    }
    expect(isPrivateHost("172.15.0.1")).toBe(false);
    expect(isPrivateHost("172.32.0.1")).toBe(false);
    expect(isPrivateHost("hooks.zapier.com")).toBe(false);
  });
});

describe("lead payload", () => {
  it("accepts camelCase, snake_case, and spaced header names", () => {
    const a = parseLeadPayload({ addressLine1: "12 Oak St", city: "Towson", state: "md", postalCode: "21204", firstName: "Jane", askingPrice: 150000 });
    const b = parseLeadPayload({ address: "12 Oak St", City: "Towson", STATE: "Maryland", zip_code: "21204", first_name: "Jane", "Asking Price": "$150,000" });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(b.data).toEqual(a.data);
      expect(a.data.state).toBe("MD");
      expect(a.data.askingPrice).toBe(150000);
      expect(a.data.urgency).toBe("none");
    }
  });

  it("splits name on the first space and flattens nested objects", () => {
    const r = parseLeadPayload({ property: { address: "1 Elm Rd", city: "Essex", state: "MD", zip: 21221 }, contact: { name: "Mary Ann Smith", phone: "410-555-0100" } });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.data.firstName).toBe("Mary"); expect(r.data.lastName).toBe("Ann Smith"); expect(r.data.postalCode).toBe("21221"); expect(r.data.phone).toBe("410-555-0100"); }
  });

  it("splits a single line address and restores a ZIP that lost its leading zero", () => {
    const r = parseLeadPayload({ address: "123 Main St, Baltimore, MD 21201" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toMatchObject({ addressLine1: "123 Main St", city: "Baltimore", state: "MD", postalCode: "21201" });
    const z = parseLeadPayload({ address: "5 Pine St", city: "Camden", state: "NJ", zip: 8102 });
    expect(z.ok && z.data.postalCode).toBe("08102");
    expect(splitSingleLineAddress("no commas here")).toBeNull();
  });

  it("reports missing and invalid fields", () => {
    const r = parseLeadPayload({ city: "Towson" });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error).toContain("address is required"); expect(r.error).toContain("zip is required"); expect(r.error).not.toMatch(/addressLine1|postalCode/); }
    const e = parseLeadPayload({ address: "1 A St", city: "X", state: "MD", zip: "21201", email: "nope" });
    expect(e.ok).toBe(false);
    const n = parseLeadPayload({ address: "1 A St", city: "X", state: "MD", zip: "21201", beds: "three" });
    expect(n.ok).toBe(false);
    expect(parseLeadPayload("text").ok).toBe(false);
    expect(parseLeadPayload([1]).ok).toBe(false);
  });

  it("uses public field names and plain sentences in errors", () => {
    const base = { address: "1 A St", city: "X", state: "MD", zip: "21201" };
    const long = parseLeadPayload({ ...base, notes: "x".repeat(5001) });
    expect(long.ok).toBe(false);
    if (!long.ok) { expect(long.error).toBe("notes must be 5,000 characters or fewer"); expect(long.error).not.toMatch(/String must contain/); }
    expect(parseLeadPayload({ ...base, notes: "x".repeat(5000) }).ok).toBe(true);
    const negative = parseLeadPayload({ ...base, asking_price: -1 });
    if (!negative.ok) expect(negative.error).toBe("askingPrice must be zero or more");
    expect(negative.ok).toBe(false);
    const state = parseLeadPayload({ ...base, state: "Atlantis" });
    if (!state.ok) expect(state.error).toBe("state must be a two letter code");
    expect(state.ok).toBe(false);
    const zip = parseLeadPayload({ ...base, zip: "abc" });
    if (!zip.ok) expect(zip.error).toBe("zip must be a 5 digit ZIP or ZIP+4");
    const beds = parseLeadPayload({ ...base, beds: "three" });
    if (!beds.ok) expect(beds.error).toBe("beds must be a number");
    const year = parseLeadPayload({ ...base, year_built: 1200 });
    if (!year.ok) expect(year.error).toBe("yearBuilt must be 1600 or more");
    expect(publicFieldName("addressLine1")).toBe("address");
    expect(publicFieldName("postalCode")).toBe("zip");
    expect(publicFieldName("firstName")).toBe("firstName");
  });

  it("tells a CSV header row from some other file", () => {
    expect(hasKnownCsvHeader(["Address", "City", "State", "Zip"])).toBe(true);
    expect(hasKnownCsvHeader(["Company", "buyer_id"])).toBe(true);
    expect(hasKnownCsvHeader(["\u0089PNG", "IHDR"])).toBe(false);
    expect(hasKnownCsvHeader(["", " "])).toBe(false);
    expect(hasKnownCsvHeader([])).toBe(false);
  });

  it("never carries a consent field", () => {
    const r = parseLeadPayload({ address: "1 A St", city: "X", state: "MD", zip: "21201", smsConsent: "opted_in", sms_consent: "opted_in" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.data)).not.toContain("smsConsent");
  });

  it("builds a stable address key", () => {
    expect(normalizeAddressKey("123 North Main Street", "Apt. 4")).toBe(normalizeAddressKey("123 N. MAIN ST", "apt 4"));
    expect(normalizeAddressKey("123 Main St #4")).toBe(normalizeAddressKey("123 Main St", "Unit 4"));
    expect(normalizeAddressKey("123 Main St")).not.toBe(normalizeAddressKey("125 Main St"));
    expect(canonicalKey("First_Name")).toBe("firstname");
  });
});

describe("buyer payload", () => {
  it("parses a buyer row with aliases and a state list", () => {
    const r = parseBuyerPayload({ "Full Name": "Sam Carter", Company: "Carter Homes LLC", Email: "SAM@EXAMPLE.COM", states: "md; Virginia, PA" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toMatchObject({ firstName: "Sam", lastName: "Carter", company: "Carter Homes LLC", email: "sam@example.com", states: ["MD", "VA", "PA"] });
  });

  it("accepts states separated by commas, semicolons, pipes, or spaces", () => {
    expect(splitStates("MD, PA")).toEqual(["MD", "PA"]);
    expect(splitStates("MD PA")).toEqual(["MD", "PA"]);
    expect(splitStates("md  pa va")).toEqual(["MD", "PA", "VA"]);
    expect(splitStates("New York, north carolina | MD;PA")).toEqual(["NY", "NC", "MD", "PA"]);
    expect(splitStates("MD, MD, md")).toEqual(["MD"]);
    expect(splitStates("")).toEqual([]);
    const exported = parseBuyerPayload({ first_name: "Sam", states: "MD, PA" });
    expect(exported.ok && exported.data.states).toEqual(["MD", "PA"]);
    const legacy = parseBuyerPayload({ first_name: "Sam", states: "MD PA" });
    expect(legacy.ok && legacy.data.states).toEqual(["MD", "PA"]);
    const bad = parseBuyerPayload({ first_name: "Sam", states: "Atlantis" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toBe("states must be two letter codes");
  });

  it("falls back to the company name and rejects an empty row", () => {
    const c = parseBuyerPayload({ company: "Harbor Capital" });
    expect(c.ok && c.data.firstName).toBe("Harbor Capital");
    expect(parseBuyerPayload({ phone: "410-555-0100" }).ok).toBe(false);
  });
});

describe("inbound sender matching", () => {
  it("reduces a number to digits and needs ten of them", () => {
    expect(phoneDigits("+1 (410) 555-0100")).toBe("14105550100");
    expect(phoneDigits("abc")).toBe("");
    expect(phoneDigits(null)).toBe("");
    expect(phoneMatchKey("+1 (410) 555-0100")).toBe("4105550100");
    expect(phoneMatchKey("410-555-0100")).toBe("4105550100");
    expect(phoneMatchKey("abc")).toBeNull();
    expect(phoneMatchKey("")).toBeNull();
    expect(phoneMatchKey("55501")).toBeNull();
    expect(phoneMatchKey("555-0100")).toBeNull();
    expect(phoneMatchKey("410555010")).toBeNull();
  });

  it("matches on the last ten digits exactly, never on a shorter suffix", () => {
    expect(phonesMatch("(410) 555-0100", "+14105550100")).toBe(true);
    expect(phonesMatch("+1 410 555 0100", "4105550100")).toBe(true);
    expect(phonesMatch("410-555-0100", "abc")).toBe(false);
    expect(phonesMatch("410-555-0100", "")).toBe(false);
    expect(phonesMatch("410-555-0100", "0100")).toBe(false);
    expect(phonesMatch("410-555-0100", "555-0100")).toBe(false);
    expect(phonesMatch("555-0100", "555-0100")).toBe(false);
    expect(phonesMatch("410-555-0100", "443-555-0100")).toBe(false);
    expect(phonesMatch("", "")).toBe(false);
  });

  it("picks one contact when a number is shared", () => {
    const a = { id: "a", orgId: "org-1", lastOutboundAt: "2026-01-01T00:00:00Z", createdAt: "2025-01-01T00:00:00Z" };
    const b = { id: "b", orgId: "org-2", lastOutboundAt: "2026-02-01T00:00:00Z", createdAt: "2025-01-01T00:00:00Z" };
    const c = { id: "c", orgId: "org-2", lastOutboundAt: null, createdAt: "2026-03-01T00:00:00Z" };
    expect(pickInboundContact([])).toBeNull();
    expect(pickInboundContact([a])).toBe(a);
    // The org that owns the receiving number wins even when another org texted the sender more recently.
    expect(pickInboundContact([a, b, c], ["org-1"])).toBe(a);
    // Unknown receiving number: the contact that was sent a message most recently.
    expect(pickInboundContact([a, b, c])).toBe(b);
    expect(pickInboundContact([a, b, c], ["org-9"])).toBe(b);
    // Inside the owning org the most recently contacted contact wins, then the newest.
    expect(pickInboundContact([a, b, c], ["org-2"])).toBe(b);
    expect(pickInboundContact([{ ...b, lastOutboundAt: null }, c], ["org-2"])).toBe(c);
  });
});
