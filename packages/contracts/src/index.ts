import { z } from "zod";

export const healthSchema = z.object({ status: z.enum(["ok", "unavailable"]) });
export type Health = z.infer<typeof healthSchema>;

export const roleSchema = z.enum([
  "Owner",
  "Accountant",
  "Cashier",
  "StockManager",
  "Viewer",
]);
export type Role = z.infer<typeof roleSchema>;

export const ROLE_CAPABILITIES: Record<Role, string[]> = {
  Owner: [
    "business:admin",
    "users:manage",
    "devices:manage",
    "trade:read",
    "trade:write",
    "stock:read",
    "stock:write",
    "accounting:read",
    "accounting:write",
    "reports:view",
    "offline:lease",
  ],
  Accountant: [
    "trade:read",
    "trade:write",
    "accounting:read",
    "accounting:write",
    "reports:view",
    "offline:lease",
  ],
  Cashier: [
    "trade:read",
    "trade:write",
    "stock:read",
    "offline:lease",
  ],
  StockManager: [
    "stock:read",
    "stock:write",
    "trade:read",
  ],
  Viewer: [
    "trade:read",
    "reports:view",
  ],
};

export const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(50, "Username must not exceed 50 characters")
    .regex(/^[a-zA-Z0-9_-]+$/, "Username must contain only letters, numbers, underscores or hyphens"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  fullName: z.string().trim().min(1, "Full name is required").max(100),
  email: z.string().email().optional().nullable().or(z.literal("")),
  businessName: z.string().trim().min(1, "Business name is required").max(100),
  currency: z.string().trim().default("PKR"),
  timezone: z.string().trim().default("Asia/Karachi"),
});
export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.object({
  username: z.string().trim().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
  revokeOtherSessions: z.boolean().default(true),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const selectBusinessSchema = z.object({
  businessId: z.string().uuid("Invalid business UUID"),
});
export type SelectBusinessInput = z.infer<typeof selectBusinessSchema>;

export const sessionUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  fullName: z.string(),
  email: z.string().nullable(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const membershipInfoSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  businessName: z.string(),
  role: roleSchema,
  permissionVersion: z.number(),
  locationId: z.string().uuid().nullable(),
  locationName: z.string().nullable(),
});
export type MembershipInfo = z.infer<typeof membershipInfoSchema>;

export const sessionStateSchema = z.object({
  authenticated: z.boolean(),
  user: sessionUserSchema.nullable(),
  csrfToken: z.string().nullable(),
  selectedBusinessId: z.string().uuid().nullable(),
  activeMembership: membershipInfoSchema.nullable(),
  memberships: z.array(membershipInfoSchema),
});
export type SessionState = z.infer<typeof sessionStateSchema>;

export const enrollDeviceSchema = z.object({
  deviceName: z.string().trim().min(1, "Device name is required").max(100),
  locationId: z.string().uuid("Valid location UUID required"),
  numberPrefix: z.string().trim().max(10).optional(),
});
export type EnrollDeviceInput = z.infer<typeof enrollDeviceSchema>;

export const deviceStatusSchema = z.enum(["Pending", "Enrolled", "Revoked"]);
export type DeviceStatus = z.infer<typeof deviceStatusSchema>;

export const deviceEnrollmentSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  membershipId: z.string().uuid(),
  locationId: z.string().uuid(),
  deviceName: z.string(),
  numberPrefix: z.string(),
  status: deviceStatusSchema,
  enrolledAt: z.string(),
  revokedAt: z.string().nullable(),
});
export type DeviceEnrollment = z.infer<typeof deviceEnrollmentSchema>;

export const revokeDeviceSchema = z.object({
  deviceEnrollmentId: z.string().uuid("Valid device enrollment UUID required"),
  reason: z.string().optional(),
});
export type RevokeDeviceInput = z.infer<typeof revokeDeviceSchema>;

export const offlineLeaseSchema = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid(),
  deviceEnrollmentId: z.string().uuid(),
  membershipId: z.string().uuid(),
  datasetEpoch: z.number(),
  policyVersion: z.number(),
  issuedAt: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  signature: z.string(),
});
export type OfflineLease = z.infer<typeof offlineLeaseSchema>;

export const requestLeaseSchema = z.object({
  deviceEnrollmentId: z.string().uuid(),
});
export type RequestLeaseInput = z.infer<typeof requestLeaseSchema>;

export const locationSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
});
export type LocationSummary = z.infer<typeof locationSchema>;

export const identityBootstrapSchema = z.object({
  business: z.object({
    id: z.string().uuid(),
    name: z.string(),
    currency: z.string(),
    timezone: z.string(),
    datasetEpoch: z.number(),
  }),
  membership: membershipInfoSchema,
  device: deviceEnrollmentSchema,
  lease: offlineLeaseSchema,
  permittedLocations: z.array(locationSchema),
  rolePermissions: z.object({
    role: roleSchema,
    capabilities: z.array(z.string()),
  }),
});
export type IdentityBootstrap = z.infer<typeof identityBootstrapSchema>;


export const paymentKindSchema = z.enum(["PaymentIn", "PaymentOut"]);
export type PaymentKind = z.infer<typeof paymentKindSchema>;

export const paymentStatusSchema = z.enum(["Draft", "Posted"]);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const paymentAllocationInputSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  allocatedAmount: z.string().regex(/^(?!0+(?:\.0+)?$)\d{1,30}(?:\.\d{1,2})?$/),
});
export type PaymentAllocationInput = z.infer<typeof paymentAllocationInputSchema>;

export const createPaymentInputSchema = z.object({
  id: z.string().uuid(),
  commandId: z.string().uuid(),
  partyId: z.string().uuid(),
  accountId: z.string().uuid(),
  paymentKind: paymentKindSchema,
  amount: z.string().regex(/^(?!0+(?:\.0+)?$)\d{1,30}(?:\.\d{1,2})?$/),
  reference: z.string().trim().max(120).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  allocations: z.array(paymentAllocationInputSchema).default([]),
});
export type CreatePaymentInput = z.infer<typeof createPaymentInputSchema>;

export const paymentSummarySchema = z.object({
  id: z.string().uuid(),
  paymentKind: paymentKindSchema,
  number: z.string().nullable(),
  partyId: z.string().uuid(),
  partyName: z.string().optional(),
  accountId: z.string().uuid(),
  accountName: z.string().optional(),
  amount: z.string(),
  allocatedAmount: z.string(),
  unallocatedAmount: z.string(),
  reference: z.string().nullable(),
  note: z.string().nullable(),
  status: paymentStatusSchema,
  businessDate: z.string(),
  createdAt: z.string(),
  postedAt: z.string().nullable(),
});
export type PaymentSummary = z.infer<typeof paymentSummarySchema>;

export const expenseStatusSchema = z.enum(["Draft", "Posted"]);
export type ExpenseStatus = z.infer<typeof expenseStatusSchema>;

export const createExpenseInputSchema = z.object({
  id: z.string().uuid(),
  commandId: z.string().uuid(),
  expenseCategoryId: z.string().uuid(),
  expenseAccountId: z.string().uuid(),
  paidFromAccountId: z.string().uuid(),
  amount: z.string().regex(/^(?!0+(?:\.0+)?$)\d{1,30}(?:\.\d{1,2})?$/),
  taxAmount: z.string().regex(/^\d{1,30}(?:\.\d{1,2})?$/).default("0.00"),
  reference: z.string().trim().max(120).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type CreateExpenseInput = z.infer<typeof createExpenseInputSchema>;

export const expenseSummarySchema = z.object({
  id: z.string().uuid(),
  number: z.string().nullable(),
  expenseCategoryId: z.string().uuid(),
  categoryName: z.string().optional(),
  expenseAccountId: z.string().uuid(),
  expenseAccountName: z.string().optional(),
  paidFromAccountId: z.string().uuid(),
  paidFromAccountName: z.string().optional(),
  amount: z.string(),
  taxAmount: z.string(),
  reference: z.string().nullable(),
  note: z.string().nullable(),
  status: expenseStatusSchema,
  businessDate: z.string(),
  createdAt: z.string(),
  postedAt: z.string().nullable(),
});
export type ExpenseSummary = z.infer<typeof expenseSummarySchema>;
