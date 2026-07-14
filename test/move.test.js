import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import add from '../src/commands/add.js';
import move from '../src/commands/move.js';
import { loadRegistry, shimDir } from '../src/registry.js';
import { parseShim } from '../src/shims.js';
import { makeFixture, installFakePackage, makeUiStub } from './fixtures/helpers.js';

function makeCtx(fx, { flags = {}, installer, ui } = {}) {
  return {
    env: {},
    home: fx.home,
    nvmDir: fx.nvmDir,
    ui: ui ?? makeUiStub(),
    flags: { json: false, yes: true, ...flags },
    passthrough: [],
    installer: installer ?? { isInstalled: () => true, install: () => {} },
  };
}

async function setupPinned(fx) {
  installFakePackage(fx.nvmDir, 'v18.20.4', 'tool', { bin: { tool: 'cli.js' }, version: '3.1.4' });
  await add(makeCtx(fx, { flags: { node: '18' } }), ['tool']);
}

test('move: reinstalls into the new version and rewrites shims + registry', async () => {
  const fx = makeFixture(['v18.20.4', 'v20.11.1']);
  try {
    await setupPinned(fx);
    const installs = [];
    const installer = {
      isInstalled: () => true,
      install: (nvmDir, version, spec) => {
        installs.push([version, spec]);
        installFakePackage(nvmDir, version, 'tool', { bin: { tool: 'cli.js' }, version: '3.1.4' });
      },
    };
    const code = await move(makeCtx(fx, { flags: { node: '20' }, installer }), ['tool']);
    assert.equal(code, 0);
    // full reinstall, preserving the installed package version
    assert.deepEqual(installs, [['v20.11.1', 'tool@3.1.4']]);
    const { registry } = loadRegistry(fx.home);
    assert.equal(registry.pins.tool.node, 'v20.11.1');
    const shim = parseShim(path.join(shimDir(fx.home), 'tool'));
    assert.deepEqual(shim, { pkg: 'tool', version: 'v20.11.1' });
  } finally {
    fx.cleanup();
  }
});

test('move: rolls back registry and shims when install fails', async () => {
  const fx = makeFixture(['v18.20.4', 'v20.11.1']);
  try {
    await setupPinned(fx);
    const before = loadRegistry(fx.home).registry;
    const installer = {
      isInstalled: () => true,
      install: () => {
        throw new Error('network exploded');
      },
    };
    await assert.rejects(
      () => move(makeCtx(fx, { flags: { node: '20' }, installer }), ['tool']),
      /network exploded/
    );
    const after = loadRegistry(fx.home).registry;
    assert.deepEqual(after, before, 'registry unchanged after failed move');
    const shim = parseShim(path.join(shimDir(fx.home), 'tool'));
    assert.deepEqual(shim, { pkg: 'tool', version: 'v18.20.4' }, 'shim still points at old version');
  } finally {
    fx.cleanup();
  }
});

test('move: rolls back when shim generation fails after install (no bin field)', async () => {
  const fx = makeFixture(['v18.20.4', 'v20.11.1']);
  try {
    await setupPinned(fx);
    const installer = {
      isInstalled: () => true,
      // installs a broken package with no bins — readBins will throw
      install: (nvmDir, version) => installFakePackage(nvmDir, version, 'tool', { version: '3.1.4' }),
    };
    await assert.rejects(() => move(makeCtx(fx, { flags: { node: '20' }, installer }), ['tool']));
    const { registry } = loadRegistry(fx.home);
    assert.equal(registry.pins.tool.node, 'v18.20.4');
  } finally {
    fx.cleanup();
  }
});

test('move: to the same version is a no-op', async () => {
  const fx = makeFixture(['v18.20.4', 'v20.11.1']);
  try {
    await setupPinned(fx);
    const ui = makeUiStub();
    const code = await move(makeCtx(fx, { flags: { node: '18' }, ui }), ['tool']);
    assert.equal(code, 0);
    assert.ok(ui.lines.some((l) => l.includes('nothing to do')));
  } finally {
    fx.cleanup();
  }
});

test('move: unpinned package is a user error', async () => {
  const fx = makeFixture(['v18.20.4', 'v20.11.1']);
  try {
    await assert.rejects(() => move(makeCtx(fx, { flags: { node: '20' } }), ['ghost']), /not pinned/);
  } finally {
    fx.cleanup();
  }
});
