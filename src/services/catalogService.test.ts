import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkCatalogHealth,
  NXSHA_CATALOG_UNAVAILABLE,
  nxshaCatalogCacheKey,
  NxshaCatalogUnavailableError,
} from './catalogService.ts';

test('catalog health reports Nxsha catalog access as unavailable while player embeds are documented', async () => {
  const health = await checkCatalogHealth();
  assert.equal(health.status, 'unavailable');
  assert.equal(health.provider.name, 'Nxsha');
  assert.equal(health.provider.catalogApi.documented, false);
  assert.equal(health.provider.catalogApi.status, 'unavailable');
  assert.equal(health.provider.playerIntegration.status, 'documented');
});

test('catalog unavailable error is an explicit 503 and does not select a fallback provider', () => {
  const error = new NxshaCatalogUnavailableError();
  assert.equal(error.status, 503);
  assert.equal(error.code, NXSHA_CATALOG_UNAVAILABLE.code);
  assert.match(error.message, /authorized API access/i);
});

test('catalog cache keys are stable, scoped and do not reveal search terms', () => {
  const first = nxshaCatalogCacheKey('search', { query: 'a private search', type: 'all', page: 1 });
  const reordered = nxshaCatalogCacheKey('search', { page: 1, type: 'all', query: 'a private search' });
  const differentQuery = nxshaCatalogCacheKey('search', { query: 'another title', type: 'all', page: 1 });
  assert.equal(first, reordered);
  assert.notEqual(first, differentQuery);
  assert.doesNotMatch(first, /private search/i);
});
