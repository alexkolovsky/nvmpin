import fs from 'node:fs';
import path from 'node:path';
import { UserError, EnvError } from './errors.js';
import { compareVersions } from './semver.js';

export function versionsDir(nvmDir) {
  return path.join(nvmDir, 'versions', 'node');
}

export function versionPath(nvmDir, version) {
  return path.join(versionsDir(nvmDir), version);
}

export function assertNvmDir(nvmDir) {
  if (!fs.existsSync(nvmDir)) {
    throw new EnvError(
      `nvm directory not found: ${nvmDir}`,
      'install nvm (https://github.com/nvm-sh/nvm) or set NVM_DIR to its location.'
    );
  }
}

// Installed node versions ("v18.20.4", ...) sorted newest first.
export function listVersions(nvmDir) {
  assertNvmDir(nvmDir);
  const dir = versionsDir(nvmDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => /^v\d+\.\d+\.\d+$/.test(name) && fs.statSync(path.join(dir, name)).isDirectory())
    .sort((a, b) => compareVersions(b, a));
}

const ALIAS_RE = /^(lts\/|lts$|stable$|latest$|node$|iojs|current$|default$|system$)/i;

// Resolve a user-supplied spec ("18", "18.20", "v18.20.4") against installed
// versions. Returns the newest match. nvm aliases are rejected.
export function resolveVersion(spec, installed) {
  const raw = String(spec).trim();
  if (ALIAS_RE.test(raw)) {
    throw new UserError(
      `nvm aliases like "${raw}" are not supported`,
      'pass a numeric version instead, e.g. --node 18 or --node v18.20.4.'
    );
  }
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(raw);
  if (!m) {
    throw new UserError(
      `invalid node version: "${raw}"`,
      'use a numeric version like 18, 18.20, or v18.20.4.'
    );
  }
  const [, maj, min, pat] = m;
  const matches = installed.filter((v) => {
    const [vmaj, vmin, vpat] = v.slice(1).split('.');
    if (vmaj !== maj) return false;
    if (min !== undefined && vmin !== min) return false;
    if (pat !== undefined && vpat !== pat) return false;
    return true;
  });
  if (matches.length === 0) {
    const list = installed.length ? installed.join(', ') : '(none)';
    throw new EnvError(
      `no installed node version matches "${raw}"`,
      `installed versions: ${list}. Install one with \`nvm install ${raw}\`.`
    );
  }
  return matches[0]; // installed is sorted newest first
}

export function globalModulesDir(nvmDir, version) {
  return path.join(versionPath(nvmDir, version), 'lib', 'node_modules');
}

export function binDir(nvmDir, version) {
  return path.join(versionPath(nvmDir, version), 'bin');
}

// List globally installed packages (including scoped) for one node version.
export function listGlobalPackages(nvmDir, version) {
  const root = globalModulesDir(nvmDir, version);
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const name of fs.readdirSync(root)) {
    if (name === '.bin' || name === '.package-lock.json') continue;
    if (name.startsWith('@')) {
      const scopeDir = path.join(root, name);
      if (!fs.statSync(scopeDir).isDirectory()) continue;
      for (const sub of fs.readdirSync(scopeDir)) {
        if (fs.existsSync(path.join(scopeDir, sub, 'package.json'))) out.push(`${name}/${sub}`);
      }
    } else if (fs.existsSync(path.join(root, name, 'package.json'))) {
      out.push(name);
    }
  }
  return out.sort();
}
