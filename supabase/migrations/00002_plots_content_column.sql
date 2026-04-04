-- Add content column to plots table.
-- Proposal §4.1 requires Supabase as the primary read path for content.
-- The indexer fetches content from IPFS and stores it here.
alter table plots add column if not exists content text;
