import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { UserError, EnvError } from '../errors.js';
import { versionPath, binDir, globalModulesDir } from '../nvm.js';
import { readBins } from '../shims.js';
import { loadRegistryReadonly, requireArg } from './_util.js';

// Escape hatch: run a pinned package's main bin directly, bypassing shims.
export default async function exec(ctx, args) {
  const pkg = requireArg(args, 0, '<pkg>');
  const registry = loadRegistryReadonly(ctx);
  const pin = registry.pins[pkg];
  if (!pin) {
    throw new UserError(`"${pkg}" is not pinned`, 'run `nvmpin list` to see pinned packages.');
  }
  if (!fs.existsSync(versionPath(ctx.nvmDir, pin.node))) {
    throw new EnvError(
      `node ${pin.node} (pinned for ${pkg}) is no longer installed`,
      `reinstall it (nvm install ${pin.node.replace(/^v/, '')}) or move the pin: nvmpin move ${pkg} --node <version>`
    );
  }

  const bins = readBins(ctx.nvmDir, pin.node, pkg);
  // Main bin: the one matching the package's (unscoped) name, else the first.
  const baseName = pkg.startsWith('@') ? pkg.split('/')[1] : pkg;
  const binName = bins[baseName] ? baseName : Object.keys(bins)[0];
  const binPath = path.join(globalModulesDir(ctx.nvmDir, pin.node), ...pkg.split('/'), bins[binName]);
  const nodeBin = path.join(binDir(ctx.nvmDir, pin.node), 'node');

  const result = spawnSync(nodeBin, [binPath, ...ctx.passthrough], { stdio: 'inherit' });
  if (result.error) {
    throw new EnvError(`failed to exec ${binName}: ${result.error.message}`);
  }
  return result.status ?? 0;
}
