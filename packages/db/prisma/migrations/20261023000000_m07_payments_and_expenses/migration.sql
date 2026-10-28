ALTER TABLE businesses ADD COLUMN payment_in_sequence integer NOT NULL DEFAULT 0 CHECK (payment_in_sequence >= 0);
ALTER TABLE businesses ADD COLUMN payment_out_sequence integer NOT NULL DEFAULT 0 CHECK (payment_out_sequence >= 0);
ALTER TABLE businesses ADD COLUMN expense_sequence integer NOT NULL DEFAULT 0 CHECK (expense_sequence >= 0);

CREATE TABLE payments (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL,
  source_event_id uuid,
  party_id uuid NOT NULL,
  account_id uuid NOT NULL,
  payment_kind varchar(12) NOT NULL CHECK (payment_kind IN ('PaymentIn', 'PaymentOut')),
  number varchar(32),
  amount numeric(38,2) NOT NULL CHECK (amount > 0),
  allocated_amount numeric(38,2) NOT NULL DEFAULT 0 CHECK (allocated_amount >= 0),
  unallocated_amount numeric(38,2) NOT NULL DEFAULT 0 CHECK (unallocated_amount >= 0),
  reference varchar(120),
  note text,
  status varchar(12) NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Posted')),
  business_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  UNIQUE (business_id, id),
  UNIQUE (business_id, command_id),
  UNIQUE (business_id, number),
  FOREIGN KEY (business_id, party_id) REFERENCES parties(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, account_id) REFERENCES accounts(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, source_event_id) REFERENCES source_events(business_id, id) ON DELETE RESTRICT,
  CONSTRAINT payment_posted_complete CHECK (
    (status = 'Draft' AND number IS NULL AND source_event_id IS NULL AND posted_at IS NULL)
    OR (status = 'Posted' AND number IS NOT NULL AND source_event_id IS NOT NULL AND posted_at IS NOT NULL
        AND allocated_amount + unallocated_amount = amount)
  )
);
CREATE INDEX payments_by_date ON payments (business_id, business_date DESC, id DESC);
CREATE INDEX payments_by_party ON payments (business_id, party_id);

CREATE TABLE payment_allocations (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL,
  sale_document_id uuid,
  purchase_document_id uuid,
  allocated_amount numeric(38,2) NOT NULL CHECK (allocated_amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, payment_id) REFERENCES payments(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, sale_document_id) REFERENCES sale_documents(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, purchase_document_id) REFERENCES purchase_documents(business_id, id) ON DELETE RESTRICT,
  CONSTRAINT payment_allocation_target CHECK (
    (sale_document_id IS NOT NULL AND purchase_document_id IS NULL)
    OR (sale_document_id IS NULL AND purchase_document_id IS NOT NULL)
  )
);
CREATE INDEX payment_allocations_payment ON payment_allocations (business_id, payment_id);
CREATE INDEX payment_allocations_sale ON payment_allocations (business_id, sale_document_id);
CREATE INDEX payment_allocations_purchase ON payment_allocations (business_id, purchase_document_id);

CREATE TABLE expenses (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL,
  source_event_id uuid,
  expense_category_id uuid NOT NULL,
  expense_account_id uuid NOT NULL,
  paid_from_account_id uuid NOT NULL,
  number varchar(32),
  amount numeric(38,2) NOT NULL CHECK (amount > 0),
  tax_amount numeric(38,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  reference varchar(120),
  note text,
  status varchar(12) NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Posted')),
  business_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  UNIQUE (business_id, id),
  UNIQUE (business_id, command_id),
  UNIQUE (business_id, number),
  FOREIGN KEY (business_id, expense_category_id) REFERENCES expense_categories(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, expense_account_id) REFERENCES accounts(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, paid_from_account_id) REFERENCES accounts(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, source_event_id) REFERENCES source_events(business_id, id) ON DELETE RESTRICT,
  CONSTRAINT expense_posted_complete CHECK (
    (status = 'Draft' AND number IS NULL AND source_event_id IS NULL AND posted_at IS NULL)
    OR (status = 'Posted' AND number IS NOT NULL AND source_event_id IS NOT NULL AND posted_at IS NOT NULL)
  )
);
CREATE INDEX expenses_by_date ON expenses (business_id, business_date DESC, id DESC);
CREATE INDEX expenses_by_category ON expenses (business_id, expense_category_id);

DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['payments', 'payment_allocations', 'expenses'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_scope ON %I FOR ALL USING (current_setting(''app.bypass_rls'',true) = ''true'' OR business_id = NULLIF(current_setting(''app.current_business_id'',true),'''')::uuid) WITH CHECK (current_setting(''app.bypass_rls'',true) = ''true'' OR business_id = NULLIF(current_setting(''app.current_business_id'',true),'''')::uuid)', table_name);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON payments TO bms_runtime;
GRANT SELECT, INSERT ON payment_allocations TO bms_runtime;
GRANT SELECT, INSERT, UPDATE ON expenses TO bms_runtime;
