-- Migration 0032: Mark seeded and unsourced demand signals (Task A)

-- 1. Mark fake hardware cluster fixtures from migration 0026 as SEEDED
UPDATE demand_signals
SET status = 'SEEDED'
WHERE source_url LIKE '%search.community%'
   OR id LIKE 'dem_bq_%';

-- 2. Mark any signals missing a valid HTTP source URL as UNSOURCED
UPDATE demand_signals
SET status = 'UNSOURCED'
WHERE (source_url IS NULL OR source_url = '' OR source_url = 'UNKNOWN' OR source_url NOT LIKE 'http%')
  AND status != 'SEEDED';

-- 3. Reclassify publisher articles and reviews that took default BUYER_QUESTION to PUBLISHER_ARTICLE
UPDATE demand_signals
SET signal_type = 'PUBLISHER_ARTICLE',
    estimated_monthly_volume = 0,
    commercial_score = 0.0
WHERE signal_type = 'BUYER_QUESTION'
  AND (
    topic LIKE '%Best%' OR
    topic LIKE '%Tested%' OR
    topic LIKE '%Reviews%' OR
    topic LIKE '%Top%' OR
    topic LIKE '%Guide%' OR
    topic LIKE '%Software%' OR
    topic LIKE '%Bookkeeping%' OR
    topic LIKE '%Billing%' OR
    source_url LIKE '%pcmag%' OR
    source_url LIKE '%businessnewsdaily%' OR
    source_url LIKE '%aiaccountant%' OR
    source_url LIKE '%yahoo%' OR
    source_url LIKE '%indeed%' OR
    source_url LIKE '%mybillbook%' OR
    source_url LIKE '%business.com%' OR
    source_url LIKE '%cnbc%' OR
    source_url LIKE '%pilot.com%' OR
    source_url LIKE '%invoicecrowd%' OR
    source_url LIKE '%quickenaccounting%' OR
    source_url LIKE '%busy.in%'
  );
