-- One opening batch per business. Corrections must use a linked adjustment or reversal.
CREATE TABLE opening_batches (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  source_event_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id), UNIQUE (business_id,id),
  FOREIGN KEY (business_id,source_event_id) REFERENCES source_events(business_id,id) ON DELETE RESTRICT
);
CREATE TABLE opening_documents (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  party_id uuid NOT NULL,
  reference varchar(120) NOT NULL,
  direction varchar(12) NOT NULL CHECK (direction IN ('Receivable','Payable')),
  amount numeric(38,2) NOT NULL CHECK (amount > 0),
  party_name_snapshot varchar(160) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id,id), UNIQUE (business_id,batch_id,reference,direction),
  FOREIGN KEY (business_id,batch_id) REFERENCES opening_batches(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id,party_id) REFERENCES parties(business_id,id) ON DELETE RESTRICT
);
DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['opening_batches','opening_documents'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY tenant_scope ON %I FOR ALL USING (current_setting(''app.bypass_rls'',true) = ''true'' OR business_id = NULLIF(current_setting(''app.current_business_id'',true),'''')::uuid) WITH CHECK (current_setting(''app.bypass_rls'',true) = ''true'' OR business_id = NULLIF(current_setting(''app.current_business_id'',true),'''')::uuid)',table_name);
  END LOOP;
END $$;
GRANT SELECT, INSERT ON opening_batches, opening_documents TO bms_runtime;
