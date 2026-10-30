import crypto from 'node:crypto';
import { getNxshaCatalogCache, putNxshaCatalogCache } from '../db/repository.ts';

export const NXSHA_CATALOG_UNAVAILABLE = {
  code: 'NXSHA_CATALOG_API_ACCESS_REQUIRED',
  provider: 'Nxsha',
  state: 'unavailable' as const,
  error: 'Nxsha catalog API access is required.',
  message: 'Nxsha has not published a supported catalog API for this feature. Catalog data is unavailable until authorized API access and documentation are provided.',
};

export class NxshaCatalogUnavailableError extends Error {
  readonly status = 503;
  readonly code = NXSHA_CATALOG_UNAVAILABLE.code;

  constructor() {
    super(NXSHA_CATALOG_UNAVAILABLE.message);
    this.name = 'NxshaCatalogUnavailableError';
  }
}

/** The key is a one-way digest so search terms are not stored in the cache key. */
export function nxshaCatalogCacheKey(scope: string, parameters: Record<string, string | number | undefined>): string {
  const canonical = Object.entries(parameters)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value).trim()}`)
    .join('&');
  return crypto.createHash('sha256').update(`nxsha:${scope}:${canonical}`).digest('hex');
}

/** Read only unexpired metadata. Expired responses must be refreshed from Nxsha before use. */
export function readNxshaCatalogCache<T = unknown>(cacheKey: string): Promise<T | null> {
  return getNxshaCatalogCache<T>(cacheKey);
}

/** Store a verified response from the officially authorized Nxsha catalog integration. */
export function refreshNxshaCatalogCache(cacheKey: string, payload: unknown, ttlMs = 15 * 60 * 1000): Promise<void> {
  return putNxshaCatalogCache(cacheKey, payload, ttlMs);
}

export async function checkCatalogHealth() {
  return {
    status: 'unavailable' as const,
    timestamp: new Date().toISOString(),
    provider: {
      name: 'Nxsha',
      catalogApi: {
        status: 'unavailable' as const,
        documented: false,
        reason: 'official_catalog_api_access_required',
      },
      playerIntegration: {
        status: 'documented' as const,
        identifierRequirement: 'Nxsha Embed documentation specifies TMDb or IMDb identifiers.',
      },
    },
  };
}
