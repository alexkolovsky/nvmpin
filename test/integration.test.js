// Gated integration test: exercises REAL npm to re-verify the npm-side
// behavior that decisions 14 and 16 depend on (env-prefix precedence over
// npmrc, config passthrough). The unit suite proves nvmpin's side of the
// contract against stubs; this proves npm still holds up its side.
//
// Skipped unless NVMPIN_INTEGRATION=1 (hits the npm registry, needs network).
// Run via: npm run test:integration
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInstaller } from '../src/installer.js';

const skip =
  process.env.NVMPIN_INTEGRATION === '1'
    ? false
    : 'integration test — set NVMPIN_INTEGRATION=1 to run (installs from the real npm registry)';

// Tiny, pure-JS, no lifecycle scripts, declares bins (cowsay, cowthink).
// Version pinned exactly for reproducibility.
const PKG = 'cowsay';
const PKG_VERSION = '1.6.0';
const TIMEOUT = 300_000; // network install

// Sandbox: an nvm-shaped tree whose "node version" is the real node + npm
// running this test process, plus a fixture HOME and decoy prefix dirs.
// No nvm required on the machine.
function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nvmpin-integration-'));
  const nvmDir = path.join(root, 'nvm');
  const version = `v${process.versions.node}`;
  const vp = path.join(nvmDir, 'versions', 'node', version);
  fs.mkdirSync(path.join(vp, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(vp, 'lib'), { recursive: true });

  const realNode = process.execPath;
  const realNpm = path.join(path.dirname(realNode), 'npm');
  assert.ok(
    fs.existsSync(realNpm),
    `expected an npm binary next to the running node (${realNpm}) — run the test with a node that ships npm`
  );
  fs.symlinkSync(realNode, path.join(vp, 'bin', 'node'));
  fs.symlinkSync(realNpm, path.join(vp, 'bin', 'npm'));

  const home = path.join(root, 'home');
  const decoys = {
    A: path.join(root, 'decoy-npmrc'),
    B: path.join(root, 'decoy-env-upper'),
    C: path.join(root, 'decoy-env-lower'),
  };
  fs.mkdirSync(home, { recursive: true });
  for (const d of Object.values(decoys)) fs.mkdirSync(d, { recursive: true });

  return {
    root,
    nvmDir,
    version,
    vp,
    home,
    decoys,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

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

test(
  'integration: real npm — install defeats three-way prefix conflict, bin runs, uninstall cleans up',
  { skip, timeout: TIMEOUT },
  (t) => {
    const sb = makeSandbox();
    try {
      // Three-way prefix conflict: userconfig npmrc + both env casings.
      fs.writeFileSync(path.join(sb.home, '.npmrc'), `prefix=${sb.decoys.A}\n`);
      const conflictEnv = {
        HOME: sb.home,
        NPM_CONFIG_PREFIX: sb.decoys.B,
        npm_config_prefix: sb.decoys.C,
      };

      const npmVersion = spawnSync(
        path.join(sb.vp, 'bin', 'node'),
        [path.join(sb.vp, 'bin', 'npm'), '--version'],
        { encoding: 'utf8' }
      ).stdout.trim();
      t.diagnostic(`npm-side contract verified against npm ${npmVersion} (node ${process.version})`);

      const installer = createInstaller();
      withEnv(conflictEnv, () => installer.install(sb.nvmDir, sb.version, `${PKG}@${PKG_VERSION}`));

      // Landed in the target version's tree, not any decoy.
      const manifestPath = path.join(sb.vp, 'lib', 'node_modules', PKG, 'package.json');
      assert.ok(fs.existsSync(manifestPath), 'package landed in the fixture version tree');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      assert.equal(manifest.version, PKG_VERSION);
      assert.ok(fs.existsSync(path.join(sb.vp, 'bin', PKG)), 'bin linked into the version bin dir');
      for (const [name, dir] of Object.entries(sb.decoys)) {
        assert.deepEqual(fs.readdirSync(dir), [], `decoy ${name} (${dir}) must stay empty`);
      }

      // Sanity-run the installed bin through the real node — the closest a
      // sandbox gets to the shim contract (shims exec <node> <bin-path>).
      const binPath = path.join(sb.vp, 'lib', 'node_modules', PKG, manifest.bin[PKG]);
      const run = spawnSync(process.execPath, [binPath, 'integration-moo'], { encoding: 'utf8' });
      assert.equal(run.status, 0, `installed bin failed to run: ${run.stderr}`);
      assert.match(run.stdout, /integration-moo/);

      // Uninstall through the installer; tree clean, decoys still empty.
      withEnv(conflictEnv, () => installer.uninstall(sb.nvmDir, sb.version, PKG));
      assert.ok(!fs.existsSync(path.join(sb.vp, 'lib', 'node_modules', PKG)), 'package removed');
      for (const dir of Object.values(sb.decoys)) {
        assert.deepEqual(fs.readdirSync(dir), [], 'decoys untouched by uninstall');
      }
    } finally {
      sb.cleanup();
    }
  }
);

test(
  'integration: real npm — npm_config_registry passes through (install against unreachable sentinel fails)',
  { skip, timeout: TIMEOUT },
  () => {
    const sb = makeSandbox();
    try {
      assert.throws(
        () =>
          withEnv({ HOME: sb.home, npm_config_registry: 'http://127.0.0.1:9/' }, () =>
            createInstaller().install(sb.nvmDir, sb.version, `${PKG}@${PKG_VERSION}`)
          ),
        /npm install .* failed/,
        'install must fail — proving the registry value reached real npm instead of being stripped'
      );
      assert.ok(
        !fs.existsSync(path.join(sb.vp, 'lib', 'node_modules', PKG)),
        'nothing installed from the sentinel registry'
      );
    } finally {
      sb.cleanup();
    }
  }
);
