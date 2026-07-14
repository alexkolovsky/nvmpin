import { listVersions, listGlobalPackages } from '../nvm.js';
import { loadRegistryReadonly } from './_util.js';

// Packages that ship with node itself — not pin candidates.
const BUNDLED = new Set(['npm', 'corepack']);

export default async function scan(ctx) {
  const { ui } = ctx;
  const registry = loadRegistryReadonly(ctx);
  const versions = listVersions(ctx.nvmDir);

  const byPkg = new Map(); // pkg -> [versions it is installed in]
  for (const v of versions) {
    for (const pkg of listGlobalPackages(ctx.nvmDir, v)) {
      if (BUNDLED.has(pkg)) continue;
      if (!byPkg.has(pkg)) byPkg.set(pkg, []);
      byPkg.get(pkg).push(v);
    }
  }

  const report = [...byPkg.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pkg, vs]) => ({
      package: pkg,
      versions: vs,
      duplicate: vs.length > 1,
      pinned: registry.pins[pkg]?.node ?? null,
    }));

  if (ctx.flags.json) {
    ui.print(JSON.stringify({ nodeVersions: versions, packages: report }, null, 2));
    return 0;
  }

  if (versions.length === 0) {
    ui.print('no node versions installed under nvm.');
    return 0;
  }
  if (report.length === 0) {
    ui.print(`scanned ${versions.length} node version(s): no global packages found (npm/corepack excluded).`);
    return 0;
  }

  const rows = report.map((r) => [
    r.package,
    r.versions.join(', '),
    r.duplicate ? ui.yellow('yes') : 'no',
    r.pinned ? ui.green(r.pinned) : ui.dim('unpinned'),
  ]);
  ui.table(['package', 'installed in', 'duplicate', 'pinned to'], rows);

  const candidates = report.filter((r) => !r.pinned);
  if (candidates.length > 0) {
    ui.print('');
    ui.print(`${candidates.length} unpinned candidate(s). Pin one with: nvmpin add <pkg> --node <version>`);
  }
  return 0;
}
