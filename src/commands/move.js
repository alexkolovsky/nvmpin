import { UserError } from '../errors.js';
import { listVersions, resolveVersion } from '../nvm.js';
import { saveRegistry } from '../registry.js';
import { readBins, writeShims, removeShims } from '../shims.js';
import { createInstaller } from '../installer.js';
import { loadRegistryWarn, requireArg, readInstalledManifest } from './_util.js';

// A move is always a full reinstall into the target version — never a
// re-point of existing shims — because native modules are compiled per
// node ABI. Registry (and shims, best-effort) roll back on failure.
export default async function move(ctx, args) {
  const { ui } = ctx;
  const pkg = requireArg(args, 0, '<pkg>');
  if (!ctx.flags.node) {
    throw new UserError('--node is required for move', `usage: nvmpin move ${pkg} --node <version>`);
  }
  const registry = loadRegistryWarn(ctx);
  const pin = registry.pins[pkg];
  if (!pin) {
    throw new UserError(`"${pkg}" is not pinned`, `pin it first: nvmpin add ${pkg} --node ${ctx.flags.node}`);
  }

  const installed = listVersions(ctx.nvmDir);
  const target = resolveVersion(ctx.flags.node, installed);
  if (target === pin.node) {
    ui.print(`${pkg} is already pinned to ${target} — nothing to do.`);
    return 0;
  }

  const installer = ctx.installer ?? createInstaller();
  const snapshot = structuredClone(registry);
  const oldBins = pin.bins;

  // Keep the installed package version if we can read it from the old tree.
  const oldManifest = readInstalledManifest(ctx.nvmDir, pin.node, pkg);
  const spec = oldManifest?.version ? `${pkg}@${oldManifest.version}` : pkg;

  try {
    ui.print(`installing ${spec} under node ${target}...`);
    installer.install(ctx.nvmDir, target, spec);
    const bins = readBins(ctx.nvmDir, target, pkg);
    removeShims(ctx.home, oldBins);
    const written = writeShims(ctx.home, ctx.nvmDir, pkg, target, bins);
    registry.pins[pkg] = { node: target, bins: written, pinnedAt: new Date().toISOString() };
    saveRegistry(ctx.home, registry);
    ui.print(`${ui.green('moved')} ${pkg}: ${pin.node} -> ${target} (bins: ${written.join(', ')})`);
  } catch (err) {
    // Roll back: restore the registry and re-create the old shims if the
    // old install is still readable.
    saveRegistry(ctx.home, snapshot);
    try {
      const bins = readBins(ctx.nvmDir, pin.node, pkg);
      writeShims(ctx.home, ctx.nvmDir, pkg, pin.node, bins);
    } catch {
      // old tree unreadable — registry restore is the best we can do
    }
    ui.error(`move failed — pin for ${pkg} left on ${pin.node}.`);
    throw err;
  }
  return 0;
}
