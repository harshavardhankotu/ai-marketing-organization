-- Migration 0034: Record 7-day demand outcome for accounting software (Addendum Item 8)
INSERT INTO learning_records (
  id, organization_id, learning_type, decision, hypothesis, action, audience, offer, channel,
  result, confidence, what, outcome, cause, rule, source, created_at
) VALUES (
  'lrn_outcome_accounting_zero_buyer_questions',
  'org_owner_primary',
  'DEMAND_EXPERIMENT',
  'STOP_SPENDING_CREDITS',
  'Broad commercial search queries for accounting software in India yield buyer questions',
  'Halt Tavily credit spend on generic accounting search queries',
  'SMALL_BUSINESS',
  'best accounting software small business India',
  'ORGANIC_SEARCH',
  'FAILED',
  0.95,
  'SEARCH_DEMAND_NOT_REACHING_BUYERS',
  'ZERO_BUYER_QUESTIONS_AFTER_WEEK',
  '167 consecutive search signals over 10 days yielded 13 duplicate publisher review articles and 0 real buyer questions',
  'Halt credit spend on a category when a week of discovery yields fewer than 3 real buyer questions',
  'OUTCOME',
  datetime('now')
) ON CONFLICT(id) DO UPDATE SET
  outcome = 'ZERO_BUYER_QUESTIONS_AFTER_WEEK',
  confidence = 0.95;
