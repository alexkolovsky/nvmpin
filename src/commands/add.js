import { UserError, EnvError } from '../errors.js';
import { listVersions, resolveVersion } from '../nvm.js';
import { saveRegistry, shimDir } from '../registry.js';
import { readBins, writeShims, parseShim, isNvmpinShim } from '../shims.js';
import { createInstaller } from '../installer.js';
import { satisfies } from '../semver.js';
import { loadRegistryWarn, parsePkgSpec, requireArg, readInstalledManifest } from './_util.js';
import fs from 'node:fs';
import path from 'node:path';

// Pick the newest installed version whose engines.node the package accepts.
function suggestVersion(ctx, pkgName, installed) {
  for (const v of installed) {
    const manifest = readInstalledManifest(ctx.nvmDir, v, pkgName);
    if (manifest?.engines?.node) {
      const ok = installed.filter((cand) => satisfies(cand, manifest.engines.node) === true);
      return ok[0]; // newest first
    }
  }
  return undefined;
}

function checkEngines(ctx, pkgName, version) {
  const manifest = readInstalledManifest(ctx.nvmDir, version, pkgName);
  const range = manifest?.engines?.node;
  if (range && satisfies(version, range) === false) {
    ctx.ui.warn(
      `${pkgName} declares engines.node "${range}" which node ${version} does not satisfy — proceeding anyway.`
    );
  }
}

export default async function add(ctx, args) {
  const { ui } = ctx;
  const spec = requireArg(args, 0, '<pkg>[@<version>]');
  const { name: pkgName, version: pkgVersion } = parsePkgSpec(spec);
  const installer = ctx.installer ?? createInstaller();
  const installed = listVersions(ctx.nvmDir);
  if (installed.length === 0) {
    throw new EnvError('no node versions installed under nvm', 'install one with `nvm install 20`.');
  }

  let nodeVersion;
  if (ctx.flags.node) {
    nodeVersion = resolveVersion(ctx.flags.node, installed);
  } else {
    nodeVersion = suggestVersion(ctx, pkgName, installed);
    if (nodeVersion) {
      ui.print(`--node not given; using ${nodeVersion} (satisfies ${pkgName}'s engines.node).`);
    } else {
      throw new UserError(
        `--node is required for "${pkgName}"`,
        `pass one of your installed versions: ${installed.join(', ')}.`
      );
    }
  }

  const registry = loadRegistryWarn(ctx);
  const existing = registry.pins[pkgName];
  if (existing && existing.node !== nodeVersion) {
    throw new UserError(
      `"${pkgName}" is already pinned to ${existing.node}`,
      `use \`nvmpin move ${pkgName} --node ${nodeVersion.replace(/^v/, '')}\` to change the pinned version.`
    );
  }

  if (!installer.isInstalled(ctx.nvmDir, nodeVersion, pkgName)) {
    ui.print(`installing ${spec} under node ${nodeVersion}...`);
    installer.install(ctx.nvmDir, nodeVersion, spec);
  } else if (pkgVersion) {
    ui.warn(`${pkgName} is already installed under ${nodeVersion}; the @${pkgVersion} spec was ignored.`);
  }

  checkEngines(ctx, pkgName, nodeVersion);

  const bins = readBins(ctx.nvmDir, nodeVersion, pkgName);

  // Refuse to clobber a shim owned by a different pinned package.
  for (const binName of Object.keys(bins)) {
    const shimPath = path.join(shimDir(ctx.home), binName);
    if (fs.existsSync(shimPath) && isNvmpinShim(shimPath)) {
      const owner = parseShim(shimPath);
      if (owner && owner.pkg !== pkgName) {
        throw new UserError(
          `bin "${binName}" is already shimmed for ${owner.pkg}`,
          `remove that pin first: nvmpin remove ${owner.pkg}`
        );
      }
    }
  }

  const written = writeShims(ctx.home, ctx.nvmDir, pkgName, nodeVersion, bins);
  registry.pins[pkgName] = { node: nodeVersion, bins: written, pinnedAt: new Date().toISOString() };
  saveRegistry(ctx.home, registry);

  ui.print(`${ui.green('pinned')} ${pkgName} -> node ${nodeVersion} (bins: ${written.join(', ')})`);
  return 0;
}
