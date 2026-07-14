// Minimal semver helpers — enough for node version sorting and common
// engines.node ranges (>=, >, <=, <, =, ^, ~, x-ranges, || and space-AND).
// Deliberately not a full semver implementation (see DECISIONS.md).

export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v).trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function parseLoose(v) {
  // "18" -> [18,0,0] with wildcard depth tracked by caller
  const parts = String(v).replace(/^v/, '').split('.').map((p) => (p === 'x' || p === '*' || p === '' ? null : Number(p)));
  return [parts[0] ?? null, parts[1] ?? null, parts[2] ?? null];
}

function cmp(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

// Check one comparator like ">=18", "^18.2.0", "~18.2", "18.x", "18".
function satisfiesComparator(ver, comp) {
  comp = comp.trim();
  if (comp === '' || comp === '*' || comp === 'x') return true;
  const m = /^(>=|<=|>|<|=|\^|~)?\s*v?([\dx*.]+)$/.exec(comp);
  if (!m) return null; // unparseable
  const op = m[1] || '';
  const loose = parseLoose(m[2]);
  if (loose[0] === null || Number.isNaN(loose[0])) return null;
  const low = [loose[0], loose[1] ?? 0, loose[2] ?? 0];

  if (op === '>' ) return cmp(ver, low) > 0;
  if (op === '>=') return cmp(ver, low) >= 0;
  if (op === '<' ) return cmp(ver, low) < 0;
  if (op === '<=') return cmp(ver, low) <= 0;

  let high;
  if (op === '^') {
    high = low[0] > 0 ? [low[0] + 1, 0, 0] : low[1] > 0 ? [0, low[1] + 1, 0] : [0, 0, low[2] + 1];
  } else if (op === '~') {
    high = loose[1] === null ? [low[0] + 1, 0, 0] : [low[0], low[1] + 1, 0];
  } else {
    // exact or x-range: "18" / "18.x" -> next major; "18.2" -> next minor; "18.2.1" -> exact
    if (loose[1] === null) high = [low[0] + 1, 0, 0];
    else if (loose[2] === null) high = [low[0], low[1] + 1, 0];
    else return cmp(ver, low) === 0;
  }
  return cmp(ver, low) >= 0 && cmp(ver, high) < 0;
}

// Returns true/false, or null when the range can't be understood.
export function satisfies(version, range) {
  const ver = parseVersion(version);
  if (!ver) return null;
  // npm allows whitespace between operator and version (">= 4") — attach it
  // before splitting comparators on whitespace.
  const normalized = String(range).replace(/(>=|<=|>|<|\^|~|=)\s+/g, '$1');
  const orGroups = normalized.split('||');
  let sawParseable = false;
  for (const group of orGroups) {
    const comps = group.trim().split(/\s+/).filter(Boolean);
    if (comps.length === 0) continue;
    const results = comps.map((c) => satisfiesComparator(ver, c));
    if (results.some((r) => r === null)) continue; // skip unparseable group
    sawParseable = true;
    if (results.every(Boolean)) return true;
  }
  return sawParseable ? false : null;
}
