/**
 * Demo data for local development and for the first walkthrough with Ous.
 * Deterministic: the same seed value produces the same rows every run.
 * Runs on PGlite (tests) and on Supabase (pnpm --filter @dealcalc/db seed).
 */
import { acquisitions, wholesale, rehabEstimator, runDeal, outputsForStorage, ENGINE_VERSION, type AcquisitionsInput, type RehabLine, type DealInput } from "@dealcalc/engine";
import type { Db } from "../client";
import {
  orgs, profiles, pipelineStages, leadSources, tags, properties, contacts, propertyContacts, leads, leadTags,
  activities, tasks, offers, messageTemplates, campaigns, campaignSteps, buyers, buyerCriteria, dealAnalyses,
  rehabLineItems, costDefaults, propertyReports, comps, messages,
} from "../schema";
import { REHAB_CHECKLIST } from "./rehabChecklist";
export { REHAB_CHECKLIST, type ChecklistRow } from "./rehabChecklist";

export const STAGES = [
  { key: "new_lead", name: "New Lead", color: "#3b82f6" },
  { key: "attempted_contact", name: "Attempted Contact", color: "#6366f1" },
  { key: "contacted", name: "Contacted", color: "#8b5cf6" },
  { key: "qualified", name: "Qualified", color: "#0ea5e9" },
  { key: "offer_sent", name: "Offer Sent", color: "#f59e0b" },
  { key: "under_contract", name: "Under Contract", color: "#f97316" },
  { key: "due_diligence", name: "Due Diligence", color: "#84cc16" },
  { key: "closed", name: "Closed", color: "#22c55e", isTerminal: true },
  { key: "dead_nurture", name: "Dead / Nurture", color: "#9ca3af", isTerminal: true },
] as const;

export const ISSUE_TAGS = [
  "Dirty title", "Probate or inherited", "Liens or judgments", "Mortgage default or foreclosure", "Code violations",
  "Poor condition", "Occupied by tenant", "Occupied by squatter", "Seller urgency", "Divorce or partner dispute",
  "Tax delinquent", "Hoarder or environmental", "Other complexity",
];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Sam", "Dana", "Marcus", "Linda", "Tyrone", "Gloria", "Kevin", "Patricia", "Andre", "Rosa", "Walter", "Denise", "Hector", "Joyce", "Calvin", "Monique", "Ray", "Bev", "Otis", "Pam", "Lamar", "Tina", "Earl", "Nadia", "Vince", "Ida", "Gus", "Marla", "Leon", "Faye"];
const LAST = ["Johnson", "Williams", "Brown", "Jones", "Miller", "Davis", "Garcia", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Thompson", "White", "Harris", "Clark", "Lewis", "Robinson", "Walker", "Young", "Allen", "King", "Wright", "Scott", "Green", "Baker", "Adams"];
const STREETS = ["Bagley Ave", "Margaret Ave", "Harford Rd", "Belair Rd", "Loch Raven Blvd", "Eastern Ave", "Dundalk Ave", "Frederick Rd", "Liberty Rd", "Reisterstown Rd", "York Rd", "Ritchie Hwy", "Crain Hwy", "Old Court Rd", "Perring Pkwy", "Wise Ave", "North Point Rd", "Edmondson Ave", "Greenmount Ave", "Patapsco Ave", "Hillen Rd", "Joppa Rd", "Rolling Rd", "Rossville Blvd", "Pulaski Hwy"];
const CITIES: { city: string; zip: string; county: string }[] = [
  { city: "Baltimore", zip: "21206", county: "Baltimore City" }, { city: "Parkville", zip: "21234", county: "Baltimore" },
  { city: "Essex", zip: "21221", county: "Baltimore" }, { city: "Dundalk", zip: "21222", county: "Baltimore" },
  { city: "Towson", zip: "21286", county: "Baltimore" }, { city: "Glen Burnie", zip: "21061", county: "Anne Arundel" },
  { city: "Catonsville", zip: "21228", county: "Baltimore" }, { city: "Randallstown", zip: "21133", county: "Baltimore" },
  { city: "Rosedale", zip: "21237", county: "Baltimore" }, { city: "Pasadena", zip: "21122", county: "Anne Arundel" },
];

const TEMPLATES = [
  { channel: "sms" as const, name: "First touch", body: "Hi {{first_name}}, this is {{sender_name}}. I saw your note about {{property_address}}. Is it still something you are thinking about selling? Reply STOP to opt out." },
  { channel: "sms" as const, name: "Second attempt", body: "{{first_name}}, {{sender_name}} again about {{property_address}}. I can make a cash offer with no repairs and close on your timeline. Good time for a quick call?" },
  { channel: "sms" as const, name: "Offer follow up", body: "Hi {{first_name}}, checking in on the offer for {{property_address}}. Happy to walk through the numbers or adjust the closing date. {{sender_name}}" },
  { channel: "sms" as const, name: "Long term nurture", body: "{{first_name}}, {{sender_name}} here. No pressure at all. If anything changes with {{property_address}}, I am one text away." },
  { channel: "email" as const, name: "Intro email", subject: "About {{property_address}}", body: "Hi {{first_name}},\n\nThank you for reaching out about {{property_address}}. We buy houses as is, pay closing costs, and can close in as little as 14 days.\n\nWhen is a good time for a 10 minute call?\n\n{{sender_name}}" },
  { channel: "email" as const, name: "Offer letter", subject: "Cash offer for {{property_address}}", body: "Hi {{first_name}},\n\nAttached is our written cash offer for {{property_address}}. It is good for 7 days. Let me know if you have questions.\n\n{{sender_name}}" },
];

const BASE_ACQ: Omit<AcquisitionsInput, "holdMonths" | "asIsValue" | "purchasePrice" | "arv" | "repairCosts"> = {
  assignmentFee: -10000,
  firstLienAmount: 0, firstPointsRate: 0.03, firstInterestRate: 0, firstMonthlyInterestOnlyRate: 0.14 / 12,
  secondLienAmount: 0, secondPointsRate: 0.1, secondInterestRate: 0, secondMonthlyInterestOnlyRate: 0,
  miscLienAmountPaid: 0, miscPointsPaid: 0, miscInterestPaid: 0, miscMonthlyInterestOnlyPaid: 0, miscFinancingCosts: 0,
  propertyTaxRate: 0.022, hoaMonthly: 0, insuranceMonthly: 100, utilitiesMonthly: 0, gasMonthly: 75, waterMonthly: 40, electricityMonthly: 90, miscUtilitiesMonthly: 0,
  miscHoldingMonthly: [0, 0, 0, 0],
  buyEscrowRate: 0.005, buyTitleRate: 0.01, buyMiscRate: 0,
  sellEscrowRate: 0.005, sellRecordingRate: 0.0025, sellRealtorRate: 0.03, sellTransferRate: 0.0001,
  sellHomeWarranty: 0, sellStaging: 0, sellMarketing: 0, sellMisc: 0,
};

export type SeedResult = { orgId: string; profileIds: Record<string, string>; leadIds: string[]; propertyIds: string[]; buyerIds: string[]; analysisIds: string[] };

export async function seed(db: Db, options: { seed?: number; adminEmail?: string } = {}): Promise<SeedResult> {
  const rand = rng(options.seed ?? 42);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
  const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
  const daysAhead = (d: number) => new Date(Date.now() + d * 86_400_000);

  const [org] = await db.insert(orgs).values({
    name: "Acquisitions Team",
    branding: { companyName: "Acquisitions Team", primaryColor: "#0f172a", disclosure: "All figures are estimates and not a guarantee of value or profit. Buyer to verify all information independently." },
  }).returning();
  const orgId = org!.id;

  const profileRows = await db.insert(profiles).values([
    { orgId, fullName: "Russ Harris", email: options.adminEmail ?? "russellharrisrei@gmail.com", role: "admin" },
    { orgId, fullName: "Ous", email: "ous@example.com", role: "acquisitions" },
    { orgId, fullName: "Dispo Lead", email: "dispositions@example.com", role: "dispositions" },
    { orgId, fullName: "Partner View", email: "viewer@example.com", role: "viewer" },
  ]).returning();
  const profileIds = Object.fromEntries(profileRows.map((p) => [p.role, p.id]));
  const acqTeam = [profileRows[0]!.id, profileRows[1]!.id];

  const stageRows = await db.insert(pipelineStages).values(
    STAGES.map((s, i) => ({ orgId, key: s.key, name: s.name, position: i + 1, color: s.color, isTerminal: "isTerminal" in s ? Boolean(s.isTerminal) : false })),
  ).returning();
  const stageByKey = Object.fromEntries(stageRows.map((s) => [s.key, s.id]));

  const sourceRows = await db.insert(leadSources).values([
    { orgId, name: "Get Property Leads", costPerLead: "85.00" },
    { orgId, name: "PPC", costPerLead: "120.00" },
    { orgId, name: "Direct Mail", costPerLead: "45.00" },
    { orgId, name: "Referral", costPerLead: "0.00" },
    { orgId, name: "Driving for Dollars", costPerLead: "10.00" },
  ]).returning();

  const tagRows = await db.insert(tags).values([
    ...ISSUE_TAGS.map((name) => ({ orgId, name, kind: "issue" as const, color: "#ef4444" })),
    { orgId, name: "Hot", kind: "lead" as const, color: "#f97316" },
    { orgId, name: "Cash buyer ready", kind: "lead" as const, color: "#22c55e" },
    { orgId, name: "Needs comps", kind: "lead" as const, color: "#0ea5e9" },
  ]).returning();
  const issueTagIds = tagRows.filter((t) => t.kind === "issue").map((t) => t.id);
  const hotTag = tagRows.find((t) => t.name === "Hot")!.id;

  const templateRows = await db.insert(messageTemplates).values(
    TEMPLATES.map((t) => ({ orgId, channel: t.channel, name: t.name, subject: "subject" in t ? t.subject : null, body: t.body, mergeFields: ["first_name", "property_address", "sender_name"] })),
  ).returning();

  const [c1, c2] = await db.insert(campaigns).values([
    { orgId, name: "New lead 5 day SMS", channel: "sms", status: "active", segment: { stageKeys: ["new_lead", "attempted_contact"] }, createdBy: profileIds["admin"]! },
    { orgId, name: "Dead lead 90 day nurture", channel: "sms", status: "draft", segment: { stageKeys: ["dead_nurture"] }, createdBy: profileIds["admin"]! },
  ]).returning();
  const sms = templateRows.filter((t) => t.channel === "sms");
  await db.insert(campaignSteps).values([
    { orgId, campaignId: c1!.id, position: 1, delayHours: 0, templateId: sms[0]!.id },
    { orgId, campaignId: c1!.id, position: 2, delayHours: 24, templateId: sms[1]!.id },
    { orgId, campaignId: c1!.id, position: 3, delayHours: 96, templateId: sms[2]!.id },
    { orgId, campaignId: c2!.id, position: 1, delayHours: 0, templateId: sms[3]!.id },
    { orgId, campaignId: c2!.id, position: 2, delayHours: 24 * 30, templateId: sms[3]!.id },
  ]);

  await db.insert(costDefaults).values(
    REHAB_CHECKLIST.map((l) => ({ orgId, rowNumber: l.row, itemNumber: l.itemNumber, question: l.question, option: l.option, unitCost: l.unitCost === null ? null : l.unitCost.toFixed(2), unit: l.unit, market: "Baltimore metro (workbook defaults)", asOf: "2026-09-14" })),
  );

  const propertyIds: string[] = [];
  const contactIds: string[] = [];
  const leadIds: string[] = [];
  const analysisIds: string[] = [];
  const stageKeys = STAGES.map((s) => s.key);
  const usedNames = new Set<string>();

  for (let i = 0; i < 40; i++) {
    const loc = pick(CITIES);
    const sqft = between(900, 2400);
    const arv = Math.round(between(140, 420) * 1000);
    const [property] = await db.insert(properties).values({
      orgId, addressLine1: `${between(100, 9900)} ${pick(STREETS)}`, city: loc.city, state: "MD", postalCode: loc.zip, county: loc.county,
      propertyType: pick(["Single Family", "Rowhome", "Townhouse", "Duplex"]), beds: String(between(2, 5)), baths: String(between(1, 3)), sqft,
      lotSqft: between(1500, 12000), yearBuilt: between(1920, 2005), occupancy: pick(["owner", "tenant", "vacant", "unknown"]), condition: pick(["2", "3", "3", "4", "unknown"]),
      lat: (39.29 + rand() * 0.25).toFixed(6), lng: (-76.75 + rand() * 0.35).toFixed(6),
    }).returning();
    propertyIds.push(property!.id);

    let first = pick(FIRST), last = pick(LAST);
    while (usedNames.has(first + last)) { first = pick(FIRST); last = pick(LAST); }
    usedNames.add(first + last);
    const phone = `+1410555${String(1000 + i).padStart(4, "0")}`;
    const consent = pick(["unknown", "opted_in", "opted_in", "opted_out"] as const);
    const [contact] = await db.insert(contacts).values({
      orgId, firstName: first, lastName: last, phones: [{ number: phone, type: "mobile", isPrimary: true }],
      emails: rand() > 0.3 ? [{ address: `${first}.${last}@example.com`.toLowerCase(), isPrimary: true }] : [],
      relationship: pick(["owner", "owner", "owner", "heir", "agent"]), smsConsent: consent, smsConsentAt: consent === "unknown" ? null : daysAgo(between(1, 60)),
    }).returning();
    contactIds.push(contact!.id);
    await db.insert(propertyContacts).values({ orgId, propertyId: property!.id, contactId: contact!.id, role: contact!.relationship, isPrimary: true });

    const stageKey = i < 8 ? "new_lead" : stageKeys[Math.min(8, Math.floor((i - 8) / 4))]!;
    const status = stageKey === "closed" ? "won" : stageKey === "dead_nurture" ? "lost" : "open";
    const createdDaysAgo = stageKey === "new_lead" ? between(0, 2) : between(5, 90);
    const issues: Record<string, { flagged: boolean; note?: string }> = {};
    const issueKeys = ["dirty_title", "probate_or_inherited", "liens_or_judgments", "mortgage_default_or_foreclosure", "code_violations", "poor_condition", "occupied_by_tenant", "seller_urgency", "tax_delinquent"];
    let messy = 0;
    for (const k of issueKeys) if (rand() < 0.18) { issues[k] = { flagged: true, note: "From seller call" }; messy += 1; }
    const [lead] = await db.insert(leads).values({
      orgId, propertyId: property!.id, primaryContactId: contact!.id, stageId: stageByKey[stageKey]!, sourceId: pick(sourceRows).id,
      assignedTo: pick(acqTeam), status, motivationScore: between(1, 10), sellerUrgency: pick(["none", "low", "medium", "high", "immediate"]),
      askingPrice: rand() > 0.4 ? String(Math.round(arv * (0.55 + rand() * 0.35))) : null,
      nextFollowUpAt: status === "open" ? (rand() > 0.5 ? daysAhead(between(0, 5)) : daysAgo(between(0, 3))) : null,
      lastContactAt: stageKey === "new_lead" ? null : daysAgo(between(0, 10)),
      contactAttempts: stageKey === "new_lead" ? 0 : between(1, 9),
      firstResponseMinutes: stageKey === "new_lead" ? null : between(3, 1800),
      dealIssues: { ...issues, messyScore: messy },
      createdAt: daysAgo(createdDaysAgo), stageEnteredAt: daysAgo(Math.min(createdDaysAgo, between(0, 14))),
    }).returning();
    leadIds.push(lead!.id);

    for (const idx of Object.keys(issues).map((k) => issueKeys.indexOf(k))) if (idx >= 0 && issueTagIds[idx]) await db.insert(leadTags).values({ orgId, leadId: lead!.id, tagId: issueTagIds[idx]! });
    if (rand() < 0.2) await db.insert(leadTags).values({ orgId, leadId: lead!.id, tagId: hotTag });

    const acts: (typeof activities.$inferInsert)[] = [{ orgId, leadId: lead!.id, actorId: null, type: "system", payload: { text: "Lead created" }, occurredAt: daysAgo(createdDaysAgo) }];
    for (let a = 0; a < (lead!.contactAttempts ?? 0); a++) {
      acts.push({ orgId, leadId: lead!.id, actorId: lead!.assignedTo, type: pick(["call", "sms", "note"]), payload: { text: pick(["Left voicemail", "No answer", "Spoke with seller, wants to think", "Sent intro text", "Seller asked for a number"]) }, occurredAt: daysAgo(between(0, createdDaysAgo)) });
    }
    if (stageKey !== "new_lead") acts.push({ orgId, leadId: lead!.id, actorId: lead!.assignedTo, type: "stage_change", payload: { from: "new_lead", to: stageKey }, occurredAt: lead!.stageEnteredAt });
    await db.insert(activities).values(acts);

    if (status === "open") {
      await db.insert(tasks).values({ orgId, leadId: lead!.id, assignedTo: lead!.assignedTo, title: pick(["Call seller back", "Send offer follow up", "Schedule walkthrough", "Confirm payoff amount", "Text seller"]), kind: pick(["call", "text", "email", "visit"]), dueAt: lead!.nextFollowUpAt ?? daysAhead(1) });
    }

    if (stageKey !== "new_lead" && stageKey !== "attempted_contact") {
      await db.insert(messages).values([
        { orgId, leadId: lead!.id, contactId: contact!.id, channel: "sms", direction: "out", fromAddr: "+14105550000", toAddr: phone, body: sms[0]!.body.replace("{{first_name}}", first).replace("{{sender_name}}", "Ous").replace("{{property_address}}", property!.addressLine1), templateId: sms[0]!.id, provider: "mock", providerMessageId: `mock-${i}-1`, status: "delivered", statusAt: daysAgo(createdDaysAgo - 1), sentBy: lead!.assignedTo, payload: { smsConsentAtSend: consent } },
        { orgId, leadId: lead!.id, contactId: contact!.id, channel: "sms", direction: "in", fromAddr: phone, toAddr: "+14105550000", body: pick(["Yes still interested", "What can you offer", "Call me after 5", "Not right now"]), provider: "mock", providerMessageId: `mock-${i}-2`, status: "received", statusAt: daysAgo(createdDaysAgo - 1) },
      ]);
    }

    const analyzed = ["qualified", "offer_sent", "under_contract", "due_diligence", "closed"].includes(stageKey);
    if (analyzed) {
      const repairLines: RehabLine[] = REHAB_CHECKLIST.map((l) => ({ row: l.row, itemNumber: l.itemNumber, question: l.question, option: l.option, answer: l.unitCost && rand() < 0.15 ? "Yes" : (l.unitCost ? "No" : null), quantity: l.perSqft ? sqft : 1, unitCost: l.unitCost }));
      const repairTotal = rehabEstimator({ lines: repairLines }).total;
      const purchasePrice = Math.round(arv * 0.7 - repairTotal - 10000);
      const acq: AcquisitionsInput = { ...BASE_ACQ, holdMonths: 4, asIsValue: Math.round(arv * 0.75), purchasePrice, arv, rehab: { lines: repairLines }, firstLienAmount: purchasePrice };
      const out = acquisitions(acq);
      const ws = wholesale({ arv, repairCosts: repairTotal, assignmentFee: 10000, purchasePrice, investorBuyPrice: Math.round(arv * 0.7 - repairTotal), closingCosts: 1500 });
      const inputs: DealInput = { meta: { name: "Base case", address: `${property!.addressLine1}, ${property!.city} MD` }, rehab: { lines: repairLines }, acquisitions: { ...acq, rehab: undefined, repairCosts: repairTotal }, wholesale: { arv, repairCosts: repairTotal, assignmentFee: 10000, purchasePrice, investorBuyPrice: ws.investorBuyPrice, closingCosts: 1500 } };
      // Strategy cycles by lead index so the seed stays deterministic without drawing more random numbers.
      const strategy = (["wholesale", "wholesale", "flip", "rental"] as const)[i % 4]!;
      inputs.meta.strategy = strategy;
      inputs.offers = { comparables: [], useComparableAverage: false, squareFeet: sqft, perSqft: { light: 15, medium: 30, full: 50 }, sellerCurrent: null, sellerDesired: null };
      inputs.rehabPlan = { source: "checklist", perSqftRate: 30, squareFeet: sqft };
      inputs.progress = [];
      inputs.loan = { principal: Math.max(1000, Math.round(purchasePrice * 0.8)), annualRate: 0.075, months: 360, firstPaymentDate: "2026-11-01", payoffAfterPayment: 60 };
      const full = outputsForStorage(runDeal(inputs, { sensitivity: true }));
      const [analysis] = await db.insert(dealAnalyses).values({
        orgId, propertyId: property!.id, leadId: lead!.id, version: 1, name: "Base case", strategy, status: stageKey === "qualified" ? "reviewing" : "approved_for_offer",
        inputs, outputs: full as unknown as Record<string, unknown>, engineVersion: ENGINE_VERSION, isPrimary: true, createdBy: lead!.assignedTo,
        netProfit: out.netProfit.toFixed(2), maxAllowableOffer: ws.maxAllowableOffer.toFixed(2), spread: ws.spread.toFixed(2), arv: String(arv), purchasePrice: String(purchasePrice),
      }).returning();
      analysisIds.push(analysis!.id);
      await db.insert(rehabLineItems).values(repairLines.map((l, idx) => ({ orgId, analysisId: analysis!.id, rowNumber: l.row, itemNumber: l.itemNumber, question: l.question, option: l.option, answer: l.answer, quantity: l.quantity === null ? null : String(l.quantity), unitCost: l.unitCost === null ? null : String(l.unitCost), lineTotal: String(rehabEstimator({ lines: [l] }).lineTotals[0] ?? 0) })));
      if (["offer_sent", "under_contract", "due_diligence", "closed"].includes(stageKey)) {
        await db.insert(offers).values({ orgId, leadId: lead!.id, analysisId: analysis!.id, amount: String(purchasePrice), type: "cash", status: stageKey === "offer_sent" ? "sent" : "accepted", sentAt: daysAgo(between(1, 20)), sentVia: "email", createdBy: lead!.assignedTo });
      }
      const [report] = await db.insert(propertyReports).values({
        orgId, propertyId: property!.id, provider: "mock", status: "ok", costCents: 0,
        normalized: {
          characteristics: { propertyType: property!.propertyType ?? undefined, beds: Number(property!.beds), baths: Number(property!.baths), sqft, lotSqft: property!.lotSqft ?? undefined, yearBuilt: property!.yearBuilt ?? undefined },
          owner: { names: [`${first} ${last}`], ownerOccupied: property!.occupancy === "owner", absentee: property!.occupancy !== "owner", ownerType: "individual", yearsOwned: between(2, 30) },
          valuation: { avm: Math.round(arv * 0.92), avmLow: Math.round(arv * 0.85), avmHigh: Math.round(arv * 1.02), confidence: 0.7, rentEstimate: Math.round(arv * 0.0075) },
          mortgages: rand() > 0.4 ? [{ lender: "Example Bank", amount: Math.round(arv * 0.5), originatedAt: "2016-05-01", rate: 4.25, type: "conventional", estimatedBalance: Math.round(arv * 0.38), position: 1 }] : [],
          liens: issues["liens_or_judgments"] ? [{ kind: "judgment", amount: between(2, 25) * 1000, recordedAt: "2024-11-12", holder: "Example Creditor" }] : [],
          transactions: [{ date: "2016-05-01", price: Math.round(arv * 0.6), type: "sale" }],
          tax: { assessedValue: Math.round(arv * 0.8), taxAmount: Math.round(arv * 0.8 * 0.011), taxYear: 2025, delinquent: Boolean(issues["tax_delinquent"]) },
          distress: { preForeclosure: Boolean(issues["mortgage_default_or_foreclosure"]), taxDelinquent: Boolean(issues["tax_delinquent"]), vacant: property!.occupancy === "vacant", probate: Boolean(issues["probate_or_inherited"]), flags: Object.keys(issues) },
          location: { county: loc.county, lat: Number(property!.lat), lng: Number(property!.lng) },
          arv: { estimate: arv, low: Math.round(arv * 0.93), high: Math.round(arv * 1.06), perSqft: Math.round(arv / sqft), compCount: 3, method: "mock" },
        },
        raw: { provider: "mock", note: "Seed data, not a live provider response" },
      }).returning();
      await db.insert(comps).values([1, 2, 3].map((n) => ({
        orgId, propertyId: property!.id, reportId: report!.id, source: "provider" as const, address: `${between(100, 9900)} ${pick(STREETS)}, ${loc.city} MD`,
        soldPrice: String(Math.round(arv * (0.9 + rand() * 0.2))), soldAt: daysAgo(between(30, 300)), sqft: sqft + between(-300, 300), beds: String(between(2, 5)), baths: String(between(1, 3)), distanceMi: (rand() * 1.2).toFixed(2), included: true,
      })));
    }
  }

  const buyerIds: string[] = [];
  const BUYERS = [
    { company: "Chesapeake Capital Homes", first: "Mike", last: "Reynolds", states: ["MD"], counties: ["Baltimore City", "Baltimore"], types: ["Single Family", "Rowhome"], min: 60000, max: 250000, arvPct: 0.7, cond: [1, 2, 3], funding: "cash" as const, sight: true, margin: 15000 },
    { company: "Harbor Point Investments", first: "Jen", last: "Okafor", states: ["MD", "PA"], counties: ["Baltimore", "Anne Arundel"], types: ["Single Family", "Townhouse"], min: 100000, max: 400000, arvPct: 0.75, cond: [2, 3, 4], funding: "hard_money" as const, sight: false, margin: 20000 },
    { company: "Patapsco Property Group", first: "Dave", last: "Lin", states: ["MD"], counties: ["Baltimore City"], types: ["Rowhome", "Duplex"], min: 40000, max: 150000, arvPct: 0.65, cond: [1, 2], funding: "cash" as const, sight: true, margin: 10000 },
    { company: "Severn River Holdings", first: "Priya", last: "Shah", states: ["MD"], counties: ["Anne Arundel"], types: ["Single Family"], min: 200000, max: 500000, arvPct: 0.78, cond: [3, 4, 5], funding: "conventional" as const, sight: false, margin: 25000 },
    { company: "Old Line Rentals", first: "Carlos", last: "Mendez", states: ["MD"], counties: ["Baltimore", "Baltimore City"], types: ["Single Family", "Rowhome", "Duplex"], min: 80000, max: 220000, arvPct: 0.72, cond: [2, 3], funding: "mixed" as const, sight: true, margin: 12000 },
    { company: "Towson Turnkey", first: "Angela", last: "Price", states: ["MD"], counties: ["Baltimore"], types: ["Single Family", "Townhouse"], min: 150000, max: 350000, arvPct: 0.7, cond: [2, 3, 4], funding: "cash" as const, sight: false, margin: 18000 },
    { company: "Blue Crab Buyers", first: "Tom", last: "Nguyen", states: ["MD", "DE"], counties: [], types: ["Single Family"], min: 50000, max: 300000, arvPct: 0.7, cond: [1, 2, 3, 4], funding: "cash" as const, sight: true, margin: 15000 },
    { company: "Fells Point Flips", first: "Sara", last: "Cohen", states: ["MD"], counties: ["Baltimore City"], types: ["Rowhome"], min: 30000, max: 120000, arvPct: 0.6, cond: [1, 2], funding: "cash" as const, sight: true, margin: 8000 },
    { company: "Glen Burnie Group", first: "Rob", last: "Bailey", states: ["MD"], counties: ["Anne Arundel", "Baltimore"], types: ["Single Family", "Townhouse", "Duplex"], min: 120000, max: 380000, arvPct: 0.74, cond: [2, 3, 4], funding: "hard_money" as const, sight: false, margin: 20000 },
    { company: "Mason Dixon Ventures", first: "Erin", last: "Walsh", states: ["MD", "PA"], counties: [], types: ["Single Family"], min: 90000, max: 260000, arvPct: 0.7, cond: [2, 3], funding: "mixed" as const, sight: false, margin: 15000 },
    { company: "Charm City Holdings", first: "Andre", last: "Baptiste", states: ["MD"], counties: ["Baltimore City", "Baltimore"], types: ["Rowhome", "Single Family"], min: 40000, max: 200000, arvPct: 0.68, cond: [1, 2, 3], funding: "cash" as const, sight: true, margin: 12000 },
    { company: "Bay Ridge Capital", first: "Nicole", last: "Foster", states: ["MD", "VA"], counties: ["Anne Arundel"], types: ["Single Family", "Townhouse"], min: 180000, max: 450000, arvPct: 0.76, cond: [3, 4], funding: "conventional" as const, sight: false, margin: 22000 },
  ];
  for (const b of BUYERS) {
    const [buyer] = await db.insert(buyers).values({ orgId, company: b.company, firstName: b.first, lastName: b.last, phones: [{ number: `+1443555${between(1000, 9999)}`, type: "mobile", isPrimary: true }], emails: [{ address: `${b.first}@${b.company.toLowerCase().replace(/[^a-z]/g, "")}.example.com`, isPrimary: true }], source: pick(["Networking event", "Referral", "Cash buyer list", "Closed deal"]), lastContactedAt: daysAgo(between(1, 60)), notes: pick(["Prefers texts", "Wants photos before walkthrough", "Closes in 10 days with POF on file", "Only buys off market"]) }).returning();
    buyerIds.push(buyer!.id);
    await db.insert(buyerCriteria).values({ orgId, buyerId: buyer!.id, states: b.states, counties: b.counties, propertyTypes: b.types, priceMin: String(b.min), priceMax: String(b.max), arvPctMax: b.arvPct.toFixed(4), buyingFormula: `${Math.round(b.arvPct * 100)}% of ARV minus repairs`, conditionLevels: b.cond, occupancyPrefs: ["vacant", "owner"], funding: b.funding, proofOfFundsOnFile: rand() > 0.4, sightUnseen: b.sight, minMarginAmount: String(b.margin), closesInDays: between(7, 30) });
  }

  return { orgId, profileIds, leadIds, propertyIds, buyerIds, analysisIds };
}
