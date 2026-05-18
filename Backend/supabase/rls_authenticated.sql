-- Optional: run AFTER Supabase Auth is working.
-- Replaces permissive anon policies with authenticated-only access.

DROP POLICY IF EXISTS "anon_all_customers" ON customers;
DROP POLICY IF EXISTS "anon_all_framing_orders" ON framing_orders;
DROP POLICY IF EXISTS "anon_all_shoot_bookings" ON shoot_bookings;
DROP POLICY IF EXISTS "anon_all_editing_orders" ON editing_orders;
DROP POLICY IF EXISTS "anon_all_expenditures" ON expenditures;
DROP POLICY IF EXISTS "anon_all_unsettled_orders" ON unsettled_orders;
DROP POLICY IF EXISTS "anon_all_bookings" ON bookings;
DROP POLICY IF EXISTS "anon_all_notes" ON notes;
DROP POLICY IF EXISTS "anon_all_bills" ON bills;
DROP POLICY IF EXISTS "anon_all_admin_config" ON admin_config;

CREATE POLICY "auth_all_customers" ON customers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_framing_orders" ON framing_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_shoot_bookings" ON shoot_bookings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_editing_orders" ON editing_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_expenditures" ON expenditures FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_unsettled_orders" ON unsettled_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_bookings" ON bookings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_notes" ON notes FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_bills" ON bills FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Drop admin_config table when fully on Supabase Auth (optional):
-- DROP TABLE IF EXISTS admin_config;
