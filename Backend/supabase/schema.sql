-- Studio GrayShades — Supabase schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL → New query).

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id BIGINT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  "createdAt" TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- framing_orders
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS framing_orders (
  id BIGINT PRIMARY KEY,
  "customerId" BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  description TEXT,
  "colorLabel" TEXT,
  "deliveryDate" TEXT,
  "additionalServices" JSONB DEFAULT '[]'::jsonb,
  "totalPrice" NUMERIC,
  "advancePaid" NUMERIC,
  balance NUMERIC,
  notes TEXT,
  status TEXT,
  "customerName" TEXT,
  phone TEXT,
  price NUMERIC,
  advance NUMERIC,
  "createdAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- shoot_bookings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shoot_bookings (
  id BIGINT PRIMARY KEY,
  "customerId" BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  "customerName" TEXT,
  phone TEXT,
  "eventType" TEXT,
  date TEXT,
  time TEXT,
  location TEXT,
  "packageType" TEXT,
  photographer TEXT,
  "colorLabel" TEXT,
  enlargement TEXT,
  album TEXT,
  "thankYouCards" TEXT,
  "additionalServices" JSONB DEFAULT '[]'::jsonb,
  note1 TEXT,
  note2 TEXT,
  "totalPrice" NUMERIC,
  "advancePaid" NUMERIC,
  balance NUMERIC,
  status TEXT,
  price NUMERIC,
  advance NUMERIC,
  "createdAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- editing_orders
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS editing_orders (
  id BIGINT PRIMARY KEY,
  "customerId" BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  "customerName" TEXT,
  phone TEXT,
  title TEXT,
  "deliveryDate" TEXT,
  "additionalServices" JSONB DEFAULT '[]'::jsonb,
  "totalPrice" NUMERIC,
  "advancePaid" NUMERIC,
  balance NUMERIC,
  note1 TEXT,
  note2 TEXT,
  status TEXT,
  "colorLabel" TEXT,
  price NUMERIC,
  advance NUMERIC,
  "createdAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- expenditures (IDs typically >= 2000000001)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenditures (
  id BIGINT PRIMARY KEY,
  date TEXT NOT NULL,
  title TEXT NOT NULL,
  note TEXT DEFAULT '',
  price NUMERIC NOT NULL,
  "createdAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- unsettled_orders (IDs typically >= 3000000001)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS unsettled_orders (
  id BIGINT PRIMARY KEY,
  "customerName" TEXT,
  date TEXT,
  phone TEXT,
  title TEXT,
  "additionalServices" JSONB DEFAULT '[]'::jsonb,
  "totalPrice" NUMERIC DEFAULT 0,
  "advancePaid" NUMERIC DEFAULT 0,
  balance NUMERIC DEFAULT 0,
  "createdAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- bookings (standalone calendar bookings; id is a string timestamp)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  "customerName" TEXT,
  phone TEXT,
  "eventTitle" TEXT,
  date TEXT,
  "additionalServices" JSONB DEFAULT '[]'::jsonb,
  "totalPrice" NUMERIC DEFAULT 0,
  "createdAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- notes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notes (
  id BIGINT PRIMARY KEY,
  title TEXT,
  description TEXT,
  date TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- bills (reserved; no API routes yet)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bills (
  id BIGINT PRIMARY KEY,
  payload JSONB DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- admin_config (singleton row, id = 1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  username TEXT NOT NULL DEFAULT 'admin',
  password TEXT NOT NULL DEFAULT 'password123'
);

INSERT INTO admin_config (id, username, password)
VALUES (1, 'admin', 'password123')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Row Level Security (allow server-side anon key access)
-- For production, tighten policies or use SUPABASE_SERVICE_ROLE_KEY on Vercel only.
-- ---------------------------------------------------------------------------
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE framing_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE shoot_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE editing_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenditures ENABLE ROW LEVEL SECURITY;
ALTER TABLE unsettled_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all_customers" ON customers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_framing_orders" ON framing_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_shoot_bookings" ON shoot_bookings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_editing_orders" ON editing_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_expenditures" ON expenditures FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_unsettled_orders" ON unsettled_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_bookings" ON bookings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_notes" ON notes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_bills" ON bills FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_admin_config" ON admin_config FOR ALL USING (true) WITH CHECK (true);

-- Optional: import existing data.json via Supabase Table Editor or a one-off script.
