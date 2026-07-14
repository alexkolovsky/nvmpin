import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { UserError, EnvError } from './errors.js';
import { binDir, globalModulesDir } from './nvm.js';

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
  const result = spawnSync(nodeBin, [npmBin, ...npmArgs], {
    stdio,
    env: {
      ...process.env,
      PATH: `${binDir(nvmDir, version)}:${process.env.PATH || ''}`,
      npm_config_prefix: undefined,
    },
  });
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
