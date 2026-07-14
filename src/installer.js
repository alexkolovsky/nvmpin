import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { UserError, EnvError } from './errors.js';
import { binDir, globalModulesDir, versionPath } from './nvm.js';

// Runs the target version's own npm with the target version's own node —
// never the ambient npm — so packages land in that version's global tree
// and native modules compile against the right ABI.
function runNpm(nvmDir, version, npmArgs, { stdio = 'inherit' } = {}) {
  const nodeBin = path.join(binDir(nvmDir, version), 'node');
  const npmBin = path.join(binDir(nvmDir, version), 'npm');
  if (!fs.existsSync(nodeBin) || !fs.existsSync(npmBin)) {
    throw new EnvError(
      `node ${version} under ${nvmDir} is missing its node or npm binary`,
      `try reinstalling it: nvm install ${version.replace(/^v/, '')}`
    );
  }
  // npm resolves `node` for lifecycle scripts (postinstall, node-gyp) from
  // PATH, not from the node that launched npm — prepend the target version's
  // bin dir so native builds compile against the right ABI.
  const env = {
    ...process.env,
    PATH: `${binDir(nvmDir, version)}:${process.env.PATH || ''}`,
  };
  // A prefix override — env var in any casing, or prefix= in an npmrc —
  // would redirect the install away from the target version's tree, leaving
  // shims pointing at nothing. Assert the right prefix instead of hunting
  // for wrong ones: env config outranks every npmrc layer, so setting
  // npm_config_prefix to the version dir wins over all of them. npm resolves
  // conflicting env casings by last-in-env-order, so delete existing prefix
  // keys first to guarantee ours is last. All other npm_config_* (registry,
  // proxy, auth tokens) must pass through untouched.
  for (const key of Object.keys(env)) {
    if (/^npm_config_prefix$/i.test(key)) delete env[key];
  }
  env.npm_config_prefix = versionPath(nvmDir, version);
  // PREFIX (exact name) is also honored by npm but has no correct value to
  // assert here — only a wrong one to remove.
  delete env.PREFIX;
  const result = spawnSync(nodeBin, [npmBin, ...npmArgs], { stdio, env });
  if (result.error) {
    throw new EnvError(`failed to run npm for node ${version}: ${result.error.message}`);
  }
  return result;
}

export function createInstaller() {
  return {
    isInstalled(nvmDir, version, pkg) {
      return fs.existsSync(path.join(globalModulesDir(nvmDir, version), ...pkg.split('/'), 'package.json'));
    },

    // pkgSpec may include a version, e.g. "typescript@5.4.0".
    install(nvmDir, version, pkgSpec) {
      const result = runNpm(nvmDir, version, ['install', '-g', pkgSpec]);
      if (result.status !== 0) {
        throw new UserError(
          `npm install of "${pkgSpec}" failed under node ${version} (exit ${result.status})`,
          'check the npm output above — bad package name or version, or a network problem.'
        );
      }
    },

    uninstall(nvmDir, version, pkg) {
      const result = runNpm(nvmDir, version, ['uninstall', '-g', pkg]);
      if (result.status !== 0) {
        throw new UserError(`npm uninstall of "${pkg}" failed under node ${version} (exit ${result.status})`);
      }
    },
  };
}
