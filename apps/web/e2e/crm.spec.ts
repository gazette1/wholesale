import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("lead create, stage move, mock SMS, offer expiry and analyzer save persist", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/leads/new");
  await page.getByLabel("Street address").fill("987 Verification Lane");
  await page.getByLabel("City", { exact: true }).fill("Baltimore");
  await page.getByLabel("ZIP", { exact: true }).fill("21201");
  await page.getByLabel("First name", { exact: true }).fill("Verification");
  await page.getByLabel("Mobile phone").fill("4105550198");
  await page.locator('[name="smsConsent"]').selectOption("opted_in");
  await page.getByRole("button", { name: "Create lead", exact: true }).click();
  await expect(page).toHaveURL(/\/leads\/[a-f0-9-]+$/);
  const leadUrl = page.url();
  await page.getByRole("combobox", { name: /^Stage/ }).selectOption({ label: "Contacted" });
  await expect(page.locator("h1")).toContainText("Contacted");
  await page.goto(`${leadUrl}?tab=messages`);
  await page.locator('[name="body"]').fill("Local verification message");
  await page.locator("form").filter({ has: page.locator('[name="body"]') }).locator('button[type="submit"]').click();
  await expect(page.getByText("Local verification message", { exact: true })).toBeVisible();
  await page.goto(`${leadUrl}?tab=offers`);
  await page.locator('[name="amount"]').fill("123456");
  const expiry = new Date().toISOString().slice(0, 10);
  await page.locator('[name="expiresAt"]').fill(expiry);
  await page.locator("form").filter({ has: page.locator('[name="amount"]') }).locator('button[type="submit"]').click();
  await expect(page.locator("tbody")).toContainText("123,456");
  await page.reload();
  await expect(page.locator("tbody")).toContainText(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" }).format(new Date(`${expiry}T12:00:00Z`)));
  expect((await request.get("/api/cron/dispatch", { headers: { Authorization: "Bearer local-e2e-only" } })).ok()).toBeTruthy();
  await page.goto("/alerts");
  const expiryAlert = page.locator("li").filter({ hasText: "987 Verification Lane" }).filter({ hasText: "Offer is expiring soon" });
  await expect(expiryAlert).toHaveCount(1);
  await page.goto(`${leadUrl}?tab=offers`);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Accepted", exact: true }).click();
  await expect(page.locator("h1")).toContainText("Under Contract");
  await page.goto("/alerts");
  await expect(expiryAlert).toHaveCount(0);
  await page.goto(leadUrl);
  await page.getByRole("button", { name: "Analyze deal", exact: true }).click();
  await expect(page).toHaveURL(/\/analyzer\/[a-f0-9-]+$/);
  await page.getByLabel("Version name").fill("Verified analysis");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Version name")).toHaveValue("Verified analysis");
  expect(errors).toEqual([]);
});

test("public and tracked packages protect private numbers and enforce expiry", async ({ page, request }, testInfo) => {
  const privateFields = /contract price|assignment fee|maxAllowableOffer|purchasePrice|assignmentFee|\bspread\b|\bMAO\b/i;
  for (const token of ["e2e_public_package_token", "e2e_tracked_buyer_token"]) {
    const response = await page.goto(`/share/${token}`);
    expect(response?.status()).toBe(200);
    expect(await response!.text()).not.toMatch(privateFields);
    await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
    const pdfUrl = await page.getByRole("link", { name: "Download PDF" }).getAttribute("href");
    const pdf = await request.get(pdfUrl!);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    const bytes = await pdf.body();
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    await writeFile(testInfo.outputPath(`${token}.pdf`), bytes);
    const wrongPackage = await request.get(`/api/packages/00000000-0000-4000-8000-000000000002/pdf?token=${token}`);
    expect(wrongPackage.status()).toBe(404);
  }
  for (const token of ["e2e_expired_package_token", "e2e_expired_buyer_token"]) {
    expect((await request.get(`/share/${token}`)).status()).toBe(404);
    expect((await request.get(`/api/packages/00000000-0000-4000-8000-000000000002/pdf?token=${token}`)).status()).toBe(404);
  }
  await page.goto("/packages/00000000-0000-4000-8000-000000000001/preview");
  await page.getByRole("link", { name: "Send to matched buyers", exact: true }).click();
  await page.getByLabel("Score threshold").fill("0");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/Sent [1-9]/)).toBeVisible();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/Sent 0, skipped/)).toBeVisible();
});

test("saved columns, filtered bulk selection, shift selection and rename", async ({ page }) => {
  await page.goto("/leads?status=all&cols=address,stage&createdFrom=2020-01-01&createdTo=2030-01-01");
  await expect(page.getByRole("columnheader")).toHaveCount(3);
  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Apply", exact: true }).click()]);
  await expect(page.getByRole("columnheader")).toHaveCount(3);
  const boxes = page.locator('tbody input[type="checkbox"]');
  await boxes.nth(0).click();
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await boxes.nth(2).click({ modifiers: ["Shift"] });
  await expect(page.getByText("3 selected", { exact: true })).toBeVisible();
  const address = await page.locator('tbody a[href^="/leads/"]').first().innerText();
  await page.goto(`/leads?status=all&q=${encodeURIComponent(address)}`);
  await page.getByRole("checkbox", { name: /Select all .* leads on this page/ }).check();
  page.once("dialog", async (dialog) => { expect(dialog.message()).toContain("1 lead"); await dialog.accept(); });
  await page.getByRole("button", { name: "Select every lead matching your filters" }).click();
  await expect(page.getByText(/Selected every lead matching your filters/)).toContainText("1 match");
  await page.getByRole("button", { name: "Save current view" }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Verification view");
  await page.getByRole("dialog").getByLabel("Property", { exact: true }).check();
  await page.getByRole("button", { name: "Save view", exact: true }).click();
  await page.getByRole("link", { name: "Verification view", exact: true }).click();
  await expect(page.getByRole("columnheader")).toHaveCount(2);
  await page.getByRole("button", { name: "Edit Verification view", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Renamed verification");
  await page.getByRole("dialog").locator('button[type="submit"]').click();
  await expect(page.getByRole("link", { name: "Renamed verification", exact: true })).toBeVisible();
});

test("Phase 2 and Phase 3 pages render without browser or server errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !message.location().url.endsWith("/favicon.ico")) errors.push(message.text()); });
  await page.goto("/leads");
  const lead = await page.locator('tbody a[href^="/leads/"]').first().getAttribute("href");
  await page.goto(lead!);
  const report = await page.getByRole("link", { name: "Report", exact: true }).getAttribute("href");
  await page.goto("/buyers");
  const buyer = await page.locator('tbody a[href^="/buyers/"]').first().getAttribute("href");
  await page.goto("/analyzer");
  const analysis = await page.locator('a[href^="/analyzer/"]').first().getAttribute("href");
  const paths = ["/dashboard", "/pipeline", "/reports", "/reports?tab=market", "/alerts", "/review", "/settings?tab=enrichment", `${lead}?tab=calls`, `${lead}?tab=documents`, report!, buyer!, report!.replace("/report", "/comps"), analysis!, `/buyers/match/${analysis!.split("/").pop()}`];
  for (const path of paths) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Application error");
  }
  for (const path of [report!, buyer!]) {
    await page.goto(path);
    await page.getByLabel("Choose files to upload").setInputFiles({ name: "verification.txt", mimeType: "text/plain", buffer: Buffer.from("Local document verification") });
    const row = page.getByRole("row").filter({ hasText: "verification.txt" });
    await expect(row).toBeVisible();
    const downloadUrl = await row.getByRole("link", { name: "Download" }).getAttribute("href");
    const download = await page.request.get(downloadUrl!);
    expect(await download.text()).toBe("Local document verification");
  }
  await page.goto(report!.replace("/report", "/comps"));
  await page.getByRole("button", { name: "Add a comp", exact: true }).click();
  await page.getByLabel("Address", { exact: true }).fill("456 Verification Comp");
  await page.getByLabel("Sold price", { exact: true }).fill("250000");
  await page.getByRole("button", { name: "Add the comp", exact: true }).click();
  await expect(page.getByRole("button", { name: /^456 Verification Comp/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: /^456 Verification Comp/ })).toBeVisible();
  expect(errors).toEqual([]);
});
