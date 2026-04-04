-- Public read access via anon key (RLS is enabled, no policies = no data returned)
-- Writes remain restricted to service role (indexers)

CREATE POLICY "Public read" ON storylines FOR SELECT USING (hidden = false);
CREATE POLICY "Public read" ON plots FOR SELECT USING (hidden = false);
CREATE POLICY "Public read" ON donations FOR SELECT USING (true);
