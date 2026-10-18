ALTER TABLE device_enrollments ADD COLUMN sale_sequence bigint NOT NULL DEFAULT 0 CHECK (sale_sequence >= 0);

CREATE TABLE sale_documents (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  device_enrollment_id uuid NOT NULL,
  location_id uuid NOT NULL,
  party_id uuid,
  command_id uuid NOT NULL,
  source_event_id uuid,
  number varchar(40),
  status varchar(12) NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Posted')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  snapshot jsonb NOT NULL,
  total numeric(38,2), paid numeric(38,2), due numeric(38,2),
  business_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz,
  UNIQUE (business_id,id), UNIQUE (business_id,command_id), UNIQUE (business_id,number),
  FOREIGN KEY (business_id,device_enrollment_id) REFERENCES device_enrollments(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id,location_id) REFERENCES locations(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id,party_id) REFERENCES parties(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id,source_event_id) REFERENCES source_events(business_id,id) ON DELETE RESTRICT,
  CONSTRAINT sale_posted_complete CHECK ((status = 'Draft' AND number IS NULL AND source_event_id IS NULL AND posted_at IS NULL)
    OR (status = 'Posted' AND number IS NOT NULL AND source_event_id IS NOT NULL AND posted_at IS NOT NULL
      AND total IS NOT NULL AND paid IS NOT NULL AND due IS NOT NULL AND paid + due = total))
);
CREATE INDEX sale_documents_by_date ON sale_documents (business_id,business_date DESC,id DESC);

CREATE TABLE sale_lines (
  id uuid PRIMARY KEY, business_id uuid NOT NULL, sale_id uuid NOT NULL, item_id uuid NOT NULL, snapshot jsonb NOT NULL,
  UNIQUE (business_id,id),
  FOREIGN KEY (business_id,sale_id) REFERENCES sale_documents(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id,item_id) REFERENCES items(business_id,id) ON DELETE RESTRICT
);
CREATE TABLE sale_payments (
  id uuid PRIMARY KEY, business_id uuid NOT NULL, sale_id uuid NOT NULL, account_id uuid NOT NULL,
  kind varchar(8) NOT NULL CHECK (kind IN ('Cash','Bank')),
  applied numeric(38,2) NOT NULL CHECK (applied > 0),
  tendered numeric(38,2), reference varchar(120),
  UNIQUE (business_id,id),
  CONSTRAINT sale_payment_kind CHECK ((kind = 'Cash' AND tendered IS NOT NULL AND tendered >= applied AND reference IS NULL)
    OR (kind = 'Bank' AND tendered IS NULL AND reference IS NOT NULL AND length(trim(reference)) > 0)),
  FOREIGN KEY (business_id,sale_id) REFERENCES sale_documents(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id,account_id) REFERENCES accounts(business_id,id) ON DELETE RESTRICT
);

DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['sale_documents','sale_lines','sale_payments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY tenant_scope ON %I FOR ALL USING (current_setting(''app.bypass_rls'',true) = ''true'' OR business_id = NULLIF(current_setting(''app.current_business_id'',true),'''')::uuid) WITH CHECK (current_setting(''app.bypass_rls'',true) = ''true'' OR business_id = NULLIF(current_setting(''app.current_business_id'',true),'''')::uuid)',table_name);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON sale_documents TO bms_runtime;
GRANT SELECT, INSERT ON sale_lines, sale_payments TO bms_runtime;
