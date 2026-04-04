-- [#551] Backfill genre and language for E2E storylines (IDs 34-42)
--
-- Storylines created via Foundry E2E scripts have no genre set and
-- language defaults to 'English'. This sets correct values based on
-- the storyline content. Genre values match lib/genres.ts GENRES list
-- exactly (case-sensitive). Language values match LANGUAGES list.
--
-- All UPDATEs scoped to v4b factory to avoid touching other contracts.

-- 34: The Last Signal (Sci-Fi, English)
UPDATE storylines SET genre = 'Science Fiction', language = 'English'
  WHERE storyline_id = 34 AND lower(contract_address) = lower('0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf');

-- 35: The Holloway Manuscript (Mystery, English)
UPDATE storylines SET genre = 'Mystery', language = 'English'
  WHERE storyline_id = 35 AND lower(contract_address) = lower('0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf');

-- 36: The Ember Throne (Fantasy, English)
UPDATE storylines SET genre = 'Fantasy', language = 'English'
  WHERE storyline_id = 36 AND lower(contract_address) = lower('0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf');

-- 37: Still Life with Shadows (Literary Fiction, English)
UPDATE storylines SET genre = 'Contemporary Lit', language = 'English'
  WHERE storyline_id = 37 AND lower(contract_address) = lower('0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf');

-- 38: 붉은 달의 아이 (Horror, Korean)
UPDATE storylines SET genre = 'Horror', language = 'Korean'
  WHERE storyline_id = 38 AND lower(contract_address) = lower('0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf');

-- 39: 風鈴の夏 (Slice of Life, Japanese)
UPDATE storylines SET genre = 'Contemporary Lit', language = 'Japanese'
  WHERE storyline_id = 39 AND lower(contract_address) = lower('0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf');

-- 40: 碧血剑影 (Wuxia, Chinese)
UPDATE storylines SET genre = 'Historical Fiction', language = 'Chinese'
  WHERE storyline_id = 40 AND lower(contract_address) = lower('0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf');

-- 41: El Jardín de las Mariposas Eternas (Magical Realism, Spanish)
UPDATE storylines SET genre = 'Others', language = 'Spanish'
  WHERE storyline_id = 41 AND lower(contract_address) = lower('0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf');

-- 42: L'Heure Bleue (Existential, French)
UPDATE storylines SET genre = 'Contemporary Lit', language = 'French'
  WHERE storyline_id = 42 AND lower(contract_address) = lower('0x9D2AE1E99D0A6300bfcCF41A82260374e38744Cf');
