import test from 'node:test';
import assert from 'node:assert';
import { satisfies } from '../src/semver.js';

test('satisfies: common range forms', () => {
  assert.equal(satisfies('v18.20.4', '>=18'), true);
  assert.equal(satisfies('v18.20.4', '>=20'), false);
  assert.equal(satisfies('v18.20.4', '^18.0.0'), true);
  assert.equal(satisfies('v18.20.4', '~18.20.0'), true);
  assert.equal(satisfies('v18.20.4', '~18.19.0'), false);
  assert.equal(satisfies('v18.20.4', '18.x'), true);
  assert.equal(satisfies('v18.20.4', '16 || 18'), true);
  assert.equal(satisfies('v18.20.4', '>=16 <19'), true);
  assert.equal(satisfies('v18.20.4', '>=16 <18'), false);
});

test('satisfies: whitespace between operator and version (npm-legal, e.g. cowsay ">= 4")', () => {
  assert.equal(satisfies('v22.21.1', '>= 4'), true);
  assert.equal(satisfies('v2.0.0', '>= 4'), false);
  assert.equal(satisfies('v18.20.4', '>= 16 < 19'), true);
});

test('satisfies: unparseable ranges return null, never a guess', () => {
  assert.equal(satisfies('v18.20.4', '>=18.0.0-rc.1'), null);
  assert.equal(satisfies('v18.20.4', 'weird-range'), null);
});
