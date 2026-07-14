import fs from 'node:fs';
import path from 'node:path';
import { versionsDir, versionPath } from '../nvm.js';
import { shimDir, pinsPath, loadRegistry, listCorruptBackups } from '../registry.js';
import { listShims, parseShim } from '../shims.js';

// Doctor exits 0 when healthy, 2 when problems are found (environment
// error class — the fixes are all about the surrounding system).
export default async function doctor(ctx) {
  const { ui } = ctx;
  const problems = [];
  const problem = (msg, fix) => problems.push({ msg, fix });

  const dir = shimDir(ctx.home);

  // 1. shim dir exists
  if (!fs.existsSync(dir)) {
    problem(`shim directory ${dir} does not exist`, 'run `nvmpin setup`.');
  }

  // 2. PATH ordering: shim dir must come before every nvm bin path
  const pathEntries = (ctx.env.PATH || '').split(':').filter(Boolean);
  const shimIdx = pathEntries.findIndex((p) => path.resolve(p) === path.resolve(dir));
  const nvmVersions = path.resolve(versionsDir(ctx.nvmDir));
  const nvmIdxs = pathEntries
    .map((p, i) => (path.resolve(p).startsWith(nvmVersions + path.sep) ? i : -1))
    .filter((i) => i !== -1);
  if (shimIdx === -1) {
    problem(`${dir} is not in PATH`, 'run `nvmpin setup` and add the printed line to your shell rc.');
  } else if (nvmIdxs.some((i) => i < shimIdx)) {
    problem(
      `${dir} appears in PATH after an nvm bin directory — nvm-managed bins will win over shims`,
      "move the nvmpin PATH export below (after) nvm's init lines in your shell rc so it is prepended last."
    );
  }

  // 3. pins.json parses and is schema-valid. Doctor is read-only: a corrupt
  // file is reported as a finding (and the remaining checks run against an
  // in-memory empty registry) — never backed up or wiped from here.
  const { registry, corrupt } = loadRegistry(ctx.home, { readonly: true });
  if (corrupt) {
    problem(
      `pins.json is corrupt or schema-invalid: ${pinsPath(ctx.home)}`,
      'fix the file by hand, or run any write command (add/remove/move) to back it up and start fresh.'
    );
  }

  // 4. every registry entry's node version still exists, shims match
  const shimsSeen = new Set();
  for (const [pkg, pin] of Object.entries(registry.pins)) {
    if (!fs.existsSync(versionPath(ctx.nvmDir, pin.node))) {
      problem(
        `${pkg} is pinned to node ${pin.node}, which is not installed`,
        `nvm install ${pin.node.replace(/^v/, '')}, or nvmpin move ${pkg} --node <version>.`
      );
    }
    for (const bin of pin.bins) {
      shimsSeen.add(bin);
      const shimPath = path.join(dir, bin);
      if (!fs.existsSync(shimPath)) {
        problem(`shim "${bin}" for ${pkg} is missing`, `re-create it: nvmpin move ${pkg} --node ${pin.node.replace(/^v/, '')} (or remove and re-add).`);
        continue;
      }
      const parsed = parseShim(shimPath);
      if (!parsed) {
        problem(`shim "${bin}" exists but is not an nvmpin shim`, `remove ${shimPath} and re-add ${pkg}.`);
      } else if (parsed.pkg !== pkg || parsed.version !== pin.node) {
        problem(
          `shim "${bin}" points at ${parsed.pkg}@${parsed.version} but the registry pins ${pkg}@${pin.node}`,
          `re-add the pin: nvmpin remove ${pkg} && nvmpin add ${pkg} --node ${pin.node.replace(/^v/, '')}.`
        );
      }
    }
  }

  // 5. orphaned shims: nvmpin shim files no registry entry claims. After a
  // write-path corrupt-registry recovery every shim lands here — if a
  // pins.json.corrupt-* backup exists, point at it.
  const backups = listCorruptBackups(ctx.home);
  const backupHint = backups.length
    ? ` A registry backup exists (${path.join(ctx.home, backups[0])}) — restore it over pins.json to recover the pin, or re-add the package.`
    : ' Delete the shim, or re-add the package.';
  for (const name of listShims(ctx.home)) {
    if (!shimsSeen.has(name)) {
      const parsed = parseShim(path.join(dir, name));
      problem(
        `orphaned shim "${name}"${parsed ? ` (for ${parsed.pkg})` : ''} has no registry entry`,
        `${path.join(dir, name)} is not tracked.${backupHint}`
      );
    }
  }

  if (problems.length === 0) {
    ui.print(ui.green('doctor: all checks passed.'));
    return 0;
  }
  ui.print(ui.red(`doctor: ${problems.length} problem(s) found`));
  for (const p of problems) {
    ui.print('');
    ui.print(`  ${ui.red('✗')} ${p.msg}`);
    ui.print(`    ${ui.dim('fix:')} ${p.fix}`);
  }
  return 2;
}
