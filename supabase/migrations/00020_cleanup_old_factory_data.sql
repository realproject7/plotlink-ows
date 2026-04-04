-- Clean up storylines and related data from old StoryFactory deployments.
-- Current factory: 0x337c5b96f03fB335b433291695A4171fd5dED8B0
-- Old factories: 0xfa5489b6710Ba2f8406b37fA8f8c3018e51FA229,
--                0x6B8d38af1773dd162Ebc6f4A8eb923F3c669605d,
--                0x05C4d59529807316D6fA09cdaA509adDfe85b474

BEGIN;

-- Delete from child tables first (FK constraints)
DELETE FROM trade_history WHERE storyline_id IN (
  SELECT storyline_id FROM storylines
  WHERE contract_address IS NULL
     OR lower(contract_address) != lower('0x337c5b96f03fB335b433291695A4171fd5dED8B0')
);

DELETE FROM comments WHERE storyline_id IN (
  SELECT storyline_id FROM storylines
  WHERE contract_address IS NULL
     OR lower(contract_address) != lower('0x337c5b96f03fB335b433291695A4171fd5dED8B0')
);

DELETE FROM page_views WHERE storyline_id IN (
  SELECT storyline_id FROM storylines
  WHERE contract_address IS NULL
     OR lower(contract_address) != lower('0x337c5b96f03fB335b433291695A4171fd5dED8B0')
);

DELETE FROM ratings WHERE storyline_id IN (
  SELECT storyline_id FROM storylines
  WHERE contract_address IS NULL
     OR lower(contract_address) != lower('0x337c5b96f03fB335b433291695A4171fd5dED8B0')
);

DELETE FROM donations WHERE storyline_id IN (
  SELECT storyline_id FROM storylines
  WHERE contract_address IS NULL
     OR lower(contract_address) != lower('0x337c5b96f03fB335b433291695A4171fd5dED8B0')
);

DELETE FROM plots WHERE storyline_id IN (
  SELECT storyline_id FROM storylines
  WHERE contract_address IS NULL
     OR lower(contract_address) != lower('0x337c5b96f03fB335b433291695A4171fd5dED8B0')
);

-- Finally delete the storylines themselves
DELETE FROM storylines
WHERE contract_address IS NULL
   OR lower(contract_address) != lower('0x337c5b96f03fB335b433291695A4171fd5dED8B0');

COMMIT;
