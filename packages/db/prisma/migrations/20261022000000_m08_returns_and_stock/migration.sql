ALTER TABLE businesses ADD COLUMN credit_note_sequence integer NOT NULL DEFAULT 0 CHECK (credit_note_sequence >= 0);
ALTER TABLE businesses ADD COLUMN debit_note_sequence integer NOT NULL DEFAULT 0 CHECK (debit_note_sequence >= 0);
ALTER TABLE businesses ADD COLUMN stock_adjustment_sequence integer NOT NULL DEFAULT 0 CHECK (stock_adjustment_sequence >= 0);

CREATE TABLE credit_notes (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  kind varchar(20) NOT NULL CHECK (kind IN ('SaleReturn','PurchaseReturn')),
  original_document_id uuid NOT NULL,
  location_id uuid NOT NULL,
  party_id uuid,
  command_id uuid NOT NULL,
  source_event_id uuid,
  number varchar(40),
  status varchar(12) NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Posted')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  reason text NOT NULL,
  snapshot jsonb NOT NULL,
  subtotal numeric(38,2),
  tax_total numeric(38,2),
  total numeric(38,2),
  allocated_credit numeric(38,2),
  refunded_amount numeric(38,2),
  customer_credit numeric(38,2),
  business_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  UNIQUE (business_id, id),
  UNIQUE (business_id, command_id),
  UNIQUE (business_id, number),
  FOREIGN KEY (business_id, location_id) REFERENCES locations(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, party_id) REFERENCES parties(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, source_event_id) REFERENCES source_events(business_id, id) ON DELETE RESTRICT,
  CONSTRAINT credit_note_posted_complete CHECK (
    (status = 'Draft' AND number IS NULL AND source_event_id IS NULL AND posted_at IS NULL)
    OR (status = 'Posted' AND number IS NOT NULL AND source_event_id IS NOT NULL AND posted_at IS NOT NULL
        AND total IS NOT NULL AND allocated_credit IS NOT NULL AND refunded_amount IS NOT NULL AND customer_credit IS NOT NULL
        AND allocated_credit + refunded_amount + customer_credit = total)
  )
);
CREATE INDEX credit_notes_by_date ON credit_notes (business_id, business_date DESC, id DESC);
CREATE INDEX credit_notes_by_original_doc ON credit_notes (business_id, original_document_id);

CREATE TABLE credit_note_lines (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL,
  credit_note_id uuid NOT NULL,
  original_line_id uuid NOT NULL,
  item_id uuid NOT NULL,
  quantity numeric(38,6) NOT NULL CHECK (quantity > 0),
  unit_price numeric(38,2) NOT NULL CHECK (unit_price >= 0),
  subtotal numeric(38,2) NOT NULL CHECK (subtotal >= 0),
  tax_amount numeric(38,2) NOT NULL DEFAULT 0,
  total numeric(38,2) NOT NULL,
  disposition varchar(20) NOT NULL CHECK (disposition IN ('Restocked','Damaged','Scrapped','None')),
  snapshot jsonb NOT NULL,
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, credit_note_id) REFERENCES credit_notes(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, item_id) REFERENCES items(business_id, id) ON DELETE RESTRICT
);

CREATE TABLE credit_note_refunds (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL,
  credit_note_id uuid NOT NULL,
  account_id uuid NOT NULL,
  kind varchar(8) NOT NULL CHECK (kind IN ('Cash','Bank')),
  amount numeric(38,2) NOT NULL CHECK (amount > 0),
  reference varchar(120),
  UNIQUE (business_id, id),
  CONSTRAINT credit_note_refund_kind CHECK (
    (kind = 'Cash' AND reference IS NULL)
    OR (kind = 'Bank' AND reference IS NOT NULL AND length(trim(reference)) > 0)
  ),
  FOREIGN KEY (business_id, credit_note_id) REFERENCES credit_notes(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, account_id) REFERENCES accounts(business_id, id) ON DELETE RESTRICT
);

CREATE TABLE stock_adjustments (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL,
  item_id uuid NOT NULL,
  command_id uuid NOT NULL,
  source_event_id uuid,
  adjustment_kind varchar(30) NOT NULL CHECK (adjustment_kind IN ('CountVariance','Damage','Loss','Surplus','Correction')),
  counted_quantity numeric(38,6),
  system_quantity numeric(38,6),
  quantity_delta numeric(38,6) NOT NULL CHECK (quantity_delta <> 0),
  unit_cost numeric(38,2) NOT NULL CHECK (unit_cost >= 0),
  value_delta numeric(38,2) NOT NULL,
  reason text NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Posted')),
  business_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  UNIQUE (business_id, id),
  UNIQUE (business_id, command_id),
  FOREIGN KEY (business_id, location_id) REFERENCES locations(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, item_id) REFERENCES items(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, source_event_id) REFERENCES source_events(business_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_adjustment_posted CHECK (
    (status = 'Draft' AND source_event_id IS NULL AND posted_at IS NULL)
    OR (status = 'Posted' AND source_event_id IS NOT NULL AND posted_at IS NOT NULL)
  )
);
CREATE INDEX stock_adjustments_by_date ON stock_adjustments (business_id, business_date DESC, id DESC);

DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['credit_notes','credit_note_lines','credit_note_refunds','stock_adjustments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_scope ON %I FOR ALL USING (current_setting(''app.bypass_rls'',true) = ''true'' OR business_id = NULLIF(current_setting(''app.current_business_id'',true),'''')::uuid) WITH CHECK (current_setting(''app.bypass_rls'',true) = ''true'' OR business_id = NULLIF(current_setting(''app.current_business_id'',true),'''')::uuid)', table_name);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON credit_notes TO bms_runtime;
GRANT SELECT, INSERT ON credit_note_lines, credit_note_refunds TO bms_runtime;
GRANT SELECT, INSERT, UPDATE ON stock_adjustments TO bms_runtime;
