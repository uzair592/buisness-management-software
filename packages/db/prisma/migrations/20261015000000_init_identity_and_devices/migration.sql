-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" VARCHAR(50) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "email" VARCHAR(255),
    "full_name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "businesses" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'PKR',
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'Asia/Karachi',
    "dataset_epoch" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" VARCHAR(30) NOT NULL,
    "permission_version" INTEGER NOT NULL DEFAULT 1,
    "location_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "selected_business_id" UUID,
    "token_hash" VARCHAR(64) NOT NULL,
    "csrf_token" VARCHAR(64) NOT NULL,
    "user_agent" TEXT,
    "ip_address" VARCHAR(45),
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_enrollments" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "device_name" VARCHAR(100) NOT NULL,
    "number_prefix" VARCHAR(10) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'Enrolled',
    "enrolled_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "device_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_prefix_registry" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "number_prefix" VARCHAR(10) NOT NULL,
    "enrolled_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_prefix_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offline_leases" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "device_enrollment_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "dataset_epoch" INTEGER NOT NULL,
    "policy_version" INTEGER NOT NULL DEFAULT 1,
    "issued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "signature" TEXT NOT NULL,

    CONSTRAINT "offline_leases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "business_id" UUID,
    "user_id" UUID,
    "action" VARCHAR(50) NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "ip_address" VARCHAR(45),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "locations_business_id_id_key" ON "locations"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "locations_business_id_code_key" ON "locations"("business_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_business_id_id_key" ON "memberships"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_business_id_key" ON "memberships"("user_id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_token_hash_idx" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_expires_at_idx" ON "sessions"("user_id", "revoked_at", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "device_enrollments_business_id_id_key" ON "device_enrollments"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "device_enrollments_business_id_number_prefix_key" ON "device_enrollments"("business_id", "number_prefix");

-- CreateIndex
CREATE UNIQUE INDEX "device_prefix_registry_business_id_number_prefix_key" ON "device_prefix_registry"("business_id", "number_prefix");

-- CreateIndex
CREATE UNIQUE INDEX "offline_leases_business_id_id_key" ON "offline_leases"("business_id", "id");

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_business_id_location_id_fkey" FOREIGN KEY ("business_id", "location_id") REFERENCES "locations"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_selected_business_id_fkey" FOREIGN KEY ("selected_business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_enrollments" ADD CONSTRAINT "device_enrollments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_enrollments" ADD CONSTRAINT "device_enrollments_business_id_membership_id_fkey" FOREIGN KEY ("business_id", "membership_id") REFERENCES "memberships"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_enrollments" ADD CONSTRAINT "device_enrollments_business_id_location_id_fkey" FOREIGN KEY ("business_id", "location_id") REFERENCES "locations"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_prefix_registry" ADD CONSTRAINT "device_prefix_registry_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_leases" ADD CONSTRAINT "offline_leases_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_leases" ADD CONSTRAINT "offline_leases_business_id_device_enrollment_id_fkey" FOREIGN KEY ("business_id", "device_enrollment_id") REFERENCES "device_enrollments"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_leases" ADD CONSTRAINT "offline_leases_business_id_membership_id_fkey" FOREIGN KEY ("business_id", "membership_id") REFERENCES "memberships"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Create restricted runtime role for application connections
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bms_runtime') THEN
    CREATE ROLE bms_runtime WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO bms_runtime', current_database());
END
$$;
GRANT USAGE ON SCHEMA public TO bms_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bms_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bms_runtime;

-- Row Level Security
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_prefix_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE offline_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- FORCE RLS for defence in depth
ALTER TABLE businesses FORCE ROW LEVEL SECURITY;
ALTER TABLE locations FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE device_enrollments FORCE ROW LEVEL SECURITY;
ALTER TABLE device_prefix_registry FORCE ROW LEVEL SECURITY;
ALTER TABLE offline_leases FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

-- Tenant Isolation Policies
CREATE POLICY tenant_isolation_businesses ON businesses
  FOR ALL
  USING (
    current_setting('app.bypass_rls', true) = 'true'
    OR id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
    OR id IN (
      SELECT m.business_id FROM memberships m
      WHERE m.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'true'
    OR id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
  );

CREATE POLICY tenant_isolation_locations ON locations
  FOR ALL
  USING (
    current_setting('app.bypass_rls', true) = 'true'
    OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'true'
    OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
  );

CREATE POLICY tenant_isolation_memberships ON memberships
  FOR ALL
  USING (
    current_setting('app.bypass_rls', true) = 'true'
    OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
    OR user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'true'
    OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
  );

CREATE POLICY tenant_isolation_device_enrollments ON device_enrollments
  FOR ALL
  USING (
    current_setting('app.bypass_rls', true) = 'true'
    OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'true'
    OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
  );

CREATE POLICY tenant_isolation_device_prefix_registry ON device_prefix_registry
  FOR ALL
  USING (
    current_setting('app.bypass_rls', true) = 'true'
    OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'true'
    OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
  );

CREATE POLICY tenant_isolation_offline_leases ON offline_leases
  FOR ALL
  USING (
    current_setting('app.bypass_rls', true) = 'true'
    OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'true'
    OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
  );

CREATE POLICY tenant_isolation_audit_events ON audit_events
  FOR ALL
  USING (
    current_setting('app.bypass_rls', true) = 'true'
    OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
    OR (business_id IS NULL AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'true'
    OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
    OR (business_id IS NULL AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  );
