import { describe, it, expect } from "vitest";
import { parseCsv, parseCsvRecords, toCsv, recordsToCsv, guardFormulaCell, escapeCsvCell } from "../src/webhooks/csv";
import { signPayload, verifySignature, safeEqual } from "../src/webhooks/signature";
import { EVENTS, SUBSCRIBABLE_EVENTS, isWebhookEvent, checkWebhookUrl, isPrivateHost } from "../src/webhooks/events";
import { parseLeadPayload, parseBuyerPayload, normalizeAddressKey, splitSingleLineAddress, canonicalKey } from "../src/webhooks/lead-payload";

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
    if (!r.ok) expect(r.error).toContain("addressLine1 is required");
    const e = parseLeadPayload({ address: "1 A St", city: "X", state: "MD", zip: "21201", email: "nope" });
    expect(e.ok).toBe(false);
    const n = parseLeadPayload({ address: "1 A St", city: "X", state: "MD", zip: "21201", beds: "three" });
    expect(n.ok).toBe(false);
    expect(parseLeadPayload("text").ok).toBe(false);
    expect(parseLeadPayload([1]).ok).toBe(false);
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

  it("falls back to the company name and rejects an empty row", () => {
    const c = parseBuyerPayload({ company: "Harbor Capital" });
    expect(c.ok && c.data.firstName).toBe("Harbor Capital");
    expect(parseBuyerPayload({ phone: "410-555-0100" }).ok).toBe(false);
  });
});
