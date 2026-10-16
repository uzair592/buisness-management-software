-- Fix locations RLS policy so members can read location names for their businesses under bms_runtime
DROP POLICY IF EXISTS tenant_isolation_locations ON locations;
CREATE POLICY tenant_isolation_locations ON locations
  FOR ALL
  USING (
    current_setting('app.bypass_rls', true) = 'true'
    OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
    OR business_id IN (
      SELECT m.business_id FROM memberships m
      WHERE m.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'true'
    OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid
  );

-- Dynamically grant connect on current database to bms_runtime without hardcoded database name
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO bms_runtime', current_database());
END
$$;

-- Ensure bms_runtime has proper schema and table access
GRANT USAGE ON SCHEMA public TO bms_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bms_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bms_runtime;
