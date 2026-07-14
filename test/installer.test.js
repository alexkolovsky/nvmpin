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
