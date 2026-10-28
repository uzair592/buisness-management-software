import crypto from "node:crypto";
import type { Prisma } from "@business/db";

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

/**
 * Sanitizes fields to prevent Excel/Calc Spreadsheet Formula Injection (CSV Injection).
 * Any field starting with =, +, -, @, \t, or \r is prefixed with a single quote.
 */
export function sanitizeCsvField(val: string): string {
  if (typeof val !== "string") return String(val ?? "");
  const trimmed = val.trim();
  if (/^[=+\-@\t\r]/.test(trimmed)) {
    return `'${val}`;
  }
  return val;
}

/**
 * Basic RFC 4180 compliant CSV parser.
 */
export function parseCsv(text: string): string[][] {
  const lines: string[][] = [];
  let row: string[] = [];
  let inQuotes = false;
  let field = "";

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (c === '"') {
        if (next === '"') {
          field += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field.trim());
        field = "";
      } else if (c === "\r") {
        if (next === "\n") i++;
        row.push(field.trim());
        if (row.some((cell) => cell.length > 0)) lines.push(row);
        row = [];
        field = "";
      } else if (c === "\n") {
        row.push(field.trim());
        if (row.some((cell) => cell.length > 0)) lines.push(row);
        row = [];
        field = "";
      } else {
        field += c;
      }
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    if (row.some((cell) => cell.length > 0)) lines.push(row);
  }

  return lines;
}

export function formatCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const sanitized = sanitizeCsvField(cell);
          if (sanitized.includes(",") || sanitized.includes('"') || sanitized.includes("\n")) {
            return `"${sanitized.replace(/"/g, '""')}"`;
          }
          return sanitized;
        })
        .join(","),
    )
    .join("\r\n");
}

export interface ItemImportRow {
  rowNumber: number;
  name: string;
  sku?: string;
  barcode?: string;
  salePrice: string;
  unitCode?: string;
  categoryName?: string;
}

export interface RowError {
  row: number;
  field: string;
  message: string;
}

export interface ImportDryRunResult<T> {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: RowError[];
  preview: T[];
}

const MONEY_REGEX = /^\d+(?:\.\d{1,2})?$/;

/**
 * Validates item rows from CSV without committing to database.
 */
export async function dryRunImportItems(
  tx: Prisma.TransactionClient,
  businessId: string,
  csvText: string,
): Promise<ImportDryRunResult<ItemImportRow>> {
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    throw new ImportError("CSV file must contain a header row and at least one data row");
  }

  const header = rows[0].map((h) => h.toLowerCase().trim());
  const nameIdx = header.indexOf("name");
  const priceIdx = header.findIndex((h) => h === "price" || h === "saleprice" || h === "rate");
  const skuIdx = header.indexOf("sku");
  const barcodeIdx = header.indexOf("barcode");
  const unitIdx = header.indexOf("unit");
  const catIdx = header.indexOf("category");

  if (nameIdx === -1 || priceIdx === -1) {
    throw new ImportError("CSV header must include at least 'Name' and 'Price' columns");
  }

  const errors: RowError[] = [];
  const preview: ItemImportRow[] = [];

  const existingItems = await tx.item.findMany({
    where: { businessId },
    select: { name: true, sku: true, barcode: true },
  });

  const existingNames = new Set(existingItems.map((i: { name: string }) => i.name.toLowerCase()));
  const existingSkus = new Set(
    existingItems.filter((i: { sku: string | null }) => i.sku).map((i: { sku: string | null }) => i.sku!.toLowerCase()),
  );
  const batchNames = new Set<string>();
  const batchSkus = new Set<string>();

  for (let idx = 1; idx < rows.length; idx++) {
    const r = rows[idx];
    const name = (r[nameIdx] ?? "").trim();
    const price = (r[priceIdx] ?? "").trim();
    const sku = skuIdx !== -1 ? (r[skuIdx] ?? "").trim() : "";
    const barcode = barcodeIdx !== -1 ? (r[barcodeIdx] ?? "").trim() : "";
    const unitCode = unitIdx !== -1 ? (r[unitIdx] ?? "").trim() : "";
    const categoryName = catIdx !== -1 ? (r[catIdx] ?? "").trim() : "";

    if (!name) {
      errors.push({ row: idx + 1, field: "name", message: "Item name is required" });
      continue;
    }

    if (existingNames.has(name.toLowerCase()) || batchNames.has(name.toLowerCase())) {
      errors.push({ row: idx + 1, field: "name", message: `Item with name "${name}" already exists` });
      continue;
    }
    batchNames.add(name.toLowerCase());

    if (!price || !MONEY_REGEX.test(price) || Number(price) < 0) {
      errors.push({ row: idx + 1, field: "price", message: `Invalid price "${price}": must be non-negative decimal with up to 2 decimal places` });
      continue;
    }

    if (sku) {
      if (existingSkus.has(sku.toLowerCase()) || batchSkus.has(sku.toLowerCase())) {
        errors.push({ row: idx + 1, field: "sku", message: `SKU "${sku}" is already in use` });
        continue;
      }
      batchSkus.add(sku.toLowerCase());
    }

    preview.push({
      rowNumber: idx + 1,
      name,
      sku: sku || undefined,
      barcode: barcode || undefined,
      salePrice: price,
      unitCode: unitCode || undefined,
      categoryName: categoryName || undefined,
    });
  }

  return {
    totalRows: rows.length - 1,
    validRows: preview.length,
    invalidRows: errors.length,
    errors,
    preview: preview.slice(0, 50),
  };
}

/**
 * Commits an item import batch idempotently.
 */
export async function commitImportItems(
  tx: Prisma.TransactionClient,
  businessId: string,
  batchId: string,
  items: ItemImportRow[],
): Promise<{ count: number; alreadyCommitted?: boolean }> {
  // Check idempotency via auditEvent or existing batch ID
  const existing = await tx.auditEvent.findFirst({
    where: {
      businessId,
      action: "items.imported",
      details: {
        path: ["batchId"],
        equals: batchId,
      },
    },
  });

  if (existing) {
    return { count: (existing.details as { count?: number }).count ?? 0, alreadyCommitted: true };
  }

  // Resolve or create units and categories as needed
  const defaultUnit = await tx.unit.findFirst({ where: { businessId } });
  const defaultUnitId = defaultUnit?.id ?? null;

  let importedCount = 0;
  for (const item of items) {
    await tx.item.create({
      data: {
        id: crypto.randomUUID(),
        businessId,
        name: item.name,
        sku: item.sku || null,
        barcode: item.barcode || null,
        salePrice: item.salePrice,
        kind: "Goods",
        baseUnitId: defaultUnitId,
      },
    });
    importedCount++;
  }

  await tx.auditEvent.create({
    data: {
      id: crypto.randomUUID(),
      businessId,
      action: "items.imported",
      details: {
        batchId,
        count: importedCount,
        importedAt: new Date().toISOString(),
      },
    },
  });

  return { count: importedCount };
}

export interface PartyImportRow {
  rowNumber: number;
  name: string;
  phone?: string;
  email?: string;
  isCustomer: boolean;
  isSupplier: boolean;
}

/**
 * Validates party rows from CSV.
 */
export async function dryRunImportParties(
  tx: Prisma.TransactionClient,
  businessId: string,
  csvText: string,
): Promise<ImportDryRunResult<PartyImportRow>> {
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    throw new ImportError("CSV file must contain a header row and at least one data row");
  }

  const header = rows[0].map((h) => h.toLowerCase().trim());
  const nameIdx = header.indexOf("name");
  const phoneIdx = header.indexOf("phone");
  const emailIdx = header.indexOf("email");
  const typeIdx = header.indexOf("type");

  if (nameIdx === -1) {
    throw new ImportError("CSV header must include at least 'Name' column");
  }

  const errors: RowError[] = [];
  const preview: PartyImportRow[] = [];

  const existingParties = await tx.party.findMany({
    where: { businessId },
    select: { name: true },
  });
  const existingNames = new Set(existingParties.map((p: { name: string }) => p.name.toLowerCase()));
  const batchNames = new Set<string>();

  for (let idx = 1; idx < rows.length; idx++) {
    const r = rows[idx];
    const name = (r[nameIdx] ?? "").trim();
    const phone = phoneIdx !== -1 ? (r[phoneIdx] ?? "").trim() : "";
    const email = emailIdx !== -1 ? (r[emailIdx] ?? "").trim() : "";
    const type = typeIdx !== -1 ? (r[typeIdx] ?? "").toLowerCase().trim() : "customer";

    if (!name) {
      errors.push({ row: idx + 1, field: "name", message: "Party name is required" });
      continue;
    }

    if (existingNames.has(name.toLowerCase()) || batchNames.has(name.toLowerCase())) {
      errors.push({ row: idx + 1, field: "name", message: `Party with name "${name}" already exists` });
      continue;
    }
    batchNames.add(name.toLowerCase());

    const isCustomer = type === "customer" || type === "both" || type === "";
    const isSupplier = type === "supplier" || type === "both";

    preview.push({
      rowNumber: idx + 1,
      name,
      phone: phone || undefined,
      email: email || undefined,
      isCustomer,
      isSupplier,
    });
  }

  return {
    totalRows: rows.length - 1,
    validRows: preview.length,
    invalidRows: errors.length,
    errors,
    preview: preview.slice(0, 50),
  };
}

/**
 * Commits a party import batch idempotently.
 */
export async function commitImportParties(
  tx: Prisma.TransactionClient,
  businessId: string,
  batchId: string,
  parties: PartyImportRow[],
): Promise<{ count: number; alreadyCommitted?: boolean }> {
  const existing = await tx.auditEvent.findFirst({
    where: {
      businessId,
      action: "parties.imported",
      details: {
        path: ["batchId"],
        equals: batchId,
      },
    },
  });

  if (existing) {
    return { count: (existing.details as { count?: number }).count ?? 0, alreadyCommitted: true };
  }

  let importedCount = 0;
  for (const p of parties) {
    await tx.party.create({
      data: {
        id: crypto.randomUUID(),
        businessId,
        name: p.name,
        phone: p.phone || null,
        email: p.email || null,
        isCustomer: p.isCustomer,
        isSupplier: p.isSupplier,
      },
    });
    importedCount++;
  }

  await tx.auditEvent.create({
    data: {
      id: crypto.randomUUID(),
      businessId,
      action: "parties.imported",
      details: {
        batchId,
        count: importedCount,
        importedAt: new Date().toISOString(),
      },
    },
  });

  return { count: importedCount };
}
