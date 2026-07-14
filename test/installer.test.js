import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInstaller } from '../src/installer.js';
import { EnvError } from '../src/errors.js';
import { makeFixture, installFakePackage } from './fixtures/helpers.js';

test('installer: runs the target version node/npm with its bin dir first in PATH', () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    const vp = path.join(fx.nvmDir, 'versions', 'node', 'v18.20.4');
    // fake node that records the PATH npm (and its lifecycle scripts) would see
    fs.writeFileSync(
      path.join(vp, 'bin', 'node'),
      `#!/usr/bin/env bash\necho "argv=$*" >> "${vp}/invocations.log"\necho "PATH=$PATH" >> "${vp}/invocations.log"\nexit 0\n`,
      { mode: 0o755 }
    );
    createInstaller().install(fx.nvmDir, 'v18.20.4', 'some-pkg@1.0.0');
    const log = fs.readFileSync(path.join(vp, 'invocations.log'), 'utf8');
    assert.match(log, /argv=.*npm install -g some-pkg@1\.0\.0/);
    const pathLine = log.split('\n').find((l) => l.startsWith('PATH='));
    assert.ok(
      pathLine.startsWith(`PATH=${path.join(vp, 'bin')}:`),
      `target bin dir must be first in PATH so npm lifecycle scripts (node-gyp, postinstall) ` +
        `use the target node, not the ambient one — got: ${pathLine}`
    );
  } finally {
    fx.cleanup();
  }
});

// Fake node that dumps the full spawned env to env.log and, on `npm install`,
// simulates npm honoring $npm_config_prefix (installs into
// $npm_config_prefix/lib/node_modules/<pkg>) — mirroring the env>userconfig
// precedence verified against real npm 10.8.2.
function stubEnvDumpingNode(fx, version = 'v18.20.4') {
  const vp = path.join(fx.nvmDir, 'versions', 'node', version);
  fs.writeFileSync(
    path.join(vp, 'bin', 'node'),
    `#!/usr/bin/env bash
env >> "${vp}/env.log"
if [ "$2" = "install" ]; then
  mkdir -p "$npm_config_prefix/lib/node_modules/$4"
  echo '{}' > "$npm_config_prefix/lib/node_modules/$4/package.json"
fi
exit 0
`,
    { mode: 0o755 }
  );
  return vp;
}

// Temporarily set env vars on process.env (what the installer spreads).
function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('installer: asserted npm_config_prefix defeats npmrc prefix= and ambient env in any casing', () => {
  const fx = makeFixture(['v18.20.4']);
  const decoy = fs.mkdtempSync(path.join(os.tmpdir(), 'nvmpin-decoy-'));
  try {
    fs.writeFileSync(path.join(fx.root, '.npmrc'), `prefix=${decoy}\n`);
    const vp = stubEnvDumpingNode(fx);
    withEnv(
      { HOME: fx.root, NPM_CONFIG_PREFIX: decoy, NpM_CoNfIg_PrEfIx: decoy },
      () => createInstaller().install(fx.nvmDir, 'v18.20.4', 'some-pkg')
    );
    const lines = fs.readFileSync(path.join(vp, 'env.log'), 'utf8').trim().split('\n');
    const prefixLines = lines.filter((l) => /^npm_config_prefix=/i.test(l));
    assert.deepEqual(prefixLines, [`npm_config_prefix=${vp}`], 'exactly one prefix var, ours');
    assert.ok(
      fs.existsSync(path.join(vp, 'lib', 'node_modules', 'some-pkg', 'package.json')),
      'package landed in the target version tree'
    );
    assert.deepEqual(fs.readdirSync(decoy), [], 'nothing written under the decoy prefix');
  } finally {
    fs.rmSync(decoy, { recursive: true, force: true });
    fx.cleanup();
  }
});

test('installer: non-prefix npm_config_* (registry, auth token) pass through verbatim', () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    const vp = stubEnvDumpingNode(fx);
    withEnv(
      {
        npm_config_registry: 'https://registry.example.com/',
        'npm_config_//example.com/:_authToken': 'sentinel-token-123',
      },
      () => createInstaller().install(fx.nvmDir, 'v18.20.4', 'some-pkg')
    );
    const log = fs.readFileSync(path.join(vp, 'env.log'), 'utf8');
    assert.ok(log.includes('npm_config_registry=https://registry.example.com/'), 'registry survived');
    assert.ok(log.includes('npm_config_//example.com/:_authToken=sentinel-token-123'), 'auth token survived');
  } finally {
    fx.cleanup();
  }
});

test('installer: PREFIX (exact name) is deleted from the spawned env', () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    const vp = stubEnvDumpingNode(fx);
    withEnv({ PREFIX: '/tmp/prefix-decoy' }, () =>
      createInstaller().install(fx.nvmDir, 'v18.20.4', 'some-pkg')
    );
    const lines = fs.readFileSync(path.join(vp, 'env.log'), 'utf8').trim().split('\n');
    assert.ok(!lines.some((l) => l.startsWith('PREFIX=')), 'PREFIX must not reach npm');
  } finally {
    fx.cleanup();
  }
});

test('installer: uninstall also asserts npm_config_prefix and passes registry through', () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    const vp = stubEnvDumpingNode(fx);
    withEnv(
      { NPM_CONFIG_PREFIX: '/tmp/nowhere', npm_config_registry: 'https://registry.example.com/' },
      () => createInstaller().uninstall(fx.nvmDir, 'v18.20.4', 'some-pkg')
    );
    const lines = fs.readFileSync(path.join(vp, 'env.log'), 'utf8').trim().split('\n');
    const prefixLines = lines.filter((l) => /^npm_config_prefix=/i.test(l));
    assert.deepEqual(prefixLines, [`npm_config_prefix=${vp}`]);
    assert.ok(lines.includes('npm_config_registry=https://registry.example.com/'));
  } finally {
    fx.cleanup();
  }
});

test('installer: isInstalled checks the target global tree', () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    const installer = createInstaller();
    assert.equal(installer.isInstalled(fx.nvmDir, 'v18.20.4', 'ghost'), false);
    installFakePackage(fx.nvmDir, 'v18.20.4', 'real', { bin: { real: 'cli.js' } });
    assert.equal(installer.isInstalled(fx.nvmDir, 'v18.20.4', 'real'), true);
  } finally {
    fx.cleanup();
  }
});

test('installer: missing node/npm binaries is an environment error', () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    fs.rmSync(path.join(fx.nvmDir, 'versions', 'node', 'v18.20.4', 'bin', 'npm'));
    assert.throws(() => createInstaller().install(fx.nvmDir, 'v18.20.4', 'x'), EnvError);
  } finally {
    fx.cleanup();
  }
});
