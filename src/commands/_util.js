import fs from 'node:fs';
import path from 'node:path';
import { UserError, EnvError } from '../errors.js';
import { loadRegistry, pinsPath } from '../registry.js';
import { globalModulesDir } from '../nvm.js';

// Write-path load (add, remove, move): corrupt-file recovery is allowed —
// back up the broken file, warn, continue fresh.
export function loadRegistryWarn(ctx) {
  const { registry, recovered, backupPath } = loadRegistry(ctx.home);
  if (recovered) {
    ctx.ui.warn(`pins.json was corrupt — backed it up to ${backupPath} and started fresh.`);
  }
  return registry;
}

// Read-only load (list, scan, exec): never writes anything. A corrupt
// registry is an error, not something to silently wipe.
export function loadRegistryReadonly(ctx) {
  const { registry, corrupt } = loadRegistry(ctx.home, { readonly: true });
  if (corrupt) {
    throw new EnvError(
      `pins.json is corrupt or schema-invalid: ${pinsPath(ctx.home)}`,
      'run `nvmpin doctor` for details; fix or delete the file (any write command backs it up and starts fresh).'
    );
  }
  return registry;
}

// "pkg", "pkg@1.2.3", "@scope/pkg", "@scope/pkg@1.2.3" -> { name, version }
export function parsePkgSpec(spec) {
  const at = spec.lastIndexOf('@');
  if (at > 0) {
    return { name: spec.slice(0, at), version: spec.slice(at + 1) };
  }
  if (!spec || spec === '@') {
    throw new UserError(`invalid package spec: "${spec}"`);
  }
  return { name: spec, version: undefined };
}

export function requireArg(args, index, what) {
  const v = args[index];
  if (!v) {
    throw new UserError(`missing required argument: ${what}`, 'run `nvmpin --help` for usage.');
  }
  return v;
}

// Read the installed package's manifest, or null if not installed there.
export function readInstalledManifest(nvmDir, version, pkg) {
  const p = path.join(globalModulesDir(nvmDir, version), ...pkg.split('/'), 'package.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}
