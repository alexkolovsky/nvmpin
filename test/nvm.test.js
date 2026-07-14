import test from 'node:test';
import assert from 'node:assert';
import { resolveVersion, listVersions, listGlobalPackages } from '../src/nvm.js';
import { UserError, EnvError } from '../src/errors.js';
import { makeFixture, installFakePackage } from './fixtures/helpers.js';

const INSTALLED = ['v20.11.1', 'v18.20.4', 'v18.19.0', 'v18.2.4'];

test('resolveVersion: major resolves to newest matching', () => {
  assert.equal(resolveVersion('18', INSTALLED), 'v18.20.4');
});

test('resolveVersion: major.minor resolves to newest patch of that minor', () => {
  assert.equal(resolveVersion('18.19', INSTALLED), 'v18.19.0');
});

test('resolveVersion: exact match with and without v prefix', () => {
  assert.equal(resolveVersion('v18.20.4', INSTALLED), 'v18.20.4');
  assert.equal(resolveVersion('18.20.4', INSTALLED), 'v18.20.4');
});

test('resolveVersion: minor is matched exactly, not as prefix (18.2 != 18.20)', () => {
  assert.equal(resolveVersion('18.2', INSTALLED), 'v18.2.4');
});

test('resolveVersion: no match is an environment error listing installed versions', () => {
  assert.throws(() => resolveVersion('16', INSTALLED), EnvError);
  assert.throws(() => resolveVersion('16', INSTALLED), /no installed node version matches "16"/);
});

test('resolveVersion: rejects nvm aliases with a helpful message', () => {
  for (const alias of ['lts/hydrogen', 'lts', 'stable', 'node', 'default', 'system']) {
    assert.throws(() => resolveVersion(alias, INSTALLED), UserError);
  }
  assert.throws(() => resolveVersion('lts/hydrogen', INSTALLED), /aliases/);
});

test('resolveVersion: rejects garbage input', () => {
  assert.throws(() => resolveVersion('banana', INSTALLED), UserError);
  assert.throws(() => resolveVersion('18.x.y', INSTALLED), UserError);
});

test('listVersions: reads fixture tree sorted newest first', () => {
  const fx = makeFixture(['v18.20.4', 'v20.11.1', 'v18.19.0']);
  try {
    assert.deepEqual(listVersions(fx.nvmDir), ['v20.11.1', 'v18.20.4', 'v18.19.0']);
  } finally {
    fx.cleanup();
  }
});

test('listVersions: missing NVM_DIR is an environment error', () => {
  assert.throws(() => listVersions('/nonexistent/nvm-dir'), EnvError);
});

test('listGlobalPackages: finds plain and scoped packages, skips .bin', () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    installFakePackage(fx.nvmDir, 'v18.20.4', 'left-pad', { bin: 'cli.js' });
    installFakePackage(fx.nvmDir, 'v18.20.4', '@scope/tool', { bin: { tool: 'bin/tool.js' } });
    assert.deepEqual(listGlobalPackages(fx.nvmDir, 'v18.20.4'), ['@scope/tool', 'left-pad']);
  } finally {
    fx.cleanup();
  }
});
