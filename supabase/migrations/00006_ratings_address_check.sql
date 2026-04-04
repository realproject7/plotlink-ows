-- Enforce lowercase hex addresses at the DB level to prevent dedup issues.
ALTER TABLE ratings
  ADD CONSTRAINT ratings_rater_address_lowercase
  CHECK (rater_address = lower(rater_address));
