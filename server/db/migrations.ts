import type { Db } from './index';

interface Migration {
  id: string;
  sql: string;
}

// Every dealer-owned table carries dealer_id; the API layer always filters by the authenticated user's dealer.
const migrations: Migration[] = [
  {
    id: '001_initial_schema',
    sql: `
CREATE TABLE platform_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid,
  kind text NOT NULL,
  mime_type text NOT NULL,
  size_bytes int NOT NULL,
  sha256 text NOT NULL,
  content bytea NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dealers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_code text NOT NULL UNIQUE,
  dealer_name text NOT NULL,
  legal_name text,
  logo_file_id uuid REFERENCES files(id),
  issuer_name text,
  servicing_office text,
  gstin text,
  address text,
  city text,
  state text,
  pincode text,
  phone text,
  email text,
  website text,
  rsa_phone text,
  rsa_email text,
  rsa_website text,
  policy_prefix text UNIQUE,
  policy_number_format text,
  dealer_conditions text,
  allow_custom_conditions boolean NOT NULL DEFAULT false,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid REFERENCES dealers(id),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  mobile text,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('SUPER_ADMIN', 'DEALER_ADMIN', 'DEALER_EMPLOYEE')),
  permissions text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  must_change_password boolean NOT NULL DEFAULT false,
  failed_login_count int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_role_dealer_chk CHECK ((role = 'SUPER_ADMIN') = (dealer_id IS NULL))
);
CREATE INDEX users_dealer_idx ON users(dealer_id);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  name text NOT NULL,
  dob date,
  mobile text NOT NULL,
  email text,
  address text NOT NULL,
  city text NOT NULL,
  state text NOT NULL,
  pincode text NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customers_dealer_mobile_idx ON customers(dealer_id, mobile);
CREATE INDEX customers_dealer_name_idx ON customers(dealer_id, lower(name));

CREATE TABLE vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  registration_no text,
  vehicle_type text NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  variant text NOT NULL,
  engine_no text,
  chassis_no text,
  fuel_type text NOT NULL,
  manufacturing_year int NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vehicles_dealer_customer_idx ON vehicles(dealer_id, customer_id);
CREATE INDEX vehicles_dealer_reg_idx ON vehicles(dealer_id, registration_no);
CREATE INDEX vehicles_dealer_engine_idx ON vehicles(dealer_id, engine_no);
CREATE UNIQUE INDEX vehicles_dealer_chassis_uq ON vehicles(dealer_id, chassis_no) WHERE chassis_no IS NOT NULL;

CREATE TABLE rsa_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code text NOT NULL UNIQUE,
  plan_name text NOT NULL,
  certificate_plan_name text,
  description text,
  vehicle_types text[] NOT NULL,
  fuel_types text[] NOT NULL DEFAULT '{}',
  max_vehicle_age_years int,
  number_of_services int NOT NULL DEFAULT 1,
  towing_limit_km int,
  gst_rate numeric(5,2),
  price_includes_gst boolean NOT NULL DEFAULT true,
  special_conditions text,
  eligibility_notes text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rsa_product_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES rsa_products(id),
  label text NOT NULL,
  validity_unit text NOT NULL CHECK (validity_unit IN ('DAYS', 'MONTHS')),
  validity_value int NOT NULL CHECK (validity_value > 0),
  price numeric(12,2) NOT NULL CHECK (price >= 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rsa_product_terms_product_idx ON rsa_product_terms(product_id);

CREATE TABLE rsa_benefits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES rsa_products(id) ON DELETE CASCADE,
  benefit_name text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_applicable boolean NOT NULL DEFAULT true,
  applicable_text text,
  sort_order int NOT NULL DEFAULT 0
);
CREATE INDEX rsa_benefits_product_idx ON rsa_benefits(product_id);

CREATE TABLE dealer_products (
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  product_id uuid NOT NULL REFERENCES rsa_products(id),
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dealer_id, product_id)
);

CREATE TABLE dealer_term_prices (
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  term_id uuid NOT NULL REFERENCES rsa_product_terms(id),
  dealer_price numeric(12,2) NOT NULL CHECK (dealer_price >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dealer_id, term_id)
);

CREATE TABLE policy_sequences (
  scope text PRIMARY KEY,
  last_value bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_number text UNIQUE,
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  product_id uuid NOT NULL REFERENCES rsa_products(id),
  term_id uuid REFERENCES rsa_product_terms(id),
  plan_name text NOT NULL,
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  base_premium numeric(12,2) NOT NULL,
  gst_rate numeric(5,2) NOT NULL,
  gst_amount numeric(12,2) NOT NULL,
  total_premium numeric(12,2) NOT NULL,
  number_of_services int NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT', 'PAYMENT_PENDING', 'ACTIVE', 'CANCELLED', 'SUSPENDED', 'RENEWED')),
  snapshot jsonb,
  document_version int NOT NULL DEFAULT 0,
  renewed_from_policy_id uuid REFERENCES policies(id),
  renewed_to_policy_id uuid REFERENCES policies(id),
  issued_by uuid REFERENCES users(id),
  issued_at timestamptz,
  created_by uuid REFERENCES users(id),
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX policies_dealer_issued_idx ON policies(dealer_id, issued_at DESC);
CREATE INDEX policies_dealer_status_end_idx ON policies(dealer_id, status, end_date);
CREATE INDEX policies_vehicle_idx ON policies(vehicle_id);
CREATE INDEX policies_customer_idx ON policies(customer_id);

CREATE TABLE policy_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES policies(id),
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  version int NOT NULL,
  reason text NOT NULL,
  content bytea NOT NULL,
  sha256 text NOT NULL,
  size_bytes int NOT NULL,
  snapshot jsonb NOT NULL,
  generated_by uuid,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, version)
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  policy_id uuid NOT NULL REFERENCES policies(id),
  amount numeric(12,2) NOT NULL,
  gst_amount numeric(12,2) NOT NULL,
  total_amount numeric(12,2) NOT NULL,
  payment_method text NOT NULL,
  transaction_id text,
  status text NOT NULL CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED')),
  paid_at timestamptz,
  refund_amount numeric(12,2) NOT NULL DEFAULT 0,
  refunded_at timestamptz,
  refund_reference text,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_dealer_created_idx ON payments(dealer_id, created_at DESC);
CREATE INDEX payments_policy_idx ON payments(policy_id);

CREATE TABLE policy_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES policies(id),
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  status text NOT NULL CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED')),
  reason text NOT NULL,
  requested_by uuid NOT NULL REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES users(id),
  decided_at timestamptz,
  decision_notes text,
  cancellation_date timestamptz,
  refund_amount numeric(12,2) NOT NULL DEFAULT 0,
  refund_reference text,
  payment_status text
);
CREATE INDEX policy_cancellations_dealer_status_idx ON policy_cancellations(dealer_id, status);
CREATE INDEX policy_cancellations_policy_idx ON policy_cancellations(policy_id);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  dealer_id uuid,
  user_id uuid,
  user_name text,
  user_role text,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  entity_label text,
  old_value jsonb,
  new_value jsonb,
  result text NOT NULL DEFAULT 'SUCCESS',
  message text,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_dealer_created_idx ON audit_logs(dealer_id, created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs(entity_type, entity_id);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES dealers(id),
  policy_id uuid REFERENCES policies(id),
  channel text NOT NULL,
  recipient text NOT NULL,
  subject text,
  body text NOT NULL,
  status text NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX notifications_policy_idx ON notifications(policy_id);

CREATE TABLE rate_limits (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count int NOT NULL
);
`,
  },
];

const LOCK_ID = 7_272_774;

export async function migrate(db: Db) {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  await db.tx(async (q) => {
    // Serialises concurrent cold starts (e.g. several serverless instances booting at once).
    await q.query('SELECT pg_advisory_xact_lock($1)', [LOCK_ID]);
    const { rows } = await q.query<{ id: string }>('SELECT id FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.id));
    for (const m of migrations) {
      if (applied.has(m.id)) continue;
      await q.exec(m.sql);
      await q.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
    }
  });
}
