import test from 'node:test';
import assert from 'node:assert/strict';
import { canUseNxshaEmbedTest } from './nxshaEmbedAccess.ts';

test('Nxsha private player access is disabled by default', () => {
  assert.equal(canUseNxshaEmbedTest('account-1', {}), false);
  assert.equal(canUseNxshaEmbedTest('account-1', {
    enabled: 'false',
    accountUid: 'account-1',
  }), false);
});

test('Nxsha private player access is limited to the configured Firebase UID', () => {
  const config = { enabled: 'true', accountUid: ' account-1 ' };
  assert.equal(canUseNxshaEmbedTest('account-1', config), true);
  assert.equal(canUseNxshaEmbedTest('account-2', config), false);
  assert.equal(canUseNxshaEmbedTest(undefined, config), false);
  assert.equal(canUseNxshaEmbedTest('account-1', { enabled: 'true' }), false);
});
