-- 0014_product_card_and_pipeline.sql
-- Adds display_name and listing_facts_json to product_proposals
-- Adds query and url columns to provider_call_logs for transparent Tavily call auditing

ALTER TABLE product_proposals ADD COLUMN display_name TEXT;
ALTER TABLE product_proposals ADD COLUMN listing_facts_json TEXT;

ALTER TABLE provider_call_logs ADD COLUMN query TEXT;
ALTER TABLE provider_call_logs ADD COLUMN url TEXT;
