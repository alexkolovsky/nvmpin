import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
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

for (const varName of ['NPM_CONFIG_PREFIX', 'npm_config_prefix', 'NpM_CoNfIg_PrEfIx', 'PREFIX']) {
  test(`installer: strips ambient ${varName} so npm targets the version's own tree`, () => {
    const fx = makeFixture(['v18.20.4']);
    const decoy = fs.mkdtempSync(path.join(fx.root, 'decoy-prefix-'));
    const saved = process.env[varName];
    process.env[varName] = decoy;
    try {
      const vp = path.join(fx.nvmDir, 'versions', 'node', 'v18.20.4');
      // fake node that records the prefix-related env the spawned npm sees
      fs.writeFileSync(
        path.join(vp, 'bin', 'node'),
        `#!/usr/bin/env bash
echo "NPM_CONFIG_PREFIX=\${NPM_CONFIG_PREFIX-<unset>}" >> "${vp}/invocations.log"
echo "npm_config_prefix=\${npm_config_prefix-<unset>}" >> "${vp}/invocations.log"
echo "NpM_CoNfIg_PrEfIx=\${NpM_CoNfIg_PrEfIx-<unset>}" >> "${vp}/invocations.log"
echo "PREFIX=\${PREFIX-<unset>}" >> "${vp}/invocations.log"
exit 0
`,
        { mode: 0o755 }
      );
      createInstaller().install(fx.nvmDir, 'v18.20.4', 'some-pkg');
      const log = fs.readFileSync(path.join(vp, 'invocations.log'), 'utf8');
      for (const line of log.trim().split('\n')) {
        assert.ok(line.endsWith('=<unset>'), `prefix var leaked into npm env: ${line}`);
      }
      assert.deepEqual(fs.readdirSync(decoy), [], 'nothing written to the decoy prefix');
    } finally {
      if (saved === undefined) delete process.env[varName];
      else process.env[varName] = saved;
      fx.cleanup();
    }
  });
}

test('installer: uninstall also strips ambient prefix overrides', () => {
  const fx = makeFixture(['v18.20.4']);
  const saved = process.env.NPM_CONFIG_PREFIX;
  process.env.NPM_CONFIG_PREFIX = '/tmp/nowhere';
  try {
    const vp = path.join(fx.nvmDir, 'versions', 'node', 'v18.20.4');
    fs.writeFileSync(
      path.join(vp, 'bin', 'node'),
      `#!/usr/bin/env bash\necho "NPM_CONFIG_PREFIX=\${NPM_CONFIG_PREFIX-<unset>}" >> "${vp}/invocations.log"\nexit 0\n`,
      { mode: 0o755 }
    );
    createInstaller().uninstall(fx.nvmDir, 'v18.20.4', 'some-pkg');
    const log = fs.readFileSync(path.join(vp, 'invocations.log'), 'utf8');
    assert.match(log, /NPM_CONFIG_PREFIX=<unset>/);
  } finally {
    if (saved === undefined) delete process.env.NPM_CONFIG_PREFIX;
    else process.env.NPM_CONFIG_PREFIX = saved;
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
