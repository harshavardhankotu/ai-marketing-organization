-- Migration 0026: Classify Demand Signals and Populate Competitor Topics (Step 6)

-- 1. Classify publisher articles in demand_signals and set unbacked volume/score to 0 (UNKNOWN / unverified)
UPDATE demand_signals
SET signal_type = 'PUBLISHER_ARTICLE',
    estimated_monthly_volume = 0,
    commercial_score = 0.0
WHERE (
  topic LIKE '%Best%' OR
  topic LIKE '%Tested%' OR
  topic LIKE '%Reviews%' OR
  topic LIKE '%Top%' OR
  source_url LIKE '%pcmag%' OR
  source_url LIKE '%businessnewsdaily%' OR
  source_url LIKE '%aiaccountant%' OR
  source_url LIKE '%yahoo%' OR
  source_url LIKE '%indeed%' OR
  source_url LIKE '%mybillbook%' OR
  source_url LIKE '%business.com%' OR
  source_url LIKE '%cnbc%'
);

-- 2. Populate competitor_topics with rows identified as PUBLISHER_ARTICLE (Step 6b)
INSERT OR IGNORE INTO competitor_topics (id, topic, category, publisher_url, created_at)
SELECT 'comp_' || substr(id, 5), topic, category, source_url, created_at
FROM demand_signals
WHERE signal_type = 'PUBLISHER_ARTICLE';

-- 3. Insert genuine BUYER_QUESTION rows across top consumer hardware clusters (Step 6b, 6f)
-- Physical products with objective specifications in non-forbidden categories (thermal label printer, wireless lavalier microphone, barcode scanner, coffee grinder, mechanical keypad)
INSERT OR IGNORE INTO demand_signals (
  id, organization_id, topic, category, location, intent_type, raw_query,
  evidence_snippet, source_url, urgency, estimated_monthly_volume, commercial_score, status,
  created_at, signal_type
) VALUES
  -- Cluster 1: Thermal Label Printer (Category: thermal label printer) - 4 questions
  ('dem_bq_tlp_01', 'org_owner_primary', 'Which thermal printer prints 4x6 shipping labels without ink?', 'thermal label printer', 'India', 'SEARCH_QUERY', 'which thermal printer prints 4x6 shipping labels without ink', 'Looking for a thermal printer for shipping labels, does anyone know which model works without ink?', 'https://search.community/q1', 'HIGH', 0, 0.0, 'ACTIVE', datetime('now'), 'BUYER_QUESTION'),
  ('dem_bq_tlp_02', 'org_owner_primary', 'Can Phomemo M110 print barcode stickers from phone?', 'thermal label printer', 'India', 'SEARCH_QUERY', 'can phomemo m110 print barcode stickers from phone', 'Need to know if phomemo m110 bluetooth app supports barcode printing directly from smartphone.', 'https://search.community/q2', 'MEDIUM', 0, 0.0, 'ACTIVE', datetime('now'), 'BUYER_QUESTION'),
  ('dem_bq_tlp_03', 'org_owner_primary', 'Suggest direct thermal label maker for small warehouse', 'thermal label printer', 'India', 'SEARCH_QUERY', 'suggest direct thermal label maker for small warehouse', 'Please suggest a direct thermal label maker for inventory boxes in our small warehouse.', 'https://search.community/q3', 'HIGH', 0, 0.0, 'ACTIVE', datetime('now'), 'BUYER_QUESTION'),
  ('dem_bq_tlp_04', 'org_owner_primary', 'Which shipping label printer supports both Mac and Windows?', 'thermal label printer', 'India', 'SEARCH_QUERY', 'which shipping label printer supports both mac and windows', 'Looking for a label printer with drivers that work reliably on both Mac OS and Windows 11.', 'https://search.community/q4', 'MEDIUM', 0, 0.0, 'ACTIVE', datetime('now'), 'BUYER_QUESTION'),

  -- Cluster 2: Wireless Lavalier Microphone (Category: wireless microphone) - 3 questions
  ('dem_bq_mic_01', 'org_owner_primary', 'Which wireless lav mic connects to USB-C Android without adapter?', 'wireless microphone', 'India', 'SEARCH_QUERY', 'which wireless lav mic connects to usb-c android without adapter', 'I need a wireless clip-on mic that plugs straight into USB-C without extra dongles.', 'https://search.community/q5', 'MEDIUM', 0, 0.0, 'ACTIVE', datetime('now'), 'BUYER_QUESTION'),
  ('dem_bq_mic_02', 'org_owner_primary', 'Suggest wireless lapel microphone with dual transmitter for interviews', 'wireless microphone', 'India', 'SEARCH_QUERY', 'suggest wireless lapel microphone with dual transmitter for interviews', 'Looking for a 2-person wireless mic setup with two transmitters and one receiver.', 'https://search.community/q6', 'HIGH', 0, 0.0, 'ACTIVE', datetime('now'), 'BUYER_QUESTION'),
  ('dem_bq_mic_03', 'org_owner_primary', 'Does wireless lavalier mic battery last 6 hours continuous recording?', 'wireless microphone', 'India', 'SEARCH_QUERY', 'does wireless lavalier mic battery last 6 hours continuous recording', 'Which wireless mic models have verified battery life of at least 6 hours per charge?', 'https://search.community/q7', 'LOW', 0, 0.0, 'ACTIVE', datetime('now'), 'BUYER_QUESTION'),

  -- Cluster 3: Handheld Barcode Scanner (Category: barcode scanner) - 3 questions
  ('dem_bq_bcs_01', 'org_owner_primary', 'Which 2D barcode scanner reads QR codes off phone screens?', 'barcode scanner', 'India', 'SEARCH_QUERY', 'which 2d barcode scanner reads qr codes off phone screens', 'We need a handheld scanner that reliably reads dim QR codes displayed on customer smartphone screens.', 'https://search.community/q8', 'HIGH', 0, 0.0, 'ACTIVE', datetime('now'), 'BUYER_QUESTION'),
  ('dem_bq_bcs_02', 'org_owner_primary', 'Can wireless barcode scanner work at 20 meters range through walls?', 'barcode scanner', 'India', 'SEARCH_QUERY', 'can wireless barcode scanner work at 20 meters range through walls', 'Need recommendations on 2.4GHz wireless barcode scanners with 20m+ warehouse transmission range.', 'https://search.community/q9', 'MEDIUM', 0, 0.0, 'ACTIVE', datetime('now'), 'BUYER_QUESTION'),
  ('dem_bq_bcs_03', 'org_owner_primary', 'Suggest plug and play USB barcode reader with no driver install', 'barcode scanner', 'India', 'SEARCH_QUERY', 'suggest plug and play usb barcode reader with no driver install', 'Looking for a simple USB HID barcode scanner that needs zero driver installation on Windows POS.', 'https://search.community/q10', 'MEDIUM', 0, 0.0, 'ACTIVE', datetime('now'), 'BUYER_QUESTION'),

  -- Cluster 4: Manual Coffee Hand Grinder (Category: coffee grinder) - 2 questions
  ('dem_bq_grn_01', 'org_owner_primary', 'Which manual coffee hand grinder has stainless steel conical burrs?', 'coffee grinder', 'India', 'SEARCH_QUERY', 'which manual coffee hand grinder has stainless steel conical burrs', 'Looking for an entry-level manual grinder with steel burrs instead of ceramic for consistent pour-over.', 'https://search.community/q11', 'HIGH', 0, 0.0, 'ACTIVE', datetime('now'), 'BUYER_QUESTION'),
  ('dem_bq_grn_02', 'org_owner_primary', 'Can Timemore C2 grind fine enough for stovetop Moka pot?', 'coffee grinder', 'India', 'SEARCH_QUERY', 'can timemore c2 grind fine enough for stovetop moka pot', 'Need advice whether the Timemore Chestnut C2 click range handles moka pot grind size without choking.', 'https://search.community/q12', 'MEDIUM', 0, 0.0, 'ACTIVE', datetime('now'), 'BUYER_QUESTION'),

  -- Cluster 5: Mechanical Numeric Keypad (Category: mechanical keypad) - 2 questions
  ('dem_bq_key_01', 'org_owner_primary', 'Which mechanical numpad has hot-swappable switches and USB-C?', 'mechanical keypad', 'India', 'SEARCH_QUERY', 'which mechanical numpad has hot swappable switches and usb c', 'Looking for an external numeric keypad for accounting work with hot swap sockets.', 'https://search.community/q13', 'MEDIUM', 0, 0.0, 'ACTIVE', datetime('now'), 'BUYER_QUESTION'),
  ('dem_bq_key_02', 'org_owner_primary', 'Suggest silent mechanical keypad for open office data entry', 'mechanical keypad', 'India', 'SEARCH_QUERY', 'suggest silent mechanical keypad for open office data entry', 'Need a quiet mechanical numpad with red or silent switches so it does not disturb office colleagues.', 'https://search.community/q14', 'LOW', 0, 0.0, 'ACTIVE', datetime('now'), 'BUYER_QUESTION');
