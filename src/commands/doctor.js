import fs from 'node:fs';
import path from 'node:path';
import { versionsDir, versionPath, binDir } from '../nvm.js';
import { shimDir, pinsPath, loadRegistry, listCorruptBackups } from '../registry.js';
import { listShims, parseShim } from '../shims.js';

// Doctor exits 0 when healthy, 2 when problems are found (environment
// error class — the fixes are all about the surrounding system).
export default async function doctor(ctx) {
  const { ui } = ctx;
  const problems = [];
  const notes = [];
  const problem = (msg, fix) => problems.push({ msg, fix });

  const dir = shimDir(ctx.home);

  // 1. shim dir exists
  if (!fs.existsSync(dir)) {
    problem(`shim directory ${dir} does not exist`, 'run `nvmpin setup`.');
  }

  // 2. pins.json parses and is schema-valid. Doctor is read-only: a corrupt
  // file is reported as a finding (and the remaining checks run against an
  // in-memory empty registry) — never backed up or wiped from here.
  const { registry, corrupt } = loadRegistry(ctx.home, { readonly: true });
  if (corrupt) {
    problem(
      `pins.json is corrupt or schema-invalid: ${pinsPath(ctx.home)}`,
      'fix the file by hand, or run any write command (add/remove/move) to back it up and start fresh.'
    );
  }

  // 3. PATH check, three tiers. `nvm use` prepends the chosen version's bin
  // dir to PATH in the live shell — always, unavoidably — so "an nvm dir
  // precedes the shim dir" is not by itself an error. It is only a problem
  // when a pinned bin name actually exists in such an earlier dir (real
  // shadowing); otherwise it earns an informational note, because the thing
  // that matters — rc ordering — can only be judged in a fresh shell.
  const pathEntries = (ctx.env.PATH || '').split(':').filter(Boolean);
  const shimIdx = pathEntries.findIndex((p) => path.resolve(p) === path.resolve(dir));
  const nvmVersions = path.resolve(versionsDir(ctx.nvmDir));
  const isNvmVersionBin = (p) => {
    const rel = path.relative(nvmVersions, p);
    const parts = rel.split(path.sep);
    return !rel.startsWith('..') && parts.length === 2 && parts[1] === 'bin';
  };
  if (shimIdx === -1) {
    problem(`${dir} is not in PATH`, 'run `nvmpin setup` and add the printed line to your shell rc.');
  } else {
    const earlierNvmBins = [
      ...new Set(pathEntries.slice(0, shimIdx).map((p) => path.resolve(p)).filter(isNvmVersionBin)),
    ];
    if (earlierNvmBins.length > 0) {
      let shadowingFound = false;
      for (const [pkg, pin] of Object.entries(registry.pins)) {
        const ownBinDir = path.resolve(binDir(ctx.nvmDir, pin.node));
        for (const earlier of earlierNvmBins) {
          // The pin's own target version earlier in PATH resolves to the
          // same node + script either way — not shadowing.
          if (earlier === ownBinDir) continue;
          const shadowed = pin.bins.filter((b) => fs.existsSync(path.join(earlier, b)));
          if (shadowed.length > 0) {
            shadowingFound = true;
            problem(
              `bin${shadowed.length > 1 ? 's' : ''} ${shadowed.map((b) => `"${b}"`).join(', ')} of ${pkg} ` +
                `(pinned to ${pin.node}) ${shadowed.length > 1 ? 'are' : 'is'} shadowed by ${earlier}, ` +
                `which comes before the shim dir in PATH`,
              "either the rc ordering is wrong (nvmpin's PATH line must come after nvm's init lines), " +
                'or the currently `nvm use`d version has a conflicting global install — run `nvmpin scan` to see duplicates.'
            );
          }
        }
      }
      if (!shadowingFound) {
        notes.push(
          'nvm bin dir(s) precede the shim dir in PATH. This is expected inside a shell after `nvm use` ' +
            'and no pinned bin is currently shadowed. To verify the rc ordering that new shells will get, ' +
            'run doctor in a fresh shell.'
        );
      }
    }
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
  } else {
    ui.print(ui.red(`doctor: ${problems.length} problem(s) found`));
    for (const p of problems) {
      ui.print('');
      ui.print(`  ${ui.red('✗')} ${p.msg}`);
      ui.print(`    ${ui.dim('fix:')} ${p.fix}`);
    }
  }
  // Notes are informational only: no ✗, not counted, never affect exit code.
  for (const n of notes) {
    ui.print('');
    ui.print(`  ${ui.dim('note:')} ${n}`);
  }
  return problems.length === 0 ? 0 : 2;
}
