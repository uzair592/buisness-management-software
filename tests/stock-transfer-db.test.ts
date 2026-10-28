import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { createDatabase, withTenantContext } from "../packages/db/src/index";

test("M12 stock transfers: dispatch, partial receipt, transit loss with reason, location scoping and multi-tenant isolation", async (t) => {
  const adminUrl = process.env.DATABASE_URL ?? "postgresql://bms_local:bms_local@127.0.0.1:5432/bms";
  const runtimeUrl = new URL(adminUrl);
  runtimeUrl.username = process.env.BMS_RUNTIME_USER ?? "bms_runtime";
  runtimeUrl.password = process.env.BMS_RUNTIME_PASSWORD ?? "bms_runtime_pass_change_in_production";
  const db = createDatabase(runtimeUrl.toString());
  const app = createApp({ db });
  t.after(async () => {
    await app.close();
    await db.$disconnect();
  });

  const suffix = crypto.randomUUID().slice(0, 8);
  async function register(name: string) {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        username: `transfer_${name}_${suffix}`,
        password: "CorrectBatteryHorse123!",
        fullName: "Owner",
        businessName: name,
      },
    });
    assert.equal(res.statusCode, 201, res.body);
    return {
      id: res.json().business.id as string,
      userId: res.json().user.id as string,
      csrf: res.json().csrfToken as string,
      cookie: (res.headers["set-cookie"] as string[]).map((v) => v.split(";")[0]).join("; "),
    };
  }

  const owner = await register("TransferBizA");
  const other = await register("TransferBizB");

  const send = (actor: typeof owner, method: "GET" | "POST", url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { cookie: actor.cookie, "x-csrf-token": actor.csrf },
      ...(payload ? { payload } : {}),
    });

  // Setup system accounts
  const system = await send(owner, "POST", "/v1/accounts/system");
  assert.equal(system.statusCode, 200, system.body);

  // Setup catalogue: Item & Base Unit
  const unitRes = await send(owner, "POST", "/v1/catalogue/units", { code: "BTL", name: "Bottles" });
  assert.equal(unitRes.statusCode, 201, unitRes.body);

  const itemRes = await send(owner, "POST", "/v1/catalogue/items", {
    name: "Mineral Water 1.5L",
    kind: "Goods",
    baseUnitId: unitRes.json().id,
    salePrice: "30.00",
  });
  assert.equal(itemRes.statusCode, 201, itemRes.body);
  const itemId = itemRes.json().id as string;

  // Locations: primary and secondary warehouse
  const locListRes = await send(owner, "GET", "/v1/locations");
  assert.equal(locListRes.statusCode, 200, locListRes.body);
  const sourceLocationId = locListRes.json()[0].id as string;

  // Create a second warehouse location in Business A
  const warehouse2 = await withTenantContext(db, { businessId: owner.id, userId: owner.userId }, async (tx) =>
    tx.location.create({
      data: {
        businessId: owner.id,
        code: "WH2",
        name: "North Hub Warehouse",
      },
    }),
  );
  const destinationLocationId = warehouse2.id;

  // Add opening stock of 100 bottles at source location
  const openingRes = await send(owner, "POST", "/v1/opening/preview", {
    batchId: crypto.randomUUID(),
    businessDate: "2026-10-28",
    entries: [{ kind: "Stock", locationId: sourceLocationId, itemId, quantity: "100", value: "2000.00" }],
  });
  assert.equal(openingRes.statusCode, 200, openingRes.body);
  const commitRes = await send(owner, "POST", "/v1/opening/commit", {
    batchId: crypto.randomUUID(),
    businessDate: "2026-10-28",
    expectedCursor: openingRes.json().expectedCursor,
    entries: [{ kind: "Stock", locationId: sourceLocationId, itemId, quantity: "100", value: "2000.00" }],
  });
  assert.equal(commitRes.statusCode, 201, commitRes.body);

  // 1. DISPATCH TRANSFER: Send 40 bottles from source to destination
  const dispatchRes = await send(owner, "POST", "/v1/stock/transfers/dispatch", {
    sourceLocationId,
    destinationLocationId,
    notes: "Inter-branch restocking",
    lines: [
      { itemId, quantity: "40" },
    ],
  });
  assert.equal(dispatchRes.statusCode, 201, dispatchRes.body);
  const transfer = dispatchRes.json();
  assert.equal(transfer.number, "TR-000001");
  assert.equal(transfer.status, "Dispatched");
  assert.equal(transfer.lines.length, 1);
  const transferLineId = transfer.lines[0].id as string;

  // Verify stock at source location has decreased by 40 (100 - 40 = 60 remaining)
  const sourceMovements = await withTenantContext(db, { businessId: owner.id, userId: owner.userId }, async (tx) =>
    tx.stockMovement.findMany({ where: { businessId: owner.id, itemId, locationId: sourceLocationId } }),
  );
  const sourceQty = sourceMovements.reduce((sum, m) => sum + Number(m.quantityDelta), 0);
  assert.equal(sourceQty, 60, "Source stock must decrease by dispatched quantity");

  // Verify destination stock is still 0 (goods are in transit)
  const destMovementsBefore = await withTenantContext(db, { businessId: owner.id, userId: owner.userId }, async (tx) =>
    tx.stockMovement.findMany({ where: { businessId: owner.id, itemId, locationId: destinationLocationId } }),
  );
  const destQtyBefore = destMovementsBefore.reduce((sum, m) => sum + Number(m.quantityDelta), 0);
  assert.equal(destQtyBefore, 0, "Destination stock must remain zero while in transit");

  // 2. REJECT INSUFFICIENT STOCK DISPATCH
  const overDispatchRes = await send(owner, "POST", "/v1/stock/transfers/dispatch", {
    sourceLocationId,
    destinationLocationId,
    lines: [
      { itemId, quantity: "100" }, // Only 60 left
    ],
  });
  assert.equal(overDispatchRes.statusCode, 409, overDispatchRes.body);

  // 3. PARTIAL RECEIPT: Destination receives 30 bottles
  const receive1Res = await send(owner, "POST", `/v1/stock/transfers/${transfer.id}/receive`, {
    lines: [
      { lineId: transferLineId, receivedQuantity: "30" },
    ],
  });
  assert.equal(receive1Res.statusCode, 200, receive1Res.body);
  assert.equal(receive1Res.json().status, "PartiallyReceived");
  assert.equal(Number(receive1Res.json().lines[0].receivedQuantity), 30);

  // Destination stock is now 30
  const destMovementsAfter1 = await withTenantContext(db, { businessId: owner.id, userId: owner.userId }, async (tx) =>
    tx.stockMovement.findMany({ where: { businessId: owner.id, itemId, locationId: destinationLocationId } }),
  );
  const destQtyAfter1 = destMovementsAfter1.reduce((sum, m) => sum + Number(m.quantityDelta), 0);
  assert.equal(destQtyAfter1, 30, "Destination stock must increase by received quantity");

  // 4. TRANSIT LOSS WITHOUT REASON IS REJECTED
  const lossWithoutReason = await send(owner, "POST", `/v1/stock/transfers/${transfer.id}/receive`, {
    lines: [
      { lineId: transferLineId, receivedQuantity: "8", lossQuantity: "2" }, // Missing lossReason
    ],
  });
  assert.equal(lossWithoutReason.statusCode, 409, lossWithoutReason.body);

  // 5. RECEIVE REMAINDER WITH APPROVED LOSS: 8 bottles received, 2 bottles broken with reason
  const receive2Res = await send(owner, "POST", `/v1/stock/transfers/${transfer.id}/receive`, {
    lines: [
      { lineId: transferLineId, receivedQuantity: "8", lossQuantity: "2", lossReason: "Bottles broken in transit by rough roads" },
    ],
  });
  assert.equal(receive2Res.statusCode, 200, receive2Res.body);
  assert.equal(receive2Res.json().status, "Completed");
  assert.equal(Number(receive2Res.json().lines[0].receivedQuantity), 38);
  assert.equal(Number(receive2Res.json().lines[0].lossQuantity), 2);

  // Destination total received stock is now 38
  const destMovementsAfter2 = await withTenantContext(db, { businessId: owner.id, userId: owner.userId }, async (tx) =>
    tx.stockMovement.findMany({
      where: {
        businessId: owner.id,
        itemId,
        locationId: destinationLocationId,
        movementKind: "TransferReceive",
      },
    }),
  );
  const destQtyFinal = destMovementsAfter2.reduce((sum, m) => sum + Number(m.quantityDelta), 0);
  assert.equal(destQtyFinal, 38, "Destination received stock must equal 38");

  // 6. MULTI-TENANT ISOLATION: Business B cannot access or receive Business A's transfer
  const foreignGet = await send(other, "GET", `/v1/stock/transfers/${transfer.id}`);
  assert.equal(foreignGet.statusCode, 404);

  const foreignReceive = await send(other, "POST", `/v1/stock/transfers/${transfer.id}/receive`, {
    lines: [{ lineId: transferLineId, receivedQuantity: "1" }],
  });
  assert.equal(foreignReceive.statusCode, 409);
});
