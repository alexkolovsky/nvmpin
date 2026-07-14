import fs from 'node:fs';
import path from 'node:path';
import { UserError } from './errors.js';
import { globalModulesDir, versionPath } from './nvm.js';
import { shimDir } from './registry.js';

export const SHIM_MARKER = '# nvmpin shim for ';

// Read the target package's bin map from its installed package.json.
// Returns { <binName>: <relative path inside pkg> }.
export function readBins(nvmDir, version, pkg) {
  const pkgDir = path.join(globalModulesDir(nvmDir, version), ...pkg.split('/'));
  const manifestPath = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(manifestPath)) {
    throw new UserError(
      `package "${pkg}" is not installed under node ${version}`,
      `expected ${manifestPath} to exist.`
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new UserError(`package.json of "${pkg}" under node ${version} is not valid JSON`);
  }
  const bin = manifest.bin;
  if (bin === undefined || bin === null) {
    throw new UserError(
      `package "${pkg}" declares no executables (no "bin" field)`,
      'nvmpin only pins packages that provide CLI commands.'
    );
  }
  if (typeof bin === 'string') {
    // String form: the bin name is the package name (without scope).
    const name = pkg.startsWith('@') ? pkg.split('/')[1] : pkg;
    return { [name]: normalizeBinPath(bin) };
  }
  const bins = {};
  for (const [name, rel] of Object.entries(bin)) {
    if (typeof rel === 'string') bins[name] = normalizeBinPath(rel);
  }
  if (Object.keys(bins).length === 0) {
    throw new UserError(`package "${pkg}" has an empty "bin" field`);
  }
  return bins;
}

function normalizeBinPath(p) {
  return p.replace(/^\.\//, '');
}

export function shimContent(pkg, version, absVersionPath, binRelPath) {
  return `#!/usr/bin/env bash
${SHIM_MARKER}${pkg} -> ${version} (do not edit)
exec "${absVersionPath}/bin/node" "${absVersionPath}/lib/node_modules/${pkg}/${binRelPath}" "$@"
`;
}

// Write one shim per bin. Returns the list of shim names written.
export function writeShims(home, nvmDir, pkg, version, bins) {
  const dir = shimDir(home);
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.resolve(versionPath(nvmDir, version));
  const written = [];
  for (const [name, rel] of Object.entries(bins)) {
    fs.writeFileSync(path.join(dir, name), shimContent(pkg, version, abs, rel), { mode: 0o755 });
    written.push(name);
  }
  return written.sort();
}

export function removeShims(home, binNames) {
  const dir = shimDir(home);
  for (const name of binNames) {
    const p = path.join(dir, name);
    if (fs.existsSync(p) && isNvmpinShim(p)) fs.rmSync(p);
  }
}

export function isNvmpinShim(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').includes(SHIM_MARKER);
  } catch {
    return false;
  }
}

// Parse a shim file back into { pkg, version } (for doctor drift checks).
export function parseShim(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const m = new RegExp(`^${SHIM_MARKER}(.+) -> (v\\d+\\.\\d+\\.\\d+) \\(do not edit\\)$`, 'm').exec(content);
    if (!m) return null;
    return { pkg: m[1], version: m[2] };
  } catch {
    return null;
  }
}

export function listShims(home) {
  const dir = shimDir(home);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => isNvmpinShim(path.join(dir, name))).sort();
}
