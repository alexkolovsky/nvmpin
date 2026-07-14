import fs from 'node:fs';
import { UserError } from '../errors.js';
import { saveRegistry } from '../registry.js';
import { removeShims } from '../shims.js';
import { createInstaller } from '../installer.js';
import { versionPath } from '../nvm.js';
import { loadRegistryWarn, requireArg } from './_util.js';

export default async function remove(ctx, args) {
  const { ui } = ctx;
  const pkg = requireArg(args, 0, '<pkg>');
  const registry = loadRegistryWarn(ctx);
  const pin = registry.pins[pkg];
  if (!pin) {
    throw new UserError(`"${pkg}" is not pinned`, 'run `nvmpin list` to see pinned packages.');
  }

  removeShims(ctx.home, pin.bins);
  delete registry.pins[pkg];
  saveRegistry(ctx.home, registry);
  ui.print(`removed pin for ${pkg} (shims: ${pin.bins.join(', ')})`);

  if (ctx.flags.uninstall) {
    if (fs.existsSync(versionPath(ctx.nvmDir, pin.node))) {
      const installer = ctx.installer ?? createInstaller();
      ui.print(`uninstalling ${pkg} from node ${pin.node}...`);
      installer.uninstall(ctx.nvmDir, pin.node, pkg);
      ui.print(`uninstalled ${pkg} from node ${pin.node}`);
    } else {
      ui.warn(`node ${pin.node} is no longer installed — nothing to uninstall.`);
    }
  }
  return 0;
}
