import fs from 'node:fs';
import path from 'node:path';

export const REGISTRY_VERSION = 1;

export function pinsPath(home) {
  return path.join(home, 'pins.json');
}

export function shimDir(home) {
  return path.join(home, 'bin');
}

export function freshRegistry() {
  return { version: REGISTRY_VERSION, pins: {} };
}

export function validateRegistry(data) {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false;
  if (data.version !== REGISTRY_VERSION) return false;
  if (typeof data.pins !== 'object' || data.pins === null || Array.isArray(data.pins)) return false;
  for (const [pkg, pin] of Object.entries(data.pins)) {
    if (typeof pkg !== 'string' || !pkg) return false;
    if (typeof pin !== 'object' || pin === null) return false;
    if (typeof pin.node !== 'string' || !/^v\d+\.\d+\.\d+$/.test(pin.node)) return false;
    if (!Array.isArray(pin.bins) || !pin.bins.every((b) => typeof b === 'string' && b.length > 0)) return false;
    if (typeof pin.pinnedAt !== 'string') return false;
  }
  return true;
}

// Load pins.json. If the file is missing, returns a fresh registry. If it is
// corrupt (unparseable or schema-invalid): on the write path (default) the
// broken file is backed up and a fresh registry is returned with `recovered`
// set; with { readonly: true } nothing is written to disk — callers get a
// fresh in-memory registry with `corrupt` set and must not save it.
export function loadRegistry(home, { readonly = false } = {}) {
  const file = pinsPath(home);
  if (!fs.existsSync(file)) {
    return { registry: freshRegistry(), recovered: false, corrupt: false };
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    data = undefined;
  }
  if (data === undefined || !validateRegistry(data)) {
    if (readonly) {
      return { registry: freshRegistry(), recovered: false, corrupt: true };
    }
    const backup = `${file}.corrupt-${Date.now()}`;
    fs.renameSync(file, backup);
    return { registry: freshRegistry(), recovered: true, corrupt: true, backupPath: backup };
  }
  return { registry: data, recovered: false, corrupt: false };
}

// Backups left behind by write-path recovery, newest first.
export function listCorruptBackups(home) {
  if (!fs.existsSync(home)) return [];
  return fs
    .readdirSync(home)
    .filter((name) => name.startsWith('pins.json.corrupt-'))
    .sort()
    .reverse();
}

// Atomic write: write to a tmp file in the same dir, then rename over.
export function saveRegistry(home, registry) {
  if (!validateRegistry(registry)) {
    throw new Error('refusing to save invalid registry');
  }
  fs.mkdirSync(home, { recursive: true });
  const file = pinsPath(home);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2) + '\n');
  fs.renameSync(tmp, file);
}
