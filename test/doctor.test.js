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

test('doctor: reports corrupt pins.json without touching it — second run still exits 2', async () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    fs.writeFileSync(pinsPath(fx.home), 'garbage{');
    const ui = makeUiStub();
    const code = await doctor(makeCtx(fx, { ui }));
    assert.equal(code, 2);
    assert.ok(ui.lines.some((l) => l.includes('corrupt')));
    // doctor must not self-heal: file untouched, no backup created
    assert.equal(fs.readFileSync(pinsPath(fx.home), 'utf8'), 'garbage{');
    assert.deepEqual(fs.readdirSync(fx.home).filter((f) => f.includes('corrupt-')), []);

    const code2 = await doctor(makeCtx(fx, { ui: makeUiStub() }));
    assert.equal(code2, 2, 'second doctor run must still fail');
  } finally {
    fx.cleanup();
  }
});

test('doctor: corrupt registry plus existing shims yields BOTH corruption and orphan findings', async () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    await pinTool(fx);
    fs.writeFileSync(pinsPath(fx.home), '{ broken');
    const ui = makeUiStub();
    const code = await doctor(makeCtx(fx, { ui }));
    assert.equal(code, 2);
    const out = ui.lines.join('\n');
    assert.match(out, /corrupt/);
    assert.match(out, /orphaned shim "tool" \(for tool\)/);
  } finally {
    fx.cleanup();
  }
});

test('doctor: orphaned shim against a valid empty registry names the package', async () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    fs.writeFileSync(
      path.join(shimDir(fx.home), 'lonely'),
      shimContent('lonely-pkg', 'v18.20.4', '/abs/path', 'cli.js'),
      { mode: 0o755 }
    );
    const ui = makeUiStub();
    const code = await doctor(makeCtx(fx, { ui }));
    assert.equal(code, 2);
    assert.ok(ui.lines.some((l) => l.includes('orphaned shim "lonely" (for lonely-pkg)')));
  } finally {
    fx.cleanup();
  }
});

test('doctor: orphan finding mentions the pins.json.corrupt-* backup when one exists', async () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    await pinTool(fx);
    fs.writeFileSync(pinsPath(fx.home), '{ broken'); // corrupt the registry
    // write-path recovery (as `add` would do) moves it aside
    fs.renameSync(pinsPath(fx.home), path.join(fx.home, 'pins.json.corrupt-1234'));
    const ui = makeUiStub();
    const code = await doctor(makeCtx(fx, { ui }));
    assert.equal(code, 2);
    assert.ok(
      ui.lines.some((l) => l.includes('pins.json.corrupt-1234')),
      `expected backup mention, got:\n${ui.lines.join('\n')}`
    );
  } finally {
    fx.cleanup();
  }
});
