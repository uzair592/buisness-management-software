-- M03 posting substrate. These records are append-only except the sync head.
CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  code varchar(50) NOT NULL,
  classification varchar(30) NOT NULL CHECK (classification IN ('Asset','Liability','Equity','Income','Expense')),
  name varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id), UNIQUE (business_id, code)
);

CREATE TABLE sync_heads (
  business_id uuid PRIMARY KEY REFERENCES businesses(id) ON DELETE RESTRICT,
  dataset_epoch integer NOT NULL CHECK (dataset_epoch > 0),
  committed_cursor bigint NOT NULL DEFAULT 0 CHECK (committed_cursor >= 0)
);

CREATE TABLE command_receipts (
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  dataset_epoch integer NOT NULL,
  command_id uuid NOT NULL,
  device_enrollment_id uuid,
  payload_hash char(64) NOT NULL,
  outcome varchar(30) NOT NULL,
  canonical_result jsonb NOT NULL,
  cursor bigint NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, dataset_epoch, command_id),
  FOREIGN KEY (business_id, device_enrollment_id) REFERENCES device_enrollments(business_id,id) ON DELETE RESTRICT
);

CREATE TABLE source_events (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL,
  effect_kind varchar(40) NOT NULL,
  business_date date NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id,id), UNIQUE (business_id,command_id,effect_kind)
);

CREATE TABLE journal_entries (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL,
  source_event_id uuid NOT NULL,
  posting_kind varchar(40) NOT NULL,
  business_date date NOT NULL,
  reverses_entry_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id,id), UNIQUE (business_id,source_event_id,posting_kind),
  FOREIGN KEY (business_id,source_event_id) REFERENCES source_events(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id,reverses_entry_id) REFERENCES journal_entries(business_id,id) ON DELETE RESTRICT
);

CREATE TABLE journal_lines (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL,
  journal_entry_id uuid NOT NULL,
  account_id uuid NOT NULL,
  debit numeric(38,2) NOT NULL DEFAULT 0,
  credit numeric(38,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journal_line_one_side CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)),
  FOREIGN KEY (business_id,journal_entry_id) REFERENCES journal_entries(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id,account_id) REFERENCES accounts(business_id,id) ON DELETE RESTRICT
);
CREATE INDEX journal_lines_by_account ON journal_lines(business_id,account_id,created_at);

CREATE TABLE stock_movements (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL,
  source_event_id uuid NOT NULL,
  source_line_id uuid NOT NULL,
  movement_kind varchar(40) NOT NULL,
  leg varchar(20) NOT NULL,
  location_id uuid NOT NULL,
  quantity_delta numeric(38,6) NOT NULL,
  value_delta numeric(38,2) NOT NULL,
  valuation_status varchar(20) NOT NULL CHECK (valuation_status IN ('Resolved','Provisional')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id,source_event_id,source_line_id,movement_kind,leg),
  FOREIGN KEY (business_id,source_event_id) REFERENCES source_events(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id,location_id) REFERENCES locations(business_id,id) ON DELETE RESTRICT
);
CREATE INDEX stock_movements_by_location ON stock_movements(business_id,location_id,created_at);

CREATE TABLE provisional_deficit_costs (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL,
  source_event_id uuid NOT NULL,
  source_line_id uuid NOT NULL,
  quantity_base numeric(38,6) NOT NULL CHECK (quantity_base > 0),
  provisional_value numeric(38,2) NOT NULL CHECK (provisional_value >= 0),
  status varchar(20) NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Resolved')),
  UNIQUE (business_id,source_event_id,source_line_id),
  FOREIGN KEY (business_id,source_event_id) REFERENCES source_events(business_id,id) ON DELETE RESTRICT
);

CREATE TABLE change_batches (
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  dataset_epoch integer NOT NULL,
  cursor bigint NOT NULL,
  source_event_id uuid NOT NULL,
  payload jsonb NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id,dataset_epoch,cursor),
  UNIQUE (business_id,source_event_id),
  FOREIGN KEY (business_id,source_event_id) REFERENCES source_events(business_id,id) ON DELETE RESTRICT
);

-- A constraint trigger sees all lines at COMMIT, including lines inserted later in
-- the same transaction. The entry trigger also rejects an empty journal.
CREATE FUNCTION assert_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entry_id uuid; entry_business uuid; line_count integer; debits numeric; credits numeric;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    entry_id := NEW.id;
    entry_business := NEW.business_id;
  ELSIF TG_OP = 'DELETE' THEN
    entry_id := OLD.journal_entry_id;
    entry_business := OLD.business_id;
  ELSE
    entry_id := NEW.journal_entry_id;
    entry_business := NEW.business_id;
  END IF;
  SELECT count(*), COALESCE(sum(debit),0), COALESCE(sum(credit),0)
    INTO line_count,debits,credits FROM journal_lines
    WHERE business_id = entry_business AND journal_entry_id = entry_id;
  IF line_count < 2 OR debits <> credits OR debits <= 0 THEN
    RAISE EXCEPTION 'Unbalanced journal entry %',entry_id USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_entry_commit_balance AFTER INSERT OR UPDATE ON journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_journal_balanced();
CREATE CONSTRAINT TRIGGER journal_line_commit_balance AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_journal_balanced();

-- Ledger effects are append-only and only the internal posting path can insert.
CREATE FUNCTION require_posting_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Posted business effects are immutable' USING ERRCODE = '23514'; END IF;
  IF current_setting('app.posting_context',true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Use the posting service' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['command_receipts','source_events','journal_entries','journal_lines',
    'stock_movements','provisional_deficit_costs','change_batches'] LOOP
    EXECUTE format('CREATE TRIGGER posting_only BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION require_posting_context()',table_name);
  END LOOP;
END $$;

DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['accounts','sync_heads','command_receipts','source_events',
    'journal_entries','journal_lines','stock_movements','provisional_deficit_costs','change_batches'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY tenant_scope ON %I FOR ALL USING (current_setting(''app.bypass_rls'',true) = ''true'' OR business_id = NULLIF(current_setting(''app.current_business_id'',true),'''')::uuid) WITH CHECK (current_setting(''app.bypass_rls'',true) = ''true'' OR business_id = NULLIF(current_setting(''app.current_business_id'',true),'''')::uuid)',table_name);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bms_runtime;
