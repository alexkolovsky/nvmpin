import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import doctor from '../src/commands/doctor.js';
import add from '../src/commands/add.js';
import { shimDir, pinsPath } from '../src/registry.js';
import { shimContent } from '../src/shims.js';
import { makeFixture, installFakePackage, makeUiStub } from './fixtures/helpers.js';

function goodPath(fx) {
  // shim dir first, then an nvm bin dir — the healthy ordering
  return `${shimDir(fx.home)}:${path.join(fx.nvmDir, 'versions', 'node', 'v18.20.4', 'bin')}:/usr/bin:/bin`;
}

function makeCtx(fx, { flags = {}, ui, PATH } = {}) {
  return {
    env: { PATH: PATH ?? goodPath(fx) },
    home: fx.home,
    nvmDir: fx.nvmDir,
    ui: ui ?? makeUiStub(),
    flags: { json: false, yes: true, ...flags },
    passthrough: [],
    installer: { isInstalled: () => true, install: () => {} },
  };
}

async function pinTool(fx, name = 'tool', version = '18') {
  installFakePackage(fx.nvmDir, version.startsWith('v') ? version : 'v18.20.4', name, { bin: { [name]: 'cli.js' } });
  await add(makeCtx(fx, { flags: { node: version } }), [name]);
}

test('doctor: healthy setup passes with exit 0', async () => {
  const fx = makeFixture(['v18.20.4', 'v20.11.1']);
  try {
    await pinTool(fx);
    const ui = makeUiStub();
    const code = await doctor(makeCtx(fx, { ui }));
    assert.equal(code, 0);
    assert.ok(ui.lines.some((l) => l.includes('all checks passed')));
  } finally {
    fx.cleanup();
  }
});

test('doctor: detects missing node version', async () => {
  const fx = makeFixture(['v18.20.4', 'v20.11.1']);
  try {
    await pinTool(fx);
    fs.rmSync(path.join(fx.nvmDir, 'versions', 'node', 'v18.20.4'), { recursive: true });
    const ui = makeUiStub();
    const code = await doctor(makeCtx(fx, { ui }));
    assert.equal(code, 2);
    assert.ok(ui.lines.some((l) => l.includes('v18.20.4') && l.includes('not installed')));
  } finally {
    fx.cleanup();
  }
});

test('doctor: detects orphaned shim', async () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    await pinTool(fx);
    fs.writeFileSync(
      path.join(shimDir(fx.home), 'stray'),
      shimContent('stray-pkg', 'v18.20.4', '/abs/path', 'cli.js'),
      { mode: 0o755 }
    );
    const ui = makeUiStub();
    const code = await doctor(makeCtx(fx, { ui }));
    assert.equal(code, 2);
    assert.ok(ui.lines.some((l) => l.includes('orphaned shim "stray"')));
  } finally {
    fx.cleanup();
  }
});

test('doctor: detects shim drift (shim disagrees with registry)', async () => {
  const fx = makeFixture(['v18.20.4', 'v20.11.1']);
  try {
    await pinTool(fx);
    fs.writeFileSync(
      path.join(shimDir(fx.home), 'tool'),
      shimContent('tool', 'v20.11.1', '/wrong/path', 'cli.js'),
      { mode: 0o755 }
    );
    const ui = makeUiStub();
    const code = await doctor(makeCtx(fx, { ui }));
    assert.equal(code, 2);
    assert.ok(ui.lines.some((l) => l.includes('registry pins tool@v18.20.4')));
  } finally {
    fx.cleanup();
  }
});

test('doctor: detects PATH ordering problem (nvm bin before shim dir)', async () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    await pinTool(fx);
    const nvmBin = path.join(fx.nvmDir, 'versions', 'node', 'v18.20.4', 'bin');
    const ui = makeUiStub();
    const code = await doctor(makeCtx(fx, { ui, PATH: `${nvmBin}:${shimDir(fx.home)}:/usr/bin` }));
    assert.equal(code, 2);
    assert.ok(ui.lines.some((l) => l.includes('after an nvm bin directory')));
  } finally {
    fx.cleanup();
  }
});

test('doctor: detects shim dir missing from PATH entirely', async () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    await pinTool(fx);
    const ui = makeUiStub();
    const code = await doctor(makeCtx(fx, { ui, PATH: '/usr/bin:/bin' }));
    assert.equal(code, 2);
    assert.ok(ui.lines.some((l) => l.includes('not in PATH')));
  } finally {
    fx.cleanup();
  }
});

test('doctor: reports corrupt pins.json', async () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    fs.writeFileSync(pinsPath(fx.home), 'garbage{');
    const ui = makeUiStub();
    const code = await doctor(makeCtx(fx, { ui }));
    assert.equal(code, 2);
    assert.ok(ui.lines.some((l) => l.includes('corrupt')));
  } finally {
    fx.cleanup();
  }
});
