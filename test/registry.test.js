import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { loadRegistry, saveRegistry, pinsPath, freshRegistry, validateRegistry } from '../src/registry.js';
import { makeTmpDir } from './fixtures/helpers.js';

test('registry: round-trip save and load', () => {
  const home = makeTmpDir();
  try {
    const reg = freshRegistry();
    reg.pins['left-pad'] = { node: 'v18.20.4', bins: ['left-pad'], pinnedAt: new Date().toISOString() };
    saveRegistry(home, reg);
    const { registry, recovered } = loadRegistry(home);
    assert.equal(recovered, false);
    assert.deepEqual(registry, reg);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('registry: missing file yields fresh registry without recovery', () => {
  const home = makeTmpDir();
  try {
    const { registry, recovered } = loadRegistry(home);
    assert.equal(recovered, false);
    assert.deepEqual(registry, freshRegistry());
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('registry: corrupt JSON is backed up and recovered fresh', () => {
  const home = makeTmpDir();
  try {
    fs.writeFileSync(pinsPath(home), '{ not json !!!');
    const { registry, recovered, backupPath } = loadRegistry(home);
    assert.equal(recovered, true);
    assert.deepEqual(registry, freshRegistry());
    assert.ok(fs.existsSync(backupPath));
    assert.match(backupPath, /corrupt-/);
    assert.equal(fs.readFileSync(backupPath, 'utf8'), '{ not json !!!');
    assert.ok(!fs.existsSync(pinsPath(home)), 'corrupt file moved aside');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('registry: schema-invalid JSON is treated as corrupt', () => {
  const home = makeTmpDir();
  try {
    fs.writeFileSync(pinsPath(home), JSON.stringify({ version: 99, pins: 'nope' }));
    const { recovered } = loadRegistry(home);
    assert.equal(recovered, true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('registry: validateRegistry rejects bad pin shapes', () => {
  assert.equal(validateRegistry(freshRegistry()), true);
  assert.equal(validateRegistry({ version: 1, pins: { a: { node: '18', bins: [], pinnedAt: 'x' } } }), false);
  assert.equal(validateRegistry({ version: 1, pins: { a: { node: 'v18.0.0', bins: [1], pinnedAt: 'x' } } }), false);
  assert.equal(validateRegistry(null), false);
  assert.equal(validateRegistry([]), false);
});

test('registry: saveRegistry refuses invalid data', () => {
  const home = makeTmpDir();
  try {
    assert.throws(() => saveRegistry(home, { version: 2, pins: {} }));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('registry: atomic write leaves no tmp files behind', () => {
  const home = makeTmpDir();
  try {
    saveRegistry(home, freshRegistry());
    const leftovers = fs.readdirSync(home).filter((f) => f.includes('.tmp-'));
    assert.deepEqual(leftovers, []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
