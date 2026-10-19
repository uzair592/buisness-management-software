import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { createDatabase, withTenantContext } from "../packages/db/src/index";
import { hashPassword } from "../apps/api/src/auth/password";

test("M04 catalogue persists, isolates tenants, enforces versions and sellable reads", async (t) => {
  const adminUrl = process.env.DATABASE_URL ?? "postgresql://bms_local:bms_local@127.0.0.1:5432/bms";
  const runtimeUrl = new URL(adminUrl);
  runtimeUrl.username = process.env.BMS_RUNTIME_USER ?? "bms_runtime";
  runtimeUrl.password = process.env.BMS_RUNTIME_PASSWORD ?? "bms_runtime_pass_change_in_production";
  const admin = createDatabase(adminUrl);
  const db = createDatabase(runtimeUrl.toString());
  const app = createApp({ db });
  t.after(async () => { await app.close(); await db.$disconnect(); await admin.$disconnect(); });
  const unique = crypto.randomUUID().slice(0, 8);

  async function register(businessName: string) {
    const response = await app.inject({ method: "POST", url: "/v1/auth/register", payload: {
      username: `m04_${businessName}_${unique}`, password: "CorrectBatteryHorse123!",
      fullName: "Owner", businessName,
    } });
    assert.equal(response.statusCode, 201, response.body);
    const body = response.json();
    const cookie = (response.headers["set-cookie"] as string[]).map((value) => value.split(";")[0]).join("; ");
    return { id: body.business.id as string, cookie, csrf: body.csrfToken as string };
  }
  const a = await register("A");
  const b = await register("B");
  const send = async (actor: typeof a, method: "GET" | "POST" | "PATCH", url: string, payload?: Record<string, unknown>) =>
    await app.inject({
      method, url, headers: { cookie: actor.cookie, "x-csrf-token": actor.csrf },
      ...(payload ? { payload } : {}),
    });

  const cat = await send(a, "POST", "/v1/catalogue/categories", { name: "Beverages" });
  assert.equal(cat.statusCode, 201, cat.body);
  const unit = await send(a, "POST", "/v1/catalogue/units", { code: "EA", name: "Each" });
  assert.equal(unit.statusCode, 201, unit.body);
  const box = await send(a, "POST", "/v1/catalogue/units", { code: "BOX", name: "Box" });
  assert.equal(box.statusCode, 201, box.body);
  const tax = await send(a, "POST", "/v1/catalogue/tax-profiles", { name: "Generic 10", rate: "10.0000", mode: "Exclusive" });
  assert.equal(tax.statusCode, 201, tax.body);
  const itemData = { name: "Water", kind: "Goods", categoryId: cat.json().id,
    baseUnitId: unit.json().id, taxProfileId: tax.json().id,
    sku: "WATER", barcode: "123456", salePrice: "110.00" };
  const item = await send(a, "POST", "/v1/catalogue/items", itemData);
  assert.equal(item.statusCode, 201, item.body);
  assert.equal(item.json().salePrice, "110");
  const duplicate = await send(a, "POST", "/v1/catalogue/items", { ...itemData, sku: "WATER2" });
  assert.equal(duplicate.statusCode, 409, duplicate.body);
  const conversion = await send(a, "POST", "/v1/catalogue/conversions", {
    itemId: item.json().id, unitId: box.json().id, factor: "12.000000",
  });
  assert.equal(conversion.statusCode, 201, conversion.body);
  assert.equal(conversion.json().factor, "12");
  const wrongUnit = await send(b, "POST", "/v1/catalogue/units", { code: "EA", name: "Each" });
  assert.equal(wrongUnit.statusCode, 201, wrongUnit.body);
  const crossTenant = await send(b, "POST", "/v1/catalogue/items", { ...itemData, baseUnitId: unit.json().id });
  assert.equal(crossTenant.statusCode, 400, crossTenant.body);
  const sameBarcodeOtherBusiness = await send(b, "POST", "/v1/catalogue/items", {
    ...itemData, categoryId: null, taxProfileId: null, baseUnitId: wrongUnit.json().id,
  });
  assert.equal(sameBarcodeOtherBusiness.statusCode, 201, sameBarcodeOtherBusiness.body);

  const updated = await send(a, "PATCH", `/v1/catalogue/items/${item.json().id}`, {
    ...itemData, name: "Mineral Water", expectedVersion: 1,
  });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().version, 2);
  const stale = await send(a, "PATCH", `/v1/catalogue/items/${item.json().id}`, {
    ...itemData, name: "Overwritten", expectedVersion: 1,
  });
  assert.equal(stale.statusCode, 409, stale.body);
  const partyData = { name: "Local Trader", isCustomer: true, isSupplier: true, phone: null, email: null };
  const party = await send(a, "POST", "/v1/catalogue/parties", partyData);
  assert.equal(party.statusCode, 201, party.body);
  assert.equal(party.json().isSupplier, true);
  assert.equal((await send(b, "GET", "/v1/catalogue/parties")).json().rows.length, 0);
  const archived = await send(a, "PATCH", `/v1/catalogue/parties/${party.json().id}`, {
    ...partyData, expectedVersion: 1, archive: true,
  });
  assert.equal(archived.statusCode, 200, archived.body);
  assert.equal((await send(a, "GET", "/v1/catalogue/parties")).json().rows.length, 0);

  const expenseCategory = await send(a, "POST", "/v1/accounts/expense-categories", { name: "Utilities" });
  assert.equal(expenseCategory.statusCode, 201, expenseCategory.body);
  const badExpense = await send(b, "POST", "/v1/accounts", { code: "EXP", name: "Electricity", kind: "Expense", expenseCategoryId: expenseCategory.json().id });
  assert.equal(badExpense.statusCode, 400, badExpense.body);
  const expense = await send(a, "POST", "/v1/accounts", { code: "EXP", name: "Electricity", kind: "Expense", expenseCategoryId: expenseCategory.json().id });
  assert.equal(expense.statusCode, 201, expense.body);
  const cash = await send(a, "POST", "/v1/accounts", { code: "CASH", name: "Till", kind: "Cash" });
  assert.equal(cash.statusCode, 201, cash.body);
  assert.equal(cash.json().classification, "Asset");
  assert.equal((await send(a, "POST", "/v1/accounts", { code: "CASH", name: "Other till", kind: "Cash" })).statusCode, 409);
  assert.equal((await send(a, "POST", "/v1/accounts", { code: "BANK", name: "Bank", kind: "Bank", balance: "500" })).statusCode, 400);
  const bank = await send(a, "POST", "/v1/accounts", { code: "BANK", name: "Bank", kind: "Bank" });
  assert.equal(bank.statusCode, 201, bank.body);
  const renamed = await send(a, "PATCH", `/v1/accounts/${cash.json().id}`, { name: "Main till", expectedVersion: 1 });
  assert.equal(renamed.statusCode, 200, renamed.body);
  assert.equal(renamed.json().version, 2);
  assert.equal((await send(a, "PATCH", `/v1/accounts/${cash.json().id}`, { name: "Stale", expectedVersion: 1 })).statusCode, 409);
  assert.equal((await send(b, "PATCH", `/v1/accounts/${cash.json().id}`, { name: "Cross tenant", expectedVersion: 2 })).statusCode, 409);
  assert.equal((await send(b, "GET", "/v1/accounts/setup")).json().accounts.length, 0);

  const cashierId = crypto.randomUUID();
  const cashierMembershipId = crypto.randomUUID();
  const cashierDeviceId = crypto.randomUUID();
  const locationId = (await send(a, "GET", "/v1/locations")).json()[0].id as string;
  await withTenantContext(admin, { bypassRls: true }, async (tx) => {
    await tx.user.create({ data: { id: cashierId, username: `cashier_${unique}`,
      passwordHash: await hashPassword("CashierPassword123!"), fullName: "Cashier" } });
    await tx.membership.create({ data: { id: cashierMembershipId, businessId: a.id, userId: cashierId, role: "Cashier" } });
    await tx.devicePrefixRegistry.create({ data: { businessId: a.id, numberPrefix: "D98" } });
    await tx.deviceEnrollment.create({ data: { id: cashierDeviceId, businessId: a.id, membershipId: cashierMembershipId,
      locationId, deviceName: "Cashier catalogue test", numberPrefix: "D98", status: "Enrolled" } });
  });
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: {
    username: `cashier_${unique}`, password: "CashierPassword123!",
  } });
  assert.equal(login.statusCode, 200, login.body);
  const cashier = { id: a.id, cookie: (login.headers["set-cookie"] as string[])
    .map((value) => value.split(";")[0]).join("; "), csrf: login.json().csrfToken as string };
  const sellable = await send(cashier, "GET", "/v1/catalogue/items?q=mineral");
  assert.equal(sellable.statusCode, 200, sellable.body);
  assert.equal(sellable.json().rows.length, 1);
  assert.ok(!/cost|profit|passwordHash/i.test(JSON.stringify(sellable.json())));
  assert.equal((await send(cashier, "POST", "/v1/catalogue/parties", partyData)).statusCode, 403);
  assert.equal((await send(cashier, "GET", "/v1/accounts/setup")).statusCode, 403);
  assert.equal((await send(cashier, "POST", "/v1/accounts", { code: "BAD", name: "Bad", kind: "Cash" })).statusCode, 403);
  const cashierBootstrap = await send(cashier, "GET", `/v1/sync/bootstrap?deviceEnrollmentId=${cashierDeviceId}`);
  assert.equal(cashierBootstrap.statusCode, 200, cashierBootstrap.body);
  assert.equal(cashierBootstrap.json().catalogue.accountSetup, null);
  assert.ok(cashierBootstrap.json().catalogue.items.some((row: { id: string }) => row.id === item.json().id));
  assert.ok(!/Electricity|expenseCategory|classification|cost|profit/i.test(JSON.stringify(cashierBootstrap.json().catalogue)));
  assert.ok(cashierBootstrap.json().catalogue.cashAccounts.every((row: Record<string, unknown>) =>
    Object.keys(row).every((key) => ["id", "name", "kind"].includes(key)) && row.kind === "Cash"));

  const provisional = { commandId: crypto.randomUUID(), provisionalPartyId: crypto.randomUUID(),
    deviceEnrollmentId: cashierDeviceId, datasetEpoch: cashierBootstrap.json().business.datasetEpoch,
    name: "Counter customer", isCustomer: true, isSupplier: false };
  const [accepted, repeated] = await Promise.all([
    send(cashier, "POST", "/v1/catalogue/parties/provisional", provisional),
    send(cashier, "POST", "/v1/catalogue/parties/provisional", provisional),
  ]);
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.equal(repeated.statusCode, 200, repeated.body);
  assert.deepEqual(repeated.json(), accepted.json());
  assert.equal(accepted.json().partyId, provisional.provisionalPartyId);
  assert.equal((await send(cashier, "POST", "/v1/catalogue/parties/provisional",
    { ...provisional, name: "Changed retry" })).statusCode, 409);
  assert.equal((await send(b, "POST", "/v1/catalogue/parties/provisional", provisional)).statusCode, 409);
  assert.equal((await send(cashier, "POST", "/v1/catalogue/parties/provisional",
    { ...provisional, commandId: crypto.randomUUID(), deviceEnrollmentId: crypto.randomUUID() })).statusCode, 409);
  const persisted = await withTenantContext(db, { businessId: a.id }, async (tx) => ({
    parties: await tx.party.count({ where: { id: provisional.provisionalPartyId } }),
    receipts: await tx.commandReceipt.count({ where: { commandId: provisional.commandId } }),
    changes: await tx.changeBatch.count({ where: { payload: { path: ["id"], equals: provisional.provisionalPartyId } } }),
  }));
  assert.deepEqual(persisted, { parties: 1, receipts: 1, changes: 1 });

  const locations = await send(a, "GET", "/v1/locations");
  const enrolled = await send(a, "POST", "/v1/devices/enroll", { deviceName: "Catalogue test", locationId: locations.json()[0].id });
  assert.equal(enrolled.statusCode, 201, enrolled.body);
  const bootstrap = await send(a, "GET", `/v1/sync/bootstrap?deviceEnrollmentId=${enrolled.json().id}`);
  assert.equal(bootstrap.statusCode, 200, bootstrap.body);
  assert.ok(bootstrap.json().catalogue.items.some((row: { id: string }) => row.id === item.json().id));
  assert.ok(bootstrap.json().catalogue.accountSetup.accounts.some((row: { id: string }) => row.id === cash.json().id));
  assert.ok(!/passwordHash|cost|profit/i.test(JSON.stringify(bootstrap.json().catalogue)));
  assert.match(bootstrap.json().syncCursor, /^\d+$/);
  const pullParty = await send(a, "POST", "/v1/catalogue/parties", {
    ...partyData, name: "New customer after bootstrap",
  });
  assert.equal(pullParty.statusCode, 201, pullParty.body);
  const pullAccount = await send(a, "POST", "/v1/accounts", { code: "PETTY", name: "Petty cash", kind: "Cash" });
  assert.equal(pullAccount.statusCode, 201, pullAccount.body);
  const ownerPull = await send(a, "GET", `/v1/sync/pull?deviceEnrollmentId=${enrolled.json().id}&afterCursor=${bootstrap.json().syncCursor}`);
  assert.equal(ownerPull.statusCode, 200, ownerPull.body);
  assert.ok(ownerPull.json().changes.some((change: { action: string; row: { id: string } }) => change.action === "party.create" && change.row.id === pullParty.json().id));
  assert.ok(ownerPull.json().changes.some((change: { action: string; row: { id: string } }) => change.action === "account.create" && change.row.id === pullAccount.json().id));
  const cashierPull = await send(cashier, "GET", `/v1/sync/pull?deviceEnrollmentId=${cashierDeviceId}&afterCursor=${cashierBootstrap.json().syncCursor}&limit=1`);
  assert.equal(cashierPull.statusCode, 200, cashierPull.body);
  let cursor = cashierPull.json().nextCursor as string;
  const permitted = [...cashierPull.json().changes] as Array<{ action: string; row: { id: string } }>;
  while (cashierPull.json().committedCursor !== cursor) {
    const page = await send(cashier, "GET", `/v1/sync/pull?deviceEnrollmentId=${cashierDeviceId}&afterCursor=${cursor}&limit=1`);
    assert.equal(page.statusCode, 200, page.body);
    assert.notEqual(page.json().nextCursor, cursor);
    permitted.push(...page.json().changes);
    cursor = page.json().nextCursor;
  }
  assert.ok(permitted.some((change) => change.action === "party.create" && change.row.id === pullParty.json().id));
  const cashierTill = permitted.find((change) => change.action === "account.create" && change.row.id === pullAccount.json().id);
  assert.ok(cashierTill);
  assert.ok(Object.keys(cashierTill.row).every((key) => ["id", "name", "kind", "archivedAt"].includes(key)));
  assert.ok(!/classification|expenseCategory|cost|profit/i.test(JSON.stringify(permitted)));
  assert.equal((await send(b, "GET", `/v1/sync/pull?deviceEnrollmentId=${cashierDeviceId}&afterCursor=0`)).statusCode, 403);

  const reloaded = await send(a, "GET", "/v1/catalogue/items?q=Mineral&page=1");
  assert.equal(reloaded.statusCode, 200, reloaded.body);
  assert.equal(reloaded.json().rows[0].version, 2);
  for (let index = 0; index < 27; index++) {
    const created = await send(a, "POST", "/v1/catalogue/items", {
      ...itemData, name: `Setup stock ${String(index).padStart(2, "0")}`,
      sku: `SETUP-${index}`, barcode: `SETUP-BARCODE-${index}`,
    });
    assert.equal(created.statusCode, 201, created.body);
  }
  const choices = await send(a, "GET", "/v1/catalogue/choices?kind=items&role=Stock&q=Setup%20stock&page=1");
  assert.equal(choices.statusCode, 200, choices.body);
  assert.equal(choices.json().rows.length, 25);
  assert.equal(choices.json().hasMore, true);
  const secondPage = await send(a, "GET", "/v1/catalogue/choices?kind=items&role=Stock&q=Setup%20stock&page=2");
  assert.equal(secondPage.json().rows.length, 2);
  assert.equal(secondPage.json().hasMore, false);
  assert.equal((await send(b, "GET", "/v1/catalogue/choices?kind=items&role=Stock&q=Setup%20stock&page=1")).json().rows.length, 0);
  assert.equal((await send(a, "GET", "/v1/catalogue/choices?kind=items&role=Payable")).statusCode, 400);
  const dueChoices = await send(a, "GET", "/v1/catalogue/choices?kind=parties&role=Receivable&q=Local");
  assert.equal(dueChoices.statusCode, 200, dueChoices.body);
  assert.equal(dueChoices.json().rows.length, 0); // archived parties are excluded
  const categoryEdit = await send(a, "PATCH", `/v1/catalogue/categories/${cat.json().id}`,
    { name: "Drinks", expectedVersion: 1 });
  assert.equal(categoryEdit.statusCode, 200, categoryEdit.body);
  assert.equal(categoryEdit.json().version, 2);
  assert.equal((await send(a, "PATCH", `/v1/catalogue/categories/${cat.json().id}`,
    { name: "Stale", expectedVersion: 1 })).statusCode, 409);
  assert.equal((await send(b, "PATCH", `/v1/catalogue/categories/${cat.json().id}`,
    { name: "Other tenant", expectedVersion: 2 })).statusCode, 409);
  const taxEdit = await send(a, "PATCH", `/v1/catalogue/tax-profiles/${tax.json().id}`,
    { name: "Generic 5", rate: "5.0000", mode: "Inclusive", expectedVersion: 1 });
  assert.equal(taxEdit.statusCode, 200, taxEdit.body);
  const unitEdit = await send(a, "PATCH", `/v1/catalogue/units/${box.json().id}`,
    { name: "Carton", expectedVersion: 1 });
  assert.equal(unitEdit.statusCode, 200, unitEdit.body);
  const factorEdit = await send(a, "PATCH", `/v1/catalogue/conversions/${conversion.json().id}`,
    { factor: "24.000000", expectedVersion: 1 });
  assert.equal(factorEdit.statusCode, 200, factorEdit.body);
  assert.equal((await send(a, "GET", `/v1/catalogue/conversions?itemId=${item.json().id}`)).json().rows[0].factor, "24");
  const archiveConversion = await send(a, "PATCH", `/v1/catalogue/conversions/${conversion.json().id}`,
    { factor: "24", expectedVersion: 2, archive: true });
  assert.equal(archiveConversion.statusCode, 200, archiveConversion.body);
  assert.equal((await send(a, "GET", `/v1/catalogue/conversions?itemId=${item.json().id}`)).json().rows.length, 0);
  const pullSetup = await send(a, "GET", `/v1/sync/pull?deviceEnrollmentId=${enrolled.json().id}&afterCursor=${ownerPull.json().nextCursor}`);
  assert.equal(pullSetup.statusCode, 200, pullSetup.body);
  assert.ok(pullSetup.json().changes.some((change: { action: string; row: { id: string; version: number } }) =>
    change.action === "category.edit" && change.row.id === cat.json().id && change.row.version === 2));
  const archiveCategory = await send(a, "PATCH", `/v1/catalogue/categories/${cat.json().id}`,
    { name: "Drinks", expectedVersion: 2, archive: true });
  assert.equal(archiveCategory.statusCode, 200, archiveCategory.body);
  assert.equal((await send(a, "GET", "/v1/catalogue/setup")).json().categories.some((row: { id: string }) => row.id === cat.json().id), false);
  const retainedItem = await withTenantContext(db, { businessId: a.id }, async (tx) =>
    tx.item.findUniqueOrThrow({ where: { id: item.json().id }, include: { category: true } }));
  assert.equal(retainedItem.category?.name, "Drinks");
  const changes = await withTenantContext(db, { businessId: a.id }, async (tx) =>
    tx.changeBatch.findMany({ where: { businessId: a.id }, orderBy: { cursor: "asc" } }));
  assert.ok(changes.length >= 16);
  assert.deepEqual(changes.map((value) => value.cursor.toString()),
    Array.from({ length: changes.length }, (_, i) => String(i + 1)));
});
