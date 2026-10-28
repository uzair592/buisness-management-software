-- Milestone 09: Authoritative reports and daily cash register reconciliation
-- 1. Add sequential counter for cash sessions
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS cash_session_sequence integer NOT NULL DEFAULT 0;

-- 2. Create cash_sessions table
CREATE TABLE IF NOT EXISTS cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  session_number varchar(32) NOT NULL,
  location_id uuid NOT NULL,
  device_id uuid NOT NULL,
  cash_account_id uuid NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  opened_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  closed_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  opening_float numeric(19, 4) NOT NULL CHECK (opening_float >= 0),
  counted_amount numeric(19, 4) CHECK (counted_amount IS NULL OR counted_amount >= 0),
  expected_amount numeric(19, 4),
  variance_amount numeric(19, 4),
  variance_reason text,
  status varchar(20) NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Closed')),
  closed_watermark_cursor bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  UNIQUE (business_id, session_number),
  FOREIGN KEY (business_id, location_id) REFERENCES locations(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, device_id) REFERENCES device_enrollments(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, cash_account_id) REFERENCES accounts(business_id, id) ON DELETE RESTRICT,
  CONSTRAINT cash_session_closed_state CHECK (
    (status = 'Open' AND closed_at IS NULL AND counted_amount IS NULL AND expected_amount IS NULL AND variance_amount IS NULL AND closed_by_user_id IS NULL)
    OR (status = 'Closed' AND closed_at IS NOT NULL AND counted_amount IS NOT NULL AND expected_amount IS NOT NULL AND variance_amount IS NOT NULL AND closed_by_user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS cash_sessions_loc_status ON cash_sessions (business_id, location_id, status);
CREATE INDEX IF NOT EXISTS cash_sessions_acc_status ON cash_sessions (business_id, cash_account_id, status);

-- 3. Row Level Security & Permissions
ALTER TABLE cash_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_sessions FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'cash_sessions' AND policyname = 'tenant_scope'
  ) THEN
    CREATE POLICY tenant_scope ON cash_sessions FOR ALL
      USING (current_setting('app.bypass_rls', true) = 'true' OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid)
      WITH CHECK (current_setting('app.bypass_rls', true) = 'true' OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON cash_sessions TO bms_runtime;
