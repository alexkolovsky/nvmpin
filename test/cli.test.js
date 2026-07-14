// End-to-end tests: spawn the real CLI with env pointed at fixtures.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeFixture, installFakePackage } from './fixtures/helpers.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function run(fx, args, extraEnv = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NVM_DIR: fx.nvmDir,
      NVMPIN_HOME: fx.home,
      NO_COLOR: '1',
      ...extraEnv,
    },
  });
}

test('cli: --help exits 0 and shows usage', () => {
  const fx = makeFixture();
  try {
    const r = run(fx, ['--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage:/);
  } finally {
    fx.cleanup();
  }
});

test('cli: unknown command exits 1 with hint', () => {
  const fx = makeFixture();
  try {
    const r = run(fx, ['frobnicate']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unknown command/);
    assert.match(r.stderr, /hint:/);
  } finally {
    fx.cleanup();
  }
});

test('cli: missing NVM_DIR is exit 2, no stack trace', () => {
  const fx = makeFixture();
  try {
    const r = run(fx, ['list'], { NVM_DIR: '/nonexistent/nvm' });
    // list itself doesn't touch nvm dir unless computing status; add does:
    const r2 = run(fx, ['add', 'x', '--node', '18'], { NVM_DIR: '/nonexistent/nvm' });
    assert.equal(r2.status, 2);
    assert.match(r2.stderr, /nvm directory not found/);
    assert.doesNotMatch(r2.stderr, /at .*\.js:\d+/, 'no stack trace without NVMPIN_DEBUG');
    assert.equal(r.status, 0);
  } finally {
    fx.cleanup();
  }
});

test('cli: add/list/remove round-trip through the real process', () => {
  const fx = makeFixture(['v18.20.4', 'v20.11.1']);
  try {
    installFakePackage(fx.nvmDir, 'v18.20.4', 'e2e-tool', { bin: { 'e2e-tool': 'cli.js' } });
    const addRes = run(fx, ['add', 'e2e-tool', '--node', '18']);
    assert.equal(addRes.status, 0, addRes.stderr);
    assert.match(addRes.stdout, /pinned e2e-tool -> node v18\.20\.4/);

    const listRes = run(fx, ['list', '--json']);
    const pins = JSON.parse(listRes.stdout);
    assert.equal(pins[0].package, 'e2e-tool');
    assert.equal(pins[0].status, 'ok');

    const rmRes = run(fx, ['remove', 'e2e-tool']);
    assert.equal(rmRes.status, 0);
    assert.ok(!fs.existsSync(path.join(fx.home, 'bin', 'e2e-tool')));
  } finally {
    fx.cleanup();
  }
});

test('cli: exec runs the pinned bin with the pinned node and passthrough args', () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    installFakePackage(fx.nvmDir, 'v18.20.4', 'runner', { bin: { runner: 'cli.js' } });
    run(fx, ['add', 'runner', '--node', '18']);
    const r = run(fx, ['exec', 'runner', '--', '--verbose', 'hello']);
    assert.equal(r.status, 0, r.stderr);
    // the fixture's fake node logs its argv
    const log = fs.readFileSync(
      path.join(fx.nvmDir, 'versions', 'node', 'v18.20.4', 'invocations.log'),
      'utf8'
    );
    assert.match(log, /lib\/node_modules\/runner\/cli\.js --verbose hello/);
  } finally {
    fx.cleanup();
  }
});

test('cli: generated shim actually executes via bash', () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    installFakePackage(fx.nvmDir, 'v18.20.4', 'shimmy', { bin: { shimmy: 'cli.js' } });
    run(fx, ['add', 'shimmy', '--node', '18']);
    const shim = path.join(fx.home, 'bin', 'shimmy');
    const r = spawnSync(shim, ['arg1'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const log = fs.readFileSync(
      path.join(fx.nvmDir, 'versions', 'node', 'v18.20.4', 'invocations.log'),
      'utf8'
    );
    assert.match(log, /shimmy\/cli\.js arg1/);
  } finally {
    fx.cleanup();
  }
});

test('cli: doctor exits 2 on problems, 0 when healthy', () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    installFakePackage(fx.nvmDir, 'v18.20.4', 'doc-tool', { bin: { 'doc-tool': 'cli.js' } });
    run(fx, ['add', 'doc-tool', '--node', '18']);
    const goodPath = `${path.join(fx.home, 'bin')}:${path.join(fx.nvmDir, 'versions/node/v18.20.4/bin')}:/usr/bin:/bin`;
    const ok = run(fx, ['doctor'], { PATH: goodPath });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);

    const bad = run(fx, ['doctor'], { PATH: '/usr/bin:/bin' });
    assert.equal(bad.status, 2);
    assert.match(bad.stdout, /not in PATH/);
  } finally {
    fx.cleanup();
  }
});

test('cli: setup is idempotent and prints the rc snippet', () => {
  const fx = makeFixture();
  try {
    // HOME rc file untouched: run non-interactively (no TTY -> confirm=false)
    const r = run(fx, ['setup']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /export PATH=/);
    assert.match(r.stdout, /nvmpin/);
    const r2 = run(fx, ['setup']);
    assert.equal(r2.status, 0);
  } finally {
    fx.cleanup();
  }
});
