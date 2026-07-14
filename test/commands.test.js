import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import add from '../src/commands/add.js';
import remove from '../src/commands/remove.js';
import list from '../src/commands/list.js';
import scan from '../src/commands/scan.js';
import { loadRegistry, shimDir } from '../src/registry.js';
import { UserError } from '../src/errors.js';
import { makeFixture, installFakePackage, makeUiStub } from './fixtures/helpers.js';

function makeCtx(fx, { flags = {}, installer, ui } = {}) {
  return {
    env: {},
    home: fx.home,
    nvmDir: fx.nvmDir,
    ui: ui ?? makeUiStub(),
    flags: { json: false, yes: true, ...flags },
    passthrough: [],
    installer: installer ?? {
      isInstalled: () => true,
      install: () => { throw new Error('unexpected install'); },
      uninstall: () => {},
    },
  };
}

test('add: pins an already-installed package and writes shims + registry', async () => {
  const fx = makeFixture(['v18.20.4', 'v20.11.1']);
  try {
    installFakePackage(fx.nvmDir, 'v18.20.4', 'mytool', { bin: { mytool: 'cli.js' } });
    const code = await add(makeCtx(fx, { flags: { node: '18' } }), ['mytool']);
    assert.equal(code, 0);
    const { registry } = loadRegistry(fx.home);
    assert.equal(registry.pins.mytool.node, 'v18.20.4');
    assert.deepEqual(registry.pins.mytool.bins, ['mytool']);
    assert.ok(fs.existsSync(path.join(shimDir(fx.home), 'mytool')));
  } finally {
    fx.cleanup();
  }
});

test('add: installs via the target version installer when not present', async () => {
  const fx = makeFixture(['v20.11.1']);
  try {
    const calls = [];
    const installer = {
      isInstalled: () => false,
      install: (nvmDir, version, spec) => {
        calls.push([version, spec]);
        installFakePackage(nvmDir, version, 'newtool', { bin: { newtool: 'cli.js' } });
      },
    };
    await add(makeCtx(fx, { flags: { node: '20' }, installer }), ['newtool@2.0.0']);
    assert.deepEqual(calls, [['v20.11.1', 'newtool@2.0.0']]);
    const { registry } = loadRegistry(fx.home);
    assert.equal(registry.pins.newtool.node, 'v20.11.1');
  } finally {
    fx.cleanup();
  }
});

test('add: warns on engines.node conflict but proceeds', async () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    installFakePackage(fx.nvmDir, 'v18.20.4', 'needs20', { bin: { needs20: 'cli.js' }, engines: { node: '>=20' } });
    const ui = makeUiStub();
    const code = await add(makeCtx(fx, { flags: { node: '18' }, ui }), ['needs20']);
    assert.equal(code, 0);
    assert.ok(ui.errors.some((l) => l.includes('engines.node')), 'warned about engines conflict');
    const { registry } = loadRegistry(fx.home);
    assert.ok(registry.pins.needs20);
  } finally {
    fx.cleanup();
  }
});

test('add: explicit --node with unparseable engines range warns "couldn\'t verify"', async () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    installFakePackage(fx.nvmDir, 'v18.20.4', 'weird', {
      bin: { weird: 'cli.js' },
      engines: { node: '>=18.0.0-rc.1' }, // prerelease comparator: unsupported syntax
    });
    const ui = makeUiStub();
    const code = await add(makeCtx(fx, { flags: { node: '18' }, ui }), ['weird']);
    assert.equal(code, 0, 'unverifiable range never blocks');
    assert.ok(
      ui.errors.some((l) => l.includes("couldn't verify engines compatibility")),
      `expected a couldn't-verify warning, got: ${ui.errors.join('\n')}`
    );
  } finally {
    fx.cleanup();
  }
});

test('add: without --node suggests a version from engines.node', async () => {
  const fx = makeFixture(['v18.20.4', 'v20.11.1']);
  try {
    installFakePackage(fx.nvmDir, 'v18.20.4', 'legacy', { bin: { legacy: 'cli.js' }, engines: { node: '^18.0.0' } });
    installFakePackage(fx.nvmDir, 'v20.11.1', 'legacy', { bin: { legacy: 'cli.js' }, engines: { node: '^18.0.0' } });
    await add(makeCtx(fx), ['legacy']);
    const { registry } = loadRegistry(fx.home);
    assert.equal(registry.pins.legacy.node, 'v18.20.4');
  } finally {
    fx.cleanup();
  }
});

test('add: without --node and no engines info errors listing versions', async () => {
  const fx = makeFixture(['v18.20.4', 'v20.11.1']);
  try {
    await assert.rejects(
      () => add(makeCtx(fx, { installer: { isInstalled: () => false, install: () => {} } }), ['mystery']),
      (err) => err instanceof UserError && /v20\.11\.1, v18\.20\.4/.test(err.hint)
    );
  } finally {
    fx.cleanup();
  }
});

test('add: re-pinning to a different version is rejected, suggests move', async () => {
  const fx = makeFixture(['v18.20.4', 'v20.11.1']);
  try {
    installFakePackage(fx.nvmDir, 'v18.20.4', 'tool', { bin: { tool: 'cli.js' } });
    await add(makeCtx(fx, { flags: { node: '18' } }), ['tool']);
    await assert.rejects(
      () => add(makeCtx(fx, { flags: { node: '20' } }), ['tool']),
      /already pinned/
    );
  } finally {
    fx.cleanup();
  }
});

test('remove: deletes shims and registry entry; --uninstall calls installer', async () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    installFakePackage(fx.nvmDir, 'v18.20.4', 'tool', { bin: { tool: 'cli.js' } });
    await add(makeCtx(fx, { flags: { node: '18' } }), ['tool']);

    const uninstalled = [];
    const installer = { uninstall: (nvmDir, v, pkg) => uninstalled.push([v, pkg]) };
    await remove(makeCtx(fx, { flags: { uninstall: true }, installer }), ['tool']);

    assert.ok(!fs.existsSync(path.join(shimDir(fx.home), 'tool')));
    const { registry } = loadRegistry(fx.home);
    assert.deepEqual(registry.pins, {});
    assert.deepEqual(uninstalled, [['v18.20.4', 'tool']]);
  } finally {
    fx.cleanup();
  }
});

test('remove: unknown package is a user error', async () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    await assert.rejects(() => remove(makeCtx(fx), ['ghost']), UserError);
  } finally {
    fx.cleanup();
  }
});

test('list: reports ok / node version missing / broken shim statuses', async () => {
  const fx = makeFixture(['v18.20.4', 'v20.11.1']);
  try {
    installFakePackage(fx.nvmDir, 'v18.20.4', 'good', { bin: { good: 'cli.js' } });
    installFakePackage(fx.nvmDir, 'v20.11.1', 'gone', { bin: { gone: 'cli.js' } });
    installFakePackage(fx.nvmDir, 'v18.20.4', 'broken', { bin: { broken: 'cli.js' } });
    await add(makeCtx(fx, { flags: { node: '18' } }), ['good']);
    await add(makeCtx(fx, { flags: { node: '20' } }), ['gone']);
    await add(makeCtx(fx, { flags: { node: '18' } }), ['broken']);

    fs.rmSync(path.join(fx.nvmDir, 'versions', 'node', 'v20.11.1'), { recursive: true });
    fs.rmSync(path.join(shimDir(fx.home), 'broken'));

    const ui = makeUiStub();
    await list(makeCtx(fx, { flags: { json: true }, ui }));
    const out = JSON.parse(ui.lines.join('\n'));
    const byPkg = Object.fromEntries(out.map((e) => [e.package, e.status]));
    assert.equal(byPkg.good, 'ok');
    assert.equal(byPkg.gone, 'node version missing');
    assert.equal(byPkg.broken, 'broken shim');
  } finally {
    fx.cleanup();
  }
});

test('scan: reports packages across versions, duplicates, pins', async () => {
  const fx = makeFixture(['v18.20.4', 'v20.11.1']);
  try {
    installFakePackage(fx.nvmDir, 'v18.20.4', 'both', { bin: { both: 'cli.js' } });
    installFakePackage(fx.nvmDir, 'v20.11.1', 'both', { bin: { both: 'cli.js' } });
    installFakePackage(fx.nvmDir, 'v20.11.1', 'only20', { bin: { only20: 'cli.js' } });
    installFakePackage(fx.nvmDir, 'v18.20.4', 'npm', {}); // bundled — excluded
    await add(makeCtx(fx, { flags: { node: '20' } }), ['only20']);

    const ui = makeUiStub();
    await scan(makeCtx(fx, { flags: { json: true }, ui }));
    const out = JSON.parse(ui.lines.join('\n'));
    const byPkg = Object.fromEntries(out.packages.map((p) => [p.package, p]));
    assert.equal(byPkg.both.duplicate, true);
    assert.deepEqual(byPkg.both.versions.sort(), ['v18.20.4', 'v20.11.1']);
    assert.equal(byPkg.both.pinned, null);
    assert.equal(byPkg.only20.pinned, 'v20.11.1');
    assert.ok(!byPkg.npm, 'bundled npm excluded');
  } finally {
    fx.cleanup();
  }
});
