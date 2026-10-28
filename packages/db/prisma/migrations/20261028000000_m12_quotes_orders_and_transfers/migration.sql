-- Milestone 12: Quotations, Purchase Orders, and Warehouse Transfers

-- 1. Add sequential counters to businesses
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS quotation_sequence integer NOT NULL DEFAULT 0;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS purchase_order_sequence integer NOT NULL DEFAULT 0;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS stock_transfer_sequence integer NOT NULL DEFAULT 0;

-- 2. Create quotations and quotation_lines
CREATE TABLE IF NOT EXISTS quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  party_id uuid NOT NULL,
  number varchar(40) NOT NULL,
  status varchar(25) NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Issued', 'Accepted', 'Expired', 'PartiallyFulfilled', 'Fulfilled', 'Closed')),
  valid_until timestamptz,
  subtotal numeric(38, 2) NOT NULL DEFAULT 0,
  tax_total numeric(38, 2) NOT NULL DEFAULT 0,
  grand_total numeric(38, 2) NOT NULL DEFAULT 0,
  notes text,
  snapshot jsonb NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  UNIQUE (business_id, number),
  FOREIGN KEY (business_id, party_id) REFERENCES parties(business_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS quotations_party_status ON quotations (business_id, party_id, status);

CREATE TABLE IF NOT EXISTS quotation_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  quotation_id uuid NOT NULL,
  item_id uuid NOT NULL,
  quantity numeric(38, 6) NOT NULL CHECK (quantity > 0),
  converted_quantity numeric(38, 6) NOT NULL DEFAULT 0 CHECK (converted_quantity >= 0 AND converted_quantity <= quantity),
  unit_price numeric(38, 2) NOT NULL CHECK (unit_price >= 0),
  tax_profile_id uuid,
  tax_amount numeric(38, 2) NOT NULL DEFAULT 0,
  line_total numeric(38, 2) NOT NULL,
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, quotation_id) REFERENCES quotations(business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, item_id) REFERENCES items(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, tax_profile_id) REFERENCES tax_profiles(business_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS quotation_lines_quote ON quotation_lines (business_id, quotation_id);

-- 3. Create purchase_orders and purchase_order_lines
CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  party_id uuid NOT NULL,
  location_id uuid NOT NULL,
  number varchar(40) NOT NULL,
  status varchar(25) NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Issued', 'Accepted', 'Expired', 'PartiallyFulfilled', 'Fulfilled', 'Closed')),
  expected_delivery_date timestamptz,
  subtotal numeric(38, 2) NOT NULL DEFAULT 0,
  tax_total numeric(38, 2) NOT NULL DEFAULT 0,
  grand_total numeric(38, 2) NOT NULL DEFAULT 0,
  notes text,
  snapshot jsonb NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  UNIQUE (business_id, number),
  FOREIGN KEY (business_id, party_id) REFERENCES parties(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, location_id) REFERENCES locations(business_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS purchase_orders_party_status ON purchase_orders (business_id, party_id, status);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  purchase_order_id uuid NOT NULL,
  item_id uuid NOT NULL,
  quantity numeric(38, 6) NOT NULL CHECK (quantity > 0),
  converted_quantity numeric(38, 6) NOT NULL DEFAULT 0 CHECK (converted_quantity >= 0 AND converted_quantity <= quantity),
  unit_price numeric(38, 2) NOT NULL CHECK (unit_price >= 0),
  tax_profile_id uuid,
  tax_amount numeric(38, 2) NOT NULL DEFAULT 0,
  line_total numeric(38, 2) NOT NULL,
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, purchase_order_id) REFERENCES purchase_orders(business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, item_id) REFERENCES items(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, tax_profile_id) REFERENCES tax_profiles(business_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS po_lines_po ON purchase_order_lines (business_id, purchase_order_id);

-- 4. Create stock_transfers and stock_transfer_lines
CREATE TABLE IF NOT EXISTS stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  number varchar(40) NOT NULL,
  source_location_id uuid NOT NULL,
  destination_location_id uuid NOT NULL,
  status varchar(25) NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Dispatched', 'PartiallyReceived', 'Completed', 'Cancelled')),
  dispatched_at timestamptz,
  received_at timestamptz,
  notes text,
  snapshot jsonb NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  UNIQUE (business_id, number),
  FOREIGN KEY (business_id, source_location_id) REFERENCES locations(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, destination_location_id) REFERENCES locations(business_id, id) ON DELETE RESTRICT,
  CONSTRAINT stock_transfer_diff_locations CHECK (source_location_id <> destination_location_id)
);

CREATE INDEX IF NOT EXISTS stock_transfers_locations ON stock_transfers (business_id, source_location_id, destination_location_id, status);

CREATE TABLE IF NOT EXISTS stock_transfer_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  transfer_id uuid NOT NULL,
  item_id uuid NOT NULL,
  dispatched_quantity numeric(38, 6) NOT NULL CHECK (dispatched_quantity > 0),
  received_quantity numeric(38, 6) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0 AND received_quantity <= dispatched_quantity),
  loss_quantity numeric(38, 6) NOT NULL DEFAULT 0 CHECK (loss_quantity >= 0 AND (received_quantity + loss_quantity) <= dispatched_quantity),
  loss_reason text,
  unit_cost numeric(38, 2) NOT NULL DEFAULT 0,
  line_cost numeric(38, 2) NOT NULL DEFAULT 0,
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, transfer_id) REFERENCES stock_transfers(business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, item_id) REFERENCES items(business_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS stock_transfer_lines_transfer ON stock_transfer_lines (business_id, transfer_id);

-- 5. Row Level Security & bms_runtime grants
ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotations FORCE ROW LEVEL SECURITY;
ALTER TABLE quotation_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_lines FORCE ROW LEVEL SECURITY;

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_lines FORCE ROW LEVEL SECURITY;

ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfers FORCE ROW LEVEL SECURITY;
ALTER TABLE stock_transfer_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfer_lines FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'quotations' AND policyname = 'tenant_scope') THEN
    CREATE POLICY tenant_scope ON quotations FOR ALL
      USING (current_setting('app.bypass_rls', true) = 'true' OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid)
      WITH CHECK (current_setting('app.bypass_rls', true) = 'true' OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'quotation_lines' AND policyname = 'tenant_scope') THEN
    CREATE POLICY tenant_scope ON quotation_lines FOR ALL
      USING (current_setting('app.bypass_rls', true) = 'true' OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid)
      WITH CHECK (current_setting('app.bypass_rls', true) = 'true' OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchase_orders' AND policyname = 'tenant_scope') THEN
    CREATE POLICY tenant_scope ON purchase_orders FOR ALL
      USING (current_setting('app.bypass_rls', true) = 'true' OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid)
      WITH CHECK (current_setting('app.bypass_rls', true) = 'true' OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchase_order_lines' AND policyname = 'tenant_scope') THEN
    CREATE POLICY tenant_scope ON purchase_order_lines FOR ALL
      USING (current_setting('app.bypass_rls', true) = 'true' OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid)
      WITH CHECK (current_setting('app.bypass_rls', true) = 'true' OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stock_transfers' AND policyname = 'tenant_scope') THEN
    CREATE POLICY tenant_scope ON stock_transfers FOR ALL
      USING (current_setting('app.bypass_rls', true) = 'true' OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid)
      WITH CHECK (current_setting('app.bypass_rls', true) = 'true' OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stock_transfer_lines' AND policyname = 'tenant_scope') THEN
    CREATE POLICY tenant_scope ON stock_transfer_lines FOR ALL
      USING (current_setting('app.bypass_rls', true) = 'true' OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid)
      WITH CHECK (current_setting('app.bypass_rls', true) = 'true' OR business_id = NULLIF(current_setting('app.current_business_id', true), '')::uuid);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON quotations TO bms_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON quotation_lines TO bms_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_orders TO bms_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_order_lines TO bms_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_transfers TO bms_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_transfer_lines TO bms_runtime;
