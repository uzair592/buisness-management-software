CREATE TABLE money_transfers (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL,
  source_event_id uuid NOT NULL,
  source_account_id uuid NOT NULL,
  destination_account_id uuid NOT NULL,
  amount numeric(38,2) NOT NULL CHECK (amount > 0),
  reference varchar(120) NOT NULL CHECK (length(trim(reference)) > 0),
  business_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id,id), UNIQUE (business_id,command_id), UNIQUE (business_id,source_event_id),
  CHECK (source_account_id <> destination_account_id),
  FOREIGN KEY (business_id,source_event_id) REFERENCES source_events(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id,source_account_id) REFERENCES accounts(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id,destination_account_id) REFERENCES accounts(business_id,id) ON DELETE RESTRICT
);
CREATE INDEX money_transfers_by_date ON money_transfers (business_id,business_date DESC,id DESC);
ALTER TABLE money_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_transfers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON money_transfers FOR ALL
  USING (current_setting('app.bypass_rls',true) = 'true' OR business_id = NULLIF(current_setting('app.current_business_id',true),'')::uuid)
  WITH CHECK (current_setting('app.bypass_rls',true) = 'true' OR business_id = NULLIF(current_setting('app.current_business_id',true),'')::uuid);
GRANT SELECT, INSERT ON money_transfers TO bms_runtime;
