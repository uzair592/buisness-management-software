-- Account masters are versioned configuration; posted balances remain journal-derived.
CREATE TABLE expense_categories (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  name varchar(120) NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id,id), UNIQUE (business_id,name)
);
ALTER TABLE accounts ADD COLUMN kind varchar(20) NOT NULL DEFAULT 'General';
ALTER TABLE accounts ADD COLUMN expense_category_id uuid;
ALTER TABLE accounts ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE accounts ADD COLUMN archived_at timestamptz;
ALTER TABLE accounts ADD CONSTRAINT account_kind_allowed CHECK
  (kind IN ('General','Cash','Bank','Expense','Inventory','Receivable','Payable','Equity'));
ALTER TABLE accounts ADD CONSTRAINT account_kind_classification CHECK
  ((kind IN ('Cash','Bank','Inventory','Receivable') AND classification = 'Asset') OR
   (kind = 'Payable' AND classification = 'Liability') OR
   (kind = 'Equity' AND classification = 'Equity') OR
   (kind = 'Expense' AND classification = 'Expense') OR kind = 'General');
ALTER TABLE accounts ADD CONSTRAINT account_expense_category_required CHECK
  ((kind = 'Expense' AND expense_category_id IS NOT NULL) OR
   (kind <> 'Expense' AND expense_category_id IS NULL));
ALTER TABLE accounts ADD CONSTRAINT account_expense_category_tenant_fkey
  FOREIGN KEY (business_id,expense_category_id) REFERENCES expense_categories(business_id,id) ON DELETE RESTRICT;
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON expense_categories FOR ALL
  USING (current_setting('app.bypass_rls',true) = 'true' OR business_id = NULLIF(current_setting('app.current_business_id',true),'')::uuid)
  WITH CHECK (current_setting('app.bypass_rls',true) = 'true' OR business_id = NULLIF(current_setting('app.current_business_id',true),'')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON expense_categories TO bms_runtime;
