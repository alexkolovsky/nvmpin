import fs from 'node:fs';
import path from 'node:path';
import { UserError } from '../errors.js';
import { loadRegistry } from '../registry.js';
import { globalModulesDir } from '../nvm.js';

// Load the registry, surfacing corrupt-file recovery as a warning.
export function loadRegistryWarn(ctx) {
  const { registry, recovered, backupPath } = loadRegistry(ctx.home);
  if (recovered) {
    ctx.ui.warn(`pins.json was corrupt — backed it up to ${backupPath} and started fresh.`);
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
