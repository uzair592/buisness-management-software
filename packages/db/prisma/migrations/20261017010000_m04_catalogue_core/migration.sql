-- Editable master data. Archive referenced records; never cascade posted history.
CREATE TABLE categories (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  name varchar(120) NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id,id), UNIQUE (business_id,name)
);
CREATE TABLE units (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  code varchar(20) NOT NULL,
  name varchar(80) NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id,id), UNIQUE (business_id,code)
);
CREATE TABLE tax_profiles (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  name varchar(100) NOT NULL,
  rate numeric(9,4) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  mode varchar(12) NOT NULL CHECK (mode IN ('Inclusive','Exclusive')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id,id), UNIQUE (business_id,name)
);
CREATE TABLE items (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  category_id uuid,
  base_unit_id uuid,
  tax_profile_id uuid,
  kind varchar(12) NOT NULL CHECK (kind IN ('Goods','Service')),
  name varchar(160) NOT NULL,
  sku varchar(60),
  barcode varchar(100),
  sale_price numeric(38,2) NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id,id), UNIQUE (business_id,sku), UNIQUE (business_id,barcode),
  FOREIGN KEY (business_id,category_id) REFERENCES categories(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id,base_unit_id) REFERENCES units(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id,tax_profile_id) REFERENCES tax_profiles(business_id,id) ON DELETE RESTRICT,
  CONSTRAINT goods_require_base_unit CHECK (kind = 'Service' OR base_unit_id IS NOT NULL)
);
CREATE INDEX items_search ON items(business_id,name,id);
CREATE TABLE item_unit_conversions (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL,
  item_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  factor numeric(38,6) NOT NULL CHECK (factor > 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  archived_at timestamptz,
  UNIQUE (business_id,id), UNIQUE (business_id,item_id,unit_id),
  FOREIGN KEY (business_id,item_id) REFERENCES items(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id,unit_id) REFERENCES units(business_id,id) ON DELETE RESTRICT
);
CREATE TABLE parties (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  name varchar(160) NOT NULL,
  is_customer boolean NOT NULL DEFAULT false,
  is_supplier boolean NOT NULL DEFAULT false,
  phone varchar(40),
  email varchar(255),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id,id),
  CONSTRAINT party_has_role CHECK (is_customer OR is_supplier)
);
CREATE INDEX parties_search ON parties(business_id,name,id);

-- Link future and existing stock movement records to a tenant-owned item.
ALTER TABLE stock_movements ADD COLUMN item_id uuid;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_item_tenant_fkey
  FOREIGN KEY (business_id,item_id) REFERENCES items(business_id,id) ON DELETE RESTRICT;
CREATE INDEX stock_movements_by_item ON stock_movements(business_id,item_id,location_id,created_at);

DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['categories','units','tax_profiles','items','item_unit_conversions','parties'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY tenant_scope ON %I FOR ALL USING (current_setting(''app.bypass_rls'',true) = ''true'' OR business_id = NULLIF(current_setting(''app.current_business_id'',true),'''')::uuid) WITH CHECK (current_setting(''app.bypass_rls'',true) = ''true'' OR business_id = NULLIF(current_setting(''app.current_business_id'',true),'''')::uuid)',table_name);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bms_runtime;
