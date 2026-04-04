-- Fix contract_address on existing data: re-tag from the new contract
-- (0x6b8d...) back to the old contract (0x05c4...) where all pre-redeploy
-- data was actually created. Migration 00009 incorrectly defaulted to the
-- new address.
--
-- Scoped to rows indexed/created before 2026-03-17T09:00:00Z (the time
-- migration 00009 was deployed). Any rows indexed after this cutoff on
-- the new contract are legitimate new-contract data and must not be
-- re-tagged.
UPDATE storylines SET contract_address = '0x05c4d59529807316d6fa09cdaa509addfe85b474'
  WHERE contract_address = '0x6b8d38af1773dd162ebc6f4a8eb923f3c669605d'
    AND indexed_at < '2026-03-17T09:00:00Z';
UPDATE plots SET contract_address = '0x05c4d59529807316d6fa09cdaa509addfe85b474'
  WHERE contract_address = '0x6b8d38af1773dd162ebc6f4a8eb923f3c669605d'
    AND indexed_at < '2026-03-17T09:00:00Z';
UPDATE donations SET contract_address = '0x05c4d59529807316d6fa09cdaa509addfe85b474'
  WHERE contract_address = '0x6b8d38af1773dd162ebc6f4a8eb923f3c669605d'
    AND indexed_at < '2026-03-17T09:00:00Z';
UPDATE ratings SET contract_address = '0x05c4d59529807316d6fa09cdaa509addfe85b474'
  WHERE contract_address = '0x6b8d38af1773dd162ebc6f4a8eb923f3c669605d'
    AND created_at < '2026-03-17T09:00:00Z';
UPDATE comments SET contract_address = '0x05c4d59529807316d6fa09cdaa509addfe85b474'
  WHERE contract_address = '0x6b8d38af1773dd162ebc6f4a8eb923f3c669605d'
    AND created_at < '2026-03-17T09:00:00Z';
UPDATE page_views SET contract_address = '0x05c4d59529807316d6fa09cdaa509addfe85b474'
  WHERE contract_address = '0x6b8d38af1773dd162ebc6f4a8eb923f3c669605d'
    AND viewed_at < '2026-03-17T09:00:00Z';
