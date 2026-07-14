// Builds fake $NVM_DIR trees and fake globally-installed packages in tmp dirs
// so tests never touch the real system.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function makeTmpDir(prefix = 'nvmpin-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Creates $NVM_DIR/versions/node/<v>/{bin,lib/node_modules} for each version.
// Each version gets a fake `node` and `npm` executable that record their argv
// to <versionPath>/invocations.log so tests can assert what was run.
export function makeFakeNvmDir(root, versions = ['v18.20.4', 'v20.11.1']) {
  const nvmDir = path.join(root, '.nvm');
  for (const v of versions) {
    const vp = path.join(nvmDir, 'versions', 'node', v);
    fs.mkdirSync(path.join(vp, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(vp, 'lib', 'node_modules'), { recursive: true });
    const fakeNode = `#!/usr/bin/env bash
echo "node $*" >> "${vp}/invocations.log"
exit \${FAKE_NODE_EXIT:-0}
`;
    fs.writeFileSync(path.join(vp, 'bin', 'node'), fakeNode, { mode: 0o755 });
    fs.writeFileSync(path.join(vp, 'bin', 'npm'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  }
  return nvmDir;
}

// Installs a fake package into a version's global tree.
// bin: string | object | undefined — mirrors package.json `bin` forms.
export function installFakePackage(nvmDir, version, name, { bin, engines, version: pkgVersion = '1.0.0' } = {}) {
  const pkgDir = path.join(nvmDir, 'versions', 'node', version, 'lib', 'node_modules', ...name.split('/'));
  fs.mkdirSync(pkgDir, { recursive: true });
  const manifest = { name, version: pkgVersion };
  if (bin !== undefined) manifest.bin = bin;
  if (engines !== undefined) manifest.engines = engines;
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(manifest, null, 2));

  const binPaths = typeof bin === 'string' ? [bin] : bin ? Object.values(bin) : [];
  for (const rel of binPaths) {
    const p = path.join(pkgDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `#!/usr/bin/env node\nconsole.log('${name} ran');\n`, { mode: 0o755 });
  }
  return pkgDir;
}

// A complete fixture: tmp root, fake nvm dir, empty nvmpin home.
export function makeFixture(versions) {
  const root = makeTmpDir();
  const nvmDir = makeFakeNvmDir(root, versions);
  const home = path.join(root, '.nvmpin');
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  return { root, nvmDir, home, cleanup };
}

// Minimal ui stub that records output instead of printing.
export function makeUiStub({ yes = true, confirmAnswer = true } = {}) {
  const out = [];
  const errs = [];
  const id = (s) => String(s);
  return {
    lines: out,
    errors: errs,
    color: false,
    yes,
    bold: id, dim: id, red: id, green: id, yellow: id, cyan: id,
    print: (s = '') => out.push(String(s)),
    warn: (s) => errs.push(`warning: ${s}`),
    error: (s) => errs.push(`error: ${s}`),
    hint: (s) => errs.push(`hint: ${s}`),
    table(headers, rows) {
      out.push(headers.join('  '));
      for (const r of rows) out.push(r.join('  '));
    },
    confirm: async () => (yes ? true : confirmAnswer),
  };
}
