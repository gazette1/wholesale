import { test, expect, type Page, type Browser } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://127.0.0.1:3107";
const CODES = resolve(__dirname, "../../..", ".pglite", "e2e-codes.log");
const FORM_NAME = "E2E Site visit";
const BUYER_FORM_NAME = "E2E Buyer intake";

test.describe.configure({ mode: "serial" });

const shared: { formId?: string; taskUrl?: string; leads: string[]; buyerHref?: string } = { leads: [] };

function codeLines(email: string): string[] {
  if (!existsSync(CODES)) return [];
  return readFileSync(CODES, "utf8").split("\n").filter((l) => l.includes(`to=${email} `));
}

/** Signs an outside person in on a fill link by reading the mock one-time code from the server log. */
async function fillSignIn(page: Page, link: string, email: string) {
  await page.goto(link);
  const before = codeLines(email).length;
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await expect.poll(() => codeLines(email).length, { timeout: 20_000 }).toBeGreaterThan(before);
  const line = codeLines(email).at(-1)!;
  const code = /code=(\d{6})/.exec(line)![1]!;
  await page.getByLabel("Code", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByRole("button", { name: "Complete section" })).toBeVisible();
  // The page is server rendered first. Wait for it to hydrate so typed values are not reset.
  await page.waitForLoadState("networkidle");
}

async function leadHrefs(page: Page): Promise<string[]> {
  await page.goto("/leads");
  const hrefs = await page.locator('a[href^="/leads/"]').evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
  return [...new Set(hrefs.filter((h) => /^\/leads\/[0-9a-f-]{36}$/.test(h)))];
}

/** The signed in admin may not be an assignee of the section. Reassign to Russ Harris when "Complete section" is missing. */
async function ensureAssignee(page: Page) {
  const acts = page.getByRole("button", { name: "Complete section" }).or(page.getByRole("button", { name: "Approve", exact: true }));
  // The controls load on the client, so wait for either the work buttons or the Reassign card.
  await page.getByRole("heading", { name: "Snooze" }).or(acts.first()).first().waitFor();
  if (await acts.count()) return;
  const reassign = page.getByRole("button", { name: "Reassign", exact: true });
  if (!(await reassign.count())) return;
  await page.getByRole("checkbox", { name: "Russ Harris" }).check();
  await reassign.click();
  await expect(acts.first()).toBeVisible();
}

async function completeSection(page: Page) {
  await page.getByRole("button", { name: "Complete section" }).click();
  await expect(page.getByText("This section is complete.")).toBeVisible();
}

async function pickForm(page: Page, formName: string) {
  const select = page.getByLabel("Form", { exact: true });
  const values = await select.locator("option").evaluateAll((els, name) => els.filter((e) => (e.textContent ?? "").startsWith(name)).map((e) => (e as HTMLOptionElement).value), formName);
  expect(values.length).toBeGreaterThan(0);
  await select.selectOption(values[0]!);
}

async function startFormOnLead(page: Page, leadHref: string, formName: string) {
  await page.goto(leadHref + "?tab=forms");
  await pickForm(page, formName);
  await page.getByRole("button", { name: "Start form", exact: true }).click();
  await expect(page).toHaveURL(/\/forms\/tasks\/[0-9a-f-]{36}$/);
}

async function openLeadTask(page: Page, leadHref: string, formName: string) {
  await page.goto(`${leadHref}?tab=forms`);
  await page.getByRole("link", { name: `Open task for ${formName}` }).first().click();
  await expect(page).toHaveURL(/\/forms\/tasks\/[0-9a-f-]{36}$/);
}

async function inviteByEmail(page: Page, email: string, singleUse = true): Promise<string> {
  await page.getByLabel("Email", { exact: true }).fill(email);
  if (!singleUse) await page.getByLabel("Single use link").uncheck();
  await page.getByRole("button", { name: "Invite outside person", exact: true }).click();
  const box = page.locator("#invite-link");
  await expect(box).toBeVisible();
  return await box.inputValue();
}

async function fillBid(page: Page, company: string, email: string) {
  await page.getByLabel("Company name").fill(company);
  await page.getByLabel("Contact email").fill(email);
  await page.getByLabel("Total bid").fill("42500");
  await page.getByLabel("Days to complete").fill("30");
  await page.getByRole("radiogroup", { name: "Licensed and insured" }).getByLabel("Yes").check();
}

async function externalBid(browser: Browser, link: string, email: string, company: string) {
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fillSignIn(page, link, email);
  await expect(page.getByRole("button", { name: "Complete section" })).toBeVisible();
  await fillBid(page, company, email);
  await page.getByRole("button", { name: "Complete section" }).click();
  await expect(page.getByText("This section is complete.")).toBeVisible();
  expect(errors).toEqual([]);
  await ctx.close();
}

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test("1. build a form in the editor and publish it", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/forms");
  await page.getByRole("button", { name: "New form", exact: true }).click();
  await page.getByLabel("Form name").fill(FORM_NAME);
  await page.getByRole("button", { name: "Create form", exact: true }).click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}$/);
  shared.formId = page.url().split("/").pop();

  await page.getByRole("button", { name: "Add section", exact: true }).click();
  await page.getByLabel("Section title").fill("Basics");
  await page.getByRole("button", { name: "Add field to Basics" }).click();
  await page.getByLabel("Field label").fill("Contact name");
  await page.getByRole("checkbox", { name: "Required" }).check();
  await page.getByRole("button", { name: "Add field to Basics" }).click();
  await page.getByLabel("Field label").fill("Has pets");
  page.once("dialog", (d) => d.accept());
  await page.getByLabel("Field type").selectOption({ label: "Yes or no" });
  await expect(page.getByRole("button", { name: "Edit field Has pets" })).toBeVisible();

  // The form is started from the submissions page, by whoever starts it.
  await page.getByRole("tab", { name: "Roles" }).click();
  await page.getByLabel("Owner source 1 kind").selectOption({ label: "The person who started the form" });
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByLabel("Subject type").selectOption("none");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await page.getByRole("tab", { name: "Form" }).click();

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText(/Published version 1/)).toBeVisible();
  await page.getByRole("tab", { name: "Versions" }).click();
  await expect(page.getByText("Version 1", { exact: false }).first()).toBeVisible();

  await page.goto("/forms");
  const row = page.getByRole("row").filter({ hasText: FORM_NAME });
  await expect(row).toContainText("Published");
  expect(errors).toEqual([]);
});

test("2. start a submission from a lead", async ({ page }) => {
  const errors = trackErrors(page);
  shared.leads = await leadHrefs(page);
  expect(shared.leads.length).toBeGreaterThanOrEqual(5);
  await startFormOnLead(page, shared.leads[0]!, "Seller intake");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Seller and property");
  expect(errors).toEqual([]);
});

test("3. complete two sections with a handoff", async ({ page }) => {
  const errors = trackErrors(page);
  await openLeadTask(page, shared.leads[0]!, "Seller intake");
  await ensureAssignee(page);
  // Required fields block completion first.
  await page.getByRole("button", { name: "Complete section" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /Seller name|required|attention/i }).first()).toBeVisible();
  await page.getByLabel("Seller name").fill("Pat Seller");
  await page.getByLabel("Relationship to the property").selectOption({ label: "Owner" });
  await page.getByRole("radiogroup", { name: "Who lives there now" }).getByLabel("Vacant").check();
  await completeSection(page);

  await openLeadTask(page, shared.leads[0]!, "Seller intake");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Motivation and timeline");
  await ensureAssignee(page);
  await page.getByLabel("Why are they selling").fill("Relocating for work");
  await page.getByLabel("Motivation, 1 to 10").fill("7");
  await completeSection(page);

  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: /Form tasks/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("4. approval with send back", async ({ page, browser }) => {
  const errors = trackErrors(page);
  const lead = shared.leads[1]!;
  await startFormOnLead(page, lead, "Contractor bid");
  await ensureAssignee(page);
  await page.getByLabel("Scope of work").fill("Replace roof and repaint");
  await page.getByLabel("Bid due by").fill("2030-01-15");
  await completeSection(page);

  await openLeadTask(page, lead, "Contractor bid");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Contractor bid");
  const link1 = await inviteByEmail(page, "bid.one@contractor.test", false);
  await externalBid(browser, link1, "bid.one@contractor.test", "First Roofing");

  await openLeadTask(page, lead, "Contractor bid");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bid approval");
  await ensureAssignee(page);
  await page.getByText("Earlier answers").click();
  await expect(page.getByText("First Roofing").first()).toBeVisible();
  await page.getByLabel("Send back to").selectOption({ label: "Contractor bid" });
  await page.getByRole("button", { name: "Send back", exact: true }).click();
  await expect(page.getByText(/decision comment/i).first()).toBeVisible();
  await page.getByLabel("Decision comment").fill("Please itemize the roof cost");
  await page.getByRole("button", { name: "Send back", exact: true }).click();
  await expect(page.getByText("Done.").first()).toBeVisible();

  await openLeadTask(page, lead, "Contractor bid");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Contractor bid");
  const link2 = await inviteByEmail(page, "bid.two@contractor.test", false);
  await externalBid(browser, link2, "bid.two@contractor.test", "Second Roofing");

  await openLeadTask(page, lead, "Contractor bid");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bid approval");
  await ensureAssignee(page);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Done.").first()).toBeVisible();
  await page.goto(`${lead}?tab=forms`);
  await expect(page.getByRole("row").filter({ hasText: "Contractor bid" })).toContainText("Completed");
  expect(errors).toEqual([]);
});

test("5. outside contractor bids through an invite link and buyer forms stay confidential", async ({ page, browser }) => {
  const errors = trackErrors(page);
  const lead = shared.leads[2]!;
  await startFormOnLead(page, lead, "Contractor bid");
  await ensureAssignee(page);
  await page.getByLabel("Scope of work").fill("Kitchen and bath refresh");
  await page.getByLabel("Bid due by").fill("2030-02-01");
  await completeSection(page);
  await openLeadTask(page, lead, "Contractor bid");
  const link = await inviteByEmail(page, "bid.three@contractor.test");
  const bidUrl = page.url();

  const ctx = await browser.newContext({ baseURL: BASE });
  const ext = await ctx.newPage();
  const extErrors = trackErrors(ext);
  await fillSignIn(ext, link, "bid.three@contractor.test");
  await expect(ext.getByRole("button", { name: "Complete section" })).toBeVisible();
  await expect(ext.locator("aside")).toHaveCount(0);
  const hrefs = await ext.locator("a").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
  expect(hrefs.filter((h) => /^\/(leads|buyers|forms|dashboard|pipeline|settings|tasks|analyzer|reports|alerts)/.test(h))).toEqual([]);
  await fillBid(ext, "Third Builders", "bid.three@contractor.test");
  await ext.getByRole("button", { name: "Complete section" }).click();
  await expect(ext.getByText("This section is complete.")).toBeVisible();
  expect(extErrors).toEqual([]);
  await ctx.close();

  await page.goto(bidUrl);
  await expect(page.getByLabel("Company name")).toHaveValue("Third Builders");
  await expect(page.getByLabel("Total bid")).toHaveValue("42500");

  // A small buyer subject form with one external section.
  await page.goto("/forms");
  await page.getByRole("button", { name: "New form", exact: true }).click();
  await page.getByLabel("Form name").fill(BUYER_FORM_NAME);
  await page.getByRole("button", { name: "Create form", exact: true }).click();
  await expect(page).toHaveURL(/\/forms\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Add section", exact: true }).click();
  await page.getByLabel("Section title").fill("Outside input");
  await page.getByRole("checkbox", { name: /Allow external people/ }).check();
  await page.getByRole("button", { name: "Add field to Outside input" }).click();
  await page.getByLabel("Field label").fill("Preferred areas");
  await page.getByRole("checkbox", { name: "Visible to external people" }).check();
  await page.getByRole("tab", { name: "Roles" }).click();
  await page.getByLabel("New role name").fill("Vendor");
  await page.getByRole("button", { name: "Add role", exact: true }).click();
  await page.getByLabel("Vendor source 1 kind").selectOption({ label: "An external person by invite" });
  await page.getByRole("tab", { name: "Form" }).click();
  await page.getByRole("button", { name: "Edit section Outside input" }).click();
  await page.getByLabel("Owner role").selectOption({ label: "Vendor" });
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByLabel("Subject type").selectOption("buyer");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await page.getByRole("tab", { name: "Form" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText(/Published version 1/)).toBeVisible();

  await page.goto("/buyers");
  const buyerHrefs = await page.locator('a[href^="/buyers/"]').evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
  shared.buyerHref = buyerHrefs.find((h) => /^\/buyers\/[0-9a-f-]{36}$/.test(h))!;
  await page.goto(shared.buyerHref);
  await pickForm(page, BUYER_FORM_NAME);
  await page.getByRole("button", { name: "Start form", exact: true }).click();
  await expect(page).toHaveURL(/\/forms\/tasks\/[0-9a-f-]{36}$/);
  const buyerLink = await inviteByEmail(page, "vendor@buyer.test");

  const ctx2 = await browser.newContext({ baseURL: BASE });
  const ext2 = await ctx2.newPage();
  await fillSignIn(ext2, buyerLink, "vendor@buyer.test");
  await expect(ext2.getByLabel("Preferred areas")).toBeVisible();
  const text = await ext2.locator("body").innerText();
  expect(text).not.toMatch(/contract price|\bspread\b|\bMAO\b|assignment fee/i);
  expect(await ext2.content()).not.toMatch(/contract price|\bspread\b|\bMAO\b|assignment fee|maxAllowableOffer|purchasePrice|assignmentFee/i);
  await ctx2.close();
  expect(errors).toEqual([]);
});

test("6. publishing a new version migrates an open submission", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`/forms/${shared.formId}/submissions`);
  await page.getByRole("button", { name: "Start a submission" }).click();
  await expect(page).toHaveURL(/\/forms\/tasks\/[0-9a-f-]{36}$/);
  shared.taskUrl = page.url();
  await page.getByLabel("Contact name").fill("Migrating Person");
  await page.getByLabel("Contact name").blur();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.goto(`/forms/${shared.formId}`);
  await page.getByRole("button", { name: "Add field to Basics" }).click();
  await page.getByLabel("Field label").fill("Follow up date");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText(/Published version 2/)).toBeVisible();
  await page.getByRole("tab", { name: "Versions" }).click();
  await expect(page.getByText("Version 2").first()).toBeVisible();

  await page.goto(shared.taskUrl!);
  await expect(page.getByLabel("Contact name")).toHaveValue("Migrating Person");
  await expect(page.getByLabel("Follow up date")).toHaveValue("");
  expect(errors).toEqual([]);
});

test("7. purge needs a second admin", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/forms/purge");
  await page.waitForLoadState("networkidle");
  // Russ requests a purge and cannot approve it himself.
  const options = await page.getByLabel("Person").locator("option").evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
  const buyers = options.filter((v) => v.startsWith("buyer:"));
  expect(buyers.length).toBeGreaterThan(2);
  await page.getByLabel("Person").selectOption(buyers[1]!);
  await page.getByLabel("Request reference").fill("E2E own request");
  await page.getByRole("button", { name: "Request purge", exact: true }).click();
  const own = page.getByRole("listitem").filter({ hasText: "E2E own request" });
  await expect(own).toContainText("Waiting for a second admin");
  await expect(own.getByRole("button", { name: "Approve purge" })).toHaveCount(0);

  // A request made by the seeded second admin can be approved by Russ.
  const theirs = page.getByRole("listitem").filter({ hasText: "E2E seeded request" });
  await expect(theirs).toContainText("Waiting for a second admin");
  page.once("dialog", (d) => d.accept());
  await theirs.getByRole("button", { name: "Approve purge" }).click();
  await expect(theirs).toContainText("Purged");
  await expect(theirs.getByRole("button", { name: "Approve purge" })).toHaveCount(0);
  expect(errors).toEqual([]);
});
