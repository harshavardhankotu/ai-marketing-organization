import type { Database } from 'better-sqlite3';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';

export interface ProspectLookupRow {
  prospect_business_name?: string | null;
  business_name?: string | null;
  email?: string | null;
  prospect_email?: string | null;
  phone?: string | null;
  prospect_phone?: string | null;
  city?: string | null;
  prospect_city?: string | null;
  website_url?: string | null;
  prospect_website?: string | null;
  status?: string | null;
  prospect_vertical?: string | null;
}

/**
 * Batch-fetches matching `platform_prospects` rows by `prospect_business_name` or `business_name`
 * using bounded `IN (...)` queries instead of an unindexed `LEFT JOIN ... OR ...` scan.
 */
export async function batchLookupProspectsByName(
  prospectNames: Array<string | null | undefined>,
  options: { useRemoteD1: boolean; d1Repo: D1RevenueRepository; db?: Database }
): Promise<Map<string, ProspectLookupRow>> {
  const uniqueNames = Array.from(
    new Set(
      prospectNames
        .map(n => (typeof n === 'string' ? n.trim() : ''))
        .filter(Boolean)
    )
  ).slice(0, 50);

  const map = new Map<string, ProspectLookupRow>();
  if (uniqueNames.length === 0) return map;

  const placeholders = uniqueNames.map(() => '?').join(', ');
  const limit = uniqueNames.length * 2;
  const sqlByProspectName = `
    SELECT prospect_business_name, business_name, email, prospect_email, phone, prospect_phone,
           city, prospect_city, website_url, prospect_website, status, prospect_vertical
    FROM platform_prospects
    WHERE prospect_business_name IN (${placeholders})
    LIMIT ${limit}
  `;
  const sqlByBusinessName = `
    SELECT prospect_business_name, business_name, email, prospect_email, phone, prospect_phone,
           city, prospect_city, website_url, prospect_website, status, prospect_vertical
    FROM platform_prospects
    WHERE business_name IN (${placeholders})
    LIMIT ${limit}
  `;

  const runQuery = async (sql: string, params: string[]): Promise<ProspectLookupRow[]> => {
    if (options.useRemoteD1 && options.d1Repo.isRemoteD1ReadAllowed()) {
      try {
        return await options.d1Repo.query<ProspectLookupRow>('platform_prospects', sql, params);
      } catch {
        // Fall back to local SQLite only if local db provided in non-prod
      }
    }
    if (options.db) {
      try {
        return options.db.prepare(sql).all(...params) as ProspectLookupRow[];
      } catch {
        return [];
      }
    }
    return [];
  };

  const rowsA = await runQuery(sqlByProspectName, uniqueNames);
  const indexRow = (row: ProspectLookupRow) => {
    const k1 = (row.prospect_business_name || '').trim().toLowerCase();
    const k2 = (row.business_name || '').trim().toLowerCase();
    if (k1 && !map.has(k1)) map.set(k1, row);
    if (k2 && !map.has(k2)) map.set(k2, row);
  };
  for (const r of rowsA) indexRow(r);

  const missingNames = uniqueNames.filter(n => !map.has(n.toLowerCase()));
  if (missingNames.length > 0) {
    const missingPlaceholders = missingNames.map(() => '?').join(', ');
    const sqlMissing = sqlByBusinessName.replace(`IN (${placeholders})`, `IN (${missingPlaceholders})`);
    const rowsB = await runQuery(sqlMissing, missingNames);
    for (const r of rowsB) indexRow(r);
  }

  return map;
}
