import fs from 'node:fs';
import path from 'node:path';
import { versionPath } from '../nvm.js';
import { shimDir } from '../registry.js';
import { parseShim } from '../shims.js';
import { loadRegistryReadonly } from './_util.js';

export function pinStatus(ctx, pkg, pin) {
  if (!fs.existsSync(versionPath(ctx.nvmDir, pin.node))) return 'node version missing';
  for (const bin of pin.bins) {
    const shimPath = path.join(shimDir(ctx.home), bin);
    if (!fs.existsSync(shimPath)) return 'broken shim';
    const parsed = parseShim(shimPath);
    if (!parsed || parsed.pkg !== pkg || parsed.version !== pin.node) return 'broken shim';
  }
  return 'ok';
}

export default async function list(ctx) {
  const { ui } = ctx;
  const registry = loadRegistryReadonly(ctx);
  const entries = Object.entries(registry.pins).sort(([a], [b]) => a.localeCompare(b));

  if (ctx.flags.json) {
    const out = entries.map(([pkg, pin]) => ({
      package: pkg,
      node: pin.node,
      bins: pin.bins,
      pinnedAt: pin.pinnedAt,
      status: pinStatus(ctx, pkg, pin),
    }));
    ui.print(JSON.stringify(out, null, 2));
    return 0;
  }

  if (entries.length === 0) {
    ui.print('no packages pinned. Pin one with: nvmpin add <pkg> --node <version>');
    return 0;
  }

  const rows = entries.map(([pkg, pin]) => {
    const status = pinStatus(ctx, pkg, pin);
    const painted = status === 'ok' ? ui.green(status) : ui.red(status);
    return [pkg, pin.node, pin.bins.join(', '), painted];
  });
  ui.table(['package', 'node', 'bins', 'status'], rows);
  return 0;
}
